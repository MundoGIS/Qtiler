(function () {
  'use strict';

  const defaults = { color: '#087c73', fillColor: '#31b6a7', opacity: 1, fillOpacity: 0.35, width: 3, pointSize: 10, mode: 'ground', height: 0, extrusion: 0, dash: 'solid', text: '', name: '', modelAssetId: '', modelScale: 1, heading: 0, pitch: 0, roll: 0 };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function number(value, fallback, min, max) {
    const parsed = value == null || value === '' ? fallback : Number(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error('Invalid numeric drawing property');
    return parsed;
  }
  function normalizeStyle(input = {}) {
    const result = { ...defaults, ...input };
    for (const key of ['color', 'fillColor']) if (!/^#[0-9a-f]{6}$/i.test(result[key])) throw new Error('Invalid drawing color');
    if (!['ground', 'relative', 'absolute'].includes(result.mode)) throw new Error('Invalid height mode');
    if (!['solid', 'dashed'].includes(result.dash)) throw new Error('Invalid line pattern');
    result.opacity = number(result.opacity, 1, 0, 1);
    result.fillOpacity = number(result.fillOpacity, 0.35, 0, 1);
    result.width = number(result.width, 3, 1, 32);
    result.pointSize = number(result.pointSize, 10, 2, 64);
    result.height = number(result.height, 0, -10000, 100000);
    result.extrusion = number(result.extrusion, 0, 0, 100000);
    result.text = String(result.text || '').slice(0, 500);
    result.name = String(result.name || '').slice(0, 100);
    result.modelAssetId = String(result.modelAssetId || '').slice(0, 150);
    result.modelScale = number(result.modelScale, 1, 0.01, 10000);
    result.heading = number(result.heading, 0, -360, 360);
    result.pitch = number(result.pitch, 0, -360, 360);
    result.roll = number(result.roll, 0, -360, 360);
    return result;
  }
  function normalizeFeature(feature) {
    const geometry = feature?.geometry;
    if (feature?.type !== 'Feature' || !['Point', 'LineString', 'Polygon'].includes(geometry?.type)) throw new Error('Only points, lines and polygons can be edited');
    if (geometry.type === 'Polygon' && geometry.coordinates?.length !== 1) throw new Error('Polygons with holes cannot be edited here');
    let points = geometry.type === 'Point' ? [geometry.coordinates] : geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates;
    if (!Array.isArray(points) || points.length > 2000) throw new Error('Invalid geometry or more than 2000 vertices');
    points = points.map((point) => {
      if (!Array.isArray(point)) throw new Error('Invalid vertex');
      return [number(point[0], NaN, -180, 180), number(point[1], NaN, -90, 90), number(point[2], 0, -10000, 100000)];
    });
    if (geometry.type === 'Polygon' && points.length > 1 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1]) points.pop();
    if (points.length < (geometry.type === 'Polygon' ? 3 : geometry.type === 'LineString' ? 2 : 1)) throw new Error('Not enough vertices');
    const properties = feature.properties || {};
    const legacyColor = window.Cesium?.Color?.fromCssColorString(String(properties.color || ''));
    const style = normalizeStyle(properties.qtilerSketch || {
      ...defaults,
      name: properties.name || '', text: properties.text || '', width: properties.width || 3,
      pointSize: properties.pixelSize || 10, extrusion: properties.extrudedHeight || 0,
      ...(legacyColor ? { color: legacyColor.toCssHexString(), fillColor: legacyColor.toCssHexString(), opacity: legacyColor.alpha, fillOpacity: legacyColor.alpha } : {})
    });
    if (geometry.type === 'Polygon' && window.turf?.kinks) {
      const ring = [...points, points[0]];
      if (window.turf.kinks(window.turf.polygon([ring])).features.length) throw new Error('The polygon crosses itself');
    }
    return { type: 'Feature', geometry: { type: geometry.type, coordinates: geometry.type === 'Point' ? points[0] : geometry.type === 'Polygon' ? [[...points, [...points[0]]]] : points }, properties: { qtilerSketch: style } };
  }

  function createHistory(initial = []) {
    let snapshots = [clone(initial)];
    let index = 0;
    return {
      push(features) { snapshots = snapshots.slice(0, index + 1); snapshots.push(clone(features)); if (snapshots.length > 100) snapshots.shift(); index = snapshots.length - 1; },
      move(direction) { const next = index + direction; if (next < 0 || next >= snapshots.length) return null; index = next; return clone(snapshots[index]); },
      get canUndo() { return index > 0; },
      get canRedo() { return index < snapshots.length - 1; }
    };
  }
  function normalizeCollection(collection) {
    if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features) || collection.features.length > 1000) throw new Error('Invalid drawing collection');
    return collection.features.map(normalizeFeature);
  }

  function create(options) {
    const viewer = options.viewer;
    const Cesium = window.Cesium;
    let records = [];
    let selected = -1;
    let vertices = [];
    let kind = null;
    let handler = null;
    let preview = null;
    let vertexIndex = -1;
    let generation = 0;
    let previewGeneration = 0;
    let nextId = 1;
    let activeStyle = { ...defaults };
    const history = createHistory();
    let rotationBefore = null;
    let drawingDoubleClick = null;
    const entities = new Map();
    const models = new Map();
    const handles = [];
    const panel = document.createElement('aside');
    panel.className = 'sketch-panel';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Sketch editor');
    panel.innerHTML = `
      <header><strong data-qtiler3d-i18n="ui:sketch">Sketch editor</strong><button type="button" data-command="close" data-qtiler3d-i18n-title="ui:close"><i class="bx bx-x"></i></button></header>
      <nav class="sketch-tools" aria-label="Drawing tools">
        <button type="button" data-tool="select" data-qtiler3d-tool="select"><i class="bx bx-pointer"></i></button>
        <button type="button" data-tool="point" data-qtiler3d-tool="point"><i class="bx bx-map-pin"></i></button>
        <button type="button" data-tool="line" data-qtiler3d-tool="polyline"><i class="bx bx-minus"></i></button>
        <button type="button" data-tool="polygon" data-qtiler3d-tool="polygon"><i class="bx bx-shape-polygon"></i></button>
        <button type="button" data-tool="freehand" data-qtiler3d-tool="freehand"><i class="bx bx-pencil"></i></button>
        <button type="button" data-tool="text" data-qtiler3d-tool="text"><i class="bx bx-text"></i></button>
        <button type="button" data-tool="model" data-qtiler3d-tool="placeModel" data-3d-only><i class="bx bx-cube"></i></button>
        <button type="button" data-command="undo" data-qtiler3d-i18n-title="ui:undo"><i class="bx bx-undo"></i></button>
        <button type="button" data-command="redo" data-qtiler3d-i18n-title="ui:redo"><i class="bx bx-redo"></i></button>
      </nav>
      <div class="sketch-fields">
        <label><span data-qtiler3d-i18n="ui:name">Name</span><input data-property="name" maxlength="100"></label>
        <label><span data-qtiler3d-i18n="ui:strokeText">Stroke / text</span><input type="color" data-property="color" value="#087c73"></label>
        <label><span data-qtiler3d-i18n="ui:fill">Fill</span><input type="color" data-property="fillColor" value="#31b6a7"></label>
        <label><span data-qtiler3d-i18n="ui:strokeOpacity">Stroke opacity</span><input type="range" data-property="opacity" min="0" max="1" step="0.05" value="1"></label>
        <label><span data-qtiler3d-i18n="ui:fillOpacity">Fill opacity</span><input type="range" data-property="fillOpacity" min="0" max="1" step="0.05" value="0.35"></label>
        <label><span data-qtiler3d-i18n="ui:width">Width (px)</span><input type="number" data-property="width" min="1" max="32" value="3"></label>
        <label><span data-qtiler3d-i18n="ui:pointSize">Point size (px)</span><input type="number" data-property="pointSize" min="2" max="64" value="10"></label>
        <label><span data-qtiler3d-i18n="ui:linePattern">Line pattern</span><select data-property="dash"><option value="solid" data-qtiler3d-i18n="ui:solid">Solid</option><option value="dashed" data-qtiler3d-i18n="ui:dashed">Dashed</option></select></label>
        <label data-3d-only><span data-qtiler3d-i18n="ui:heightMode">Height mode</span><select data-property="mode"><option value="ground" data-qtiler3d-i18n="ui:onTerrain">On terrain</option><option value="relative" data-qtiler3d-i18n="ui:aboveTerrain">Above terrain</option><option value="absolute" data-qtiler3d-i18n="ui:absoluteAltitude">Absolute altitude</option></select></label>
        <label data-3d-only><span data-qtiler3d-i18n="ui:height">Height (m)</span><input type="number" data-property="height" min="-10000" max="100000" step="0.1" value="0"></label>
        <label data-3d-only><span data-qtiler3d-i18n="ui:extrusion">Extrusion (m)</span><input type="number" data-property="extrusion" min="0" max="100000" step="0.1" value="0"></label>
        <label><span data-qtiler3d-i18n="tools:text">Text</span><input data-property="text" maxlength="500"></label>
        <label data-3d-only><span data-qtiler3d-i18n="ui:model">Model</span><select data-property="modelAssetId"><option value="" data-qtiler3d-i18n="ui:selectModel">Select GLTF / GLB</option></select></label>
        <label data-3d-only><span data-qtiler3d-i18n="ui:modelScale">Model scale</span><input data-property="modelScale" type="number" min="0.01" max="10000" step="0.1" value="1"></label>
        <label data-3d-only><span data-qtiler3d-i18n="ui:heading">Heading (degrees)</span><input data-property="heading" type="number" min="-360" max="360" value="0"></label>
      </div>
      <label class="sketch-check"><input type="checkbox" data-snap checked><span data-qtiler3d-i18n="ui:snap">Snap to sketch vertices</span></label>
      <div class="sketch-commands"><button type="button" data-command="finish" data-qtiler3d-i18n="ui:finish">Finish</button><button type="button" data-command="cancel" data-qtiler3d-i18n="ui:cancel">Cancel</button><button type="button" data-command="apply" data-qtiler3d-i18n="ui:apply">Apply style</button><button type="button" data-command="delete" data-qtiler3d-i18n-title="ui:delete"><i class="bx bx-trash"></i></button><button type="button" data-command="clear" data-qtiler3d-i18n-title="ui:clear"><i class="bx bx-eraser"></i></button></div>
      <button type="button" data-command="modify2d" data-2d-only data-qtiler3d-i18n="ui:modify2d">Modify vertices in 2D</button>
      <label><span data-qtiler3d-i18n="ui:objects">Objects</span><select data-objects><option value="-1" data-qtiler3d-i18n="ui:none">No selection</option></select></label>
      <details><summary data-qtiler3d-i18n="ui:vertices">Vertices</summary><div data-vertices></div></details>
      <section class="sketch-storage"><input data-library-name data-qtiler3d-i18n-placeholder="ui:drawingName" aria-label="Drawing name" maxlength="100"><button type="button" data-command="save" data-qtiler3d-i18n-title="ui:saveDrawing"><i class="bx bx-save"></i></button><button type="button" data-command="load" data-qtiler3d-i18n-title="ui:loadDrawing"><i class="bx bx-folder-open"></i></button><button type="button" data-command="export" data-qtiler3d-i18n-title="ui:exportGeoJSON"><i class="bx bx-download"></i></button></section>
      <label><span data-qtiler3d-i18n="ui:importGeoJSON">Import GeoJSON</span><input data-import type="file" accept=".geojson,.json,application/geo+json,application/json"></label>
      <output data-status role="status" aria-live="polite">Ready</output>`;
    document.body.append(panel);
    window.qtiler3dI18n?.apply(panel);
    const status = (message, error = false) => { const output = panel.querySelector('[data-status]'); output.textContent = message; output.dataset.error = String(error); };
    const pointsOf = (feature) => feature.geometry.type === 'Point' ? [feature.geometry.coordinates] : feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0].slice(0, -1) : feature.geometry.coordinates;
    const features = () => records.map((record) => clone(record.feature));
    function checkpoint() { history.push(features()); options.changed?.(features()); }
    function readStyle() {
      const style = {};
      panel.querySelectorAll('[data-property]').forEach((input) => { style[input.dataset.property] = input.value; });
      return normalizeStyle(style);
    }
    function writeStyle(style) { for (const input of panel.querySelectorAll('[data-property]')) input.value = style[input.dataset.property]; panel.querySelector('[data-property="height"]').disabled = style.mode === 'ground'; }
    function removeHandles() { for (const entity of handles) viewer.entities.remove(entity); handles.length = 0; }
    function cancel() {
      options.cancel2d?.();
      options.suspendInfo?.(false);
      previewGeneration += 1;
      panel.querySelectorAll('[data-tool]').forEach((button) => button.classList.remove('active'));
      if (handler) { handler.destroy(); handler = null; }
      if (rotationBefore !== null) { viewer.scene.screenSpaceCameraController.enableRotate = rotationBefore; rotationBefore = null; }
      if (drawingDoubleClick) { viewer.screenSpaceEventHandler.setInputAction(drawingDoubleClick, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK); drawingDoubleClick = null; }
      if (preview) viewer.entities.remove(preview);
      preview = null; vertices = []; kind = null; vertexIndex = -1;
    }
    async function graphics(feature, temporary = false) {
      const style = feature.properties.qtilerSketch;
      const points = pointsOf(feature);
      const mode = style.mode;
      let terrainHeights = [];
      if (mode === 'relative' && feature.geometry.type !== 'Point') {
        const coordinates = points.map((point) => Cesium.Cartographic.fromDegrees(point[0], point[1]));
        const provider = viewer.terrainProvider;
        if (!(provider instanceof Cesium.EllipsoidTerrainProvider)) {
          const sampled = provider.availability ? await Cesium.sampleTerrainMostDetailed(provider, coordinates) : await Cesium.sampleTerrain(provider, 12, coordinates);
          terrainHeights = sampled.map((point) => {
            if (!Number.isFinite(point.height)) throw new Error('Terrain height could not be sampled');
            return point.height;
          });
        } else terrainHeights = points.map(() => 0);
      }
      const positions = points.map((point, index) => Cesium.Cartesian3.fromDegrees(point[0], point[1], mode === 'relative' && feature.geometry.type === 'LineString' ? terrainHeights[index] + style.height : mode === 'ground' ? 0 : style.height));
      const stroke = Cesium.Color.fromCssColorString(style.color).withAlpha(style.opacity);
      const fill = Cesium.Color.fromCssColorString(style.fillColor).withAlpha(style.fillOpacity);
      const heightReference = mode === 'ground' ? Cesium.HeightReference.CLAMP_TO_GROUND : mode === 'relative' ? Cesium.HeightReference.RELATIVE_TO_GROUND : Cesium.HeightReference.NONE;
      const result = { properties: { isDrawing: !temporary }, name: style.name };
      if (feature.geometry.type === 'Point') {
        result.position = positions[0];
        if (style.modelAssetId) {
          let asset = models.get(style.modelAssetId);
          if (!asset) { const library = await options.models(); library.forEach((item) => models.set(item.id, item)); asset = models.get(style.modelAssetId); }
          if (!asset) throw new Error('Model is no longer available in the asset library');
          result.model = { uri: asset.url, scale: style.modelScale, heightReference };
          result.orientation = Cesium.Transforms.headingPitchRollQuaternion(positions[0], new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(style.heading), Cesium.Math.toRadians(style.pitch), Cesium.Math.toRadians(style.roll)));
        } else if (style.text) result.label = { text: style.text, font: `${style.pointSize}px sans-serif`, fillColor: stroke, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, heightReference };
        else result.point = { pixelSize: style.pointSize, color: fill, outlineColor: stroke, outlineWidth: style.width, heightReference };
      } else if (feature.geometry.type === 'LineString') {
        result.polyline = { positions, width: style.width, clampToGround: mode === 'ground', material: style.dash === 'dashed' ? new Cesium.PolylineDashMaterialProperty({ color: stroke }) : stroke };
      } else {
        result.polygon = { hierarchy: new Cesium.PolygonHierarchy(positions), material: fill, outline: true, outlineColor: stroke, height: mode === 'ground' ? 0 : style.height, heightReference };
        if (style.extrusion > 0) { result.polygon.extrudedHeight = (mode === 'ground' ? 0 : style.height) + style.extrusion; result.polygon.extrudedHeightReference = heightReference; }
        result.polyline = { positions: [...positions, positions[0]], width: style.width, clampToGround: mode === 'ground', material: style.dash === 'dashed' ? new Cesium.PolylineDashMaterialProperty({ color: stroke }) : stroke };
        if (mode === 'relative') { const outline = points.map((point, index) => Cesium.Cartesian3.fromDegrees(point[0], point[1], terrainHeights[index] + style.height)); result.polyline.positions = [...outline, outline[0]]; }
      }
      return result;
    }
    async function render() {
      const revision = ++generation;
      options.changed?.(features());
      for (const entity of entities.values()) viewer.entities.remove(entity);
      entities.clear(); removeHandles();
      for (const record of records) {
        const options = await graphics(record.feature);
        if (revision !== generation) return;
        const entity = viewer.entities.add(options);
        entity._qtilerSketch = record.feature;
        entity._qtilerSketchId = record.id;
        entities.set(record.id, entity);
      }
      refreshInspector();
    }
    function refreshInspector() {
      const list = panel.querySelector('[data-objects]');
      list.replaceChildren(new Option('No selection', '-1'));
      records.forEach((record, index) => list.append(new Option(record.feature.properties.qtilerSketch.name || `${record.feature.geometry.type} ${index + 1}`, String(index))));
      list.value = String(selected);
      const host = panel.querySelector('[data-vertices]'); host.replaceChildren(); removeHandles();
      if (!panel.hidden && selected >= 0 && records[selected]) {
        const feature = records[selected].feature;
        writeStyle(feature.properties.qtilerSketch);
        pointsOf(feature).forEach((point, index) => {
          const row = document.createElement('div'); row.className = 'sketch-vertex';
          const longitude = document.createElement('input'); longitude.type = 'number'; longitude.step = '0.000001'; longitude.value = point[0]; longitude.setAttribute('aria-label', `Vertex ${index + 1} longitude`);
          const latitude = document.createElement('input'); latitude.type = 'number'; latitude.step = '0.000001'; latitude.value = point[1]; latitude.setAttribute('aria-label', `Vertex ${index + 1} latitude`);
          const move = document.createElement('button'); move.type = 'button'; move.textContent = String(index + 1); move.title = 'Move vertex on map';
          move.onclick = () => armVertex(index);
          const insert = document.createElement('button'); insert.type = 'button'; insert.innerHTML = '<i class="bx bx-plus"></i>'; insert.title = 'Insert vertex after'; insert.setAttribute('aria-label', 'Insert vertex after'); insert.disabled = feature.geometry.type === 'Point';
          insert.onclick = () => {
            try {
              const points = clone(pointsOf(records[selected].feature)); const next = points[index + 1] || (feature.geometry.type === 'Polygon' ? points[0] : points[index]);
              points.splice(index + 1, 0, point.map((value, axis) => (value + next[axis]) / 2));
              records[selected].feature = normalizeFeature(makeFeature(feature.geometry.type, points, feature.properties.qtilerSketch)); checkpoint(); render().catch((error) => status(error.message, true));
            } catch (error) { status(error.message, true); }
          };
          const remove = document.createElement('button'); remove.type = 'button'; remove.innerHTML = '<i class="bx bx-minus"></i>'; remove.title = 'Remove vertex'; remove.setAttribute('aria-label', 'Remove vertex'); remove.disabled = pointsOf(feature).length <= (feature.geometry.type === 'Polygon' ? 3 : 2);
          remove.onclick = () => {
            try { const points = clone(pointsOf(records[selected].feature)); points.splice(index, 1); records[selected].feature = normalizeFeature(makeFeature(feature.geometry.type, points, feature.properties.qtilerSketch)); checkpoint(); render().catch((error) => status(error.message, true)); }
            catch (error) { status(error.message, true); }
          };
          const change = () => updateVertex(index, [Number(longitude.value), Number(latitude.value), point[2]]);
          longitude.onchange = () => { try { change(); } catch (error) { status(error.message, true); } };
          latitude.onchange = longitude.onchange;
          row.append(move, longitude, latitude, insert, remove); host.append(row);
          const style = feature.properties.qtilerSketch;
          const heightReference = style.mode === 'ground' ? Cesium.HeightReference.CLAMP_TO_GROUND : style.mode === 'relative' ? Cesium.HeightReference.RELATIVE_TO_GROUND : Cesium.HeightReference.NONE;
          const handle = viewer.entities.add({ position: Cesium.Cartesian3.fromDegrees(point[0], point[1], style.mode === 'ground' ? 0 : style.height), point: { pixelSize: 7, color: Cesium.Color.YELLOW, heightReference, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
          handle._qtilerSketchId = records[selected].id; handle._qtilerVertexIndex = index; handles.push(handle);
        });
      }
      panel.querySelector('[data-command="undo"]').disabled = !history.canUndo;
      panel.querySelector('[data-command="redo"]').disabled = !history.canRedo;
      panel.querySelector('[data-command="delete"]').disabled = selected < 0;
    }
    function positionAt(screen) {
      let point = options.pickGlobePosition(screen);
      if (!point) return null;
      if (panel.querySelector('[data-snap]').checked) {
        let closest = 12;
        for (const record of records) for (const coordinate of pointsOf(record.feature)) {
          const cartesian = Cesium.Cartesian3.fromDegrees(coordinate[0], coordinate[1], viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(coordinate[0], coordinate[1])) || 0);
          const pixel = viewer.scene.cartesianToCanvasCoordinates(cartesian);
          if (pixel) { const distance = Math.hypot(pixel.x - screen.x, pixel.y - screen.y); if (distance < closest) { closest = distance; point = cartesian; } }
        }
      }
      const coordinate = Cesium.Cartographic.fromCartesian(point);
      return [Cesium.Math.toDegrees(coordinate.longitude), Cesium.Math.toDegrees(coordinate.latitude), coordinate.height];
    }
    function makeFeature(type, points, style) {
      return { type: 'Feature', geometry: { type, coordinates: type === 'Point' ? points[0] : type === 'Polygon' ? [[...points, points[0]]] : points }, properties: { qtilerSketch: clone(style) } };
    }
    async function drawPreview(points) {
      if (points.length < (kind === 'polygon' ? 3 : 2)) return;
      const revision = ++previewGeneration;
      const options = await graphics(makeFeature(kind === 'polygon' ? 'Polygon' : 'LineString', points, activeStyle), true);
      if (!kind || revision !== previewGeneration) return;
      if (preview) viewer.entities.remove(preview);
      preview = viewer.entities.add(options);
    }
    function finish() {
      if (!kind || kind === 'select' || vertexIndex >= 0) return;
      const type = kind === 'polygon' ? 'Polygon' : ['point', 'text', 'model'].includes(kind) ? 'Point' : 'LineString';
      const style = { ...activeStyle, text: kind === 'text' ? activeStyle.text : '', modelAssetId: kind === 'model' ? activeStyle.modelAssetId : '' };
      const feature = normalizeFeature(makeFeature(type, vertices, style));
      records.push({ id: nextId++, feature }); selected = records.length - 1;
      cancel(); checkpoint(); render().catch((error) => status(error.message, true)); status('Drawing added');
    }
    function arm(tool) {
      options.clearActiveTool(); cancel(); activeStyle = readStyle(); selected = -1; removeHandles(); kind = tool;
      options.suspendInfo?.(true);
      if (tool === 'text' && !activeStyle.text.trim()) throw new Error('Enter text before placing a label');
      if (tool === 'model' && !models.has(activeStyle.modelAssetId)) throw new Error('Select a model from the asset library');
      panel.querySelectorAll('[data-tool]').forEach((button) => button.classList.toggle('active', button.dataset.tool === tool));
      if (options.use2d?.()) {
        if (tool === 'select') { options.draw2d(tool, activeStyle, () => {}); return; }
        const style = { ...activeStyle, text: tool === 'text' ? activeStyle.text : '', modelAssetId: tool === 'model' ? activeStyle.modelAssetId : '' };
        options.draw2d(tool, style, (feature) => {
          const normalized = normalizeFeature(feature);
          records.push({ id: nextId++, feature: normalized }); selected = records.length - 1;
          cancel(); checkpoint(); render().catch((error) => status(error.message, true)); status('Drawing added');
        }, panel.querySelector('[data-snap]').checked);
        return;
      }
      handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
      drawingDoubleClick = viewer.screenSpaceEventHandler.getInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      status(tool === 'select' ? 'Select a drawing' : tool === 'freehand' ? 'Drag to draw' : 'Select drawing vertices');
      const click = (event) => {
        try {
          if (tool === 'select') { const entity = viewer.scene.pick(event.position)?.id; selected = records.findIndex((record) => record.id === entity?._qtilerSketchId); refreshInspector(); if (Number.isInteger(entity?._qtilerVertexIndex) && selected >= 0) armVertex(entity._qtilerVertexIndex); return; }
          const point = positionAt(event.position); if (!point) return;
          vertices.push(point); if (['point', 'text', 'model'].includes(tool)) finish();
        } catch (error) { status(error.message, true); }
      };
      if (tool === 'freehand') {
        handler.setInputAction((event) => { const point = positionAt(event.position); if (!point) return; vertices = [point]; rotationBefore = viewer.scene.screenSpaceCameraController.enableRotate; viewer.scene.screenSpaceCameraController.enableRotate = false; }, Cesium.ScreenSpaceEventType.LEFT_DOWN);
        handler.setInputAction(() => { try { finish(); } catch (error) { cancel(); status(error.message, true); } }, Cesium.ScreenSpaceEventType.LEFT_UP);
      } else handler.setInputAction(click, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      let lastPixel = null;
      handler.setInputAction((event) => {
        if (!vertices.length || tool === 'select') return;
        const point = positionAt(event.endPosition); if (!point) return;
        if (tool === 'freehand') { if (rotationBefore === null || vertices.length >= 2000) return; if (lastPixel && Math.hypot(lastPixel.x - event.endPosition.x, lastPixel.y - event.endPosition.y) < 5) return; vertices.push(point); lastPixel = event.endPosition; }
        drawPreview(tool === 'freehand' ? vertices : [...vertices, point]).catch((error) => status(error.message, true));
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      handler.setInputAction(() => { try { if (vertices.length) finish(); else cancel(); } catch (error) { status(error.message, true); } }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    }
    function updateVertex(index, point) {
      if (!records[selected]) return;
      const feature = clone(records[selected].feature); const points = pointsOf(feature); points[index] = point;
      records[selected].feature = normalizeFeature(makeFeature(feature.geometry.type, points, feature.properties.qtilerSketch));
      checkpoint(); render().catch((error) => status(error.message, true)); status('Vertex updated');
    }
    function armVertex(index) {
      cancel(); vertexIndex = index;
      if (options.use2d?.()) { options.pick2d((coordinate) => { try { updateVertex(index, [...coordinate, 0]); cancel(); } catch (error) { status(error.message, true); } }); status(`Place vertex ${index + 1} in 2D`); return; }
      handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas); status(`Place vertex ${index + 1}`);
      handler.setInputAction((event) => { try { const point = positionAt(event.position); if (!point) return; updateVertex(index, point); cancel(); } catch (error) { status(error.message, true); } }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      handler.setInputAction(cancel, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    }
    function importFeatures(collection, replace = false) {
      const imported = normalizeCollection(collection);
      cancel(); if (replace) records = [];
      records.push(...imported.map((feature) => ({ id: nextId++, feature }))); selected = records.length - 1;
      checkpoint(); render().catch((error) => status(error.message, true)); status('Drawing loaded');
    }
    panel.querySelector('[data-objects]').onchange = (event) => { cancel(); selected = Number(event.target.value); refreshInspector(); };
    panel.querySelector('[data-import]').onchange = async (event) => {
      try {
        const file = event.target.files[0]; if (!file) return;
        if (file.size > 10 * 1024 * 1024) throw new Error('Drawing file exceeds 10 MB');
        importFeatures(JSON.parse(await file.text()));
      } catch (error) { status(error.message, true); }
      finally { event.target.value = ''; }
    };
    panel.querySelectorAll('[data-property]').forEach((input) => { input.onchange = () => { try { activeStyle = readStyle(); panel.querySelector('[data-property="height"]').disabled = activeStyle.mode === 'ground'; if (kind && vertices.length) drawPreview(vertices).catch((error) => status(error.message, true)); } catch (error) { status(error.message, true); } }; });
    panel.querySelectorAll('[data-tool]').forEach((button) => { button.onclick = () => { try { arm(button.dataset.tool); } catch (error) { cancel(); status(error.message, true); } }; });
    panel.querySelectorAll('[data-command]').forEach((button) => { button.onclick = async () => {
      try {
        const command = button.dataset.command;
        if (command === 'close') { cancel(); panel.hidden = true; removeHandles(); }
        if (command === 'cancel') { cancel(); status('Cancelled'); }
        if (command === 'finish') { if (options.use2d?.()) options.finish2d?.(); else finish(); }
        if (command === 'apply') { activeStyle = readStyle(); if (records[selected]) { records[selected].feature.properties.qtilerSketch = clone(activeStyle); checkpoint(); await render(); } status('Style applied'); }
        if (command === 'delete' && selected >= 0) { cancel(); records.splice(selected, 1); selected = -1; checkpoint(); await render(); }
        if (command === 'modify2d') { cancel(); options.modify2d((collection) => {
          const validated = normalizeCollection(collection);
          records = validated.map((feature) => ({ id: nextId++, feature })); selected = -1; checkpoint(); render().catch((error) => status(error.message, true));
        }, panel.querySelector('[data-snap]').checked); status('Modify vertices in the 2D map'); }
        if (command === 'clear' && confirm('Clear all sketch objects?')) { cancel(); records = []; selected = -1; checkpoint(); await render(); }
        if (command === 'undo' || command === 'redo') { cancel(); const snapshot = history.move(command === 'undo' ? -1 : 1); if (!snapshot) return; records = snapshot.map((feature) => ({ id: nextId++, feature })); selected = -1; await render(); }
        if (command === 'save' || command === 'load') { const name = panel.querySelector('[data-library-name]').value.trim(); if (!name) throw new Error('Enter a drawing name'); button.disabled = true; if (command === 'save') { await options.save(name); status('Drawing saved'); } else await options.load(name); }
        if (command === 'export') { const url = URL.createObjectURL(new Blob([JSON.stringify({ type: 'FeatureCollection', features: features() }, null, 2)], { type: 'application/geo+json' })); const link = document.createElement('a'); link.href = url; link.download = 'sketch.geojson'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
      } catch (error) { status(error.message, true); }
      finally { button.disabled = false; refreshInspector(); }
    }; });
    document.addEventListener('keydown', (event) => {
      if (panel.hidden || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
      if (event.key === 'Escape') { event.preventDefault(); cancel(); status('Cancelled'); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); panel.querySelector(`[data-command="${event.shiftKey ? 'redo' : 'undo'}"]`).click(); }
      if (event.key === 'Enter') { event.preventDefault(); panel.querySelector('[data-command="finish"]').click(); }
      if (event.key === 'Delete' && selected >= 0) { event.preventDefault(); panel.querySelector('[data-command="delete"]').click(); }
    });
    async function loadModels() {
      try {
        const library = await options.models(); library.forEach((item) => models.set(item.id, item));
        const select = panel.querySelector('[data-property="modelAssetId"]'); const previous = records[selected]?.feature.properties.qtilerSketch.modelAssetId || activeStyle.modelAssetId || select.value;
        select.replaceChildren(new Option('Select GLTF / GLB', ''));
        library.forEach((asset) => select.append(new Option(asset.name, asset.id))); select.value = previous;
      } catch (error) { status(`Model library: ${error.message}`, true); }
    }
    return { open() { panel.hidden = false; writeStyle(activeStyle); refreshInspector(); loadModels(); }, close() { cancel(); panel.hidden = true; removeHandles(); }, select(index) { selected = index; refreshInspector(); }, cancel, features, importFeatures, saveDrawing: options.save, loadDrawing: options.load, clear() { cancel(); records = []; selected = -1; checkpoint(); render().catch((error) => status(error.message, true)); }, refreshTerrain() { return render(); } };
  }
  window.QtilerSketchEditor = { create, normalizeStyle, normalizeFeature, normalizeCollection, createHistory };
})();