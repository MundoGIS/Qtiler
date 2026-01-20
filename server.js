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
import cluster from "cluster";
import { execFile, spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { PythonPool } from './lib/PythonPool.js';
import { sanitizeProjectId, sanitizePluginName } from "./lib/sanitize.js";
import { resolvePluginRoot, detectPluginName } from "./lib/pluginArchiveUtils.js";
import { copyRecursive, removeRecursive } from "./lib/fsRecursive.js";
import { allowedProjectExtensions, createProjectUpload, createPluginUpload } from "./lib/uploads.js";
import { registerUiRoutes } from "./routes/ui.js";
import { registerProj4Routes } from "./routes/proj4.js";
import { registerPluginRoutes } from "./routes/plugins.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerWmsRoutes } from "./routes/wms.js";
import { registerWfsRoutes } from "./routes/wfs.js";
import { registerOrigoRoutes } from "./routes/origo.js";


dotenv.config();
// Verificación automática de entorno QGIS/Python
function verifyQGISEnv() {
  const qgisBin = process.env.OSGEO4W_BIN || null;
  const pythonExe = process.env.PYTHON_EXE || null;
  const qgisPrefix = process.env.QGIS_PREFIX || null;
    let missing = [];
    let projExtent = null;
    let projExtentCrs = null;
  if (!qgisBin || !fs.existsSync(qgisBin)) missing.push("OSGEO4W_BIN");
  if (!pythonExe || !fs.existsSync(pythonExe)) missing.push("PYTHON_EXE");
  if (!qgisPrefix || !fs.existsSync(qgisPrefix)) missing.push("QGIS_PREFIX");
  if (missing.length) {
    console.warn("[Qtiler] Entorno QGIS/Python incompleto. Faltan:", missing.join(", "));
    console.warn("Configura manualmente las rutas en .env (OSGEO4W_BIN, PYTHON_EXE, QGIS_PREFIX) antes de generar cachés.");
  } else {
    console.log("[Qtiler] Entorno QGIS/Python verificado.");
  }
}
verifyQGISEnv();
import crypto from "crypto";
import AdmZip from "adm-zip";

import cookieParser from "cookie-parser";
 //ort { spawnSync } from 'child_process';
import { PluginManager } from "./lib/pluginManager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", true);

// Cache-buster for static assets. Helps avoid stale JS in browsers/proxies (e.g. IIS reverse proxy).
// Changes on each server start unless QTILER_ASSET_VERSION is provided.
app.locals.assetVersion = process.env.QTILER_ASSET_VERSION || String(Date.now());
const dataDir = path.resolve(__dirname, "data");
const pluginsDir = path.resolve(__dirname, "plugins");
const viewsDir = path.resolve(__dirname, "views");
const proj4PresetsPath = path.resolve(__dirname, "config", "proj4-presets.json");

const defaultProj4Presets = {
  // Ensure common Swedish tile CRS is available by default so client transforms work
  "EPSG:3006": "+proj=tmerc +lat_0=0 +lon_0=15 +k=0.9996 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs"
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

let proj4Presets = loadProj4Presets();

const normalizeEpsgKey = (code) => {
  if (!code) return null;
  const s = String(code).trim();
  if (!s) return null;
  const m = s.match(/(\d+)$/);
  const n = m ? m[1] : s;
  return `EPSG:${n}`.toUpperCase();
};

const fetchProj4FromEpsgIo = async (code) => {
  try {
    const num = String(code).replace(/[^0-9]/g, '');
    if (!num) return null;
    const url = `https://epsg.io/${encodeURIComponent(num)}.proj4`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return null;
    const text = await res.text();
    const cleaned = String(text).trim();
    if (!cleaned) return null;
    return cleaned;
  } catch (err) {
    console.warn('Failed to fetch proj4 from epsg.io', code, err?.message || err);
    return null;
  }
};

const ensureServerProj4Def = async (code) => {
  const key = normalizeEpsgKey(code);
  if (!key) return null;
  if (proj4Presets && proj4Presets[key]) return proj4Presets[key];
  // try fetching from epsg.io
  const def = await fetchProj4FromEpsgIo(key);
  if (!def) return null;
  try {
    // persist to config/proj4-presets.json (merge)
    let existing = {};
    try {
      const raw = fs.readFileSync(proj4PresetsPath, 'utf-8');
      existing = JSON.parse(raw) || {};
    } catch (err) {
      existing = {};
    }
    existing[key] = def;
    try {
      fs.writeFileSync(proj4PresetsPath, JSON.stringify(existing, null, 2), 'utf-8');
    } catch (err) {
      console.warn('Failed to write proj4 presets file', err?.message || err);
    }
    // update runtime cache
    proj4Presets = { ...(proj4Presets || {}), [key]: def };
  } catch (err) {
    console.warn('Failed to persist proj4 def', key, err?.message || err);
  }
  return def;
};

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
    const authEnabled = !!(security.isEnabled && security.isEnabled());
    if (!authEnabled) {
      return next();
    }

    // Fast-path: if our access snapshot says the request is allowed (public/assigned/admin),
    // let it through even when the auth plugin would otherwise reject unauthenticated users.
    try {
      const snapshot = readProjectAccessSnapshot();
      const accessInfo = deriveProjectAccess(snapshot, req.user || null, projectId);
      if (accessInfo && accessInfo.allowed === true) {
        return next();
      }
    } catch {
      // fall through to plugin enforcement
    }

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
    authEnabled: typeof security.isEnabled === 'function' ? security.isEnabled() : false,
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
// WFS-T Transaction uses XML payloads; parse them as raw text.
app.use(
  "/wfs",
  express.text({
    type: [
      "application/xml",
      "text/xml",
      "application/*+xml",
      "application/gml+xml",
      "application/ogc+xml",
      // QGIS WFS can POST KVP bodies (form-encoded) for GetFeature etc.
      "application/x-www-form-urlencoded",
      "text/plain"
    ],
    limit: "10mb"
  })
);
app.use(cookieParser());
app.use((req, res, next) => security.attachUser(req, res, next));

// If the auth plugin is not enabled, proactively clear any lingering auth cookie.
// This prevents clients from appearing "logged in" after uninstall and avoids
// reusing stale tokens if the auth plugin is reinstalled later.
app.use((req, res, next) => {
  try {
    if (typeof security.isEnabled === "function" && !security.isEnabled()) {
      if (req.cookies && req.cookies.qtiler_token) {
        res.clearCookie("qtiler_token", {
          httpOnly: true,
          sameSite: "lax",
          secure: !!req.secure
        });
      }
    }
  } catch {
    // ignore
  }
  next();
});

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

registerUiRoutes({
  app,
  security,
  renderPage,
  sendLoginPage,
  sendAccessDenied,
  requireAdminPage,
  authPluginInstallUrl,
  publicDir,
  pluginsDir
});

registerProj4Routes({
  app,
  normalizeEpsgKey,
  ensureServerProj4Def,
  getProj4Presets: () => proj4Presets
});

registerOrigoRoutes({
  app,
  publicDir
});

app.use(express.static(publicDir, { index: false }));

// Plugin routes are registered after upload middleware initialization.

const cacheDir = path.resolve(__dirname, "cache");
const pythonDir = path.resolve(__dirname, "python");
const projectsDir = path.resolve(__dirname, "qgisprojects");
const logsDir = path.resolve(__dirname, "logs");
const uploadTempDir = path.resolve(__dirname, "temp_uploads");

const defaultUploadLimit = parseInt(process.env.PROJECT_UPLOAD_MAX_BYTES || "10737418240", 10); // 10 GiB por defecto
const projectUpload = createProjectUpload({ uploadTempDir, maxBytes: defaultUploadLimit });

const defaultPluginUploadLimit = parseInt(process.env.PLUGIN_UPLOAD_MAX_BYTES || "52428800", 10);
const pluginUpload = createPluginUpload({ uploadTempDir, maxBytes: defaultPluginUploadLimit });

registerPluginRoutes({
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

const safePathSegment = (value, { fallback = 'x' } = {}) => {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const cleaned = raw
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
  return cleaned || fallback;
};

const limitScheduleHistory = (history) => {
  if (!Array.isArray(history)) return [];
  const trimmed = history.slice(-SCHEDULE_HISTORY_LIMIT);
  return trimmed;
};

const redactSecrets = (value) => {
  const input = value == null ? "" : String(value);
  if (!input) return "";
  let out = input;
  // Common key-value patterns
  out = out.replace(/(\b(password|passwd|pwd)\s*[=:]\s*)([^\s&;\r\n]+)/gi, "$1***");
  out = out.replace(/(\b(api[_-]?key|token|access[_-]?token)\s*[=:]\s*)([^\s&;\r\n]+)/gi, "$1***");
  // Quoted patterns (password '...')
  out = out.replace(/(\b(password|passwd|pwd)\b[^'\"]*['\"])([^'\"]+)(['\"])/gi, "$1***$4");
  // URL basic-auth: scheme://user:pass@
  out = out.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^:\s\/]+:)([^@\s\/]+)(@)/gi, "$1***$3");
  return out;
};

const logProjectEvent = (projectId, message, level = "info") => {
  if (!projectId || !message) return;
  const safeMessage = redactSecrets(message);
  const line = `[${new Date().toISOString()}][${level.toUpperCase()}] ${safeMessage}\n`;
  const last = projectLogLastMessage.get(projectId);
  if (last === safeMessage) return;
  projectLogLastMessage.set(projectId, safeMessage);
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

const readJsonFile = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw || !raw.trim()) return null;
  return JSON.parse(raw);
};

const readJsonFileWithBackup = (filePath) => {
  const backupPath = `${filePath}.bak`;
  try {
    const primary = readJsonFile(filePath);
    if (primary != null) return primary;
  } catch (err) {
    try {
      const backup = readJsonFile(backupPath);
      if (backup != null) {
        console.warn("[json] Primary JSON unreadable; using backup", { filePath, backupPath, error: err?.message || err });
        return backup;
      }
    } catch (backupErr) {
      console.warn("[json] Primary+backup unreadable", { filePath, backupPath, error: backupErr?.message || backupErr });
    }
    throw err;
  }

  // Primary missing/empty: this can happen during atomic swaps.
  try {
    const backup = readJsonFile(backupPath);
    if (backup != null) {
      return backup;
    }
  } catch {
    // ignore
  }
  return null;
};

const writeFileAtomicWithBackup = (filePath, content) => {
  if (!filePath) throw new Error("writeFileAtomicWithBackup: missing filePath");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const backupPath = `${filePath}.bak`;
  fs.writeFileSync(tempPath, content, "utf8");
  try {
    if (fs.existsSync(backupPath)) {
      try { fs.rmSync(backupPath, { force: true }); } catch { }
    }
    if (fs.existsSync(filePath)) {
      try {
        fs.renameSync(filePath, backupPath);
      } catch {
        // If rename fails (file in use), fall back to copy.
        try { fs.copyFileSync(filePath, backupPath); } catch { }
      }
    }
  } catch {
    // best-effort backup
  }
  try {
    if (fs.existsSync(filePath)) {
      try { fs.rmSync(filePath, { force: true }); } catch { }
    }
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) {
      try { fs.rmSync(tempPath, { force: true }); } catch { }
    }
  }
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
  try {
    const parsed = readJsonFileWithBackup(indexPath);
    if (parsed) return parsed;
    return {
      project: null,
      id: projectId,
      created: new Date().toISOString(),
      layers: []
    };
  } catch (err) {
    console.warn("Failed to read index for", projectId, err);
    return { project: null, id: projectId, layers: [] };
  }
};

const writeProjectIndexData = (projectId, data) => {
  const indexPath = getProjectIndexPath(projectId);
  writeFileAtomicWithBackup(indexPath, JSON.stringify(data, null, 2));
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

const hasAnyTileFiles = (baseDir) => {
  if (!baseDir || typeof baseDir !== 'string') return false;
  if (!fs.existsSync(baseDir)) return false;
  const imageExtRe = /\.(png|jpe?g|webp)$/i;
  try {
    const zEntries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const zEnt of zEntries) {
      if (!zEnt.isDirectory()) continue;
      if (!/^\d+$/.test(zEnt.name)) continue;
      const zPath = path.join(baseDir, zEnt.name);
      let xEntries;
      try {
        xEntries = fs.readdirSync(zPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const xEnt of xEntries) {
        if (!xEnt.isDirectory()) continue;
        if (!/^\d+$/.test(xEnt.name)) continue;
        const xPath = path.join(zPath, xEnt.name);
        let yEntries;
        try {
          yEntries = fs.readdirSync(xPath, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const yEnt of yEntries) {
          if (!yEnt.isFile()) continue;
          if (imageExtRe.test(yEnt.name)) return true;
        }
      }
    }
  } catch {
    return false;
  }
  return false;
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
  try {
    const parsed = readJsonFileWithBackup(configPath);
    if (parsed) {
      config = deepMerge({ ...defaults }, parsed || {});
      config.projectId = projectId;
      if (!config.createdAt) config.createdAt = config.updatedAt || new Date().toISOString();
    }
  } catch (err) {
    console.error("Failed to read project config", projectId, err);
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
  try {
    console.log(`[writeProjectConfig] writing project config for ${projectId} -> ${configPath} (size=${String(JSON.stringify(merged).length)} bytes)`);
  } catch (e) {
    // ignore logging errors
  }
  writeFileAtomicWithBackup(configPath, JSON.stringify(merged, null, 2));
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

  // Bundle projects: qgisprojects/<projectId>/.../<something>.qgz|.qgs
  try {
    const folder = path.join(projectsDir, normalizedId);
    if (fs.existsSync(folder)) {
      const stat = fs.statSync(folder);
      if (stat.isDirectory()) {
        const matches = [];
        const stack = [folder];
        const folderResolved = path.resolve(folder);
        const folderLower = folderResolved.toLowerCase();
        let scanned = 0;
        const MAX_SCAN = 2000;

        while (stack.length) {
          const current = stack.pop();
          scanned += 1;
          if (scanned > MAX_SCAN) break;
          let listing;
          try {
            listing = fs.readdirSync(current, { withFileTypes: true });
          } catch {
            continue;
          }
          for (const ent of listing) {
            if (!ent) continue;
            const fullPath = path.join(current, ent.name);
            const fullResolved = path.resolve(fullPath);
            if (!fullResolved.toLowerCase().startsWith(folderLower + path.sep)) {
              continue;
            }
            if (ent.isDirectory()) {
              if (ent.name === 'node_modules' || ent.name === '.git') continue;
              stack.push(fullPath);
            } else if (ent.isFile()) {
              const lower = ent.name.toLowerCase();
              if (lower.endsWith('.qgz') || lower.endsWith('.qgs')) {
                matches.push(fullPath);
                if (matches.length > 1) {
                  console.warn(`Multiple project files found under ${folderResolved}; cannot resolve uniquely.`);
                  return null;
                }
              }
            }
          }
        }
        if (matches.length === 1) return matches[0];
      }
    }
  } catch (err) {
    console.warn('Failed to resolve bundle project path', { projectId, error: err?.message || err });
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

      // WFS: allow admins to toggle editability per vector layer.
      if (typeof info.wfsEditable === "boolean") layerPatch.wfsEditable = info.wfsEditable;
      
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

const buildScheduledFallbackParams = (projectId, targetMode, targetName, config, { zoomMin = null, zoomMax = null } = {}) => {
  if (!projectId || !targetName) return null;
  const cfg = config && typeof config === 'object' ? config : readProjectConfig(projectId, { useCache: false });
  const prefs = cfg?.cachePreferences || {};
  const out = {};

  const resolvedZoomMin = Number.isFinite(Number(zoomMin)) ? Math.floor(Number(zoomMin)) : (Number.isFinite(Number(cfg?.zoom?.min)) ? Math.floor(Number(cfg.zoom.min)) : null);
  const resolvedZoomMax = Number.isFinite(Number(zoomMax)) ? Math.floor(Number(zoomMax)) : (Number.isFinite(Number(cfg?.zoom?.max)) ? Math.floor(Number(cfg.zoom.max)) : null);
  if (resolvedZoomMin == null || resolvedZoomMax == null) {
    return null;
  }
  out.zoom_min = resolvedZoomMin;
  out.zoom_max = Math.max(resolvedZoomMax, resolvedZoomMin);

  // Extent
  const bbox = Array.isArray(cfg?.extent?.bbox) && cfg.extent.bbox.length === 4 ? cfg.extent.bbox : null;
  if (bbox && bbox.every((n) => Number.isFinite(Number(n)))) {
    out.project_extent = `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`;
    if (cfg?.extent?.crs) out.extent_crs = cfg.extent.crs;
  }

  // Basic options
  out.allow_remote = prefs.allowRemote === true;
  if (Number.isFinite(Number(prefs.throttleMs)) && Number(prefs.throttleMs) > 0) {
    out.throttle_ms = Math.floor(Number(prefs.throttleMs));
  }
  out.xyz_mode = 'partial';

  // Use index.json to capture CRS/preset when available.
  let indexEntry = null;
  try {
    const indexData = loadProjectIndexData(projectId);
    const layers = Array.isArray(indexData?.layers) ? indexData.layers : [];
    indexEntry = layers.find((e) => e && e.name === targetName && (e.kind || 'layer') === targetMode) || null;
  } catch {
    indexEntry = null;
  }

  const normalizedTileCrs = (() => {
    const candidates = [
      indexEntry?.tile_crs,
      indexEntry?.crs,
      prefs.tileCrs,
      prefs.tile_crs,
      detectProjectCrs(projectId)
    ];
    for (const c of candidates) {
      if (typeof c !== 'string') continue;
      const t = c.trim();
      if (t) return t.toUpperCase();
    }
    return null;
  })();
  if (normalizedTileCrs) {
    out.tile_crs = normalizedTileCrs;
  }

  const presetFromIndex = typeof indexEntry?.tile_matrix_preset === 'string' ? indexEntry.tile_matrix_preset.trim() : '';
  const derivedPreset = (!presetFromIndex && normalizedTileCrs) ? (deriveTileMatrixInfoForCrs(normalizedTileCrs)?.presetId || '') : '';
  const effectivePreset = presetFromIndex || derivedPreset;
  if (effectivePreset) {
    out.tile_matrix_preset = effectivePreset;
    out.wmts = true;
  }

  // Scheme note: generate_cache.py only accepts {auto, xyz, custom}. WMTS is enabled via --wmts + preset.
  // Respect cachePreferences.mode when set, otherwise infer from CRS.
  const prefMode = typeof prefs.mode === 'string' ? prefs.mode.trim().toLowerCase() : '';
  if (prefMode === 'xyz') {
    out.scheme = 'xyz';
  } else if (prefMode === 'wmts') {
    out.scheme = 'custom';
    out.wmts = true;
  } else if (normalizedTileCrs) {
    out.scheme = normalizedTileCrs === 'EPSG:3857' ? 'xyz' : 'custom';
    if (out.scheme === 'custom') out.wmts = true;
  } else {
    out.scheme = 'auto';
  }

  return out;
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

  let effectiveLastParams = layerEntry.lastParams && typeof layerEntry.lastParams === "object" ? layerEntry.lastParams : null;
  if (!effectiveLastParams) {
    effectiveLastParams = buildScheduledFallbackParams(projectId, 'layer', layerName, currentConfig, {
      zoomMin: scheduleMin,
      zoomMax: scheduleMax
    });
  }
  if (!effectiveLastParams || typeof effectiveLastParams !== 'object') {
    const message = "Skipped automatic recache: no parameters recorded";
    appendHistory("skipped", message);
    logProjectEvent(projectId, `Scheduled recache skipped for ${layerName}: ${message}`, "warn");
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
    const params = { ...effectiveLastParams, project: projectId, layer: layerName };
    params.project = projectId;
    params.layer = layerName;
    params.run_reason = "scheduled-layer";
    params.trigger = "timer";
    params.batch_total = 1;
    params.batch_index = 0;
    if (scheduleMin != null) params.zoom_min = scheduleMin;
    if (scheduleMax != null) params.zoom_max = scheduleMax;

    // If the project allows remote providers, enforce allow_remote for scheduled runs.
    // (generate_cache.py rejects remote WMS/WMTS/XYZ unless allow_remote is enabled.)
    const projectAllowsRemote = currentConfig?.cachePreferences?.allowRemote === true;
    if (projectAllowsRemote && params.allow_remote !== true) {
      params.allow_remote = true;
    }

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
        lastParams: effectiveLastParams,
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

  let effectiveLastParams = themeEntry.lastParams && typeof themeEntry.lastParams === "object" ? themeEntry.lastParams : null;
  if (!effectiveLastParams) {
    effectiveLastParams = buildScheduledFallbackParams(projectId, 'theme', themeName, currentConfig, {
      zoomMin: scheduleMin,
      zoomMax: scheduleMax
    });
  }
  if (!effectiveLastParams || typeof effectiveLastParams !== 'object') {
    const message = "Skipped automatic recache: no parameters recorded";
    appendHistory("skipped", message);
    logProjectEvent(projectId, `Scheduled recache skipped for theme ${themeName}: ${message}`, "warn");
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
    const params = { ...effectiveLastParams, project: projectId, theme: themeName };
    params.project = projectId;
    params.theme = themeName;
    params.run_reason = "scheduled-theme";
    params.trigger = "timer";
    params.batch_total = 1;
    params.batch_index = 0;
    if (scheduleMin != null) params.zoom_min = scheduleMin;
    if (scheduleMax != null) params.zoom_max = scheduleMax;

    const projectAllowsRemote = currentConfig?.cachePreferences?.allowRemote === true;
    if (projectAllowsRemote && params.allow_remote !== true) {
      params.allow_remote = true;
    }

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
        lastParams: effectiveLastParams,
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
    if ((payload.zoom_min === undefined || payload.zoom_min === null) && config.zoom && config.zoom.min != null) payload.zoom_min = config.zoom.min;
    if ((payload.zoom_max === undefined || payload.zoom_max === null) && config.zoom && config.zoom.max != null) payload.zoom_max = config.zoom.max;
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
        const status = (result && result.status) ? String(result.status) : "unknown";
        const exitCode = (result && (result.exitCode ?? result.exit_code)) != null ? (result.exitCode ?? result.exit_code) : null;
        const stderrTail = typeof result?.stderr === "string" ? result.stderr.trim() : "";
        const stdoutTail = typeof result?.stdout === "string" ? result.stdout.trim() : "";
        const tailLines = (text) => {
          if (!text) return "";
          return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-8).join(" | ");
        };
        const detail = tailLines(stderrTail) || tailLines(stdoutTail) || "";
        const msg = `Recache job for ${layerName} ended with status ${status}`
          + (exitCode != null ? ` (exit ${exitCode})` : "")
          + (detail ? `: ${detail}` : "");
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
  const sleepLocal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const listJobPidFiles = () => {
    try {
      return fs.readdirSync(jobPidDir).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
  };

  const readJobPidMeta = (jobId) => {
    try {
      const p = jobPidPathFor(jobId);
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  };

  const findJobIdsForLayerTarget = (projectParam, layerParam) => {
    const ids = new Set();
    for (const [jid, job] of runningJobs.entries()) {
      if (!job || job.status !== 'running') continue;
      if (job.project === projectParam && job.layer === layerParam) ids.add(jid);
    }
    for (const f of listJobPidFiles()) {
      try {
        const raw = fs.readFileSync(path.join(jobPidDir, f), 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.id) continue;
        if (parsed.project === projectParam && parsed.layer === layerParam) ids.add(String(parsed.id));
      } catch {
        // ignore per-file errors
      }
    }
    return Array.from(ids);
  };

  const forceAbortGenerateCacheJob = async (jobId, { silent: silentAbort = false } = {}) => {
    const jobSpecificPids = () => {
      try { return findProcessPidsByCommandLineAll(['generate_cache.py', String(jobId)]) || []; } catch { return []; }
    };

    const killPidTreeWin32 = (pid) => {
      if (!pid || process.platform !== 'win32') return;
      try {
        const tk = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: true, timeout: 7000 });
        if (!silentAbort) {
          if (tk?.stdout) console.log(`taskkill stdout: ${tk.stdout.toString()}`);
          if (tk?.stderr) console.log(`taskkill stderr: ${tk.stderr.toString()}`);
        }
      } catch (e) {
        if (!silentAbort) console.warn('taskkill tree failed', e?.message || e);
      }
    };

    const killCandidates = (candidates) => {
      const list = Array.from(new Set((candidates || []).map((p) => Number(p)).filter(Number.isFinite)));
      if (!list.length) return [];
      const res = forceKillPids(list);
      if (!silentAbort) console.log(`forceKillPids(${jobId}) -> ${JSON.stringify(res)}`);
      return list;
    };

    const inMem = runningJobs.get(jobId);
    if (inMem) {
      try {
        inMem.status = 'aborting';
        try { persistJobProgress(inMem, { status: 'aborting' }, { forceIndex: false, forceConfig: false }); } catch {}
      } catch {}

      const pid = inMem.proc && inMem.proc.pid ? inMem.proc.pid : null;
      // Kill tree first on Windows to avoid orphaning.
      if (pid) killPidTreeWin32(pid);

      try { inMem.proc && typeof inMem.proc.kill === 'function' && inMem.proc.kill(); } catch {}
      // Always also target the real python process by job_id.
      for (let attempt = 0; attempt < 3; attempt++) {
        const pids = jobSpecificPids();
        if (!pids.length) break;
        killCandidates(pids);
        await sleepLocal(250);
      }

      // Hardening: kill descendants for recorded pid and job-specific pids.
      try {
        const extra = new Set();
        if (pid) {
          extra.add(Number(pid));
          try { (findDescendantPids(pid) || []).forEach((d) => extra.add(Number(d))); } catch {}
        }
        const js = jobSpecificPids();
        for (const p of js) {
          extra.add(Number(p));
          try { (findDescendantPids(p) || []).forEach((d) => extra.add(Number(d))); } catch {}
        }
        const extraList = Array.from(extra).filter(Number.isFinite);
        if (extraList.length) killCandidates(extraList);
      } catch {}

      await sleepLocal(400);
      const remaining = jobSpecificPids();
      if (remaining.length) {
        const err = new Error('abort_failed');
        err.code = 'abort_failed';
        err.jobId = jobId;
        err.remainingPids = remaining;
        throw err;
      }

      try { inMem.status = 'aborted'; } catch {}
      try { inMem.endedAt = Date.now(); } catch {}
      try {
        const activeKey = inMem.key || `${inMem.project || ''}:${inMem.targetMode || 'layer'}:${inMem.targetName || inMem.layer}`;
        activeKeys.delete(activeKey);
      } catch {}
      clearTimeout(inMem.cleanupTimer);
      inMem.cleanupTimer = setTimeout(() => {
        runningJobs.delete(jobId);
        try { deleteJobPidFile(jobId); } catch (e) { }
      }, parseInt(process.env.JOB_TTL_MS || '300000', 10));
      try { deleteJobPidFile(jobId); } catch {}
      return { status: 'aborted', id: jobId, inMemory: true };
    }

    // Cross-worker/orphan case: use pid file + commandline matching
    const meta = readJobPidMeta(jobId);
    const outputDir = extractOutputDirFromSpawnArgs(meta && meta.args ? meta.args : null);
    const pids = jobSpecificPids();
    if (!pids.length && !(meta && meta.pid)) {
      return { status: 'not_found', id: jobId };
    }

    const candidates = new Set();
    if (meta && meta.pid) candidates.add(Number(meta.pid));
    pids.forEach((p) => candidates.add(Number(p)));
    for (const p of pids) {
      try { (findDescendantPids(p) || []).forEach((d) => candidates.add(Number(d))); } catch {}
    }
    if (meta && meta.pid) {
      killPidTreeWin32(meta.pid);
      try { (findDescendantPids(meta.pid) || []).forEach((d) => candidates.add(Number(d))); } catch {}
    }
    if (outputDir) {
      try { (findProcessPidsByCommandLine(outputDir) || []).forEach((p) => candidates.add(Number(p))); } catch {}
    }
    try { (findProcessPidsByCommandLine('qgis-bin.exe') || []).forEach((p) => candidates.add(Number(p))); } catch {}
    try { (findProcessPidsByCommandLine('qgis') || []).forEach((p) => candidates.add(Number(p))); } catch {}

    killCandidates(Array.from(candidates));
    await sleepLocal(500);
    const remaining = jobSpecificPids();
    if (remaining.length) {
      const err = new Error('abort_failed');
      err.code = 'abort_failed';
      err.jobId = jobId;
      err.remainingPids = remaining;
      throw err;
    }
    try { deleteJobPidFile(jobId); } catch {}
    return { status: 'aborted', id: jobId, orphan: true };
  };

  const targetJobIds = findJobIdsForLayerTarget(projectId, layerName);
  if (targetJobIds.length) {
    if (!force) {
      const err = new Error('job_running');
      err.code = 'job_running';
      err.jobId = targetJobIds[0];
      throw err;
    }
    for (const jid of targetJobIds) {
      try {
        await forceAbortGenerateCacheJob(jid, { silent });
      } catch (e) {
        if (!silent) console.warn('Failed to abort running job before delete', { jobId: jid, error: e?.message || e });
        throw e;
      }
    }
  }

  // Best-effort: even if we didn't find a jobId, kill any processes touching this layer's cache dir
  try {
    const candidates = new Set();
    const layerDirAbs = path.resolve(cacheDir, projectId, layerName);
    try { (findProcessPidsByCommandLine(layerDirAbs) || []).forEach((p) => candidates.add(Number(p))); } catch {}
    try { (findProcessPidsByCommandLineAll(['generate_cache.py', layerName]) || []).forEach((p) => candidates.add(Number(p))); } catch {}
    try { (findProcessPidsByCommandLineAll(['generate_cache.py', projectId]) || []).forEach((p) => candidates.add(Number(p))); } catch {}
    try { (findProcessPidsByCommandLine('qgis-bin.exe') || []).forEach((p) => candidates.add(Number(p))); } catch {}
    const list = Array.from(candidates).filter(Number.isFinite);
    if (list.length) {
      if (!silent) console.log(`deleteLayerCacheInternal: killing extra processes for ${projectId}/${layerName}: ${JSON.stringify(list)}`);
      try { forceKillPids(list); } catch (e) { if (!silent) console.warn('deleteLayerCacheInternal extra kill failed', e?.message || e); }
      await sleepLocal(300);
    }
  } catch (e) {
    if (!silent) console.warn('deleteLayerCacheInternal extra kill wrapper failed', e?.message || e);
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

  // Also purge WMS tile cache for this layer.
  // WMS caching stores tiles under:
  //   cache/<project>/_wms_tiles/<crs>/<layers>/<styles>/<t|o>/<z>/<x>/<y>.<ext>
  // where <layers> is a safePathSegment of the LAYERS string.
  const purgeWmsCacheForLayer = async () => {
    const layerSeg = safePathSegment(layerName, { fallback: 'layers' });
    const projectSeg = safePathSegment(projectId, { fallback: projectId || 'project' });

    const candidateRoots = Array.from(new Set([
      path.join(cacheDir, projectId, '_wms_tiles'),
      path.join(cacheDir, projectSeg, '_wms_tiles'),
      // legacy root used by older WMS cache implementation
      path.join(cacheDir, '_wms_tiles', projectSeg)
    ]));

    const removeDirBestEffort = async (dirPath) => {
      if (!dirPath) return;
      try {
        if (!fs.existsSync(dirPath)) return;
      } catch {
        return;
      }
      let removal = dirPath;
      try {
        const relocated = await relocateDirectoryForRemoval(dirPath);
        if (relocated) removal = relocated;
      } catch {
        removal = dirPath;
      }
      try {
        await removeDirectorySafe(removal, {});
        if (removal !== dirPath) {
          try { await removeDirectorySafe(dirPath, { attempts: 2, delayMs: 100 }); } catch {}
        }
      } catch (e) {
        if (!silent) console.warn('Failed to remove WMS cache dir', dirPath, e?.message || e);
      }
    };

    for (const root of candidateRoots) {
      try {
        if (!fs.existsSync(root)) continue;
      } catch {
        continue;
      }

      // Root may either contain CRS dirs (new layout) or already be the CRS dir (legacy variants).
      let crsDirs = [];
      try {
        crsDirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
      } catch {
        crsDirs = [];
      }

      // New layout: root/<crs>/<layers>/...
      for (const crsName of crsDirs) {
        const target = path.join(root, crsName, layerSeg);
        await removeDirBestEffort(target);
      }

      // Legacy layout might have root/<layers>/... directly.
      await removeDirBestEffort(path.join(root, layerSeg));
    }
  };

  await purgeWmsCacheForLayer();
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
  // Update index.json: preserve layer entry but mark cache as removed/cleared
  try {
    if (!Array.isArray(index.layers)) index.layers = [];
    let found = false;
    index.layers = index.layers.map((l) => {
      if (!l || l.name !== layerName) return l;
      found = true;
      const updated = Object.assign({}, l);
      // mark cache fields as cleared
      updated.cached_zoom_min = null;
      updated.cached_zoom_max = null;
      // remove path reference to avoid pointing to removed directory
      if (Object.prototype.hasOwnProperty.call(updated, 'path')) updated.path = null;
      // optional metadata about removal
      updated.cache_removed_at = new Date().toISOString();
      updated.cache_exists = false;
      updated.updated = new Date().toISOString();
      // remove any tile counts/sizes if present
      if (Object.prototype.hasOwnProperty.call(updated, 'tiles')) updated.tiles = 0;
      if (Object.prototype.hasOwnProperty.call(updated, 'tile_count')) updated.tile_count = 0;
      if (Object.prototype.hasOwnProperty.call(updated, 'tileCount')) updated.tileCount = 0;
      if (Object.prototype.hasOwnProperty.call(updated, 'size')) updated.size = 0;
      return updated;
    });
    // if not present, add a minimal placeholder entry so index retains layer metadata
    if (!found) {
      index.layers.push({
        name: layerName,
        kind: 'layer',
        cached_zoom_min: null,
        cached_zoom_max: null,
        cache_removed_at: new Date().toISOString(),
        cache_exists: false,
        updated: new Date().toISOString()
      });
    }
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
  const listJobPidFiles = () => {
    try {
      return fs.readdirSync(jobPidDir).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
  };

  const findJobIdsForThemeTarget = (projectParam, themeParam) => {
    const ids = new Set();
    for (const [jid, job] of runningJobs.entries()) {
      if (!job || job.status !== 'running') continue;
      if (job.project === projectParam && job.targetMode === 'theme' && job.targetName === themeParam) ids.add(jid);
    }
    for (const f of listJobPidFiles()) {
      try {
        const raw = fs.readFileSync(path.join(jobPidDir, f), 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.id) continue;
        if (parsed.project === projectParam && parsed.targetMode === 'theme' && parsed.targetName === themeParam) ids.add(String(parsed.id));
      } catch {
        // ignore per-file errors
      }
    }
    return Array.from(ids);
  };

  const sleepLocal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const readJobPidMeta = (jobId) => {
    try {
      const p = jobPidPathFor(jobId);
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  };

  const forceAbortGenerateCacheJob = async (jobId, { silent: silentAbort = false } = {}) => {
    const jobSpecificPids = () => {
      try { return findProcessPidsByCommandLineAll(['generate_cache.py', String(jobId)]) || []; } catch { return []; }
    };

    const killPidTreeWin32 = (pid) => {
      if (!pid || process.platform !== 'win32') return;
      try {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: true, timeout: 7000 });
      } catch (e) {
        if (!silentAbort) console.warn('taskkill tree failed', e?.message || e);
      }
    };

    const killCandidates = (candidates) => {
      const list = Array.from(new Set((candidates || []).map((p) => Number(p)).filter(Number.isFinite)));
      if (!list.length) return [];
      const res = forceKillPids(list);
      if (!silentAbort) console.log(`forceKillPids(${jobId}) -> ${JSON.stringify(res)}`);
      return list;
    };

    const inMem = runningJobs.get(jobId);
    if (inMem) {
      try {
        inMem.status = 'aborting';
        try { persistJobProgress(inMem, { status: 'aborting' }, { forceIndex: false, forceConfig: false }); } catch {}
      } catch {}

      const pid = inMem.proc && inMem.proc.pid ? inMem.proc.pid : null;
      if (pid) killPidTreeWin32(pid);
      try { inMem.proc && typeof inMem.proc.kill === 'function' && inMem.proc.kill(); } catch {}

      for (let attempt = 0; attempt < 3; attempt++) {
        const pids = jobSpecificPids();
        if (!pids.length) break;
        killCandidates(pids);
        await sleepLocal(250);
      }

      try {
        const spawnargs = inMem.proc && inMem.proc.spawnargs ? inMem.proc.spawnargs : null;
        const outputDir = inMem.tileBaseDir || extractOutputDirFromSpawnArgs(spawnargs) || null;
        const extra = new Set();
        if (pid) {
          extra.add(Number(pid));
          try { (findDescendantPids(pid) || []).forEach((d) => extra.add(Number(d))); } catch {}
        }
        const js = jobSpecificPids();
        for (const p of js) {
          extra.add(Number(p));
          try { (findDescendantPids(p) || []).forEach((d) => extra.add(Number(d))); } catch {}
        }
        if (outputDir) {
          try { (findProcessPidsByCommandLine(outputDir) || []).forEach((p) => extra.add(Number(p))); } catch {}
        }
        try { (findProcessPidsByCommandLine('qgis-bin.exe') || []).forEach((p) => extra.add(Number(p))); } catch {}
        try { (findProcessPidsByCommandLine('qgis') || []).forEach((p) => extra.add(Number(p))); } catch {}
        const extraList = Array.from(extra).filter(Number.isFinite);
        if (extraList.length) killCandidates(extraList);
      } catch {}

      await sleepLocal(500);
      const remaining = jobSpecificPids();
      if (remaining.length) {
        const err = new Error('abort_failed');
        err.code = 'abort_failed';
        err.jobId = jobId;
        err.remainingPids = remaining;
        throw err;
      }

      try { inMem.status = 'aborted'; } catch {}
      try { inMem.endedAt = Date.now(); } catch {}
      try {
        const activeKey = inMem.key || `${inMem.project || ''}:${inMem.targetMode || 'layer'}:${inMem.targetName || inMem.layer}`;
        activeKeys.delete(activeKey);
      } catch {}
      clearTimeout(inMem.cleanupTimer);
      inMem.cleanupTimer = setTimeout(() => {
        runningJobs.delete(jobId);
        try { deleteJobPidFile(jobId); } catch (e) { }
      }, parseInt(process.env.JOB_TTL_MS || '300000', 10));
      try { deleteJobPidFile(jobId); } catch {}
      return { status: 'aborted', id: jobId, inMemory: true };
    }

    const meta = readJobPidMeta(jobId);
    const outputDir = extractOutputDirFromSpawnArgs(meta && meta.args ? meta.args : null);
    const pids = jobSpecificPids();
    if (!pids.length && !(meta && meta.pid)) {
      try { deleteJobPidFile(jobId); } catch {}
      return { status: 'not_found', id: jobId };
    }

    const candidates = new Set();
    if (meta && meta.pid) {
      candidates.add(Number(meta.pid));
      killPidTreeWin32(meta.pid);
      try { (findDescendantPids(meta.pid) || []).forEach((d) => candidates.add(Number(d))); } catch {}
    }
    pids.forEach((p) => candidates.add(Number(p)));
    for (const p of pids) {
      try { (findDescendantPids(p) || []).forEach((d) => candidates.add(Number(d))); } catch {}
    }
    if (outputDir) {
      try { (findProcessPidsByCommandLine(outputDir) || []).forEach((p) => candidates.add(Number(p))); } catch {}
    }
    try { (findProcessPidsByCommandLine('qgis-bin.exe') || []).forEach((p) => candidates.add(Number(p))); } catch {}
    try { (findProcessPidsByCommandLine('qgis') || []).forEach((p) => candidates.add(Number(p))); } catch {}

    killCandidates(Array.from(candidates));
    await sleepLocal(500);
    const remaining = jobSpecificPids();
    if (remaining.length) {
      const err = new Error('abort_failed');
      err.code = 'abort_failed';
      err.jobId = jobId;
      err.remainingPids = remaining;
      throw err;
    }
    try { deleteJobPidFile(jobId); } catch {}
    return { status: 'aborted', id: jobId, orphan: true };
  };

  const targetJobIds = findJobIdsForThemeTarget(projectId, themeName);
  if (targetJobIds.length) {
    if (!force) {
      const err = new Error('job_running');
      err.code = 'job_running';
      err.jobId = targetJobIds[0];
      throw err;
    }
    for (const jid of targetJobIds) {
      try {
        await forceAbortGenerateCacheJob(jid, { silent });
      } catch (e) {
        if (!silent) console.warn('Failed to abort running theme job before delete', { jobId: jid, error: e?.message || e });
        throw e;
      }
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
  // Update index.json: preserve theme entry but mark cache as removed/cleared
  try {
    if (!Array.isArray(index.layers)) index.layers = [];
    let foundTheme = false;
    index.layers = index.layers.map((entry) => {
      if (!(entry && entry.name === themeName && (entry.kind || "layer") === "theme")) return entry;
      foundTheme = true;
      const updated = Object.assign({}, entry);
      updated.cached_zoom_min = null;
      updated.cached_zoom_max = null;
      if (Object.prototype.hasOwnProperty.call(updated, 'path')) updated.path = null;
      updated.cache_removed_at = new Date().toISOString();
      updated.cache_exists = false;
      updated.updated = new Date().toISOString();
      if (Object.prototype.hasOwnProperty.call(updated, 'tiles')) updated.tiles = 0;
      if (Object.prototype.hasOwnProperty.call(updated, 'tile_count')) updated.tile_count = 0;
      if (Object.prototype.hasOwnProperty.call(updated, 'tileCount')) updated.tileCount = 0;
      if (Object.prototype.hasOwnProperty.call(updated, 'size')) updated.size = 0;
      return updated;
    });
    if (!foundTheme) {
      index.layers.push({
        name: themeName,
        kind: 'theme',
        cached_zoom_min: null,
        cached_zoom_max: null,
        cache_removed_at: new Date().toISOString(),
        cache_exists: false,
        updated: new Date().toISOString()
      });
    }
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

// Detectar ejecutable python (permite override por .env). No usar hardcoded C:\ fallbacks — exigir .env
const pythonExe = process.env.PYTHON_EXE || (process.env.OSGEO4W_BIN ? path.join(process.env.OSGEO4W_BIN, "python.exe") : null);
// const tileRendererPool = new PythonPool(pythonScript, poolSize); // moved below

// 1. Inicializar el Pool (usando configuración del .env)
const poolSize = parseInt(process.env.PY_WORKER_POOL_SIZE || "4");
const pythonScript = path.resolve(__dirname, 'python', 'worker_wrapper.py');
// --- create the Python worker pool AFTER poolSize and pythonScript are defined ---
const tileRendererPool = new PythonPool(pythonScript, poolSize);
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
// No usar hardcoded fallbacks. Si no hay O4W_BATCH y tampoco OSGEO4W_BIN, será null.
const o4wBatch = process.env.O4W_BATCH || (process.env.OSGEO4W_BIN ? path.join(process.env.OSGEO4W_BIN, "o4w_env.bat") : null);

const runPythonViaOSGeo4W = (script, args = [], options = {}) => {
  // Ejecutar el batch (o4w_env) y luego python en la misma cmd para heredar el entorno.
  // Por defecto suprimimos la salida del batch para mantener los logs limpios.
  // El batch siempre se ejecuta en modo silencioso (>nul 2>&1) para evitar ruido
  // en los registros del servidor. Si necesitas depuración explícita, establece
  // manualmente la variable en el entorno antes de arrancar el servidor.
  if (!pythonExe && !o4wBatch) {
    throw new Error('OSGeo4W/Python no configurado: define PYTHON_EXE o OSGEO4W_BIN (o O4W_BATCH) en .env');
  }
  // By default prefer running inside the OSGeo4W batch environment when
  // available because it sets up PYTHONHOME, PATH and other variables that
  // QGIS's Python runtime expects. If you intentionally want to spawn the
  // python executable directly, set `FORCE_DIRECT=1` in your environment.
  if (!pythonExe) {
    throw new Error('PYTHON_EXE no definido y no se pudo resolver desde OSGEO4W_BIN; revisa .env');
  }

  const spawnOpts = { env: makeChildEnv(), cwd: __dirname, stdio: 'pipe', ...options };

  // If an OSGeo4W batch wrapper exists and the user didn't force direct spawn,
  // run the batch and python in a shell so the QGIS python environment is valid.
  const wantBatch = !!o4wBatch && !process.env.FORCE_DIRECT;
  if (wantBatch) {
    const o4wPart = `"${o4wBatch}" >nul 2>&1`;
    const cmdParts = [o4wPart, '&&', `"${pythonExe}"`, `"${script}"`, ...args.map(a => `"${String(a)}"`)];
    const cmd = cmdParts.join(' ');
    return spawn(cmd, { shell: true, env: makeChildEnv(), cwd: __dirname, ...options });
  }

  // Otherwise spawn python directly (useful for pure-Python setups / venvs).
  const procArgs = [script, ...args.map(a => String(a))];
  return spawn(pythonExe, procArgs, spawnOpts);
};

// Hard kill helper: best-effort terminate processes associated with a cache job/layer
const killProcessesByHints = async ({ jobId = null, projectId = null, targetName = null, outputDir = null, silent = false } = {}) => {
  const candidates = new Set();
  const addList = (list) => {
    if (!Array.isArray(list)) return;
    list.forEach((p) => { const n = Number(p); if (Number.isFinite(n)) candidates.add(n); });
  };
  try { addList(findProcessPidsByCommandLine('generate_cache.py')); } catch {}
  if (jobId) {
    try { addList(findProcessPidsByCommandLineAll(['generate_cache.py', String(jobId)])); } catch {}
  }
  if (projectId) {
    try { addList(findProcessPidsByCommandLineAll(['generate_cache.py', String(projectId)])); } catch {}
    try { addList(findProcessPidsByCommandLine(projectId)); } catch {}
  }
  if (targetName) {
    try { addList(findProcessPidsByCommandLineAll(['generate_cache.py', String(targetName)])); } catch {}
    try { addList(findProcessPidsByCommandLine(targetName)); } catch {}
  }
  if (outputDir) {
    try { addList(findProcessPidsByCommandLine(outputDir)); } catch {}
  }
  try { addList(findProcessPidsByCommandLine('qgis-bin.exe')); } catch {}
  try { addList(findProcessPidsByCommandLine('qgis')); } catch {}

  const list = Array.from(candidates).filter(Number.isFinite);
  if (!list.length) return [];
  if (!silent) console.log(`killProcessesByHints -> killing ${JSON.stringify(list)}`);
  try { forceKillPids(list); } catch (e) { if (!silent) console.warn('killProcessesByHints forceKill failed', e?.message || e); }
  await new Promise((r) => setTimeout(r, 400));
  return list;
};

// Helper: on Windows, find processes whose command line contains `needle`
// and return their PIDs. Uses PowerShell to enumerate Win32_Process entries
// because `tasklist` doesn't expose full command lines reliably.
const findProcessPidsByCommandLine = (needle) => {
  if (!needle) return [];
  try {
    const psCmd = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like '*${needle.replace(/'/g, "''" )}*' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Depth 3`;
    const res = spawnSync('powershell', ['-NoProfile', '-Command', psCmd], { shell: true, timeout: 5000, encoding: 'utf8' });
    const out = (res.stdout || '').trim();
    if (!out) return [];
    let parsed = null;
    try {
      parsed = JSON.parse(out);
    } catch (e) {
      // if single object, PowerShell may not wrap as array
      try { parsed = JSON.parse(out.replace(/\r?\n/g, '')); } catch (e2) { parsed = null; }
    }
    if (!parsed) return [];
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const pids = rows.map(r => Number(r.ProcessId)).filter(Number.isFinite);
    return pids;
  } catch (e) {
    console.warn('findProcessPidsByCommandLine failed', e?.message || e);
    return [];
  }
};

// Helper: like findProcessPidsByCommandLine, but requires ALL needles to match.
// Useful when multiple cache jobs run concurrently and we need to target a specific one.
const findProcessPidsByCommandLineAll = (needles = []) => {
  try {
    const terms = (Array.isArray(needles) ? needles : [needles])
      .map((n) => (n == null ? '' : String(n)))
      .map((n) => n.trim())
      .filter(Boolean);
    if (!terms.length) return [];
    const esc = (s) => s.replace(/'/g, "''");
    const conds = terms.map((t) => `$_.CommandLine -like '*${esc(t)}*'`).join(' -and ');
    const psCmd = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ${conds} } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Depth 3`;
    const res = spawnSync('powershell', ['-NoProfile', '-Command', psCmd], { shell: true, timeout: 7000, encoding: 'utf8' });
    const out = (res.stdout || '').trim();
    if (!out) return [];
    let parsed = null;
    try { parsed = JSON.parse(out); } catch { parsed = null; }
    if (!parsed) return [];
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((r) => Number(r.ProcessId)).filter(Number.isFinite);
  } catch (e) {
    console.warn('findProcessPidsByCommandLineAll failed', e?.message || e);
    return [];
  }
};

// Helper: find descendant PIDs of a given root PID (recursive) using PowerShell.
// Returns array of numeric PIDs or [] on error.
const findDescendantPids = (rootPid) => {
  try {
    const safePid = Number(rootPid) || 0;
    if (!safePid) return [];
    // PowerShell: collect all processes and recursively find children
    const psScript = `
      $root = ${safePid};
      $all = Get-CimInstance Win32_Process;
      $children = @();
      function Get-Kids($p) {
        $kids = $all | Where-Object { $_.ParentProcessId -eq $p };
        foreach ($k in $kids) { $children += $k.ProcessId; Get-Kids $k.ProcessId }
      }
      Get-Kids $root; $children | ConvertTo-Json -Depth 5
    `;
    const res = spawnSync('powershell', ['-NoProfile', '-Command', psScript], { shell: true, timeout: 7000, encoding: 'utf8' });
    const out = (res.stdout || '').trim();
    if (!out) return [];
    let parsed = null;
    try { parsed = JSON.parse(out); } catch (e) { parsed = null; }
    if (!parsed) return [];
    if (Array.isArray(parsed)) return parsed.map((p) => Number(p)).filter(Number.isFinite);
    // single value
    const single = Number(parsed);
    return Number.isFinite(single) ? [single] : [];
  } catch (e) {
    console.warn('findDescendantPids failed', e?.message || e);
    return [];
  }
};

// Helper: force-kill PIDs using taskkill; returns array of results { pid, code }
const forceKillPids = (pids = []) => {
  const results = [];
  try {
    for (const pid of pids) {
      try {
        const tk = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: true, timeout: 5000 });
        results.push({ pid, code: tk.status, stdout: (tk.stdout||'').toString(), stderr: (tk.stderr||'').toString() });
      } catch (e) {
        results.push({ pid, code: null, error: String(e) });
      }
    }
  } catch (e) {
    // ignore
  }
  return results;
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
  // Accept both raw arrays and extract_info shapes like { bbox: [...] } or { extent: [...] }
  const candidate = (value && typeof value === 'object' && !Array.isArray(value))
    ? (Array.isArray(value.bbox) ? value.bbox : (Array.isArray(value.extent) ? value.extent : null))
    : value;

  if (!Array.isArray(candidate) || candidate.length !== 4) return null;
  const parsed = candidate.map((coordinate) => {
    const num = Number(coordinate);
    return Number.isFinite(num) ? num : null;
  });
  return parsed.every((num) => num != null) ? parsed : null;
};

/**
 * Normalize extent-like objects to [minX, minY, maxX, maxY] numeric array.
 * Accepts plain arrays, or objects with .bbox, or nested project.extract shapes.
 * Returns null if invalid.
 */
function normalizeExtent(raw) {
  if (!raw) return null;
  if (Array.isArray(raw) && raw.length === 4) {
    const nums = raw.map(n => Number(n));
    if (nums.some(n => Number.isNaN(n))) return null;
    return nums;
  }
  if (raw && Array.isArray(raw.bbox) && raw.bbox.length === 4) {
    const nums = raw.bbox.map(n => Number(n));
    if (nums.some(n => Number.isNaN(n))) return null;
    return nums;
  }
  // support wrapped shape { extent: [...] }
  if (raw && Array.isArray(raw.extent) && raw.extent.length === 4) {
    const nums = raw.extent.map(n => Number(n));
    if (nums.some(n => Number.isNaN(n))) return null;
    return nums;
  }
  return null;
}

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

const buildScaleDerivedPreset = ({
  crs,
  extent,
  extentWgs84 = null,
  scales = [],
  projectId = null,
  tileSize = 256
} = {}) => {
  if (!crs || !Array.isArray(extent) || extent.length < 4) return null;
  const cleanExtent = sanitizeExtentCoordinates(extent);
  if (!cleanExtent) return null;
  const unique = Array.isArray(scales) ? Array.from(new Set(scales.map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0))) : [];
  if (!unique.length) return null;

  const width = cleanExtent[2] - cleanExtent[0];
  const height = cleanExtent[3] - cleanExtent[1];
  const maxDim = Math.max(Math.abs(width), Math.abs(height));
  if (!Number.isFinite(maxDim) || maxDim <= 0) return null;

  const normalized = normalizeCrsCode(crs) || crs;
  const isGeographic = normalized === 'EPSG:4326' || normalized === 'CRS:84';
  let lat0 = 0;
  if (Array.isArray(extentWgs84) && extentWgs84.length === 4) {
    const candidate = (Number(extentWgs84[1]) + Number(extentWgs84[3])) / 2;
    if (Number.isFinite(candidate)) lat0 = Math.max(-89.9, Math.min(89.9, candidate));
  }
  const metersPerDegreeLon = 111319.49079327358 * Math.max(1e-6, Math.cos((lat0 * Math.PI) / 180));

  const toResolution = (scaleDen) => {
    const s = Number(scaleDen);
    if (!Number.isFinite(s) || s <= 0) return null;
    const metersPerPx = s * 0.00028;
    return isGeographic ? (metersPerPx / metersPerDegreeLon) : metersPerPx;
  };
  const toScaleDen = (resolution) => {
    const r = Number(resolution);
    if (!Number.isFinite(r) || r <= 0) return null;
    const metersPerPx = isGeographic ? (r * metersPerDegreeLon) : r;
    return metersPerPx / 0.00028;
  };

  // Sort scales from coarse -> fine.
  const sortedScales = unique.sort((a, b) => b - a);
  let resolutions = sortedScales.map(toResolution).filter((r) => Number.isFinite(r) && r > 0);
  if (!resolutions.length) return null;

  // Ensure z=0 covers the project extent (otherwise on-demand/viewer will clip).
  const requiredRes0 = maxDim / tileSize;
  if (Number.isFinite(requiredRes0) && requiredRes0 > 0) {
    const res0 = resolutions[0];
    if (!Number.isFinite(res0) || res0 < requiredRes0) {
      const syntheticScale = toScaleDen(requiredRes0);
      if (syntheticScale && Number.isFinite(syntheticScale) && syntheticScale > 0) {
        resolutions = [requiredRes0, ...resolutions];
      } else {
        resolutions = [requiredRes0, ...resolutions];
      }
    }
  }

  // Build WMTS-like matrices. Matrix width/height must reflect the extent at each resolution.
  // This is important for Leaflet bounds math and for WMTS clients (e.g. QGIS).
  const extentWidth = Math.abs(cleanExtent[2] - cleanExtent[0]);
  const extentHeight = Math.abs(cleanExtent[3] - cleanExtent[1]);
  const matrices = resolutions.map((res, z) => {
    const r = Number(res);
    const spanX = Number.isFinite(extentWidth) && Number.isFinite(r) && r > 0 ? (extentWidth / (tileSize * r)) : 1;
    const spanY = Number.isFinite(extentHeight) && Number.isFinite(r) && r > 0 ? (extentHeight / (tileSize * r)) : 1;
    const matrixWidth = Math.max(1, Math.ceil(spanX));
    const matrixHeight = Math.max(1, Math.ceil(spanY));
    const scaleDen = toScaleDen(r) || sortedScales[Math.min(z, sortedScales.length - 1)] || (r / 0.00028);
    return {
      identifier: String(z),
      id: String(z),
      z,
      source_level: z,
      resolution: r,
      scale_denominator: scaleDen,
      matrix_width: matrixWidth,
      matrix_height: matrixHeight,
      tileWidth: tileSize,
      tileHeight: tileSize,
      topLeftCorner: [cleanExtent[0], cleanExtent[3]],
      top_left: [cleanExtent[0], cleanExtent[3]]
    };
  });

  const safeCrs = String(normalized).replace(/[^a-zA-Z0-9]/g, "_");
  const safeProject = projectId ? `_${String(projectId).replace(/[^a-zA-Z0-9]/g, "_")}` : "";
  const id = `SCALES_${safeCrs}${safeProject}`;
  return {
    id,
    preset: {
      id,
      title: `Project scales for ${normalized}${projectId ? ` (${projectId})` : ''}`,
      supported_crs: [normalized],
      coordinateReferenceSystem: normalized,
      tile_width: tileSize,
      tile_height: tileSize,
      axis_order: "xy",
      top_left_corner: [cleanExtent[0], cleanExtent[3]],
      topLeftCorner: [cleanExtent[0], cleanExtent[3]],
      matrices,
      matrixSet: matrices,
      project_id: projectId,
      scale_denominators: sortedScales,
      derived_from: "project_scales"
    },
    zoomMin: 0,
    zoomMax: Math.max(0, matrices.length - 1)
  };
};

const ensureScaleGridPreset = ({ crs, extent, extentWgs84, scales, projectId }) => {
  const derived = buildScaleDerivedPreset({ crs, extent, extentWgs84, scales, projectId });
  if (!derived) return null;
  try {
    if (!fs.existsSync(tileGridDir)) {
      fs.mkdirSync(tileGridDir, { recursive: true });
    }
    const filename = `${derived.id}.json`;
    const filePath = path.join(tileGridDir, filename);
    const nextContent = JSON.stringify(derived.preset, null, 2);
    let changed = true;
    if (fs.existsSync(filePath)) {
      try {
        const prev = fs.readFileSync(filePath, 'utf8');
        changed = (prev || '') !== nextContent;
      } catch {
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(filePath, nextContent, 'utf8');
      console.log(`[scales-grid] Updated project scale preset ${derived.id} -> ${filePath}`);
      invalidateTileGridCaches();
    }
    return derived;
  } catch (err) {
    console.warn('[scales-grid] Failed to persist scale preset', { projectId, crs, error: err?.message || err });
    return null;
  }
};

const deriveMercatorZoomRangeFromScales = (scales = [], { tileSize = 256, maxZoom = 30 } = {}) => {
  const list = Array.isArray(scales) ? scales : [];
  const cleaned = list.map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0);
  if (!cleaned.length) return null;
  const initialResolution = (2 * Math.PI * 6378137) / tileSize;
  const zooms = [];
  for (const scaleDen of cleaned) {
    const res = scaleDen * 0.00028;
    if (!Number.isFinite(res) || res <= 0) continue;
    const z = Math.round(Math.log2(initialResolution / res));
    if (Number.isFinite(z)) {
      zooms.push(Math.max(0, Math.min(maxZoom, z)));
    }
  }
  if (!zooms.length) return null;
  const min = 0;
  const max = Math.max(min, ...zooms);
  return { min, max };
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
  const proc = runPythonViaOSGeo4W(script, args, { cwd: path.dirname(projectPath) });
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
    return { entries: [], projectExtent: null, projectExtentWgs: null, projectCrs: null, defaultTileProfile: null, requiresAllowRemote: false };
  }
  const now = new Date().toISOString();
  const entries = [];
  const usedKeys = new Set();
  const projectInfo = extractPayload.project || {};
  const projectExtent = coalesceExtent(projectInfo.extent, projectInfo.view_extent) || BOOTSTRAP_EXTENT_FALLBACK;
  const projectExtentWgs = coalesceExtent(projectInfo.extent_wgs84, projectInfo.view_extent_wgs84);
  const projectCrs = projectInfo.crs || null;
  const projectCrsNormalized = normalizeCrsCode(projectCrs);

  const projectScaleList = Array.isArray(projectInfo.scales) ? projectInfo.scales : null;
  const mercatorZoomFromScales = (projectCrsNormalized === 'EPSG:3857' && projectScaleList && projectScaleList.length)
    ? deriveMercatorZoomRangeFromScales(projectScaleList)
    : null;
  const scalePreset = (projectCrsNormalized
    && projectCrsNormalized !== 'EPSG:3857'
    && projectScaleList
    && projectScaleList.length
    && projectExtent)
    ? ensureScaleGridPreset({ crs: projectCrsNormalized, extent: projectExtent, extentWgs84: projectExtentWgs, scales: projectScaleList, projectId })
    : null;
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

    const tileProfile = scalePreset
      ? {
          tileCrs: projectCrsNormalized,
          scheme: 'wmts',
          tileMatrixPreset: scalePreset.id,
          tileMatrixSet: cloneObject(scalePreset.preset),
          source: 'project_scales'
        }
      : pickBootstrapTileProfile([
          { value: projectCrs, source: "project" },
          { value: options.crs, source: kind === "theme" ? "project" : "layer" },
          { value: BOOTSTRAP_TILE_CRS, source: "config" }
        ], projectExtent, projectId);

    const entryTileCrs = tileProfile.tileCrs || projectCrsNormalized || BOOTSTRAP_TILE_CRS;

    const effectiveZoomMin = scalePreset
      ? scalePreset.zoomMin
      : (mercatorZoomFromScales ? mercatorZoomFromScales.min : BOOTSTRAP_ZOOM_MIN);
    const effectiveZoomMax = scalePreset
      ? scalePreset.zoomMax
      : (mercatorZoomFromScales ? mercatorZoomFromScales.max : BOOTSTRAP_ZOOM_MAX);

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
      zoom_min: effectiveZoomMin,
      zoom_max: effectiveZoomMax,
      published_zoom_min: effectiveZoomMin,
      published_zoom_max: effectiveZoomMax,
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
  // --- FIX: asegura que topLeftCorner siempre tenga dos valores ---
  const tlc = entry.tile_matrix_set.topLeftCorner || entry.tile_matrix_set.top_left_corner || entry.tile_matrix_set.top_left;
  if (Array.isArray(tlc) && tlc.length === 1 && Array.isArray(entry.extent) && entry.extent.length === 4) {
    entry.tile_matrix_set.topLeftCorner = [entry.extent[0], entry.extent[3]];
    entry.tile_matrix_set.top_left_corner = [entry.extent[0], entry.extent[3]];
    entry.tile_matrix_set.top_left = [entry.extent[0], entry.extent[3]];
  }
}
    entries.push(entry);
  };

  const remoteLayerProviders = new Set(["wms", "wmts", "xyz", "tile"]);
  let requiresAllowRemote = false;
  const layerList = Array.isArray(extractPayload.layers) ? extractPayload.layers : [];
  for (const layer of layerList) {
    if (!layer) continue;
    const name = layer.name || layer.id || null;
    if (!name) continue;
    const provider = typeof layer.provider === "string" ? layer.provider.trim().toLowerCase() : "";
    const preferProjectExtent = remoteLayerProviders.has(provider) || !!layer.remote_source;
    if (preferProjectExtent) {
      requiresAllowRemote = true;
    }
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
        tileMatrixPreset: entries[0].tile_matrix_preset || null,
        zoomMin: entries[0].zoom_min,
        zoomMax: entries[0].zoom_max
      }
    : null;

  return { entries, projectExtent, projectExtentWgs, projectCrs, defaultTileProfile, requiresAllowRemote };
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
    defaultTileProfile,
    requiresAllowRemote
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
      zoomMin: defaultTileProfile?.zoomMin ?? BOOTSTRAP_ZOOM_MIN,
      zoomMax: defaultTileProfile?.zoomMax ?? BOOTSTRAP_ZOOM_MAX,
      tileProfile: defaultTileProfile,
      allowRemote: requiresAllowRemote
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
      const shouldEnableRemote = info.allowRemote === true;
      const needsAllowRemote = shouldEnableRemote && prefs.allowRemote !== true;
      if (needsTileCrs || needsMode || !prefs.updatedAt || needsAllowRemote) {
        patch.cachePreferences = {
          mode: info.tileProfile.scheme || prefs.mode || "xyz",
          tileCrs: info.tileProfile.tileCrs || prefs.tileCrs || BOOTSTRAP_TILE_CRS,
          allowRemote: shouldEnableRemote ? true : (typeof prefs.allowRemote === "boolean" ? prefs.allowRemote : false),
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
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });

    const findSingleProjectFileRecursive = (rootDir) => {
      const matches = [];
      const stack = [rootDir];
      const rootResolved = path.resolve(rootDir);
      const rootLower = rootResolved.toLowerCase();
      let scanned = 0;
      const MAX_SCAN = 2000;

      while (stack.length) {
        const current = stack.pop();
        scanned += 1;
        if (scanned > MAX_SCAN) break;
        let listing;
        try {
          listing = fs.readdirSync(current, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const ent of listing) {
          if (!ent) continue;
          const fullPath = path.join(current, ent.name);
          const fullResolved = path.resolve(fullPath);
          if (!fullResolved.toLowerCase().startsWith(rootLower + path.sep)) {
            continue;
          }
          if (ent.isDirectory()) {
            // avoid deeply nested node_modules-like folders if ever present
            if (ent.name === 'node_modules' || ent.name === '.git') continue;
            stack.push(fullPath);
          } else if (ent.isFile()) {
            const lower = ent.name.toLowerCase();
            if (lower.endsWith('.qgz') || lower.endsWith('.qgs')) {
              matches.push(fullPath);
              if (matches.length > 1) return matches;
            }
          }
        }
      }
      return matches;
    };

    const items = [];

    for (const ent of entries) {
      if (!ent) continue;
      if (ent.isFile() && (ent.name.toLowerCase().endsWith('.qgz') || ent.name.toLowerCase().endsWith('.qgs'))) {
        const id = ent.name.replace(/\.(qgz|qgs)$/i, "");
        items.push({ id, name: id, file: path.join(projectsDir, ent.name) });
        continue;
      }
      if (ent.isDirectory()) {
        const projectId = ent.name;
        const folder = path.join(projectsDir, projectId);
        const found = findSingleProjectFileRecursive(folder);
        if (found.length === 1) {
          items.push({ id: projectId, name: projectId, file: found[0] });
        } else if (found.length > 1) {
          console.warn(`[projects] Skipping folder '${projectId}': multiple .qgs/.qgz found.`);
        }
      }
    }

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
  const wmsUrl = `/wms?SERVICE=WMS&REQUEST=GetCapabilities&project=${encodeURIComponent(projectId)}`;
  const wfsUrl = `/wfs?SERVICE=WFS&REQUEST=GetCapabilities&project=${encodeURIComponent(projectId)}`;
  const cacheUpdatedAt = indexData.updated || indexData.modified || indexData.generatedAt || indexData.created || null;
  const accessInfo = access && typeof access === "object" ? access : { public: true, allowed: true };
  return {
    id: projectId,
    name: project.name,
    title: displayName,
    summary,
    public: accessInfo.public === true,
    wmtsUrl,
    wmsUrl,
    wfsUrl,
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

// mapa de jobs en ejecución
const runningJobs = new Map();
// mapa de jobs huérfanos detectados al arrancar (id -> { id, pid, infoFile, data, detectedAt })
const orphanJobs = new Map();

// --- Control de abortos recientes para jobs ---
const abortedTargets = new Set();

function markAborted(project, layer) {
  abortedTargets.add(`${project}|${layer || ''}`);
  setTimeout(() => abortedTargets.delete(`${project}|${layer || ''}`), 5 * 60 * 1000); // 5 minutos
}

// Al crear un nuevo job:
function canEnqueueJob(project, layer) {
  return !abortedTargets.has(`${project}|${layer || ''}`);
}
// directorio para persistir metadatos de jobs (pid, args) para poder detectar huérfanos
const jobPidDir = path.resolve(__dirname, 'data', 'job-pids');
try { fs.mkdirSync(jobPidDir, { recursive: true }); } catch (e) { /* ignore */ }
// Helpers para persistir metadatos de job -> pid
const jobPidPathFor = (id) => path.join(jobPidDir, `${id}.json`);
const writeJobPidFile = (job) => {
  try {
    const p = jobPidPathFor(job.id);
    const data = {
      id: job.id,
      pid: job.proc && job.proc.pid ? job.proc.pid : null,
      project: job.project || null,
      layer: job.layer || null,
      targetMode: job.targetMode || null,
      targetName: job.targetName || null,
      viewerSessionId: job.viewerSessionId || null,
      args: job.proc && job.proc.spawnargs ? job.proc.spawnargs : null,
      startedAt: job.startedAt || Date.now()
    };
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.warn('Failed to write job pid file', e?.message || e);
    return false;
  }
};

// Internal helper: abort a generate-cache job by id (supports cross-worker/orphan best-effort).
const abortGenerateCacheJobInternal = async (id, { silentAbort = false } = {}) => {
  if (!id) return { ok: false, status: 400, payload: { error: 'id required' } };
  const job = runningJobs.get(id);
  if (!job) {
    try {
      const jobIdToken = String(id);
      let meta = null;
      let outputDir = null;
      try {
        const metaPath = jobPidPathFor(id);
        if (fs.existsSync(metaPath)) {
          meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          outputDir = extractOutputDirFromSpawnArgs(meta && meta.args ? meta.args : null);
        }
      } catch { meta = null; outputDir = null; }

      const procAlive = (p) => {
        if (!p) return false;
        try { process.kill(Number(p), 0); return true; } catch { return false; }
      };

      // If we have a recorded pid (from the pid-file) but process enumeration by
      // command line fails (common under services / restricted CIM access),
      // attempt to kill the recorded pid tree directly.
      if (meta && meta.pid && procAlive(meta.pid)) {
        const metaPid = Number(meta.pid);
        if (!silentAbort) console.log(`Abort (pid-file): killing recorded pid tree for job ${id}: pid=${metaPid}`);
        const candidates = new Set([metaPid]);
        try { (findDescendantPids(metaPid) || []).forEach((d) => candidates.add(Number(d))); } catch {}
        try { (findProcessPidsByCommandLine('qgis-bin.exe') || []).forEach((p) => candidates.add(Number(p))); } catch {}
        try { (findProcessPidsByCommandLine('qgis') || []).forEach((p) => candidates.add(Number(p))); } catch {}
        if (outputDir) {
          try { (findProcessPidsByCommandLine(outputDir) || []).forEach((p) => candidates.add(Number(p))); } catch {}
        }

        const candidateList = Array.from(candidates).filter(Number.isFinite);
        const fk = forceKillPids(candidateList);
        if (!silentAbort) console.log(`Abort (pid-file) kill results: ${JSON.stringify(fk)}`);
        await new Promise((r) => setTimeout(r, 600));
        if (procAlive(metaPid)) {
          if (!silentAbort) console.warn(`Abort (pid-file) did not terminate pid=${metaPid} for job ${id}`);
          return { ok: false, status: 500, payload: { error: 'abort_failed', id, pid: metaPid } };
        }
        await killProcessesByHints({ jobId: id, projectId: meta?.project, targetName: meta?.layer || meta?.targetName, outputDir, silent: !!silentAbort });
        try { deleteJobPidFile(id); } catch {}
        return { ok: true, status: 200, payload: { status: 'aborted', id, orphan: true, killedPids: candidateList } };
      }

      const jobPids = findProcessPidsByCommandLineAll(['generate_cache.py', jobIdToken]) || [];
      if (!jobPids.length) return { ok: false, status: 404, payload: { error: 'job not found or already finished' } };

      const candidates = new Set();
      if (meta && meta.pid) candidates.add(Number(meta.pid));
      jobPids.forEach((p) => candidates.add(Number(p)));
      for (const p of jobPids) {
        try { (findDescendantPids(p) || []).forEach((d) => candidates.add(Number(d))); } catch {}
      }
      if (meta && meta.pid) {
        try { (findDescendantPids(meta.pid) || []).forEach((d) => candidates.add(Number(d))); } catch {}
      }
      try { (findProcessPidsByCommandLine('qgis-bin.exe') || []).forEach((p) => candidates.add(Number(p))); } catch {}
      try { (findProcessPidsByCommandLine('qgis') || []).forEach((p) => candidates.add(Number(p))); } catch {}
      if (outputDir) {
        try { (findProcessPidsByCommandLine(outputDir) || []).forEach((p) => candidates.add(Number(p))); } catch {}
      }

      const candidateList = Array.from(candidates).filter(Number.isFinite);
      if (!silentAbort) console.log(`Abort (orphan/cross-worker): killing candidate PIDs for job ${id}: ${JSON.stringify(candidateList)}`);
      const fk = forceKillPids(candidateList);
      if (!silentAbort) console.log(`Abort (orphan/cross-worker) kill results: ${JSON.stringify(fk)}`);

      await new Promise((r) => setTimeout(r, 500));
      const remaining = findProcessPidsByCommandLineAll(['generate_cache.py', jobIdToken]) || [];
      if (remaining.length) {
        if (!silentAbort) console.warn(`Abort (orphan/cross-worker) did not terminate job ${id}. Remaining PIDs: ${JSON.stringify(remaining)}`);
        return { ok: false, status: 500, payload: { error: 'abort_failed', id, killedPids: candidateList, remainingPids: remaining } };
      }
      await killProcessesByHints({ jobId: id, projectId: meta?.project, targetName: meta?.layer || meta?.targetName, outputDir, silent: !!silentAbort });
      try { deleteJobPidFile(id); } catch {}
      return { ok: true, status: 200, payload: { status: 'aborted', id, orphan: true, killedPids: candidateList } };
    } catch (e) {
      if (!silentAbort) console.warn(`Abort (orphan/cross-worker) failed for job ${id}`, e?.message || e);
      return { ok: false, status: 500, payload: { error: 'abort_failed', id, details: String(e) } };
    }
  }

  try {
    try {
      job.status = 'aborting';
      persistJobProgress(job, { status: 'aborting' }, { forceIndex: false, forceConfig: false });
    } catch {}

    const pid = job.proc && job.proc.pid ? job.proc.pid : null;
    const procAlive = (p) => {
      if (!p) return false;
      try { process.kill(p, 0); return true; } catch { return false; }
    };

    if (process.platform === 'win32' && pid) {
      try {
        if (!silentAbort) console.log(`Abort: taskkill tree first for job ${id} pid=${pid}`);
        const tk = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: true, timeout: 7000 });
        if (!silentAbort) {
          console.log(`Abort: taskkill tree stdout: ${tk.stdout?.toString?.() || ''}`);
          console.log(`Abort: taskkill tree stderr: ${tk.stderr?.toString?.() || ''}`);
        }
        await new Promise((r) => setTimeout(r, 250));
      } catch (e) {
        if (!silentAbort) console.warn(`Abort: taskkill tree failed for job ${id}`, e?.message || e);
      }
    }

    try { job.proc.kill(); } catch {}

    try {
      const activeKey = job.key || `${job.project || ''}:${job.targetMode || 'layer'}:${job.targetName || job.layer}`;
      activeKeys.delete(activeKey);
    } catch { }

    const graceMs = parseInt(process.env.ABORT_GRACE_MS || '1000', 10) || 1000;
    const pollInterval = 250;
    const maxWait = Math.max(2000, graceMs + 2000);
    let waited = 0;
    while (procAlive(pid) && waited < maxWait) {
      await new Promise((r) => setTimeout(r, pollInterval));
      waited += pollInterval;
    }

    const jobSpecificPids = () => {
      try { return findProcessPidsByCommandLineAll(['generate_cache.py', String(id)]) || []; } catch { return []; }
    };
    const remainingJobSpecific = jobSpecificPids();
    if (procAlive(pid) || (remainingJobSpecific && remainingJobSpecific.length)) {
      if (!silentAbort) console.error(`Failed to abort job ${id}: pidAlive=${procAlive(pid)} jobSpecific=${JSON.stringify(remainingJobSpecific)}`);
      try {
        job.status = 'running';
        persistJobProgress(job, { status: 'running' }, { forceIndex: false, forceConfig: false });
      } catch {}
      return { ok: false, status: 500, payload: { error: 'abort_failed', id, pid, jobPids: remainingJobSpecific || [] } };
    }

    job.status = 'aborted';
    job.endedAt = Date.now();
    persistJobProgress(job, { status: 'aborted' }, { forceIndex: true, forceConfig: true });
    await killProcessesByHints({ jobId: id, projectId: job.project, targetName: job.targetName || job.layer, outputDir: job.tileBaseDir, silent: !!silentAbort });
    return { ok: true, status: 200, payload: { status: 'aborted', id } };
  } catch (err) {
    if (!silentAbort) console.error(`Failed to kill job ${id}`, err);
    return { ok: false, status: 500, payload: { error: String(err) } };
  }
};
const deleteJobPidFile = (id) => {
  try {
    const p = jobPidPathFor(id);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {
    // ignore
  }
};

// util: check if pid is alive
const pidAlive = (p) => {
  if (!p) return false;
  try {
    process.kill(p, 0);
    return true;
  } catch (e) {
    return false;
  }
};

// Try to extract the output_dir value from a child process spawnargs array
const extractOutputDirFromSpawnArgs = (spawnargs) => {
  try {
    if (!Array.isArray(spawnargs)) return null;
    for (let i = 0; i < spawnargs.length; i++) {
      const a = String(spawnargs[i] || '');
      if (a === '--output_dir' || a === '--output-dir' || a === '--output') {
        return String(spawnargs[i+1] || null) || null;
      }
      // also support --output_dir=... form
      if (a.startsWith('--output_dir=') || a.startsWith('--output-dir=') || a.startsWith('--output=')) {
        const parts = a.split('=');
        return parts.slice(1).join('=') || null;
      }
    }
  } catch (e) {}
  return null;
};

// Scan persisted job-pid files and current processes to find orphaned generate_cache.py jobs
const scanForOrphanJobsOnStartup = () => {
  try {
    const files = fs.readdirSync(jobPidDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const full = path.join(jobPidDir, f);
        const raw = fs.readFileSync(full, 'utf-8');
        const parsed = JSON.parse(raw);
        const existing = runningJobs.get(parsed.id);
        if (existing) {
          // job is active in memory, remove pid file
          try { fs.unlinkSync(full); } catch {};
          continue;
        }
        // if pid alive, mark as orphan
        if (parsed.pid && pidAlive(parsed.pid)) {
          orphanJobs.set(parsed.id, { id: parsed.id, pid: parsed.pid, infoFile: full, data: parsed, detectedAt: Date.now() });
          console.warn(`[cache-orphan] Detected orphaned job ${parsed.id} pid=${parsed.pid} (from ${full})`);
        } else {
          // maybe process died, but leave info file for manual inspection
        }
      } catch (e) {
        // ignore per-file errors
      }
    }
    // also try detecting any generate_cache.py processes not recorded
    const pids = findProcessPidsByCommandLine('generate_cache.py') || [];
    for (const pid of pids) {
      // if not already in runningJobs or orphanJobs, register a synthetic orphan id
      const already = Array.from(runningJobs.values()).some(j => j.proc && j.proc.pid === pid) || Array.from(orphanJobs.values()).some(o => o.pid === pid);
      if (!already) {
        const syntheticId = `orphan-${pid}`;
        orphanJobs.set(syntheticId, { id: syntheticId, pid, infoFile: null, data: { synthetic: true }, detectedAt: Date.now() });
        console.warn(`[cache-orphan] Detected unrecorded generate_cache.py process pid=${pid}`);
      }
    }
  } catch (e) {
    console.warn('Failed to scan for orphan jobs on startup', e?.message || e);
  }
};

// run scan now
scanForOrphanJobsOnStartup();
// control sencillo de concurrencia y duplicados
const activeKeys = new Set(); // key = `${project||''}:${layer}`
const JOB_MAX = parseInt(process.env.JOB_MAX || "4", 10); // máximo de procesos concurrentes

registerProjectRoutes({
  app,
  crypto,
  security,
  requireAdmin,
  ensureProjectAccess,
  sanitizeProjectId,
  resolveProjectAccessEntry,
  readProjectAccessSnapshot,
  deriveProjectAccess,
  isProjectPublic,
  buildProjectDescriptor,
  listProjects,
  findProjectById,
  projectsDir,
  path,
  fs,
  projectUpload,
  allowedProjectExtensions,
  bootstrapProjectCacheIndex,
  runningJobs,
  activeKeys,
  cancelProjectTimer,
  projectConfigCache,
  projectLogLastMessage,
  projectBatchCleanupTimers,
  projectBatchRuns,
  removeProjectAccessEntry,
  purgeProjectFromAuthUsers,
  removeProjectLogs,
  cacheDir,
  tileGridDir,
  invalidateTileGridCaches,
  pythonDir,
  pythonExe,
  runPythonViaOSGeo4W,
  extractJsonLike,
  readProjectConfig,
  buildProjectConfigPatch,
  updateProjectConfig,
  getProjectConfigPath,
  deleteLayerCacheInternal,
  updateProjectBatchRun,
  runRecacheForProject,
  logProjectEvent,
  buildPublicProjectsListing,
  resolvePublicProject
});

registerWmsRoutes({
  app,
  cacheDir,
  tileGridDir,
  tileRendererPool,
  ensureProjectAccessFromQuery,
  findProjectById
});

registerWfsRoutes({
  app,
  tileRendererPool,
  ensureProjectAccessFromQuery,
  requireAdmin,
  findProjectById,
  readProjectConfig,
  logProjectEvent
});

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

  // Backward-compatibility: older callers may send scheme=wmts, but generate_cache.py expects {auto, xyz, custom}.
  const normalizedScheme = (typeof scheme === 'string' && scheme.trim().toLowerCase() === 'wmts')
    ? 'custom'
    : scheme;

  const normalizedTileCrs = (typeof tile_crs === "string" && tile_crs.trim().toUpperCase() === "AUTO")
    ? null
    : tile_crs;
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
      normalizedTileCrs,
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
    "--scheme", normalizedScheme,
    "--xyz_mode", xyz_mode
  );
  if (normalizedTileCrs) {
    args.push("--tile_crs", normalizedTileCrs);
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
  // Attach job id so we can reliably find/abort the real python process even when spawned via shell/batch on Windows.
  try { args.push('--job_id', String(id)); } catch {}
  const proc = runPythonViaOSGeo4W(script, args, {});
  console.log("Launching python generate_cache.py with args:", args);

  const runReason = typeof req.body.run_reason === "string" && req.body.run_reason.trim() ? req.body.run_reason.trim() : null;
  const trigger = typeof req.body.trigger === "string" && req.body.trigger.trim() ? req.body.trigger.trim() : (runReason === "scheduled" ? "timer" : null);
  const viewerSessionId = (typeof req.body.viewer_session_id === 'string' && req.body.viewer_session_id.trim())
    ? req.body.viewer_session_id.trim()
    : null;
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
    requestedTileCrs: normalizedTileCrs,
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
    viewerSessionId,
    runId: typeof req.body.run_id === "string" && req.body.run_id.trim() ? req.body.run_id.trim() : null,
    batchIndex: Number.isFinite(batchIndexVal) ? batchIndexVal : null,
    batchTotal: Number.isFinite(batchTotalVal) ? batchTotalVal : null
  };
  runningJobs.set(id, job);
  // persist pid/metadata so we can detect orphans if the server restarts
  try { writeJobPidFile(job); } catch (e) { /* ignore */ }

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
    if (projectKey) {
      try { logProjectEvent(projectKey, `[job ${id} stderr] ${s.trim()}`, "error"); } catch { }
    }
  });

  proc.on("error", err => {
    console.error(`[job ${id} spawn error]`, err);
  });

  proc.on("close", code => {
    console.log(`python job ${id} exited ${code}`);
    job.exitCode = code;
    if (job.status === 'aborted' || job.status === 'aborting') {
      job.status = 'aborted';
    } else {
      job.status = code === 0 ? "completed" : "error";
    }
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
        const lastMessage = job.status === "completed"
          ? "Cache generation completed"
          : (job.stderr ? job.stderr.trim().split(/\r?\n/).slice(-5).join(" | ") : "Cache generation failed");
        if (job.status !== "completed") {
          try { logProjectEvent(projectKey, `Cache job ${id} failed (${jobLabel}): ${lastMessage}`, "error"); } catch { }
        }
        const update = targetMode === "theme"
          ? { themes: { [targetName]: { lastResult: job.status, lastMessage, lastRunAt: new Date(job.endedAt).toISOString() } } }
          : { layers: { [layer]: { lastResult: job.status, lastMessage, lastRunAt: new Date(job.endedAt).toISOString() } } };
        updateProjectConfig(projectKey, update);
      } catch (cfgErr) {
        console.warn("Failed to update project config with job result", cfgErr);
      }
    }

    try { activeKeys.delete(key); } catch { }

    const ttlMs = parseInt(process.env.JOB_TTL_MS || "300000", 10);
    job.cleanupTimer = setTimeout(() => {
      runningJobs.delete(id);
      try { deleteJobPidFile(id); } catch (e) { }
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
          tileCrs: normalizedTileCrs || null,
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
app.delete("/generate-cache/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  const result = await abortGenerateCacheJobInternal(id, { silentAbort: false });
  if (!result.ok) return res.status(result.status).json(result.payload);
  return res.status(result.status).json(result.payload);
});

// POST alias for tab-close (sendBeacon) scenarios.
app.post('/generate-cache/:id/abort', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const result = await abortGenerateCacheJobInternal(id, { silentAbort: true });
  if (!result.ok) return res.status(result.status).json(result.payload);
  return res.status(result.status).json(result.payload);
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
// Se pasa un array [] con las dos variantes de la ruta en lugar de usar ?
app.delete(
  ["/generate-cache/abort-all/:project", "/generate-cache/abort-all/:project/:layer"],
  requireAdmin,
  async (req, res) => {
    const { project, layer } = req.params;
    if (!project) return res.status(400).json({ error: "project_required" });

    let aborted = 0;
    let lastAbortedIds = [];
    let attempts = 0;
    const maxAttempts = 30;
    let stillRunning = true;

    while (stillRunning && attempts < maxAttempts) {
      attempts++;
      let found = false;
      lastAbortedIds = [];
      for (const [id, job] of runningJobs.entries()) {
        if (job.project === project && (!layer || job.layer === layer || job.targetName === layer)) {
          found = true;
          lastAbortedIds.push(id);
          try {
            if (job.proc && !job.proc.killed) job.proc.kill();
            job.status = "aborted";
            job.endedAt = Date.now();
            try {
              activeKeys.delete(job.key || `${job.project || ''}:${job.targetMode || 'layer'}:${job.targetName || job.layer}`);
            } catch { }
            clearTimeout(job.cleanupTimer);
            job.cleanupTimer = setTimeout(() => {
              runningJobs.delete(id);
              try { deleteJobPidFile(id); } catch (e) { }
            }, parseInt(process.env.JOB_TTL_MS || "300000", 10));
            aborted++;
          } catch (e) {
            console.warn(`Failed to abort job ${id}`, e);
          }
        }
      }
      // Esperar 1 segundo antes de volver a chequear
      await new Promise(r => setTimeout(r, 1000));
      // Verificar si quedan jobs activos para este proyecto/capa
      stillRunning = false;
      for (const [id, job] of runningJobs.entries()) {
        if (job.project === project && (!layer || job.layer === layer || job.targetName === layer)) {
          stillRunning = true;
          break;
        }
      }
    }

    res.json({
      status: "aborted",
      project,
      layer: layer || null,
      aborted,
      attempts,
      remaining: lastAbortedIds
    });
  }
);

app.delete('/cache/:project/:name', requireAdmin, async (req, res) => {
  const project = req.params.project;
  const name = req.params.name;
  const force = (req.query && (req.query.force === '1' || req.query.force === 'true')) || false;
  const layerPath = path.join(cacheDir, project, name);
  const themePath = path.join(cacheDir, project, '_themes', name);
  try {
    if (fs.existsSync(layerPath)) {
      await deleteLayerCacheInternal(project, name, { force: Boolean(force), silent: false });
      return res.json({ status: 'deleted', project, layer: name, path: layerPath, force });
    }
    if (fs.existsSync(themePath)) {
      await deleteThemeCacheInternal(project, name, { force: Boolean(force), silent: false });
      return res.json({ status: 'deleted', project, theme: name, path: themePath, force });
    }
    // Cambia esto:
    // return res.status(404).json({ error: 'cache_not_found', project, name });
    // Por esto:
    return res.json({ status: 'already_deleted', project, name });
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

// Obtener detalles de un job (estado y logs)
app.get("/generate-cache/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  const job = runningJobs.get(id);
  // In cluster mode the request may hit a different worker, so fall back to
  // persisted pid metadata + project config progress.
  if (!job) {
    try {
      const metaPath = jobPidPathFor(id);
      if (!fs.existsSync(metaPath)) {
        return res.status(404).json({ error: "job not found" });
      }
      const raw = fs.readFileSync(metaPath, 'utf8');
      const meta = JSON.parse(raw);
      const projectId = meta.project || null;
      const targetMode = meta.targetMode || null;
      const targetName = meta.targetName || null;

      // Determine liveness: prefer job_id match, fall back to recorded pid.
      const aliveByJobId = (findProcessPidsByCommandLineAll(['generate_cache.py', String(id)]) || []);
      const aliveByPid = meta.pid && pidAlive(meta.pid);
      const isAlive = (aliveByJobId && aliveByJobId.length) || aliveByPid;

      // Pull latest progress from project config (persisted by the worker running the job).
      let progressInfo = null;
      if (projectId && targetName) {
        try {
          const cfg = readProjectConfig(projectId, { useCache: false });
          const entry = targetMode === 'theme'
            ? (cfg && cfg.themes && cfg.themes[targetName])
            : (cfg && cfg.layers && cfg.layers[targetName]);
          if (entry && entry.progress) {
            progressInfo = entry.progress;
          }
        } catch (e) {
          progressInfo = null;
        }
      }

      const statusFromProgress = progressInfo && progressInfo.status ? String(progressInfo.status) : null;
      const status = isAlive ? 'running' : (statusFromProgress || 'unknown');
      const percent = (progressInfo && typeof progressInfo.percent === 'number') ? progressInfo.percent : null;
      const totalGenerated = progressInfo && Number.isFinite(Number(progressInfo.totalGenerated)) ? Number(progressInfo.totalGenerated) : null;
      const expectedTotal = progressInfo && Number.isFinite(Number(progressInfo.expectedTotal)) ? Number(progressInfo.expectedTotal) : null;

      // Provide a synthetic stdout JSON line so the frontend progress parser still works.
      const syntheticLine = JSON.stringify({ status, percent, total_generated: totalGenerated, expected_total: expectedTotal, source: 'cluster-fallback' });

      const tail = parseInt(req.query.tail || "0", 10);
      const clip = (s) => {
        if (!s) return "";
        if (!tail || isNaN(tail) || tail <= 0) {
          const MAX = 50000;
          return s.length > MAX ? s.slice(-MAX) : s;
        }
        return s.length > tail ? s.slice(-tail) : s;
      };

      return res.json({
        id,
        layer: meta.layer || null,
        startedAt: meta.startedAt || null,
        endedAt: null,
        status,
        exitCode: null,
        stdout: clip(syntheticLine + "\n"),
        stderr: "",
        meta: { project: projectId, targetMode, targetName, pid: meta.pid || null, pids: aliveByJobId || [] }
      });
    } catch (e) {
      return res.status(500).json({ error: 'job_status_failed', details: String(e) });
    }
  }
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

// Diagnostics: inspect processes related to a job and optionally force-kill them
app.post('/generate-cache/admin/:id/diagnose', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const job = runningJobs.get(id);
  if (!job) return res.status(404).json({ error: 'job_not_found' });
  const pid = job.proc && job.proc.pid ? job.proc.pid : null;
  const found = findProcessPidsByCommandLine('generate_cache.py');
  // attempt to discover descendant PIDs of the recorded proc PID
  let descendants = [];
  try {
    if (pid) descendants = findDescendantPids(pid) || [];
  } catch (e) { descendants = []; }
  const response = { id, jobStatus: job.status || 'running', procPid: pid, foundCommandLinePids: found, foundDescendantPids: descendants };
  if (req.query.kill === '1' || req.body && req.body.kill) {
    try {
      // attempt to kill parent pid first
      const results = [];
      const toKill = new Set();
      if (pid) toKill.add(Number(pid));
      if (Array.isArray(found)) for (const p of found) toKill.add(Number(p));
      if (Array.isArray(descendants)) for (const p of descendants) toKill.add(Number(p));
      // also try finding by output_dir matching (best-effort)
      try {
        const outMatches = findProcessPidsByCommandLine((job.metadata && job.metadata.output_dir) ? job.metadata.output_dir : '');
        if (outMatches && outMatches.length) for (const p of outMatches) toKill.add(Number(p));
      } catch (e) { }

      const killResults = [];
      for (const p of Array.from(toKill).filter(Number.isFinite)) {
        try {
          const tk = spawnSync('taskkill', ['/PID', String(p), '/T', '/F'], { shell: true, timeout: 5000 });
          killResults.push({ pid: p, code: tk.status, stdout: (tk.stdout||'').toString(), stderr: (tk.stderr||'').toString() });
        } catch (e) {
          killResults.push({ pid: p, error: String(e) });
        }
      }
      results.push({ killed: killResults });
      response.killResults = results;
    } catch (e) {
      response.killError = String(e);
    }
  }
  return res.json(response);
});

// List orphaned jobs detected on startup
app.get('/generate-cache/admin/orphans', requireAdmin, (req, res) => {
  const list = Array.from(orphanJobs.values()).map(o => ({ id: o.id, pid: o.pid, infoFile: o.infoFile, data: o.data, detectedAt: o.detectedAt }));
  res.json(list);
});

// Kill an orphaned job by id (recorded or synthetic)
app.post('/generate-cache/admin/orphans/:id/kill', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const entry = orphanJobs.get(id);
  if (!entry) return res.status(404).json({ error: 'orphan_not_found' });
  const pid = entry.pid;
  const results = [];
  try {
    if (pid) {
      const tk = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: true, timeout: 5000 });
      results.push({ pid, code: tk.status, stdout: (tk.stdout||'').toString(), stderr: (tk.stderr||'').toString() });
    }
    // also attempt additional kills by commandline match
    const extra = findProcessPidsByCommandLine('generate_cache.py');
    if (extra && extra.length) {
      const fk = forceKillPids(extra);
      results.push({ byCommandLine: fk });
    }
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
  try { if (entry.infoFile) fs.unlinkSync(entry.infoFile); } catch (e) {}
  orphanJobs.delete(id);
  return res.json({ id, results });
});

// Admin helper: kill arbitrary PID (requires admin). Body: { pid: <number> }
app.post('/admin/kill-pid', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const pid = Number.isFinite(Number(body.pid)) ? Number(body.pid) : null;
    if (!pid) return res.status(400).json({ error: 'invalid_pid' });
    try {
      const tk = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: true, timeout: 5000 });
      return res.json({ pid, code: tk.status, stdout: (tk.stdout||'').toString(), stderr: (tk.stderr||'').toString() });
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
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
  const filterLayerRaw = options.filterLayerName != null ? String(options.filterLayerName).trim() : "";
  const filterLayerNorm = filterLayerRaw ? normalizeIdentifier(filterLayerRaw, "layer") : "";
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
      const profileSource = typeof layerEntry.tile_profile_source === 'string' ? layerEntry.tile_profile_source.toLowerCase() : '';
      const preferPreset = !!(layerPresetId && (layerPresetId.toUpperCase().startsWith('SCALES_') || profileSource === 'project_scales'));
      if ((!rawTileMatrixSet || preferPreset) && layerPresetId) {
        const presetDef = getTileMatrixPresetRaw(layerPresetId);
        if (presetDef && (Array.isArray(presetDef.matrices) || Array.isArray(presetDef.matrixSet))) {
          try {
            rawTileMatrixSet = normalizeTileMatrixSetForExtent(presetDef, layerEntry.extent);
          } catch (err) {
            rawTileMatrixSet = normalizeTileMatrixSetForExtent(presetDef, layerEntry.extent);
          }
        }
      }
      const hasCustomSet = rawTileMatrixSet && (Array.isArray(rawTileMatrixSet.matrices) || Array.isArray(rawTileMatrixSet.matrixSet));
      const isWebMercator = scheme === "xyz" && tileCrs === "EPSG:3857";
      if (!hasCustomSet && !isWebMercator) continue;

      const layerName = layerEntry.name || layerEntry.layer || layerEntry.theme || "layer";
      const storageName = layerEntry.layer || layerEntry.theme || layerEntry.name || layerName;

      if (filterLayerRaw) {
        const candidateRaw = String(layerName ?? '').trim();
        const candidateNorm = normalizeIdentifier(candidateRaw, 'layer');
        const candidateStorageNorm = normalizeIdentifier(String(storageName ?? '').trim(), 'layer');
        const matches = (candidateRaw === filterLayerRaw)
          || (filterLayerNorm && candidateNorm && filterLayerNorm === candidateNorm)
          || (filterLayerNorm && candidateStorageNorm && filterLayerNorm === candidateStorageNorm);
        if (!matches) continue;
      }

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

    // GIS clients (incl. QGIS) benefit a lot from HTTP caching.
    setWmtsTileCacheHeaders(res);

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
      // If the tile exists but looks invalid (empty/partial), delete it and re-render.
      if (!err) {
        const deleted = deleteTileFileIfInvalid(filePath);
        if (!deleted) {
          return res.sendFile(filePath, (sendErr) => {
            if (sendErr) {
              console.warn("WMTS REST tile send failed", {
                project: layer.project,
                layer: layer.layerName,
                tileMatrixId,
                tileCol,
                tileRow,
                error: sendErr?.message
              });
              if (!res.headersSent) res.status(500).send("Failed to deliver tile");
            }
          });
        }
        // treat as missing after deletion
        err = new Error('invalid_tile_deleted');
      }

      if (err) {
        // Tile missing (or invalid): render on-demand and respond with the generated image.
        try {
          const renderParams = { project: layer.project, layer: layer.layerName, z: sourceLevel, x: tileCol, y: tileRow };
          return queueTileRender(renderParams, filePath, (qerr, outFile) => {
            if (qerr) {
              logProjectEvent(layer.project, `On-demand render failed for ${filePath}: ${String(qerr)}`);
              if (!res.headersSent) return res.status(500).send("Generation failed");
              return;
            }
            logProjectEvent(layer.project, `On-demand render completed: ${outFile}`);
            if (!res.headersSent) return res.sendFile(outFile);
          });
        } catch (queueErr) {
          console.warn('Failed to queue tile render', queueErr);
          if (!res.headersSent) return res.status(500).send("Generation failed");
        }
      }
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

const findMatrixForZoom = (tileMatrixSet, zoom) => {
  if (!tileMatrixSet || !Array.isArray(tileMatrixSet.matrices)) return null;
  for (const m of tileMatrixSet.matrices) {
    if (!m) continue;
    if (typeof m.z === 'number' && m.z === zoom) return m;
    if (typeof m.source_level === 'number' && m.source_level === zoom) return m;
    const idNum = Number.parseInt(m.identifier ?? m.id, 10);
    if (Number.isFinite(idNum) && idNum === zoom) return m;
  }
  return null;
};

const getOriginFromTileMatrixSet = (tileMatrixSet) => {
  if (!tileMatrixSet || typeof tileMatrixSet !== 'object') return null;
  const origin = tileMatrixSet.top_left_corner || tileMatrixSet.topLeftCorner || tileMatrixSet.top_left || null;
  if (!Array.isArray(origin) || origin.length !== 2) return null;
  const ox = Number(origin[0]);
  const oy = Number(origin[1]);
  if (!Number.isFinite(ox) || !Number.isFinite(oy)) return null;
  return [ox, oy];
};

const computeTileBBoxFromTileMatrixSet = (tileMatrixSet, z, x, y) => {
  if (!tileMatrixSet) return null;
  const origin = getOriginFromTileMatrixSet(tileMatrixSet);
  if (!origin) return null;
  const matrix = findMatrixForZoom(tileMatrixSet, z);
  if (!matrix) return null;

  const tileWidth = Number(tileMatrixSet.tile_width || tileMatrixSet.tileWidth || matrix.tileWidth || 256);
  const tileHeight = Number(tileMatrixSet.tile_height || tileMatrixSet.tileHeight || matrix.tileHeight || 256);
  if (!Number.isFinite(tileWidth) || !Number.isFinite(tileHeight) || tileWidth <= 0 || tileHeight <= 0) return null;

  let res = Number(matrix.resolution);
  if (!Number.isFinite(res) && Number.isFinite(Number(matrix.scale_denominator))) {
    res = Number(matrix.scale_denominator) * 0.00028;
  }
  if (!Number.isFinite(res) || res <= 0) return null;

  const [originX, originY] = origin;
  const minx = originX + Number(x) * tileWidth * res;
  const maxx = minx + tileWidth * res;
  const maxy = originY - Number(y) * tileHeight * res;
  const miny = maxy - tileHeight * res;
  if (![minx, miny, maxx, maxy].every(Number.isFinite)) return null;
  return [minx, miny, maxx, maxy];
};

const normalizeTileMatrixSetForExtent = (tileMatrixSet, extent) => {
  if (!tileMatrixSet || typeof tileMatrixSet !== 'object') return tileMatrixSet;
  const cleanExtent = sanitizeExtentCoordinates(extent);
  if (!cleanExtent) return tileMatrixSet;

  const minX = Number(cleanExtent[0]);
  const minY = Number(cleanExtent[1]);
  const maxX = Number(cleanExtent[2]);
  const maxY = Number(cleanExtent[3]);
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return tileMatrixSet;
  if (!(maxX > minX) || !(maxY > minY)) return tileMatrixSet;

  let cloned;
  try {
    cloned = JSON.parse(JSON.stringify(tileMatrixSet));
  } catch {
    cloned = { ...tileMatrixSet };
  }

  const matrices = Array.isArray(cloned.matrices)
    ? cloned.matrices
    : (Array.isArray(cloned.matrixSet) ? cloned.matrixSet : null);
  if (!matrices) return cloned;

  const tileWidth = Number(cloned.tile_width || cloned.tileWidth || 256);
  const tileHeight = Number(cloned.tile_height || cloned.tileHeight || 256);
  if (!Number.isFinite(tileWidth) || tileWidth <= 0 || !Number.isFinite(tileHeight) || tileHeight <= 0) return cloned;

  // IMPORTANT:
  // - Many presets (e.g. Swedish EPSG:3006 grids) already have correct matrixWidth/Height
  //   for their fixed topLeftCorner.
  // - If we recompute using only the layer extent size, we can accidentally *shrink* the matrix
  //   and cause tiles to 404 at higher zooms (viewer shows shifted tiles / disappears on zoom-in).
  // So we compute the minimum matrix size needed to cover the extent from the declared origin,
  // and we never reduce existing matrix sizes.
  const origin = getOriginFromTileMatrixSet(cloned);
  const originX = origin ? origin[0] : null;
  const originY = origin ? origin[1] : null;

  for (const m of matrices) {
    if (!m || typeof m !== 'object') continue;
    let res = Number(m.resolution);
    if (!Number.isFinite(res) && Number.isFinite(Number(m.scale_denominator))) {
      res = Number(m.scale_denominator) * 0.00028;
    }
    if (!Number.isFinite(res) || res <= 0) continue;

    const spanX = tileWidth * res;
    const spanY = tileHeight * res;

    const existingWidth = Number(m.matrix_width || m.matrixWidth) || 0;
    const existingHeight = Number(m.matrix_height || m.matrixHeight) || 0;

    let requiredWidth = 0;
    let requiredHeight = 0;
    if (Number.isFinite(originX) && Number.isFinite(originY)) {
      requiredWidth = Math.max(1, Math.ceil((maxX - originX) / spanX));
      requiredHeight = Math.max(1, Math.ceil((originY - minY) / spanY));
    } else {
      // Fallback: if origin is missing, at least cover the extent width/height.
      requiredWidth = Math.max(1, Math.ceil((maxX - minX) / spanX));
      requiredHeight = Math.max(1, Math.ceil((maxY - minY) / spanY));
    }

    // Never reduce matrix sizes.
    m.matrix_width = Math.max(existingWidth, requiredWidth);
    m.matrix_height = Math.max(existingHeight, requiredHeight);
  }

  if (Array.isArray(cloned.matrices)) cloned.matrices = matrices;
  if (Array.isArray(cloned.matrixSet)) cloned.matrixSet = matrices;
  return cloned;
};

const deriveOnDemandTileGrid = (projectId, targetMode, targetName) => {
  try {
    const idx = loadProjectIndexData(projectId);
    const layers = Array.isArray(idx?.layers) ? idx.layers : [];
    const entry = layers.find((e) => {
      if (!e || !e.name) return false;
      const kind = e.kind || 'layer';
      return kind === targetMode && e.name === targetName;
    }) || null;
    if (!entry) return null;
    const tileCrs = typeof entry.tile_crs === 'string' && entry.tile_crs.trim() ? entry.tile_crs.trim().toUpperCase() : null;
    let tileMatrixSet = entry.tile_matrix_set || entry.tileMatrixSet || null;
    const presetIdRaw = typeof entry.tile_matrix_preset === 'string' ? entry.tile_matrix_preset.trim() : '';
    const presetId = presetIdRaw && presetIdRaw.endsWith('.json') ? presetIdRaw.replace(/\.json$/i, '') : presetIdRaw;
    const profileSource = String(entry.tile_profile_source || entry.tileProfileSource || '').toLowerCase();
    const preferPreset = !!(presetId && (presetId.toUpperCase().startsWith('SCALES_') || profileSource === 'project_scales'));
    if ((preferPreset || !tileMatrixSet) && presetId) {
      const preset = getTileMatrixPresetRaw(presetId);
      if (preset && typeof preset === 'object') {
        tileMatrixSet = normalizeTileMatrixSetForExtent(preset, entry.extent);
      }
    }
    return { tileCrs, tileMatrixSet, entry };
  } catch {
    return null;
  }
};

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
app.get("/cache/:project/index.json", ensureProjectAccess((req) => req.params.project), (req, res) => {
  try {
    const p = req.params.project;
    const pIndex = path.join(cacheDir, p, "index.json");
    if (fs.existsSync(pIndex)) {
      try {
        const raw = fs.readFileSync(pIndex, 'utf8');
        const data = raw ? JSON.parse(raw) : null;
        if (data && typeof data === 'object') {
          const layers = Array.isArray(data.layers) ? data.layers : [];
          // Compute a cheap/accurate "has_tiles" boolean for UI.
          // This avoids relying on tile_count, which may be absent for on-demand caches.
          data.layers = layers.map((entry) => {
            if (!entry || typeof entry !== 'object') return entry;
            const out = { ...entry };

            // Prefer persisted scale-derived presets over embedded tile_matrix_set.
            // Embedded definitions can become stale across versions.
            try {
              let presetIdRaw = typeof out.tile_matrix_preset === 'string' ? out.tile_matrix_preset.trim() : '';
              if (!presetIdRaw && out.tile_matrix_set && typeof out.tile_matrix_set.id === 'string') {
                presetIdRaw = out.tile_matrix_set.id.trim();
              }
              const presetId = presetIdRaw && presetIdRaw.endsWith('.json') ? presetIdRaw.replace(/\.json$/i, '') : presetIdRaw;
              const profileSource = String(out.tile_profile_source || out.tileProfileSource || '').toLowerCase();
              const isScalePreset = !!(presetId && (presetId.toUpperCase().startsWith('SCALES_') || profileSource === 'project_scales'));
              if (isScalePreset) {
                const preset = getTileMatrixPresetRaw(presetId);
                if (preset && typeof preset === 'object') {
                  out.tile_matrix_set = normalizeTileMatrixSetForExtent(preset, out.extent);
                }
              }
            } catch {}

            // Backfill zoom range from tile_matrix_set when missing.
            // Some on-demand entries may not have zoom_min/zoom_max yet, but the viewer needs them.
            try {
              if ((!Number.isFinite(Number(out.zoom_min)) || !Number.isFinite(Number(out.zoom_max)))
                && out.tile_matrix_set && Array.isArray(out.tile_matrix_set.matrices)) {
                const zs = out.tile_matrix_set.matrices
                  .map((m) => {
                    if (!m) return null;
                    if (Number.isFinite(Number(m.z))) return Number(m.z);
                    if (Number.isFinite(Number(m.source_level))) return Number(m.source_level);
                    const idNum = parseInt(m.identifier, 10);
                    return Number.isFinite(idNum) ? idNum : null;
                  })
                  .filter((z) => Number.isFinite(z));
                if (zs.length) {
                  const minZ = Math.min(...zs);
                  const maxZ = Math.max(...zs);
                  if (!Number.isFinite(Number(out.zoom_min))) out.zoom_min = minZ;
                  if (!Number.isFinite(Number(out.zoom_max))) out.zoom_max = maxZ;
                  if (!Number.isFinite(Number(out.published_zoom_min))) out.published_zoom_min = out.zoom_min;
                  if (!Number.isFinite(Number(out.published_zoom_max))) out.published_zoom_max = out.zoom_max;
                }
              }
            } catch {}

            // If this looks like a scale-derived preset but the source flag is missing, backfill it.
            try {
              const presetId = typeof out.tile_matrix_preset === 'string' ? out.tile_matrix_preset.trim() : '';
              if (presetId && presetId.toUpperCase().startsWith('SCALES_') && !out.tile_profile_source) {
                out.tile_profile_source = 'project_scales';
              }
            } catch {}

            const count = Number(out.tile_count ?? out.tiles ?? out.tileCount);
            if (Number.isFinite(count) && count > 0) {
              out.has_tiles = true;
              return out;
            }
            out.has_tiles = hasAnyTileFiles(out.path);
            return out;
          });
          return res.json(data);
        }
      } catch (err) {
        console.warn('Failed to read/augment index.json for', p, err);
        // fall through to sendFile as last resort
      }
      return res.sendFile(pIndex);
    }
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

// Patch index.json for a project: update/merge layer entries
app.patch("/cache/:project/index.json", requireAdmin, async (req, res) => {
  const p = req.params.project;
  const proj = findProjectById(p);
  if (!proj) return res.status(404).json({ error: "project_not_found" });
  const body = req.body || {};
  if (!body.layers || typeof body.layers !== 'object') {
    return res.status(400).json({ error: 'invalid_payload', message: 'Expected { layers: { <name>: { ... } } }' });
  }
  const pIndexPath = path.join(cacheDir, p, 'index.json');
  let index = { project: proj.file || null, id: p, created: new Date().toISOString(), layers: [] };
  try {
    if (fs.existsSync(pIndexPath)) {
      const raw = fs.readFileSync(pIndexPath, 'utf8');
      if (raw) index = JSON.parse(raw);
    }
  } catch (err) {
    console.warn('Failed to read existing index.json for patch', p, err);
  }
  if (!Array.isArray(index.layers)) index.layers = [];

  const updatedLayers = [];
  const purgedLayers = [];
  for (const [layerName, layerData] of Object.entries(body.layers)) {
    if (!layerName || typeof layerName !== 'string') continue;
    const existingIdx = index.layers.findIndex((e) => e && e.name === layerName);
    const now = new Date().toISOString();
    const existing = existingIdx >= 0 ? index.layers[existingIdx] : null;
    const merged = Object.assign({}, existing || { name: layerName }, layerData);

    // detect technical changes that should purge cache
    const triggers = ['resolutions', 'tileGridId', 'extent', 'tile_matrix_set', 'tile_matrix_preset'];
    const needsPurge = triggers.some((t) => JSON.stringify(existing && existing[t] ? existing[t] : null) !== JSON.stringify(merged[t] ? merged[t] : null));

    if (needsPurge) {
      try {
        await deleteLayerCacheInternal(p, layerName, { force: true, silent: true });
        purgedLayers.push(layerName);
        // reload index from disk to pick up deleteLayerCacheInternal changes
        try {
          const raw2 = fs.readFileSync(pIndexPath, 'utf8');
          if (raw2) index = JSON.parse(raw2);
        } catch (e) { /* ignore */ }
      } catch (e) {
        console.warn(`Failed to purge cache for ${p}:${layerName} during index patch`, e);
      }
    }

    // ensure cache metadata is cleared after purge
    merged.cached_zoom_min = null;
    merged.cached_zoom_max = null;
    merged.cache_exists = false;
    merged.cache_removed_at = now;
    merged.updated = now;

    const finalIdx = index.layers.findIndex((e) => e && e.name === layerName);
    if (finalIdx >= 0) {
      index.layers[finalIdx] = merged;
    } else {
      index.layers.push(merged);
    }
    updatedLayers.push(layerName);
  }
  try {
    fs.writeFileSync(pIndexPath, JSON.stringify(index, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write index.json patch for', p, err);
    return res.status(500).json({ error: 'write_failed', details: String(err) });
  }
  try { logProjectEvent(p, `index.json patched for layers: ${updatedLayers.join(', ')}`); } catch {}
  const resp = { status: 'ok', project: p, updated: updatedLayers, purged: purgedLayers, index };
  return res.json(resp);
});

// Delete entire project cache (all layers + index)
app.delete("/cache/:project", requireAdmin, async (req, res) => {
  const p = req.params.project;
  const pDir = path.join(cacheDir, p);
  // abort running jobs for this project and wait confirmation; perform multi-stage escalation
  for (const [id, job] of Array.from(runningJobs.entries())) {
    if (job.project !== p || (job.status && job.status !== 'running')) continue;
    try {
      const jobPid = job.proc && job.proc.pid ? job.proc.pid : null;
      // mark aborted in-memory and release active key
      try { job.status = 'aborted'; job.endedAt = Date.now(); } catch {}
      try {
        const activeKey = job.key || `${job.project || ''}:${job.targetMode || 'layer'}:${job.targetName || job.layer}`;
        activeKeys.delete(activeKey);
      } catch { }

      // 1) gentle kill()
      try { if (job.proc && typeof job.proc.kill === 'function') job.proc.kill(); } catch (e) { }

      // wait a short grace for natural exit
      const graceMs = parseInt(process.env.ABORT_GRACE_MS || '1000', 10) || 1000;
      const pollInterval = 250;
      const maxWait = Math.max(2000, graceMs + 2000);
      let waited = 0;
      const procAlive = (pid) => {
        if (!pid) return false;
        try { process.kill(pid, 0); return true; } catch (e) { return false; }
      };
      while (procAlive(jobPid) && waited < maxWait) {
        await new Promise(r => setTimeout(r, pollInterval));
        waited += pollInterval;
      }

      // 2) taskkill escalation
      if (procAlive(jobPid)) {
        try {
          const tk = spawnSync('taskkill', ['/PID', String(jobPid), '/T', '/F'], { shell: true, timeout: 5000 });
          console.log(`project delete: taskkill for job ${id} pid=${jobPid} -> ${tk.status}`);
        } catch (e) { console.warn(`project delete: taskkill failed for job ${id}`, e?.message || e); }
        await new Promise(r => setTimeout(r, 500));
      }

      // 3) find by commandline / descendants / output dir / qgis and force kill
      if (procAlive(jobPid)) {
        try {
          const candidates = new Set();
          // commandline matches
          (findProcessPidsByCommandLine('generate_cache.py') || []).forEach(p => candidates.add(p));
          // descendants of recorded pid
          try {
            const desc = findDescendantPids(jobPid) || [];
            desc.forEach(p => candidates.add(p));
          } catch (e) { }
          // output dir
          try {
            const spawnargs = job.proc && job.proc.spawnargs ? job.proc.spawnargs : (job.proc && job.proc.argv ? job.proc.argv : null);
            const outputDir = job.tileBaseDir || extractOutputDirFromSpawnArgs(spawnargs) || null;
            if (outputDir) (findProcessPidsByCommandLine(outputDir) || []).forEach(p => candidates.add(p));
          } catch (e) { }
          // qgis binaries
          (findProcessPidsByCommandLine('qgis-bin.exe') || []).forEach(p => candidates.add(p));
          (findProcessPidsByCommandLine('qgis') || []).forEach(p => candidates.add(p));

          const candidateList = Array.from(candidates).filter(Number.isFinite);
          if (candidateList.length) {
            console.log(`project delete: killing candidate PIDs for job ${id}: ${JSON.stringify(candidateList)}`);
            const fk = forceKillPids(candidateList);
            console.log(`project delete kill results: ${JSON.stringify(fk)}`);
          }
        } catch (e) { console.warn('project delete: extra kill failed', e?.message || e); }
        // short wait
        await new Promise(r => setTimeout(r, 500));
      }

      // final wait loop for job removal
      let finalWait = 0;
      const finalMax = 10000;
      while (runningJobs.has(id) && finalWait < finalMax) {
        await new Promise(r => setTimeout(r, 200));
        finalWait += 200;
      }
      if (runningJobs.has(id)) {
        return res.status(500).json({ error: 'job_abort_failed', jobId: id, message: 'No se pudo abortar el proceso de cache tras 10s' });
      }
    } catch (e) {
      console.warn('project delete: error aborting job', id, e?.message || e);
      return res.status(500).json({ error: 'job_abort_failed', jobId: id, details: String(e) });
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
app.get('/wmts/debug/inventory', requireAdmin, (req, res) => {
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
app.get('/wmts/debug/tilepath', requireAdmin, (req, res) => {
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
// Coalesce duplicate in-flight tile requests (common with QGIS) without polling.
// key -> { filePath: string, callbacks: Function[] }
const inflightTileWaiters = new Map();

// Avoid excessive project-config/index writes when a client requests many tiles.
const ON_DEMAND_RECORD_THROTTLE_MS = (() => {
  const raw = process.env.ON_DEMAND_RECORD_THROTTLE_MS;
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  return 5000;
})();
const lastOnDemandRecordAt = new Map();

const WMTS_TILE_CACHE_MAX_AGE_S = (() => {
  const raw = process.env.WMTS_TILE_CACHE_MAX_AGE_S ?? process.env.TILE_CACHE_MAX_AGE_S;
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  return 3600; // 1h by default (safe-ish for on-demand tiles)
})();

const setWmtsTileCacheHeaders = (res) => {
  try {
    if (!res || typeof res.setHeader !== 'function') return;
    // Cacheable for GIS clients; tiles are file-backed and stable per z/x/y until cache is explicitly cleared.
    res.setHeader('Cache-Control', `public, max-age=${WMTS_TILE_CACHE_MAX_AGE_S}`);
  } catch {}
};
// Track viewer sessions that requested on-demand tile generation.
// This allows us to stop on-demand rendering when a viewer tab is closed.
const abortedOnDemandSessions = new Set();
const abortedOnDemandSessionTimers = new Map();
const onDemandPollersBySession = new Map(); // sid -> Set(interval)

// Admin emergency pause for on-demand rendering.
let onDemandPausedUntil = 0;
const isOnDemandPaused = () => Date.now() < onDemandPausedUntil;

const normalizeViewerSessionId = (value) => {
  const sid = String(value || '').trim();
  if (!sid) return null;
  // Accept UUID-ish / simple tokens only.
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(sid)) return null;
  return sid;
};

const markOnDemandSessionAborted = (sid) => {
  if (!sid) return;
  abortedOnDemandSessions.add(sid);
  const existing = abortedOnDemandSessionTimers.get(sid);
  if (existing) {
    try { clearTimeout(existing); } catch {}
  }
  // Keep the aborted marker for a while to prevent new work after close.
  const t = setTimeout(() => {
    abortedOnDemandSessions.delete(sid);
    abortedOnDemandSessionTimers.delete(sid);
  }, 5 * 60 * 1000);
  abortedOnDemandSessionTimers.set(sid, t);
};

const abortOnDemandSession = (sid) => {
  const sessionId = normalizeViewerSessionId(sid);
  if (!sessionId) return { ok: false, error: 'invalid_sid' };
  markOnDemandSessionAborted(sessionId);

  // Clear any polling intervals created for this session (dedup waiters).
  let clearedPollers = 0;
  const pollers = onDemandPollersBySession.get(sessionId);
  if (pollers && pollers.size) {
    for (const handle of Array.from(pollers)) {
      try { clearInterval(handle); clearedPollers += 1; } catch {}
    }
    pollers.clear();
  }
  onDemandPollersBySession.delete(sessionId);

  // Cancel queued (not yet started) tasks in the persistent Python pool.
  let cancelledQueued = 0;
  try {
    if (tileRendererPool && typeof tileRendererPool.cancelQueued === 'function') {
      cancelledQueued = tileRendererPool.cancelQueued((params) => {
        try { return params && params._sid && String(params._sid) === sessionId; } catch { return false; }
      });
    }
  } catch {}

  return { ok: true, sid: sessionId, cancelledQueued, clearedPollers };
};

// Public endpoint used by the viewer when closing.
app.post('/on-demand/abort', (req, res) => {
  const sid = (req.query && req.query.sid) || (req.body && req.body.sid);
  const result = abortOnDemandSession(sid);
  if (!result.ok) return res.status(400).json(result);
  return res.json(result);
});

// Admin: status for on-demand queue/active work.
app.get('/on-demand/status', requireAdmin, (req, res) => {
  const poolQueued = Number.isFinite(Number(tileRendererPool?.queue?.length)) ? Number(tileRendererPool.queue.length) : null;
  const pausedMs = isOnDemandPaused() ? Math.max(0, onDemandPausedUntil - Date.now()) : 0;
  return res.json({ ok: true, active: activeRenders.size, queued: renderQueue.length, poolQueued, pausedMs });
});

// Admin: abort all on-demand work (best-effort).
app.post('/on-demand/abort-all', requireAdmin, (req, res) => {
  const pauseMs = Number.isFinite(Number(req.body?.pauseMs))
    ? Math.max(0, Math.min(5 * 60 * 1000, Number(req.body.pauseMs)))
    : 60 * 1000;
  onDemandPausedUntil = Date.now() + pauseMs;

  let cancelledQueue = 0;
  try {
    if (Array.isArray(renderQueue) && renderQueue.length) {
      const items = renderQueue.splice(0, renderQueue.length);
      cancelledQueue = items.length;
      for (const item of items) {
        try { item?.cb?.(new Error('aborted'), null); } catch {}
      }
    }
  } catch {}

  let clearedPollers = 0;
  try {
    for (const set of onDemandPollersBySession.values()) {
      if (!set || !set.size) continue;
      for (const handle of Array.from(set)) {
        try { clearInterval(handle); clearedPollers += 1; } catch {}
      }
      try { set.clear(); } catch {}
    }
    onDemandPollersBySession.clear();
  } catch {}

  let poolAbort = null;
  try {
    if (tileRendererPool && typeof tileRendererPool.abortAll === 'function') {
      poolAbort = tileRendererPool.abortAll({ reason: 'aborted' });
    } else if (tileRendererPool && typeof tileRendererPool.close === 'function') {
      tileRendererPool.close();
      poolAbort = { closed: true };
    }
  } catch (e) {
    poolAbort = { error: String(e) };
  }

  return res.json({ ok: true, pausedMs: pauseMs, cancelledQueue, clearedPollers, pool: poolAbort });
});

// Public: abort a viewer session (tab close). Best-effort aborts both on-demand tile rendering
// (by sid) and any generate-cache jobs spawned from that viewer session.
app.post('/viewer/abort', async (req, res) => {
  const sid = (req.query && req.query.sid) || (req.body && (req.body.sid || req.body.viewer_session_id));
  const sessionId = normalizeViewerSessionId(sid);
  if (!sessionId) return res.status(400).json({ ok: false, error: 'invalid_sid' });

  const onDemand = abortOnDemandSession(sessionId);

  const toAbort = new Set();
  try {
    for (const job of Array.from(runningJobs.values())) {
      if (!job || job.status !== 'running') continue;
      if (job.viewerSessionId && String(job.viewerSessionId) === sessionId) {
        toAbort.add(String(job.id));
      }
    }
  } catch {}

  // Cross-worker: also scan persisted pid metadata.
  try {
    const files = fs.readdirSync(jobPidDir).filter((f) => f && f.endsWith('.json'));
    for (const f of files) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(jobPidDir, f), 'utf8'));
        if (meta && meta.id && meta.viewerSessionId && String(meta.viewerSessionId) === sessionId) {
          toAbort.add(String(meta.id));
        }
      } catch {}
    }
  } catch {}

  const abortedJobs = [];
  for (const jobId of Array.from(toAbort)) {
    try {
      const result = await abortGenerateCacheJobInternal(jobId, { silentAbort: true });
      if (result && result.ok) abortedJobs.push(jobId);
    } catch {}
  }

  return res.json({ ok: true, sid: sessionId, onDemand, abortedJobs });
});

const ENABLE_RENDER_FILE_LOGS = (() => {
  const raw = String(process.env.ENABLE_RENDER_FILE_LOGS || process.env.RENDER_FILE_LOGS || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
})();

// Invalid-tile detection: prefer structural PNG validation over file size.
// Many legitimate transparent tiles compress to very small files, so a byte-threshold
// causes false positives and 500s in the viewer.
const MIN_TILE_BYTES = (() => {
  // Only enforce a size threshold if explicitly configured.
  const env = process.env.MIN_TILE_BYTES ?? process.env.ON_DEMAND_MIN_TILE_BYTES;
  if (env == null || String(env).trim() === '') return 0;
  const raw = Number(env);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.floor(raw));
})();

const looksLikeValidPng = (filePath) => {
  try {
    // PNG signature (8 bytes) + length(4) + type(4) + IHDR data (at least 8 bytes for width/height)
    const fd = fs.openSync(filePath, 'r');
    try {
      const header = Buffer.alloc(24);
      const read = fs.readSync(fd, header, 0, header.length, 0);
      if (read < 24) return false;
      // 89 50 4E 47 0D 0A 1A 0A
      if (
        header[0] !== 0x89 || header[1] !== 0x50 || header[2] !== 0x4E || header[3] !== 0x47
        || header[4] !== 0x0D || header[5] !== 0x0A || header[6] !== 0x1A || header[7] !== 0x0A
      ) {
        return false;
      }
      const chunkType = header.toString('ascii', 12, 16);
      if (chunkType !== 'IHDR') return false;
      const width = header.readUInt32BE(16);
      const height = header.readUInt32BE(20);
      if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
      if (width <= 0 || height <= 0) return false;
      // Sanity cap to avoid pathological values.
      if (width > 16384 || height > 16384) return false;
      return true;
    } finally {
      try { fs.closeSync(fd); } catch {}
    }
  } catch {
    return false;
  }
};

const isLikelyInvalidTileFile = (filePath) => {
  if (!filePath) return true;
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return true;
    if (st.size <= 0) return true;
    if (MIN_TILE_BYTES > 0 && st.size < MIN_TILE_BYTES) return true;
    // If it's a PNG tile, validate it structurally.
    return !looksLikeValidPng(filePath);
  } catch {
    return true;
  }
};

const deleteTileFileIfInvalid = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return false;
    if (!isLikelyInvalidTileFile(filePath)) return false;
    try { fs.unlinkSync(filePath); } catch {}
    return true;
  } catch {
    return false;
  }
};



// --- FUNCIÓN ACTUALIZADA ---

function queueTileRender(params, filePath, cb) {
  if (isOnDemandPaused()) {
    try { cb(new Error('on_demand_paused'), null); } catch {}
    return;
  }
  const sessionId = normalizeViewerSessionId(params && (params.sid || params._sid));
  if (sessionId && abortedOnDemandSessions.has(sessionId)) {
    try { cb(new Error('session_aborted'), null); } catch {}
    return;
  }
  // Generar clave única para evitar duplicados simultáneos
  const key = `${params.project}|${params.layer || params.theme}|${params.z}|${params.x}|${params.y}`;

  // 1. Registro de métricas (throttled to reduce disk churn under heavy clients like QGIS)
  try {
    const targetMode = params.targetMode || (params.theme ? "theme" : "layer");
    const targetName = params.theme || params.layer || params.name || null;
    if (params.project && targetName) {
      const recordKey = `${params.project}|${targetMode}|${targetName}`;
      const now = Date.now();
      const last = lastOnDemandRecordAt.get(recordKey) || 0;
      if (ON_DEMAND_RECORD_THROTTLE_MS <= 0 || (now - last) >= ON_DEMAND_RECORD_THROTTLE_MS) {
        lastOnDemandRecordAt.set(recordKey, now);
        recordOnDemandRequest(params.project, targetMode, targetName);
      }
    }
  } catch (err) {
    console.warn("Failed to record on-demand metadata", { project: params.project, layer: params.layer || params.theme, error: err?.message || err });
  }

  // 2. Control de concurrencia para la misma tesela (no polling): coalesce callbacks.
  const inflight = inflightTileWaiters.get(key);
  if (inflight) {
    try {
      inflight.callbacks.push(cb);
    } catch {
      try { cb(new Error('dedupe_failed'), null); } catch {}
    }
    return;
  }
  inflightTileWaiters.set(key, { filePath, callbacks: [cb] });

  // 3. Marcar como activa
  activeRenders.add(key);

  // 4. Preparar la tarea para el Worker Persistente
  
  // Resolver ruta absoluta del proyecto.
  // Nota: projectsDir debe estar definido en tu scope global (normalmente path.resolve(__dirname, "qgisprojects"))
  // Si no tienes projectsDir a mano, usa: path.resolve(__dirname, 'qgisprojects', ...)
  const projFile = resolveProjectFilePath(params.project);
  const projectPath = projFile || path.resolve(projectsDir, `${params.project}.qgz`);

  // Calcular BBOX en el CRS del tile grid si existe (WMTS no-3857), si no, fallback EPSG:3857.
  const targetMode = params.targetMode || (params.theme ? 'theme' : 'layer');
  const targetName = params.theme || params.layer || params.name || null;
  let tileCrs = null;
  let bbox = null;
  if (params.project && targetName) {
    const grid = deriveOnDemandTileGrid(params.project, targetMode, targetName);
    if (grid && grid.tileCrs) tileCrs = grid.tileCrs;
    if (grid && grid.tileMatrixSet) {
      bbox = computeTileBBoxFromTileMatrixSet(grid.tileMatrixSet, Number(params.z), Number(params.x), Number(params.y));
    }
  }
  if (!bbox) {
    bbox = getTileBBox(Number(params.z), Number(params.x), Number(params.y));
    if (!tileCrs) tileCrs = 'EPSG:3857';
  }

  const task = {
    project_path: projectPath,
    output_file: filePath,
    z: Number(params.z),
    x: Number(params.x),
    y: Number(params.y),
    bbox: bbox,
    tile_crs: tileCrs,
    layer: params.layer,
    theme: params.theme,
    // Pasar preset si existe, para casos WMTS complejos
    tile_matrix_preset: params.tileMatrixPreset || null
  };
  if (sessionId) task._sid = sessionId;

  // 5. Enviar al Pool
  // tileRendererPool gestiona internamente la cola si todos los workers están ocupados
  tileRendererPool.renderTile(task)
    .then((result) => {
      // Limpiar estado
      activeRenders.delete(key);
      const waiters = inflightTileWaiters.get(key);
      inflightTileWaiters.delete(key);
      
      if (result.status === 'error' || result.error) {
        throw new Error(result.message || result.error || "Worker error");
      }

      // Validate output tile; if it's empty/partial, delete it so it can be regenerated.
      if (!fs.existsSync(filePath) || isLikelyInvalidTileFile(filePath)) {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
        throw new Error('invalid_tile_output');
      }
      
      // Éxito: devolver ruta del archivo
      if (waiters && Array.isArray(waiters.callbacks)) {
        for (const fn of waiters.callbacks) {
          try { fn(null, filePath); } catch {}
        }
      } else {
        cb(null, filePath);
      }
    })
    .catch((err) => {
      // Error
      activeRenders.delete(key);
      const waiters = inflightTileWaiters.get(key);
      inflightTileWaiters.delete(key);
      console.error(`[Pool Error] ${params.project} ${params.z}/${params.x}/${params.y}:`, err.message);
      
      // Intentar limpiar archivo corrupto/vacío si se creó
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch(e) {} 
      }
      
      if (waiters && Array.isArray(waiters.callbacks)) {
        for (const fn of waiters.callbacks) {
          try { fn(err, null); } catch {}
        }
      } else {
        cb(err, null);
      }
    });
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
    '--project', (resolveProjectFilePath(next.params.project) || path.join(__dirname, 'qgisprojects', `${next.params.project}.qgz`)),
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
  // Use wrapper batch file for Python invocation (moved to tools/)
  const wrapperBatch = path.join(__dirname, 'tools', 'run_qgis_python.bat');
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

    // Spawn the process via wrapper batch if present. If the wrapper is missing,
    // fall back to `PYTHON_EXE` (if defined and exists) or `python` on PATH.
    let proc;
    if (fs.existsSync(wrapperBatch)) {
      const comspec = process.env.ComSpec || 'cmd.exe';
      proc = spawn(comspec, ['/c', wrapperBatch, ...spawnArgsFinal], {
        env: childEnv,
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } else {
      // wrapper batch not found - try PYTHON_EXE env var
      const pythonExe = process.env.PYTHON_EXE && fs.existsSync(process.env.PYTHON_EXE) ? process.env.PYTHON_EXE : 'python';
      // If pythonExe is an absolute path we still use it directly; otherwise rely on PATH
      proc = spawn(pythonExe, spawnArgsFinal, {
        env: childEnv,
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      logProjectEvent(next.params.project, `[WARN] wrapper batch missing, using python runner: ${pythonExe}`);
      appendRenderLog && appendRenderLog && appendRenderLog(`[WARN] wrapper batch missing, using python runner: ${pythonExe}`);
      console.warn('[RUN_QGIS_PY] wrapper batch not found, falling back to', pythonExe);
    }

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
app.get("/wmts/:project/themes/:theme/:z/:x/:y.png", ensureProjectAccess((req) => req.params.project), (req, res) => {
  const { project, theme, z, x, y } = req.params;
  const sid = normalizeViewerSessionId(req.query && req.query.sid);
  
  // Evitar caché agresiva del navegador para tiles dinámicas
  try { res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); } catch (e) {}
  
  let file = path.join(cacheDir, project, "_themes", theme, z, x, `${y}.png`);
  
  // 1. Si la tile YA EXISTE, enviarla inmediatamente
  if (fs.existsSync(file)) {
    // If the tile is empty/partial, delete it so it will be regenerated below.
    if (deleteTileFileIfInvalid(file)) {
      logProjectEvent(project, `Tile invalid (deleted): ${file}`);
    } else {
    logProjectEvent(project, `Tile hit: ${file}`);
    return res.sendFile(file);
    }
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
      if (deleteTileFileIfInvalid(fallbackFile)) {
        logProjectEvent(project, `Tile invalid (deleted) (fallback): ${fallbackFile}`);
      } else {
        logProjectEvent(project, `Tile hit (fallback): ${fallbackFile}`);
        return res.sendFile(fallbackFile);
      }
    }
    
    logProjectEvent(project, `Tile miss (fallback): ${fallbackFile}. Generating on-demand...`);
    
    // Generar fallback on-demand Y ESPERAR
    return queueTileRender({ project, layer: theme, z, x, y, sid }, fallbackFile, (err, outFile) => {
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
  
  queueTileRender({ project, theme, z, x, y, sid }, file, (err, outFile) => {
    if (err) {
      logProjectEvent(project, `Tile render error: ${file} | ${err?.message || err}`);
      
      // Intento de fallback a capa si el render de tema falló
      if (hasLayerWithName) {
        const fallbackFile = path.join(cacheDir, project, theme, z, x, `${y}.png`);
        logProjectEvent(project, `Theme render failed; forced fallback to layer '${theme}' -> ${fallbackFile}`);
        
        return queueTileRender({ project, layer: theme, z, x, y, sid }, fallbackFile, (layerErr, layerOutFile) => {
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
  const sid = normalizeViewerSessionId(req.query && req.query.sid);
  
  try { res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); } catch (e) {}
  
  const file = path.join(cacheDir, project, layer, z, x, `${y}.png`);

  // 1. Si existe, enviar inmediatamente
  if (fs.existsSync(file)) {
    if (deleteTileFileIfInvalid(file)) {
      logProjectEvent(project, `Tile invalid (deleted): ${file}`);
    } else {
      logProjectEvent(project, `Tile hit: ${file}`);
      return res.sendFile(file);
    }
  }

  // 2. Si no existe, Generar on-demand Y ESPERAR
  logProjectEvent(project, `Tile miss: ${file}. Generating on-demand...`);
  
  queueTileRender({ project, layer, z, x, y, sid }, file, (err, outFile) => {
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
    if (deleteTileFileIfInvalid(file)) {
      logProjectEvent('nogo', `Tile invalid (deleted): ${file}`);
    } else {
      logProjectEvent('nogo', `Tile hit: ${file}`);
      return res.sendFile(file);
    }
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

    const filterLayer = String(findQ('layer') || findQ('LAYER') || '').trim();

    // For GetCapabilities, check project access if a specific project is requested
    const executeGetCapabilities = () => {
      try {
        const inventory = buildWmtsInventory({
          ...(filterProjectId ? { filterProjectId } : {}),
          ...(filterLayer ? { filterLayerName: filterLayer } : {})
        });
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
        if (filterLayer) {
          kvpUrl += "layer=" + encodeURIComponent(filterLayer) + "&";
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
          if (!err) {
            // Exists but might be empty/partial from a previous failed render
            const deleted = deleteTileFileIfInvalid(filePath);
            if (deleted) {
              logProjectEvent(projectId, `KVP Tile invalid (deleted): ${filePath}`);
              err = new Error('invalid_tile_deleted');
            }
          }

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
                    setWmtsTileCacheHeaders(res);
                        if (!res.headersSent) res.sendFile(outFile);
                    }
                });
            } else {
                // EXISTE: Enviar archivo
                setWmtsTileCacheHeaders(res);
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

if (cluster.isPrimary || cluster.isMaster) {
  const cpuCount = os.cpus().length;
  const configuredWorkers = parseInt(process.env.WORKER_COUNT || "0", 10) || 0;
  const numCPUs = (configuredWorkers > 0) ? configuredWorkers : cpuCount;
  const totalMem = os.totalmem();
  console.log(`[Qtiler] starting master: cpuCount=${cpuCount}, configuredWorkers=${configuredWorkers}, forking=${numCPUs}`);
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  // Listen for worker requests to restart the cluster (e.g., after plugin install/uninstall)
  cluster.on('message', (worker, msg) => {
    if (msg && msg.cmd === 'restartAllWorkers') {
      console.log('[Qtiler] Restarting all workers due to plugin change request');
      for (const id in cluster.workers) {
        try {
          cluster.workers[id].process.kill();
        } catch (err) {
          console.warn('[Qtiler] Failed to kill worker', id, err?.message || err);
        }
      }
    }
  });

  setInterval(() => {
    for (const id in cluster.workers) {
      try {
        cluster.workers[id].process.send({ cmd: "checkMemory", maxMem: totalMem * 0.8 });
      } catch (e) {
        // ignore send errors
      }
    }
  }, 10000);

  cluster.on("exit", (worker, code, signal) => {
    console.log(`[Qtiler] Worker ${worker.process.pid} died (${signal || code}), restarting...`);
    try { cluster.fork(); } catch (e) { console.warn('[Qtiler] failed to fork worker', e); }
  });

} else {
  // Worker process: start server and handle master messages
  process.on('message', (msg) => {
    try {
      if (msg && msg.cmd === 'checkMemory') {
        const used = process.memoryUsage().rss || 0;
        if (msg.maxMem && used > msg.maxMem) {
          console.warn(`[Qtiler] worker ${process.pid} exceeds memory limit ${used} > ${msg.maxMem}, exiting to allow restart`);
          // allow master to detect exit and fork new worker
          process.exit(1);
        }
      }
    } catch (e) {
      // ignore
    }
  });

  startServer().catch((err) => {
    console.error('Failed to start server', err);
    process.exitCode = 1;
  });
}
