import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './SongContextMenu.module.css';

export default function SongContextMenu({ context, favorite, canTrash, onClose, onPlay, onViewArtist, onViewAlbum, onFavorite, onSave, onTrash, onCacheSong, onRemoveCacheSong }) {
  const menuRef = useRef(null);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(context.x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(context.y, window.innerHeight - rect.height - 8))}px`;
    menu.style.visibility = 'visible';
    menu.querySelector('button:not(:disabled)')?.focus();
    const close = () => onClose(false);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, [context, onClose]);

  const keyDown = (event) => {
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(true); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...menuRef.current.querySelectorAll('button:not(:disabled)')];
    const current = items.indexOf(document.activeElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[index]?.focus();
  };

  return createPortal(<div className={styles.backdrop} onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(true); }} onContextMenu={(event) => { event.preventDefault(); if (event.target === event.currentTarget) onClose(true); }}>
    <section ref={menuRef} role="menu" aria-label={`${context.song.title || '歌曲'}的操作`} className={styles.menu} style={{ left: context.x, top: context.y, visibility: 'hidden' }} onKeyDown={keyDown}>
      <header><b>{context.song.title || '未知歌曲'}</b><small>{context.song.artist || '未知歌手'}</small></header>
      <button role="menuitem" onClick={onPlay}>播放这首歌</button>
      {onViewArtist && <button role="menuitem" onClick={onViewArtist}>查看歌手与新作品</button>}
      {onViewAlbum && <button role="menuitem" onClick={onViewAlbum}>查看专辑</button>}
      <button role="menuitem" onClick={onFavorite}>{favorite ? '取消收藏' : '收藏这首歌'}</button>
      <button role="menuitem" onClick={onSave}>另存歌曲文件</button>
      {onCacheSong && !context.song.localUri && <button role="menuitem" onClick={() => onCacheSong(context.song)}>保存到本机曲库</button>}
      <div className={styles.divider} />
      {context.song.cacheId && onRemoveCacheSong && <button role="menuitem" className={styles.danger} onClick={() => onRemoveCacheSong(context.song)}>删除本机缓存</button>}
      <button role="menuitem" className={styles.danger} disabled={!canTrash} onClick={onTrash}>移到云盘回收站</button>
      {!canTrash && <p className={styles.hint}>{context.song.localUri ? '本机文件保留在设备中，可使用“另存歌曲文件”。' : '当前目录或账号无法管理这首歌。'}</p>}
    </section>
  </div>, document.body);
}

export function ConfirmSongTrash({ song, email, busy, error, onClose, onConfirm, mode = 'drive' }) {
  const dialogRef = useRef(null);
  const removingCache = mode === 'cache';
  useLayoutEffect(() => { dialogRef.current.querySelector('button')?.focus(); }, []);
  const keyDown = (event) => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const buttons = [...dialogRef.current.querySelectorAll('button:not(:disabled)')];
    if (!buttons.length) { event.preventDefault(); return; }
    const first = buttons[0]; const last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return createPortal(<div className={styles.confirmBackdrop} onPointerDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="trash-song-title" aria-describedby="trash-song-description" aria-busy={busy} className={styles.dialog} onKeyDown={keyDown}>
      <h2 id="trash-song-title">{removingCache ? '删除本机缓存' : '移到云盘回收站？'}</h2>
      <div className={styles.song}><b>{song.title || '未知歌曲'}</b><span>{song.artist || '未知歌手'}</span></div>
      <p id="trash-song-description">{removingCache ? '仅删除这首歌的本机缓存。云盘文件会保留，之后可以重新保存到本机曲库。' : <>这首歌将从 {email} 的云盘曲库移除。可在 Google Drive 回收站中恢复，本机已保存的副本会保留。Google 会在 30 天后清理回收站文件。</>}</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <footer><button disabled={busy} onClick={onClose}>{removingCache ? '保留本机缓存' : '保留歌曲'}</button><button className={styles.confirmButton} disabled={busy} onClick={onConfirm}>{removingCache ? busy ? '正在删除本机缓存…' : '删除本机缓存' : busy ? '正在移入回收站…' : '移到回收站'}</button></footer>
    </section>
  </div>, document.body);
}
