const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createMusicCache, cacheIdFor, rangeFor } = require('../electron/music-cache');
const { desktopCacheArtwork } = require('../src/lib/desktop-cache-source');

function mp3Fixture() {
  const frame = (id, data) => {
    const header = Buffer.alloc(10); header.write(id); header.writeUInt32BE(data.length, 4);
    return Buffer.concat([header, data]);
  };
  const picture = Buffer.from([255, 216, 255, 224, 1, 2, 3, 255, 217]);
  const body = Buffer.concat([
    frame('TIT2', Buffer.concat([Buffer.from([3]), Buffer.from('Embedded title')])),
    frame('TPE1', Buffer.concat([Buffer.from([3]), Buffer.from('Embedded artist')])),
    frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/jpeg\0'), Buffer.from([3, 0]), picture])),
  ]);
  const header = Buffer.from([73, 68, 51, 3, 0, 0, (body.length >>> 21) & 127, (body.length >>> 14) & 127, (body.length >>> 7) & 127, body.length & 127]);
  return { bytes: Buffer.concat([header, body, Buffer.from('audio frames')]), picture };
}

async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yungan-cache-test-'));
  const cacheDirectory = path.join(directory, 'cache');
  const audio = mp3Fixture();
  let requests = 0;
  let identity = { id: 'verified-account-a', email: 'account-a@example.test' };
  const deps = {
    directory: cacheDirectory, getIdentity: async () => identity,
    getSource: async () => { requests += 1; return {
      response: new Response(audio.bytes, { headers: { 'content-length': String(audio.bytes.length) } }),
      metadata: { title: 'Drive title', artist: 'Drive artist', album: 'Drive album', duration: 123,
        fileName: 'original.mp3', mimeType: 'audio/mpeg', size: audio.bytes.length, sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk', accessToken: 'secret-access-token' },
    }; }, ...overrides,
  };
  const cache = createMusicCache(deps);
  const instances = [cache];
  t.after(async () => {
    for (const instance of instances) instance.dispose();
    assert.equal(directory.startsWith(path.join(os.tmpdir(), 'yungan-cache-test-')), true);
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { cache, deps, directory, cacheDirectory, audio, requests: () => requests,
    setIdentity: (value) => { identity = value; }, reopen: (options) => { const instance = createMusicCache({ ...deps, ...options }); instances.push(instance); return instance; } };
}

test('complete audio, metadata and embedded cover persist across launch and play without Google or internet', async (t) => {
  const item = await fixture(t);
  const song = await item.cache.cache({ fileId: 'drive-track', accountId: 'verified-account-a' });
  assert.equal(song.title, 'Drive title'); assert.equal(song.artist, 'Drive artist'); assert.equal(song.duration, 123);
  assert.equal(song.provider, 'local'); assert.equal(song.originalAccount.id, 'verified-account-a');
  assert.equal(song.driveFileId, 'drive-track'); assert.equal(song.hasArtwork, true);
  assert.equal(desktopCacheArtwork(song), song.coverUrl);
  assert.equal(desktopCacheArtwork({ ...song, id: 'drive-track', driveFileId: 'drive-track' }), song.coverUrl);
  assert.equal(JSON.stringify(song).includes('secret-access-token'), false);
  const metadata = await fs.readFile(path.join(item.cacheDirectory, song.cacheId, 'metadata.json'), 'utf8');
  assert.equal(metadata.includes('secret-access-token'), false);
  item.cache.dispose();
  const reopened = item.reopen({ getIdentity: () => { throw new Error('offline must not authenticate'); }, getSource: () => { throw new Error('offline must not download'); } });
  const { songs } = await reopened.list();
  assert.equal(songs.length, 1); assert.equal(songs[0].id, song.id); assert.notEqual(songs[0].localUri, song.localUri);
  assert.deepEqual(Buffer.from(await (await fetch(songs[0].localUri)).arrayBuffer()), item.audio.bytes);
  assert.deepEqual(Buffer.from(await (await fetch(songs[0].coverUrl)).arrayBuffer()), item.audio.picture);
  const middle = await fetch(songs[0].localUri, { headers: { Range: 'bytes=10-13' } });
  assert.equal(middle.status, 206); assert.equal(middle.headers.get('content-range'), `bytes 10-13/${item.audio.bytes.length}`);
  assert.deepEqual(Buffer.from(await middle.arrayBuffer()), item.audio.bytes.subarray(10, 14));
  const head = await fetch(songs[0].localUri, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), String(item.audio.bytes.length)); assert.equal(await head.text(), '');
  assert.equal(item.requests(), 1);
});

test('concurrent requests and repeated playback download once per verified account and Drive file', async (t) => {
  const item = await fixture(t);
  const results = await Promise.all(Array.from({ length: 20 }, () => item.cache.cache({ fileId: 'same-track' })));
  assert.equal(item.requests(), 1); assert.equal(new Set(results.map((song) => song.cacheId)).size, 1);
  await item.cache.cache({ fileId: 'same-track' }); assert.equal(item.requests(), 1);
  item.setIdentity({ id: 'verified-account-b', email: 'account-b@example.test' });
  await assert.rejects(item.cache.cache({ fileId: 'same-track', accountId: 'verified-account-a' }), /账号/);
  const second = await item.cache.cache({ fileId: 'same-track' });
  assert.equal(item.requests(), 2); assert.notEqual(second.cacheId, results[0].cacheId);
  assert.equal((await item.cache.list()).songs.length, 2);
});

test('older Drive uploads with generic filenames prefer embedded MP3 title and artist', async (t) => {
  const audio = mp3Fixture();
  const item = await fixture(t, { getSource: async () => ({ response: new Response(audio.bytes), metadata: { title: 'random filename', artist: '未知歌手', preferEmbeddedTitle: true, mimeType: 'audio/mpeg' } }) });
  const song = await item.cache.cache({ fileId: 'legacy-track' });
  assert.equal(song.title, 'Embedded title'); assert.equal(song.artist, 'Embedded artist'); assert.equal(song.hasArtwork, true);
});

test('incomplete, empty, oversized and partial HTTP responses never appear as cached music and can retry', async (t) => {
  for (const mode of ['truncated', 'empty', 'oversized', 'partial', 'html']) {
    let fail = true;
    const item = await fixture(t, { maxBytes: 1000, getSource: async () => {
      if (!fail) return { response: new Response('finished', { headers: { 'content-length': '8', 'content-type': 'audio/mpeg' } }), metadata: { mimeType: 'audio/mpeg' } };
      if (mode === 'partial') return { response: new Response('piece', { status: 206, headers: { 'content-range': 'bytes 0-4/100' } }) };
      const body = mode === 'empty' ? '' : mode === 'oversized' ? 'x'.repeat(1001) : 'short';
      return { response: new Response(body, { headers: { 'content-length': mode === 'truncated' ? '100' : String(body.length), 'content-type': mode === 'html' ? 'text/html' : 'audio/mpeg' } }) };
    } });
    await assert.rejects(item.cache.cache({ fileId: 'broken-track' }));
    assert.deepEqual((await item.cache.list()).songs, []);
    assert.deepEqual(await fs.readdir(item.cacheDirectory), []);
    fail = false;
    assert.ok((await item.cache.cache({ fileId: 'broken-track' })).localUri);
  }
});

test('mid-download account changes and body failures leave no committed or partial audio', async (t) => {
  const item = await fixture(t, { getSource: async () => ({ response: new Response(Buffer.from('data')), validate: () => { throw new Error('account changed'); } }) });
  await assert.rejects(item.cache.cache({ fileId: 'switched-track' }), /account changed/);
  assert.deepEqual((await item.cache.list()).songs, []);
  const broken = await fixture(t, { getSource: async () => ({ response: new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('part')); controller.error(new Error('lost connection')); } })) }) });
  await assert.rejects(broken.cache.cache({ fileId: 'interrupted-track' }), /lost connection/);
  assert.deepEqual((await broken.cache.list()).songs, []);
  assert.deepEqual(await fs.readdir(broken.cacheDirectory), []);
});

test('local removal cannot delete a cloud file or an external path, and revokes that audio URL', async (t) => {
  const item = await fixture(t);
  const outside = path.join(item.directory, 'keep-me.mp3'); await fs.writeFile(outside, 'outside');
  const song = await item.cache.cache({ fileId: 'track-to-remove' });
  for (const id of ['../../keep-me.mp3', outside, 'cache:../../outside', 'cache:invalid']) await assert.rejects(item.cache.remove({ id }), /无效/);
  assert.equal(await fs.readFile(outside, 'utf8'), 'outside');
  assert.deepEqual(await item.cache.remove({ id: song.id }), { removed: true });
  assert.equal((await fetch(song.localUri)).status, 404);
  assert.equal(item.requests(), 1); assert.deepEqual((await item.cache.list()).songs, []);
  assert.deepEqual(await item.cache.remove({ cacheId: song.cacheId }), { removed: false });
});

test('deleting audio with an active reader closes only that file and permits a later fresh cache', { timeout: 10000 }, async (t) => {
  const bytes = Buffer.alloc(16 * 1024 * 1024, 42);
  let requests = 0;
  const item = await fixture(t, { getSource: async () => {
    requests += 1;
    return { response: new Response(bytes), metadata: { fileName: 'large.flac', mimeType: 'audio/flac', size: bytes.length } };
  } });
  const first = await item.cache.cache({ fileId: 'active-first' });
  const second = await item.cache.cache({ fileId: 'active-second' });
  const pausedResponse = (url) => new Promise((resolve, reject) => {
    const request = http.get(url, (response) => { response.pause(); response.on('error', () => {}); resolve(response); });
    request.on('error', reject);
  });
  const firstReader = await pausedResponse(first.localUri);
  const secondReader = await pausedResponse(second.localUri);
  const firstClosed = new Promise((resolve) => firstReader.once('close', resolve));
  assert.equal(firstReader.complete, false); assert.equal(secondReader.complete, false);
  assert.deepEqual(await item.cache.remove({ cacheId: first.cacheId }), { removed: true });
  firstReader.resume();
  await firstClosed;
  await assert.rejects(fs.stat(path.join(item.cacheDirectory, first.cacheId)), { code: 'ENOENT' });
  let received = 0;
  for await (const chunk of secondReader) received += chunk.length;
  assert.equal(received, bytes.length); assert.equal(secondReader.complete, true);
  const replacement = await item.cache.cache({ fileId: 'active-first' });
  assert.equal(replacement.cacheId, first.cacheId); assert.equal(requests, 3);
  assert.equal((await fetch(replacement.localUri, { method: 'HEAD' })).status, 200);
  assert.equal((await item.cache.list()).songs.length, 2);
});

test('removal waits for an unfinished cache and a concurrent recache waits until deletion completes', async (t) => {
  let controller;
  let sourceStarted;
  const started = new Promise((resolve) => { sourceStarted = resolve; });
  let requests = 0;
  const item = await fixture(t, { getSource: async () => {
    requests += 1;
    if (requests > 1) return { response: new Response(Buffer.from('downloaded again')) };
    const body = new ReadableStream({ start(value) { controller = value; } });
    sourceStarted(); return { response: new Response(body) };
  } });
  const download = item.cache.cache({ fileId: 'pending-track' });
  await started;
  const id = cacheIdFor('verified-account-a', 'pending-track');
  const deletion = item.cache.remove({ cacheId: id });
  const recache = item.cache.cache({ fileId: 'pending-track' });
  controller.enqueue(Buffer.from('first download')); controller.close();
  await download;
  assert.deepEqual(await deletion, { removed: true });
  const next = await recache;
  assert.equal(requests, 2); assert.equal(await (await fetch(next.localUri)).text(), 'downloaded again');
  assert.equal((await item.cache.list()).songs.length, 1);
});

test('cache server rejects foreign capabilities and malformed ranges, while safe suffix seeking works', async (t) => {
  const item = await fixture(t); const song = await item.cache.cache({ fileId: 'range-track' });
  const url = new URL(song.localUri);
  const wrong = new URL(url); wrong.pathname = wrong.pathname.replace(/\/music-cache\/[^/]+\//, '/music-cache/foreign/');
  assert.equal((await fetch(wrong)).status, 404);
  for (const range of ['bytes=99999-', 'bytes=3-2', 'bytes=0-1,4-5', 'bytes=-0']) assert.equal((await fetch(url, { headers: { Range: range } })).status, 416);
  const suffix = await fetch(url, { headers: { Range: 'bytes=-5' } });
  assert.equal(suffix.status, 206); assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), item.audio.bytes.subarray(-5));
  assert.deepEqual(rangeFor(undefined, 10), { start: 0, end: 9, status: 200 });
});

test('packaged and development windows can fetch local copies while foreign web origins cannot', async (t) => {
  const item = await fixture(t); const song = await item.cache.cache({ fileId: 'cors-track' });
  for (const origin of ['null', 'http://localhost:3000']) {
    const audio = await fetch(song.localUri, { headers: { Origin: origin } });
    assert.equal(audio.status, 200); assert.equal(audio.headers.get('access-control-allow-origin'), origin);
    assert.equal(audio.headers.get('vary'), 'Origin'); assert.deepEqual(Buffer.from(await audio.arrayBuffer()), item.audio.bytes);
    const head = await fetch(song.localUri, { method: 'HEAD', headers: { Origin: origin } });
    assert.equal(head.status, 200); assert.equal(head.headers.get('access-control-allow-origin'), origin);
    const cover = await fetch(song.coverUrl, { headers: { Origin: origin } });
    assert.equal(cover.headers.get('access-control-allow-origin'), origin);
    const preflight = await fetch(song.localUri, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'range' } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.equal(preflight.headers.get('access-control-allow-headers'), 'Range'); assert.equal(await preflight.text(), '');
    const invalid = await fetch(song.localUri, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'DELETE', 'Access-Control-Request-Headers': 'authorization' } });
    assert.equal(invalid.status, 403);
  }
  for (const origin of ['https://untrusted.example', 'http://localhost:3001', 'http://127.0.0.1:3000', 'file://']) {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const response = await fetch(song.localUri, { method, headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' } });
      assert.equal(response.status, 403); assert.equal(response.headers.get('access-control-allow-origin'), null);
    }
  }
  assert.equal((await fetch(song.localUri)).status, 200); assert.equal(item.requests(), 1);
});

test('launch reclaims only app-owned scratch directories and ignores truncated entries', async (t) => {
  const item = await fixture(t);
  await fs.mkdir(item.cacheDirectory, { recursive: true });
  const stale = `.partial-${'a'.repeat(64)}-${'b'.repeat(16)}`;
  await fs.mkdir(path.join(item.cacheDirectory, stale)); await fs.writeFile(path.join(item.cacheDirectory, stale, 'audio'), 'interrupted');
  const unknown = path.join(item.cacheDirectory, '.partial-user-folder'); await fs.mkdir(unknown); await fs.writeFile(path.join(unknown, 'keep'), 'keep');
  const id = cacheIdFor('a', 'track'); await fs.mkdir(path.join(item.cacheDirectory, id)); await fs.writeFile(path.join(item.cacheDirectory, id, 'metadata.json'), '{');
  assert.deepEqual((await item.cache.list()).songs, []);
  assert.equal(await fs.readFile(path.join(unknown, 'keep'), 'utf8'), 'keep');
  await assert.rejects(fs.stat(path.join(item.cacheDirectory, stale)), { code: 'ENOENT' });
});

test('offline artwork is accepted only with a matching cache ID and paired audio capability', () => {
  const hash = 'a'.repeat(64), key = 'b'.repeat(43);
  const song = { id: `cache:${hash}`, cacheId: hash, localUri: `http://127.0.0.1:45678/music-cache/${key}/${hash}/audio`, coverUrl: `http://127.0.0.1:45678/music-cache/${key}/${hash}/cover` };
  assert.equal(desktopCacheArtwork(song), song.coverUrl);
  for (const change of [ { id: 'cloud-file' }, { cacheId: 'c'.repeat(64) }, { coverUrl: 'http://127.0.0.1:45678/private' }, { coverUrl: song.coverUrl.replace(':45678', ':45679') }, { coverUrl: song.coverUrl + '?token=hidden' }, { localUri: 'file:///outside.mp3' } ]) assert.equal(desktopCacheArtwork({ ...song, ...change }), '');
});
