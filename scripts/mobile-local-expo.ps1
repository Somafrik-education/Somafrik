# Boucle rapide Somafrik : PostgreSQL + Backend Docker, Expo/Metro sur Windows.
# Ne modifie jamais Mobile/eas.json et ne déclenche aucun APK/AAB.
#
# Usage :
#   powershell -ExecutionPolicy Bypass -File scripts\mobile-local-expo.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\mobile-local-expo.ps1 -Tunnel
#   powershell -ExecutionPolicy Bypass -File scripts\mobile-local-expo.ps1 -RebuildBackend
#   powershell -ExecutionPolicy Bypass -File scripts\mobile-local-expo.ps1 -ResetDb

param(
  [switch]$Tunnel,
  [switch]$RebuildBackend,
  [switch]$ResetDb
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
. (Join-Path $PSScriptRoot "lib\lan-ip.ps1")

function Read-DotEnv([string]$path) {
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

Write-Host "=== Somafrik — Docker Core + Expo local ===" -ForegroundColor Cyan

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Error "Docker est introuvable. Démarrez Docker Desktop puis relancez."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js est introuvable. Node 22.12+ est requis pour Expo local."
}

$rootEnv = Read-DotEnv (Join-Path $root ".env")
$lanIp = Resolve-LanIp $rootEnv
if (-not $lanIp) {
  Write-Error "IP LAN introuvable. Ajoutez LAN_IP=<IPv4 Wi-Fi> dans .env ou vérifiez ipconfig."
}

$backendPort = if ($rootEnv["BACKEND_PORT"]) { $rootEnv["BACKEND_PORT"] } else { "5000" }
$expoPort = if ($rootEnv["EXPO_PORT"]) { $rootEnv["EXPO_PORT"] } else { "8083" }
$apiUrl = "http://${lanIp}:${backendPort}"

# Fichier local gitignored : aucun profil EAS/release n'est réécrit.
$mobileEnvPath = Join-Path $root "Mobile\.env.local"
$mobileEnv = @"
# Généré par scripts/mobile-local-expo.ps1 — développement local uniquement.
LAN_IP=$lanIp
EXPO_PORT=$expoPort
REACT_NATIVE_PACKAGER_HOSTNAME=$lanIp
EXPO_PUBLIC_API_URL=$apiUrl
EXPO_PUBLIC_RELEASE_PROFILE=development
EXPO_PUBLIC_DEMO_MODE=false
"@
Set-Content -Path $mobileEnvPath -Value $mobileEnv.TrimEnd() -Encoding utf8

$env:LAN_IP = $lanIp
$env:EXPO_PORT = $expoPort
$env:REACT_NATIVE_PACKAGER_HOSTNAME = $lanIp
$env:EXPO_PUBLIC_API_URL = $apiUrl
$env:EXPO_PUBLIC_RELEASE_PROFILE = "development"
$env:EXPO_PUBLIC_DEMO_MODE = "false"

$compose = @("compose", "-f", "docker-compose.local.yml")

if ($ResetDb) {
  Write-Host "Réinitialisation PostgreSQL local..." -ForegroundColor Yellow
  docker @compose down -v
}

$imageExists = $false
docker image inspect somafrik-backend-local:dev *> $null
if ($LASTEXITCODE -eq 0) { $imageExists = $true }

if ($RebuildBackend -or -not $imageExists) {
  Write-Host "Construction de l'image backend locale (première fois / dépendances modifiées)..." -ForegroundColor Yellow
  docker @compose build backend
}

Write-Host "Démarrage PostgreSQL + Backend..." -ForegroundColor Yellow
docker @compose up -d postgres backend

Write-Host "Attente de l'API PostgreSQL canonique..."
$healthy = $false
for ($i = 0; $i -lt 45; $i++) {
  try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:${backendPort}/api/health" -UseBasicParsing -TimeoutSec 4
    if ($resp.StatusCode -eq 200) {
      $healthy = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 2
  }
}

if (-not $healthy) {
  Write-Host "Backend indisponible." -ForegroundColor Red
  Write-Host "Diagnostic : docker compose -f docker-compose.local.yml logs backend"
  exit 1
}

# L'ouverture du pare-feu est utile sur téléphone physique mais ne doit pas bloquer l'émulateur.
try {
  & (Join-Path $root "scripts\open-firewall-dev.ps1")
} catch {
  Write-Warning "Pare-feu non modifié. Si Expo Go ne voit pas le PC, exécutez open-firewall-dev.ps1 en administrateur."
}

Write-Host ""
Write-Host "API locale     : http://127.0.0.1:${backendPort}/api/health" -ForegroundColor Green
Write-Host "API téléphone  : ${apiUrl}/api/health" -ForegroundColor Green
Write-Host "Expo/Metro     : ${lanIp}:${expoPort}" -ForegroundColor Green
Write-Host "PostgreSQL     : Docker (volume persistant somafrik-local)" -ForegroundColor Green
Write-Host "APK/AAB/EAS    : NON déclenché" -ForegroundColor Green
Write-Host ""

Set-Location (Join-Path $root "Mobile")
if (-not (Test-Path "node_modules")) {
  Write-Host "Installation des dépendances Mobile (première fois)..." -ForegroundColor Yellow
  npm ci
}

$expoArgs = @("expo", "start", "--clear", "--port", $expoPort)
if ($Tunnel) {
  $expoArgs += "--tunnel"
} else {
  $expoArgs += "--lan"
}

& npx @expoArgs
