import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { getMachineFingerprint } from '../lib/machineFingerprint.js';
import { getPluginTrial, upsertPluginTrial } from '../lib/authDb.js';

const root = path.resolve(process.argv[2] || process.cwd());
const mode = String(process.argv[3] || 'new').toLowerCase() === 'update' ? 'update' : 'new';

const dataDir = path.join(root, 'data');
const pluginsFile = path.join(dataDir, 'plugins.json');
const licensesFile = path.join(dataDir, 'licenses.json');
const machineTrialFile = path.join(
  process.env.ProgramData || (process.platform === 'win32' ? 'C:\\ProgramData' : path.join(os.homedir(), '.qtiler')),
  'Qtiler',
  'plugin-trials.json'
);

const readJson = (filePath, fallback) => {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const writePlugins = (plugins) => {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(pluginsFile, JSON.stringify(plugins, null, 2), 'utf8');
};

const writeLicenseStore = (store) => {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(licensesFile, JSON.stringify(store, null, 2), 'utf8');
};

const machineFingerprint = getMachineFingerprint();
const trialSecret = crypto.createHash('sha256')
  .update(`qtiler-plugin-trial|${machineFingerprint}`)
  .digest('hex');

const signTrial = (pluginName, instanceId, startedAt, expiresAt) => crypto
  .createHmac('sha256', trialSecret)
  .update(`${pluginName}|${instanceId}|${startedAt}|${expiresAt}`)
  .digest('hex');

const ensureNewInstallTrial = (store, pluginName) => {
  if (!store.plugins || typeof store.plugins !== 'object') store.plugins = {};
  if (!store.instanceId) store.instanceId = machineFingerprint;
  const entry = store.plugins[pluginName] || {};

  let existing = null;
  try {
    existing = getPluginTrial(dataDir, pluginName);
  } catch {
    existing = null;
  }

  const candidates = [
    entry.trial,
    existing && {
      startedAt: existing.first_installed_at,
      expiresAt: existing.trial_expires_at,
      sig: existing.trial_sig
    },
    readJson(machineTrialFile, null)?.plugins?.[pluginName]
  ].filter(Boolean);
  const current = candidates.find((trial) => isFutureDate(trial.expiresAt));
  const historical = candidates[0] || null;
  const created = !current && !historical;
  const trial = current || historical || (() => {
    const startedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    return { startedAt, expiresAt, sig: signTrial(pluginName, store.instanceId, startedAt, expiresAt) };
  })();

  entry.trial = trial;
  store.plugins[pluginName] = entry;
  writeLicenseStore(store);
  fs.mkdirSync(path.dirname(machineTrialFile), { recursive: true });
  const machineStore = readJson(machineTrialFile, { plugins: {} });
  if (!machineStore.plugins || typeof machineStore.plugins !== 'object') machineStore.plugins = {};
  machineStore.plugins[pluginName] = trial;
  fs.writeFileSync(machineTrialFile, JSON.stringify(machineStore, null, 2), 'utf8');
  try {
    upsertPluginTrial(dataDir, {
      pluginName,
      firstInstalledAt: trial.startedAt,
      trialExpiresAt: trial.expiresAt,
      trialSig: trial.sig
    });
  } catch (err) {
    console.warn(`Could not persist QtilerAuth trial in auth.db: ${err?.message || err}`);
  }
  return { trial, created };
};

const decodeLicensePayload = (licenseKey) => {
  const key = String(licenseKey || '').trim();
  if (!key) return null;
  try {
    let payload = key.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4 !== 0) payload += '=';
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return null;
  }
};

const isFutureDate = (value) => {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) && ms > Date.now();
};

const plugins = readJson(pluginsFile, { enabled: [] });
if (!Array.isArray(plugins.enabled)) plugins.enabled = [];
plugins.enabled = plugins.enabled.filter((item) => String(item || '').trim());

let entitlementValid = false;
let entitlementStatus = 'none';

const store = readJson(licensesFile, null);
const entry = store?.plugins?.QtilerAuth;
if (entry) {
  if (entry.licenseKey) {
    const payload = decodeLicensePayload(entry.licenseKey);
    if (payload?.plugin === 'QtilerAuth' && isFutureDate(payload.expiresAt)) {
      entitlementValid = true;
      entitlementStatus = 'license_active';
    } else {
      entitlementStatus = 'license_expired_or_invalid';
    }
  }
  if (!entitlementValid && entry.trial?.expiresAt) {
    if (isFutureDate(entry.trial.expiresAt)) {
      entitlementValid = true;
      entitlementStatus = 'trial_active';
    } else if (entitlementStatus === 'none') {
      entitlementStatus = 'trial_expired';
    }
  }
}

if (!entitlementValid) {
  const machineStore = readJson(machineTrialFile, null);
  const machineTrial = machineStore?.plugins?.QtilerAuth;
  if (machineTrial?.expiresAt) {
    if (isFutureDate(machineTrial.expiresAt)) {
      entitlementValid = true;
      entitlementStatus = 'machine_trial_active';
    } else if (entitlementStatus === 'none') {
      entitlementStatus = 'machine_trial_expired';
    }
  }
}

const enableQtilerAuth = () => {
  if (!plugins.enabled.includes('QtilerAuth')) plugins.enabled.push('QtilerAuth');
  writePlugins(plugins);
};

const disableQtilerAuth = () => {
  plugins.enabled = plugins.enabled.filter((item) => item !== 'QtilerAuth');
  writePlugins(plugins);
};

if (mode === 'update') {
  if (entitlementValid) {
    // A previous startup/license check may have removed QtilerAuth from
    // plugins.json even though the entitlement is still valid. An update is
    // the right place to repair that stale state; a valid entitlement must
    // not leave the authentication plugin disabled.
    enableQtilerAuth();
    const expected = '1';
    console.log(`Update mode: existing QtilerAuth entitlement is still valid (${entitlementStatus}). QtilerAuth was enabled.`);
    console.log(`QTILERAUTH_EXPECTED=${expected}`);
    console.log(`QTILERAUTH_INSTALL_STATUS=update_${entitlementStatus}`);
  } else {
    disableQtilerAuth();
    console.log(`Update mode: QtilerAuth entitlement is not valid (${entitlementStatus}). QtilerAuth was left disabled and no new trial was issued.`);
    console.log('QTILERAUTH_EXPECTED=0');
    console.log(`QTILERAUTH_INSTALL_STATUS=update_disabled_${entitlementStatus}`);
  }
} else if (/expired|invalid|unreadable/.test(entitlementStatus)) {
  disableQtilerAuth();
  console.log(`New install: previous QtilerAuth trial/license state is not valid (${entitlementStatus}). QtilerAuth was left disabled and no new trial was issued.`);
  console.log('QTILERAUTH_EXPECTED=0');
  console.log(`QTILERAUTH_INSTALL_STATUS=new_disabled_${entitlementStatus}`);
} else {
  if (!entitlementValid) {
    const result = ensureNewInstallTrial(store || { instanceId: machineFingerprint, plugins: {} }, 'QtilerAuth');
    entitlementValid = isFutureDate(result?.trial?.expiresAt);
    entitlementStatus = entitlementValid
      ? (result.created ? 'trial_created' : 'trial_active')
      : 'trial_expired';
  }
  if (!entitlementValid) {
    disableQtilerAuth();
    console.log(`New install: QtilerAuth trial is not valid (${entitlementStatus}). QtilerAuth was left disabled and no new trial was issued.`);
    console.log('QTILERAUTH_EXPECTED=0');
    console.log(`QTILERAUTH_INSTALL_STATUS=new_disabled_${entitlementStatus}`);
    process.exit(0);
  }
  enableQtilerAuth();
  const status = entitlementValid ? `new_${entitlementStatus}` : 'new_trial_enabled';
  console.log(entitlementValid
    ? `New install: active QtilerAuth entitlement found (${entitlementStatus}). QtilerAuth was enabled.`
    : 'New install: QtilerAuth was enabled so the first 90-day trial can be created.');
  console.log('QTILERAUTH_EXPECTED=1');
  console.log(`QTILERAUTH_INSTALL_STATUS=${status}`);
}