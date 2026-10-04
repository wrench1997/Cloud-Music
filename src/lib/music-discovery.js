const clean = (value, limit = 300) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : '';
const normalize = (value) => clean(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const unknown = /^(?:未知歌手|未知艺术家|unknown(?: artist)?|various artists)$/i;

// This is an explainable local affinity score, not either platform's account recommendations.
export function recommendationSeeds({ songs = [], favorites = [], recent = [] } = {}) {
  const favoriteIds = new Set(favorites);
  const recentOrder = new Map(recent.map((id, index) => [id, index]));
  const artists = new Map();
  for (const song of songs) {
    const artist = clean(song.artist, 120);
    if (!artist || unknown.test(artist)) continue;
    const key = normalize(artist);
    const favorite = favoriteIds.has(song.id);
    const position = recentOrder.get(song.id);
    const recentlyPlayed = position !== undefined;
    const weight = 1 + (favorite ? 6 : 0) + (recentlyPlayed ? 4 / (1 + position / 5) : 0);
    const record = artists.get(key) || { artist, score: 0, favorites: 0, recent: 0, count: 0 };
    record.score += weight; record.favorites += Number(favorite); record.recent += Number(recentlyPlayed); record.count++;
    artists.set(key, record);
  }
  return [...artists.values()].sort((a, b) => b.score - a.score || a.artist.localeCompare(b.artist)).slice(0, 8).map((item) => ({
    key: `artist:${normalize(item.artist)}`, label: item.artist, query: `${item.artist} official audio`,
    reason: item.favorites ? `你收藏了 ${item.favorites} 首 ${item.artist} 的歌` : item.recent ? `你最近听过 ${item.artist}` : `你的曲库里有 ${item.count} 首 ${item.artist} 的歌`,
  }));
}

export const discoveryMoods = [
  { key: 'mood:relax', label: '放松一下', query: 'chill music official audio', reason: '按放松氛围探索新歌' },
  { key: 'mood:energy', label: '活力节奏', query: 'dance pop official audio', reason: '按活力节奏探索新歌' },
  { key: 'mood:chinese', label: '华语音乐', query: '华语 新歌 官方 音频', reason: '探索华语歌曲' },
  { key: 'mood:instrumental', label: '纯音乐', query: 'instrumental music official audio', reason: '探索纯音乐' },
];

// IDs were checked against the official Spotify-owned daily chart embed pages.
// Only the chart links are static; the actual tracks are always fetched from Spotify.
export const spotifyCharts = [
  { key: 'global', label: '全球 Top 50', region: '全球热听', url: 'https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2tF' },
  { key: 'hk', label: '香港 Top 50', region: '香港地区', url: 'https://open.spotify.com/playlist/37i9dQZEVXbLwpL8TjsxOG' },
  { key: 'tw', label: '台湾 Top 50', region: '台湾地区', url: 'https://open.spotify.com/playlist/37i9dQZEVXbMnZEatlMSiu' },
];

export function youtubeVideoId(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    let id;
    if (url.hostname === 'youtu.be' && /^\/[\w-]{11}\/?$/.test(url.pathname)) id = url.pathname.split('/')[1];
    else if (['www.youtube.com', 'youtube.com', 'music.youtube.com', 'm.youtube.com'].includes(url.hostname) && url.pathname === '/watch') id = url.searchParams.get('v');
    return /^[\w-]{11}$/.test(id || '') ? id : '';
  } catch { return ''; }
}

export function youtubeRadioLink(value) {
  const id = youtubeVideoId(value);
  return id ? `https://music.youtube.com/watch?v=${id}&list=RDAMVM${id}` : '';
}

export function radioSeeds({ songs = [], favorites = [], recent = [], currentSong, currentQueue = [] } = {}) {
  const all = [...songs, ...currentQueue, ...(currentSong ? [currentSong] : [])].filter(Boolean);
  const byId = new Map(all.map((song) => [song.id, song]));
  const seen = new Set();
  const seeds = [];
  const append = (song, reason) => {
    if (!song) return;
    const url = song.sourceUrl || song.url;
    const id = youtubeVideoId(url);
    if (!id || seen.has(id)) return;
    seen.add(id);
    seeds.push({ videoId: id, url: `https://www.youtube.com/watch?v=${id}`, title: clean(song.title) || 'YouTube 歌曲', artist: clean(song.artist), coverUrl: song.coverUrl || '', reason });
  };
  append(currentSong, '当前歌曲');
  recent.slice(0, 20).forEach((id) => append(byId.get(id), '最近播放'));
  favorites.slice(0, 30).forEach((id) => append(byId.get(id), '你的收藏'));
  currentQueue.forEach((song) => append(song, '当前播放队列'));
  songs.forEach((song) => append(song, '来自你的曲库'));
  return seeds.slice(0, 8);
}

export function platformSearchLink(provider, query) {
  const safeQuery = clean(query, 240);
  if (!safeQuery) return '';
  if (provider === 'spotify') return `https://open.spotify.com/search/${encodeURIComponent(safeQuery)}`;
  return `https://music.youtube.com/search?q=${encodeURIComponent(safeQuery)}`;
}

export function isInLibrary(entry, songs = []) {
  const title = normalize(entry.title);
  const artist = normalize(entry.artist);
  return songs.some((song) => (entry.url && song.sourceUrl === entry.url)
    || (title && artist && normalize(song.title) === title && normalize(song.artist) === artist));
}

export function rankDiscoveryResults(entries, { songs = [], seed, hideKnown = true, preserveOrder = false } = {}) {
  const seen = new Set();
  const artistKey = normalize(seed?.label);
  return (Array.isArray(entries) ? entries : []).flatMap((entry, index) => {
    if (!entry?.url || seen.has(entry.url)) return [];
    seen.add(entry.url);
    const inLibrary = isInLibrary(entry, songs);
    if (hideKnown && inLibrary) return [];
    const text = normalize(`${entry.title} ${entry.artist}`);
    const knownArtist = Boolean(artistKey && text.includes(artistKey));
    const musicLength = Number(entry.duration) >= 45 && Number(entry.duration) <= 900;
    const official = /official|官方/i.test(entry.title || '');
    return [{ ...entry, inLibrary, reason: seed?.reason || '符合你的搜索关键词', affinityScore: (knownArtist ? 4 : 0) + (musicLength ? 2 : 0) + (official ? 1 : 0) + (inLibrary ? 0 : 1), resultOrder: index }];
  }).sort((a, b) => preserveOrder ? a.resultOrder - b.resultOrder : b.affinityScore - a.affinityScore || a.resultOrder - b.resultOrder);
}

export function formatDiscoveryDuration(seconds) {
  if (!(Number(seconds) > 0)) return '时长待确认';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
