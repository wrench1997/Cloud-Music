import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { catalogLink } from '../lib/music-catalog';
import { formatDiscoveryDuration, platformSearchLink, youtubeVideoId } from '../lib/music-discovery';
import styles from './NewMusicExplorer.module.css';

function Cover({ item }) {
  return <span className={`${styles.cover} ${item.kind === 'artist' ? styles.artistCover : ''}`}>{item.coverUrl
    ? <Image src={item.coverUrl} alt="" width={160} height={160} unoptimized loading="lazy" referrerPolicy="no-referrer" />
    : <span aria-hidden="true">{item.kind === 'artist' ? item.title?.slice(0, 1) || '♫' : '♫'}</span>}</span>;
}

export default function NewMusicExplorer({ available, canDownload, active, onCatalog, onDownload, onChooseSpotifyTrack, incoming }) {
  const [provider, setProvider] = useState('spotify');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('artists');
  const [link, setLink] = useState('');
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(null);
  const [preview, setPreview] = useState(null);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const initialized = useRef(false);
  const incomingKey = useRef('');
  const actions = useRef({ onCatalog });
  const detailPanel = useRef(null);
  useEffect(() => { actions.current = { onCatalog }; }, [onCatalog]);
  useEffect(() => { mounted.current = true; const requestSequence = sequence; return () => { mounted.current = false; requestSequence.current++; }; }, []);
  useEffect(() => { if (current && current.result.kind !== 'new') detailPanel.current?.scrollIntoView({ block: 'start' }); }, [current]);

  const load = async (options, remember = true) => {
    if (!available) return;
    const request = ++sequence.current;
    setRetry(() => () => load(options, remember));
    setBusy(true); setError(''); setPreview(null);
    try {
      const result = await actions.current.onCatalog(options);
      if (!mounted.current || request !== sequence.current) return;
      if (remember && current) setHistory((items) => [...items, current].slice(-15));
      else if (!remember) setHistory([]);
      setCurrent({ options, result });
    } catch (failure) { if (mounted.current && request === sequence.current) setError(failure.message); }
    finally { if (mounted.current && request === sequence.current) setBusy(false); }
  };
  const open = (item) => load({ provider: item.provider, kind: item.kind, url: item.url });
  useEffect(() => {
    if (!active || !available || initialized.current || incoming) return;
    initialized.current = true;
    Promise.resolve().then(() => load({ provider: 'spotify', kind: 'new' }, false));
  }, [active, available, incoming]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active || !available || !incoming || incomingKey.current === incoming.nonce) return;
    incomingKey.current = incoming.nonce; initialized.current = true;
    if (incoming.url) Promise.resolve().then(() => {
      try { open(catalogLink(incoming.url)); } catch (failure) { setRetry(null); setError(failure.message); }
    });
    else if (incoming.query) Promise.resolve().then(() => { setQuery(incoming.query); setKind(incoming.kind || 'artists'); load({ provider: 'youtube', kind: incoming.kind || 'artists', query: incoming.query }); });
  }, [active, available, incoming]); // eslint-disable-line react-hooks/exhaustive-deps

  const feed = (source) => { setProvider(source); load({ provider: source, kind: 'new' }, false); };
  const back = () => {
    sequence.current++; setBusy(false); setPreview(null); setError(''); setRetry(null);
    setCurrent(history.at(-1)); setHistory((items) => items.slice(0, -1));
  };
  const viewArtist = async (track) => {
    if (track.provider === 'youtube' && track.artistUrl) { open(catalogLink(track.artistUrl)); return; }
    if (track.artists?.length === 1) { open(track.artists[0]); return; }
    if (track.artists?.length > 1) {
      setHistory((items) => [...items, current].slice(-15)); setPreview(null);
      setCurrent({ options: null, result: { provider: 'spotify', title: `《${track.title}》的歌手`, items: track.artists, entries: [], albums: [] } });
      return;
    }
    const request = ++sequence.current;
    setRetry(() => () => viewArtist(track));
    setBusy(true); setError(''); setPreview(null);
    try {
      const result = await actions.current.onCatalog({ provider: 'spotify', kind: 'track', url: track.url });
      if (!mounted.current || request !== sequence.current) return;
      if (!result.artists?.length) throw new Error('暂未读取到歌手链接，可在 Spotify 打开这首歌查看。');
      if (result.artists.length === 1) { await open(result.artists[0]); return; }
      setHistory((items) => [...items, current].slice(-15));
      setCurrent({ options: null, result: { provider: 'spotify', title: `《${track.title}》的歌手`, items: result.artists, entries: [], albums: [] } });
    } catch (failure) { if (mounted.current && request === sequence.current) setError(failure.message); }
    finally { if (mounted.current && request === sequence.current) setBusy(false); }
  };
  const download = async (track) => {
    setRetry(null);
    setBusy(true); setError(''); setPreview(null);
    try { if (track.provider === 'spotify') await onChooseSpotifyTrack(track); else await onDownload([track]); }
    catch (failure) { if (mounted.current) setError(failure.message); }
    finally { if (mounted.current) setBusy(false); }
  };
  const result = current?.result;
  const options = current?.options;
  const collections = result?.albums?.length ? result.albums : result?.items || [];

  return <section className={styles.explorer} aria-label="新歌、歌手与专辑">
    <div className={styles.intro}><span className={styles.badge}>NEW MUSIC</span><h3>去听其他歌手的新作品</h3><p>从当期新歌挑一首，点进歌手，看看最新发行和专辑。</p></div>
    <div className={styles.sources} role="group" aria-label="新歌来源"><button aria-pressed={options?.kind === 'new' && provider === 'spotify'} disabled={busy || !available} onClick={() => feed('spotify')}>Spotify 新歌</button><button aria-pressed={options?.kind === 'new' && provider === 'youtube'} disabled={busy || !available} onClick={() => feed('youtube')}>YouTube 最新上传</button></div>
    <details className={styles.import} open={Boolean(incoming?.query)}><summary>搜索歌手与专辑，或粘贴分享链接</summary>
    <form className={styles.search} onSubmit={(event) => { event.preventDefault(); load({ provider: 'youtube', kind, query: query.trim() }, false); }}>
      <label htmlFor="catalog-query">找一位歌手，或一张专辑<input id="catalog-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入你想探索的歌手或专辑" maxLength={300} /></label>
      <label htmlFor="catalog-kind">搜索类型<select id="catalog-kind" value={kind} onChange={(event) => setKind(event.target.value)}><option value="artists">歌手</option><option value="albums">专辑</option><option value="songs">歌曲</option></select></label>
      <button className="red-button" disabled={busy || !available || !query.trim()}>搜索 YouTube Music</button>
    </form>
    <div className={styles.links}><a href={platformSearchLink('spotify', query.trim() || 'new music')} target="_blank" rel="noopener noreferrer">在 Spotify 搜索{query.trim() ? `“${query.trim()}”` : '歌手与专辑'} ↗</a></div>
    <details className={styles.import}><summary>已有 Spotify / YouTube 分享链接？</summary><form className={styles.search} onSubmit={(event) => { event.preventDefault(); try { open(catalogLink(link.trim())); } catch (failure) { setRetry(null); setError(failure.message); } }}><label htmlFor="catalog-link">歌手、专辑或 Spotify 单曲链接<input id="catalog-link" type="url" value={link} onChange={(event) => setLink(event.target.value)} placeholder="粘贴分享链接，在这里查看最新发行与曲目" maxLength={2048} required /></label><button className="outline-button" disabled={busy || !available || !link.trim()}>打开</button></form></details>
    </details>
    {!available && <p className={styles.notice} role="status">正在连接音乐目录…</p>}
    {busy && <p className={styles.notice} role="status">正在读取歌手、发行或曲目…</p>}
    {error && <div className={styles.error} role="alert"><p>{error}</p>{retry && <button className="outline-button" disabled={busy || !available} onClick={retry}>重试</button>}</div>}
    {result && <div className={styles.results} ref={detailPanel}>
      <div className={styles.resultHeader}>{history.length > 0 && <button className="outline-button" onClick={back}>‹ 返回</button>}<div><small>{result.provider === 'spotify' ? 'Spotify' : 'YouTube Music'}{result.releaseDate ? ` · ${result.releaseDate}` : ''}</small><h3>{result.title}</h3>{result.artist && result.kind === 'album' && <p>{result.artist}</p>}</div>{result.url && <a href={result.url} target="_blank" rel="noopener noreferrer">原平台打开 ↗</a>}</div>
      {result.notice && <p className={styles.notice}>{result.notice}</p>}
      {result.kind === 'artist' && result.provider === 'youtube' && <div className={styles.links}><button className="outline-button" disabled={busy} onClick={() => load({ provider: 'youtube', kind: 'albums', query: result.title })}>找这位歌手的专辑</button><a href={platformSearchLink('spotify', result.title)} target="_blank" rel="noopener noreferrer">在 Spotify 找这位歌手 ↗</a></div>}
      {result.artists?.length > 0 && result.kind === 'album' && <div className={styles.links}>{result.artists.map((artist) => <button className="outline-button" disabled={busy} key={artist.url} onClick={() => open(artist)}>查看歌手 · {artist.title}</button>)}</div>}
      {collections.length > 0 && <div className={styles.grid}>{collections.map((item) => <button key={item.url} className={styles.card} disabled={busy} onClick={() => open(item)}><Cover item={item} /><span>{item.latest && <em>最新发行</em>}<b>{item.title}</b><small>{item.kind === 'artist' ? `${item.provider === 'youtube' ? '频道' : '歌手'}${item.verified ? ' · 已验证' : ''}` : `${item.releaseType || '专辑'}${item.releaseDate ? ` · ${item.releaseDate}` : ''}`}</small>{item.kind === 'album' && item.artist && <small>{item.artist}</small>}</span></button>)}</div>}
      {result.entries?.map((track, index) => <article className={styles.track} key={track.url}>
        <span className={styles.number}>{(options?.kind === 'new' ? ((options.page || 1) - 1) * 12 : 0) + index + 1}</span><Cover item={track} />
        <div className={styles.trackText}><b>{track.title}</b><small>{track.artistIsChannel ? '频道：' : ''}{track.artist || '歌手待确认'} · {formatDiscoveryDuration(track.duration)}{track.releaseDate ? ` · 发行 ${track.releaseDate}` : track.uploadedAt ? ` · 上传${track.uploadDateApproximate ? '约' : ''} ${track.uploadedAt}` : ''}</small></div>
        <div className={styles.trackActions}><button className="outline-button" onClick={() => setPreview(track)}>试听</button><button className="outline-button" disabled={busy || !available || (track.provider === 'youtube' && (!track.artistUrl || (result.kind === 'artist' && track.artistUrl === result.url)))} onClick={() => viewArtist(track)}>查看歌手</button><button className="outline-button" disabled={busy || !canDownload} onClick={() => download(track)}>{track.provider === 'spotify' ? '找下载音源' : '下载 MP3'}</button></div>
        {active && preview?.url === track.url && <div className={styles.preview}><div><b>试听 · {track.title}</b><button onClick={() => setPreview(null)} aria-label="关闭新歌试听">×</button></div><iframe src={track.provider === 'spotify' ? `https://open.spotify.com/embed/track/${track.spotifyId}` : `https://www.youtube.com/embed/${youtubeVideoId(track.url)}?playsinline=1&rel=0`} title={`${track.title} ${track.provider} 试听`} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /><a href={track.url} target="_blank" rel="noopener noreferrer">在原平台试听 ↗</a></div>}
      </article>)}
      {!collections.length && !result.entries?.length && <p className={styles.notice}>暂未找到可见内容。可以换个关键词，或在原平台打开查看。</p>}
      {options && options.kind !== 'album' && options.kind !== 'track' && (result.hasMore || options.page > 1) && <div className={styles.pagination}><button className="outline-button" disabled={busy || (options.page || 1) <= 1} onClick={() => load({ ...options, page: options.page - 1 }, false)}>上一页</button><span>第 {options.page || 1} 页</span><button className="outline-button" disabled={busy || !result.hasMore} onClick={() => load({ ...options, page: (options.page || 1) + 1 }, false)}>下一页</button></div>}
    </div>}
  </section>;
}
