/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { execFile, spawn } from "child_process";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import crypto from "crypto";
import multer from "multer";
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

// add: servir carpeta pública
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// opcional: asegurar que GET / devuelva index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const cacheDir = path.resolve(__dirname, "cache");
const pythonDir = path.resolve(__dirname, "python");
const projectsDir = path.resolve(__dirname, "qgisprojects");
const logsDir = path.resolve(__dirname, "logs");

const PROJECT_CONFIG_FILENAME = "project-config.json";
const MAX_TIMER_DELAY_MS = 2147483647; // ~24.8 días, límite de setTimeout

// utilidades generales
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// caché en memoria para configs y timers
const projectConfigCache = new Map(); // id -> config
const projectTimers = new Map(); // id -> { timeout, targetTime }
const projectLogLastMessage = new Map(); // id -> string
const projectBatchRuns = new Map(); // id -> run info
const projectBatchCleanupTimers = new Map();

const PROJECT_BATCH_TTL_MS = parseInt(process.env.PROJECT_BATCH_TTL_MS || "900000", 10);

// asegurar solo el directorio base (ya no se crea un index.json global)
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}
if (!fs.existsSync(projectsDir)) {
  fs.mkdirSync(projectsDir, { recursive: true });
}
if (!fs.existsSync(logsDir)) {
  try { fs.mkdirSync(logsDir, { recursive: true }); } catch {}
}

const getProjectConfigPath = (projectId) => path.join(cacheDir, projectId, PROJECT_CONFIG_FILENAME);

const defaultProjectConfig = (projectId) => ({
  projectId,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  extent: { bbox: null, crs: null, updatedAt: null },
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

const buildProjectConfigPatch = (input = {}) => {
  const patch = {};
  if (input.extent && typeof input.extent === "object") {
    const bbox = Array.isArray(input.extent.bbox) ? input.extent.bbox.map((v) => Number(v)) : null;
    patch.extent = {
      bbox: bbox && bbox.length === 4 && bbox.every((n) => Number.isFinite(n)) ? bbox : null,
      crs: input.extent.crs && typeof input.extent.crs === "string" ? input.extent.crs : null,
      updatedAt: input.extent.updatedAt || new Date().toISOString()
    };
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
  if (!cfg || !cfg.recache || cfg.recache.enabled !== true) {
    return;
  }
  const nextTs = computeNextRunTimestamp(cfg);
  if (!nextTs) {
    return;
  }
  const now = Date.now();
  const delayMs = Math.max(0, nextTs - now);
  const timeoutDelay = Math.min(delayMs, MAX_TIMER_DELAY_MS);
  const timeout = setTimeout(() => {
    handleProjectTimer(projectId, nextTs).catch((err) => {
      console.error(`Recache timer error for ${projectId}:`, err);
    });
  }, timeoutDelay);
  projectTimers.set(projectId, { timeout, targetTime: nextTs });
};

const logProjectEvent = (projectId, message, level = "info") => {
  const line = `[${new Date().toISOString()}][${level.toUpperCase()}] ${message}\n`;
  const last = projectLogLastMessage.get(projectId);
  if (last === message) return; // evita repeticiones inmediatas
  projectLogLastMessage.set(projectId, message);
  const logPath = path.join(logsDir, `project-${projectId}.log`);
  try {
    fs.appendFileSync(logPath, line, "utf8");
  } catch (err) {
    console.warn("Failed to write project log", projectId, err);
  }
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
  if (entry && entry.targetTime && entry.targetTime !== targetTime) {
    // timer se reprogramó mientras esperábamos
    return;
  }
  if (now + 1000 < targetTime) {
    // faltaba mucho: reprogramar
    scheduleProjectRecache(projectId);
    return;
  }
  try {
    await runRecacheForProject(projectId, "scheduled");
  } catch (err) {
    console.error(`Scheduled recache failed for ${projectId}:`, err);
  } finally {
    scheduleProjectRecache(projectId);
  }
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
  logProjectEvent(projectId, `Recache start (${reason}), layers: ${layerEntries.map((entry) => entry.name).join(", ")}`);
  const failures = [];
  for (const entry of layerEntries) {
    const layerName = entry.name;
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
      try { activeKeys.delete(`${projectId}:${layerName}`); } catch {}
      clearTimeout(job.cleanupTimer);
      job.cleanupTimer = setTimeout(() => runningJobs.delete(rid), parseInt(process.env.JOB_TTL_MS || "300000", 10));
    } catch (e) {
      if (!silent) console.warn("Failed to abort running job before delete", e);
    }
  }

  const layerDir = path.join(cacheDir, projectId, layerName);
  if (fs.existsSync(layerDir)) {
    await fs.promises.rm(layerDir, { recursive: true, force: true });
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

const allowedProjectExtensions = new Set([".qgz", ".qgs"]);
const defaultUploadLimit = parseInt(process.env.PROJECT_UPLOAD_MAX_BYTES || "209715200", 10); // 200 MB por defecto
const projectUpload = multer({
  storage: multer.memoryStorage(),
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

// Detectar ejecutable python (permite override por .env)
const pythonExe = process.env.PYTHON_EXE || path.join(process.env.OSGEO4W_BIN || "C:\\OSGeo4W\\bin", "python.exe");

// crear env para procesos hijos incluyendo OSGeo4W paths si están en .env
const makeChildEnv = () => {
  const env = { ...process.env };
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
  // Ejecutar el batch pero suprimir su stdout/stderr (">nul 2>&1") para evitar el ruido
  // y luego ejecutar python en la misma cmd para heredar el entorno.
  // Usamos && para que python solo se ejecute si el batch se ejecuta correctamente.
  const cmdParts = [
    `"${o4wBatch}" >nul 2>&1`,
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

// listar proyectos
app.get("/projects", (req, res) => {
  return res.json(listProjects());
});

app.post("/projects", (req, res) => {
  projectUpload.single("project")(req, res, (err) => {
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
      fs.writeFileSync(targetPath, file.buffer);
    } catch (writeErr) {
      return res.status(500).json({ error: "write_failed", details: String(writeErr) });
    }
    const finalId = targetName.replace(/\.(qgz|qgs)$/i, "");
    return res.status(201).json({ status: "uploaded", id: finalId, filename: targetName });
  });
});

app.delete("/projects/:id", (req, res) => {
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
      try { job.proc.kill(); job.status = "aborted"; job.endedAt = Date.now(); } catch {}
      try { activeKeys.delete(`${job.project || ""}:${job.layer}`); } catch {}
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
    try { clearTimeout(batchTimer); } catch {}
    projectBatchCleanupTimers.delete(proj.id);
  }
  projectBatchRuns.delete(proj.id);

  const projectCacheDir = path.join(cacheDir, proj.id);
  let cacheRemoved = false;
  if (fs.existsSync(projectCacheDir)) {
    try {
      fs.rmSync(projectCacheDir, { recursive: true, force: true });
      cacheRemoved = true;
    } catch (err) {
      return res.status(500).json({ error: "cache_delete_failed", details: String(err) });
    }
  }

  return res.json({ status: "deleted", id: proj.id, cacheRemoved });
});

// capas por proyecto
app.get("/projects/:id/layers", (req, res) => {
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

app.get("/projects/:id/config", (req, res) => {
  const projectId = req.params.id;
  const proj = findProjectById(projectId);
  if (!proj) return res.status(404).json({ error: "project_not_found" });
  const config = readProjectConfig(projectId);
  return res.json(config);
});

app.patch("/projects/:id/config", (req, res) => {
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

app.get("/projects/:id/cache/project", (req, res) => {
  const projectId = req.params.id;
  const proj = findProjectById(projectId);
  if (!proj) return res.status(404).json({ error: "project_not_found" });
  const current = projectBatchRuns.get(projectId) || null;
  const config = readProjectConfig(projectId);
  const last = config.projectCache || null;
  return res.json({ current, last });
});

app.post("/projects/:id/cache/project", (req, res) => {
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
  updateProjectBatchRun(projectId, {
    id: runId,
    project: projectId,
    status: "queued",
    reason: body.reason || "manual-project",
    createdAt: Date.now(),
    layers: layerNames
  });
  res.json({ status: "queued", runId, project: projectId, layers: layerNames.length });
  setImmediate(async () => {
    try {
      updateProjectBatchRun(projectId, { status: "running", startedAt: Date.now() });
      await runRecacheForProject(projectId, "manual-project", { overrideLayers, runId, requireEnabled: false });
      updateProjectBatchRun(projectId, { status: "completed", endedAt: Date.now(), result: "success" });
      logProjectEvent(projectId, `Project cache run ${runId} completed (${layerNames.length} layers).`);
    } catch (err) {
      const message = err?.message || String(err);
      updateProjectBatchRun(projectId, { status: "error", endedAt: Date.now(), error: message });
      logProjectEvent(projectId, `Project cache run ${runId} failed: ${message}`, "error");
    }
  });
});

// /layers -> ejecutar script extract_info.py usando o4w_env.bat
app.get("/layers", (req, res) => {
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
app.post("/generate-cache", (req, res) => {
  const { project: projectId, layer, theme, zoom_min = 0, zoom_max = 0, scheme = "auto", xyz_mode = "partial", tile_crs = null, wmts = false, project_extent = null, extent_crs = null, allow_remote = false, throttle_ms = 0, render_timeout_ms = null, tile_retries = null, png_compression = null } = req.body;
  if (!layer && !theme) return res.status(400).json({ error: "target_required", details: "Debe indicar layer o theme" });
  if (layer && theme) return res.status(400).json({ error: "too_many_targets", details: "Solo se permite layer o theme" });

  const targetMode = theme ? "theme" : "layer";
  const targetName = (theme || layer || "").toString().trim();
  if (!targetName) {
    return res.status(400).json({ error: "invalid_target_name" });
  }

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
  const args = [];
  if (targetMode === "layer") {
    args.push("--layer", layer);
  } else {
    args.push("--theme", theme);
  }
  args.push(
    "--zoom_min", String(zoom_min),
    "--zoom_max", String(zoom_max),
    "--output_dir", outBase,
    "--index_path", projectIndex,
    "--scheme", scheme,
    "--xyz_mode", xyz_mode
  );
  if (tile_crs) {
    args.push("--tile_crs", tile_crs);
  }
  if (wmts) {
    args.push("--wmts");
  }
  if (allow_remote) {
    args.push("--allow_remote");
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

  const job = { id, proc, layer: jobLabel, targetName, targetMode, project: projectKey, key, startedAt: Date.now(), stdout: "", stderr: "", status: "running", exitCode: null, endedAt: null, cleanupTimer: null };
  runningJobs.set(id, job);

  proc.stdout.on("data", d => {
    const s = d.toString();
    job.stdout += s;
    console.log(`[job ${id} stdout]`, s.trim());
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
    try { activeKeys.delete(key); } catch {}
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
        zoom: { min: Number(zoom_min) ?? null, max: Number(zoom_max) ?? null, updatedAt: nowIso },
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
app.delete("/generate-cache/:id", (req, res) => {
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
    // liberar clave activa
    try {
      const activeKey = job.key || `${job.project || ''}:${job.targetMode || 'layer'}:${job.targetName || job.layer}`;
      activeKeys.delete(activeKey);
    } catch {}
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
app.get("/generate-cache/running", (req, res) => {
  const list = Array.from(runningJobs.values())
    .filter(j => (j.status || "running") === "running")
    .map(j => ({ id: j.id, layer: j.layer, project: j.project, startedAt: j.startedAt }));
  res.json(list);
});

// Obtener detalles de un job (estado y logs)
app.get("/generate-cache/:id", (req, res) => {
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

// servir tiles
// nuevo: ruta con proyecto
app.get("/wmts/:project/themes/:theme/:z/:x/:y.png", (req, res) => {
  const { project, theme, z, x, y } = req.params;
  const file = path.join(cacheDir, project, "_themes", theme, z, x, `${y}.png`);
  if (fs.existsSync(file)) res.sendFile(file);
  else res.status(404).send("Tile no encontrada");
});

app.get("/wmts/:project/:layer/:z/:x/:y.png", (req, res) => {
  const { project, layer, z, x, y } = req.params;
  const file = path.join(cacheDir, project, layer, z, x, `${y}.png`);
  if (fs.existsSync(file)) res.sendFile(file);
  else res.status(404).send("Tile no encontrada");
});

// compat legado: sin proyecto
app.get("/wmts/:layer/:z/:x/:y.png", (req, res) => {
  const { layer, z, x, y } = req.params;
  const file = path.join(cacheDir, layer, z, x, `${y}.png`);
  if (fs.existsSync(file)) res.sendFile(file);
  else res.status(404).send("Tile no encontrada");
});

// servir index.json del cache para meta en el visor
// ruta legacy desactivada: informar que ahora se usan índices por proyecto
app.get("/cache/index.json", (req, res) => {
  return res.status(410).json({
    error: "gone",
    message: "El index.json global ha sido eliminado. Usa /cache/:project/index.json"
  });
});

// index por proyecto
app.get("/cache/:project/index.json", (req, res) => {
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
    try { fs.writeFileSync(pIndex, JSON.stringify(skeleton, null, 2), "utf8"); } catch {}
    return res.json(skeleton);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// Delete entire project cache (all layers + index)
app.delete("/cache/:project", (req, res) => {
  const p = req.params.project;
  const pDir = path.join(cacheDir, p);
  // abort running jobs for this project
  for (const [id, job] of runningJobs.entries()) {
    if (job.project === p && job.status === 'running') {
      try { job.proc.kill(); job.status = 'aborted'; job.endedAt = Date.now(); } catch {}
      try {
        const activeKey = job.key || `${job.project || ''}:${job.targetMode || 'layer'}:${job.targetName || job.layer}`;
        activeKeys.delete(activeKey);
      } catch {}
    }
  }
  try {
    if (fs.existsSync(pDir)) {
      fs.rmSync(pDir, { recursive: true, force: true });
      return res.json({ status: 'deleted', project: p });
    }
    return res.status(404).json({ error: 'project_cache_not_found', project: p });
  } catch (e) {
    return res.status(500).json({ error: 'delete_failed', details: String(e) });
  }
});

// DELETE cache for a layer and update index.json
// nuevo: delete por proyecto
app.delete("/cache/:project/:layer", async (req, res) => {
  const { project, layer } = req.params;
  const force = String(req.query.force || "").toLowerCase() === "1" || String(req.query.force || "").toLowerCase() === "true";
  if (!layer) return res.status(400).json({ error: "layer required" });
  try {
    const result = await deleteLayerCacheInternal(project, layer, { force });
    return res.json({ status: "ok", ...result });
  } catch (err) {
    if (err && err.code === "job_running") {
      return res.status(409).json({ error: "job_running", id: err.jobId, message: "Hay un proceso generando esta capa. Usa ?force=1 para abortar y eliminar." });
    }
    console.error("Failed to delete cache for layer", layer, err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

// --- WMTS GetCapabilities (mínimo para QGIS) ---
// Endpoint: /wmts?SERVICE=WMTS&REQUEST=GetCapabilities
// Publica:
//  - Layers "xyz" con tile_crs=EPSG:3857 en TileMatrixSet EPSG_3857
//  - Layers "wmts" con su propio TileMatrixSet derivado de index.json
app.get('/wmts', async (req, res) => {
  const svc = String(req.query.SERVICE || '').toUpperCase();
  const reqType = String(req.query.REQUEST || '').toUpperCase();
  if (svc !== 'WMTS' || reqType !== 'GETCAPABILITIES') {
    return res.status(400).json({ error: 'unsupported', details: 'Use SERVICE=WMTS&REQUEST=GetCapabilities' });
  }
  try {
  const filterProjectRaw = req.query.project != null ? String(req.query.project).trim() : '';
  const filterProjectId = filterProjectRaw ? filterProjectRaw.replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase() : '';
    const projects = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter(d => fs.statSync(path.join(cacheDir,d)).isDirectory()) : [];
    const layersMeta = [];
    const wmtsSets = []; // tile matrix sets custom por layer
    for (const p of projects) {
      if (filterProjectId && p.toLowerCase() !== filterProjectId) {
        continue;
      }
      const idxPath = path.join(cacheDir, p, 'index.json');
      if (!fs.existsSync(idxPath)) continue;
      let idx;
      try { idx = JSON.parse(fs.readFileSync(idxPath,'utf8')); } catch { continue; }
      for (const lyr of (idx.layers||[])) {
        const kind = typeof lyr.kind === "string" ? lyr.kind.toLowerCase() : "layer";
        const tcrs = String(lyr.tile_crs||'').toUpperCase();
        if (lyr.scheme === 'xyz' && tcrs === 'EPSG:3857') {
          layersMeta.push({ type: 'xyz3857', project: p, layer: lyr.name, zoom_min: lyr.zoom_min, zoom_max: lyr.zoom_max, extent: lyr.extent, tileCrs: 'EPSG:3857', kind });
        } else if (lyr.scheme === 'wmts' && lyr.tile_matrix_set && Array.isArray(lyr.tile_matrix_set.matrices)) {
          const setId = lyr.tile_matrix_set.id || (p + ':' + lyr.name);
          wmtsSets.push({ project: p, layer: lyr.name, set: lyr.tile_matrix_set, extent: lyr.extent, tileCrs: lyr.tile_crs || lyr.crs, kind });
          layersMeta.push({ type: 'wmts', project: p, layer: lyr.name, setId, extent: lyr.extent, tileCrs: lyr.tile_crs || lyr.crs, kind });
        }
      }
    }
    // construir TileMatrixSet EPSG:3857 (global) hasta max zoom encontrado
  const overallMaxZoom = layersMeta.filter(l=>l.type==='xyz3857').reduce((m,l)=> Math.max(m, l.zoom_min!=null && l.zoom_max!=null ? l.zoom_max : m), 0);
    const tileMatrices = [];
    for (let z=0; z<=overallMaxZoom; z++) {
      const scaleDenominator = 559082264.0287178 / Math.pow(2,z); // valor inicial típico /2^z
      const matrixWidth = Math.pow(2,z);
      const matrixHeight = Math.pow(2,z);
      tileMatrices.push({ z, scaleDenominator, matrixWidth, matrixHeight });
    }
    // helper: transformar mercator (x,y en EPSG:3857) a lon/lat WGS84 aproximado
    const mercToLonLat = (x,y) => {
      const R = 20037508.342789244;
      const lon = (x / R) * 180;
      let lat = (y / R) * 180;
      lat = 180/Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI/180)) - Math.PI/2);
      return [lon, lat];
    };
  const xmlEscape = (s)=> String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    let xml = '';
    xml += '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:gml="http://www.opengis.net/gml" version="1.0.0">';
    xml += '<ows:ServiceIdentification><ows:Title>Local WMTS</ows:Title><ows:ServiceType>OGC WMTS</ows:ServiceType><ows:ServiceTypeVersion>1.0.0</ows:ServiceTypeVersion></ows:ServiceIdentification>';
    xml += '<ows:ServiceProvider><ows:ProviderName>Local</ows:ProviderName></ows:ServiceProvider>';
    xml += '<Contents>';
    for (const lm of layersMeta) {
      const [minx,miny,maxx,maxy] = lm.extent || [ -20037508.3428, -20037508.3428, 20037508.3428, 20037508.3428 ];
      let wminlon=-180, wminlat=-90, wmaxlon=180, wmaxlat=90;
      if (lm.type === 'xyz3857') {
        const clamp = (v) => Math.max(-20037508.342789244, Math.min(20037508.342789244, v));
        const cminx = clamp(minx), cminy = clamp(miny), cmaxx = clamp(maxx), cmaxy = clamp(maxy);
        const a = mercToLonLat(cminx,cminy); const b = mercToLonLat(cmaxx,cmaxy);
        wminlon = a[0]; wminlat = a[1]; wmaxlon = b[0]; wmaxlat = b[1];
      }
      const tileCrs = lm.tileCrs || 'EPSG:3857';
      const urlPath = lm.kind === 'theme'
        ? `${encodeURIComponent(lm.project)}/themes/${encodeURIComponent(lm.layer)}`
        : `${encodeURIComponent(lm.project)}/${encodeURIComponent(lm.layer)}`;
      const tileCrsUrn = `urn:ogc:def:crs:${xmlEscape(tileCrs.replace(':', '::'))}`;
      xml += '<Layer>';
      xml += `<ows:Title>${xmlEscape(lm.project + ':' + lm.layer)}</ows:Title>`;
      xml += `<ows:Identifier>${xmlEscape(lm.project + ':' + lm.layer)}</ows:Identifier>`;
      xml += '<ows:WGS84BoundingBox>';
      xml += `<ows:LowerCorner>${wminlon} ${wminlat}</ows:LowerCorner>`;
      xml += `<ows:UpperCorner>${wmaxlon} ${wmaxlat}</ows:UpperCorner>`;
      xml += '</ows:WGS84BoundingBox>';
      if (Array.isArray(lm.extent) && lm.extent.length === 4) {
        xml += `<ows:BoundingBox crs="${tileCrsUrn}">`;
        xml += `<ows:LowerCorner>${lm.extent[0]} ${lm.extent[1]}</ows:LowerCorner>`;
        xml += `<ows:UpperCorner>${lm.extent[2]} ${lm.extent[3]}</ows:UpperCorner>`;
        xml += '</ows:BoundingBox>';
      }
      xml += `<ows:SupportedCRS>${tileCrsUrn}</ows:SupportedCRS>`;
      xml += '<Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style>';
      xml += '<Format>image/png</Format>';
      let supportedMatrixSet = '';
      if (lm.type === 'xyz3857') {
        supportedMatrixSet = 'EPSG_3857';
      } else if (lm.type === 'wmts') {
        supportedMatrixSet = lm.setId;
      }
      if (supportedMatrixSet) {
        xml += `<TileMatrixSetLink><TileMatrixSet>${xmlEscape(supportedMatrixSet)}</TileMatrixSet></TileMatrixSetLink>`;
      }
      // ResourceURL template usando TileMatrix, TileCol, TileRow (válido para ambos)
  const template = `${req.protocol}://${req.get('host')}/wmts/${urlPath}/{TileMatrix}/{TileCol}/{TileRow}.png`;
      xml += `<ResourceURL format="image/png" resourceType="tile" template="${xmlEscape(template)}"/>`;
      xml += '</Layer>';
    }
    // TileMatrixSet EPSG_3857
    xml += '<TileMatrixSet>';
    xml += '<ows:Identifier>EPSG_3857</ows:Identifier>';
    xml += '<ows:SupportedCRS>urn:ogc:def:crs:EPSG::3857</ows:SupportedCRS>';
    for (const tm of tileMatrices) {
      xml += `<TileMatrix><ows:Identifier>${tm.z}</ows:Identifier><ScaleDenominator>${tm.scaleDenominator}</ScaleDenominator><TopLeftCorner>-20037508.342789244 20037508.342789244</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>${tm.matrixWidth}</MatrixWidth><MatrixHeight>${tm.matrixHeight}</MatrixHeight></TileMatrix>`;
    }
    xml += '</TileMatrixSet>';
    // TileMatrixSets personalizados (WMTS locales)
    for (const s of wmtsSets) {
      const set = s.set;
      const sup = String(set.supported_crs || '').toUpperCase();
      const topLeft = set.top_left_corner || [0,0];
      xml += '<TileMatrixSet>';
      xml += `<ows:Identifier>${xmlEscape(set.id)}</ows:Identifier>`;
      xml += `<ows:SupportedCRS>urn:ogc:def:crs:${xmlEscape(sup.replace(':','::'))}</ows:SupportedCRS>`;
      for (const m of (set.matrices||[])) {
        xml += `<TileMatrix><ows:Identifier>${m.z}</ows:Identifier><ScaleDenominator>${m.scale_denominator}</ScaleDenominator><TopLeftCorner>${topLeft[0]} ${topLeft[1]}</TopLeftCorner><TileWidth>${set.tile_width||256}</TileWidth><TileHeight>${set.tile_height||256}</TileHeight><MatrixWidth>${m.matrix_width}</MatrixWidth><MatrixHeight>${m.matrix_height}</MatrixHeight></TileMatrix>`;
      }
      xml += '</TileMatrixSet>';
    }
    xml += '</Contents>';
    xml += '</Capabilities>';
    res.setHeader('Content-Type','application/xml');
    return res.send(xml);
  } catch (e) {
    console.error('WMTS capabilities error', e);
    return res.status(500).json({ error: 'wmts_capabilities_failed', details: String(e) });
  }
});

initializeProjectSchedules();

app.listen(3000, () => console.log("🚀 Servidor Node.js en http://localhost:3000"));
