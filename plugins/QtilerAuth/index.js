/*
 * QtilerAuth Commercial License
 * See LICENSE_QtilerAuth.txt for terms and restrictions.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const ROLE_ADMIN = 'admin';
const ROLE_AUTH = 'authenticated';
const VALID_ROLES = new Set([ROLE_ADMIN, ROLE_AUTH]);
const COOKIE_NAME = 'qtiler_token';
const DEFAULT_IDLE_TIMEOUT_SECONDS = 3600;
const DEFAULT_ADMIN_PASSWORD = process.env.QTILER_DEFAULT_ADMIN_PASSWORD || 'adminnuevo321';
const LEGACY_DEFAULT_ADMIN_PASSWORDS = ['adminnuevo123'];

const nowIso = () => new Date().toISOString();
const normalizeUsername = (value) => String(value || '').trim().toLowerCase();

const pickUserPayload = (user) => {
  if (!user) return null;
  const { passwordHash, apiKey, projects = [], ...rest } = user;
  return { ...rest, projects: Array.isArray(projects) ? projects : [] };
};

const pickAdminUserPayload = (user) => {
  const payload = pickUserPayload(user);
  if (!payload) return null;
  return { ...payload, apiKey: user?.apiKey || null };
};

const ensureArrayOfStrings = (value) => {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v || '').trim()).filter(Boolean);
};

const buildTokenPayload = (user) => ({
  sub: user.id,
  role: user.role,
  username: user.username,
  v: 1
});

const getAuthHeaderToken = (req) => {
  const header = req.get('authorization');
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }
  return null;
};

const parseBasicAuth = (req) => {
  const header = req.get('authorization');
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'basic') {
    try {
      const decoded = Buffer.from(parts[1], 'base64').toString('utf-8');
      const colonIdx = decoded.indexOf(':');
      if (colonIdx === -1) return null;
      return {
        username: decoded.substring(0, colonIdx),
        password: decoded.substring(colonIdx + 1)
      };
    } catch (err) {
      return null;
    }
  }
  return null;
};

const getApiKey = (req) => {
  try {
    const headerKey = req.get('x-api-key') || req.get('x-qtiler-key') || req.get('x-api_key');
    if (headerKey) return String(headerKey || '').trim();
  } catch {}
  try {
    const queryKey = req.query?.api_key || req.query?.apikey || req.query?.apiKey;
    if (queryKey) return String(queryKey || '').trim();
  } catch {}
  return null;
};

export const register = async ({ app, security, dataDir, baseDir, registerStore }) => {
  const usersStore = registerStore('../auth-users.json', { users: [] });
  // Store project access rules inside the plugin data directory (data/QtilerAuth/project-access.json)
  // so both the core server and the plugin read the same source of truth.
  const projectStore = registerStore('project-access.json', { projects: {} });
  const configStore = registerStore('../auth-config.json', {
    jwtSecret: null,
    tokenTtlSeconds: DEFAULT_IDLE_TIMEOUT_SECONDS,
    refreshTtlSeconds: 1209600
  });

  const configuredIdleRaw = Number(process.env.QTILER_AUTH_IDLE_TIMEOUT_SECONDS || DEFAULT_IDLE_TIMEOUT_SECONDS);
  const idleTimeoutSeconds = Number.isFinite(configuredIdleRaw) && configuredIdleRaw > 0
    ? Math.floor(configuredIdleRaw)
    : DEFAULT_IDLE_TIMEOUT_SECONDS;

  const ensureObjectSnapshot = (value, fallback) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
    return value;
  };

  const normalizeProjectAccessSnapshot = (raw) => {
    const snapshot = ensureObjectSnapshot(raw, { projects: {} });
    if (!snapshot.projects || typeof snapshot.projects !== 'object' || Array.isArray(snapshot.projects)) {
      snapshot.projects = {};
    }
    return snapshot;
  };

  const tryReadJson = async (filePath) => {
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      if (err?.code === 'ENOENT') return null;
      return null;
    }
  };

  const seedProjectAccessFromLegacy = async () => {
    // If the plugin store is empty, seed it from the newest legacy snapshot.
    try {
      const current = normalizeProjectAccessSnapshot(await projectStore.read());
      const hasEntries = current && current.projects && Object.keys(current.projects).length > 0;
      if (hasEntries) return;

      const dataRoot = path.resolve(dataDir, '..');
      const candidates = [
        path.join(dataRoot, 'project-access.json'),
        path.join(dataRoot, 'auth', 'project-access.json')
      ];

      const existing = [];
      for (const filePath of candidates) {
        try {
          const stats = await fs.promises.stat(filePath);
          const payload = await tryReadJson(filePath);
          if (!payload) continue;
          existing.push({ filePath, mtimeMs: Number(stats?.mtimeMs) || 0, payload: normalizeProjectAccessSnapshot(payload) });
        } catch {
          // ignore
        }
      }

      if (!existing.length) return;
      existing.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
      await projectStore.write(existing[0].payload);
      console.log('[QtilerAuth] Seeded project-access.json from legacy snapshot', { source: existing[0].filePath });
    } catch (err) {
      console.warn('[QtilerAuth] Failed to seed project access from legacy', err?.message || err);
    }
  };

  const ensureSecret = async () => {
    await configStore.update((draft) => {
      if (!draft || typeof draft !== 'object') {
        return { jwtSecret: crypto.randomBytes(32).toString('hex'), tokenTtlSeconds: idleTimeoutSeconds, refreshTtlSeconds: 1209600 };
      }
      if (!draft.jwtSecret) {
        draft.jwtSecret = crypto.randomBytes(32).toString('hex');
      }
      // Enforce idle timeout policy for browser login sessions.
      if (!Number.isFinite(draft.tokenTtlSeconds) || Number(draft.tokenTtlSeconds) <= 0) {
        draft.tokenTtlSeconds = idleTimeoutSeconds;
      } else {
        draft.tokenTtlSeconds = Math.min(Math.floor(Number(draft.tokenTtlSeconds)), idleTimeoutSeconds);
      }
      if (!Number.isFinite(draft.refreshTtlSeconds)) {
        draft.refreshTtlSeconds = 1209600;
      }
      return draft;
    });
  };

  const readConfig = async () => {
    const cfg = await configStore.read();
    const ttl = Number.isFinite(cfg?.tokenTtlSeconds) && Number(cfg?.tokenTtlSeconds) > 0
      ? Math.min(Math.floor(Number(cfg.tokenTtlSeconds)), idleTimeoutSeconds)
      : idleTimeoutSeconds;
    return {
      jwtSecret: cfg?.jwtSecret,
      tokenTtlSeconds: ttl
    };
  };

  const readUsers = async () => {
    const data = await usersStore.read();
    return Array.isArray(data?.users) ? data.users : [];
  };

  const saveUsers = async (nextUsers) => {
    await usersStore.write({ users: nextUsers });
  };

  const ensureDefaultAdmin = async () => {
    const users = await readUsers();
    // FIX: Check specifically for admin user, not just any user.
    // This ensures that if 'admin' was deleted or doesn't exist (even if other users do), it gets recreated.
    const adminExists = users.some((u) => normalizeUsername(u.username) === 'admin');
    if (adminExists) return;

    const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
    const adminUser = {
      id: crypto.randomUUID(),
      username: 'admin',
      role: ROLE_ADMIN,
      passwordHash,
      apiKey: crypto.randomBytes(24).toString('hex'),
      projects: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: 'active'
    };
    
    // Use update to append, preserving existing users if any
    await usersStore.update((draft) => {
      if (!Array.isArray(draft?.users)) draft.users = [];
      // Double check inside lock
      if (!draft.users.some((u) => normalizeUsername(u.username) === 'admin')) {
         draft.users.push(adminUser);
      }
      return draft;
    });
    console.warn(`QtilerAuth initialized default admin user. Username: admin Password: ${DEFAULT_ADMIN_PASSWORD} (change immediately).`);
  };

  const ensureApiKeys = async () => {
    await usersStore.update((draft) => {
      if (!Array.isArray(draft?.users)) draft.users = [];
      draft.users = draft.users.map((u) => {
        if (!u) return u;
        if (!u.apiKey) {
          return { ...u, apiKey: crypto.randomBytes(24).toString('hex'), updatedAt: nowIso() };
        }
        return u;
      });
      return draft;
    });
  };

  const migrateLegacyDefaultAdminPassword = async () => {
    // If the admin account is still using a legacy default password, upgrade it to the current DEFAULT.
    if (!DEFAULT_ADMIN_PASSWORD) return;
    const admin = await findUserByUsername('admin');
    if (!admin || !admin.passwordHash) return;
    try {
      const matchesCurrent = await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, admin.passwordHash);
      if (matchesCurrent) return;
    } catch {
      // continue
    }

    for (const legacy of LEGACY_DEFAULT_ADMIN_PASSWORDS) {
      if (!legacy || legacy === DEFAULT_ADMIN_PASSWORD) continue;
      try {
        const matchesLegacy = await bcrypt.compare(legacy, admin.passwordHash);
        if (!matchesLegacy) continue;
        const nextHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
        await updateUserRecord(admin.id, (current) => ({ ...current, passwordHash: nextHash }));
        console.warn(`QtilerAuth migrated legacy admin default password to current default. Username: admin Password: ${DEFAULT_ADMIN_PASSWORD} (change immediately).`);
        return;
      } catch {
        // ignore this legacy candidate
      }
    }
  };

  const isDefaultAdminPasswordActive = async () => {
    const admin = await findUserByUsername('admin');
    if (!admin || !admin.passwordHash) return false;
    try {
      if (await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, admin.passwordHash)) return true;
      for (const legacy of LEGACY_DEFAULT_ADMIN_PASSWORDS) {
        if (!legacy) continue;
        if (await bcrypt.compare(legacy, admin.passwordHash)) return true;
      }
      return false;
    } catch (err) {
      console.warn('Failed to compare admin default password', err);
      return false;
    }
  };


  const findUserByUsername = async (username) => {
    const users = await readUsers();
    const target = normalizeUsername(username);
    return users.find((u) => normalizeUsername(u.username) === target) || null;
  };

  const findUserByApiKey = async (apiKey) => {
    if (!apiKey) return null;
    const users = await readUsers();
    const needle = String(apiKey || '').trim();
    if (!needle) return null;
    return users.find((u) => u && u.apiKey && String(u.apiKey).trim() === needle) || null;
  };

  const findUserById = async (id) => {
    const users = await readUsers();
    return users.find((u) => u.id === id) || null;
  };

  const updateUserRecord = async (id, updater) => {
    await usersStore.update((draft) => {
      if (!Array.isArray(draft?.users)) draft.users = [];
      const idx = draft.users.findIndex((u) => u.id === id);
      if (idx === -1) return draft;
      const next = updater({ ...draft.users[idx] });
      if (next === null) {
        draft.users.splice(idx, 1);
      } else {
        draft.users[idx] = { ...draft.users[idx], ...next, updatedAt: nowIso() };
      }
      return draft;
    });
  };

  await ensureSecret();
  await seedProjectAccessFromLegacy();
  await ensureDefaultAdmin();
  await ensureApiKeys();
  await migrateLegacyDefaultAdminPassword();

  const { jwtSecret, tokenTtlSeconds } = await readConfig();

  const issueToken = (user) => {
    const payload = buildTokenPayload(user);
    return jwt.sign(payload, jwtSecret, { expiresIn: tokenTtlSeconds });
  };

  const verifyToken = (token) => {
    try {
      return jwt.verify(token, jwtSecret);
    } catch (err) {
      return null;
    }
  };

  const requireRoles = (...roles) => (req, res, next) => security.ensureRoles(req, res, next, roles);

  security.attachUser = (req, res, next) => {
    const bearer = getAuthHeaderToken(req);
    const token = bearer || req.cookies?.[COOKIE_NAME];
    
    // Debug log for troubleshooting auth issues
    if (process.env.DEBUG_AUTH === 'true' || !req.user) {
       // Only log if something interesting happens or explicitly enabled
       // console.log('[QtilerAuth] attachUser check', { hasToken: !!token, secure: req.secure, url: req.url });
    }

    if (token) {
      const decoded = verifyToken(token);
      if (decoded && decoded.sub) {
        return findUserById(decoded.sub).then((user) => {
          req.user = user ? pickUserPayload(user) : null;

          // Sliding idle timeout for browser cookie sessions.
          // If there is activity and auth came from cookie (not bearer), issue a fresh short-lived token.
          if (req.user && !bearer) {
            try {
              const renewedToken = issueToken(user);
              res.cookie(COOKIE_NAME, renewedToken, {
                httpOnly: true,
                sameSite: 'lax',
                secure: false,
                maxAge: tokenTtlSeconds * 1000
              });
            } catch (err) {
              console.warn('[QtilerAuth] Failed to refresh idle token', err?.message || err);
            }
          }
          next();
        }).catch((err) => {
          console.warn('attachUser failed', err);
          req.user = null;
          next();
        });
      } else {
         // Token invalid or expired
         // console.warn('[QtilerAuth] Invalid token', { token: token.substring(0, 10) + '...' });
      }
    }

    const apiKey = getApiKey(req);
    if (apiKey) {
      return findUserByApiKey(apiKey).then((user) => {
        if (!user || user.status === 'disabled') {
          req.user = null;
          return next();
        }
        req.user = pickUserPayload(user);
        next();
      }).catch((err) => {
        console.warn('API key auth failed', err);
        req.user = null;
        next();
      });
    }
    
    const basicCreds = parseBasicAuth(req);
    if (basicCreds) {
      return findUserByUsername(basicCreds.username).then(async (user) => {
        if (!user || user.status === 'disabled') {
          req.user = null;
          return next();
        }
        const valid = await bcrypt.compare(basicCreds.password, user.passwordHash || '');
        if (valid) {
          req.user = pickUserPayload(user);
        } else {
          req.user = null;
        }
        next();
      }).catch((err) => {
        console.warn('Basic auth failed', err);
        req.user = null;
        next();
      });
    }
    
    req.user = null;
    return next();
  };

  security.ensureRoles = (req, res, next, roles) => {
    if (!roles || roles.length === 0) return next();
    if (!req.user) {
      return res.status(401).json({ error: 'auth_required' });
    }
    if (roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'forbidden' });
  };

  security.ensureProjectAccess = async (req, res, next, projectId) => {
    if (!projectId) {
      if (req.user && req.user.role === ROLE_ADMIN) return next();
      return res.status(400).json({ error: 'project_required' });
    }
    if (req.user && req.user.role === ROLE_ADMIN) return next();
    const projectData = await projectStore.read();
    const entry = projectData?.projects?.[projectId] || null;
    if (entry?.public) return next();
    if (!req.user) {
      return res.status(401).json({ error: 'auth_required' });
    }
    if (Array.isArray(req.user.projects) && req.user.projects.includes(projectId)) {
      return next();
    }
    const userAllowed = Array.isArray(entry?.allowedUsers) && entry.allowedUsers.includes(req.user.id);
    const roleAllowed = Array.isArray(entry?.allowedRoles) && entry.allowedRoles.includes(req.user.role);
    if (userAllowed || roleAllowed) return next();
    return res.status(403).json({ error: 'forbidden' });
  };

  security.isEnabled = () => true;

  const resetSecurity = () => {
    security.attachUser = (req, _res, next) => {
      req.user = null;
      next();
    };
    security.ensureRoles = (_req, _res, next) => next();
    security.ensureProjectAccess = (_req, _res, next) => next();
    security.isEnabled = () => false;
  };

  const router = express.Router();
  router.use((req, res, next) => {
    if (typeof security.isEnabled === 'function' && !security.isEnabled()) {
      return res.status(404).json({ error: 'auth_plugin_disabled' });
    }
    return next();
  });

  router.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'missing_credentials' });
    }
    const user = await findUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    if (user.status === 'disabled') {
      return res.status(403).json({ error: 'user_disabled' });
    }
    const ok = await bcrypt.compare(password, user.passwordHash || '');
    if (!ok) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    const token = issueToken(user);
    // FIX: Force secure=false for local testing to avoid login issues on HTTP
    // In production with HTTPS, you can change this back to !!req.secure
    const cookieOpts = {
      httpOnly: true,
      sameSite: 'lax',
      secure: false, 
      maxAge: tokenTtlSeconds * 1000
    };
    res.cookie(COOKIE_NAME, token, cookieOpts);
    console.log('[QtilerAuth] Login successful', { username: user.username, secure: cookieOpts.secure });
    return res.json({ token, user: pickUserPayload(user) });
  });

  router.post('/logout', (req, res) => {
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false
    });
    return res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    if (!req.user) {
      return res.status(401).json({ error: 'auth_required' });
    }
    return res.json({ user: req.user });
  });

  app.use('/auth', router);

  const adminRouter = express.Router();
  adminRouter.use((req, res, next) => {
    if (typeof security.isEnabled === 'function' && !security.isEnabled()) {
      return res.status(404).json({ error: 'auth_plugin_disabled' });
    }
    return next();
  });
  adminRouter.use(requireRoles(ROLE_ADMIN));

  adminRouter.get('/users', async (_req, res) => {
    const users = await readUsers();
    res.json({ users: users.map(pickAdminUserPayload) });
  });

  adminRouter.get('/status', async (_req, res) => {
    try {
      const defaultPasswordActive = await isDefaultAdminPasswordActive();
      res.json({
        defaultPasswordActive,
        defaultPasswordLabel: DEFAULT_ADMIN_PASSWORD
      });
    } catch (err) {
      res.status(500).json({ error: 'status_unavailable', details: String(err?.message || err) });
    }
  });

  adminRouter.post('/users', async (req, res) => {
    const { username, password, role, projects = [], status = 'active' } = req.body || {};
    const cleanUsername = normalizeUsername(username);
    if (!cleanUsername) {
      return res.status(400).json({ error: 'username_required' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'password_too_short' });
    }
    const targetRole = VALID_ROLES.has(role) ? role : ROLE_AUTH;
    const existing = await findUserByUsername(cleanUsername);
    if (existing) {
      return res.status(409).json({ error: 'username_taken' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const now = nowIso();
    const userRecord = {
      id: crypto.randomUUID(),
      username: cleanUsername,
      passwordHash,
      role: targetRole,
      apiKey: crypto.randomBytes(24).toString('hex'),
      projects: ensureArrayOfStrings(projects),
      createdAt: now,
      updatedAt: now,
      status: status === 'disabled' ? 'disabled' : 'active'
    };
    await usersStore.update((draft) => {
      if (!Array.isArray(draft?.users)) draft.users = [];
      draft.users.push(userRecord);
      return draft;
    });
    res.status(201).json({ user: pickAdminUserPayload(userRecord) });
  });

  adminRouter.post('/users/:id/api-key', async (req, res) => {
    const { id } = req.params;
    let updatedUser = null;
    await updateUserRecord(id, (current) => {
      if (!current) return null;
      updatedUser = { ...current, apiKey: crypto.randomBytes(24).toString('hex') };
      return updatedUser;
    });
    if (!updatedUser) {
      return res.status(404).json({ error: 'user_not_found' });
    }
    res.json({ user: pickAdminUserPayload(updatedUser) });
  });

  adminRouter.patch('/users/:id', async (req, res) => {
    const { id } = req.params;
    const { password, role, projects, status } = req.body || {};
    const changes = {};
    if (role && VALID_ROLES.has(role)) {
      changes.role = role;
    }
    if (status === 'disabled' || status === 'active') {
      changes.status = status;
    }
    if (projects) {
      changes.projects = ensureArrayOfStrings(projects);
    }
    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ error: 'password_too_short' });
      }
      changes.passwordHash = await bcrypt.hash(password, 10);
    }
    let updatedUser = null;
    await updateUserRecord(id, (current) => {
      if (!current) return null;
      updatedUser = { ...current, ...changes };
      return updatedUser;
    });
    if (!updatedUser) {
      return res.status(404).json({ error: 'user_not_found' });
    }
    res.json({ user: pickUserPayload(updatedUser) });
  });

  adminRouter.delete('/users/:id', async (req, res) => {
    const { id } = req.params;
    let removed = false;
    let wasAdmin = false;
    await usersStore.update((draft) => {
      if (!Array.isArray(draft?.users)) draft.users = [];
      const idx = draft.users.findIndex((u) => u.id === id);
      if (idx !== -1) {
        const user = draft.users[idx];
        if (user.username === 'admin') {
          wasAdmin = true;
          return draft;
        }
        draft.users.splice(idx, 1);
        removed = true;
      }
      return draft;
    });
    if (wasAdmin) {
      return res.status(403).json({ error: 'cannot_delete_admin' });
    }
    if (!removed) {
      return res.status(404).json({ error: 'user_not_found' });
    }
    res.json({ ok: true });
  });

  adminRouter.get('/projects', async (_req, res) => {
    const data = await projectStore.read();
    res.json({ projects: data?.projects || {} });
  });

  adminRouter.patch('/projects/:id', async (req, res) => {
    const { id } = req.params;
    const { public: isPublic, allowedUsers, allowedRoles } = req.body || {};
    await projectStore.update((draft) => {
      if (!draft || typeof draft !== 'object') draft = { projects: {} };
      if (!draft.projects) draft.projects = {};
      const entry = draft.projects[id] || {};
      if (typeof isPublic === 'boolean') entry.public = isPublic;
      if (allowedUsers) entry.allowedUsers = ensureArrayOfStrings(allowedUsers);
      if (allowedRoles) entry.allowedRoles = ensureArrayOfStrings(allowedRoles).filter((r) => VALID_ROLES.has(r));
      draft.projects[id] = entry;
      return draft;
    });
    const data = await projectStore.read();
    res.json({ project: data?.projects?.[id] || null });
  });

  // Avoid collisions with Qtiler core admin UI under /admin.
  app.use('/auth-admin', adminRouter);

  // The core Qtiler UI already serves the auth admin UI at /plugins/auth-admin.
  // Keep /plugins/<pluginName>/admin working for the plugin manager iframe, but
  // delegate the actual UI + access control to the core route.
  const pluginSlug = (path.basename(baseDir || '') || 'QtilerAuth').replace(/[^a-z0-9-_]/gi, '') || 'QtilerAuth';
  app.get(`/plugins/${pluginSlug}/admin`, (_req, res) => res.redirect('/plugins/auth-admin'));

  return {
    roles: [ROLE_ADMIN, ROLE_AUTH],
    dispose: resetSecurity
  };
};
