const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const admin = fs.readFileSync('plugins/Qtiler2Origo/admin-ui/app.js', 'utf8');
const runtime = fs.readFileSync('plugins/Qtiler2Origo/client/origo-pattern-fills.js', 'utf8');
const adminCss = fs.readFileSync('plugins/Qtiler2Origo/admin-ui/style.css', 'utf8');
const backend = fs.readFileSync('plugins/Qtiler2Origo/index.js', 'utf8');

const dashStart = admin.indexOf('function dashKeyToArray(key) {');
const dashEnd = admin.indexOf('\nfunction dashArrayToKey(', dashStart);
assert.ok(dashStart >= 0 && dashEnd > dashStart, 'WFS editor dash converter must exist');
const dashContext = {};
vm.runInNewContext(`${admin.slice(dashStart, dashEnd)}\nglobalThis.dashKeyToArray = dashKeyToArray;`, dashContext);
assert.deepEqual(Array.from(dashContext.dashKeyToArray('solid')), [], 'Solid WFS strokes must use a valid empty OpenLayers dash array');
assert.deepEqual(Array.from(dashContext.dashKeyToArray('dashed')), [8, 6], 'Dashed WFS strokes must retain their dash pattern');
const rewriteStart = backend.indexOf('const rewriteSvgIconColors = (style) => {');
const rewriteEnd = backend.indexOf('\n  const resolveManualWmsLegendUrl', rewriteStart);
assert.ok(rewriteStart >= 0 && rewriteEnd > rewriteStart, 'Origo style normalization helper must exist');
const rewriteContext = { normalizeOrigoIconStyle: (icon) => icon };
vm.runInNewContext(`${backend.slice(rewriteStart, rewriteEnd)}\nglobalThis.rewriteSvgIconColors = rewriteSvgIconColors;`, rewriteContext);
assert.deepEqual(JSON.parse(JSON.stringify(rewriteContext.rewriteSvgIconColors([[{ stroke: { lineDash: [0] } }]]))), [[{ stroke: { lineDash: [] } }]], 'Published Origo styles must repair already-saved solid dash patterns');

assert.ok(
  /if \(sub === 'pick'\) \{\r?\n\s+openLegendLibraryPicker\(\(url\) =>/.test(admin),
  'Origo WFS point rules must use the unified uploaded and QGIS SVG picker'
);
assert.ok(
  admin.includes('enableManagedModal(modal);')
    && admin.includes('openManagedModal(modal, null);')
    && /#Qtiler2OrigoLegendPicker\s*\{[^}]*z-index:\s*2300/s.test(adminCss),
  'The unified Origo SVG picker must render above the nested WFS rule editor'
);
assert.ok(
  runtime.includes('function extractPointStyleRulesFromStyleDef'),
  'Origo runtime must extract conditional point SVG rules'
);
assert.ok(
  runtime.includes('buildPointWrappingStyleFunction(styleName, layer.getStyle(), pointRules, origo)'),
  'Origo runtime must apply the matching point SVG rule'
);

console.log('Origo rule symbology contract checks passed.');