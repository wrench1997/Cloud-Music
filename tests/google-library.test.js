const test = require('node:test');
const assert = require('node:assert/strict');
const { openVerifiedGoogleLibrary, locationKey, normalizeFolderPath } = require('../src/lib/google-library');

const account = { user: { emailAddress: 'verified@example.com', displayName: 'Verified', permissionId: 'verified-id' }, storageQuota: { usage: '100' } };
const root = { id: 'root', name: '我的云盘' };
const music = { id: 'music-folder', name: '音乐' };
const directory = { folders: [music], songs: [{ id: 'track', title: '歌曲' }] };
const api = (overrides = {}) => ({
  getAccount: async () => account,
  getFolder: async () => music,
  listDirectory: async () => directory,
  loadState: async () => ({ favorites: [], recent: [] }),
  ...overrides,
});

test('account identity must be verified before reading any cached directory or music', async () => {
  let reads = 0;
  const readLocation = () => { reads += 1; return [root, music]; };
  const listDirectory = async () => { reads += 1; return directory; };
  await assert.rejects(openVerifiedGoogleLibrary(api({ getAccount: async () => ({ user: {} }), listDirectory }), { readLocation }), /无法验证/);
  assert.equal(reads, 0);
  await assert.rejects(openVerifiedGoogleLibrary(api({ getAccount: async () => { throw Object.assign(new Error('Expired'), { status: 401 }); }, listDirectory }), { readLocation }), { status: 401 });
  assert.equal(reads, 0);
});

test('verified accounts restore only their own directory, and refresh its name from Google', async () => {
  const calls = [];
  const result = await openVerifiedGoogleLibrary(api({
    getFolder: async (id) => { calls.push(id); return { ...music, name: '重命名后的音乐目录' }; },
    listDirectory: async (id) => { calls.push(id); return directory; },
  }), { readLocation: (id) => { assert.equal(id, 'verified-id'); return [root, music]; } });
  assert.equal(result.session.email, 'verified@example.com');
  assert.equal(result.path.at(-1).name, '重命名后的音乐目录');
  assert.deepEqual(calls, ['music-folder', 'music-folder']);
  assert.notEqual(locationKey('account-a'), locationKey('account-b'));
  assert.deepEqual(normalizeFolderPath([{ id: 'music-folder', name: 'Untrusted root' }]), [root]);
  assert.deepEqual(normalizeFolderPath([root, { id: "injected' query", name: 'Music' }]), [root]);
});

test('a requested account must match Google before reading directories or touching library state', async () => {
  let reads = 0;
  const instance = api({
    listDirectory: async () => { reads += 1; return directory; },
    loadState: async () => { reads += 1; return {}; },
  });
  await assert.rejects(openVerifiedGoogleLibrary(instance, {
    expectedEmail: 'another@example.com',
    readLocation: () => { reads += 1; return null; },
  }), { code: 'GOOGLE_ACCOUNT_MISMATCH' });
  assert.equal(reads, 0);
  const result = await openVerifiedGoogleLibrary(instance, { expectedEmail: ' Verified@Example.com ' });
  assert.equal(result.session.email, 'verified@example.com');
  assert.equal(reads, 2);
});

test('a deleted or inaccessible saved folder returns to the root, while expired authorization cannot enter', async () => {
  for (const status of [403, 404, 401]) {
    const calls = [];
    const instance = api({
      getFolder: async () => { throw Object.assign(new Error('Unavailable'), { status }); },
      listDirectory: async (id) => { calls.push(id); return directory; },
    });
    const pending = openVerifiedGoogleLibrary(instance, { readLocation: () => [root, music] });
    if (status === 401) { await assert.rejects(pending, { status }); assert.deepEqual(calls, []); }
    else { const result = await pending; assert.deepEqual(result.path, [root]); assert.match(result.notice, /重新选择/); assert.deepEqual(calls, ['root']); }
  }
});

test('full storage or unavailable playback-state sync does not prevent listening to existing music', async () => {
  const result = await openVerifiedGoogleLibrary(api({ loadState: async () => { throw new Error('Google Drive 空间不足'); } }));
  assert.equal(result.directory.songs[0].id, 'track');
  assert.equal(result.remoteState, null);
  assert.match(result.stateError, /空间不足/);
  await assert.rejects(openVerifiedGoogleLibrary(api({ loadState: async () => { throw Object.assign(new Error('Expired'), { code: 'GOOGLE_AUTH_REQUIRED' }); } })), { code: 'GOOGLE_AUTH_REQUIRED' });
});
