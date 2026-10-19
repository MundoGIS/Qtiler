const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve('plugins/Qtiler2Hajk/index.js'), 'utf8');
const start = source.indexOf('const toHajkEditableField =');
const end = source.indexOf('\n\n  const hajkInfoboxPlaceholder', start);
assert.ok(start >= 0 && end > start, 'Could not locate toHajkEditableField');
const context = {};
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}; globalThis.convert = toHajkEditableField;`, context);

assert.deepEqual(
  JSON.parse(JSON.stringify(context.convert({ name: 'status', title: 'Status', type: 'dropdown', options: ['Open', 'Closed', 'Open', ' '] }))),
  { name: 'status', alias: 'Status', textType: 'lista', values: ['Open', 'Closed'], hidden: false }
);
assert.equal(context.convert({ name: 'empty', type: 'dropdown', options: [] }).textType, 'fritext');
assert.equal(context.convert({ name: 'active', type: 'checkbox' }).textType, 'boolean');
assert.equal(context.convert({ name: 'created', type: 'date' }).textType, 'datum');
assert.equal(context.convert({ name: 'updated', type: 'datetime' }).textType, 'date-time');
assert.equal(context.convert({ name: 'amount', type: 'number' }).textType, 'nummer');
assert.equal(context.convert({ name: 'count', type: 'integer' }).textType, 'heltal');
assert.equal(context.convert({ name: 'website', type: 'url' }).textType, 'url');
assert.equal(context.convert({ name: 'notes', type: 'textarea' }).textType, 'fritext');
assert.equal(context.convert({ name: 'secret', type: 'hidden' }).hidden, true);
assert.equal(context.convert({ name: '' }), null);
assert.ok(source.includes('namedAttributes.map(toHajkEditableField)'), 'Generated wfstlayers do not use typed editable fields');

const geometryStart = source.indexOf('  const toHajkEditableGeometry =');
const geometryEnd = source.indexOf('  const toHajkEditableField =', geometryStart);
assert.ok(geometryStart >= 0 && geometryEnd > geometryStart, 'Edit geometry flags must be generated');
vm.runInContext(source.slice(geometryStart, geometryEnd) + '\nglobalThis.geometryFlags = toHajkEditableGeometry;', context);
for (const [type, flag] of [
  ['Point', 'editPoint'], ['PointZ', 'editPoint'], ['PointZM', 'editPoint'],
  ['MultiPoint', 'editMultiPoint'], ['MultiPoint25D', 'editMultiPoint'],
  ['LineString', 'editLine'], ['LineStringM', 'editLine'],
  ['MultiLineStringZ', 'editMultiLine'], ['Polygon', 'editPolygon'],
  ['MultiPolygonZM', 'editMultiPolygon']
]) {
  const flags = context.geometryFlags(type);
  assert.equal(flags[flag], true, `${type} must enable its matching creation tool`);
  assert.equal(Object.values(flags).filter(Boolean).length, 1, `${type} must not enable incompatible geometry tools`);
}
assert.equal(Object.values(context.geometryFlags('GeometryCollection')).some(Boolean), false, 'Unknown geometry must not enable every drawing type');
assert.equal(Object.values(context.geometryFlags(undefined)).some(Boolean), false, 'Missing geometry must fail closed');
assert.ok(source.includes('...toHajkEditableGeometry(l.geometryType)'), 'Geometry flags must be attached to wfstlayers, which Hajk copies into edit sources');

const infoboxStart = source.indexOf('  const normalizeInfoclickAttributes =');
const infoboxEnd = source.indexOf('  const shouldUseWfsForPublishedLayer =', infoboxStart);
assert.ok(infoboxStart >= 0 && infoboxEnd > infoboxStart, 'Infoclick helpers must be available');
const infoboxContext = {};
vm.runInNewContext(source.slice(infoboxStart, infoboxEnd) + '\nglobalThis.build = buildHajkInfobox;globalThis.options = getHajkInfoclickOptions;', infoboxContext);
const iconHtml = "<div style='margin-bottom: 10px;'><a href='{{bild}}' target='_blank' title='Visa Fotomontage'><img src='https://example.org/camera.svg' style='width: 32px; height: 32px;'></a><a href='{{pano}}' target='_blank'><img src='https://example.org/pano.svg'></a></div>";
const iconTemplate = infoboxContext.build([{ html: iconHtml }]);
assert.ok(iconTemplate.includes("href='{bild}'") && iconTemplate.includes("href='{pano}'"), 'Origo HTML placeholders must be converted to native Hajk placeholders');
assert.ok(iconTemplate.includes("style='width: 32px; height: 32px;'"), 'Custom image icon dimensions must survive generation');
assert.equal(infoboxContext.options([{ attributes: [{ html: iconHtml }] }], { allowDangerousHtml: false }).allowDangerousHtml, true, 'Authored HTML must not be disabled by saved control defaults');
assert.equal(infoboxContext.options([{ attributes: [{ name: 'status' }] }], { allowDangerousHtml: false }).allowDangerousHtml, false, 'Text-only maps must not enable raw HTML unnecessarily');
const imageTemplate = infoboxContext.build([{ name: 'bild', title: 'Foto:', type: 'image' }]);
assert.ok(imageTemplate.includes('[![Foto]({bild})]({bild})'), 'Image fields must render a photo preview linked to the original');
assert.ok(infoboxContext.build([{ name: 'website', type: 'url' }]).includes('[{website}]({website})'), 'URL fields must render links');
assert.ok(infoboxContext.build([{ name: 'bild', type: 'image', url: 'https://example.org/{{bild}}' }]).includes('https://example.org/{bild}'), 'Image URL templates must substitute fields');
assert.ok(infoboxContext.build([{ html: iconHtml }, { name: 'status' }]).includes('</div>\n\n**status:**'), 'HTML blocks must be separated from subsequent Markdown attributes');

const staticRoot = path.resolve('data/Qtiler2Hajk/hajk/current/static');
if (fs.existsSync(staticRoot)) {
  const views = fs.readdirSync(staticRoot).filter((name) => /^(EditView|CollectorView)-.*\.js$/i.test(name));
  assert.ok(views.length > 0, 'No installed Hajk edit views found');
  assert.ok(views.some((name) => fs.readFileSync(path.join(staticRoot, name), 'utf8').includes('case"lista"')), 'Installed Hajk runtime does not support lista fields');
  const editView = views.find(name => /^EditView-/.test(name));
  if (editView) {
    const view = fs.readFileSync(path.join(staticRoot, editView), 'utf8');
    for (const [type, expression] of [
      ['Point', '!e.editPoint&&!e.editMultiPoint'],
      ['LineString', '!e.editLine&&!e.editMultiLine'],
      ['Polygon', '!e.editPolygon&&!e.editMultiPolygon']
    ]) {
      assert.ok(view.includes(`disabled:${expression}`), 'Verify the installed Hajk create-button contract');
      assert.equal(vm.runInNewContext(expression, { e: context.geometryFlags(type) }), false, `${type} creation button must be enabled in the real EditView condition`);
      assert.equal(vm.runInNewContext(expression, { e: {} }), true, 'The old missing flags must reproduce disabled creation buttons');
    }
  }
}

async function checkNativeInfoclickParser() {
  if (!fs.existsSync(staticRoot)) return;
  const coreName = fs.readdirSync(staticRoot).find(name => /^app-core-.*\.js$/.test(name));
  if (!coreName) return;
  let core = fs.readFileSync(path.join(staticRoot, coreName), 'utf8');
  const imagePatchStart = source.indexOf("      const infoclickImageAnchor =");
  const imagePatchEnd = source.indexOf('      if (next.includes(wmtsProtocolAnchor))', imagePatchStart);
  assert.ok(imagePatchStart >= 0 && imagePatchEnd > imagePatchStart, 'Native infoclick image sizing patch must exist');
  const imagePatchContext = { next: core, patched: 0 };
  vm.runInNewContext(source.slice(imagePatchStart, imagePatchEnd), imagePatchContext);
  core = imagePatchContext.next;
  const parserStart = core.indexOf('class AO{');
  const parserEnd = core.indexOf('const CNe=', parserStart);
  assert.ok(parserStart >= 0 && parserEnd > parserStart, 'Installed Hajk template parser must be identifiable');
  const nativeContext = {
    bNe: () => {}, RO: {},
    vx: { getClickLocationData: () => ({}) },
    x: { jsx: (component, props) => ({ component, props }) },
    vO: 'Markdown', EO: 'RawHtml', eW: 'MarkdownExtensions'
  };
  vm.runInNewContext(core.slice(parserStart, parserEnd) + ';globalThis.Parser=AO;', nativeContext);
  const properties = { bild: 'https://example.org/photo.jpg', pano: 'https://example.org/panorama/' };
  const parser = new nativeContext.Parser({ globalObserver: {}, options: { ...infoboxContext.options([{ attributes: [{ html: iconHtml }] }], { allowDangerousHtml: false }), useNewPlaceholderMatching: true } });
  const responsivePhoto = parser.components.img({ src: properties.bild, node: {} });
  assert.equal(responsivePhoto.props.style.maxWidth, '100%', 'Photos must fit the actual infoclick container');
  assert.equal(responsivePhoto.props.style.height, 'auto', 'Photos must retain their aspect ratio');
  assert.equal(responsivePhoto.props.node, undefined, 'Markdown AST nodes must not be passed to DOM images');
  const fixedIcon = parser.components.img({ src: 'https://example.org/camera.svg', style: { width: '32px', height: '32px' } });
  assert.equal(fixedIcon.props.style.width, '32px', 'Explicit icon width must be preserved');
  assert.equal(fixedIcon.props.style.height, '32px', 'Explicit icon height must be preserved');
  const rendered = await parser.setMarkdownAndProperties({ markdown: iconTemplate, properties: { ...properties } }).mergeFeaturePropsWithMarkdown();
  assert.ok(rendered.props.children.includes("href='https://example.org/photo.jpg'"), 'Native Hajk must resolve the photo icon link');
  assert.ok(rendered.props.children.includes("href='https://example.org/panorama/'"), 'Native Hajk must resolve the panorama icon link');
  assert.equal(rendered.props.rehypePlugins.length, 1, 'Native Hajk must activate HTML rendering for authored HTML');
  const photo = await parser.setMarkdownAndProperties({ markdown: imageTemplate, properties: { ...properties } }).mergeFeaturePropsWithMarkdown();
  assert.ok(photo.props.children.includes('[![Foto](https://example.org/photo.jpg)](https://example.org/photo.jpg)'), 'The native parser must preserve linked photo previews');
}

checkNativeInfoclickParser().then(() => {
  console.log('Hajk editable field types and native infoclick checks passed.');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
