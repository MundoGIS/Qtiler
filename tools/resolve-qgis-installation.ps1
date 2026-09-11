param(
  [Parameter(Mandatory = $true)] [string] $Path
)

$ErrorActionPreference = 'Stop'
$inputPath = [System.IO.Path]::GetFullPath($Path.Trim().Trim('"'))
$driveRoot = [System.IO.Path]::GetPathRoot($inputPath)
if ($inputPath -ne $driveRoot) { $inputPath = $inputPath.TrimEnd('\') }
$candidates = New-Object System.Collections.Generic.List[string]
$probe = $inputPath
for ($level = 0; $level -lt 5; $level++) {
  if ((Test-Path (Join-Path $probe 'apps') -PathType Container) -and
      (Test-Path (Join-Path $probe 'bin') -PathType Container)) {
    $candidates.Add($probe)
  }
  $parent = Split-Path -Parent $probe
  if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $probe) { break }
  $probe = $parent
}
$candidates.Add($inputPath)
$ancestor = $inputPath
for ($level = 0; $level -lt 5; $level++) {
  $parent = Split-Path -Parent $ancestor
  if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $ancestor) { break }
  $candidates.Add($parent)
  $ancestor = $parent
}
if (Test-Path -LiteralPath $inputPath -PathType Container) {
  Get-ChildItem -LiteralPath $inputPath -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^(QGIS|OSGeo4W)' } |
    ForEach-Object { $candidates.Add($_.FullName) }
}

foreach ($root in ($candidates | Select-Object -Unique)) {
  if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
  $prefixes = @(
    (Join-Path $root 'apps\qgis-ltr'),
    (Join-Path $root 'apps\qgis')
  )
  $prefixes += @(Get-ChildItem (Join-Path $root 'apps\qgis*') -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
  if ((Split-Path -Leaf $root) -match '^qgis(-ltr)?$') { $prefixes = @($root) + $prefixes }
  foreach ($prefix in ($prefixes | Select-Object -Unique)) {
    $hasQgisRuntime = (Test-Path (Join-Path $prefix 'python') -PathType Container) -or
      (Test-Path (Join-Path $prefix 'bin\qgis-bin.exe') -PathType Leaf) -or
      (Test-Path (Join-Path $root 'bin\qgis-bin.exe') -PathType Leaf) -or
      (Test-Path (Join-Path $root 'bin\qgis-bin-ltr.exe') -PathType Leaf)
    if (-not $hasQgisRuntime) { continue }
    $pythonCandidates = @(
      (Join-Path $root 'bin\python.exe'),
      (Join-Path $root 'bin\python3.exe')
    )
    $pythonCandidates += @(Get-ChildItem (Join-Path $root 'apps\Python*\python.exe') -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
    $pythonCandidates += @(Get-ChildItem (Join-Path (Split-Path -Parent $prefix) 'Python*\python.exe') -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
    $python = $pythonCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    $bin = Join-Path $root 'bin'
    $wrapper = @(
      (Join-Path $bin 'python-qgis-ltr.bat'),
      (Join-Path $bin 'python-qgis.bat')
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if ($python -or $wrapper) {
      Write-Output ('QGIS_ROOT=' + $root)
      Write-Output ('QGIS_PREFIX=' + $prefix)
      Write-Output ('PYTHON_EXE=' + $(if ($python) { $python } else { $wrapper }))
      Write-Output ('OSGEO4W_BIN=' + $(if (Test-Path (Join-Path $bin 'o4w_env.bat')) { $bin } else { '' }))
      exit 0
    }
  }
}

Write-Error "No QGIS Python installation was found below '$Path'. Select the QGIS installation root, its apps\qgis-ltr folder, or an OSGeo4W root."
exit 1
