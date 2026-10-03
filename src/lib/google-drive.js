const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file'];
const DRIVE_SCOPE = DRIVE_SCOPES.join(' ');
const ROOT_FOLDER = { id: 'root', name: '我的云盘' };
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MUSIC_EXTENSIONS = /\.(mp3|wav|flac|ogg|m4a|aac|wma|ape|dsf|dff|aiff|aif|alac|opus|amr|ac3|dts|tta|webm)$/i;
const MUSIC_ACCEPT = 'audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac,.wma,.ape,.dsf,.dff,.aiff,.aif,.alac,.opus,.amr,.ac3,.dts,.tta,.webm';
const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,properties,appProperties';
const CHUNK_SIZE = 8 * 1024 * 1024;

function isMusicFile(file) {
  return MUSIC_EXTENSIONS.test(file.name || '');
}

function songFromFile(file) {
  const name = (file.name || '').replace(MUSIC_EXTENSIONS, '');
  const separator = name.indexOf(' - ');
  const metadata = file.appProperties || {};
  return {
    id: file.id,
    title: metadata.title || (separator >= 0 ? name.slice(separator + 3) : name),
    artist: metadata.artist || (separator >= 0 ? name.slice(0, separator) : '未知歌手'),
    album: metadata.album || 'Google Drive',
    duration: Number(metadata.duration) || 0,
    mimeType: file.mimeType,
    size: Number(file.size) || 0,
    fileName: file.name,
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

  async function uploadMusic(file, { signal, onProgress = () => {} } = {}) {
    if (!isMusicFile(file)) throw new Error(`不支持的音频文件：${file.name}`);
    if (!file.size) throw new Error(`文件为空：${file.name}`);
    const folder = await ensureFolder();
    const contentType = file.type || 'application/octet-stream';
    const response = await check(await authorizedFetch(`${DRIVE_UPLOAD}/files?uploadType=resumable&fields=${FILE_FIELDS}`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': contentType, 'X-Upload-Content-Length': String(file.size) },
      body: JSON.stringify({ name: file.name, mimeType: contentType, parents: [folder.id], properties: { yunganMusic: 'track-v1' } }),
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
        onProgress(file.size, file.size);
        return songFromFile(await uploaded.json());
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

  return {
    provider: 'google', base: 'Google Drive', ensureFolder, listSongs, getFolder, listDirectory, loadState, saveState, uploadMusic,
    flush: () => saveChain,
    getAccount: () => json(`${DRIVE_API}/about?fields=user(displayName,emailAddress,photoLink,permissionId),storageQuota(limit,usage)`),
    mediaUrl: (id) => `${DRIVE_API}/files/${validFileId(id)}?alt=media&supportsAllDrives=true`,
    downloadSong: async (id, signal) => (await check(await authorizedFetch(`${DRIVE_API}/files/${validFileId(id)}?alt=media&supportsAllDrives=true`, { signal }))).blob(),
  };
}

module.exports = { DRIVE_SCOPE, DRIVE_SCOPES, ROOT_FOLDER, MUSIC_EXTENSIONS, MUSIC_ACCEPT, isMusicFile, songFromFile, normalizeState, createGoogleDriveApi };
