# Aligne .env, Mobile/.env.local et Mobile/eas.json avec l'IP LAN detectee.
# Usage : powershell -ExecutionPolicy Bypass -File scripts\sync-env.ps1
#         npm run sync:env

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "lib\lan-ip.ps1")

$envPath = Join-Path $root ".env"
$examplePath = Join-Path $root ".env.example"
$mobileEnvPath = Join-Path $root "Mobile\.env.local"
$mobileExamplePath = Join-Path $root "Mobile\.env.example"
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

if (-not (Test-Path $envPath)) {
  if (Test-Path $examplePath) {
    Copy-Item $examplePath $envPath
    Write-Host ".env cree depuis .env.example"
  } else {
    Write-Error ".env introuvable."
  }
}

if (-not (Test-Path $mobileEnvPath) -and (Test-Path $mobileExamplePath)) {
  Copy-Item $mobileExamplePath $mobileEnvPath
  Write-Host "Mobile/.env.local cree depuis Mobile/.env.example"
}

$envMap = Read-DotEnv $envPath
$mobileEnvMap = Read-DotEnv $mobileEnvPath
$lanIp = Resolve-LanIp $envMap

if (-not $lanIp) {
  Write-Warning "IP LAN introuvable. Definissez LAN_IP=<votre_ip_wifi> dans .env puis relancez npm run sync:env"
  $lanIp = "ADRESSE_IP_DU_PC"
}

$backendPort = if ($envMap["BACKEND_PORT"]) { $envMap["BACKEND_PORT"] } else { "5000" }
$expoPort = if ($envMap["EXPO_PORT"]) { $envMap["EXPO_PORT"] } elseif ($mobileEnvMap["EXPO_PORT"]) { $mobileEnvMap["EXPO_PORT"] } else { "8083" }
$demoMode = if ($mobileEnvMap["EXPO_PUBLIC_DEMO_MODE"]) { $mobileEnvMap["EXPO_PUBLIC_DEMO_MODE"] } else { "false" }
$apiUrl = "http://${lanIp}:${backendPort}"
$packagerHost = $lanIp

$nodeEnv = if ($envMap["NODE_ENV"]) { $envMap["NODE_ENV"].Trim() } else { "development" }

$cors = [string]$envMap["CORS_ORIGINS"]
if (-not $cors) {
  $cors = "http://localhost:5000,http://127.0.0.1:5000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:${expoPort},http://127.0.0.1:${expoPort}"
}
$cors = $cors -replace 'ADRESSE_IP_DU_PC', $lanIp
if ($nodeEnv -ne "production" -and $lanIp -ne "ADRESSE_IP_DU_PC") {
  foreach ($origin in @(
    "http://${lanIp}:${backendPort}",
    "http://${lanIp}:5173",
    "http://${lanIp}:${expoPort}"
  )) {
    if ($cors -notmatch [regex]::Escape($origin)) {
      $cors = "$cors,$origin"
    }
  }
}

Update-DotEnvFile $envPath @{
  LAN_IP = $lanIp
  CORS_ORIGINS = $cors
  EXPO_PORT = $expoPort
}

$mobileEnv = @"
# Genere par scripts/sync-env.ps1 - ne pas placer dans .env racine (Expo 57+).
LAN_IP=$lanIp
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
    if ($nodeEnv -eq "production" -or $envMap["SOMAFRIK_SKIP_DEMO_SEED"] -eq "true") {
      continue
    }
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
Write-Host "  .env                  OK (LAN_IP=$lanIp)"
Write-Host "  Mobile/.env.local     OK"
if (Test-Path $easPath) {
  Write-Host "  Mobile/eas.json       OK (preview + production)"
}
Write-Host ""
Write-Host "  API mobile : $apiUrl"
Write-Host "  Expo Metro : ${packagerHost}:$expoPort"
if ($lanIp -eq "ADRESSE_IP_DU_PC") {
  Write-Host ""
  Write-Host "  Astuce : ipconfig (Windows) puis LAN_IP=<IPv4 Wi-Fi> dans .env" -ForegroundColor Yellow
}
