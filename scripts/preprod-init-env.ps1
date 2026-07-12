# Initialise l'environnement de préproduction depuis le modèle.
# Usage : npm run preprod:init-env

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$examplePath = Join-Path $root ".env.preproduction.example"
$envPath = Join-Path $root ".env"

if (-not (Test-Path $examplePath)) {
  Write-Error ".env.preproduction.example introuvable."
}

if (Test-Path $envPath) {
  Write-Host ".env existe déjà — aucune modification (supprimez-le pour réinitialiser)." -ForegroundColor Yellow
  exit 0
}

Copy-Item $examplePath $envPath
Write-Host ".env créé depuis .env.preproduction.example" -ForegroundColor Green
Write-Host ""
Write-Host "Éditez .env et remplacez :" -ForegroundColor Cyan
Write-Host "  POSTGRES_PASSWORD"
Write-Host "  JWT_SECRET              (openssl rand -hex 32)"
Write-Host "  BOOTSTRAP_SUPERADMIN_PASSWORD"
Write-Host "  SOMAFRIK_DOMAIN"
Write-Host "  CORS_ORIGINS"
Write-Host "  EXPO_PUBLIC_API_URL"
Write-Host ""
Write-Host "Puis :" -ForegroundColor Cyan
Write-Host "  npm run preprod:bootstrap"
Write-Host "  npm run preprod:up"
