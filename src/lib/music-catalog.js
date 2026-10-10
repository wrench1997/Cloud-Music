const NEW_MUSIC_PLAYLIST = '37i9dQZF1DX4JAvHpjipBk';
const clean = (value, max = 300) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';

function catalogLink(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('请使用有效的音乐分享链接。');
  if (/^https:\/\/[^/?#]*:\d+(?:[/?#]|$)/i.test(value)) throw new Error('请使用官方 HTTPS 分享链接。');
  let url;
  try { url = new URL(value); } catch { throw new Error('请粘贴 Spotify 或 YouTube Music 的歌手、专辑链接。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('请使用官方 HTTPS 分享链接。');
  const pathname = decodeURIComponent(url.pathname);
  if (url.hostname === 'open.spotify.com') {
    const match = pathname.match(/^\/(?:intl-[a-zA-Z-]+\/)?(?:embed\/)?(artist|album|track)\/([A-Za-z0-9]{22})\/?$/);
    if (match) return { provider: 'spotify', kind: match[1], id: match[2], url: `https://open.spotify.com/${match[1]}/${match[2]}` };
  }
  if (['music.youtube.com', 'www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)) {
    const artist = pathname.match(/^\/(?:channel\/|browse\/)(UC[\w-]{22})(?:\/(?:videos|releases))?\/?$/);
    const handle = pathname.match(/^\/(@[\p{L}\p{N}_.-]{1,100})(?:\/(?:videos|releases))?\/?$/u);
    if (artist || handle) {
      const path = artist ? `channel/${artist[1]}` : encodeURI(handle[1]);
      return { provider: 'youtube', kind: 'artist', id: artist?.[1] || handle[1], url: `https://www.youtube.com/${path}` };
    }
    const album = pathname.match(/^\/browse\/(MPREb_[\w-]{5,200})\/?$/);
    if (album) return { provider: 'youtube', kind: 'album', id: album[1], url: `https://music.youtube.com/browse/${album[1]}` };
    const list = url.searchParams.get('list');
    if (['/playlist', '/watch'].includes(pathname) && /^[\w-]{10,200}$/.test(list || '')) {
      return { provider: 'youtube', kind: 'album', id: list, url: `https://music.youtube.com/playlist?list=${list}` };
    }
  }
  throw new Error('请使用 Spotify 歌手 / 专辑 / 单曲，或 YouTube Music 歌手 / 专辑链接。');
}

function catalogOptions(value = {}) {
  if (!['spotify', 'youtube'].includes(value.provider)) throw new Error('请选择 Spotify 或 YouTube Music。');
  const page = value.page ?? 1;
  if (!Number.isInteger(page) || page < 1 || page > 5) throw new Error('最多浏览 5 页。');
  if (value.url) {
    const source = catalogLink(value.url);
    if (source.provider !== value.provider || (value.kind && value.kind !== source.kind)) throw new Error('链接与所选平台或内容类型不一致。');
    return { ...source, page, limit: source.kind === 'album' ? 100 : 12,
      requestUrl: source.provider === 'spotify'
        ? `https://open.spotify.com/${source.kind === 'artist' ? '' : 'embed/'}${source.kind}/${source.id}`
        : source.kind === 'artist' ? `${source.url}/videos` : source.url };
  }
  if (value.kind === 'new') {
    if (value.query !== undefined && (typeof value.query !== 'string' || value.query.length > 300 || !clean(value.query))) throw new Error('请输入 1 至 300 个字符的关键词。');
    const query = clean(value.query || 'new music official audio');
    return { provider: value.provider, kind: 'new', page, limit: 12, query,
      url: value.provider === 'spotify' ? `https://open.spotify.com/playlist/${NEW_MUSIC_PLAYLIST}`
        : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=CAISBAgDEAE%3D`,
      requestUrl: value.provider === 'spotify' ? `https://open.spotify.com/embed/playlist/${NEW_MUSIC_PLAYLIST}`
        : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=CAISBAgDEAE%3D` };
  }
  if (value.provider !== 'youtube' || !['artists', 'albums', 'songs'].includes(value.kind)) throw new Error('请粘贴 Spotify 分享链接，或使用 YouTube Music 搜索。');
  if (typeof value.query !== 'string' || value.query.length > 300 || !clean(value.query)) throw new Error('请输入 1 至 300 个字符的歌手或专辑名称。');
  const query = clean(value.query);
  const url = value.kind === 'artists' ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAg%3D%3D`
    : `https://music.youtube.com/search?q=${encodeURIComponent(query)}#${value.kind}`;
  return { provider: 'youtube', kind: value.kind, query, url, requestUrl: url, page, limit: 12 };
}

function catalogCover(images = []) {
  return [...images].sort((a, b) => (b.width || b.maxWidth || 0) - (a.width || a.maxWidth || 0)).map((item) => {
    try {
      const url = new URL(item?.url);
      const allowed = ['i.scdn.co', 'image-cdn-ak.spotifycdn.com', 'image-cdn-fa.spotifycdn.com', 'image-cdn.spotifycdn.com', 'i.ytimg.com', 'i9.ytimg.com', 'img.youtube.com', 'yt3.googleusercontent.com', 'yt3.ggpht.com', 'lh3.googleusercontent.com'];
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && allowed.includes(url.hostname) ? url.href : '';
    } catch { return ''; }
  }).find(Boolean) || '';
}

function spotifyUri(value, kind) {
  return new RegExp(`^spotify:${kind}:([A-Za-z0-9]{22})$`).exec(value || '')?.[1] || '';
}
function spotifyArtists(items = []) {
  return items.map((item) => ({ title: clean(item.name), id: spotifyUri(item.uri, 'artist') }))
    .filter((item) => item.title && item.id).map((item) => ({ ...item, provider: 'spotify', kind: 'artist', url: `https://open.spotify.com/artist/${item.id}` }));
}
function releaseDate(value) {
  const iso = value?.isoString || (typeof value === 'string' ? value : '');
  if (/^\d{4}(?:-\d{2})?(?:-\d{2})?/.test(iso)) return iso.slice(0, 10);
  return value?.year ? [value.year, value.month && String(value.month).padStart(2, '0'), value.day && String(value.day).padStart(2, '0')].filter(Boolean).join('-') : '';
}
function uploadDate(row) {
  const date = clean(row.upload_date);
  if (/^\d{8}$/.test(date)) return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`;
  if (date) return date;
  const timestamp = Number(row.timestamp);
  const value = new Date(timestamp * 1000);
  return timestamp > 0 && Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : '';
}
function spotifyAlbum(item, artist, latest = false) {
  const id = spotifyUri(item?.uri, 'album');
  if (!id) return null;
  return { provider: 'spotify', kind: 'album', id, title: clean(item.name || item.title), artist, url: `https://open.spotify.com/album/${id}`,
    coverUrl: catalogCover(item.coverArt?.sources || []), releaseDate: releaseDate(item.date || item.releaseDate), latest,
    releaseType: item.type === 'SINGLE' ? '单曲 / EP' : item.type === 'COMPILATION' ? '精选集' : '专辑' };
}
function spotifyEntity(html) {
  const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Spotify 暂未返回公开曲目，可重试或在原平台打开。');
  return JSON.parse(match[1]).props?.pageProps?.state?.data?.entity;
}

function parseSpotifyCatalog(options, html) {
  if (typeof html !== 'string' || html.length > 8 * 1024 * 1024) throw new Error('Spotify 页面无效或过大。');
  if (options.kind === 'artist') {
    const match = html.match(/<script[^>]*id=["']initialState["'][^>]*>([\s\S]*?)<\/script>/);
    if (!match) throw new Error('Spotify 暂未返回歌手发行信息，可重试或在原平台打开。');
    const state = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(match[1].trim()), (char) => char.charCodeAt(0))));
    const artist = state.entities?.items?.[`spotify:artist:${options.id}`];
    if (!artist?.profile?.name) throw new Error('Spotify 没有返回这位歌手的公开资料。');
    const discography = artist.discography || {};
    const latest = spotifyAlbum(discography.latest, artist.profile.name, true);
    const albums = [latest, ...['albums', 'singles', 'compilations', 'popularReleasesAlbums'].flatMap((key) => (discography[key]?.items || []).map((item) => spotifyAlbum(item.releases?.items?.[0] || item, artist.profile.name)))].filter(Boolean);
    const seen = new Set();
    const unique = albums.filter((item) => !seen.has(item.id) && seen.add(item.id));
    unique.sort((a, b) => Number(b.latest) - Number(a.latest) || b.releaseDate.localeCompare(a.releaseDate));
    return { provider: 'spotify', kind: 'artist', title: artist.profile.name, url: options.url,
      coverUrl: catalogCover(artist.visuals?.avatarImage?.sources || []), albums: unique, entries: [], hasMore: false,
      notice: 'Spotify 公开歌手页可见的最新发行与专辑；点击发行封面查看曲目。' };
  }
  const entity = spotifyEntity(html);
  const expected = options.kind === 'new' ? `spotify:playlist:${NEW_MUSIC_PLAYLIST}` : `spotify:${options.kind}:${options.id}`;
  if (entity?.uri !== expected) throw new Error('Spotify 返回的内容与分享链接不匹配。');
  const coverUrl = catalogCover([...(entity.coverArt?.sources || []), ...(entity.visualIdentity?.image || [])]);
  const title = clean(entity.title || entity.name);
  const artists = spotifyArtists(entity.artists || entity.authors || []);
  const all = (options.kind === 'track' ? [entity] : entity.trackList || []).slice(0, 100).map((item) => {
    const id = spotifyUri(item.uri, 'track');
    const names = (item.artists || item.authors || []).map((artist) => clean(artist.name)).filter(Boolean).join(', ');
    return { provider: 'spotify', kind: 'track', spotifyId: id, title: clean(item.title || item.name), artist: names || clean(item.subtitle),
      album: options.kind === 'album' ? title : '', duration: Math.max(0, Number(item.duration) || 0) / 1000,
      coverUrl, url: `https://open.spotify.com/track/${id}`, metadataProvider: 'spotify',
      search: `${names || clean(item.subtitle)} ${clean(item.title || item.name)} official audio`.slice(0, 300),
      artists: spotifyArtists(item.artists || item.authors || []), releaseDate: releaseDate(item.releaseDate || entity.releaseDate) };
  }).filter((item) => item.spotifyId && item.title);
  if (!all.length) throw new Error('Spotify 暂未返回可见曲目，可在原平台查看。');
  const start = options.kind === 'new' ? (options.page - 1) * options.limit : 0;
  return { provider: 'spotify', kind: options.kind, title, artist: artists.map((artist) => artist.title).join(', ') || clean(entity.subtitle),
    artists, coverUrl, url: options.url, releaseDate: releaseDate(entity.releaseDate), albums: [],
    entries: all.slice(start, options.kind === 'new' ? start + options.limit : 100),
    hasMore: options.kind === 'new' && options.page < 5 && all.length > start + options.limit,
    notice: options.kind === 'new' ? 'Spotify 官方 New Music Friday 当期精选新歌，保留歌单顺序。'
      : 'Spotify 公开页面可见曲目；试听使用原平台，下载需选择 YouTube 音源。' };
}

function parseYoutubeCatalog(options, data) {
  const rows = (Array.isArray(data?.entries) ? data.entries : []).filter(Boolean);
  const items = [];
  const seen = new Set();
  for (const row of rows) {
    const details = row.catalogDetails || {};
    const coverUrl = catalogCover([...(row.thumbnails || []), ...(details.thumbnails || []), { url: row.thumbnail }]);
    if (['artists', 'albums'].includes(options.kind)) {
      try {
        const source = catalogLink(row.url || row.channel_url);
        if (source.provider !== 'youtube' || source.kind !== (options.kind === 'artists' ? 'artist' : 'album') || seen.has(source.url)) continue;
        seen.add(source.url);
        items.push({ ...source, title: clean(row.title || row.channel || row.uploader || details.title).replace(/^Album - /, '') || '专辑（点击查看曲目）', artist: clean(row.artist || row.uploader || row.channel || details.artist || details.entries?.[0]?.artist || details.entries?.[0]?.channel),
          coverUrl, releaseDate: releaseDate(row.release_year ? String(row.release_year) : ''), verified: Boolean(row.channel_is_verified) });
      } catch { /* Ignore unsupported result types. */ }
    } else {
      if (!/^[\w-]{11}$/.test(row.id || '') || seen.has(row.id)) continue;
      seen.add(row.id);
      const artist = clean(row.artist) || (row.artists || []).map((item) => clean(item)).filter(Boolean).join(', ') || clean(row.channel || row.uploader || data.channel || data.uploader);
      let artistUrl = '';
      try {
        const channel = catalogLink(row.channel_url || row.uploader_url || (options.kind === 'artist' ? options.url : data.channel_url || data.uploader_url));
        if (channel.provider === 'youtube' && channel.kind === 'artist') artistUrl = channel.url;
      } catch {}
      const uploadedAt = uploadDate(row);
      items.push({ provider: 'youtube', kind: 'track', title: clean(row.track || row.title), artist,
        artistIsChannel: !row.artist && !row.artists?.length, artistUrl, album: clean(row.album) || (options.kind === 'album' ? clean(data.title).replace(/^Album - /, '') : ''), duration: Math.max(0, Number(row.duration) || 0),
        coverUrl: coverUrl || `https://i.ytimg.com/vi/${row.id}/hqdefault.jpg`, url: `https://www.youtube.com/watch?v=${row.id}`, metadataProvider: 'youtube',
        uploadedAt, uploadDateApproximate: Boolean(uploadedAt && !clean(row.upload_date)) });
    }
  }
  const tracks = !['artists', 'albums'].includes(options.kind);
  const bounded = items.slice(0, options.limit);
  return { provider: 'youtube', kind: options.kind, title: clean(options.kind === 'artist' ? data?.channel || data?.uploader || data?.title : data?.title) || options.query || 'YouTube Music', url: options.url,
    coverUrl: catalogCover(data?.thumbnails || []), entries: tracks ? bounded : [], items: tracks ? [] : bounded, albums: [],
    hasMore: options.kind !== 'album' && options.page < 5 && items.length > options.limit,
    notice: options.kind === 'new' ? 'YouTube 最近一个月的上传，按上传时间排列；上传时间不代表歌曲首发时间。'
      : options.kind === 'artist' ? '歌手频道最新上传，保留平台顺序；可能包含 MV、现场与旧歌重发。' : '来自 YouTube 歌手频道与 YouTube Music 公开音乐目录。' };
}

function catalogResult(value, payload) {
  const options = catalogOptions(value);
  if (options.provider === 'youtube') return parseYoutubeCatalog(options, payload.data);
  const result = parseSpotifyCatalog(options, payload.html);
  for (const detail of (payload.trackDetails || []).slice(0, 12)) {
    const id = spotifyUri(detail.uri, 'track');
    const entry = result.entries.find((item) => item.spotifyId === id);
    if (!entry) continue;
    try {
      const track = parseSpotifyCatalog(catalogOptions({ provider: 'spotify', kind: 'track', url: entry.url }), detail.html).entries[0];
      Object.assign(entry, { coverUrl: track.coverUrl || entry.coverUrl, artists: track.artists, releaseDate: track.releaseDate });
    } catch { /* A failed artwork lookup must not hide a real new release. */ }
  }
  return result;
}

module.exports = { NEW_MUSIC_PLAYLIST, catalogLink, catalogOptions, catalogResult, parseSpotifyCatalog, parseYoutubeCatalog, catalogCover };
