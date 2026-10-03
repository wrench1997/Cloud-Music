const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Tray, Menu } = require('electron');
const { createGoogleAuth } = require('./google-auth');
const { createMusicTray } = require('./tray');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

let mainWindow;
let db;
let pendingOpenFile = null;
let musicTray;
let isQuitting = false;
const googleAuth = createGoogleAuth({ app, shell, safeStorage, dialog, getWindow: () => mainWindow });
// 支持的音频格式：MP3, WAV, FLAC, OGG, M4A, AAC, WMA, APE, DSD, AIFF, ALAC, OPUS, AMR
const supportedAudioExtensions = new Set([
  '.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac',
  '.wma', '.ape', '.dsf', '.dff', '.aiff', '.aif',
  '.alac', '.opus', '.amr', '.ac3', '.dts', '.tta'
]);

function getAudioFileFromArgs(args) {
  return args.find((arg) => {
    if (!arg || arg.startsWith('-')) return false;
    const ext = path.extname(arg).toLowerCase();
    return supportedAudioExtensions.has(ext) && fs.existsSync(arg);
  }) || null;
}

function sendOpenFile(filePath) {
  if (!filePath) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingOpenFile = filePath;
    return;
  }

  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('open-audio-file', filePath);
}

// 初始化数据库
function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'music.db');
  db = new Database(dbPath);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      artist TEXT,
      album TEXT,
      filePath TEXT UNIQUE NOT NULL,
      duration INTEGER,
      addedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS playlist_songs (
      playlistId INTEGER,
      songId INTEGER,
      position INTEGER,
      PRIMARY KEY (playlistId, songId),
      FOREIGN KEY (playlistId) REFERENCES playlists(id),
      FOREIGN KEY (songId) REFERENCES songs(id)
    )
  `);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: '云感音乐',
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../public/icon.png'),
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b0709'
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../out/index.html'));
  }

  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingOpenFile) {
      const filePath = pendingOpenFile;
      pendingOpenFile = null;
      sendOpenFile(filePath);
    }
  });

  mainWindow.on('close', (event) => {
    if (musicTray && !isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (db) {
      db.close();
    }
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  pendingOpenFile = getAudioFileFromArgs(process.argv);

  app.on('second-instance', (event, argv) => {
    musicTray?.showWindow();
    sendOpenFile(getAudioFileFromArgs(argv));
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.music.player');
    googleAuth.initialize();
    initDatabase();
    createWindow();
    if (process.platform === 'win32') {
      musicTray = createMusicTray({ app, Tray, Menu, getWindow: () => mainWindow, iconPath: path.join(__dirname, '../public/icon.ico') });
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    sendOpenFile(filePath);
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  musicTray?.destroy();
  googleAuth.dispose();
});

ipcMain.on('player-state', (event, state) => {
  if (event.sender === mainWindow?.webContents && state && typeof state === 'object') musicTray?.update(state);
});

for (const method of ['status', 'importConfig', 'configure', 'openSetup', 'signIn', 'signOut', 'getAccessToken', 'streamUrl']) {
  ipcMain.handle(`google-${method}`, async (event, args) => {
    if (event.sender !== mainWindow?.webContents) return { ok: false, error: { message: '无效的应用窗口。' } };
    try { return { ok: true, data: await googleAuth[method](args) }; }
    catch (error) { return { ok: false, error: { message: error.message, code: error.code } }; }
  });
}

// IPC 处理程序
ipcMain.handle('get-all-songs', () => {
  const stmt = db.prepare('SELECT * FROM songs ORDER BY title');
  return stmt.all();
});

ipcMain.handle('add-song', (event, song) => {
  try {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO songs (title, artist, album, filePath, duration)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(song.title, song.artist, song.album, song.filePath, song.duration);
    return { success: true, id: info.lastInsertRowid };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-song', (event, id) => {
  try {
    const stmt = db.prepare('DELETE FROM songs WHERE id = ?');
    stmt.run(id);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('select-music-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  
  if (result.canceled) {
    return { success: false };
  }
  
  const folderPath = result.filePaths[0];
  const files = fs.readdirSync(folderPath);
  const musicFiles = files.filter(file => 
    /\.(mp3|wav|flac|ogg|m4a|aac|wma|ape|dsf|dff|aiff|aif|alac|opus|amr|ac3|dts|tta)$/i.test(file)
  ).map(file => ({
    filePath: path.join(folderPath, file),
    title: path.basename(file, path.extname(file))
  }));
  
  return { success: true, files: musicFiles };
});

ipcMain.handle('get-file-path', (event, relativePath) => {
  return path.join(app.getAppPath(), relativePath);
});

ipcMain.handle('play-file', (event, filePath) => {
  // 文件路径已经在渲染进程中可以直接使用
  return { success: true, filePath };
});
