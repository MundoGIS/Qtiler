import sys
import os
import json
import datetime
import time
"""
This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
Copyright (C) 2025 MundoGIS.
"""

import argparse
import math
import signal
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
                        k = k.strip()
                        v = v.strip().strip('"').strip("'")
                        if k:
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
PROJECT_PATH = os.environ.get("PROJECT_PATH", r"C:\qgisprojekt\bakgrunder.qgz")
PROJECT_EXTENT_ENV = os.environ.get("PROJECT_EXTENT")  # formato: "minx,miny,maxx,maxy"

# --- Asegurar DLL paths y PYTHONPATH antes de importar qgis ---
if os.name == "nt":
    qgis_bin = os.path.join(QGIS_PREFIX, "bin")
    # Normalizar PATH evitando duplicados y asegurando que OSGEO4W_BIN y qgis_bin van primero
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

# Ahora importar QGIS (con manejo de error a stderr)
try:
    from qgis.core import (
        QgsApplication,
        QgsProject,
        QgsMapSettings,
        QgsMapRendererParallelJob,
        QgsRectangle,
        QgsCoordinateReferenceSystem,
        QgsCoordinateTransform,
    )
    from qgis.PyQt.QtCore import QSize
    from qgis.PyQt.QtGui import QColor
except Exception as e:
    sys.stderr.write(json.dumps({"error": "No se pudo importar qgis", "details": str(e)}) + "\n")
    sys.exit(1)

# --- Inicialización QGIS ---
QgsApplication.setPrefixPath(QGIS_PREFIX, True)
qgs = QgsApplication([], False)
qgs.initQgis()

# manejo de señales para terminar limpiamente
_terminate = {"flag": False}

def _graceful_exit(signum, frame):
    try:
        sys.stderr.write(json.dumps({"info": "signal_received", "signal": signum}) + "\n")
    except Exception:
        pass
    _terminate["flag"] = True

for _sig in (getattr(signal, "SIGTERM", None), getattr(signal, "SIGINT", None)):
    if _sig is not None:
        try:
            signal.signal(_sig, _graceful_exit)
        except Exception:
            pass

# Helper: esperar a que termine el render de forma compatible con distintas APIs y con timeout
def _wait_for_job(job, timeout_sec=30.0):
    try:
        import time as _t
        start = _t.time()
        last_heartbeat = start
        def _pump_events():
            try:
                QgsApplication.processEvents()
            except Exception:
                pass
        # Preferir isActive() si existe (true mientras el job corre)
        if hasattr(job, 'isActive') and callable(getattr(job, 'isActive')):
            while True:
                if _terminate["flag"]:
                    try:
                        job.cancel()
                    except Exception:
                        pass
                    return False
                _pump_events()
                try:
                    active = job.isActive()
                except Exception:
                    active = False
                if not active:
                    return True
                # heartbeat y timeout
                now = _t.time()
                if timeout_sec and (now - start) > timeout_sec:
                    try: job.cancel() 
                    except Exception: pass
                    try: sys.stderr.write(json.dumps({"warning":"render_timeout","elapsed_ms": int((now-start)*1000)})+"\n")
                    except Exception: pass
                    return False
                if (now - last_heartbeat) > 5.0:
                    try: sys.stdout.write(json.dumps({"debug":"render_wait","elapsed_ms": int((now-start)*1000)})+"\n"); sys.stdout.flush()
                    except Exception: pass
                    last_heartbeat = now
                _t.sleep(0.01)
                _pump_events()
        elif hasattr(job, 'isFinished') and callable(getattr(job, 'isFinished')):
            while True:
                if _terminate["flag"]:
                    try:
                        job.cancel()
                    except Exception:
                        pass
                    return False
                _pump_events()
                try:
                    done = job.isFinished()
                except Exception:
                    # si falla la consulta, salir al waitForFinished
                    done = True
                if done:
                    return True
                now = _t.time()
                if timeout_sec and (now - start) > timeout_sec:
                    try: job.cancel()
                    except Exception: pass
                    try: sys.stderr.write(json.dumps({"warning":"render_timeout","elapsed_ms": int((now-start)*1000)})+"\n")
                    except Exception: pass
                    return False
                if (now - last_heartbeat) > 5.0:
                    try: sys.stdout.write(json.dumps({"debug":"render_wait","elapsed_ms": int((now-start)*1000)})+"\n"); sys.stdout.flush()
                    except Exception: pass
                    last_heartbeat = now
                _t.sleep(0.01)
                _pump_events()
        else:
            # Fallback: pequeño bucle de espera con posibilidad de cancelación (~10s)
            for _ in range(1000):
                if _terminate["flag"]:
                    try:
                        job.cancel()
                    except Exception:
                        pass
                    return False
                _t.sleep(0.01)
                _pump_events()
        # Si llegamos aquí sin return, intentar rematar con waitForFinished
        try: job.waitForFinished()
        except Exception: pass
        return True
    except Exception:
        try: job.waitForFinished()
        except Exception: pass
        return False

def _sanitize_storage_name(name: str) -> str:
    if not name:
        return "cache_item"
    cleaned = name.strip()
    if not cleaned:
        cleaned = name
    INVALID = set('<>:"/\\|?*')
    safe = ''.join('_' if c in INVALID else c for c in cleaned)
    safe = safe.replace('..', '_')
    return safe or "cache_item"

def _resolve_theme_layers(project: QgsProject, theme_name: str):
    layers = []
    if not theme_name:
        return layers
    try:
        collection = project.mapThemeCollection()
    except Exception:
        collection = None
    if not collection:
        return layers

    theme_exists = False
    try:
        if hasattr(collection, "hasMapTheme") and callable(collection.hasMapTheme):
            theme_exists = bool(collection.hasMapTheme(theme_name))
    except Exception:
        theme_exists = False
    if not theme_exists:
        try:
            if hasattr(collection, "mapThemeNames"):
                names = collection.mapThemeNames()
                if names and theme_name in list(names):
                    theme_exists = True
        except Exception:
            theme_exists = False
    if not theme_exists:
        try:
            theme_map = getattr(collection, "mapThemes", None)
            if callable(theme_map):
                data = theme_map()
                if isinstance(data, dict) and theme_name in data:
                    theme_exists = True
        except Exception:
            pass
    if not theme_exists:
        return layers

    theme_state = None
    for attr in ("mapThemeState", "mapTheme"):
        method = getattr(collection, attr, None)
        if callable(method):
            try:
                theme_state = method(theme_name)
                if theme_state:
                    break
            except Exception:
                theme_state = None
    layer_ids = []
    if theme_state is not None:
        candidates = []
        for attr in ("layerStates", "layerStateMap", "layers", "mapLayers", "layerMap"):
            value = getattr(theme_state, attr, None)
            if callable(value):
                try:
                    value = value()
                except Exception:
                    value = None
            if value:
                candidates.append(value)
        for candidate in candidates:
            if isinstance(candidate, dict):
                for layer_id, record in candidate.items():
                    visible = None
                    for attr in ("visible", "isVisible", "checked", "visibility", "isChecked"):
                        if hasattr(record, attr):
                            try:
                                value = getattr(record, attr)
                                visible = value() if callable(value) else value
                            except Exception:
                                visible = None
                            if visible is not None:
                                break
                    if visible is None and isinstance(record, dict):
                        visible = record.get("visible")
                        if visible is None:
                            visible = record.get("checked")
                    if visible is None:
                        visible = True
                    if visible:
                        layer_ids.append(layer_id)
            elif isinstance(candidate, (list, tuple, set)):
                for entry in candidate:
                    if isinstance(entry, str):
                        layer_ids.append(entry)
                    else:
                        lyr = None
                        try:
                            lyr = entry.layer() if hasattr(entry, "layer") else None
                        except Exception:
                            lyr = None
                        if lyr is None and hasattr(entry, "id"):
                            try:
                                layer_ids.append(entry.id())
                            except Exception:
                                pass
        if not layer_ids:
            for attr in ("layerIds", "visibleLayerIds"):
                value = getattr(theme_state, attr, None)
                if callable(value):
                    try:
                        value = value()
                    except Exception:
                        value = None
                if isinstance(value, (list, tuple, set)):
                    for entry in value:
                        if isinstance(entry, str):
                            layer_ids.append(entry)
    if not layer_ids:
        try:
            root = project.layerTreeRoot()
            if root:
                group = root.findGroup(theme_name)
                if group:
                    for node in group.findLayers():
                        lyr = node.layer()
                        if lyr:
                            layer_ids.append(lyr.id())
        except Exception:
            pass
    if not layer_ids:
        try:
            root = project.layerTreeRoot()
            if root:
                for node in root.findLayers():
                    if hasattr(node, "isVisible"):
                        try:
                            visible = node.isVisible()
                        except Exception:
                            visible = True
                    else:
                        visible = True
                    if visible:
                        lyr = node.layer()
                        if lyr:
                            layer_ids.append(lyr.id())
        except Exception:
            pass
    if not layer_ids:
        try:
            layer_ids = list(project.mapLayers().keys())
        except Exception:
            layer_ids = []

    seen = set()
    for layer_id in layer_ids:
        if layer_id in seen:
            continue
        seen.add(layer_id)
        lyr = project.mapLayer(layer_id)
        if lyr:
            layers.append(lyr)

    try:
        root = project.layerTreeRoot()
        if root:
            order = []
            try:
                order_candidates = root.layerOrder()
            except Exception:
                order_candidates = []
            for candidate in order_candidates or []:
                if isinstance(candidate, str):
                    order.append(candidate)
                    continue
                if hasattr(candidate, "layerId") and callable(candidate.layerId):
                    try:
                        order.append(candidate.layerId())
                        continue
                    except Exception:
                        pass
                if hasattr(candidate, "id"):
                    try:
                        value = candidate.id() if callable(candidate.id) else candidate.id
                        if isinstance(value, str):
                            order.append(value)
                            continue
                    except Exception:
                        pass
            if order:
                layers.sort(key=lambda lyr: order.index(lyr.id()) if lyr.id() in order else len(order))
    except Exception:
        pass

    deduped = []
    seen_ids = set()
    for lyr in layers:
        lid = getattr(lyr, "id", lambda: None)()
        if lid in seen_ids:
            continue
        seen_ids.add(lid)
        deduped.append(lyr)
    return deduped
# --- Argumentos ---
parser = argparse.ArgumentParser()
parser.add_argument("--layer", default=None)
parser.add_argument("--theme", default=None, help="Nombre de tema de mapa a renderizar como composite")
parser.add_argument("--output_dir", default=None)
parser.add_argument("--zoom_min", type=int, default=0)
parser.add_argument("--zoom_max", type=int, default=0)
parser.add_argument("--project", default=PROJECT_PATH)
parser.add_argument("--index_path", default=None)
parser.add_argument("--project_extent", default=None, help="minx,miny,maxx,maxy (override, comma separated)")
parser.add_argument("--project_extent4", nargs=4, metavar=("MINX","MINY","MAXX","MAXY"), help="Extent override as 4 separate numeric args to avoid quoting issues", default=None)
parser.add_argument("--extent_crs", default=None, help="CRS del project_extent si no está en el CRS del proyecto")
parser.add_argument("--use_project_extent", action="store_true", help="usar extent calculado del proyecto")
parser.add_argument("--tile_crs", default=None, help="CRS de las tiles (ej: EPSG:3857). Por defecto usa CRS del proyecto")
parser.add_argument("--scheme", choices=["auto","xyz","custom"], default="auto", help="Esquema de teselas: 'xyz' (slippy EPSG:3857) o 'custom' (grid local por bbox). 'auto' usa xyz si CRS=EPSG:3857")
parser.add_argument("--xyz_mode", choices=["partial","world"], default="partial", help="Para esquema xyz: 'partial' genera solo las teselas que intersectan el extent; 'world' genera toda la cuadrícula para cada zoom.")
parser.add_argument("--wmts", action="store_true", help="Usar esquema WMTS local (TileMatrixSet derivado del extent y CRS)")
parser.add_argument("--png_compression", type=int, default=int(os.environ.get("PNG_COMPRESSION", "3")), help="Compresión PNG 0-9 (0=sin compresión, 9=máxima)")
parser.add_argument("--allow_remote", action="store_true", help="Permitir cachear capas remotas (WMS/WMTS/XYZ/Tile). Asegúrate de tener permiso.")
parser.add_argument("--throttle_ms", type=int, default=int(os.environ.get("REMOTE_THROTTLE_MS", "0")), help="Demora opcional en milisegundos entre tiles (útil para servicios remotos)")
parser.add_argument("--render_timeout_ms", type=int, default=int(os.environ.get("RENDER_TIMEOUT_MS", "30000")), help="Tiempo máximo por tile (ms) antes de cancelar e intentar el siguiente")
parser.add_argument("--tile_retries", type=int, default=int(os.environ.get("TILE_RETRIES", "1")), help="Reintentos por tile después de timeout/fallo")
parser.add_argument("--skip_existing", action="store_true", help="Omitir render si el archivo de tile ya existe")
args = parser.parse_args()

if not args.layer and not args.theme:
    sys.stderr.write(json.dumps({"error": "Se requiere --layer o --theme"}) + "\n")
    qgs.exitQgis(); sys.exit(1)
if args.layer and args.theme:
    sys.stderr.write(json.dumps({"error": "Usa solo uno de --layer o --theme"}) + "\n")
    qgs.exitQgis(); sys.exit(1)

# Validaciones básicas de argumentos
if args.zoom_min < 0:
    args.zoom_min = 0
if args.zoom_max < 0:
    args.zoom_max = 0
if args.zoom_min > args.zoom_max and not (args.zoom_min == 0 and args.zoom_max == 0):
    args.zoom_min, args.zoom_max = args.zoom_max, args.zoom_min

# Saneo ligero del identificador de destino
INVALID_CHARS = set('<>:"/\\|?*')
target_mode = "theme" if args.theme else "layer"
target_name = (args.theme if target_mode == "theme" else args.layer) or ""
target_name = target_name.strip()
if not target_name:
    sys.stderr.write(json.dumps({"error": "Nombre inválido para el destino"}) + "\n")
    qgs.exitQgis(); sys.exit(1)
if any(c in INVALID_CHARS for c in target_name):
    sys.stderr.write(json.dumps({"warning": "target_name_contains_invalid_chars", "name": target_name}) + "\n")
storage_name = _sanitize_storage_name(target_name)

# cargar proyecto
project = QgsProject.instance()
if not project.read(args.project):
    sys.stderr.write(json.dumps({"error": "No se pudo leer el proyecto", "details": args.project}) + "\n")
    qgs.exitQgis(); sys.exit(1)

# resolver capas objetivo
target_layers = []
if target_mode == "theme":
    target_layers = _resolve_theme_layers(project, target_name)
    if not target_layers:
        sys.stderr.write(json.dumps({"error": "Tema sin capas visibles", "theme": target_name}) + "\n")
        qgs.exitQgis(); sys.exit(1)
else:
    for lyr in project.mapLayers().values():
        if lyr.name() == target_name:
            target_layers = [lyr]
            break
    if not target_layers:
        sys.stderr.write(json.dumps({"error": "Capa no encontrada", "layer": target_name}) + "\n")
        qgs.exitQgis(); sys.exit(1)

layer = target_layers[0]

# provider guard (opt-in remoto)
remote_providers = {"xyz", "wms", "wmts", "tile"}
for lyr in target_layers:
    try:
        prov = getattr(lyr, "providerType", lambda: "")() or ""
    except Exception:
        prov = ""
    if prov.lower() in remote_providers and not args.allow_remote:
        sys.stderr.write(json.dumps({
            "error": "layer_provider_not_supported_for_caching",
            "target": target_name,
            "provider": prov,
            "details": "Remote layer; habilita allow_remote para cachear"
        }) + "\n")
        qgs.exitQgis(); sys.exit(2)
    if prov.lower() in remote_providers and (not args.render_timeout_ms or args.render_timeout_ms < 60000):
        args.render_timeout_ms = 60000

proj_crs_candidate = project.crs()
try:
    project_crs = proj_crs_candidate if proj_crs_candidate.isValid() else layer.crs()
except Exception:
    project_crs = proj_crs_candidate or layer.crs()
if project_crs is None:
    project_crs = layer.crs()

# determinar project extent (en project_crs)
project_extent = None
""" Prioridad de extent override:
1) --project_extent4 MINX MINY MAXX MAXY (evita problemas de comas/espacios)
2) --project_extent "minx,miny,maxx,maxy" (cadena separada por comas)
3) PROJECT_EXTENT env var
4) calculado del proyecto / capa
"""

# 1) argumento --project_extent4 (más robusto)
if project_extent is None and args.project_extent4:
    try:
        parts = [float(x) for x in args.project_extent4]
        if len(parts) == 4:
            project_extent = QgsRectangle(*parts)
            if args.extent_crs:
                try:
                    src_crs = QgsCoordinateReferenceSystem(args.extent_crs)
                    if src_crs.isValid() and project_crs and project_crs.isValid() and src_crs.authid() != project_crs.authid():
                        tx = QgsCoordinateTransform(src_crs, project_crs, project)
                        project_extent = tx.transformBoundingBox(project_extent)
                except Exception as e:
                    sys.stderr.write(json.dumps({"warning": "extent_crs transform failed", "details": str(e)}) + "\n")
    except Exception as e:
        sys.stderr.write(json.dumps({"warning": "project_extent4 parse failed", "details": str(e)}) + "\n")

# 2) argumento --project_extent (cadena)
if project_extent is None and args.project_extent:
    try:
        parts = [float(x) for x in args.project_extent.split(",")]
        if len(parts) == 4:
            project_extent = QgsRectangle(*parts)
            if args.extent_crs:
                try:
                    src_crs = QgsCoordinateReferenceSystem(args.extent_crs)
                    if src_crs.isValid() and project_crs and project_crs.isValid() and src_crs.authid() != project_crs.authid():
                        tx = QgsCoordinateTransform(src_crs, project_crs, project)
                        project_extent = tx.transformBoundingBox(project_extent)
                except Exception as e:
                    sys.stderr.write(json.dumps({"warning": "extent_crs transform failed", "details": str(e)}) + "\n")
    except Exception as e:
        sys.stderr.write(json.dumps({"warning": "project_extent parse failed", "details": str(e)}) + "\n")

# 2) ENV PROJECT_EXTENT
if project_extent is None and PROJECT_EXTENT_ENV:
    try:
        parts = [float(x) for x in PROJECT_EXTENT_ENV.split(",")]
        if len(parts) == 4:
            project_extent = QgsRectangle(*parts)
    except Exception as e:
        sys.stderr.write(json.dumps({"warning": "PROJECT_EXTENT parse failed", "details": str(e)}) + "\n")

# 3) calcular union de capas del proyecto (si se pidió o no se dio bbox)
if project_extent is None:
    union = None
    SKIP_PROVIDERS = {"xyz", "wms", "wmts", "tile", "gdal"}
    layers_for_extent = target_layers if target_mode == "theme" else project.mapLayers().values()
    for lyr in layers_for_extent:
        try:
            prov = getattr(lyr, "providerType", lambda: "")()
            if prov and prov.lower() in SKIP_PROVIDERS:
                continue
            name = getattr(lyr, "name", lambda: "")()
            if isinstance(name, str) and any(k in name.lower() for k in ("google", "bing", "osm", "stamen", "mapbox")):
                continue
            ext = lyr.extent()
            if ext is None:
                continue
            try:
                empty = ext.isEmpty()
            except Exception:
                empty = False
            if empty:
                continue
            if union is None:
                union = QgsRectangle(ext)
            else:
                union.combineExtentWith(ext)
        except Exception:
            continue
    if union is not None:
        project_extent = union

# 4) fallback: usar extent de la capa
if project_extent is None:
    project_extent = layer.extent()

if project_extent is None:
    sys.stderr.write(json.dumps({"error": "No se pudo determinar project_extent"}) + "\n")
    qgs.exitQgis()
    sys.exit(1)

# --- REEMPLAZAR desde aqui: decidir tile_crs y reproyectar project_extent ---
# tile CRS: por defecto usar la CRS de la capa (comportamiento solicitado)
if args.tile_crs:
    try:
        tile_crs = QgsCoordinateReferenceSystem(args.tile_crs)
    except Exception as e:
        sys.stderr.write(json.dumps({"warning": "tile_crs parse failed", "details": str(e)}) + "\n")
        tile_crs = layer.crs()
else:
    # por defecto generamos en la CRS de la capa para que cada cache use el CRS de la capa
    tile_crs = layer.crs() if layer is not None else project_crs

# Reproyectar project_extent (que está en project_crs) a tile_crs (CRS de la capa)
extent_in_tile_crs = project_extent
if project_crs and tile_crs and project_crs.authid() != tile_crs.authid():
    try:
        tx = QgsCoordinateTransform(project_crs, tile_crs, project)
        extent_in_tile_crs = tx.transformBoundingBox(project_extent)
    except Exception as e:
        # si la reproyección falla, registrar warning y fallback a project_extent (puede producir resultados incorrectos)
        sys.stderr.write(json.dumps({"warning": "reprojecting project_extent to layer CRS failed", "details": str(e)}) + "\n")
        extent_in_tile_crs = project_extent

# ahora extent_in_tile_crs contiene la bbox en la CRS donde se generarán las tiles
# --- hasta aqui reemplazado ---

# resolve output_dir
if args.output_dir:
    output_dir = os.path.expandvars(args.output_dir)
    output_dir = os.path.expanduser(output_dir)
    if not os.path.exists(output_dir):
        try:
            os.makedirs(output_dir)
        except Exception as e:
            sys.stderr.write(json.dumps({"error": "No se pudo crear el directorio de salida", "details": str(e)}) + "\n")
            qgs.exitQgis()
            sys.exit(1)
else:
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    output_dir = os.path.join(repo_root, "cache")
    os.makedirs(output_dir, exist_ok=True)

# index path
index_path = args.index_path or os.path.join(output_dir, "index.json")

if target_mode == "theme":
    tile_base_dir = os.path.join(output_dir, "_themes", storage_name)
else:
    tile_base_dir = os.path.join(output_dir, storage_name)
os.makedirs(tile_base_dir, exist_ok=True)

# debug start
print(json.dumps({
    "debug": "start_generate",
    "target": target_name,
    "target_mode": target_mode,
    "output_dir": output_dir,
    "storage_name": storage_name,
    "project": args.project,
    "zoom_min": args.zoom_min,
    "zoom_max": args.zoom_max,
    "project_crs": project_crs.authid() if project_crs else None,
    "project_extent": [project_extent.xMinimum(), project_extent.yMinimum(), project_extent.xMaximum(), project_extent.yMaximum()] if project_extent else None,
    "tile_crs": tile_crs.authid() if tile_crs else None
}, ensure_ascii=False))
sys.stdout.flush()

# prepare settings base
settings = QgsMapSettings()
if target_mode == "theme":
    settings.setLayers(target_layers)
else:
    settings.setLayers([layer])
settings.setOutputSize(QSize(256, 256))
settings.setDestinationCrs(tile_crs)
# keep background transparent so tiles overlay correctly
try:
    settings.setBackgroundColor(QColor(0, 0, 0, 0))
except Exception:
    pass
# acelerar render: desactivar antialiasing y efectos avanzados
try:
    settings.setFlag(QgsMapSettings.Antialiasing, False)
except Exception:
    pass
try:
    settings.setUseAdvancedEffects(False)
except Exception:
    pass

scheme = args.scheme
if scheme == "auto":
    scheme = "xyz" if (tile_crs and tile_crs.authid().upper() == "EPSG:3857") else ("wmts" if args.wmts else "custom")

# métricas base
zoom_min = args.zoom_min
zoom_max = args.zoom_max
if zoom_min == 0 and zoom_max == 0:
    zoom_min = 0
    zoom_max = 2

total_generated = 0
error_count = 0
throttle_sec = max(0.0, float(args.throttle_ms) / 1000.0 if args.throttle_ms else 0.0)

if scheme == "xyz":
    # Tiling global EPSG:3857 estilo XYZ (origen arriba-izquierda)
    M = 20037508.342789244
    ex_minx = max(-M, min(M, extent_in_tile_crs.xMinimum()))
    ex_maxx = max(-M, min(M, extent_in_tile_crs.xMaximum()))
    ex_miny = max(-M, min(M, extent_in_tile_crs.yMinimum()))
    ex_maxy = max(-M, min(M, extent_in_tile_crs.yMaximum()))
    if ex_maxx <= ex_minx or ex_maxy <= ex_miny:
        sys.stderr.write(json.dumps({"error": "extent inválido tras recorte a EPSG:3857", "extent": [ex_minx, ex_miny, ex_maxx, ex_maxy]}) + "\n")
        qgs.exitQgis(); sys.exit(1)

    def x_to_tile(x, tiles):
        return int(math.floor(((x + M) / (2 * M)) * tiles))
    def y_to_tile(y, tiles):
        return int(math.floor(((M - y) / (2 * M)) * tiles))

    # aproximación de expected_total: usamos rango por z
    expected_total = 0
    tile_ranges = {}
    for z in range(zoom_min, zoom_max + 1):
        tiles = 2 ** z
        x0 = x_to_tile(ex_minx, tiles)
        x1 = x_to_tile(ex_maxx - 1e-6, tiles)
        y0 = y_to_tile(ex_maxy - 1e-6, tiles)  # top
        y1 = y_to_tile(ex_miny, tiles)         # bottom
        # clamp to grid
        x0 = max(0, min(tiles - 1, x0)); x1 = max(0, min(tiles - 1, x1))
        y0 = max(0, min(tiles - 1, y0)); y1 = max(0, min(tiles - 1, y1))
        if x1 < x0: x0, x1 = x1, x0
        if y1 < y0: y0, y1 = y1, y0
        tile_ranges[z] = (x0, x1, y0, y1)
        expected_total += max(0, (x1 - x0 + 1)) * max(0, (y1 - y0 + 1))
    if expected_total <= 0:
        expected_total = 1

    for z in range(zoom_min, zoom_max + 1):
        if _terminate["flag"]:
            break
        tiles = 2 ** z
        tile_size = (2 * M) / tiles
        if args.xyz_mode == "world":
            # generar todo el rango global
            x0, x1, y0, y1 = 0, tiles - 1, 0, tiles - 1
        else:
            x0, x1, y0, y1 = tile_ranges[z]
        level_generated = 0
        for x in range(x0, x1 + 1):
            if _terminate["flag"]:
                break
            for y in range(y0, y1 + 1):
                if _terminate["flag"]:
                    break
                # bbox del tile XYZ
                minx_tile = -M + x * tile_size
                maxx_tile = minx_tile + tile_size
                maxy_tile = M - y * tile_size
                miny_tile = maxy_tile - tile_size
                tile_bbox = QgsRectangle(minx_tile, miny_tile, maxx_tile, maxy_tile)
                settings.setExtent(tile_bbox)
                settings.setOutputSize(QSize(256, 256))
                tile_dir = os.path.join(tile_base_dir, str(z), str(x))
                out_file = os.path.join(tile_dir, f"{y}.png")
                if args.skip_existing and os.path.exists(out_file):
                    total_generated += 1; level_generated += 1
                    continue
                out_file = None
                try:
                    attempts = 0
                    success = False
                    last_err = None
                    while attempts <= max(0, int(args.tile_retries)) and not success and not _terminate["flag"]:
                        attempts += 1
                        try:
                            job = QgsMapRendererParallelJob(settings)
                            job.start()
                            finished = _wait_for_job(job, timeout_sec = max(1.0, args.render_timeout_ms/1000.0))
                            if not finished:
                                # cancel y retry
                                try: job.cancel()
                                except Exception: pass
                                last_err = "timeout"
                                continue
                            img = job.renderedImage()
                            tile_dir = os.path.join(tile_base_dir, str(z), str(x))
                            os.makedirs(tile_dir, exist_ok=True)
                            out_file = os.path.join(tile_dir, f"{y}.png")
                            success = img.save(out_file, "PNG", max(0, min(9, int(args.png_compression))))
                            if not success:
                                last_err = "save_failed"
                        except Exception as e:
                            last_err = str(e)
                    if success:
                        total_generated += 1; level_generated += 1
                    else:
                        sys.stderr.write(json.dumps({"warning": "tile_skipped", "tile": out_file, "reason": last_err, "attempts": attempts}) + "\n")
                        error_count += 1
                except Exception as e:
                    sys.stderr.write(json.dumps({"error": "excepción en generación de tile", "tile": out_file, "details": str(e)}) + "\n")
                    error_count += 1
                # throttle opcional para ser amable con servicios remotos
                if throttle_sec > 0:
                    try:
                        time.sleep(throttle_sec)
                    except Exception:
                        pass
        # recalcular expected_total si modo world (para mejorar porcentaje)
        if args.xyz_mode == "world":
            expected_total = sum((2 ** zz) ** 2 for zz in range(zoom_min, zoom_max + 1)) or expected_total
        percent = (total_generated / expected_total) * 100.0
        sys.stdout.write(json.dumps({"progress": "level_done", "z": z, "generated_level": level_generated, "total_generated": total_generated, "expected_total": expected_total, "percent": round(percent, 2)}) + "\n")
        sys.stdout.flush()

    if _terminate["flag"]:
        percent = (total_generated / expected_total) * 100.0
        sys.stdout.write(json.dumps({"status": "aborted", "total_generated": total_generated, "expected_total": expected_total, "percent": round(percent, 2)}) + "\n")
        sys.stdout.flush()

elif scheme == "wmts":
    # WMTS local: definir TileMatrixSet basado en extent_in_tile_crs y CRS
    # parámetros base
    TILE_SIZE = 256
    minx = extent_in_tile_crs.xMinimum(); miny = extent_in_tile_crs.yMinimum()
    maxx = extent_in_tile_crs.xMaximum(); maxy = extent_in_tile_crs.yMaximum()
    width = maxx - minx; height = maxy - miny
    if width <= 0 or height <= 0:
        sys.stderr.write(json.dumps({"error": "project_extent inválido", "extent": [minx, miny, maxx, maxy]}) + "\n"); qgs.exitQgis(); sys.exit(1)

    # Resolución base en zoom_min: ajustar a lado mayor para asegurar matriz entera aproximada
    res0 = max(width, height) / (TILE_SIZE * (2 ** 0))
    # top-left en origen NW
    top_left_x = minx
    top_left_y = maxy

    # construir matrices por nivel
    expected_total = 0
    wmts_matrices = []
    for z in range(zoom_min, zoom_max + 1):
        # resolución decrece por factor 2 por nivel
        res_z = res0 / (2 ** (z - zoom_min))
        mw = int(math.ceil(width / (TILE_SIZE * res_z)))
        mh = int(math.ceil(height / (TILE_SIZE * res_z)))
        if mw <= 0: mw = 1
        if mh <= 0: mh = 1
        wmts_matrices.append({
            "z": z,
            "resolution": res_z,
            "scale_denominator": (res_z / 0.00028),
            "matrix_width": mw,
            "matrix_height": mh,
            "top_left": [top_left_x, top_left_y]
        })
        expected_total += mw * mh
    if expected_total <= 0:
        expected_total = 1

    # generar tiles siguiendo la rejilla WMTS (origen top-left, y crece hacia abajo)
    total_generated = 0
    for z in range(zoom_min, zoom_max + 1):
        if _terminate["flag"]:
            break
        mdef = next(m for m in wmts_matrices if m["z"] == z)
        res_z = mdef["resolution"]
        mw = mdef["matrix_width"]; mh = mdef["matrix_height"]
        level_generated = 0
        for x in range(0, mw):
            if _terminate["flag"]:
                break
            for y in range(0, mh):
                if _terminate["flag"]:
                    break
                minx_tile = top_left_x + x * TILE_SIZE * res_z
                maxx_tile = minx_tile + TILE_SIZE * res_z
                maxy_tile = top_left_y - y * TILE_SIZE * res_z
                miny_tile = maxy_tile - TILE_SIZE * res_z
                tile_bbox = QgsRectangle(minx_tile, miny_tile, maxx_tile, maxy_tile)
                settings.setExtent(tile_bbox)
                settings.setOutputSize(QSize(TILE_SIZE, TILE_SIZE))
                tile_dir = os.path.join(tile_base_dir, str(z), str(x))
                out_file = os.path.join(tile_dir, f"{y}.png")
                if args.skip_existing and os.path.exists(out_file):
                    total_generated += 1; level_generated += 1
                    continue
                out_file = None
                try:
                    attempts = 0
                    success = False
                    last_err = None
                    while attempts <= max(0, int(args.tile_retries)) and not success and not _terminate["flag"]:
                        attempts += 1
                        try:
                            job = QgsMapRendererParallelJob(settings)
                            job.start()
                            finished = _wait_for_job(job, timeout_sec = max(1.0, args.render_timeout_ms/1000.0))
                            if not finished:
                                try: job.cancel()
                                except Exception: pass
                                last_err = "timeout"
                                continue
                            img = job.renderedImage()
                            os.makedirs(tile_dir, exist_ok=True)
                            out_file = os.path.join(tile_dir, f"{y}.png")
                            success = img.save(out_file, "PNG", max(0, min(9, int(args.png_compression))))
                            if not success:
                                last_err = "save_failed"
                        except Exception as e:
                            last_err = str(e)
                    if success:
                        total_generated += 1; level_generated += 1
                    else:
                        sys.stderr.write(json.dumps({"warning": "tile_skipped", "tile": out_file, "reason": last_err, "attempts": attempts}) + "\n")
                        error_count += 1
                except Exception as e:
                    sys.stderr.write(json.dumps({"error": "excepción en generación de tile", "tile": out_file, "details": str(e)}) + "\n")
                    error_count += 1
                if throttle_sec > 0:
                    try:
                        time.sleep(throttle_sec)
                    except Exception:
                        pass
        percent = (total_generated / expected_total) * 100.0
        sys.stdout.write(json.dumps({"progress": "level_done", "z": z, "generated_level": level_generated, "total_generated": total_generated, "expected_total": expected_total, "percent": round(percent, 2)}) + "\n")
        sys.stdout.flush()

    if _terminate["flag"]:
        percent = (total_generated / expected_total) * 100.0
        sys.stdout.write(json.dumps({"status": "aborted", "total_generated": total_generated, "expected_total": expected_total, "percent": round(percent, 2)}) + "\n")
        sys.stdout.flush()

else:
    # esquema "custom": subdividir bbox localmente en 2^z x 2^z
    minx = extent_in_tile_crs.xMinimum(); miny = extent_in_tile_crs.yMinimum()
    maxx = extent_in_tile_crs.xMaximum(); maxy = extent_in_tile_crs.yMaximum()
    width = maxx - minx; height = maxy - miny
    if width <= 0 or height <= 0:
        sys.stderr.write(json.dumps({"error": "project_extent inválido", "extent": [minx, miny, maxx, maxy]}) + "\n"); qgs.exitQgis(); sys.exit(1)
    expected_total = sum((2 ** z) ** 2 for z in range(zoom_min, zoom_max + 1)) or 1
    for z in range(zoom_min, zoom_max + 1):
        if _terminate["flag"]:
            break
        tiles = 2 ** z
        tile_w = width / tiles; tile_h = height / tiles
        level_generated = 0
        for x in range(0, tiles):
            if _terminate["flag"]:
                break
            for y in range(0, tiles):
                if _terminate["flag"]:
                    break
                minx_tile = minx + x * tile_w
                maxx_tile = minx + (x + 1) * tile_w
                miny_tile = miny + y * tile_h
                maxy_tile = miny + (y + 1) * tile_h
                tile_bbox = QgsRectangle(minx_tile, miny_tile, maxx_tile, maxy_tile)
                settings.setExtent(tile_bbox)
                settings.setOutputSize(QSize(256, 256))
                tile_dir = os.path.join(tile_base_dir, str(z), str(x))
                out_file = os.path.join(tile_dir, f"{y}.png")
                if args.skip_existing and os.path.exists(out_file):
                    total_generated += 1; level_generated += 1
                    continue
                out_file = None
                try:
                    attempts = 0
                    success = False
                    last_err = None
                    while attempts <= max(0, int(args.tile_retries)) and not success and not _terminate["flag"]:
                        attempts += 1
                        try:
                            job = QgsMapRendererParallelJob(settings)
                            job.start()
                            finished = _wait_for_job(job, timeout_sec = max(1.0, args.render_timeout_ms/1000.0))
                            if not finished:
                                try: job.cancel()
                                except Exception: pass
                                last_err = "timeout"
                                continue
                            img = job.renderedImage()
                            os.makedirs(tile_dir, exist_ok=True)
                            out_file = os.path.join(tile_dir, f"{y}.png")
                            success = img.save(out_file, "PNG", max(0, min(9, int(args.png_compression))))
                            if not success:
                                last_err = "save_failed"
                        except Exception as e:
                            last_err = str(e)
                    if success:
                        total_generated += 1; level_generated += 1
                    else:
                        sys.stderr.write(json.dumps({"warning": "tile_skipped", "tile": out_file, "reason": last_err, "attempts": attempts}) + "\n")
                        error_count += 1
                except Exception as e:
                    sys.stderr.write(json.dumps({"error": "excepción en generación de tile", "tile": out_file, "details": str(e)}) + "\n")
                    error_count += 1
                if throttle_sec > 0:
                    try:
                        time.sleep(throttle_sec)
                    except Exception:
                        pass
        percent = (total_generated / expected_total) * 100.0
        sys.stdout.write(json.dumps({"progress": "level_done", "z": z, "generated_level": level_generated, "total_generated": total_generated, "expected_total": expected_total, "percent": round(percent, 2)}) + "\n")
        sys.stdout.flush()

    if _terminate["flag"]:
        percent = (total_generated / expected_total) * 100.0
        sys.stdout.write(json.dumps({"status": "aborted", "total_generated": total_generated, "expected_total": expected_total, "percent": round(percent, 2)}) + "\n")
        sys.stdout.flush()

# actualizar index.json
try:
    if os.path.exists(index_path):
        try:
            with open(index_path, "r", encoding="utf8") as f:
                index = json.load(f) if f.readable() else {}
        except Exception:
            index = {}
    else:
        index = {"project": args.project, "created": datetime.datetime.now().isoformat(), "layers": []}
    layer_entry = {
        "name": target_name,
        "kind": target_mode,
        "crs": tile_crs.authid(),
        "extent": [
            float(extent_in_tile_crs.xMinimum()),
            float(extent_in_tile_crs.yMinimum()),
            float(extent_in_tile_crs.xMaximum()),
            float(extent_in_tile_crs.yMaximum())
        ],
        "project_crs": project_crs.authid(),
        "project_extent": [project_extent.xMinimum(), project_extent.yMinimum(), project_extent.xMaximum(), project_extent.yMaximum()],
        "zoom_min": zoom_min,
        "zoom_max": zoom_max,
        "tile_format": "png",
        "path": os.path.abspath(tile_base_dir),
        "generated": datetime.datetime.now().isoformat(),
        "tile_count": total_generated,
        "scheme": scheme,
        "xyz_mode": args.xyz_mode,
        "tile_crs": tile_crs.authid(),
        "source_layers": [getattr(lyr, "name", lambda: "?")() for lyr in target_layers if lyr]
    }
    if target_mode == "theme":
        layer_entry["theme"] = target_name
    else:
        layer_entry["layer"] = target_name
    # añadir metadatos WMTS si aplica
    if scheme == "wmts":
        layer_entry["tile_matrix_set"] = {
            "id": f"{Path(args.project).stem}:{storage_name}",
            "supported_crs": tile_crs.authid(),
            "tile_width": 256,
            "tile_height": 256,
            "top_left_corner": [float(extent_in_tile_crs.xMinimum()), float(extent_in_tile_crs.yMaximum())],
            "matrices": [
                {
                    "z": int(m["z"]),
                    "scale_denominator": float(m["scale_denominator"]),
                    "resolution": float(m["resolution"]),
                    "matrix_width": int(m["matrix_width"]),
                    "matrix_height": int(m["matrix_height"])
                } for m in wmts_matrices
            ]
        }
    layers_snapshot = list(index.get("layers", []))

    def _safe_int(value):
        try:
            iv = int(value)
            return max(0, iv)
        except Exception:
            return None

    existing_entry = next((l for l in layers_snapshot if l.get("name") == target_name and (l.get("kind") or "layer") == target_mode), None)
    index["layers"] = [
        l for l in layers_snapshot
        if not (l.get("name") == target_name and (l.get("kind") or "layer") == target_mode)
    ]
    if existing_entry:
        prev_zoom_min = _safe_int(existing_entry.get("zoom_min"))
        prev_zoom_max = _safe_int(existing_entry.get("zoom_max"))
        if prev_zoom_min is not None and prev_zoom_max is not None:
            range_min = min(prev_zoom_min, zoom_min)
            range_max = max(prev_zoom_max, zoom_max)
        elif prev_zoom_min is not None:
            range_min = min(prev_zoom_min, zoom_min)
            range_max = zoom_max
        elif prev_zoom_max is not None:
            range_min = zoom_min
            range_max = max(prev_zoom_max, zoom_max)
        else:
            range_min = zoom_min
            range_max = zoom_max
        layer_entry["zoom_min"] = range_min
        layer_entry["zoom_max"] = range_max
    index["layers"].append(layer_entry)
    with open(index_path, "w", encoding="utf8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
    # Determinar estado final
    final_status = "aborted" if _terminate["flag"] else ("error" if (expected_total and expected_total > 0 and total_generated == 0 and error_count > 0) else "completed")
    print(json.dumps({"debug":"index_written", "index_path": index_path, "tiles_generated": total_generated, "status": final_status, "expected_total": expected_total, "errors": error_count}, ensure_ascii=False))
    sys.stdout.flush()
except Exception as e:
    sys.stderr.write(json.dumps({"error": "No se pudo actualizar index.json", "details": str(e)}) + "\n")

# --- Limpieza y código de salida ---
exit_code = 0
if not _terminate["flag"] and (expected_total and expected_total > 0 and total_generated == 0 and error_count > 0):
    exit_code = 2
qgs.exitQgis()
sys.exit(exit_code)
