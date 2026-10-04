const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAppUpdater } = require('../electron/app-updater');

function fixture({ packaged = true } = {}) {
  const updater = new EventEmitter();
  const calls = [];
  let timer;
  updater.setFeedURL = (value) => calls.push(['feed', value]);
  updater.checkForUpdates = async () => { calls.push('check'); updater.emit('checking-for-update'); };
  updater.quitAndInstall = (...args) => calls.push(['install', ...args]);
  const controller = createAppUpdater({ app: { isPackaged: packaged, getVersion: () => '1.2.0' }, autoUpdater: updater, platform: 'win32', getWindow: () => ({ isDestroyed: () => false, webContents: { send: (...args) => calls.push(args) } }), prepareQuit: () => calls.push('prepareQuit'), setTimer: (callback) => { timer = callback; return 123; }, clearTimer: (id) => calls.push(['clearTimer', id]) });
  return { controller, updater, calls, runTimer: () => timer?.() };
}

test('packaged Windows checks the fixed GitHub repository and downloads without installing on quit', async () => {
  const { controller, updater, calls, runTimer } = fixture();
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false);
  assert.deepEqual(calls[0][1], { provider: 'github', owner: 'wrench1997', repo: 'Cloud-Music', releaseType: 'release' });
  controller.start();
  runTimer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.includes('check'));
  updater.emit('update-available', { version: '1.3.0' });
  updater.emit('download-progress', { percent: 54.5 });
  assert.equal(controller.status().progress, 55);
  assert.throws(() => controller.install(), /尚未下载/);
  updater.emit('update-downloaded', { version: '1.3.0' });
  await controller.check();
  assert.equal(calls.filter((value) => value === 'check').length, 1);
  controller.install();
  assert.deepEqual(calls.slice(-2), ['prepareQuit', ['install', false, true]]);
  controller.dispose();
});

test('development never checks for updates; errors are recoverable and listeners are cleaned up', async () => {
  const dev = fixture({ packaged: false });
  dev.controller.start(); dev.runTimer(); await dev.controller.check();
  assert.equal(dev.controller.status().state, 'unsupported');
  assert.equal(dev.calls.includes('check'), false);
  dev.controller.dispose();
  const { controller, updater } = fixture();
  updater.checkForUpdates = async () => { throw new Error('network timeout'); };
  await controller.check();
  assert.equal(controller.status().state, 'error');
  assert.match(controller.status().error, /重试/);
  updater.emit('update-not-available');
  assert.equal(controller.status().state, 'current');
  controller.dispose();
  assert.equal(updater.listenerCount('error'), 0);
});

test('concurrent manual and startup checks share one request', async () => {
  const { controller, updater } = fixture();
  let finish;
  let checks = 0;
  updater.checkForUpdates = () => { checks++; return new Promise((resolve) => { finish = resolve; }); };
  const first = controller.check(); const second = controller.check();
  assert.equal(checks, 1);
  finish(); await Promise.all([first, second]);
  controller.dispose();
});
