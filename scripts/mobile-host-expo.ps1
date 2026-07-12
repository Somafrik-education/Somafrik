# Expo sur le PC (hors conteneur Docker) - methode la plus fiable pour Expo Go.
# Backend reste dans Docker ; Metro tourne directement sur Windows (QR + URL manuelle).
# Usage : powershell -ExecutionPolicy Bypass -File scripts\mobile-host-expo.ps1
#         powershell -ExecutionPolicy Bypass -File scripts\mobile-host-expo.ps1 -Tunnel

param(
  [switch]$Tunnel
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "=== Somafrik Mobile (Expo sur PC) ===" -ForegroundColor Cyan

& (Join-Path $root "scripts\sync-env.ps1")
& (Join-Path $root "scripts\open-firewall-dev.ps1")

$envMap = @{}
$mobileEnvPath = Join-Path $root "Mobile\.env.local"
foreach ($path in @($mobileEnvPath)) {
  if (-not (Test-Path $path)) { continue }
  foreach ($line in Get-Content $path) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#")) { continue }
    $eq = $t.IndexOf("=")
    if ($eq -le 0) { continue }
    $envMap[$t.Substring(0, $eq).Trim()] = $t.Substring($eq + 1).Trim()
  }
}

$rootEnvMap = @{}
$rootEnvPath = Join-Path $root ".env"
if (Test-Path $rootEnvPath) {
  foreach ($line in Get-Content $rootEnvPath) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#")) { continue }
    $eq = $t.IndexOf("=")
    if ($eq -le 0) { continue }
    $rootEnvMap[$t.Substring(0, $eq).Trim()] = $t.Substring($eq + 1).Trim()
  }
}

$hostIp = $envMap["REACT_NATIVE_PACKAGER_HOSTNAME"]
$apiUrl = $envMap["EXPO_PUBLIC_API_URL"]
$expoPort = if ($envMap["EXPO_PORT"]) { $envMap["EXPO_PORT"] } elseif ($rootEnvMap["EXPO_PORT"]) { $rootEnvMap["EXPO_PORT"] } else { "8081" }

foreach ($key in @("REACT_NATIVE_PACKAGER_HOSTNAME", "EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_DEMO_MODE", "EXPO_PORT")) {
  if ($envMap.ContainsKey($key)) {
    Set-Item -Path "env:$key" -Value $envMap[$key]
  }
}

Write-Host ""
Write-Host "Demarrage backend Docker (sans conteneur mobile)..." -ForegroundColor Yellow
docker compose up -d postgres backend | Out-Null
docker compose stop mobile 2>$null | Out-Null

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

Write-Host ""
Write-Host "=== Connexion mobile ===" -ForegroundColor Green
Write-Host "1. Telephone et PC sur le MEME Wi-Fi"
Write-Host "2. Test API sur le telephone : $apiUrl/api/health"
if ($Tunnel) {
  Write-Host "3. Mode tunnel Expo (contourne pare-feu / isolation Wi-Fi)"
  Write-Host "   Attendez l URL exp://... dans le terminal ci-dessous"
} else {
  Write-Host "3. Expo Go - URL manuelle : exp://${hostIp}:${expoPort}" -ForegroundColor Cyan
  Write-Host "   Ou scannez le QR code affiche ci-dessous"
}
Write-Host ""
Write-Host "Comptes demo : CD-2026-0001 | ELE-0001 ou ENS-0001 | PIN 1234"
Write-Host ""

Set-Location (Join-Path $root "Mobile")

if (-not (Test-Path "node_modules")) {
  Write-Host "Installation des dependances Mobile..." -ForegroundColor Yellow
  npm install
}

$expoArgs = @("expo", "start", "--clear", "--port", $expoPort)
if ($Tunnel) {
  $expoArgs += "--tunnel"
} else {
  $expoArgs += "--lan"
}

& npx @expoArgs
