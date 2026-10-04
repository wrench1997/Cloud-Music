const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const os = require('node:os');

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
    title: item.title, artist: item.subtitle, duration: Math.round(Number(item.duration || 0) / 1000),
    search: `${item.subtitle} ${item.title} official audio`,
  }));
  if (!entries.length) throw new Error('此 Spotify 歌单没有可读取的曲目，可能是私密歌单或平台页面结构变化。');
  return { provider: 'spotify', title: entity.name || entity.title || 'Spotify 歌单', entries, notice: '读取的是公开嵌入页面可见曲目（最多 100 首），不保证完整。下载前请核对对应的 YouTube 音源。' };
}

function createDownloadService({ toolsDir, outputDir, spawnProcess = spawn }) {
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
      const response = await fetch(source.url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Spotify 返回 ${response.status}`);
      const html = await response.text();
      if (html.length > 8 * 1024 * 1024) throw new Error('Spotify 页面过大。');
      return parseSpotifyMetadata(html);
    }
    const data = JSON.parse(await run(['--flat-playlist', '--dump-single-json', '--skip-download', '--playlist-end', '100', '--', source.url]));
    return { provider: 'youtube', title: data.title || 'YouTube 歌单', entries: (data.entries || [data]).filter((item) => /^[\w-]{11}$/.test(item.id)).slice(0, 100).map((item) => ({ title: item.title || item.id, artist: item.uploader || item.channel || '', duration: Number(item.duration || 0), url: `https://www.youtube.com/watch?v=${item.id}` })) };
  }
  async function match(entry) {
    if (typeof entry.search !== 'string' || entry.search.length > 300) throw new Error('无效的歌曲搜索。');
    const data = JSON.parse(await run(['--flat-playlist', '--dump-single-json', '--skip-download', '--', `ytsearch3:${entry.search}`]));
    return (data.entries || []).filter((item) => /^[\w-]{11}$/.test(item.id)).map((item) => ({ title: item.title, artist: item.uploader || item.channel || '', duration: Number(item.duration || 0), url: `https://www.youtube.com/watch?v=${item.id}` }));
  }
  function publicJob(job) { return { id: job.id, state: job.state, title: job.title, progress: job.progress, error: job.error, files: job.files }; }
  function startJob(entries) {
    if (!Array.isArray(entries) || !entries.length || entries.length > 100) throw new Error('请选择 1 至 100 首音乐。');
    if ([...jobs.values()].some((job) => job.state === 'running')) throw new Error('已有下载任务正在运行，请等待完成。');
    if (jobs.size >= 100) throw new Error('任务数量已满，请重启下载服务。');
    const sources = entries.map((entry) => {
      const source = parseSource(entry.url);
      if (source.provider !== 'youtube' || !source.url.includes('/watch?v=')) throw new Error('请先为每首歌曲选择一个 YouTube 音源。');
      return { url: source.url, title: String(entry.title || '歌曲').slice(0, 200) };
    });
    toolArgs();
    const id = crypto.randomUUID();
    const directory = path.join(outputDir, id);
    fs.mkdirSync(directory);
    const job = { id, state: 'running', title: sources[0].title, progress: 0, files: [], error: '', cancelled: false, failures: [] };
    jobs.set(id, job);
    (async () => {
      for (let index = 0; index < sources.length; index++) {
        if (job.cancelled) break;
        job.title = sources[index].title;
        try {
          await run(['--no-playlist', '--newline', '--progress', '--progress-template', 'download:PROGRESS:%(progress._percent_str)s', '-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0', '--ffmpeg-location', toolsDir, '--restrict-filenames', '-o', path.join(directory, '%(title).100s-%(id)s.%(ext)s'), '--', sources[index].url], (line) => {
            const percentage = line.match(/^PROGRESS:\s*([\d.]+)%/);
            if (percentage) job.progress = Math.floor((index + Number(percentage[1]) / 100) / sources.length * 100);
          }, 20 * 60 * 1000);
          job.files = fs.readdirSync(directory).filter((name) => name.endsWith('.mp3')).map((name) => ({ name, size: fs.statSync(path.join(directory, name)).size }));
        } catch (error) { if (!job.cancelled) job.failures.push(`${sources[index].title}: ${error.message}`); }
        job.progress = Math.floor((index + 1) / sources.length * 100);
      }
      job.state = job.cancelled ? 'cancelled' : job.failures.length ? 'partial' : 'complete';
      job.error = job.failures.join('\n').slice(0, 3000);
    })().catch((error) => { job.state = 'failed'; job.error = error.message; });
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
      if (request.method === 'GET' && url.pathname === '/status') { reply(response, 200, { ready: fs.existsSync(executable) && fs.existsSync(ffmpeg), jobs: [...jobs.values()].map(publicJob) }); return; }
      if (request.method === 'POST' && url.pathname === '/inspect') { reply(response, 200, await inspect((await readJson(request)).url)); return; }
      if (request.method === 'POST' && url.pathname === '/match') { reply(response, 200, await match(await readJson(request))); return; }
      if (request.method === 'POST' && url.pathname === '/jobs') { reply(response, 200, startJob((await readJson(request)).entries)); return; }
      const jobRoute = url.pathname.match(/^\/jobs\/([\w-]+)$/);
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
  return { connect, inspect, match, startJob, dispose, handleLocal };
}

module.exports = { createDownloadService, parseSource, parseSpotifyMetadata };
