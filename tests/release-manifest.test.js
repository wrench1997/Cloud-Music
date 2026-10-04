const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { androidManifest, prepareRelease } = require('../scripts/release-manifest.cjs');

test('release metadata binds the exact APK bytes to its Android version and includes Windows update files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-release-'));
  try {
    const apk = path.join(root, 'app.apk'); const gradle = path.join(root, 'build.gradle'); const output = path.join(root, 'assets'); const windows = path.join(root, 'windows');
    fs.mkdirSync(windows); fs.writeFileSync(apk, 'test apk bytes'); fs.writeFileSync(gradle, 'applicationId "com.music.player"\nversionCode 5\nversionName "3.2.0"');
    assert.throws(() => prepareRelease({ directory: output, apkPath: apk, gradlePath: gradle, windowsDirectory: windows }), /metadata is missing/);
    fs.writeFileSync(path.join(windows, 'Yungan-Music-Setup-1.2.0.exe'), 'installer'); fs.writeFileSync(path.join(windows, 'latest.yml'), 'version: 1.2.0');
    fs.writeFileSync(path.join(windows, 'Yungan-Music-Setup-1.1.0.exe'), 'stale installer');
    const result = prepareRelease({ directory: output, apkPath: apk, gradlePath: gradle, windowsDirectory: windows });
    assert.equal(result.sha256, crypto.createHash('sha256').update('test apk bytes').digest('hex'));
    assert.equal(result.fileName, 'Yungan-Music-Android-3.2.0.apk');
    assert.equal(result.versionCode, 5);
    assert.equal(fs.existsSync(path.join(output, 'Yungan-Music-Setup-1.1.0.exe')), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'android-update.json'))).sha256, result.sha256);
    assert.match(fs.readFileSync(path.join(output, 'SHA256SUMS.txt'), 'utf8'), /Yungan-Music-Setup-1.2.0.exe/);
    assert.throws(() => androidManifest(apk, 'applicationId "other.app"'), /Invalid Android/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
