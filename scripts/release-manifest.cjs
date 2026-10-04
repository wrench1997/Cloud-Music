const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function androidManifest(apkPath, gradleText) {
  const version = gradleText.match(/versionName\s+"(\d+\.\d+\.\d+)"/)?.[1];
  const versionCode = Number(gradleText.match(/versionCode\s+(\d+)/)?.[1]);
  const packageId = gradleText.match(/applicationId\s+"([\w.]+)"/)?.[1];
  if (!version || !Number.isSafeInteger(versionCode) || versionCode < 1 || packageId !== 'com.music.player') throw new Error('Invalid Android release version');
  const content = fs.readFileSync(apkPath);
  return { schemaVersion: 1, version, versionCode, packageId, fileName: `Yungan-Music-Android-${version}.apk`, size: content.length, sha256: crypto.createHash('sha256').update(content).digest('hex') };
}

function prepareRelease({ directory, apkPath, gradlePath, windowsDirectory, windowsVersion = require('../package.json').version }) {
  const manifest = androidManifest(apkPath, fs.readFileSync(gradlePath, 'utf8'));
  fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(apkPath, path.join(directory, manifest.fileName));
  fs.writeFileSync(path.join(directory, 'android-update.json'), JSON.stringify(manifest, null, 2) + '\n');
  const installer = `Yungan-Music-Setup-${windowsVersion}.exe`;
  const files = fs.readdirSync(windowsDirectory).filter((name) => name === installer || name === `${installer}.blockmap` || name === 'latest.yml');
  if (!files.some((name) => name.endsWith('.exe')) || !files.includes('latest.yml')) throw new Error('Windows installer/update metadata is missing');
  for (const name of files) fs.copyFileSync(path.join(windowsDirectory, name), path.join(directory, name));
  const checksums = fs.readdirSync(directory).filter((name) => name !== 'SHA256SUMS.txt' && fs.statSync(path.join(directory, name)).isFile()).sort().map((name) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex')}  ${name}`);
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
  return manifest;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const manifest = prepareRelease({ directory: path.resolve(process.argv[2] || path.join(root, '.local/release-assets')), apkPath: path.resolve(process.argv[3] || path.join(root, 'android/app/build/outputs/apk/release/app-release.apk')), gradlePath: path.join(root, 'android/app/build.gradle'), windowsDirectory: path.join(root, 'dist') });
  const sourcePackage = JSON.parse(execFileSync('git', ['show', 'HEAD:package.json'], { cwd: root, encoding: 'utf8' }));
  if (sourcePackage.version !== require('../package.json').version) throw new Error('Commit the matching application version before preparing release source.');
  execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'src', 'android', 'scripts', 'package.json', 'package-lock.json', 'ANDROID-LICENSE.md', 'THIRD_PARTY_NOTICES.md'], { cwd: root, stdio: 'pipe' });
  const directory = path.resolve(process.argv[2] || path.join(root, '.local/release-assets'));
  const sourceName = `Cloud-Music-Source-${sourcePackage.version}.zip`;
  execFileSync('git', ['archive', '--format=zip', `--prefix=Cloud-Music-${sourcePackage.version}/`, `--output=${path.join(directory, sourceName)}`, 'HEAD'], { cwd: root, stdio: 'pipe' });
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(directory, 'SOURCE.txt'), `Application source: ${sourceName}\nGit revision: ${revision}\nRepository: https://github.com/wrench1997/Cloud-Music/tree/${revision}\nAndroid license: ANDROID-LICENSE.md\nThird-party sources: THIRD_PARTY_NOTICES.md\n`);
  const sums = fs.readdirSync(directory).filter((name) => name !== 'SHA256SUMS.txt' && fs.statSync(path.join(directory, name)).isFile()).sort().map((name) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex')}  ${name}`);
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
  console.log(`Prepared Windows release and Android ${manifest.version} (${manifest.versionCode}) update assets.`);
}

module.exports = { androidManifest, prepareRelease };
