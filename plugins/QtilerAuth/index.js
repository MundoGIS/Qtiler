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
import { getAuthDb, closeAuthDb, readProjectAccessFromDb } from '../../lib/authDb.js';

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

// Like pickUserPayload but includes the user's own apiKey (for /auth/me and /auth/login)
const pickSelfPayload = (user) => {
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

/* ------------------------------------------------------------------ */
/*  SQLite row ↔ JS object helper                                     */
/* ------------------------------------------------------------------ */
const rowToUser = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    apiKey: row.api_key,
    projects: JSON.parse(row.projects || '[]'),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

export const register = async ({ app, security, dataDir, baseDir }) => {
  /* ---------------------------------------------------------------- */
  /*  Database initialization                                          */
  /* ---------------------------------------------------------------- */
  const dataRoot = path.resolve(dataDir, '..');
  const db = getAuthDb(dataRoot);

  /* ---------------------------------------------------------------- */
  /*  Auto-migrate from JSON files (one-time, on first startup)        */
  /* ---------------------------------------------------------------- */
  const migrateFromJson = () => {
    const userCount = db.prepare('SELECT COUNT(*) AS cnt FROM users').get().cnt;
    if (userCount > 0) return; // Already has data, skip migration

    // --- Users ---
    const usersJsonPath = path.join(dataRoot, 'auth-users.json');
    try {
      if (fs.existsSync(usersJsonPath)) {
        const raw = JSON.parse(fs.readFileSync(usersJsonPath, 'utf8'));
        const users = Array.isArray(raw?.users) ? raw.users : [];
        const insert = db.prepare(`
          INSERT OR IGNORE INTO users (id, username, password_hash, role, api_key, projects, status, created_at, updated_at)
          VALUES (@id, @username, @password_hash, @role, @api_key, @projects, @status, @created_at, @updated_at)
        `);
        db.transaction(() => {
          for (const u of users) {
            insert.run({
              id: u.id || crypto.randomUUID(),
              username: normalizeUsername(u.username),
              password_hash: u.passwordHash || '',
              role: VALID_ROLES.has(u.role) ? u.role : ROLE_AUTH,
              api_key: u.apiKey || null,
              projects: JSON.stringify(Array.isArray(u.projects) ? u.projects : []),
              status: u.status === 'disabled' ? 'disabled' : 'active',
              created_at: u.createdAt || nowIso(),
              updated_at: u.updatedAt || nowIso()
            });
          }
        })();
        fs.renameSync(usersJsonPath, usersJsonPath + '.bak');
        console.log(`[QtilerAuth] Migrated ${users.length} users from JSON → SQLite`);
      }
    } catch (err) {
      console.warn('[QtilerAuth] Failed to migrate users from JSON', err?.message || err);
    }

    // --- Config ---
    const configJsonPath = path.join(dataRoot, 'auth-config.json');
    try {
      if (fs.existsSync(configJsonPath)) {
        const cfg = JSON.parse(fs.readFileSync(configJsonPath, 'utf8'));
        const upsert = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
        db.transaction(() => {
          if (cfg?.jwtSecret) upsert.run('jwtSecret', cfg.jwtSecret);
          if (cfg?.tokenTtlSeconds) upsert.run('tokenTtlSeconds', String(cfg.tokenTtlSeconds));
          if (cfg?.refreshTtlSeconds) upsert.run('refreshTtlSeconds', String(cfg.refreshTtlSeconds));
        })();
        fs.renameSync(configJsonPath, configJsonPath + '.bak');
        console.log('[QtilerAuth] Migrated config from JSON → SQLite');
      }
    } catch (err) {
      console.warn('[QtilerAuth] Failed to migrate config from JSON', err?.message || err);
    }

    // --- Project access ---
    const projectJsonPaths = [
      path.join(dataDir, 'project-access.json'),
      path.join(dataRoot, 'project-access.json'),
      path.join(dataRoot, 'auth', 'project-access.json')
    ];
    for (const pPath of projectJsonPaths) {
      try {
        if (!fs.existsSync(pPath)) continue;
        const raw = JSON.parse(fs.readFileSync(pPath, 'utf8'));
        const projs = raw?.projects;
        if (!projs || typeof projs !== 'object') continue;
        const upsert = db.prepare(`
          INSERT OR REPLACE INTO projects (project_id, is_public, allowed_users, allowed_roles)
          VALUES (?, ?, ?, ?)
        `);
        db.transaction(() => {
          for (const [pid, entry] of Object.entries(projs)) {
            upsert.run(
              pid,
              entry?.public ? 1 : 0,
              JSON.stringify(ensureArrayOfStrings(entry?.allowedUsers)),
              JSON.stringify(ensureArrayOfStrings(entry?.allowedRoles))
            );
          }
        })();
        try { fs.renameSync(pPath, pPath + '.bak'); } catch {}
        console.log(`[QtilerAuth] Migrated project access from ${pPath} → SQLite`);
        break; // Only migrate from first found
      } catch (err) {
        console.warn('[QtilerAuth] Failed to migrate project access from', pPath, err?.message || err);
      }
    }
  };
  migrateFromJson();

  /* ---------------------------------------------------------------- */
  /*  Prepared statements                                              */
  /* ---------------------------------------------------------------- */
  const stmts = {
    getAllUsers: db.prepare('SELECT * FROM users'),
    getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
    getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),
    getUserByApiKey: db.prepare('SELECT * FROM users WHERE api_key = ?'),
    insertUser: db.prepare(`
      INSERT INTO users (id, username, password_hash, role, api_key, projects, status, created_at, updated_at)
      VALUES (@id, @username, @password_hash, @role, @api_key, @projects, @status, @created_at, @updated_at)
    `),
    updateUser: db.prepare(`
      UPDATE users SET username = @username, password_hash = @password_hash, role = @role,
        api_key = @api_key, projects = @projects, status = @status, updated_at = @updated_at
      WHERE id = @id
    `),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ? AND username != ?'),
    getConfig: db.prepare('SELECT key, value FROM config'),
    upsertConfig: db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)'),
    getProject: db.prepare('SELECT * FROM projects WHERE project_id = ?'),
    upsertProject: db.prepare(`
      INSERT OR REPLACE INTO projects (project_id, is_public, allowed_users, allowed_roles)
      VALUES (@project_id, @is_public, @allowed_users, @allowed_roles)
    `)
  };

  /* ---------------------------------------------------------------- */
  /*  Configuration                                                    */
  /* ---------------------------------------------------------------- */
  const configuredIdleRaw = Number(process.env.QTILER_AUTH_IDLE_TIMEOUT_SECONDS || DEFAULT_IDLE_TIMEOUT_SECONDS);
  const idleTimeoutSeconds = Number.isFinite(configuredIdleRaw) && configuredIdleRaw > 0
    ? Math.floor(configuredIdleRaw)
    : DEFAULT_IDLE_TIMEOUT_SECONDS;

  /* ---------------------------------------------------------------- */
  /*  Data-access helpers                                              */
  /* ---------------------------------------------------------------- */
  const readUsers = () => stmts.getAllUsers.all().map(rowToUser);

  const findUserByUsername = (username) => {
    const target = normalizeUsername(username);
    return rowToUser(stmts.getUserByUsername.get(target));
  };

  const findUserByApiKey = (apiKey) => {
    if (!apiKey) return null;
    const needle = String(apiKey || '').trim();
    if (!needle) return null;
    return rowToUser(stmts.getUserByApiKey.get(needle));
  };

  const findUserById = (id) => rowToUser(stmts.getUserById.get(id));

  const insertUser = (user) => {
    stmts.insertUser.run({
      id: user.id,
      username: normalizeUsername(user.username),
      password_hash: user.passwordHash,
      role: user.role,
      api_key: user.apiKey || null,
      projects: JSON.stringify(Array.isArray(user.projects) ? user.projects : []),
      status: user.status || 'active',
      created_at: user.createdAt || nowIso(),
      updated_at: user.updatedAt || nowIso()
    });
  };

  const updateUserFields = (id, changes) => {
    const current = stmts.getUserById.get(id);
    if (!current) return null;
    const merged = {
      id,
      username: changes.username !== undefined ? normalizeUsername(changes.username) : current.username,
      password_hash: changes.passwordHash !== undefined ? changes.passwordHash : current.password_hash,
      role: changes.role !== undefined ? changes.role : current.role,
      api_key: changes.apiKey !== undefined ? changes.apiKey : current.api_key,
      projects: changes.projects !== undefined ? JSON.stringify(changes.projects) : current.projects,
      status: changes.status !== undefined ? changes.status : current.status,
      updated_at: nowIso()
    };
    stmts.updateUser.run(merged);
    return rowToUser(stmts.getUserById.get(id));
  };

  const updateUserRecord = (id, updater) => {
    const current = findUserById(id);
    if (!current) return;
    const next = updater({ ...current });
    if (next === null) {
      stmts.deleteUser.run(id, 'admin');
    } else {
      updateUserFields(id, next);
    }
  };

  /* ---------------------------------------------------------------- */
  /*  Config helpers                                                   */
  /* ---------------------------------------------------------------- */
  const readConfigMap = () => {
    const rows = stmts.getConfig.all();
    const map = {};
    for (const r of rows) map[r.key] = r.value;
    return map;
  };

  const ensureSecret = () => {
    const cfg = readConfigMap();
    if (!cfg.jwtSecret) {
      stmts.upsertConfig.run('jwtSecret', crypto.randomBytes(32).toString('hex'));
    }
    const currentTtl = Number(cfg.tokenTtlSeconds);
    if (!Number.isFinite(currentTtl) || currentTtl <= 0) {
      stmts.upsertConfig.run('tokenTtlSeconds', String(idleTimeoutSeconds));
    } else {
      const clamped = Math.min(Math.floor(currentTtl), idleTimeoutSeconds);
      stmts.upsertConfig.run('tokenTtlSeconds', String(clamped));
    }
    if (!cfg.refreshTtlSeconds) {
      stmts.upsertConfig.run('refreshTtlSeconds', '1209600');
    }
  };

  const readConfig = () => {
    const cfg = readConfigMap();
    const ttl = Number(cfg.tokenTtlSeconds);
    return {
      jwtSecret: cfg.jwtSecret,
      tokenTtlSeconds: Number.isFinite(ttl) && ttl > 0
        ? Math.min(Math.floor(ttl), idleTimeoutSeconds)
        : idleTimeoutSeconds
    };
  };

  /* ---------------------------------------------------------------- */
  /*  Project access helpers                                           */
  /* ---------------------------------------------------------------- */
  const getProjectAccess = (projectId) => {
    const row = stmts.getProject.get(projectId);
    if (!row) return null;
    return {
      public: !!row.is_public,
      allowedUsers: JSON.parse(row.allowed_users || '[]'),
      allowedRoles: JSON.parse(row.allowed_roles || '[]')
    };
  };

  const upsertProjectAccess = (projectId, entry) => {
    const current = getProjectAccess(projectId) || { public: false, allowedUsers: [], allowedRoles: [] };
    stmts.upsertProject.run({
      project_id: projectId,
      is_public: (entry.public !== undefined ? entry.public : current.public) ? 1 : 0,
      allowed_users: JSON.stringify(ensureArrayOfStrings(entry.allowedUsers !== undefined ? entry.allowedUsers : current.allowedUsers)),
      allowed_roles: JSON.stringify(ensureArrayOfStrings(entry.allowedRoles !== undefined ? entry.allowedRoles : current.allowedRoles).filter((r) => VALID_ROLES.has(r)))
    });
  };

  /* ---------------------------------------------------------------- */
  /*  Startup initialization                                           */
  /* ---------------------------------------------------------------- */
  ensureSecret();

  // Ensure default admin
  if (!findUserByUsername('admin')) {
    const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
    insertUser({
      id: crypto.randomUUID(),
      username: 'admin',
      role: ROLE_ADMIN,
      passwordHash,
      apiKey: crypto.randomBytes(24).toString('hex'),
      projects: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: 'active'
    });
    console.warn(`QtilerAuth initialized default admin user. Username: admin Password: ${DEFAULT_ADMIN_PASSWORD} (change immediately).`);
  }

  // Backfill API keys for any users missing them
  for (const u of readUsers()) {
    if (!u.apiKey) {
      updateUserFields(u.id, { apiKey: crypto.randomBytes(24).toString('hex') });
    }
  }

  // Migrate legacy default admin password
  const migrateLegacyDefaultAdminPassword = async () => {
    if (!DEFAULT_ADMIN_PASSWORD) return;
    const admin = findUserByUsername('admin');
    if (!admin || !admin.passwordHash) return;
    try {
      const matchesCurrent = await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, admin.passwordHash);
      if (matchesCurrent) return;
    } catch { /* continue */ }
    for (const legacy of LEGACY_DEFAULT_ADMIN_PASSWORDS) {
      if (!legacy || legacy === DEFAULT_ADMIN_PASSWORD) continue;
      try {
        const matchesLegacy = await bcrypt.compare(legacy, admin.passwordHash);
        if (!matchesLegacy) continue;
        const nextHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
        updateUserFields(admin.id, { passwordHash: nextHash });
        console.warn(`QtilerAuth migrated legacy admin default password to current default. Username: admin Password: ${DEFAULT_ADMIN_PASSWORD} (change immediately).`);
        return;
      } catch { /* ignore this legacy candidate */ }
    }
  };
  await migrateLegacyDefaultAdminPassword();

  const isDefaultAdminPasswordActive = async () => {
    const admin = findUserByUsername('admin');
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

  /* ---------------------------------------------------------------- */
  /*  JWT helpers                                                      */
  /* ---------------------------------------------------------------- */
  const { jwtSecret, tokenTtlSeconds } = readConfig();

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

  /* ---------------------------------------------------------------- */
  /*  Security middleware                                               */
  /* ---------------------------------------------------------------- */
  const requireRoles = (...roles) => (req, res, next) => security.ensureRoles(req, res, next, roles);

  security.attachUser = async (req, res, next) => {
    try {
      const bearer = getAuthHeaderToken(req);
      const token = bearer || req.cookies?.[COOKIE_NAME];

      if (token) {
        const decoded = verifyToken(token);
        if (decoded && decoded.sub) {
          const user = findUserById(decoded.sub);
          req.user = user ? pickUserPayload(user) : null;

          // Sliding idle timeout for browser cookie sessions.
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
          return next();
        }
      }

      const apiKey = getApiKey(req);
      if (apiKey) {
        const user = findUserByApiKey(apiKey);
        if (!user || user.status === 'disabled') {
          req.user = null;
          return next();
        }
        req.user = pickUserPayload(user);
        return next();
      }

      const basicCreds = parseBasicAuth(req);
      if (basicCreds) {
        const user = findUserByUsername(basicCreds.username);
        if (!user || user.status === 'disabled') {
          req.user = null;
          return next();
        }
        const valid = await bcrypt.compare(basicCreds.password, user.passwordHash || '');
        req.user = valid ? pickUserPayload(user) : null;
        return next();
      }

      req.user = null;
      return next();
    } catch (err) {
      console.warn('attachUser failed', err);
      req.user = null;
      return next();
    }
  };

  security.ensureRoles = (req, res, next, roles) => {
    if (!roles || roles.length === 0) return next();
    if (!req.user) {
      return res.status(401).json({ error: 'auth_required' });
    }
    if (roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'forbidden' });
  };

  security.ensureProjectAccess = (req, res, next, projectId) => {
    if (!projectId) {
      if (req.user && req.user.role === ROLE_ADMIN) return next();
      return res.status(400).json({ error: 'project_required' });
    }
    if (req.user && req.user.role === ROLE_ADMIN) return next();
    const entry = getProjectAccess(projectId);
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

  /* ---------------------------------------------------------------- */
  /*  Routes                                                           */
  /* ---------------------------------------------------------------- */
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
    const user = findUserByUsername(username);
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
    const cookieOpts = {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: tokenTtlSeconds * 1000
    };
    res.cookie(COOKIE_NAME, token, cookieOpts);
    console.log('[QtilerAuth] Login successful', { username: user.username, secure: cookieOpts.secure });
    return res.json({ token, user: pickSelfPayload(user) });
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
    // Return the user's own apiKey so the frontend can build authenticated URLs
    const fullUser = req.user.id ? findUserById(req.user.id) : null;
    return res.json({ user: fullUser ? pickSelfPayload(fullUser) : req.user });
  });

  app.use('/auth', router);

  /* ---------------------------------------------------------------- */
  /*  Admin routes                                                     */
  /* ---------------------------------------------------------------- */
  const adminRouter = express.Router();
  adminRouter.use((req, res, next) => {
    if (typeof security.isEnabled === 'function' && !security.isEnabled()) {
      return res.status(404).json({ error: 'auth_plugin_disabled' });
    }
    return next();
  });
  adminRouter.use(requireRoles(ROLE_ADMIN));

  adminRouter.get('/users', (_req, res) => {
    const users = readUsers();
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
    try {
      insertUser(userRecord);
    } catch (err) {
      if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'username_taken' });
      }
      throw err;
    }
    res.status(201).json({ user: pickAdminUserPayload(userRecord) });
  });

  adminRouter.post('/users/:id/api-key', (req, res) => {
    const { id } = req.params;
    const newKey = crypto.randomBytes(24).toString('hex');
    const updated = updateUserFields(id, { apiKey: newKey });
    if (!updated) {
      return res.status(404).json({ error: 'user_not_found' });
    }
    res.json({ user: pickAdminUserPayload(updated) });
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
    const updated = updateUserFields(id, changes);
    if (!updated) {
      return res.status(404).json({ error: 'user_not_found' });
    }
    res.json({ user: pickUserPayload(updated) });
  });

  adminRouter.delete('/users/:id', (req, res) => {
    const { id } = req.params;
    const user = findUserById(id);
    if (!user) {
      return res.status(404).json({ error: 'user_not_found' });
    }
    if (user.username === 'admin') {
      return res.status(403).json({ error: 'cannot_delete_admin' });
    }
    stmts.deleteUser.run(id, 'admin');
    res.json({ ok: true });
  });

  adminRouter.get('/projects', (_req, res) => {
    const data = readProjectAccessFromDb(dataRoot);
    res.json({ projects: data.projects });
  });

  adminRouter.patch('/projects/:id', (req, res) => {
    const { id } = req.params;
    const { public: isPublic, allowedUsers, allowedRoles } = req.body || {};
    const entry = {};
    if (typeof isPublic === 'boolean') entry.public = isPublic;
    if (allowedUsers) entry.allowedUsers = allowedUsers;
    if (allowedRoles) entry.allowedRoles = allowedRoles;
    upsertProjectAccess(id, entry);
    const updated = getProjectAccess(id);
    res.json({ project: updated });
  });

  // Avoid collisions with Qtiler core admin UI under /admin.
  app.use('/auth-admin', adminRouter);

  const pluginSlug = (path.basename(baseDir || '') || 'QtilerAuth').replace(/[^a-z0-9-_]/gi, '') || 'QtilerAuth';
  app.get(`/plugins/${pluginSlug}/admin`, (_req, res) => res.redirect('/plugins/auth-admin'));

  return {
    roles: [ROLE_ADMIN, ROLE_AUTH],
    dispose: () => {
      resetSecurity();
      closeAuthDb();
    }
  };
};
