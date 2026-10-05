/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { createJsonStore } from './jsonStore.js';

const ensureDir = async (dirPath) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
};

export class PluginManager {
  constructor({ app, baseDir, dataDir, security }) {
    this.app = app;
    this.baseDir = baseDir;
    this.dataDir = dataDir;
    this.security = security;
    this.enabled = new Set();
    this.store = createJsonStore(path.join(dataDir, 'plugins.json'), { enabled: [] });
    this.registry = new Map();
    this.licenseGuard = null;
    this.enabledLockPath = path.join(dataDir, 'plugins.json.lock');
    this.disposeTimeoutMs = Math.max(100, parseInt(process.env.PLUGIN_DISPOSE_TIMEOUT_MS || '10000', 10) || 10000);
  }

  setLicenseGuard(guard) {
    this.licenseGuard = typeof guard === 'function' ? guard : null;
  }

  async isLicenseAllowed(name) {
    if (!this.licenseGuard) return true;
    return (await this.licenseGuard(name)) !== false;
  }

  async init() {
    const snapshot = await this.store.read();
    const enabledList = Array.isArray(snapshot?.enabled) ? snapshot.enabled : [];
    this.enabled = new Set(enabledList);
    for (const name of this.enabled) {
      try {
        if (!(await this.isLicenseAllowed(name))) {
          // Keep the entry in plugins.json: a licence verdict must never be
          // destructive, or a transient read error permanently uninstalls it.
          this.enabled.delete(name);
          console.warn(`Plugin ${name} not loaded: commercial license is not active.`);
          continue;
        }
        await this.loadPlugin(name, { reloading: false });
      } catch (err) {
        console.error(`Failed to load plugin ${name}:`, err);
      }
    }
  }

  async loadPlugin(name, { reloading = false } = {}) {
    if (!(await this.isLicenseAllowed(name))) {
      throw new Error(`Plugin ${name} cannot be loaded without an active commercial license.`);
    }
    const pluginDir = path.join(this.baseDir, name);
    const entry = path.join(pluginDir, 'index.js');
    try {
      await fs.promises.access(entry, fs.constants.R_OK);
    } catch (err) {
      throw new Error(`Plugin ${name} is missing entry file at ${entry}`);
    }
    const url = pathToFileURL(entry).href + (reloading ? `?t=${Date.now()}` : '');
    const mod = await import(url);
    if (!mod || typeof mod.register !== 'function') {
      throw new Error(`Plugin ${name} must export register()`);
    }
    const pluginDataDir = path.join(this.dataDir, name);
    await ensureDir(pluginDataDir);
    const context = {
      app: this.app,
      security: this.security,
      dataDir: pluginDataDir,
      baseDir: pluginDir,
      registerStore: (relativePath, defaultValue) => {
        const storePath = path.join(pluginDataDir, relativePath);
        return createJsonStore(storePath, defaultValue);
      }
    };
    const api = await mod.register(context);
    this.registry.set(name, { api, dataDir: pluginDataDir });
    console.log(`Plugin loaded: ${name}`);
  }

  async withEnabledStoreLock(operation) {
    await ensureDir(this.dataDir);
    let handle = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        handle = await fs.promises.open(this.enabledLockPath, 'wx');
        break;
      } catch (err) {
        if (err?.code !== 'EEXIST') throw err;
        try {
          const stat = await fs.promises.stat(this.enabledLockPath);
          if (Date.now() - stat.mtimeMs > 15000) await fs.promises.unlink(this.enabledLockPath);
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (!handle) throw new Error('Timed out waiting for plugins.json lock');
    try {
      return await operation();
    } finally {
      await handle.close().catch(() => {});
      await fs.promises.unlink(this.enabledLockPath).catch(() => {});
    }
  }

  async acquireOperationLock() {
    await ensureDir(this.dataDir);
    const lockPath = path.join(this.dataDir, 'plugin-operation.lock');
    const handle = await fs.promises.open(lockPath, 'wx').catch(async (err) => {
      if (err.code !== 'EEXIST') throw err;
      const owner = Number(await fs.promises.readFile(lockPath, 'utf8').catch(() => ''));
      if (Number.isInteger(owner) && owner > 0) {
        try {
          process.kill(owner, 0);
        } catch (ownerErr) {
          if (ownerErr.code === 'ESRCH') {
            await fs.promises.unlink(lockPath);
            return fs.promises.open(lockPath, 'wx');
          }
        }
      }
      throw Object.assign(new Error('Another plugin installation or removal is in progress. Retry when it finishes.'), { statusCode: 409, code: 'PLUGIN_OPERATION_BUSY' });
    });
    await handle.writeFile(String(process.pid));
    return async () => {
      await handle.close();
      await fs.promises.unlink(lockPath).catch(() => {});
    };
  }

  async updateEnabledList(mutator) {
    return this.withEnabledStoreLock(async () => {
      const snapshot = await this.store.read();
      const current = new Set(Array.isArray(snapshot?.enabled) ? snapshot.enabled : []);
      const next = await mutator(current);
      const enabled = Array.from(next);
      await this.store.write({ ...(snapshot && typeof snapshot === 'object' ? snapshot : {}), enabled });
      return enabled;
    });
  }

  async enablePlugin(name) {
    if (!(await this.isLicenseAllowed(name))) {
      throw new Error(`Plugin ${name} cannot be enabled without an active commercial license.`);
    }
    if (this.registry.has(name) && this.enabled.has(name)) return;
    await this.loadPlugin(name, { reloading: false });
    try {
      await this.updateEnabledList((enabledSet) => {
        enabledSet.add(name);
        return enabledSet;
      });
      this.enabled.add(name);
    } catch (err) {
      await this.unloadPlugin(name);
      throw err;
    }
  }

  async reloadPlugin(name) {
    if (!this.enabled.has(name)) {
      throw new Error(`Plugin ${name} is not enabled`);
    }
    await this.loadPlugin(name, { reloading: true });
  }

  listEnabled() {
    return Array.from(this.enabled);
  }

  getRegistry() {
    return this.registry;
  }

  getPluginApi(name) {
    return this.registry.get(name)?.api || null;
  }

  async disablePlugin(name) {
    await this.unloadPlugin(name);
    await this.updateEnabledList((enabledSet) => {
      enabledSet.delete(name);
      return enabledSet;
    });
    this.enabled.delete(name);
  }

  // Stops serving a plugin without editing plugins.json, so it comes back on
  // its own once a valid licence is present again.
  async deactivatePlugin(name) {
    await this.unloadPlugin(name);
    this.enabled.delete(name);
  }

  async unloadPlugin(name) {
    const entry = this.registry.get(name);
    if (entry && entry.api && typeof entry.api.dispose === 'function') {
      let timeout = null;
      try {
        await Promise.race([
          Promise.resolve().then(() => entry.api.dispose()),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error(`dispose timed out after ${this.disposeTimeoutMs} ms`)), this.disposeTimeoutMs);
          })
        ]);
      } catch (err) {
        console.warn(`Plugin ${name} dispose failed`, err);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    this.registry.delete(name);
  }
}
