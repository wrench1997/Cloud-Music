const ACTIVE_STATES = new Set(['queued', 'pending', 'running']);

function normalizeDownloadJob(value) {
  if (!value || typeof value !== 'object' || !value.id) return null;
  const files = Array.isArray(value.files) ? value.files : [];
  const failures = Array.isArray(value.failures) ? value.failures : [];
  const completed = Number.isFinite(Number(value.completed)) ? Math.max(0, Number(value.completed)) : files.length;
  const requestedTotal = Number(value.total);
  const total = Math.max(completed, Number.isFinite(requestedTotal) && requestedTotal > 0 ? requestedTotal : files.length + failures.length, 0);
  let progress = Math.max(0, Math.min(100, Number(value.progress) || 0));
  if (!ACTIVE_STATES.has(value.state)) {
    progress = total ? Math.floor(completed / total * 100) : 0;
    if (value.state !== 'complete' || failures.length || completed < total) progress = Math.min(progress, 99);
  } else progress = Math.min(progress, 99);
  return { ...value, files, failures, total, completed, progress };
}

function mergeDownloadJobs(previous, incoming) {
  const merged = new Map(previous.map((job) => [job.id, job]));
  for (const value of incoming) {
    const job = normalizeDownloadJob(value);
    if (!job) continue;
    const existing = merged.get(job.id);
    if (existing?.updatedAt && job.updatedAt && Number(existing.updatedAt) > Number(job.updatedAt)) continue;
    merged.set(job.id, job);
  }
  return [...merged.values()].sort((left, right) => {
    const a = Number(left.createdAt) || Date.parse(left.createdAt) || 0;
    const b = Number(right.createdAt) || Date.parse(right.createdAt) || 0;
    return b - a;
  });
}

function downloadJobLabel(job) {
  if (ACTIVE_STATES.has(job.state)) return job.phase === 'upload' ? '正在上传到云端' : job.phase === 'metadata' ? '正在写入歌曲信息' : job.phase === 'convert' ? '正在转换 MP3' : job.state === 'queued' ? '等待下载' : '正在下载';
  return { complete: '下载完成', cancelled: '下载已取消', failed: '下载失败', partial: '部分下载完成' }[job.state] || '等待处理';
}

function cloudPhase(value) {
  const state = value?.state || '';
  if (['complete', 'completed', 'done', 'uploaded'].includes(state)) return 'complete';
  if (['running', 'uploading'].includes(state)) return 'uploading';
  if (['waiting-login', 'pending-login', 'awaiting-login', 'needs-login', 'auth-required', 'login_required'].includes(state)) return 'login';
  if (['failed', 'error', 'partial'].includes(state)) return 'failed';
  if (['queued', 'pending', 'waiting'].includes(state)) return value?.error ? 'failed' : 'pending';
  return state;
}

function nativeCloudConfig(enabled, accountId, email) {
  return { enabled: Boolean(enabled && accountId && email), accountId: accountId || '', email: email || '' };
}

function needsNativeCloudUpload(job, cloud, force = false) {
  if (!job?.files?.length || !cloud.enabled || !cloud.accountId || ACTIVE_STATES.has(job.state)) return false;
  const saved = job.cloud || {};
  if (!force && (saved.enabled === false || job.state === 'cancelled' || job.cancelled || (saved.accountId && saved.accountId !== cloud.accountId))) return false;
  const sameAccount = saved.accountId === cloud.accountId;
  const phase = cloudPhase(saved);
  if (sameAccount && ['complete', 'uploading', 'pending'].includes(phase)) return false;
  if (sameAccount && phase === 'failed' && !force) return false;
  return true;
}

function cloudStatusLabel(value) {
  return { complete: '已上传到云端', uploading: '正在上传到云端', pending: '等待上传到云端', login: '等待连接 Google 账号', failed: '云端上传未完成' }[cloudPhase(value)] || (value?.enabled ? '下载完成后上传云端' : '已保存在手机');
}

function downloadedSong(file, job, uri) {
  const metadata = file.metadata || {};
  return {
    id: file.id || `native:${job.id}:${file.name}`,
    title: metadata.title || file.title || file.displayName || file.name,
    artist: metadata.artist || file.artist || '未知歌手',
    album: metadata.album || file.album || '',
    duration: Number(metadata.duration ?? file.duration) || 0,
    coverUri: file.coverUri || metadata.coverUri || '',
    coverUrl: file.coverUri || metadata.coverUri || metadata.coverUrl || file.coverUrl || '',
    sourceUrl: metadata.sourceUrl || file.sourceUrl || file.url || '',
    fileName: file.name || file.fileName,
    displayName: file.displayName || file.name,
    jobId: file.jobId || job.id,
    mimeType: 'audio/mpeg',
    localUri: uri || file.localUri || file.uri || '',
    local: true,
    downloadJobId: job.id,
    downloadFileName: file.name,
  };
}

module.exports = { ACTIVE_STATES, normalizeDownloadJob, mergeDownloadJobs, downloadJobLabel, cloudPhase, cloudStatusLabel, nativeCloudConfig, needsNativeCloudUpload, downloadedSong };
