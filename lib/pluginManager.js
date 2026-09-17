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
          await this.updateEnabledList((enabledSet) => {
            enabledSet.delete(name);
            return enabledSet;
          });
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

  async updateEnabledList(mutator) {
    return this.withEnabledStoreLock(async () => {
      const snapshot = await this.store.read();
      const current = new Set(Array.isArray(snapshot?.enabled) ? snapshot.enabled : []);
      const next = await mutator(current);
      const enabled = Array.from(next);
      await this.store.write({ ...(snapshot && typeof snapshot === 'object' ? snapshot : {}), enabled });
      this.enabled = new Set(enabled);
      return enabled;
    });
  }

  async enablePlugin(name) {
    if (!(await this.isLicenseAllowed(name))) {
      throw new Error(`Plugin ${name} cannot be enabled without an active commercial license.`);
    }
    const enabled = await this.updateEnabledList((enabledSet) => {
      enabledSet.add(name);
      return enabledSet;
    });
    if (enabled.includes(name) && this.registry.has(name)) return;
    await this.loadPlugin(name, { reloading: false });
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
    const entry = this.registry.get(name);
    if (entry && entry.api && typeof entry.api.dispose === 'function') {
      try {
        await entry.api.dispose();
      } catch (err) {
        console.warn(`Plugin ${name} dispose failed`, err);
      }
    }
    this.registry.delete(name);
    await this.updateEnabledList((enabledSet) => {
      enabledSet.delete(name);
      return enabledSet;
    });
  }
}
