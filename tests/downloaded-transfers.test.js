const test = require('node:test');
const assert = require('node:assert/strict');
const { transferDownloadedFiles } = require('../src/lib/downloaded-transfers');

const task = { id: 'download-job', files: [{ name: 'First.mp3' }, { name: 'Second.mp3' }] };
const makeStorage = () => {
  const items = new Map();
  return { getItem: (key) => items.get(key), setItem: (key, value) => items.set(key, value), items };
};
const options = (overrides = {}) => ({
  getAccount: () => 'account-a', getUpload: () => async () => {}, shouldUpload: () => true,
  isActive: () => true, fetchFile: async (file) => new File(['fixture'], file.name, { type: 'audio/mpeg' }),
  handled: new Set(), storage: makeStorage(), ...overrides,
});

test('downloaded track metadata reaches the upload callback while legacy files remain supported', async () => {
  const metadata = {
    title: 'Changes', artist: 'Tommy Richman', album: 'Example album', duration: 198,
    coverUrl: 'https://i.scdn.co/image/example', sourceUrl: 'https://www.youtube.com/watch?v=o_5P6ZQ853I',
  };
  const uploaded = [];
  const files = [
    { name: 'Changes.mp3', metadata }, { name: 'Legacy.mp3' },
  ];
  const result = await transferDownloadedFiles({ id: 'with-metadata', files }, options({ getUpload: () => async (file, track, record) => uploaded.push({ name: file.name, track, record }) }));
  assert.equal(result.uploaded, 2);
  assert.deepEqual(uploaded, [{ name: 'Changes.mp3', track: metadata, record: files[0] }, { name: 'Legacy.mp3', track: undefined, record: files[1] }]);
});

test('metadata repair updates completed uploads once using a separate account-specific marker', async () => {
  const storage = makeStorage();
  const uploads = [];
  const repairs = [];
  const oneFile = { id: 'metadata-repair', files: [{ name: 'Changes.mp3', originalName: 'Original.mp3', metadata: { title: 'Changes', artist: 'Tommy Richman' } }] };
  await transferDownloadedFiles(oneFile, options({ storage, getUpload: () => async (file) => uploads.push(file.name) }));
  const repairOptions = options({ storage, metadataOnly: true, getUpload: () => async (file, metadata, record) => repairs.push({ name: file.name, metadata, originalName: record.originalName }) });
  await transferDownloadedFiles(oneFile, repairOptions);
  await transferDownloadedFiles(oneFile, { ...repairOptions, fetchFile: async () => { throw new Error('Completed repairs must not run again'); } });
  assert.deepEqual(uploads, ['Changes.mp3']);
  assert.deepEqual(repairs, [{ name: 'Changes.mp3', metadata: oneFile.files[0].metadata, originalName: 'Original.mp3' }]);
  assert.equal(storage.getItem('yungan-downloaded-upload:account-a:metadata-repair:Changes.mp3'), 'complete');
  assert.equal(storage.getItem('yungan-downloaded-metadata:account-a:metadata-repair:Changes.mp3:v1'), 'complete');
  await transferDownloadedFiles(oneFile, { ...repairOptions, getAccount: () => 'account-b' });
  assert.equal(repairs.length, 2);
});

test('metadata repair failure remains retryable without disturbing the original upload marker', async () => {
  const storage = makeStorage();
  const oneFile = { id: 'repair-failure', files: [{ ...task.files[0], metadata: { title: 'First' } }] };
  await transferDownloadedFiles(oneFile, options({ storage }));
  await assert.rejects(transferDownloadedFiles(oneFile, options({ storage, metadataOnly: true,
    getUpload: () => async () => { throw new Error('Original cloud file not found'); },
  })), /Original cloud file not found/);
  assert.equal(storage.getItem('yungan-downloaded-upload:account-a:repair-failure:First.mp3'), 'complete');
  assert.equal(storage.getItem('yungan-downloaded-metadata:account-a:repair-failure:First.mp3:v1'), undefined);
  const repaired = await transferDownloadedFiles(oneFile, options({ storage, metadataOnly: true }));
  assert.equal(repaired.uploaded, 1);
});

test('metadata repair counts skipped files without reading them or claiming cloud success', async () => {
  const metadata = { title: 'Matched song', artist: 'Verified artist' };
  const files = Array.from({ length: 20 }, (_, index) => ({ name: `Matched-${index}.mp3`, metadata }));
  files.push({ name: 'Unmatched.mp3', metadata, metadataRepairSkipped: true }, { name: 'No-info.mp3' }, { name: 'Failed-repair.mp3', metadataRepairSkipped: true });
  const fetched = [];
  const uploaded = [];
  const storage = makeStorage();
  const result = await transferDownloadedFiles({ id: 'mixed-repair', files }, options({ metadataOnly: true, storage,
    fetchFile: async (file) => { fetched.push(file.name); return new File(['fixture'], file.name); },
    getUpload: () => async (file) => uploaded.push(file.name),
  }));
  assert.equal(result.total, 23);
  assert.equal(result.uploaded, 20);
  assert.equal(result.skipped, 3);
  assert.deepEqual(fetched, files.slice(0, 20).map((file) => file.name));
  assert.deepEqual(uploaded, fetched);
  for (const file of files.slice(20)) assert.equal(storage.getItem(`yungan-downloaded-metadata:account-a:mixed-repair:${file.name}:v1`), undefined);
});

test('each repair revision updates the same cloud file once while resuming that revision stays deduplicated', async () => {
  const storage = makeStorage();
  const handled = new Set();
  const changes = [];
  const record = { name: 'Changes.mp3', originalName: 'Original.mp3', metadata: { title: 'Changes', artist: 'Tommy Richman' } };
  const state = options({ metadataOnly: true, storage, handled, getUpload: () => async (audio, metadata, file) => {
    assert.equal(file.originalName, 'Original.mp3');
    changes.push({ id: 'existing-cloud-file', name: audio.name, metadata });
  } });
  const first = { id: 'revision-repair', metadataRepair: { revision: 'first-repair' }, files: [record] };
  await transferDownloadedFiles(first, state);
  await transferDownloadedFiles(first, state);
  const revisedRecord = { ...record, metadata: { ...record.metadata, coverUrl: 'https://i.scdn.co/image/new-cover' } };
  const second = { ...first, metadataRepair: { revision: 'second-repair' }, files: [revisedRecord] };
  await transferDownloadedFiles(second, state);
  await transferDownloadedFiles(second, { ...state, handled: new Set(), fetchFile: async () => { throw new Error('The completed revision must not be fetched again'); } });
  assert.deepEqual(changes, [
    { id: 'existing-cloud-file', name: 'Changes.mp3', metadata: record.metadata },
    { id: 'existing-cloud-file', name: 'Changes.mp3', metadata: revisedRecord.metadata },
  ]);
  assert.equal(storage.getItem('yungan-downloaded-metadata:account-a:revision-repair:Changes.mp3:first-repair'), 'complete');
  assert.equal(storage.getItem('yungan-downloaded-metadata:account-a:revision-repair:Changes.mp3:second-repair'), 'complete');
});

test('completed cloud uploads survive reopening and are isolated by verified account', async () => {
  const uploaded = [];
  const storage = makeStorage();
  const first = await transferDownloadedFiles(task, options({ storage, getUpload: () => async (file) => uploaded.push(file.name) }));
  assert.equal(first.uploaded, 2);
  const reopened = await transferDownloadedFiles(task, options({ storage, fetchFile: async () => { throw new Error('Already completed files must not be read again'); } }));
  assert.equal(reopened.uploaded, 2);
  await transferDownloadedFiles(task, options({ storage, getAccount: () => 'account-b', getUpload: () => async (file) => uploaded.push(`b:${file.name}`) }));
  assert.deepEqual(uploaded, ['First.mp3', 'Second.mp3', 'b:First.mp3', 'b:Second.mp3']);
});

test('failed upload leaves the failed file retryable without duplicating successful files', async () => {
  const storage = makeStorage();
  const attempts = [];
  const state = options({ storage, getUpload: () => async (file) => {
    attempts.push(file.name);
    if (file.name === 'Second.mp3') throw new Error('Drive quota exhausted');
  } });
  await assert.rejects(transferDownloadedFiles(task, state), /quota exhausted/);
  assert.equal(storage.getItem('yungan-downloaded-upload:account-a:download-job:First.mp3'), 'complete');
  assert.equal(storage.getItem('yungan-downloaded-upload:account-a:download-job:Second.mp3'), undefined);
  const retried = await transferDownloadedFiles(task, { ...state, getUpload: () => async (file) => attempts.push(`retry:${file.name}`) });
  assert.equal(retried.uploaded, 2);
  assert.deepEqual(attempts, ['First.mp3', 'Second.mp3', 'retry:Second.mp3']);
});

test('account switch while fetching MP3 does not upload or claim cloud completion', async () => {
  let account = 'account-a';
  let uploads = 0;
  const storage = makeStorage();
  const result = await transferDownloadedFiles(task, options({ storage, getAccount: () => account,
    fetchFile: async (file) => { account = 'account-b'; return new File(['fixture'], file.name); },
    getUpload: () => async () => { uploads += 1; },
  }));
  assert.equal(result.interrupted, true);
  assert.equal(result.uploaded, 0);
  assert.equal(uploads, 0);
  assert.equal(storage.items.size, 0);
});

test('account switch during upload records its original destination and stops before next file', async () => {
  let account = 'account-a';
  const uploaded = [];
  const storage = makeStorage();
  const state = options({ storage, getAccount: () => account, getUpload: () => async (file) => {
    uploaded.push(`a:${file.name}`);
    account = 'account-b';
  } });
  const interrupted = await transferDownloadedFiles(task, state);
  assert.equal(interrupted.interrupted, true);
  assert.equal(interrupted.uploaded, 1);
  assert.equal(storage.getItem('yungan-downloaded-upload:account-a:download-job:First.mp3'), 'complete');
  assert.equal(storage.getItem('yungan-downloaded-upload:account-b:download-job:First.mp3'), undefined);
  const resumed = await transferDownloadedFiles(task, { ...state, getUpload: () => async (file) => uploaded.push(`b:${file.name}`) });
  assert.equal(resumed.interrupted, false);
  assert.equal(resumed.uploaded, 2);
  assert.deepEqual(uploaded, ['a:First.mp3', 'b:First.mp3', 'b:Second.mp3']);
});

test('native local saves work without Google login and do not imply cloud upload', async () => {
  const saved = [];
  const state = options({ getAccount: () => '', getUpload: () => null, saveLocal: async (file) => saved.push(file.name) });
  const result = await transferDownloadedFiles(task, state);
  assert.equal(result.savedLocal, 2);
  assert.equal(result.cloudRequested, false);
  assert.equal(result.uploaded, 0);
  await transferDownloadedFiles(task, state);
  assert.deepEqual(saved, ['First.mp3', 'Second.mp3']);
});

test('closing the playlist during file read cancels automatic upload without success markers', async () => {
  let active = true;
  const storage = makeStorage();
  const result = await transferDownloadedFiles(task, options({ storage, isActive: () => active,
    fetchFile: async (file) => { active = false; return new File(['fixture'], file.name); },
    getUpload: () => async () => { throw new Error('Must not upload after closing the page'); },
  }));
  assert.equal(result.interrupted, true);
  assert.equal(result.uploaded, 0);
  assert.equal(storage.items.size, 0);
});

test('reopening a playlist during its active Drive upload shares one request and records completion in both views', async () => {
  let firstActive = true;
  let uploadCalls = 0;
  let resolveUpload;
  let announceStart;
  const started = new Promise((resolve) => { announceStart = resolve; });
  const upload = new Promise((resolve) => { resolveUpload = resolve; });
  const storage = makeStorage();
  const oneFile = { id: 'remount-active', files: [task.files[0]] };
  const firstHandled = new Set();
  const reopenedHandled = new Set();
  const first = transferDownloadedFiles(oneFile, options({ storage, handled: firstHandled, isActive: () => firstActive,
    getUpload: () => async () => { uploadCalls += 1; announceStart(); await upload; },
  }));
  await started;
  firstActive = false;
  const reopened = transferDownloadedFiles(oneFile, options({ storage, handled: reopenedHandled,
    fetchFile: async () => { throw new Error('A pending upload must not read or upload the file again'); },
    getUpload: () => async () => { uploadCalls += 1; },
  }));
  resolveUpload();
  const [firstResult, reopenedResult] = await Promise.all([first, reopened]);
  assert.equal(uploadCalls, 1);
  assert.equal(firstResult.interrupted, true);
  assert.equal(reopenedResult.interrupted, false);
  assert.equal(reopenedResult.uploaded, 1);
  assert.equal(firstHandled.has('cloud:account-a:remount-active:First.mp3'), true);
  assert.equal(reopenedHandled.has('cloud:account-a:remount-active:First.mp3'), true);
  assert.equal(storage.getItem('yungan-downloaded-upload:account-a:remount-active:First.mp3'), 'complete');
});

test('a shared upload failure settles both remounted views and leaves a new attempt retryable', async () => {
  let uploadCalls = 0;
  let rejectUpload;
  let announceStart;
  const started = new Promise((resolve) => { announceStart = resolve; });
  const upload = new Promise((resolve, reject) => { rejectUpload = reject; });
  const storage = makeStorage();
  const oneFile = { id: 'remount-failure', files: [task.files[0]] };
  const state = options({ storage, getUpload: () => async () => { uploadCalls += 1; announceStart(); await upload; } });
  const first = transferDownloadedFiles(oneFile, state);
  await started;
  const reopened = transferDownloadedFiles(oneFile, options({ storage, getUpload: () => async () => { uploadCalls += 1; } }));
  rejectUpload(new Error('Drive unavailable'));
  const outcomes = await Promise.allSettled([first, reopened]);
  assert.ok(outcomes.every((outcome) => outcome.status === 'rejected' && /Drive unavailable/.test(outcome.reason.message)));
  assert.equal(uploadCalls, 1);
  assert.equal(storage.items.size, 0);
  const retried = await transferDownloadedFiles(oneFile, options({ storage, getUpload: () => async () => { uploadCalls += 1; } }));
  assert.equal(uploadCalls, 2);
  assert.equal(retried.uploaded, 1);
});
