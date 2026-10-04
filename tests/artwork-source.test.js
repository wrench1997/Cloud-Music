const { test } = require('node:test');
const assert = require('node:assert/strict');
const { artworkSource } = require('../src/lib/artwork-source');

test('offline native artwork accepts the same-origin Capacitor file URL used by this Android WebView', () => {
  const coverUrl = 'http://localhost/_capacitor_file_/data/user/0/com.music.player/no_backup/native-music/cover.jpg';
  assert.equal(artworkSource({ coverUrl, localUri: 'file:///data/user/0/com.music.player/music.mp3' }, 'http://localhost'), coverUrl);
  assert.equal(artworkSource({ coverUrl }, 'http://localhost'), '');
});

test('cover selection rejects arbitrary cleartext and cross-origin files while keeping official HTTPS artwork', () => {
  const localUri = 'file:///data/music.mp3';
  for (const coverUrl of ['http://evil.test/_capacitor_file_/cover.jpg', 'http://localhost/private', 'file:///data/cover.jpg', 'javascript:alert(1)']) assert.equal(artworkSource({ localUri, coverUrl }, 'http://localhost'), '');
  assert.equal(artworkSource({ coverUrl: 'https://i.ytimg.com/vi/OF04pKp-r9o/hqdefault.jpg' }), 'https://i.ytimg.com/vi/OF04pKp-r9o/hqdefault.jpg');
});
