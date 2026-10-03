$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$releaseDir = Join-Path $root "release"
$pcDir = Join-Path $releaseDir "pc"
$androidDir = Join-Path $releaseDir "android"
$portableZip = Join-Path $pcDir "Yungan-Music-PC-Portable.zip"
$portableDir = Join-Path $pcDir "Yungan-Music-PC-Portable"

. "$root\use-node22.ps1"

. "$root\use-android.ps1"

function Remove-GeneratedPath($path) {
  $resolved = Resolve-Path -LiteralPath $path -ErrorAction SilentlyContinue
  if ($resolved -and $resolved.Path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolved.Path -Recurse -Force
  }
}

function Clean-NextBuild {
  Remove-GeneratedPath (Join-Path $root ".next")
  Remove-GeneratedPath (Join-Path $root "out")
}

Remove-GeneratedPath $releaseDir

Clean-NextBuild
npm run electron:build
if ($LASTEXITCODE -ne 0) {
  throw "PC build failed"
}

Clean-NextBuild
npm run android:build
if ($LASTEXITCODE -ne 0) {
  throw "Android build failed"
}

New-Item -ItemType Directory -Force -Path $pcDir, $androidDir | Out-Null

$packageVersion = (Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
$pcSetup = Join-Path $root "dist\Yungan-Music-Setup-$packageVersion.exe"
$pcUnpacked = Join-Path $root "dist\win-unpacked"
$androidApk = Join-Path $root "android\app\build\outputs\apk\debug\app-debug.apk"

if (!(Test-Path -LiteralPath $pcSetup)) {
  throw "PC setup package was not found: $pcSetup"
}

if (!(Test-Path -LiteralPath $pcUnpacked)) {
  throw "PC portable folder was not found: $pcUnpacked"
}

if (!(Test-Path -LiteralPath $androidApk)) {
  throw "Android APK was not found: $androidApk"
}

Copy-Item -LiteralPath $pcSetup -Destination (Join-Path $pcDir "Yungan-Music-PC-Setup.exe") -Force
Copy-Item -LiteralPath $pcUnpacked -Destination $portableDir -Recurse
$shortcutShell = New-Object -ComObject WScript.Shell
$portableShortcut = $shortcutShell.CreateShortcut((Join-Path $portableDir "云感音乐.lnk"))
$portableShortcut.TargetPath = Join-Path $portableDir "Yungan Music.exe"
$portableShortcut.WorkingDirectory = $portableDir
$portableShortcut.IconLocation = $portableShortcut.TargetPath + ",0"
$portableShortcut.Save()
Compress-Archive -Path (Join-Path $pcUnpacked "*") -DestinationPath $portableZip -Force
if (!(Test-Path -LiteralPath $portableZip)) {
  throw "PC portable zip was not created: $portableZip"
}
Copy-Item -LiteralPath $androidApk -Destination (Join-Path $androidDir "Yungan-Music-Android-debug.apk") -Force
$androidVersionMatch = [regex]::Match((Get-Content -LiteralPath (Join-Path $root "android\app\build.gradle") -Raw), 'versionName\s+"([0-9]+\.[0-9]+\.[0-9]+)"')
if (!$androidVersionMatch.Success) { throw "Android versionName could not be read" }
$versionedAndroidName = "Yungan-Music-Android-" + $androidVersionMatch.Groups[1].Value + ".apk"
Copy-Item -LiteralPath $androidApk -Destination (Join-Path $androidDir $versionedAndroidName) -Force
Copy-Item -LiteralPath (Join-Path $root "Google Drive 配置说明.md") -Destination (Join-Path $releaseDir "Google Drive 配置说明.md") -Force

@"
Yungan Music release files

PC installer:
  pc\Yungan-Music-PC-Setup.exe

PC portable zip:
  pc\Yungan-Music-PC-Portable.zip
  Run Yungan Music.exe after extracting.

Android debug APK:
  android\Yungan-Music-Android-debug.apk
  android\$versionedAndroidName

Google Drive setup:
  Google Drive 配置说明.md
  Desktop OAuth JSON is imported once on a new PC. Later, click Google sign-in directly.
  Android does not need a JSON import. Its package name and signing certificate identify the registered app.
  Configure both drive.readonly and drive.file. Verify Google sign-in, open a Drive folder, and select music to play.
"@ | Set-Content -LiteralPath (Join-Path $releaseDir "README.txt") -Encoding UTF8

Get-ChildItem -LiteralPath $releaseDir -Recurse -File |
  Select-Object FullName, @{ Name = "SizeMB"; Expression = { [math]::Round($_.Length / 1MB, 2) } }
