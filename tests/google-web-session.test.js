const test = require('node:test');
const assert = require('node:assert/strict');
const { DRIVE_SCOPE, DRIVE_SCOPES } = require('../src/lib/google-drive');
const { WEB_SESSION_KEY, readWebSession, writeWebSession, clearWebSession } = require('../src/lib/google-web-session');

function storageFixture() {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

test('browser reload restores an unexpired token for the same Google client without saving refresh credentials', () => {
  const storage = storageFixture();
  writeWebSession(storage, 'client-a', { access_token: 'short-lived-token', refresh_token: 'never-store-this', expires_in: 3600, scope: DRIVE_SCOPE }, 1000);
  const restored = readWebSession(storage, 'client-a', 1000);
  assert.equal(restored.accessToken, 'short-lived-token');
  assert.deepEqual(restored.scopes, DRIVE_SCOPES);
  assert.equal(storage.getItem(WEB_SESSION_KEY).includes('never-store-this'), false);
  clearWebSession(storage);
  assert.equal(readWebSession(storage, 'client-a', 1000), null);
});

test('expired, corrupt, partial-scope and different-client browser sessions cannot silently reconnect', () => {
  const storage = storageFixture();
  for (const [clientId, response, readAt] of [
    ['client-a', { access_token: 'expired', expires_in: 30, scope: DRIVE_SCOPE }, 1000],
    ['client-a', { access_token: 'partial', expires_in: 3600, scope: DRIVE_SCOPES[0] }, 1000],
    ['client-b', { access_token: 'other-client', expires_in: 3600, scope: DRIVE_SCOPE }, 1000],
  ]) {
    writeWebSession(storage, clientId, response, 1000);
    assert.equal(readWebSession(storage, 'client-a', readAt), null);
    assert.equal(storage.getItem(WEB_SESSION_KEY), null);
  }
  storage.setItem(WEB_SESSION_KEY, 'broken-json');
  assert.equal(readWebSession(storage, 'client-a', 1000), null);
  assert.equal(storage.getItem(WEB_SESSION_KEY), null);
});

test('unavailable browser storage leaves an interactive login usable without persistence', () => {
  const denied = { getItem: () => { throw new Error('Denied'); }, setItem: () => { throw new Error('Denied'); }, removeItem: () => { throw new Error('Denied'); } };
  assert.equal(readWebSession(denied, 'client-a'), null);
  const session = writeWebSession(denied, 'client-a', { access_token: 'memory-only', expires_in: 3600, scope: DRIVE_SCOPE }, 1000);
  assert.equal(session.accessToken, 'memory-only');
  assert.doesNotThrow(() => clearWebSession(denied));
});
