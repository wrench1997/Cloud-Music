const RELEASES_URL = 'https://github.com/wrench1997/Cloud-Music/releases';

function createAppUpdater({ app, autoUpdater, getWindow, prepareQuit = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, platform = process.platform }) {
  let state = { state: app.isPackaged && platform === 'win32' ? 'idle' : 'unsupported', currentVersion: app.getVersion(), releasesUrl: RELEASES_URL };
  let timer;
  let checking;
  let disposed = false;
  const listeners = [];
  const publish = (changes) => {
    if (disposed) return;
    state = { ...state, ...changes };
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send('app-update-state', state);
  };
  const listen = (name, callback) => { autoUpdater.on(name, callback); listeners.push([name, callback]); };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.setFeedURL({ provider: 'github', owner: 'wrench1997', repo: 'Cloud-Music', releaseType: 'release' });
  listen('checking-for-update', () => publish({ state: 'checking', error: null }));
  listen('update-available', (info) => publish({ state: 'downloading', version: info.version, progress: 0, error: null }));
  listen('download-progress', (progress) => publish({ state: 'downloading', progress: Math.round(progress.percent) }));
  listen('update-not-available', () => publish({ state: 'current', error: null }));
  listen('update-downloaded', (info) => publish({ state: 'downloaded', version: info.version, progress: 100, error: null }));
  listen('error', () => publish({ state: 'error', error: '暂时无法检查或下载更新，请稍后重试。' }));

  async function check() {
    if (state.state === 'unsupported' || state.state === 'downloading' || state.state === 'downloaded') return state;
    if (checking) return checking;
    checking = (async () => {
      try { await autoUpdater.checkForUpdates(); }
      catch { publish({ state: 'error', error: '暂时无法检查更新，请检查网络后重试。' }); }
      finally { checking = null; }
      return state;
    })();
    return checking;
  }
  function start() {
    if (state.state !== 'unsupported' && !timer) {
      timer = setTimer(() => { timer = null; void check(); }, 3000);
      timer?.unref?.();
    }
  }
  function install() {
    if (state.state !== 'downloaded') throw new Error('更新尚未下载完成。');
    prepareQuit();
    autoUpdater.quitAndInstall(false, true);
    return { ...state, state: 'installing' };
  }
  function dispose() {
    disposed = true;
    if (timer) clearTimer(timer);
    for (const [name, callback] of listeners) autoUpdater.removeListener(name, callback);
  }
  return { start, check, install, status: () => state, dispose };
}

module.exports = { createAppUpdater, RELEASES_URL };
