const API_BASE = '/plugins/Qtiler-3D-eye';

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
const layerPanel = document.getElementById('layerPanel');
const layerList = document.getElementById('layerList');
const terrainWarning = document.getElementById('terrainWarning');
const saveViewBtn = document.getElementById('saveViewBtn');
const toolPopup = document.getElementById('toolPopup');

let viewer;
const runtimeItems = new Map();
let activeToolHandler = null;
let activeSketch = null;
const measurementItems = [];
const sketchItems = [];
const lazyGltfState = { timer: null };
const LAZY_GLTF_MAX_VISIBLE = 120;
const LAZY_GLTF_BATCH_SIZE = 4;
const visibleWfsState = { timer: null, running: false, rerun: false, controllers: new Map(), lastKeyByLayer: new Map() };
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
}

async function waitForCesiumRuntime(timeoutMs = 12000) {
  const started = Date.now();
  while (!window.Cesium) {
    if (Date.now() - started > timeoutMs) throw new Error('Cesium runtime is not available');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return window.Cesium;
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

  const closeButton = document.createElement('div');
  closeButton.innerText = '×';
  closeButton.style.cssText = 'float: right; cursor: pointer; color: #a0aec0; font-size: 20px; line-height: 1;';
  closeButton.onclick = closeMeasureWindow;
  container.appendChild(closeButton);

  const title = document.createElement('h3');
  title.innerText = 'Mediciones';
  title.style.cssText = 'margin: 0 0 10px 0; font-size: 0.95rem; text-align: center; color: #e2e8f0;';
  container.appendChild(title);

  const buttonContainer = document.createElement('div');
  buttonContainer.style.cssText = 'display: flex; justify-content: space-around; margin-bottom: 10px; background: rgba(255,255,255,0.05); padding: 6px; border-radius: 6px;';

  function createBtn(id, iconClass, type, tooltip) {
    const button = document.createElement('i');
    button.id = id;
    button.className = iconClass;
    button.title = tooltip;
    button.style.cssText = 'font-size: 22px; cursor: pointer; padding: 4px 8px; border-radius: 4px; transition: all 0.2s;';
    button.onclick = () => setMeasureType(type);
    buttonContainer.appendChild(button);
    return button;
  }

  createBtn('verticalMeasurementButton', 'bx bx-up-arrow-alt', 'vertical', 'Medición de Altura (Z)');
  createBtn('distanceMeasurementButton', 'bx bx-ruler', 'distance', 'Distancia');
  createBtn('areaMeasurementButton', 'bx bx-shape-polygon', 'area', 'Área');

  const clearButton = document.createElement('i');
  clearButton.id = 'clearMeasurementButton';
  clearButton.className = 'bx bx-trash';
  clearButton.title = "Limpiar Todo";
  clearButton.style.cssText = 'font-size: 22px; cursor: pointer; padding: 4px 8px; color: #ff8080;';
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
  updateMeasureButtonState();
}

function updateMeasureWindowForDistance(segmentDistance, totalDistance, startPoint, endPoint) {
  if (!measureWindow) createMeasureWindow();
  const currentMeasureDisplay = document.getElementById('currentMeasureDisplay');
  if (!currentMeasureDisplay) return;

  const cameraHeight = viewer.camera.positionCartographic.height;
  const useMeters = cameraHeight < 5000;
  const segmentDisplay = useMeters ? `${(segmentDistance * 1000).toFixed(0)} m` : `${segmentDistance.toFixed(3)} km`;
  const totalDisplay = useMeters ? `${(totalDistance * 1000).toFixed(0)} m` : `${totalDistance.toFixed(3)} km`;

  currentMeasureDisplay.innerText = `Total: ${totalDisplay}`;

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
    listItem.innerText = `Área: ${areaDisplay}`;
    listItem.style.cssText = 'border-bottom: 1px solid rgba(255,255,255,0.1); padding: 4px 0;';
    measurementsList.appendChild(listItem);
    measurementsList.scrollTop = measurementsList.scrollHeight;
    currentMeasureDisplay.innerText = `Área: ${areaDisplay}`;

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
    currentMeasureDisplay.innerText = 'Área: -';
  }
}

function updateMeasureWindowForHeight(height) {
  if (!measureWindow) createMeasureWindow();
  const measurementsList = document.getElementById('measurementsList');
  const currentMeasureDisplay = document.getElementById('currentMeasureDisplay');
  if (!measurementsList || !currentMeasureDisplay) return;

  const heightDisplay = `${height.toFixed(2)} m`;
  const listItem = document.createElement('li');
  listItem.innerText = `Altura: ${heightDisplay}`;
  listItem.style.cssText = 'border-bottom: 1px solid rgba(255,255,255,0.1); padding: 4px 0;';
  measurementsList.appendChild(listItem);
  measurementsList.scrollTop = measurementsList.scrollHeight;
  currentMeasureDisplay.innerText = `Altura: ${heightDisplay}`;
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

  if (measureWindow) document.getElementById('currentMeasureDisplay').innerText = 'Haz clic en el inicio...';

  if (!measureHandler) measureHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  else {
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  }

  measureHandler.setInputAction(function (event) {
    const pickedPosition = viewer.scene.pickPosition(event.position);
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
        if (measureWindow) document.getElementById('currentMeasureDisplay').innerText = 'Clic en el siguiente punto...';
      }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  measureHandler.setInputAction(function (movement) {
    if (measurePoints.length > 0 && isMeasuring) {
      const currentMousePosition = viewer.scene.pickPosition(movement.endPosition);
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
        item.innerText = `Distancia: ${finalTotalDisplay}`;
        item.style.cssText = 'border-bottom: 1px solid rgba(255,255,255,0.1); padding: 4px 0;';
        list.appendChild(item);
        list.scrollTop = list.scrollHeight;
      }
      if (measureWindow) document.getElementById('currentMeasureDisplay').innerText = `Finalizado: ${finalTotalDisplay}`;

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
      if (measureWindow) document.getElementById('currentMeasureDisplay').innerText = 'Total: 0 m';
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

  if (measureWindow) document.getElementById('currentMeasureDisplay').innerText = 'Clic en primer punto...';
  if (!measureHandler) measureHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  else {
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  }

  measureHandler.setInputAction(function (event) {
    const pickedPosition = viewer.scene.pickPosition(event.position);
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
        document.getElementById('currentMeasureDisplay').innerText = `${measurePoints.length} puntos. Clic derecho para cerrar.`;
      }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  measureHandler.setInputAction(function (movement) {
    if (measurePoints.length > 0 && isMeasuring) {
      const currentMousePosition = viewer.scene.pickPosition(movement.endPosition);
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
      if (measureWindow) document.getElementById('currentMeasureDisplay').innerText = 'Área: 0 m²';
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

  if (measureWindow) document.getElementById('currentMeasureDisplay').innerText = 'Altura: 0 m';
  else { createMeasureWindow(); document.getElementById('currentMeasureDisplay').innerText = 'Altura: 0 m'; }

  if (!measureHandler) measureHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  else {
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    measureHandler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  }

  function mouseMoveHandlerVertical(movement) {
    if (!isDrawingLine || !startPosition) return;
    const currentMousePosition = viewer.scene.pickPosition(movement.endPosition);
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

    if (measureWindow) document.getElementById('currentMeasureDisplay').innerText = `Altura: ${distanceDisplay}`;
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

    if (measureWindow) document.getElementById('currentMeasureDisplay').innerText = 'Altura: 0 m';
    updateMeasureButtonState();
  }

  measureHandler.setInputAction(function (event) {
    const pickedPosition = viewer.scene.pickPosition(event.position);
    if (!Cesium.defined(pickedPosition)) return;

    if (!isDrawingLine) {
      startPosition = pickedPosition;
      startPositionCartographic = Cesium.Cartographic.fromCartesian(startPosition);
      measurePoints = [startPosition];
      startPointEntity = createMeasurePoint(startPosition);
      isDrawingLine = true;
      isMeasuring = true;

      if (measureWindow) document.getElementById('currentMeasureDisplay').innerText = 'Clic en el punto final de altura...';
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
  clearMeasurements();
  measurePoints = [];
  if (measureWindow) {
    const list = document.getElementById('measurementsList');
    if (list) list.innerHTML = '';
    const display = document.getElementById('currentMeasureDisplay');
    if (display) display.innerText = 'Seleccione un tipo de medición.';
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
    if (type === 'distance') display.innerText = 'Clic en inicio...';
    else if (type === 'area') display.innerText = 'Clic en primer punto...';
    else if (type === 'vertical') display.innerText = 'Clic en inicio...';
  }

  if (type === 'distance') startMeasureDistance();
  else if (type === 'area') startMeasureArea();
  else if (type === 'vertical') startMeasureVertical();
  updateMeasureButtonState();
}

function openMeasureWindow() {
  if (measureWindow) return;
  createMeasureWindow();
  disableDoubleClickZoom();
  disableInfoBoxPicking();
  setMeasureType('distance');
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
  if (activeToolHandler) {
    activeToolHandler.destroy();
    activeToolHandler = null;
  }
  activeSketch = null;
  if (measureWindow) {
    closeMeasureWindow();
  }
  setStatus('Ready.');
}

function hideToolPopup() {
  if (toolPopup) toolPopup.hidden = true;
}

function showToolPopup(title, actions = []) {
  if (!toolPopup) return;
  toolPopup.innerHTML = `
    <header><strong>${title}</strong><button type="button" data-tool-close aria-label="Close">x</button></header>
    <div class="tool-popup-actions">
      ${actions.map((action) => `<button type="button" class="viewer-button" data-tool-action="${action.key}"><i class="bx ${action.icon}"></i><span>${action.label}</span></button>`).join('')}
    </div>
  `;
  toolPopup.hidden = false;
  toolPopup.querySelector('[data-tool-close]')?.addEventListener('click', hideToolPopup);
  toolPopup.querySelectorAll('[data-tool-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = actions.find((item) => item.key === button.dataset.toolAction);
      if (action?.run) action.run();
    });
  });
}

function initViewer(config) {
  applyBranding(config);
  const isTerrainPreview = config.config?.previewMode === 'terrain' || config.scene?.terrainPreview === true;
  const token = config.config?.cesiumToken || localStorage.getItem('qtiler3d_ion_token') || '';
  if (token) Cesium.Ion.defaultAccessToken = token;

  viewer = new Cesium.Viewer('cesiumContainer', {
    timeline: false,
    animation: false,
    imageryProvider: false,
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
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#d8dde4');
  viewer.scene.globe.enableLighting = config.config?.modules?.shadows !== false;
  if (isTerrainPreview) document.body.classList.add('terrain-preview-mode');
  try { viewer._cesiumWidget._creditContainer.style.display = 'none'; } catch { }
}

function normalizeTerrainBounds(bounds) {
  if (bounds && !Array.isArray(bounds) && typeof bounds === 'object') {
    bounds = [bounds.west, bounds.south, bounds.east, bounds.north];
  }
  if (!Array.isArray(bounds) || bounds.length < 4) return null;
  let [west, south, east, north] = bounds.slice(0, 4).map(Number);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  const maxAbs = Math.max(Math.abs(west), Math.abs(south), Math.abs(east), Math.abs(north));
  if (maxAbs <= Math.PI * 2) {
    west = Cesium.Math.toDegrees(west);
    south = Cesium.Math.toDegrees(south);
    east = Cesium.Math.toDegrees(east);
    north = Cesium.Math.toDegrees(north);
  }
  if (west === east || south === north) return null;
  return [west, south, east, north];
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
    if (typeof Cesium.OpenStreetMapImageryProvider === 'function') return new Cesium.OpenStreetMapImageryProvider(options);
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
    imagery.alpha = layer.isBaseLayer ? 1 : 0.9;
    if (layer.isBaseLayer) try { viewer.imageryLayers.raiseToTop(imagery); } catch { }
    runtimeItems.set(layer.key, { label: layer.name, category: layer.isBaseLayer ? 'background' : 'layer', type: layer.type, object: imagery, legendIcon: layer.legendIcon, layer });
  }
}

function defaultVectorStyle(layer) {
  const geom = String(layer.geometryType || '').toLowerCase();
  const clampToGround = !Number.isFinite(Number(layer.extrusionHeight));
  const fillOpacity = Number.isFinite(Number(layer.fillOpacity)) ? Number(layer.fillOpacity) : 0.55;
  const strokeOpacity = Number.isFinite(Number(layer.strokeOpacity)) ? Number(layer.strokeOpacity) : 1;
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
  return rule ? { ...base, ...rule } : base;
}

function setEntityTerrainOffset(entity, heightOffset = 0) {
  if (!entity?.position) return;
  if (!entity._qtiler3dBaseCartographic) {
    const cartesian = entity.position.getValue(Cesium.JulianDate.now());
    const cartographic = cartesian ? Cesium.Cartographic.fromCartesian(cartesian) : null;
    if (cartographic) {
      entity._qtiler3dBaseCartographic = {
        longitude: cartographic.longitude,
        latitude: cartographic.latitude
      };
    }
  }
  const base = entity._qtiler3dBaseCartographic;
  if (!base) return;
  entity.position = Cesium.Cartesian3.fromRadians(base.longitude, base.latitude, Number(heightOffset || 0));
}

function lazyGltfKey(style) {
  return [style.modelUrl || '', style.modelScale || 1, style.heightOffset || 0].join('|');
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
    heightReference: Number(style.heightOffset || 0) ? Cesium.HeightReference.RELATIVE_TO_GROUND : Cesium.HeightReference.CLAMP_TO_GROUND
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

function applyWfsStyle(dataSource, layer) {
  const zoom = currentApproxZoom();
  dataSource.show = layer.visible !== false && zoomInRange(layer, zoom);
  if (!dataSource.show) {
    for (const entity of dataSource.entities.values) {
      entity._qtiler3dLazyGltf = null;
      clearLazyGltfModel(entity);
    }
    return;
  }
  for (const entity of dataSource.entities.values) {
    const style = effectiveStyleForEntity(entity, layer, zoom);
    const heightOffset = Number(style.heightOffset || 0);
    const fillOpacity = Number.isFinite(Number(style.fillOpacity)) ? Number(style.fillOpacity) : 0.55;
    const strokeOpacity = Number.isFinite(Number(style.strokeOpacity)) ? Number(style.strokeOpacity) : 1;
    const fillColor = Cesium.Color.fromCssColorString(style.color || '#2f80ed').withAlpha(fillOpacity);
    const strokeColor = Cesium.Color.fromCssColorString(style.strokeColor || '#ffffff').withAlpha(strokeOpacity);
    const pointSize = Number(style.pointSize || 18);
    const iconUrl = String(style.iconUrl || '').trim();
    const iconScale = Number.isFinite(Number(style.iconScale)) ? Number(style.iconScale) : 1;
    const modelUrl = String(style.modelUrl || '').trim();
    const symbolType = String(style.symbolType || (modelUrl ? 'gltf' : (iconUrl ? 'svg' : 'point')));
    if (entity.position && !entity.polyline && !entity.polygon) {
      setEntityTerrainOffset(entity, heightOffset);
      if (symbolType === 'gltf' && modelUrl) {
        entity._qtiler3dLazyGltf = {
          modelUrl,
          modelScale: Number.isFinite(Number(style.modelScale)) ? Number(style.modelScale) : 1,
          heightOffset
        };
        entity.billboard = undefined;
        if (!entity.model) {
          if (!entity.point) entity.point = new Cesium.PointGraphics();
          entity.point.color = fillColor;
          entity.point.outlineColor = strokeColor;
          entity.point.outlineWidth = Number(style.strokeWidth || 1);
          entity.point.pixelSize = Math.max(6, Math.min(14, pointSize * 0.55));
          entity.point.heightReference = heightOffset ? Cesium.HeightReference.RELATIVE_TO_GROUND : Cesium.HeightReference.CLAMP_TO_GROUND;
          entity.point.disableDepthTestDistance = Number.POSITIVE_INFINITY;
        }
      } else if (symbolType === 'svg' && iconUrl) {
        entity._qtiler3dLazyGltf = null;
        clearLazyGltfModel(entity);
        entity.point = undefined;
        entity.billboard = new Cesium.BillboardGraphics({
          image: new URL(iconUrl, window.location.origin).toString(),
          scale: iconScale,
          color: fillColor,
          heightReference: heightOffset ? Cesium.HeightReference.RELATIVE_TO_GROUND : Cesium.HeightReference.CLAMP_TO_GROUND,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
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
        entity.point.heightReference = heightOffset ? Cesium.HeightReference.RELATIVE_TO_GROUND : Cesium.HeightReference.CLAMP_TO_GROUND;
        entity.point.disableDepthTestDistance = Number.POSITIVE_INFINITY;
      }
    }
    if (entity.polyline) {
      entity.polyline.material = strokeColor;
      entity.polyline.width = Number(style.strokeWidth || 3);
      if (heightOffset) entity.polyline.clampToGround = false;
    }
    if (entity.polygon) {
      entity.polygon.material = fillColor;
      entity.polygon.outline = true;
      entity.polygon.outlineColor = strokeColor;
      entity.polygon.height = heightOffset || 0;
      entity.polygon.heightReference = heightOffset ? Cesium.HeightReference.RELATIVE_TO_GROUND : Cesium.HeightReference.CLAMP_TO_GROUND;
    }
  }
  scheduleLazyGltfUpdate();
}

function applyExtrusionStyle(dataSource, layer) {
  const baseExtrusionHeight = Number(layer.extrusionHeight);
  const hasRuleExtrusion = (layer.styleRules || []).some((rule) => Number(rule.extrusionHeight) > 0);
  if ((!Number.isFinite(baseExtrusionHeight) || baseExtrusionHeight <= 0) && !hasRuleExtrusion) return;
  for (const entity of dataSource.entities.values) {
    if (!entity.polygon) continue;
    const style = effectiveStyleForEntity(entity, layer);
    const extrusionHeight = Number(style.extrusionHeight || baseExtrusionHeight);
    if (!Number.isFinite(extrusionHeight) || extrusionHeight <= 0) continue;
    const color = Cesium.Color.fromCssColorString(style.color || layer.color || '#b2b2b2').withAlpha(Number.isFinite(Number(style.fillOpacity)) ? Number(style.fillOpacity) : 0.72);
    entity.polygon.height = 0;
    entity.polygon.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
    entity.polygon.extrudedHeight = extrusionHeight;
    entity.polygon.extrudedHeightReference = Cesium.HeightReference.RELATIVE_TO_GROUND;
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
    runtimeItems.set(layer.key, { label: layer.name, category: 'layer', type: 'wfs', object: null, legendIcon: layer.legendIcon, layer, loading: false });
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
    let response = await fetch(wfsBboxUrl(layer, requestBbox, requestMode), { credentials: 'include', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    let geojson = await response.json();
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
      response = await fetch(wfsBboxUrl(layer, requestBbox, requestMode), { credentials: 'include', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      geojson = await response.json();
    }
    if (controller.signal.aborted) return;
    const dataSource = await Cesium.GeoJsonDataSource.load(geojson, defaultVectorStyle(layer));
    if (controller.signal.aborted) {
      try { dataSource.entities.removeAll(); } catch { }
      return;
    }
    applyWfsStyle(dataSource, layer);
    applyExtrusionStyle(dataSource, layer);
    dataSource.show = visible;
    await viewer.dataSources.add(dataSource);
    if (item.object) {
      try { viewer.dataSources.remove(item.object, true); } catch { }
    }
    item.object = dataSource;
    item.loading = false;
    visibleWfsState.lastKeyByLayer.set(layer.key, bboxKey(layer, requestBbox, requestMode));
  } catch (err) {
    item.loading = false;
    if (err?.name !== 'AbortError') console.warn('[Qtiler-3D-eye] visible WFS failed', layer, err);
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
    if (items.length) setStatus('Ready.');
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
  const terrains = (config.config?.terrains || []).filter((terrain) => terrain.visible !== false);
  const terrain = terrains.find((item) => item.type === 'heightmap') || terrains.find((item) => item.type === 'quantized-mesh');
  if (!terrain) {
    terrainWarning.hidden = false;
    terrainWarning.textContent = 'No terrain: the map will be flat and objects may appear suspended until a terrain is generated or selected.';
    return;
  }
  terrainWarning.hidden = true;

  if (terrain.type === 'heightmap' && terrain.heightmapInfoUrl && terrain.heightmapTileUrlTemplate) {
    const infoResponse = await fetch(terrain.heightmapInfoUrl, { credentials: 'include' });
    const info = await infoResponse.json();
    if (!info.available) return;
    if (!terrain.bounds && info.bounds) terrain.bounds = info.bounds;
    viewer.terrainProvider = new Cesium.CustomHeightmapTerrainProvider({
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
    runtimeItems.set(terrain.key || `terrain:${terrain.name}`, { label: terrain.name || 'Terrain', category: 'terrain', type: 'heightmap', object: viewer.terrainProvider, terrain, selected: true });
    return;
  }

  if (terrain.type === 'quantized-mesh' && terrain.terrainUrl) {
    viewer.terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(new URL(terrain.terrainUrl, window.location.origin).toString(), {
      requestVertexNormals: true
    });
    runtimeItems.set(terrain.key || `terrain:${terrain.name}`, { label: terrain.name || 'Terrain', category: 'terrain', type: 'quantized-mesh', object: viewer.terrainProvider, terrain, selected: true });
  }
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
    if (viewer?.terrainProvider && viewer.terrainProvider !== Cesium.EllipsoidTerrainProvider) {
      const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [cartographic]);
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

async function addAssets(config) {
  const assets = config.config?.assets || [];
  const isAssetPreview = config.config?.previewMode === 'asset' || config.scene?.assetPreview === true;
  for (const asset of assets) {
    try {
      let object = null;
      const url = new URL(asset.url, window.location.origin).toString();
      if (asset.type === '3dtiles') {
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
      if (object) runtimeItems.set(`asset:${asset.id}`, { label: asset.name, category: 'asset', type: asset.type, object, asset });
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
  if (!item?.object) return;
  if ('show' in item.object) item.object.show = visible;
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

function setBackgroundVisible(key) {
  for (const [itemKey, item] of runtimeItems.entries()) {
    if (item.category !== 'background') continue;
    setRuntimeVisible(item, itemKey === key);
    if (itemKey === key && item.object) try { viewer.imageryLayers.raiseToTop(item.object); } catch { }
  }
  renderLayerPanel({ config: { modules: { layers: true, models: true, bookmarks: true } } });
}

function renderLayerPanel(config) {
  const modules = config.config?.modules || {};
  if (modules.layers === false && modules.models === false) return;
  const groups = [
    ['background', 'Background'],
    ['terrain', 'Terrain'],
    ['layer', 'Layers'],
    ['asset', '3D / Assets']
  ];
  layerList.innerHTML = groups.map(([category, title]) => {
    const entries = Array.from(runtimeItems.entries()).filter(([, item]) => item.category === category);
    if (!entries.length) return '';
    return `<section class="layer-group"><h3>${title}</h3>${entries.map(([key, item]) => {
      const checked = item.category === 'terrain' ? item.selected !== false : item.object?.show !== false;
      const inputType = item.category === 'background' || item.category === 'terrain' ? 'radio' : 'checkbox';
      const inputName = item.category === 'background' ? 'backgroundLayer' : (item.category === 'terrain' ? 'terrainLayer' : 'runtimeLayer');
      return `
        <label class="layer-row">
          <input type="${inputType}" name="${inputName}" data-runtime-key="${key}" ${checked ? 'checked' : ''} ${item.category === 'terrain' ? 'disabled' : ''}>
          <span>${item.label}</span>${item.asset && !item.asset.readonly && (item.type === 'model' || item.type === '3dtiles') ? `<button class="viewer-button" type="button" data-place-key="${key}">Posicionar</button>` : ''}
          ${item.legendIcon ? `<img src="${item.legendIcon}" alt="" class="legend-icon">` : ''}
        </label>`;
    }).join('')}</section>`;
  }).join('') || '<p>No layers or assets loaded.</p>';
  layerList.querySelectorAll('[data-runtime-key]').forEach((input) => {
    input.addEventListener('change', () => {
      const item = runtimeItems.get(input.dataset.runtimeKey);
      if (item?.category === 'background') setBackgroundVisible(input.dataset.runtimeKey);
      else setRuntimeVisible(item, input.checked);
    });
  });
  layerList.querySelectorAll('[data-place-key]').forEach((button) => {
    button.addEventListener('click', () => startPlacement(runtimeItems.get(button.dataset.placeKey)));
  });
  saveViewBtn.hidden = modules.bookmarks === false;
  saveViewBtn.addEventListener('click', () => {
    const position = viewer.camera.positionWC;
    const payload = {
      name: `View ${new Date().toLocaleString()}`,
      position: [position.x, position.y, position.z],
      orientation: { heading: viewer.camera.heading, pitch: viewer.camera.pitch, roll: viewer.camera.roll }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'qtiler-3d-view.json';
    link.click();
    URL.revokeObjectURL(link.href);
  }, { once: true });
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
  activeSketch = { kind, positions: [], preview: null };
  activeToolHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  setStatus(kind === 'point' ? 'Sketch: haz clic para añadir un punto.' : 'Sketch: haz clic para añadir vértices, clic derecho para finalizar.');

  activeToolHandler.setInputAction((event) => {
    const position = pickGlobePosition(event.position);
    if (!position) return;

    if (kind === 'point') {
      sketchItems.push(viewer.entities.add({
        position,
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
    if (activeSketch?.preview) {
      sketchItems.push(activeSketch.preview);
    }
    clearActiveTool();
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
}

function clearDrawings() {
  for (const item of sketchItems) viewer.entities.remove(item);
  sketchItems.length = 0;
  clearAllMeasurementsAndData();
}

function startPlacement(item) {
  if (!item?.asset) return;
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
      await fetch(`${API_BASE}/api/assets/${encodeURIComponent(item.asset.id)}/placement`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placement })
      });
      setStatus(`Posicion guardada para ${item.label}.`);
    } catch (err) {
      setStatus(`Could not save position: ${err.message || err}`, 'error');
    } finally {
      handler.destroy();
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function renderModules(config) {
  const modules = enabledModules(config.config?.modules || {});
  modulesEl.innerHTML = modules.map((key) => `<span>${key}</span>`).join('');
  const iconByModule = {
    layers: 'bx-layer', measurement: 'bx-ruler', redline: 'bx-pencil',
    bookmarks: 'bx-list-ul', print: 'bx-printer', shadows: 'bx-moon',
    models: 'bx-cube-alt'
  };

  toolButtons.innerHTML = modules.map((key) =>
    `<button type="button" data-tool="${key}" title="${key}"><i class="bx ${iconByModule[key] || 'bx-cog'}"></i></button>`
  ).join('');

  toolButtons.querySelectorAll('[data-tool]').forEach((button) => {
    button.addEventListener('click', () => {
      const tool = button.dataset.tool;
      const isAlreadyActive = button.classList.contains('active');

      clearActiveTool();
      hideToolPopup();
      if (layerPanel) layerPanel.hidden = true;
      toolButtons.querySelectorAll('button').forEach((b) => b.classList.remove('active'));

      if (isAlreadyActive) return;

      button.classList.add('active');

      if (tool === 'layers' || tool === 'models') {
        toggleLayerDialog(config);
      } else if (tool === 'measurement') {
        openMeasureWindow();
      } else if (tool === 'redline') {
        showToolPopup('Dibujo / Sketch', [
          { key: 'point', label: 'Punto', icon: 'bx-map-pin', run: () => startSketchTool('point') },
          { key: 'line', label: 'Línea', icon: 'bx-minus', run: () => startSketchTool('line') },
          { key: 'polygon', label: 'Polígono', icon: 'bx-shape-polygon', run: () => startSketchTool('polygon') },
          { key: 'clear', label: 'Limpiar', icon: 'bx-trash', run: clearDrawings }
        ]);
      } else if (tool === 'shadows') {
        viewer.scene.globe.enableLighting = !viewer.scene.globe.enableLighting;
      }
    });
  });
}

async function flyToScene(config) {
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

async function boot() {
  await waitForCesiumRuntime();
  if (!sceneId && !terrainPreviewId && !terrainAssetPreviewId && !assetPreviewId) {
    setStatus('Missing ?scene=<id>, ?terrain=<id> or ?asset=<id>.', 'error');
    return;
  }
  setStatus('Cargando configuracion de escena...');
  const response = assetPreviewId
    ? await fetch(`${API_BASE}/api/asset-preview-config/${encodeURIComponent(assetPreviewId)}`, { credentials: 'include' })
    : terrainPreviewId || terrainAssetPreviewId
      ? await fetch(`${API_BASE}/api/terrain-preview-config?${terrainPreviewId ? `terrain=${encodeURIComponent(terrainPreviewId)}` : `terrainAsset=${encodeURIComponent(terrainAssetPreviewId)}`}`, { credentials: 'include' })
      : await fetch(`${API_BASE}/api/view-config/${encodeURIComponent(sceneId)}`, { credentials: 'include' });
  const config = await response.json();
  if (!response.ok) throw new Error(config.error || 'view_config_failed');

  const isTerrainPreview = config.config?.previewMode === 'terrain' || config.scene?.terrainPreview === true;
  const isAssetPreview = config.config?.previewMode === 'asset' || config.scene?.assetPreview === true;
  titleEl.textContent = config.scene?.title || 'Qtiler 3D Eye';
  initViewer(config);
  viewer.camera.moveEnd.addEventListener(updateZoomDependentItems);
  if (!isTerrainPreview) renderModules(config);
  await addWmsLayers(config);
  await applyTerrain(config);
  if (!isTerrainPreview) renderLayerPanel(config);
  if (!isAssetPreview) await flyToScene(config);
  setStatus('Ready.');
  if (!isTerrainPreview) {
    addWfsLayers(config).then(() => {
      renderLayerPanel(config);
      setStatus('Ready.');
    }).catch((err) => console.warn('[Qtiler-3D-eye] WFS init failed', err));
    addAssets(config).then(() => renderLayerPanel(config)).catch((err) => console.warn('[Qtiler-3D-eye] assets init failed', err));
  }
}

boot().catch((err) => {
  console.error('[Qtiler-3D-eye]', err);
  setStatus(`Error: ${err.message || err}`, 'error');
});

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
    if (!entity.properties?.isDrawing) continue;

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

  return { type: 'FeatureCollection', features };
}

// Carga un objeto GeoJSON en la escena
function addGeoJsonDrawingsToMap(geojson) {
  if (!geojson || !geojson.features) return;

  geojson.features.forEach(feature => {
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
    alert('No hay elementos dibujados para guardar.');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/save-drawing`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: drawingName, geojson })
    });
    const data = await response.json();
    alert(data.message || 'Boceto guardado.');
  } catch (err) {
    alert(`Error al guardar: ${err.message}`);
  }
}

// Cargar boceto desde el servidor
async function loadDrawingFromServer(drawingName) {
  try {
    const response = await fetch(`${API_BASE}/api/load-drawings?name=${encodeURIComponent(drawingName)}`, { credentials: 'include' });
    const data = await response.json();
    if (data && data.geojson) {
      addGeoJsonDrawingsToMap(data.geojson);
      setStatus(`Boceto "${drawingName}" cargado.`);
    }
  } catch (err) {
    alert(`Error al cargar el boceto: ${err.message}`);
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