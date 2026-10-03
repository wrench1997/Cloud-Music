$nodeDir = Join-Path $PSScriptRoot ".local\nodejs"

if (!(Test-Path (Join-Path $nodeDir "node.exe"))) {
  Write-Error "Node 22 was not found at $nodeDir"
  exit 1
}

$env:Path = "$nodeDir;$env:Path"
$env:Node = Join-Path $nodeDir "node.exe"

Write-Host "Using project Node:"
node -v
Write-Host "npm:"
npm -v
