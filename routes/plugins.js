/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

import fs from "fs";
import os from "os";
import path from "path";
import AdmZip from "adm-zip";

export const registerPluginRoutes = ({
  app,
  pluginManager,
  security,
  pluginsDir,
  dataDir,
  requireAdmin,
  requireAdminIfEnabled,
  applySecurityDefaults,
  pluginUpload,
  sanitizePluginName,
  resolvePluginRoot,
  detectPluginName,
  copyRecursive,
  removeRecursive
}) => {
  const requestClusterRestart = () => {
    try {
      if (typeof process.send === 'function') {
        process.send({ cmd: 'restartAllWorkers' });
      } else {
        process.exit(0);
      }
    } catch (err) {
      console.warn('[plugins] Failed to request cluster restart', err);
      try { process.exit(0); } catch (_) { /* noop */ }
    }
  };
  // Allow non-admin access to plugins list if no auth plugin is enabled (to install first plugin)
  app.get("/plugins", async (req, res) => {
    if (security.isEnabled && security.isEnabled()) {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    try {
      let installed = [];
      try {
        const entries = await fs.promises.readdir(pluginsDir, { withFileTypes: true });
        installed = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
      } catch (dirErr) {
        if (dirErr.code !== "ENOENT") throw dirErr;
      }
      const installedSet = new Set(installed);
      const enabled = pluginManager.listEnabled();

      for (const name of enabled) {
        if (!installedSet.has(name)) {
          try {
            await pluginManager.disablePlugin(name);
            console.warn(`[Qtiler] Disabled missing plugin '${name}' (directory not found).`);
          } catch (disableErr) {
            console.warn(`[Qtiler] Failed to disable missing plugin '${name}':`, disableErr);
          }
        }
      }

      if (pluginManager.listEnabled().length === 0) {
        applySecurityDefaults();
      }

      res.json({ installed, enabled: pluginManager.listEnabled() });
    } catch (err) {
      res.status(500).json({ error: "plugin_list_failed", details: String(err) });
    }
  });

  /* 
   * Manual enable/disable routes removed to enforce auto-enable on install 
   * and auto-disable on uninstall workflow.
   */
  /*
  app.post("/plugins/:name/enable", requireAdminIfEnabled, async (req, res) => {
    // ...
  });

  app.post("/plugins/:name/disable", requireAdmin, async (req, res) => {
    // ...
  });
  */

  app.delete("/plugins/:name", requireAdmin, async (req, res) => {
    const raw = req.params.name;
    const pluginName = sanitizePluginName(raw);
    if (!pluginName) {
      return res.status(400).json({ error: "plugin_name_required" });
    }
    const pluginPath = path.join(pluginsDir, pluginName);
    const pluginDataPath = path.join(dataDir, pluginName);
    const exists = fs.existsSync(pluginPath);
    const wasEnabled = pluginManager.listEnabled().includes(pluginName);
    try {
      if (wasEnabled) {
        await pluginManager.disablePlugin(pluginName);
      }
    } catch (disableErr) {
      return res.status(500).json({ error: "plugin_disable_failed", details: String(disableErr?.message || disableErr) });
    }

    let removedFiles = false;
    if (exists) {
      try {
        await removeRecursive(pluginPath);
        removedFiles = true;
      } catch (rmErr) {
        return res.status(500).json({ error: "plugin_remove_failed", details: String(rmErr?.message || rmErr) });
      }
    }

    let removedData = false;
    if (req.query.keepData !== "1") {
      try {
        await removeRecursive(pluginDataPath);
        removedData = true;
      } catch (rmDataErr) {
        if (rmDataErr?.code !== "ENOENT") {
          return res.status(500).json({ error: "plugin_data_remove_failed", details: String(rmDataErr?.message || rmDataErr) });
        }
      }
    }

    if (!wasEnabled && !exists) {
      return res.status(404).json({ error: "plugin_not_found" });
    }

    if (pluginManager.listEnabled().length === 0) {
      applySecurityDefaults();
      // Force reset of security object if it was modified by a plugin but not fully restored
      if (typeof security.isEnabled === 'function' && security.isEnabled()) {
         console.warn('[Qtiler] Security still enabled after uninstalling all plugins. Forcing reset.');
         applySecurityDefaults();
      }
    }

    res.json({
      status: "uninstalled",
      plugin: {
        name: pluginName,
        wasEnabled,
        removedFiles,
        removedData
      }
    });

    // Restart all workers so every process sees the updated plugin state
    requestClusterRestart();
    // Also restart this worker as a fallback to ensure state is fresh
    setTimeout(() => process.exit(0), 150);
  });

  app.post("/plugins/upload", requireAdminIfEnabled, (req, res) => {
    pluginUpload.single("plugin")(req, res, async (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "plugin_archive_too_large" });
        }
        if (err.code === "UNSUPPORTED_PLUGIN_ARCHIVE") {
          return res.status(400).json({ error: "unsupported_plugin_archive" });
        }
        return res.status(500).json({ error: "plugin_upload_failed", details: String(err) });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "plugin_archive_required" });
      }

      let tempDir = null;
      try {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qtiler-plugin-"));
        const extractDir = path.join(tempDir, "extract");
        await fs.promises.mkdir(extractDir, { recursive: true });

        try {
          if (!file.path) {
            throw Object.assign(new Error("plugin_upload_missing"), { statusCode: 500, code: "PLUGIN_UPLOAD_MISSING" });
          }
          const zip = new AdmZip(file.path);
          zip.extractAllTo(extractDir, true);
        } catch (zipErr) {
          throw Object.assign(new Error("plugin_archive_invalid"), { statusCode: 400, code: "PLUGIN_ARCHIVE_INVALID", details: zipErr.message });
        }

        const pluginRoot = await resolvePluginRoot(extractDir);

        try {
          await fs.promises.access(path.join(pluginRoot, "index.js"), fs.constants.R_OK);
        } catch {
          throw Object.assign(new Error("plugin_entry_missing"), { statusCode: 400, code: "PLUGIN_ENTRY_MISSING" });
        }

        const provided = sanitizePluginName(req.body?.pluginName || req.body?.name || "");
        const inferredName = await detectPluginName(pluginRoot, provided || path.basename(pluginRoot));
        const pluginName = sanitizePluginName(inferredName || provided || path.basename(pluginRoot) || "");
        if (!pluginName) {
          throw Object.assign(new Error("plugin_name_required"), { statusCode: 400, code: "PLUGIN_NAME_REQUIRED" });
        }

        const destination = path.join(pluginsDir, pluginName);

        // If plugin is already enabled or installed, disable and remove old files before replacing
        const wasEnabled = pluginManager.listEnabled().includes(pluginName);
        if (wasEnabled) {
          try {
            await pluginManager.disablePlugin(pluginName);
          } catch (disableErr) {
            throw Object.assign(disableErr, { statusCode: 500, code: "PLUGIN_DISABLE_FAILED" });
          }
        }
        await removeRecursive(destination);
        await copyRecursive(pluginRoot, destination);

        try {
          await pluginManager.enablePlugin(pluginName);
        } catch (loadErr) {
          await removeRecursive(destination).catch(() => { });
          throw Object.assign(loadErr, { statusCode: 500, code: "PLUGIN_ENABLE_FAILED" });
        }

        const response = { status: "enabled", plugin: { name: pluginName } };
        // Restart all workers so the newly enabled plugin is picked up cluster-wide
        requestClusterRestart();
        // Also restart this worker as a fallback to ensure state is fresh
        setTimeout(() => process.exit(0), 150);
        return res.status(201).json(response);
      } catch (uploadErr) {
        const statusCode = uploadErr.statusCode && Number.isInteger(uploadErr.statusCode) ? uploadErr.statusCode : 500;
        const code = uploadErr.code || "PLUGIN_UPLOAD_FAILED";
        const details = uploadErr.details || uploadErr.message || String(uploadErr);
        return res.status(statusCode).json({ error: code, details });
      } finally {
        if (file?.path) {
          try {
            await fs.promises.unlink(file.path);
          } catch {
            // ignore cleanup errors
          }
        }
        if (tempDir) {
          await removeRecursive(tempDir).catch(() => { });
        }
      }
    });
  });
};
