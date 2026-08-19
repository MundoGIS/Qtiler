const API_BASE = '/plugins/Qtiler-3D-eye';

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
const identifyCard = document.getElementById('identifyCard');
const identifyTitle = document.getElementById('identifyTitle');
const identifyBody = document.getElementById('identifyBody');

let viewer;
let sceneConfig = null;
const runtimeItems = new Map();
let activeToolHandler = null;
let activeSketch = null;
const measurementItems = [];
const sketchItems = [];
const sketchStyle = { color: '#f97316', width: 3, fillOpacity: 0.28, pointSize: 10 };
const talkItems = [];
const infoIconItems = [];
const simulationState = {
  handler: null,
  focusPoint: null,
  focusEntity: null,
  pathPoints: [],
  pathEntity: null,
  paused: true,
  speed: 0.005,
  pitch: -20,
  frame: 0
};
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

function clearActiveTool() {
  if (activeToolHandler) {
    activeToolHandler.destroy();
    activeToolHandler = null;
  }
  activeSketch = null;
  setStatus('Ready.');
}

function hideToolPopup() {
  if (toolPopup) toolPopup.hidden = true;
}

function hideIdentifyCard() {
  if (identifyCard) identifyCard.hidden = true;
}

function showIdentifyCard(title, body) {
  if (!identifyCard) return;
  if (identifyTitle) identifyTitle.textContent = title || 'Identify';
  if (identifyBody) identifyBody.textContent = body || '';
  identifyCard.hidden = false;
}

function flyHome() {
  const views = Array.isArray(sceneConfig?.config?.savedViews) ? sceneConfig.config.savedViews : [];
  const defaultView = views.find((view) => view.isDefault) || null;
  if (defaultView) {
    flyToSavedView(defaultView);
    return;
  }
  try {
    if (viewer?.homeButton?.viewModel?.command) {
      viewer.homeButton.viewModel.command();
      return;
    }
  } catch {}
  try { viewer?.camera?.flyHome?.(1.2); } catch {}
}

function startIdentifyTool() {
  clearActiveTool();
  hideToolPopup();
  activeToolHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  setStatus('Identify: click a feature or the globe.');
  activeToolHandler.setInputAction((event) => {
    const picked = viewer.scene.pick(event.position);
    const cartesian = pickGlobePosition(event.position);
    let title = 'Identify';
    const lines = [];
    if (Cesium.defined(picked)) {
      const entity = picked.id && picked.id.name ? picked.id : (picked.primitive && picked.primitive.id ? picked.primitive : picked);
      const name = entity?.name || entity?.id || picked?.id?.id || 'Feature';
      title = String(name);
      const props = entity?.properties || picked?.id?.properties || null;
      if (props && typeof props === 'object') {
        const keys = typeof props.getValue === 'function' ? [] : Object.keys(props);
        if (typeof props.getValue === 'function') {
          try {
            const value = props.getValue(Cesium.JulianDate.now());
            if (value && typeof value === 'object') {
              for (const [key, raw] of Object.entries(value)) {
                if (raw == null || typeof raw === 'function') continue;
                lines.push(`${key}: ${typeof raw === 'object' ? JSON.stringify(raw) : raw}`);
              }
            }
          } catch {}
        } else {
          for (const key of keys) {
            const raw = props[key];
            const value = raw && typeof raw.getValue === 'function' ? raw.getValue() : raw;
            if (value == null || typeof value === 'function') continue;
            lines.push(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
          }
        }
      }
      if (!lines.length) lines.push('Picked 3D object.');
    }
    if (cartesian) {
      const carto = Cesium.Cartographic.fromCartesian(cartesian);
      lines.push(`Lon: ${Cesium.Math.toDegrees(carto.longitude).toFixed(6)}`);
      lines.push(`Lat: ${Cesium.Math.toDegrees(carto.latitude).toFixed(6)}`);
      lines.push(`Height: ${carto.height.toFixed(1)} m`);
    }
    if (!lines.length) {
      setStatus('Identify: nothing picked.', 'error');
      hideIdentifyCard();
      return;
    }
    showIdentifyCard(title, lines.join('\n'));
    setStatus('Identify: feature selected.');
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  activeToolHandler.setInputAction(() => {
    hideIdentifyCard();
    clearActiveTool();
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
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
    baseLayerPicker: false,
    contextOptions: { webgl: { preserveDrawingBuffer: true } }
  });

  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#d8dde4');
  viewer.scene.globe.enableLighting = config.config?.modules?.shadows !== false;
  if (isTerrainPreview) document.body.classList.add('terrain-preview-mode');
  try { viewer._cesiumWidget._creditContainer.style.display = 'none'; } catch {}
  try { viewer.homeButton.container.style.display = 'none'; } catch {}
  try { viewer.fullscreenButton.container.style.display = 'none'; } catch {}
  try { if (viewer.geocoder) viewer.geocoder.container.style.display = 'none'; } catch {}
  try { viewer.navigationHelpButton.container.style.display = 'none'; } catch {}
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

function wmtsTileUrl(layer) {
  if (layer.type === 'wmts' && layer.url) return layer.url;
  if (layer.projectId && layer.layerName) {
    return `/wmts/${encodeURIComponent(layer.projectId)}/${encodeURIComponent(layer.layerName)}/{z}/{x}/{y}.png`;
  }
  return '';
}

async function createImageryProvider(layer) {
  if (layer.type === 'wmts' || (layer.isBaseLayer && layer.projectId && layer.layerName)) {
    const url = wmtsTileUrl(layer);
    if (url) {
      return new Cesium.UrlTemplateImageryProvider({
        url: new URL(url, window.location.origin).toString(),
        tilingScheme: new Cesium.WebMercatorTilingScheme(),
        credit: layer.name || layer.layerName || '',
        maximumLevel: Number(layer.maximumLevel || 19)
      });
    }
  }
  if (layer.type === 'wms' || layer.wmsUrl) {
    return new Cesium.WebMapServiceImageryProvider({
      url: new URL(layer.wmsUrl || layer.url, window.location.origin).toString(),
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
    .filter((layer) => ['wms', 'wmts', 'osm', 'xyz'].includes(layer.type) && (layer.url || layer.wmsUrl || (layer.projectId && layer.layerName)))
    .sort((a, b) => Number(!!b.isBaseLayer) - Number(!!a.isBaseLayer));
  const defaultBackground = imageryLayers.find((layer) => layer.isBaseLayer && layer.isDefault) || imageryLayers.find((layer) => layer.isBaseLayer && layer.visible !== false);
  for (const layer of imageryLayers) {
    const provider = await createImageryProvider(layer);
    if (!provider) continue;
    const imagery = viewer.imageryLayers.addImageryProvider(provider);
    imagery.show = layer.isBaseLayer ? layer.key === defaultBackground?.key : layer.visible !== false;
    imagery.alpha = layer.isBaseLayer ? 1 : 0.9;
    if (layer.isBaseLayer) try { viewer.imageryLayers.raiseToTop(imagery); } catch {}
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
      try { dataSource.entities.removeAll(); } catch {}
      return;
    }
    applyWfsStyle(dataSource, layer);
    applyExtrusionStyle(dataSource, layer);
    dataSource.show = visible;
    await viewer.dataSources.add(dataSource);
    if (item.object) {
      try { viewer.dataSources.remove(item.object, true); } catch {}
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
  } catch {}
  try {
    const height = Number(viewer?.scene?.globe?.getHeight(cartographic));
    if (Number.isFinite(height)) return height;
  } catch {}
  return 0;
}

function viewCenterDegrees() {
  const bbox = currentViewBbox();
  if (bbox) return { longitude: (bbox[0] + bbox[2]) / 2, latitude: (bbox[1] + bbox[3]) / 2 };
  try {
    const cartographic = viewer.camera.positionCartographic;
    return { longitude: Cesium.Math.toDegrees(cartographic.longitude), latitude: Cesium.Math.toDegrees(cartographic.latitude) };
  } catch {}
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
  return placementToMatrix({ ...placement, longitude, latitude, height: groundHeight + (Number.isFinite(relativeHeight) ? relativeHeight : 0) });
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
  } catch {}
  try {
    const longitude = Number(asset.placement?.longitude ?? 0);
    const latitude = Number(asset.placement?.latitude ?? 0);
    const height = Number(asset.placement?.height ?? 0);
    const target = Cesium.Cartesian3.fromDegrees(Number.isFinite(longitude) ? longitude : 0, Number.isFinite(latitude) ? latitude : 0, Number.isFinite(height) ? height : 0);
    viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-25), 75));
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  } catch {
    try { viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(0, 0, 90), orientation: { heading: 0, pitch: Cesium.Math.toRadians(-35), roll: 0 } }); } catch {}
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
    if (itemKey === key && item.object) try { viewer.imageryLayers.raiseToTop(item.object); } catch {}
  }
  renderLayerPanel({ config: { modules: { layers: true, models: true, bookmarks: true } } });
}

function isItemVisible(item) {
  if (item?.category === 'terrain') return item.selected !== false;
  if (item?.object && 'show' in item.object) return item.object.show !== false;
  return item?.layer?.visible !== false;
}

function renderLayerPanel(config) {
  const modules = config.config?.modules || {};
  if (modules.layers === false && modules.models === false) return;
  const groups = [
    ['layer', 'Layers'],
    ['asset', '3D / Assets'],
    ['terrain', 'Terrain'],
    ['background', 'Background maps']
  ];
  layerList.innerHTML = groups.map(([category, title]) => {
    const entries = Array.from(runtimeItems.entries()).filter(([, item]) => item.category === category);
    if (!entries.length) return '';
    return `<section class="layer-group hajk-layer-group"><button type="button" class="hajk-group-toggle" data-group="${category}"><span>${title}</span><i class="bx bx-chevron-down"></i></button><div class="hajk-group-body">${entries.map(([key, item]) => {
      const checked = isItemVisible(item);
      const inputType = item.category === 'background' || item.category === 'terrain' ? 'radio' : 'checkbox';
      const inputName = item.category === 'background' ? 'backgroundLayer' : (item.category === 'terrain' ? 'terrainLayer' : 'runtimeLayer');
      return `
        <label class="layer-row">
          <input type="${inputType}" name="${inputName}" data-runtime-key="${key}" ${checked ? 'checked' : ''} ${item.category === 'terrain' ? 'disabled' : ''}>
          <span title="${item.label}">${item.label}</span>
          ${item.asset && !item.asset.readonly && (item.type === 'model' || item.type === '3dtiles') ? `<button class="viewer-button" type="button" data-place-key="${key}">Place</button>` : ''}
          ${item.legendIcon ? `<img src="${item.legendIcon}" alt="" class="legend-icon">` : ''}
        </label>`;
    }).join('')}</div></section>`;
  }).join('') || '<p>No layers or assets loaded.</p>';
  layerList.querySelectorAll('.hajk-group-toggle').forEach((button) => {
    button.addEventListener('click', () => button.parentElement.classList.toggle('is-collapsed'));
  });
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
  saveViewBtn.onclick = () => showSavedViewsPopup(config);
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

function measurePolygonArea(positions) {
  if (!Array.isArray(positions) || positions.length < 3) return 0;
  if (window.turf) {
    const coords = positions.map((point) => {
      const c = Cesium.Cartographic.fromCartesian(point);
      return [Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)];
    });
    coords.push(coords[0]);
    return turf.area(turf.polygon([coords]));
  }
  let area = 0;
  const origin = positions[0];
  for (let i = 1; i < positions.length - 1; i++) {
    const v1 = Cesium.Cartesian3.subtract(positions[i], origin, new Cesium.Cartesian3());
    const v2 = Cesium.Cartesian3.subtract(positions[i + 1], origin, new Cesium.Cartesian3());
    area += Cesium.Cartesian3.magnitude(Cesium.Cartesian3.cross(v1, v2, new Cesium.Cartesian3())) * 0.5;
  }
  return area;
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '-';
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters.toFixed(1)} m`;
}

function formatArea(squareMeters) {
  if (!Number.isFinite(squareMeters) || squareMeters <= 0) return '-';
  return squareMeters >= 10000 ? `${(squareMeters / 10000).toFixed(2)} ha` : `${squareMeters.toFixed(0)} m²`;
}

function addMeasureLabel(position, text) {
  const entity = viewer.entities.add({
    position,
    label: {
      text,
      font: '14px Manrope, sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -14),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
    }
  });
  measurementItems.push(entity);
  return entity;
}

function startDistanceMeasure() {
  clearActiveTool();
  const positions = [];
  let line = null;
  let totalLabel = null;
  activeToolHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  setStatus('Distance: click points, right-click to finish.');
  activeToolHandler.setInputAction((event) => {
    const position = pickGlobePosition(event.position);
    if (!position) return;
    positions.push(position);
    measurementItems.push(viewer.entities.add({ position, point: { pixelSize: 8, color: Cesium.Color.YELLOW, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
    if (positions.length > 1) {
      if (line) viewer.entities.remove(line);
      line = viewer.entities.add({ polyline: { positions: positions.slice(), width: 3, clampToGround: true, material: Cesium.Color.YELLOW } });
      measurementItems.push(line);
      const meters = Cesium.Cartesian3.distance(positions[positions.length - 2], position);
      const total = positions.slice(1).reduce((sum, point, index) => sum + Cesium.Cartesian3.distance(positions[index], point), 0);
      const mid = Cesium.Cartesian3.midpoint(positions[positions.length - 2], position, new Cesium.Cartesian3());
      addMeasureLabel(mid, formatDistance(meters));
      if (totalLabel) viewer.entities.remove(totalLabel);
      totalLabel = addMeasureLabel(position, `Total ${formatDistance(total)}`);
      setStatus(`Segment ${formatDistance(meters)}, total ${formatDistance(total)}.`);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  activeToolHandler.setInputAction(clearActiveTool, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
}

function startAreaMeasure() {
  clearActiveTool();
  const positions = [];
  let polygon = null;
  let areaLabel = null;
  activeToolHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  setStatus('Area: click vertices, right-click to finish.');
  activeToolHandler.setInputAction((event) => {
    const position = pickGlobePosition(event.position);
    if (!position) return;
    positions.push(position);
    measurementItems.push(viewer.entities.add({ position, point: { pixelSize: 7, color: Cesium.Color.YELLOW, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
    if (positions.length > 2) {
      if (polygon) viewer.entities.remove(polygon);
      polygon = viewer.entities.add({ polygon: { hierarchy: new Cesium.PolygonHierarchy(positions.slice()), material: Cesium.Color.YELLOW.withAlpha(0.25), outline: true, outlineColor: Cesium.Color.YELLOW, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND } });
      measurementItems.push(polygon);
      const area = measurePolygonArea(positions);
      const centroid = positions.reduce((sum, point) => Cesium.Cartesian3.add(sum, point, sum), new Cesium.Cartesian3());
      Cesium.Cartesian3.divideByScalar(centroid, positions.length, centroid);
      if (areaLabel) viewer.entities.remove(areaLabel);
      areaLabel = addMeasureLabel(centroid, formatArea(area));
      setStatus(area > 0 ? `Area ${formatArea(area)}.` : `Area: ${positions.length} vertices.`);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  activeToolHandler.setInputAction(clearActiveTool, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
}

function startHeightMeasure() {
  clearActiveTool();
  let startPosition = null;
  let startCarto = null;
  let previewLine = null;
  let previewLabel = null;
  activeToolHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  setStatus('Height: click start, then click end. Right-click cancels.');
  activeToolHandler.setInputAction((event) => {
    const position = pickGlobePosition(event.position);
    if (!position) return;
    if (!startPosition) {
      startPosition = position;
      startCarto = Cesium.Cartographic.fromCartesian(position);
      measurementItems.push(viewer.entities.add({
        position,
        point: { pixelSize: 8, color: Cesium.Color.CYAN, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY }
      }));
      setStatus('Height: click the second point.');
      return;
    }
    const endCarto = Cesium.Cartographic.fromCartesian(position);
    const endPosition = Cesium.Cartesian3.fromRadians(startCarto.longitude, startCarto.latitude, endCarto.height);
    const height = Math.abs(endCarto.height - startCarto.height);
    if (previewLine) viewer.entities.remove(previewLine);
    if (previewLabel) viewer.entities.remove(previewLabel);
    measurementItems.push(viewer.entities.add({
      position: endPosition,
      point: { pixelSize: 8, color: Cesium.Color.CYAN, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY }
    }));
    measurementItems.push(viewer.entities.add({
      polyline: { positions: [startPosition, endPosition], width: 3, clampToGround: false, material: Cesium.Color.CYAN }
    }));
    measurementItems.push(viewer.entities.add({
      position: endPosition,
      label: {
        text: `${height.toFixed(2)} m`,
        font: '14px Manrope, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -12),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    }));
    setStatus(`Height ${height.toFixed(2)} m.`);
    clearActiveTool();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  activeToolHandler.setInputAction((movement) => {
    if (!startPosition || !startCarto) return;
    const hover = pickGlobePosition(movement.endPosition);
    if (!hover) return;
    const hoverCarto = Cesium.Cartographic.fromCartesian(hover);
    const hoverEnd = Cesium.Cartesian3.fromRadians(startCarto.longitude, startCarto.latitude, hoverCarto.height);
    const height = Math.abs(hoverCarto.height - startCarto.height);
    if (previewLine) viewer.entities.remove(previewLine);
    if (previewLabel) viewer.entities.remove(previewLabel);
    previewLine = viewer.entities.add({
      polyline: { positions: [startPosition, hoverEnd], width: 3, clampToGround: false, material: Cesium.Color.CYAN.withAlpha(0.7) }
    });
    previewLabel = viewer.entities.add({
      position: hoverEnd,
      label: {
        text: `${height.toFixed(2)} m`,
        font: '14px Manrope, sans-serif',
        fillColor: Cesium.Color.CYAN,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -12),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    measurementItems.push(previewLine, previewLabel);
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  activeToolHandler.setInputAction(() => {
    if (previewLine) viewer.entities.remove(previewLine);
    if (previewLabel) viewer.entities.remove(previewLabel);
    clearActiveTool();
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
}

function currentCameraView(name) {
  const position = viewer.camera.positionWC;
  return {
    name: name || `View ${new Date().toLocaleString()}`,
    position: [position.x, position.y, position.z],
    orientation: { heading: viewer.camera.heading, pitch: viewer.camera.pitch, roll: viewer.camera.roll }
  };
}

function flyToSavedView(view) {
  if (!view?.position || !view?.orientation) return;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromArray(view.position),
    orientation: view.orientation,
    duration: 1.6
  });
}

async function persistSavedView(sceneKey, view, isDefault = false) {
  if (!sceneKey) throw new Error('scene_required');
  const response = await fetch(`${API_BASE}/api/scenes/${encodeURIComponent(sceneKey)}/views`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...view, isDefault })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'save_view_failed');
  return Array.isArray(payload.views) ? payload.views : [];
}

function promptViewName(defaultName) {
  const name = window.prompt('View name', defaultName || '');
  return String(name || '').trim();
}

function sketchColor() {
  return Cesium.Color.fromCssColorString(sketchStyle.color || '#f97316');
}

function startSketchTool(kind) {
  clearActiveTool();
  const positions = [];
  let shape = null;
  const color = sketchColor();
  activeSketch = { kind, positions };
  activeToolHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  if (kind === 'point') setStatus('Sketch point: click the globe.');
  else if (kind === 'line') setStatus('Sketch line: click points, right-click to finish.');
  else setStatus('Sketch polygon: click vertices, right-click to finish.');
  activeToolHandler.setInputAction((event) => {
    const position = pickGlobePosition(event.position);
    if (!position) return;
    if (kind === 'point') {
      sketchItems.push(viewer.entities.add({
        position,
        point: { pixelSize: Number(sketchStyle.pointSize || 10), color, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY }
      }));
      setStatus('Point added.');
      return;
    }
    positions.push(position);
    sketchItems.push(viewer.entities.add({
      position,
      point: { pixelSize: 7, color, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY }
    }));
    if (kind === 'line' && positions.length > 1) {
      if (shape) viewer.entities.remove(shape);
      shape = viewer.entities.add({ polyline: { positions: positions.slice(), width: Number(sketchStyle.width || 3), clampToGround: true, material: color } });
      sketchItems.push(shape);
      setStatus(`Line: ${positions.length} points. Right-click to finish.`);
    }
    if (kind === 'polygon' && positions.length > 2) {
      if (shape) viewer.entities.remove(shape);
      shape = viewer.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions.slice()),
          material: color.withAlpha(Number(sketchStyle.fillOpacity || 0.28)),
          outline: true,
          outlineColor: color,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
        }
      });
      sketchItems.push(shape);
      setStatus(`Polygon: ${positions.length} vertices. Right-click to finish.`);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  activeToolHandler.setInputAction(() => {
    clearActiveTool();
    setStatus('Sketch ready.');
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
}

function showSketchPopup() {
  if (!toolPopup) return;
  toolPopup.innerHTML = `
    <header><strong>Sketch</strong><button type="button" data-tool-close aria-label="Close">x</button></header>
    <form class="tool-form" id="sketchStyleForm">
      <label>Color <input name="color" type="color" value="${sketchStyle.color}"></label>
      <label>Width <input name="width" type="number" min="1" max="12" step="1" value="${sketchStyle.width}"></label>
      <label>Fill opacity <input name="fillOpacity" type="number" min="0.05" max="0.9" step="0.05" value="${sketchStyle.fillOpacity}"></label>
      <label>Point size <input name="pointSize" type="number" min="6" max="24" step="1" value="${sketchStyle.pointSize}"></label>
    </form>
    <div class="tool-popup-actions">
      <button type="button" class="viewer-button" data-sketch="point"><i class="bx bx-map-pin"></i><span>Point</span></button>
      <button type="button" class="viewer-button" data-sketch="line"><i class="bx bx-minus"></i><span>Line</span></button>
      <button type="button" class="viewer-button" data-sketch="polygon"><i class="bx bx-shape-polygon"></i><span>Polygon</span></button>
      <button type="button" class="viewer-button" data-sketch="clear"><i class="bx bx-trash"></i><span>Clear</span></button>
    </div>
  `;
  toolPopup.hidden = false;
  const form = toolPopup.querySelector('#sketchStyleForm');
  const applyStyle = () => {
    if (!form) return;
    sketchStyle.color = form.color.value || '#f97316';
    sketchStyle.width = Number(form.width.value) || 3;
    sketchStyle.fillOpacity = Number(form.fillOpacity.value) || 0.28;
    sketchStyle.pointSize = Number(form.pointSize.value) || 10;
  };
  form?.addEventListener('change', applyStyle);
  toolPopup.querySelector('[data-tool-close]')?.addEventListener('click', hideToolPopup);
  toolPopup.querySelectorAll('[data-sketch]').forEach((button) => {
    button.addEventListener('click', () => {
      applyStyle();
      const kind = button.dataset.sketch;
      if (kind === 'clear') clearDrawings();
      else startSketchTool(kind);
    });
  });
}

async function setDefaultSavedView(sceneKey, name) {
  const response = await fetch(`${API_BASE}/api/scenes/${encodeURIComponent(sceneKey)}/views/default`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'default_view_failed');
  return Array.isArray(payload.views) ? payload.views : [];
}

async function deleteSavedView(sceneKey, name) {
  const response = await fetch(`${API_BASE}/api/scenes/${encodeURIComponent(sceneKey)}/views?name=${encodeURIComponent(name)}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'delete_view_failed');
  return Array.isArray(payload.views) ? payload.views : [];
}

function showSavedViewsPopup(config) {
  if (!toolPopup) return;
  const sceneKey = config?.scene?.id || sceneId;
  const views = Array.isArray(config?.config?.savedViews) ? config.config.savedViews : [];
  toolPopup.innerHTML = `
    <header><strong>Saved views</strong><button type="button" data-tool-close aria-label="Close">x</button></header>
    <div class="tool-popup-actions">
      <button type="button" class="viewer-button" data-view-save><i class="bx bx-save"></i><span>Save current view</span></button>
      ${views.length ? views.map((view, index) => `
        <div class="saved-view-item">
          <button type="button" class="viewer-button" data-view-go="${index}">
            <i class="bx ${view.isDefault ? 'bxs-star' : 'bx-current-location'}"></i>
            <span>${view.isDefault ? '* ' : ''}${view.name || `View ${index + 1}`}</span>
          </button>
          <button type="button" class="viewer-button icon-only" data-view-default="${index}" title="Make default"><i class="bx ${view.isDefault ? 'bxs-star' : 'bx-star'}"></i></button>
          <button type="button" class="viewer-button icon-only" data-view-delete="${index}" title="Delete view"><i class="bx bx-trash"></i></button>
        </div>
      `).join('') : '<p class="saved-view-empty">No saved views yet.</p>'}
    </div>
  `;
  toolPopup.hidden = false;
  toolPopup.querySelector('[data-tool-close]')?.addEventListener('click', hideToolPopup);
  toolPopup.querySelector('[data-view-save]')?.addEventListener('click', async () => {
    const name = promptViewName(`View ${views.length + 1}`);
    if (!name) return;
    try {
      config.config.savedViews = await persistSavedView(sceneKey, currentCameraView(name));
      setStatus(`Saved view: ${name}`);
      showSavedViewsPopup(config);
    } catch (err) {
      setStatus(`Could not save view: ${err.message || err}`, 'error');
    }
  });
  toolPopup.querySelectorAll('[data-view-go]').forEach((button) => {
    button.addEventListener('click', () => flyToSavedView(views[Number(button.dataset.viewGo)]));
  });
  toolPopup.querySelectorAll('[data-view-default]').forEach((button) => {
    button.addEventListener('click', async () => {
      const view = views[Number(button.dataset.viewDefault)];
      if (!view?.name) return;
      try {
        config.config.savedViews = await setDefaultSavedView(sceneKey, view.name);
        setStatus(`Default view: ${view.name}`);
        showSavedViewsPopup(config);
      } catch (err) {
        setStatus(`Could not set default view: ${err.message || err}`, 'error');
      }
    });
  });
  toolPopup.querySelectorAll('[data-view-delete]').forEach((button) => {
    button.addEventListener('click', async () => {
      const view = views[Number(button.dataset.viewDelete)];
      if (!view?.name || !window.confirm(`Delete view "${view.name}"?`)) return;
      try {
        config.config.savedViews = await deleteSavedView(sceneKey, view.name);
        setStatus(`Deleted view: ${view.name}`);
        showSavedViewsPopup(config);
      } catch (err) {
        setStatus(`Could not delete view: ${err.message || err}`, 'error');
      }
    });
  });
}

function clearDrawings() {
  for (const item of [...measurementItems, ...sketchItems]) viewer.entities.remove(item);
  measurementItems.length = 0;
  sketchItems.length = 0;
  clearActiveTool();
}

function sceneKeyFrom(config) {
  return config?.scene?.id || sceneId;
}

function captureViewerPng() {
  viewer.render();
  return viewer.scene.canvas.toDataURL('image/png');
}

function downloadPng() {
  const link = document.createElement('a');
  link.href = captureViewerPng();
  link.download = `${sceneKeyFrom(sceneConfig) || 'qtiler-3d'}.png`;
  link.click();
  setStatus('PNG exported.');
}

function calculatePrintScale() {
  const cameraHeight = viewer.camera.positionCartographic.height;
  const dpi = 96;
  const inchesPerMeter = 39.3701;
  const metersPerPixel = (cameraHeight * Math.PI) / (dpi * viewer.scene.canvas.clientHeight);
  return Math.round(metersPerPixel * inchesPerMeter * 1000);
}

function loadLogoDataUrl(logoUrl) {
  if (!logoUrl) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = logoUrl;
  });
}

async function exportMapPdf(options = {}) {
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) {
    setStatus('jsPDF is not loaded yet.', 'error');
    return;
  }
  const title = options.title || sceneConfig?.scene?.title || 'Qtiler 3D Eye';
  const description = options.description || '';
  const paperSize = options.paperSize || 'a4';
  const orientation = options.orientation || 'landscape';
  const margin = Number(options.margin) || 10;
  const logoData = await loadLogoDataUrl(sceneConfig?.config?.branding?.logoUrl || '');
  const mapImageData = captureViewerPng();
  const pdf = new jsPDF({ orientation, unit: 'mm', format: paperSize });
  const contentWidth = pdf.internal.pageSize.getWidth() - margin * 2;
  const contentHeight = pdf.internal.pageSize.getHeight() - margin * 2;
  if (options.showBorder !== false) {
    pdf.setLineWidth(0.5);
    pdf.rect(margin, margin, contentWidth, contentHeight);
  }
  if (options.showDate !== false) {
    pdf.setFontSize(10);
    pdf.text(new Date().toLocaleDateString(), pdf.internal.pageSize.getWidth() - margin - 30, margin + 5);
  }
  if (logoData) {
    const logoWidth = 20;
    const logoHeight = 10;
    let logoX = pdf.internal.pageSize.getWidth() - margin - logoWidth;
    let logoY = margin + 5;
    if (options.logoPosition === 'top-left') logoX = margin + 5;
    if (options.logoPosition === 'top-center') logoX = (pdf.internal.pageSize.getWidth() - logoWidth) / 2;
    pdf.addImage(logoData, 'PNG', logoX, logoY, logoWidth, logoHeight);
  }
  pdf.setFont('helvetica', options.boldTitle ? 'bold' : 'normal');
  pdf.setFontSize(Number(options.titleFontSize) || 16);
  const titleY = margin + (logoData ? 25 : 12);
  pdf.text(title, margin + 5, titleY);
  let mapY = titleY + 10;
  let availableMapHeight = contentHeight - mapY - (options.showScale !== false ? 25 : 0);
  if (description && options.descriptionPosition === 'above') {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(Number(options.descriptionFontSize) || 10);
    pdf.text(description, margin + 5, mapY, { maxWidth: contentWidth });
    mapY += 10;
    availableMapHeight -= 10;
  }
  const canvas = viewer.scene.canvas;
  const aspectRatioMap = canvas.width / canvas.height;
  const aspectRatioPage = contentWidth / availableMapHeight;
  let mapWidth = contentWidth;
  let mapHeight = availableMapHeight;
  if (aspectRatioMap > aspectRatioPage) mapHeight = mapWidth / aspectRatioMap;
  else mapWidth = mapHeight * aspectRatioMap;
  const mapX = (pdf.internal.pageSize.getWidth() - mapWidth) / 2;
  pdf.addImage(mapImageData, 'PNG', mapX, mapY, mapWidth, mapHeight);
  if (description && options.descriptionPosition !== 'above') {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(Number(options.descriptionFontSize) || 10);
    pdf.text(description, margin + 5, mapY + mapHeight + 10, { maxWidth: contentWidth });
  }
  if (options.showScale !== false) {
    const scaleX = (pdf.internal.pageSize.getWidth() - 100) / 2;
    const scaleY = mapY + mapHeight + 15;
    pdf.setLineWidth(0.5);
    pdf.line(scaleX, scaleY, scaleX + 100, scaleY);
    pdf.text(`Scale: 1:${calculatePrintScale()}`, scaleX + 30, scaleY + 5);
  }
  pdf.save(`${sceneKeyFrom(sceneConfig) || 'map'}.pdf`);
  setStatus('PDF exported.');
}

function showPrintPopup(config) {
  if (!toolPopup) return;
  toolPopup.innerHTML = `
    <header><strong>Export</strong><button type="button" data-tool-close aria-label="Close">x</button></header>
    <form class="tool-form" id="exportForm">
      <label>Title <input name="title" value="${config?.scene?.title || 'Qtiler 3D Eye'}"></label>
      <label>Description <textarea name="description"></textarea></label>
      <label>Paper
        <select name="paperSize">
          <option value="a4">A4</option>
          <option value="a3">A3</option>
          <option value="letter">Letter</option>
        </select>
      </label>
      <label>Orientation
        <select name="orientation">
          <option value="landscape">Landscape</option>
          <option value="portrait">Portrait</option>
        </select>
      </label>
      <label>Logo
        <select name="logoPosition">
          <option value="top-right">Top right</option>
          <option value="top-left">Top left</option>
          <option value="top-center">Top center</option>
        </select>
      </label>
      <label class="check-row"><input type="checkbox" name="showDate" checked> Date</label>
      <label class="check-row"><input type="checkbox" name="showScale" checked> Scale</label>
      <label class="check-row"><input type="checkbox" name="showBorder" checked> Border</label>
      <button class="viewer-button" type="submit"><i class="bx bx-file"></i><span>Export PDF</span></button>
      <button class="viewer-button" type="button" id="exportPngBtn"><i class="bx bx-image"></i><span>Export PNG</span></button>
    </form>
  `;
  toolPopup.hidden = false;
  toolPopup.querySelector('[data-tool-close]')?.addEventListener('click', hideToolPopup);
  toolPopup.querySelector('#exportPngBtn')?.addEventListener('click', downloadPng);
  toolPopup.querySelector('#exportForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    exportMapPdf({
      title: form.title.value,
      description: form.description.value,
      paperSize: form.paperSize.value,
      orientation: form.orientation.value,
      logoPosition: form.logoPosition.value,
      showDate: form.showDate.checked,
      showScale: form.showScale.checked,
      showBorder: form.showBorder.checked,
      descriptionPosition: 'below'
    });
  });
}

function talkIconUrl(icon) {
  if (icon === 'semi-arg') return `${API_BASE}/view/icons/sad.png`;
  if (icon === 'arg') return `${API_BASE}/view/icons/arg.png`;
  return `${API_BASE}/view/icons/smile.png`;
}

function addTalkEntity(msg, visible = true) {
  const lon = Number(msg?.position?.longitude);
  const lat = Number(msg?.position?.latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
  const entity = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lon, lat, 50),
    billboard: {
      image: talkIconUrl(msg.icon),
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      width: 32,
      height: 32,
      heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
      show: visible
    },
    label: {
      text: String(msg.message || ''),
      font: '14px Manrope, sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -60),
      heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
      showBackground: true,
      backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      show: visible
    },
    name: msg.message || 'Note',
    description: `<p>${String(msg.message || '')}</p>`
  });
  talkItems.push({ entity, lon, lat });
}

function loadTalkMessages(config) {
  for (const item of talkItems) viewer.entities.remove(item.entity);
  talkItems.length = 0;
  const messages = Array.isArray(config?.config?.talkMessages) ? config.config.talkMessages : [];
  messages.forEach((msg) => addTalkEntity(msg, true));
}

function startTalkTool(config, icon = 'happy') {
  clearActiveTool();
  activeToolHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  setStatus('Note: click the globe, then enter a message. Right-click cancels.');
  activeToolHandler.setInputAction(async (event) => {
    const position = pickGlobePosition(event.position);
    if (!position) return;
    const carto = Cesium.Cartographic.fromCartesian(position);
    const longitude = Cesium.Math.toDegrees(carto.longitude);
    const latitude = Cesium.Math.toDegrees(carto.latitude);
    const message = window.prompt('Enter your message:');
    if (!message) return;
    const payload = { position: { longitude, latitude }, message, icon };
    try {
      const response = await fetch(`${API_BASE}/api/scenes/${encodeURIComponent(sceneKeyFrom(config))}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'save_message_failed');
      config.config.talkMessages = data.messages || [];
      addTalkEntity(payload, true);
      setStatus('Note saved.');
    } catch (err) {
      setStatus(`Could not save note: ${err.message || err}`, 'error');
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  activeToolHandler.setInputAction(clearActiveTool, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
}

function toggleTalkVisibility(show) {
  talkItems.forEach((item) => {
    if (item.entity.billboard) item.entity.billboard.show = show;
    if (item.entity.label) item.entity.label.show = show;
  });
}

function showTalkPopup(config) {
  if (!toolPopup) return;
  toolPopup.innerHTML = `
    <header><strong>Notes</strong><button type="button" data-tool-close aria-label="Close">x</button></header>
    <div class="tool-popup-actions">
      <div class="icon-picker">
        <button type="button" data-talk-icon="happy" class="active"><img src="${API_BASE}/view/icons/smile.png" alt="happy"></button>
        <button type="button" data-talk-icon="semi-arg"><img src="${API_BASE}/view/icons/sad.png" alt="sad"></button>
        <button type="button" data-talk-icon="arg"><img src="${API_BASE}/view/icons/arg.png" alt="arg"></button>
      </div>
      <button type="button" class="viewer-button" data-talk-add><i class="bx bx-plus"></i><span>Add note</span></button>
      <button type="button" class="viewer-button" data-talk-toggle><i class="bx bx-hide"></i><span>Toggle notes</span></button>
    </div>
  `;
  toolPopup.hidden = false;
  let selected = 'happy';
  toolPopup.querySelector('[data-tool-close]')?.addEventListener('click', hideToolPopup);
  toolPopup.querySelectorAll('[data-talk-icon]').forEach((button) => {
    button.addEventListener('click', () => {
      selected = button.dataset.talkIcon;
      toolPopup.querySelectorAll('[data-talk-icon]').forEach((item) => item.classList.toggle('active', item === button));
    });
  });
  toolPopup.querySelector('[data-talk-add]')?.addEventListener('click', () => startTalkTool(config, selected));
  let visible = true;
  toolPopup.querySelector('[data-talk-toggle]')?.addEventListener('click', () => {
    visible = !visible;
    toggleTalkVisibility(visible);
  });
}

function addInfoIconEntity(icon) {
  const lon = Number(icon.longitude);
  const lat = Number(icon.latitude);
  const height = Number(icon.height);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
  const color = Cesium.Color.fromCssColorString(icon.color || '#2563eb');
  const entity = viewer.entities.add({
    name: icon.name || 'Info',
    description: icon.description || '',
    position: Cesium.Cartesian3.fromDegrees(lon, lat, Number.isFinite(height) ? height : 60),
    billboard: {
      image: new Cesium.PinBuilder().fromColor(color, 36),
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM
    }
  });
  infoIconItems.push({ entity, lon, lat, name: icon.name });
}

function loadInfoIcons(config) {
  for (const item of infoIconItems) viewer.entities.remove(item.entity);
  infoIconItems.length = 0;
  const icons = Array.isArray(config?.config?.infoIcons) ? config.config.infoIcons : [];
  icons.forEach(addInfoIconEntity);
}

function startInfoIconTool(config) {
  clearActiveTool();
  activeToolHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  setStatus('Info icon: click the globe, then enter name and description.');
  activeToolHandler.setInputAction(async (event) => {
    const position = pickGlobePosition(event.position);
    if (!position) return;
    const carto = Cesium.Cartographic.fromCartesian(position);
    const name = window.prompt('Icon name');
    if (!name) return;
    const description = window.prompt('Description / HTML (optional)', '') || '';
    const payload = {
      name,
      description,
      color: '#2563eb',
      longitude: Cesium.Math.toDegrees(carto.longitude),
      latitude: Cesium.Math.toDegrees(carto.latitude),
      height: carto.height || 60
    };
    try {
      const response = await fetch(`${API_BASE}/api/scenes/${encodeURIComponent(sceneKeyFrom(config))}/info-icons`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'save_info_icon_failed');
      config.config.infoIcons = data.icons || [];
      addInfoIconEntity(payload);
      setStatus(`Info icon saved: ${name}`);
    } catch (err) {
      setStatus(`Could not save info icon: ${err.message || err}`, 'error');
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  activeToolHandler.setInputAction(clearActiveTool, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
}

function resetSimulation() {
  simulationState.paused = true;
  simulationState.frame = 0;
  if (simulationState.handler) {
    simulationState.handler.destroy();
    simulationState.handler = null;
  }
  if (simulationState.pathEntity) viewer.entities.remove(simulationState.pathEntity);
  if (simulationState.focusEntity) viewer.entities.remove(simulationState.focusEntity);
  simulationState.pathEntity = null;
  simulationState.focusEntity = null;
  simulationState.focusPoint = null;
  simulationState.pathPoints = [];
  const play = document.getElementById('simulationPlayButton');
  if (play) play.textContent = 'Play';
}

function createSimulationLine(positions) {
  return viewer.entities.add({
    polyline: { positions, width: 5, material: Cesium.Color.WHITE, clampToGround: true },
    properties: { isSimulation: true }
  });
}

function calculateHeading(fromPosition, toPosition) {
  const fromCarto = Cesium.Cartographic.fromCartesian(fromPosition);
  const toCarto = Cesium.Cartographic.fromCartesian(toPosition);
  return Math.atan2(toCarto.longitude - fromCarto.longitude, toCarto.latitude - fromCarto.latitude);
}

async function adjustSimulationPositions(positions) {
  const heightOffset = Number(document.getElementById('cameraHeight')?.value) || 10;
  const cartos = positions.map((pos) => Cesium.Cartographic.fromCartesian(pos)).filter(Boolean);
  if (!cartos.length) return [];
  try {
    const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartos);
    return sampled.filter((pos) => pos && Cesium.defined(pos.height)).map((pos) => Cesium.Cartesian3.fromRadians(pos.longitude, pos.latitude, pos.height + heightOffset));
  } catch {
    return positions.map((pos) => {
      const carto = Cesium.Cartographic.fromCartesian(pos);
      return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, (carto.height || 0) + heightOffset);
    });
  }
}

function startSimulationPlayback(positions) {
  let index = 0;
  let t = 0;
  const step = () => {
    if (simulationState.paused || index >= positions.length - 1) return;
    const start = positions[index];
    const end = positions[index + 1];
    const current = Cesium.Cartesian3.lerp(start, end, t, new Cesium.Cartesian3());
    viewer.camera.setView({
      destination: current,
      orientation: {
        heading: calculateHeading(current, simulationState.focusPoint),
        pitch: Cesium.Math.toRadians(simulationState.pitch),
        roll: 0
      }
    });
    t += simulationState.speed;
    if (t >= 1) {
      t = 0;
      index++;
    }
    if (!simulationState.paused) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function startSimulationTool() {
  clearActiveTool();
  resetSimulation();
  const panel = document.getElementById('simulationPanel');
  if (panel) panel.hidden = false;
  simulationState.handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  setStatus('Simulation: click a focus point.');
  simulationState.handler.setInputAction((event) => {
    const position = pickGlobePosition(event.position);
    if (!position) return;
    simulationState.focusPoint = Cesium.Cartesian3.clone(position);
    if (simulationState.focusEntity) viewer.entities.remove(simulationState.focusEntity);
    simulationState.focusEntity = viewer.entities.add({
      position: simulationState.focusPoint,
      point: { color: Cesium.Color.YELLOW, pixelSize: 10, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND }
    });
    simulationState.pathPoints = [];
    setStatus('Focus selected. Click path points, double-click to finish.');
    simulationState.handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    simulationState.handler.setInputAction((click) => {
      const next = pickGlobePosition(click.position);
      if (!next) return;
      simulationState.pathPoints.push(next);
      if (simulationState.pathEntity) viewer.entities.remove(simulationState.pathEntity);
      if (simulationState.pathPoints.length > 1) simulationState.pathEntity = createSimulationLine(simulationState.pathPoints.slice());
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    simulationState.handler.setInputAction(() => {
      if (simulationState.pathPoints.length < 2) {
        setStatus('Need at least two path points.', 'error');
        return;
      }
      if (simulationState.handler) {
        simulationState.handler.destroy();
        simulationState.handler = null;
      }
      setStatus('Path ready. Adjust controls and click Play.');
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function bindSimulationControls() {
  const panel = document.getElementById('simulationPanel');
  if (!panel || panel.dataset.bound === '1') return;
  panel.dataset.bound = '1';
  const height = document.getElementById('cameraHeight');
  const speed = document.getElementById('simulationSpeed');
  const pitch = document.getElementById('simulationPitch');
  const play = document.getElementById('simulationPlayButton');
  const reset = document.getElementById('simulationResetButton');
  const close = document.getElementById('simulationClose');
  height?.addEventListener('input', () => {
    const value = document.getElementById('simHeightValue');
    if (value) value.textContent = `${height.value} m`;
  });
  speed?.addEventListener('input', () => {
    simulationState.speed = Number(speed.value) || 0.005;
    const value = document.getElementById('speedValue');
    if (value) value.textContent = simulationState.speed.toFixed(4);
  });
  pitch?.addEventListener('input', () => {
    simulationState.pitch = Number(pitch.value) || -20;
    const value = document.getElementById('pitchValue');
    if (value) value.textContent = `${simulationState.pitch}°`;
  });
  play?.addEventListener('click', async () => {
    if (!simulationState.focusPoint || simulationState.pathPoints.length < 2) {
      setStatus('Select a focus point and draw a path first.', 'error');
      return;
    }
    simulationState.paused = !simulationState.paused;
    play.textContent = simulationState.paused ? 'Play' : 'Pause';
    if (!simulationState.paused) {
      const adjusted = await adjustSimulationPositions(simulationState.pathPoints);
      startSimulationPlayback(adjusted);
    }
  });
  reset?.addEventListener('click', () => {
    resetSimulation();
    setStatus('Simulation reset.');
  });
  close?.addEventListener('click', () => {
    resetSimulation();
    panel.hidden = true;
  });
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
  const configured = enabledModules(config.config?.modules || {});
  const modules = ['home', 'identify', ...configured.filter((key) => key !== 'home' && key !== 'identify')];
  if (!modules.includes('layers')) modules.splice(2, 0, 'layers');
  modulesEl.innerHTML = modules.map((key) => `<span>${key}</span>`).join('');
  const iconByModule = {
    home: 'bx-home',
    identify: 'bx-info-circle',
    layers: 'bx-layer',
    measurement: 'bx-ruler',
    redline: 'bx-pencil',
    bookmarks: 'bx-list-ul',
    print: 'bx-printer',
    timeline: 'bx-time-five',
    shadows: 'bx-moon',
    skybox: 'bx-cloud',
    simulation: 'bx-street-view',
    models: 'bx-cube-alt',
    feedback: 'bx-comment-dots',
    infoicons: 'bx-map-pin'
  };
  const titleByModule = {
    home: 'Home',
    identify: 'Identify',
    layers: 'Layers',
    measurement: 'Measure',
    redline: 'Sketch',
    bookmarks: 'Saved views',
    print: 'Export',
    shadows: 'Shadows',
    models: 'Assets',
    simulation: 'Simulation',
    feedback: 'Notes',
    infoicons: 'Info icons'
  };
  toolButtons.innerHTML = modules.map((key) => `<button type="button" data-tool="${key}" title="${titleByModule[key] || key}"><i class="bx ${iconByModule[key] || 'bx-cog'}"></i></button>`).join('');
  toolButtons.querySelectorAll('[data-tool]').forEach((button) => {
    button.addEventListener('click', () => {
      const tool = button.dataset.tool;
      toolButtons.querySelectorAll('[data-tool]').forEach((item) => item.classList.toggle('active', item === button && tool !== 'home' && tool !== 'shadows'));
      if (tool === 'home') {
        hideIdentifyCard();
        hideToolPopup();
        flyHome();
        return;
      }
      if (tool === 'identify') {
        startIdentifyTool();
        return;
      }
      if (tool === 'layers' || tool === 'models') toggleLayerDialog(config);
      if (tool === 'measurement') showToolPopup('Measure', [
        { key: 'distance', label: 'Distance', icon: 'bx-ruler', run: startDistanceMeasure },
        { key: 'area', label: 'Area', icon: 'bx-shape-polygon', run: startAreaMeasure },
        { key: 'height', label: 'Height', icon: 'bx-up-arrow-alt', run: startHeightMeasure },
        { key: 'clear', label: 'Clear', icon: 'bx-trash', run: clearDrawings }
      ]);
      if (tool === 'redline') showSketchPopup();
      if (tool === 'print') showPrintPopup(config);
      if (tool === 'bookmarks') showSavedViewsPopup(config);
      if (tool === 'shadows') viewer.scene.globe.enableLighting = !viewer.scene.globe.enableLighting;
      if (tool === 'simulation') startSimulationTool();
      if (tool === 'feedback') showTalkPopup(config);
      if (tool === 'infoicons') startInfoIconTool(config);
    });
  });
}

async function flyToScene(config) {
  const savedViews = Array.isArray(config.config?.savedViews) ? config.config.savedViews : [];
  const defaultView = savedViews.find((view) => view.isDefault) || null;
  if (defaultView) {
    try {
      viewer.homeButton.viewModel.command.beforeExecute.addEventListener((event) => {
        event.cancel = true;
        flyToSavedView(defaultView);
      });
    } catch {}
    flyToSavedView(defaultView);
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
  } catch {}
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
  sceneConfig = config;

  const isTerrainPreview = config.config?.previewMode === 'terrain' || config.scene?.terrainPreview === true;
  const isAssetPreview = config.config?.previewMode === 'asset' || config.scene?.assetPreview === true;
  titleEl.textContent = config.scene?.title || 'Qtiler 3D Eye';
  initViewer(config);
  viewer.camera.moveEnd.addEventListener(updateZoomDependentItems);
  if (!isTerrainPreview) {
    renderModules(config);
    bindSimulationControls();
    loadTalkMessages(config);
    loadInfoIcons(config);
  }
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
