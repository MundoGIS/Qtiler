$svc = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq 'QTiler' } |
  Select-Object -First 1

if (-not $svc) {
  exit 0
}

$pathName = [string]$svc.PathName
$exe = $null
$quotedMatch = [regex]::Match($pathName, '"([^"]*qtiler\.exe)"', 'IgnoreCase')
if ($quotedMatch.Success) {
  $exe = $quotedMatch.Groups[1].Value
} else {
  $plainMatch = [regex]::Match($pathName, '([^\s]*qtiler\.exe)', 'IgnoreCase')
  if ($plainMatch.Success) {
    $exe = $plainMatch.Groups[1].Value
  }
}

$root = $null
if ($exe) {
  $xmlPath = Join-Path (Split-Path -Parent $exe) 'qtiler.xml'
  if (Test-Path -LiteralPath $xmlPath) {
    try {
      [xml]$xml = Get-Content -LiteralPath $xmlPath -Raw
      $root = [string]$xml.service.workingdirectory
    } catch {
      $root = $null
    }
  }
  if (-not $root) {
    $root = Split-Path -Parent (Split-Path -Parent $exe)
  }
}

if ($root) {
  Write-Output $root
}