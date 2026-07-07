# Aligne .env, Mobile/.env.local et Mobile/eas.json (preview + production).
# Usage : powershell -ExecutionPolicy Bypass -File scripts\sync-env.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root ".env"
$examplePath = Join-Path $root ".env.example"
$mobileEnvPath = Join-Path $root "Mobile\.env.local"
$easPath = Join-Path $root "Mobile\eas.json"

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

function Get-LanIp {
  $ip = (
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.PrefixOrigin -ne "WellKnown"
    } |
    Sort-Object InterfaceMetric |
    Select-Object -First 1 -ExpandProperty IPAddress
  )
  if ($ip) { return $ip }
  return "192.168.1.35"
}

if (-not (Test-Path $envPath)) {
  if (Test-Path $examplePath) {
    Copy-Item $examplePath $envPath
    Write-Host ".env cree depuis .env.example"
  } else {
    Write-Error ".env introuvable."
  }
}

$lanIp = Get-LanIp
$envMap = Read-DotEnv $envPath
$requiredKeys = @(
  "NODE_ENV", "BACKEND_PORT", "POSTGRES_HOST_PORT", "POSTGRES_DB", "POSTGRES_USER",
  "POSTGRES_PASSWORD", "JWT_SECRET", "CORS_ORIGINS", "WEB_DEV_PORT", "SOMAFRIK_DB_REQUIRED",
  "JSON_BODY_LIMIT", "EXPO_PORT"
)

$mobileEnvMap = Read-DotEnv $mobileEnvPath
$apiUrl = if ($mobileEnvMap["EXPO_PUBLIC_API_URL"]) { $mobileEnvMap["EXPO_PUBLIC_API_URL"] } elseif ($envMap["EXPO_PUBLIC_API_URL"]) { $envMap["EXPO_PUBLIC_API_URL"] } else { "http://${lanIp}:5000" }
$packagerHost = if ($mobileEnvMap["REACT_NATIVE_PACKAGER_HOSTNAME"]) { $mobileEnvMap["REACT_NATIVE_PACKAGER_HOSTNAME"] } elseif ($envMap["REACT_NATIVE_PACKAGER_HOSTNAME"]) { $envMap["REACT_NATIVE_PACKAGER_HOSTNAME"] } else { $lanIp }
$expoPort = if ($mobileEnvMap["EXPO_PORT"]) { $mobileEnvMap["EXPO_PORT"] } elseif ($envMap["EXPO_PORT"]) { $envMap["EXPO_PORT"] } else { "8083" }
$demoMode = if ($mobileEnvMap["EXPO_PUBLIC_DEMO_MODE"]) { $mobileEnvMap["EXPO_PUBLIC_DEMO_MODE"] } elseif ($envMap["EXPO_PUBLIC_DEMO_MODE"]) { $envMap["EXPO_PUBLIC_DEMO_MODE"] } else { "false" }

$corsBase = "http://localhost:5000,http://127.0.0.1:5000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:${expoPort},http://127.0.0.1:${expoPort}"
$corsLan = "http://${packagerHost}:5000,http://${packagerHost}:5173,http://${packagerHost}:${expoPort}"
$corsMerged = "$corsBase,$corsLan"

$mergedEnv = @"
NODE_ENV=production
BACKEND_PORT=5000
POSTGRES_HOST_PORT=5433
POSTGRES_DB=somafrik
POSTGRES_USER=somafrik
POSTGRES_PASSWORD=change-me
JWT_SECRET=change-this-long-random-secret-before-use
CORS_ORIGINS=$corsMerged
WEB_DEV_PORT=5173
SOMAFRIK_DB_REQUIRED=true
JSON_BODY_LIMIT=1mb

# Port Metro pour Docker Compose (service mobile).
EXPO_PORT=$expoPort
"@

Set-Content -Path $envPath -Value $mergedEnv.TrimEnd() -Encoding utf8

$mobileEnv = @"
# Variables Expo locales (machine / telephone). Ne pas mettre dans .env racine (Expo 57+).
EXPO_PORT=$expoPort
REACT_NATIVE_PACKAGER_HOSTNAME=$packagerHost
EXPO_PUBLIC_API_URL=$apiUrl
EXPO_PUBLIC_DEMO_MODE=$demoMode
"@
Set-Content -Path $mobileEnvPath -Value $mobileEnv.TrimEnd() -Encoding utf8

if (Test-Path $easPath) {
  $easRaw = Get-Content $easPath -Raw
  $eas = $easRaw | ConvertFrom-Json
  foreach ($profile in @("preview", "production")) {
    if ($eas.build.PSObject.Properties.Name -contains $profile) {
      if (-not $eas.build.$profile.env) {
        $eas.build.$profile | Add-Member -NotePropertyName env -NotePropertyValue ([pscustomobject]@{})
      }
      $eas.build.$profile.env.EXPO_PUBLIC_API_URL = $apiUrl
      $eas.build.$profile.env.EXPO_PUBLIC_DEMO_MODE = $demoMode
    }
  }
  $json = $eas | ConvertTo-Json -Depth 10
  $json = $json -replace '\\u003e=', '>='
  Set-Content $easPath -Value ($json.TrimEnd() + "`n") -Encoding utf8
}

Write-Host "=== Environnements synchronises ===" -ForegroundColor Green
Write-Host "  .env                  OK"
Write-Host "  Mobile/.env.local     OK"
Write-Host "  Mobile/eas.json     OK (preview + production)"
Write-Host ""
Write-Host "  API mobile : $apiUrl"
Write-Host "  Expo Metro : $packagerHost`:$expoPort"
