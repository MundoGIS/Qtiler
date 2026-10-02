const assert = require('node:assert/strict');
const fs = require('node:fs');

const proxy = fs.readFileSync('routes/externalServices.js', 'utf8');
assert.ok(proxy.includes("new Set(['xyz', 'wms', 'wmts'])"), 'Shared registry must support XYZ, WMS, and WMTS');
assert.ok(proxy.includes("'/external-services/:sourceId/proxy'"), 'Shared KVP proxy route is missing');
assert.ok(proxy.includes("'/external-services/:sourceId/tiles/:z/:x/:y'"), 'Shared XYZ tile route is missing');
assert.ok(proxy.includes("getQueryValue(req.query, 'tilematrix')"), 'Shared KVP proxy must read WMTS query keys case-insensitively');
assert.ok(proxy.includes("redirect: 'error'"), 'Proxy must reject upstream redirects');
assert.ok(proxy.includes('private_upstream_not_allowed'), 'Proxy must reject private upstream addresses');

for (const plugin of ['Qtiler2Origo', 'Qtiler2Hajk']) {
  const client = fs.readFileSync(`plugins/${plugin}/admin-ui/app.js`, 'utf8');
  const backend = fs.readFileSync(`plugins/${plugin}/index.js`, 'utf8');
  assert.ok(client.includes('XYZ / WMS / WMTS'), `${plugin}: external service action is missing`);
  assert.ok(client.includes("kind: 'external'"), `${plugin}: external operational layer model is missing`);
  assert.ok(client.includes('externalLayerFields(layer, projectId)'), `${plugin}: publish payload loses external source metadata`);
  assert.ok(client.includes('addExternalServiceLayer(layer)'), `${plugin}: saved external layers are not restored`);
  assert.ok(backend.includes("entry?.kind === 'external'"), `${plugin}: validation does not distinguish external layers from QGIS layers`);
  assert.ok(backend.includes("...(entry.kind === 'external' ? {"), `${plugin}: preview parser drops external source metadata`);
  assert.ok(backend.includes('external_source_not_found'), `${plugin}: missing registry source validation is absent`);
  assert.ok(backend.includes('/external-services/${encodeURIComponent(sourceId)}'), `${plugin}: generated config does not use the shared proxy`);
}

const hajk = fs.readFileSync('plugins/Qtiler2Hajk/index.js', 'utf8');
const hajkAdmin = fs.readFileSync('plugins/Qtiler2Hajk/admin-ui/app.js', 'utf8');
assert.ok(hajkAdmin.includes('function getPersistedLayerKey(layer, fallbackProjectId)'), 'Hajk editor needs a stable key when restoring persisted layers');
assert.ok(hajkAdmin.includes("return sourceId ? `external::${sourceId}` : '';"), 'Hajk editor must restore external layers by sourceId');
assert.ok(hajkAdmin.includes('.map((layer) => getPersistedLayerKey(layer, mainProjectId))'), 'Hajk editor must use persisted external keys for include and visibility state');
assert.ok(hajk.includes('156543.03392804097 / (2 ** zoomLevel)'), 'Hajk XYZ Web Mercator matrix adapter is missing');
assert.ok(hajk.includes('matrixIds: resolutions.map'), 'Hajk external tile layers require matrix IDs');
assert.ok(hajk.includes("externalType === 'xyz' ? `${proxyBase}/tiles/{z}/{x}/{y}`"), 'Hajk XYZ sources must use the REST tile route');
assert.ok(hajk.includes("const proxyUrl = externalType === 'xyz'\n          ? `${proxyBase}/proxy`"), 'Real Hajk XYZ layers must use the KVP proxy route');
assert.ok(hajk.includes("const activeXyzLayer = (profile.layers || []).find"), 'Real Hajk must select the visible XYZ projection for its map view');
assert.ok(hajk.includes('String(bgTileGrid.crs || \'\').trim().toUpperCase() === String(projCode || \'\').trim().toUpperCase()'), 'Real Hajk must not apply a background tile grid from another CRS to the map view');
assert.ok(hajk.includes('capturedCenter = proj4(capturedCrs, targetCrs, capturedCenter)'), 'Real Hajk must reproject the captured center into the map CRS');
assert.ok(hajk.includes(".map((point) => proj4(capturedCrs, targetCrs, point))"), 'Real Hajk must reproject the captured extent into the map CRS');
assert.ok(hajk.includes('externalLayerMap[externalName] = externalLayer'), 'Hajk must register external services in QWC2 externalLayerMap');
assert.ok(hajk.includes('externalLayerMap,\n      externalLayers: []'), 'Hajk themes must publish the initial-load external layer map');
assert.ok(hajk.includes("? { crs: profile.centerCrs || projectCrs, bounds: capturedExtent }"), 'Hajk must publish the captured viewport and its CRS as initialBbox');
assert.ok(hajk.includes('sourceConfig: {\n                minZoom:'), 'Hajk XYZ layers must pass zoom limits through the OpenLayers sourceConfig');
assert.ok(hajk.includes("id: `external_${sourceId}`"), 'Hajk external layers must have a stable renderer id');

const origo = fs.readFileSync('plugins/Qtiler2Origo/index.js', 'utf8');
assert.ok(origo.includes('tileGrid: webMercatorXyzGrid(layer.maxZoom)'), 'Origo external XYZ layers need their own Web Mercator tile grid');
assert.ok(origo.includes('sourceOptions.projection = sourceOptions.projection || viewer.getProjectionCode()'), 'Origo runtime must preserve the XYZ source projection');
assert.ok(origo.includes('const finalViewExtent = Array.isArray(profile.extent)'), 'Origo must retain the captured published extent');

const hajkClient = fs.readFileSync('plugins/Qtiler2Hajk/admin-ui/app.js', 'utf8');
assert.equal(hajkClient.includes('ensureLayerOrderKeys('), false, 'Hajk must not call the Origo-only layer ordering helper');

console.log('External operational layer contract checks passed.');