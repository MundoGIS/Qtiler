const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pluginSource = fs.readFileSync(path.resolve('plugins/Qtiler2Hajk/index.js'), 'utf8');
assert.ok(pluginSource.includes('editRefreshPattern'), 'Hajk runtime refresh patch is missing');
assert.ok(pluginSource.includes('String(l||"").match(/(?:^|[?&/])wfs(?:[?&/]|$)/i)'), 'Hajk runtime patch must refresh vector WFS sources');
assert.ok(pluginSource.includes('s.get("caption")'), 'Hajk runtime patch must match visible layer metadata');
assert.ok(pluginSource.includes("isToolEnabled('preset')"), 'Hajk preset tool is not emitted');
assert.ok(pluginSource.includes("isToolEnabled('propertychecker')"), 'Hajk configured-tool filtering is missing');

const cleanupPatchStart = pluginSource.indexOf('    const editCleanupRefreshPattern =');
const cleanupPatchEnd = pluginSource.indexOf('\n', pluginSource.indexOf('    const editCleanupRefreshReplacement =', cleanupPatchStart));
assert.ok(cleanupPatchStart >= 0 && cleanupPatchEnd > cleanupPatchStart, 'Editing cleanup must use the full source refresh');
const cleanupContext = {};
vm.runInNewContext(pluginSource.slice(cleanupPatchStart, cleanupPatchEnd) + '\nglobalThis.patch = source => source.replace(editCleanupRefreshPattern, editCleanupRefreshReplacement);', cleanupContext);
const legacyCleanup = 'refreshEditingLayer(){this.map.getLayers().getArray().filter(layer=>layer.getProperties().caption===this.editSource.caption).forEach(layer=>{const source=layer.getSource();source.clear();source.changed()})}setLayer(e,t){}';
const patchedCleanup = cleanupContext.patch(legacyCleanup);
assert.ok(patchedCleanup.includes('qtilerEditRefreshV3'), 'Legacy editing cleanup must be upgraded');
const model = vm.runInNewContext('(new class {' + patchedCleanup + '})');
const mainSource = { features: ['saved-feature'], loadedExtent: true, refresh() { this.features = []; this.loadedExtent = false; } };
const mainLayer = { visible: true, source: mainSource };
const editOverlay = { name: 'pluginEdit' };
const mapLayers = [mainLayer, editOverlay];
model.editSource = { layers: ['qtiler:areas'], caption: 'Areas' };
model.refreshLayer = name => { assert.equal(name, 'qtiler:areas'); mainSource.refresh(); };
model.refreshEditingLayer();
mapLayers.splice(mapLayers.indexOf(editOverlay), 1);
assert.equal(mainSource.loadedExtent, false, 'Closing editing must leave loaded extents invalidated so visible features can reload');
assert.equal(mapLayers.includes(mainLayer), true, 'Closing editing must not remove the displayed layer');
assert.equal(mainLayer.visible, true, 'The edited layer must remain visible');
model.editSource = undefined;
assert.doesNotThrow(() => model.refreshEditingLayer(), 'Cleanup after closing without a source must be harmless');

const refreshStart = pluginSource.indexOf('    const editRefreshPattern =');
const refreshEnd = pluginSource.indexOf('    for (const filePath of candidates)', refreshStart);
const refreshContext = {};
vm.runInNewContext(pluginSource.slice(refreshStart, refreshEnd) + '\nglobalThis.method = editRefreshReplacementV3;', refreshContext);
const method = refreshContext.method.slice(0, refreshContext.method.indexOf('parseWFSTresponse('));
const refreshModel = vm.runInNewContext('(new class {' + method + '})');
let refreshes = 0;
let unrelatedRefreshes = 0;
const publishedSource = {
  loadedExtent: true, getFeatures: () => [], clear() {},
  refresh() { refreshes++; this.loadedExtent = false; }
};
const publishedLayer = {
  get: key => ({ name: 'qtiler_project_areas', caption: 'Custom areas title' })[key],
  getSource: () => publishedSource,
  getVisible: () => false,
  setVisible: visible => { assert.equal(visible, true); }
};
const unrelatedLayer = { get: () => 'unrelated', getSource: () => ({ getUrl: () => '/wfs', refresh: () => { unrelatedRefreshes++; } }) };
refreshModel.map = { getLayers: () => ({ getArray: () => [publishedLayer, unrelatedLayer] }), updateSize() {} };
refreshModel.editSource = { id: 'qtiler_project_areas_edit', caption: 'Custom areas title' };
refreshModel.refreshLayer('namespace:areas');
assert.equal(refreshes, 1, 'A prefixed Hajk vector layer with a custom title must be fully refreshed');
assert.equal(publishedSource.loadedExtent, false);
assert.equal(unrelatedRefreshes, 0, 'Refreshing one edited layer must not reload unrelated WFS layers');

const staticRoot = path.resolve('data/Qtiler2Hajk/hajk/current/static');
if (fs.existsSync(staticRoot)) {
  const bundles = fs.readdirSync(staticRoot).filter((name) => /^(EditModel|CollectorModel)-.*\.js$/i.test(name));
  assert.ok(bundles.length >= 1, 'No installed Hajk edit bundles found');
  for (const bundle of bundles) {
    const source = fs.readFileSync(path.join(staticRoot, bundle), 'utf8');
    assert.ok(source.includes('qtilerRefreshV3'), `${bundle}: current versioned WFS refresh is missing`);
    if (/^EditModel-/.test(bundle)) {
      assert.ok(source.includes('qtilerEditRefreshV3'), `${bundle}: save-and-close cleanup still uses the legacy clear-only path`);
    }
    assert.ok(source.includes('String(l||"").match(/(?:^|[?&/])wfs(?:[?&/]|$)/i)'), `${bundle}: WFS vector refresh fallback missing`);
    assert.ok(source.includes('s.get("caption")'), `${bundle}: visible layer metadata fallback missing`);
    assert.ok(source.includes('typeof s.refresh=="function"'), `${bundle}: vector source refresh call missing`);
  }
}

console.log('Hajk WFS-T vector refresh checks passed.');