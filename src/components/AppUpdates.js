import { useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';

const NativeUpdater = registerPlugin('AppUpdater');

export default function AppUpdates() {
  const api = useRef(null);
  const [state, setState] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let unsubscribe;
    let listener;
    const update = (next) => { if (active) setState(next); };
    (async () => {
      if (window.electronAPI?.updates) {
        api.current = window.electronAPI.updates;
        unsubscribe = api.current.onState(update);
      } else if (Capacitor.getPlatform() === 'android') {
        api.current = NativeUpdater;
        listener = await NativeUpdater.addListener('state', update);
      } else return;
      update(await api.current.status());
      if (Capacitor.getPlatform() === 'android') update(await api.current.check());
    })().catch(() => { if (active) setError('暂时无法检查更新。'); });
    return () => { active = false; unsubscribe?.(); listener?.remove(); };
  }, []);

  if (!state || state.state === 'unsupported') return null;
  const hasUpdate = ['available', 'downloading', 'downloaded', 'installing'].includes(state.state);
  const text = {
    idle: '自动检查 GitHub 更新', checking: '正在检查更新…', current: '已是最新版本',
    unpublished: '暂未发布更新', available: `发现新版本 ${state.version}`,
    downloading: `正在下载 ${state.version} · ${state.progress || 0}%`,
    downloaded: `新版本 ${state.version} 已准备好`, installing: '正在打开安装程序…',
    error: state.error || '暂时无法检查更新。',
  }[state.state] || '应用更新';
  const act = async (method) => {
    setError('');
    try { setState(await api.current[method]()); }
    catch (failure) { setError(failure.message || '更新失败，请稍后重试。'); }
  };
  if (!expanded && !hasUpdate) return <button className="fixed right-4 bottom-24 z-[90] rounded-full border border-black/10 bg-white/95 px-3 py-1.5 text-xs text-gray-600 shadow-sm" onClick={() => setExpanded(true)}>应用更新</button>;
  return <div role="status" className="fixed right-4 bottom-24 z-[90] max-w-xs rounded-2xl border border-black/10 bg-white p-4 text-sm text-gray-800 shadow-lg">
    <div className="flex items-center justify-between gap-4"><strong>应用更新</strong><button aria-label="收起更新面板" onClick={() => setExpanded(false)} className={hasUpdate ? 'hidden' : 'text-gray-500'}>×</button></div>
    <p className="mt-2">{text}</p>
    <p className="mt-1 text-xs text-gray-500">当前版本 {state.currentVersion}</p>
    {state.permissionRequired && <p className="mt-2 text-xs">允许安装应用后，返回这里点击安装。</p>}
    {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    {state.state === 'downloaded' && <button onClick={() => act('install')} className="mt-3 rounded-full bg-pink-400 px-4 py-2 text-white">{Capacitor.getPlatform() === 'android' ? '安装更新' : '重启并更新'}</button>}
    {state.state === 'available' && <button onClick={() => act('download')} className="mt-3 rounded-full bg-pink-400 px-4 py-2 text-white">下载更新</button>}
    {!hasUpdate && state.state !== 'checking' && <button onClick={() => act('check')} className="mt-3 rounded-full border border-black/10 px-4 py-2">检查更新</button>}
  </div>;
}
