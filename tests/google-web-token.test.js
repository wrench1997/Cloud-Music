const test = require('node:test');
const assert = require('node:assert/strict');
const { createGoogleTokenRequester, GOOGLE_LOGIN_TIMEOUT_MS } = require('../src/lib/google-web-token');

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
  assert.deepEqual(requests[0].options, { prompt: 'select_account', login_hint: 'selected@example.com' });
  requests[0].config.callback(response());
  assert.equal(await pending, 'valid-token');
  assert.deepEqual(tokens, ['valid-token']);
  assert.equal(timers.size, 0);
  requests[0].config.error_callback({ type: 'popup_closed' });
  assert.deepEqual(tokens, ['valid-token']);
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
