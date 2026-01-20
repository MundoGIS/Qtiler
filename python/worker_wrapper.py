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
    paths = [p for p in os.environ.get("PATH", "").split(";") if p]
    for pth in (OSGEO4W_BIN, qgis_bin):
        if pth and pth not in paths: paths.insert(0, pth)
    os.environ["PATH"] = ";".join(paths)
    try:
        if OSGEO4W_BIN and os.path.isdir(OSGEO4W_BIN): os.add_dll_directory(OSGEO4W_BIN)
        if os.path.isdir(qgis_bin): os.add_dll_directory(qgis_bin)
    except: pass

qgis_python = os.path.join(QGIS_PREFIX, "python")
if os.path.isdir(qgis_python) and qgis_python not in sys.path:
    sys.path.insert(0, qgis_python)

# --- Importar QGIS ---
try:
    from qgis.core import (
        QgsApplication, QgsProject, QgsMapSettings, 
        QgsMapRendererParallelJob, QgsRectangle, QgsCoordinateReferenceSystem
    )
    from qgis.PyQt.QtCore import QSize, QEventLoop
    from qgis.PyQt.QtGui import QColor
except ImportError as e:
    sys.stderr.write(f"ERROR IMPORTS QGIS: {e}\n")
    sys.exit(1)

# Optional extras for WMS legend / feature info (best-effort)
try:
    from qgis.core import QgsPointXY, QgsFeatureRequest
except Exception:
    QgsPointXY = None
    QgsFeatureRequest = None

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

# Inicializar QGIS (una sola vez)
QgsApplication.setPrefixPath(QGIS_PREFIX, True)
qgs = QgsApplication([], False)
qgs.initQgis()

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


def _geometry_to_gml_fragment(geom, srs_name=None, precision=17):
    """Return a GML geometry element as a string.

    NOTE: In QGIS 3.34 Python bindings, QgsGeometry does not expose asGml/asGml2/asGml3.
    The reliable path is QgsOgcUtils.geometryToGML() which returns a QDomElement.
    """
    if geom is None or QgsOgcUtils is None or QDomDocument is None:
        return None
    try:
        doc = QDomDocument()
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

def _geometry_from_value_element(value_el):
    if value_el is None:
        return None
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

        if action in ('wfs_describe', 'wfs_describefeaturetype'):
            type_name = params.get('type_name') or params.get('typename')
            output_file = params.get('output_file')
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
            xsd_parts.append(' xmlns:gml="http://www.opengis.net/gml"')
            xsd_parts.append(' targetNamespace="' + tns + '"')
            xsd_parts.append(' xmlns:tns="' + tns + '"')
            xsd_parts.append(' elementFormDefault="qualified" attributeFormDefault="unqualified">')
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
            start_index = params.get('start_index')
            env_default = os.getenv('WFS_DEFAULT_MAX_FEATURES')
            env_hard_limit = os.getenv('WFS_MAX_FEATURES_LIMIT')
            try:
                default_max = int(env_default) if env_default is not None else 1000
            except Exception:
                default_max = 1000
            if default_max < 1:
                default_max = 1
            try:
                hard_limit = int(env_hard_limit) if env_hard_limit is not None else 10000
            except Exception:
                hard_limit = 10000
            if hard_limit < 1:
                hard_limit = 1
            try:
                max_features = int(max_features) if max_features is not None else default_max
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
            if rect is not None:
                req = req.setFilterRect(rect)
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
            parts.append(' xmlns:wfs="http://www.opengis.net/wfs"')
            parts.append(' xmlns:gml="http://www.opengis.net/gml"')
            parts.append(' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"')
            parts.append(' xmlns:' + prefix + '="' + ns + '"')
            parts.append('>')
            for feat in lyr.getFeatures(req):
                try:
                    fid = None
                    try:
                        fid = int(feat.id())
                    except Exception:
                        fid = None
                    gml_id = f"{safe_type}.{fid}" if fid is not None else None
                    parts.append('<gml:featureMember>')
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
                            gml = _geometry_to_gml_fragment(geom, srs_name=srs_name, precision=17)
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
                    parts.append('</gml:featureMember>')
                except Exception:
                    continue
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
                                try:
                                    new_id = feat.id()
                                    if new_id is not None:
                                        inserted_fids.append(f"{safe_xml_name(local_type)}.{int(new_id)}")
                                except Exception:
                                    pass
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

            img = QImage(int(width_px), int(height_px), QImage.Format_ARGB32)
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
                                        props[fname] = attrs[idx]
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
                        matches = proj.mapLayersByName(str(name))
                        if matches:
                            layers_to_render.append(matches[0])
                    except Exception:
                        continue
            elif params.get('layer'):
                l = proj.mapLayersByName(params['layer'])
                if l:
                    layers_to_render = [l[0]]

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
            img = QImage(int(width), int(height), QImage.Format_ARGB32)
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
        
        return {"status": "success", "file": output_file}

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