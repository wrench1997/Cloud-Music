const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { GOOGLE_SETUP_URLS, parseOAuthConfig, validateDesktopConfig: validateConfig } = require('../src/lib/google-config');

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file'];
const DRIVE_SCOPE = DRIVE_SCOPES.join(' ');

function createPkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

function authRequired(message = '请重新连接 Google 账号。') {
  const error = new Error(message);
  error.code = 'GOOGLE_AUTH_REQUIRED';
  return error;
}

function createGoogleAuth({ app, shell, safeStorage, dialog, getWindow, fetchImpl = globalThis.fetch }) {
  let config;
  let tokens;
  let refreshPromise;
  let pendingLogin;
  let server;
  let serverPromise;
  let streamKey = crypto.randomBytes(32).toString('base64url');
  let generation = 0;
  const credentialsPath = path.join(app.getPath('userData'), 'google-account.bin');

  function persist() {
    if (!safeStorage.isEncryptionAvailable()) return;
    const temporary = `${credentialsPath}.tmp`;
    fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify({ config, tokens })), { mode: 0o600 });
    fs.renameSync(temporary, credentialsPath);
  }

  function initialize() {
    if (fs.existsSync(credentialsPath) && safeStorage.isEncryptionAvailable()) {
      try {
        const saved = JSON.parse(safeStorage.decryptString(fs.readFileSync(credentialsPath)));
        config = saved.config;
        tokens = saved.tokens;
      } catch {
        // An account saved by another OS user cannot be decrypted. A new login replaces it.
      }
    }
    if (process.env.GOOGLE_DESKTOP_CLIENT_ID) {
      config = validateConfig({ installed: { client_id: process.env.GOOGLE_DESKTOP_CLIENT_ID, client_secret: process.env.GOOGLE_DESKTOP_CLIENT_SECRET } });
    }
  }

  async function importConfig() {
    const result = await dialog.showOpenDialog(getWindow(), { title: '导入 Google 桌面登录配置', properties: ['openFile'], filters: [{ name: 'Google OAuth JSON', extensions: ['json'] }] });
    if (result.canceled) return { ...status(), canceled: true };
    if (fs.statSync(result.filePaths[0]).size > 65536) throw new Error('客户端配置不能超过 64 KB。');
    return configure(fs.readFileSync(result.filePaths[0], 'utf8'));
  }

  async function configure(text) {
    const imported = validateConfig(parseOAuthConfig(text));
    await signOut();
    config = imported;
    persist();
    return status();
  }

  async function openSetup(destination = 'console') {
    if (!Object.hasOwn(GOOGLE_SETUP_URLS, destination)) throw new Error('无效的 Google 设置入口。');
    await shell.openExternal(GOOGLE_SETUP_URLS[destination]);
  }

  function status() {
    return { configured: Boolean(config?.clientId), connected: Boolean(tokens?.refreshToken || (tokens?.accessToken && tokens.expiresAt > Date.now() + 60000)), remembersLogin: safeStorage.isEncryptionAvailable() };
  }

  async function exchange(params) {
    const response = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, ...(config.clientSecret ? { client_secret: config.clientSecret } : {}), ...params }).toString(),
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) {
      if (data.error === 'invalid_grant') throw authRequired('Google 授权已失效，请重新连接账号。');
      // Network and Google service failures must not discard a securely saved refresh token.
      throw Object.assign(new Error('暂时无法完成 Google 授权，请检查网络后重试。'), { code: 'GOOGLE_TOKEN_EXCHANGE_FAILED' });
    }
    const granted = data.scope ? data.scope.split(/\s+/) : params.grant_type === 'refresh_token' ? tokens?.scopes || [] : [];
    if (!DRIVE_SCOPES.every((scope) => granted.includes(scope))) throw authRequired('请重新登录并允许读取 Google Drive 目录和音乐，以及保存应用曲库。');
    return data;
  }

  function updateTokens(data) {
    tokens = { accessToken: data.access_token, refreshToken: data.refresh_token || tokens?.refreshToken, scopes: data.scope ? data.scope.split(/\s+/) : tokens?.scopes || [], expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
    persist();
    return tokens.accessToken;
  }

  async function getAccessToken({ force = false } = {}) {
    if (tokens && !DRIVE_SCOPES.every((scope) => tokens.scopes?.includes(scope))) throw authRequired('目录读取权限尚未授权，请重新登录 Google。');
    if (!force && tokens?.accessToken && tokens.expiresAt > Date.now() + 60000) return tokens.accessToken;
    if (!tokens?.refreshToken || !config) throw authRequired();
    if (!refreshPromise) {
      const activeGeneration = generation;
      refreshPromise = exchange({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken })
        .then((data) => {
          if (activeGeneration !== generation) throw authRequired();
          return updateTokens(data);
        }).catch((error) => {
          if (activeGeneration === generation && error.code === 'GOOGLE_AUTH_REQUIRED') { tokens = undefined; persist(); }
          throw error;
        }).finally(() => { refreshPromise = undefined; });
    }
    return refreshPromise;
  }

  function finishLogin(error, value) {
    if (!pendingLogin) return;
    const login = pendingLogin;
    pendingLogin = undefined;
    clearTimeout(login.timer);
    if (error) login.reject(error);
    else login.resolve(value);
  }

  async function handleRequest(request, response) {
    const url = new URL(request.url, 'http://127.0.0.1');
    response.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/oauth/callback' && request.method === 'GET') {
      if (!pendingLogin || url.searchParams.get('state') !== pendingLogin.state || pendingLogin.exchanging) {
        response.writeHead(400).end('Invalid authorization response.');
        return;
      }
      pendingLogin.exchanging = true;
      const login = pendingLogin;
      try {
        if (url.searchParams.has('error') || !url.searchParams.get('code')) throw authRequired('Google 登录已取消，或未允许访问曲库。');
        const data = await exchange({ grant_type: 'authorization_code', code: url.searchParams.get('code'), code_verifier: login.verifier, redirect_uri: login.redirectUri });
        if (login.generation !== generation || pendingLogin !== login) throw authRequired();
        // A different Google account must never inherit the previous account's refresh token.
        tokens = undefined;
        const accessToken = updateTokens(data);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'" });
        response.end('<!doctype html><meta charset="utf-8"><title>云感音乐</title><h1>Google 账号已连接</h1><p>可以关闭此页面，返回云感音乐。</p>');
        finishLogin(null, accessToken);
        getWindow()?.focus();
      } catch (error) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Google 登录未完成，请返回云感音乐重试。');
        if (pendingLogin === login) finishLogin(error);
      }
      return;
    }

    const parts = url.pathname.split('/');
    if (!['GET', 'HEAD'].includes(request.method) || parts.length !== 4 || parts[1] !== 'stream' || parts[2] !== streamKey || !/^[\w-]+$/.test(parts[3])) {
      response.writeHead(404).end();
      return;
    }
    const controller = new AbortController();
    response.on('close', () => controller.abort());
    try {
      let upstream;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const accessToken = await getAccessToken({ force: attempt > 0 });
        upstream = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${parts[3]}?alt=media&supportsAllDrives=true`, {
          method: request.method, headers: { Authorization: `Bearer ${accessToken}`, ...(request.headers.range ? { Range: request.headers.range } : {}) }, signal: controller.signal,
        });
        if (upstream.status !== 401) break;
        await upstream.body?.cancel();
      }
      response.statusCode = upstream.status;
      for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const value = upstream.headers.get(name);
        if (value) response.setHeader(name, value);
      }
      if (!upstream.body || request.method === 'HEAD') { response.end(); return; }
      const stream = Readable.fromWeb(upstream.body);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) response.writeHead(error.code === 'GOOGLE_AUTH_REQUIRED' ? 401 : 502).end();
      else response.destroy();
    }
  }

  function ensureServer() {
    if (!serverPromise) {
      serverPromise = new Promise((resolve, reject) => {
        server = http.createServer((request, response) => { handleRequest(request, response).catch(() => response.destroy()); });
        server.once('error', (error) => { serverPromise = undefined; reject(error); });
        server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
      });
    }
    return serverPromise;
  }

  async function signIn({ interactive = true } = {}) {
    if (!config?.clientId) throw Object.assign(new Error('首次连接需要 Google 应用配置，请在登录页完成设置后继续。'), { code: 'GOOGLE_CONFIG_REQUIRED' });
    if (!interactive) return getAccessToken();
    if (pendingLogin) throw new Error('Google 登录窗口已打开，请在浏览器中完成登录。');
    generation += 1;
    const base = await ensureServer();
    const redirectUri = `${base}/oauth/callback`;
    const state = crypto.randomBytes(32).toString('base64url');
    const { verifier, challenge } = createPkcePair();
    const query = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirectUri, response_type: 'code', scope: DRIVE_SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent select_account' });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finishLogin(authRequired('Google 登录超时，请重试。')), 180000);
      pendingLogin = { resolve, reject, timer, state, verifier, redirectUri, generation };
      shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${query}`).catch((error) => finishLogin(error));
    });
  }

  async function signOut() {
    generation += 1;
    finishLogin(authRequired('Google 登录已取消。'));
    tokens = undefined;
    streamKey = crypto.randomBytes(32).toString('base64url');
    persist();
  }

  async function streamUrl(id) {
    if (!/^[\w-]+$/.test(id)) throw new Error('无效的歌曲 ID。');
    await getAccessToken();
    return `${await ensureServer()}/stream/${streamKey}/${id}`;
  }

  function dispose() {
    finishLogin(authRequired('应用已关闭。'));
    server?.closeAllConnections();
    server?.close();
  }

  return { initialize, importConfig, configure, openSetup, status, signIn, signOut, getAccessToken, streamUrl, dispose };
}

module.exports = { createGoogleAuth, createPkcePair, validateConfig };
