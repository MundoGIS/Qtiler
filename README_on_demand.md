# Qtiler: Tiles On-Demand (Experimental)

## What does this feature do?
It allows the server to generate and serve WMTS/XYZ tiles on demand in addition to the traditional pre-cache mode. If a tile does not exist on disk, the backend calls QGIS via Python and renders it in real time.

## How it works
- The routes `/wmts/:project/:layer/:z/:x/:y.png` and `/wmts/:project/themes/:theme/:z/:x/:y.png` first look for the tile on disk.
- If it is missing, the script `python/generate_cache.py` runs in `--single` mode to render only that tile.
- The rendered file is stored in the standard cache structure and immediately returned to the client.
- The system limits concurrency (max 2 simultaneous processes) and queues requests when the limit is reached.

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
- Generated tiles stay cached for future hits.
- Failures return a JSON payload with error details.

## Limitations
- On-demand mode is experimental; pre-cache high-traffic areas for production deployments.
- Performance depends on host capacity and QGIS project complexity.

---
Questions, suggestions, or need to extend this feature? Reach out!
