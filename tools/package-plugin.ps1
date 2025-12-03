# Script para empaquetar un plugin en formato ZIP
# Uso: .\tools\package-plugin.ps1 -PluginName QtilerAuth

param(
    [Parameter(Mandatory=$true)]
    [string]$PluginName,
    
    [Parameter(Mandatory=$false)]
    [string]$OutputDir = ".\dist"
)

$ErrorActionPreference = "Stop"

# Paths
$candidatePaths = @(
    (Join-Path $PSScriptRoot "..\plugins\$PluginName")
    (Join-Path $PSScriptRoot "..\temp_zip\$PluginName")
    (Join-Path $PSScriptRoot "..\temp_zip")
)

$pluginPath = $null
foreach ($candidate in $candidatePaths) {
    if (Test-Path $candidate) {
        $pluginPath = $candidate
        break
    }
}

$outputPath = Join-Path $PSScriptRoot "..\$OutputDir"
$zipFile = Join-Path $outputPath "$PluginName.zip"

# Verificar que el plugin existe
if (-not $pluginPath) {
    Write-Error "Plugin no encontrado en 'plugins/$PluginName' ni en 'temp_zip'"
    exit 1
}

if ($pluginPath -like "*temp_zip*") {
    Write-Host "Usando fuente desde: $pluginPath" -ForegroundColor Yellow
}

# Crear directorio de salida si no existe
if (-not (Test-Path $outputPath)) {
    New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
}

# Eliminar ZIP anterior si existe
if (Test-Path $zipFile) {
    Remove-Item $zipFile -Force
    Write-Host "ZIP anterior eliminado: $zipFile" -ForegroundColor Yellow
}

# Crear el ZIP
Write-Host "Empaquetando plugin '$PluginName'..." -ForegroundColor Cyan

try {
    # Comprimir el directorio del plugin
    Compress-Archive -Path "$pluginPath\*" -DestinationPath $zipFile -CompressionLevel Optimal
    
    $fileSize = (Get-Item $zipFile).Length
    $fileSizeKB = [math]::Round($fileSize / 1KB, 2)
    
    Write-Host "Plugin empaquetado exitosamente" -ForegroundColor Green
    Write-Host "  Archivo: $zipFile" -ForegroundColor Gray
    Write-Host "  Tamano: $fileSizeKB KB" -ForegroundColor Gray
    
} catch {
    Write-Error "Error al crear el ZIP: $($_.Exception.Message)"
    exit 1
}
