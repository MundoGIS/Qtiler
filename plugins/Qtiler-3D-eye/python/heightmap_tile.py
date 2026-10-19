#!/usr/bin/env python3
"""
Sample a 65x65 heightmap tile from a hydro-flattened DEM (EPSG:4326).

Used by Cesium.CustomHeightmapTerrainProvider via the Express endpoint
GET /plugins/Qtiler-3D-eye/heightmap/:projectId/:z/:x/:y.bin

The tile scheme assumed is GeographicTilingScheme (Cesium default for terrain):
  - Level 0 has 2 tiles wide x 1 tile tall covering [-180, -90, 180, 90]
  - Tile (z, x, y) covers a rectangle in degrees:
      width  = 360 / (2 * 2^z)
      height = 180 / (1 * 2^z)
      west   = -180 + x * width
      north  =   90 - y * height
      east   = west + width
      south  = north - height

Args via stdin JSON:
  { "demTif": "<path>", "z": int, "x": int, "y": int, "size": 65 }

Output on stdout: raw bytes of Float32Array (little-endian) of length size*size,
in row-major order (top->bottom, left->right) of heights in METERS.

If the tile is fully outside the DEM bounds: emits size*size zeros.
"""
import json
import os
import struct
import sys


def main():
    try:
        raw = sys.stdin.read()
        if not raw or not raw.strip():
            return _fail("empty_stdin_json")
        payload = json.loads(raw)
        dem_tif = payload.get("demTif", "")
        z = int(payload.get("z", 0))
        x = int(payload.get("x", 0))
        y = int(payload.get("y", 0))
        size = int(payload.get("size", 65))

        if not dem_tif or not os.path.isfile(dem_tif):
            return _fail("dem_tif_not_found")

        # Tile bounds (GeographicTilingScheme, 2x1 at level 0)
        nx = 2 * (1 << z)
        ny = 1 * (1 << z)
        tile_w = 360.0 / nx
        tile_h = 180.0 / ny
        west = -180.0 + x * tile_w
        north = 90.0 - y * tile_h
        east = west + tile_w
        south = north - tile_h

        from osgeo import gdal
        gdal.UseExceptions()

        ds = gdal.Open(dem_tif)
        if ds is None:
            return _fail("cannot_open_dem")

        gt = ds.GetGeoTransform()
        dem_west = gt[0]
        dem_north = gt[3]
        dem_east = dem_west + gt[1] * ds.RasterXSize
        dem_south = dem_north + gt[5] * ds.RasterYSize

        # Si el tile no intersecta el DEM -> emitir zeros
        if east <= dem_west or west >= dem_east or north <= dem_south or south >= dem_north:
            sys.stdout.buffer.write(b"\x00" * (size * size * 4))
            sys.stdout.buffer.flush()
            return 0

        # gdal.Warp con -te lon/lat para clip + resample a size x size
        # outputType Float32, salida en /vsimem para leerla in-memory
        mem_path = "/vsimem/tile_{}_{}_{}.tif".format(z, x, y)
        try:
            gdal.Warp(
                mem_path,
                ds,
                format="GTiff",
                width=size,
                height=size,
                outputBounds=(west, south, east, north),
                outputBoundsSRS="EPSG:4326",
                dstSRS="EPSG:4326",
                resampleAlg="bilinear",
                outputType=gdal.GDT_Float32,
                dstNodata=0,
            )
            out_ds = gdal.Open(mem_path)
            arr = out_ds.GetRasterBand(1).ReadAsArray()
            out_ds = None
        finally:
            gdal.Unlink(mem_path)

        # Cesium quiere row-major top->bottom (igual que GDAL). Float32 little-endian.
        import numpy as np
        if arr is None:
            arr = np.zeros((size, size), dtype="float32")
        else:
            arr = arr.astype("float32", copy=False)
        # Si las dimensiones no son exactas (raro), redimensionamos por pad/crop
        if arr.shape != (size, size):
            tmp = np.zeros((size, size), dtype="float32")
            h = min(size, arr.shape[0])
            w = min(size, arr.shape[1])
            tmp[:h, :w] = arr[:h, :w]
            arr = tmp

        sys.stdout.buffer.write(arr.tobytes(order="C"))
        sys.stdout.buffer.flush()
        return 0

    except Exception as exc:
        # No podemos mezclar JSON con binario; emitimos zeros y log al stderr
        sys.stderr.write("heightmap_tile_error: {}\n".format(exc))
        try:
            sys.stdout.buffer.write(b"\x00" * (int(payload.get("size", 65)) ** 2 * 4))
            sys.stdout.buffer.flush()
        except Exception:
            pass
        return 1


def _fail(reason):
    sys.stderr.write("heightmap_tile_fail: {}\n".format(reason))
    sys.stdout.buffer.write(b"\x00" * (65 * 65 * 4))
    sys.stdout.buffer.flush()
    return 1


if __name__ == "__main__":
    sys.exit(main())
