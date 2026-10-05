const assert = require('node:assert/strict');
const fs = require('node:fs');

const backend = fs.readFileSync('plugins/Qtiler2Hajk/index.js', 'utf8');
const runtime = fs.readFileSync('plugins/Qtiler2Hajk/client/origo-pattern-fills.js', 'utf8');
const admin = fs.readFileSync('plugins/Qtiler2Hajk/admin-ui/app.js', 'utf8');
const adminCss = fs.readFileSync('plugins/Qtiler2Hajk/admin-ui/style.css', 'utf8');

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
assert.ok(
  backend.includes("'/plugins/Qtiler2Origo/legend-library/'")
    && backend.includes('ALLOWED_LEGEND_LIBRARY_EXTENSIONS.has(path.extname(fileName).toLowerCase())')
    && backend.includes("data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`"),
  'Uploaded SVG and raster assets from either compatible plugin URL must be inlined in multi-rule legends'
);
assert.ok(
  backend.includes('const preloadRemoteLegendSvgIcons = async (entries) =>')
    && backend.includes('await preloadRemoteLegendSvgIcons(remoteLegendEntries);')
    && backend.includes('remoteLegendSvgCache.get(String(src))?.content'),
  'Remote HTTPS SVG rule icons must be bounded, cached, and inlined before composite legends are generated'
);
assert.ok(
  /if \(sub === 'pick'\) \{\r?\n\s+openLegendLibraryPicker\(\(url\) =>/.test(admin),
  'WFS point rules must use the unified uploaded and QGIS SVG picker'
);
assert.ok(
  admin.includes('enableManagedModal(modal);')
    && admin.includes('openManagedModal(modal, null);')
    && /#Qtiler2HajkLegendPicker\s*\{[^}]*z-index:\s*2300/s.test(adminCss),
  'The unified SVG picker must render above the nested WFS rule editor'
);
assert.ok(
  backend.includes("legend: l.thumbnail || undefined"),
  'XYZ layers without thumbnails must omit the legend instead of publishing an empty link'
);

console.log('Hajk rule symbology contract checks passed.');