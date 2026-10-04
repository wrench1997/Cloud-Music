const PLAYBACK_MODES = [
  { id: 'order', label: '顺序播放', repeat: 0, shuffle: false, icon: 'order' },
  { id: 'repeat-all', label: '列表循环', repeat: 2, shuffle: false, icon: 'repeat' },
  { id: 'repeat-one', label: '单曲循环', repeat: 1, shuffle: false, icon: 'repeat' },
  { id: 'shuffle', label: '随机播放', repeat: 2, shuffle: true, icon: 'shuffle' },
];

function playbackMode(id) {
  return PLAYBACK_MODES.find((mode) => mode.id === id) || PLAYBACK_MODES[0];
}

function nativePlaybackMode(repeat, shuffle) {
  if (repeat === 1) return 'repeat-one';
  if (shuffle) return 'shuffle';
  return repeat === 2 ? 'repeat-all' : 'order';
}

function nextTrackIndex(index, length, mode, automatic = false) {
  if (!length) return -1;
  const current = Math.max(0, Math.min(length - 1, index));
  if (automatic && mode === 'repeat-one') return current;
  if (automatic && mode === 'order' && current === length - 1) return -1;
  return (current + 1) % length;
}

// A bag plays each other track once before a new round; unlike independent
// random picks it cannot immediately replay a track or starve part of a queue.
function shuffleBag(length, current, random = Math.random) {
  const bag = Array.from({ length }, (_, index) => index).filter((index) => index !== current);
  for (let index = bag.length - 1; index > 0; index -= 1) {
    const selected = Math.min(index, Math.max(0, Math.floor(random() * (index + 1))));
    [bag[index], bag[selected]] = [bag[selected], bag[index]];
  }
  return bag;
}

function seekPosition(value, duration) {
  const position = Number(value);
  const limit = Number(duration);
  if (!Number.isFinite(position)) return 0;
  return Math.max(0, Math.min(position, Number.isFinite(limit) && limit > 0 ? limit : 0));
}

module.exports = { PLAYBACK_MODES, playbackMode, nativePlaybackMode, nextTrackIndex, shuffleBag, seekPosition };
