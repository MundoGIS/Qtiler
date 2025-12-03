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
if exist "C:\QGIS\bin\o4w_env.bat" (
	echo [RUN_QGIS_PY] calling o4w_env.bat at "C:\QGIS\bin\o4w_env.bat"
	call "C:\QGIS\bin\o4w_env.bat"
	goto :o4w_done
)
if exist "E:\QGIS\bin\o4w_env.bat" (
	echo [RUN_QGIS_PY] calling o4w_env.bat at "E:\QGIS\bin\o4w_env.bat"
	call "E:\QGIS\bin\o4w_env.bat"
	goto :o4w_done
)
echo [RUN_QGIS_PY] o4w_env.bat not found in common locations >&2
echo [RUN_QGIS_PY] o4w_env.bat not found in candidates: %O4W_CANDIDATES% >&2
:o4w_done

rem Finally, run python — prefer explicit PYTHON_EXE if provided
if defined PYTHON_EXE (
	if exist "%PYTHON_EXE%" (
		echo [RUN_QGIS_PY] using PYTHON_EXE: %PYTHON_EXE%
		"%PYTHON_EXE%" %*
		goto :eof
	)
)
echo [RUN_QGIS_PY] falling back to system python
python %*
