const assert = require('node:assert/strict');
const fs = require('node:fs');

const backend = fs.readFileSync('plugins/Qtiler2Hajk/index.js', 'utf8');
const runtime = fs.readFileSync('plugins/Qtiler2Hajk/client/origo-pattern-fills.js', 'utf8');

assert.ok(
  backend.includes("entry.fill?.color || 'rgba(0,0,0,0)'"),
  'Polygon legend must remain transparent when the style has no fill'
);
assert.ok(
  backend.includes('pattern: patternMeta ? normalizedPattern : null'),
  'Hajk runtime rules must carry polygon pattern metadata, not only point icons'
);
assert.ok(
  backend.includes('qtilerPatternV1'),
  'The installed Hajk createStyle patch must render polygon patterns natively'
);
assert.ok(
  runtime.includes('function extractPointStyleRulesFromStyleDef'),
  'Real Hajk runtime must extract point rules with per-rule SVG icons'
);
assert.ok(
  runtime.includes('function buildPointWrappingStyleFunction'),
  'Real Hajk runtime must select and apply point SVG rules'
);
assert.ok(
  runtime.includes('const styleApi = getOlStyleApi();'),
  'Pattern and polygon styling must use OpenLayers directly when window.Origo is unavailable'
);
assert.ok(
  runtime.includes('buildPolygonWrappingStyleFunction(styleName, layer.getStyle(), polygonRules, styleApi)'),
  'Polygon pattern styling must run in the real Hajk application'
);
assert.ok(
  runtime.includes('buildPointWrappingStyleFunction(styleName, layer.getStyle(), pointRules, styleApi)'),
  'Per-rule SVG styling must run in the real Hajk application'
);

console.log('Hajk rule symbology contract checks passed.');