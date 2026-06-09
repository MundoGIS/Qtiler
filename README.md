<!--
This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
Copyright (C) 2025 MundoGIS.
-->

# Qtiler

Tile cache orchestration by **MundoGIS** to generate, inspect, and publish WMTS/XYZ caches and Vector Tiles from QGIS projects on Windows. Qtiler also produces WMS and WFS-T endpoints, supporting full OGC workflows (read and transactional vector editing). The platform is designed to run on Windows Server behind IIS, Apache HTTPD, or another reverse proxy using URL Rewrite so you can expose `/portal`, `/wmts`, and `/admin` under your organization’s domain. Contact MundoGIS if you need help designing or hardening that deployment.

![Qtiler](https://github.com/MundoGIS/Qtiler/blob/master/public/css/images/Qtiler.png)

## Features
- Upload `.qgs`/`.qgz` projects and extract layer metadata automatically.
- Generate caches per layer, per map theme, or entirely on demand, each with progress tracking and job history.
- Persist project zoom presets, extent, and scheduled recache windows.
- Serve cached tiles and expose a WMTS GetCapabilities endpoint (OGC WMTS 1.0.0, layers and themes) ready for GIS clients.
- Expose WMS 1.3.0 (GetCapabilities, tiled GetMap) and WFS 1.1.0 endpoints, including WFS-T (transactional editing for vector layers).
- Vector tiles support through the commercial VectorTiles plugin (MBTiles generation + TileJSON/Style endpoints).
- Built-in OpenLayers viewer with CRS awareness, WMTS/WMS/WFS modes, and VectorTiles mode.
- Origo Map integration via Qrigo plugin (Origo Map: https://github.com/origo-map/origo).
- Windows service helpers and reverse-proxy guidance for unattended production hosting.

## Commercial plugin support
Qtiler ships with an optional plugin ecosystem. Most plugins are now open source under MPL-2.0; only **QtilerAuth** is sold under a commercial licence (machine-bound, RSA-verified). Bundled versions:

| Plugin | Version | Licence | Purpose |
|---|---|---|---|
| QtilerAuth | `0.2.0` | Commercial | Multi-user auth, project ACLs, API keys |
| Qrigo | `0.1.0` | MPL-2.0 | Origo Map integration helpers |
| Qtiler2qwc | `0.1.0` | MPL-2.0 | QWC2 webmap bridge |
| Qtiler2Origo | `0.1.0` | MPL-2.0 | Origo webmap bridge |
| Qtiler2Hajk | `0.1.0` | MPL-2.0 | Hajk webmap bridge and CMS portal |
| VectorTiles | `0.2.0` | MPL-2.0 | MBTiles + TileJSON/Style endpoints |
| ProjectSearch | `0.1.0` | MPL-2.0 | Cross-project attribute search |
| QuantizedMesh | `0.1.0` | MPL-2.0 | Quantized-mesh terrain endpoints |

## QtilerAuth — the only commercial plugin (recommended)

If you are about to expose Qtiler outside an isolated LAN, **QtilerAuth** is the
plugin you want. It turns Qtiler into a multi-tenant, audit-ready GIS server
without forcing you to glue together half a dozen npm packages or rely on
external SaaS providers.

### Why GIS administrators buy QtilerAuth

- **Multi-user with project ACLs.** Mark each QGIS project as *public*,
  *authenticated* or *private*, and assign private projects to specific users.
  ACLs are enforced on every WMTS, WMS, WFS, WFS-T and Vector-Tiles call.
- **Multiple authentication methods on the same server.** Cookie sessions for
  the dashboard, JWT bearer tokens for SPAs, HTTP Basic for QGIS Desktop, and
  per-user **API keys** (query string `?api_key=` or `X-API-Key` header) for
  long-lived OGC clients.
- **Strong cryptography out of the box.** bcrypt password hashes (cost 10),
  SHA-256-hashed API keys (the plain key is shown only once), HMAC-SHA256 JWTs
  with a server-side revocation list (`jti`), and constant-time comparisons for
  all secret material.
- **Brute-force protection that respects real admins.** Per `(username, IP)`
  lockout (default 8 failed attempts in 15 minutes → 15 minute lockout with a
  proper `Retry-After`). A remote attacker hammering one account can never lock
  out a legitimate admin who logs in correctly from another office.
- **Built-in proof-of-work captcha — no third parties.** After the configured
  number of failed attempts (default 3), the next login silently solves a
  stateless HMAC-signed PoW challenge in the browser (~1–2 s with WebCrypto).
  No Google reCAPTCHA, no Cloudflare Turnstile, no third-party JavaScript, no
  tracking — perfect for **GDPR-sensitive deployments**. Cloudflare Turnstile,
  hCaptcha and reCAPTCHA are still supported as drop-in alternatives.
- **HTTP hardening with Helmet.** HSTS, X-Content-Type-Options, X-Frame-Options,
  Referrer-Policy and Cross-Origin-Resource-Policy are applied automatically;
  CORS is governed by an `AUTH_CORS_ALLOWLIST` (same-origin by default).
  `Cache-Control: no-store` is set on every response that may carry an
  `api_key`, and `api_key` is stripped from cached `GetCapabilities` documents
  to prevent leaks through proxies.
- **Auditable.** Every login attempt is recorded in SQLite (timestamp, IP,
  user-agent, result) and visible from the admin UI.
- **Offline licensing.** Activation is an RSA-signed key file verified locally
  — no internet round-trip, no "phone home", suitable for air-gapped or
  data-residency–constrained environments (Swedish/EU public sector, internal
  municipal networks, etc.).
- **Single SQLite file** (`data/auth.db`, WAL mode) for all auth state. Backup
  is a file copy; no external Postgres / Redis required.

### Try before you buy

QtilerAuth ships with a **three-months full-feature trial**. During trial it works
exactly like the licensed product so you can validate users, ACLs, brute-force
protection, captcha and API-key flows in your own environment. After expiry the
plugin auto-disables and the base Qtiler server keeps running.

Open the QtilerAuth admin page and click **“How it works & Security”** for an
in-product walkthrough of the architecture (available in English, Spanish,
Swedish and Norwegian). For licensing and pricing contact
[info@mundogis.se](mailto:info@mundogis.se) or visit
[mundogis.se](https://mundogis.se).

## Qtiler2qwc — QWC2 WebMap Integration

**Qtiler2qwc** is an open-source (MPL-2.0) plugin that embeds a full [QWC2](https://github.com/qgis/qwc2) (QGIS Web Client 2) webmap viewer inside Qtiler, enabling production-ready interactive web maps powered directly by your QGIS projects.

### What it provides

- **Hosted QWC2 viewer** — A fully configured QWC2 application served at `/Qtiler2qwc/webmap`, ready to use without a separate deployment.
- **Project publishing workflow** — Publish any uploaded QGIS project as an interactive webmap with a single click from the Qtiler2qwc admin UI.
- **Dynamic themes** — Generates and manages `themes.json` and `config.json` for QWC2, keeping published projects in sync with your QGIS layers, CRS, and extent.
- **3D terrain viewer** — Projects with 3D data can be viewed with quantized-mesh terrain integration (requires Qtiler terrain endpoints).
- **Search integration** — Attribute search powered by Qtiler's search service (`/Qtiler2qwc/search`).
- **Configurable toolbar** — Supports Print and Identify tools in the QWC2 top bar out of the box.

### Routes exposed by Qtiler2qwc

| Route | Description |
|---|---|
| `GET /Qtiler2qwc/webmap` | Serve the QWC2 webmap viewer (redirect to published app) |
| `GET /Qtiler2qwc/search` | Attribute search endpoint for QWC2 SearchBox |
| `GET /Qtiler2qwc/terrain/:projectId/:file` | Terrain tile proxy for 3D viewer |
| `GET /Qtiler2qwc/admin` | Admin UI for managing published webmaps |

### Publishing a project as a QWC2 webmap

1. Open the Qtiler dashboard and go to the **Plugins** section.
2. Click **Qtiler2qwc** to open the admin panel.
3. Use the **Publish project** button to select a QGIS project from your uploaded list.
4. Configure the map name, description, and optional background layers.
5. Click **Publish** — Qtiler2qwc generates the QWC2 theme, writes `themes.json` and `config.json`, and the webmap is immediately available at `/Qtiler2qwc/webmap`.

### Data storage

Published webmap configurations are stored under:
```
data/Qtiler2qwc/qwc2/current/   # Active config.json, themes.json
data/Qtiler2qwc/qwc2/published/ # Per-project JSON files (one per published map)
data/Qtiler2qwc/state.json      # Plugin state (active project, settings)
```

### Combining Qtiler2qwc with QtilerAuth

When QtilerAuth is active, the webmap routes respect project-level access control:
- Public projects are accessible without login.
- Protected projects require the user to be authenticated (session cookie or API key).
- The QWC2 viewer will prompt login automatically for protected projects.

### Toolbar configuration (config.json)

The QWC2 toolbar items are defined in `data/Qtiler2qwc/qwc2/current/config.json` under `plugins.desktop[TopBar].toolbarItems`. Default configuration:
```json
"toolbarItems": [
  { "key": "Print", "icon": "print" },
  { "key": "Identify", "icon": "identify_region", "mode": "Region" }
]
```
Edit this file directly to add or remove toolbar tools (e.g. Share, Measure, etc.).

## Qtiler2Hajk — Hajk WebMap Integration & Public Portal

**Qtiler2Hajk** is an open-source (MPL-2.0) bridge plugin that embeds the [Hajk](https://github.com/hajkmap/Hajk) web map viewer inside Qtiler. It also provides a visual Content Management System (CMS) to build a public Maps Portal (`/Qtiler2Hajk/maps`).

### What it provides

- **Hosted Hajk viewer** — Hajk is downloaded from a pinned GitHub release and served dynamically without needing a separate React/Node deployment.
- **Project publishing workflow** — Publish layered maps directly from QGIS projects using the graphical admin UI.
- **Dynamic configurations** — Automatic translation of Qtiler layers into Hajk `simpleMapAndLayersConfig.json` equivalents, preserving WMS outputs and WFS/vector properties alongside OGC editing tools.
- **CMS / Portal Editor** — A visual page builder to construct the landing page of the maps portal, using hero banners, rich text, side-by-side cards, and map galleries.
- **Thumbnail generation** — Automatically generates layer thumbnails to power Hajk legends and portal gallery views.

### Routes exposed by Qtiler2Hajk

| Route | Description |
|---|---|
| `GET /plugins/Qtiler2Hajk/hajk/` | The interactive Hajk map viewer (requires `?qtiler_profile=<mapped-profile>`) |
| `GET /Qtiler2Hajk/maps` | The public Maps Portal landing page |
| `GET /plugins/Qtiler2Hajk/admin-ui/` | Admin UI for publishing Hajk maps and editing the portal |

### Publishing a project as a Hajk map

1. Open the Qtiler dashboard and go to **Plugins → Qtiler2Hajk**.
2. Go to the **Maps** tab to create a new profile or edit an existing one.
3. Select a main QGIS project, activate the desired layers (base maps and overlays), and decide which layers should act as WFS tools.
4. Pick which Hajk visual tools you want exposed (e.g. Draw, Print, Search, Bookmarks).
5. Click **Publish** — the map becomes available to the viewer and portal instantly.

## Qtiler2Origo — Origo WebMap Integration

**Qtiler2Origo** is an open-source (MPL-2.0) bridge plugin that embeds the [Origo](https://github.com/origo-map/origo) web map viewer inside Qtiler. It complements Qtiler2qwc by offering a lightweight, mobile-friendly viewer for users who don't need the full QWC2 stack.

### Qrigo vs Qtiler2Origo

Both plugins integrate with the [Origo](https://github.com/origo-map/origo) viewer, but they serve very different audiences:

- **Qrigo** is for users who already run a **standard Origo-map installation on their own server**. It only generates ready-to-paste JSON snippets (source + layer entries) that you copy into your existing Origo `index.json` to add Qtiler WMS/WMTS/WFS layers. It does not host a viewer.
- **Qtiler2Origo** is the plugin that **installs Origo on top of Qtiler itself**. It downloads a pinned Origo build, lets you create and configure each map graphically using the QGIS library, and reuses Qtiler's cache and the WMS/WFS layers from projects published in Qtiler. Choose this if you want a complete, in-Qtiler Origo experience without maintaining a separate Origo server.

### What it provides

- **Hosted Origo viewer** — Origo is downloaded from a pinned GitHub release and served at `/plugins/Qtiler2Origo/Origo`. No separate Origo deployment is required.
- **Project publishing workflow** — Publish any QGIS project tagged as background as an Origo map directly from the Qtiler2Origo admin UI.
- **Auto-generated configuration** — Qtiler2Origo writes the Origo configuration file for each published map (CRS, zoom, centre, base map, controls) and reloads it in place on edits.
- **Per-map branding** — Upload a logo and choose which controls (search, measure, draw, print, ...) are exposed in the toolbar.
- **QtilerAuth-aware visibility** — Public, authenticated, and private projects from QtilerAuth are honoured automatically; users only see maps they're allowed to open.
- **Bridge-friendly catalog** — Exposes a JSON projects catalog endpoint for external integrations.

### Routes exposed by Qtiler2Origo

| Route | Description |
|---|---|
| `GET /plugins/Qtiler2Origo/Origo/` | Origo viewer entry point (requires `?map=<name>`) |
| `GET /plugins/Qtiler2Origo/admin-ui/` | Admin UI for publishing and managing Origo maps |
| `GET /plugins/Qtiler2Origo/api/maps` | JSON catalog of published Origo maps |

### Publishing a project as an Origo map

1. Open the Qtiler dashboard and go to **Plugins → Qtiler2Origo**.
2. On the **Setup** tab, click **Install Origo** and pick a release tag from the GitHub release list.
3. Switch to the **Maps** tab and select a project tagged as background.
4. Configure the map name, CRS, zoom and centre, and choose the controls you want enabled.
5. Click **Publish** — the map is immediately available at `/plugins/Qtiler2Origo/Origo/?map=<name>`.

### Combining Qtiler2Origo with QtilerAuth

When QtilerAuth is active:
- **Public** projects are reachable without login.
- **Authenticated** and **private** projects require a valid session or API key, and the catalog endpoint filters maps to those the caller is authorised to see.
- Cookie-based sessions and `?api_key=` / `x-api-key` headers are both supported.

### Data storage

```
data/Qtiler2Origo/state.json                # Plugin state (installed Origo version, settings)
data/Qtiler2Origo/maps/<map-name>.json      # One file per published Origo map
plugins/Qtiler2Origo/Origo/                 # Downloaded Origo build (filled by the installer)
```

## VectorTiles auth in QGIS (protected projects)
If your project is protected by QtilerAuth, avoid shared URLs and use user-based credentials.

1. API key (recommended for service-style access)
   - In QGIS, add a Vector Tile layer using:
   - `/plugins/VectorTiles/style/<project>.json?api_key=<YOUR_API_KEY>`
   - Layer-specific style example:
   - `/plugins/VectorTiles/style/<project>/<layer>.json?layers=<layer>&api_key=<YOUR_API_KEY>`
2. Username/password (HTTP Basic auth)
   - Configure credentials in QGIS Authentication Manager.
   - Use style URL without key:
   - `/plugins/VectorTiles/style/<project>.json`

Notes:
- `?token=...` URLs are best for short-lived sharing, not as a common credential for all users.
- QtilerAuth also accepts API key in header `x-api-key`, but query `api_key` is usually simpler in GIS clients.

## System Requirements
- Windows 10/11 or Windows Server 2019+ (64-bit).
- [OSGeo4W](https://trac.osgeo.org/osgeo4w/) or a standalone QGIS install (supplies Python + QGIS libraries).
- Node.js 18 or newer.
- Git (recommended) to clone the repository.

## QGIS compatibility notice
- Supported: QGIS 3.4 and newer within the 3.x line (Qt5-based builds).
- Not supported: QGIS 4.x (Qt6-based).

Qtiler currently targets the QGIS 3.x runtime stack and Python bindings. Running with QGIS 4.x is expected to fail due to major dependency and API/runtime changes.

## Minimum Windows resources (recommended baseline)
For stable production behavior (cache jobs, WMS/WFS, and optional on-demand rendering), use at least:

- CPU: 8 logical cores (minimum 4 for small demos)
- RAM: 32 GB (minimum 16 GB for small demos)
- Storage: NVMe SSD, 200 GB free (minimum 80 GB)
- Network: 1 Gbps NIC for multi-user GIS access

Sizing guidance:
- Small pilots (1-5 users, light layers): 4 vCPU / 16 GB RAM
- Normal deployments (5-20 users, mixed raster+vector): 8 vCPU / 32 GB RAM
- Heavy deployments (20+ users, frequent recache/on-demand): 12-16 vCPU / 64 GB RAM

These values assume QGIS rendering on the same machine as the Node service.

## Prepare the QGIS environment
1. Install OSGeo4W (Advanced Install) or a QGIS 3.x standalone build.
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

## Initial admin login (required after install)
After installation, sign in with the default admin account:

- Username: `admin`
- Password: value from `QTILER_DEFAULT_ADMIN_PASSWORD`.
   If not set, the default is `MundoGIS-2026`.

For security, change this password immediately after your first login.
Do this from the backend admin interface (`/admin`) in the authentication/user management section.

### Repository layout
```
Qtil
   qgisprojects/     # Uploaded .qgs/.qgz files (includes a demo project in qgisprojects/demo2)
   cache/            # Generated tiles and index metadata
   plugins/          # Optional plugins (Qrigo, ProjectSearch, custom modules)
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
5. **Inspect & share** – Preview layers in the OpenLayers viewer and copy WMTS URLs. The GetCapabilities endpoint lives at `/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&project=<id>`.

## On-demand WMTS/XYZ tiles
Qtiler renders tiles live whenever a request misses the cache. When `/wmts/:project/:layer/:z/:x/:y.png` (or `/themes/...`) cannot find the PNG on disk, the backend runs `python/generate_cache.py --single` to build just that tile, stores it under `cache/<project>/...`, and serves the result immediately. Concurrency is capped (2 workers by default) so misses are queued safely via FIFO. CRS-aware tile-grid derivation ensures on-demand tiles align with pre-cached tiles. See `README_on_demand.md` for a deeper walkthrough.


## Supported OGC service versions
- **WMTS**: 1.0.0
- **WMS**: 1.3.0
- **WFS**: 1.1.0 and 2.0.0 (WFS-T transactional editing is guaranteed for 1.1.0; default version negotiation prefers 2.0.0)

## Demo project
A demo QGIS project is included in `qgisprojects/demo2` so you can test the full workflow out of the box.

## Demo data attribution (OSM)
If you use the bundled demo vector layers derived from OpenStreetMap, include this attribution in user-facing maps and documentation:

- `© OpenStreetMap contributors`

OpenStreetMap data is available under the Open Database License (ODbL):
- https://www.openstreetmap.org/copyright

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
Qtiler exposes WFS 1.1.0 and 2.0.0 endpoints for vector layers.

### WFS read (GetCapabilities / DescribeFeatureType / GetFeature)
- GetCapabilities:
   - `/wfs?SERVICE=WFS&REQUEST=GetCapabilities&project=<id>`
- DescribeFeatureType:
   - `/wfs?SERVICE=WFS&REQUEST=DescribeFeatureType&TYPENAME=<layer>&project=<id>`
- GetFeature (GeoJSON):
   - `/wfs?SERVICE=WFS&REQUEST=GetFeature&TYPENAME=<layer>&OUTPUTFORMAT=application/json&project=<id>`

### WFS-T editing (Transaction)
WFS-T uses `POST /wfs?project=<id>` with an XML `<wfs:Transaction>` body. Clients like Origo Map (https://github.com/origo-map/origo) can use this for insert/update/delete.

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

Need assistance designing the reverse-proxy rules or securing the stack? Contact MundoGIS at [mundogis.se](https://mundogis.se) or email support@mundogis.se.

## Environment variables (quick reference)
```
PORT=3000
CACHE_DIR=C:\cache\cache
QGIS_PREFIX=C:\OSGeo4W\apps\qgis
OSGEO4W_BIN=C:\OSGeo4W\bin
PYTHON_EXE=C:\OSGeo4W\bin\python.exe
QT_PLUGIN_PATH=C:\OSGeo4W\apps\qgis\qtplugins
QTILER_DEFAULT_ADMIN_PASSWORD=MundoGIS-2026
PROJECT_UPLOAD_MAX_BYTES=209715200
```

## Production tips
- Place the repository on SSD storage; caches grow quickly.
- Use a dedicated Windows account/service user with access to `cache/` and `logs/`.
- Schedule log rotation and cache cleanup via Task Scheduler.
- Keep QGIS and Node.js versions aligned across dev/prod to avoid rendering drift.

## Portal
The public portal at `/portal` lists all projects the current user can access. Each project card provides:
- Copy buttons for WMTS, WMS, WFS, VectorTiles Style-URL and Source-URL.
- Viewer links (WMTS, WMS, WFS, VectorTiles) grouped under a "Viewers" box.
- Per-layer XYZ copy and viewer links for cached layers and themes.

Public projects are visible without login. Protected projects require the user to be authenticated via QtilerAuth.

## API key authentication
When QtilerAuth is installed and a project is protected:
- All copied URLs from the dashboard, portal, and VectorTiles plugin automatically include `?api_key=<key>`.
- WMTS GetCapabilities embeds the `api_key` in KVP URLs and REST `ResourceURL` templates.
- WMS GetCapabilities embeds the `api_key` in `OnlineResource` hrefs.
- This ensures GIS clients (QGIS, ArcGIS, etc.) carry the key on every subsequent tile/map/feature request.
- API keys are also accepted via `x-api-key` HTTP header.

## Multi-language UI
The admin console, portal, guide, and VectorTiles dashboard support four languages:
- **English** (default)
- **Spanish** (Español)
- **Swedish** (Svenska)
- **Norwegian** (Norsk)

Switch language from the selector in the navigation bar. The preference is persisted via cookie.

## Third-party licenses
See `THIRD-PARTY-LICENSES.txt` for a complete list of third-party software and their licenses.

## License
Qtiler is licensed under the **Mozilla Public License, v. 2.0** (MPL-2.0).
Commercial plugins (QtilerAuth, VectorTiles, Qrigo, ProjectSearch) are separately licensed by MundoGIS.

---
Questions or need a tailored deployment? Reach out to MundoGIS for support, private builds, or hands-on assistance with IIS/Apache URL Rewrite configurations.

