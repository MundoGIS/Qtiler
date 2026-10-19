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

class LabelStyle {
  constructor(options) { this.options = options; }
  getText() { return this.options.text; }
}
class LabelOption {
  constructor(options) { this.options = options; }
}
const labelApi = { Style: LabelStyle, Text: LabelOption, Fill: LabelOption, Stroke: LabelOption, Circle: LabelOption };
const labelWindow = { ol: { style: labelApi }, addEventListener() {}, setTimeout() {} };
vm.runInNewContext(runtime, { window: labelWindow, document: { body: null }, console });
const labelFeature = status => ({ get: field => ({ status, name: 'Station A', height: 12 })[field] });
const labels = [{ text: '{{name}}\n{{height}} m', minZoom: 1, maxZoom: 2, minResolution: 20, maxResolution: 90, fill: { color: '#111111' }, backgroundFill: { color: 'rgba(255,255,255,0.85)' }, backgroundStroke: { color: '#555555', width: 1 }, padding: [12, 12, 12, 12] }];
const labelRules = [
  { property: 'status', operator: '==', value: 'Positiv', resolutions: [100, 50, 25, 12.5], minResolution: 60, labels },
  { property: 'status', operator: '==', value: 'Negativ', resolutions: [100, 50, 25], labels: [{ text: 'Other rule' }] }
];
const geometryStyle = new LabelStyle({ fill: true });
const labelRender = labelWindow.qtilerHajkRuleLabels;
assert.equal(labelRender(labelFeature('Positiv'), 100, [geometryStyle], labelRules).length, 1, 'Geometry may render while its label is outside the label zoom range');
const labelOnly = labelRender(labelFeature('Positiv'), 50, [geometryStyle], labelRules);
assert.equal(labelOnly.length, 1, 'Labels have a range independent of the rule geometry');
assert.equal(labelOnly[0].getText().options.text, 'Station A\n12 m');
assert.equal(labelOnly[0].getText().options.backgroundFill.options.color, 'rgba(255,255,255,0.85)');
assert.deepEqual(Array.from(labelOnly[0].getText().options.padding), [12, 12, 12, 12]);
assert.equal(labelRender(labelFeature('Positiv'), 25, [geometryStyle], labelRules).length, 1, 'Label zoom endpoints must be inclusive');
assert.equal(labelRender(labelFeature('Positiv'), 12.5, [geometryStyle], labelRules).length, 0, 'Neither labels nor geometry may survive beyond their individual ranges');
assert.equal(labelRender(labelFeature('Negativ'), 50, [geometryStyle], labelRules)[1].getText().options.text, 'Other rule');
assert.equal(labelRender(labelFeature('Unmatched'), 50, [geometryStyle], labelRules).length, 0, 'Labels cannot fall back to a nonmatching rule');
assert.equal(labelRender(labelFeature('Positiv'), 50, [geometryStyle], [{ labels: [{ text: '{{missing}}' }] }]).length, 1, 'Empty attribute labels are omitted');

const editorContext = { currentLayerGeomFamily: 'polygon', getDefaultDesignerPatternOptions: () => ({}) };
const editorStart = admin.indexOf('function defaultRule(');
const editorEnd = admin.indexOf('/* ── Legend icon library', editorStart);
vm.runInNewContext(admin.slice(editorStart, editorEnd), editorContext);
const editorRule = editorContext.defaultRule('polygon');
Object.assign(editorRule.label, { enabled: true, text: '{{name}}', minZoom: 0, maxZoom: 12, maxScale: 50000, minScale: 1000, background: true, spacing: 15, haloWidth: 0, backgroundOpacity: 0, repeat: 300 });
editorRule.maxScale = 100000;
const editorStyle = editorContext.rulesToOrigoStyle([editorRule]);
const restoredRule = editorContext.origoStyleToRules(editorStyle)[0];
for (const key of ['minZoom', 'maxZoom', 'minScale', 'maxScale', 'spacing', 'haloWidth', 'backgroundOpacity', 'repeat']) {
  assert.equal(restoredRule.label[key], editorRule.label[key], `Label ${key} must survive saving and reopening, including zero`);
}
assert.equal(restoredRule.maxScale, 100000, 'Geometry visibility must not be overwritten by label visibility');
assert.equal(restoredRule.label.visibilityMode, 'both', 'Existing styles with zoom and scale limits must keep their combined behavior');
const modeRule = editorContext.defaultRule('polygon');
Object.assign(modeRule.label, { enabled: true, text: '{{name}}', visibilityMode: 'zoom', minZoom: 2, maxZoom: 12, minScale: 1000, maxScale: 50000 });
let modeStyle = editorContext.rulesToOrigoStyle([modeRule])[0][1];
assert.equal(modeStyle.text.minZoom, 2);
assert.equal(modeStyle.minScale, undefined, 'Hidden scale limits must not restrict Zoom mode');
assert.equal(modeStyle.maxScale, undefined);
modeRule.label.visibilityMode = 'scale';
modeStyle = editorContext.rulesToOrigoStyle([modeRule])[0][1];
assert.equal(modeStyle.maxScale, 50000);
assert.equal(modeStyle.text.minZoom, undefined, 'Hidden zoom limits must not restrict Scale mode');
assert.equal(modeStyle.text.maxZoom, undefined);
assert.equal(editorContext.origoStyleToRules([[{}, modeStyle]])[0].label.visibilityMode, 'scale');
assert.equal(editorContext.getRuleVisibilityMode({}), 'zoom', 'New rules must default to a single visibility mode');
assert.equal(editorContext.getRuleVisibilityMode({ minScale: '', maxScale: 50000 }), 'scale', 'Existing scale-only rules must open in Scale mode');
const visibilityStart = admin.indexOf('function buildRuleVisibilityMarkup(');
const visibilityEnd = admin.indexOf('\nfunction syncRuleEditorSections(', visibilityStart);
editorContext.t = key => key;
vm.runInNewContext(admin.slice(visibilityStart, visibilityEnd), editorContext);
const visibilityMarkup = editorContext.buildRuleVisibilityMarkup(modeRule.label, 'lab', true);
assert.ok(/data-visibility-fields="zoom" hidden/.test(visibilityMarkup), 'Inactive visibility limits must be hidden');
assert.equal((visibilityMarkup.match(/data-rk="lab\.minZoom"/g) || []).length, 1, 'Visibility controls must not be duplicated');
assert.ok(admin.includes('class="Qtiler2Hajk-rule-toggle"'), 'Checkboxes need an inline control layout');
assert.ok(admin.includes('data-background-settings'), 'Background options must have a conditional group');
assert.ok(adminCss.includes('.Qtiler2Hajk-rule-editor-shell input[type="color"]'), 'The detached editor must style its own swatches without relying on the parent publish modal');

const conversionContext = {
  getHajkLegendStyleEntries: style => style.flat().filter(entry => !entry.text),
  parseQtilerRuleFilter: () => null,
  scaleDenominatorToResolution: denominator => denominator > 0 ? denominator * 0.00028 : null
};
const converterStart = backend.indexOf('  const toHajkRuntimeStyleRules =');
const converterEnd = backend.indexOf('\n  const sldScale =', converterStart);
vm.runInNewContext(backend.slice(converterStart, converterEnd) + '\nglobalThis.convert = toHajkRuntimeStyleRules;', conversionContext);
const converted = conversionContext.convert(editorStyle, '', [100, 50, 25], 'EPSG:3006');
assert.equal(converted[0].labels[0].text, '{{name}}');
assert.equal(converted[0].labels[0].minZoom, 0);
assert.ok(Math.abs(converted[0].labels[0].maxResolution - 14) < 1e-9);
assert.ok(Math.abs(converted[0].maxResolution - 28) < 1e-9);
console.log('Hajk per-rule label visibility, styling and round-trip checks passed.');

class SymbolOption {
  constructor(options) { this.options = options; }
  getDeclutterMode() { return this.options.declutterMode; }
  getSize() { return this.dimensions || null; }
  setScale(scale) { this.options.scale = scale; }
  listenImageChange(listener) { this.onLoad = listener; }
}
class SymbolStyle {
  constructor(options) { this.options = options; }
  getImage() { return this.options.image; }
  getText() { return this.options.text; }
  getStroke() { return this.options.stroke; }
  setImage(image) { this.options.image = image; }
  clone() { return new SymbolStyle({ ...this.options }); }
}
const symbolWindow = {
  ol: { style: { Style: SymbolStyle, Fill: SymbolOption, Stroke: SymbolOption, Circle: SymbolOption, RegularShape: SymbolOption, Icon: SymbolOption, Text: SymbolOption } },
  addEventListener() {}, setTimeout() {}
};
vm.runInNewContext(runtime, { window: symbolWindow, document: { body: null }, console });
const realPointFeature = { ...labelFeature('any'), getGeometry: () => ({ getType: () => 'Point' }) };
const legacyTriangle = new SymbolStyle({ image: new SymbolOption({ points: 3, radius: 8, declutterMode: 'none' }) });
assert.equal(symbolWindow.qtilerHajkRuleLabels(realPointFeature, 1, [legacyTriangle], [{ hasStroke: true, strokeWidth: 0.5 }])[0], legacyTriangle, 'Old Hajk configs without regularShape metadata must not replace a point triangle with polygon stroke/fill');
const nativeUntintedIcon = {
  getScale: () => 0.05, getRotation: () => 0, getRotateWithView: () => false,
  getSrc: () => '/native-marker.png', getOpacity: () => 1, getColor: () => null,
  getAnchor: () => [240, 240], getSize: () => [480, 480], getOrigin: () => [0, 0]
};
const nativeIconResult = symbolWindow.qtilerHajkRuleLabels(realPointFeature, 1, [new SymbolStyle({ image: nativeUntintedIcon })], [{ icon: '/native-marker.png' }]);
assert.equal(nativeIconResult[0].getImage().options.color, undefined, 'Cloning a native untinted Hajk icon must omit null color, which crashes OpenLayers color parsing');
editorContext.currentLayerGeomFamily = 'point';
for (const shape of [
  { points: 3, radius: 9, angle: 0 },
  { points: 4, radius: 9, angle: Math.PI / 4 },
  { points: 5, radius: 9, radius2: 4, angle: 0 }
]) {
  const style = [[{ regularShape: { ...shape, fill: { color: '#22aa44' }, stroke: { color: '#112233', width: 0 } } }]];
  const restored = editorContext.origoStyleToRules(style);
  const saved = editorContext.rulesToOrigoStyle(restored);
  assert.equal(saved[0][0].regularShape.points, shape.points, 'Designer shapes must not become circles when a rule is reopened');
  assert.equal(saved[0][0].regularShape.radius2, shape.radius2);
  assert.equal(saved[0][0].regularShape.angle, shape.angle);
  assert.equal(saved[0][0].regularShape.stroke.width, 0);
  const runtimeRule = conversionContext.convert(saved)[0];
  assert.equal(runtimeRule.regularShape.points, shape.points);
  const rendered = symbolWindow.qtilerHajkRuleLabels(labelFeature('any'), 1, [], [runtimeRule]);
  assert.equal(rendered[0].getImage().options.points, shape.points);
  assert.equal(rendered[0].getImage().options.radius2, shape.radius2);
  assert.equal(rendered[0].getImage().options.radius, 9);
  assert.equal(rendered[0].getImage().options.stroke.options.width, 0);
}
for (const dimensions of [[480, 480], [20000, 10000], [20, 2000]]) {
  const iconOptions = { src: `test-${dimensions.join('x')}.svg`, scale: 1, pixelSize: 28, opacity: 0.4, anchor: [0.2, 0.9], color: '#ff0000' };
  const rendered = symbolWindow.qtilerHajkRuleLabels(labelFeature('any'), 1, [], [{ iconOptions, labels: [] }]);
  const image = rendered[0].getImage();
  image.dimensions = dimensions;
  image.onLoad();
  assert.equal(Math.max(...dimensions) * image.options.scale, 28, 'SVG pixel size must not depend on its intrinsic dimensions');
  assert.equal(image.options.opacity, 0.4);
  assert.deepEqual(Array.from(image.options.anchor), [0.2, 0.9]);
  assert.equal(image.options.color, '#ff0000');
}
const lineStyle = symbolWindow.qtilerHajkRuleLabels(labelFeature('any'), 1, [], [{ hasStroke: true, strokeColor: '#abcdef', strokeWidth: 0, lineDash: [8, 6] }])[0];
const coloredIcon = symbolWindow.qtilerHajkRuleLabels(labelFeature('any'), 1, [], [{ iconOptions: { src: '/qgis-svg-colored/marker.svg?color=%23228855', color: '#228855', pixelSize: 24 } }])[0].getImage();
assert.equal(coloredIcon.options.color, undefined, 'Already-colored QGIS SVGs must not be tinted again by OpenLayers');
assert.equal(lineStyle.getStroke().options.width, 0);
assert.deepEqual(Array.from(lineStyle.getStroke().options.lineDash), [8, 6]);

const legendContext = { svgAttr: String, xmlEscape: String, toAbsoluteHajkIconSrc: source => source, inlineSvgIconForLegend: () => '<svg/>', legendDashAttr: () => '' };
const legendStart = backend.indexOf('  const hajkLegendSymbolSvg =');
const legendEnd = backend.indexOf('\n  const toHajkVectorRuleLegendIcon =', legendStart);
vm.runInNewContext(backend.slice(legendStart, legendEnd) + '\nglobalThis.legend = hajkLegendSymbolSvg;', legendContext);
for (const [shape, vertices] of [[{ points: 3, radius: 9 }, 3], [{ points: 4, radius: 9, angle: Math.PI / 4 }, 4], [{ points: 5, radius: 9, radius2: 4 }, 10]]) {
  const symbol = legendContext.legend({ regularShape: { ...shape, fill: { color: '#22aa44' }, stroke: { color: '#112233', width: 0 } } });
  assert.ok(symbol.body.includes('<polygon'));
  assert.equal(symbol.body.match(/points="([^"]+)"/)[1].split(' ').length, vertices, 'Legend must draw the same shape as the map');
  assert.ok(symbol.body.includes('stroke-width="0"'));
}
assert.ok(legendContext.legend({ icon: { src: 'marker.svg', opacity: 0.4 } }).body.includes('opacity="0.4"'), 'SVG legend must preserve the map opacity');
const prepareStart = backend.indexOf('  const prepareInlineSvgContent =');
const prepareEnd = backend.indexOf('\n  const remoteLegendSvgCache =', prepareStart);
vm.runInNewContext(backend.slice(prepareStart, prepareEnd) + '\nglobalThis.prepare = prepareInlineSvgContent;', legendContext);
const qgisSvg = '<svg width="4000" height="2000"><path fill="param(fill) #ff0000" stroke="param(outline) #123456" stroke-width="param(outline-width) 0.5" d="M0 0L4 4"/></svg>';
assert.ok(!legendContext.prepare(qgisSvg).includes('param('), 'QGIS SVG defaults must render without QGIS parameter syntax');
assert.ok(legendContext.prepare(qgisSvg, '#00ff00').includes('fill="#00ff00"'), 'Map and legend must use the same SVG color normalization');
assert.ok(backend.includes("prepareInlineSvgContent(await fs.promises.readFile(filePath, 'utf8'), req.query.color)"), 'Map SVG endpoint must share the legend normalizer');
console.log('Hajk point shape, SVG pixel sizing and legend parity checks passed.');

const categoryPaints = [];
let pendingCategoryPaint;
let categoryImageReady = false;
const categoryCanvasContext = { clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, drawImage(...args) { categoryPaints.push(args); } };
const categoryImage = {
  getImageState: () => categoryImageReady ? 2 : 1,
  getImage: () => ({ width: 40, height: 40 }),
  getRotation: () => 0,
  getOpacity: () => 0.6,
  listenImageChange: listener => { pendingCategoryPaint = listener; },
  unlistenImageChange() {}, load() {}
};
const categorySwatchContext = {
  getOlStyleApi: () => ({}),
  createPointStyle: rule => {
    assert.equal(rule.regularShape.points, 3, 'Category swatches must receive the original regular shape');
    return { getImage: () => categoryImage };
  },
  document: { createElement: tag => ({ tag, style: {}, setAttribute() {}, getContext: () => categoryCanvasContext }) }
};
const swatchStart = runtime.indexOf('  function createCategorySwatch(');
const swatchEnd = runtime.indexOf('  function mountCategoryControls(', swatchStart);
vm.runInNewContext(runtime.slice(swatchStart, swatchEnd), categorySwatchContext);
const categoryCanvas = categorySwatchContext.createCategorySwatch({ regularShape: { points: 3, radius: 8 } });
assert.equal(categoryCanvas.tag, 'canvas', 'Regular shape category symbols must not be replaced by empty spans');
assert.equal(categoryPaints.length, 0, 'Pending icon images must not be drawn before decoding');
categoryImageReady = true;
pendingCategoryPaint();
assert.equal(categoryPaints.length, 1, 'Category icon must paint when its image finishes loading');
assert.equal(categoryCanvasContext.globalAlpha, 0.6, 'Category swatch opacity must match the rendered point symbol');
assert.equal(categoryPaints[0][3], 40, 'Category image must fit inside the swatch without stretching');
console.log('Hajk category symbol canvas and asynchronous image checks passed.');

async function checkInstalledLabelPatch() {
  const assetRoot = 'data/Qtiler2Hajk/hajk/current/static';
  if (!fs.existsSync(assetRoot)) return;
  const assetName = fs.readdirSync(assetRoot).find(name => /^app-core-.*\.js$/.test(name));
  if (!assetName) return;
  let patchedBundle = fs.readFileSync(`${assetRoot}/${assetName}`, 'utf8');
  const patchStart = backend.indexOf('  const patchHajkRuntimeVectorIcons = async () =>');
  const patchEnd = backend.indexOf('\n  await patchHajkRuntimeVectorIcons();', patchStart);
  const context = {
    path: require('node:path'), installRoot: '/fixture', pluginSlug: 'Qtiler2Hajk', console,
    fs: { promises: {
      readdir: async () => [{ name: assetName, isDirectory: () => false }],
      readFile: async () => patchedBundle,
      writeFile: async (file, content) => { patchedBundle = content; }
    } }
  };
  vm.runInNewContext(backend.slice(patchStart, patchEnd) + '\nglobalThis.patch = patchHajkRuntimeVectorIcons;', context);
  await context.patch();
  assert.ok(patchedBundle.includes('function Q(feature,resolution){return window.qtilerHajkRuleLabels'), 'Installed Hajk must invoke the label renderer with its real resolution');
  const firstPatchedBundle = patchedBundle;
  await context.patch();
  assert.equal(patchedBundle, firstPatchedBundle, 'Repeated worker registration must not duplicate the native label wrapper');
  const syntax = require('node:child_process').spawnSync(process.execPath, ['--input-type=module', '--check'], { input: patchedBundle, encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  console.log('Installed Hajk native label patch syntax and idempotence checks passed.');
}
checkInstalledLabelPatch().catch(error => { console.error(error); process.exitCode = 1; });