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

const staticRoot = path.resolve('data/Qtiler2Hajk/hajk/current/static');
if (fs.existsSync(staticRoot)) {
  const views = fs.readdirSync(staticRoot).filter((name) => /^(EditView|CollectorView)-.*\.js$/i.test(name));
  assert.ok(views.length > 0, 'No installed Hajk edit views found');
  assert.ok(views.some((name) => fs.readFileSync(path.join(staticRoot, name), 'utf8').includes('case"lista"')), 'Installed Hajk runtime does not support lista fields');
}

console.log('Hajk editable field type checks passed.');
