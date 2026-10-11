const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createMusicTray } = require('../electron/tray');

async function desktop() {
  let window, tray, database;
  let disposed = false;
  const youtubeCalls = [];
  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: true, requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), getPath: () => 'test-user-data', setAppUserModelId: () => {},
    quit: () => { app.emit('before-quit'); window?.close(); },
  });
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.mainFrame = {}; this.webContents.send = (...args) => { this.lastMessage = args; }; window = this; }
    loadFile(file) { this.file = file; }
    removeMenu() {}
    hide() { this.hidden = true; }
    show() { this.hidden = false; }
    focus() { this.focused = true; }
    restore() { this.minimized = false; }
    isMinimized() { return Boolean(this.minimized); }
    isDestroyed() { return Boolean(this.destroyed); }
    close() {
      let cancelled = false;
      this.emit('close', { preventDefault: () => { cancelled = true; } });
      if (!cancelled) { this.destroyed = true; this.emit('closed'); }
    }
    static getAllWindows() { return window && !window.destroyed ? [window] : []; }
  }
  class Tray extends EventEmitter {
    constructor() { super(); tray = this; }
    isDestroyed() { return Boolean(this.destroyed); }
    destroy() { this.destroyed = true; }
    setToolTip(value) { this.toolTip = value; }
    setContextMenu(value) { this.menu = value; }
  }
  class Database {
    constructor() { database = this; }
    exec() {}
    close() { this.closed = true; }
  }
  const ipcMain = new EventEmitter();
  ipcMain.handlers = new Map();
  ipcMain.handle = (name, handler) => ipcMain.handlers.set(name, handler);
  const electron = { app, BrowserWindow: Window, Tray, Menu: { buildFromTemplate: (items) => items }, ipcMain };
  const requireModule = (name) => {
    if (name === 'electron') return electron;
    if (name === 'better-sqlite3') return Database;
    if (name === './tray') return { createMusicTray };
    if (name === './youtube-embed') return { attachYouTubeEmbedIdentity() {} };
    if (name === './music-cache') return { createMusicCache: () => ({ list: async () => ({ songs: [] }), dispose() {} }) };
    if (name === './google-auth') return { createGoogleAuth: () => ({ initialize() {}, dispose() { disposed = true; } }) };
    if (name === './youtube-download-session') return { createYoutubeDownloadSession: () => Object.fromEntries(['status', 'usePreview', 'importCookies', 'clear', 'open', 'dispose'].map((method) => [method, () => {
      youtubeCalls.push(method); return { supported: true, configured: method === 'usePreview', revision: method === 'usePreview' ? 'fixture-revision' : '' };
    }])) };
    if (name === './app-updater') return { createAppUpdater: () => ({ start() {}, dispose() {} }) };
    if (name === 'electron-updater') return { autoUpdater: {} };
    return require(name);
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8'), {
    require: requireModule, __dirname: path.join(__dirname, '../electron'),
    process: { platform: 'win32', env: {}, argv: [] },
  });
  await Promise.resolve();
  return { app, window, tray, database, ipcMain, youtubeCalls, isDisposed: () => disposed };
}

test('closing the Windows window keeps the renderer/database alive, while tray exit cleans up', async () => {
  const { window, tray, database, isDisposed } = await desktop();
  assert.equal(window.options.webPreferences.backgroundThrottling, false);
  window.close();
  assert.equal(window.hidden, true);
  assert.equal(window.isDestroyed(), false);
  assert.equal(database.closed, undefined);
  window.minimized = true;
  tray.emit('click');
  assert.equal(window.hidden, false);
  assert.equal(window.minimized, false);
  assert.equal(window.focused, true);
  tray.menu.find((item) => item.label === '退出云感音乐').click();
  assert.equal(window.isDestroyed(), true);
  assert.equal(database.closed, true);
  assert.equal(tray.destroyed, true);
  assert.equal(isDisposed(), true);
});

test('desktop accepts playback updates only from its own renderer and routes tray controls back to it', async () => {
  const { app, window, tray, ipcMain } = await desktop();
  ipcMain.emit('player-state', { sender: {} }, { canPlay: true, title: 'untrusted' });
  assert.equal(tray.menu.find((item) => item.label === '播放').enabled, false);
  ipcMain.emit('player-state', { sender: window.webContents }, { canPlay: true, playing: true, title: '正在播放的歌曲' });
  tray.menu.find((item) => item.label === '暂停').click();
  assert.deepEqual(window.lastMessage, ['player-command', 'toggle-play']);
  window.close();
  app.emit('second-instance', {}, []);
  assert.equal(window.hidden, false);
  app.quit();
});

test('offline cache IPC uses the preload response contract and rejects foreign frames', async () => {
  const { app, window, ipcMain } = await desktop();
  const list = ipcMain.handlers.get('music-cache-list');
  assert.equal((await list({ sender: window.webContents })).ok, true);
  assert.deepEqual((await list({ sender: window.webContents })).data, { songs: [] });
  const rejected = await list({ sender: {} });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error.message, /无效/);
  app.quit();
});

test('YouTube credential management rejects embedded and foreign frames and returns only login status', async () => {
  const { app, window, ipcMain, youtubeCalls } = await desktop();
  const connectPreview = ipcMain.handlers.get('youtube-download-usePreview');
  for (const event of [{ sender: {} }, { sender: window.webContents, senderFrame: {} }]) {
    const rejected = await connectPreview(event); assert.equal(rejected.ok, false); assert.equal(youtubeCalls.length, 0);
  }
  const connected = await connectPreview({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  assert.equal(connected.ok, true); assert.equal(connected.data.configured, true);
  assert.deepEqual(youtubeCalls, ['usePreview']);
  assert.doesNotMatch(JSON.stringify(connected), /cookies|SID|\.txt/);
  app.quit(); assert.ok(youtubeCalls.includes('dispose'));
});
