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
const DEFAULT_ADMIN_PASSWORD = process.env.QTILER_DEFAULT_ADMIN_PASSWORD || 'MundoGIS-2026';
const LEGACY_DEFAULT_ADMIN_PASSWORDS = ['adminnuevo321', 'adminnuevo123', 'adminnuevo', 'admin2026'];

/* ------------------------------------------------------------------ */
/*  Brute-force protection / captcha configuration                     */
/* ------------------------------------------------------------------ */
const num = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
};
const LOGIN_WINDOW_SECONDS = num(process.env.AUTH_LOGIN_WINDOW_SECONDS, 900);
const LOGIN_MAX_ATTEMPTS = num(process.env.AUTH_LOGIN_MAX_ATTEMPTS, 8);
const LOGIN_LOCKOUT_SECONDS = num(process.env.AUTH_LOGIN_LOCKOUT_SECONDS, 900);
const LOGIN_CAPTCHA_AFTER = num(process.env.AUTH_LOGIN_CAPTCHA_AFTER, 3);
const API_RATE_LIMIT_PER_MINUTE = num(process.env.AUTH_API_RATE_LIMIT_PER_MINUTE, 0);
const API_KEY_LAST_USED_THROTTLE_MS = 60_000;
const STORE_PLAINTEXT_API_KEYS = !['0', 'false', 'no', 'off'].includes(
  String(process.env.AUTH_STORE_PLAINTEXT_API_KEYS ?? '1').trim().toLowerCase()
);
const CAPTCHA_PROVIDER = String(process.env.AUTH_CAPTCHA_PROVIDER || '').trim().toLowerCase();
const CAPTCHA_SITE_KEY = String(process.env.AUTH_CAPTCHA_SITE_KEY || '').trim();
const CAPTCHA_SECRET_KEY = String(process.env.AUTH_CAPTCHA_SECRET_KEY || '').trim();
// Difficulty for built-in proof-of-work captcha (number of leading zero bits
// in sha256(challenge|nonce)). 18 ~ 1–2s on a modern laptop; 20 ~ 4–8s.
const POW_DIFFICULTY = num(process.env.AUTH_CAPTCHA_POW_DIFFICULTY, 18);
// Lifetime of a PoW challenge before the server stops accepting it.
const POW_TTL_SECONDS = num(process.env.AUTH_CAPTCHA_POW_TTL_SECONDS, 300);
const CAPTCHA_ENABLED = (CAPTCHA_PROVIDER === 'pow')
  || (['turnstile', 'hcaptcha', 'recaptcha'].includes(CAPTCHA_PROVIDER)
    && CAPTCHA_SITE_KEY && CAPTCHA_SECRET_KEY);
const CAPTCHA_VERIFY_URLS = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  hcaptcha: 'https://hcaptcha.com/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify'
};

const getClientIp = (req) => {
  const xf = req.get('x-forwarded-for');
  if (xf) return String(xf).split(',')[0].trim();
  return String(req.ip || req.connection?.remoteAddress || '').replace(/^::ffff:/, '');
};

const pickCookieSecure = (req) => {
  return !!req.secure;
};

const clearAuthCookie = (res) => {
  const base = {
    httpOnly: true,
    sameSite: 'lax',
    path: '/'
  };
  res.clearCookie(COOKIE_NAME, base);
  res.clearCookie(COOKIE_NAME, { ...base, secure: true });
  res.clearCookie(COOKIE_NAME, { ...base, secure: false });
};

/* In-memory sliding-minute rate limit for API-key authenticated requests. */
const _apiKeyBuckets = new Map();
const checkApiKeyRateLimit = (keyHash) => {
  if (!API_RATE_LIMIT_PER_MINUTE || !keyHash) return true;
  const now = Date.now();
  let bucket = _apiKeyBuckets.get(keyHash);
  if (!bucket || (now - bucket.windowStart) >= 60_000) {
    bucket = { count: 0, windowStart: now };
    _apiKeyBuckets.set(keyHash, bucket);
  }
  bucket.count++;
  // Cheap eviction so the Map cannot grow unbounded.
  if (_apiKeyBuckets.size > 5000) {
    for (const [k, v] of _apiKeyBuckets) {
      if ((now - v.windowStart) >= 60_000) _apiKeyBuckets.delete(k);
      if (_apiKeyBuckets.size <= 4000) break;
    }
  }
  return bucket.count <= API_RATE_LIMIT_PER_MINUTE;
};

// Built-in proof-of-work captcha. The server signs (challenge | exp | diff)
// with an HMAC derived from a per-process secret so we don't need any state
// table. The client must find a `nonce` such that the SHA-256 of
// `challenge:nonce` starts with `diff` zero bits. No external service.
const _powSecret = crypto.randomBytes(32);
const signPow = (challenge, exp, diff) => crypto
  .createHmac('sha256', _powSecret)
  .update(`${challenge}|${exp}|${diff}`)
  .digest('hex')
  .slice(0, 32);
const makePowChallenge = () => {
  const challenge = crypto.randomBytes(16).toString('hex');
  const exp = Math.floor(Date.now() / 1000) + POW_TTL_SECONDS;
  const diff = POW_DIFFICULTY;
  const sig = signPow(challenge, exp, diff);
  return { provider: 'pow', challenge, exp, difficulty: diff, sig };
};
const hasLeadingZeroBits = (hex, bits) => {
  let remaining = bits;
  for (let i = 0; i < hex.length && remaining > 0; i++) {
    const nibble = parseInt(hex[i], 16);
    if (remaining >= 4) {
      if (nibble !== 0) return false;
      remaining -= 4;
    } else {
      // Top `remaining` bits of this nibble must be zero.
      const mask = (0xf << (4 - remaining)) & 0xf;
      return (nibble & mask) === 0;
    }
  }
  return true;
};
const verifyPowToken = (token) => {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'captcha_missing' };
  const parts = token.split('.');
  if (parts.length !== 5) return { ok: false, reason: 'captcha_failed' };
  const [challenge, expRaw, diffRaw, sig, nonce] = parts;
  const exp = Number(expRaw);
  const diff = Number(diffRaw);
  if (!Number.isFinite(exp) || !Number.isFinite(diff)) return { ok: false, reason: 'captcha_failed' };
  if (Math.floor(Date.now() / 1000) > exp) return { ok: false, reason: 'captcha_expired' };
  if (diff < POW_DIFFICULTY) return { ok: false, reason: 'captcha_failed' };
  const expectedSig = signPow(challenge, exp, diff);
  // constant-time compare
  let mismatch = expectedSig.length !== sig.length ? 1 : 0;
  for (let i = 0; i < expectedSig.length && i < sig.length; i++) {
    mismatch |= expectedSig.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  if (mismatch) return { ok: false, reason: 'captcha_failed' };
  const digest = crypto.createHash('sha256').update(`${challenge}:${nonce}`).digest('hex');
  if (!hasLeadingZeroBits(digest, diff)) return { ok: false, reason: 'captcha_failed' };
  return { ok: true };
};

const verifyCaptchaToken = async (token, remoteIp) => {
  if (!CAPTCHA_ENABLED) return { ok: true, skipped: true };
  if (CAPTCHA_PROVIDER === 'pow') return verifyPowToken(token);
  if (!token) return { ok: false, reason: 'captcha_missing' };
  const url = CAPTCHA_VERIFY_URLS[CAPTCHA_PROVIDER];
  try {
    const body = new URLSearchParams({ secret: CAPTCHA_SECRET_KEY, response: String(token) });
    if (remoteIp) body.set('remoteip', remoteIp);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const data = await res.json().catch(() => null);
    if (data && data.success === true) return { ok: true };
    return { ok: false, reason: 'captcha_failed', detail: data?.['error-codes'] || null };
  } catch (err) {
    return { ok: false, reason: 'captcha_unreachable', detail: err?.message };
  }
};

const nowIso = () => new Date().toISOString();
const normalizeUsername = (value) => String(value || '').trim().toLowerCase();

const API_KEY_PREFIX = 'qk_';
const API_KEY_PREFIX_LEN = 11; // 'qk_' + first 8 hex chars
const generateApiKey = () => API_KEY_PREFIX + crypto.randomBytes(24).toString('hex');
const hashApiKey = (plain) => crypto.createHash('sha256').update(String(plain || ''), 'utf8').digest('hex');
const apiKeyPrefixOf = (plain) => {
  const s = String(plain || '');
  if (!s) return null;
  return s.slice(0, API_KEY_PREFIX_LEN);
};

const pickUserPayload = (user) => {
  if (!user) return null;
  // Strip ALL secret-like fields by default.
  const { passwordHash, apiKey, apiKeyHash, projects = [], permissions = [], ...rest } = user;
  return {
    ...rest,
    projects: Array.isArray(projects) ? projects : [],
    permissions: Array.isArray(permissions) ? permissions : []
  };
};

const pickAdminUserPayload = (user) => {
  const payload = pickUserPayload(user);
  if (!payload) return null;
  return {
    ...payload,
    // After migration the plaintext column is null; UI shows prefix instead.
    apiKey: user?.apiKey || null,
    apiKeyPrefix: user?.apiKeyPrefix || null,
    apiKeyLastUsedAt: user?.apiKeyLastUsedAt || null
  };
};

// Like pickUserPayload but includes the user's own apiKey (for /auth/me and /auth/login)
const pickSelfPayload = (user) => {
  const payload = pickUserPayload(user);
  if (!payload) return null;
  return {
    ...payload,
    apiKey: user?.apiKey || null,
    apiKeyPrefix: user?.apiKeyPrefix || null,
    apiKeyLastUsedAt: user?.apiKeyLastUsedAt || null
  };
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
    apiKeyHash: row.api_key_hash || null,
    apiKeyPrefix: row.api_key_prefix || null,
    apiKeyLastUsedAt: row.api_key_last_used_at || null,
    projects: JSON.parse(row.projects || '[]'),
    permissions: JSON.parse(row.permissions || '[]'),
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
          INSERT OR IGNORE INTO users (id, username, password_hash, role, api_key, projects, permissions, status, created_at, updated_at)
          VALUES (@id, @username, @password_hash, @role, @api_key, @projects, @permissions, @status, @created_at, @updated_at)
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
              permissions: JSON.stringify(ensureArrayOfStrings(u.permissions)),
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
          INSERT OR REPLACE INTO projects (project_id, is_public, allowed_users, allowed_roles, edit_users, edit_roles)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        db.transaction(() => {
          for (const [pid, entry] of Object.entries(projs)) {
            upsert.run(
              pid,
              entry?.public ? 1 : 0,
              JSON.stringify(ensureArrayOfStrings(entry?.allowedUsers)),
              JSON.stringify(ensureArrayOfStrings(entry?.allowedRoles)),
              JSON.stringify(ensureArrayOfStrings(entry?.editUsers)),
              JSON.stringify(ensureArrayOfStrings(entry?.editRoles))
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
    getUserByApiKeyHash: db.prepare('SELECT * FROM users WHERE api_key_hash = ?'),
    insertUser: db.prepare(`
      INSERT INTO users (id, username, password_hash, role, api_key, api_key_hash, api_key_prefix, api_key_last_used_at, projects, permissions, status, created_at, updated_at)
      VALUES (@id, @username, @password_hash, @role, @api_key, @api_key_hash, @api_key_prefix, @api_key_last_used_at, @projects, @permissions, @status, @created_at, @updated_at)
    `),
    updateUser: db.prepare(`
      UPDATE users SET username = @username, password_hash = @password_hash, role = @role,
        api_key = @api_key, api_key_hash = @api_key_hash, api_key_prefix = @api_key_prefix,
        api_key_last_used_at = @api_key_last_used_at,
        projects = @projects, permissions = @permissions, status = @status, updated_at = @updated_at
      WHERE id = @id
    `),
    touchApiKeyLastUsed: db.prepare('UPDATE users SET api_key_last_used_at = ? WHERE id = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ? AND username != ?'),
    getConfig: db.prepare('SELECT key, value FROM config'),
    upsertConfig: db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)'),
    getProject: db.prepare('SELECT * FROM projects WHERE project_id = ?'),
    upsertProject: db.prepare(`
      INSERT OR REPLACE INTO projects (project_id, is_public, allowed_users, allowed_roles, edit_users, edit_roles)
      VALUES (@project_id, @is_public, @allowed_users, @allowed_roles, @edit_users, @edit_roles)
    `),
    insertLoginAttempt: db.prepare(`
      INSERT INTO login_attempts (username, ip, success, captcha_required, captcha_passed, reason, user_agent, created_at)
      VALUES (@username, @ip, @success, @captcha_required, @captcha_passed, @reason, @user_agent, @created_at)
    `),
    countRecentFailures: db.prepare(`
      SELECT COUNT(*) AS cnt FROM login_attempts
      WHERE success = 0 AND created_at >= @since
        AND (username = @username OR ip = @ip)
    `),
    pruneOldAttempts: db.prepare(`
      DELETE FROM login_attempts WHERE created_at < @cutoff
    `),
    recentAttemptsForAudit: db.prepare(`
      SELECT username, ip, success, captcha_required, captcha_passed, reason, user_agent, created_at
      FROM login_attempts ORDER BY id DESC LIMIT @limit
    `),
    insertRevokedToken: db.prepare(`
      INSERT OR IGNORE INTO revoked_tokens (jti, user_id, expires_at, reason)
      VALUES (@jti, @user_id, @expires_at, @reason)
    `),
    isRevokedJti: db.prepare(`SELECT 1 AS x FROM revoked_tokens WHERE jti = ? LIMIT 1`),
    pruneRevokedTokens: db.prepare(`DELETE FROM revoked_tokens WHERE expires_at < ?`),
    revokeAllForUser: db.prepare(`
      INSERT OR IGNORE INTO revoked_tokens (jti, user_id, expires_at, reason)
      VALUES (@jti, @user_id, @expires_at, @reason)
    `),
    setUserSessionsRevokedAt: db.prepare(`UPDATE config SET value = @value WHERE key = @key`),
    upsertUserSessionsRevokedAt: db.prepare(`
      INSERT INTO config (key, value) VALUES (@key, @value)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
  };

  /* ---------------------------------------------------------------- */
  /*  Login attempt helpers                                            */
  /* ---------------------------------------------------------------- */
  const sinceIso = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();

  const recordLoginAttempt = ({ username, ip, success, captchaRequired, captchaPassed, reason, userAgent }) => {
    try {
      stmts.insertLoginAttempt.run({
        username: normalizeUsername(username) || '',
        ip: ip || '',
        success: success ? 1 : 0,
        captcha_required: captchaRequired ? 1 : 0,
        captcha_passed: captchaPassed ? 1 : 0,
        reason: reason || null,
        user_agent: (userAgent || '').slice(0, 256),
        created_at: nowIso()
      });
    } catch (err) {
      console.warn('[QtilerAuth] Failed to log login attempt', err?.message || err);
    }
  };

  const countRecentFailures = (username, ip) => {
    const since = sinceIso(LOGIN_WINDOW_SECONDS);
    const row = stmts.countRecentFailures.get({
      since,
      username: normalizeUsername(username) || '',
      ip: ip || ''
    });
    return row?.cnt || 0;
  };

  const computeLoginStatus = (username, ip) => {
    const fails = countRecentFailures(username, ip);
    const requireCaptcha = CAPTCHA_ENABLED && fails >= LOGIN_CAPTCHA_AFTER;
    const locked = fails >= LOGIN_MAX_ATTEMPTS;
    return {
      fails,
      requireCaptcha,
      locked,
      retryAfterSeconds: locked ? LOGIN_LOCKOUT_SECONDS : 0,
      captchaProvider: CAPTCHA_ENABLED ? CAPTCHA_PROVIDER : null,
      // For PoW the "site key" slot carries the difficulty so the client knows
      // how hard it should hash before submitting; for external providers it's
      // the public site-key from their dashboard.
      captchaSiteKey: CAPTCHA_ENABLED
        ? (CAPTCHA_PROVIDER === 'pow' ? String(POW_DIFFICULTY) : CAPTCHA_SITE_KEY)
        : null
    };
  };

  // Periodic cleanup so the table stays tiny (keep 30 days).
  try {
    stmts.pruneOldAttempts.run({ cutoff: sinceIso(30 * 24 * 3600) });
  } catch {}
  setInterval(() => {
    try { stmts.pruneOldAttempts.run({ cutoff: sinceIso(30 * 24 * 3600) }); } catch {}
  }, 24 * 3600 * 1000).unref?.();

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
    // Preferred path: SHA-256 hash lookup.
    let row = stmts.getUserByApiKeyHash.get(hashApiKey(needle));
    // Fallback: legacy plaintext column (pre-migration / pre-rotation).
    if (!row) row = stmts.getUserByApiKey.get(needle);
    if (!row) return null;
    // Throttled last-used update (at most once per minute per key).
    try {
      const last = row.api_key_last_used_at ? Date.parse(row.api_key_last_used_at) : 0;
      if (!last || (Date.now() - last) >= API_KEY_LAST_USED_THROTTLE_MS) {
        const ts = nowIso();
        stmts.touchApiKeyLastUsed.run(ts, row.id);
        row.api_key_last_used_at = ts;
      }
    } catch {}
    return rowToUser(row);
  };

  const findUserById = (id) => rowToUser(stmts.getUserById.get(id));

  const insertUser = (user) => {
    const plain = user.apiKey || null;
    const hash = user.apiKeyHash !== undefined
      ? user.apiKeyHash
      : (plain ? hashApiKey(plain) : null);
    const prefix = user.apiKeyPrefix !== undefined
      ? user.apiKeyPrefix
      : (plain ? apiKeyPrefixOf(plain) : null);
    stmts.insertUser.run({
      id: user.id,
      username: normalizeUsername(user.username),
      password_hash: user.passwordHash,
      role: user.role,
      api_key: plain,
      api_key_hash: hash,
      api_key_prefix: prefix,
      api_key_last_used_at: user.apiKeyLastUsedAt || null,
      projects: JSON.stringify(Array.isArray(user.projects) ? user.projects : []),
      permissions: JSON.stringify(ensureArrayOfStrings(user.permissions)),
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
      api_key_hash: changes.apiKeyHash !== undefined ? changes.apiKeyHash : current.api_key_hash,
      api_key_prefix: changes.apiKeyPrefix !== undefined ? changes.apiKeyPrefix : current.api_key_prefix,
      api_key_last_used_at: changes.apiKeyLastUsedAt !== undefined ? changes.apiKeyLastUsedAt : current.api_key_last_used_at,
      projects: changes.projects !== undefined ? JSON.stringify(changes.projects) : current.projects,
      permissions: changes.permissions !== undefined ? JSON.stringify(ensureArrayOfStrings(changes.permissions)) : current.permissions,
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
      allowedRoles: JSON.parse(row.allowed_roles || '[]'),
      editUsers: JSON.parse(row.edit_users || '[]'),
      editRoles: JSON.parse(row.edit_roles || '[]')
    };
  };

  const upsertProjectAccess = (projectId, entry) => {
    const current = getProjectAccess(projectId) || { public: false, allowedUsers: [], allowedRoles: [], editUsers: [], editRoles: [] };
    stmts.upsertProject.run({
      project_id: projectId,
      is_public: (entry.public !== undefined ? entry.public : current.public) ? 1 : 0,
      allowed_users: JSON.stringify(ensureArrayOfStrings(entry.allowedUsers !== undefined ? entry.allowedUsers : current.allowedUsers)),
      allowed_roles: JSON.stringify(ensureArrayOfStrings(entry.allowedRoles !== undefined ? entry.allowedRoles : current.allowedRoles).filter((r) => VALID_ROLES.has(r))),
      edit_users: JSON.stringify(ensureArrayOfStrings(entry.editUsers !== undefined ? entry.editUsers : current.editUsers)),
      edit_roles: JSON.stringify(ensureArrayOfStrings(entry.editRoles !== undefined ? entry.editRoles : current.editRoles).filter((r) => VALID_ROLES.has(r)))
    });
  };

  const userHasPermission = (user, permission) => {
    if (!user || !permission) return false;
    if (user.role === ROLE_ADMIN) return true;
    const permissions = ensureArrayOfStrings(user.permissions);
    return permissions.includes(permission) || permissions.includes('*');
  };

  const canEditProject = (user, projectId) => {
    if (!user || !projectId) return false;
    if (user.role === ROLE_ADMIN) return true;
    const entry = getProjectAccess(projectId) || {};
    const editUsers = ensureArrayOfStrings(entry.editUsers);
    const editRoles = ensureArrayOfStrings(entry.editRoles);
    return editUsers.includes(user.id)
      || editRoles.includes(user.role)
      || userHasPermission(user, `project:edit:${projectId}`);
  };

  const canEditPortal = (user, portalId = 'Qtiler2Origo') => {
    if (!user) return false;
    if (user.role === ROLE_ADMIN) return true;
    return userHasPermission(user, 'portal:edit')
      || userHasPermission(user, `portal:edit:${portalId}`);
  };

  /* ---------------------------------------------------------------- */
  /*  Startup initialization                                           */
  /* ---------------------------------------------------------------- */
  ensureSecret();

  // Ensure default admin
  if (!findUserByUsername('admin')) {
    const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
    const adminKey = generateApiKey();
    insertUser({
      id: crypto.randomUUID(),
      username: 'admin',
      role: ROLE_ADMIN,
      passwordHash,
      apiKey: null,
      apiKeyHash: hashApiKey(adminKey),
      apiKeyPrefix: apiKeyPrefixOf(adminKey),
      projects: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: 'active'
    });
    console.warn(`QtilerAuth initialized default admin user. Username: admin Password: ${DEFAULT_ADMIN_PASSWORD} (change immediately).`);
    console.warn(`QtilerAuth: initial admin API key (shown once, copy now): ${adminKey}`);
  }

  // Backfill API keys for any users missing them
  for (const u of readUsers()) {
    if (!u.apiKey && !u.apiKeyHash) {
      const newKey = generateApiKey();
      updateUserFields(u.id, {
        apiKey: null,
        apiKeyHash: hashApiKey(newKey),
        apiKeyPrefix: apiKeyPrefixOf(newKey)
      });
      console.warn(`QtilerAuth: generated API key for user '${u.username}' (shown once): ${newKey}`);
    } else if (u.apiKey && !u.apiKeyHash) {
      // Migration: legacy plaintext key — backfill hash + prefix but keep plaintext
      // so that existing customers can still copy/rotate from the admin UI.
      updateUserFields(u.id, {
        apiKeyHash: hashApiKey(u.apiKey),
        apiKeyPrefix: apiKeyPrefixOf(u.apiKey)
      });
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

  // Revocation: each token carries a random `jti`. We store revoked jtis with
  // their original `exp` so the row can be pruned once the natural expiry
  // passes. We also support a per-user `revokedBefore` cutoff so an admin
  // can invalidate every active session for a user with a single config write
  // instead of inserting one row per active token.
  const REVOKED_BEFORE_KEY_PREFIX = 'user_sessions_revoked_before:';
  let _lastRevokedPrune = 0;
  const _userRevokedBefore = new Map(); // userId -> epoch seconds

  const loadUserRevokedBefore = (userId) => {
    if (!userId) return 0;
    if (_userRevokedBefore.has(userId)) return _userRevokedBefore.get(userId);
    try {
      const row = db.prepare('SELECT value FROM config WHERE key = ?').get(REVOKED_BEFORE_KEY_PREFIX + userId);
      const v = row && row.value ? Number(row.value) : 0;
      _userRevokedBefore.set(userId, Number.isFinite(v) ? v : 0);
      return _userRevokedBefore.get(userId);
    } catch {
      return 0;
    }
  };

  const setUserRevokedBefore = (userId, epochSeconds) => {
    if (!userId) return;
    try {
      stmts.upsertUserSessionsRevokedAt.run({
        key: REVOKED_BEFORE_KEY_PREFIX + userId,
        value: String(epochSeconds)
      });
      _userRevokedBefore.set(userId, epochSeconds);
    } catch (err) {
      console.warn('[QtilerAuth] Failed to persist session revocation cutoff', err?.message || err);
    }
  };

  const revokeJti = (jti, userId, expiresAtEpoch, reason) => {
    if (!jti) return;
    try {
      stmts.insertRevokedToken.run({
        jti: String(jti),
        user_id: userId ? String(userId) : null,
        expires_at: Number(expiresAtEpoch) || (Math.floor(Date.now() / 1000) + tokenTtlSeconds),
        reason: reason ? String(reason) : null
      });
    } catch (err) {
      console.warn('[QtilerAuth] Failed to revoke token', err?.message || err);
    }
  };

  const isTokenRevoked = (decoded) => {
    if (!decoded || typeof decoded !== 'object') return false;
    // Per-user cutoff: any token issued before this timestamp is invalid.
    if (decoded.sub && decoded.iat) {
      const cutoff = loadUserRevokedBefore(decoded.sub);
      if (cutoff && Number(decoded.iat) < cutoff) return true;
    }
    // Specific jti revoked (logout).
    if (decoded.jti) {
      try {
        const row = stmts.isRevokedJti.get(String(decoded.jti));
        if (row) return true;
      } catch {}
    }
    // Opportunistic prune (at most once per hour).
    const now = Math.floor(Date.now() / 1000);
    if (now - _lastRevokedPrune > 3600) {
      _lastRevokedPrune = now;
      try { stmts.pruneRevokedTokens.run(now); } catch {}
    }
    return false;
  };

  const issueToken = (user) => {
    const payload = buildTokenPayload(user);
    payload.jti = crypto.randomBytes(12).toString('hex');
    return jwt.sign(payload, jwtSecret, { expiresIn: tokenTtlSeconds });
  };

  const verifyToken = (token) => {
    try {
      const decoded = jwt.verify(token, jwtSecret);
      if (isTokenRevoked(decoded)) return null;
      return decoded;
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
          const isLogoutRequest = req.path === '/auth/logout' || req.originalUrl === '/auth/logout';
          if (req.user && !bearer && !isLogoutRequest) {
            try {
              const renewedToken = issueToken(user);
              res.cookie(COOKIE_NAME, renewedToken, {
                httpOnly: true,
                sameSite: 'lax',
                path: '/',
                secure: pickCookieSecure(req),
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
        // Per-key rate limit (in-memory sliding minute window). Off by default.
        if (API_RATE_LIMIT_PER_MINUTE > 0) {
          const keyHash = user.apiKeyHash || hashApiKey(apiKey);
          if (!checkApiKeyRateLimit(keyHash)) {
            res.set('Retry-After', '60');
            return res.status(429).json({ error: 'api_key_rate_limited' });
          }
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

  security.canEditProject = (user, projectId) => canEditProject(user, projectId);
  security.canEditPortal = (user, portalId) => canEditPortal(user, portalId);
  security.userHasPermission = (user, permission) => userHasPermission(user, permission);

  security.isEnabled = () => true;

  const resetSecurity = () => {
    security.attachUser = (req, _res, next) => {
      req.user = null;
      next();
    };
    security.ensureRoles = (_req, _res, next) => next();
    security.ensureProjectAccess = (_req, _res, next) => next();
    security.canEditProject = () => true;
    security.canEditPortal = () => true;
    security.userHasPermission = () => true;
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

  // Public preflight: lets the login form know whether to render a captcha
  // for this username/IP, without leaking whether the user exists.
  router.post('/login-status', (req, res) => {
    const ip = getClientIp(req);
    const username = req.body?.username;
    const status = computeLoginStatus(username, ip);
    return res.json({
      requireCaptcha: status.requireCaptcha,
      captchaProvider: status.captchaProvider,
      captchaSiteKey: status.captchaSiteKey,
      locked: status.locked,
      retryAfterSeconds: status.retryAfterSeconds
    });
  });

  // Issues a fresh PoW challenge. Stateless — the signature carries everything
  // we need to verify the answer. Only meaningful when AUTH_CAPTCHA_PROVIDER=pow.
  router.get('/captcha-challenge', (req, res) => {
    if (CAPTCHA_PROVIDER !== 'pow') {
      return res.status(404).json({ error: 'pow_not_enabled' });
    }
    return res.json(makePowChallenge());
  });

  router.post('/login', async (req, res) => {
    const ip = getClientIp(req);
    const userAgent = req.get('user-agent') || '';
    const { username, password, captchaToken } = req.body || {};
    // Honeypot: any bot blindly filling all fields trips this. Real form has no such field.
    const honeypot = req.body?.email_confirm || req.body?.website || '';

    const finish = (httpStatus, payload, audit) => {
      recordLoginAttempt({
        username,
        ip,
        success: httpStatus < 300,
        captchaRequired: audit?.captchaRequired || false,
        captchaPassed: audit?.captchaPassed || false,
        reason: audit?.reason || null,
        userAgent
      });
      return res.status(httpStatus).json(payload);
    };

    if (honeypot) {
      // Pretend a normal failure; do not tell the bot what it tripped.
      return finish(401, { error: 'invalid_credentials' }, { reason: 'honeypot' });
    }

    if (!username || !password) {
      return finish(400, { error: 'missing_credentials' }, { reason: 'missing_credentials' });
    }

    const status = computeLoginStatus(username, ip);
    if (status.locked) {
      res.set('Retry-After', String(status.retryAfterSeconds));
      return finish(429, {
        error: 'too_many_attempts',
        retryAfterSeconds: status.retryAfterSeconds
      }, { reason: 'rate_limited' });
    }

    if (status.requireCaptcha) {
      const verdict = await verifyCaptchaToken(captchaToken, ip);
      if (!verdict.ok) {
        return finish(400, {
          error: 'captcha_required',
          captchaProvider: status.captchaProvider,
          captchaSiteKey: status.captchaSiteKey
        }, { reason: verdict.reason || 'captcha_failed', captchaRequired: true });
      }
    }

    const user = findUserByUsername(username);
    if (!user) {
      return finish(401, { error: 'invalid_credentials' }, {
        reason: 'unknown_user',
        captchaRequired: status.requireCaptcha,
        captchaPassed: status.requireCaptcha
      });
    }
    if (user.status === 'disabled') {
      return finish(403, { error: 'user_disabled' }, {
        reason: 'user_disabled',
        captchaRequired: status.requireCaptcha,
        captchaPassed: status.requireCaptcha
      });
    }
    const ok = await bcrypt.compare(password, user.passwordHash || '');
    if (!ok) {
      return finish(401, { error: 'invalid_credentials' }, {
        reason: 'bad_password',
        captchaRequired: status.requireCaptcha,
        captchaPassed: status.requireCaptcha
      });
    }

    const token = issueToken(user);
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: pickCookieSecure(req),
      maxAge: tokenTtlSeconds * 1000
    });
    return finish(200, { token, user: pickSelfPayload(user) }, {
      reason: 'ok',
      captchaRequired: status.requireCaptcha,
      captchaPassed: status.requireCaptcha
    });
  });

  router.post('/logout', (req, res) => {
    // Best-effort revocation of the current session's jti so the cookie/Bearer
    // cannot be reused even if the client kept a copy.
    try {
      const bearer = getAuthHeaderToken(req);
      const token = bearer || req.cookies?.[COOKIE_NAME];
      if (token) {
        try {
          const decoded = jwt.verify(token, jwtSecret, { ignoreExpiration: true });
          if (decoded && decoded.jti && decoded.exp) {
            revokeJti(decoded.jti, decoded.sub || null, decoded.exp, 'logout');
          }
        } catch {}
      }
    } catch {}
    clearAuthCookie(res);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    return res.json({ ok: true, loggedOut: true });
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

  adminRouter.get('/login-audit', (req, res) => {
    const limit = Math.min(Math.max(Number(req.query?.limit) || 100, 1), 1000);
    const rows = stmts.recentAttemptsForAudit.all({ limit });
    res.json({
      attempts: rows,
      config: {
        windowSeconds: LOGIN_WINDOW_SECONDS,
        maxAttempts: LOGIN_MAX_ATTEMPTS,
        lockoutSeconds: LOGIN_LOCKOUT_SECONDS,
        captchaAfter: LOGIN_CAPTCHA_AFTER,
        captchaProvider: CAPTCHA_ENABLED ? CAPTCHA_PROVIDER : null
      }
    });
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
    const { username, password, role, projects = [], permissions = [], status = 'active' } = req.body || {};
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
    const newApiKey = generateApiKey();
    const userRecord = {
      id: crypto.randomUUID(),
      username: cleanUsername,
      passwordHash,
      role: targetRole,
      // Compatibility mode (default): keep plaintext key so admins can copy it
      // later without rotating. Set AUTH_STORE_PLAINTEXT_API_KEYS=0 to keep
      // hash-only storage (more secure, but copy is one-time only).
      apiKey: STORE_PLAINTEXT_API_KEYS ? newApiKey : null,
      apiKeyHash: hashApiKey(newApiKey),
      apiKeyPrefix: apiKeyPrefixOf(newApiKey),
      projects: ensureArrayOfStrings(projects),
      permissions: ensureArrayOfStrings(permissions),
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
    res.status(201).json({
      user: pickAdminUserPayload(userRecord),
      apiKey: newApiKey,
      apiKeyOneTime: !STORE_PLAINTEXT_API_KEYS
    });
  });

  adminRouter.post('/users/:id/api-key', (req, res) => {
    const { id } = req.params;
    const newKey = generateApiKey();
    const updated = updateUserFields(id, {
      apiKey: STORE_PLAINTEXT_API_KEYS ? newKey : null,
      apiKeyHash: hashApiKey(newKey),
      apiKeyPrefix: apiKeyPrefixOf(newKey),
      apiKeyLastUsedAt: null
    });
    if (!updated) {
      return res.status(404).json({ error: 'user_not_found' });
    }
    res.json({
      user: pickAdminUserPayload(updated),
      apiKey: newKey,
      apiKeyOneTime: !STORE_PLAINTEXT_API_KEYS
    });
  });

  // Revoke every active session (cookie/Bearer JWT) for the target user.
  // Implemented as a per-user cutoff (`iat < now` becomes invalid) so we don't
  // need to enumerate active jtis. Existing API keys keep working until the
  // admin rotates them via /users/:id/api-key above.
  adminRouter.post('/users/:id/revoke-sessions', (req, res) => {
    const { id } = req.params;
    const user = findUserById(id);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    const cutoff = Math.floor(Date.now() / 1000);
    setUserRevokedBefore(id, cutoff);
    res.json({ ok: true, revokedBefore: cutoff });
  });

  adminRouter.patch('/users/:id', async (req, res) => {
    const { id } = req.params;
    const { password, role, projects, permissions, status } = req.body || {};
    const changes = {};
    if (role && VALID_ROLES.has(role)) {
      changes.role = role;
    }
    if (status === 'disabled' || status === 'active') {
      changes.status = status;
    }
    if (projects !== undefined) {
      changes.projects = ensureArrayOfStrings(projects);
    }
    if (permissions !== undefined) {
      changes.permissions = ensureArrayOfStrings(permissions);
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
    const { public: isPublic, allowedUsers, allowedRoles, editUsers, editRoles } = req.body || {};
    const entry = {};
    if (typeof isPublic === 'boolean') entry.public = isPublic;
    if (allowedUsers !== undefined) entry.allowedUsers = allowedUsers;
    if (allowedRoles !== undefined) entry.allowedRoles = allowedRoles;
    if (editUsers !== undefined) entry.editUsers = editUsers;
    if (editRoles !== undefined) entry.editRoles = editRoles;
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
