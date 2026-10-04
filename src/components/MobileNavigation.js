import { useEffect, useRef } from 'react';
import styles from './MobileNavigation.module.css';

const paths = {
  menu: 'M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z',
  close: 'm6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z',
  library: 'M3 5h7l2 2h9v13H3zm2 2v11h14V9h-7l-2-2z',
  download: 'M11 3h2v10l3-3 1.4 1.4L12 17l-5.4-5.6L8 10l3 3zM4 18h2v2h12v-2h2v4H4z',
  settings: 'M12 2l2.2 3.2 3.8-.3.3 3.8L22 11v2l-3.7 2.3-.3 3.8-3.8-.3L12 22l-2.2-3.2-3.8.3-.3-3.8L2 13v-2l3.7-2.3.3-3.8 3.8.3zm0 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
};

function MenuIcon({ name }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export default function MobileNavigation({ open, onOpen, onClose, active, onLibrary, onPlaylists, onSettings, email, hasUpdate, standalone }) {
  const panel = useRef(null);
  const trigger = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    panel.current?.querySelector('button')?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const buttons = panel.current?.querySelectorAll('button:not(:disabled)');
      if (!buttons?.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); if (previous?.isConnected) previous.focus(); };
  }, [open, onClose]);

  return <>
    <button ref={trigger} className={`${styles.trigger} ${standalone ? styles.standalone : ''}`} onClick={onOpen} aria-label="打开导航菜单" aria-expanded={open} aria-controls="app-navigation">
      <MenuIcon name="menu" />{hasUpdate && <span className={styles.dot} aria-label="有应用更新" />}
    </button>
    {open && <div className={styles.backdrop} onClick={onClose}>
      <aside id="app-navigation" ref={panel} className={styles.drawer} role="dialog" aria-modal="true" aria-label="导航菜单" onClick={(event) => event.stopPropagation()}>
        <header><div className={styles.brand}><span>♪</span><strong>云感音乐</strong></div><button onClick={onClose} aria-label="关闭导航菜单"><MenuIcon name="close" /></button></header>
        <div className={styles.account}><span className={styles.avatar}>{email ? email[0].toUpperCase() : '♪'}</span><div><b>{email ? 'Google Drive 已连接' : '欢迎使用云感音乐'}</b><small>{email || '歌单导入无需登录'}</small></div></div>
        <nav aria-label="应用功能">
          <button aria-current={active === 'library' ? 'page' : undefined} onClick={onLibrary}><MenuIcon name="library" /><span><b>云端曲库</b><small>我的音乐和收藏</small></span></button>
          <button aria-current={active === 'playlists' ? 'page' : undefined} onClick={onPlaylists}><MenuIcon name="download" /><span><b>歌单下载</b><small>Spotify / YouTube Music</small></span></button>
          <button aria-current={active === 'settings' ? 'page' : undefined} onClick={onSettings}><MenuIcon name="settings" /><span><b>设置</b><small>账号 · 应用更新</small></span>{hasUpdate && <em>有更新</em>}</button>
        </nav>
        <p className={styles.footer}>音乐，随时随地。</p>
      </aside>
    </div>}
  </>;
}
