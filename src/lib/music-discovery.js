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

export function rankDiscoveryResults(entries, { songs = [], seed, hideKnown = true } = {}) {
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
  }).sort((a, b) => b.affinityScore - a.affinityScore || a.resultOrder - b.resultOrder);
}

export function formatDiscoveryDuration(seconds) {
  if (!(Number(seconds) > 0)) return '时长待确认';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
