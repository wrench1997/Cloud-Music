import { Capacitor, registerPlugin } from '@capacitor/core';
import { DRIVE_SCOPES } from './google-drive';
import { GOOGLE_SETUP_URLS, validateWebClientId } from './google-config';
import { readWebSession, writeWebSession, clearWebSession } from './google-web-session';
import { createGoogleTokenRequester } from './google-web-token';

const GoogleDriveAuth = registerPlugin('GoogleDriveAuth');
const WEB_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';
const WEB_CONFIG_KEY = 'yungan-google-web-client';
const WEB_ACCOUNT_KEY = 'yungan-google-web-account';
let webClientId = WEB_CLIENT_ID;
let identityPromise;
let tokenClient;
let webToken;
let webExpiresAt = 0;

const needsLogin = () => Object.assign(new Error('Google 登录已过期，请点击“重新连接”继续。'), { code: 'GOOGLE_AUTH_REQUIRED' });

function browserSessionStorage() {
  try { return window.sessionStorage; } catch { return undefined; }
}

function createWebTokenClient(clientId) {
  return createGoogleTokenRequester({
    oauth2: window.google.accounts.oauth2,
    clientId,
    scopes: DRIVE_SCOPES,
    onToken: (result) => {
      const session = writeWebSession(browserSessionStorage(), clientId, result);
      webToken = session.accessToken;
      webExpiresAt = session.expiresAt;
      return webToken;
    },
  });
}

function loadGoogleIdentity() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!identityPromise) {
    identityPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      const timer = setTimeout(() => { script.remove(); identityPromise = undefined; reject(new Error('Google 登录组件加载超时，请检查网络后重试。')); }, 20000);
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = () => { clearTimeout(timer); script.remove(); identityPromise = undefined; reject(new Error('无法加载 Google 登录，请检查网络。')); };
      document.head.appendChild(script);
    });
  }
  return identityPromise;
}

export async function prepareGoogleSignIn() {
  if (window.electronAPI?.google) return window.electronAPI.google.status();
  if (Capacitor.isNativePlatform()) return GoogleDriveAuth.status();
  let account;
  try {
    const preferred = localStorage.getItem(WEB_ACCOUNT_KEY);
    if (typeof preferred === 'string' && preferred.trim()) account = preferred.trim();
  } catch {}
  try { webClientId = localStorage.getItem(WEB_CONFIG_KEY) || WEB_CLIENT_ID; } catch {}
  if (!webClientId) return { configured: false, account };
  webClientId = validateWebClientId(webClientId);
  const saved = readWebSession(browserSessionStorage(), webClientId);
  webToken = saved?.accessToken;
  webExpiresAt = saved?.expiresAt || 0;
  await loadGoogleIdentity();
  if (!tokenClient) {
    tokenClient = createWebTokenClient(webClientId);
  }
  return { configured: true, connected: Boolean(webToken), remembersLogin: true, account };
}

export function connectGoogle({ interactive = true, account } = {}) {
  if (window.electronAPI?.google) return window.electronAPI.google.signIn({ interactive });
  if (Capacitor.isNativePlatform()) return GoogleDriveAuth.signIn({ interactive, account }).then((result) => result.accessToken);
  if (!interactive) return webToken && webExpiresAt > Date.now() + 60000 ? Promise.resolve(webToken) : Promise.reject(needsLogin());
  if (!tokenClient) return Promise.reject(Object.assign(new Error(webClientId ? 'Google 登录组件尚未就绪，请稍后重试。' : '首次连接需要 Google 应用配置，请在登录页完成设置后继续。'), { code: webClientId ? 'GOOGLE_NOT_READY' : 'GOOGLE_CONFIG_REQUIRED' }));
  // The script is ready before enabling the button; the popup request stays in the click event.
  return tokenClient.signIn({ account });
}

export async function getGoogleAccessToken({ force = false, account } = {}) {
  if (window.electronAPI?.google) return window.electronAPI.google.getAccessToken({ force });
  if (Capacitor.isNativePlatform()) {
    const result = await GoogleDriveAuth.signIn({ interactive: false, force, account });
    return result.accessToken;
  }
  if (force || !webToken || webExpiresAt <= Date.now() + 60000) throw needsLogin();
  return webToken;
}

export async function selectGoogleAccount(email) {
  if (Capacitor.isNativePlatform()) await GoogleDriveAuth.setAccount({ email });
  else if (!window.electronAPI?.google) {
    // This is only a chooser hint, saved after the Drive API verifies the email.
    const account = typeof email === 'string' ? email.trim() : '';
    try {
      if (account) localStorage.setItem(WEB_ACCOUNT_KEY, account);
      else localStorage.removeItem(WEB_ACCOUNT_KEY);
    } catch {}
  }
}

export async function disconnectGoogle() {
  tokenClient?.cancel();
  webToken = undefined;
  webExpiresAt = 0;
  clearWebSession(browserSessionStorage());
  if (!window.electronAPI?.google && !Capacitor.isNativePlatform()) {
    try { localStorage.removeItem(WEB_ACCOUNT_KEY); } catch {}
  }
  if (window.electronAPI?.google) await window.electronAPI.google.signOut();
  else if (Capacitor.isNativePlatform()) await GoogleDriveAuth.signOut();
}

export function importGoogleConfig() {
  return window.electronAPI?.google?.importConfig();
}

export async function configureGoogle(text) {
  if (window.electronAPI?.google) return window.electronAPI.google.configure(text);
  if (Capacitor.isNativePlatform()) throw new Error('Android 客户端需要在 Google Cloud 中登记应用和签名，请使用页面的设置入口。');
  const clientId = validateWebClientId(text);
  await loadGoogleIdentity();
  const nextClient = createWebTokenClient(clientId);
  localStorage.setItem(WEB_CONFIG_KEY, clientId);
  tokenClient?.cancel();
  webClientId = clientId;
  tokenClient = nextClient;
  webToken = undefined;
  webExpiresAt = 0;
  clearWebSession(browserSessionStorage());
  return { configured: true };
}

export function openGoogleSetup(destination = 'console') {
  if (!Object.hasOwn(GOOGLE_SETUP_URLS, destination)) throw new Error('无效的 Google 设置入口。');
  if (window.electronAPI?.google) return window.electronAPI.google.openSetup(destination);
  window.open(GOOGLE_SETUP_URLS[destination], '_blank', 'noopener,noreferrer');
  return Promise.resolve();
}
