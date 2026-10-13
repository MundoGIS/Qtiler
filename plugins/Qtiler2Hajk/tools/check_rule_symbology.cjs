const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const backend = fs.readFileSync('plugins/Qtiler2Hajk/index.js', 'utf8');
const runtime = fs.readFileSync('plugins/Qtiler2Hajk/client/origo-pattern-fills.js', 'utf8');
const admin = fs.readFileSync('plugins/Qtiler2Hajk/admin-ui/app.js', 'utf8');
const adminCss = fs.readFileSync('plugins/Qtiler2Hajk/admin-ui/style.css', 'utf8');

const strictRulePatchStart = backend.indexOf('      next = next.replace(/\\}\\)\\|\\|U');
const strictRulePatchEnd = backend.indexOf('\n      if (next !== raw)', strictRulePatchStart);
assert.ok(strictRulePatchStart >= 0, 'Runtime patch must remove implicit first-rule fallbacks');
const strictRuleContext = { next: 'function Q(feature){const U=rules;const G=U.find(Z=>{return !Z.property||feature.status===Z.value})||U.find(Z=>!Z.property)||U[0];return G?[G]:[];}' };
vm.runInNewContext(backend.slice(strictRulePatchStart, strictRulePatchEnd), strictRuleContext);
vm.runInNewContext(`${strictRuleContext.next};globalThis.selectRule=Q;`, strictRuleContext);
strictRuleContext.rules = [{ property: 'status', value: 'Positiv' }];
assert.equal(strictRuleContext.selectRule({ status: 'Ej aktuell' }).length, 0, 'Unmatched categories must not render');
assert.equal(strictRuleContext.selectRule({ status: 'Positiv' }).length, 1, 'Selected categories must render');
strictRuleContext.rules.push({});
assert.equal(strictRuleContext.selectRule({ status: 'Ej aktuell' }).length, 1, 'An explicit default rule must still render');

const wrapperContext = {};
const filterStart = runtime.indexOf('  function evaluateFilterExpression(');
const filterEnd = runtime.indexOf('  function getStyleArray(', filterStart);
const selectorStart = runtime.indexOf('  function selectStyleRule(');
const selectorEnd = runtime.indexOf('  function createPolygonStyle(', selectorStart);
vm.runInNewContext(runtime.slice(runtime.indexOf('  function normalizeColorSignature('), runtime.indexOf('  function getOrigoApi(')) + runtime.slice(filterStart, filterEnd) + runtime.slice(selectorStart, selectorEnd), wrapperContext);
const positiveRule = { filter: "[status] == 'Positiv'" };
const inactiveFeature = { get: () => 'Ej aktuell' };
assert.equal(wrapperContext.selectStyleRule([positiveRule], inactiveFeature, null), null, 'A single filtered polygon rule must not become a default');
assert.equal(wrapperContext.selectStyleRule([positiveRule, { filter: "[status] == 'Negativ'" }], inactiveFeature, null), null, 'Polygon wrappers must not revive unmatched categories');
assert.equal(wrapperContext.selectStyleRule([positiveRule], { get: () => 'Positiv' }, null), positiveRule);

const categoryStart = runtime.indexOf('  function buildCategoryStyleFunction(');
const categoryEnd = runtime.indexOf('  function mountCategoryControls(', categoryStart);
vm.runInNewContext(runtime.slice(categoryStart, categoryEnd), wrapperContext);
const categoryState = { rules: [{ index: 0, filter: "[status] == 'Positiv'" }, { index: 1, filter: "[status] == 'Negativ'" }, { index: 2, filter: '' }], disabled: new Set() };
const categoryStyle = wrapperContext.buildCategoryStyleFunction(() => ['geometry', 'label'], categoryState);
assert.equal(categoryStyle({ get: () => 'Positiv' }).length, 2);
categoryState.disabled.add(1);
assert.equal(categoryStyle({ get: () => 'Negativ' }).length, 0, 'Disabled categories must not fall through to a default or retain labels');
categoryState.disabled.add(0);
categoryState.disabled.add(2);
assert.equal(categoryStyle({ get: () => 'Positiv' }).length, 0, 'Disabling every category must hide all geometries and labels');
categoryState.disabled.delete(0);
assert.equal(categoryStyle({ get: () => 'Positiv' }).length, 2, 'Categories must be re-enabled without reloading WFS');
assert.equal(categoryStyle({ get: () => 'Negativ' }).length, 0, 'Only Positiv should be visible when other categories are off');

const nativeStyle = () => [{ nativeHajkStyle: true }];
let activeNativeStyle = nativeStyle;
const nativeLayer = {
  get: key => ({ name: 'native_layer', caption: 'Native layer' })[key],
  getProperties: () => ({ name: 'native_layer' }),
  getStyle: () => activeNativeStyle,
  setStyle: style => { activeNativeStyle = style; }
};
const nativeWindow = {
  hajkPublicApi: { olMap: { getLayers: () => [nativeLayer] } },
  addEventListener: () => {},
  setTimeout: () => {}
};
vm.runInNewContext(runtime, { window: nativeWindow, document: { body: null }, console });
nativeWindow.Qtiler2HajkOrigoBoot.applyRuntimePatternStyles(null, {
  styles: { native_style: [[{ filter: "[status] == 'Positiv'", legendLabel: 'Positiv', fill: { color: '#00ff00' } }]] },
  layersConfig: { vectorlayers: [{ id: 'native_layer', caption: 'Native layer', style: 'native_style' }] }
});
assert.notEqual(activeNativeStyle, nativeStyle, 'Native Hajk must register category controls without window.ol or window.Origo');
assert.equal(activeNativeStyle({ get: () => 'Positiv' }, 1)[0].nativeHajkStyle, true, 'Native Hajk style objects must be preserved');
assert.equal(activeNativeStyle({ get: () => 'Ej aktuell' }, 1).length, 0, 'Strict category filtering must work without global OpenLayers');

const dashStart = admin.indexOf('function dashKeyToArray(key) {');
const dashEnd = admin.indexOf('\nfunction dashArrayToKey(', dashStart);
assert.ok(dashStart >= 0 && dashEnd > dashStart, 'WFS editor dash converter must exist');
const dashContext = {};
vm.runInNewContext(`${admin.slice(dashStart, dashEnd)}\nglobalThis.dashKeyToArray = dashKeyToArray;`, dashContext);
assert.deepEqual(Array.from(dashContext.dashKeyToArray('solid')), [], 'Solid WFS strokes must use a valid empty OpenLayers dash array');
assert.deepEqual(Array.from(dashContext.dashKeyToArray('dashed')), [8, 6], 'Dashed WFS strokes must retain their dash pattern');
const rewriteStart = backend.indexOf("const rewriteSvgIconColors = (style, baseUrl = '') => {");
const rewriteEnd = backend.indexOf('\n  const normalizeInfoclickAttributes', rewriteStart);
assert.ok(rewriteStart >= 0 && rewriteEnd > rewriteStart, 'Hajk style normalization helper must exist');
const rewriteContext = {};
vm.runInNewContext(`${backend.slice(rewriteStart, rewriteEnd)}\nglobalThis.rewriteSvgIconColors = rewriteSvgIconColors;`, rewriteContext);
assert.deepEqual(JSON.parse(JSON.stringify(rewriteContext.rewriteSvgIconColors([[{ stroke: { lineDash: [0] } }]]))), [[{ stroke: { lineDash: [] } }]], 'Published Hajk styles must repair already-saved solid dash patterns');

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