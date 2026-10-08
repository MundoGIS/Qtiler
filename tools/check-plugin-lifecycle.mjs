import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { PluginManager } from '../lib/pluginManager.js';
import { registerPluginRoutes } from '../routes/plugins.js';
import { INSTALL_RECEIPT, readInstallationStatus, completeInstallation } from '../lib/pluginInstallation.js';
import { waitForPluginInstallation } from '../public/js/plugin-installation.js';

async function fixture(context) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtiler-lifecycle-test-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const pluginsDir = path.join(root, 'plugins');
  const dataDir = path.join(root, 'data');
  await fs.mkdir(pluginsDir);
  await fs.mkdir(dataDir);
  const manager = new PluginManager({ app: {}, baseDir: pluginsDir, dataDir, security: {} });
  await manager.store.write({ enabled: ['QtilerAuth', 'Hajk'], custom: 'preserve' });
  manager.enabled = new Set(['QtilerAuth', 'Hajk']);
  manager.registry.set('QtilerAuth', { api: { dispose() { throw new Error('Auth must not be disposed'); } } });
  manager.registry.set('Hajk', { api: { dispose() { throw new Error('Hajk must not be hot-disposed'); } } });
  return { root, pluginsDir, dataDir, manager };
}

test('persisted updates never mark unloaded plugins as active in another worker', async (context) => {
  const { manager } = await fixture(context);
  await manager.updateEnabledList((enabled) => enabled.add('NewPlugin'));
  assert.deepEqual(manager.listEnabled(), ['QtilerAuth', 'Hajk']);
  assert.deepEqual((await manager.store.read()).enabled, ['QtilerAuth', 'Hajk', 'NewPlugin']);
  assert.equal((await manager.store.read()).custom, 'preserve');
});

test('concurrent workers preserve unrelated enabled plugins', async (context) => {
  const { manager, pluginsDir, dataDir } = await fixture(context);
  const other = new PluginManager({ app: {}, baseDir: pluginsDir, dataDir, security: {} });
  await Promise.all([
    manager.updateEnabledList((enabled) => enabled.add('Origo')),
    other.updateEnabledList((enabled) => { enabled.delete('Hajk'); return enabled; })
  ]);
  assert.deepEqual(new Set((await manager.store.read()).enabled), new Set(['QtilerAuth', 'Origo']));
});

test('only one worker may install or remove plugins at a time', async (context) => {
  const { manager, pluginsDir, dataDir } = await fixture(context);
  const other = new PluginManager({ app: {}, baseDir: pluginsDir, dataDir, security: {} });
  const release = await manager.acquireOperationLock();
  await assert.rejects(other.acquireOperationLock(), (err) => err.statusCode === 409);
  await release();
  const releaseOther = await other.acquireOperationLock();
  await releaseOther();
});

test('uninstall preserves Auth, its license and plugin data; listing never mutates state', async (context) => {
  const { pluginsDir, dataDir, manager } = await fixture(context);
  await fs.mkdir(path.join(pluginsDir, 'Hajk'));
  await fs.mkdir(path.join(dataDir, 'Hajk'));
  await fs.writeFile(path.join(dataDir, 'Hajk', 'maps.json'), 'saved maps');
  const licensePath = path.join(dataDir, 'licenses.json');
  const licenseState = JSON.stringify({ instanceId: 'fixture', plugins: {} });
  await fs.writeFile(licensePath, licenseState);
  const routes = new Map();
  const app = Object.fromEntries(['get', 'post', 'delete'].map((method) => [method, (url, ...handlers) => routes.set(`${method} ${url}`, handlers)]));
  registerPluginRoutes({
    app, pluginManager: manager, security: { isEnabled: () => false }, pluginsDir, dataDir,
    requireAdmin() {}, requireAdminIfEnabled() {}, applySecurityDefaults() { throw new Error('Security must not reset'); },
    sanitizePluginName: (name) => name,
    removeRecursive: (target) => fs.rm(target, { recursive: true, force: true })
  });
  const response = new EventEmitter();
  response.status = () => response;
  response.json = (payload) => { response.payload = payload; return response; };
  await routes.get('delete /plugins/:name').at(-1)({ params: { name: 'Hajk' }, query: { keepData: '1' } }, response);
  assert.equal(response.payload.status, 'uninstalled');
  assert.equal(await fs.readFile(path.join(dataDir, 'Hajk', 'maps.json'), 'utf8'), 'saved maps');
  assert.equal(await fs.readFile(licensePath, 'utf8'), licenseState);
  assert.deepEqual((await manager.store.read()).enabled, ['QtilerAuth']);
  assert.equal(manager.registry.has('QtilerAuth'), true);
  assert.deepEqual(manager.listEnabled(), ['QtilerAuth', 'Hajk']);
  manager.setLicenseGuard(() => true);
  manager.listEnabled = () => ['AbsentPlugin'];
  await fs.mkdir(path.join(pluginsDir, 'EmptyPlugin'));
  await fs.mkdir(path.join(pluginsDir, 'ValidPlugin'));
  await fs.writeFile(path.join(pluginsDir, 'ValidPlugin', 'index.js'), 'export const register = () => ({});');
  await fs.writeFile(path.join(pluginsDir, 'ValidPlugin', 'plugin.json'), JSON.stringify({ name: 'ValidPlugin' }));
  await fs.mkdir(path.join(pluginsDir, 'Qtiler-3D-eye'));
  await fs.writeFile(path.join(pluginsDir, 'Qtiler-3D-eye', 'index.js'), 'export const register = () => ({});');
  await fs.writeFile(path.join(pluginsDir, 'Qtiler-3D-eye', 'plugin.json'), JSON.stringify({ name: 'Qtiler-3D-eye', showWhenInactive: false }));
  await manager.store.write({ enabled: ['QtilerAuth', 'AbsentPlugin'] });
  manager.deactivatePlugin = () => { throw new Error('No licensed plugin in this fixture'); };
  const before = await manager.store.read();
  await routes.get('get /plugins').at(-1)({ user: null }, response);
  assert.deepEqual(await manager.store.read(), before);
  assert.deepEqual(response.payload.installed, ['ValidPlugin']);
  await manager.updateEnabledList((enabled) => enabled.add('Qtiler-3D-eye'));
  await routes.get('get /plugins').at(-1)({ user: null }, response);
  assert.deepEqual(new Set(response.payload.installed), new Set(['ValidPlugin', 'Qtiler-3D-eye']));
});

for (const scenario of ['success', 'invalid', 'status-storage-error']) {
  const invalid = scenario === 'invalid';
  const storageError = scenario === 'status-storage-error';
  test(`real upload route: ${invalid ? 'invalid replacement preserves previous package' : storageError ? 'status storage failure preserves previous package' : 'reinstall preserves Auth and license state'}`, async (context) => {
    const { root, pluginsDir, dataDir, manager } = await fixture(context);
    if (storageError) await fs.writeFile(path.join(dataDir, 'plugin-operations'), 'not a directory');
    const destination = path.join(pluginsDir, 'Hajk');
    await fs.mkdir(destination);
    await fs.writeFile(path.join(destination, 'index.js'), 'export const register = () => ({version: 1});');
    const licensePath = path.join(dataDir, 'licenses.json');
    const licenseState = JSON.stringify({ instanceId: 'fixture', plugins: { QtilerAuth: { licenseKey: 'do-not-touch' } } });
    await fs.writeFile(licensePath, licenseState);
    const zipPath = path.join(root, 'upload.zip');
    const zip = new AdmZip();
    zip.addFile('index.js', Buffer.from(invalid ? 'export const register = (' : 'export const register = () => ({version: 2});'));
    zip.writeZip(zipPath);
    const routes = new Map();
    const app = Object.fromEntries(['get', 'post', 'delete'].map((method) => [method, (url, ...handlers) => routes.set(`${method} ${url}`, handlers)]));
    registerPluginRoutes({
      app, pluginManager: manager, security: { isEnabled: () => true }, pluginsDir, dataDir,
      requireAdmin() {}, requireAdminIfEnabled() {}, applySecurityDefaults() { throw new Error('Security must not reset'); },
      pluginUpload: { single: () => async (_req, _res, callback) => callback(null) },
      sanitizePluginName: (name) => name, resolvePluginRoot: async (dir) => dir,
      detectPluginName: async () => 'Hajk',
      copyRecursive: (source, target) => fs.cp(source, target, { recursive: true }),
      removeRecursive: (target) => fs.rm(target, { recursive: true, force: true })
    });
    const response = new EventEmitter();
    response.statusCode = 200;
    response.status = (code) => { response.statusCode = code; return response; };
    let finish;
    const completed = new Promise((resolve) => { finish = resolve; });
    response.json = (payload) => { response.payload = payload; finish(); return response; };
    await routes.get('post /plugins/upload').at(-1)({ file: { path: zipPath }, body: {} }, response);
    await completed;
    assert.equal(response.statusCode, invalid || storageError ? 500 : 201);
    assert.equal(await fs.readFile(licensePath, 'utf8'), licenseState);
    assert.deepEqual((await manager.store.read()).enabled, ['QtilerAuth', 'Hajk']);
    assert.deepEqual(manager.listEnabled(), ['QtilerAuth', 'Hajk']);
    assert.equal(manager.registry.has('QtilerAuth'), true);
    assert.equal(manager.registry.has('Hajk'), true);
    assert.match(await fs.readFile(path.join(destination, 'index.js'), 'utf8'), invalid || storageError ? /version: 1/ : /version: 2/);
    assert.deepEqual(await fs.readdir(pluginsDir), ['Hajk']);
    if (!invalid && !storageError) {
      assert.equal(response.payload.status, 'loading');
      assert.equal(response.payload.statusUrl, `/plugins/installations/${response.payload.revision}`);
      const receipt = JSON.parse(await fs.readFile(path.join(destination, INSTALL_RECEIPT), 'utf8'));
      assert.equal(receipt.revision, response.payload.revision);
      assert.equal((await readInstallationStatus(dataDir, manager, receipt.revision)).state, 'loading');
    }
  });
}

test('installation confirmation requires both the cluster result and the loaded revision', async (context) => {
  const { dataDir, manager } = await fixture(context);
  const revision = '12345678-1234-1234-1234-123456789abc';
  const operationDir = path.join(dataDir, 'plugin-operations');
  await fs.mkdir(operationDir);
  const operationPath = path.join(operationDir, `${revision}.json`);
  assert.equal((await readInstallationStatus(dataDir, manager, '../licenses.json')).state, 'not_found');
  assert.equal((await readInstallationStatus(dataDir, manager, revision)).state, 'not_found');
  await fs.writeFile(operationPath, JSON.stringify({ plugin: 'Hajk', state: 'loading' }));
  manager.registry.get('Hajk').revision = revision;
  assert.equal((await readInstallationStatus(dataDir, manager, revision)).state, 'loading');
  await fs.writeFile(operationPath, JSON.stringify({ plugin: 'Hajk', state: 'ready' }));
  assert.equal((await readInstallationStatus(dataDir, manager, revision)).state, 'ready');
  manager.registry.get('Hajk').revision = 'old-package';
  assert.equal((await readInstallationStatus(dataDir, manager, revision)).state, 'loading');
  await fs.writeFile(operationPath, JSON.stringify({ plugin: 'Hajk', state: 'failed' }));
  assert.equal((await readInstallationStatus(dataDir, manager, revision)).state, 'failed');
  manager.registry.get('Hajk').revision = revision;
  await completeInstallation(dataDir, revision, [new Set([revision]), undefined]);
  assert.equal((await readInstallationStatus(dataDir, manager, revision)).state, 'failed');
  await completeInstallation(dataDir, revision, []);
  assert.equal((await readInstallationStatus(dataDir, manager, revision)).state, 'failed');
  await completeInstallation(dataDir, revision, [new Set([revision]), new Set(['old-package'])]);
  assert.equal((await readInstallationStatus(dataDir, manager, revision)).state, 'failed');
  await completeInstallation(dataDir, revision, [new Set([revision]), new Set([revision])]);
  assert.equal((await readInstallationStatus(dataDir, manager, revision)).state, 'ready');
  await completeInstallation(dataDir, '../licenses.json', []);
});

test('a receipt changed during plugin registration never identifies stale code as the new revision', async (context) => {
  const { pluginsDir, manager } = await fixture(context);
  const pluginDir = path.join(pluginsDir, 'RevisionRace');
  await fs.mkdir(pluginDir);
  await fs.writeFile(path.join(pluginDir, 'package.json'), JSON.stringify({ type: 'module' }));
  await fs.writeFile(path.join(pluginDir, INSTALL_RECEIPT), JSON.stringify({ revision: 'old-package' }));
  await fs.writeFile(path.join(pluginDir, 'index.js'), `import fs from 'node:fs/promises'; import path from 'node:path'; export async function register(context) { await fs.writeFile(path.join(context.baseDir, '${INSTALL_RECEIPT}'), JSON.stringify({ revision: 'new-package' })); return {}; }`);
  await manager.loadPlugin('RevisionRace');
  assert.equal(manager.registry.get('RevisionRace').revision, null);
});

test('browser polling tolerates restart outages but never reports failures or timeouts as ready', async () => {
  const url = '/plugins/installations/12345678-1234-1234-1234-123456789abc';
  let clock = 0;
  let requests = 0;
  const options = { now: () => clock, delay: async () => { clock += 1000; }, timeoutMs: 4000 };
  const result = await waitForPluginInstallation(url, { ...options, read: async () => {
    requests += 1;
    if (requests === 1) throw Object.assign(new Error('Restarting'), { status: 503 });
    return { state: requests === 2 ? 'loading' : 'ready' };
  } });
  assert.equal(result.state, 'ready');
  assert.equal(requests, 3);
  await assert.rejects(waitForPluginInstallation(url, { ...options, read: async () => ({ state: 'failed' }) }), /could not be loaded/);
  await assert.rejects(waitForPluginInstallation(url, { ...options, read: async () => ({ state: 'loading' }) }), /not been confirmed/);
  await assert.rejects(waitForPluginInstallation('https://outside.example/status', options), /does not support/);
  await assert.rejects(waitForPluginInstallation(url, { ...options, read: async () => { throw Object.assign(new Error('Not found'), { status: 404 }); } }), /Not found/);
});