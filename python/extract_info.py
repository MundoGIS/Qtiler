"""
This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
Copyright (C) 2025 MundoGIS.
"""

import sys
import os
import json
import argparse
from pathlib import Path

# --- Cargar .env (intenta python-dotenv, fallback manual) ---
def load_dotenv_file(path: Path):
    try:
        import dotenv
        dotenv.load_dotenv(dotenv_path=str(path))
        return True
    except Exception:
        try:
            with open(path, "r", encoding="utf8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        k, v = line.split("=", 1)
                        v = v.strip().strip('"').strip("'")
                        if k and v is not None:
                            os.environ.setdefault(k, v)
            return True
        except Exception:
            return False

# buscar .env hacia arriba (hasta 4 niveles)
env_path = None
p = Path(__file__).resolve().parent
for _ in range(4):
    candidate = p / ".env"
    if candidate.exists():
        env_path = candidate
        break
    if p.parent == p:
        break
    p = p.parent

if env_path:
    load_dotenv_file(env_path)

# --- Leer variables (permitir override por .env / entorno) ---
QGIS_PREFIX = os.environ.get("QGIS_PREFIX", r"C:\OSGeo4W\apps\qgis")
OSGEO4W_BIN = os.environ.get("OSGEO4W_BIN", r"C:\OSGeo4W\bin")
DEFAULT_PROJECT_PATH = os.environ.get("PROJECT_PATH", r"C:\qgisprojekt\bakgrunder.qgz")

# --- Asegurar DLL paths y PYTHONPATH antes de importar qgis ---
# Añadir rutas de binarios (DLLs) a PATH y registrar con add_dll_directory en Windows
if os.name == "nt":
    qgis_bin = os.path.join(QGIS_PREFIX, "bin")
    # Prepend to PATH
    path_parts = [OSGEO4W_BIN, qgis_bin, os.environ.get("PATH", "")]
    os.environ["PATH"] = ";".join([p for p in path_parts if p])
    # desde Python 3.8 se recomienda add_dll_directory
    try:
        for d in (OSGEO4W_BIN, qgis_bin):
            if os.path.isdir(d):
                os.add_dll_directory(d)
    except Exception:
        # no crítico, seguimos (os.add_dll_directory puede no existir en versiones antiguas)
        pass

# añadir ruta Python de QGIS al inicio de sys.path
qgis_python = os.path.join(QGIS_PREFIX, "python")
if os.path.isdir(qgis_python) and qgis_python not in sys.path:
    sys.path.insert(0, qgis_python)

# Ahora importar QGIS
try:
    from qgis.core import (
        QgsApplication,
        QgsProject,
        QgsCoordinateReferenceSystem,
        QgsCoordinateTransform,
        QgsRectangle
    )
except Exception as e:
    import sys as _sys
    _sys.stderr.write(json.dumps({"error": "No se pudo importar qgis", "details": str(e)}) + "\n")
    _sys.exit(1)

# --- Inicialización y resto del script ---
QgsApplication.setPrefixPath(QGIS_PREFIX, True)
qgs = QgsApplication([], False)
qgs.initQgis()

# argumentos opcionales
parser = argparse.ArgumentParser()
parser.add_argument("--project", default=None)
args = parser.parse_args()
PROJECT_PATH = args.project or DEFAULT_PROJECT_PATH

project = QgsProject.instance()
if not project.read(PROJECT_PATH):
    import sys as _sys
    _sys.stderr.write(json.dumps({"error": f"No se pudo leer el proyecto: {PROJECT_PATH}"}) + "\n")
    qgs.exitQgis()
    _sys.exit(1)

project_crs = project.crs()
project_extent = None
project_extent_wgs84 = None
layers = []
wgs84 = QgsCoordinateReferenceSystem('EPSG:4326')
themes = []

for layer in project.mapLayers().values():
    extent = layer.extent()
    try:
        provider = getattr(layer, "providerType", lambda: "")() or ""
    except Exception:
        provider = ""
    provider_lc = provider.lower()
    non_cacheable = {"xyz", "wms", "wmts", "tile"}
    cacheable = provider_lc not in non_cacheable

    layer_crs = layer.crs()
    extent_list = [
        extent.xMinimum(),
        extent.yMinimum(),
        extent.xMaximum(),
        extent.yMaximum()
    ]

    extent_in_project = None
    name_lc = (layer.name() or "").lower()
    skip_for_union = provider_lc in non_cacheable or any(k in name_lc for k in ("google", "bing", "osm", "stamen", "mapbox"))
    if extent and project_crs and project_crs.isValid() and not skip_for_union:
        try:
            if layer_crs and layer_crs.isValid() and layer_crs.authid() != project_crs.authid():
                transform = QgsCoordinateTransform(layer_crs, project_crs, project)
                extent_in_project = transform.transformBoundingBox(QgsRectangle(extent))
            else:
                extent_in_project = QgsRectangle(extent)
        except Exception:
            extent_in_project = None

    if extent_in_project and not extent_in_project.isEmpty():
        if project_extent is None:
            project_extent = QgsRectangle(extent_in_project)
        else:
            project_extent.combineExtentWith(extent_in_project)

    extent_wgs84 = None
    if extent and layer_crs and layer_crs.isValid():
        try:
            transform_wgs = QgsCoordinateTransform(layer_crs, wgs84, project)
            extent_wgs84 = transform_wgs.transformBoundingBox(QgsRectangle(extent))
        except Exception:
            extent_wgs84 = None

    layers.append({
        "name": layer.name(),
        "id": layer.id(),
        "crs": layer_crs.authid(),
        "extent": extent_list,
        "extent_wgs84": [
            extent_wgs84.xMinimum(),
            extent_wgs84.yMinimum(),
            extent_wgs84.xMaximum(),
            extent_wgs84.yMaximum()
        ] if extent_wgs84 else None,
        "provider": provider,
        "cacheable": cacheable
    })

try:
    theme_collection = project.mapThemeCollection()
except Exception:
    theme_collection = None
if theme_collection:
    theme_names = []
    for attr in ("mapThemeNames", "themes", "mapThemes"):
        getter = getattr(theme_collection, attr, None)
        if callable(getter):
            try:
                value = getter()
                if isinstance(value, dict):
                    theme_names = list(value.keys())
                else:
                    theme_names = list(value)
                if theme_names:
                    break
            except Exception:
                continue
    for theme_name in theme_names or []:
        if not theme_name:
            continue
        themes.append({"name": theme_name})

if project_extent and project_extent_wgs84 is None:
    try:
        transform_project_wgs = QgsCoordinateTransform(project_crs, wgs84, project) if project_crs and project_crs.isValid() else None
        if transform_project_wgs:
            project_extent_wgs84 = transform_project_wgs.transformBoundingBox(QgsRectangle(project_extent))
    except Exception:
        project_extent_wgs84 = None

if project_extent_wgs84 is None and project_extent is None and layers:
    # fallback: build extent from layer WGS84 extents
    for lyr in layers:
        if not lyr.get("cacheable", True):
            continue
        le = lyr.get("extent_wgs84")
        if not le:
            continue
        rect = QgsRectangle(float(le[0]), float(le[1]), float(le[2]), float(le[3]))
        if project_extent_wgs84 is None:
            project_extent_wgs84 = rect
        else:
            project_extent_wgs84.combineExtentWith(rect)

def rect_to_list(rect):
    if not rect:
        return None
    return [rect.xMinimum(), rect.yMinimum(), rect.xMaximum(), rect.yMaximum()]

result = {
    "project": {
        "id": Path(PROJECT_PATH).stem,
        "path": PROJECT_PATH,
        "crs": project_crs.authid() if project_crs.isValid() else None,
        "extent": rect_to_list(project_extent),
        "extent_wgs84": rect_to_list(project_extent_wgs84)
    },
    "layers": layers,
    "themes": themes
}

print(json.dumps(result))
qgs.exitQgis()
