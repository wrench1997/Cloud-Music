import { Capacitor, registerPlugin } from '@capacitor/core';
import { DRIVE_SCOPE, DRIVE_SCOPES } from './google-drive';
import { GOOGLE_SETUP_URLS, validateWebClientId } from './google-config';

const GoogleDriveAuth = registerPlugin('GoogleDriveAuth');
const WEB_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';
const WEB_CONFIG_KEY = 'yungan-google-web-client';
let webClientId = WEB_CLIENT_ID;
let identityPromise;
let tokenClient;
let webToken;
let webExpiresAt = 0;

const needsLogin = () => Object.assign(new Error('Google 登录已过期，请点击“重新连接”继续。'), { code: 'GOOGLE_AUTH_REQUIRED' });

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
  if (Capacitor.isNativePlatform()) return { configured: true };
  try { webClientId = localStorage.getItem(WEB_CONFIG_KEY) || WEB_CLIENT_ID; } catch {}
  if (!webClientId) return { configured: false };
  webClientId = validateWebClientId(webClientId);
  await loadGoogleIdentity();
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({ client_id: webClientId, scope: DRIVE_SCOPE, callback: () => {} });
  }
  return { configured: true };
}

export function connectGoogle({ interactive = true, account } = {}) {
  if (window.electronAPI?.google) return window.electronAPI.google.signIn({ interactive });
  if (Capacitor.isNativePlatform()) return GoogleDriveAuth.signIn({ interactive, account }).then((result) => result.accessToken);
  if (!interactive) return Promise.reject(needsLogin());
  if (!tokenClient) return Promise.reject(Object.assign(new Error(webClientId ? 'Google 登录组件尚未就绪，请稍后重试。' : '首次连接需要 Google 应用配置，请在登录页完成设置后继续。'), { code: webClientId ? 'GOOGLE_NOT_READY' : 'GOOGLE_CONFIG_REQUIRED' }));
  return new Promise((resolve, reject) => {
    tokenClient.callback = (result) => {
      if (result.error || !window.google.accounts.oauth2.hasGrantedAllScopes(result, ...DRIVE_SCOPES)) {
        reject(new Error('请允许读取 Google Drive 目录和音乐，以及保存应用曲库。'));
        return;
      }
      webToken = result.access_token;
      webExpiresAt = Date.now() + Number(result.expires_in || 3600) * 1000;
      resolve(webToken);
    };
    tokenClient.error_callback = (result) => reject(new Error(result.type === 'popup_closed' ? 'Google 登录已取消。' : '无法打开 Google 登录窗口，请允许此页面弹出窗口。'));
    // Prepare the script before enabling the button, keeping this call inside the click event.
    tokenClient.requestAccessToken({ prompt: 'select_account', ...(account ? { hint: account } : {}) });
  });
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
}

export async function disconnectGoogle() {
  webToken = undefined;
  webExpiresAt = 0;
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
  const nextClient = window.google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: DRIVE_SCOPE, callback: () => {} });
  localStorage.setItem(WEB_CONFIG_KEY, clientId);
  webClientId = clientId;
  tokenClient = nextClient;
  webToken = undefined;
  webExpiresAt = 0;
  return { configured: true };
}

export function openGoogleSetup(destination = 'console') {
  if (!Object.hasOwn(GOOGLE_SETUP_URLS, destination)) throw new Error('无效的 Google 设置入口。');
  if (window.electronAPI?.google) return window.electronAPI.google.openSetup(destination);
  window.open(GOOGLE_SETUP_URLS[destination], '_blank', 'noopener,noreferrer');
  return Promise.resolve();
}
