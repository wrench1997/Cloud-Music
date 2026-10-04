import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import packageInfo from '../../package.json';

const NativeUpdater = registerPlugin('AppUpdater');
const UpdatesContext = createContext(null);
export const UPDATE_RELEASES_URL = 'https://github.com/wrench1997/Cloud-Music/releases';

// The provider stays mounted while the user moves between the library and settings.
export function AppUpdatesProvider({ children }) {
  const api = useRef(null);
  const active = useRef(false);
  const [state, setState] = useState(null);
  const [platform, setPlatform] = useState('web');
  const [installedVersion, setInstalledVersion] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    active.current = true;
    let alive = true;
    let unsubscribe;
    let listener;
    const update = (next) => { if (alive) setState(next); };
    (async () => {
      if (window.electronAPI?.updates) {
        setPlatform('desktop');
        api.current = window.electronAPI.updates;
        unsubscribe = api.current.onState(update);
      } else if (Capacitor.getPlatform() === 'android') {
        setPlatform('android');
        // Read the installed APK version even when GitHub is temporarily unavailable.
        NativeApp.getInfo().then((info) => { if (alive) setInstalledVersion(info.version); }).catch(() => {});
        api.current = NativeUpdater;
        listener = await NativeUpdater.addListener('state', update);
        if (!alive) { listener.remove(); return; }
      } else return;
      update(await api.current.status());
      if (alive && Capacitor.getPlatform() === 'android') update(await api.current.check());
    })().catch(() => { if (alive) setError('暂时无法检查更新，请稍后重试。'); });
    return () => { alive = false; active.current = false; unsubscribe?.(); listener?.remove(); };
  }, []);

  const act = useCallback(async (method) => {
    if (!api.current?.[method]) return;
    setError('');
    try {
      const next = await api.current[method]();
      if (active.current) setState(next);
    } catch (failure) {
      if (active.current) setError(failure.message || '更新失败，请稍后重试。');
    }
  }, []);
  const hasUpdate = ['available', 'downloading', 'downloaded', 'installing'].includes(state?.state);
  const currentVersion = state?.currentVersion || installedVersion || (platform === 'web' ? packageInfo.version : '');
  return <UpdatesContext.Provider value={{ state, error, platform, hasUpdate, currentVersion, act }}>{children}</UpdatesContext.Provider>;
}

export function useAppUpdates() {
  const updates = useContext(UpdatesContext);
  if (!updates) throw new Error('useAppUpdates must be used within AppUpdatesProvider.');
  return updates;
}

export default function AppUpdates() {
  const { state, error, platform, hasUpdate, currentVersion, act } = useAppUpdates();
  const supported = platform !== 'web' && state?.state !== 'unsupported';
  const busy = ['checking', 'downloading', 'installing'].includes(state?.state);
  const text = {
    idle: '启动时自动检查更新', checking: '正在检查更新…', current: '已是最新版本',
    unpublished: '暂未发布可用更新', available: `发现新版本 ${state?.version}`,
    downloading: `正在下载 ${state?.version}`, downloaded: `新版本 ${state?.version} 已准备好`,
    installing: '正在打开安装程序…', error: state?.error || '暂时无法检查更新。',
    unsupported: '请在 GitHub 下载应用安装包。',
  }[state?.state] || (platform === 'web' ? '网页随服务更新，也可以下载 Windows 或 Android 版。' : '正在读取更新状态…');
  const progress = Math.max(0, Math.min(100, Number(state?.progress) || 0));

  return <section className="settings-card app-updates-card" aria-labelledby="app-updates-title">
    <div className="settings-card-heading"><span className="settings-symbol" aria-hidden="true">↻</span><div><h2 id="app-updates-title">应用更新</h2><p>{platform === 'android' ? 'Android' : platform === 'desktop' ? '桌面版' : '网页版'} · 当前版本 {currentVersion || '读取中…'}</p></div>{hasUpdate && <span className="settings-update-badge">有更新</span>}</div>
    <p className="settings-update-status" role="status">{text}</p>
    {state?.state === 'downloading' && <div className="settings-update-progress"><progress value={progress} max="100" aria-label="更新下载进度" /><span>{progress}%</span></div>}
    {state?.permissionRequired && <p className="settings-note">允许云感音乐安装应用后，返回这里点击“安装更新”。</p>}
    {error && <p className="settings-error" role="alert">{error}</p>}
    {state?.error && state.state !== 'error' && !error && <p className="settings-error" role="alert">{state.error}</p>}
    <div className="settings-actions">
      {supported && !hasUpdate && <button className="settings-primary" disabled={busy} onClick={() => act('check')}>{state?.state === 'checking' ? '正在检查…' : '检查更新'}</button>}
      {state?.state === 'available' && platform === 'android' && <button className="settings-primary" onClick={() => act('download')}>下载更新</button>}
      {state?.state === 'downloaded' && <button className="settings-primary" onClick={() => act('install')}>{platform === 'android' ? '安装更新' : '重启并更新'}</button>}
      <a className="settings-link" href={UPDATE_RELEASES_URL} target="_blank" rel="noopener noreferrer">GitHub 版本记录 ↗</a>
    </div>
    {supported && <p className="settings-note">{platform === 'android' ? '下载完成后由你确认安装，保留原有账号和曲库。' : '发现新版本后自动下载，准备好后由你选择重启更新。'}</p>}
  </section>;
}
