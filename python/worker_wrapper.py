"""
worker_wrapper.py
Worker persistente para renderizado de teselas QGIS.
Mantiene el entorno QGIS cargado y procesa peticiones via stdin.
"""
import sys
import os
import json
import traceback
import math
from pathlib import Path

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

# Inicializar QGIS (una sola vez)
QgsApplication.setPrefixPath(QGIS_PREFIX, True)
qgs = QgsApplication([], False)
qgs.initQgis()

# --- Helpers ---
project_cache = {}

def get_project(path):
    if path in project_cache:
        return project_cache[path]
    
    if not os.path.exists(path):
        raise FileNotFoundError(f"Proyecto no encontrado: {path}")
        
    # Instanciamos QgsProject. 
    # Nota: QgsProject.instance() es singleton. Para workers seguros,
    # idealmente usaríamos instancias separadas si QGIS lo permite bien en threads,
    # pero aquí estamos en un proceso único secuencial.
    proj = QgsProject()
    proj.read(path)
    project_cache[path] = proj
    return proj

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

# --- Procesamiento ---
def process_task(params):
    try:
        project_path = params.get('project_path')
        if not project_path: raise ValueError("Falta project_path")
        
        proj = get_project(project_path)
        
        # Parámetros de render
        output_file = params.get('output_file')
        bbox_list = params.get('bbox') # [minx, miny, maxx, maxy]
        img_size = params.get('size', 256)
        
        # Resolver capas
        layers_to_render = []
        if params.get('theme'):
            # Implementar lógica de temas (simplificada aquí, copia tu _resolve_theme_layers si la necesitas)
            # Para este ejemplo, si es tema, renderizamos todo el proyecto con el tema activo
            # Ojo: mapSettings.setThemeName() existe en versiones recientes
            pass 
        elif params.get('layer'):
            l = proj.mapLayersByName(params['layer'])
            if l: layers_to_render = [l[0]]
        
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

        settings.setDestinationCrs(proj.crs()) # O params['crs'] si lo pasas
        settings.setBackgroundColor(QColor(0, 0, 0, 0))
        settings.setOutputSize(QSize(img_size, img_size))
        
        if bbox_list:
            rect = QgsRectangle(*bbox_list)
            settings.setExtent(rect)

        # Renderizar
        job = QgsMapRendererParallelJob(settings)
        job.start()
        
        loop = QEventLoop()
        job.finished.connect(loop.quit)
        loop.exec_()
        
        img = job.renderedImage()
        _atomic_save(img, output_file)
        
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