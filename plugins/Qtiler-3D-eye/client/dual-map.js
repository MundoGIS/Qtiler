export function bridgeResolution(range, latitude, pixelHeight, fov) {
  const cosine = Math.max(0.01, Math.cos(latitude * Math.PI / 180));
  return Math.max(0.01, range * 2 * Math.tan(fov / 2) / Math.max(1, pixelHeight) / cosine);
}
export function bridgeRange(resolution, latitude, pixelHeight, fov) {
  return Math.max(10, resolution * Math.max(0.01, Math.cos(latitude * Math.PI / 180)) * Math.max(1, pixelHeight) / (2 * Math.tan(fov / 2)));
}

export function createDualMap(options) {
  const ol = window.ol;
  const Cesium = window.Cesium;
  if (!ol?.Map) throw new Error('Qtiler OpenLayers runtime is unavailable');
  const viewer = options.viewer;
  const homeCamera = { destination: Cesium.Cartesian3.clone(viewer.camera.positionWC), orientation: { heading: viewer.camera.heading, pitch: viewer.camera.pitch, roll: viewer.camera.roll } };
  document.body.dataset.mapMode = '3d';
  document.getElementById('mapModeControl').hidden = false;
  const view = new ol.View({ center: [0, 0], zoom: 3, minZoom: 0, maxZoom: 24 });
  const map = new ol.Map({ target: 'olContainer', view, controls: [new ol.control.Attribution({ collapsible: false })] });
  const layers = new Map();
  const sketchSource = new ol.source.Vector();
  const sketchLayer = new ol.layer.Vector({ source: sketchSource, zIndex: 1000, style: (feature) => vectorStyle(feature, feature.get('qtilerSketch') || {}, true) });
  map.addLayer(sketchLayer);
  const popup = document.getElementById('mapInfo2d');
  let mode = '3d';
  let activeMap = '3d';
  let busy = false;
  let lastOlState = '';
  let lastCameraState = '';
  let syncFrame = 0;
  let retainedPitch = -Math.PI / 3;
  let toolInteraction = null;
  let snapInteraction = null;
  let selecting = false;
  let picking = null;
  let featureInfoSuspended = false;
  let suppressSketch = false;
  const format = new ol.format.GeoJSON();
  function showFeatureInfo(properties, fields, screen) {
    popup.querySelector('[data-info-content]').innerHTML = options.featureInfo(properties, fields, location.origin);
    const width = popup.offsetWidth || 360;
    const height = popup.offsetHeight || 180;
    popup.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, screen.x + 12))}px`;
    popup.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, screen.y + 12))}px`;
    popup.hidden = false;
    popup.setAttribute('aria-hidden', 'false');
  }
  function hideFeatureInfo() { popup.hidden = true; popup.setAttribute('aria-hidden', 'true'); }
  const state = () => `${view.getCenter()?.map((value) => value.toFixed(2))}|${view.getResolution()?.toFixed(5)}|${view.getRotation()?.toFixed(6)}`;
  const cameraState = () => {
    const camera = viewer.camera;
    return [camera.positionWC.x, camera.positionWC.y, camera.positionWC.z, camera.heading, camera.pitch, camera.roll, viewer.canvas.clientWidth, viewer.canvas.clientHeight].join('|');
  };
  function center3d() {
    const canvas = viewer.canvas;
    const ray = viewer.camera.getPickRay(new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
    const point = ray && viewer.scene.globe.pick(ray, viewer.scene);
    if (point) {
      const coordinate = Cesium.Cartographic.fromCartesian(point);
      return { longitude: Cesium.Math.toDegrees(coordinate.longitude), latitude: Cesium.Math.toDegrees(coordinate.latitude), range: Cesium.Cartesian3.distance(viewer.camera.positionWC, point) };
    }
    const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
    if (!rectangle) return null;
    return { longitude: Cesium.Math.toDegrees(Cesium.Rectangle.center(rectangle).longitude), latitude: Cesium.Math.toDegrees(Cesium.Rectangle.center(rectangle).latitude), range: Math.max(10, viewer.camera.positionCartographic.height) };
  }
  function fromCesium(force = false) {
    if (busy || (mode === '2d' && !force)) return;
    const center = center3d(); if (!center) return;
    busy = true;
    try {
      retainedPitch = viewer.camera.pitch;
      view.setCenter(ol.proj.fromLonLat([center.longitude, center.latitude]));
      view.setResolution(bridgeResolution(center.range, center.latitude, viewer.canvas.clientHeight, viewer.camera.frustum.fovy || Math.PI / 3));
      view.setRotation(-viewer.camera.heading);
      lastOlState = state();
      lastCameraState = cameraState();
    } finally { busy = false; }
  }
  function fromOl() {
    if (busy || mode === '3d' || state() === lastOlState) return;
    busy = true;
    try {
      const [longitude, latitude] = ol.proj.toLonLat(view.getCenter());
      const coordinate = Cesium.Cartographic.fromDegrees(longitude, latitude);
      const ground = viewer.scene.globe.getHeight(coordinate) || 0;
      const range = bridgeRange(view.getResolution(), latitude, viewer.canvas.clientHeight, viewer.camera.frustum.fovy || Math.PI / 3);
      const target = Cesium.Cartesian3.fromDegrees(longitude, latitude, ground);
      viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(-view.getRotation(), retainedPitch, range));
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      lastOlState = state();
      lastCameraState = cameraState();
      options.onCameraChange?.();
    } finally { busy = false; }
  }
  map.on('moveend', fromOl);
  const scheduleFromOl = () => {
    if (busy || mode === '3d' || syncFrame) return;
    syncFrame = requestAnimationFrame(() => { syncFrame = 0; fromOl(); syncLayers(); });
  };
  view.on(['change:center', 'change:resolution', 'change:rotation'], scheduleFromOl);
  const cameraChanged = () => { if (cameraState() !== lastCameraState) { fromCesium(); syncLayers(); } };
  const previousPercentage = viewer.camera.percentageChanged;
  viewer.camera.percentageChanged = 0.01;
  viewer.camera.changed.addEventListener(cameraChanged);
  document.getElementById('olContainer').addEventListener('pointerdown', () => { activeMap = '2d'; document.dispatchEvent(new CustomEvent('qtiler3d:active-map-change')); });
  viewer.canvas.addEventListener('pointerdown', () => { activeMap = '3d'; document.dispatchEvent(new CustomEvent('qtiler3d:active-map-change')); });
  viewer.camera.moveEnd.addEventListener(fromCesium);
  function vectorStyle(feature, layer, sketch = false) {
    const properties = feature.getProperties();
    const style = sketch ? layer : feature.get('qtilerRenderStyle') || options.effectiveStyle({ properties: { getValue: () => properties } }, layer, options.styleZoom());
    const opacity = style.fillOpacity ?? 0.55;
    const color = ol.color.asArray((sketch ? style.fillColor : style.color) || '#2f80ed').slice(); color[3] = opacity;
    const stroke = ol.color.asArray((sketch ? style.color : style.strokeColor) || '#ffffff').slice(); stroke[3] = sketch ? style.opacity ?? 1 : style.strokeOpacity ?? 1;
    const pointSize = style.pointSize || (sketch ? 10 : 18);
    const width = sketch ? style.width ?? 3 : Number(style.strokeWidth || (feature.getGeometry().getType() === 'Point' ? 1 : feature.getGeometry().getType() === 'LineString' ? 3 : 2));
    const image = sketch && style.text ? undefined : !sketch && (style.symbolType === 'svg' || (!style.symbolType && style.iconUrl)) && style.iconUrl
      ? new ol.style.Icon({ src: style.iconUrl, scale: style.iconScale ?? 1, color, anchor: [0.5, 1], crossOrigin: 'anonymous' })
      : new ol.style.Circle({ radius: pointSize / 2, fill: new ol.style.Fill({ color }), stroke: new ol.style.Stroke({ color: stroke, width }) });
    return new ol.style.Style({ image, fill: new ol.style.Fill({ color }), stroke: new ol.style.Stroke({ color: stroke, width, lineDash: style.dash === 'dashed' ? [8, 6] : undefined }),
      text: style.text ? new ol.style.Text({ text: style.text, font: `${pointSize}px sans-serif`, fill: new ol.style.Fill({ color: stroke }), stroke: new ol.style.Stroke({ color: '#fff', width: 2 }) }) : undefined });
  }
  const valueAt = (property) => property?.getValue ? property.getValue(viewer.clock.currentTime) : property;
  function assetFeatures(item) {
    const coordinate = (position) => { const point = Cesium.Cartographic.fromCartesian(position); return [Cesium.Math.toDegrees(point.longitude), Cesium.Math.toDegrees(point.latitude), point.height]; };
    const ring = (positions) => { const result = positions.map(coordinate); return [...result, result[0]]; };
    const features = [];
    for (const entity of item.object.entities.values) {
      if (!entity.isAvailable(viewer.clock.currentTime) || valueAt(entity.show) === false) continue;
      let geometry = null;
      const hierarchy = valueAt(entity.polygon?.hierarchy);
      const positions = valueAt(entity.polyline?.positions);
      const position = valueAt(entity.position);
      if (hierarchy?.positions?.length >= 3) geometry = { type: 'Polygon', coordinates: [ring(hierarchy.positions), ...(hierarchy.holes || []).map((hole) => ring(hole.positions))] };
      else if (positions?.length >= 2) geometry = { type: 'LineString', coordinates: positions.map(coordinate) };
      else if (position) geometry = { type: 'Point', coordinates: coordinate(position) };
      if (!geometry) continue;
      const color = valueAt(entity.polygon?.material)?.color || valueAt(entity.point?.color) || valueAt(entity.billboard?.color) || Cesium.Color.ROYALBLUE;
      const outline = valueAt(entity.polyline?.material)?.color || valueAt(entity.point?.outlineColor) || valueAt(entity.polygon?.outlineColor) || Cesium.Color.WHITE;
      const image = valueAt(entity.billboard?.image);
      const style = { color: color.toCssColorString(), fillOpacity: color.alpha, strokeColor: outline.toCssColorString(), strokeOpacity: outline.alpha, strokeWidth: valueAt(entity.polyline?.width) || valueAt(entity.point?.outlineWidth) || 2, pointSize: valueAt(entity.point?.pixelSize) || 18, text: valueAt(entity.label?.text) || '' };
      if (typeof image === 'string') { style.symbolType = 'svg'; style.iconUrl = image; style.iconScale = valueAt(entity.billboard?.scale) ?? 1; }
      features.push({ type: 'Feature', geometry, properties: { ...(valueAt(entity.properties) || {}), name: entity.name || entity.id, qtilerRenderStyle: style } });
    }
    return { type: 'FeatureCollection', features };
  }
  function syncLayers() {
    for (const [key, item] of options.runtimeItems) {
      if (!['wfs', 'wms', 'osm', 'xyz', 'geojson', 'kml', 'czml'].includes(item.type)) continue;
      const vectorAsset = ['geojson', 'kml', 'czml'].includes(item.type);
      let layer = layers.get(key);
      if (!layer) {
        const definition = item.layer || {};
        if (item.type === 'wfs' || vectorAsset) layer = new ol.layer.Vector({ source: new ol.source.Vector(), style: (feature) => vectorStyle(feature, definition) });
        else {
          const credit = definition.credit ? definition.credit.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])) : item.type === 'osm' ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' : undefined;
          const source = item.type === 'wms' ? new ol.source.TileWMS({ url: definition.url, crossOrigin: 'use-credentials', attributions: credit, params: { LAYERS: definition.layerName || '', FORMAT: 'image/png', VERSION: '1.1.1', TRANSPARENT: !definition.isBaseLayer } }) : new ol.source.XYZ({ url: definition.url, crossOrigin: 'anonymous', attributions: credit });
          layer = new ol.layer.Tile({ source });
        }
        layer.set('qtilerItem', item); layer.setZIndex(item.category === 'background' ? 0 : 10 + layers.size);
        layers.set(key, layer); map.addLayer(layer);
      }
      layer.setVisible(item.category === 'background' || vectorAsset ? item.object?.show === true : item.layer?.visible !== false && options.zoomInRange(item.layer || {}, options.styleZoom()));
      if (item.type === 'wms' || ['osm', 'xyz'].includes(item.type)) layer.setOpacity(item.opacity ?? 1);
      if (vectorAsset && item.object && (item.type === 'czml' || layer.get('loadedAsset') !== item.object)) {
        layer.getSource().clear(); layer.getSource().addFeatures(format.readFeatures(assetFeatures(item), { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' })); layer.set('loadedAsset', item.object);
      }
      if (item.type === 'wfs' && item.geojson && layer.get('loadedGeojson') !== item.geojson) {
        layer.getSource().clear(); layer.getSource().addFeatures(format.readFeatures(item.geojson, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
        layer.set('loadedGeojson', item.geojson);
      }
    }
    for (const [key, layer] of layers) if (!options.runtimeItems.has(key)) { map.removeLayer(layer); layers.delete(key); }
    map.render();
  }
  function syncSketch(features) {
    suppressSketch = true;
    try { sketchSource.clear(); sketchSource.addFeatures(format.readFeatures({ type: 'FeatureCollection', features }, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' })); }
    finally { suppressSketch = false; }
  }
  function cancelSketch() {
    if (toolInteraction) map.removeInteraction(toolInteraction);
    if (snapInteraction) map.removeInteraction(snapInteraction);
    snapInteraction = null;
    toolInteraction = null; selecting = false; picking = null;
    suspendFeatureInfo(false);
  }
  function suspendFeatureInfo(suspended) {
    featureInfoSuspended = suspended === true;
    if (featureInfoSuspended) hideFeatureInfo();
  }
  function drawSketch(kind, style, add, snap = true) {
    cancelSketch();
    suspendFeatureInfo(true);
    if (kind === 'select') { selecting = true; return; }
    toolInteraction = new ol.interaction.Draw({ type: ['point', 'text', 'model'].includes(kind) ? 'Point' : kind === 'polygon' ? 'Polygon' : 'LineString', freehand: kind === 'freehand' });
    toolInteraction.on('drawend', (event) => {
      const feature = format.writeFeatureObject(event.feature, { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' });
      feature.properties = { qtilerSketch: style };
      try { add(feature); } catch (error) { options.error(error); }
      cancelSketch();
    });
    map.addInteraction(toolInteraction);
    if (snap) { snapInteraction = new ol.interaction.Snap({ source: sketchSource, pixelTolerance: 12 }); map.addInteraction(snapInteraction); }
  }
  function modifySketch(commit, snap = true) {
    cancelSketch();
    suspendFeatureInfo(true);
    toolInteraction = new ol.interaction.Modify({ source: sketchSource });
    toolInteraction.on('modifyend', () => { if (!suppressSketch) { try { commit(format.writeFeaturesObject(sketchSource.getFeatures(), { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' })); } catch (error) { options.error(error); syncSketch(options.sketchFeatures()); } } });
    map.addInteraction(toolInteraction);
    if (snap) { snapInteraction = new ol.interaction.Snap({ source: sketchSource, pixelTolerance: 12 }); map.addInteraction(snapInteraction); }
  }
  map.on('singleclick', async (event) => {
    if (picking) { const action = picking; picking = null; suspendFeatureInfo(false); action(ol.proj.toLonLat(event.coordinate)); return; }
    if (featureInfoSuspended || toolInteraction || selecting) return;
    let found = false;
    map.forEachFeatureAtPixel(event.pixel, (feature, layer) => {
      if (layer === sketchLayer) { if (selecting) options.selectSketch(sketchSource.getFeatures().indexOf(feature)); found = true; return true; }
      const item = layer?.get('qtilerItem'); if (!item) return false;
      const properties = { ...feature.getProperties() }; delete properties[feature.getGeometryName()]; delete properties.qtilerRenderStyle;
      const pixel = map.getPixelFromCoordinate(event.coordinate);
      const rect = document.getElementById('olContainer').getBoundingClientRect();
      showFeatureInfo(properties, item.layer?.infoFields, { x: rect.left + pixel[0], y: rect.top + pixel[1] }); found = true; return true;
    });
    if (found) return;
    const wmsLayer = map.getLayers().getArray().slice().reverse().find((layer) => {
      const candidate = layer.get('qtilerItem');
      return layer.getVisible() && candidate?.type === 'wms' && candidate.layer?.layerName;
    });
    const wmsItem = wmsLayer?.get('qtilerItem') || null;
    if (!wmsItem) return;
    try {
      const source = layers.get(wmsItem.layer.key)?.getSource();
      const url = source?.getFeatureInfoUrl(event.coordinate, view.getResolution(), map.getView().getProjection(), { INFO_FORMAT: 'application/json', FEATURE_COUNT: 10 });
      if (!url) return;
      const response = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(10000) });
      if (!response.ok) return;
      const payload = await response.json();
      const feature = payload.features?.[0];
      if (!feature?.properties) return;
      const rect = document.getElementById('olContainer').getBoundingClientRect();
      const pixel = map.getPixelFromCoordinate(event.coordinate);
      showFeatureInfo(feature.properties, wmsItem.layer.infoFields, { x: rect.left + pixel[0], y: rect.top + pixel[1] });
    } catch (error) { options.error(error); }
  });
  popup.querySelector('button').onclick = hideFeatureInfo;
  const infoSelectionChanged = (entity) => {
    if (featureInfoSuspended) return;
    const item = entity?._qtilerLayerItem;
    if (!item) return;
    const values = entity.properties?.getValue(viewer.clock.currentTime) || {};
    const position = entity.position?.getValue(viewer.clock.currentTime);
    const pixel = position && viewer.scene.cartesianToCanvasCoordinates(position);
    const rect = viewer.canvas.getBoundingClientRect();
    showFeatureInfo(values, item.layer?.infoFields, { x: rect.left + (pixel?.x ?? rect.width / 2), y: rect.top + (pixel?.y ?? rect.height / 2) });
    queueMicrotask(() => { if (viewer.selectedEntity === entity) viewer.selectedEntity = undefined; });
  };
  viewer.selectedEntityChanged.addEventListener(infoSelectionChanged);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !popup.hidden) hideFeatureInfo(); });
  function setMode(next) {
    if (!['2d', '3d', 'split'].includes(next)) return;
    if (next === mode) return;
    document.querySelectorAll('#toolButtons .toolbox[open]').forEach((toolbox) => { toolbox.open = false; });
    options.cancelTools(); cancelSketch();
    if (mode === '3d') fromCesium();
    else fromOl();
    mode = next; document.body.dataset.mapMode = next;
    activeMap = next === '2d' ? '2d' : '3d';
    document.dispatchEvent(new CustomEvent('qtiler3d:active-map-change'));
    document.querySelectorAll('[data-map-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mapMode === next)));
    document.querySelectorAll('[data-3d-only]').forEach((element) => { element.hidden = next === '2d'; });
    if (next === '2d' && document.querySelector('[data-layer-tab="terrains"]').getAttribute('aria-selected') === 'true') document.querySelector('[data-layer-tab="layers"]').click();
    hideFeatureInfo();
    map.updateSize(); viewer.resize();
    if (next === 'split') fromCesium();
    syncLayers();
  }
  function focus2d() {
    if (mode === '3d') setMode('2d');
    activeMap = '2d';
  }
  function zoomToExtent(bounds) {
    if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) return;
    const extent = ol.proj.transformExtent(bounds, 'EPSG:4326', view.getProjection());
    view.fit(extent, { size: map.getSize(), padding: [48, 48, 48, 48], maxZoom: 17, duration: 700 });
  }
  document.querySelectorAll('[data-map-mode]').forEach((button) => { button.onclick = () => setMode(button.dataset.mapMode); });
  const resize = new ResizeObserver(() => { map.updateSize(); viewer.resize(); });
  resize.observe(document.getElementById('olContainer'));
  let lastAssetTick = null;
  const clockTick = () => {
    if (mode === '3d' || !Array.from(options.runtimeItems.values()).some((item) => item.type === 'czml')) return;
    if (lastAssetTick && Math.abs(Cesium.JulianDate.secondsDifference(viewer.clock.currentTime, lastAssetTick)) < 0.2) return;
    lastAssetTick = Cesium.JulianDate.clone(viewer.clock.currentTime); syncLayers();
  };
  viewer.clock.onTick.addEventListener(clockTick);
  const divider = document.getElementById('mapDivider');
  const resizeSplit = (percentage) => {
    const value = Math.max(25, Math.min(75, percentage));
    document.body.style.setProperty('--map-split', `${value}%`);
    divider.setAttribute('aria-valuenow', String(Math.round(value)));
    map.updateSize(); viewer.resize(); fromCesium();
  };
  divider.onpointerdown = (event) => { event.preventDefault(); divider.setPointerCapture(event.pointerId); };
  divider.onpointermove = (event) => { if (divider.hasPointerCapture(event.pointerId)) resizeSplit(100 * event.clientX / document.body.clientWidth); };
  divider.onpointerup = (event) => { if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId); };
  divider.onkeydown = (event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resizeSplit(Number(divider.getAttribute('aria-valuenow')) + (event.key === 'ArrowLeft' ? -5 : 5)); } };
  function measure(type, callbacks = {}) {
    cancelSketch();
    suspendFeatureInfo(true);
    toolInteraction = new ol.interaction.Draw({ type });
    toolInteraction.on('drawstart', (event) => {
      callbacks.onStart?.();
      event.feature.getGeometry().on('change', () => {
        const geometry = event.feature.getGeometry();
        callbacks.onUpdate?.(type === 'Polygon' ? ol.sphere.getArea(geometry) : ol.sphere.getLength(geometry));
      });
    });
    toolInteraction.on('drawend', (event) => {
      const geometry = event.feature.getGeometry();
      const metres = type === 'Polygon' ? ol.sphere.getArea(geometry) : ol.sphere.getLength(geometry);
      callbacks.onFinish?.(metres);
      cancelSketch();
    });
    map.addInteraction(toolInteraction);
  }
  return { map, get mode() { return mode; }, get activeMap() { return mode === 'split' ? activeMap : mode; }, setMode, focus2d, zoomToExtent, syncLayers, syncSketch, drawSketch, modifySketch, cancelSketch, measure,
    finishDrawing() { toolInteraction?.finishDrawing?.(); },
    pick(callback) { picking = callback; suspendFeatureInfo(true); }, suspendFeatureInfo, fromCesium, fromOl,
    home() { options.cancelTools(); viewer.camera.setView(homeCamera); fromCesium(true); syncLayers(); },
    zoom(delta) { view.setZoom(view.getZoom() + delta); fromOl(); }, north() { view.setRotation(0); fromOl(); },
    dispose() { resize.disconnect(); cancelAnimationFrame(syncFrame); cancelSketch(); view.un(['change:center', 'change:resolution', 'change:rotation'], scheduleFromOl); viewer.selectedEntityChanged.removeEventListener(infoSelectionChanged); viewer.clock.onTick.removeEventListener(clockTick); viewer.camera.changed.removeEventListener(cameraChanged); viewer.camera.percentageChanged = previousPercentage; viewer.camera.moveEnd.removeEventListener(fromCesium); map.setTarget(null); }
  };
}