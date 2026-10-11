const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const shell = ['pwsh', 'powershell'].find((candidate) => spawnSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']).status === 0);

function install({ gh = '', github = '', mode = '' } = {}) {
  const temporary = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporary, 'yungan-media-install-test-'));
  const engine = Buffer.from('fixture media engine');
  const digest = crypto.createHash('sha256').update(engine).digest('hex');
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.mkdirSync(path.join(root, 'android'));
    fs.copyFileSync(path.join(__dirname, '../scripts/install-android-media-engine.ps1'), path.join(root, 'scripts/install.ps1'));
    fs.writeFileSync(path.join(root, 'android/native-media-lock.json'), JSON.stringify({ ytDlp: { version: '2099.01.01', sha256: digest } }));
    fs.writeFileSync(path.join(root, 'driver.ps1'), `
param([string]$InstallerPath)
$ErrorActionPreference = 'Stop'
$bytes = [Convert]::FromBase64String($env:FIXTURE_ENGINE)
$digest = $env:FIXTURE_DIGEST
function Invoke-RestMethod($Uri, $Headers) {
    if ($Uri -cne 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/tags/2099.01.01') { throw 'Unexpected API destination' }
    $expected = if ($env:GH_TOKEN) { "Bearer $env:GH_TOKEN" } elseif ($env:GITHUB_TOKEN) { "Bearer $env:GITHUB_TOKEN" } else { $null }
    if ($Headers.Authorization -cne $expected) { throw 'Incorrect API authorization' }
    return @{ draft=$false; prerelease=$false; tag_name='2099.01.01'; assets=@(
        @{ name='yt-dlp'; size=$bytes.Length; browser_download_url='https://github.com/yt-dlp/yt-dlp/releases/download/2099.01.01/yt-dlp' },
        @{ name='SHA2-256SUMS'; size=100; browser_download_url='https://github.com/yt-dlp/yt-dlp/releases/download/2099.01.01/SHA2-256SUMS' }
    ) }
}
function Invoke-WebRequest($Uri, $Headers, $OutFile) {
    if ($Headers.ContainsKey('Authorization')) { throw 'Authorization forwarded to an asset download' }
    if ($Uri.EndsWith('/SHA2-256SUMS')) {
        $checksum = if ($env:FIXTURE_MODE -eq 'bad-checksum') { '0' * 64 } else { $digest }
        return @{ Content="$checksum  yt-dlp\n" }
    }
    if ($env:FIXTURE_MODE -eq 'bad-bytes') { $bytes[0] = 0 }
    [IO.File]::WriteAllBytes($OutFile, $bytes)
}
& $InstallerPath
if ($LASTEXITCODE) { exit $LASTEXITCODE }
`);
    const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'driver.ps1'), '-InstallerPath', path.join(root, 'scripts/install.ps1')], {
      env: { ...process.env, GH_TOKEN: gh, GITHUB_TOKEN: github, FIXTURE_ENGINE: engine.toString('base64'), FIXTURE_DIGEST: digest, FIXTURE_MODE: mode },
      encoding: 'utf8', timeout: 20000,
    });
    return { ...result, engine: fs.existsSync(path.join(root, 'android/app/src/main/res/raw/ytdlp')) ? fs.readFileSync(path.join(root, 'android/app/src/main/res/raw/ytdlp')) : null };
  } finally {
    assert.equal(path.dirname(root), temporary);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const [name, options] of [
  ['CI token takes precedence over the fallback token', { gh: 'fixture-gh-token', github: 'fixture-fallback-token' }],
  ['GITHUB_TOKEN works when GH_TOKEN is absent', { github: 'fixture-fallback-token' }],
  ['local builds still work without an authorization token', {}],
]) {
  test(`Android engine install: ${name}; assets never receive authorization`, { skip: !shell }, () => {
    const result = install(options);
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.deepEqual(result.engine, Buffer.from('fixture media engine'));
  });
}

test('Android engine install rejects downloaded bytes that differ from the verified checksum', { skip: !shell }, () => {
  const result = install({ gh: 'fixture-gh-token', mode: 'bad-bytes' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /size or SHA-256 verification/);
  assert.equal(result.engine, null);
});

test('Android engine install rejects a checksum that differs from the committed build lock', { skip: !shell }, () => {
  const result = install({ gh: 'fixture-gh-token', mode: 'bad-checksum' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /differs from the committed build lock/);
  assert.equal(result.engine, null);
});
