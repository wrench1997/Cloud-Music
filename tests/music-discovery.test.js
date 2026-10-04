const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createDownloadService, searchOptions, radioOptions } = require('../electron/download-service');

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

test('song radio seeds prefer the current song, then recent and favorites, using real source IDs', async () => {
  const { radioSeeds, youtubeVideoId, youtubeRadioLink } = await modulePromise;
  const current = { id: 'current', title: 'Current', artist: 'Artist', sourceUrl: 'https://www.youtube.com/watch?v=iP6XpLQM2Cs' };
  const recent = { id: 'recent', title: 'Recent', sourceUrl: 'https://youtu.be/2Abk1jAONjw' };
  const favorite = { id: 'favorite', title: 'Favorite', sourceUrl: 'https://music.youtube.com/watch?v=kTHNpusq654' };
  const seeds = radioSeeds({ currentSong: current, songs: [favorite, recent, current, { id: 'bad', sourceUrl: 'https://evil.test/watch?v=aaaaaaaaaaa' }], recent: ['recent'], favorites: ['favorite'], currentQueue: [current] });
  assert.deepEqual(seeds.map((seed) => seed.title), ['Current', 'Recent', 'Favorite']);
  assert.deepEqual(seeds.map((seed) => seed.reason), ['当前歌曲', '最近播放', '你的收藏']);
  assert.equal(youtubeVideoId('https://music.youtube.com/watch?v=iP6XpLQM2Cs&list=RDAMVMiP6XpLQM2Cs'), 'iP6XpLQM2Cs');
  assert.equal(youtubeRadioLink(current.sourceUrl), 'https://music.youtube.com/watch?v=iP6XpLQM2Cs&list=RDAMVMiP6XpLQM2Cs');
  for (const url of ['http://www.youtube.com/watch?v=iP6XpLQM2Cs', 'https://youtube.com.evil.test/watch?v=iP6XpLQM2Cs', 'https://user:pw@youtube.com/watch?v=iP6XpLQM2Cs', 'https://youtube.com/redirect?v=iP6XpLQM2Cs', 'https://www.youtube.com/playlist?list=RDAMVMiP6XpLQM2Cs']) assert.equal(youtubeVideoId(url), '');
});

test('platform radio order survives filtering and is not replaced by artist-keyword ranking', async () => {
  const { rankDiscoveryResults } = await modulePromise;
  const entries = [
    { title: 'Different artist', artist: 'Artist B', url: 'https://www.youtube.com/watch?v=2Abk1jAONjw', duration: 300 },
    { title: 'Seed Artist Official Audio', artist: 'Seed Artist', url: 'https://www.youtube.com/watch?v=iP6XpLQM2Cs', duration: 200 },
  ];
  assert.deepEqual(rankDiscoveryResults(entries, { seed: { label: 'Seed Artist' }, preserveOrder: true }).map((entry) => entry.title), entries.map((entry) => entry.title));
});

test('Spotify chart entry links contain complete verified official daily chart IDs, never static tracks', async () => {
  const { spotifyCharts } = await modulePromise;
  const { parseSource } = require('../electron/download-service');
  assert.deepEqual(spotifyCharts.map((chart) => chart.key), ['global', 'hk', 'tw']);
  for (const chart of spotifyCharts) {
    assert.match(chart.url, /^https:\/\/open\.spotify\.com\/playlist\/[A-Za-z0-9]{22}$/);
    assert.equal(parseSource(chart.url).provider, 'spotify');
    assert.equal(chart.entries, undefined);
  }
});

test('radio validation fixes the upstream host and whitelists only the seed song matching RD variants', () => {
  const expected = radioOptions({ videoId: 'iP6XpLQM2Cs' });
  assert.equal(expected.url, 'https://music.youtube.com/watch?v=iP6XpLQM2Cs&list=RDAMVMiP6XpLQM2Cs');
  assert.equal(radioOptions({ videoId: 'iP6XpLQM2Cs', radioId: 'RDiP6XpLQM2Cs', page: 5, limit: 20 }).url, 'https://www.youtube.com/watch?v=iP6XpLQM2Cs&list=RDiP6XpLQM2Cs');
  for (const value of [{ videoId: 'https://evil.test/' }, { videoId: '../invalid' }, { videoId: 'iP6XpLQM2Cs', radioId: 'RDAMVM2Abk1jAONjw' }, { videoId: 'iP6XpLQM2Cs', radioId: 'https://localhost' }, { videoId: 'iP6XpLQM2Cs', radioId: 'PLiP6XpLQM2Cs' }, { videoId: 'iP6XpLQM2Cs', page: 6 }, { videoId: 'iP6XpLQM2Cs', limit: 21 }]) assert.throws(() => radioOptions(value));
});

test('radio extraction is authorized and bounded, keeps platform order, and returns per-track download URLs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-radio-'));
  for (const name of ['yt-dlp.exe', 'yt-dlp', 'ffmpeg.exe', 'ffmpeg']) fs.writeFileSync(path.join(root, name), '');
  const commands = [];
  const spawnProcess = (executable, args, options) => {
    commands.push({ executable, args, options });
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => child.emit('close', 1);
    setImmediate(() => { child.stdout.write(JSON.stringify({ id: 'RDAMVMiP6XpLQM2Cs', title: 'Mix - Kesha', entries: [
      { id: '2Abk1jAONjw', title: 'Lady Gaga - Just Dance', uploader: 'Lady Gaga', duration: 247 },
      { id: 'kTHNpusq654', title: 'Katy Perry - Hot N Cold', uploader: 'Katy Perry', duration: 284 },
      { id: 'hHUbLv4ThOo', title: 'Pitbull, Ke$ha - Timber', uploader: 'Pitbull', duration: 215 },
    ] })); child.emit('close', 0); });
    return child;
  };
  const service = createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads'), spawnProcess });
  try {
    const config = await service.connect();
    assert.equal((await fetch(`${config.url}/radio`, { method: 'POST', body: JSON.stringify({ videoId: 'iP6XpLQM2Cs' }) })).status, 401);
    const headers = { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' };
    const invalid = await fetch(`${config.url}/radio`, { method: 'POST', headers, body: JSON.stringify({ videoId: 'iP6XpLQM2Cs', radioId: 'https://evil.test/' }) });
    assert.equal(invalid.status, 400); assert.equal(commands.length, 0);
    const response = await fetch(`${config.url}/radio`, { method: 'POST', headers, body: JSON.stringify({ videoId: 'iP6XpLQM2Cs', page: 2, limit: 2 }) });
    const result = await response.json();
    assert.equal(response.status, 200); assert.equal(result.recommendationProvider, 'youtube-mix'); assert.equal(result.hasMore, true);
    assert.equal(result.entries.length, 2); assert.equal(result.entries[0].title, 'Lady Gaga - Just Dance');
    assert.equal(result.entries[0].url, 'https://www.youtube.com/watch?v=2Abk1jAONjw');
    assert.ok(!result.entries[0].url.includes('list='));
    const command = commands[0];
    assert.equal(command.options.shell, false); assert.ok(command.args.includes('--skip-download')); assert.ok(command.args.includes('--yes-playlist')); assert.ok(!command.args.includes('-x'));
    assert.equal(command.args.at(-1), 'https://music.youtube.com/watch?v=iP6XpLQM2Cs&list=RDAMVMiP6XpLQM2Cs');
    assert.equal(command.args[command.args.indexOf('--playlist-start') + 1], '3');
    assert.equal(command.args[command.args.indexOf('--playlist-end') + 1], '5');
    assert.equal(fs.readdirSync(path.join(root, 'downloads')).length, 0);
    const repeated = await service.radio({ videoId: 'iP6XpLQM2Cs', page: 2, limit: 2 });
    assert.deepEqual(repeated.entries, result.entries); assert.equal(commands.length, 1);
  } finally { service.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('an unavailable public radio stays an explicit error and retries do not fall back to keyword search', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-radio-empty-'));
  for (const name of ['yt-dlp.exe', 'yt-dlp', 'ffmpeg.exe', 'ffmpeg']) fs.writeFileSync(path.join(root, name), '');
  const commands = [];
  const spawnProcess = (_executable, args) => {
    commands.push(args);
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => child.emit('close', 1);
    setImmediate(() => { child.stdout.write(JSON.stringify({ entries: [] })); child.emit('close', 0); });
    return child;
  };
  const service = createDownloadService({ toolsDir: root, outputDir: path.join(root, 'downloads'), spawnProcess });
  try {
    await assert.rejects(service.radio({ videoId: 'iP6XpLQM2Cs' }), /暂未返回可用电台曲目/);
    await assert.rejects(service.radio({ videoId: 'iP6XpLQM2Cs' }), /暂未返回可用电台曲目/);
    assert.equal(commands.length, 2);
    assert.ok(commands.every((args) => args.at(-1).startsWith('https://music.youtube.com/watch?')));
    assert.ok(commands.every((args) => !args.at(-1).startsWith('ytsearch')));
  } finally { service.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
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
