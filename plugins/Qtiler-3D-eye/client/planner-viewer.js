const API_BASE = '/plugins/Qtiler-3D-eye';

try {
  localStorage.removeItem('qtiler3d_ion_token');
} catch (error) {
  console.warn('[Qtiler-3D-eye] Could not clear the legacy browser Ion token.', error);
}

// --- Estado Global de Medición (Adaptado de mgis-3d-planer) ---
let measureHandler = null;
let measurePoints = [];       // Puntos Cartesian3 de la medida actual
let measurePrimitives = [];   // Primitivas finales registradas
let measureEntities = [];     // Entidades finales (puntos, etiquetas)
let measureWindow = null;
let floatingMeasurePoint = null;
let activeMeasureShape = null;
let isMeasuring = false;
let measureType = 'distance';
let originalSelectedEntityDescriptor = null;

const params = new URLSearchParams(window.location.search);
const sceneId = params.get('scene') || params.get('project') || '';
const terrainPreviewId = params.get('terrain') || '';
const terrainAssetPreviewId = params.get('terrainAsset') || '';
const assetPreviewId = params.get('asset') || '';
const statusEl = document.getElementById('viewerStatus');
const titleEl = document.getElementById('viewerTitle');
const subtitleEl = document.getElementById('viewerSubtitle');
const logoEl = document.getElementById('viewerLogo');
const modulesEl = document.getElementById('moduleBar');
const toolButtons = document.getElementById('toolButtons');
const mapModeControl = document.getElementById('mapModeControl');
const layerPanel = document.getElementById('layerPanel');
const layerList = document.getElementById('layerList');
const terrainWarning = document.getElementById('terrainWarning');
const saveViewBtn = document.getElementById('saveViewBtn');
const toolPopup = document.getElementById('toolPopup');

let viewer;
let sketchEditor = null;
let routeSimulation = null;
let featureInfoHtml = null;
let dualMap = null;
let wfsEditor = null;
let modelPlacementHandler = null;
let modelPlacementPreview = null;
let placementAssets = [];
let placementCount = 0;
let placementPreviewLocation = null;
const runtimeItems = new Map();
let layerTab = 'layers';
let currentConfig = null;
let terrainSelectionSequence = 0;
let activeTerrainItem = null;
let orbitStop = null;
let activeToolHandler = null;
let activeSketch = null;
const measurementItems = [];
const sketchItems = [];
const lazyGltfState = { timer: null };
const LAZY_GLTF_MAX_VISIBLE = 120;
const LAZY_GLTF_BATCH_SIZE = 4;
const visibleWfsState = { timer: null, running: false, rerun: false, controllers: new Map(), lastKeyByLayer: new Map(), cacheByLayer: new Map() };
const VISIBLE_WFS_MAX_FEATURES = 650;
const VISIBLE_WFS_3D_MAX_FEATURES = 350;
const VISIBLE_WFS_GLTF_MAX_FEATURES = 150;
const VISIBLE_WFS_GLTF_FALLBACK_MAX_FEATURES = 150;

window.qtiler3dDebug = {
  runtimeItems,
  visibleWfsState,
  getWfsItems: () => Array.from(runtimeItems.values()).filter((item) => item.type === 'wfs').map((item) => ({ key: item.layer?.key, name: item.label, hasObject: !!item.object, loading: item.loading, visible: item.layer?.visible !== false })),
  forceWfs: () => updateVisibleWfsLayers(),
  currentViewBbox: () => currentViewBbox()
};

function setStatus(message, tone = '') {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
  statusEl.hidden = tone !== 'error';
}

async function waitForCesiumRuntime(timeoutMs = 12000) {
  const started = Date.now();
  while (!window.Cesium) {
    if (Date.now() - started > timeoutMs) throw new Error('Cesium runtime is not available');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return window.Cesium;
}

function viewerText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function enabledModules(modules = {}) {
  return Object.entries(modules).filter(([, enabled]) => enabled !== false).map(([key]) => key);
}

function applyBranding(config) {
  const branding = config.config?.branding || {};
  if (titleEl) titleEl.textContent = branding.headerTitle || config.scene?.title || 'Qtiler 3D Eye';
  if (subtitleEl) {
    const subtitle = branding.headerSubtitle || config.scene?.description || '';
    subtitleEl.textContent = subtitle;
    subtitleEl.hidden = !subtitle;
  }
  if (logoEl) {
    const logoUrl = String(branding.logoUrl || '').trim();
    if (logoUrl) {
      logoEl.src = new URL(logoUrl, window.location.origin).toString();
      logoEl.hidden = false;
    } else {
      logoEl.removeAttribute('src');
      logoEl.hidden = true;
    }
  }
}

// --- Creación de Puntos y Líneas de Medida ---
function createMeasurePoint(worldPosition) {
  return viewer.entities.add({
    position: worldPosition,
    point: {
      pixelSize: 8,
      color: Cesium.Color.YELLOW,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.NONE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    properties: { isMeasurement: true, type: 'point' }
  });
}

function drawGroundMeasureShape(positions, loop = false) {
  if (positions.length < 2) return null;
  const groundPolylineGeometry = new Cesium.GroundPolylineGeometry({
    positions: positions,
    width: 4,
    loop: loop
  });
  const primitive = new Cesium.GroundPolylinePrimitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: groundPolylineGeometry,
      attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.YELLOW) },
      id: 'measureGroundPrimitive_' + Date.now()
    }),
    appearance: new Cesium.PolylineMaterialAppearance({
      material: Cesium.Material.fromType('Color', { color: Cesium.Color.YELLOW })
    }),
    asynchronous: false
  });
  viewer.scene.primitives.add(primitive);
  return primitive;
}

// --- Ventana Flotante UI para Qtiler 3D Eye ---
function createMeasureWindow() {
  if (measureWindow) return;

  const container = document.createElement('div');
  container.id = 'measurementWindow';
  container.style.cssText = `
    position: absolute;
    bottom: 24px;
    right: 24px;
    padding: 12px 16px;
    background: rgba(12, 18, 28, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    color: white;
    z-index: 1000;
    width: 260px;
    border-radius: 8px;
    font-family: inherit;
    font-size: 0.88rem;
    pointer-events: auto;
  `;

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'measurement-close';
  closeButton.textContent = '×';
  closeButton.setAttribute('data-qtiler3d-i18n-title', 'ui:close');
  closeButton.onclick = closeMeasureWindow;
  container.appendChild(closeButton);

  const title = document.createElement('h3');
  title.dataset.qtiler3dI18n = 'ui:measurements';
  title.innerText = window.qtiler3dI18n?.t('ui', 'measurements') || 'Measurements';
  title.style.cssText = 'margin: 0 0 10px 0; font-size: 0.95rem; text-align: center; color: #e2e8f0;';
  container.appendChild(title);

  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'measurement-tools';

  function createBtn(id, iconClass, type, translationKey, threeDOnly = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'measurement-tool';
    button.id = id;
    button.dataset.qtiler3dTool = translationKey;
    if (threeDOnly) button.setAttribute('data-3d-only', '');
    const icon = document.createElement('i'); icon.className = iconClass; icon.setAttribute('aria-hidden', 'true'); button.appendChild(icon);
    button.onclick = () => setMeasureType(type);
    buttonContainer.appendChild(button);
    return button;
  }

  createBtn('verticalMeasurementButton', 'bx bx-up-arrow-alt', 'vertical', 'heightMeasure', true);
  createBtn('distanceMeasurementButton', 'bx bx-ruler', 'distance', 'distanceMeasure');
  createBtn('areaMeasurementButton', 'bx bx-shape-polygon', 'area', 'areaMeasure');

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'measurement-tool measurement-tool--clear';
  clearButton.id = 'clearMeasurementButton';
  clearButton.dataset.qtiler3dTool = 'clearMeasurements';
  const clearIcon = document.createElement('i'); clearIcon.className = 'bx bx-trash'; clearIcon.setAttribute('aria-hidden', 'true'); clearButton.appendChild(clearIcon);
  clearButton.onclick = clearAllMeasurementsAndData;
  buttonContainer.appendChild(clearButton);
  container.appendChild(buttonContainer);

  const currentMeasureDisplay = document.createElement('p');
  currentMeasureDisplay.id = 'currentMeasureDisplay';
  currentMeasureDisplay.style.cssText = 'text-align: center; font-weight: bold; margin: 8px 0; color: #63b3ed; min-height: 1.2em;';
  container.appendChild(currentMeasureDisplay);

  const measurementsList = document.createElement('ul');
  measurementsList.id = 'measurementsList';
  measurementsList.style.cssText = 'list-style: none; padding: 0; margin: 0; max-height: 140px; overflow-y: auto; font-size: 0.82rem; border-top: 1px solid rgba(255,255,255,0.1);';
  container.appendChild(measurementsList);

  document.body.appendChild(container);
  measureWindow = container;
  window.qtiler3dI18n?.apply(container);
  updateMeasurementToolAvailability();
  updateMeasureButtonState();
}

function updateMeasurementToolAvailability() {
  const heightButton = document.getElementById('verticalMeasurementButton');
  if (!heightButton) return;
  heightButton.hidden = dualMap?.activeMap === '2d';
}
document.addEventListener('qtiler3d:active-map-change', updateMeasurementToolAvailability);
const measureText = (key, fallback, values = {}) => window.qtiler3dI18n?.t('ui', key, values) || fallback;

function updateMeasureWindowForDistance(segmentDistance, totalDistance, startPoint, endPoint) {
  if (!measureWindow) createMeasureWindow();
  const currentMeasureDisplay = document.getElementById('currentMeasureDisplay');
  if (!currentMeasureDisplay) return;

  const cameraHeight = viewer.camera.positionCartographic.height;
  const useMeters = cameraHeight < 5000;
  const segmentDisplay = useMeters ? `${(segmentDistance * 1000).toFixed(0)} m` : `${segmentDistance.toFixed(3)} km`;
  const totalDisplay = useMeters ? `${(totalDistance * 1000).toFixed(0)} m` : `${totalDistance.toFixed(3)} km`;

  currentMeasureDisplay.innerText = measureText('total', `Total: ${totalDisplay}`, { value: totalDisplay });

  const midpoint = Cesium.Cartesian3.midpoint(startPoint, endPoint, new Cesium.Cartesian3());
  viewer.entities.add({
    position: midpoint,
    label: {
      text: segmentDisplay,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      font: '13px sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      pixelOffset: new Cesium.Cartesian2(0, -5),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    properties: { isMeasurement: true, type: 'temp_label' }
  });
}

function updateMeasureWindowForArea(area, points) {
  if (!measureWindow) createMeasureWindow();
  const measurementsList = document.getElementById('measurementsList');
  const currentMeasureDisplay = document.getElementById('currentMeasureDisplay');
  if (!measurementsList || !currentMeasureDisplay) return;

  if (area > 0 && points.length > 2) {
    const cameraHeight = viewer.camera.positionCartographic.height;
    const useSqMeters = cameraHeight < 10000;
    const areaDisplay = useSqMeters ? `${(area * 1000000).toFixed(0)} m²` : `${area.toFixed(3)} km²`;

    const listItem = document.createElement('li');
    listItem.innerText = measureText('areaResult', `Area: ${areaDisplay}`, { value: areaDisplay });
    listItem.style.cssText = 'border-bottom: 1px solid rgba(255,255,255,0.1); padding: 4px 0;';
    measurementsList.appendChild(listItem);
    measurementsList.scrollTop = measurementsList.scrollHeight;
    currentMeasureDisplay.innerText = measureText('areaResult', `Area: ${areaDisplay}`, { value: areaDisplay });

    if (typeof turf !== 'undefined') {
      try {
        const turfCoords = points.map(p => {
          const c = Cesium.Cartographic.fromCartesian(p);
          return [Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)];
        });
        if (turfCoords.length > 0 && (turfCoords[0][0] !== turfCoords[turfCoords.length - 1][0] || turfCoords[0][1] !== turfCoords[turfCoords.length - 1][1])) {
          turfCoords.push([...turfCoords[0]]);
        }
        const turfPolygon = turf.polygon([turfCoords]);
        const centerOfMass = turf.centerOfMass(turfPolygon);
        const centerCartographic = Cesium.Cartographic.fromDegrees(centerOfMass.geometry.coordinates[0], centerOfMass.geometry.coordinates[1]);

        Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [centerCartographic]).then(([updatedCenter]) => {
          const height = updatedCenter?.height ?? 0;
          const labelPosition = Cesium.Cartesian3.fromRadians(centerCartographic.longitude, centerCartographic.latitude, height + 1.0);
          const labelEntity = viewer.entities.add({
            position: labelPosition,
            label: {
              text: areaDisplay,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              font: '15px sans-serif',
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 3,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
              pixelOffset: new Cesium.Cartesian2(0, -5),
              disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            properties: { isMeasurement: true, type: 'area_label' }
          });
          measureEntities.push(labelEntity);
        }).catch(() => { });
      } catch (e) { }
    }
  } else {
    currentMeasureDisplay.innerText = measureText('areaResult', 'Area: -', { value: '-' });
  }
}

function updateMeasureWindowForHeight(height) {
  if (!measureWindow) createMeasureWindow();
  const measurementsList = document.getElementById('measurementsList');
  const currentMeasureDisplay = document.getElementById('currentMeasureDisplay');
  if (!measurementsList || !currentMeasureDisplay) return;

  const heightDisplay = `${height.toFixed(2)} m`;
  const listItem = document.createElement('li');
  listItem.innerText = measureText('heightResult', `Height: ${heightDisplay}`, { value: heightDisplay });
  listItem.style.cssText = 'border-bottom: 1px solid rgba(255,255,255,0.1); padding: 4px 0;';
  measurementsList.appendChild(listItem);
  measurementsList.scrollTop = measurementsList.scrollHeight;
  currentMeasureDisplay.innerText = measureText('heightResult', `Height: ${heightDisplay}`, { value: heightDisplay });
}

function calculateMeasureDistance(point1, point2) {
  return Cesium.Cartesian3.distance(point1, point2) / 1000;
}

function calculateMeasureArea(points) {
  if (typeof turf === 'undefined') return 0;
  const turfPoints = points.map(p => {
    const c = Cesium.Cartographic.fromCartesian(p);
    return [Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)];
  });
  if (turfPoints.length > 2) {
    if (turfPoints[0][0] !== turfPoints[turfPoints.length - 1][0] || turfPoints[0][1] !== turfPoints[turfPoints.length - 1][1]) {
      turfPoints.push([...turfPoints[0]]);
    }
    try {
      const poly = turf.polygon([turfPoints]);
      return turf.area(poly) / 1000000;
    } catch (e) { return 0; }
  }
  return 0;
}

// --- Modo Distancia ---
function startMeasureDistance() {
  measurePoints = [];
  let totalDistance = 0;
  isMeasuring = true;
  activeMeasureShape = null;
  let tempLabelEntities = [];

  if (measureWindow) document.getElementById('currentMeasureDisplay').innerText = measureText('startDistance', 'Click the start point');

  if (!measureHandler) measureHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  else {
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  }

  measureHandler.setInputAction(function (event) {
    const pickedPosition = pickGlobePosition(event.position);
    if (Cesium.defined(pickedPosition)) {
      const startPoint = measurePoints.length > 0 ? measurePoints[measurePoints.length - 1] : null;
      measurePoints.push(pickedPosition);
      createMeasurePoint(pickedPosition);

      if (startPoint) {
        const segmentDistance = calculateMeasureDistance(startPoint, pickedPosition);
        totalDistance += segmentDistance;
        if (activeMeasureShape) viewer.scene.primitives.remove(activeMeasureShape);
        activeMeasureShape = drawGroundMeasureShape(measurePoints);
        updateMeasureWindowForDistance(segmentDistance, totalDistance, startPoint, pickedPosition);

        const lastLabel = viewer.entities.values.find(e => e.properties?.type?.getValue() === 'temp_label' && !tempLabelEntities.includes(e));
        if (lastLabel) tempLabelEntities.push(lastLabel);
      } else {
        if (measureWindow) document.getElementById('currentMeasureDisplay').innerText = measureText('nextDistance', 'Click the next point');
      }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  measureHandler.setInputAction(function (movement) {
    if (measurePoints.length > 0 && isMeasuring) {
      const currentMousePosition = pickGlobePosition(movement.endPosition);
      if (Cesium.defined(currentMousePosition)) {
        if (activeMeasureShape) viewer.scene.primitives.remove(activeMeasureShape);
        activeMeasureShape = drawGroundMeasureShape(measurePoints.concat(currentMousePosition));
        if (floatingMeasurePoint) viewer.entities.remove(floatingMeasurePoint);
        floatingMeasurePoint = viewer.entities.add({
          position: currentMousePosition,
          point: { pixelSize: 6, color: Cesium.Color.RED },
          properties: { isMeasurement: true, type: 'temp' }
        });
      }
    }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  measureHandler.setInputAction(function () {
    if (measurePoints.length > 1) {
      isMeasuring = false;
      if (activeMeasureShape) { viewer.scene.primitives.remove(activeMeasureShape); activeMeasureShape = null; }
      if (floatingMeasurePoint) { viewer.entities.remove(floatingMeasurePoint); floatingMeasurePoint = null; }
      tempLabelEntities.forEach(lbl => viewer.entities.remove(lbl));
      tempLabelEntities = [];

      const finalPrimitive = drawGroundMeasureShape(measurePoints);
      if (finalPrimitive) measurePrimitives.push(finalPrimitive);

      measurePoints.forEach(pos => {
        const finalPointEntity = createMeasurePoint(pos);
        measureEntities.push(finalPointEntity);
      });

      const finalTotalDisplay = (totalDistance * 1000 < 5000) ? `${(totalDistance * 1000).toFixed(0)} m` : `${totalDistance.toFixed(3)} km`;
      const list = document.getElementById('measurementsList');
      if (list) {
        const item = document.createElement('li');
        item.innerText = measureText('distanceResult', `Distance: ${finalTotalDisplay}`, { value: finalTotalDisplay });
        item.style.cssText = 'border-bottom: 1px solid rgba(255,255,255,0.1); padding: 4px 0;';
        list.appendChild(item);
        list.scrollTop = list.scrollHeight;
      }
      if (measureWindow) document.getElementById('currentMeasureDisplay').innerText = measureText('finalResult', `Finished: ${finalTotalDisplay}`, { value: finalTotalDisplay });

      measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
      measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
      measurePoints = [];
    } else {
      isMeasuring = false;
      if (activeMeasureShape) viewer.scene.primitives.remove(activeMeasureShape);
      if (floatingMeasurePoint) viewer.entities.remove(floatingMeasurePoint);
      measurePoints = [];
      measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
      measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
      if (measureWindow) document.getElementById('currentMeasureDisplay').innerText = measureText('total', 'Total: 0 m', { value: '0 m' });
    }
    updateMeasureButtonState();
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

  updateMeasureButtonState();
}

// --- Modo Área ---
function startMeasureArea() {
  measurePoints = [];
  isMeasuring = true;
  activeMeasureShape = null;
  let pointEntitiesThisMeasure = [];

  if (measureWindow) document.getElementById('currentMeasureDisplay').innerText = measureText('startArea', 'Click the first point');
  if (!measureHandler) measureHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  else {
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  }

  measureHandler.setInputAction(function (event) {
    const pickedPosition = pickGlobePosition(event.position);
    if (Cesium.defined(pickedPosition)) {
      measurePoints.push(pickedPosition);
      const pointEntity = createMeasurePoint(pickedPosition);
      pointEntitiesThisMeasure.push(pointEntity);

      if (activeMeasureShape) viewer.scene.primitives.remove(activeMeasureShape);
      if (measurePoints.length > 1) {
        const loop = measurePoints.length > 2;
        activeMeasureShape = drawGroundMeasureShape(measurePoints, loop);
      }
      if (measureWindow) {
        document.getElementById('currentMeasureDisplay').innerText = `${measurePoints.length} ${measureText('finishRightClick', 'points. Right-click to finish')}`;
      }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  measureHandler.setInputAction(function (movement) {
    if (measurePoints.length > 0 && isMeasuring) {
      const currentMousePosition = pickGlobePosition(movement.endPosition);
      if (Cesium.defined(currentMousePosition)) {
        if (activeMeasureShape) viewer.scene.primitives.remove(activeMeasureShape);
        const tempPositions = [...measurePoints, currentMousePosition];
        const loop = tempPositions.length > 2;
        activeMeasureShape = drawGroundMeasureShape(tempPositions, loop);
        if (floatingMeasurePoint) viewer.entities.remove(floatingMeasurePoint);
        floatingMeasurePoint = viewer.entities.add({
          position: currentMousePosition,
          point: { pixelSize: 6, color: Cesium.Color.RED },
          properties: { isMeasurement: true, type: 'temp' }
        });
      }
    }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  measureHandler.setInputAction(function () {
    if (measurePoints.length > 2) {
      isMeasuring = false;
      if (activeMeasureShape) { viewer.scene.primitives.remove(activeMeasureShape); activeMeasureShape = null; }
      if (floatingMeasurePoint) { viewer.entities.remove(floatingMeasurePoint); floatingMeasurePoint = null; }

      const finalOutlinePrimitive = drawGroundMeasureShape(measurePoints, true);
      if (finalOutlinePrimitive) measurePrimitives.push(finalOutlinePrimitive);

      pointEntitiesThisMeasure.forEach(pEnt => {
        if (!measureEntities.includes(pEnt)) measureEntities.push(pEnt);
      });

      const totalArea = calculateMeasureArea(measurePoints);
      updateMeasureWindowForArea(totalArea, measurePoints);

      measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
      measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);

      measurePoints = [];
      pointEntitiesThisMeasure = [];
    } else {
      isMeasuring = false;
      if (activeMeasureShape) viewer.scene.primitives.remove(activeMeasureShape);
      if (floatingMeasurePoint) viewer.entities.remove(floatingMeasurePoint);
      pointEntitiesThisMeasure.forEach(pEnt => viewer.entities.remove(pEnt));
      pointEntitiesThisMeasure = [];
      measurePoints = [];

      measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
      measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
      if (measureWindow) document.getElementById('currentMeasureDisplay').innerText = measureText('areaResult', 'Area: 0 m²', { value: '0 m²' });
    }
    updateMeasureButtonState();
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

  updateMeasureButtonState();
}

// --- Modo Vertical (Z) ---
function startMeasureVertical() {
  measurePoints = [];
  let startPosition = null, startPositionCartographic = null;
  let verticalLineEntity = null, measureLabelEntity = null;
  let startPointEntity = null, endPointEntity = null;
  isMeasuring = true;
  let isDrawingLine = false;

  if (measureWindow) document.getElementById('currentMeasureDisplay').innerText = measureText('heightResult', 'Height: 0 m', { value: '0 m' });
  else { createMeasureWindow(); document.getElementById('currentMeasureDisplay').innerText = measureText('heightResult', 'Height: 0 m', { value: '0 m' }); }

  if (!measureHandler) measureHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  else {
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  }

  function mouseMoveHandlerVertical(movement) {
    if (!isDrawingLine || !startPosition) return;
    const currentMousePosition = pickGlobePosition(movement.endPosition);
    if (!Cesium.defined(currentMousePosition)) return;

    const currentMouseCartographic = Cesium.Cartographic.fromCartesian(currentMousePosition);
    const currentHeight = currentMouseCartographic.height;
    const verticalEndPosition = Cesium.Cartesian3.fromRadians(startPositionCartographic.longitude, startPositionCartographic.latitude, currentHeight);
    const verticalDistance = Math.abs(currentHeight - startPositionCartographic.height);
    const distanceDisplay = verticalDistance.toFixed(2) + ' m';
    const positions = [startPosition, verticalEndPosition];

    if (verticalLineEntity) {
      verticalLineEntity.polyline.positions = positions;
    } else {
      verticalLineEntity = viewer.entities.add({
        polyline: { positions: positions, material: Cesium.Color.CYAN.withAlpha(0.8), width: 3, clampToGround: false },
        properties: { isMeasurement: true, type: 'temp_line' }
      });
    }

    if (measureLabelEntity) {
      measureLabelEntity.position = verticalEndPosition;
      measureLabelEntity.label.text = distanceDisplay;
    } else {
      measureLabelEntity = viewer.entities.add({
        position: verticalEndPosition,
        label: {
          text: distanceDisplay,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          font: '15px sans-serif',
          fillColor: Cesium.Color.CYAN,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          pixelOffset: new Cesium.Cartesian2(0, -5),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        properties: { isMeasurement: true, type: 'temp_label' }
      });
    }

    if (floatingMeasurePoint) viewer.entities.remove(floatingMeasurePoint);
    floatingMeasurePoint = viewer.entities.add({
      position: currentMousePosition,
      point: { pixelSize: 6, color: Cesium.Color.RED },
      properties: { isMeasurement: true, type: 'temp' }
    });

    if (measureWindow) document.getElementById('currentMeasureDisplay').innerText = measureText('heightResult', `Height: ${distanceDisplay}`, { value: distanceDisplay });
  }

  function rightClickHandlerVerticalCancel() {
    if (!isDrawingLine) return;
    isMeasuring = false;
    isDrawingLine = false;

    if (verticalLineEntity) viewer.entities.remove(verticalLineEntity);
    if (measureLabelEntity) viewer.entities.remove(measureLabelEntity);
    if (floatingMeasurePoint) viewer.entities.remove(floatingMeasurePoint);
    if (startPointEntity) viewer.entities.remove(startPointEntity);

    startPosition = null;
    startPositionCartographic = null;
    verticalLineEntity = null;
    measureLabelEntity = null;
    floatingMeasurePoint = null;
    startPointEntity = null;
    endPointEntity = null;
    measurePoints = [];

    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);

    if (measureWindow) document.getElementById('currentMeasureDisplay').innerText = measureText('heightResult', 'Height: 0 m', { value: '0 m' });
    updateMeasureButtonState();
  }

  measureHandler.setInputAction(function (event) {
    const pickedPosition = pickGlobePosition(event.position);
    if (!Cesium.defined(pickedPosition)) return;

    if (!isDrawingLine) {
      startPosition = pickedPosition;
      startPositionCartographic = Cesium.Cartographic.fromCartesian(startPosition);
      measurePoints = [startPosition];
      startPointEntity = createMeasurePoint(startPosition);
      isDrawingLine = true;
      isMeasuring = true;

      if (measureWindow) document.getElementById('currentMeasureDisplay').innerText = measureText('heightEnd', 'Click the upper point');
      measureHandler.setInputAction(mouseMoveHandlerVertical, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      measureHandler.setInputAction(rightClickHandlerVerticalCancel, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    } else {
      isMeasuring = false;
      isDrawingLine = false;
      measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
      measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);

      const finalEndCartographic = Cesium.Cartographic.fromCartesian(pickedPosition);
      const finalVerticalEndPosition = Cesium.Cartesian3.fromRadians(startPositionCartographic.longitude, startPositionCartographic.latitude, finalEndCartographic.height);
      const finalVerticalDistance = Math.abs(finalEndCartographic.height - startPositionCartographic.height);
      const finalDistanceDisplay = finalVerticalDistance.toFixed(2) + ' m';

      if (floatingMeasurePoint) { viewer.entities.remove(floatingMeasurePoint); floatingMeasurePoint = null; }
      if (verticalLineEntity && verticalLineEntity.properties?.type?.getValue() === 'temp_line') viewer.entities.remove(verticalLineEntity);
      if (measureLabelEntity && measureLabelEntity.properties?.type?.getValue() === 'temp_label') viewer.entities.remove(measureLabelEntity);

      const finalPositions = [startPosition, finalVerticalEndPosition];
      const finalLineEntity = viewer.entities.add({
        polyline: { positions: finalPositions, material: Cesium.Color.CYAN, width: 3, clampToGround: false },
        properties: { isMeasurement: true, type: 'line' }
      });
      const finalLabelEntity = viewer.entities.add({
        position: finalVerticalEndPosition,
        label: {
          text: finalDistanceDisplay,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          font: '15px sans-serif',
          fillColor: Cesium.Color.CYAN,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          pixelOffset: new Cesium.Cartesian2(0, -5),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        properties: { isMeasurement: true, type: 'label' }
      });
      endPointEntity = createMeasurePoint(finalVerticalEndPosition);

      measureEntities.push(startPointEntity);
      measureEntities.push(endPointEntity);
      measureEntities.push(finalLineEntity);
      measureEntities.push(finalLabelEntity);

      updateMeasureWindowForHeight(finalVerticalDistance);

      measurePoints = [];
      startPosition = null;
      startPositionCartographic = null;
      verticalLineEntity = null;
      measureLabelEntity = null;
      startPointEntity = null;
      endPointEntity = null;

      updateMeasureButtonState();
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  updateMeasureButtonState();
}

// --- Limpieza y Control de Interacciones ---
function clearMeasurements() {
  const entitiesToRemove = [];
  try {
    viewer.entities.values.forEach(entity => {
      if (entity?.properties?.isMeasurement?.getValue(viewer.clock.currentTime)) {
        entitiesToRemove.push(entity);
      }
      if (entity === floatingMeasurePoint) {
        if (!entitiesToRemove.includes(entity)) entitiesToRemove.push(entity);
        floatingMeasurePoint = null;
      }
    });
    entitiesToRemove.forEach(entity => viewer.entities.remove(entity));
  } catch (e) { }
  measureEntities = [];

  measurePrimitives.forEach(primitive => {
    if (primitive && !primitive.isDestroyed()) {
      try { viewer.scene.primitives.remove(primitive); } catch (e) { }
    }
  });
  measurePrimitives = [];

  activeMeasureShape = null;
  if (floatingMeasurePoint && viewer.entities.contains(floatingMeasurePoint)) {
    viewer.entities.remove(floatingMeasurePoint);
    floatingMeasurePoint = null;
  }
}

function clearAllMeasurementsAndData() {
  dualMap?.cancelSketch();
  clearMeasurements();
  measurePoints = [];
  if (measureWindow) {
    const list = document.getElementById('measurementsList');
    if (list) list.innerHTML = '';
    const display = document.getElementById('currentMeasureDisplay');
    if (display) display.innerText = measureText('measurements', 'Select a measurement tool');
  }
  isMeasuring = false;
  if (measureHandler) {
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  }
  measureType = '';
  updateMeasureButtonState();
}

function closeMeasureWindow() {
  dualMap?.cancelSketch();
  dualMap?.suspendFeatureInfo(false);
  if (measureHandler) {
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    if (!measureHandler.isDestroyed()) measureHandler.destroy();
    measureHandler = null;
  }
  isMeasuring = false;
  clearMeasurements();

  if (measureWindow) {
    document.body.removeChild(measureWindow);
    measureWindow = null;
  }
  enableDoubleClickZoom();
  enableInfoBoxPicking();
}

function updateMeasureButtonState() {
  const activeColor = 'rgba(11, 99, 206, 0.6)';
  const buttons = [
    { id: 'distanceMeasurementButton', type: 'distance' },
    { id: 'areaMeasurementButton', type: 'area' },
    { id: 'verticalMeasurementButton', type: 'vertical' }
  ];
  buttons.forEach(bInfo => {
    const button = document.getElementById(bInfo.id);
    if (button) {
      if (measureWindow && measureType === bInfo.type) {
        button.style.backgroundColor = activeColor;
        button.style.color = '#fff';
      } else {
        button.style.backgroundColor = '';
        button.style.color = '#a0aec0';
      }
    }
  });
}

function setMeasureType(type) {
  if (!measureWindow) createMeasureWindow();

  updateMeasurementToolAvailability();
  if (dualMap?.activeMap === '2d') {
    if (type === 'vertical') return;
    dualMap.suspendFeatureInfo(true);
    measureType = type;
    isMeasuring = true;
    const display = document.getElementById('currentMeasureDisplay');
    const list = document.getElementById('measurementsList');
    const area = type === 'area';
    if (display) display.textContent = window.qtiler3dI18n?.t('ui', area ? 'startArea' : 'startDistance') || (area ? 'Click the first point' : 'Click the start point');
    dualMap.measure(area ? 'Polygon' : 'LineString', {
      onStart: () => { if (display) display.textContent = window.qtiler3dI18n?.t('ui', area ? 'startArea' : 'startDistance'); },
      onUpdate: (value) => {
        if (!display) return;
        const result = area ? formatArea(value) : formatDistance(value);
        display.textContent = result;
      },
      onFinish: (value) => {
        const result = area ? formatArea(value) : formatDistance(value);
        if (display) display.textContent = result;
        if (list) { const row = document.createElement('li'); row.textContent = `${window.qtiler3dI18n?.t('tools', area ? 'areaMeasure' : 'distanceMeasure') || (area ? 'Area' : 'Distance')}: ${result}`; list.appendChild(row); list.scrollTop = list.scrollHeight; }
        isMeasuring = false;
        updateMeasureButtonState();
      }
    });
    updateMeasureButtonState();
    return;
  }

  if (measureHandler) {
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  } else {
    measureHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  }

  measureType = type;
  isMeasuring = false;

  if (measureWindow) {
    const display = document.getElementById('currentMeasureDisplay');
    if (type === 'distance') display.innerText = measureText('startDistance', 'Click the start point');
    else if (type === 'area') display.innerText = measureText('startArea', 'Click the first point');
    else if (type === 'vertical') display.innerText = measureText('startHeight', 'Click the lower point');
  }

  if (type === 'distance') startMeasureDistance();
  else if (type === 'area') startMeasureArea();
  else if (type === 'vertical') startMeasureVertical();
  updateMeasureButtonState();
}

function openMeasureWindow() {
  if (measureWindow) return;
  createMeasureWindow();
  dualMap?.suspendFeatureInfo(true);
  disableDoubleClickZoom();
  disableInfoBoxPicking();
  setMeasureType('distance');
}

function formatDistance(metres) {
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${metres.toFixed(1)} m`;
}

function formatArea(squareMetres) {
  return squareMetres >= 1000000 ? `${(squareMetres / 1000000).toFixed(2)} km²` : `${(squareMetres / 10000).toFixed(2)} ha`;
}

// --- Control de Desactivación de Interacciones de Cesium ---
function disableDoubleClickZoom() {
  viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
}

function enableDoubleClickZoom() {
  if (!measureWindow && !measureHandler) {
    try {
      viewer.screenSpaceEventHandler.setInputAction(c => viewer.camera.zoomIn(), Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    } catch (e) { }
  }
}

function disableInfoBoxPicking() {
  try {
    if (!originalSelectedEntityDescriptor && Object.getOwnPropertyDescriptor(viewer, 'selectedEntity')) {
      originalSelectedEntityDescriptor = Object.getOwnPropertyDescriptor(viewer, 'selectedEntity');
    }
    Object.defineProperty(viewer, 'selectedEntity', { configurable: true, get: () => undefined, set: (v) => { } });
    if (viewer.selectedEntityViewModel) viewer.selectedEntityViewModel.selectedEntity = undefined;
  } catch (e) { }
}

function enableInfoBoxPicking() {
  try {
    if (originalSelectedEntityDescriptor) {
      Object.defineProperty(viewer, 'selectedEntity', originalSelectedEntityDescriptor);
      originalSelectedEntityDescriptor = null;
    }
  } catch (e) { }
}

function clearActiveTool() {
  dualMap?.cancelSketch();
  dualMap?.suspendFeatureInfo(false);
  stopModelPlacement();
  toolButtons?.querySelectorAll('[data-tool].active').forEach((button) => button.classList.remove('active'));
  routeSimulation?.cancel();
  sketchEditor?.cancel();
  if (orbitStop) { orbitStop(); orbitStop = null; }
  if (activeToolHandler) {
    activeToolHandler.destroy();
    activeToolHandler = null;
  }
  if (activeSketch?.preview) viewer.entities.remove(activeSketch.preview);
  activeSketch = null;
  if (measureWindow) {
    closeMeasureWindow();
  }
  setStatus('Ready.');
}

function hideToolPopup() {
  if (toolPopup) toolPopup.hidden = true;
}

function stopModelPlacement() {
  if (modelPlacementHandler) { modelPlacementHandler.destroy(); modelPlacementHandler = null; }
  if (modelPlacementPreview) { viewer?.scene?.primitives?.remove(modelPlacementPreview); modelPlacementPreview = null; }
  placementPreviewLocation = null;
  dualMap?.suspendFeatureInfo(false);
}

async function openModelPlacementPanel() {
  if (dualMap && dualMap.mode !== '3d') dualMap.setMode('3d');
  const panel = document.getElementById('modelPlacementPanel');
  const select = document.getElementById('placementModelSelect');
  const status = document.getElementById('modelPlacementStatus');
  panel.hidden = false;
  status.textContent = window.qtiler3dI18n?.t('ui', 'loadingModels') || 'Loading models…';
  try {
    placementAssets = (currentConfig?.config?.assets || []).filter((asset) => asset.type === 'model' && asset.url);
    if (!placementAssets.length) {
      const response = await fetch(`${API_BASE}/api/assets`, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      placementAssets = (data.assets || []).filter((asset) => asset.type === 'model' && asset.url);
    }
    select.replaceChildren(...placementAssets.map((asset) => new Option(asset.name || asset.id, asset.id)));
    if (!placementAssets.length) {
      status.textContent = window.qtiler3dI18n?.t('ui', 'modelLibraryEmpty') || 'No models are available to this map yet. Add GLTF/GLB assets to the scene.';
      document.getElementById('placementModelPreview').replaceChildren();
      return;
    }
    select.dispatchEvent(new Event('change'));
    status.textContent = window.qtiler3dI18n?.t('ui', 'placementReady') || 'Choose a model, adjust its transform and place it on the terrain.';
  } catch (error) {
    status.textContent = error.message;
  }
}

async function refreshModelPlacementPreview() {
  const preview = document.getElementById('placementModelPreview');
  const asset = placementAssets.find((candidate) => candidate.id === document.getElementById('placementModelSelect').value);
  preview.replaceChildren();
  if (!asset) return;
  const label = document.createElement('strong'); label.textContent = asset.name || asset.id;
  const kind = document.createElement('span'); kind.textContent = String(asset.originalName || asset.url).split(/[\\/]/).pop();
  const icon = document.createElement('i'); icon.className = 'bx bx-cube-alt'; icon.setAttribute('aria-hidden', 'true');
  preview.append(icon, document.createElement('div'));
  preview.lastElementChild.append(label, kind);
  if (modelPlacementPreview) { viewer.scene.primitives.remove(modelPlacementPreview); modelPlacementPreview = null; }
  const location = placementPreviewLocation || (() => {
    const point = pickTerrainPosition(new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2));
    if (!point) return null;
    const cartographic = Cesium.Cartographic.fromCartesian(point);
    return { longitude: Cesium.Math.toDegrees(cartographic.longitude), latitude: Cesium.Math.toDegrees(cartographic.latitude), ground: cartographic.height };
  })();
  if (location) await updateModelPlacementPreview(location.longitude, location.latitude, location.ground);
}

function pickTerrainPosition(screenPosition) {
  const ray = viewer.camera.getPickRay(screenPosition);
  return ray ? viewer.scene.globe.pick(ray, viewer.scene) || pickGlobePosition(screenPosition) : null;
}

async function updateModelPlacementPreview(longitude, latitude, sampledGroundHeight) {
  const asset = placementAssets.find((candidate) => candidate.id === document.getElementById('placementModelSelect').value);
  if (!asset) return;
  if (!modelPlacementPreview || modelPlacementPreview._qtilerAssetId !== asset.id) {
    if (modelPlacementPreview) viewer.scene.primitives.remove(modelPlacementPreview);
    modelPlacementPreview = await Cesium.Model.fromGltfAsync({ url: new URL(asset.url, location.origin).toString(), modelMatrix: Cesium.Matrix4.IDENTITY, minimumPixelSize: 28 });
    modelPlacementPreview._qtilerAssetId = asset.id;
    modelPlacementPreview.show = false;
    viewer.scene.primitives.add(modelPlacementPreview);
  }
  const mode = document.getElementById('placementHeightMode').value;
  const offset = Number(document.getElementById('placementHeight').value || 0);
  const height = mode === 'absolute' ? offset : mode === 'ground' ? sampledGroundHeight : sampledGroundHeight + offset;
  modelPlacementPreview.modelMatrix = placementToMatrix({
    longitude, latitude, height,
    heading: Number(document.getElementById('placementHeading').value || 0),
    pitch: Number(document.getElementById('placementPitch').value || 0),
    roll: Number(document.getElementById('placementRoll').value || 0),
    scale: Number(document.getElementById('placementScale').value || 1)
  });
  modelPlacementPreview.show = true;
}

async function beginModelPlacement() {
  const asset = placementAssets.find((candidate) => candidate.id === document.getElementById('placementModelSelect').value);
  if (!asset) throw new Error(window.qtiler3dI18n?.t('ui', 'selectModelFirst') || 'Select a model first');
  stopModelPlacement();
  clearActiveTool();
  const status = document.getElementById('modelPlacementStatus');
  dualMap?.suspendFeatureInfo(true);
  let frame = 0;
  placementCount = 0;
  modelPlacementHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  document.getElementById('beginModelPlacement').classList.add('is-primary');
  status.textContent = window.qtiler3dI18n?.t('ui', 'placementClick') || 'Click on the terrain to place the model.';
  modelPlacementHandler.setInputAction((movement) => {
    if (frame) return;
    frame = requestAnimationFrame(async () => {
      frame = 0;
      const position = pickTerrainPosition(movement.endPosition);
      if (!position) return;
      const point = Cesium.Cartographic.fromCartesian(position);
      placementPreviewLocation = { longitude: Cesium.Math.toDegrees(point.longitude), latitude: Cesium.Math.toDegrees(point.latitude), ground: point.height };
      try { await updateModelPlacementPreview(placementPreviewLocation.longitude, placementPreviewLocation.latitude, placementPreviewLocation.ground); }
      catch (error) { status.textContent = error.message; }
    });
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  modelPlacementHandler.setInputAction(async (event) => {
    const position = pickTerrainPosition(event.position);
    if (!position) return;
    const point = Cesium.Cartographic.fromCartesian(position);
    const longitude = Cesium.Math.toDegrees(point.longitude);
    const latitude = Cesium.Math.toDegrees(point.latitude);
    const mode = document.getElementById('placementHeightMode').value;
    const height = Number(document.getElementById('placementHeight').value || 0);
    const style = {
      color: '#087c73', fillColor: '#31b6a7', opacity: 1, fillOpacity: 0.3, width: 2, pointSize: 10,
      name: asset.name || '3D model', text: '', modelAssetId: asset.id, modelScale: Number(document.getElementById('placementScale').value || 1),
      heading: Number(document.getElementById('placementHeading').value || 0), pitch: Number(document.getElementById('placementPitch').value || 0),
      roll: Number(document.getElementById('placementRoll').value || 0), mode, height, extrusion: 0, dash: 'solid'
    };
    sketchEditor.open();
    sketchEditor.importFeatures({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [longitude, latitude, 0] }, properties: { qtilerSketch: style } }] });
    placementCount += 1;
    status.textContent = `${placementCount}: ${window.qtiler3dI18n?.t('ui', 'placementSaved') || 'Model added to Sketch. Save the GeoJSON drawing to reuse it.'}`;
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

let jsPdfPromise = null;

function downloadGeoJson(features, filename) {
  const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features }, null, 2)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadJsPdf() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (!jsPdfPromise) jsPdfPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${API_BASE}/vendor/jspdf.umd.min.js`;
    script.onload = () => window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('PDF library did not initialize'));
    script.onerror = () => reject(new Error('PDF library could not load from the local Qtiler installation'));
    document.head.appendChild(script);
  });
  return jsPdfPromise;
}

async function captureCurrentMap() {
  if (dualMap?.activeMap === '2d') {
    const rendered = new Promise((resolve) => dualMap.map.once('rendercomplete', resolve));
    dualMap.map.renderSync();
    await rendered;
    const size = dualMap.map.getSize();
    const canvas = document.createElement('canvas'); canvas.width = size[0] * 2; canvas.height = size[1] * 2;
    const context = canvas.getContext('2d'); context.scale(2, 2);
    for (const sourceCanvas of document.querySelectorAll('#olContainer .ol-layer canvas')) {
      if (!sourceCanvas.width) continue;
      context.globalAlpha = Number(sourceCanvas.parentElement.style.opacity || 1);
      const matrix = new DOMMatrix(getComputedStyle(sourceCanvas).transform);
      context.setTransform(2 * matrix.a, 2 * matrix.b, 2 * matrix.c, 2 * matrix.d, 2 * matrix.e, 2 * matrix.f);
      context.drawImage(sourceCanvas, 0, 0);
    }
    return { canvas, attribution: document.querySelector('#olContainer .ol-attribution')?.textContent?.trim() || '', width: size[0], height: size[1] };
  }
  viewer.scene.render();
  const canvas = document.createElement('canvas'); canvas.width = viewer.canvas.width; canvas.height = viewer.canvas.height;
  canvas.getContext('2d').drawImage(viewer.canvas, 0, 0);
  return { canvas, attribution: document.querySelector('.cesium-credit-textContainer')?.textContent?.trim() || '', width: viewer.canvas.clientWidth, height: viewer.canvas.clientHeight };
}

async function loadLogoData(url) {
  if (!url) return null;
  try {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = new URL(url, location.origin).toString();
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas.toDataURL('image/png');
  } catch { return null; }
}

function visiblePrintLayers() {
  return Array.from(runtimeItems.values()).filter((item) => {
    if (!['layer', 'background'].includes(item.category)) return false;
    if (item.layer) return item.layer.visible !== false && (item.type === 'wms' || item.type === 'osm' || item.type === 'xyz' || item.object?.show !== false);
    return item.object?.show !== false;
  });
}

async function downloadCurrentMapPng() {
  const result = await captureCurrentMap();
  const link = document.createElement('a'); link.download = `${sceneId || 'map'}-${dualMap?.activeMap || '3d'}.png`; link.href = result.canvas.toDataURL('image/png'); link.click();
}

async function printCurrentMap() {
  const status = document.getElementById('printStatus');
  const title = document.getElementById('printTitle').value.trim() || currentConfig.scene?.title || 'Qtiler 3D Eye';
  const description = document.getElementById('printDescription').value.trim();
  const landscape = document.getElementById('printOrientation').value === 'landscape';
  const paper = document.getElementById('printPaper').value;
  const showDate = document.getElementById('printShowDate').checked;
  const showScale = document.getElementById('printShowScale').checked;
  const showLegend = document.getElementById('printShowLegend').checked;
  status.textContent = window.qtiler3dI18n?.t('ui', 'printReady') || 'Preparing print layout…';
  try {
    const jsPDF = await loadJsPdf();
    const map = await captureCurrentMap();
    const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: paper, compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 12;
    const contentWidth = pageWidth - margin * 2;
    pdf.setProperties({ title, subject: description, creator: 'Qtiler 3D Eye' });
    pdf.setTextColor(32, 39, 44);
    const logo = await loadLogoData(currentConfig.config?.branding?.logoUrl || '');
    if (logo) pdf.addImage(logo, 'PNG', margin, margin, 26, 13, undefined, 'FAST');
    const titleX = logo ? margin + 32 : margin;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18);
    const titleLines = pdf.splitTextToSize(title, contentWidth - (logo ? 34 : 0));
    pdf.text(titleLines, titleX, margin + 7);
    let cursorY = margin + Math.max(14, titleLines.length * 7);
    if (showDate) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(90, 101, 110); pdf.text(new Date().toLocaleDateString(window.qtiler3dI18n?.language() || 'en'), pageWidth - margin, margin + 5, { align: 'right' }); }
    if (description) {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(70, 82, 90);
      const lines = pdf.splitTextToSize(description, contentWidth);
      pdf.text(lines, margin, cursorY + 2);
      cursorY += lines.length * 4.5 + 5;
    }
    const legendItems = showLegend ? visiblePrintLayers() : [];
    const legendRows = Math.ceil(legendItems.length / 2);
    const footerReserve = 18 + (legendItems.length ? 10 + legendRows * 7 : 0);
    const mapAreaHeight = Math.max(60, pageHeight - margin - cursorY - footerReserve);
    const aspect = map.width / Math.max(1, map.height);
    let mapWidth = contentWidth; let mapHeight = mapWidth / aspect;
    if (mapHeight > mapAreaHeight) { mapHeight = mapAreaHeight; mapWidth = mapHeight * aspect; }
    const mapX = (pageWidth - mapWidth) / 2;
    pdf.setDrawColor(195, 205, 211); pdf.setLineWidth(0.25); pdf.rect(mapX - 0.5, cursorY - 1, mapWidth + 1, mapHeight + 2);
    pdf.addImage(map.canvas.toDataURL('image/png'), 'PNG', mapX, cursorY, mapWidth, mapHeight, undefined, 'FAST');
    let footerY = cursorY + mapHeight + 7;
    if (showLegend && legendItems.length) {
      pdf.setTextColor(32, 39, 44); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.text(window.qtiler3dI18n?.t('ui', 'printLegend') || 'Legend', margin, footerY);
      footerY += 5; pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
      legendItems.forEach((item, index) => {
        const column = index % 2; const row = Math.floor(index / 2);
        const x = margin + column * (contentWidth / 2); const y = footerY + row * 6;
        const color = String(item.layer?.color || item.layer?.fillColor || '#087c73');
        const hex = color.match(/^#([0-9a-f]{6})$/i)?.[1] || '087c73';
        pdf.setFillColor(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)); pdf.rect(x, y - 3, 4, 4, 'F');
        pdf.setTextColor(55, 65, 70); pdf.text(pdf.splitTextToSize(item.label, contentWidth / 2 - 10)[0] || item.label, x + 7, y);
      });
      footerY += legendRows * 6;
    }
    if (showScale) {
      let groundWidth;
      if (dualMap?.activeMap === '2d') {
        const center = window.ol.proj.toLonLat(dualMap.map.getView().getCenter());
        groundWidth = dualMap.map.getView().getResolution() * Math.cos(Cesium.Math.toRadians(center[1])) * map.width;
      } else {
        const frustum = viewer.camera.frustum;
        groundWidth = 2 * Math.tan((frustum.fov || Math.PI / 3) / 2) * viewer.camera.positionCartographic.height * (map.width / map.height);
      }
      const denominator = Math.max(1, Math.round(groundWidth / Math.max(0.01, (mapWidth / 1000))));
      const scaleLengthMm = Math.min(42, contentWidth / 3);
      const scaleDistanceM = denominator * scaleLengthMm / 1000;
      const scaleLabel = scaleDistanceM >= 1000 ? `${(scaleDistanceM / 1000).toFixed(1)} km` : `${Math.round(scaleDistanceM)} m`;
      const y = pageHeight - margin - 6;
      pdf.setDrawColor(32, 39, 44); pdf.setLineWidth(0.5); pdf.line(margin, y, margin + scaleLengthMm, y); pdf.line(margin, y - 1.5, margin, y + 1.5); pdf.line(margin + scaleLengthMm, y - 1.5, margin + scaleLengthMm, y + 1.5);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(55, 65, 70); pdf.text(`${scaleLabel}  ·  1:${denominator.toLocaleString()}`, margin + scaleLengthMm + 3, y + 1);
    }
    if (map.attribution) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor(90, 101, 110); pdf.text(pdf.splitTextToSize(map.attribution, contentWidth), margin, pageHeight - margin - (showScale ? 12 : 4)); }
    const fileBase = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'qtiler-map';
    pdf.save(`${fileBase}.pdf`);
    status.textContent = window.qtiler3dI18n?.t('ui', 'pdfReady') || 'PDF ready';
  } catch (error) {
    status.textContent = window.qtiler3dI18n?.t('ui', 'pdfError', { error: error.message }) || error.message;
    throw error;
  }
}

function showToolPopup(title, actions = []) {
  if (!toolPopup) return;
  toolPopup.innerHTML = `
    <header><strong>${viewerText(title)}</strong><button type="button" data-tool-close aria-label="Close">x</button></header>
    <div class="tool-popup-actions">
      ${actions.map((action) => `<button type="button" class="viewer-button" data-tool-action="${viewerText(action.key)}"><i class="bx ${viewerText(action.icon)}"></i><span>${viewerText(action.label)}</span></button>`).join('')}
    </div>
  `;
  toolPopup.hidden = false;
  toolPopup.querySelector('[data-tool-close]')?.addEventListener('click', hideToolPopup);
  toolPopup.querySelectorAll('[data-tool-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = actions.find((item) => item.key === button.dataset.toolAction);
      if (action?.run) Promise.resolve().then(action.run).catch(reportViewerError);
    });
  });
}

function initViewer(config) {
  applyBranding(config);
  const isTerrainPreview = config.config?.previewMode === 'terrain' || config.scene?.terrainPreview === true;
  const token = config.config?.cesiumToken || '';
  if (token) Cesium.Ion.defaultAccessToken = token;

  viewer = new Cesium.Viewer('cesiumContainer', {
    timeline: false,
    animation: false,
    contextOptions: { webgl: { preserveDrawingBuffer: true } },
    imageryProvider: false,
    baseLayer: false,
    navigationHelpButton: false,
    geocoder: isTerrainPreview ? false : !!token,
    homeButton: true,
    sceneModePicker: false,
    fullscreenButton: isTerrainPreview ? false : true,
    infoBox: isTerrainPreview ? false : true,
    selectionIndicator: isTerrainPreview ? false : true,
    baseLayerPicker: false
  });

  viewer.scene.globe.depthTestAgainstTerrain = true;
  sketchEditor = window.QtilerSketchEditor.create({ viewer, pickGlobePosition, terrainHeightAt, clearActiveTool, save: saveCurrentDrawingToServer, load: loadDrawingFromServer, suspendInfo: (value) => dualMap?.suspendFeatureInfo(value),
    changed: (features) => queueMicrotask(() => dualMap?.syncSketch(features)), use2d: () => dualMap?.activeMap === '2d',
    draw2d: (...args) => dualMap.drawSketch(...args), modify2d: (...args) => dualMap.modifySketch(...args), pick2d: (callback) => dualMap.pick(callback),
    cancel2d: () => dualMap?.cancelSketch(), finish2d: () => dualMap?.finishDrawing(),
    models: async () => {
      const fromScene = currentConfig?.config?.assets?.filter((asset) => asset.type === 'model') || [];
      if (fromScene.length) return fromScene;
      const response = await fetch(`${API_BASE}/api/assets`, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()).assets.filter((asset) => asset.type === 'model');
    }
  });
  const modelPlacementPanel = document.getElementById('modelPlacementPanel');
  document.getElementById('modelPlacementClose').onclick = () => { stopModelPlacement(); modelPlacementPanel.hidden = true; };
  document.getElementById('beginModelPlacement').onclick = () => beginModelPlacement().catch((error) => { document.getElementById('modelPlacementStatus').textContent = error.message; });
  document.getElementById('finishModelPlacement').onclick = () => stopModelPlacement();
  document.getElementById('placementModelSelect').addEventListener('change', () => refreshModelPlacementPreview().catch((error) => { document.getElementById('modelPlacementStatus').textContent = error.message; }));
  modelPlacementPanel.querySelectorAll('input,select').forEach((input) => input.addEventListener('input', () => refreshModelPlacementPreview().catch(() => {})));
  document.getElementById('saveModelDrawing').onclick = async () => {
    try {
      const name = document.getElementById('modelDrawingName').value.trim();
      if (!name) throw new Error(window.qtiler3dI18n?.t('ui', 'drawingName') || 'Enter a drawing name');
      await sketchEditor.saveDrawing(name);
      document.getElementById('modelPlacementStatus').textContent = window.qtiler3dI18n?.t('ui', 'drawingSaved') || 'GeoJSON drawing saved';
    } catch (error) { document.getElementById('modelPlacementStatus').textContent = error.message; }
  };
  document.getElementById('exportModelGeoJSON').onclick = () => downloadGeoJson(sketchEditor.features(), `${sceneId || 'map'}-models.geojson`);
  document.getElementById('openSketchLibrary').onclick = () => sketchEditor.open();
  document.getElementById('printPanelClose').onclick = () => { document.getElementById('printPanel').hidden = true; };
  document.getElementById('printMapButton').onclick = () => printCurrentMap().catch((error) => { document.getElementById('printStatus').textContent = error.message; });
  document.getElementById('exportMapPng').onclick = () => downloadCurrentMapPng().catch((error) => { document.getElementById('printStatus').textContent = error.message; });
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#d8dde4');
  viewer.scene.globe.enableLighting = config.config?.modules?.shadows !== false;
  document.getElementById('zoomInButton').onclick = () => viewer.camera.zoomIn(Math.max(10, viewer.camera.positionCartographic.height * 0.35));
  document.getElementById('zoomOutButton').onclick = () => viewer.camera.zoomOut(Math.max(10, viewer.camera.positionCartographic.height * 0.35));
  document.getElementById('northButton').onclick = () => orientCamera(0, viewer.camera.pitch);
  document.getElementById('tiltUpButton').onclick = () => orientCamera(viewer.camera.heading, viewer.camera.pitch + Cesium.Math.toRadians(10));
  document.getElementById('tiltDownButton').onclick = () => orientCamera(viewer.camera.heading, viewer.camera.pitch - Cesium.Math.toRadians(10));
  viewer.scene.preRender.addEventListener(() => { document.getElementById('compassNeedle').style.transform = `rotate(${-viewer.camera.heading}rad)`; });
  const clock = document.getElementById('compactClock');
  clock.hidden = true;
  viewer.clock.shouldAnimate = false;
  const time = document.getElementById('sceneTime');
  time.onchange = () => { const date = new Date(time.value); if (Number.isFinite(date.getTime())) viewer.clock.currentTime = Cesium.JulianDate.fromDate(date); };
  const play = document.getElementById('clockPlay');
  play.onclick = () => { viewer.clock.shouldAnimate = !viewer.clock.shouldAnimate; play.firstElementChild.className = viewer.clock.shouldAnimate ? 'bx bx-pause' : 'bx bx-play'; };
  document.getElementById('clockNow').onclick = () => { viewer.clock.currentTime = Cesium.JulianDate.now(); };
  let lastClockSecond = '';
  viewer.clock.onTick.addEventListener(() => {
    const date = Cesium.JulianDate.toDate(viewer.clock.currentTime);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    if (local !== lastClockSecond && document.activeElement !== time) { time.value = local; lastClockSecond = local; }
  });
  if (isTerrainPreview) document.body.classList.add('terrain-preview-mode');
}

function terrainPreviewCameraView(bounds) {
  const [west, south, east, north] = bounds;
  const centerLon = (west + east) / 2;
  const centerLat = (south + north) / 2;
  const widthMeters = Math.max(1, Cesium.Cartesian3.distance(
    Cesium.Cartesian3.fromDegrees(west, centerLat, 0),
    Cesium.Cartesian3.fromDegrees(east, centerLat, 0)
  ));
  const heightMeters = Math.max(1, Cesium.Cartesian3.distance(
    Cesium.Cartesian3.fromDegrees(centerLon, south, 0),
    Cesium.Cartesian3.fromDegrees(centerLon, north, 0)
  ));
  const range = Math.max(widthMeters, heightMeters);
  return {
    destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, Math.max(450, range * 1.15)),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-90),
      roll: 0
    }
  };
}
function normalizeTerrainBounds(value) {
  if (!Array.isArray(value) || value.length < 4) return null;
  const bounds = value.slice(0, 4).map(Number);
  if (!bounds.every(Number.isFinite)) return null;
  const [west, south, east, north] = bounds;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) return null;
  return [west, south, east, north];
}

function orientCamera(heading, pitch) {
  clearActiveTool();
  const target = pickGlobePosition(new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2));
  const limitedPitch = Math.max(-Math.PI / 2, Math.min(-0.08, pitch));
  if (target) {
    const range = Cesium.Cartesian3.distance(viewer.camera.positionWC, target);
    viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(heading, limitedPitch, range));
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  } else viewer.camera.setView({ orientation: { heading, pitch: limitedPitch, roll: viewer.camera.roll } });
}

async function createImageryProvider(layer) {
  if (layer.type === 'wms') {
    return new Cesium.WebMapServiceImageryProvider({
      url: new URL(layer.url, window.location.origin).toString(),
      layers: layer.layerName || '',
      parameters: {
        service: 'WMS',
        version: '1.1.1',
        format: 'image/png',
        transparent: layer.isBaseLayer ? false : true,
        srs: 'EPSG:3857',
        styles: ''
      },
      tilingScheme: new Cesium.WebMercatorTilingScheme(),
      enablePickFeatures: false
    });
  }
  if (layer.type === 'osm') {
    const options = {
      url: layer.url || 'https://tile.openstreetmap.org/',
      credit: layer.credit || '© OpenStreetMap contributors',
      maximumLevel: Number(layer.maximumLevel || 19)
    };
    if (!/\{(?:z|x|y)\}/.test(options.url) && typeof Cesium.OpenStreetMapImageryProvider === 'function') return new Cesium.OpenStreetMapImageryProvider(options);
    return new Cesium.UrlTemplateImageryProvider({
      url: layer.url || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      credit: options.credit,
      maximumLevel: options.maximumLevel
    });
  }
  if (layer.type === 'xyz') {
    return new Cesium.UrlTemplateImageryProvider({
      url: layer.url,
      subdomains: Array.isArray(layer.subdomains) && layer.subdomains.length ? layer.subdomains : undefined,
      credit: layer.credit || layer.name || '',
      maximumLevel: Number(layer.maximumLevel || 19)
    });
  }
  return null;
}

async function addWmsLayers(config) {
  const layers = config.config?.layers || [];
  const imageryLayers = layers
    .filter((layer) => ['wms', 'osm', 'xyz'].includes(layer.type) && layer.url)
    .sort((a, b) => Number(!!b.isBaseLayer) - Number(!!a.isBaseLayer));
  const defaultBackground = imageryLayers.find((layer) => layer.isBaseLayer && layer.isDefault) || imageryLayers.find((layer) => layer.isBaseLayer && layer.visible !== false);
  for (const layer of imageryLayers) {
    const provider = await createImageryProvider(layer);
    if (!provider) continue;
    const imagery = viewer.imageryLayers.addImageryProvider(provider);
    imagery.show = layer.isBaseLayer ? layer.key === defaultBackground?.key : layer.visible !== false;
    imagery.alpha = layer.isBaseLayer ? 1 : (layer.opacity ?? 0.9);
    if (layer.isBaseLayer) try { viewer.imageryLayers.raiseToTop(imagery); } catch { }
    runtimeItems.set(layer.key, { label: layer.name, category: layer.isBaseLayer ? 'background' : 'layer', type: layer.type, object: imagery, opacity: layer.isBaseLayer ? 1 : (layer.opacity ?? 0.9), legendIcon: layer.legendIcon, layer });
  }
}

function styleNumber(value, fallback) {
  return value != null && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function defaultVectorStyle(layer) {
  const geom = String(layer.geometryType || '').toLowerCase();
  const clampToGround = !(Number(layer.extrusionHeight) > 0);
  const fillOpacity = styleNumber(layer.fillOpacity, 0.55);
  const strokeOpacity = styleNumber(layer.strokeOpacity, 1);
  if (geom.includes('point')) {
    return { markerSize: Number(layer.pointSize || 18), markerColor: Cesium.Color.fromCssColorString(layer.color || '#2f80ed').withAlpha(fillOpacity), stroke: Cesium.Color.fromCssColorString(layer.strokeColor || '#ffffff').withAlpha(strokeOpacity), strokeWidth: Number(layer.strokeWidth || 1) };
  }
  if (geom.includes('line')) {
    return { stroke: Cesium.Color.fromCssColorString(layer.strokeColor || layer.color || '#00d1b2').withAlpha(strokeOpacity), strokeWidth: Number(layer.strokeWidth || 3), clampToGround };
  }
  return { stroke: Cesium.Color.fromCssColorString(layer.strokeColor || '#ffffff').withAlpha(strokeOpacity), strokeWidth: Number(layer.strokeWidth || 2), fill: Cesium.Color.fromCssColorString(layer.color || '#2f80ed').withAlpha(fillOpacity), clampToGround };
}

function currentApproxZoom() {
  const height = Number(viewer?.camera?.positionCartographic?.height || 0);
  if (!Number.isFinite(height) || height <= 0) return 18;
  return Math.max(0, Math.min(24, Math.round(Math.log2(40075016 / Math.max(1, height)))));
}

function zoomInRange(style = {}, zoom = currentApproxZoom()) {
  const minZoom = Number(style.minZoom);
  const maxZoom = Number(style.maxZoom);
  if (Number.isFinite(minZoom) && minZoom > 0 && zoom < minZoom) return false;
  if (Number.isFinite(maxZoom) && maxZoom > 0 && zoom > maxZoom) return false;
  return true;
}

function propertyValue(entity, field) {
  const properties = entity.properties;
  if (!properties || !field) return '';
  try {
    const value = properties.getValue(Cesium.JulianDate.now())?.[field];
    return value == null ? '' : value;
  } catch {
    try {
      const prop = properties[field];
      return typeof prop?.getValue === 'function' ? prop.getValue(Cesium.JulianDate.now()) : prop;
    } catch {
      return '';
    }
  }
}

function ruleMatches(entity, rule, zoom) {
  if (!zoomInRange(rule, zoom)) return false;
  if (!rule.field) return true;
  const leftRaw = propertyValue(entity, rule.field);
  const left = String(leftRaw ?? '');
  const right = String(rule.value ?? '');
  const leftNum = Number(leftRaw);
  const rightNum = Number(rule.value);
  switch (rule.operator || '=') {
    case '!=': return left !== right;
    case 'contains': return left.toLowerCase().includes(right.toLowerCase());
    case '>': return Number.isFinite(leftNum) && Number.isFinite(rightNum) && leftNum > rightNum;
    case '<': return Number.isFinite(leftNum) && Number.isFinite(rightNum) && leftNum < rightNum;
    case '>=': return Number.isFinite(leftNum) && Number.isFinite(rightNum) && leftNum >= rightNum;
    case '<=': return Number.isFinite(leftNum) && Number.isFinite(rightNum) && leftNum <= rightNum;
    default: return left === right;
  }
}

function effectiveStyleForEntity(entity, layer, zoom = currentApproxZoom()) {
  const base = { ...layer };
  const rule = (layer.styleRules || []).find((item) => ruleMatches(entity, item, zoom));
  return rule ? { ...base, ...Object.fromEntries(Object.entries(rule).filter(([, value]) => value != null)) } : base;
}

function geometryHasZ(geometry) {
  if (!geometry) return false;
  if (geometry.type === 'GeometryCollection') return (geometry.geometries || []).some(geometryHasZ);
  const hasZ = coordinates => Array.isArray(coordinates) && (typeof coordinates[0] === 'number'
    ? coordinates.length >= 3 && Number.isFinite(coordinates[2])
    : coordinates.some(hasZ));
  return hasZ(geometry.coordinates);
}

function taggedWfsGeojson(geojson) {
  const tag = feature => ({ ...feature, properties: { ...feature.properties, __qtilerGeometryHasZ: geometryHasZ(feature.geometry) } });
  return geojson.type === 'FeatureCollection' ? { ...geojson, features: geojson.features.map(tag) } : tag(geojson);
}

function entityHeightMode(entity, style) {
  const mode = style.heightMode || 'auto';
  return mode === 'auto' ? (entity._qtilerGeometryHasZ ? 'absolute' : 'ground') : mode;
}

function tubeShape(radius, segments = 16) {
  const size = Math.max(0.01, Math.min(1000, Number(radius) || 0.5));
  return Array.from({ length: segments }, (_, index) => new Cesium.Cartesian2(size * Math.cos(index * Math.PI * 2 / segments), size * Math.sin(index * Math.PI * 2 / segments)));
}

function geometryPositionKey(position) {
  return `${position.x},${position.y},${position.z}`;
}

function shiftedGeometryPosition(entity, position, mode, offset) {
  const cartographic = Cesium.Cartographic.fromCartesian(position);
  const terrain = entity._qtilerTerrainHeights?.get(geometryPositionKey(position)) ?? viewer.scene.globe.getHeight(cartographic) ?? 0;
  const height = (mode === 'ground' ? terrain : cartographic.height + (mode === 'relative' ? terrain : 0)) + offset;
  return Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, height);
}

function shiftedPolygonHierarchy(entity, hierarchy, mode, offset) {
  return new Cesium.PolygonHierarchy(hierarchy.positions.map(position => shiftedGeometryPosition(entity, position, mode, offset)), (hierarchy.holes || []).map(hole => shiftedPolygonHierarchy(entity, hole, mode, offset)));
}

async function prepareWfsGeometryHeights(dataSource, layer) {
  dataSource._qtilerHeightRevision = (dataSource._qtilerHeightRevision || 0) + 1;
  const now = Cesium.JulianDate.now();
  const positions = [];
  const remember = (entity, hierarchy) => {
    hierarchy.positions.forEach(position => positions.push({ entity, position }));
    (hierarchy.holes || []).forEach(hole => remember(entity, hole));
  };
  for (const entity of dataSource.entities.values) {
    entity._qtilerTerrainHeights = new Map();
    if (entity._qtilerGeometryHasZ === undefined) entity._qtilerGeometryHasZ = entity.properties?.getValue(now)?.__qtilerGeometryHasZ === true;
    if (entity.polyline && !entity._qtilerBaseLinePositions) entity._qtilerBaseLinePositions = entity.polyline.positions.getValue(now);
    if (entity.polygon && !entity._qtilerBasePolygonHierarchy) entity._qtilerBasePolygonHierarchy = entity.polygon.hierarchy.getValue(now);
    const style = effectiveStyleForEntity(entity, layer);
    const mode = entityHeightMode(entity, style);
    if (mode === 'absolute' || (mode === 'ground' && style.lineStyle !== 'tube' && !Number(style.heightOffset))) continue;
    entity._qtilerBaseLinePositions?.forEach(position => positions.push({ entity, position }));
    if (entity._qtilerBasePolygonHierarchy) remember(entity, entity._qtilerBasePolygonHierarchy);
  }
  for (const entity of dataSource.entities.values) entity.properties?.removeProperty?.('__qtilerGeometryHasZ');
  if (!positions.length) return;
  const provider = viewer.terrainProvider;
  if (provider instanceof Cesium.EllipsoidTerrainProvider) return;
  const samples = positions.map(({ position }) => Cesium.Cartographic.fromCartesian(position));
  if (provider.availability) await Cesium.sampleTerrainMostDetailed(provider, samples);
  else await Cesium.sampleTerrain(provider, 12, samples);
  if (viewer.terrainProvider !== provider) return;
  positions.forEach(({ entity, position }, index) => {
    entity._qtilerTerrainHeights ||= new Map();
    entity._qtilerTerrainHeights.set(geometryPositionKey(position), Number.isFinite(samples[index].height) ? samples[index].height : 0);
  });
}

function setEntityTerrainOffset(entity, heightOffset = 0, mode = 'ground') {
  if (!entity?.position) return;
  if (!entity._qtiler3dBaseCartographic) {
    const cartesian = entity.position.getValue(Cesium.JulianDate.now());
    const cartographic = cartesian ? Cesium.Cartographic.fromCartesian(cartesian) : null;
    if (cartographic) {
      entity._qtiler3dBaseCartographic = {
        longitude: cartographic.longitude,
        latitude: cartographic.latitude,
        height: cartographic.height
      };
    }
  }
  const base = entity._qtiler3dBaseCartographic;
  if (!base) return;
  entity.position = Cesium.Cartesian3.fromRadians(base.longitude, base.latitude, (mode === 'ground' ? 0 : base.height || 0) + Number(heightOffset || 0));
}

function lazyGltfKey(style) {
  return [style.modelUrl || '', style.modelScale || 1, style.heightOffset || 0, style.heightMode || 'ground'].join('|');
}

function entityWindowPosition(entity) {
  if (!viewer || !entity?.position) return null;
  const cartesian = entity.position.getValue(Cesium.JulianDate.now());
  if (!cartesian) return null;
  const point = Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, cartesian);
  if (!point) return null;
  const canvas = viewer.scene.canvas;
  const margin = 96;
  if (point.x < -margin || point.y < -margin || point.x > canvas.clientWidth + margin || point.y > canvas.clientHeight + margin) return null;
  return point;
}

function installLazyGltfModel(entity, style) {
  const key = lazyGltfKey(style);
  if (entity._qtiler3dLoadedGltf === key && entity.model) return;
  entity.model = new Cesium.ModelGraphics({
    uri: new URL(style.modelUrl, window.location.origin).toString(),
    scale: Number.isFinite(Number(style.modelScale)) ? Number(style.modelScale) : 1,
    heightReference: style.heightMode === 'absolute' ? Cesium.HeightReference.NONE : (style.heightMode === 'relative' || Number(style.heightOffset || 0) ? Cesium.HeightReference.RELATIVE_TO_GROUND : Cesium.HeightReference.CLAMP_TO_GROUND)
  });
  entity.point = undefined;
  entity.billboard = undefined;
  entity._qtiler3dLoadedGltf = key;
}

function clearLazyGltfModel(entity) {
  if (entity?.model) entity.model = undefined;
  entity._qtiler3dLoadedGltf = '';
}

function updateLazyGltfSymbols() {
  lazyGltfState.timer = null;
  if (!viewer) return;
  const candidates = [];
  const offscreen = [];
  const canvas = viewer.scene.canvas;
  const centerX = canvas.clientWidth / 2;
  const centerY = canvas.clientHeight / 2;
  for (const item of runtimeItems.values()) {
    if (item.type !== 'wfs' || !item.object || item.object.show === false) continue;
    for (const entity of item.object.entities.values) {
      const style = entity._qtiler3dLazyGltf;
      if (!style?.modelUrl) continue;
      const point = entityWindowPosition(entity);
      if (!point) {
        offscreen.push(entity);
        continue;
      }
      const dx = point.x - centerX;
      const dy = point.y - centerY;
      candidates.push({ entity, style, distance: dx * dx + dy * dy });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  const keep = new Set(candidates.slice(0, LAZY_GLTF_MAX_VISIBLE).map((item) => item.entity));
  for (const entity of offscreen) clearLazyGltfModel(entity);
  for (const item of candidates.slice(LAZY_GLTF_MAX_VISIBLE)) clearLazyGltfModel(item.entity);
  let loaded = 0;
  for (const item of candidates) {
    if (!keep.has(item.entity)) continue;
    if (item.entity._qtiler3dLoadedGltf === lazyGltfKey(item.style) && item.entity.model) continue;
    installLazyGltfModel(item.entity, item.style);
    loaded += 1;
    if (loaded >= LAZY_GLTF_BATCH_SIZE) break;
  }
  if (candidates.some((item) => keep.has(item.entity) && item.entity._qtiler3dLoadedGltf !== lazyGltfKey(item.style))) {
    scheduleLazyGltfUpdate(140);
  }
}

function scheduleLazyGltfUpdate(delay = 80) {
  if (lazyGltfState.timer) clearTimeout(lazyGltfState.timer);
  lazyGltfState.timer = setTimeout(updateLazyGltfSymbols, delay);
}

function removeWfsSurfaceMeshes(dataSource) {
  for (const entity of dataSource?.entities?.values || []) {
    if (entity._qtilerSurfacePrimitive) viewer.scene.primitives.remove(entity._qtilerSurfacePrimitive);
    entity._qtilerSurfacePrimitive = null;
    entity._qtilerSurfaceKey = '';
  }
}

function renderWfsSurface(entity, hierarchy, fillColor, strokeColor, style, revision = 0) {
  const key = `${style.heightMode}|${style.heightOffset}|${fillColor.toCssColorString()}|${strokeColor.toCssColorString()}|${style.strokeWidth}|${revision}`;
  if (entity._qtilerSurfaceKey === key && entity._qtilerSurfacePrimitive) {
    entity._qtilerSurfacePrimitive.show = true;
    return;
  }
  if (entity._qtilerSurfacePrimitive) viewer.scene.primitives.remove(entity._qtilerSurfacePrimitive);
  const rings = [hierarchy.positions];
  const addHoles = current => (current.holes || []).forEach(hole => { rings.push(hole.positions); addHoles(hole); });
  addHoles(hierarchy);
  const projection = window.qtilerProjectSurfaceRings(rings);
  const flatPoints = rings.flat();
  const triangles = Cesium.PolygonPipeline.triangulate(projection.vertices.map((_, index) => index % 2 ? null : new Cesium.Cartesian2(projection.vertices[index], projection.vertices[index + 1])).filter(Boolean), projection.holes);
  if (!triangles.length) return;
  const values = new Float64Array(flatPoints.flatMap(position => [position.x, position.y, position.z]));
  const geometry = new Cesium.Geometry({
    attributes: { position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values }) },
    indices: new Uint32Array(triangles), primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(values)
  });
  const collection = new Cesium.PrimitiveCollection();
  collection.add(new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({ geometry, id: entity, attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(fillColor) } }),
    appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: fillColor.alpha < 1, closed: false }), asynchronous: false
  }));
  if (Number(style.strokeWidth) > 0) {
    const outlines = collection.add(new Cesium.PolylineCollection());
    for (const ring of rings) outlines.add({ positions: [...ring, ring[0]], width: Number(style.strokeWidth), material: Cesium.Material.fromType('Color', { color: strokeColor }) });
  }
  entity._qtilerSurfacePrimitive = viewer.scene.primitives.add(collection);
  entity._qtilerSurfaceKey = key;
}

function updateUndergroundView(dataSource) {
  const underground = (dataSource.show && dataSource._qtilerUnderground) || Array.from(runtimeItems.values()).some(item => item.object !== dataSource && item.object?.show && item.object?._qtilerUnderground);
  if (viewer.scene.globe.translucency) {
    viewer.scene.globe.translucency.enabled = !!underground;
    viewer.scene.globe.translucency.frontFaceAlpha = underground ? 0.45 : 1;
    viewer.scene.globe.translucency.backFaceAlpha = underground ? 0.45 : 1;
  }
  const controller = viewer.scene.screenSpaceCameraController;
  if (underground && controller._qtilerCollisionBeforeUnderground === undefined) controller._qtilerCollisionBeforeUnderground = controller.enableCollisionDetection;
  if (underground) controller.enableCollisionDetection = false;
  else if (controller._qtilerCollisionBeforeUnderground !== undefined) {
    controller.enableCollisionDetection = controller._qtilerCollisionBeforeUnderground;
    delete controller._qtilerCollisionBeforeUnderground;
  }
}

function applyWfsStyle(dataSource, layer) {
  const zoom = currentApproxZoom();
  dataSource.show = layer.visible !== false && zoomInRange(layer, zoom);
  if (!dataSource.show) {
    for (const entity of dataSource.entities.values) {
      entity._qtiler3dLazyGltf = null;
      clearLazyGltfModel(entity);
      if (entity._qtilerSurfacePrimitive) entity._qtilerSurfacePrimitive.show = false;
    }
    updateUndergroundView(dataSource);
    return;
  }
  dataSource._qtilerUnderground = false;
  for (const entity of dataSource.entities.values) {
    const style = effectiveStyleForEntity(entity, layer, zoom);
    const heightOffset = Number(style.heightOffset || 0);
    const heightMode = entityHeightMode(entity, style);
    const heightReference = heightMode === 'absolute' ? Cesium.HeightReference.NONE : (heightMode === 'relative' || heightOffset ? Cesium.HeightReference.RELATIVE_TO_GROUND : Cesium.HeightReference.CLAMP_TO_GROUND);
    const layerOpacity = styleNumber(layer.opacity, 1);
    const fillOpacity = styleNumber(style.fillOpacity, 0.55) * layerOpacity;
    const strokeOpacity = styleNumber(style.strokeOpacity, 1) * layerOpacity;
    const fillColor = Cesium.Color.fromCssColorString(style.color || '#2f80ed').withAlpha(fillOpacity);
    const strokeColor = Cesium.Color.fromCssColorString(style.strokeColor || '#ffffff').withAlpha(strokeOpacity);
    const pointSize = Number(style.pointSize || 18);
    const iconUrl = String(style.iconUrl || '').trim();
    const iconScale = styleNumber(style.iconScale, 1);
    const modelUrl = String(style.modelUrl || '').trim();
    const symbolType = String(style.symbolType || (modelUrl ? 'gltf' : (iconUrl ? 'svg' : 'point')));
    if (entity.position && !entity.polyline && !entity.polygon) {
      setEntityTerrainOffset(entity, heightOffset, heightMode);
      if (symbolType === 'gltf' && modelUrl) {
        entity._qtiler3dLazyGltf = {
          modelUrl,
          modelScale: styleNumber(style.modelScale, 1),
          heightOffset,
          heightMode
        };
        entity.billboard = undefined;
        if (!entity.model) {
          if (!entity.point) entity.point = new Cesium.PointGraphics();
          entity.point.color = fillColor;
          entity.point.outlineColor = strokeColor;
          entity.point.outlineWidth = Number(style.strokeWidth || 1);
          entity.point.pixelSize = Math.max(6, Math.min(14, pointSize * 0.55));
          entity.point.heightReference = heightReference;
          entity.point.disableDepthTestDistance = heightMode === 'ground' ? Number.POSITIVE_INFINITY : 0;
        }
      } else if (symbolType === 'svg' && iconUrl) {
        entity._qtiler3dLazyGltf = null;
        clearLazyGltfModel(entity);
        entity.point = undefined;
        entity.billboard = new Cesium.BillboardGraphics({
          image: new URL(iconUrl, window.location.origin).toString(),
          scale: iconScale,
          color: fillColor,
          heightReference,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: heightMode === 'ground' ? Number.POSITIVE_INFINITY : 0
        });
      } else {
        entity._qtiler3dLazyGltf = null;
        clearLazyGltfModel(entity);
        entity.billboard = undefined;
        if (!entity.point) entity.point = new Cesium.PointGraphics();
        entity.point.color = fillColor;
        entity.point.outlineColor = strokeColor;
        entity.point.outlineWidth = Number(style.strokeWidth || 1);
        entity.point.pixelSize = pointSize;
        entity.point.heightReference = heightReference;
        entity.point.disableDepthTestDistance = heightMode === 'ground' ? Number.POSITIVE_INFINITY : 0;
      }
    }
    if (entity.polyline) {
      entity._qtilerBaseLinePositions ||= entity.polyline.positions.getValue(Cesium.JulianDate.now());
      const positions = entity._qtilerBaseLinePositions.map(position => shiftedGeometryPosition(entity, position, heightMode, heightOffset));
      entity.polyline.positions = positions;
      entity.polyline.material = strokeColor;
      entity.polyline.width = Number(style.strokeWidth || 3);
      entity.polyline.clampToGround = heightMode === 'ground' && !heightOffset;
      entity.polyline.show = style.lineStyle !== 'tube';
      entity.polylineVolume = style.lineStyle === 'tube' ? new Cesium.PolylineVolumeGraphics({ positions, shape: tubeShape(style.tubeRadius), material: strokeColor, cornerType: Cesium.CornerType.ROUNDED }) : undefined;
    }
    if (entity.polygon) {
      entity._qtilerBasePolygonHierarchy ||= entity.polygon.hierarchy.getValue(Cesium.JulianDate.now());
      entity.polygon.material = fillColor;
      entity.polygon.outline = true;
      entity.polygon.outlineColor = strokeColor;
      entity.polygon.perPositionHeight = heightMode !== 'ground';
      entity.polygon.hierarchy = shiftedPolygonHierarchy(entity, entity._qtilerBasePolygonHierarchy, heightMode, heightOffset);
      entity.polygon.height = heightMode === 'ground' ? heightOffset || 0 : undefined;
      entity.polygon.heightReference = heightMode === 'ground' ? heightReference : Cesium.HeightReference.NONE;
      const surfaceMesh = heightMode !== 'ground' && !Number(style.extrusionHeight) && !!window.qtilerProjectSurfaceRings;
      entity.polygon.show = !surfaceMesh;
      if (surfaceMesh) renderWfsSurface(entity, entity.polygon.hierarchy.getValue(Cesium.JulianDate.now()), fillColor, strokeColor, style, dataSource._qtilerHeightRevision);
      else if (entity._qtilerSurfacePrimitive) entity._qtilerSurfacePrimitive.show = false;
    }
    if (style.showUnderground) dataSource._qtilerUnderground = true;
  }
  updateUndergroundView(dataSource);
  scheduleLazyGltfUpdate();
}

function applyExtrusionStyle(dataSource, layer) {
  const baseExtrusionHeight = Number(layer.extrusionHeight);
  const hasRuleExtrusion = (layer.styleRules || []).some((rule) => Number(rule.extrusionHeight) > 0);
  if ((!Number.isFinite(baseExtrusionHeight) || baseExtrusionHeight <= 0) && !hasRuleExtrusion) return;
  for (const entity of dataSource.entities.values) {
    if (!entity.polygon) continue;
    const style = effectiveStyleForEntity(entity, layer);
    const extrusionHeight = Number(style.extrusionHeight ?? baseExtrusionHeight);
    if (!Number.isFinite(extrusionHeight) || extrusionHeight <= 0) continue;
    const color = Cesium.Color.fromCssColorString(style.color || layer.color || '#b2b2b2').withAlpha(styleNumber(style.fillOpacity, 0.72) * styleNumber(layer.opacity, 1));
    const mode = entityHeightMode(entity, style);
    if (mode === 'ground') {
      entity.polygon.height = Number(style.heightOffset) || 0;
      entity.polygon.heightReference = Number(style.heightOffset) ? Cesium.HeightReference.RELATIVE_TO_GROUND : Cesium.HeightReference.CLAMP_TO_GROUND;
      entity.polygon.extrudedHeight = extrusionHeight + (Number(style.heightOffset) || 0);
      entity.polygon.extrudedHeightReference = Cesium.HeightReference.RELATIVE_TO_GROUND;
    } else {
      const hierarchy = entity.polygon.hierarchy.getValue(Cesium.JulianDate.now());
      entity.polygon.height = undefined;
      entity.polygon.perPositionHeight = true;
      entity.polygon.heightReference = Cesium.HeightReference.NONE;
      entity.polygon.extrudedHeight = Math.max(...hierarchy.positions.map(position => Cesium.Cartographic.fromCartesian(position).height)) + extrusionHeight;
      entity.polygon.extrudedHeightReference = Cesium.HeightReference.NONE;
    }
    entity.polygon.material = color;
    entity.polygon.outline = true;
    entity.polygon.outlineColor = Cesium.Color.WHITE.withAlpha(0.65);
    entity.polygon.closeTop = true;
    entity.polygon.closeBottom = true;
  }
}

async function addWfsLayers(config) {
  const allLayers = config.config?.layers || [];
  const extrudedLayerKeys = new Set(allLayers
    .filter((layer) => layer.type === 'wfs' && Number(layer.extrusionHeight) > 0)
    .map((layer) => `${layer.projectId || ''}:${layer.layerName || ''}`));
  const tiles3dLayerKeys = new Set(allLayers
    .filter((layer) => layer.type === '3dtiles-reference')
    .map((layer) => `${layer.projectId || ''}:${layer.layerName || ''}`));
  const layers = allLayers.filter((layer) => {
    if (layer.type !== 'wfs' || !layer.url || !layer.layerName) return false;
    const layerKey = `${layer.projectId || ''}:${layer.layerName || ''}`;
    const duplicateExtruded = !Number(layer.extrusionHeight) && (extrudedLayerKeys.has(layerKey) || tiles3dLayerKeys.has(layerKey));
    return !duplicateExtruded;
  });
  for (const layer of layers) {
    runtimeItems.set(layer.key, { label: layer.name, category: 'layer', type: 'wfs', object: null, legendIcon: layer.legendIcon, editable: layer.editable === true, layer, loading: false });
  }
  scheduleVisibleWfsUpdate(50);
}

function currentViewBbox() {
  if (!viewer?.camera || !viewer?.scene?.globe) return null;
  const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (!rectangle) return null;
  let west = Cesium.Math.toDegrees(rectangle.west);
  let south = Cesium.Math.toDegrees(rectangle.south);
  let east = Cesium.Math.toDegrees(rectangle.east);
  let north = Cesium.Math.toDegrees(rectangle.north);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (east < west) {
    west = -180;
    east = 180;
  }
  const padX = Math.max(0.0002, (east - west) * 0.18);
  const padY = Math.max(0.0002, (north - south) * 0.18);
  return [
    Math.max(-180, west - padX),
    Math.max(-90, south - padY),
    Math.min(180, east + padX),
    Math.min(90, north + padY)
  ];
}

function bboxKey(layer, bbox, mode = 'view') {
  return `${layer.key}|${mode}|z${currentApproxZoom()}|${bbox.map((value) => Number(value).toFixed(4)).join(',')}`;
}

function bboxContains(outer, inner) {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}

function cachedWfsGeojson(layerKey, key) {
  const cache = visibleWfsState.cacheByLayer.get(layerKey);
  if (!cache?.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key); cache.set(key, value);
  return value.geojson;
}

function findCachedWfsGeojson(layerKey, bbox, mode) {
  const cache = visibleWfsState.cacheByLayer.get(layerKey);
  if (!cache) return null;
  const entry = Array.from(cache.values()).reverse().find((value) => value.complete && value.mode === mode && bboxContains(value.bbox, bbox));
  return entry?.geojson || null;
}

function cacheWfsGeojson(layerKey, key, bbox, mode, geojson, limit) {
  let cache = visibleWfsState.cacheByLayer.get(layerKey);
  if (!cache) { cache = new Map(); visibleWfsState.cacheByLayer.set(layerKey, cache); }
  cache.delete(key); cache.set(key, { bbox: [...bbox], mode, geojson, complete: geojsonFeatureCount(geojson) < limit });
  while (cache.size > 12) cache.delete(cache.keys().next().value);
}

function wfsFeatureLimit(layer, mode = 'view') {
  if (mode === 'project-fallback') return VISIBLE_WFS_GLTF_FALLBACK_MAX_FEATURES;
  if (layer.symbolType === 'gltf' || layer.modelUrl || layer.modelAssetId) return VISIBLE_WFS_GLTF_MAX_FEATURES;
  if (layer.extrusionHeight != null || String(layer.key || '').startsWith('qgis3d:')) return VISIBLE_WFS_3D_MAX_FEATURES;
  return VISIBLE_WFS_MAX_FEATURES;
}

function wfsBboxUrl(layer, bbox, mode = 'view') {
  const url = new URL(layer.url, window.location.origin);
  url.searchParams.set('SERVICE', 'WFS');
  url.searchParams.set('VERSION', '1.1.0');
  url.searchParams.set('REQUEST', 'GetFeature');
  url.searchParams.set('TYPENAME', layer.layerName);
  url.searchParams.set('OUTPUTFORMAT', 'application/json');
  url.searchParams.set('SRSNAME', 'EPSG:4326');
  url.searchParams.set('BBOX', `${bbox.join(',')},EPSG:4326`);
  url.searchParams.set('MAXFEATURES', String(wfsFeatureLimit(layer, mode)));
  return url.toString();
}

function geojsonFeatureCount(geojson) {
  if (!geojson) return 0;
  if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) return geojson.features.length;
  if (geojson.type === 'Feature') return 1;
  return 0;
}

function projectBoundsFallback(layer, currentBbox) {
  if (!String(layer.key || '').startsWith('external:')) return null;
  if (layer.symbolType !== 'gltf' && !(layer.modelUrl || layer.modelAssetId)) return null;
  if (!Array.isArray(layer.projectBounds) || layer.projectBounds.length < 4) return null;
  const bounds = layer.projectBounds.slice(0, 4).map(Number);
  if (!bounds.every(Number.isFinite)) return null;
  const same = currentBbox && bounds.every((value, index) => Math.abs(value - Number(currentBbox[index])) < 0.00001);
  return same ? null : bounds;
}

async function loadVisibleWfsItem(item, bbox) {
  const layer = item.layer;
  if (wfsEditor?.isEditing(item) && item.object) return;
  const visible = layer.visible !== false && zoomInRange(layer);
  if (!visible) {
    if (item.object) item.object.show = false;
    return;
  }
  const key = bboxKey(layer, bbox);
  if (visibleWfsState.lastKeyByLayer.get(layer.key) === key && item.object) {
    item.object.show = true;
    applyWfsStyle(item.object, layer);
    return;
  }
  const previous = visibleWfsState.controllers.get(layer.key);
  if (previous) previous.abort();
  const controller = new AbortController();
  visibleWfsState.controllers.set(layer.key, controller);
  item.loading = true;
  try {
    let requestBbox = bbox;
    let requestMode = 'view';
    let geojson = cachedWfsGeojson(layer.key, key) || findCachedWfsGeojson(layer.key, bbox, requestMode);
    if (!geojson) {
      const response = await fetch(wfsBboxUrl(layer, requestBbox, requestMode), { credentials: 'include', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      geojson = await response.json();
      cacheWfsGeojson(layer.key, key, bbox, requestMode, geojson, wfsFeatureLimit(layer, requestMode));
    }
    const fallbackBbox = geojsonFeatureCount(geojson) === 0 ? projectBoundsFallback(layer, bbox) : null;
    if (fallbackBbox) {
      requestBbox = fallbackBbox;
      requestMode = 'project-fallback';
      const fallbackKey = bboxKey(layer, requestBbox, requestMode);
      if (visibleWfsState.lastKeyByLayer.get(layer.key) === fallbackKey && item.object) {
        item.object.show = true;
        applyWfsStyle(item.object, layer);
        item.loading = false;
        return;
      }
      geojson = cachedWfsGeojson(layer.key, fallbackKey) || findCachedWfsGeojson(layer.key, requestBbox, requestMode);
      if (!geojson) {
        const response = await fetch(wfsBboxUrl(layer, requestBbox, requestMode), { credentials: 'include', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        geojson = await response.json();
        cacheWfsGeojson(layer.key, fallbackKey, requestBbox, requestMode, geojson, wfsFeatureLimit(layer, requestMode));
      }
    }
    if (controller.signal.aborted) return;
    const dataSource = await Cesium.GeoJsonDataSource.load(taggedWfsGeojson(geojson), { ...defaultVectorStyle(layer), clampToGround: false });
    if (controller.signal.aborted) {
      try { dataSource.entities.removeAll(); } catch { }
      return;
    }
    await prepareWfsGeometryHeights(dataSource, layer);
    applyWfsStyle(dataSource, layer);
    applyExtrusionStyle(dataSource, layer);
    for (const entity of dataSource.entities.values) {
      entity.name = layer.name;
      entity._qtilerLayerItem = item;
      entity.description = featureInfoHtml(entity.properties?.getValue(viewer.clock.currentTime) || {}, layer.infoFields, window.location.origin);
    }
    dataSource.show = visible;
    await viewer.dataSources.add(dataSource);
    if (item.object) {
      removeWfsSurfaceMeshes(item.object);
      try { viewer.dataSources.remove(item.object, true); } catch { }
    }
    item.object = dataSource;
    updateUndergroundView(dataSource);
    item.geojson = geojson;
    dualMap?.syncLayers();
    item.error = null;
    item.loading = false;
    visibleWfsState.lastKeyByLayer.set(layer.key, bboxKey(layer, requestBbox, requestMode));
  } catch (err) {
    item.loading = false;
    if (err?.name !== 'AbortError') { item.error = err.message; setStatus(`${item.label}: ${err.message}`, 'error'); console.warn('[Qtiler-3D-eye] visible WFS failed', layer, err); }
  } finally {
    if (visibleWfsState.controllers.get(layer.key) === controller) visibleWfsState.controllers.delete(layer.key);
  }
}

async function updateVisibleWfsLayers() {
  visibleWfsState.timer = null;
  if (visibleWfsState.running) {
    visibleWfsState.rerun = true;
    return;
  }
  const bbox = currentViewBbox();
  if (!bbox) {
    scheduleVisibleWfsUpdate(500);
    return;
  }
  visibleWfsState.running = true;
  try {
    const items = Array.from(runtimeItems.values()).filter((item) => item.type === 'wfs');
    if (items.length) setStatus('Cargando WFS visibles...');
    for (const item of items) {
      await loadVisibleWfsItem(item, bbox);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const failed = items.filter((item) => item.error);
    if (failed.length) setStatus(failed.map((item) => `${item.label}: ${item.error}`).join(' | '), 'error');
    else if (items.length) setStatus('Ready.');
    scheduleLazyGltfUpdate();
  } finally {
    visibleWfsState.running = false;
    if (visibleWfsState.rerun) {
      visibleWfsState.rerun = false;
      scheduleVisibleWfsUpdate(120);
    }
  }
}

function scheduleVisibleWfsUpdate(delay = 220) {
  if (visibleWfsState.timer) clearTimeout(visibleWfsState.timer);
  visibleWfsState.timer = setTimeout(updateVisibleWfsLayers, delay);
}

function emptyHeightmapTile(width, height) {
  return new Float32Array(Number(width || 65) * Number(height || 65));
}

async function applyTerrain(config) {
  const flatProvider = new Cesium.EllipsoidTerrainProvider();
  const flatTerrain = { label: 'Flat terrain', category: 'terrain', type: 'flat', object: flatProvider, selected: true };
  runtimeItems.set('terrain:flat', flatTerrain);
  activeTerrainItem = flatTerrain;
  viewer.terrainProvider = flatProvider;
  const terrains = config.config?.terrains || [];
  for (const terrain of terrains) {
    runtimeItems.set(terrain.key || `terrain:${terrain.name}`, { label: terrain.name || 'Terrain', category: 'terrain', type: terrain.type, object: null, terrain, selected: false });
  }
  const terrain = terrains.find((item) => item.visible !== false && ['heightmap', 'quantized-mesh'].includes(item.type));
  if (terrain) await selectTerrain(terrain.key || `terrain:${terrain.name}`);
}

async function selectTerrain(key) {
  const item = runtimeItems.get(key);
  if (!item || item.category !== 'terrain') return;
  const sequence = ++terrainSelectionSequence;
  const terrain = item.terrain;
  try {
    if (!item.object) item.object = await createTerrainProvider(terrain);
    if (sequence !== terrainSelectionSequence) return;
    viewer.terrainProvider = item.object;
    activeTerrainItem = item;
    for (const candidate of runtimeItems.values()) if (candidate.category === 'terrain') candidate.selected = candidate === item;
    terrainWarning.hidden = true;
    setStatus(item.label);
    renderLayerPanel(currentConfig || { config: {} });
    await alignGeneratedTilesToTerrain();
    await sketchEditor?.refreshTerrain();
    for (const candidate of runtimeItems.values()) {
      if (candidate.type !== 'wfs' || !candidate.object) continue;
      await prepareWfsGeometryHeights(candidate.object, candidate.layer);
      applyWfsStyle(candidate.object, candidate.layer);
      applyExtrusionStyle(candidate.object, candidate.layer);
    }
  } catch (error) { setStatus(`${item.label}: ${error.message}`, 'error'); }
}

async function createTerrainProvider(terrain) {
  terrainWarning.hidden = true;

  if (terrain.type === 'heightmap' && terrain.heightmapInfoUrl && terrain.heightmapTileUrlTemplate) {
    const infoResponse = await fetch(terrain.heightmapInfoUrl, { credentials: 'include' });
    if (!infoResponse.ok) throw new Error(`HTTP ${infoResponse.status}`);
    const info = await infoResponse.json();
    if (!info.available) throw new Error('Terrain is not available');
    if (!terrain.bounds && info.bounds) terrain.bounds = info.bounds;
    return new Cesium.CustomHeightmapTerrainProvider({
      width: info.tileWidth,
      height: info.tileHeight,
      tilingScheme: new Cesium.GeographicTilingScheme(),
      callback: async (x, y, level) => {
        const url = terrain.heightmapTileUrlTemplate.replace('{z}', level).replace('{x}', x).replace('{y}', y);
        try {
          const response = await fetch(url, { credentials: 'include' });
          if (!response.ok) return emptyHeightmapTile(info.tileWidth, info.tileHeight);
          return new Float32Array(await response.arrayBuffer());
        } catch {
          return emptyHeightmapTile(info.tileWidth, info.tileHeight);
        }
      }
    });
  }

  if (terrain.type === 'quantized-mesh' && terrain.terrainUrl) {
    return Cesium.CesiumTerrainProvider.fromUrl(new URL(terrain.terrainUrl, window.location.origin).toString(), {
      requestVertexNormals: true
    });
  }
  throw new Error('Terrain provider is not ready');
}

function placementToMatrix(placement = {}) {
  const longitude = Number(placement.longitude);
  const latitude = Number(placement.latitude);
  const height = Number(placement.height || 0);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return Cesium.Matrix4.IDENTITY;
  const position = Cesium.Cartesian3.fromDegrees(longitude, latitude, height);
  const heading = Cesium.Math.toRadians(Number(placement.heading || 0));
  const pitch = Cesium.Math.toRadians(Number(placement.pitch || 0));
  const roll = Cesium.Math.toRadians(Number(placement.roll || 0));
  const hpr = new Cesium.HeadingPitchRoll(heading, pitch, roll);
  const matrix = Cesium.Transforms.headingPitchRollToFixedFrame(position, hpr);
  const scale = Number(placement.scale || 1);
  if (Number.isFinite(scale) && scale !== 1) {
    return Cesium.Matrix4.multiplyByUniformScale(matrix, scale, new Cesium.Matrix4());
  }
  return matrix;
}

async function terrainHeightAt(longitude, latitude) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return 0;
  const cartographic = Cesium.Cartographic.fromDegrees(longitude, latitude, 0);
  try {
    if (viewer?.terrainProvider && !(viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider)) {
      const sampled = viewer.terrainProvider.availability
        ? await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [cartographic])
        : await Cesium.sampleTerrain(viewer.terrainProvider, 12, [cartographic]);
      const height = Number(sampled?.[0]?.height);
      if (Number.isFinite(height)) return height;
    }
  } catch { }
  try {
    const height = Number(viewer?.scene?.globe?.getHeight(cartographic));
    if (Number.isFinite(height)) return height;
  } catch { }
  return 0;
}

function viewCenterDegrees() {
  const bbox = currentViewBbox();
  if (bbox) return { longitude: (bbox[0] + bbox[2]) / 2, latitude: (bbox[1] + bbox[3]) / 2 };
  try {
    const cartographic = viewer.camera.positionCartographic;
    return { longitude: Cesium.Math.toDegrees(cartographic.longitude), latitude: Cesium.Math.toDegrees(cartographic.latitude) };
  } catch { }
  return { longitude: 0, latitude: 0 };
}

async function placementToGroundMatrix(placement = {}) {
  let longitude = Number(placement.longitude);
  let latitude = Number(placement.latitude);

  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    const center = viewCenterDegrees();
    longitude = center.longitude;
    latitude = center.latitude;
  }

  const relativeHeight = Number(placement.height || 0);
  const groundHeight = await terrainHeightAt(longitude, latitude);

  return placementToMatrix({
    ...placement,
    longitude,
    latitude,
    height: groundHeight + (Number.isFinite(relativeHeight) ? relativeHeight : 0)
  });
}

async function zoomToAssetObject(object, asset = {}) {
  try {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await viewer.zoomTo(object);
    const sphere = object?.boundingSphere;
    if (sphere?.center && Number.isFinite(Number(sphere.radius))) {
      const range = Math.max(25, Number(sphere.radius) * 3.2);
      viewer.camera.viewBoundingSphere(sphere, new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-22), range));
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      return;
    }
  } catch { }
  try {
    const longitude = Number(asset.placement?.longitude ?? 0);
    const latitude = Number(asset.placement?.latitude ?? 0);
    const height = Number(asset.placement?.height ?? 0);
    const target = Cesium.Cartesian3.fromDegrees(Number.isFinite(longitude) ? longitude : 0, Number.isFinite(latitude) ? latitude : 0, Number.isFinite(height) ? height : 0);
    viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-25), 75));
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  } catch {
    try { viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(0, 0, 90), orientation: { heading: 0, pitch: Cesium.Math.toRadians(-35), roll: 0 } }); } catch { }
  }
}

async function alignGeneratedTilesToTerrain() {
  const provider = viewer.terrainProvider;
  for (const item of runtimeItems.values()) {
    if (item.type !== '3dtiles' || item.asset?.metadata?.source !== 'qgis3d-tiles') continue;
    const metadata = item.asset.metadata;
    const region = item.region || metadata.region;
    const reference = item.terrainReference || metadata.terrainReference;
    const selectedTerrain = typeof activeTerrainItem === 'undefined' ? null : activeTerrainItem;
    if (metadata.demPath && !reference) {
      if (selectedTerrain?.terrain) {
        terrainWarning.hidden = false;
        terrainWarning.textContent = window.qtiler3dI18n?.t('messages', 'tilesLegacyTerrain', { layer: item.label }) || `3D Tiles “${item.label}” were built against a DEM without a stored reference point. Regenerate them against the active terrain to correct alignment.`;
      }
      continue;
    }
    const longitude = reference?.longitude ?? (region?.length === 6 ? Cesium.Math.toDegrees((region[0] + region[2]) / 2) : NaN);
    const latitude = reference?.latitude ?? (region?.length === 6 ? Cesium.Math.toDegrees((region[1] + region[3]) / 2) : NaN);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    const height = await terrainHeightAt(longitude, latitude);
    if (viewer.terrainProvider !== provider) return;
    const sourceHeight = Number(reference?.height ?? region?.[4] ?? 0);
    const demTerrainProjectId = String(metadata.demTerrainProjectId || metadata.demTerrainRecordId || '');
    const activeTerrainIds = [selectedTerrain?.terrain?.projectId, selectedTerrain?.terrain?.sourceProjectId, selectedTerrain?.terrain?.id, selectedTerrain?.terrain?.assetId]
      .filter(Boolean).map(String);
    const sameTerrain = !!metadata.demPath && !!demTerrainProjectId && activeTerrainIds.includes(demTerrainProjectId) && Math.abs(height - sourceHeight) <= 2;
    if (sameTerrain) { item.object.modelMatrix = Cesium.Matrix4.IDENTITY; continue; }
    const original = Cesium.Cartesian3.fromDegrees(longitude, latitude, sourceHeight);
    const grounded = Cesium.Cartesian3.fromDegrees(longitude, latitude, height);
    const offset = Cesium.Cartesian3.subtract(grounded, original, new Cesium.Cartesian3());
    item.object.modelMatrix = Cesium.Matrix4.fromTranslation(offset);
    if (activeTerrainIds.length && !sameTerrain && (metadata.demPath || metadata.terrainProjects?.length || metadata.terrainAssetIds?.length)) {
      terrainWarning.hidden = false;
      terrainWarning.textContent = window.qtiler3dI18n?.t('messages', 'tilesTerrainMismatch', { layer: item.label }) || `3D Tiles “${item.label}” were generated for another terrain. Their vertical alignment uses a reference-point offset; regenerate them with the active terrain for exact grounding.`;
    }
  }
}

async function addAssets(config) {
  const assets = config.config?.assets || [];
  const isAssetPreview = config.config?.previewMode === 'asset' || config.scene?.assetPreview === true;
  for (const asset of assets) {
    try {
      let object = null;
      const url = asset.url ? new URL(asset.url, window.location.origin).toString() : '';
      if (asset.type === 'ion-3dtiles') {
        object = await Cesium.Cesium3DTileset.fromIonAssetId(asset.ionAssetId);
        object.show = asset.visible !== false;
        viewer.scene.primitives.add(object);
      } else if (asset.type === '3dtiles') {
        object = await Cesium.Cesium3DTileset.fromUrl(url);
        object.show = asset.visible !== false;
        if (asset.metadata?.source !== 'qgis3d-tiles') object.modelMatrix = await placementToGroundMatrix(asset.placement);
        viewer.scene.primitives.add(object);
      } else if (asset.type === 'model') {
        object = await Cesium.Model.fromGltfAsync({ url, modelMatrix: await placementToGroundMatrix(asset.placement) });
        object.show = asset.visible !== false;
        viewer.scene.primitives.add(object);
      } else if (asset.type === 'czml') {
        object = await Cesium.CzmlDataSource.load(url);
        object.show = asset.visible !== false;
        await viewer.dataSources.add(object);
      } else if (asset.type === 'geojson') {
        object = await Cesium.GeoJsonDataSource.load(url, { clampToGround: true });
        object.show = asset.visible !== false;
        await viewer.dataSources.add(object);
      } else if (asset.type === 'kml') {
        object = await Cesium.KmlDataSource.load(url, { camera: viewer.scene.camera, canvas: viewer.scene.canvas, clampToGround: true });
        object.show = asset.visible !== false;
        await viewer.dataSources.add(object);
      }
      if (object) {
        const item = { label: asset.name, category: 'asset', type: asset.type, object, asset };
        object._qtilerUnderground = asset.metadata?.showUnderground === true;
        runtimeItems.set(`asset:${asset.id}`, item);
        updateUndergroundView(object);
        if (asset.type === '3dtiles' && asset.metadata?.source === 'qgis3d-tiles') {
          const response = await fetch(url, { credentials: 'include' });
          if (!response.ok) throw new Error(`Tileset HTTP ${response.status}`);
          const tileset = await response.json();
          item.region = asset.metadata.region || tileset.root?.boundingVolume?.region;
          item.terrainReference = asset.metadata.terrainReference || tileset.extras?.terrainReference || null;
          await alignGeneratedTilesToTerrain();
        }
      }
      if (object && isAssetPreview) {
        await zoomToAssetObject(object, asset);
      }
    } catch (err) {
      console.warn('[Qtiler-3D-eye] asset load failed', asset, err);
    }
  }
}

function setRuntimeVisible(item, visible) {
  if (item?.layer) item.layer.visible = visible;
  if (item?.type === 'wfs') scheduleVisibleWfsUpdate(80);
  dualMap?.syncLayers();
  if (!item?.object) return;
  if ('show' in item.object) item.object.show = visible;
  if (item.type === 'wfs') {
    applyWfsStyle(item.object, item.layer);
    if (visible) applyExtrusionStyle(item.object, item.layer);
  } else updateUndergroundView(item.object);
  dualMap?.syncLayers();
}

function updateZoomDependentItems() {
  const zoom = currentApproxZoom();
  for (const item of runtimeItems.values()) {
    if (!item.layer) continue;
    const visible = item.layer.visible !== false && zoomInRange(item.layer, zoom);
    if (item.type === 'wfs') {
      if (item.object) {
        applyWfsStyle(item.object, item.layer);
        applyExtrusionStyle(item.object, item.layer);
      }
      scheduleVisibleWfsUpdate(120);
    } else if (item.type === 'wms' && !item.layer.isBaseLayer) {
      setRuntimeVisible(item, visible);
    }
  }
}

function setRuntimeOpacity(item, opacity) {
  const value = Math.max(0, Math.min(1, Number(opacity)));
  if (!Number.isFinite(value)) return;
  item.opacity = value;
  if (item.layer) item.layer.opacity = value;
  if (item.object && 'alpha' in item.object) item.object.alpha = value;
  if (item.type === 'wfs' && item.object) {
    applyWfsStyle(item.object, item.layer);
    applyExtrusionStyle(item.object, item.layer);
  }
  dualMap?.syncLayers();
}

async function zoomToLayer(item) {
  const bounds = item?.layer?.projectBounds;
  if (dualMap && (dualMap.mode === '2d' || dualMap.activeMap === '2d') && bounds?.length === 4) {
    dualMap.zoomToExtent(bounds);
    return;
  }
  if (item?.type === 'wfs' && item.object) {
    const sphere = new Cesium.BoundingSphere();
    const result = await viewer.dataSources.getBoundingSphere(item.object, false, sphere);
    if (result === Cesium.BoundingSphereState.DONE && sphere.radius > 0) {
      viewer.camera.flyToBoundingSphere(sphere, { duration: 0.8 });
      return;
    }
  }
  if (bounds?.length === 4) {
    viewer.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(...bounds), duration: 0.8 });
    return;
  }
  setStatus(window.qtiler3dI18n?.t('layerManager', 'noExtent', { name: item?.label || 'this layer' }) || `No map extent is available for ${item?.label || 'this layer'}.`, 'error');
}

function setBackgroundVisible(key) {
  for (const [itemKey, item] of runtimeItems.entries()) {
    if (item.category !== 'background') continue;
    setRuntimeVisible(item, itemKey === key);
    if (itemKey === key && item.object) try { viewer.imageryLayers.raiseToTop(item.object); } catch { }
  }
  renderLayerPanel(currentConfig || { config: {} });
  dualMap?.syncLayers();
}

function renderLayerPanel(config) {
  const modules = config.config?.modules || {};
  if (modules.layers === false && modules.models === false) return;
  const layerGroups = Array.isArray(config.config?.layerGroups) ? config.config.layerGroups : [];
  const canManageGroups = config.config?.canManageLayerGroups === true && !!sceneId && params.get('editor') !== '1';
  const manager = document.getElementById('layerGroupManager');
  const rootGroups = layerGroups.filter((group) => !group.parentId);
  const groupOptions = (selected = '') => [
    `<option value="">${viewerText(window.qtiler3dI18n?.t('layerManager', 'ungrouped') || 'Ungrouped')}</option>`,
    ...rootGroups.flatMap((group) => [
      `<option value="${viewerText(group.id)}" ${selected === group.id ? 'selected' : ''}>${viewerText(group.name)}</option>`,
      ...layerGroups.filter((child) => child.parentId === group.id).map((child) => `<option value="${viewerText(child.id)}" ${selected === child.id ? 'selected' : ''}>— ${viewerText(child.name)}</option>`)
    ])
  ].join('');
  if (manager) {
    manager.hidden = !canManageGroups || layerTab !== 'layers';
    manager.innerHTML = canManageGroups && layerTab === 'layers' ? `
      <h3>${viewerText(window.qtiler3dI18n?.t('layerManager', 'organize') || 'Organize layers')}</h3>
      <div class="layer-group-manager-row">
        <input type="text" maxlength="80" data-new-layer-group placeholder="${viewerText(window.qtiler3dI18n?.t('layerManager', 'groupName') || 'New group name')}" aria-label="${viewerText(window.qtiler3dI18n?.t('layerManager', 'groupName') || 'New group name')}">
        <button type="button" data-add-layer-group>${viewerText(window.qtiler3dI18n?.t('layerManager', 'addGroup') || 'Add group')}</button>
      </div>
      <div class="layer-group-manager-row layer-group-manager-row--subgroup">
        <select data-subgroup-parent aria-label="${viewerText(window.qtiler3dI18n?.t('layerManager', 'parentGroup') || 'Choose parent group')}"><option value="">${viewerText(window.qtiler3dI18n?.t('layerManager', 'parentGroup') || 'Choose parent group')}</option>${rootGroups.map((group) => `<option value="${viewerText(group.id)}">${viewerText(group.name)}</option>`).join('')}</select>
        <input type="text" maxlength="80" data-new-layer-subgroup placeholder="${viewerText(window.qtiler3dI18n?.t('layerManager', 'subgroupName') || 'Subgroup name')}" aria-label="${viewerText(window.qtiler3dI18n?.t('layerManager', 'subgroupName') || 'Subgroup name')}">
        <button type="button" data-add-layer-subgroup>${viewerText(window.qtiler3dI18n?.t('layerManager', 'addSubgroup') || 'Add subgroup')}</button>
      </div>
      ${layerGroups.length ? `<div class="layer-group-delete"><select data-delete-layer-group aria-label="${viewerText(window.qtiler3dI18n?.t('layerManager', 'remove') || 'Remove')}">${layerGroups.map((group) => `<option value="${viewerText(group.id)}">${group.parentId ? '— ' : ''}${viewerText(group.name)}</option>`).join('')}</select><button type="button" data-remove-layer-group>${viewerText(window.qtiler3dI18n?.t('layerManager', 'remove') || 'Remove')}</button></div>` : ''}
      <output data-layer-group-status role="status" aria-live="polite"></output>
    ` : '';
  }
  const groups = [
    ...(layerTab === 'backgrounds' ? [['background', 'Backgrounds']] : []),
    ...(layerTab === 'terrains' ? [['terrain', 'Terrains']] : []),
    ...(layerTab === 'layers' ? [['layer', 'Layers'], ['asset', 'Models / 3D Tiles']] : [])
  ];
  const renderEntry = ([key, item]) => {
    const checked = item.category === 'terrain' ? item.selected !== false : item.object?.show !== false;
    const inputType = item.category === 'background' || item.category === 'terrain' ? 'radio' : 'checkbox';
    const inputName = item.category === 'background' ? 'backgroundLayer' : (item.category === 'terrain' ? 'terrainLayer' : 'runtimeLayer');
    const legendUrl = item.legendIcon || item.layer?.legendUrl || (item.type === 'wms' && item.layer?.layerName ? `/wms?project=${encodeURIComponent(item.layer.projectId || '')}&SERVICE=WMS&REQUEST=GetLegendGraphic&FORMAT=image/png&LAYER=${encodeURIComponent(item.layer.layerName)}` : '');
    const geometryType = String(item.layer?.geometryType || '').toLowerCase();
    const styles = item.type === 'wfs' ? (Array.isArray(item.layer.styleRules) && item.layer.styleRules.length ? item.layer.styleRules : [item.layer]) : [];
    const fallbackLegend = styles.length ? `<span class="legend-swatches" aria-label="Layer symbology">${styles.map((style) => {
      const colorValue = style.color || '#2f80ed'; const fillValue = style.fillColor || colorValue; const strokeValue = style.strokeColor || '#ffffff';
      const color = CSS.supports('color', colorValue) ? colorValue : '#2f80ed'; const fill = CSS.supports('color', fillValue) ? fillValue : color; const stroke = CSS.supports('color', strokeValue) ? strokeValue : '#ffffff';
      const shape = geometryType.includes('point') ? `<circle cx="12" cy="12" r="6" fill="${fill}" stroke="${stroke}" stroke-width="2"/>` : geometryType.includes('line') ? `<path d="M2 18L22 6" fill="none" stroke="${color}" stroke-width="3" ${style.dash === 'dashed' ? 'stroke-dasharray="4 3"' : ''}/>` : `<path d="M4 5H20V19H4Z" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${shape}</svg>`;
      return `<img src="data:image/svg+xml,${encodeURIComponent(svg)}" alt="${viewerText(style.label || item.label)}" title="${viewerText(style.label || item.label)}">`;
    }).join('')}</span>` : '<span class="legend-fallback" aria-label="Layer legend"><i class="bx bx-layer" aria-hidden="true"></i></span>';
    const operationalLayer = item.category === 'layer';
    return `
      <article class="layer-row">
        <div class="layer-row-main">
          <input type="${inputType}" name="${inputName}" data-runtime-key="${viewerText(key)}" ${checked ? 'checked' : ''} aria-label="Toggle ${viewerText(item.label)}">
          <span class="layer-row-name" title="${viewerText(item.label)}">${viewerText(item.label)}</span>
          <span class="layer-row-actions">
            ${operationalLayer ? `<button type="button" data-zoom-key="${viewerText(key)}" title="${viewerText(window.qtiler3dI18n?.t('layerManager', 'zoom') || 'Zoom to layer')}" aria-label="${viewerText(window.qtiler3dI18n?.t('layerManager', 'zoom') || 'Zoom to layer')} ${viewerText(item.label)}"><i class="bx bx-zoom-in" aria-hidden="true"></i></button>` : ''}
            ${item.asset && !item.asset.readonly && (item.type === 'model' || item.type === '3dtiles') ? `<button type="button" data-place-key="${viewerText(key)}" title="${viewerText(window.qtiler3dI18n?.t('layerManager', 'place') || 'Place model')}" aria-label="${viewerText(window.qtiler3dI18n?.t('layerManager', 'place') || 'Place model')} ${viewerText(item.label)}"><i class="bx bx-map-pin" aria-hidden="true"></i></button>` : ''}
          </span>
        </div>
        <div class="layer-row-detail">
          <span class="layer-legend">${legendUrl ? `<img src="${viewerText(legendUrl)}" alt="" class="legend-icon" loading="lazy"><span class="legend-fallback" hidden><i class="bx bx-layer" aria-hidden="true"></i></span>` : fallbackLegend}</span>
          ${operationalLayer ? `<label class="layer-opacity" title="${viewerText(window.qtiler3dI18n?.t('layerManager', 'opacity') || 'Opacity')}"><span>${viewerText(window.qtiler3dI18n?.t('layerManager', 'opacity') || 'Opacity')}</span><input type="range" min="0" max="100" value="${Math.round((item.opacity ?? 1) * 100)}" data-opacity-key="${viewerText(key)}" aria-label="${viewerText(window.qtiler3dI18n?.t('layerManager', 'opacity') || 'Opacity')} ${viewerText(item.label)}"></label>${canManageGroups ? `<select class="layer-group-select" data-group-layer-key="${viewerText(key)}" aria-label="Group for ${viewerText(item.label)}">${groupOptions(item.layer?.groupId || '')}</select>` : '<span></span>'}` : ''}
        </div>
      </article>`;
  };
  const renderGroupedLayers = (entries) => {
    const renderGroup = (group) => {
      const ownEntries = entries.filter(([, item]) => item.layer?.groupId === group.id);
      const children = layerGroups.filter((candidate) => candidate.parentId === group.id);
      const content = [
        ...ownEntries.map(renderEntry),
        ...children.map(renderGroup)
      ].join('');
      return `<details class="layer-nested-group" open><summary>${viewerText(group.name)}</summary>${content || `<p class="layer-group-empty">${viewerText(window.qtiler3dI18n?.t('layerManager', 'empty') || 'No layers in this group.')}</p>`}</details>`;
    };
    const groupedIds = new Set(layerGroups.map((group) => group.id));
    const ungrouped = entries.filter(([, item]) => !groupedIds.has(item.layer?.groupId));
    return `${rootGroups.map(renderGroup).join('')}${ungrouped.map(renderEntry).join('')}`;
  };
  layerList.innerHTML = groups.map(([category, title]) => {
    const entries = Array.from(runtimeItems.entries()).filter(([, item]) => item.category === category);
    if (!entries.length) return '';
    return `<section class="layer-group"><h3>${title}</h3>${category === 'layer' ? renderGroupedLayers(entries) : entries.map(renderEntry).join('')}</section>`;
  }).join('') || '<p>No layers or assets loaded.</p>';
  layerList.querySelectorAll('.legend-icon').forEach((image) => image.addEventListener('error', () => { image.hidden = true; image.nextElementSibling?.removeAttribute('hidden'); }));
  layerList.querySelectorAll('[data-runtime-key]').forEach((input) => {
    input.addEventListener('change', () => {
      const item = runtimeItems.get(input.dataset.runtimeKey);
      if (item?.category === 'background') setBackgroundVisible(input.dataset.runtimeKey);
      else if (item?.category === 'terrain') selectTerrain(input.dataset.runtimeKey);
      else setRuntimeVisible(item, input.checked);
    });
  });
  layerList.querySelectorAll('[data-place-key]').forEach((button) => {
    button.addEventListener('click', () => startPlacement(runtimeItems.get(button.dataset.placeKey)));
  });
  layerList.querySelectorAll('[data-zoom-key]').forEach((button) => {
    button.addEventListener('click', () => zoomToLayer(runtimeItems.get(button.dataset.zoomKey)).catch(reportViewerError));
  });
  layerList.querySelectorAll('[data-opacity-key]').forEach((input) => {
    input.addEventListener('input', () => setRuntimeOpacity(runtimeItems.get(input.dataset.opacityKey), Number(input.value) / 100));
  });
  layerList.querySelectorAll('[data-group-layer-key]').forEach((select) => {
    select.addEventListener('change', () => {
      const item = runtimeItems.get(select.dataset.groupLayerKey);
      if (!item?.layer) return;
      item.layer.groupId = select.value || null;
      saveLayerGroupLayout(config).catch((error) => {
        const output = manager?.querySelector('[data-layer-group-status]');
        if (output) output.textContent = error.message;
      });
    });
  });
  manager?.querySelector('[data-add-layer-group]')?.addEventListener('click', () => {
    const name = manager.querySelector('[data-new-layer-group]').value.trim();
    if (!name) return;
    saveLayerGroupLayout(config, [...layerGroups, { id: `group_${crypto.randomUUID()}`, name, parentId: null }]).catch((error) => {
      manager.querySelector('[data-layer-group-status]').textContent = error.message;
    });
  });
  manager?.querySelector('[data-add-layer-subgroup]')?.addEventListener('click', () => {
    const parentId = manager.querySelector('[data-subgroup-parent]').value;
    const name = manager.querySelector('[data-new-layer-subgroup]').value.trim();
    if (!parentId || !name) return;
    saveLayerGroupLayout(config, [...layerGroups, { id: `group_${crypto.randomUUID()}`, name, parentId }]).catch((error) => {
      manager.querySelector('[data-layer-group-status]').textContent = error.message;
    });
  });
  manager?.querySelector('[data-remove-layer-group]')?.addEventListener('click', () => {
    const id = manager.querySelector('[data-delete-layer-group]').value;
    const group = layerGroups.find((item) => item.id === id);
    if (!group || !confirm(window.qtiler3dI18n?.t('layerManager', 'removeGroup', { name: group.name }) || `Remove "${group.name}"? Layers in it will become ungrouped.`)) return;
    const nextGroups = layerGroups.filter((item) => item.id !== id).map((item) => item.parentId === id ? { ...item, parentId: null } : item);
    for (const item of runtimeItems.values()) if (item.layer?.groupId === id) item.layer.groupId = null;
    saveLayerGroupLayout(config, nextGroups).catch((error) => {
      manager.querySelector('[data-layer-group-status]').textContent = error.message;
    });
  });
  saveViewBtn.hidden = modules.bookmarks === false;
  saveViewBtn.onclick = () => saveNamedView().catch(reportViewerError);
}

async function saveLayerGroupLayout(config, groups = config.config?.layerGroups || []) {
  const assignments = Object.fromEntries(Array.from(runtimeItems.entries())
    .filter(([, item]) => item.category === 'layer' && item.layer?.groupId)
    .map(([key, item]) => [key, item.layer.groupId]));
  const result = await fetch(`${API_BASE}/api/scenes/${encodeURIComponent(sceneId)}/layer-groups`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groups, assignments })
  });
  const payload = await result.json().catch(() => null);
  if (!result.ok) throw new Error([payload?.error || `HTTP ${result.status}`, payload?.details].filter(Boolean).join(' — '));
  config.config.layerGroups = payload.groups;
  config.scene.layerGroups = payload.groups;
  config.scene.layerAssignments = payload.assignments;
  for (const [key, item] of runtimeItems) if (item.category === 'layer' && item.layer) item.layer.groupId = payload.assignments[key] || null;
  renderLayerPanel(config);
  const status = document.querySelector('[data-layer-group-status]');
  if (status) status.textContent = window.qtiler3dI18n?.t('layerManager', 'saved') || 'Saved to this map.';
}

function toggleLayerDialog(config) {
  renderLayerPanel(config);
  layerPanel.hidden = !layerPanel.hidden;
  hideToolPopup();
}

function pickGlobePosition(position) {
  if (viewer.scene.pickPositionSupported) {
    const picked = viewer.scene.pickPosition(position);
    if (Cesium.defined(picked)) return picked;
  }
  const ray = viewer.camera.getPickRay(position);
  return ray ? viewer.scene.globe.pick(ray, viewer.scene) : null;
}

function startSketchTool(kind) {
  clearActiveTool();
  dualMap?.suspendFeatureInfo(true);
  activeSketch = { kind, positions: [], preview: null };
  activeToolHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  setStatus(kind === 'point' ? 'Sketch: haz clic para añadir un punto.' : 'Sketch: haz clic para añadir vértices, clic derecho para finalizar.');

  activeToolHandler.setInputAction((event) => {
    const position = pickGlobePosition(event.position);
    if (!position) return;

    if (kind === 'point') {
      sketchItems.push(viewer.entities.add({
        position,
        properties: { isDrawing: true },
        point: { pixelSize: 10, color: Cesium.Color.CYAN, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY }
      }));
      return;
    }

    activeSketch.positions.push(position);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  activeToolHandler.setInputAction((event) => {
    if (kind === 'point' || activeSketch.positions.length === 0) return;
    const movePosition = pickGlobePosition(event.endPosition);
    if (!movePosition) return;

    const dynamicPositions = [...activeSketch.positions, movePosition];

    if (activeSketch.preview) viewer.entities.remove(activeSketch.preview);

    if (kind === 'line' && dynamicPositions.length > 1) {
      activeSketch.preview = viewer.entities.add({
        polyline: {
          positions: new Cesium.CallbackProperty(() => dynamicPositions, false),
          width: 3,
          clampToGround: true,
          material: Cesium.Color.CYAN
        }
      });
    } else if (kind === 'polygon' && dynamicPositions.length > 2) {
      activeSketch.preview = viewer.entities.add({
        polygon: {
          hierarchy: new Cesium.CallbackProperty(() => new Cesium.PolygonHierarchy(dynamicPositions), false),
          material: Cesium.Color.CYAN.withAlpha(0.35),
          outline: true,
          outlineColor: Cesium.Color.WHITE,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
        }
      });
    }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  activeToolHandler.setInputAction(() => {
    const positions = activeSketch?.positions?.slice() || [];
    if (kind === 'line' && positions.length >= 2) {
      sketchItems.push(viewer.entities.add({ properties: { isDrawing: true }, polyline: { positions, width: 3, clampToGround: true, material: Cesium.Color.CYAN } }));
    } else if (kind === 'polygon' && positions.length >= 3) {
      sketchItems.push(viewer.entities.add({ properties: { isDrawing: true }, polygon: { hierarchy: new Cesium.PolygonHierarchy(positions), material: Cesium.Color.CYAN.withAlpha(0.35), outline: true, outlineColor: Cesium.Color.WHITE, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND } }));
    }
    clearActiveTool();
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
}

function clearDrawings() {
  clearActiveTool();
  for (const item of sketchItems) viewer.entities.remove(item);
  for (const entity of [...viewer.entities.values]) {
    if (entity.properties?.isDrawing?.getValue?.(Cesium.JulianDate.now()) === true) viewer.entities.remove(entity);
  }
  sketchItems.length = 0;
  clearAllMeasurementsAndData();
}

function startPlacement(item) {
  if (!item?.asset) return;
  clearActiveTool();
  dualMap?.suspendFeatureInfo(true);
  setStatus(`Haz clic en el globo para posicionar: ${item.label}`);
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction(async (movement) => {
    try {
      const ray = viewer.camera.getPickRay(movement.position);
      const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
      if (!cartesian) return;
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      const longitude = Cesium.Math.toDegrees(cartographic.longitude);
      const latitude = Cesium.Math.toDegrees(cartographic.latitude);
      const placement = {
        ...(item.asset.placement || {}),
        longitude,
        latitude,
        height: Number(item.asset.placement?.height || 0),
        heading: Number(item.asset.placement?.heading || 0),
        pitch: Number(item.asset.placement?.pitch || 0),
        roll: Number(item.asset.placement?.roll || 0),
        scale: Number(item.asset.placement?.scale || 1)
      };
      item.asset.placement = placement;
      if ('modelMatrix' in item.object) item.object.modelMatrix = await placementToGroundMatrix(placement);
      const response = await fetch(`${API_BASE}/api/assets/${encodeURIComponent(item.asset.id)}/placement`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placement })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setStatus(`Posicion guardada para ${item.label}.`);
    } catch (err) {
      setStatus(`Could not save position: ${err.message || err}`, 'error');
    } finally {
      handler.destroy();
      dualMap?.suspendFeatureInfo(false);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  handler.setInputAction(() => { handler.destroy(); dualMap?.suspendFeatureInfo(false); setStatus('Ready.'); }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
}

function renderModules(config) {
  const modules = enabledModules(config.config?.modules || {}).filter((key) => key !== 'edit');
  if (config.config?.modules?.edit !== false && (config.config?.layers || []).some((layer) => layer.type === 'wfs' && layer.editable === true)) modules.push('edit');
  if (modules.includes('models')) modules.push('placeModel');
  modulesEl.innerHTML = modules.map((key) => `<span>${key}</span>`).join('');
  const iconByModule = {
    layers: 'bx-layer', measurement: 'bx-ruler', redline: 'bx-pencil', edit: 'bx-edit-alt', placeModel: 'bx-map-pin',
    bookmarks: 'bx-list-ul', print: 'bx-printer', shadows: 'bx-moon',
    models: 'bx-cube-alt', timeline: 'bx-time-five', skybox: 'bx-sun', simulation: 'bx-play-circle', feedback: 'bx-comment'
  };

  const toolboxKeys = {
    analysis: ['measurement', 'simulation', 'bookmarks', 'print'],
    edition: ['edit', 'redline'],
    visual: ['models', 'placeModel', 'shadows', 'skybox', 'timeline']
  };
  const toolboxIcons = { analysis: 'bx-line-chart', edition: 'bx-edit', visual: 'bx-show-alt' };
  const toolboxItems = Object.fromEntries(Object.entries(toolboxKeys).map(([group, keys]) => [group, keys.filter((key) => modules.includes(key))]));
  const t = (group, key) => window.qtiler3dI18n?.t(group, key) || key;
  const splitLabel = mapModeControl?.querySelector('[data-map-mode="split"] span');
  if (splitLabel) splitLabel.textContent = t('modes', 'both');
  const toolboxMarkup = Object.entries(toolboxItems).filter(([, keys]) => keys.length).map(([group, keys]) => `
    <details class="toolbox">
      <summary class="toolbox-heading" data-qtiler3d-i18n="toolboxes:${group}"><i class="bx ${toolboxIcons[group]}"></i><span>${t('toolboxes', group)}</span></summary>
      <div class="toolbox-actions">
        ${keys.map((key) => `<button type="button" class="tool-action button is-small is-light" data-tool="${key}" data-qtiler3d-tool="${key}" ${['shadows', 'skybox', 'simulation', 'models', 'placeModel', 'timeline'].includes(key) ? 'data-3d-only' : ''}><i class="bx ${iconByModule[key] || 'bx-cog'}" aria-hidden="true"></i><span data-tool-label>${t('tools', key)}</span></button>`).join('')}
      </div>
    </details>
  `).join('');
  const layerButton = modules.includes('layers') || modules.includes('models')
    ? `<button type="button" class="tool-launcher" data-tool="layers" data-qtiler3d-tool="layers" aria-label="${t('tools', 'layers')}" title="${t('tools', 'layers')}"><i class="bx bx-layer" aria-hidden="true"></i><span>${t('tools', 'layers')}</span></button>`
    : '';
  toolButtons.innerHTML = `${layerButton}${toolboxMarkup}`;

  toolButtons.querySelectorAll('.toolbox').forEach((toolbox) => toolbox.querySelector('summary').addEventListener('click', () => {
    if (toolbox.open) return;
    toolButtons.querySelectorAll('.toolbox[open]').forEach((other) => { if (other !== toolbox) other.open = false; });
    clearActiveTool();
    sketchEditor?.close();
    routeSimulation?.close();
    wfsEditor?.close();
    hideToolPopup();
    if (layerPanel) layerPanel.hidden = true;
    document.getElementById('modelPlacementPanel').hidden = true;
    document.getElementById('printPanel').hidden = true;
  }));
  window.qtiler3dI18n?.apply(toolButtons);
  window.qtiler3dI18n?.apply(mapModeControl);

  toolButtons.querySelectorAll('[data-tool]').forEach((button) => {
    button.addEventListener('click', () => {
      const tool = button.dataset.tool;
      const isAlreadyActive = button.classList.contains('active');
      const toolbox = button.closest('.toolbox');
      if (toolbox) toolbox.open = false;

      clearActiveTool();
      hideToolPopup();
      sketchEditor?.close();
      routeSimulation?.close();
      wfsEditor?.close();
      if (layerPanel) layerPanel.hidden = true;
      document.getElementById('modelPlacementPanel').hidden = true;
      document.getElementById('printPanel').hidden = true;
      toolButtons.querySelectorAll('button').forEach((b) => b.classList.remove('active'));

      if (isAlreadyActive && !['shadows', 'skybox', 'timeline'].includes(tool)) return;

      button.classList.add('active');

      if (tool === 'layers' || tool === 'models') {
        toggleLayerDialog(config);
      } else if (tool === 'measurement') {
        openMeasureWindow();
      } else if (tool === 'edit') {
        if (!wfsEditor) { setStatus('WFS editor is not ready', 'error'); return; }
        dualMap?.focus2d();
        wfsEditor.open().catch(reportViewerError);
      } else if (tool === 'placeModel') {
        openModelPlacementPanel().catch(reportViewerError);
      } else if (tool === 'redline') {
        sketchEditor.open();
      } else if (tool === 'shadows') {
        viewer.shadows = !viewer.shadows;
        viewer.scene.globe.enableLighting = viewer.shadows;
        button.classList.toggle('active', viewer.shadows);
      } else if (tool === 'bookmarks') {
        showSavedViews();
      } else if (tool === 'print') {
        document.getElementById('printTitle').value = currentConfig.scene?.title || '';
        document.getElementById('printDescription').value = currentConfig.scene?.description || '';
        document.getElementById('printPanel').hidden = false;
        window.qtiler3dI18n?.apply(document.getElementById('printPanel'));
      } else if (tool === 'timeline') {
        const clock = document.getElementById('compactClock');
        clock.hidden = !clock.hidden;
        button.classList.toggle('active', !clock.hidden);
      } else if (tool === 'skybox') {
        const visible = !viewer.scene.skyAtmosphere.show;
        viewer.scene.skyAtmosphere.show = visible;
        if (viewer.scene.skyBox) viewer.scene.skyBox.show = visible;
        if (viewer.scene.sun) viewer.scene.sun.show = visible;
        button.classList.toggle('active', visible);
      } else if (tool === 'simulation') {
        routeSimulation.open();
      } else if (tool === 'feedback') {
        startNoteTool();
      }
    });
  });
}

async function saveNamedView(initial = false) {
  const name = prompt('View name', 'View');
  if (!name) return;
  const view = cameraView();
  if (!sceneId || params.get('editor') === '1') throw new Error('Save the map before saving named views');
  const response = await fetch(`${API_BASE}/api/scenes/${encodeURIComponent(sceneId)}/views`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, view, initial }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  currentConfig.scene.savedViews = data.savedViews;
  currentConfig.scene.initialView = data.initialView;
  setStatus('View saved');
  showSavedViews();
}

function showSavedViews() {
  const views = currentConfig?.scene?.savedViews || [];
  showToolPopup('Saved views', [
    { key: 'save', label: 'Save view', icon: 'bx-save', run: () => saveNamedView() },
    { key: 'initial', label: 'Set initial view', icon: 'bx-home', run: () => saveNamedView(true) },
    ...views.map((view, index) => ({ key: `view-${index}`, label: view.name || `View ${index + 1}`, icon: 'bx-map', run: () => viewer.camera.flyTo({ destination: new Cesium.Cartesian3(...view.position), orientation: view.orientation }) }))
  ]);
}

function startOrbit() {
  clearActiveTool();
  const center = new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2);
  const target = pickGlobePosition(center);
  if (!target) throw new Error('Point the camera at the map before starting an orbit');
  let heading = viewer.camera.heading;
  const range = Cesium.Cartesian3.distance(viewer.camera.positionWC, target);
  const pitch = viewer.camera.pitch;
  let frame = null;
  let previous = performance.now();
  const step = (now) => { heading += (now - previous) * 0.00008; previous = now; viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(heading, pitch, range)); frame = requestAnimationFrame(step); };
  orbitStop = () => { cancelAnimationFrame(frame); viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY); };
  frame = requestAnimationFrame(step);
}

function addNoteEntity(note) {
  viewer.entities.add({ position: Cesium.Cartesian3.fromDegrees(note.longitude, note.latitude), point: { pixelSize: 10, color: Cesium.Color.YELLOW, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND }, label: { text: note.text, font: '14px sans-serif', pixelOffset: new Cesium.Cartesian2(0, -24), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
}

function startNoteTool() {
  clearActiveTool();
  dualMap?.suspendFeatureInfo(true);
  setStatus('Select a position for the note');
  activeToolHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  activeToolHandler.setInputAction(async (event) => {
    try {
      const position = pickGlobePosition(event.position);
      if (!position) return;
      const text = prompt('Note');
      if (!text) return;
      const location = Cesium.Cartographic.fromCartesian(position);
      const note = { longitude: Cesium.Math.toDegrees(location.longitude), latitude: Cesium.Math.toDegrees(location.latitude), text };
      const response = await fetch(`${API_BASE}/api/scenes/${encodeURIComponent(sceneId)}/notes`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(note) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      addNoteEntity(data.note);
      clearActiveTool();
      setStatus('Note saved');
    } catch (error) { reportViewerError(error); }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  activeToolHandler.setInputAction(clearActiveTool, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
}

async function flyToScene(config) {
  if (config.scene?.initialView) {
    const view = config.scene.initialView;
    viewer.camera.setView({ destination: new Cesium.Cartesian3(...view.position), orientation: view.orientation });
    return;
  }
  const previewTerrain = config.config?.terrains?.[0];
  const terrainBounds = normalizeTerrainBounds(previewTerrain?.bounds || previewTerrain?.rasterLayers?.[0]?.extent_wgs84);
  if (terrainBounds) {
    const cameraView = terrainPreviewCameraView(terrainBounds);
    viewer.homeButton.viewModel.command.beforeExecute.addEventListener((event) => {
      event.cancel = true;
      viewer.camera.flyTo({ ...cameraView, duration: 0.8 });
    });
    await new Promise((resolve) => viewer.camera.flyTo({ ...cameraView, duration: 1.2, complete: resolve, cancel: resolve }));
    return;
  }
  const projectId = config.scene?.mainProjectId;
  if (!projectId) return;
  try {
    const response = await fetch(`/wms?project=${encodeURIComponent(projectId)}&SERVICE=WMS&REQUEST=GetCapabilities`, { credentials: 'include' });
    if (!response.ok) return;
    const xml = await response.text();
    const west = Number(xml.match(/<westBoundLongitude>(.*?)<\/westBoundLongitude>/)?.[1]);
    const east = Number(xml.match(/<eastBoundLongitude>(.*?)<\/eastBoundLongitude>/)?.[1]);
    const south = Number(xml.match(/<southBoundLatitude>(.*?)<\/southBoundLatitude>/)?.[1]);
    const north = Number(xml.match(/<northBoundLatitude>(.*?)<\/northBoundLatitude>/)?.[1]);
    if (![west, east, south, north].every(Number.isFinite)) return;
    await new Promise((resolve) => viewer.camera.flyTo({
      destination: Cesium.Rectangle.fromDegrees(west, south, east, north),
      duration: 1.8,
      complete: resolve,
      cancel: resolve
    }));
  } catch { }
}

async function boot(previewConfig = null) {
  await waitForCesiumRuntime();
  if (!previewConfig && !sceneId && !terrainPreviewId && !terrainAssetPreviewId && !assetPreviewId) {
    setStatus('Missing ?scene=<id>, ?terrain=<id> or ?asset=<id>.', 'error');
    return;
  }
  setStatus('Cargando configuracion de escena...');
  const response = previewConfig ? null : assetPreviewId
    ? await fetch(`${API_BASE}/api/asset-preview-config/${encodeURIComponent(assetPreviewId)}`, { credentials: 'include' })
    : terrainPreviewId || terrainAssetPreviewId
      ? await fetch(`${API_BASE}/api/terrain-preview-config?${terrainPreviewId ? `terrain=${encodeURIComponent(terrainPreviewId)}` : `terrainAsset=${encodeURIComponent(terrainAssetPreviewId)}`}`, { credentials: 'include' })
      : await fetch(`${API_BASE}/api/view-config/${encodeURIComponent(sceneId)}`, { credentials: 'include' });
  const config = previewConfig || await response.json();
    currentConfig = config;
  if (response && !response.ok) throw new Error(config.error || 'view_config_failed');

  const isTerrainPreview = config.config?.previewMode === 'terrain' || config.scene?.terrainPreview === true;
  const isAssetPreview = config.config?.previewMode === 'asset' || config.scene?.assetPreview === true;
  titleEl.textContent = config.scene?.title || 'Qtiler 3D Eye';
  initViewer(config);
  ({ featureInfoHtml } = await import('./feature-info.js'));
  const { createRouteSimulation } = await import('./route-simulation.js');
  routeSimulation = createRouteSimulation({ viewer, pickGlobePosition, clearActiveTool, suspendInfo: (value) => dualMap?.suspendFeatureInfo(value), orbit: startOrbit,
    sketchFeatures: () => sketchEditor.features(), savedRoutes: () => currentConfig.scene.simulations || [],
    save: async (route) => {
      if (!sceneId || params.get('editor') === '1') throw new Error('Publish the map before saving camera routes');
      const response = await fetch(`${API_BASE}/api/scenes/${encodeURIComponent(sceneId)}/simulations`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(route) });
      const data = await response.json(); if (!response.ok) throw new Error(data.details || data.error);
      route.id = data.simulation.id; currentConfig.scene.simulations = data.simulations;
    },
    remove: async (id) => {
      const response = await fetch(`${API_BASE}/api/scenes/${encodeURIComponent(sceneId)}/simulations/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); currentConfig.scene.simulations = data.simulations;
    }
  });
  for (const note of config.scene?.notes || []) addNoteEntity(note);
  if (config.scene?.initialView) viewer.homeButton.viewModel.command.beforeExecute.addEventListener((event) => { event.cancel = true; flyToScene(currentConfig); });
    document.querySelectorAll('[data-layer-tab]').forEach((button) => {
      button.onclick = () => {
        layerTab = button.dataset.layerTab;
        document.querySelectorAll('[data-layer-tab]').forEach((tab) => tab.setAttribute('aria-selected', String(tab === button)));
        renderLayerPanel(currentConfig);
      };
    });
  viewer.camera.moveEnd.addEventListener(updateZoomDependentItems);
  if (!isTerrainPreview) renderModules(config);
  await addWmsLayers(config);
  await applyTerrain(config);
  if (!isTerrainPreview) renderLayerPanel(config);
  if (!isAssetPreview) await flyToScene(config);
  if (!isTerrainPreview && !isAssetPreview) {
    const { createDualMap } = await import('./dual-map.js?v=20261023-layer-tree');
    dualMap = createDualMap({ viewer, runtimeItems, effectiveStyle: effectiveStyleForEntity, styleZoom: currentApproxZoom, zoomInRange, featureInfo: featureInfoHtml, onCameraChange: () => scheduleVisibleWfsUpdate(180),
      cancelTools: () => { clearActiveTool(); sketchEditor.close(); routeSimulation.close(); wfsEditor?.close(); hideToolPopup(); },
      selectSketch: (index) => sketchEditor.select(index), error: reportViewerError, sketchFeatures: () => sketchEditor.features()
    });
    const { createWfsEditor } = await import('./wfs-editor.js?v=20261011-wfs-editor');
    wfsEditor = createWfsEditor({ map: dualMap.map, runtimeItems, onError: reportViewerError, suspendInfo: (value) => dualMap.suspendFeatureInfo(value), onSaved: async (item) => {
      visibleWfsState.lastKeyByLayer.delete(item.layer.key);
      visibleWfsState.cacheByLayer.delete(item.layer.key);
      if (item.object) { removeWfsSurfaceMeshes(item.object); viewer.dataSources.remove(item.object, true); item.object = null; }
      item.geojson = null;
      scheduleVisibleWfsUpdate(0);
    } });
    dualMap.fromCesium(); dualMap.syncLayers(); dualMap.syncSketch(sketchEditor.features());
    window.qtiler3dDebug.dualMap = dualMap;
    window.qtiler3dDebug.wfsEditor = wfsEditor;
    document.getElementById('zoomInButton').onclick = () => dualMap.activeMap === '2d' ? dualMap.zoom(1) : viewer.camera.zoomIn(Math.max(10, viewer.camera.positionCartographic.height * 0.35));
    document.getElementById('zoomOutButton').onclick = () => dualMap.activeMap === '2d' ? dualMap.zoom(-1) : viewer.camera.zoomOut(Math.max(10, viewer.camera.positionCartographic.height * 0.35));
    document.getElementById('northButton').onclick = () => dualMap.activeMap === '2d' ? dualMap.north() : orientCamera(0, viewer.camera.pitch);
    document.getElementById('homeViewButton').onclick = () => dualMap.home();
    document.getElementById('fullscreenViewButton').onclick = async () => {
      try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
      catch (error) { reportViewerError(error); }
    };
  }
  setStatus('Ready.');
  if (params.get('editor') === '1') window.parent.postMessage({ type: 'qtiler3d:loaded' }, location.origin);
  if (!isTerrainPreview) {
    addWfsLayers(config).then(() => {
      dualMap?.syncLayers();
      renderLayerPanel(config);
      setStatus('Ready.');
    }).catch((err) => console.warn('[Qtiler-3D-eye] WFS init failed', err));
    addAssets(config).then(() => { dualMap?.syncLayers(); renderLayerPanel(config); }).catch((err) => console.warn('[Qtiler-3D-eye] assets init failed', err));
  }
}

function reportViewerError(err) {
  console.error('[Qtiler-3D-eye]', err);
  setStatus(`Error: ${err.message || err}`, 'error');
}

if (params.get('editor') === '1' && window.parent !== window) {
  let initialized = false;
  window.addEventListener('message', async (event) => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    if (event.data?.type === 'qtiler3d:preview' && !initialized && event.data.config) { initialized = true; boot(event.data.config).catch(reportViewerError); }
    if (event.data?.type === 'qtiler3d:capture' && viewer) window.parent.postMessage({ type: 'qtiler3d:camera', view: cameraView() }, location.origin);
    if (event.data?.type === 'qtiler3d:capture-thumbnail' && viewer) {
      try {
        if (dualMap?.activeMap === '2d') dualMap.setMode('3d');
        viewer.resize();
        const image = await captureCurrentMap();
        const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
        const context = canvas.getContext('2d');
        const scale = Math.max(960 / image.canvas.width, 540 / image.canvas.height);
        const width = image.canvas.width * scale; const height = image.canvas.height * scale;
        context.drawImage(image.canvas, (960 - width) / 2, (540 - height) / 2, width, height);
        if (image.attribution) {
          context.fillStyle = 'rgba(255,255,255,.85)'; context.fillRect(0, 518, 960, 22);
          context.fillStyle = '#222'; context.font = '11px sans-serif'; context.fillText(image.attribution, 8, 533, 944);
        }
        window.parent.postMessage({ type: 'qtiler3d:thumbnail', requestId: event.data.requestId, image: canvas.toDataURL('image/webp', 0.84) }, location.origin);
      } catch (error) {
        window.parent.postMessage({ type: 'qtiler3d:thumbnail', requestId: event.data.requestId, error: error.message }, location.origin);
      }
    }
  });
  window.parent.postMessage({ type: 'qtiler3d:ready' }, location.origin);
} else boot().catch(reportViewerError);

function cameraView() {
  const position = viewer.camera.positionWC;
  return { position: [position.x, position.y, position.z], orientation: { heading: viewer.camera.heading, pitch: viewer.camera.pitch, roll: viewer.camera.roll } };
}

// --- MÓDULO REDLINE AVANZADO Y CONVERSIÓN GEOJSON ---

window.selectedModel = null;
let activeDrawingTool = null;
let drawingHandler = null;
let activeDrawingPoints = [];
let activeDrawingShape = null;
let drawingFloatingPoint = null;

// Parámetros de estilo por defecto
let redlineStyle = {
  pointColor: "#FF0000", pointSize: 10, pointHeight: 0, pointTransparency: 1,
  lineColor: "#0000FF", lineWidth: 3, lineStyle: "solid", lineTransparency: 1,
  polygonColor: "#00FF00", polygonTransparency: 0.6,
  extrudedColor: "#FFA500", extrudedHeight: 15, extrudedTransparency: 0.8,
  textColor: "#FFFFFF", textSize: 18, textValue: "Etiqueta 3D", textHeight: 0, textTransparency: 1,
  circleColor: "#FF69B4", circleRadius: 50, circleTransparency: 0.6
};

// Convierte las entidades dibujadas a GeoJSON
function exportDrawingsToGeoJSON() {
  const entities = viewer.entities.values;
  const features = [];

  for (const entity of entities) {
    if (entity.properties?.isDrawing?.getValue?.(Cesium.JulianDate.now()) !== true) continue;
    if (entity._qtilerSketch) continue;

    let geometry = null;
    let properties = {};

    if (entity.polyline) {
      const positions = entity.polyline.positions.getValue(Cesium.JulianDate.now()) || [];
      const coordinates = positions.map(cartesian => {
        const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
        return [Cesium.Math.toDegrees(cartographic.longitude), Cesium.Math.toDegrees(cartographic.latitude), cartographic.height || 0];
      });
      geometry = { type: 'LineString', coordinates };
      properties = {
        color: entity.polyline.material.color?.getValue(Cesium.JulianDate.now())?.toCssColorString() || redlineStyle.lineColor,
        width: entity.polyline.width?.getValue() || redlineStyle.lineWidth
      };
    } 
    else if (entity.polygon) {
      const hierarchy = entity.polygon.hierarchy.getValue(Cesium.JulianDate.now());
      if (hierarchy && hierarchy.positions) {
        const coordinates = hierarchy.positions.map(cartesian => {
          const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
          return [Cesium.Math.toDegrees(cartographic.longitude), Cesium.Math.toDegrees(cartographic.latitude), cartographic.height || 0];
        });
        if (coordinates.length > 0) {
          coordinates.push([...coordinates[0]]); // Cerrar anillo
        }
        geometry = { type: 'Polygon', coordinates: [coordinates] };
        properties = {
          color: entity.polygon.material.color?.getValue(Cesium.JulianDate.now())?.toCssColorString() || redlineStyle.polygonColor
        };
        if (Cesium.defined(entity.polygon.extrudedHeight)) {
          properties.extrudedHeight = entity.polygon.extrudedHeight.getValue();
        }
      }
    } 
    else if (entity.point) {
      const cartographic = Cesium.Cartographic.fromCartesian(entity.position.getValue(Cesium.JulianDate.now()));
      geometry = {
        type: 'Point',
        coordinates: [Cesium.Math.toDegrees(cartographic.longitude), Cesium.Math.toDegrees(cartographic.latitude), cartographic.height || 0]
      };
      properties = {
        color: entity.point.color?.getValue(Cesium.JulianDate.now())?.toCssColorString() || redlineStyle.pointColor,
        pixelSize: entity.point.pixelSize?.getValue() || redlineStyle.pointSize
      };
    } 
    else if (entity.label) {
      const cartographic = Cesium.Cartographic.fromCartesian(entity.position.getValue(Cesium.JulianDate.now()));
      geometry = {
        type: 'Point',
        coordinates: [Cesium.Math.toDegrees(cartographic.longitude), Cesium.Math.toDegrees(cartographic.latitude), cartographic.height || 0]
      };
      properties = {
        text: entity.label.text?.getValue() || redlineStyle.textValue,
        color: entity.label.fillColor?.getValue(Cesium.JulianDate.now())?.toCssColorString() || redlineStyle.textColor
      };
    } 
    else if (entity.model) {
      const cartographic = Cesium.Cartographic.fromCartesian(entity.position.getValue(Cesium.JulianDate.now()));
      geometry = {
        type: 'Point',
        coordinates: [Cesium.Math.toDegrees(cartographic.longitude), Cesium.Math.toDegrees(cartographic.latitude), cartographic.height || 0]
      };
      properties = {
        gltfModelUrl: entity.model.uri?.getValue(),
        scale: entity.model.scale ? entity.model.scale.getValue() : 1.0,
        isModel: true
      };
    }

    if (geometry) {
      features.push({ type: 'Feature', geometry, properties });
    }
  }

  return { type: 'FeatureCollection', features: [...features, ...(sketchEditor?.features() || [])] };
}

// Carga un objeto GeoJSON en la escena
function addGeoJsonDrawingsToMap(geojson, replace = false) {
  if (!geojson || !geojson.features) return;
  const editable = geojson.features.filter((feature) => feature.properties?.qtilerSketch || !feature.properties?.isModel && !feature.properties?.gltfModelUrl);
  if (editable.length || replace) sketchEditor.importFeatures({ type: 'FeatureCollection', features: editable }, replace);
  if (replace) for (const entity of [...viewer.entities.values]) {
    if (!entity._qtilerSketch && entity.properties?.isDrawing?.getValue?.(Cesium.JulianDate.now()) === true) viewer.entities.remove(entity);
  }

  geojson.features.filter((feature) => !editable.includes(feature)).forEach(feature => {
    if (!feature?.geometry) return;
    const { type, coordinates } = feature.geometry;
    const props = feature.properties || {};

    if (type === 'LineString') {
      const positions = coordinates.map(c => Cesium.Cartesian3.fromDegrees(c[0], c[1], c[2] || 0));
      viewer.entities.add({
        polyline: {
          positions,
          material: Cesium.Color.fromCssColorString(props.color || redlineStyle.lineColor),
          width: props.width || redlineStyle.lineWidth,
          clampToGround: true
        },
        properties: { isDrawing: true }
      });
    } 
    else if (type === 'Polygon') {
      const positions = coordinates[0].map(c => Cesium.Cartesian3.fromDegrees(c[0], c[1], c[2] || 0));
      viewer.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: Cesium.Color.fromCssColorString(props.color || redlineStyle.polygonColor),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          extrudedHeight: props.extrudedHeight || undefined
        },
        properties: { isDrawing: true }
      });
    } 
    else if (type === 'Point' && !props.isModel && !props.text) {
      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(coordinates[0], coordinates[1], coordinates[2] || 0),
        point: {
          color: Cesium.Color.fromCssColorString(props.color || redlineStyle.pointColor),
          pixelSize: props.pixelSize || redlineStyle.pointSize,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
        },
        properties: { isDrawing: true }
      });
    } 
    else if (type === 'Point' && props.text) {
      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(coordinates[0], coordinates[1], coordinates[2] || 0),
        label: {
          text: props.text,
          font: '16px sans-serif',
          fillColor: Cesium.Color.fromCssColorString(props.color || redlineStyle.textColor),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        properties: { isDrawing: true }
      });
    } 
    else if (type === 'Point' && props.gltfModelUrl) {
      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(coordinates[0], coordinates[1], coordinates[2] || 0),
        model: {
          uri: props.gltfModelUrl,
          scale: props.scale || 1.0
        },
        properties: { isDrawing: true }
      });
    }
  });
}

// Guardar boceto actual en el servidor
async function saveCurrentDrawingToServer(drawingName) {
  const geojson = exportDrawingsToGeoJSON();
  if (!geojson.features.length) {
    throw new Error('No drawing objects to save');
  }

  try {
    const response = await fetch(`${API_BASE}/api/save-drawing`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: drawingName, geojson })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    setStatus(data.message || 'Drawing saved');
  } catch (err) {
    throw err;
  }
}

// Cargar boceto desde el servidor
async function loadDrawingFromServer(drawingName) {
  try {
    const response = await fetch(`${API_BASE}/api/load-drawings?name=${encodeURIComponent(drawingName)}`, { credentials: 'include' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (data && data.geojson) {
      addGeoJsonDrawingsToMap(data.geojson, true);
      setStatus(`Boceto "${drawingName}" cargado.`);
    } else throw new Error('Server did not return a drawing');
  } catch (err) {
    throw err;
  }
}

// Rotación dinámica de modelos GLTF seleccionados
function applyGltfRotation(modelEntity, headingDeg, pitchDeg, rollDeg) {
  if (!modelEntity || !modelEntity.position) return;

  const position = modelEntity.position.getValue(Cesium.JulianDate.now());
  const heading = Cesium.Math.toRadians(headingDeg || 0);
  const pitch = Cesium.Math.toRadians(pitchDeg || 0);
  const roll = Cesium.Math.toRadians(rollDeg || 0);
  
  const hpr = new Cesium.HeadingPitchRoll(heading, pitch, roll);
  const orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr);
  
  modelEntity.orientation = orientation;
}
document.addEventListener('qtiler3d:active-map-change', updateMeasurementToolAvailability);