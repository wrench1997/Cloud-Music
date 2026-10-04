const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createWebApp } = require('../scripts/web-app.cjs');
const { createDownloadService } = require('../electron/download-service');

test('web host serves frontend and authenticated backend together without exposing a pairing token', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-web-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>Music</h1>');
  const service = createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads') });
  const server = createWebApp({ root, service });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.match(await (await fetch(base)).text(), /Music/);
    const config = await (await fetch(`${base}/api/download/bootstrap`)).json();
    assert.deepEqual(config, { url: '/api/download', token: '', integrated: true });
    const status = await fetch(`${base}${config.url}/status`);
    assert.equal(status.status, 200);
    assert.equal((await status.json()).ready, false);
    for (const route of ['bootstrap', 'status', 'inspect']) {
      assert.equal((await fetch(`${base}/api/download/${route}`, { headers: { Origin: 'https://evil.example' } })).status, 403);
      const hostStatus = await new Promise((resolve, reject) => {
        http.get(`${base}/api/download/${route}`, { headers: { Host: 'evil.example' } }, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject);
      });
      assert.equal(hostStatus, 403);
    }
    assert.equal((await fetch(`${base}/api/download/status`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    const invalid = await fetch(`${base}/api/download/inspect`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'file:///etc/passwd' }) });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /HTTPS|链接/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
