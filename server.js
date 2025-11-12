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
    try { clearTimeout(entry.timeout); } catch {}
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
      try { activeKeys.delete(`${projectId}:${layerName}`); } catch {}
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
      } catch {}
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
      try { activeKeys.delete(`${projectId}:theme:${themeName}`); } catch {}
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
      } catch {}
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
    recache: recacheRaw = null
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
    persistJobProgress(job, { status: "aborted" }, { forceIndex: true, forceConfig: true });
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
        const scheme = typeof lyr.scheme === "string" ? lyr.scheme.toLowerCase() : null;
        const tcrs = String(lyr.tile_crs||'').toUpperCase();
        const hasTileMatrixSet = lyr && lyr.tile_matrix_set && Array.isArray(lyr.tile_matrix_set.matrices);
        if (scheme === 'xyz' && tcrs === 'EPSG:3857') {
          layersMeta.push({ type: 'xyz3857', project: p, layer: lyr.name, zoom_min: lyr.zoom_min, zoom_max: lyr.zoom_max, extent: lyr.extent, tileCrs: 'EPSG:3857', kind });
        } else if (hasTileMatrixSet) {
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
startScheduleHeartbeat();

app.listen(3000, () => console.log("🚀 Servidor Node.js en http://localhost:3000"));
