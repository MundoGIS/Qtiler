# Qtiler: Tiles On-Demand

## What does this feature do?
It allows the server to generate and serve WMTS/XYZ tiles on demand alongside the traditional pre-cache mode. If a tile does not exist on disk, the backend calls QGIS via Python and renders it in real time.

## How it works
- The routes `/wmts/:project/:layer/:z/:x/:y.png` and `/wmts/:project/themes/:theme/:z/:x/:y.png` first look for the tile on disk.
- If it is missing or invalid, the script `python/generate_cache.py` runs in `--single` mode to render only that tile.
- The rendered file is stored in the standard cache structure and immediately returned to the client.
- The system limits concurrency to 2 simultaneous render jobs (`MAX_CONCURRENT_TILE_JOBS` in `server.js`) and queues additional requests in a FIFO queue.
- CRS-aware tile-grid derivation ensures on-demand tiles use the same scheme and parameters as pre-cached tiles.
- On-demand request metadata (CRS, scheme, preset info) is recorded in the project configuration for traceability.

## Quick test
```powershell
Invoke-WebRequest "http://localhost:3000/wmts/project/layer/7/0/0.png" -OutFile test_tile.png
```

## Requirements
- QGIS installed and reachable from the Python environment.
- The QGIS project must live under `qgisprojects/`.
- The backend must be running (`npm start`).

## Notes
- The first request for a tile can take several seconds while QGIS initializes.
- Generated tiles stay cached for future hits — subsequent requests are instant.
- Invalid cached tiles are automatically detected, deleted, and re-rendered.
- Failures return a JSON payload with error details.

## Performance considerations
- Pre-cache high-traffic zoom levels for production deployments; on-demand fills gaps.
- Performance depends on host capacity and QGIS project complexity.
- The FIFO queue prevents overload but may add latency under heavy concurrent misses.

---
Questions, suggestions, or need to extend this feature? Contact MundoGIS at support@mundogis.se.
