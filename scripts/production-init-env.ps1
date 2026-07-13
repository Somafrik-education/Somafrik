# Initialise l'environnement de production depuis le modèle.
# Usage : npm run production:init-env

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$examplePath = Join-Path $root ".env.production.example"
$envPath = Join-Path $root ".env.production"

if (-not (Test-Path $examplePath)) {
  Write-Error ".env.production.example introuvable."
}

if (Test-Path $envPath) {
  Write-Host ".env.production existe déjà — aucune modification." -ForegroundColor Yellow
  exit 0
}

Copy-Item $examplePath $envPath
Write-Host ".env.production créé depuis .env.production.example" -ForegroundColor Green
Write-Host ""
Write-Host "Éditez .env.production et remplacez :" -ForegroundColor Cyan
Write-Host "  POSTGRES_PASSWORD"
Write-Host "  JWT_SECRET              (openssl rand -hex 32)"
Write-Host ""
Write-Host "Puis :" -ForegroundColor Cyan
Write-Host "  npm run production:up"
