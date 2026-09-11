param(
  [Parameter(Mandatory = $true)] [string] $Path
)

$ErrorActionPreference = 'Stop'
$inputPath = [System.IO.Path]::GetFullPath($Path.Trim().Trim('"').TrimEnd('\'))
$candidates = New-Object System.Collections.Generic.List[string]
$leaf = Split-Path -Leaf $inputPath
if ($leaf -match '^qgis(-ltr)?$') {
  $candidates.Add((Split-Path -Parent (Split-Path -Parent $inputPath)))
}
if ((Split-Path -Leaf (Split-Path -Parent $inputPath)) -eq 'apps') {
  $candidates.Add((Split-Path -Parent (Split-Path -Parent $inputPath)))
}
$candidates.Add($inputPath)

foreach ($root in ($candidates | Select-Object -Unique)) {
  if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
  $prefixes = @(
    (Join-Path $root 'apps\qgis-ltr'),
    (Join-Path $root 'apps\qgis')
  )
  $prefixes += @(Get-ChildItem (Join-Path $root 'apps\qgis*') -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
  if ($leaf -match '^qgis(-ltr)?$' -and $root -eq $inputPath) { $prefixes = @($root) }
  foreach ($prefix in ($prefixes | Select-Object -Unique)) {
    if (-not (Test-Path (Join-Path $prefix 'python') -PathType Container)) { continue }
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
