/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let _db = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'authenticated' CHECK(role IN ('admin', 'authenticated')),
    api_key TEXT UNIQUE,
    projects TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS projects (
    project_id TEXT PRIMARY KEY,
    is_public INTEGER NOT NULL DEFAULT 0,
    allowed_users TEXT NOT NULL DEFAULT '[]',
    allowed_roles TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS plugin_trials (
    plugin_name TEXT PRIMARY KEY,
    first_installed_at TEXT NOT NULL,
    trial_expires_at TEXT NOT NULL,
    trial_sig TEXT NOT NULL,
    license_key TEXT,
    license_validated_at TEXT,
    license_expires_at TEXT
  );
  CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    ip TEXT NOT NULL,
    success INTEGER NOT NULL DEFAULT 0,
    captcha_required INTEGER NOT NULL DEFAULT 0,
    captcha_passed INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_login_attempts_user_time ON login_attempts(username, created_at);
  CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip, created_at);
  CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti TEXT PRIMARY KEY,
    user_id TEXT,
    expires_at INTEGER NOT NULL,
    revoked_at TEXT NOT NULL DEFAULT (datetime('now')),
    reason TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at);
  CREATE INDEX IF NOT EXISTS idx_revoked_tokens_user ON revoked_tokens(user_id);
`;

/**
 * Get (or create) the shared auth SQLite database.
 * @param {string} dataDir – The Qtiler data directory (e.g. `data/`).
 * @returns {import('better-sqlite3').Database}
 */
export const getAuthDb = (dataDir) => {
  if (_db) return _db;
  const dbPath = path.join(dataDir, 'auth.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.exec(SCHEMA);
  // Idempotent migrations for columns/indexes added after initial release.
  try {
    const userCols = _db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
    if (!userCols.includes('api_key_hash')) {
      _db.exec("ALTER TABLE users ADD COLUMN api_key_hash TEXT");
    }
    if (!userCols.includes('api_key_prefix')) {
      _db.exec("ALTER TABLE users ADD COLUMN api_key_prefix TEXT");
    }
    if (!userCols.includes('api_key_last_used_at')) {
      _db.exec("ALTER TABLE users ADD COLUMN api_key_last_used_at TEXT");
    }
    _db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_key_hash ON users(api_key_hash) WHERE api_key_hash IS NOT NULL");
  } catch (err) {
    console.warn('[authDb] Schema migration warning:', err?.message || err);
  }
  return _db;
};

export const closeAuthDb = () => {
  if (_db) {
    try { _db.close(); } catch {}
    _db = null;
  }
};

export const authDbExists = (dataDir) => {
  return fs.existsSync(path.join(dataDir, 'auth.db'));
};

/* ------------------------------------------------------------------ */
/*  Project-access helpers (used by server.js)                         */
/* ------------------------------------------------------------------ */

const ensureArrayOfStrings = (value) => {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v || '').trim()).filter(Boolean);
};

export const readProjectAccessFromDb = (dataDir) => {
  const db = getAuthDb(dataDir);
  const rows = db.prepare('SELECT * FROM projects').all();
  const projects = {};
  for (const r of rows) {
    projects[r.project_id] = {
      public: !!r.is_public,
      allowedUsers: JSON.parse(r.allowed_users || '[]'),
      allowedRoles: JSON.parse(r.allowed_roles || '[]')
    };
  }
  return { projects };
};

export const removeProjectAccessFromDb = (dataDir, projectId) => {
  if (!projectId) return;
  const db = getAuthDb(dataDir);
  db.prepare('DELETE FROM projects WHERE project_id = ?').run(projectId);
};

export const purgeProjectFromUsersInDb = (dataDir, projectId) => {
  if (!projectId) return;
  const db = getAuthDb(dataDir);
  const rows = db.prepare('SELECT id, projects FROM users').all();
  const update = db.prepare('UPDATE users SET projects = ?, updated_at = ? WHERE id = ?');
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const row of rows) {
      const projects = JSON.parse(row.projects || '[]');
      const filtered = projects.filter(p => p !== projectId);
      if (filtered.length !== projects.length) {
        update.run(JSON.stringify(filtered), now, row.id);
      }
    }
  })();
};

export const persistProjectAccessInDb = (dataDir, snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return;
  const db = getAuthDb(dataDir);
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO projects (project_id, is_public, allowed_users, allowed_roles)
    VALUES (?, ?, ?, ?)
  `);
  const del = db.prepare('DELETE FROM projects');
  db.transaction(() => {
    del.run();
    const projs = snapshot.projects;
    if (projs && typeof projs === 'object') {
      for (const [pid, entry] of Object.entries(projs)) {
        upsert.run(
          pid,
          entry?.public ? 1 : 0,
          JSON.stringify(ensureArrayOfStrings(entry?.allowedUsers)),
          JSON.stringify(ensureArrayOfStrings(entry?.allowedRoles))
        );
      }
    }
  })();
};

/* ------------------------------------------------------------------ */
/*  Plugin trial persistence (survives plugin uninstall/reinstall)     */
/* ------------------------------------------------------------------ */

export const getPluginTrial = (dataDir, pluginName) => {
  const db = getAuthDb(dataDir);
  return db.prepare('SELECT * FROM plugin_trials WHERE plugin_name = ?').get(pluginName) || null;
};

export const upsertPluginTrial = (dataDir, { pluginName, firstInstalledAt, trialExpiresAt, trialSig }) => {
  const db = getAuthDb(dataDir);
  db.prepare(`
    INSERT OR REPLACE INTO plugin_trials (plugin_name, first_installed_at, trial_expires_at, trial_sig)
    VALUES (?, ?, ?, ?)
  `).run(pluginName, firstInstalledAt, trialExpiresAt, trialSig);
};

export const setPluginLicense = (dataDir, pluginName, licenseKey, expiresAt) => {
  const db = getAuthDb(dataDir);
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE plugin_trials SET license_key = ?, license_validated_at = ?, license_expires_at = ?
    WHERE plugin_name = ?
  `).run(licenseKey, now, expiresAt || null, pluginName);
};

export const clearPluginLicense = (dataDir, pluginName) => {
  const db = getAuthDb(dataDir);
  db.prepare(`
    UPDATE plugin_trials SET license_key = NULL, license_validated_at = NULL, license_expires_at = NULL
    WHERE plugin_name = ?
  `).run(pluginName);
};
