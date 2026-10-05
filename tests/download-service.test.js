const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createDownloadService, parseSource, parseSpotifyMetadata } = require('../electron/download-service');
const { normalizeTrack, metadataFor, namesFor, matchPlaylistTrack, safeCoverUrl, ffmpegMetadataArgs, writeMp3Metadata } = require('../electron/download-metadata');

const noCoverFetch = async () => new Response('', { status: 404 });
function copyMetadataFixture(_exe, args) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => child.emit('close', 1);
  setImmediate(() => { fs.writeFileSync(args.at(-1), Buffer.concat([Buffer.from([73, 68, 51, 3, 0, 0, 0, 0, 0, 0]), fs.readFileSync(args[args.indexOf('-i') + 1])])); child.emit('close', 0); });
  return child;
}
async function settledJob(connection, id) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const job = await (await fetch(`${connection.url}/jobs/${id}`, { headers: { Authorization: `Bearer ${connection.token}` } })).json();
    if (job.state !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Fixture did not finish');
}

test('source validation normalizes links and rejects hosts, protocols and injection', () => {
  assert.equal(parseSource('https://music.youtube.com/playlist?list=PLajX1VL9dSWQ').url, 'https://www.youtube.com/playlist?list=PLajX1VL9dSWQ');
  assert.equal(parseSource('https://youtu.be/o7hCv63iWoo').url, 'https://www.youtube.com/watch?v=o7hCv63iWoo');
  for (const value of ['file:///etc/passwd', 'http://youtube.com/watch?v=o7hCv63iWoo', 'https://youtube.com.evil.test/watch?v=o7hCv63iWoo', 'https://user:pw@youtube.com/watch?v=o7hCv63iWoo', 'https://open.spotify.com/track/123', 'https://youtube.com/watch?v=--exec']) assert.throws(() => parseSource(value));
});
test('Spotify metadata extracts full song metadata, never treats preview MP3 as download source', () => {
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity: { name: 'Example', trackList: [{ title: 'Song', subtitle: 'Artist', uri: 'spotify:track:0HPD5WQqrq7wPWR7P7Dw1i', album: { name: 'Album' }, duration: 120000, audioPreview: { url: 'https://preview.test/song.mp3' } }] } } } } } })}</script>`;
  const playlist = parseSpotifyMetadata(html);
  assert.equal(playlist.entries[0].duration, 120);
  assert.equal(playlist.entries[0].search, 'Artist Song official audio');
  assert.equal(playlist.entries[0].url, undefined);
  assert.equal(playlist.entries[0].spotifyId, '0HPD5WQqrq7wPWR7P7Dw1i');
  assert.equal(playlist.entries[0].artist, 'Artist');
  assert.equal(playlist.entries[0].album, 'Album');
  assert.throws(() => parseSpotifyMetadata('<html>private</html>'));
});

test('metadata retains playlist names, sanitizes filenames, and records the actual audio source separately', () => {
  const source = normalizeTrack({ title: '歌曲 / "Slowed"', artists: [{ name: '歌手' }, { name: 'Guest' }], album: { name: '原专辑' }, spotifyId: '0HPD5WQqrq7wPWR7P7Dw1i', coverUrl: 'https://i.scdn.co/image/example', url: 'https://www.youtube.com/watch?v=o7hCv63iWoo' });
  const metadata = metadataFor(source, { title: 'Different YouTube video title', artist: 'Different uploader', album: 'Other album', duration: 125 });
  assert.equal(metadata.title, '歌曲 / "Slowed"'); assert.equal(metadata.artist, '歌手, Guest'); assert.equal(metadata.album, '原专辑');
  assert.equal(metadata.sourceUrl, source.url); assert.equal(metadata.coverUrl, source.coverUrl);
  assert.equal(namesFor(metadata).name, '歌手, Guest - 歌曲 _ _Slowed_-o7hCv63iWoo.mp3');
  assert.equal(namesFor(metadata).displayName, '歌手, Guest - 歌曲 _ _Slowed_.mp3');
  const args = ffmpegMetadataArgs('input.mp3', 'output.mp3', metadata, 'cover.jpg');
  assert.equal(args[args.indexOf('-c:a') + 1], 'copy');
  assert.ok(args.includes('title=歌曲 / "Slowed"')); assert.ok(args.includes(`comment=Audio source: ${source.url}`));
  assert.ok(args.includes('attached_pic'));
  for (const url of ['http://i.scdn.co/image/x', 'https://localhost/secret', 'https://i.scdn.co.evil.test/x', 'https://user:pass@i.scdn.co/image/x', 'file:///secret']) assert.equal(safeCoverUrl(url), '');
});

test('replacement keeps original song labels but measures duration from the selected audio source', () => {
  const source = { url: 'https://www.youtube.com/watch?v=new00000000', title: 'Original song', artist: 'Original artist', album: 'Original album', coverUrl: 'https://i.ytimg.com/vi/yTLuE57Gvsc/hqdefault.jpg', duration: 151, metadataProvider: 'youtube', preserveMetadata: true };
  for (const duration of [150, 999]) {
    const metadata = metadataFor(source, { track: 'Other title', artist: 'Other artist', album: 'Other album', duration });
    assert.equal(metadata.duration, duration); assert.equal(metadata.title, source.title); assert.equal(metadata.artist, source.artist); assert.equal(metadata.album, source.album); assert.equal(metadata.coverUrl, source.coverUrl); assert.equal(metadata.sourceUrl, source.url);
  }
  for (const duration of [undefined, null, 0, -1, NaN, Infinity]) assert.equal(metadataFor(source, { duration }).duration, 151);
  assert.equal(metadataFor({ ...source, duration: 0 }, {}).duration, 0);
});

test('old-title matching preserves alternate versions and avoids ambiguous songs', () => {
  const entries = [{ title: 'TiK ToK', artist: 'Kesha' }, { title: 'MONTAGEM GLORIA', artist: 'Artist' }, { title: 'MONTAGEM GLORIA - Slowed', artist: 'Artist' }, { title: 'Havana (feat. Young Thug)', artist: 'Camila Cabello' }, { title: 'luther (with SZA)', artist: 'Kendrick Lamar, SZA' }];
  assert.equal(matchPlaylistTrack('Kesha - TiK ToK (Lyrics)', entries), entries[0]);
  assert.equal(matchPlaylistTrack('MONTAGEM GLORIA Slowed (Official Audio)', entries), entries[2]);
  assert.equal(matchPlaylistTrack('MONTAGEM GLORIA Remix', entries), null);
  assert.equal(matchPlaylistTrack('MONTAGEM GLORIA Super Slowed', entries), null);
  assert.equal(matchPlaylistTrack('Camila Cabello - Havana Audio ft. Young Thug', entries), entries[3]);
  assert.equal(matchPlaylistTrack('Kendrick Lamar - luther Official Audio', entries), entries[4]);
  assert.equal(matchPlaylistTrack('Artist - Same song', [{ title: 'Same song', artist: 'One' }, { title: 'Same song', artist: 'Two' }]), null);
});

test('metadata repair matches legacy files by video ID, keeps backups, and persists metadata without downloading audio', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-repair-'));
  for (const name of ['yt-dlp.exe', 'yt-dlp', 'ffmpeg.exe', 'ffmpeg']) fs.writeFileSync(path.join(root, name), '');
  const id = '9a7b5fd9-4b7e-4c50-9eca-f888cf653b1d'; const directory = path.join(root, 'downloads', id);
  fs.mkdirSync(directory, { recursive: true });
  const original = 'Old_YouTube_Title-o7hCv63iWoo.mp3'; fs.writeFileSync(path.join(directory, original), 'original mp3 fixture');
  fs.writeFileSync(path.join(directory, '.job.json'), JSON.stringify({ state: 'complete', total: 1, completed: 1, files: [{ name: original, size: 20 }], sources: [{ title: 'Kesha - TiK ToK (Lyrics)', url: 'https://www.youtube.com/watch?v=o7hCv63iWoo' }] }));
  const html = (entity) => `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })}</script>`;
  const fetchImpl = async (url) => {
    if (url.includes('/embed/playlist/')) return new Response(html({ name: 'Original', trackList: [{ title: 'TiK ToK', subtitle: 'Kesha', uri: 'spotify:track:0HPD5WQqrq7wPWR7P7Dw1i', duration: 120000 }] }));
    if (url.includes('/embed/track/')) return new Response(html({ id: '0HPD5WQqrq7wPWR7P7Dw1i', title: 'TiK ToK', artists: [{ name: 'Kesha' }], album: { name: 'Animal' }, visualIdentity: { image: [{ url: 'https://i.scdn.co/image/art', maxWidth: 640 }] } }));
    return new Response('', { status: 404 });
  };
  let service = createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads'), spawnProcess: () => { throw new Error('Audio download must not run'); }, metadataProcess: copyMetadataFixture, fetchImpl });
  try {
    let config = await service.connect(); const headers = { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' };
    const started = await fetch(`${config.url}/jobs/${id}/repair`, { method: 'POST', headers, body: JSON.stringify({ playlistUrl: 'https://open.spotify.com/playlist/6cP4VM9pjOFv4TgNbH87X7' }) });
    assert.equal(started.status, 200);
    const firstRevision = (await started.json()).metadataRepair.revision;
    assert.match(firstRevision, /^[a-f0-9-]{36}$/);
    let repaired;
    for (let attempt = 0; attempt < 30; attempt++) {
      repaired = await (await fetch(`${config.url}/jobs/${id}`, { headers })).json();
      if (repaired.state !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(repaired.metadataRepair.completed, 1); assert.equal(repaired.metadataRepair.failures.length, 0);
    assert.equal(repaired.files[0].metadata.artist, 'Kesha'); assert.equal(repaired.files[0].metadata.album, 'Animal');
    assert.equal(repaired.files[0].metadata.sourceUrl, 'https://www.youtube.com/watch?v=o7hCv63iWoo');
    assert.equal(repaired.files[0].originalName, original); assert.equal(repaired.files[0].displayName, 'Kesha - TiK ToK.mp3');
    assert.equal(fs.readFileSync(path.join(directory, '.metadata-backup', original), 'utf8'), 'original mp3 fixture');
    assert.equal(fs.existsSync(path.join(directory, original)), false);
    service.dispose(); service = createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads'), metadataProcess: copyMetadataFixture, fetchImpl });
    config = await service.connect();
    const recovered = await (await fetch(`${config.url}/status`, { headers: { Authorization: `Bearer ${config.token}` } })).json();
    assert.equal(recovered.jobs[0].files.length, 1); assert.equal(recovered.jobs[0].files[0].metadata.album, 'Animal');
    assert.equal(recovered.jobs[0].files[0].originalName, original);
    assert.equal(recovered.jobs[0].metadataRepair.revision, firstRevision);
    const secondRepair = service.repairJob(id, 'https://open.spotify.com/playlist/6cP4VM9pjOFv4TgNbH87X7');
    assert.notEqual(secondRepair.metadataRepair.revision, firstRevision);
    const repeated = await settledJob(config, id);
    assert.equal(repeated.metadataRepair.completed, 1);
    assert.equal(repeated.files[0].originalName, original);
    assert.equal(fs.readFileSync(path.join(directory, '.metadata-backup', original), 'utf8'), 'original mp3 fixture');
  } finally { service.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('Spotify repair preserves alternate-source versions and marks unavailable artist metadata as skipped', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-repair-version-'));
  for (const name of ['yt-dlp.exe', 'yt-dlp', 'ffmpeg.exe', 'ffmpeg']) fs.writeFileSync(path.join(root, name), '');
  const id = '9a7b5fd9-4b7e-4c50-9eca-f888cf653b1d'; const directory = path.join(root, 'downloads', id);
  fs.mkdirSync(directory, { recursive: true });
  const files = ['Old-o7hCv63iWoo.mp3', 'Unmatched-BaW_jenozKc.mp3'];
  for (const name of files) fs.writeFileSync(path.join(directory, name), 'original mp3 fixture');
  fs.writeFileSync(path.join(directory, '.job.json'), JSON.stringify({ state: 'complete', total: 2, files: files.map((name) => ({ name, size: 20 })), sources: [
    { title: 'MONTAGEM DEMOR - Super Slowed', url: 'https://www.youtube.com/watch?v=o7hCv63iWoo' },
    { title: 'Another remix', url: 'https://www.youtube.com/watch?v=BaW_jenozKc' },
  ] }));
  const commands = [];
  const spawnProcess = (_exe, args) => {
    commands.push(args);
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => child.emit('close', 1);
    setImmediate(() => {
      const sourceId = new URL(args.at(-1)).searchParams.get('v');
      child.stdout.write(JSON.stringify(sourceId === 'o7hCv63iWoo' ? { id: sourceId, track: 'MONTAGEM DEMOR', artist: 'Actual artist', thumbnail: 'https://i.ytimg.com/vi/o7hCv63iWoo/hqdefault.jpg' } : { id: sourceId, uploader: 'Unverified uploader' }));
      child.emit('close', 0);
    });
    return child;
  };
  const fetchImpl = async (url) => url.includes('/embed/playlist/') ? new Response(`<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { state: { data: { entity: { name: 'Original', trackList: [{ title: 'MONTAGEM DEMOR - Slowed', subtitle: 'Playlist artist' }] } } } } } })}</script>`) : new Response('', { status: 404 });
  const service = createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads'), spawnProcess, metadataProcess: copyMetadataFixture, fetchImpl });
  try {
    const config = await service.connect();
    service.repairJob(id, 'https://open.spotify.com/playlist/6cP4VM9pjOFv4TgNbH87X7');
    const repaired = await settledJob(config, id);
    assert.equal(repaired.metadataRepair.completed, 1); assert.equal(repaired.metadataRepair.total, 2);
    assert.deepEqual(repaired.metadataRepair.unmatched, [files[1]]); assert.deepEqual(repaired.metadataRepair.sourceFallback, [files[0]]);
    const successful = repaired.files.find((file) => !file.metadataRepairSkipped);
    assert.equal(successful.metadata.title, 'MONTAGEM DEMOR - Super Slowed'); assert.equal(successful.metadata.artist, 'Actual artist');
    assert.equal(successful.metadata.metadataProvider, 'youtube');
    assert.equal(repaired.files.find((file) => file.name === files[1]).metadataRepairSkipped, true);
    assert.equal(fs.readFileSync(path.join(directory, files[1]), 'utf8'), 'original mp3 fixture');
    assert.ok(commands.every((args) => args.includes('--skip-download') && !args.includes('-x')));
  } finally { service.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('YouTube repair matches video IDs rather than playlist order and leaves unrelated cached files untouched', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-repair-youtube-'));
  for (const name of ['yt-dlp.exe', 'yt-dlp', 'ffmpeg.exe', 'ffmpeg']) fs.writeFileSync(path.join(root, name), '');
  const id = '9a7b5fd9-4b7e-4c50-9eca-f888cf653b1d'; const directory = path.join(root, 'downloads', id);
  fs.mkdirSync(directory, { recursive: true });
  const files = ['Unrelated-BaW_jenozKc.mp3', 'Old-o7hCv63iWoo.mp3'];
  for (const name of files) fs.writeFileSync(path.join(directory, name), 'original mp3 fixture');
  fs.writeFileSync(path.join(directory, '.job.json'), JSON.stringify({ state: 'complete', total: 2, files: files.map((name) => ({ name, size: 20 })), sources: [{ title: 'Old stale title', url: 'https://www.youtube.com/watch?v=o7hCv63iWoo' }] }));
  const commands = [];
  const spawnProcess = (_exe, args) => {
    commands.push(args);
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => child.emit('close', 1);
    setImmediate(() => {
      child.stdout.write(JSON.stringify(args.includes('--flat-playlist') ? { title: 'YouTube playlist', entries: [{ id: 'o7hCv63iWoo', title: 'Current title - Super Slowed', channel: 'Actual source channel' }] } : { id: 'o7hCv63iWoo', track: 'Current title', artist: 'Actual artist', album: 'Actual album' }));
      child.emit('close', 0);
    });
    return child;
  };
  const service = createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads'), spawnProcess, metadataProcess: copyMetadataFixture, fetchImpl: noCoverFetch });
  try {
    const config = await service.connect();
    service.repairJob(id, 'https://music.youtube.com/playlist?list=PLajX1VL9dSWQ');
    const repaired = await settledJob(config, id);
    assert.equal(repaired.metadataRepair.completed, 1); assert.deepEqual(repaired.metadataRepair.unmatched, [files[0]]);
    assert.deepEqual(repaired.metadataRepair.sourceFallback, []);
    const successful = repaired.files.find((file) => !file.metadataRepairSkipped);
    assert.equal(successful.originalName, files[1]); assert.equal(successful.displayName, 'Actual artist - Current title - Super Slowed.mp3');
    assert.equal(successful.metadata.artist, 'Actual artist'); assert.equal(successful.metadata.album, 'Actual album');
    assert.equal(successful.metadata.sourceUrl, 'https://www.youtube.com/watch?v=o7hCv63iWoo');
    assert.equal(repaired.files.find((file) => file.name === files[0]).metadataRepairSkipped, true);
    assert.ok(commands.every((args) => args.includes('--skip-download') && !args.includes('-x')));
  } finally { service.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('real FFmpeg embeds Unicode ID3 and cover art without changing the decoded audio', { skip: !fs.existsSync(path.join(__dirname, '../.local/media-tools/ffmpeg.exe')) }, async () => {
  const { execFileSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-tags-'));
  const ffmpeg = path.join(__dirname, '../.local/media-tools/ffmpeg.exe'); const ffprobe = path.join(__dirname, '../.local/media-tools/ffprobe.exe');
  const input = path.join(root, 'fixture-o7hCv63iWoo.mp3'); const cover = path.join(root, 'cover.png');
  try {
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3', '-c:a', 'libmp3lame', input], { windowsHide: true });
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32', '-frames:v', '1', cover], { windowsHide: true });
    const decodedHash = (file) => execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 'hash', '-hash', 'sha256', '-'], { windowsHide: true }).toString().trim();
    const before = decodedHash(input);
    const durationBefore = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-of', 'json', input], { windowsHide: true })).format.duration;
    const result = await writeMp3Metadata({ input, ffmpeg, metadata: { title: '歌曲 - Slowed', artist: '歌手', album: '专辑', sourceUrl: 'https://www.youtube.com/watch?v=o7hCv63iWoo', coverUrl: 'https://i.scdn.co/image/fixture' }, fetchImpl: async () => new Response(fs.readFileSync(cover)) });
    const output = path.join(root, result.name);
    const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', output], { windowsHide: true }));
    assert.equal(probe.format.tags.title, '歌曲 - Slowed'); assert.equal(probe.format.tags.artist, '歌手'); assert.equal(probe.format.tags.album, '专辑');
    assert.equal(probe.format.tags.comment, 'Audio source: https://www.youtube.com/watch?v=o7hCv63iWoo');
    assert.ok(probe.streams.some((stream) => stream.disposition.attached_pic === 1));
    assert.equal(probe.format.duration, durationBefore);
    assert.equal(decodedHash(output), before); assert.equal(result.metadata.coverEmbedded, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('service requires pairing authorization, downloads without shell, and serves only completed task files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-service-'));
  const commands = [];
  for (const name of ['yt-dlp.exe', 'yt-dlp', 'ffmpeg.exe', 'ffmpeg']) fs.writeFileSync(path.join(root, name), '');
  const mockSpawn = (exe, args, options) => {
    commands.push({ exe, args, options });
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => child.emit('close', 1);
    setImmediate(() => {
      if (args.includes('-x')) {
        const output = args[args.indexOf('-o') + 1];
        fs.writeFileSync(path.join(path.dirname(output), 'fixture-o7hCv63iWoo.mp3'), 'fixture audio bytes');
        child.stdout.write('PROGRESS:100%\n');
      } else child.stdout.write(JSON.stringify({ title: 'Example', entries: [{ id: 'o7hCv63iWoo', title: 'Example song' }] }));
      child.emit('close', 0);
    });
    return child;
  };
  const service = createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads'), spawnProcess: mockSpawn, metadataProcess: copyMetadataFixture, fetchImpl: noCoverFetch });
  try {
    const config = await service.connect();
    const unauthenticated = await fetch(`${config.url}/status`);
    assert.equal(unauthenticated.status, 401);
    const headers = { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' };
    const inspected = await fetch(`${config.url}/inspect`, { method: 'POST', headers, body: JSON.stringify({ url: 'https://music.youtube.com/playlist?list=PLajX1VL9dSWQ' }) });
    const playlist = await inspected.json();
    assert.equal(playlist.entries.length, 1);
    const started = await fetch(`${config.url}/jobs`, { method: 'POST', headers, body: JSON.stringify({ entries: playlist.entries }) });
    const job = await started.json();
    for (let attempt = 0; attempt < 30; attempt++) {
      const current = await (await fetch(`${config.url}/jobs/${job.id}`, { headers })).json();
      if (current.state !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const status = await (await fetch(`${config.url}/jobs/${job.id}`, { headers })).json();
    assert.equal(status.state, 'complete');
    assert.equal(status.files.length, 1);
    const file = await fetch(`${config.url}/files/${job.id}/${status.files[0].name}`, { headers });
    assert.equal(file.headers.get('content-type'), 'audio/mpeg');
    assert.ok((await file.text()).endsWith('fixture audio bytes'));
    const missing = await fetch(`${config.url}/files/${job.id}/secret.mp3`, { headers });
    assert.equal(missing.status, 404);
    const bad = await fetch(`${config.url}/jobs`, { method: 'POST', headers, body: JSON.stringify({ entries: [{ url: 'https://evil.test/payload' }] }) });
    assert.equal(bad.status, 400);
    assert.ok(commands.every((command) => command.options.shell === false && command.args.includes('--ignore-config')));
    assert.ok(commands[1].args.includes('mp3'));
    assert.equal(commands[1].args[commands[1].args.indexOf('--ffmpeg-location') + 1], path.join(root, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
  } finally { service.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('failed conversions retain sources, retry only failed tracks, and survive service restarts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-retry-'));
  for (const name of ['yt-dlp.exe', 'yt-dlp', 'ffmpeg.exe', 'ffmpeg']) fs.writeFileSync(path.join(root, name), '');
  let failFirst = true;
  const attempts = [];
  const mockSpawn = (_exe, args) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => child.emit('close', 1);
    const id = new URL(args.at(-1)).searchParams.get('v');
    attempts.push(id);
    setImmediate(() => {
      if (id === 'o7hCv63iWoo' && failFirst) { failFirst = false; child.stderr.write('Conversion fixture failed'); child.emit('close', 1); return; }
      const directory = path.dirname(args[args.indexOf('-o') + 1]);
      fs.writeFileSync(path.join(directory, `fixture-${id}.mp3`), 'fixture audio');
      child.emit('close', 0);
    });
    return child;
  };
  let service = createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads'), spawnProcess: mockSpawn, metadataProcess: copyMetadataFixture, fetchImpl: noCoverFetch });
  const settle = async (connection, id) => {
    for (let index = 0; index < 20; index++) {
      const result = await (await fetch(`${connection.url}/jobs/${id}`, { headers: { Authorization: `Bearer ${connection.token}` } })).json();
      if (result.state !== 'running') return result;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Fixture did not finish');
  };
  try {
    let connection = await service.connect();
    const job = service.startJob([{ title: 'Retry me', url: 'https://www.youtube.com/watch?v=o7hCv63iWoo' }, { title: 'Keep me', url: 'https://www.youtube.com/watch?v=BaW_jenozKc' }]);
    const partial = await settle(connection, job.id);
    assert.equal(partial.state, 'partial'); assert.equal(partial.completed, 1); assert.equal(partial.progress, 50);
    service.dispose();
    service = createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads'), spawnProcess: mockSpawn, metadataProcess: copyMetadataFixture, fetchImpl: noCoverFetch });
    connection = await service.connect();
    const recovered = await settle(connection, job.id);
    assert.equal(recovered.files.length, 1); assert.equal(recovered.failures[0].title, 'Retry me');
    const retried = await fetch(`${connection.url}/jobs/${job.id}/retry`, { method: 'POST', headers: { Authorization: `Bearer ${connection.token}` } });
    assert.equal(retried.status, 200);
    const complete = await settle(connection, job.id);
    assert.equal(complete.state, 'complete'); assert.equal(complete.files.length, 2); assert.equal(complete.completed, 2);
    assert.deepEqual(attempts, ['o7hCv63iWoo', 'BaW_jenozKc', 'o7hCv63iWoo']);
  } finally { service.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('a successful tool exit without a nonempty MP3 remains a failed, retryable conversion', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-empty-'));
  for (const name of ['yt-dlp.exe', 'yt-dlp', 'ffmpeg.exe', 'ffmpeg']) fs.writeFileSync(path.join(root, name), '');
  const service = createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads'), spawnProcess: (_exe, args) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => child.emit('close', 1);
    setImmediate(() => { fs.writeFileSync(path.join(path.dirname(args[args.indexOf('-o') + 1]), 'empty-o7hCv63iWoo.mp3'), ''); child.emit('close', 0); });
    return child;
  } });
  try {
    const connection = await service.connect();
    const job = service.startJob([{ title: 'Empty fixture', url: 'https://www.youtube.com/watch?v=o7hCv63iWoo' }]);
    await new Promise((resolve) => setImmediate(resolve));
    const result = await (await fetch(`${connection.url}/jobs/${job.id}`, { headers: { Authorization: `Bearer ${connection.token}` } })).json();
    assert.equal(result.state, 'failed'); assert.equal(result.completed, 0); assert.equal(result.progress, 0);
    assert.equal(result.files.length, 0); assert.equal(result.failures.length, 1);
    assert.equal(fs.existsSync(path.join(root, 'downloads', job.id, 'empty-o7hCv63iWoo.mp3')), false);
  } finally { service.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('replacing one age-restricted source resumes only the missing track and preserves the other eleven MP3s', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-source-replacement-'));
  for (const name of ['yt-dlp.exe', 'yt-dlp', 'ffmpeg.exe', 'ffmpeg']) fs.writeFileSync(path.join(root, name), '');
  const id = '11111111-1111-4111-8111-111111111111', directory = path.join(root, 'downloads', id);
  fs.mkdirSync(directory, { recursive: true });
  const files = [], sources = [];
  for (let index = 0; index < 11; index++) {
    const video = `done${String(index).padStart(7, '0')}`, sourceUrl = `https://www.youtube.com/watch?v=${video}`;
    const name = `Finished-${video}.mp3`, content = `completed-${index}`;
    fs.writeFileSync(path.join(directory, name), content);
    sources.push({ url: sourceUrl, title: `Finished ${index}`, artist: 'Original artist' });
    files.push({ name, size: content.length, metadata: { title: `Finished ${index}`, artist: 'Original artist', sourceUrl } });
  }
  const failedSource = { url: 'https://www.youtube.com/watch?v=yTLuE57Gvsc', title: 'Original song', artist: 'Original artist', album: 'Original album', duration: 151, coverUrl: 'https://i.ytimg.com/vi/yTLuE57Gvsc/hqdefault.jpg', metadataProvider: 'youtube' };
  sources.push(failedSource);
  const saved = { id, state: 'partial', total: 12, completed: 11, sources, files, failures: [{ ...failedSource, error: 'Sign in to confirm your age' }] };
  fs.writeFileSync(path.join(directory, '.job.json'), JSON.stringify(saved));
  const attempts = [];
  const spawnProcess = (_exe, args) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => child.emit('close', 1);
    const video = new URL(args.at(-1)).searchParams.get('v'); attempts.push(video);
    setImmediate(() => {
      fs.writeFileSync(path.join(directory, `Different source title-${video}.mp3`), 'replacement audio fixture');
      fs.writeFileSync(path.join(directory, `Different source title-${video}.info.json`), JSON.stringify({ id: video, track: 'Different source title', artist: 'Different source channel', album: 'Different album', duration: 150 }));
      child.emit('close', 0);
    });
    return child;
  };
  const service = createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads'), spawnProcess, metadataProcess: copyMetadataFixture, fetchImpl: noCoverFetch });
  try {
    const config = await service.connect(), headers = { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' };
    const retry = (input) => fetch(`${config.url}/jobs/${id}/retry`, { method: 'POST', headers, body: JSON.stringify(input) });
    const denied = await retry({}); assert.equal(denied.status, 400); assert.match((await denied.json()).error, /年龄验证/); assert.deepEqual(attempts, []);
    const replacement = { fromUrl: failedSource.url, url: 'https://www.youtube.com/watch?v=new00000000' };
    for (const input of [
      { replacements: [{ ...replacement, fromUrl: sources[0].url }] },
      { replacements: [{ ...replacement, fromUrl: 'https://www.youtube.com/watch?v=unknown0000' }] },
      { replacements: [{ ...replacement, url: sources[0].url }] },
      { replacements: [{ ...replacement, url: 'https://evil.example/watch?v=new00000000' }] },
      { replacements: [replacement, replacement] },
      { replacements: [replacement], cloud: { accountId: 'forged-account' } },
    ]) {
      const response = await retry(input); assert.equal(response.status, 400); assert.deepEqual(attempts, []);
      const unchanged = await settledJob(config, id); assert.equal(unchanged.completed, 11); assert.equal(unchanged.failures[0].url, failedSource.url);
      assert.equal(JSON.parse(fs.readFileSync(path.join(directory, '.job.json'), 'utf8')).sources.at(-1).url, failedSource.url);
    }
    const started = await retry({ replacements: [replacement] }); assert.equal(started.status, 200);
    const complete = await settledJob(config, id);
    assert.equal(complete.state, 'complete'); assert.equal(complete.total, 12); assert.equal(complete.completed, 12); assert.equal(complete.files.length, 12); assert.deepEqual(attempts, ['new00000000']);
    for (let index = 0; index < 11; index++) assert.equal(fs.readFileSync(path.join(directory, files[index].name), 'utf8'), `completed-${index}`);
    const added = complete.files.find((file) => file.metadata.sourceUrl === replacement.url);
    assert.equal(added.metadata.title, failedSource.title); assert.equal(added.metadata.artist, failedSource.artist); assert.equal(added.metadata.album, failedSource.album); assert.equal(added.metadata.coverUrl, failedSource.coverUrl); assert.equal(added.metadata.metadataProvider, 'youtube');
    assert.equal(added.metadata.duration, 150);
    assert.equal(complete.failures.length, 0);
    const persisted = JSON.parse(fs.readFileSync(path.join(directory, '.job.json'), 'utf8')); assert.equal(persisted.sources.at(-1).url, replacement.url); assert.equal(persisted.sources.at(-1).title, failedSource.title);
  } finally {
    service.dispose(); assert.ok(root.startsWith(path.join(os.tmpdir(), 'music-source-replacement-'))); fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const restart of [false, true]) test(`cancelled source replacement retains its missing track and retries only it${restart ? ' after restart' : ''}`, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-cancelled-replacement-'));
  for (const name of ['yt-dlp.exe', 'yt-dlp', 'ffmpeg.exe', 'ffmpeg']) fs.writeFileSync(path.join(root, name), '');
  const id = '22222222-2222-4222-8222-222222222222', directory = path.join(root, 'downloads', id), manifest = path.join(directory, '.job.json');
  fs.mkdirSync(directory, { recursive: true });
  const sources = [], files = [];
  for (let index = 0; index < 11; index++) {
    const video = `done${String(index).padStart(7, '0')}`, url = `https://www.youtube.com/watch?v=${video}`, name = `Finished-${video}.mp3`, content = `retained-${index}`;
    fs.writeFileSync(path.join(directory, name), content);
    sources.push({ url, title: `Finished ${index}` }); files.push({ name, size: content.length, metadata: { sourceUrl: url } });
  }
  const original = { url: 'https://www.youtube.com/watch?v=yTLuE57Gvsc', title: 'Original song', artist: 'Original artist', duration: 151 };
  sources.push(original);
  fs.writeFileSync(manifest, JSON.stringify({ id, sources, files, total: 12, completed: 11, state: 'partial', failures: [{ ...original, error: 'Sign in to confirm your age' }] }));
  const attempts = [];
  let heldChild;
  const spawnProcess = (_exe, args) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => { if (child !== heldChild) setImmediate(() => child.emit('close', 1)); };
    const video = new URL(args.at(-1)).searchParams.get('v'); attempts.push(video);
    if (attempts.length === 1) heldChild = child;
    if (attempts.length > 1) setImmediate(() => {
      fs.writeFileSync(path.join(directory, `Replacement-${video}.mp3`), 'replacement audio fixture');
      child.emit('close', 0);
    });
    return child;
  };
  const create = () => createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads'), spawnProcess, metadataProcess: copyMetadataFixture, fetchImpl: noCoverFetch });
  let service = create();
  try {
    let config = await service.connect();
    const postRetry = (body) => fetch(`${config.url}/jobs/${id}/retry`, { method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const replacement = { fromUrl: original.url, url: 'https://www.youtube.com/watch?v=new00000000' };
    assert.equal((await postRetry({ replacements: [replacement] })).status, 200);
    assert.equal((await fetch(`${config.url}/jobs/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${config.token}` } })).status, 200);
    assert.equal((await postRetry({})).status, 400);
    heldChild.emit('close', 1);
    let cancelled = await settledJob(config, id);
    assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.completed, 11); assert.equal(cancelled.total, 12); assert.equal(cancelled.files.length, 11); assert.equal(cancelled.progress, 91);
    assert.equal(cancelled.failures.length, 1); assert.equal(cancelled.failures[0].url, replacement.url); assert.equal(cancelled.failures[0].preserveMetadata, true);
    assert.match(cancelled.failures[0].error, /取消/); assert.doesNotMatch(cancelled.failures[0].error, /confirm your age/);
    if (restart) {
      service.dispose();
      // Older versions persisted this exact cancelled state with no failure entry.
      const saved = JSON.parse(fs.readFileSync(manifest, 'utf8')); saved.failures = []; saved.error = ''; fs.writeFileSync(manifest, JSON.stringify(saved));
      fs.writeFileSync(path.join(directory, 'Unregistered-new00000000.mp3'), 'unfinished extraction fixture');
      fs.writeFileSync(path.join(directory, 'Empty-new00000000.mp3'), '');
      service = create(); config = await service.connect(); cancelled = await settledJob(config, id);
      assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.completed, 11); assert.equal(cancelled.total, 12); assert.equal(cancelled.progress, 91);
      assert.equal(cancelled.failures.length, 1); assert.equal(cancelled.failures[0].url, replacement.url); assert.equal(cancelled.failures[0].preserveMetadata, true);
    }
    assert.equal((await postRetry({})).status, 200);
    const complete = await settledJob(config, id);
    assert.equal(complete.state, 'complete'); assert.equal(complete.completed, 12); assert.equal(complete.total, 12); assert.equal(complete.files.length, 12); assert.equal(complete.failures.length, 0);
    assert.deepEqual(attempts, ['new00000000', 'new00000000']);
    for (let index = 0; index < 11; index++) assert.equal(fs.readFileSync(path.join(directory, files[index].name), 'utf8'), `retained-${index}`);
  } finally {
    heldChild?.emit('close', 1); service.dispose(); assert.ok(root.startsWith(path.join(os.tmpdir(), 'music-cancelled-replacement-'))); fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restart recovers actual missing MP3s from partial jobs and preserves access restriction errors', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-partial-recovery-'));
  const id = '33333333-3333-4333-8333-333333333333', directory = path.join(root, 'downloads', id);
  fs.mkdirSync(directory, { recursive: true });
  const completed = { url: 'https://www.youtube.com/watch?v=done0000000', title: 'Keep this song' }, pending = { url: 'https://www.youtube.com/watch?v=new00000000', title: 'Replacement song', preserveMetadata: true };
  const name = 'Finished-without-source-id.mp3'; fs.writeFileSync(path.join(directory, name), 'finished fixture');
  fs.writeFileSync(path.join(directory, '.job.json'), JSON.stringify({ state: 'partial', total: 2, completed: 2, sources: [completed, pending], files: [{ name, size: 1, metadata: { sourceUrl: completed.url } }, { name: 'Missing-new00000000.mp3', size: 1 }], failures: [] }));
  let service = createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads'), spawnProcess: () => { throw new Error('Restoring tasks must not download'); } });
  try {
    let config = await service.connect(), restored = await settledJob(config, id);
    assert.equal(restored.state, 'partial'); assert.equal(restored.completed, 1); assert.equal(restored.total, 2); assert.equal(restored.failures.length, 1); assert.equal(restored.failures[0].url, pending.url); assert.equal(restored.failures[0].preserveMetadata, true);
    service.dispose();
    const saved = JSON.parse(fs.readFileSync(path.join(directory, '.job.json'), 'utf8'));
    saved.failures = [{ ...completed, error: 'Stale conversion error' }, { ...pending, error: 'Sign in to confirm your age' }]; fs.writeFileSync(path.join(directory, '.job.json'), JSON.stringify(saved));
    service = createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads'), spawnProcess: () => { throw new Error('Restoring tasks must not download'); } });
    config = await service.connect(); restored = await settledJob(config, id);
    assert.equal(restored.failures.length, 1); assert.equal(restored.failures[0].error, 'Sign in to confirm your age');
    assert.equal(restored.files.length, 1); assert.equal(fs.readFileSync(path.join(directory, name), 'utf8'), 'finished fixture');
  } finally {
    service.dispose(); assert.ok(root.startsWith(path.join(os.tmpdir(), 'music-partial-recovery-'))); fs.rmSync(root, { recursive: true, force: true });
  }
});
