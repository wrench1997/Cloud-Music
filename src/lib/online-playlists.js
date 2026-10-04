export const STORAGE_KEY = 'yungan-online-playlists:v1';
export const MAX_PLAYLISTS = 100;

export function parsePlaylistLink(input) {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('请粘贴完整的歌单分享链接。');
  const text = input.trim();
  let url;
  try { url = new URL(text); } catch { throw new Error('链接格式不正确，请复制完整的歌单链接。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('请使用平台官方的 HTTPS 歌单链接。');
  if (url.hostname === 'open.spotify.com') {
    const match = url.pathname.match(/^\/(?:intl-[a-zA-Z-]+\/)?(?:embed\/)?playlist\/([A-Za-z0-9]{22})\/?$/);
    if (!match) throw new Error('请复制 Spotify 歌单链接，不是单曲、专辑或短链接。');
    const id = match[1];
    return { key: `spotify:${id}`, provider: 'spotify', url: `https://open.spotify.com/playlist/${id}`, embedUrl: `https://open.spotify.com/embed/playlist/${id}` };
  }
  if (['music.youtube.com', 'www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) {
    const id = url.searchParams.get('list');
    if (!id || !/^[A-Za-z0-9_-]{10,200}$/.test(id)) throw new Error('没有找到有效的歌单 ID，请在歌单页面复制分享链接。');
    return { key: `youtube:${id}`, provider: 'youtube', url: `https://music.youtube.com/playlist?list=${id}`, embedUrl: `https://www.youtube.com/embed/videoseries?list=${id}&playsinline=1&rel=0` };
  }
  throw new Error('目前支持 Spotify 和 YouTube / YouTube Music 的歌单链接。');
}

export function normalizePlaylists(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, MAX_PLAYLISTS).flatMap((item) => {
    try {
      const parsed = parsePlaylistLink(item?.url);
      if (seen.has(parsed.key)) return [];
      seen.add(parsed.key);
      return [{ ...parsed, name: typeof item.name === 'string' ? item.name.trim().slice(0, 80) || '未命名歌单' : '未命名歌单' }];
    } catch { return []; }
  });
}
