import styles from './MobileNavigation.module.css';

const paths = {
  library: 'M4 4h6v16H4V4Zm8 0h3v16h-3V4Zm5 1 3-1 4 15-3 1-4-15Z',
  download: 'M11 3h2v10l3-3 1.4 1.4L12 17l-5.4-5.6L8 10l3 3zM4 18h2v2h12v-2h2v4H4z',
  discover: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.5 5.5L14 14l-6.5 2.5L10 10l6.5-2.5ZM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  account: 'M12 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 12c-5 0-8 2.5-8 5v1h16v-1c0-2.5-3-5-8-5Z',
};

function NavigationIcon({ name }) {
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={paths[name]} fillRule="evenodd" /></svg>;
}

export default function MobileNavigation({ active, onLibrary, onPlaylists, onDiscover, onSettings, email, hasUpdate, standalone }) {
  const items = [
    { id: 'library', label: '曲库', icon: 'library', action: onLibrary },
    { id: 'discover', label: '发现', icon: 'discover', action: onDiscover },
    { id: 'playlists', label: '下载', icon: 'download', action: onPlaylists },
    { id: 'settings', label: '我的', icon: 'account', action: onSettings },
  ];
  return <nav className={`${styles.navigation} ${standalone ? styles.standalone : ''}`} aria-label="主要导航">
    {items.map((item) => <button key={item.id} type="button" aria-current={active === item.id ? 'page' : undefined} onClick={item.action} title={item.id === 'settings' && email ? email : item.label}>
      <span className={styles.icon}><NavigationIcon name={item.icon} />{item.id === 'settings' && hasUpdate && <span className={styles.dot} aria-label="有应用更新" />}</span><span>{item.label}</span>
    </button>)}
  </nav>;
}
