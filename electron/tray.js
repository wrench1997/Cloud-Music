function createMusicTray({ app, Tray, Menu, getWindow, iconPath }) {
  const tray = new Tray(iconPath);
  let state = { canPlay: false, playing: false, title: '', artist: '' };

  function showWindow() {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  function command(action) {
    const window = getWindow();
    if (state.canPlay && window && !window.isDestroyed()) window.webContents.send('player-command', action);
  }

  function update(next = {}) {
    if (tray.isDestroyed()) return;
    state = {
      canPlay: Boolean(next.canPlay), playing: Boolean(next.playing),
      title: String(next.title || '').slice(0, 100), artist: String(next.artist || '').slice(0, 100),
    };
    const song = state.title ? `${state.title}${state.artist ? ` · ${state.artist}` : ''}` : '未播放';
    tray.setToolTip(`云感音乐\n${song}`.slice(0, 127));
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开云感音乐', click: showWindow },
      { label: song, enabled: false },
      { type: 'separator' },
      { label: state.playing ? '暂停' : '播放', enabled: state.canPlay, click: () => command('toggle-play') },
      { label: '上一首', enabled: state.canPlay, click: () => command('previous') },
      { label: '下一首', enabled: state.canPlay, click: () => command('next') },
      { type: 'separator' },
      { label: '退出云感音乐', click: () => app.quit() },
    ]));
  }

  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  update();

  return { update, showWindow, destroy: () => { if (!tray.isDestroyed()) tray.destroy(); } };
}

module.exports = { createMusicTray };
