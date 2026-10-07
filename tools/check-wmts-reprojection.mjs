import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import vm from 'node:vm';
import proj4 from 'proj4';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildReprojectedMatrixSet, renderReprojectedTile } from '../lib/wmtsReprojection.js';

const layer = { identifier: 'project_layer', extent: [0, 0, 1024, 512], tileMatrixSet: { matrices: [{ identifier: '0', scaleDenominator: 1 / 0.00028, tileWidth: 256, tileHeight: 256 }] } };
test('alternate matrix grid uses transformed extent without modifying the native grid', () => {
  const original = JSON.stringify(layer);
  const grid = buildReprojectedMatrixSet(layer, 'EPSG:3857', ([east, north]) => [east * 2, north * 2]);
  assert.deepEqual(grid.extent, [0, 0, 2048, 1024]);
  assert.equal(grid.matrices[0].matrixWidth, 8);
  assert.equal(JSON.stringify(layer), original);
});
test('alternate WMTS renders once, caches separately and rejects invalid coordinates', async (context) => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qtiler-wmts-test-'));
  context.after(() => fs.rm(cacheDir, { recursive: true, force: true }));
  const grid = buildReprojectedMatrixSet(layer, 'EPSG:3857', (point) => point);
  const calls = [];
  const params = { cacheDir, projectFile: 'project.qgz', layerId: 'project_layer', layerName: 'layer', matrixSet: grid, matrixId: '0', row: 0, col: 1,
    renderer: { renderTile: async (request) => { calls.push(request); await fs.writeFile(request.output_file, 'fixture png'); return { status: 'success' }; } } };
  const first = await renderReprojectedTile(params);
  assert.equal(await renderReprojectedTile(params), first);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].bbox, [256, 256, 512, 512]);
  assert.equal(calls[0].crs, 'EPSG:3857');
  assert.ok(first.includes('_reprojected_wmts'));
  await assert.rejects(renderReprojectedTile({ ...params, col: -1 }));
});

test('geographic grids retain internal x/y coordinates and declare north/east axes for capabilities', () => {
  const grid = buildReprojectedMatrixSet(layer, 'EPSG:4326', ([east, north]) => [east / 100000, north / 100000], 111319.49079327358);
  assert.equal(grid.axisOrder, 'yx');
  assert.deepEqual(grid.matrices[0].topLeftCorner, [0, 0.00512]);
  assert.equal(grid.matrices[0].resolution, 1 / 111319.49079327358);
});

test('real WMTS inventory adds the selected CRS and keeps original cache metadata unchanged', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtiler-wmts-inventory-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'project'));
  const index = { layers: [{ name: 'layer', scheme: 'wmts', tile_crs: 'EPSG:3006', extent: [400000, 6500000, 450000, 6550000], zoom_min: 0, zoom_max: 0,
    tile_matrix_set: { id: 'native', supported_crs: 'EPSG:3006', top_left_corner: [400000, 6550000], matrices: [{ z: 0, resolution: 100, matrix_width: 2, matrix_height: 2 }] } }] };
  const indexPath = path.join(root, 'project', 'index.json');
  const original = JSON.stringify(index);
  await fs.writeFile(indexPath, original);
  const definitions = { 'EPSG:3006': '+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs', 'EPSG:3010': '+proj=tmerc +lat_0=0 +lon_0=16.5 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +units=m +no_defs' };
  proj4.defs('EPSG:3006', definitions['EPSG:3006']);
  const definitionsPath = path.join(root, 'definitions.json');
  await fs.writeFile(definitionsPath, JSON.stringify(definitions));
  const backend = await fs.readFile('server.js', 'utf8');
  const start = backend.indexOf('const normalizeIdentifier =');
  const end = backend.indexOf('const resolveWmtsLayerRouting =', start);
  const sandbox = {
    console, fs: syncFs, path, proj4, Set,
    cacheDir: root, proj4PresetsPath: definitionsPath, proj4Presets: definitions,
    TILE_SIZE_PX: 256, WEB_MERCATOR_EXTENT: 20037508.342789244, DEFAULT_WMTS_STYLE: 'default',
    readProjectConfig: () => ({ services: { publishedCrs: ['EPSG:3006', 'EPSG:3010'] } }),
    getTileMatrixPresetRaw: () => null,
    normalizeThemeName: (name) => name,
    buildLayerTitle: (_project, name) => name,
    toCrsUrn: (code) => code,
    buildReprojectedMatrixSet
  };
  vm.createContext(sandbox);
  vm.runInContext(backend.slice(start, end) + '\nglobalThis.inventory = buildWmtsInventory;', sandbox);
  const inventory = sandbox.inventory();
  assert.equal(inventory.layers.length, 1);
  assert.equal(inventory.layers[0].tileCrs, 'EPSG:3006');
  assert.equal(inventory.layers[0].additionalTileMatrixSets[0].supportedCrs, 'EPSG:3010');
  assert.ok(inventory.tileMatrixSets.some((set) => set.supportedCrs === 'EPSG:3010'));
  assert.equal(await fs.readFile(indexPath, 'utf8'), original);
  assert.equal(sandbox.inventory({ excludeLayerFilter: () => true }).layers.length, 0);
  assert.equal(sandbox.inventory({ projectAccessFilter: new Set() }).layers.length, 0);
});