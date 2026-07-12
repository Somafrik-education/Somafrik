# Initialise .env.preproduction (separe du .env de developpement local).
# Usage : npm run preprod:init-env

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$examplePath = Join-Path $root ".env.preproduction.example"
$envPath = Join-Path $root ".env.preproduction"

function New-RandomSecret([int]$length = 32) {
  $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  -join (1..$length | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
}

if (-not (Test-Path $examplePath)) {
  Write-Error ".env.preproduction.example introuvable."
}

if (Test-Path $envPath) {
  Write-Host ".env.preproduction existe deja - aucune modification." -ForegroundColor Yellow
  Write-Host "Supprimez le fichier pour regenerer, ou editez-le manuellement."
  exit 0
}

$postgresPassword = New-RandomSecret 24
$jwtSecret = New-RandomSecret 48
$bootstrapPassword = New-RandomSecret 20

$content = Get-Content $examplePath -Raw
$content = $content.Replace("POSTGRES_PASSWORD=GENERER-MOT-DE-PASSE-FORT-ICI", "POSTGRES_PASSWORD=$postgresPassword")
$content = $content.Replace("JWT_SECRET=GENERER-SECRET-JWT-32-CARACTERES-MINIMUM-ICI", "JWT_SECRET=$jwtSecret")
$content = $content.Replace("BOOTSTRAP_SUPERADMIN_PASSWORD=GENERER-MOT-DE-PASSE-FORT-ICI", "BOOTSTRAP_SUPERADMIN_PASSWORD=$bootstrapPassword")

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($envPath, $content.TrimEnd(), $utf8NoBom)

Write-Host ".env.preproduction cree (secrets generes automatiquement)." -ForegroundColor Green
Write-Host ""
Write-Host "Conservez ces identifiants (affiches une seule fois) :" -ForegroundColor Cyan
Write-Host "  POSTGRES_PASSWORD             = $postgresPassword"
Write-Host "  JWT_SECRET                    = $jwtSecret"
Write-Host "  BOOTSTRAP_SUPERADMIN_PASSWORD = $bootstrapPassword"
Write-Host "  BOOTSTRAP_SUPERADMIN_ID       = superadmin"
Write-Host ""
Write-Host "Verifiez aussi :" -ForegroundColor Cyan
Write-Host "  SOMAFRIK_API_DOMAIN=api-preprod.somafrik.app"
Write-Host "  CORS_ORIGINS=https://preprod.somafrik.app"
Write-Host ""
Write-Host "Puis :" -ForegroundColor Cyan
Write-Host "  npm run preprod:check"
Write-Host "  npm run preprod:up"
Write-Host "  npm run preprod:bootstrap"
