import fs from 'fs';
import os from 'os';
import path from 'path';

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
    const expected = plugins.enabled.includes('QtilerAuth') ? '1' : '0';
    console.log(`Update mode: existing QtilerAuth entitlement is still valid (${entitlementStatus}). Enabled state was preserved.`);
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
  enableQtilerAuth();
  const status = entitlementValid ? `new_${entitlementStatus}` : 'new_trial_enabled';
  console.log(entitlementValid
    ? `New install: active QtilerAuth entitlement found (${entitlementStatus}). QtilerAuth was enabled.`
    : 'New install: QtilerAuth was enabled so the first 90-day trial can be created.');
  console.log('QTILERAUTH_EXPECTED=1');
  console.log(`QTILERAUTH_INSTALL_STATUS=${status}`);
}