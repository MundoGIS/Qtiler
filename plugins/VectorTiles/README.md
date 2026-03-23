# VectorTiles Plugin (Qtiler)

Production-oriented vector tiles plugin for QGIS projects.

## What It Exposes

- `GET /plugins/VectorTiles/tiles/:projectId/{z}/{x}/{y}.pbf`
- `GET /plugins/VectorTiles/tilejson/:projectId.json`
- `GET /plugins/VectorTiles/style/:projectId.json`
- `GET /plugins/VectorTiles/style/:projectId/:presetName.json`
- `GET /plugins/VectorTiles/identify/:projectId?layer=<name>&lon=<x>&lat=<y>&tolerance=<m>&limit=<n>`

## Security

All public endpoints honor project access rules.

- If project is public in QtilerAuth: no token required.
- If protected: provide either
  - token (`?token=...`), or
  - authenticated user (session/basic auth depending deployment).

Create token:

- `POST /plugins/VectorTiles/api/access-token`

## Generated Metadata

Tile generation stores:

- zoom range and bounds
- source layer list
- per-layer style hints (color/width/opacity/size)
- renderer metadata (categorized and graduated rules)
- source layer field metadata

This metadata is used to build style JSON and richer TileJSON (`vector_layers`).

## QGIS Usage

Recommended setup:

1. Add vector tiles source using style URL:
   - `/plugins/VectorTiles/style/<project>.json`
2. For protected projects, use tokenized style URL.
3. For layer-specific style:
   - `/plugins/VectorTiles/style/<project>/<layer>.json?layers=<layer>`

## Identify (Info Click)

Use endpoint:

- `/plugins/VectorTiles/identify/<project>?layer=<layer>&lon=<lon>&lat=<lat>&tolerance=5&limit=10`

Returns matched features with:

- `featureId`
- `properties`
- `geometryWkt`
- `geometryType`

This complements MVT rendering when full attribute inspection is required.
