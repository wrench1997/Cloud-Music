import AppUpdates, { useAppUpdates } from './AppUpdates';

export default function AppSettings({ user, onLogin, onBack, onOpenPlaylists, busy = false }) {
  const { platform } = useAppUpdates();
  const accountName = user?.username || user?.name || '已连接 Google Drive';
  return <main className="settings-page">
    <header className="settings-header"><div><span className="eyebrow">YUNGAN MUSIC</span><h1>设置</h1><p>账号、歌单下载和应用更新</p></div><button className="settings-back" onClick={onBack} aria-label="返回上一页">返回</button></header>
    <div className="settings-sections">
      <section className="settings-card" aria-labelledby="settings-account-title">
        <div className="settings-card-heading"><span className="settings-symbol" aria-hidden="true">◎</span><div><h2 id="settings-account-title">Google 账号</h2><p>连接 Google Drive，保存和播放音乐</p></div></div>
        {user?.email ? <div className="settings-account"><span className="settings-account-avatar" aria-hidden="true">{(user.username || user.name || user.email).slice(0, 1).toUpperCase()}</span><div><strong>{accountName}</strong><span>{user.email}</span></div><span className="settings-connected">已连接</span></div> : <><p className="settings-note">登录后可将下载的 MP3 上传到自己的云端曲库。</p><button className="settings-primary" onClick={onLogin} disabled={busy}>{busy ? '正在连接…' : '登录 Google 账号'}</button></>}
      </section>
      <section className="settings-card" aria-labelledby="settings-download-title">
        <div className="settings-card-heading"><span className="settings-symbol" aria-hidden="true">↓</span><div><h2 id="settings-download-title">歌单下载</h2><p>Spotify · YouTube Music</p></div></div>
        <p className="settings-note">粘贴歌单链接，选择歌曲，保存 MP3 并上传到 Google Drive。</p>
        <button className="settings-primary" onClick={onOpenPlaylists}>打开歌单下载 →</button>
        {platform === 'android' && <p className="settings-note settings-service-note">手机目前需要连接电脑下载服务。下载完成后可保存 MP3 到手机，并上传到云端曲库。</p>}
      </section>
      <AppUpdates />
    </div>
  </main>;
}
