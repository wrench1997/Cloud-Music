$ErrorActionPreference = "Stop"

$javaCandidates = @(
  $env:JAVA_HOME,
  "D:\android studio\jbr",
  (Join-Path $env:ProgramFiles "Android\Android Studio\jbr"),
  "C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot"
)
$projectJava = $javaCandidates | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ "bin\javac.exe")) } | Select-Object -First 1
if (!$projectJava) { throw "JDK was not found. Set JAVA_HOME to a JDK 21 or newer installation." }

$sdkCandidates = @(
  $env:ANDROID_HOME,
  $env:ANDROID_SDK_ROOT,
  (Join-Path $PSScriptRoot ".local\android-sdk"),
  (Join-Path $env:LOCALAPPDATA "Android\Sdk"),
  "C:\Android\Sdk"
)
$projectSdk = $sdkCandidates | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ "platforms\android-36\android.jar")) } | Select-Object -First 1
if (!$projectSdk) { throw "Android SDK API 36 was not found. Install API 36 and Build Tools in Android Studio, then set ANDROID_HOME to the SDK directory." }

$env:JAVA_HOME = $projectJava
$env:ANDROID_HOME = $projectSdk
$env:ANDROID_SDK_ROOT = $projectSdk
$env:Path = "$projectJava\bin;$projectSdk\platform-tools;$env:Path"
# local.properties is machine-specific. Keep it aligned with the selected SDK.
$escapedSdk = -join ($projectSdk.Replace('\', '/').ToCharArray() | ForEach-Object {
  if ([int]$_ -gt 127) { '\u{0:x4}' -f [int]$_ } else { [string]$_ }
})
"sdk.dir=$escapedSdk" | Set-Content -LiteralPath (Join-Path $PSScriptRoot "android\local.properties") -Encoding ascii
Write-Host "Android JDK: $projectJava"
Write-Host "Android SDK: $projectSdk"
