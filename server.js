/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import os from "os";
import { execFile, spawn } from "child_process";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
// Verificación automática de entorno QGIS/Python
function verifyQGISEnv() {
  const qgisBin = process.env.OSGEO4W_BIN || "C:\\QGIS\\bin";
  const pythonExe = process.env.PYTHON_EXE || "C:\\QGIS\\bin\\python.exe";
  const qgisPrefix = process.env.QGIS_PREFIX || "C:\\QGIS\\apps\\qgis";
  let missing = [];
  if (!fs.existsSync(qgisBin)) missing.push("OSGEO4W_BIN");
  if (!fs.existsSync(pythonExe)) missing.push("PYTHON_EXE");
  if (!fs.existsSync(qgisPrefix)) missing.push("QGIS_PREFIX");
  if (missing.length) {
    console.warn("[Qtiler] Entorno QGIS/Python incompleto. Faltan:", missing.join(", "));
    console.warn("Configura manualmente las rutas en .env (OSGEO4W_BIN, PYTHON_EXE, QGIS_PREFIX) antes de generar cachés.");
  } else {
    console.log("[Qtiler] Entorno QGIS/Python verificado.");
  }
}
verifyQGISEnv();
import crypto from "crypto";
import multer from "multer";
import AdmZip from "adm-zip";
import cookieParser from "cookie-parser";
import { PluginManager } from "./lib/pluginManager.js";
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", true);
const dataDir = path.resolve(__dirname, "data");
const pluginsDir = path.resolve(__dirname, "plugins");
const viewsDir = path.resolve(__dirname, "views");
const proj4PresetsPath = path.resolve(__dirname, "config", "proj4-presets.json");

const defaultProj4Presets = {
  // "EPSG:3006": "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs"
};

const loadProj4Presets = () => {
  try {
    const raw = fs.readFileSync(proj4PresetsPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...defaultProj4Presets };
    const normalized = { ...defaultProj4Presets };
    for (const [key, value] of Object.entries(parsed)) {
      if (!key || typeof value !== "string" || !value.trim()) continue;
      normalized[key.trim().toUpperCase()] = value.trim();
    }
    return normalized;
  } catch (err) {
    if (err && err.code !== "ENOENT") {
      console.warn("Failed to load proj4 presets", { error: String(err?.message || err) });
    }
    return { ...defaultProj4Presets };
  }
};

const proj4Presets = Object.freeze(loadProj4Presets());

app.set("views", viewsDir);
app.set("view engine", "ejs");

try {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
} catch (err) {
  console.error("Failed to ensure data directory", dataDir, err);
}

const security = {};

const applySecurityDefaults = () => {
  security.attachUser = (req, _res, next) => {
    req.user = null;
    next();
  };
  security.ensureRoles = (_req, _res, next) => next();
  security.ensureProjectAccess = (_req, _res, next) => next();
  security.isEnabled = () => false;
};

applySecurityDefaults();

const requireRoles = (...roles) => (req, res, next) => {
  try {
    const output = security.ensureRoles(req, res, next, roles);
    if (output && typeof output.then === "function") {
      output.catch(next);
    }
  } catch (err) {
    next(err);
  }
};

const requireAdmin = requireRoles("admin");

// Middleware that requires admin only if auth is enabled
const requireAdminIfEnabled = (req, res, next) => {
  if (security.isEnabled && security.isEnabled()) {
    return requireAdmin(req, res, next);
  }
  return next();
};

// Middleware specifically for admin page access (redirects instead of JSON)
const requireAdminPage = (req, res, next) => {
  if (security.isEnabled && security.isEnabled()) {
    if (!req.user) {
      return res.redirect('/login');
    }
    if (req.user.role !== 'admin') {
      return res.status(403).send(`
        <html>
          <head><title>Access Denied</title><link rel="stylesheet" href="/style.css"></head>
          <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
            <h1>Access Denied</h1>
            <p>You do not have permission to view this page.</p>
            <p>Current user: ${req.user.username || req.user.id} (Role: ${req.user.role})</p>
            <p><a href="/">Return to Home</a></p>
          </body>
        </html>
      `);
    }
  }
  next();
};

const ensureProjectAccess = (selector) => (req, res, next) => {
  try {
    const projectId = selector(req);
    const output = security.ensureProjectAccess(req, res, next, projectId);
    if (output && typeof output.then === "function") {
      output.catch(next);
    }
  } catch (err) {
    next(err);
  }
};

const ensureProjectAccessFromQuery = (param = "project") => ensureProjectAccess((req) => {
  const value = req.query ? req.query[param] : null;
  if (Array.isArray(value)) return value[0];
  return value || null;
});

const supportedLanguages = ["en", "es", "sv"];
const defaultLanguage = "en";

const normalizeLanguageCode = (value) => {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  if (supportedLanguages.includes(raw)) return raw;
  const base = raw.split(/[-_]/)[0];
  return supportedLanguages.includes(base) ? base : null;
};

const resolveLanguageOverride = (req) => {
  if (!req) return null;
  const candidates = [];
  if (req.cookies) {
    candidates.push(req.cookies.qtiler_lang, req.cookies["qtiler.lang"]);
  }
  if (req.query && Object.prototype.hasOwnProperty.call(req.query, "lang")) {
    const queryValue = Array.isArray(req.query.lang) ? req.query.lang[0] : req.query.lang;
    if (typeof queryValue === "string") {
      candidates.push(queryValue);
    }
  }
  const headerLang = typeof req.get === "function" ? req.get("x-qtiler-lang") : null;
  if (headerLang) {
    candidates.push(headerLang);
  }
  for (const candidate of candidates) {
    const normalized = normalizeLanguageCode(candidate);
    if (normalized) return normalized;
  }
  return null;
};

const detectPreferredLanguage = (req) => {
  const overrideLang = resolveLanguageOverride(req);
  if (overrideLang) {
    return overrideLang;
  }
  if (!req || typeof req.acceptsLanguages !== "function") return defaultLanguage;
  try {
    const match = req.acceptsLanguages(...supportedLanguages);
    if (!match || typeof match !== "string") return defaultLanguage;
    const normalized = match.split(/[-_]/)[0];
    return supportedLanguages.includes(normalized) ? normalized : defaultLanguage;
  } catch (err) {
    console.warn("Language negotiation failed", { error: String(err?.message || err) });
    return defaultLanguage;
  }
};

const renderPage = (req, res, viewName, locals = {}, options = {}) => {
  const { status = 200 } = options;
  const payload = {
    pageLang: detectPreferredLanguage(req),
    user: req?.user || null,
    authPluginInstallUrl: '/admin',
    proj4Presets,
    ...locals
  };

  res.status(status);
  res.render(viewName, payload, (err, html) => {
    if (err) {
      const errorStatus = status >= 400 ? status : 500;
      console.warn("Failed to render view", { viewName, error: String(err?.message || err) });
      if (!res.headersSent) {
        res.status(errorStatus).send("Failed to render page");
      }
      return;
    }
    return res.send(html);
  });
};

const pluginManager = new PluginManager({ app, baseDir: pluginsDir, dataDir, security });
app.locals.pluginManager = pluginManager;

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => security.attachUser(req, res, next));

// add: servir carpeta pública (sin index automático)
const publicDir = path.join(__dirname, "public");
const serviceMetadataPath = path.join(__dirname, "config", "service-metadata.json");
const tileGridDir = path.join(__dirname, "config", "tile-grids");
const projectAccessPath = path.join(dataDir, "QtilerAuth", "project-access.json");
const legacyProjectAccessPaths = [
  path.join(dataDir, "project-access.json"),
  path.join(dataDir, "auth", "project-access.json")
];
const authUserSnapshotPaths = [
  path.join(dataDir, "auth-users.json"),
  path.join(dataDir, "auth", "auth-users.json"),
  path.join(dataDir, "QtilerAuth", "auth-users.json")
];
const authPluginInstallUrl = "/admin";
const authPluginRequiredResponse = {
  error: "auth_plugin_disabled",
  message: "Authentication requires the QtilerAuth plugin to be installed.",
  installUrl: authPluginInstallUrl
};

const authAdminUiCandidates = [
  path.join(pluginsDir, "QtilerAuth", "admin-ui"),
  path.join(pluginsDir, "qtilerauth", "admin-ui"),
  path.join(pluginsDir, "auth", "admin-ui"),
  path.join(publicDir, "auth-admin")
];

const resolveAuthAdminUiDir = () => {
  for (const candidate of authAdminUiCandidates) {
    try {
      const indexPath = path.join(candidate, "index.html");
      if (fs.existsSync(indexPath)) {
        return candidate;
      }
    } catch (err) {
      console.warn("Auth admin UI path check failed", { candidate, error: String(err) });
    }
  }
  return null;
};

const normalizeZoomInput = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.floor(parsed));
};

const DEFAULT_PUBLISH_ZOOM_MIN = (() => {
  const parsed = normalizeZoomInput(process.env.WMTS_DEFAULT_PUBLISH_ZOOM_MIN);
  if (parsed === null || parsed < 0) {
    return 0;
  }
  return parsed;
})();

const DEFAULT_PUBLISH_ZOOM_MAX = (() => {
  const parsed = normalizeZoomInput(process.env.WMTS_DEFAULT_PUBLISH_ZOOM_MAX);
  if (parsed === null) {
    return 20;
  }
  return Math.max(parsed, DEFAULT_PUBLISH_ZOOM_MIN);
})();

const WEB_MERCATOR_EXTENT = 20037508.342789244;
const TILE_SIZE_PX = 256;

const ENABLE_PROJECT_BOOTSTRAP = String(process.env.DISABLE_PROJECT_BOOTSTRAP || "").trim().toLowerCase() !== "true";
const BOOTSTRAP_TILE_CRS = (process.env.PROJECT_BOOTSTRAP_TILE_CRS || "EPSG:3857").trim().toUpperCase() || "EPSG:3857";
const RAW_BOOTSTRAP_SCHEME = (process.env.PROJECT_BOOTSTRAP_SCHEME || "xyz").trim().toLowerCase();
const BOOTSTRAP_SCHEME = RAW_BOOTSTRAP_SCHEME === "wmts" ? "wmts" : "xyz";
const BOOTSTRAP_ZOOM_MIN_SOURCE = normalizeZoomInput(process.env.PROJECT_BOOTSTRAP_ZOOM_MIN);
const BOOTSTRAP_ZOOM_MAX_SOURCE = normalizeZoomInput(process.env.PROJECT_BOOTSTRAP_ZOOM_MAX);
const BOOTSTRAP_ZOOM_MIN = BOOTSTRAP_ZOOM_MIN_SOURCE != null ? BOOTSTRAP_ZOOM_MIN_SOURCE : DEFAULT_PUBLISH_ZOOM_MIN;
const BOOTSTRAP_ZOOM_MAX = BOOTSTRAP_ZOOM_MAX_SOURCE != null
  ? Math.max(BOOTSTRAP_ZOOM_MAX_SOURCE, BOOTSTRAP_ZOOM_MIN)
  : Math.max(DEFAULT_PUBLISH_ZOOM_MAX, BOOTSTRAP_ZOOM_MIN);
const BOOTSTRAP_EXTENT_FALLBACK = [-WEB_MERCATOR_EXTENT, -WEB_MERCATOR_EXTENT, WEB_MERCATOR_EXTENT, WEB_MERCATOR_EXTENT];

let cachedTileGridPresets = null;

const invalidateTileGridCaches = () => {
  cachedTileGridPresets = null;
  bootstrapPresetCache.clear();
};

const loadTileGridPresets = () => {
  if (cachedTileGridPresets) {
    return cachedTileGridPresets;
  }

  cachedTileGridPresets = [];
  try {
    if (!fs.existsSync(tileGridDir)) {
      return cachedTileGridPresets;
    }
    const entries = fs.readdirSync(tileGridDir);
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith(".json")) {
        continue;
      }
      const presetPath = path.join(tileGridDir, entry);
      try {
        const raw = JSON.parse(fs.readFileSync(presetPath, "utf8"));
        const id = raw?.id || path.basename(entry, ".json");
        const supportedRaw = raw?.supported_crs;
        let supportedCrs = [];
        if (typeof supportedRaw === "string" && supportedRaw.trim()) {
          supportedCrs = [supportedRaw.trim().toUpperCase()];
        } else if (Array.isArray(supportedRaw)) {
          supportedCrs = supportedRaw.map((item) => (typeof item === "string" ? item.trim().toUpperCase() : "")).filter(Boolean);
        }
        cachedTileGridPresets.push({
          id,
          fileName: path.basename(entry, ".json"),
          supportedCrs,
          path: presetPath
        });
      } catch (err) {
        console.warn("Failed to load tile grid preset", { presetPath, error: String(err?.message || err) });
      }
    }
  } catch (err) {
    console.warn("Unable to enumerate tile grid presets", { error: String(err?.message || err) });
  }
  return cachedTileGridPresets;
};

const findTileMatrixPresetForCrs = (crs) => {
  if (!crs) {
    return null;
  }
  const normalized = String(crs).trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  const presets = loadTileGridPresets();
  return presets.find((preset) => Array.isArray(preset.supportedCrs) && preset.supportedCrs.includes(normalized)) || null;
};

const sendAccessDenied = (req, res) => {
  renderPage(req, res, "access-denied", { activeNav: "dashboard" }, { status: 403 });
};

const sendLoginPage = (req, res) => {
  renderPage(req, res, "login", { activeNav: "login" }, { status: 401 });
};

const ensureAdminForUi = (req, res, next) => {
  if (!security.isEnabled()) {
    const availableDir = resolveAuthAdminUiDir();
    const normalizedPublic = path.resolve(publicDir).toLowerCase();
    const normalizedAvailable = availableDir ? path.resolve(availableDir).toLowerCase() : null;
    if (normalizedAvailable && normalizedAvailable.startsWith(normalizedPublic)) {
      return next();
    }
    return res.status(501).send("Auth plugin is not enabled");
  }
  if (!req.user) {
    return sendLoginPage(req, res);
  }
  if (req.user.role !== "admin") {
    return sendAccessDenied(req, res);
  }
  return next();
};

const sendAuthAdminPage = (res) => {
  const dir = resolveAuthAdminUiDir();
  if (!dir) {
    // Redirect to the new admin panel instead of showing 501
    return res.redirect('/admin');
  }
  const filePath = path.join(dir, "index.html");
  res.sendFile(filePath, (err) => {
    if (!err) return;
    console.warn("Auth admin UI load failed", { filePath, code: err?.code, message: err?.message });
    if (err.code === "ENOENT") {
      return res.redirect('/admin');
    } else {
      res.status(500).send("Failed to load auth admin UI");
    }
  });
};

const serveAuthAdminStatic = (req, res, next) => {
  const dir = resolveAuthAdminUiDir();
  if (!dir) {
    return res.status(501).send("Auth admin UI not installed");
  }
  const staticMiddleware = express.static(dir);
  staticMiddleware(req, res, (err) => {
    if (err && err.code === "ENOENT") {
      return res.status(404).end();
    }
    return next(err);
  });
};

app.get("/plugins/auth-admin", ensureAdminForUi, (_req, res) => {
  sendAuthAdminPage(res);
});

app.use("/plugins/auth-admin/assets", ensureAdminForUi, serveAuthAdminStatic);

app.use("/plugins/auth-admin", ensureAdminForUi, (req, res, next) => {
  if (!req.path || req.path === "/" || req.path === "") {
    return next();
  }
  return serveAuthAdminStatic(req, res, next);
});

const sendPortalPage = (req, res) => {
  renderPage(req, res, "portal", { activeNav: "portal" });
};

app.get("/", (req, res) => {
  if (!security.isEnabled() || (req.user && req.user.role === "admin")) {
    return renderPage(req, res, "index", { activeNav: "dashboard" });
  }
  return sendPortalPage(req, res);
});

app.get("/index.html", (req, res) => {
  if (!security.isEnabled() || (req.user && req.user.role === "admin")) {
    return renderPage(req, res, "index", { activeNav: "dashboard" });
  }
  return res.redirect(302, "/");
});

app.get(["/portal", "/portal.html"], (req, res) => {
  return sendPortalPage(req, res);
});

app.get(["/login", "/login.html"], (req, res) => {
  if (!security.isEnabled()) {
    return res.redirect(authPluginInstallUrl);
  }
  if (req.user && req.user.role === "admin") {
    return res.redirect("/index.html");
  }
  return sendLoginPage(req, res);
});

app.get(["/guide", "/guide.html"], (req, res) => {
  return renderPage(req, res, "guide", { activeNav: "guide" });
});

app.get(["/admin", "/admin.html"], requireAdminPage, (req, res) => {
  return renderPage(req, res, "admin", { activeNav: "admin" });
});

app.get(["/viewer", "/viewer.html"], (req, res) => {
  return renderPage(req, res, "viewer", { activeNav: "viewer" });
});

app.get(["/access-denied", "/access-denied.html"], (req, res) => {
  return renderPage(req, res, "access-denied", { activeNav: "dashboard" }, { status: 403 });
});

app.use(express.static(publicDir, { index: false }));

// Allow non-admin access to plugins list if no auth plugin is enabled (to install first plugin)
app.get("/plugins", async (req, res) => {
  // If auth is enabled, require admin
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

    // Auto-disable plugins whose directories were removed manually
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

app.post("/plugins/:name/enable", requireAdminIfEnabled, async (req, res) => {
  const raw = req.params.name;
  const pluginName = sanitizePluginName(raw);
  if (!pluginName) {
    return res.status(400).json({ error: "plugin_name_required" });
  }
  
  try {
    await pluginManager.enablePlugin(pluginName);
    res.json({ status: "enabled", plugin: { name: pluginName } });
  } catch (err) {
    res.status(500).json({ error: "plugin_enable_failed", details: String(err?.message || err) });
  }
});

app.post("/plugins/:name/disable", requireAdmin, async (req, res) => {
  const raw = req.params.name;
  const pluginName = sanitizePluginName(raw);
  if (!pluginName) {
    return res.status(400).json({ error: "plugin_name_required" });
  }
  
  try {
    await pluginManager.disablePlugin(pluginName);
    
    // Apply security defaults if no plugins are enabled
    if (pluginManager.listEnabled().length === 0) {
      applySecurityDefaults();
    }
    
    res.json({ status: "disabled", plugin: { name: pluginName } });
  } catch (err) {
    res.status(500).json({ error: "plugin_disable_failed", details: String(err?.message || err) });
  }
});

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

      if (pluginManager.listEnabled().includes(pluginName)) {
        throw Object.assign(new Error("plugin_already_enabled"), { statusCode: 409, code: "PLUGIN_ALREADY_ENABLED" });
      }

      const destination = path.join(pluginsDir, pluginName);
      await removeRecursive(destination);
      await copyRecursive(pluginRoot, destination);

      try {
        await pluginManager.enablePlugin(pluginName);
      } catch (loadErr) {
        await removeRecursive(destination).catch(() => { });
        throw Object.assign(loadErr, { statusCode: 500, code: "PLUGIN_ENABLE_FAILED" });
      }

      return res.status(201).json({ status: "enabled", plugin: { name: pluginName } });
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

const cacheDir = path.resolve(__dirname, "cache");
const pythonDir = path.resolve(__dirname, "python");
const projectsDir = path.resolve(__dirname, "qgisprojects");
const logsDir = path.resolve(__dirname, "logs");
const uploadTempDir = path.resolve(__dirname, "temp_uploads");

const ensureUploadSubdir = (name) => {
  const dir = path.join(uploadTempDir, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const createDiskStorage = (subDir) => multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      const dir = ensureUploadSubdir(subDir);
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}` || `upload-${Date.now()}`;
    cb(null, unique);
  }
});

const PROJECT_CONFIG_FILENAME = "project-config.json";
const MAX_TIMER_DELAY_MS = 2147483647; // ~24.8 días, límite de setTimeout
const PROGRESS_CONFIG_INTERVAL_MS = parseInt(process.env.PROGRESS_CONFIG_INTERVAL_MS || "180000", 10);
const INDEX_FLUSH_INTERVAL_MS = parseInt(process.env.INDEX_FLUSH_INTERVAL_MS || "180000", 10);

// utilidades generales
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// caché en memoria para configs y timers
const projectConfigCache = new Map(); // id -> config
const projectTimers = new Map(); // id -> { timeout, targetTime, item }
const projectLogLastMessage = new Map(); // id -> string
const projectBatchRuns = new Map(); // id -> run info
const projectBatchCleanupTimers = new Map();
const projectCrsDetectionCache = new Map();
const projectSpatialMetadataCache = new Map();
const bootstrapPresetCache = new Map();

const SCHEDULE_HISTORY_LIMIT = 25;
const WEEKDAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const WEEKDAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const SCHEDULE_MIN_LEAD_MS = parseInt(process.env.SCHEDULE_MIN_LEAD_MS || "5000", 10);
const SCHEDULE_DUE_TOLERANCE_MS = Math.max(1000, parseInt(process.env.SCHEDULE_DUE_TOLERANCE_MS || "60000", 10));
const SCHEDULE_HEARTBEAT_INTERVAL_MS = parseInt(process.env.SCHEDULE_HEARTBEAT_INTERVAL_MS || "60000", 10);
const SCHEDULE_OVERDUE_GRACE_MS = parseInt(process.env.SCHEDULE_OVERDUE_GRACE_MS || "5000", 10);

const isValidTimeToken = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return { hour, minute, token: `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}` };
};

const sanitizeWeeklySpec = (input) => {
  if (!input || typeof input !== "object") return null;
  const rawDays = Array.isArray(input.days)
    ? input.days
    : typeof input.days === "string"
      ? input.days.split(/[,\s]+/).filter(Boolean)
      : [];
  const normalizedDays = [];
  for (const token of rawDays) {
    if (!token) continue;
    const key = String(token).toLowerCase().slice(0, 3);
    if (Object.prototype.hasOwnProperty.call(WEEKDAY_INDEX, key) && !normalizedDays.includes(key)) {
      normalizedDays.push(key);
    }
  }
  const timeInfo = isValidTimeToken(input.time);
  if (!normalizedDays.length || !timeInfo) return null;
  normalizedDays.sort((a, b) => WEEKDAY_INDEX[a] - WEEKDAY_INDEX[b]);
  return { days: normalizedDays, time: timeInfo.token };
};

const sanitizeMonthlySpec = (input) => {
  if (input == null) return null;
  const raw = Array.isArray(input.days)
    ? input.days
    : typeof input.days === "string"
      ? input.days.split(/[,\s]+/).filter(Boolean)
      : [];
  const days = [];
  for (const token of raw) {
    const num = Number(token);
    if (Number.isInteger(num) && num >= 1 && num <= 31 && !days.includes(num)) {
      days.push(num);
    }
  }
  const timeInfo = isValidTimeToken(input.time);
  if (!days.length || !timeInfo) return null;
  days.sort((a, b) => a - b);
  return { days, time: timeInfo.token };
};

const sanitizeYearlySpec = (input) => {
  if (!input || typeof input !== "object") return null;
  const occurrences = Array.isArray(input.occurrences) ? input.occurrences : [];
  const sanitized = [];
  for (const occ of occurrences) {
    if (!occ || typeof occ !== "object") continue;
    const month = Number(occ.month);
    const day = Number(occ.day);
    const timeInfo = isValidTimeToken(occ.time || occ.hour);
    if (!Number.isInteger(month) || month < 1 || month > 12) continue;
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    if (!timeInfo) continue;
    sanitized.push({
      month,
      day,
      time: timeInfo.token
    });
    if (sanitized.length >= 3) break;
  }
  if (!sanitized.length) return null;
  return { occurrences: sanitized };
};

const clampDayToMonth = (year, monthIndex, day) => {
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(Math.max(1, day), last);
};

const computeWeeklyNext = (spec, now) => {
  if (!spec || !Array.isArray(spec.days) || !spec.days.length) return null;
  const timeInfo = isValidTimeToken(spec.time);
  if (!timeInfo) return null;
  const base = new Date(now);
  const today = base.getDay();
  const minLead = Number.isFinite(SCHEDULE_MIN_LEAD_MS) ? Math.max(0, SCHEDULE_MIN_LEAD_MS) : 0;
  let best = null;
  for (const token of spec.days) {
    if (!Object.prototype.hasOwnProperty.call(WEEKDAY_INDEX, token)) continue;
    const targetDow = WEEKDAY_INDEX[token];
    const candidate = new Date(base);
    const diff = (targetDow - today + 7) % 7;
    candidate.setDate(candidate.getDate() + diff);
    candidate.setHours(timeInfo.hour, timeInfo.minute, 0, 0);
    if (candidate.getTime() <= now + minLead) {
      candidate.setDate(candidate.getDate() + 7);
    }
    if (!best || candidate.getTime() < best.getTime()) {
      best = candidate;
    }
  }
  return best ? best.getTime() : null;
};

const computeMonthlyNext = (spec, now) => {
  if (!spec || !Array.isArray(spec.days) || !spec.days.length) return null;
  const timeInfo = isValidTimeToken(spec.time);
  if (!timeInfo) return null;
  const base = new Date(now);
  const startYear = base.getFullYear();
  const startMonth = base.getMonth();
  const minLead = Number.isFinite(SCHEDULE_MIN_LEAD_MS) ? Math.max(0, SCHEDULE_MIN_LEAD_MS) : 0;
  let best = null;
  for (let offset = 0; offset <= 14; offset++) {
    const monthIndex = (startMonth + offset) % 12;
    const year = startYear + Math.floor((startMonth + offset) / 12);
    for (const rawDay of spec.days) {
      if (!Number.isInteger(rawDay)) continue;
      const day = clampDayToMonth(year, monthIndex, rawDay);
      const candidate = new Date(year, monthIndex, day, timeInfo.hour, timeInfo.minute, 0, 0);
      if (candidate.getTime() <= now + minLead) continue;
      if (!best || candidate.getTime() < best.getTime()) {
        best = candidate;
      }
    }
    if (best) break;
  }
  return best ? best.getTime() : null;
};

const computeYearlyNext = (spec, now) => {
  if (!spec || !Array.isArray(spec.occurrences) || !spec.occurrences.length) return null;
  let best = null;
  const base = new Date(now);
  const startYear = base.getFullYear();
  const minLead = Number.isFinite(SCHEDULE_MIN_LEAD_MS) ? Math.max(0, SCHEDULE_MIN_LEAD_MS) : 0;
  for (let yearOffset = 0; yearOffset <= 3; yearOffset++) {
    const year = startYear + yearOffset;
    for (const occ of spec.occurrences) {
      const timeInfo = isValidTimeToken(occ.time);
      if (!timeInfo) continue;
      const monthIndex = Number(occ.month) - 1;
      if (!Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) continue;
      const day = clampDayToMonth(year, monthIndex, Number(occ.day));
      const candidate = new Date(year, monthIndex, day, timeInfo.hour, timeInfo.minute, 0, 0);
      if (candidate.getTime() <= now + minLead) continue;
      if (!best || candidate.getTime() < best.getTime()) {
        best = candidate;
      }
    }
    if (best) break;
  }
  return best ? best.getTime() : null;
};

const computeScheduleNextRun = (schedule, { now = Date.now() } = {}) => {
  if (!schedule || schedule.enabled !== true) return null;
  const anchor = Math.max(now, schedule.lastRunAt ? Date.parse(schedule.lastRunAt) || 0 : 0);
  if (schedule.mode === "weekly" && schedule.weekly) {
    return computeWeeklyNext(schedule.weekly, anchor);
  }
  if (schedule.mode === "monthly" && schedule.monthly) {
    return computeMonthlyNext(schedule.monthly, anchor);
  }
  if (schedule.mode === "yearly" && schedule.yearly) {
    return computeYearlyNext(schedule.yearly, anchor);
  }
  return null;
};

const limitScheduleHistory = (history) => {
  if (!Array.isArray(history)) return [];
  const trimmed = history.slice(-SCHEDULE_HISTORY_LIMIT);
  return trimmed;
};

const logProjectEvent = (projectId, message, level = "info") => {
  if (!projectId || !message) return;
  const line = `[${new Date().toISOString()}][${level.toUpperCase()}] ${message}\n`;
  const last = projectLogLastMessage.get(projectId);
  if (last === message) return;
  projectLogLastMessage.set(projectId, message);
  const logPath = path.join(logsDir, `project-${projectId}.log`);
  try {
    fs.appendFileSync(logPath, line, "utf8");
  } catch (err) {
    console.warn("Failed to write project log", projectId, err);
  }
};

const cloneSchedule = (schedule) => {
  if (!schedule || typeof schedule !== "object") return null;
  return {
    enabled: schedule.enabled === true,
    mode: schedule.mode || null,
    weekly: schedule.weekly
      ? {
        days: Array.isArray(schedule.weekly.days) ? schedule.weekly.days.slice() : [],
        time: schedule.weekly.time || null
      }
      : null,
    monthly: schedule.monthly
      ? {
        days: Array.isArray(schedule.monthly.days) ? schedule.monthly.days.slice() : [],
        time: schedule.monthly.time || null
      }
      : null,
    yearly: schedule.yearly
      ? {
        occurrences: Array.isArray(schedule.yearly.occurrences)
          ? schedule.yearly.occurrences.map((occ) => ({ month: occ.month, day: occ.day, time: occ.time }))
          : []
      }
      : null,
    nextRunAt: schedule.nextRunAt || null,
    lastRunAt: schedule.lastRunAt || null,
    lastResult: schedule.lastResult || null,
    lastMessage: schedule.lastMessage || null,
    history: Array.isArray(schedule.history) ? schedule.history.slice() : [],
    zoomMin: Object.prototype.hasOwnProperty.call(schedule, "zoomMin") ? schedule.zoomMin : null,
    zoomMax: Object.prototype.hasOwnProperty.call(schedule, "zoomMax") ? schedule.zoomMax : null
  };
};

const deriveProjectScheduleItems = (projectId, config, { now = Date.now() } = {}) => {
  const items = [];
  const pushItem = (entry) => {
    if (!entry || !Number.isFinite(entry.nextTs)) return;
    items.push(entry);
  };
  if (config && config.layers && typeof config.layers === "object") {
    for (const [name, info] of Object.entries(config.layers)) {
      if (!info || !info.schedule || info.schedule.enabled !== true) continue;
      const schedule = info.schedule;
      const storedNext = schedule.nextRunAt ? Date.parse(schedule.nextRunAt) : null;
      let nextTs = storedNext;
      if (!Number.isFinite(nextTs)) {
        nextTs = computeScheduleNextRun(schedule, { now });
      } else if (nextTs > now + SCHEDULE_DUE_TOLERANCE_MS) {
        const recomputed = computeScheduleNextRun(schedule, { now });
        if (Number.isFinite(recomputed)) {
          nextTs = recomputed;
        }
      }
      if (!Number.isFinite(nextTs)) continue;
      pushItem({
        kind: "layer",
        name,
        nextTs,
        schedule,
        scope: "layer"
      });
    }
  }
  if (config && config.themes && typeof config.themes === "object") {
    for (const [name, info] of Object.entries(config.themes)) {
      if (!info || !info.schedule || info.schedule.enabled !== true) continue;
      const schedule = info.schedule;
      const storedNext = schedule.nextRunAt ? Date.parse(schedule.nextRunAt) : null;
      let nextTs = storedNext;
      if (!Number.isFinite(nextTs)) {
        nextTs = computeScheduleNextRun(schedule, { now });
      } else if (nextTs > now + SCHEDULE_DUE_TOLERANCE_MS) {
        const recomputed = computeScheduleNextRun(schedule, { now });
        if (Number.isFinite(recomputed)) {
          nextTs = recomputed;
        }
      }
      if (!Number.isFinite(nextTs)) continue;
      pushItem({
        kind: "theme",
        name,
        nextTs,
        schedule,
        scope: "theme"
      });
    }
  }
  const legacyNext = computeNextRunTimestamp(config);
  if (Number.isFinite(legacyNext)) {
    pushItem({ kind: "project", name: projectId, nextTs: legacyNext, scope: "project" });
  }
  items.sort((a, b) => a.nextTs - b.nextTs);
  return items;
};

const applyScheduleFinalization = (config, { now = Date.now() } = {}) => {
  if (!config || typeof config !== "object") return;
  const finalizeEntry = (entry) => {
    if (!entry || typeof entry !== "object" || !entry.schedule) return;
    const schedule = entry.schedule;
    if (schedule && Array.isArray(schedule.history)) {
      schedule.history = limitScheduleHistory(schedule.history);
    }
    if (!schedule || schedule.enabled !== true) {
      if (schedule) schedule.nextRunAt = null;
      return;
    }
    const nextTs = computeScheduleNextRun(schedule, { now });
    schedule.nextRunAt = nextTs ? new Date(nextTs).toISOString() : null;
  };
  if (config.layers && typeof config.layers === "object") {
    for (const value of Object.values(config.layers)) {
      finalizeEntry(value);
    }
  }
  if (config.themes && typeof config.themes === "object") {
    for (const value of Object.values(config.themes)) {
      finalizeEntry(value);
    }
  }
};

const PROJECT_BATCH_TTL_MS = parseInt(process.env.PROJECT_BATCH_TTL_MS || "900000", 10);

// asegurar solo el directorio base (ya no se crea un index.json global)
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}
if (!fs.existsSync(projectsDir)) {
  fs.mkdirSync(projectsDir, { recursive: true });
}
if (!fs.existsSync(logsDir)) {
  try { fs.mkdirSync(logsDir, { recursive: true }); } catch { }
}

const getProjectConfigPath = (projectId) => path.join(cacheDir, projectId, PROJECT_CONFIG_FILENAME);

const defaultProjectConfig = (projectId) => ({
  projectId,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  extent: { bbox: null, crs: null, updatedAt: null },
  extentWgs84: { bbox: null, crs: "EPSG:4326", updatedAt: null },
  zoom: { min: null, max: null, updatedAt: null },
  cachePreferences: { mode: "xyz", tileCrs: "EPSG:3857", allowRemote: false, throttleMs: 0, updatedAt: null },
  layers: {},
  themes: {},
  recache: {
    enabled: false,
    strategy: "interval",
    intervalMinutes: null,
    timesOfDay: [],
    nextRunAt: null,
    lastRunAt: null,
    lastResult: null,
    lastMessage: null,
    history: []
  },
  projectCache: {
    includedLayers: [],
    lastRunAt: null,
    lastResult: null,
    lastMessage: null,
    lastRunId: null,
    history: []
  }
});

const deepMerge = (target, source) => {
  if (!source || typeof source !== "object") return target;
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      target[key] = value.slice();
    } else if (value && typeof value === "object") {
      const destination = target[key] && typeof target[key] === "object" ? { ...target[key] } : {};
      target[key] = deepMerge(destination, value);
    } else {
      target[key] = value;
    }
  }
  return target;
};

const serviceMetadataDefaults = {
  serviceIdentification: {
    title: "Local WMTS",
    abstract: "WMTS endpoint",
    keywords: [],
    serviceType: "OGC WMTS",
    serviceTypeVersion: "1.0.0",
    fees: "None",
    accessConstraints: "none"
  },
  serviceProvider: {
    providerName: "MundoGIS",
    providerSite: "",
    contact: {
      individualName: "",
      positionName: "",
      phoneVoice: "",
      phoneFacsimile: "",
      address: {
        deliveryPoint: "",
        city: "",
        administrativeArea: "",
        postalCode: "",
        country: "",
        email: ""
      }
    }
  },
  operations: {
    getFeatureInfo: false
  }
};

const loadServiceMetadata = () => {
  try {
    if (fs.existsSync(serviceMetadataPath)) {
      const raw = fs.readFileSync(serviceMetadataPath, "utf8");
      if (raw) {
        const parsed = JSON.parse(raw);
        return deepMerge(JSON.parse(JSON.stringify(serviceMetadataDefaults)), parsed || {});
      }
    }
  } catch (err) {
    console.warn("Failed to load service metadata", err);
  }
  return JSON.parse(JSON.stringify(serviceMetadataDefaults));
};

const loadTileMatrixPresetStore = () => {
  const store = new Map();
  try {
    if (!fs.existsSync(tileGridDir)) {
      return store;
    }
    const entries = fs.readdirSync(tileGridDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue;
      const fullPath = path.join(tileGridDir, entry.name);
      try {
        const raw = fs.readFileSync(fullPath, "utf8");
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const presetId = (parsed.id || path.basename(entry.name, ".json") || entry.name).toString();
        parsed.id = presetId;
        parsed.__source = fullPath;
        const keyVariants = new Set([
          presetId.toLowerCase(),
          path.basename(entry.name, ".json").toLowerCase()
        ]);
        for (const key of keyVariants) {
          if (!store.has(key)) {
            store.set(key, parsed);
          }
        }
      } catch (presetErr) {
        console.warn("Failed to parse tile matrix preset", entry.name, presetErr?.message || presetErr);
      }
    }
  } catch (err) {
    console.warn("Failed to load tile matrix preset store", err?.message || err);
  }
  return store;
};

let serviceMetadata = loadServiceMetadata();
let tileMatrixPresetStore = loadTileMatrixPresetStore();

const scheduleReload = (fn, delay = 200) => {
  let timer = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        fn();
      } catch (err) {
        console.warn("Failed to reload configuration", err);
      }
    }, delay);
  };
};

try {
  const reloadServiceMetadata = scheduleReload(() => {
    serviceMetadata = loadServiceMetadata();
    console.log("[WMTS] Service metadata reloaded");
  });
  const serviceDir = path.dirname(serviceMetadataPath);
  if (fs.existsSync(serviceDir)) {
    fs.watch(serviceDir, { persistent: false }, (eventType, fileName) => {
      if (!fileName) return;
      if (path.basename(fileName).toLowerCase() === path.basename(serviceMetadataPath).toLowerCase()) {
        reloadServiceMetadata();
      }
    });
  }
} catch (err) {
  // ignore watch errors (file may not exist yet)
}

try {
  if (!fs.existsSync(tileGridDir)) {
    fs.mkdirSync(tileGridDir, { recursive: true });
  }
  const reloadPresetStore = scheduleReload(() => {
    invalidateTileGridCaches();
    tileMatrixPresetStore = loadTileMatrixPresetStore();
    console.log("[WMTS] Tile matrix preset store reloaded");
  });
  fs.watch(tileGridDir, { persistent: false }, () => reloadPresetStore());
} catch (err) {
  // ignore watch errors
}

const getTileMatrixPresetRaw = (name) => {
  if (!name) return null;
  const key = String(name).toLowerCase();
  if (tileMatrixPresetStore.has(key)) {
    return tileMatrixPresetStore.get(key);
  }
  for (const value of tileMatrixPresetStore.values()) {
    if (value && typeof value.id === "string" && value.id.toLowerCase() === key) {
      return value;
    }
  }
  return null;
};

const sanitizeStorageName = (value) => {
  if (!value) return "cache_item";
  const cleaned = String(value).trim() || String(value);
  return cleaned.replace(/[<>:"/\\|?*]/g, "_").replace(/\.\./g, "_") || "cache_item";
};

const getProjectIndexPath = (projectId) => path.join(cacheDir, projectId, "index.json");

const loadProjectIndexData = (projectId) => {
  const indexPath = getProjectIndexPath(projectId);
  if (!fs.existsSync(indexPath)) {
    return {
      project: null,
      id: projectId,
      created: new Date().toISOString(),
      layers: []
    };
  }
  try {
    const raw = fs.readFileSync(indexPath, "utf8");
    return raw ? JSON.parse(raw) : { project: null, id: projectId, layers: [] };
  } catch (err) {
    console.warn("Failed to read index for", projectId, err);
    return { project: null, id: projectId, layers: [] };
  }
};

const writeProjectIndexData = (projectId, data) => {
  const indexPath = getProjectIndexPath(projectId);
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(data, null, 2), "utf8");
};

const upsertProjectIndexEntry = (projectId, targetMode, targetName, updater) => {
  if (!projectId) return null;
  const data = loadProjectIndexData(projectId);
  const layers = Array.isArray(data.layers) ? data.layers : [];
  let existing = null;
  const filtered = [];
  for (const entry of layers) {
    if (!entry) continue;
    const kind = entry.kind || "layer";
    if (entry.name === targetName && kind === targetMode) {
      existing = entry;
      continue;
    }
    filtered.push(entry);
  }
  const updated = updater(existing || {}) || null;
  if (updated) {
    updated.name = targetName;
    updated.kind = targetMode;
    updated.updated = new Date().toISOString();
    filtered.push(updated);
  }
  data.layers = filtered;
  if (!data.project) data.project = null;
  if (!data.id) data.id = projectId;
  if (!data.created) data.created = new Date().toISOString();
  data.updated = new Date().toISOString();
  writeProjectIndexData(projectId, data);
  return updated;
};


const resolveTileBaseDir = (projectId, targetMode, targetName, storageName = null) => {
  const safeName = storageName ? sanitizeStorageName(storageName) : sanitizeStorageName(targetName);
  return targetMode === "theme"
    ? path.join(cacheDir, projectId, "_themes", safeName)
    : path.join(cacheDir, projectId, safeName);
};

const pruneZoomDirectories = (baseDir, { minZoom = null, maxZoom = null } = {}) => {
  if (!baseDir || !fs.existsSync(baseDir)) return [];
  const removed = [];
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const z = Number(entry.name);
      if (!Number.isInteger(z)) continue;
      if ((minZoom != null && z < minZoom) || (maxZoom != null && z > maxZoom)) {
        const dirPath = path.join(baseDir, entry.name);
        fs.rmSync(dirPath, { recursive: true, force: true });
        removed.push(z);
      }
    }
  } catch (err) {
    console.warn("Failed to prune zoom directories", baseDir, err);
  }
  return removed;
};

const RETRIABLE_REMOVE_CODES = new Set(["ENOTEMPTY", "EBUSY", "EPERM", "EACCES"]);
const RETRIABLE_RENAME_CODES = new Set(["ENOTEMPTY", "EBUSY", "EPERM", "EACCES"]);

const removeDirectorySafe = async (targetPath, { attempts = 6, delayMs = 200 } = {}) => {
  if (!targetPath) return;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (!fs.existsSync(targetPath)) return;
    try {
      await fs.promises.rm(targetPath, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = err && err.code;
      if (!RETRIABLE_REMOVE_CODES.has(code) || attempt === attempts) {
        throw err;
      }
      await sleep(delayMs * attempt);
    }
  }
};

const relocateDirectoryForRemoval = async (dirPath, { attempts = 3, delayMs = 150 } = {}) => {
  if (!dirPath || !fs.existsSync(dirPath)) return null;
  const parentDir = path.dirname(dirPath);
  const tempName = `${path.basename(dirPath)}.__purge_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const tempPath = path.join(parentDir, tempName);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await fs.promises.rename(dirPath, tempPath);
      return tempPath;
    } catch (err) {
      const code = err && err.code;
      if (code === "ENOENT") return null;
      if (!RETRIABLE_RENAME_CODES.has(code) || attempt === attempts) {
        throw err;
      }
      await sleep(delayMs * attempt);
    }
  }
  return null;
};

const toIntOrNull = (value) => {
  const num = Number(value);
  return Number.isInteger(num) ? num : null;
};

const computeRecachePlan = ({ existingEntry, zoomMin, zoomMax, requestBody = {} }) => {
  const plan = {
    mode: "full",
    skipExisting: false,
    previousZoom: null,
    overlap: null
  };
  if (!existingEntry) return plan;

  const prevMinCandidate = toIntOrNull(existingEntry.last_zoom_min);
  const prevMaxCandidate = toIntOrNull(existingEntry.last_zoom_max);
  const prevMinFallback = toIntOrNull(existingEntry.zoom_min);
  const prevMaxFallback = toIntOrNull(existingEntry.zoom_max);
  const prevMin = prevMinCandidate != null ? prevMinCandidate : prevMinFallback;
  const prevMax = prevMaxCandidate != null ? prevMaxCandidate : prevMaxFallback;
  const hasPrevRange = Number.isInteger(prevMin) && Number.isInteger(prevMax);
  if (!hasPrevRange) return plan;
  const sameRange = prevMin === zoomMin && prevMax === zoomMax;

  let requestedMode = null;
  if (requestBody?.recache && typeof requestBody.recache === "object") {
    if (typeof requestBody.recache.mode === "string" && requestBody.recache.mode) {
      requestedMode = String(requestBody.recache.mode);
    }
    if (!requestedMode) {
      requestedMode = "incremental";
    }
  } else if (requestBody.recache === "incremental") {
    requestedMode = "incremental";
  }
  if (requestedMode !== "incremental") {
    return plan;
  }

  const requestedTileCrs = requestBody.tile_crs ? String(requestBody.tile_crs).toUpperCase() : null;
  const previousTileCrs = existingEntry.tile_crs ? String(existingEntry.tile_crs).toUpperCase() : null;
  if (requestedTileCrs && previousTileCrs && requestedTileCrs !== previousTileCrs) {
    return plan;
  }

  if (sameRange) {
    return plan;
  }

  plan.mode = "incremental";
  plan.previousZoom = { min: prevMin, max: prevMax };
  let hasOverlap = Number.isInteger(prevMin) && Number.isInteger(prevMax)
    ? !(zoomMax < prevMin || zoomMin > prevMax)
    : false;
  if (!hasOverlap && requestBody?.recache && typeof requestBody.recache === "object") {
    const overlapMin = toIntOrNull(requestBody.recache.overlap?.min);
    const overlapMax = toIntOrNull(requestBody.recache.overlap?.max);
    if (overlapMin != null && overlapMax != null && overlapMin <= overlapMax) {
      hasOverlap = true;
      plan.overlap = { min: overlapMin, max: overlapMax };
    }
  }
  if (hasOverlap) {
    if (!plan.overlap) {
      const overlapMin = Math.max(prevMin, zoomMin);
      const overlapMax = Math.min(prevMax, zoomMax);
      if (Number.isInteger(overlapMin) && Number.isInteger(overlapMax) && overlapMin <= overlapMax) {
        plan.overlap = { min: overlapMin, max: overlapMax };
      }
    }
    plan.skipExisting = false;
  } else {
    plan.skipExisting = true;
  }

  return plan;
};

const computePercentValue = (totalGenerated, expectedTotal) => {
  if (!Number.isFinite(totalGenerated) || !Number.isFinite(expectedTotal) || expectedTotal <= 0) {
    return null;
  }
  return Math.max(0, Math.min(100, (totalGenerated / expectedTotal) * 100));
};

const persistJobProgress = (job, payload, { forceIndex = false, forceConfig = false } = {}) => {
  if (!job || !job.project) return;
  const now = Date.now();
  const totalGenerated = Number.isFinite(Number(payload.total_generated)) ? Number(payload.total_generated) : (job.lastProgress?.totalGenerated ?? null);
  const expectedTotal = Number.isFinite(Number(payload.expected_total)) ? Number(payload.expected_total) : (job.lastProgress?.expectedTotal ?? null);
  const percentValue = typeof payload.percent === "number" ? payload.percent : computePercentValue(totalGenerated, expectedTotal);
  const status = payload.status || (payload.progress === "level_done" ? "running" : null) || job.status || "running";
  const progressInfo = {
    status,
    percent: percentValue != null ? Number(percentValue.toFixed(2)) : null,
    totalGenerated: totalGenerated != null ? Number(totalGenerated) : null,
    expectedTotal: expectedTotal != null ? Number(expectedTotal) : null,
    updatedAt: new Date(now).toISOString()
  };
  if (payload.message) progressInfo.message = String(payload.message);

  if (forceConfig) {
    try {
      const progressPatch = { progress: progressInfo };
      const patch = job.targetMode === "theme"
        ? { themes: { [job.targetName]: progressPatch } }
        : { layers: { [job.targetName]: progressPatch } };
      updateProjectConfig(job.project, patch, { skipReschedule: true });
      job.lastProgressWriteAt = now;
    } catch (err) {
      console.warn("Failed to persist progress config", job.project, job.targetName, err);
    }
  }

  if (forceIndex) {
    try {
      const metadata = job.metadata || {};
      upsertProjectIndexEntry(job.project, job.targetMode, job.targetName, (existing = {}) => {
        const base = { ...existing };
        if (metadata.project_extent && !base.extent) base.extent = metadata.project_extent;
        if (metadata.project_extent) base.project_extent = metadata.project_extent;
        if (metadata.project_crs) base.project_crs = metadata.project_crs;
        if (metadata.tile_crs) base.tile_crs = metadata.tile_crs;
        if (metadata.scheme) base.scheme = metadata.scheme;
        if (metadata.xyz_mode) base.xyz_mode = metadata.xyz_mode;
        if (!base.scheme && job.requestedScheme) base.scheme = job.requestedScheme;
        if (!base.xyz_mode && job.xyzMode) base.xyz_mode = job.xyzMode;
        if (!base.tile_crs && job.requestedTileCrs) base.tile_crs = job.requestedTileCrs;
        const runZoomMin = toIntOrNull(job.zoomMin);
        const runZoomMax = toIntOrNull(job.zoomMax);
        const prevCoverageMin = toIntOrNull(existing.zoom_min);
        const prevCoverageMax = toIntOrNull(existing.zoom_max);
        const coverageMin = runZoomMin != null && prevCoverageMin != null
          ? Math.min(prevCoverageMin, runZoomMin)
          : (runZoomMin != null ? runZoomMin : prevCoverageMin);
        const coverageMax = runZoomMax != null && prevCoverageMax != null
          ? Math.max(prevCoverageMax, runZoomMax)
          : (runZoomMax != null ? runZoomMax : prevCoverageMax);
        if (coverageMin != null) base.zoom_min = coverageMin; else delete base.zoom_min;
        if (coverageMax != null) base.zoom_max = coverageMax; else delete base.zoom_max;
        if (runZoomMin != null) {
          base.last_zoom_min = runZoomMin;
        } else if (existing.last_zoom_min != null) {
          base.last_zoom_min = existing.last_zoom_min;
        } else {
          delete base.last_zoom_min;
        }
        if (runZoomMax != null) {
          base.last_zoom_max = runZoomMax;
        } else if (existing.last_zoom_max != null) {
          base.last_zoom_max = existing.last_zoom_max;
        } else {
          delete base.last_zoom_max;
        }
        base.tile_format = existing.tile_format || "png";
        base.path = existing.path || job.tileBaseDir || resolveTileBaseDir(job.project, job.targetMode, job.targetName, metadata.storage_name);
        base.generated = existing.generated || new Date(now).toISOString();
        if (progressInfo.totalGenerated != null) {
          base.tile_count = Math.max(0, Number(progressInfo.totalGenerated));
        }
        base.status = progressInfo.status;
        base.partial = true;
        base.progress = progressInfo;
        return base;
      });
      job.lastIndexWriteAt = now;
      return null;
    } catch (err) {
      console.warn("Failed to update index progress", job.project, job.targetName, err);
    }
  }
  return null;
};

const handleJobJsonEvent = (job, payload) => {
  if (!job || !payload || typeof payload !== "object") return;
  if (payload.debug === "start_generate") {
    job.metadata = {
      ...payload,
      receivedAt: Date.now()
    };
    if (!job.metadata.scheme && job.requestedScheme) job.metadata.scheme = job.requestedScheme;
    if (!job.metadata.xyz_mode && job.xyzMode) job.metadata.xyz_mode = job.xyzMode;
    if (!job.metadata.tile_crs && job.requestedTileCrs) job.metadata.tile_crs = job.requestedTileCrs;
    if (!job.tileBaseDir && payload.output_dir && payload.storage_name) {
      const baseDir = job.targetMode === "theme"
        ? path.join(payload.output_dir, "_themes", sanitizeStorageName(payload.storage_name))
        : path.join(payload.output_dir, sanitizeStorageName(payload.storage_name));
      job.tileBaseDir = path.resolve(baseDir);
    }
    persistJobProgress(job, { total_generated: 0, expected_total: payload.expected_total ?? null, percent: 0, status: "running" }, { forceIndex: true, forceConfig: true });
    return;
  }

  const progressLike = payload.progress || payload.status || payload.debug === "index_written";
  if (!progressLike) return;

  const totalGenerated = Number.isFinite(Number(payload.total_generated)) ? Number(payload.total_generated) : (job.lastProgress?.totalGenerated ?? null);
  const expectedTotal = Number.isFinite(Number(payload.expected_total)) ? Number(payload.expected_total) : (job.lastProgress?.expectedTotal ?? null);
  const percentValue = typeof payload.percent === "number" ? payload.percent : computePercentValue(totalGenerated, expectedTotal);
  job.lastProgress = {
    totalGenerated,
    expectedTotal,
    percent: percentValue,
    status: payload.status || job.status || "running",
    updatedAt: Date.now()
  };

  const now = Date.now();
  const shouldWriteIndex = job.lastIndexWriteAt === 0 || now - job.lastIndexWriteAt >= INDEX_FLUSH_INTERVAL_MS || !!payload.status;
  const shouldWriteConfig = job.lastProgressWriteAt === 0 || now - job.lastProgressWriteAt >= PROGRESS_CONFIG_INTERVAL_MS || !!payload.status;

  persistJobProgress(job, { ...payload, total_generated: totalGenerated, expected_total: expectedTotal, percent: percentValue }, {
    forceIndex: shouldWriteIndex,
    forceConfig: shouldWriteConfig
  });
};

const readProjectConfig = (projectId, { useCache = true } = {}) => {
  if (useCache && projectConfigCache.has(projectId)) {
    return projectConfigCache.get(projectId);
  }
  const defaults = defaultProjectConfig(projectId);
  const configPath = getProjectConfigPath(projectId);
  let config = { ...defaults };
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      if (raw) {
        const parsed = JSON.parse(raw);
        config = deepMerge({ ...defaults }, parsed || {});
        config.projectId = projectId;
        if (!config.createdAt) config.createdAt = config.updatedAt || new Date().toISOString();
      }
    } catch (err) {
      console.error("Failed to read project config", projectId, err);
    }
  }
  projectConfigCache.set(projectId, config);
  return config;
};

const writeProjectConfig = (projectId, config, { skipReschedule = false } = {}) => {
  const merged = deepMerge(defaultProjectConfig(projectId), config || {});
  merged.projectId = projectId;
  if (!merged.createdAt) merged.createdAt = new Date().toISOString();
  merged.updatedAt = new Date().toISOString();
  if (merged.recache && Array.isArray(merged.recache.history)) {
    merged.recache.history = merged.recache.history.slice(-25);
  }
  if (merged.projectCache && Array.isArray(merged.projectCache.history)) {
    merged.projectCache.history = merged.projectCache.history.slice(-25);
  }
  applyScheduleFinalization(merged);
  const configPath = getProjectConfigPath(projectId);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), "utf8");
  projectConfigCache.set(projectId, merged);
  if (!skipReschedule) {
    scheduleProjectRecache(projectId, merged);
  }
  return merged;
};

const updateProjectConfig = (projectId, patch, { skipReschedule = false } = {}) => {
  const current = readProjectConfig(projectId, { useCache: false });
  const merged = deepMerge({ ...current }, patch || {});
  // conservar createdAt
  merged.createdAt = current.createdAt || merged.createdAt || new Date().toISOString();
  return writeProjectConfig(projectId, merged, { skipReschedule });
};

const ensureProjectConfigExists = (projectId) => {
  if (!projectId) return null;
  const cfgPath = getProjectConfigPath(projectId);
  if (!fs.existsSync(cfgPath)) {
    try {
      return writeProjectConfig(projectId, {}, { skipReschedule: true });
    } catch (err) {
      console.warn("Failed to initialize project config", { projectId, error: err?.message || err });
    }
  }
  try {
    return readProjectConfig(projectId);
  } catch (err) {
    console.warn("Failed to read project config", { projectId, error: err?.message || err });
    return null;
  }
};

const resolveProjectFilePath = (projectId) => {
  if (!projectId) return null;
  const normalizedId = String(projectId).trim();
  const candidates = [
    path.join(projectsDir, `${normalizedId}.qgz`),
    path.join(projectsDir, `${normalizedId}.qgs`),
    path.join(projectsDir, normalizedId)
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) {
          return candidate;
        }
      }
    } catch (err) {
      // ignore and continue with next candidate
    }
  }
  try {
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    const lowered = normalizedId.toLowerCase();
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const parsed = path.parse(entry.name);
      if (parsed.name.toLowerCase() === lowered) {
        const resolved = path.join(projectsDir, entry.name);
        try {
          const stat = fs.statSync(resolved);
          if (stat.isFile()) {
            return resolved;
          }
        } catch (err) {
          // ignore stat errors
        }
      }
    }
  } catch (err) {
    console.warn("Failed to enumerate projects directory for CRS detection", { projectId, error: err?.message || err });
  }
  return null;
};

const readProjectFileContent = (projectPath) => {
  if (!projectPath) return null;
  const lower = projectPath.toLowerCase();
  if (lower.endsWith(".qgz")) {
    try {
      const zip = new AdmZip(projectPath);
      const entry = zip.getEntries().find((item) => item.entryName && item.entryName.toLowerCase().endsWith(".qgs"));
      if (!entry) return null;
      return entry.getData().toString("utf8");
    } catch (err) {
      console.warn("Failed to read QGZ project for CRS detection", { projectPath, error: err?.message || err });
      return null;
    }
  }
  try {
    return fs.readFileSync(projectPath, "utf8");
  } catch (err) {
    console.warn("Failed to read QGS project for CRS detection", { projectPath, error: err?.message || err });
    return null;
  }
};

const extractCrsTokenFromProjectXml = (xmlText) => {
  if (!xmlText || typeof xmlText !== "string") return null;
  const projectMatch = /<projectCrs[^>]*>([^<]+)<\/projectCrs>/i.exec(xmlText);
  if (projectMatch && projectMatch[1]) {
    const token = projectMatch[1].trim();
    if (token) {
      return token.toUpperCase();
    }
  }
  const authMatch = /<authid>([^<]+)<\/authid>/i.exec(xmlText);
  if (authMatch && authMatch[1]) {
    const token = authMatch[1].trim().toUpperCase();
    if (token.startsWith("EPSG:")) {
      return token;
    }
  }
  const epsgMatch = /EPSG:\s*\d{3,6}/i.exec(xmlText);
  if (epsgMatch && epsgMatch[0]) {
    return epsgMatch[0].replace(/\s+/g, "").toUpperCase();
  }
  return null;
};

const parseExtentBlock = (xmlText, tagName) => {
  if (!xmlText || !tagName) return null;
  const pattern = new RegExp(`<${tagName}>[\\s\\S]*?<xmin>([^<]+)<\\/xmin>[\\s\\S]*?<ymin>([^<]+)<\\/ymin>[\\s\\S]*?<xmax>([^<]+)<\\/xmax>[\\s\\S]*?<ymax>([^<]+)<\\/ymax>`, "i");
  const match = pattern.exec(xmlText);
  if (!match) return null;
  const nums = match.slice(1).map((value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  });
  if (nums.some((value) => value == null)) {
    return null;
  }
  return nums;
};

const getProjectSpatialMetadata = (projectId) => {
  if (!projectId) return null;
  const cacheKey = String(projectId).toLowerCase();
  if (projectSpatialMetadataCache.has(cacheKey)) {
    return projectSpatialMetadataCache.get(cacheKey);
  }
  const projectPath = resolveProjectFilePath(projectId);
  if (!projectPath) return null;
  const xml = readProjectFileContent(projectPath);
  if (!xml) return null;
  const crsToken = extractCrsTokenFromProjectXml(xml);
  const extent = parseExtentBlock(xml, "extent");
  const viewExtent = parseExtentBlock(xml, "defaultViewExtent") || extent;
  const result = {
    crs: crsToken,
    extent,
    viewExtent
  };
  projectSpatialMetadataCache.set(cacheKey, result);
  if (crsToken) {
    projectCrsDetectionCache.set(cacheKey, crsToken);
  }
  return result;
};

const detectProjectCrs = (projectId) => {
  if (!projectId) return null;
  const cacheKey = String(projectId).toLowerCase();
  if (projectCrsDetectionCache.has(cacheKey)) {
    return projectCrsDetectionCache.get(cacheKey);
  }
  const spatial = getProjectSpatialMetadata(projectId);
  return spatial?.crs || null;
};

const deriveTileMatrixInfoForCrs = (tileCrs) => {
  if (!tileCrs) {
    return { presetId: null, tileMatrixSet: null };
  }
  const presetMeta = findTileMatrixPresetForCrs(tileCrs);
  if (!presetMeta) {
    return { presetId: null, tileMatrixSet: null };
  }
  const presetId = presetMeta.id || presetMeta.fileName || null;
  let rawPreset = getTileMatrixPresetRaw(presetId) || getTileMatrixPresetRaw(presetMeta.fileName);
  if (!rawPreset && presetMeta.path && fs.existsSync(presetMeta.path)) {
    try {
      const fileRaw = fs.readFileSync(presetMeta.path, "utf8");
      rawPreset = JSON.parse(fileRaw);
      if (rawPreset && !rawPreset.id && presetId) {
        rawPreset.id = presetId;
      }
    } catch (err) {
      console.warn("Failed to load tile matrix preset from disk", { presetPath: presetMeta.path, error: err?.message || err });
    }
  }
  let presetCopy = null;
  if (rawPreset && typeof rawPreset === "object") {
    try {
      presetCopy = JSON.parse(JSON.stringify(rawPreset));
    } catch (err) {
      presetCopy = rawPreset;
    }
    if (!presetCopy.id && presetId) {
      presetCopy.id = presetId;
    }
    if (!presetCopy.supported_crs && tileCrs) {
      presetCopy.supported_crs = [tileCrs];
    }
  }
  return { presetId, tileMatrixSet: presetCopy };
};

const recordOnDemandRequest = (projectId, targetMode, targetName) => {
  if (!projectId || !targetName) return;
  const normalizedMode = targetMode === "theme" ? "theme" : "layer";
  const nowIso = new Date().toISOString();
  let configSnapshot = null;
  try {
    configSnapshot = ensureProjectConfigExists(projectId);
  } catch (err) {
    console.warn("Failed to ensure config for on-demand request", { projectId, error: err?.message || err });
  }

  const layerConfig = normalizedMode === "theme"
    ? configSnapshot?.themes?.[targetName]
    : configSnapshot?.layers?.[targetName];
  const lastParams = layerConfig && typeof layerConfig.lastParams === "object" ? layerConfig.lastParams : {};

  const normalizeCrs = (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.toUpperCase() : null;
  };
  const normalizeScheme = (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().toLowerCase();
    return trimmed || null;
  };
  const normalizePresetName = (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
  };
  const cloneIfObject = (value) => {
    if (!value || typeof value !== "object") return null;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (err) {
      return value;
    }
  };

  const spatialMeta = getProjectSpatialMetadata(projectId);
  const defaultExtent = spatialMeta?.viewExtent || spatialMeta?.extent || null;

  let tileCrsHint = normalizeCrs(lastParams.tile_crs || lastParams.tileCrs || layerConfig?.tile_crs || layerConfig?.tileCrs);
  if (!tileCrsHint) {
    const prefs = configSnapshot?.cachePreferences || null;
    if (prefs && prefs.updatedAt && (prefs.tileCrs || prefs.tile_crs)) {
      tileCrsHint = normalizeCrs(prefs.tileCrs || prefs.tile_crs);
    }
  }
  if (!tileCrsHint) {
    tileCrsHint = normalizeCrs(detectProjectCrs(projectId));
  }

  let schemeHint = normalizeScheme(lastParams.scheme || layerConfig?.scheme || layerConfig?.mode);
  if (!schemeHint) {
    const prefs = configSnapshot?.cachePreferences || null;
    if (prefs && prefs.updatedAt && prefs.mode) {
      schemeHint = normalizeScheme(prefs.mode);
    }
  }
  if (!schemeHint && tileCrsHint) {
    schemeHint = tileCrsHint === "EPSG:3857" ? "xyz" : "wmts";
  }

  let tileMatrixPresetId = normalizePresetName(
    lastParams.tile_matrix_preset
    || lastParams.tileMatrixPreset
    || layerConfig?.tile_matrix_preset
    || layerConfig?.tileMatrixPreset
  );
  let tileMatrixSetDef = cloneIfObject(layerConfig?.tile_matrix_set || layerConfig?.tileMatrixSet);
  if ((!tileMatrixPresetId || !tileMatrixSetDef) && tileCrsHint) {
    const derived = deriveTileMatrixInfoForCrs(tileCrsHint);
    if (!tileMatrixPresetId && derived.presetId) {
      tileMatrixPresetId = derived.presetId;
    }
    if (!tileMatrixSetDef && derived.tileMatrixSet) {
      tileMatrixSetDef = cloneIfObject(derived.tileMatrixSet);
    }
  }
  if (tileMatrixSetDef && tileMatrixPresetId && !tileMatrixSetDef.id) {
    tileMatrixSetDef.id = tileMatrixPresetId;
  }

  if (configSnapshot) {
    try {
      const targetPatch = { lastRequestedAt: nowIso };
      if (!targetPatch.extent && Array.isArray(layerConfig?.extent)) {
        targetPatch.extent = layerConfig.extent.slice();
      }
      if (!targetPatch.extent && Array.isArray(defaultExtent)) {
        targetPatch.extent = defaultExtent.slice();
      }
      const configPatch = normalizedMode === "theme"
        ? { themes: { [targetName]: targetPatch } }
        : { layers: { [targetName]: targetPatch } };
      const prefs = configSnapshot?.cachePreferences || {};
      const prefsUpdated = !!prefs.updatedAt;
      const prefCrs = prefs.tileCrs ? prefs.tileCrs.toUpperCase() : (prefs.tile_crs ? String(prefs.tile_crs).toUpperCase() : null);
      if (tileCrsHint && (!prefsUpdated || !prefCrs)) {
        configPatch.cachePreferences = {
          ...prefs,
          tileCrs: tileCrsHint,
          mode: schemeHint || prefs.mode || (tileCrsHint === "EPSG:3857" ? "xyz" : "wmts"),
          updatedAt: nowIso
        };
      }
      const hasProjectExtent = Array.isArray(configSnapshot?.extent?.bbox) && configSnapshot.extent.bbox.length === 4;
      if (!hasProjectExtent && Array.isArray(defaultExtent)) {
        configPatch.extent = {
          bbox: defaultExtent.slice(),
          crs: tileCrsHint || configSnapshot?.extent?.crs || null,
          updatedAt: nowIso
        };
      }
      updateProjectConfig(projectId, configPatch, { skipReschedule: true });
    } catch (err) {
      console.warn("Failed to persist on-demand request metadata", { projectId, targetName, error: err?.message || err });
    }
  }

  try {
    upsertProjectIndexEntry(projectId, normalizedMode, targetName, (existing = {}) => {
      const snapshot = { ...existing };
      if (schemeHint) {
        snapshot.scheme = schemeHint;
      }
      if (tileCrsHint) {
        snapshot.tile_crs = tileCrsHint;
      }
      if (tileMatrixPresetId) {
        snapshot.tile_matrix_preset = tileMatrixPresetId;
      }
      if (tileMatrixSetDef) {
        snapshot.tile_matrix_set = cloneIfObject(tileMatrixSetDef);
      }
      if (!snapshot.extent && Array.isArray(layerConfig?.extent)) {
        snapshot.extent = layerConfig.extent.slice();
      }
      if (!snapshot.extent && Array.isArray(defaultExtent)) {
        snapshot.extent = defaultExtent.slice();
      }
      if (!snapshot.path) {
        const storageName = sanitizeStorageName(targetName);
        snapshot.path = normalizedMode === "theme"
          ? path.join(cacheDir, projectId, "_themes", storageName)
          : path.join(cacheDir, projectId, storageName);
      }
      snapshot.tile_format = snapshot.tile_format || "png";
      snapshot.generated = snapshot.generated || nowIso;
      snapshot.last_request_at = nowIso;
      snapshot.status = snapshot.status || "on-demand";
      snapshot.partial = true;
      snapshot.progress = snapshot.progress || { status: "on-demand", updatedAt: nowIso };
      return snapshot;
    });
  } catch (err) {
    console.warn("Failed to update index for on-demand request", { projectId, targetName, error: err?.message || err });
  }
};

const sanitizeIso = (value) => {
  if (!value) return null;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return null;
  return new Date(ts).toISOString();
};

const buildSchedulePatch = (input) => {
  if (input == null) return null;
  if (typeof input !== "object") {
    return null;
  }
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(input, "enabled")) {
    patch.enabled = !!input.enabled;
  }
  if (Object.prototype.hasOwnProperty.call(input, "mode")) {
    if (input.mode === null) {
      patch.mode = null;
    } else if (typeof input.mode === "string") {
      const mode = input.mode.toLowerCase();
      if (["weekly", "monthly", "yearly"].includes(mode)) {
        patch.mode = mode;
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, "weekly")) {
    patch.weekly = sanitizeWeeklySpec(input.weekly) || null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "monthly")) {
    patch.monthly = sanitizeMonthlySpec(input.monthly) || null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "yearly")) {
    patch.yearly = sanitizeYearlySpec(input.yearly) || null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "nextRunAt")) {
    patch.nextRunAt = sanitizeIso(input.nextRunAt);
  }
  if (Object.prototype.hasOwnProperty.call(input, "lastRunAt")) {
    patch.lastRunAt = sanitizeIso(input.lastRunAt);
  }
  if (Object.prototype.hasOwnProperty.call(input, "lastResult")) {
    const lr = input.lastResult == null ? null : String(input.lastResult);
    patch.lastResult = lr;
  }
  if (Object.prototype.hasOwnProperty.call(input, "lastMessage")) {
    patch.lastMessage = input.lastMessage == null ? null : String(input.lastMessage);
  }
  if (Object.prototype.hasOwnProperty.call(input, "history")) {
    patch.history = limitScheduleHistory(Array.isArray(input.history) ? input.history : []);
  }
  if (Object.prototype.hasOwnProperty.call(input, "zoomMin")) {
    const minVal = input.zoomMin;
    if (minVal === null || minVal === "" || typeof minVal === "undefined") {
      patch.zoomMin = null;
    } else {
      const parsed = Number(minVal);
      patch.zoomMin = Number.isFinite(parsed) ? Math.round(parsed) : null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, "zoomMax")) {
    const maxVal = input.zoomMax;
    if (maxVal === null || maxVal === "" || typeof maxVal === "undefined") {
      patch.zoomMax = null;
    } else {
      const parsed = Number(maxVal);
      patch.zoomMax = Number.isFinite(parsed) ? Math.round(parsed) : null;
    }
  }
  return Object.keys(patch).length ? patch : {};
};

const normalizeExtentPatch = (value, { defaultCrs = null } = {}) => {
  const stamp = new Date().toISOString();
  if (value == null) {
    return { bbox: null, crs: defaultCrs || null, updatedAt: stamp };
  }
  if (typeof value !== "object") {
    return { bbox: null, crs: defaultCrs || null, updatedAt: stamp };
  }
  const bboxInput = Array.isArray(value.bbox) ? value.bbox.map((v) => Number(v)) : null;
  const bbox = bboxInput && bboxInput.length === 4 && bboxInput.every((n) => Number.isFinite(n)) ? bboxInput : null;
  const crs = typeof value.crs === "string" ? value.crs : (defaultCrs || null);
  return {
    bbox,
    crs,
    updatedAt: value.updatedAt || stamp
  };
};

const buildProjectConfigPatch = (input = {}) => {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(input, "extent")) {
    patch.extent = normalizeExtentPatch(input.extent, { defaultCrs: null });
  }
  if (Object.prototype.hasOwnProperty.call(input, "extentWgs84")) {
    patch.extentWgs84 = normalizeExtentPatch(input.extentWgs84, { defaultCrs: "EPSG:4326" });
  } else if (Object.prototype.hasOwnProperty.call(input, "extent_wgs84")) {
    patch.extentWgs84 = normalizeExtentPatch(input.extent_wgs84, { defaultCrs: "EPSG:4326" });
  }
  if (Object.prototype.hasOwnProperty.call(input, "zoom")) {
    const zoomObj = input.zoom && typeof input.zoom === "object" ? input.zoom : {};
    const min = zoomObj.min;
    const max = zoomObj.max;
    patch.zoom = {
      min: Number.isFinite(Number(min)) ? Number(min) : null,
      max: Number.isFinite(Number(max)) ? Number(max) : null,
      updatedAt: zoomObj.updatedAt || new Date().toISOString()
    };
  }
  if (input.cachePreferences && typeof input.cachePreferences === "object") {
    const prefs = input.cachePreferences;
    patch.cachePreferences = {};
    if (typeof prefs.mode === "string") patch.cachePreferences.mode = prefs.mode;
    if (typeof prefs.tileCrs === "string") patch.cachePreferences.tileCrs = prefs.tileCrs;
    if (typeof prefs.allowRemote === "boolean") patch.cachePreferences.allowRemote = prefs.allowRemote;
    if (Number.isFinite(Number(prefs.throttleMs))) patch.cachePreferences.throttleMs = Number(prefs.throttleMs);
    patch.cachePreferences.updatedAt = prefs.updatedAt || new Date().toISOString();
  }
  if (input.layers && typeof input.layers === "object") {
    patch.layers = {};
    for (const [layerName, layerValue] of Object.entries(input.layers)) {
      if (!layerName) continue;
      const info = layerValue && typeof layerValue === "object" ? layerValue : {};
      const layerPatch = {};
      if (info.lastParams && typeof info.lastParams === "object") {
        layerPatch.lastParams = info.lastParams;
      }
      if (typeof info.autoRecache === "boolean") layerPatch.autoRecache = info.autoRecache;
      if (info.lastRequestedAt) layerPatch.lastRequestedAt = info.lastRequestedAt;
      if (info.lastResult) layerPatch.lastResult = info.lastResult;
      if (info.lastMessage) layerPatch.lastMessage = info.lastMessage;
      if (info.lastRunAt) layerPatch.lastRunAt = info.lastRunAt;
      
      // Allow admin to set custom layer properties for technical configuration
      if (info.layerName) layerPatch.layerName = info.layerName;
      if (info.crs) layerPatch.crs = info.crs;
      if (Array.isArray(info.extent)) layerPatch.extent = info.extent;
      if (Array.isArray(info.projectionExtent)) layerPatch.projectionExtent = info.projectionExtent;
      if (Array.isArray(info.origin)) layerPatch.origin = info.origin;
      if (Array.isArray(info.center)) layerPatch.center = info.center;
      if (Array.isArray(info.resolutions)) layerPatch.resolutions = info.resolutions;
      if (info.tileGridId) layerPatch.tileGridId = info.tileGridId;
      
      if (Object.prototype.hasOwnProperty.call(info, "schedule")) {
        if (info.schedule === null) {
          layerPatch.schedule = {
            enabled: false,
            mode: null,
            weekly: null,
            monthly: null,
            yearly: null,
            nextRunAt: null,
            lastRunAt: null,
            lastResult: null,
            lastMessage: null,
            history: []
          };
        } else {
          const schedulePatch = buildSchedulePatch(info.schedule) || {};
          if (Object.keys(schedulePatch).length) layerPatch.schedule = schedulePatch;
        }
      }
      if (Object.keys(layerPatch).length) patch.layers[layerName] = layerPatch;
    }
  }
  if (input.themes && typeof input.themes === "object") {
    patch.themes = {};
    for (const [themeName, themeValue] of Object.entries(input.themes)) {
      if (!themeName) continue;
      const info = themeValue && typeof themeValue === "object" ? themeValue : {};
      const themePatch = {};
      if (info.lastParams && typeof info.lastParams === "object") themePatch.lastParams = info.lastParams;
      if (info.lastRequestedAt) themePatch.lastRequestedAt = info.lastRequestedAt;
      if (info.lastResult) themePatch.lastResult = info.lastResult;
      if (info.lastMessage) themePatch.lastMessage = info.lastMessage;
      if (info.lastRunAt) themePatch.lastRunAt = info.lastRunAt;
      if (Array.isArray(info.sourceLayers)) themePatch.sourceLayers = info.sourceLayers.slice(0, 64);
      if (info.lastJobId) themePatch.lastJobId = info.lastJobId;
      if (Object.prototype.hasOwnProperty.call(info, "schedule")) {
        if (info.schedule === null) {
          themePatch.schedule = {
            enabled: false,
            mode: null,
            weekly: null,
            monthly: null,
            yearly: null,
            nextRunAt: null,
            lastRunAt: null,
            lastResult: null,
            lastMessage: null,
            history: []
          };
        } else {
          const schedulePatch = buildSchedulePatch(info.schedule) || {};
          if (Object.keys(schedulePatch).length) themePatch.schedule = schedulePatch;
        }
      }
      if (Object.keys(themePatch).length) patch.themes[themeName] = themePatch;
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, "recache")) {
    const rec = input.recache && typeof input.recache === "object" ? input.recache : {};
    patch.recache = {};
    if (typeof rec.enabled === "boolean") patch.recache.enabled = rec.enabled;
    if (typeof rec.strategy === "string") patch.recache.strategy = rec.strategy;
    if (rec.intervalMinutes != null && rec.intervalMinutes !== "") {
      patch.recache.intervalMinutes = Number.isFinite(Number(rec.intervalMinutes)) ? Number(rec.intervalMinutes) : null;
    }
    if (Array.isArray(rec.timesOfDay)) {
      patch.recache.timesOfDay = rec.timesOfDay.filter((v) => typeof v === "string" && v.includes(":"));
    }
    if (rec.nextRunAt) patch.recache.nextRunAt = rec.nextRunAt;
    if (rec.lastRunAt) patch.recache.lastRunAt = rec.lastRunAt;
    if (rec.lastResult) patch.recache.lastResult = rec.lastResult;
    if (rec.lastMessage) patch.recache.lastMessage = rec.lastMessage;
  }
  if (Object.prototype.hasOwnProperty.call(input, "projectCache")) {
    const pc = input.projectCache && typeof input.projectCache === "object" ? input.projectCache : {};
    patch.projectCache = {};
    if (Array.isArray(pc.includedLayers)) patch.projectCache.includedLayers = pc.includedLayers.filter((v) => typeof v === "string");
    if (pc.lastRunAt) patch.projectCache.lastRunAt = pc.lastRunAt;
    if (pc.lastResult) patch.projectCache.lastResult = pc.lastResult;
    if (pc.lastMessage) patch.projectCache.lastMessage = pc.lastMessage;
    if (pc.lastRunId) patch.projectCache.lastRunId = pc.lastRunId;
    if (Array.isArray(pc.history)) patch.projectCache.history = pc.history.slice(-25);
  }
  return patch;
};

const cancelProjectTimer = (projectId) => {
  const entry = projectTimers.get(projectId);
  if (entry && entry.timeout) {
    clearTimeout(entry.timeout);
  }
  projectTimers.delete(projectId);
};

const computeNextRunTimestamp = (config) => {
  const recache = config && config.recache;
  if (!recache || recache.enabled !== true) return null;
  const now = Date.now();
  if (recache.nextRunAt) {
    const ts = Date.parse(recache.nextRunAt);
    if (!Number.isNaN(ts) && ts > now) return ts;
  }
  if (recache.strategy === "times" && Array.isArray(recache.timesOfDay) && recache.timesOfDay.length) {
    const candidates = recache.timesOfDay
      .map((t) => {
        if (typeof t !== "string") return null;
        const [hStr, mStr] = t.split(":");
        const h = Number(hStr);
        const m = Number(mStr);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
        const candidate = new Date();
        candidate.setHours(h, m, 0, 0);
        if (candidate.getTime() <= now) {
          candidate.setDate(candidate.getDate() + 1);
        }
        return candidate.getTime();
      })
      .filter((ts) => Number.isFinite(ts));
    if (candidates.length) {
      return Math.min(...candidates);
    }
  }
  const intervalMinutes = Number(recache.intervalMinutes);
  if (Number.isFinite(intervalMinutes) && intervalMinutes > 0) {
    const base = recache.lastRunAt ? Date.parse(recache.lastRunAt) : now;
    let candidate = base + intervalMinutes * 60000;
    if (candidate <= now + 5000) candidate = now + 5000;
    return candidate;
  }
  return null;
};

const scheduleProjectRecache = (projectId, configParam) => {
  const cfg = configParam || readProjectConfig(projectId);
  cancelProjectTimer(projectId);
  const items = deriveProjectScheduleItems(projectId, cfg);
  if (!items.length) return;
  const nextEntry = items.find((entry) => Number.isFinite(entry.nextTs));
  if (!nextEntry) return;
  const now = Date.now();
  const delayMs = Math.max(0, nextEntry.nextTs - now);
  const timeoutDelay = Math.min(delayMs, MAX_TIMER_DELAY_MS);
  const timeout = setTimeout(() => {
    handleProjectTimer(projectId, nextEntry.nextTs).catch((err) => {
      console.error(`Recache timer error for ${projectId}:`, err);
    });
  }, timeoutDelay);
  projectTimers.set(projectId, { timeout, targetTime: nextEntry.nextTs, item: nextEntry });
  const whenIso = new Date(nextEntry.nextTs).toISOString();
  logProjectEvent(projectId, `Scheduled automatic cache for ${nextEntry.kind}:${nextEntry.name} at ${whenIso}.`);
};

const computeNextScheduleIso = (schedule, { now = Date.now() } = {}) => {
  if (!schedule || schedule.enabled !== true) return null;
  const nextTs = computeScheduleNextRun(schedule, { now });
  return nextTs ? new Date(nextTs).toISOString() : null;
};

const runScheduledLayer = async (projectId, layerName, config) => {
  const currentConfig = config || readProjectConfig(projectId, { useCache: false });
  const layerEntry = currentConfig.layers && currentConfig.layers[layerName] ? currentConfig.layers[layerName] : null;
  if (!layerEntry) {
    logProjectEvent(projectId, `Scheduled layer ${layerName} skipped (missing info)`, "warn");
    return currentConfig;
  }
  const schedule = cloneSchedule(layerEntry.schedule) || { enabled: false };
  const scheduleMin = toIntOrNull(schedule.zoomMin);
  const scheduleMax = toIntOrNull(schedule.zoomMax);
  const hasZoomOverride = scheduleMin != null || scheduleMax != null;
  const nowIso = new Date().toISOString();
  const appendHistory = (status, message) => {
    const historyEntry = { at: nowIso, status, message };
    const baseHistory = Array.isArray(schedule.history) ? schedule.history.slice() : [];
    schedule.history = limitScheduleHistory([...baseHistory, historyEntry]);
    schedule.lastRunAt = nowIso;
    schedule.lastResult = status;
    schedule.lastMessage = message;
    schedule.nextRunAt = schedule.enabled === true ? computeNextScheduleIso(schedule, { now: Date.now() + 5000 }) : null;
  };

  if (!layerEntry.lastParams || typeof layerEntry.lastParams !== "object") {
    const message = "Skipped automatic recache: no parameters recorded";
    appendHistory("skipped", message);
    const updated = updateProjectConfig(projectId, {
      layers: {
        [layerName]: {
          schedule,
          lastResult: "skipped",
          lastMessage: message,
          lastRunAt: nowIso
        }
      }
    }, { skipReschedule: true });
    return updated;
  }

  if (!hasZoomOverride) {
    try {
      await deleteLayerCacheInternal(projectId, layerName, { force: true, silent: true });
    } catch (err) {
      logProjectEvent(projectId, `Failed to purge layer ${layerName} before scheduled recache: ${err?.message || err}`, "warn");
    }
  }

  logProjectEvent(projectId, `Running scheduled recache for ${layerName}.`);

  let status = "success";
  let message = "Automatic recache completed";
  try {
    const params = { ...layerEntry.lastParams, project: projectId, layer: layerName };
    params.project = projectId;
    params.layer = layerName;
    params.run_reason = "scheduled-layer";
    params.trigger = "timer";
    params.batch_total = 1;
    params.batch_index = 0;
    if (scheduleMin != null) params.zoom_min = scheduleMin;
    if (scheduleMax != null) params.zoom_max = scheduleMax;
    const result = await runCacheJobViaHttp(params, {});
    const rawStatus = result && result.status ? String(result.status) : "completed";
    if (rawStatus !== "completed") {
      status = rawStatus;
      message = `Automatic recache ended with status ${rawStatus}`;
    }
    if (status === "success" || status === "completed") {
      logProjectEvent(projectId, `Scheduled recache for ${layerName} finished successfully.`);
    } else {
      logProjectEvent(projectId, `Scheduled recache for ${layerName} finished with status ${rawStatus}.`, "warn");
    }
  } catch (err) {
    status = "error";
    message = `Automatic recache failed: ${err?.message || err}`;
    logProjectEvent(projectId, `Layer ${layerName} scheduled recache failed: ${err?.message || err}`, "error");
  }
  appendHistory(status, message);
  const updated = updateProjectConfig(projectId, {
    layers: {
      [layerName]: {
        schedule,
        lastResult: status,
        lastMessage: message,
        lastRunAt: nowIso
      }
    }
  }, { skipReschedule: true });
  return updated;
};

const runScheduledTheme = async (projectId, themeName, config) => {
  const currentConfig = config || readProjectConfig(projectId, { useCache: false });
  const themeEntry = currentConfig.themes && currentConfig.themes[themeName] ? currentConfig.themes[themeName] : null;
  if (!themeEntry) {
    logProjectEvent(projectId, `Scheduled theme ${themeName} skipped (missing info)`, "warn");
    return currentConfig;
  }
  const schedule = cloneSchedule(themeEntry.schedule) || { enabled: false };
  const scheduleMin = toIntOrNull(schedule.zoomMin);
  const scheduleMax = toIntOrNull(schedule.zoomMax);
  const hasZoomOverride = scheduleMin != null || scheduleMax != null;
  const nowIso = new Date().toISOString();
  const appendHistory = (status, message) => {
    const historyEntry = { at: nowIso, status, message };
    const baseHistory = Array.isArray(schedule.history) ? schedule.history.slice() : [];
    schedule.history = limitScheduleHistory([...baseHistory, historyEntry]);
    schedule.lastRunAt = nowIso;
    schedule.lastResult = status;
    schedule.lastMessage = message;
    schedule.nextRunAt = schedule.enabled === true ? computeNextScheduleIso(schedule, { now: Date.now() + 5000 }) : null;
  };

  if (!themeEntry.lastParams || typeof themeEntry.lastParams !== "object") {
    const message = "Skipped automatic recache: no parameters recorded";
    appendHistory("skipped", message);
    const updated = updateProjectConfig(projectId, {
      themes: {
        [themeName]: {
          schedule,
          lastResult: "skipped",
          lastMessage: message,
          lastRunAt: nowIso
        }
      }
    }, { skipReschedule: true });
    return updated;
  }

  if (!hasZoomOverride) {
    try {
      await deleteThemeCacheInternal(projectId, themeName, { force: true, silent: true });
    } catch (err) {
      logProjectEvent(projectId, `Failed to purge theme ${themeName} before scheduled recache: ${err?.message || err}`, "warn");
    }
  }

  let status = "success";
  let message = "Automatic theme recache completed";
  try {
    const params = { ...themeEntry.lastParams, project: projectId, theme: themeName };
    params.project = projectId;
    params.theme = themeName;
    params.run_reason = "scheduled-theme";
    params.trigger = "timer";
    params.batch_total = 1;
    params.batch_index = 0;
    if (scheduleMin != null) params.zoom_min = scheduleMin;
    if (scheduleMax != null) params.zoom_max = scheduleMax;
    const result = await runCacheJobViaHttp(params, {});
    const rawStatus = result && result.status ? String(result.status) : "completed";
    if (rawStatus !== "completed") {
      status = rawStatus;
      message = `Automatic theme recache ended with status ${rawStatus}`;
    }
  } catch (err) {
    status = "error";
    message = `Automatic theme recache failed: ${err?.message || err}`;
    logProjectEvent(projectId, `Theme ${themeName} scheduled recache failed: ${err?.message || err}`, "error");
  }
  appendHistory(status, message);
  const updated = updateProjectConfig(projectId, {
    themes: {
      [themeName]: {
        schedule,
        lastResult: status,
        lastMessage: message,
        lastRunAt: nowIso
      }
    }
  }, { skipReschedule: true });
  return updated;
};

const updateProjectBatchRun = (projectId, patch) => {
  const current = projectBatchRuns.get(projectId) || {};
  const updated = { ...current, ...patch };
  projectBatchRuns.set(projectId, updated);
  if (updated.status && updated.status !== "running" && updated.status !== "queued") {
    const ttl = Number.isFinite(PROJECT_BATCH_TTL_MS) ? PROJECT_BATCH_TTL_MS : 900000;
    const existing = projectBatchCleanupTimers.get(projectId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      projectBatchRuns.delete(projectId);
      projectBatchCleanupTimers.delete(projectId);
    }, ttl);
    projectBatchCleanupTimers.set(projectId, timer);
  } else {
    const existing = projectBatchCleanupTimers.get(projectId);
    if (existing) {
      clearTimeout(existing);
      projectBatchCleanupTimers.delete(projectId);
    }
  }
  return updated;
};

const handleProjectTimer = async (projectId, targetTime) => {
  const now = Date.now();
  const entry = projectTimers.get(projectId);
  if (entry && entry.targetTime && targetTime && entry.targetTime !== targetTime) {
    return;
  }
  if (entry && entry.timeout) {
    try { clearTimeout(entry.timeout); } catch { }
  }
  projectTimers.delete(projectId);
  const config = readProjectConfig(projectId, { useCache: false });
  const items = deriveProjectScheduleItems(projectId, config, { now });
  if (!items.length) {
    scheduleProjectRecache(projectId, config);
    return;
  }
  const dueItems = items.filter((item) => Number.isFinite(item.nextTs) && item.nextTs <= now + 60000);
  if (!dueItems.length) {
    scheduleProjectRecache(projectId, config);
    return;
  }
  dueItems.sort((a, b) => a.nextTs - b.nextTs);
  let workingConfig = config;
  for (const item of dueItems) {
    try {
      if (item.kind === "layer") {
        workingConfig = await runScheduledLayer(projectId, item.name, workingConfig);
      } else if (item.kind === "theme") {
        workingConfig = await runScheduledTheme(projectId, item.name, workingConfig);
      } else if (item.kind === "project") {
        await runRecacheForProject(projectId, "scheduled", { requireEnabled: false });
        workingConfig = readProjectConfig(projectId, { useCache: false });
      }
    } catch (err) {
      console.error(`Scheduled item failed for ${projectId} (${item.kind}:${item.name}):`, err);
    }
  }
  scheduleProjectRecache(projectId, workingConfig);
};

const runCacheJobViaHttp = async (payload, { timeoutMs = 3600000 } = {}) => {
  const controller = new AbortController();
  const res = await fetch("http://127.0.0.1:3000/generate-cache", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal
  });
  const resJson = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(resJson?.details || resJson?.error || res.statusText || "generate-cache failed");
  }
  const jobId = resJson.id;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(2000);
    const statusRes = await fetch(`http://127.0.0.1:3000/generate-cache/${encodeURIComponent(jobId)}?tail=20000`);
    if (statusRes.status === 404) {
      throw new Error(`Job ${jobId} no longer available`);
    }
    const statusJson = await statusRes.json().catch(() => ({}));
    if (statusJson.status && statusJson.status !== "running") {
      return statusJson;
    }
  }
  controller.abort();
  throw new Error("Job timed out");
};

const runRecacheForProject = async (projectId, reason = "manual", options = {}) => {
  const { overrideLayers = null, runId = null, requireEnabled = true } = options;
  const config = readProjectConfig(projectId, { useCache: false });
  if (requireEnabled && (!config.recache || config.recache.enabled !== true)) return;
  let layerEntries = [];
  if (Array.isArray(overrideLayers) && overrideLayers.length) {
    for (const entry of overrideLayers) {
      if (!entry || typeof entry !== "object") continue;
      const layerName = entry.layer || entry.name;
      if (!layerName) continue;
      const params = entry.params && typeof entry.params === "object" ? entry.params : entry.body && typeof entry.body === "object" ? entry.body : null;
      if (!params) continue;
      layerEntries.push({ name: layerName, params: { ...params } });
    }
  } else {
    const layersConfig = config.layers || {};
    layerEntries = Object.entries(layersConfig)
      .filter(([, info]) => info && info.autoRecache !== false && info.lastParams)
      .map(([name, info]) => ({ name, params: { ...(info.lastParams || {}) }, info }));
  }
  if (!layerEntries.length) {
    const nowIso = new Date().toISOString();
    logProjectEvent(projectId, `Recache skipped (${reason}): no layers provided`, "warn");
    const recHistory = Array.isArray(config.recache?.history) ? config.recache.history : [];
    const projectHistory = Array.isArray(config.projectCache?.history) ? config.projectCache.history : [];
    updateProjectConfig(projectId, {
      recache: {
        lastRunAt: nowIso,
        lastResult: "skipped",
        lastMessage: "No layers recorded",
        history: [...recHistory, { at: nowIso, status: "skipped", message: "No layers recorded", reason, runId }]
      },
      projectCache: {
        includedLayers: [],
        lastRunAt: nowIso,
        lastResult: "skipped",
        lastMessage: "No layers recorded",
        lastRunId: runId || null,
        history: [...projectHistory, { at: nowIso, status: "skipped", message: "No layers recorded", reason, runId, includedLayers: [] }]
      }
    });
    return;
  }
  const layerNames = layerEntries.map((entry) => entry.name);
  logProjectEvent(projectId, `Recache start (${reason}), layers: ${layerNames.join(", ")}`);
  const normalizedTrigger = reason === "scheduled" ? "timer" : reason === "manual-project" ? "manual" : (reason || "manual");
  const effectiveRunId = runId || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const startedAt = Date.now();
  const totalCount = layerNames.length;
  let completedCount = 0;
  updateProjectBatchRun(projectId, {
    id: effectiveRunId,
    project: projectId,
    status: "running",
    reason,
    trigger: normalizedTrigger,
    startedAt,
    layers: layerNames,
    totalCount,
    completedCount: 0,
    currentLayer: null,
    currentIndex: null
  });

  const failures = [];
  for (let idx = 0; idx < layerEntries.length; idx++) {
    const entry = layerEntries[idx];
    const layerName = entry.name;
    updateProjectBatchRun(projectId, {
      id: effectiveRunId,
      project: projectId,
      status: "running",
      reason,
      trigger: normalizedTrigger,
      startedAt,
      layers: layerNames,
      totalCount,
      completedCount,
      currentLayer: layerName,
      currentIndex: idx
    });
    try {
      await deleteLayerCacheInternal(projectId, layerName, { force: true, silent: true });
    } catch (err) {
      const msg = `Failed to purge cache for ${layerName}: ${err?.message || err}`;
      logProjectEvent(projectId, msg, "error");
      failures.push(msg);
      continue;
    }
    const params = entry.params || {};
    const payload = {
      ...params,
      project: projectId,
      layer: layerName
    };
    if (!payload.layer) payload.layer = layerName;
    if (!payload.project) payload.project = projectId;
    if (!payload.zoom_min && config.zoom && config.zoom.min != null) payload.zoom_min = config.zoom.min;
    if (!payload.zoom_max && config.zoom && config.zoom.max != null) payload.zoom_max = config.zoom.max;
    if (!payload.project_extent && config.extent && Array.isArray(config.extent.bbox) && config.extent.bbox.length === 4) {
      payload.project_extent = config.extent.bbox.join(",");
      if (config.extent.crs) payload.extent_crs = config.extent.crs;
    }
    try {
      payload.run_reason = reason;
      payload.trigger = normalizedTrigger;
      payload.run_id = effectiveRunId;
      payload.batch_total = totalCount;
      payload.batch_index = idx;
      const result = await runCacheJobViaHttp(payload, {});
      if (!result || (result.status && result.status !== "completed")) {
        const msg = `Recache job for ${layerName} ended with status ${(result && result.status) || "unknown"}`;
        failures.push(msg);
        logProjectEvent(projectId, msg, "error");
      } else {
        logProjectEvent(projectId, `Layer ${layerName} recached successfully.`);
      }
    } catch (err) {
      const msg = `Recache job for ${layerName} failed: ${err?.message || err}`;
      failures.push(msg);
      logProjectEvent(projectId, msg, "error");
    }
    completedCount += 1;
    updateProjectBatchRun(projectId, {
      id: effectiveRunId,
      project: projectId,
      completedCount,
      currentLayer: null,
      currentIndex: null
    });
  }
  const nowIso = new Date().toISOString();
  const success = failures.length === 0;
  const includedLayers = layerEntries.map((entry) => entry.name);
  const message = success ? `Recache completed successfully (${includedLayers.length} layers).` : `Recache completed with ${failures.length} error(s).`;
  const historyEntry = { at: nowIso, status: success ? "success" : "error", message, reason, errors: failures, runId, includedLayers };
  const recHistory = Array.isArray(config.recache?.history) ? config.recache.history : [];
  const projectHistory = Array.isArray(config.projectCache?.history) ? config.projectCache.history : [];
  const recacheUpdate = {
    recache: {
      lastRunAt: nowIso,
      lastResult: success ? "success" : "error",
      lastMessage: failures.join(" | ") || message,
      history: [...recHistory, historyEntry]
    },
    projectCache: {
      includedLayers,
      lastRunAt: nowIso,
      lastResult: success ? "success" : "error",
      lastMessage: failures.join(" | ") || message,
      lastRunId: runId || null,
      history: [...projectHistory, historyEntry]
    }
  };
  if (config.recache && config.recache.intervalMinutes && Number(config.recache.intervalMinutes) > 0) {
    const nextTs = computeNextRunTimestamp({ ...config, recache: { ...config.recache, lastRunAt: nowIso } });
    recacheUpdate.recache.nextRunAt = nextTs ? new Date(nextTs).toISOString() : null;
  } else if (config.recache && config.recache.nextRunAt) {
    recacheUpdate.recache.nextRunAt = null;
  }
  updateProjectConfig(projectId, recacheUpdate);
  const endedAt = Date.now();
  updateProjectBatchRun(projectId, {
    id: effectiveRunId,
    project: projectId,
    status: success ? "completed" : "error",
    result: success ? "success" : "error",
    error: success ? null : failures.join(" | "),
    endedAt,
    trigger: normalizedTrigger,
    reason,
    layers: layerNames,
    completedCount,
    totalCount,
    currentLayer: null,
    currentIndex: null
  });
  if (!success) {
    throw new Error(message + " " + failures.join(" | "));
  }
};

const deleteLayerCacheInternal = async (projectId, layerName, { force = false, silent = false } = {}) => {
  if (!projectId) throw new Error("project required");
  if (!layerName) throw new Error("layer required");
  const runningEntry = Array.from(runningJobs.entries()).find(([id, job]) => job && job.status === "running" && job.project === projectId && job.layer === layerName);
  if (runningEntry) {
    if (!force) {
      const err = new Error("job_running");
      err.code = "job_running";
      err.jobId = runningEntry[0];
      throw err;
    }
    try {
      const [rid, job] = runningEntry;
      job.proc.kill();
      setTimeout(() => {
        try {
          if (job.proc && job.proc.pid) {
            const tk = spawn("taskkill", ["/PID", String(job.proc.pid), "/T", "/F"], { shell: true });
            tk.on("close", (code) => console.log(`taskkill (deleteLayerCacheInternal) job ${rid} -> code ${code}`));
          }
        } catch (e) {
          if (!silent) console.warn("taskkill escalation failed (deleteLayerCacheInternal)", e);
        }
      }, parseInt(process.env.ABORT_GRACE_MS || "1000", 10));
      job.status = "aborted";
      job.endedAt = Date.now();
      try { activeKeys.delete(`${projectId}:${layerName}`); } catch { }
      clearTimeout(job.cleanupTimer);
      job.cleanupTimer = setTimeout(() => runningJobs.delete(rid), parseInt(process.env.JOB_TTL_MS || "300000", 10));
    } catch (e) {
      if (!silent) console.warn("Failed to abort running job before delete", e);
    }
  }

  const layerDir = path.join(cacheDir, projectId, layerName);
  let removalPath = layerDir;
  try {
    const relocated = await relocateDirectoryForRemoval(layerDir);
    if (relocated) {
      removalPath = relocated;
    }
  } catch (relocateErr) {
    if (!silent) console.warn("Failed to relocate cache prior to delete", projectId, layerName, relocateErr);
  }
  try {
    await removeDirectorySafe(removalPath, {});
    if (removalPath !== layerDir) {
      try {
        await removeDirectorySafe(layerDir, { attempts: 2, delayMs: 100 });
      } catch { }
    }
  } catch (rmErr) {
    if (!silent) console.error("Failed to remove cache directory", projectId, layerName, rmErr);
    throw rmErr;
  }

  const projectIndexPath = path.join(cacheDir, projectId, "index.json");
  let index = { layers: [] };
  try {
    const raw = fs.readFileSync(projectIndexPath, "utf8");
    if (raw) index = JSON.parse(raw);
  } catch {
    index = { layers: [] };
  }
  index.layers = Array.isArray(index.layers) ? index.layers.filter((l) => l && l.name !== layerName) : [];
  try {
    fs.writeFileSync(projectIndexPath, JSON.stringify(index, null, 2), "utf8");
  } catch (err) {
    if (!silent) console.error("Failed to write project index after delete", err);
    throw err;
  }
  try {
    updateProjectConfig(projectId, {
      layers: {
        [layerName]: {
          lastResult: "deleted",
          lastMessage: "Cache removed",
          lastRunAt: new Date().toISOString()
        }
      }
    }, { skipReschedule: true });
  } catch (cfgErr) {
    if (!silent) console.warn("Failed to record layer delete in config", cfgErr);
  }
  logProjectEvent(projectId, `Layer ${layerName} cache deleted${force ? " (force)" : ""}.`);
  return { project: projectId, layer: layerName };
};

const deleteThemeCacheInternal = async (projectId, themeName, { force = false, silent = false } = {}) => {
  if (!projectId) throw new Error("project required");
  if (!themeName) throw new Error("theme required");
  const runningEntry = Array.from(runningJobs.entries()).find(([id, job]) => job && job.status === "running" && job.project === projectId && job.targetMode === "theme" && job.targetName === themeName);
  if (runningEntry) {
    if (!force) {
      const err = new Error("job_running");
      err.code = "job_running";
      err.jobId = runningEntry[0];
      throw err;
    }
    try {
      const [rid, job] = runningEntry;
      job.proc.kill();
      setTimeout(() => {
        try {
          if (job.proc && job.proc.pid) {
            const tk = spawn("taskkill", ["/PID", String(job.proc.pid), "/T", "/F"], { shell: true });
            tk.on("close", (code) => console.log(`taskkill (deleteThemeCacheInternal) job ${rid} -> code ${code}`));
          }
        } catch (e) {
          if (!silent) console.warn("taskkill escalation failed (deleteThemeCacheInternal)", e);
        }
      }, parseInt(process.env.ABORT_GRACE_MS || "1000", 10));
      job.status = "aborted";
      job.endedAt = Date.now();
      try { activeKeys.delete(`${projectId}:theme:${themeName}`); } catch { }
      clearTimeout(job.cleanupTimer);
      job.cleanupTimer = setTimeout(() => runningJobs.delete(rid), parseInt(process.env.JOB_TTL_MS || "300000", 10));
    } catch (e) {
      if (!silent) console.warn("Failed to abort theme job before delete", e);
    }
  }

  const themeDir = path.join(cacheDir, projectId, "_themes", themeName);
  let themeRemovalPath = themeDir;
  try {
    const relocated = await relocateDirectoryForRemoval(themeDir);
    if (relocated) {
      themeRemovalPath = relocated;
    }
  } catch (relocateErr) {
    if (!silent) console.warn("Failed to relocate theme cache prior to delete", projectId, themeName, relocateErr);
  }
  try {
    await removeDirectorySafe(themeRemovalPath, {});
    if (themeRemovalPath !== themeDir) {
      try {
        await removeDirectorySafe(themeDir, { attempts: 2, delayMs: 100 });
      } catch { }
    }
  } catch (rmErr) {
    if (!silent) console.error("Failed to remove theme cache directory", projectId, themeName, rmErr);
    throw rmErr;
  }

  const projectIndexPath = path.join(cacheDir, projectId, "index.json");
  let index = { layers: [] };
  try {
    const raw = fs.readFileSync(projectIndexPath, "utf8");
    if (raw) index = JSON.parse(raw);
  } catch {
    index = { layers: [] };
  }
  index.layers = Array.isArray(index.layers)
    ? index.layers.filter((entry) => !(entry && entry.name === themeName && (entry.kind || "layer") === "theme"))
    : [];
  try {
    fs.writeFileSync(projectIndexPath, JSON.stringify(index, null, 2), "utf8");
  } catch (err) {
    if (!silent) console.error("Failed to write project index after theme delete", err);
    throw err;
  }
  try {
    updateProjectConfig(projectId, {
      themes: {
        [themeName]: {
          lastResult: "deleted",
          lastMessage: "Theme cache removed",
          lastRunAt: new Date().toISOString()
        }
      }
    }, { skipReschedule: true });
  } catch (cfgErr) {
    if (!silent) console.warn("Failed to record theme delete in config", cfgErr);
  }
  logProjectEvent(projectId, `Theme ${themeName} cache deleted${force ? " (force)" : ""}.`);
  return { project: projectId, theme: themeName };
};

const allowedProjectExtensions = new Set([".qgz", ".qgs"]);
const defaultUploadLimit = parseInt(process.env.PROJECT_UPLOAD_MAX_BYTES || "209715200", 10); // 200 MB por defecto
const projectUpload = multer({
  storage: createDiskStorage("projects"),
  limits: { fileSize: Number.isFinite(defaultUploadLimit) && defaultUploadLimit > 0 ? defaultUploadLimit : 209715200 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (!allowedProjectExtensions.has(ext)) {
      const err = new Error("unsupported_filetype");
      err.code = "UNSUPPORTED_FILETYPE";
      return cb(err);
    }
    cb(null, true);
  }
});

const sanitizeProjectId = (value) => {
  if (value == null) return "";
  const str = String(value).trim();
  if (!str) return "";
  return str
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
};

const sanitizePluginName = (value) => {
  if (!value) return "";
  return String(value)
    .trim()
    .replace(/[^A-Za-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
};

const resolvePluginRoot = async (dir) => {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const candidateDirs = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("__MACOSX"));
  const meaningfulFiles = entries.filter((entry) => entry.isFile() && !entry.name.startsWith("._"));
  for (const entry of candidateDirs) {
    const maybeRoot = path.join(dir, entry.name);
    try {
      await fs.promises.access(path.join(maybeRoot, "index.js"), fs.constants.R_OK);
      return maybeRoot;
    } catch {
      // continue exploring other directories
    }
  }
  if (candidateDirs.length === 1 && meaningfulFiles.length === 0) {
    return path.join(dir, candidateDirs[0].name);
  }
  return dir;
};

const readJsonIfExists = async (filePath) => {
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const detectPluginName = async (rootDir, fallbackName = "") => {
  const candidates = [];
  const pluginManifest = await readJsonIfExists(path.join(rootDir, "plugin.json"));
  if (pluginManifest?.name) candidates.push(pluginManifest.name);
  const packageJson = await readJsonIfExists(path.join(rootDir, "package.json"));
  if (packageJson?.name) candidates.push(packageJson.name);
  if (fallbackName) candidates.push(fallbackName);
  for (const candidate of candidates) {
    const sanitized = sanitizePluginName(candidate);
    if (sanitized) return sanitized;
  }
  return null;
};

const copyRecursive = async (source, destination) => {
  const stats = await fs.promises.stat(source);
  if (stats.isDirectory()) {
    await fs.promises.mkdir(destination, { recursive: true });
    const entries = await fs.promises.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      await copyRecursive(path.join(source, entry.name), path.join(destination, entry.name));
    }
    return;
  }
  if (stats.isFile()) {
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.copyFile(source, destination);
  }
};

const removeRecursive = async (targetPath) => {
  await fs.promises.rm(targetPath, { recursive: true, force: true });
};

const allowedPluginExtensions = new Set([".zip"]);
const defaultPluginUploadLimit = parseInt(process.env.PLUGIN_UPLOAD_MAX_BYTES || "52428800", 10);
const pluginUpload = multer({
  storage: createDiskStorage("plugins"),
  limits: {
    fileSize: Number.isFinite(defaultPluginUploadLimit) && defaultPluginUploadLimit > 0
      ? defaultPluginUploadLimit
      : 52428800
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (!allowedPluginExtensions.has(ext)) {
      const err = new Error("unsupported_plugin_archive");
      err.code = "UNSUPPORTED_PLUGIN_ARCHIVE";
      return cb(err);
    }
    cb(null, true);
  }
});

// Detectar ejecutable python (permite override por .env)
const pythonExe = process.env.PYTHON_EXE || path.join(process.env.OSGEO4W_BIN || "C:\\OSGeo4W\\bin", "python.exe");

// crear env para procesos hijos incluyendo OSGeo4W paths si están en .env
const makeChildEnv = () => {
  const env = { ...process.env };
  // If a repo-local .env exists, prefer its values for child processes
  try {
    const envFile = path.join(__dirname, '.env');
    if (fs.existsSync(envFile)) {
      try {
        const parsed = dotenv.parse(fs.readFileSync(envFile, 'utf8'));
        for (const k of Object.keys(parsed)) {
          env[k] = parsed[k];
        }
      } catch (e) {
        // ignore parse errors
      }
    }
  } catch (e) {}
  if (process.env.OSGEO4W_BIN) {
    env.PATH = `${process.env.OSGEO4W_BIN};${env.PATH || ""}`;
  }
  if (process.env.QGIS_PREFIX) env.QGIS_PREFIX_PATH = process.env.QGIS_PREFIX;
  if (process.env.QT_PLUGIN_PATH) env.QT_PLUGIN_PATH = process.env.QT_PLUGIN_PATH;
  return env;
};

// helper: ejecutar comando dentro de la shell de OSGeo4W (o4w_env.bat)
const o4wBatch = process.env.O4W_BATCH || path.join(process.env.OSGEO4W_BIN || "C:\\OSGeo4W\\bin", "o4w_env.bat");

const runPythonViaOSGeo4W = (script, args = [], options = {}) => {
  // Ejecutar el batch (o4w_env) y luego python en la misma cmd para heredar el entorno.
  // Por defecto suprimimos la salida del batch para mantener los logs limpios.
  // El batch siempre se ejecuta en modo silencioso (>nul 2>&1) para evitar ruido
  // en los registros del servidor. Si necesitas depuración explícita, establece
  // manualmente la variable en el entorno antes de arrancar el servidor.
  const o4wPart = `"${o4wBatch}" >nul 2>&1`;
  const cmdParts = [
    o4wPart,
    "&&",
    `"${pythonExe}"`,
    `"${script}"`,
    ...args.map(a => `"${String(a)}"`)
  ];
  const cmd = cmdParts.join(" ");
  return spawn(cmd, { shell: true, env: makeChildEnv(), cwd: __dirname, ...options });
};

// pequeño helper para extraer JSON de una respuesta con ruido (fall back)
function extractJsonLike(text) {
  if (!text) return null;
  const startIdx = Math.min(
    ...["{", "["].map(ch => { const i = text.indexOf(ch); return i === -1 ? Infinity : i; })
  );
  if (startIdx === Infinity) return null;
  // buscar cierre más a la derecha para '}' o ']'
  const endIdx = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (endIdx <= startIdx) return null;
  return text.slice(startIdx, endIdx + 1);
}

const sanitizeExtentCoordinates = (value) => {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const parsed = value.map((coordinate) => {
    const num = Number(coordinate);
    return Number.isFinite(num) ? num : null;
  });
  return parsed.every((num) => num != null) ? parsed : null;
};

const coalesceExtent = (...candidates) => {
  for (const candidate of candidates) {
    const cleaned = sanitizeExtentCoordinates(candidate);
    if (cleaned) return cleaned;
  }
  return null;
};

const normalizeCrsCode = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().toUpperCase();
  return normalized || null;
};

const cloneObject = (value) => {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
};

const loadBootstrapPresetDefinition = (presetInfo) => {
  if (!presetInfo || !presetInfo.path) {
    return null;
  }
  const presetPath = presetInfo.path;
  try {
    if (!bootstrapPresetCache.has(presetPath)) {
      if (!fs.existsSync(presetPath)) {
        bootstrapPresetCache.set(presetPath, null);
      } else {
        const raw = fs.readFileSync(presetPath, "utf8");
        bootstrapPresetCache.set(presetPath, raw ? JSON.parse(raw) : null);
      }
    }
    const cached = bootstrapPresetCache.get(presetPath);
    return cloneObject(cached);
  } catch (err) {
    console.warn("[bootstrap] Failed to load preset definition", presetPath, err?.message || err);
    bootstrapPresetCache.delete(presetPath);
    return null;
  }
};

const buildGlobalMercatorProfile = (sourceLabel = "fallback") => {
  const scheme = RAW_BOOTSTRAP_SCHEME === "wmts" ? "wmts" : "xyz";
  return {
    tileCrs: "EPSG:3857",
    scheme,
    tileMatrixPreset: "EPSG_3857",
    tileMatrixSet: scheme === "wmts"
      ? buildGlobalMercatorMatrixSet(Math.max(BOOTSTRAP_ZOOM_MIN, BOOTSTRAP_ZOOM_MAX))
      : null,
    source: sourceLabel
  };
};

const createAutoGridPreset = (crs, extent, projectId = null) => {
  if (!crs || !extent || extent.length < 4) return null;
  try {
    if (!fs.existsSync(tileGridDir)) {
      fs.mkdirSync(tileGridDir, { recursive: true });
    }
    const safeCrs = crs.replace(/[^a-zA-Z0-9]/g, "_");
    const safeProject = projectId ? `_${projectId.replace(/[^a-zA-Z0-9]/g, "_")}` : "";
    const safeId = `${safeCrs}${safeProject}`;
    const filename = `${safeId}.json`;
    const filePath = path.join(tileGridDir, filename);
    
    if (fs.existsSync(filePath)) return safeId;

    const width = extent[2] - extent[0];
    const height = extent[3] - extent[1];
    const maxDim = Math.max(width, height);
    // Level 0 fits the extent in one 256px tile
    const startRes = maxDim / 256;
    
    const matrices = [];
    for (let z = 0; z <= 22; z++) {
      const res = startRes / Math.pow(2, z);
      const scaleDen = res / 0.00028;
      // For Leaflet/Proj4Leaflet compatibility, matrix dimensions must be powers of 2
      // This ensures tile coordinates (x,y) are calculated correctly by the client
      const numTiles = Math.pow(2, z);
      matrices.push({
        identifier: String(z),
        id: String(z),
        z: z,
        source_level: z,
        resolution: res,
        scale_denominator: scaleDen,
        matrix_width: numTiles,
        matrix_height: numTiles,
        tileWidth: 256,
        tileHeight: 256,
        topLeftCorner: [extent[0], extent[3]],
        top_left: [extent[0], extent[3]]
      });
    }

    const preset = {
      id: safeId,
      title: `Auto-generated for ${crs}${projectId ? ` (${projectId})` : ''}`,
      supported_crs: [crs],
      coordinateReferenceSystem: crs,
      tile_width: 256,
      tile_height: 256,
      axis_order: "xy",
      top_left_corner: [extent[0], extent[3]],
      topLeftCorner: [extent[0], extent[3]],
      matrices: matrices,
      matrixSet: matrices,
      auto_generated: true,
      project_id: projectId
    };

    fs.writeFileSync(filePath, JSON.stringify(preset, null, 2));
    console.log(`[auto-grid] Generated new preset for ${crs} at ${filePath}`);
    invalidateTileGridCaches();
    return safeId;
  } catch (e) {
    console.error("Failed to write auto preset", e);
    return null;
  }
};

const pickBootstrapTileProfile = (candidateList = [], autoGenExtent = null, projectId = null) => {
  const candidates = Array.isArray(candidateList) ? candidateList : [];
  for (const candidate of candidates) {
    const value = typeof candidate === "object" && candidate !== null ? candidate.value : candidate;
    const source = typeof candidate === "object" && candidate !== null && candidate.source ? candidate.source : undefined;
    const normalized = normalizeCrsCode(value);
    if (!normalized) continue;
    if (normalized === "EPSG:3857") {
      const profile = buildGlobalMercatorProfile(source || "epsg3857");
      return profile;
    }
    let preset = findTileMatrixPresetForCrs(normalized);
    
    // Auto-generate if missing and we have an extent
    if (!preset && normalized !== "EPSG:3857" && autoGenExtent) {
      createAutoGridPreset(normalized, autoGenExtent, projectId);
      preset = findTileMatrixPresetForCrs(normalized);
    }

    if (preset) {
      const presetPayload = loadBootstrapPresetDefinition(preset);
      const presetId = preset.fileName || preset.id || normalized;
      if (presetPayload) {
        if (!presetPayload.id) presetPayload.id = presetId;
        if (!presetPayload.supported_crs) presetPayload.supported_crs = normalized;
      }
      return {
        tileCrs: normalized,
        scheme: "wmts",
        tileMatrixPreset: presetId,
        tileMatrixSet: presetPayload ? cloneObject(presetPayload) : null,
        source: source || "preset"
      };
    }
    if (!preset && normalized !== "EPSG:3857") {
      console.warn(`[bootstrap] Tile grid preset missing for CRS ${normalized}${source ? ` (source: ${source})` : ""}; falling back to next candidate.`);
    }
  }
  return buildGlobalMercatorProfile("fallback");
};

const runExtractInfoForProject = (projectPath) => new Promise((resolve, reject) => {
  if (!projectPath) return resolve(null);
  const script = path.join(pythonDir, "extract_info.py");
  if (!fs.existsSync(script)) {
    return resolve(null);
  }
  const args = ["--project", projectPath];
  const proc = runPythonViaOSGeo4W(script, args);
  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdout += text;
  });
  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
  });
  proc.on("error", (err) => reject(err));
  proc.on("close", (code) => {
    const raw = (stdout && stdout.trim()) || (stderr && stderr.trim()) || "";
    const candidate = extractJsonLike(raw);
    if (!candidate) {
      if (code === 0) return resolve(null);
      const error = new Error("extract_info_failed");
      error.details = raw;
      return reject(error);
    }
    try {
      resolve(JSON.parse(candidate));
    } catch (err) {
      err.details = raw;
      reject(err);
    }
  });
});

const buildBootstrapEntriesFromExtract = (projectId, projectPath, extractPayload) => {
  if (!extractPayload || typeof extractPayload !== "object") {
    return { entries: [], projectExtent: null, projectExtentWgs: null, projectCrs: null, defaultTileProfile: null };
  }
  const now = new Date().toISOString();
  const entries = [];
  const usedKeys = new Set();
  const projectInfo = extractPayload.project || {};
  const projectExtent = coalesceExtent(projectInfo.extent, projectInfo.view_extent) || BOOTSTRAP_EXTENT_FALLBACK;
  const projectExtentWgs = coalesceExtent(projectInfo.extent_wgs84, projectInfo.view_extent_wgs84);
  const projectCrs = projectInfo.crs || null;
  const projectCrsNormalized = normalizeCrsCode(projectCrs);
  const EXTENT_RATIO_THRESHOLD = 25;
  const computeExtentArea = (bbox) => {
    const clean = sanitizeExtentCoordinates(bbox);
    if (!clean) return null;
    const width = clean[2] - clean[0];
    const height = clean[3] - clean[1];
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return null;
    }
    return Math.abs(width * height);
  };
  const projectExtentArea = projectExtent ? computeExtentArea(projectExtent) : null;
  const isExtentSignificantlyLargerThanProject = (candidate) => {
    if (!projectExtentArea) return false;
    const candidateArea = computeExtentArea(candidate);
    if (!candidateArea) return false;
    return (candidateArea / projectExtentArea) >= EXTENT_RATIO_THRESHOLD;
  };

  const addEntry = (rawName, kind, options = {}) => {
    if (!rawName) return;
    const baseName = String(rawName).trim();
    if (!baseName) return;
    let finalName = baseName;
    let suffix = 1;
    while (usedKeys.has(`${kind}:${finalName}`)) {
      finalName = `${baseName}_${suffix}`;
      suffix += 1;
    }
    usedKeys.add(`${kind}:${finalName}`);

    const extentLooksGlobal = options.extent && isExtentSignificantlyLargerThanProject(options.extent);
    const preferProjectExtent = options.preferProjectExtent === true
      || (options.preferProjectExtent === undefined && extentLooksGlobal);
    const extent = preferProjectExtent
      ? coalesceExtent(projectExtent, options.extent, BOOTSTRAP_EXTENT_FALLBACK)
      : coalesceExtent(options.extent, projectExtent, BOOTSTRAP_EXTENT_FALLBACK);
    const extentWgs = preferProjectExtent
      ? coalesceExtent(projectExtentWgs, options.extentWgs) || null
      : coalesceExtent(options.extentWgs, projectExtentWgs) || null;

    const tileProfile = pickBootstrapTileProfile([
      { value: projectCrs, source: "project" },
      { value: options.crs, source: kind === "theme" ? "project" : "layer" },
      { value: BOOTSTRAP_TILE_CRS, source: "config" }
    ], projectExtent, projectId);
    const entryTileCrs = tileProfile.tileCrs || projectCrsNormalized || BOOTSTRAP_TILE_CRS;

    const entry = {
      name: finalName,
      kind,
      scheme: tileProfile.scheme,
      tile_crs: entryTileCrs,
      crs: entryTileCrs,
      layer_crs: options.crs || null,
      cacheable: options.cacheable !== false,
      extent,
      extent_wgs84: extentWgs,
      zoom_min: BOOTSTRAP_ZOOM_MIN,
      zoom_max: BOOTSTRAP_ZOOM_MAX,
      published_zoom_min: BOOTSTRAP_ZOOM_MIN,
      published_zoom_max: BOOTSTRAP_ZOOM_MAX,
      cached_zoom_min: null,
      cached_zoom_max: null,
      tile_format: "png",
      xyz_mode: "partial",
      project_crs: projectCrs || entryTileCrs,
      project_extent: projectExtent,
      project_extent_wgs84: projectExtentWgs,
      bootstrap: true,
      bootstrap_source: "extract_info",
      bootstrap_at: now,
      created: now,
      updated: now,
      path: resolveTileBaseDir(projectId, kind, finalName),
      tile_profile_source: tileProfile.source || null
    };
    if (kind === "theme") {
      entry.theme = finalName;
    } else {
      entry.layer = finalName;
      if (options.layerId) {
        entry.layer_id = options.layerId;
      }
    }
    if (tileProfile.tileMatrixPreset) {
      entry.tile_matrix_preset = tileProfile.tileMatrixPreset;
    }
    if (tileProfile.tileMatrixSet) {
      entry.tile_matrix_set = tileProfile.tileMatrixSet;
    }
    entries.push(entry);
  };

  const remoteLayerProviders = new Set(["wms", "wmts", "xyz", "tile"]);
  const layerList = Array.isArray(extractPayload.layers) ? extractPayload.layers : [];
  for (const layer of layerList) {
    if (!layer) continue;
    const name = layer.name || layer.id || null;
    if (!name) continue;
    const provider = typeof layer.provider === "string" ? layer.provider.trim().toLowerCase() : "";
    const preferProjectExtent = remoteLayerProviders.has(provider) || !!layer.remote_source;
    addEntry(name, "layer", {
      extent: layer.extent,
      extentWgs: layer.extent_wgs84,
      crs: layer.crs,
      cacheable: layer.cacheable !== false,
      layerId: layer.id || null,
      preferProjectExtent
    });
  }

  const themeList = Array.isArray(extractPayload.themes) ? extractPayload.themes : [];
  for (const theme of themeList) {
    const name = typeof theme?.name === "string" ? theme.name : null;
    if (!name) continue;
    addEntry(name, "theme", {});
  }

  if (!entries.length) {
    addEntry(projectId, "layer", {});
  }

  const defaultTileProfile = entries.length
    ? {
        scheme: entries[0].scheme,
        tileCrs: entries[0].tile_crs,
        tileMatrixPreset: entries[0].tile_matrix_preset || null
      }
    : null;

  return { entries, projectExtent, projectExtentWgs, projectCrs, defaultTileProfile };
};

const bootstrapProjectCacheIndex = async (projectId, projectPath, force = false) => {
  if (!ENABLE_PROJECT_BOOTSTRAP) return false;
  if (!projectId || !projectPath) return false;
  let existing;
  try {
    existing = loadProjectIndexData(projectId);
    if (!force && Array.isArray(existing.layers) && existing.layers.length > 0) {
      return false;
    }
  } catch (err) {
    console.warn(`[bootstrap] Failed to read existing index for ${projectId}`, err?.message || err);
    existing = null;
  }
  let extractPayload;
  try {
    extractPayload = await runExtractInfoForProject(projectPath);
  } catch (err) {
    console.warn(`[bootstrap] Metadata extraction failed for ${projectId}`, err?.message || err);
    return false;
  }
  if (!extractPayload) {
    return false;
  }
  const {
    entries,
    projectExtent,
    projectExtentWgs,
    projectCrs,
    defaultTileProfile
  } = buildBootstrapEntriesFromExtract(projectId, projectPath, extractPayload);
  if (!entries.length) {
    return false;
  }
  const now = new Date().toISOString();
  const base = existing && typeof existing === "object" ? { ...existing } : {};
  const payload = {
    ...base,
    project: extractPayload.project?.path || projectPath,
    id: projectId,
    created: base.created || now,
    updated: now,
    layers: entries,
    bootstrap: true
  };
  try {
    writeProjectIndexData(projectId, payload);
    console.log(`[bootstrap] Initialized cache index for project ${projectId} (${entries.length} placeholder layer(s))`);
    seedProjectConfigFromBootstrap(projectId, {
      projectExtent,
      projectExtentWgs,
      projectCrs,
      zoomMin: BOOTSTRAP_ZOOM_MIN,
      zoomMax: BOOTSTRAP_ZOOM_MAX,
      tileProfile: defaultTileProfile
    });
    return true;
  } catch (err) {
    console.warn(`[bootstrap] Failed to persist index for ${projectId}`, err?.message || err);
    return false;
  }
};

const seedProjectConfigFromBootstrap = (projectId, info = {}) => {
  if (!projectId) return;
  try {
    const current = readProjectConfig(projectId, { useCache: false });
    if (!current) return;
    const patch = {};
    const nowIso = new Date().toISOString();

    const bbox = sanitizeExtentCoordinates(info.projectExtent);
    const currentBbox = current?.extent?.bbox;
    const extentMissing = !Array.isArray(currentBbox) || currentBbox.length !== 4 || currentBbox.some((value) => value == null);
    if (bbox && extentMissing) {
      patch.extent = {
        bbox,
        crs: info.projectCrs || current?.extent?.crs || null,
        updatedAt: nowIso
      };
    }

    const currentZoomMin = current?.zoom?.min;
    const currentZoomMax = current?.zoom?.max;
    if (currentZoomMin == null || currentZoomMax == null) {
      const seededMin = currentZoomMin != null ? currentZoomMin : (info.zoomMin != null ? info.zoomMin : BOOTSTRAP_ZOOM_MIN);
      const seededMaxCandidate = currentZoomMax != null ? currentZoomMax : (info.zoomMax != null ? info.zoomMax : BOOTSTRAP_ZOOM_MAX);
      const seededMax = Math.max(seededMaxCandidate, seededMin);
      patch.zoom = {
        min: seededMin,
        max: seededMax,
        updatedAt: nowIso
      };
    }

    if (info.tileProfile && info.tileProfile.tileCrs) {
      const prefs = current.cachePreferences || {};
      const needsTileCrs = !prefs.tileCrs || prefs.tileCrs === BOOTSTRAP_TILE_CRS || prefs.tileCrs === "EPSG:3857";
      const needsMode = !prefs.mode || prefs.mode === "xyz";
      if (needsTileCrs || needsMode || !prefs.updatedAt) {
        patch.cachePreferences = {
          mode: info.tileProfile.scheme || prefs.mode || "xyz",
          tileCrs: info.tileProfile.tileCrs || prefs.tileCrs || BOOTSTRAP_TILE_CRS,
          allowRemote: typeof prefs.allowRemote === "boolean" ? prefs.allowRemote : false,
          throttleMs: Number.isFinite(Number(prefs.throttleMs)) ? Number(prefs.throttleMs) : 0,
          updatedAt: nowIso
        };
      }
    }

    if (Object.keys(patch).length) {
      updateProjectConfig(projectId, patch, { skipReschedule: true });
      console.log(`[bootstrap] Seeded project config for ${projectId} (extent/zoom/cache preferences).`);
    }
  } catch (err) {
    console.warn(`[bootstrap] Failed to seed project config for ${projectId}`, err?.message || err);
  }
};

// utilidades de proyectos
const listProjects = () => {
  try {
    if (!fs.existsSync(projectsDir)) return [];
    const files = fs.readdirSync(projectsDir, { withFileTypes: true });
    const items = files
      .filter(d => d.isFile() && (d.name.toLowerCase().endsWith('.qgz') || d.name.toLowerCase().endsWith('.qgs')))
      .map(d => {
        const id = d.name.replace(/\.(qgz|qgs)$/i, "");
        return { id, name: id, file: path.join(projectsDir, d.name) };
      });
    return items;
  } catch (e) { return []; }
};
const findProjectById = (id) => listProjects().find(p => p.id === id);

const persistProjectAccessSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object") return;
  try {
    fs.mkdirSync(path.dirname(projectAccessPath), { recursive: true });
    fs.writeFileSync(projectAccessPath, JSON.stringify(snapshot, null, 2), "utf8");
  } catch (err) {
    throw new Error(`Failed to write project access snapshot: ${err?.message || err}`);
  }
  for (const legacyPath of legacyProjectAccessPaths) {
    try {
      fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
      fs.writeFileSync(legacyPath, JSON.stringify(snapshot, null, 2), "utf8");
    } catch (legacyErr) {
      if (legacyErr?.code !== "ENOENT") {
        console.warn("Failed to update legacy project access snapshot", { legacyPath, error: String(legacyErr?.message || legacyErr) });
      }
    }
  }
};

const readProjectAccessSnapshot = () => {
  const createDefaultSnapshot = () => ({ projects: {} });

  const readSnapshotFrom = (filePath) => {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const raw = fs.readFileSync(filePath, "utf8");
      if (!raw) return createDefaultSnapshot();
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (!parsed.projects || typeof parsed.projects !== "object") {
          parsed.projects = {};
        }
        return parsed;
      }
    } catch (err) {
      if (err?.code !== "ENOENT") {
        console.warn("Failed to read project access snapshot", { filePath, error: String(err?.message || err) });
      }
    }
    return null;
  };

  const candidatePaths = [projectAccessPath, ...legacyProjectAccessPaths];
  const candidates = [];
  for (const filePath of candidatePaths) {
    const snapshot = readSnapshotFrom(filePath);
    if (!snapshot) continue;
    let mtimeMs = 0;
    try {
      const stats = fs.statSync(filePath);
      if (stats && Number.isFinite(stats.mtimeMs)) {
        mtimeMs = stats.mtimeMs;
      }
    } catch (err) {
      mtimeMs = 0;
    }
    candidates.push({ filePath, snapshot, mtimeMs });
  }

  if (!candidates.length) {
    const defaults = createDefaultSnapshot();
    try {
      persistProjectAccessSnapshot(defaults);
    } catch (err) {
      console.warn("Failed to seed project access snapshot", String(err?.message || err));
    }
    return defaults;
  }

  candidates.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
  const best = candidates[0];
  if (best.filePath !== projectAccessPath) {
    try {
      persistProjectAccessSnapshot(best.snapshot);
      console.log("Synchronized project access snapshot", { source: best.filePath, target: projectAccessPath });
    } catch (err) {
      console.warn("Failed to synchronize project access snapshot", { source: best.filePath, error: String(err?.message || err) });
    }
  }
  return best.snapshot;
};

const removeProjectAccessEntry = (projectId) => {
  if (!projectId) return;
  const snapshot = readProjectAccessSnapshot();
  if (!snapshot || typeof snapshot !== "object") return;
  if (!snapshot.projects || typeof snapshot.projects !== "object") {
    snapshot.projects = {};
  }
  if (!Object.prototype.hasOwnProperty.call(snapshot.projects, projectId)) return;
  delete snapshot.projects[projectId];
  persistProjectAccessSnapshot(snapshot);
};

const purgeProjectFromAuthUsers = (projectId) => {
  if (!projectId) return;
  for (const filePath of authUserSnapshotPaths) {
    let changed = false;
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, "utf8");
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object" || !Array.isArray(data.users)) continue;
      for (const user of data.users) {
        if (!Array.isArray(user?.projects)) continue;
        const filtered = user.projects.filter((id) => id !== projectId);
        if (filtered.length !== user.projects.length) {
          user.projects = filtered;
          changed = true;
        }
      }
      if (changed) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
      }
    } catch (err) {
      if (err?.code === "ENOENT") continue;
      throw new Error(`Failed to update auth users at ${filePath}: ${err?.message || err}`);
    }
  }
};

const removeProjectLogs = (projectId) => {
  if (!projectId) return;
  const candidates = [
    path.join(logsDir, `project-${projectId}.log`),
    path.join(logsDir, `${projectId}.log`)
  ];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      if (err?.code === "ENOENT") continue;
      throw new Error(`Failed to remove project log ${filePath}: ${err?.message || err}`);
    }
  }
};

const resolveProjectAccessEntry = (snapshot, projectId) => {
  if (!snapshot || typeof snapshot !== "object") return null;
  const projects = snapshot.projects && typeof snapshot.projects === "object" ? snapshot.projects : {};
  if (!projectId) return null;
  if (Object.prototype.hasOwnProperty.call(projects, projectId)) {
    const directEntry = projects[projectId];
    if (directEntry && typeof directEntry === "object") return directEntry;
  }
  const target = String(projectId).toLowerCase();
  for (const key of Object.keys(projects)) {
    if (key.toLowerCase() === target) {
      const entry = projects[key];
      if (entry && typeof entry === "object") return entry;
    }
  }
  return null;
};

const isProjectPublic = (snapshot, projectId) => {
  const entry = resolveProjectAccessEntry(snapshot, projectId);
  return !!(entry && entry.public === true);
};

const deriveProjectAccess = (snapshot, user, projectId) => {
  const accessEntry = resolveProjectAccessEntry(snapshot, projectId) || {};
  if (user && user.role === "admin") {
    return {
      public: accessEntry.public === true,
      viaAssignment: true,
      viaRole: true,
      viaUser: false,
      allowed: true,
      admin: true
    };
  }
  const userProjects = Array.isArray(user?.projects) ? user.projects : [];
  const viaAssignment = userProjects.includes(projectId);
  const viaUser = user?.id && Array.isArray(accessEntry.allowedUsers) && accessEntry.allowedUsers.includes(user.id);
  const viaRole = user?.role && Array.isArray(accessEntry.allowedRoles) && accessEntry.allowedRoles.includes(user.role);
  const publicAccess = accessEntry.public === true;
  const allowed = publicAccess || viaAssignment || viaUser || viaRole;
  return {
    public: publicAccess,
    viaAssignment,
    viaRole,
    viaUser,
    allowed
  };
};

const cloneIndexEntry = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  try {
    return JSON.parse(JSON.stringify(entry));
  } catch {
    return { ...entry };
  }
};

const buildProjectDescriptor = (project, { snapshot, access } = {}) => {
  if (!project) return null;
  const projectId = project.id;
  const indexData = loadProjectIndexData(projectId);
  const rawLayers = Array.isArray(indexData.layers) ? indexData.layers : [];
  const layers = [];
  const themes = [];
  for (const entry of rawLayers) {
    if (!entry || !entry.name) continue;
    const kindToken = typeof entry.kind === "string" ? entry.kind.toLowerCase() : (entry.theme ? "theme" : "layer");
    const clone = cloneIndexEntry(entry) || {};
    clone.kind = kindToken;
    clone.projectId = projectId;
    if (kindToken === "theme") {
      themes.push(clone);
    } else {
      layers.push(clone);
    }
  }
  const config = readProjectConfig(projectId);
  const projectMeta = config && typeof config === "object" && config.project ? config.project : null;
  const displayName = projectMeta?.title || projectMeta?.name || project.name || projectId;
  const summary = projectMeta?.summary || projectMeta?.description || null;
  const wmtsUrl = `/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&project=${encodeURIComponent(projectId)}`;
  const cacheUpdatedAt = indexData.updated || indexData.modified || indexData.generatedAt || indexData.created || null;
  const accessInfo = access && typeof access === "object" ? access : { public: true, allowed: true };
  return {
    id: projectId,
    name: project.name,
    title: displayName,
    summary,
    public: accessInfo.public === true,
    wmtsUrl,
    cacheUpdatedAt,
    layers,
    themes,
    access: {
      public: accessInfo.public === true,
      viaAssignment: accessInfo.viaAssignment === true,
      viaRole: accessInfo.viaRole === true,
      viaUser: accessInfo.viaUser === true,
      allowed: accessInfo.allowed !== false
    }
  };
};

const buildPublicProjectsListing = () => {
  const securityEnabled = security.isEnabled();
  const snapshot = securityEnabled ? readProjectAccessSnapshot() : { projects: {} };
  const projects = listProjects();
  const visible = [];
  for (const project of projects) {
    if (securityEnabled && !isProjectPublic(snapshot, project.id)) continue;
    const accessInfo = securityEnabled
      ? { ...deriveProjectAccess(snapshot, null, project.id), public: true, allowed: true }
      : { public: true, allowed: true };
    const descriptor = buildProjectDescriptor(project, { snapshot, access: accessInfo });
    if (descriptor) visible.push(descriptor);
  }
  return { projects: visible, generatedAt: new Date().toISOString() };
};

const resolvePublicProject = (projectId) => {
  const securityEnabled = security.isEnabled();
  const snapshot = securityEnabled ? readProjectAccessSnapshot() : { projects: {} };
  const project = findProjectById(projectId);
  if (!project) return null;
  if (securityEnabled && !isProjectPublic(snapshot, project.id)) {
    return null;
  }
  const accessInfo = securityEnabled
    ? { ...deriveProjectAccess(snapshot, null, project.id), public: true, allowed: true }
    : { public: true, allowed: true };
  return buildProjectDescriptor(project, { snapshot, access: accessInfo });
};

app.get("/public/projects", (_req, res) => {
  try {
    const listing = buildPublicProjectsListing();
    res.json(listing);
  } catch (err) {
    console.error("Failed to build public project listing", err);
    res.status(500).json({ error: "public_projects_failed", details: String(err?.message || err) });
  }
});

app.get("/public/projects/:id", (req, res) => {
  try {
    const projectId = sanitizeProjectId(req.params.id);
    if (!projectId) {
      return res.status(400).json({ error: "project_id_required" });
    }
    const descriptor = resolvePublicProject(projectId);
    if (!descriptor) {
      return res.status(404).json({ error: "project_not_found_or_private" });
    }
    res.json({ project: descriptor });
  } catch (err) {
    console.error("Failed to resolve public project", err);
    res.status(500).json({ error: "public_project_failed", details: String(err?.message || err) });
  }
});

app.get("/public/my-projects", (req, res) => {
  if (!security.isEnabled()) {
    return res.status(404).json({ error: "auth_plugin_disabled" });
  }
  if (!req.user) {
    return res.status(401).json({ error: "auth_required" });
  }
  try {
    const snapshot = readProjectAccessSnapshot();
    const projects = listProjects();
    const visible = [];
    for (const project of projects) {
      const accessInfo = deriveProjectAccess(snapshot, req.user, project.id);
      if (!accessInfo.allowed && req.user.role !== "admin") continue;
      const descriptor = buildProjectDescriptor(project, { snapshot, access: accessInfo });
      if (descriptor) visible.push(descriptor);
    }
    res.json({ projects: visible, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("Failed to build user project listing", err);
    res.status(500).json({ error: "my_projects_failed", details: String(err?.message || err) });
  }
});

const initializeProjectSchedules = () => {
  const projects = listProjects();
  for (const proj of projects) {
    try {
      const cfg = readProjectConfig(proj.id);
      scheduleProjectRecache(proj.id, cfg);
    } catch (err) {
      console.error(`Failed to initialize schedule for project ${proj.id}:`, err);
    }
  }
};

const startScheduleHeartbeat = () => {
  if (!Number.isFinite(SCHEDULE_HEARTBEAT_INTERVAL_MS) || SCHEDULE_HEARTBEAT_INTERVAL_MS <= 0) {
    return;
  }
  const interval = Math.max(1000, SCHEDULE_HEARTBEAT_INTERVAL_MS);
  const grace = Number.isFinite(SCHEDULE_OVERDUE_GRACE_MS) && SCHEDULE_OVERDUE_GRACE_MS >= 0
    ? SCHEDULE_OVERDUE_GRACE_MS
    : 5000;
  const tick = () => {
    const now = Date.now();
    for (const [projectId, info] of projectTimers.entries()) {
      if (!info || !Number.isFinite(info.targetTime)) continue;
      if (info.targetTime <= now - grace) {
        const label = info.item ? `${info.item.kind}:${info.item.name}` : "task";
        console.warn(`Schedule heartbeat forcing overdue timer for ${projectId} (${label}) target ${new Date(info.targetTime).toISOString()}.`);
        handleProjectTimer(projectId, info.targetTime).catch((err) => {
          console.error(`Heartbeat execution failed for ${projectId}:`, err);
        });
      }
    }
    const seen = new Set(projectTimers.keys());
    const projects = listProjects();
    for (const proj of projects) {
      if (!proj || !proj.id || seen.has(proj.id)) continue;
      try {
        const cfg = readProjectConfig(proj.id);
        const items = deriveProjectScheduleItems(proj.id, cfg, { now });
        if (items.length) {
          scheduleProjectRecache(proj.id, cfg);
        }
      } catch (err) {
        console.error(`Schedule heartbeat failed to reschedule ${proj.id}:`, err);
      }
    }
  };
  const timer = setInterval(tick, interval);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
};

// listar proyectos
app.get("/projects", (req, res) => {
  const allProjects = listProjects();
  const authEnabled = security.isEnabled && security.isEnabled();
  
  if (!authEnabled) {
    return res.json({
      projects: allProjects.map(p => ({ ...p, access: 'public' })),
      authEnabled: false,
      user: { role: 'admin' }
    });
  }

  const user = req.user;
  const isAdmin = user && user.role === 'admin';
  const accessSnapshot = readProjectAccessSnapshot();
  
  console.log('[/projects] Debug:', {
    totalProjects: allProjects.length,
    projectIds: allProjects.map(p => p.id),
    accessSnapshot: accessSnapshot.projects,
    user: user ? { id: user.id, role: user.role } : null
  });
  
  const visibleProjects = allProjects.map(p => {
    const accessConfig = resolveProjectAccessEntry(accessSnapshot, p.id) || {};
    const isPublic = accessConfig.public === true;
    const allowedRoles = Array.isArray(accessConfig.allowedRoles) ? accessConfig.allowedRoles : [];
    const allowedUsers = Array.isArray(accessConfig.allowedUsers) ? accessConfig.allowedUsers : [];
    
    let accessLevel = 'private';
    if (isPublic) accessLevel = 'public';
    else if (allowedRoles.includes('authenticated')) accessLevel = 'authenticated';
    
    return { 
      ...p, 
      access: accessLevel,
      isPublic,
      allowedRoles,
      allowedUsers
    };
  }).filter(p => {
    if (isAdmin) return true;
    if (p.isPublic) return true;
    if (!user) return false;
    if (p.allowedRoles.includes('authenticated')) return true;
    if (p.allowedRoles.includes(user.role)) return true;
    if (p.allowedUsers.includes(user.id)) return true;
    return false;
  });

  res.json({
    projects: visibleProjects,
    authEnabled: true,
    user: user ? { id: user.id, role: user.role } : null
  });
});

app.post("/projects", requireAdmin, (req, res) => {
  projectUpload.single("project")(req, res, async (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "file_too_large" });
      }
      if (err.code === "UNSUPPORTED_FILETYPE") {
        return res.status(400).json({ error: "unsupported_filetype", allowed: Array.from(allowedProjectExtensions) });
      }
      return res.status(500).json({ error: "upload_failed", details: String(err) });
    }
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "project_file_required" });
    }
    const ext = path.extname(file.originalname || "").toLowerCase();
    const preferredIdRaw = req.body?.projectId || req.body?.name || path.basename(file.originalname || "project", ext);
    let projectId = sanitizeProjectId(preferredIdRaw);
    if (!projectId) {
      projectId = `project_${Date.now()}`;
    }
    let targetName = `${projectId}${ext}`;
    let suffix = 1;
    while (fs.existsSync(path.join(projectsDir, targetName))) {
      targetName = `${projectId}_${suffix}${ext}`;
      suffix += 1;
    }
    const targetPath = path.join(projectsDir, targetName);
    try {
      if (!file.path) {
        throw new Error("temporary_upload_missing");
      }
      await fs.promises.copyFile(file.path, targetPath);
    } catch (writeErr) {
      return res.status(500).json({ error: "write_failed", details: String(writeErr) });
    } finally {
      if (file.path) {
        try {
          await fs.promises.unlink(file.path);
        } catch {
          // ignore cleanup errors
        }
      }
    }
    const finalId = targetName.replace(/\.(qgz|qgs)$/i, "");
    try {
      await bootstrapProjectCacheIndex(finalId, targetPath);
    } catch (bootstrapErr) {
      console.warn(`[bootstrap] Initialization failed for ${finalId}:`, bootstrapErr?.message || bootstrapErr);
    }
    return res.status(201).json({ status: "uploaded", id: finalId, filename: targetName });
  });
});

app.delete("/projects/:id", requireAdmin, (req, res) => {
  const projectId = req.params.id;
  if (!projectId) {
    return res.status(400).json({ error: "project_id_required" });
  }
  const proj = findProjectById(projectId);
  if (!proj) {
    return res.status(404).json({ error: "project_not_found" });
  }

  for (const [jobId, job] of runningJobs.entries()) {
    if (job.project === proj.id && job.status === "running") {
      try { job.proc.kill(); job.status = "aborted"; job.endedAt = Date.now(); } catch { }
      try { activeKeys.delete(`${job.project || ""}:${job.layer}`); } catch { }
    }
  }

  try {
    fs.unlinkSync(proj.file);
  } catch (err) {
    return res.status(500).json({ error: "delete_failed", details: String(err) });
  }

  cancelProjectTimer(proj.id);
  projectConfigCache.delete(proj.id);
  projectLogLastMessage.delete(proj.id);
  const batchTimer = projectBatchCleanupTimers.get(proj.id);
  if (batchTimer) {
    try { clearTimeout(batchTimer); } catch { }
    projectBatchCleanupTimers.delete(proj.id);
  }
  projectBatchRuns.delete(proj.id);

  const projectCacheDir = path.join(cacheDir, proj.id);
  let cacheRemoved = false;
  if (fs.existsSync(projectCacheDir)) {
    try {
      // Read index.json to find auto-generated preset
      const indexPath = path.join(projectCacheDir, 'index.json');
      if (fs.existsSync(indexPath)) {
        try {
          const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
          if (Array.isArray(indexData.layers)) {
            for (const layer of indexData.layers) {
              if (layer.tile_matrix_preset && typeof layer.tile_matrix_preset === 'string') {
                const presetPath = path.join(tileGridDir, `${layer.tile_matrix_preset}.json`);
                if (fs.existsSync(presetPath)) {
                  try {
                    const presetData = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
                    if (presetData.auto_generated === true && presetData.project_id === proj.id) {
                      fs.unlinkSync(presetPath);
                      console.log(`[cleanup] Removed auto-generated preset: ${layer.tile_matrix_preset}`);
                      invalidateTileGridCaches();
                    }
                  } catch (presetErr) {
                    console.warn(`[cleanup] Failed to check/delete preset ${layer.tile_matrix_preset}:`, presetErr);
                  }
                }
              }
            }
          }
        } catch (indexErr) {
          console.warn(`[cleanup] Failed to read index.json for preset cleanup:`, indexErr);
        }
      }
      fs.rmSync(projectCacheDir, { recursive: true, force: true });
      cacheRemoved = true;
    } catch (err) {
      return res.status(500).json({ error: "cache_delete_failed", details: String(err) });
    }
  }

  try {
    removeProjectAccessEntry(proj.id);
  } catch (err) {
    console.error("Failed to remove project access entry", proj.id, err);
    return res.status(500).json({ error: "project_access_cleanup_failed", details: String(err?.message || err) });
  }

  try {
    purgeProjectFromAuthUsers(proj.id);
  } catch (err) {
    console.error("Failed to purge project assignment", proj.id, err);
    return res.status(500).json({ error: "project_auth_cleanup_failed", details: String(err?.message || err) });
  }

  try {
    removeProjectLogs(proj.id);
  } catch (err) {
    console.error("Failed to remove project logs", proj.id, err);
    return res.status(500).json({ error: "project_log_cleanup_failed", details: String(err?.message || err) });
  }

  return res.json({ status: "deleted", id: proj.id, cacheRemoved });
});

// capas por proyecto
app.get("/projects/:id/layers", ensureProjectAccess(req => req.params.id), (req, res) => {
  const proj = findProjectById(req.params.id);
  if (!proj) return res.status(404).json({ error: "project_not_found" });
  const script = path.join(pythonDir, "extract_info.py");
  const proc = runPythonViaOSGeo4W(script, ["--project", proj.file]);

  let stdout = "", stderr = "";
  proc.stdout.on("data", d => { const s = d.toString(); stdout += s; console.log("[py stdout]", s.trim()); });
  proc.stderr.on("data", d => { const s = d.toString(); stderr += s; console.error("[py stderr]", s.trim()); });
  proc.on("error", err => { console.error("Failed to spawn python:", err); res.status(500).json({ error: "spawn_error", details: String(err) }); });
  proc.on("close", code => {
    let raw = (stdout && stdout.trim()) || (stderr && stderr.trim()) || "";
    if (raw) {
      const candidate = extractJsonLike(raw);
      if (candidate) {
        try { const parsed = JSON.parse(candidate); return res.status(code === 0 ? 200 : 500).json(parsed); }
        catch (e) { return res.status(code === 0 ? 200 : 500).json({ raw, code }); }
      } else return res.status(code === 0 ? 200 : 500).json({ raw, code });
    }
    return res.status(code === 0 ? 200 : 500).json({ code, details: stderr || "no output" });
  });
});

app.get("/projects/:id/config", ensureProjectAccess(req => req.params.id), (req, res) => {
  const projectId = req.params.id;
  const proj = findProjectById(projectId);
  if (!proj) return res.status(404).json({ error: "project_not_found" });
  const config = readProjectConfig(projectId);
  return res.json(config);
});

app.patch("/projects/:id/config", requireAdmin, (req, res) => {
  const projectId = req.params.id;
  const proj = findProjectById(projectId);
  if (!proj) return res.status(404).json({ error: "project_not_found" });
  const patch = buildProjectConfigPatch(req.body || {});
  try {
    const updated = updateProjectConfig(projectId, patch);
    return res.json(updated);
  } catch (err) {
    console.error("Failed to update project config", projectId, err);
    return res.status(500).json({ error: "config_update_failed", details: String(err?.message || err) });
  }
});

app.get("/projects/:id/cache/project", ensureProjectAccess(req => req.params.id), (req, res) => {
  const projectId = req.params.id;
  const proj = findProjectById(projectId);
  if (!proj) return res.status(404).json({ error: "project_not_found" });
  const current = projectBatchRuns.get(projectId) || null;
  const config = readProjectConfig(projectId);
  const last = config.projectCache || null;
  return res.json({ current, last });
});

app.post("/projects/:id/cache/project", requireAdmin, (req, res) => {
  const projectId = req.params.id;
  const proj = findProjectById(projectId);
  if (!proj) return res.status(404).json({ error: "project_not_found" });
  const existing = projectBatchRuns.get(projectId);
  if (existing && (existing.status === "running" || existing.status === "queued")) {
    return res.status(409).json({ error: "batch_running", runId: existing.id, message: "Project cache already in progress" });
  }
  const body = req.body || {};
  const layersInput = Array.isArray(body.layers) ? body.layers : [];
  const overrideLayers = [];
  for (const entry of layersInput) {
    if (!entry || typeof entry !== "object") continue;
    const layerName = typeof entry.layer === "string" ? entry.layer : typeof entry.name === "string" ? entry.name : null;
    if (!layerName) continue;
    const paramsSource = entry.params && typeof entry.params === "object" ? entry.params : entry.body && typeof entry.body === "object" ? entry.body : null;
    if (!paramsSource) continue;
    const params = { ...paramsSource, layer: layerName, project: projectId };
    overrideLayers.push({ layer: layerName, params });
  }
  if (!overrideLayers.length) {
    return res.status(400).json({ error: "no_layers", message: "No layers provided for project cache" });
  }
  const runId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const layerNames = overrideLayers.map((l) => l.layer);
  const runTrigger = body.reason === "scheduled" ? "timer" : "manual";
  updateProjectBatchRun(projectId, {
    id: runId,
    project: projectId,
    status: "queued",
    reason: body.reason || "manual-project",
    trigger: runTrigger,
    createdAt: Date.now(),
    layers: layerNames
  });
  res.json({ status: "queued", runId, project: projectId, layers: layerNames.length });
  setImmediate(async () => {
    try {
      updateProjectBatchRun(projectId, { status: "running", startedAt: Date.now(), trigger: runTrigger });
      await runRecacheForProject(projectId, "manual-project", { overrideLayers, runId, requireEnabled: false });
      updateProjectBatchRun(projectId, { status: "completed", endedAt: Date.now(), result: "success", trigger: runTrigger });
      logProjectEvent(projectId, `Project cache run ${runId} completed (${layerNames.length} layers).`);
    } catch (err) {
      const message = err?.message || String(err);
      updateProjectBatchRun(projectId, { status: "error", endedAt: Date.now(), error: message, result: "error", trigger: runTrigger });
      logProjectEvent(projectId, `Project cache run ${runId} failed: ${message}`, "error");
    }
  });
});

// /layers -> ejecutar script extract_info.py usando o4w_env.bat
app.get("/layers", requireAdmin, (req, res) => {
  const script = path.join(pythonDir, "extract_info.py");
  console.log("GET /layers -> launching python:", pythonExe, script);
  const proc = runPythonViaOSGeo4W(script, []);

  let stdout = "", stderr = "";
  proc.stdout.on("data", d => {
    const s = d.toString();
    stdout += s;
    console.log("[py stdout]", s.trim());
  });
  proc.stderr.on("data", d => {
    const s = d.toString();
    stderr += s;
    console.error("[py stderr]", s.trim());
  });
  proc.on("error", err => {
    console.error("Failed to spawn python:", err);
    res.status(500).json({ error: "spawn_error", details: String(err) });
  });

  proc.on("close", code => {
    console.log(`python process exited ${code}`);
    // primar stdout, fallback stderr
    let raw = (stdout && stdout.trim()) || (stderr && stderr.trim()) || "";
    // intentar extraer JSON si hay ruido
    if (raw) {
      const candidate = extractJsonLike(raw);
      if (candidate) {
        try {
          const parsed = JSON.parse(candidate);
          return res.status(code === 0 ? 200 : 500).json(parsed);
        } catch (e) {
          // sigue sin parsear: devolver raw para depuración
          return res.status(code === 0 ? 200 : 500).json({ raw, code });
        }
      } else {
        return res.status(code === 0 ? 200 : 500).json({ raw, code });
      }
    }
    // nada producido
    return res.status(code === 0 ? 200 : 500).json({ code, details: stderr || "no output" });
  });
});

// mapa de jobs en ejecución
const runningJobs = new Map();
// control sencillo de concurrencia y duplicados
const activeKeys = new Set(); // key = `${project||''}:${layer}`
const JOB_MAX = parseInt(process.env.JOB_MAX || "4", 10); // máximo de procesos concurrentes

// generate-cache -> spawn para proceso largo (pasar args)
app.post("/generate-cache", requireAdmin, (req, res) => {
  const {
    project: projectId,
    layer,
    theme,
    zoom_min: zoomMinRaw = 0,
    zoom_max: zoomMaxRaw = 0,
    scheme = "auto",
    xyz_mode = "partial",
    tile_crs = null,
    wmts = false,
    project_extent = null,
    extent_crs = null,
    allow_remote = false,
    throttle_ms = 0,
    render_timeout_ms = null,
    tile_retries = null,
    png_compression = null,
    recache: recacheRaw = null,
    tile_matrix_preset: tileMatrixPresetSnake = null,
    tileMatrixPreset: tileMatrixPresetCamel = null
  } = req.body;
  if (!layer && !theme) return res.status(400).json({ error: "target_required", details: "Debe indicar layer o theme" });
  if (layer && theme) return res.status(400).json({ error: "too_many_targets", details: "Solo se permite layer o theme" });

  const targetMode = theme ? "theme" : "layer";
  const targetName = (theme || layer || "").toString().trim();
  if (!targetName) {
    return res.status(400).json({ error: "invalid_target_name" });
  }

  const zoomMin = Number.isFinite(Number(zoomMinRaw)) ? Number(zoomMinRaw) : 0;
  const zoomMax = Number.isFinite(Number(zoomMaxRaw)) ? Number(zoomMaxRaw) : 0;

  let projectPath = process.env.PROJECT_PATH || null;
  let projectKey = null;
  if (projectId) {
    const proj = findProjectById(projectId);
    if (!proj) return res.status(404).json({ error: "project_not_found" });
    projectPath = proj.file;
    projectKey = proj.id;
  }

  const script = path.join(pythonDir, "generate_cache.py");
  const outBase = projectKey ? path.join(cacheDir, projectKey) : cacheDir;
  fs.mkdirSync(outBase, { recursive: true });
  const projectIndex = path.join(outBase, "index.json");

  let existingEntry = null;
  if (projectKey) {
    try {
      const indexData = loadProjectIndexData(projectKey);
      const layers = Array.isArray(indexData.layers) ? indexData.layers : [];
      existingEntry = layers.find((entry) => entry && entry.name === targetName && (entry.kind || "layer") === targetMode) || null;
    } catch (err) {
      existingEntry = null;
    }
  }

  const recachePlan = computeRecachePlan({ existingEntry, zoomMin, zoomMax, requestBody: req.body });
  const normalizePresetName = (value) => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    return trimmed || "";
  };
  const requestedTileMatrixPreset = normalizePresetName(tileMatrixPresetSnake)
    || normalizePresetName(tileMatrixPresetCamel)
    || normalizePresetName(req.body && req.body.tileMatrixPresetId);
  const existingPreset = existingEntry ? normalizePresetName(existingEntry.tile_matrix_preset || existingEntry.tileMatrixPreset) : "";
  let effectiveTileMatrixPreset = requestedTileMatrixPreset || existingPreset || "";

  if (!effectiveTileMatrixPreset) {
    const tileCrsCandidates = [
      tile_crs,
      req.body?.project_crs,
      req.body?.cache_crs,
      existingEntry?.tile_crs,
      existingEntry?.crs
    ].map((candidate) => (typeof candidate === "string" ? candidate.trim() : ""))
      .filter(Boolean);
    const matchCrs = tileCrsCandidates.length ? tileCrsCandidates[0] : null;
    const presetMatch = matchCrs ? findTileMatrixPresetForCrs(matchCrs) : null;
    if (presetMatch) {
      const presetNameForCli = presetMatch.fileName || presetMatch.id || "";
      effectiveTileMatrixPreset = presetNameForCli;
      console.log(`[cache] Auto-selected tile matrix preset ${presetNameForCli} for CRS ${matchCrs}`);
    }
  }

  const requestedPublishZoomMin = normalizeZoomInput(req.body?.publish_zoom_min);
  const requestedPublishZoomMax = normalizeZoomInput(req.body?.publish_zoom_max);
  const existingPublishMin = normalizeZoomInput(existingEntry?.published_zoom_min ?? existingEntry?.zoom_min ?? existingEntry?.cached_zoom_min);
  const existingPublishMax = normalizeZoomInput(existingEntry?.published_zoom_max ?? existingEntry?.zoom_max ?? existingEntry?.cached_zoom_max);

  let publishZoomMin = requestedPublishZoomMin != null
    ? requestedPublishZoomMin
    : (existingPublishMin != null ? existingPublishMin : DEFAULT_PUBLISH_ZOOM_MIN);
  let publishZoomMax = requestedPublishZoomMax != null
    ? requestedPublishZoomMax
    : (existingPublishMax != null ? existingPublishMax : DEFAULT_PUBLISH_ZOOM_MAX);

  if (publishZoomMin == null) publishZoomMin = DEFAULT_PUBLISH_ZOOM_MIN;
  if (publishZoomMax == null) publishZoomMax = Math.max(DEFAULT_PUBLISH_ZOOM_MAX, zoomMax);
  publishZoomMin = Math.min(publishZoomMin, zoomMin);
  publishZoomMax = Math.max(publishZoomMax, zoomMax, publishZoomMin);

  let explicitTileBaseDir = null;
  if (projectKey) {
    if (existingEntry && typeof existingEntry.path === "string" && existingEntry.path) {
      explicitTileBaseDir = existingEntry.path;
    } else {
      explicitTileBaseDir = resolveTileBaseDir(projectKey, targetMode, targetName, existingEntry && existingEntry.storage_name);
    }
    if (explicitTileBaseDir) {
      explicitTileBaseDir = path.resolve(explicitTileBaseDir);
      fs.mkdirSync(explicitTileBaseDir, { recursive: true });
    }
  }

  const args = [];
  if (targetMode === "layer") {
    args.push("--layer", layer);
  } else {
    args.push("--theme", theme);
  }
  args.push(
    "--zoom_min", String(zoomMin),
    "--zoom_max", String(zoomMax),
    "--publish_zoom_min", String(publishZoomMin),
    "--publish_zoom_max", String(publishZoomMax),
    "--output_dir", outBase,
    "--index_path", projectIndex,
    "--scheme", scheme,
    "--xyz_mode", xyz_mode
  );
  if (tile_crs) {
    args.push("--tile_crs", tile_crs);
  }
  let useWmts = Boolean(wmts);
  if (effectiveTileMatrixPreset) {
    args.push("--tile_matrix_preset", effectiveTileMatrixPreset);
    useWmts = true;
  }
  if (useWmts) {
    args.push("--wmts");
  }
  if (allow_remote) {
    args.push("--allow_remote");
  }
  if (recachePlan.skipExisting) {
    args.push("--skip_existing");
  }
  if (throttle_ms && Number.isFinite(Number(throttle_ms)) && Number(throttle_ms) > 0) {
    args.push("--throttle_ms", String(Math.floor(Number(throttle_ms))));
  }
  if (render_timeout_ms && Number.isFinite(Number(render_timeout_ms)) && Number(render_timeout_ms) > 0) {
    args.push("--render_timeout_ms", String(Math.floor(Number(render_timeout_ms))));
  }
  if (tile_retries != null && Number.isFinite(Number(tile_retries)) && Number(tile_retries) >= 0) {
    args.push("--tile_retries", String(Math.floor(Number(tile_retries))));
  }
  if (png_compression != null && Number.isFinite(Number(png_compression)) && Number(png_compression) >= 0) {
    args.push("--png_compression", String(Math.max(0, Math.min(9, Math.floor(Number(png_compression))))));
  }
  if (project_extent && typeof project_extent === "string") {
    const parts = project_extent.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 4 && parts.every((p) => /^-?\d+(\.\d+)?$/.test(p))) {
      args.push("--project_extent4", parts[0], parts[1], parts[2], parts[3]);
      if (extent_crs) args.push("--extent_crs", extent_crs);
    } else {
      console.warn("Ignoring invalid project_extent", project_extent);
    }
  }
  if (projectPath) args.push("--project", projectPath);
  if (process.env.PROJECT_EXTENT) {
    const partsEnv = String(process.env.PROJECT_EXTENT).split(",").map((s) => s.trim()).filter(Boolean);
    if (partsEnv.length === 4 && partsEnv.every((p) => /^-?\d+(\.\d+)?$/.test(p))) {
      args.push("--project_extent4", partsEnv[0], partsEnv[1], partsEnv[2], partsEnv[3]);
    } else {
      console.warn("Ignoring invalid PROJECT_EXTENT env value", process.env.PROJECT_EXTENT);
    }
  }

  const runningCount = Array.from(runningJobs.values()).filter((j) => j.status === "running").length;
  if (!isNaN(JOB_MAX) && JOB_MAX > 0 && runningCount >= JOB_MAX) {
    return res.status(429).json({ error: "server_busy", details: `Máximo de jobs concurrentes (${JOB_MAX}) alcanzado` });
  }

  const key = `${projectKey || ""}:${targetMode}:${targetName}`;
  if (activeKeys.has(key)) {
    return res.status(409).json({ error: "job_already_running", project: projectKey, target: targetName, targetMode });
  }
  activeKeys.add(key);

  const jobLabel = targetMode === "theme" ? `theme:${targetName}` : targetName;
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const proc = runPythonViaOSGeo4W(script, args, {});
  console.log("Launching python generate_cache.py with args:", args);

  const runReason = typeof req.body.run_reason === "string" && req.body.run_reason.trim() ? req.body.run_reason.trim() : null;
  const trigger = typeof req.body.trigger === "string" && req.body.trigger.trim() ? req.body.trigger.trim() : (runReason === "scheduled" ? "timer" : null);
  const batchIndexVal = Number(req.body.batch_index);
  const batchTotalVal = Number(req.body.batch_total);
  const job = {
    id,
    proc,
    layer: jobLabel,
    targetName,
    targetMode,
    project: projectKey,
    key,
    startedAt: Date.now(),
    stdout: "",
    stderr: "",
    stdoutJsonBuffer: "",
    status: "running",
    exitCode: null,
    endedAt: null,
    cleanupTimer: null,
    recachePlan,
    tileBaseDir: explicitTileBaseDir,
    existingIndexEntry: existingEntry,
    zoomMin,
    zoomMax,
    requestedScheme: scheme,
    requestedTileCrs: tile_crs,
    xyzMode: xyz_mode,
    metadata: null,
    tileMatrixPreset: effectiveTileMatrixPreset || null,
    publishZoomMin,
    publishZoomMax,
    lastProgressWriteAt: 0,
    lastIndexWriteAt: 0,
    lastProgress: null,
    runReason,
    trigger,
    runId: typeof req.body.run_id === "string" && req.body.run_id.trim() ? req.body.run_id.trim() : null,
    batchIndex: Number.isFinite(batchIndexVal) ? batchIndexVal : null,
    batchTotal: Number.isFinite(batchTotalVal) ? batchTotalVal : null
  };
  runningJobs.set(id, job);

  proc.stdout.on("data", d => {
    const s = d.toString();
    job.stdout += s;
    job.stdoutJsonBuffer = (job.stdoutJsonBuffer || "") + s;
    console.log(`[job ${id} stdout]`, s.trim());
    const lines = job.stdoutJsonBuffer.split(/\r?\n/);
    job.stdoutJsonBuffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const payload = JSON.parse(trimmed);
        handleJobJsonEvent(job, payload);
      } catch (err) {
        // ignore parse errors but keep buffer for debugging
      }
    }
  });
  proc.stderr.on("data", d => {
    const s = d.toString();
    job.stderr += s;
    console.error(`[job ${id} stderr]`, s.trim());
  });

  proc.on("error", err => {
    console.error(`[job ${id} spawn error]`, err);
  });

  proc.on("close", code => {
    console.log(`python job ${id} exited ${code}`);
    job.exitCode = code;
    job.status = code === 0 ? "completed" : "error";
    job.endedAt = Date.now();
    const finalProgressPayload = {
      status: job.status,
      total_generated: job.lastProgress?.totalGenerated ?? null,
      expected_total: job.lastProgress?.expectedTotal ?? null,
      percent: job.lastProgress?.percent ?? (job.status === "completed" ? 100 : null)
    };
    persistJobProgress(job, finalProgressPayload, { forceIndex: true, forceConfig: true });
    if (projectKey) {
      try {
        const lastMessage = job.status === "completed" ? "Cache generation completed" : (job.stderr ? job.stderr.trim().split(/\r?\n/).slice(-5).join(" | ") : "Cache generation failed");
        const update = targetMode === "theme"
          ? { themes: { [targetName]: { lastResult: job.status, lastMessage, lastRunAt: new Date(job.endedAt).toISOString() } } }
          : { layers: { [layer]: { lastResult: job.status, lastMessage, lastRunAt: new Date(job.endedAt).toISOString() } } };
        updateProjectConfig(projectKey, update);
      } catch (cfgErr) {
        console.warn("Failed to update project config with job result", cfgErr);
      }
    }
    // liberar clave activa
    try { activeKeys.delete(key); } catch { }
    // limpiar mapa después de un TTL para permitir polling de UI
    const ttlMs = parseInt(process.env.JOB_TTL_MS || "300000", 10); // 5 min por defecto
    job.cleanupTimer = setTimeout(() => {
      runningJobs.delete(id);
    }, isNaN(ttlMs) ? 300000 : ttlMs);
  });

  if (projectKey) {
    try {
      const nowIso = new Date().toISOString();
      const targetPatch = {
        lastParams: {
          ...req.body,
          project: projectKey,
          ...(targetMode === "theme" ? { theme: targetName } : { layer })
        },
        lastRequestedAt: nowIso
      };
      if (job.id) targetPatch.lastJobId = job.id;
      const patch = {
        zoom: { min: Number.isFinite(zoomMin) ? zoomMin : null, max: Number.isFinite(zoomMax) ? zoomMax : null, updatedAt: nowIso },
        cachePreferences: {
          mode: req.body.scheme || "auto",
          tileCrs: req.body.tile_crs || null,
          allowRemote: !!req.body.allow_remote,
          throttleMs: Number(req.body.throttle_ms) || 0,
          updatedAt: nowIso
        }
      };
      if (targetMode === "theme") {
        patch.themes = { [targetName]: targetPatch };
      } else {
        patch.layers = { [layer]: targetPatch };
      }
      if (typeof req.body.project_extent === "string") {
        const parts = req.body.project_extent.split(",").map((s) => Number(s.trim())).filter((v) => Number.isFinite(v));
        if (parts.length === 4) {
          patch.extent = { bbox: parts, crs: req.body.extent_crs || "EPSG:4326", updatedAt: nowIso };
        }
      }
      updateProjectConfig(projectKey, patch, { skipReschedule: false });
    } catch (err) {
      console.warn("Failed to persist project config after job", err);
    }
  }

  res.json({ status: "started", id, target: targetName, targetMode });
});

// Abort / stop job
app.delete("/generate-cache/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "id required" });
  const job = runningJobs.get(id);
  if (!job) return res.status(404).json({ error: "job not found or already finished" });

  try {
    // 1) intento suave
    const killed = job.proc.kill();
    console.log(`Job ${id} kill() called -> ${killed}`);
    job.status = "aborted";
    job.endedAt = Date.now();
    persistJobProgress(job, { status: "aborted" }, { forceIndex: true, forceConfig: true });
    // liberar clave activa
    try {
      const activeKey = job.key || `${job.project || ''}:${job.targetMode || 'layer'}:${job.targetName || job.layer}`;
      activeKeys.delete(activeKey);
    } catch { }
    // 2) escalado forzado en Windows si persiste: taskkill /T /F /PID <pid>
    const graceMs = parseInt(process.env.ABORT_GRACE_MS || "1000", 10);
    setTimeout(() => {
      try {
        if (job.proc && job.proc.pid) {
          // si el proceso sigue vivo, intentar taskkill
          const tk = spawn('taskkill', ['/PID', String(job.proc.pid), '/T', '/F'], { shell: true });
          tk.on('close', (code) => {
            console.log(`taskkill for job ${id} exited with code ${code}`);
          });
        }
      } catch (e) {
        console.warn(`taskkill escalation failed for job ${id}`, e);
      }
    }, isNaN(graceMs) ? 1000 : graceMs);
    // programar cleanup para dejar que la UI lea los logs finales
    const ttlMs = parseInt(process.env.JOB_TTL_MS || "300000", 10);
    clearTimeout(job.cleanupTimer);
    job.cleanupTimer = setTimeout(() => {
      runningJobs.delete(id);
    }, isNaN(ttlMs) ? 300000 : ttlMs);
    return res.json({ status: "aborted", id });
  } catch (err) {
    console.error(`Failed to kill job ${id}`, err);
    return res.status(500).json({ error: String(err) });
  }
});

// opcional: endpoint para listar jobs activos
app.get("/generate-cache/running", requireAdmin, (req, res) => {
  const list = Array.from(runningJobs.values())
    .filter(j => (j.status || "running") === "running")
    .map(j => ({
      id: j.id,
      layer: j.layer,
      project: j.project,
      startedAt: j.startedAt,
      trigger: j.trigger || null,
      runId: j.runId || null,
      batchIndex: Number.isFinite(j.batchIndex) ? j.batchIndex : null,
      batchTotal: Number.isFinite(j.batchTotal) ? j.batchTotal : null,
      targetMode: j.targetMode || null,
      targetName: j.targetName || null
    }));
  res.json(list);
});

// Obtener detalles de un job (estado y logs)
app.get("/generate-cache/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  const job = runningJobs.get(id);
  if (!job) return res.status(404).json({ error: "job not found" });
  const tail = parseInt(req.query.tail || "0", 10);
  const clip = (s) => {
    if (!s) return "";
    if (!tail || isNaN(tail) || tail <= 0) {
      // por defecto limitar a 50k para no saturar
      const MAX = 50000;
      return s.length > MAX ? s.slice(-MAX) : s;
    }
    return s.length > tail ? s.slice(-tail) : s;
  };
  return res.json({
    id: job.id,
    layer: job.layer,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    status: job.status || (job.proc.exitCode == null ? "running" : (job.proc.exitCode === 0 ? "completed" : "error")),
    exitCode: job.exitCode ?? job.proc.exitCode ?? null,
    stdout: clip(job.stdout),
    stderr: clip(job.stderr)
  });
});

// --- WMTS helpers -------------------------------------------------------

const DEFAULT_WMTS_STYLE = "default";

const normalizeIdentifier = (value, fallback = "id") => {
  const base = (value == null ? "" : String(value)).normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const cleaned = base.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!cleaned) return fallback;
  const startsWithLetter = /^[A-Za-z]/.test(cleaned);
  return startsWithLetter ? cleaned : `${fallback}_${cleaned}`;
};

const ensureUniqueIdentifier = (candidate, used, fallbackPrefix = "id") => {
  let finalId = candidate && !used.has(candidate) ? candidate : null;
  if (!finalId) {
    let index = 1;
    const prefix = candidate || fallbackPrefix;
    while (!finalId || used.has(finalId)) {
      finalId = `${prefix}_${index}`;
      index += 1;
    }
  }
  used.add(finalId);
  return finalId;
};

const toCrsUrn = (crs) => {
  const trimmed = String(crs || "").trim();
  if (!trimmed) return "urn:ogc:def:crs:EPSG::3857";
  if (/^urn:ogc:def:crs:/i.test(trimmed)) return trimmed;
  const normalized = trimmed.toUpperCase().replace(/\s+/g, "");
  if (normalized.startsWith("EPSG:")) {
    const code = normalized.split(":")[1];
    return `urn:ogc:def:crs:EPSG::${code}`;
  }
  return `urn:ogc:def:crs:${normalized.replace(":", "::")}`;
};

const convertCoordsToXY = (coords, axisOrder = "xy") => {
  const axis = typeof axisOrder === "string" ? axisOrder.toLowerCase() : "xy";
  if (!Array.isArray(coords) || coords.length < 2) return [0, 0];
  const first = Number(coords[0]) || 0;
  const second = Number(coords[1]) || 0;
  return axis === "yx" ? [second, first] : [first, second];
};

const normalizeTileMatrixSet = (rawSet, context, usedIds) => {
  const tileWidth = Number(rawSet?.tile_width) || TILE_SIZE_PX;
  const tileHeight = Number(rawSet?.tile_height) || TILE_SIZE_PX;
  const axisOrder = typeof rawSet?.axis_order === "string" ? rawSet.axis_order.toLowerCase() : "xy";
  const topLeft = convertCoordsToXY(rawSet?.top_left_corner || rawSet?.top_left || rawSet?.topLeftCorner, axisOrder);
  const supportedCrs = rawSet?.supported_crs || context?.tileCrs || "EPSG:3857";
  const rawId = rawSet?.id || `${context?.project || "proj"}_${context?.layer || "layer"}`;
  const initialId = normalizeIdentifier(rawId, "set");
  const id = ensureUniqueIdentifier(initialId, usedIds, "set");

  const rawMatrices = Array.isArray(rawSet?.matrices) ? rawSet.matrices : (Array.isArray(rawSet?.matrixSet) ? rawSet.matrixSet : []);
  const matrices = rawMatrices.slice();
  matrices.sort((a, b) => Number(a?.z ?? 0) - Number(b?.z ?? 0));
  const usedMatrixIdentifiers = new Set();
  const normalizedMatrices = matrices.map((entry, idx) => {
    const sourceLevel = Number.isFinite(Number(entry?.z)) ? Number(entry.z) : idx;
    const numericIdentifier = Number(entry?.identifier);
    const fallbackIdentifier = Number.isFinite(numericIdentifier) ? numericIdentifier : sourceLevel;
    let identifierValue = Number.isFinite(numericIdentifier) ? numericIdentifier : fallbackIdentifier;
    if (!Number.isFinite(identifierValue)) identifierValue = sourceLevel;
    let identifier = String(identifierValue);
    if (!identifier) identifier = String(sourceLevel);
    if (usedMatrixIdentifiers.has(identifier)) {
      let dedupe = 1;
      while (usedMatrixIdentifiers.has(`${identifier}_${dedupe}`)) {
        dedupe += 1;
      }
      identifier = `${identifier}_${dedupe}`;
    }
    usedMatrixIdentifiers.add(identifier);
    const scaleDen = Number(entry?.scale_denominator) || (Number(entry?.resolution) ? Number(entry.resolution) / 0.00028 : 0);
    const matrixWidth = Math.max(1, Number(entry?.matrix_width) || 1);
    const matrixHeight = Math.max(1, Number(entry?.matrix_height) || 1);
    const entryTopLeft = convertCoordsToXY(entry?.top_left || entry?.top_left_corner || entry?.topLeftCorner, entry?.axis_order || axisOrder) || topLeft;
    return {
      identifier,
      scaleDenominator: scaleDen,
      matrixWidth,
      matrixHeight,
      topLeftCorner: entryTopLeft,
      tileWidth,
      tileHeight,
      sourceLevel
    };
  });

  return {
    id,
    supportedCrs,
    tileWidth,
    tileHeight,
    axisOrder,
    topLeftCorner: topLeft,
    matrices: normalizedMatrices
  };
};

const buildGlobalMercatorMatrixSet = (maxZoom) => {
  const matrices = [];
  for (let z = 0; z <= maxZoom; z += 1) {
    const scaleDenominator = 559082264.0287178 / Math.pow(2, z);
    const matrixWidth = Math.pow(2, z);
    const matrixHeight = Math.pow(2, z);
    matrices.push({
      identifier: String(z),
      scaleDenominator,
      matrixWidth,
      matrixHeight,
      topLeftCorner: [-WEB_MERCATOR_EXTENT, WEB_MERCATOR_EXTENT],
      tileWidth: TILE_SIZE_PX,
      tileHeight: TILE_SIZE_PX,
      sourceLevel: z
    });
  }
  return {
    id: "EPSG_3857",
    supportedCrs: "EPSG:3857",
    tileWidth: TILE_SIZE_PX,
    tileHeight: TILE_SIZE_PX,
    topLeftCorner: [-WEB_MERCATOR_EXTENT, WEB_MERCATOR_EXTENT],
    matrices
  };
};

const clampMercator = (value) => {
  const v = Number(value) || 0;
  return Math.max(-WEB_MERCATOR_EXTENT, Math.min(WEB_MERCATOR_EXTENT, v));
};

const computeWebMercatorLimits = (extent, zoomMin, zoomMax) => {
  if (!Array.isArray(extent) || extent.length !== 4) return [];
  const [minXRaw, minYRaw, maxXRaw, maxYRaw] = extent;
  const minLimits = [];
  const originShift = WEB_MERCATOR_EXTENT;
  const initialResolution = (2 * Math.PI * 6378137) / TILE_SIZE_PX;
  const minZoom = Number.isFinite(zoomMin) ? zoomMin : 0;
  const maxZoom = Number.isFinite(zoomMax) ? zoomMax : minZoom;
  for (let z = minZoom; z <= maxZoom; z += 1) {
    const resolution = initialResolution / Math.pow(2, z);
    const matrixSize = Math.pow(2, z);
    const minX = clampMercator(minXRaw);
    const maxX = clampMercator(maxXRaw);
    const minY = clampMercator(minYRaw);
    const maxY = clampMercator(maxYRaw);
    const minTileCol = Math.max(0, Math.floor((minX + originShift) / (TILE_SIZE_PX * resolution)));
    const maxTileCol = Math.min(matrixSize - 1, Math.floor((maxX + originShift) / (TILE_SIZE_PX * resolution)));
    const minTileRow = Math.max(0, Math.floor((originShift - maxY) / (TILE_SIZE_PX * resolution)));
    const maxTileRow = Math.min(matrixSize - 1, Math.floor((originShift - minY) / (TILE_SIZE_PX * resolution)));
    if (minTileCol <= maxTileCol && minTileRow <= maxTileRow) {
      minLimits.push({
        tileMatrix: String(z),
        minTileCol,
        maxTileCol,
        minTileRow,
        maxTileRow
      });
    }
  }
  return minLimits;
};

const computeRegularLimits = (normalizedSet) => {
  if (!normalizedSet || !Array.isArray(normalizedSet.matrices)) return [];
  return normalizedSet.matrices.map((matrix) => ({
    tileMatrix: matrix.identifier,
    minTileCol: 0,
    maxTileCol: Math.max(0, matrix.matrixWidth - 1),
    minTileRow: 0,
    maxTileRow: Math.max(0, matrix.matrixHeight - 1)
  }));
};

const mercatorToLonLat = (x, y) => {
  const R = WEB_MERCATOR_EXTENT;
  const lon = (x / R) * 180;
  let lat = (y / R) * 180;
  lat = (180 / Math.PI) * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
  return [lon, lat];
};

const deriveWgs84Extent = (layer) => {
  if (Array.isArray(layer.extentWgs) && layer.extentWgs.length === 4) {
    return layer.extentWgs;
  }
  if (Array.isArray(layer.extent) && layer.extent.length === 4 && layer.tileCrs === "EPSG:3857") {
    const [minX, minY, maxX, maxY] = layer.extent;
    const lower = mercatorToLonLat(minX, minY);
    const upper = mercatorToLonLat(maxX, maxY);
    return [lower[0], lower[1], upper[0], upper[1]];
  }
  return null;
};

const sanitizeExtent = (extent) => {
  if (!Array.isArray(extent) || extent.length !== 4) return null;
  return extent.map((value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  });
};

const buildLayerTitle = (projectId, layerName, kind) => {
  if (!projectId && !layerName) return "Layer";
  if (kind === "theme") {
    return `${projectId || "project"} (theme ${layerName || "theme"})`;
  }
  return `${projectId || "project"}:${layerName || "layer"}`;
};

const buildWmtsInventory = (options = {}) => {
  const filterProject = options.filterProjectId ? String(options.filterProjectId).toLowerCase() : "";
  const projects = fs.existsSync(cacheDir)
    ? fs.readdirSync(cacheDir).filter((dir) => fs.statSync(path.join(cacheDir, dir)).isDirectory())
    : [];
  const usedLayerIdentifiers = new Set();
  const usedSetIdentifiers = new Set(["EPSG_3857"]);
  const usedProjectKeys = new Set();
  const layerKeysByProject = new Map();
  const layers = [];
  const layerRouting = new Map();
  const presetNormalizedSetCache = new Map();
  let maxWebMercatorZoom = 0;

  const loadIndex = (projectId) => {
    const idxPath = path.join(cacheDir, projectId, "index.json");
    if (!fs.existsSync(idxPath)) return null;
    try {
      const raw = fs.readFileSync(idxPath, "utf8");
      return JSON.parse(raw);
    } catch (err) {
      console.warn("Failed to parse index.json for", projectId, err);
      return null;
    }
  };

  for (const project of projects) {
    if (filterProject && project.toLowerCase() !== filterProject) continue;
    const index = loadIndex(project);
    if (!index || !Array.isArray(index.layers)) continue;
    const projectKeyBase = normalizeIdentifier(project, "project");
    let projectKey = projectKeyBase || `project_${project}`;
    let projectSuffix = 1;
    while (usedProjectKeys.has(projectKey)) {
      projectKey = `${projectKeyBase}_${projectSuffix}`;
      projectSuffix += 1;
    }
    usedProjectKeys.add(projectKey);
    const layerKeySet = layerKeysByProject.get(projectKey) || new Set();

    for (const layerEntry of index.layers) {
      const scheme = typeof layerEntry.scheme === "string" ? layerEntry.scheme.toLowerCase() : null;
      const tileCrs = (layerEntry.tile_crs || layerEntry.crs || "EPSG:3857").toUpperCase();
      const kind = typeof layerEntry.kind === "string" ? layerEntry.kind.toLowerCase() : "layer";
      const isTheme = kind === "theme";
      const layerPresetIdRaw = typeof layerEntry.tile_matrix_preset === "string" ? layerEntry.tile_matrix_preset.trim() : "";
      let layerPresetId = layerPresetIdRaw || null;
      if (layerPresetId && layerPresetId.endsWith(".json")) {
        layerPresetId = layerPresetId.replace(/\.json$/i, "");
      }
      let rawTileMatrixSet = layerEntry.tile_matrix_set && (Array.isArray(layerEntry.tile_matrix_set.matrices) || Array.isArray(layerEntry.tile_matrix_set.matrixSet))
        ? layerEntry.tile_matrix_set
        : null;
      if (!rawTileMatrixSet && layerPresetId) {
        const presetDef = getTileMatrixPresetRaw(layerPresetId);
        if (presetDef && (Array.isArray(presetDef.matrices) || Array.isArray(presetDef.matrixSet))) {
          try {
            rawTileMatrixSet = JSON.parse(JSON.stringify(presetDef));
          } catch (err) {
            rawTileMatrixSet = presetDef;
          }
        }
      }
      const hasCustomSet = rawTileMatrixSet && (Array.isArray(rawTileMatrixSet.matrices) || Array.isArray(rawTileMatrixSet.matrixSet));
      const isWebMercator = scheme === "xyz" && tileCrs === "EPSG:3857";
      if (!hasCustomSet && !isWebMercator) continue;

      const layerName = layerEntry.name || layerEntry.layer || layerEntry.theme || "layer";
      const storageName = layerEntry.layer || layerEntry.theme || layerEntry.name || layerName;
      const extent = sanitizeExtent(layerEntry.extent);
      const extentWgs = sanitizeExtent(layerEntry.extent_wgs84);
      const zoomMin = Number.isFinite(Number(layerEntry.zoom_min)) ? Number(layerEntry.zoom_min) : 0;
      const zoomMax = Number.isFinite(Number(layerEntry.zoom_max)) ? Number(layerEntry.zoom_max) : zoomMin;

      const rawLayerKey = normalizeIdentifier(layerName, "layer");
      let layerKey = rawLayerKey;
      let suffix = 1;
      while (layerKeySet.has(layerKey)) {
        layerKey = `${rawLayerKey}_${suffix}`;
        suffix += 1;
      }
      layerKeySet.add(layerKey);
      layerKeysByProject.set(projectKey, layerKeySet);

      const layerIdentifierBase = normalizeIdentifier(`${project}_${layerName}`, "layer");
      const layerIdentifier = ensureUniqueIdentifier(layerIdentifierBase, usedLayerIdentifiers, "layer");
      const displayTitle = layerEntry.title || buildLayerTitle(project, layerName, kind);

      let tileMatrixSetId = "";
      let tileMatrixSet = null;
      let tileMatrixLimits = [];

      if (isWebMercator) {
        tileMatrixSetId = "EPSG_3857";
        tileMatrixLimits = computeWebMercatorLimits(extent || [
          -WEB_MERCATOR_EXTENT,
          -WEB_MERCATOR_EXTENT,
          WEB_MERCATOR_EXTENT,
          WEB_MERCATOR_EXTENT
        ], zoomMin, zoomMax);
        maxWebMercatorZoom = Math.max(maxWebMercatorZoom, zoomMax);
      } else if (hasCustomSet) {
        const presetKey = layerPresetId ? layerPresetId.toLowerCase() : null;
        let normalizedSet = null;
        if (presetKey && presetNormalizedSetCache.has(presetKey)) {
          normalizedSet = presetNormalizedSetCache.get(presetKey);
        } else {
          normalizedSet = normalizeTileMatrixSet(rawTileMatrixSet, {
            project,
            layer: layerName,
            tileCrs
          }, usedSetIdentifiers);
          if (presetKey) {
            presetNormalizedSetCache.set(presetKey, normalizedSet);
          }
        }
        tileMatrixSetId = normalizedSet.id;
        tileMatrixSet = normalizedSet;
        tileMatrixLimits = computeRegularLimits(normalizedSet);
      } else {
        continue;
      }

      const layerStyles = [
        {
          id: DEFAULT_WMTS_STYLE,
          title: "Default",
          isDefault: true
        }
      ];

      layers.push({
        identifier: layerIdentifier,
        projectId: project,
        projectKey,
        layerKey,
        targetName: storageName,
        isTheme,
        layerName,
        displayTitle,
        extent,
        extentWgs,
        zoomMin,
        zoomMax,
        styles: layerStyles,
        scheme,
        type: isWebMercator ? "xyz3857" : "wmts",
        tileMatrixSetId,
        tileMatrixSet,
        tileMatrixLimits,
        storage: {
          type: isTheme ? "theme" : "layer",
          name: storageName
        },
        kind,
        layerEntry,
        tileCrs,
        tileCrsUrn: toCrsUrn(tileCrs),
        tileMatrixPresetId: layerPresetId
      });
    }

  }

  const tileMatrixSetsMap = new Map();
  if (maxWebMercatorZoom < 0) {
    maxWebMercatorZoom = 0;
  }
  const globalMercatorSet = buildGlobalMercatorMatrixSet(maxWebMercatorZoom);
  tileMatrixSetsMap.set(globalMercatorSet.id, globalMercatorSet);

  for (const layer of layers) {
    if (layer.tileMatrixSetId === globalMercatorSet.id) {
      layer.tileMatrixSet = globalMercatorSet;
    } else if (layer.tileMatrixSet) {
      tileMatrixSetsMap.set(layer.tileMatrixSet.id, layer.tileMatrixSet);
    }
    const routingKey = `${layer.projectKey}/${layer.layerKey}`;
    layerRouting.set(routingKey, {
      project: layer.projectId,
      projectKey: layer.projectKey,
      layerKey: layer.layerKey,
      layerName: layer.storage.name,
      storage: layer.storage,
      tileMatrixSetId: layer.tileMatrixSetId,
      tileMatrixSet: layer.tileMatrixSet,
      type: layer.type,
      styles: layer.styles.map((s) => s.id),
      zoomMin: layer.zoomMin,
      zoomMax: layer.zoomMax,
      extent: layer.extent,
      tileCrs: layer.tileCrs
    });
  }

  return {
    layers,
    tileMatrixSets: Array.from(tileMatrixSetsMap.values()),
    layerRouting
  };
};

const resolveWmtsLayerRouting = (projectKey, layerKey) => {
  const inventory = buildWmtsInventory();
  const key = `${projectKey}/${layerKey}`;
  return {
    routing: inventory.layerRouting.get(key) || null,
    inventory
  };
};

const resolveRestTileRequest = (req, res, next) => {
  try {
    const { projectKey, layerKey } = req.params;
    const { routing, inventory } = resolveWmtsLayerRouting(projectKey, layerKey);
    if (!routing) {
      return res.status(404).send("Layer not found");
    }
    req.wmtsLayer = routing;
    return next();
  } catch (err) {
    return next(err);
  }
};

app.get(
  "/wmts/rest/:projectKey/:layerKey/:styleId/:setId/:tileMatrix/:tileRow/:tileCol.:ext",
  resolveRestTileRequest,
  ensureProjectAccess((req) => req.wmtsLayer?.project || null),
  (req, res) => {
    const layer = req.wmtsLayer;
    if (!layer || !layer.tileMatrixSet) {
      return res.status(404).send("Layer not available");
    }

    const styleId = String(req.params.styleId || "").toLowerCase();
    const requestedSetId = String(req.params.setId || "");
    const tileMatrixId = String(req.params.tileMatrix || "");
    const tileCol = Number(req.params.tileCol);
    const tileRow = Number(req.params.tileRow);
    const extension = String(req.params.ext || "").toLowerCase();

    const allowedStyles = new Set(layer.styles.map((s) => String(s).toLowerCase()));
    if (!allowedStyles.has(styleId)) {
      return res.status(404).send("Style not found");
    }
    if (requestedSetId !== layer.tileMatrixSetId) {
      return res.status(404).send("TileMatrixSet not available");
    }
    if (!Number.isInteger(tileCol) || !Number.isInteger(tileRow) || tileCol < 0 || tileRow < 0) {
      return res.status(400).send("Invalid tile indices");
    }
    if (extension !== "png") {
      return res.status(404).send("Tile format not supported");
    }

    const matrixEntry = layer.tileMatrixSet.matrices.find((matrix) => matrix.identifier === tileMatrixId);
    if (!matrixEntry) {
      return res.status(404).send("TileMatrix not found");
    }

    const sourceLevel = Number.isFinite(Number(matrixEntry.sourceLevel)) ? Number(matrixEntry.sourceLevel) : Number(tileMatrixId);
    if (!Number.isInteger(sourceLevel) || sourceLevel < 0) {
      return res.status(404).send("Invalid TileMatrix level");
    }

    if (tileCol > Number(matrixEntry.matrixWidth) - 1 || tileRow > Number(matrixEntry.matrixHeight) - 1) {
      return res.status(404).send("Tile outside matrix bounds");
    }

    const baseDir = layer.storage?.type === "theme"
      ? path.join(cacheDir, layer.project, "_themes", layer.layerName)
      : path.join(cacheDir, layer.project, layer.layerName);
    const filePath = path.join(baseDir, String(sourceLevel), String(tileCol), `${tileRow}.png`);

    fs.access(filePath, fs.constants.F_OK, (err) => {
      if (err) {
        // Tile missing: enqueue on-demand render and respond 202 (Accepted)
        try {
          const renderParams = { project: layer.project, layer: layer.layerName, z: sourceLevel, x: tileCol, y: tileRow };
          queueTileRender(renderParams, filePath, (qerr, out) => {
            // callback after render finishes; we only log here
            if (qerr) {
              logProjectEvent(layer.project, `On-demand render failed for ${filePath}: ${String(qerr)}`);
            } else {
              logProjectEvent(layer.project, `On-demand render completed: ${out}`);
            }
          });
        } catch (queueErr) {
          console.warn('Failed to queue tile render', queueErr);
        }
        // Provide estimated retry time based on current queue length
        try {
          const queuePos = Math.max(0, renderQueue.length - 1); // position (0-based) assuming push already happened
          const queueLen = renderQueue.length;
          // heuristic: each batch of MAX_RENDER_PROCS adds ~2 seconds (conservative)
          const estSeconds = Math.min(60, 2 + Math.floor(queuePos / Math.max(1, MAX_RENDER_PROCS)) * 2);
          res.set('Retry-After', String(estSeconds));
          res.set('X-Tile-Status', 'generating');
          res.set('X-Queue-Position', String(queuePos));
          res.set('X-Queue-Length', String(queueLen));
          return res.status(202).json({ status: 'generating', retry_after: estSeconds, queue_position: queuePos, queue_length: queueLen, requested: { z: sourceLevel, x: tileCol, y: tileRow } });
        } catch (hdrErr) {
          res.set('Retry-After', '2');
          res.set('X-Tile-Status', 'generating');
          return res.status(202).json({ status: 'generating', retry_after: 2, requested: { z: sourceLevel, x: tileCol, y: tileRow } });
        }
      }
      res.sendFile(filePath, (sendErr) => {
        if (sendErr) {
          console.warn("WMTS REST tile send failed", {
            project: layer.project,
            layer: layer.layerName,
            tileMatrixId,
            tileCol,
            tileRow,
            error: sendErr?.message
          });
          res.status(500).send("Failed to deliver tile");
        }
      });
    });
  }
);

// --- Helper: calcular bbox WMTS EPSG:3857 ---
function computeTileBBoxWMTS(z, x, y, tileSize = 256) {
  const WEB_MERCATOR_EXTENT = 20037508.342789244;
  const res = (WEB_MERCATOR_EXTENT * 2) / (Math.pow(2, z) * tileSize);
  const minx = -WEB_MERCATOR_EXTENT + x * res * tileSize;
  const maxx = minx + res * tileSize;
  const maxy = WEB_MERCATOR_EXTENT - y * res * tileSize;
  const miny = maxy - res * tileSize;
  return { minx, miny, maxx, maxy };
}

/**
 * Calcula el bbox de una tile WMTS en EPSG:3857
 * @param {number} z - Zoom level
 * @param {number} x - Tile X
 * @param {number} y - Tile Y
 * @param {number} [tileSize=256] - Tile size in pixels
 * @returns {[minx, miny, maxx, maxy]}
 */
function getTileBBox(z, x, y, tileSize = 256) {
  // Extensión total EPSG:3857
  const initialResolution = 2 * Math.PI * 6378137 / tileSize;
  const originShift = 2 * Math.PI * 6378137 / 2.0;
  const resolution = initialResolution / Math.pow(2, z);
  const minx = x * tileSize * resolution - originShift;
  const maxx = (x + 1) * tileSize * resolution - originShift;
  const miny = originShift - (y + 1) * tileSize * resolution;
  const maxy = originShift - y * tileSize * resolution;
  return [minx, miny, maxx, maxy];
}

export { getTileBBox };
// --- Control de concurrencia y cola FIFO para generación de tiles ---
const MAX_CONCURRENT_TILE_JOBS = 2; // Ajusta según capacidad del servidor
let activeTileJobs = 0;
const tileJobQueue = [];

function enqueueTileJob(jobFn) {
  return new Promise((resolve, reject) => {
    tileJobQueue.push({ jobFn, resolve, reject });
    processTileQueue();
  });
}

function processTileQueue() {
  while (activeTileJobs < MAX_CONCURRENT_TILE_JOBS && tileJobQueue.length > 0) {
    const { jobFn, resolve, reject } = tileJobQueue.shift();
    activeTileJobs++;
    jobFn()
      .then((result) => {
        activeTileJobs--;
        resolve(result);
        processTileQueue();
      })
      .catch((err) => {
        activeTileJobs--;
        reject(err);
        processTileQueue();
      });
  }
}

// Uso: reemplaza la invocación directa de generación de tile por enqueueTileJob(() => generarTile(...))
// ...existing code...

// servir index.json del cache para meta en el visor
// ruta legacy desactivada: informar que ahora se usan índices por proyecto
app.get("/cache/index.json", requireAdmin, (req, res) => {
  return res.status(410).json({
    error: "gone",
    message: "El index.json global ha sido eliminado. Usa /cache/:project/index.json"
  });
});

// index por proyecto
app.get("/cache/:project/index.json", requireAdmin, (req, res) => {
  try {
    const p = req.params.project;
    const pIndex = path.join(cacheDir, p, "index.json");
    if (fs.existsSync(pIndex)) return res.sendFile(pIndex);
    // Auto-create minimal index if directory exists or project found
    const proj = findProjectById(p);
    const pDir = path.join(cacheDir, p);
    if (!fs.existsSync(pDir)) {
      fs.mkdirSync(pDir, { recursive: true });
    }
    const skeleton = {
      project: proj ? proj.file : null,
      id: p,
      created: new Date().toISOString(),
      layers: []
    };
    try { fs.writeFileSync(pIndex, JSON.stringify(skeleton, null, 2), "utf8"); } catch { }
    return res.json(skeleton);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// Delete entire project cache (all layers + index)
app.delete("/cache/:project", requireAdmin, async (req, res) => {
  const p = req.params.project;
  const pDir = path.join(cacheDir, p);
  // abort running jobs for this project
  for (const [id, job] of runningJobs.entries()) {
    if (job.project === p && job.status === 'running') {
      try { job.proc.kill(); job.status = 'aborted'; job.endedAt = Date.now(); } catch { }
      try {
        const activeKey = job.key || `${job.project || ''}:${job.targetMode || 'layer'}:${job.targetName || job.layer}`;
        activeKeys.delete(activeKey);
      } catch { }
    }
  }
  try {
    // debug: report the paths and existence
    try { logProjectEvent(p, `Request delete cache for project=${p} path=${pDir}`); } catch {}
    console.log(`[DEBUG] delete cache requested for project='${p}' path='${pDir}'`);

    if (fs.existsSync(pDir)) {
      const stat = fs.statSync(pDir);
      if (!stat.isDirectory()) {
        // Unexpected file at project cache path
        const msg = `project cache path exists but is not a directory: ${pDir}`;
        try { logProjectEvent(p, msg); } catch {}
        return res.status(500).json({ error: 'invalid_cache_path', details: msg });
      }

      try {
        fs.rmSync(pDir, { recursive: true, force: true });
        try { logProjectEvent(p, `Cache deleted for project ${p}`); } catch {}
        
        // Re-bootstrap index.json immediately to restore "uncached" state
        const proj = findProjectById(p);
        if (proj && proj.file) {
          try {
            // Force bootstrap to overwrite any stale/empty index
            await bootstrapProjectCacheIndex(p, proj.file, true);
          } catch (err) {
            console.warn(`[bootstrap] Failed to re-bootstrap index after delete for ${p}`, err);
          }
        }

        return res.json({ status: 'deleted', project: p, path: pDir });
      } catch (rmErr) {
        const details = String(rmErr?.stack || rmErr);
        try { logProjectEvent(p, `Cache delete failed for ${p}: ${details}`); } catch {}
        console.error('[ERROR] cache delete failed', details);
        return res.status(500).json({ error: 'delete_failed', details });
      }
    }

    return res.status(404).json({ error: 'project_cache_not_found', project: p, path: pDir });
  } catch (e) {
    return res.status(500).json({ error: 'delete_failed', details: String(e) });
  }
});

// DELETE cache for a specific layer or theme within a project
app.delete('/cache/:project/:name', requireAdmin, async (req, res) => {
  const project = req.params.project;
  const name = req.params.name;
  const force = (req.query && (req.query.force === '1' || req.query.force === 'true')) || false;
  const layerPath = path.join(cacheDir, project, name);
  const themePath = path.join(cacheDir, project, '_themes', name);
  try {
    // prefer layer
    if (fs.existsSync(layerPath)) {
      await deleteLayerCacheInternal(project, name, { force: Boolean(force), silent: false });
      return res.json({ status: 'deleted', project, layer: name, path: layerPath, force });
    }
    if (fs.existsSync(themePath)) {
      await deleteThemeCacheInternal(project, name, { force: Boolean(force), silent: false });
      return res.json({ status: 'deleted', project, theme: name, path: themePath, force });
    }
    return res.status(404).json({ error: 'cache_not_found', project, name });
  } catch (err) {
    const details = String(err?.stack || err);
    try { logProjectEvent(project, `Failed to delete cache ${name}: ${details}`); } catch {}
    console.error('[ERROR] delete cache failed', details);
    if (err && err.code === 'job_running') {
      return res.status(409).json({ error: 'job_running', jobId: err.jobId, message: 'A render job is running for this layer/theme. Retry with ?force=1 to abort and delete.' });
    }
    return res.status(500).json({ error: 'delete_failed', details });
  }
});

// Diagnostic: list files/directories under a project's cache directory
app.get('/cache/:project/list', requireAdmin, (req, res) => {
  const project = req.params.project;
  const dir = path.join(cacheDir, project);
  try {
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'project_cache_not_found', project });
    const entries = fs.readdirSync(dir).map((name) => {
      try {
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        return { name, path: p, isDirectory: st.isDirectory(), size: st.size };
      } catch (e) {
        return { name, error: String(e) };
      }
    });
    return res.json({ project, path: dir, entries });
  } catch (e) {
    return res.status(500).json({ error: 'list_failed', details: String(e) });
  }
});

// --- DEBUG: expose WMTS inventory and tile path diagnostics (local use only) ---
// Public debug endpoint (temporary): expose WMTS inventory JSON for troubleshooting
app.get('/wmts/debug/inventory', (req, res) => {
  try {
    const filterProject = req.query.project ? String(req.query.project).trim() : null;
    const inventory = buildWmtsInventory(filterProject ? { filterProjectId: filterProject } : {});
    return res.json({ ok: true, filterProject: filterProject || null, layers: inventory.layers, tileMatrixSets: inventory.tileMatrixSets });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// Compute expected tile file path and existence for a given project/layer/theme/z/x/y
// Public debug endpoint (temporary): compute expected tile file path and existence
app.get('/wmts/debug/tilepath', (req, res) => {
  try {
    const project = req.query.project ? String(req.query.project) : null;
    const name = req.query.name ? String(req.query.name) : null; // layer or theme name
    const z = req.query.z != null ? Number(req.query.z) : null;
    const x = req.query.x != null ? Number(req.query.x) : null;
    const y = req.query.y != null ? Number(req.query.y) : null;
    if (!project || !name || !Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
      return res.status(400).json({ ok: false, error: 'Missing required query params: project, name, z, x, y' });
    }

    const cfgPath = path.join(cacheDir, project, PROJECT_CONFIG_FILENAME);
    let isTheme = false;
    try {
      if (fs.existsSync(cfgPath)) {
        const raw = fs.readFileSync(cfgPath, 'utf8');
        const cfg = JSON.parse(raw || '{}');
        isTheme = !!(cfg && cfg.themes && Object.prototype.hasOwnProperty.call(cfg.themes, name));
      }
    } catch (e) {
      // ignore parsing errors; we'll still try to compute path
    }

    const baseDir = isTheme ? path.join(cacheDir, project, '_themes', name) : path.join(cacheDir, project, name);
    const filePath = path.join(baseDir, String(z), String(x), `${y}.png`);
    const exists = fs.existsSync(filePath);
    let stats = null;
    try { if (exists) stats = fs.statSync(filePath); } catch (e) { stats = null; }

    return res.json({ ok: true, project, name, isTheme, filePath, exists, stats: stats ? { size: stats.size, mtime: stats.mtime } : null });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// DELETE cache for a layer and update index.json
// --- Control de concurrencia y cola para render on-demand ---
const MAX_RENDER_PROCS = 8;
// Por defecto, tiempo máximo que dejamos a la invocación de Python para renderizar (ms)
const RENDER_TIMEOUT_MS = Number.isFinite(Number(process.env.RENDER_TIMEOUT_MS || 180000)) ? Number(process.env.RENDER_TIMEOUT_MS || 180000) : 180000;
// Número de reintentos por tile en llamadas internas (on-demand)
const RENDER_TILE_RETRIES = Number.isFinite(Number(process.env.RENDER_TILE_RETRIES || 1)) ? Number(process.env.RENDER_TILE_RETRIES || 1) : 1;
const activeRenders = new Set();
const renderQueue = [];
const ENABLE_RENDER_FILE_LOGS = (() => {
  const raw = String(process.env.ENABLE_RENDER_FILE_LOGS || process.env.RENDER_FILE_LOGS || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
})();

function queueTileRender(params, filePath, cb) {
  const key = `${params.project}|${params.layer || params.theme}|${params.z}|${params.x}|${params.y}`;
  try {
    const targetMode = params.targetMode || (params.theme ? "theme" : "layer");
    const targetName = params.theme || params.layer || params.name || null;
    if (params.project && targetName) {
      recordOnDemandRequest(params.project, targetMode, targetName);
    }
  } catch (err) {
    console.warn("Failed to record on-demand metadata", { project: params.project, layer: params.layer || params.theme, error: err?.message || err });
  }
  if (activeRenders.has(key)) {
    // Ya en proceso, espera y reintenta
    let tries = 0;
    const interval = setInterval(() => {
      if (fs.existsSync(filePath)) {
        clearInterval(interval);
        cb(null, filePath);
      } else if (++tries > 150) { // 150 × 1000ms = 150 segundos (2.5 minutos)
        clearInterval(interval);
        cb(new Error('Timeout esperando tile'), null);
      }
    }, 1000); // Check every second instead of 200ms
    return;
  }
  const task = { params, filePath, cb, key };
  renderQueue.push(task);
  processRenderQueue();
}

function processRenderQueue() {
  if (activeRenders.size >= MAX_RENDER_PROCS) return;
  const next = renderQueue.shift();
  if (!next) return;
  activeRenders.add(next.key);
  // Construir comando Python
  const pyExe = process.env.PYTHON_EXE || 'python';
  const pyScript = path.join(__dirname, 'python', 'generate_cache.py');
  // Script path is not part of args
  const scriptPath = pyScript;
  // Argumentos separados, nunca incluir el path del script
  const args = [
    '--single',
    '--project', path.join(__dirname, 'qgisprojects', `${next.params.project}.qgz`),
    next.params.layer ? '--layer' : null,
    next.params.layer ? next.params.layer : null,
    next.params.theme ? '--theme' : null,
    next.params.theme ? next.params.theme : null,
    '--z', String(next.params.z),
    '--x', String(next.params.x),
    '--y', String(next.params.y),
    '--output_dir', path.dirname(next.filePath)
  ].filter(Boolean);
  // If cache index metadata exists for this project+layer, compute a precise
  // bbox in the layer's tile CRS and pass it to the Python script so it can
  // render the correct extent (needed for non-EPSG:3857 tile grids).
  let cachedEntryPreset = null;
  try {
    const pIndexPath = path.join(cacheDir, next.params.project, 'index.json');
    if (fs.existsSync(pIndexPath)) {
      try {
        const raw = fs.readFileSync(pIndexPath, 'utf8');
        const idx = JSON.parse(raw || '{}');
        const layers = Array.isArray(idx.layers) ? idx.layers : [];
        const entry = layers.find((e) => e && (e.name === next.params.layer || e.name === next.params.theme));
        if (entry && typeof entry.tile_matrix_preset === "string") {
          const trimmed = entry.tile_matrix_preset.trim();
          if (trimmed) cachedEntryPreset = trimmed;
        }
        // Removed manual bbox calculation here. generate_cache.py handles it correctly using the preset.
      } catch (e) {
        // ignore parsing errors; continue with default args
      }
    }
  } catch (e) {
    // ignore any fs errors
  }
  if (cachedEntryPreset) {
    args.push('--tile_matrix_preset', cachedEntryPreset);
  }
  // Lanzar proceso
  // import { spawn } from 'child_process' ya está al inicio del archivo
  // Elimina el require redundante y usa el import existente
  logProjectEvent(next.params.project, `Render tile request: ${JSON.stringify(next.params)} | file: ${next.filePath}`);
  // Usar el batch OSGeo4W como entrypoint y pasar python como argumento
  // Prepare environment for the child process. Keep PYTHON* vars so
  // OSGeo4W can set them correctly (removing them caused missing
  // 'encodings' errors). Modify PATH to prefer OSGeo4W/QGIS paths
  // and remove any Qtiler entries.
  const childEnv = { ...makeChildEnv() };
  if (childEnv.PATH) {
    const qgisPaths = [process.env.OSGEO4W_BIN, path.join(process.env.QGIS_PREFIX || '', 'bin')].filter(Boolean);
    const parts = childEnv.PATH.split(';').filter(p => p && !p.toLowerCase().includes('qtiler'));
    // Prepend QGIS/OSGeo4W paths so python/qgis libs are resolved first
    for (const p of qgisPaths.reverse()) {
      if (!parts.includes(p)) parts.unshift(p);
    }
    childEnv.PATH = parts.join(';');
  }
  // Use wrapper batch file for Python invocation
  const wrapperBatch = path.join(__dirname, 'daemon', 'run_qgis_python.bat');
  // Pasar todos los argumentos al batch (no truncar)
  const spawnArgs = [scriptPath, ...args];
  logProjectEvent(next.params.project, `SPAWN: cmd.exe ${JSON.stringify(['/c', wrapperBatch, ...spawnArgs])}`);
  console.log('SPAWN via o4w helper:', wrapperBatch, ...spawnArgs);
  // Prepare persistent per-render log
  try {
    const shouldWriteRenderLog = ENABLE_RENDER_FILE_LOGS === true;
    let renderStream = null;
    const appendRenderLog = (message) => {
      if (!renderStream) return;
      try {
        renderStream.write(`[${new Date().toISOString()}] ${message}\n`);
      } catch (_) {
        // ignore file logging errors to avoid breaking rendering
      }
    };

    if (shouldWriteRenderLog) {
      try {
        const renderLogName = `render-${next.params.project}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.log`;
        const renderLogPath = path.join(logsDir, renderLogName);
        renderStream = fs.createWriteStream(renderLogPath, { flags: 'a' });
        appendRenderLog(`Render request: ${JSON.stringify(next.params)}`);
        appendRenderLog(`[ENV PATH] ${childEnv.PATH || ''}`);
        logProjectEvent(next.params.project, `Render log: ${renderLogPath}`);
      } catch (logErr) {
        console.warn('Failed to open render log file', logErr?.message || logErr);
        renderStream = null;
      }
    }

    // Build augmented args (include timeouts/retries) and use them as final spawn args
    const augmentedArgs = args.slice();
    if (Number.isFinite(Number(RENDER_TIMEOUT_MS)) && Number(RENDER_TIMEOUT_MS) > 0) {
      augmentedArgs.push('--render_timeout_ms', String(Math.floor(Number(RENDER_TIMEOUT_MS))));
    }
    if (Number.isFinite(Number(RENDER_TILE_RETRIES)) && Number(RENDER_TILE_RETRIES) >= 0) {
      augmentedArgs.push('--tile_retries', String(Math.floor(Number(RENDER_TILE_RETRIES))));
    }

    // final spawn args: script path + augmented args
    const spawnArgsFinal = [scriptPath, ...augmentedArgs];
    appendRenderLog(`Spawn wrapper: ${wrapperBatch} ${spawnArgsFinal.map(a => typeof a === 'string' && a.includes(' ') ? `"${a}"` : a).join(' ')}`);

    // Spawn the process via wrapper batch (use ComSpec so Windows cmd is located)
    const comspec = process.env.ComSpec || 'cmd.exe';
    const proc = spawn(comspec, ['/c', wrapperBatch, ...spawnArgsFinal], {
      env: childEnv,
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    try {
      if (proc && Array.isArray(proc.spawnargs)) {
        logProjectEvent(next.params.project, `SPAWN_CMD: ${JSON.stringify(proc.spawnargs)}`);
        appendRenderLog(`SPAWN_CMD: ${proc.spawnargs.join(' ')}`);
      }
    } catch (e) {
      // ignore logging errors
    }

    let stdout = '', stderr = '';
    proc.stdout.on('data', (data) => {
      const s = data.toString();
      stdout += s;
      appendRenderLog(`[PYTHON OUT] ${s.trim()}`);
      logProjectEvent(next.params.project, `[PYTHON OUT] ${s.trim()}`);
      console.log('[PYTHON OUT]', s.trim());
    });
    proc.stderr.on('data', (data) => {
      const s = data.toString();
      stderr += s;
      appendRenderLog(`[PYTHON ERR] ${s.trim()}`);
      logProjectEvent(next.params.project, `[PYTHON ERR] ${s.trim()}`);
      console.error('[PYTHON ERR]', s.trim());
    });
    proc.on('close', (code) => {
      appendRenderLog(`[CLOSE] code: ${code}`);
      if (renderStream) {
        try { renderStream.end(); } catch (_) {}
      }
      activeRenders.delete(next.key);
      if (fs.existsSync(next.filePath)) {
        logProjectEvent(next.params.project, `Tile generated OK: ${next.filePath} | code: ${code} | stdout: ${stdout}`);
        next.cb(null, next.filePath);
      } else {
        logProjectEvent(next.params.project, `Tile generation FAILED: ${next.filePath} | code: ${code} | stderr: ${stderr}`);
        next.cb(new Error('No se pudo generar tile'), null);
      }
      processRenderQueue();
    });
  } catch (e) {
    try { logProjectEvent(next.params.project, `Render outer error: ${e?.stack || e}`); } catch { }
    try { if (typeof next === 'object' && next && typeof next.cb === 'function') next.cb(new Error('Render failed'), null); } catch { }
    try { processRenderQueue(); } catch { }
  }
}
// servir tiles on-demand
// servir tiles on-demand
app.get("/wmts/:project/themes/:theme/:z/:x/:y.png", ensureProjectAccess((req) => req.params.project), (req, res) => {
  const { project, theme, z, x, y } = req.params;
  
  // Evitar caché agresiva del navegador para tiles dinámicas
  try { res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); } catch (e) {}
  
  let file = path.join(cacheDir, project, "_themes", theme, z, x, `${y}.png`);
  
  // 1. Si la tile YA EXISTE, enviarla inmediatamente
  if (fs.existsSync(file)) {
    logProjectEvent(project, `Tile hit: ${file}`);
    return res.sendFile(file);
  }

  // Lógica de fallback (si el tema no existe, buscar capa con el mismo nombre)
  const cfgPath = path.join(cacheDir, project, PROJECT_CONFIG_FILENAME);
  let hasThemes = false;
  let hasLayerWithName = false;
  if (fs.existsSync(cfgPath)) {
    try {
      const raw = fs.readFileSync(cfgPath, 'utf8');
      const cfg = JSON.parse(raw || '{}');
      hasThemes = cfg && cfg.themes && Object.keys(cfg.themes || {}).length > 0;
      hasLayerWithName = cfg && cfg.layers && Object.prototype.hasOwnProperty.call(cfg.layers, theme);
    } catch (e) {
      logProjectEvent(project, `Config parse error for fallback: ${e?.message || e}`);
    }
  }

  // Si no hay temas y existe la capa, usar fallback forzado
  if (!hasThemes && hasLayerWithName) {
    const fallbackFile = path.join(cacheDir, project, theme, z, x, `${y}.png`);
    logProjectEvent(project, `Theme '${theme}' not defined; forced fallback to layer '${theme}' -> ${fallbackFile}`);
    
    if (fs.existsSync(fallbackFile)) {
      logProjectEvent(project, `Tile hit (fallback): ${fallbackFile}`);
      return res.sendFile(fallbackFile);
    }
    
    logProjectEvent(project, `Tile miss (fallback): ${fallbackFile}. Generating on-demand...`);
    
    // Generar fallback on-demand Y ESPERAR
    return queueTileRender({ project, layer: theme, z, x, y }, fallbackFile, (err, outFile) => {
      if (err) {
        logProjectEvent(project, `Tile render error (fallback): ${fallbackFile} | ${err?.message || err}`);
        if (!res.headersSent) return res.status(500).send('Tile generation failed');
      } else {
        logProjectEvent(project, `Tile render success (fallback): ${outFile}`);
        if (!res.headersSent) return res.sendFile(outFile);
      }
    });
  }

  // 2. Generación normal de tema on-demand Y ESPERAR
  logProjectEvent(project, `Tile miss: ${file}. Generating on-demand...`);
  
  queueTileRender({ project, theme, z, x, y }, file, (err, outFile) => {
    if (err) {
      logProjectEvent(project, `Tile render error: ${file} | ${err?.message || err}`);
      
      // Intento de fallback a capa si el render de tema falló
      if (hasLayerWithName) {
        const fallbackFile = path.join(cacheDir, project, theme, z, x, `${y}.png`);
        logProjectEvent(project, `Theme render failed; forced fallback to layer '${theme}' -> ${fallbackFile}`);
        
        return queueTileRender({ project, layer: theme, z, x, y }, fallbackFile, (layerErr, layerOutFile) => {
          if (layerErr) {
             logProjectEvent(project, `Tile render error (forced fallback): ${fallbackFile} | ${layerErr?.message || layerErr}`);
             if (!res.headersSent) return res.status(500).send('Tile generation failed');
          } else {
             logProjectEvent(project, `Tile render success (forced fallback): ${layerOutFile}`);
             if (!res.headersSent) return res.sendFile(layerOutFile);
          }
        });
      }
      
      if (!res.headersSent) return res.status(500).send('Tile generation failed');
    } else {
      logProjectEvent(project, `Tile render success: ${outFile}`);
      if (!res.headersSent) return res.sendFile(outFile);
    }
  });
});

app.get("/wmts/:project/:layer/:z/:x/:y.png", ensureProjectAccess((req) => req.params.project), (req, res) => {
  const { project, layer, z, x, y } = req.params;
  
  try { res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); } catch (e) {}
  
  const file = path.join(cacheDir, project, layer, z, x, `${y}.png`);

  // 1. Si existe, enviar inmediatamente
  if (fs.existsSync(file)) {
    logProjectEvent(project, `Tile hit: ${file}`);
    return res.sendFile(file);
  }

  // 2. Si no existe, Generar on-demand Y ESPERAR
  logProjectEvent(project, `Tile miss: ${file}. Generating on-demand...`);
  
  queueTileRender({ project, layer, z, x, y }, file, (err, outFile) => {
    if (err) {
      logProjectEvent(project, `Tile render error: ${file} | ${err?.message || err}`);
      if (!res.headersSent) return res.status(500).send('Tile generation failed');
    } else {
      logProjectEvent(project, `Tile render success: ${outFile}`);
      if (!res.headersSent) return res.sendFile(outFile);
    }
  });
});

// compat legado: sin proyecto
app.get("/wmts/:layer/:z/:x/:y.png", requireAdmin, (req, res) => {
  const { layer, z, x, y } = req.params;
  const file = path.join(cacheDir, layer, z, x, `${y}.png`);
  if (fs.existsSync(file)) {
    logProjectEvent('nogo', `Tile hit: ${file}`);
    return res.sendFile(file);
  }
  logProjectEvent('nogo', `Tile miss: ${file}. Generating on-demand...`);
  queueTileRender({ project: 'nogo', layer, z, x, y }, file, (err, outFile) => {
    if (err) {
      logProjectEvent('nogo', `Tile render error: ${file} | ${err?.message || err}`);
      return res.status(500).json({ error: 'tile_render_failed', details: String(err) });
    }
    logProjectEvent('nogo', `Tile render success: ${outFile}`);
    res.sendFile(outFile);
  });
});
// KVP GetTile shortcut: handle WMTS GetTile KVP requests (used by QGIS)
// ---------------------------------------------------------
// 1. HANDLER KVP: Atrapa peticiones de tiles de QGIS (?REQUEST=GetTile)
// ---------------------------------------------------------
app.get("/wmts", (req, res, next) => {
  // helper: find query param case-insensitively
  const findQ = (name) => {
    const low = name.toLowerCase();
    for (const k of Object.keys(req.query || {})) {
      if (k.toLowerCase() === low) return req.query[k];
    }
    return undefined;
  };
  const svc = String(findQ('SERVICE') || findQ('service') || "").toUpperCase();
  const reqType = String(findQ('REQUEST') || findQ('request') || "").toUpperCase();

  if (svc !== "WMTS") {
    return next();
  }

  if (reqType === "GETCAPABILITIES") {
    const filterProjectRaw = req.query.project != null ? String(req.query.project).trim() : "";
    const filterProjectId = filterProjectRaw ? filterProjectRaw.replace(/[^a-zA-Z0-9-_]/g, "").toLowerCase() : "";

    // For GetCapabilities, check project access if a specific project is requested
    const executeGetCapabilities = () => {
      try {
        const inventory = buildWmtsInventory(filterProjectId ? { filterProjectId } : {});
        const { layers, tileMatrixSets } = inventory;

        const xmlEscape = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const formatNumber = (value) => {
          const num = Number(value);
          if (!Number.isFinite(num)) return "0";
          if (Number.isInteger(num)) return num.toString();
          return num.toPrecision(15).replace(/0+$/g, "").replace(/\.$/, "");
        };
        const formatCorner = (coords) => `${formatNumber(coords[0])} ${formatNumber(coords[1])}`;
        
        const configuredBaseUrl = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/g, "");
        let proto = req.protocol || "http";
        if (req.get("x-forwarded-proto")) proto = req.get("x-forwarded-proto").split(",")[0].trim();
        
        const host = req.get("host");
        const derivedBaseUrl = host ? `${proto}://${host}` : "";
        const baseUrl = configuredBaseUrl || derivedBaseUrl;

        let kvpUrl = baseUrl + "/wmts?";
        if (filterProjectId) {
            kvpUrl += "project=" + encodeURIComponent(filterProjectId) + "&";
        }

        const metadataSnapshot = serviceMetadata || serviceMetadataDefaults;
        const sidMeta = metadataSnapshot?.serviceIdentification || {};
        const providerMeta = metadataSnapshot?.serviceProvider || {};
        const contactMeta = providerMeta?.contact || {};
        const addressMeta = contactMeta?.address || {};
        const operationsMeta = metadataSnapshot?.operations || {};

        const xmlParts = [];
        xmlParts.push("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        xmlParts.push("<Capabilities xmlns=\"http://www.opengis.net/wmts/1.0\" xmlns:ows=\"http://www.opengis.net/ows/1.1\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:gml=\"http://www.opengis.net/gml\" version=\"1.0.0\">");
        const serviceTitle = sidMeta.title || "Local WMTS";
        const serviceType = sidMeta.serviceType || "OGC WMTS";
        const serviceTypeVersion = sidMeta.serviceTypeVersion || "1.0.0";
        xmlParts.push("<ows:ServiceIdentification>");
        xmlParts.push(`<ows:Title>${xmlEscape(serviceTitle)}</ows:Title>`);
        if (sidMeta.abstract) {
          xmlParts.push(`<ows:Abstract>${xmlEscape(sidMeta.abstract)}</ows:Abstract>`);
        }
        if (Array.isArray(sidMeta.keywords) && sidMeta.keywords.length) {
          xmlParts.push("<ows:Keywords>");
          for (const keyword of sidMeta.keywords) {
            if (keyword == null) continue;
            xmlParts.push(`<ows:Keyword>${xmlEscape(keyword)}</ows:Keyword>`);
          }
          xmlParts.push("</ows:Keywords>");
        }
        xmlParts.push(`<ows:ServiceType>${xmlEscape(serviceType)}</ows:ServiceType>`);
        xmlParts.push(`<ows:ServiceTypeVersion>${xmlEscape(serviceTypeVersion)}</ows:ServiceTypeVersion>`);
        if (sidMeta.fees != null) {
          xmlParts.push(`<ows:Fees>${xmlEscape(sidMeta.fees)}</ows:Fees>`);
        }
        if (sidMeta.accessConstraints != null) {
          xmlParts.push(`<ows:AccessConstraints>${xmlEscape(sidMeta.accessConstraints)}</ows:AccessConstraints>`);
        }
        xmlParts.push("</ows:ServiceIdentification>");

        xmlParts.push("<ows:ServiceProvider>");
        xmlParts.push(`<ows:ProviderName>${xmlEscape(providerMeta.providerName || "Local")}</ows:ProviderName>`);
        if (providerMeta.providerSite) {
          xmlParts.push(`<ows:ProviderSite xlink:href="${xmlEscape(providerMeta.providerSite)}"/>`);
        }
        const hasContactInfo = contactMeta && (contactMeta.individualName || contactMeta.positionName || contactMeta.phoneVoice || contactMeta.phoneFacsimile || addressMeta.deliveryPoint || addressMeta.city || addressMeta.administrativeArea || addressMeta.postalCode || addressMeta.country || addressMeta.email);
        if (hasContactInfo) {
          xmlParts.push("<ows:ServiceContact>");
          if (contactMeta.individualName) {
            xmlParts.push(`<ows:IndividualName>${xmlEscape(contactMeta.individualName)}</ows:IndividualName>`);
          }
          if (contactMeta.positionName) {
            xmlParts.push(`<ows:PositionName>${xmlEscape(contactMeta.positionName)}</ows:PositionName>`);
          }
          const hasPhone = contactMeta.phoneVoice || contactMeta.phoneFacsimile;
          const hasAddress = addressMeta.deliveryPoint || addressMeta.city || addressMeta.administrativeArea || addressMeta.postalCode || addressMeta.country || addressMeta.email;
          if (hasPhone || hasAddress) {
            xmlParts.push("<ows:ContactInfo>");
            if (hasPhone) {
              xmlParts.push("<ows:Phone>");
              if (contactMeta.phoneVoice) {
                xmlParts.push(`<ows:Voice>${xmlEscape(contactMeta.phoneVoice)}</ows:Voice>`);
              }
              if (contactMeta.phoneFacsimile) {
                xmlParts.push(`<ows:Facsimile>${xmlEscape(contactMeta.phoneFacsimile)}</ows:Facsimile>`);
              }
              xmlParts.push("</ows:Phone>");
            }
            if (hasAddress) {
              xmlParts.push("<ows:Address>");
              if (addressMeta.deliveryPoint) xmlParts.push(`<ows:DeliveryPoint>${xmlEscape(addressMeta.deliveryPoint)}</ows:DeliveryPoint>`);
              if (addressMeta.city) xmlParts.push(`<ows:City>${xmlEscape(addressMeta.city)}</ows:City>`);
              if (addressMeta.administrativeArea) xmlParts.push(`<ows:AdministrativeArea>${xmlEscape(addressMeta.administrativeArea)}</ows:AdministrativeArea>`);
              if (addressMeta.postalCode) xmlParts.push(`<ows:PostalCode>${xmlEscape(addressMeta.postalCode)}</ows:PostalCode>`);
              if (addressMeta.country) xmlParts.push(`<ows:Country>${xmlEscape(addressMeta.country)}</ows:Country>`);
              if (addressMeta.email) xmlParts.push(`<ows:ElectronicMailAddress>${xmlEscape(addressMeta.email)}</ows:ElectronicMailAddress>`);
              xmlParts.push("</ows:Address>");
            }
            xmlParts.push("</ows:ContactInfo>");
          }
          xmlParts.push("</ows:ServiceContact>");
        }
        xmlParts.push("</ows:ServiceProvider>");
        
        const pushOperation = (name) => {
          xmlParts.push(`<ows:Operation name="${name}">`);
          xmlParts.push("<ows:DCP><ows:HTTP><ows:Get xlink:href=\"" + xmlEscape(kvpUrl) + "\"><ows:Constraint name=\"GetEncoding\"><ows:AllowedValues><ows:Value>KVP</ows:Value></ows:AllowedValues></ows:Constraint></ows:Get></ows:HTTP></ows:DCP>");
          xmlParts.push("</ows:Operation>");
        };
        xmlParts.push("<ows:OperationsMetadata>");
        pushOperation("GetCapabilities");
        pushOperation("GetTile");
        if (operationsMeta.getFeatureInfo) {
          pushOperation("GetFeatureInfo");
        }
        xmlParts.push("</ows:OperationsMetadata>");

        xmlParts.push("<Contents>");

        for (const layer of layers) {
          xmlParts.push("<Layer>");
          xmlParts.push(`<ows:Title>${xmlEscape(layer.displayTitle || layer.identifier)}</ows:Title>`);
          xmlParts.push(`<ows:Identifier>${xmlEscape(layer.identifier)}</ows:Identifier>`);
          
          // WGS84 BBox
          const wgsExtent = deriveWgs84Extent(layer);
          if (wgsExtent) {
            xmlParts.push("<ows:WGS84BoundingBox>");
            xmlParts.push(`<ows:LowerCorner>${formatNumber(wgsExtent[0])} ${formatNumber(wgsExtent[1])}</ows:LowerCorner>`);
            xmlParts.push(`<ows:UpperCorner>${formatNumber(wgsExtent[2])} ${formatNumber(wgsExtent[3])}</ows:UpperCorner>`);
            xmlParts.push("</ows:WGS84BoundingBox>");
          }
          
          if (Array.isArray(layer.extent) && layer.extent.length === 4) {
             const [minx, miny, maxx, maxy] = layer.extent;
             xmlParts.push(`<ows:BoundingBox crs=\"${xmlEscape(layer.tileCrsUrn)}\">`);
             xmlParts.push(`<ows:LowerCorner>${formatNumber(minx)} ${formatNumber(miny)}</ows:LowerCorner>`);
             xmlParts.push(`<ows:UpperCorner>${formatNumber(maxx)} ${formatNumber(maxy)}</ows:UpperCorner>`);
             xmlParts.push("</ows:BoundingBox>");
          }

          xmlParts.push(`<ows:SupportedCRS>${xmlEscape(layer.tileCrsUrn)}</ows:SupportedCRS>`);
          
          for (const style of layer.styles) {
            xmlParts.push(`<Style isDefault=\"${style.isDefault ? "true" : "false"}\">`);
            xmlParts.push(`<ows:Identifier>${xmlEscape(style.id)}</ows:Identifier>`);
            xmlParts.push("</Style>");
          }

          xmlParts.push("<Format>image/png</Format>");
          xmlParts.push(`<TileMatrixSetLink><TileMatrixSet>${xmlEscape(layer.tileMatrixSetId)}</TileMatrixSet>`);
          xmlParts.push("</TileMatrixSetLink>");
          
          if (baseUrl) {
             const template = `${baseUrl}/wmts/rest/${encodeURIComponent(layer.projectKey)}/${encodeURIComponent(layer.layerKey)}/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png`;
             xmlParts.push(`<ResourceURL format=\"image/png\" resourceType=\"tile\" template=\"${xmlEscape(template)}\"/>`);
          }
          
          xmlParts.push("</Layer>");
        }

        for (const set of tileMatrixSets) {
           xmlParts.push("<TileMatrixSet>");
           xmlParts.push(`<ows:Identifier>${xmlEscape(set.id)}</ows:Identifier>`);
           xmlParts.push(`<ows:SupportedCRS>${xmlEscape(toCrsUrn(set.supportedCrs))}</ows:SupportedCRS>`);
           for (const matrix of set.matrices || []) {
              xmlParts.push("<TileMatrix>");
              xmlParts.push(`<ows:Identifier>${xmlEscape(matrix.identifier)}</ows:Identifier>`);
              xmlParts.push(`<ScaleDenominator>${formatNumber(matrix.scaleDenominator)}</ScaleDenominator>`);
              const tl = (matrix.topLeftCorner && matrix.topLeftCorner.length===2) ? matrix.topLeftCorner : [-WEB_MERCATOR_EXTENT, WEB_MERCATOR_EXTENT];
              xmlParts.push(`<TopLeftCorner>${formatCorner(tl)}</TopLeftCorner>`);
              xmlParts.push(`<TileWidth>${formatNumber(matrix.tileWidth || 256)}</TileWidth>`);
              xmlParts.push(`<TileHeight>${formatNumber(matrix.tileHeight || 256)}</TileHeight>`);
              xmlParts.push(`<MatrixWidth>${formatNumber(matrix.matrixWidth)}</MatrixWidth>`);
              xmlParts.push(`<MatrixHeight>${formatNumber(matrix.matrixHeight)}</MatrixHeight>`);
              xmlParts.push("</TileMatrix>");
           }
           xmlParts.push("</TileMatrixSet>");
        }

        xmlParts.push("</Contents>");
        xmlParts.push("</Capabilities>");

        res.setHeader("Content-Type", "application/xml");
        return res.send(xmlParts.join(""));
      } catch (error) {
        console.error("WMTS capabilities error", error);
        return res.status(500).json({ error: "wmts_capabilities_failed", details: String(error) });
      }
    };

    // Check access if specific project is requested
    if (filterProjectId) {
      const checkAccess = security.ensureProjectAccess(req, res, executeGetCapabilities, filterProjectId);
      if (checkAccess && typeof checkAccess.then === 'function') checkAccess.catch(next);
      return;
    }
    
    // No specific project - return all accessible layers
    return executeGetCapabilities();
  }

  if (reqType !== "GETTILE") {
    return next();
  }

  const layerId = String(findQ('LAYER') || findQ('Layer') || findQ('layer') || "");
  const tileMatrix = String(findQ('TileMatrix') || findQ('TILEMATRIX') || findQ('tilematrix') || "");
  const tileRow = Number(findQ('TileRow') || findQ('TILEROW') || findQ('tilerow'));
  const tileCol = Number(findQ('TileCol') || findQ('TILECOL') || findQ('tilecol'));

  if (!layerId || !Number.isInteger(tileRow) || !Number.isInteger(tileCol)) {
    return res.status(400).send("Invalid KVP parameters");
  }

  try {
    // Buscar la capa en el inventario
    const inventory = buildWmtsInventory();
    let layerEntry = inventory.layers.find(l => l.identifier === layerId);

    // Fallbacks: aceptar identificadores más cortos o solo el nombre de la capa.
    // Ej: cliente puede enviar `LAYER=orto` mientras que el inventario usa `orto_orto`.
    if (!layerEntry) {
      layerEntry = inventory.layers.find((l) => {
        try {
          if (!l) return false;
          if (String(l.layerName || '').toLowerCase() === String(layerId || '').toLowerCase()) return true;
          if (String(l.layerKey || '').toLowerCase() === String(layerId || '').toLowerCase()) return true;
          // identifier puede ser 'project_layer' — aceptar coincidencia por sufijo
          if (String(l.identifier || '').toLowerCase().endsWith('_' + String(layerId || '').toLowerCase())) return true;
          // o coincidencia por igualdad parcial
          if (String(l.identifier || '').toLowerCase() === String(layerId || '').toLowerCase()) return true;
        } catch (e) {
          return false;
        }
        return false;
      });
    }

    if (!layerEntry) {
      console.warn(`[WMTS-KVP] Layer not found: ${layerId}`);
      return res.status(404).send("Layer not found");
    }

    // --- FIX DEL CRASH: Asegurar que existen projectId y layerName ---
    if (!layerEntry.projectId || !layerEntry.layerName) {
       console.error(`[WMTS-KVP] Invalid inventory entry for ${layerId}`, layerEntry);
       return res.status(500).send("Server configuration error: Invalid layer metadata");
    }

    const projectId = String(layerEntry.projectId); // Forzar string para path.join
    const targetName = layerEntry.storage ? layerEntry.storage.name : layerEntry.layerName;
    const isTheme = layerEntry.storage ? layerEntry.storage.type === 'theme' : false;

    // Verificar acceso al proyecto
    // Normalizar TileMatrix: aceptar formatos como 'EPSG:3006:5' o '3006:5' y tomar la última parte
    let tileMatrixId = String(tileMatrix || '');
    if (tileMatrixId.includes(':')) {
      const parts = tileMatrixId.split(':');
      tileMatrixId = parts[parts.length - 1];
    }

    const checkAccess = security.ensureProjectAccess(req, res, () => {
        let z = tileMatrixId;
        // Ensure reqCol/reqRow exist before any heuristic remapping to avoid TDZ errors
        let reqCol = Number(tileCol);
        let reqRow = Number(tileRow);

        // localizar TileMatrixSet para esta capa (puede venir embebido en layerEntry)
        const tset = layerEntry.tileMatrixSet || inventory.tileMatrixSets.find(tm => String(tm.id) === String(layerEntry.tileMatrixSetId));
        if (!tset || !Array.isArray(tset.matrices)) {
          console.warn(`[WMTS-KVP] TileMatrixSet not available for layer ${layerId}`);
          return res.status(404).send('TileMatrixSet not available');
        }
        let matrixEntry = tset.matrices.find(m => String(m.identifier) === String(z));
        // If exact TileMatrix not found, try heuristics: map requested numeric zoom to nearest available matrix
        if (!matrixEntry) {
          const tryNum = Number(z);
          if (Number.isFinite(tryNum)) {
            const available = tset.matrices.map(m => {
              return { id: String(m.identifier), z: Number(m.identifier), matrixWidth: Number(m.matrixWidth || m.matrix_width || 0), matrixHeight: Number(m.matrixHeight || m.matrix_height || 0) };
            }).filter(a => Number.isFinite(a.z));
            if (available.length > 0) {
              // find nearest matrix by identifier numeric value
              let nearest = available[0];
              let bestDiff = Math.abs(available[0].z - tryNum);
              for (const a of available) {
                const d = Math.abs(a.z - tryNum);
                if (d < bestDiff) { nearest = a; bestDiff = d; }
              }
              // map requested indices to nearest matrix
              const zTarget = nearest.z;
              const factor = Math.pow(2, zTarget - tryNum);
              const mappedCol = Math.max(0, Math.floor(Number(tileCol) * factor));
              const mappedRow = Math.max(0, Math.floor(Number(tileRow) * factor));
              logProjectEvent(projectId, `KVP heuristic: remapping request z=${tryNum},col=${tileCol},row=${tileRow} -> z=${zTarget},col=${mappedCol},row=${mappedRow} (factor=${factor})`);
              // use the target matrixEntry and override requested indices below by setting tileCol/tileRow local vars
              matrixEntry = tset.matrices.find(m => Number(m.identifier) === zTarget);
              // update local tile indices variables for later use
              // we'll shadow tileCol/tileRow via reqCol/reqRow later when constructing filePath
              // store mapped values in local vars for use below
              reqCol = mappedCol;
              reqRow = mappedRow;
              // override z for path building
              z = String(zTarget);
            }
          }
          if (!matrixEntry) {
            console.warn(`[WMTS-KVP] TileMatrix not found for id=${z} layer=${layerId}`);
            return res.status(404).send('TileMatrix not found');
          }
        }

        const matrixWidth = Number(matrixEntry.matrixWidth || matrixEntry.matrix_width || 0);
        const matrixHeight = Number(matrixEntry.matrixHeight || matrixEntry.matrix_height || 0);
        // Validate indices and attempt TMS row flip if out-of-bounds
        if (!Number.isInteger(reqCol) || !Number.isInteger(reqRow) || reqCol < 0 || reqRow < 0) {
          return res.status(400).send('Invalid tile indices');
        }
        if (reqCol > matrixWidth - 1 || reqRow > matrixHeight - 1) {
          // Try flipping row (TMS bottom-left origin -> WMTS top-left)
          const flipped = matrixHeight - 1 - reqRow;
          if (flipped >= 0 && flipped <= matrixHeight - 1) {
            logProjectEvent(projectId, `KVP: flipping TileRow ${reqRow} -> ${flipped} (TMS->WMTS) for layer ${layerId}`);
            reqRow = flipped;
          } else {
            console.warn(`[WMTS-KVP] Tile outside matrix bounds for layer=${layerId} z=${z} col=${reqCol} row=${reqRow} (matrix ${matrixWidth}x${matrixHeight})`);
            return res.status(404).send('Tile outside matrix bounds');
          }
        }

        // Construcción segura de la ruta
        const baseDir = isTheme 
            ? path.join(cacheDir, projectId, "_themes", targetName)
            : path.join(cacheDir, projectId, targetName);

        const filePath = path.join(baseDir, String(z), String(reqCol), `${reqRow}.png`);

        // Verificar existencia o Generar On-Demand
        fs.access(filePath, fs.constants.F_OK, (err) => {
            if (err) {
                // NO EXISTE: Generar y ESPERAR
                const renderParams = { 
                  project: projectId, 
                  [isTheme ? 'theme' : 'layer']: targetName, 
                  z: Number(z), 
                  x: reqCol, 
                  y: reqRow 
                };
                
                logProjectEvent(projectId, `KVP Tile miss (QGIS): ${filePath}. Generating...`);
                
                queueTileRender(renderParams, filePath, (qerr, outFile) => {
                    if (qerr) {
                        logProjectEvent(projectId, `KVP Render failed: ${String(qerr)}`);
                        if (!res.headersSent) res.status(500).send("Generation failed");
                    } else {
                        // Éxito: enviar archivo generado
                        if (!res.headersSent) res.sendFile(outFile);
                    }
                });
            } else {
                // EXISTE: Enviar archivo
                if (!res.headersSent) res.sendFile(filePath);
            }
        });
    }, projectId);

    if (checkAccess && typeof checkAccess.then === 'function') checkAccess.catch(next);

  } catch (e) {
    console.error("[WMTS-KVP] Handler Critical Error", e);
    next(e);
  }
});

// ---------------------------------------------------------
// 2. HANDLER CAPABILITIES: Genera el XML para QGIS (?REQUEST=GetCapabilities)
// ---------------------------------------------------------
app.get("/debug/bootstrap/:project", async (req, res) => {
  const p = req.params.project;
  const proj = findProjectById(p);
  if (!proj) return res.status(404).send("Project not found");
  try {
    const result = await bootstrapProjectCacheIndex(p, proj.file, true);
    res.json({ success: result });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});



// =============================================================================
// WMS SERVICE ENDPOINTS
// =============================================================================

// WMS GetCapabilities and GetMap
app.get("/wms", ensureProjectAccessFromQuery(), (req, res) => {
  const findQ = (name) => {
    const low = name.toLowerCase();
    for (const k of Object.keys(req.query || {})) {
      if (k.toLowerCase() === low) return req.query[k];
    }
    return undefined;
  };

  const service = String(findQ('SERVICE') || findQ('service') || "").toUpperCase();
  const request = String(findQ('REQUEST') || findQ('request') || "").toUpperCase();

  if (service !== "WMS") {
    return res.status(400).json({ error: "unsupported_service", details: "Use SERVICE=WMS" });
  }

  if (request === "GETCAPABILITIES") {
    return handleWmsGetCapabilities(req, res);
  } else if (request === "GETMAP") {
    return handleWmsGetMap(req, res);
  } else {
    return res.status(400).json({ error: "unsupported_request", details: "Use REQUEST=GetCapabilities or GetMap" });
  }
});

// WMS GetCapabilities Handler
function handleWmsGetCapabilities(req, res) {
  try {
    const filterProjectRaw = req.query.project != null ? String(req.query.project).trim() : "";
    const filterProjectId = filterProjectRaw ? filterProjectRaw.replace(/[^a-zA-Z0-9-_]/g, "").toLowerCase() : "";

    const inventory = buildWmtsInventory(filterProjectId ? { filterProjectId } : {});
    const { layers } = inventory;

    const xmlEscape = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const formatNumber = (value) => {
      const num = Number(value);
      if (!Number.isFinite(num)) return "0";
      return num.toString();
    };

    const baseUrl = `http://${req.get('host') || 'localhost:3000'}`;
    const wmsUrl = filterProjectId 
      ? `${baseUrl}/wms?project=${encodeURIComponent(filterProjectId)}`
      : `${baseUrl}/wms`;

    const xmlParts = [];
    xmlParts.push('<?xml version="1.0" encoding="UTF-8"?>');
    xmlParts.push('<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.opengis.net/wms http://schemas.opengis.net/wms/1.3.0/capabilities_1_3_0.xsd">');
    
    // Service
    xmlParts.push('<Service>');
    xmlParts.push('<Name>WMS</Name>');
    xmlParts.push('<Title>Qtiler WMS Service</Title>');
    xmlParts.push('<Abstract>Tiled WMS service powered by Qtiler</Abstract>');
    xmlParts.push('<OnlineResource xlink:type="simple" xlink:href="' + xmlEscape(baseUrl) + '"/>');
    xmlParts.push('</Service>');

    // Capability
    xmlParts.push('<Capability>');
    xmlParts.push('<Request>');
    xmlParts.push('<GetCapabilities>');
    xmlParts.push('<Format>text/xml</Format>');
    xmlParts.push('<DCPType><HTTP><Get><OnlineResource xlink:type="simple" xlink:href="' + xmlEscape(wmsUrl) + '"/></Get></HTTP></DCPType>');
    xmlParts.push('</GetCapabilities>');
    xmlParts.push('<GetMap>');
    xmlParts.push('<Format>image/png</Format>');
    xmlParts.push('<DCPType><HTTP><Get><OnlineResource xlink:type="simple" xlink:href="' + xmlEscape(wmsUrl) + '"/></Get></HTTP></DCPType>');
    xmlParts.push('</GetMap>');
    xmlParts.push('</Request>');

    // Parent Layer (queryable container)
    xmlParts.push('<Layer queryable="1">');
    xmlParts.push('<Title>Qtiler Layers</Title>');
    
    // Add CRS to parent layer
    xmlParts.push('<CRS>CRS:84</CRS>');
    xmlParts.push('<CRS>EPSG:4326</CRS>');
    xmlParts.push('<CRS>EPSG:3857</CRS>');
    xmlParts.push('<CRS>EPSG:3006</CRS>');

    for (const layer of layers) {
      const crs = layer.tileCrs || 'EPSG:3857';
      const extent = layer.extent || [-20037508.34, -20037508.34, 20037508.34, 20037508.34];
      const extentWgs = layer.extentWgs || [-180, -85, 180, 85];

      xmlParts.push('<Layer queryable="1">');
      xmlParts.push('<Name>' + xmlEscape(layer.identifier) + '</Name>');
      xmlParts.push('<Title>' + xmlEscape(layer.displayTitle || layer.identifier) + '</Title>');
      
      // CRS - add more common CRS
      xmlParts.push('<CRS>CRS:84</CRS>');
      xmlParts.push('<CRS>EPSG:4326</CRS>');
      xmlParts.push('<CRS>EPSG:3857</CRS>');
      xmlParts.push('<CRS>' + xmlEscape(crs) + '</CRS>');

      // EX_GeographicBoundingBox (WGS84 - always lon/lat order)
      xmlParts.push('<EX_GeographicBoundingBox>');
      xmlParts.push('<westBoundLongitude>' + formatNumber(extentWgs[0]) + '</westBoundLongitude>');
      xmlParts.push('<eastBoundLongitude>' + formatNumber(extentWgs[2]) + '</eastBoundLongitude>');
      xmlParts.push('<southBoundLatitude>' + formatNumber(extentWgs[1]) + '</southBoundLatitude>');
      xmlParts.push('<northBoundLatitude>' + formatNumber(extentWgs[3]) + '</northBoundLatitude>');
      xmlParts.push('</EX_GeographicBoundingBox>');

      // BoundingBox in native CRS (WMS 1.3.0 format)
      // For EPSG:3006 and similar CRS with northing/easting, use miny/minx/maxy/maxx order
      if (crs === 'EPSG:3006' || crs === 'EPSG:3010' || crs === 'EPSG:3011') {
        xmlParts.push('<BoundingBox CRS="' + xmlEscape(crs) + '" miny="' + formatNumber(extent[0]) + '" minx="' + formatNumber(extent[1]) + '" maxy="' + formatNumber(extent[2]) + '" maxx="' + formatNumber(extent[3]) + '"/>');
      } else {
        xmlParts.push('<BoundingBox CRS="' + xmlEscape(crs) + '" minx="' + formatNumber(extent[0]) + '" miny="' + formatNumber(extent[1]) + '" maxx="' + formatNumber(extent[2]) + '" maxy="' + formatNumber(extent[3]) + '"/>');
      }
      
      // Also add EPSG:3857 bounding box for web mercator clients
      if (crs !== 'EPSG:3857') {
        xmlParts.push('<BoundingBox CRS="EPSG:3857" minx="-20037508.34" miny="-20037508.34" maxx="20037508.34" maxy="20037508.34"/>');
      }
      
      // EPSG:4326 bounding box (lat/lon order for WMS 1.3.0)
      xmlParts.push('<BoundingBox CRS="EPSG:4326" miny="' + formatNumber(extentWgs[0]) + '" minx="' + formatNumber(extentWgs[1]) + '" maxy="' + formatNumber(extentWgs[2]) + '" maxx="' + formatNumber(extentWgs[3]) + '"/>');
      
      xmlParts.push('<EX_GeographicBoundingBox>');
      xmlParts.push('<westBoundLongitude>' + formatNumber(extentWgs[0]) + '</westBoundLongitude>');
      xmlParts.push('<eastBoundLongitude>' + formatNumber(extentWgs[2]) + '</eastBoundLongitude>');
      xmlParts.push('<southBoundLatitude>' + formatNumber(extentWgs[1]) + '</southBoundLatitude>');
      xmlParts.push('<northBoundLatitude>' + formatNumber(extentWgs[3]) + '</northBoundLatitude>');
      xmlParts.push('</EX_GeographicBoundingBox>');

      // Styles
      xmlParts.push('<Style>');
      xmlParts.push('<Name>default</Name>');
      xmlParts.push('<Title>Default</Title>');
      xmlParts.push('</Style>');

      xmlParts.push('</Layer>');
    }

    xmlParts.push('</Layer>');
    xmlParts.push('</Capability>');
    xmlParts.push('</WMS_Capabilities>');

    res.setHeader("Content-Type", "application/xml");
    return res.send(xmlParts.join(""));
  } catch (error) {
    console.error("WMS GetCapabilities error", error);
    return res.status(500).json({ error: "wms_capabilities_failed", details: String(error) });
  }
}

// WMS GetMap Handler (returns tile from cache or triggers on-demand rendering)
async function handleWmsGetMap(req, res) {
  try {
    const findQ = (name) => {
      const low = name.toLowerCase();
      for (const k of Object.keys(req.query || {})) {
        if (k.toLowerCase() === low) return req.query[k];
      }
      return undefined;
    };

    const layers = String(findQ('LAYERS') || findQ('layers') || "");
    const bbox = String(findQ('BBOX') || findQ('bbox') || "");
    const width = parseInt(findQ('WIDTH') || findQ('width') || "256", 10);
    const height = parseInt(findQ('HEIGHT') || findQ('height') || "256", 10);
    const crs = String(findQ('CRS') || findQ('crs') || findQ('SRS') || findQ('srs') || "EPSG:3857");
    const format = String(findQ('FORMAT') || findQ('format') || "image/png");

    if (!layers) {
      return res.status(400).json({ error: "missing_layers", details: "LAYERS parameter required" });
    }

    if (!bbox) {
      return res.status(400).json({ error: "missing_bbox", details: "BBOX parameter required" });
    }

    // Parse bbox
    const bboxParts = bbox.split(',').map(v => parseFloat(v));
    if (bboxParts.length !== 4 || bboxParts.some(v => !Number.isFinite(v))) {
      return res.status(400).json({ error: "invalid_bbox", details: "BBOX must be minx,miny,maxx,maxy" });
    }
    const [minx, miny, maxx, maxy] = bboxParts;

    // Parse layer identifier to get project and layer
    const layerParts = layers.split('_');
    if (layerParts.length < 2) {
      return res.status(400).json({ error: "invalid_layer", details: "Layer format should be project_layer" });
    }

    const project = layerParts[0];
    const layerIdentifier = layerParts.slice(1).join('_');

    // Load project index to get tile matrix info
    const projectDir = path.join(cacheDir, project);
    const indexPath = path.join(projectDir, 'index.json');
    
    let indexData;
    try {
      const indexContent = await fs.promises.readFile(indexPath, 'utf-8');
      indexData = JSON.parse(indexContent);
    } catch (err) {
      return res.status(404).json({ error: "project_not_found", details: `Project ${project} not found` });
    }

    // Find the layer by identifier or by normalizing the name
    let layerInfo = indexData.layers?.find(l => l.name === layerIdentifier);
    if (!layerInfo) {
      // Try to find by normalizing layer names (spaces to underscores)
      layerInfo = indexData.layers?.find(l => {
        const normalizedName = l.name?.replace(/\s+/g, '_');
        return normalizedName === layerIdentifier;
      });
    }
    if (!layerInfo) {
      return res.status(404).json({ error: "layer_not_found", details: `Layer ${layerIdentifier} not found in project ${project}` });
    }

    // Use the actual layer name (with spaces) for file paths
    const layer = layerInfo.name;

    // Get tile matrix set
    const tileMatrixSet = indexData.tile_matrix_set;
    if (!tileMatrixSet || !Array.isArray(tileMatrixSet.matrices)) {
      return res.status(500).json({ error: "invalid_tile_matrix", details: "Tile matrix set not found" });
    }

    // Calculate which zoom level best matches the request resolution
    const bboxWidth = maxx - minx;
    const bboxHeight = maxy - miny;
    const requestedResX = bboxWidth / width;
    const requestedResY = bboxHeight / height;
    const requestedRes = Math.max(requestedResX, requestedResY);

    // Find closest zoom level
    let bestZoom = 0;
    let bestResDiff = Infinity;
    for (const matrix of tileMatrixSet.matrices) {
      const res = matrix.resolution || matrix.scaleDenominator * 0.00028;
      const diff = Math.abs(res - requestedRes);
      if (diff < bestResDiff) {
        bestResDiff = diff;
        bestZoom = matrix.zoom || matrix.identifier;
      }
    }

    const matrix = tileMatrixSet.matrices.find(m => (m.zoom || m.identifier) === bestZoom);
    if (!matrix) {
      return res.status(500).json({ error: "matrix_not_found", details: `Matrix for zoom ${bestZoom} not found` });
    }

    // Get tile matrix info
    const tileWidth = matrix.tile_width || 256;
    const tileHeight = matrix.tile_height || 256;
    const matrixWidth = matrix.matrix_width;
    const matrixHeight = matrix.matrix_height;
    const resolution = matrix.resolution || matrix.scaleDenominator * 0.00028;
    
    // Get top-left corner
    let topLeftX, topLeftY;
    if (matrix.top_left_corner) {
      topLeftX = matrix.top_left_corner[0];
      topLeftY = matrix.top_left_corner[1];
    } else if (matrix.topLeftCorner) {
      topLeftX = matrix.topLeftCorner[0];
      topLeftY = matrix.topLeftCorner[1];
    } else {
      topLeftX = tileMatrixSet.extent[0];
      topLeftY = tileMatrixSet.extent[3];
    }

    // Calculate tile coordinates for bbox center
    const centerX = (minx + maxx) / 2;
    const centerY = (miny + maxy) / 2;
    
    const tileX = Math.floor((centerX - topLeftX) / (tileWidth * resolution));
    const tileY = Math.floor((topLeftY - centerY) / (tileHeight * resolution));

    // Clamp to valid range
    const clampedX = Math.max(0, Math.min(tileX, matrixWidth - 1));
    const clampedY = Math.max(0, Math.min(tileY, matrixHeight - 1));

    // Redirect to tile endpoint (which handles on-demand rendering)
    const tileUrl = `/wmts/${project}/${layer}/${bestZoom}/${clampedX}/${clampedY}.png`;
    
    // Instead of redirect, proxy the request to maintain WMS compatibility
    return res.redirect(tileUrl);

  } catch (error) {
    console.error("WMS GetMap error", error);
    return res.status(500).json({ error: "wms_getmap_failed", details: String(error) });
  }
}

const startServer = async () => {
  try {
    await pluginManager.init();
  } catch (err) {
    console.error('Plugin initialization failed', err);
  }
  initializeProjectSchedules();
  startScheduleHeartbeat();
  const server = app.listen(3000, () => console.log("🚀 Servidor Node.js en http://localhost:3000"));
  // Increase timeout for tile rendering requests (default is 2 minutes)
  server.timeout = 300000; // 5 minutes
  server.keepAliveTimeout = 310000; // Slightly longer than timeout
  server.headersTimeout = 320000; // Slightly longer than keepAliveTimeout
};

startServer().catch((err) => {
  console.error('Failed to start server', err);
  process.exitCode = 1;
});
