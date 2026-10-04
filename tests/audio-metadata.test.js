const test = require('node:test');
const assert = require('node:assert/strict');
const { parseId3, readAudioMetadata, truncateUtf8, metadataProperties, thumbnailFromMetadata, mergeAudioMetadata, musicFileName } = require('../src/lib/audio-metadata');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9QAAAABJRU5ErkJggg==', 'base64');
const sizeBytes = (size, version) => {
  const bytes = Buffer.alloc(4);
  if (version === 4) for (let index = 3; index >= 0; index -= 1) { bytes[index] = size & 127; size >>>= 7; }
  else bytes.writeUInt32BE(size);
  return bytes;
};
const frame = (id, bytes, version = 3, flags = 0) => Buffer.concat([Buffer.from(id), sizeBytes(bytes.length, version), Buffer.from([0, flags]), bytes]);
const tag = (frames, version = 3, flags = 0) => {
  const data = Buffer.concat(frames);
  return Buffer.concat([Buffer.from([73, 68, 51, version, 0, flags]), sizeBytes(data.length, 4), data]);
};
const utf16 = (text) => Buffer.concat([Buffer.from([1, 255, 254]), Buffer.from(text, 'utf16le'), Buffer.from([0, 0])]);
const utf8 = (text) => Buffer.concat([Buffer.from([3]), Buffer.from(text), Buffer.from([0])]);
const picture = (data = png, type = 3) => Buffer.concat([Buffer.from([1]), Buffer.from('image/png\0'), Buffer.from([type, 255, 254]), Buffer.from('封面', 'utf16le'), Buffer.from([0, 0]), data]);

test('ID3v2.3 reads UTF-16 Chinese and emoji, album, millisecond length, and the front APIC cover', async () => {
  const bytes = tag([
    frame('TIT2', utf16('夜曲 🌙')),
    frame('TPE1', utf16('周杰伦')),
    frame('TALB', utf16('十一月的萧邦')),
    frame('TLEN', Buffer.from([0, ...Buffer.from('219500')])),
    frame('APIC', picture(png, 4)),
    frame('APIC', picture()),
  ]);
  const file = new File([bytes, new Uint8Array(32)], 'untidy-video-id.mp3', { type: 'audio/mpeg' });
  const metadata = await readAudioMetadata(file);
  assert.equal(metadata.title, '夜曲 🌙');
  assert.equal(metadata.artist, '周杰伦');
  assert.equal(metadata.album, '十一月的萧邦');
  assert.equal(metadata.duration, 219.5);
  assert.equal(metadata.picture.type, 3);
  assert.deepEqual(Buffer.from(metadata.picture.data), png);
  const thumbnail = thumbnailFromMetadata(metadata);
  assert.equal(thumbnail.mimeType, 'image/png');
  assert.deepEqual(Buffer.from(thumbnail.image, 'base64url'), png);
  assert.doesNotMatch(thumbnail.image, /[+/=]/);
});

test('ID3v2.4 uses synchsafe frame lengths and reads UTF-8 and unsynchronised JPEG bytes', () => {
  const title = 'Spotify 保留原始曲名 🎶'.repeat(15);
  const jpeg = Buffer.from([255, 216, 255, 225, 255, 0, 226, 255, 0, 0, 217]);
  const apic = Buffer.concat([Buffer.from([3]), Buffer.from('image/jpeg\0'), Buffer.from([3, 0]), jpeg]);
  const metadata = parseId3(tag([frame('TIT2', utf8(title), 4), frame('TPE1', utf8('Artist A\0Artist B'), 4), frame('APIC', apic, 4, 2)], 4));
  assert.equal(metadata.title, title);
  assert.equal(metadata.artist, 'Artist A / Artist B');
  assert.deepEqual(Buffer.from(metadata.picture.data), Buffer.from([255, 216, 255, 225, 255, 226, 255, 0, 217]));
});

test('malformed, unsupported, compressed and unsafe picture frames are ignored without blocking audio uploads', async () => {
  assert.deepEqual(parseId3(Buffer.from('not an ID3 tag')), {});
  const wrongSize = tag([frame('TIT2', utf16('bad'))]);
  wrongSize[6] = 128;
  assert.deepEqual(parseId3(wrongSize), {});
  const frames = [frame('TIT2', utf16('compressed'), 3, 128), frame('TPE1', utf16('valid artist')), frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/svg+xml\0'), Buffer.from([3, 0]), Buffer.from('<svg/>')]))];
  const metadata = parseId3(tag(frames));
  assert.equal(metadata.title, undefined);
  assert.equal(metadata.artist, 'valid artist');
  assert.equal(metadata.picture, undefined);
  assert.deepEqual(await readAudioMetadata(new File(['audio'], 'Track.flac')), {});
  const abort = new AbortController(); abort.abort();
  await assert.rejects(readAudioMetadata(new File(['audio'], 'Track.mp3'), { signal: abort.signal }), { name: 'AbortError' });
});

test('ID3v2.3 and 2.4 extended headers advance to the first real frame', () => {
  const v3extended = Buffer.concat([sizeBytes(6, 3), Buffer.alloc(6)]);
  const v4extended = Buffer.concat([sizeBytes(6, 4), Buffer.from([1, 0])]);
  assert.equal(parseId3(tag([v3extended, frame('TIT2', utf16('v3 extended'))], 3, 64)).title, 'v3 extended');
  assert.equal(parseId3(tag([v4extended, frame('TIT2', utf8('v4 extended'), 4)], 4, 64)).title, 'v4 extended');
});

test('ID3v2.3 global unsynchronisation is undone before reading frame lengths and Latin-1 text', () => {
  const plain = frame('TIT2', Buffer.from([0, 255, 224]));
  const encoded = [];
  for (let index = 0; index < plain.length; index += 1) {
    encoded.push(plain[index]);
    if (plain[index] === 255 && (plain[index + 1] === 0 || plain[index + 1] >= 224)) encoded.push(0);
  }
  const bytes = tag([Buffer.from(encoded)], 3, 128);
  assert.equal(parseId3(bytes).title, 'ÿà');
});

test('Drive properties respect the 124 UTF-8 byte key/value limit and preserve complete Unicode characters', () => {
  const title = '中文🎵'.repeat(40);
  const properties = metadataProperties({ title, artist: '🎵'.repeat(80), album: '专辑'.repeat(80), duration: 213.1, coverUrl: 'https://i.scdn.co/image/cover', sourceUrl: 'https://youtu.be/HMJPG2I42xg' });
  for (const [key, value] of Object.entries(properties)) assert.ok(Buffer.byteLength(key + value) <= 124, `${key} is too long`);
  assert.equal(properties.title.includes('\ufffd'), false);
  assert.equal(Buffer.from(properties.title).toString(), properties.title);
  assert.equal(truncateUtf8('A🎵中B', 5), 'A🎵');
  assert.equal(properties.duration, '213.1');
  assert.equal(properties.coverUrl, 'https://i.scdn.co/image/cover');
  assert.deepEqual(metadataProperties({ coverUrl: 'javascript:alert(1)', sourceUrl: 'https://example.test/' + 'x'.repeat(200), duration: Infinity }), {});
});

test('explicit playlist metadata wins over embedded tags without losing an embedded cover or fallback fields', () => {
  const merged = mergeAudioMetadata({ title: 'YouTube title', artist: 'uploader', album: 'Tagged album', duration: 99, picture: { data: png } }, { title: 'Spotify song', artist: 'Original artist', album: '', duration: 101, coverUrl: 'https://i.scdn.co/image/cover' });
  assert.equal(merged.title, 'Spotify song');
  assert.equal(merged.artist, 'Original artist');
  assert.equal(merged.album, 'Tagged album');
  assert.equal(merged.duration, 101);
  assert.deepEqual(merged.picture.data, png);
  assert.equal(musicFileName({ title: 'Song: Remastered / Mix', artist: 'Artist' }), 'Artist - Song_ Remastered _ Mix.mp3');
});
