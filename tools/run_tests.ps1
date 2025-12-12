param(
  [switch]$WithRedis
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path -LiteralPath "$(Split-Path -Parent $MyInvocation.MyCommand.Definition)\.."
Set-Location $root

$dockerStarted = $false
$serverProc = $null

try {
  if ($WithRedis) {
    Write-Host "Starting Redis via Docker..."
    $existing = docker ps -a --filter "name=qtiler-redis" --format "{{.ID}}" 2>$null
    if (-not $existing) {
      docker run -d --name qtiler-redis -p 6379:6379 redis:7 | Out-Null
      Start-Sleep -Seconds 1
      $dockerStarted = $true
    } else {
      Write-Host "Redis container already exists. Starting it if stopped."
      docker start qtiler-redis | Out-Null
      $dockerStarted = $true
    }
    $env:GLOBAL_JOB_MAX = "3"
    $env:REDIS_URL = "redis://127.0.0.1:6379"
  }

  Write-Host "Starting server (background)..."
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { throw "node not found on PATH" }
  $startInfo = Start-Process -FilePath $node.Path -ArgumentList '--max-old-space-size=8192','server.js' -WorkingDirectory $root -PassThru
  $serverProc = $startInfo

  Write-Host "Waiting for server on port 3000..."
  $ready = $false
  for ($i=0; $i -lt 30; $i++) {
    try {
      $res = Test-NetConnection -ComputerName 127.0.0.1 -Port 3000 -WarningAction SilentlyContinue
      if ($res -and $res.TcpTestSucceeded) { $ready = $true; break }
    } catch { }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw "Server not responding on port 3000 after timeout" }
  Write-Host "Server is up. Running JS test script..."

  $nodeTest = Get-Command node -ErrorAction SilentlyContinue
  & $nodeTest.Path "tools/test_post_http.js"

  Write-Host "Test script finished."
} catch {
  Write-Error "Test run failed: $_"
} finally {
  if ($serverProc) {
    try {
      Write-Host "Stopping server (PID $($serverProc.Id))..."
      Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
    } catch {
      Write-Warning "Failed to stop server process: $_"
    }
  }
  if ($dockerStarted) {
    try {
      Write-Host "Stopping Redis container..."
      docker stop qtiler-redis | Out-Null
      docker rm qtiler-redis | Out-Null
    } catch {
      Write-Warning "Failed to stop/remove redis container: $_"
    }
  }
}
