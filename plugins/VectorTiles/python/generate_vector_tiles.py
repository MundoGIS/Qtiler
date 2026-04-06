import os
import sys
import json
import traceback
from pathlib import Path


def out(payload, code=0):
    print(json.dumps(payload, ensure_ascii=False))
    return code


def normalize_extent(value):
    if not value:
      return None
    if isinstance(value, (list, tuple)) and len(value) == 4:
      try:
        nums = [float(x) for x in value]
        return nums
      except Exception:
        return None
    return None


def main():
    if len(sys.argv) < 2:
        return out({"error": "project_path_required"}, 1)

    project_path = Path(sys.argv[1]).resolve()
    output_mbtiles = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else None
    min_zoom = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    max_zoom = int(sys.argv[4]) if len(sys.argv) > 4 else 14
    selected_layer_ids = []
    if len(sys.argv) > 5 and sys.argv[5]:
        try:
            parsed_ids = json.loads(sys.argv[5])
            if isinstance(parsed_ids, list):
                selected_layer_ids = [str(item).strip() for item in parsed_ids if str(item).strip()]
        except Exception:
            selected_layer_ids = []

    # Optional bounding box (WGS84) to restrict generation: JSON array [minx,miny,maxx,maxy] or comma string
    bbox_wgs84 = None
    if len(sys.argv) > 6 and sys.argv[6]:
        raw = sys.argv[6]
        try:
            parsed = None
            try:
                parsed = json.loads(raw)
            except Exception:
                # try comma-separated
                parts = [p.strip() for p in str(raw).split(',') if p.strip()]
                if len(parts) == 4:
                    parsed = [float(p) for p in parts]
            if isinstance(parsed, (list, tuple)) and len(parsed) == 4:
                bbox_wgs84 = [float(parsed[0]), float(parsed[1]), float(parsed[2]), float(parsed[3])]
        except Exception:
            bbox_wgs84 = None

    # Optional merge target: if provided, treat output_mbtiles as temp and merge into merge_into
    merge_into = None
    if len(sys.argv) > 7 and sys.argv[7]:
        try:
            merge_into = Path(sys.argv[7]).resolve()
        except Exception:
            merge_into = None

    if not project_path.exists():
        return out({"error": "project_not_found", "project": str(project_path)}, 1)
    if output_mbtiles is None:
        return out({"error": "output_required"}, 1)

    qgis_prefix = os.environ.get("QGIS_PREFIX") or os.environ.get("QGIS_PREFIX_PATH")
    if not qgis_prefix:
        return out({"error": "qgis_prefix_missing", "message": "QGIS_PREFIX env var is required"}, 1)

    # Ensure QGIS processing plugin path is available in standalone installs.
    qgis_prefix_path = Path(qgis_prefix)
    plugin_candidates = [
        qgis_prefix_path / "python" / "plugins",
        qgis_prefix_path / "apps" / "qgis" / "python" / "plugins",
        Path(os.environ.get("QTILER_HOME", "")) / "python" / "plugins"
    ]
    for candidate in plugin_candidates:
        try:
            if candidate and candidate.exists():
                candidate_str = str(candidate.resolve())
                if candidate_str not in sys.path:
                    sys.path.insert(0, candidate_str)
        except Exception:
            continue

    try:
        from qgis.core import (
            QgsApplication,
            QgsProject,
            QgsRectangle,
            QgsWkbTypes,
            QgsCoordinateReferenceSystem,
            QgsCoordinateTransform,
            QgsCoordinateTransformContext
        )
        import processing
        from processing.core.Processing import Processing
        from qgis.analysis import QgsNativeAlgorithms
    except Exception as err:
        return out({
            "error": "qgis_import_failed",
            "details": str(err),
            "pluginPathsChecked": [str(p) for p in plugin_candidates]
        }, 1)

    QgsApplication.setPrefixPath(qgis_prefix, True)
    qgs = QgsApplication([], False)
    qgs.initQgis()

    try:
        Processing.initialize()
        try:
            registry = QgsApplication.processingRegistry()
            has_native = any(getattr(provider, 'id', lambda: '')() == 'native' for provider in registry.providers())
            if not has_native:
                registry.addProvider(QgsNativeAlgorithms())
        except Exception:
            pass

        project = QgsProject.instance()
        ok = project.read(str(project_path))
        if not ok:
            return out({"error": "project_load_failed", "project": str(project_path)}, 1)

        layers = []
        layer_styles = []
        source_layer_meta = []
        selected_set = set(selected_layer_ids)
        extent = None
        bounds_wgs84 = None
        wgs84 = QgsCoordinateReferenceSystem('EPSG:4326')
        transform_context = QgsCoordinateTransformContext(project.transformContext())

        def normalize_bounds(rect):
            if not rect or not rect.isFinite():
                return None
            return [rect.xMinimum(), rect.yMinimum(), rect.xMaximum(), rect.yMaximum()]

        def combine_bounds(base, candidate):
            if not candidate or len(candidate) != 4:
                return base
            if not base:
                return list(candidate)
            return [
                min(base[0], candidate[0]),
                min(base[1], candidate[1]),
                max(base[2], candidate[2]),
                max(base[3], candidate[3])
            ]

        def first_valid_symbol(renderer):
            if not renderer:
                return None
            try:
                if hasattr(renderer, "symbol") and callable(renderer.symbol):
                    sym = renderer.symbol()
                    if sym:
                        return sym
            except Exception:
                pass
            try:
                if hasattr(renderer, "sourceSymbol") and callable(renderer.sourceSymbol):
                    sym = renderer.sourceSymbol()
                    if sym:
                        return sym
            except Exception:
                pass
            try:
                if hasattr(renderer, "categories") and callable(renderer.categories):
                    categories = renderer.categories() or []
                    for cat in categories:
                        sym = cat.symbol() if cat and hasattr(cat, "symbol") else None
                        if sym:
                            return sym
            except Exception:
                pass
            try:
                if hasattr(renderer, "ranges") and callable(renderer.ranges):
                    ranges = renderer.ranges() or []
                    for rng in ranges:
                        sym = rng.symbol() if rng and hasattr(rng, "symbol") else None
                        if sym:
                            return sym
            except Exception:
                pass
            return None

        def extract_symbol_style(symbol):
            color_hex = None
            line_width = None
            point_size = None
            fill_opacity = None
            if not symbol:
                return color_hex, line_width, point_size, fill_opacity

            try:
                if hasattr(symbol, "opacity") and callable(symbol.opacity):
                    op = float(symbol.opacity())
                    if op >= 0:
                        fill_opacity = max(0.0, min(op, 1.0))
            except Exception:
                pass

            try:
                if hasattr(symbol, "color") and callable(symbol.color):
                    color_obj = symbol.color()
                    if color_obj:
                        color_hex = color_obj.name()
                        if fill_opacity is None and hasattr(color_obj, "alphaF"):
                            fill_opacity = float(color_obj.alphaF())
            except Exception:
                pass

            try:
                if hasattr(symbol, "width") and callable(symbol.width):
                    width_val = float(symbol.width())
                    if width_val > 0:
                        line_width = width_val
            except Exception:
                pass

            try:
                if hasattr(symbol, "size") and callable(symbol.size):
                    size_val = float(symbol.size())
                    if size_val > 0:
                        point_size = size_val
            except Exception:
                pass

            try:
                if hasattr(symbol, "symbolLayer") and callable(symbol.symbolLayer):
                    sl = symbol.symbolLayer(0)
                    if sl:
                        try:
                            if color_hex is None and hasattr(sl, "color") and callable(sl.color):
                                sl_color = sl.color()
                                if sl_color:
                                    color_hex = sl_color.name()
                        except Exception:
                            pass

                        props = {}
                        try:
                            if hasattr(sl, "properties") and callable(sl.properties):
                                props = sl.properties() or {}
                        except Exception:
                            props = {}

                        def float_prop(*keys):
                            for key in keys:
                                raw = props.get(key)
                                if raw is None:
                                    continue
                                try:
                                    val = float(raw)
                                    if val > 0:
                                        return val
                                except Exception:
                                    continue
                            return None

                        if line_width is None:
                            line_width = float_prop("line_width", "outline_width", "stroke_width", "width")
                        if point_size is None:
                            point_size = float_prop("size", "radius")
            except Exception:
                pass

            return color_hex, line_width, point_size, fill_opacity

        def to_json_scalar(value):
            if value is None:
                return None
            if isinstance(value, (bool, int, float, str)):
                return value
            try:
                if hasattr(value, "toString"):
                    return str(value.toString())
            except Exception:
                pass
            try:
                return str(value)
            except Exception:
                return None

        def extract_renderer_style(renderer):
            if not renderer:
                return None

            # Categorized symbols: one style/color per unique field value.
            try:
                if hasattr(renderer, "categories") and callable(renderer.categories) and hasattr(renderer, "classAttribute"):
                    field = str(renderer.classAttribute() or "").strip()
                    cats = renderer.categories() or []
                    items = []
                    for cat in cats:
                        symbol = cat.symbol() if cat and hasattr(cat, "symbol") else None
                        color_hex, line_width, point_size, fill_opacity = extract_symbol_style(symbol)
                        items.append({
                            "value": to_json_scalar(cat.value() if hasattr(cat, "value") else None),
                            "label": str(cat.label() or "") if hasattr(cat, "label") else "",
                            "color": color_hex,
                            "lineWidth": line_width,
                            "pointSize": point_size,
                            "fillOpacity": fill_opacity
                        })
                    if field and items:
                        return {
                            "type": "categorized",
                            "field": field,
                            "items": items
                        }
            except Exception:
                pass

            # Graduated symbols: one style/color per numeric range.
            try:
                if hasattr(renderer, "ranges") and callable(renderer.ranges) and hasattr(renderer, "classAttribute"):
                    field = str(renderer.classAttribute() or "").strip()
                    ranges = renderer.ranges() or []
                    items = []
                    for rng in ranges:
                        symbol = rng.symbol() if rng and hasattr(rng, "symbol") else None
                        color_hex, line_width, point_size, fill_opacity = extract_symbol_style(symbol)
                        lower_val = rng.lowerValue() if hasattr(rng, "lowerValue") else None
                        upper_val = rng.upperValue() if hasattr(rng, "upperValue") else None
                        try:
                            lower_val = float(lower_val)
                        except Exception:
                            lower_val = None
                        try:
                            upper_val = float(upper_val)
                        except Exception:
                            upper_val = None
                        items.append({
                            "lower": lower_val,
                            "upper": upper_val,
                            "label": str(rng.label() or "") if hasattr(rng, "label") else "",
                            "color": color_hex,
                            "lineWidth": line_width,
                            "pointSize": point_size,
                            "fillOpacity": fill_opacity
                        })
                    if field and items:
                        return {
                            "type": "graduated",
                            "field": field,
                            "items": items
                        }
            except Exception:
                pass

            return None

        for layer in project.mapLayers().values():
            try:
                if not layer or not layer.isValid():
                    continue
                if layer.type() != layer.VectorLayer:
                    continue
                geom_type = layer.geometryType()
                if geom_type == QgsWkbTypes.NullGeometry:
                    continue
                if selected_set and layer.id() not in selected_set:
                    continue
                layers.append(layer)

                geometry_name = {
                    QgsWkbTypes.PointGeometry: "point",
                    QgsWkbTypes.LineGeometry: "line",
                    QgsWkbTypes.PolygonGeometry: "polygon"
                }.get(geom_type, "unknown")

                color_hex = None
                line_width = None
                point_size = None
                fill_opacity = None
                try:
                    renderer = layer.renderer()
                    symbol = first_valid_symbol(renderer)
                    color_hex, line_width, point_size, fill_opacity = extract_symbol_style(symbol)
                    renderer_style = extract_renderer_style(renderer)
                except Exception:
                    renderer_style = None
                    pass

                layer_styles.append({
                    "layerId": layer.id(),
                    "layerName": layer.name(),
                    "geometry": geometry_name,
                    "color": color_hex,
                    "lineWidth": line_width,
                    "pointSize": point_size,
                    "fillOpacity": fill_opacity,
                    "renderer": renderer_style
                })

                fields_meta = []
                try:
                    for fld in layer.fields():
                        fields_meta.append({
                            "name": str(fld.name()),
                            "type": str(fld.typeName() or ""),
                            "length": int(fld.length()) if hasattr(fld, 'length') else None,
                            "precision": int(fld.precision()) if hasattr(fld, 'precision') else None
                        })
                except Exception:
                    fields_meta = []

                source_layer_meta.append({
                    "id": layer.name(),
                    "name": layer.name(),
                    "geometry": geometry_name,
                    "fields": fields_meta
                })

                ext = layer.extent()
                if ext and ext.isFinite():
                    extent = ext if extent is None else extent.combineExtentWith(ext) or extent
                    try:
                        layer_crs = layer.crs() if hasattr(layer, 'crs') else None
                        if layer_crs and layer_crs.isValid():
                            if layer_crs == wgs84:
                                candidate_bounds = normalize_bounds(ext)
                            else:
                                tr = QgsCoordinateTransform(layer_crs, wgs84, transform_context)
                                candidate_bounds = normalize_bounds(tr.transformBoundingBox(ext))
                            bounds_wgs84 = combine_bounds(bounds_wgs84, candidate_bounds)
                    except Exception:
                        pass
            except Exception:
                continue

        if not layers:
            return out({"error": "no_vector_layers", "project": str(project_path)}, 1)

        output_mbtiles.parent.mkdir(parents=True, exist_ok=True)
        # If merging into an existing mbtiles, do NOT unlink the main file here. The output_mbtiles is treated as temp.
        if not merge_into:
            if output_mbtiles.exists():
                try:
                    output_mbtiles.unlink()
                except Exception:
                    return out({
                        "error": "output_locked",
                        "details": f"Cannot overwrite existing output: {str(output_mbtiles)}"
                    }, 1)

        alg_candidates = [
            "native:writevectortiles_mbtiles",
            "qgis:writevectortiles_mbtiles"
        ]

        selected_alg = None
        registry = QgsApplication.processingRegistry()
        for alg in alg_candidates:
            try:
                if registry.algorithmById(alg):
                    selected_alg = alg
                    break
            except Exception:
                continue

        if not selected_alg:
            return out({
                "error": "algorithm_not_available",
                "message": "Vector tile writer algorithm not found in current QGIS build",
                "candidates": alg_candidates
            }, 1)

        writer_layers = []
        for layer in layers:
            writer_layers.append({
                "layer": layer,
                "layerName": layer.name(),
                "minZoom": int(min_zoom),
                "maxZoom": int(max_zoom)
            })

        params = {
            "OUTPUT": str(output_mbtiles),
            "MIN_ZOOM": int(min_zoom),
            "MAX_ZOOM": int(max_zoom),
            "LAYERS": writer_layers
        }

        # If a WGS84 bbox was provided, transform to project CRS and pass as EXTENT.
        # The EXTENT string MUST include the CRS suffix (e.g. [EPSG:3006]) for QGIS
        # processing to handle the coordinate system correctly.
        if bbox_wgs84:
            try:
                from qgis.core import QgsRectangle
                bbox_rect_wgs84 = QgsRectangle(float(bbox_wgs84[0]), float(bbox_wgs84[1]), float(bbox_wgs84[2]), float(bbox_wgs84[3]))
                proj_crs = project.crs() if hasattr(project, 'crs') else None
                if proj_crs and proj_crs.isValid():
                    tr = QgsCoordinateTransform(wgs84, proj_crs, transform_context)
                    try:
                        bbox_proj = tr.transformBoundingBox(bbox_rect_wgs84)
                        params['EXTENT'] = f"{bbox_proj.xMinimum()},{bbox_proj.yMinimum()},{bbox_proj.xMaximum()},{bbox_proj.yMaximum()} [{proj_crs.authid()}]"
                    except Exception:
                        params['EXTENT'] = f"{bbox_wgs84[0]},{bbox_wgs84[1]},{bbox_wgs84[2]},{bbox_wgs84[3]} [EPSG:4326]"
                else:
                    params['EXTENT'] = f"{bbox_wgs84[0]},{bbox_wgs84[1]},{bbox_wgs84[2]},{bbox_wgs84[3]} [EPSG:4326]"
            except Exception:
                try:
                    params['EXTENT'] = f"{bbox_wgs84[0]},{bbox_wgs84[1]},{bbox_wgs84[2]},{bbox_wgs84[3]} [EPSG:4326]"
                except Exception:
                    pass

        try:
            result = processing.run(selected_alg, params)
        except Exception as first_err:
            fallback_params = {
                "OUTPUT": str(output_mbtiles),
                "MIN_ZOOM": int(min_zoom),
                "MAX_ZOOM": int(max_zoom),
                "LAYERS": [
                    {
                        "layer": layer.id(),
                        "layerName": layer.name(),
                        "minZoom": int(min_zoom),
                        "maxZoom": int(max_zoom)
                    }
                    for layer in layers
                ]
            }
            try:
                result = processing.run(selected_alg, fallback_params)
            except Exception as second_err:
                return out({
                    "error": "vector_tile_generation_failed",
                    "details": str(second_err),
                    "firstError": str(first_err),
                    "algorithm": selected_alg
                }, 1)

        if not output_mbtiles.exists():
            return out({"error": "output_missing", "algorithm": selected_alg, "result": result}, 1)

        bounds = bounds_wgs84
        if not bounds and extent and extent.isFinite():
            bounds = [extent.xMinimum(), extent.yMinimum(), extent.xMaximum(), extent.yMaximum()]

        # If merge target was provided, merge generated tiles into target MBTiles
        merge_count = 0
        merge_error = None
        if merge_into:
            try:
                import sqlite3
                target = str(merge_into)
                src = str(output_mbtiles)
                if not os.path.exists(target):
                    # If target doesn't exist, move temp to target
                    try:
                        os.replace(src, target)
                    except Exception:
                        try:
                            os.rename(src, target)
                        except Exception as mv_err:
                            merge_error = f"move_failed: {mv_err}"
                else:
                    # Attach and copy tiles/metadata
                    conn = sqlite3.connect(target)
                    cur = conn.cursor()
                    try:
                        cur.execute("ATTACH ? AS src", (src,))
                        # count tiles in source before merging
                        try:
                            cur.execute("SELECT COUNT(*) FROM src.tiles")
                            merge_count = cur.fetchone()[0]
                        except Exception:
                            merge_count = 0
                        # copy tiles
                        cur.execute("INSERT OR REPLACE INTO tiles(zoom_level, tile_column, tile_row, tile_data) SELECT zoom_level, tile_column, tile_row, tile_data FROM src.tiles")
                        # copy/merge metadata
                        try:
                            cur.execute("SELECT name, value FROM src.metadata")
                            rows = cur.fetchall()
                            for name, value in rows:
                                cur.execute("INSERT OR REPLACE INTO metadata(name, value) VALUES(?,?)", (name, value))
                        except Exception:
                            pass
                        conn.commit()
                    except Exception as merge_exc:
                        merge_error = str(merge_exc)
                    finally:
                        try:
                            cur.execute("DETACH src")
                        except Exception:
                            pass
                        cur.close()
                        conn.close()
                    try:
                        os.remove(src)
                    except Exception:
                        pass
            except Exception as outer_err:
                merge_error = str(outer_err)

        return out({
            "ok": True,
            "algorithm": selected_alg,
            "project": str(project_path),
            "output": str(output_mbtiles),
            "minZoom": int(min_zoom),
            "maxZoom": int(max_zoom),
            "vectorLayerCount": len(layers),
            "selectedLayerCount": len(layers),
            "requestedLayerCount": len(selected_layer_ids),
            "layerStyles": layer_styles,
            "sourceLayerMeta": source_layer_meta,
            "bounds": bounds,
            "boundsCrs": "EPSG:4326",
            "mergeCount": merge_count if merge_into else None,
            "mergeError": merge_error
        }, 0)
    except Exception as err:
        return out({"error": "unexpected_failure", "details": str(err), "trace": traceback.format_exc()}, 1)
    finally:
        try:
            qgs.exitQgis()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
