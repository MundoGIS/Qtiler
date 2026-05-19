/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

import fs from "fs";
import os from "os";
import path from "path";
import AdmZip from "adm-zip";
import crypto from "crypto";
import { getAuthDb, getPluginTrial, upsertPluginTrial, setPluginLicense } from "../lib/authDb.js";
import { getMachineFingerprint, describeMachineFingerprint } from "../lib/machineFingerprint.js";

// Hard-coded MundoGIS RSA-2048 license verification public key. This ships
// inside the source code (and any installer ZIP) so customers can verify
// signed licenses without ever holding the developer's private key. To rotate
// the keypair, regenerate with `node license-server/generate_keys.js`, copy
// the new public_key.pem contents in here, and re-issue licenses signed by
// the matching new private key.
const DEVELOPER_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvgSPBNK0LnqSofV2fKtQ
LLmsolLd7hego3opGEHrG5k/p1JP1K5Ug42wvonGDTnJMSRnacaUaW7b8A30EA/M
dInGqkCHS4mb9wUjPaub3iGCxS0WU84D61+SNsuy9/N9pp2qnc9wITr1ZOXaaokj
1jDCAuY/UgwslooCv1YtqlXc+gpmXrk19Jh61xJv2Pf5h2W3JQw/Nd7bVmS8UfNG
LV1bB+GctiobKGOH2zLRN5K+o6OjU/EYYAjn1eXSj4G3Eh83XeeeHmWwL8YESknH
Lm0uVlU2kbbXNfn7tkNxf42sKkyRaLJ8QCHp2a/CXC4ItBgo7zdTuZX3uBaathnm
kwIDAQAB
-----END PUBLIC KEY-----
`;

export const registerPluginRoutes = ({
  app,
  pluginManager,
  security,
  pluginsDir,
  dataDir,
  requireAdmin,
  requireAdminIfEnabled,
  applySecurityDefaults,
  pluginUpload,
  sanitizePluginName,
  resolvePluginRoot,
  detectPluginName,
  copyRecursive,
  removeRecursive
}) => {
  const licenseStorePath = path.join(dataDir, 'licenses.json');
  // LICENSE_SECRET is now ONLY used for signing locally-generated trial
  // metadata (so customers can't extend their own trial by editing
  // data/licenses.json). It is NEVER required to verify commercial license
  // keys — those are verified with the embedded RSA public key below.
  // If absent, trial activation timestamps simply aren't tamper-protected.
  const licenseSecret = process.env.LICENSE_SECRET || '';
  // Allow the developer machine to override the embedded key (so we can test
  // a freshly rotated key without rebuilding) and to point at an external
  // PEM file. Customers should leave both unset and rely on DEVELOPER_PUBLIC_KEY.
  const PUBLIC_KEY_PATH = process.env.LICENSE_PUBLIC_KEY_PATH || path.join(process.cwd(), 'tools', 'licenses', 'public_key.pem');
  let licensePublicKey = DEVELOPER_PUBLIC_KEY;
  try {
    if (process.env.LICENSE_PUBLIC_KEY) {
      licensePublicKey = process.env.LICENSE_PUBLIC_KEY;
    } else if (fs.existsSync(PUBLIC_KEY_PATH)) {
      // Only override if the file is a valid key — silently keep the embedded
      // one otherwise (prevents an empty/corrupt file from breaking verify).
      try {
        const candidate = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
        crypto.createPublicKey(candidate); // throws if invalid
        licensePublicKey = candidate;
      } catch { /* keep embedded */ }
    }
  } catch (err) {
    licensePublicKey = DEVELOPER_PUBLIC_KEY;
  }
  // When set to "1"/"true", verifyLicenseKey() also accepts HMAC-signed keys
  // using LICENSE_SECRET (legacy behaviour). This is intended for the
  // developer machine during migration only — DO NOT enable on customer
  // installs, otherwise anyone with the .env can forge licenses.
  const allowHmacLegacy = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.LICENSE_ALLOW_HMAC_LEGACY || '').toLowerCase()
  );

  const trialTamperWarning = 'Trial license data appears to be illegally modified. This action is illegal. The plugin will be removed. Please purchase a valid license from MundoGIS.';
  // Plugins listed here require a commercial license issued by MundoGIS.
  // Plugins NOT listed here are open source (MPL-2.0) and the licensing UI
  // (price tag, "Request license" button, "Add license key" button) is
  // hidden because /licenses/status only iterates Object.keys(pricing).
  const pricing = {
    QtilerAuth: { price: 250, currency: 'EUR', period: 'year' }
  };

  const loadLicenseStore = () => {
    try {
      if (!fs.existsSync(licenseStorePath)) {
        return { instanceId: null, plugins: {} };
      }
      const raw = fs.readFileSync(licenseStorePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return { instanceId: null, plugins: {} };
      if (!parsed.plugins || typeof parsed.plugins !== 'object') parsed.plugins = {};
      if (!Array.isArray(parsed.securityWarnings)) parsed.securityWarnings = [];
      return parsed;
    } catch {
      return { instanceId: null, plugins: {}, securityWarnings: [] };
    }
  };

  const saveLicenseStore = (store) => {
    try {
      fs.mkdirSync(path.dirname(licenseStorePath), { recursive: true });
      fs.writeFileSync(licenseStorePath, JSON.stringify(store, null, 2), 'utf8');
    } catch (err) {
      console.warn('[licenses] Failed to save license store', err?.message || err);
    }
  };

  // The instanceId is now derived from a stable hardware/OS fingerprint
  // (see lib/machineFingerprint.js). The first call also persists the value
  // and stores any legacy random id under `legacyInstanceId` so old
  // commercial licenses keep validating during the migration period.
  const ensureInstanceId = (store) => {
    const fp = getMachineFingerprint();
    if (store.instanceId !== fp) {
      if (store.instanceId && store.instanceId !== fp && !store.legacyInstanceId) {
        store.legacyInstanceId = store.instanceId;
      }
      store.instanceId = fp;
      saveLicenseStore(store);
    }
    return fp;
  };

  const base64urlToBase64 = (s) => {
    // convert base64url to base64
    let out = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = out.length % 4;
    if (pad === 2) out += '==';
    else if (pad === 3) out += '=';
    else if (pad !== 0) out += '===';
    return out;
  };

  const verifyLicenseKey = (key) => {
    try {
      const parts = String(key || '').split('.');
      if (parts.length !== 2) return null;
      const payloadB64 = parts[0];
      const signature = parts[1];

      // Try public-key (RSA) verification first if public key available
      if (licensePublicKey) {
        try {
          const sigB64 = base64urlToBase64(signature);
          const verifier = crypto.createVerify('sha256');
          verifier.update(payloadB64);
          verifier.end();
          const ok = verifier.verify(licensePublicKey, sigB64, 'base64');
          if (ok) {
            const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
            const payload = JSON.parse(payloadJson);
            return payload && typeof payload === 'object' ? payload : null;
          }
        } catch (err) {
          // fallthrough to HMAC fallback
        }
      }

      // Fallback: HMAC with LICENSE_SECRET. SECURITY: only enabled when the
      // operator explicitly opts in via LICENSE_ALLOW_HMAC_LEGACY=1, because
      // any customer holding both the .env LICENSE_SECRET and a single valid
      // license could otherwise forge new ones. Off by default.
      if (allowHmacLegacy && licenseSecret) {
        const expected = crypto.createHmac('sha256', licenseSecret).update(payloadB64).digest('base64url');
        if (signature === expected) {
          const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
          const payload = JSON.parse(payloadJson);
          return payload && typeof payload === 'object' ? payload : null;
        }
      }

      return null;
    } catch {
      return null;
    }
  };

  // Check whether a verified license payload is bound to THIS server.
  // Modern licenses carry payload.machineFingerprint (RSA-signed and tied to
  // the OS/hardware); legacy licenses only carry payload.instanceId. Trial
  // licenses are NOT machine-bound by design.
  const isLicenseBoundToThisMachine = (payload, store) => {
    if (!payload || payload.trial) return true;
    const fp = getMachineFingerprint();
    if (payload.machineFingerprint) {
      return String(payload.machineFingerprint).toLowerCase() === fp;
    }
    if (payload.instanceId) {
      const id = String(payload.instanceId);
      if (id === store.instanceId) return true;
      if (store.legacyInstanceId && id === store.legacyInstanceId) return true;
      return false;
    }
    // No binding info at all → reject for safety.
    return false;
  };

  const signTrial = (pluginName, instanceId, startedAt, expiresAt) => {
    if (!licenseSecret) return null;
    const raw = `${pluginName || ''}|${instanceId || ''}|${startedAt || ''}|${expiresAt || ''}`;
    return crypto.createHmac('sha256', licenseSecret).update(raw).digest('hex');
  };

  const verifyTrialSignature = (pluginName, instanceId, trial) => {
    if (!trial || !trial.sig || !licenseSecret) return false;
    const expected = signTrial(pluginName, instanceId, trial.startedAt, trial.expiresAt);
    return expected === trial.sig;
  };

  const signTrialActivation = (pluginName, instanceId, activatedAt) => {
    if (!licenseSecret) return null;
    const raw = `${pluginName || ''}|${instanceId || ''}|${activatedAt || ''}`;
    return crypto.createHmac('sha256', licenseSecret).update(raw).digest('hex');
  };

  const verifyTrialActivation = (pluginName, instanceId, activatedAt, sig) => {
    if (!activatedAt || !sig || !licenseSecret) return false;
    const expected = signTrialActivation(pluginName, instanceId, activatedAt);
    return expected === sig;
  };

  const ensureTrial = (store, pluginName) => {
    if (!store.plugins[pluginName]) store.plugins[pluginName] = {};
    const entry = store.plugins[pluginName];

    // Check auth.db first — trials there survive uninstall/reinstall
    try {
      const dbTrial = getPluginTrial(dataDir, pluginName);
      if (dbTrial) {
        // Restore trial into the JSON store from the persistent DB record
        if (!entry.trial || entry.trial.startedAt !== dbTrial.first_installed_at) {
          entry.trial = {
            startedAt: dbTrial.first_installed_at,
            expiresAt: dbTrial.trial_expires_at,
            sig: dbTrial.trial_sig
          };
          saveLicenseStore(store);
        }
        return entry.trial;
      }
    } catch (err) {
      console.warn('[licenses] Failed to read trial from auth.db', err?.message || err);
    }

    if (!entry.trial) {
      const startedAt = new Date().toISOString();
      const trialEnds = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const sig = signTrial(pluginName, store.instanceId, startedAt, trialEnds);
      entry.trial = { startedAt, expiresAt: trialEnds, sig };
      saveLicenseStore(store);
    }

    // Persist to auth.db so it survives uninstall/reinstall
    try {
      const existing = getPluginTrial(dataDir, pluginName);
      if (!existing && entry.trial) {
        upsertPluginTrial(dataDir, {
          pluginName,
          firstInstalledAt: entry.trial.startedAt,
          trialExpiresAt: entry.trial.expiresAt,
          trialSig: entry.trial.sig
        });
      }
    } catch (err) {
      console.warn('[licenses] Failed to persist trial to auth.db', err?.message || err);
    }
    return entry.trial;
  };

  const getLicenseStatus = (store, pluginName) => {
    const entry = store.plugins[pluginName] || {};
    const now = Date.now();
    let status = 'trial';
    let expiresAt = null;
    let daysLeft = null;

    if (entry.licenseKey) {
      const payload = verifyLicenseKey(entry.licenseKey);
      if (!payload || payload.plugin !== pluginName) {
        status = 'expired';
        daysLeft = 0;
        return { status, expiresAt: null, daysLeft };
      }
      const isTrial = !!payload.trial;
      let effectiveExpiresAt = payload.expiresAt || null;
      if (isTrial && !effectiveExpiresAt) {
        if (!store.plugins[pluginName]) store.plugins[pluginName] = {};
        const nowIso = new Date().toISOString();
        const nowMs = Date.now();
        const activationMs = Date.parse(entry.trialActivatedAt || '');
        const activationValid = verifyTrialActivation(pluginName, store.instanceId, entry.trialActivatedAt, entry.trialActivatedAtSig);
        if (!entry.trialActivatedAt || !activationValid || !Number.isFinite(activationMs) || activationMs > (nowMs + 5 * 60 * 1000)) {
          entry.trialActivatedAt = nowIso;
          entry.trialActivatedAtSig = signTrialActivation(pluginName, store.instanceId, entry.trialActivatedAt);
          saveLicenseStore(store);
        }
        const base = Date.parse(entry.trialActivatedAt || payload.issuedAt || '');
        const minutes = Number(payload.trialDurationMinutes || 0);
        const td = Number(payload.trialDays || 0);
        const durationMs = (Number.isFinite(minutes) && minutes > 0)
          ? minutes * 60 * 1000
          : (Number.isFinite(td) && td > 0 ? td * 24 * 60 * 60 * 1000 : 0);
        if (Number.isFinite(base) && durationMs > 0) {
          effectiveExpiresAt = new Date(base + durationMs).toISOString();
        }
      }
      if (!effectiveExpiresAt) {
        status = 'expired';
        daysLeft = 0;
        return { status, expiresAt: null, daysLeft };
      }
      if (!isTrial && !isLicenseBoundToThisMachine(payload, store)) {
        status = 'expired';
        daysLeft = 0;
        return { status, expiresAt: effectiveExpiresAt, daysLeft, license: payload, reason: 'machine_mismatch' };
      }
      expiresAt = effectiveExpiresAt;
      const expMs = Date.parse(effectiveExpiresAt);
      const startMs = payload.startsAt ? Date.parse(payload.startsAt) : null;
      if (Number.isFinite(expMs)) {
        if (expMs > now) {
          if (Number.isFinite(startMs) && startMs > now) {
            status = 'trial';
          } else {
            status = isTrial ? 'trial' : 'active';
          }
          daysLeft = Math.ceil((expMs - now) / (24 * 60 * 60 * 1000));
          return { status, expiresAt, daysLeft, license: payload };
        }
        status = 'expired';
        daysLeft = 0;
        return { status, expiresAt, daysLeft, license: payload };
      }
    }

    if (entry.trial && !verifyTrialSignature(pluginName, store.instanceId, entry.trial)) {
      status = 'expired';
      daysLeft = 0;
      return { status, expiresAt: null, daysLeft, code: 'trial_tampered', warning: trialTamperWarning };
    }

    const trial = ensureTrial(store, pluginName);
    expiresAt = trial?.expiresAt || null;
    const expMs = expiresAt ? Date.parse(expiresAt) : null;
    if (expMs && expMs > now) {
      status = 'trial';
      daysLeft = Math.ceil((expMs - now) / (24 * 60 * 60 * 1000));
      return { status, expiresAt, daysLeft };
    }

    status = 'expired';
    daysLeft = 0;
    return { status, expiresAt, daysLeft };
  };

  const applyLicenseKeyForInstall = (store, pluginName, licenseKey) => {
    const key = String(licenseKey || '').trim();
    if (!key) return false;
    const payload = verifyLicenseKey(key);
    if (!payload || payload.plugin !== pluginName) {
      throw Object.assign(new Error('license_invalid'), { statusCode: 400, code: 'license_invalid' });
    }
    ensureInstanceId(store);
    if (!payload.trial && !isLicenseBoundToThisMachine(payload, store)) {
      throw Object.assign(new Error('license_instance_mismatch'), { statusCode: 400, code: 'license_instance_mismatch' });
    }
    let expMs = Date.parse(payload.expiresAt || '');
    if (!Number.isFinite(expMs) && payload.trial) {
      if (!store.plugins[pluginName]) store.plugins[pluginName] = {};
      if (!store.plugins[pluginName].trialActivatedAt) {
        store.plugins[pluginName].trialActivatedAt = new Date().toISOString();
        store.plugins[pluginName].trialActivatedAtSig = signTrialActivation(pluginName, store.instanceId, store.plugins[pluginName].trialActivatedAt);
        saveLicenseStore(store);
      } else if (!verifyTrialActivation(pluginName, store.instanceId, store.plugins[pluginName].trialActivatedAt, store.plugins[pluginName].trialActivatedAtSig)) {
        store.plugins[pluginName].trialActivatedAt = new Date().toISOString();
        store.plugins[pluginName].trialActivatedAtSig = signTrialActivation(pluginName, store.instanceId, store.plugins[pluginName].trialActivatedAt);
        saveLicenseStore(store);
      }
      const base = Date.parse(store.plugins[pluginName].trialActivatedAt || payload.issuedAt || '');
      const minutes = Number(payload.trialDurationMinutes || 0);
      const td = Number(payload.trialDays || 0);
      const durationMs = (Number.isFinite(minutes) && minutes > 0)
        ? minutes * 60 * 1000
        : (Number.isFinite(td) && td > 0 ? td * 24 * 60 * 60 * 1000 : 0);
      if (Number.isFinite(base) && durationMs > 0) {
        expMs = base + durationMs;
      }
    }
    const startMs = payload.startsAt ? Date.parse(payload.startsAt) : null;
    const now = Date.now();
    if (!Number.isFinite(expMs) || expMs <= now) {
      throw Object.assign(new Error('license_expired'), { statusCode: 400, code: 'license_expired' });
    }
    if (Number.isFinite(startMs) && startMs > now) {
      throw Object.assign(new Error('license_not_started'), { statusCode: 400, code: 'license_not_started' });
    }
    if (!store.plugins[pluginName]) store.plugins[pluginName] = {};
    store.plugins[pluginName].licenseKey = key;
    saveLicenseStore(store);
    return true;
  };

  const enforceLicenses = async () => {
    const store = loadLicenseStore();
    ensureInstanceId(store);
    const enabled = pluginManager.listEnabled();
    for (const pluginName of enabled) {
      if (!pricing[pluginName]) continue;
      const status = getLicenseStatus(store, pluginName);
      if (status.status === 'expired') {
        try {
          await pluginManager.disablePlugin(pluginName);
        } catch (err) {
          console.warn(`[licenses] Failed to disable expired plugin ${pluginName}`, err?.message || err);
        }
        try {
          const pluginPath = path.join(pluginsDir, pluginName);
          if (fs.existsSync(pluginPath)) {
            await removeRecursive(pluginPath);
          }
        } catch (err) {
          console.warn(`[licenses] Failed to remove expired plugin ${pluginName}`, err?.message || err);
        }
      }
    }
  };
  const requestClusterRestart = () => {
    try {
      if (typeof process.send === 'function') {
        process.send({ cmd: 'restartAllWorkers' });
      } else {
        process.exit(0);
      }
    } catch (err) {
      console.warn('[plugins] Failed to request cluster restart', err);
      try { process.exit(0); } catch (_) { /* noop */ }
    }
  };
  const restartAfterResponse = (res, delayMs = 250) => {
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        // Restart once the response is flushed to avoid client-side ERR_CONNECTION_RESET.
        requestClusterRestart();
        setTimeout(() => process.exit(0), 150);
      }, Math.max(0, Number(delayMs) || 0));
    };

    res.once('finish', schedule);
    res.once('close', () => {
      if (res.writableEnded) schedule();
    });
  };
  // Allow non-admin access to plugins list if no auth plugin is enabled (to install first plugin)
  app.get("/plugins", async (req, res) => {
    if (security.isEnabled && security.isEnabled()) {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    try {
      await enforceLicenses();
      let installed = [];
      try {
        const entries = await fs.promises.readdir(pluginsDir, { withFileTypes: true });
        installed = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
      } catch (dirErr) {
        if (dirErr.code !== "ENOENT") throw dirErr;
      }
      const installedSet = new Set(installed);
      const enabled = pluginManager.listEnabled();

      for (const name of enabled) {
        if (!installedSet.has(name)) {
          try {
            await pluginManager.disablePlugin(name);
            console.warn(`[Qtiler] Disabled missing plugin '${name}' (directory not found).`);
          } catch (disableErr) {
            console.warn(`[Qtiler] Failed to disable missing plugin '${name}':`, disableErr);
          }
        }
      }

      if (pluginManager.listEnabled().length === 0) {
        applySecurityDefaults();
      }

      const store = loadLicenseStore();
      ensureInstanceId(store);
      const licenses = {};
      const meta = {};
      for (const name of installed) {
        if (!pricing[name]) continue;
        const status = getLicenseStatus(store, name);
        licenses[name] = {
          status: status.status,
          expiresAt: status.expiresAt,
          daysLeft: status.daysLeft,
          warning: status.warning || null,
          pricing: pricing[name]
        };
      }

      for (const name of installed) {
        try {
          const pluginJsonPath = path.join(pluginsDir, name, 'plugin.json');
          if (!fs.existsSync(pluginJsonPath)) continue;
          const raw = await fs.promises.readFile(pluginJsonPath, 'utf8');
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== 'object') continue;
          meta[name] = {
            displayName: String(parsed.displayName || name),
            description: String(parsed.description || ''),
            docs: parsed.docs && typeof parsed.docs === 'object' ? parsed.docs : null
          };
        } catch {
          // Non-fatal: plugin list should still load even if one manifest is malformed.
        }
      }

      res.json({ installed, enabled: pluginManager.listEnabled(), licenses, instanceId: store.instanceId, securityWarnings: store.securityWarnings || [], meta });
    } catch (err) {
      res.status(500).json({ error: "plugin_list_failed", details: String(err) });
    }
  });

  // Returns everything MundoGIS needs to issue a commercial license for THIS
  // server: the hardware fingerprint (used as instanceId), some non-secret
  // descriptive info, and the requested plugin. The customer downloads/copies
  // this JSON from the admin UI and sends it to support; MundoGIS pastes it
  // into the license-server UI which signs it with the private RSA key.
  app.get('/licenses/request-info', requireAdminIfEnabled, (req, res) => {
    const store = loadLicenseStore();
    ensureInstanceId(store);
    const plugin = sanitizePluginName(req.query?.plugin || '');
    const desc = describeMachineFingerprint();
    const knownPlugins = Object.keys(pricing);
    res.json({
      plugin: plugin || null,
      knownPlugins,
      machineFingerprint: desc.fingerprint,
      instanceId: store.instanceId,
      legacyInstanceId: store.legacyInstanceId || null,
      hostname: desc.hostname,
      platform: desc.platform,
      arch: desc.arch,
      requestedAt: new Date().toISOString(),
      productVersion: process.env.QTILER_VERSION || null
    });
  });

  app.get('/licenses/status', requireAdminIfEnabled, (req, res) => {
    const store = loadLicenseStore();
    ensureInstanceId(store);
    const out = {
      instanceId: store.instanceId,
      plugins: {}
    };
    Object.keys(pricing).forEach((name) => {
      const status = getLicenseStatus(store, name);
      out.plugins[name] = {
        status: status.status,
        expiresAt: status.expiresAt,
        daysLeft: status.daysLeft,
        warning: status.warning || null,
        pricing: pricing[name]
      };
    });
    out.securityWarnings = store.securityWarnings || [];
    res.json(out);
  });

  app.post('/licenses/activate', requireAdminIfEnabled, (req, res) => {
    const pluginName = sanitizePluginName(req.body?.plugin || req.body?.name || '');
    const licenseKey = String(req.body?.licenseKey || '').trim();
    if (!pluginName || !pricing[pluginName]) {
      return res.status(400).json({ error: 'invalid_plugin' });
    }
    if (!licenseKey) {
      return res.status(400).json({ error: 'license_key_required' });
    }
    const payload = verifyLicenseKey(licenseKey);
    if (!payload || payload.plugin !== pluginName) {
      return res.status(400).json({ error: 'license_invalid' });
    }
    const store = loadLicenseStore();
    ensureInstanceId(store);
    if (!payload.trial && !isLicenseBoundToThisMachine(payload, store)) {
      return res.status(400).json({ error: 'license_instance_mismatch' });
    }
    let expMs = Date.parse(payload.expiresAt || '');
    if (!Number.isFinite(expMs) && payload.trial) {
      if (!store.plugins[pluginName]) store.plugins[pluginName] = {};
      if (!store.plugins[pluginName].trialActivatedAt) {
        store.plugins[pluginName].trialActivatedAt = new Date().toISOString();
        store.plugins[pluginName].trialActivatedAtSig = signTrialActivation(pluginName, store.instanceId, store.plugins[pluginName].trialActivatedAt);
        saveLicenseStore(store);
      } else if (!verifyTrialActivation(pluginName, store.instanceId, store.plugins[pluginName].trialActivatedAt, store.plugins[pluginName].trialActivatedAtSig)) {
        store.plugins[pluginName].trialActivatedAt = new Date().toISOString();
        store.plugins[pluginName].trialActivatedAtSig = signTrialActivation(pluginName, store.instanceId, store.plugins[pluginName].trialActivatedAt);
        saveLicenseStore(store);
      }
      const base = Date.parse(store.plugins[pluginName].trialActivatedAt || payload.issuedAt || '');
      const minutes = Number(payload.trialDurationMinutes || 0);
      const td = Number(payload.trialDays || 0);
      const durationMs = (Number.isFinite(minutes) && minutes > 0)
        ? minutes * 60 * 1000
        : (Number.isFinite(td) && td > 0 ? td * 24 * 60 * 60 * 1000 : 0);
      if (Number.isFinite(base) && durationMs > 0) {
        expMs = base + durationMs;
      }
    }
    const startMs = payload.startsAt ? Date.parse(payload.startsAt) : null;
    const now = Date.now();
    if (!Number.isFinite(expMs) || expMs <= now) {
      return res.status(400).json({ error: 'license_expired' });
    }
    if (Number.isFinite(startMs) && startMs > now) {
      return res.status(400).json({ error: 'license_not_started' });
    }
    if (!store.plugins[pluginName]) store.plugins[pluginName] = {};
    store.plugins[pluginName].licenseKey = licenseKey;
    saveLicenseStore(store);

    res.json({ status: 'ok' });
  });

  /* 
   * Manual enable/disable routes removed to enforce auto-enable on install 
   * and auto-disable on uninstall workflow.
   */
  /*
  app.post("/plugins/:name/enable", requireAdminIfEnabled, async (req, res) => {
    // ...
  });

  app.post("/plugins/:name/disable", requireAdmin, async (req, res) => {
    // ...
  });
  */

  app.delete("/plugins/:name", requireAdmin, async (req, res) => {
    const raw = req.params.name;
    const pluginName = sanitizePluginName(raw);
    if (!pluginName) {
      return res.status(400).json({ error: "plugin_name_required" });
    }
    const pluginPath = path.join(pluginsDir, pluginName);
    const pluginDataPath = path.join(dataDir, pluginName);
    const exists = fs.existsSync(pluginPath);
    const wasEnabled = pluginManager.listEnabled().includes(pluginName);
    try {
      if (wasEnabled) {
        await pluginManager.disablePlugin(pluginName);
      }
    } catch (disableErr) {
      return res.status(500).json({ error: "plugin_disable_failed", details: String(disableErr?.message || disableErr) });
    }

    let removedFiles = false;
    if (exists) {
      try {
        await removeRecursive(pluginPath);
        removedFiles = true;
      } catch (rmErr) {
        return res.status(500).json({ error: "plugin_remove_failed", details: String(rmErr?.message || rmErr) });
      }
    }

    let removedData = false;
    if (req.query.keepData !== "1") {
      try {
        await removeRecursive(pluginDataPath);
        removedData = true;
      } catch (rmDataErr) {
        if (rmDataErr?.code !== "ENOENT") {
          return res.status(500).json({ error: "plugin_data_remove_failed", details: String(rmDataErr?.message || rmDataErr) });
        }
      }
    }

    const removedCachePaths = [];
    if (pluginName === 'WmsCache' && req.query.keepData !== "1") {
      const cacheCandidates = [
        path.join(process.cwd(), 'cache', 'external-wms'),
        path.join(process.cwd(), 'cache', '_external_wms'),
        path.join(process.cwd(), 'cache', 'wmscache')
      ];
      for (const cachePath of cacheCandidates) {
        try {
          await removeRecursive(cachePath);
          removedCachePaths.push(cachePath);
        } catch (rmCacheErr) {
          if (rmCacheErr?.code !== 'ENOENT') {
            return res.status(500).json({ error: 'plugin_cache_remove_failed', details: String(rmCacheErr?.message || rmCacheErr) });
          }
        }
      }
    }
    if (pluginName === 'VectorTiles' && req.query.keepData !== "1") {
      const cacheCandidates = [
        path.join(process.cwd(), 'cache', 'vector-tiles')
      ];
      for (const cachePath of cacheCandidates) {
        try {
          await removeRecursive(cachePath);
          removedCachePaths.push(cachePath);
        } catch (rmCacheErr) {
          if (rmCacheErr?.code !== 'ENOENT') {
            return res.status(500).json({ error: 'plugin_cache_remove_failed', details: String(rmCacheErr?.message || rmCacheErr) });
          }
        }
      }
    }

    if (!wasEnabled && !exists) {
      return res.status(404).json({ error: "plugin_not_found" });
    }

    if (pluginManager.listEnabled().length === 0) {
      applySecurityDefaults();
      // Force reset of security object if it was modified by a plugin but not fully restored
      if (typeof security.isEnabled === 'function' && security.isEnabled()) {
         console.warn('[Qtiler] Security still enabled after uninstalling all plugins. Forcing reset.');
         applySecurityDefaults();
      }
    }

    // Remove license entry for the plugin
    try {
      const store = loadLicenseStore();
      if (store && store.plugins && Object.prototype.hasOwnProperty.call(store.plugins, pluginName)) {
        delete store.plugins[pluginName];
        saveLicenseStore(store);
      }
    } catch (e) {
      console.warn('[licenses] Failed to cleanup license entry', e?.message || e);
    }

    res.json({
      status: "uninstalled",
      plugin: {
        name: pluginName,
        wasEnabled,
        removedFiles,
        removedData,
        removedCachePaths
      }
    });

    // Restart only after the response is delivered to prevent connection reset in the browser.
    restartAfterResponse(res);
  });

  app.post("/plugins/upload", requireAdminIfEnabled, (req, res) => {
    pluginUpload.single("plugin")(req, res, async (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "plugin_archive_too_large" });
        }
        if (err.code === "UNSUPPORTED_PLUGIN_ARCHIVE") {
          return res.status(400).json({ error: "unsupported_plugin_archive" });
        }
        return res.status(500).json({ error: "plugin_upload_failed", details: String(err) });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "plugin_archive_required" });
      }

      let tempDir = null;
      try {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qtiler-plugin-"));
        const extractDir = path.join(tempDir, "extract");
        await fs.promises.mkdir(extractDir, { recursive: true });

        try {
          if (!file.path) {
            throw Object.assign(new Error("plugin_upload_missing"), { statusCode: 500, code: "PLUGIN_UPLOAD_MISSING" });
          }
          const zip = new AdmZip(file.path);
          zip.extractAllTo(extractDir, true);
        } catch (zipErr) {
          throw Object.assign(new Error("plugin_archive_invalid"), { statusCode: 400, code: "PLUGIN_ARCHIVE_INVALID", details: zipErr.message });
        }

        const pluginRoot = await resolvePluginRoot(extractDir);

        try {
          await fs.promises.access(path.join(pluginRoot, "index.js"), fs.constants.R_OK);
        } catch {
          throw Object.assign(new Error("plugin_entry_missing"), { statusCode: 400, code: "PLUGIN_ENTRY_MISSING" });
        }

        const provided = sanitizePluginName(req.body?.pluginName || req.body?.name || "");
        const inferredName = await detectPluginName(pluginRoot, provided || path.basename(pluginRoot));
        const pluginName = sanitizePluginName(inferredName || provided || path.basename(pluginRoot) || "");
        if (!pluginName) {
          throw Object.assign(new Error("plugin_name_required"), { statusCode: 400, code: "PLUGIN_NAME_REQUIRED" });
        }

        if (pricing[pluginName]) {
          const store = loadLicenseStore();
          ensureInstanceId(store);
          const providedLicenseKey = String(req.body?.licenseKey || '').trim();
          if (providedLicenseKey) {
            applyLicenseKeyForInstall(store, pluginName, providedLicenseKey);
          }
          const status = getLicenseStatus(store, pluginName);
          if (status.status === 'expired') {
            throw Object.assign(new Error('license_required'), { statusCode: 400, code: 'license_required' });
          }
        }

        const destination = path.join(pluginsDir, pluginName);

        // If plugin is already enabled or installed, disable and remove old files before replacing
        const wasEnabled = pluginManager.listEnabled().includes(pluginName);
        if (wasEnabled) {
          try {
            await pluginManager.disablePlugin(pluginName);
          } catch (disableErr) {
            throw Object.assign(disableErr, { statusCode: 500, code: "PLUGIN_DISABLE_FAILED" });
          }
        }
        await removeRecursive(destination);
        await copyRecursive(pluginRoot, destination);

        try {
          await pluginManager.enablePlugin(pluginName);
        } catch (loadErr) {
          await removeRecursive(destination).catch(() => { });
          throw Object.assign(loadErr, { statusCode: 500, code: "PLUGIN_ENABLE_FAILED" });
        }

        // Ensure trial on first install
        try {
          const store = loadLicenseStore();
          ensureInstanceId(store);
          if (pricing[pluginName]) {
            ensureTrial(store, pluginName);
          }
        } catch {}

        const response = { status: "enabled", plugin: { name: pluginName } };
        res.status(201).json(response);
        // Restart only after the response is delivered to prevent connection reset in the browser.
        restartAfterResponse(res);
        return;
      } catch (uploadErr) {
        const statusCode = uploadErr.statusCode && Number.isInteger(uploadErr.statusCode) ? uploadErr.statusCode : 500;
        const code = uploadErr.code || "PLUGIN_UPLOAD_FAILED";
        const details = uploadErr.details || uploadErr.message || String(uploadErr);
        return res.status(statusCode).json({ error: code, details });
      } finally {
        if (file?.path) {
          try {
            await fs.promises.unlink(file.path);
          } catch {
            // ignore cleanup errors
          }
        }
        if (tempDir) {
          await removeRecursive(tempDir).catch(() => { });
        }
      }
    });
  });
};
