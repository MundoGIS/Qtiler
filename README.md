<!--
This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
Copyright (C) 2025 MundoGIS.
-->

# Qtiler

Tile cache orchestration by **MundoGIS** to generate, inspect, and publish WMTS/XYZ caches from QGIS projects on Windows.

## Features
- Upload `.qgs`/`.qgz` projects and extract layer metadata automatically.
- Generate caches per layer or per map theme (composed mosaics) with on-screen status tracking.
- Persist project zoom preferences, extent, and recache schedules.
- Serve cached tiles and expose WMTS GetCapabilities, including theme-based layers.
- Built-in Leaflet viewer with CRS support, scale control, and deep zoom preview.
- Optional Windows service scripts for unattended execution.

## System Requirements
- Windows 10/11 (64-bit).
- [OSGeo4W](https://trac.osgeo.org/osgeo4w/) or a full QGIS installation (provides Python + QGIS libraries).
- Node.js 18 or newer.
- Git (recommended) to clone the repository.

## 1. Prepare QGIS / OSGeo4W
1. Install OSGeo4W (Advanced Install) or the latest QGIS standalone build.
2. Confirm the following binaries exist and note their paths:
   - `C:\OSGeo4W\bin\python.exe` (or the Python bundled with QGIS).
   - `C:\OSGeo4W\apps\qgis` (QGIS prefix path).
3. Add these variables to the system or a local `.env` file (recommended):
   ```ini
   QGIS_PREFIX=C:\OSGeo4W\apps\qgis
   OSGEO4W_BIN=C:\OSGeo4W\bin
   PYTHON_EXE=C:\OSGeo4W\bin\python.exe
   O4W_BATCH=C:\OSGeo4W\bin\o4w_env.bat
   ```
   Adjust paths if you installed QGIS elsewhere.

## 2. Clone and Install Node Dependencies
```powershell
cd C:\
git clone https://github.com/<your-account>/<your-repo>.git qtiler
cd qtiler
npm install
```

## 3. Folder Layout
```
qtiler/
  public/           # Frontend dashboard + viewer
  python/           # QGIS helpers (extract info, generate cache)
  qgisprojects/     # Drop .qgz/.qgs files here or upload via UI
  cache/            # Generated tiles and project index.json files
  logs/             # Runtime logs (if enabled)
  service/          # Windows service helpers (optional)
```

## 4. Running the Server
```powershell
# From the repository root
npm start
# or
node server.js
```
The server listens on `http://localhost:3000` by default. Adjust the port via the `PORT` environment variable if needed.

### Automatic Windows Service (optional)
Use the helper scripts to install or remove a background service:
```powershell
# Install the service
node service\install-service.js

# Uninstall the service
node service\uninstall-service.js
```
Both scripts require administrator privileges.

## 5. Workflow Overview
1. **Upload or refresh a project**: Use "Upload project" or place files directly under `qgisprojects/` and click "Reload layers".
2. **Define map themes in QGIS**: Save desired layer combinations in the Map Themes panel before uploading. Themes appear under "Map themes" in the dashboard.
3. **Set extent and zooms**:
   - Adjust global min/max zoom inputs (defaults to 0/0).
   - Open "Show extent map" to draw or fine-tune the bounding box (supports high zoom and WGS84 coordinates).
4. **Generate caches**:
   - Per layer via the play icon.
   - Batch all layers via "Cache all layers" (records parameters for recache automation).
   - Per theme using the play icon in the "Map themes" block (produces composite WMTS tiles stored under `_themes/<theme>`).
5. **Inspect & share**:
   - Use "Open map viewer" for a Leaflet preview with scale control and CRS awareness.
   - Copy WMTS URLs from each layer or theme. The service exposes `/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&project=<id>`.

## 6. Environment Variables (optional)
Create a `.env` file in the repository root to override defaults:
```
PORT=3000
CACHE_DIR=C:\cache\cache
QGIS_PREFIX=C:\OSGeo4W\apps\qgis
OSGEO4W_BIN=C:\OSGeo4W\bin
PYTHON_EXE=C:\OSGeo4W\bin\python.exe
O4W_BATCH=C:\OSGeo4W\bin\o4w_env.bat
PROJECT_UPLOAD_MAX_BYTES=209715200
```

## 7. Troubleshooting
- **Leaflet viewer reports CRS issues**: Ensure `proj4` knows the EPSG code (register custom definitions in `public/viewer.html`).
- **Python/QGIS scripts fail to start**: Confirm the QGIS paths in `.env` are correct and that `o4w_env.bat` launches python successfully.
- **Theme list empty**: Save Map Themes inside QGIS before uploading and refresh the project in the dashboard.
- **Service fails to install**: Run PowerShell as administrator and verify Node.js is in `PATH`.

## 8. Production Tips
- Place the repository on a fast SSD; WMTS caches can grow quickly.
- Use a dedicated Windows account for the service with access to the `cache/` directory.
- Schedule regular cleanups of `logs/` and old caches via Windows Task Scheduler if storage is constrained.

Ready to publish? Commit the repository (including this README), push to GitHub, and share **Qtiler by MundoGIS** with your team.
