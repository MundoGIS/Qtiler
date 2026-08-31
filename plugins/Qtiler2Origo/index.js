/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at
 * https://mozilla.org/MPL/2.0/
 *
 * Copyright (C) 2026 MundoGIS.
 */

import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import http from 'http';
import https from 'https';
import AdmZip from 'adm-zip';
import multer from 'multer';
import sharp from 'sharp';
import proj4 from 'proj4';
import { copyRecursive, removeRecursive } from '../../lib/fsRecursive.js';
import { getAuthDb, readProjectAccessFromDb } from '../../lib/authDb.js';
import { createJsonStore } from '../../lib/jsonStore.js';
import { getRequestBaseUrl } from '../../lib/requestBaseUrl.js';

const DEFAULT_REPO = process.env.QTILER_ORIGO_REPO || process.env.QTWC_QWC2_REPO || 'origo-map/origo';
const DEFAULT_VERSION = process.env.QTILER_ORIGO_VERSION || process.env.QTWC_QWC2_VERSION || 'v2.10.0';
const DEFAULT_STANDALONE_PORT = Number(process.env.QTILER_ORIGO_PORT || process.env.QTWC_QWC2_PORT || 3089);
const AUTO_START_STANDALONE = !['1', 'true', 'yes'].includes(String(process.env.QTILER_ORIGO_AUTOSTART || process.env.QTWC_QWC2_AUTOSTART || '0').toLowerCase());
const ENV_STANDALONE_PORT = Number(process.env.QTILER_ORIGO_PORT || process.env.QTWC_QWC2_PORT || 0);
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const MAX_PORTAL_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_LEGEND_LIBRARY_BYTES = 2 * 1024 * 1024;
const LEGEND_SWATCH_SIZE = 24;
const ALLOWED_LOGO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp']);
const ALLOWED_PORTAL_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const ALLOWED_LEGEND_LIBRARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp']);
const PREVIEW_STATE_TTL_MS = 10 * 60 * 1000;
let previewStateStore = null;

const nowIso = () => new Date().toISOString();

const prunePreviewStateStore = async () => {
  if (!previewStateStore) return {};
  const cutoff = Date.now() - PREVIEW_STATE_TTL_MS;
  const snapshot = await previewStateStore.update((draft) => {
    const current = draft && typeof draft === 'object' ? draft : {};
    for (const [key, value] of Object.entries(current)) {
      if (!value || !Number.isFinite(value.createdAt) || value.createdAt < cutoff) {
        delete current[key];
      }
    }
    return current;
  });
  return snapshot && typeof snapshot === 'object' ? snapshot : {};
};

const createPreviewStateId = () => `preview_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

const normalizePreviewStatePayload = (input) => {
  const source = input && typeof input === 'object' ? input : {};
  const normalizeJsonish = (value) => {
    if (typeof value === 'string') return value.trim();
    if (value == null) return '';
    try { return JSON.stringify(value); } catch { return ''; }
  };
  return {
    project: sanitizeFileToken(String(source.project || '').trim()),
    layers: normalizeJsonish(source.layers),
    groups: normalizeJsonish(source.groups),
    layerRules: normalizeJsonish(source.layerRules),
    bgProject: sanitizeFileToken(String(source.bgProject || '').trim()),
    bgLayer: String(source.bgLayer || '').trim(),
    bgKey: String(source.bgKey || '').trim(),
    center: normalizeJsonish(source.center),
    centerCrs: String(source.centerCrs || '').trim(),
    zoom: String(source.zoom || '').trim(),
    extent: normalizeJsonish(source.extent),
    minZoom: String(source.minZoom || '').trim(),
    maxZoom: String(source.maxZoom || '').trim(),
    controls: normalizeJsonish(source.controls)
  };
};

const resolvePreviewRequestPayload = async (req) => {
  const stateId = sanitizeFileToken(String(req.query?.state || '').trim());
  const snapshot = stateId ? await prunePreviewStateStore() : null;
  const stored = stateId && snapshot && typeof snapshot === 'object' ? snapshot[stateId] : null;
  return {
    stateId,
    payload: stored?.payload && typeof stored.payload === 'object' ? stored.payload : (req.query || {})
  };
};

const probeStandaloneHealth = async (port) => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(1200)
    });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => null);
    return payload?.status === 'ok';
  } catch {
    return false;
  }
};

const toArray = (value) => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
};

const toBackgroundType = (value) => {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'layer') return 'layer';
  if (type === 'none') return 'none';
  return 'osm';
};

const FIXED_BACKGROUNDS = [
  { key: 'none', type: 'none', title: 'Sin bakgrund' }
];

const normalizeProjectId = (value) => String(value || '').trim();

const normalizeThemeName = (value) => {
  let name = String(value || '').trim();
  while (/^theme:/i.test(name)) name = name.replace(/^theme:/i, '').trim();
  return name;
};

const buildThemeWmtsUrl = (baseUrl, projectId, themeName, tileMatrix = false) => {
  const prefix = `${String(baseUrl || '').replace(/\/+$/, '')}/wmts/${encodeURIComponent(String(projectId || ''))}/themes/${encodeURIComponent(String(themeName || ''))}`;
  return tileMatrix ? `${prefix}/{TileMatrix}/{TileCol}/{TileRow}.png` : `${prefix}/{z}/{x}/{y}.png`;
};

const sanitizeFileToken = (value) => String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_');

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const cloneJsonValue = (value) => {
  if (value == null) return value;
  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
};

const ORIGO_CONTROL_DEFAULT_OPTIONS = Object.freeze({
  about: { buttontext: 'About', title: 'About', content: '', placement: ['menu'], style: 'modal', hideWhenEmbedded: false },
  bookmarks: { title: 'Bookmarks', isActive: false, duration: 300, items: [], hideWhenEmbedded: false },
  draganddrop: { groupName: 'drag-and-drop-layers', groupTitle: 'Drag-and-drop layers', showLegendButton: false, styleByAttribute: false, zoomToExtent: true, zoomToExtentOnLoad: true, hideWhenEmbedded: false },
  draw: { buttonText: 'Draw', isActive: false, placement: ['menu'], layerTitle: 'Drawing', groupName: 'drawing', groupTitle: 'Drawing', multipleLayers: false, queryable: false, removable: true, exportable: true, showAttributeButton: false, showDownloadButton: false, showSaveButton: false, zoomToExtent: true },
  externalurl: { tooltipText: 'External links', icon: '#ic_baseline_link_24px', direction: 'vertical', target: '_blank', links: [], hideWhenEmbedded: false },
  fullscreen: { hideWhenEmbedded: false },
  geoposition: { active: false, panTo: true, enableTracking: false, hideWhenEmbedded: false },
  home: { hideWhenEmbedded: false },
  legend: { expanded: true, turnOffLayersControl: false, turnOnLayersControl: false, visibleLayersControl: false, visibleLayersViewActive: false, searchLayersControl: false, autoHide: 'never', hideWhenEmbedded: false },
  link: { title: 'Link', url: '', icon: '#ic_launch_24px', placement: ['menu'], hideWhenEmbedded: false },
  mapmenu: { isActive: false, autoHide: 'never', hideWhenEmbedded: false },
  measure: { measureTools: ['length', 'area'], default: 'length', showSegmentLengths: false, showSegmentLabelButtonActive: true, useHectare: true, snap: false, snapIsActive: false, queryable: false, hideWhenEmbedded: false },
  position: { noPositionText: '', hideWhenEmbedded: false },
  print: { placement: ['menu'], showCreated: false, showScale: true, mapInteractionsActive: false, suppressNewDPIMethod: false, supressResolutionsRecalculation: false, northArrow: { visible: false }, hideWhenEmbedded: false },
  progressbar: { hideWhenEmbedded: false },
  scale: { scaleText: '1:', hideWhenEmbedded: false },
  scalepicker: { buttonPrefix: 'Scale: ', listItemPrefix: 'Scale: ', hideWhenEmbedded: false },
  sharemap: { title: 'Share map', icon: '#ic_screen_share_outline_24px', hideWhenEmbedded: false },
  splash: { title: 'Information', url: '', content: '', hideButton: { visible: false, hideText: 'Do not show again', confirmText: 'OK' }, hideWhenEmbedded: false }
});

const mergeOrigoControlOptions = (name, options, extraDefaults = {}) => {
  const defaults = {
    ...(cloneJsonValue(ORIGO_CONTROL_DEFAULT_OPTIONS[name]) || {}),
    ...(cloneJsonValue(extraDefaults) || {})
  };
  return { ...defaults, ...(isPlainObject(options) ? cloneJsonValue(options) : {}) };
};

const normalizeOrigoControlEntry = (entry, extraDefaults = {}) => {
  const rawName = typeof entry === 'string' ? entry : entry?.name;
  const name = String(rawName || '').trim();
  if (!name || name === 'zoom') return null;
  const options = mergeOrigoControlOptions(name, isPlainObject(entry?.options) ? entry.options : null, extraDefaults);
  return Object.keys(options).length ? { name, options } : { name };
};

const safeLayerNameForWfs = (value) => {
  if (!value) return '';
  return String(value).normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
};

const xmlAttr = (text, attrName) => {
  const re = new RegExp(`${attrName}="([^"]*)"`, 'i');
  const match = String(text || '').match(re);
  return match ? match[1] : '';
};

const qgisColorToHex = (value) => {
  const parts = String(value || '').split(',').slice(0, 3).map((part) => Number(part));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return `#${parts.map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, '0')).join('')}`;
};

const readQgis3dLayerConfig = (projectFile, cachedLayers = []) => {
  const result = new Map();
  try {
    if (!projectFile || !fs.existsSync(projectFile)) return result;
    let xml = '';
    if (/\.qgz$/i.test(projectFile)) {
      const zip = new AdmZip(projectFile);
      const entry = zip.getEntries().find((item) => /\.qgs$/i.test(item.entryName));
      if (entry) xml = entry.getData().toString('utf8');
    } else if (/\.qgs$/i.test(projectFile)) {
      xml = fs.readFileSync(projectFile, 'utf8');
    }
    if (!xml) return result;

    const byId = new Map();
    for (const layer of cachedLayers || []) {
      if (layer?.layer_id) byId.set(String(layer.layer_id), String(layer.name || layer.layer || ''));
    }

    const rendererRe = /<renderer-3d\b[^>]*>[\s\S]*?<\/renderer-3d>/gi;
    for (const match of xml.matchAll(rendererRe)) {
      const block = match[0];
      const layerId = xmlAttr(block, 'layer');
      const layerName = byId.get(layerId);
      if (!layerName) continue;
      const extrusionRaw = xmlAttr(block, 'extrusion-height');
      const extrusionHeight = Number(extrusionRaw);
      if (!Number.isFinite(extrusionHeight) || extrusionHeight <= 0) continue;
      const materialMatch = block.match(/<material\b[^>]*>/i);
      result.set(layerName, {
        extrusionHeight,
        ...(materialMatch ? { color: qgisColorToHex(xmlAttr(materialMatch[0], 'diffuse')) } : {})
      });
    }
  } catch {
    return result;
  }
  return result;
};

const normalizeBackgroundSelection = ({
  backgroundsInput,
  defaultBackgroundKeyInput,
  fallbackBackgroundProjectId,
  fallbackBackgroundLayerNames,
  knownProjectIds
}) => {
  const optionsByKey = new Map();

  const register = (item) => {
    if (!item || typeof item !== 'object') return;
    const key = String(item.key || '').trim();
    if (!key) return;
    if (optionsByKey.has(key)) return;
    const type = toBackgroundType(item.type);
    const title = String(item.title || '').trim() || key;
    const option = {
      key,
      type,
      title,
      sourceProjectId: null,
      isDefault: item.isDefault === true
    };

    // Preserve a custom uploaded background image (must be one of our own
    // served portal assets, never an arbitrary external URL).
    const imageUrl = String(item.imageUrl || '').trim();
    if (imageUrl && imageUrl.startsWith('/plugins/Qtiler2Origo/portal-assets/')) {
      option.imageUrl = imageUrl;
    }

    if (type === 'layer') {
      const sourceProjectId = normalizeProjectId(item.sourceProjectId || '');
      const name = String(item.name || '').trim();
      if (!sourceProjectId || !knownProjectIds.has(sourceProjectId) || !name) return;
      option.sourceProjectId = sourceProjectId;
      option.name = name;
      const themeName = normalizeThemeName(item.themeName || (item.isTheme === true || /^theme:/i.test(name) ? name : ''));
      if (themeName) {
        option.isTheme = true;
        option.themeName = themeName;
      }
    }

    optionsByKey.set(key, option);
  };

  for (const fixed of FIXED_BACKGROUNDS) {
    register({ ...fixed, isDefault: false });
  }

  if (Array.isArray(backgroundsInput)) {
    for (const item of backgroundsInput) {
      register(item);
    }
  }

  const fallbackProjectId = normalizeProjectId(fallbackBackgroundProjectId || '');
  if (fallbackProjectId && knownProjectIds.has(fallbackProjectId)) {
    for (const name of fallbackBackgroundLayerNames) {
      register({
        key: `layer:${fallbackProjectId}:${name}`,
        type: 'layer',
        sourceProjectId: fallbackProjectId,
        name,
        title: `${fallbackProjectId} / ${name}`
      });
    }
  }

  const options = Array.from(optionsByKey.values());
  const explicitDefaultKey = String(defaultBackgroundKeyInput || '').trim();
  let defaultKey = explicitDefaultKey;

  if (!defaultKey) {
    const marked = options.find((item) => item.isDefault === true);
    defaultKey = marked ? marked.key : '';
  }

  if (!defaultKey || !optionsByKey.has(defaultKey)) {
    const firstWmts = options.find((item) => item.type === 'layer');
    defaultKey = firstWmts ? firstWmts.key : 'none';
  }

  for (const option of options) {
    option.isDefault = option.key === defaultKey;
  }

  return { backgrounds: options, defaultBackgroundKey: defaultKey };
};

const buildDownloadUrl = (repo, version) => {
  const safeRepo = String(repo || DEFAULT_REPO).trim();
  const safeVersion = String(version || DEFAULT_VERSION).trim();
  return `https://github.com/${safeRepo}/archive/refs/tags/${safeVersion}.zip`;
};

const fetchGitHubReleases = (repo, { includePrerelease = false, maxResults = 20 } = {}) => new Promise((resolve, reject) => {
  const safeRepo = String(repo || DEFAULT_REPO).trim();
  const url = `https://api.github.com/repos/${safeRepo}/releases?per_page=${Math.min(maxResults, 100)}`;
  const parsed = new URL(url);
  const options = {
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    headers: { 'User-Agent': 'Qtiler-QTWC/1.0', 'Accept': 'application/vnd.github+json' }
  };
  https.get(options, (res) => {
    const code = Number(res.statusCode || 0);
    if (code < 200 || code >= 300) {
      res.resume();
      reject(new Error(`github_api_http_${code}`));
      return;
    }
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      try {
        const releases = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!Array.isArray(releases)) { resolve([]); return; }
        const filtered = releases.filter((r) => {
          if (!r || !r.tag_name) return false;
          if (!includePrerelease && r.prerelease) return false;
          return true;
        });
        resolve(filtered.map((r) => ({
          tag: r.tag_name,
          name: r.name || r.tag_name,
          prerelease: !!r.prerelease,
          published: r.published_at || r.created_at || null,
          assetUrl: r.zipball_url || null,
          assetSize: 0
        })));
      } catch(err) { console.error('XERR', err);
        reject(err);
      }
    });
    res.on('error', reject);
  }).on('error', reject);
});

const requestDownload = (url, destinationPath, redirects = 0) => new Promise((resolve, reject) => {
  const maxRedirects = 5;
  if (redirects > maxRedirects) {
    reject(new Error('too_many_redirects'));
    return;
  }

  const parsed = new URL(url);
  const client = parsed.protocol === 'http:' ? http : https;

  const req = client.get(parsed, async (res) => {
    const code = Number(res.statusCode || 0);
    if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
      const redirectUrl = new URL(res.headers.location, parsed).toString();
      res.resume();
      try {
        await requestDownload(redirectUrl, destinationPath, redirects + 1);
        resolve();
      } catch(err) { console.error('XERR', err);
        reject(err);
      }
      return;
    }

    if (code < 200 || code >= 300) {
      res.resume();
      reject(new Error(`download_failed_http_${code}`));
      return;
    }

    try {
      const fileStream = createWriteStream(destinationPath);
      await pipeline(res, fileStream);
      resolve();
    } catch(err) { console.error('XERR', err);
      reject(err);
    }
  });

  req.on('error', reject);
});

const locateExtractRoot = async (extractDir) => {
  const entries = await fs.promises.readdir(extractDir, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (dirs.length === 1) {
    return path.join(extractDir, dirs[0]);
  }
  return extractDir;
};

const ensureAdmin = (security) => (req, res, next) => {
  const enabled = typeof security?.isEnabled === 'function' ? security.isEnabled() : false;
  if (!enabled) return next();
  if (!req.user) return res.status(401).json({ error: 'auth_required' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  return next();
};

const readAccessSnapshot = (dataRoot) => {
  try {
    return readProjectAccessFromDb(dataRoot);
  } catch {
    return { projects: {} };
  }
};

const resolveProjectAccessEntry = (snapshot, projectId) => {
  const projects = snapshot && typeof snapshot === 'object' && snapshot.projects && typeof snapshot.projects === 'object'
    ? snapshot.projects
    : {};
  if (!projectId) return null;
  if (Object.prototype.hasOwnProperty.call(projects, projectId)) {
    return projects[projectId];
  }
  const target = String(projectId).toLowerCase();
  for (const key of Object.keys(projects)) {
    if (String(key).toLowerCase() === target) {
      return projects[key];
    }
  }
  return null;
};

const userCanAccessProject = (snapshot, user, projectId) => {
  const entry = resolveProjectAccessEntry(snapshot, projectId) || {};
  if (user && user.role === 'admin') return true;

  const publicAccess = entry.public === true;
  if (!user) return publicAccess;

  const userProjects = toArray(user.projects);
  const allowedUsers = toArray(entry.allowedUsers);
  const allowedRoles = toArray(entry.allowedRoles);
  const viaAssignment = userProjects.includes(projectId);
  const viaUser = !!(user.id && allowedUsers.includes(user.id));
  const viaRole = !!(user.role && allowedRoles.includes(user.role));

  return publicAccess || viaAssignment || viaUser || viaRole;
};

const listProjectsFromDisk = async (projectsDir) => {
  let entries;
  try {
    entries = await fs.promises.readdir(projectsDir, { withFileTypes: true });
  } catch(err) { console.error('XERR', err);
    if (err?.code === 'ENOENT') return [];
    throw err;
  }

  const projectsById = new Map();

  for (const entry of entries) {
    if (!entry) continue;

    if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (!lower.endsWith('.qgs') && !lower.endsWith('.qgz')) continue;
      const id = entry.name.replace(/\.(qgs|qgz)$/i, '');
      projectsById.set(id.toLowerCase(), { id, name: id, file: path.join(projectsDir, entry.name) });
      continue;
    }

    if (!entry.isDirectory()) continue;

    const bundleId = String(entry.name || '').trim();
    if (!bundleId) continue;
    if (bundleId === '.git' || bundleId === 'node_modules') continue;

    const bundleRoot = path.join(projectsDir, bundleId);
    const bundleRootResolved = path.resolve(bundleRoot);
    const bundleRootLower = bundleRootResolved.toLowerCase();
    const stack = [bundleRoot];
    const matches = [];
    let scanned = 0;
    const MAX_SCAN = 2000;

    while (stack.length) {
      const current = stack.pop();
      scanned += 1;
      if (scanned > MAX_SCAN) break;

      let listing;
      try {
        listing = await fs.promises.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const child of listing) {
        if (!child) continue;
        const fullPath = path.join(current, child.name);
        const fullResolved = path.resolve(fullPath);
        if (!fullResolved.toLowerCase().startsWith(bundleRootLower + path.sep)) continue;

        if (child.isDirectory()) {
          if (child.name === '.git' || child.name === 'node_modules') continue;
          stack.push(fullPath);
          continue;
        }

        if (!child.isFile()) continue;
        const lower = child.name.toLowerCase();
        if (lower.endsWith('.qgs') || lower.endsWith('.qgz')) {
          matches.push(fullPath);
          if (matches.length > 1) break;
        }
      }

      if (matches.length > 1) break;
    }

    if (matches.length === 1) {
      projectsById.set(bundleId.toLowerCase(), { id: bundleId, name: bundleId, file: matches[0] });
    }
  }

  return Array.from(projectsById.values()).sort((a, b) => a.id.localeCompare(b.id));
};

/**
 * Fetch Lantmäteriet information by coordinates
 * Supports: fastighet, befolkning, adress, ort, agare, taxering, byggnader, markdata
 *
 * ⚠ SWEDISH MARKET ONLY — Requires a valid agreement with Lantmäteriet.
 * Environment variables (see .env.example):
 *   LANTMATERI_API_URL, LANTMATERI_API_KEY
 *   LANTMATERI_FASTIGHET_API_KEY, LANTMATERI_BEFOLKNING_API_KEY, LANTMATERI_ADRESS_API_KEY
 *   LANTMATERI_CLIENT_ID, LANTMATERI_CLIENT_SECRET, LANTMATERI_TOKEN_URL (OAuth2)
 */
let _lmvBannerShown = false;
function _showLmvBanner() {
  if (_lmvBannerShown) return;
  _lmvBannerShown = true;
  const hasKey = !!(process.env.LANTMATERI_API_KEY
    || process.env.LANTMATERI_FASTIGHET_API_KEY
    || process.env.LANTMATERI_CLIENT_ID);
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  Qtiler2Origo · Lantmäteriet-kontroll                            ║');
  console.log('║  ⚠ ENDAST FÖR DEN SVENSKA MARKNADEN / SWEDISH MARKET ONLY        ║');
  console.log('║  Kräver giltigt avtal med Lantmäteriet (api.lantmateriet.se)     ║');
  if (!hasKey) {
    console.log('║  ❗ Ingen API-nyckel konfigurerad → använder DEMO/MOCK-data       ║');
    console.log('║     Sätt LANTMATERI_API_KEY i .env för riktig data               ║');
  } else {
    console.log('║  ✓ API-nyckel hittad i miljövariablerna                          ║');
  }
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
}

const fetchLantmateriInfo = async (infoType, lon, lat) => {
  _showLmvBanner();
  const LANTMATERI_API_URL = process.env.LANTMATERI_API_URL || process.env.LANTMATERI_SEARCH_URL || 'https://api.lantmateriet.se';
  const LANTMATERI_API_KEY = process.env.LANTMATERI_API_KEY || '';
  
  try {
    const results = [];

    // Different info types call different Lantmäteriet API endpoints
    // DEMO/MOCK implementation - replace with real API calls
    
    switch (infoType) {
      case 'fastighet':
        results.push(...await fetchFastighet(lon, lat));
        break;
      case 'befolkning':
        results.push(...await fetchBefolkning(lon, lat));
        break;
      case 'adress':
        results.push(...await fetchAdress(lon, lat));
        break;
      case 'ort':
        results.push(...await fetchOrt(lon, lat));
        break;
      case 'agare':
        results.push(...await fetchAgare(lon, lat));
        break;
      case 'taxering':
        results.push(...await fetchTaxering(lon, lat));
        break;
      case 'byggnader':
        results.push(...await fetchByggnader(lon, lat));
        break;
      case 'markdata':
        results.push(...await fetchMarkdata(lon, lat));
        break;
      default:
        throw new Error(`Unknown info type: ${infoType}`);
    }

    return results;
  } catch (error) {
    console.error('[Lantmäteri Info] Error:', error);
    throw error;
  }
};

/**
 * Fetch cadastral property info by coordinates
 */
const fetchFastighet = async (lon, lat) => {
  // DEMO/MOCK - In production, call real Lantmäteriet Fastighetsinfo API
  // Real API endpoint: https://api.lantmateriet.se/fastighet/v1/point?lon=X&lat=Y
  
  // Simulate API response with mock data
  return [
    {
      name: 'Stockholm Södermalm 1:1',
      type: 'Fastighet',
      description: 'Registerfastighet i Stockholm kommun',
      kommun: 'Stockholm',
      lan: 'Stockholm län',
      areal: 15000,
      fastighetsbeteckning: 'SÖDERMALM 1:1',
      objektidentitet: '12345678-1234-1234-1234-123456789012',
      registerenhet: 'Stockholm 1:1'
    }
  ];
};

/**
 * Fetch population/demographic info by coordinates
 */
const fetchBefolkning = async (lon, lat) => {
  // DEMO/MOCK - In production, call Lantmäteriet or SCB (Statistiska centralbyrån)
  return [
    {
      name: 'Södermalm befolkning',
      type: 'Befolkning',
      description: 'Demografisk information för området',
      befolkning: 125000,
      täthet: '8,333 inv/km²',
      område: 'Södermalm stadsdel',
      kommun: 'Stockholm'
    }
  ];
};

/**
 * Fetch address info by coordinates (reverse geocoding)
 */
const fetchAdress = async (lon, lat) => {
  // DEMO/MOCK
  return [
    {
      name: 'Drottninggatan 1',
      type: 'Adress',
      description: '111 51 Stockholm',
      gatuadress: 'Drottninggatan 1',
      postnummer: '111 51',
      postort: 'Stockholm',
      kommun: 'Stockholm'
    }
  ];
};

/**
 * Fetch locality/place info by coordinates
 */
const fetchOrt = async (lon, lat) => {
  // DEMO/MOCK
  return [
    {
      name: 'Stockholm',
      type: 'Ort',
      description: 'Huvudstad och största stad i Sverige',
      befolkning: 975551,
      lan: 'Stockholm län',
      kommun: 'Stockholm kommun'
    }
  ];
};

/**
 * Fetch owner info for property at coordinates
 */
const fetchAgare = async (lon, lat) => {
  // DEMO/MOCK - Real API requires special permissions
  return [
    {
      name: 'Ägaruppgift',
      type: 'Ägare',
      description: 'Denna information kräver särskilt tillstånd',
      notice: 'Ägaruppgifter kan endast lämnas ut enligt inskrivningsförordningen'
    }
  ];
};

/**
 * Fetch tax assessment info by coordinates
 */
const fetchTaxering = async (lon, lat) => {
  // DEMO/MOCK
  return [
    {
      name: 'Taxeringsvärde',
      type: 'Taxering',
      description: 'Taxeringsinformation för fastigheten',
      taxeringsvarde: '4,500,000 SEK',
      taxeringsår: 2022,
      byggnadsvarde: '3,200,000 SEK',
      markvarde: '1,300,000 SEK'
    }
  ];
};

/**
 * Fetch building info by coordinates
 */
const fetchByggnader = async (lon, lat) => {
  // DEMO/MOCK
  return [
    {
      name: 'Byggnad 1',
      type: 'Byggnad',
      description: 'Flerbostadshus',
      byggnadstyp: 'Flerbostadshus',
      byggår: 1920,
      area: 850,
      våningar: 5,
      lägenheter: 12
    }
  ];
};

/**
 * Fetch land/terrain info by coordinates
 */
const fetchMarkdata = async (lon, lat) => {
  // DEMO/MOCK
  return [
    {
      name: 'Markdata',
      type: 'Markdata',
      description: 'Information om mark och terräng',
      markanvandning: 'Bebyggd mark - bostäder',
      topografi: 'Flack terräng',
      jordart: 'Lera',
      höjd: '5 m ö.h.'
    }
  ];
};

export const register = async ({ app, security, dataDir, baseDir, registerStore }) => {
  const pluginSlug = 'Qtiler2Origo';
  const adminUiDir = path.join(baseDir, 'admin-ui');
  const clientDir = path.join(baseDir, 'client');
  const repoRootCandidates = Array.from(new Set([
    path.resolve(process.cwd()),
    path.resolve(baseDir),
    path.resolve(baseDir, '..'),
    path.resolve(baseDir, '..', '..')
  ]));
  const resolveRepoPath = (...parts) => {
    for (const root of repoRootCandidates) {
      const candidate = path.join(root, ...parts);
      if (fs.existsSync(candidate)) return candidate;
    }
    return path.join(process.cwd(), ...parts);
  };
  const workspaceRoot = path.dirname(resolveRepoPath('qgisprojects'));
  const cacheRoot = resolveRepoPath('cache');
  const dataRoot = path.resolve(dataDir, '..');
  const runtimeRoot = path.join(dataDir, 'origo');
  const installRoot = path.join(runtimeRoot, 'current');
  const publishedRoot = path.join(runtimeRoot, 'published');
  const publishedThumbsRoot = path.join(publishedRoot, 'thumbs');
  const brandingRoot = path.join(runtimeRoot, 'branding');
  const portalAssetsRoot = path.join(runtimeRoot, 'portal-assets');
  const legendLibraryRoot = path.join(runtimeRoot, 'legend-library');
  const legendLibraryIndexPath = path.join(legendLibraryRoot, 'index.json');
  const thumbCacheDir = path.join(dataRoot, 'thumbs');
  const projectsCatalogPath = path.join(runtimeRoot, 'projects-catalog.json');
  const portalPagesPath = path.join(runtimeRoot, 'portal-pages.json');
  const projectsDir = resolveRepoPath('qgisprojects');
  let standaloneServer = null;
  let standalonePort = null;

  const stateStore = registerStore('state.json', {
    repo: DEFAULT_REPO,
    version: DEFAULT_VERSION,
    installPath: installRoot,
    standalonePort: DEFAULT_STANDALONE_PORT,
    installedAt: null,
    lastSyncAt: null,
    lastError: null,
    logoFile: null,
    logoUpdatedAt: null
  });
  previewStateStore = createJsonStore(path.join(runtimeRoot, 'preview-states.json'), {});

  await fs.promises.mkdir(runtimeRoot, { recursive: true });
  await fs.promises.mkdir(publishedRoot, { recursive: true });
  await fs.promises.mkdir(publishedThumbsRoot, { recursive: true });
  await fs.promises.mkdir(brandingRoot, { recursive: true });
  await fs.promises.mkdir(portalAssetsRoot, { recursive: true });
  await fs.promises.mkdir(legendLibraryRoot, { recursive: true });
  await fs.promises.mkdir(thumbCacheDir, { recursive: true });

  const rewriteLoopbackBaseUrls = (input, baseUrl = '') => {
    const normalizedBaseUrl = String(baseUrl || '').trim().replace(/\/+$/u, '');
    if (!normalizedBaseUrl) return input;
    const pattern = /http:\/\/(?:localhost|127\.0\.0\.1):3000(?=\/|$)/giu;
    if (typeof input === 'string') {
      return input.replace(pattern, normalizedBaseUrl);
    }
    try {
      const raw = JSON.stringify(input);
      return JSON.parse(raw.replace(pattern, normalizedBaseUrl));
    } catch {
      return input;
    }
  };

  const sendRebasedJsonFile = async (res, filePath, baseUrl) => {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const rebased = rewriteLoopbackBaseUrls(raw, baseUrl);
    res.type('application/json');
    return res.send(rebased);
  };

  const adminOnly = ensureAdmin(security);
  const isAuthActive = () => (typeof security?.isEnabled === 'function' ? security.isEnabled() : false);
  const portalEditorOnly = (req, res, next) => {
    if (!isAuthActive()) return next();
    if (!req.user) return res.status(401).json({ error: 'auth_required' });
    const canEdit = typeof security?.canEditPortal === 'function'
      ? security.canEditPortal(req.user, pluginSlug)
      : req.user.role === 'admin';
    if (canEdit) return next();
    return res.status(403).json({ error: 'forbidden' });
  };
  const lmvDb = getAuthDb(dataRoot);
  lmvDb.exec(`
    CREATE TABLE IF NOT EXISTS qtiler2origo_lmv_products (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      url_template TEXT,
      base_url TEXT,
      collections TEXT NOT NULL DEFAULT '[]',
      auth_scheme TEXT NOT NULL DEFAULT 'Bearer',
      api_key TEXT,
      username TEXT,
      password TEXT,
      oauth_client_id TEXT,
      oauth_client_secret TEXT,
      oauth_token_url TEXT,
      oauth_scope TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  const lmvStatements = {
    list: lmvDb.prepare('SELECT * FROM qtiler2origo_lmv_products ORDER BY id'),
    get: lmvDb.prepare('SELECT * FROM qtiler2origo_lmv_products WHERE id = ?'),
    upsert: lmvDb.prepare(`
      INSERT INTO qtiler2origo_lmv_products (
        id, label, url_template, base_url, collections, auth_scheme, api_key,
        username, password, oauth_client_id, oauth_client_secret, oauth_token_url,
        oauth_scope, enabled, created_at, updated_at
      ) VALUES (
        @id, @label, @url_template, @base_url, @collections, @auth_scheme, @api_key,
        @username, @password, @oauth_client_id, @oauth_client_secret, @oauth_token_url,
        @oauth_scope, @enabled, @created_at, @updated_at
      ) ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        url_template = excluded.url_template,
        base_url = excluded.base_url,
        collections = excluded.collections,
        auth_scheme = excluded.auth_scheme,
        api_key = excluded.api_key,
        username = excluded.username,
        password = excluded.password,
        oauth_client_id = excluded.oauth_client_id,
        oauth_client_secret = excluded.oauth_client_secret,
        oauth_token_url = excluded.oauth_token_url,
        oauth_scope = excluded.oauth_scope,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `),
    delete: lmvDb.prepare('DELETE FROM qtiler2origo_lmv_products WHERE id = ?')
  };
  const sanitizeLmvProductId = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '').slice(0, 80);
  const parseLmvCollections = (value) => {
    if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v || '').trim()).filter(Boolean);
    } catch {}
    return value.split(',').map((v) => v.trim()).filter(Boolean);
  };
  const lmvRowToProduct = (row) => {
    if (!row) return null;
    return {
      id: row.id,
      label: row.label || row.id,
      urlTemplate: row.url_template || null,
      baseUrl: row.base_url || null,
      collections: parseLmvCollections(row.collections),
      authScheme: row.auth_scheme || 'Bearer',
      apiKey: row.api_key || '',
      basicAuth: { username: row.username || '', password: row.password || '' },
      oauth: {
        clientId: row.oauth_client_id || '',
        clientSecret: row.oauth_client_secret || '',
        tokenUrl: row.oauth_token_url || '',
        scope: row.oauth_scope || ''
      },
      enabled: row.enabled !== 0,
      source: 'sqlite',
      updatedAt: row.updated_at || null
    };
  };
  const productHasLmvCredentials = (product) => !!(
    product?.apiKey
    || product?.basicAuth?.username
    || product?.basicAuth?.password
    || (product?.oauth?.clientId && product?.oauth?.clientSecret)
    || (product?.envKey && (process.env[product.envKey] || process.env.LANTMATERI_API_KEY))
  );
  const publicLmvProduct = (id, product) => ({
    id,
    label: product?.label || id,
    enabled: product?.enabled !== false,
    configured: productHasLmvCredentials(product),
    source: product?.source || 'builtin',
    hasApiKey: !!(product?.apiKey || (product?.envKey && (process.env[product.envKey] || process.env.LANTMATERI_API_KEY))),
    hasBasicAuth: !!(product?.basicAuth?.username || product?.basicAuth?.password),
    hasOAuth: !!(product?.oauth?.clientId && product?.oauth?.clientSecret),
    collections: Array.isArray(product?.collections) ? product.collections : []
  });
  const readLmvStoredProducts = () => lmvStatements.list.all().map(lmvRowToProduct).filter(Boolean);

  // Public alias: rewrite `/Qtiler2Origo/maps/...` to the internal Origo mount
  // `/plugins/Qtiler2Origo/origo/...` so the viewer can be reached at the same
  // base path as the public maps portal. This lets a single IIS URL Rewrite
  // rule (e.g. `^Qtiler2Origo/(.*)`) cover both the portal and the viewer.
  // The exact path `/Qtiler2Origo/maps` (without trailing slash) keeps serving
  // the portal HTML registered further below.
  const mapsAlias = '/Qtiler2Origo/maps';
  const origoMount = `/plugins/${pluginSlug}/origo`;
  app.use((req, _res, next) => {
    const url = req.url || '';
    // /Qtiler2Origo/maps?qtiler_profile=...  → viewer
    if (url === mapsAlias || url.startsWith(`${mapsAlias}?`)) {
      const qs = url.indexOf('?') >= 0 ? url.slice(url.indexOf('?')) : '';
      // Only redirect to the viewer when a profile is requested; otherwise
      // fall through so the portal handler can serve maps.html.
      if (qs.includes('qtiler_profile=')) {
        req.url = `${origoMount}/${qs}`;
      }
    } else if (url.startsWith(`${mapsAlias}/`)) {
      req.url = `${origoMount}${url.slice(mapsAlias.length)}`;
    }
    next();
  });
  const logoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_LOGO_BYTES },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(String(file?.originalname || '')).toLowerCase();
      if (!ALLOWED_LOGO_EXTENSIONS.has(ext)) {
        return cb(new Error('invalid_logo_extension'));
      }
      cb(null, true);
    }
  });

  const portalImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PORTAL_IMAGE_BYTES },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(String(file?.originalname || '')).toLowerCase();
      if (!ALLOWED_PORTAL_IMAGE_EXTENSIONS.has(ext)) {
        return cb(new Error('invalid_portal_image_extension'));
      }
      cb(null, true);
    }
  });

  const legendLibraryUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_LEGEND_LIBRARY_BYTES },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(String(file?.originalname || '')).toLowerCase();
      if (!ALLOWED_LEGEND_LIBRARY_EXTENSIONS.has(ext)) {
        return cb(new Error('invalid_legend_library_extension'));
      }
      cb(null, true);
    }
  });

  const legendLibraryPublicUrl = (fileName, stamp = '') => {
    const safe = sanitizeFileToken(fileName);
    if (!safe) return '';
    return `/plugins/${pluginSlug}/legend-library/${encodeURIComponent(safe)}${stamp ? `?v=${encodeURIComponent(String(stamp))}` : ''}`;
  };

  const readLegendLibraryIndex = async () => {
    try {
      const raw = await fs.promises.readFile(legendLibraryIndexPath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.items) ? parsed.items : [];
    } catch {
      return [];
    }
  };

  const writeLegendLibraryIndex = async (items) => {
    await fs.promises.mkdir(legendLibraryRoot, { recursive: true });
    await fs.promises.writeFile(legendLibraryIndexPath, JSON.stringify({ items }, null, 2), 'utf8');
  };

  const cropLegendLibraryBuffer = async (buffer, ext) => {
    if (ext === '.svg') return { buffer, ext: '.svg', mime: 'image/svg+xml' };
    const png = await sharp(buffer)
      .resize(LEGEND_SWATCH_SIZE, LEGEND_SWATCH_SIZE, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 0 }
      })
      .png()
      .toBuffer();
    return { buffer: png, ext: '.png', mime: 'image/png' };
  };

  const listLegendLibraryItems = async () => {
    const items = await readLegendLibraryIndex();
    const out = [];
    for (const item of items) {
      const fileName = sanitizeFileToken(item?.fileName || '');
      if (!fileName) continue;
      const filePath = path.join(legendLibraryRoot, fileName);
      try {
        const stat = await fs.promises.stat(filePath);
        if (!stat.isFile() || stat.size <= 0) continue;
        out.push({
          id: String(item.id || fileName),
          name: String(item.name || fileName),
          fileName,
          url: legendLibraryPublicUrl(fileName, stat.mtimeMs),
          mime: String(item.mime || ''),
          createdAt: item.createdAt || new Date(stat.mtimeMs).toISOString()
        });
      } catch {
        /* missing file */
      }
    }
    return out;
  };

  const removeCachedLayerThumbnails = async (projectId, layerName) => {
    const safePid = sanitizeFileToken(projectId);
    const layerToken = sanitizeFileToken(String(layerName || '').replace(/,/g, '_'));
    if (!safePid || !layerToken) return 0;
    let removed = 0;
    const entries = await fs.promises.readdir(thumbCacheDir).catch(() => []);
    await Promise.all(entries.map(async (name) => {
      if (!name.startsWith(`${safePid}_`) || !name.toLowerCase().endsWith('.jpg')) return;
      if (!name.includes(layerToken)) return;
      try {
        await fs.promises.unlink(path.join(thumbCacheDir, name));
        removed += 1;
      } catch (_) {}
    }));
    return removed;
  };

  const readState = async () => {
    const state = await stateStore.read();
    const storedPort = Number(state?.standalonePort || DEFAULT_STANDALONE_PORT);
    const standalonePort = Number.isFinite(ENV_STANDALONE_PORT) && ENV_STANDALONE_PORT > 0
      ? ENV_STANDALONE_PORT
      : storedPort;
    return {
      repo: String(state?.repo || DEFAULT_REPO),
      version: String(state?.version || DEFAULT_VERSION),
      installPath: String(state?.installPath || installRoot),
      standalonePort,
      installedAt: state?.installedAt || null,
      lastSyncAt: state?.lastSyncAt || null,
      lastError: state?.lastError || null,
      logoFile: state?.logoFile || null,
      logoUpdatedAt: state?.logoUpdatedAt || null
    };
  };

  const resolveLogoPath = async () => {
    const state = await readState();
    if (!state.logoFile) return null;
    const fullPath = path.join(brandingRoot, state.logoFile);
    try {
      await fs.promises.access(fullPath, fs.constants.R_OK);
      return fullPath;
    } catch {
      return null;
    }
  };

  const getLogoPublicUrl = async () => {
    const state = await readState();
    if (!state.logoFile) return null;
    const stamp = encodeURIComponent(String(state.logoUpdatedAt || '0'));
    return `/plugins/${pluginSlug}/public/branding/logo?v=${stamp}`;
  };

  const getBrandingStatus = async () => {
    const state = await readState();
    const logoPath = await resolveLogoPath();
    return {
      hasLogo: !!logoPath,
      logoFile: logoPath ? state.logoFile : null,
      logoUpdatedAt: logoPath ? state.logoUpdatedAt : null,
      logoUrl: logoPath ? await getLogoPublicUrl() : null
    };
  };

  const requestMatchesPluginBrandingAlias = (req, slug) => {
    const referer = String(req?.get?.('referer') || '').toLowerCase();
    if (!referer) return false;
    return referer.includes(`/plugins/${String(slug || '').toLowerCase()}/`)
      || referer.includes(`/${String(slug || '').toLowerCase()}/`);
  };

  const applyBrandingToQwc2Configs = async () => {
    const state = await readState();
    const logoPath = await resolveLogoPath();
    const logoSrc = logoPath ? await getLogoPublicUrl() : null;
    const configPaths = Array.from(new Set([
      path.join(installRoot, 'build', 'config.json'),
      path.join(installRoot, 'dist', 'config.json'),
      path.join(installRoot, 'prod', 'config.json'),
      path.join(installRoot, 'static', 'config.json'),
      path.join(installRoot, 'config.json')
    ]));

    for (const cfgPath of configPaths) {
      try {
        const raw = await fs.promises.readFile(cfgPath, 'utf8');
        const parsed = JSON.parse(raw || '{}');
        if (!Array.isArray(parsed.plugins)) continue;
        const topBarPlugin = parsed.plugins.find((item) => String(item?.name || '') === 'TopBar');
        if (!topBarPlugin) continue;
        if (!topBarPlugin.cfg || typeof topBarPlugin.cfg !== 'object') {
          topBarPlugin.cfg = {};
        }

        if (logoSrc) {
          topBarPlugin.cfg.logoSrc = logoSrc;
        } else {
          delete topBarPlugin.cfg.logoSrc;
        }

        await fs.promises.writeFile(cfgPath, JSON.stringify(parsed, null, 2), 'utf8');
      } catch {
        // Skip missing/unreadable configs.
      }
    }
  };

  const resolveQwc2WebRoot = async () => {
    const candidates = [
      path.join(installRoot, 'build'),
      path.join(installRoot, 'dist'),
      path.join(installRoot, 'prod'),
      path.join(installRoot, 'static'),
      installRoot
    ];

    for (const candidate of candidates) {
      try {
        await fs.promises.access(path.join(candidate, 'index.html'), fs.constants.R_OK);
        await fs.promises.access(path.join(candidate, 'js', 'origo.js'), fs.constants.R_OK);
        return candidate;
      } catch {
        // try next candidate
      }
    }

    return null;
  };

  const hasQwc2Install = async () => {
    const webRoot = await resolveQwc2WebRoot();
    return !!webRoot;
  };

  const publishedProfilePath = (projectId) => path.join(publishedRoot, `${sanitizeFileToken(projectId)}.json`);

  const getDefaultPublishedBackground = (profile) => {
    const backgrounds = Array.isArray(profile?.backgrounds) ? profile.backgrounds : [];
    if (!backgrounds.length) return null;
    const defaultKey = String(profile?.defaultBackgroundKey || '').trim();
    const match = (defaultKey
      ? backgrounds.find((bg) => String(bg?.key || '').trim() === defaultKey)
      : null) || backgrounds.find((bg) => bg?.isDefault === true) || null;
    if (!match) return null;
    const type = toBackgroundType(match?.type);
    if (type === 'layer') {
      const sourceProjectId = normalizeProjectId(match?.sourceProjectId || profile?.backgroundProjectId || '');
      const name = String(match?.name || '').trim();
      if (!sourceProjectId || !name) return null;
      return { type, sourceProjectId, name, key: String(match?.key || '').trim() };
    }
    if (type === 'osm') return { type, key: String(match?.key || '').trim() };
    if (type === 'none') return { type, key: String(match?.key || '').trim() };
    return null;
  };

  const getRequestApiKey = (req) => String(
    req?.get?.('x-api-key')
    || req?.get?.('x-qtiler-key')
    || req?.get?.('x-api_key')
    || req?.query?.api_key
    || req?.query?.apikey
    || req?.query?.apiKey
    || req?.query?.API_KEY
    || ''
  ).trim();

  const buildPublishedThumbnailQuery = ({ mainLayerNames, background, apiKey = '' }) => {
    const params = new URLSearchParams();
    const layerNames = Array.isArray(mainLayerNames)
      ? mainLayerNames.map((name) => String(name || '').trim()).filter(Boolean)
      : [];
    if (layerNames.length) params.set('LAYERS', layerNames.join(','));
    if (background?.type === 'layer' && background?.sourceProjectId && background?.name) {
      params.set('BGPROJECT', background.sourceProjectId);
      params.set('BGLAYER', background.name);
    } else if (background?.type === 'osm') {
      params.set('BGTYPE', 'osm');
    }
    if (apiKey) params.set('api_key', apiKey);
    return params.toString() ? `?${params.toString()}` : '';
  };

  const clearThumbnailRenderCaches = async (projectIds) => {
    const ids = Array.from(new Set((Array.isArray(projectIds) ? projectIds : [])
      .map((value) => normalizeProjectId(value || ''))
      .filter(Boolean)));
    let removed = 0;
    for (const projectId of ids) {
      const safeProjectId = sanitizeFileToken(projectId);
      if (!safeProjectId) continue;
      const targets = [
        path.join(cacheRoot, safeProjectId, '_wms_tiles'),
        path.join(cacheRoot, '_wms_tiles', safeProjectId)
      ];
      for (const target of targets) {
        try {
          await fs.promises.rm(target, { recursive: true, force: true });
          removed += 1;
        } catch (_) {}
      }
    }
    return removed;
  };

  const publishedThumbnailFilename = (profileKey) => `${sanitizeFileToken(profileKey)}.jpg`;
  const publishedThumbnailPath = (profileKey) => path.join(publishedThumbsRoot, publishedThumbnailFilename(profileKey));
  const publishedThumbnailUrl = (profileKey, stamp = '') => {
    const fileName = publishedThumbnailFilename(profileKey);
    if (!fileName) return '';
    return `/plugins/${pluginSlug}/published/thumbs/${encodeURIComponent(fileName)}${stamp ? `?v=${encodeURIComponent(String(stamp))}` : ''}`;
  };
  const readPublishedThumbnailMeta = async (profileKey) => {
    const filePath = publishedThumbnailPath(profileKey);
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.size <= 0) return null;
      return {
        filePath,
        updatedAt: stat.mtimeMs,
        url: publishedThumbnailUrl(profileKey, stat.mtimeMs)
      };
    } catch {
      return null;
    }
  };
  const resolvePublishedProfileRecord = async (profileToken) => {
    const directKey = sanitizeFileToken(profileToken);
    if (directKey) {
      const direct = await readPublishedProfile(directKey);
      if (direct?.projectId) return { profileKey: directKey, profile: direct };
    }
    const allProfiles = await readAllPublishedProfiles();
    const wanted = String(profileToken || '').trim().toLowerCase();
    const match = allProfiles.find((profile) => {
      return [profile?.profileKey, profile?.projectId, profile?.name].some((candidate) => String(candidate || '').trim().toLowerCase() === wanted);
    }) || null;
    return match?.projectId ? { profileKey: String(match.profileKey || '').trim(), profile: match } : null;
  };
  const regeneratePublishedThumbnail = async ({ profileKey, profile, baseUrl, cookieHeader, apiKey = '', authorization = '', clearCaches = true }) => {
    const safeProfileKey = sanitizeFileToken(profileKey || profile?.profileKey || profile?.name || '');
    const projectId = normalizeProjectId(profile?.projectId || '');
    const mainLayerNames = (Array.isArray(profile?.layers) ? profile.layers : [])
      .filter((layer) => layer?.role === 'main')
      .map((layer) => String(layer?.name || '').trim())
      .filter(Boolean);
    if (!safeProfileKey || !projectId || !mainLayerNames.length) return null;
    const background = getDefaultPublishedBackground(profile);
    if (clearCaches) {
      await clearThumbnailRenderCaches([
        projectId,
        background?.type === 'layer' ? background.sourceProjectId : null
      ]);
    }
    const layerAttempts = Array.from(new Set([
      mainLayerNames,
      mainLayerNames.slice(0, 12),
      mainLayerNames.slice(0, 6),
      mainLayerNames.slice(0, 1)
    ].filter((list) => Array.isArray(list) && list.length).map((list) => list.join(','))));

    let generatedPath = null;
    for (const layers of layerAttempts) {
      const cacheEntry = buildThumbnailCacheEntry(projectId, layers, background);
      if (!cacheEntry) continue;
      await fs.promises.unlink(cacheEntry.thumbPath).catch(() => {});
      generatedPath = await generateThumbnail(projectId, layers, baseUrl, cookieHeader, {
        background,
        apiKey,
        authorization
      });
      if (generatedPath) break;
    }
    if (!generatedPath) return null;
    await fs.promises.mkdir(publishedThumbsRoot, { recursive: true });
    const targetPath = publishedThumbnailPath(safeProfileKey);
    await fs.promises.copyFile(generatedPath, targetPath);
    return readPublishedThumbnailMeta(safeProfileKey);
  };

  const collectPublishedProfiles = async (baseUrl = '', options = {}) => {
    const apiKey = String(options?.apiKey || '').trim();
    let entries;
    try {
      entries = await fs.promises.readdir(publishedRoot, { withFileTypes: true });
    } catch(err) { console.error('XERR', err);
      if (err?.code === 'ENOENT') return [];
      throw err;
    }

    const files = entries
      .filter((entry) => entry.isFile() && String(entry.name || '').toLowerCase().endsWith('.json'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    const rows = [];
    for (const fileName of files) {
      const fullPath = path.join(publishedRoot, fileName);
      try {
        const raw = await fs.promises.readFile(fullPath, 'utf8');
        const parsed = JSON.parse(raw || '{}');
        const projectId = normalizeProjectId(parsed?.projectId || fileName.replace(/\.json$/i, ''));
        if (!projectId) continue;
        const url = `/plugins/${pluginSlug}/published/${encodeURIComponent(fileName)}`;
        // Launch URL: use the same-origin webmap path so auth/session is preserved
        const baseLaunch = baseUrl ? baseUrl.replace(/\/+$/,'') : '';
        const profileKey = fileName.replace(/\.json$/i, '');
        const standaloneLaunch = baseLaunch
          ? `${baseLaunch}/Qtiler2Origo/maps/?qtiler_profile=${encodeURIComponent(profileKey)}#/?t=${encodeURIComponent(projectId)}`
          : `/Qtiler2Origo/maps/?qtiler_profile=${encodeURIComponent(profileKey)}#/?t=${encodeURIComponent(projectId)}`;
        const thumbnailMeta = await readPublishedThumbnailMeta(profileKey);
        rows.push({
          projectId,
          profileKey,
          name: parsed?.name || projectId,
          description: parsed?.description || null,
          generatedAt: parsed?.generatedAt || null,
          thumbnailUrl: thumbnailMeta?.url || '',
          url,
          absoluteUrl: baseUrl ? `${baseUrl}${url}` : url,
          launchUrl: standaloneLaunch
        });
      } catch {
        // Skip malformed profile but keep other profiles visible.
      }
    }
    return rows;
  };

  const buildProjectsCatalog = async (reqUser, baseUrlOverride = '') => {
    const snapshot = readAccessSnapshot(dataRoot);
    const allProjects = await listProjectsFromDisk(projectsDir);
    const baseUrl = String(baseUrlOverride || '').trim().replace(/\/+$/g, '');
    const projects = [];

    for (const project of allProjects) {
      const projectId = normalizeProjectId(project.id);
      if (!projectId) continue;
      if (!userCanAccessProject(snapshot, reqUser || null, projectId)) continue;

      const access = resolveProjectAccessEntry(snapshot, projectId) || {};
      projects.push({
        id: projectId,
        name: project.name,
        isPublic: access.public === true,
        allowedUsers: toArray(access.allowedUsers),
        allowedRoles: toArray(access.allowedRoles),
        services: {
          map: `${baseUrl}/map?project=${encodeURIComponent(projectId)}`,
          wmsCapabilities: `${baseUrl}/wms?SERVICE=WMS&REQUEST=GetCapabilities&project=${encodeURIComponent(projectId)}`,
          wfsCapabilities: `${baseUrl}/wfs?SERVICE=WFS&REQUEST=GetCapabilities&project=${encodeURIComponent(projectId)}`,
          wmtsCapabilities: `${baseUrl}/wmts/${encodeURIComponent(projectId)}/WMTSCapabilities.xml`
        }
      });
    }

    return {
      generatedAt: nowIso(),
      qtilerBaseUrl: baseUrl,
      projects
    };
  };

  // Standalone server support removed — no-op placeholders kept for compatibility
  const stopStandaloneServer = async () => { /* removed */ };

  const nodeUrl = await import('url');

  /**
   * Read a published Qtiler profile from disk.
   */
  const readPublishedProfile = async (profileId) => {
    const safeName = sanitizeFileToken(profileId);
    if (!safeName) return null;
    const filePath = path.join(publishedRoot, `${safeName}.json`);
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      return JSON.parse(raw || '{}');
    } catch {
      return null;
    }
  };

  /**
   * Extract `qtiler_profile` from the Referer header.
   * QWC2 loads config.json / themes.json via relative fetch, so the browser
   * sends the page URL (which contains the query param) as the Referer.
   */
  const profileFromReferer = (req) => {
    const ref = String(req.headers?.referer || '').trim();
    if (!ref) return null;
    try {
      const parsed = new nodeUrl.URL(ref, 'http://localhost');
      const val = parsed.searchParams.get('qtiler_profile');
      return val ? String(val).trim() : null;
    } catch {
      return null;
    }
  };

  /**
   * Read ALL published profiles from disk.
   */
  const readAllPublishedProfiles = async () => {
    const profiles = [];
    try {
      const files = await fs.promises.readdir(publishedRoot);
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try {
          const raw = await fs.promises.readFile(path.join(publishedRoot, f), 'utf8');
          const parsed = JSON.parse(raw || '{}');
          const profileKey = String(f).replace(/\.json$/i, '');
          if (parsed.projectId) profiles.push({ ...parsed, profileKey });
        } catch { /* skip malformed */ }
      }
    } catch { /* empty dir */ }
    return profiles;
  };

  const slugifyPortalToken = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const defaultPortalGdprSettings = () => ({
    enabled: false,
    companyName: 'Qtiler',
    privacyUrl: '',
    cookiePolicyUrl: '',
    contactUrl: '',
    bannerTitle: 'Privacy and cookies',
    bannerText: 'This portal uses essential storage for language and consent settings. Embedded maps and external media are only loaded after consent.',
    acceptLabel: 'Accept all',
    rejectLabel: 'Only necessary',
    manageLabel: 'Manage settings'
  });

  const defaultPortalPagesState = () => ({
    homePageSlug: '',
    gdpr: defaultPortalGdprSettings(),
    site: { title: '', subtitle: '', headerLogoUrl: '', galleryTitle: '', gallerySubtitle: '', galleryHeaderLogoUrl: '', headerHeight: '', headerFont: '', headerColor1: '', headerColor2: '', headerTextColor: '', headerBackgroundUrl: '', footerText: '', footerLinkLabel: '', footerLink: '', footerBackgroundColor: '', footerTextColor: '', footerLinkColor: '' },
    pages: []
  });

  const normalizePortalGdprSettings = (value) => {
    const source = value && typeof value === 'object' ? value : {};
    const defaults = defaultPortalGdprSettings();
    return {
      enabled: source.enabled === true,
      companyName: String(source.companyName || defaults.companyName).trim() || defaults.companyName,
      privacyUrl: String(source.privacyUrl || '').trim(),
      cookiePolicyUrl: String(source.cookiePolicyUrl || '').trim(),
      contactUrl: String(source.contactUrl || '').trim(),
      bannerTitle: String(source.bannerTitle || defaults.bannerTitle).trim() || defaults.bannerTitle,
      bannerText: String(source.bannerText || defaults.bannerText).trim() || defaults.bannerText,
      acceptLabel: String(source.acceptLabel || defaults.acceptLabel).trim() || defaults.acceptLabel,
      rejectLabel: String(source.rejectLabel || defaults.rejectLabel).trim() || defaults.rejectLabel,
      manageLabel: String(source.manageLabel || defaults.manageLabel).trim() || defaults.manageLabel
    };
  };

  const normalizePortalAudience = (value, { allowInherit = false } = {}) => {
    const source = value && typeof value === 'object' ? value : {};
    let access = String(source.access || source.mode || '').trim().toLowerCase();
    if (allowInherit && access === 'inherit') access = 'inherit';
    else if (access === 'authenticated') access = 'authenticated';
    else if (access === 'restricted') access = 'restricted';
    else access = 'public';
    return {
      access,
      users: toArray(source.users),
      roles: toArray(source.roles)
    };
  };

  const normalizePortalCardItems = (value) => {
    if (!Array.isArray(value)) return [];
    return value.map((item, index) => {
      const source = item && typeof item === 'object' ? item : {};
      const title = String(source.title || '').trim();
      const text = String(source.text || source.body || '').trim();
      const url = String(source.url || '').trim();
      const label = String(source.label || source.ctaLabel || '').trim();
      const icon = String(source.icon || '').trim().toLowerCase();
      const meta = String(source.meta || source.date || '').trim();
      const imageUrl = String(source.imageUrl || source.image || '').trim();
      if (!title && !text && !url && !label && !meta && !imageUrl) return null;
      return {
        id: slugifyPortalToken(source.id || `${title || 'item'}-${index + 1}`) || `item_${index + 1}`,
        title,
        text,
        url,
        label,
        icon,
        meta,
        imageUrl
      };
    }).filter(Boolean);
  };

  const normalizePortalBlock = (value, index = 0) => {
    const source = value && typeof value === 'object' ? value : {};
    const type = String(source.type || 'text').trim().toLowerCase();
    const blockType = ['hero', 'text', 'maps', 'cards', 'social'].includes(type) ? type : 'text';
    const id = slugifyPortalToken(source.id || `${blockType}-${index + 1}`) || `${blockType}_${index + 1}`;
    const profileKeys = Array.isArray(source.profileKeys)
      ? source.profileKeys.map((item) => String(item || '').trim()).filter(Boolean)
      : String(source.profileKeys || '').split(',').map((item) => item.trim()).filter(Boolean);
    return {
      id,
      type: blockType,
      title: String(source.title || '').trim(),
      eyebrow: String(source.eyebrow || '').trim(),
      subtitle: String(source.subtitle || '').trim(),
      body: String(source.body || source.html || '').trim(),
      backgroundUrl: String(source.backgroundUrl || '').trim(),
      imageUrl: String(source.imageUrl || '').trim(),
      ctaLabel: String(source.ctaLabel || '').trim(),
      ctaUrl: String(source.ctaUrl || '').trim(),
      intro: String(source.intro || '').trim(),
      layout: String(source.layout || '').trim().toLowerCase() === 'featured' ? 'featured' : 'grid',
      displayMode: ['thumbnail', 'embed', 'open'].includes(String(source.displayMode || '').trim().toLowerCase())
        ? String(source.displayMode || '').trim().toLowerCase()
        : 'thumbnail',
      profileKeys,
      items: normalizePortalCardItems(source.items),
      visibility: normalizePortalAudience(source.visibility, { allowInherit: true })
    };
  };

  const readAuthCatalog = () => {
    if (!isAuthActive()) {
      return { users: [], roles: [] };
    }
    try {
      const db = getAuthDb(dataRoot);
      const rows = db.prepare('SELECT username, role FROM users WHERE status = ? ORDER BY username COLLATE NOCASE').all('active');
      const users = rows.map((row) => String(row?.username || '').trim()).filter(Boolean);
      const roles = Array.from(new Set(rows.map((row) => String(row?.role || '').trim()).filter(Boolean)));
      return { users, roles };
    } catch (err) {
      console.warn('[Qtiler2Origo] auth catalog unavailable:', err?.message || err);
      return { users: [], roles: [] };
    }
  };

  const normalizePortalPage = (value, index = 0) => {
    const source = value && typeof value === 'object' ? value : {};
    const title = String(source.title || '').trim() || `Page ${index + 1}`;
    const slug = slugifyPortalToken(source.slug || source.id || title);
    if (!slug) return null;
    const rawHeaderHeight = Number(source.headerHeight);
    return {
      id: slugifyPortalToken(source.id || slug) || slug,
      slug,
      title,
      navLabel: String(source.navLabel || title).trim() || title,
      summary: String(source.summary || '').trim(),
      showInNav: source.showInNav !== false,
      showHeader: source.showHeader !== false,
      headerHeight: Number.isFinite(rawHeaderHeight) ? Math.max(0, Math.min(320, Math.round(rawHeaderHeight))) : 120,
      headerLogoUrl: String(source.headerLogoUrl || '').trim(),
      visibility: normalizePortalAudience(source.visibility),
      blocks: (Array.isArray(source.blocks) ? source.blocks : []).map((block, blockIndex) => normalizePortalBlock(block, blockIndex)).filter(Boolean)
    };
  };

  const normalizePortalPagesState = (value) => {
    const source = value && typeof value === 'object' ? value : {};
    const pages = (Array.isArray(source.pages) ? source.pages : []).map((page, index) => normalizePortalPage(page, index)).filter(Boolean);
    const seenSlugs = new Set();
    const dedupedPages = [];
    for (const page of pages) {
      if (seenSlugs.has(page.slug)) continue;
      seenSlugs.add(page.slug);
      dedupedPages.push(page);
    }
    const homePageSlug = slugifyPortalToken(source.homePageSlug || '');
    return {
      homePageSlug: dedupedPages.some((page) => page.slug === homePageSlug) ? homePageSlug : (dedupedPages[0]?.slug || ''),
      gdpr: normalizePortalGdprSettings(source.gdpr),
      site: (source.site && typeof source.site === 'object') ? {
        title: String(source.site.title || '').trim(),
        subtitle: String(source.site.subtitle || '').trim(),
        headerLogoUrl: String(source.site.headerLogoUrl || '').trim(),
        galleryTitle: String(source.site.galleryTitle || '').trim(),
        gallerySubtitle: String(source.site.gallerySubtitle || '').trim(),
        galleryHeaderLogoUrl: String(source.site.galleryHeaderLogoUrl || '').trim(),
        headerHeight: String(source.site.headerHeight || '').trim(),
        headerFont: String(source.site.headerFont || '').trim(),
        headerColor1: String(source.site.headerColor1 || '').trim(),
        headerColor2: String(source.site.headerColor2 || '').trim(),
        headerTextColor: String(source.site.headerTextColor || '').trim(),
        headerBackgroundUrl: String(source.site.headerBackgroundUrl || '').trim(),
        footerText: String(source.site.footerText || '').trim(),
        footerLinkLabel: String(source.site.footerLinkLabel || '').trim(),
        footerLink: String(source.site.footerLink || '').trim(),
        footerBackgroundColor: String(source.site.footerBackgroundColor || '').trim(),
        footerTextColor: String(source.site.footerTextColor || '').trim(),
        footerLinkColor: String(source.site.footerLinkColor || '').trim()
      } : { title: '', subtitle: '', headerLogoUrl: '', galleryTitle: '', gallerySubtitle: '', galleryHeaderLogoUrl: '', headerHeight: '', headerFont: '', headerColor1: '', headerColor2: '', headerTextColor: '', headerBackgroundUrl: '', footerText: '', footerLinkLabel: '', footerLink: '', footerBackgroundColor: '', footerTextColor: '', footerLinkColor: '' },
      pages: dedupedPages
    };
  };

  const readPortalPagesState = async () => {
    try {
      const raw = await fs.promises.readFile(portalPagesPath, 'utf8');
      return normalizePortalPagesState(JSON.parse(raw || '{}'));
    } catch {
      return defaultPortalPagesState();
    }
  };

  const writePortalPagesState = async (value) => {
    const normalized = normalizePortalPagesState(value);
    await fs.promises.mkdir(runtimeRoot, { recursive: true });
    await fs.promises.writeFile(portalPagesPath, JSON.stringify(normalized, null, 2), 'utf8');
    return normalized;
  };

  const userMatchesPortalAudience = (audience, user) => {
    if (!isAuthActive()) return true;
    const scope = normalizePortalAudience(audience);
    if (user?.role === 'admin') return true;
    if (scope.access === 'public') return true;
    if (scope.access === 'authenticated') return !!user;
    if (!user) return false;
    const userId = String(user?.id || user?.username || '').trim();
    const userRole = String(user?.role || '').trim();
    return scope.users.includes(userId) || scope.roles.includes(userRole);
  };

  const filterPortalBlocksByAudience = (blocks, user) => (Array.isArray(blocks) ? blocks : [])
    .filter((block) => {
      const scope = normalizePortalAudience(block?.visibility, { allowInherit: true });
      if (scope.access === 'inherit') return true;
      return userMatchesPortalAudience(scope, user);
    });

  const buildPortalPageUrl = (slug) => `/Qtiler2Origo/portal/${encodeURIComponent(String(slug || '').trim())}`;

  /**
   * Filter profiles based on QtilerAuth permissions
   */
  const collectProfileProjectIds = (profile) => {
    const ids = new Set();
    const add = (value) => {
      const projectId = normalizeProjectId(value || '');
      if (projectId) ids.add(projectId);
    };

    add(profile?.projectId);
    for (const layer of (Array.isArray(profile?.layers) ? profile.layers : [])) {
      add(layer?.sourceProjectId);
    }
    for (const bg of (Array.isArray(profile?.backgrounds) ? profile.backgrounds : [])) {
      add(bg?.sourceProjectId || profile?.backgroundProjectId);
    }

    return [...ids];
  };

  const filterProfilesByAccess = (profiles, user) => {
    const list = Array.isArray(profiles) ? profiles : [];
    if (!isAuthActive()) return list;
    const snapshot = readAccessSnapshot(dataRoot);
    return list.filter((profile) => {
      const projectIds = collectProfileProjectIds(profile);
      if (!projectIds.length) return false;
      return projectIds.every((projectId) => userCanAccessProject(snapshot, user || null, projectId));
    });
  };

  const userCanAccessProfile = (profile, user) => {
    if (!isAuthActive()) return true;
    const projectIds = collectProfileProjectIds(profile);
    if (!projectIds.length) return false;
    const snapshot = readAccessSnapshot(dataRoot);
    return projectIds.every((projectId) => userCanAccessProject(snapshot, user || null, projectId));
  };

  const profileRequiresAuthentication = (profile) => {
    if (!isAuthActive()) return false;
    const projectIds = collectProfileProjectIds(profile);
    if (!projectIds.length) return false;
    const snapshot = readAccessSnapshot(dataRoot);
    return projectIds.some((projectId) => !userCanAccessProject(snapshot, null, projectId));
  };

  const sameProfileToken = (left, right) => {
    const a = String(left || '').trim().toLowerCase();
    const b = String(right || '').trim().toLowerCase();
    return !!a && !!b && a === b;
  };

  const findProfileMatch = (profiles, profileToken) => {
    if (!Array.isArray(profiles) || !profileToken) return null;
    return profiles.find((p) => sameProfileToken(p?.profileKey, profileToken) || sameProfileToken(p?.projectId, profileToken)) || null;
  };

  const collectRequiredCrsForProfiles = async (profiles) => {
    const requiredCrs = new Set();
    const sourceProjectIds = new Set();

    for (const profile of (Array.isArray(profiles) ? profiles : [])) {
      for (const projectId of collectProfileProjectIds(profile)) sourceProjectIds.add(projectId);
    }

    for (const projectId of sourceProjectIds) {
      const ext = await getProjectExtent(projectId);
      if (ext?.crs) requiredCrs.add(ext.crs);
      const ci = await readCacheIndex(projectId);
      for (const layer of (ci?.layers || [])) {
        if (layer?.project_crs) requiredCrs.add(layer.project_crs);
        if (layer?.layer_crs) requiredCrs.add(layer.layer_crs);
      }
    }

    return [...requiredCrs];
  };

  const filterProfilesByToken = (profiles, profileToken) => {
    if (!Array.isArray(profiles) || !profileToken) return profiles;
    return profiles.filter((p) => sameProfileToken(p?.profileKey, profileToken) || sameProfileToken(p?.projectId, profileToken));
  };

  /**
   * Read cache/index.json for a project to get real extent.
   */
  const readCacheIndex = async (projectId) => {
    const safeName = sanitizeFileToken(projectId);
    if (!safeName) return null;
    const indexPath = resolveRepoPath('cache', safeName, 'index.json');
    for (const candidate of [indexPath, `${indexPath}.bak`]) {
      try {
        const raw = await fs.promises.readFile(candidate, 'utf8');
        return JSON.parse(raw || '{}');
      } catch {
        // try backup below
      }
    }
    return null;
  };

  const validatePublishLayerReferences = async ({
    projectId,
    layerEntries,
    backgroundSelection,
    rawBackgrounds,
    defaultBackgroundKey,
    layerRulesInput,
    features,
    extent,
    center,
    zoom,
    minZoom,
    maxZoom,
    knownProjectIds
  }) => {
    const issues = [];
    const cacheByProject = new Map();
    const getCacheIndex = async (projectIdValue) => {
      const pid = normalizeProjectId(projectIdValue || '');
      if (!pid) return null;
      if (!cacheByProject.has(pid)) {
        const idx = await readCacheIndex(pid);
        cacheByProject.set(pid, idx && typeof idx === 'object' ? idx : null);
      }
      return cacheByProject.get(pid) || null;
    };
    const getCachedLayers = async (projectIdValue) => {
      const idx = await getCacheIndex(projectIdValue);
      return Array.isArray(idx?.layers) ? idx.layers : [];
    };
    const normalizeComparable = (value) => String(value || '').trim();
    const layerCandidates = (entry) => {
      const values = [entry?.name, entry?.id, entry?.layer, entry?.title, entry?.theme, entry?.layer_id]
        .map(normalizeComparable)
        .filter(Boolean);
      if (entry?.theme) values.push(`theme:${normalizeComparable(entry.theme)}`);
      return Array.from(new Set(values));
    };
    const sameLayerToken = (a, b) => {
      const left = normalizeComparable(a);
      const right = normalizeComparable(b);
      if (!left || !right) return false;
      return left === right || safeLayerNameForWfs(left) === safeLayerNameForWfs(right);
    };
    const findLayer = (cachedLayers, layerName, { theme = false } = {}) => {
      const name = normalizeComparable(layerName);
      if (!name) return null;
      const themeName = name.startsWith('theme:') ? name.slice('theme:'.length) : name;
      return cachedLayers.find((entry) => {
        const isTheme = entry?.kind === 'theme' || !!entry?.theme;
        if (theme && !isTheme) return false;
        if (!theme && isTheme) return false;
        const candidates = layerCandidates(entry);
        return candidates.some((candidate) => sameLayerToken(candidate, name) || (theme && sameLayerToken(candidate, themeName)));
      }) || null;
    };
    const collectFieldNames = (layer) => {
      const fields = new Set();
      const add = (value) => {
        const name = normalizeComparable(value);
        if (name) fields.add(name);
      };
      for (const key of ['fields', 'attributes', 'columns', 'properties']) {
        const list = layer?.[key];
        if (!Array.isArray(list)) continue;
        for (const item of list) {
          if (typeof item === 'string') add(item);
          else if (item && typeof item === 'object') add(item.name || item.attribute || item.key || item.id);
        }
      }
      return fields;
    };
    const addIssue = (code, message, extra = {}) => {
      issues.push({ code, message, ...extra });
    };
    const checkProjectIndex = async (pid, role) => {
      if (!pid) return null;
      if (!knownProjectIds.has(pid)) {
        addIssue('project_not_found', `${role} references missing project "${pid}".`, { projectId: pid });
        return null;
      }
      const idx = await getCacheIndex(pid);
      if (!idx) {
        addIssue('project_index_missing', `Project "${pid}" has no cache/index.json. Regenerate or sync the project before publishing.`, { projectId: pid });
        return null;
      }
      const cachedLayers = Array.isArray(idx.layers) ? idx.layers : [];
      if (!cachedLayers.length) {
        addIssue('project_layers_unavailable', `Project "${pid}" has no cached layers. Regenerate or sync the project before publishing.`, { projectId: pid });
      }
      const projectFile = normalizeComparable(idx.project);
      if (projectFile) {
        try { await fs.promises.access(projectFile); }
        catch { addIssue('project_file_missing', `Project "${pid}" points to a missing QGIS file: ${projectFile}.`, { projectId: pid }); }
      }
      return idx;
    };
    const checkLayer = async ({ projectId: layerProjectId, layerName, role, theme = false, requireTileGrid = false }) => {
      const pid = normalizeProjectId(layerProjectId || '');
      const name = normalizeComparable(layerName);
      if (!pid || !name) {
        addIssue('layer_reference_incomplete', `${role} layer reference is incomplete. Select a project and layer again.`, { projectId: pid, layerName: name });
        return null;
      }
      await checkProjectIndex(pid, role);
      const cachedLayers = await getCachedLayers(pid);
      if (!cachedLayers.length) return null;
      const cachedLayer = findLayer(cachedLayers, name, { theme });
      if (!cachedLayer) {
        addIssue(theme ? 'theme_not_found' : 'layer_not_found', `${role} layer "${name}" was not found in project "${pid}".`, { projectId: pid, layerName: name });
        return null;
      }
      if (requireTileGrid) {
        const matrices = cachedLayer?.tile_matrix_set?.matrices;
        if (!cachedLayer.tile_matrix_preset && !(Array.isArray(matrices) && matrices.length)) {
          addIssue('background_tilegrid_missing', `Background "${name}" in project "${pid}" has no WMTS tile grid. Regenerate its cache before publishing.`, { projectId: pid, layerName: name });
        }
      }
      return cachedLayer;
    };
    const checkNumberArray = (value, expectedLength, code, label) => {
      if (typeof value === 'undefined' || value === null) return;
      if (!Array.isArray(value) || value.length < expectedLength || value.slice(0, expectedLength).some((n) => !Number.isFinite(Number(n)))) {
        addIssue(code, `${label} is invalid. Clear it and capture the map view again.`);
      }
    };

    const mainProjectId = normalizeProjectId(projectId || '');
    await checkProjectIndex(mainProjectId, 'Main map');
    const layerRuleFor = (entry) => {
      const name = normalizeComparable(entry?.name);
      const pid = normalizeProjectId(entry?.sourceProjectId || mainProjectId) || mainProjectId;
      const keyed = layerRulesInput?.[`${pid}::${name}`];
      return keyed && typeof keyed === 'object' ? keyed : ((layerRulesInput?.[name] && typeof layerRulesInput[name] === 'object') ? layerRulesInput[name] : {});
    };

    for (const entry of Array.isArray(layerEntries) ? layerEntries : []) {
      const name = normalizeComparable(entry?.name);
      const themeName = normalizeComparable(entry?.themeName || (name.startsWith('theme:') ? name.slice('theme:'.length) : ''));
      const isTheme = entry?.isTheme === true || !!themeName;
      const cachedLayer = await checkLayer({ projectId: entry?.sourceProjectId || mainProjectId, layerName: isTheme ? (themeName || name) : name, role: 'Map', theme: isTheme });
      if (!cachedLayer || isTheme) continue;
      const rule = layerRuleFor(entry);
      // Only require a vector layer when the layer will actually be served as
      // WFS (explicit serveAsWfs/editable). A saved wfsStyle alone does not
      // force the WFS path — it may just be legend styling for a WMS layer.
      const wantsWfs = rule?.editable === true || rule?.serveAsWfs === true;
      if (wantsWfs && cachedLayer.type !== 'vector' && !cachedLayer.geometry_type) {
        addIssue('wfs_requires_vector_layer', `Layer "${name}" is configured as WFS/editable but is not a vector layer in the cache index.`, { projectId: entry?.sourceProjectId || mainProjectId, layerName: name });
      }
      const fields = collectFieldNames(cachedLayer);
      if (fields.size) {
        for (const attrName of ['searchAttribute', 'idAttribute', 'geometryAttribute']) {
          const attr = normalizeComparable(rule?.[attrName] || entry?.[attrName]);
          if (attr && !fields.has(attr)) {
            addIssue('layer_attribute_not_found', `Layer "${name}" uses ${attrName} "${attr}", but that field was not found in the cached layer metadata.`, { projectId: entry?.sourceProjectId || mainProjectId, layerName: name, attribute: attr });
          }
        }
      }
    }

    const normalizedBackgroundKeys = new Set((Array.isArray(backgroundSelection?.backgrounds) ? backgroundSelection.backgrounds : []).map((bg) => normalizeComparable(bg?.key)).filter(Boolean));
    const requestedDefaultKey = normalizeComparable(defaultBackgroundKey);
    if (requestedDefaultKey && !normalizedBackgroundKeys.has(requestedDefaultKey)) {
      addIssue('default_background_not_found', `Default background "${requestedDefaultKey}" is not available anymore. Choose a background again.`, { defaultBackgroundKey: requestedDefaultKey });
    }
    for (const rawBg of Array.isArray(rawBackgrounds) ? rawBackgrounds : []) {
      if (toBackgroundType(rawBg?.type) !== 'layer') continue;
      const pid = normalizeProjectId(rawBg?.sourceProjectId || rawBg?.projectId || '');
      const name = normalizeComparable(rawBg?.name || rawBg?.layer || '');
      if (!pid || !name) addIssue('background_reference_incomplete', `Background "${normalizeComparable(rawBg?.title || rawBg?.key || 'layer')}" is missing project or layer information.`);
      else if (!knownProjectIds.has(pid)) addIssue('background_project_not_found', `Background "${name}" references missing project "${pid}".`, { projectId: pid, layerName: name });
    }
    for (const bg of Array.isArray(backgroundSelection?.backgrounds) ? backgroundSelection.backgrounds : []) {
      if (bg?.type !== 'layer') continue;
      const bgName = normalizeComparable(bg.name || bg.layer);
      const bgProjectId = normalizeProjectId(bg.sourceProjectId || bg.projectId);
      const bgCachedLayers = await getCachedLayers(bgProjectId);
      const isTheme = bgName.startsWith('theme:') || !!findLayer(bgCachedLayers, bgName, { theme: true });
      const bgLayerName = bgName.startsWith('theme:') ? bgName.slice('theme:'.length) : bgName;
      await checkLayer({ projectId: bg.sourceProjectId || bg.projectId, layerName: bgLayerName, role: 'Background', theme: isTheme, requireTileGrid: true });
    }

    for (const src of Array.isArray(features?.searchSources) ? features.searchSources : []) {
      const pid = normalizeProjectId(src?.projectId || '');
      if (!pid) continue;
      await checkProjectIndex(pid, 'Search source');
      for (const layerName of Array.isArray(src?.layers) ? src.layers : []) {
        await checkLayer({ projectId: pid, layerName, role: 'Search source' });
      }
    }

    checkNumberArray(extent, 4, 'extent_invalid', 'Map extent');
    if (Array.isArray(extent) && extent.length >= 4 && extent.slice(0, 4).every((n) => Number.isFinite(Number(n)))) {
      const [minX, minY, maxX, maxY] = extent.map(Number);
      if (minX >= maxX || minY >= maxY) addIssue('extent_invalid_bounds', 'Map extent has invalid bounds. Clear it and capture the map view again.');
    }
    checkNumberArray(center, 2, 'center_invalid', 'Map center');
    const minZ = Number(minZoom);
    const maxZ = Number(maxZoom);
    const currentZoom = Number(zoom);
    if (typeof minZoom !== 'undefined' && minZoom !== null && minZoom !== '' && (!Number.isFinite(minZ) || minZ < 0)) addIssue('min_zoom_invalid', 'Minimum zoom is invalid.');
    if (typeof maxZoom !== 'undefined' && maxZoom !== null && maxZoom !== '' && (!Number.isFinite(maxZ) || maxZ < 0)) addIssue('max_zoom_invalid', 'Maximum zoom is invalid.');
    if (Number.isFinite(minZ) && Number.isFinite(maxZ) && minZ > maxZ) addIssue('zoom_range_invalid', 'Minimum zoom cannot be greater than maximum zoom.');
    if (typeof zoom !== 'undefined' && zoom !== null && zoom !== '' && !Number.isFinite(currentZoom)) addIssue('zoom_invalid', 'Map zoom is invalid.');

    return issues;
  };

  /**
   * Read project-level layer flags (e.g. wfsEditable/wfsSearchable)
   * from cache/<project>/project-config.json.
   */
  const readProjectLayerFlags = async (projectId) => {
    const safeName = sanitizeFileToken(projectId);
    if (!safeName) return {};
    const cfgPath = resolveRepoPath('cache', safeName, 'project-config.json');
    try {
      const raw = await fs.promises.readFile(cfgPath, 'utf8');
      const parsed = JSON.parse(raw || '{}');
      const layers = parsed?.layers && typeof parsed.layers === 'object' ? parsed.layers : {};
      return layers;
    } catch {
      return {};
    }
  };

  const resolveLayerFlagEntry = (flags, layerName) => {
    const name = String(layerName || '').trim();
    if (!name || !flags || typeof flags !== 'object') return null;
    const direct = flags[name] && typeof flags[name] === 'object' ? flags[name] : null;
    if (direct) return direct;
    const safeName = safeLayerNameForWfs(name);
    for (const [key, value] of Object.entries(flags || {})) {
      if (safeLayerNameForWfs(key) === safeName && value && typeof value === 'object') return value;
    }
    return null;
  };

  /**
   * Compute the project extent and CRS from cache index data.
   * Returns { wgs84, native, crs } or null.
   */
  const getProjectExtent = async (projectId) => {
    const cacheIndex = await readCacheIndex(projectId);
    if (!cacheIndex?.layers?.length) return null;
    const first = cacheIndex.layers[0];
    const wgs84 = first.project_extent_wgs84 || first.extent_wgs84 || null;
    let native = first.project_extent || first.extent || null;
    // extent may be stored as a space-separated string rather than an array
    if (typeof native === 'string') {
      const parts = native.trim().split(/\s+/).map(Number);
      native = parts.length === 4 && parts.every((n) => !isNaN(n)) ? parts : null;
    }
    const crs = first.project_crs || first.crs || first.tile_crs || 'EPSG:3857';
    if (!native || !Array.isArray(native) || native.length < 4) return null;
    return { wgs84: wgs84 || null, native, crs };
  };

  /**
   * Generate or return a cached WMS thumbnail for a project + layers combo.
   * Saves to data/Qtiler2Origo/thumbs/<projectId>_<hash>.jpg.
   */
  const thumbPendingRequests = new Map(); // key -> Promise (in-flight requests)
  const normalizeThumbnailBackground = (input) => {
    const source = input && typeof input === 'object' ? input : {};
    const type = toBackgroundType(source.type);
    if (type === 'layer') {
      const sourceProjectId = normalizeProjectId(source.sourceProjectId || source.projectId || '');
      const name = String(source.name || source.layer || '').trim();
      if (!sourceProjectId || !name) return null;
      return { type, sourceProjectId, name };
    }
    if (type === 'osm') return { type };
    if (type === 'none') return { type };
    return null;
  };
  const buildThumbnailCacheEntry = (projectId, layers, background) => {
    const safePid = sanitizeFileToken(projectId);
    if (!safePid) return null;
    const layerKey = String(layers || '').trim();
    const bg = normalizeThumbnailBackground(background);
    const bgKey = bg?.type === 'layer'
      ? `|bg:${bg.sourceProjectId}:${bg.name}`
      : bg?.type === 'osm'
        ? '|bg:osm'
        : '';
    const hash = sanitizeFileToken(`${layerKey}${bgKey}|s500k`.replace(/,/g, '_')) || '_all';
    return {
      safePid,
      hash,
      thumbPath: path.join(thumbCacheDir, `${safePid}_${hash}.jpg`),
      dedupKey: `${safePid}|${hash}`,
      background: bg
    };
  };
  const fetchImageBuffer = (imageUrl, auth = {}) => new Promise((resolve) => {
    try {
      const parsedUrl = new URL(imageUrl);
      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: {}
      };
      if (auth.cookieHeader) reqOptions.headers.cookie = auth.cookieHeader;
      if (auth.apiKey) reqOptions.headers['x-api-key'] = auth.apiKey;
      if (auth.authorization) reqOptions.headers.authorization = auth.authorization;
      const fetcher = imageUrl.startsWith('https') ? https : http;
      const proxyReq = fetcher.get(reqOptions, (proxyRes) => {
        try {
          const contentType = String(proxyRes.headers['content-type'] || '');
          if (!contentType.startsWith('image/')) {
            proxyRes.resume();
            return resolve(null);
          }
          const chunks = [];
          proxyRes.on('data', (chunk) => chunks.push(chunk));
          proxyRes.on('end', () => resolve(Buffer.concat(chunks)));
          proxyRes.on('error', () => resolve(null));
        } catch {
          resolve(null);
        }
      });
      proxyReq.setTimeout(120_000, () => {
        try { proxyReq.destroy(new Error('thumbnail request timed out')); } catch (_) {}
      });
      proxyReq.on('error', () => resolve(null));
    } catch {
      resolve(null);
    }
  });
  const buildOsmThumbnailBuffer = async (bboxWgs84, width, height) => {
    const clampLat = (lat) => Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
    const clampLon = (lon) => Math.max(-180, Math.min(180, Number(lon)));
    const mercY = (lat) => {
      const rad = clampLat(lat) * Math.PI / 180;
      return (1 - Math.log(Math.tan(rad) + (1 / Math.cos(rad))) / Math.PI) / 2;
    };
    const worldX = (lon, zoom) => ((clampLon(lon) + 180) / 360) * (256 * 2 ** zoom);
    const worldY = (lat, zoom) => mercY(lat) * (256 * 2 ** zoom);

    if (!Array.isArray(bboxWgs84) || bboxWgs84.length < 4) return null;
    const minLon = clampLon(bboxWgs84[0]);
    const minLat = clampLat(bboxWgs84[1]);
    const maxLon = clampLon(bboxWgs84[2]);
    const maxLat = clampLat(bboxWgs84[3]);
    if (!(maxLon > minLon) || !(maxLat > minLat)) return null;

    const lonSpan = Math.max(0.000001, maxLon - minLon);
    const latSpanNorm = Math.max(0.000001, Math.abs(mercY(maxLat) - mercY(minLat)));
    const zoomX = Math.log2((width * 360) / (256 * lonSpan));
    const zoomY = Math.log2(height / (256 * latSpanNorm));
    const zoom = Math.max(0, Math.min(19, Math.floor(Math.min(zoomX, zoomY))));

    const left = worldX(minLon, zoom);
    const right = worldX(maxLon, zoom);
    const top = worldY(maxLat, zoom);
    const bottom = worldY(minLat, zoom);
    const tileMinX = Math.floor(left / 256);
    const tileMaxX = Math.floor((right - 1) / 256);
    const tileMinY = Math.floor(top / 256);
    const tileMaxY = Math.floor((bottom - 1) / 256);
    const tileCount = (tileMaxX - tileMinX + 1) * (tileMaxY - tileMinY + 1);
    if (!Number.isFinite(tileCount) || tileCount < 1 || tileCount > 64) return null;

    const worldTiles = 2 ** zoom;
    const composites = [];
    for (let tileY = tileMinY; tileY <= tileMaxY; tileY += 1) {
      if (tileY < 0 || tileY >= worldTiles) continue;
      for (let tileX = tileMinX; tileX <= tileMaxX; tileX += 1) {
        const wrappedX = ((tileX % worldTiles) + worldTiles) % worldTiles;
        const tileUrl = `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`;
        const tileBuffer = await fetchImageBuffer(tileUrl, null);
        if (!tileBuffer) continue;
        composites.push({
          input: tileBuffer,
          left: (tileX - tileMinX) * 256,
          top: (tileY - tileMinY) * 256
        });
      }
    }
    if (!composites.length) return null;

    const canvasWidth = (tileMaxX - tileMinX + 1) * 256;
    const canvasHeight = (tileMaxY - tileMinY + 1) * 256;
    const cropLeft = Math.max(0, Math.floor(left - tileMinX * 256));
    const cropTop = Math.max(0, Math.floor(top - tileMinY * 256));
    const cropWidth = Math.max(1, Math.ceil(right - left));
    const cropHeight = Math.max(1, Math.ceil(bottom - top));

    return sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 3,
        background: '#f8fafc'
      }
    })
      .composite(composites)
      .extract({ left: cropLeft, top: cropTop, width: Math.min(cropWidth, canvasWidth - cropLeft), height: Math.min(cropHeight, canvasHeight - cropTop) })
      .resize(width, height, { fit: 'fill' })
      .jpeg({ quality: 82 })
      .toBuffer();
  };
  const generateThumbnail = async (projectId, layers, baseUrl, cookieHeader, options = {}) => {
    const cacheEntry = buildThumbnailCacheEntry(projectId, layers, options.background);
    if (!cacheEntry) return null;
    const { thumbPath, dedupKey, background } = cacheEntry;
    const authContext = {
      cookieHeader,
      apiKey: String(options.apiKey || '').trim(),
      authorization: String(options.authorization || '').trim()
    };
    try {
      const stat = await fs.promises.stat(thumbPath);
      if (stat.isFile() && stat.size > 0) {
        return thumbPath;
      }
    } catch { /* not cached yet */ }

    // Dedup concurrent requests for the same thumbnail.
    if (thumbPendingRequests.has(dedupKey)) {
      return thumbPendingRequests.get(dedupKey);
    }

    const parseExtentArray = (value) => {
      if (Array.isArray(value) && value.length >= 4) {
        const nums = value.slice(0, 4).map(Number);
        return nums.every(Number.isFinite) ? nums : null;
      }
      if (typeof value === 'string') {
        const parts = value.trim().split(/[\s,]+/).map(Number);
        return parts.length >= 4 && parts.slice(0, 4).every(Number.isFinite) ? parts.slice(0, 4) : null;
      }
      return null;
    };
    const padExtent = (bbox) => {
      if (!Array.isArray(bbox) || bbox.length < 4) return bbox;
      const [minx, miny, maxx, maxy] = bbox.map(Number);
      const width = Math.max(1, maxx - minx);
      const height = Math.max(1, maxy - miny);
      const padX = width * 0.12;
      const padY = height * 0.12;
      return [minx - padX, miny - padY, maxx + padX, maxy + padY];
    };
    // Nationwide WMS thumbs look empty at full extent. Crop around the
    // centroid to ~1:500000 (280x160 @ 96 dpi) so legend icons show detail.
    const cropExtentToDetailScale = (extentBbox, crsCode) => {
      if (!Array.isArray(extentBbox) || extentBbox.length < 4) return extentBbox;
      const [minx, miny, maxx, maxy] = extentBbox.map(Number);
      if (![minx, miny, maxx, maxy].every(Number.isFinite) || !(maxx > minx) || !(maxy > miny)) return extentBbox;
      const thumbW = 280;
      const thumbH = 160;
      const metersPerPx = (500000 * 0.0254) / 96;
      let halfW = (thumbW * metersPerPx) / 2;
      let halfH = (thumbH * metersPerPx) / 2;
      const crs = String(crsCode || '').trim().toUpperCase();
      if (crs === 'EPSG:4326' || crs === 'EPSG:4258' || crs === 'CRS:84') {
        const lat = (miny + maxy) / 2;
        const mPerDegLat = 111320;
        const mPerDegLon = Math.max(1e-6, 111320 * Math.cos((lat * Math.PI) / 180));
        halfW /= mPerDegLon;
        halfH /= mPerDegLat;
      }
      const layerW = maxx - minx;
      const layerH = maxy - miny;
      if (layerW <= halfW * 2 && layerH <= halfH * 2) return extentBbox;
      const cx = (minx + maxx) / 2;
      const cy = (miny + maxy) / 2;
      return [cx - halfW, cy - halfH, cx + halfW, cy + halfH];
    };
    let bbox = null;
    let bboxWgs84 = null;
    let crs = null;
    const requestedLayers = String(layers || '').split(',').map((v) => String(v || '').trim()).filter(Boolean);
    if (requestedLayers.length === 1) {
      try {
        const cacheIndex = await readCacheIndex(projectId);
        const cachedLayers = Array.isArray(cacheIndex?.layers) ? cacheIndex.layers : [];
        const layerName = requestedLayers[0];
        const cached = cachedLayers.find((entry) => {
          const cand = String(entry?.name || entry?.layer || entry?.title || '').trim();
          return cand && (cand === layerName || safeLayerNameForWfs(cand) === safeLayerNameForWfs(layerName));
        });
        const layerExtent = parseExtentArray(cached?.extent || cached?.project_extent);
        const layerExtentWgs84 = parseExtentArray(cached?.extent_wgs84 || cached?.project_extent_wgs84);
        if (layerExtent) {
          bbox = padExtent(layerExtent);
          crs = String(cached?.layer_crs || cached?.crs || cached?.project_crs || '').trim() || null;
        }
        if (layerExtentWgs84) bboxWgs84 = padExtent(layerExtentWgs84);
      } catch {
        bbox = null;
      }
    }
    if (!bbox) {
      const extent = await getProjectExtent(projectId);
      bbox = extent?.native || [-20037508, -20037508, 20037508, 20037508];
      bboxWgs84 = parseExtentArray(extent?.wgs84) || bboxWgs84;
      crs = extent?.crs || 'EPSG:3857';
    }
    if (!crs) crs = 'EPSG:3857';
    if (requestedLayers.length === 1) {
      bbox = cropExtentToDetailScale(bbox, crs);
      if (bboxWgs84) bboxWgs84 = cropExtentToDetailScale(bboxWgs84, 'EPSG:4326');
    }
    const promise = new Promise((resolve) => {
      (async () => {
        try {
          const buildWmsUrl = ({ targetProjectId, targetLayers, format, transparent }) => {
            const wmsParams = new URLSearchParams({
              SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0',
              LAYERS: targetLayers, STYLES: '', CRS: crs,
              BBOX: bbox.join(','), WIDTH: '280', HEIGHT: '160',
              FORMAT: format, TRANSPARENT: transparent ? 'true' : 'false', project: targetProjectId
            });
            return `${baseUrl}/wms?${wmsParams.toString()}`;
          };

          let backgroundBuffer = null;
          if (background?.type === 'layer' && background?.sourceProjectId && background?.name) {
            const bgUrl = buildWmsUrl({
              targetProjectId: background.sourceProjectId,
              targetLayers: background.name,
              format: 'image/png',
              transparent: false
            });
            backgroundBuffer = await fetchImageBuffer(bgUrl, authContext);
          } else if (background?.type === 'osm' && bboxWgs84) {
            backgroundBuffer = await buildOsmThumbnailBuffer(bboxWgs84, 280, 160);
          }

          const overlayUrl = buildWmsUrl({
            targetProjectId: projectId,
            targetLayers: layers,
            format: backgroundBuffer ? 'image/png' : 'image/jpeg',
            transparent: !!backgroundBuffer
          });
          const overlayBuffer = await fetchImageBuffer(overlayUrl, authContext);
          if (!overlayBuffer) return resolve(null);

          await fs.promises.mkdir(thumbCacheDir, { recursive: true });
          if (backgroundBuffer) {
            const composed = await sharp(backgroundBuffer)
              .resize(280, 160, { fit: 'fill' })
              .composite([{ input: overlayBuffer }])
              .jpeg({ quality: 82 })
              .toBuffer();
            await fs.promises.writeFile(thumbPath, composed);
            return resolve(thumbPath);
          }

          await fs.promises.writeFile(thumbPath, overlayBuffer);
          return resolve(thumbPath);
        } catch {
          try { await fs.promises.unlink(thumbPath).catch(() => {}); } catch (_) {}
          resolve(null);
        }
      })();
    }).finally(() => { thumbPendingRequests.delete(dedupKey); });

    thumbPendingRequests.set(dedupKey, promise);
    return promise;
  };

  const sendThumbnailPlaceholder = (res, label = 'No preview') => {
    const safeLabel = String(label || 'No preview').replace(/[<>&"]/g, '').slice(0, 64);
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="280" height="160" viewBox="0 0 280 160" role="img" aria-label="${safeLabel}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#dbeafe"/>
      <stop offset="100%" stop-color="#bfdbfe"/>
    </linearGradient>
  </defs>
  <rect width="280" height="160" fill="url(#g)"/>
  <g fill="none" stroke="#2563eb" stroke-width="2" opacity="0.35">
    <path d="M0 120 L60 90 L120 110 L180 70 L240 92 L280 80"/>
    <path d="M0 135 L55 120 L110 128 L165 112 L220 118 L280 108"/>
  </g>
  <g fill="#1e3a8a" opacity="0.9" font-family="Segoe UI, Arial, sans-serif" text-anchor="middle">
    <text x="140" y="78" font-size="16" font-weight="600">${safeLabel}</text>
    <text x="140" y="100" font-size="12" opacity="0.75">Thumbnail unavailable</text>
  </g>
</svg>`;
    res.set('Cache-Control', 'public, max-age=60');
    res.type('image/svg+xml');
    return res.status(200).send(svg);
  };

  /**
   * Build a QWC2-compatible config.json.
   * Keeps Portal plugin so users can see all published themes.
   */
  /* Map QWC2 plugin names to our feature keys */
  const FEATURE_PLUGIN_MAP = {
    search: ['Search', 'SearchBox'],
    editing: ['Editing', 'FeatureForm'],
    identify: ['Identify'],
    layerTree: ['LayerTree'],
    legend: ['Legend'],
    measurement: ['Measure'],
    print: ['Print'],
    share: ['Share'],
    redlining: ['Redlining', 'ScratchDrawing'],
    bookmark: ['Bookmark'],
    mapTip: ['MapTip'],
    heightProfile: ['HeightProfile'],
    dxfExport: ['DxfExport'],
    attributeTable: ['AttributeTable'],
    routing: ['Routing'],
    view3d: ['View3D']
  };

  // Well-known projection definitions for QWC2
  const KNOWN_PROJECTIONS = {
    'EPSG:3006': { code: 'EPSG:3006', proj: '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', label: 'SWEREF99 TM' },
    'EPSG:3007': { code: 'EPSG:3007', proj: '+proj=tmerc +lat_0=0 +lon_0=12 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', label: 'SWEREF99 12 00' },
    'EPSG:3008': { code: 'EPSG:3008', proj: '+proj=tmerc +lat_0=0 +lon_0=13.5 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', label: 'SWEREF99 13 30' },
    'EPSG:3009': { code: 'EPSG:3009', proj: '+proj=tmerc +lat_0=0 +lon_0=15 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', label: 'SWEREF99 15 00' },
    'EPSG:3010': { code: 'EPSG:3010', proj: '+proj=tmerc +lat_0=0 +lon_0=16.5 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', label: 'SWEREF99 16 30' },
    'EPSG:3011': { code: 'EPSG:3011', proj: '+proj=tmerc +lat_0=0 +lon_0=18 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', label: 'SWEREF99 18 00' },
    'EPSG:3012': { code: 'EPSG:3012', proj: '+proj=tmerc +lat_0=0 +lon_0=14.25 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', label: 'SWEREF99 14 15' },
    'EPSG:3013': { code: 'EPSG:3013', proj: '+proj=tmerc +lat_0=0 +lon_0=15.75 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', label: 'SWEREF99 15 45' },
    'EPSG:3014': { code: 'EPSG:3014', proj: '+proj=tmerc +lat_0=0 +lon_0=17.25 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', label: 'SWEREF99 17 15' },
    'EPSG:3015': { code: 'EPSG:3015', proj: '+proj=tmerc +lat_0=0 +lon_0=18.75 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', label: 'SWEREF99 18 45' },
    'EPSG:3016': { code: 'EPSG:3016', proj: '+proj=tmerc +lat_0=0 +lon_0=20.25 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', label: 'SWEREF99 20 15' },
    'EPSG:3017': { code: 'EPSG:3017', proj: '+proj=tmerc +lat_0=0 +lon_0=21.75 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', label: 'SWEREF99 21 45' },
    'EPSG:3018': { code: 'EPSG:3018', proj: '+proj=tmerc +lat_0=0 +lon_0=23.25 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', label: 'SWEREF99 23 15' },
    'EPSG:3857': { code: 'EPSG:3857', proj: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs', label: 'WGS 84 / Pseudo-Mercator' },
    'EPSG:4326': { code: 'EPSG:4326', proj: '+proj=longlat +datum=WGS84 +no_defs', label: 'WGS 84' },
    'EPSG:4258': { code: 'EPSG:4258', proj: '+proj=longlat +ellps=GRS80 +no_defs', label: 'ETRS89' },
    'EPSG:25832': { code: 'EPSG:25832', proj: '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', label: 'ETRS89 / UTM 32N' },
    'EPSG:25833': { code: 'EPSG:25833', proj: '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', label: 'ETRS89 / UTM 33N' },
    'EPSG:32632': { code: 'EPSG:32632', proj: '+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs', label: 'WGS 84 / UTM zone 32N' },
    'EPSG:32633': { code: 'EPSG:32633', proj: '+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs', label: 'WGS 84 / UTM zone 33N' }
  };

  const buildProj4Defs = (...codes) => {
    const defs = [];
    const seen = new Set();
    codes.forEach((code) => {
      const normalized = String(code || '').trim().toUpperCase();
      if (!normalized || seen.has(normalized)) return;
      const known = KNOWN_PROJECTIONS[normalized];
      if (!known?.proj) return;
      seen.add(normalized);
      defs.push({ code: normalized, projection: known.proj });
    });
    return defs;
  };

  const buildQwc2Config = async ({ hasMultipleThemes = false, features = null, toolConfig = null, requiredCrs = [], authRequired = false } = {}) => {
    const webRoot = await resolveQwc2WebRoot();
    let baseConfig;
    try {
      const raw = await fs.promises.readFile(path.join(webRoot, 'config.json'), 'utf8');
      baseConfig = JSON.parse(raw);
    } catch {
      baseConfig = {};
    }

    // Keep available locales aligned with shipped translation files.
    // This prevents runtime fallback warnings for valid locales (e.g. sv-SE).
    try {
      const translationsDir = path.join(webRoot, 'translations');
      const entries = await fs.promises.readdir(translationsDir, { withFileTypes: true });
      const localeCodes = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && !entry.name.endsWith('_overrides.json'))
        .map((entry) => entry.name.replace(/\.json$/i, ''))
        .filter((code) => code.includes('-'))
        .sort((a, b) => a.localeCompare(b));
      if (localeCodes.length > 0) {
        const currentLocales = (baseConfig.availableLocales && typeof baseConfig.availableLocales === 'object')
          ? { ...baseConfig.availableLocales }
          : {};
        const nextLocales = {};
        for (const code of localeCodes) {
          nextLocales[code] = currentLocales[code] || code;
        }
        baseConfig.availableLocales = nextLocales;
      }
    } catch {
      // Keep existing locale config when translation folder is not readable.
    }

    const tc = toolConfig && typeof toolConfig === 'object' ? toolConfig : {};
    const authActive = typeof security?.isEnabled === 'function' ? security.isEnabled() : false;
    const shouldEnableAuthUi = authActive && authRequired;

    // Set service URLs from tool config, or clear demo defaults
    baseConfig.searchServiceUrl = '/Qtiler2Origo/search';
    baseConfig.searchDataServiceUrl = '';
    baseConfig.editServiceUrl = '/wfs';
    baseConfig.mapInfoServiceUrl = '/wms';
    baseConfig.permalinkServiceUrl = tc.shareServiceUrl || '';
    baseConfig.elevationServiceUrl = tc.elevationServiceUrl || '';
    baseConfig.featureReportService = '';
    baseConfig.documentServiceUrl = '';
    baseConfig.authServiceUrl = shouldEnableAuthUi ? '/auth/' : '';

    const disabledPlugins = new Set();

    // Filter QWC2 plugins based on profile features
    if (features && typeof features === 'object') {
      for (const [featureKey, pluginNames] of Object.entries(FEATURE_PLUGIN_MAP)) {
        if (features[featureKey] === false) {
          pluginNames.forEach((name) => disabledPlugins.add(name));
        }
      }
    }

    // Routing and DXF export need explicit backend service URLs in our
    // deployment. If left empty, keeping the plugins visible creates a
    // production-ready-looking UI that cannot actually complete the action.
    if (!String(tc.routingServiceUrl || '').trim()) {
      for (const name of (FEATURE_PLUGIN_MAP.routing || [])) {
        disabledPlugins.add(name);
      }
    }
    if (!String(tc.dxfExportServiceUrl || '').trim()) {
      for (const name of (FEATURE_PLUGIN_MAP.dxfExport || [])) {
        disabledPlugins.add(name);
      }
    }

    // Bookmark plugin requires permalink/bookmark backend endpoints.
    // When permalink service is not configured, hide it to avoid /bookmarks 404s.
    if (!String(baseConfig.permalinkServiceUrl || '').trim()) {
      for (const name of (FEATURE_PLUGIN_MAP.bookmark || [])) {
        disabledPlugins.add(name);
      }
    }

    if (disabledPlugins.size > 0) {
      for (const section of ['common', 'mobile', 'desktop']) {
        if (Array.isArray(baseConfig.plugins?.[section])) {
          baseConfig.plugins[section] = baseConfig.plugins[section].filter(
            (p) => p && !disabledPlugins.has(p.name)
          );
        }
      }
      // Also filter TopBar menu items and toolbar items referencing disabled plugins
      const filterMenuItems = (items) => {
        if (!Array.isArray(items)) return items;
        return items.filter((item) => {
          if (!item) return false;
          if (item.key && disabledPlugins.has(item.key)) return false;
          if (Array.isArray(item.subitems)) {
            item.subitems = item.subitems.filter((si) => !si?.key || !disabledPlugins.has(si.key));
            if (item.subitems.length === 0) return false;
          }
          return true;
        });
      };
      for (const section of ['common', 'mobile', 'desktop']) {
        for (const plugin of (baseConfig.plugins?.[section] || [])) {
          if (plugin?.name === 'TopBar' && plugin.cfg) {
            if (plugin.cfg.menuItems) plugin.cfg.menuItems = filterMenuItems(plugin.cfg.menuItems);
            if (plugin.cfg.toolbarItems) plugin.cfg.toolbarItems = filterMenuItems(plugin.cfg.toolbarItems);
          }
        }
      }
    }

    if (features?.view3d === true && !disabledPlugins.has('View3D')) {
      baseConfig.plugins = baseConfig.plugins && typeof baseConfig.plugins === 'object' ? baseConfig.plugins : {};
      baseConfig.plugins.common = Array.isArray(baseConfig.plugins.common) ? baseConfig.plugins.common : [];
      if (!baseConfig.plugins.common.some((p) => p?.name === 'View3D')) {
        baseConfig.plugins.common.push({ name: 'View3D' });
      }

      const ensure3dTool = (section, name, cfg = null) => {
        baseConfig.plugins[section] = Array.isArray(baseConfig.plugins[section]) ? baseConfig.plugins[section] : [];
        const existing = baseConfig.plugins[section].find((p) => p?.name === name);
        if (existing) {
          existing.availableIn3D = true;
          if (cfg && (!existing.cfg || typeof existing.cfg !== 'object')) existing.cfg = cfg;
          return;
        }
        baseConfig.plugins[section].push({ name, availableIn3D: true, ...(cfg ? { cfg } : {}) });
      };

      for (const section of ['desktop', 'mobile']) {
        ensure3dTool(section, 'BackgroundSwitcher3D');
        ensure3dTool(section, 'LayerTree3D');
        ensure3dTool(section, 'Measure3D');
        ensure3dTool(section, 'MapLight3D');
        ensure3dTool(section, 'Settings3D');
        ensure3dTool(section, 'MapCopyright3D');
        ensure3dTool(section, 'HideObjects3D');
        ensure3dTool(section, 'ExportObjects3D');
      }
    }

    if (hasMultipleThemes) {
      // Keep Portal plugin but clean up demo links
      const portal = (baseConfig.plugins?.common || []).find((p) => p?.name === 'Portal');
      if (portal?.cfg) {
        portal.cfg.bottomBarLinks = [];
        portal.cfg.menuItems = [];
        portal.cfg.topBarText = 'Qtiler';
      }
    } else {
      // Single theme — remove Portal
      if (Array.isArray(baseConfig.plugins?.common)) {
        baseConfig.plugins.common = baseConfig.plugins.common.filter(
          (p) => p && p.name !== 'Portal'
        );
      }
    }

    // Remove Portal from TopBar menu
    const topBar = (baseConfig.plugins?.common || []).find((p) => p?.name === 'TopBar');
    if (topBar?.cfg?.menuItems) {
      topBar.cfg.menuItems = topBar.cfg.menuItems.filter(
        (item) => item && item.key !== 'Portal'
      );
    }

    // Patch logo if branding available
    const logoPath = await resolveLogoPath();
    if (topBar?.cfg && logoPath) {
      topBar.cfg.logoSrc = `/plugins/${pluginSlug}/public/branding/logo`;
    }

    // Apply routing service URL to Routing plugin config
    if (tc.routingServiceUrl) {
      for (const section of ['common', 'mobile', 'desktop']) {
        const routing = (baseConfig.plugins?.[section] || []).find((p) => p?.name === 'Routing');
        if (routing) {
          routing.cfg = routing.cfg || {};
          routing.cfg.serviceUrl = tc.routingServiceUrl;
        }
      }
    }

    // Apply DXF export service URL
    if (tc.dxfExportServiceUrl) {
      for (const section of ['common', 'mobile', 'desktop']) {
        const dxf = (baseConfig.plugins?.[section] || []).find((p) => p?.name === 'DxfExport');
        if (dxf) {
          dxf.cfg = dxf.cfg || {};
          dxf.cfg.serviceUrl = tc.dxfExportServiceUrl;
        }
      }
    }

    // Configure Authentication plugin based on QtilerAuth status
    if (shouldEnableAuthUi) {
      // Enable logout button in QWC2 and point to our auth endpoints
      baseConfig.authServiceUrl = '/auth/';
      for (const section of ['common', 'mobile', 'desktop']) {
        const authPlugin = (baseConfig.plugins?.[section] || []).find((p) => p?.name === 'Authentication');
        if (authPlugin) {
          authPlugin.cfg = authPlugin.cfg || {};
          authPlugin.cfg.showLoginUser = true;
          authPlugin.cfg.logoutTargetUrl = '/';
        }
      }
    } else {
      // No auth — remove Authentication plugin entirely
      baseConfig.authServiceUrl = '';
      for (const section of ['common', 'mobile', 'desktop']) {
        if (Array.isArray(baseConfig.plugins?.[section])) {
          baseConfig.plugins[section] = baseConfig.plugins[section].filter(
            (p) => p && p.name !== 'Authentication'
          );
        }
      }
    }

    // Inject required CRS projection definitions
    if (!Array.isArray(baseConfig.projections)) baseConfig.projections = [];
    const existingCodes = new Set(baseConfig.projections.map((p) => p?.code));
    const allNeeded = new Set(Array.isArray(requiredCrs) ? requiredCrs : []);
    for (const code of allNeeded) {
      if (existingCodes.has(code)) continue;
      const def = KNOWN_PROJECTIONS[code];
      if (def) {
        baseConfig.projections.push(def);
        existingCodes.add(code);
      }
    }

    // Remove external LayerCatalog URL (demo config points to sourcepole.ch)
    for (const section of ['common', 'mobile', 'desktop']) {
      const catalog = (baseConfig.plugins?.[section] || []).find((p) => p?.name === 'LayerCatalog');
      if (catalog?.cfg?.catalogUrl && catalog.cfg.catalogUrl.includes('sourcepole')) {
        catalog.cfg.catalogUrl = '';
      }
    }

    // Remove demo NewsPopup
    for (const section of ['common', 'mobile', 'desktop']) {
      if (Array.isArray(baseConfig.plugins?.[section])) {
        baseConfig.plugins[section] = baseConfig.plugins[section].filter(
          (p) => p && p.name !== 'NewsPopup'
        );
      }
    }

    // Clear bundled demo background layers so themes.json provides a single source
    // of truth for background layers (avoid duplicated "No background" / OSM entries).
    baseConfig.backgroundLayers = [];
    baseConfig.defaultBackgroundLayers = [];

    // Force-clear any external service endpoints that may point to demo or
    // local test services (e.g. :8088) to avoid client-side CORS/connection errors.
    baseConfig.searchServiceUrl = '/Qtiler2Origo/search';
    baseConfig.searchDataServiceUrl = '';
    if (typeof baseConfig.editServiceUrl !== 'string' || !baseConfig.editServiceUrl.trim()) baseConfig.editServiceUrl = '/wfs';
    if (typeof baseConfig.mapInfoServiceUrl !== 'string' || !baseConfig.mapInfoServiceUrl.trim()) baseConfig.mapInfoServiceUrl = '/wms';
    baseConfig.permalinkServiceUrl = '';
    baseConfig.elevationServiceUrl = '';
    baseConfig.featureReportService = '';
    baseConfig.documentServiceUrl = '';
    baseConfig.authServiceUrl = shouldEnableAuthUi ? '/auth/' : '';

    // Also clear any plugin-level external URLs (catalogs, tile info, imported tiles)
    for (const section of ['common', 'mobile', 'desktop']) {
      const plugins = baseConfig.plugins?.[section];
      if (!Array.isArray(plugins)) continue;
      for (const p of plugins) {
        if (!p || !p.cfg) continue;
        if (typeof p.cfg.catalogUrl === 'string') p.cfg.catalogUrl = '';
        if (p.name === 'Editing') p.cfg.serviceUrl = '/wfs';
        if (p.name === 'Identify') p.cfg.serviceUrl = '/wms';
        if (!['Authentication', 'Identify', 'Editing', 'FeatureForm'].includes(p.name) && typeof p.cfg.serviceUrl === 'string') p.cfg.serviceUrl = '';
        if (typeof p.cfg.permalinkUrl === 'string') p.cfg.permalinkUrl = '';
        if (typeof p.cfg.tileInfoServiceUrl === 'string') p.cfg.tileInfoServiceUrl = '';
        if (typeof p.cfg.importedTilesBaseUrl === 'string') p.cfg.importedTilesBaseUrl = '';
      }
    }

    return baseConfig;
  };

  /**
   * Build background layer entries for a single profile.
   * Returns { theme: [...], global: [...] } where theme entries are per-theme
   * and global entries go in the top-level backgroundLayers array.
   */
  const findTileGridPresetForCrs = async (crs) => {
    try {
      const dir = path.join(process.cwd(), 'config', 'tile-grids');
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isFile() || !ent.name.toLowerCase().endsWith('.json')) continue;
        try {
          const raw = await fs.promises.readFile(path.join(dir, ent.name), 'utf8');
          const parsed = JSON.parse(raw || '{}');
          const supported = parsed.supported_crs || parsed.coordinateReferenceSystem || parsed.coordinateReferenceSystems || null;
          if (Array.isArray(parsed.supported_crs) && parsed.supported_crs.includes(crs)) return parsed;
          if (String(parsed.coordinateReferenceSystem || '').trim() === crs) return parsed;
        } catch (e) {
          // ignore parse errors
        }
      }
    } catch (e) {
      // no presets
    }
    return null;
  };

  const buildBackgroundLayers = async (profile, qtilerBaseUrl) => {
    const bgLayersTheme = [];
    const bgLayersGlobal = [];
    const backgrounds = Array.isArray(profile.backgrounds) ? profile.backgrounds : [];
    const themeBgNames = new Set();
    const pushThemeBg = (name, visibility) => {
      const safe = String(name || '').trim();
      if (!safe || themeBgNames.has(safe)) return;
      themeBgNames.add(safe);
      bgLayersTheme.push({ name: safe, visibility: visibility === true });
    };

    for (const bg of backgrounds) {
      if (bg.type === 'osm') {
        pushThemeBg('mapnik', bg.isDefault === true);
        if (!bgLayersGlobal.some((g) => g.name === 'mapnik')) {
          bgLayersGlobal.push({
            name: 'mapnik',
            title: bg.title || 'OpenStreetMap',
            type: 'xyz',
            url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            attribution: {
              Title: 'OpenStreetMap contributors',
              OnlineResource: 'https://www.openstreetmap.org/copyright'
            },
            // QWC2 prepends /Qtiler2Origo/webmap/assets to thumbnail paths.
            // Use an assets-relative path that resolves to /img/...
            thumbnail: '../../../../img/mapthumbs/mapnik.jpg',
            tileSize: [256, 256]
          });
        }
      } else if (bg.type === 'none') {
        const safeName = 'none';
        // Use QWC2 built-in no-background entry to avoid duplicated options
        // like "No background" + custom localized variants.
        pushThemeBg(safeName, bg.isDefault === true);
        if (!bgLayersGlobal.some((g) => g.name === safeName)) {
          bgLayersGlobal.push({
            name: safeName,
            title: 'No background',
            type: 'empty'
          });
        }
      } else if (bg.type === 'layer' && bg.sourceProjectId && bg.name) {
        const bgName = String(bg.name || '').trim();
        const bgThemeName = normalizeThemeName(bg.themeName || (bg.isTheme === true || /^theme:/i.test(bgName) ? bgName : ''));
        const isThemeBackground = !!bgThemeName;
        const wmtsLayerName = isThemeBackground ? bgThemeName : bgName;
        const wmsLayerName = isThemeBackground ? `theme:${bgThemeName}` : bgName;
        const displayTitle = bg.title || (isThemeBackground ? bgThemeName : bgName);
        let preset = null;
        let bgExtent = null;
        try {
          bgExtent = await getProjectExtent(bg.sourceProjectId);
          const crs = bgExtent?.crs || null;
          if (crs) {
            preset = await findTileGridPresetForCrs(crs);
          }
        } catch (e) {
          // ignore and fallback below
        }

        const presetId = String(preset?.id || preset?.identifier || '').trim();
        const hasPresetMatrices = Array.isArray(preset?.matrices) && preset.matrices.length > 0;

        if (presetId && hasPresetMatrices) {
          const safeName = `wmts:${bg.sourceProjectId}/${isThemeBackground ? `theme:${bgThemeName}` : bgName}`;
          // Use the on-demand tile route that accepts raw project/layer names
          // and caches generated tiles on first request.
          const wmtsUrl = isThemeBackground
            ? buildThemeWmtsUrl(qtilerBaseUrl, bg.sourceProjectId, bgThemeName, true)
            : `${qtilerBaseUrl}/wmts/${encodeURIComponent(bg.sourceProjectId)}/${encodeURIComponent(wmtsLayerName)}/{TileMatrix}/{TileCol}/{TileRow}.png`;
          const resolutions = preset.matrices
            .map((m) => Number(m?.resolution))
            .filter((r) => Number.isFinite(r));

          bgLayersGlobal.push({
            name: safeName,
            title: displayTitle,
            type: 'wmts',
            url: wmtsUrl,
            tileMatrixPrefix: '',
            tileMatrixSet: presetId,
            originX: (typeof (preset?.topLeftCorner?.[0]) === 'number') ? preset.topLeftCorner[0] : -20037508.34278925,
            originY: (typeof (preset?.topLeftCorner?.[1]) === 'number') ? preset.topLeftCorner[1] : 20037508.34278925,
            projection: preset?.coordinateReferenceSystem || 'EPSG:3857',
            resolutions,
            tileSize: [256, 256],
            bbox: { crs: 'EPSG:4326', bounds: bgExtent?.wgs84 || [-180, -90, 180, 90] },
            // QWC2 prepends /Qtiler2Origo/webmap/assets to thumbnail paths.
            // Use an assets-relative path that resolves to /plugins/...
            thumbnail: `../../../../plugins/${pluginSlug}/api/thumbnail/layer/${encodeURIComponent(wmsLayerName)}?project=${encodeURIComponent(bg.sourceProjectId)}`
          });
          pushThemeBg(safeName, bg.isDefault === true);
        } else {
          // Fallback for projects without tile-grid preset metadata.
          const safeName = `wms:${bg.sourceProjectId}/${wmsLayerName}`;
          bgLayersGlobal.push({
            name: safeName,
            title: displayTitle,
            type: 'wms',
            url: `${qtilerBaseUrl}/wms?project=${encodeURIComponent(bg.sourceProjectId)}`,
            params: {
              LAYERS: wmsLayerName,
              TRANSPARENT: false,
              VERSION: '1.3.0',
              FORMAT: 'image/png'
            },
            thumbnail: `../../../../plugins/${pluginSlug}/api/thumbnail/layer/${encodeURIComponent(wmsLayerName)}?project=${encodeURIComponent(bg.sourceProjectId)}`
          });
          pushThemeBg(safeName, bg.isDefault === true);
        }
      }
    }

    return { theme: bgLayersTheme, global: bgLayersGlobal };
  };

  /**
   * Build a single QWC2 theme item from a published profile.
   */
  const buildThemeItem = async (profile, qtilerBaseUrl) => {
    const projectId = profile.projectId || 'unknown';
    const wmsUrl = `${qtilerBaseUrl}/wms?project=${encodeURIComponent(projectId)}`;
    const wfsUrl = `${qtilerBaseUrl}/wfs?project=${encodeURIComponent(projectId)}`;

    // Get real extent and CRS from cache index
    const extent = await getProjectExtent(projectId);
    const bboxWgs84 = extent?.wgs84 || [-180, -90, 180, 90];
    const bboxNative = extent?.native || [-20037508, -20037508, 20037508, 20037508];
    const projectCrs = extent?.crs || 'EPSG:3857';

    // Read cache index for per-layer metadata (geometry types, CRS)
    const cacheIndex = await readCacheIndex(projectId);
    const cachedLayers = cacheIndex?.layers || [];
    const projectLayerFlags = await readProjectLayerFlags(projectId);
    const qgis3dLayers = readQgis3dLayerConfig(cacheIndex?.project, cachedLayers);

    // Collect additional CRS from layers that differ from the project CRS
    const additionalCrsSet = new Set();
    for (const cl of cachedLayers) {
      const layerCrs = cl.layer_crs || cl.crs;
      if (layerCrs && layerCrs !== projectCrs) additionalCrsSet.add(layerCrs);
    }

    const mainLayers = (profile.layers || []).filter((l) => l.role === 'main');
    const sublayers = mainLayers.map((layer) => {
      // Title is the human-readable layer name from the profile
      const title = String(layer.title || layer.name || '').trim();
      // Use the real layer name so WMS legend/icons resolve correctly.
      const name = String(layer.name || title || '').trim() || 'layer';
      const cached = cachedLayers.find((c) => {
        const cand = String(c?.name || c?.layer || c?.title || '').trim();
        return cand && (cand === name || cand === title || safeLayerNameForWfs(cand) === safeLayerNameForWfs(name));
      });
      const cfgFlags = (() => {
        const direct = projectLayerFlags?.[name] && typeof projectLayerFlags[name] === 'object' ? projectLayerFlags[name] : null;
        if (direct) return direct;
        for (const [k, v] of Object.entries(projectLayerFlags || {})) {
          if (safeLayerNameForWfs(k) === safeLayerNameForWfs(name) && v && typeof v === 'object') return v;
        }
        return null;
      })();
      const isVectorLike = cached?.type === 'vector' || !!cached?.geometry_type;
      const isEditable = layer?.editable === true || cfgFlags?.wfsEditable === true;
      const sl = {
        name,
        wms_name: name,
        title: title || name,
        visibility: (typeof layer.visible === 'undefined') ? true : !!layer.visible,
        queryable: true,
        geometryType: cached?.geometry_type || null,
        opacity: 255,
        bbox: { crs: 'EPSG:4326', bounds: cached?.extent_wgs84 || bboxWgs84 }
      };
      if (isEditable) {
        const editLayerToken = safeLayerNameForWfs(name) || sanitizeFileToken(name) || 'layer';
        sl.editConfig = {
          editable: true,
          editDataset: `${projectId}.${editLayerToken}`,
          idField: layer?.idAttribute || null,
          geometryField: layer?.geometryAttribute || null,
          displayField: layer?.searchAttribute || null,
          geomType: cached?.geometry_type || null,
          fields: [],
          featureNS: `http://qtiler.local/${encodeURIComponent(projectId || 'project')}`,
          sourceLayer: name,
          // QWC2 EditingSupport gates the Modify interaction (vertex drag)
          // on editConfig.permissions.updatable === true. Without these
          // permissions, picked features render with vertices but cannot be
          // dragged. Mirror the boolean on the editContext.permissions used by
          // the same gate.
          permissions: {
            creatable: true,
            updatable: true,
            deletable: true
          }
        };
      }
      const layer3d = qgis3dLayers.get(name) || qgis3dLayers.get(title);
      if (layer3d && /polygon/i.test(String(cached?.geometry_type || ''))) {
        sl.extrusionHeight = layer3d.extrusionHeight;
        if (layer3d.color) sl.color = layer3d.color;
        const wfsLayerName = name;
        const wfs3dId = `${projectId}:3d:${safeLayerNameForWfs(wfsLayerName) || sanitizeFileToken(wfsLayerName) || 'layer'}`;
        sl.wfs3dLayer = {
          id: wfs3dId,
          type: 'wfs',
          name: wfsLayerName,
          title: `${title || name} 3D`,
          url: wfsUrl,
          version: '1.1.0',
          formats: ['application/json', 'geojson', 'json'],
          projection: cached?.layer_crs || cached?.crs || projectCrs,
          bbox: { crs: 'EPSG:4326', bounds: cached?.extent_wgs84 || bboxWgs84 },
          color: layer3d.color || '#b2b2b2'
        };
      }
      return sl;
    });

    const bgResult = await buildBackgroundLayers(profile, qtilerBaseUrl);
    const searchEnabled = profile.features?.search !== false;
    // QWC2 only ships 4 built-in providers: coordinates, nominatim, qgis, fulltext.
    // We expose our /Qtiler2Origo/search endpoint via the `fulltext` provider; the
    // `params.default` array becomes the `filter` query string sent to the
    // backend, which we use to identify the dataset (theme id).
    const localSearchProvider = { provider: 'fulltext', params: { default: [projectId] } };
    const searchProviders = searchEnabled
      ? (profile.features?.searchGlobal
          ? [localSearchProvider, 'coordinates', 'nominatim']
          : [localSearchProvider])
      : [];

    const item = {
      url: wmsUrl,
      id: projectId,
      name: projectId,
      wms_name: projectId,
      title: projectId,
      description: '',
      attribution: { Title: 'Qtiler', OnlineResource: qtilerBaseUrl },
      abstract: '',
      keywords: '',
      onlineResource: `${wmsUrl}&`,
      availableFormats: ['image/jpeg', 'image/png', 'image/png; mode=16bit', 'image/png; mode=8bit'],
      version: '1.3.0',
      infoFormats: ['text/plain', 'text/html', 'text/xml', 'application/json'],
      bbox: { crs: 'EPSG:4326', bounds: bboxWgs84 },
      initialBbox: { crs: projectCrs, bounds: bboxNative },
      sublayers,
      expanded: true,
      externalLayers: [],
      backgroundLayers: bgResult.theme,
      searchProviders,
      additionalMouseCrs: [...additionalCrsSet],
      mapCrs: projectCrs,
      drawingOrder: sublayers.map((l) => l.name).reverse(),
      printUrl: `${wmsUrl}&`,
      visibilityPresets: {},
      skipEmptyFeatureAttributes: true,
      // Tiled WMS: QWC2 will request fixed tile-aligned GetMaps. Qtiler's
      // /wms route caches those tiles on disk under cache/<projectId>/_wms_tiles
      // (see routes/wms.js). The first time a layer combo is requested at a
      // given zoom it renders through QGIS; subsequent requests for the same
      // combo are served instantly from disk.
      tiled: true,
      // QWC2 prepends /Qtiler2Origo/webmap/assets to thumbnail paths.
      // Use an assets-relative path that resolves to /plugins/...
      thumbnail: `../../../../plugins/${pluginSlug}/api/thumbnail/${encodeURIComponent(projectId)}${buildPublishedThumbnailQuery({ mainLayerNames: mainLayers.map((l) => String(l.name || '').trim()).filter(Boolean), background: getDefaultPublishedBackground(profile) })}`
    };

    // If this profile has view3d enabled, add map3d so QWC2 shows the 3D button.
    // QWC2 checks: theme.map3d && havePlugin('View3D') before showing the 3D toolbar button.
    if (profile.features?.view3d === true) {
      // Find a GeoTIFF in the project folder to use as terrain (DTM).
      const dtm = await (async () => {
        try {
          // Project files live under qgisprojects/<projectId>/<projectId>/
          const candidates = [
            path.join(projectsDir, projectId),
            path.join(projectsDir, projectId, projectId)
          ];
          const scoreTerrainFile = (filename) => {
            const name = String(filename || '').toLowerCase();
            let score = 0;
            if (/\.(tif|tiff)$/i.test(name)) score += 10;
            if (/(terrain|dtm|dem|elevation|height|relief)/i.test(name)) score += 100;
            if (/(stock|surface|ground|z)/i.test(name)) score += 15;
            if (/(orto|ortho|orthophoto|aerial|satellite|imagery|rgb|topo|webb|basemap)/i.test(name)) score -= 200;
            return score;
          };
          for (const dir of candidates) {
            let entries = [];
            try { entries = await fs.promises.readdir(dir); } catch { continue; }
            const tif = entries
              .filter((e) => /\.(tif|tiff)$/i.test(e))
              .sort((a, b) => scoreTerrainFile(b) - scoreTerrainFile(a) || a.localeCompare(b))[0];
            if (tif) {
              const terrainUrl = `${qtilerBaseUrl}/Qtiler2Origo/terrain/${encodeURIComponent(projectId)}/${encodeURIComponent(tif)}`;
              return { url: terrainUrl, crs: projectCrs };
            }
          }
        } catch { /* ignore */ }
        return null;
      })();
      item.map3d = {
        ...(dtm ? { dtm } : {}),
        basemaps: bgResult.theme
      };
    }

    // QWC2's editing reducer reads edit config from the root WMS layer
    // (layer.editConfig), not directly from sublayer metadata.
    const rootEditConfig = {};
    for (const sl of sublayers) {
      if (sl?.editConfig && sl?.name) {
        rootEditConfig[sl.name] = sl.editConfig;
      }
    }
    if (Object.keys(rootEditConfig).length > 0) {
      item.editConfig = rootEditConfig;
    }

    // Only advertise WFS endpoints when a layer is explicitly editable or
    // explicitly published as WFS. Vector geometry alone must remain WMS.
    const wfsLayers = mainLayers.filter((l) => {
      const cfgFlags = (() => {
        const direct = projectLayerFlags?.[l.name] && typeof projectLayerFlags[l.name] === 'object' ? projectLayerFlags[l.name] : null;
        if (direct) return direct;
        for (const [k, v] of Object.entries(projectLayerFlags || {})) {
          if (safeLayerNameForWfs(k) === safeLayerNameForWfs(l.name) && v && typeof v === 'object') return v;
        }
        return null;
      })();
      return shouldUseWfsForPublishedLayer(l, cfgFlags?.wfsEditable === true);
    });
    if (wfsLayers.length > 0) {
      // Primary WFS endpoint used by some QWC2 plugins
      item.wmsDataUrl = wfsUrl;
      // Provide additional explicit WFS properties for compatibility with different QWC2 builds
      item.wfsServiceUrl = wfsUrl;
      item.wfsUrl = wfsUrl;
    }

    // Populate print layouts from the QGIS project via the renderer pool
    try {
      const rendererPool = app.locals.tileRendererPool;
      if (rendererPool && typeof rendererPool.renderTile === 'function') {
        // Find the project file (.qgz or .qgs) in projectsDir
        let projectFile = null;
        for (const ext of ['.qgz', '.qgs']) {
          const candidate = path.join(projectsDir, projectId + ext);
          try {
            await fs.promises.access(candidate, fs.constants.R_OK);
            projectFile = candidate;
            break;
          } catch { /* not found */ }
        }
        // Also check inside a sub-folder (projectsDir/projectId/projectId.qgz)
        if (!projectFile) {
          for (const ext of ['.qgz', '.qgs']) {
            const candidate = path.join(projectsDir, projectId, projectId + ext);
            try {
              await fs.promises.access(candidate, fs.constants.R_OK);
              projectFile = candidate;
              break;
            } catch { /* not found */ }
          }
        }
        if (projectFile) {
          const layoutResult = await rendererPool.renderTile({
            action: 'list_print_layouts',
            project_path: projectFile.replace(/\\/g, '/')
          });
          if (layoutResult?.status === 'success' && Array.isArray(layoutResult.layouts) && layoutResult.layouts.length > 0) {
            item.print = layoutResult.layouts.map((layout, idx) => ({
              name: layout.name,
              map: {
                name: (layout.map?.name) || 'map0',
                x: layout.map?.x ?? 0,
                y: layout.map?.y ?? 0,
                width: (layout.map?.width > 0) ? layout.map.width : layout.width,
                height: (layout.map?.height > 0) ? layout.map.height : layout.height
              },
              labels: Array.isArray(layout.labels) ? layout.labels : [],
              ...(idx === 0 ? { default: true } : {})
            }));
          }
        }
      }
    } catch (err) {
      console.warn(`[Qtiler2Origo] Could not load print layouts for ${projectId}:`, err?.message || err);
    }

    return { item, bgLayersGlobal: bgResult.global };
  };

  /**
   * Build a QWC2-compatible themes.json from one or more published profiles.
   * Supports both single-profile (via ?qtiler_profile=X) and all-profiles mode.
   */
  const buildQwc2Themes = async (profiles, qtilerBaseUrl, { defaultTheme = null } = {}) => {
    const items = [];
    const allBgGlobal = [];
    const seenBgNames = new Set();
    const enableGlobalSearch = profiles.some((profile) => profile?.features?.searchGlobal === true && profile?.features?.search !== false);

    for (const profile of profiles) {
      const { item, bgLayersGlobal } = await buildThemeItem(profile, qtilerBaseUrl);
      items.push(item);
      for (const bg of bgLayersGlobal) {
        if (!seenBgNames.has(bg.name)) {
          seenBgNames.add(bg.name);
          allBgGlobal.push(bg);
        }
      }
    }

    const firstId = items[0]?.id || 'unknown';

    return {
      themes: {
        title: 'root',
        searchServiceUrl: `${qtilerBaseUrl}/Qtiler2Origo/search`,
        subdirs: [],
        items,
        defaultTheme: defaultTheme || firstId,
        // Use the map CRS of the first theme if available so QWC2 initializes
        // the map in the project's native CRS instead of forcing WebMercator.
        defaultMapCrs: (items[0] && items[0].mapCrs) ? items[0].mapCrs : 'EPSG:3857',
        defaultScales: [
          100000000, 50000000, 25000000, 10000000, 4000000, 2000000,
          1000000, 400000, 200000, 80000, 40000, 20000, 10000, 8000,
          6000, 4000, 2000, 1000, 500, 250, 100
        ],
        defaultPrintGrid: [
          { s: 10000000, x: 1000000, y: 1000000 },
          { s: 1000000, x: 100000, y: 100000 },
          { s: 100000, x: 10000, y: 10000 },
          { s: 10000, x: 1000, y: 1000 },
          { s: 1000, x: 100, y: 100 },
          { s: 100, x: 10, y: 10 }
        ],
        defaultSearchProviders: enableGlobalSearch ? ['coordinates', 'nominatim'] : [],
        defaultBackgroundLayers: [],
        externalLayers: [],
        backgroundLayers: allBgGlobal
      }
    };
  };

  const syncRuntimeFilesForProfile = async (profile, baseUrl) => {
    if (!profile || typeof profile !== 'object') return;
    await fs.promises.mkdir(installRoot, { recursive: true });
    const requiredCrs = await collectRequiredCrsForProfiles([profile]);
    const config = await buildQwc2Config({
      hasMultipleThemes: false,
      features: profile.features || null,
      toolConfig: profile.toolConfig || null,
      requiredCrs,
      authRequired: false
    });
    const themes = normalizeThemesForQwc2Assets(
      await buildQwc2Themes([profile], baseUrl, { defaultTheme: profile.projectId || null })
    );
    await fs.promises.writeFile(path.join(installRoot, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
    await fs.promises.writeFile(path.join(installRoot, 'themes.json'), JSON.stringify(themes, null, 2), 'utf8');
  };

  const normalizeThemesForQwc2Assets = (themesPayload) => {
    const payload = themesPayload && typeof themesPayload === 'object' ? themesPayload : {};
    const themes = payload.themes && typeof payload.themes === 'object' ? payload.themes : {};

    const toAssetRelative = (value) => {
      if (typeof value !== 'string') return value;
      let out = value.trim();
      if (!out) return out;
      out = out.replace(/^https?:\/\/[^/]+\/plugins\//i, '../../../../plugins/');
      out = out.replace(/^\/plugins\//i, '../../../../plugins/');
      out = out.replace(/^https?:\/\/[^/]+\/img\//i, '../../../../img/');
      out = out.replace(/^\/img\//i, '../../../../img/');
      return out;
    };

    const globals = Array.isArray(themes.backgroundLayers) ? themes.backgroundLayers : [];
    for (const bg of globals) {
      if (!bg || typeof bg !== 'object') continue;
      const bgName = String(bg.name || '').trim();
      const themeMatch = bgName.match(/^wmts:([^/]+)\/theme:(.+)$/i);
      if (themeMatch && typeof bg.url === 'string') {
        const originMatch = bg.url.match(/^(https?:\/\/[^/]+)/i);
        if (originMatch) {
          try {
            bg.url = buildThemeWmtsUrl(originMatch[1], decodeURIComponent(themeMatch[1]), normalizeThemeName(decodeURIComponent(themeMatch[2])), true);
          } catch {
            bg.url = buildThemeWmtsUrl(originMatch[1], themeMatch[1], normalizeThemeName(themeMatch[2]), true);
          }
        }
      }
      if (typeof bg.thumbnail === 'string') bg.thumbnail = toAssetRelative(bg.thumbnail);
    }

    const items = Array.isArray(themes.items) ? themes.items : [];
    const referencedBgNames = new Set();
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      if (typeof item.thumbnail === 'string') item.thumbnail = toAssetRelative(item.thumbnail);
      const bgs = Array.isArray(item.backgroundLayers) ? item.backgroundLayers : [];
      for (const bgRef of bgs) {
        const n = String(bgRef?.name || '').trim();
        if (n) referencedBgNames.add(n);
      }
    }

    const globalNames = new Set(globals.map((g) => String(g?.name || '').trim()).filter(Boolean));
    if (referencedBgNames.has('none') && !globalNames.has('none')) {
      globals.push({ name: 'none', title: 'No background', type: 'empty' });
      globalNames.add('none');
    }

    if (referencedBgNames.has('mapnik') && !globalNames.has('mapnik')) {
      globals.push({
        name: 'mapnik',
        title: 'OpenStreetMap',
        type: 'xyz',
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        tileSize: [256, 256],
        thumbnail: '../../../../img/mapthumbs/mapnik.jpg',
        attribution: {
          Title: 'OpenStreetMap contributors',
          OnlineResource: 'https://www.openstreetmap.org/copyright'
        }
      });
    }

    themes.backgroundLayers = globals;
    payload.themes = themes;
    return payload;
  };

  /**
   * Build the HTML page shown when no maps are accessible.
   * Shows login form if auth is active and user not logged in,
   * "no maps" + logout button if logged in but no access,
   * or plain "no maps published" if auth is not active.
   */
  const buildNoAccessPage = (authActive, isLoggedIn, user) => {
    const commonCss = `*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0f4f8;display:flex;align-items:center;justify-content:center;min-height:100vh;color:#334155}
.card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);padding:48px 40px;text-align:center;max-width:420px;width:90%}
.card svg{width:56px;height:56px;margin-bottom:16px;color:#94a3b8}
h1{font-size:1.4rem;margin-bottom:8px;color:#1e293b}
p{font-size:.95rem;color:#64748b;line-height:1.5;margin-bottom:16px}
.form-group{text-align:left;margin-bottom:14px}
label{display:block;font-size:.85rem;font-weight:600;color:#475569;margin-bottom:4px}
input[type=text],input[type=password]{width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:.95rem;outline:none;transition:border-color .15s}
input:focus{border-color:#3b82f6}
.btn{display:inline-block;padding:10px 24px;border:none;border-radius:8px;font-size:.95rem;font-weight:600;cursor:pointer;transition:background .15s}
.btn-primary{background:#3b82f6;color:#fff}.btn-primary:hover{background:#2563eb}
.btn-ghost{background:transparent;color:#64748b;font-size:.85rem;margin-top:8px}.btn-ghost:hover{color:#334155}
.error-msg{color:#dc2626;font-size:.85rem;margin-top:8px;display:none}
.user-badge{font-size:.85rem;color:#64748b;margin-bottom:12px}`;

    const mapIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z"/></svg>`;

    if (authActive && !isLoggedIn) {
      // Login form
      return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Qtiler – Login</title><style>${commonCss}</style></head><body>
<div class="card">
${mapIcon}
<h1>Qtiler Map Viewer</h1>
<p>Sign in to access your maps.</p>
<form id="loginForm" onsubmit="return false">
<div class="form-group"><label for="username">Username</label><input type="text" id="username" autocomplete="username" required /></div>
<div class="form-group"><label for="password">Password</label><input type="password" id="password" autocomplete="current-password" required /></div>
<div class="error-msg" id="errorMsg"></div>
<button type="submit" class="btn btn-primary" style="width:100%;margin-top:8px" id="loginBtn">Sign in</button>
</form>
</div>
<script>
document.getElementById('loginForm').addEventListener('submit',async()=>{
  const btn=document.getElementById('loginBtn');
  const err=document.getElementById('errorMsg');
  err.style.display='none';
  btn.disabled=true;btn.textContent='Signing in…';
  try{
    const r=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:document.getElementById('username').value,password:document.getElementById('password').value})});
    const d=await r.json();
    if(r.ok&&d.token){window.location.reload();}
    else{err.textContent=d.error||'Invalid credentials';err.style.display='block';}
  }catch(e){err.textContent='Connection error';err.style.display='block';}
  btn.disabled=false;btn.textContent='Sign in';
});
</script></body></html>`;
    }

    if (authActive && isLoggedIn) {
      // Logged in but no maps
      const displayName = user?.username || user?.id || 'User';
      return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Qtiler</title><style>${commonCss}</style></head><body>
<div class="card">
${mapIcon}
<h1>No maps available</h1>
<p class="user-badge">Signed in as <strong>${displayName.replace(/[<>&"]/g, '')}</strong></p>
<p>There are no published maps accessible to your account. Please contact the administrator.</p>
<button class="btn btn-ghost" onclick="fetch('/auth/logout',{method:'POST'}).then(()=>window.location.reload())">Sign out</button>
</div></body></html>`;
    }

    // No auth — plain message
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Qtiler</title><style>${commonCss}</style></head><body>
<div class="card">
${mapIcon}
<h1>No maps available</h1>
<p>There are no published maps at this time.</p>
</div></body></html>`;
  };

  // startStandaloneServer removed — QWC2 served from same-origin under /Qtiler2Origo/webmap
  const startStandaloneServer = async (_port) => { return { port: null }; };

  const maybeAutoStartStandalone = async () => { /* removed */ };

  app.use(`/plugins/${pluginSlug}/admin-ui`, (req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
  }, express.static(adminUiDir));
  app.use(`/plugins/${pluginSlug}/client`, express.static(clientDir));
  
  // Serve origo-controls with no-cache headers to prevent browser caching during development
  app.use(`/plugins/${pluginSlug}/origo-controls`, (req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
  }, express.static(path.join(baseDir, 'origo-controls')));
  
  app.get(`/plugins/${pluginSlug}/published/thumbs/:fileName`, async (req, res, next) => {
    try {
      const fileName = String(req.params?.fileName || '').trim();
      if (!fileName || !/\.jpg$/i.test(fileName)) return next();
      const profileKey = sanitizeFileToken(fileName.replace(/\.jpg$/i, ''));
      if (!profileKey) return next();

      const record = await resolvePublishedProfileRecord(profileKey);
      if (!record?.profile || !record?.profileKey) return next();

      if (!userCanAccessProfile(record.profile, req.user || null)) {
        return res.status(req.user ? 403 : 401).json({ error: req.user ? 'forbidden' : 'auth_required' });
      }

      const existing = await readPublishedThumbnailMeta(profileKey);
      if (existing?.filePath) return res.sendFile(existing.filePath);
      return next();
    } catch {
      return next();
    }
  });
  app.get(`/plugins/${pluginSlug}/published/:fileName`, async (req, res, next) => {
    try {
      const fileName = String(req.params?.fileName || '').trim();
      if (!fileName || !/\.json$/i.test(fileName)) return next();
      const profileKey = sanitizeFileToken(fileName.replace(/\.json$/i, ''));
      if (!profileKey) return next();
      const record = await resolvePublishedProfileRecord(profileKey);
      if (!record?.profile || !record?.profileKey) return next();
      if (!userCanAccessProfile(record.profile, req.user || null)) {
        return res.status(req.user ? 403 : 401).json({ error: req.user ? 'forbidden' : 'auth_required' });
      }
      res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
      return res.json(record.profile);
    } catch {
      return next();
    }
  });
  // Serve dynamic, sanitized config/themes for the plugin-local QWC2 path so
  // the admin UI and local links always receive runtime-built configs.
  app.get(`/plugins/${pluginSlug}/origo/config.json`, async (req, res) => {
    try {
      const profileId = profileFromReferer(req) || req.query?.qtiler_profile;
      const allProfiles = await readAllPublishedProfiles();
      const accessible = filterProfilesByAccess(allProfiles, req.user);

      let mergedFeatures = null;
      if (profileId) {
        const match = findProfileMatch(accessible, profileId);
        if (match?.features) mergedFeatures = match.features;
      }
      if (!mergedFeatures && accessible.length === 1 && accessible[0]?.features) {
        mergedFeatures = accessible[0].features;
      }
      if (!mergedFeatures && accessible.length > 1) {
        mergedFeatures = {};
        for (const p of accessible) {
          if (!p.features) continue;
          for (const [k, v] of Object.entries(p.features)) {
            if (v === true) mergedFeatures[k] = true;
            else if (!(k in mergedFeatures)) mergedFeatures[k] = v;
          }
        }
      }

      let mergedToolConfig = null;
      if (profileId) {
        const match = findProfileMatch(accessible, profileId);
        if (match?.toolConfig) mergedToolConfig = match.toolConfig;
      }
      if (!mergedToolConfig && accessible.length >= 1) mergedToolConfig = accessible[0]?.toolConfig || null;

      const requiredCrs = await collectRequiredCrsForProfiles(accessible);

      let config = await buildQwc2Config({
        hasMultipleThemes: accessible.length > 1,
        features: mergedFeatures,
        toolConfig: mergedToolConfig,
        requiredCrs
      });

      // Final sanitation
      config = config || {};
      config.searchServiceUrl = '/Qtiler2Origo/search';
      config.searchDataServiceUrl = '';
      if (typeof config.editServiceUrl !== 'string' || !config.editServiceUrl.trim()) config.editServiceUrl = '/wfs';
      if (typeof config.mapInfoServiceUrl !== 'string' || !config.mapInfoServiceUrl.trim()) config.mapInfoServiceUrl = '/wms';
      config.permalinkServiceUrl = '';
      config.elevationServiceUrl = '';
      config.featureReportService = '';
      config.documentServiceUrl = '';
      const authActive = typeof security?.isEnabled === 'function' ? security.isEnabled() : false;
      config.authServiceUrl = authActive ? '/auth/' : '';
      for (const section of ['common', 'mobile', 'desktop']) {
        const plugins = config.plugins?.[section];
        if (!Array.isArray(plugins)) continue;
        for (const p of plugins) {
          if (!p || !p.cfg) continue;
          if (typeof p.cfg.catalogUrl === 'string') p.cfg.catalogUrl = '';
          if (p.name === 'Editing' && (typeof p.cfg.serviceUrl !== 'string' || !p.cfg.serviceUrl.trim())) p.cfg.serviceUrl = '/wfs';
          if (p.name === 'Identify' && (typeof p.cfg.serviceUrl !== 'string' || !p.cfg.serviceUrl.trim())) p.cfg.serviceUrl = '/wms';
          if (!['Authentication', 'Identify', 'Editing', 'FeatureForm'].includes(p.name) && typeof p.cfg.serviceUrl === 'string') p.cfg.serviceUrl = '';
          if (typeof p.cfg.permalinkUrl === 'string') p.cfg.permalinkUrl = '';
          if (typeof p.cfg.tileInfoServiceUrl === 'string') p.cfg.tileInfoServiceUrl = '';
          if (typeof p.cfg.importedTilesBaseUrl === 'string') p.cfg.importedTilesBaseUrl = '';
        }
      }
      config.backgroundLayers = [];
      config.defaultBackgroundLayers = [];
      return res.json(config);
    } catch (e) {
      // fallback to on-disk sanitized config
      try {
        const webRoot = await resolveQwc2WebRoot().catch(() => '');
        if (!webRoot) return res.status(500).json({ error: 'origo_config_failed' });
        const raw = await fs.promises.readFile(path.join(webRoot, 'config.json'), 'utf8');
        let base = {};
        try { base = JSON.parse(raw); } catch { base = {}; }
        base.searchServiceUrl = '/Qtiler2Origo/search';
        base.searchDataServiceUrl = '';
        if (typeof base.editServiceUrl !== 'string' || !base.editServiceUrl.trim()) base.editServiceUrl = '/wfs';
        if (typeof base.mapInfoServiceUrl !== 'string' || !base.mapInfoServiceUrl.trim()) base.mapInfoServiceUrl = '/wms';
        base.permalinkServiceUrl = '';
        base.elevationServiceUrl = '';
        base.featureReportService = '';
        base.documentServiceUrl = '';
        const authActive = typeof security?.isEnabled === 'function' ? security.isEnabled() : false;
        base.authServiceUrl = authActive ? '/auth/' : '';
        for (const section of ['common', 'mobile', 'desktop']) {
          const plugins = base.plugins?.[section];
          if (!Array.isArray(plugins)) continue;
          for (const p of plugins) {
            if (!p || !p.cfg) continue;
            if (typeof p.cfg.catalogUrl === 'string') p.cfg.catalogUrl = '';
            if (p.name === 'Editing' && (typeof p.cfg.serviceUrl !== 'string' || !p.cfg.serviceUrl.trim())) p.cfg.serviceUrl = '/wfs';
            if (p.name === 'Identify' && (typeof p.cfg.serviceUrl !== 'string' || !p.cfg.serviceUrl.trim())) p.cfg.serviceUrl = '/wms';
            if (!['Authentication', 'Identify', 'Editing', 'FeatureForm'].includes(p.name) && typeof p.cfg.serviceUrl === 'string') p.cfg.serviceUrl = '';
            if (typeof p.cfg.permalinkUrl === 'string') p.cfg.permalinkUrl = '';
            if (typeof p.cfg.tileInfoServiceUrl === 'string') p.cfg.tileInfoServiceUrl = '';
            if (typeof p.cfg.importedTilesBaseUrl === 'string') p.cfg.importedTilesBaseUrl = '';
          }
        }
        base.backgroundLayers = [];
        base.defaultBackgroundLayers = [];
        return res.json(base);
      } catch (ee) {
        return res.status(500).json({ error: 'origo_config_failed' });
      }
    }
  });

  app.get(`/plugins/${pluginSlug}/origo/themes.json`, async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      const profileId = profileFromReferer(req) || req.query?.qtiler_profile;
      const allProfiles = await readAllPublishedProfiles();
      let accessible = filterProfilesByAccess(allProfiles, req.user);
      const selectedProfile = profileId ? findProfileMatch(accessible, profileId) : null;
      if (profileId) {
        const match = filterProfilesByToken(accessible, profileId);
        if (match.length) accessible = match;
      }
      if (accessible.length === 0) {
        return res.json({ themes: { title: 'root', subdirs: [], items: [], backgroundLayers: [] } });
      }
      const qtilerBaseUrl = getRequestBaseUrl(req);
      const themes = await buildQwc2Themes(accessible, qtilerBaseUrl, { defaultTheme: selectedProfile?.projectId || null });
      return res.json(normalizeThemesForQwc2Assets(themes));
    } catch(err) { console.error('XERR', err);
      try {
        const webRoot = await resolveQwc2WebRoot().catch(()=>'');
        if (webRoot) return sendRebasedJsonFile(res, path.join(webRoot, 'themes.json'), getRequestBaseUrl(req));
      } catch {}
      return res.status(500).json({ error: 'origo_themes_failed' });
    }
  });

  // ── Preview page: serves a minimal Origo HTML page loading a per-project config ──
  app.get(`/plugins/${pluginSlug}/api/preview-page`, async (req, res) => {
    const { stateId, payload } = await resolvePreviewRequestPayload(req);
    const projectId = sanitizeFileToken(String(payload.project || '').trim());
    if (!projectId) return res.status(400).json({ error: 'missing_project' });
    const webRoot = await resolveQwc2WebRoot().catch(() => '');
    if (!webRoot) return res.status(503).json({ error: 'origo_not_installed' });
    const layers = String(payload.layers || '').trim();
    const bgProject = String(payload.bgProject || '').trim();
    const bgLayer = String(payload.bgLayer || '').trim();
    // Use absolute URL for config so the <base> tag does not interfere
    const baseUrl = getRequestBaseUrl(req);
    const cfgParams = stateId
      ? [
          `state=${encodeURIComponent(stateId)}`,
          `project=${encodeURIComponent(payload.project || '')}`
        ]
      : [
          `project=${encodeURIComponent(payload.project || '')}`,
          layers ? `layers=${encodeURIComponent(layers)}` : '',
          String(payload.groups || '').trim() ? `groups=${encodeURIComponent(payload.groups)}` : '',
          String(payload.layerRules || '').trim() ? `layerRules=${encodeURIComponent(payload.layerRules)}` : '',
          bgProject ? `bgProject=${encodeURIComponent(bgProject)}` : '',
          bgLayer ? `bgLayer=${encodeURIComponent(bgLayer)}` : '',
          payload.bgKey ? `bgKey=${encodeURIComponent(payload.bgKey)}` : '',
          payload.center ? `center=${encodeURIComponent(payload.center)}` : '',
          payload.centerCrs ? `centerCrs=${encodeURIComponent(payload.centerCrs)}` : '',
          payload.zoom ? `zoom=${encodeURIComponent(payload.zoom)}` : '',
          payload.extent ? `extent=${encodeURIComponent(payload.extent)}` : '',
          payload.minZoom ? `minZoom=${encodeURIComponent(payload.minZoom)}` : '',
          payload.maxZoom ? `maxZoom=${encodeURIComponent(payload.maxZoom)}` : '',
          payload.controls ? `controls=${encodeURIComponent(payload.controls)}` : ''
        ];
    const cfgQs = cfgParams.filter(Boolean).join('&');
    const configUrl = `${baseUrl}/plugins/${pluginSlug}/api/preview-config.json?${cfgQs}`;
    // <base> tag makes all relative paths (SVG, img, etc.) resolve from the Origo build root
    const base = `/plugins/${pluginSlug}/origo/`;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<base href="${base}">
<title>Preview \u2013 ${projectId.replace(/[<>"&']/g, '')}</title>
<link href="css/style.css" rel="stylesheet">
<link href="/plugins/${pluginSlug}/origo-controls/lantmateri-search.css" rel="stylesheet">
<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}#app-wrapper{width:100%;height:100%}${origoLegendIconCss}</style>
</head>
<body>
<div id="app-wrapper"></div>
<script src="js/origo.js"></script>
<script>
  console.log('[DEBUG] Inline script executed');
  (function(window) {
    console.log('[DEBUG] Inside IIFE');
    
    function LantmateriSearch(options) {
      console.log('[DEBUG] LantmateriSearch constructor called');
      options = options || {};
      
      return {
        onInit: function(viewerInstance) {
          console.log('[DEBUG] LantmateriSearch onInit called');
        },
        render: function() {
          console.log('[DEBUG] LantmateriSearch render called');
          return document.createElement('div');
        }
      };
    }
    
    window.LantmateriSearch = LantmateriSearch;
    console.log('[DEBUG] LantmateriSearch registered to window');
  })(window);
</script>
<script src="/plugins/${pluginSlug}/client/origo-pattern-fills.js"></script>
<script>
  function notifyParent(type, message) {
    try { window.parent.postMessage({ type: type, message: message }, '*'); } catch (e) {}
  }
  function stringifyErrorDetail(detail, fallback) {
    if (detail == null || detail === '') return fallback;
    if (typeof detail === 'string') return detail;
    try { return JSON.stringify(detail); } catch (e) { return String(detail); }
  }
  window.addEventListener('error', function(ev) {
    notifyParent('origo-error', stringifyErrorDetail(ev && (ev.message || ev.error), 'Runtime error while loading Interactive Map.'));
  });
  window.addEventListener('unhandledrejection', function(ev) {
    var reason = ev && ev.reason;
    notifyParent('origo-error', stringifyErrorDetail(reason && (reason.message || reason.error || reason), 'Unhandled promise rejection while loading Interactive Map.'));
  });
  // IMPORTANT: do NOT pass the config URL to Origo() directly. Origo's
  // loadResources() appends "${'$'}{urlParams.map}.json" to any URL it receives;
  // if the URL has no "#map=..." fragment, urlParams.map is undefined and
  // the resulting fetch becomes ".../preview-config.json?...&bgLayer=NAME/undefined.json"
  // which corrupts query params (Express then sees bgLayer with "/undefined.json"
  // appended). Fetch the JSON ourselves and pass the parsed object instead.
  fetch(${JSON.stringify(configUrl)}, { credentials: 'same-origin' })
    .then(function(r) {
      if (!r.ok) {
        return r.text().then(function(text) {
          throw new Error(text || ('Preview config failed (' + r.status + ')'));
        });
      }
      return r.json().then(function(cfg) {
        if (cfg && typeof cfg === 'object' && (cfg.error || cfg.details || cfg.message)) {
          throw new Error(cfg.error || cfg.details || cfg.message);
        }
        return cfg;
      });
    })
    .then(function(cfg) {
      return window.Qtiler2OrigoOrigoBoot.bootOrigo(cfg);
    })
    .then(function(origoApp) {
      window.origoApp = origoApp;
      var refreshMapSize = function() {
        try {
          var viewer = typeof origoApp.api === 'function' ? origoApp.api() : null;
          var map = viewer && typeof viewer.getMap === 'function' ? viewer.getMap() : null;
          if (map && typeof map.updateSize === 'function') map.updateSize();
        } catch (e) {}
      };
      requestAnimationFrame(function() {
        requestAnimationFrame(refreshMapSize);
      });
      window.addEventListener('resize', refreshMapSize);
      try {
        var ro = new ResizeObserver(function() { refreshMapSize(); });
        ro.observe(document.documentElement);
        ro.observe(document.body);
        ro.observe(document.getElementById('app-wrapper'));
      } catch (e) {}
      origoApp.on('load', function() {
        refreshMapSize();
        try { window.parent.postMessage({ type: 'origo-loaded' }, '*'); } catch(e){}
      });
    })
    .catch(function(err) {
      var detail = stringifyErrorDetail(err && (err.message || err), 'Failed to load preview config.');
      notifyParent('origo-error', detail);
      document.body.innerHTML = '<pre style="padding:1em;color:#b00;white-space:pre-wrap">Failed to load preview config: ' + detail.replace(/[&<>]/g, function(ch) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]; }) + '</pre>';
    });
</script>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  });

  app.post(`/plugins/${pluginSlug}/api/preview-state`, express.json({ limit: '2mb' }), async (req, res) => {
    const payload = normalizePreviewStatePayload(req.body);
    if (!payload.project) return res.status(400).json({ error: 'missing_project' });
    const stateId = createPreviewStateId();
    if (previewStateStore) {
      await previewStateStore.update((draft) => {
        const current = draft && typeof draft === 'object' ? draft : {};
        const cutoff = Date.now() - PREVIEW_STATE_TTL_MS;
        for (const [key, value] of Object.entries(current)) {
          if (!value || !Number.isFinite(value.createdAt) || value.createdAt < cutoff) {
            delete current[key];
          }
        }
        current[stateId] = { createdAt: Date.now(), payload };
        return current;
      });
    }
      const previewParams = [
        `state=${encodeURIComponent(stateId)}`,
        `project=${encodeURIComponent(payload.project || '')}`
      ].join('&');
    return res.json({
      state: stateId,
      url: `/plugins/${pluginSlug}/api/preview-page?${previewParams}`
    });
  });

  /**
   * Compute a valid projectionExtent and explicit resolutions for a given CRS.
   * For EPSG:3857/4326, OL knows the defaults. For any other CRS, the extent
   * must match the projection or OL's TileGrid will calculate null resolutions
   * (throwing "Cannot read properties of null (reading 'every')").
   */
  const computeProjectionConfig = (projCode, nativeExtent) => {
    if (!projCode || projCode === 'EPSG:3857') {
      // Standard Web Mercator resolution pyramid (256px tiles, level 0..21).
      // Origo's TileGrid constructor calls resolutions.every(...) when building
      // the default tile grid for WMS layers — passing null crashes the viewer
      // with "Cannot read properties of null (reading 'every')".
      const r0 = 156543.03392804097;
      const resolutions = [];
      for (let i = 0; i <= 21; i++) resolutions.push(r0 / (2 ** i));
      return { projectionExtent: [-20026376.39, -20048966.10, 20026376.39, 20048966.10], resolutions };
    }
    if (projCode === 'EPSG:4326') {
      // Equivalent default pyramid for plate carrée (degrees per pixel).
      const r0 = 0.703125;
      const resolutions = [];
      for (let i = 0; i <= 21; i++) resolutions.push(r0 / (2 ** i));
      return { projectionExtent: [-180, -90, 180, 90], resolutions };
    }
    // Custom CRS: pad the native extent to give the tile grid room, then derive
    // explicit resolutions so Origo never calls createForProjection with an
    // extent that doesn't match the registered proj4 definition.
    const [minx, miny, maxx, maxy] = nativeExtent;
    const padX = Math.max((maxx - minx) * 50.0, 1000);
    const padY = Math.max((maxy - miny) * 50.0, 1000);
    const projectionExtent = [
      Math.round(minx - padX), Math.round(miny - padY),
      Math.round(maxx + padX), Math.round(maxy + padY)
    ];
    const maxDim = Math.max(projectionExtent[2] - projectionExtent[0], projectionExtent[3] - projectionExtent[1]);
    let r0 = 1;
    while (r0 * 256 < maxDim) r0 *= 2;
    const resolutions = [];
    for (let i = 0; i < 18; i++) resolutions.push(r0 / (2 ** i));
    return { projectionExtent, resolutions };
  };

  // ── Load tile grid data for a given project (used to build WMTS source) ──
  const loadTileGridForProject = async (projectId) => {
    try {
      const normalizePreset = (preset, fallbackId = '') => {
        if (!preset || typeof preset !== 'object') return null;
        const matrices = Array.isArray(preset.matrices) ? preset.matrices : [];
        if (!matrices.length) return null;
        const sorted = [...matrices].sort((a, b) => Number(a.z ?? a.id ?? 0) - Number(b.z ?? b.id ?? 0));
        const resolutions = sorted.map((m) => Number(m.resolution)).filter(Number.isFinite);
        if (!resolutions.length) return null;
        const matrixIds = sorted.map((m) => String(m.identifier ?? m.id ?? m.z));
        const topLeft = Array.isArray(preset.topLeftCorner) ? preset.topLeftCorner
          : Array.isArray(preset.top_left_corner) ? preset.top_left_corner : null;
        const tileSize = Number(preset.tile_width || preset.tile_size || 256);
        const matrixSetId = String(preset.id || preset.identifier || fallbackId || '').replace(/\.json$/i, '');
        const crs = (Array.isArray(preset.supported_crs) ? preset.supported_crs[0] : null) || preset.coordinateReferenceSystem || null;
        // Compute the projectionExtent that matches the WMTS pyramid, derived
        // from the FIRST matrix's matrix_width x matrix_height. This must be
        // exactly what Origo/OL expects so backgrounds align with overlays.
        let projectionExtent = null;
        if (Array.isArray(topLeft) && sorted.length > 0) {
          const m0 = sorted[0];
          const mw = Number(m0?.matrix_width || m0?.matrixWidth || 1);
          const mh = Number(m0?.matrix_height || m0?.matrixHeight || 1);
          const r0 = Number(m0?.resolution);
          if (Number.isFinite(r0)) {
            const tw = Number(m0?.tileWidth || tileSize);
            const th = Number(m0?.tileHeight || tileSize);
            projectionExtent = [
              topLeft[0],
              topLeft[1] - mh * th * r0,
              topLeft[0] + mw * tw * r0,
              topLeft[1]
            ];
          }
        }
        return { matrixSetId, resolutions, matrixIds, topLeft, tileSize, crs, projectionExtent };
      };

      const cacheIndex = await readCacheIndex(projectId);
      const cachedLayers = Array.isArray(cacheIndex?.layers) ? cacheIndex.layers : [];
      const cachedGridLayer = cachedLayers.find((layer) => {
        const preset = layer?.tile_matrix_set || layer?.tileMatrixSet || null;
        return preset && typeof preset === 'object' && Array.isArray(preset.matrices) && preset.matrices.length > 0;
      });
      const cachedPreset = cachedGridLayer?.tile_matrix_set || cachedGridLayer?.tileMatrixSet || null;
      const fromCache = normalizePreset(cachedPreset, cachedGridLayer?.tile_matrix_preset || cachedGridLayer?.tileMatrixPreset || '');
      if (fromCache) return fromCache;

      const tileGridDirCandidates = [
        resolveRepoPath('config', 'tile-grids'),
        path.resolve(process.cwd(), 'config', 'tile-grids')
      ];
      const tileGridDir = tileGridDirCandidates.find((dir) => fs.existsSync(dir));
      if (!tileGridDir) return null;
      const files = await fs.promises.readdir(tileGridDir);
      const normalizedProjectId = normalizeProjectId(projectId || '') || String(projectId || '').trim();
      const safeProjectId = sanitizeFileToken(normalizedProjectId);
      const candidateNames = new Set([
        String(projectId || '').trim().toLowerCase(),
        normalizedProjectId.toLowerCase(),
        safeProjectId.toLowerCase()
      ].filter(Boolean));
      // File naming convention: SCALES_EPSG_XXXX_<projectId>.json
      const match = files.find((f) => {
        const lower = f.toLowerCase();
        for (const candidate of candidateNames) {
          if (lower === `scales_epsg_3006_${candidate}.json`) return true;
          if (lower.endsWith(`_${candidate}.json`)) return true;
        }
        return false;
      });
      if (!match) return null;
      const raw = await fs.promises.readFile(path.join(tileGridDir, match), 'utf8');
      const preset = JSON.parse(raw);
      return normalizePreset(preset, match);
    } catch (err) {
      console.warn(`[Qtiler2Origo] Failed to load tile grid for project "${projectId}":`, err?.message || err);
      return null;
    }
  };

  // ── buildOrigoIndexConfig: build Origo index.json from a published profile ──
  // Walk an Origo style array and rewrite icon.src URLs that point to
  // /qgis-svg/* to use the colorizer endpoint when an icon.color is set.
  // This is needed because OL Icon `color` doesn't tint SVGs whose paths
  // already have explicit fill attributes.
  const normalizeOrigoIconStyle = (icon) => {
    if (!icon || typeof icon !== 'object') return icon;
    const out = { ...icon };
    const src = String(out.src || '').trim();
    if (/\.svg(?:\?|$)/i.test(src) && !Array.isArray(out.imgSize)) {
      out.imgSize = [480, 480];
    }
    if (out.scale != null) {
      const scale = Number(out.scale);
      if (Number.isFinite(scale) && scale > 0) out.scale = scale;
      else delete out.scale;
    }
    return out;
  };

  const rewriteSvgIconColors = (style) => {
    try {
      const cloned = JSON.parse(JSON.stringify(style));
      const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(visit); return; }
        if (node.icon && typeof node.icon === 'object'
            && typeof node.icon.src === 'string'
            && (node.icon.src.startsWith('/qgis-svg/') || node.icon.src.startsWith('/qtiler-symbology-svg/'))) {
          const m = (typeof node.icon.color === 'string') ? /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(node.icon.color.trim()) : null;
          const colored = node.icon.src.startsWith('/qtiler-symbology-svg/')
            ? node.icon.src.replace(/^\/qtiler-symbology-svg\//, '/qtiler-symbology-svg-colored/')
            : node.icon.src.replace(/^\/qgis-svg\//, '/qgis-svg-colored/');
          if (m) {
            node.icon.src = `${colored}?color=${encodeURIComponent('#' + m[1])}`;
          } else {
            node.icon.src = colored;
          }
        }
        if (node.icon && typeof node.icon === 'object') {
          node.icon = normalizeOrigoIconStyle(node.icon);
        }
        for (const k of Object.keys(node)) visit(node[k]);
      };
      visit(cloned);
      return cloned;
    } catch { return style; }
  };

  const resolveManualWmsLegendUrl = (layer, fallbackUrl = '') => {
    if (!layer || typeof layer !== 'object') return fallbackUrl || '';
    const mode = String(layer.wmsLegendMode || 'auto').trim().toLowerCase();
    const raw = String(layer.wmsLegendUrl || layer.wmsLegendIcon || layer.legendIcon || '').trim();
    if (['manual', 'svg', 'library'].includes(mode) && raw) return raw;
    return fallbackUrl || '';
  };

  const buildManualWmsLegendIconUrl = (rawUrl, baseUrl) => {
    const raw = String(rawUrl || '').trim();
    if (!raw) return '';
    if (raw.startsWith('/plugins/') || raw.startsWith('/qgis-svg') || raw.startsWith('/qtiler-symbology')) return raw;
    return `${baseUrl}/plugins/${pluginSlug}/api/legend-icon?src=${encodeURIComponent(raw)}`;
  };

  const buildWmsLegendGraphicUrl = (baseUrl, projectId, layerName) => {
    const pid = normalizeProjectId(projectId || '') || String(projectId || '').trim();
    const name = String(layerName || '').trim();
    if (!baseUrl || !pid || !name) return '';
    return `${baseUrl}/plugins/${pluginSlug}/api/thumbnail/${encodeURIComponent(pid)}?LAYERS=${encodeURIComponent(name)}&LEGEND=1`;
  };

  const origoLegendIconCss = `
.o-map .legend-icon img,
.o-map .legend-icon img.cover,
.o-map img.extendedlegend {
  object-fit: contain !important;
  object-position: left center;
  width: 100%;
  height: 100%;
}
`;

  const normalizeInfoclickAttributes = (attrs) => {
    return (Array.isArray(attrs) ? attrs : [])
      .map((attr) => {
        if (!attr || typeof attr !== 'object') return null;
        const rawHtml = attr.html == null ? '' : String(attr.html);
        if (rawHtml.trim()) {
          return {
            ...attr,
            html: rawHtml
          };
        }
        const name = String(attr.name || '').trim();
        if (!name) return null;
        const rawTitle = attr.title == null ? '' : String(attr.title);
        return {
          ...attr,
          name,
          title: rawTitle.trim() ? rawTitle : `${name}: `
        };
      })
      .filter(Boolean);
  };

  const shouldUseWfsForPublishedLayer = (layerLike, fallbackEditable = false) => {
    if (!layerLike || typeof layerLike !== 'object') return fallbackEditable === true;
    if (layerLike.serveAsWfs === true) return true;
    if (layerLike.serveAsWfs === false) return false;
    return layerLike.editable === true || fallbackEditable === true;
  };

  // Fetch WFS DescribeFeatureType and parse attributes, geometry column and
  // target namespace. Mirrors what Qrigo does on the client so Origo's editor
  // has everything it needs: attributes (filterable list), geometryName (used
  // by WFS-T POST body) and featureNS (used as `workspace` on the source).
  const fetchWfsLayerMeta = async (baseUrl, projectId, typeName, authHeaders = {}) => {
    // QGIS Server defaults: namespace and prefix used as fallback when
    // DescribeFeatureType cannot be read (e.g. auth blocks our internal fetch).
    // OpenLayers WFS-T writeTransaction requires these to build the body;
    // without them it crashes with `undefined.geometry`.
    const fallback = { attributes: [], geometryName: 'geometry', featureNS: 'http://www.qgis.org/gml' };
    try {
      const url = `${baseUrl}/wfs?project=${encodeURIComponent(projectId)}`
        + `&service=WFS&version=1.1.0&request=DescribeFeatureType`
        + `&typeName=${encodeURIComponent(typeName)}`;
      const r = await fetch(url, { headers: authHeaders });
      if (!r.ok) {
        console.warn(`[Qtiler2Origo] DescribeFeatureType ${r.status} for ${typeName} on project ${projectId}. Editor will use fallback attribute. URL=${url}`);
        return fallback;
      }
      const xml = await r.text();
      const meta = { ...fallback };
      const nsMatch = xml.match(/targetNamespace="([^"]+)"/);
      if (nsMatch) meta.featureNS = nsMatch[1];
      // Geometry column: element whose type starts with gml:
      const geomMatch = xml.match(/<(?:xsd|xs):element\s+[^>]*name="([^"]+)"[^>]*type="gml:[^"]+"/);
      if (geomMatch) meta.geometryName = geomMatch[1];
      // Attributes: every element whose type does NOT start with gml:
      const attrRe = /<(?:xsd|xs):element\s+([^>]+)\/?>/g;
      const attrs = [];
      let m;
      while ((m = attrRe.exec(xml)) !== null) {
        const attrs2 = m[1];
        const nameM = attrs2.match(/name="([^"]+)"/);
        const typeM = attrs2.match(/type="([^"]+)"/);
        if (!nameM || !typeM) continue;
        if (typeM[1].startsWith('gml:')) continue;
        const t = typeM[1].toLowerCase();
        let origoType = 'text';
        if (t.includes('int') || t.includes('long') || t.includes('short')) origoType = 'text';
        else if (t.includes('decimal') || t.includes('double') || t.includes('float')) origoType = 'text';
        else if (t.includes('bool')) origoType = 'checkbox';
        else if (t.includes('date')) origoType = 'date';
        attrs.push({ name: nameM[1], title: nameM[1], type: origoType });
      }
      meta.attributes = attrs;
      if (!attrs.length) {
        console.warn(`[Qtiler2Origo] DescribeFeatureType for ${typeName} returned 0 attributes. XML snippet: ${xml.substring(0, 200)}`);
      }
      return meta;
    } catch (err) {
      console.warn(`[Qtiler2Origo] DescribeFeatureType fetch failed for ${typeName}: ${err?.message || err}`);
      return fallback;
    }
  };

  const unwrapPrimaryStyleRule = (styleDef) => {
    if (!Array.isArray(styleDef) || !Array.isArray(styleDef[0]) || !styleDef[0][0] || typeof styleDef[0][0] !== 'object') {
      return null;
    }
    return styleDef[0][0];
  };

  const extractRuntimePatternStyle = (styleDef, layer) => {
    const rawPattern = String(layer?.designerOptions?.fillPattern || '').trim().toLowerCase();
    const pattern = rawPattern === 'diagonal' ? 'slash' : rawPattern;
    if (!['slash', 'backslash', 'horizontal', 'vertical', 'cross', 'dots'].includes(pattern)) return null;
    const geometryType = String(layer?.geometryType || '').trim().toLowerCase();
    if (geometryType && !geometryType.includes('polygon')) return null;
    if (!Array.isArray(styleDef) || styleDef.length !== 1 || !Array.isArray(styleDef[0]) || styleDef[0].length !== 1) return null;
    const rule = unwrapPrimaryStyleRule(styleDef);
    if (!rule || rule.filter || rule.circle || rule.icon || rule.regularShape || !rule.stroke) return null;
    const defaultAngle = pattern === 'backslash'
      ? 135
      : pattern === 'horizontal'
        ? 0
        : pattern === 'vertical'
          ? 90
          : 45;
    return {
      pattern,
      fillColor: String(rule?.fill?.color || 'rgba(59, 130, 246, 0.25)'),
      strokeColor: String(rule?.stroke?.color || 'rgba(37, 99, 235, 1)'),
      strokeWidth: Number(rule?.stroke?.width || 1),
      lineDash: Array.isArray(rule?.stroke?.lineDash) ? rule.stroke.lineDash.map(Number).filter(Number.isFinite) : [],
      angle: Number.isFinite(Number(layer?.designerOptions?.fillPatternAngle)) ? Number(layer.designerOptions.fillPatternAngle) : defaultAngle,
      spacing: Number.isFinite(Number(layer?.designerOptions?.fillPatternSpacing)) ? Number(layer.designerOptions.fillPatternSpacing) : 10,
      size: Number.isFinite(Number(layer?.designerOptions?.fillPatternSize)) ? Number(layer.designerOptions.fillPatternSize) : 2.5,
      transparentBackground: layer?.designerOptions?.fillPatternTransparent === true
    };
  };

  const buildOrigoIndexConfig = async (profile, baseUrl, req = null) => {
    // Forward caller's auth (cookie + api_key) so server-to-server fetch to
    // /wfs DescribeFeatureType isn't rejected with 401.
    const authHeaders = {};
    if (req?.headers?.cookie) authHeaders.cookie = req.headers.cookie;
    const apiKey = req?.headers?.['x-api-key'] || req?.query?.api_key;
    if (apiKey) authHeaders['x-api-key'] = apiKey;
    const projectId = profile.projectId;

    const bgProjectId = profile.backgroundProjectId || null;
    const bgTileGrid = bgProjectId ? await loadTileGridForProject(bgProjectId) : null;

    // Get native extent/CRS from cache (prefer background project if using WMTS backgrounds to align grids)
    let center = [0, 0];
    let zoom = 5;
    let projCode = 'EPSG:3857';
    let extent = [-20026376.39, -20048966.10, 20026376.39, 20048966.10];
    let nativeExtent = extent;
    let baseExtInfo = null;

    try {
      if (bgProjectId) baseExtInfo = await getProjectExtent(bgProjectId);
      if (!baseExtInfo || !baseExtInfo.native) baseExtInfo = await getProjectExtent(projectId);
      
      if (baseExtInfo?.native?.length === 4) {
        const [minx, miny, maxx, maxy] = baseExtInfo.native;
        nativeExtent = baseExtInfo.native;
        extent = baseExtInfo.native;
        center = [Math.round((minx + maxx) / 2), Math.round((miny + maxy) / 2)];
        projCode = baseExtInfo.crs || 'EPSG:3857';
      }
    } catch { /* use defaults */ }

    // Override with admin-captured view — but ignore values that fall outside
    // the active projection extent (happens when the profile was saved with a
    // different background CRS than the one currently in use; the stale coords
    // would otherwise push the published map to the North Pole or off-screen).
    const _inExt = (pt, ex) => Array.isArray(pt) && Array.isArray(ex)
      && pt[0] >= ex[0] && pt[0] <= ex[2] && pt[1] >= ex[1] && pt[1] <= ex[3];
    const capturedCrs = String(profile.centerCrs || '').trim().toUpperCase();
    const capturedCrsOk = !capturedCrs || capturedCrs === String(projCode || '').trim().toUpperCase();
    if (Array.isArray(profile.center) && profile.center.length === 2
      && capturedCrsOk
      && (!Array.isArray(extent) || extent.length !== 4 || _inExt(profile.center, extent))) {
      center = profile.center;
    }
    if (capturedCrsOk && typeof profile.zoom === 'number') zoom = profile.zoom;
    if (Array.isArray(profile.extent) && profile.extent.length === 4
      && capturedCrsOk
      && (!Array.isArray(extent) || extent.length !== 4
        || (_inExt([profile.extent[0], profile.extent[1]], extent)
          && _inExt([profile.extent[2], profile.extent[3]], extent)))) {
      extent = profile.extent;
    }

    // Proj4 definitions for non-standard CRS
    const proj4Defs = buildProj4Defs(projCode, 'EPSG:3857', 'EPSG:4326');

    // Source map
    const source = {};
    const getWmsSourceKey = (pid) => `qtiler_wms_${String(pid || '').replace(/[^A-Za-z0-9_]/g, '_') || 'main'}`;
    const ensureWmsSource = (pid) => {
      const normalizedProjectId = normalizeProjectId(pid || projectId) || projectId;
      const sourceKey = getWmsSourceKey(normalizedProjectId);
      if (!source[sourceKey]) {
        source[sourceKey] = {
          url: `${baseUrl}/plugins/${pluginSlug}/wms?project=${encodeURIComponent(normalizedProjectId)}`,
          projection: projCode
        };
      }
      return sourceKey;
    };
    const mainSourceKey = ensureWmsSource(projectId);
    source['osm'] = { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' };
    // NOTE: No shared WMS source for background — each BG layer gets its own WMTS source

    // Groups: accept both legacy flat `parent` entries and nested `groups` arrays.
    // Build a nested groups array where each group may contain a `groups` array of children,
    // which is the structure Origo expects (e.g. a group with subgroups).
    const groups = [{ name: 'background', title: 'Background', expanded: false, exclusive: true }];
    if (Array.isArray(profile.groups) && profile.groups.length) {
      // First, build a map of group definitions and parent links
      const byName = new Map();
      const parentOf = new Map();

      const ensureEntry = (g) => {
        const name = String(g?.name || '').trim();
        if (!name) return null;
        if (!byName.has(name)) {
          byName.set(name, { name, title: String(g?.title || name), expanded: g?.expanded !== false, groups: [] });
        } else {
          const cur = byName.get(name);
          cur.title = String(g?.title || cur.title || name);
          cur.expanded = g?.expanded !== false;
        }
        return byName.get(name);
      };

      for (const g of profile.groups) {
        const name = String(g?.name || '').trim();
        if (!name || name === 'root' || name === 'background') continue;
        ensureEntry(g);
        // If this group already contains nested `groups`, register parent links
        if (Array.isArray(g.groups) && g.groups.length) {
          for (const child of g.groups) {
            const childName = String(child?.name || '').trim();
            if (!childName) continue;
            ensureEntry(child);
            parentOf.set(childName, name);
          }
        }
        // If legacy `parent` is present, record it
        if (g.parent) {
          const parentName = String(g.parent || '').trim();
          if (parentName) parentOf.set(name, parentName);
        }
      }

      // Attach children to their parents
      for (const [childName, parentName] of parentOf.entries()) {
        const parent = byName.get(parentName);
        const child = byName.get(childName);
        if (!parent || !child) continue;
        if (!Array.isArray(parent.groups)) parent.groups = [];
        // avoid duplicates
        if (!parent.groups.some((g) => g.name === child.name)) parent.groups.push(child);
      }

      // Determine top-level groups preserving original order where possible
      const added = new Set(['background']);
      for (const g of profile.groups) {
        const name = String(g?.name || '').trim();
        if (!name || name === 'root' || name === 'background') continue;
        if (parentOf.has(name)) continue; // child, will be included under its parent
        if (added.has(name)) continue;
        const entry = byName.get(name) || { name, title: name, expanded: true, groups: [] };
        groups.push(entry);
        added.add(name);
      }
    }

    // Auto-create any group referenced by a layer but missing from the groups
    // list, so Origo's layer tree can show it instead of silently dropping
    // the layer. Runs unconditionally (not only when profile.groups exists).
    {
      const knownGroupNames = new Set();
      const collectNames = (list) => {
        for (const g of list) {
          knownGroupNames.add(g.name);
          if (Array.isArray(g.groups) && g.groups.length) collectNames(g.groups);
        }
      };
      collectNames(groups);
      for (const layer of (profile.layers || [])) {
        const gn = String(layer?.group || '').trim();
        if (gn && gn !== 'root' && gn !== 'background' && !knownGroupNames.has(gn)) {
          groups.push({ name: gn, title: gn, expanded: true, groups: [] });
          knownGroupNames.add(gn);
        }
      }
    }

    // Prune groups that end up with no layers anywhere in their subtree (e.g.
    // an empty placeholder group created in the admin UI but never assigned
    // any layer or nested under another group) so they don't show up as a
    // stray/empty entry in the published legend/layer tree.
    {
      const usedGroupNames = new Set(
        (profile.layers || [])
          .map((layer) => String(layer?.group || '').trim())
          .filter((name) => name && name !== 'root' && name !== 'background')
      );
      const pruneEmpty = (list) => list
        .map((g) => {
          if (Array.isArray(g.groups) && g.groups.length) {
            g.groups = pruneEmpty(g.groups);
          }
          return g;
        })
        .filter((g) => g.name === 'background' || usedGroupNames.has(g.name) || (Array.isArray(g.groups) && g.groups.length));
      const pruned = pruneEmpty(groups);
      groups.length = 0;
      groups.push(...pruned);
    }

    // Layers and Styles
    const layers = [];
    const origoStyles = {};
    const qtilerPatternStyles = {};
    const cacheLayersByProject = new Map();
    const getCachedLayersForProject = async (pid) => {
      const normalizedProjectId = normalizeProjectId(pid || projectId) || projectId;
      if (!cacheLayersByProject.has(normalizedProjectId)) {
        const cacheIndex = await readCacheIndex(normalizedProjectId);
        cacheLayersByProject.set(normalizedProjectId, Array.isArray(cacheIndex?.layers) ? cacheIndex.layers : []);
      }
      return cacheLayersByProject.get(normalizedProjectId) || [];
    };
    // Main map layers — WMS by default, WFS when serveAsWfs===true or editable===true.
    const mainLayers = (profile.layers || []).filter((l) => String(l?.role || 'main') !== 'background');
    const wfsSourceKeys = new Set();
    for (const layer of mainLayers) {
      const srcProjId = normalizeProjectId(layer?.sourceProjectId || projectId) || projectId;
      const displayTitle = String(layer?.title || layer?.name || '').trim() || String(layer?.name || '').trim();
      const cachedLayers = await getCachedLayersForProject(srcProjId);
      if (shouldUseWfsForPublishedLayer(layer)) {
        // Fetch real WFS meta (attributes + geometryName + featureNS) so the
        // Origo editor can finishDrawing without crashing on undefined.filter
        // and so WFS-T POSTs target the right namespace/geometry column.
        const wfsMeta = await fetchWfsLayerMeta(baseUrl, srcProjId, layer.name, authHeaders);
        const wfsSrcKey = `qtiler_wfs_${String(srcProjId).replace(/[^A-Za-z0-9_]/g, '_') || 'main'}`;
        if (!wfsSourceKeys.has(wfsSrcKey)) {
          source[wfsSrcKey] = {
            url: `${baseUrl}/wfs?project=${encodeURIComponent(srcProjId)}${security?.isEnabled() ? '' : ''}`,
            type: 'WFS',
            projection: projCode,
            srsName: projCode,
            // ALWAYS set workspace/prefix — OL WFS-T crashes without them.
            workspace: wfsMeta.featureNS || 'http://www.qgis.org/gml',
            prefix: 'feature'
          };
          wfsSourceKeys.add(wfsSrcKey);
        }
        
        const cLayer = cachedLayers.find(c => c.name === layer.name || c.id === layer.name);
        
        let styleName = 'default';
        const safeStyleName = `${String(srcProjId).replace(/[^A-Za-z0-9_]/g, '_')}_${String(layer.name).replace(/[^A-Za-z0-9_]/g, '_')}`;
        if (layer.wfsStyle) {
          if (typeof layer.wfsStyle === 'object') {
            styleName = safeStyleName;
            origoStyles[styleName] = rewriteSvgIconColors(layer.wfsStyle);
            const patternRuntime = extractRuntimePatternStyle(origoStyles[styleName], layer);
            if (patternRuntime) qtilerPatternStyles[styleName] = patternRuntime;
          } else if (typeof layer.wfsStyle === 'string') {
            styleName = layer.wfsStyle;
          }
        } else if (cLayer && cLayer.origoStyle) {
          styleName = safeStyleName;
          origoStyles[styleName] = rewriteSvgIconColors(cLayer.origoStyle);
        }

        // Origo v2.10.0 bug: editAttributes() does `attributeObjects.reduce(...)`
        // without first checking that the array got assigned. When the attribute
        // list is empty, the variable stays undefined and the editor crashes
        // with `Cannot read properties of undefined (reading 'reduce')`.
        // Always provide at least one attribute so the editor can open.
        let resolvedAttrs = (Array.isArray(layer.attributes) && layer.attributes.length)
          ? normalizeInfoclickAttributes(layer.attributes)
          : normalizeInfoclickAttributes(Array.isArray(wfsMeta.attributes) ? wfsMeta.attributes : []);
        if (!resolvedAttrs.length) {
          resolvedAttrs = [{ name: 'fid', title: 'fid', type: 'text' }];
        }
        // Sanitize attribute types so Origo never receives type:undefined or an
        // unrecognised value. When a type is missing or invalid we fall back to
        // the type detected from WFS DescribeFeatureType, then to 'text'.
        {
          const VALID_ORIGO_ATTR_TYPES = new Set([
            'text', 'textarea', 'number', 'decimal', 'date', 'datetime',
            'checkbox', 'url', 'email', 'color', 'image', 'hidden', 'dropdown', 'searchList'
          ]);
          const TYPE_ALIASES = { integer: 'number', int: 'number', float: 'decimal', bool: 'checkbox', boolean: 'checkbox' };
          const wfsMetaByName = Object.fromEntries(
            (wfsMeta.attributes || []).map(a => [a.name, a])
          );
          resolvedAttrs = resolvedAttrs.map(attr => {
            if (attr && typeof attr === 'object' && String(attr.html || '').trim()) return attr;
            const raw = String(attr.type || '').trim();
            if (VALID_ORIGO_ATTR_TYPES.has(raw)) return attr;
            // Try alias mapping first
            const aliased = TYPE_ALIASES[raw.toLowerCase()];
            if (aliased) return { ...attr, type: aliased };
            // Fall back to WFS DescribeFeatureType detected type
            const detected = wfsMetaByName[attr.name]?.type;
            const resolvedType = (detected && VALID_ORIGO_ATTR_TYPES.has(detected)) ? detected : 'text';
            return { ...attr, type: resolvedType };
          });
        }
        const wfsDef = {
          name: layer.name,
          title: displayTitle,
          group: String(layer.group || 'root'),
          source: wfsSrcKey,
          type: 'WFS',
          queryable: true,
          visible: layer.visible !== false,
          style: styleName,
          featureType: layer.name,
          attributes: resolvedAttrs,
          geometryName: layer.geometryName || wfsMeta.geometryName || 'geometry'
        };
        if (layer.editable) wfsDef.editable = true;
        if (layer.geometryType) wfsDef.geometryType = layer.geometryType;
        else if (cLayer?.geometry_type) {
          const gt = String(cLayer.geometry_type).toLowerCase();
          if (gt.includes('polygon')) wfsDef.geometryType = 'Polygon';
          else if (gt.includes('line')) wfsDef.geometryType = 'LineString';
          else if (gt.includes('point')) wfsDef.geometryType = 'Point';
        }
        layers.push(wfsDef);
      } else {
        // Plain WMS layer — generate a thumbnail style so legend has a real icon
        const safe = `${String(srcProjId).replace(/[^A-Za-z0-9_]/g, '_')}_${String(layer.name).replace(/\s+/g, '_')}`;
        const thumbStyleName = `wms_thumb_${safe}`;
        const thumbUrl = `${baseUrl}/plugins/${pluginSlug}/api/thumbnail/${encodeURIComponent(srcProjId)}?LAYERS=${encodeURIComponent(layer.name)}`;
        const manualLegendRaw = resolveManualWmsLegendUrl(layer, '');
        const legendUrl = manualLegendRaw
          ? buildManualWmsLegendIconUrl(manualLegendRaw, baseUrl)
          : buildWmsLegendGraphicUrl(baseUrl, srcProjId, layer.name);
        origoStyles[thumbStyleName] = [[{ icon: { src: legendUrl }, image: { src: legendUrl } }]];
        const wmsDef = {
          name: layer.name,
          id: layer.name,        // Origo uses `id` as LAYERS param, not `name`
          title: displayTitle,
          group: String(layer.group || 'root'),
          source: ensureWmsSource(srcProjId),
          type: 'WMS',
          renderMode: 'image',
          format: 'image/png',
          transparent: true,
          queryable: true,
          visible: layer.visible !== false,
          style: thumbStyleName,
          thumbnail: legendUrl
        };
        // Restrict GetFeatureInfo popup attributes to the user-defined list.
        // Origo `attributes` filters which fields are shown for both WMS
        // and WFS layers in the infoclick popup.
        if (Array.isArray(layer.attributes) && layer.attributes.length) {
          wmsDef.attributes = layer.attributes;
        }
        layers.push(wmsDef);
      }
    }

    // Background layers
    let hasOsm = false;
    const backgrounds = Array.isArray(profile.backgrounds) ? profile.backgrounds : [];
    for (const bg of backgrounds) {
      if (bg.type === 'osm' || bg.key === 'osm') {
        hasOsm = true;
        const osmThumb = 'https://tile.openstreetmap.org/4/8/5.png';
        origoStyles['bg_thumb_osm'] = [[{ image: { src: osmThumb } }]];
        layers.push({ name: 'osm', title: 'OpenStreetMap', group: 'background', source: 'osm', queryable: false, type: 'OSM', visible: !!bg.isDefault, style: 'bg_thumb_osm', thumbnail: osmThumb });
      } else if (bg.type === 'layer' && bg.name) {
        const srcProjId = bg.sourceProjectId || bgProjectId || null;
        const bgName = String(bg.name || '').trim();
        const bgThemeName = normalizeThemeName(bg.themeName || (bg.isTheme === true || /^theme:/i.test(bgName) ? bgName : ''));
        const isThemeBackground = !!bgThemeName;
        const wmtsLayerName = isThemeBackground ? bgThemeName : bgName;
        const wmsLayerName = isThemeBackground ? `theme:${bgThemeName}` : bgName;
        const layerNameSafe = (isThemeBackground ? `theme_${bgThemeName}` : bgName).replace(/\s+/g, '_');
        const displayTitle = String(bg.title || (isThemeBackground ? bgThemeName : bgName));
        const bgStyleName = `bg_thumb_${layerNameSafe}`;
        const autoThumbUrl = srcProjId
          ? `${baseUrl}/plugins/${pluginSlug}/api/thumbnail/layer/${encodeURIComponent(wmsLayerName)}?project=${encodeURIComponent(srcProjId)}`
          : null;
        const bgThumbUrl = bg.imageUrl ? `${baseUrl}${bg.imageUrl}` : autoThumbUrl;
        if (bgThumbUrl) origoStyles[bgStyleName] = [[{ image: { src: bgThumbUrl } }]];
        // Use WMTS when tile grid is available, otherwise fall back to WMS
        if (bgTileGrid && srcProjId) {
          // Source key uses underscores (safe identifier); URL uses encodeURIComponent so server
          // decodes to the original name (with spaces) and finds the correct cache folder.
          const srcKey = `wmts_bg_${layerNameSafe}`;
          source[srcKey] = {
            url: isThemeBackground
              ? buildThemeWmtsUrl(baseUrl, srcProjId, bgThemeName)
              : `${baseUrl}/wmts/${encodeURIComponent(srcProjId)}/${encodeURIComponent(wmtsLayerName)}/{z}/{x}/{y}.png`,
            type: 'XYZ',
            projection: bgTileGrid.crs || projCode
          };
          const bgMaxZoom = (Array.isArray(bgTileGrid.resolutions) && bgTileGrid.resolutions.length)
            ? bgTileGrid.resolutions.length - 1 : undefined;
          layers.push({
            name: `bg_${layerNameSafe}`,
            id: wmtsLayerName,
            title: displayTitle,
            group: 'background',
            source: srcKey,
            type: 'XYZ',
            format: 'image/png',
            queryable: false,
            visible: !!bg.isDefault,
            style: bgThumbUrl ? bgStyleName : 'add me',
            thumbnail: bgThumbUrl || undefined,
            ...(bgMaxZoom != null ? { maxZoom: bgMaxZoom } : {}),
            tileGrid: {
              origin: bgTileGrid.topLeft,
              resolutions: bgTileGrid.resolutions,
              alignBottomLeft: false
            },
            ...(Array.isArray(bgTileGrid.projectionExtent) ? { extent: bgTileGrid.projectionExtent } : {})
          });
        } else {
          // Fall back to WMS
          const bgSrcKey = 'qtiler_bg_wms';
          if (!source[bgSrcKey] && srcProjId) {
            source[bgSrcKey] = { url: `${baseUrl}/plugins/${pluginSlug}/wms?project=${encodeURIComponent(srcProjId)}` };
          }
          layers.push({
            name: `bg_${layerNameSafe}`,
            id: wmsLayerName,
            title: displayTitle,
            group: 'background',
            source: bgSrcKey || mainSourceKey,
            type: 'WMS',
            renderMode: 'image',
            queryable: false,
            visible: !!bg.isDefault,
            style: bgThumbUrl ? bgStyleName : undefined,
            thumbnail: bgThumbUrl || undefined
          });
        }
      }
    }
    if (!hasOsm) {
      // Only make OSM the default if no other background layer is set as default
      const hasDefaultBg = layers.some((l) => l.group === 'background' && l.visible);
      const osmThumb = 'https://tile.openstreetmap.org/4/8/5.png';
      origoStyles['bg_thumb_osm'] = [[{ image: { src: osmThumb } }]];
      layers.push({ name: 'osm', title: 'OpenStreetMap', group: 'background', source: 'osm', queryable: false, type: 'OSM', visible: !hasDefaultBg, style: 'bg_thumb_osm', thumbnail: osmThumb });
    }

    // Controls from profile — valid Origo v2.10.0 names only.
    // Usar exactamente los controles y options del perfil, sin modificar ni autocompletar.
    const VALID_ORIGO_CONTROL_NAMES = new Set([
      'about', 'attribution', 'bookmarks', 'draganddrop', 'draw', 'editor',
      'externalurl', 'fullscreen', 'geoposition', 'home', 'legend', 'link',
      'localization', 'mapmenu', 'measure', 'position', 'print', 'progressbar',
      'rotate', 'scale', 'scaleline', 'scalepicker', 'search', 'sharemap',
      'splash', 'zoom', 'lantmaterisearch'
    ]);
    const userProvidedControls = Array.isArray(profile.controls);
    const normalizedControls = userProvidedControls
      ? profile.controls.map((c) => normalizeOrigoControlEntry(c)).filter(Boolean)
      : [];
    const droppedControls = normalizedControls.filter((c) => !VALID_ORIGO_CONTROL_NAMES.has(c.name)).map((c) => c.name);
    if (droppedControls.length) {
      console.warn(`[Qtiler2Origo] Profile "${profile.profileKey || profile.projectId || 'unknown'}" dropped unsupported Origo control(s): ${droppedControls.join(', ')}`);
    }
    const controls = normalizedControls.filter((c) => VALID_ORIGO_CONTROL_NAMES.has(c.name));

    // Origo already renders zoom buttons by default; keeping an explicit
    // `zoom` control duplicates the + / - UI in both preview and published maps.
    for (let i = controls.length - 1; i >= 0; i -= 1) {
      const n = typeof controls[i] === 'string' ? controls[i] : controls[i]?.name;
      if (n === 'zoom') controls.splice(i, 1);
    }

    // Defensive: Origo's editor crashes with "Cannot read properties of
    // undefined (reading 'reduce')" when the editor control is enabled but no
    // layer has `editable: true`. Drop the control in that case and log it.
    const hasEditableLayer = layers.some((l) => l && l.editable === true);
    if (!hasEditableLayer) {
      const beforeLen = controls.length;
      for (let i = controls.length - 1; i >= 0; i -= 1) {
        const n = typeof controls[i] === 'string' ? controls[i] : controls[i]?.name;
        if (n === 'editor') controls.splice(i, 1);
      }
      if (controls.length !== beforeLen) {
        console.warn(`[Qtiler2Origo] Profile "${profile.profileKey || profile.projectId}" has 'editor' control but no editable layers — control removed to avoid Origo crash. Mark at least one layer as editable in the profile.`);
      }
    }

    // Auto-inject a `search` control. If `profile.features.searchSources` is
    // configured (cross-project search), use those sources; otherwise fall back
    // to the current project's `data/searchable-layers/<projectId>.json`.
    //
    // Each source is shaped as `{ projectId, layers: [layerName, ...] }`. The
    // `/api/search` endpoint accepts repeated `project=` params plus optional
    // per-project layer filters via `l_<sanitizedPid>=lay1,lay2`.
    try {
      const featuresCfg = (profile && typeof profile === 'object' && profile.features && typeof profile.features === 'object')
        ? profile.features
        : {};

      // Verify at least the primary project has searchable layers; if not, we
      // skip auto-injection (preserves previous behaviour for empty projects).
      let primaryHasSearchable = false;
      const safeProj = sanitizeFileToken(projectId);
      if (safeProj) {
        const cfgPath = path.join(dataRoot, 'searchable-layers', `${safeProj}.json`);
        try {
          const raw = await fs.promises.readFile(cfgPath, 'utf8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.some((e) => e && e.searchable !== false)) {
            primaryHasSearchable = true;
          }
        } catch (err) {
          if (err && err.code !== 'ENOENT') throw err;
        }
      }

      const userConfiguredSources = Array.isArray(featuresCfg.searchSources) && featuresCfg.searchSources.length > 0;
      const profileControlsRaw = Array.isArray(profile.controls) ? profile.controls : [];
      const userOptedInSearch = userProvidedControls
        && profileControlsRaw.some((c) => (typeof c === 'string' ? c : c?.name) === 'search');

      // Build search URL: primary project plus any extra projects configured
      // in `features.searchSources`. Per-project layer filters are passed as
      // `lf_<pid>=lay1,lay2`. The handler resolves each project's
      // searchable-layers config and searches across all of them.
      const extraSources = Array.isArray(featuresCfg.searchSources) ? featuresCfg.searchSources : [];
      const extraPids = [];
      const layerFilterQs = [];
      for (const src of extraSources) {
        const pid = String(src?.projectId || '').trim();
        if (!pid || pid === projectId) continue;
        if (extraPids.includes(pid)) continue;
        extraPids.push(pid);
        if (Array.isArray(src.layers) && src.layers.length) {
          layerFilterQs.push(`lf_${encodeURIComponent(pid)}=${encodeURIComponent(src.layers.join(','))}`);
        }
      }
      // Also honour layer filter for the primary project if it was configured
      // explicitly in searchSources.
      const primarySrc = extraSources.find((s) => String(s?.projectId || '').trim() === projectId);
      if (primarySrc && Array.isArray(primarySrc.layers) && primarySrc.layers.length) {
        layerFilterQs.push(`lf_${encodeURIComponent(projectId)}=${encodeURIComponent(primarySrc.layers.join(','))}`);
      }
      let searchUrl = `/plugins/Qtiler2Origo/origo-search?project=${encodeURIComponent(projectId)}`;
      if (extraPids.length) searchUrl += `&extra=${encodeURIComponent(extraPids.join(','))}`;
      if (layerFilterQs.length) searchUrl += '&' + layerFilterQs.join('&');

      // Build default Origo search options (option 4 in Origo search docs:
      // single-table search; endpoint returns features w/ WKT in `geom` and
      // label in `name`). The URL has the project pre-encoded so Origo only
      // appends `&q=<value>`.
      const defaultSearchOptions = {
        url: searchUrl,
        queryParameterName: 'q',
        searchAttribute: 'name',
        titleAttribute: 'group',
        contentAttribute: 'content',
        geometryAttribute: 'geom',
        groupSuggestions: true,
        title: 'Search',
        minLength: 3,
        limit: 20,
        hintText: 'Search'
      };

      const allowAutoSearch = !userProvidedControls || userOptedInSearch;
      const shouldAdd = allowAutoSearch && (primaryHasSearchable || userConfiguredSources);

      // If the profile has a `search` control entry, merge defaults into its
      // options so we never serve Origo a search control missing `url` (which
      // would crash inside Awesomplete with `Cannot read properties of
      // undefined (reading 'indexOf')`).
      for (let i = 0; i < controls.length; i += 1) {
        const entry = controls[i];
        const n = typeof entry === 'string' ? entry : entry?.name;
        if (n !== 'search') continue;
        const userOpts = (entry && typeof entry === 'object' && entry.options && typeof entry.options === 'object')
          ? entry.options
          : {};
        controls[i] = { name: 'search', options: { ...defaultSearchOptions, ...userOpts } };
      }

      if (shouldAdd) {
        const hasSearch = controls.some((c) => (typeof c === 'string' ? c : c?.name) === 'search');
        if (!hasSearch) {
          controls.push({ name: 'search', options: defaultSearchOptions });
        }
      }
    } catch (err) {
      console.warn('[Qtiler2Origo] could not auto-add search control:', err?.message || err);
    }

    const computed = computeProjectionConfig(projCode, nativeExtent);
    // Use background tile grid resolutions to ensure Origo aligns properly with WMTS
    let finalResolutions = (bgTileGrid && Array.isArray(bgTileGrid.resolutions) && bgTileGrid.resolutions.length > 0) 
        ? bgTileGrid.resolutions 
        : computed.resolutions;

    // Compute projectionExtent aligned to the WMTS top-left + tile grid so
    // that pre-cut tiles render in their true geographic position. If we used
    // the projection's nominal world extent, OL re-derives a tile origin that
    // does NOT match the WMTS origin and the backgrounds end up shifted.
    let finalProjectionExtent = computed.projectionExtent;
    if (bgTileGrid && Array.isArray(bgTileGrid.projectionExtent) && bgTileGrid.projectionExtent.length === 4) {
      // Preferred path: derived from matrix0.matrix_width/matrix_height — exact match for WMTS.
      finalProjectionExtent = bgTileGrid.projectionExtent;
    } else if (bgTileGrid && Array.isArray(bgTileGrid.topLeft) && bgTileGrid.topLeft.length === 2
        && Array.isArray(bgTileGrid.resolutions) && bgTileGrid.resolutions.length > 0) {
      const [originX, originY] = bgTileGrid.topLeft.map(Number);
      const tileSize = Number(bgTileGrid.tileSize) || 256;
      const r0 = Number(bgTileGrid.resolutions[0]);
      const span = r0 * tileSize * 8192;
      finalProjectionExtent = [originX, originY - span, originX + span, originY];
    }

    // View extent for OL: must match the WMTS pyramid so the user can zoom
    // out across the full background. Using the small project AoI here would
    // clamp panning/zooming to that AoI which is what was happening before.
    // We keep the AoI for the initial center/zoom only.
    const finalViewExtent = finalProjectionExtent
      || (Array.isArray(profile.extent) && profile.extent.length === 4 ? profile.extent
          : (Array.isArray(extent) && extent.length === 4 ? extent : null));

    let finalMaxZoom = Array.isArray(finalResolutions) && finalResolutions.length
      ? finalResolutions.length - 1
      : 19;
    // Honor admin-configured zoom-in/zoom-out caps when present.
    const profileMaxZoom = Number.isFinite(Number(profile?.maxZoom)) ? Number(profile.maxZoom) : null;
    const profileMinZoom = Number.isFinite(Number(profile?.minZoom)) ? Number(profile.minZoom) : null;
    // OpenLayers (used by Origo) treats minZoom/maxZoom as indices into the
    // resolutions array (maxResolution = resolutions[minZoom],
    // minResolution = resolutions[maxZoom]). If the admin asks for a higher
    // maxZoom than the WMTS pyramid provides, extend the resolutions array
    // by halving the last resolution so OL has enough levels to zoom in to.
    if (Array.isArray(finalResolutions) && finalResolutions.length
        && profileMaxZoom !== null && profileMaxZoom > finalMaxZoom) {
      const extended = finalResolutions.slice();
      let last = Number(extended[extended.length - 1]);
      while (extended.length - 1 < profileMaxZoom && Number.isFinite(last) && last > 0) {
        last = last / 2;
        extended.push(last);
      }
      finalResolutions = extended;
      finalMaxZoom = finalResolutions.length - 1;
    }
    const effectiveMaxZoom = profileMaxZoom !== null ? Math.min(profileMaxZoom, finalMaxZoom) : finalMaxZoom;
    const effectiveMinZoom = profileMinZoom !== null ? Math.max(0, Math.min(profileMinZoom, effectiveMaxZoom)) : null;

    const config = {
      ...(profile.search ? { search: profile.search } : {}),
      ...(profile.clusterOptions ? { clusterOptions: profile.clusterOptions } : {}),
      ...(profile.pageSettings ? { pageSettings: profile.pageSettings } : {}),
      ...(profile.featureinfoOptions ? { featureinfoOptions: profile.featureinfoOptions } : {}),
      ...(profile.attribution ? { attribution: profile.attribution } : {}),
      ...(profile.target ? { target: profile.target } : {}),
      ...(profile.url ? { url: profile.url } : {}),
      projectionCode: projCode,
      projectionExtent: finalProjectionExtent,
      extent: finalViewExtent,
      maxZoom: effectiveMaxZoom,
      ...(effectiveMinZoom !== null ? { minZoom: effectiveMinZoom } : {}),
      center,
      zoom,
      controls,
      source,
      groups,
      layers,
      styles: Object.keys(origoStyles).length > 0 ? origoStyles : undefined,
      qtilerPatternStyles: Object.keys(qtilerPatternStyles).length > 0 ? qtilerPatternStyles : undefined
    };
    if (finalResolutions) config.resolutions = finalResolutions;
    // Force the viewer's default tileGrid to use the WMTS top-left origin
    // so WMS overlays (which fall back to viewer.getTileGrid()) align with
    // the pre-cut WMTS background tiles. Without this Origo defaults to
    // alignBottomLeft:true which uses bottom-left of the extent and the
    // (z,x,y) -> world bbox math diverges between bg and overlays.
    if (bgTileGrid && Array.isArray(bgTileGrid.topLeft) && bgTileGrid.topLeft.length === 2) {
      config.tileGridOptions = {
        alignBottomLeft: false,
        origin: bgTileGrid.topLeft.map(Number),
        resolutions: finalResolutions,
        extent: finalProjectionExtent,
        tileSize: [Number(bgTileGrid.tileSize) || 256, Number(bgTileGrid.tileSize) || 256]
      };
    }
    if (proj4Defs.length) config.proj4Defs = proj4Defs;
    return config;
  };

  // ── Intercept index.json for Origo viewer: return profile-based config ──
  app.get(`/plugins/${pluginSlug}/origo/index.json`, async (req, res, next) => {
    try {
      const profileId = profileFromReferer(req) || req.query?.qtiler_profile;
      if (!profileId) return next();
      const allProfiles = await readAllPublishedProfiles();
      const accessible = filterProfilesByAccess(allProfiles, req.user);
      const profile = findProfileMatch(accessible, profileId);

      if (!profile) return next();
      const baseUrl = getRequestBaseUrl(req);
      const config = await buildOrigoIndexConfig(profile, baseUrl, req);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.json(config);
    } catch (err) {
      console.error('[Qtiler2Origo] index.json dynamic build failed:', err?.message || err);
      return next();
    }
  });
  app.get(`/plugins/${pluginSlug}/api/preview-config.json`, async (req, res) => {
    const { payload } = await resolvePreviewRequestPayload(req);
    const projectId = sanitizeFileToken(String(payload.project || '').trim());
    if (!projectId) return res.status(400).json({ error: 'missing_project' });
    const rawLayers = String(payload.layers || '').trim();
    const rawGroups = String(payload.groups || '').trim();
    const rawLayerRules = String(payload.layerRules || '').trim();
    const baseUrl = getRequestBaseUrl(req);
    const bgProject = sanitizeFileToken(String(payload.bgProject || '').trim());
    const bgLayer = String(payload.bgLayer || '').trim();
    const bgKey = String(payload.bgKey || '').trim().toLowerCase();
    const parsePreviewLayers = (raw) => {
      const text = String(raw || '').trim();
      if (!text) return [];
      const normalizeSpec = (entry) => {
        if (!entry) return null;
        if (typeof entry === 'string') {
          const value = entry.trim();
          if (!value) return null;
          if (value.includes('::')) {
            const idx = value.indexOf('::');
            const sourceProjectId = normalizeProjectId(value.slice(0, idx)) || projectId;
            const name = String(value.slice(idx + 2) || '').trim();
            if (!name) return null;
            return { name, sourceProjectId, group: 'root' };
          }
          return { name: value, sourceProjectId: projectId, group: 'root' };
        }
        if (typeof entry === 'object') {
          const name = String(entry.name || '').trim();
          if (!name) return null;
          return {
            name,
            title: String(entry.title || name).trim() || name,
            sourceProjectId: normalizeProjectId(entry.sourceProjectId || projectId) || projectId,
            visible: entry.visible !== false,
            group: String(entry.group || 'root').trim() || 'root'
          };
        }
        return null;
      };
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed.map(normalizeSpec).filter(Boolean);
      } catch { /* fall back to comma list */ }
      return text.split(',').map(normalizeSpec).filter(Boolean);
    };
    const previewLayerSpecs = parsePreviewLayers(rawLayers);
    const parsePreviewGroups = (raw) => {
      const text = String(raw || '').trim();
      if (!text) return [];
      const normalizeGroup = (entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const name = String(entry.name || '').trim();
        if (!name || name === 'root' || name === 'background') return null;
        const group = {
          name,
          title: String(entry.title || name).trim() || name,
          expanded: entry.expanded !== false
        };
        const parent = String(entry.parent || '').trim();
        if (parent && parent !== name && parent !== 'background') group.parent = parent;
        return group;
      };
      try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed.map(normalizeGroup).filter(Boolean) : [];
      } catch {
        return [];
      }
    };
    const previewGroups = parsePreviewGroups(rawGroups);
    const parsePreviewLayerRules = (raw) => {
      const text = String(raw || '').trim();
      if (!text) return {};
      try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    };
    const previewLayerRules = parsePreviewLayerRules(rawLayerRules);
    // When the admin picked OSM (or no background) as default, the view MUST
    // be Web Mercator (EPSG:3857) so the OSM tiles align and the user can
    // zoom out across the full standard pyramid (0..21) regardless of the
    // main project's native CRS or any previously selected bg project.
    const forceWebMercator = !bgProject || bgKey === 'osm' || bgKey === 'none';

    // Try to read project extent from cache for a sensible initial view.
    // Prefer the BACKGROUND project's extent/CRS so the map preview uses the
    // exact tile grid the published profile would use.
    let center = [0, 0];
    let zoom = 5;
    let projCode = 'EPSG:3857';
    let extent = [-20026376.39, -20048966.10, 20026376.39, 20048966.10];
    let nativeExtent = extent;
    let proj4Defs = [];
    try {
      let extentInfo = null;
      if (bgProject && !forceWebMercator) {
        try { extentInfo = await getProjectExtent(bgProject); } catch { /* fallthrough */ }
      }
      if (!extentInfo || !extentInfo.native) {
        extentInfo = await getProjectExtent(projectId);
      }
      if (extentInfo?.native && Array.isArray(extentInfo.native) && extentInfo.native.length === 4) {
        const [minx, miny, maxx, maxy] = extentInfo.native;
        nativeExtent = extentInfo.native;
        extent = extentInfo.native;
        center = [Math.round((minx + maxx) / 2), Math.round((miny + maxy) / 2)];
        projCode = extentInfo.crs || 'EPSG:3857';
      }
      // OSM-only mode forces a Web Mercator view. If the project center came
      // back in another CRS, fall back to the world center so the map opens
      // somewhere sensible instead of off-screen. The user can pan/zoom from
      // there. (We avoid a node-side reprojection dependency.)
      if (forceWebMercator && projCode !== 'EPSG:3857') {
        projCode = 'EPSG:3857';
        nativeExtent = [-20026376.39, -20048966.10, 20026376.39, 20048966.10];
        extent = nativeExtent;
        center = [0, 0];
        zoom = 2;
      }
    } catch { /* use defaults */ }
    // Optional overrides forwarded from the admin UI so the preview opens
    // exactly where the profile was last saved (instead of zoomed out).
    const parseJsonArray = (raw) => {
      try {
        const v = JSON.parse(String(raw));
        return Array.isArray(v) ? v.map(Number) : null;
      } catch { return null; }
    };
    const ovCenter = parseJsonArray(payload.center);
    // CRS the captured overrides were originally expressed in. Discard the
    // overrides entirely if it does not match the active view CRS — otherwise
    // a center captured in 3857 but applied as 3006 (or vice versa) drops the
    // camera in the wrong hemisphere ("North Pole" symptom).
    const ovCrs = String(payload.centerCrs || '').trim().toUpperCase();
    const overridesCrsOk = !ovCrs || ovCrs === String(projCode || '').toUpperCase();
    // When OSM-only mode is forced, only honor a center override that looks
    // like it's already in Web Mercator metres (|x| ≤ ~20M). Otherwise the
    // saved center may be in a national CRS (e.g. 3006) and would push the
    // OSM view far off-screen.
    const looksWebMercator = (c) => Array.isArray(c) && c.length === 2
      && Math.abs(c[0]) <= 20100000 && Math.abs(c[1]) <= 20100000;
    if (overridesCrsOk && Array.isArray(ovCenter) && ovCenter.length === 2 && ovCenter.every(Number.isFinite)
        && (!forceWebMercator || looksWebMercator(ovCenter))) {
      center = ovCenter;
    }
    const ovZoom = Number(payload.zoom);
    let zoomOverride = null;
    if (overridesCrsOk && Number.isFinite(ovZoom)) zoomOverride = ovZoom;
    const ovExtent = parseJsonArray(payload.extent);
    let extentOverride = null;
    if (overridesCrsOk && Array.isArray(ovExtent) && ovExtent.length === 4 && ovExtent.every(Number.isFinite)
        && (!forceWebMercator || (looksWebMercator([ovExtent[0], ovExtent[1]]) && looksWebMercator([ovExtent[2], ovExtent[3]])))) {
      extentOverride = ovExtent;
    }
    proj4Defs = buildProj4Defs(projCode, 'EPSG:3857', 'EPSG:4326');

    // Background tile grid (from the bg project) — used to align the preview
    // map exactly the way the published profile will be aligned. Skip when the
    // user picked OSM/none so we don't import a non-3857 pyramid into a
    // Web-Mercator view.
    const bgTileGrid = (bgProject && !forceWebMercator) ? await loadTileGridForProject(bgProject) : null;

    // Build Origo-format config
    const { projectionExtent, resolutions } = computeProjectionConfig(projCode, nativeExtent);
    let finalResolutions = (bgTileGrid && Array.isArray(bgTileGrid.resolutions) && bgTileGrid.resolutions.length > 0)
      ? bgTileGrid.resolutions.slice()
      : (Array.isArray(resolutions) ? resolutions.slice() : []);
    // Honor an admin-provided maxZoom for the preview pyramid, otherwise
    // default to 28 levels so the admin can always zoom in to ~1:100 scale.
    // The WMTS background only ships a few zoom levels (e.g. 14 for 3006);
    // without extending here, the View's maxZoom would clamp the admin to
    // that shallow pyramid no matter what they typed in the Max Zoom field.
    const reqMaxZoom = Number(payload.maxZoom);
    const targetLevels = Math.min(29, Math.max(
      28,
      Number.isFinite(reqMaxZoom) && reqMaxZoom > 0 ? Math.ceil(reqMaxZoom) + 1 : 0
    ));
    if (Array.isArray(finalResolutions) && finalResolutions.length > 0
        && finalResolutions.length < targetLevels) {
      let last = Number(finalResolutions[finalResolutions.length - 1]);
      while (finalResolutions.length < targetLevels && Number.isFinite(last) && last > 0) {
        last = last / 2;
        finalResolutions.push(last);
      }
    }
    let finalProjectionExtent = projectionExtent;
    if (bgTileGrid && Array.isArray(bgTileGrid.projectionExtent) && bgTileGrid.projectionExtent.length === 4) {
      finalProjectionExtent = bgTileGrid.projectionExtent;
    } else if (bgTileGrid && Array.isArray(bgTileGrid.topLeft) && bgTileGrid.topLeft.length === 2
        && Array.isArray(bgTileGrid.resolutions) && bgTileGrid.resolutions.length > 0) {
      const [originX, originY] = bgTileGrid.topLeft.map(Number);
      const tileSize = Number(bgTileGrid.tileSize) || 256;
      const r0 = Number(bgTileGrid.resolutions[0]);
      const span = r0 * tileSize * 8192;
      finalProjectionExtent = [originX, originY - span, originX + span, originY];
    }
    const finalMaxZoom = Array.isArray(finalResolutions) && finalResolutions.length
      ? finalResolutions.length - 1 : 19;

    const previewControls = (() => {
      const defaults = [
        { name: 'home', options: { zoomOnStart: zoomOverride == null && center[0] === 0 && center[1] === 0 } },
        { name: 'mapmenu', options: { isActive: false } },
        { name: 'legend', options: { useGroupIndication: true } },
        { name: 'scaleline' }
      ];
      try {
        const raw = JSON.parse(String(payload.controls || '[]'));
        if (!Array.isArray(raw) || !raw.length) return defaults;
        const deduped = new Map();
        raw.forEach((entry) => {
          if (typeof entry === 'string' && entry.trim()) {
            const normalized = normalizeOrigoControlEntry(entry);
            if (!normalized) return;
            deduped.set(normalized.name, normalized);
          } else if (entry && typeof entry === 'object' && String(entry.name || '').trim()) {
            const normalized = normalizeOrigoControlEntry(entry);
            if (!normalized) return;
            deduped.set(normalized.name, normalized);
          }
        });
        if (!deduped.size) return defaults;
        if (deduped.has('home')) {
          const currentHome = deduped.get('home') || { name: 'home' };
          deduped.set('home', {
            name: 'home',
            options: {
              ...(currentHome.options || {}),
              zoomOnStart: zoomOverride == null && center[0] === 0 && center[1] === 0
            }
          });
        }
        return Array.from(deduped.values());
      } catch {
        return defaults;
      }
    })();

    const bgThemeName = normalizeThemeName(/^theme:/i.test(bgLayer) ? bgLayer : '');
    const isThemeBgLayer = !!bgThemeName;
    const previewWmtsLayerName = isThemeBgLayer ? bgThemeName : bgLayer;
    const previewWmsLayerName = isThemeBgLayer ? `theme:${bgThemeName}` : bgLayer;
    const wmtsBgLayerName = (bgProject && bgLayer) ? `wmts_bg_${String(isThemeBgLayer ? `theme_${bgThemeName}` : bgLayer).replace(/[^A-Za-z0-9_]/g, '_')}` : null;
    const previewStyles = {};
    const qtilerPatternStyles = {};
    const sourceMap = {
      osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' }
    };
    const ensurePreviewWmsSource = (pid) => {
      const normalizedProjectId = normalizeProjectId(pid || projectId) || projectId;
      const sourceKey = `qtiler_wms_${String(normalizedProjectId).replace(/[^A-Za-z0-9_]/g, '_') || 'main'}`;
      if (!sourceMap[sourceKey]) {
        sourceMap[sourceKey] = {
          url: `${baseUrl}/plugins/${pluginSlug}/wms?project=${encodeURIComponent(normalizedProjectId)}`,
          projection: projCode
        };
      }
      return sourceKey;
    };
    const ensurePreviewWfsSource = (pid, projectionCode) => {
      const normalizedProjectId = normalizeProjectId(pid || projectId) || projectId;
      const sourceKey = `qtiler_wfs_${String(normalizedProjectId).replace(/[^A-Za-z0-9_]/g, '_') || 'main'}`;
      if (!sourceMap[sourceKey]) {
        sourceMap[sourceKey] = {
          url: `${baseUrl}/wfs?project=${encodeURIComponent(normalizedProjectId)}`,
          type: 'WFS',
          projection: projectionCode,
          srsName: projectionCode,
          workspace: 'http://www.qgis.org/gml',
          prefix: 'feature'
        };
      }
      return sourceKey;
    };
    const cacheLayersByProject = new Map();
    const getCachedLayersForProject = async (pid) => {
      const normalizedProjectId = normalizeProjectId(pid || projectId) || projectId;
      if (!cacheLayersByProject.has(normalizedProjectId)) {
        const cacheIndex = await readCacheIndex(normalizedProjectId);
        cacheLayersByProject.set(normalizedProjectId, Array.isArray(cacheIndex?.layers) ? cacheIndex.layers : []);
      }
      return cacheLayersByProject.get(normalizedProjectId) || [];
    };
    if (wmtsBgLayerName) {
      sourceMap[wmtsBgLayerName] = {
        url: isThemeBgLayer
          ? buildThemeWmtsUrl(baseUrl, bgProject, bgThemeName)
          : `${baseUrl}/wmts/${encodeURIComponent(bgProject)}/${encodeURIComponent(previewWmtsLayerName)}/{z}/{x}/{y}.png`,
        type: 'XYZ',
        projection: (bgTileGrid && bgTileGrid.crs) || projCode
      };
    }

    const layersArr = [];
    for (const layerSpec of previewLayerSpecs) {
      const sourceProjectId = normalizeProjectId(layerSpec.sourceProjectId || projectId) || projectId;
      const layerName = String(layerSpec.name || '').trim();
      const displayTitle = String(layerSpec.title || layerName).trim() || layerName;
      const layerRuleKey = `${sourceProjectId}::${layerName}`;
      const rule = previewLayerRules[layerRuleKey] && typeof previewLayerRules[layerRuleKey] === 'object'
        ? previewLayerRules[layerRuleKey]
        : ((previewLayerRules[layerName] && typeof previewLayerRules[layerName] === 'object') ? previewLayerRules[layerName] : {});
      const useWfs = shouldUseWfsForPublishedLayer(rule);
      if (useWfs) {
        const wfsMeta = await fetchWfsLayerMeta(baseUrl, sourceProjectId, layerName);
        const wfsSourceKey = ensurePreviewWfsSource(sourceProjectId, projCode);
        if (wfsMeta?.featureNS) sourceMap[wfsSourceKey].workspace = wfsMeta.featureNS;
        const cachedLayers = await getCachedLayersForProject(sourceProjectId);
        const cLayer = cachedLayers.find((c) => c.name === layerName || c.id === layerName);
        let styleName = 'default';
        const safeStyleName = `${String(sourceProjectId).replace(/[^A-Za-z0-9_]/g, '_')}_${String(layerName).replace(/[^A-Za-z0-9_]/g, '_')}`;
        if (rule?.wfsStyle && typeof rule.wfsStyle === 'object') {
          styleName = safeStyleName;
          previewStyles[styleName] = rewriteSvgIconColors(rule.wfsStyle);
          const patternRuntime = extractRuntimePatternStyle(previewStyles[styleName], {
            designerOptions: rule?.designerOptions,
            geometryType: rule?.geometryType
          });
          if (patternRuntime) qtilerPatternStyles[styleName] = patternRuntime;
        } else if (rule?.wfsStyle && typeof rule.wfsStyle === 'string') {
          styleName = rule.wfsStyle;
        } else if (cLayer?.origoStyle) {
          styleName = safeStyleName;
          previewStyles[styleName] = rewriteSvgIconColors(cLayer.origoStyle);
        }
        let resolvedAttrs = (Array.isArray(rule?.attributes) && rule.attributes.length)
          ? normalizeInfoclickAttributes(rule.attributes)
          : normalizeInfoclickAttributes(Array.isArray(wfsMeta?.attributes) ? wfsMeta.attributes : []);
        if (!resolvedAttrs.length) resolvedAttrs = [{ name: 'fid', title: 'fid', type: 'text' }];
        const wfsDef = {
          name: sourceProjectId === projectId ? layerName : `${sourceProjectId}::${layerName}`,
          id: layerName,
          title: displayTitle,
          group: String(layerSpec.group || 'root').trim() || 'root',
          source: wfsSourceKey,
          type: 'WFS',
          queryable: true,
          visible: layerSpec.visible !== false,
          style: styleName,
          featureType: layerName,
          attributes: resolvedAttrs,
          geometryName: rule?.geometryAttribute || wfsMeta?.geometryName || 'geometry'
        };
        if (rule?.editable) wfsDef.editable = true;
        if (rule?.geometryType) wfsDef.geometryType = rule.geometryType;
        else if (cLayer?.geometry_type) {
          const gt = String(cLayer.geometry_type).toLowerCase();
          if (gt.includes('polygon')) wfsDef.geometryType = 'Polygon';
          else if (gt.includes('line')) wfsDef.geometryType = 'LineString';
          else if (gt.includes('point')) wfsDef.geometryType = 'Point';
        }
        layersArr.push(wfsDef);
        continue;
      }
      const styleName = `wms_thumb_${String(sourceProjectId).replace(/[^A-Za-z0-9_]/g, '_')}_${String(layerName).replace(/[^A-Za-z0-9_]/g, '_')}`;
      const manualLegendRaw = resolveManualWmsLegendUrl(rule, '');
      const legendUrl = manualLegendRaw
        ? buildManualWmsLegendIconUrl(manualLegendRaw, baseUrl)
        : buildWmsLegendGraphicUrl(baseUrl, sourceProjectId, layerName);
      if (legendUrl) previewStyles[styleName] = [[{ icon: { src: legendUrl }, image: { src: legendUrl } }]];
      layersArr.push({
        name: sourceProjectId === projectId ? layerName : `${sourceProjectId}::${layerName}`,
        id: layerName,
        title: displayTitle,
        group: String(layerSpec.group || 'root').trim() || 'root',
        source: ensurePreviewWmsSource(sourceProjectId),
        type: 'WMS',
        renderMode: 'image',
        format: 'image/png',
        transparent: true,
        queryable: false,
        visible: layerSpec.visible !== false,
        ...(legendUrl ? { style: styleName, thumbnail: legendUrl } : {})
      });
    }
    if (wmtsBgLayerName && bgTileGrid) {
      const bgThumbUrl = `${baseUrl}/plugins/${pluginSlug}/api/thumbnail/layer/${encodeURIComponent(bgLayer)}?project=${encodeURIComponent(bgProject)}`;
      const bgStyleName = `bg_thumb_${String(bgLayer).replace(/[^A-Za-z0-9_]/g, '_')}`;
      previewStyles[bgStyleName] = [[{ image: { src: bgThumbUrl } }]];
      const bgMaxZoom = (Array.isArray(bgTileGrid.resolutions) && bgTileGrid.resolutions.length)
        ? bgTileGrid.resolutions.length - 1 : undefined;
      layersArr.push({
        name: wmtsBgLayerName,
        id: bgLayer,
        title: `${bgProject} / ${bgLayer}`,
        group: 'background',
        source: wmtsBgLayerName,
        type: 'XYZ',
        format: 'image/png',
        queryable: false,
        visible: true,
        style: bgStyleName,
        thumbnail: bgThumbUrl,
        ...(bgMaxZoom != null ? { maxZoom: bgMaxZoom } : {}),
        tileGrid: {
          origin: bgTileGrid.topLeft || [-20037508.34, 20037508.34],
          resolutions: bgTileGrid.resolutions,
          alignBottomLeft: false
        },
        ...(Array.isArray(bgTileGrid.projectionExtent) ? { extent: bgTileGrid.projectionExtent } : {})
      });
    } else if (bgProject && bgLayer) {
      const bgThumbUrl = `${baseUrl}/plugins/${pluginSlug}/api/thumbnail/layer/${encodeURIComponent(bgLayer)}?project=${encodeURIComponent(bgProject)}`;
      const bgStyleName = `bg_thumb_${String(bgLayer).replace(/[^A-Za-z0-9_]/g, '_')}`;
      previewStyles[bgStyleName] = [[{ image: { src: bgThumbUrl } }]];
      layersArr.push({
        name: `wms_bg_${String(bgLayer).replace(/[^A-Za-z0-9_]/g, '_')}`,
        id: bgLayer,
        title: `${bgProject} / ${bgLayer}`,
        group: 'background',
        source: ensurePreviewWmsSource(bgProject),
        type: 'WMS',
        renderMode: 'image',
        format: 'image/png',
        transparent: false,
        queryable: false,
        visible: true,
        style: bgStyleName,
        thumbnail: bgThumbUrl
      });
    } else {
      const osmThumb = 'https://tile.openstreetmap.org/4/8/5.png';
      previewStyles.bg_thumb_osm = [[{ image: { src: osmThumb } }]];
      layersArr.push({
        name: 'osm',
        title: 'OpenStreetMap',
        group: 'background',
        source: 'osm',
        queryable: false,
        type: 'OSM',
        visible: true,
        style: 'bg_thumb_osm',
        thumbnail: osmThumb
      });
    }

    // Use the WMTS pyramid extent as the view extent so zoom-out works
    // across the whole background pyramid (not just the small AoI).
    const finalViewExtent = finalProjectionExtent || extent;

    // Reject saved center/extent overrides that don't fall within the active
    // projection extent (happens when a profile was previously saved with a
    // different background CRS — e.g. user saved center in EPSG:3006 metres
    // but is now previewing with OSM/EPSG:3857). Such stale coordinates
    // would push the view to the North Pole or off-screen.
    const inExtent = (pt, ex) => Array.isArray(pt) && Array.isArray(ex)
      && pt[0] >= ex[0] && pt[0] <= ex[2] && pt[1] >= ex[1] && pt[1] <= ex[3];
    if (Array.isArray(finalViewExtent) && finalViewExtent.length === 4) {
      if (!inExtent(center, finalViewExtent)) {
        center = [Math.round((finalViewExtent[0] + finalViewExtent[2]) / 2),
                  Math.round((finalViewExtent[1] + finalViewExtent[3]) / 2)];
        zoomOverride = null;
      }
      if (extentOverride && !(inExtent([extentOverride[0], extentOverride[1]], finalViewExtent)
          && inExtent([extentOverride[2], extentOverride[3]], finalViewExtent))) {
        extentOverride = null;
      }
    }

    const configGroups = [
      { name: 'background', title: 'Background', expanded: false, exclusive: true },
      ...previewGroups
    ];
    const knownPreviewGroups = new Set(configGroups.map((group) => String(group?.name || '').trim()).filter(Boolean));
    for (const layerSpec of previewLayerSpecs) {
      const groupName = String(layerSpec?.group || '').trim();
      if (!groupName || groupName === 'root' || groupName === 'background' || knownPreviewGroups.has(groupName)) continue;
      configGroups.push({ name: groupName, title: groupName, expanded: true });
      knownPreviewGroups.add(groupName);
    }

    const config = {
      projectionCode: projCode,
      projectionExtent: finalProjectionExtent,
      // In preview mode the view extent must always be the full
      // pyramid/projection extent so the admin can pan and zoom out freely
      // while editing — never the saved AoI (which would clamp the view).
      extent: finalViewExtent,
      maxZoom: (() => {
        const m = Number(payload.maxZoom);
        return Number.isFinite(m) && m > 0 ? Math.min(m, finalMaxZoom) : finalMaxZoom;
      })(),
      ...((() => {
        const m = Number(payload.minZoom);
        return Number.isFinite(m) && m >= 0 ? { minZoom: Math.min(m, finalMaxZoom) } : {};
      })()),
      // Preview never honors a saved minZoom: the admin must be free to zoom
      // out to inspect the full project before re-publishing.
      center,
      zoom: zoomOverride != null ? zoomOverride : zoom,
      controls: previewControls,
      source: sourceMap,
      groups: configGroups,
      layers: layersArr
    };
    if (Object.keys(previewStyles).length > 0) config.styles = previewStyles;
    if (Object.keys(qtilerPatternStyles).length > 0) config.qtilerPatternStyles = qtilerPatternStyles;
    if (proj4Defs.length) config.proj4Defs = proj4Defs;
    if (finalResolutions) config.resolutions = finalResolutions;
    // Align viewer's default tileGrid with WMTS top-left origin so WMS
    // overlays line up with pre-cut WMTS background tiles.
    if (bgTileGrid && Array.isArray(bgTileGrid.topLeft) && bgTileGrid.topLeft.length === 2) {
      config.tileGridOptions = {
        alignBottomLeft: false,
        origin: bgTileGrid.topLeft.map(Number),
        resolutions: finalResolutions,
        extent: finalProjectionExtent,
        tileSize: [Number(bgTileGrid.tileSize) || 256, Number(bgTileGrid.tileSize) || 256]
      };
    }
    return res.json(config);
  });

  app.get([`/plugins/${pluginSlug}/public/branding/logo`, '/qtiler/branding/logo'], async (req, res, next) => {
    if (req.path === '/qtiler/branding/logo' && !requestMatchesPluginBrandingAlias(req, pluginSlug)) {
      return next();
    }
    const logoPath = await resolveLogoPath();
    if (!logoPath) return res.status(404).json({ error: 'logo_not_configured' });
    return res.sendFile(logoPath);
  });
  app.get(`/plugins/${pluginSlug}/admin`, (_req, res) => {
    res.redirect(`/plugins/${pluginSlug}/admin-ui/`);
  });

  // Serve dynamic index.html with the profile name as page title when qtiler_profile is set
  app.get([`/plugins/${pluginSlug}/origo`, `/plugins/${pluginSlug}/origo/`, `/plugins/${pluginSlug}/origo/index.html`], async (req, res, next) => {
    const profileId = req.query?.qtiler_profile;
    if (!profileId) return next();
    const webRoot = await resolveQwc2WebRoot().catch(() => '');
    if (!webRoot) return next();
    try {
      let html = await fs.promises.readFile(path.join(webRoot, 'index.html'), 'utf8');
      const allProfiles = await readAllPublishedProfiles();
      const accessible = filterProfilesByAccess(allProfiles, req.user);
      const profile = findProfileMatch(accessible, profileId);
      if (!profile) return next();

      const title = profile?.name || profileId;
      html = html.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`);
      
      // Inject Lantmäteriet control CSS
      const lantmateriCss = `<link href="/plugins/${pluginSlug}/origo-controls/lantmateri-search.css" rel="stylesheet">`;
      if (!html.includes(`/origo-controls/lantmateri-search.css`)) {
        if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, `${lantmateriCss}\n</head>`);
      }
      const legendCssTag = `<style id="qtiler2origo-legend-icon">${origoLegendIconCss}</style>`;
      if (!html.includes('qtiler2origo-legend-icon')) {
        if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, `${legendCssTag}\n</head>`);
      }
      
      // Inject Lantmäteriet control script inline (not as external file to avoid cache issues)
      try {
        const controlPath = path.join(baseDir, 'origo-controls', 'lantmateri-search.js');
        const controlJs = await fs.promises.readFile(controlPath, 'utf8');
        // Extract lantmaterisearch options from profile.controls (set in admin UI)
        let lmvConfig = {};
        try {
          const ctrls = Array.isArray(profile.controls) ? profile.controls : [];
          const lmvCtrl = ctrls.find((c) => c && c.name === 'lantmaterisearch');
          if (lmvCtrl && lmvCtrl.options && typeof lmvCtrl.options === 'object') {
            lmvConfig = lmvCtrl.options;
          }
        } catch {}
        const lmvConfigScript = `<script>window.LANTMATERI_CONFIG = ${JSON.stringify(lmvConfig)};</script>`;
        const lantmateriScriptInline = `${lmvConfigScript}\n<script>\n${controlJs}\n</script>`;
        const pluginBootstrapScript = `${lantmateriScriptInline}\n<script src="/plugins/${pluginSlug}/client/origo-pattern-fills.js"></script>`;
        if (!html.includes(`/plugins/${pluginSlug}/client/origo-pattern-fills.js`)) {
          if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, `${pluginBootstrapScript}\n</head>`);
          else html = pluginBootstrapScript + html;
        } else if (!html.includes('LantmateriSearch')) {
          // origo-pattern-fills already there but not lantmateri control, inject before it
          html = html.replace(
            /(<script[^>]*\/plugins\/[^>]*origo-pattern-fills\.js[^>]*><\/script>)/i,
            `${lantmateriScriptInline}\n$1`
          );
        }
      } catch (err) {
        console.error('[Qtiler2Origo] Failed to inject Lantmäteriet control:', err);
      }
      
      // Force the Origo initialization to use the explicit config with our profile param
      // avoiding strict Referer-Policy issues where browsers strip the query.
      html = html.replace(
        /Origo\('index\.json'\)/g, 
        `window.Qtiler2OrigoOrigoBoot.bootOrigo('index.json?qtiler_profile=${encodeURIComponent(profileId)}')`
      );

      // Inject cross-project map so the search box can hand off hits from
      // other projects to their own published Origo map (opens in new tab).
      try {
        const baseUrl = getRequestBaseUrl(req);
        const allProfiles2 = await collectPublishedProfiles(baseUrl, { apiKey: getRequestApiKey(req) });
        const accessibleSet = new Set(accessible.map((p) => p.projectId));
        const projectMap = {};
        const titleMap = {};
        // First profile per projectId wins (sorted alphabetically in collectPublishedProfiles).
        for (const row of allProfiles2) {
          if (!row || !row.projectId) continue;
          if (!accessibleSet.has(row.projectId)) continue; // ACL-aware
          if (!projectMap[row.projectId]) {
            projectMap[row.projectId] = row.launchUrl;
            titleMap[row.projectId] = row.name || row.projectId;
          }
        }
        const currentProjectId = profile?.projectId || '';
        const injection = `
<script>
(function(){
  window.__QTILER_PROJECT_MAP__ = ${JSON.stringify(projectMap)};
  window.__QTILER_PROJECT_TITLES__ = ${JSON.stringify(titleMap)};
  window.__QTILER_CURRENT_PROJECT__ = ${JSON.stringify(String(currentProjectId))};

  // Helper exposed for custom UI code.
  window.qtilerOpenProjectMap = function(pid){
    var url = (window.__QTILER_PROJECT_MAP__ || {})[pid];
    if (url) window.open(url, '_blank');
  };

  // Cross-project search hand-off: cache the latest /api/search response so
  // we can map a clicked hit to its source project. When the user clicks a
  // result whose project differs from the current one, we open that
  // project's Origo map in a new tab.
  var lastHits = [];
  var hitsByLabel = Object.create(null);

  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function(input, init){
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      var p = origFetch.apply(this, arguments);
      if (url && url.indexOf('/api/search') !== -1) {
        p.then(function(r){
          if (!r || !r.ok) return;
          try {
            r.clone().json().then(function(data){
              if (Array.isArray(data)) {
                lastHits = data;
                hitsByLabel = Object.create(null);
                data.forEach(function(d){
                  var k = String((d && (d.SEARCH_VALUE || d.NAMN || d.name)) || '').trim().toLowerCase();
                  if (k && !hitsByLabel[k]) hitsByLabel[k] = d;
                });
              }
            }).catch(function(){});
          } catch(e){}
        }).catch(function(){});
      }
      return p;
    };
  }

  document.addEventListener('click', function(ev){
    var el = ev.target;
    while (el && el.nodeType === 1) {
      // Origo's search hit list items typically use these classes; we try
      // several to be resilient to minor template differences.
      if (el.matches && (el.matches('.o-search-hit') || el.matches('.o-search-list li') || el.matches('li.o-search-list-item') || el.matches('[data-search-hit]'))) {
        var label = String(el.textContent || '').trim().toLowerCase();
        var hit = hitsByLabel[label];
        var pid = hit && (hit.project || hit.PROJECT || hit._qtiler_project);
        if (pid && pid !== window.__QTILER_CURRENT_PROJECT__) {
          var url = (window.__QTILER_PROJECT_MAP__ || {})[pid];
          if (url) {
            ev.preventDefault();
            ev.stopPropagation();
            window.open(url, '_blank');
            return;
          }
        }
        break;
      }
      el = el.parentNode;
    }
  }, true);
})();
</script>`;
        if (/<\/head>/i.test(html)) {
          html = html.replace(/<\/head>/i, injection + '\n</head>');
        } else {
          html = injection + html;
        }
      } catch (err) {
        console.warn('[Qtiler2Origo] failed to inject cross-project map:', err?.message || err);
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.set('Cache-Control', 'no-store');
      return res.send(html);
    } catch {
      return next();
    }
  });

  app.use(async (req, res, next) => {
    const mountPrefix = `/plugins/${pluginSlug}/origo`;
    if (!(req.path === mountPrefix || String(req.path || '').startsWith(`${mountPrefix}/`))) {
      return next();
    }

    const webRoot = await resolveQwc2WebRoot();
    if (!webRoot) {
      return res.status(404).json({ error: 'origo_not_installed' });
    }

    const rawPath = String(req.path || '').startsWith(mountPrefix)
      ? String(req.path || '').slice(mountPrefix.length)
      : '';
    const relativePath = !rawPath || rawPath === '/'
      ? 'index.html'
      : rawPath.replace(/^\/+/u, '');
    const resolvedRoot = path.resolve(webRoot);
    const resolvedFile = path.resolve(resolvedRoot, relativePath);

    if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) {
      return res.status(400).json({ error: 'invalid_path' });
    }

    try {
      await fs.promises.access(resolvedFile, fs.constants.R_OK);
      return res.sendFile(resolvedFile);
    } catch {
      return next();
    }
  });

  // Serve QWC2 from a stable path `/Qtiler2Origo/webmap` on the main server (same origin)
  // This ensures auth cookies and sessions are shared with Qtiler (port 3000).
  app.use('/Qtiler2Origo/webmap', async (req, res, next) => {
    res.set('X-Qtiler2Origo-Webmap', '1');
    // Backward-compatibility shim for stale/cached themes payloads where
    // thumbnail URLs were absolute and got prefixed by /Qtiler2Origo/webmap/assets/.
    // Example broken request:
    //   /Qtiler2Origo/webmap/assets/http://localhost:3000/plugins/Qtiler2Origo/api/thumbnail/...
    const originalUrl = String(req.originalUrl || '');
    const badPrefix = '/Qtiler2Origo/webmap/assets/';
    if (originalUrl.startsWith(`${badPrefix}http://`) || originalUrl.startsWith(`${badPrefix}https://`)) {
      const absolutePart = originalUrl.slice(badPrefix.length);
      try {
        const parsed = new URL(absolutePart);
        return res.redirect(302, `${parsed.pathname}${parsed.search}`);
      } catch {
        // fall through to normal handling
      }
    }

    // Let our runtime handlers serve config.json/themes.json so we can
    // sanitize/remove external references; delegate other requests to static.
    const p = req.path || '';
    if (p.endsWith('/config.json') || p.endsWith('/themes.json')) return next();

    // Gate viewer entry with project permissions when QtilerAuth is enabled.
    // Keep static assets unrestricted so the login/no-access page can render.
    const isEntryRequest = p === '' || p === '/' || p === '/index.html';
    const authActive = typeof security?.isEnabled === 'function' ? security.isEnabled() : false;
    if (authActive && isEntryRequest) {
      const allProfiles = await readAllPublishedProfiles().catch(() => []);
      const accessiblePublic = filterProfilesByAccess(allProfiles, null);
      const accessible = filterProfilesByAccess(allProfiles, req.user);
      if (!req.user && accessiblePublic.length === 0) {
        return res.status(401).type('html').send(buildNoAccessPage(true, false, null));
      }
      if (req.user && accessible.length === 0) {
        return res.status(403).type('html').send(buildNoAccessPage(true, true, req.user));
      }
    }

    try {
      const webRoot = await resolveQwc2WebRoot();
      if (!webRoot) return res.status(404).send('origo_not_installed');
      const mountPrefix = '/Qtiler2Origo/webmap';
      const originalUrl = req.url;
      const scopedUrl = String(req.originalUrl || '').startsWith(mountPrefix)
        ? String(req.originalUrl || '').slice(mountPrefix.length) || '/'
        : (req.url || '/');
      req.url = scopedUrl;
      return express.static(webRoot, { index: 'index.html' })(req, res, (err) => {
        req.url = originalUrl;
        return next(err);
      });
    } catch {
      return res.status(500).end();
    }
  });

  // Expose config.json and themes.json under the same path so QWC2 requests
  // from `/Qtiler2Origo/webmap` will resolve and use the server-side access control.
  app.get('/Qtiler2Origo/webmap/config.json', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      const authActive = typeof security?.isEnabled === 'function' ? security.isEnabled() : false;
      const profileId = profileFromReferer(req) || req.query?.qtiler_profile;
      const allProfiles = await readAllPublishedProfiles();
      const accessiblePublic = filterProfilesByAccess(allProfiles, null);
      const accessibleForUser = filterProfilesByAccess(allProfiles, req.user);
      if (authActive && !req.user && accessiblePublic.length === 0) {
        return res.status(401).json({ error: 'auth_required' });
      }
      if (authActive && req.user && accessibleForUser.length === 0) {
        return res.status(403).json({ error: 'map_access_denied' });
      }
      const accessible = req.user ? accessibleForUser : accessiblePublic;

      // Determine merged features and toolConfig similar to standalone logic
      let mergedFeatures = null;
      const selectedProfile = profileId ? findProfileMatch(accessible, profileId) : null;
      if (profileId) {
        if (selectedProfile?.features) mergedFeatures = selectedProfile.features;
      }
      if (!mergedFeatures && accessible.length === 1 && accessible[0]?.features) {
        mergedFeatures = accessible[0].features;
      }
      if (!mergedFeatures && accessible.length > 1) {
        mergedFeatures = {};
        for (const p of accessible) {
          if (!p.features) continue;
          for (const [k, v] of Object.entries(p.features)) {
            if (v === true) mergedFeatures[k] = true;
            else if (!(k in mergedFeatures)) mergedFeatures[k] = v;
          }
        }
      }

      let mergedToolConfig = null;
      if (profileId) {
        if (selectedProfile?.toolConfig) mergedToolConfig = selectedProfile.toolConfig;
      }
      if (!mergedToolConfig && accessible.length >= 1) mergedToolConfig = accessible[0]?.toolConfig || null;

      const requiredCrs = await collectRequiredCrsForProfiles(accessible);

      const activeProfile = selectedProfile || (accessible.length === 1 ? accessible[0] : null);
      const anyAuthRequiredProfile = accessible.some((p) => profileRequiresAuthentication(p));
      const authRequired = authActive && (
        (!!activeProfile && profileRequiresAuthentication(activeProfile))
        || (!!req.user && anyAuthRequiredProfile)
      );

      let config = await buildQwc2Config({
        hasMultipleThemes: accessible.length > 1,
        features: mergedFeatures,
        toolConfig: mergedToolConfig,
        requiredCrs,
        authRequired
      });

      // Final sanitation pass: ensure no external/demo service URLs or
      // catalog URLs remain in the runtime config returned to the browser.
      try {
        config = config || {};
        config.searchServiceUrl = '/Qtiler2Origo/search';
        config.searchDataServiceUrl = '';
        if (typeof config.editServiceUrl !== 'string' || !config.editServiceUrl.trim()) config.editServiceUrl = '/wfs';
        if (typeof config.mapInfoServiceUrl !== 'string' || !config.mapInfoServiceUrl.trim()) config.mapInfoServiceUrl = '/wms';
        config.permalinkServiceUrl = '';
        config.elevationServiceUrl = '';
        config.featureReportService = '';
        config.documentServiceUrl = '';
        config.authServiceUrl = authRequired ? '/auth/' : '';
        for (const section of ['common', 'mobile', 'desktop']) {
          const plugins = config.plugins?.[section];
          if (!Array.isArray(plugins)) continue;
          for (const p of plugins) {
            if (!p || !p.cfg) continue;
            if (typeof p.cfg.catalogUrl === 'string') p.cfg.catalogUrl = '';
            if (p.name === 'Editing' && (typeof p.cfg.serviceUrl !== 'string' || !p.cfg.serviceUrl.trim())) p.cfg.serviceUrl = '/wfs';
            if (p.name === 'Identify' && (typeof p.cfg.serviceUrl !== 'string' || !p.cfg.serviceUrl.trim())) p.cfg.serviceUrl = '/wms';
            if (!['Authentication', 'Identify', 'Editing', 'FeatureForm'].includes(p.name) && typeof p.cfg.serviceUrl === 'string') p.cfg.serviceUrl = '';
            if (typeof p.cfg.permalinkUrl === 'string') p.cfg.permalinkUrl = '';
            if (typeof p.cfg.tileInfoServiceUrl === 'string') p.cfg.tileInfoServiceUrl = '';
            if (typeof p.cfg.importedTilesBaseUrl === 'string') p.cfg.importedTilesBaseUrl = '';
          }
        }
        config.backgroundLayers = [];
        config.defaultBackgroundLayers = [];
      } catch (e) {
        // noop
      }

      res.json(config);
    } catch (e) {
      // If anything fails while building the runtime config, fall back to the
      // on-disk config.json but sanitize it to avoid leaking external URLs
      // (catalogs, demo permalink/search endpoints, etc.) that cause CORS
      // requests or connection errors in the browser.
      try {
        const webRoot = await resolveQwc2WebRoot().catch(() => '');
        if (!webRoot) return res.status(500).json({ error: 'origo_config_failed' });
        const raw = await fs.promises.readFile(path.join(webRoot, 'config.json'), 'utf8');
        let base = {};
        try { base = JSON.parse(raw); } catch { base = {}; }

        // Helper sanitize: clear service endpoints and external catalog URLs
        const clearServices = () => {
          base.searchServiceUrl = '/Qtiler2Origo/search';
          base.searchDataServiceUrl = '';
          if (typeof base.editServiceUrl !== 'string' || !base.editServiceUrl.trim()) base.editServiceUrl = '/wfs';
          if (typeof base.mapInfoServiceUrl !== 'string' || !base.mapInfoServiceUrl.trim()) base.mapInfoServiceUrl = '/wms';
          base.permalinkServiceUrl = '';
          base.elevationServiceUrl = '';
          base.featureReportService = '';
          base.documentServiceUrl = '';
          base.authServiceUrl = authRequired ? '/auth/' : '';
        };
        clearServices();

        for (const section of ['common', 'mobile', 'desktop']) {
          const plugins = base.plugins?.[section];
          if (!Array.isArray(plugins)) continue;
          for (const p of plugins) {
            if (!p || !p.cfg) continue;
            // Remove any external catalogUrl
            if (typeof p.cfg.catalogUrl === 'string') p.cfg.catalogUrl = '';
            if (p.name === 'Editing' && (typeof p.cfg.serviceUrl !== 'string' || !p.cfg.serviceUrl.trim())) p.cfg.serviceUrl = '/wfs';
            if (p.name === 'Identify' && (typeof p.cfg.serviceUrl !== 'string' || !p.cfg.serviceUrl.trim())) p.cfg.serviceUrl = '/wms';
            // Also clear any explicit service URLs inside plugin configs
            if (!['Authentication', 'Identify', 'Editing', 'FeatureForm'].includes(p.name) && typeof p.cfg.serviceUrl === 'string') p.cfg.serviceUrl = '';
            if (typeof p.cfg.permalinkUrl === 'string') p.cfg.permalinkUrl = '';
            if (typeof p.cfg.tileInfoServiceUrl === 'string') p.cfg.tileInfoServiceUrl = '';
            if (typeof p.cfg.importedTilesBaseUrl === 'string') p.cfg.importedTilesBaseUrl = '';
          }
          // Filter out demo-only plugins that may attempt external requests
          base.plugins[section] = plugins.filter((x) => x && x.name !== 'NewsPopup');
        }

        // Ensure background layers come from themes.json only
        base.backgroundLayers = [];
        base.defaultBackgroundLayers = [];

        return res.json(base);
      } catch (ee) {
        return res.status(500).json({ error: 'origo_config_failed' });
      }
    }
  });

  app.get('/Qtiler2Origo/webmap/themes.json', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      const authActive = typeof security?.isEnabled === 'function' ? security.isEnabled() : false;
      const profileId = profileFromReferer(req) || req.query?.qtiler_profile;
      const allProfiles = await readAllPublishedProfiles();
      const accessiblePublic = filterProfilesByAccess(allProfiles, null);
      const accessibleForUser = filterProfilesByAccess(allProfiles, req.user);
      if (authActive && !req.user && accessiblePublic.length === 0) {
        return res.status(401).json({ error: 'auth_required' });
      }
      if (authActive && req.user && accessibleForUser.length === 0) {
        return res.status(403).json({ error: 'map_access_denied' });
      }
      let accessible = req.user ? accessibleForUser : accessiblePublic;
      const selectedProfile = profileId ? findProfileMatch(accessible, profileId) : null;
      if (profileId) {
        const match = filterProfilesByToken(accessible, profileId);
        if (match.length) accessible = match;
      }
      if (accessible.length === 0) {
        if (authActive && !req.user) return res.status(401).json({ error: 'auth_required' });
        if (authActive) return res.status(403).json({ error: 'map_access_denied' });
        return res.json({ themes: { title: 'root', subdirs: [], items: [], backgroundLayers: [] } });
      }
      const qtilerBaseUrl = getRequestBaseUrl(req);
      const themes = await buildQwc2Themes(accessible, qtilerBaseUrl, { defaultTheme: selectedProfile?.projectId || null });
      res.json(normalizeThemesForQwc2Assets(themes));
    } catch {
      const webRoot = await resolveQwc2WebRoot().catch(()=>'');
      if (webRoot) return sendRebasedJsonFile(res, path.join(webRoot, 'themes.json'), getRequestBaseUrl(req));
      res.status(500).json({ error: 'origo_themes_failed' });
    }
  });

  app.get(`/plugins/${pluginSlug}/api/status`, portalEditorOnly, async (_req, res) => {
    const state = await readState();
    const installed = await hasQwc2Install();
    const branding = await getBrandingStatus();
    const authCatalog = readAuthCatalog();
    res.json({
      plugin: pluginSlug,
      installed,
      installPath: state.installPath,
      repo: state.repo,
      version: state.version,
      standalonePort: state.standalonePort,
      installedAt: state.installedAt,
      lastSyncAt: state.lastSyncAt,
      lastError: state.lastError,
      branding,
      authCatalog,
      origoUrl: installed ? `/plugins/${pluginSlug}/origo` : null,
      standalone: { running: false, port: null, url: null }
    });
  });

  app.get(`/plugins/${pluginSlug}/api/branding/logo`, portalEditorOnly, async (_req, res) => {
    const branding = await getBrandingStatus();
    res.json(branding);
  });

  app.post(`/plugins/${pluginSlug}/api/branding/logo`, portalEditorOnly, (req, res) => {
    logoUpload.single('logo')(req, res, async (err) => {
      if (err) {
        const msg = String(err?.message || err || 'logo_upload_failed');
        if (msg.includes('File too large') || err?.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'logo_too_large', details: `max_bytes_${MAX_LOGO_BYTES}` });
        }
        if (msg.includes('invalid_logo_extension')) {
          return res.status(400).json({ error: 'invalid_logo_extension' });
        }
        return res.status(400).json({ error: 'logo_upload_failed', details: msg });
      }

      try {
        const uploaded = req.file;
        if (!uploaded || !uploaded.buffer || !uploaded.originalname) {
          return res.status(400).json({ error: 'logo_required' });
        }

        const ext = path.extname(String(uploaded.originalname || '')).toLowerCase();
        if (!ALLOWED_LOGO_EXTENSIONS.has(ext)) {
          return res.status(400).json({ error: 'invalid_logo_extension' });
        }

        const nextFile = `logo-${Date.now()}${ext}`;
        const nextPath = path.join(brandingRoot, nextFile);
        await fs.promises.mkdir(brandingRoot, { recursive: true });
        await fs.promises.writeFile(nextPath, uploaded.buffer);

        const prevState = await readState();
        if (prevState.logoFile && prevState.logoFile !== nextFile) {
          const oldPath = path.join(brandingRoot, prevState.logoFile);
          await fs.promises.rm(oldPath, { force: true }).catch(() => {});
        }

        const updatedAt = nowIso();
        await stateStore.update((draft) => ({
          ...(draft || {}),
          logoFile: nextFile,
          logoUpdatedAt: updatedAt,
          lastError: null
        }));

        await applyBrandingToQwc2Configs();
        const branding = await getBrandingStatus();
        return res.status(201).json({ status: 'logo_uploaded', branding });
      } catch (uploadErr) {
        return res.status(500).json({ error: 'logo_upload_failed', details: String(uploadErr?.message || uploadErr) });
      }
    });
  });

  app.use(`/plugins/${pluginSlug}/portal-assets`, express.static(portalAssetsRoot, {
    fallthrough: false,
    immutable: true,
    maxAge: '30d'
  }));

  app.post(`/plugins/${pluginSlug}/api/portal-assets/image`, portalEditorOnly, (req, res) => {
    portalImageUpload.single('image')(req, res, async (err) => {
      if (err) {
        const msg = String(err?.message || err || 'portal_image_upload_failed');
        if (msg.includes('File too large') || err?.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'portal_image_too_large', details: `max_bytes_${MAX_PORTAL_IMAGE_BYTES}` });
        }
        if (msg.includes('invalid_portal_image_extension')) {
          return res.status(400).json({ error: 'invalid_portal_image_extension' });
        }
        return res.status(400).json({ error: 'portal_image_upload_failed', details: msg });
      }

      try {
        const uploaded = req.file;
        if (!uploaded || !uploaded.buffer || !uploaded.originalname) {
          return res.status(400).json({ error: 'portal_image_required' });
        }

        const ext = path.extname(String(uploaded.originalname || '')).toLowerCase();
        if (!ALLOWED_PORTAL_IMAGE_EXTENSIONS.has(ext)) {
          return res.status(400).json({ error: 'invalid_portal_image_extension' });
        }

        const stem = sanitizeFileToken(path.basename(String(uploaded.originalname || 'image'), ext)).slice(0, 80) || 'image';
        const fileName = `${Date.now()}-${stem}${ext}`;
        const targetPath = path.join(portalAssetsRoot, fileName);
        await fs.promises.mkdir(portalAssetsRoot, { recursive: true });
        await fs.promises.writeFile(targetPath, uploaded.buffer);
        const url = `/plugins/${pluginSlug}/portal-assets/${encodeURIComponent(fileName)}`;
        return res.status(201).json({ status: 'uploaded', url });
      } catch (uploadErr) {
        return res.status(500).json({ error: 'portal_image_upload_failed', details: String(uploadErr?.message || uploadErr) });
      }
    });
  });

  // List available portal assets (images)
  app.get(`/plugins/${pluginSlug}/api/portal-assets`, portalEditorOnly, async (_req, res) => {
    try {
      const files = await fs.promises.readdir(portalAssetsRoot, { withFileTypes: true });
      const items = [];
      for (const f of files) {
        if (!f.isFile()) continue;
        const ext = path.extname(f.name).toLowerCase();
        if (!ALLOWED_PORTAL_IMAGE_EXTENSIONS.has(ext)) continue;
        try {
          const stat = await fs.promises.stat(path.join(portalAssetsRoot, f.name));
          items.push({
            fileName: f.name,
            url: `/plugins/${pluginSlug}/portal-assets/${encodeURIComponent(f.name)}`,
            size: stat.size,
            mtime: stat.mtime.toISOString()
          });
        } catch (statErr) { /* ignore per-file stat errors */ }
      }
      // sort newest first
      items.sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''));
      res.json({ items });
    } catch (err) {
      res.status(500).json({ error: 'portal_assets_list_failed', details: String(err?.message || err) });
    }
  });

  app.delete(`/plugins/${pluginSlug}/api/branding/logo`, portalEditorOnly, async (_req, res) => {
    try {
      const state = await readState();
      if (state.logoFile) {
        const target = path.join(brandingRoot, state.logoFile);
        await fs.promises.rm(target, { force: true }).catch(() => {});
      }

      await stateStore.update((draft) => ({
        ...(draft || {}),
        logoFile: null,
        logoUpdatedAt: null,
        lastError: null
      }));

      await applyBrandingToQwc2Configs();
      const branding = await getBrandingStatus();
      res.json({ status: 'logo_removed', branding });
    } catch(err) { console.error('XERR', err);
      res.status(500).json({ error: 'logo_remove_failed', details: String(err?.message || err) });
    }
  });

  // Standalone start/stop endpoints removed — QWC2 is served via /Qtiler2Origo/webmap

  app.get(`/plugins/${pluginSlug}/api/releases`, adminOnly, async (req, res) => {
    try {
      const repo = String(req.query?.repo || DEFAULT_REPO).trim();
      const includePrerelease = req.query?.prerelease === '1' || req.query?.prerelease === 'true';
      const releases = await fetchGitHubReleases(repo, { includePrerelease, maxResults: 30 });
      res.json({ releases, repo, defaultVersion: DEFAULT_VERSION });
    } catch(err) { console.error('XERR', err);
      res.status(502).json({ error: 'github_fetch_failed', details: String(err?.message || err) });
    }
  });

  app.post(`/plugins/${pluginSlug}/api/install`, adminOnly, async (req, res) => {
    const repo = String(req.body?.repo || DEFAULT_REPO).trim();
    const version = String(req.body?.version || DEFAULT_VERSION).trim();
    const downloadUrl = buildDownloadUrl(repo, version);

    let tempDir;
    try {
      tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'Qtiler2Origo-origo-'));
      const zipPath = path.join(tempDir, 'origo.zip');
      const extractDir = path.join(tempDir, 'extract');
      await fs.promises.mkdir(extractDir, { recursive: true });

      await requestDownload(downloadUrl, zipPath);
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractDir, true);

      const extractedRoot = await locateExtractRoot(extractDir);
      await removeRecursive(installRoot);
      await copyRecursive(extractedRoot, installRoot);

      await stateStore.update((draft) => ({
        ...(draft || {}),
        repo,
        version,
        installPath: installRoot,
        installedAt: nowIso(),
        lastError: null
      }));

      await applyBrandingToQwc2Configs();

      res.json({
        status: 'installed',
        repo,
        version,
        origoUrl: `/plugins/${pluginSlug}/origo`
      });
    } catch(err) { console.error('XERR', err);
      await stateStore.update((draft) => ({
        ...(draft || {}),
        repo,
        version,
        installPath: installRoot,
        lastError: String(err?.message || err)
      }));
      res.status(500).json({ error: 'install_failed', details: String(err?.message || err) });
    } finally {
      if (tempDir) {
        await removeRecursive(tempDir).catch(() => {});
      }
    }
  });

  app.delete(`/plugins/${pluginSlug}/api/install`, adminOnly, async (_req, res) => {
    try {
      // Standalone no longer used — nothing to stop
      await removeRecursive(installRoot);
      await stateStore.update((draft) => ({
        ...(draft || {}),
        installedAt: null,
        lastError: null
      }));
      res.json({ status: 'uninstalled' });
    } catch(err) { console.error('XERR', err);
      res.status(500).json({ error: 'uninstall_failed', details: String(err?.message || err) });
    }
  });

  app.get(`/plugins/${pluginSlug}/api/projects`, async (req, res) => {
    try {
      const baseUrl = getRequestBaseUrl(req);
      const payload = await buildProjectsCatalog(req.user || null, baseUrl);
      res.json(payload);
    } catch(err) { console.error('XERR', err);
      res.status(500).json({ error: 'projects_catalog_failed', details: String(err?.message || err) });
    }
  });

  app.post(`/plugins/${pluginSlug}/api/sync-projects`, adminOnly, async (req, res) => {
    try {
      const configuredBaseUrl = String(req.body?.baseUrl || '').trim();
      const baseUrl = configuredBaseUrl || getRequestBaseUrl(req);
      const payload = await buildProjectsCatalog(req.user || null, baseUrl);
      await fs.promises.mkdir(path.dirname(projectsCatalogPath), { recursive: true });
      await fs.promises.writeFile(projectsCatalogPath, JSON.stringify(payload, null, 2), 'utf8');

      await stateStore.update((draft) => ({
        ...(draft || {}),
        lastSyncAt: nowIso(),
        lastError: null
      }));

      res.json({ status: 'synced', projects: payload.projects.length, catalogPath: projectsCatalogPath });
    } catch(err) { console.error('XERR', err);
      await stateStore.update((draft) => ({
        ...(draft || {}),
        lastError: String(err?.message || err)
      }));
      res.status(500).json({ error: 'sync_failed', details: String(err?.message || err) });
    }
  });

  app.post(`/plugins/${pluginSlug}/api/publish`, adminOnly, express.json({ limit: '50mb' }), async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim();
      if (!name) {
        return res.status(400).json({ error: 'name_required' });
      }
      const description = String(req.body?.description || '').trim();

      const projectId = normalizeProjectId(req.body?.projectId);
      if (!projectId) {
        return res.status(400).json({ error: 'project_id_required' });
      }

      const knownProjects = await listProjectsFromDisk(projectsDir);
      const knownProjectIds = new Set(knownProjects.map((p) => p && p.id).filter(Boolean));
      const hasMainProject = knownProjects.some((p) => p && p.id === projectId);
      if (!hasMainProject) {
        return res.status(404).json({ error: 'project_not_found' });
      }

      // Accept either an explicit `layers` array (objects with name/visible)
      // or the older `layerNames` array of strings for backward compatibility.
      const inputLayers = Array.isArray(req.body?.layers) ? req.body.layers : null;
      const layerNames = toArray(req.body?.layerNames || (inputLayers ? inputLayers.map((l) => l.name) : []));
      if (!layerNames.length) {
        return res.status(400).json({ error: 'layer_names_required' });
      }

      const backgroundProjectId = normalizeProjectId(req.body?.backgroundProjectId || '');
      if (backgroundProjectId) {
        const hasBackgroundProject = knownProjects.some((p) => p && p.id === backgroundProjectId);
        if (!hasBackgroundProject) {
          return res.status(404).json({ error: 'background_project_not_found' });
        }
      }
      const backgroundLayerNames = toArray(req.body?.backgroundLayerNames);
      const backgroundSelection = normalizeBackgroundSelection({
        backgroundsInput: req.body?.backgrounds,
        defaultBackgroundKeyInput: req.body?.defaultBackgroundKey,
        fallbackBackgroundProjectId: backgroundProjectId,
        fallbackBackgroundLayerNames: backgroundLayerNames,
        knownProjectIds
      });
      const featuresInput = req.body?.features && typeof req.body.features === 'object' ? req.body.features : {};
      const layerRulesInput = req.body?.layerRules && typeof req.body.layerRules === 'object' ? req.body.layerRules : {};
      const features = {
        search: featuresInput.search !== false,
        editing: featuresInput.editing !== false,
        identify: featuresInput.identify !== false,
        layerTree: featuresInput.layerTree !== false,
        legend: featuresInput.legend !== false,
        measurement: featuresInput.measurement === true,
        print: featuresInput.print !== false,
        share: featuresInput.share === true,
        redlining: featuresInput.redlining === true,
        bookmark: featuresInput.bookmark === true,
        mapTip: featuresInput.mapTip !== false,
        heightProfile: featuresInput.heightProfile === true,
        dxfExport: featuresInput.dxfExport === true,
        attributeTable: featuresInput.attributeTable === true,
        routing: featuresInput.routing === true,
        searchGlobal: featuresInput.searchGlobal === true,
        view3d: featuresInput.view3d === true,
        // Cross-project search sources: [{ projectId, layers: [name, ...] }, ...]
        searchSources: Array.isArray(featuresInput.searchSources)
          ? featuresInput.searchSources
              .map((src) => {
                if (!src || typeof src !== 'object') return null;
                const pid = String(src.projectId || '').trim();
                if (!pid) return null;
                const layers = Array.isArray(src.layers)
                  ? Array.from(new Set(src.layers
                      .map((l) => String(l || '').trim())
                      .filter(Boolean)))
                  : [];
                return { projectId: pid, layers };
              })
              .filter(Boolean)
          : []
      };

      // Merge per-layer visibility from provided `layers` payload when available.
      const incomingVisibility = {};
      if (Array.isArray(inputLayers)) {
        for (const l of inputLayers) {
          if (l && typeof l === 'object' && l.name) {
            const srcPid = normalizeProjectId(l.sourceProjectId || projectId) || projectId;
            incomingVisibility[`${srcPid}::${String(l.name)}`] = !!l.visible;
          }
        }
      }

      const incomingGroupByName = {};
      if (Array.isArray(inputLayers)) {
        for (const l of inputLayers) {
          if (l && typeof l === 'object' && l.name && l.group) {
            const srcPid = normalizeProjectId(l.sourceProjectId || projectId) || projectId;
            incomingGroupByName[`${srcPid}::${String(l.name)}`] = String(l.group);
          }
        }
      }
      const layerEntries = Array.isArray(inputLayers) && inputLayers.length
        ? inputLayers.filter((l) => l && typeof l === 'object' && String(l.name || '').trim())
        : layerNames.map((name) => ({ name, sourceProjectId: projectId }));
      const publishIssues = await validatePublishLayerReferences({
        projectId,
        layerEntries,
        backgroundSelection,
        rawBackgrounds: req.body?.backgrounds,
        defaultBackgroundKey: req.body?.defaultBackgroundKey,
        layerRulesInput,
        features,
        extent: req.body?.extent,
        center: req.body?.center,
        zoom: req.body?.zoom,
        minZoom: req.body?.minZoom,
        maxZoom: req.body?.maxZoom,
        knownProjectIds
      });
      if (publishIssues.length) {
        return res.status(400).json({
          error: 'publish_validation_failed',
          details: 'The map cannot be published because one or more selected projects or layers are invalid.',
          issues: publishIssues
        });
      }
      if (req.body?.dryRun === true) {
        return res.json({ ok: true, dryRun: true, issues: [] });
      }
      const projectLayerFlagsByProject = new Map();
      for (const entry of layerEntries) {
        const sourceProjectId = normalizeProjectId(entry?.sourceProjectId || projectId) || projectId;
        if (!projectLayerFlagsByProject.has(sourceProjectId)) {
          projectLayerFlagsByProject.set(sourceProjectId, await readProjectLayerFlags(sourceProjectId));
        }
      }
      const layers = layerEntries.map((sourceLayer) => {
        const name = String(sourceLayer?.name || '').trim();
        const sourceProjectId = normalizeProjectId(sourceLayer?.sourceProjectId || projectId) || projectId;
        const authFlags = resolveLayerFlagEntry(projectLayerFlagsByProject.get(sourceProjectId), name);
        const themeName = String(sourceLayer?.themeName || (name.startsWith('theme:') ? name.slice('theme:'.length) : '')).trim();
        const isTheme = sourceLayer?.isTheme === true || !!themeName;
        const layerRuleKey = `${sourceProjectId}::${name}`;
        const rule = layerRulesInput[layerRuleKey] && typeof layerRulesInput[layerRuleKey] === 'object'
          ? layerRulesInput[layerRuleKey]
          : ((layerRulesInput[name] && typeof layerRulesInput[name] === 'object') ? layerRulesInput[name] : {});
        const fallbackSearchable = sourceLayer?.searchable === true || authFlags?.wfsSearchable === true;
        // Do not implicitly enable editable/WFS purely because the server-level
        // auth flags allow editing. Admins must explicitly opt-in to editing
        // in the published profile. Preserve per-layer `editable` from
        // source project metadata but do not use auth flags as a default.
        const fallbackEditable = sourceLayer?.editable === true;
        const fallbackServeAsWfs = sourceLayer?.serveAsWfs === true;
        const fallbackSearchAttribute = String(sourceLayer?.searchAttribute || '').trim() || null;
        const fallbackIdAttribute = String(sourceLayer?.idAttribute || '').trim() || null;
        const fallbackGeometryAttribute = String(sourceLayer?.geometryAttribute || '').trim() || null;
        const fallbackHintText = String(sourceLayer?.hintText || '').trim() || null;
        const fallbackAttributes = Array.isArray(sourceLayer?.attributes) ? sourceLayer.attributes : [];
        // Preserve wfsStyle from the style editor without implicitly forcing
        // the layer onto the WFS path. WFS stays explicit via serveAsWfs/editable.
        const ruleHasStyle = rule && (rule.wfsStyle !== undefined && rule.wfsStyle !== null);
        const out = {
          name,
          title: String(sourceLayer?.title || (isTheme ? themeName : name)).trim() || name,
          sourceProjectId,
          role: 'main',
          visible: (typeof incomingVisibility[layerRuleKey] === 'undefined') ? true : !!incomingVisibility[layerRuleKey],
          group: incomingGroupByName[layerRuleKey] || String(rule.group || sourceLayer?.group || 'root'),
          searchable: isTheme ? false : ((rule.searchable === true) || fallbackSearchable),
          editable: isTheme ? false : ((rule.editable === true) || fallbackEditable),
          // Serve as WFS only when explicitly requested (serveAsWfs true) or
          // when the layer is editable (explicit or from source metadata).
          // Do NOT force WFS simply because authFlags allow editing on the
          // server side — that would cause WMS layers to be misclassified.
          serveAsWfs: isTheme ? false : (rule.serveAsWfs === true || fallbackServeAsWfs || (rule.editable === true) || fallbackEditable),
          searchAttribute: String(rule.searchAttribute || '').trim() || fallbackSearchAttribute,
          idAttribute: String(rule.idAttribute || '').trim() || fallbackIdAttribute,
          geometryAttribute: String(rule.geometryAttribute || '').trim() || fallbackGeometryAttribute,
          hintText: String(rule.hintText || '').trim() || fallbackHintText
        };
        if (isTheme) {
          out.isTheme = true;
          out.themeName = themeName;
        }
        if (ruleHasStyle) out.wfsStyle = rule.wfsStyle;
        const wmsLegendMode = String(rule?.wmsLegendMode || '').trim().toLowerCase();
        const wmsLegendIcon = String(rule?.wmsLegendIcon || rule?.legendIcon || '').trim();
        const wmsLegendUrl = String(rule?.wmsLegendUrl || rule?.legend || '').trim();
        if (['manual', 'svg', 'library', 'auto', 'thumbnail'].includes(wmsLegendMode)) out.wmsLegendMode = wmsLegendMode;
        if (wmsLegendIcon) out.wmsLegendIcon = wmsLegendIcon;
        if (wmsLegendUrl) out.wmsLegendUrl = wmsLegendUrl;
        if (rule?.designerOptions && typeof rule.designerOptions === 'object' && Object.keys(rule.designerOptions).length) {
          out.designerOptions = rule.designerOptions;
        }
        // Persist user-defined infoclick attributes so the editor can restore
        // them, and so buildOrigoIndexConfig can apply them as the popup
        // attribute filter for both WFS and WMS layers.
        const rawRuleAttributes = Array.isArray(rule.attributes) && rule.attributes.length
          ? rule.attributes
          : fallbackAttributes;
        if (Array.isArray(rawRuleAttributes) && rawRuleAttributes.length) {
          out.attributes = normalizeInfoclickAttributes(rawRuleAttributes)
            .map((a) => {
              if (!a || typeof a !== 'object') return null;
              if (String(a.html || '').trim()) {
                return { html: String(a.html) };
              }
              const name = String(a.name || '').trim();
              if (!name) return null;
              return {
                name,
                ...(a.type ? { type: String(a.type) } : {}),
                ...(a.title ? { title: String(a.title) } : {}),
                ...(a.url ? { url: String(a.url) } : {}),
                ...(typeof a.maxLength === 'number' ? { maxLength: a.maxLength } : {}),
                ...(Array.isArray(a.options) ? { options: a.options.map(String) } : {})
              };
            })
            .filter(Boolean);
          if (!out.attributes.length) delete out.attributes;
        }
        const gType = String(rule.geometryType || sourceLayer?.geometryType || '').trim();
        if (gType) out.geometryType = gType;
        return out;
      });

      if (backgroundProjectId && backgroundLayerNames.length) {
        for (const name of backgroundLayerNames) {
          layers.push({
            name,
            sourceProjectId: backgroundProjectId,
            role: 'background',
            searchable: false,
            editable: false,
            searchAttribute: null,
            idAttribute: null,
            geometryAttribute: null,
            hintText: null
          });
        }
      }

      const toolConfigInput = req.body?.toolConfig && typeof req.body.toolConfig === 'object' ? req.body.toolConfig : {};
      const toolConfig = {
        shareServiceUrl: String(toolConfigInput.shareServiceUrl || '').trim(),
        routingServiceUrl: String(toolConfigInput.routingServiceUrl || '').trim(),
        elevationServiceUrl: String(toolConfigInput.elevationServiceUrl || '').trim(),
        dxfExportServiceUrl: String(toolConfigInput.dxfExportServiceUrl || '').trim()
      };

      // Optional map view parameters sent by the admin UI
      const rawCenter = req.body?.center;
      const rawCenterCrs = req.body?.centerCrs;
      const rawZoom   = req.body?.zoom;
      const rawExtent = req.body?.extent;
      const rawControls = req.body?.controls;
      const rawGroups   = req.body?.groups;

      const mapCenter  = Array.isArray(rawCenter) && rawCenter.length === 2 ? rawCenter.map(Number) : null;
      const mapCenterCrs = String(rawCenterCrs || '').trim() || null;
      const mapZoom    = typeof rawZoom === 'number' && Number.isFinite(rawZoom) ? rawZoom : null;
      const mapExtent  = Array.isArray(rawExtent) && rawExtent.length === 4 ? rawExtent.map(Number) : null;
      const mapControls = Array.isArray(rawControls) ? rawControls : null;
      const mapGroups   = Array.isArray(rawGroups) ? rawGroups : null;
      const rawMinZoom = req.body?.minZoom;
      const rawMaxZoom = req.body?.maxZoom;
      const mapMinZoom = Number.isFinite(Number(rawMinZoom)) ? Number(rawMinZoom) : null;
      const mapMaxZoom = Number.isFinite(Number(rawMaxZoom)) ? Number(rawMaxZoom) : null;

      const payload = {
        generatedAt: nowIso(),
        plugin: pluginSlug,
        name,
        description: description || null,
        projectId,
        backgroundProjectId: backgroundProjectId || null,
        backgroundLayerNames,
        backgrounds: backgroundSelection.backgrounds,
        defaultBackgroundKey: backgroundSelection.defaultBackgroundKey,
        features,
        toolConfig,
        layers,
        ...(mapCenter  !== null ? { center: mapCenter }  : {}),
        ...(mapCenterCrs !== null ? { centerCrs: mapCenterCrs } : {}),
        ...(mapZoom    !== null ? { zoom: mapZoom }       : {}),
        ...(mapExtent  !== null ? { extent: mapExtent }   : {}),
        ...(mapMinZoom !== null ? { minZoom: mapMinZoom } : {}),
        ...(mapMaxZoom !== null ? { maxZoom: mapMaxZoom } : {}),
        ...(mapControls !== null ? { controls: mapControls } : {}),
        ...(mapGroups   !== null ? { groups: mapGroups }  : {}),
        services: {
          map: `/map?project=${encodeURIComponent(projectId)}`,
          wmsCapabilities: `/wms?SERVICE=WMS&REQUEST=GetCapabilities&project=${encodeURIComponent(projectId)}`,
          wfsCapabilities: `/wfs?SERVICE=WFS&REQUEST=GetCapabilities&project=${encodeURIComponent(projectId)}`,
          wmtsCapabilities: `/wmts/${encodeURIComponent(projectId)}/WMTSCapabilities.xml`
        }
      };

      // Use sanitized name as filename so names are unique on disk
      const profileKey = sanitizeFileToken(name);
      const targetPath = path.join(publishedRoot, `${profileKey}.json`);

      // Check unique name (skip if editing same profile)
      const existingProfileId = req.body?.editingProfileId || null;
      if (!existingProfileId || sanitizeFileToken(existingProfileId) !== profileKey) {
        try {
          await fs.promises.access(targetPath, fs.constants.F_OK);
          return res.status(409).json({ error: 'name_duplicate' });
        } catch { /* file doesn't exist — name is available */ }
      }

      await fs.promises.mkdir(publishedRoot, { recursive: true });
      await fs.promises.writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf8');
      const syncBaseUrl = getRequestBaseUrl(req).replace(/\/+$/,'');
      const previousThumbMeta = await readPublishedThumbnailMeta(profileKey).catch(() => null);
      const generatedThumbMeta = await regeneratePublishedThumbnail({
        profileKey,
        profile: payload,
        baseUrl: syncBaseUrl,
        cookieHeader: req.headers.cookie,
        apiKey: getRequestApiKey(req),
        authorization: req.get?.('authorization') || ''
      }).catch((thumbErr) => {
        console.warn('[Qtiler2Origo] published thumbnail regeneration warning:', thumbErr?.message || thumbErr);
        return null;
      });
      void syncRuntimeFilesForProfile(payload, syncBaseUrl).catch((syncErr) => {
        console.warn('[Qtiler2Origo] publish runtime sync warning:', syncErr?.message || syncErr);
      });

      // If editing and name changed, remove old profile file
      if (existingProfileId && sanitizeFileToken(existingProfileId) !== profileKey) {
        const oldPath = publishedProfilePath(existingProfileId);
        await fs.promises.rm(oldPath, { force: true }).catch(() => {});
      }

      const state = await readState();
      const base = syncBaseUrl;
      res.json({
        status: 'published',
        name,
        projectId,
        file: targetPath,
        catalogUrl: `/plugins/${pluginSlug}/api/projects`,
        // Use the plugin-local Origo path for launching the map.
        launchUrl: `${base}/plugins/${pluginSlug}/origo/?qtiler_profile=${encodeURIComponent(profileKey)}#/?t=${encodeURIComponent(projectId)}`,
        publishedConfigUrl: `${base}/plugins/${pluginSlug}/published/${encodeURIComponent(profileKey)}.json`,
        thumbnailUrl: generatedThumbMeta?.url ? `${base}${generatedThumbMeta.url}` : (previousThumbMeta?.url ? `${base}${previousThumbMeta.url}` : '')
      });
    } catch(err) { console.error('XERR', err);
      res.status(500).json({ error: 'publish_failed', details: String(err?.message || err) });
    }
  });

  // Admin action: remove bundled demo theme from installed QWC2 configs
  app.post(`/plugins/${pluginSlug}/api/remove-demo`, adminOnly, async (req, res) => {
    try {
      const candidates = [];
      const webRoot = await resolveQwc2WebRoot().catch(() => null);
      if (webRoot) candidates.push(path.join(webRoot, 'themesConfig.json'));
      // Also check data area where installer may keep current themes
      candidates.push(path.join(process.cwd(), 'data', 'Qtiler2Origo', 'origo', 'current', 'themesConfig.json'));

      let touched = 0;
      for (const fp of candidates) {
        try {
          const raw = await fs.promises.readFile(fp, 'utf8');
          const parsed = JSON.parse(raw || '{}');
          if (parsed?.themes?.items && Array.isArray(parsed.themes.items)) {
            const before = parsed.themes.items.length;
            parsed.themes.items = parsed.themes.items.filter((it) => String(it?.id || '').trim() !== 'qwc_demo');
            if (parsed.themes.backgroundLayers && Array.isArray(parsed.themes.backgroundLayers)) {
              parsed.themes.backgroundLayers = parsed.themes.backgroundLayers.filter((b) => String(b?.name || '').trim() !== 'qwc_demo');
            }
            if (parsed.themes.items.length !== before) {
              // Adjust defaultTheme if it pointed to the demo
              if (String(parsed.themes.defaultTheme || '').trim() === 'qwc_demo') {
                parsed.themes.defaultTheme = parsed.themes.items[0]?.id || null;
              }
              await fs.promises.writeFile(fp, JSON.stringify(parsed, null, 2), 'utf8');
              touched += 1;
            }
          }
        } catch (e) {
          // ignore unreadable/missing files
        }
      }

      res.json({ removed: touched });
    } catch(err) { console.error('XERR', err);
      res.status(500).json({ error: 'remove_demo_failed', details: String(err?.message || err) });
    }
  });

  app.get(`/plugins/${pluginSlug}/api/publish/list`, portalEditorOnly, async (req, res) => {
    try {
      const baseUrl = getRequestBaseUrl(req);
      const items = await collectPublishedProfiles(baseUrl, { apiKey: getRequestApiKey(req) });
      res.json({ items });
    } catch(err) { console.error('XERR', err);
      res.status(500).json({ error: 'publish_list_failed', details: String(err?.message || err) });
    }
  });

  // Duplicate a published webmap profile under a new name.
  // Body: { source: <existingProfileKey>, name: <newDisplayName> }
  // Responds 409 if `name` collides with an existing profile, 404 if `source`
  // is missing, 200 with the new profile metadata otherwise.
  app.post(`/plugins/${pluginSlug}/api/publish/duplicate`, adminOnly, async (req, res) => {
    try {
      const sourceKey = String(req.body?.source || '').trim();
      const newName = String(req.body?.name || '').trim();
      if (!sourceKey || !newName) return res.status(400).json({ error: 'missing_params' });
      const sourcePath = path.join(publishedRoot, `${sanitizeFileToken(sourceKey)}.json`);
      let raw;
      try {
        raw = await fs.promises.readFile(sourcePath, 'utf8');
      } catch {
        return res.status(404).json({ error: 'source_not_found' });
      }
      const newKey = sanitizeFileToken(newName);
      if (!newKey) return res.status(400).json({ error: 'invalid_name' });
      const targetPath = path.join(publishedRoot, `${newKey}.json`);
      try {
        await fs.promises.access(targetPath, fs.constants.F_OK);
        return res.status(409).json({ error: 'name_duplicate' });
      } catch { /* OK — name available */ }
      let parsed;
      try { parsed = JSON.parse(raw); } catch { return res.status(500).json({ error: 'source_invalid_json' }); }
      // Re-stamp identity fields so the duplicate is independent.
      parsed.name = newName;
      parsed.profileKey = newKey;
      parsed.generatedAt = new Date().toISOString();
      await fs.promises.mkdir(publishedRoot, { recursive: true });
      await fs.promises.writeFile(targetPath, JSON.stringify(parsed, null, 2), 'utf8');
      const sourceThumbPath = publishedThumbnailPath(sourceKey);
      const targetThumbPath = publishedThumbnailPath(newKey);
      try {
        await fs.promises.mkdir(publishedThumbsRoot, { recursive: true });
        await fs.promises.copyFile(sourceThumbPath, targetThumbPath);
      } catch (_) {
        await regeneratePublishedThumbnail({
          profileKey: newKey,
          profile: parsed,
          baseUrl: getRequestBaseUrl(req).replace(/\/+$/,''),
          cookieHeader: req.headers.cookie,
          apiKey: getRequestApiKey(req),
          authorization: req.get?.('authorization') || ''
        }).catch(() => null);
      }
      try { await syncRuntimeFilesForProfile(parsed, getRequestBaseUrl(req).replace(/\/+$/,'')); } catch (e) { console.warn('duplicate sync warn', e?.message || e); }
      const base = getRequestBaseUrl(req).replace(/\/+$/,'');
      res.json({
        status: 'duplicated',
        name: newName,
        profileKey: newKey,
        publishedConfigUrl: `${base}/plugins/${pluginSlug}/published/${encodeURIComponent(newKey)}.json`
      });
    } catch(err) { console.error('XERR duplicate', err);
      res.status(500).json({ error: 'duplicate_failed', details: String(err?.message || err) });
    }
  });

  // Public maps catalog: returns only profiles whose underlying project the
  // current user can access (anonymous users only see public projects).
  // Also reports auth status so the maps portal can render a login UI.
  app.get(`/plugins/${pluginSlug}/api/public-maps`, async (req, res) => {
    try {
      const baseUrl = getRequestBaseUrl(req);
      const all = await collectPublishedProfiles(baseUrl, { apiKey: getRequestApiKey(req) });
      const state = await readPortalPagesState();
      const authActive = typeof security?.isEnabled === 'function' ? security.isEnabled() : false;
      let items = all;
      if (authActive) {
        const snapshot = readAccessSnapshot(dataRoot);
        items = all.filter((p) => userCanAccessProject(snapshot, req.user || null, p.projectId));
      }
      let logoUrl = null;
      try { logoUrl = await getLogoPublicUrl(); } catch { logoUrl = null; }
      // Fallback to bundled Qtiler logo when no custom branding is uploaded.
      if (!logoUrl) logoUrl = '/css/images/Qtiler.png';
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json({
        authActive,
        user: req.user ? { id: req.user.id, username: req.user.username || req.user.id, role: req.user.role || null } : null,
        logoUrl,
        gdpr: state.gdpr,
        site: state.site || {},
        items
      });
    } catch (err) {
      console.error('XERR public-maps', err);
      res.status(500).json({ error: 'public_maps_failed', details: String(err?.message || err) });
    }
  });

  // Lantmäteriet API proxy - provides secure access to cadastral and population info by coordinates
  app.get(`/plugins/${pluginSlug}/api/lantmateri-proxy`, async (req, res) => {
    try {
      const infoType = String(req.query?.type || 'fastighet').trim();
      const lon = parseFloat(req.query?.lon);
      const lat = parseFloat(req.query?.lat);

      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        return res.status(400).json({ error: 'Invalid coordinates', required: 'lon and lat parameters' });
      }

      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        return res.status(400).json({ error: 'Coordinates out of range' });
      }

      // Check if user has access (authenticated users or public if auth is disabled)
      const authActive = typeof security?.isEnabled === 'function' ? security.isEnabled() : false;
      if (authActive && !req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const results = await fetchLantmateriInfo(infoType, lon, lat);
      res.json({ results });
    } catch (err) {
      console.error('[Qtiler2Origo] Lantmäteri info error:', err);
      res.status(500).json({ error: 'Request failed', details: String(err?.message || err) });
    }
  });

  const collectGeoJsonCoordinates = (value, out = []) => {
    if (!Array.isArray(value)) return out;
    if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
      out.push([Number(value[0]), Number(value[1])]);
      return out;
    }
    for (const child of value) collectGeoJsonCoordinates(child, out);
    return out;
  };
  const summarizeAreaGeometry = (geometry) => {
    if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
      throw new Error('Only Polygon and MultiPolygon geometries are supported');
    }
    const coords = collectGeoJsonCoordinates(geometry.coordinates);
    if (coords.length < 4) throw new Error('Area geometry has too few coordinates');
    if (coords.length > 1000) throw new Error('Area geometry is too complex');
    const bbox = coords.reduce((acc, coord) => ([
      Math.min(acc[0], coord[0]),
      Math.min(acc[1], coord[1]),
      Math.max(acc[2], coord[0]),
      Math.max(acc[3], coord[1])
    ]), [Infinity, Infinity, -Infinity, -Infinity]);
    if (bbox.some((v) => !Number.isFinite(v)) || bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -90 || bbox[3] > 90) {
      throw new Error('Area geometry coordinates must be WGS84 longitude/latitude');
    }
    const centroid = [
      coords.reduce((sum, coord) => sum + coord[0], 0) / coords.length,
      coords.reduce((sum, coord) => sum + coord[1], 0) / coords.length
    ];
    const widthMeters = Math.abs(bbox[2] - bbox[0]) * 111320 * Math.cos((centroid[1] * Math.PI) / 180);
    const heightMeters = Math.abs(bbox[3] - bbox[1]) * 110540;
    const bboxAreaSqm = Math.max(0, Math.round(widthMeters * heightMeters));
    return { bbox, centroid, coordinateCount: coords.length, bboxAreaSqm };
  };

  app.post(`/plugins/${pluginSlug}/api/lantmateri-area-report`, express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const authActive = typeof security?.isEnabled === 'function' ? security.isEnabled() : false;
      if (authActive && !req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const geometry = req.body?.geometry;
      const selectedTypes = Array.isArray(req.body?.include)
        ? req.body.include.map((type) => String(type || '').trim()).filter(Boolean).slice(0, 20)
        : ['fastighet', 'taxering'];
      if (!geometry) return res.status(400).json({ error: 'Missing geometry' });

      const area = summarizeAreaGeometry(geometry);
      if (area.bboxAreaSqm > 100000000) {
        return res.status(413).json({ error: 'Area too large', maxBboxAreaSqm: 100000000 });
      }

      const results = {};
      for (const type of selectedTypes) {
        results[type] = { results: await fetchLantmateriInfo(type, area.centroid[0], area.centroid[1]) };
      }

      res.json({
        mode: 'area',
        area,
        nativeSrid: String(req.body?.nativeSrid || ''),
        note: 'Area geometry is preserved for LMV spatial lookup. Current legacy LMV report providers are queried at the area centroid until a configured LMV fastighet area/intersects endpoint is connected.',
        results
      });
    } catch (err) {
      const message = String(err?.message || err);
      const status = /too complex|too few|coordinates|supported|Missing/.test(message) ? 400 : 500;
      console.error('[Qtiler2Origo] Lantmäteri area report error:', err);
      res.status(status).json({ error: 'Area report failed', details: message });
    }
  });

  // Lantmäteriet point-info products (Markhöjd, Marktäcke, ...)
  // Unified registry: adding a new product = one entry here.
  const LMV_BUILTIN_POINT_PRODUCTS = {
    markhojd: {
      label: 'Markhöjd Direkt',
      // Override with LANTMATERI_MARKHOJD_URL_TEMPLATE in .env if your account uses a different path.
      // Placeholders: {srid} {n} {e} {lon} {lat}
      urlTemplate: process.env.LANTMATERI_MARKHOJD_URL_TEMPLATE
        || 'https://api.lantmateriet.se/distribution/produkter/markhojd/v1/hojd?srid={srid}&e={e}&n={n}',
      envKey: 'LANTMATERI_MARKHOJD_API_KEY',
      authScheme: process.env.LANTMATERI_MARKHOJD_AUTH || 'Bearer',
      // OAuth2 client_credentials (API Manager). Auto-renewed; takes priority over static API key.
      oauth: {
        clientId: process.env.LANTMATERI_MARKHOJD_CLIENT_ID || process.env.LANTMATERI_CLIENT_ID || '',
        clientSecret: process.env.LANTMATERI_MARKHOJD_CLIENT_SECRET || process.env.LANTMATERI_CLIENT_SECRET || '',
        tokenUrl: process.env.LANTMATERI_MARKHOJD_TOKEN_URL || process.env.LANTMATERI_TOKEN_URL
          || 'https://apimanager.lantmateriet.se/oauth2/token',
        scope: process.env.LANTMATERI_MARKHOJD_SCOPE || 'markhojd_direkt_v1_read'
      },
      mock: (lon, lat) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat, 42.7] },
        properties: { source: 'mock', accuracy_m: 0.5 }
      })
    },
    marktacke: {
      label: 'Marktäcke Direkt',
      // OGC Features API: query both 'markytor' (land) and 'sankmarksytor' (wetlands)
      // by tiny bbox around the point (CRS84 = lon/lat). Override with a single URL via
      // LANTMATERI_MARKTACKE_URL_TEMPLATE if needed.
      urlTemplate: process.env.LANTMATERI_MARKTACKE_URL_TEMPLATE || null,
      collections: ['markytor', 'sankmarksytor'],
      baseUrl: 'https://api.lantmateriet.se/ogc-features/v1/marktacke',
      envKey: 'LANTMATERI_MARKTACKE_API_KEY',
      authScheme: process.env.LANTMATERI_MARKTACKE_AUTH || 'Basic',
      // Geotorget Basic Auth: OGC Features APIs use the username/password issued by
      // Geotorget for THIS subscription. Takes priority over OAuth+API key.
      basicAuth: {
        username: process.env.LANTMATERI_MARKTACKE_USER || '',
        password: process.env.LANTMATERI_MARKTACKE_PASS || ''
      },
      oauth: {
        clientId: process.env.LANTMATERI_MARKTACKE_CLIENT_ID || process.env.LANTMATERI_CLIENT_ID || '',
        clientSecret: process.env.LANTMATERI_MARKTACKE_CLIENT_SECRET || process.env.LANTMATERI_CLIENT_SECRET || '',
        tokenUrl: process.env.LANTMATERI_MARKTACKE_TOKEN_URL || process.env.LANTMATERI_TOKEN_URL
          || 'https://apimanager.lantmateriet.se/oauth2/token',
        scope: process.env.LANTMATERI_MARKTACKE_SCOPE || ''
      },
      mock: (lon, lat) => ({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: { klass_sv: 'Barrskog', klass_kod: 111, source: 'mock' }
        }]
      })
    },
    hojd: {
      label: 'Höjd Direkt',
      urlTemplate: process.env.LANTMATERI_HOJD_URL_TEMPLATE
        || 'https://api.lantmateriet.se/distribution/produkter/hojd/v1/rest/api/hojd/{srid}/{e}/{n}',
      envKey: 'LANTMATERI_HOJD_API_KEY',
      authScheme: process.env.LANTMATERI_HOJD_AUTH || 'Bearer',
      // OAuth2 client_credentials (API Manager). Auto-renewed.
      oauth: {
        clientId: process.env.LANTMATERI_HOJD_CLIENT_ID || process.env.LANTMATERI_CLIENT_ID || '',
        clientSecret: process.env.LANTMATERI_HOJD_CLIENT_SECRET || process.env.LANTMATERI_CLIENT_SECRET || '',
        tokenUrl: process.env.LANTMATERI_HOJD_TOKEN_URL || process.env.LANTMATERI_TOKEN_URL
          || 'https://apimanager.lantmateriet.se/oauth2/token',
        scope: process.env.LANTMATERI_HOJD_SCOPE || 'hojd_direkt_v1_read'
      },
      mock: (lon, lat) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat, 87.3] },
        properties: { kalla: 'mock (NH 2+)', noggrannhet_m: 0.1 }
      })
    }
  };

  const getLmvPointProducts = () => {
    const products = {};
    for (const [id, product] of Object.entries(LMV_BUILTIN_POINT_PRODUCTS)) {
      products[id] = { ...product, id, enabled: true, source: 'builtin' };
    }
    for (const stored of readLmvStoredProducts()) {
      const id = sanitizeLmvProductId(stored.id);
      if (!id) continue;
      const base = products[id] || {};
      products[id] = {
        ...base,
        ...stored,
        id,
        label: stored.label || base.label || id,
        urlTemplate: stored.urlTemplate || base.urlTemplate || null,
        baseUrl: stored.baseUrl || base.baseUrl || null,
        collections: stored.collections.length ? stored.collections : (base.collections || []),
        authScheme: stored.authScheme || base.authScheme || 'Bearer',
        apiKey: stored.apiKey || base.apiKey || '',
        basicAuth: {
          ...(base.basicAuth || {}),
          ...(stored.basicAuth || {})
        },
        oauth: {
          ...(base.oauth || {}),
          ...(stored.oauth || {})
        },
        mock: base.mock || ((lon, lat) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { source: 'mock' } }))
      };
    }
    return products;
  };

  app.get(`/plugins/${pluginSlug}/api/lantmateri-products`, async (_req, res) => {
    try {
      const products = getLmvPointProducts();
      const items = Object.entries(products)
        .map(([id, product]) => publicLmvProduct(id, product))
        .filter((item) => item.enabled && item.configured);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json({ items });
    } catch (err) {
      res.status(500).json({ error: 'lmv_products_failed', details: String(err?.message || err) });
    }
  });

  app.get(`/plugins/${pluginSlug}/api/admin/lantmateri-products`, adminOnly, async (_req, res) => {
    try {
      const products = getLmvPointProducts();
      const items = Object.entries(products).map(([id, product]) => ({
        ...publicLmvProduct(id, product),
        urlTemplate: product.urlTemplate || '',
        baseUrl: product.baseUrl || '',
        authScheme: product.authScheme || 'Bearer',
        oauthTokenUrl: product.oauth?.tokenUrl || '',
        oauthScope: product.oauth?.scope || '',
        updatedAt: product.updatedAt || null
      }));
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json({ items });
    } catch (err) {
      res.status(500).json({ error: 'lmv_admin_products_failed', details: String(err?.message || err) });
    }
  });

  app.put(`/plugins/${pluginSlug}/api/admin/lantmateri-products/:id`, adminOnly, express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const id = sanitizeLmvProductId(req.params?.id);
      if (!id) return res.status(400).json({ error: 'invalid_product_id' });
      const current = lmvRowToProduct(lmvStatements.get.get(id));
      const body = req.body || {};
      const now = nowIso();
      const keepSecret = (next, previous) => next === undefined ? previous : String(next || '').trim();
      const row = {
        id,
        label: String(body.label || current?.label || LMV_BUILTIN_POINT_PRODUCTS[id]?.label || id).trim(),
        url_template: String(body.urlTemplate ?? current?.urlTemplate ?? LMV_BUILTIN_POINT_PRODUCTS[id]?.urlTemplate ?? '').trim() || null,
        base_url: String(body.baseUrl ?? current?.baseUrl ?? LMV_BUILTIN_POINT_PRODUCTS[id]?.baseUrl ?? '').trim() || null,
        collections: JSON.stringify(parseLmvCollections(body.collections !== undefined ? body.collections : (current?.collections || LMV_BUILTIN_POINT_PRODUCTS[id]?.collections || []))),
        auth_scheme: String(body.authScheme || current?.authScheme || LMV_BUILTIN_POINT_PRODUCTS[id]?.authScheme || 'Bearer').trim() || 'Bearer',
        api_key: keepSecret(body.apiKey, current?.apiKey || ''),
        username: keepSecret(body.username, current?.basicAuth?.username || ''),
        password: keepSecret(body.password, current?.basicAuth?.password || ''),
        oauth_client_id: keepSecret(body.oauthClientId, current?.oauth?.clientId || ''),
        oauth_client_secret: keepSecret(body.oauthClientSecret, current?.oauth?.clientSecret || ''),
        oauth_token_url: String(body.oauthTokenUrl ?? current?.oauth?.tokenUrl ?? LMV_BUILTIN_POINT_PRODUCTS[id]?.oauth?.tokenUrl ?? '').trim() || null,
        oauth_scope: String(body.oauthScope ?? current?.oauth?.scope ?? LMV_BUILTIN_POINT_PRODUCTS[id]?.oauth?.scope ?? '').trim() || null,
        enabled: body.enabled === false ? 0 : 1,
        created_at: current?.createdAt || now,
        updated_at: now
      };
      lmvStatements.upsert.run(row);
      const product = getLmvPointProducts()[id];
      res.json({ item: publicLmvProduct(id, product) });
    } catch (err) {
      res.status(500).json({ error: 'lmv_product_save_failed', details: String(err?.message || err) });
    }
  });

  app.delete(`/plugins/${pluginSlug}/api/admin/lantmateri-products/:id`, adminOnly, async (req, res) => {
    try {
      const id = sanitizeLmvProductId(req.params?.id);
      if (!id) return res.status(400).json({ error: 'invalid_product_id' });
      lmvStatements.delete.run(id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'lmv_product_delete_failed', details: String(err?.message || err) });
    }
  });

  function _expandLmvUrl(tpl, lon, lat, n, e, srid) {
    const N = (n != null ? n : lat);
    const E = (e != null ? e : lon);
    const S = srid || 3006;
    const d = 0.0001;
    return tpl
      .replace(/\{srid\}/g, S)
      .replace(/\{n\}/g, N)
      .replace(/\{e\}/g, E)
      .replace(/\{lon\}/g, lon)
      .replace(/\{lat\}/g, lat)
      .replace(/\{lon-\}/g, lon - d)
      .replace(/\{lat-\}/g, lat - d)
      .replace(/\{lon\+\}/g, lon + d)
      .replace(/\{lat\+\}/g, lat + d);
  }

  function _buildLmvAuthHeaders(scheme, apiKey) {
    const s = String(scheme || 'Bearer').trim();
    if (s.toLowerCase() === 'bearer') return { 'Authorization': `Bearer ${apiKey}` };
    if (s.toLowerCase() === 'apikey') return { 'Authorization': `ApiKey ${apiKey}` };
    if (s.toLowerCase().startsWith('header:')) {
      const hdrName = s.slice(7).trim() || 'X-Api-Key';
      return { [hdrName]: apiKey };
    }
    return { 'Authorization': `${s} ${apiKey}` };
  }

  // OAuth2 client_credentials token cache (per tokenUrl+clientId)
  const _lmvTokenCache = new Map();
  async function _getLmvOAuthToken(oauth) {
    if (!oauth || !oauth.clientId || !oauth.clientSecret || !oauth.tokenUrl) return null;
    const cacheKey = `${oauth.tokenUrl}|${oauth.clientId}|${oauth.scope || ''}`;
    const now = Date.now();
    const cached = _lmvTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > now + 30000) return cached.token;
    const basic = Buffer.from(`${oauth.clientId}:${oauth.clientSecret}`).toString('base64');
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    if (oauth.scope) body.set('scope', oauth.scope);
    console.log(`[Qtiler2Origo][LMV] fetching OAuth token from ${oauth.tokenUrl}`);
    const r = await fetch(oauth.tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: body.toString()
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`OAuth token request failed: ${r.status} ${txt.slice(0, 200)}`);
    }
    const data = await r.json();
    const token = data.access_token;
    if (!token) throw new Error('OAuth response missing access_token');
    const ttlMs = (Number(data.expires_in) || 3600) * 1000;
    _lmvTokenCache.set(cacheKey, { token, expiresAt: now + ttlMs });
    return token;
  }

  app.get(`/plugins/${pluginSlug}/api/lantmateri-proxy/:product`, async (req, res) => {
    try {
      const productId = String(req.params?.product || '').trim().toLowerCase();
      const product = getLmvPointProducts()[productId];
      if (!product || product.enabled === false) {
        return res.status(404).json({ error: 'unknown_product', product: productId });
      }
      const lon = parseFloat(req.query?.lon);
      const lat = parseFloat(req.query?.lat);
      const n   = req.query?.n != null ? parseFloat(req.query.n) : null;
      const e   = req.query?.e != null ? parseFloat(req.query.e) : null;
      const srid = req.query?.srid ? String(req.query.srid).trim() : null;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        return res.status(400).json({ error: 'Invalid coordinates' });
      }

      const authActive = typeof security?.isEnabled === 'function' ? security.isEnabled() : false;
      if (authActive && !req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const apiKey = product.apiKey || process.env[product.envKey] || process.env.LANTMATERI_API_KEY || '';
      // Auth priority: 1) Geotorget Basic (user/pass)  2) OAuth2 client_credentials  3) static API key
      let authHeader = null;
      if (product.basicAuth && product.basicAuth.username && product.basicAuth.password) {
        const b64 = Buffer.from(`${product.basicAuth.username}:${product.basicAuth.password}`).toString('base64');
        authHeader = `Basic ${b64}`;
      } else if (product.oauth && product.oauth.clientId && product.oauth.clientSecret) {
        try {
          const t = await _getLmvOAuthToken(product.oauth);
          if (t) authHeader = `Bearer ${t}`;
        } catch (e) {
          console.warn(`[Qtiler2Origo][LMV] ${productId} OAuth failed: ${e.message}`);
          return res.status(502).json({ error: 'oauth_failed', details: e.message });
        }
      }
      if (!authHeader && !apiKey) {
        _showLmvBanner();
        return res.json(product.mock(lon, lat));
      }

      const headers = authHeader
        ? { 'Accept': 'application/json', 'Authorization': authHeader }
        : Object.assign({ 'Accept': 'application/json' }, _buildLmvAuthHeaders(product.authScheme, apiKey));

      // Multi-collection OGC Features mode (e.g. marktacke = markytor + sankmarksytor)
      if (Array.isArray(product.collections) && product.baseUrl && !product.urlTemplate) {
        // The OGC Features server ignores bbox-crs and always interprets bbox as CRS84 (lon/lat).
        // Frontend sometimes sends projected coords in lon/lat (when proj4/EPSG:3006 is missing
        // in OpenLayers). Detect this and reproject server-side via proj4.
        let X = lon, Y = lat;
        const sridNum = parseInt(srid, 10) || 0;
        const looksProjected = Math.abs(lon) > 180 || Math.abs(lat) > 90;
        if (looksProjected || (sridNum && sridNum !== 4326)) {
          try {
            if (!proj4.defs('EPSG:3006')) {
              proj4.defs('EPSG:3006', '+proj=tmerc +lat_0=0 +lon_0=15 +k=0.9996 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
            }
            const fromCode = (sridNum && sridNum !== 4326) ? `EPSG:${sridNum}` : 'EPSG:3006';
            const inX = Number.isFinite(e) ? e : lon;
            const inY = Number.isFinite(n) ? n : lat;
            const out = proj4(fromCode, 'EPSG:4326', [inX, inY]);
            X = out[0];
            Y = out[1];
            console.log(`[Qtiler2Origo][LMV] ${productId} reprojected ${fromCode} (${inX},${inY}) -> WGS84 (${X.toFixed(6)},${Y.toFixed(6)})`);
          } catch (rpErr) {
            console.warn(`[Qtiler2Origo][LMV] ${productId} reprojection failed: ${rpErr.message}`);
          }
        }
        // Tiny ~10 m bbox at Swedish latitudes: 0.0001° lat ≈ 11m, 0.00018° lon ≈ 10m at 60°N.
        const dLat = 0.0001;
        const dLon = 0.00018;
        const bbox = `${X - dLon},${Y - dLat},${X + dLon},${Y + dLat}`;
        const results = {};
        for (const coll of product.collections) {
          const url = `${product.baseUrl}/collections/${coll}/items?bbox=${bbox}&limit=5&f=json`;
          console.log(`[Qtiler2Origo][LMV] ${productId}/${coll} -> ${url}`);
          try {
            const r = await fetch(url, { headers });
            if (!r.ok) {
              const txt = await r.text().catch(() => '');
              console.warn(`[Qtiler2Origo][LMV] ${productId}/${coll} upstream ${r.status}: ${txt.slice(0, 200)}`);
              results[coll] = { error: r.status, body: txt.slice(0, 200) };
              continue;
            }
            results[coll] = await r.json();
          } catch (e2) {
            results[coll] = { error: 'fetch_failed', details: String(e2?.message || e2) };
          }
        }
        return res.json({ multi: true, collections: results });
      }

      const url = _expandLmvUrl(product.urlTemplate, lon, lat, n, e, srid);
      console.log(`[Qtiler2Origo][LMV] ${productId} -> ${url}`);
      const r = await fetch(url, { headers });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        console.warn(`[Qtiler2Origo][LMV] ${productId} upstream ${r.status}: ${txt.slice(0, 300)}`);
        return res.status(r.status).json({ error: 'upstream_error', status: r.status, url, body: txt.slice(0, 500) });
      }
      const data = await r.json();
      res.json(data);
    } catch (err) {
      console.error('[Qtiler2Origo] LMV point-product error:', err);
      res.status(500).json({ error: 'Request failed', details: String(err?.message || err) });
    }
  });

  app.get(`/plugins/${pluginSlug}/api/portal-pages`, portalEditorOnly, async (_req, res) => {
    try {
      const state = await readPortalPagesState();
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json(state);
    } catch (err) {
      console.error('XERR portal-pages get', err);
      res.status(500).json({ error: 'portal_pages_read_failed', details: String(err?.message || err) });
    }
  });

  app.post(`/plugins/${pluginSlug}/api/portal-pages`, portalEditorOnly, express.json({ limit: '50mb' }), async (req, res) => {
    try {
      const saved = await writePortalPagesState(req.body || {});
      res.json({ status: 'saved', ...saved });
    } catch (err) {
      console.error('XERR portal-pages save', err);
      res.status(500).json({ error: 'portal_pages_save_failed', details: String(err?.message || err) });
    }
  });

  app.post(`/plugins/${pluginSlug}/api/portal-backup/export`, portalEditorOnly, express.json({ limit: '10mb' }), async (req, res) => {
    try {
      const state = await readPortalPagesState();
      const requestedPageIds = new Set((Array.isArray(req.body?.pageIds) ? req.body.pageIds : []).map((v) => String(v || '').trim()).filter(Boolean));
      const requestedPageSlugs = new Set((Array.isArray(req.body?.pageSlugs) ? req.body.pageSlugs : []).map((v) => slugifyPortalToken(v)).filter(Boolean));
      const requestedMapKeys = new Set((Array.isArray(req.body?.mapKeys) ? req.body.mapKeys : []).map((v) => sanitizeFileToken(v)).filter(Boolean));

      const pages = state.pages.filter((page) => {
        if (!requestedPageIds.size && !requestedPageSlugs.size) return true;
        return requestedPageIds.has(String(page.id || '')) || requestedPageSlugs.has(String(page.slug || ''));
      });
      const homePageSlug = pages.some((page) => page.slug === state.homePageSlug)
        ? state.homePageSlug
        : (pages[0]?.slug || '');

      const allProfiles = await readAllPublishedProfiles();
      const maps = allProfiles
        .filter((profile) => !requestedMapKeys.size || requestedMapKeys.has(sanitizeFileToken(profile.profileKey || profile.name || profile.projectId)))
        .map((profile) => {
          const profileKey = sanitizeFileToken(profile.profileKey || profile.name || profile.projectId);
          const { profileKey: _profileKey, ...config } = profile;
          return { profileKey, config };
        })
        .filter((entry) => entry.profileKey && entry.config?.projectId);

      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json({
        schema: 'qtiler2origo.portal-backup.v1',
        plugin: pluginSlug,
        exportedAt: nowIso(),
        portal: {
          homePageSlug,
          gdpr: state.gdpr || defaultPortalGdprSettings(),
          site: state.site || {},
          pages
        },
        maps
      });
    } catch (err) {
      console.error('XERR portal-backup export', err);
      res.status(500).json({ error: 'portal_backup_export_failed', details: String(err?.message || err) });
    }
  });

  app.post(`/plugins/${pluginSlug}/api/portal-backup/import`, portalEditorOnly, express.json({ limit: '100mb' }), async (req, res) => {
    try {
      const backup = req.body?.backup && typeof req.body.backup === 'object' ? req.body.backup : req.body;
      if (!backup || backup.schema !== 'qtiler2origo.portal-backup.v1') {
        return res.status(400).json({ error: 'invalid_portal_backup' });
      }
      const replacePortal = req.body?.replacePortal !== false;
      const replaceMaps = req.body?.replaceMaps !== false;
      const result = { portal: null, maps: [] };
      const baseUrl = getRequestBaseUrl(req).replace(/\/+$/,'');

      if (backup.portal && typeof backup.portal === 'object') {
        const importedPortal = normalizePortalPagesState(backup.portal);
        if (replacePortal) {
          result.portal = await writePortalPagesState(importedPortal);
        } else {
          const current = await readPortalPagesState();
          const mergedBySlug = new Map(current.pages.map((page) => [page.slug, page]));
          for (const page of importedPortal.pages) mergedBySlug.set(page.slug, page);
          result.portal = await writePortalPagesState({
            ...current,
            gdpr: importedPortal.gdpr || current.gdpr,
            site: { ...(current.site || {}), ...(importedPortal.site || {}) },
            homePageSlug: importedPortal.homePageSlug || current.homePageSlug,
            pages: Array.from(mergedBySlug.values())
          });
        }
      }

      const maps = Array.isArray(backup.maps) ? backup.maps : [];
      await fs.promises.mkdir(publishedRoot, { recursive: true });
      for (const entry of maps) {
        const profile = entry?.config && typeof entry.config === 'object' ? entry.config : null;
        const profileKey = sanitizeFileToken(entry?.profileKey || profile?.name || profile?.projectId);
        if (!profileKey || !profile?.projectId) continue;
        const targetPath = path.join(publishedRoot, `${profileKey}.json`);
        if (!replaceMaps) {
          try {
            await fs.promises.access(targetPath, fs.constants.F_OK);
            result.maps.push({ profileKey, status: 'skipped_exists' });
            continue;
          } catch { /* missing: import below */ }
        }
        const payload = { ...profile, importedAt: nowIso(), plugin: pluginSlug };
        await fs.promises.writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf8');
        result.maps.push({ profileKey, status: 'imported' });
        void syncRuntimeFilesForProfile(payload, baseUrl).catch((syncErr) => {
          console.warn('[Qtiler2Origo] portal backup import sync warning:', syncErr?.message || syncErr);
        });
        void regeneratePublishedThumbnail({
          profileKey,
          profile: payload,
          baseUrl,
          cookieHeader: req.headers.cookie,
          apiKey: getRequestApiKey(req),
          authorization: req.get?.('authorization') || ''
        }).catch(() => null);
      }

      res.json({ status: 'imported', ...result });
    } catch (err) {
      console.error('XERR portal-backup import', err);
      res.status(500).json({ error: 'portal_backup_import_failed', details: String(err?.message || err) });
    }
  });

  app.get(`/plugins/${pluginSlug}/api/portal-content`, async (req, res) => {
    try {
      const state = await readPortalPagesState();
      const authActive = typeof security?.isEnabled === 'function' ? security.isEnabled() : false;
      const baseUrl = getRequestBaseUrl(req);
      const allMaps = await collectPublishedProfiles(baseUrl, { apiKey: getRequestApiKey(req) });
      const items = authActive
        ? (() => {
            const snapshot = readAccessSnapshot(dataRoot);
            return allMaps.filter((item) => userCanAccessProject(snapshot, req.user || null, item.projectId));
          })()
        : allMaps;
      const mode = String(req.query?.mode || '').trim();
      const slug = slugifyPortalToken(req.query?.slug || '');
      const visiblePages = state.pages.filter((page) => userMatchesPortalAudience(page.visibility, req.user || null));
      let currentPage = null;

      if (mode !== 'maps') {
        if (slug) currentPage = visiblePages.find((page) => page.slug === slug) || null;
        if (!currentPage && !slug && state.homePageSlug) {
          currentPage = visiblePages.find((page) => page.slug === state.homePageSlug) || null;
        }
        if (!currentPage && !slug) currentPage = visiblePages[0] || null;
        if (slug && !currentPage) {
          return res.status(404).json({ error: 'portal_page_not_found' });
        }
      }

      let logoUrl = null;
      try { logoUrl = await getLogoPublicUrl(); } catch { logoUrl = null; }
      if (!logoUrl) logoUrl = '/css/images/Qtiler.png';
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json({
        authActive,
        user: req.user ? { id: req.user.id, username: req.user.username || req.user.id, role: req.user.role || null } : null,
        logoUrl,
        items,
        gdpr: state.gdpr,
        site: state.site || { title: '', subtitle: '', footerLink: '', footerText: '' },
        portal: {
          homePageSlug: state.homePageSlug,
          pages: visiblePages.map((page) => ({
            id: page.id,
            slug: page.slug,
            title: page.title,
            navLabel: page.navLabel,
            summary: page.summary,
            showInNav: page.showInNav,
            url: buildPortalPageUrl(page.slug)
          })),
          currentPage: currentPage ? {
            ...currentPage,
            url: buildPortalPageUrl(currentPage.slug),
            blocks: filterPortalBlocksByAudience(currentPage.blocks, req.user || null)
          } : null
        }
      });
    } catch (err) {
      console.error('XERR portal-content', err);
      res.status(500).json({ error: 'portal_content_failed', details: String(err?.message || err) });
    }
  });

  app.delete(`/plugins/${pluginSlug}/api/publish/:profileName`, adminOnly, async (req, res) => {
    try {
      const profileName = String(req.params?.profileName || '').trim();
      if (!profileName) {
        return res.status(400).json({ error: 'name_required' });
      }
      const target = path.join(publishedRoot, `${sanitizeFileToken(profileName)}.json`);

      // Capture the projectId BEFORE deleting so we can clean its cached thumbnails.
      let projectIdForThumbs = null;
      const thumbPath = publishedThumbnailPath(profileName);
      try {
        const raw = await fs.promises.readFile(target, 'utf8');
        const parsed = JSON.parse(raw || '{}');
        if (parsed && parsed.projectId) projectIdForThumbs = String(parsed.projectId);
      } catch (_) { /* missing or unreadable profile is fine */ }

      await fs.promises.rm(target, { force: true });
  await fs.promises.rm(thumbPath, { force: true }).catch(() => {});

      // Remove cached thumbnails for this project only when no other published
      // profile still references the same projectId.
      let thumbsRemoved = 0;
      if (projectIdForThumbs) {
        try {
          const remaining = await readAllPublishedProfiles();
          const stillUsed = remaining.some((p) => String(p.projectId || '') === projectIdForThumbs);
          if (!stillUsed) {
            const safe = sanitizeFileToken(projectIdForThumbs);
            const entries = await fs.promises.readdir(thumbCacheDir).catch(() => []);
            await Promise.all(entries.map(async (name) => {
              if (name.startsWith(`${safe}_`) && name.toLowerCase().endsWith('.jpg')) {
                try { await fs.promises.unlink(path.join(thumbCacheDir, name)); thumbsRemoved += 1; } catch (_) {}
              }
            }));
          }
        } catch (_) { /* best-effort cleanup */ }
      }
      res.json({ status: 'deleted', name: profileName, thumbsRemoved });
    } catch(err) { console.error('XERR', err);
      res.status(500).json({ error: 'publish_delete_failed', details: String(err?.message || err) });
    }
  });

  // Wipe cached WMS thumbnails for a project so the next request regenerates them.
  app.delete(`/plugins/${pluginSlug}/api/thumbnail/cache/:projectId/layer/:layerName`, adminOnly, async (req, res) => {
    try {
      const projectId = normalizeProjectId(req.params?.projectId || '');
      const layerName = String(req.params?.layerName || '').trim();
      if (!projectId || !layerName) return res.status(400).json({ error: 'project_and_layer_required' });
      const removed = await removeCachedLayerThumbnails(projectId, layerName);
      res.json({ status: 'cleared', projectId, layerName, removed });
    } catch (err) {
      console.error('[thumbnail-layer-cache-clear]', err);
      res.status(500).json({ error: 'thumbnail_layer_cache_clear_failed', details: String(err?.message || err) });
    }
  });

  app.post(`/plugins/${pluginSlug}/api/thumbnail/regenerate/:projectId/layer/:layerName`, adminOnly, async (req, res) => {
    try {
      const projectId = normalizeProjectId(req.params?.projectId || '');
      const layerName = String(req.params?.layerName || '').trim();
      if (!projectId || !layerName) return res.status(400).json({ error: 'project_and_layer_required' });
      await removeCachedLayerThumbnails(projectId, layerName);
      await clearThumbnailRenderCaches([projectId]);
      const baseUrl = getRequestBaseUrl(req);
      const generated = await generateThumbnail(projectId, layerName, baseUrl, req.headers.cookie, {
        apiKey: getRequestApiKey(req),
        authorization: req.get?.('authorization') || ''
      });
      const stamp = Date.now();
      res.json({
        status: generated ? 'regenerated' : 'placeholder',
        projectId,
        layerName,
        thumbUrl: `${baseUrl}/plugins/${pluginSlug}/api/thumbnail/${encodeURIComponent(projectId)}?LAYERS=${encodeURIComponent(layerName)}&_=${stamp}`,
        legendUrl: `${baseUrl}/plugins/${pluginSlug}/api/thumbnail/${encodeURIComponent(projectId)}?LAYERS=${encodeURIComponent(layerName)}&LEGEND=1&_=${stamp}`
      });
    } catch (err) {
      console.error('[thumbnail-layer-regenerate]', err);
      res.status(500).json({ error: 'thumbnail_layer_regenerate_failed', details: String(err?.message || err) });
    }
  });

  app.use(`/plugins/${pluginSlug}/legend-library`, express.static(legendLibraryRoot, {
    fallthrough: false,
    immutable: true,
    maxAge: '7d',
    index: false
  }));

  app.get(`/plugins/${pluginSlug}/api/legend-library`, portalEditorOnly, async (_req, res) => {
    try {
      const items = await listLegendLibraryItems();
      res.json({ items });
    } catch (err) {
      res.status(500).json({ error: 'legend_library_list_failed', details: String(err?.message || err) });
    }
  });

  app.post(`/plugins/${pluginSlug}/api/legend-library`, portalEditorOnly, (req, res) => {
    legendLibraryUpload.single('image')(req, res, async (err) => {
      if (err) {
        const msg = String(err?.message || err || 'legend_library_upload_failed');
        if (msg.includes('File too large') || err?.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'legend_library_too_large', details: `max_bytes_${MAX_LEGEND_LIBRARY_BYTES}` });
        }
        if (msg.includes('invalid_legend_library_extension')) {
          return res.status(400).json({ error: 'invalid_legend_library_extension' });
        }
        return res.status(400).json({ error: 'legend_library_upload_failed', details: msg });
      }
      try {
        const uploaded = req.file;
        if (!uploaded || !uploaded.buffer || !uploaded.originalname) {
          return res.status(400).json({ error: 'legend_library_file_required' });
        }
        const origExt = path.extname(String(uploaded.originalname || '')).toLowerCase();
        if (!ALLOWED_LEGEND_LIBRARY_EXTENSIONS.has(origExt)) {
          return res.status(400).json({ error: 'invalid_legend_library_extension' });
        }
        const cropped = await cropLegendLibraryBuffer(uploaded.buffer, origExt);
        const stem = sanitizeFileToken(path.basename(String(uploaded.originalname || 'legend'), origExt)).slice(0, 80) || 'legend';
        const fileName = `${Date.now()}-${stem}${cropped.ext}`;
        const targetPath = path.join(legendLibraryRoot, fileName);
        await fs.promises.mkdir(legendLibraryRoot, { recursive: true });
        await fs.promises.writeFile(targetPath, cropped.buffer);
        const item = {
          id: fileName,
          name: path.basename(String(uploaded.originalname || fileName)),
          fileName,
          mime: cropped.mime,
          createdAt: nowIso()
        };
        const items = await readLegendLibraryIndex();
        items.unshift(item);
        await writeLegendLibraryIndex(items);
        return res.status(201).json({
          status: 'uploaded',
          item: {
            ...item,
            url: legendLibraryPublicUrl(fileName, Date.now())
          }
        });
      } catch (uploadErr) {
        return res.status(500).json({ error: 'legend_library_upload_failed', details: String(uploadErr?.message || uploadErr) });
      }
    });
  });

  app.delete(`/plugins/${pluginSlug}/api/legend-library/:id`, portalEditorOnly, async (req, res) => {
    try {
      const id = sanitizeFileToken(req.params?.id || '');
      if (!id) return res.status(400).json({ error: 'legend_library_id_required' });
      const items = await readLegendLibraryIndex();
      const match = items.find((item) => sanitizeFileToken(item?.id || item?.fileName || '') === id);
      const fileName = sanitizeFileToken(match?.fileName || id);
      if (fileName) {
        await fs.promises.rm(path.join(legendLibraryRoot, fileName), { force: true }).catch(() => {});
      }
      await writeLegendLibraryIndex(items.filter((item) => sanitizeFileToken(item?.id || item?.fileName || '') !== id));
      res.json({ status: 'deleted', id });
    } catch (err) {
      res.status(500).json({ error: 'legend_library_delete_failed', details: String(err?.message || err) });
    }
  });

  app.delete(`/plugins/${pluginSlug}/api/thumbnail/cache/:projectId`, adminOnly, async (req, res) => {
    try {
      const projectId = normalizeProjectId(req.params?.projectId || '');
      if (!projectId) return res.status(400).json({ error: 'project_id_required' });
      const safe = sanitizeFileToken(projectId);
      let removed = 0;
      try {
        const entries = await fs.promises.readdir(thumbCacheDir);
        await Promise.all(entries.map(async (name) => {
          if (name.startsWith(`${safe}_`) && name.toLowerCase().endsWith('.jpg')) {
            try { await fs.promises.unlink(path.join(thumbCacheDir, name)); removed += 1; } catch (_) {}
          }
        }));
      } catch (err) {
        if (err && err.code !== 'ENOENT') throw err;
      }
      res.json({ status: 'cleared', projectId, removed });
    } catch (err) {
      console.error('[thumbnail-cache-clear]', err);
      res.status(500).json({ error: 'thumbnail_cache_clear_failed', details: String(err?.message || err) });
    }
  });

  app.post(`/plugins/${pluginSlug}/api/thumbnail/regenerate/:projectId`, adminOnly, async (req, res) => {
    try {
      const projectId = normalizeProjectId(req.params?.projectId || '');
      if (!projectId) return res.status(400).json({ error: 'project_id_required' });
      const reqApiKey = getRequestApiKey(req);
      let layers = String(req.query?.LAYERS || req.body?.layers || '').trim();
      const background = normalizeThumbnailBackground({
        type: String(req.query?.BGPROJECT || req.body?.background?.sourceProjectId || req.body?.background?.projectId || '').trim() && String(req.query?.BGLAYER || req.body?.background?.name || req.body?.background?.layer || '').trim()
          ? 'layer'
          : String(req.query?.BGTYPE || req.body?.background?.type || '').trim(),
        sourceProjectId: req.query?.BGPROJECT || req.body?.background?.sourceProjectId || req.body?.background?.projectId,
        name: req.query?.BGLAYER || req.body?.background?.name || req.body?.background?.layer
      });
      if (!layers) {
        const idx = await readCacheIndex(projectId);
        const layerNames = (Array.isArray(idx?.layers) ? idx.layers : [])
          .filter((l) => String(l?.kind || 'layer').toLowerCase() === 'layer')
          .map((l) => String(l?.name || l?.layer || '').trim())
          .filter(Boolean);
        layers = layerNames.slice(0, 6).join(',');
      }
      if (!layers) return res.status(400).json({ error: 'layer_names_required' });

      const cacheEntry = buildThumbnailCacheEntry(projectId, layers, background);
      if (!cacheEntry) return res.status(400).json({ error: 'invalid_thumbnail_target' });
      const { thumbPath } = cacheEntry;
      await fs.promises.unlink(thumbPath).catch(() => {});
      await clearThumbnailRenderCaches([
        projectId,
        background?.type === 'layer' ? background.sourceProjectId : null
      ]);

      const baseUrl = getRequestBaseUrl(req);
      const generated = await generateThumbnail(projectId, layers, baseUrl, req.headers.cookie, {
        background,
        apiKey: reqApiKey,
        authorization: req.get?.('authorization') || ''
      });
      const thumbQuery = buildPublishedThumbnailQuery({
        mainLayerNames: layers.split(',').map((name) => String(name || '').trim()).filter(Boolean),
        background,
        apiKey: reqApiKey
      });
      const thumbUrl = `${baseUrl}/plugins/${pluginSlug}/api/thumbnail/${encodeURIComponent(projectId)}${thumbQuery}${thumbQuery ? '&' : '?'}_=${Date.now()}`;
      res.json({
        status: generated ? 'regenerated' : 'placeholder',
        projectId,
        layers,
        thumbUrl
      });
    } catch (err) {
      console.error('[thumbnail-regenerate]', err);
      res.status(500).json({ error: 'thumbnail_regenerate_failed', details: String(err?.message || err) });
    }
  });

  app.post(`/plugins/${pluginSlug}/api/publish/thumbnail/:profileKey`, adminOnly, async (req, res) => {
    try {
      const profileToken = String(req.params?.profileKey || '').trim();
      if (!profileToken) return res.status(400).json({ error: 'profile_key_required' });
      const record = await resolvePublishedProfileRecord(profileToken);
      if (!record?.profile || !record?.profileKey) return res.status(404).json({ error: 'published_profile_not_found' });
      const baseUrl = getRequestBaseUrl(req).replace(/\/+$/,'');
      const thumbMeta = await regeneratePublishedThumbnail({
        profileKey: record.profileKey,
        profile: record.profile,
        baseUrl,
        cookieHeader: req.headers.cookie,
        apiKey: getRequestApiKey(req),
        authorization: req.get?.('authorization') || ''
      });
      if (!thumbMeta?.url) return res.status(500).json({ error: 'thumbnail_regenerate_failed' });
      res.json({
        status: 'regenerated',
        profileKey: record.profileKey,
        projectId: record.profile.projectId,
        thumbUrl: `${baseUrl}${thumbMeta.url}`
      });
    } catch (err) {
      console.error('[published-thumbnail-regenerate]', err);
      res.status(500).json({ error: 'published_thumbnail_regenerate_failed', details: String(err?.message || err) });
    }
  });

  app.get(`/plugins/${pluginSlug}/api/publish/:projectId/launch-url`, adminOnly, async (req, res) => {
    try {
      const profileOrProject = normalizeProjectId(req.params?.projectId || '');
      if (!profileOrProject) return res.status(400).json({ error: 'project_id_required' });

      const allProfiles = await readAllPublishedProfiles();
      let profile = allProfiles.find((p) => p.profileKey === profileOrProject);
      if (!profile) {
        profile = allProfiles.find((p) => p.projectId === profileOrProject) || null;
      }

      const profileKey = profile?.profileKey || profileOrProject;
      const projectId = normalizeProjectId(profile?.projectId || profileOrProject);
      const base = getRequestBaseUrl(req).replace(/\/+$|$/, '');
      res.json({ projectId, profileKey, launchUrl: `${base}/plugins/${pluginSlug}/origo/?qtiler_profile=${encodeURIComponent(profileKey)}#/?t=${encodeURIComponent(projectId)}` });
    } catch(err) { console.error('XERR', err);
      res.status(500).json({ error: 'publish_launch_url_failed', details: String(err?.message || err) });
    }
  });

  app.get(`/plugins/${pluginSlug}/api/legend-icon`, async (req, res) => {
    try {
      const raw = String(req.query?.src || '').trim();
      if (!raw || /[\r\n]/.test(raw)) return res.status(400).send('Invalid icon URL');
      if (/^(?:javascript|data|vbscript):/i.test(raw)) return res.status(400).send('Invalid icon URL');
      const format = String(req.query?.format || req.query?.FORMAT || '').trim().toLowerCase();
      if (format.includes('json')) {
        const title = String(req.query?.title || req.query?.label || 'Legend').trim() || 'Legend';
        return res.json({ Legend: [{ layerName: title, rules: [{ title, name: title }] }] });
      }
      let target = raw;
      if (!/^https?:\/\//i.test(target) && !target.startsWith('/')) {
        target = `/${target.replace(/^\/+/, '')}`;
      }
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.redirect(302, target);
    } catch (err) {
      res.status(500).send(String(err?.message || err));
    }
  });

  /* ── WMS proxy: keep ImageWMS under Qtiler's 4M-pixel GetMap cap ──
     Recipients who only install this plugin still hit /wms 400 XML on
     full-viewport ImageWMS. Proxy through the plugin, downscale the
     render, then stretch the PNG back to WIDTH x HEIGHT so Origo can
     decode it and place it on the requested BBOX. */
  const ORIGO_WMS_MAX_PIXELS = 4000000;
  const origoFitGetMapSize = (width, height, maxPixels) => {
    const w0 = Math.max(1, Number(width) || 1);
    const h0 = Math.max(1, Number(height) || 1);
    const pixels = w0 * h0;
    if (!(maxPixels > 0) || pixels <= maxPixels) {
      return { width: w0, height: h0, scaled: false };
    }
    const scale = Math.sqrt(maxPixels / pixels);
    let w = Math.max(1, Math.floor(w0 * scale));
    let h = Math.max(1, Math.floor(h0 * scale));
    while (w * h > maxPixels && (w > 1 || h > 1)) {
      if (w >= h && w > 1) w -= 1;
      else if (h > 1) h -= 1;
      else break;
    }
    return { width: w, height: h, scaled: true };
  };
  const origoWmsParam = (req, key) => {
    const target = String(key || '').toLowerCase();
    for (const source of [req.query, req.body]) {
      if (!source || typeof source !== 'object') continue;
      if (source[key] != null) return Array.isArray(source[key]) ? source[key][0] : source[key];
      for (const [k, v] of Object.entries(source)) {
        if (String(k).toLowerCase() === target) return Array.isArray(v) ? v[0] : v;
      }
    }
    return null;
  };
  const fetchUpstreamWms = (imageUrl, auth = {}) => new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(imageUrl);
      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: {}
      };
      if (auth.cookieHeader) reqOptions.headers.cookie = auth.cookieHeader;
      if (auth.apiKey) reqOptions.headers['x-api-key'] = auth.apiKey;
      if (auth.authorization) reqOptions.headers.authorization = auth.authorization;
      const fetcher = imageUrl.startsWith('https') ? https : http;
      const proxyReq = fetcher.get(reqOptions, (proxyRes) => {
        const chunks = [];
        proxyRes.on('data', (chunk) => chunks.push(chunk));
        proxyRes.on('end', () => resolve({
          status: proxyRes.statusCode || 500,
          contentType: String(proxyRes.headers['content-type'] || ''),
          buffer: Buffer.concat(chunks)
        }));
        proxyRes.on('error', reject);
      });
      proxyReq.setTimeout(120_000, () => {
        try { proxyReq.destroy(new Error('origo wms proxy timed out')); } catch (_) {}
      });
      proxyReq.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
  const handleOrigoWmsProxy = async (req, res) => {
    try {
      const baseUrl = getRequestBaseUrl(req);
      const merged = { ...(req.query || {}), ...(req.body || {}) };
      const requestName = String(origoWmsParam(req, 'REQUEST') || origoWmsParam(req, 'request') || '').trim();
      const widthReq = Number.parseInt(String(origoWmsParam(req, 'WIDTH') ?? ''), 10);
      const heightReq = Number.parseInt(String(origoWmsParam(req, 'HEIGHT') ?? ''), 10);
      const isGetMap = requestName.toUpperCase() === 'GETMAP';
      const fitted = (isGetMap && widthReq > 0 && heightReq > 0)
        ? origoFitGetMapSize(widthReq, heightReq, ORIGO_WMS_MAX_PIXELS)
        : null;
      const upstreamParams = new URLSearchParams();
      for (const [key, value] of Object.entries(merged)) {
        if (value == null) continue;
        const k = String(key);
        if (fitted?.scaled && /^WIDTH$/i.test(k)) {
          upstreamParams.set(k, String(fitted.width));
          continue;
        }
        if (fitted?.scaled && /^HEIGHT$/i.test(k)) {
          upstreamParams.set(k, String(fitted.height));
          continue;
        }
        if (Array.isArray(value)) upstreamParams.set(k, String(value[0] ?? ''));
        else upstreamParams.set(k, String(value));
      }
      const isGetLegendGraphic = requestName.toUpperCase() === 'GETLEGENDGRAPHIC';
      if (isGetLegendGraphic) {
        upstreamParams.set('LAYERTITLE', 'FALSE');
        upstreamParams.set('RULELABEL', 'FALSE');
        if (![...upstreamParams.keys()].some((k) => /^TRANSPARENT$/i.test(k))) {
          upstreamParams.set('TRANSPARENT', 'TRUE');
        }
        if (![...upstreamParams.keys()].some((k) => /^SYMBOLWIDTH$/i.test(k))) {
          upstreamParams.set('SYMBOLWIDTH', '16');
        }
        if (![...upstreamParams.keys()].some((k) => /^SYMBOLHEIGHT$/i.test(k))) {
          upstreamParams.set('SYMBOLHEIGHT', '16');
        }
      }
      const upstreamUrl = `${baseUrl}/wms?${upstreamParams.toString()}`;
      const upstream = await fetchUpstreamWms(upstreamUrl, {
        cookieHeader: req.headers?.cookie,
        apiKey: req.headers?.['x-api-key'] || req.query?.api_key,
        authorization: req.get?.('authorization') || ''
      });
      let body = upstream.buffer;
      let contentType = upstream.contentType || 'application/octet-stream';
      if (fitted?.scaled && String(contentType).toLowerCase().startsWith('image/')) {
        try {
          const formatHint = String(origoWmsParam(req, 'FORMAT') || contentType).toLowerCase();
          const pipeline = sharp(body).resize(widthReq, heightReq, { fit: 'fill' });
          if (formatHint.includes('jpeg') || formatHint.includes('jpg')) {
            body = await pipeline.jpeg({ quality: 85 }).toBuffer();
            contentType = 'image/jpeg';
          } else {
            body = await pipeline.png().toBuffer();
            contentType = 'image/png';
          }
        } catch (resizeErr) {
          console.warn('[Qtiler2Origo] WMS proxy resize failed:', resizeErr?.message || resizeErr);
        }
      }
      if (isGetLegendGraphic && String(contentType).toLowerCase().startsWith('image/')) {
        try {
          const meta = await sharp(body).metadata();
          const w = Number(meta.width) || 0;
          const h = Number(meta.height) || 0;
          if (w > 40 && h > 0 && w > h * 1.4) {
            const pad = Math.min(4, Math.max(0, w - 1));
            const swatch = Math.max(16, Math.min(32, w, h + pad));
            body = await sharp(body)
              .extract({ left: 0, top: 0, width: Math.min(swatch, w), height: h })
              .png()
              .toBuffer();
            contentType = 'image/png';
          }
        } catch (legendCropErr) {
          console.warn('[Qtiler2Origo] legend crop failed:', legendCropErr?.message || legendCropErr);
        }
      }
      res.status(upstream.status || 200);
      res.set('Cache-Control', 'no-store');
      res.type(contentType.split(';')[0] || 'application/octet-stream');
      return res.send(body);
    } catch (err) {
      console.error('[Qtiler2Origo] WMS proxy failed:', err?.message || err);
      return res.status(502).type('application/xml').send(
        '<?xml version="1.0"?><ServiceExceptionReport><ServiceException>Origo WMS proxy failed</ServiceException></ServiceExceptionReport>'
      );
    }
  };
  app.get(`/plugins/${pluginSlug}/wms`, handleOrigoWmsProxy);
  app.post(
    `/plugins/${pluginSlug}/wms`,
    express.urlencoded({ extended: true, limit: '50mb' }),
    express.json({ limit: '50mb' }),
    (req, res, next) => {
      try {
        const merged = Object.assign({}, req.query || {}, req.body || {});
        Object.defineProperty(req, 'query', {
          value: merged,
          writable: true,
          enumerable: true,
          configurable: true
        });
      } catch { /* keep original query */ }
      next();
    },
    handleOrigoWmsProxy
  );

  /* ── Thumbnail proxy: generates a WMS GetMap preview for a project (cached) ── */
  app.get(`/plugins/${pluginSlug}/api/thumbnail/:projectId`, async (req, res) => {
    try {
      const projectId = normalizeProjectId(req.params?.projectId || '');
      if (!projectId) return sendThumbnailPlaceholder(res, 'No preview');
      const reqApiKey = getRequestApiKey(req);
      const background = normalizeThumbnailBackground({
        type: String(req.query?.BGPROJECT || '').trim() && String(req.query?.BGLAYER || '').trim()
          ? 'layer'
          : String(req.query?.BGTYPE || '').trim(),
        sourceProjectId: req.query?.BGPROJECT,
        name: req.query?.BGLAYER
      });
      const authActive = typeof security?.isEnabled === 'function' ? security.isEnabled() : false;
      if (authActive) {
        const snapshot = readAccessSnapshot(dataRoot);
        if (!userCanAccessProject(snapshot, req.user || null, projectId)) {
          return sendThumbnailPlaceholder(res, 'Login required');
        }
      }
      let layers = String(req.query?.LAYERS || '').trim();
      if (!layers) {
        const idx = await readCacheIndex(projectId);
        const layerNames = (Array.isArray(idx?.layers) ? idx.layers : [])
          .filter((l) => String(l?.kind || 'layer').toLowerCase() === 'layer')
          .map((l) => String(l?.name || l?.layer || '').trim())
          .filter(Boolean);
        layers = layerNames.slice(0, 6).join(',');
      }
      if (!layers) return sendThumbnailPlaceholder(res, 'No layers');
      const baseUrl = getRequestBaseUrl(req);
      const thumbPath = await generateThumbnail(projectId, layers, baseUrl, req.headers.cookie, {
        background,
        apiKey: reqApiKey,
        authorization: req.get?.('authorization') || ''
      });
      if (thumbPath) {
        const asLegend = ['1', 'true', 'yes'].includes(String(req.query?.LEGEND || req.query?.legend || '').trim().toLowerCase());
        if (asLegend) {
          try {
            const swatch = await sharp(thumbPath)
              .resize(LEGEND_SWATCH_SIZE, LEGEND_SWATCH_SIZE, {
                fit: 'contain',
                background: { r: 255, g: 255, b: 255, alpha: 0 }
              })
              .png()
              .toBuffer();
            res.set('Cache-Control', 'public, max-age=300');
            res.type('image/png');
            return res.send(swatch);
          } catch (_) { /* fall through to full thumbnail */ }
        }
        res.set('Cache-Control', 'public, max-age=300');
        return res.sendFile(thumbPath);
      }
      return sendThumbnailPlaceholder(res, 'No thumbnail');
    } catch(err) { console.error('XERR', err);
      return sendThumbnailPlaceholder(res, 'No thumbnail');
    }
  });

  // Alternate thumbnail endpoint addressed by layer name, with project in query.
  // This keeps frontend/network traces focused on the layer identifier.
  app.get(`/plugins/${pluginSlug}/api/thumbnail/layer/:layerName`, async (req, res) => {
    try {
      const layerName = String(req.params?.layerName || '').trim();
      const projectId = normalizeProjectId(req.query?.project || '');
      if (!layerName || !projectId) return sendThumbnailPlaceholder(res, 'No preview');
      const authActive = typeof security?.isEnabled === 'function' ? security.isEnabled() : false;
      if (authActive) {
        const snapshot = readAccessSnapshot(dataRoot);
        if (!userCanAccessProject(snapshot, req.user || null, projectId)) {
          return sendThumbnailPlaceholder(res, 'Login required');
        }
      }
      const baseUrl = getRequestBaseUrl(req);
      const thumbPath = await generateThumbnail(projectId, layerName, baseUrl, req.headers.cookie);
      if (thumbPath) {
        res.set('Cache-Control', 'public, max-age=300');
        return res.sendFile(thumbPath);
      }
      return sendThumbnailPlaceholder(res, 'No thumbnail');
    } catch(err) { console.error('XERR', err);
      return sendThumbnailPlaceholder(res, 'No thumbnail');
    }
  });

  // Serve GeoTIFF terrain files for the QWC2 3D viewer (map3d.dtm.url).
  // Files are read from the project's folder inside qgisprojects/.

  // ── Origo Maps Portal ──
    app.get('/Qtiler2Origo/maps', async (req, res) => { res.sendFile(path.resolve(process.cwd(), 'plugins', 'Qtiler2Origo', 'admin-ui', 'maps.html')); });
    app.get('/Qtiler2Origo/portal/:slug', async (req, res) => { res.sendFile(path.resolve(process.cwd(), 'plugins', 'Qtiler2Origo', 'admin-ui', 'maps.html')); });
    app.get('/Qtiler2Origo/portal', async (req, res) => { res.sendFile(path.resolve(process.cwd(), 'plugins', 'Qtiler2Origo', 'admin-ui', 'maps.html')); });


  app.get('/Qtiler2Origo/terrain/:projectId/:filename', async (req, res) => {
    try {
      const projectId = normalizeProjectId(req.params?.projectId || '');
      const filename = String(req.params?.filename || '').replace(/[/\\]/g, '');
      if (!projectId || !filename || !/\.(tif|tiff)$/i.test(filename)) {
        return res.status(400).json({ error: 'invalid_request' });
      }
      // Resolve the file from the known project directories.
      const candidates = [
        path.join(projectsDir, projectId, filename),
        path.join(projectsDir, projectId, projectId, filename)
      ];
      let filePath = null;
      for (const c of candidates) {
        try { await fs.promises.access(c, fs.constants.R_OK); filePath = c; break; } catch { /* not found */ }
      }
      if (!filePath) return res.status(404).json({ error: 'not_found' });
      res.set('Content-Type', 'image/tiff');
      res.set('Cache-Control', 'public, max-age=3600');
      return res.sendFile(filePath);
    } catch (err) {
      console.error('[Qtiler2Origo] terrain serve error:', err?.message || err);
      return res.status(500).json({ error: 'server_error' });
    }
  });

  // -----------------------------------------------------------------------
  // Layer style extraction (Qtiler2Origo internal).
  // Returns a JSON description of a vector layer's QGIS renderer so the
  // client can render the layer as WFS while preserving the QGIS look.
  // Only simple renderers (singleSymbol, categorizedSymbol) are supported;
  // anything else returns { supported: false } so the publish pipeline can
  // fall back to WMS automatically.
  // Response is cached on disk under cache/<projectId>/_styles/<layer>.json
  // and invalidated when the source .qgz/.qgs mtime advances.
  // -----------------------------------------------------------------------
  app.get('/Qtiler2Origo/layer-style', async (req, res) => {
    try {
      const projectId = String(req.query.project || req.query.projectId || '').trim();
      const layerName = String(req.query.layer || '').trim();
      if (!projectId || !layerName) {
        return res.status(400).json({ error: 'missing_params' });
      }
      const safeProject = sanitizeFileToken(projectId);
      const safeLayer = String(layerName).replace(/[^a-zA-Z0-9_.-]/g, '_');
      if (!safeProject || !safeLayer) {
        return res.status(400).json({ error: 'invalid_params' });
      }

      const knownProjects = await listProjectsFromDisk(projectsDir);
      const found = knownProjects.find(p => String(p.id).toLowerCase() === projectId.toLowerCase());
      if (!found || !found.file) {
        return res.status(404).json({ error: 'project_not_found' });
      }

      const cacheDir = resolveRepoPath('cache', safeProject, '_styles');
      const cacheFile = path.join(cacheDir, `${safeLayer}.json`);

      try {
        const [cachedStat, projStat] = await Promise.all([
          fs.promises.stat(cacheFile).catch(() => null),
          fs.promises.stat(found.file).catch(() => null)
        ]);
        if (cachedStat && projStat && cachedStat.mtimeMs >= projStat.mtimeMs) {
          const cached = await fs.promises.readFile(cacheFile, 'utf8');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.type('application/json');
          return res.send(cached);
        }
      } catch { /* fall through to render */ }

      const rendererPool = app.locals.tileRendererPool;
      if (!rendererPool || typeof rendererPool.renderTile !== 'function') {
        return res.status(503).json({ error: 'renderer_unavailable' });
      }

      let result;
      try {
        result = await rendererPool.renderTile({
          action: 'extract_layer_style',
          project_path: found.file.replace(/\\/g, '/'),
          layer: layerName
        });
      } catch (err) {
        const status = err?.code === 'QUEUE_FULL' ? 503 : 500;
        return res.status(status).json({ error: String(err?.message || err) });
      }

      if (!result || result.status !== 'success') {
        return res.status(500).json({ error: result?.message || result?.error || 'extract_failed' });
      }

      try {
        await fs.promises.mkdir(cacheDir, { recursive: true });
        await fs.promises.writeFile(cacheFile, JSON.stringify(result), 'utf8');
      } catch (err) {
        console.warn('[Qtiler2Origo] layer-style cache write failed:', err?.message || err);
      }

      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.json(result);
    } catch (err) {
      console.error('[Qtiler2Origo] layer-style error:', err?.message || err);
      return res.status(500).json({ error: 'server_error' });
    }
  });

  // -----------------------------------------------------------------------
  // Layer fields/attributes (for filter & label dropdowns in the editor)
  // -----------------------------------------------------------------------
  app.get('/Qtiler2Origo/layer-fields', async (req, res) => {
    try {
      const projectId = String(req.query.project || req.query.projectId || '').trim();
      const layerName = String(req.query.layer || '').trim();
      if (!projectId || !layerName) return res.status(400).json({ error: 'missing_params' });

      const knownProjects = await listProjectsFromDisk(projectsDir);
      const found = knownProjects.find(p => String(p.id).toLowerCase() === projectId.toLowerCase());
      if (!found || !found.file) return res.status(404).json({ error: 'project_not_found' });

      const rendererPool = app.locals.tileRendererPool;
      if (!rendererPool || typeof rendererPool.renderTile !== 'function') {
        return res.status(503).json({ error: 'renderer_unavailable' });
      }

      let result;
      try {
        result = await rendererPool.renderTile({
          action: 'layer_fields',
          project_path: found.file.replace(/\\/g, '/'),
          layer: layerName
        });
      } catch (err) {
        return res.status(500).json({ error: String(err?.message || err) });
      }
      return res.json(result || { fields: [] });
    } catch (err) {
      console.error('[Qtiler2Origo] layer-fields error:', err?.message || err);
      return res.status(500).json({ error: 'server_error' });
    }
  });

  // -----------------------------------------------------------------------
  // Layer unique values for a given field (used by filter value dropdown)
  // -----------------------------------------------------------------------
  app.get('/Qtiler2Origo/layer-values', async (req, res) => {
    try {
      const projectId = String(req.query.project || req.query.projectId || '').trim();
      const layerName = String(req.query.layer || '').trim();
      const fieldName = String(req.query.field || '').trim();
      const limit = Math.max(1, Math.min(2000, parseInt(req.query.limit || '500', 10) || 500));
      if (!projectId || !layerName || !fieldName) return res.status(400).json({ error: 'missing_params' });

      const knownProjects = await listProjectsFromDisk(projectsDir);
      const found = knownProjects.find(p => String(p.id).toLowerCase() === projectId.toLowerCase());
      if (!found || !found.file) return res.status(404).json({ error: 'project_not_found' });

      const rendererPool = app.locals.tileRendererPool;
      if (!rendererPool || typeof rendererPool.renderTile !== 'function') {
        return res.status(503).json({ error: 'renderer_unavailable' });
      }
      let result;
      try {
        result = await rendererPool.renderTile({
          action: 'layer_values',
          project_path: found.file.replace(/\\/g, '/'),
          layer: layerName,
          field: fieldName,
          limit
        });
      } catch (err) {
        return res.status(500).json({ error: String(err?.message || err) });
      }
      return res.json(result || { values: [] });
    } catch (err) {
      console.error('[Qtiler2Origo] layer-values error:', err?.message || err);
      return res.status(500).json({ error: 'server_error' });
    }
  });

  // -----------------------------------------------------------------------
  // QGIS SVG colorizer: serve SVG with fill colors replaced by ?color=#xxx
  // OpenLayers Icon `color` only tints raster images and SVGs without
  // explicit fill attrs. This endpoint rewrites baked-in fills so user-
  // chosen colors are honoured by the rendered icon.
  // -----------------------------------------------------------------------
  const sendColoredSvg = async (req, res, svgRoot) => {
    try {
      const rel = req.params[0];
      const safeRel = rel.replace(/\\/g, '/').replace(/\.\.+/g, '');
      const filePath = path.join(svgRoot, safeRel);
      if (!filePath.toLowerCase().startsWith(svgRoot.toLowerCase())) {
        return res.status(400).end('bad path');
      }
      let content = await fs.promises.readFile(filePath, 'utf8');

      // OpenLayers and Origo required explicit viewBox and matching width/height for aspect ratios
      let hasVB = /viewBox\s*=/i.test(content);
      const wMatch = content.match(/<svg[^>]*\swidth=["']?([\d.]+)["']?/i);
      const hMatch = content.match(/<svg[^>]*\sheight=["']?([\d.]+)["']?/i);
      
      if (!hasVB && wMatch && hMatch) {
        content = content.replace(/<svg\b/i, `<svg viewBox="0 0 ${wMatch[1]} ${hMatch[1]}" `);
        hasVB = true;
      }
      
      if (!wMatch || !hMatch) {
         const vbMatch = content.match(/viewBox=["']?[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)["']?/i);
         const w = (wMatch && wMatch[1]) || (vbMatch ? vbMatch[1] : '100');
         const h = (hMatch && hMatch[1]) || (vbMatch ? vbMatch[2] : '100');
         if (!wMatch && !hMatch) {
           content = content.replace(/<svg\b/i, `<svg width="${w}" height="${h}" `);
         } else if (!wMatch) {
           content = content.replace(/<svg\b/i, `<svg width="${w}" `);
         } else if (!hMatch) {
           content = content.replace(/<svg\b/i, `<svg height="${h}" `);
         }
      }

      const colorRaw = String(req.query.color || '').trim();
      const colorMatch = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(colorRaw);
      if (colorMatch) {
        const color = '#' + colorMatch[1];
        // Replace explicit fill attributes (skip 'none')
        content = content.replace(/fill\s*=\s*"(?!none)([^"]*)"/gi, `fill="${color}"`);
        content = content.replace(/fill\s*=\s*'(?!none)([^']*)'/gi, `fill='${color}'`);
        // Replace fill: in style attributes/CSS
        content = content.replace(/fill\s*:\s*(?!none)#?[0-9a-fA-F]{3,8}/gi, `fill:${color}`);
        content = content.replace(/fill\s*:\s*(?!none)rgb\([^)]+\)/gi, `fill:${color}`);
        // Inject default fill on root <svg> if no fill anywhere
        if (!/fill\s*=|fill\s*:/i.test(content)) {
          content = content.replace(/<svg\b/i, `<svg fill="${color}"`);
        }
      }
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(content);
    } catch (err) {
      return res.status(404).end('svg not found');
    }
  };

  app.get(/^\/qgis-svg-colored\/(.+\.svg)$/i, async (req, res) => {
    const qgisPrefix = process.env.QGIS_PREFIX || 'C:\\QGIS_344\\apps\\qgis';
    return sendColoredSvg(req, res, path.join(qgisPrefix, 'svg'));
  });

  app.get(/^\/qtiler-symbology-svg-colored\/(.+\.svg)$/i, async (req, res) => {
    return sendColoredSvg(req, res, path.join(process.cwd(), 'data', 'Qtiler-symbology'));
  });

  // -----------------------------------------------------------------------
  // QGIS SVG library list (for graphical icon picker)
  // -----------------------------------------------------------------------
  app.get('/Qtiler2Origo/qgis-svg-list', async (_req, res) => {
    try {
      const qgisPrefix = process.env.QGIS_PREFIX || 'C:\\QGIS_344\\apps\\qgis';
      const svgRoot = path.join(qgisPrefix, 'svg');
      const categories = [];

      const encodeRelPath = (rel) => rel.split('/').map((part) => encodeURIComponent(part)).join('/');
      const collectSvgFiles = async (dir, prefix = '') => {
        const icons = [];
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            icons.push(...await collectSvgFiles(full, rel));
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.svg')) {
            icons.push(rel.replace(/\.svg$/i, ''));
          }
        }
        return icons;
      };

      const addSvgLibraryCategories = async (root, urlPrefix, recursive = false, source = '') => {
        if (!fs.existsSync(root)) return;
        const dirEntries = await fs.promises.readdir(root, { withFileTypes: true });
        for (const entry of dirEntries) {
          if (!entry.isDirectory()) continue;
          const catName = entry.name;
          const catPath = path.join(root, catName);
          try {
            const relIcons = recursive
              ? await collectSvgFiles(catPath)
              : (await fs.promises.readdir(catPath)).filter(f => f.toLowerCase().endsWith('.svg')).map(f => f.replace(/\.svg$/i, ''));
            const icons = relIcons.sort((a, b) => a.localeCompare(b)).map((relName) => ({
              name: path.basename(relName),
              url: `${urlPrefix}/${encodeURIComponent(catName)}/${encodeRelPath(`${relName}.svg`)}`,
              source
            }));
            if (icons.length) categories.push({ name: catName, source, icons });
          } catch {/* skip */}
        }
      };

      await addSvgLibraryCategories(svgRoot, '/qgis-svg', false, 'QGIS');
      await addSvgLibraryCategories(path.join(process.cwd(), 'data', 'Qtiler-symbology'), '/qtiler-symbology-svg', true, 'Qtiler');

      for (const category of categories) {
        category.icons.sort((a, b) => a.name.localeCompare(b.name));
      }
      categories.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')) || String(a.source || '').localeCompare(String(b.source || '')));
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.json({ categories });
    } catch (err) {
      console.error('[Qtiler2Origo] qgis-svg-list error:', err?.message || err);
      return res.status(500).json({ error: 'server_error' });
    }
  });

  const { spawn } = await import('child_process');
  const searchHandler = async (req, res) => {
    try {
      const q = req.query.searchtext || req.query.query || req.query.q;
      // QWC2 fulltext provider sends `filter` (comma-separated). Older callers
      // may send `map` or `dataset`. Origo callers send `project`. Use the
      // first non-empty token as themeId.
      const filterRaw = req.query.filter || req.query.map || req.query.dataset || req.query.project || '';
      const filterStr = Array.isArray(filterRaw) ? filterRaw[0] : filterRaw;
      const themeId = String(filterStr || '').split(',').map(s => s.trim()).filter(Boolean)[0];
      if (!q || !themeId) return res.json({ results: [], result_counts: [] });

      const safeProject = sanitizeFileToken(themeId);
      if (!safeProject) return res.json({ results: [], result_counts: [] });

      // Build list of projects to search: primary + any `extra=pid1,pid2`.
      // Per-project layer name filters arrive as `lf_<pid>=lay1,lay2`.
      const extraRaw = req.query.extra ? String(req.query.extra) : '';
      const projectIds = [safeProject];
      for (const pid of extraRaw.split(',').map((s) => sanitizeFileToken(s.trim())).filter(Boolean)) {
        if (!projectIds.includes(pid)) projectIds.push(pid);
      }

      const qgisPrefix = process.env.QGIS_PREFIX || process.env.QGIS_PREFIX_PATH || '';
      // Use configured PYTHON_EXE, otherwise fallback to system python
      let pythonExe = process.env.PYTHON_EXE || (process.platform === 'win32' ? 'python' : 'python3');

      const availableGroups = await listProjectsFromDisk(projectsDir).catch(() => []);
      let qsScript = path.join(process.cwd(), 'python', 'search_layer.py');
      const allResults = [];

      // Resolve each project: read searchable-layers config and project file.
      // Skip projects that aren't searchable instead of failing the whole call.
      const perProject = [];
      for (const pid of projectIds) {
        const cfgPath = path.join(dataRoot, 'searchable-layers', `${pid}.json`);
        let layersCfg = [];
        try {
          const raw = await fs.promises.readFile(cfgPath, 'utf8');
          layersCfg = JSON.parse(raw);
        } catch (err) {
          if (err && err.code !== 'ENOENT') console.error('[Search] read', pid, err?.message);
          continue;
        }
        if (!Array.isArray(layersCfg) || layersCfg.length === 0) continue;
        // Apply per-project layer name filter if provided.
        const filterRaw = req.query[`lf_${pid}`];
        const filterList = filterRaw
          ? String(filterRaw).split(',').map((s) => s.trim()).filter(Boolean)
          : null;
        if (filterList && filterList.length) {
          layersCfg = layersCfg.filter((t) => {
            const ln = t.layerId || t.name || t.id;
            return ln && filterList.includes(String(ln));
          });
          if (!layersCfg.length) continue;
        }
        const match = availableGroups.find((x) => x.id === pid);
        if (!match || !match.file) continue;
        perProject.push({ pid, qsPath: match.file, layersCfg });
      }

      if (!perProject.length) return res.json({ results: [], result_counts: [] });

      const makeQgisEnv = () => {
        const env = { ...process.env, QGIS_PREFIX: qgisPrefix };
        if (!qgisPrefix || process.platform !== 'win32') return env;
        const qgisRoot = qgisPrefix;
        const pythonHome = path.join(qgisRoot, '..', 'Python312');
        const pythonLib = path.join(pythonHome, 'Lib');
        const qgisPy = path.join(qgisRoot, 'python');
        const qgisBin = path.join(qgisRoot, '..', '..', 'bin');
        const qgisAppBin = path.join(qgisRoot, 'bin');
        const pathParts = (env.PATH || '').split(';');
        env.PATH = [...new Set([qgisBin, qgisAppBin, ...pathParts])].join(';');
        env.PYTHONHOME = pythonHome;
        env.PYTHONPATH = [pythonLib, qgisPy].join(';');
        env.PYTHONNOUSERSITE = '1';
        env.PYTHONUTF8 = '1';
        env.PYTHONUNBUFFERED = '1';
        return env;
      };

      const lim = Number(req.query.limit) || 50;

      // One Python spawn per project (loads QGIS + project once, searches all
      // configured layers). Projects are processed in parallel.
      for (const { pid, qsPath, layersCfg } of perProject) {
        const layerSpecs = [];
        const layerMeta = new Map();
        for (const t of layersCfg) {
          const ln = t.layerId || t.name || t.id;
          if (!ln) continue;
          const dField = t.searchAttribute || t.titleField || (t.fields && t.fields[0]) || 'name';
          const fList = Array.isArray(t.fields) && t.fields.length ? t.fields : [dField];
          layerSpecs.push({ name: ln, fields: fList, title_field: dField });
          layerMeta.set(ln, { dField });
        }
        if (!layerSpecs.length) continue;

        const payload = JSON.stringify({
          project: qsPath,
          query: q,
          limit: lim,
          layers: layerSpecs
        });

        const p = new Promise((resolve) => {
          const child = spawn(pythonExe, [qsScript, '--batch'], { env: makeQgisEnv() });
          let stdout = '', stderr = '';
          child.stdout.on('data', d => stdout += d.toString());
          child.stderr.on('data', d => stderr += d.toString());
          child.on('close', () => {
            const groups = [];
            try {
              const out = JSON.parse(stdout);
              const arr = Array.isArray(out?.layers) ? out.layers : [];
              for (const lr of arr) {
                const ln = lr.name;
                const meta = layerMeta.get(ln) || { dField: 'name' };
                const hits = Array.isArray(lr.results) ? lr.results : [];
                const items = hits.map(h => ({
                  id: `${pid}:${ln}.${h.id}`,
                  text: String(h[meta.dField] != null ? h[meta.dField] : `${ln} #${h.id}`),
                  bbox: h.bbox || null,
                  x: h.x,
                  y: h.y,
                  crs: h.crs || 'EPSG:3857'
                }));
                groups.push({
                  id: `${pid}:${ln}`,
                  layerId: ln,
                  projectId: pid,
                  title: `${ln} (${pid})`,
                  items
                });
              }
            } catch (e) {
              console.error('[Search plugin] batch parse fail for project:', pid, '\nStderr:', stderr);
            }
            resolve(groups);
          });
          child.on('error', () => resolve([]));
          try { child.stdin.write(payload); child.stdin.end(); } catch {}
        });
        allResults.push(p);
      }

      const completedNested = await Promise.all(allResults);
      const completed = completedNested.flat();
      // Convert internal shape to QWC2 fulltext response shape.
      // Each hit becomes { feature: { feature_id, display, bbox, srid, dataproduct_id, id_field_name } }.
      const fulltextResults = [];
      const counts = [];
      for (const grp of completed) {
        const layerId = grp.layerId || grp.id;
        const items = Array.isArray(grp.items) ? grp.items : [];
        if (!items.length) continue;
        const projCfg = perProject.find((pp) => pp.pid === grp.projectId);
        const layerCfg = (projCfg?.layersCfg || []).find(l => (l.layerId || l.name || l.id) === layerId) || {};
        const idField = layerCfg.idAttribute || 'id';
        // Derive numeric SRID from "EPSG:NNNN"
        for (const it of items) {
          const crsStr = String(it.crs || 'EPSG:3857');
          const sridMatch = crsStr.match(/(\d+)/);
          const srid = sridMatch ? Number(sridMatch[1]) : 3857;
          let bbox = it.bbox;
          if (!Array.isArray(bbox) && it.x != null && it.y != null) {
            bbox = [it.x, it.y, it.x, it.y];
          }
          if (!Array.isArray(bbox) || bbox.length !== 4) continue;
          fulltextResults.push({
            feature: {
              feature_id: String(it.id || ''),
              display: String(it.text || ''),
              bbox,
              srid,
              dataproduct_id: layerId,
              id_field_name: idField
            }
          });
        }
        counts.push({ dataproduct_id: layerId, count: items.length });
      }

      // Origo search expects a flat array of features where each item has the
      // attribute named by `searchAttribute` (label) and optionally
      // `geometryAttribute` (WKT). See plugins/Qtiler2Origo profile defaults.
      if (req.query.origo || req._forceOrigo) {
        const origoItems = [];
        for (const grp of completed) {
          const items = Array.isArray(grp.items) ? grp.items : [];
          const header = grp.title || grp.layerId || grp.id;
          for (const it of items) {
            let wkt = null;
            if (Array.isArray(it.bbox) && it.bbox.length === 4) {
              const [minX, minY, maxX, maxY] = it.bbox;
              const cx = (minX + maxX) / 2;
              const cy = (minY + maxY) / 2;
              wkt = `POINT(${cx} ${cy})`;
            } else if (it.x != null && it.y != null) {
              wkt = `POINT(${it.x} ${it.y})`;
            }
            if (!wkt) continue;
            origoItems.push({
              name: String(it.text || ''),
              geom: wkt,
              group: header,
              content: String(it.text || '')
            });
          }
        }
        return res.json(origoItems);
      }

      res.json({ results: fulltextResults, result_counts: counts });
    } catch(err) { console.error('XERR', err);
      console.error('/Qtiler2Origo/search API Error:', err);
      if (req.query.origo || req._forceOrigo) return res.json([]);
      res.json({ results: [], result_counts: [] });
    }
  };
  app.get('/Qtiler2Origo/search', searchHandler);
  // Origo-shaped search endpoint: same handler, returns flat array when called
  // via the plugin URL. The defaultSearchOptions above point Origo here with
  // `?project=<id>&origo=1` baked in.
  app.get('/plugins/Qtiler2Origo/origo-search', (req, res) => {
    req._forceOrigo = true;
    return searchHandler(req, res);
  });

  await applyBrandingToQwc2Configs();
  // Standalone server disabled; no auto-start

  return {
    dispose: async () => {
      // nothing to stop
    }
  };
};
