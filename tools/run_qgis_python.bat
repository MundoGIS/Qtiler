@echo off
REM
REM This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
REM If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
REM Copyright (C) 2025 MundoGIS.
REM
REM Wrapper to run QGIS Python with a flexible o4w environment.
REM It prefers the OSGEO4W_BIN env var if present, otherwise falls back to C:\QGIS\bin.

setlocal enabledelayedexpansion

rem Build a list of candidate o4w_env.bat locations and call the first that exists
if defined OSGEO4W_BIN (
	if exist "%OSGEO4W_BIN%\o4w_env.bat" (
		echo [RUN_QGIS_PY] calling o4w_env.bat at "%OSGEO4W_BIN%\o4w_env.bat" >&2
		call "%OSGEO4W_BIN%\o4w_env.bat"
		goto :o4w_done
	)
)
if defined QGIS_PREFIX (
	if exist "%QGIS_PREFIX%\..\bin\o4w_env.bat" (
		echo [RUN_QGIS_PY] calling o4w_env.bat at "%QGIS_PREFIX%\..\bin\o4w_env.bat" >&2
		call "%QGIS_PREFIX%\..\bin\o4w_env.bat"
		goto :o4w_done
	)
)
:o4w_warn
echo [RUN_QGIS_PY] o4w_env.bat not found in provided environment variables >&2
echo [RUN_QGIS_PY] set `OSGEO4W_BIN` or `QGIS_PREFIX` in .env and restart >&2
:o4w_done

rem Normalize QGIS_PREFIX for standalone installs and export QGIS_PREFIX_PATH explicitly.
if not defined QGIS_PREFIX (
	if defined OSGEO4W_BIN (
		if exist "%OSGEO4W_BIN%\..\apps\qgis" set "QGIS_PREFIX=%OSGEO4W_BIN%\..\apps\qgis"
	)
)
if defined QGIS_PREFIX (
	if exist "%QGIS_PREFIX%\apps\qgis" set "QGIS_PREFIX=%QGIS_PREFIX%\apps\qgis"
	set "QGIS_PREFIX_PATH=%QGIS_PREFIX%"
	set "PATH=%QGIS_PREFIX%\bin;%PATH%"
	if exist "%QGIS_PREFIX%\python" set "PYTHONPATH=%QGIS_PREFIX%\python;%QGIS_PREFIX%\python\plugins;%PYTHONPATH%"
)

set "_QTILER_PYEXE="

rem Finally, run python — prefer explicit PYTHON_EXE if provided
if defined PYTHON_EXE (
	if exist "%PYTHON_EXE%" (
		echo [RUN_QGIS_PY] using PYTHON_EXE: %PYTHON_EXE% >&2
		"%PYTHON_EXE%" -c "import qgis" >nul 2>&1
		if not errorlevel 1 (
			set "_QTILER_PYEXE=%PYTHON_EXE%"
			goto :run_python
		) else (
			echo [RUN_QGIS_PY] PYTHON_EXE cannot import qgis, trying fallbacks... >&2
		)
	) else (
		echo [RUN_QGIS_PY] PYTHON_EXE is defined but not found: %PYTHON_EXE% >&2
	)
)

rem Prefer direct python.exe from OSGEO4W bin before wrapper bat files.
if defined OSGEO4W_BIN (
	if exist "%OSGEO4W_BIN%\python.exe" (
		echo [RUN_QGIS_PY] trying %OSGEO4W_BIN%\python.exe >&2
		"%OSGEO4W_BIN%\python.exe" -c "import qgis" >nul 2>&1
		if not errorlevel 1 (
			set "_QTILER_PYEXE=%OSGEO4W_BIN%\python.exe"
			goto :run_python
		)
	)
)

rem Try common OSGeo4W wrapper launchers first
if defined OSGEO4W_BIN (
	if exist "%OSGEO4W_BIN%\python-qgis-ltr.bat" (
		echo [RUN_QGIS_PY] using %OSGEO4W_BIN%\python-qgis-ltr.bat >&2
		call "%OSGEO4W_BIN%\python-qgis-ltr.bat" %*
		exit /b !ERRORLEVEL!
	)
	if exist "%OSGEO4W_BIN%\python-qgis.bat" (
		echo [RUN_QGIS_PY] using %OSGEO4W_BIN%\python-qgis.bat >&2
		call "%OSGEO4W_BIN%\python-qgis.bat" %*
		exit /b !ERRORLEVEL!
	)
)

rem Fallback to python from PATH (after o4w_env it should be QGIS Python)
where python >nul 2>&1
if not errorlevel 1 (
	echo [RUN_QGIS_PY] using python from PATH >&2
	python -c "import qgis" >nul 2>&1
	if not errorlevel 1 (
		set "_QTILER_PYEXE=python"
		goto :run_python
	)
)

echo [RUN_QGIS_PY] No usable QGIS Python found. Configure OSGEO4W_BIN and/or PYTHON_EXE to a QGIS-enabled Python interpreter. >&2
exit /b 2

:run_python
"!_QTILER_PYEXE!" %*
exit /b !ERRORLEVEL!
