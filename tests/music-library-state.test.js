const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cloudMusicState, mergeCloudMusicState } = require('../src/lib/music-library-state');

test('refresh and account changes preserve this device downloads without retaining another cloud account', () => {
  const device = { favorites: ['old-account-song', 'native:task:歌.mp3'], recent: ['native:task:歌.mp3', 'old-account-song'] };
  const remote = { favorites: ['new-account-song'], recent: ['new-account-song'], updatedAt: 17 };
  assert.deepEqual(mergeCloudMusicState(remote, device), {
    favorites: ['new-account-song', 'native:task:歌.mp3'], recent: ['native:task:歌.mp3', 'new-account-song'], updatedAt: 17,
  });
});

test('cloud synchronization excludes local file identities and cannot revive removed local favorites', () => {
  const staleRemote = { favorites: ['native:task:removed.mp3', 'drive-song'], recent: ['native:task:removed.mp3', 'drive-song'] };
  const merged = mergeCloudMusicState(staleRemote, { favorites: [], recent: ['native:task:new.mp3'] });
  assert.deepEqual(merged.favorites, ['drive-song']);
  assert.deepEqual(cloudMusicState(merged), { favorites: ['drive-song'], recent: ['drive-song'] });
  assert.deepEqual(staleRemote.favorites, ['native:task:removed.mp3', 'drive-song']);
});
