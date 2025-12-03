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
  }

  async init() {
    const snapshot = await this.store.read();
    const enabledList = Array.isArray(snapshot?.enabled) ? snapshot.enabled : [];
    this.enabled = new Set(enabledList);
    for (const name of this.enabled) {
      try {
        await this.loadPlugin(name, { reloading: false });
      } catch (err) {
        console.error(`Failed to load plugin ${name}:`, err);
      }
    }
  }

  async loadPlugin(name, { reloading = false } = {}) {
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

  async enablePlugin(name) {
    if (this.enabled.has(name)) return;
    this.enabled.add(name);
    await this.store.update((draft) => {
      const enabledSet = new Set(Array.isArray(draft?.enabled) ? draft.enabled : []);
      enabledSet.add(name);
      return { enabled: Array.from(enabledSet) };
    });
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
    if (!this.enabled.has(name)) return;
    const entry = this.registry.get(name);
    if (entry && entry.api && typeof entry.api.dispose === 'function') {
      try {
        await entry.api.dispose();
      } catch (err) {
        console.warn(`Plugin ${name} dispose failed`, err);
      }
    }
    this.registry.delete(name);
    this.enabled.delete(name);
    await this.store.update((draft) => {
      const enabledArray = Array.isArray(draft?.enabled) ? draft.enabled : [];
      const filtered = enabledArray.filter((item) => item !== name);
      return { enabled: filtered };
    });
  }
}
