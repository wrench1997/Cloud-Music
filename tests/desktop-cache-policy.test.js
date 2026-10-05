const test = require('node:test');
const assert = require('node:assert/strict');
const { findCachedSong, withCachedSong, offlineQueue } = require('../src/lib/desktop-cache-policy');

const cached = (fileId, account = 'account-a', fields = {}) => ({
  id: `cache:${account}-${fileId}`, cacheId: `${account}-${fileId}`, driveFileId: fileId,
  originalAccount: { id: account, email: `${account}@example.test` },
  localUri: `http://127.0.0.1:4567/music-cache/key/${account}-${fileId}/audio`,
  coverUrl: `http://127.0.0.1:4567/music-cache/key/${account}-${fileId}/cover`,
  title: 'Cached title', artist: 'Cached artist', duration: 123, ...fields,
});

function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}

test('cache lookup isolates identical Drive IDs by verified account and rejects incomplete copies', () => {
  const a = cached('same-file'), b = cached('same-file', 'account-b');
  const library = [b, { ...a, localUri: '' }, { ...a, cacheId: '' }, { ...a, originalAccount: {} }, a];
  assert.equal(findCachedSong(library, { id: 'same-file' }, 'account-a'), a);
  assert.equal(findCachedSong(library, { id: 'same-file' }, 'account-b'), b);
  assert.equal(findCachedSong(library, { id: 'different-file' }, 'account-a'), undefined);
  for (const account of [undefined, null, '', 'unknown-account']) assert.equal(findCachedSong(library, { id: 'same-file' }, account), undefined);
  assert.equal(findCachedSong(null, { id: 'same-file' }, 'account-a'), undefined);
  assert.equal(findCachedSong(library, { id: a.id, driveFileId: 'same-file' }, 'account-a'), a);
});

test('combining a cached copy preserves the cloud ID and fills metadata while using its verified local fields', () => {
  const cloud = freeze({ id: 'drive-song', title: 'Cloud title', artist: '未知歌手', album: '', duration: 0,
    coverUrl: 'https://remote.example/cover.jpg', localUri: 'stale URI', cacheId: 'stale', originalAccount: { id: 'stale' } });
  const copy = freeze(cached('drive-song', 'account-a', { album: 'Cached album', fileName: 'original.mp3', size: 42 }));
  const result = withCachedSong(cloud, copy);
  assert.equal(result.id, 'drive-song'); assert.equal(result.title, 'Cloud title'); assert.equal(result.artist, 'Cached artist');
  assert.equal(result.album, 'Cached album'); assert.equal(result.duration, 123); assert.equal(result.size, 42);
  for (const field of ['localUri', 'coverUrl', 'cacheId', 'driveFileId']) assert.equal(result[field], copy[field]);
  assert.deepEqual(result.originalAccount, copy.originalAccount); assert.notEqual(result.originalAccount, copy.originalAccount);
  assert.equal(cloud.localUri, 'stale URI'); assert.equal(copy.id, 'cache:account-a-drive-song');
  assert.deepEqual(withCachedSong(cloud, cached('other-file')), cloud);
  assert.deepEqual(withCachedSong(cloud, undefined), cloud);
});

test('offline queue keeps current cloud ID, replaces only same-account cached members and removes uncached cloud audio', () => {
  const a1 = cached('first'), a2 = cached('second'), b3 = cached('third', 'account-b');
  const current = { id: 'first', title: 'Current', localUri: a1.localUri, cacheId: a1.cacheId, driveFileId: 'first', originalAccount: a1.originalAccount };
  const local = { id: 'native:device-file', title: 'Downloaded on device', localUri: 'file:///app/audio.mp3' };
  const queue = freeze([{ id: 'first' }, { id: 'second', artist: 'Original artist' }, { id: 'third' }, { id: 'uncached' }, local, { id: 'second' }, a1]);
  const copies = freeze([a1, a2, b3]); freeze(current);
  const result = offlineQueue(queue, current, copies, 'account-a');
  assert.deepEqual(result.map((song) => song.id), ['first', 'second', 'native:device-file']);
  assert.equal(result[0].localUri, current.localUri); assert.equal(result[0].id, 'first');
  assert.equal(result[1].artist, 'Original artist'); assert.equal(result[1].originalAccount.id, 'account-a');
  assert.equal(result[2].localUri, local.localUri);
  assert.equal(queue.length, 7); assert.equal(queue[1].localUri, undefined);
});

test('offline queue retains a playing local track during logout without requiring its old cloud account', () => {
  const current = freeze({ id: 'drive-current', title: 'Playing', localUri: 'local-current', cacheId: 'copy-current', progress: 67.5, duration: 200 });
  const playbackUi = freeze({ progress: 67.5, isPlaying: true, audioSrc: 'local-current' });
  const queue = freeze([{ id: 'drive-current' }, { id: 'not-downloaded' }, { id: 'cache:another', localUri: 'local-another' }]);
  const result = offlineQueue(queue, current, [], undefined);
  assert.deepEqual(result.map((song) => song.id), ['drive-current', 'cache:another']);
  assert.equal(result[0].progress, 67.5); assert.deepEqual(playbackUi, { progress: 67.5, isPlaying: true, audioSrc: 'local-current' });
  assert.equal(current.progress, 67.5);
});

test('missing current queue entry is included once when playable and omitted when no matching cache exists', () => {
  const copy = cached('current');
  assert.deepEqual(offlineQueue([{ id: 'other', localUri: 'local-other' }], { id: 'current' }, [copy], 'account-a').map((song) => song.id), ['current', 'other']);
  assert.deepEqual(offlineQueue([{ id: 'other', localUri: 'local-other' }], { id: 'current' }, [copy], 'account-b').map((song) => song.id), ['other']);
  assert.deepEqual(offlineQueue(null, null, null, null), []);
});
