const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const backend = fs.readFileSync('plugins/Qtiler2Hajk/index.js', 'utf8');
const builderStart = backend.indexOf('  const buildHajkIndexConfig = async');
const builderEnd = backend.indexOf('  // \u2500\u2500 Intercept index.json', builderStart);
assert.ok(builderStart >= 0 && builderEnd > builderStart);
const computeStart = backend.indexOf('  const computeProjectionConfig =');
const computeEnd = backend.indexOf('  // \u2500\u2500 Load tile grid', computeStart);
assert.ok(computeStart >= 0 && computeEnd > computeStart);

const projectExtents = {
  main: { crs: 'EPSG:3006', native: [400000, 6500000, 500000, 6600000] },
  background: { crs: 'EPSG:3007', native: [100000, 6500000, 200000, 6600000] }
};
const context = {
  console, URLSearchParams, path,
  fs: { existsSync: () => false, promises: { readFile: async () => { throw Object.assign(new Error('fixture has no searchable layers'), { code: 'ENOENT' }); } } },
  installRoot: 'unused', pluginSlug: 'Qtiler2Hajk',
  dataRoot: 'unused',
  sanitizeFileToken: (value) => String(value),
  normalizeOrigoControlEntry: (entry) => typeof entry === 'string' ? { name: entry } : entry,
  preloadRemoteLegendSvgIcons: async () => {},
  getHajkLegendStyleEntries: () => [],
  loadTileGridForProject: async () => null,
  getProjectExtent: async (id) => projectExtents[id],
  normalizeProjectId: (id) => String(id || '').trim(),
  normalizeThemeName: () => '',
  shouldUseWfsForPublishedLayer: () => false,
  readCacheIndex: async () => ({ layers: [] }),
  buildProj4Defs: (...codes) => [...new Set(codes.filter(Boolean))].map((code) => ({ code, projection: `definition:${code}` })),
  getNamedInfoclickAttributes: () => [],
  buildHajkInfobox: () => '',
  makeWmsLegendUrl: () => '',
  toAbsoluteHajkIconSrc: () => '',
  KNOWN_PROJECTIONS: {},
  proj4: () => { throw new Error('Saved view must not need reprojection when adding a layer'); }
};
vm.createContext(context);
vm.runInContext(backend.slice(computeStart, computeEnd) + backend.slice(builderStart, builderEnd) + '\nglobalThis.buildConfig = buildHajkIndexConfig;', context);

async function check() {
  for (const backgroundProjectId of [null, 'background']) {
    const mapCrs = backgroundProjectId ? 'EPSG:3007' : 'EPSG:3006';
    const savedCenter = backgroundProjectId ? [150000, 6550000] : [450000, 6550000];
    const profile = { projectId: 'main', backgroundProjectId, center: savedCenter, centerCrs: mapCrs, zoom: 8, controls: ['layerswitcher'], layers: [{ name: 'existing', role: 'main' }] };
    const before = await context.buildConfig(profile, 'http://localhost:3009');
    const mixed = await context.buildConfig({ ...profile, layers: [...profile.layers,
      { kind: 'external', externalType: 'xyz', sourceId: 'xyz', projection: 'EPSG:3857', visible: true },
      { kind: 'external', externalType: 'wms', sourceId: 'wms', layer: 'remote', projection: 'EPSG:25832', visible: true }
    ] }, 'http://localhost:3009');
    assert.deepEqual(JSON.parse(JSON.stringify(mixed.mapConfig.map)), JSON.parse(JSON.stringify(before.mapConfig.map)), 'Adding mixed-CRS layers must not change CRS, extent, center or resolutions');
    assert.equal(mixed.layersConfig.wmtslayers[0].projection, 'EPSG:3857');
    assert.deepEqual(Array.from(mixed.mapConfig.map.center), savedCenter);
    assert.equal(mixed.layersConfig.wmslayers.find((layer) => layer.caption === 'wms').projection, 'EPSG:25832');
    assert.ok(mixed.mapConfig.projections.some((entry) => entry.code === 'EPSG:25832'));
    assert.equal(mixed.mapConfig.map.projection, backgroundProjectId ? 'EPSG:3007' : 'EPSG:3006');
  }
  const anchor = /const wmtsViewAnchor = '([^']+)';/.exec(backend)[1];
  const replacement = /const wmtsViewReplacement = '([^']+)';/.exec(backend)[1];
  const bundlePath = 'temp/hajk_extracted/hajk-v4.3.0-simple/static/app-core-CdjlP1aJ.js';
  if (fs.existsSync(bundlePath)) {
    const bundle = fs.readFileSync(bundlePath, 'utf8');
    assert.ok(bundle.includes(anchor), 'The patch must match the actual Hajk 4.3 WMTS adapter');
    const patched = bundle.split(anchor).join(replacement);
    assert.ok(!patched.includes(anchor));
    assert.equal(patched.split(anchor).join(replacement), patched, 'Reapplying the patch must be harmless');
  }
  const view = { center: [450000, 6550000], projection: 'EPSG:3006' };
  const state = { map: { getView: () => view, setView: () => { throw new Error('WMTS must not replace the map view'); } } };
  const adapter = vm.runInNewContext(`({${replacement}})`);
  assert.equal(adapter.updateMapViewResolutions.call(state), view);
  console.log('Hajk mixed CRS behavior checks passed.');
}

check().catch((error) => { console.error(error); process.exitCode = 1; });