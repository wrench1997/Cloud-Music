const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MAX_COOKIE_BYTES, normalizeYoutubeCookies, youtubeSessionCookies } = require('../src/lib/youtube-cookies');

function createYoutubeDownloadSession({ directory, safeStorage, dialog, getWindow, shell, requireIdle = () => {} }) {
  const credentials = path.join(directory, 'youtube-download-account.bin');
  const temporaryDir = path.join(directory, 'youtube-download-sessions');
  const leases = new Set();
  let saved;
  let initialized = false;
  function initialize() {
    if (initialized) return;
    initialized = true;
    try {
      for (const name of fs.readdirSync(temporaryDir)) if (/^[a-f0-9-]{36}\.txt$/.test(name)) fs.rmSync(path.join(temporaryDir, name), { force: true });
    } catch { /* Only this app's temporary login files are cleaned after an interrupted download. */ }
    try {
      if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(credentials) || fs.statSync(credentials).size > MAX_COOKIE_BYTES * 2) return;
      saved = JSON.parse(safeStorage.decryptString(fs.readFileSync(credentials)));
    } catch { saved = undefined; }
  }
  function status() {
    initialize();
    try {
      if (saved) { normalizeYoutubeCookies(saved.text); return { supported: true, configured: true, revision: saved.revision, source: saved.source }; }
    } catch { return { supported: true, configured: false, revision: '', message: 'YouTube 下载登录已过期，请重新接入登录。' }; }
    return { supported: true, configured: false, revision: '' };
  }
  function configure(text, source = 'import') {
    const normalized = normalizeYoutubeCookies(text);
    requireIdle();
    initialize();
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法加密保存 YouTube 登录，请检查系统凭据服务。');
    const next = { text: normalized, source, revision: saved?.text === normalized ? saved.revision : crypto.randomUUID() };
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${credentials}.tmp`;
    try {
      fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(next)), { mode: 0o600 });
      fs.renameSync(temporary, credentials);
    } finally { fs.rmSync(temporary, { force: true }); }
    saved = next;
    return status();
  }
  async function importCookies() {
    const selection = await dialog.showOpenDialog(getWindow(), { title: '导入 YouTube 下载登录', properties: ['openFile'], filters: [{ name: '浏览器 cookies.txt', extensions: ['txt'] }] });
    if (selection.canceled) return { ...status(), canceled: true };
    if (fs.statSync(selection.filePaths[0]).size > MAX_COOKIE_BYTES) throw new Error('YouTube 登录文件不能超过 128 KB。');
    return configure(fs.readFileSync(selection.filePaths[0], 'utf8'));
  }
  async function usePreview() {
    const session = getWindow()?.webContents.session;
    if (!session) throw new Error('请先打开云感音乐。');
    const [youtube, music] = await Promise.all([session.cookies.get({ url: 'https://www.youtube.com/' }), session.cookies.get({ url: 'https://music.youtube.com/' })]);
    try { return configure(youtubeSessionCookies([...youtube, ...music]), 'preview'); }
    catch (error) {
      if (error.message.includes('没有有效')) throw new Error('应用内没有 YouTube 登录。如果是在外部浏览器登录，请导入该浏览器的 cookies.txt。');
      throw error;
    }
  }
  function lease() {
    if (!status().configured) return { args: [], revision: '', dispose() {} };
    fs.mkdirSync(temporaryDir, { recursive: true });
    const file = path.join(temporaryDir, `${crypto.randomUUID()}.txt`);
    fs.writeFileSync(file, normalizeYoutubeCookies(saved.text).replace(/\n/g, process.platform === 'win32' ? '\r\n' : '\n'), { mode: 0o600, flag: 'wx' });
    leases.add(file);
    return { args: ['--cookies', file], revision: saved.revision, dispose() { fs.rmSync(file, { force: true }); leases.delete(file); } };
  }
  function clear() { requireIdle(); initialize(); fs.rmSync(credentials, { force: true }); saved = undefined; return status(); }
  function dispose() { for (const file of leases) fs.rmSync(file, { force: true }); leases.clear(); }
  return { status, configure, importCookies, usePreview, lease, clear, dispose, open: () => shell.openExternal('https://www.youtube.com/') };
}

module.exports = { createYoutubeDownloadSession };
