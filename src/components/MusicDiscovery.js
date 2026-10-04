import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { discoveryMoods, formatDiscoveryDuration, platformSearchLink, radioSeeds, rankDiscoveryResults, recommendationSeeds, spotifyCharts, youtubeRadioLink, youtubeVideoId } from '../lib/music-discovery';
import { parsePlaylistLink } from '../lib/online-playlists';
import styles from './MusicDiscovery.module.css';

export default function MusicDiscovery({ taste = {}, playlists = [], available, canDownload, onSearch, onRadio, onMatchTrack, onInspectSpotify, onDownload, onChooseSpotifyTrack, incomingRadio, viewActive = true }) {
  const [view, setView] = useState('radio');
  const [query, setQuery] = useState('');
  const [radioLink, setRadioLink] = useState('');
  const [results, setResults] = useState([]);
  const [context, setContext] = useState(null);
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
  const [spotifyCandidates, setSpotifyCandidates] = useState(null);
  const requestSequence = useRef(0);
  const candidatePanel = useRef(null);
  const previewPanel = useRef(null);
  const resultsPanel = useRef(null);
  const alive = useRef(true);
  const startedIncomingRadio = useRef('');
  useEffect(() => { const sequence = requestSequence; alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
  useEffect(() => { if (spotifyCandidates) { candidatePanel.current?.scrollIntoView({ block: 'nearest' }); candidatePanel.current?.focus({ preventScroll: true }); } }, [spotifyCandidates]);
  useEffect(() => { if (preview) previewPanel.current?.scrollIntoView({ block: 'nearest' }); }, [preview]);
  useEffect(() => { if (context) resultsPanel.current?.scrollIntoView({ block: 'start' }); }, [context, page]);
  const stations = useMemo(() => radioSeeds(taste), [taste]);
  const keywordSeeds = useMemo(() => recommendationSeeds(taste), [taste]);
  const resultSeed = context?.type === 'radio' ? { reason: `YouTube 基于《${context.seed.title}》延伸推荐` } : context?.seed;
  const visible = rankDiscoveryResults(results, { songs: taste.songs, seed: resultSeed, hideKnown, preserveOrder: context?.type === 'radio' });
  const selectedTracks = visible.filter((entry) => selected[entry.url]);
  const showResults = context?.type === view;

  const search = async (value, seed = null, nextPage = 1) => {
    const nextQuery = value.trim();
    if (!available || !nextQuery) return;
    const sequence = ++requestSequence.current;
    setBusy(true); setError(''); setPreview(null);
    try {
      const result = await onSearch({ query: nextQuery, page: nextPage, limit: 12 });
      if (!alive.current || sequence !== requestSequence.current) return;
      setResults(result.entries); setQuery(nextQuery); setContext({ type: 'manual', query: nextQuery, seed });
      setPage(nextPage); setHasMore(result.hasMore); setSelected({}); setView('manual');
    } catch (requestError) { if (alive.current && sequence === requestSequence.current) setError(`搜索失败：${requestError.message}`); }
    finally { if (alive.current && sequence === requestSequence.current) setBusy(false); }
  };
  const startRadio = async (seed, nextPage = 1, radioId) => {
    if (!available || !seed?.videoId) return;
    const sequence = ++requestSequence.current;
    setBusy(true); setError(''); setPreview(null);
    try {
      const result = await onRadio({ videoId: seed.videoId, page: nextPage, limit: 12, ...(radioId ? { radioId } : {}) });
      if (!alive.current || sequence !== requestSequence.current) return;
      const actualSeed = seed.title === '你选择的歌曲' && result.entries.find((entry) => youtubeVideoId(entry.url) === seed.videoId);
      setResults(result.entries); setContext({ type: 'radio', seed: actualSeed ? { ...seed, title: actualSeed.title, artist: actualSeed.artist } : seed, radioId: result.radioId, url: result.url, title: result.title, notice: result.notice });
      setPage(nextPage); setHasMore(result.hasMore); setSelected({}); setView('radio');
    } catch (requestError) { if (alive.current && sequence === requestSequence.current) setError(`电台暂时无法载入：${requestError.message}`); }
    finally { if (alive.current && sequence === requestSequence.current) setBusy(false); }
  };
  const incomingKey = incomingRadio?.videoId ? `${incomingRadio.nonce ?? ''}:${incomingRadio.videoId}` : '';
  useEffect(() => {
    if (!available || !incomingKey || startedIncomingRadio.current === incomingKey) return;
    startedIncomingRadio.current = incomingKey;
    Promise.resolve().then(() => startRadio(incomingRadio));
  }, [available, incomingKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const nextStation = () => {
    if (!stations.length) return;
    const current = stations.findIndex((station) => station.videoId === context?.seed?.videoId);
    startRadio(stations[(current + 1) % stations.length]);
  };
  const inspectSpotify = async (url) => {
    if (!available) return;
    const sequence = ++requestSequence.current;
    setBusy(true); setError(''); setSpotifyCandidates(null);
    try {
      const parsed = parsePlaylistLink(url);
      if (parsed.provider !== 'spotify') throw new Error('此处请使用 Spotify 公开歌单链接；YouTube 歌单可在“下载并保存”导入。');
      const result = await onInspectSpotify(parsed.url);
      if (!alive.current || sequence !== requestSequence.current) return;
      setSpotifyLink(parsed.url); setSpotifyTracks(result.entries); setSpotifyTitle(result.title); setSpotifyNotice(result.notice || '');
    } catch (requestError) { if (alive.current && sequence === requestSequence.current) setError(`读取 Spotify 歌单失败：${requestError.message}`); }
    finally { if (alive.current && sequence === requestSequence.current) setBusy(false); }
  };
  const spotifyRadio = async (track) => {
    if (!available) return;
    const sequence = ++requestSequence.current;
    setBusy(true); setError(''); setSpotifyCandidates(null);
    try {
      const candidates = await onMatchTrack(track);
      if (!alive.current || sequence !== requestSequence.current) return;
      setSpotifyCandidates({ track, candidates });
      if (!candidates.length) setError('未找到可用音源，请换一首歌或在手动找歌里调整关键词。');
    } catch (requestError) { if (alive.current && sequence === requestSequence.current) setError(`查找电台起点失败：${requestError.message}`); }
    finally { if (alive.current && sequence === requestSequence.current) setBusy(false); }
  };
  const download = async (tracks) => {
    setBusy(true); setError('');
    try { await onDownload(tracks); }
    catch (requestError) { if (alive.current) setError(`无法开始下载：${requestError.message}`); }
    finally { if (alive.current) setBusy(false); }
  };
  const changeView = (next) => { setView(next); setPreview(null); setError(''); };
  const changePage = (next) => context.type === 'radio' ? startRadio(context.seed, next, context.radioId) : search(context.query, context.seed, next);

  return <section className={styles.discovery} aria-label="发现音乐">
    <div className={styles.hero}><span className={styles.sparkle} aria-hidden="true">✦</span><div><span className={styles.eyebrow}>听见喜欢的歌，再向外探索</span><h2>下一首，会喜欢什么？</h2><p>从歌曲电台发现相似音乐，或听听 Spotify 榜单正在流行什么。</p></div><button className="red-button" disabled={!available || busy || !stations.length} onClick={nextStation}>{busy ? '正在找歌…' : context?.type === 'radio' ? stations.length > 1 ? '换一首开启电台' : '刷新这个电台' : '开启我的歌曲电台'}</button></div>
    <div className={styles.discoveryTabs} role="group" aria-label="发现方式"><button aria-pressed={view === 'radio'} disabled={busy} onClick={() => changeView('radio')}>歌曲电台</button><button aria-pressed={view === 'charts'} disabled={busy} onClick={() => changeView('charts')}>Spotify 榜单</button><button aria-pressed={view === 'manual'} disabled={busy} onClick={() => changeView('manual')}>手动找歌</button></div>
    {!available && <p className={styles.connectionHint} role="status">正在准备找歌功能，准备好后即可试听、下载与收藏新的音乐。</p>}
    {view === 'radio' && <>
      <div className={styles.seedHeader}><h3>选择电台起点</h3><span>从当前歌曲、最近播放和收藏中选一首</span></div>
      {stations.length ? <div className={styles.radioSeeds}>{stations.map((station) => <button key={station.videoId} disabled={!available || busy} aria-pressed={context?.type === 'radio' && context.seed.videoId === station.videoId} onClick={() => startRadio(station)}><span className={styles.cover}>{station.coverUrl ? <Image src={station.coverUrl} width={70} height={70} unoptimized alt="" referrerPolicy="no-referrer" /> : '♫'}</span><span><b>{station.title}</b><small>{station.artist || 'YouTube 音源'}</small><small>{station.reason} · 开启电台</small></span></button>)}</div> : <div className={styles.emptyStart}><span aria-hidden="true">♫</span><div><b>先挑一首喜欢的歌</b><p>从 Spotify 榜单挑歌，或用歌名搜索，就能找到电台起点。</p></div><button className="outline-button" onClick={() => changeView('charts')}>看看 Spotify 榜单</button></div>}
      <form className={styles.radioStart} onSubmit={(event) => {
        event.preventDefault(); const id = youtubeVideoId(radioLink);
        if (!id) { setError('请粘贴 YouTube / YouTube Music 单曲分享链接。'); return; }
        startRadio({ videoId: id, url: `https://www.youtube.com/watch?v=${id}`, title: '你选择的歌曲', reason: '自选电台起点' });
      }}><label htmlFor="discovery-radio-link">用喜欢的单曲开启电台<input id="discovery-radio-link" type="url" maxLength={2048} value={radioLink} onChange={(event) => setRadioLink(event.target.value)} placeholder="https://music.youtube.com/watch?v=…" /></label><button className="outline-button" disabled={!available || busy || !radioLink.trim()}>开启歌曲电台</button></form>
      <p className={styles.sourceHint}>推荐曲目与顺序由 YouTube 歌曲电台返回，按歌曲延伸到其他歌手。这里使用公开未登录电台，不读取你的平台账号历史。</p>
      {stations[0] && <div className={styles.platformLinks}><a href={youtubeRadioLink(stations[0].url)} target="_blank" rel="noopener noreferrer">在 YouTube Music 打开当前歌曲电台 ↗</a></div>}
    </>}
    {view === 'charts' && <div className={styles.spotify}>
      <h3>Spotify 官方 Top 50</h3><p>全球与地区榜单来自 Spotify 官方公开歌单，点击后实时读取曲目。</p>
      <div className={styles.chartGrid}>{spotifyCharts.map((chart) => <article key={chart.key}><span className={styles.chartBadge}>50</span><div className={styles.chartTitle}><small>SPOTIFY CHARTS</small><h4>{chart.label}</h4><p>{chart.region} · 官方榜单</p></div><div className={styles.chartActions}><button className="outline-button" disabled={!available || busy} onClick={() => inspectSpotify(chart.url)}>读取榜单</button><a href={chart.url} target="_blank" rel="noopener noreferrer">Spotify 打开 ↗</a></div></article>)}</div>
      <div className={styles.platformLinks}><a href="https://charts.spotify.com/home" target="_blank" rel="noopener noreferrer">Spotify Charts 全部榜单 ↗</a></div>
      <h3>也可以读取自己的 Spotify 歌单</h3><form className={styles.searchForm} onSubmit={(event) => { event.preventDefault(); inspectSpotify(spotifyLink); }}><label htmlFor="discovery-spotify-link">Spotify 公开歌单链接<input id="discovery-spotify-link" type="url" value={spotifyLink} maxLength={2048} placeholder="https://open.spotify.com/playlist/…" onChange={(event) => setSpotifyLink(event.target.value)} /></label><button className="outline-button" disabled={!available || busy || !spotifyLink.trim()}>查看曲目</button></form>
      {playlists.some((item) => item.provider === 'spotify') && <div className={styles.savedPlaylists}>{playlists.filter((item) => item.provider === 'spotify').map((item) => <button className="outline-button" key={item.key} disabled={!available || busy} onClick={() => inspectSpotify(item.url)}>{item.name}</button>)}</div>}
      {spotifyCandidates && <div className={styles.spotifyCandidates} ref={candidatePanel} tabIndex={-1}><h4>为《{spotifyCandidates.track.title}》选择电台起点</h4><p>以下为 YouTube 候选视频，请核对版本；Spotify 原曲音频不作为 MP3 音源。</p>{spotifyCandidates.candidates.map((candidate) => <article key={candidate.url}><div><b>{candidate.title}</b><small>{candidate.artist} · {formatDiscoveryDuration(candidate.duration)}</small></div><a href={candidate.url} target="_blank" rel="noopener noreferrer">核对音源 ↗</a><button className="outline-button" disabled={busy} onClick={() => startRadio({ ...candidate, videoId: youtubeVideoId(candidate.url), title: spotifyCandidates.track.title, reason: '从 Spotify 曲目匹配的 YouTube 音源开台' })}>用这首开启电台</button></article>)}</div>}
      {spotifyTitle && <><h4>{spotifyTitle} · {spotifyTracks.length} 首</h4><p className={styles.sourceHint}>{spotifyNotice}</p><div className={styles.spotifyTracks}>{spotifyTracks.map((track, index) => <div key={`${track.spotifyId || track.title}:${index}`}><span><b>{index + 1}. {track.title}</b><small>{track.artist} · {formatDiscoveryDuration(track.duration)}</small></span><div>{track.spotifyId && <a href={`https://open.spotify.com/track/${track.spotifyId}`} target="_blank" rel="noopener noreferrer">Spotify 试听 ↗</a>}<button className="outline-button" disabled={busy || !available} onClick={() => spotifyRadio(track)}>开歌曲电台</button><button className="outline-button" disabled={busy || !canDownload} onClick={() => onChooseSpotifyTrack(track)}>找下载音源</button></div></div>)}</div></>}
    </div>}
    {view === 'manual' && <>
      <div className={styles.seedHeader}><h3>歌名、歌手或关键词搜索</h3><span>手动选择想找的音乐</span></div><div className={styles.seeds}>{(keywordSeeds.length ? keywordSeeds : discoveryMoods).map((item) => <button key={item.key} disabled={!available || busy} title={item.reason} onClick={() => search(item.query, item)}><b>{item.label}</b><small>快捷搜索</small></button>)}</div>
      <form className={styles.searchForm} onSubmit={(event) => { event.preventDefault(); search(query); }}><label htmlFor="discovery-query">关键词<input id="discovery-query" value={query} maxLength={300} onChange={(event) => setQuery(event.target.value)} placeholder="例如：Kesha、周杰伦、夏天的音乐" /></label><button className="red-button" disabled={!available || busy || !query.trim()}>{busy ? '正在找歌…' : '搜索 YouTube'}</button></form><div className={styles.platformLinks}><a href={platformSearchLink('spotify', query || '音乐')} target="_blank" rel="noopener noreferrer">去 Spotify 找歌 ↗</a><a href={platformSearchLink('youtube', query || '音乐')} target="_blank" rel="noopener noreferrer">去 YouTube Music 找歌 ↗</a></div>
    </>}
    {busy && <p role="status">正在读取歌曲或查找音源…</p>}
    {error && <p className="login-error" role="alert">{error}</p>}
    {showResults && <div className={styles.results} ref={resultsPanel}>
      <div className={styles.resultHeader}><div><h3>{context.type === 'radio' ? '歌曲电台推荐' : '搜索结果'} <small>· YouTube</small></h3><p>{context.type === 'radio' ? `由《${context.seed.title}》延伸` : `搜索“${context.query}”`} · 第 {page} 页</p></div><label><input type="checkbox" checked={hideKnown} onChange={(event) => setHideKnown(event.target.checked)} /> 只看未入库</label></div>
      {context.type === 'radio' && <div className={styles.platformLinks}><a href={context.url} target="_blank" rel="noopener noreferrer">在 YouTube Music 继续这个电台 ↗</a></div>}
      <p className={styles.sourceHint}>{context.type === 'radio' ? context.notice : '搜索与音源来自 YouTube。'} 频道名不一定是歌手，下载时会再读取歌曲信息。</p>
      {visible.length === 0 && <p className={styles.empty}>这一页没有新的可用歌曲，可以关闭“只看未入库”、翻页或换一首电台起点。</p>}
      {visible.map((entry) => <article className={styles.track} key={entry.url}>
        <label className={styles.trackChoice}><input type="checkbox" checked={Boolean(selected[entry.url])} onChange={(event) => setSelected((value) => ({ ...value, [entry.url]: event.target.checked }))} aria-label={`选择 ${entry.title}`} /><span className={styles.cover}>{entry.coverUrl ? <Image src={entry.coverUrl} width={70} height={70} unoptimized alt="" loading="lazy" referrerPolicy="no-referrer" /> : '♫'}</span><span className={styles.trackText}><b>{entry.title}</b><small>{entry.artistIsChannel ? '频道：' : ''}{entry.artist || '歌手待确认'} · {formatDiscoveryDuration(entry.duration)}</small><small className={styles.reason}>{entry.reason}{entry.inLibrary ? ' · 已在曲库' : ''}</small></span></label>
        <div className={styles.trackActions}><button type="button" className="outline-button" onClick={() => setPreview(entry)}>试听</button><button type="button" className="outline-button" disabled={busy || !available} onClick={() => startRadio({ ...entry, videoId: youtubeVideoId(entry.url), reason: '从发现歌曲继续探索' })}>接着开台</button><button type="button" className="outline-button" disabled={busy || !canDownload} onClick={() => download([entry])}>下载 MP3</button></div>
        {viewActive && preview?.url === entry.url && <div className={styles.preview} ref={previewPanel}><div><b>试听：{entry.title}</b><button type="button" onClick={() => setPreview(null)} aria-label="关闭试听">×</button></div><iframe src={`https://www.youtube.com/embed/${youtubeVideoId(entry.url)}?playsinline=1&rel=0`} title={`${entry.title} YouTube 试听`} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /></div>}
      </article>)}
      <div className={styles.downloadBar}><span>已选 {selectedTracks.length} 首</span><button className="red-button" disabled={!selectedTracks.length || busy || !canDownload} onClick={() => download(selectedTracks)}>下载所选 MP3</button></div><div className={styles.pagination}><button className="outline-button" disabled={page <= 1 || busy} onClick={() => changePage(page - 1)}>上一页</button><span>第 {page} 页</span><button className="outline-button" disabled={!hasMore || busy} onClick={() => changePage(page + 1)}>下一页</button></div>
    </div>}
    <p className={styles.privacy}>电台曲目来自 YouTube 推荐，榜单曲目来自 Spotify。只向平台发送所选歌曲或关键词，不读取你的平台账号历史。</p>
  </section>;
}
