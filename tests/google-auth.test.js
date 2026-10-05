const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createGoogleAuth, createPkcePair, validateConfig } = require('../electron/google-auth');
const { createMusicCache } = require('../electron/music-cache');

const { DRIVE_SCOPES, DRIVE_SCOPE: scope } = require('../src/lib/google-drive');
const tokenResponse = (token, refreshToken) => ({ access_token: token, ...(refreshToken ? { refresh_token: refreshToken } : {}), expires_in: 3600, scope });

async function fixture(t, fetchImpl, { importCredentials = true, getMusicCache } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yungan-music-test-'));
  const oauthPath = path.join(directory, 'oauth.json');
  fs.writeFileSync(oauthPath, JSON.stringify({ installed: { client_id: 'test-client.apps.googleusercontent.com', client_secret: 'public-desktop-secret' } }));
  const key = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    decryptString: (value) => {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString();
    },
  };
  let onOpen;
  const deps = { app: { getPath: () => directory }, safeStorage, shell: { openExternal: async (url) => onOpen(new URL(url)) }, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [oauthPath] }) }, getWindow: () => undefined, getMusicCache, fetchImpl };
  const auth = createGoogleAuth(deps);
  auth.initialize();
  if (importCredentials) await auth.importConfig();
  t.after(() => {
    auth.dispose();
    assert.equal(directory.startsWith(path.join(os.tmpdir(), 'yungan-music-test-')), true);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const begin = async () => {
    const opened = new Promise((resolve) => { onOpen = resolve; });
    const pending = auth.signIn();
    pending.catch(() => {});
    const url = await opened;
    const callback = (state = url.searchParams.get('state')) => `${url.searchParams.get('redirect_uri')}?code=authorization-code&state=${encodeURIComponent(state)}`;
    return { pending, url, callback };
  };
  return { auth, begin, directory, deps };
}

test('desktop credentials reject web clients and PKCE challenge matches a cryptographic verifier', () => {
  assert.throws(() => validateConfig({ web: { client_id: 'test.apps.googleusercontent.com' } }), /桌面应用/);
  assert.throws(() => validateConfig({ installed: { client_id: 'https://untrusted.example' } }), /桌面应用/);
  const { verifier, challenge } = createPkcePair();
  assert.ok(verifier.length >= 43);
  assert.equal(challenge, crypto.createHash('sha256').update(verifier).digest('base64url'));
});

test('first-use setup opens only official Google destinations and never pretends to sign in without a client', async (t) => {
  let requests = 0;
  const { auth, deps } = await fixture(t, async () => { requests += 1; throw new Error('No OAuth request expected'); }, { importCredentials: false });
  const opened = [];
  deps.shell.openExternal = async (url) => opened.push(url);
  await assert.rejects(auth.signIn(), { code: 'GOOGLE_CONFIG_REQUIRED' });
  assert.equal(auth.status().connected, false);
  assert.equal(requests, 0);
  await auth.openSetup();
  await auth.openSetup('drive');
  await auth.openSetup('clients');
  assert.equal(opened.length, 3);
  for (const url of opened) assert.equal(new URL(url).origin, 'https://console.cloud.google.com');
  for (const destination of ['https://untrusted.example', '__proto__', 'constructor']) await assert.rejects(auth.openSetup(destination), /无效/);
  assert.equal(opened.length, 3);
  await auth.configure(fs.readFileSync(path.join(deps.app.getPath(), 'oauth.json'), 'utf8'));
  assert.equal(auth.status().configured, true);
  assert.equal(auth.status().connected, false);
});

test('invalid pasted configuration and cancelled imports preserve a verified account', async (t) => {
  const { auth, begin, deps } = await fixture(t, async () => Response.json(tokenResponse('existing-access', 'existing-refresh')));
  const login = await begin();
  await fetch(login.callback());
  await login.pending;
  for (const text of ['not-json', 'null', '{"web":{"client_id":"web.apps.googleusercontent.com"}}']) await assert.rejects(auth.configure(text));
  assert.equal(await auth.getAccessToken(), 'existing-access');
  deps.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  const result = await auth.importConfig();
  assert.equal(result.canceled, true);
  assert.equal(result.connected, true);
  assert.equal(await auth.getAccessToken(), 'existing-access');
});

test('system-browser login validates state before exchanging the authorization code and encrypts tokens', async (t) => {
  let exchanges = 0;
  let verifier;
  const { auth, begin, directory } = await fixture(t, async (url, options) => {
    exchanges += 1;
    const params = new URLSearchParams(options.body);
    assert.equal(params.get('grant_type'), 'authorization_code');
    verifier = params.get('code_verifier');
    return Response.json(tokenResponse('first-access', 'first-refresh'));
  });
  const login = await begin();
  assert.equal(login.url.origin, 'https://accounts.google.com');
  assert.equal(login.url.searchParams.get('code_challenge_method'), 'S256');
  assert.deepEqual(login.url.searchParams.get('scope').split(' '), DRIVE_SCOPES);
  assert.equal((await fetch(login.callback('wrong-state'))).status, 400);
  assert.equal(exchanges, 0);
  assert.equal((await fetch(login.callback())).status, 200);
  assert.equal(await login.pending, 'first-access');
  assert.equal(login.url.searchParams.get('code_challenge'), crypto.createHash('sha256').update(verifier).digest('base64url'));
  const saved = fs.readFileSync(path.join(directory, 'google-account.bin'));
  assert.equal(saved.includes(Buffer.from('first-refresh')), false);
  assert.equal(saved.includes(Buffer.from('first-access')), false);
  assert.equal(auth.status().connected, true);
});

test('concurrent access-token refresh makes one exchange and restores securely saved login', async (t) => {
  let refreshes = 0;
  const { auth, begin, deps } = await fixture(t, async (url, options) => {
    const params = new URLSearchParams(options.body);
    if (params.get('grant_type') === 'refresh_token') {
      refreshes += 1;
      assert.equal(params.get('refresh_token'), 'first-refresh');
      const refreshed = tokenResponse('refreshed-access');
      delete refreshed.scope;
      return Response.json(refreshed);
    }
    return Response.json(tokenResponse('first-access', 'first-refresh'));
  });
  const login = await begin();
  await fetch(login.callback());
  await login.pending;
  const tokens = await Promise.all(Array.from({ length: 10 }, () => auth.getAccessToken({ force: true })));
  assert.equal(refreshes, 1);
  assert.equal(tokens.every((value) => value === 'refreshed-access'), true);
  const restored = createGoogleAuth(deps);
  t.after(() => restored.dispose());
  restored.initialize();
  assert.equal(await restored.signIn({ interactive: false }), 'refreshed-access');
});

test('desktop relaunch refreshes an expired encrypted session without opening login and logout persists across restarts', async (t) => {
  let refreshes = 0;
  const { auth, begin, deps, directory } = await fixture(t, async (url, options) => {
    const params = new URLSearchParams(options.body);
    if (params.get('grant_type') === 'refresh_token') {
      refreshes += 1;
      return Response.json(tokenResponse('restored-access'));
    }
    return Response.json(tokenResponse('initial-access', 'persistent-refresh'));
  });
  const login = await begin();
  await fetch(login.callback());
  await login.pending;
  const credentialsPath = path.join(directory, 'google-account.bin');
  const saved = JSON.parse(deps.safeStorage.decryptString(fs.readFileSync(credentialsPath)));
  saved.tokens.expiresAt = Date.now() - 1000;
  fs.writeFileSync(credentialsPath, deps.safeStorage.encryptString(JSON.stringify(saved)));
  deps.shell.openExternal = () => { throw new Error('Restoring login must not open a browser'); };
  const restored = createGoogleAuth(deps);
  restored.initialize();
  t.after(() => restored.dispose());
  assert.equal(restored.status().connected, true);
  assert.equal(await restored.signIn({ interactive: false }), 'restored-access');
  assert.equal(refreshes, 1);
  await restored.signOut();
  const loggedOut = createGoogleAuth(deps);
  loggedOut.initialize();
  t.after(() => loggedOut.dispose());
  assert.equal(loggedOut.status().connected, false);
  await assert.rejects(loggedOut.signIn({ interactive: false }), { code: 'GOOGLE_AUTH_REQUIRED' });
});

test('temporary refresh-service errors preserve a saved desktop account while revoked grants clear it', async (t) => {
  let failure = 'temporary';
  const { auth, begin, deps } = await fixture(t, async (url, options) => {
    if (new URLSearchParams(options.body).get('grant_type') !== 'refresh_token') return Response.json(tokenResponse('initial', 'saved-refresh'));
    return Response.json({ error: failure === 'temporary' ? 'temporarily_unavailable' : 'invalid_grant' }, { status: failure === 'temporary' ? 503 : 400 });
  });
  const login = await begin();
  await fetch(login.callback());
  await login.pending;
  await assert.rejects(auth.getAccessToken({ force: true }), { code: 'GOOGLE_TOKEN_EXCHANGE_FAILED' });
  assert.equal(auth.status().connected, true);
  const afterNetworkFailure = createGoogleAuth(deps);
  afterNetworkFailure.initialize();
  t.after(() => afterNetworkFailure.dispose());
  assert.equal(afterNetworkFailure.status().connected, true);
  failure = 'revoked';
  await assert.rejects(auth.getAccessToken({ force: true }), { code: 'GOOGLE_AUTH_REQUIRED' });
  const afterRevocation = createGoogleAuth(deps);
  afterRevocation.initialize();
  t.after(() => afterRevocation.dispose());
  assert.equal(afterRevocation.status().connected, false);
});

test('switching accounts never reuses another account refresh token and logout invalidates stream links', async (t) => {
  let grants = 0;
  const { auth, begin } = await fixture(t, async (url, options) => {
    const params = new URLSearchParams(options.body);
    assert.equal(params.get('grant_type'), 'authorization_code');
    grants += 1;
    return Response.json(grants === 1 ? tokenResponse('account-a', 'refresh-a') : tokenResponse('account-b'));
  });
  let login = await begin();
  await fetch(login.callback());
  await login.pending;
  const streamUrl = await auth.streamUrl('track-id');
  assert.equal(new URL(streamUrl).searchParams.has('access_token'), false);
  login = await begin();
  await fetch(login.callback());
  await login.pending;
  await assert.rejects(auth.getAccessToken({ force: true }), { code: 'GOOGLE_AUTH_REQUIRED' });
  await auth.signOut();
  assert.equal((await fetch(streamUrl)).status, 404);
  assert.equal(auth.status().connected, false);
});

test('desktop playback forwards Range and Authorization headers without exposing Google tokens in URLs', async (t) => {
  let mediaRequests = 0;
  const { auth, begin } = await fixture(t, async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') return Response.json(tokenResponse('private-access', 'private-refresh'));
    mediaRequests += 1;
    assert.equal(new URL(url).searchParams.has('access_token'), false);
    assert.equal(options.headers.Authorization, 'Bearer private-access');
    assert.equal(options.headers.Range, 'bytes=10-13');
    return new Response('ABCD', { status: 206, headers: { 'Content-Range': 'bytes 10-13/100', 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes' } });
  });
  const login = await begin();
  await fetch(login.callback());
  await login.pending;
  const url = await auth.streamUrl('track-id');
  assert.equal(url.includes('private-access'), false);
  const response = await fetch(url, { headers: { Range: 'bytes=10-13' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 10-13/100');
  assert.equal(await response.text(), 'ABCD');
  assert.equal(mediaRequests, 1);
  await assert.rejects(auth.streamUrl('../untrusted'), /无效/);
});

test('cancelling a pending login prevents a late browser callback from reconnecting the account', async (t) => {
  let exchanges = 0;
  const { auth, begin } = await fixture(t, async () => { exchanges += 1; return Response.json(tokenResponse('cancelled', 'cancelled-refresh')); });
  const login = await begin();
  await auth.signOut();
  await assert.rejects(login.pending, { code: 'GOOGLE_AUTH_REQUIRED' });
  assert.equal((await fetch(login.callback())).status, 400);
  assert.equal(exchanges, 0);
  assert.equal(auth.status().connected, false);
});

test('desktop login rejects granting only one of the two required Drive permissions', async (t) => {
  for (const partialScope of DRIVE_SCOPES) {
    const { auth, begin } = await fixture(t, async () => Response.json({ ...tokenResponse('partial', 'partial-refresh'), scope: partialScope }));
    const login = await begin();
    assert.equal((await fetch(login.callback())).status, 400);
    await assert.rejects(login.pending, { code: 'GOOGLE_AUTH_REQUIRED' });
    assert.equal(auth.status().connected, false);
    await assert.rejects(auth.streamUrl('song'), { code: 'GOOGLE_AUTH_REQUIRED' });
  }
});

test('desktop cloud playback saves once using verified Drive identity and remains locally playable after logout', async (t) => {
  let cache;
  let mediaRequests = 0, aboutRequests = 0;
  const { auth, begin, directory } = await fixture(t, async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') return Response.json(tokenResponse('cache-private-access', 'cache-private-refresh'));
    assert.equal(options.headers.Authorization, 'Bearer cache-private-access');
    if (url.includes('/about?')) { aboutRequests += 1; return Response.json({ user: { permissionId: 'real-permission-id', emailAddress: 'current-account@example.test' } }); }
    if (url.includes('alt=media')) { mediaRequests += 1; return new Response('saved audio', { headers: { 'content-length': '11', 'content-type': 'audio/mpeg' } }); }
    return Response.json({ id: 'cache-track', name: 'Artist - Title.mp3', mimeType: 'audio/mpeg', size: '11', appProperties: { title: 'Song title', artist: 'Song artist', duration: '90' } });
  }, { getMusicCache: () => cache });
  cache = createMusicCache({ directory: path.join(directory, 'music-cache'), getIdentity: auth.cacheIdentity, getSource: auth.cacheSource });
  t.after(() => cache.dispose());
  const login = await begin(); await fetch(login.callback()); await login.pending;
  const url = await auth.streamUrl('cache-track');
  assert.ok(url.includes('/music-cache/')); assert.equal(url.includes('cache-private-access'), false);
  assert.equal(await (await fetch(url)).text(), 'saved audio');
  assert.equal(await auth.streamUrl('cache-track'), url); assert.equal(mediaRequests, 1); assert.equal(aboutRequests, 1);
  await auth.signOut();
  const { songs } = await cache.list();
  assert.equal(songs[0].title, 'Song title'); assert.equal(songs[0].originalAccount.id, 'real-permission-id');
  assert.equal(await (await fetch(songs[0].localUri)).text(), 'saved audio');
  assert.equal(auth.status().connected, false); assert.equal(mediaRequests, 1);
});

test('explicit online fallback skips a failed disk cache instead of repeating the same download', async (t) => {
  let attempts = 0;
  const { auth, begin } = await fixture(t, async () => Response.json(tokenResponse('fallback-access', 'fallback-refresh')), {
    getMusicCache: () => ({ cache: async () => { attempts += 1; throw new Error('disk full'); } }),
  });
  const login = await begin(); await fetch(login.callback()); await login.pending;
  assert.ok((await auth.streamUrl('track')).includes('/stream/'));
  assert.ok((await auth.streamUrl({ id: 'track', skipCache: true })).includes('/stream/'));
  assert.equal(attempts, 1);
});

test('cache source refreshes a rejected token once and refuses identity supplied for another account', async (t) => {
  let refreshes = 0, aboutRequests = 0;
  const { auth, begin } = await fixture(t, async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const refresh = new URLSearchParams(options.body).get('grant_type') === 'refresh_token';
      if (refresh) refreshes += 1;
      return Response.json(tokenResponse(refresh ? 'fresh-private' : 'old-private', 'saved-refresh'));
    }
    if (url.includes('/about?')) {
      aboutRequests += 1;
      if (options.headers.Authorization === 'Bearer old-private') return new Response('', { status: 401 });
      return Response.json({ user: { permissionId: 'account-verified', emailAddress: 'verified@example.test' } });
    }
    throw new Error('Another account must not reach media or metadata requests');
  });
  const login = await begin(); await fetch(login.callback()); await login.pending;
  assert.deepEqual(await auth.cacheIdentity(), { id: 'account-verified', email: 'verified@example.test' });
  assert.equal(refreshes, 1); assert.equal(aboutRequests, 2);
  await assert.rejects(auth.cacheSource({ fileId: 'track', identity: { id: 'other-account' } }), { code: 'GOOGLE_AUTH_REQUIRED' });
  await assert.rejects(auth.cacheSource({ fileId: '../outside', identity: { id: 'account-verified' } }), /无效/);
});

test('cache thumbnails never send Google tokens to arbitrary hosts or follow authenticated redirects', async (t) => {
  let thumbnail = 'https://untrusted.example/picture.jpg';
  let imageRequests = 0;
  const { auth, begin } = await fixture(t, async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') return Response.json(tokenResponse('private-thumbnail-token', 'refresh'));
    if (url.includes('/about?')) return Response.json({ user: { permissionId: 'verified', emailAddress: 'verified@example.test' } });
    if (url.includes('alt=media')) return new Response('audio');
    if (url.startsWith('https://www.googleapis.com/drive/v3/files/')) return Response.json({ id: 'track', name: 'Song.mp3', mimeType: 'audio/mpeg', thumbnailLink: thumbnail });
    imageRequests += 1;
    assert.equal(new URL(url).hostname, 'lh3.googleusercontent.com'); assert.equal(options.redirect, 'error');
    throw new TypeError('redirect rejected');
  });
  const login = await begin(); await fetch(login.callback()); await login.pending;
  const identity = await auth.cacheIdentity();
  let source = await auth.cacheSource({ fileId: 'track', identity });
  assert.equal(await source.getCover(), null); assert.equal(imageRequests, 0); await source.response.body.cancel();
  thumbnail = 'https://lh3.googleusercontent.com/image';
  source = await auth.cacheSource({ fileId: 'track', identity });
  await assert.rejects(source.getCover(), /redirect rejected/); assert.equal(imageRequests, 1); await source.response.body.cancel();
});
