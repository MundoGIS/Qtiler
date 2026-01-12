"""
This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
Copyright (C) 2025 MundoGIS.
"""

import sys
import os
import json
import datetime
import time


import argparse
import math
import signal
from pathlib import Path

_terminate = {"flag": False}

def handle_abort(signum, frame):
    _terminate["flag"] = True
    print('{"info": "SIGTERM received, aborting..."}', file=sys.stderr)
    sys.stderr.flush()

signal.signal(signal.SIGTERM, handle_abort)
signal.signal(signal.SIGINT, handle_abort)


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

REPO_ROOT = Path(__file__).resolve().parent.parent

# --- Force Qt cache directory to repo-local path to avoid using user AppData paths ---
try:
    cache_dir = REPO_ROOT / 'cache' / 'python'
    cache_dir.mkdir(parents=True, exist_ok=True)
    from PyQt5.QtCore import QStandardPaths
    QStandardPaths.setPath(QStandardPaths.CacheLocation, str(cache_dir))
    sys.stderr.write(json.dumps({"info": "qt_cache_location_set", "path": str(cache_dir)}) + "\n")
except Exception:
    pass

def _ensure_float(value, fallback=0.0):
    try:
        return float(value)
    except Exception:
        return float(fallback)

def _maybe_float(value):
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None

def _env_int(name, default=None):
    try:
        if name in os.environ:
            value = os.environ.get(name)
            if value is not None and value != "":
                return int(value)
    except Exception:
        return default
    return default

def _to_xy(coords, axis_order):
    if not coords or len(coords) < 2:
        return (0.0, 0.0)
    axis = (axis_order or "xy").lower()
    first = _ensure_float(coords[0])
    second = _ensure_float(coords[1])
    if axis == "yx":
        return (second, first)
    return (first, second)

def _find_preset_for_crs(crs_authid):
    if not crs_authid:
        return None
    grids_dir = REPO_ROOT / "config" / "tile-grids"
    if not grids_dir.exists():
        return None
    target = crs_authid.upper()
    for f in grids_dir.glob("*.json"):
        try:
            with open(f, "r", encoding="utf8") as h:
                data = json.load(h)
                supported = data.get("supported_crs") or data.get("crs")
                if supported:
                    if isinstance(supported, str) and supported.upper() == target:
                        data["__source_path__"] = str(f)
                        return data
                    if isinstance(supported, list) and target in [s.upper() for s in supported if isinstance(s, str)]:
                        data["__source_path__"] = str(f)
                        return data
        except Exception:
            continue
    return None

def _load_tile_matrix_preset(name_or_path):
    if not name_or_path:
        return None
    candidates = []
    raw = Path(name_or_path)
    if raw.is_absolute():
        candidates.append(raw)
    else:
        candidates.append(REPO_ROOT / "config" / "tile-grids" / f"{name_or_path}.json")
        candidates.append(REPO_ROOT / "config" / "tile-grids" / name_or_path)
        candidates.append(Path.cwd() / name_or_path)
    for candidate in candidates:
        try:
            if candidate.exists():
                with open(candidate, "r", encoding="utf8") as handle:
                    data = json.load(handle)
                    data["__source_path__"] = str(candidate)
                    return data
        except Exception as preset_err:
            sys.stderr.write(json.dumps({"warning": "preset_load_failed", "candidate": str(candidate), "details": str(preset_err)}) + "\n")
    return None

def _normalize_preset_definition(raw_preset):
    if not raw_preset:
        return None
    axis_order = (raw_preset.get("axis_order") or "xy").lower()
    origin = raw_preset.get("top_left_corner") or raw_preset.get("top_left") or [0, 0]
    origin_x, origin_y = _to_xy(origin, axis_order)
    tile_width = int(raw_preset.get("tile_width") or 256)
    tile_height = int(raw_preset.get("tile_height") or 256)
    matrices = []
    raw_matrices = raw_preset.get("matrices") or raw_preset.get("matrixSet") or []
    for idx, entry in enumerate(raw_matrices):
        identifier = entry.get("identifier")
        if identifier is None:
            identifier = str(idx)
        identifier = str(identifier)
        source_level = entry.get("source_level")
        if source_level is None:
            try:
                source_level = int(identifier)
            except Exception:
                source_level = idx
        entry_axis = (entry.get("axis_order") or axis_order).lower()
        entry_origin = entry.get("top_left_corner") or entry.get("top_left")
        if entry_origin:
            m_origin_x, m_origin_y = _to_xy(entry_origin, entry_axis)
        else:
            m_origin_x, m_origin_y = origin_x, origin_y
        scale = entry.get("scale_denominator")
        resolution = entry.get("resolution")
        if resolution is None and scale is not None:
            resolution = _ensure_float(scale) * 0.00028
        tile_w = int(entry.get("tile_width") or tile_width)
        tile_h = int(entry.get("tile_height") or tile_height)
        matrix_width = int(entry.get("matrix_width") or 1)
        matrix_height = int(entry.get("matrix_height") or 1)
        matrices.append({
            "identifier": identifier,
            "source_level": int(source_level),
            "matrix_width": max(1, matrix_width),
            "matrix_height": max(1, matrix_height),
            "scale_denominator": _ensure_float(scale) if scale is not None else (float(resolution) / 0.00028 if resolution is not None else 0.0),
            "resolution": _ensure_float(resolution) if resolution is not None else None,
            "tile_width": tile_w,
            "tile_height": tile_h,
            "origin_x": m_origin_x,
            "origin_y": m_origin_y
        })
    return {
        "id": raw_preset.get("id") or raw_preset.get("name") or raw_preset.get("identifier"),
        "title": raw_preset.get("title") or raw_preset.get("name"),
        "supported_crs": raw_preset.get("supported_crs") or raw_preset.get("crs") or "EPSG:3857",
        "axis_order": axis_order,
        "tile_width": tile_width,
        "tile_height": tile_height,
        "origin_x": origin_x,
        "origin_y": origin_y,
        "matrices": matrices
    }

def _load_crs_scale_presets(path_or_none):
    presets = {}
    if not path_or_none:
        return presets
    try:
        candidate = Path(path_or_none)
        if not candidate.is_absolute():
            candidate = REPO_ROOT / candidate
        if not candidate.exists():
            return presets
        with open(candidate, "r", encoding="utf8") as handle:
            data = json.load(handle)
    except Exception as err:
        sys.stderr.write(json.dumps({"warning": "crs_scale_presets_load_failed", "path": str(path_or_none), "details": str(err)}) + "\n")
        return presets
    if isinstance(data, dict):
        for raw_key, entry in data.items():
            if not isinstance(entry, dict):
                continue
            scales_raw = entry.get("scales") or entry.get("scale_denominators") or entry.get("scaleDenominators")
            if not isinstance(scales_raw, list):
                continue
            scales = []
            for value in scales_raw:
                try:
                    num = float(value)
                    if num > 0:
                        scales.append(num)
                except Exception:
                    continue
            if not scales:
                continue
            key = str(raw_key).upper()
            presets[key] = {
                "id": entry.get("id") or entry.get("name") or key,
                "name": entry.get("name") or entry.get("title"),
                "tile_size": int(entry.get("tile_size") or entry.get("tileSize") or 256),
                "scales": scales
            }
    return presets

def _match_crs_scale_profile(crs_obj, presets):
    if not crs_obj or not presets:
        return None
    candidates = []
    try:
        if hasattr(crs_obj, "authid"):
            candidates.append(crs_obj.authid())
    except Exception:
        pass
    if isinstance(crs_obj, str):
        candidates.append(crs_obj)
    for token in candidates:
        if not token:
            continue
        upper = token.upper()
        if upper in presets:
            return presets[upper]
        if upper.startswith("EPSG:"):
            plain = upper.split(":", 1)[1]
            if plain in presets:
                return presets[plain]
    return None

def _compute_tile_span(extent, matrix):
    if not extent or not matrix:
        return None
    minx = float(extent.xMinimum())
    miny = float(extent.yMinimum())
    maxx = float(extent.xMaximum())
    maxy = float(extent.yMaximum())
    if maxx <= minx or maxy <= miny:
        return None
    res = matrix.get("resolution")
    if not res or res <= 0:
        return None
    tile_w_mu = matrix.get("tile_width", 256) * res
    tile_h_mu = matrix.get("tile_height", 256) * res
    if tile_w_mu <= 0 or tile_h_mu <= 0:
        return None
    origin_x = matrix.get("origin_x", 0.0)
    origin_y = matrix.get("origin_y", 0.0)
    matrix_w = max(1, int(matrix.get("matrix_width", 1)))
    matrix_h = max(1, int(matrix.get("matrix_height", 1)))

    min_col = math.floor((minx - origin_x) / tile_w_mu)
    max_col = math.floor((maxx - origin_x) / tile_w_mu)
    min_row = math.floor((origin_y - maxy) / tile_h_mu)
    max_row = math.floor((origin_y - miny) / tile_h_mu)

    if max_col < min_col:
        min_col, max_col = max_col, min_col
    if max_row < min_row:
        min_row, max_row = max_row, min_row

    min_col = max(0, min(matrix_w - 1, min_col))
    max_col = max(0, min(matrix_w - 1, max_col))
    min_row = max(0, min(matrix_h - 1, min_row))
    max_row = max(0, min(matrix_h - 1, max_row))

    if max_col < min_col or max_row < min_row:
        return None

    return {
        "min_col": min_col,
        "max_col": max_col,
        "min_row": min_row,
        "max_row": max_row,
        "tile_width_mu": tile_w_mu,
        "tile_height_mu": tile_h_mu,
        "origin_x": origin_x,
        "origin_y": origin_y
    }

def _matrix_source_level(entry, fallback=0):
    if entry is None:
        return fallback
    for key in ("source_level", "z", "identifier"):
        if key in entry and entry[key] is not None:
            try:
                return int(entry[key])
            except Exception:
                continue
    return fallback

# --- Leer variables (permitir override por .env / entorno) ---
QGIS_PREFIX = os.environ.get("QGIS_PREFIX")
OSGEO4W_BIN = os.environ.get("OSGEO4W_BIN")
PROJECT_PATH = os.environ.get("PROJECT_PATH")
if not QGIS_PREFIX:
    sys.stderr.write(json.dumps({"error": "missing_env", "var": "QGIS_PREFIX", "msg": "Set QGIS_PREFIX in .env to your QGIS installation path"}) + "\n")
    sys.exit(2)
if not OSGEO4W_BIN:
    sys.stderr.write(json.dumps({"error": "missing_env", "var": "OSGEO4W_BIN", "msg": "Set OSGEO4W_BIN in .env to your o4w bin path (or QGIS bin)"}) + "\n")
    sys.exit(2)

# If PROJECT_PATH not set, auto-detect any project in repo qgisprojects folder
if not PROJECT_PATH:
    candidate_dir = REPO_ROOT / 'qgisprojects'
    picked = None
    if candidate_dir.exists() and candidate_dir.is_dir():
        for ext in ('*.qgz', '*.qgs'):
            found = list(candidate_dir.glob(ext))
            if found:
                picked = found[0]
                break
    if picked:
        PROJECT_PATH = str(picked.resolve())
        sys.stderr.write(json.dumps({"info": "auto_project_detected", "path": PROJECT_PATH}) + "\n")
    else:
        sys.stderr.write(json.dumps({"error": "missing_env", "var": "PROJECT_PATH", "msg": "Set PROJECT_PATH in .env to the QGIS project file path or place a .qgz/.qgs in qgisprojects/"}) + "\n")
        sys.exit(2)
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

# Attempt to override network disk cache to repo-local directory to avoid AppData access
try:
    from qgis.PyQt.QtNetwork import QNetworkDiskCache
    try:
        # Prefer QGIS network manager if available
        from qgis.core import QgsNetworkAccessManager
        nam = QgsNetworkAccessManager.instance()
    except Exception:
        from qgis.PyQt.QtNetwork import QNetworkAccessManager
        nam = QNetworkAccessManager()
    disk = QNetworkDiskCache()
    disk.setCacheDirectory(str(REPO_ROOT / 'cache' / 'python'))
    # Limit disk cache to 50 MB to improve WMS performance but avoid large disk use
    disk.setMaximumCacheSize(50 * 1024 * 1024)
    try:
        nam.setCache(disk)
        sys.stderr.write(json.dumps({"info": "network_disk_cache_set", "path": str(REPO_ROOT / 'cache' / 'python')}) + "\n")
    except Exception:
        # Some managers may not expose setCache; ignore safely
        pass
except Exception:
    pass

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


# Helper: save image atomically and verify size (evita escribir archivos "vacíos" por error)
def _atomic_save_image(qimage, dest_path, compression=3, min_bytes=None):
    try:
        if qimage is None:
            try: sys.stdout.write(json.dumps({"debug": "atomic_save_no_image", "dest": dest_path}) + "\n"); sys.stdout.flush()
            except Exception: pass
            return False
        ddir = os.path.dirname(dest_path) or "."
        os.makedirs(ddir, exist_ok=True)
        # elegir tamaño mínimo aceptable (podemos configurarlo via env)
        if min_bytes is None:
            try:
                env_value = os.environ.get("MIN_TILE_BYTES")
                min_bytes = int(env_value) if env_value is not None else 0
            except Exception:
                min_bytes = 0
        # archivo temporal en el mismo directorio
        # Create a temporary filename in the same directory. Avoid leading dot
        # names to reduce the chance of Windows treating it specially.
        base = os.path.basename(dest_path)
        ts = int(time.time() * 1000)
        tmp_name = f"{base}.tmp.{os.getpid()}.{ts}"
        tmp_path = os.path.join(ddir, tmp_name)
        # Intentar guardar
        try:
            saved = qimage.save(tmp_path, "PNG", max(0, min(9, int(compression))))
        except Exception as e:
            try: sys.stderr.write(json.dumps({"warning": "atomic_save_failed_to_write", "dest": dest_path, "details": str(e)}) + "\n")
            except Exception: pass
            try:
                if os.path.exists(tmp_path): os.remove(tmp_path)
            except Exception: pass
            return False
        if not saved:
            try:
                if os.path.exists(tmp_path): os.remove(tmp_path)
            except Exception:
                pass
            try: sys.stderr.write(json.dumps({"warning": "atomic_save_qimage_save_returned_false", "dest": dest_path}) + "\n")
            except Exception: pass
            return False
        # Verificar tamaño
        try:
            size = os.path.getsize(tmp_path)
        except Exception:
            size = 0
        if (min_bytes or 0) > 0 and size < min_bytes:
            bad_dir = os.path.join(ddir, "_bad_tiles")
            try:
                os.makedirs(bad_dir, exist_ok=True)
                bad_name = f"{os.path.basename(dest_path)}.bad.{os.getpid()}.{int(time.time()*1000)}"
                bad_path = os.path.join(bad_dir, bad_name)
                # mover el tmp al directorio de diagnóstico para inspección
                try:
                    os.replace(tmp_path, bad_path)
                except Exception:
                    try:
                        os.rename(tmp_path, bad_path)
                    except Exception:
                        # si no podemos mover, intentar eliminar y continuar
                        try:
                            if os.path.exists(tmp_path): os.remove(tmp_path)
                        except Exception:
                            pass
                        bad_path = None
                sys.stdout.write(json.dumps({"debug": "atomic_save_too_small", "dest": dest_path, "bytes": size, "min_bytes": min_bytes, "bad_path": bad_path}) + "\n")
                sys.stdout.flush()
            except Exception:
                try:
                    if os.path.exists(tmp_path): os.remove(tmp_path)
                except Exception:
                    pass
            return False
        # mover de forma atómica
        # Try to move the tmp file into place atomically. On Windows this can
        # sometimes fail if the destination already exists or is locked. Try a
        # small sequence of fallbacks: os.replace, remove dest + os.replace,
        # os.rename. Retry a few times with short sleeps to handle races.
        moved = False
        move_exc = None
        for attempt in range(3):
            try:
                os.replace(tmp_path, dest_path)
                moved = True
                break
            except Exception as e:
                move_exc = e
                # If destination exists, try removing it and retry.
                try:
                    if os.path.exists(dest_path):
                        try:
                            os.remove(dest_path)
                        except Exception:
                            # Try to change permissions and retry removal
                            try:
                                os.chmod(dest_path, 0o666)
                                os.remove(dest_path)
                            except Exception:
                                pass
                except Exception:
                    pass
                try:
                    os.replace(tmp_path, dest_path)
                    moved = True
                    break
                except Exception as e2:
                    move_exc = e2
                # final fallback to rename
                try:
                    os.rename(tmp_path, dest_path)
                    moved = True
                    break
                except Exception as e3:
                    move_exc = e3
                # wait a bit before next attempt
                try:
                    time.sleep(0.05 * (attempt + 1))
                except Exception:
                    pass
        if not moved:
            try: sys.stderr.write(json.dumps({"warning": "atomic_save_move_failed", "dest": dest_path, "details": str(move_exc)}) + "\n")
            except Exception: pass
            try:
                if os.path.exists(tmp_path): os.remove(tmp_path)
            except Exception:
                pass
            return False
        try:
            sys.stdout.write(json.dumps({"debug": "atomic_save_ok", "dest": dest_path, "bytes": size}) + "\n")
            sys.stdout.flush()
        except Exception:
            pass
        return True
    except Exception as e:
        try: sys.stderr.write(json.dumps({"error": "atomic_save_exception", "dest": dest_path, "details": str(e)}) + "\n")
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
parser.add_argument("--job_id", default=None, help="ID opcional del job (para poder localizar/abortar el proceso desde el backend)")
parser.add_argument("--layer", default=None)
parser.add_argument("--theme", default=None, help="Nombre de tema de mapa a renderizar como composite")
parser.add_argument("--output_dir", default=None)
parser.add_argument("--zoom_min", type=int, default=0)
parser.add_argument("--zoom_max", type=int, default=0)
parser.add_argument("--publish_zoom_min", type=int, default=None, help="Zoom mínimo que se publicará en WMTS (permite anunciar más niveles que los cacheados)")
parser.add_argument("--publish_zoom_max", type=int, default=None, help="Zoom máximo que se publicará en WMTS")
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
parser.add_argument("--tile_matrix_preset", default=None, help="Nombre o ruta de un preset de TileMatrixSet (por ejemplo 'sweref99tm_grid')")
parser.add_argument("--crs_scale_presets", default=None, help="Ruta a JSON con escalas estándar por CRS (fallback cuando no hay tile_matrix_preset)")
parser.add_argument("--png_compression", type=int, default=int(os.environ.get("PNG_COMPRESSION", "3")), help="Compresión PNG 0-9 (0=sin compresión, 9=máxima)")
parser.add_argument("--allow_remote", action="store_true", help="Permitir cachear capas remotas (WMS/WMTS/XYZ/Tile). Asegúrate de tener permiso.")
parser.add_argument("--throttle_ms", type=int, default=int(os.environ.get("REMOTE_THROTTLE_MS", "0")), help="Demora opcional en milisegundos entre tiles (útil para servicios remotos)")
parser.add_argument("--render_timeout_ms", type=int, default=int(os.environ.get("RENDER_TIMEOUT_MS", "30000")), help="Tiempo máximo por tile (ms) antes de cancelar e intentar el siguiente")
parser.add_argument("--tile_retries", type=int, default=int(os.environ.get("TILE_RETRIES", "1")), help="Reintentos por tile después de timeout/fallo")
parser.add_argument("--skip_existing", action="store_true", help="Omitir render si el archivo de tile ya existe")
parser.add_argument("--bbox", type=str, default=None, help="Optional bbox in target CRS for single tile mode: minx,miny,maxx,maxy")
# --- Modo single-tile ---
parser.add_argument("--single", action="store_true", help="Renderizar solo una tile específica")
parser.add_argument("--z", type=int, default=None, help="Zoom de la tile a renderizar")
parser.add_argument("--x", type=int, default=None, help="Columna de la tile a renderizar")
parser.add_argument("--y", type=int, default=None, help="Fila de la tile a renderizar")
args = parser.parse_args()

tile_matrix_preset_name = args.tile_matrix_preset or os.environ.get("TILE_MATRIX_PRESET")
tile_matrix_preset_raw = _load_tile_matrix_preset(tile_matrix_preset_name) if tile_matrix_preset_name else None
tile_matrix_preset = _normalize_preset_definition(tile_matrix_preset_raw) if tile_matrix_preset_raw else None
crs_scale_presets_path = args.crs_scale_presets or os.environ.get("CRS_SCALE_PRESETS_PATH") or (REPO_ROOT / "config" / "crs-scale-presets.json")
crs_scale_presets = _load_crs_scale_presets(crs_scale_presets_path)

# Global helpers for validation
INVALID_CHARS = set('<>:"/\\|?*')

# Normalizar target_mode/target_name desde los argumentos (se pueden sobreescribir en --single)
target_mode = "theme" if args.theme else ("layer" if args.layer else None)
target_name = (args.theme if args.theme else args.layer) or ""

if args.single:
    # Modo single-tile: requiere layer o theme, z, x, y
    if not (args.layer or args.theme):
        sys.stderr.write(json.dumps({"error": "Se requiere --layer o --theme en modo --single"}) + "\n")
        qgs.exitQgis(); sys.exit(1)
    if args.layer and args.theme:
        sys.stderr.write(json.dumps({"error": "Usa solo uno de --layer o --theme en modo --single"}) + "\n")
        qgs.exitQgis(); sys.exit(1)
    if args.z is None or args.x is None or args.y is None:
        sys.stderr.write(json.dumps({"error": "Se requiere --z, --x, --y en modo --single"}) + "\n")
        qgs.exitQgis(); sys.exit(1)
    # Saneo identificador
    INVALID_CHARS = set('<>:"/\\|?*')
    target_mode = "theme" if args.theme else "layer"
    target_name = (args.theme if target_mode == "theme" else args.layer) or ""
    # --- Renderizar solo una tile ---
    # Cargar proyecto
    project = QgsProject()
    if not project.read(args.project):
        sys.stderr.write(json.dumps({"error": f"No se pudo leer el proyecto: {args.project}"}) + "\n")
        qgs.exitQgis(); sys.exit(1)
    # Obtener capa(s) y CRS destino
    if target_mode == "layer":
        lyr = project.mapLayersByName(target_name)
        if not lyr:
            sys.stderr.write(json.dumps({"error": f"No se encontró la capa: {target_name}"}) + "\n")
            qgs.exitQgis(); sys.exit(1)
        target_layers = [lyr[0]]
        dest_crs = lyr[0].crs() if hasattr(lyr[0], 'crs') else project.crs()
    else:
        target_layers = _resolve_theme_layers(project, target_name)
        if not target_layers:
            sys.stderr.write(json.dumps({"error": f"No se encontró el tema: {target_name}"}) + "\n")
            qgs.exitQgis(); sys.exit(1)
        # Usar el CRS de la primera capa del tema, si existe
        dest_crs = target_layers[0].crs() if target_layers and hasattr(target_layers[0], 'crs') else project.crs()
    # CRS y bbox
    TILE_SIZE = 256
    WEB_MERCATOR_EXTENT = 20037508.342789244
    z, x, y = args.z, args.x, args.y

    # Auto-detect preset if missing and not using explicit bbox
    if not args.bbox and not tile_matrix_preset and dest_crs:
        found_preset = _find_preset_for_crs(dest_crs.authid())
        if found_preset:
            tile_matrix_preset = _normalize_preset_definition(found_preset)
            # Update TILE_SIZE if preset defines it
            if tile_matrix_preset:
                TILE_SIZE = int(tile_matrix_preset.get("tile_width") or TILE_SIZE)

    # If caller supplied a bbox (in target CRS), use it directly. Otherwise
    # fallback to WebMercator math (legacy behavior) which only works correctly
    # for EPSG:3857 tile grids.
    if args.bbox:
        parts = [p.strip() for p in args.bbox.split(',') if p.strip()]
        if len(parts) == 4:
            try:
                minx, miny, maxx, maxy = [float(p) for p in parts]
                bbox_proj = QgsRectangle(minx, miny, maxx, maxy)
                # Heurística: si el bbox parece estar en WebMercator (valores ~1e6-2e7)
                # y el destino no es EPSG:3857, intentar transformar desde EPSG:3857
                try:
                    if bbox_proj is not None and dest_crs and dest_crs.authid() and dest_crs.authid() != "EPSG:3857":
                        large_vals = any(abs(v) > 9000000 for v in (minx, miny, maxx, maxy))
                        if large_vals:
                            try:
                                src_crs = QgsCoordinateReferenceSystem("EPSG:3857")
                                if src_crs.isValid():
                                    tx = QgsCoordinateTransform(src_crs, dest_crs, project)
                                    bbox_proj = tx.transformBoundingBox(QgsRectangle(minx, miny, maxx, maxy))
                            except Exception as e:
                                try:
                                    sys.stderr.write(json.dumps({"warning": "bbox_transform_from_3857_failed", "details": str(e)}) + "\n")
                                except Exception:
                                    pass
                except Exception:
                    pass
            except Exception as e:
                sys.stderr.write(json.dumps({"error": "invalid_bbox", "details": str(e), "value": args.bbox}) + "\n")
                qgs.exitQgis(); sys.exit(2)
        else:
            sys.stderr.write(json.dumps({"error": "invalid_bbox_format", "value": args.bbox}) + "\n")
            qgs.exitQgis(); sys.exit(2)
    else:
        # Check if we have a preset to use for bbox calculation
        bbox_proj = None
        if tile_matrix_preset:
            # Find matrix for z
            matrices = tile_matrix_preset.get("matrices", [])
            matrix = next((m for m in matrices if _matrix_source_level(m) == z), None)
            if matrix:
                # Use preset logic
                res_z = matrix.get("resolution") or (matrix.get("scale_denominator") or 0) * 0.00028
                if res_z:
                    tile_w_mu = matrix.get("tile_width", TILE_SIZE) * res_z
                    tile_h_mu = matrix.get("tile_height", TILE_SIZE) * res_z
                    origin_x = matrix.get("origin_x", 0.0)
                    origin_y = matrix.get("origin_y", 0.0)
                    
                    minx_tile = origin_x + x * tile_w_mu
                    maxx_tile = minx_tile + tile_w_mu
                    maxy_tile = origin_y - y * tile_h_mu
                    miny_tile = maxy_tile - tile_h_mu
                    bbox_proj = QgsRectangle(minx_tile, miny_tile, maxx_tile, maxy_tile)
                    # Update TILE_SIZE if matrix specifies it
                    TILE_SIZE = int(matrix.get("tile_width") or TILE_SIZE)

        if bbox_proj is None:
            res = (WEB_MERCATOR_EXTENT*2)/(2**z*TILE_SIZE)
            minx = -WEB_MERCATOR_EXTENT + x*res*TILE_SIZE
            maxx = minx + res*TILE_SIZE
            maxy = WEB_MERCATOR_EXTENT - y*res*TILE_SIZE
            miny = maxy - res*TILE_SIZE
            bbox_merc = QgsRectangle(minx, miny, maxx, maxy)
            # Transformar bbox si CRS destino != EPSG:3857
            tile_crs = QgsCoordinateReferenceSystem("EPSG:3857")
            try:
                if dest_crs.authid() != "EPSG:3857":
                    xform = QgsCoordinateTransform(tile_crs, dest_crs, project)
                    bbox_proj = xform.transformBoundingBox(bbox_merc)
                else:
                    bbox_proj = bbox_merc
            except Exception as e:
                sys.stderr.write(json.dumps({"error": "transform_bbox_failed", "details": str(e), "tile_bbox": [minx, miny, maxx, maxy], "dest_crs": dest_crs.authid()}) + "\n")
                qgs.exitQgis(); sys.exit(2)
    # Configurar render
    ms = QgsMapSettings()
    ms.setLayers(target_layers)
    ms.setExtent(bbox_proj)
    ms.setOutputSize(QSize(TILE_SIZE, TILE_SIZE))
    ms.setDestinationCrs(dest_crs)
    try:
        ms.setBackgroundColor(QColor(0, 0, 0, 0))
    except Exception:
        ms.setBackgroundColor(QColor("white"))
    # Debug: informar detalles sobre las capas y el bbox antes de render
    try:
        layer_infos = []
        for tl in target_layers:
            try:
                lname = tl.name() if hasattr(tl, 'name') else str(tl)
            except Exception:
                lname = str(tl)
            try:
                lext = tl.extent()
                lext_tuple = [lext.xMinimum(), lext.yMinimum(), lext.xMaximum(), lext.yMaximum()] if lext else None
            except Exception:
                lext_tuple = None
            try:
                fcount = tl.featureCount()
            except Exception:
                try:
                    fcount = tl.featureCount(None)
                except Exception:
                    fcount = None
            try:
                prov = getattr(tl, 'providerType', lambda: '')() or ''
            except Exception:
                prov = ''
            # intentar obtener info de visibilidad por escala si existe
            try:
                sbv = getattr(tl, 'hasScaleBasedVisibility', lambda: False)()
            except Exception:
                sbv = False
            try:
                min_scale = tl.minimumScale() if hasattr(tl, 'minimumScale') else None
            except Exception:
                min_scale = None
            try:
                max_scale = tl.maximumScale() if hasattr(tl, 'maximumScale') else None
            except Exception:
                max_scale = None
            layer_infos.append({"name": lname, "extent": lext_tuple, "features": fcount, "provider": prov, "scale_based_visibility": sbv, "min_scale": min_scale, "max_scale": max_scale})
        sys.stdout.write(json.dumps({"debug": "single_tile_prepare", "bbox": [bbox_proj.xMinimum(), bbox_proj.yMinimum(), bbox_proj.xMaximum(), bbox_proj.yMaximum()], "dest_crs": dest_crs.authid() if dest_crs else None, "layers": layer_infos}, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except Exception as e:
        try:
            sys.stderr.write(json.dumps({"warning": "single_tile_debug_failed", "details": str(e)}) + "\n")
        except Exception:
            pass
    ms.setOutputDpi(96)
    job = QgsMapRendererParallelJob(ms)
    job.start()
    _wait_for_job(job, timeout_sec=30.0)
    img = job.renderedImage()
    # Diagnostic: check image validity
    try:
        if img is None:
            sys.stdout.write(json.dumps({"debug": "rendered_image_none"}) + "\n")
            sys.stdout.flush()
        else:
            try:
                w = img.width()
                h = img.height()
                sys.stdout.write(json.dumps({"debug": "rendered_image_size", "width": int(w), "height": int(h)}) + "\n")
                sys.stdout.flush()
            except Exception:
                pass
    except Exception:
        pass
    # Guardar PNG
    out_dir = args.output_dir or os.path.join(os.path.dirname(args.project), "..", "cache", os.path.splitext(os.path.basename(args.project))[0], target_name, str(z), str(x))
    os.makedirs(out_dir, exist_ok=True)
    out_file = os.path.join(out_dir, f"{y}.png")
    saved_ok = _atomic_save_image(img, out_file, compression=args.png_compression)
    if saved_ok:
        print(json.dumps({"status": "ok", "tile": out_file}))
        qgs.exitQgis(); sys.exit(0)
    else:
        try:
            sys.stderr.write(json.dumps({"error": "save_failed_or_too_small", "tile": out_file}) + "\n")
        except Exception:
            pass
        qgs.exitQgis(); sys.exit(2)
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
extent_override_provided = False
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
            extent_override_provided = True
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
            extent_override_provided = True
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
            extent_override_provided = True
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

# --- FIX: preferir extent de la capa cuando se está cacheando una capa (salvo --use_project_extent),
# pero NO cuando el usuario proporcionó un extent explícito (bbox desde UI/CLI/env). ---
if target_mode == "layer" and not getattr(args, "use_project_extent", False) and not extent_override_provided:
    try:
        project_extent = layer.extent()
    except Exception:
        pass

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
    "tile_crs": tile_crs.authid() if tile_crs else None,
    "tile_matrix_preset": (tile_matrix_preset.get("id") if tile_matrix_preset else tile_matrix_preset_name)
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
if tile_matrix_preset:
    scheme = "wmts"
elif scheme == "auto":
    scheme = "xyz" if (tile_crs and tile_crs.authid().upper() == "EPSG:3857") else ("wmts" if args.wmts else "custom")

# métricas base
zoom_min = args.zoom_min
zoom_max = args.zoom_max
if zoom_min == 0 and zoom_max == 0:
    zoom_min = 0
    zoom_max = 2

publish_zoom_min = args.publish_zoom_min
publish_zoom_max = args.publish_zoom_max
publish_min_explicit = args.publish_zoom_min is not None or ("WMTS_PUBLISH_ZOOM_MIN" in os.environ)
publish_max_explicit = args.publish_zoom_max is not None or ("WMTS_PUBLISH_ZOOM_MAX" in os.environ)
if publish_zoom_min is None:
    publish_zoom_min = _env_int("WMTS_PUBLISH_ZOOM_MIN", zoom_min)
if publish_zoom_max is None:
    publish_zoom_max = _env_int("WMTS_PUBLISH_ZOOM_MAX", zoom_max)
if publish_zoom_min is None:
    publish_zoom_min = zoom_min
if publish_zoom_max is None:
    publish_zoom_max = max(zoom_max, publish_zoom_min)
publish_zoom_min = max(0, int(publish_zoom_min))
publish_zoom_max = max(publish_zoom_min, int(publish_zoom_max))
publish_zoom_min_effective = publish_zoom_min
publish_zoom_max_effective = publish_zoom_max

if scheme != "wmts":
    publish_zoom_min = zoom_min
    publish_zoom_max = zoom_max
    publish_zoom_min_effective = publish_zoom_min
    publish_zoom_max_effective = publish_zoom_max

total_generated = 0
error_count = 0
throttle_sec = max(0.0, float(args.throttle_ms) / 1000.0 if args.throttle_ms else 0.0)
wmts_matrices = []

active_scale_profile = None

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
                            # --- ABORTO RÁPIDO: chequeo antes de guardar ---
                            if _terminate["flag"]:
                                sys.stderr.write(json.dumps({"info": "Aborted before saving tile", "tile": out_file}) + "\n")
                                sys.stderr.flush()
                                qgs.exitQgis()
                                sys.exit(1)
                            # --- FIN ABORTO RÁPIDO ---
                            tile_dir = os.path.join(tile_base_dir, str(z), str(x))
                            os.makedirs(tile_dir, exist_ok=True)
                            out_file = os.path.join(tile_dir, f"{y}.png")
                            success = _atomic_save_image(img, out_file, compression=args.png_compression)
                            if not success:
                                last_err = "save_failed_or_too_small"
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
    TILE_SIZE = int(tile_matrix_preset.get("tile_width") or 256) if tile_matrix_preset else 256
    wmts_matrices = []
    expected_total = 0
    active_scale_profile = None

    if tile_matrix_preset:
        preset_id = tile_matrix_preset.get("id") or tile_matrix_preset_name
        preset_matrices = tile_matrix_preset.get("matrices", [])
        if not publish_min_explicit and not publish_max_explicit:
            preset_levels_all = sorted({_matrix_source_level(m) for m in preset_matrices})
            if preset_levels_all:
                publish_zoom_min = preset_levels_all[0]
                publish_zoom_max = preset_levels_all[-1]
                publish_zoom_min_effective = publish_zoom_min
                publish_zoom_max_effective = publish_zoom_max
        selected = [m for m in preset_matrices if zoom_min <= _matrix_source_level(m) <= zoom_max]
        if not selected:
            selected = preset_matrices
        publish_matrices = [m for m in preset_matrices if publish_zoom_min <= _matrix_source_level(m) <= publish_zoom_max]
        if not publish_matrices:
            publish_matrices = preset_matrices
        publish_levels = sorted({_matrix_source_level(m) for m in publish_matrices})
        if publish_levels:
            publish_zoom_min_effective = publish_levels[0]
            publish_zoom_max_effective = publish_levels[-1]
        tile_runs = []
        for matrix in selected:
            # IMPORTANT: keep the preset origin stable.
            # The cached extent only controls which tiles to generate, not the WMTS grid origin.

            # Recortar el rango de tiles a solo los que intersectan el extent deseado
            span = _compute_tile_span(extent_in_tile_crs, matrix)
            if not span:
                tile_w_mu = matrix.get("tile_width", TILE_SIZE) * (matrix.get("resolution") or 0)
                tile_h_mu = matrix.get("tile_height", TILE_SIZE) * (matrix.get("resolution") or 0)
                span = {
                    "min_col": 0,
                    "max_col": matrix.get("matrix_width", 1) - 1,
                    "min_row": 0,
                    "max_row": matrix.get("matrix_height", 1) - 1,
                    "tile_width_mu": tile_w_mu if tile_w_mu else TILE_SIZE,
                    "tile_height_mu": tile_h_mu if tile_h_mu else TILE_SIZE,
                    "origin_x": matrix.get("origin_x", 0.0),
                    "origin_y": matrix.get("origin_y", 0.0)
                }
            # Clamp los índices para no salir del grid
            span["min_col"] = max(0, min(matrix.get("matrix_width", 1) - 1, span["min_col"]))
            span["max_col"] = max(0, min(matrix.get("matrix_width", 1) - 1, span["max_col"]))
            span["min_row"] = max(0, min(matrix.get("matrix_height", 1) - 1, span["min_row"]))
            span["max_row"] = max(0, min(matrix.get("matrix_height", 1) - 1, span["max_row"]))
            # Si el extent es muy pequeño y no cubre ningún tile, saltar
            if span["max_col"] < span["min_col"] or span["max_row"] < span["min_row"]:
                continue
            span["matrix"] = matrix
            count = (span["max_col"] - span["min_col"] + 1) * (span["max_row"] - span["min_row"] + 1)
            expected_total += count
            tile_runs.append(span)
        if expected_total <= 0:
            expected_total = sum(max(1, m.get("matrix_width", 1)) * max(1, m.get("matrix_height", 1)) for m in selected) or 1

        total_generated = 0
        for span in tile_runs:
            if _terminate["flag"]:
                break
            matrix = span["matrix"]
            res_z = matrix.get("resolution") or (matrix.get("scale_denominator") or 0) * 0.00028
            if not res_z:
                continue
            tile_w_mu = span["tile_width_mu"]
            tile_h_mu = span["tile_height_mu"]
            level_generated = 0
            folder_level = str(matrix.get("source_level"))
            for x in range(int(span["min_col"]), int(span["max_col"]) + 1):
                if _terminate["flag"]:
                    break
                tile_dir = os.path.join(tile_base_dir, folder_level, str(x))
                for y in range(int(span["min_row"]), int(span["max_row"]) + 1):
                    if _terminate["flag"]:
                        break
                    minx_tile = span["origin_x"] + x * tile_w_mu
                    maxx_tile = minx_tile + tile_w_mu
                    maxy_tile = span["origin_y"] - y * tile_h_mu
                    miny_tile = maxy_tile - tile_h_mu
                    tile_bbox = QgsRectangle(minx_tile, miny_tile, maxx_tile, maxy_tile)
                    settings.setExtent(tile_bbox)
                    settings.setOutputSize(QSize(matrix.get("tile_width", TILE_SIZE), matrix.get("tile_height", TILE_SIZE)))
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
                                success = _atomic_save_image(img, out_file, compression=args.png_compression)
                                if not success:
                                    last_err = "save_failed_or_too_small"
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
            percent = (total_generated / expected_total) * 100.0 if expected_total else 0.0
            sys.stdout.write(json.dumps({"progress": "level_done", "z": int(matrix.get("source_level", 0)), "generated_level": level_generated, "total_generated": total_generated, "expected_total": expected_total, "percent": round(percent, 2)}) + "\n")
            sys.stdout.flush()

        if _terminate["flag"]:
            percent = (total_generated / expected_total) * 100.0 if expected_total else 0.0
            sys.stdout.write(json.dumps({"status": "aborted", "total_generated": total_generated, "expected_total": expected_total, "percent": round(percent, 2)}) + "\n")
            sys.stdout.flush()

        wmts_matrices = [
            {
                "z": int(m.get("source_level", idx)),
                "identifier": m.get("identifier") or str(idx),
                "resolution": m.get("resolution"),
                "scale_denominator": m.get("scale_denominator"),
                "matrix_width": m.get("matrix_width"),
                "matrix_height": m.get("matrix_height"),
                # Keep top-left stable per preset so all layers share the same grid.
                "top_left": [
                    float(m.get("origin_x") if m.get("origin_x") is not None else (tile_matrix_preset.get("origin_x") if tile_matrix_preset else 0.0)),
                    float(m.get("origin_y") if m.get("origin_y") is not None else (tile_matrix_preset.get("origin_y") if tile_matrix_preset else 0.0))
                ]
            }
            for idx, m in enumerate(publish_matrices)
        ]
    else:
        minx = extent_in_tile_crs.xMinimum(); miny = extent_in_tile_crs.yMinimum()
        maxx = extent_in_tile_crs.xMaximum(); maxy = extent_in_tile_crs.yMaximum()
        width = maxx - minx; height = maxy - miny
        if width <= 0 or height <= 0:
            sys.stderr.write(json.dumps({"error": "project_extent inválido", "extent": [minx, miny, maxx, maxy]}) + "\n"); qgs.exitQgis(); sys.exit(1)

        publish_zoom_min_effective = min(publish_zoom_min, zoom_min)
        publish_zoom_max_effective = max(publish_zoom_max, zoom_max)
        top_left_x = minx
        top_left_y = maxy
        scale_profile = _match_crs_scale_profile(tile_crs, crs_scale_presets)
        if scale_profile and scale_profile.get("scales"):
            active_scale_profile = scale_profile
            TILE_SIZE = int(scale_profile.get("tile_size") or TILE_SIZE or 256)
            scales = scale_profile.get("scales")
            total_levels = len(scales)

            def _clamp_level(value, fallback):
                if value is None:
                    return fallback
                try:
                    idx = int(value)
                except Exception:
                    idx = fallback
                return max(0, min(total_levels - 1, idx))

            if not publish_min_explicit and not publish_max_explicit:
                publish_zoom_min = 0
                publish_zoom_max = total_levels - 1
            zoom_min = _clamp_level(zoom_min, 0)
            zoom_max = _clamp_level(zoom_max, total_levels - 1)
            publish_zoom_min_effective = _clamp_level(publish_zoom_min, zoom_min)
            publish_zoom_max_effective = _clamp_level(publish_zoom_max, zoom_max)
            matrix_range_min = min(publish_zoom_min_effective, zoom_min)
            matrix_range_max = max(publish_zoom_max_effective, zoom_max)
            wmts_matrices = []
            for idx in range(matrix_range_min, matrix_range_max + 1):
                scale_denominator = float(scales[idx])
                resolution = scale_denominator * 0.00028
                mw = max(1, int(math.ceil(width / (TILE_SIZE * resolution))))
                mh = max(1, int(math.ceil(height / (TILE_SIZE * resolution))))
                wmts_matrices.append({
                    "z": idx,
                    "identifier": str(idx),
                    "resolution": resolution,
                    "scale_denominator": scale_denominator,
                    "matrix_width": mw,
                    "matrix_height": mh,
                    "top_left": [top_left_x, top_left_y]
                })
        else:
            res0 = max(width, height) / (TILE_SIZE * (2 ** 0))
            wmts_matrices = []
            matrix_range_min = int(publish_zoom_min_effective)
            matrix_range_max = int(publish_zoom_max_effective)
            for z in range(matrix_range_min, matrix_range_max + 1):
                res_z = res0 / (2 ** (z - zoom_min))
                mw = int(math.ceil(width / (TILE_SIZE * res_z)))
                mh = int(math.ceil(height / (TILE_SIZE * res_z)))
                if mw <= 0: mw = 1
                if mh <= 0: mh = 1
                wmts_matrices.append({
                    "z": z,
                    "identifier": str(z),
                    "resolution": res_z,
                    "scale_denominator": (res_z / 0.00028),
                    "matrix_width": mw,
                    "matrix_height": mh,
                    "top_left": [top_left_x, top_left_y]
                })

        expected_total = sum(
            max(1, m.get("matrix_width", 1)) * max(1, m.get("matrix_height", 1))
            for m in wmts_matrices
            if zoom_min <= m.get("z", zoom_min) <= zoom_max
        ) or 1

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
                                success = _atomic_save_image(img, out_file, compression=args.png_compression)
                                if not success:
                                    last_err = "save_failed_or_too_small"
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
            percent = (total_generated / expected_total) * 100.0 if expected_total else 0.0
            sys.stdout.write(json.dumps({"progress": "level_done", "z": z, "generated_level": level_generated, "total_generated": total_generated, "expected_total": expected_total, "percent": round(percent, 2)}) + "\n")
            sys.stdout.flush()

        if _terminate["flag"]:
            percent = (total_generated / expected_total) * 100.0 if expected_total else 0.0
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
                            success = _atomic_save_image(img, out_file, compression=args.png_compression)
                            if not success:
                                last_err = "save_failed_or_too_small"
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
    # extent to record in index.json: default to the effective render extent in tile CRS
    try:
        layer_entry_extent = [
            float(extent_in_tile_crs.xMinimum()),
            float(extent_in_tile_crs.yMinimum()),
            float(extent_in_tile_crs.xMaximum()),
            float(extent_in_tile_crs.yMaximum())
        ]
    except Exception:
        layer_entry_extent = None

    layer_entry = {
        "name": target_name,
        "kind": target_mode,
        "crs": tile_crs.authid(),
        "extent": layer_entry_extent,
        "project_crs": proj_crs_candidate.authid(),
        "project_extent": [project_extent.xMinimum(), project_extent.yMinimum(), project_extent.xMaximum(), project_extent.yMaximum()],
        "zoom_min": publish_zoom_min_effective,
        "zoom_max": publish_zoom_max_effective,
        "published_zoom_min": publish_zoom_min_effective,
        "published_zoom_max": publish_zoom_max_effective,
        "cached_zoom_min": zoom_min,
        "cached_zoom_max": zoom_max,
        "tile_format": "png",
        "path": os.path.abspath(tile_base_dir),
        "generated": datetime.datetime.now().isoformat(),
        "tile_count": total_generated,
        "scheme": scheme,
        "xyz_mode": args.xyz_mode,
        "tile_crs": tile_crs.authid(),
        "tile_matrix_preset": (tile_matrix_preset.get("id") if tile_matrix_preset else tile_matrix_preset_name),
        "source_layers": [getattr(lyr, "name", lambda: "?")() for lyr in target_layers if lyr]
    }
    if target_mode == "theme":
        layer_entry["theme"] = target_name
    else:
        layer_entry["layer"] = target_name
    # añadir metadatos WMTS si aplica
    if scheme == "wmts":
        preset_id_value = (tile_matrix_preset.get("id") if tile_matrix_preset else None) or f"{Path(args.project).stem}:{storage_name}"
        axis_order_value = (tile_matrix_preset.get("axis_order") if tile_matrix_preset else "xy")
        if axis_order_value not in ("xy", "yx"):
            axis_order_value = "xy"
        tile_width_value = int(tile_matrix_preset.get("tile_width") or 256) if tile_matrix_preset else 256
        tile_height_value = int(tile_matrix_preset.get("tile_height") or 256) if tile_matrix_preset else 256

        # Keep WMTS grid origin stable (prefer preset origin).
        if tile_matrix_preset and tile_matrix_preset.get("origin_x") is not None and tile_matrix_preset.get("origin_y") is not None:
            top_left_corner_record = [float(tile_matrix_preset.get("origin_x")), float(tile_matrix_preset.get("origin_y"))]
        else:
            top_left_corner_record = [
                float(extent_in_tile_crs.xMinimum()),
                float(extent_in_tile_crs.yMaximum())
            ]
        supported_crs_value = (tile_matrix_preset.get("supported_crs") if tile_matrix_preset else None) or tile_crs.authid()

        layer_entry["tile_matrix_set"] = {
            "id": preset_id_value,
            "supported_crs": supported_crs_value,
            "tile_width": tile_width_value,
            "tile_height": tile_height_value,
            "axis_order": axis_order_value,
            "top_left_corner": top_left_corner_record,
            "matrices": [
                {
                    "identifier": m.get("identifier") or str(m.get("z")),
                    "z": int(m.get("z", idx)),
                    "source_level": int(m.get("z", idx)),
                    "scale_denominator": _maybe_float(m.get("scale_denominator")),
                    "resolution": _maybe_float(m.get("resolution")),
                    "matrix_width": int(m.get("matrix_width", 1)),
                    "matrix_height": int(m.get("matrix_height", 1)),
                    "top_left": [
                        float(m.get("top_left", top_left_corner_record)[0]) if isinstance(m.get("top_left", top_left_corner_record), (list, tuple)) else float(top_left_corner_record[0]),
                        float(m.get("top_left", top_left_corner_record)[1]) if isinstance(m.get("top_left", top_left_corner_record), (list, tuple)) else float(top_left_corner_record[1])
                    ]
                } for idx, m in enumerate(wmts_matrices)
            ]
        }
    layers_snapshot = list(index.get("layers", []))

    def _safe_int(value):
        try:
            iv = int(value)
            return max(0, iv)
        except Exception:
            return None

    def _merge_range(prev_min, prev_max, new_min, new_max):
        values = [v for v in (prev_min, prev_max, new_min, new_max) if v is not None]
        if not values:
            return (None, None)
        return (min(values), max(values))

    existing_entry = next((l for l in layers_snapshot if l.get("name") == target_name and (l.get("kind") or "layer") == target_mode), None)
    index["layers"] = [
        l for l in layers_snapshot
        if not (l.get("name") == target_name and (l.get("kind") or "layer") == target_mode)
    ]
    if existing_entry:
        # If the user provided an explicit bbox/project_extent override, avoid shrinking the stored extent.
        # The extent in index.json should remain a stable layer/project extent so the viewer bounds don't jump.
        if extent_override_provided:
            try:
                prev_extent = existing_entry.get("extent")
                if isinstance(prev_extent, list) and len(prev_extent) == 4:
                    layer_entry["extent"] = prev_extent
            except Exception:
                pass

        # Preserve profile source metadata so the server can keep preferring the persisted grid preset.
        try:
            prev_profile_source = existing_entry.get("tile_profile_source")
            if prev_profile_source and "tile_profile_source" not in layer_entry:
                layer_entry["tile_profile_source"] = prev_profile_source
        except Exception:
            pass

        prev_publish_min = _safe_int(existing_entry.get("published_zoom_min"))
        prev_publish_max = _safe_int(existing_entry.get("published_zoom_max"))
        if prev_publish_min is None and prev_publish_max is None:
            prev_publish_min = _safe_int(existing_entry.get("zoom_min"))
            prev_publish_max = _safe_int(existing_entry.get("zoom_max"))
        merged_publish = _merge_range(prev_publish_min, prev_publish_max, publish_zoom_min_effective, publish_zoom_max_effective)
        if merged_publish[0] is not None:
            layer_entry["zoom_min"] = merged_publish[0]
            layer_entry["zoom_max"] = merged_publish[1]
            layer_entry["published_zoom_min"] = merged_publish[0]
            layer_entry["published_zoom_max"] = merged_publish[1]

        prev_cached_min = _safe_int(existing_entry.get("cached_zoom_min"))
        prev_cached_max = _safe_int(existing_entry.get("cached_zoom_max"))
        if prev_cached_min is None and prev_cached_max is None:
            prev_cached_min = _safe_int(existing_entry.get("zoom_min"))
            prev_cached_max = _safe_int(existing_entry.get("zoom_max"))
        merged_cached = _merge_range(prev_cached_min, prev_cached_max, zoom_min, zoom_max)
        if merged_cached[0] is not None:
            layer_entry["cached_zoom_min"] = merged_cached[0]
            layer_entry["cached_zoom_max"] = merged_cached[1]
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
