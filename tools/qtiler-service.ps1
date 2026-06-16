param(
  [ValidateSet('find', 'stop', 'start', 'exists', 'wait-removed')]
  [string] $Action = 'find',
  [string] $ServiceName = 'QTiler'
)

$ErrorActionPreference = 'Stop'

function Get-QtilerServiceInfo {
  $desired = [string]$ServiceName
  Get-CimInstance Win32_Service -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq $desired -or $_.DisplayName -eq $desired -or $_.Name -eq 'QTiler' -or $_.Name -eq 'qtiler.exe' -or $_.DisplayName -eq 'QTiler' } |
    Select-Object -First 1
}

$svcInfo = Get-QtilerServiceInfo

switch ($Action) {
  'find' {
    if ($svcInfo) {
      Write-Output $svcInfo.Name
    }
    exit 0
  }
  'exists' {
    if ($svcInfo) {
      Write-Host "  Existing QTiler service found: $($svcInfo.Name)"
      exit 0
    }
    Write-Host '  No existing QTiler service definition found.'
    exit 2
  }
  'stop' {
    if (-not $svcInfo) {
      Write-Host '  QTiler service is not installed.'
      exit 0
    }
    $svc = Get-Service -Name $svcInfo.Name -ErrorAction Stop
    if ($svc.Status -ne 'Stopped') {
      Stop-Service -Name $svcInfo.Name -Force -ErrorAction Stop
      $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45))
      Write-Host "  Existing QTiler service stopped ($($svcInfo.Name))."
    } else {
      Write-Host "  Existing QTiler service is already stopped ($($svcInfo.Name))."
    }
    exit 0
  }
  'start' {
    $svcInfo = Get-QtilerServiceInfo
    if (-not $svcInfo) {
      Write-Host 'ERROR: QTiler service is not installed.'
      exit 1
    }
    $svc = Get-Service -Name $svcInfo.Name -ErrorAction Stop
    if ($svc.Status -ne 'Running') {
      Start-Service -Name $svcInfo.Name -ErrorAction Stop
      Write-Host "  Service start requested ($($svcInfo.Name))."
    } else {
      Write-Host "  Service already running ($($svcInfo.Name))."
    }
    exit 0
  }
  'wait-removed' {
    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
      if (-not (Get-QtilerServiceInfo)) {
        Write-Host '  Existing QTiler service removed.'
        exit 0
      }
      Start-Sleep -Milliseconds 1000
    }
    Write-Host 'ERROR: QTiler service was not removed within the timeout.'
    exit 1
  }
}