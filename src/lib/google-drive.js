const { readAudioMetadata, id3TagLength, parseId3, metadataProperties, thumbnailFromMetadata, mergeAudioMetadata, httpsUrl, musicFileName } = require('./audio-metadata');
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file'];
const DRIVE_SCOPE = DRIVE_SCOPES.join(' ');
const ROOT_FOLDER = { id: 'root', name: '我的云盘' };
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MUSIC_EXTENSIONS = /\.(mp3|wav|flac|ogg|m4a|aac|wma|ape|dsf|dff|aiff|aif|alac|opus|amr|ac3|dts|tta|webm)$/i;
const MUSIC_ACCEPT = 'audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac,.wma,.ape,.dsf,.dff,.aiff,.aif,.alac,.opus,.amr,.ac3,.dts,.tta,.webm';
const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,properties,appProperties,thumbnailLink';
const CHUNK_SIZE = 8 * 1024 * 1024;

function isMusicFile(file) {
  return MUSIC_EXTENSIONS.test(file.name || '');
}

function songFromFile(file) {
  let name = (file.name || '').replace(MUSIC_EXTENSIONS, '');
  const suffix = /-([A-Za-z0-9_-]{11})$/.exec(name);
  const legacy = suffix && (name.slice(0, suffix.index).includes('_') || /[0-9_-]/.test(suffix[1])) && !name.slice(0, suffix.index).endsWith(' ');
  if (legacy) name = name.slice(0, suffix.index).replace(/_/g, ' ');
  name = name.trim();
  const parts = /^(.+?) - (.+)$/.exec(name);
  const variant = /^(?:(?:super|ultra)\s+)?(?:slowed|sped\s+up|reverb|original\s+(?:mix|version)|remix)(?:\s*(?:[+&-]\s*)?(?:reverb|version|edit|down))*$/i;
  const artistTitle = parts && parts[1].trim() && parts[2].trim() && !variant.test(parts[2].trim());
  const metadata = file.appProperties || {};
  return {
    id: file.id,
    title: metadata.title || (artistTitle ? parts[2].trim() : name),
    artist: metadata.artist || (artistTitle ? parts[1].trim() : '未知歌手'),
    album: metadata.album || 'Google Drive',
    duration: Number(metadata.duration) || 0,
    mimeType: file.mimeType,
    size: Number(file.size) || 0,
    fileName: file.name,
    coverUrl: httpsUrl(metadata.coverUrl),
    sourceUrl: httpsUrl(metadata.sourceUrl),
    thumbnailLink: file.thumbnailLink || '',
    hasArtwork: metadata.hasArtwork === '1',
  };
}

function normalizeState(value) {
  const ids = (items, limit) => Array.isArray(items)
    ? [...new Set(items.filter((item) => typeof item === 'string'))].slice(0, limit) : [];
  return { favorites: ids(value?.favorites, 10000), recent: ids(value?.recent, 50) };
}

function validFileId(id) {
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('无效的 Google Drive 文件 ID。');
  return id;
}

function driveError(status, payload) {
  const reason = payload?.error?.errors?.[0]?.reason;
  let message = payload?.error?.message || `Google Drive 返回 ${status}`;
  if (status === 401) message = 'Google 登录已过期，请重新连接账号。';
  if (reason === 'storageQuotaExceeded') message = 'Google Drive 空间不足，请清理空间后重试。';
  if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') message = '请先在 Google Cloud 项目中启用 Google Drive API。';
  const error = new Error(message);
  error.code = status === 401 ? 'GOOGLE_AUTH_REQUIRED' : reason || 'DRIVE_ERROR';
  error.status = status;
  return error;
}

function retryDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function createGoogleDriveApi(getAccessToken, { fetchImpl = globalThis.fetch, sleepImpl = retryDelay } = {}) {
  let folderPromise;
  let stateFileId;
  let saveChain = Promise.resolve();
  const artworkCache = new Map();
  const artworkPending = new Map();

  function invalidateArtwork(id) {
    for (const key of artworkCache.keys()) if (key.startsWith(`${id}|`)) artworkCache.delete(key);
    for (const key of artworkPending.keys()) if (key.startsWith(`${id}|`)) artworkPending.delete(key);
  }

  async function authorizedFetch(url, options = {}) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await getAccessToken({ force: attempt > 0 });
      const response = await fetchImpl(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(30000),
        headers: { ...options.headers, Authorization: `Bearer ${token}` },
      });
      if (response.status !== 401 || attempt > 0) return response;
    }
  }

  async function check(response) {
    if (!response.ok) {
      let payload;
      try { payload = await response.json(); } catch {}
      throw driveError(response.status, payload);
    }
    return response;
  }

  async function json(url, options) {
    const response = await check(await authorizedFetch(url, options));
    return response.json();
  }

  async function listFiles(q) {
    const files = [];
    let pageToken;
    do {
      const params = new URLSearchParams({
        q, spaces: 'drive', pageSize: '1000', fields: `nextPageToken,files(${FILE_FIELDS})`,
        supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
        ...(pageToken ? { pageToken } : {}),
      });
      const page = await json(`${DRIVE_API}/files?${params}`);
      files.push(...(page.files || []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }

  async function getFolder(id) {
    validFileId(id);
    if (id === 'root') return ROOT_FOLDER;
    const folder = await json(`${DRIVE_API}/files/${id}?fields=id,name,mimeType,trashed&supportsAllDrives=true`);
    if (folder.trashed || folder.mimeType !== FOLDER_MIME) {
      throw Object.assign(new Error('这个目录已删除或不是文件夹，请重新选择。'), { status: 404 });
    }
    return { id: folder.id, name: folder.name };
  }

  async function listDirectory(id = 'root') {
    validFileId(id);
    const files = await listFiles(`trashed = false and '${id}' in parents`);
    return {
      folders: files.filter((file) => file.mimeType === FOLDER_MIME)
        .map(({ id: folderId, name }) => ({ id: folderId, name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
      songs: files.filter(isMusicFile).filter((file) => file.mimeType !== FOLDER_MIME)
        .map(songFromFile).sort((a, b) => a.title.localeCompare(b.title, 'zh-CN')),
    };
  }

  function ensureFolder() {
    if (!folderPromise) {
      folderPromise = (async () => {
        const folders = await listFiles("trashed = false and 'me' in owners and mimeType = 'application/vnd.google-apps.folder' and properties has { key='yunganMusic' and value='library-v1' }");
        if (folders.length) return folders.sort((a, b) => a.id.localeCompare(b.id))[0];
        return json(`${DRIVE_API}/files?fields=id,name`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Yungan Music', mimeType: 'application/vnd.google-apps.folder', properties: { yunganMusic: 'library-v1' } }),
        });
      })().catch((error) => { folderPromise = undefined; throw error; });
    }
    return folderPromise;
  }

  async function listSongs() {
    const folder = await ensureFolder();
    const files = await listFiles(`trashed = false and '${folder.id}' in parents and mimeType != 'application/vnd.google-apps.folder'`);
    return files.filter(isMusicFile).map(songFromFile).sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  }

  async function findStateFile() {
    if (stateFileId) return stateFileId;
    const folder = await ensureFolder();
    const files = await listFiles(`trashed = false and '${folder.id}' in parents and properties has { key='yunganMusic' and value='state-v1' }`);
    stateFileId = files.sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''))[0]?.id;
    return stateFileId;
  }

  async function loadState() {
    const id = await findStateFile();
    if (!id) return normalizeState(null);
    try {
      return normalizeState(await json(`${DRIVE_API}/files/${encodeURIComponent(id)}?alt=media`));
    } catch (error) {
      if (error.status !== 404) throw error;
      stateFileId = undefined;
      return normalizeState(null);
    }
  }

  function saveState(value) {
    const state = normalizeState(value);
    const write = async () => {
      const folder = await ensureFolder();
      const id = await findStateFile();
      const metadata = id ? { mimeType: 'application/json' } : {
        name: 'library-state.json', mimeType: 'application/json', parents: [folder.id], properties: { yunganMusic: 'state-v1' },
      };
      const boundary = `yungan_${globalThis.crypto.randomUUID()}`;
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ version: 1, ...state })}\r\n--${boundary}--`;
      const result = await json(`${DRIVE_UPLOAD}/files${id ? `/${encodeURIComponent(id)}` : ''}?uploadType=multipart&fields=id`, {
        method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
      });
      stateFileId = result.id;
    };
    // Keep writes in order, including after a failed write, so older playback events cannot overwrite newer ones.
    saveChain = saveChain.catch(() => {}).then(write);
    return saveChain;
  }

  async function writeMusic(file, { id, metadata, signal, onProgress = () => {} } = {}) {
    if (!isMusicFile(file)) throw new Error(`不支持的音频文件：${file.name}`);
    if (!file.size) throw new Error(`文件为空：${file.name}`);
    signal?.throwIfAborted();
    const existing = id ? await json(`${DRIVE_API}/files/${validFileId(id)}?fields=${FILE_FIELDS}&supportsAllDrives=true`, { signal }) : null;
    const embedded = await readAudioMetadata(file, { signal });
    const details = mergeAudioMetadata(embedded, metadata);
    const appProperties = { ...existing?.appProperties, ...metadataProperties(details) };
    const thumbnail = thumbnailFromMetadata(details);
    if (thumbnail) appProperties.hasArtwork = '1';
    const folder = id ? null : await ensureFolder();
    const contentType = file.type || 'application/octet-stream';
    const body = { name: file.name, mimeType: contentType, properties: { ...existing?.properties, yunganMusic: 'track-v1' },
      ...(folder ? { parents: [folder.id] } : {}),
      ...(Object.keys(appProperties).length ? { appProperties } : {}),
      ...(thumbnail ? { contentHints: { thumbnail } } : {}),
    };
    const response = await check(await authorizedFetch(`${DRIVE_UPLOAD}/files${id ? `/${id}` : ''}?uploadType=resumable&fields=${FILE_FIELDS}&supportsAllDrives=true`, {
      method: id ? 'PATCH' : 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': contentType, 'X-Upload-Content-Length': String(file.size) },
      body: JSON.stringify(body),
    }));
    const sessionUrl = response.headers.get('Location');
    if (!sessionUrl || new URL(sessionUrl).origin !== 'https://www.googleapis.com') throw new Error('Google Drive 未返回有效的上传地址。');
    let offset = 0;
    let retries = 0;
    let probe = false;
    while (offset < file.size || probe) {
      signal?.throwIfAborted();
      const end = Math.min(offset + CHUNK_SIZE, file.size);
      let uploaded;
      try {
        uploaded = await authorizedFetch(sessionUrl, {
          method: 'PUT', signal,
          headers: { 'Content-Type': contentType, 'Content-Range': probe ? `bytes */${file.size}` : `bytes ${offset}-${end - 1}/${file.size}` },
          body: probe ? null : file.slice(offset, end),
        });
        if (uploaded.status === 429 || uploaded.status >= 500) throw new Error('Google Drive 上传暂时不可用。');
      } catch (error) {
        if (signal?.aborted || error.code === 'GOOGLE_AUTH_REQUIRED' || ++retries > 3) throw error;
        await sleepImpl(Math.min(1000 * 2 ** (retries - 1), 4000), signal);
        probe = true;
        continue;
      }
      if (uploaded.ok) {
        const result = await uploaded.json();
        if (id && result.id && result.id !== id) throw new Error('更新返回了不同的文件 ID，请刷新曲库检查。');
        if (id) invalidateArtwork(id);
        onProgress(file.size, file.size);
        return songFromFile({ ...existing, ...body, ...result, ...(id ? { id } : {}), appProperties: { ...appProperties, ...result.appProperties } });
      }
      if (uploaded.status !== 308) await check(uploaded);
      const range = uploaded.headers.get('Range');
      const next = range ? Number(/^bytes=0-(\d+)$/.exec(range)?.[1]) + 1 : 0;
      if (!Number.isFinite(next) || next > file.size || (!probe && next <= offset)) throw new Error('上传进度异常，请重试。');
      if (next > offset) retries = 0;
      offset = next;
      probe = offset === file.size;
      onProgress(offset, file.size);
    }
    throw new Error('上传未完成，请重试。');
  }

  function uploadMusic(file, options) { return writeMusic(file, options); }

  function updateMusic(id, file, options) { return writeMusic(file, { ...options, id: validFileId(id) }); }

  async function updateSongMetadata(id, metadata, { rename = false, signal } = {}) {
    validFileId(id);
    const existing = await json(`${DRIVE_API}/files/${id}?fields=${FILE_FIELDS}&supportsAllDrives=true`, { signal });
    const appProperties = { ...existing.appProperties, ...metadataProperties(metadata) };
    const body = { appProperties };
    const thumbnail = thumbnailFromMetadata(metadata);
    if (thumbnail) { body.contentHints = { thumbnail }; appProperties.hasArtwork = '1'; }
    if (rename) {
      const name = typeof rename === 'string' ? rename : musicFileName(appProperties, existing.name?.match(/\.[^.]+$/)?.[0] || '.mp3');
      if (name) body.name = name;
    }
    const result = await json(`${DRIVE_API}/files/${id}?fields=${FILE_FIELDS}&supportsAllDrives=true`, {
      method: 'PATCH', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    invalidateArtwork(id);
    return songFromFile({ ...existing, ...body, ...result, id, appProperties: { ...appProperties, ...result.appProperties } });
  }

  async function embeddedArtwork(id, signal) {
    const url = `${DRIVE_API}/files/${id}?alt=media&supportsAllDrives=true`;
    const readRange = async (end) => {
      const response = await check(await authorizedFetch(url, { signal, headers: { Range: `bytes=0-${end}` } }));
      // Stop if a server ignores Range instead of fetching a whole music file for its cover.
      if (response.status !== 206) { await response.body?.cancel(); return null; }
      const length = Number(response.headers.get('Content-Length'));
      if (length > end + 1) { await response.body?.cancel(); return null; }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.length === end + 1 ? bytes : null;
    };
    const header = await readRange(9);
    if (!header) return null;
    const length = id3TagLength(header);
    if (!length) return null;
    const bytes = await readRange(length - 1);
    const picture = bytes && parseId3(bytes).picture;
    return picture ? new Blob([picture.data], { type: picture.mimeType }) : null;
  }

  async function artworkUncached(song, { signal } = {}) {
    const id = validFileId(typeof song === 'string' ? song : song?.id);
    let link = typeof song === 'object' ? song.thumbnailLink : '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!link) link = (await json(`${DRIVE_API}/files/${id}?fields=thumbnailLink&supportsAllDrives=true`, { signal })).thumbnailLink;
      if (!link) return embeddedArtwork(id, signal);
      let url;
      try { url = new URL(link); } catch { throw new Error('无效的 Google Drive 封面地址。'); }
      const host = url.hostname.toLowerCase();
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
        || !(host === 'drive.google.com' || host === 'www.googleapis.com' || /^lh\d+\.googleusercontent\.com$/.test(host))) throw new Error('封面地址不属于 Google Drive。');
      // Never forward a Google bearer token through a thumbnail redirect to another host.
      try {
        const response = await authorizedFetch(url.href, { signal, redirect: 'error' });
        if ([403, 404].includes(response.status) && attempt === 0) { link = ''; continue; }
        await check(response);
        const blob = await response.blob();
        if (!/^image\/(?:jpeg|png|webp|gif)$/.test(blob.type) || blob.size > 5 * 1024 * 1024) throw new Error('Google Drive 没有返回有效的封面图片。');
        return blob;
      } catch (error) {
        signal?.throwIfAborted();
        if (error.code === 'GOOGLE_AUTH_REQUIRED') throw error;
        // Google thumbnail hosts may block web CORS; ID3 ranges use the Drive API instead.
        return embeddedArtwork(id, signal);
      }
    }
    return null;
  }

  function artwork(song, { signal } = {}) {
    signal?.throwIfAborted();
    const id = validFileId(typeof song === 'string' ? song : song?.id);
    const key = `${id}|${typeof song === 'object' ? song.thumbnailLink || '' : ''}`;
    const cached = artworkCache.get(key);
    let pending;
    if (cached && cached.expires > Date.now()) {
      artworkCache.delete(key); artworkCache.set(key, cached);
      pending = Promise.resolve(cached.blob);
    } else {
      artworkCache.delete(key);
      pending = artworkPending.get(key);
      if (!pending) {
        // Shared work does not borrow one component's abort signal.
        pending = artworkUncached(song).then((blob) => {
          if (artworkPending.get(key) !== pending) return blob;
          artworkCache.set(key, { blob, expires: Date.now() + (blob ? 300000 : 30000) });
          let bytes = [...artworkCache.values()].reduce((sum, entry) => sum + (entry.blob?.size || 0), 0);
          while (artworkCache.size > 24 || bytes > 20 * 1024 * 1024) {
            const first = artworkCache.keys().next().value;
            bytes -= artworkCache.get(first).blob?.size || 0;
            artworkCache.delete(first);
          }
          return blob;
        }).finally(() => { if (artworkPending.get(key) === pending) artworkPending.delete(key); });
        artworkPending.set(key, pending);
      }
    }
    if (!signal) return pending;
    return new Promise((resolve, reject) => {
      const aborted = () => reject(signal.reason);
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
      pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
    });
  }

  return {
    provider: 'google', base: 'Google Drive', ensureFolder, listSongs, getFolder, listDirectory, loadState, saveState, uploadMusic, updateMusic, updateSongMetadata, artwork,
    flush: () => saveChain,
    getAccount: () => json(`${DRIVE_API}/about?fields=user(displayName,emailAddress,photoLink,permissionId),storageQuota(limit,usage)`),
    mediaUrl: (id) => `${DRIVE_API}/files/${validFileId(id)}?alt=media&supportsAllDrives=true`,
    downloadSong: async (id, signal) => (await check(await authorizedFetch(`${DRIVE_API}/files/${validFileId(id)}?alt=media&supportsAllDrives=true`, { signal }))).blob(),
  };
}

module.exports = { DRIVE_SCOPE, DRIVE_SCOPES, ROOT_FOLDER, MUSIC_EXTENSIONS, MUSIC_ACCEPT, isMusicFile, songFromFile, normalizeState, createGoogleDriveApi };
