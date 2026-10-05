const nonempty = (value) => typeof value === 'string' && Boolean(value.trim());
const playable = (song) => song && nonempty(song.localUri);
const driveId = (song) => nonempty(song?.driveFileId) ? song.driveFileId : song?.id;
const validCache = (song) => playable(song) && nonempty(song.cacheId) && nonempty(song.driveFileId) && nonempty(song.originalAccount?.id);

function findCachedSong(cachedSongs, song, accountId) {
  if (!nonempty(accountId) || !nonempty(driveId(song)) || !Array.isArray(cachedSongs)) return undefined;
  return cachedSongs.find((cached) => validCache(cached) && cached.driveFileId === driveId(song) && cached.originalAccount.id === accountId);
}

function withCachedSong(song, cached) {
  if (!song || typeof song !== 'object') return song;
  if (!validCache(cached) || driveId(song) !== cached.driveFileId) return { ...song };
  const combined = { ...song };
  for (const field of ['title', 'artist', 'album', 'fileName', 'mimeType', 'sourceUrl']) {
    const missing = !nonempty(combined[field]) || (field === 'artist' && combined[field] === '未知歌手');
    if (missing && nonempty(cached[field])) combined[field] = cached[field];
  }
  for (const field of ['duration', 'size']) {
    if (!(Number(combined[field]) > 0) && Number(cached[field]) > 0) combined[field] = Number(cached[field]);
  }
  return {
    ...combined, id: song.id,
    cacheId: cached.cacheId, localUri: cached.localUri, driveFileId: cached.driveFileId,
    originalAccount: { ...cached.originalAccount }, coverUrl: typeof cached.coverUrl === 'string' ? cached.coverUrl : '',
    hasArtwork: Boolean(cached.coverUrl), cachedAt: cached.cachedAt,
  };
}

function offlineQueue(queue, current, cachedSongs, accountId) {
  const offlineSong = (song) => playable(song) ? { ...song } : withCachedSong(song, findCachedSong(cachedSongs, song, accountId));
  const active = offlineSong(current);
  const activeIsPlayable = playable(active) && nonempty(active.id);
  const pending = Array.isArray(queue) ? queue : [];
  const result = [];
  const ids = new Set();
  for (const entry of pending) {
    const isActive = activeIsPlayable && (entry?.id === active.id || (nonempty(active.cacheId) && entry?.cacheId === active.cacheId));
    const song = isActive ? { ...active } : offlineSong(entry);
    if (!playable(song) || !nonempty(song.id) || ids.has(song.id)) continue;
    ids.add(song.id); result.push(song);
  }
  // Preserve a playable current track even if the queue changed while its cache was being written.
  if (activeIsPlayable && !ids.has(active.id)) result.unshift({ ...active });
  return result;
}

module.exports = { findCachedSong, withCachedSong, offlineQueue };
