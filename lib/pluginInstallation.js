import fs from 'node:fs/promises';
import path from 'node:path';

export const INSTALL_RECEIPT = '.qtiler-installation.json';
export const PENDING_INSTALLATION = 'plugin-operations/pending.json';
export const PENDING_UNINSTALLATION = 'plugin-operations/pending-uninstall.json';

export async function recoverInterruptedUninstallation(dataDir, pluginManager, isProcessAlive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; return true; }
}) {
  const pendingPath = path.join(dataDir, PENDING_UNINSTALLATION);
  let pending;
  try { pending = JSON.parse(await fs.readFile(pendingPath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!pending || !/^[a-f0-9-]{36}$/i.test(pending.id || '') || !/^[A-Za-z0-9_-]+$/.test(pending.plugin || '')) throw new Error('Invalid pending uninstall marker');
  if (Number.isInteger(pending.ownerPid) && isProcessAlive(pending.ownerPid)) return null;
  if (pending.wasEnabled) await pluginManager.updateEnabledList(enabled => { enabled.add(pending.plugin); return enabled; });
  const operationPath = path.join(dataDir, 'plugin-operations', `uninstall-${pending.id}.json`);
  let operation = {};
  try { operation = JSON.parse(await fs.readFile(operationPath, 'utf8')); } catch {}
  await fs.writeFile(operationPath, JSON.stringify({ ...operation, id: pending.id, plugin: pending.plugin, state: 'failed', error: 'Uninstall was interrupted; the existing package was retained.', recoveredAt: new Date().toISOString() }), 'utf8');
  await fs.unlink(pendingPath);
  return pending;
}

export async function finalizeUninstallation(dataDir, pluginsDir, operationId) {
  if (typeof operationId !== 'string' || !/^[a-f0-9-]{36}$/i.test(operationId)) throw new Error('Invalid uninstall operation id');
  const operationPath = path.join(dataDir, 'plugin-operations', `uninstall-${operationId}.json`);
  const operation = JSON.parse(await fs.readFile(operationPath, 'utf8'));
  if (!/^[A-Za-z0-9_-]+$/.test(operation.plugin || '')) throw new Error('Invalid plugin name in uninstall operation');
  const pluginPath = path.join(pluginsDir, operation.plugin);
  const dataPath = path.join(dataDir, operation.plugin);
  const pluginBackup = path.join(pluginsDir, `.${operation.plugin}.uninstall-${operationId}`);
  const dataBackup = path.join(dataDir, `.${operation.plugin}.uninstall-${operationId}`);
  let movedPlugin = false;
  let movedData = false;
  const retryableRenameCodes = new Set(['EPERM', 'EBUSY', 'EACCES']);
  const renameWithRetry = async (source, destination) => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try { await fs.rename(source, destination); return; }
        catch (error) {
          if (!retryableRenameCodes.has(error.code) || attempt === 9) throw error;
          await new Promise(resolve => setTimeout(resolve, Math.min(250 * (attempt + 1), 2000)));
        }
      }
  };
  const removeWithRetry = async target => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try { await fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); return; }
      catch (error) { if (attempt === 9) throw error; await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1))); }
    }
  };
  const restoreBackup = async (backup, destination) => {
    try { await renameWithRetry(backup, destination); }
    catch (error) {
      if (!retryableRenameCodes.has(error.code)) throw error;
      await fs.cp(backup, destination, { recursive: true, force: false, errorOnExist: false, preserveTimestamps: true });
      await removeWithRetry(backup);
    }
  };
  try {
    try {
      await renameWithRetry(pluginPath, pluginBackup);
      movedPlugin = true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        movedPlugin = false;
      } else if (retryableRenameCodes.has(error.code)) {
        await fs.cp(pluginPath, pluginBackup, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
        movedPlugin = true;
        try { await removeWithRetry(pluginPath); }
        catch (removeError) {
          try {
            await fs.cp(pluginBackup, pluginPath, { recursive: true, force: false, errorOnExist: false, preserveTimestamps: true });
            await removeWithRetry(pluginBackup);
            movedPlugin = false;
          } catch (restoreError) { removeError.restoreError = restoreError.message; }
          throw removeError;
        }
      } else {
        throw error;
      }
    }
    if (!operation.keepData) {
      try { await renameWithRetry(dataPath, dataBackup); movedData = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (movedPlugin) await removeWithRetry(pluginBackup);
    if (movedData) await removeWithRetry(dataBackup);
    const result = { ...operation, state: 'ready', completedAt: new Date().toISOString(), removedFiles: movedPlugin, removedData: movedData };
    const temporary = `${operationPath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(result), 'utf8');
    await fs.rename(temporary, operationPath);
    return result;
  } catch (error) {
    try { if (movedPlugin && await fs.stat(pluginBackup).then(() => true, () => false)) await restoreBackup(pluginBackup, pluginPath); } catch (restoreError) { error.restoreError = restoreError.message; }
    try { if (movedData && await fs.stat(dataBackup).then(() => true, () => false)) await restoreBackup(dataBackup, dataPath); } catch (restoreError) { error.restoreError = restoreError.message; }
    const failed = { ...operation, state: 'failed', error: error.message, completedAt: new Date().toISOString() };
    await fs.writeFile(operationPath, JSON.stringify(failed), 'utf8').catch(() => {});
    throw error;
  } finally {
    const pendingPath = path.join(dataDir, PENDING_UNINSTALLATION);
    try { const pending = JSON.parse(await fs.readFile(pendingPath, 'utf8')); if (pending.id === operationId) await fs.unlink(pendingPath); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export async function readUninstallationStatus(dataDir, operationId) {
  if (typeof operationId !== 'string' || !/^[a-f0-9-]{36}$/i.test(operationId)) return { state: 'not_found' };
  try {
    const operation = JSON.parse(await fs.readFile(path.join(dataDir, 'plugin-operations', `uninstall-${operationId}.json`), 'utf8'));
    return { state: operation.state, plugin: operation.plugin, error: operation.state === 'failed' ? 'plugin_remove_failed' : null };
  } catch (error) { if (error.code === 'ENOENT') return { state: 'not_found' }; throw error; }
}

export async function clearPendingInstallation(dataDir, revision) {
  const filePath = path.join(dataDir, PENDING_INSTALLATION);
  try {
    const pending = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (pending.revision === revision) await fs.unlink(filePath);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export async function completeInstallation(dataDir, revision, workerRevisions, { pluginsDir, pluginManager } = {}) {
  if (typeof revision !== 'string' || !/^[a-f0-9-]{36}$/i.test(revision)) return;
  const state = workerRevisions.length > 0 && workerRevisions.every((revisions) => revisions?.has(revision)) ? 'ready' : 'failed';
  const filePath = path.join(dataDir, 'plugin-operations', `${revision}.json`);
  const operation = JSON.parse(await fs.readFile(filePath, 'utf8'));
  if (!/^[A-Za-z0-9_-]+$/.test(operation.plugin || '')) throw new Error('Invalid installation plugin name');
  const previousPackage = pluginsDir && operation.packageBackup && path.basename(operation.packageBackup) === operation.packageBackup && operation.packageBackup.startsWith(`.${operation.plugin}.previous-`)
    ? path.join(pluginsDir, operation.packageBackup) : null;
  const exists = async (target) => target && await fs.stat(target).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
  let rolledBack = false;
  if (state === 'failed' && pluginsDir && typeof operation.wasPersisted === 'boolean') {
    const destination = path.join(pluginsDir, operation.plugin);
    if (await exists(previousPackage)) {
      await fs.rm(destination, { recursive: true, force: true });
      await fs.rename(previousPackage, destination);
      rolledBack = true;
    } else if (!operation.wasPersisted && !operation.packageBackup) {
      await fs.rm(destination, { recursive: true, force: true });
      rolledBack = true;
    }
    if (operation.hasDataBackup) {
      const backup = path.join(dataDir, 'plugin-reset-backups', operation.plugin, revision);
      if (await exists(backup)) {
        const dataDestination = path.join(dataDir, operation.plugin);
        if (await exists(dataDestination)) await fs.rename(dataDestination, `${backup}-failed`);
        await fs.rename(backup, dataDestination);
        rolledBack = true;
      }
    }
    if (pluginManager) {
      await pluginManager.updateEnabledList(enabled => {
        if (operation.wasPersisted) enabled.add(operation.plugin);
        else enabled.delete(operation.plugin);
        return enabled;
      });
    }
  } else if (state === 'ready' && await exists(previousPackage)) {
    await fs.rm(previousPackage, { recursive: true, force: true }).catch(error => console.warn('Previous plugin package cleanup failed', error.message));
  }
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ ...operation, state, rolledBack }), 'utf8');
  await fs.rename(temporary, filePath);
  await clearPendingInstallation(dataDir, revision);
}

export async function readInstallationStatus(dataDir, manager, id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return { state: 'not_found' };
  let operation;
  try { operation = JSON.parse(await fs.readFile(path.join(dataDir, 'plugin-operations', `${id}.json`), 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return { state: 'not_found' }; throw err; }
  const loaded = manager.getRegistry().get(operation.plugin);
  const ready = operation.state === 'ready' && loaded?.revision === id;
  return { state: operation.state === 'failed' ? 'failed' : (ready ? 'ready' : 'loading'), plugin: operation.plugin, revision: id, rolledBack: operation.rolledBack === true, hasDataBackup: operation.hasDataBackup === true };
}