import { useEffect, useState } from 'react';
import { STORAGE_KEY, MAX_PLAYLISTS, parsePlaylistLink, normalizePlaylists } from '../lib/online-playlists';
import PlaylistDownloads from './PlaylistDownloads';
import styles from './PlaylistWorkspace.module.css';

export default function OnlinePlaylists({ onClose, onUpload, onRepairUpload, onGoogleLogin, uploadAccount, uploadEmail, taste, initialMode = 'download' }) {
  const [playlists, setPlaylists] = useState([]);
  const [selected, setSelected] = useState(null);
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [mode, setMode] = useState(initialMode === 'discover' ? 'discover' : 'download');
  const [downloadFromDiscovery, setDownloadFromDiscovery] = useState(false);
  const [selectionRevision, setSelectionRevision] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => { if (['discover', 'download', 'playback'].includes(initialMode)) setMode(initialMode); }, 0);
    return () => clearTimeout(timer);
  }, [initialMode]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = normalizePlaylists(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
        setPlaylists(saved); setSelected(saved[0] || null);
      }
      catch { setNotice('无法读取本机保存的歌单，仍可粘贴链接导入。'); }
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (mode !== 'playback' || !selected || loaded) return undefined;
    const timer = setTimeout(() => setNotice('播放器加载较慢，可重试或打开原平台。请检查网络。'), 15000);
    return () => clearTimeout(timer);
  }, [selected, loaded, retry, mode]);
  const save = (next) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next.map(({ url, name: title }) => ({ url, name: title })))); }
    catch { setNotice('本机存储不可用，本次可以播放，关闭后歌单可能丢失。'); }
    setPlaylists(next);
  };
  const choose = (playlist) => { setSelected(playlist); setLoaded(false); setNotice(''); setRetry((value) => value + 1); setSelectionRevision((value) => value + 1); setDownloadFromDiscovery(false); setMode((value) => value === 'discover' ? 'download' : value); };
  const changeMode = (nextMode) => {
    setMode(nextMode); setNotice('');
    if (nextMode === 'playback') { setLoaded(false); setRetry((value) => value + 1); }
  };
  const add = (event) => {
    event.preventDefault(); setError(''); setNotice('');
    try {
      const parsed = parsePlaylistLink(link);
      const existing = playlists.find((item) => item.key === parsed.key);
      if (!existing && playlists.length >= MAX_PLAYLISTS) throw new Error(`最多保存 ${MAX_PLAYLISTS} 个歌单，请先移除一个。`);
      const playlist = { ...parsed, name: name.trim().slice(0, 80) || existing?.name || `${parsed.provider === 'spotify' ? 'Spotify' : 'YouTube Music'} 歌单 ${playlists.length + 1}` };
      choose(playlist); setMode('download');
      save(existing ? playlists.map((item) => item.key === parsed.key ? playlist : item) : [playlist, ...playlists]);
      setLink(''); setName('');
    } catch (requestError) { setError(requestError.message); }
  };
  return <main className="online-page">
    <header className="online-header"><div><span className="eyebrow">YUNGAN MUSIC</span><h1>{mode === 'discover' ? '发现音乐' : '歌单下载'}</h1></div><button className="outline-button" onClick={onClose}>{uploadAccount ? '返回曲库' : '返回'}</button></header>
    <p className="online-intro">搜索喜欢的歌曲，或导入 Spotify / YouTube Music 歌单，下载 MP3 并保存到设备或 Google Drive。</p>
    <div className={styles.modeTabs} role="group" aria-label="歌单功能">
      <button type="button" aria-pressed={mode === 'discover'} onClick={() => changeMode('discover')}>发现音乐</button>
      <button type="button" aria-pressed={mode === 'download'} onClick={() => changeMode('download')}>下载并保存</button>
      <button type="button" aria-pressed={mode === 'playback'} onClick={() => changeMode('playback')}>在线播放</button>
    </div>
    {mode !== 'discover' && <>
    <form className="online-form" onSubmit={add}>
      <label htmlFor="playlist-link">歌单链接<input id="playlist-link" type="url" value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://open.spotify.com/playlist/… 或 https://music.youtube.com/playlist?list=…" required maxLength={2048} /></label>
      <label htmlFor="playlist-name">名称（可选）<input id="playlist-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：通勤音乐" maxLength={80} /></label>
      <button className="red-button" disabled={!ready || !link.trim()}>导入歌单</button>
    </form>
    {error && <p className="login-error" role="alert">{error}</p>}{notice && <p className="setup-message" role="status">{notice}</p>}
    </>}
    <div className={`online-layout ${styles.workspace}`}>
      <section className={`online-saved ${styles.saved}`} aria-label="已保存的歌单"><h2>我的歌单 <small>{playlists.length}</small></h2>
        {!playlists.length && <p className="online-empty">到平台歌单页面，选择“分享 / 复制链接”后添加。</p>}
        {playlists.map((playlist) => <div className={`online-item${selected?.key === playlist.key ? ' selected' : ''}`} key={playlist.key}>
          <button onClick={() => choose(playlist)} aria-pressed={selected?.key === playlist.key}><span className={`provider-dot ${playlist.provider}`} /><span><b>{playlist.name}</b><small>{playlist.provider === 'spotify' ? 'Spotify' : 'YouTube Music'}</small></span></button>
          <button className="online-remove" aria-label={`移除 ${playlist.name}`} onClick={() => { if (selected?.key === playlist.key) setSelected(null); save(playlists.filter((item) => item.key !== playlist.key)); }}>×</button>
        </div>)}<p className="online-local">链接保存在这台设备，不会上传到 Google Drive。</p>
      </section>
      <div className={styles.content}>
      <div className={styles.downloadArea} hidden={mode === 'playback'}>
        {mode === 'download' && selected && !downloadFromDiscovery && <div className={styles.selectedPlaylist}><span className={`provider-dot ${selected.provider}`} /><div><b>{selected.name}</b><small>{selected.provider === 'spotify' ? 'Spotify 歌单' : 'YouTube Music 歌单'}</small></div></div>}
        <PlaylistDownloads playlist={selected} playlistRevision={selectionRevision} onUpload={onUpload} onRepairUpload={onRepairUpload} onGoogleLogin={onGoogleLogin} uploadAccount={uploadAccount} uploadEmail={uploadEmail} onPlayOriginal={() => changeMode('playback')} discoveryMode={mode === 'discover'} taste={taste} playlists={playlists} onShowDownloads={() => { setDownloadFromDiscovery(true); changeMode('download'); }} onShowPlaylist={() => setDownloadFromDiscovery(false)} />
      </div>
      <section className="online-player" aria-label="平台歌单播放器" hidden={mode !== 'playback'}>{mode === 'playback' && selected ? <>
        <header><div><h2>{selected.name}</h2><small>{selected.provider === 'spotify' ? '播放来源：Spotify 原平台' : 'YouTube Music · YouTube 播放器'}</small></div><button onClick={() => choose(selected)}>重新加载</button></header>
        <iframe key={`${selected.key}:${retry}`} src={selected.embedUrl} title={`${selected.name} 播放器`} className={`online-frame ${selected.provider}`} allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onLoad={() => { setLoaded(true); setNotice(''); }} onError={() => setNotice('播放器无法载入，请重试或打开原平台。')} />
        <p className="online-player-hint">在上方播放器中点击播放。{selected.provider === 'spotify' ? '完整播放或试听由 Spotify 根据账号、地区和设备决定。' : '支持公开或不公开且允许嵌入的内容。私密歌单、部分音乐或自动生成歌单可能无法播放；锁屏和后台播放不保证可用。'}</p>
        <a className="outline-button" href={selected.url} target="_blank" rel="noopener noreferrer">在 {selected.provider === 'spotify' ? 'Spotify' : 'YouTube Music'} 打开 ↗</a>
      </> : mode === 'playback' && <div className="online-empty online-placeholder"><span>♫</span><h2>导入或选择一个歌单</h2><p>Spotify 和 YouTube Music，放在同一个入口。</p></div>}</section>
      </div>
    </div>
  </main>;
}
