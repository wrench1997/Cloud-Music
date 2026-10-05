// The desktop bridge supplies paired capability URLs for app-owned audio and cover files.
// A cloud metadata URL cannot turn this rule into an arbitrary loopback image request.
function desktopCacheArtwork(song) {
  if (!/^[a-f0-9]{64}$/.test(song?.cacheId || '') || (song.id !== `cache:${song.cacheId}` && song.id !== song.driveFileId)) return '';
  try {
    const audio = new URL(song.localUri);
    const cover = new URL(song.coverUrl);
    if (audio.protocol !== 'http:' || audio.hostname !== '127.0.0.1' || !audio.port || audio.username || audio.password || audio.search || audio.hash) return '';
    const match = /^\/music-cache\/([A-Za-z0-9_-]{43})\/([a-f0-9]{64})\/audio$/.exec(audio.pathname);
    if (!match || match[2] !== song.cacheId || cover.origin !== audio.origin || cover.username || cover.password || cover.search || cover.hash) return '';
    return cover.pathname === audio.pathname.replace(/\/audio$/, '/cover') ? cover.href : '';
  } catch { return ''; }
}

module.exports = { desktopCacheArtwork };
