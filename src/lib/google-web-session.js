const { DRIVE_SCOPES } = require('./google-drive');

const WEB_SESSION_KEY = 'yungan-google-web-session';

function clearWebSession(storage) {
  try { storage?.removeItem(WEB_SESSION_KEY); } catch {}
}

function readWebSession(storage, clientId, now = Date.now()) {
  try {
    const saved = JSON.parse(storage?.getItem(WEB_SESSION_KEY) || 'null');
    if (saved?.clientId === clientId && typeof saved.accessToken === 'string' && saved.accessToken.length > 0
      && Number.isFinite(saved.expiresAt) && saved.expiresAt > now + 60000
      && Array.isArray(saved.scopes) && DRIVE_SCOPES.every((scope) => saved.scopes.includes(scope))) return saved;
  } catch {}
  clearWebSession(storage);
  return null;
}

function writeWebSession(storage, clientId, response, now = Date.now()) {
  const session = {
    clientId, accessToken: response.access_token,
    expiresAt: now + Number(response.expires_in || 3600) * 1000,
    scopes: String(response.scope || '').split(/\s+/),
  };
  // Browser sessions contain only the short-lived access token. Google refresh tokens stay in native storage.
  try { storage?.setItem(WEB_SESSION_KEY, JSON.stringify(session)); } catch {}
  return session;
}

module.exports = { WEB_SESSION_KEY, readWebSession, writeWebSession, clearWebSession };
