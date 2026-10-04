param([string]$Version = '')
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$engineLock = Get-Content -LiteralPath (Join-Path $taskRoot 'android\native-media-lock.json') -Raw | ConvertFrom-Json
if (!$Version) { $Version = $engineLock.ytDlp.version }
$resourceDirectory = Join-Path $taskRoot 'android\app\src\main\res\raw'
$engineTarget = Join-Path $resourceDirectory 'ytdlp'
$taskLocal = Join-Path $taskRoot '.local'
$headers = @{ 'User-Agent' = 'Yungan-Music-Android-Build'; 'Accept' = 'application/vnd.github+json' }
$releaseUri = if ($Version) { "https://api.github.com/repos/yt-dlp/yt-dlp/releases/tags/$Version" } else { 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest' }
$engineRelease = Invoke-RestMethod -Uri $releaseUri -Headers $headers
if ($engineRelease.draft -or $engineRelease.prerelease -or $engineRelease.tag_name -notmatch '^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$') { throw 'Expected an official stable yt-dlp release.' }
$engineAsset = @($engineRelease.assets | Where-Object name -EQ 'yt-dlp')
$checksumAsset = @($engineRelease.assets | Where-Object name -EQ 'SHA2-256SUMS')
if ($engineAsset.Count -ne 1 -or $checksumAsset.Count -ne 1 -or $engineAsset[0].size -gt 64MB -or $checksumAsset[0].size -gt 1MB) { throw 'The official release is missing a bounded engine or checksum file.' }
foreach ($engineItem in @($engineAsset[0], $checksumAsset[0])) {
    $engineUrl = [Uri]$engineItem.browser_download_url
    if ($engineUrl.Scheme -ne 'https' -or $engineUrl.Host -ne 'github.com' -or -not $engineUrl.AbsolutePath.StartsWith("/yt-dlp/yt-dlp/releases/download/$($engineRelease.tag_name)/")) { throw 'The release points outside the official yt-dlp repository.' }
}
$checksums = (Invoke-WebRequest -Uri $checksumAsset[0].browser_download_url -Headers $headers).Content
if ($checksums -is [byte[]]) { $checksums = [Text.Encoding]::UTF8.GetString($checksums) }
$engineLine = @($checksums -split "`r?`n" | Where-Object { $_ -match '^([a-fA-F0-9]{64})\s+\*?yt-dlp$' })
if ($engineLine.Count -ne 1) { throw 'The release checksum file does not contain exactly one Unix yt-dlp checksum.' }
$expected = ([regex]::Match($engineLine[0], '^([a-fA-F0-9]{64})')).Groups[1].Value.ToLowerInvariant()
if ($Version -eq $engineLock.ytDlp.version -and $expected -cne $engineLock.ytDlp.sha256) { throw 'The official Android media engine checksum differs from the committed build lock.' }
New-Item -ItemType Directory -Path $resourceDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $taskLocal -Force | Out-Null
if (-not (Test-Path -LiteralPath $engineTarget) -or (Get-FileHash -LiteralPath $engineTarget -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    $engineTemporary = Join-Path $resourceDirectory ('ytdlp-build-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    try {
        Invoke-WebRequest -Uri $engineAsset[0].browser_download_url -Headers $headers -OutFile $engineTemporary
        if ((Get-Item -LiteralPath $engineTemporary).Length -ne $engineAsset[0].size -or (Get-FileHash -LiteralPath $engineTemporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'The Android media engine failed its size or SHA-256 verification.' }
        Move-Item -LiteralPath $engineTemporary -Destination $engineTarget -Force
    } finally { if (Test-Path -LiteralPath $engineTemporary) { Remove-Item -LiteralPath $engineTemporary } }
}
@{ version = $engineRelease.tag_name; sha256 = $expected; source = $engineAsset[0].browser_download_url; size = $engineAsset[0].size } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskLocal 'android-media-engine.json') -Encoding utf8
Write-Output "Verified Android media engine $($engineRelease.tag_name), SHA-256 $expected."
