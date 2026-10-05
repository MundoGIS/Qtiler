const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = fs.readFileSync('plugins/Qtiler2Origo/admin-ui/app.js', 'utf8');
const runtime = fs.readFileSync('plugins/Qtiler2Origo/client/origo-pattern-fills.js', 'utf8');
const adminCss = fs.readFileSync('plugins/Qtiler2Origo/admin-ui/style.css', 'utf8');

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