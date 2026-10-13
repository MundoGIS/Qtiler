import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import express from 'express';
import { register } from '../plugins/Qtiler-3D-eye/index.js';
import { closeAuthDb, persistProjectAccessInDb } from '../lib/authDb.js';
import { normalizeSimulation, createRoutePlayback, distanceTable, segmentAtDistance } from '../plugins/Qtiler-3D-eye/client/simulation-core.js';
import { featureInfoHtml } from '../plugins/Qtiler-3D-eye/client/feature-info.js';
import { bridgeRange, bridgeResolution } from '../plugins/Qtiler-3D-eye/client/dual-map.js';
import { createCollectionStore, persistenceContext, replaceDirectory, atomicJsonWrite, readJob } from '../plugins/Qtiler-3D-eye/persistence.js';
import AdmZip from 'adm-zip';

test('dual-map preserves camera range through 2D scale conversion across viewports and latitudes', () => {
  for (const latitude of [0, 60, -60, 85]) {
    for (const height of [390, 800, 1440]) {
      for (const range of [100, 10000, 1000000]) {
        const resolution = bridgeResolution(range, latitude, height, Math.PI / 3);
        assert.ok(Math.abs(bridgeRange(resolution, latitude, height, Math.PI / 3) - range) < 1e-6);
      }
    }
  }
});

test('dual-map scale conversion remains finite at polar latitudes and empty viewports', () => {
  assert.ok(Number.isFinite(bridgeResolution(10000, 90, 0, Math.PI / 3)));
  assert.ok(Number.isFinite(bridgeRange(10, -90, 0, Math.PI / 3)));
  assert.equal(bridgeRange(0, 0, 800, Math.PI / 3), 10);
  assert.equal(bridgeResolution(0, 0, 800, Math.PI / 3), 0.01);
});

test('3D Eye registers Admin and drawing routes without touching live data', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtiler-eye-test-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = express();
  await register({ app, security: { isEnabled: () => false, requireAdmin: (_req, _res, next) => next() }, dataDir: path.join(root, 'data', 'Qtiler-3D-eye'), baseDir: path.resolve('plugins/Qtiler-3D-eye') });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/plugins/Qtiler-3D-eye`;
  const admin = await fetch(`${base}/admin`, { redirect: 'manual' });
  assert.equal(admin.status, 302);
  assert.equal(admin.headers.get('location'), '/plugins/Qtiler-3D-eye/admin-ui/');
  assert.equal((await fetch(`${base}/admin-ui/`)).status, 200);
  const logo = new FormData(); logo.append('logo', new Blob(['<svg onload="alert(1)"></svg>'], { type: 'image/svg+xml' }), 'logo.svg');
  assert.equal((await fetch(`${base}/admin/api/upload-logo`, { method: 'POST', body: logo })).status, 400);
  const legacy = await fetch(`${base}/admin/api/maps`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ id: 'legacy', mainProjectId: 'fixture' }]) });
  assert.equal(legacy.status, 200);
  assert.equal((await (await fetch(`${base}/admin/api/maps`)).json())[0].id, 'legacy');
  const geojson = { type: 'FeatureCollection', features: [] };
  const saved = await fetch(`${base}/api/save-drawing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'test', geojson }) });
  assert.equal(saved.status, 200);
  assert.deepEqual((await (await fetch(`${base}/api/load-drawings?name=test`)).json()).geojson, geojson);
  assert.equal((await fetch(`${base}/api/delete-drawing?name=test`, { method: 'DELETE' })).status, 200);
  const dataDir = path.join(root, 'data', 'Qtiler-3D-eye');
  await fs.writeFile(path.join(dataDir, 'maps.json'), JSON.stringify([{ id: 'fixture', mainProjectId: 'missing-fixture-project', enableTerrain: false, assetIds: [], mainLayers: [{ name: 'points', service: 'wfs', infoFields: ['name', 'photo'], fillOpacity: null, strokeOpacity: null, iconScale: null, heightMode: 'relative', heightOffset: -3, lineStyle: 'tube', tubeRadius: 0.25, showUnderground: true, extrusionHeight: 0, styleRules: [{ fillOpacity: null, heightMode: 'absolute', tubeRadius: 0.1, extrusionHeight: 0 }] }] }]));
  await fs.writeFile(path.join(dataDir, 'assets.json'), JSON.stringify([{ id: 'unselected', type: 'model', url: '/unselected.glb' }]));
  const config = await (await fetch(`${base}/api/view-config/fixture`)).json();
  assert.deepEqual(config.config.assets, []);
  const layer = config.config.layers.find((item) => item.layerName === 'points');
  assert.equal(layer.fillOpacity, null);
  assert.equal(layer.strokeOpacity, null);
  assert.equal(layer.iconScale, null);
  assert.equal(layer.styleRules[0].fillOpacity, null);
  assert.equal(layer.styleRules[0].symbolType, null);
  assert.deepEqual(layer.infoFields, ['name', 'photo']);
  assert.equal(layer.heightMode, 'relative');
  assert.equal(layer.heightOffset, -3);
  assert.equal(layer.lineStyle, 'tube');
  assert.equal(layer.tubeRadius, 0.25);
  assert.equal(layer.showUnderground, true);
  assert.equal(layer.extrusionHeight, 0);
  assert.equal(layer.styleRules[0].heightMode, 'absolute');
  assert.equal(layer.styleRules[0].tubeRadius, 0.1);
  assert.equal(layer.styleRules[0].extrusionHeight, 0);
  const view = { position: [100, 200, 300], orientation: { heading: 0.2, pitch: -0.8, roll: 0 } };
  const camera = await fetch(`${base}/api/scenes/fixture/views`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Entry', view, initial: true }) });
  assert.equal(camera.status, 200);
  const stored = await (await fetch(`${base}/api/view-config/fixture`)).json();
  assert.deepEqual(stored.scene.initialView, view);
  assert.equal(stored.scene.savedViews[0].name, 'Entry');
  const storedMaps = JSON.parse(await fs.readFile(path.join(dataDir, 'maps.json'), 'utf8'));
  storedMaps.find(scene => scene.id === 'fixture').thumbnail = { url: '/plugins/Qtiler-3D-eye/api/scenes/fixture/thumbnail', updatedAt: '2026-10-12T12:00:00Z', source: 'capture' };
  await fs.writeFile(path.join(dataDir, 'maps.json'), JSON.stringify(storedMaps));
  const thumbnailConfig = await (await fetch(`${base}/api/view-config/fixture`)).json();
  assert.equal(thumbnailConfig.scene.thumbnail.source, 'capture');
  assert.equal(thumbnailConfig.scene.thumbnail.url, '/plugins/Qtiler-3D-eye/api/scenes/fixture/thumbnail');
  const sharp = (await import('sharp')).default;
  const image = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#448866' } }).png().toBuffer();
  const uploadThumbnail = new FormData();
  uploadThumbnail.append('image', new Blob([image], { type: 'image/png' }), 'map.png');
  uploadThumbnail.append('source', 'capture');
  const uploadedThumbnail = await fetch(`${base}/api/scenes/fixture/thumbnail`, { method: 'POST', body: uploadThumbnail });
  const uploadedThumbnailPayload = await uploadedThumbnail.json();
  assert.equal(uploadedThumbnail.status, 201, JSON.stringify(uploadedThumbnailPayload));
  const servedThumbnail = await fetch(`${base}/api/scenes/fixture/thumbnail`);
  assert.equal(servedThumbnail.status, 200);
  assert.match(servedThumbnail.headers.get('content-type'), /image\/webp/);
  const thumbnailMetadata = await sharp(Buffer.from(await servedThumbnail.arrayBuffer())).metadata();
  assert.equal(thumbnailMetadata.width, 960);
  assert.equal(thumbnailMetadata.height, 540);
  const invalidThumbnail = new FormData();
  invalidThumbnail.append('image', new Blob(['<svg onload="alert(1)"></svg>'], { type: 'image/svg+xml' }), 'bad.svg');
  assert.equal((await fetch(`${base}/api/scenes/fixture/thumbnail`, { method: 'POST', body: invalidThumbnail })).status, 400);
  const regeneration = await fetch(`${base}/api/scenes/fixture/thumbnail/regenerate`, { method: 'POST' });
  assert.equal(regeneration.status, 200);
  assert.equal((await regeneration.json()).thumbnail.source, 'placeholder');
  const invalid = await fetch(`${base}/api/scenes/fixture/views`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ view: { position: [1, 2] } }) });
  assert.equal(invalid.status, 400);
  const job = { id: 'another-worker', status: 'completed', progress: 100 };
  await fs.writeFile(path.join(dataDir, 'tile-jobs', 'another-worker.json'), JSON.stringify(job));
  assert.deepEqual(await (await fetch(`${base}/api/qgis3d-tiles/job/another-worker`)).json(), job);
  await fs.writeFile(path.join(dataDir, 'terrain-jobs', 'another-worker.json'), JSON.stringify(job));
  assert.deepEqual(await (await fetch(`${base}/api/terrain-job/another-worker`)).json(), job);
  await fs.mkdir(path.join(root, 'cache', 'fixture'), { recursive: true });
  await fs.writeFile(path.join(root, 'cache', 'fixture', 'index.json'), JSON.stringify({ layers: [{ name: 'points', type: 'vector', geometry_type: 'Unknown' }] }));
  const rejected = await fetch(`${base}/api/qgis3d-tiles/build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'fixture', layerName: 'points' }) });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, 'vector_geometry_required');
  const route = { name: 'Inspection', points: [[10, 60], [10.01, 60]], height: 12, speed: 4, direction: 'focus', focus: [10, 60.01, 50] };
  const savedRouteResponse = await fetch(`${base}/api/scenes/fixture/simulations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(route) });
  assert.equal(savedRouteResponse.status, 200);
  const savedRoute = await savedRouteResponse.json();
  assert.ok(savedRoute.simulation.id);
  assert.equal(savedRoute.simulations.length, 1);
  const sceneWithRoute = await (await fetch(`${base}/api/view-config/fixture`)).json();
  assert.equal(sceneWithRoute.scene.simulations[0].speed, 4);
  const invalidRoute = await fetch(`${base}/api/scenes/fixture/simulations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...route, speed: 0 }) });
  assert.equal(invalidRoute.status, 400);
  const updatedRoute = await fetch(`${base}/api/scenes/fixture/simulations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...savedRoute.simulation, speed: 7 }) });
  assert.equal((await updatedRoute.json()).simulations.length, 1);
  const deleteRoute = await fetch(`${base}/api/scenes/fixture/simulations/${savedRoute.simulation.id}`, { method: 'DELETE' });
  assert.equal(deleteRoute.status, 200);
  assert.deepEqual((await deleteRoute.json()).simulations, []);
  for (const [type, name, content] of [['model', 'test.gltf', JSON.stringify({ asset: { version: '2.0' }, scenes: [], nodes: [] })], ['czml', 'test.czml', JSON.stringify([{ id: 'document', version: '1.0' }])]]) {
    const form = new FormData(); form.append('assetType', type); form.append('files', new Blob([content]), name);
    const response = await fetch(`${base}/api/assets/upload`, { method: 'POST', body: form });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.uploaded[0].type, type);
    const id = result.uploaded[0].id;
    const renamed = await fetch(`${base}/api/assets/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Renamed asset' }) });
    assert.equal(renamed.status, 200);
    assert.equal((await renamed.json()).asset.name, 'Renamed asset');
    if (type === 'model') {
      const modelDrawing = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [10, 60, 0] }, properties: { qtilerSketch: { modelAssetId: id, mode: 'relative', height: 3, modelScale: 2, heading: 45 } } }] };
      const saved = await fetch(`${base}/api/save-drawing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'placed-model', geojson: modelDrawing }) });
      assert.equal(saved.status, 200);
      assert.deepEqual((await (await fetch(`${base}/api/load-drawings?name=placed-model`)).json()).geojson, modelDrawing);
    }
  }
});

test('route playback advances in metres per second independent of frame rate and resumes from pause', () => {
  const slowFrames = createRoutePlayback(1000, 5);
  const fastFrames = createRoutePlayback(1000, 5);
  slowFrames.play(); fastFrames.play();
  for (let index = 0; index < 30; index += 1) slowFrames.advance(1 / 30);
  for (let index = 0; index < 144; index += 1) fastFrames.advance(1 / 144);
  assert.ok(Math.abs(slowFrames.distance - fastFrames.distance) < 1e-8);
  slowFrames.pause(); const distance = slowFrames.distance;
  slowFrames.advance(10); assert.equal(slowFrames.distance, distance);
  slowFrames.play(); slowFrames.advance(1);
  assert.ok(Math.abs(slowFrames.distance - 10) < 1e-8);
  slowFrames.seek(0.5); assert.equal(slowFrames.distance, 500);
  slowFrames.advance(1000); assert.equal(slowFrames.distance, 1000); assert.equal(slowFrames.running, false);
  slowFrames.stop(); assert.equal(slowFrames.distance, 0);
  const loop = createRoutePlayback(100, 10, true); loop.play(); loop.advance(12);
  assert.equal(loop.distance, 20); assert.equal(loop.running, true);
});

test('route validation rejects invalid coordinates/focus and handles duplicate vertices and unequal segments', () => {
  const route = normalizeSimulation({ points: [[10, 60], [10, 60], [11, 60]], height: 1 });
  assert.equal(route.points.length, 2);
  assert.equal(route.height, 1);
  assert.throws(() => normalizeSimulation({ points: [[10, 60], [11, 60]], direction: 'focus' }), /focus/);
  assert.throws(() => normalizeSimulation({ points: [[181, 60], [11, 60]] }), /parameter/);
  assert.throws(() => normalizeSimulation({ points: [[10, 60], [10, 60]] }), /distinct/);
  const table = distanceTable([0, 10, 40], (first, second) => second - first);
  assert.deepEqual(segmentAtDistance(table, 25), { index: 1, fraction: 0.5 });
  assert.deepEqual(segmentAtDistance(table, 40), { index: 1, fraction: 1 });
});

test('viewer uses compact navigation and time controls instead of the title card and native timeline', async () => {
  const html = await fs.readFile('plugins/Qtiler-3D-eye/client/index.html', 'utf8');
  const source = await fs.readFile('plugins/Qtiler-3D-eye/client/planner-viewer.js', 'utf8');
  const css = await fs.readFile('plugins/Qtiler-3D-eye/client/viewer.css', 'utf8');
  for (const id of ['northButton', 'zoomInButton', 'zoomOutButton', 'tiltUpButton', 'tiltDownButton', 'sceneTime', 'clockPlay', 'clockSpeed', 'clockNow']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(source.includes('timeline: false'));
  assert.ok(source.includes('animation: false'));
  assert.ok(css.includes('.top-panel h1, #viewerSubtitle { display: none !important; }'));
});

test('WFS adapter respects published CRS and returns Cesium longitude/latitude GeoJSON', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtiler-eye-wfs-test-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = express();
  await register({ app, security: { isEnabled: () => false, requireAdmin: (_req, _res, next) => next() }, dataDir: path.join(root, 'data', 'Qtiler-3D-eye'), baseDir: path.resolve('plugins/Qtiler-3D-eye') });
  await fs.mkdir(path.join(root, 'cache', 'fixture'), { recursive: true });
  await fs.writeFile(path.join(root, 'cache', 'fixture', 'project-config.json'), JSON.stringify({ services: { publishedCrs: ['EPSG:3857'] } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let request;
  globalThis.fetch = async (url, options) => {
    const target = new URL(url);
    if (target.pathname === '/wfs') {
      request = target;
      return Response.json({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'EPSG:3857' } }, features: [
        { type: 'Feature', id: 'test.1', properties: { name: 'Feature' }, geometry: { type: 'Point', coordinates: [1113194.9079327357, 0, 12] } },
        { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: [[[1113194.9079327357, 0, -8], [1113194.9079327357, 0, 0]]] } },
        { type: 'Feature', properties: {}, geometry: { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [1113194.9079327357, 0, -2] }] } }
      ] });
    }
    return originalFetch(url, options);
  };
  const response = await originalFetch(`http://127.0.0.1:${server.address().port}/plugins/Qtiler-3D-eye/api/wfs/fixture/test?BBOX=9,-1,11,1&MAXFEATURES=100`);
  assert.equal(response.status, 200);
  assert.equal(request.searchParams.get('SRSNAME'), 'EPSG:3857');
  assert.ok(Number(request.searchParams.get('BBOX').split(',')[0]) > 900000);
  const result = await response.json();
  assert.ok(Math.abs(result.features[0].geometry.coordinates[0] - 10) < 0.000001);
  assert.equal(result.features[0].geometry.coordinates[2], 12);
  assert.equal(result.features[1].geometry.coordinates[0][0][2], -8);
  assert.equal(result.features[1].geometry.coordinates[0][1][2], 0);
  assert.equal(result.features[2].geometry.geometries[0].coordinates[2], -2);
  assert.equal(result.crs, undefined);
});

test('surface triangulation supports vertical faces, Z-distinct vertices, holes and multipart polygons', async () => {
  const { projectSurfaceRings, cleanSurfaceRing, polygonParts } = await import('../plugins/Qtiler-3D-eye/client/geometry-mesh.js');
  const { default: earcut } = await import('earcut');
  const face = [[{ x: 0, y: 0, z: 0 }, { x: 0, y: 4, z: 0 }, { x: 0, y: 4, z: 5 }, { x: 0, y: 0, z: 5 }]];
  const projection = projectSurfaceRings(face);
  assert.equal(earcut(projection.vertices, projection.holes, 2).length, 6);
  assert.equal(cleanSurfaceRing([[10, 60, 0], [10, 60, 5], [11, 60, 5], [10, 60, 0]]).length, 3);
  const withHole = projectSurfaceRings([
    [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }, { x: 0, y: 10, z: 0 }],
    [{ x: 2, y: 2, z: 0 }, { x: 2, y: 8, z: 0 }, { x: 8, y: 8, z: 0 }, { x: 8, y: 2, z: 0 }]
  ]);
  assert.equal(withHole.holes[0], 4);
  assert.equal(earcut(withHole.vertices, withHole.holes, 2).length, 24);
  assert.equal(polygonParts({ type: 'GeometryCollection', geometries: [{ type: 'MultiPolygon', coordinates: [[], []] }] }).length, 2);
});

test('viewer geometry height modes preserve Z, terrain offsets, nested holes and tube radii', async () => {
  const source = await fs.readFile('plugins/Qtiler-3D-eye/client/planner-viewer.js', 'utf8');
  const scope = {
    viewer: { scene: { globe: { getHeight: () => 100 } } },
    Cesium: {
      Cartesian2: class { constructor(x, y) { this.x = x; this.y = y; } },
      Cartesian3: { fromRadians: (longitude, latitude, height) => ({ x: longitude, y: latitude, z: height }) },
      Cartographic: { fromCartesian: position => ({ longitude: position.x, latitude: position.y, height: position.z }) },
      PolygonHierarchy: class { constructor(positions, holes) { this.positions = positions; this.holes = holes; } }
    }
  };
  vm.runInNewContext(source.slice(source.indexOf('function geometryHasZ('), source.indexOf('async function prepareWfsGeometryHeights(')), scope);
  assert.equal(scope.geometryHasZ({ type: 'Point', coordinates: [10, 60, 0] }), true);
  assert.equal(scope.geometryHasZ({ type: 'MultiLineString', coordinates: [[[10, 60, -4], [11, 60, 3]]] }), true);
  assert.equal(scope.geometryHasZ({ type: 'Point', coordinates: [10, 60] }), false);
  assert.equal(scope.entityHeightMode({ _qtilerGeometryHasZ: true }, { heightMode: 'auto' }), 'absolute');
  const position = { x: 10, y: 60, z: -8 };
  assert.equal(scope.shiftedGeometryPosition({}, position, 'absolute', 0).z, -8);
  assert.equal(scope.shiftedGeometryPosition({}, position, 'relative', 0).z, 92);
  assert.equal(scope.shiftedGeometryPosition({}, position, 'ground', -3).z, 97);
  const shape = scope.tubeShape(2);
  assert.equal(shape.length, 16);
  assert.ok(Math.abs(Math.hypot(shape[3].x, shape[3].y) - 2) < 1e-9);
  const shifted = scope.shiftedPolygonHierarchy({}, { positions: [position], holes: [{ positions: [position], holes: [] }] }, 'relative', 1);
  assert.equal(shifted.positions[0].z, 93);
  assert.equal(shifted.holes[0].positions[0].z, 93);
});

test('viewer preserves default opacity, explicit zero and inherited rule properties', async () => {
  const source = await fs.readFile('plugins/Qtiler-3D-eye/client/planner-viewer.js', 'utf8');
  const context = vm.createContext({ Cesium: { Color: { fromCssColorString: (color) => ({ withAlpha: (alpha) => ({ color, alpha }) }) } } });
  vm.runInContext(source.slice(source.indexOf('function styleNumber('), source.indexOf('function currentApproxZoom(')), context);
  vm.runInContext(source.slice(source.indexOf('function effectiveStyleForEntity('), source.indexOf('function setEntityTerrainOffset(')), context);
  context.ruleMatches = () => true;
  assert.equal(context.defaultVectorStyle({ fillOpacity: null }).fill.alpha, 0.55);
  assert.equal(context.defaultVectorStyle({ fillOpacity: 0 }).fill.alpha, 0);
  assert.equal(context.defaultVectorStyle({ extrusionHeight: null }).clampToGround, true);
  const result = context.effectiveStyleForEntity({}, { color: '#ff0000', fillOpacity: 0.7, styleRules: [{ color: null, fillOpacity: null, strokeWidth: 0 }] }, 10);
  assert.equal(result.color, '#ff0000');
  assert.equal(result.fillOpacity, 0.7);
  assert.equal(result.strokeWidth, 0);
});

test('Admin and project metadata reject unauthorized requests when Auth is enabled', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtiler-eye-acl-test-'));
  context.after(async () => { closeAuthDb(); await fs.rm(root, { recursive: true, force: true }); });
  const app = express();
  app.use((req, _res, next) => { if (req.headers['x-test-project']) req.user = { id: 'viewer', role: 'authenticated', projects: [req.headers['x-test-project']] }; next(); });
  await register({ app, security: { isEnabled: () => true, requireAdmin: (_req, res) => res.status(401).json({ error: 'auth_required' }) }, dataDir: path.join(root, 'data', 'Qtiler-3D-eye'), baseDir: path.resolve('plugins/Qtiler-3D-eye') });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/plugins/Qtiler-3D-eye`;
  for (const route of ['/admin', '/admin-ui/']) assert.equal((await fetch(base + route)).status, 401, route);
  for (const route of ['/api/project-info?project=private', '/api/heightmap-info/private', '/heightmap/private/0/0/0.bin']) assert.equal((await fetch(base + route)).status, 403, route);
  const data = path.join(root, 'data', 'Qtiler-3D-eye');
  await fs.writeFile(path.join(data, 'maps.json'), JSON.stringify([{ id: 'private', mainProjectId: 'private', assetIds: ['private-model'] }]));
  await fs.writeFile(path.join(data, 'assets.json'), JSON.stringify([{ id: 'private-model', type: 'model', fileName: 'private.glb', url: '/plugins/Qtiler-3D-eye/assets/models/private.glb' }]));
  await fs.writeFile(path.join(data, 'assets', 'models', 'private.glb'), 'fixture model');
  for (const route of ['/assets/models/private.glb', '/api/assets/private-model/model', '/assets/_incoming/test.zip', '/terrain/private/layer.json']) assert.ok([403, 404].includes((await fetch(base + route)).status), route);
  assert.equal((await fetch(`${base}/api/scenes/private/thumbnail`)).status, 403);
  assert.equal((await fetch(`${base}/api/scenes/private/thumbnail/regenerate`, { method: 'POST' })).status, 401);
  for (const route of ['/assets/models/private.glb', '/api/assets/private-model/model']) {
    const allowed = await fetch(base + route, { headers: { 'x-test-project': 'private' } });
    assert.equal(allowed.status, 200, route);
    assert.match(allowed.headers.get('cache-control'), /private.*no-store/);
  }
  persistProjectAccessInDb(path.join(root, 'data'), { projects: { private: { public: true } } });
  assert.equal((await fetch(`${base}/assets/models/private.glb`)).status, 200);
  persistProjectAccessInDb(path.join(root, 'data'), { projects: { private: { public: false } } });
  assert.equal((await fetch(`${base}/assets/models/private.glb`)).status, 403);
});

test('scene thumbnails generate independently of Origo and are removed with their map', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtiler-eye-thumbnail-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data', 'Qtiler-3D-eye');
  const app = express();
  await register({ app, security: { isEnabled: () => false, requireAdmin: (_req, _res, next) => next() }, dataDir, baseDir: path.resolve('plugins/Qtiler-3D-eye') });
  await fs.writeFile(path.join(dataDir, 'maps.json'), JSON.stringify([{ id: 'map', mainProjectId: 'fixture', enableTerrain: false }]));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  context.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/plugins/Qtiler-3D-eye`;
  assert.equal((await fetch(`${base}/api/scenes/map/thumbnail`)).status, 200);
  const saved = JSON.parse(await fs.readFile(path.join(dataDir, 'maps.json'), 'utf8'));
  assert.equal(saved[0].thumbnail.source, 'placeholder');
  assert.ok(saved[0].thumbnail.url.includes('/api/scenes/map/thumbnail'));
  assert.equal((await fetch(`${base}/api/publish/map`, { method: 'DELETE' })).status, 200);
  await assert.rejects(fs.access(path.join(dataDir, 'scene-thumbnails', 'map.webp')), error => error.code === 'ENOENT');
  assert.equal((await fetch(`${base}/api/scenes/map/thumbnail`)).status, 404);
});

test('terrain picker always provides flat terrain and can switch back without moving the camera', async () => {
  const source = await fs.readFile('plugins/Qtiler-3D-eye/client/planner-viewer.js', 'utf8');
  const runtimeItems = new Map();
  const generated = { type: 'generated' };
  const viewer = { camera: { marker: 'unchanged' } };
  const context = vm.createContext({
    runtimeItems, viewer, sketchEditor: null, terrainSelectionSequence: 0, currentConfig: { config: {} }, terrainWarning: {},
    renderLayerPanel() {}, setStatus() {}, alignGeneratedTilesToTerrain: async () => {}, URL, window: { location: { origin: 'http://localhost' } },
    Cesium: { EllipsoidTerrainProvider: class FlatProvider {}, CesiumTerrainProvider: { fromUrl: async () => generated } }
  });
  vm.runInContext(source.slice(source.indexOf('async function applyTerrain('), source.indexOf('function placementToMatrix(')), context);
  await context.applyTerrain({ config: { terrains: [{ key: 'generated', type: 'quantized-mesh', name: 'Terrain', terrainUrl: '/terrain/' }] } });
  assert.equal(runtimeItems.has('terrain:flat'), true);
  assert.equal(viewer.terrainProvider, generated);
  await context.selectTerrain('terrain:flat');
  assert.equal(viewer.terrainProvider, runtimeItems.get('terrain:flat').object);
  assert.equal(runtimeItems.get('terrain:flat').selected, true);
  assert.equal(runtimeItems.get('generated').selected, false);
  assert.equal(viewer.camera.marker, 'unchanged');
});

test('north and tilt orbit around the selected map target and constrain the pitch', async () => {
  const source = await fs.readFile('plugins/Qtiler-3D-eye/client/planner-viewer.js', 'utf8');
  const target = { x: 1, y: 2, z: 3 };
  const calls = [];
  const viewer = { canvas: { clientWidth: 800, clientHeight: 600 }, camera: {
    positionWC: {}, lookAt: (point, orientation) => calls.push({ point, orientation }),
    lookAtTransform: (matrix) => calls.push(matrix), setView: (view) => calls.push(view)
  } };
  const context = vm.createContext({ viewer, clearActiveTool() {}, pickGlobePosition: () => target, Cesium: {
    Cartesian2: class { constructor(x, y) { this.x = x; this.y = y; } }, Cartesian3: { distance: () => 1500 },
    HeadingPitchRange: class { constructor(heading, pitch, range) { Object.assign(this, { heading, pitch, range }); } }, Matrix4: { IDENTITY: 'identity' }
  } });
  vm.runInContext(source.slice(source.indexOf('function normalizeTerrainBounds('), source.indexOf('async function createImageryProvider(')), context);
  context.orientCamera(0, -0.6);
  assert.equal(calls[0].point, target);
  assert.equal(calls[0].orientation.heading, 0);
  assert.equal(calls[0].orientation.pitch, -0.6);
  assert.equal(calls[0].orientation.range, 1500);
  assert.equal(calls[1], 'identity');
  calls.length = 0;
  context.orientCamera(1, 0.5);
  assert.equal(calls[0].orientation.pitch, -0.08);
  calls.length = 0;
  context.orientCamera(1, -4);
  assert.equal(calls[0].orientation.pitch, -Math.PI / 2);
});

test('legacy tiles follow selected terrain without accumulating offsets or moving DEM-grounded assets', async () => {
  const source = await fs.readFile('plugins/Qtiler-3D-eye/client/planner-viewer.js', 'utf8');
  let height = 120;
  const legacy = { type: '3dtiles', asset: { metadata: { source: 'qgis3d-tiles', demPath: null } }, region: [0, 0, 0.2, 0.2, 0, 20], object: {} };
  const grounded = { type: '3dtiles', asset: { metadata: { source: 'qgis3d-tiles', demPath: 'dem.tif' } }, region: legacy.region, object: { modelMatrix: 'original' } };
  const context = vm.createContext({ viewer: { terrainProvider: {} }, runtimeItems: new Map([['legacy', legacy], ['grounded', grounded]]), terrainHeightAt: async () => height, Cesium: {
    Math: { toDegrees: (value) => value * 180 / Math.PI },
    Cartesian3: class { static fromDegrees(longitude, latitude, altitude) { return { x: longitude, y: latitude, z: altitude }; } static subtract(first, second) { return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z }; } },
    Matrix4: { fromTranslation: (value) => value }
  } });
  vm.runInContext(source.slice(source.indexOf('async function alignGeneratedTilesToTerrain('), source.indexOf('async function addAssets(')), context);
  await context.alignGeneratedTilesToTerrain();
  assert.equal(legacy.object.modelMatrix.z, 120);
  await context.alignGeneratedTilesToTerrain();
  assert.equal(legacy.object.modelMatrix.z, 120);
  assert.equal(grounded.object.modelMatrix, 'original');
  height = 0;
  await context.alignGeneratedTilesToTerrain();
  assert.equal(legacy.object.modelMatrix.z, 0);
});

test('sketch geometry and all visual properties round-trip without losing terrain mode or explicit transparency', async () => {
  const source = await fs.readFile('plugins/Qtiler-3D-eye/client/sketch-editor.js', 'utf8');
  const context = vm.createContext({ window: {} });
  vm.runInContext(source, context);
  const normalize = context.window.QtilerSketchEditor.normalizeFeature;
  const feature = {
    type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[10, 60, 5], [10.01, 60, 5], [10.01, 60.01, 5], [10, 60, 5]]] },
    properties: { qtilerSketch: { color: '#123456', fillColor: '#abcdef', opacity: 0, fillOpacity: 0.4, mode: 'relative', height: 8.5, extrusion: 12, width: 7, pointSize: 16, dash: 'dashed', name: 'Sketch', text: '' } }
  };
  const normalized = JSON.parse(JSON.stringify(normalize(feature)));
  assert.deepEqual(normalized.geometry, feature.geometry);
  assert.deepEqual(normalized.properties.qtilerSketch, { ...feature.properties.qtilerSketch, modelAssetId: '', modelScale: 1, heading: 0, pitch: 0, roll: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(normalize(normalized))), normalized);
  assert.equal(feature.properties.qtilerSketch.opacity, 0);
  assert.throws(() => normalize({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[10, 60]] } }), /Not enough/);
  assert.throws(() => normalize({ type: 'Feature', geometry: { type: 'Point', coordinates: [181, 60] } }), /Invalid numeric/);
  assert.throws(() => normalize({ ...feature, properties: { qtilerSketch: { mode: 'unknown' } } }), /height mode/);
  assert.throws(() => normalize({ ...feature, properties: { qtilerSketch: { height: 'not a number' } } }), /numeric/);
  assert.throws(() => normalize({ ...feature, geometry: { ...feature.geometry, coordinates: [...feature.geometry.coordinates, feature.geometry.coordinates[0]] } }), /holes/);
});

test('sketch history restores edits, branches after undo and protects stored snapshots from mutation', async () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(await fs.readFile('plugins/Qtiler-3D-eye/client/sketch-editor.js', 'utf8'), context);
  const history = context.window.QtilerSketchEditor.createHistory();
  const first = [{ value: 1 }];
  history.push(first);
  first[0].value = 99;
  history.push([{ value: 2 }]);
  assert.equal(history.move(-1)[0].value, 1);
  assert.equal(history.canRedo, true);
  assert.equal(history.move(1)[0].value, 2);
  history.move(-1);
  history.push([{ value: 3 }]);
  assert.equal(history.canRedo, false);
  const restored = history.move(-1);
  restored[0].value = 123;
  history.move(1);
  assert.equal(history.move(-1)[0].value, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(history.move(-1))), []);
  assert.equal(history.move(-1), null);
});

test('invalid sketch collections are rejected without mutating the source collection', async () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(await fs.readFile('plugins/Qtiler-3D-eye/client/sketch-editor.js', 'utf8'), context);
  const input = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [10, 60] } }, { type: 'Feature', geometry: { type: 'Point', coordinates: [999, 1] } }] };
  const before = JSON.stringify(input);
  assert.throws(() => context.window.QtilerSketchEditor.normalizeCollection(input), /numeric/);
  assert.equal(JSON.stringify(input), before);
});

test('infoclick filters fields and safely displays image and video links', () => {
  const properties = { name: '<script>bad</script>', hidden: 'SECRET', photo: 'https://example.org/photo.jpg?size=large', video: '/media/clip.mp4', unsafe: 'javascript:alert(1)' };
  const html = featureInfoHtml(properties, ['name', 'photo', 'video', 'unsafe'], 'https://qtiler.example/');
  assert.ok(!html.includes('SECRET'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<img'));
  assert.ok(html.includes('<video controls'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!featureInfoHtml(properties, [], 'https://qtiler.example/').includes('<tr>'));
});

test('sketch model identity, coordinates and placement parameters survive serialization', async () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(await fs.readFile('plugins/Qtiler-3D-eye/client/sketch-editor.js', 'utf8'), context);
  const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [10.5, 60.2, 0] }, properties: { qtilerSketch: { modelAssetId: 'model-test', modelScale: 2.5, heading: 90, mode: 'relative', height: 3 } } };
  const first = context.window.QtilerSketchEditor.normalizeFeature(feature);
  const stored = JSON.parse(JSON.stringify(first));
  const loaded = context.window.QtilerSketchEditor.normalizeFeature(stored);
  assert.equal(loaded.properties.qtilerSketch.modelAssetId, 'model-test');
  assert.equal(loaded.properties.qtilerSketch.modelScale, 2.5);
  assert.equal(loaded.properties.qtilerSketch.heading, 90);
  assert.equal(loaded.properties.qtilerSketch.height, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.geometry.coordinates)), [10.5, 60.2, 0]);
});

test('Auth plugin-specific editors can edit authorized 3D scenes but not private projects or global installation', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtiler-eye-editor-test-'));
  context.after(async () => { closeAuthDb(); await fs.rm(root, { recursive: true, force: true }); });
  const app = express();
  app.use((req, _res, next) => { if (req.headers['x-test-user']) req.user = { id: 'editor', role: 'authenticated', projects: ['allowed'], permissions: req.headers['x-test-permission'] ? ['portal:edit:Qtiler-3D-eye'] : [] }; next(); });
  const security = { isEnabled: () => true, canEditPortal: (user, plugin) => user.permissions.includes(`portal:edit:${plugin}`), requireAdmin: (_req, res) => res.status(403).json({ error: 'admin_required' }) };
  const dataDir = path.join(root, 'data', 'Qtiler-3D-eye');
  await register({ app, security, dataDir, baseDir: path.resolve('plugins/Qtiler-3D-eye') });
  await fs.writeFile(path.join(dataDir, 'maps.json'), JSON.stringify([{ id: 'allowed', mainProjectId: 'allowed' }, { id: 'private', mainProjectId: 'private' }]));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/plugins/Qtiler-3D-eye`;
  const headers = { 'x-test-user': 'editor', 'x-test-permission': 'yes', 'content-type': 'application/json' };
  assert.equal((await fetch(`${base}/admin`, { headers })).status, 200);
  assert.equal((await fetch(`${base}/admin`, { headers: { 'x-test-user': 'viewer' } })).status, 403);
  assert.deepEqual((await (await fetch(`${base}/api/publish/list`, { headers })).json()).scenes.map((scene) => scene.id), ['allowed']);
  const view = { position: [1, 2, 3], orientation: { heading: 0, pitch: -1, roll: 0 } };
  assert.equal((await fetch(`${base}/api/scenes/allowed/views`, { method: 'POST', headers, body: JSON.stringify({ view }) })).status, 200);
  assert.equal((await fetch(`${base}/api/scenes/private/views`, { method: 'POST', headers, body: JSON.stringify({ view }) })).status, 403);
  for (const route of ['/api/cesium/install', '/api/settings']) assert.equal((await fetch(base + route, { method: 'POST', headers, body: '{}' })).status, 403, route);
  assert.equal((await fetch(`${base}/api/publish`, { method: 'POST', headers, body: JSON.stringify({ id: 'private', mainProjectId: 'allowed' }) })).status, 403);
});

test('Auth 3D map catalog collects source projects and resolves terrain ownership', async () => {
  const source = await fs.readFile('plugins/QtilerAuth/index.js', 'utf8');
  const start = source.indexOf('  const pluginMapSources = [');
  const end = source.indexOf('  /* ---------------------------------------------------------------- */', start);
  assert.ok(start >= 0 && end > start);
  const scenes = [{ id: 'map', title: '3D map', mainProjectId: 'main', externalLayers: [{ projectId: 'external' }], backgroundProjects: ['background'], terrainProjects: ['generated-terrain'], assetIds: ['tile'] }];
  const context = vm.createContext({ dataRoot: '/data', path, sanitizeProjectId: (value) => String(value || ''), fs: {
    readdirSync: () => [], readFileSync: (file) => JSON.stringify(file.endsWith('maps.json') ? scenes : file.endsWith('terrains.json') ? [{ id: 'generated-terrain', sourceProjectId: 'dem-project' }] : [{ id: 'tile', metadata: { projectId: 'tiles-project' } }])
  } });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.catalog = readPublishedPluginMaps();', context);
  const map = context.catalog.find((plugin) => plugin.id === 'Qtiler-3D-eye').maps[0];
  assert.deepEqual(new Set(map.projectIds), new Set(['main', 'external', 'background', 'dem-project', 'tiles-project']));
  assert.equal(map.url, '/plugins/Qtiler-3D-eye/view/?scene=map');
});

test('concurrent collection sessions merge independent records and reject conflicting edits', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtiler-eye-store-test-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'items.json');
  atomicJsonWrite(file, [{ id: 'a', value: 1 }, { id: 'b', value: 1 }]);
  const store = createCollectionStore(file);
  let release;
  let read;
  const started = new Promise((resolve) => { read = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const first = persistenceContext(null, null, async () => {
    const items = store.read(); read(); await gate; items[0].value = 2; store.write(items);
  });
  await started;
  persistenceContext(null, null, () => { const items = store.read(); items[1].value = 3; store.write(items); });
  release(); await first;
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), [{ id: 'a', value: 2 }, { id: 'b', value: 3 }]);
  let saved;
  const conflictGate = new Promise((resolve) => { saved = resolve; });
  const conflict = persistenceContext(null, null, async () => {
    const items = store.read(); await conflictGate; items[0].value = 5;
    assert.throws(() => store.write(items), (error) => error.status === 409);
  });
  persistenceContext(null, null, () => { const items = store.read(); items[0].value = 4; store.write(items); });
  saved(); await conflict;
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8'))[0].value, 4);
  assert.ok(!(await fs.readdir(root)).some((name) => /\.tmp$|\.lock$/.test(name)));
});

test('failed directory commit restores the previous runtime and successful replacement swaps it', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtiler-eye-runtime-test-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const destination = path.join(root, 'current'); const staged = path.join(root, 'staged');
  await fs.mkdir(destination); await fs.mkdir(staged);
  await fs.writeFile(path.join(destination, 'Cesium.js'), 'old');
  await fs.writeFile(path.join(staged, 'Cesium.js'), 'new');
  await assert.rejects(replaceDirectory(staged, destination, async () => { throw new Error('commit failed'); }), /commit failed/);
  assert.equal(await fs.readFile(path.join(destination, 'Cesium.js'), 'utf8'), 'old');
  await fs.mkdir(staged); await fs.writeFile(path.join(staged, 'Cesium.js'), 'new');
  await replaceDirectory(staged, destination);
  assert.equal(await fs.readFile(path.join(destination, 'Cesium.js'), 'utf8'), 'new');
  assert.deepEqual(await fs.readdir(root), ['current']);
});

test('Cesium install validates staging and keeps installed runtime/state on a bad archive', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtiler-eye-install-test-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = express(); const dataDir = path.join(root, 'data', 'Qtiler-3D-eye');
  await register({ app, security: { isEnabled: () => false }, dataDir, baseDir: path.resolve('plugins/Qtiler-3D-eye') });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const original = globalThis.fetch; context.after(() => { globalThis.fetch = original; });
  const zip = new AdmZip(); zip.addFile('Build/Cesium/Cesium.js', Buffer.from('var Cesium = {};')); zip.addFile('Build/Cesium/Widgets/widgets.css', Buffer.from('body{}'));
  let archive = zip.toBuffer();
  globalThis.fetch = async (url, options) => String(url).startsWith('https://fixture.example/') ? new Response(archive) : original(url, options);
  const base = `http://127.0.0.1:${server.address().port}/plugins/Qtiler-3D-eye`;
  const install = (version) => original(`${base}/api/cesium/install`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version, assetUrl: 'https://fixture.example/cesium.zip' }) });
  assert.equal((await install('fixture-v1')).status, 200);
  archive = Buffer.from('invalid archive');
  assert.equal((await install('broken-v2')).status, 500);
  const status = await (await original(`${base}/api/status`)).json();
  assert.equal(status.cesium.installed, true);
  assert.equal(status.cesium.version, 'fixture-v1');
  assert.equal(await fs.readFile(path.join(dataDir, 'cesium', 'current', 'Cesium.js'), 'utf8'), 'var Cesium = {};');
});

test('job polling reports an interrupted owner instead of remaining running forever', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtiler-eye-job-test-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'job.json');
  atomicJsonWrite(file, { id: 'test', status: 'running', ownerPid: 2147483647 });
  context.mock.method(process, 'kill', (pid) => { assert.equal(pid, 2147483647); throw Object.assign(new Error('No process'), { code: 'ESRCH' }); });
  const job = readJob(file);
  assert.equal(job.status, 'error');
  assert.match(job.error, /interrupted/);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).status, 'error');
});

test('automatic scene thumbnails use published WMS CRS and forward access headers without Origo', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtiler-eye-thumbnail-wms-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data', 'Qtiler-3D-eye');
  const app = express();
  await register({ app, security: { isEnabled: () => false, requireAdmin: (_req, _res, next) => next() }, dataDir, baseDir: path.resolve('plugins/Qtiler-3D-eye') });
  await fs.mkdir(path.join(root, 'cache', 'fixture'), { recursive: true });
  await fs.writeFile(path.join(root, 'cache', 'fixture', 'index.json'), JSON.stringify({ project_extent_wgs84: [10, 59, 11, 60], layers: [] }));
  await fs.writeFile(path.join(root, 'cache', 'fixture', 'project-config.json'), JSON.stringify({ services: { publishedCrs: ['EPSG:3857'] } }));
  await fs.writeFile(path.join(dataDir, 'maps.json'), JSON.stringify([{ id: 'map', mainProjectId: 'fixture', enableTerrain: false, mainLayers: [{ name: 'roads', included: true, visible: true }] }]));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  context.after(() => new Promise(resolve => server.close(resolve)));
  const sharp = (await import('sharp')).default;
  const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#337744' } }).png().toBuffer();
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let requested;
  globalThis.fetch = async (url, options) => {
    const target = new URL(url);
    if (target.pathname === '/wms') {
      requested = { url: target, headers: options.headers };
      return new Response(image, { headers: { 'content-type': 'image/png' } });
    }
    return originalFetch(url, options);
  };
  const response = await originalFetch(`http://127.0.0.1:${server.address().port}/plugins/Qtiler-3D-eye/api/scenes/map/thumbnail`, { headers: { cookie: 'fixture-access=1', 'x-api-key': 'fixture-key' } });
  assert.equal(response.status, 200);
  assert.equal(requested.url.searchParams.get('CRS'), 'EPSG:3857');
  assert.equal(requested.url.searchParams.get('LAYERS'), 'roads');
  assert.equal(requested.headers.cookie, 'fixture-access=1');
  assert.equal(requested.headers['x-api-key'], 'fixture-key');
  const bbox = requested.url.searchParams.get('BBOX').split(',').map(Number);
  assert.ok(Math.abs((bbox[2] - bbox[0]) / (bbox[3] - bbox[1]) - 16 / 9) < 1e-9);
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'maps.json'), 'utf8'))[0].thumbnail.source, 'wms');
  let releaseWms;
  let startWms;
  const started = new Promise(resolve => { startWms = resolve; });
  globalThis.fetch = async (url, options) => {
    if (new URL(url).pathname === '/wms') {
      startWms();
      await new Promise(resolve => { releaseWms = resolve; });
      return new Response(image, { headers: { 'content-type': 'image/png' } });
    }
    return originalFetch(url, options);
  };
  const base = `http://127.0.0.1:${server.address().port}/plugins/Qtiler-3D-eye`;
  const pending = originalFetch(`${base}/api/scenes/map/thumbnail/regenerate`, { method: 'POST' });
  await started;
  const manual = new FormData();
  manual.append('image', new Blob([image], { type: 'image/png' }), 'chosen.png');
  assert.equal((await originalFetch(`${base}/api/scenes/map/thumbnail`, { method: 'POST', body: manual })).status, 201);
  releaseWms();
  assert.equal((await pending).status, 200);
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'maps.json'), 'utf8'))[0].thumbnail.source, 'upload', 'A later manual image must win over in-flight automatic generation');
});

test('grouped layer style editor retains controls and per-map thumbnails no longer depend on Origo', async () => {
  const admin = await fs.readFile('plugins/Qtiler-3D-eye/admin-ui/app.js', 'utf8');
  const start = admin.indexOf('function styleEditorHtml(');
  const end = admin.indexOf('\nfunction readStyleFromRow(', start);
  const scope = { escapeHtml: value => String(value ?? ''), geometryLabel: key => key, heightModeOptions: () => '<option>auto</option>', stylePresetOptions: () => '', gltfMiniViewHtml: () => '', styleRuleHtml: () => '' };
  vm.runInNewContext(admin.slice(start, end), scope);
  const markup = scope.styleEditorHtml('line', { heightMode: 'relative', tubeRadius: 0.35, heightOffset: -2 });
  assert.equal((markup.match(/class="style-section"/g) || []).length, 3);
  for (const field of ['height-mode', 'tube-radius', 'height-offset', 'line-style', 'show-underground', 'stroke-color', 'stroke-width', 'min-zoom', 'max-zoom']) {
    assert.equal((markup.match(new RegExp(`data-layer-${field}(?=[\\s>])`, 'g')) || []).length, 1, `Style control ${field} must not be duplicated or dropped`);
  }
  const urlStart = admin.indexOf('function thumbnailUrlForScene(');
  const urlEnd = admin.indexOf('\nasync function saveSceneThumbnailImage(', urlStart);
  vm.runInNewContext(admin.slice(urlStart, urlEnd), { API_BASE: '/plugins/Qtiler-3D-eye', result: null });
  assert.ok(admin.slice(urlStart, urlEnd).includes('/api/scenes/'));
  assert.ok(!admin.slice(urlStart, urlEnd).includes('Qtiler2origo'));
});

test('3D Eye graceful dispose stops active Python terrain jobs before worker exit', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtiler-eye-dispose-'));
  context.after(async () => fs.rm(root, { recursive: true, force: true }));
  const pluginRoot = path.join(root, 'plugin');
  const dataDir = path.join(root, 'data', 'Qtiler-3D-eye');
  await fs.mkdir(path.join(pluginRoot, 'python'), { recursive: true });
  const marker = path.join(root, 'child-started');
  const dem = path.join(root, 'dem.tif');
  await fs.writeFile(dem, 'fixture DEM');
  await fs.writeFile(path.join(pluginRoot, 'python', 'hydro_flatten.py'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'started');setInterval(()=>{},1000);`);
  const originalPython = process.env.PYTHON_EXE;
  process.env.PYTHON_EXE = process.execPath;
  let server;
  let api;
  try {
    const app = express();
    api = await register({ app, security: { isEnabled: () => false, requireAdmin: (_req, _res, next) => next() }, dataDir, baseDir: pluginRoot });
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/plugins/Qtiler-3D-eye/api/build-terrain`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'fixture', terrainName: 'fixture', demPath: dem }) });
    assert.equal(response.status, 200);
    const job = await response.json();
    const deadline = Date.now() + 5000;
    while (!fsSync.existsSync(marker) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(fsSync.existsSync(marker), true, 'The fixture Python child must be active before dispose');
    const started = Date.now();
    await api.dispose();
    assert.ok(Date.now() - started < 5000, 'Dispose must reap interrupted jobs within the worker shutdown budget');
    const record = JSON.parse(await fs.readFile(path.join(dataDir, 'terrain-jobs', `${job.jobId}.json`), 'utf8'));
    assert.equal(record.status, 'error');
  } finally {
    if (api?.dispose) await api.dispose();
    if (server) await new Promise(resolve => server.close(resolve));
    if (originalPython === undefined) delete process.env.PYTHON_EXE;
    else process.env.PYTHON_EXE = originalPython;
  }
});