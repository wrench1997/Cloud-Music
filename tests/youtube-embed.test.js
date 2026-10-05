const test = require('node:test');
const assert = require('node:assert/strict');
const { APP_REFERER, youtubeEmbedHeaders } = require('../electron/youtube-embed');

const window = { isDestroyed: () => false, webContents: { id: 42, getURL: () => 'file:///app/out/index.html' } };
const request = (overrides = {}) => ({ url: 'https://www.youtube.com/embed/HMJPG2I42xg', resourceType: 'subFrame', webContentsId: 42, requestHeaders: { 'User-Agent': 'Chromium' }, ...overrides });

test('file-based desktop embeds send the installed app identity without changing other headers', () => {
  const details = request();
  assert.deepEqual(youtubeEmbedHeaders(details, window), { 'User-Agent': 'Chromium', Referer: APP_REFERER });
  assert.equal(details.requestHeaders.Referer, undefined);
  assert.equal(youtubeEmbedHeaders(request({ url: 'https://www.youtube-nocookie.com/embed/HMJPG2I42xg' }), window).Referer, APP_REFERER);
  assert.deepEqual(youtubeEmbedHeaders(request({ requestHeaders: { referer: 'file:///app/out/index.html' } }), window), { Referer: APP_REFERER });
});

test('real HTTP origins retain their referrer and other pages/windows are left untouched', () => {
  const headers = { Referer: 'https://music.example/', Cookie: 'existing' };
  assert.deepEqual(youtubeEmbedHeaders(request({ requestHeaders: headers }), window), headers);
  for (const overrides of [{ webContentsId: 43 }, { resourceType: 'xhr' }, { url: 'https://www.youtube.com/watch?v=HMJPG2I42xg' }, { url: 'https://www.youtube.com.evil.test/embed/HMJPG2I42xg' }, { url: 'http://www.youtube.com/embed/HMJPG2I42xg' }]) {
    assert.deepEqual(youtubeEmbedHeaders(request(overrides), window), { 'User-Agent': 'Chromium' });
  }
  const webWindow = { ...window, webContents: { ...window.webContents, getURL: () => 'http://localhost:3000' } };
  assert.deepEqual(youtubeEmbedHeaders(request(), webWindow), { 'User-Agent': 'Chromium' });
});
