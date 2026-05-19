@echo off
REM ==========================================================================
REM  Qtiler Uninstaller by MundoGIS
REM  Removes the Qtiler Windows service. Configuration and data are preserved.
REM ==========================================================================
setlocal
title Qtiler Uninstaller by MundoGIS

REM --- Self-elevate to administrator ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"

echo ================================================================
echo                  Qtiler Uninstaller by MundoGIS
echo ================================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not available on this machine.
    echo Cannot uninstall the Qtiler service automatically.
    echo.
    echo You can remove it manually with:
    echo     sc stop  QTiler
    echo     sc delete QTiler
    pause
    exit /b 1
)

echo Stopping and removing the Qtiler Windows service...
node service\uninstall-service.js
if errorlevel 1 (
    echo WARNING: Uninstall command returned an error.
    echo The service may already have been removed.
)

echo.
echo ================================================================
echo  Qtiler service has been removed.
echo.
echo  Configuration files, cache and data are kept under:
echo     %cd%
echo  Delete that folder manually if you want a full cleanup.
echo.
echo  Contact MundoGIS at support@mundogis.se for support.
echo ================================================================
echo.
pause
endlocal
exit /b 0
