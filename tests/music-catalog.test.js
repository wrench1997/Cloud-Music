const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { catalogLink, catalogOptions, catalogResult, NEW_MUSIC_PLAYLIST } = require('../src/lib/music-catalog');
const { nativeDownloadRequest } = require('../src/lib/native-download-request');
const { createDownloadService } = require('../electron/download-service');

const artistId = '6LqNN22kT3074XbTVUrhzX';
const albumId = '6QcXrZaGM8gIrvSCNrVlUj';
const trackId = '5KJwFcJc0m1u4F8mVkwT5Y';
const channelId = 'UCsXVk37bltHxD1rDPwtNM8Q';
const embed = (entity) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })}</script>`;
const artistHtml = (artist) => `<script id="initialState" type="text/plain">${Buffer.from(JSON.stringify({ entities: { items: { [`spotify:artist:${artistId}`]: artist } } })).toString('base64')}</script>`;
const track = (id = trackId, title = '新歌') => ({ uri: `spotify:track:${id}`, title, subtitle: '其他歌手', duration: 214559 });

test('catalog links canonicalize real artists and albums while rejecting arbitrary fetch destinations', () => {
  assert.deepEqual(catalogLink(`https://open.spotify.com/intl-zh/embed/artist/${artistId}?si=tracking`), {
    provider: 'spotify', kind: 'artist', id: artistId, url: `https://open.spotify.com/artist/${artistId}`,
  });
  assert.equal(catalogLink(`https://music.youtube.com/browse/${channelId}`).url, `https://www.youtube.com/channel/${channelId}`);
  assert.equal(catalogLink('https://www.youtube.com/@周杰伦/videos').url, 'https://www.youtube.com/@%E5%91%A8%E6%9D%B0%E4%BC%A6');
  assert.equal(catalogLink('https://music.youtube.com/browse/MPREb_album123').kind, 'album');
  assert.equal(catalogLink('https://music.youtube.com/watch?v=abcdefghijk&list=OLAK5uy_album123').url, 'https://music.youtube.com/playlist?list=OLAK5uy_album123');
  for (const url of ['file:///secret', `http://open.spotify.com/artist/${artistId}`, `https://user@open.spotify.com/artist/${artistId}`, `https://open.spotify.com:443/artist/${artistId}`, 'https://evil.test/album/a', `https://open.spotify.com.evil.test/artist/${artistId}`, 'https://www.youtube.com/redirect?q=private', 'https://www.youtube.com/@name/../../redirect', 'https://music.youtube.com/browse/private']) assert.throws(() => catalogLink(url), undefined, url);
});

test('catalog search selects music artists and albums, and new uploads use a bounded date-sorted search URL', () => {
  assert.equal(catalogOptions({ provider: 'youtube', kind: 'artists', query: '周杰伦 & friends' }).requestUrl, 'https://www.youtube.com/results?search_query=%E5%91%A8%E6%9D%B0%E4%BC%A6%20%26%20friends&sp=EgIQAg%3D%3D');
  assert.equal(catalogOptions({ provider: 'youtube', kind: 'new' }).requestUrl, 'https://www.youtube.com/results?search_query=new%20music%20official%20audio&sp=CAISBAgDEAE%3D');
  assert.equal(catalogOptions({ provider: 'spotify', kind: 'new' }).requestUrl, `https://open.spotify.com/embed/playlist/${NEW_MUSIC_PLAYLIST}`);
  assert.equal(catalogOptions({ provider: 'spotify', kind: 'album', url: `https://open.spotify.com/album/${albumId}` }).limit, 100);
  for (const input of [{ provider: 'other', kind: 'new' }, { provider: 'spotify', kind: 'artists', query: 'Kesha' }, { provider: 'youtube', kind: 'albums', query: '' }, { provider: 'youtube', kind: 'new', query: 'a'.repeat(301) }, { provider: 'youtube', kind: 'new', page: 6 }, { provider: 'youtube', kind: 'new', page: '2' }, { provider: 'youtube', kind: 'artist', url: `https://open.spotify.com/artist/${artistId}` }]) assert.throws(() => catalogOptions(input));
});

test('Spotify new music keeps editorial order across pages rather than ranking artists already in the device library', () => {
  const entity = { uri: `spotify:playlist:${NEW_MUSIC_PLAYLIST}`, name: 'New Music Friday', trackList: Array.from({ length: 15 }, (_, index) => track(`${String(index).padStart(22, '0')}`, `新歌 ${index}`)) };
  const result = catalogResult({ provider: 'spotify', kind: 'new', page: 2 }, { html: embed(entity) });
  assert.deepEqual(result.entries.map((item) => item.title), ['新歌 12', '新歌 13', '新歌 14']);
  assert.equal(result.entries[0].artist, '其他歌手');
  assert.equal(result.entries[0].metadataProvider, 'spotify');
  assert.equal(result.hasMore, false);
  assert.equal(catalogResult({ provider: 'spotify', kind: 'new' }, { html: embed(entity) }).hasMore, true);
});

test('Spotify artist latest release precedes popular albums and duplicates are removed without inventing dates', () => {
  const latest = { uri: `spotify:album:${albumId}`, name: '新发行', type: 'SINGLE', date: { year: 2026, month: 10, day: 9 } };
  const artist = { profile: { name: '其他歌手 🎵' }, discography: { latest, singles: { items: [{ releases: { items: [latest] } }] },
    popularReleasesAlbums: { items: [{ uri: 'spotify:album:6fpLLJsDSSAlToEDW2jv4F', name: '旧的热门专辑', date: { year: 2010 }, type: 'ALBUM' }] } } };
  const result = catalogResult({ provider: 'spotify', kind: 'artist', url: `https://open.spotify.com/artist/${artistId}` }, { html: artistHtml(artist) });
  assert.equal(result.title, '其他歌手 🎵');
  assert.equal(result.albums.length, 2);
  assert.equal(result.albums[0].latest, true);
  assert.equal(result.albums[0].releaseDate, '2026-10-09');
  assert.equal(result.albums[1].releaseDate, '2010');
  assert.deepEqual(result.entries, []);
});

test('Spotify album tracks preserve album metadata and individual track pages expose linked credited artists', () => {
  const options = { provider: 'spotify', kind: 'album', url: `https://open.spotify.com/album/${albumId}` };
  const result = catalogResult(options, { html: embed({ uri: `spotify:album:${albumId}`, name: '最新专辑', trackList: [track()] }) });
  assert.equal(result.entries[0].album, '最新专辑');
  assert.equal(result.entries[0].duration, 214.559);
  assert.match(result.entries[0].search, /其他歌手 新歌 official audio/);
  const details = catalogResult({ provider: 'spotify', kind: 'track', url: `https://open.spotify.com/track/${trackId}` }, { html: embed({ ...track(), artists: [{ name: '其他歌手', uri: `spotify:artist:${artistId}` }], releaseDate: { isoString: '2026-10-09T00:00:00Z' } }) });
  assert.equal(details.artists[0].url, `https://open.spotify.com/artist/${artistId}`);
  assert.equal(details.releaseDate, '2026-10-09');
  assert.throws(() => catalogResult(options, { html: embed({ uri: `spotify:album:${artistId}`, trackList: [track()] }) }), /不匹配/);
  assert.throws(() => catalogResult(options, { html: '<h1>Sign in</h1>' }), /暂未返回/);
});

test('new music enrichment uses each matching song artwork, linked artists and release date without changing playlist order', () => {
  const entity = { uri: `spotify:playlist:${NEW_MUSIC_PLAYLIST}`, title: 'New Music Friday', trackList: [track(), track('3cHyrEgdyYRjgJKSOiOtcS', '第二首')] };
  const details = { ...track(), artists: [{ name: '歌手', uri: `spotify:artist:${artistId}` }], releaseDate: { isoString: '2026-10-09T00:00:00Z' }, coverArt: { sources: [{ url: 'https://i.scdn.co/image/new-song', width: 640 }] } };
  const payload = { html: embed(entity), trackDetails: [{ uri: `spotify:track:${trackId}`, html: embed(details) }, { uri: 'spotify:track:3cHyrEgdyYRjgJKSOiOtcS', html: embed(details) }] };
  const result = catalogResult({ provider: 'spotify', kind: 'new' }, payload);
  assert.deepEqual(result.entries.map((item) => item.title), ['新歌', '第二首']);
  assert.equal(result.entries[0].coverUrl, 'https://i.scdn.co/image/new-song');
  assert.equal(result.entries[0].artists[0].url, `https://open.spotify.com/artist/${artistId}`);
  assert.equal(result.entries[0].releaseDate, '2026-10-09');
  assert.equal(result.entries[1].coverUrl, '');
});

test('YouTube Music catalogs retain artists and albums instead of dropping every non-video ID', () => {
  const artist = { title: '歌手频道', channel_is_verified: true, url: `https://music.youtube.com/channel/${channelId}`, thumbnails: [{ url: 'https://yt3.googleusercontent.com/artist', width: 300 }] };
  const result = catalogResult({ provider: 'youtube', kind: 'artists', query: '歌手' }, { data: { entries: [artist, artist, { title: 'Evil', url: 'https://evil.test/channel/private' }, { id: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk' }] } });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].verified, true);
  assert.equal(result.items[0].coverUrl, 'https://yt3.googleusercontent.com/artist');
  const album = catalogResult({ provider: 'youtube', kind: 'albums', query: '专辑' }, { data: { entries: [{ title: '最新专辑', url: 'https://music.youtube.com/browse/MPREb_album123' }] } });
  assert.equal(album.items[0].kind, 'album');
});

test('latest YouTube uploads keep platform order and channel identities and do not describe upload dates as song release dates', () => {
  const rows = Array.from({ length: 13 }, (_, index) => ({ id: String(index).padStart(11, '0'), title: `上传 ${index}`, channel: '频道', channel_url: `https://www.youtube.com/channel/${channelId}`, upload_date: '20261010' }));
  rows[0].thumbnail = 'https://evil.test/cover';
  const result = catalogResult({ provider: 'youtube', kind: 'new' }, { data: { entries: rows } });
  assert.equal(result.entries.length, 12); assert.equal(result.hasMore, true);
  assert.equal(result.entries[0].title, '上传 0');
  assert.equal(result.entries[0].artistIsChannel, true);
  assert.equal(result.entries[0].artistUrl, `https://www.youtube.com/channel/${channelId}`);
  assert.equal(result.entries[0].uploadedAt, '2026-10-10');
  assert.equal(result.entries[0].uploadDateApproximate, false);
  assert.equal(result.entries[0].coverUrl, 'https://i.ytimg.com/vi/00000000000/hqdefault.jpg');
  assert.match(result.notice, /上传时间不代表歌曲首发/);
  const artist = catalogResult({ provider: 'youtube', kind: 'artist', url: `https://www.youtube.com/channel/${channelId}` }, { data: { title: '频道 - Videos', channel: '歌手', entries: rows } });
  assert.equal(artist.title, '歌手');
  const channel = catalogResult({ provider: 'youtube', kind: 'artist', url: `https://www.youtube.com/channel/${channelId}` }, { data: { channel: '歌手频道', entries: [{ id: 'abcdefghijk', title: '频道曲目', timestamp: Date.UTC(2026, 6, 11) / 1000 }] } });
  assert.equal(channel.entries[0].artist, '歌手频道');
  assert.equal(channel.entries[0].artistIsChannel, true);
  assert.equal(channel.entries[0].artistUrl, `https://www.youtube.com/channel/${channelId}`);
  assert.equal(channel.entries[0].uploadedAt, '2026-07-11');
  assert.equal(channel.entries[0].uploadDateApproximate, true);
});

test('Android raw catalog responses use the same parser and metadata contract as Windows', async () => {
  const input = { provider: 'spotify', kind: 'album', url: `https://open.spotify.com/album/${albumId}` };
  const payload = { html: embed({ uri: `spotify:album:${albumId}`, name: '最新专辑', trackList: [track()] }) };
  let received;
  const result = await nativeDownloadRequest({ request: async (value) => { received = value; return payload; } }, '/catalog', input);
  assert.deepEqual(result, catalogResult(input, payload));
  assert.deepEqual(received, { route: '/catalog', method: 'POST', data: input });
});

test('authenticated Windows catalog uses bounded no-download music search, caches results, and validates before spawning', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-catalog-'));
  for (const name of ['yt-dlp.exe', 'yt-dlp']) fs.writeFileSync(path.join(root, name), '');
  const commands = [];
  const spawnProcess = (_executable, args, options) => {
    commands.push({ args, options });
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => child.emit('close', 1);
    const data = args.at(-1).endsWith('#albums') ? { entries: [{ url: 'https://music.youtube.com/browse/MPREb_album123' }] }
      : args.at(-1).includes('/browse/MPREb_') ? { title: 'Album - 实际专辑名称', thumbnails: [{ url: 'https://i9.ytimg.com/album.jpg', width: 640 }], entries: [{ id: 'abcdefghijk', channel: '真实歌手' }] }
      : { entries: [{ title: '歌手', url: `https://music.youtube.com/channel/${channelId}` }] };
    setImmediate(() => { child.stdout.write(JSON.stringify(data)); child.emit('close', 0); });
    return child;
  };
  const service = createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads'), spawnProcess });
  try {
    const config = await service.connect();
    const input = { provider: 'youtube', kind: 'artists', query: '其他歌手', page: 2 };
    assert.equal((await fetch(`${config.url}/catalog`, { method: 'POST', body: JSON.stringify(input) })).status, 401);
    const headers = { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' };
    const result = await (await fetch(`${config.url}/catalog`, { method: 'POST', headers, body: JSON.stringify(input) })).json();
    assert.equal(result.items[0].kind, 'artist');
    await service.catalog(input);
    assert.equal(commands.length, 1);
    const albums = await service.catalog({ provider: 'youtube', kind: 'albums', query: '专辑' });
    assert.equal(albums.items[0].title, '实际专辑名称');
    assert.equal(albums.items[0].artist, '真实歌手');
    assert.equal(albums.items[0].coverUrl, 'https://i9.ytimg.com/album.jpg');
    assert.equal(commands.length, 3);
    assert.equal(commands[2].args[commands[2].args.indexOf('--playlist-end') + 1], '1');
    const command = commands[0];
    assert.equal(command.options.shell, false);
    assert.ok(command.args.includes('--skip-download'));
    assert.equal(command.args[command.args.indexOf('--playlist-start') + 1], '13');
    assert.equal(command.args[command.args.indexOf('--playlist-end') + 1], '25');
    assert.ok(command.args.at(-1).endsWith('sp=EgIQAg%3D%3D'));
    assert.equal((await fetch(`${config.url}/catalog`, { method: 'POST', headers, body: JSON.stringify({ provider: 'youtube', kind: 'artist', url: 'https://evil.test/channel/private' }) })).status, 400);
    assert.equal(commands.length, 3);
  } finally { service.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('Spotify catalog works without audio tools and failed pages remain retryable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spotify-catalog-'));
  let calls = 0;
  const service = createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads'), fetchImpl: async (url) => {
    if (url.includes('/track/')) return new Response('Unavailable', { status: 503 });
    calls++;
    return calls === 1 ? new Response('Unavailable', { status: 503 }) : new Response(embed({ uri: `spotify:playlist:${NEW_MUSIC_PLAYLIST}`, name: 'New Music Friday', trackList: [track()] }));
  } });
  try {
    await assert.rejects(service.catalog({ provider: 'spotify', kind: 'new' }), /503/);
    assert.equal((await service.catalog({ provider: 'spotify', kind: 'new' })).entries[0].title, '新歌');
    assert.equal(calls, 2);
  } finally { service.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
});
