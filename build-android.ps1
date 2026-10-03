$ErrorActionPreference = "Stop"
. "$PSScriptRoot\use-android.ps1"
. "$PSScriptRoot\use-node22.ps1"
npm run android:build
if ($LASTEXITCODE -ne 0) { throw "Android build failed" }
