const MAX_COOKIE_BYTES = 128 * 1024;
const AUTH_COOKIES = new Set(['SID', 'SAPISID', '__Secure-1PSID', '__Secure-3PSID', '__Secure-1PAPISID', '__Secure-3PAPISID']);
const youtubeDomain = (domain) => /^\.?([a-z0-9-]+\.)*youtube\.com$/i.test(domain);

function normalizeYoutubeCookies(text, now = Date.now()) {
  if (typeof text !== 'string' || text.length > MAX_COOKIE_BYTES || new TextEncoder().encode(text).length > MAX_COOKIE_BYTES) throw new Error('YouTube 登录文件不能超过 128 KB。');
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (!/^# (?:Netscape HTTP Cookie File|HTTP Cookie File)\s*$/.test(lines.shift() || '')) throw new Error('请选择浏览器导出的 Netscape cookies.txt 登录文件。');
  const cookies = new Map();
  for (let line of lines) {
    if (!line || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) continue;
    const httpOnly = line.startsWith('#HttpOnly_');
    if (httpOnly) line = line.slice(10);
    const row = line.split('\t');
    if (row.length !== 7) throw new Error('登录文件格式不正确，请重新导出 cookies.txt。');
    let [domain, subdomains, cookiePath, secure, expires, name, value] = row;
    if (!youtubeDomain(domain)) continue;
    domain = domain.toLowerCase();
    if (!['TRUE', 'FALSE'].includes(subdomains) || !['TRUE', 'FALSE'].includes(secure) || !/^\d{1,12}$/.test(expires)
        || !cookiePath.startsWith('/') || cookiePath.length > 1024 || !/^[!#$%&'*+.^_`|~A-Za-z0-9-]{1,128}$/.test(name)
        || !value || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value + cookiePath)) throw new Error('YouTube 登录文件包含无效 Cookie，请重新导出。');
    if (Number(expires) && Number(expires) <= Math.floor(now / 1000)) continue;
    cookies.set(`${domain}\t${cookiePath}\t${name}`, { name, row: `${httpOnly ? '#HttpOnly_' : ''}${[domain, subdomains, cookiePath, secure, expires, name, value].join('\t')}` });
    if (cookies.size > 300) throw new Error('YouTube 登录文件包含过多 Cookie。');
  }
  if (![...cookies.values()].some((cookie) => AUTH_COOKIES.has(cookie.name))) throw new Error('文件中没有有效的 YouTube 登录，请在 YouTube 登录后重新导出。');
  return '# Netscape HTTP Cookie File\n' + [...cookies.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, cookie]) => cookie.row).join('\n') + '\n';
}

function youtubeSessionCookies(cookies, now = Date.now()) {
  const rows = (Array.isArray(cookies) ? cookies : []).filter((cookie) => youtubeDomain(String(cookie.domain || ''))).map((cookie) =>
    `${cookie.httpOnly ? '#HttpOnly_' : ''}${[cookie.domain, cookie.hostOnly === true ? 'FALSE' : 'TRUE', cookie.path || '/', cookie.secure ? 'TRUE' : 'FALSE', Math.floor(cookie.expirationDate || 0), cookie.name, cookie.value].join('\t')}`);
  return normalizeYoutubeCookies('# Netscape HTTP Cookie File\n' + rows.join('\n') + '\n', now);
}

module.exports = { MAX_COOKIE_BYTES, normalizeYoutubeCookies, youtubeSessionCookies };
