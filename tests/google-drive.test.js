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

function taggedMp3() {
  const sync = (size) => Buffer.from([(size >>> 21) & 127, (size >>> 14) & 127, (size >>> 7) & 127, size & 127]);
  const frame = (id, value) => Buffer.concat([Buffer.from(id), sync(value.length), Buffer.alloc(2), value]);
  const text = (value) => Buffer.concat([Buffer.from([3]), Buffer.from(value), Buffer.from([0])]);
  const cover = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 255, 255, 255]);
  const frames = Buffer.concat([
    frame('TIT2', text('MP3 的曲名')),
    frame('TPE1', text('MP3 的歌手')),
    frame('TALB', text('原始专辑')),
    frame('TLEN', text('180500')),
    frame('APIC', Buffer.concat([Buffer.from([3]), Buffer.from('image/png\0'), Buffer.from([3, 0]), cover])),
  ]);
  return new File([Buffer.from([73, 68, 51, 4, 0, 0]), sync(frames.length), frames, Buffer.alloc(16)], 'old_video_filename.mp3', { type: 'audio/mpeg' });
}

test('music uploads carry original playlist labels and an embedded cover into Drive instead of relying on filenames', async () => {
  let uploadMetadata;
  const api = createGoogleDriveApi(async () => 'token', { fetchImpl: async (input, options) => {
    const url = new URL(input);
    if (isFolderQuery(url)) return json({ files: [folder] });
    if (options.method === 'POST') {
      uploadMetadata = JSON.parse(options.body);
      assert.deepEqual(uploadMetadata.appProperties, {
        title: 'Spotify 曲名 🌙', artist: 'Spotify 歌手', album: '原始专辑', duration: '181',
        coverUrl: 'https://i.scdn.co/image/cover', sourceUrl: 'https://youtu.be/HMJPG2I42xg',
        hasArtwork: '1',
      });
      assert.equal(uploadMetadata.contentHints.thumbnail.mimeType, 'image/png');
      assert.deepEqual(Buffer.from(uploadMetadata.contentHints.thumbnail.image, 'base64url'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 255, 255, 255]));
      assert.match(url.searchParams.get('fields'), /thumbnailLink/);
      return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=tagged' } });
    }
    assert.equal(options.method, 'PUT');
    return json({ id: 'original-track', name: uploadMetadata.name, appProperties: uploadMetadata.appProperties, thumbnailLink: 'https://lh3.googleusercontent.com/thumbnail' });
  } });
  const song = await api.uploadMusic(taggedMp3(), { metadata: { title: 'Spotify 曲名 🌙', artist: 'Spotify 歌手', duration: 181, coverUrl: 'https://i.scdn.co/image/cover', sourceUrl: 'https://youtu.be/HMJPG2I42xg' } });
  assert.equal(song.title, 'Spotify 曲名 🌙');
  assert.equal(song.artist, 'Spotify 歌手');
  assert.equal(song.album, '原始专辑');
  assert.equal(song.duration, 181);
  assert.equal(song.coverUrl, 'https://i.scdn.co/image/cover');
  assert.equal(song.thumbnailLink, 'https://lh3.googleusercontent.com/thumbnail');
  assert.equal(song.hasArtwork, true);
});

test('local MP3 uploads read ID3 labels automatically when no playlist metadata was supplied', async () => {
  const api = createGoogleDriveApi(async () => 'token', { fetchImpl: async (input, options) => {
    if (isFolderQuery(new URL(input))) return json({ files: [folder] });
    if (options.method === 'POST') {
      const metadata = JSON.parse(options.body);
      assert.equal(metadata.appProperties.title, 'MP3 的曲名');
      assert.equal(metadata.appProperties.artist, 'MP3 的歌手');
      assert.equal(metadata.appProperties.duration, '180.5');
      assert.ok(metadata.contentHints.thumbnail.image);
      return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=local' } });
    }
    return json({ id: 'local-tagged', name: 'old_video_filename.mp3' });
  } });
  const song = await api.uploadMusic(taggedMp3());
  assert.equal(song.title, 'MP3 的曲名');
  assert.equal(song.artist, 'MP3 的歌手');
});

test('replacing MP3 content uses resumable PATCH and preserves its Drive ID, location and unrelated metadata', async () => {
  const methods = [];
  const api = createGoogleDriveApi(async () => 'token', { fetchImpl: async (input, options) => {
    const url = new URL(input);
    methods.push(options.method || 'GET');
    if (!options.method) {
      assert.equal(url.pathname, '/drive/v3/files/existing-track');
      return json({ id: 'existing-track', name: 'old.mp3', properties: { preserve: 'public' }, appProperties: { custom: 'keep-me', title: 'Old title' } });
    }
    if (options.method === 'PATCH') {
      assert.equal(url.pathname, '/upload/drive/v3/files/existing-track');
      assert.equal(url.searchParams.get('uploadType'), 'resumable');
      const metadata = JSON.parse(options.body);
      assert.equal(metadata.parents, undefined);
      assert.equal(metadata.appProperties.custom, 'keep-me');
      assert.equal(metadata.appProperties.title, 'New original title');
      assert.equal(metadata.properties.preserve, 'public');
      return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=replace' } });
    }
    return json({ id: 'existing-track', name: 'fixed.mp3' });
  } });
  const result = await api.updateMusic('existing-track', new File(['audio'], 'fixed.mp3'), { metadata: { title: 'New original title', artist: 'Original artist' } });
  assert.equal(result.id, 'existing-track');
  assert.equal(result.title, 'New original title');
  assert.deepEqual(methods, ['GET', 'PATCH', 'PUT']);
});

test('metadata repair patches labels and an optional filename without uploading or replacing the audio', async () => {
  const methods = [];
  const api = createGoogleDriveApi(async () => 'token', { fetchImpl: async (input, options) => {
    const url = new URL(input);
    assert.equal(url.pathname, '/drive/v3/files/old-track');
    assert.equal(url.searchParams.has('uploadType'), false);
    methods.push(options.method || 'GET');
    if (!options.method) return json({ id: 'old-track', name: 'MONTAGEM_GLORIA_Slowed-HMJPG2I42xg.mp3', appProperties: { custom: 'preserved' } });
    assert.equal(options.method, 'PATCH');
    const metadata = JSON.parse(options.body);
    assert.equal(metadata.name, 'Artist - MONTAGEM GLORIA - Slowed.mp3');
    assert.equal(metadata.appProperties.custom, 'preserved');
    assert.equal(metadata.appProperties.title, 'MONTAGEM GLORIA - Slowed');
    return json({ id: 'old-track', ...metadata });
  } });
  const result = await api.updateSongMetadata('old-track', { title: 'MONTAGEM GLORIA - Slowed', artist: 'Artist', coverUrl: 'https://i.scdn.co/image/cover' }, { rename: true });
  assert.equal(result.id, 'old-track');
  assert.equal(result.artist, 'Artist');
  assert.equal(result.title, 'MONTAGEM GLORIA - Slowed');
  assert.deepEqual(methods, ['GET', 'PATCH']);
});

test('filename fallback preserves standalone Slowed variants and removes legacy YouTube IDs without inventing an artist', () => {
  const slowed = songFromFile({ id: 'one', name: 'MONTAGEM GLORIA - Slowed.mp3' });
  assert.equal(slowed.title, 'MONTAGEM GLORIA - Slowed');
  assert.equal(slowed.artist, '未知歌手');
  const artist = songFromFile({ id: 'two', name: 'Artist - Song - Slowed.mp3' });
  assert.equal(artist.title, 'Song - Slowed');
  assert.equal(artist.artist, 'Artist');
  assert.equal(songFromFile({ id: 'three', name: 'MONTAGEM_GLORIA_Slowed-HMJPG2I42xg.mp3' }).title, 'MONTAGEM GLORIA Slowed');
  assert.equal(songFromFile({ id: 'four', name: 'Yb_Wasg_ood_Sayfalse_Ariis_-_LOS_VOLTAJE_Official_Audio-hKIHjiAKqfA.mp3' }).artist, 'Yb Wasg ood Sayfalse Ariis');
  const tagged = songFromFile({ id: 'five', name: 'wrong - source.mp3', appProperties: { title: 'Correct title', artist: 'Correct artist', coverUrl: 'javascript:alert(1)' } });
  assert.equal(tagged.title, 'Correct title');
  assert.equal(tagged.artist, 'Correct artist');
  assert.equal(tagged.coverUrl, '');
});

test('private Drive artwork uses authorization only for allowlisted Google thumbnail hosts and refuses redirects', async () => {
  let tokens = 0;
  const api = createGoogleDriveApi(async () => { tokens += 1; return 'private-token'; }, { fetchImpl: async (url, options) => {
    assert.equal(url, 'https://lh3.googleusercontent.com/private-cover');
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    assert.equal(options.redirect, 'error');
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });
  } });
  await assert.rejects(api.artwork({ id: 'track', thumbnailLink: 'https://example.test/steal-token' }), /不属于 Google Drive/);
  await assert.rejects(api.artwork({ id: 'track', thumbnailLink: 'https://lh3.googleusercontent.com.evil.test/cover' }), /不属于 Google Drive/);
  assert.equal(tokens, 0);
  const image = await api.artwork({ id: 'track', thumbnailLink: 'https://lh3.googleusercontent.com/private-cover' });
  assert.equal(image.type, 'image/png');
  assert.equal(tokens, 1);
});

test('expired thumbnail links are refreshed from Drive file metadata once before fetching the replacement', async () => {
  const requests = [];
  const api = createGoogleDriveApi(async () => 'token', { fetchImpl: async (input) => {
    const url = new URL(input); requests.push(url.href);
    if (url.hostname === 'www.googleapis.com') {
      assert.equal(url.searchParams.get('fields'), 'thumbnailLink');
      return json({ thumbnailLink: 'https://lh3.googleusercontent.com/fresh-cover' });
    }
    if (url.pathname === '/expired') return new Response(null, { status: 403 });
    return new Response(new Uint8Array([255, 216, 255]), { headers: { 'Content-Type': 'image/jpeg' } });
  } });
  assert.equal((await api.artwork({ id: 'track', thumbnailLink: 'https://lh3.googleusercontent.com/expired' })).type, 'image/jpeg');
  assert.equal(requests.length, 3);
});

test('thumbnail CORS failure falls back to two bounded Drive byte ranges for the embedded MP3 cover', async () => {
  const file = taggedMp3();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ranges = [];
  const api = createGoogleDriveApi(async () => 'token', { fetchImpl: async (input, options) => {
    const url = new URL(input);
    if (url.hostname === 'lh3.googleusercontent.com') throw new TypeError('Failed to fetch');
    assert.equal(url.hostname, 'www.googleapis.com');
    assert.equal(url.searchParams.get('alt'), 'media');
    assert.equal(options.headers.Authorization, 'Bearer token');
    const end = Number(/^bytes=0-(\d+)$/.exec(options.headers.Range)[1]);
    ranges.push(end);
    return new Response(bytes.slice(0, end + 1), { status: 206, headers: { 'Content-Length': String(end + 1), 'Content-Type': 'audio/mpeg' } });
  } });
  const cover = await api.artwork({ id: 'tagged', thumbnailLink: 'https://lh3.googleusercontent.com/blocked-by-cors' });
  assert.equal(cover.type, 'image/png');
  assert.deepEqual(Buffer.from(await cover.arrayBuffer()), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 255, 255, 255]));
  assert.equal(ranges[0], 9);
  assert.equal(ranges[1], file.size - 17);
  assert.ok(ranges[1] < file.size - 1, 'the MPEG audio payload was not requested');
});

test('cover extraction does not download a complete song when a media server ignores byte ranges', async () => {
  let cancelled = false;
  const api = createGoogleDriveApi(async () => 'token', { fetchImpl: async (input) => {
    const url = new URL(input);
    if (!url.searchParams.has('alt')) return json({});
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 200 });
  } });
  assert.equal(await api.artwork({ id: 'track' }), null);
  assert.equal(cancelled, true);
});

test('shared artwork requests are cached and one aborted component does not cancel another subscriber', async () => {
  let calls = 0;
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const api = createGoogleDriveApi(async () => 'token', { fetchImpl: async () => {
    calls += 1;
    await wait;
    return new Response(new Uint8Array([255, 216, 255]), { headers: { 'Content-Type': 'image/jpeg' } });
  } });
  const song = { id: 'track', thumbnailLink: 'https://lh3.googleusercontent.com/shared' };
  const controller = new AbortController();
  const first = api.artwork(song, { signal: controller.signal });
  const second = api.artwork(song);
  controller.abort();
  await assert.rejects(first, { name: 'AbortError' });
  release();
  const image = await second;
  assert.equal(image.type, 'image/jpeg');
  assert.equal(await api.artwork(song), image);
  assert.equal(calls, 1);
});

test('repairing a track invalidates its old cached cover while retaining the same Drive ID', async () => {
  let revision = 1;
  let images = 0;
  const song = { id: 'track', thumbnailLink: 'https://lh3.googleusercontent.com/cover' };
  const api = createGoogleDriveApi(async () => 'token', { fetchImpl: async (input, options) => {
    const url = new URL(input);
    if (url.hostname === 'lh3.googleusercontent.com') {
      images += 1;
      return new Response(new Uint8Array([255, 216, 255, revision]), { headers: { 'Content-Type': 'image/jpeg' } });
    }
    if (options.method === 'PATCH') { revision += 1; return json({ id: 'track', name: 'Artist - Song.mp3', ...JSON.parse(options.body) }); }
    return json({ id: 'track', name: 'Song.mp3', thumbnailLink: song.thumbnailLink });
  } });
  const oldCover = await api.artwork(song);
  const repaired = await api.updateSongMetadata('track', { title: 'Song', artist: 'Artist' });
  assert.equal(repaired.id, 'track');
  const newCover = await api.artwork(song);
  assert.notEqual(newCover, oldCover);
  assert.equal(new Uint8Array(await newCover.arrayBuffer())[3], 2);
  assert.equal(images, 2);
});
