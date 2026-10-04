const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createWebApp } = require('../scripts/web-app.cjs');
const { createDownloadService } = require('../electron/download-service');
const { createGoogleDriveApi } = require('../src/lib/google-drive');
const { transferDownloadedFiles } = require('../src/lib/downloaded-transfers');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sessionResponse = () => new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=fixture-session' } });
const isFolderQuery = (url) => new URL(url).searchParams.get('q')?.includes("mimeType = 'application/vnd.google-apps.folder'");
const folder = { id: 'own-library-folder', name: 'Yungan Music' };

test('same-origin webpage MP3 download reaches one resumable Drive session with unchanged bytes after an ambiguous server failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-upload-integration-'));
  const downloads = path.join(root, 'downloads');
  const id = crypto.randomUUID();
  const directory = path.join(downloads, id);
  fs.mkdirSync(directory, { recursive: true });
  for (const tool of ['yt-dlp.exe', 'yt-dlp', 'ffmpeg.exe', 'ffmpeg']) fs.writeFileSync(path.join(root, tool), '');
  const name = '歌单测试 - fixture-o7hCv63iWoo.mp3';
  const bytes = Buffer.concat([Buffer.from('ID3'), crypto.randomBytes(32000)]);
  fs.writeFileSync(path.join(directory, name), bytes);
  fs.writeFileSync(path.join(directory, '.job.json'), JSON.stringify({ id, state: 'complete', total: 1, files: [{ name, size: bytes.length }], failures: [] }));
  const service = createDownloadService({ toolsDir: root, outputDir: downloads });
  const server = createWebApp({ root, service });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const uploads = [];
  const ranges = [];
  const markers = new Map();
  let starts = 0;
  const api = createGoogleDriveApi(async () => 'fixture-memory-token', { sleepImpl: async () => {}, fetchImpl: async (input, options) => {
    assert.equal(options.headers.Authorization, 'Bearer fixture-memory-token');
    assert.equal(new URL(input).searchParams.has('access_token'), false);
    if (isFolderQuery(input)) return json({ files: [folder] });
    if (options.method === 'POST') {
      starts += 1;
      assert.equal(options.headers['X-Upload-Content-Type'], 'audio/mpeg');
      assert.equal(Number(options.headers['X-Upload-Content-Length']), bytes.length);
      assert.deepEqual(JSON.parse(options.body), { name, mimeType: 'audio/mpeg', parents: [folder.id], properties: { yunganMusic: 'track-v1' } });
      return sessionResponse();
    }
    ranges.push(options.headers['Content-Range']);
    if (options.body) {
      uploads.push(Buffer.from(await options.body.arrayBuffer()));
      // Drive received the complete body, but its first acknowledgement was lost.
      return json({ error: { message: 'Temporary server failure' } }, 503);
    }
    return json({ id: 'verified-upload', name, mimeType: 'audio/mpeg', size: String(bytes.length) });
  } });
  try {
    const config = await (await fetch(`${base}/api/download/bootstrap`)).json();
    const status = await (await fetch(`${base}${config.url}/status`)).json();
    assert.equal(status.ready, true);
    const job = status.jobs.find((item) => item.id === id);
    assert.equal(job.state, 'complete');
    const result = await transferDownloadedFiles(job, {
      getAccount: () => 'verified-account-id', getUpload: () => (file) => api.uploadMusic(file), shouldUpload: () => true,
      isActive: () => true, handled: new Set(), storage: { getItem: (key) => markers.get(key), setItem: (key, value) => markers.set(key, value) },
      fetchFile: async (file) => {
        const response = await fetch(`${base}${config.url}/files/${job.id}/${encodeURIComponent(file.name)}`);
        assert.equal(response.ok, true);
        assert.equal(response.headers.get('Content-Type'), 'audio/mpeg');
        return new File([await response.blob()], file.name, { type: 'audio/mpeg' });
      },
    });
    assert.equal(result.uploaded, 1);
    assert.equal(starts, 1);
    assert.equal(uploads.length, 1);
    assert.deepEqual(uploads[0], bytes);
    assert.deepEqual(ranges, [`bytes 0-${bytes.length - 1}/${bytes.length}`, `bytes */${bytes.length}`]);
    assert.equal(markers.get(`yungan-downloaded-upload:verified-account-id:${id}:${name}`), 'complete');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an expired webpage login during MP3 upload requests re-login and never reports successful completion', async () => {
  let forced = 0;
  let puts = 0;
  let progress = 0;
  const api = createGoogleDriveApi(async ({ force }) => {
    if (force) {
      forced += 1;
      throw Object.assign(new Error('Google 登录已过期，请重新连接。'), { code: 'GOOGLE_AUTH_REQUIRED' });
    }
    return 'fixture-token';
  }, { sleepImpl: async () => { throw new Error('Authentication failures must not retry blindly'); }, fetchImpl: async (input, options) => {
    if (isFolderQuery(input)) return json({ files: [folder] });
    if (options.method === 'POST') return sessionResponse();
    puts += 1;
    return json({ error: { message: 'Expired token' } }, 401);
  } });
  await assert.rejects(api.uploadMusic(new File(['fixture'], 'Song.mp3'), { onProgress: () => { progress += 1; } }), { code: 'GOOGLE_AUTH_REQUIRED' });
  assert.equal(forced, 1);
  assert.equal(puts, 1);
  assert.equal(progress, 0);
});

test('MP3 upload rejects empty files and invalid resumable destinations before sending audio', async () => {
  let calls = 0;
  const api = createGoogleDriveApi(async () => 'fixture-token', { fetchImpl: async (input) => {
    calls += 1;
    if (isFolderQuery(input)) return json({ files: [folder] });
    return new Response(null, { headers: { Location: 'https://untrusted.example/upload' } });
  } });
  await assert.rejects(api.uploadMusic(new File([], 'Empty.mp3')), /文件为空/);
  assert.equal(calls, 0);
  await assert.rejects(api.uploadMusic(new File(['fixture'], 'Song.mp3')), /有效的上传地址/);
  assert.equal(calls, 2);
});
