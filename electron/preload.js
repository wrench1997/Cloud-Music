const { contextBridge, ipcRenderer } = require('electron');

const google = Object.fromEntries(['status', 'importConfig', 'configure', 'openSetup', 'signIn', 'signOut', 'getAccessToken', 'streamUrl'].map((method) => [method, async (args) => {
  const result = await ipcRenderer.invoke(`google-${method}`, args);
  if (!result.ok) {
    const error = new Error(result.error.message);
    error.code = result.error.code;
    throw error;
  }
  return result.data;
}]));

contextBridge.exposeInMainWorld('electronAPI', {
  updates: {
    status: () => ipcRenderer.invoke('app-update-status'),
    check: () => ipcRenderer.invoke('app-update-check'),
    install: () => ipcRenderer.invoke('app-update-install'),
    onState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('app-update-state', listener);
      return () => ipcRenderer.removeListener('app-update-state', listener);
    },
  },
  downloads: { connect: (options) => ipcRenderer.invoke('downloads-connect', options) },
  google,
  updatePlayerState: (state) => ipcRenderer.send('player-state', state),
  onPlayerCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('player-command', listener);
    return () => ipcRenderer.removeListener('player-command', listener);
  },
  getAllSongs: () => ipcRenderer.invoke('get-all-songs'),
  addSong: (song) => ipcRenderer.invoke('add-song', song),
  deleteSong: (id) => ipcRenderer.invoke('delete-song', id),
  selectMusicFolder: () => ipcRenderer.invoke('select-music-folder'),
  getFilePath: (relativePath) => ipcRenderer.invoke('get-file-path', relativePath),
  playFile: (filePath) => ipcRenderer.invoke('play-file', filePath),
  onOpenAudioFile: (callback) => {
    const listener = (event, filePath) => callback(filePath);
    ipcRenderer.on('open-audio-file', listener);
    return () => ipcRenderer.removeListener('open-audio-file', listener);
  }
});
