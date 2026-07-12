# Démarre le backend Somafrik (mode mémoire, sans PostgreSQL).
# Usage : powershell -ExecutionPolicy Bypass -File scripts\start-backend.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$nodePath = "C:\Program Files\nodejs"
$npmGlobal = Join-Path $env:APPDATA "npm"

if (Test-Path $nodePath) {
  $env:PATH = "$nodePath;$npmGlobal;" + $env:PATH
}

. (Join-Path $PSScriptRoot "lib\lan-ip.ps1")

function Read-DotEnv($path) {
  $map = @{}
  if (-not (Test-Path $path)) { return $map }
  foreach ($line in Get-Content $path) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#")) { continue }
    $eq = $t.IndexOf("=")
    if ($eq -le 0) { continue }
    $map[$t.Substring(0, $eq).Trim()] = $t.Substring($eq + 1).Trim()
  }
  return $map
}

Set-Location (Join-Path $root "backend")
$env:SOMAFRIK_DB_REQUIRED = "false"
$env:NODE_ENV = "development"

Write-Host "Demarrage backend Somafrik (memoire) sur http://0.0.0.0:5000 ..."
Write-Host "Test local : http://localhost:5000/api/health"

$lanIp = Resolve-LanIp (Read-DotEnv (Join-Path $root ".env"))
if (-not $lanIp) {
  $lanIp = Get-LanIpAddress
}
if ($lanIp) {
  Write-Host "Test LAN   : http://${lanIp}:5000/api/health"
} else {
  Write-Host "Test LAN   : definissez LAN_IP dans .env ou lancez npm run sync:env"
}
Write-Host ""

node scripts/dev-memory.js
