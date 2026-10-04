const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createDownloadService, searchOptions } = require('../electron/download-service');

const modulePromise = import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname, '../src/lib/music-discovery.js')).toString('base64')}`);

test('local recommendation seeds give favorite and recent artists priority and explain the evidence', async () => {
  const { recommendationSeeds } = await modulePromise;
  const songs = [
    { id: 'first', artist: 'Just in library' }, { id: 'favorite', artist: '收藏歌手' },
    { id: 'recent', artist: 'Recent Artist' }, { id: 'invalid', artist: '未知歌手' },
    { id: 'dupe', artist: '收藏歌手' },
  ];
  const seeds = recommendationSeeds({ songs, favorites: ['favorite'], recent: ['recent'] });
  assert.deepEqual(seeds.map((seed) => seed.label), ['收藏歌手', 'Recent Artist', 'Just in library']);
  assert.match(seeds[0].reason, /收藏了 1 首/); assert.match(seeds[1].reason, /最近听过/);
  assert.match(seeds[2].reason, /曲库里有 1 首/);
  assert.equal(seeds[0].query, '收藏歌手 official audio');
  assert.deepEqual(recommendationSeeds(), []);
  assert.equal(recommendationSeeds({ songs: Array.from({ length: 50 }, (_, index) => ({ id: index, artist: `Artist ${index}` })) }).length, 8);
});

test('discovery ranks actual music results, deduplicates URLs and excludes songs already in the library', async () => {
  const { rankDiscoveryResults } = await modulePromise;
  const known = { title: 'Known', artist: 'Artist', url: 'https://www.youtube.com/watch?v=o7hCv63iWoo', duration: 120 };
  const matching = { title: 'Artist - New Song (Official Audio)', artist: 'Uploader', url: 'https://www.youtube.com/watch?v=BaW_jenozKc', duration: 210 };
  const long = { title: 'A full concert', artist: 'Uploader', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', duration: 10000 };
  const options = { songs: [{ title: known.title, artist: known.artist, sourceUrl: known.url }], seed: { label: 'Artist', reason: '你最近听过 Artist' } };
  const ranked = rankDiscoveryResults([long, known, matching, matching], options);
  assert.deepEqual(ranked.map((entry) => entry.url), [matching.url, long.url]);
  assert.equal(ranked[0].reason, options.seed.reason);
  assert.equal(rankDiscoveryResults([known], { ...options, hideKnown: false })[0].inLibrary, true);
  assert.deepEqual(rankDiscoveryResults(null), []);
});

test('platform search links safely encode queries and duration uses minute-second notation', async () => {
  const { platformSearchLink, formatDiscoveryDuration } = await modulePromise;
  assert.equal(platformSearchLink('spotify', '歌手 / #音乐'), 'https://open.spotify.com/search/%E6%AD%8C%E6%89%8B%20%2F%20%23%E9%9F%B3%E4%B9%90');
  assert.equal(platformSearchLink('youtube', 'Kesha & TiK ToK'), 'https://music.youtube.com/search?q=Kesha%20%26%20TiK%20ToK');
  assert.equal(platformSearchLink('spotify', ''), '');
  assert.equal(formatDiscoveryDuration(210), '3:30'); assert.equal(formatDiscoveryDuration(0), '时长待确认');
});

test('YouTube search validates query and pagination before starting a tool process', () => {
  assert.deepEqual(searchOptions({ query: '  Kesha\n audio  ' }), { query: 'Kesha  audio', page: 1, limit: 12 });
  for (const value of [{ query: '' }, { query: 'a'.repeat(301) }, { query: 5 }, { query: 'artist', page: 0 }, { query: 'artist', page: 6 }, { query: 'artist', page: '2' }, { query: 'artist', limit: 21 }, { query: 'artist', limit: -1 }]) assert.throws(() => searchOptions(value));
});

test('authenticated discovery search returns bounded real-source candidates without downloading audio or invoking a shell', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-discovery-'));
  for (const name of ['yt-dlp.exe', 'yt-dlp', 'ffmpeg.exe', 'ffmpeg']) fs.writeFileSync(path.join(root, name), '');
  const commands = [];
  const spawnProcess = (executable, args, options) => {
    commands.push({ executable, args, options });
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => child.emit('close', 1);
    setImmediate(() => {
      child.stdout.write(JSON.stringify({ entries: [
        { id: 'o7hCv63iWoo', title: 'First', uploader: 'Channel', duration: 200, thumbnail: 'https://evil.test/cover.jpg' },
        { id: 'o7hCv63iWoo', title: 'Duplicate' },
        { id: 'BaW_jenozKc', title: 'Second', artist: 'Actual artist', duration: 210, thumbnail: 'https://i.ytimg.com/vi/BaW_jenozKc/hqdefault.jpg' },
        { id: 'aaaaaaaaaaa', title: 'More', duration: 180 },
        { id: '../invalid', title: 'Invalid' },
      ] })); child.emit('close', 0);
    });
    return child;
  };
  const service = createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads'), spawnProcess });
  try {
    const config = await service.connect();
    assert.equal((await fetch(`${config.url}/search`, { method: 'POST', body: JSON.stringify({ query: 'Kesha' }) })).status, 401);
    const headers = { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' };
    const invalid = await fetch(`${config.url}/search`, { method: 'POST', headers, body: JSON.stringify({ query: 'Kesha', page: 6 }) });
    assert.equal(invalid.status, 400); assert.equal(commands.length, 0);
    const response = await fetch(`${config.url}/search`, { method: 'POST', headers, body: JSON.stringify({ query: 'Kesha " --exec touch', page: 2, limit: 2 }) });
    const result = await response.json();
    assert.equal(response.status, 200); assert.equal(result.provider, 'youtube'); assert.equal(result.page, 2); assert.equal(result.hasMore, true);
    assert.equal(result.entries.length, 2); assert.equal(result.entries[0].artistIsChannel, true); assert.equal(result.entries[1].artistIsChannel, false);
    assert.equal(result.entries[0].coverUrl, 'https://i.ytimg.com/vi/o7hCv63iWoo/hqdefault.jpg');
    assert.equal(result.entries[1].url, 'https://www.youtube.com/watch?v=BaW_jenozKc');
    const command = commands[0];
    assert.equal(command.options.shell, false); assert.ok(command.args.includes('--skip-download')); assert.ok(!command.args.includes('-x'));
    assert.equal(command.args.at(-1), 'ytsearch5:Kesha " --exec touch');
    assert.equal(command.args[command.args.indexOf('--playlist-start') + 1], '3');
    assert.equal(command.args[command.args.indexOf('--playlist-end') + 1], '5');
    assert.equal(fs.readdirSync(path.join(root, 'downloads')).length, 0);
  } finally { service.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
});
