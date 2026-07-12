# Connexion mobile Somafrik via Docker (Expo Go).
# Si Expo Go ne repond pas : npm run mobile:host (recommande) ou npm run mobile:tunnel
# Usage : powershell -ExecutionPolicy Bypass -File scripts\mobile-docker-connect.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "=== Somafrik Mobile (Docker) ===" -ForegroundColor Cyan

& (Join-Path $root "scripts\sync-env.ps1")
& (Join-Path $root "scripts\open-firewall-dev.ps1")

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

$rootEnvMap = Read-DotEnv (Join-Path $root ".env")
$mobileEnvMap = Read-DotEnv (Join-Path $root "Mobile\.env.local")

$hostIp = $mobileEnvMap["REACT_NATIVE_PACKAGER_HOSTNAME"]
$apiUrl = $mobileEnvMap["EXPO_PUBLIC_API_URL"]
$expoPort = if ($rootEnvMap["EXPO_PORT"]) { $rootEnvMap["EXPO_PORT"] } else { "8083" }

Write-Host ""
Write-Host "Demarrage / verification des services..." -ForegroundColor Yellow
docker compose up -d postgres backend mobile | Out-Null

Write-Host "Attente backend..."
$healthy = $false
for ($i = 0; $i -lt 40; $i++) {
  try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:5000/api/health" -UseBasicParsing -TimeoutSec 5
    if ($resp.StatusCode -eq 200) { $healthy = $true; break }
  } catch { Start-Sleep -Seconds 2 }
}
if (-not $healthy) {
  Write-Host "Backend indisponible. Verifiez : docker compose logs backend" -ForegroundColor Red
  exit 1
}

Write-Host "Redemarrage Expo Metro..." -ForegroundColor Yellow
docker compose restart mobile | Out-Null
Start-Sleep -Seconds 25

$expoUrl = "exp://${hostIp}:${expoPort}"
$manifestUrl = "http://${hostIp}:${expoPort}"

$metroOk = $false
$metroLanOk = $false
try {
  $status = Invoke-WebRequest -Uri "http://127.0.0.1:${expoPort}/status" -UseBasicParsing -TimeoutSec 5
  $metroOk = ($status.Content -match "running")
} catch { }
try {
  $statusLan = Invoke-WebRequest -Uri "${manifestUrl}/status" -UseBasicParsing -TimeoutSec 5
  $metroLanOk = ($statusLan.Content -match "running")
} catch { }

Write-Host ""
Write-Host "=== Diagnostic ===" -ForegroundColor Cyan
Write-Host "  Metro localhost : $(if ($metroOk) { 'OK' } else { 'ECHEC' })"
Write-Host "  Metro IP LAN    : $(if ($metroLanOk) { 'OK' } else { 'ECHEC' })"
Write-Host ""

Write-Host "=== Connexion mobile ===" -ForegroundColor Green
Write-Host ""
Write-Host "1. Telephone et PC sur le MEME Wi-Fi (desactiver VPN / 4G)"
Write-Host "2. Test OBLIGATOIRE sur le navigateur du telephone :"
Write-Host "   $apiUrl/api/health"
Write-Host "   $manifestUrl/status   (doit afficher packager-status:running)"
Write-Host ""
Write-Host "3. Expo Go (SDK 54) - mettre a jour depuis le Play Store / App Store"
Write-Host "   URL manuelle : $expoUrl" -ForegroundColor Cyan
Write-Host "   Alternative  : $manifestUrl (ouvrir dans Expo Go si propose)"
Write-Host ""
Write-Host "4. Comptes demo : CD-2026-0001 | ELE-0001 ou ENS-0001 | PIN 1234"
Write-Host ""
Write-Host "Logs Expo : npm run docker:logs:mobile"
Write-Host ""

if (-not $metroLanOk) {
  Write-Host "Metro inaccessible sur l IP LAN." -ForegroundColor Yellow
  Write-Host "Solution recommandee : npm run mobile:host" -ForegroundColor Yellow
  Write-Host "(Expo sur le PC, backend Docker - QR code + URL manuelle fiables)"
  Write-Host ""
}

if ($mobileEnvMap["EXPO_PUBLIC_DEMO_MODE"] -eq "true") {
  Write-Host "ATTENTION : EXPO_PUBLIC_DEMO_MODE=true - l app ignore l API Docker." -ForegroundColor Yellow
  Write-Host "Mettez false dans Mobile/.env.local puis relancez ce script." -ForegroundColor Yellow
  Write-Host ""
}

Write-Host "Si le telephone ne se connecte toujours pas :" -ForegroundColor Yellow
Write-Host "  npm run mobile:host          (Expo hors Docker, recommande)"
Write-Host "  npm run mobile:tunnel        (contourne pare-feu / isolation Wi-Fi)"
Write-Host "  Ouvrir pare-feu en admin : scripts\open-firewall-dev.ps1"
Write-Host ""
