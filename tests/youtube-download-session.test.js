const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createYoutubeDownloadSession } = require('../electron/youtube-download-session');

const cookieText = (value = 'fixture-session-one') => `# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\t${value}\n.google.com\tTRUE\t/\tTRUE\t0\tSID\tother-site\n`;
function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-session-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const key = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString(text) { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]); },
    decryptString(bytes) { const cipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString(); },
  };
  const args = { directory, safeStorage, dialog: { showOpenDialog: async () => ({ canceled: true }) }, getWindow: () => null, shell: { openExternal: async () => {} }, ...options };
  const session = createYoutubeDownloadSession(args);
  return { directory, session, args };
}

test('download session encrypts only YouTube credentials, survives restart, and removes temporary cookie jars', (t) => {
  const { directory, session, args } = fixture(t);
  const first = session.configure(cookieText());
  assert.equal(first.configured, true); assert.match(first.revision, /^[a-f0-9-]{36}$/);
  assert.equal(session.configure(cookieText()).revision, first.revision);
  const encrypted = fs.readFileSync(path.join(directory, 'youtube-download-account.bin'));
  assert.equal(encrypted.includes(Buffer.from('fixture-session-one')), false);
  assert.doesNotMatch(JSON.stringify(session.status()), /fixture-session|other-site|cookies|\.bin/);
  const restarted = createYoutubeDownloadSession(args);
  assert.deepEqual(restarted.status(), first);
  const lease = restarted.lease();
  assert.equal(lease.args[0], '--cookies'); assert.equal(lease.revision, first.revision);
  assert.match(fs.readFileSync(lease.args[1], 'utf8'), /fixture-session-one/);
  assert.doesNotMatch(fs.readFileSync(lease.args[1], 'utf8'), /other-site/);
  lease.dispose(); assert.equal(fs.existsSync(lease.args[1]), false);
  const secondLease = restarted.lease(); restarted.dispose(); assert.equal(fs.existsSync(secondLease.args[1]), false);
  const changed = restarted.configure(cookieText('fixture-session-two')); assert.notEqual(changed.revision, first.revision);
  assert.equal(restarted.clear().configured, false); assert.equal(fs.existsSync(path.join(directory, 'youtube-download-account.bin')), false);
});

test('cancelled or invalid imports preserve the existing login and a picker cannot change it while downloading', async (t) => {
  let downloading = false, selection = { canceled: true };
  const { directory, session } = fixture(t, { requireIdle: () => { if (downloading) throw new Error('wait for download'); }, dialog: { showOpenDialog: async () => selection } });
  const first = session.configure(cookieText());
  assert.equal((await session.importCookies()).canceled, true); assert.deepEqual(session.status(), first);
  const file = path.join(directory, 'import.txt'); fs.writeFileSync(file, 'invalid fixture'); selection = { canceled: false, filePaths: [file] };
  await assert.rejects(session.importCookies(), /Netscape/); assert.deepEqual(session.status(), first);
  fs.writeFileSync(file, cookieText('fixture-session-two')); downloading = true;
  await assert.rejects(session.importCookies(), /wait for download/); assert.deepEqual(session.status(), first);
  assert.throws(() => session.clear(), /wait for download/); downloading = false;
  assert.notEqual((await session.importCookies()).revision, first.revision);
});

test('using preview login reads only the application session and reports missing or unavailable credentials', async (t) => {
  const urls = [];
  const { session } = fixture(t, { getWindow: () => ({ webContents: { session: { cookies: { get: async ({ url }) => {
    urls.push(url); return [{ domain: '.youtube.com', path: '/', name: 'SID', value: 'fixture-preview', secure: true, httpOnly: true }];
  } } } } }) });
  assert.equal((await session.usePreview()).source, 'preview');
  assert.deepEqual(urls, ['https://www.youtube.com/', 'https://music.youtube.com/']);
  const empty = fixture(t, { getWindow: () => ({ webContents: { session: { cookies: { get: async () => [] } } } }) }).session;
  await assert.rejects(empty.usePreview(), /外部浏览器/);
  const unavailable = fixture(t, { safeStorage: { isEncryptionAvailable: () => false } }).session;
  assert.throws(() => unavailable.configure(cookieText()), /加密/); assert.equal(unavailable.status().configured, false);
});

test('restart removes abandoned temporary session files without removing unrelated files', (t) => {
  const { directory, args } = fixture(t);
  const temporary = path.join(directory, 'youtube-download-sessions'); fs.mkdirSync(temporary);
  const stale = path.join(temporary, `${crypto.randomUUID()}.txt`), unrelated = path.join(temporary, 'keep.txt');
  fs.writeFileSync(stale, 'fixture-session'); fs.writeFileSync(unrelated, 'keep');
  assert.equal(createYoutubeDownloadSession(args).status().configured, false);
  assert.equal(fs.existsSync(stale), false); assert.equal(fs.existsSync(unrelated), true);
});
