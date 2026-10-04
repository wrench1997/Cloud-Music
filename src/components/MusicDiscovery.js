import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { discoveryMoods, formatDiscoveryDuration, platformSearchLink, rankDiscoveryResults, recommendationSeeds } from '../lib/music-discovery';
import { parsePlaylistLink } from '../lib/online-playlists';
import styles from './MusicDiscovery.module.css';

export default function MusicDiscovery({ taste = {}, playlists = [], available, canDownload, onSearch, onInspectSpotify, onDownload, onChooseSpotifyTrack }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searchedQuery, setSearchedQuery] = useState('');
  const [seed, setSeed] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState({});
  const [hideKnown, setHideKnown] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [spotifyLink, setSpotifyLink] = useState('');
  const [spotifyTracks, setSpotifyTracks] = useState([]);
  const [spotifyTitle, setSpotifyTitle] = useState('');
  const [spotifyNotice, setSpotifyNotice] = useState('');
  const requestSequence = useRef(0);
  const seedIndex = useRef(0);
  const alive = useRef(true);
  useEffect(() => { const sequence = requestSequence; alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
  const seeds = useMemo(() => recommendationSeeds(taste), [taste]);
  const visible = useMemo(() => rankDiscoveryResults(results, { songs: taste.songs, seed, hideKnown }), [results, taste.songs, seed, hideKnown]);
  const selectedTracks = visible.filter((entry) => selected[entry.url]);

  const search = async (value, nextSeed = null, nextPage = 1) => {
    const nextQuery = value.trim();
    if (!available || !nextQuery) return;
    const sequence = ++requestSequence.current;
    setBusy(true); setError(''); setPreview(null);
    try {
      const result = await onSearch({ query: nextQuery, page: nextPage, limit: 12 });
      if (!alive.current || sequence !== requestSequence.current) return;
      setResults(result.entries); setSearchedQuery(nextQuery); setQuery(nextQuery); setSeed(nextSeed);
      setPage(nextPage); setHasMore(result.hasMore); setSelected({});
    } catch (requestError) { if (alive.current && sequence === requestSequence.current) setError(`找歌失败：${requestError.message}`); }
    finally { if (alive.current && sequence === requestSequence.current) setBusy(false); }
  };
  const findForMe = () => {
    const choices = seeds.length ? seeds : discoveryMoods;
    const next = choices[seedIndex.current++ % choices.length];
    search(next.query, next);
  };
  const inspectSpotify = async (url) => {
    if (!available) return;
    setBusy(true); setError('');
    try {
      const parsed = parsePlaylistLink(url);
      if (parsed.provider !== 'spotify') throw new Error('此处请使用 Spotify 公开歌单链接；YouTube 歌单可在“下载并保存”导入。');
      const result = await onInspectSpotify(parsed.url);
      if (!alive.current) return;
      setSpotifyLink(parsed.url); setSpotifyTracks(result.entries); setSpotifyTitle(result.title); setSpotifyNotice(result.notice || '');
    } catch (requestError) { if (alive.current) setError(`读取 Spotify 歌单失败：${requestError.message}`); }
    finally { if (alive.current) setBusy(false); }
  };
  const download = async (tracks) => {
    setBusy(true); setError('');
    try { await onDownload(tracks); }
    catch (requestError) { if (alive.current) setError(`无法开始下载：${requestError.message}`); }
    finally { if (alive.current) setBusy(false); }
  };
  return <section className={styles.discovery} aria-label="发现音乐">
    <div className={styles.hero}><span className={styles.sparkle} aria-hidden="true">✦</span><div><span className={styles.eyebrow}>找下一首喜欢的歌</span><h2>发现音乐</h2><p>从你收藏、最近听过的歌手出发，探索真实搜索结果，再下载到曲库。</p></div><button className="red-button" disabled={!available || busy} onClick={findForMe}>{searchedQuery ? '换一批推荐' : '为我找歌'}</button></div>
    <div className={styles.seedHeader}><h3>{seeds.length ? '从你的音乐口味出发' : '先挑一种氛围'}</h3><span>{seeds.length ? '收藏与最近播放会影响推荐' : '收藏、听歌后会生成专属歌手推荐'}</span></div>
    <div className={styles.seeds}>{(seeds.length ? seeds : discoveryMoods).map((item) => <button key={item.key} disabled={!available || busy} title={item.reason} aria-pressed={seed?.key === item.key} onClick={() => search(item.query, item)}><b>{item.label}</b><small>{item.reason}</small></button>)}</div>
    <form className={styles.searchForm} onSubmit={(event) => { event.preventDefault(); search(query); }}><label htmlFor="discovery-query">歌名、歌手或关键词<input id="discovery-query" value={query} maxLength={300} onChange={(event) => setQuery(event.target.value)} placeholder="例如：Kesha、周杰伦、夏天的音乐" /></label><button className="red-button" disabled={!available || busy || !query.trim()}>{busy ? '正在找歌…' : '搜索 YouTube'}</button></form>
    <div className={styles.platformLinks}><a href={platformSearchLink('spotify', query || seed?.label || '音乐')} target="_blank" rel="noopener noreferrer">去 Spotify 找歌 ↗</a><a href={platformSearchLink('youtube', query || seed?.label || '音乐')} target="_blank" rel="noopener noreferrer">去 YouTube Music 找歌 ↗</a></div>
    {!available && <p className={styles.connectionHint} role="status">先连接下方下载服务，就可以在这里搜索并下载。平台搜索链接仍可直接打开。</p>}
    {error && <p className="login-error" role="alert">{error}</p>}
    {searchedQuery && <div className={styles.results}>
      <div className={styles.resultHeader}><div><h3>{seed ? '为你探索的歌曲' : '搜索结果'} <small>· YouTube</small></h3><p>{seed?.reason || `搜索“${searchedQuery}”`} · 第 {page} 页</p></div><label><input type="checkbox" checked={hideKnown} onChange={(event) => setHideKnown(event.target.checked)} /> 只看未入库</label></div>
      <p className={styles.sourceHint}>结果来自 YouTube；频道名不一定是歌手，下载时会再读取音源信息。请先核对歌曲版本。</p>
      {visible.length === 0 && <p className={styles.empty}>这一页没有新的可用结果，可以换关键词、关闭“只看未入库”或翻页。</p>}
      {visible.map((entry) => <article className={styles.track} key={entry.url}>
        <label className={styles.trackChoice}><input type="checkbox" checked={Boolean(selected[entry.url])} onChange={(event) => setSelected((value) => ({ ...value, [entry.url]: event.target.checked }))} aria-label={`选择 ${entry.title}`} /><span className={styles.cover}>{entry.coverUrl ? <Image src={entry.coverUrl} width={70} height={70} unoptimized alt="" loading="lazy" referrerPolicy="no-referrer" /> : '♫'}</span><span className={styles.trackText}><b>{entry.title}</b><small>{entry.artistIsChannel ? '频道：' : ''}{entry.artist || '歌手待确认'} · {formatDiscoveryDuration(entry.duration)}</small><small className={styles.reason}>{entry.reason}{entry.inLibrary ? ' · 已在曲库' : ''}</small></span></label>
        <div className={styles.trackActions}><button type="button" className="outline-button" onClick={() => setPreview(entry)}>试听</button><button type="button" className="outline-button" disabled={busy || !canDownload} onClick={() => download([entry])}>下载 MP3</button></div>
      </article>)}
      {preview && <div className={styles.preview}><div><b>试听：{preview.title}</b><button type="button" onClick={() => setPreview(null)} aria-label="关闭试听">×</button></div><iframe src={`https://www.youtube.com/embed/${new URL(preview.url).searchParams.get('v')}?playsinline=1&rel=0`} title={`${preview.title} YouTube 试听`} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /></div>}
      <div className={styles.downloadBar}><span>已选 {selectedTracks.length} 首</span><button className="red-button" disabled={!selectedTracks.length || busy || !canDownload} onClick={() => download(selectedTracks)}>下载所选 MP3</button></div>
      <div className={styles.pagination}><button className="outline-button" disabled={page <= 1 || busy} onClick={() => search(searchedQuery, seed, page - 1)}>上一页</button><span>第 {page} 页</span><button className="outline-button" disabled={!hasMore || busy} onClick={() => search(searchedQuery, seed, page + 1)}>下一页</button></div>
    </div>}
    <div className={styles.spotify}><h3>从 Spotify 歌单找歌</h3><p>查看公开歌单曲目，选择一首再查找可下载的 YouTube 音源。Spotify 原平台可以直接打开试听。</p><form className={styles.searchForm} onSubmit={(event) => { event.preventDefault(); inspectSpotify(spotifyLink); }}><label htmlFor="discovery-spotify-link">Spotify 公开歌单链接<input id="discovery-spotify-link" type="url" value={spotifyLink} maxLength={2048} placeholder="https://open.spotify.com/playlist/…" onChange={(event) => setSpotifyLink(event.target.value)} /></label><button className="outline-button" disabled={!available || busy || !spotifyLink.trim()}>查看曲目</button></form>
      {playlists.filter((item) => item.provider === 'spotify').length > 0 && <div className={styles.savedPlaylists}>{playlists.filter((item) => item.provider === 'spotify').map((item) => <button className="outline-button" key={item.key} disabled={!available || busy} onClick={() => inspectSpotify(item.url)}>{item.name}</button>)}</div>}
      {spotifyTitle && <><h4>{spotifyTitle} · {spotifyTracks.length} 首</h4><p className={styles.sourceHint}>{spotifyNotice}</p><div className={styles.spotifyTracks}>{spotifyTracks.map((track, index) => <div key={`${track.spotifyId || track.title}:${index}`}><span><b>{track.title}</b><small>{track.artist} · {formatDiscoveryDuration(track.duration)}</small></span><div>{track.spotifyId && <a href={`https://open.spotify.com/track/${track.spotifyId}`} target="_blank" rel="noopener noreferrer">Spotify 试听 ↗</a>}<button className="outline-button" disabled={busy || !canDownload} onClick={() => onChooseSpotifyTrack(track)}>查找下载音源</button></div></div>)}</div></>}
    </div>
    <p className={styles.privacy}>推荐在本机根据曲库、收藏与最近播放生成；搜索时仅发送你选择的关键词。这里的推荐不读取 Spotify 或 YouTube 账号历史。</p>
  </section>;
}
