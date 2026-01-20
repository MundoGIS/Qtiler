REM
REM This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
REM If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
REM Copyright (C) 2025 MundoGIS.
REM
@echo off
REM Wrapper to run QGIS Python with a flexible o4w environment.
REM It prefers the OSGEO4W_BIN env var if present, otherwise falls back to C:\QGIS\bin.

rem Build a list of candidate o4w_env.bat locations and call the first that exists
if defined OSGEO4W_BIN (
	if exist "%OSGEO4W_BIN%\o4w_env.bat" (
		echo [RUN_QGIS_PY] calling o4w_env.bat at "%OSGEO4W_BIN%\o4w_env.bat"
		call "%OSGEO4W_BIN%\o4w_env.bat"
		goto :o4w_done
	)
)
if defined QGIS_PREFIX (
	if exist "%QGIS_PREFIX%\..\bin\o4w_env.bat" (
		echo [RUN_QGIS_PY] calling o4w_env.bat at "%QGIS_PREFIX%\..\bin\o4w_env.bat"
		call "%QGIS_PREFIX%\..\bin\o4w_env.bat"
		goto :o4w_done
	)
)
:o4w_warn
echo [RUN_QGIS_PY] o4w_env.bat not found in provided environment variables >&2
echo [RUN_QGIS_PY] set `OSGEO4W_BIN` or `QGIS_PREFIX` in .env and restart >&2
:o4w_done
:o4w_done

rem Finally, run python — prefer explicit PYTHON_EXE if provided
if defined PYTHON_EXE (
	if exist "%PYTHON_EXE%" (
		echo [RUN_QGIS_PY] using PYTHON_EXE: %PYTHON_EXE%
		"%PYTHON_EXE%" %*
		goto :eof
	) else (
		echo [RUN_QGIS_PY] PYTHON_EXE is defined but not found: %PYTHON_EXE% >&2
	)
)
echo [RUN_QGIS_PY] No usable PYTHON_EXE found; ensure `PYTHON_EXE` is set in .env and points to a valid python executable >&2
exit /b 2
