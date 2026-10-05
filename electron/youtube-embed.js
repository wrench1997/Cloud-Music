// YouTube requires desktop WebViews to identify the app when a file: page
// cannot send an HTTP Referer. The identity matches the installed AppUserModelID.
const APP_REFERER = 'https://com.music.player/';
const EMBED_HOSTS = new Set(['www.youtube.com', 'www.youtube-nocookie.com']);

function youtubeEmbedHeaders(details, window) {
  const headers = { ...details.requestHeaders };
  try {
    const destination = new URL(details.url);
    if (!window || window.isDestroyed() || details.webContentsId !== window.webContents.id
      || details.resourceType !== 'subFrame' || !window.webContents.getURL().startsWith('file:')
      || destination.protocol !== 'https:' || !EMBED_HOSTS.has(destination.hostname)
      || !destination.pathname.startsWith('/embed/')) return headers;
    const referrerKey = Object.keys(headers).find((key) => key.toLowerCase() === 'referer');
    if (referrerKey && /^https?:\/\//i.test(headers[referrerKey])) return headers;
    if (referrerKey) delete headers[referrerKey];
    headers.Referer = APP_REFERER;
  } catch {}
  return headers;
}

function attachYouTubeEmbedIdentity(window) {
  const requests = window.webContents.session.webRequest;
  requests.onBeforeSendHeaders({ urls: ['https://www.youtube.com/embed/*', 'https://www.youtube-nocookie.com/embed/*'] }, (details, callback) => {
    callback({ requestHeaders: youtubeEmbedHeaders(details, window) });
  });
  window.once('closed', () => requests.onBeforeSendHeaders(null));
}

module.exports = { APP_REFERER, youtubeEmbedHeaders, attachYouTubeEmbedIdentity };
