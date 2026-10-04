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
  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: true, requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), getPath: () => 'test-user-data', setAppUserModelId: () => {},
    quit: () => { app.emit('before-quit'); window?.close(); },
  });
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.send = (...args) => { this.lastMessage = args; }; window = this; }
    loadFile(file) { this.file = file; }
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
  ipcMain.handle = () => {};
  const electron = { app, BrowserWindow: Window, Tray, Menu: { buildFromTemplate: (items) => items }, ipcMain };
  const requireModule = (name) => {
    if (name === 'electron') return electron;
    if (name === 'better-sqlite3') return Database;
    if (name === './tray') return { createMusicTray };
    if (name === './google-auth') return { createGoogleAuth: () => ({ initialize() {}, dispose() { disposed = true; } }) };
    if (name === './app-updater') return { createAppUpdater: () => ({ start() {}, dispose() {} }) };
    if (name === 'electron-updater') return { autoUpdater: {} };
    return require(name);
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8'), {
    require: requireModule, __dirname: path.join(__dirname, '../electron'),
    process: { platform: 'win32', env: {}, argv: [] },
  });
  await Promise.resolve();
  return { app, window, tray, database, ipcMain, isDisposed: () => disposed };
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
