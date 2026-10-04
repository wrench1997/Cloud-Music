import { useState } from 'react';
import AppUpdates, { useAppUpdates } from './AppUpdates';
import styles from './AppSettings.module.css';

const DEFAULT_NOTICES_URL = 'https://github.com/wrench1997/Cloud-Music/blob/main/THIRD_PARTY_NOTICES.md';

function formatSpace(value) {
  const bytes = Math.max(0, Number(value) || 0);
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

export default function AppSettings({ user, onLogin, onLogout, onBack, syncStatus = '', storageQuota, busy = false, thirdPartyNoticesUrl = DEFAULT_NOTICES_URL }) {
  const { platform } = useAppUpdates();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const accountName = user?.username || user?.name || 'Google Drive';
  return <main className={`settings-page ${styles.page}`}>
    <header className="settings-header"><div><span className="eyebrow">YUNGAN MUSIC</span><h1>我的</h1><p>账号、云端同步与应用更新</p></div><button className="settings-back" onClick={onBack} aria-label="返回曲库">返回曲库</button></header>
    <div className="settings-sections">
      <section className={`settings-card ${styles.accountCard}`} aria-labelledby="settings-account-title">
        <div className="settings-card-heading"><span className="settings-symbol" aria-hidden="true">◎</span><div><h2 id="settings-account-title">云端账号</h2><p>Google Drive 保存你的音乐</p></div></div>
        {user?.email ? <>
          <div className="settings-account"><span className="settings-account-avatar" aria-hidden="true">{(user.username || user.name || user.email).slice(0, 1).toUpperCase()}</span><div><strong>{accountName}</strong><span>{user.email}</span></div><span className="settings-connected">已连接</span></div>
          <div className={styles.syncState} role="status"><span className={styles.connectedDot} /><span>{syncStatus || '账号已记住，下次打开自动恢复连接'}</span></div>
          {storageQuota && <p className="settings-note">Google 空间：已用 {formatSpace(storageQuota.usage)}{storageQuota.limit ? ` / ${formatSpace(storageQuota.limit)}` : ''}</p>}
          <details className={styles.accountOptions}><summary>管理账号</summary><div className="settings-actions"><button className="settings-primary" onClick={onLogin} disabled={busy}>重新连接 Google</button>{onLogout && <button className={styles.signOut} onClick={() => setConfirmLogout(true)} disabled={busy}>退出登录</button>}</div></details>
          {confirmLogout && <div className={styles.confirm} role="alert"><p>退出后本机音乐仍可播放。下次上传云端时需要重新登录。</p><button onClick={() => { setConfirmLogout(false); onLogout?.(); }} disabled={busy}>确认退出</button><button onClick={() => setConfirmLogout(false)}>保留登录</button></div>}
        </> : <><p className="settings-note">{platform === 'android' ? '本机下载和播放可以直接使用。' : '下载的 MP3 可以保存到本机。'}连接 Google 账号后，再将 MP3 保存到自己的云端曲库。</p><button className="settings-primary" onClick={onLogin} disabled={busy}>{busy ? '正在连接…' : '连接 Google Drive'}</button></>}
      </section>
      <AppUpdates />
      <section className="settings-card" aria-labelledby="settings-about-title">
        <div className="settings-card-heading"><span className="settings-symbol" aria-hidden="true">♪</span><div><h2 id="settings-about-title">关于云感音乐</h2><p>从发现到下载，再到自己的音乐库</p></div></div>
        <div className={styles.aboutLinks}><a href={thirdPartyNoticesUrl} target="_blank" rel="noopener noreferrer">开源组件与软件许可 ↗</a><a href="https://github.com/wrench1997/Cloud-Music" target="_blank" rel="noopener noreferrer">项目主页 ↗</a></div>
      </section>
    </div>
  </main>;
}
