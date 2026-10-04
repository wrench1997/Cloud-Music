const test = require('node:test');
const assert = require('node:assert/strict');
const { playbackMode, nativePlaybackMode, nextTrackIndex, shuffleBag, seekPosition } = require('../src/lib/playback-policy');

test('sequential playback stops at the end; loops and explicit next continue', () => {
  assert.equal(nextTrackIndex(2, 3, 'order', true), -1);
  assert.equal(nextTrackIndex(2, 3, 'repeat-all', true), 0);
  assert.equal(nextTrackIndex(1, 3, 'repeat-one', true), 1);
  assert.equal(nextTrackIndex(1, 3, 'repeat-one', false), 2);
  assert.equal(nextTrackIndex(0, 0, 'shuffle', true), -1);
});
test('random round contains every other track once and excludes currently playing track', () => {
  for (const random of [() => 0, () => 0.5, () => 0.999]) {
    const bag = shuffleBag(12, 4, random);
    assert.equal(bag.length, 11);
    assert.equal(new Set(bag).size, 11);
    assert.ok(!bag.includes(4));
    assert.deepEqual([...bag].sort((a, b) => a - b), [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11]);
  }
  assert.deepEqual(shuffleBag(1, 0), []);
  assert.deepEqual(shuffleBag(0, 0), []);
});
test('playback mode maps to mutually exclusive native repeat and shuffle flags', () => {
  assert.deepEqual([playbackMode('shuffle').repeat, playbackMode('shuffle').shuffle], [2, true]);
  assert.deepEqual([playbackMode('repeat-one').repeat, playbackMode('repeat-one').shuffle], [1, false]);
  assert.equal(playbackMode('bad-cache').id, 'order');
  assert.equal(nativePlaybackMode(1, true), 'repeat-one');
  assert.equal(nativePlaybackMode(2, true), 'shuffle');
  assert.equal(nativePlaybackMode(2, false), 'repeat-all');
  assert.equal(nativePlaybackMode(0, false), 'order');
});
test('seek clamps negative, past-end, missing and invalid durations', () => {
  assert.equal(seekPosition(104, 208), 104);
  assert.equal(seekPosition(999, 208), 208);
  assert.equal(seekPosition(-5, 208), 0);
  assert.equal(seekPosition(NaN, 208), 0);
  assert.equal(seekPosition(15, 0), 0);
});
