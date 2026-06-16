@echo off
REM ==========================================================================
REM  Qtiler Installer by MundoGIS
REM  Double-click to install. Requires Windows administrator privileges.
REM ==========================================================================
setlocal enabledelayedexpansion
title Qtiler Installer by MundoGIS

set "QTILER_ELEVATED_ARG="
if /i "%~1"=="--elevated" (
    set "QTILER_ELEVATED_ARG=--elevated"
    shift
)

REM --- Self-elevate to administrator ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    echo A new elevated installer window should open. Keep that window open for installation messages.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$bat = '%~f0'; $work = '%~dp0'; $q = [char]34; $cmd = 'call ' + $q + $bat + $q + ' --elevated'; Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/k', $cmd) -WorkingDirectory $work -Verb RunAs"
    if errorlevel 1 (
        echo ERROR: Could not request administrator privileges.
        echo Right-click install.bat and choose Run as administrator.
        pause
        exit /b 1
    )
    exit /b
)

cd /d "%~dp0"
if errorlevel 1 (
    echo ERROR: Could not enter installer folder: %~dp0
    echo Right-click install.bat from the Qtiler folder and choose Run as administrator.
    pause
    exit /b 1
)
set "QTILER_ROOT=%cd%"
set "QTILER_LOG_DIR=%QTILER_ROOT%\logs"
set "QTILER_INSTALL_LOG=%QTILER_LOG_DIR%\install.log"
set "QTILER_SETUP_MODE=new"
set "QTILER_PREVIOUS_ROOT="
set "QTILER_EXISTING_ADMIN_PASSWORD="
set "QTILER_ADMIN_PASSWORD="
set "QTILER_ADMIN_PASSWORD_DISPLAY="
set "QTILER_ADMIN_PASSWORD_PRESERVE=0"
set "QTILERAUTH_EXPECTED=1"
set "QTILERAUTH_INSTALL_STATUS="

echo ================================================================
echo                    Qtiler Installer by MundoGIS
echo ================================================================
echo.

if not exist "%QTILER_LOG_DIR%" mkdir "%QTILER_LOG_DIR%" >nul 2>&1
>>"%QTILER_INSTALL_LOG%" echo.
>>"%QTILER_INSTALL_LOG%" echo ================================================================
>>"%QTILER_INSTALL_LOG%" echo Qtiler install started %date% %time%
>>"%QTILER_INSTALL_LOG%" echo Root: %QTILER_ROOT%
echo Installer log: %QTILER_INSTALL_LOG%
echo.

REM ----------------------------------------------------------------------
REM  Preflight: verify local installer requirements before interactive setup
REM ----------------------------------------------------------------------
echo [Qtiler] Checking installer requirements...
where powershell >nul 2>&1
if errorlevel 1 (
    echo ERROR: Windows PowerShell was not found in PATH.
    echo Qtiler installer requires PowerShell for dialogs, downloads and service checks.
    >>"%QTILER_INSTALL_LOG%" echo ERROR: PowerShell not found in PATH.
    pause
    exit /b 1
)
if not exist "%QTILER_ROOT%\package.json" goto missing_installer_files
if not exist "%QTILER_ROOT%\server.js" goto missing_installer_files
if not exist "%QTILER_ROOT%\service\install-service.js" goto missing_installer_files
if not exist "%QTILER_ROOT%\service\uninstall-service.js" goto missing_installer_files
if not exist "%QTILER_ROOT%\tools\run_qgis_python.bat" goto missing_installer_files
if not exist "%QTILER_ROOT%\tools\qtilerauth-install-policy.mjs" goto missing_installer_files
if not exist "%QTILER_ROOT%\tools\mesh_build.py" echo WARNING: tools\mesh_build.py was not found. QuantizedMesh builds will not work until it is restored.
if not exist "%QTILER_ROOT%\tools\mesh_dem_to_terrain_runner.mjs" echo WARNING: tools\mesh_dem_to_terrain_runner.mjs was not found. QuantizedMesh builds will not work until it is restored.
echo   Administrator privileges: OK
echo   PowerShell: OK
echo   Required Qtiler files: OK
echo   Node.js: checked before QGIS setup and installed automatically if missing
echo   QGIS Desktop: you will be asked for a QGIS 3.x folder after setup mode is selected
echo.
>>"%QTILER_INSTALL_LOG%" echo Preflight OK.
goto preflight_ok

:missing_installer_files
echo ERROR: This Qtiler folder is incomplete.
echo Required files include package.json, server.js, service scripts and required tools under tools\.
echo Please extract or copy the full Qtiler package and run install.bat again.
>>"%QTILER_INSTALL_LOG%" echo ERROR: Required installer files are missing under %QTILER_ROOT%.
pause
exit /b 1

:preflight_ok
>>"%QTILER_INSTALL_LOG%" echo Step 0: checking existing QTiler Windows service.

REM ----------------------------------------------------------------------
REM  Step 0: Choose install/update mode and locate any previous runtime data
REM ----------------------------------------------------------------------
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$svc = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'QTiler' } | Select-Object -First 1; if (-not $svc) { exit 0 }; $pathName = [string]$svc.PathName; $exe = $null; $m = [regex]::Match($pathName, '\"([^\"]*qtiler\.exe)\"', 'IgnoreCase'); if ($m.Success) { $exe = $m.Groups[1].Value } else { $m = [regex]::Match($pathName, '([^\s]*qtiler\.exe)', 'IgnoreCase'); if ($m.Success) { $exe = $m.Groups[1].Value } }; $root = $null; if ($exe) { $xmlPath = Join-Path (Split-Path -Parent $exe) 'qtiler.xml'; if (Test-Path -LiteralPath $xmlPath) { try { [xml]$xml = Get-Content -LiteralPath $xmlPath -Raw; $root = [string]$xml.service.workingdirectory } catch {} }; if (-not $root) { $root = Split-Path -Parent (Split-Path -Parent $exe) } }; if ($root) { Write-Output $root }"`) do set "QTILER_PREVIOUS_ROOT=%%I"

if defined QTILER_PREVIOUS_ROOT (
    >>"%QTILER_INSTALL_LOG%" echo Existing QTiler service detected at %QTILER_PREVIOUS_ROOT%.
    echo Existing QTiler Windows service detected.
    echo   Current service root: %QTILER_PREVIOUS_ROOT%
    echo   This installer root:  %QTILER_ROOT%
    echo.
    echo U = Update existing installation, preserve .env, users, licenses, uploaded projects, cache and plugin data.
    echo N = New/replacement installation from this folder.
    choice /C UN /N /M "Choose update or new install [U/N]: "
    if errorlevel 2 (
        set "QTILER_SETUP_MODE=new"
    ) else (
        set "QTILER_SETUP_MODE=update"
    )
    >>"%QTILER_INSTALL_LOG%" echo Setup mode selected: !QTILER_SETUP_MODE!.
)

if not defined QTILER_PREVIOUS_ROOT (
    echo No existing QTiler Windows service was detected.
    echo.
    echo N = New installation from this folder.
    echo U = Update an existing installation from another folder and preserve its runtime data.
    choice /C NU /N /M "Choose new install or update [N/U]: "
    if errorlevel 2 (
        set "QTILER_SETUP_MODE=update"
    ) else (
        set "QTILER_SETUP_MODE=new"
    )
    >>"%QTILER_INSTALL_LOG%" echo No existing QTiler service detected. Setup mode selected: !QTILER_SETUP_MODE!.
)

if /i "%QTILER_SETUP_MODE%"=="update" if not defined QTILER_PREVIOUS_ROOT goto ask_previous_root
goto previous_root_ok

:ask_previous_root
echo.
echo [Qtiler] Waiting for previous Qtiler installation folder input...
>>"%QTILER_INSTALL_LOG%" echo Waiting for previous Qtiler installation folder input dialog.
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::InputBox('Enter the full path to the existing Qtiler installation that should be updated.' + [Environment]::NewLine + [Environment]::NewLine + 'The installer will stop the QTiler service if present, back up .env, data, maps, cache, config, uploads, logs and custom plugins, then copy them into this new package.' + [Environment]::NewLine + [Environment]::NewLine + 'Example: C:\Qtiler', 'Qtiler Installer - Previous Installation Path', 'C:\Qtiler')"`) do set "QTILER_PREVIOUS_ROOT=%%I"
if not defined QTILER_PREVIOUS_ROOT (
    echo Installation cancelled by user.
    >>"%QTILER_INSTALL_LOG%" echo Installation cancelled at previous installation folder prompt.
    pause
    exit /b 1
)
set "QTILER_PREVIOUS_ROOT=%QTILER_PREVIOUS_ROOT:"=%"
if "%QTILER_PREVIOUS_ROOT:~-1%"=="\" set "QTILER_PREVIOUS_ROOT=%QTILER_PREVIOUS_ROOT:~0,-1%"
if not exist "%QTILER_PREVIOUS_ROOT%\" (
    >>"%QTILER_INSTALL_LOG%" echo Invalid previous installation folder: %QTILER_PREVIOUS_ROOT%.
    powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('The previous Qtiler folder was not found:' + [Environment]::NewLine + '%QTILER_PREVIOUS_ROOT%' + [Environment]::NewLine + [Environment]::NewLine + 'Please choose an existing Qtiler installation folder.', 'Qtiler Installer - Invalid Previous Folder', 'OK', 'Error')" >nul
    set "QTILER_PREVIOUS_ROOT="
    goto ask_previous_root
)
if not exist "%QTILER_PREVIOUS_ROOT%\.env" if not exist "%QTILER_PREVIOUS_ROOT%\data" if not exist "%QTILER_PREVIOUS_ROOT%\qgisprojects" (
    >>"%QTILER_INSTALL_LOG%" echo Previous folder does not look like a Qtiler runtime folder: %QTILER_PREVIOUS_ROOT%.
    powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('The selected folder does not contain .env, data or qgisprojects.' + [Environment]::NewLine + [Environment]::NewLine + 'Please choose the existing Qtiler installation folder so user data can be preserved safely.', 'Qtiler Installer - Invalid Previous Folder', 'OK', 'Error')" >nul
    set "QTILER_PREVIOUS_ROOT="
    goto ask_previous_root
)
>>"%QTILER_INSTALL_LOG%" echo Previous Qtiler root selected manually: %QTILER_PREVIOUS_ROOT%.

:previous_root_ok

if /i "%QTILER_SETUP_MODE%"=="update" (
    echo [Qtiler] Stopping existing service before preserving runtime state...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$svc = Get-Service -Name 'QTiler' -ErrorAction SilentlyContinue;" ^
        "if ($svc -and $svc.Status -ne 'Stopped') { Stop-Service -Name 'QTiler' -Force -ErrorAction Stop; $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45)); Write-Host '  Existing QTiler service stopped.' }" ^
        "elseif ($svc) { Write-Host '  Existing QTiler service is already stopped.' }" ^
        "else { Write-Host '  QTiler service is not installed.' }"
    if errorlevel 1 (
        echo ERROR: Could not stop existing QTiler Windows service before update.
        pause
        exit /b 1
    )
    echo.
    if /i not "%QTILER_PREVIOUS_ROOT%"=="%QTILER_ROOT%" (
        echo.
        echo [Qtiler] Copying runtime state from existing installation...
        powershell -NoProfile -ExecutionPolicy Bypass -Command ^
            "$old = '%QTILER_PREVIOUS_ROOT%';" ^
            "$new = '%QTILER_ROOT%';" ^
            "if (-not (Test-Path -LiteralPath $old)) { Write-Host ('ERROR: previous Qtiler root not found: ' + $old); exit 1 };" ^
            "$stamp = Get-Date -Format 'yyyyMMdd_HHmmss';" ^
            "$backupRoot = Join-Path $new ('upgrade-backups\replaced-new-package-data-' + $stamp);" ^
            "$userBackupRoot = Join-Path $new ('upgrade-backups\user-runtime-backup-' + $stamp);" ^
            "$preserveDirs = @('data','cache','qgisprojects','config','logs','temp_uploads');" ^
            "$preserveFiles = @('.env','auth.db','symbology-style.db');" ^
            "New-Item -ItemType Directory -Path $userBackupRoot -Force | Out-Null;" ^
            "foreach ($name in $preserveDirs) { $src = Join-Path $old $name; if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $userBackupRoot $name) -Recurse -Force } };" ^
            "foreach ($name in $preserveFiles) { $src = Join-Path $old $name; if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $userBackupRoot $name) -Force } };" ^
            "$oldPlugins = Join-Path $old 'plugins'; $newPlugins = Join-Path $new 'plugins'; $bundled = @('Qrigo','Qtiler2Origo','Qtiler2Hajk','Qtiler2qwc','QtilerAuth'); if (Test-Path -LiteralPath $oldPlugins) { $customBackup = Join-Path $userBackupRoot 'plugins'; New-Item -ItemType Directory -Path $customBackup -Force | Out-Null; Get-ChildItem -LiteralPath $oldPlugins -Directory | ForEach-Object { if ($bundled -notcontains $_.Name) { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $customBackup $_.Name) -Recurse -Force } } };" ^
            "Write-Host ('  Backup of previous runtime data: ' + $userBackupRoot);" ^
            "foreach ($name in $preserveDirs) { $src = Join-Path $old $name; $dst = Join-Path $new $name; if (Test-Path -LiteralPath $src) { if (Test-Path -LiteralPath $dst) { New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null; Move-Item -LiteralPath $dst -Destination (Join-Path $backupRoot $name) -Force }; Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force; Write-Host ('  Restored directory: ' + $name) } };" ^
            "foreach ($name in $preserveFiles) { $src = Join-Path $old $name; $dst = Join-Path $new $name; if (Test-Path -LiteralPath $src) { if (Test-Path -LiteralPath $dst) { New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null; Move-Item -LiteralPath $dst -Destination (Join-Path $backupRoot $name) -Force }; Copy-Item -LiteralPath $src -Destination $dst -Force; Write-Host ('  Restored file: ' + $name) } };" ^
            "if (Test-Path -LiteralPath $oldPlugins) { New-Item -ItemType Directory -Path $newPlugins -Force | Out-Null; Get-ChildItem -LiteralPath $oldPlugins -Directory | ForEach-Object { if ($bundled -notcontains $_.Name) { $dst = Join-Path $newPlugins $_.Name; if (-not (Test-Path -LiteralPath $dst)) { Copy-Item -LiteralPath $_.FullName -Destination $dst -Recurse -Force; Write-Host ('  Restored custom plugin: ' + $_.Name) } } } };" ^
            "Write-Host '  Runtime state copy complete.'"
        if errorlevel 1 (
            echo ERROR: Could not copy runtime state from the existing installation.
            pause
            exit /b 1
        )
        echo.
    ) else (
        echo [Qtiler] Update mode selected in the existing installation folder. Backing up runtime data before continuing...
        powershell -NoProfile -ExecutionPolicy Bypass -Command ^
            "$root = '%QTILER_ROOT%';" ^
            "$stamp = Get-Date -Format 'yyyyMMdd_HHmmss';" ^
            "$userBackupRoot = Join-Path $root ('upgrade-backups\user-runtime-backup-' + $stamp);" ^
            "$preserveDirs = @('data','cache','qgisprojects','config','logs','temp_uploads');" ^
            "$preserveFiles = @('.env','auth.db','symbology-style.db');" ^
            "New-Item -ItemType Directory -Path $userBackupRoot -Force | Out-Null;" ^
            "foreach ($name in $preserveDirs) { $src = Join-Path $root $name; if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $userBackupRoot $name) -Recurse -Force; Write-Host ('  Backed up directory: ' + $name) } };" ^
            "foreach ($name in $preserveFiles) { $src = Join-Path $root $name; if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $userBackupRoot $name) -Force; Write-Host ('  Backed up file: ' + $name) } };" ^
            "$plugins = Join-Path $root 'plugins'; $bundled = @('Qrigo','Qtiler2Origo','Qtiler2Hajk','Qtiler2qwc','QtilerAuth'); if (Test-Path -LiteralPath $plugins) { $customBackup = Join-Path $userBackupRoot 'plugins'; New-Item -ItemType Directory -Path $customBackup -Force | Out-Null; Get-ChildItem -LiteralPath $plugins -Directory | ForEach-Object { if ($bundled -notcontains $_.Name) { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $customBackup $_.Name) -Recurse -Force; Write-Host ('  Backed up custom plugin: ' + $_.Name) } } };" ^
            "Write-Host ('  Backup of current runtime data: ' + $userBackupRoot)"
        if errorlevel 1 (
            echo ERROR: Could not create in-place update backup.
            pause
            exit /b 1
        )
        echo.
    )
)

REM ----------------------------------------------------------------------
REM  Step 0b: Ensure Node.js (latest LTS) is installed before QGIS setup
REM ----------------------------------------------------------------------
call :ensure_node
if errorlevel 1 (
    pause
    exit /b 1
)

REM ----------------------------------------------------------------------
REM  Step 1: Ask for QGIS Desktop installation path (popup window)
REM ----------------------------------------------------------------------
:ask_qgis
echo [Qtiler] Waiting for QGIS Desktop folder input...
echo A QGIS path dialog should be open. If it is hidden, check behind this installer window.
>>"%QTILER_INSTALL_LOG%" echo Step 1: waiting for QGIS Desktop folder input dialog.
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::InputBox('Please enter the full path to your QGIS Desktop installation folder.' + [Environment]::NewLine + [Environment]::NewLine + 'IMPORTANT: Qtiler requires QGIS 3.x (for example 3.34 LTR or 3.40).' + [Environment]::NewLine + 'QGIS 4.x is NOT supported.' + [Environment]::NewLine + [Environment]::NewLine + 'Example: C:\Program Files\QGIS 3.40' + [Environment]::NewLine + [Environment]::NewLine + 'Add the path to QGIS Desktop and click Enter.', 'Qtiler Installer - QGIS Desktop Path', 'C:\Program Files\QGIS 3.40')"`) do set "QGIS_ROOT=%%I"

if not defined QGIS_ROOT (
    echo Installation cancelled by user.
    >>"%QTILER_INSTALL_LOG%" echo Installation cancelled at QGIS Desktop folder prompt.
    pause
    exit /b 1
)

REM Strip surrounding quotes and trailing slash
set "QGIS_ROOT=%QGIS_ROOT:"=%"
if "%QGIS_ROOT:~-1%"=="\" set "QGIS_ROOT=%QGIS_ROOT:~0,-1%"

echo Selected QGIS folder: %QGIS_ROOT%
>>"%QTILER_INSTALL_LOG%" echo Selected QGIS folder: %QGIS_ROOT%.
echo.

REM Validate QGIS python.exe. OSGeo4W commonly uses bin\python.exe; standalone
REM QGIS builds commonly keep Python under apps\Python*\python.exe.
set "QGIS_PYTHON_EXE="
if exist "%QGIS_ROOT%\bin\python.exe" set "QGIS_PYTHON_EXE=%QGIS_ROOT%\bin\python.exe"
if not defined QGIS_PYTHON_EXE if exist "%QGIS_ROOT%\bin\python3.exe" set "QGIS_PYTHON_EXE=%QGIS_ROOT%\bin\python3.exe"
if not defined QGIS_PYTHON_EXE (
    for /d %%D in ("%QGIS_ROOT%\apps\Python*") do (
        if exist "%%~fD\python.exe" set "QGIS_PYTHON_EXE=%%~fD\python.exe"
    )
)
if not defined QGIS_PYTHON_EXE (
    >>"%QTILER_INSTALL_LOG%" echo Invalid QGIS folder: QGIS Python not found under %QGIS_ROOT%.
    powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('QGIS Python was not found under:' + [Environment]::NewLine + '%QGIS_ROOT%' + [Environment]::NewLine + [Environment]::NewLine + 'Qtiler accepts OSGeo4W style bin\python.exe and standalone QGIS apps\Python*\python.exe layouts.' + [Environment]::NewLine + [Environment]::NewLine + 'Please select a valid QGIS 3.x installation folder.', 'Qtiler Installer - Invalid Path', 'OK', 'Error')" >nul
    goto ask_qgis
)

REM Resolve QGIS prefix (apps\qgis or apps\qgis-ltr)
set "QGIS_PREFIX_DIR="
if exist "%QGIS_ROOT%\apps\qgis-ltr\python" set "QGIS_PREFIX_DIR=%QGIS_ROOT%\apps\qgis-ltr"
if not defined QGIS_PREFIX_DIR if exist "%QGIS_ROOT%\apps\qgis\python" set "QGIS_PREFIX_DIR=%QGIS_ROOT%\apps\qgis"

if not defined QGIS_PREFIX_DIR (
    >>"%QTILER_INSTALL_LOG%" echo Invalid QGIS folder: apps\qgis or apps\qgis-ltr prefix not found under %QGIS_ROOT%.
    powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('QGIS apps folder not found under:' + [Environment]::NewLine + '%QGIS_ROOT%\apps' + [Environment]::NewLine + [Environment]::NewLine + 'Please select a valid QGIS 3.x installation folder.', 'Qtiler Installer - Invalid Path', 'OK', 'Error')" >nul
    goto ask_qgis
)

REM Detect QGIS major version from qgis-bin.exe metadata
set "QGIS_MAJOR=0"
for /f "usebackq delims=" %%V in (`powershell -NoProfile -Command "try { (Get-Item '%QGIS_ROOT%\bin\qgis-bin.exe' -ErrorAction Stop).VersionInfo.FileMajorPart } catch { try { (Get-Item '%QGIS_ROOT%\bin\qgis-bin-ltr.exe' -ErrorAction Stop).VersionInfo.FileMajorPart } catch { 0 } }"`) do set "QGIS_MAJOR=%%V"

if "%QGIS_MAJOR%"=="4" (
    >>"%QTILER_INSTALL_LOG%" echo Unsupported QGIS version detected: major version 4 at %QGIS_ROOT%.
    powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Detected QGIS 4.x at the selected folder.' + [Environment]::NewLine + [Environment]::NewLine + 'Qtiler requires QGIS 3.x (for example 3.34 LTR or 3.40).' + [Environment]::NewLine + 'Please install QGIS 3.x and run this installer again.', 'Qtiler Installer - Unsupported QGIS Version', 'OK', 'Error')" >nul
    exit /b 1
)

echo QGIS validated (major version: %QGIS_MAJOR%, prefix: %QGIS_PREFIX_DIR%).
echo QGIS Python: %QGIS_PYTHON_EXE%
>>"%QTILER_INSTALL_LOG%" echo QGIS validated: major=%QGIS_MAJOR%, prefix=%QGIS_PREFIX_DIR%, python=%QGIS_PYTHON_EXE%.
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
echo [Qtiler] Waiting for HTTP port input...
>>"%QTILER_INSTALL_LOG%" echo Step 1b: waiting for HTTP port input dialog. Default=%QTILER_PORT_DEFAULT%.
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::InputBox('Please choose the HTTP port Qtiler should use.' + [Environment]::NewLine + [Environment]::NewLine + 'Use a free TCP port between 1 and 65535.' + [Environment]::NewLine + 'Default: %QTILER_PORT_DEFAULT%' + [Environment]::NewLine + [Environment]::NewLine + 'Examples: 3000, 3080, 8080', 'Qtiler Installer - HTTP Port', '%QTILER_PORT_DEFAULT%')"`) do set "QTILER_PORT=%%I"

if not defined QTILER_PORT (
    echo Installation cancelled by user.
    >>"%QTILER_INSTALL_LOG%" echo Installation cancelled at HTTP port prompt.
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
>>"%QTILER_INSTALL_LOG%" echo Invalid HTTP port entered. Prompting again.
powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('The port must be a number between 1 and 65535.' + [Environment]::NewLine + [Environment]::NewLine + 'Please choose a valid HTTP port for Qtiler.', 'Qtiler Installer - Invalid Port', 'OK', 'Error')" >nul
goto ask_port

:port_ok
set "QTILER_PORT_INVALID="
echo Selected Qtiler HTTP port: %QTILER_PORT%
>>"%QTILER_INSTALL_LOG%" echo Selected Qtiler HTTP port: %QTILER_PORT%.
echo.

REM ----------------------------------------------------------------------
REM  Step 1c: Ask for installation profile and public IIS/HTTPS settings
REM ----------------------------------------------------------------------
echo Installation profile:
echo   T = Test installation
echo   P = Production installation
choice /C TP /N /M "Choose installation profile [T/P]: "
if errorlevel 2 (
    set "QTILER_INSTALL_MODE=production"
) else (
    set "QTILER_INSTALL_MODE=test"
)
>>"%QTILER_INSTALL_LOG%" echo Installation profile selected: %QTILER_INSTALL_MODE%.

set "QTILER_BEHIND_IIS=0"
set "QTILER_HTTPS=0"
set "QTILER_PUBLIC_URL="
set "QTILER_TRUST_PROXY_VALUE=loopback"
set "QTILER_ENABLE_HSTS_VALUE=0"
set "QTILER_CORS_ALLOWED_ORIGINS_VALUE="
set "QTILER_CORS_ALLOW_CREDENTIALS_VALUE=0"

if /i "%QTILER_INSTALL_MODE%"=="production" (
    echo.
    echo Production profile selected.
    >>"%QTILER_INSTALL_LOG%" echo Production profile selected. Waiting for IIS/HTTPS choice.
    choice /C YN /N /M "Will this production install be published through IIS with HTTPS? [Y/N]: "
    if errorlevel 2 (
        set "QTILER_PUBLIC_URL=http://localhost:%QTILER_PORT%"
    ) else (
        set "QTILER_BEHIND_IIS=1"
        set "QTILER_HTTPS=1"
        set "QTILER_TRUST_PROXY_VALUE=loopback"
        set "QTILER_ENABLE_HSTS_VALUE=1"
        goto ask_public_url
    )
) else (
    set "QTILER_PUBLIC_URL=http://localhost:%QTILER_PORT%"
)
goto install_profile_ok

:ask_public_url
echo [Qtiler] Waiting for public HTTPS URL input...
>>"%QTILER_INSTALL_LOG%" echo Waiting for public HTTPS URL input dialog.
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::InputBox('Enter the public HTTPS URL that IIS will expose for Qtiler.' + [Environment]::NewLine + [Environment]::NewLine + 'Example: https://qtiler.example.com' + [Environment]::NewLine + [Environment]::NewLine + 'This will be written to PUBLIC_BASE_URL in .env.', 'Qtiler Installer - Public HTTPS URL', 'https://qtiler.example.com')"`) do set "QTILER_PUBLIC_URL=%%I"
if not defined QTILER_PUBLIC_URL (
    echo Installation cancelled by user.
    >>"%QTILER_INSTALL_LOG%" echo Installation cancelled at public HTTPS URL prompt.
    pause
    exit /b 1
)
set "QTILER_PUBLIC_URL=%QTILER_PUBLIC_URL: =%"
set "QTILER_PUBLIC_URL=%QTILER_PUBLIC_URL:"=%"
if /i not "%QTILER_PUBLIC_URL:~0,8%"=="https://" (
    >>"%QTILER_INSTALL_LOG%" echo Invalid public HTTPS URL entered: %QTILER_PUBLIC_URL%.
    powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Production behind IIS with HTTPS requires a public URL starting with https://.' + [Environment]::NewLine + [Environment]::NewLine + 'Please enter the public HTTPS URL, for example https://qtiler.example.com.', 'Qtiler Installer - Invalid Public URL', 'OK', 'Error')" >nul
    goto ask_public_url
)
set "QTILER_CORS_ALLOWED_ORIGINS_VALUE=%QTILER_PUBLIC_URL%"
set "QTILER_CORS_ALLOW_CREDENTIALS_VALUE=1"

:install_profile_ok
echo.
echo Selected installation profile: %QTILER_INSTALL_MODE%
echo Public base URL: %QTILER_PUBLIC_URL%
>>"%QTILER_INSTALL_LOG%" echo Public base URL: %QTILER_PUBLIC_URL%. IIS=%QTILER_BEHIND_IIS%, HTTPS=%QTILER_HTTPS%.
if "%QTILER_BEHIND_IIS%"=="1" echo IIS reverse proxy: yes, HTTPS enabled
if not "%QTILER_BEHIND_IIS%"=="1" echo IIS reverse proxy: no automatic IIS/HTTPS settings
if "%QTILER_BEHIND_IIS%"=="1" (
    echo.
    echo IMPORTANT: IIS URL Rewrite must proxy to this exact local target:
    echo   http://localhost:%QTILER_PORT%/{R:1}
    echo PUBLIC_BASE_URL must remain the public HTTPS URL, not localhost.
)
echo.

REM ----------------------------------------------------------------------
REM  Step 1d: Ask for the initial QtilerAuth admin password
REM ----------------------------------------------------------------------
if exist "%QTILER_ROOT%\.env" (
    for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b /c:"QTILER_DEFAULT_ADMIN_PASSWORD=" "%QTILER_ROOT%\.env" 2^>nul`) do (
        if /i "%%A"=="QTILER_DEFAULT_ADMIN_PASSWORD" set "QTILER_EXISTING_ADMIN_PASSWORD=%%B"
    )
)
if /i "%QTILER_SETUP_MODE%"=="update" if defined QTILER_EXISTING_ADMIN_PASSWORD (
    set "QTILER_ADMIN_PASSWORD_PRESERVE=1"
    set "QTILER_ADMIN_PASSWORD_DISPLAY=preserved from existing .env"
    echo Existing QtilerAuth admin bootstrap password will be preserved from .env.
    >>"%QTILER_INSTALL_LOG%" echo Existing QtilerAuth admin bootstrap password preserved from .env.
    echo.
    goto admin_password_ok
)

:ask_admin_password
echo [Qtiler] Waiting for initial QtilerAuth admin password input...
>>"%QTILER_INSTALL_LOG%" echo Step 1d: waiting for initial QtilerAuth admin password dialogs.
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName Microsoft.VisualBasic; Add-Type -AssemblyName System.Windows.Forms; $pattern='^[A-Za-z0-9._@#+=-]{8,128}$'; while ($true) { $p=[Microsoft.VisualBasic.Interaction]::InputBox('Choose the initial QtilerAuth administrator password.' + [Environment]::NewLine + [Environment]::NewLine + 'Username: admin' + [Environment]::NewLine + 'Allowed characters: letters, numbers, . _ @ # + = -' + [Environment]::NewLine + 'Length: 8-128 characters' + [Environment]::NewLine + [Environment]::NewLine + 'You will see this password again at the end so you can copy and store it.', 'Qtiler Installer - Admin Password', ''); if ([string]::IsNullOrWhiteSpace($p)) { exit 2 }; $c=[Microsoft.VisualBasic.Interaction]::InputBox('Confirm the initial QtilerAuth administrator password.', 'Qtiler Installer - Confirm Admin Password', ''); if ($p -ne $c) { [System.Windows.Forms.MessageBox]::Show('The passwords do not match. Please try again.', 'Qtiler Installer - Password Mismatch', 'OK', 'Error') > $null; continue }; if ($p -notmatch $pattern) { [System.Windows.Forms.MessageBox]::Show('The password must be 8-128 characters and may only contain letters, numbers, . _ @ # + = -', 'Qtiler Installer - Invalid Password', 'OK', 'Error') > $null; continue }; Write-Output $p; exit 0 }"`) do set "QTILER_ADMIN_PASSWORD=%%I"
if not defined QTILER_ADMIN_PASSWORD (
    echo Installation cancelled by user.
    >>"%QTILER_INSTALL_LOG%" echo Installation cancelled at QtilerAuth admin password prompt.
    pause
    exit /b 1
)
set "QTILER_ADMIN_PASSWORD_DISPLAY=%QTILER_ADMIN_PASSWORD%"
echo Initial QtilerAuth admin password selected for username: admin
>>"%QTILER_INSTALL_LOG%" echo Initial QtilerAuth admin password selected for username admin.
echo.

:admin_password_ok

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
>>"%QTILER_INSTALL_LOG%" echo Step 2: updating .env.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$envFile = Join-Path '%QTILER_ROOT%' '.env';" ^
  "$qtilerRoot = '%QTILER_ROOT%';" ^
    "$existingEnv = @{};" ^
    "if (Test-Path $envFile) { Get-Content -LiteralPath $envFile | ForEach-Object { $m = [regex]::Match($_, '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$'); if ($m.Success) { $existingEnv[$m.Groups[1].Value] = $m.Groups[2].Value } } };" ^
    "$adminPassword = '%QTILER_ADMIN_PASSWORD%';" ^
    "if ('%QTILER_ADMIN_PASSWORD_PRESERVE%' -eq '1' -and $existingEnv.ContainsKey('QTILER_DEFAULT_ADMIN_PASSWORD')) { $adminPassword = [string]$existingEnv['QTILER_DEFAULT_ADMIN_PASSWORD'] };" ^
    "if ([string]::IsNullOrWhiteSpace($adminPassword)) { Write-Host 'ERROR: QTILER_DEFAULT_ADMIN_PASSWORD is required.'; exit 1 };" ^
  "$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source; if (-not $nodeExe) { $nodeExe = 'C:\Program Files\nodejs\node.exe' };" ^
                                                                "$q = [char]34; $updates = [ordered]@{ PORT = '%QTILER_PORT%'; QTILER_INSTALL_MODE = '%QTILER_INSTALL_MODE%'; PUBLIC_BASE_URL = '%QTILER_PUBLIC_URL%'; QTILER_BEHIND_IIS = '%QTILER_BEHIND_IIS%'; QTILER_PUBLIC_HTTPS = '%QTILER_HTTPS%'; QTILER_TRUST_PROXY = '%QTILER_TRUST_PROXY_VALUE%'; QTILER_ENABLE_HSTS = '%QTILER_ENABLE_HSTS_VALUE%'; QTILER_CORS_ALLOWED_ORIGINS = '%QTILER_CORS_ALLOWED_ORIGINS_VALUE%'; QTILER_CORS_ALLOW_CREDENTIALS = '%QTILER_CORS_ALLOW_CREDENTIALS_VALUE%'; QTILER_DEFAULT_ADMIN_PASSWORD = $adminPassword; PYTHON_EXE = '%QGIS_PYTHON_EXE%'; OSGEO4W_BIN = '%QGIS_ROOT%\bin'; QGIS_PREFIX = '%QGIS_PREFIX_DIR%'; QT_PLUGIN_PATH = '%QT_PLUGINS_DIR%'; PYTHONPATH = '%QGIS_PREFIX_DIR%\python'; QTILER_HOME = $qtilerRoot; NODE_EXE = $nodeExe; QUANTIZED_MESH_BUILD_CMD = ($q + '%QGIS_PYTHON_EXE%' + $q + ' ' + $q + (Join-Path $qtilerRoot 'tools\mesh_build.py') + $q); QUANTIZED_MESH_ENGINE_CMD = ($q + $nodeExe + $q + ' ' + $q + (Join-Path $qtilerRoot 'tools\mesh_dem_to_terrain_runner.mjs') + $q); QUANTIZED_MESH_ENGINE_MODULE = (Join-Path $qtilerRoot 'ThirdParty\mesh-dem-to-terrain\dist\index.js') };" ^
  "if (Test-Path $envFile) { $ts = Get-Date -Format 'yyyyMMdd_HHmmss'; Copy-Item $envFile ($envFile + '.bak.' + $ts) -Force; $lines = Get-Content -LiteralPath $envFile } elseif (Test-Path (Join-Path $qtilerRoot '.env.example')) { $lines = Get-Content -LiteralPath (Join-Path $qtilerRoot '.env.example') } else { $lines = @('# Qtiler environment configuration - generated by install.bat') };" ^
  "$out = New-Object System.Collections.Generic.List[string]; $seen = @{};" ^
  "foreach ($line in $lines) { $m = [regex]::Match($line, '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*='); if ($m.Success -and $updates.Contains($m.Groups[1].Value)) { $k = $m.Groups[1].Value; $out.Add($k + '=' + $updates[$k]); $seen[$k] = $true } else { $patched = $line -ireplace [regex]::Escape('C:\Qtiler'), $qtilerRoot; $out.Add($patched) } };" ^
  "foreach ($k in $updates.Keys) { if (-not $seen.ContainsKey($k)) { $out.Add($k + '=' + $updates[$k]) } };" ^
  "Set-Content -LiteralPath $envFile -Value $out -Encoding UTF8"
if errorlevel 1 (
    echo ERROR: failed to update .env.
    >>"%QTILER_INSTALL_LOG%" echo ERROR: failed to update .env.
    pause
    exit /b 1
)
echo .env updated. Existing tuning and secrets preserved.
>>"%QTILER_INSTALL_LOG%" echo .env updated successfully.
echo.
echo Configured in .env:
echo   QTILER_INSTALL_MODE=%QTILER_INSTALL_MODE%
echo   PORT=%QTILER_PORT%
echo   PUBLIC_BASE_URL=%QTILER_PUBLIC_URL%
echo   QTILER_BEHIND_IIS=%QTILER_BEHIND_IIS%
echo   QTILER_PUBLIC_HTTPS=%QTILER_HTTPS%
echo   QTILER_TRUST_PROXY=%QTILER_TRUST_PROXY_VALUE%
echo   QTILER_ENABLE_HSTS=%QTILER_ENABLE_HSTS_VALUE%
echo   QTILER_CORS_ALLOWED_ORIGINS=%QTILER_CORS_ALLOWED_ORIGINS_VALUE%
echo   QTILER_DEFAULT_ADMIN_PASSWORD=%QTILER_ADMIN_PASSWORD_DISPLAY%
echo.
echo You can change these values later in %QTILER_ROOT%\.env and restart the QTiler service.
echo Initial QtilerAuth admin username is: admin
echo Initial QtilerAuth admin password is stored in .env as QTILER_DEFAULT_ADMIN_PASSWORD.
echo.

REM ----------------------------------------------------------------------
REM  Step 3: Node.js was checked before QGIS and profile setup
REM ----------------------------------------------------------------------
>>"%QTILER_INSTALL_LOG%" echo Step 3: Node.js and npm were checked before interactive setup.
echo Node.js and npm are ready.
echo.

REM ----------------------------------------------------------------------
REM  Step 4: Install Qtiler npm dependencies
REM ----------------------------------------------------------------------
echo [Qtiler] Installing Node.js dependencies ^(npm install^)...
>>"%QTILER_INSTALL_LOG%" echo Step 4: running npm.cmd install --omit=dev --no-audit --no-fund.
call npm.cmd install --omit=dev --no-audit --no-fund
if errorlevel 1 (
    echo ERROR: npm install failed.
    >>"%QTILER_INSTALL_LOG%" echo ERROR: npm install failed with exit code %errorlevel%.
    pause
    exit /b 1
)
>>"%QTILER_INSTALL_LOG%" echo npm install completed successfully.
echo.

REM ----------------------------------------------------------------------
REM  Step 4b: Apply QtilerAuth licensing policy
REM ----------------------------------------------------------------------
echo [Qtiler] Applying QtilerAuth licensing policy...
>>"%QTILER_INSTALL_LOG%" echo Step 4b: applying QtilerAuth licensing policy.
if not exist data mkdir data >nul 2>&1
for /f "tokens=1,* delims==" %%A in (`node tools\qtilerauth-install-policy.mjs "%QTILER_ROOT%" "%QTILER_SETUP_MODE%"`) do (
    if /i "%%A"=="QTILERAUTH_EXPECTED" set "QTILERAUTH_EXPECTED=%%B"
    if /i "%%A"=="QTILERAUTH_INSTALL_STATUS" set "QTILERAUTH_INSTALL_STATUS=%%B"
)
if errorlevel 1 (
    echo ERROR: Could not apply QtilerAuth licensing policy.
    >>"%QTILER_INSTALL_LOG%" echo ERROR: could not apply QtilerAuth licensing policy.
    pause
    exit /b 1
)
if not defined QTILERAUTH_INSTALL_STATUS set "QTILERAUTH_INSTALL_STATUS=unknown"
>>"%QTILER_INSTALL_LOG%" echo QtilerAuth licensing policy applied. Expected=%QTILERAUTH_EXPECTED%, status=%QTILERAUTH_INSTALL_STATUS%.
echo.

REM ----------------------------------------------------------------------
REM  Step 5: Install Qtiler as a Windows service
REM ----------------------------------------------------------------------
echo [Qtiler] Stopping existing Windows service if it is already running...
>>"%QTILER_INSTALL_LOG%" echo Step 5: stopping existing QTiler Windows service if present.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$svc = Get-Service -Name 'QTiler' -ErrorAction SilentlyContinue;" ^
    "if ($svc -and $svc.Status -ne 'Stopped') {" ^
    "  Stop-Service -Name 'QTiler' -Force -ErrorAction Stop;" ^
    "  $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45));" ^
    "  Write-Host '  Existing QTiler service stopped so the updated .env will be loaded.'" ^
    "} elseif ($svc) { Write-Host '  Existing QTiler service is already stopped.' }" ^
    "else { Write-Host '  QTiler service is not installed yet.' }"
if errorlevel 1 (
    echo ERROR: Could not stop existing QTiler Windows service.
    >>"%QTILER_INSTALL_LOG%" echo ERROR: could not stop existing QTiler Windows service.
    pause
    exit /b 1
)
echo.

echo [Qtiler] Removing existing Windows service definition if present...
>>"%QTILER_INSTALL_LOG%" echo Step 5: removing existing QTiler Windows service definition if present.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$svc = Get-Service -Name 'QTiler' -ErrorAction SilentlyContinue;" ^
    "if ($svc) { exit 0 } else { exit 2 }"
if %errorlevel% equ 0 (
    node service\uninstall-service.js
    if errorlevel 1 (
        echo ERROR: Could not remove existing QTiler Windows service.
        >>"%QTILER_INSTALL_LOG%" echo ERROR: node service\uninstall-service.js failed.
        pause
        exit /b 1
    )
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$deadline = (Get-Date).AddSeconds(45);" ^
        "while ((Get-Date) -lt $deadline) { if (-not (Get-Service -Name 'QTiler' -ErrorAction SilentlyContinue)) { Write-Host '  Existing QTiler service removed.'; exit 0 }; Start-Sleep -Milliseconds 1000 }" ^
        "Write-Host 'ERROR: QTiler service was not removed within the timeout.'; exit 1"
    if errorlevel 1 (
        echo ERROR: Existing QTiler Windows service did not uninstall cleanly.
        >>"%QTILER_INSTALL_LOG%" echo ERROR: existing QTiler Windows service did not uninstall within timeout.
        pause
        exit /b 1
    )
) else (
    echo   No existing QTiler service definition found.
    >>"%QTILER_INSTALL_LOG%" echo No existing QTiler service definition found.
)
echo.

echo [Qtiler] Installing Qtiler as a Windows service...
>>"%QTILER_INSTALL_LOG%" echo Step 5: installing QTiler Windows service.
node service\install-service.js
if errorlevel 1 (
    echo ERROR: Windows service installation failed.
    >>"%QTILER_INSTALL_LOG%" echo ERROR: Windows service installation failed.
    pause
    exit /b 1
)
>>"%QTILER_INSTALL_LOG%" echo Windows service installation command completed.
echo.

REM ----------------------------------------------------------------------
REM  Step 5b: Start the Windows service and wait until HTTP is really ready
REM ----------------------------------------------------------------------
echo [Qtiler] Starting Windows service...
>>"%QTILER_INSTALL_LOG%" echo Step 5b: starting QTiler Windows service.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Start-Service -Name 'QTiler' -ErrorAction Stop; Write-Host '  Service start requested.' } catch { if ($_.Exception.Message -notmatch 'already been started|already running') { Write-Host ('ERROR: ' + $_.Exception.Message); exit 1 } else { Write-Host '  Service already running.' } }"
if errorlevel 1 (
    echo ERROR: Could not start QTiler Windows service.
    >>"%QTILER_INSTALL_LOG%" echo ERROR: could not start QTiler Windows service.
    pause
    exit /b 1
)

echo [Qtiler] Waiting for Qtiler HTTP endpoint to become ready on port %QTILER_PORT%...
>>"%QTILER_INSTALL_LOG%" echo Step 5b: waiting for HTTP readiness on port %QTILER_PORT%.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$rootUrl = 'http://127.0.0.1:%QTILER_PORT%/';" ^
    "$authUrl = 'http://127.0.0.1:%QTILER_PORT%/auth/login-status';" ^
        "$authExpected = '%QTILERAUTH_EXPECTED%' -eq '1';" ^
  "$deadline = (Get-Date).AddMinutes(2);" ^
    "$rootReady = $false;" ^
        "$authReady = -not $authExpected;" ^
    "$authBody = '{\"username\":\"__bootstrap_probe__\"}';" ^
  "while ((Get-Date) -lt $deadline) {" ^
    "  if (-not $rootReady) {" ^
    "    try {" ^
    "      $resp = Invoke-WebRequest -Uri $rootUrl -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0 -ErrorAction Stop;" ^
    "      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) { $rootReady = $true }" ^
    "    } catch {" ^
    "      $status = $null;" ^
    "      try { $status = [int]$_.Exception.Response.StatusCode } catch {}" ^
    "      if ($status -and $status -ge 200 -and $status -lt 500) { $rootReady = $true }" ^
    "    }" ^
    "  }" ^
    "  if ($authExpected -and $rootReady -and -not $authReady) {" ^
    "    try {" ^
    "      $authResp = Invoke-RestMethod -Uri $authUrl -Method Post -UseBasicParsing -TimeoutSec 5 -ContentType 'application/json' -Body $authBody -ErrorAction Stop;" ^
    "      if ($null -ne $authResp -and $authResp.PSObject.Properties.Name -contains 'requireCaptcha') { $authReady = $true }" ^
    "    } catch {" ^
    "      $authStatus = $null;" ^
    "      try { $authStatus = [int]$_.Exception.Response.StatusCode } catch {}" ^
    "      if ($authStatus -eq 200) { $authReady = $true }" ^
    "    }" ^
    "  }" ^
    "  if ($rootReady -and $authReady) { break }" ^
  "  Start-Sleep -Milliseconds 2000;" ^
  "}" ^
    "if (-not $rootReady) { Write-Host ('ERROR: Qtiler did not become ready at ' + $rootUrl + ' within the timeout.'); exit 1 }" ^
    "if ($authExpected -and -not $authReady) { Write-Host ('ERROR: QtilerAuth did not become ready at ' + $authUrl + ' within the timeout.'); exit 1 }" ^
    "Write-Host ('  Qtiler is responding at ' + $rootUrl);" ^
    "if ($authExpected) { Write-Host ('  QtilerAuth is responding at ' + $authUrl) } else { Write-Host '  QtilerAuth readiness skipped because it is not enabled by the preserved license state.' }"
if errorlevel 1 (
    echo ERROR: Qtiler service started but Qtiler or the expected QtilerAuth endpoint did not become ready in time.
    echo Check logs in %QTILER_ROOT%\logs and Windows Services for QTiler startup details.
    >>"%QTILER_INSTALL_LOG%" echo ERROR: Qtiler service started but HTTP/QtilerAuth readiness failed. QtilerAuth expected=%QTILERAUTH_EXPECTED%.
    pause
    exit /b 1
)
>>"%QTILER_INSTALL_LOG%" echo Qtiler HTTP readiness passed. QtilerAuth expected=%QTILERAUTH_EXPECTED%, status=%QTILERAUTH_INSTALL_STATUS%.
echo.

REM ----------------------------------------------------------------------
REM  Step 6: Success notification
REM ----------------------------------------------------------------------
powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Qtiler has been installed successfully.' + [Environment]::NewLine + [Environment]::NewLine + 'Setup mode: %QTILER_SETUP_MODE%' + [Environment]::NewLine + 'Configured profile: %QTILER_INSTALL_MODE%' + [Environment]::NewLine + 'Public URL: %QTILER_PUBLIC_URL%' + [Environment]::NewLine + 'Port: %QTILER_PORT%' + [Environment]::NewLine + 'IIS / HTTPS: %QTILER_BEHIND_IIS% / %QTILER_HTTPS%' + [Environment]::NewLine + 'QtilerAuth status: %QTILERAUTH_INSTALL_STATUS%' + [Environment]::NewLine + [Environment]::NewLine + 'Administrator login:' + [Environment]::NewLine + 'Username: admin' + [Environment]::NewLine + 'Password: %QTILER_ADMIN_PASSWORD_DISPLAY%' + [Environment]::NewLine + [Environment]::NewLine + 'For new installs, copy and store this password now. During updates, the existing .env password, users, licenses, uploaded projects, cache and plugin data are preserved.' + [Environment]::NewLine + [Environment]::NewLine + 'Updates do not issue or renew QtilerAuth trial licenses. If the preserved QtilerAuth trial or license is expired, QtilerAuth remains disabled after the update.' + [Environment]::NewLine + [Environment]::NewLine + 'These settings are stored in .env and can be changed after installation. Restart the QTiler service after editing .env.' + [Environment]::NewLine + [Environment]::NewLine + 'For license contract questions about the authentication plugin, please contact support@mundogis.se.', 'Qtiler Installation Complete', 'OK', 'Information')" >nul

echo ================================================================
echo  Qtiler has been installed successfully.
echo.
echo  Configuration written to .env:
echo    Setup mode:     %QTILER_SETUP_MODE%
echo    Profile:        %QTILER_INSTALL_MODE%
echo    Public URL:     %QTILER_PUBLIC_URL%
echo    Port:           %QTILER_PORT%
echo    IIS:            %QTILER_BEHIND_IIS%
echo    HTTPS:          %QTILER_HTTPS%
echo    Admin user:     admin
echo    Admin password: %QTILER_ADMIN_PASSWORD_DISPLAY%
echo    QtilerAuth:     %QTILERAUTH_INSTALL_STATUS%
echo.
echo  You can change these settings later in:
echo    %QTILER_ROOT%\.env
echo  Restart the QTiler service after editing .env.
echo.
echo  QtilerAuth policy:
echo    Eligible new installs enable the first 3-month trial.
echo    Updates preserve existing license/trial state and never renew a trial.
echo    If the preserved QtilerAuth license or trial is expired, QtilerAuth stays disabled.
echo  For questions about license contracts for this authentication
echo  plugin, please contact support@mundogis.se.
echo ================================================================
echo.
>>"%QTILER_INSTALL_LOG%" echo Install completed successfully.
pause
endlocal
exit /b 0

:ensure_node
REM ----------------------------------------------------------------------
REM  Ensure Node.js (latest LTS) is installed
REM ----------------------------------------------------------------------
>>"%QTILER_INSTALL_LOG%" echo Checking Node.js and npm.
where node >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%v in ('node -v') do set "NODE_VER=%%v"
    echo Node.js detected: !NODE_VER!
    set "NODE_MAJOR=!NODE_VER:v=!"
    for /f "tokens=1 delims=." %%M in ("!NODE_MAJOR!") do set "NODE_MAJOR=%%M"
    set "NODE_MAJOR_INVALID="
    for /f "delims=0123456789" %%M in ("!NODE_MAJOR!") do set "NODE_MAJOR_INVALID=%%M"
    if "!NODE_MAJOR!"=="" set "NODE_MAJOR_INVALID=empty"
    if defined NODE_MAJOR_INVALID (
        echo ERROR: Could not parse Node.js version: !NODE_VER!
        echo Please install the latest Node.js LTS from https://nodejs.org and run install.bat again.
        >>"%QTILER_INSTALL_LOG%" echo ERROR: Could not parse Node.js version: !NODE_VER!
        exit /b 1
    )
    if !NODE_MAJOR! LSS 20 (
        echo ERROR: Qtiler requires Node.js 20 LTS or newer. Detected: !NODE_VER!
        echo Please install the latest Node.js LTS from https://nodejs.org and run install.bat again.
        >>"%QTILER_INSTALL_LOG%" echo ERROR: Node.js version too old: !NODE_VER!
        exit /b 1
    )
) else (
    echo Node.js not found. Downloading the latest LTS installer...
    >>"%QTILER_INSTALL_LOG%" echo Node.js not found. Downloading latest LTS installer.
    set "NODE_MSI=%TEMP%\nodejs_lts_x64.msi"
    if exist "!NODE_MSI!" del /q "!NODE_MSI!" >nul 2>&1
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try { $lts = (Invoke-RestMethod 'https://nodejs.org/dist/index.json') | Where-Object { $_.lts } | Select-Object -First 1; $url = 'https://nodejs.org/dist/' + $lts.version + '/node-' + $lts.version + '-x64.msi'; Write-Host ('Downloading ' + $url); Invoke-WebRequest -Uri $url -OutFile '%TEMP%\nodejs_lts_x64.msi' -UseBasicParsing } catch { Write-Host ('ERROR: ' + $_.Exception.Message); exit 1 }"
    if not exist "!NODE_MSI!" (
        echo ERROR: Failed to download Node.js installer. Please install Node.js LTS manually from https://nodejs.org and re-run this installer.
        >>"%QTILER_INSTALL_LOG%" echo ERROR: failed to download Node.js installer.
        exit /b 1
    )
    echo Installing Node.js silently. This may take a few minutes...
    >>"%QTILER_INSTALL_LOG%" echo Installing Node.js silently from !NODE_MSI!.
    msiexec /i "!NODE_MSI!" /qn /norestart
    if errorlevel 1 (
        echo ERROR: Node.js installation failed ^(msiexec exit code %errorlevel%^).
        >>"%QTILER_INSTALL_LOG%" echo ERROR: Node.js msiexec failed with exit code %errorlevel%.
        exit /b 1
    )
    REM Refresh PATH from registry so node/npm are visible in this shell
    for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%b"
    set "PATH=!SYS_PATH!;%ProgramFiles%\nodejs;%PATH%"
    where node >nul 2>&1
    if errorlevel 1 (
        echo Node.js installed, but not visible in this shell.
        echo Please close this window, open a new one, and run install.bat again.
        >>"%QTILER_INSTALL_LOG%" echo ERROR: Node.js installed but not visible in PATH.
        exit /b 1
    )
    for /f "tokens=*" %%v in ('node -v') do set "NODE_VER=%%v"
    echo Node.js installed: !NODE_VER!
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo ERROR: npm is not available even though Node.js is installed.
    echo Repair or reinstall Node.js LTS, then run install.bat again.
    >>"%QTILER_INSTALL_LOG%" echo ERROR: npm not found after Node.js check.
    exit /b 1
)
for /f "tokens=*" %%v in ('npm.cmd -v') do set "NPM_VER=%%v"
echo npm detected: !NPM_VER!
>>"%QTILER_INSTALL_LOG%" echo Node.js !NODE_VER!, npm !NPM_VER!.
echo.
exit /b 0
