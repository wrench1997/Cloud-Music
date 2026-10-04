const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createDownloadService, parseSource, parseSpotifyMetadata } = require('../electron/download-service');

test('source validation normalizes links and rejects hosts, protocols and injection', () => {
  assert.equal(parseSource('https://music.youtube.com/playlist?list=PLajX1VL9dSWQ').url, 'https://www.youtube.com/playlist?list=PLajX1VL9dSWQ');
  assert.equal(parseSource('https://youtu.be/o7hCv63iWoo').url, 'https://www.youtube.com/watch?v=o7hCv63iWoo');
  for (const value of ['file:///etc/passwd', 'http://youtube.com/watch?v=o7hCv63iWoo', 'https://youtube.com.evil.test/watch?v=o7hCv63iWoo', 'https://user:pw@youtube.com/watch?v=o7hCv63iWoo', 'https://open.spotify.com/track/123', 'https://youtube.com/watch?v=--exec']) assert.throws(() => parseSource(value));
});
test('Spotify metadata extracts full song metadata, never treats preview MP3 as download source', () => {
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity: { name: 'Example', trackList: [{ title: 'Song', subtitle: 'Artist', duration: 120000, audioPreview: { url: 'https://preview.test/song.mp3' } }] } } } } } })}</script>`;
  const playlist = parseSpotifyMetadata(html);
  assert.equal(playlist.entries[0].duration, 120);
  assert.equal(playlist.entries[0].search, 'Artist Song official audio');
  assert.equal(playlist.entries[0].url, undefined);
  assert.throws(() => parseSpotifyMetadata('<html>private</html>'));
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
  const service = createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads'), spawnProcess: mockSpawn });
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
    await new Promise((resolve) => setImmediate(resolve));
    const status = await (await fetch(`${config.url}/jobs/${job.id}`, { headers })).json();
    assert.equal(status.state, 'complete');
    assert.equal(status.files.length, 1);
    const file = await fetch(`${config.url}/files/${job.id}/${status.files[0].name}`, { headers });
    assert.equal(file.headers.get('content-type'), 'audio/mpeg');
    assert.equal(await file.text(), 'fixture audio bytes');
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
  let service = createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads'), spawnProcess: mockSpawn });
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
    service = createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads'), spawnProcess: mockSpawn });
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
