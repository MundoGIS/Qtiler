#!/usr/bin/env python3
"""
Hydro-flatten a DEM GeoTIFF for Cesium terrain.

Pipeline:
  1. Reproject DEM to EPSG:4326 (if not already).
  2. Mark pixels considered water (value <= waterThreshold OR nodata) as nodata.
  3. gdal.FillNodata with maxSearchDist iterations -> fills water with elevation
     interpolated from the surrounding shoreline (hydro-flatten basico).
  4. Save the resulting DEM as <outDir>/dem.tif and write meta.json with bounds.

Args (positional, via JSON on stdin):
  {
    "inputTif":       "<absolute path to source DEM>",
    "outputDir":      "<absolute output dir>",
    "waterThreshold": <float, default 0.5>,
    "maxSearchDist":  <int pixels, default 100>,
    "smoothing":      <int iterations, default 0>
  }

Emits JSON on stdout:
  { "ok": true, "outputTif": "...", "meta": {...} }
  or { "ok": false, "error": "...", "details": "..." }
"""
import json
import os
import sys
import traceback

def main():
    try:
        raw = sys.stdin.read()
        if not raw or not raw.strip():
            raise ValueError("empty_stdin_json")
        payload = json.loads(raw)
        input_tif = payload.get("inputTif", "").strip()
        output_dir = payload.get("outputDir", "").strip()
        water_threshold = float(payload.get("waterThreshold", 0.5))
        max_search_dist = int(payload.get("maxSearchDist", 100))
        smoothing = int(payload.get("smoothing", 0))

        if not input_tif or not os.path.isfile(input_tif):
            return _fail("input_tif_not_found", input_tif)
        if not output_dir:
            return _fail("output_dir_required", "")

        os.makedirs(output_dir, exist_ok=True)

        # Lazy import gdal (necesita las DLL de QGIS/OSGeo en el PATH)
        from osgeo import gdal, osr
        gdal.UseExceptions()

        # 1. Reproyectar a EPSG:4326 a un tmp .tif
        warp_path = os.path.join(output_dir, "_dem_4326.tif")
        gdal.Warp(
            warp_path,
            input_tif,
            dstSRS="EPSG:4326",
            resampleAlg="bilinear",
            multithread=True,
            format="GTiff",
            creationOptions=["COMPRESS=DEFLATE", "TILED=YES", "BIGTIFF=IF_SAFER"],
        )

        # 2. Marcar agua como nodata (in-place sobre warp_path)
        ds = gdal.Open(warp_path, gdal.GA_Update)
        band = ds.GetRasterBand(1)
        arr = band.ReadAsArray()
        existing_nodata = band.GetNoDataValue()

        import numpy as np
        mask = arr <= water_threshold
        if existing_nodata is not None:
            mask = mask | (arr == existing_nodata)

        # Usamos un nodata "extremo" reconocible
        FILL_NODATA = -32768.0
        arr_masked = arr.astype("float32")
        arr_masked[mask] = FILL_NODATA
        band.WriteArray(arr_masked)
        band.SetNoDataValue(FILL_NODATA)
        band.FlushCache()
        ds.FlushCache()
        ds = None

        # 3. gdal.FillNodata: rellena agua interpolando desde el borde
        ds = gdal.Open(warp_path, gdal.GA_Update)
        band = ds.GetRasterBand(1)
        gdal.FillNodata(
            targetBand=band,
            maskBand=None,
            maxSearchDist=max_search_dist,
            smoothingIterations=smoothing,
        )
        band.FlushCache()
        ds.FlushCache()

        # Tras el fill, eliminamos el nodata (todo deberia tener valor)
        # Pero ojo: si maxSearchDist no alcanzo a cubrir todo, quedaran nodata.
        # Para Cesium dejamos esos pixeles a 0.
        arr_filled = band.ReadAsArray()
        still_nodata = arr_filled == FILL_NODATA
        if still_nodata.any():
            arr_filled[still_nodata] = 0.0
            band.WriteArray(arr_filled)
        band.DeleteNoDataValue()
        band.FlushCache()
        ds.FlushCache()

        # Renombrar a dem.tif
        gt = ds.GetGeoTransform()
        width = ds.RasterXSize
        height = ds.RasterYSize
        # bounds en lon/lat (EPSG:4326)
        west = gt[0]
        north = gt[3]
        east = west + gt[1] * width
        south = north + gt[5] * height
        # min/max elevation
        stats = band.GetStatistics(True, True)  # min, max, mean, std
        ds = None

        final_path = os.path.join(output_dir, "dem.tif")
        if os.path.exists(final_path):
            os.remove(final_path)
        os.rename(warp_path, final_path)

        meta = {
            "outputTif": final_path,
            "width": width,
            "height": height,
            "bounds": {"west": west, "south": south, "east": east, "north": north},
            "elevation": {"min": stats[0], "max": stats[1], "mean": stats[2], "std": stats[3]},
            "waterThreshold": water_threshold,
            "maxSearchDist": max_search_dist,
            "smoothing": smoothing,
            "crs": "EPSG:4326",
        }
        with open(os.path.join(output_dir, "meta.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)

        sys.stdout.write(json.dumps({"ok": True, "outputTif": final_path, "meta": meta}, ensure_ascii=False))
        sys.stdout.flush()
        return 0

    except Exception as exc:
        return _fail("hydro_flatten_failed", str(exc) + "\n" + traceback.format_exc())


def _fail(error, details):
    sys.stdout.write(json.dumps({"ok": False, "error": error, "details": details}, ensure_ascii=False))
    sys.stdout.flush()
    return 1


if __name__ == "__main__":
    sys.exit(main())
