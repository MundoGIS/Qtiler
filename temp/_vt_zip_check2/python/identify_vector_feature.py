import json
import os
import sys
from pathlib import Path


def out(payload, code=0):
    print(json.dumps(payload, ensure_ascii=False))
    return code


def to_json_safe(value):
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    try:
        if hasattr(value, 'toString'):
            return str(value.toString())
    except Exception:
        pass
    return str(value)


def main():
    if len(sys.argv) < 5:
        return out({"error": "missing_args", "usage": "project_path layer_name lon lat [tolerance_meters] [limit]"}, 1)

    project_path = Path(sys.argv[1]).resolve()
    layer_name = str(sys.argv[2] or '').strip()
    try:
        lon = float(sys.argv[3])
        lat = float(sys.argv[4])
    except Exception:
        return out({"error": "invalid_coordinates"}, 1)

    try:
        tolerance_meters = float(sys.argv[5]) if len(sys.argv) > 5 else 3.0
    except Exception:
        tolerance_meters = 3.0
    try:
        limit = int(sys.argv[6]) if len(sys.argv) > 6 else 10
    except Exception:
        limit = 10

    if not project_path.exists():
        return out({"error": "project_not_found", "project": str(project_path)}, 1)
    if not layer_name:
        return out({"error": "layer_name_required"}, 1)

    qgis_prefix = os.environ.get("QGIS_PREFIX") or os.environ.get("QGIS_PREFIX_PATH")
    if not qgis_prefix:
        return out({"error": "qgis_prefix_missing"}, 1)

    try:
        from qgis.core import (
            QgsApplication,
            QgsProject,
            QgsCoordinateReferenceSystem,
            QgsCoordinateTransform,
            QgsCoordinateTransformContext,
            QgsFeatureRequest,
            QgsRectangle,
            QgsPointXY,
            QgsGeometry,
            QgsWkbTypes
        )
    except Exception as err:
        return out({"error": "qgis_import_failed", "details": str(err)}, 1)

    QgsApplication.setPrefixPath(qgis_prefix, True)
    qgs = QgsApplication([], False)
    qgs.initQgis()

    try:
        project = QgsProject.instance()
        if not project.read(str(project_path)):
            return out({"error": "project_load_failed"}, 1)

        layers = project.mapLayersByName(layer_name)
        if not layers:
            return out({"error": "layer_not_found", "layer": layer_name}, 1)

        layer = layers[0]
        if not layer or not layer.isValid() or layer.type() != layer.VectorLayer:
            return out({"error": "layer_invalid", "layer": layer_name}, 1)

        wgs84 = QgsCoordinateReferenceSystem('EPSG:4326')
        transform_context = QgsCoordinateTransformContext(project.transformContext())
        layer_crs = layer.crs() if hasattr(layer, 'crs') else None
        if not layer_crs or not layer_crs.isValid():
            return out({"error": "layer_crs_invalid", "layer": layer_name}, 1)

        tr = QgsCoordinateTransform(wgs84, layer_crs, transform_context)
        point_layer = tr.transform(QgsPointXY(lon, lat))

        # Convert meter tolerance to map units for rough point-hit testing.
        tol = max(0.01, tolerance_meters)
        if layer_crs.isGeographic():
            # ~ meters to degrees
            tol = max(1e-7, tolerance_meters / 111320.0)

        search_rect = QgsRectangle(
            point_layer.x() - tol,
            point_layer.y() - tol,
            point_layer.x() + tol,
            point_layer.y() + tol
        )

        req = QgsFeatureRequest().setFilterRect(search_rect)
        req.setLimit(max(1, min(limit, 200)))

        point_geom = QgsGeometry.fromPointXY(point_layer)
        out_features = []

        for feature in layer.getFeatures(req):
            geom = feature.geometry()
            if not geom or geom.isEmpty():
                continue

            matched = False
            try:
                if geom.intersects(point_geom):
                    matched = True
                else:
                    dist = geom.distance(point_geom)
                    if dist is not None and dist <= tol:
                        matched = True
            except Exception:
                continue

            if not matched:
                continue

            attrs = {}
            for field in layer.fields():
                name = str(field.name())
                attrs[name] = to_json_safe(feature[name])

            out_features.append({
                "featureId": int(feature.id()),
                "layer": layer_name,
                "geometryType": QgsWkbTypes.displayString(geom.wkbType()),
                "geometryWkt": geom.asWkt(),
                "properties": attrs
            })

            if len(out_features) >= max(1, min(limit, 200)):
                break

        return out({
            "ok": True,
            "project": str(project_path),
            "layer": layer_name,
            "input": {
                "lon": lon,
                "lat": lat,
                "tolerance": tolerance_meters
            },
            "count": len(out_features),
            "features": out_features
        }, 0)
    except Exception as err:
        return out({"error": "identify_failed", "details": str(err)}, 1)
    finally:
        try:
            qgs.exitQgis()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
