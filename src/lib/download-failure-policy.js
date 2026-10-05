function downloadFailureReason(value) {
  const message = String(typeof value === 'string' ? value : value?.error || '');
  if (/confirm your age|age[- ]restricted|age verification|年龄|年齡/i.test(message)) return { code: 'age', label: '音源需要年龄验证', detail: '此 YouTube 版本需要验证年龄。可以选择其他音源；已下载歌曲会保留。', canRetry: false };
  if (/not a bot|captcha|机器人|機器人|人机验证/i.test(message)) return { code: 'verification', label: '音源要求验证访问', detail: 'YouTube 要求验证当前访问。连接 Google Drive 不会完成这项验证，可以选择其他音源。', canRetry: false };
  if (/private video|video is private|members[- ]only|members only|only available to.*members|channel members|join this channel|premium[- ]only|subscriber[- ]only|私密|会员|會員/i.test(message)) return { code: 'restricted', label: '音源限制访问', detail: '此版本只向获准账号开放，请选择其他公开版本。', canRetry: false };
  if (/not available in your (country|region)|not made.*available in your (country|region)|blocked in your (country|region)|geo[- ]?restrict|geographic restriction|地区|地區/i.test(message)) return { code: 'region', label: '音源有地区限制', detail: '当前地区无法访问此版本，可以选择其他音源。', canRetry: false };
  if (/sign in|login required|log in|requires authentication|authentication required|需要登录|需要登錄/i.test(message)) return { code: 'login', label: '音源需要 YouTube 登录', detail: '下载器没有此音源需要的 YouTube 会话。Google Drive 授权只用于云盘，请选择其他公开版本。', canRetry: false };
  if (/403|forbidden/i.test(message)) return { code: 'forbidden', label: '音源暂时拒绝下载', detail: '服务拒绝了这次下载。可以重试，或选择其他音源。', canRetry: true };
  if (/429|too many requests|rate limit|try again later/i.test(message)) return { code: 'rate', label: '音源服务暂时限流', detail: '请稍后重试，避免连续重复请求。', canRetry: true };
  if (/timeout|timed out|network|connection|resolve|超时|网络/i.test(message)) return { code: 'network', label: '网络连接未完成', detail: '可以检查网络后继续下载，已有 MP3 会保留。', canRetry: true };
  if (/unavailable|removed|deleted|not available|video does not exist|已删除|已移除/i.test(message)) return { code: 'unavailable', label: '音源已不可用', detail: '此版本无法访问，请选择其他音源。', canRetry: false };
  return { code: 'failed', label: '下载未完成', detail: '可以重试或更换音源，已有 MP3 会保留。', canRetry: true };
}

function canonicalYoutubeSource(value) {
  if (typeof value !== 'string' || value.length > 2000) throw new Error('请选择有效的 YouTube 单曲链接。');
  let url;
  try { url = new URL(value); } catch { throw new Error('请选择有效的 YouTube 单曲链接。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !['youtube.com', 'www.youtube.com', 'music.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) throw new Error('替代音源必须是官方 YouTube HTTPS 单曲链接。');
  const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v');
  if (!/^[A-Za-z0-9_-]{11}$/.test(id || '') || (url.hostname !== 'youtu.be' && url.pathname !== '/watch')) throw new Error('请选择有效的 YouTube 单曲链接。');
  return `https://www.youtube.com/watch?v=${id}`;
}

function completedSourceUrls(files = []) {
  const complete = new Set();
  for (const file of files) {
    const value = file.metadata?.sourceUrl || file.sourceUrl;
    if (value) { try { complete.add(canonicalYoutubeSource(value)); } catch { /* Older metadata may not have an audio URL. */ } }
    const id = String(file.name || file.fileName || '').match(/-([A-Za-z0-9_-]{11})\.mp3$/)?.[1];
    if (id) complete.add(`https://www.youtube.com/watch?v=${id}`);
  }
  return complete;
}

// The plan is immutable: invalid requests must never partially update persisted jobs.
function prepareFailedDownloadRetry(job, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => key !== 'replacements')) throw new Error('重试只能更换失败音源，不能更改任务或上传账号。');
  const replacements = input.replacements === undefined ? [] : input.replacements;
  if (!Array.isArray(replacements) || replacements.length > 100) throw new Error('替代音源列表无效。');
  const failures = Array.isArray(job.failures) ? job.failures : [];
  if (!failures.length) throw new Error('没有需要重试的曲目。');
  const completed = completedSourceUrls(job.files);
  const sources = (Array.isArray(job.sources) && job.sources.length ? job.sources : failures).map((source) => ({ ...source, url: canonicalYoutubeSource(source.url) }));
  const sourcesByUrl = new Map(sources.map((source) => [source.url, source]));
  const failedByUrl = new Map(failures.map((failure) => [canonicalYoutubeSource(failure.url), failure]));
  if (failedByUrl.size !== failures.length) throw new Error('失败音源与当前任务不一致，请重新读取任务。');
  const selected = new Map();
  const targetUrls = new Set();
  for (const replacement of replacements) {
    if (!replacement || typeof replacement !== 'object' || Array.isArray(replacement) || Object.keys(replacement).some((key) => !['fromUrl', 'url'].includes(key))) throw new Error('替代音源只能包含原失败链接和所选链接。');
    const fromUrl = canonicalYoutubeSource(replacement.fromUrl), url = canonicalYoutubeSource(replacement.url);
    if (!failedByUrl.has(fromUrl) || !sourcesByUrl.has(fromUrl) || completed.has(fromUrl)) throw new Error('只能更换此任务中尚未完成的失败音源。');
    if (sources.filter((source) => source.url === fromUrl).length !== 1) throw new Error('失败音源在任务中不唯一，请重新读取歌单。');
    if (selected.has(fromUrl) || targetUrls.has(url)) throw new Error('同一失败曲目或替代音源不能重复提交。');
    if (sourcesByUrl.has(url) || completed.has(url)) throw new Error('请选择未用于此任务的其他音源。');
    selected.set(fromUrl, url); targetUrls.add(url);
  }
  for (const [url, failure] of failedByUrl) {
    if (!sourcesByUrl.has(url) || completed.has(url)) throw new Error('失败音源与当前任务不一致，请重新读取任务。');
    const reason = downloadFailureReason(failure);
    if (!reason.canRetry && !selected.has(url)) throw new Error(`${failure.title || '歌曲'}：${reason.label}，请选择其他音源后继续。已下载歌曲会保留。`);
  }
  return {
    sources: sources.map((source) => selected.has(source.url) ? { ...source, url: selected.get(source.url), preserveMetadata: true } : source),
    pending: failures.map((failure) => {
      const url = canonicalYoutubeSource(failure.url), source = sourcesByUrl.get(url);
      return selected.has(url) ? { ...source, url: selected.get(url), preserveMetadata: true } : { ...source };
    }),
  };
}

function replacementSearch(failure) {
  return [failure.artist, failure.title].filter(Boolean).join(' ').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300);
}

module.exports = { downloadFailureReason, canonicalYoutubeSource, completedSourceUrls, prepareFailedDownloadRetry, replacementSearch };
