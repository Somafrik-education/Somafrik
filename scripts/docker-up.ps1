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
    $envContent = Get-Content ".env" -Raw
    $updated = $false

    if ($envContent -match 'REACT_NATIVE_PACKAGER_HOSTNAME=(ADRESSE_IP_DU_PC|localhost|127\.0\.0\.1)') {
      $envContent = $envContent -replace 'REACT_NATIVE_PACKAGER_HOSTNAME=.*', "REACT_NATIVE_PACKAGER_HOSTNAME=$lanIp"
      $updated = $true
    }
    if ($envContent -match 'EXPO_PUBLIC_API_URL=http://(ADRESSE_IP_DU_PC|localhost|127\.0\.0\.1):5000') {
      $envContent = $envContent -replace 'EXPO_PUBLIC_API_URL=.*', "EXPO_PUBLIC_API_URL=http://${lanIp}:5000"
      $updated = $true
    }
    if ($envContent -notmatch [regex]::Escape($lanIp) -and $envContent -match 'CORS_ORIGINS=') {
      if ($envContent -notmatch "http://${lanIp}:5000") {
        $envContent = $envContent -replace '(CORS_ORIGINS=.*)', "`$1,http://${lanIp}:5000,http://${lanIp}:5173,http://${lanIp}:8083"
        $updated = $true
      }
    }

    if ($updated) {
      Set-Content ".env" $envContent.TrimEnd()
      Write-Host "IP LAN detectee ($lanIp) — .env mis a jour pour mobile/CORS."
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
  $packagerHost = if ($env:REACT_NATIVE_PACKAGER_HOSTNAME) { $env:REACT_NATIVE_PACKAGER_HOSTNAME } else { "VOTRE_IP_WIFI" }
  Write-Host "  Expo Metro  : port $expoPort"
  Write-Host "  Expo Go URL : exp://${packagerHost}:$expoPort"
  Write-Host "  Mobile      : npm run mobile:docker"
}
Write-Host ""
Write-Host "Logs : docker compose logs -f"
Write-Host "Arret: docker compose down"
