import express from 'express';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const ROLE_ADMIN = 'admin';
const ROLE_AUTH = 'authenticated';
const VALID_ROLES = new Set([ROLE_ADMIN, ROLE_AUTH]);
const COOKIE_NAME = 'qtiler_token';
const DEFAULT_ADMIN_PASSWORD = process.env.QTILER_DEFAULT_ADMIN_PASSWORD || 'adminnuevo123';

const nowIso = () => new Date().toISOString();
const normalizeUsername = (value) => String(value || '').trim().toLowerCase();

const pickUserPayload = (user) => {
  if (!user) return null;
  const { passwordHash, projects = [], ...rest } = user;
  return { ...rest, projects: Array.isArray(projects) ? projects : [] };
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

export const register = async ({ app, security, dataDir, baseDir, registerStore }) => {
  const usersStore = registerStore('../auth-users.json', { users: [] });
  const projectStore = registerStore('../project-access.json', { projects: {} });
  const configStore = registerStore('../auth-config.json', {
    jwtSecret: null,
    tokenTtlSeconds: 86400,
    refreshTtlSeconds: 1209600
  });

  const ensureSecret = async () => {
    await configStore.update((draft) => {
      if (!draft || typeof draft !== 'object') return { jwtSecret: crypto.randomBytes(32).toString('hex'), tokenTtlSeconds: 86400, refreshTtlSeconds: 1209600 };
      if (!draft.jwtSecret) {
        draft.jwtSecret = crypto.randomBytes(32).toString('hex');
      }
      if (!Number.isFinite(draft.tokenTtlSeconds)) {
        draft.tokenTtlSeconds = 86400;
      }
      if (!Number.isFinite(draft.refreshTtlSeconds)) {
        draft.refreshTtlSeconds = 1209600;
      }
      return draft;
    });
  };

  const readConfig = async () => {
    const cfg = await configStore.read();
    return {
      jwtSecret: cfg?.jwtSecret,
      tokenTtlSeconds: Number.isFinite(cfg?.tokenTtlSeconds) ? cfg.tokenTtlSeconds : 86400
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
    if (users.length > 0) return;
    const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
    const adminUser = {
      id: crypto.randomUUID(),
      username: 'admin',
      role: ROLE_ADMIN,
      passwordHash,
      projects: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: 'active'
    };
    await saveUsers([adminUser]);
    console.warn(`QtilerAuth initialized default admin user. Username: admin Password: ${DEFAULT_ADMIN_PASSWORD} (change immediately).`);
  };
  const isDefaultAdminPasswordActive = async () => {
    const admin = await findUserByUsername('admin');
    if (!admin || !admin.passwordHash) return false;
    try {
      return await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, admin.passwordHash);
    } catch (err) {
      console.warn('Failed to compare admin default password', err);
      return false;
    }
  };


  await ensureSecret();
  await ensureDefaultAdmin();

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

  const findUserByUsername = async (username) => {
    const users = await readUsers();
    const target = normalizeUsername(username);
    return users.find((u) => normalizeUsername(u.username) === target) || null;
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

  const requireRoles = (...roles) => (req, res, next) => security.ensureRoles(req, res, next, roles);

  security.attachUser = (req, _res, next) => {
    const bearer = getAuthHeaderToken(req);
    const token = bearer || req.cookies?.[COOKIE_NAME];
    
    if (token) {
      const decoded = verifyToken(token);
      if (decoded && decoded.sub) {
        return findUserById(decoded.sub).then((user) => {
          req.user = user ? pickUserPayload(user) : null;
          next();
        }).catch((err) => {
          console.warn('attachUser failed', err);
          req.user = null;
          next();
        });
      }
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
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: tokenTtlSeconds * 1000
    });
    return res.json({ token, user: pickUserPayload(user) });
  });

  router.post('/logout', (req, res) => {
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
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
    res.json({ users: users.map(pickUserPayload) });
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
    res.status(201).json({ user: pickUserPayload(userRecord) });
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

  app.use('/admin', adminRouter);

  const adminUiDir = path.join(baseDir, 'admin-ui');
  const pluginSlug = (path.basename(baseDir || '') || 'QtilerAuth').replace(/[^a-z0-9-_]/gi, '') || 'QtilerAuth';
  const adminRoutes = [
    { page: '/auth-admin', assets: '/auth-admin/assets' },
    { page: `/${pluginSlug}/admin`, assets: `/${pluginSlug}/admin/assets` }
  ];

  const uiRouter = express.Router();
  uiRouter.use((req, res, next) => {
    if (typeof security.isEnabled === 'function' && !security.isEnabled()) {
      return res.status(501).send('Auth admin UI not installed');
    }
    return next();
  });
  uiRouter.use(requireRoles(ROLE_ADMIN));
  adminRoutes.forEach(({ page, assets }) => {
    uiRouter.use(assets, express.static(adminUiDir));
    uiRouter.get(page, (_req, res) => {
      const filePath = path.join(adminUiDir, 'index.html');
      res.sendFile(filePath, (err) => {
        if (!err) return;
        if (err.code === 'ENOENT') {
          res.status(501).send('Auth admin UI not installed');
        } else {
          res.status(500).send('Failed to load auth admin UI');
        }
      });
    });
  });
  app.use('/plugins', uiRouter);

  return {
    roles: [ROLE_ADMIN, ROLE_AUTH],
    dispose: resetSecurity
  };
};
