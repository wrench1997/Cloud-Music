const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const os = require('node:os');
const { normalizeTrack, enrichSpotifyTrack, metadataFor, matchPlaylistTrack, videoId, safeCoverUrl, writeMp3Metadata } = require('./download-metadata');

function searchOptions(value = {}) {
  if (typeof value.query !== 'string' || value.query.length > 300) throw new Error('请输入 1 至 300 个字符的歌曲或歌手名称。');
  const query = value.query.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!query) throw new Error('请输入歌曲或歌手名称。');
  const page = value.page === undefined ? 1 : value.page;
  const limit = value.limit === undefined ? 12 : value.limit;
  if (!Number.isInteger(page) || page < 1 || page > 5 || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('搜索每页最多 20 首，最多浏览 5 页。');
  return { query, page, limit };
}

function parseSource(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请填写有效的歌单链接。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('仅支持官方 HTTPS 链接。');
  if (url.hostname === 'open.spotify.com') {
    const match = url.pathname.match(/^\/(?:intl-[a-zA-Z-]+\/)?(?:embed\/)?playlist\/([A-Za-z0-9]{22})\/?$/);
    if (!match) throw new Error('请使用 Spotify 歌单链接。');
    return { provider: 'spotify', url: `https://open.spotify.com/embed/playlist/${match[1]}` };
  }
  if (['music.youtube.com', 'www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) {
    const list = url.searchParams.get('list');
    const video = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v');
    if (list && /^[\w-]{10,200}$/.test(list)) return { provider: 'youtube', url: `https://www.youtube.com/playlist?list=${list}` };
    if (video && /^[\w-]{11}$/.test(video)) return { provider: 'youtube', url: `https://www.youtube.com/watch?v=${video}` };
  }
  throw new Error('仅支持 YouTube 和 Spotify 歌单。');
}

function parseSpotifyMetadata(html) {
  const match = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Spotify 没有返回可读取的公开歌单，请使用公开分享链接。');
  const entity = JSON.parse(match[1]).props?.pageProps?.state?.data?.entity;
  const entries = (entity?.trackList || []).slice(0, 100).filter((item) => item.title && item.subtitle).map((item) => ({
    ...normalizeTrack({ ...item, artist: item.subtitle, duration: Math.round(Number(item.duration || 0) / 1000) }),
    search: `${item.subtitle} ${item.title} official audio`,
  }));
  if (!entries.length) throw new Error('此 Spotify 歌单没有可读取的曲目，可能是私密歌单或平台页面结构变化。');
  return { provider: 'spotify', title: entity.name || entity.title || 'Spotify 歌单', entries, notice: '读取的是公开嵌入页面可见曲目（最多 100 首），不保证完整。下载前请核对对应的 YouTube 音源。' };
}

function createDownloadService({ toolsDir, outputDir, spawnProcess = spawn, metadataProcess = spawn, fetchImpl = fetch }) {
  toolsDir = path.resolve(toolsDir);
  outputDir = path.resolve(outputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  const token = crypto.randomBytes(24).toString('hex');
  const executable = path.join(toolsDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const ffmpeg = path.join(toolsDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const nodeRuntime = path.join(toolsDir, process.platform === 'win32' ? 'node.exe' : 'node');
  const jobs = new Map();
  const children = new Set();
  let server;
  let mobileServer;
  let mobileStarting;
  let baseUrl;
  let starting;
  let disposed = false;

  function readFiles(directory, known = []) {
    return fs.readdirSync(directory).filter((name) => name.endsWith('.mp3') && !name.startsWith('.') && fs.lstatSync(path.join(directory, name)).isFile() && fs.statSync(path.join(directory, name)).size > 0).map((name) => ({ ...known.find((file) => file.name === name), name, size: fs.statSync(path.join(directory, name)).size }));
  }
  function persistJob(job) {
    const directory = path.join(outputDir, job.id);
    const temporary = path.join(directory, '.job.json.tmp');
    fs.writeFileSync(temporary, JSON.stringify(job));
    fs.renameSync(temporary, path.join(directory, '.job.json'));
  }
  // Recover finished MP3s and interrupted conversions when the app restarts.
  for (const id of fs.readdirSync(outputDir).filter((name) => /^[a-f0-9-]{36}$/.test(name)).sort((left, right) => fs.statSync(path.join(outputDir, left)).mtimeMs - fs.statSync(path.join(outputDir, right)).mtimeMs).slice(-100)) {
    const directory = path.join(outputDir, id);
    if (!fs.lstatSync(directory).isDirectory()) continue;
    try {
      const manifest = path.join(directory, '.job.json');
      const saved = fs.existsSync(manifest) && fs.statSync(manifest).size < 200000 ? JSON.parse(fs.readFileSync(manifest, 'utf8')) : null;
      let files = readFiles(directory, Array.isArray(saved?.files) ? saved.files : []);
      if (saved && Array.isArray(saved.files)) files = files.filter((file) => saved.files.some((known) => known.name === file.name));
      const pending = fs.readdirSync(directory).flatMap((name) => {
        const match = name.match(/-([\w-]{11})\.(?:webm|m4a|opus|ogg)$/);
        return match && fs.lstatSync(path.join(directory, name)).isFile() ? [{ url: `https://www.youtube.com/watch?v=${match[1]}`, title: name.slice(0, -match[0].length).replace(/_/g, ' '), error: '音源已下载，MP3 转换未完成。' }] : [];
      });
      const unfinished = saved?.state === 'running' && Array.isArray(saved.sources) ? saved.sources.filter((source) => !files.some((file) => file.name.endsWith(`-${new URL(source.url).searchParams.get('v')}.mp3`))).map((source) => ({ ...source, error: '上次下载被中断，请重试。' })) : (saved?.failures || pending);
      const failures = unfinished.filter((item) => {
        try { return parseSource(item.url).provider === 'youtube' && typeof item.title === 'string'; } catch { return false; }
      }).slice(0, 100);
      files = files.filter((file) => !failures.some((failure) => file.name.endsWith(`-${new URL(failure.url).searchParams.get('v')}.mp3`)));
      if (!files.length && !failures.length) continue;
      const total = Math.max(Number(saved?.total) || 0, files.length + failures.length);
      const savedSources = Array.isArray(saved?.sources) ? saved.sources.filter((source) => { try { return parseSource(source.url).provider === 'youtube'; } catch { return false; } }).map((source) => normalizeTrack(source, parseSource(source.url).url)) : [];
      const job = { id, createdAt: Number(saved?.createdAt) || fs.statSync(directory).birthtimeMs, state: failures.length ? (files.length ? 'partial' : 'failed') : 'complete', phase: 'finished', title: String(saved?.title || failures[0]?.title || files[0]?.name || '已保存的下载'), completed: files.length, total, progress: Math.floor(files.length / total * 100), cancelled: false, files, failures, sources: savedSources.length ? savedSources : failures.map((source) => normalizeTrack(source)), metadataRepair: saved?.metadataRepair, error: failures.map((item) => `${item.title}: ${item.error || '下载未完成。'}`).join('\n').slice(0, 3000) };
      jobs.set(id, job);
    } catch { /* An incomplete manifest must not prevent startup. */ }
  }

  function toolArgs() {
    if (!fs.existsSync(executable) || !fs.existsSync(ffmpeg)) throw new Error('下载工具未安装，请先运行 npm run media:install。');
    const runtime = fs.existsSync(nodeRuntime) ? nodeRuntime : process.execPath;
    return ['--ignore-config', '--no-warnings', '--socket-timeout', '30', '--retries', '2', '--js-runtimes', `node:${runtime}`, '--remote-components', 'ejs:github'];
  }
  function run(args, onLine, timeout = 180000) {
    if (disposed) return Promise.reject(new Error('下载服务已关闭。'));
    return new Promise((resolve, reject) => {
      let child;
      try { child = spawnProcess(executable, [...toolArgs(), ...args], { windowsHide: true, shell: false }); }
      catch (error) { reject(error); return; }
      children.add(child);
      let output = ''; let errors = ''; let pending = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('音源响应超时，请重试。')); }, timeout);
      child.stdout.on('data', (data) => {
        output += data.toString(); pending += data.toString();
        if (output.length > 8 * 1024 * 1024) { child.kill(); reject(new Error('歌单返回内容过大。')); return; }
        const lines = pending.split(/\r?\n/); pending = lines.pop();
        for (const line of lines) onLine?.(line);
      });
      child.stderr.on('data', (data) => { errors = (errors + data.toString()).slice(-3000); });
      child.once('error', (error) => { clearTimeout(timer); children.delete(child); reject(error); });
      child.once('close', (code) => {
        clearTimeout(timer); children.delete(child);
        if (pending) onLine?.(pending);
        if (code === 0) resolve(output);
        else reject(new Error(errors.trim() || '无法下载这个音源，它可能要求登录或不允许访问。'));
      });
    });
  }
  async function inspect(link) {
    const source = parseSource(link);
    if (source.provider === 'spotify') {
      const response = await fetchImpl(source.url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Spotify 返回 ${response.status}`);
      const html = await response.text();
      if (html.length > 8 * 1024 * 1024) throw new Error('Spotify 页面过大。');
      return parseSpotifyMetadata(html);
    }
    const data = JSON.parse(await run(['--flat-playlist', '--dump-single-json', '--skip-download', '--playlist-end', '100', '--', source.url]));
    return { provider: 'youtube', title: data.title || 'YouTube 歌单', entries: (data.entries || [data]).filter((item) => /^[\w-]{11}$/.test(item.id)).slice(0, 100).map((item) => normalizeTrack({ title: item.track || item.title || item.id, artist: item.artist || item.artists || item.uploader || item.channel || '', album: item.album, duration: item.duration, coverUrl: item.thumbnail, url: `https://www.youtube.com/watch?v=${item.id}` })) };
  }
  async function match(entry) {
    if (typeof entry.search !== 'string' || entry.search.length > 300) throw new Error('无效的歌曲搜索。');
    const data = JSON.parse(await run(['--flat-playlist', '--dump-single-json', '--skip-download', '--', `ytsearch3:${entry.search}`]));
    return (data.entries || []).filter((item) => /^[\w-]{11}$/.test(item.id)).map((item) => ({ title: item.title, artist: item.uploader || item.channel || '', duration: Number(item.duration || 0), url: `https://www.youtube.com/watch?v=${item.id}` }));
  }
  async function search(value) {
    const { query, page, limit } = searchOptions(value);
    const start = (page - 1) * limit + 1;
    const end = page * limit + 1;
    const data = JSON.parse(await run(['--flat-playlist', '--dump-single-json', '--skip-download', '--playlist-start', String(start), '--playlist-end', String(end), '--', `ytsearch${end}:${query}`]));
    const seen = new Set();
    const entries = (data.entries || []).filter((item) => {
      if (!/^[\w-]{11}$/.test(item.id) || seen.has(item.id)) return false;
      seen.add(item.id); return true;
    });
    return { provider: 'youtube', query, page, hasMore: page < 5 && entries.length > limit, entries: entries.slice(0, limit).map((item) => ({
      title: String(item.track || item.title || item.id).slice(0, 300),
      artist: String(item.artist || item.uploader || item.channel || '').slice(0, 300),
      artistIsChannel: !item.artist, duration: Math.max(0, Number(item.duration) || 0),
      coverUrl: safeCoverUrl(item.thumbnail) || (item.thumbnails || []).map((thumbnail) => safeCoverUrl(thumbnail.url)).find(Boolean) || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${item.id}`, metadataProvider: 'youtube',
    })), notice: '搜索和音源来自 YouTube。下载时读取实际歌曲信息并嵌入 MP3。' };
  }
  function publicJob(job) { return { id: job.id, createdAt: job.createdAt, state: job.state, title: job.title, progress: job.progress, phase: job.phase, completed: job.completed, total: job.total, failures: job.failures, error: job.error, files: job.files, metadataRepair: job.metadataRepair }; }
  function metadataOptions(job) { return { ffmpeg, fetchImpl, spawnProcess: metadataProcess, isCancelled: () => disposed || job.cancelled, onChild: (child, add) => add ? children.add(child) : children.delete(child) }; }
  function readSourceInfo(directory, id) {
    const name = fs.readdirSync(directory).find((entry) => entry.endsWith(`-${id}.info.json`));
    if (!name) return {};
    const file = path.join(directory, name);
    try { return fs.statSync(file).size < 16 * 1024 * 1024 ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}; } catch { return {}; }
  }
  function startJob(entries) {
    if (!Array.isArray(entries) || !entries.length || entries.length > 100) throw new Error('请选择 1 至 100 首音乐。');
    if ([...jobs.values()].some((job) => job.state === 'running')) throw new Error('已有下载任务正在运行，请等待完成。');
    if (jobs.size >= 100) throw new Error('任务数量已满，请重启下载服务。');
    const sources = entries.map((entry) => {
      const source = parseSource(entry.url);
      if (source.provider !== 'youtube' || !source.url.includes('/watch?v=')) throw new Error('请先为每首歌曲选择一个 YouTube 音源。');
      return normalizeTrack(entry, source.url);
    }).filter((source, index, all) => all.findIndex((item) => item.url === source.url) === index);
    toolArgs();
    const id = crypto.randomUUID();
    const directory = path.join(outputDir, id);
    fs.mkdirSync(directory);
    const job = { id, createdAt: Date.now(), state: 'running', title: sources[0].title, progress: 0, phase: 'download', completed: 0, total: sources.length, sources, files: [], error: '', cancelled: false, failures: [] };
    jobs.set(id, job);
    persistJob(job);
    executeJob(job, sources, directory);
    return publicJob(job);
  }
  function executeJob(job, sources, directory) {
    const alreadyCompleted = job.completed;
    (async () => {
      for (let index = 0; index < sources.length; index++) {
        if (job.cancelled) break;
        job.title = sources[index].title;
        job.phase = 'download';
        try {
          await run(['--no-playlist', '--newline', '--progress', '--progress-template', 'download:PROGRESS:%(progress._percent_str)s', '-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0', '--ffmpeg-location', ffmpeg, '--embed-metadata', '--write-info-json', '--restrict-filenames', '-o', path.join(directory, '%(title).100s-%(id)s.%(ext)s'), '--', sources[index].url], (line) => {
            const percentage = line.match(/^PROGRESS:\s*([\d.]+)%/);
            if (percentage) job.progress = Math.min(99, Math.floor((alreadyCompleted + index + Number(percentage[1]) / 100 * 0.9) / job.total * 100));
            if (line.startsWith('[ExtractAudio]')) job.phase = 'convert';
          }, 20 * 60 * 1000);
          const files = readFiles(directory, job.files);
          const sourceId = new URL(sources[index].url).searchParams.get('v');
          const audio = files.find((file) => file.name.endsWith(`-${sourceId}.mp3`) && file.size > 0);
          if (!audio) throw new Error('音源没有生成有效 MP3，请重试或更换音源。');
          job.phase = 'metadata';
          let track = sources[index];
          let warning;
          if (track.spotifyId && !track.coverUrl) {
            try { track = await enrichSpotifyTrack(track, fetchImpl); }
            catch (error) { warning = `Spotify 信息未补全：${error.message}`; }
          }
          const completed = await writeMp3Metadata({ ...metadataOptions(job), input: path.join(directory, audio.name), metadata: metadataFor(track, readSourceInfo(directory, sourceId)) });
          if (warning) completed.metadataWarnings = [warning, ...(completed.metadataWarnings || [])];
          job.files = [...job.files.filter((file) => !file.name.endsWith(`-${sourceId}.mp3`)), completed];
          job.sources = job.sources.map((source) => source.url === track.url ? track : source);
          job.completed++;
        } catch (error) {
          const sourceId = new URL(sources[index].url).searchParams.get('v');
          for (const name of fs.readdirSync(directory)) if (name.endsWith(`-${sourceId}.mp3`) && fs.lstatSync(path.join(directory, name)).isFile() && !job.files.some((completed) => completed.name === name)) fs.unlinkSync(path.join(directory, name));
          if (!job.cancelled) job.failures.push({ ...sources[index], error: error.message.slice(0, 1500) });
        }
        job.progress = Math.min(99, Math.floor((alreadyCompleted + index + 1) / job.total * 100));
        persistJob(job);
      }
      job.state = job.cancelled ? 'cancelled' : job.failures.length ? (job.completed ? 'partial' : 'failed') : 'complete';
      job.phase = 'finished';
      job.progress = job.state === 'complete' ? 100 : Math.floor(job.completed / job.total * 100);
      job.error = job.failures.map((failure) => `${failure.title}: ${failure.error}`).join('\n').slice(0, 3000);
      persistJob(job);
    })().catch((error) => { job.state = 'failed'; job.error = error.message; });
  }
  function retryJob(job) {
    if (job.state === 'running' || [...jobs.values()].some((item) => item.state === 'running')) throw new Error('请等待当前下载任务完成。');
    if (!job.failures.length) throw new Error('没有需要重试的曲目。');
    toolArgs();
    const sources = job.failures.map((source) => normalizeTrack(source));
    job.sources = [...job.sources.filter((source) => !sources.some((retry) => retry.url === source.url)), ...sources];
    job.failures = []; job.error = ''; job.cancelled = false; job.state = 'running';
    persistJob(job);
    executeJob(job, sources, path.join(outputDir, job.id));
    return publicJob(job);
  }
  function repairJob(id, playlistUrl) {
    const job = jobs.get(id);
    if (!job) throw new Error('任务不存在。');
    if ([...jobs.values()].some((item) => item.state === 'running')) throw new Error('请等待当前任务完成。');
    if (!job.files.length) throw new Error('没有可补全的 MP3。');
    parseSource(playlistUrl);
    toolArgs();
    const previousState = job.state;
    job.cancelled = false; job.state = 'running'; job.phase = 'metadata'; job.progress = 0;
    job.files = job.files.map((file) => ({ ...file, metadataRepairSkipped: true }));
    job.metadataRepair = { revision: crypto.randomUUID(), completed: 0, total: job.files.length, failures: [], unmatched: [], sourceFallback: [] };
    persistJob(job);
    (async () => {
      const playlist = await inspect(playlistUrl);
      const directory = path.join(outputDir, id);
      const recordProgress = () => {
        job.progress = Math.floor((job.metadataRepair.completed + job.metadataRepair.failures.length + job.metadataRepair.unmatched.length) / job.metadataRepair.total * 100);
        persistJob(job);
      };
      for (const file of [...job.files]) {
        if (job.cancelled || disposed) break;
        const sourceId = file.name.match(/-([\w-]{11})\.mp3$/)?.[1];
        const source = job.sources.find((entry) => videoId(entry.url) === sourceId);
        const sourceTitle = source?.title || file.metadata?.title || file.name.slice(0, -(sourceId?.length || 0) - 5).replace(/_/g, ' ');
        const original = playlist.provider === 'spotify' ? matchPlaylistTrack(sourceTitle, playlist.entries) : playlist.entries.find((entry) => videoId(entry.url) === sourceId);
        if (!sourceId || playlist.provider === 'youtube' && !original) { job.metadataRepair.unmatched.push(file.name); recordProgress(); continue; }
        try {
          let track; let info = readSourceInfo(directory, sourceId);
          if (original && playlist.provider === 'spotify') track = await enrichSpotifyTrack(normalizeTrack(original, `https://www.youtube.com/watch?v=${sourceId}`), fetchImpl);
          else {
            if (info.id !== sourceId) info = JSON.parse(await run(['--no-playlist', '--dump-single-json', '--skip-download', '--', `https://www.youtube.com/watch?v=${sourceId}`]));
            const artists = info.artist || info.artists || (playlist.provider === 'youtube' ? original.artist || info.uploader || info.channel : '');
            if (info.id !== sourceId || !(typeof artists === 'string' && artists.trim() || Array.isArray(artists) && artists.some((artist) => typeof artist === 'string' && artist.trim()))) {
              job.metadataRepair.unmatched.push(file.name); recordProgress(); continue;
            }
            track = normalizeTrack({ title: playlist.provider === 'youtube' ? original.title : sourceTitle, artists, album: info.album, coverUrl: info.thumbnail, duration: info.duration }, `https://www.youtube.com/watch?v=${sourceId}`);
          }
          job.title = track.title;
          const rewritten = await writeMp3Metadata({ ...metadataOptions(job), input: path.join(directory, file.name), metadata: metadataFor(track, info), backup: true });
          rewritten.originalName = file.originalName || file.name;
          rewritten.metadataRepairSkipped = false;
          job.files = job.files.map((entry) => entry.name === file.name ? rewritten : entry);
          job.sources = [...job.sources.filter((entry) => videoId(entry.url) !== sourceId), track];
          job.metadataRepair.completed++;
          if (playlist.provider === 'spotify' && !original) job.metadataRepair.sourceFallback.push(file.name);
        } catch (error) { job.metadataRepair.failures.push({ name: file.name, error: error.message }); }
        recordProgress();
      }
      job.state = previousState; job.phase = 'finished'; job.progress = Math.floor(job.completed / job.total * 100);
      persistJob(job);
    })().catch((error) => { job.state = previousState; job.phase = 'finished'; job.metadataRepair.failures.push({ error: error.message }); persistJob(job); });
    return publicJob(job);
  }
  async function readJson(request) {
    let data = '';
    for await (const chunk of request) { data += chunk; if (data.length > 100000) throw new Error('请求过大。'); }
    return JSON.parse(data || '{}');
  }
  function reply(response, status, value) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); }
  async function handle(request, response) {
    const origin = request.headers.origin;
    if (origin) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.headers.authorization !== `Bearer ${token}`) { reply(response, 401, { error: '配对码不正确。' }); return; }
    const url = new URL(request.url, 'http://localhost');
    try {
      if (request.method === 'GET' && url.pathname === '/status') { reply(response, 200, { ready: fs.existsSync(executable) && fs.existsSync(ffmpeg), jobs: [...jobs.values()].sort((left, right) => left.createdAt - right.createdAt).map(publicJob) }); return; }
      if (request.method === 'POST' && url.pathname === '/inspect') { reply(response, 200, await inspect((await readJson(request)).url)); return; }
      if (request.method === 'POST' && url.pathname === '/match') { reply(response, 200, await match(await readJson(request))); return; }
      if (request.method === 'POST' && url.pathname === '/search') { reply(response, 200, await search(await readJson(request))); return; }
      if (request.method === 'POST' && url.pathname === '/jobs') { reply(response, 200, startJob((await readJson(request)).entries)); return; }
      const jobRoute = url.pathname.match(/^\/jobs\/([\w-]+)$/);
      const retryRoute = url.pathname.match(/^\/jobs\/([\w-]+)\/retry$/);
      const repairRoute = url.pathname.match(/^\/jobs\/([\w-]+)\/repair$/);
      if (request.method === 'POST' && repairRoute) { reply(response, 200, repairJob(repairRoute[1], (await readJson(request)).playlistUrl)); return; }
      if (request.method === 'POST' && retryRoute) {
        const job = jobs.get(retryRoute[1]);
        if (!job) { reply(response, 404, { error: '任务不存在。' }); return; }
        reply(response, 200, retryJob(job)); return;
      }
      if (jobRoute) {
        const job = jobs.get(jobRoute[1]);
        if (!job) { reply(response, 404, { error: '任务不存在。' }); return; }
        if (request.method === 'GET') { reply(response, 200, publicJob(job)); return; }
        if (request.method === 'DELETE') { job.cancelled = true; for (const child of children) child.kill(); reply(response, 200, publicJob(job)); return; }
      }
      const fileRoute = url.pathname.match(/^\/files\/([\w-]+)\/(.+)$/);
      if (request.method === 'GET' && fileRoute) {
        const job = jobs.get(fileRoute[1]);
        const name = decodeURIComponent(fileRoute[2]);
        if (!job?.files.some((file) => file.name === name)) { reply(response, 404, { error: '文件不存在。' }); return; }
        const filePath = path.join(outputDir, job.id, name);
        response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': fs.statSync(filePath).size, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` });
        const stream = fs.createReadStream(filePath);
        stream.on('error', () => response.destroy());
        response.on('close', () => stream.destroy());
        stream.pipe(response); return;
      }
      reply(response, 404, { error: '接口不存在。' });
    } catch (error) { reply(response, 400, { error: error.message }); }
  }
  function connect({ lan = false } = {}) {
    if (starting) return starting.then(() => lan ? mobileConnection() : connectionInfo());
    if (baseUrl) return lan ? mobileConnection() : Promise.resolve(connectionInfo());
    starting = new Promise((resolve, reject) => {
      server = http.createServer((request, response) => { handle(request, response).catch(() => response.destroy()); });
      server.once('error', (error) => { starting = null; reject(error); });
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve(connectionInfo());
      });
    }).finally(() => { starting = null; });
    return starting.then(() => lan ? mobileConnection() : connectionInfo());
  }
  function mobileConnection() {
    if (mobileServer?.listening) return Promise.resolve(connectionInfo());
    if (mobileStarting) return mobileStarting;
    mobileStarting = new Promise((resolve, reject) => {
      mobileServer = http.createServer((request, response) => { handle(request, response).catch(() => response.destroy()); });
      mobileServer.once('error', reject);
      mobileServer.listen(0, '0.0.0.0', () => resolve(connectionInfo()));
    }).finally(() => { mobileStarting = null; });
    return mobileStarting;
  }
  function connectionInfo() {
    const port = mobileServer?.listening ? mobileServer.address().port : 0;
    const addresses = port ? Object.values(os.networkInterfaces()).flat().filter((entry) => entry?.family === 'IPv4' && !entry.internal).map((entry) => `http://${entry.address}:${port}#${token}`) : [];
    return { url: baseUrl, token, pairingLinks: addresses, outputDir };
  }
  function dispose() { disposed = true; for (const child of children) child.kill(); server?.closeAllConnections(); server?.close(); mobileServer?.closeAllConnections(); mobileServer?.close(); }
  function handleLocal(request, response) {
    request.headers.authorization = `Bearer ${token}`;
    delete request.headers.origin;
    return handle(request, response);
  }
  return { connect, inspect, match, search, startJob, repairJob, dispose, handleLocal };
}

module.exports = { createDownloadService, parseSource, parseSpotifyMetadata, searchOptions };
