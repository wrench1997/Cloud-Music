const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Load the pure ESM browser module without changing the application's module type.
const modulePromise = import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname, '../src/lib/online-playlists.js')).toString('base64')}`);
const matchingPromise = import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname, '../src/lib/source-matching.js')).toString('base64')}`);

test('YouTube Music user playlist and watch links produce the same safe player URL', async () => {
  const { parsePlaylistLink } = await modulePromise;
  const playlist = parsePlaylistLink('https://music.youtube.com/playlist?list=PLajX1VL9dSWQ');
  assert.equal(playlist.embedUrl, 'https://www.youtube.com/embed/videoseries?list=PLajX1VL9dSWQ&playsinline=1&rel=0');
  assert.deepEqual(parsePlaylistLink('https://www.youtube.com/watch?v=o7hCv63iWoo&list=PLajX1VL9dSWQ&si=tracking'), playlist);
});
test('Spotify sharing, localized and embed URLs discard tracking parameters', async () => {
  const { parsePlaylistLink } = await modulePromise;
  const expected = parsePlaylistLink('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=tracking');
  assert.deepEqual(parsePlaylistLink('https://open.spotify.com/intl-zh/playlist/37i9dQZF1DXcBWIGoYBM5M'), expected);
  assert.deepEqual(parsePlaylistLink(expected.embedUrl), expected);
});
test('untrusted links and malformed IDs cannot create arbitrary embedded content', async () => {
  const { parsePlaylistLink } = await modulePromise;
  for (const link of ['javascript:alert(1)', 'http://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', 'https://open.spotify.com.evil.test/playlist/37i9dQZF1DXcBWIGoYBM5M', 'https://user:secret@music.youtube.com/playlist?list=PLajX1VL9dSWQ', 'https://music.youtube.com:443/playlist?list=%22%3E', 'https://music.youtube.com/watch?v=o7hCv63iWoo', 'https://open.spotify.com/track/37i9dQZF1DXcBWIGoYBM5M', 'https://music.youtube.com/playlist?list=short']) assert.throws(() => parsePlaylistLink(link));
});
test('stored playlists are sanitized, deduplicated and bounded', async () => {
  const { normalizePlaylists } = await modulePromise;
  const url = 'https://music.youtube.com/playlist?list=PLajX1VL9dSWQ';
  const items = normalizePlaylists([{ url, name: '  2111  ', embedUrl: 'https://evil.test' }, { url, name: 'duplicate' }, { url: 'https://evil.test' }, null]);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, '2111');
  assert.ok(items[0].embedUrl.startsWith('https://www.youtube.com/embed/'));
  assert.deepEqual(normalizePlaylists({}), []);
});

test('automatic source matching requires title, artist and similar duration', async () => {
  const { recommendSource } = await matchingPromise;
  const track = { title: 'TiK ToK', artist: 'Kesha', duration: 200 };
  const correct = { title: 'Kesha - TiK ToK (Lyrics)', artist: '7clouds', duration: 201, url: 'https://www.youtube.com/watch?v=OF04pKp-r9o' };
  assert.equal(recommendSource(track, [{ title: 'Kesha concert', artist: 'Kesha', duration: 201 }, correct]), correct);
  assert.equal(recommendSource(track, [{ ...correct, duration: 500 }]), null);
  assert.equal(recommendSource(track, [{ title: 'TiK ToK', artist: 'Someone else', duration: 200 }]), null);
});

