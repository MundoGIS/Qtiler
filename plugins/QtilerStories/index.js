/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at
 * https://mozilla.org/MPL/2.0/
 *
 * Copyright (C) 2026 MundoGIS.
 *
 * Qtiler Stories — standalone portal/CMS plugin.
 * Builds public story pages and map galleries combining published maps from
 * Qtiler2Origo, Qtiler2Hajk and Qtiler 3D Eye. All state lives under
 * data/QtilerStories/ and is included in the standard plugin backup/restore.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { readProjectAccessFromDb, getAuthDb } from '../../lib/authDb.js';
import { getRequestBaseUrl } from '../../lib/requestBaseUrl.js';

const nowIso = () => new Date().toISOString();

const getRequestApiKey = (req) => String(req?.headers?.['x-api-key'] || req?.query?.api_key || '').trim();

const slugifyPortalToken = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '');

export const register = async ({ app, security, dataDir, registerStore }) => {
  const pluginSlug = 'QtilerStories';
  const runtimeRoot = path.join(dataDir, 'stories');
  const portalPagesPath = path.join(runtimeRoot, 'portal-pages.json');
  const brandingRoot = path.join(runtimeRoot, 'branding');
  const storyAssetsRoot = path.join(runtimeRoot, 'story-assets');

  await fs.promises.mkdir(runtimeRoot, { recursive: true });
  await fs.promises.mkdir(brandingRoot, { recursive: true });
  await fs.promises.mkdir(storyAssetsRoot, { recursive: true });

  const stateStore = registerStore('state.json', {
    logoFile: null,
    logoUpdatedAt: null
  });

  const readAuthCatalog = () => {
    if (!isAuthActive()) return { users: [], roles: [] };
    try {
      const dataRoot = path.resolve(dataDir, '..');
      const db = getAuthDb(dataRoot);
      const rows = db.prepare('SELECT username, role FROM users WHERE status = ? ORDER BY username COLLATE NOCASE').all('active');
      const users = rows.map((row) => String(row?.username || '').trim()).filter(Boolean);
      const roles = Array.from(new Set(rows.map((row) => String(row?.role || '').trim()).filter(Boolean)));
      return { users, roles };
    } catch (err) {
      console.warn('[QtilerStories] auth catalog unavailable:', err?.message || err);
      return { users: [], roles: [] };
    }
  };

  const readState = async () => {
    const state = await stateStore.read();
    return {
      logoFile: state?.logoFile || null,
      logoUpdatedAt: state?.logoUpdatedAt || null
    };
  };

  /* ── Story assets (images for rich text / cards / heroes) ── */
  const MAX_STORY_IMAGE_BYTES = 10 * 1024 * 1024;
  const ALLOWED_STORY_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

  const storyImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_STORY_IMAGE_BYTES },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(String(file?.originalname || '')).toLowerCase();
      if (!ALLOWED_STORY_IMAGE_EXTENSIONS.has(ext)) {
        return cb(new Error('invalid_story_image_extension'));
      }
      cb(null, true);
    }
  });

  /* ── Auth helpers ─────────────────────────────────────────────────────── */
  const isAuthActive = () => (typeof security?.isEnabled === 'function' ? security.isEnabled() : false);

  const adminOnly = (req, res, next) => {
    if (!isAuthActive()) return next();
    if (!req.user) return res.status(401).json({ error: 'auth_required' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    return next();
  };

  const portalEditorOnly = (req, res, next) => {
    if (!isAuthActive()) return next();
    if (!req.user) return res.status(401).json({ error: 'auth_required' });
    const canEdit = typeof security?.canEditPortal === 'function'
      ? security.canEditPortal(req.user, pluginSlug)
      : req.user.role === 'admin';
    if (canEdit) return next();
    return res.status(403).json({ error: 'forbidden' });
  };

  const readAccessSnapshot = () => {
    const dataRoot = path.resolve(dataDir, '..');
    try {
      return readProjectAccessFromDb(dataRoot);
    } catch {
      return { projects: {} };
    }
  };

  const userCanAccessProject = (req, projectId) => {
    if (!projectId) return false;
    if (!isAuthActive()) return true;
    const user = req.user;
    if (user?.role === 'admin') return true;
    const snapshot = readAccessSnapshot();
    const entry = snapshot?.projects?.[projectId] || null;
    if (!user) return entry?.public === true;
    const userProjects = Array.isArray(user.projects) ? user.projects : [];
    const allowedUsers = Array.isArray(entry?.allowedUsers) ? entry.allowedUsers : [];
    const allowedRoles = Array.isArray(entry?.allowedRoles) ? entry.allowedRoles : [];
    return entry?.public === true || userProjects.includes(projectId) || allowedUsers.includes(user.id) || allowedRoles.includes(user.role);
  };

  /* ── Portal state normalisation ───────────────────────────────────────── */
  const normalizePortalGdprSettings = (value) => {
    const source = value && typeof value === 'object' ? value : {};
    return {
      enabled: source.enabled === true,
      companyName: String(source.companyName || '').trim(),
      privacyUrl: String(source.privacyUrl || '').trim(),
      cookiePolicyUrl: String(source.cookiePolicyUrl || '').trim(),
      contactUrl: String(source.contactUrl || '').trim(),
      bannerTitle: String(source.bannerTitle || '').trim(),
      bannerText: String(source.bannerText || '').trim(),
      acceptLabel: String(source.acceptLabel || '').trim(),
      rejectLabel: String(source.rejectLabel || '').trim(),
      manageLabel: String(source.manageLabel || '').trim()
    };
  };

  const normalizePortalAudience = (value, { allowInherit = false } = {}) => {
    const source = value && typeof value === 'object' ? value : {};
    const access = String(source.access || '').trim().toLowerCase();
    const validAccess = ['public', 'authenticated', 'restricted'];
    if (allowInherit && access === 'inherit') return { access: 'inherit', users: [], roles: [] };
    return {
      access: validAccess.includes(access) ? access : 'public',
      users: Array.isArray(source.users) ? source.users.map((v) => String(v || '').trim()).filter(Boolean) : [],
      roles: Array.isArray(source.roles) ? source.roles.map((v) => String(v || '').trim()).filter(Boolean) : []
    };
  };

  const normalizePortalCardItems = (value) => {
    if (!Array.isArray(value)) return [];
    return value.map((source, index) => {
      const src = source && typeof source === 'object' ? source : {};
      const title = String(src.title || '').trim();
      const text = String(src.text || '').trim();
      const url = String(src.url || '').trim();
      const label = String(src.label || '').trim();
      const icon = String(src.icon || '').trim();
      const meta = String(src.meta || '').trim();
      const imageUrl = String(src.imageUrl || '').trim();
      if (!title && !text && !url && !label && !meta && !imageUrl) return null;
      return {
        id: slugifyPortalToken(src.id || `${title || 'item'}-${index + 1}`) || `item_${index + 1}`,
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
    const blockType = ['hero', 'text', 'maps', 'cards', 'social'].includes(String(source.type || '')) ? String(source.type) : 'text';
    const id = slugifyPortalToken(source.id || `${blockType}-${index + 1}`) || `${blockType}_${index + 1}`;
    return {
      id,
      type: blockType,
      title: String(source.title || '').trim(),
      eyebrow: String(source.eyebrow || '').trim(),
      subtitle: String(source.subtitle || '').trim(),
      body: String(source.body || '').trim(),
      intro: String(source.intro || '').trim(),
      backgroundUrl: String(source.backgroundUrl || '').trim(),
      ctaLabel: String(source.ctaLabel || '').trim(),
      ctaUrl: String(source.ctaUrl || '').trim(),
      layout: String(source.layout || '').trim(),
      displayMode: String(source.displayMode || '').trim(),
      profileKeys: Array.isArray(source.profileKeys) ? source.profileKeys.map((v) => String(v || '').trim()).filter(Boolean) : [],
      items: normalizePortalCardItems(source.items),
      visibility: normalizePortalAudience(source.visibility, { allowInherit: true })
    };
  };

  const normalizePortalPage = (value, index = 0) => {
    const source = value && typeof value === 'object' ? value : {};
    const title = String(source.title || '').trim();
    const slug = slugifyPortalToken(source.slug || source.id || title);
    if (!slug && !title) return null;
    return {
      id: slugifyPortalToken(source.id || slug) || slug,
      slug: slug || `page-${index + 1}`,
      title: title || slug || `Page ${index + 1}`,
      navLabel: String(source.navLabel || '').trim(),
      summary: String(source.summary || '').trim(),
      showInNav: source.showInNav !== false,
      showHeader: source.showHeader !== false,
      headerLogoUrl: String(source.headerLogoUrl || '').trim(),
      headerHeight: Number.isFinite(Number(source.headerHeight)) ? Number(source.headerHeight) : 120,
      visibility: normalizePortalAudience(source.visibility),
      blocks: (Array.isArray(source.blocks) ? source.blocks : []).map((block, blockIndex) => normalizePortalBlock(block, blockIndex)).filter(Boolean)
    };
  };

  const normalizePortalPagesState = (value) => {
    const source = value && typeof value === 'object' ? value : {};
    const pages = (Array.isArray(source.pages) ? source.pages : []).map((page, index) => normalizePortalPage(page, index)).filter(Boolean);
    const homePageSlug = slugifyPortalToken(source.homePageSlug || '');
    return {
      homePageSlug: homePageSlug || (pages[0]?.slug || ''),
      site: source.site && typeof source.site === 'object' ? source.site : {},
      gdpr: normalizePortalGdprSettings(source.gdpr),
      pages
    };
  };

  const readPortalPagesState = async () => {
    try {
      const raw = await fs.promises.readFile(portalPagesPath, 'utf8');
      return normalizePortalPagesState(JSON.parse(raw || '{}'));
    } catch {
      return normalizePortalPagesState({});
    }
  };

  const writePortalPagesState = async (value) => {
    const normalized = normalizePortalPagesState(value);
    await fs.promises.mkdir(path.dirname(portalPagesPath), { recursive: true });
    await fs.promises.writeFile(portalPagesPath, JSON.stringify(normalized, null, 2), 'utf8');
    return normalized;
  };

  const userMatchesPortalAudience = (audience, user) => {
    const scope = normalizePortalAudience(audience);
    if (scope.access === 'public') return true;
    if (!user) return false;
    if (scope.access === 'authenticated') return true;
    if (scope.access === 'restricted') {
      const userId = String(user.id || user.username || '').trim();
      const role = String(user.role || '').trim();
      return scope.users.includes(userId) || scope.roles.includes(role);
    }
    return false;
  };

  const filterPortalBlocksByAudience = (blocks, user) => (Array.isArray(blocks) ? blocks : [])
    .filter((block) => {
      const scope = normalizePortalAudience(block?.visibility, { allowInherit: true });
      if (scope.access === 'inherit') return true;
      return userMatchesPortalAudience(scope, user);
    });

  const buildPortalPageUrl = (slug) => `/QtilerStories/portal/${encodeURIComponent(String(slug || '').trim())}`;

  /* ── Story assets routes (must come after portalEditorOnly is defined) ── */
  app.use(`/plugins/${pluginSlug}/story-assets`, express.static(storyAssetsRoot, {
    fallthrough: false,
    immutable: true,
    maxAge: '7d',
    index: false
  }));

  app.get(`/plugins/${pluginSlug}/api/story-assets`, portalEditorOnly, async (_req, res) => {
    try {
      const files = await fs.promises.readdir(storyAssetsRoot, { withFileTypes: true });
      const items = [];
      for (const f of files) {
        if (!f.isFile()) continue;
        const ext = path.extname(f.name).toLowerCase();
        if (!ALLOWED_STORY_IMAGE_EXTENSIONS.has(ext)) continue;
        try {
          const stat = await fs.promises.stat(path.join(storyAssetsRoot, f.name));
          items.push({
            fileName: f.name,
            url: `/plugins/${pluginSlug}/story-assets/${encodeURIComponent(f.name)}`,
            size: stat.size,
            mtime: stat.mtime.toISOString()
          });
        } catch { /* ignore */ }
      }
      items.sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''));
      res.json({ items });
    } catch (err) {
      res.status(500).json({ error: 'story_assets_list_failed', details: String(err?.message || err) });
    }
  });

  app.post(`/plugins/${pluginSlug}/api/story-assets/image`, portalEditorOnly, (req, res) => {
    storyImageUpload.single('image')(req, res, async (err) => {
      if (err) {
        const msg = String(err?.message || err || 'story_image_upload_failed');
        if (msg.includes('File too large') || err?.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'story_image_too_large', details: `max_bytes_${MAX_STORY_IMAGE_BYTES}` });
        }
        if (msg.includes('invalid_story_image_extension')) {
          return res.status(400).json({ error: 'invalid_story_image_extension' });
        }
        return res.status(400).json({ error: 'story_image_upload_failed', details: msg });
      }
      try {
        const uploaded = req.file;
        if (!uploaded || !uploaded.buffer || !uploaded.originalname) {
          return res.status(400).json({ error: 'story_image_required' });
        }
        const ext = path.extname(String(uploaded.originalname || '')).toLowerCase();
        if (!ALLOWED_STORY_IMAGE_EXTENSIONS.has(ext)) {
          return res.status(400).json({ error: 'invalid_story_image_extension' });
        }
        const stem = path.basename(String(uploaded.originalname || 'image'), ext).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'image';
        const fileName = `${Date.now()}-${stem}${ext}`;
        const targetPath = path.join(storyAssetsRoot, fileName);
        await fs.promises.mkdir(storyAssetsRoot, { recursive: true });
        await fs.promises.writeFile(targetPath, uploaded.buffer);
        const url = `/plugins/${pluginSlug}/story-assets/${encodeURIComponent(fileName)}`;
        return res.status(201).json({ status: 'uploaded', url });
      } catch (uploadErr) {
        return res.status(500).json({ error: 'story_image_upload_failed', details: String(uploadErr?.message || uploadErr) });
      }
    });
  });

  /* ── Branding ─────────────────────────────────────────────────────────── */
  const getLogoPublicUrl = async () => {
    const state = await readState();
    if (!state.logoFile) return '';
    const fullPath = path.join(brandingRoot, state.logoFile);
    try {
      const stat = await fs.promises.stat(fullPath);
      if (!stat.isFile()) return '';
      return `/plugins/${pluginSlug}/public/branding/logo?v=${encodeURIComponent(String(stat.mtimeMs))}`;
    } catch {
      return '';
    }
  };

  app.get([`/plugins/${pluginSlug}/public/branding/logo`], async (req, res, next) => {
    try {
      const state = await readState();
      if (!state.logoFile) return next();
      const fullPath = path.join(brandingRoot, state.logoFile);
      await fs.promises.access(fullPath, fs.constants.R_OK);
      res.set('Cache-Control', 'public, max-age=300');
      return res.sendFile(fullPath);
    } catch {
      return next();
    }
  });

  /* ── Map sources: aggregate published maps from all viewer plugins ─────── */
  const VIEWER_SOURCES = [
    { key: 'origo', label: 'Origo', listUrl: '/plugins/Qtiler2Origo/api/public-maps' },
    { key: 'hajk', label: 'Hajk', listUrl: '/plugins/Qtiler2Hajk/api/public-maps' },
    { key: '3d', label: '3D Eye', listUrl: null } // read from disk (maps.json)
  ];

  const read3dEyeMaps = async (req) => {
    // Qtiler-3D-eye stores scenes in data/Qtiler-3D-eye/maps.json
    const candidates = [
      path.resolve(process.cwd(), 'data', 'Qtiler-3D-eye', 'maps.json'),
      path.resolve(dataDir, '..', 'Qtiler-3D-eye', 'maps.json')
    ];
    for (const candidate of candidates) {
      try {
        const raw = await fs.promises.readFile(candidate, 'utf8');
        const scenes = JSON.parse(raw || '[]');
        if (!Array.isArray(scenes)) continue;
        const baseUrl = getRequestBaseUrl(req);
        return scenes
          .filter((scene) => scene && scene.id && userCanAccessProject(req, scene.mainProjectId))
          .map((scene) => ({
            profileKey: String(scene.id),
            projectId: String(scene.mainProjectId || ''),
            name: String(scene.title || scene.id),
            description: String(scene.description || ''),
            generatedAt: scene.updatedAt || scene.createdAt || null,
            thumbnailUrl: '',
            launchUrl: `${baseUrl}/plugins/Qtiler-3D-eye/view/?scene=${encodeURIComponent(scene.id)}`,
            source: '3d'
          }));
      } catch { /* try next candidate */ }
    }
    return [];
  };

  const fetchViewerMaps = async (req, sourceDef) => {
    if (!sourceDef.listUrl) return [];
    try {
      const baseUrl = getRequestBaseUrl(req);
      const headers = {};
      if (req.headers?.cookie) headers.cookie = req.headers.cookie;
      const apiKey = req.headers?.['x-api-key'] || req.query?.api_key;
      if (apiKey) headers['x-api-key'] = apiKey;
      if (req.get?.('authorization')) headers.authorization = req.get('authorization');
      const response = await fetch(`${baseUrl}${sourceDef.listUrl}`, { headers });
      if (!response.ok) return [];
      const payload = await response.json().catch(() => null);
      const items = Array.isArray(payload?.items) ? payload.items : [];
      return items.map((item) => ({ ...item, source: sourceDef.key }));
    } catch {
      return [];
    }
  };

  const collectAllMaps = async (req) => {
    const [origoMaps, hajkMaps, threeDMaps] = await Promise.all([
      fetchViewerMaps(req, VIEWER_SOURCES[0]),
      fetchViewerMaps(req, VIEWER_SOURCES[1]),
      read3dEyeMaps(req)
    ]);
    return [...origoMaps, ...hajkMaps, ...threeDMaps];
  };

  /* ── Admin API ────────────────────────────────────────────────────────── */
  app.get(`/plugins/${pluginSlug}/api/status`, portalEditorOnly, async (_req, res) => {
    const state = await readState();
    const portalState = await readPortalPagesState();
    res.json({
      plugin: pluginSlug,
      installed: true,
      pages: portalState.pages.length,
      logoFile: state.logoFile,
      logoUpdatedAt: state.logoUpdatedAt,
      authActive: isAuthActive(),
      authCatalog: readAuthCatalog()
    });
  });

  // Aggregated maps catalog for the admin picker (all sources).
  app.get(`/plugins/${pluginSlug}/api/maps`, portalEditorOnly, async (req, res) => {
    try {
      const items = await collectAllMaps(req);
      res.json({ items });
    } catch (err) {
      res.status(500).json({ error: 'maps_failed', details: String(err?.message || err) });
    }
  });

  // Portal pages CRUD
  app.get(`/plugins/${pluginSlug}/api/portal-pages`, portalEditorOnly, async (_req, res) => {
    try {
      const state = await readPortalPagesState();
      res.json(state);
    } catch (err) {
      res.status(500).json({ error: 'portal_pages_read_failed', details: String(err?.message || err) });
    }
  });

  app.post(`/plugins/${pluginSlug}/api/portal-pages`, portalEditorOnly, express.json({ limit: '50mb' }), async (req, res) => {
    try {
      const normalized = await writePortalPagesState(req.body || {});
      res.json({ status: 'saved', pages: normalized.pages.length });
    } catch (err) {
      res.status(500).json({ error: 'portal_pages_save_failed', details: String(err?.message || err) });
    }
  });

  // Backup: export portal config + referenced maps (from all sources).
  app.post(`/plugins/${pluginSlug}/api/portal-backup/export`, portalEditorOnly, express.json({ limit: '10mb' }), async (req, res) => {
    try {
      const state = await readPortalPagesState();
      const pageIds = Array.isArray(req.body?.pageIds) ? req.body.pageIds : [];
      const mapKeys = Array.isArray(req.body?.mapKeys) ? req.body.mapKeys : [];
      const filteredPages = pageIds.length
        ? state.pages.filter((p) => pageIds.includes(p.id) || pageIds.includes(p.slug))
        : state.pages;
      const allMaps = await collectAllMaps(req);
      const filteredMaps = mapKeys.length
        ? allMaps.filter((m) => mapKeys.includes(m.profileKey) || mapKeys.includes(m.projectId))
        : allMaps;
      res.json({
        plugin: pluginSlug,
        exportedAt: nowIso(),
        portal: { ...state, pages: filteredPages },
        maps: filteredMaps
      });
    } catch (err) {
      res.status(500).json({ error: 'portal_backup_export_failed', details: String(err?.message || err) });
    }
  });

  // Backup: import portal config.
  app.post(`/plugins/${pluginSlug}/api/portal-backup/import`, portalEditorOnly, express.json({ limit: '100mb' }), async (req, res) => {
    try {
      const backup = req.body?.backup && typeof req.body.backup === 'object' ? req.body.backup : req.body;
      const importedPortal = backup?.portal && typeof backup.portal === 'object' ? backup.portal : backup;
      if (!importedPortal || typeof importedPortal !== 'object') {
        return res.status(400).json({ error: 'invalid_backup' });
      }
      const replacePortal = req.body?.replacePortal !== false;
      const current = await readPortalPagesState();
      let nextState;
      if (replacePortal) {
        nextState = normalizePortalPagesState(importedPortal);
      } else {
        const merged = new Map();
        for (const page of current.pages) merged.set(page.slug, page);
        for (const page of (Array.isArray(importedPortal.pages) ? importedPortal.pages : [])) {
          const norm = normalizePortalPage(page, merged.size);
          if (norm) merged.set(norm.slug, norm);
        }
        nextState = normalizePortalPagesState({
          ...current,
          gdpr: importedPortal.gdpr || current.gdpr,
          site: { ...(current.site || {}), ...(importedPortal.site || {}) },
          homePageSlug: importedPortal.homePageSlug || current.homePageSlug,
          pages: Array.from(merged.values())
        });
      }
      await writePortalPagesState(nextState);
      res.json({ status: 'imported', pages: nextState.pages.length });
    } catch (err) {
      res.status(500).json({ error: 'portal_backup_import_failed', details: String(err?.message || err) });
    }
  });

  /* ── Public API ───────────────────────────────────────────────────────── */
  // Public maps catalog (aggregated, access-filtered).
  app.get(`/plugins/${pluginSlug}/api/public-maps`, async (req, res) => {
    try {
      const state = await readPortalPagesState();
      const items = await collectAllMaps(req);
      let logoUrl = null;
      try { logoUrl = await getLogoPublicUrl(); } catch { logoUrl = null; }
      if (!logoUrl) logoUrl = '/css/images/Qtiler.png';
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json({
        authActive: isAuthActive(),
        user: req.user ? { id: req.user.id, username: req.user.username || req.user.id, role: req.user.role || null } : null,
        logoUrl,
        gdpr: state.gdpr,
        site: state.site || {},
        items
      });
    } catch (err) {
      res.status(500).json({ error: 'public_maps_failed', details: String(err?.message || err) });
    }
  });

  // Portal content: rendered page data for the public portal.
  app.get(`/plugins/${pluginSlug}/api/portal-content`, async (req, res) => {
    try {
      const state = await readPortalPagesState();
      const authActive = isAuthActive();
      const allMaps = await collectAllMaps(req);
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

      // Warn when a public page references maps the visitor can't access —
      // the map would silently be missing from cards/galleries otherwise.
      const warnings = [];
      if (currentPage && !req.user) {
        const inaccessible = allMaps
          .filter((m) => {
            const pid = String(m.projectId || '').trim();
            return pid && !userCanAccessProject(req, pid);
          })
          .map((m) => m.name || m.profileKey)
          .filter(Boolean);
        if (inaccessible.length) {
          warnings.push({
            code: 'maps_not_public',
            message: `${inaccessible.length} map(s) on this page are not accessible to anonymous visitors: ${inaccessible.slice(0, 5).join(', ')}${inaccessible.length > 5 ? '…' : ''}`
          });
        }
      }

      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json({
        authActive,
        user: req.user ? { id: req.user.id, username: req.user.username || req.user.id, role: req.user.role || null } : null,
        logoUrl,
        items: allMaps,
        gdpr: state.gdpr,
        site: state.site || { title: '', subtitle: '', footerLink: '', footerText: '' },
        warnings,
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
      res.status(500).json({ error: 'portal_content_failed', details: String(err?.message || err) });
    }
  });

  /* ── Static / page routes ─────────────────────────────────────────────── */
  app.use(`/plugins/${pluginSlug}/admin-ui`, (req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
  }, express.static(path.join(process.cwd(), 'plugins', pluginSlug, 'admin-ui')));

  app.get(`/plugins/${pluginSlug}/admin`, (_req, res) => {
    res.redirect(`/plugins/${pluginSlug}/admin-ui/`);
  });

  // Public portal pages.
  app.get('/QtilerStories/maps', (_req, res) => {
    res.sendFile(path.resolve(process.cwd(), 'plugins', pluginSlug, 'admin-ui', 'maps.html'));
  });
  app.get('/QtilerStories/portal', (_req, res) => {
    res.sendFile(path.resolve(process.cwd(), 'plugins', pluginSlug, 'admin-ui', 'maps.html'));
  });
  app.get('/QtilerStories/portal/:slug', (_req, res) => {
    res.sendFile(path.resolve(process.cwd(), 'plugins', pluginSlug, 'admin-ui', 'maps.html'));
  });

  return {
    dispose: async () => { /* nothing to stop */ }
  };
};
