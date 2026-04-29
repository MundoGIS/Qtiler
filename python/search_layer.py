import sys
import os
import json

# Lightweight QGIS search helper for Qtiler.
# Args:
#   1) project_path
#   2) layer_name
#   3) fields_json  (JSON array of field names)
#   4) query
#   5) title_field
#   6) limit


def json_safe(value):
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    try:
        # QDate/QDateTime/QVariant-like
        if hasattr(value, "toString"):
            return str(value.toString())
    except Exception:
        pass
    return str(value)


def build_expression(fields, query):
    q = (query or "").lower().replace("'", "''")
    if not q:
        return ""
    parts = []
    for field in fields:
        field = str(field).replace('"', '""')
        # Use prefix matching for faster, expected behavior (case-insensitive)
        parts.append(f"lower(coalesce(to_string(\"{field}\"), '')) LIKE '{q}%'")
    return " OR ".join(parts)


def main():
    if len(sys.argv) < 7:
        print(json.dumps({"error": "missing_args"}))
        return 1

    project_path = sys.argv[1]
    layer_name = sys.argv[2]
    fields_json = sys.argv[3]
    query = sys.argv[4]
    title_field = sys.argv[5]
    try:
        limit = int(sys.argv[6])
    except Exception:
        limit = 50

    try:
        fields = json.loads(fields_json)
        if not isinstance(fields, list):
            fields = []
    except Exception:
        fields = []

    if not fields:
        print(json.dumps([]))
        return 0

    qgis_prefix = os.environ.get("QGIS_PREFIX") or os.environ.get("QGIS_PREFIX_PATH")
    if not qgis_prefix:
        print(json.dumps({"error": "QGIS_PREFIX not set"}))
        return 1

    try:
        from qgis.core import QgsApplication, QgsProject, QgsExpression, QgsFeatureRequest
    except Exception as e:
        print(json.dumps({"error": f"QGIS import failed: {e}"}))
        return 1

    QgsApplication.setPrefixPath(qgis_prefix, True)
    qgs = QgsApplication([], False)
    qgs.initQgis()

    try:
        project = QgsProject.instance()
        ok = project.read(project_path)
        if not ok:
            print(json.dumps({"error": "project_load_failed"}))
            return 1

        layers = project.mapLayersByName(layer_name)
        if not layers:
            print(json.dumps({"error": f"layer_not_found: {layer_name}"}))
            return 1

        layer = layers[0]
        if not layer.isValid():
            print(json.dumps({"error": f"layer_invalid: {layer_name}"}))
            return 1

        # Normalize fields: allow case-insensitive matches
        available = [f.name() for f in layer.fields()]
        available_lower = {f.name().lower(): f.name() for f in layer.fields()}
        normalized_fields = []
        for f in fields:
            if f in available:
                normalized_fields.append(f)
            else:
                key = str(f).lower()
                if key in available_lower:
                    normalized_fields.append(available_lower[key])

        # If none matched, fallback to all fields
        if not normalized_fields:
            normalized_fields = available

        expr_str = build_expression(normalized_fields, query)
        if not expr_str:
            print(json.dumps([]))
            return 0

        expr = QgsExpression(expr_str)
        if expr.hasParserError():
            print(json.dumps({"error": f"expression_error: {expr.parserErrorString()}"}))
            return 1

        req = QgsFeatureRequest(expr)
        if limit and limit > 0:
            req.setLimit(limit)

        results = []
        field_names = [f.name() for f in layer.fields()]

        def append_feature(feature):
            row = {"id": feature.id(), "_layer": layer_name}
            for fname in field_names:
                row[fname] = json_safe(feature[fname])
            try:
                geom = feature.geometry()
                if geom is not None and not geom.isNull():
                    row["geometry"] = geom.asWkt()
                    bb = geom.boundingBox()
                    row["bbox"] = [bb.xMinimum(), bb.yMinimum(), bb.xMaximum(), bb.yMaximum()]
                    # Centroid fallback
                    try:
                        pt = geom.centroid().asPoint()
                        row["x"] = pt.x()
                        row["y"] = pt.y()
                    except Exception:
                        row["x"] = (bb.xMinimum() + bb.xMaximum()) / 2.0
                        row["y"] = (bb.yMinimum() + bb.yMaximum()) / 2.0
                    try:
                        row["crs"] = layer.crs().authid()
                    except Exception:
                        pass
                else:
                    row["geometry"] = None
            except Exception:
                row["geometry"] = None
            if title_field and title_field not in row:
                row[title_field] = None
            results.append(row)

        for feature in layer.getFeatures(req):
            append_feature(feature)

        # Fallback: manual prefix scan when expression yields no results
        if not results:
            q = (query or "").lower()
            if q:
                for feature in layer.getFeatures():
                    matched = False
                    for fname in normalized_fields:
                        try:
                            val = feature[fname]
                            if val is None:
                                continue
                            if str(val).lower().startswith(q):
                                matched = True
                                break
                        except Exception:
                            continue
                    if matched:
                        append_feature(feature)
                        if limit and len(results) >= limit:
                            break

        print(json.dumps(results))
        return 0
    finally:
        qgs.exitQgis()


if __name__ == "__main__":
    sys.exit(main())
