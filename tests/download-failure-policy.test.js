const test = require('node:test');
const assert = require('node:assert/strict');
const { downloadFailureReason, canonicalYoutubeSource, prepareFailedDownloadRetry, replacementSearch } = require('../src/lib/download-failure-policy');

const original = 'https://www.youtube.com/watch?v=yTLuE57Gvsc';
const replacement = 'https://www.youtube.com/watch?v=new00000000';
const done = 'https://www.youtube.com/watch?v=done0000000';
function fixture() {
  const source = { url: original, title: 'Original song', artist: 'Original artist', album: 'Original album', coverUrl: 'https://i.ytimg.com/vi/yTLuE57Gvsc/hqdefault.jpg', duration: 151, metadataProvider: 'spotify' };
  return { id: 'task', sources: [{ url: done, title: 'Done' }, source], failures: [{ ...source, error: 'Sign in to confirm your age' }], files: [{ name: 'Done-done0000000.mp3', metadata: { sourceUrl: done } }], total: 12, completed: 11, cloud: { accountId: 'original-account' } };
}

test('download failures distinguish age and account restrictions from retryable network and 403 errors', () => {
  for (const [error, code] of [['Sign in to confirm your age', 'age'], ["Sign in to confirm you're not a bot", 'verification'], ['Private video', 'restricted'], ['members-only content', 'restricted'], ['not available in your country', 'region'], ['Login required', 'login']]) {
    const reason = downloadFailureReason(error); assert.equal(reason.code, code); assert.equal(reason.canRetry, false);
  }
  for (const error of ['HTTP Error 403: Forbidden', 'Network timed out', 'HTTP Error 429: Too Many Requests', 'MP3 conversion incomplete']) assert.equal(downloadFailureReason(error).canRetry, true);
  assert.equal(replacementSearch({ title: 'Song\nName', artist: 'Artist' }), 'Artist Song Name');
});

test('age-gated URLs cannot be blindly retried; a replacement preserves all original metadata and completed files', () => {
  const job = fixture(), snapshot = JSON.stringify(job);
  assert.throws(() => prepareFailedDownloadRetry(job), /年龄验证/);
  const plan = prepareFailedDownloadRetry(job, { replacements: [{ fromUrl: original, url: replacement }] });
  assert.deepEqual(plan.pending, [{ ...job.sources[1], url: replacement, preserveMetadata: true }]);
  assert.deepEqual(plan.sources[0], job.sources[0]);
  assert.equal(plan.sources[1].artist, 'Original artist');
  assert.equal(plan.sources[1].coverUrl, job.sources[1].coverUrl);
  assert.equal(JSON.stringify(job), snapshot);
  assert.equal(job.completed, 11); assert.equal(job.total, 12); assert.equal(job.cloud.accountId, 'original-account');
});

test('replacement validation rejects completed, unknown, duplicated and injected changes without partial mutation', () => {
  const job = fixture(), snapshot = JSON.stringify(job);
  const mapping = { fromUrl: original, url: replacement };
  for (const input of [
    { cloud: { accountId: 'other' }, replacements: [mapping] },
    { replacements: null }, { replacements: {} }, { replacements: [null] },
    { replacements: [{ fromUrl: done, url: replacement }] },
    { replacements: [{ fromUrl: 'https://www.youtube.com/watch?v=unknown0000', url: replacement }] },
    { replacements: [{ fromUrl: original, url: original }] },
    { replacements: [{ fromUrl: original, url: done }] },
    { replacements: [mapping, mapping] },
    { replacements: [{ ...mapping, title: 'Forged song' }] },
    { replacements: [{ fromUrl: original, url: 'https://youtube.com.evil.test/watch?v=new00000000' }] },
    { replacements: [{ fromUrl: original, url: 'http://www.youtube.com/watch?v=new00000000' }] },
  ]) { assert.throws(() => prepareFailedDownloadRetry(job, input)); assert.equal(JSON.stringify(job), snapshot); }
  const malformed = fixture(); malformed.files.push({ name: 'Original-yTLuE57Gvsc.mp3' });
  assert.throws(() => prepareFailedDownloadRetry(malformed, { replacements: [mapping] }), /尚未完成/);
  const ambiguous = fixture(); ambiguous.sources.push({ ...ambiguous.sources[1], title: 'Another row' });
  assert.throws(() => prepareFailedDownloadRetry(ambiguous, { replacements: [mapping] }), /不唯一/);
});

test('official single-video URLs normalize to the same source identity and reject unsupported paths', () => {
  assert.equal(canonicalYoutubeSource('https://youtu.be/new00000000'), replacement);
  assert.equal(canonicalYoutubeSource('https://music.youtube.com/watch?v=new00000000&list=RDnew00000000'), replacement);
  for (const value of ['https://www.youtube.com/playlist?list=PLabcdefghij', 'https://www.youtube.com/redirect?v=new00000000', 'https://user:pass@www.youtube.com/watch?v=new00000000', 'https://www.youtube.com:444/watch?v=new00000000']) assert.throws(() => canonicalYoutubeSource(value));
});

test('only a changed download login unlocks an authentication failure, without replacing sources or downloaded files', () => {
  const job = fixture(); job.failures[0].error = "Sign in to confirm you're not a bot"; job.failures[0].youtubeAuthRevision = 'old-login';
  const originalState = JSON.stringify(job);
  for (const auth of [{}, { configured: false, revision: 'new-login' }, { configured: true, revision: 'old-login' }]) {
    assert.equal(downloadFailureReason(job.failures[0], auth).canRetry, false); assert.throws(() => prepareFailedDownloadRetry(job, {}, auth));
  }
  const auth = { configured: true, revision: 'new-login' };
  assert.equal(downloadFailureReason(job.failures[0], auth).canRetry, true);
  assert.deepEqual(prepareFailedDownloadRetry(job, {}, auth).pending, [job.sources[1]]);
  assert.equal(JSON.stringify(job), originalState);
  assert.throws(() => prepareFailedDownloadRetry(job, { youtubeAuthRevision: 'new-login' }, auth), /不能更改/);
  for (const error of ['Sign in to confirm your age', 'Private video. Sign in', 'Members only. Sign in', 'premium-only. Sign in', 'not available in your region. Sign in', 'Geo-restricted. Not a bot']) {
    job.failures[0].error = error; assert.equal(downloadFailureReason(job.failures[0], auth).canRetry, false); assert.throws(() => prepareFailedDownloadRetry(job, {}, auth));
  }
});
