const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createGoogleTokenRequester, GOOGLE_LOGIN_TIMEOUT_MS } = require('../src/lib/google-web-token');

function webAuthFixture(values = new Map()) {
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const { oauth2 } = fixture();
  const context = {
    Capacitor: { isNativePlatform: () => false }, registerPlugin: () => ({}),
    DRIVE_SCOPES: ['drive.readonly', 'drive.file'], GOOGLE_SETUP_URLS: {},
    validateWebClientId: (value) => value,
    readWebSession: () => null, writeWebSession: () => { throw new Error('Unexpected token write'); },
    clearWebSession: () => {}, createGoogleTokenRequester,
    localStorage: storage, window: { google: { accounts: { oauth2 } }, sessionStorage: storage },
    process: { env: { NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'browser-client' } },
    setTimeout, clearTimeout,
  };
  // Load the browser module with its platform dependencies stubbed, in an isolated context.
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/google-auth.js'), 'utf8')
    .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
  vm.runInNewContext(`${source}\nglobalThis.auth = { prepareGoogleSignIn, selectGoogleAccount, disconnectGoogle };`, context);
  return { auth: context.auth, storage, values };
}

function fixture() {
  const scopes = ['drive.readonly', 'drive.file'];
  const requests = [];
  const tokens = [];
  const timers = new Map();
  let nextTimer = 0;
  const oauth2 = {
    initTokenClient: (config) => {
      const request = { config };
      requests.push(request);
      // GIS documents the request method; consumers need not mutate a client.
      return Object.freeze({ requestAccessToken: (options) => { request.options = options; } });
    },
    hasGrantedAllScopes: (response, ...required) => required.every((scope) => response.scope.split(' ').includes(scope)),
  };
  const client = createGoogleTokenRequester({
    oauth2, clientId: 'browser-client', scopes,
    onToken: (response) => { tokens.push(response.access_token); return response.access_token; },
    setTimer: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  const response = (token = 'valid-token') => ({ access_token: token, scope: scopes.join(' ') });
  return { client, oauth2, requests, tokens, timers, response };
}

test('GIS popup-block and popup-close errors registered in the initial config settle login and allow a retry', async () => {
  const { client, requests, timers } = fixture();
  for (const [type, code] of [['popup_failed_to_open', 'GOOGLE_POPUP_BLOCKED'], ['popup_closed', 'GOOGLE_LOGIN_CANCELLED']]) {
    const pending = client.signIn();
    const expected = assert.rejects(pending, { code });
    const config = requests.at(-1).config;
    assert.equal(config.client_id, 'browser-client');
    assert.equal(config.scope, 'drive.readonly drive.file');
    config.error_callback({ type });
    await expected;
    assert.equal(timers.size, 0);
  }
  assert.equal(requests.length, 2);
});

test('successful login uses documented login_hint, shares an active request and clears its timer', async () => {
  const { client, requests, timers, tokens, response } = fixture();
  const pending = client.signIn({ account: 'selected@example.com' });
  assert.equal(client.signIn(), pending);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].options, { prompt: '', login_hint: 'selected@example.com' });
  requests[0].config.callback(response());
  assert.equal(await pending, 'valid-token');
  assert.deepEqual(tokens, ['valid-token']);
  assert.equal(timers.size, 0);
  requests[0].config.error_callback({ type: 'popup_closed' });
  assert.deepEqual(tokens, ['valid-token']);
});

test('an explicit account hint is trimmed while an absent or invalid hint keeps the account chooser', async () => {
  const { client, requests, response } = fixture();
  for (const [account, expected] of [
    [' selected@example.com ', { prompt: '', login_hint: 'selected@example.com' }],
    ['', { prompt: 'select_account' }],
    ['  ', { prompt: 'select_account' }],
    [undefined, { prompt: 'select_account' }],
    [null, { prompt: 'select_account' }],
    [42, { prompt: 'select_account' }],
    [{ email: 'selected@example.com' }, { prompt: 'select_account' }],
  ]) {
    const pending = client.signIn({ account });
    assert.deepEqual(requests.at(-1).options, expected);
    requests.at(-1).config.callback(response());
    await pending;
  }
});

test('a preferred account hint never changes required scopes or accepts a rejected grant', async () => {
  const { client, requests, tokens } = fixture();
  for (const invalid of [{ error: 'access_denied' }, { access_token: 'partial', scope: 'drive.readonly' }]) {
    const pending = client.signIn({ account: 'selected@example.com' });
    const rejected = assert.rejects(pending, { code: 'GOOGLE_AUTH_DENIED' });
    assert.equal(requests.at(-1).config.scope, 'drive.readonly drive.file');
    requests.at(-1).config.callback(invalid);
    await rejected;
  }
  assert.deepEqual(tokens, []);
});

test('a callback-less popup times out and its late callback cannot sign in over a new attempt', async () => {
  const { client, requests, timers, tokens, response } = fixture();
  const first = client.signIn();
  const expected = assert.rejects(first, { code: 'GOOGLE_LOGIN_TIMEOUT' });
  const timer = [...timers.values()][0];
  assert.equal(timer.delay, GOOGLE_LOGIN_TIMEOUT_MS);
  timer.callback();
  await expected;
  assert.equal(timers.size, 0);
  const second = client.signIn();
  requests[0].config.callback(response('stale-token'));
  requests[0].config.error_callback({ type: 'popup_closed' });
  assert.deepEqual(tokens, []);
  assert.equal(timers.size, 1);
  requests[1].config.callback(response('retry-token'));
  assert.equal(await second, 'retry-token');
  assert.deepEqual(tokens, ['retry-token']);
});

test('synchronous GIS initialization or request errors clean up and leave login retryable', async () => {
  const { client, oauth2, requests, timers, response } = fixture();
  const initialize = oauth2.initTokenClient;
  oauth2.initTokenClient = () => { throw new Error('Initialization failed'); };
  await assert.rejects(client.signIn(), /Initialization failed/);
  assert.equal(timers.size, 0);
  oauth2.initTokenClient = () => ({ requestAccessToken: () => { throw new Error('Request failed'); } });
  await assert.rejects(client.signIn(), /Request failed/);
  assert.equal(timers.size, 0);
  oauth2.initTokenClient = initialize;
  const pending = client.signIn();
  requests.at(-1).config.callback(response());
  assert.equal(await pending, 'valid-token');
});

test('OAuth denial, incomplete scopes and malformed token responses never save a session', async () => {
  const { client, requests, tokens, timers, response } = fixture();
  for (const invalid of [{ error: 'access_denied' }, { access_token: 'partial', scope: 'drive.readonly' }, { scope: 'drive.readonly drive.file' }, undefined]) {
    const pending = client.signIn();
    const expected = assert.rejects(pending, { code: 'GOOGLE_AUTH_DENIED' });
    requests.at(-1).config.callback(invalid);
    await expected;
    assert.equal(timers.size, 0);
  }
  assert.deepEqual(tokens, []);
  const pending = client.signIn();
  requests.at(-1).config.callback(response());
  assert.equal(await pending, 'valid-token');
});

test('sign-out cancels pending login and ignores any later authorization response', async () => {
  const { client, requests, tokens, timers, response } = fixture();
  const pending = client.signIn();
  const expected = assert.rejects(pending, { code: 'GOOGLE_LOGIN_CANCELLED' });
  client.cancel();
  await expected;
  requests[0].config.callback(response('cancelled-token'));
  assert.deepEqual(tokens, []);
  assert.equal(timers.size, 0);
  client.cancel();
});

test('verified browser email survives reopening as a preference, never as a connected session, and logout clears it', async () => {
  const { auth, storage, values } = webAuthFixture();
  await auth.selectGoogleAccount(' selected@example.com ');
  assert.deepEqual([...values], [['yungan-google-web-account', 'selected@example.com']]);
  const reopened = webAuthFixture(values).auth;
  const status = await reopened.prepareGoogleSignIn();
  assert.equal(status.account, 'selected@example.com');
  assert.equal(status.connected, false);
  assert.equal(status.configured, true);
  await reopened.disconnectGoogle();
  assert.equal(storage.getItem('yungan-google-web-account'), null);
  assert.equal((await reopened.prepareGoogleSignIn()).account, undefined);
});

test('blank verified emails clear a stale browser preference and unavailable storage does not block login preparation', async () => {
  const { auth, storage, values } = webAuthFixture();
  await auth.selectGoogleAccount('selected@example.com');
  await auth.selectGoogleAccount(' ');
  assert.equal(values.size, 0);
  storage.getItem = () => { throw new Error('Storage unavailable'); };
  storage.setItem = storage.removeItem = () => { throw new Error('Storage unavailable'); };
  await auth.selectGoogleAccount('selected@example.com');
  assert.equal((await auth.prepareGoogleSignIn()).account, undefined);
  await auth.disconnectGoogle();
});
