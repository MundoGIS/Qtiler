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
import { copyRecursive, removeRecursive } from '../../lib/fsRecursive.js';
import { readProjectAccessFromDb } from '../../lib/authDb.js';
import { getRequestBaseUrl } from '../../lib/requestBaseUrl.js';

const DEFAULT_REPO = process.env.QTWC_QWC2_REPO || 'qgis/qwc2';
const DEFAULT_VERSION = process.env.QTWC_QWC2_VERSION || 'v2026.0.12-lts';
const DEFAULT_STANDALONE_PORT = Number(process.env.QTWC_QWC2_PORT || 3089);
const AUTO_START_STANDALONE = !['1', 'true', 'yes'].includes(String(process.env.QTWC_QWC2_AUTOSTART || '0').toLowerCase());
const ENV_STANDALONE_PORT = Number(process.env.QTWC_QWC2_PORT || 0);
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ALLOWED_LOGO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp']);

const nowIso = () => new Date().toISOString();

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

const sanitizeFileToken = (value) => String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_');

const safeLayerNameForWfs = (value) => {
  if (!value) return '';
  return String(value).normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
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
      name: null,
      isDefault: item.isDefault === true
    };

    if (type === 'layer') {
      const sourceProjectId = normalizeProjectId(item.sourceProjectId || '');
      const name = String(item.name || '').trim();
      if (!sourceProjectId || !knownProjectIds.has(sourceProjectId) || !name) return;
      option.sourceProjectId = sourceProjectId;
      option.name = name;
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
  // Use the pre-built release asset (qwc2-stock-app.zip) instead of source code
  return `https://github.com/${safeRepo}/releases/download/${safeVersion}/qwc2-stock-app.zip`;
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
          // Only include releases that have the stock app asset
          const hasAsset = (r.assets || []).some((a) => a.name === 'qwc2-stock-app.zip');
          return hasAsset;
        });
        resolve(filtered.map((r) => ({
          tag: r.tag_name,
          name: r.name || r.tag_name,
          prerelease: !!r.prerelease,
          published: r.published_at || r.created_at || null,
          assetUrl: (r.assets || []).find((a) => a.name === 'qwc2-stock-app.zip')?.browser_download_url || null,
          assetSize: (r.assets || []).find((a) => a.name === 'qwc2-stock-app.zip')?.size || 0
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

export const register = async ({ app, security, dataDir, baseDir, registerStore }) => {
  const pluginSlug = (path.basename(baseDir || '') || 'Qtiler2qwc').replace(/[^a-z0-9-_]/gi, '') || 'Qtiler2qwc';
  const adminUiDir = path.join(baseDir, 'admin-ui');
  const dataRoot = path.resolve(dataDir, '..');
  const runtimeRoot = path.join(dataDir, 'qwc2');
  const installRoot = path.join(runtimeRoot, 'current');
  const publishedRoot = path.join(runtimeRoot, 'published');
  const brandingRoot = path.join(runtimeRoot, 'branding');
  const projectsCatalogPath = path.join(runtimeRoot, 'projects-catalog.json');
  const projectsDir = path.join(process.cwd(), 'qgisprojects');
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

  await fs.promises.mkdir(runtimeRoot, { recursive: true });
  await fs.promises.mkdir(publishedRoot, { recursive: true });
  await fs.promises.mkdir(brandingRoot, { recursive: true });

  const adminOnly = ensureAdmin(security);
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
    return `/qtiler/branding/logo?v=${stamp}`;
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

  const applyBrandingToQwc2Configs = async () => {
    const state = await readState();
    const logoPath = await resolveLogoPath();
    const logoSrc = logoPath ? await getLogoPublicUrl() : null;
    const configPaths = [
      path.join(installRoot, 'prod', 'config.json'),
      path.join(installRoot, 'static', 'config.json')
    ];

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
      path.join(installRoot, 'prod'),
      installRoot,
      path.join(installRoot, 'static')
    ];

    for (const candidate of candidates) {
      try {
        await fs.promises.access(path.join(candidate, 'index.html'), fs.constants.R_OK);
        await fs.promises.access(path.join(candidate, 'assets'), fs.constants.R_OK);
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

  const collectPublishedProfiles = async (baseUrl = '') => {
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
          ? `${baseLaunch}/Qtiler2qwc/webmap/?qtiler_profile=${encodeURIComponent(profileKey)}#/?t=${encodeURIComponent(projectId)}`
          : `/Qtiler2qwc/webmap/?qtiler_profile=${encodeURIComponent(profileKey)}#/?t=${encodeURIComponent(projectId)}`;
        const mainLayerNames = (parsed?.layers || []).filter((l) => l.role === 'main').map((l) => l.name);
        rows.push({
          projectId,
          profileKey,
          name: parsed?.name || projectId,
          description: parsed?.description || null,
          generatedAt: parsed?.generatedAt || null,
          mainLayerNames,
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

  /**
   * Filter profiles based on QtilerAuth permissions
   */
  const filterProfilesByAccess = (profiles, user) => {
    const snapshot = readAccessSnapshot(dataRoot);
    return profiles.filter((p) => {
      const projectId = normalizeProjectId(p.projectId);
      if (!projectId) return false;
      return userCanAccessProject(snapshot, user, projectId);
    });
  };

  const profileRequiresAuthentication = (profile) => {
    const projectId = normalizeProjectId(profile?.projectId || '');
    if (!projectId) return false;
    const snapshot = readAccessSnapshot(dataRoot);
    return !userCanAccessProject(snapshot, null, projectId);
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
      const mainProjectId = normalizeProjectId(profile?.projectId || '');
      if (mainProjectId) sourceProjectIds.add(mainProjectId);

      const profileLayers = Array.isArray(profile?.layers) ? profile.layers : [];
      for (const layer of profileLayers) {
        const pid = normalizeProjectId(layer?.sourceProjectId || '');
        if (pid) sourceProjectIds.add(pid);
      }

      const profileBackgrounds = Array.isArray(profile?.backgrounds) ? profile.backgrounds : [];
      for (const bg of profileBackgrounds) {
        const pid = normalizeProjectId(bg?.sourceProjectId || '');
        if (pid) sourceProjectIds.add(pid);
      }
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
    const indexPath = path.join(process.cwd(), 'cache', safeName, 'index.json');
    try {
      const raw = await fs.promises.readFile(indexPath, 'utf8');
      return JSON.parse(raw || '{}');
    } catch {
      return null;
    }
  };

  /**
   * Read project-level layer flags (e.g. wfsEditable/wfsSearchable)
   * from cache/<project>/project-config.json.
   */
  const readProjectLayerFlags = async (projectId) => {
    const safeName = sanitizeFileToken(projectId);
    if (!safeName) return {};
    const cfgPath = path.join(process.cwd(), 'cache', safeName, 'project-config.json');
    try {
      const raw = await fs.promises.readFile(cfgPath, 'utf8');
      const parsed = JSON.parse(raw || '{}');
      const layers = parsed?.layers && typeof parsed.layers === 'object' ? parsed.layers : {};
      return layers;
    } catch {
      return {};
    }
  };

  /**
   * Compute the project extent and CRS from cache index data.
   * Returns { wgs84, native, crs } or null.
   */
  const getProjectExtent = async (projectId) => {
    const cacheIndex = await readCacheIndex(projectId);
    if (!cacheIndex?.layers?.length) return null;
    const first = cacheIndex.layers[0];
    const wgs84 = first.project_extent_wgs84 || first.extent_wgs84;
    const native = first.project_extent || first.extent;
    const crs = first.project_crs || first.crs || 'EPSG:3857';
    if (!wgs84 || !native) return null;
    return { wgs84, native, crs };
  };

  /**
   * Generate or return a cached WMS thumbnail for a project + layers combo.
   * Saves to data/Qtiler2qwc/thumbs/<projectId>_<hash>.jpg.
   */
  const thumbCacheDir = path.join(dataRoot, 'thumbs');
  const generateThumbnail = async (projectId, layers, baseUrl, cookieHeader) => {
    const safePid = sanitizeFileToken(projectId);
    if (!safePid) return null;
    const hash = layers ? sanitizeFileToken(layers.replace(/,/g, '_')) : '_all';
    const thumbPath = path.join(thumbCacheDir, `${safePid}_${hash}.jpg`);
    try {
      const stat = await fs.promises.stat(thumbPath);
      if (stat.isFile() && stat.size > 0) {
        return thumbPath;
      }
    } catch { /* not cached yet */ }

    const extent = await getProjectExtent(projectId);
    const bbox = extent?.native || [-20037508, -20037508, 20037508, 20037508];
    const crs = extent?.crs || 'EPSG:3857';
    const wmsParams = new URLSearchParams({
      SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0',
      LAYERS: layers, STYLES: '', CRS: crs,
      BBOX: bbox.join(','), WIDTH: '280', HEIGHT: '160',
      FORMAT: 'image/jpeg', TRANSPARENT: 'false', project: projectId
    });
    const wmsUrl = `${baseUrl}/wms?${wmsParams.toString()}`;
    const parsedUrl = new URL(wmsUrl);
    const reqOptions = {
      hostname: parsedUrl.hostname, port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search, headers: {}
    };
    if (cookieHeader) reqOptions.headers.cookie = cookieHeader;

    return new Promise((resolve) => {
      const fetcher = wmsUrl.startsWith('https') ? https : http;
      const proxyReq = fetcher.get(reqOptions, async (proxyRes) => {
        try {
          const contentType = String(proxyRes.headers['content-type'] || '');
          if (!contentType.startsWith('image/')) {
            proxyRes.resume();
            return resolve(null);
          }
          await fs.promises.mkdir(thumbCacheDir, { recursive: true });
          const ws = fs.createWriteStream(thumbPath);
          proxyRes.pipe(ws);
          ws.on('finish', () => resolve(thumbPath));
          ws.on('error', () => resolve(null));
        } catch { resolve(null); }
      });
      proxyReq.on('error', () => resolve(null));
    });
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
    baseConfig.searchServiceUrl = '/Qtiler2qwc/search';
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
      topBar.cfg.logoSrc = '/qtiler/branding/logo';
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
    baseConfig.searchServiceUrl = '/Qtiler2qwc/search';
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
        if (p.name === 'Editing' && (typeof p.cfg.serviceUrl !== 'string' || !p.cfg.serviceUrl.trim())) p.cfg.serviceUrl = '/wfs';
        if (p.name === 'Identify' && (typeof p.cfg.serviceUrl !== 'string' || !p.cfg.serviceUrl.trim())) p.cfg.serviceUrl = '/wms';
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
            // QWC2 prepends /Qtiler2qwc/webmap/assets to thumbnail paths.
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
        let preset = null;
        try {
          const ext = await getProjectExtent(bg.sourceProjectId);
          const crs = ext?.crs || null;
          if (crs) {
            preset = await findTileGridPresetForCrs(crs);
          }
        } catch (e) {
          // ignore and fallback below
        }

        const presetId = String(preset?.id || preset?.identifier || '').trim();
        const hasPresetMatrices = Array.isArray(preset?.matrices) && preset.matrices.length > 0;

        if (presetId && hasPresetMatrices) {
          const safeName = `wmts:${bg.sourceProjectId}/${bg.name}`;
          // Use the on-demand tile route that accepts raw project/layer names
          // and caches generated tiles on first request.
          const wmtsUrl = `${qtilerBaseUrl}/wmts/${encodeURIComponent(bg.sourceProjectId)}/${encodeURIComponent(bg.name)}/{TileMatrix}/{TileCol}/{TileRow}.png`;
          const resolutions = preset.matrices
            .map((m) => Number(m?.resolution))
            .filter((r) => Number.isFinite(r));

          bgLayersGlobal.push({
            name: safeName,
            title: bg.title || bg.name,
            type: 'wmts',
            url: wmtsUrl,
            tileMatrixPrefix: '',
            tileMatrixSet: presetId,
            originX: (typeof (preset?.topLeftCorner?.[0]) === 'number') ? preset.topLeftCorner[0] : -20037508.34278925,
            originY: (typeof (preset?.topLeftCorner?.[1]) === 'number') ? preset.topLeftCorner[1] : 20037508.34278925,
            projection: preset?.coordinateReferenceSystem || 'EPSG:3857',
            resolutions,
            tileSize: [256, 256],
            // QWC2 prepends /Qtiler2qwc/webmap/assets to thumbnail paths.
            // Use an assets-relative path that resolves to /plugins/...
            thumbnail: `../../../../plugins/${pluginSlug}/api/thumbnail/layer/${encodeURIComponent(bg.name)}?project=${encodeURIComponent(bg.sourceProjectId)}`
          });
          pushThemeBg(safeName, bg.isDefault === true);
        } else {
          // Fallback for projects without tile-grid preset metadata.
          const safeName = `wms:${bg.sourceProjectId}/${bg.name}`;
          bgLayersGlobal.push({
            name: safeName,
            title: bg.title || bg.name,
            type: 'wms',
            url: `${qtilerBaseUrl}/wms?project=${encodeURIComponent(bg.sourceProjectId)}`,
            params: {
              LAYERS: bg.name,
              TRANSPARENT: false,
              VERSION: '1.3.0',
              FORMAT: 'image/png'
            },
            thumbnail: `../../../../plugins/${pluginSlug}/api/thumbnail/layer/${encodeURIComponent(bg.name)}?project=${encodeURIComponent(bg.sourceProjectId)}`
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
      return sl;
    });

    const bgResult = await buildBackgroundLayers(profile, qtilerBaseUrl);
    const searchEnabled = profile.features?.search !== false;
    // QWC2 only ships 4 built-in providers: coordinates, nominatim, qgis, fulltext.
    // We expose our /Qtiler2qwc/search endpoint via the `fulltext` provider; the
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
      // QWC2 prepends /Qtiler2qwc/webmap/assets to thumbnail paths.
      // Use an assets-relative path that resolves to /plugins/...
      thumbnail: `../../../../plugins/${pluginSlug}/api/thumbnail/${encodeURIComponent(projectId)}${mainLayers.length ? `?LAYERS=${encodeURIComponent(mainLayers.map((l) => String(l.name || '').trim()).filter(Boolean).join(','))}` : ''}`
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
          for (const dir of candidates) {
            let entries = [];
            try { entries = await fs.promises.readdir(dir); } catch { continue; }
            const tif = entries.find((e) => /\.tif$/i.test(e));
            if (tif) {
              const terrainUrl = `${qtilerBaseUrl}/Qtiler2qwc/terrain/${encodeURIComponent(projectId)}/${encodeURIComponent(tif)}`;
              return { url: terrainUrl, crs: projectCrs };
            }
          }
        } catch { /* ignore */ }
        return null;
      })();
      item.map3d = {
        ...(dtm ? { dtm } : {})
        // basemaps: intentionally omitted - QWC2 3D tries to build OL WMTS
        // tile sources from external wmts: background layers and crashes when
        // the tileGrid extent is null. The 3D scene renders the main WMS
        // layers correctly without background basemaps.
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

    // Add WFS edit config for editable/queryable vector layers
    const wfsLayers = mainLayers.filter((l) => {
      const cached = cachedLayers.find((c) => c.name === l.name);
      const cfgFlags = (() => {
        const direct = projectLayerFlags?.[l.name] && typeof projectLayerFlags[l.name] === 'object' ? projectLayerFlags[l.name] : null;
        if (direct) return direct;
        for (const [k, v] of Object.entries(projectLayerFlags || {})) {
          if (safeLayerNameForWfs(k) === safeLayerNameForWfs(l.name) && v && typeof v === 'object') return v;
        }
        return null;
      })();
      const isVectorLike = cached?.type === 'vector' || !!cached?.geometry_type;
      return l?.editable === true || cfgFlags?.wfsEditable === true || isVectorLike;
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
      console.warn(`[Qtiler2qwc] Could not load print layouts for ${projectId}:`, err?.message || err);
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
        searchServiceUrl: `${qtilerBaseUrl}/Qtiler2qwc/search`,
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

  // startStandaloneServer removed — QWC2 served from same-origin under /Qtiler2qwc/webmap
  const startStandaloneServer = async (_port) => { return { port: null }; };

  const maybeAutoStartStandalone = async () => { /* removed */ };

  app.use(`/plugins/${pluginSlug}/admin-ui`, express.static(adminUiDir));
  app.use(`/plugins/${pluginSlug}/published`, express.static(publishedRoot, { index: false }));
  // Serve dynamic, sanitized config/themes for the plugin-local QWC2 path so
  // the admin UI and local links always receive runtime-built configs.
  app.get(`/plugins/${pluginSlug}/qwc2/config.json`, async (req, res) => {
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
      config.searchServiceUrl = '/Qtiler2qwc/search';
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
        if (!webRoot) return res.status(500).json({ error: 'qwc2_config_failed' });
        const raw = await fs.promises.readFile(path.join(webRoot, 'config.json'), 'utf8');
        let base = {};
        try { base = JSON.parse(raw); } catch { base = {}; }
        base.searchServiceUrl = '/Qtiler2qwc/search';
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
        return res.status(500).json({ error: 'qwc2_config_failed' });
      }
    }
  });

  app.get(`/plugins/${pluginSlug}/qwc2/themes.json`, async (req, res) => {
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
        if (webRoot) return res.sendFile(path.join(webRoot, 'themes.json'));
      } catch {}
      return res.status(500).json({ error: 'qwc2_themes_failed' });
    }
  });
  app.get('/qtiler/branding/logo', async (_req, res) => {
    const logoPath = await resolveLogoPath();
    if (!logoPath) return res.status(404).json({ error: 'logo_not_configured' });
    return res.sendFile(logoPath);
  });
  app.get(`/plugins/${pluginSlug}/admin`, (_req, res) => {
    res.redirect(`/plugins/${pluginSlug}/admin-ui/`);
  });

  app.use(`/plugins/${pluginSlug}/qwc2`, async (req, res, next) => {
    const webRoot = await resolveQwc2WebRoot();
    if (!webRoot) {
      return res.status(404).json({ error: 'qwc2_not_installed' });
    }
    return express.static(webRoot, { index: 'index.html' })(req, res, next);
  });

  // Serve QWC2 from a stable path `/Qtiler2qwc/webmap` on the main server (same origin)
  // This ensures auth cookies and sessions are shared with Qtiler (port 3000).
  app.use('/Qtiler2qwc/webmap', async (req, res, next) => {
    // Backward-compatibility shim for stale/cached themes payloads where
    // thumbnail URLs were absolute and got prefixed by /Qtiler2qwc/webmap/assets/.
    // Example broken request:
    //   /Qtiler2qwc/webmap/assets/http://localhost:3000/plugins/Qtiler2qwc/api/thumbnail/...
    const originalUrl = String(req.originalUrl || '');
    const badPrefix = '/Qtiler2qwc/webmap/assets/';
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

    resolveQwc2WebRoot().then((webRoot) => {
      if (!webRoot) return res.status(404).send('qwc2_not_installed');
      return express.static(webRoot, { index: 'index.html' })(req, res, next);
    }).catch(() => res.status(500).end());
  });

  // Expose config.json and themes.json under the same path so QWC2 requests
  // from `/Qtiler2qwc/webmap` will resolve and use the server-side access control.
  app.get('/Qtiler2qwc/webmap/config.json', async (req, res) => {
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
        config.searchServiceUrl = '/Qtiler2qwc/search';
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
        if (!webRoot) return res.status(500).json({ error: 'qwc2_config_failed' });
        const raw = await fs.promises.readFile(path.join(webRoot, 'config.json'), 'utf8');
        let base = {};
        try { base = JSON.parse(raw); } catch { base = {}; }

        // Helper sanitize: clear service endpoints and external catalog URLs
        const clearServices = () => {
          base.searchServiceUrl = '/Qtiler2qwc/search';
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
        return res.status(500).json({ error: 'qwc2_config_failed' });
      }
    }
  });

  app.get('/Qtiler2qwc/webmap/themes.json', async (req, res) => {
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
      if (webRoot) return res.sendFile(path.join(webRoot, 'themes.json'));
      res.status(500).json({ error: 'qwc2_themes_failed' });
    }
  });

  app.get(`/plugins/${pluginSlug}/api/status`, adminOnly, async (_req, res) => {
    const state = await readState();
    const installed = await hasQwc2Install();
    const branding = await getBrandingStatus();
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
      qwc2Url: installed ? `/plugins/${pluginSlug}/qwc2` : null,
      standalone: { running: false, port: null, url: null }
    });
  });

  app.get(`/plugins/${pluginSlug}/api/branding/logo`, adminOnly, async (_req, res) => {
    const branding = await getBrandingStatus();
    res.json(branding);
  });

  app.post(`/plugins/${pluginSlug}/api/branding/logo`, adminOnly, (req, res) => {
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

  app.delete(`/plugins/${pluginSlug}/api/branding/logo`, adminOnly, async (_req, res) => {
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

  // Standalone start/stop endpoints removed — QWC2 is served via /Qtiler2qwc/webmap

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
      tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'Qtiler2qwc-qwc2-'));
      const zipPath = path.join(tempDir, 'qwc2.zip');
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
        qwc2Url: `/plugins/${pluginSlug}/qwc2`
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

  app.post(`/plugins/${pluginSlug}/api/publish`, adminOnly, async (req, res) => {
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
        view3d: featuresInput.view3d === true
      };

      // Merge per-layer visibility from provided `layers` payload when available.
      const incomingVisibility = {};
      if (Array.isArray(inputLayers)) {
        for (const l of inputLayers) {
          if (l && typeof l === 'object' && l.name) incomingVisibility[String(l.name)] = !!l.visible;
        }
      }

      const layers = layerNames.map((name) => {
        const rule = layerRulesInput[name] && typeof layerRulesInput[name] === 'object' ? layerRulesInput[name] : {};
        const sourceLayer = Array.isArray(inputLayers)
          ? inputLayers.find((l) => l && typeof l === 'object' && String(l.name || '') === String(name))
          : null;
        const fallbackSearchable = sourceLayer?.searchable === true;
        const fallbackEditable = sourceLayer?.editable === true;
        const fallbackSearchAttribute = String(sourceLayer?.searchAttribute || '').trim() || null;
        const fallbackIdAttribute = String(sourceLayer?.idAttribute || '').trim() || null;
        const fallbackGeometryAttribute = String(sourceLayer?.geometryAttribute || '').trim() || null;
        const fallbackHintText = String(sourceLayer?.hintText || '').trim() || null;
        return {
          name,
          sourceProjectId: projectId,
          role: 'main',
          visible: (typeof incomingVisibility[name] === 'undefined') ? true : !!incomingVisibility[name],
          searchable: (rule.searchable === true) || fallbackSearchable,
          editable: (rule.editable === true) || fallbackEditable,
          searchAttribute: String(rule.searchAttribute || '').trim() || fallbackSearchAttribute,
          idAttribute: String(rule.idAttribute || '').trim() || fallbackIdAttribute,
          geometryAttribute: String(rule.geometryAttribute || '').trim() || fallbackGeometryAttribute,
          hintText: String(rule.hintText || '').trim() || fallbackHintText
        };
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

      const payload = {
        generatedAt: nowIso(),
        plugin: pluginSlug,
        name,
        description: description || null,
        projectId,
        backgroundProjectId: backgroundProjectId || null,
        backgrounds: backgroundSelection.backgrounds,
        defaultBackgroundKey: backgroundSelection.defaultBackgroundKey,
        features,
        toolConfig,
        layers,
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
      await syncRuntimeFilesForProfile(payload, getRequestBaseUrl(req).replace(/\/+$/,''));

      // If editing and name changed, remove old profile file
      if (existingProfileId && sanitizeFileToken(existingProfileId) !== profileKey) {
        const oldPath = publishedProfilePath(existingProfileId);
        await fs.promises.rm(oldPath, { force: true }).catch(() => {});
      }

      const state = await readState();
      const base = getRequestBaseUrl(req).replace(/\/+$/,'');
      res.json({
        status: 'published',
        name,
        projectId,
        file: targetPath,
        catalogUrl: `/plugins/${pluginSlug}/api/projects`,
        // Use same-origin webmap path for launching the map
        launchUrl: `${base}/Qtiler2qwc/webmap/?qtiler_profile=${encodeURIComponent(profileKey)}#/?t=${encodeURIComponent(projectId)}`,
        publishedConfigUrl: `${base}/plugins/${pluginSlug}/published/${encodeURIComponent(profileKey)}.json`
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
      candidates.push(path.join(process.cwd(), 'data', 'Qtiler2qwc', 'qwc2', 'current', 'themesConfig.json'));

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

  app.get(`/plugins/${pluginSlug}/api/publish/list`, adminOnly, async (req, res) => {
    try {
      const baseUrl = getRequestBaseUrl(req);
      const items = await collectPublishedProfiles(baseUrl);
      res.json({ items });
    } catch(err) { console.error('XERR', err);
      res.status(500).json({ error: 'publish_list_failed', details: String(err?.message || err) });
    }
  });

  app.delete(`/plugins/${pluginSlug}/api/publish/:profileName`, adminOnly, async (req, res) => {
    try {
      const profileName = String(req.params?.profileName || '').trim();
      if (!profileName) {
        return res.status(400).json({ error: 'name_required' });
      }
      const target = path.join(publishedRoot, `${sanitizeFileToken(profileName)}.json`);
      await fs.promises.rm(target, { force: true });
      res.json({ status: 'deleted', name: profileName });
    } catch(err) { console.error('XERR', err);
      res.status(500).json({ error: 'publish_delete_failed', details: String(err?.message || err) });
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
      res.json({ projectId, profileKey, launchUrl: `${base}/Qtiler2qwc/webmap/?qtiler_profile=${encodeURIComponent(profileKey)}#/?t=${encodeURIComponent(projectId)}` });
    } catch(err) { console.error('XERR', err);
      res.status(500).json({ error: 'publish_launch_url_failed', details: String(err?.message || err) });
    }
  });

  /* ── Thumbnail proxy: generates a WMS GetMap preview for a project (cached) ── */
  app.get(`/plugins/${pluginSlug}/api/thumbnail/:projectId`, async (req, res) => {
    try {
      const projectId = normalizeProjectId(req.params?.projectId || '');
      if (!projectId) return sendThumbnailPlaceholder(res, 'No preview');
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
      const thumbPath = await generateThumbnail(projectId, layers, baseUrl, req.headers.cookie);
      if (thumbPath) {
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
  app.get('/Qtiler2qwc/terrain/:projectId/:filename', async (req, res) => {
    try {
      const projectId = normalizeProjectId(req.params?.projectId || '');
      const filename = String(req.params?.filename || '').replace(/[/\\]/g, '');
      if (!projectId || !filename || !/\.tif$/i.test(filename)) {
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
      console.error('[Qtiler2qwc] terrain serve error:', err?.message || err);
      return res.status(500).json({ error: 'server_error' });
    }
  });

  const { spawn } = await import('child_process');
  app.get('/Qtiler2qwc/search', async (req, res) => {
    try {
      const q = req.query.searchtext || req.query.query;
      // QWC2 fulltext provider sends `filter` (comma-separated). Older callers
      // may send `map` or `dataset`. Use the first non-empty token as themeId.
      const filterRaw = req.query.filter || req.query.map || req.query.dataset || '';
      const filterStr = Array.isArray(filterRaw) ? filterRaw[0] : filterRaw;
      const themeId = String(filterStr || '').split(',').map(s => s.trim()).filter(Boolean)[0];
      if (!q || !themeId) return res.json({ results: [], result_counts: [] });

      const safeProject = sanitizeFileToken(themeId);
      if (!safeProject) return res.json({ results: [], result_counts: [] });

      const cfgPath = path.join(dataRoot, 'searchable-layers', `${safeProject}.json`);
      let layersCfg = [];
      try {
        const raw = await fs.promises.readFile(cfgPath, 'utf8');
        layersCfg = JSON.parse(raw);
      } catch(err) { console.error('XERR', err);
        return res.json({ results: [], result_counts: [] });
      }

      if (!Array.isArray(layersCfg) || layersCfg.length === 0) {
        return res.json({ results: [], result_counts: [] });
      }

      const qgisPrefix = process.env.QGIS_PREFIX || process.env.QGIS_PREFIX_PATH || '';
      // Use configured PYTHON_EXE, otherwise fallback to system python
      let pythonExe = process.env.PYTHON_EXE || (process.platform === 'win32' ? 'python' : 'python3');

      let qsPath = '';
      try {
        const availableGroups = await listProjectsFromDisk(projectsDir);
        const match = availableGroups.find(x => x.id === safeProject);
        if (match) qsPath = match.file;
      } catch (err) {}

      if (!qsPath) {
         return res.json({ results: [], result_counts: [] });
      }

      let qsScript = path.join(process.cwd(), 'python', 'search_layer.py');
      const allResults = [];

      for (const t of layersCfg) {
         const ln = t.layerId || t.name || t.id;
         if (!ln) continue;
         const dField = t.searchAttribute || t.titleField || (t.fields && t.fields[0]) || 'name';
         const fList = Array.isArray(t.fields) ? t.fields : [dField];
         const lim = req.query.limit || 50;

         const cmdArgs = [
           qsScript, qsPath, ln, JSON.stringify(fList), q, dField, String(lim)
         ];
         
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

         const p = new Promise((resolve) => {
            const child = spawn(pythonExe, cmdArgs, {
               env: makeQgisEnv()
            });
            let stdout = '', stderr = '';
            child.stdout.on('data', d => stdout += d.toString());
            child.stderr.on('data', d => stderr += d.toString());
            child.on('close', code => {
               try {
                 const hits = JSON.parse(stdout);
                 console.log('HITS from python:', hits); const mappedItems = (Array.isArray(hits) ? hits : []).map(h => {
                     // Get bounding box directly returned by Python
                     return {
                         id: `${ln}.${h.id}`,
                         text: String(h[dField] || `${ln} #${h.id}`), // what user sees in dropdown
                         bbox: h.bbox || null,
                         x: h.x,
                         y: h.y,
                         crs: h.crs || 'EPSG:3857' // Defaults to web mercator
                     };
                 }).filter(m => m.features !== null); // safety fallback

                 resolve({
                   id: ln,
                   title: ln,
                   items: mappedItems
                 });
               } catch (e) {
                 console.error('[Search plugin] Python error or parse fail for layer:', ln, '\nStderr:', stderr);
                 console.error('resolving with empty for ' + ln); resolve({ id: ln, title: ln, items: [] });
               }
            });
            child.on('error', () => resolve({ id: ln, title: ln, items: [] }));
         });
         allResults.push(p);
      }

      const completed = await Promise.all(allResults);
      // Convert internal shape to QWC2 fulltext response shape.
      // Each hit becomes { feature: { feature_id, display, bbox, srid, dataproduct_id, id_field_name } }.
      const fulltextResults = [];
      const counts = [];
      for (const grp of completed) {
        const layerId = grp.id;
        const items = Array.isArray(grp.items) ? grp.items : [];
        if (!items.length) continue;
        const layerCfg = layersCfg.find(l => (l.layerId || l.name || l.id) === layerId) || {};
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

      res.json({ results: fulltextResults, result_counts: counts });
    } catch(err) { console.error('XERR', err);
      console.error('/Qtiler2qwc/search API Error:', err);
      res.json({ results: [], result_counts: [] });
    }
  });

  await applyBrandingToQwc2Configs();
  // Standalone server disabled; no auto-start

  return {
    dispose: async () => {
      // nothing to stop
    }
  };
};
