const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDownloadJob, mergeDownloadJobs, downloadJobLabel, cloudPhase, cloudStatusLabel, nativeCloudConfig, needsNativeCloudUpload, downloadedSong } = require('../src/lib/download-job-state');

test('failed and cancelled downloads never report complete progress even if the extractor emitted 100%', () => {
  for (const state of ['partial', 'failed', 'cancelled']) {
    const job = normalizeDownloadJob({ id: state, state, progress: 100, completed: 1, total: 3, files: [{ name: 'finished.mp3' }], failures: [{ title: 'Unavailable' }] });
    assert.equal(job.progress, 33);
    assert.notEqual(downloadJobLabel(job), '下载完成');
  }
  assert.equal(normalizeDownloadJob({ id: 'cancel-after-last', state: 'cancelled', completed: 1, total: 1 }).progress, 99);
  assert.equal(normalizeDownloadJob({ id: 'empty', state: 'failed', progress: 100 }).progress, 0);
  assert.equal(normalizeDownloadJob({ id: 'complete', state: 'complete', completed: 2, total: 2 }).progress, 100);
});

test('task history retains simultaneous jobs and rejects an older persisted snapshot after a completion event', () => {
  const initial = mergeDownloadJobs([], [{ id: 'old', createdAt: 100, state: 'running', updatedAt: 10 }, { id: 'new', createdAt: 200, state: 'queued', updatedAt: 20 }]);
  const completed = mergeDownloadJobs(initial, [{ id: 'old', createdAt: 100, state: 'complete', completed: 1, total: 1, updatedAt: 30 }]);
  const stale = mergeDownloadJobs(completed, [{ id: 'old', createdAt: 100, state: 'running', updatedAt: 10 }]);
  assert.deepEqual(stale.map((job) => job.id), ['new', 'old']);
  assert.equal(stale.find((job) => job.id === 'old').state, 'complete');
  assert.deepEqual(stale.find((job) => job.id === 'new').files, []);
});

test('login resumes native uploads once, without restarting an active or completed upload for the same account', () => {
  const cloud = nativeCloudConfig(true, 'verified-account', 'music@example.test');
  const job = { id: 'one', state: 'complete', files: [{ name: 'Song.mp3' }] };
  assert.equal(needsNativeCloudUpload({ ...job, cloud: { state: 'waiting-login', enabled: true } }, cloud), true);
  for (const state of ['queued', 'uploading', 'complete']) {
    assert.equal(needsNativeCloudUpload({ ...job, cloud: { accountId: cloud.accountId, state } }, cloud), false);
  }
  const failed = { ...job, cloud: { accountId: cloud.accountId, state: 'failed' } };
  assert.equal(needsNativeCloudUpload(failed, cloud), false);
  assert.equal(needsNativeCloudUpload(failed, cloud, true), true);
  assert.equal(needsNativeCloudUpload(job, nativeCloudConfig(true, '', '')), false);
  assert.equal(needsNativeCloudUpload({ ...job, state: 'running' }, cloud), false);
  const oldAccount = { ...job, cloud: { accountId: 'previous-account', state: 'complete', enabled: true } };
  assert.equal(needsNativeCloudUpload(oldAccount, cloud), false);
  assert.equal(needsNativeCloudUpload(oldAccount, cloud, true), true);
  assert.equal(needsNativeCloudUpload(job, nativeCloudConfig(false, cloud.accountId, cloud.email)), false);
});

test('automatic login recovery preserves per-task local-only and cancelled choices', () => {
  const cloud = nativeCloudConfig(true, 'account', 'music@example.test');
  const task = { id: 'local-task', state: 'complete', files: [{ name: 'Song.mp3' }], cloud: { enabled: false, state: 'disabled', accountId: 'account' } };
  assert.equal(needsNativeCloudUpload(task, cloud), false);
  assert.equal(needsNativeCloudUpload(task, cloud, true), true);
  const cancelled = { ...task, state: 'cancelled', cloud: { enabled: true, state: 'waiting-login', accountId: 'account' } };
  assert.equal(needsNativeCloudUpload(cancelled, cloud), false);
  assert.equal(needsNativeCloudUpload(cancelled, cloud, true), true);
});

test('independent local download disables cloud work until both Google identity fields are verified', () => {
  assert.deepEqual(nativeCloudConfig(true, '', ''), { enabled: false, accountId: '', email: '' });
  assert.equal(nativeCloudConfig(true, 'account', '').enabled, false);
  assert.equal(nativeCloudConfig(true, '', 'music@example.test').enabled, false);
  assert.equal(nativeCloudConfig(true, 'account', 'music@example.test').enabled, true);
});

test('native cloud failures remain visible and are never described as a successful upload', () => {
  assert.equal(cloudPhase({ state: 'pending-login' }), 'login');
  assert.equal(cloudPhase({ state: 'partial' }), 'failed');
  assert.equal(cloudStatusLabel({ state: 'pending-login' }), '等待连接 Google 账号');
  assert.equal(cloudStatusLabel({ state: 'partial' }), '云端上传未完成');
  assert.equal(cloudStatusLabel({ state: 'complete' }), '已上传到云端');
});

test('immediate local playback preserves embedded song metadata and the source URL for a later radio seed', () => {
  const song = downloadedSong({ name: 'internal-source.mp3', displayName: 'Artist - Song.mp3', size: 3000, metadata: { title: 'Song', artist: 'Artist', album: 'Album', duration: 120, coverUrl: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk' } }, { id: 'download-id' }, 'file:///data/user/0/com.music.player/files/music/source.mp3');
  assert.equal(song.title, 'Song');
  assert.equal(song.artist, 'Artist');
  assert.equal(song.album, 'Album');
  assert.equal(song.duration, 120);
  assert.equal(song.local, true);
  assert.equal(song.localUri, 'file:///data/user/0/com.music.player/files/music/source.mp3');
  assert.equal(song.sourceUrl, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(song.downloadFileName, 'internal-source.mp3');
  assert.equal(song.fileName, 'internal-source.mp3');
  assert.equal(song.displayName, 'Artist - Song.mp3');
  assert.equal(song.jobId, 'download-id');
  assert.equal(song.coverUrl, 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
});
