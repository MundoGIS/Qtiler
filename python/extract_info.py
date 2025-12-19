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
from urllib.parse import parse_qsl

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

# --- Force Qt cache directory to repo-local path to avoid using user AppData paths ---
try:
    repo_root = Path(__file__).resolve().parent.parent
    cache_dir = repo_root / 'cache' / 'python'
    cache_dir.mkdir(parents=True, exist_ok=True)
    from PyQt5.QtCore import QStandardPaths
    QStandardPaths.setPath(QStandardPaths.CacheLocation, str(cache_dir))
    sys.stderr.write(json.dumps({"info": "qt_cache_location_set", "path": str(cache_dir)}) + "\n")
except Exception:
    pass

# --- Leer variables (permitir override por .env / entorno) ---
QGIS_PREFIX = os.environ.get("QGIS_PREFIX")
OSGEO4W_BIN = os.environ.get("OSGEO4W_BIN")
DEFAULT_PROJECT_PATH = os.environ.get("PROJECT_PATH")
if not QGIS_PREFIX:
    sys.stderr.write(json.dumps({"error": "missing_env", "var": "QGIS_PREFIX", "msg": "Set QGIS_PREFIX in .env to your QGIS installation path"}) + "\n")
    sys.exit(2)
if not OSGEO4W_BIN:
    sys.stderr.write(json.dumps({"error": "missing_env", "var": "OSGEO4W_BIN", "msg": "Set OSGEO4W_BIN in .env to your o4w bin path (or QGIS bin)"}) + "\n")
    sys.exit(2)

# If PROJECT_PATH not set, auto-detect any project in repo qgisprojects folder
if not DEFAULT_PROJECT_PATH:
    candidate_dir = Path(__file__).resolve().parent.parent / 'qgisprojects'
    picked = None
    if candidate_dir.exists() and candidate_dir.is_dir():
        for ext in ('*.qgz', '*.qgs'):
            found = list(candidate_dir.glob(ext))
            if found:
                picked = found[0]
                break
    if picked:
        DEFAULT_PROJECT_PATH = str(picked.resolve())
        sys.stderr.write(json.dumps({"info": "auto_project_detected", "path": DEFAULT_PROJECT_PATH}) + "\n")
    else:
        sys.stderr.write(json.dumps({"error": "missing_env", "var": "PROJECT_PATH", "msg": "Set PROJECT_PATH in .env to the QGIS project file path or place a .qgz/.qgs in qgisprojects/"}) + "\n")
        sys.exit(2)

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

# Attempt to override network disk cache to repo-local directory to avoid AppData access
try:
    from qgis.PyQt.QtNetwork import QNetworkDiskCache
    try:
        from qgis.core import QgsNetworkAccessManager
        nam = QgsNetworkAccessManager.instance()
    except Exception:
        from qgis.PyQt.QtNetwork import QNetworkAccessManager
        nam = QNetworkAccessManager()
    disk = QNetworkDiskCache()
    repo_root = Path(__file__).resolve().parent.parent
    disk.setCacheDirectory(str(repo_root / 'cache' / 'python'))
    # Limit disk cache to 50 MB to improve WMS performance but avoid large disk use
    disk.setMaximumCacheSize(50 * 1024 * 1024)
    try:
        nam.setCache(disk)
        sys.stderr.write(json.dumps({"info": "network_disk_cache_set", "path": str(repo_root / 'cache' / 'python')}) + "\n")
    except Exception:
        pass
except Exception:
    pass

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
project_view_extent = None
project_view_extent_wgs84 = None
layers = []
wgs84 = QgsCoordinateReferenceSystem('EPSG:4326')
themes = []


def safe_get_attribution(layer):
    """Return a attribution string using newer metadata API if available,
    falling back to the old `attribution()` method. Returns None if not found.
    """
    try:
        # Try metadata() API first (newer QGIS versions)
        md_func = getattr(layer, 'metadata', None)
        if callable(md_func):
            try:
                md = md_func()
                attr = getattr(md, 'attribution', None)
                if callable(attr):
                    try:
                        val = attr()
                        return val or None
                    except Exception:
                        pass
                else:
                    return attr or None
            except Exception:
                pass
        # Fallback to legacy attribution() if present
        attr_func = getattr(layer, 'attribution', None)
        if callable(attr_func):
            try:
                return attr_func() or None
            except Exception:
                return None
        return attr_func or None
    except Exception:
        return None

try:
    view_settings = project.viewSettings()
    try:
        rect = view_settings.defaultViewExtent()
        if rect and not rect.isEmpty():
            project_view_extent = QgsRectangle(rect)
    except Exception:
        project_view_extent = None
except Exception:
    view_settings = None

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

    remote_source = None
    if provider_lc in {"xyz", "tile"}:
        source_uri = layer.source() or ""
        if source_uri:
            remote_source = {
                "type": "xyz",
                "url_template": source_uri,
                "attribution": safe_get_attribution(layer)
            }
    elif provider_lc == "wms":
        source_uri = layer.source() or ""
        if source_uri:
            params = dict(parse_qsl(source_uri, keep_blank_values=True))
            url = params.get("url") or params.get("contextualWMSLegend")
            layers_param = params.get("layers")
            styles_param = params.get("styles")
            format_param = params.get("format")
            version_param = params.get("version")
            crs_param = params.get("crs") or params.get("srs")
            if url and layers_param:
                remote_source = {
                    "type": "wms",
                    "url": url,
                    "layers": layers_param,
                    "styles": styles_param or None,
                    "format": format_param or None,
                    "version": version_param or None,
                    "crs": crs_param or None,
                    "attribution": safe_get_attribution(layer)
                }

    layer_payload = {
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
    }
    if remote_source:
        layer_payload["remote_source"] = remote_source

    layers.append(layer_payload)

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

if project_view_extent and project_view_extent_wgs84 is None:
    try:
        transform_project_wgs = QgsCoordinateTransform(project_crs, wgs84, project) if project_crs and project_crs.isValid() else None
        if transform_project_wgs:
            project_view_extent_wgs84 = transform_project_wgs.transformBoundingBox(QgsRectangle(project_view_extent))
    except Exception:
        project_view_extent_wgs84 = None

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
        "extent_wgs84": rect_to_list(project_extent_wgs84),
        "view_extent": rect_to_list(project_view_extent),
        "view_extent_wgs84": rect_to_list(project_view_extent_wgs84)
    },
    "layers": layers,
    "themes": themes
}

print(json.dumps(result))
qgs.exitQgis()
