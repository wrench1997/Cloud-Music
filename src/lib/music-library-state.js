const localId = (id) => typeof id === 'string' && /^(native|cache):/.test(id);

function cloudMusicState(state) {
  return { ...state, favorites: (state.favorites || []).filter((id) => !localId(id)), recent: (state.recent || []).filter((id) => !localId(id)) };
}

// Device downloads belong to this device. Refreshing or changing a cloud
// account must neither remove their preferences nor copy those IDs to Drive.
function mergeCloudMusicState(cloud, device) {
  const remote = cloudMusicState(cloud);
  return { ...remote,
    favorites: [...new Set([...remote.favorites, ...(device.favorites || []).filter(localId)])],
    recent: [...new Set([...(device.recent || []).filter(localId), ...remote.recent])].slice(0, 50),
  };
}

module.exports = { cloudMusicState, mergeCloudMusicState };
