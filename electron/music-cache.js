const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { id3TagLength, parseId3, httpsUrl } = require('../src/lib/audio-metadata');

const CACHE_ID = /^[a-f0-9]{64}$/;
const FILE_ID = /^[\w-]{1,256}$/;
const MAX_AUDIO_BYTES = 1024 * 1024 * 1024;
const MIME_BY_EXTENSION = { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', webm: 'audio/webm', wma: 'audio/x-ms-wma', aiff: 'audio/aiff', aif: 'audio/aiff' };
const safeText = (value, limit = 1000) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit) : '';
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

function cacheIdFor(accountId, fileId) {
  if (!FILE_ID.test(accountId || '') || !FILE_ID.test(fileId || '')) throw new Error('无效的歌曲或账号标识。');
  return crypto.createHash('sha256').update(`${accountId}\0${fileId}`).digest('hex');
}

function rangeFor(header, size) {
  if (!header) return { start: 0, end: size - 1, status: 200 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[1] && match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start < 0 || end < start) return null;
  end = Math.min(end, size - 1);
  return { start, end, status: 206 };
}

async function embeddedMetadata(filePath, size) {
  const file = await fsp.open(filePath, 'r');
  try {
    const header = Buffer.alloc(10);
    await file.read(header, 0, header.length, 0);
    const length = id3TagLength(header, size);
    if (!length) return {};
    const bytes = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const result = await file.read(bytes, offset, length - offset, offset);
      if (!result.bytesRead) return {};
      offset += result.bytesRead;
    }
    return parseId3(bytes);
  } finally { await file.close(); }
}

function createMusicCache({ directory, getIdentity, getSource, maxBytes = MAX_AUDIO_BYTES }) {
  const root = path.resolve(directory);
  const key = crypto.randomBytes(32).toString('base64url');
  const inflight = new Map();
  const removals = new Map();
  const readers = new Map();
  let server;
  let serverPromise;
  let disposed = false;
  let rootPromise;

  async function ensureRoot() {
    if (!rootPromise) rootPromise = (async () => {
      await fsp.mkdir(root, { recursive: true, mode: 0o700 });
      if (!samePath(await fsp.realpath(root), root)) throw new Error('歌曲缓存目录不能是外部链接。');
      for (const name of await fsp.readdir(root)) {
        if (!/^\.partial-[a-f0-9]{64}-[a-f0-9]{16}$/.test(name)) continue;
        const target = path.join(root, name);
        // Only stale scratch directories created by this cache format are reclaimed on launch.
        const info = await fsp.lstat(target).catch(() => null);
        if (info?.isDirectory() && !info.isSymbolicLink() && samePath(await fsp.realpath(target), target)) await fsp.rm(target, { recursive: true, force: true });
      }
    })().catch((error) => { rootPromise = undefined; throw error; });
    await rootPromise;
  }

  async function safeEntry(id) {
    if (!CACHE_ID.test(id || '')) throw new Error('无效的本机缓存标识。');
    await ensureRoot();
    const folder = path.join(root, id);
    try {
      const info = await fsp.lstat(folder);
      if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await fsp.realpath(folder), folder)) return null;
      const metadataPath = path.join(folder, 'metadata.json');
      const metadataInfo = await fsp.lstat(metadataPath);
      if (!metadataInfo.isFile() || metadataInfo.isSymbolicLink() || metadataInfo.size > 32768) return null;
      const metadata = JSON.parse(await fsp.readFile(metadataPath, 'utf8'));
      if (metadata.version !== 1 || metadata.cacheId !== id || cacheIdFor(metadata.originalAccount?.id, metadata.driveFileId) !== id) return null;
      if (!Number.isSafeInteger(metadata.size) || metadata.size < 1 || metadata.size > maxBytes || !CACHE_ID.test(metadata.sha256 || '')) return null;
      if (!/^audio\/[a-z0-9.+-]+$/i.test(metadata.mimeType || '')) return null;
      const audioPath = path.join(folder, 'audio');
      const audio = await fsp.lstat(audioPath);
      if (!audio.isFile() || audio.isSymbolicLink() || audio.size !== metadata.size) return null;
      let coverPath;
      if (['image/jpeg', 'image/png'].includes(metadata.coverMime)) {
        const cover = await fsp.lstat(path.join(folder, 'cover')).catch(() => null);
        if (cover?.isFile() && !cover.isSymbolicLink() && cover.size > 0 && cover.size <= 5 * 1024 * 1024) coverPath = path.join(folder, 'cover');
      }
      return { folder, audioPath, coverPath, metadata };
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError || /无效/.test(error.message)) return null;
      throw error;
    }
  }

  async function handleRequest(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const origin = request.headers.origin;
    if (origin && origin !== 'null' && origin !== 'http://localhost:3000') { response.writeHead(403).end(); return; }
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range');
    }
    const url = new URL(request.url, 'http://127.0.0.1');
    const parts = url.pathname.split('/');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) || parts.length !== 5 || parts[1] !== 'music-cache' || parts[2] !== key || !CACHE_ID.test(parts[3]) || !['audio', 'cover'].includes(parts[4])) {
      response.writeHead(404).end(); return;
    }
    if (request.method === 'OPTIONS') {
      const requested = (request.headers['access-control-request-headers'] || '').split(',').map((header) => header.trim().toLowerCase()).filter(Boolean);
      if (!origin || !['GET', 'HEAD'].includes(request.headers['access-control-request-method']) || requested.some((header) => header !== 'range')) { response.writeHead(403).end(); return; }
      response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Range');
      response.writeHead(204).end(); return;
    }
    if (removals.has(parts[3])) { response.writeHead(404).end(); return; }
    const entry = await safeEntry(parts[3]);
    const filePath = parts[4] === 'cover' ? entry?.coverPath : entry?.audioPath;
    if (!filePath || removals.has(parts[3])) { response.writeHead(404).end(); return; }
    const stat = await fsp.stat(filePath);
    if (removals.has(parts[3])) { response.writeHead(404).end(); return; }
    const range = rangeFor(request.headers.range, stat.size);
    response.setHeader('Accept-Ranges', 'bytes');
    if (!range) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
    response.statusCode = range.status;
    response.setHeader('Content-Type', parts[4] === 'cover' ? entry.metadata.coverMime : entry.metadata.mimeType);
    response.setHeader('Content-Length', range.end - range.start + 1);
    if (range.status === 206) response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = fs.createReadStream(filePath, { start: range.start, end: range.end });
    const reader = { stream, response };
    if (!readers.has(parts[3])) readers.set(parts[3], new Set());
    const active = readers.get(parts[3]);
    active.add(reader);
    stream.on('close', () => { active.delete(reader); if (!active.size) readers.delete(parts[3]); });
    response.on('close', () => stream.destroy());
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }

  function ensureServer() {
    if (disposed) throw new Error('本机缓存已关闭。');
    if (!serverPromise) serverPromise = new Promise((resolve, reject) => {
      server = http.createServer((request, response) => handleRequest(request, response).catch(() => { if (!response.headersSent) response.writeHead(500).end(); else response.destroy(); }));
      server.once('error', (error) => { serverPromise = undefined; reject(error); });
      server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/music-cache/${key}`));
    });
    return serverPromise;
  }

  async function songFor(entry) {
    const { metadata: value } = entry;
    const base = `${await ensureServer()}/${value.cacheId}`;
    return {
      id: `cache:${value.cacheId}`, cacheId: value.cacheId, driveFileId: value.driveFileId,
      originalAccount: { id: value.originalAccount.id, email: safeText(value.originalAccount.email, 254) },
      title: safeText(value.title) || '未命名歌曲', artist: safeText(value.artist) || '未知歌手', album: safeText(value.album),
      duration: Number.isFinite(value.duration) && value.duration > 0 ? value.duration : 0,
      fileName: safeText(value.fileName), size: value.size, mimeType: value.mimeType,
      sourceUrl: httpsUrl(value.sourceUrl), provider: 'local', localUri: `${base}/audio`,
      coverUrl: entry.coverPath ? `${base}/cover` : '', hasArtwork: Boolean(entry.coverPath), cachedAt: value.cachedAt,
    };
  }

  async function list() {
    await ensureRoot();
    const names = await fsp.readdir(root);
    const entries = await Promise.all(names.filter((name) => CACHE_ID.test(name)).map(safeEntry));
    const songs = await Promise.all(entries.filter(Boolean).map(songFor));
    songs.sort((a, b) => b.cachedAt - a.cachedAt || a.id.localeCompare(b.id));
    return { songs };
  }

  async function writeCache(id, identity, fileId) {
    const existing = await safeEntry(id);
    if (existing) return songFor(existing);
    const source = await getSource({ fileId, identity });
    if (source?.response?.status !== 200 || !source.response.body || source.response.headers.has('content-range')) {
      await source?.response?.body?.cancel();
      throw new Error('没有收到完整的歌曲音频，请重试。');
    }
    const meta = source.metadata || {};
    const responseType = (source.response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (responseType && !responseType.startsWith('audio/') && !['application/octet-stream', 'binary/octet-stream', 'video/webm', 'video/mp4'].includes(responseType)) {
      await source.response.body.cancel();
      throw new Error('Google Drive 没有返回音频文件。');
    }
    const temporary = path.join(root, `.partial-${id}-${crypto.randomBytes(8).toString('hex')}`);
    await fsp.mkdir(temporary, { mode: 0o700 });
    let size = 0;
    const hash = crypto.createHash('sha256');
    try {
      const expected = Number(source.response.headers.get('content-length') || meta.size || 0);
      if (expected > maxBytes) throw new Error('歌曲超过本机缓存大小限制。');
      await pipeline(Readable.fromWeb(source.response.body), new Transform({ transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > maxBytes) { callback(new Error('歌曲超过本机缓存大小限制。')); return; }
        hash.update(chunk); callback(null, chunk);
      } }), fs.createWriteStream(path.join(temporary, 'audio'), { flags: 'wx', mode: 0o600 }));
      if (!size || (expected > 0 && size !== expected) || (Number(meta.size) > 0 && size !== Number(meta.size))) throw new Error('歌曲下载不完整，请重试。');
      const audioFile = await fsp.open(path.join(temporary, 'audio'), 'r+');
      try { await audioFile.sync(); } finally { await audioFile.close(); }
      const embedded = await embeddedMetadata(path.join(temporary, 'audio'), size);
      let picture = embedded.picture;
      if (!picture && source.getCover) {
        try { picture = await source.getCover(); } catch { /* A thumbnail outage must not discard the downloaded audio. */ }
      }
      source.validate?.();
      let coverMime = '';
      if (picture?.data && ['image/jpeg', 'image/png'].includes(picture.mimeType) && picture.data.length > 0 && picture.data.length <= 5 * 1024 * 1024) {
        coverMime = picture.mimeType;
        await fsp.writeFile(path.join(temporary, 'cover'), picture.data, { flag: 'wx', mode: 0o600 });
      }
      const value = {
        version: 1, cacheId: id, driveFileId: fileId, originalAccount: { id: identity.id, email: safeText(identity.email, 254) },
        title: (meta.preferEmbeddedTitle ? safeText(embedded.title) || safeText(meta.title) : safeText(meta.title) || safeText(embedded.title)) || safeText(meta.fileName) || '未命名歌曲',
        artist: safeText(meta.artist) && meta.artist !== '未知歌手' ? safeText(meta.artist) : safeText(embedded.artist) || '未知歌手',
        album: meta.preferEmbeddedAlbum ? safeText(embedded.album) || safeText(meta.album) : safeText(meta.album) || safeText(embedded.album), duration: Number(meta.duration) || Number(embedded.duration) || 0,
        fileName: safeText(meta.fileName), mimeType: /^audio\/[a-z0-9.+-]+$/i.test(meta.mimeType || '') ? meta.mimeType : MIME_BY_EXTENSION[path.extname(meta.fileName || '').slice(1).toLowerCase()] || 'audio/mpeg',
        size, sha256: hash.digest('hex'), coverMime, sourceUrl: httpsUrl(meta.sourceUrl), cachedAt: Date.now(),
      };
      await fsp.writeFile(path.join(temporary, 'metadata.json'), JSON.stringify(value), { flag: 'wx', mode: 0o600 });
      const target = path.join(root, id);
      // Only complete entries become visible. An interrupted old entry is replaced inside the cache root.
      if (await fsp.lstat(target).catch(() => null)) await fsp.rm(target, { recursive: true, force: true });
      await fsp.rename(temporary, target);
      return songFor(await safeEntry(id));
    } catch (error) {
      await source.response.body?.cancel().catch(() => {});
      throw error;
    } finally {
      await fsp.rm(temporary, { recursive: true, force: true });
    }
  }

  async function cache(args) {
    const fileId = typeof args === 'string' ? args : args?.fileId;
    if (!FILE_ID.test(fileId || '')) throw new Error('无效的 Google Drive 文件 ID。');
    if (disposed) throw new Error('本机缓存已关闭。');
    const identity = await getIdentity();
    if (args?.accountId && args.accountId !== identity.id) throw new Error('当前 Google 账号与待缓存歌曲不一致。');
    const id = cacheIdFor(identity.id, fileId);
    if (removals.has(id)) await removals.get(id);
    if (!inflight.has(id)) {
      const pending = writeCache(id, identity, fileId).finally(() => inflight.delete(id));
      inflight.set(id, pending);
    }
    return inflight.get(id);
  }

  async function remove(args) {
    const id = (typeof args === 'string' ? args : args?.cacheId || args?.id || '').replace(/^cache:/, '');
    if (!CACHE_ID.test(id)) throw new Error('无效的本机缓存标识。');
    if (!removals.has(id)) {
      const pending = (async () => {
        if (inflight.has(id)) await inflight.get(id).catch(() => {});
        const active = [...(readers.get(id) || [])];
        await Promise.all(active.map(({ stream, response }) => new Promise((resolve) => {
          // Windows cannot remove an audio file while its stream still owns a descriptor.
          // Wait for close, rather than only requesting destruction of the read stream.
          if (stream.closed) { resolve(); return; }
          stream.once('close', resolve);
          response.destroy();
          stream.destroy();
        })));
        const entry = await safeEntry(id);
        if (!entry) return { removed: false };
        await fsp.rm(entry.folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
        return { removed: true };
      })().finally(() => removals.delete(id));
      removals.set(id, pending);
    }
    return removals.get(id);
  }

  function dispose() { disposed = true; server?.closeAllConnections(); server?.close(); }
  return { list, cache, remove, dispose };
}

module.exports = { createMusicCache, cacheIdFor, rangeFor };
