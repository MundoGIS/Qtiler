param(
  [Parameter(Mandatory = $true)] [string] $Root,
  [int] $MajorVersion = 24,
  [string] $SystemNodeExe = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$architecture = switch ($env:PROCESSOR_ARCHITECTURE) {
  'ARM64' { 'arm64' }
  default { 'x64' }
}
$runtimeRoot = Join-Path $Root 'runtime\node'
$nodeExe = Join-Path $runtimeRoot 'node.exe'
$npmCli = Join-Path $runtimeRoot 'node_modules\npm\bin\npm-cli.js'

function Get-NodeVersion {
  param([Parameter(Mandatory = $true)] [string] $Executable)

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $Executable
  $startInfo.Arguments = '-p "process.versions.node"'
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) { return $null }
    if (-not $process.WaitForExit(5000)) {
      try { $process.Kill() } catch {}
      return $null
    }
    if ($process.ExitCode -ne 0) { return $null }
    return $process.StandardOutput.ReadToEnd().Trim()
  } finally {
    $process.Dispose()
  }
}

function Get-CompatibleSystemNode {
  $candidate = $SystemNodeExe
  if ([string]::IsNullOrWhiteSpace($candidate)) {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command) { $candidate = $command.Source }
  }
  if ([string]::IsNullOrWhiteSpace($candidate) -or -not (Test-Path -LiteralPath $candidate)) {
    return $null
  }
  try {
    $version = Get-NodeVersion -Executable $candidate
    if ([string]::IsNullOrWhiteSpace($version)) { return $null }
    $major = [int]($version.Split('.')[0])
    $candidateNpmCli = Join-Path (Split-Path -Parent $candidate) 'node_modules\npm\bin\npm-cli.js'
    if ($major -eq $MajorVersion -and (Test-Path -LiteralPath $candidateNpmCli)) {
      return @{
        NodeExe = (Resolve-Path -LiteralPath $candidate).Path
        NpmCli = (Resolve-Path -LiteralPath $candidateNpmCli).Path
        Version = "v$version"
      }
    }
  } catch {
    return $null
  }
  return $null
}

$systemNode = Get-CompatibleSystemNode
if ($systemNode) {
  $npmVersion = (& $systemNode.NodeExe $systemNode.NpmCli -v).Trim()
  Write-Output "QTILER_NODE_EXE=$($systemNode.NodeExe)"
  Write-Output "QTILER_NPM_CLI=$($systemNode.NpmCli)"
  Write-Output "QTILER_NODE_VERSION=$($systemNode.Version)"
  Write-Output "QTILER_NPM_VERSION=$npmVersion"
  exit 0
}

function Test-CompatibleNode {
  if (-not (Test-Path -LiteralPath $nodeExe) -or -not (Test-Path -LiteralPath $npmCli)) {
    return $false
  }
  try {
    $version = Get-NodeVersion -Executable $nodeExe
    if ([string]::IsNullOrWhiteSpace($version)) { return $false }
    return [int]($version.Split('.')[0]) -eq $MajorVersion
  } catch {
    return $false
  }
}

if (-not (Test-CompatibleNode)) {
  $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
  $release = $index |
    Where-Object { $_.version -match "^v$MajorVersion\." -and $_.lts } |
    Select-Object -First 1
  if (-not $release) {
    throw "No Node.js $MajorVersion LTS release was found."
  }

  $archiveName = "node-$($release.version)-win-$architecture.zip"
  $baseUrl = "https://nodejs.org/dist/$($release.version)"
  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("qtiler-node-" + [guid]::NewGuid().ToString('N'))
  $archivePath = Join-Path $tempRoot $archiveName
  $extractRoot = Join-Path $tempRoot 'extract'
  try {
    New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
    Invoke-WebRequest -Uri "$baseUrl/$archiveName" -OutFile $archivePath -UseBasicParsing
    $checksums = (Invoke-WebRequest -Uri "$baseUrl/SHASUMS256.txt" -UseBasicParsing).Content
    $checksumMatch = [regex]::Match($checksums, "(?im)^([a-f0-9]{64})\s+$([regex]::Escape($archiveName))$")
    if (-not $checksumMatch.Success) {
      throw "SHA-256 checksum was not published for $archiveName."
    }
    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $checksumMatch.Groups[1].Value.ToLowerInvariant()) {
      throw "SHA-256 verification failed for $archiveName."
    }

    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force
    $extracted = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
    if (-not $extracted) {
      throw 'The portable Node.js archive did not contain the expected folder.'
    }
    if (Test-Path -LiteralPath $runtimeRoot) {
      Remove-Item -LiteralPath $runtimeRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $runtimeRoot) -Force | Out-Null
    Move-Item -LiteralPath $extracted.FullName -Destination $runtimeRoot
  } finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if (-not (Test-CompatibleNode)) {
  throw 'Portable Node.js validation failed after installation.'
}

Write-Output "QTILER_NODE_EXE=$nodeExe"
Write-Output "QTILER_NPM_CLI=$npmCli"
Write-Output "QTILER_NODE_VERSION=$(& $nodeExe -p 'process.version')"
Write-Output "QTILER_NPM_VERSION=$(& $nodeExe $npmCli -v)"