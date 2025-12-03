import sys, json, os
from pathlib import Path

# Intentar preparar rutas de QGIS (similar a generate_cache.py)
QGIS_PREFIX = os.environ.get("QGIS_PREFIX", r"C:\\OSGeo4W\\apps\\qgis")
OSGEO4W_BIN = os.environ.get("OSGEO4W_BIN", r"C:\\OSGeo4W\\bin")
if os.name == "nt":
    qgis_bin = os.path.join(QGIS_PREFIX, "bin")
    existing_path_parts = [p for p in os.environ.get("PATH", "").split(";") if p]
    new_parts_ordered = []
    for pth in (OSGEO4W_BIN, qgis_bin):
        if pth and pth not in new_parts_ordered:
            new_parts_ordered.append(pth)
    for pth in existing_path_parts:
        if pth not in new_parts_ordered:
            new_parts_ordered.append(pth)
    os.environ["PATH"] = ";".join(new_parts_ordered)
    try:
        for d in (OSGEO4W_BIN, qgis_bin):
            if os.path.isdir(d):
                os.add_dll_directory(d)
    except Exception:
        pass
qgis_python = os.path.join(QGIS_PREFIX, "python")
if os.path.isdir(qgis_python) and qgis_python not in sys.path:
    sys.path.insert(0, qgis_python)

try:
    from qgis.PyQt.QtGui import QImage
except Exception as e:
    print(json.dumps({"error": "qgis_import_failed", "details": str(e)}))
    sys.exit(2)

path = r'C:\Qtiler\cache\nogo\NoGO_vind_under_65ms\5\0\0.png'
if len(sys.argv) > 1:
    path = sys.argv[1]

p = Path(path)
if not p.exists():
    print(json.dumps({"error": "file_not_found", "path": str(p)}))
    sys.exit(2)

img = QImage()
if not img.load(str(p)):
    print(json.dumps({"error": "load_failed", "path": str(p)}))
    sys.exit(2)

w = img.width(); h = img.height()
non_transparent = 0
# contar píxeles con alpha>0 o con color distinto de (0,0,0)
for yy in range(h):
    for xx in range(w):
        try:
            c = img.pixelColor(xx, yy)
            a = c.alpha()
            if a > 0 and (c.red() != 0 or c.green() != 0 or c.blue() != 0):
                non_transparent += 1
        except Exception:
            continue

print(json.dumps({"path": str(p), "width": w, "height": h, "non_transparent_pixels": non_transparent}))
sys.exit(0)
