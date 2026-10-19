import { normalizeSimulation, distanceTable, segmentAtDistance, createRoutePlayback } from './simulation-core.js';

export function createRouteSimulation(options) {
  const viewer = options.viewer;
  const Cesium = window.Cesium;
  let points = [];
  let focus = null;
  let savedId = '';
  let handler = null;
  let preview = null;
  let marker = null;
  const routeMarkers = [];
  let frame = null;
  let lastTime = null;
  let playback = null;
  let prepared = null;
  let generation = 0;
  let originalView = null;
  let originalInputs = null;
  let originalDoubleClick = null;
  let draftOriginal = null;
  let draftSavedId = '';
  const panel = document.createElement('aside');
  panel.className = 'simulation-panel'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Camera route simulation');
  panel.innerHTML = `
    <header><strong>Camera simulation</strong><button type="button" data-action="close" title="Close" aria-label="Close"><i class="bx bx-x"></i></button></header>
    <nav class="simulation-actions" aria-label="Route tools">
      <button type="button" data-action="orbit">Orbit</button><button type="button" data-action="draw">Draw route</button><button type="button" data-action="finish">Finish</button><button type="button" data-action="cancel">Cancel</button>
    </nav>
    <label>Sketch route<select data-sketch><option value="">Select a polyline</option></select></label>
    <label>Saved route<select data-saved><option value="">Select a route</option></select></label>
    <label>Name<input data-field="name" maxlength="100" value="Camera route"></label>
    <div class="simulation-fields">
      <label>Speed (m/s)<input data-field="speed" type="number" min="0.1" max="250" step="0.1" value="5"></label>
      <label>Height (m)<input data-field="height" type="number" min="1" max="100000" value="15"></label>
      <label>Height mode<select data-field="heightMode"><option value="relative">Above terrain</option><option value="absolute">Absolute altitude</option></select></label>
      <label>Camera direction<select data-field="direction"><option value="route">Follow route</option><option value="focus">Look at focus</option></select></label>
      <label>Pitch (degrees)<input data-field="pitch" type="number" min="-85" max="45" value="-10"></label>
      <button type="button" data-action="focus">Select focus</button>
    </div>
    <label class="simulation-check"><input data-field="loop" type="checkbox">Repeat route</label>
    <label class="simulation-check"><input data-restore type="checkbox" checked>Restore camera on stop</label>
    <div class="simulation-actions">
      <button type="button" data-action="play" title="Play" aria-label="Play"><i class="bx bx-play"></i></button>
      <button type="button" data-action="pause" title="Pause" aria-label="Pause"><i class="bx bx-pause"></i></button>
      <button type="button" data-action="stop" title="Stop" aria-label="Stop"><i class="bx bx-stop"></i></button>
      <button type="button" data-action="save" title="Save route" aria-label="Save route"><i class="bx bx-save"></i></button>
      <button type="button" data-action="delete" title="Delete saved route" aria-label="Delete saved route"><i class="bx bx-trash"></i></button>
    </div>
    <input data-progress type="range" min="0" max="1" step="0.001" value="0" aria-label="Route progress">
    <output data-status role="status" aria-live="polite">Select or draw a route</output>`;
  document.body.append(panel);
  const status = (message, error = false) => { const output = panel.querySelector('[data-status]'); output.textContent = message; output.dataset.error = String(error); };
  const field = (key) => panel.querySelector(`[data-field="${key}"]`);
  function configuration(overrides = {}) {
    const config = { id: savedId, points, focus };
    for (const key of ['name', 'speed', 'height', 'heightMode', 'direction', 'pitch']) config[key] = field(key).value;
    config.loop = field('loop').checked;
    return normalizeSimulation({ ...config, ...overrides });
  }
  function cancelSelection(revert = true) {
    if (handler) { handler.destroy(); handler = null; }
    if (originalDoubleClick) viewer.screenSpaceEventHandler.setInputAction(originalDoubleClick, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    originalDoubleClick = null;
    if (draftOriginal && revert) { points = draftOriginal; savedId = draftSavedId; }
    draftOriginal = null;
    options.suspendInfo?.(false);
    showPath();
  }
  function releaseCamera() {
    if (originalInputs !== null) viewer.scene.screenSpaceCameraController.enableInputs = originalInputs;
    originalInputs = null;
  }
  function pause() {
    generation += 1;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null; lastTime = null; playback?.pause(); releaseCamera();
  }
  function stop(restore = true) {
    generation += 1; pause(); cancelSelection(); playback?.stop();
    panel.querySelector('[data-progress]').value = 0;
    if (restore && originalView && panel.querySelector('[data-restore]').checked) viewer.camera.setView(originalView);
    originalView = null;
  }
  function invalidate() { stop(); playback = null; prepared = null; }
  function showPath() {
    if (preview) viewer.entities.remove(preview);
    if (marker) viewer.entities.remove(marker);
    preview = null; marker = null;
    for (const entity of routeMarkers) viewer.entities.remove(entity);
    routeMarkers.length = 0;
    if (panel.hidden) return;
    preview = points.length >= 2 ? viewer.entities.add({ polyline: { positions: points.map((point) => Cesium.Cartesian3.fromDegrees(point[0], point[1])), clampToGround: true, width: 3, material: Cesium.Color.CYAN } }) : null;
    marker = focus ? viewer.entities.add({ position: Cesium.Cartesian3.fromDegrees(...focus), point: { pixelSize: 10, color: Cesium.Color.YELLOW, disableDepthTestDistance: Number.POSITIVE_INFINITY } }) : null;
    for (const point of points) routeMarkers.push(viewer.entities.add({ position: Cesium.Cartesian3.fromDegrees(point[0], point[1]), point: { pixelSize: 6, color: Cesium.Color.CYAN, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND } }));
  }
  function selectOnMap(mode) {
    options.clearActiveTool(); invalidate();
    options.suspendInfo?.(true);
    if (mode === 'route') { draftOriginal = points.slice(); draftSavedId = savedId; points = []; savedId = ''; }
    handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    originalDoubleClick = viewer.screenSpaceEventHandler.getInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    status(mode === 'route' ? 'Select route vertices' : 'Select a focus point');
    handler.setInputAction((event) => {
      try {
        const position = options.pickGlobePosition(event.position); if (!position) return;
        const cartographic = Cesium.Cartographic.fromCartesian(position);
        const coordinate = [Cesium.Math.toDegrees(cartographic.longitude), Cesium.Math.toDegrees(cartographic.latitude), cartographic.height];
        if (mode === 'focus') { focus = coordinate; field('direction').value = 'focus'; updateDirection(); cancelSelection(false); status('Focus selected'); }
        else { if (points.length >= 500) throw new Error('Maximum 500 route vertices'); points.push(coordinate); showPath(); status(`${points.length} vertices`); }
      } catch (error) { status(error.message, true); }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(() => { try { if (mode === 'route') finishRoute(); else cancelSelection(); } catch (error) { status(error.message, true); } }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  }
  function finishRoute() {
    if (!draftOriginal) return;
    const config = configuration({ direction: 'route' });
    points = config.points; cancelSelection(false); prepared = null; playback = null; status('Route ready');
  }
  async function prepare(config, revision) {
    const samples = [];
    for (let index = 1; index < config.points.length; index += 1) {
      const first = Cesium.Cartographic.fromDegrees(...config.points[index - 1]);
      const second = Cesium.Cartographic.fromDegrees(...config.points[index]);
      const geodesic = new Cesium.EllipsoidGeodesic(first, second);
      const steps = Math.max(1, Math.ceil(geodesic.surfaceDistance / 20));
      if (samples.length + steps > 5000) throw new Error('Route exceeds 5000 terrain samples; split it into shorter routes');
      if (!samples.length) samples.push(first);
      for (let step = 1; step <= steps; step += 1) samples.push(geodesic.interpolateUsingFraction(step / steps));
    }
    const provider = viewer.terrainProvider;
    if (provider instanceof Cesium.EllipsoidTerrainProvider) samples.forEach((point) => { point.height = 0; });
    else if (provider.availability) await Cesium.sampleTerrainMostDetailed(provider, samples);
    else await Cesium.sampleTerrain(provider, 12, samples);
    if (revision !== generation) return null;
    const positions = samples.map((point) => {
      if (!Number.isFinite(point.height)) throw new Error('Terrain height is unavailable along the route');
      const height = config.heightMode === 'relative' ? point.height + config.height : config.height;
      if (height < point.height + 0.5) throw new Error('Camera altitude is below the sampled terrain');
      return Cesium.Cartesian3.fromRadians(point.longitude, point.latitude, height);
    });
    return { config, positions, table: distanceTable(positions, Cesium.Cartesian3.distance), provider };
  }
  function applyCamera(distance) {
    const { positions, table, config } = prepared;
    const segment = segmentAtDistance(table, distance);
    const position = Cesium.Cartesian3.lerp(positions[segment.index], positions[segment.index + 1], segment.fraction, new Cesium.Cartesian3());
    const up = viewer.scene.globe.ellipsoid.geodeticSurfaceNormal(position, new Cesium.Cartesian3());
    let direction;
    if (config.direction === 'focus') direction = Cesium.Cartesian3.subtract(Cesium.Cartesian3.fromDegrees(...config.focus), position, new Cesium.Cartesian3());
    else {
      const tangent = Cesium.Cartesian3.subtract(positions[segment.index + 1], positions[segment.index], new Cesium.Cartesian3());
      const vertical = Cesium.Cartesian3.multiplyByScalar(up, Cesium.Cartesian3.dot(tangent, up), new Cesium.Cartesian3());
      const horizontal = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(tangent, vertical, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      const pitch = Cesium.Math.toRadians(config.pitch);
      direction = Cesium.Cartesian3.add(Cesium.Cartesian3.multiplyByScalar(horizontal, Math.cos(pitch), new Cesium.Cartesian3()), Cesium.Cartesian3.multiplyByScalar(up, Math.sin(pitch), new Cesium.Cartesian3()), new Cesium.Cartesian3());
    }
    if (Cesium.Cartesian3.magnitude(direction) < 0.001) throw new Error('Camera route intersects its focus point');
    Cesium.Cartesian3.normalize(direction, direction);
    let right = Cesium.Cartesian3.cross(direction, up, new Cesium.Cartesian3());
    if (Cesium.Cartesian3.magnitude(right) < 0.001) right = Cesium.Cartesian3.clone(viewer.camera.rightWC);
    const cameraUp = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    viewer.camera.setView({ destination: position, orientation: { direction, up: cameraUp } });
    panel.querySelector('[data-progress]').value = playback.progress;
    status(`${Math.round(playback.progress * 100)}% - ${Math.round(table.at(-1) / config.speed)} s`);
  }
  function flightSignature(config) {
    const { id, name, ...flight } = config;
    return JSON.stringify(flight);
  }
  async function play() {
    if (handler) finishRoute();
    if (handler) cancelSelection();
    pause();
    const config = configuration();
    const revision = ++generation;
    if (!prepared || prepared.provider !== viewer.terrainProvider || flightSignature(prepared.config) !== flightSignature(config)) {
      status('Sampling terrain...');
      const next = await prepare(config, revision);
      if (!next || revision !== generation) return;
      prepared = next;
      playback = createRoutePlayback(prepared.table.at(-1), config.speed, config.loop);
    }
    if (!originalView) originalView = { destination: Cesium.Cartesian3.clone(viewer.camera.positionWC), orientation: { heading: viewer.camera.heading, pitch: viewer.camera.pitch, roll: viewer.camera.roll } };
    originalInputs = viewer.scene.screenSpaceCameraController.enableInputs;
    viewer.scene.screenSpaceCameraController.enableInputs = false;
    playback.play(); applyCamera(playback.distance); lastTime = performance.now();
    const step = (now) => {
      if (revision !== generation) return;
      try {
        if (viewer.terrainProvider !== prepared.provider) throw new Error('Terrain changed; restart the route');
        const elapsed = document.hidden ? 0 : Math.max(0, (now - lastTime) / 1000); lastTime = now;
        applyCamera(playback.advance(elapsed));
        if (playback.running) frame = requestAnimationFrame(step);
        else { frame = null; releaseCamera(); status('Route completed'); }
      } catch (error) { pause(); status(error.message, true); }
    };
    frame = requestAnimationFrame(step);
  }
  function refreshLists() {
    const saved = panel.querySelector('[data-saved]'); saved.replaceChildren(new Option('Select a route', ''));
    for (const route of options.savedRoutes()) saved.append(new Option(route.name, route.id));
    const sketches = panel.querySelector('[data-sketch]'); sketches.replaceChildren(new Option('Select a polyline', ''));
    options.sketchFeatures().forEach((feature, index) => { if (feature.geometry?.type === 'LineString') sketches.append(new Option(feature.properties?.qtilerSketch?.name || `Sketch line ${index + 1}`, String(index))); });
    updateDirection();
  }
  function updateDirection() { field('pitch').disabled = field('direction').value === 'focus'; }
  panel.querySelector('[data-sketch]').onchange = (event) => {
    try { if (event.target.value === '') return; invalidate(); points = options.sketchFeatures()[Number(event.target.value)].geometry.coordinates.map((point) => point.slice()); savedId = ''; showPath(); status('Sketch route selected'); }
    catch (error) { status(error.message, true); }
  };
  panel.querySelector('[data-saved]').onchange = (event) => {
    try {
      const route = options.savedRoutes().find((item) => item.id === event.target.value); if (!route) return;
      const config = normalizeSimulation(route); invalidate(); savedId = config.id; points = config.points; focus = config.focus;
      for (const key of ['name', 'speed', 'height', 'heightMode', 'direction', 'pitch']) field(key).value = config[key];
      field('loop').checked = config.loop; updateDirection(); showPath(); status('Route loaded');
    } catch (error) { status(error.message, true); }
  };
  panel.querySelectorAll('[data-field]').forEach((input) => { input.onchange = () => { if (input.dataset.field !== 'name') invalidate(); updateDirection(); status('Route settings changed'); }; });
  panel.querySelector('[data-progress]').oninput = (event) => {
    try { pause(); if (!prepared || !playback) return; playback.seek(Number(event.target.value)); applyCamera(playback.distance); }
    catch (error) { status(error.message, true); }
  };
  panel.querySelectorAll('[data-action]').forEach((button) => { button.onclick = async () => {
    try {
      const action = button.dataset.action;
      if (action === 'play') await play();
      if (action === 'pause') { pause(); status('Paused'); }
      if (action === 'stop') { stop(); status('Stopped'); }
      if (action === 'draw' || action === 'focus') selectOnMap(action === 'draw' ? 'route' : 'focus');
      if (action === 'finish') finishRoute();
      if (action === 'cancel') { pause(); cancelSelection(); status('Cancelled'); }
      if (action === 'close') close();
      if (action === 'orbit') { close(); options.orbit(); }
      if (action === 'save') { button.disabled = true; if (draftOriginal) finishRoute(); const route = configuration(); await options.save(route); savedId = route.id; refreshLists(); panel.querySelector('[data-saved]').value = savedId; status('Route saved'); }
      if (action === 'delete') { if (!savedId) throw new Error('Select a saved route'); if (confirm('Delete this camera route?')) { await options.remove(savedId); savedId = ''; refreshLists(); status('Route deleted'); } }
    } catch (error) { pause(); status(error.message, true); }
    finally { button.disabled = false; }
  }; });
  function close() { stop(); panel.hidden = true; showPath(); }
  const onVisibilityChange = () => { if (document.hidden && playback?.running) { pause(); status('Paused'); } };
  document.addEventListener('visibilitychange', onVisibilityChange);
  return { open() { panel.hidden = false; refreshLists(); showPath(); }, close, cancel() { stop(); }, dispose() { close(); document.removeEventListener('visibilitychange', onVisibilityChange); panel.remove(); } };
}