const { nativeCloudConfig } = require('./download-job-state');
const { catalogResult } = require('./music-catalog');

async function nativeDownloadRequest(plugin, route, data, method) {
  const result = await plugin.request({ route, method: method || (data ? 'POST' : 'GET'), ...(data ? { data } : {}) });
  if (result?.error && !result.id && !Array.isArray(result.jobs)) throw new Error(result.error);
  if (route === '/catalog') return catalogResult(data, result);
  return route === '/match' ? result.entries || result.candidates || [] : result;
}

async function authorizeNativeUpload(jobId, signIn, request) {
  const result = await signIn({ interactive: true });
  if (result?.error) throw result.error;
  const session = result?.session;
  if (!result?.connected || result.cancelled || !session?.accountId || !session.email) throw new Error('Google 授权尚未完成，本机 MP3 已保留。');
  const cloud = nativeCloudConfig(true, session.accountId, session.email);
  return request(`/jobs/${jobId}/upload`, { cloud });
}

module.exports = { nativeDownloadRequest, authorizeNativeUpload };
