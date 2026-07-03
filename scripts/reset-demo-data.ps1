# Efface toutes les donnees de demonstration PostgreSQL + plateforme.
# Usage :
#   powershell -ExecutionPolicy Bypass -File scripts\reset-demo-data.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\reset-demo-data.ps1 -NoBootstrap

param(
  [switch]$NoBootstrap
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path ".env")) {
  Write-Error "Fichier .env manquant."
}

$envContent = Get-Content ".env" -Raw
if ($envContent -notmatch "SOMAFRIK_SKIP_DEMO_SEED=true") {
  if ($envContent -notmatch "SOMAFRIK_SKIP_DEMO_SEED=") {
    $envContent = $envContent.TrimEnd() + "`nSOMAFRIK_SKIP_DEMO_SEED=true`n"
  } else {
    $envContent = $envContent -replace "SOMAFRIK_SKIP_DEMO_SEED=.*", "SOMAFRIK_SKIP_DEMO_SEED=true"
  }
  Set-Content ".env" $envContent.TrimEnd()
  Write-Host "SOMAFRIK_SKIP_DEMO_SEED=true ajoute dans .env"
}

$args = @("backend/scripts/wipe-demo-data.js")
if (-not $NoBootstrap) {
  $args += "--bootstrap"
}

Write-Host "Nettoyage des donnees de demo..."
node @args

Write-Host ""
Write-Host "Redemarrage du backend Docker (recreation pour appliquer SOMAFRIK_SKIP_DEMO_SEED)..."
docker compose up -d --force-recreate backend

Write-Host ""
Write-Host "Termine. Deconnectez-vous de la plateforme web et reconnectez-vous."
