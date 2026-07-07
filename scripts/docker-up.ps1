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

# Met a jour l'IP LAN dans .env si placeholder ou localhost (telephone physique)
try {
  $lanIp = (
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and
      $_.PrefixOrigin -ne "WellKnown"
    } |
    Sort-Object -Property InterfaceMetric |
    Select-Object -First 1 -ExpandProperty IPAddress
  )

  if ($lanIp) {
    $mobileEnvPath = Join-Path $root "Mobile\.env.local"
    if (-not (Test-Path $mobileEnvPath) -and (Test-Path (Join-Path $root "Mobile\.env.example"))) {
      Copy-Item (Join-Path $root "Mobile\.env.example") $mobileEnvPath
    }

    $envContent = Get-Content ".env" -Raw
    $envUpdated = $false
    $mobileUpdated = $false

    if (Test-Path $mobileEnvPath) {
      $mobileContent = Get-Content $mobileEnvPath -Raw
      if ($mobileContent -match 'REACT_NATIVE_PACKAGER_HOSTNAME=(ADRESSE_IP_DU_PC|localhost|127\.0\.0\.1)') {
        $mobileContent = $mobileContent -replace 'REACT_NATIVE_PACKAGER_HOSTNAME=.*', "REACT_NATIVE_PACKAGER_HOSTNAME=$lanIp"
        $mobileUpdated = $true
      }
      if ($mobileContent -match 'EXPO_PUBLIC_API_URL=http://(ADRESSE_IP_DU_PC|localhost|127\.0\.0\.1):5000') {
        $mobileContent = $mobileContent -replace 'EXPO_PUBLIC_API_URL=.*', "EXPO_PUBLIC_API_URL=http://${lanIp}:5000"
        $mobileUpdated = $true
      }
      if ($mobileUpdated) {
        Set-Content $mobileEnvPath $mobileContent.TrimEnd()
      }
    }
    if ($envContent -notmatch [regex]::Escape($lanIp) -and $envContent -match 'CORS_ORIGINS=') {
      if ($envContent -notmatch "http://${lanIp}:5000") {
        $envContent = $envContent -replace '(CORS_ORIGINS=.*)', "`$1,http://${lanIp}:5000,http://${lanIp}:5173,http://${lanIp}:8083"
        $envUpdated = $true
      }
    }

    if ($envUpdated) {
      Set-Content ".env" $envContent.TrimEnd()
    }
    if ($envUpdated -or $mobileUpdated) {
      Write-Host "IP LAN detectee ($lanIp) — Mobile/.env.local et CORS mis a jour."
    }
  }
} catch {
  Write-Host "Detection IP LAN ignoree (utilisez .env manuellement si besoin)."
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
  $expoPort = if ($env:EXPO_PORT) { $env:EXPO_PORT } else { "8083" }
  $packagerHost = "VOTRE_IP_WIFI"
  $mobileEnvPath = Join-Path $root "Mobile\.env.local"
  if (Test-Path $mobileEnvPath) {
    foreach ($line in Get-Content $mobileEnvPath) {
      if ($line -match '^REACT_NATIVE_PACKAGER_HOSTNAME=(.+)$') { $packagerHost = $matches[1].Trim() }
    }
  }
  Write-Host "  Expo Metro  : port $expoPort"
  Write-Host "  Expo Go URL : exp://${packagerHost}:$expoPort"
  Write-Host "  Mobile      : npm run mobile:docker"
}
Write-Host ""
Write-Host "Logs : docker compose logs -f"
Write-Host "Arret: docker compose down"
