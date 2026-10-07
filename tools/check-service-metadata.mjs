import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import syncFs from 'node:fs';
import { registerServiceMetadataRoutes } from '../routes/serviceMetadata.js';

test('metadata editor requires admin middleware and preserves fields not edited', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtiler-metadata-test-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const routes = new Map();
  const app = Object.fromEntries(['get', 'patch'].map((method) => [method, (url, ...handlers) => routes.set(`${method} ${url}`, handlers)]));
  const requireAdmin = () => {};
  const filePath = path.join(root, 'service-metadata.json');
  registerServiceMetadataRoutes({ app, requireAdmin, filePath, defaults: { serviceIdentification: { title: 'old' }, serviceProvider: { contact: { address: { city: 'preserved' } } }, operations: { getFeatureInfo: false } } });
  assert.equal(routes.get('patch /admin/service-metadata')[0], requireAdmin);
  const response = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; }, set() {} };
  await routes.get('patch /admin/service-metadata').at(-1)({ body: { serviceIdentification: { title: 'New service', keywords: ['Maps'] }, serviceProvider: { contact: { address: { email: 'contact@example.org' } } } } }, response);
  const saved = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(saved.serviceIdentification.title, 'New service');
  assert.equal(saved.serviceProvider.contact.address.city, 'preserved');
  assert.equal(saved.operations.getFeatureInfo, false);
  await routes.get('get /admin/service-metadata').at(-1)({}, response);
  assert.deepEqual(response.body, saved, 'Reading again must return persisted metadata');
  await routes.get('patch /admin/service-metadata').at(-1)({ body: { serviceProvider: { providerSite: 'javascript:alert(1)' } } }, response);
  assert.equal(response.code, 400);
  assert.equal(JSON.parse(await fs.readFile(filePath, 'utf8')).serviceIdentification.title, 'New service');
  await routes.get('patch /admin/service-metadata').at(-1)({ body: { serviceIdentification: { title: '\u0000invalid' } } }, response);
  assert.equal(response.code, 400);
  await fs.writeFile(`${filePath}.lock`, String(process.pid));
  await routes.get('patch /admin/service-metadata').at(-1)({ body: { serviceIdentification: { title: 'must not overwrite' } } }, response);
  assert.equal(response.code, 409);
  assert.equal(JSON.parse(await fs.readFile(filePath, 'utf8')).serviceIdentification.title, 'New service');
});

function formFixture(api) {
  const source = syncFs.readFileSync('public/admin-console.js', 'utf8');
  const start = source.indexOf('async function setupServiceMetadataForm()');
  const end = source.indexOf('\ninit();', start);
  const fields = { disabled: true };
  const status = { textContent: '' };
  const inputs = ['title', 'abstract', 'keywords', 'providerName', 'providerSite', 'individualName', 'positionName', 'email', 'fees', 'accessConstraints'].map((name) => ({ name, value: '' }));
  const form = { querySelectorAll: () => inputs, addEventListener(_event, callback) { this.submit = callback; } };
  const sandbox = {
    document: { getElementById: (id) => ({ 'service-metadata-form': form, 'service-metadata-fields': fields, 'service-metadata-status': status })[id] },
    api, showMessage() {}, parseError: (err) => err.message,
    FormData: class {
      constructor() { this.rows = fields.disabled ? [] : inputs.map((input) => [input.name, input.value]); }
      [Symbol.iterator]() { return this.rows[Symbol.iterator](); }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end), sandbox);
  return { sandbox, fields, status, inputs, form };
}

test('form keeps saving disabled on missing API and does not show raw HTML', async () => {
  const fixture = formFixture(async () => { throw Object.assign(new Error('<html>Cannot GET</html>'), { status: 404 }); });
  await fixture.sandbox.setupServiceMetadataForm();
  assert.equal(fixture.fields.disabled, true);
  assert.match(fixture.status.textContent, /Restart Qtiler/);
  assert.ok(!fixture.status.textContent.includes('<html>'));
  assert.equal(fixture.form.submit, undefined);
});

test('form submits captured values before disabling controls and confirms save', async () => {
  let submitted;
  const fixture = formFixture(async (_url, options) => {
    if (options) { submitted = options.body; return submitted; }
    return { serviceIdentification: { title: 'old' }, serviceProvider: {} };
  });
  await fixture.sandbox.setupServiceMetadataForm();
  assert.equal(fixture.fields.disabled, false);
  fixture.inputs.find((input) => input.name === 'title').value = 'New title';
  await fixture.form.submit({ preventDefault() {} });
  assert.equal(submitted.serviceIdentification.title, 'New title');
  assert.equal(fixture.fields.disabled, false);
  assert.equal(fixture.status.textContent, 'Metadata saved.');
});