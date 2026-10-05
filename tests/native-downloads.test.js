const test = require('node:test');
const assert = require('node:assert/strict');
const { nativeDownloadRequest, authorizeNativeUpload } = require('../src/lib/native-download-request');
const { nativeCloudConfig } = require('../src/lib/download-job-state');

test('native Spotify matching unwraps a Capacitor object into the existing source selection array', async () => {
  const candidates = [{ title: 'Song', url: 'https://www.youtube.com/watch?v=abcdefghijk' }];
  const track = { title: 'Song', artist: 'Artist', spotifyId: 'spotify-id' };
  const calls = [];
  const result = await nativeDownloadRequest({ request: async (options) => { calls.push(options); return { entries: candidates }; } }, '/match', track);
  assert.deepEqual(result, candidates);
  assert.deepEqual(calls, [{ route: '/match', method: 'POST', data: track }]);
});

test('native task creation passes verified cloud identity without a URL, pairing secret, or access token', async () => {
  const cloud = { enabled: true, accountId: 'verified-account', email: 'music@example.test' };
  const data = { entries: [{ url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Song' }], cloud };
  const created = { id: 'native-job', state: 'queued', files: [], cloud };
  const calls = [];
  const result = await nativeDownloadRequest({ request: async (options) => { calls.push(options); return created; } }, '/jobs', data);
  assert.equal(result, created);
  assert.deepEqual(calls, [{ route: '/jobs', method: 'POST', data }]);
});

test('logged-out native task creation requests only a local download instead of invalid background Google upload', async () => {
  const data = { entries: [{ url: 'https://www.youtube.com/watch?v=abcdefghijk' }], cloud: nativeCloudConfig(true, '', '') };
  let received;
  const created = { id: 'independent-download', state: 'queued', files: [], cloud: data.cloud };
  const plugin = { request: async (options) => { received = options.data; assert.equal(received.cloud.enabled, false); return created; } };
  assert.equal(await nativeDownloadRequest(plugin, '/jobs', data), created);
  assert.deepEqual(received.cloud, { enabled: false, accountId: '', email: '' });
});

test('native bootstrap can return recoverable task errors while a route error rejects before UI can claim success', async () => {
  const status = { ready: true, jobs: [{ id: 'failed-job', state: 'failed', error: '音源不可用' }], error: '' };
  assert.deepEqual(await nativeDownloadRequest({ request: async () => status }, '/status'), status);
  await assert.rejects(nativeDownloadRequest({ request: async () => ({ error: '音源不可用' }) }, '/inspect', { url: 'fixture' }), /音源不可用/);
  await assert.rejects(nativeDownloadRequest({ request: async () => { throw new Error('下载引擎未能准备'); } }, '/status'), /下载引擎未能准备/);
});

test('native cancellation uses DELETE and preserves the job result for a visible cancelled task', async () => {
  const calls = [];
  const cancelled = { id: 'one', state: 'cancelled', files: [{ name: 'complete.mp3' }] };
  assert.equal(await nativeDownloadRequest({ request: async (options) => { calls.push(options); return cancelled; } }, '/jobs/one', null, 'DELETE'), cancelled);
  assert.deepEqual(calls, [{ route: '/jobs/one', method: 'DELETE' }]);
});

test('one explicit authorization action resumes native upload with the newly verified account', async () => {
  const sequence = [];
  const session = { accountId: 'verified-account', email: 'music@example.test', accessToken: 'must-never-cross-download-bridge' };
  const signIn = async (options) => { sequence.push(['signIn', options]); return { connected: true, session }; };
  const request = async (route, data) => { sequence.push(['upload', route, data]); return { id: 'job', cloud: { state: 'pending' } }; };
  assert.equal((await authorizeNativeUpload('job', signIn, request)).cloud.state, 'pending');
  assert.deepEqual(sequence, [
    ['signIn', { interactive: true }],
    ['upload', '/jobs/job/upload', { cloud: { enabled: true, accountId: session.accountId, email: session.email } }],
  ]);
});

test('cancelled or failed Google confirmation never starts or claims a native cloud upload', async () => {
  let uploads = 0;
  const request = async () => { uploads++; return {}; };
  for (const result of [{ cancelled: true }, { connected: true, session: { accountId: 'missing-email' } }, { error: new Error('授权被拒绝') }]) {
    await assert.rejects(authorizeNativeUpload('job', async () => result, request));
  }
  assert.equal(uploads, 0);
});
