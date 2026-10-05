function songActionScopeMatches(captured, current) {
  return Boolean(captured && current
    && captured.generation === current.generation
    && captured.accountId === current.accountId
    && captured.directoryRequest === current.directoryRequest
    && captured.folderId === current.folderId
    && captured.source === current.source);
}

function withoutSong(items, id) {
  return items.filter((item) => item.id !== id);
}

function removeSongFromMusicState(state, id) {
  return {
    ...state,
    favorites: state.favorites.filter((item) => item !== id),
    recent: state.recent.filter((item) => item !== id),
  };
}

function removeSongFromShuffle(shuffle, queue, id) {
  const nextQueue = withoutSong(queue, id);
  const indices = new Map(nextQueue.map((song, index) => [song.id, index]));
  return {
    key: nextQueue.map((song) => song.id).join('|'),
    remaining: shuffle.remaining.map((index) => indices.get(queue[index]?.id)).filter(Number.isInteger),
    history: shuffle.history.filter((songId) => songId !== id),
  };
}

module.exports = { songActionScopeMatches, withoutSong, removeSongFromMusicState, removeSongFromShuffle };
