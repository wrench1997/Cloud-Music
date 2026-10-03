const { ROOT_FOLDER } = require('./google-drive');

const locationKey = (accountId) => `yungan-directory:${accountId}`;

function normalizeFolderPath(value) {
  if (!Array.isArray(value) || !value.length || value.length > 50 || value[0]?.id !== 'root'
      || value.some((folder) => !folder || typeof folder.id !== 'string' || !/^[\w-]+$/.test(folder.id) || typeof folder.name !== 'string')) {
    return [ROOT_FOLDER];
  }
  return [ROOT_FOLDER, ...value.slice(1).map(({ id, name }) => ({ id, name }))];
}

async function openVerifiedGoogleLibrary(api, { readLocation = () => null } = {}) {
  // Local bookmarks never establish identity. Check Google's authenticated account before reading them.
  const { user, storageQuota } = await api.getAccount();
  if (!user?.emailAddress || !user?.permissionId) throw new Error('无法验证 Google 账号，请重新登录。');
  const session = { provider: 'google', username: user.displayName || user.emailAddress, email: user.emailAddress, accountId: user.permissionId };
  let path = normalizeFolderPath(readLocation(session.accountId));
  let notice = '';
  let directory;
  try {
    if (path.length > 1) path[path.length - 1] = await api.getFolder(path.at(-1).id);
    directory = await api.listDirectory(path.at(-1).id);
  } catch (error) {
    if (path.length === 1 || ![403, 404].includes(error.status)) throw error;
    path = [ROOT_FOLDER];
    notice = '上次的音乐目录已删除或无法访问，请重新选择。';
    directory = await api.listDirectory('root');
  }
  let stateError = '';
  const remoteState = await api.loadState().catch((error) => {
    if (error.status === 401 || error.code === 'GOOGLE_AUTH_REQUIRED') throw error;
    stateError = error.message;
    return null;
  });
  return { session, storageQuota, path, directory, remoteState, notice, stateError };
}

module.exports = { locationKey, normalizeFolderPath, openVerifiedGoogleLibrary };
