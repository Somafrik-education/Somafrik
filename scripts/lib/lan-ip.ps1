function Get-LanIpAddress {
  $ip = (
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.PrefixOrigin -ne "WellKnown"
    } |
    Sort-Object InterfaceMetric |
    Select-Object -First 1 -ExpandProperty IPAddress
  )
  return $ip
}

function Test-LanIpPlaceholder([string]$Value) {
  $normalized = [string]$Value
  if (-not $normalized) { return $true }
  return $normalized -match '^(ADRESSE_IP_DU_PC|localhost|127\.0\.0\.1|VOTRE_IP|VOTRE_IP_WIFI|VOTRE_IP_LAN)$'
}

function Resolve-LanIp([hashtable]$envMap = @{}) {
  $configured = [string]$envMap["LAN_IP"]
  if (-not (Test-LanIpPlaceholder $configured)) {
    return $configured.Trim()
  }

  $detected = Get-LanIpAddress
  if ($detected) {
    return $detected
  }

  return $null
}

function Update-DotEnvFile([string]$path, [hashtable]$updates) {
  $lines = if (Test-Path $path) { @(Get-Content $path) } else { @() }
  $keysUpdated = @{}
  $newLines = New-Object System.Collections.Generic.List[string]

  foreach ($line in $lines) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#")) {
      [void]$newLines.Add($line)
      continue
    }
    $eq = $t.IndexOf("=")
    if ($eq -le 0) {
      [void]$newLines.Add($line)
      continue
    }
    $key = $t.Substring(0, $eq).Trim()
    if ($updates.ContainsKey($key)) {
      $keysUpdated[$key] = $true
      [void]$newLines.Add("$key=$($updates[$key])")
    } else {
      [void]$newLines.Add($line)
    }
  }

  foreach ($key in $updates.Keys) {
    if (-not $keysUpdated[$key]) {
      [void]$newLines.Add("$key=$($updates[$key])")
    }
  }

  Set-Content -Path $path -Value ($newLines -join "`n").TrimEnd() -Encoding utf8
}
