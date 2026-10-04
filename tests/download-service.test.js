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
  } finally { service.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
});
