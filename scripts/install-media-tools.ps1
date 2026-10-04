$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolsDir = Join-Path $projectRoot '.local\media-tools'
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
$downloader = Join-Path $toolsDir 'yt-dlp.exe'
Invoke-WebRequest 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile $downloader
Invoke-WebRequest 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS' -OutFile (Join-Path $toolsDir 'SHA2-256SUMS')
$expectedLine = Get-Content (Join-Path $toolsDir 'SHA2-256SUMS') | Where-Object { $_ -match '\s+yt-dlp\.exe$' } | Select-Object -First 1
if (!$expectedLine -or (Get-FileHash $downloader -Algorithm SHA256).Hash.ToLowerInvariant() -ne ($expectedLine -split '\s+')[0]) { throw 'yt-dlp checksum verification failed' }
$ffmpegZip = Join-Path $toolsDir 'ffmpeg.zip'
Invoke-WebRequest 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $ffmpegZip
Invoke-WebRequest 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256' -OutFile (Join-Path $toolsDir 'ffmpeg.sha256')
$expectedFfmpeg = ((Get-Content (Join-Path $toolsDir 'ffmpeg.sha256') -Raw).Trim() -split '\s+')[0]
if ((Get-FileHash $ffmpegZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedFfmpeg.ToLowerInvariant()) { throw 'FFmpeg checksum verification failed' }
Expand-Archive -LiteralPath $ffmpegZip -DestinationPath (Join-Path $toolsDir 'ffmpeg-extracted') -Force
$ffmpegBin = Get-ChildItem (Join-Path $toolsDir 'ffmpeg-extracted') -Recurse -Filter ffmpeg.exe | Select-Object -First 1
if (!$ffmpegBin) { throw 'FFmpeg executable missing' }
Copy-Item -LiteralPath $ffmpegBin.FullName -Destination (Join-Path $toolsDir 'ffmpeg.exe') -Force
Copy-Item -LiteralPath (Join-Path $ffmpegBin.DirectoryName 'ffprobe.exe') -Destination (Join-Path $toolsDir 'ffprobe.exe') -Force
# yt-dlp's YouTube challenge solver can use a bundled Node.js runtime.
$nodeSource = Join-Path $projectRoot '.local\nodejs\node.exe'
if (!(Test-Path $nodeSource)) { $nodeSource = (Get-Command node.exe -ErrorAction Stop).Source }
Copy-Item -LiteralPath $nodeSource -Destination (Join-Path $toolsDir 'node.exe') -Force
& $downloader --version
& (Join-Path $toolsDir 'ffmpeg.exe') -version | Select-Object -First 1
Write-Host "Media tools ready: $toolsDir"
