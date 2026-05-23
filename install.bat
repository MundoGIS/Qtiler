@echo off
REM ==========================================================================
REM  Qtiler Installer by MundoGIS
REM  Double-click to install. Requires Windows administrator privileges.
REM ==========================================================================
setlocal enabledelayedexpansion
title Qtiler Installer by MundoGIS

REM --- Self-elevate to administrator ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"
set "QTILER_ROOT=%cd%"

echo ================================================================
echo                    Qtiler Installer by MundoGIS
echo ================================================================
echo.

REM ----------------------------------------------------------------------
REM  Step 1: Ask for QGIS Desktop installation path (popup window)
REM ----------------------------------------------------------------------
:ask_qgis
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::InputBox('Please enter the full path to your QGIS Desktop installation folder.' + [Environment]::NewLine + [Environment]::NewLine + 'IMPORTANT: Qtiler requires QGIS 3.x (for example 3.34 LTR or 3.40).' + [Environment]::NewLine + 'QGIS 4.x is NOT supported.' + [Environment]::NewLine + [Environment]::NewLine + 'Example: C:\Program Files\QGIS 3.40' + [Environment]::NewLine + [Environment]::NewLine + 'Add the path to QGIS Desktop and click Enter.', 'Qtiler Installer - QGIS Desktop Path', 'C:\Program Files\QGIS 3.40')"`) do set "QGIS_ROOT=%%I"

if not defined QGIS_ROOT (
    echo Installation cancelled by user.
    pause
    exit /b 1
)

REM Strip surrounding quotes and trailing slash
set "QGIS_ROOT=%QGIS_ROOT:"=%"
if "%QGIS_ROOT:~-1%"=="\" set "QGIS_ROOT=%QGIS_ROOT:~0,-1%"

echo Selected QGIS folder: %QGIS_ROOT%
echo.

REM Validate QGIS python.exe
if not exist "%QGIS_ROOT%\bin\python.exe" (
    powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('python.exe was not found at:' + [Environment]::NewLine + '%QGIS_ROOT%\bin\python.exe' + [Environment]::NewLine + [Environment]::NewLine + 'Please select a valid QGIS 3.x installation folder.', 'Qtiler Installer - Invalid Path', 'OK', 'Error')" >nul
    goto ask_qgis
)

REM Resolve QGIS prefix (apps\qgis or apps\qgis-ltr)
set "QGIS_PREFIX_DIR="
if exist "%QGIS_ROOT%\apps\qgis-ltr\python" set "QGIS_PREFIX_DIR=%QGIS_ROOT%\apps\qgis-ltr"
if not defined QGIS_PREFIX_DIR if exist "%QGIS_ROOT%\apps\qgis\python" set "QGIS_PREFIX_DIR=%QGIS_ROOT%\apps\qgis"

if not defined QGIS_PREFIX_DIR (
    powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('QGIS apps folder not found under:' + [Environment]::NewLine + '%QGIS_ROOT%\apps' + [Environment]::NewLine + [Environment]::NewLine + 'Please select a valid QGIS 3.x installation folder.', 'Qtiler Installer - Invalid Path', 'OK', 'Error')" >nul
    goto ask_qgis
)

REM Detect QGIS major version from qgis-bin.exe metadata
set "QGIS_MAJOR=0"
for /f "usebackq delims=" %%V in (`powershell -NoProfile -Command "try { (Get-Item '%QGIS_ROOT%\bin\qgis-bin.exe' -ErrorAction Stop).VersionInfo.FileMajorPart } catch { try { (Get-Item '%QGIS_ROOT%\bin\qgis-bin-ltr.exe' -ErrorAction Stop).VersionInfo.FileMajorPart } catch { 0 } }"`) do set "QGIS_MAJOR=%%V"

if "%QGIS_MAJOR%"=="4" (
    powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Detected QGIS 4.x at the selected folder.' + [Environment]::NewLine + [Environment]::NewLine + 'Qtiler requires QGIS 3.x (for example 3.34 LTR or 3.40).' + [Environment]::NewLine + 'Please install QGIS 3.x and run this installer again.', 'Qtiler Installer - Unsupported QGIS Version', 'OK', 'Error')" >nul
    exit /b 1
)

echo QGIS validated (major version: %QGIS_MAJOR%, prefix: %QGIS_PREFIX_DIR%).
echo.

REM ----------------------------------------------------------------------
REM  Step 1b: Ask for Qtiler HTTP port (popup window)
REM ----------------------------------------------------------------------
set "QTILER_PORT_DEFAULT=3000"
if exist "%QTILER_ROOT%\.env" (
    for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b /c:"PORT=" "%QTILER_ROOT%\.env" 2^>nul`) do (
        if /i "%%A"=="PORT" set "QTILER_PORT_DEFAULT=%%B"
    )
)

:ask_port
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::InputBox('Please choose the HTTP port Qtiler should use.' + [Environment]::NewLine + [Environment]::NewLine + 'Use a free TCP port between 1 and 65535.' + [Environment]::NewLine + 'Default: %QTILER_PORT_DEFAULT%' + [Environment]::NewLine + [Environment]::NewLine + 'Examples: 3000, 3080, 8080', 'Qtiler Installer - HTTP Port', '%QTILER_PORT_DEFAULT%')"`) do set "QTILER_PORT=%%I"

if not defined QTILER_PORT (
    echo Installation cancelled by user.
    pause
    exit /b 1
)

set "QTILER_PORT=%QTILER_PORT: =%"
set "QTILER_PORT=%QTILER_PORT:"=%"
for /f "delims=0123456789" %%A in ("%QTILER_PORT%") do set "QTILER_PORT_INVALID=%%A"
if defined QTILER_PORT_INVALID goto invalid_port
if "%QTILER_PORT%"=="" goto invalid_port
if %QTILER_PORT% LSS 1 goto invalid_port
if %QTILER_PORT% GTR 65535 goto invalid_port
goto port_ok

:invalid_port
set "QTILER_PORT_INVALID="
powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('The port must be a number between 1 and 65535.' + [Environment]::NewLine + [Environment]::NewLine + 'Please choose a valid HTTP port for Qtiler.', 'Qtiler Installer - Invalid Port', 'OK', 'Error')" >nul
goto ask_port

:port_ok
set "QTILER_PORT_INVALID="
echo Selected Qtiler HTTP port: %QTILER_PORT%
echo.

REM Resolve Qt plugin path (qt5 preferred, qt6 fallback)
set "QT_PLUGINS_DIR=%QGIS_PREFIX_DIR%\qtplugins"
if exist "%QGIS_ROOT%\apps\qt5\plugins" set "QT_PLUGINS_DIR=%QGIS_PREFIX_DIR%\qtplugins;%QGIS_ROOT%\apps\qt5\plugins"
if exist "%QGIS_ROOT%\apps\qt6\plugins" set "QT_PLUGINS_DIR=%QGIS_PREFIX_DIR%\qtplugins;%QGIS_ROOT%\apps\qt6\plugins"

REM ----------------------------------------------------------------------
REM  Step 2: Update .env so Qtiler service can locate QGIS at runtime
REM          Preserves existing keys (tuning, secrets, etc.). A timestamped
REM          backup is created before any modification.
REM ----------------------------------------------------------------------
echo [Qtiler] Updating .env (preserving existing values) ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$envFile = Join-Path '%QTILER_ROOT%' '.env';" ^
  "$qtilerRoot = '%QTILER_ROOT%';" ^
  "$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source; if (-not $nodeExe) { $nodeExe = 'C:\Program Files\nodejs\node.exe' };" ^
    "$updates = [ordered]@{ PORT = '%QTILER_PORT%'; PYTHON_EXE = '%QGIS_ROOT%\bin\python.exe'; OSGEO4W_BIN = '%QGIS_ROOT%\bin'; QGIS_PREFIX = '%QGIS_PREFIX_DIR%'; QT_PLUGIN_PATH = '%QT_PLUGINS_DIR%'; PYTHONPATH = '%QGIS_PREFIX_DIR%\python'; QTILER_HOME = $qtilerRoot; NODE_EXE = $nodeExe; QUANTIZED_MESH_BUILD_CMD = ('%QGIS_ROOT%\bin\python.exe ' + (Join-Path $qtilerRoot 'tools\mesh_build.py')); QUANTIZED_MESH_ENGINE_CMD = ($nodeExe + ' ' + (Join-Path $qtilerRoot 'tools\mesh_dem_to_terrain_runner.mjs')); QUANTIZED_MESH_ENGINE_MODULE = (Join-Path $qtilerRoot 'ThirdParty\mesh-dem-to-terrain\dist\index.js') };" ^
  "if (Test-Path $envFile) { $ts = Get-Date -Format 'yyyyMMdd_HHmmss'; Copy-Item $envFile ($envFile + '.bak.' + $ts) -Force; $lines = Get-Content -LiteralPath $envFile } elseif (Test-Path (Join-Path $qtilerRoot '.env.example')) { $lines = Get-Content -LiteralPath (Join-Path $qtilerRoot '.env.example') } else { $lines = @('# Qtiler environment configuration - generated by install.bat') };" ^
  "$out = New-Object System.Collections.Generic.List[string]; $seen = @{};" ^
  "foreach ($line in $lines) { $m = [regex]::Match($line, '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*='); if ($m.Success -and $updates.Contains($m.Groups[1].Value)) { $k = $m.Groups[1].Value; $out.Add($k + '=' + $updates[$k]); $seen[$k] = $true } else { $patched = $line -ireplace [regex]::Escape('C:\Qtiler'), $qtilerRoot; $out.Add($patched) } };" ^
  "foreach ($k in $updates.Keys) { if (-not $seen.ContainsKey($k)) { $out.Add($k + '=' + $updates[$k]) } };" ^
  "Set-Content -LiteralPath $envFile -Value $out -Encoding UTF8"
if errorlevel 1 (
    echo ERROR: failed to update .env.
    pause
    exit /b 1
)
echo .env updated. Existing tuning and secrets preserved.
echo.

REM ----------------------------------------------------------------------
REM  Step 3: Ensure Node.js (latest LTS) is installed
REM ----------------------------------------------------------------------
where node >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%v in ('node -v') do set "NODE_VER=%%v"
    echo Node.js detected: !NODE_VER!
) else (
    echo Node.js not found. Downloading the latest LTS installer...
    set "NODE_MSI=%TEMP%\nodejs_lts_x64.msi"
    if exist "!NODE_MSI!" del /q "!NODE_MSI!" >nul 2>&1
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try { $lts = (Invoke-RestMethod 'https://nodejs.org/dist/index.json') | Where-Object { $_.lts } | Select-Object -First 1; $url = 'https://nodejs.org/dist/' + $lts.version + '/node-' + $lts.version + '-x64.msi'; Write-Host ('Downloading ' + $url); Invoke-WebRequest -Uri $url -OutFile '%TEMP%\nodejs_lts_x64.msi' -UseBasicParsing } catch { Write-Host ('ERROR: ' + $_.Exception.Message); exit 1 }"
    if not exist "!NODE_MSI!" (
        echo ERROR: Failed to download Node.js installer. Please install Node.js LTS manually from https://nodejs.org and re-run this installer.
        pause
        exit /b 1
    )
    echo Installing Node.js silently. This may take a few minutes...
    msiexec /i "!NODE_MSI!" /qn /norestart
    if errorlevel 1 (
        echo ERROR: Node.js installation failed ^(msiexec exit code %errorlevel%^).
        pause
        exit /b 1
    )
    REM Refresh PATH from registry so node/npm are visible in this shell
    for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%b"
    set "PATH=!SYS_PATH!;%ProgramFiles%\nodejs;%PATH%"
    where node >nul 2>&1
    if errorlevel 1 (
        echo Node.js installed, but not visible in this shell.
        echo Please close this window, open a new one, and run install.bat again.
        pause
        exit /b 1
    )
    for /f "tokens=*" %%v in ('node -v') do set "NODE_VER=%%v"
    echo Node.js installed: !NODE_VER!
)

echo.

REM ----------------------------------------------------------------------
REM  Step 4: Install Qtiler npm dependencies
REM ----------------------------------------------------------------------
echo [Qtiler] Installing Node.js dependencies ^(npm install^)...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
)
echo.

REM ----------------------------------------------------------------------
REM  Step 4b: Ensure QtilerAuth plugin is enabled (90-day trial auto-issued)
REM ----------------------------------------------------------------------
echo [Qtiler] Enabling QtilerAuth plugin ^(90-day trial license^)...
if not exist data mkdir data >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='data\plugins.json'; if (Test-Path $f) { try { $j = Get-Content $f -Raw | ConvertFrom-Json } catch { $j = [pscustomobject]@{ enabled=@() } } } else { $j = [pscustomobject]@{ enabled=@() } }; if (-not $j.enabled) { $j | Add-Member -NotePropertyName enabled -NotePropertyValue @() -Force }; $list = @($j.enabled); if ($list -notcontains 'QtilerAuth') { $list += 'QtilerAuth'; $j.enabled = $list; $json = ($j | ConvertTo-Json -Depth 10); [System.IO.File]::WriteAllText((Resolve-Path $f), $json, (New-Object System.Text.UTF8Encoding $false)); Write-Host '  QtilerAuth added to enabled plugins.' } else { Write-Host '  QtilerAuth already enabled.' }"
echo.

REM ----------------------------------------------------------------------
REM  Step 5: Install Qtiler as a Windows service
REM ----------------------------------------------------------------------
echo [Qtiler] Installing Qtiler as a Windows service...
node service\install-service.js
if errorlevel 1 (
    echo ERROR: Windows service installation failed.
    pause
    exit /b 1
)
echo.

REM ----------------------------------------------------------------------
REM  Step 6: Success notification
REM ----------------------------------------------------------------------
powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Congratulations! You have successfully installed Qtiler.' + [Environment]::NewLine + [Environment]::NewLine + 'If you have any questions or need technical assistance, please contact MundoGIS at support@mundogis.se and we will reply within 24 hours.', 'Qtiler Installation Complete', 'OK', 'Information')" >nul

echo ================================================================
echo  Congratulations! You have successfully installed Qtiler.
echo.
echo  If you have any questions or need technical assistance,
echo  please contact MundoGIS at support@mundogis.se
echo  and we will reply within 24 hours.
echo ================================================================
echo.
pause
endlocal
exit /b 0
