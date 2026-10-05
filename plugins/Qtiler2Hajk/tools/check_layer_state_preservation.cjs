const assert = require('node:assert/strict');
const fs = require('node:fs');

for (const plugin of ['Qtiler2Origo', 'Qtiler2Hajk']) {
  const app = fs.readFileSync(`plugins/${plugin}/admin-ui/app.js`, 'utf8');

  assert.ok(
    app.includes('const sameMainProject = (publishState.mainLayers || [])'),
    `${plugin}: reloading the same main project must detect it to preserve state`
  );
  assert.ok(
    app.includes('mergedRules[key] = { ...(discoveredRules[key] || {}), ...previousRules[key] };'),
    `${plugin}: per-layer rules (wfsStyle, legend, attributes) must survive a project reload`
  );
  assert.ok(
    app.includes('return [key, previousVisibility[key] !== false];'),
    `${plugin}: layer visibility must survive a project reload`
  );
  assert.ok(
    app.includes('.filter((key) => key && previousTitles[key])'),
    `${plugin}: custom layer titles must survive a project reload`
  );

  const applyHandler = app.slice(app.indexOf('await addExternalLayers(projectId, selectedItems);'));
  assert.ok(
    applyHandler.includes('const checkedNames = new Set(getCheckedLayerNames(projectLayersList));'),
    `${plugin}: adding external layers must not clear the current layer selection`
  );
  assert.ok(
    applyHandler.includes('setCheckedLayerNames(projectLayersList, Array.from(checkedNames));'),
    `${plugin}: adding external layers must restore the previous selection`
  );

  assert.ok(
    app.includes('const existingRule = publishState.mainRules[layerKey] || {};'),
    `${plugin}: re-adding an external layer must keep its existing rule fields`
  );

  const backend = fs.readFileSync(`plugins/${plugin}/index.js`, 'utf8');
  assert.ok(
    backend.includes('const readQgisProjectLayerNames = (projectFile) => {'),
    `${plugin}: publish validation must be able to read live QGIS project layers`
  );
  assert.ok(
    backend.includes('if (!requireTileGrid && await hasLiveProjectLayer(pid, name, theme)) return null;'),
    `${plugin}: WMS/WFS layers served live must publish without a cache index entry`
  );
  assert.ok(
    backend.includes("for (const match of xml.matchAll(/<visibility-preset\\b[^>]*name=\"([^\"]*)\"/gi)) {"),
    `${plugin}: QGIS map themes must also be resolvable from the project file`
  );
}

const hajk = fs.readFileSync('plugins/Qtiler2Hajk/index.js', 'utf8');
const hajkApp = fs.readFileSync('plugins/Qtiler2Hajk/admin-ui/app.js', 'utf8');
assert.ok(hajk.includes('qtilerRefreshV2'), 'Hajk WFS-T refresh patch must be versioned so old installs get re-patched');
assert.ok(hajk.includes('!i.getVisible()&&i.setVisible(!0)'), 'Hajk WFS-T refresh must keep the edited layer visible');
assert.ok(hajk.includes('typeof s.getFeatures=="function"&&typeof s.clear=="function"&&s.clear(!0)'), 'Hajk WFS-T refresh must clear cached vector features before reloading');
assert.ok(hajkApp.includes('data-layer-info='), 'Hajk editor must expose per-layer details text');
assert.ok(hajkApp.includes('infoText: String(publishState.layerInfo[key] || \'\').trim()'), 'Hajk editor must publish per-layer details text');
assert.ok(
  (hajkApp.match(/infoText: String\(publishState\.layerInfo\[/g) || []).length >= 4,
  'Hajk publish, preview, preflight and JSON payloads must all preserve per-layer details text'
);
assert.ok(hajk.includes("infoText: String(l.infoText || '').trim() || undefined"), 'Hajk layer switcher refs must receive infoText');
assert.ok(
  (hajk.match(/infoText: String\(l\.infoText \|\| ''\)\.trim\(\) \|\| undefined/g) || []).length >= 5,
  'Hajk vector, WMS, WMTS and layer switcher definitions must all receive infoText'
);
assert.ok(
  (hajk.match(/infoText: String\(layer\.infoText \|\| ''\)\.trim\(\)/g) || []).length >= 3,
  'Hajk WFS, WMS and external normalization must preserve published layer infoText'
);
assert.ok(hajkApp.includes('publishState.layerOrder = keys;'), 'Hajk editor must retain the user-defined layer order');
assert.ok(hajkApp.includes('const selected = getOrderedHajkToolDefs()'), 'Hajk editor must serialize tools in their visible order');
assert.ok(hajk.includes('tools.sort((a, b) => (toolOrder.get(a.type)'), 'Hajk config must honor the profile tool order');

console.log('Layer state preservation checks passed for Qtiler2Origo and Qtiler2Hajk.');
