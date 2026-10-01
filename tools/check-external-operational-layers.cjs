const assert = require('node:assert/strict');
const fs = require('node:fs');

const proxy = fs.readFileSync('routes/externalServices.js', 'utf8');
assert.ok(proxy.includes("new Set(['xyz', 'wms', 'wmts'])"), 'Shared registry must support XYZ, WMS, and WMTS');
assert.ok(proxy.includes("'/external-services/:sourceId/proxy'"), 'Shared KVP proxy route is missing');
assert.ok(proxy.includes("'/external-services/:sourceId/tiles/:z/:x/:y'"), 'Shared XYZ tile route is missing');
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
assert.ok(hajk.includes('156543.03392804097 / (2 ** zoomLevel)'), 'Hajk XYZ Web Mercator matrix adapter is missing');
assert.ok(hajk.includes('matrixIds: resolutions.map'), 'Hajk external tile layers require matrix IDs');

console.log('External operational layer contract checks passed.');