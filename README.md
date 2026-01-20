<!--
This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
Copyright (C) 2025 MundoGIS.
-->

# Qtiler

Tile cache orchestration by **MundoGIS** to generate, inspect, and publish WMTS/XYZ caches from QGIS projects on Windows. The platform is designed to run on Windows Server behind IIS, Apache HTTPD, or another reverse proxy using URL Rewrite so you can expose `/portal`, `/wmts`, and `/admin` under your organization’s domain. Contact MundoGIS if you need help designing or hardening that deployment.

## Features
- Upload `.qgs`/`.qgz` projects and extract layer metadata automatically.
- Generate caches per layer, per map theme, or entirely on demand, each with progress tracking and job history.
- Persist project zoom presets, extent, and scheduled recache windows.
- Serve cached tiles and expose a WMTS GetCapabilities endpoint (layers and themes) ready for GIS clients.
- Built-in Leaflet viewer with CRS awareness, on/off layer toggles, and WMTS URL helpers.
- Optional QtilerAuth plugin (one-time ZIP download) to manage users, roles, and customer-specific WMTS access.
- Windows service helpers and reverse-proxy guidance for unattended production hosting.

## System Requirements
- Windows 10/11 or Windows Server 2019+ (64-bit).
- [OSGeo4W](https://trac.osgeo.org/osgeo4w/) or a standalone QGIS install (supplies Python + QGIS libraries).
- Node.js 18 or newer.
- Git (recommended) to clone the repository.

## Prepare the QGIS environment
1. Install OSGeo4W (Advanced Install) or the latest QGIS standalone build.
2. Verify these paths exist:
   - `C:\OSGeo4W\bin\python.exe` (or your QGIS Python runtime).
   - `C:\OSGeo4W\apps\qgis` (QGIS prefix).
3. Create a `.env` file in the repo root and add:
   ```ini
   OSGEO4W_BIN=C:\OSGeo4W\bin
   PYTHON_EXE=C:\OSGeo4W\bin\python.exe
   QGIS_PREFIX=C:\OSGeo4W\apps\qgis
   QT_PLUGIN_PATH=C:\OSGeo4W\apps\qgis\qtplugins
   ```
   Adjust the paths if you installed QGIS elsewhere. The server validates these variables on boot and logs any gaps.

## Install dependencies
```powershell
cd C:\
git clone https://github.com/<your-account>/<your-repo>.git Qtiler
cd Qtiler
npm install
```

### Repository layout
```
Qtiler/
  public/           # Dashboard + portal UI
  python/           # QGIS helpers (extract info, generate cache)
  qgisprojects/     # Uploaded .qgs/.qgz files
  cache/            # Generated tiles and index metadata
  plugins/          # Optional plugins (QtilerAuth, custom modules)
  logs/             # Runtime logs
  service/          # Windows service helpers
  temp_uploads/     # Multer workspace for uploads
```

## Run the development server
```powershell
npm start
# or
node server.js
```
The server listens on `http://localhost:3000` by default; override with `PORT` in `.env`.

## Dashboard workflow
1. **Upload or refresh a project** – Use *Upload project* or copy `.qgs/.qgz` files into `qgisprojects/`, then click *Reload layers*.
2. **Define map themes in QGIS** – Save Map Themes (Kartteman) before uploading so composites appear automatically.
3. **Set extent and zooms** – Adjust global min/max zooms and use *Show extent map* to draw WGS84 bounding boxes.
4. **Generate caches** – Trigger per-layer jobs, cache all layers, or build theme mosaics. Each run logs parameters for future recache batches.
5. **Inspect & share** – Preview layers in the Leaflet viewer and copy WMTS URLs. The GetCapabilities endpoint lives at `/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&project=<id>`.

## On-demand WMTS/XYZ tiles
Qtiler can render tiles live whenever a request misses the cache. When `/wmts/:project/:layer/:z/:x/:y.png` (or `/themes/...`) cannot find the PNG on disk, the backend runs `python/generate_cache.py --single` to build just that tile, stores it under `cache/<project>/...`, and serves the result immediately. Concurrency is capped (2 workers by default) so misses are queued safely. See `README_on_demand.md` for a deeper walkthrough and test commands.

## WMS (GetCapabilities + tiled GetMap)
Qtiler exposes a lightweight WMS 1.3.0 endpoint intended for tiled clients and GIS integration.

- GetCapabilities (per project):
   - `/wms?SERVICE=WMS&REQUEST=GetCapabilities&project=<id>`
- GetMap (tiled):
   - `/wms?SERVICE=WMS&REQUEST=GetMap&project=<id>&LAYERS=<project>_<layer>&CRS=<crs>&BBOX=minx,miny,maxx,maxy&WIDTH=256&HEIGHT=256&FORMAT=image/png`

Notes:
- The WMS layer naming convention is `LAYERS=<project>_<layer>` (underscores are used to keep URLs compact).
- For performance, WMS GetMap is designed to align to the same tile grids used by WMTS/XYZ caching.

## WFS (read) + WFS-T (editing)
Qtiler exposes a minimal WFS 1.1.0 endpoint for vector layers.

### WFS read (GetCapabilities / DescribeFeatureType / GetFeature)
- GetCapabilities:
   - `/wfs?SERVICE=WFS&REQUEST=GetCapabilities&project=<id>`
- DescribeFeatureType:
   - `/wfs?SERVICE=WFS&REQUEST=DescribeFeatureType&TYPENAME=<layer>&project=<id>`
- GetFeature (GeoJSON):
   - `/wfs?SERVICE=WFS&REQUEST=GetFeature&TYPENAME=<layer>&OUTPUTFORMAT=application/json&project=<id>`

### WFS-T editing (Transaction)
WFS-T uses `POST /wfs?project=<id>` with an XML `<wfs:Transaction>` body. Clients like Origo can use this for insert/update/delete.

Requirements and caveats:
- Transactions are admin-only when authentication is enabled.
- The underlying datasource must allow writes (DB permissions, constraints, triggers, etc.).
- Primary keys are typically generated by the database. If a layer uses a NOT NULL PK without a default/identity, inserts can fail unless the datasource is fixed.

Tip: transaction failures are logged to `logs/project-<id>.log` as `WFS-T Transaction error[...]`.

## Logs and troubleshooting
- `Tile hit` – tile was served from cache.
- `Tile miss` – tile was generated on demand.
- `Tile render error` – Python/QGIS failed to render (see stack trace).

- `WFS-T Transaction result` – summary (inserted/updated/deleted/errors).
- `WFS-T Transaction error[...]` – detailed commit/provider error for edits.

If generation fails:
- Double-check `.env` paths and ensure Python can import QGIS modules.
- Run `python/generate_cache.py --single ...` manually to capture stderr.
- Inspect `logs/project-<id>.log` for details.

## Windows service (optional)
Install or remove the background service with:
```powershell
# Install
node service\install-service.js

# Uninstall
node service\uninstall-service.js
```
Run these commands in an elevated terminal. The service uses your `.env` and writes to the same log directory.

## Deploying behind IIS or Apache HTTPD
Most production setups place Qtiler on Windows Server and expose it via IIS or Apache HTTPD using URL Rewrite:
1. Run Qtiler on an internal port (for example `http://localhost:3000`).
2. Configure IIS URL Rewrite (or Apache `mod_proxy`/`mod_rewrite`) to forward `/portal`, `/wmts`, `/admin`, `/plugins`, and `/viewer` to that port.
3. Add HTTPS certificates and harden headers/caching rules at the proxy level.
4. Optionally keep the Node service internal and only publish the proxy site.

Need assistance designing the reverse-proxy rules or securing the stack? Contact MundoGIS at [mundogis.se](https://mundogis.se) or email abel.gonzalez@mundogis.se.

## Environment variables (quick reference)
```
PORT=3000
CACHE_DIR=C:\cache\cache
QGIS_PREFIX=C:\OSGeo4W\apps\qgis
OSGEO4W_BIN=C:\OSGeo4W\bin
PYTHON_EXE=C:\OSGeo4W\bin\python.exe
QT_PLUGIN_PATH=C:\OSGeo4W\apps\qgis\qtplugins
PROJECT_UPLOAD_MAX_BYTES=209715200
```

## Production tips
- Place the repository on SSD storage; caches grow quickly.
- Use a dedicated Windows account/service user with access to `cache/` and `logs/`.
- Schedule log rotation and cache cleanup via Task Scheduler.
- Keep QGIS and Node.js versions aligned across dev/prod to avoid rendering drift.

---
Questions or need a tailored deployment? Reach out to MundoGIS for support, private builds, or hands-on assistance with IIS/Apache URL Rewrite configurations.

