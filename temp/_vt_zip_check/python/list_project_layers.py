import json
import os
import sys
from pathlib import Path


def out(payload, code=0):
    print(json.dumps(payload, ensure_ascii=False))
    return code


def main():
    if len(sys.argv) < 2:
        return out({"error": "project_path_required"}, 1)

    project_path = Path(sys.argv[1]).resolve()
    if not project_path.exists():
        return out({"error": "project_not_found", "project": str(project_path)}, 1)

    qgis_prefix = os.environ.get("QGIS_PREFIX") or os.environ.get("QGIS_PREFIX_PATH")
    if not qgis_prefix:
        return out({"error": "qgis_prefix_missing", "message": "QGIS_PREFIX env var is required"}, 1)

    try:
        from qgis.core import (
            QgsApplication,
            QgsProject,
            QgsWkbTypes,
            QgsCoordinateReferenceSystem,
            QgsCoordinateTransform,
            QgsCoordinateTransformContext
        )
    except Exception as err:
        return out({"error": "qgis_import_failed", "details": str(err)}, 1)

    QgsApplication.setPrefixPath(qgis_prefix, True)
    qgs = QgsApplication([], False)
    qgs.initQgis()

    try:
        project = QgsProject.instance()
        ok = project.read(str(project_path))
        if not ok:
            return out({"error": "project_load_failed", "project": str(project_path)}, 1)

        layers = []
        wgs84 = QgsCoordinateReferenceSystem('EPSG:4326')
        transform_context = QgsCoordinateTransformContext(project.transformContext())

        def extent_to_list(rect):
            if not rect or not rect.isFinite():
                return None
            return [rect.xMinimum(), rect.yMinimum(), rect.xMaximum(), rect.yMaximum()]

        def to_wgs84(rect, source_crs):
            if not rect or not rect.isFinite() or not source_crs or not source_crs.isValid():
                return None
            try:
                if source_crs == wgs84:
                    return extent_to_list(rect)
                tr = QgsCoordinateTransform(source_crs, wgs84, transform_context)
                rect_out = tr.transformBoundingBox(rect)
                return extent_to_list(rect_out)
            except Exception:
                return None

        for layer in project.mapLayers().values():
            try:
                if not layer or not layer.isValid():
                    continue
                if layer.type() != layer.VectorLayer:
                    continue
                if layer.geometryType() == QgsWkbTypes.NullGeometry:
                    continue

                geom = layer.geometryType()
                geom_name = {
                    QgsWkbTypes.PointGeometry: "point",
                    QgsWkbTypes.LineGeometry: "line",
                    QgsWkbTypes.PolygonGeometry: "polygon",
                }.get(geom, "unknown")

                source_crs = layer.crs() if hasattr(layer, 'crs') else None
                source_crs_authid = source_crs.authid() if source_crs and source_crs.isValid() else ''
                layer_extent = layer.extent() if hasattr(layer, 'extent') else None

                layers.append({
                    "id": layer.id(),
                    "name": layer.name(),
                    "geometry": geom_name,
                    "source": str(layer.source() or ""),
                    "crs": source_crs_authid,
                    "extent": extent_to_list(layer_extent),
                    "extent_wgs84": to_wgs84(layer_extent, source_crs)
                })
            except Exception:
                continue

        layers.sort(key=lambda item: str(item.get("name") or "").lower())
        return out({"ok": True, "project": str(project_path), "layers": layers}, 0)
    finally:
        try:
            qgs.exitQgis()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
