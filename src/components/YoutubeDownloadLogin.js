import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { NativeDownloads } from '../lib/native-downloads';
import styles from './PlaylistDownloads.module.css';

export default function YoutubeDownloadLogin({ auth = {}, onChange, blocked, attention, requested = 0 }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const panel = useRef(null);
  const native = Capacitor.isNativePlatform();
  const desktop = typeof window !== 'undefined' && Boolean(window.electronAPI?.downloads?.youtube);
  useEffect(() => { if (attention) { const timer = setTimeout(() => setOpen(true), 0); return () => clearTimeout(timer); } }, [attention]);
  useEffect(() => { if (requested) { const timer = setTimeout(() => { setOpen(true); panel.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 0); return () => clearTimeout(timer); } }, [requested]);
  const act = async (method) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = desktop ? await window.electronAPI.downloads.youtube[method]() : await NativeDownloads[`youtube${method[0].toUpperCase()}${method.slice(1)}`]();
      if (method !== 'open' && result && !result.canceled) {
        onChange(result);
        setNotice(result.configured ? (result.revision === auth.revision ? '登录状态没有变化。如果仍要求验证，请在 YouTube 完成验证后重新导出并接入登录文件。' : '下载登录已接入。现在可以重试失败曲目。') : 'YouTube 下载登录已移除。');
      }
    } catch (failure) { setError(failure.message || '暂时无法接入下载登录，请重试。'); }
    finally { setBusy(false); }
  };
  if (!desktop && !native) return null;
  return <details className={styles.youtubeLogin} ref={panel} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>YouTube 下载登录 <span>{auth.configured ? '已接入登录' : '未接入'}</span></summary>
    <p>{native ? '打开下方的 YouTube 页面，登录并完成验证后点击“完成并接入下载”。在 YouTube App 或外部浏览器登录过的，请导入该浏览器的 YouTube cookies.txt；Google Drive 登录不能用于 YouTube 下载。' : '试听登录不会自动传给下载器。如果在应用内试听时登录过，可直接使用；在外部浏览器登录的，请导入该浏览器导出的 YouTube cookies.txt。'}</p>
    <div className={styles.actions}>
      {native ? <button className="red-button" disabled={busy || blocked} onClick={() => act('signIn')}>{busy ? '正在接入…' : '登录 YouTube 并接入下载'}</button> : <button className="outline-button" disabled={busy || blocked} onClick={() => act('usePreview')}>使用应用内试听登录</button>}
      <button className="outline-button" disabled={busy || blocked} onClick={() => act('importCookies')}>导入浏览器登录文件</button>
      {!native && <button className="config-button" disabled={busy} onClick={() => act('open')}>打开 YouTube 登录 / 验证 ↗</button>}
      {native && auth.configured && <button className="config-button" disabled={busy || blocked} onClick={() => act('usePreview')}>重新接入应用内登录</button>}
      {auth.configured && <button className="config-button" disabled={busy || blocked} onClick={() => act('clear')}>移除下载登录</button>}
    </div>
    {native && <p>若 Google 不允许在此页面登录，可在浏览器完成验证后导入登录文件。接入登录后，具体曲目仍需通过 YouTube 的访问验证。</p>}
    <p><a href="https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies" target="_blank" rel="noopener noreferrer">如何导出 YouTube 登录文件 ↗</a></p>
    <p className={styles.cookiePrivacy}>仅接入 YouTube 网站的登录凭据，加密保存在本机。请勿分享登录文件。</p>
    {blocked && <p>请先等待或取消当前下载，再更改登录。</p>}
    {auth.message && <p role="status">{auth.message}</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p className="login-error" role="alert">{error}</p>}
  </details>;
}
