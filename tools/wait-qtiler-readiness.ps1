[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 65535)]
  [int]$Port,
  [switch]$RequireAuth,
  [ValidateRange(1, 1800)]
  [int]$TimeoutSeconds = 300
)

$ErrorActionPreference = 'Stop'
$rootUrl = "http://127.0.0.1:$Port/"
$authUrl = "http://127.0.0.1:$Port/auth/login-status"
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$rootReady = $false
$authReady = -not $RequireAuth
$lastRootStatus = $null
$lastRootError = $null
$lastAuthStatus = $null
$lastAuthError = $null
$authBody = '{"username":"__installer_probe__"}'

while ((Get-Date) -lt $deadline) {
  if (-not $rootReady) {
    try {
      $rootResponse = Invoke-WebRequest -Uri $rootUrl -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0 -ErrorAction Stop
      $lastRootStatus = [int]$rootResponse.StatusCode
      $rootReady = $lastRootStatus -ge 200 -and $lastRootStatus -lt 500
    } catch {
      $rootResponse = $_.Exception.Response
      if ($rootResponse) {
        $lastRootStatus = [int]$rootResponse.StatusCode
        $rootReady = $lastRootStatus -ge 200 -and $lastRootStatus -lt 500
      } else {
        $lastRootError = $_.Exception.Message
      }
    }
  }

  if ($RequireAuth -and $rootReady -and -not $authReady) {
    try {
      $authResponse = Invoke-WebRequest -Uri $authUrl -Method Post -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0 -ContentType 'application/json' -Body $authBody -ErrorAction Stop
      $lastAuthStatus = [int]$authResponse.StatusCode
      if ($lastAuthStatus -eq 200) {
        $authPayload = $authResponse.Content | ConvertFrom-Json -ErrorAction Stop
        $authReady = $null -ne $authPayload -and $authPayload.PSObject.Properties.Name -contains 'requireCaptcha'
      } elseif ($lastAuthStatus -eq 429) {
        $authReady = $true
      }
    } catch {
      $authResponse = $_.Exception.Response
      if ($authResponse) {
        $lastAuthStatus = [int]$authResponse.StatusCode
        if ($lastAuthStatus -eq 429) { $authReady = $true }
      } else {
        $lastAuthError = $_.Exception.Message
      }
    }
  }

  if ($rootReady -and $authReady) { break }
  Start-Sleep -Milliseconds 2000
}

if (-not $rootReady) {
  Write-Host "ERROR: Qtiler did not become ready at $rootUrl within $TimeoutSeconds seconds."
  if ($lastRootStatus) { Write-Host "Last Qtiler HTTP status: $lastRootStatus" }
  if ($lastRootError) { Write-Host "Last Qtiler connection error: $lastRootError" }
  exit 1
}
Write-Host "  Qtiler is responding at $rootUrl"

if ($RequireAuth -and -not $authReady) {
  Write-Host "ERROR: QtilerAuth did not become ready at $authUrl within $TimeoutSeconds seconds."
  if ($lastAuthStatus) { Write-Host "Last QtilerAuth HTTP status: $lastAuthStatus" }
  if ($lastAuthStatus -eq 404) { Write-Host "The Auth route is not registered. Check service logs for 'Failed to load plugin QtilerAuth' and verify the plugin and its license state." }
  if ($lastAuthStatus -ge 500) { Write-Host "The Auth route returned a server error. Check the QtilerAuth startup error in the service logs." }
  if ($lastAuthError) { Write-Host "Last QtilerAuth connection error: $lastAuthError" }
  exit 1
}

if ($RequireAuth) {
  Write-Host "  QtilerAuth is responding at $authUrl"
} else {
  Write-Host '  QtilerAuth readiness skipped because it is not enabled by the preserved license state.'
}