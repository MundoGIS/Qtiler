param(
  [Parameter(Mandatory = $true)] [string] $SourceRoot,
  [Parameter(Mandatory = $true)] [string] $BackupRoot,
  [string] $DestinationRoot = '',
  [string] $ReplacedBackupRoot = ''
)

$ErrorActionPreference = 'Stop'

$preserveDirs = @('data', 'cache', 'qgisprojects', 'config', 'logs', 'temp_uploads')
$preserveFiles = @('.env', 'auth.db', 'symbology-style.db')
$bundledPlugins = @('Qrigo', 'Qtiler2Origo', 'Qtiler2Hajk', 'Qtiler2qwc', 'QtilerAuth')
$bundledDataBuildDirs = @(
  'data\Qtiler2Hajk\hajk\current',
  'data\Qtiler2Origo\origo\current',
  'data\Qtiler2qwc\qwc2\current'
)

function Convert-ToRobocopyExcludePath {
  param(
    [Parameter(Mandatory = $true)] [string] $RelativePath
  )

  return $RelativePath -replace '/', '\'
}

function Copy-DirectoryRobust {
  param(
    [Parameter(Mandatory = $true)] [string] $Source,
    [Parameter(Mandatory = $true)] [string] $Destination,
    [Parameter(Mandatory = $true)] [string] $Label,
    [string[]] $ExcludeDirs = @()
  )

  if (-not (Test-Path -LiteralPath $Source)) {
    return
  }

  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  $args = @($Source, $Destination, '/E', '/XJ', '/R:2', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
  if ($ExcludeDirs.Count -gt 0) {
    $args += '/XD'
    $args += $ExcludeDirs
  }
  & robocopy @args | Out-Host
  $code = $LASTEXITCODE
  if ($code -ge 8) {
    throw "robocopy failed for $Label with exit code $code"
  }
  Write-Host "  $Label"
}

function Copy-FileRobust {
  param(
    [Parameter(Mandatory = $true)] [string] $Source,
    [Parameter(Mandatory = $true)] [string] $Destination,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  if (-not (Test-Path -LiteralPath $Source)) {
    return
  }

  New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Force -ErrorAction Stop
  Write-Host "  $Label"
}

function Move-ExistingPath {
  param(
    [Parameter(Mandatory = $true)] [string] $PathToMove,
    [Parameter(Mandatory = $true)] [string] $BackupPath
  )

  if (-not (Test-Path -LiteralPath $PathToMove)) {
    return
  }

  New-Item -ItemType Directory -Path (Split-Path -Parent $BackupPath) -Force | Out-Null
  Move-Item -LiteralPath $PathToMove -Destination $BackupPath -Force -ErrorAction Stop
}

if (-not (Test-Path -LiteralPath $SourceRoot)) {
  throw "Source Qtiler root was not found: $SourceRoot"
}

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null

foreach ($name in $preserveDirs) {
  $excludeDirs = @()
  if ($name -eq 'data') {
    $excludeDirs = $bundledDataBuildDirs | ForEach-Object { Join-Path $SourceRoot (Convert-ToRobocopyExcludePath $_) }
  }
  Copy-DirectoryRobust `
    -Source (Join-Path $SourceRoot $name) `
    -Destination (Join-Path $BackupRoot $name) `
    -Label "Backed up directory: $name" `
    -ExcludeDirs $excludeDirs
}

foreach ($name in $preserveFiles) {
  Copy-FileRobust `
    -Source (Join-Path $SourceRoot $name) `
    -Destination (Join-Path $BackupRoot $name) `
    -Label "Backed up file: $name"
}

$sourcePlugins = Join-Path $SourceRoot 'plugins'
if (Test-Path -LiteralPath $sourcePlugins) {
  foreach ($plugin in Get-ChildItem -LiteralPath $sourcePlugins -Directory) {
    if ($bundledPlugins -contains $plugin.Name) {
      continue
    }
    Copy-DirectoryRobust `
      -Source $plugin.FullName `
      -Destination (Join-Path (Join-Path $BackupRoot 'plugins') $plugin.Name) `
      -Label "Backed up custom plugin: $($plugin.Name)"
  }
}

Write-Host "  Backup of runtime data: $BackupRoot"

if ([string]::IsNullOrWhiteSpace($DestinationRoot) -or ((Resolve-Path -LiteralPath $SourceRoot).Path -ieq (Resolve-Path -LiteralPath $DestinationRoot -ErrorAction SilentlyContinue).Path)) {
  exit 0
}

foreach ($name in $preserveDirs) {
  $src = Join-Path $SourceRoot $name
  if (-not (Test-Path -LiteralPath $src)) {
    continue
  }
  $dst = Join-Path $DestinationRoot $name
  $excludeDirs = @()
  if ($name -eq 'data') {
    $excludeDirs = $bundledDataBuildDirs | ForEach-Object { Join-Path $SourceRoot (Convert-ToRobocopyExcludePath $_) }
  }
  if ($ReplacedBackupRoot) {
    if ($name -eq 'data') {
      Copy-DirectoryRobust -Source $dst -Destination (Join-Path $ReplacedBackupRoot $name) -Label "Backed up package directory before merge: $name"
    } else {
      Move-ExistingPath -PathToMove $dst -BackupPath (Join-Path $ReplacedBackupRoot $name)
    }
  }
  Copy-DirectoryRobust -Source $src -Destination $dst -Label "Restored directory: $name" -ExcludeDirs $excludeDirs
}

foreach ($name in $preserveFiles) {
  $src = Join-Path $SourceRoot $name
  if (-not (Test-Path -LiteralPath $src)) {
    continue
  }
  $dst = Join-Path $DestinationRoot $name
  if ($ReplacedBackupRoot) {
    Move-ExistingPath -PathToMove $dst -BackupPath (Join-Path $ReplacedBackupRoot $name)
  }
  Copy-FileRobust -Source $src -Destination $dst -Label "Restored file: $name"
}

if (Test-Path -LiteralPath $sourcePlugins) {
  $destPlugins = Join-Path $DestinationRoot 'plugins'
  New-Item -ItemType Directory -Path $destPlugins -Force | Out-Null
  foreach ($plugin in Get-ChildItem -LiteralPath $sourcePlugins -Directory) {
    if ($bundledPlugins -contains $plugin.Name) {
      continue
    }
    $dst = Join-Path $destPlugins $plugin.Name
    if (-not (Test-Path -LiteralPath $dst)) {
      Copy-DirectoryRobust -Source $plugin.FullName -Destination $dst -Label "Restored custom plugin: $($plugin.Name)"
    }
  }
}

Write-Host '  Runtime state copy complete.'