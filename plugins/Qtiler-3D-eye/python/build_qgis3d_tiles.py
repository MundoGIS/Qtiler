#!/usr/bin/env python3
"""Build simple Cesium 3D Tiles from polygon GeoJSON extrusion.

Input JSON on stdin:
{
  "geojsonPath": "...",
  "outputDir": "...",
  "extrusionHeight": 12,
  "color": "#bf5108",
  "chunkSize": 500
}

This intentionally creates a conservative b3dm tileset with one GLB mesh per
chunk. It is meant as an offline cache for QGIS 3D footprint extrusion so the
viewer does not need to parse/extrude WFS GeoJSON on every scene load.
"""
import json
import math
import os
import struct
import sys
import traceback

WGS84_A = 6378137.0
WGS84_E2 = 6.69437999014e-3


class TerrainSampler:
    def __init__(self, dem_path):
        self.ds = None
        self.inv_gt = None
        self.transform = None
        if not dem_path or not os.path.isfile(dem_path):
            return
        try:
            from osgeo import gdal, osr
            self.ds = gdal.Open(dem_path)
            if self.ds is None:
                return
            inv_result = gdal.InvGeoTransform(self.ds.GetGeoTransform())
            if isinstance(inv_result, tuple) and len(inv_result) == 2 and isinstance(inv_result[0], int):
                ok, inv_gt = inv_result
                if not ok:
                    self.ds = None
                    return
                self.inv_gt = inv_gt
            else:
                self.inv_gt = inv_result
            projection = self.ds.GetProjection()
            if projection:
                src = osr.SpatialReference()
                src.ImportFromEPSG(4326)
                src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
                dst = osr.SpatialReference()
                dst.ImportFromWkt(projection)
                dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
                self.transform = osr.CoordinateTransformation(src, dst)
        except Exception:
            self.ds = None

    def height(self, lon, lat):
        if self.ds is None or self.inv_gt is None:
            return 0.0
        try:
            x_geo, y_geo = lon, lat
            if self.transform:
                x_geo, y_geo, _ = self.transform.TransformPoint(lon, lat)
            px = int(self.inv_gt[0] + self.inv_gt[1] * x_geo + self.inv_gt[2] * y_geo)
            py = int(self.inv_gt[3] + self.inv_gt[4] * x_geo + self.inv_gt[5] * y_geo)
            if px < 0 or py < 0 or px >= self.ds.RasterXSize or py >= self.ds.RasterYSize:
                return 0.0
            band = self.ds.GetRasterBand(1)
            data = band.ReadAsArray(px, py, 1, 1)
            if data is None:
                return 0.0
            value = float(data[0][0])
            nodata = band.GetNoDataValue()
            if nodata is not None and value == float(nodata):
                return 0.0
            return value if math.isfinite(value) else 0.0
        except Exception:
            return 0.0


def lonlat_to_ecef(lon_deg, lat_deg, height):
    lon = math.radians(lon_deg)
    lat = math.radians(lat_deg)
    sin_lat = math.sin(lat)
    cos_lat = math.cos(lat)
    n = WGS84_A / math.sqrt(1.0 - WGS84_E2 * sin_lat * sin_lat)
    x = (n + height) * cos_lat * math.cos(lon)
    y = (n + height) * cos_lat * math.sin(lon)
    z = (n * (1.0 - WGS84_E2) + height) * sin_lat
    return (x, y, z)


def parse_color(value, alpha=1.0):
    text = str(value or "#bf5108").strip()
    if text.startswith("#") and len(text) in (4, 7):
        if len(text) == 4:
            text = "#" + "".join(ch * 2 for ch in text[1:])
        try:
            return [int(text[1:3], 16) / 255.0, int(text[3:5], 16) / 255.0, int(text[5:7], 16) / 255.0, float(alpha)]
        except Exception:
            pass
    return [0.75, 0.32, 0.03, float(alpha)]


def clamp01(value):
    return max(0.0, min(1.0, float(value)))


def shade_color(color, factor, alpha=None):
    return [clamp01(color[0] * factor), clamp01(color[1] * factor), clamp01(color[2] * factor), clamp01(color[3] if alpha is None else alpha)]


def stable_feature_factor(feature):
    properties = feature.get("properties") or {}
    seed_text = json.dumps(properties, sort_keys=True, ensure_ascii=False)[:500]
    if not seed_text:
        seed_text = json.dumps(feature.get("geometry") or {}, sort_keys=True, ensure_ascii=False)[:500]
    value = 2166136261
    for ch in seed_text:
        value ^= ord(ch)
        value = (value * 16777619) & 0xffffffff
    return 0.94 + (value % 13) / 100.0


def normalize_vec(vec):
    length = math.sqrt(vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2])
    if length <= 1e-12:
        return (0.0, 0.0, 1.0)
    return (vec[0] / length, vec[1] / length, vec[2] / length)


def cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def triangle_normal(a, b, c):
    ab = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    ac = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
    return normalize_vec(cross(ab, ac))


def wall_shade(a, b, style):
    minimum = float(style.get("wallShadeMin", 0.56)) if isinstance(style, dict) else 0.56
    maximum = float(style.get("wallShadeMax", 0.88)) if isinstance(style, dict) else 0.88
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    angle = math.atan2(dy, dx)
    light_angle = math.radians(315.0)
    amount = 0.5 + 0.5 * math.cos(angle - light_angle)
    return minimum + (maximum - minimum) * amount


def rule_matches(rule, properties):
    field = str(rule.get("field") or "").strip()
    if not field:
        return True
    left = properties.get(field)
    op = str(rule.get("operator") or "=")
    right = str(rule.get("value") if rule.get("value") is not None else "")
    if op == "contains":
        return right.lower() in str(left or "").lower()
    if op in ("=", "!="):
        result = str(left if left is not None else "") == right
        return (not result) if op == "!=" else result
    try:
        a = float(left)
        b = float(right)
        if op == ">":
            return a > b
        if op == "<":
            return a < b
        if op == ">=":
            return a >= b
        if op == "<=":
            return a <= b
    except Exception:
        return False
    return False


def feature_color(feature, style, fallback_color):
    properties = feature.get("properties") or {}
    for rule in style.get("styleRules") or style.get("rules") or []:
        if rule_matches(rule, properties):
            alpha = rule.get("fillOpacity", style.get("fillOpacity", fallback_color[3]))
            return parse_color(rule.get("color") or style.get("color"), alpha)
    return parse_color(style.get("color"), style.get("fillOpacity", fallback_color[3])) if style else fallback_color


def matching_rule(feature, style):
    properties = feature.get("properties") or {}
    for rule in style.get("styleRules") or style.get("rules") or []:
        if rule_matches(rule, properties):
            return rule
    return None


def feature_extrusion_height(feature, style, fallback_height):
    rule = matching_rule(feature, style or {})
    value = rule.get("extrusionHeight") if rule else None
    if value is None and isinstance(style, dict):
        value = style.get("extrusionHeight")
    try:
        number = float(value)
        return number if math.isfinite(number) and number > 0 else fallback_height
    except Exception:
        return fallback_height


def iter_polygons(geometry):
    if not geometry:
        return
    gtype = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if gtype == "Polygon":
        yield coords
    elif gtype == "MultiPolygon":
        for polygon in coords:
            yield polygon


def clean_ring(ring):
    cleaned = []
    for point in ring or []:
        if len(point) < 2:
            continue
        lon = float(point[0])
        lat = float(point[1])
        if not math.isfinite(lon) or not math.isfinite(lat):
            continue
        if not cleaned or abs(cleaned[-1][0] - lon) > 1e-12 or abs(cleaned[-1][1] - lat) > 1e-12:
            cleaned.append((lon, lat))
    if len(cleaned) > 2 and abs(cleaned[0][0] - cleaned[-1][0]) < 1e-12 and abs(cleaned[0][1] - cleaned[-1][1]) < 1e-12:
        cleaned.pop()
    return cleaned if len(cleaned) >= 3 else []


def collect_features(geojson):
    if geojson.get("type") == "FeatureCollection":
        return geojson.get("features") or []
    if geojson.get("type") == "Feature":
        return [geojson]
    return [{"type": "Feature", "geometry": geojson, "properties": {}}]


def pad_bytes(data, multiple, pad=b" "):
    rem = len(data) % multiple
    return data if rem == 0 else data + pad * (multiple - rem)


def make_glb(positions, indices, colors, color, normals=None):
    if not positions or not indices:
        raise ValueError("empty_mesh")
    normals = normals if normals and len(normals) == len(positions) else []
    pos_min = [min(p[i] for p in positions) for i in range(3)]
    pos_max = [max(p[i] for p in positions) for i in range(3)]
    pos_bytes = b"".join(struct.pack("<fff", *p) for p in positions)
    pos_bytes = pad_bytes(pos_bytes, 4, b"\x00")
    normal_offset = len(pos_bytes)
    normal_bytes = b"".join(struct.pack("<fff", *n) for n in normals) if normals else b""
    normal_bytes = pad_bytes(normal_bytes, 4, b"\x00")
    color_offset = len(pos_bytes) + len(normal_bytes)
    color_bytes = b"".join(struct.pack("<ffff", *c) for c in colors) if colors else b""
    color_bytes = pad_bytes(color_bytes, 4, b"\x00")
    index_offset = len(pos_bytes) + len(normal_bytes) + len(color_bytes)
    idx_bytes = b"".join(struct.pack("<I", int(i)) for i in indices)
    bin_chunk = pad_bytes(pos_bytes + normal_bytes + color_bytes + idx_bytes, 4, b"\x00")
    buffer_views = [{"buffer": 0, "byteOffset": 0, "byteLength": len(pos_bytes), "target": 34962}]
    accessors = [{"bufferView": 0, "byteOffset": 0, "componentType": 5126, "count": len(positions), "type": "VEC3", "min": pos_min, "max": pos_max}]
    attributes = {"POSITION": 0}
    if normals:
        attributes["NORMAL"] = len(accessors)
        buffer_views.append({"buffer": 0, "byteOffset": normal_offset, "byteLength": len(normal_bytes), "target": 34962})
        accessors.append({"bufferView": len(buffer_views) - 1, "byteOffset": 0, "componentType": 5126, "count": len(normals), "type": "VEC3"})
    if colors:
        attributes["COLOR_0"] = len(accessors)
        buffer_views.append({"buffer": 0, "byteOffset": color_offset, "byteLength": len(color_bytes), "target": 34962})
        accessors.append({"bufferView": len(buffer_views) - 1, "byteOffset": 0, "componentType": 5126, "count": len(colors), "type": "VEC4"})
    index_accessor = len(accessors)
    buffer_views.append({"buffer": 0, "byteOffset": index_offset, "byteLength": len(idx_bytes), "target": 34963})
    accessors.append({"bufferView": len(buffer_views) - 1, "byteOffset": 0, "componentType": 5125, "count": len(indices), "type": "SCALAR"})
    gltf = {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": attributes, "indices": index_accessor, "material": 0}]}],
        "materials": [{"doubleSided": True, "pbrMetallicRoughness": {"baseColorFactor": [1.0, 1.0, 1.0, color[3]], "metallicFactor": 0.0, "roughnessFactor": 0.82}}],
        "buffers": [{"byteLength": len(bin_chunk)}],
        "bufferViews": buffer_views,
        "accessors": accessors,
    }
    json_chunk = pad_bytes(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), 4, b" ")
    total = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    return b"".join([
        struct.pack("<4sII", b"glTF", 2, total),
        struct.pack("<I4s", len(json_chunk), b"JSON"),
        json_chunk,
        struct.pack("<I4s", len(bin_chunk), b"BIN\x00"),
        bin_chunk,
    ])


def make_b3dm(glb, rtc_center):
    feature_json = json.dumps({"BATCH_LENGTH": 0, "RTC_CENTER": list(rtc_center)}, separators=(",", ":")).encode("utf-8")
    feature_json = pad_bytes(feature_json, 8, b" ")
    glb = pad_bytes(glb, 8, b"\x00")
    byte_length = 28 + len(feature_json) + len(glb)
    header = struct.pack("<4sIIIIII", b"b3dm", 1, byte_length, len(feature_json), 0, 0, 0)
    return header + feature_json + glb


def build_chunk(features, extrusion_height, color, out_path, terrain_sampler, style):
    lon_values = []
    lat_values = []
    for feature in features:
        for polygon in iter_polygons(feature.get("geometry")):
            ring = clean_ring((polygon or [[]])[0])
            for lon, lat in ring:
                lon_values.append(lon)
                lat_values.append(lat)
    if not lon_values:
        return None
    feature_heights = [feature_extrusion_height(feature, style, extrusion_height) for feature in features]
    center_extrusion_height = (sum(feature_heights) / len(feature_heights)) if feature_heights else extrusion_height
    center_lon = (min(lon_values) + max(lon_values)) / 2.0
    center_lat = (min(lat_values) + max(lat_values)) / 2.0
    sample_heights = [terrain_sampler.height(lon, lat) for lon, lat in zip(lon_values[:200], lat_values[:200])]
    center_height = (sum(sample_heights) / len(sample_heights) if sample_heights else 0.0) + center_extrusion_height / 2.0
    center = lonlat_to_ecef(center_lon, center_lat, center_height)
    positions = []
    normals = []
    colors = []
    indices = []
    west = min(lon_values)
    east = max(lon_values)
    south = min(lat_values)
    north = max(lat_values)

    min_height = None
    max_height = None

    def point_at_height(lon, lat, height):
        nonlocal min_height, max_height
        min_height = height if min_height is None else min(min_height, height)
        max_height = height if max_height is None else max(max_height, height)
        ecef = lonlat_to_ecef(lon, lat, height)
        return (float(ecef[0] - center[0]), float(ecef[1] - center[1]), float(ecef[2] - center[2]))

    def add_face(face_points, face_color):
        normal = triangle_normal(face_points[0], face_points[1], face_points[2]) if len(face_points) >= 3 else (0.0, 0.0, 1.0)
        start = len(positions)
        for point in face_points:
            positions.append(point)
            normals.append(normal)
            colors.append(face_color)
        if len(face_points) == 3:
            indices.extend([start, start + 1, start + 2])
        elif len(face_points) == 4:
            indices.extend([start, start + 1, start + 2, start, start + 2, start + 3])

    for feature in features:
        current_extrusion_height = feature_extrusion_height(feature, style, extrusion_height)
        current_color = shade_color(feature_color(feature, style, color), stable_feature_factor(feature))
        roof_color = shade_color(current_color, float(style.get("roofShade", 1.14)) if isinstance(style, dict) else 1.14)
        for polygon in iter_polygons(feature.get("geometry")):
            ring = clean_ring((polygon or [[]])[0])
            if len(ring) < 3:
                continue
            ground_heights = [terrain_sampler.height(lon, lat) for lon, lat in ring]
            roof_height = max(ground_heights) + current_extrusion_height
            bottom = [point_at_height(lon, lat, ground_heights[idx]) for idx, (lon, lat) in enumerate(ring)]
            top = [point_at_height(lon, lat, roof_height) for lon, lat in ring]
            n = len(ring)
            for i in range(1, n - 1):
                add_face([top[0], top[i], top[i + 1]], roof_color)
            for i in range(n):
                j = (i + 1) % n
                add_face([bottom[i], bottom[j], top[j], top[i]], shade_color(current_color, wall_shade(ring[i], ring[j], style)))

    if not positions or not indices:
        return None
    glb = make_glb(positions, indices, colors, color, normals)
    with open(out_path, "wb") as handle:
        handle.write(make_b3dm(glb, center))
    return {
        "center": center,
        "region": [math.radians(west), math.radians(south), math.radians(east), math.radians(north), float(min_height or 0.0), float(max_height or extrusion_height)],
        "features": len(features),
        "vertices": len(positions),
        "triangles": len(indices) // 3,
    }


def union_region(regions):
    return [
        min(r[0] for r in regions),
        min(r[1] for r in regions),
        max(r[2] for r in regions),
        max(r[3] for r in regions),
        min(r[4] for r in regions),
        max(r[5] for r in regions),
    ]


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        geojson_path = payload.get("geojsonPath")
        output_dir = payload.get("outputDir")
        extrusion_height = float(payload.get("extrusionHeight") or 10.0)
        chunk_size = max(50, int(payload.get("chunkSize") or 500))
        color = parse_color(payload.get("color"))
        style = payload.get("style") if isinstance(payload.get("style"), dict) else {}
        terrain_sampler = TerrainSampler(payload.get("demPath"))
        if not geojson_path or not os.path.isfile(geojson_path):
            return fail("geojson_not_found", geojson_path)
        if not output_dir:
            return fail("output_dir_required", "")
        os.makedirs(os.path.join(output_dir, "data"), exist_ok=True)
        with open(geojson_path, "r", encoding="utf-8") as handle:
            geojson = json.load(handle)
        features = collect_features(geojson)
        polygon_features = [feature for feature in features if any(True for _ in iter_polygons(feature.get("geometry")))]
        if not polygon_features:
            return fail("no_polygon_features", "")
        children = []
        stats = []
        for start in range(0, len(polygon_features), chunk_size):
            chunk = polygon_features[start:start + chunk_size]
            name = "data{}.b3dm".format(len(children))
            rel = "data/{}".format(name)
            result = build_chunk(chunk, extrusion_height, color, os.path.join(output_dir, rel), terrain_sampler, style)
            if not result:
                continue
            children.append({
                "boundingVolume": {"region": result["region"]},
                "geometricError": 0,
                "refine": "ADD",
                "content": {"url": rel},
            })
            stats.append(result)
        if not children:
            return fail("empty_tileset", "")
        root_region = union_region([child["boundingVolume"]["region"] for child in children])
        root_error = max(1500.0, extrusion_height * 250.0, len(children) * 90.0)
        tileset = {
            "asset": {"version": "1.0", "gltfUpAxis": "Z"},
            "geometricError": root_error * 2.0,
            "root": {
                "boundingVolume": {"region": root_region},
                "geometricError": root_error,
                "refine": "ADD",
                "children": children,
            },
        }
        with open(os.path.join(output_dir, "tileset.json"), "w", encoding="utf-8") as handle:
            json.dump(tileset, handle, ensure_ascii=False, indent=2)
        sys.stdout.write(json.dumps({
            "ok": True,
            "features": len(polygon_features),
            "tiles": len(children),
            "boundsRadians": root_region,
            "triangles": sum(item["triangles"] for item in stats),
            "vertices": sum(item["vertices"] for item in stats),
        }, ensure_ascii=False))
        return 0
    except Exception as exc:
        return fail("build_3dtiles_failed", str(exc) + "\n" + traceback.format_exc())


def fail(error, details):
    sys.stdout.write(json.dumps({"ok": False, "error": error, "details": str(details or "")}, ensure_ascii=False))
    return 1


if __name__ == "__main__":
    sys.exit(main())