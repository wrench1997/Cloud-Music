const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createMusicTray } = require('../electron/tray');

function fixture() {
  let instance;
  const calls = [];
  const window = {
    isDestroyed: () => false, isMinimized: () => true,
    restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus'),
    webContents: { send: (...args) => calls.push(args) },
  };
  class FakeTray extends EventEmitter {
    constructor(iconPath) { super(); this.iconPath = iconPath; instance = this; }
    isDestroyed() { return Boolean(this.destroyed); }
    destroy() { this.destroyed = true; }
    setToolTip(value) { this.toolTip = value; }
    setContextMenu(value) { this.menu = value; }
  }
  const controller = createMusicTray({
    app: { quit: () => calls.push('quit') }, Tray: FakeTray, Menu: { buildFromTemplate: (items) => items },
    getWindow: () => window, iconPath: 'icon.ico',
  });
  return { controller, instance, window, calls };
}

test('tray restores a hidden/minimized window and provides an explicit exit', () => {
  const { controller, instance, calls } = fixture();
  assert.equal(instance.iconPath, 'icon.ico');
  instance.emit('click');
  assert.deepEqual(calls.splice(0), ['restore', 'show', 'focus']);
  instance.menu.find((item) => item.label === '退出云感音乐').click();
  assert.deepEqual(calls, ['quit']);
  controller.destroy();
  controller.destroy();
  assert.equal(instance.isDestroyed(), true);
});

test('tray commands follow actual playback state and stay disabled while logged out or loading', () => {
  const { controller, instance, calls } = fixture();
  assert.equal(instance.menu.find((item) => item.label === '播放').enabled, false);
  instance.menu.find((item) => item.label === '播放').click();
  assert.deepEqual(calls, []);
  controller.update({ canPlay: true, playing: true, title: '夜曲', artist: '歌手' });
  assert.match(instance.toolTip, /夜曲 · 歌手/);
  for (const label of ['暂停', '上一首', '下一首']) {
    const item = instance.menu.find((entry) => entry.label === label);
    assert.equal(item.enabled, true);
    item.click();
  }
  assert.deepEqual(calls, [['player-command', 'toggle-play'], ['player-command', 'previous'], ['player-command', 'next']]);
  controller.update({ canPlay: false });
  assert.equal(instance.menu.find((item) => item.label === '下一首').enabled, false);
});

test('tray handles a destroyed window and late state updates during quit', () => {
  const { controller, window, calls } = fixture();
  window.isDestroyed = () => true;
  controller.update({ canPlay: true });
  controller.showWindow();
  controller.destroy();
  assert.doesNotThrow(() => controller.update({ title: 'late update' }));
  assert.deepEqual(calls, []);
});
