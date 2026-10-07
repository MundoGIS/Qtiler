import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import proj4 from 'proj4';
import { registerWmsRoutes } from '../routes/wms.js';
import { registerWfsRoutes } from '../routes/wfs.js';
import { normalizePublishedCrs } from '../lib/publishedCrs.js';

function fixture(config = {}, options = {}) {
  const routes = new Map();
  const calls = [];
  const app = Object.fromEntries(['get', 'post'].map((method) => [method, (url, ...handlers) => routes.set(`${method} ${url}`, handlers)]));
  registerWmsRoutes({
    app, cacheDir: 'unused', tileGridDir: 'unused',
    tileRendererPool: { renderTile: async (params) => {
      calls.push(params);
      if (options.failFirst && calls.length === 1) throw Object.assign(new Error('queue_full'), { code: 'QUEUE_FULL' });
      if (params.action === 'wfs_list') return { status: 'success', featureTypes: [
        { rawName: 'parks', title: 'Parks', crs: 'EPSG:3006', bboxWgs84: [12, 58, 16, 60] },
        { rawName: 'private', title: 'Private', crs: 'EPSG:3006' }
      ] };
      return { status: 'success', data: { crs: params.crs, layers: options.empty ? [] : [{ name: 'parks', features: [{ id: 1, properties: { name: 'Park' }, geometry: { type: 'Point', coordinates: [1100, 2200] } }] }] }, text: 'Park', xml: '<Feature>Park</Feature>' };
    } },
    ensureProjectAccessFromQuery: () => (_req, _res, next) => next(),
    findProjectById: () => ({ file: 'fixture.qgz' }),
    readProjectConfig: () => config,
    getServiceMetadata: () => options.metadata || {},
    isPublicLayerExcludedForRequest: (_req, _id, name) => name === 'private'
  });
  return {
    calls,
    request: async (query) => {
      const response = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        type(value) { this.contentType = value; return this; },
        setHeader() {},
        send(value) { this.body = value; return this; },
        json(value) { this.body = value; return this; }
      };
      await routes.get('get /wms').at(-1)({ method: 'GET', path: '/wms', query, originalUrl: '/wms', protocol: 'http', headers: { host: 'localhost' }, get: (name) => name.toLowerCase() === 'host' ? 'localhost' : '' }, response);
      return response;
    }
  };
}

const baseQuery = { project: 'fixture', SERVICE: 'WMS', REQUEST: 'GetFeatureInfo', VERSION: '1.3.0', WIDTH: '200', HEIGHT: '100', QUERY_LAYERS: 'parks', I: '100', J: '50' };

for (const [crs, bbox, expected] of [
  ['EPSG:3006', '6500000,400000,6600000,600000', [400000, 6500000, 600000, 6600000]],
  ['EPSG:4326', '58,12,60,16', [12, 58, 16, 60]],
  ['EPSG:3857', '1000,2000,3000,4000', [1000, 2000, 3000, 4000]]
]) {
  test(`GetFeatureInfo uses QGIS x/y order for ${crs}`, async () => {
    const { request, calls } = fixture();
    const result = await request({ ...baseQuery, CRS: crs, BBOX: bbox });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(calls[0].bbox, expected);
    assert.equal(calls[0].action, 'feature_info');
  });
}

test('WMS 1.1.1 keeps x/y order', async () => {
  const { request, calls } = fixture();
  await request({ ...baseQuery, VERSION: '1.1.1', SRS: 'EPSG:3006', BBOX: '400000,6500000,600000,6600000' });
  assert.deepEqual(calls[0].bbox, [400000, 6500000, 600000, 6600000]);
});

for (const format of ['application/json', 'text/plain', 'text/xml']) {
  test(`GetFeatureInfo returns ${format}`, async () => {
    const { request } = fixture();
    const result = await request({ ...baseQuery, CRS: 'EPSG:3857', BBOX: '1000,2000,3000,4000', INFO_FORMAT: format });
    assert.equal(result.contentType, format);
  });
}

test('an excluded layer is rejected before the renderer is called', async () => {
  const { request, calls } = fixture();
  const result = await request({ ...baseQuery, CRS: 'EPSG:3857', BBOX: '1000,2000,3000,4000', QUERY_LAYERS: 'private' });
  assert.equal(result.statusCode, 403);
  assert.equal(calls.length, 0);
});

test('capabilities advertise live queryable vectors and omit excluded layers', async () => {
  const { request } = fixture();
  const result = await request({ project: 'fixture', REQUEST: 'GetCapabilities', VERSION: '1.3.0' });
  assert.equal(result.statusCode, 200);
  assert.match(result.body, /<Layer queryable="1"><Name>parks<\/Name>/);
  assert.ok(!result.body.includes('<Name>private</Name>'));
  assert.match(result.body, /<GetFeatureInfo>/);
  assert.match(result.body, /<CRS>EPSG:3006<\/CRS>/);
});

test('published CRS are normalized and validated', () => {
  assert.deepEqual(normalizePublishedCrs(['epsg:3006', 'EPSG:3006', 'EPSG:3857']), ['EPSG:3006', 'EPSG:3857']);
  assert.throws(() => normalizePublishedCrs(['invalid']));
  assert.throws(() => normalizePublishedCrs('EPSG:3006'));
});

test('WMS advertises the configured CRS and rejects other CRS before rendering', async () => {
  const { request, calls } = fixture({ services: { publishedCrs: ['EPSG:3006'] } });
  const capabilities = await request({ project: 'fixture', REQUEST: 'GetCapabilities' });
  assert.match(capabilities.body, /<CRS>EPSG:3006<\/CRS>/);
  assert.ok(!capabilities.body.includes('<CRS>EPSG:3857</CRS>'));
  const count = calls.length;
  const rejected = await request({ ...baseQuery, CRS: 'EPSG:3857', BBOX: '1000,2000,3000,4000' });
  assert.equal(rejected.statusCode, 400);
  assert.equal(calls.length, count);
  const accepted = await request({ ...baseQuery, CRS: 'EPSG:3006', BBOX: '6500000,400000,6600000,600000' });
  assert.equal(accepted.statusCode, 200);
});

for (const [version, defaultTag, otherTag] of [['1.1.0', 'DefaultSRS', 'OtherSRS'], ['2.0.0', 'DefaultCRS', 'OtherCRS']]) {
  test(`WFS ${version} advertises the configured CRS`, async () => {
    const routes = new Map();
    const app = Object.fromEntries(['get', 'post', 'put', 'delete', 'all'].map((method) => [method, (url, ...handlers) => routes.set(`${method} ${url}`, handlers)]));
    registerWfsRoutes({
      app, tileRendererPool: { renderTile: async () => ({ status: 'success', featureTypes: [{ name: 'parks', crs: 'EPSG:3006' }] }) },
      ensureProjectAccessFromQuery: () => (_req, _res, next) => next(),
      requireAdmin: (_req, _res, next) => next(), security: {},
      findProjectById: () => ({ file: 'fixture.qgz' }),
      readProjectConfig: () => ({ services: { publishedCrs: ['EPSG:3006', 'EPSG:3857'] } })
    });
    const response = {
      status(code) { this.statusCode = code; return this; },
      type() { return this; }, setHeader() {},
      send(value) { this.body = value; return this; }
    };
    const req = { query: { project: 'fixture', REQUEST: 'GetCapabilities', VERSION: version }, protocol: 'http', headers: { host: 'localhost' }, get: (name) => name.toLowerCase() === 'host' ? 'localhost' : '' };
    await routes.get('get /wfs').at(-1)(req, response);
    assert.equal(response.statusCode, 200);
    assert.ok(response.body.includes(`<${defaultTag}>EPSG:3006</${defaultTag}>`));
    assert.ok(response.body.includes(`<${otherTag}>EPSG:3857</${otherTag}>`));
    await routes.get('get /wfs').at(-1)({ ...req, query: { project: 'fixture', REQUEST: 'GetFeature', TYPENAME: 'parks', SRSNAME: 'EPSG:25832' } }, response);
    assert.equal(response.statusCode, 400);
    assert.match(response.body, /not published for this project/);
  });
}

function crsInputFixture(fetchResponse = async () => ({ ok: true })) {
  const source = fs.readFileSync('public/js/index.js', 'utf8');
  const start = source.indexOf("      publishedCrsInput?.addEventListener('change', async () => {");
  const end = source.indexOf('\n      });', start);
  assert.ok(start >= 0 && end > start);
  const saves = [];
  const errors = [];
  const context = {
    activeProjectId: 'main', suppressControlSync: false,
    publishedCrsInput: { value: '', addEventListener(_event, callback) { this.change = callback; } },
    fetch: fetchResponse,
    queueProjectConfigSave: (id, patch) => saves.push({ id, patch }),
    showStatus: (message) => errors.push(message)
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end + '\n      });'.length), context);
  return { context, saves, errors };
}

test('CRS input validates, deduplicates and saves project settings without changing cache settings', async () => {
  const { context, saves } = crsInputFixture();
  context.publishedCrsInput.value = 'epsg:3006, EPSG:3857, EPSG:3006';
  await context.publishedCrsInput.change();
  assert.deepEqual(JSON.parse(JSON.stringify(saves)), [{ id: 'main', patch: { services: { publishedCrs: ['EPSG:3006', 'EPSG:3857'] } } }]);
});

test('CRS input does not save unresolvable projections', async () => {
  const { context, saves, errors } = crsInputFixture(async () => ({ ok: false }));
  context.publishedCrsInput.value = 'EPSG:9999999';
  await context.publishedCrsInput.change();
  assert.equal(saves.length, 0);
  assert.equal(errors.length, 1);
});

test('switching projects while resolving CRS does not write stale input', async () => {
  const { context, saves } = crsInputFixture(async () => { context.activeProjectId = 'other'; return { ok: true }; });
  context.publishedCrsInput.value = 'EPSG:3857';
  await context.publishedCrsInput.change();
  assert.equal(saves.length, 0);
});

test('explicitly non-queryable layers reject GetFeatureInfo', async () => {
  const { request, calls } = fixture({ layers: { parks: { wmsQueryable: false } } });
  const result = await request({ ...baseQuery, CRS: 'EPSG:3857', BBOX: '1000,2000,3000,4000' });
  assert.equal(result.statusCode, 400);
  assert.equal(calls.length, 0);
});

test('Auth layer permission save preserves infoclick, project CRS and existing layer configuration', () => {
  const source = fs.readFileSync('plugins/QtilerAuth/index.js', 'utf8');
  const start = source.indexOf('  const readProjectLayerPermissions =');
  const end = source.indexOf('  const PROJECT_ACCESS_CACHE_TTL_MS', start);
  assert.ok(start >= 0 && end > start);
  let config = { services: { publishedCrs: ['EPSG:3006'] }, layers: { parks: { wmsQueryable: true, style: 'saved' } } };
  const context = {
    readProjectConfig: () => config,
    writeProjectConfig: (_project, value) => { config = value; },
    readSearchableLayers: () => [], writeSearchableLayers() {}, nowIso: () => 'fixture'
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + '\nglobalThis.savePermissions = saveProjectLayerPermissions;', context);
  const result = context.savePermissions('main', [{ name: 'parks', wmsQueryable: false, wfsEditable: true }]);
  assert.equal(result[0].wmsQueryable, false);
  assert.equal(result[0].wfsEditable, true);
  assert.equal(config.layers.parks.style, 'saved');
  assert.deepEqual(Array.from(config.services.publishedCrs), ['EPSG:3006']);
  context.savePermissions('main', [{ name: 'parks', wfsEditable: true }]);
  assert.equal(config.layers.parks.wmsQueryable, false, 'Older clients must not reset the infoclick choice');
});

test('Auth payload only allows infoclick, editing and search for vector rows', () => {
  const source = fs.readFileSync('plugins/QtilerAuth/admin-ui/app.js', 'utf8');
  const start = source.indexOf('function collectLayerPermissionPayload(');
  const end = source.indexOf('function scheduleLayerPermissionAutosave(', start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const rows = ['1', '0'].map((vectorLayer) => ({
    dataset: { layerName: vectorLayer === '1' ? 'parks' : 'imagery', vectorLayer },
    querySelector: (selector) => selector.endsWith('-check') ? { checked: true } : { value: '' }
  }));
  const result = context.collectLayerPermissionPayload({ querySelectorAll: () => rows });
  assert.equal(result[0].wmsQueryable, true);
  assert.equal(result[0].wfsEditable, true);
  assert.equal(result[1].wmsQueryable, false);
  assert.equal(result[1].wfsEditable, false);
  assert.equal(result[1].wfsSearchable, false);
});

test('Auth distinguishes vector geometry from raster and theme metadata', () => {
  const source = fs.readFileSync('plugins/QtilerAuth/admin-ui/app.js', 'utf8');
  const start = source.indexOf('function isVectorPermissionLayer(');
  const end = source.indexOf('async function savePublishedCrsForProject(', start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  assert.equal(context.isVectorPermissionLayer({ type: 'vector', geometry_type: 'polygon' }), true);
  assert.equal(context.isVectorPermissionLayer({ type: 'raster', geometry_type: 'raster' }), false);
  assert.equal(context.isVectorPermissionLayer({ type: 'WMS', geometry_type: 'raster' }), false);
  assert.equal(context.isVectorPermissionLayer({ name: 'theme:map', geometry_type: 'polygon' }), false);
});

test('Auth CRS control validates and updates only its selected project', async () => {
  const source = fs.readFileSync('plugins/QtilerAuth/admin-ui/app.js', 'utf8');
  const start = source.indexOf('async function savePublishedCrsForProject(');
  const end = source.indexOf('function renderLayerPermissions(', start);
  const calls = [];
  const context = {
    state: { projectServicesByProject: { other: { publishedCrs: ['EPSG:3857'] } } },
    api: async (url, options) => {
      calls.push({ url, options });
      return options ? { services: options.body.services } : { def: 'fixture definition' };
    }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  await context.savePublishedCrsForProject('main', 'epsg:3006, EPSG:3006');
  assert.equal(calls[0].url, '/api/proj4/EPSG%3A3006');
  assert.equal(calls[1].url, '/projects/main/config');
  assert.equal(calls[1].options.method, 'PATCH');
  assert.deepEqual(Array.from(context.state.projectServicesByProject.main.publishedCrs), ['EPSG:3006']);
  assert.deepEqual(context.state.projectServicesByProject.other.publishedCrs, ['EPSG:3857']);
  await assert.rejects(context.savePublishedCrsForProject('main', 'invalid'));
  assert.equal(calls.length, 2);
});

test('Auth CRS control reports fake EPSG and backend save mismatches', async () => {
  const source = fs.readFileSync('plugins/QtilerAuth/admin-ui/app.js', 'utf8');
  const start = source.indexOf('async function savePublishedCrsForProject(');
  const end = source.indexOf('function renderLayerPermissions(', start);
  const context = { state: {}, api: async () => { throw new Error('not_found'); } };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  await assert.rejects(context.savePublishedCrsForProject('main', 'EPSG:9999999'), /Unknown or unavailable EPSG/);
  context.api = async (_url, options) => options ? { services: { publishedCrs: [] } } : { def: 'valid fixture' };
  await assert.rejects(context.savePublishedCrsForProject('main', 'EPSG:3857'), /server did not save/);
});

test('WMS viewer click calls GetFeatureInfo and displays returned attributes safely', async () => {
  const source = fs.readFileSync('public/js/viewer.js', 'utf8');
  const start = source.indexOf('    if (isWmsMode && !viewerData.theme) {');
  const end = source.indexOf('    renderInfo();', start);
  assert.ok(start >= 0 && end > start);
  const element = { style: {}, textContent: '', innerHTML: '' };
  let click;
  let requested;
  const context = {
    isWmsMode: true, viewerData: { layer: 'parks' }, AbortController,
    document: { createElement: () => element },
    ol: { Overlay: class { setPosition(value) { this.position = value; } } },
    map: { addOverlay() {}, on: (_event, callback) => { click = callback; }, getView: () => ({ getResolution: () => 10, getProjection: () => 'EPSG:3006' }) },
    tileSource: { getFeatureInfoUrl: (_coordinate, _resolution, _projection, params) => { assert.equal(params.QUERY_LAYERS, 'parks'); return '/wms?REQUEST=GetFeatureInfo'; } },
    fetch: async (url) => { requested = url; return { ok: true, json: async () => ({ layers: [{ features: [{ properties: { name: '<script>unsafe</script>' } }] }] }) }; },
    escapeHtml: (value) => String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;')
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  await click({ coordinate: [400000, 6500000] });
  assert.equal(requested, '/wms?REQUEST=GetFeatureInfo');
  assert.ok(element.innerHTML.includes('&lt;script&gt;'));
  assert.ok(!element.innerHTML.includes('<script>'));
});

test('server rejects invalid projection definitions before persisting EPSG', async () => {
  const source = fs.readFileSync('server.js', 'utf8');
  const start = source.indexOf('const ensureServerProj4Def =');
  const end = source.indexOf('app.set("views"', start);
  let writes = 0;
  const context = {
    console, proj4, proj4Presets: {}, proj4PresetsPath: 'unused',
    normalizeEpsgKey: (code) => code,
    fetchProj4FromEpsgIo: async () => '<html>Unknown projection</html>',
    fs: { readFileSync: () => '{}', writeFileSync: () => { writes += 1; } }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + '\nglobalThis.ensureCrs = ensureServerProj4Def;', context);
  assert.equal(await context.ensureCrs('EPSG:9999999'), null);
  assert.equal(writes, 0);
});

test('GetFeatureInfo retries a transient queue_full error', async () => {
  const { request, calls } = fixture({}, { failFirst: true });
  const result = await request({ ...baseQuery, CRS: 'EPSG:3857', BBOX: '1000,2000,3000,4000' });
  assert.equal(result.statusCode, 200);
  assert.equal(calls.length, 2);
});

test('WMS capabilities use escaped editable service metadata', async () => {
  const { request } = fixture({}, { metadata: { serviceIdentification: { title: 'Maps & <Region>', abstract: 'Description', keywords: ['Regional'] }, serviceProvider: { providerName: 'Organization' } } });
  const result = await request({ project: 'fixture', REQUEST: 'GetCapabilities' });
  assert.ok(result.body.includes('<Title>Maps &amp; &lt;Region&gt;</Title>'));
  assert.ok(result.body.includes('<ContactOrganization>Organization</ContactOrganization>'));
});

test('GetFeatureInfo JSON is a valid GeoJSON FeatureCollection for plugin clients', async () => {
  const { request } = fixture();
  const result = await request({ ...baseQuery, CRS: 'EPSG:3857', BBOX: '1000,2000,3000,4000' });
  assert.equal(result.body.type, 'FeatureCollection');
  assert.equal(result.body.features[0].type, 'Feature');
  assert.equal(result.body.features[0].id, 'parks.1');
  assert.equal(result.body.features[0].properties.name, 'Park');
  assert.deepEqual(result.body.features[0].geometry, { type: 'Point', coordinates: [1100, 2200] });
  assert.equal(result.body.crs.properties.name, 'EPSG:3857');
  assert.ok(result.body.layers, 'Qtiler viewer compatibility must remain intact');
  const { default: GeoJSON } = await import('ol/format/GeoJSON.js');
  const features = new GeoJSON().readFeatures(result.body);
  assert.equal(features[0].getId(), 'parks.1');
  assert.equal(features[0].get('name'), 'Park');
  assert.equal(features[0].getGeometry().getType(), 'Point');
});

test('an empty GetFeatureInfo result remains readable GeoJSON', async () => {
  const { request } = fixture({}, { empty: true });
  const result = await request({ ...baseQuery, CRS: 'EPSG:3857', BBOX: '1000,2000,3000,4000' });
  const { default: GeoJSON } = await import('ol/format/GeoJSON.js');
  assert.equal(result.body.type, 'FeatureCollection');
  assert.deepEqual(new GeoJSON().readFeatures(result.body), []);
});