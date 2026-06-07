"""
worker_wrapper.py
Worker persistente para renderizado de teselas QGIS.
Mantiene el entorno QGIS cargado y procesa peticiones via stdin.
"""
import sys
import os
import json
import datetime
import traceback
import math
import datetime
import xml.etree.ElementTree as ET
from pathlib import Path
import re

# --- Cargar variables de entorno (igual que tus scripts originales) ---
def load_dotenv_file(path: Path):
    try:
        import dotenv
        dotenv.load_dotenv(dotenv_path=str(path))
    except Exception:
        try:
            with open(path, "r", encoding="utf8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line: continue
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
        except: pass

p = Path(__file__).resolve().parent
for _ in range(4):
    if (p / ".env").exists():
        load_dotenv_file(p / ".env")
        break
    if p.parent == p: break
    p = p.parent

REPO_ROOT = Path(__file__).resolve().parent.parent

# --- Configuración QGIS ---
QGIS_PREFIX = os.environ.get("QGIS_PREFIX")
if not QGIS_PREFIX:
    sys.stderr.write("ERROR: QGIS_PREFIX no definido\n")
    sys.exit(1)

# Setup paths (Windows)
if os.name == "nt":
    OSGEO4W_BIN = os.environ.get("OSGEO4W_BIN")
    qgis_bin = os.path.join(QGIS_PREFIX, "bin")
    qt6_bin = os.path.join(QGIS_PREFIX, "..", "Qt6", "bin")
    qt5_bin = os.path.join(QGIS_PREFIX, "..", "Qt5", "bin")
    
    paths = [p for p in os.environ.get("PATH", "").split(";") if p]
    for pth in (OSGEO4W_BIN, qgis_bin, qt6_bin, qt5_bin):
        if pth and os.path.isdir(pth) and pth not in paths: 
            paths.insert(0, pth)
    os.environ["PATH"] = ";".join(paths)
    try:
        if OSGEO4W_BIN and os.path.isdir(OSGEO4W_BIN): os.add_dll_directory(OSGEO4W_BIN)
        if os.path.isdir(qgis_bin): os.add_dll_directory(qgis_bin)
        if os.path.isdir(qt6_bin): os.add_dll_directory(qt6_bin)
        if os.path.isdir(qt5_bin): os.add_dll_directory(qt5_bin)
    except: pass

qgis_python = os.path.join(QGIS_PREFIX, "python")
if os.path.isdir(qgis_python) and qgis_python not in sys.path:
    sys.path.insert(0, qgis_python)

# --- Importar QGIS ---
try:
    from qgis.core import QgsApplication
    QgsApplication.setPrefixPath(QGIS_PREFIX, True)
    qgs = QgsApplication([], False)
    qgs.initQgis()

    from qgis.core import (
        QgsProject, QgsMapSettings, 
        QgsMapRendererParallelJob, QgsRectangle, QgsCoordinateReferenceSystem
    )
    from qgis.PyQt.QtCore import QSize, QEventLoop, Qt
    from qgis.PyQt.QtGui import QColor
except ImportError as e:
    sys.stderr.write(f"ERROR IMPORTS QGIS: {e}\n")
    sys.exit(1)

try:
    Qt
except Exception:
    Qt = None

# Optional extras for WMS legend / feature info (best-effort)
try:
    from qgis.core import QgsPointXY, QgsFeatureRequest
except Exception:
    QgsPointXY = None
    QgsFeatureRequest = None

try:
    from qgis.core import QgsExpression
except Exception:
    QgsExpression = None

try:
    from qgis.core import QgsVectorLayer, QgsFeature, QgsGeometry, QgsWkbTypes
except Exception:
    QgsVectorLayer = None
    QgsFeature = None
    QgsGeometry = None
    QgsWkbTypes = None

try:
    from qgis.core import QgsFields
except Exception:
    QgsFields = None

try:
    from qgis.core import QgsOgcUtils
except Exception:
    QgsOgcUtils = None

try:
    from qgis.PyQt.QtXml import QDomDocument
except Exception:
    QDomDocument = None

try:
    from qgis.core import QgsCoordinateTransform
except Exception:
    QgsCoordinateTransform = None

try:
    from qgis.core import QgsSymbolLayerUtils
except Exception:
    QgsSymbolLayerUtils = None

try:
    from qgis.PyQt.QtGui import QImage, QPainter, QFont
except Exception:
    QImage = None
    QPainter = None
    QFont = None

# Prefer CustomPainterJob for stable headless rendering (vector layers in particular).
try:
    from qgis.core import QgsMapRendererCustomPainterJob
except Exception:
    QgsMapRendererCustomPainterJob = None

# QGS fue inicializado arriba antes del resto de los imports!

# --- Helpers ---
_current_project_path = None
_project_instance = None

def esc_xml(value):
    s = '' if value is None else str(value)
    return (
        s.replace('&', '&amp;')
         .replace('<', '&lt;')
         .replace('>', '&gt;')
         .replace('"', '&quot;')
         .replace("'", '&apos;')
    )


def safe_xml_name(value):
    """Return a conservative ASCII XML Name/NCName.

    QGIS WFS clients (notably QGIS Desktop) expect typenames and property names
    to be valid XML QNames, because they become element names in GML and XSD.
    Layer names like "points — puntos" would otherwise produce invalid XML.
    """
    raw = '' if value is None else str(value).strip()
    if not raw:
        return '_'
    # Replace any character outside a safe ASCII subset.
    out = re.sub(r'[^A-Za-z0-9_.-]+', '_', raw)
    # XML Name must not start with a digit/dot/hyphen.
    if not re.match(r'^[A-Za-z_]', out):
        out = '_' + out
    # Avoid reserved 'xml' prefix.
    if out.lower().startswith('xml'):
        out = '_' + out
    return out


def _find_layer_loose(project, requested_name):
    """Resolve a layer name tolerating sanitization differences.

    QGIS WMS/WFS often expose layer names in a sanitized form (spaces and
    special characters replaced by underscores). Clients that follow that
    naming will fail an exact ``mapLayersByName`` lookup against the original
    project layer name. Try a few normalizations (sanitized typename,
    case-insensitive match, underscore↔space swap) before giving up.
    """
    if project is None or not requested_name:
        return None
    try:
        wanted = str(requested_name).strip()
    except Exception:
        return None
    if not wanted:
        return None
    candidates = {wanted, wanted.replace('_', ' '), wanted.replace(' ', '_')}
    try:
        candidates.add(safe_xml_name(wanted))
    except Exception:
        pass
    candidates_lc = {c.lower() for c in candidates if c}
    try:
        for lyr in project.mapLayers().values():
            try:
                lname = lyr.name() if hasattr(lyr, 'name') else None
                if not lname:
                    continue
                if lname in candidates:
                    return lyr
                if lname.lower() in candidates_lc:
                    return lyr
                try:
                    if safe_xml_name(lname) in candidates:
                        return lyr
                except Exception:
                    pass
            except Exception:
                continue
    except Exception:
        return None
    return None


def _normalize_srs_name(value):
    if value is None:
        return None
    try:
        raw = str(value).strip()
    except Exception:
        return None
    if not raw:
        return None
    up = raw.upper()
    if 'EPSG' in up:
        m = re.search(r'EPSG[^0-9]*(\d{3,6})', up)
        if m:
            return f"EPSG:{m.group(1)}"
    return raw


def _find_vector_layer_by_typename(project, type_name):
    """Resolve a requested typename to a vector layer.

    Supports both legacy (raw layer name) and sanitized typenames.
    """
    if project is None or not type_name:
        return None
    requested = str(type_name).strip()
    if not requested:
        return None
    # First: exact by name (legacy behaviour).
    try:
        matches = project.mapLayersByName(requested)
        if matches:
            lyr = matches[0]
            if _is_vector_layer(lyr):
                return lyr
    except Exception:
        pass
    # Second: match by sanitized typename (robust against unicode dashes / encoding differences).
    try:
        requested_safe = safe_xml_name(requested)
        for lyr in project.mapLayers().values():
            try:
                if not _is_vector_layer(lyr):
                    continue
                lname = str(lyr.name() or '').strip()
                if not lname:
                    continue
                if safe_xml_name(lname) == requested_safe:
                    return lyr
            except Exception:
                continue
    except Exception:
        pass
    return None


def _geometry_to_gml_fragment(geom, srs_name=None, precision=17, use_gml32=False):
    """Return a GML geometry element as a string.

    NOTE: In QGIS 3.34 Python bindings, QgsGeometry does not expose asGml/asGml2/asGml3.
    The reliable path is QgsOgcUtils.geometryToGML() which returns a QDomElement.
    """
    if geom is None or QgsOgcUtils is None or QDomDocument is None:
        return None
    try:
        doc = QDomDocument()
        gml_version = None
        if use_gml32:
            gml_version = getattr(QgsOgcUtils, 'GML_3_2_1', None)
        if gml_version is None:
            gml_version = getattr(QgsOgcUtils, 'GML_3_1_0', None)  # best match for WFS 1.1.0
        if gml_version is None:
            # Fallback to whatever version exists.
            gml_version = getattr(QgsOgcUtils, 'GML_3_2_1', None) or getattr(QgsOgcUtils, 'GML_2_1_2', None)
        if gml_version is None:
            return None

        elem = QgsOgcUtils.geometryToGML(
            geom,
            doc,
            gml_version,
            str(srs_name) if srs_name else None,
            False,  # invertAxisOrientation
            None,  # gmlIdBase
            int(precision) if precision is not None else 17,
        )
        doc.appendChild(elem)
        xml = doc.toString()
        if not xml:
            return None
        # geometryToGML() returns just the element; no XML declaration expected, but strip if present.
        xml = str(xml).strip()
        if xml.startswith('<?xml'):
            end = xml.find('?>')
            if end != -1:
                xml = xml[end + 2 :].strip()
        return xml
    except Exception:
        return None

def _is_vector_layer(layer):
    try:
        if QgsVectorLayer is not None and isinstance(layer, QgsVectorLayer):
            return True
    except Exception:
        pass
    try:
        # Best-effort: vector layers have wkbType()/getFeatures().
        return hasattr(layer, 'wkbType') and hasattr(layer, 'getFeatures')
    except Exception:
        return False

def _geometry_type_name(layer):
    try:
        if QgsWkbTypes is not None and hasattr(layer, 'wkbType'):
            try:
                return QgsWkbTypes.displayString(layer.wkbType())
            except Exception:
                pass
        if hasattr(layer, 'geometryType'):
            gt = layer.geometryType()
            return str(gt)
    except Exception:
        pass
    return None


def _gml_geometry_property_type(layer):
    """Return a specific GML *PropertyType when possible.

    QGIS' WFS provider is much more reliable when DescribeFeatureType advertises
    PolygonPropertyType/LineStringPropertyType/PointPropertyType (and Multi* variants)
    instead of the generic GeometryPropertyType.
    """
    try:
        if QgsWkbTypes is None or layer is None or not hasattr(layer, 'wkbType'):
            return 'gml:GeometryPropertyType'
        wkb = layer.wkbType()
        try:
            is_multi = bool(QgsWkbTypes.isMultiType(wkb))
        except Exception:
            is_multi = False
        try:
            gtype = QgsWkbTypes.geometryType(wkb)
        except Exception:
            gtype = None

        if gtype == QgsWkbTypes.PointGeometry:
            return 'gml:MultiPointPropertyType' if is_multi else 'gml:PointPropertyType'
        if gtype == QgsWkbTypes.LineGeometry:
            return 'gml:MultiLineStringPropertyType' if is_multi else 'gml:LineStringPropertyType'
        if gtype == QgsWkbTypes.PolygonGeometry:
            return 'gml:MultiPolygonPropertyType' if is_multi else 'gml:PolygonPropertyType'
    except Exception:
        pass
    return 'gml:GeometryPropertyType'

def _geojson_type_from_qgs_geometry(geom):
    """Best-effort GeoJSON geometry type from a QgsGeometry instance."""
    try:
        if QgsWkbTypes is None or geom is None or not hasattr(geom, 'wkbType'):
            return None
        wkb = geom.wkbType()
        try:
            is_multi = bool(QgsWkbTypes.isMultiType(wkb))
        except Exception:
            is_multi = False
        try:
            gtype = QgsWkbTypes.geometryType(wkb)
        except Exception:
            gtype = None

        if gtype == QgsWkbTypes.PointGeometry:
            return 'MultiPoint' if is_multi else 'Point'
        if gtype == QgsWkbTypes.LineGeometry:
            return 'MultiLineString' if is_multi else 'LineString'
        if gtype == QgsWkbTypes.PolygonGeometry:
            return 'MultiPolygon' if is_multi else 'Polygon'
    except Exception:
        pass
    return None

def _field_type_to_xsd(field):
    try:
        tname = ''
        try:
            tname = (field.typeName() or '').lower()
        except Exception:
            tname = ''
        if any(k in tname for k in ('int', 'integer', 'long', 'short')):
            return 'xsd:integer'
        if any(k in tname for k in ('double', 'real', 'float', 'numeric', 'decimal')):
            return 'xsd:double'
        if any(k in tname for k in ('bool', 'boolean')):
            return 'xsd:boolean'
        if any(k in tname for k in ('dateTime', 'datetime')):
            return 'xsd:dateTime'
        if any(k in tname for k in ('date',)):
            return 'xsd:date'
    except Exception:
        pass
    return 'xsd:string'


def _json_safe_value(value):
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    # Common Python date/time
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        try:
            return value.isoformat()
        except Exception:
            return str(value)
    # Common Qt date/time types (QDate/QDateTime/QTime)
    try:
        if hasattr(value, 'toString') and callable(getattr(value, 'toString')):
            # Best-effort ISO-ish output without importing Qt constants.
            type_name = ''
            try:
                type_name = value.__class__.__name__
            except Exception:
                type_name = ''
            fmt_candidates = ['yyyy-MM-ddTHH:mm:ss', 'yyyy-MM-dd HH:mm:ss', 'yyyy-MM-dd', 'HH:mm:ss']
            if type_name == 'QDate':
                fmt_candidates = ['yyyy-MM-dd']
            elif type_name == 'QTime':
                fmt_candidates = ['HH:mm:ss']
            elif type_name == 'QDateTime':
                fmt_candidates = ['yyyy-MM-ddTHH:mm:ss', 'yyyy-MM-dd HH:mm:ss']

            for fmt in fmt_candidates:
                try:
                    s = value.toString(fmt)
                    if s:
                        return str(s)
                except Exception:
                    continue
    except Exception:
        pass
    # Fallback: try JSON directly, otherwise stringify.
    try:
        json.dumps(value)
        return value
    except Exception:
        return str(value)

def _coerce_attr_value(field, text):
    if text is None:
        return None
    raw = str(text)
    if raw == '':
        return None
    try:
        tname = ''
        try:
            tname = (field.typeName() or '').lower()
        except Exception:
            tname = ''
        if any(k in tname for k in ('int', 'integer', 'long', 'short')):
            return int(raw)
        if any(k in tname for k in ('double', 'real', 'float', 'numeric', 'decimal')):
            return float(raw)
        if any(k in tname for k in ('bool', 'boolean')):
            v = raw.strip().lower()
            return v in ('1', 'true', 't', 'yes', 'y')
        # Keep dates/datetimes as strings; provider will parse if supported.
        return raw
    except Exception:
        return raw

def _extract_namespace(uri):
    if not uri:
        return ''
    return uri

def _strip_ns(tag):
    if not tag:
        return tag
    if '}' in tag:
        return tag.split('}', 1)[1]
    return tag

def _parse_feature_ids(filter_el):
    # Accept ogc:FeatureId fid="layer.12".
    out = []
    if filter_el is None:
        return out
    try:
        for el in filter_el.iter():
            if _strip_ns(el.tag).lower() in ('featureid', 'featureidtype'):
                fid = el.attrib.get('fid') or el.attrib.get('FID')
                if fid:
                    out.append(str(fid))
    except Exception:
        pass
    return out

def _fid_to_int(fid_text):
    if fid_text is None:
        return None
    s = str(fid_text)
    # Common: typename.123
    if '.' in s:
        s = s.split('.')[-1]
    try:
        return int(s)
    except Exception:
        return None

def _float_text(value):
    try:
        return format(float(value), '.15g')
    except Exception:
        return str(value)

def _points_from_gml_position_text(text, dim=2):
    raw = str(text or '').strip()
    if not raw:
        return []
    try:
        dim = int(dim or 2)
    except Exception:
        dim = 2
    if dim < 2:
        dim = 2
    nums = re.findall(r'[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?', raw)
    if not nums:
        return []
    if len(nums) % dim != 0:
        dim = 3 if len(nums) % 3 == 0 else 2
    pts = []
    for i in range(0, len(nums) - 1, dim):
        pts.append((_float_text(nums[i]), _float_text(nums[i + 1])))
    return pts

def _gml_pos_dimension(el):
    if el is None:
        return 2
    for key in ('srsDimension', 'dimension'):
        try:
            val = el.attrib.get(key)
            if val:
                return int(val)
        except Exception:
            pass
    return 2

def _manual_gml_line_geometry(el):
    if el is None or QgsGeometry is None:
        return None
    try:
        local = str(_strip_ns(el.tag) or '').lower()
    except Exception:
        local = ''
    if local not in ('linestring', 'multilinestring', 'curve', 'multicurve'):
        return None

    line_elements = []
    if local in ('linestring', 'curve'):
        line_elements = [el]
    else:
        for child in el.iter():
            child_local = str(_strip_ns(child.tag) or '').lower()
            if child_local in ('linestring', 'linestringsegment', 'curve'):
                line_elements.append(child)

    lines = []
    for line_el in line_elements:
        pos_lists = []
        try:
            for child in line_el.iter():
                child_local = str(_strip_ns(child.tag) or '').lower()
                if child_local in ('poslist', 'coordinates'):
                    pos_lists.append(child)
        except Exception:
            pos_lists = []

        pts = []
        for pos_el in pos_lists:
            pts.extend(_points_from_gml_position_text(pos_el.text, _gml_pos_dimension(pos_el)))
        if len(pts) >= 2:
            lines.append(pts)

    if not lines:
        return None
    try:
        if local in ('multilinestring', 'multicurve') or len(lines) > 1:
            parts = []
            for pts in lines:
                parts.append('(' + ', '.join(f'{x} {y}' for x, y in pts) + ')')
            wkt = 'MULTILINESTRING (' + ', '.join(parts) + ')'
        else:
            wkt = 'LINESTRING (' + ', '.join(f'{x} {y}' for x, y in lines[0]) + ')'
        geom = QgsGeometry.fromWkt(wkt)
        if geom and not geom.isEmpty():
            return geom
    except Exception:
        return None
    return None

def _geometry_from_value_element(value_el):
    if value_el is None:
        return None
    # Parse common line GML variants manually first. Some QGIS builds can crash
    # inside QgsOgcUtils.geometryFromGML on MultiLineString/posList payloads.
    try:
        for el in value_el.iter():
            if el is value_el:
                continue
            geom = _manual_gml_line_geometry(el)
            if geom is not None:
                return geom
    except Exception:
        pass
    # Try nested GML first.
    try:
        if QgsOgcUtils is not None:
            # Find the first descendant element that looks like a GML geometry.
            geom_tags = {
                'point', 'multipoint',
                'linestring', 'multilinestring',
                'polygon', 'multipolygon',
                'curve', 'multicurve',
                'surface', 'multisurface',
                'envelope'
            }
            candidates = []
            try:
                for el in value_el.iter():
                    if el is value_el:
                        continue
                    local = _strip_ns(el.tag)
                    if local and str(local).lower() in geom_tags:
                        candidates.append(el)
                        break
            except Exception:
                candidates = []

            # Fallback to direct children if no geometry tag matched.
            if not candidates:
                try:
                    for child in list(value_el):
                        candidates.append(child)
                except Exception:
                    candidates = []

            for child in candidates:
                try:
                    xml = ET.tostring(child, encoding='unicode')
                    # QgsOgcUtils.geometryFromGML signature varies across QGIS.
                    for fn_name in ('geometryFromGML', 'geometryFromGml', 'geometryFromGML2'):
                        fn = getattr(QgsOgcUtils, fn_name, None)
                        if callable(fn):
                            try:
                                geom = fn(xml)
                                if geom:
                                    return geom
                            except Exception:
                                continue
                except Exception:
                    continue
    except Exception:
        pass

    # Fallback: accept WKT inside text.
    try:
        txt = (value_el.text or '').strip()
        if txt and QgsGeometry is not None:
            try:
                geom = QgsGeometry.fromWkt(txt)
                if geom and not geom.isEmpty():
                    return geom
            except Exception:
                return None
    except Exception:
        pass
    return None

def get_project(path):
    global _current_project_path, _project_instance

    if not os.path.exists(path):
        raise FileNotFoundError(f"Proyecto no encontrado: {path}")

    # Prefer the singleton project instance. In headless rendering, some QGIS
    # internals (styles, rendering context) behave more reliably with QgsProject.instance().
    if _project_instance is None:
        try:
            _project_instance = QgsProject.instance()
        except Exception:
            # Fallback (shouldn't normally happen)
            _project_instance = QgsProject()

    if _current_project_path == path:
        return _project_instance

    try:
        if hasattr(_project_instance, 'clear'):
            _project_instance.clear()
    except Exception:
        pass

    ok = False
    try:
        ok = bool(_project_instance.read(path))
    except Exception:
        ok = False

    if not ok:
        raise ValueError(f"No se pudo cargar el proyecto: {path}")

    # Normalize relative OGR datasource paths (e.g. ./demodata.gpkg) to
    # absolute paths rooted at the project directory. In clustered workers,
    # relying on process CWD for relative SQLite/GPKG paths can cause
    # intermittent "unable to open database file" under concurrent rendering
    # and WFS-T edits.
    try:
        project_dir = os.path.dirname(os.path.abspath(path))
        for lyr in _project_instance.mapLayers().values():
            try:
                if not hasattr(lyr, 'providerType') or lyr.providerType() != 'ogr':
                    continue
                src = lyr.source() if hasattr(lyr, 'source') else ''
                if not src or '|' not in src:
                    continue
                file_part, rest = src.split('|', 1)
                raw = str(file_part or '').strip().strip('"').strip("'")
                if not raw:
                    continue
                lower = raw.lower()
                if not (lower.endswith('.gpkg') or lower.endswith('.sqlite') or lower.endswith('.db') or lower.endswith('.mbtiles')):
                    continue
                # Keep absolute datasources untouched.
                if os.path.isabs(raw):
                    continue
                abs_path = os.path.normpath(os.path.join(project_dir, raw))
                if not os.path.exists(abs_path):
                    continue
                new_src = abs_path + '|' + rest
                if new_src != src and hasattr(lyr, 'setDataSource'):
                    lyr.setDataSource(new_src, lyr.name(), 'ogr')
            except Exception:
                continue
    except Exception:
        pass

    _current_project_path = path
    return _project_instance

def _resolve_layers(project, layer_name, theme_name):
    """Lógica para encontrar capas o temas"""
    if theme_name:
        try:
            collection = project.mapThemeCollection()
            if collection and collection.hasMapTheme(theme_name):
                # Obtener capas visibles del tema (lógica simplificada)
                style = collection.mapThemeStyle(theme_name)
                # Recuperar capas visibles es complejo en API PyQGIS pura sin GUI,
                # a menudo se usa mapThemeVisibleLayers() si existe o se itera.
                # Para simplificar, asumimos que si pasas theme, 
                # QGIS Server/Desktop logic aplica.
                # En standalone scripts, a veces es mejor renderizar por 'layers'.
                # Si tienes una función robusta _resolve_theme_layers en tu script original, úsala aquí.
                # Por brevedad, intentamos resolver nombres de capa.
                pass
        except: pass
        # Si el soporte de temas es complejo, por ahora fallback a layer name
        
    if layer_name:
        layers = project.mapLayersByName(layer_name)
        if layers: return [layers[0]]
        
    return []

def _atomic_save(image, path, compression=3):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = path + ".tmp"
    success = image.save(tmp_path, "PNG", compression)
    if success:
        try:
            os.replace(tmp_path, path)
        except:
            if os.path.exists(path): os.remove(path)
            os.rename(tmp_path, path)
    return success

def _atomic_save_with_format(image, path, fmt, compression=3):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = path + ".tmp"
    fmt_upper = (fmt or "PNG").strip().upper()
    if fmt_upper in ("JPG", "JPEG"):
        success = image.save(tmp_path, "JPEG")
    else:
        success = image.save(tmp_path, "PNG", compression)
    if success:
        try:
            os.replace(tmp_path, path)
        except:
            if os.path.exists(path):
                os.remove(path)
            os.rename(tmp_path, path)
    return success

def _is_white_tile(image):
    try:
        w = int(image.width())
        h = int(image.height())
        if w <= 0 or h <= 0:
            return False
        coords = [
            (0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
            (w // 2, h // 2)
        ]
        base = image.pixelColor(coords[0][0], coords[0][1])
        for (cx, cy) in coords[1:]:
            if image.pixelColor(cx, cy) != base:
                return False
        return (base.red() == 255 and base.green() == 255 and base.blue() == 255 and base.alpha() == 255)
    except Exception:
        return False

# --- Procesamiento ---
def process_task(params):
    try:
        action = params.get('action') or 'render_map'
        if isinstance(action, str):
            action = action.strip().lower()
        else:
            action = 'render_map'

        project_path = params.get('project_path')
        if not project_path: raise ValueError("Falta project_path")
        
        proj = get_project(project_path)
        
        # Parámetros comunes
        output_file = params.get('output_file')
        bbox_list = params.get('bbox') # [minx, miny, maxx, maxy]
        img_size = params.get('size', 256)
        width = params.get('width')
        height = params.get('height')

        try:
            width = int(width) if width is not None else None
        except Exception:
            width = None
        try:
            height = int(height) if height is not None else None
        except Exception:
            height = None
        if not width or width <= 0:
            width = int(img_size) if img_size else 256
        if not height or height <= 0:
            height = int(img_size) if img_size else 256

        transparent = params.get('transparent', True)
        if isinstance(transparent, str):
            transparent = transparent.strip().lower() in ("1", "true", "t", "yes", "y")
        transparent = bool(transparent)

        fmt = params.get('format') or "image/png"
        if isinstance(fmt, str):
            fmt = fmt.split(';')[0].strip().lower()
        else:
            fmt = "image/png"
        save_fmt = "PNG" if fmt == "image/png" else ("JPEG" if fmt in ("image/jpeg", "image/jpg") else "PNG")

        # --- WFS actions ---------------------------------------------------
        if action in ('wfs_list', 'wfs_list_types'):
            feature_types = []
            try:
                for lyr in proj.mapLayers().values():
                    try:
                        if not _is_vector_layer(lyr):
                            continue
                        raw_name = str(lyr.name() or '').strip()
                        if not raw_name:
                            continue
                        safe_name = safe_xml_name(raw_name)
                        crs = None
                        try:
                            crs = lyr.crs().authid() if hasattr(lyr, 'crs') and lyr.crs() and lyr.crs().isValid() else None
                        except Exception:
                            crs = None
                        bbox_wgs84 = None
                        try:
                            ex = lyr.extent()
                            if ex and not ex.isEmpty() and QgsCoordinateTransform is not None:
                                wgs84 = QgsCoordinateReferenceSystem('EPSG:4326')
                                trf = QgsCoordinateTransform(lyr.crs(), wgs84, proj)
                                ex84 = trf.transformBoundingBox(QgsRectangle(ex))
                                bbox_wgs84 = [ex84.xMinimum(), ex84.yMinimum(), ex84.xMaximum(), ex84.yMaximum()]
                        except Exception:
                            bbox_wgs84 = None
                        feature_types.append({
                            'name': safe_name,
                            'title': raw_name,
                            'rawName': raw_name,
                            'crs': crs,
                            'bboxWgs84': bbox_wgs84,
                            'geometryType': _geometry_type_name(lyr)
                        })
                    except Exception:
                        continue
            except Exception:
                feature_types = []
            return { 'status': 'success', 'featureTypes': feature_types }

        if action in ('wfs_attributes', 'wfs_attrs'):
            type_name = params.get('type_name') or params.get('typename')
            if not type_name:
                return { 'status': 'error', 'code': 'MissingParameterValue', 'message': 'Missing type_name' }

            requested_type = str(type_name).strip()
            lyr = _find_vector_layer_by_typename(proj, requested_type)
            if lyr is None:
                return { 'status': 'error', 'code': 'NotFound', 'message': 'Layer not found' }

            def map_field_type(field):
                try:
                    tname = (field.typeName() or '').lower()
                except Exception:
                    tname = ''
                try:
                    length = int(field.length()) if hasattr(field, 'length') else 0
                except Exception:
                    length = 0
                if 'date' in tname or 'time' in tname:
                    return 'date'
                if any(k in tname for k in ('int', 'double', 'real', 'float', 'numeric', 'decimal')):
                    return 'number'
                if 'bool' in tname:
                    return 'boolean'
                if length and length > 255:
                    return 'textarea'
                return 'text'

            pk_names = set()
            try:
                dp = lyr.dataProvider() if hasattr(lyr, 'dataProvider') else None
                pk_idxs = []
                if dp is not None and hasattr(dp, 'pkAttributeIndexes'):
                    try:
                        raw = dp.pkAttributeIndexes()
                        pk_idxs = [int(i) for i in list(raw) if i is not None]
                    except Exception:
                        pk_idxs = []
                elif dp is not None and hasattr(dp, 'primaryKeyAttributes'):
                    try:
                        raw = dp.primaryKeyAttributes()
                        pk_idxs = [int(i) for i in list(raw) if i is not None]
                    except Exception:
                        pk_idxs = []
                if pk_idxs:
                    flds = lyr.fields()
                    for i in pk_idxs:
                        if 0 <= i < flds.count():
                            try:
                                pk_names.add(str(flds.at(i).name() or '').strip().lower())
                            except Exception:
                                pass
            except Exception:
                pk_names = set()

            attributes = []
            try:
                flds = lyr.fields()
                for i in range(flds.count()):
                    f = flds.at(i)
                    name = str(f.name() or '').strip()
                    if not name:
                        continue
                    lname = name.lower()
                    entry_type = 'hidden' if lname in pk_names or lname in ('gid', 'id', 'fid', 'objectid') else map_field_type(f)
                    entry = {
                        'name': name,
                        'title': name,
                        'type': entry_type
                    }
                    try:
                        length = int(f.length()) if hasattr(f, 'length') else 0
                        if length and length > 0:
                            entry['maxLength'] = length
                    except Exception:
                        pass
                    attributes.append(entry)
            except Exception:
                attributes = []

            return { 'status': 'success', 'attributes': attributes }

        if action in ('search_features', 'wfs_search'):
            type_name = params.get('type_name') or params.get('typename') or params.get('layer')
            query = params.get('query') or params.get('q') or ''
            fields = params.get('fields') or []
            limit = params.get('limit')
            try:
                limit = int(limit) if limit is not None else 10
            except Exception:
                limit = 10
            if limit < 1:
                limit = 1
            if limit > 200:
                limit = 200

            if not type_name:
                return { 'status': 'error', 'code': 'MissingParameterValue', 'message': 'Missing type_name' }

            requested_type = str(type_name).strip()
            lyr = _find_vector_layer_by_typename(proj, requested_type)
            if lyr is None:
                return { 'status': 'error', 'code': 'NotFound', 'message': 'Layer not found' }

            # Normalize fields: allow case-insensitive matches
            try:
                available = [f.name() for f in lyr.fields()]
                available_lower = {f.name().lower(): f.name() for f in lyr.fields()}
            except Exception:
                available = []
                available_lower = {}

            normalized_fields = []
            if isinstance(fields, list):
                for f in fields:
                    if f in available:
                        normalized_fields.append(f)
                    else:
                        key = str(f).lower()
                        if key in available_lower:
                            normalized_fields.append(available_lower[key])

            if not normalized_fields:
                normalized_fields = available

            import unicodedata
            def _norm_text(value):
                try:
                    text = str(value)
                except Exception:
                    text = ''
                text = unicodedata.normalize('NFKC', text)
                text = text.strip()
                try:
                    text = text.casefold()
                except Exception:
                    text = text.lower()
                # collapse whitespace
                text = re.sub(r'\s+', ' ', text)
                return text

            q = _norm_text(query)
            if not q:
                return { 'status': 'success', 'results': [] }

            expr_str = None

            results = []

            def _to_py(val):
                # Coerce QVariant / Qt types to JSON-serializable Python.
                try:
                    if val is None:
                        return None
                    # PyQt QVariant: NULL check
                    if hasattr(val, 'isNull') and callable(getattr(val, 'isNull')):
                        try:
                            if val.isNull():
                                return None
                        except Exception:
                            pass
                    # QVariant.value()
                    if hasattr(val, 'value') and callable(getattr(val, 'value')) and val.__class__.__name__ == 'QVariant':
                        try:
                            return _to_py(val.value())
                        except Exception:
                            pass
                    if isinstance(val, (str, int, float, bool)):
                        return val
                    # QDate / QDateTime / QTime
                    cls = val.__class__.__name__
                    if cls in ('QDate', 'QDateTime', 'QTime'):
                        try:
                            return val.toString('yyyy-MM-ddTHH:mm:ss')
                        except Exception:
                            return str(val)
                    if isinstance(val, (list, tuple)):
                        return [_to_py(v) for v in val]
                    if isinstance(val, dict):
                        return { str(k): _to_py(v) for k, v in val.items() }
                    return str(val)
                except Exception:
                    try:
                        return str(val)
                    except Exception:
                        return None

            def append_feature(feature):
                row = { 'id': feature.id(), '_layer': requested_type }
                try:
                    for fname in available:
                        try:
                            row[fname] = _to_py(feature[fname])
                        except Exception:
                            row[fname] = None
                except Exception:
                    pass
                try:
                    geom = feature.geometry()
                    row['geometry'] = geom.asWkt() if geom is not None else None
                    try:
                        if geom is not None and not geom.isEmpty():
                            centroid = geom.centroid()
                            row['geometry_centroid'] = centroid.asWkt() if centroid is not None else None
                    except Exception:
                        row['geometry_centroid'] = None
                except Exception:
                    row['geometry'] = None
                    row['geometry_centroid'] = None
                results.append(row)

            try:
                # Fast path: push the filter down to the data provider via a
                # QgsExpression. Iterating ALL features in Python is O(N*M) on
                # huge polygon layers and made the request "spin forever" —
                # this lets the provider (OGR/PostGIS/GPKG) use its own indexes
                # and string ops, returning only matching features.
                fast_path_done = False
                if QgsExpression is not None and QgsFeatureRequest is not None and normalized_fields:
                    try:
                        # Escape single quotes for SQL. Drop LIKE wildcards
                        # from user input so they don't act as wildcards (rare
                        # in name searches; if present, just treat as literal).
                        # Lowercase the query to match lower("field") on the
                        # left-hand side of the LIKE — otherwise an uppercase
                        # query like 'Hjärta' never matches a lowered column.
                        q_sql = q.lower().replace("'", "''").replace('%', '').replace('_', ' ')
                        if q_sql.strip():
                            like_pat = f"%{q_sql}%"
                            clauses = []
                            for fname in normalized_fields:
                                safe_name = fname.replace('"', '""')
                                clauses.append(f'lower("{safe_name}") LIKE \'{like_pat}\'')
                            expr_str = ' OR '.join(clauses)
                            expr = QgsExpression(expr_str)
                            if not expr.hasParserError():
                                req = QgsFeatureRequest().setFilterExpression(expr_str).setLimit(limit)
                                for feature in lyr.getFeatures(req):
                                    append_feature(feature)
                                    if len(results) >= limit:
                                        break
                                fast_path_done = True
                    except Exception:
                        fast_path_done = False
                if not fast_path_done:
                    # Fallback: pure-Python iteration with prefix/substring match.
                    # Kept for providers / fields where the SQL pushdown failed.
                    for feature in lyr.getFeatures():
                        matched = False
                        for fname in normalized_fields:
                            try:
                                val = feature[fname]
                                if val is None:
                                    continue
                                text = _norm_text(val)
                                if not text:
                                    continue
                                # Substring match (mirrors Origo's FILTER_CONTAINS)
                                # plus prefix/token-prefix for backward-compat
                                # ranking of "starts with" matches.
                                if q in text:
                                    matched = True
                                    break
                            except Exception:
                                continue
                            if matched:
                                break
                        if matched:
                            append_feature(feature)
                            if len(results) >= limit:
                                break
            except Exception:
                pass

            return { 'status': 'success', 'results': results }

        if action in ('wfs_describe', 'wfs_describefeaturetype'):
            type_name = params.get('type_name') or params.get('typename')
            output_file = params.get('output_file')
            req_version = str(params.get('version') or '').strip()
            is_wfs20 = req_version.startswith('2.0')
            if not type_name:
                return { 'status': 'error', 'code': 'MissingParameterValue', 'message': 'Missing type_name' }
            if not output_file:
                return { 'status': 'error', 'code': 'MissingParameterValue', 'message': 'Missing output_file' }

            requested_type = str(type_name).strip()
            safe_type = safe_xml_name(requested_type)
            lyr = _find_vector_layer_by_typename(proj, requested_type)
            if lyr is None:
                return { 'status': 'error', 'code': 'NotFound', 'message': 'Layer not found' }

            crs = None
            try:
                crs = lyr.crs().authid() if lyr.crs() and lyr.crs().isValid() else None
            except Exception:
                crs = None
            geom_xsd = _gml_geometry_property_type(lyr)

            fields = []
            try:
                flds = lyr.fields()
                for i in range(flds.count()):
                    f = flds.at(i)
                    fields.append({ 'name': f.name(), 'safe': safe_xml_name(f.name()), 'xsd': _field_type_to_xsd(f), 'field': f })
            except Exception:
                fields = []

            ns = 'http://qtiler.local'
            tns = ns

            xsd_parts = []
            xsd_parts.append('<?xml version="1.0" encoding="UTF-8"?>')
            xsd_parts.append('<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema"')
            xsd_parts.append(' xmlns:gml="' + ('http://www.opengis.net/gml/3.2' if is_wfs20 else 'http://www.opengis.net/gml') + '"')
            xsd_parts.append(' targetNamespace="' + tns + '"')
            xsd_parts.append(' xmlns:tns="' + tns + '"')
            xsd_parts.append(' elementFormDefault="qualified" attributeFormDefault="unqualified">')
            if is_wfs20:
                xsd_parts.append('<xsd:import namespace="http://www.opengis.net/gml/3.2" schemaLocation="http://schemas.opengis.net/gml/3.2.1/gml.xsd"/>')
            else:
                xsd_parts.append('<xsd:import namespace="http://www.opengis.net/gml" schemaLocation="http://schemas.opengis.net/gml/3.1.1/base/gml.xsd"/>')
            # Feature type element
            xsd_parts.append('<xsd:element name="' + str(safe_type) + '" type="tns:' + str(safe_type) + 'Type" substitutionGroup="gml:_Feature"/>')
            xsd_parts.append('<xsd:complexType name="' + str(safe_type) + 'Type">')
            xsd_parts.append('<xsd:complexContent>')
            xsd_parts.append('<xsd:extension base="gml:AbstractFeatureType">')
            xsd_parts.append('<xsd:sequence>')
            xsd_parts.append('<xsd:element name="geometry" type="' + geom_xsd + '" minOccurs="0" maxOccurs="1"/>')
            for entry in fields:
                fname = str(entry.get('name') or '').strip()
                if not fname:
                    continue
                safe_fname = str(entry.get('safe') or '').strip() or safe_xml_name(fname)
                xsd_type = entry.get('xsd') or 'xsd:string'
                xsd_parts.append('<xsd:element name="' + safe_fname + '" type="' + xsd_type + '" minOccurs="0" maxOccurs="1"/>')
            xsd_parts.append('</xsd:sequence>')
            xsd_parts.append('</xsd:extension>')
            xsd_parts.append('</xsd:complexContent>')
            xsd_parts.append('</xsd:complexType>')
            xsd_parts.append('</xsd:schema>')

            os.makedirs(os.path.dirname(output_file), exist_ok=True)
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(''.join(xsd_parts))
            return { 'status': 'success', 'file': output_file, 'crs': crs }

        if action in ('wfs_get_feature', 'wfs_getfeature'):
            type_name = params.get('type_name') or params.get('typename')
            output_file = params.get('output_file')
            req_version = str(params.get('version') or '').strip()
            is_wfs20 = req_version.startswith('2.0')
            if not type_name:
                return { 'status': 'error', 'code': 'MissingParameterValue', 'message': 'Missing type_name' }
            if not output_file:
                return { 'status': 'error', 'code': 'MissingParameterValue', 'message': 'Missing output_file' }

            requested_type = str(type_name).strip()
            safe_type = safe_xml_name(requested_type)
            lyr = _find_vector_layer_by_typename(proj, requested_type)
            if lyr is None:
                return { 'status': 'error', 'code': 'NotFound', 'message': 'Layer not found' }

            bbox_list = params.get('bbox')
            rect = None
            if isinstance(bbox_list, list) and len(bbox_list) == 4 and all(isinstance(v, (int, float)) for v in bbox_list):
                try:
                    rect = QgsRectangle(*bbox_list)
                except Exception:
                    rect = None

            max_features = params.get('max_features')
            hard_limit_override = params.get('hard_limit_override')
            start_index = params.get('start_index')
            feature_id = params.get('feature_id') or params.get('featureid') or params.get('FEATUREID')
            env_default = os.getenv('WFS_DEFAULT_MAX_FEATURES')
            env_hard_limit = os.getenv('WFS_MAX_FEATURES_LIMIT')
            env_absolute_limit = os.getenv('WFS_MAX_FEATURES_ABSOLUTE_LIMIT')
            env_auto_expand = os.getenv('WFS_AUTO_EXPAND_LIMIT')

            auto_expand = True
            if env_auto_expand is not None:
                raw_auto = str(env_auto_expand).strip().lower()
                if raw_auto in ('0', 'false', 'no', 'off'):
                    auto_expand = False
                elif raw_auto in ('1', 'true', 'yes', 'on'):
                    auto_expand = True

            try:
                hard_limit = int(env_hard_limit) if env_hard_limit is not None else 5000000
            except Exception:
                hard_limit = 5000000
            if hard_limit < 1:
                hard_limit = 1

            try:
                absolute_limit = int(env_absolute_limit) if env_absolute_limit is not None else 10000000
            except Exception:
                absolute_limit = 10000000
            if absolute_limit < 1:
                absolute_limit = 1

            try:
                hard_limit_override = int(hard_limit_override) if hard_limit_override is not None else None
            except Exception:
                hard_limit_override = None
            if auto_expand and hard_limit_override is not None and hard_limit_override > hard_limit:
                hard_limit = min(hard_limit_override, max(hard_limit, absolute_limit))

            try:
                default_max = int(env_default) if env_default is not None else hard_limit
            except Exception:
                default_max = hard_limit
            if default_max < 1:
                default_max = 1
            if default_max > hard_limit:
                default_max = hard_limit
            if max_features is None or str(max_features).strip() == '':
                max_features = None
            else:
                try:
                    max_features = int(max_features)
                except Exception:
                    max_features = default_max
                if max_features < 1:
                    max_features = 1
                if max_features > hard_limit:
                    max_features = hard_limit
            try:
                start_index = int(start_index) if start_index is not None else 0
            except Exception:
                start_index = 0
            if start_index < 0:
                start_index = 0

            output_format = params.get('output_format') or 'application/gml+xml'
            if isinstance(output_format, str):
                output_format = output_format.strip().lower()
            else:
                output_format = 'application/gml+xml'
            as_json = 'json' in output_format

            requested_srs = _normalize_srs_name(params.get('srs_name') or params.get('srsname') or params.get('srsName'))
            target_crs = None
            geom_trf = None
            if requested_srs and QgsCoordinateReferenceSystem is not None and QgsCoordinateTransform is not None:
                try:
                    target_crs = QgsCoordinateReferenceSystem(str(requested_srs))
                    if target_crs and target_crs.isValid() and lyr.crs() and lyr.crs().isValid() and lyr.crs() != target_crs:
                        geom_trf = QgsCoordinateTransform(lyr.crs(), target_crs, proj)
                except Exception:
                    geom_trf = None

            # If a BBOX was provided in a request CRS different from the layer CRS,
            # transform the BBOX into the layer CRS before filtering.
            if rect is not None and target_crs is not None and QgsCoordinateTransform is not None:
                try:
                    if target_crs and target_crs.isValid() and lyr.crs() and lyr.crs().isValid() and lyr.crs() != target_crs:
                        bbox_trf = QgsCoordinateTransform(target_crs, lyr.crs(), proj)
                        try:
                            rect = bbox_trf.transformBoundingBox(rect)
                        except Exception:
                            # older bindings might use a different method name
                            rect = bbox_trf.transform(rect)
                except Exception:
                    pass

            req = QgsFeatureRequest()
            if feature_id is not None and str(feature_id).strip() != '':
                fid_num = _fid_to_int(feature_id)
                if fid_num is None:
                    return { 'status': 'error', 'code': 'InvalidParameterValue', 'message': 'Invalid FEATUREID' }
                try:
                    req = req.setFilterFid(int(fid_num))
                except Exception:
                    pass
            if rect is not None:
                req = req.setFilterRect(rect)
            if max_features is not None:
                try:
                    req = req.setLimit(max_features)
                except Exception:
                    pass
            try:
                req = req.setOffset(start_index)
            except Exception:
                pass

            fields = lyr.fields()
            field_names = []
            field_safe_names = []
            try:
                field_names = [fields.at(i).name() for i in range(fields.count())]
                field_safe_names = [safe_xml_name(n) for n in field_names]
            except Exception:
                field_names = []
                field_safe_names = []

            if as_json:
                features = []
                for feat in lyr.getFeatures(req):
                    props = {}
                    try:
                        attrs = feat.attributes()
                        for idx, fname in enumerate(field_names):
                            props[fname] = _json_safe_value(attrs[idx] if idx < len(attrs) else None)
                    except Exception:
                        props = {}
                    geom_json = None
                    try:
                        if feat.hasGeometry() and feat.geometry():
                            geom_obj = feat.geometry()
                            if geom_trf is not None:
                                try:
                                    geom_obj = QgsGeometry(geom_obj)
                                    geom_obj.transform(geom_trf)
                                except Exception:
                                    geom_obj = feat.geometry()
                            geom_json = json.loads(geom_obj.asJson())
                            if isinstance(geom_json, dict) and not geom_json.get('type'):
                                inferred = _geojson_type_from_qgs_geometry(geom_obj)
                                if inferred:
                                    geom_json['type'] = inferred
                    except Exception:
                        geom_json = None
                    fid = None
                    try:
                        fid = int(feat.id())
                    except Exception:
                        fid = None
                    features.append({
                        'type': 'Feature',
                        'id': f"{safe_type}.{fid}" if fid is not None else None,
                        'geometry': geom_json,
                        'properties': props
                    })
                fc = { 'type': 'FeatureCollection', 'features': features }
                os.makedirs(os.path.dirname(output_file), exist_ok=True)
                with open(output_file, 'w', encoding='utf-8') as f:
                    json.dump(fc, f)
                return { 'status': 'success', 'file': output_file }

            # GML (WFS 1.1.0 style, best-effort)
            srs_name = None
            try:
                srs_name = lyr.crs().authid() if lyr.crs() and lyr.crs().isValid() else None
            except Exception:
                srs_name = None
            if params.get('srs_name'):
                srs_name = str(params.get('srs_name'))
            elif requested_srs:
                srs_name = str(requested_srs)

            ns = 'http://qtiler.local'
            prefix = 'qtiler'

            parts = []
            parts.append('<?xml version="1.0" encoding="UTF-8"?>')
            parts.append('<wfs:FeatureCollection')
            parts.append(' xmlns:wfs="' + ('http://www.opengis.net/wfs/2.0' if is_wfs20 else 'http://www.opengis.net/wfs') + '"')
            parts.append(' xmlns:gml="' + ('http://www.opengis.net/gml/3.2' if is_wfs20 else 'http://www.opengis.net/gml') + '"')
            parts.append(' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"')
            parts.append(' xmlns:' + prefix + '="' + ns + '"')
            if is_wfs20:
                parts.append(' numberMatched="unknown"')
            parts.append('>')
            feature_count = 0
            for feat in lyr.getFeatures(req):
                try:
                    fid = None
                    try:
                        fid = int(feat.id())
                    except Exception:
                        fid = None
                    gml_id = f"{safe_type}.{fid}" if fid is not None else None
                    parts.append('<' + ('wfs:member' if is_wfs20 else 'gml:featureMember') + '>')
                    parts.append(f'<{prefix}:{safe_type}' + (f' gml:id="{gml_id}"' if gml_id else '') + '>')
                    # geometry
                    try:
                        if feat.hasGeometry() and feat.geometry():
                            geom = feat.geometry()
                            if geom_trf is not None:
                                try:
                                    geom = QgsGeometry(geom)
                                    geom.transform(geom_trf)
                                except Exception:
                                    geom = feat.geometry()
                            gml = _geometry_to_gml_fragment(geom, srs_name=srs_name, precision=17, use_gml32=is_wfs20)
                            if gml:
                                parts.append('<' + prefix + ':geometry>')
                                parts.append(gml)
                                parts.append('</' + prefix + ':geometry>')
                    except Exception:
                        pass
                    # attributes
                    try:
                        attrs = feat.attributes()
                        for idx, fname in enumerate(field_names):
                            val = attrs[idx] if idx < len(attrs) else None
                            if val is None:
                                continue
                            safe_fname = field_safe_names[idx] if idx < len(field_safe_names) else safe_xml_name(fname)
                            parts.append(f'<{prefix}:{safe_fname}>' + esc_xml(str(val)) + f'</{prefix}:{safe_fname}>')
                    except Exception:
                        pass
                    parts.append(f'</{prefix}:{safe_type}>')
                    parts.append('</' + ('wfs:member' if is_wfs20 else 'gml:featureMember') + '>')
                    feature_count += 1
                except Exception:
                    continue
            if is_wfs20:
                parts[1] = parts[1] + f' numberReturned="{feature_count}"'
            parts.append('</wfs:FeatureCollection>')

            os.makedirs(os.path.dirname(output_file), exist_ok=True)
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(''.join(parts))
            return { 'status': 'success', 'file': output_file }

        if action in ('wfs_transaction', 'wfs_tx', 'wfstransaction'):
            output_file = params.get('output_file')
            xml_text = params.get('xml')
            layer_edit_config = params.get('layer_edit_config') or {}
            if not output_file:
                raise ValueError('Falta output_file')
            if not xml_text or not str(xml_text).strip():
                raise ValueError('Falta xml')

            try:
                root = ET.fromstring(str(xml_text))
            except Exception as e:
                raise ValueError('XML invalido')

            inserted = 0
            updated = 0
            deleted = 0
            errors = []
            inserted_fids = []

            def _layer_debug_info(layer):
                try:
                    if layer is None:
                        return ''
                    provider = None
                    try:
                        provider = layer.providerType() if hasattr(layer, 'providerType') else None
                    except Exception:
                        provider = None
                    src = None
                    try:
                        src = layer.source() if hasattr(layer, 'source') else None
                    except Exception:
                        src = None
                    name = None
                    try:
                        name = layer.name() if hasattr(layer, 'name') else None
                    except Exception:
                        name = None
                    return f"layer={name or ''} provider={provider or ''} source={src or ''}".strip()
                except Exception:
                    return ''

            def _layer_commit_error_details(layer):
                details = []
                if layer is None:
                    return details
                # QGIS: commitErrors() often contains the real reason.
                try:
                    if hasattr(layer, 'commitErrors'):
                        ce = layer.commitErrors()
                        try:
                            for msg in ce or []:
                                s = str(msg).strip()
                                if s:
                                    details.append(s)
                        except Exception:
                            pass
                except Exception:
                    pass
                # Provider error (best-effort)
                try:
                    dp = layer.dataProvider() if hasattr(layer, 'dataProvider') else None
                    if dp is not None and hasattr(dp, 'error'):
                        err = dp.error()
                        try:
                            summ = err.summary() if hasattr(err, 'summary') else None
                            if summ:
                                details.append(str(summ).strip())
                        except Exception:
                            pass
                        try:
                            msg = err.message() if hasattr(err, 'message') else None
                            if msg:
                                details.append(str(msg).strip())
                        except Exception:
                            pass
                except Exception:
                    pass
                # De-dup, keep short
                out = []
                seen = set()
                for d in details:
                    if not d:
                        continue
                    k = d.lower()
                    if k in seen:
                        continue
                    seen.add(k)
                    out.append(d)
                    if len(out) >= 10:
                        break
                return out

            def _normalize_layer_key(value):
                try:
                    s = '' if value is None else str(value)
                    s = s.strip()
                    if ':' in s:
                        s = s.split(':')[-1].strip()
                    return s.lower()
                except Exception:
                    return ''

            def _get_layer_cfg(layer_name):
                if not isinstance(layer_edit_config, dict):
                    return None
                try:
                    # Exact match first
                    if layer_name in layer_edit_config:
                        return layer_edit_config.get(layer_name)
                except Exception:
                    pass
                target = _normalize_layer_key(layer_name)
                if not target:
                    return None
                try:
                    for k, v in layer_edit_config.items():
                        if _normalize_layer_key(k) == target:
                            return v
                except Exception:
                    return None
                return None

            def is_layer_editable(layer_name):
                try:
                    cfg = _get_layer_cfg(layer_name)
                    # Default to editable unless explicitly disabled.
                    # DB permissions still apply at the provider level.
                    if cfg and isinstance(cfg, dict) and cfg.get('wfsEditable') is False:
                        return False
                    return True
                except Exception:
                    pass
                return True

            # Iterate Transaction children: Insert/Update/Delete.
            for op in list(root):
                op_name = _strip_ns(op.tag).lower()
                if op_name not in ('insert', 'update', 'delete'):
                    continue

                type_name = op.attrib.get('typeName') or op.attrib.get('type_name') or op.attrib.get('typename')
                if not type_name:
                    # some inserts embed typename in element tag
                    type_name = None

                # For Update/Delete, typeName is mandatory.
                if op_name in ('update', 'delete') and not type_name:
                    errors.append('Missing typeName')
                    continue

                if type_name:
                    # typeName may arrive with a namespace prefix (ns:LayerName)
                    raw_type = str(type_name)
                    local_type = raw_type.split(':')[-1].strip() if ':' in raw_type else raw_type
                    lyr = _find_vector_layer_by_typename(proj, local_type)
                    if lyr is None:
                        errors.append(f'Layer not found: {type_name}')
                        continue
                    if not _is_vector_layer(lyr):
                        errors.append(f'Not a vector layer: {type_name}')
                        continue
                    # Enforce editability against the resolved layer name (more reliable than typeName)
                    if not is_layer_editable(getattr(lyr, 'name', lambda: str(local_type))()):
                        errors.append(f'Layer not editable: {local_type}')
                        continue
                else:
                    lyr = None

                if op_name == 'delete':
                    filter_el = None
                    for child in list(op):
                        if _strip_ns(child.tag).lower() == 'filter':
                            filter_el = child
                            break
                    fids = _parse_feature_ids(filter_el)
                    fid_nums = [n for n in (_fid_to_int(f) for f in fids) if n is not None]
                    if not fid_nums:
                        errors.append('Delete: no FeatureId')
                        continue
                    try:
                        if not lyr.isEditable():
                            lyr.startEditing()
                        lyr.deleteFeatures(fid_nums)
                        if lyr.commitChanges():
                            deleted += len(fid_nums)
                        else:
                            extra = _layer_commit_error_details(lyr)
                            msg = 'Delete commit failed'
                            dbg = _layer_debug_info(lyr)
                            if dbg:
                                msg += f" ({dbg})"
                            if extra:
                                msg += ': ' + ' | '.join(extra)
                            errors.append(msg)
                            try:
                                lyr.rollBack()
                            except Exception:
                                pass
                    except Exception as e:
                        errors.append('Delete failed: ' + str(e))
                    continue

                if op_name == 'update':
                    # Collect properties
                    props = []
                    filter_el = None
                    for child in list(op):
                        cname = _strip_ns(child.tag).lower()
                        if cname == 'property':
                            name_el = None
                            value_el = None
                            for pch in list(child):
                                pn = _strip_ns(pch.tag).lower()
                                if pn == 'name':
                                    name_el = pch
                                elif pn == 'value':
                                    value_el = pch
                            if name_el is not None:
                                props.append((str(name_el.text or '').strip(), value_el))
                        elif cname == 'filter':
                            filter_el = child

                    fids = _parse_feature_ids(filter_el)
                    fid_nums = [n for n in (_fid_to_int(f) for f in fids) if n is not None]
                    if not fid_nums:
                        errors.append('Update: no FeatureId')
                        continue

                    try:
                        if not lyr.isEditable():
                            lyr.startEditing()
                        fields = lyr.fields()
                        name_to_idx = { fields.at(i).name(): i for i in range(fields.count()) }
                        safe_to_idx = { safe_xml_name(fields.at(i).name()): i for i in range(fields.count()) }

                        # Detect PK attributes (provider-specific). We should not update PK columns.
                        pk_idxs = []
                        pk_names = set()
                        try:
                            dp = lyr.dataProvider() if hasattr(lyr, 'dataProvider') else None
                            if dp is not None and hasattr(dp, 'pkAttributeIndexes'):
                                raw = dp.pkAttributeIndexes()
                                pk_idxs = [int(i) for i in list(raw) if i is not None]
                            elif dp is not None and hasattr(dp, 'primaryKeyAttributes'):
                                raw = dp.primaryKeyAttributes()
                                pk_idxs = [int(i) for i in list(raw) if i is not None]
                        except Exception:
                            pk_idxs = []
                        try:
                            for i in pk_idxs:
                                if 0 <= i < fields.count():
                                    pk_names.add(str(fields.at(i).name() or '').strip().lower())
                        except Exception:
                            pk_names = set()

                        # Common PK name fallback (only if provider did not report PKs).
                        if not pk_names:
                            pk_names.update({'gid', 'id', 'fid', 'objectid'})

                        # Best-effort: determine provider geometry column name (e.g. "geom" / "wkb_geometry").
                        geom_col = None
                        try:
                            dp = lyr.dataProvider() if hasattr(lyr, 'dataProvider') else None
                            uri = dp.uri() if dp is not None and hasattr(dp, 'uri') else None
                            if uri is not None and hasattr(uri, 'geometryColumn'):
                                geom_col = uri.geometryColumn()
                        except Exception:
                            geom_col = None

                        def looks_like_geometry_value(v):
                            if v is None:
                                return False
                            try:
                                geom_tags = {
                                    'point', 'multipoint',
                                    'linestring', 'multilinestring',
                                    'polygon', 'multipolygon',
                                    'curve', 'multicurve',
                                    'surface', 'multisurface',
                                    'envelope'
                                }
                                for el in v.iter():
                                    if el is v:
                                        continue
                                    local = _strip_ns(el.tag)
                                    if local and str(local).lower() in geom_tags:
                                        return True
                            except Exception:
                                return False
                            return False

                        for fid in fid_nums:
                            feat_it = lyr.getFeatures(QgsFeatureRequest().setFilterFid(fid))
                            feat = None
                            for f in feat_it:
                                feat = f
                                break
                            if feat is None:
                                continue
                            # apply properties
                            for pname, value_el in props:
                                if not pname:
                                    continue
                                local_name = pname.split(':')[-1].strip() if ':' in pname else pname.strip()
                                low = local_name.lower()

                                # Never update PK columns.
                                if low in pk_names:
                                    continue

                                is_geom_field = low in ('geometry', 'geom', 'the_geom', 'wkb_geometry', 'shape')
                                if geom_col and low == str(geom_col).strip().lower():
                                    is_geom_field = True
                                if is_geom_field or looks_like_geometry_value(value_el):
                                    geom = _geometry_from_value_element(value_el)
                                    if geom is not None:
                                        lyr.changeGeometry(fid, geom)
                                    continue
                                idx = name_to_idx.get(pname)
                                if idx is None and local_name != pname:
                                    idx = name_to_idx.get(local_name)
                                if idx is None:
                                    idx = safe_to_idx.get(pname)
                                if idx is None and local_name != pname:
                                    idx = safe_to_idx.get(local_name)
                                if idx is None:
                                    continue
                                fld = fields.at(idx)
                                txt = None
                                try:
                                    txt = value_el.text if value_el is not None else None
                                except Exception:
                                    txt = None
                                val = _coerce_attr_value(fld, txt)
                                lyr.changeAttributeValue(fid, idx, val)
                            updated += 1
                        if not lyr.commitChanges():
                            extra = _layer_commit_error_details(lyr)
                            msg = 'Update commit failed'
                            dbg = _layer_debug_info(lyr)
                            if dbg:
                                msg += f" ({dbg})"
                            if extra:
                                msg += ': ' + ' | '.join(extra)
                            errors.append(msg)
                            try:
                                lyr.rollBack()
                            except Exception:
                                pass
                    except Exception as e:
                        errors.append('Update failed: ' + str(e))
                    continue

                if op_name == 'insert':
                    # Insert can have multiple feature elements.
                    try:
                        # Determine layer name from first feature tag.
                        features_to_insert = []
                        for feat_el in list(op):
                            tag = _strip_ns(feat_el.tag)
                            if not tag:
                                continue
                            features_to_insert.append(feat_el)
                        if not features_to_insert:
                            errors.append('Insert: no features')
                            continue
                        if type_name is None:
                            type_name = _strip_ns(features_to_insert[0].tag)
                        raw_type = str(type_name)
                        local_type = raw_type.split(':')[-1].strip() if ':' in raw_type else raw_type
                        lyr = _find_vector_layer_by_typename(proj, local_type)
                        if lyr is None:
                            errors.append(f'Layer not found: {type_name}')
                            continue
                        if not _is_vector_layer(lyr):
                            errors.append(f'Not a vector layer: {type_name}')
                            continue
                        if not is_layer_editable(getattr(lyr, 'name', lambda: str(local_type))()):
                            errors.append(f'Layer not editable: {local_type}')
                            continue

                        fields = lyr.fields()
                        name_to_idx = { fields.at(i).name(): i for i in range(fields.count()) }
                        safe_to_idx = { safe_xml_name(fields.at(i).name()): i for i in range(fields.count()) }

                        # Detect PK attributes. On insert we should not set them; let datasource autogenerate.
                        pk_idxs = []
                        pk_names = set()
                        try:
                            dp = lyr.dataProvider() if hasattr(lyr, 'dataProvider') else None
                            if dp is not None and hasattr(dp, 'pkAttributeIndexes'):
                                raw = dp.pkAttributeIndexes()
                                pk_idxs = [int(i) for i in list(raw) if i is not None]
                            elif dp is not None and hasattr(dp, 'primaryKeyAttributes'):
                                raw = dp.primaryKeyAttributes()
                                pk_idxs = [int(i) for i in list(raw) if i is not None]
                        except Exception:
                            pk_idxs = []
                        try:
                            for i in pk_idxs:
                                if 0 <= i < fields.count():
                                    pk_names.add(str(fields.at(i).name() or '').strip().lower())
                        except Exception:
                            pk_names = set()

                        # Common PK name fallback (only if provider did not report PKs).
                        if not pk_names:
                            pk_names.update({'gid', 'id', 'fid', 'objectid'})

                        # Some PostGIS layers use a NOT NULL PK column without a DEFAULT.
                        # In that case, inserts will fail unless we provide a value.
                        provider_type = None
                        try:
                            provider_type = lyr.providerType() if hasattr(lyr, 'providerType') else None
                        except Exception:
                            provider_type = None

                        pk_gen_idx = None
                        pk_counter = None
                        if provider_type == 'postgres':
                            # Prefer provider-reported PK if it's a single column.
                            try:
                                if len(pk_idxs) == 1:
                                    pk_gen_idx = int(pk_idxs[0])
                            except Exception:
                                pk_gen_idx = None

                            # Fallback: if provider didn't report PKs, try common names.
                            if pk_gen_idx is None:
                                try:
                                    for candidate in ('gid', 'id', 'fid', 'objectid'):
                                        for i in range(fields.count()):
                                            if str(fields.at(i).name() or '').strip().lower() == candidate:
                                                pk_gen_idx = i
                                                break
                                        if pk_gen_idx is not None:
                                            break
                                except Exception:
                                    pk_gen_idx = None

                            # Only auto-generate if the PK field looks integer-like.
                            if pk_gen_idx is not None:
                                try:
                                    fld = fields.at(int(pk_gen_idx))
                                    type_name = str(getattr(fld, 'typeName', lambda: '')() or '').strip().lower()
                                    int_like = any(t in type_name for t in ('int', 'serial', 'bigserial', 'int4', 'int8'))
                                    if not int_like:
                                        pk_gen_idx = None
                                except Exception:
                                    pk_gen_idx = None

                            if pk_gen_idx is not None:
                                try:
                                    maxv = lyr.maximumValue(int(pk_gen_idx))
                                    pk_counter = int(maxv) if maxv is not None else 0
                                except Exception:
                                    pk_counter = 0

                        if not lyr.isEditable():
                            lyr.startEditing()

                        for feat_el in features_to_insert:
                            feat = QgsFeature(fields)
                            # Read child elements as properties.
                            for prop_el in list(feat_el):
                                pname = _strip_ns(prop_el.tag)
                                if not pname:
                                    continue
                                low = pname.lower()
                                if low in ('geometry', 'geom', 'the_geom'):
                                    geom = _geometry_from_value_element(prop_el)
                                    if geom is not None:
                                        feat.setGeometry(geom)
                                    continue

                                # Never set PK columns on insert.
                                if low in pk_names:
                                    continue

                                idx = name_to_idx.get(pname)
                                if idx is None:
                                    idx = safe_to_idx.get(pname)
                                if idx is None:
                                    continue
                                fld = fields.at(idx)
                                val = _coerce_attr_value(fld, prop_el.text)
                                feat.setAttribute(idx, val)

                            # Default behavior: unset provider PK attributes so the datasource can generate them.
                            # Exception: for PostGIS layers with a required PK but no DEFAULT, synthesize an integer PK.
                            try:
                                for i in pk_idxs:
                                    ii = int(i)
                                    if 0 <= ii < fields.count():
                                        feat.setAttribute(ii, None)
                            except Exception:
                                pass

                            if provider_type == 'postgres' and pk_gen_idx is not None:
                                try:
                                    cur = feat.attribute(int(pk_gen_idx))
                                except Exception:
                                    cur = None
                                if cur in (None, ''):
                                    try:
                                        if pk_counter is None:
                                            pk_counter = 0
                                        pk_counter += 1
                                        feat.setAttribute(int(pk_gen_idx), int(pk_counter))
                                    except Exception:
                                        pass

                            ok = lyr.addFeature(feat)
                            if ok:
                                inserted += 1
                            else:
                                dbg = _layer_debug_info(lyr)
                                extra = _layer_commit_error_details(lyr)
                                msg = 'Insert addFeature failed'
                                if dbg:
                                    msg += f" ({dbg})"
                                if extra:
                                    msg += ': ' + ' | '.join(extra)
                                errors.append(msg)

                        if not lyr.commitChanges():
                            extra = _layer_commit_error_details(lyr)
                            msg = 'Insert commit failed'
                            dbg = _layer_debug_info(lyr)
                            if dbg:
                                msg += f" ({dbg})"
                            if extra:
                                msg += ': ' + ' | '.join(extra)
                            errors.append(msg)
                            try:
                                lyr.rollBack()
                            except Exception:
                                pass
                        else:
                            # Collect real FIDs after successful commit.
                            # The provider now has the definitive IDs.
                            try:
                                safe_type = safe_xml_name(local_type)
                                fc = lyr.featureCount()
                                if fc > 0:
                                    req = QgsFeatureRequest()
                                    req.setFlags(QgsFeatureRequest.NoGeometry)
                                    req.setLimit(inserted)
                                    # Sort descending by fid to get the latest inserted features
                                    try:
                                        req.addOrderBy('$id', False)
                                    except Exception:
                                        pass
                                    count = 0
                                    for f in lyr.getFeatures(req):
                                        fid = f.id()
                                        if fid is not None and int(fid) >= 0:
                                            inserted_fids.append(f"{safe_type}.{int(fid)}")
                                            count += 1
                                            if count >= inserted:
                                                break
                            except Exception:
                                pass
                    except Exception as e:
                        errors.append('Insert failed: ' + str(e))
                    continue

            # Build transaction response.
            # Qtiler advertises WFS 1.1.0 in capabilities. QGIS expects a 1.1-style TransactionResponse.
            # Keep a small compatibility fallback to WFS 1.0.0 root element if client requested 1.0.x.
            req_version = None
            try:
                req_version = root.attrib.get('version') or root.attrib.get('VERSION')
            except Exception:
                req_version = None
            req_version = str(req_version or '').strip()
            is_v10 = req_version.startswith('1.0')

            parts = []
            parts.append('<?xml version="1.0" encoding="UTF-8"?>')
            if is_v10:
                root_name = 'wfs:WFS_TransactionResponse'
            else:
                root_name = 'wfs:TransactionResponse'

            parts.append(
                f'<{root_name} '
                'xmlns:wfs="http://www.opengis.net/wfs" '
                'xmlns:ogc="http://www.opengis.net/ogc" '
                'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
                + (f'version="{esc_xml(req_version)}"' if req_version else 'version="1.1.0"')
                + '>'
            )

            parts.append('<wfs:TransactionSummary>')
            parts.append(f'<wfs:totalInserted>{inserted}</wfs:totalInserted>')
            parts.append(f'<wfs:totalUpdated>{updated}</wfs:totalUpdated>')
            parts.append(f'<wfs:totalDeleted>{deleted}</wfs:totalDeleted>')
            parts.append('</wfs:TransactionSummary>')

            if inserted_fids:
                parts.append('<wfs:InsertResults>')
                for fid in inserted_fids[:1000]:
                    parts.append('<wfs:Feature>')
                    parts.append('<ogc:FeatureId fid="' + esc_xml(str(fid)) + '"/>')
                    parts.append('</wfs:Feature>')
                parts.append('</wfs:InsertResults>')

            # Provide a basic status node that QGIS can parse.
            parts.append('<wfs:TransactionResults>')
            parts.append('<wfs:Action>')
            if errors:
                parts.append('<wfs:Status><wfs:FAILED/></wfs:Status>')
                for msg in errors[:10]:
                    parts.append('<wfs:Message>' + esc_xml(str(msg)) + '</wfs:Message>')
            else:
                parts.append('<wfs:Status><wfs:SUCCESS/></wfs:Status>')
            parts.append('</wfs:Action>')
            parts.append('</wfs:TransactionResults>')

            parts.append(f'</{root_name}>')

            os.makedirs(os.path.dirname(output_file), exist_ok=True)
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(''.join(parts))
            return { 'status': 'success', 'file': output_file, 'inserted': inserted, 'updated': updated, 'deleted': deleted, 'errors': errors }

        
        # --- Print action -----------------------------------------------------
        if action in ('list_print_layouts', 'project_settings'):
            from qgis.core import QgsLayoutItemMap, QgsLayoutItemLabel

            layouts = []
            for layout in proj.layoutManager().layouts():
                if not layout:
                    continue

                width = 0.0
                height = 0.0
                try:
                    page = layout.pageCollection().page(0)
                    if page:
                        page_size = page.pageSize()
                        width = float(page_size.width())
                        height = float(page_size.height())
                except Exception:
                    pass

                map_item = layout.referenceMap()
                if not map_item:
                    for item in layout.items():
                        if isinstance(item, QgsLayoutItemMap):
                            map_item = item
                            break

                map_meta = None
                if map_item:
                    try:
                        from qgis.core import QgsUnitTypes

                        def _to_mm(val, unit):
                            v = float(val)
                            if unit == QgsUnitTypes.LayoutCentimeters:
                                return v * 10.0
                            elif unit == QgsUnitTypes.LayoutMeters:
                                return v * 1000.0
                            elif unit == QgsUnitTypes.LayoutInches:
                                return v * 25.4
                            elif unit == QgsUnitTypes.LayoutPoints:
                                return v * 25.4 / 72.0
                            return v  # LayoutMillimeters or unknown

                        size = map_item.sizeWithUnits()
                        map_w = _to_mm(size.width(), size.units())
                        map_h = _to_mm(size.height(), size.units())

                        try:
                            pos = map_item.pagePositionWithUnits()
                            map_x = _to_mm(pos.x(), pos.units())
                            map_y = _to_mm(pos.y(), pos.units())
                        except Exception:
                            map_x, map_y = 0.0, 0.0

                        # Last resort: if still zero, fall back to page size
                        if map_w == 0.0 or map_h == 0.0:
                            map_w = map_w or width
                            map_h = map_h or height

                        map_meta = {
                            'name': map_item.id() or 'map0',
                            'x': map_x,
                            'y': map_y,
                            'width': map_w,
                            'height': map_h
                        }
                    except Exception:
                        map_meta = {
                            'name': map_item.id() or 'map0',
                            'x': 0.0,
                            'y': 0.0,
                            'width': width,
                            'height': height
                        }

                labels = []
                for item in layout.items():
                    if isinstance(item, QgsLayoutItemLabel):
                        item_id = item.id()
                        if item_id:
                            labels.append(str(item_id))

                layouts.append({
                    'name': str(layout.name()),
                    'width': width,
                    'height': height,
                    'map': map_meta,
                    'labels': labels
                })

            return {'status': 'success', 'layouts': layouts}

        if action in ('print_layout', 'getprint'):
            from qgis.core import QgsLayoutExporter, QgsLayoutItemLabel, QgsLayoutItemMap
            
            output_file = params.get('output_file')
            layout_name = params.get('layout_name') or params.get('template')
            bbox_list = params.get('bbox')
            layers_list = params.get('layers')
            crs_raw = params.get('crs') or params.get('srs')
            map_name = params.get('map_name')
            rotation = params.get('rotation')
            dpi = params.get('dpi')
            labels_dict = params.get('labels') or {}
            
            if not output_file:
                raise ValueError('Falta output_file')
            if not layout_name:
                raise ValueError('Falta layout_name (TEMPLATE)')
            if not bbox_list or len(bbox_list) != 4:
                raise ValueError('Falta bbox valido')
                
            layout = proj.layoutManager().layoutByName(str(layout_name))
            if not layout:
                target_layout = str(layout_name).strip().lower()
                for candidate_layout in proj.layoutManager().layouts():
                    try:
                        if str(candidate_layout.name()).strip().lower() == target_layout:
                            layout = candidate_layout
                            break
                    except Exception:
                        continue
            if not layout:
                raise ValueError('Plantilla no encontrada: ' + str(layout_name))
                
            rect = QgsRectangle(*bbox_list)
            map_item = layout.referenceMap()
            if not map_item and map_name:
                target_map = str(map_name).strip().lower()
                for item in layout.items():
                    if not isinstance(item, QgsLayoutItemMap):
                        continue
                    item_names = [item.id()]
                    try:
                        item_names.append(item.displayName())
                    except Exception:
                        pass
                    if any(str(name or '').strip().lower() == target_map for name in item_names):
                        map_item = item
                        break
            if not map_item:
                for item in layout.items():
                    if isinstance(item, QgsLayoutItemMap):
                        map_item = item
                        break

            if map_item:
                map_item.setExtent(rect)
                if crs_raw:
                    crs_cand = QgsCoordinateReferenceSystem(crs_raw.strip())
                    if crs_cand.isValid():
                        map_item.setCrs(crs_cand)
                try:
                    rotation_num = float(rotation)
                    if rotation_num == rotation_num:
                        map_item.setMapRotation(rotation_num)
                except Exception:
                    pass
                        
                if isinstance(layers_list, list) and layers_list:
                    render_layers = []
                    for lname in layers_list:
                        lyr = None
                        matches = proj.mapLayersByName(str(lname))
                        if matches: 
                            lyr = matches[0]
                        else:
                            if str(lname) in proj.mapLayers():
                                lyr = proj.mapLayers()[str(lname)]
                        if lyr:
                            render_layers.append(lyr)
                    
                    if render_layers:
                        map_item.setLayers(render_layers)
                        map_item.setKeepLayerSet(True)
            
            lower_labels = {str(k).lower(): v for k, v in labels_dict.items()}
            for item in layout.items():
                if isinstance(item, QgsLayoutItemLabel):
                    iid = item.id()
                    if iid:
                        direct = labels_dict.get(iid)
                        if direct is None:
                            direct = lower_labels.get(str(iid).lower())
                        if direct is not None:
                            item.setText(str(direct))
                        
            exporter = QgsLayoutExporter(layout)
            settings = QgsLayoutExporter.PdfExportSettings()
            if dpi:
                try:
                    settings.dpi = int(dpi)
                except Exception:
                    pass
            
            os.makedirs(os.path.dirname(output_file), exist_ok=True)
            res = exporter.exportToPdf(output_file, settings)
            if res == QgsLayoutExporter.Success:
                return {'status': 'success', 'file': output_file}
            else:
                raise ValueError('Fallo al exportar el PDF, error code: ' + str(res))

        if action in ('export_dxf', 'dxf_export'):
            from qgis.core import QgsDxfExport
            from qgis.PyQt.QtCore import QFile

            output_file = params.get('output_file')
            layers_list = params.get('layers')
            crs_raw = params.get('crs') or params.get('srs')
            bbox_list = params.get('bbox')
            scale = params.get('scale') or params.get('symbology_scale') or 1000

            if not output_file:
                raise ValueError('Falta output_file')

            requested_layers = []
            if isinstance(layers_list, list):
                requested_layers = [str(v).strip() for v in layers_list if str(v).strip()]
            elif layers_list:
                requested_layers = [v.strip() for v in str(layers_list).split(',') if v.strip()]

            selected_layers = []
            if requested_layers:
                by_id = proj.mapLayers()
                for lname in requested_layers:
                    layer = by_id.get(lname)
                    if not layer:
                        matches = proj.mapLayersByName(str(lname))
                        if matches:
                            layer = matches[0]
                    if layer and _is_vector_layer(layer):
                        selected_layers.append(layer)
            else:
                for layer in proj.mapLayers().values():
                    if _is_vector_layer(layer):
                        selected_layers.append(layer)

            if not selected_layers:
                raise ValueError('No hay capas vectoriales para exportar a DXF')

            dxf_layers = []
            for layer in selected_layers:
                try:
                    dxf_layers.append(QgsDxfExport.DxfLayer(layer))
                except Exception:
                    continue
            if not dxf_layers:
                raise ValueError('No se pudieron preparar capas DXF')

            exporter = QgsDxfExport()
            exporter.addLayers(dxf_layers)
            try:
                exporter.setLayerTitleAsName(True)
            except Exception:
                pass
            try:
                scale_num = float(scale)
                if scale_num > 0:
                    exporter.setSymbologyScale(scale_num)
            except Exception:
                pass
            if crs_raw:
                try:
                    crs_cand = QgsCoordinateReferenceSystem(str(crs_raw).strip())
                    if crs_cand.isValid():
                        exporter.setDestinationCrs(crs_cand)
                except Exception:
                    pass
            if bbox_list and len(bbox_list) == 4:
                try:
                    exporter.setExtent(QgsRectangle(*bbox_list))
                except Exception:
                    pass

            os.makedirs(os.path.dirname(output_file), exist_ok=True)
            dxf_file = QFile(output_file)
            res = exporter.writeToFile(dxf_file, 'UTF-8')
            success_code = 0
            try:
                success_code = int(QgsDxfExport.ExportResult.Success)
            except Exception:
                success_code = 0
            if int(res) == success_code:
                return {'status': 'success', 'file': output_file, 'layers': [str(layer.name()) for layer in selected_layers]}
            raise ValueError('Fallo al exportar DXF, error code: ' + str(res))

        # --- Layer fields/attributes ---------------------------------------
        if action == 'layer_fields':
            layer_name = params.get('layer')
            if not layer_name:
                raise ValueError('Falta layer')
            matches = proj.mapLayersByName(str(layer_name))
            if not matches:
                return {'status': 'success', 'fields': []}
            lyr = matches[0]
            if not _is_vector_layer(lyr):
                return {'status': 'success', 'fields': []}
            fields_out = []
            try:
                for f in lyr.fields():
                    try:
                        fields_out.append({
                            'name': f.name(),
                            'type': f.typeName() if hasattr(f, 'typeName') else str(f.type())
                        })
                    except Exception:
                        continue
            except Exception:
                pass
            geom_str = ''
            try:
                # geometryType returns 0=Point, 1=Line, 2=Polygon
                gt = lyr.geometryType()
                geom_str = {0: 'Point', 1: 'Line', 2: 'Polygon'}.get(int(gt), 'Unknown')
            except Exception:
                pass
            return {'status': 'success', 'fields': fields_out, 'geometryType': geom_str}

        # --- Layer unique values for a given field -------------------------
        if action == 'layer_values':
            layer_name = params.get('layer')
            field_name = params.get('field')
            if not layer_name or not field_name:
                raise ValueError('Falta layer/field')
            limit = int(params.get('limit') or 500)
            matches = proj.mapLayersByName(str(layer_name))
            if not matches:
                return {'status': 'success', 'values': []}
            lyr = matches[0]
            if not _is_vector_layer(lyr):
                return {'status': 'success', 'values': []}
            values = []
            try:
                idx = lyr.fields().indexFromName(str(field_name))
                if idx < 0:
                    return {'status': 'success', 'values': []}
                # uniqueValues returns a set; cap to limit
                seen = lyr.uniqueValues(idx, limit)
                for v in seen:
                    if v is None:
                        continue
                    try:
                        values.append(str(v))
                    except Exception:
                        continue
                # Sort case-insensitive, numeric-aware best-effort
                try:
                    values.sort(key=lambda s: (0, float(s)) if s.replace('.', '', 1).replace('-', '', 1).isdigit() else (1, s.lower()))
                except Exception:
                    values.sort()
            except Exception:
                pass
            return {'status': 'success', 'values': values[:limit]}

        # --- Extract layer style (QGIS renderer -> JSON) -------------------
        # Used by Qtiler2qwc to publish vector layers as WFS in QWC2 with a
        # JSON style approximating the original QGIS rendering. Only simple
        # renderer types are supported. Unsupported renderers return
        # { "status": "success", "supported": false, "reason": "..." } so
        # callers can fall back to WMS automatically.
        if action in ('extract_layer_style', 'extract_style'):
            layer_name = params.get('layer') or params.get('type_name')
            if not layer_name:
                raise ValueError('Falta layer')
            matches = proj.mapLayersByName(str(layer_name))
            if not matches:
                raise ValueError('Capa no encontrada')
            lyr = matches[0]
            if not _is_vector_layer(lyr):
                return {"status": "success", "supported": False, "reason": "not_vector"}

            def _qcolor_to_rgba(c):
                try:
                    return [int(c.red()), int(c.green()), int(c.blue()), int(c.alpha())]
                except Exception:
                    return [128, 128, 128, 255]

            def _brush_style_to_fill_pattern(value):
                raw = '' if value is None else str(value)
                low = raw.lower()
                numeric = None
                try:
                    numeric = int(value)
                except Exception:
                    m_num = re.search(r'(\d+)', raw)
                    if m_num:
                        try:
                            numeric = int(m_num.group(1))
                        except Exception:
                            numeric = None

                dense_values = set()
                diag_values = set()
                cross_values = set()
                dots_values = set()
                if Qt is not None:
                    for attr_name, bucket in (
                        ('Dense1Pattern', dense_values), ('Dense2Pattern', dense_values), ('Dense3Pattern', dense_values),
                        ('Dense4Pattern', dense_values), ('Dense5Pattern', dense_values), ('Dense6Pattern', dense_values), ('Dense7Pattern', dense_values),
                        ('FDiagPattern', diag_values), ('BDiagPattern', diag_values), ('DiagCrossPattern', cross_values),
                        ('HorPattern', cross_values), ('VerPattern', cross_values)
                    ):
                        try:
                            bucket.add(int(getattr(Qt, attr_name)))
                        except Exception:
                            pass

                if 'nobrush' in low:
                    return 'outline'
                if any(token in low for token in ('dense', 'dot', 'pointpatternfill', 'point pattern')):
                    return 'dots'
                if any(token in low for token in ('diagcross', 'cross', 'horpattern', 'verpattern')):
                    return 'cross'
                if any(token in low for token in ('fdiag', 'bdiag', 'linepatternfill', 'line pattern', 'svgfill', 'rasterfill')):
                    return 'diagonal'
                if numeric is not None:
                    if numeric in dots_values or numeric in dense_values:
                        return 'dots'
                    if numeric in cross_values:
                        return 'cross'
                    if numeric in diag_values:
                        return 'diagonal'
                return 'solid'

            def _symbol_to_dict(sym):
                if sym is None:
                    return None
                out = {"opacity": 1.0}
                try:
                    out["opacity"] = float(sym.opacity())
                except Exception:
                    pass
                try:
                    color = sym.color()
                    out["color"] = _qcolor_to_rgba(color)
                except Exception:
                    out["color"] = [128, 128, 128, 255]
                # Geometry-type-specific extras
                try:
                    symbol_layers = list(sym.symbolLayers()) if sym.symbolLayerCount() > 0 else []
                except Exception:
                    symbol_layers = []
                sl = symbol_layers[0] if symbol_layers else None
                # Size for points
                try:
                    out["size"] = float(sym.size())
                except Exception:
                    pass
                # Stroke (outline) for polygons / markers
                try:
                    if sl is not None:
                        if hasattr(sl, 'strokeColor'):
                            out["strokeColor"] = _qcolor_to_rgba(sl.strokeColor())
                        if hasattr(sl, 'strokeWidth'):
                            out["strokeWidth"] = float(sl.strokeWidth())
                        if hasattr(sl, 'penStyle'):
                            try:
                                out["strokeStyle"] = str(sl.penStyle())
                            except Exception:
                                pass
                except Exception:
                    pass
                # Fill / hatch hints for polygons and patterned fills.
                try:
                    detected_pattern = 'solid'
                    for symbol_layer in symbol_layers:
                        if symbol_layer is None:
                            continue
                        layer_class = ''
                        try:
                            layer_class = symbol_layer.__class__.__name__
                        except Exception:
                            layer_class = ''
                        layer_low = layer_class.lower()

                        if hasattr(symbol_layer, 'brushStyle'):
                            try:
                                detected_pattern = _brush_style_to_fill_pattern(symbol_layer.brushStyle())
                            except Exception:
                                pass

                        if detected_pattern == 'solid':
                            if 'linepatternfill' in layer_low:
                                detected_pattern = 'diagonal'
                            elif 'pointpatternfill' in layer_low:
                                detected_pattern = 'dots'
                            elif 'svgfill' in layer_low or 'rasterfill' in layer_low:
                                detected_pattern = 'dots'

                        if detected_pattern != 'solid':
                            break

                    if detected_pattern != 'solid':
                        out["fillPattern"] = detected_pattern
                except Exception:
                    pass
                # Width for line symbols
                try:
                    if hasattr(sym, 'width'):
                        out["width"] = float(sym.width())
                except Exception:
                    pass
                return out

            renderer = None
            try:
                renderer = lyr.renderer() if hasattr(lyr, 'renderer') else None
            except Exception:
                renderer = None
            if renderer is None:
                return {"status": "success", "supported": False, "reason": "no_renderer"}

            renderer_type = ''
            try:
                renderer_type = str(renderer.type())
            except Exception:
                pass

            geom = _geometry_type_name(lyr) or ''
            result_style = {"geometryType": geom, "type": renderer_type}

            if renderer_type == 'singleSymbol':
                try:
                    sym = renderer.symbol()
                    result_style["symbol"] = _symbol_to_dict(sym)
                except Exception:
                    return {"status": "success", "supported": False, "reason": "single_symbol_read_failed"}
                return {"status": "success", "supported": True, "style": result_style}

            if renderer_type == 'categorizedSymbol':
                try:
                    attr = renderer.classAttribute() if hasattr(renderer, 'classAttribute') else ''
                    cats = renderer.categories() if hasattr(renderer, 'categories') else []
                except Exception:
                    return {"status": "success", "supported": False, "reason": "categorized_read_failed"}
                # Reject if classAttribute is an expression (contains operators / parens)
                attr_str = str(attr or '')
                if any(ch in attr_str for ch in ('(', '"', "'", ' ')):
                    return {"status": "success", "supported": False, "reason": "categorized_expression"}
                category_list = []
                default_symbol = None
                for cat in cats or []:
                    try:
                        value = cat.value()
                        label = cat.label()
                        sym_dict = _symbol_to_dict(cat.symbol())
                    except Exception:
                        continue
                    # Convert QVariant to plain Python where possible
                    try:
                        # PyQt: QVariant has .value()
                        if hasattr(value, 'value') and callable(value.value):
                            value = value.value()
                    except Exception:
                        pass
                    is_null_or_empty = value is None or (isinstance(value, str) and value == '')
                    if is_null_or_empty:
                        default_symbol = sym_dict
                        continue
                    category_list.append({
                        "value": value,
                        "label": str(label or ''),
                        "symbol": sym_dict
                    })
                if not category_list and default_symbol is None:
                    return {"status": "success", "supported": False, "reason": "categorized_empty"}
                result_style["attribute"] = attr_str
                result_style["categories"] = category_list
                if default_symbol is not None:
                    result_style["default"] = default_symbol
                return {"status": "success", "supported": True, "style": result_style}

            return {"status": "success", "supported": False, "reason": "unsupported_renderer:" + renderer_type}

        # --- Legend action -------------------------------------------------
        if action in ('legend', 'getlegendgraphic'):
            if not output_file:
                raise ValueError('Falta output_file')
            layer_name = params.get('layer')
            if not layer_name:
                # accept LAYERS list, use first
                req_layers = params.get('layers')
                if isinstance(req_layers, list) and req_layers:
                    layer_name = req_layers[0]
            if not layer_name:
                raise ValueError('Falta layer')

            matches = proj.mapLayersByName(str(layer_name))
            if not matches:
                raise ValueError('Capa no encontrada')
            layer_obj = matches[0]

            if QImage is None or QPainter is None:
                raise ValueError('Legend rendering unavailable (Qt GUI classes missing)')

            # Build legend items (vector best-effort)
            legend_items = []
            try:
                renderer = layer_obj.renderer() if hasattr(layer_obj, 'renderer') else None
                if renderer and hasattr(renderer, 'legendSymbolItems'):
                    for item in renderer.legendSymbolItems() or []:
                        try:
                            label = item.label() if hasattr(item, 'label') else ''
                            symbol = item.symbol() if hasattr(item, 'symbol') else None
                            legend_items.append({ 'label': str(label or ''), 'symbol': symbol })
                        except Exception:
                            continue
            except Exception:
                legend_items = []

            # Fallback: single title row
            if not legend_items:
                legend_items = [{ 'label': str(layer_obj.name()), 'symbol': None }]

            row_h = 26
            icon_size = 20
            margin = 10
            width_px = max(240, int(params.get('width') or 260))
            height_px = margin * 2 + row_h * len(legend_items)

            qimg_format = getattr(QImage.Format, "Format_ARGB32", None)
            if qimg_format is None:
                qimg_format = getattr(QImage, "Format_ARGB32")
            img = QImage(int(width_px), int(height_px), qimg_format)
            if transparent:
                img.fill(0)
            else:
                img.fill(QColor(255, 255, 255, 255))

            painter = QPainter(img)
            try:
                if QFont is not None:
                    try:
                        painter.setFont(QFont('Arial', 10))
                    except Exception:
                        pass
                y = margin
                for entry in legend_items:
                    label = entry.get('label') or ''
                    symbol = entry.get('symbol')
                    # draw icon
                    if symbol is not None and QgsSymbolLayerUtils is not None:
                        try:
                            pm = QgsSymbolLayerUtils.symbolPreviewPixmap(symbol, QSize(icon_size, icon_size))
                            painter.drawPixmap(margin, y + 3, pm)
                        except Exception:
                            pass
                    # draw label
                    try:
                        painter.setPen(QColor(0, 0, 0, 255))
                        painter.drawText(margin + icon_size + 10, y + 18, str(label))
                    except Exception:
                        pass
                    y += row_h
            finally:
                try:
                    painter.end()
                except Exception:
                    pass

            _atomic_save_with_format(img, output_file, 'PNG')
            return {"status": "success", "file": output_file}

        # --- FeatureInfo action -------------------------------------------
        if action in ('feature_info', 'getfeatureinfo'):
            if QgsPointXY is None or QgsFeatureRequest is None:
                raise ValueError('FeatureInfo unavailable (QGIS identify helpers missing)')
            crs_raw = params.get('crs') or params.get('tile_crs')
            if isinstance(crs_raw, str) and crs_raw.strip():
                candidate = QgsCoordinateReferenceSystem(crs_raw.strip())
                if not candidate.isValid():
                    raise ValueError('CRS invalido')
            else:
                candidate = proj.crs()
            map_crs = candidate

            if not bbox_list or len(bbox_list) != 4:
                raise ValueError('Falta bbox')
            rect = QgsRectangle(*bbox_list)

            i = params.get('i')
            j = params.get('j')
            try:
                i = int(i)
                j = int(j)
            except Exception:
                raise ValueError('Falta i/j')
            if i < 0 or j < 0:
                raise ValueError('i/j invalidos')

            w = int(width)
            h = int(height)
            if w <= 0 or h <= 0:
                raise ValueError('width/height invalidos')

            # Pixel -> map coordinate (origin top-left)
            mupp_x = rect.width() / float(w)
            mupp_y = rect.height() / float(h)
            x = rect.xMinimum() + (float(i) + 0.5) * mupp_x
            y = rect.yMaximum() - (float(j) + 0.5) * mupp_y
            pt = QgsPointXY(x, y)

            tol = max(abs(mupp_x), abs(mupp_y)) * 2.0
            hit = QgsRectangle(x - tol, y - tol, x + tol, y + tol)

            filter_geom_raw = params.get('filter_geom')
            if isinstance(filter_geom_raw, str) and filter_geom_raw.strip():
                try:
                    nums = []
                    for m in re.finditer(r'(-?\d+(?:\.\d+)?)', filter_geom_raw):
                        nums.append(float(m.group(1)))
                    if len(nums) >= 4 and len(nums) % 2 == 0:
                        xs = nums[0::2]
                        ys = nums[1::2]
                        minx = min(xs)
                        miny = min(ys)
                        maxx = max(xs)
                        maxy = max(ys)
                        if maxx > minx and maxy > miny:
                            hit = QgsRectangle(minx, miny, maxx, maxy)
                except Exception:
                    pass

            query_layers = params.get('query_layers')
            if not isinstance(query_layers, list):
                query_layers = []
            feature_count = params.get('feature_count')
            try:
                feature_count = int(feature_count)
            except Exception:
                feature_count = 10
            if feature_count < 1:
                feature_count = 1
            if feature_count > 50:
                feature_count = 50

            results = []
            for lname in query_layers:
                try:
                    matches = proj.mapLayersByName(str(lname))
                    if not matches:
                        continue
                    lyr = matches[0]

                    hit_for_layer = hit
                    pt_for_layer = pt
                    try:
                        if QgsCoordinateTransform is not None and hasattr(lyr, 'crs'):
                            layer_crs = lyr.crs()
                            if layer_crs and layer_crs.isValid() and map_crs and map_crs.isValid() and layer_crs.authid() != map_crs.authid():
                                trf = QgsCoordinateTransform(map_crs, layer_crs, proj)
                                try:
                                    pt_for_layer = trf.transform(pt)
                                except Exception:
                                    pt_for_layer = pt
                                try:
                                    hit_for_layer = trf.transformBoundingBox(hit)
                                except Exception:
                                    hit_for_layer = hit
                    except Exception:
                        hit_for_layer = hit
                        pt_for_layer = pt

                    layer_out = { 'name': str(lname), 'features': [] }
                    # vector layers only (best-effort)
                    try:
                        if hasattr(lyr, 'getFeatures') and hasattr(lyr, 'fields'):
                            req = QgsFeatureRequest().setFilterRect(hit_for_layer).setLimit(feature_count)
                            fields = lyr.fields()
                            names = [fields.at(i).name() for i in range(fields.count())]
                            for feat in lyr.getFeatures(req):
                                props = {}
                                attrs = feat.attributes()
                                for idx, fname in enumerate(names):
                                    try:
                                        val = attrs[idx]
                                        # Normalize Qt/QGIS values to JSON-safe Python scalars.
                                        try:
                                            if hasattr(val, 'toPyObject'):
                                                val = val.toPyObject()
                                        except Exception:
                                            pass
                                        try:
                                            if hasattr(val, 'isNull') and callable(getattr(val, 'isNull')) and val.isNull():
                                                val = None
                                        except Exception:
                                            pass
                                        if isinstance(val, (bytes, bytearray)):
                                            try:
                                                val = bytes(val).decode('utf-8', errors='replace')
                                            except Exception:
                                                val = str(val)
                                        elif val is not None and not isinstance(val, (str, int, float, bool, list, dict)):
                                            try:
                                                json.dumps(val)
                                            except Exception:
                                                val = str(val)
                                        props[fname] = val
                                    except Exception:
                                        props[fname] = None
                                geom_wkt = None
                                try:
                                    if feat.hasGeometry() and feat.geometry():
                                        geom_wkt = feat.geometry().asWkt()
                                except Exception:
                                    geom_wkt = None
                                layer_out['features'].append({
                                    'id': int(feat.id()) if hasattr(feat, 'id') else None,
                                    'properties': props,
                                    'geometryWkt': geom_wkt
                                })
                    except Exception:
                        pass

                    if layer_out['features']:
                        results.append(layer_out)
                except Exception:
                    continue

            info_format = params.get('info_format') or 'application/json'
            if isinstance(info_format, str):
                info_format = info_format.strip().lower()
            else:
                info_format = 'application/json'

            data = {
                'crs': str(crs_raw or ''),
                'point': { 'x': x, 'y': y },
                'bbox': bbox_list,
                'layers': results
            }
            if info_format == 'text/plain':
                lines = []
                for layer_out in results:
                    lines.append(f"Layer: {layer_out.get('name')}")
                    for f in layer_out.get('features', []):
                        lines.append(f"  Feature {f.get('id')}")
                        props = f.get('properties') or {}
                        for k, v in props.items():
                            lines.append(f"    {k}: {v}")
                return {"status": "success", "text": "\n".join(lines), "data": data}
            return {"status": "success", "data": data}
        
        # Resolver capas
        layers_to_render = []
        if params.get('theme'):
            # TODO: soporte explícito de map themes (requiere resolver layer order + overrides por tema).
            # Fallback: renderizar el orden de capas del proyecto.
            layers_to_render = []
        else:
            req_layers = params.get('layers')
            if isinstance(req_layers, list) and req_layers:
                for name in req_layers:
                    if not name:
                        continue
                    try:
                        matches = proj.mapLayersByName(str(name)) or _find_layer_loose(proj, str(name))
                        if matches:
                            layers_to_render.append(matches[0] if isinstance(matches, list) else matches)
                    except Exception:
                        continue
            elif params.get('layer'):
                lname = str(params['layer'])
                l = proj.mapLayersByName(lname)
                if l:
                    layers_to_render = [l[0]]
                else:
                    found = _find_layer_loose(proj, lname)
                    if found:
                        layers_to_render = [found]

        if not layers_to_render and not params.get('theme'):
            raise ValueError("Capa/Tema no encontrado")

        # Configurar MapSettings
        settings = QgsMapSettings()
        
        # Si es tema, intentar usarlo
        if params.get('theme'):
             # En QGIS 3.x settings.setLayerStyleOverrides no es suficiente para temas completos
             # Lo ideal es resolver la lista de capas y estilos del tema.
             # Si tu _resolve_theme_layers funciona, úsala aquí.
             # Fallback: renderizar layers especificas
             pass
        
        if layers_to_render:
            settings.setLayers(layers_to_render)
        else:
            # Si no hay layers explicitas, renderizar todo el proyecto (útil para temas globales)
            settings.setLayers(proj.layerTreeRoot().layerOrder())

        # Render in tile CRS when provided (so bbox matches WMTS/XYZ grid).
        dest_crs = None
        crs_raw = params.get('crs') or params.get('tile_crs')
        if isinstance(crs_raw, str) and crs_raw.strip():
            try:
                candidate = QgsCoordinateReferenceSystem(crs_raw.strip())
                if candidate.isValid():
                    dest_crs = candidate
            except Exception:
                dest_crs = None
        if dest_crs is None:
            dest_crs = proj.crs()
        settings.setDestinationCrs(dest_crs)
        if transparent and save_fmt == "PNG":
            settings.setBackgroundColor(QColor(0, 0, 0, 0))
        else:
            settings.setBackgroundColor(QColor(255, 255, 255, 255))
        settings.setOutputSize(QSize(int(width), int(height)))
        
        if bbox_list:
            rect = QgsRectangle(*bbox_list)
            settings.setExtent(rect)

        # Renderizar
        # CustomPainterJob tends to be more reliable than ParallelJob in headless environments.
        img = None
        if QgsMapRendererCustomPainterJob is not None and QImage is not None and QPainter is not None:
            qimg_format = getattr(QImage.Format, "Format_ARGB32", None)
            if qimg_format is None:
                qimg_format = getattr(QImage, "Format_ARGB32")
            img = QImage(int(width), int(height), qimg_format)
            if transparent and save_fmt == "PNG":
                img.fill(0)
            else:
                img.fill(QColor(255, 255, 255, 255))
            painter = QPainter(img)
            try:
                job = QgsMapRendererCustomPainterJob(settings, painter)
                job.start()
                try:
                    # Available in most QGIS builds.
                    job.waitForFinished()
                except Exception:
                    loop = QEventLoop()
                    job.finished.connect(loop.quit)
                    loop.exec_()
            finally:
                try:
                    painter.end()
                except Exception:
                    pass
        else:
            job = QgsMapRendererParallelJob(settings)
            job.start()
            loop = QEventLoop()
            job.finished.connect(loop.quit)
            loop.exec_()
            img = job.renderedImage()

        if img is None:
            raise ValueError('Render failed: no image produced')

        _atomic_save_with_format(img, output_file, save_fmt)

        skip_white = str(os.environ.get("SKIP_WHITE_TILES", "0")).strip().lower() in ("1", "true", "yes")
        blank = _is_white_tile(img) if skip_white else False

        return {"status": "success", "file": output_file, "blank": blank}

    except Exception as e:
        return {"status": "error", "message": str(e), "trace": traceback.format_exc()}

# --- Bucle Principal ---
if __name__ == "__main__":
    sys.stderr.write("Worker QGIS iniciado. Esperando JSON...\n")
    sys.stdout.flush()
    
    while True:
        try:
            line = sys.stdin.readline()
            if not line: break
            
            req = json.loads(line)
            res = process_task(req)
            
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()
        except Exception as e:
            sys.stderr.write(f"Error bucle: {e}\n")
            sys.stdout.write(json.dumps({"status":"error", "message": "Loop error"}) + "\n")
            sys.stdout.flush()