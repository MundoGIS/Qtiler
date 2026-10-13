import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import vm from 'node:vm';
import AdmZip from 'adm-zip';
import { PluginManager } from '../lib/pluginManager.js';
import { closeAuthDb } from '../lib/authDb.js';
import { registerPluginRoutes } from '../routes/plugins.js';
import { INSTALL_RECEIPT, PENDING_INSTALLATION, PENDING_UNINSTALLATION, readInstallationStatus, readUninstallationStatus, finalizeUninstallation, recoverInterruptedUninstallation, completeInstallation } from '../lib/pluginInstallation.js';
import { waitForPluginInstallation, waitForPluginUninstallation, uploadPluginArchive, pluginInstallationText } from '../public/js/plugin-installation.js';

const originalProgramData = process.env.ProgramData;
const machineTrialFixture = await fs.mkdtemp(path.join(os.tmpdir(), 'qtiler-license-fixture-'));
process.env.ProgramData = machineTrialFixture;
test.after(async () => {
  closeAuthDb();
  if (originalProgramData === undefined) delete process.env.ProgramData;
  else process.env.ProgramData = originalProgramData;
  await fs.rm(machineTrialFixture, { recursive: true, force: true });
});

async function fixture(context) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtiler-lifecycle-test-'));
  context.after(async () => { closeAuthDb(); await fs.rm(root, { recursive: true, force: true }); });
  const pluginsDir = path.join(root, 'plugins');
  const dataDir = path.join(root, 'data');
  await fs.mkdir(pluginsDir);
  await fs.mkdir(dataDir);
  await fs.mkdir(path.join(dataDir, 'QtilerAuth'));
  const authFiles = new Map([
    [path.join(dataDir, 'QtilerAuth', 'auth.db'), 'auth database sentinel'],
    [path.join(dataDir, 'QtilerAuth', 'config.json'), JSON.stringify({ enabled: true, sentinel: 'preserve' })],
    [path.join(dataDir, 'auth-config.json'), JSON.stringify({ sentinel: 'global Auth configuration' })]
  ]);
  for (const [file, content] of authFiles) await fs.writeFile(file, content);
  const manager = new PluginManager({ app: {}, baseDir: pluginsDir, dataDir, security: {} });
  await manager.store.write({ enabled: ['QtilerAuth', 'Hajk'], custom: 'preserve' });
  manager.enabled = new Set(['QtilerAuth', 'Hajk']);
  manager.registry.set('QtilerAuth', { api: { dispose() { throw new Error('Auth must not be disposed'); } } });
  manager.registry.set('Hajk', { api: { dispose() { throw new Error('Hajk must not be hot-disposed'); } } });
  return { root, pluginsDir, dataDir, manager, authFiles };
}

async function assertAuthFilesUnchanged(authFiles) {
  for (const [file, content] of authFiles) assert.equal(await fs.readFile(file, 'utf8'), content, `Unrelated plugin operations must not change ${path.basename(file)}`);
}

test('persisted updates never mark unloaded plugins as active in another worker', async (context) => {
  const { manager } = await fixture(context);
  await manager.updateEnabledList((enabled) => enabled.add('NewPlugin'));
  assert.deepEqual(manager.listEnabled(), ['QtilerAuth', 'Hajk']);
  assert.deepEqual((await manager.store.read()).enabled, ['QtilerAuth', 'Hajk', 'NewPlugin']);
  assert.equal((await manager.store.read()).custom, 'preserve');
});

async function writeStartupPlugin(pluginsDir, name, registerBody) {
  const directory = path.join(pluginsDir, name);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
  await fs.writeFile(path.join(directory, 'index.js'), `export async function register(context) { ${registerBody} }`);
}

test('Auth initializes before optional plugins regardless of installation order', async (context) => {
  const { pluginsDir, manager } = await fixture(context);
  manager.registry.clear();
  manager.app.order = [];
  await manager.store.write({ enabled: ['Hajk', 'QtilerAuth'] });
  await writeStartupPlugin(pluginsDir, 'QtilerAuth', "context.security.isEnabled = () => true; context.app.order.push('Auth'); return {};");
  await writeStartupPlugin(pluginsDir, 'Hajk', "if (!context.security.isEnabled()) throw Error('Auth not ready'); context.app.order.push('Hajk'); return {};");
  await manager.init();
  assert.deepEqual(manager.app.order, ['Auth', 'Hajk']);
  assert.equal(manager.security.isEnabled(), true);
});

test('a broken or unlicensed configured Auth cannot boot an unprotected worker', async (context) => {
  for (const failure of ['register', 'license']) {
    const { pluginsDir, manager } = await fixture(context);
    manager.registry.clear();
    await writeStartupPlugin(pluginsDir, 'QtilerAuth', "throw Error('Auth startup failure');");
    if (failure === 'license') manager.setLicenseGuard(name => name !== 'QtilerAuth');
    const before = await manager.store.read();
    await assert.rejects(manager.init(), error => error.code === 'AUTH_PLUGIN_STARTUP_FAILED');
    assert.equal(manager.registry.has('QtilerAuth'), false);
    assert.deepEqual(await manager.store.read(), before, 'Startup failure must not uninstall Auth or change its persisted configuration');
  }
});

test('optional plugin registration cannot replace Auth security handlers', async (context) => {
  const { pluginsDir, manager } = await fixture(context);
  manager.registry.clear();
  await writeStartupPlugin(pluginsDir, 'QtilerAuth', 'context.security.isEnabled = () => true; return {};');
  await writeStartupPlugin(pluginsDir, 'Hajk', 'context.security.isEnabled = () => false; return {};');
  await manager.init();
  assert.equal(manager.security.isEnabled(), true);
  assert.equal(manager.registry.has('QtilerAuth'), true);
  assert.equal(manager.registry.has('Hajk'), false);
  assert.deepEqual((await manager.store.read()).enabled, ['QtilerAuth', 'Hajk']);
});

test('a clean installation blocks only the selected plugin routes until completion', async (context) => {
  const { pluginsDir, dataDir, manager } = await fixture(context);
  const routes = new Map();
  manager.app.get = (route, ...handlers) => { routes.set(route, handlers); };
  await writeStartupPlugin(pluginsDir, 'Hajk', "context.app.get('/hajk-test', (_req, res) => res.json({ok:true})); return {};");
  await writeStartupPlugin(pluginsDir, 'Other', "context.app.get('/other-test', (_req, res) => res.json({ok:true})); return {};");
  await manager.loadPlugin('Hajk');
  await manager.loadPlugin('Other');
  await fs.mkdir(path.join(dataDir, 'plugin-operations'));
  await fs.writeFile(path.join(dataDir, PENDING_INSTALLATION), JSON.stringify({ plugin: 'Hajk', installMode: 'reset' }));
  let passed = false;
  const response = { status(code) { this.code = code; return this; }, set() { return this; }, json(payload) { this.payload = payload; return this; } };
  routes.get('/hajk-test')[0]({}, response, () => { passed = true; });
  assert.equal(response.code, 503);
  assert.equal(passed, false);
  routes.get('/other-test')[0]({}, response, () => { passed = true; });
  assert.equal(passed, true);
  await fs.unlink(path.join(dataDir, PENDING_INSTALLATION));
  passed = false;
  routes.get('/hajk-test')[0]({}, response, () => { passed = true; });
  assert.equal(passed, true);
  await manager.deactivatePlugin('Hajk');
  passed = false;
  routes.get('/hajk-test')[0]({}, response, () => { passed = true; });
  assert.equal(passed, false, 'Deactivated plugin routes must not remain accessible after license enforcement');
  assert.equal(response.code, 403);
  assert.equal(response.payload.error, 'plugin_inactive');
});

test('rolling replacement requires Auth, other active plugins and the installed revision before replacing healthy workers', async () => {
  const serverSource = await fs.readFile(new URL('../server.js', import.meta.url), 'utf8');
  const start = serverSource.indexOf('  const forkReadyWorker =');
  const end = serverSource.indexOf('\n  const stopWorker =', start);
  assert.ok(start >= 0 && end > start);
  for (const scenario of ['ready', 'missing-auth', 'missing-other-plugin', 'missing-revision', 'timeout']) {
    const replacement = new EventEmitter();
    replacement.id = 1001;
    replacement.process = { pid: 1001, kill() { replacement.killed = true; } };
    let timeoutCallback;
    const starting = new Set();
    const planned = new Set();
    const loadedPlugins = scenario === 'missing-auth' ? ['Hajk', 'Qrigo'] : scenario === 'missing-other-plugin' ? ['QtilerAuth', 'Hajk'] : ['QtilerAuth', 'Hajk', 'Qrigo'];
    const scope = {
      cluster: { fork: () => replacement },
      startingReplacementWorkers: starting, plannedWorkerExits: planned,
      workerPluginNames: new Map([[1001, new Set(loadedPlugins)]]),
      workerPluginRevisions: new Map([[1001, new Set(scenario === 'missing-revision' ? [] : ['revision'])]]),
      setTimeout: callback => { timeoutCallback = callback; return 1; }, clearTimeout: () => {}
    };
    const result = vm.runInNewContext(serverSource.slice(start, end) + '\nforkReadyWorker(["QtilerAuth", "Qrigo"], "revision");', scope);
    if (scenario === 'timeout') timeoutCallback();
    else replacement.emit('listening');
    if (scenario === 'ready') {
      assert.equal(await result, replacement);
      assert.equal(replacement.killed, undefined);
    } else {
      await assert.rejects(result, /plugin readiness|did not start listening/);
      assert.equal(replacement.killed, true, 'Failed replacements must not later start serving requests');
      assert.equal(planned.has(replacement.id), true);
    }
    assert.equal(starting.has(replacement.id), false);
    assert.equal(replacement.listenerCount('listening'), 0);
  }
  const rollingStart = serverSource.indexOf('  const restartAllWorkersRolling =');
  const rollingEnd = serverSource.indexOf('\n  // Listen for worker requests', rollingStart);
  let retiredWorkers = 0;
  const oldWorker = { id: 7 };
  const rollingScope = {
    cluster: { workers: { 7: oldWorker } }, console,
    pluginManager: { store: { read: async () => ({ enabled: ['QtilerAuth', 'Hajk'] }) } },
    workerPluginNames: new Map([[7, new Set(['QtilerAuth', 'Hajk', 'RemovedPlugin'])]]),
    setInterval: () => ({ unref() {} }),
    forkReadyWorker: async (required, revision) => {
      assert.deepEqual(new Set(required), new Set(['QtilerAuth', 'Hajk']));
      assert.equal(revision, 'revision');
      throw new Error('Replacement failed');
    },
    stopWorker: async () => { retiredWorkers++; }
  };
  await assert.rejects(vm.runInNewContext(serverSource.slice(rollingStart, rollingEnd) + '\nrestartAllWorkersRolling("revision");', rollingScope), /Replacement failed/);
  assert.equal(retiredWorkers, 0, 'A rejected replacement must leave the previous healthy worker serving requests');
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

test('uninstall waits until workers release files, preserves data/Auth and listing never mutates state', async (context) => {
  const { pluginsDir, dataDir, manager, authFiles } = await fixture(context);
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
  response.status = code => { response.statusCode = code; return response; };
  response.json = (payload) => { response.payload = payload; return response; };
  await routes.get('delete /plugins/:name').at(-1)({ params: { name: 'Hajk' }, query: { keepData: '1' } }, response);
  assert.equal(response.statusCode, 202);
  assert.equal(response.payload.status, 'uninstalling');
  assert.equal(fsSync.existsSync(path.join(pluginsDir, 'Hajk')), true, 'Loaded plugin files must remain until old workers stop');
  assert.equal((await fs.readFile(path.join(dataDir, PENDING_UNINSTALLATION), 'utf8')).includes(response.payload.operationId), true);
  await assert.rejects(manager.acquireOperationLock(), error => error.statusCode === 409);
  assert.equal((await readUninstallationStatus(dataDir, response.payload.operationId)).state, 'uninstalling');
  const completed = await finalizeUninstallation(dataDir, pluginsDir, response.payload.operationId);
  assert.equal(completed.state, 'ready');
  assert.equal(fsSync.existsSync(path.join(pluginsDir, 'Hajk')), false);
  assert.equal((await readUninstallationStatus(dataDir, response.payload.operationId)).state, 'ready');
  assert.equal(await fs.readFile(path.join(dataDir, 'Hajk', 'maps.json'), 'utf8'), 'saved maps');
  assert.equal(await fs.readFile(licensePath, 'utf8'), licenseState);
  assert.deepEqual((await manager.store.read()).enabled, ['QtilerAuth']);
  assert.equal(manager.registry.has('QtilerAuth'), true);
  await assertAuthFilesUnchanged(authFiles);
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

for (const scenario of ['success', 'invalid', 'status-storage-error', 'confirmation', 'reset']) {
  const invalid = scenario === 'invalid';
  const storageError = scenario === 'status-storage-error';
  const confirmation = scenario === 'confirmation';
  const reset = scenario === 'reset';
  test(`real upload route: ${invalid ? 'invalid replacement preserves previous package' : storageError ? 'status storage failure preserves previous package' : 'reinstall preserves Auth and license state'}`, async (context) => {
    const { root, pluginsDir, dataDir, manager, authFiles } = await fixture(context);
    if (storageError) await fs.writeFile(path.join(dataDir, 'plugin-operations'), 'not a directory');
    const destination = path.join(pluginsDir, 'Hajk');
    await fs.mkdir(destination);
    await fs.writeFile(path.join(destination, 'index.js'), 'export const register = () => ({version: 1});');
    await fs.mkdir(path.join(dataDir, 'Hajk'));
    await fs.writeFile(path.join(dataDir, 'Hajk', 'maps.json'), 'previous maps');
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
    await routes.get('post /plugins/upload').at(-1)({ file: { path: zipPath }, body: confirmation ? {} : { installMode: reset ? 'reset' : 'preserve' } }, response);
    await completed;
    assert.equal(response.statusCode, confirmation ? 409 : invalid || storageError ? 500 : 201);
    if (confirmation) assert.equal(response.payload.error, 'plugin_exists');
    assert.equal(await fs.readFile(licensePath, 'utf8'), licenseState);
    await assertAuthFilesUnchanged(authFiles);
    assert.deepEqual((await manager.store.read()).enabled, ['QtilerAuth', 'Hajk']);
    assert.deepEqual(manager.listEnabled(), ['QtilerAuth', 'Hajk']);
    assert.equal(manager.registry.has('QtilerAuth'), true);
    assert.equal(manager.registry.has('Hajk'), true);
    assert.match(await fs.readFile(path.join(destination, 'index.js'), 'utf8'), invalid || storageError || confirmation ? /version: 1/ : /version: 2/);
    const remainingPackages = await fs.readdir(pluginsDir);
    assert.equal(remainingPackages.includes('Hajk'), true);
    assert.equal(remainingPackages.some(name => name.includes('.install-')), false);
    assert.equal(remainingPackages.some(name => name.includes('.previous-')), !invalid && !storageError && !confirmation, 'Previous code must be retained until runtime readiness');
    if (reset) {
      assert.equal(response.payload.hasDataBackup, true);
      assert.deepEqual(await fs.readdir(path.join(dataDir, 'Hajk')), []);
      assert.equal(await fs.readFile(path.join(dataDir, 'plugin-reset-backups', 'Hajk', response.payload.revision, 'maps.json'), 'utf8'), 'previous maps');
    } else {
      assert.equal(await fs.readFile(path.join(dataDir, 'Hajk', 'maps.json'), 'utf8'), 'previous maps');
    }
    if (!invalid && !storageError && !confirmation) {
      assert.equal(response.payload.status, 'loading');
      assert.equal(response.payload.statusUrl, `/plugins/installations/${response.payload.revision}`);
      const receipt = JSON.parse(await fs.readFile(path.join(destination, INSTALL_RECEIPT), 'utf8'));
      assert.equal(receipt.revision, response.payload.revision);
      assert.equal((await readInstallationStatus(dataDir, manager, receipt.revision)).state, 'loading');
      await assert.rejects(manager.acquireOperationLock(), error => error.statusCode === 409, 'Another plugin operation must not overlap worker readiness');
      if (reset) {
        await completeInstallation(dataDir, receipt.revision, [], { pluginsDir, pluginManager: manager });
        assert.match(await fs.readFile(path.join(destination, 'index.js'), 'utf8'), /version: 1/);
        assert.equal(await fs.readFile(path.join(dataDir, 'Hajk', 'maps.json'), 'utf8'), 'previous maps');
        assert.equal((await readInstallationStatus(dataDir, manager, receipt.revision)).rolledBack, true);
      } else {
        await completeInstallation(dataDir, receipt.revision, [new Set([receipt.revision])], { pluginsDir, pluginManager: manager });
        assert.deepEqual(await fs.readdir(pluginsDir), ['Hajk']);
      }
      await assert.rejects(fs.access(path.join(dataDir, PENDING_INSTALLATION)), error => error.code === 'ENOENT');
      await assertAuthFilesUnchanged(authFiles);
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

for (const plugin of ['Qtiler2Hajk', 'Qtiler2Origo', 'Qtiler-3D-eye', 'QtilerAuth', 'Qtiler2qwc']) {
  test(`${plugin}: failed clean reinstall restores code/data and leaves other plugins and shared Auth data unchanged`, async context => {
    const { pluginsDir, dataDir, manager, authFiles } = await fixture(context);
    const revision = '87654321-1234-1234-1234-123456789abc';
    const packageBackup = `.${plugin}.previous-fixture`;
    await fs.mkdir(path.join(pluginsDir, plugin));
    await fs.mkdir(path.join(pluginsDir, packageBackup));
    await fs.writeFile(path.join(pluginsDir, plugin, 'index.js'), 'new code');
    await fs.writeFile(path.join(pluginsDir, packageBackup, 'index.js'), 'old code');
    const dataBackup = path.join(dataDir, 'plugin-reset-backups', plugin, revision);
    await fs.mkdir(dataBackup, { recursive: true });
    await fs.mkdir(path.join(dataDir, plugin), { recursive: true });
    await fs.writeFile(path.join(dataBackup, 'settings.json'), 'old settings');
    await fs.writeFile(path.join(dataDir, plugin, 'settings.json'), 'new defaults');
    await fs.mkdir(path.join(dataDir, 'Unrelated'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'Unrelated', 'settings.json'), 'keep unrelated');
    await fs.mkdir(path.join(dataDir, 'plugin-operations'));
    await manager.store.write({ enabled: ['QtilerAuth', plugin, 'Unrelated'] });
    await fs.writeFile(path.join(dataDir, 'plugin-operations', `${revision}.json`), JSON.stringify({ plugin, state: 'loading', wasPersisted: true, packageBackup, hasDataBackup: true }));
    await fs.writeFile(path.join(dataDir, PENDING_INSTALLATION), JSON.stringify({ plugin, revision }));
    await completeInstallation(dataDir, revision, [], { pluginsDir, pluginManager: manager });
    assert.equal(await fs.readFile(path.join(pluginsDir, plugin, 'index.js'), 'utf8'), 'old code');
    assert.equal(await fs.readFile(path.join(dataDir, plugin, 'settings.json'), 'utf8'), 'old settings');
    assert.equal(await fs.readFile(path.join(dataDir, 'Unrelated', 'settings.json'), 'utf8'), 'keep unrelated');
    assert.equal((await manager.store.read()).enabled.includes('Unrelated'), true);
    assert.equal((await manager.store.read()).enabled.includes('QtilerAuth'), true);
    if (plugin !== 'QtilerAuth') await assertAuthFilesUnchanged(authFiles);
    else assert.equal(await fs.readFile(path.join(dataDir, 'auth-config.json'), 'utf8'), authFiles.get(path.join(dataDir, 'auth-config.json')));
    assert.equal((await readInstallationStatus(dataDir, manager, revision)).rolledBack, true);
  });
}

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
  let uninstallReads = 0;
  const uninstalled = await waitForPluginUninstallation('/plugins/uninstallations/12345678-1234-1234-1234-123456789abc', { ...options, read: async () => ({ state: ++uninstallReads === 1 ? 'uninstalling' : 'ready' }) });
  assert.equal(uninstalled.state, 'ready');
  assert.equal(uninstallReads, 2);
  await assert.rejects(waitForPluginUninstallation('/plugins/uninstallations/12345678-1234-1234-1234-123456789abc', { ...options, read: async () => ({ state: 'failed', error: 'locked' }) }), /Could not remove plugin files/i);
});

test('replacement upload requires a choice, cancels without retrying, and sends the selected mode', async () => {
  for (const choice of ['preserve', 'reset', null]) {
    const body = new FormData();
    let attempts = 0;
    const send = async form => {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error('Exists'), { code: 'plugin_exists', payload: { plugin: { name: 'Qtiler2Hajk' } } });
      assert.equal(form.get('installMode'), choice);
      return { status: 'loading' };
    };
    const installation = uploadPluginArchive(body, () => {}, { send, confirmReplacement: async plugin => { assert.equal(plugin.name, 'Qtiler2Hajk'); return choice; } });
    if (choice) { assert.equal((await installation).status, 'loading'); assert.equal(attempts, 2); }
    else { await assert.rejects(installation, error => error.code === 'installation_cancelled'); assert.equal(attempts, 1); }
  }
});

test('replacement and progress messages are translated in all six Qtiler languages', () => {
  for (const language of ['en', 'es', 'sv', 'no', 'da', 'fi']) {
    for (const key of ['exists', 'preserve', 'reset', 'acknowledge', 'protected', 'cancel', 'replace', 'cancelled', 'busy', 'restored', 'title', 'uploading', 'preparing', 'starting']) {
      const text = pluginInstallationText(key, { plugin: 'QtilerAuth' }, language);
      assert.notEqual(text, key);
      assert.ok(!text.includes('{plugin}'));
    }
  }
  assert.match(pluginInstallationText('exists', { plugin: '<QtilerAuth>' }, 'es'), /<QtilerAuth>/);
});

test('3D Eye uses the shared commercial catalog and generator pricing at 700 EUR per year', async () => {
  const source = await fs.readFile(new URL('../routes/plugins.js', import.meta.url), 'utf8');
  const block = source.match(/const pricing = (\{[\s\S]*?\n\s*\});/);
  assert.ok(block);
  const pricing = vm.runInNewContext('(' + block[1] + ')');
  assert.equal(pricing['Qtiler-3D-eye'].price, 700);
  assert.equal(pricing['Qtiler-3D-eye'].currency, 'EUR');
  assert.equal(pricing['Qtiler-3D-eye'].period, 'year');
  assert.equal(pricing.QtilerAuth.price, 250, '3D pricing must not modify Auth pricing');
  const generator = await fs.readFile(new URL('./generate-license-ui.mjs', import.meta.url), 'utf8');
  const loaderStart = generator.indexOf('const loadPricingFromRouteConfig =');
  const loaderEnd = generator.indexOf('\nlet PRICING =', loaderStart);
  const generatorPricing = vm.runInNewContext(generator.slice(loaderStart, loaderEnd) + '\nloadPricingFromRouteConfig();', {
    fs: { existsSync: () => true, readFileSync: () => source }, PLUGINS_ROUTE_FILE: 'fixture', DEFAULT_PRICING: {}
  });
  assert.equal(generatorPricing['Qtiler-3D-eye'].amount, 700, 'The license/invoice generator must recognize hyphenated plugin names');
  assert.equal(generatorPricing['Qtiler-3D-eye'].currency, 'EUR');
});

test('3D administration uses Qtiler language state and the shared six-language translator', async () => {
  const html = await fs.readFile(new URL('../plugins/Qtiler-3D-eye/admin-ui/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('src="/lang-support.js"'));
  assert.ok(html.includes('/view/i18n.js?v='));
  assert.ok(html.includes('data-qtiler3d-i18n="ui:refresh"'));
  const source = await fs.readFile(new URL('../plugins/Qtiler-3D-eye/client/i18n.js', import.meta.url), 'utf8');
  for (const language of ['en', 'es', 'sv', 'no', 'da', 'fi']) {
    const scope = { window: { qtilerLang: { get: () => language, subscribe: () => {} } }, document: { documentElement: {}, readyState: 'loading', addEventListener: () => {} } };
    vm.runInNewContext(source, scope);
    assert.notEqual(scope.window.qtiler3dI18n.t('ui', 'refresh'), 'refresh');
    assert.notEqual(scope.window.qtiler3dI18n.t('ui', 'settings'), 'settings');
  }
});

test('failed deferred file removal preserves the plugin and reports an uninstall failure', async context => {
  const { pluginsDir, dataDir } = await fixture(context);
  const plugin = path.join(pluginsDir, 'Qtiler-3D-eye');
  await fs.mkdir(plugin);
  await fs.writeFile(path.join(plugin, 'index.js'), '3D plugin code');
  const operationId = '11111111-2222-4333-8444-555555555555';
  await fs.mkdir(path.join(pluginsDir, `.Qtiler-3D-eye.uninstall-${operationId}`));
  await fs.mkdir(path.join(dataDir, 'plugin-operations'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'plugin-operations', `uninstall-${operationId}.json`), JSON.stringify({ id: operationId, plugin: 'Qtiler-3D-eye', state: 'uninstalling', keepData: true }));
  await fs.writeFile(path.join(dataDir, PENDING_UNINSTALLATION), JSON.stringify({ id: operationId, plugin: 'Qtiler-3D-eye' }));
  await assert.rejects(finalizeUninstallation(dataDir, pluginsDir, operationId));
  assert.equal(await fs.readFile(path.join(plugin, 'index.js'), 'utf8'), '3D plugin code');
  assert.equal((await readUninstallationStatus(dataDir, operationId)).state, 'failed');
  assert.equal((await readUninstallationStatus(dataDir, operationId)).error, 'plugin_remove_failed');
  await assert.rejects(fs.access(path.join(dataDir, PENDING_UNINSTALLATION)), error => error.code === 'ENOENT');
});

test('deferred uninstall retries transient Windows rename locks and removes code and data when requested', async context => {
  const { pluginsDir, dataDir } = await fixture(context);
  const plugin = path.join(pluginsDir, 'Qtiler-3D-eye');
  const pluginData = path.join(dataDir, 'Qtiler-3D-eye');
  await fs.mkdir(plugin);
  await fs.writeFile(path.join(plugin, 'index.js'), '3D plugin code');
  await fs.mkdir(pluginData);
  await fs.writeFile(path.join(pluginData, 'maps.json'), '[]');
  const operationId = '11111111-2222-4333-8444-777777777777';
  await fs.mkdir(path.join(dataDir, 'plugin-operations'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'plugin-operations', `uninstall-${operationId}.json`), JSON.stringify({ id: operationId, plugin: 'Qtiler-3D-eye', state: 'uninstalling', keepData: false }));
  await fs.writeFile(path.join(dataDir, PENDING_UNINSTALLATION), JSON.stringify({ id: operationId, plugin: 'Qtiler-3D-eye' }));
  const originalRename = fs.rename;
  let transientFailures = 0;
  fs.rename = async (source, destination) => {
    if (source === plugin && transientFailures === 0) {
      transientFailures += 1;
      const error = new Error('temporary Windows directory lock');
      error.code = 'EPERM';
      throw error;
    }
    return originalRename(source, destination);
  };
  try {
    const result = await finalizeUninstallation(dataDir, pluginsDir, operationId);
    assert.equal(result.state, 'ready');
    assert.equal(result.removedFiles, true);
    assert.equal(result.removedData, true);
    await assert.rejects(fs.access(plugin), error => error.code === 'ENOENT');
    await assert.rejects(fs.access(pluginData), error => error.code === 'ENOENT');
  } finally {
    fs.rename = originalRename;
  }
});

test('startup recovers an interrupted uninstall without removing the package', async context => {
  const { pluginsDir, dataDir, manager } = await fixture(context);
  const operationId = '11111111-2222-4333-8444-666666666666';
  await fs.mkdir(path.join(pluginsDir, 'Qtiler-3D-eye'));
  await fs.writeFile(path.join(pluginsDir, 'Qtiler-3D-eye', 'index.js'), 'retain me');
  await fs.mkdir(path.join(dataDir, 'plugin-operations'), { recursive: true });
  await manager.store.write({ enabled: ['QtilerAuth'] });
  await fs.writeFile(path.join(dataDir, 'plugin-operations', `uninstall-${operationId}.json`), JSON.stringify({ plugin: 'Qtiler-3D-eye', state: 'uninstalling' }));
  await fs.writeFile(path.join(dataDir, PENDING_UNINSTALLATION), JSON.stringify({ id: operationId, plugin: 'Qtiler-3D-eye', wasEnabled: true, ownerPid: 12345 }));
  const recovered = await recoverInterruptedUninstallation(dataDir, manager, () => false);
  assert.equal(recovered.plugin, 'Qtiler-3D-eye');
  assert.equal(await fs.readFile(path.join(pluginsDir, 'Qtiler-3D-eye', 'index.js'), 'utf8'), 'retain me');
  assert.deepEqual((await manager.store.read()).enabled, ['QtilerAuth', 'Qtiler-3D-eye']);
  assert.equal((await readUninstallationStatus(dataDir, operationId)).state, 'failed');
  await assert.rejects(fs.access(path.join(dataDir, PENDING_UNINSTALLATION)), error => error.code === 'ENOENT');
});

test('graceful worker disposal releases optional plugin resources before Auth', async context => {
  const { manager } = await fixture(context);
  manager.registry.clear();
  const order = [];
  manager.registry.set('QtilerAuth', { api: { dispose: async () => { order.push('QtilerAuth'); } } });
  manager.registry.set('Qtiler-3D-eye', { api: { dispose: async () => { order.push('Qtiler-3D-eye'); } } });
  await manager.disposeAllPlugins();
  assert.deepEqual(order, ['Qtiler-3D-eye', 'QtilerAuth']);
  assert.equal(manager.registry.size, 0);
  assert.equal(manager.listEnabled().length, 0);
  assert.deepEqual((await manager.store.read()).enabled, ['QtilerAuth', 'Hajk'], 'Graceful worker disposal must not alter persisted activation');
});