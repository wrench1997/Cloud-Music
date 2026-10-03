const GOOGLE_SETUP_URLS = Object.freeze({
  console: 'https://console.cloud.google.com/auth/overview',
  drive: 'https://console.cloud.google.com/apis/library/drive.googleapis.com',
  clients: 'https://console.cloud.google.com/auth/clients',
});

const isClientId = (value) => typeof value === 'string' && /^[\w.-]+\.apps\.googleusercontent\.com$/.test(value) && value.length <= 1024;

function parseOAuthConfig(text) {
  if (typeof text !== 'string' || text.length > 65536) throw new Error('请使用 Google 下载的客户端 JSON 配置，文件不能超过 64 KB。');
  let value;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '').trim()); }
  catch { throw new Error('配置不是有效的 JSON，请粘贴 Google 下载的完整客户端配置。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请使用 Google 下载的客户端 JSON 配置。');
  return value;
}

function validateDesktopConfig(value) {
  const config = value?.installed;
  if (!config || !isClientId(config.client_id) || (config.client_secret !== undefined && (typeof config.client_secret !== 'string' || config.client_secret.length > 2048))) {
    throw new Error('请选择 Google Cloud 下载的“桌面应用”OAuth JSON 配置。');
  }
  return { clientId: config.client_id, clientSecret: config.client_secret || '' };
}

function validateWebClientId(text) {
  if (typeof text !== 'string') throw new Error('请填写 Google Cloud 的 Web 应用客户端 ID。');
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  const clientId = trimmed.startsWith('{') ? parseOAuthConfig(trimmed).web?.client_id : trimmed;
  if (!isClientId(clientId)) throw new Error('网页端需要 Web 应用客户端 ID 或含有 web 对象的 JSON，桌面应用配置不能替代它。');
  // A browser stores only the public client ID, never a JSON client's secret.
  return clientId;
}

module.exports = { GOOGLE_SETUP_URLS, parseOAuthConfig, validateDesktopConfig, validateWebClientId };
