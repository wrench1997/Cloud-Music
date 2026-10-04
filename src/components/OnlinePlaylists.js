import { useEffect, useState } from 'react';
import { STORAGE_KEY, MAX_PLAYLISTS, parsePlaylistLink, normalizePlaylists } from '../lib/online-playlists';
import PlaylistDownloads from './PlaylistDownloads';

export default function OnlinePlaylists({ onClose, onUpload, onGoogleLogin }) {
  const [playlists, setPlaylists] = useState([]);
  const [selected, setSelected] = useState(null);
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      try { setPlaylists(normalizePlaylists(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'))); }
      catch { setNotice('无法读取本机保存的歌单，仍可粘贴链接播放。'); }
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!selected || loaded) return undefined;
    const timer = setTimeout(() => setNotice('播放器加载较慢，可重试或打开原平台。请检查网络。'), 15000);
    return () => clearTimeout(timer);
  }, [selected, loaded, retry]);
  const save = (next) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next.map(({ url, name: title }) => ({ url, name: title })))); }
    catch { setNotice('本机存储不可用，本次可以播放，关闭后歌单可能丢失。'); }
    setPlaylists(next);
  };
  const choose = (playlist) => { setSelected(playlist); setLoaded(false); setNotice(''); setRetry((value) => value + 1); };
  const add = (event) => {
    event.preventDefault(); setError(''); setNotice('');
    try {
      const parsed = parsePlaylistLink(link);
      const existing = playlists.find((item) => item.key === parsed.key);
      if (!existing && playlists.length >= MAX_PLAYLISTS) throw new Error(`最多保存 ${MAX_PLAYLISTS} 个歌单，请先移除一个。`);
      const playlist = { ...parsed, name: name.trim().slice(0, 80) || existing?.name || `${parsed.provider === 'spotify' ? 'Spotify' : 'YouTube Music'} 歌单 ${playlists.length + 1}` };
      choose(playlist);
      save(existing ? playlists.map((item) => item.key === parsed.key ? playlist : item) : [playlist, ...playlists]);
      setLink(''); setName('');
    } catch (requestError) { setError(requestError.message); }
  };
  return <main className="online-page">
    <header className="online-header"><div><span className="eyebrow">YUNGAN MUSIC</span><h1>在线歌单</h1></div><button className="outline-button" onClick={onClose}>返回</button></header>
    <p className="online-intro">粘贴 Spotify 或 YouTube Music 歌单分享链接。无需配置 JSON，使用平台播放器选歌、播放和切歌。</p>
    <form className="online-form" onSubmit={add}>
      <label htmlFor="playlist-link">歌单链接<input id="playlist-link" type="url" value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://open.spotify.com/playlist/… 或 https://music.youtube.com/playlist?list=…" required maxLength={2048} /></label>
      <label htmlFor="playlist-name">名称（可选）<input id="playlist-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：通勤音乐" maxLength={80} /></label>
      <button className="red-button" disabled={!ready || !link.trim()}>添加并打开</button>
    </form>
    {error && <p className="login-error" role="alert">{error}</p>}{notice && <p className="setup-message" role="status">{notice}</p>}
    <div className="online-layout">
      <section className="online-saved" aria-label="已保存的歌单"><h2>我的歌单 <small>{playlists.length}</small></h2>
        {!playlists.length && <p className="online-empty">到平台歌单页面，选择“分享 / 复制链接”后添加。</p>}
        {playlists.map((playlist) => <div className={`online-item${selected?.key === playlist.key ? ' selected' : ''}`} key={playlist.key}>
          <button onClick={() => choose(playlist)} aria-pressed={selected?.key === playlist.key}><span className={`provider-dot ${playlist.provider}`} /><span><b>{playlist.name}</b><small>{playlist.provider === 'spotify' ? 'Spotify' : 'YouTube Music'}</small></span></button>
          <button className="online-remove" aria-label={`移除 ${playlist.name}`} onClick={() => { if (selected?.key === playlist.key) setSelected(null); save(playlists.filter((item) => item.key !== playlist.key)); }}>×</button>
        </div>)}<p className="online-local">链接保存在这台设备，不会上传到 Google Drive。</p>
      </section>
      <section className="online-player" aria-label="平台歌单播放器">{selected ? <>
        <header><div><h2>{selected.name}</h2><small>{selected.provider === 'spotify' ? 'Spotify' : 'YouTube Music · YouTube 播放器'}</small></div><button onClick={() => choose(selected)}>重新加载</button></header>
        <iframe key={`${selected.key}:${retry}`} src={selected.embedUrl} title={`${selected.name} 播放器`} className={`online-frame ${selected.provider}`} allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onLoad={() => { setLoaded(true); setNotice(''); }} onError={() => setNotice('播放器无法载入，请重试或打开原平台。')} />
        <p className="online-player-hint">在上方播放器中点击播放。{selected.provider === 'spotify' ? '完整播放或试听由 Spotify 根据账号、地区和设备决定。' : '支持公开或不公开且允许嵌入的内容。私密歌单、部分音乐或自动生成歌单可能无法播放；锁屏和后台播放不保证可用。'}</p>
        <a className="outline-button" href={selected.url} target="_blank" rel="noopener noreferrer">在 {selected.provider === 'spotify' ? 'Spotify' : 'YouTube Music'} 打开 ↗</a>
      </> : <div className="online-empty online-placeholder"><span>♫</span><h2>选择一个歌单开始</h2><p>Spotify 和 YouTube Music，放在同一个入口。</p></div>}</section>
    </div>
    <PlaylistDownloads playlist={selected} onUpload={onUpload} onGoogleLogin={onGoogleLogin} />
  </main>;
}
