const test = require('node:test');
const assert = require('node:assert/strict');
const { createGoogleDriveApi, songFromFile, normalizeState, MUSIC_ACCEPT } = require('../src/lib/google-drive');

const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const folder = { id: 'music-folder', name: 'Yungan Music' };
const isFolderQuery = (url) => url.searchParams.get('q')?.includes("mimeType = 'application/vnd.google-apps.folder'");

test('Drive music listing reads every page, excludes state files, and preserves Chinese file names', async () => {
  const requests = [];
  const api = createGoogleDriveApi(async () => 'memory-token', { fetchImpl: async (input, options) => {
    const url = new URL(input);
    requests.push(url);
    assert.equal(options.headers.Authorization, 'Bearer memory-token');
    assert.equal(url.searchParams.has('access_token'), false);
    if (isFolderQuery(url)) return json({ files: [folder] });
    if (url.searchParams.get('pageToken')) return json({ files: [{ id: 'last', name: '歌手 - 完整歌名.FLAC', size: '100' }] });
    return json({ nextPageToken: 'next-page', files: [...Array.from({ length: 1000 }, (_, index) => ({ id: `song-${index}`, name: `Track ${index}.mp3` })), { id: 'state', name: 'library-state.json' }] });
  } });
  const songs = await api.listSongs();
  assert.equal(songs.length, 1001);
  assert.equal(songs.find((song) => song.id === 'last').artist, '歌手');
  assert.equal(songs.find((song) => song.id === 'last').title, '完整歌名');
  assert.equal(requests.length, 3);
  assert.equal(MUSIC_ACCEPT.includes('.webm'), true);
});

test('existing music directories page through folders and audio without creating or changing any file', async () => {
  const calls = [];
  const api = createGoogleDriveApi(async () => 'verified-token', { fetchImpl: async (input, options) => {
    const url = new URL(input);
    calls.push(url);
    assert.equal(options.method, undefined);
    assert.equal(options.headers.Authorization, 'Bearer verified-token');
    assert.equal(url.searchParams.get('q'), "trashed = false and 'existing-music' in parents");
    assert.equal(url.searchParams.get('supportsAllDrives'), 'true');
    assert.equal(url.searchParams.get('includeItemsFromAllDrives'), 'true');
    if (url.searchParams.has('pageToken')) return json({ files: [{ id: 'flac', name: '歌手 - 歌曲.flac', mimeType: 'audio/flac' }] });
    return json({ nextPageToken: 'more', files: [
      { id: 'subfolder', name: '专辑.mp3', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'mp3', name: 'Another.mp3', mimeType: 'audio/mpeg' },
      { id: 'ignored', name: 'Notes.txt', mimeType: 'text/plain' },
    ] });
  } });
  const directory = await api.listDirectory('existing-music');
  assert.deepEqual(directory.folders, [{ id: 'subfolder', name: '专辑.mp3' }]);
  assert.equal(directory.songs.length, 2);
  assert.equal(directory.songs.find((song) => song.id === 'flac').artist, '歌手');
  assert.equal(calls.length, 2);
});

test('saved directories are checked for folder type and trashed status, and unsafe IDs never reach Google', async () => {
  let calls = 0;
  const api = createGoogleDriveApi(async () => 'token', { fetchImpl: async (input) => {
    const url = new URL(input);
    calls += 1;
    assert.equal(url.searchParams.get('supportsAllDrives'), 'true');
    return json({ id: 'deleted-folder', name: '旧目录', mimeType: 'application/vnd.google-apps.folder', trashed: true });
  } });
  await assert.rejects(api.getFolder('deleted-folder'), { status: 404 });
  await assert.rejects(api.listDirectory("x' or trashed = false"), /无效/);
  await assert.rejects(api.getFolder('../other'), /无效/);
  assert.throws(() => api.mediaUrl('song?access_token=secret'), /无效/);
  assert.equal(calls, 1);
  assert.equal(new URL(api.mediaUrl('valid-song')).searchParams.has('access_token'), false);
});

test('concurrent first reads create one app folder and do not create an empty state file', async () => {
  let folderWrites = 0;
  const api = createGoogleDriveApi(async () => 'token', { fetchImpl: async (input, options) => {
    const url = new URL(input);
    if (options.method === 'POST') {
      folderWrites += 1;
      assert.equal(JSON.parse(options.body).properties.yunganMusic, 'library-v1');
      return json(folder);
    }
    return json({ files: [] });
  } });
  const [songs, state] = await Promise.all([api.listSongs(), api.loadState()]);
  assert.deepEqual(songs, []);
  assert.deepEqual(state, { favorites: [], recent: [] });
  assert.equal(folderWrites, 1);
});

test('app uploads and playback state use the current account own folder even with broad directory read access', async () => {
  const api = createGoogleDriveApi(async () => 'token', { fetchImpl: async (input, options) => {
    const url = new URL(input);
    if (isFolderQuery(url)) return json({ files: [url.searchParams.get('q').includes("'me' in owners") ? folder : { id: 'other-account-shared-folder', name: 'Yungan Music' }] });
    if (options.method === 'POST') {
      assert.deepEqual(JSON.parse(options.body).parents, [folder.id]);
      return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=session' } });
    }
    if (options.method === 'PUT') return json({ id: 'uploaded', name: 'Track.mp3' });
    assert.match(url.searchParams.get('q'), /'music-folder' in parents/);
    return json({ files: [] });
  } });
  await api.loadState();
  await api.uploadMusic(new File(['data'], 'Track.mp3'));
});

test('401 retries once using a refreshed token, while 403 never retries or starts an upload', async () => {
  const forces = [];
  let calls = 0;
  const api = createGoogleDriveApi(async ({ force }) => { forces.push(force); return force ? 'new-token' : 'old-token'; }, { fetchImpl: async (url, options) => {
    calls += 1;
    return options.headers.Authorization.endsWith('old-token') ? json({ error: { message: 'expired' } }, 401) : json({ user: { emailAddress: 'test@example.com' } });
  } });
  assert.equal((await api.getAccount()).user.emailAddress, 'test@example.com');
  assert.deepEqual(forces, [false, true]);
  assert.equal(calls, 2);
  calls = 0;
  const denied = createGoogleDriveApi(async () => 'token', { fetchImpl: async () => { calls += 1; return json({ error: { errors: [{ reason: 'accessNotConfigured' }] } }, 403); } });
  await assert.rejects(denied.uploadMusic(new File(['data'], 'song.mp3')), /启用 Google Drive API/);
  assert.equal(calls, 1);
});

test('resumable upload recovers the actual offset after a partially accepted interrupted chunk', async () => {
  const file = new File([new Uint8Array(10 * 1024 * 1024)], '歌手 - 歌曲.mp3', { type: 'audio/mpeg' });
  const ranges = [];
  const progress = [];
  let chunk = 0;
  const api = createGoogleDriveApi(async () => 'token', { fetchImpl: async (input, options) => {
    const url = new URL(input);
    if (isFolderQuery(url)) return json({ files: [folder] });
    if (options.method === 'POST') {
      const metadata = JSON.parse(options.body);
      assert.deepEqual(metadata.parents, ['music-folder']);
      assert.equal(metadata.name, file.name);
      return new Response(null, { status: 200, headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=session' } });
    }
    const range = options.headers['Content-Range'];
    ranges.push(range);
    chunk += 1;
    if (chunk === 1) return new Response(null, { status: 308, headers: { Range: 'bytes=0-8388607' } });
    if (chunk === 2) throw new TypeError('connection interrupted');
    if (chunk === 3) { assert.equal(options.body, null); return new Response(null, { status: 308, headers: { Range: 'bytes=0-9437183' } }); }
    assert.equal(options.body.size, 1024 * 1024);
    return json({ id: 'uploaded-song', name: file.name, mimeType: file.type, size: String(file.size) });
  } });
  const song = await api.uploadMusic(file, { onProgress: (loaded) => progress.push(loaded) });
  assert.deepEqual(ranges, ['bytes 0-8388607/10485760', 'bytes 8388608-10485759/10485760', 'bytes */10485760', 'bytes 9437184-10485759/10485760']);
  assert.deepEqual(progress, [8388608, 9437184, 10485760]);
  assert.equal(song.id, 'uploaded-song');
  assert.equal(song.title, '歌曲');
});

test('an upload that repeatedly fails at the same offset stops after bounded retries', async () => {
  let puts = 0;
  const waits = [];
  const api = createGoogleDriveApi(async () => 'token', {
    sleepImpl: async (ms) => { waits.push(ms); },
    fetchImpl: async (input, options) => {
      if (isFolderQuery(new URL(input))) return json({ files: [folder] });
      if (options.method === 'POST') return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=session' } });
      if (options.headers['Content-Range'].startsWith('bytes */')) return new Response(null, { status: 308 });
      puts += 1;
      throw new TypeError('connection interrupted');
    },
  });
  await assert.rejects(api.uploadMusic(new File(['data'], 'song.mp3')), /connection interrupted/);
  assert.equal(puts, 4);
  assert.deepEqual(waits, [1000, 2000, 4000]);
});

test('cancelled uploads stop without retries and never report completion', async () => {
  const controller = new AbortController();
  let puts = 0;
  const api = createGoogleDriveApi(async () => 'token', { fetchImpl: async (input, options) => {
    const url = new URL(input);
    if (isFolderQuery(url)) return json({ files: [folder] });
    if (options.method === 'POST') return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=session' } });
    puts += 1;
    controller.abort();
    throw controller.signal.reason;
  } });
  await assert.rejects(api.uploadMusic(new File(['music'], 'song.mp3'), { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(puts, 1);
});

test('state writes are ordered, reused on later updates, and contain no account credentials', async () => {
  const states = [];
  const methods = [];
  const api = createGoogleDriveApi(async () => 'private-token', { fetchImpl: async (input, options) => {
    const url = new URL(input);
    if (isFolderQuery(url)) return json({ files: [folder] });
    if (options.method) {
      methods.push(options.method);
      assert.equal(options.body.includes('private-token'), false);
      const value = options.body.split('Content-Type: application/json\r\n\r\n')[1].split('\r\n--')[0];
      states.push(JSON.parse(value));
      return json({ id: 'state-file' });
    }
    return json({ files: [] });
  } });
  await Promise.all([api.saveState({ favorites: ['one'], recent: ['one'] }), api.saveState({ favorites: ['two'], recent: ['two', 'one'], accessToken: 'must-be-excluded' })]);
  assert.deepEqual(methods, ['POST', 'PATCH']);
  assert.deepEqual(states[1], { version: 1, favorites: ['two'], recent: ['two', 'one'] });
});

test('malformed state is bounded and a removed state file loads as an empty library', async () => {
  assert.deepEqual(normalizeState({ favorites: ['one', 'one', null, 2], recent: 'wrong' }), { favorites: ['one'], recent: [] });
  assert.equal(normalizeState({ recent: Array.from({ length: 100 }, (_, index) => String(index)) }).recent.length, 50);
  assert.equal(songFromFile({ id: 'one', name: '完整歌曲名.flac' }).title, '完整歌曲名');
  const api = createGoogleDriveApi(async () => 'token', { fetchImpl: async (input) => {
    const url = new URL(input);
    if (isFolderQuery(url)) return json({ files: [folder] });
    if (url.searchParams.get('alt') === 'media') return json({ error: { message: 'not found' } }, 404);
    return json({ files: [{ id: 'removed-state', name: 'library-state.json' }] });
  } });
  assert.deepEqual(await api.loadState(), { favorites: [], recent: [] });
});
