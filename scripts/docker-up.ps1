# Démarre toute la stack Somafrik dans Docker (postgres + backend + web + mobile).
# Usage :
#   powershell -ExecutionPolicy Bypass -File scripts\docker-up.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\docker-up.ps1 -CoreOnly

param(
  [switch]$CoreOnly
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path ".env")) {
  if (Test-Path ".env.example") {
    Copy-Item ".env.example" ".env"
    Write-Host "Fichier .env cree depuis .env.example."
  } else {
    Write-Error "Fichier .env manquant."
  }
}

try {
  & (Join-Path $root "scripts\sync-env.ps1")
} catch {
  Write-Host "Synchronisation IP LAN ignoree (definissez LAN_IP dans .env si besoin)."
}

$composeArgs = @("compose", "up", "-d", "--build")

if ($CoreOnly) {
  $composeArgs += "postgres"
  $composeArgs += "backend"
} else {
  $composeArgs += "postgres"
  $composeArgs += "backend"
  $composeArgs += "web-dev"
  $composeArgs += "mobile"
}

Write-Host "Demarrage Docker Somafrik ($(if ($CoreOnly) { 'core' } else { 'stack complete' }))..."
docker @composeArgs

Write-Host ""
Write-Host "=== Somafrik (Docker) ==="
Write-Host "  API sante   : http://localhost:5000/api/health"
Write-Host "  Plateforme  : http://localhost:5000/backoffice/"
Write-Host "  Web (build) : http://localhost:5000/web/"
if (-not $CoreOnly) {
  Write-Host "  Web (dev)   : http://localhost:5173/web/"
  $expoPort = "8083"
  $packagerHost = "VOTRE_IP_WIFI"
  $mobileEnvPath = Join-Path $root "Mobile\.env.local"
  if (Test-Path $mobileEnvPath) {
    foreach ($line in Get-Content $mobileEnvPath) {
      if ($line -match '^REACT_NATIVE_PACKAGER_HOSTNAME=(.+)$') { $packagerHost = $matches[1].Trim() }
      if ($line -match '^EXPO_PORT=(.+)$') { $expoPort = $matches[1].Trim() }
    }
  }
  Write-Host "  Expo Metro  : port $expoPort"
  Write-Host "  Expo Go URL : exp://${packagerHost}:$expoPort"
  Write-Host "  Mobile      : npm run mobile:docker"
}
Write-Host ""
Write-Host "Logs : docker compose logs -f"
Write-Host "Arret: docker compose down"
