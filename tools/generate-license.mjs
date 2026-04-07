import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const envPath = path.join(projectRoot, '.env');

dotenv.config({ path: envPath });

const ensureLicenseSecret = () => {
  const current = process.env.LICENSE_SECRET || '';
  if (current && current !== 'CHANGE_ME') return current;

  const generated = crypto.randomBytes(32).toString('hex');
  process.env.LICENSE_SECRET = generated;
  try {
    if (fs.existsSync(envPath)) {
      const raw = fs.readFileSync(envPath, 'utf8');
      if (/^\s*LICENSE_SECRET\s*=/.test(raw)) {
        const updated = raw.replace(/^\s*LICENSE_SECRET\s*=.*$/m, `LICENSE_SECRET=${generated}`);
        fs.writeFileSync(envPath, updated, 'utf8');
      } else {
        const newline = raw.endsWith('\n') ? '' : '\n';
        fs.writeFileSync(envPath, `${raw}${newline}LICENSE_SECRET=${generated}\n`, 'utf8');
      }
    } else {
      fs.writeFileSync(envPath, `LICENSE_SECRET=${generated}\n`, 'utf8');
    }
  } catch (err) {
    console.warn('[licenses] Failed to persist LICENSE_SECRET', err?.message || err);
  }

  return generated;
};

const args = process.argv.slice(2);
const getArg = (key) => {
  const idx = args.indexOf(`--${key}`);
  if (idx === -1) return null;
  return args[idx + 1] || null;
};

const plugin = getArg('plugin');
const instanceId = getArg('instance');
const company = getArg('company');
const name = getArg('name');
const email = getArg('email');
const startsAt = getArg('starts');
const expiresAt = getArg('expires');
const trialArg = getArg('trial');
const trialDaysArg = getArg('trial_days');

const secret = ensureLicenseSecret();
if (!secret) {
  console.error('LICENSE_SECRET is not set in environment.');
  process.exit(1);
}

const ask = async (rl, question, fallback = '') => new Promise((resolve) => {
  const q = fallback ? `${question} [${fallback}]: ` : `${question}: `;
  rl.question(q, (answer) => resolve(answer?.trim() || fallback));
});

const askOptional = async (rl, question, fallback = '') => new Promise((resolve) => {
  const q = fallback ? `${question} [${fallback}]: ` : `${question} (optional): `;
  rl.question(q, (answer) => resolve((answer ?? '').trim()));
});

const parseYesNo = (value, fallback = false) => {
  if (value === null || value === undefined || value === '') return fallback;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 't', 'yes', 'y', 'si', 'sí'].includes(v)) return true;
  if (['0', 'false', 'f', 'no', 'n'].includes(v)) return false;
  return fallback;
};

const parsePositiveInt = (value, fallback = null) => {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return i > 0 ? i : fallback;
};

const parseDurationToMinutes = (value, fallbackMinutes = null) => {
  if (value == null || value === '') return fallbackMinutes;
  const raw = String(value).trim().toLowerCase();
  const match = raw.match(/^(\d+(?:\.\d+)?)([mhd])?$/);
  if (!match) return fallbackMinutes;
  const num = Number(match[1]);
  if (!Number.isFinite(num) || num <= 0) return fallbackMinutes;
  const unit = match[2] || 'd';
  if (unit === 'm') return Math.round(num);
  if (unit === 'h') return Math.round(num * 60);
  return Math.round(num * 24 * 60);
};

const parseStockholmLocal = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  const str = String(value).trim();
  const hasTimezone = /([zZ]|[+-]\d\d:\d\d)$/.test(str);
  if (hasTimezone) {
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const cleaned = str.replace('T', ' ');
  const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, y, m, d, h, min] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(min);

  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = Object.fromEntries(fmt.formatToParts(utcGuess).map((p) => [p.type, p.value]));
  const asLocal = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  const diffMs = desired - asLocal;
  return new Date(utcGuess.getTime() + diffMs);
};

const formatStockholmLocal = (date) => {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
};

const formatStockholmIso = (date) => {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const localAsUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  const offsetMs = localAsUTC - date.getTime();
  const offsetTotalMinutes = Math.round(offsetMs / 60000);
  const sign = offsetTotalMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetTotalMinutes);
  const offH = String(Math.floor(absMinutes / 60)).padStart(2, '0');
  const offM = String(absMinutes % 60).padStart(2, '0');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${offH}:${offM}`;
};

const toIso = (value, fallbackDate = null) => {
  if (!value && fallbackDate) {
    const d = fallbackDate instanceof Date ? fallbackDate : parseStockholmLocal(fallbackDate);
    return d ? formatStockholmIso(d) : null;
  }
  if (!value) return null;
  if (value instanceof Date) return formatStockholmIso(value);
  const d = parseStockholmLocal(value);
  return d ? formatStockholmIso(d) : null;
};

const run = async () => {
  let p = plugin;
  let inst = instanceId;
  let comp = company;
  let nm = name;
  let em = email;
  let start = startsAt;
  let exp = expiresAt;
  let trial = false;
  let trialDurationMinutes = parseDurationToMinutes(trialDaysArg, 90 * 24 * 60);

  const trialSpecified = args.includes('--trial') || trialArg !== null;
  if (trialSpecified) {
    trial = args.includes('--trial') && trialArg === null ? true : parseYesNo(trialArg, false);
  }

  const needsProdFields = !trial && (!inst || !comp || !em);
  const needsTrialDays = trial && !trialDurationMinutes;
  if (!trialSpecified || !p || (!trial && (!exp || !start)) || needsProdFields || needsTrialDays) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (!trialSpecified) {
        const trialAnswer = await ask(rl, 'Trial license? (yes/no)', trial ? 'yes' : 'no');
        trial = parseYesNo(trialAnswer, false);
      }
      p = await ask(rl, 'Plugin (Qrigo/Origo/QtilerAuth/ProjectSearch)', p || 'Qrigo');
      if (trial) {
        const td = await ask(rl, 'Trial duration (e.g. 3m, 12h, 90d)', '90d');
        trialDurationMinutes = parseDurationToMinutes(td, trialDurationMinutes || 90 * 24 * 60);
        const trialStart = await askOptional(rl, 'Trial start (YYYY-MM-DD HH:mm) [Stockholm]');
        if (trialStart) {
          start = trialStart;
          const startParsed = parseStockholmLocal(start) || new Date();
          const expDate = new Date(startParsed.getTime() + (Number(trialDurationMinutes) || 90 * 24 * 60) * 60 * 1000);
          exp = formatStockholmLocal(expDate);
        } else {
          start = null;
          exp = null;
        }
      } else {
        start = await ask(rl, 'Start date (YYYY-MM-DD HH:mm) [Stockholm]', start || formatStockholmLocal(new Date()));
        const startParsed = parseStockholmLocal(start) || new Date();
        const defaultExp = new Date(startParsed.getTime());
        defaultExp.setFullYear(defaultExp.getFullYear() + 1);
        exp = await ask(rl, 'Expiry date (YYYY-MM-DD HH:mm) [Stockholm]', exp || formatStockholmLocal(defaultExp));
      }
      if (!trial) {
        inst = await ask(rl, 'Instance ID', inst || '');
        comp = await ask(rl, 'Company', comp || 'MundoGIS');
        nm = await ask(rl, 'Name', nm || '');
        em = await ask(rl, 'Email', em || 'abel.gonzalez@mundogis.se');
      }
    } finally {
      rl.close();
    }
  }

  if (!p || (!trial && (!exp || !start)) || (trial && !trialDurationMinutes) || (!trial && (!inst || !comp || !em))) {
    console.error('Usage: node tools/generate-license.mjs --plugin <Name> --trial <yes|no> --trial_days <N|Nm|Nh|Nd> --starts <YYYY-MM-DD HH:mm> --expires <YYYY-MM-DD HH:mm> --instance <InstanceId> --company <Company> --name <Name> --email <Email>');
    process.exit(1);
  }

  let startsAtIso = null;
  let expiresAtIso = null;
  if (!trial) {
    startsAtIso = toIso(start);
    expiresAtIso = toIso(exp);
    if (!startsAtIso || !expiresAtIso) {
      console.error('Invalid dates. Use YYYY-MM-DD HH:mm or ISO.');
      process.exit(1);
    }
  } else if (start) {
    startsAtIso = toIso(start);
    expiresAtIso = toIso(exp);
    if (!startsAtIso || !expiresAtIso) {
      console.error('Invalid trial dates. Use YYYY-MM-DD HH:mm or ISO.');
      process.exit(1);
    }
  }

  const payload = {
    plugin: p,
    trial: !!trial,
    issuedAt: formatStockholmIso(new Date())
  };

  if (trial) {
    payload.trialDurationMinutes = Number(trialDurationMinutes) || 90 * 24 * 60;
    if (!payload.trialDurationMinutes) payload.trialDurationMinutes = 90 * 24 * 60;
    if (startsAtIso && expiresAtIso) {
      payload.startsAt = startsAtIso;
      payload.expiresAt = expiresAtIso;
    }
  } else {
    payload.startsAt = startsAtIso;
    payload.expiresAt = expiresAtIso;
  }

  if (!trial) {
    payload.instanceId = inst;
    payload.company = comp || 'MundoGIS';
    payload.name = nm || '';
    payload.email = em || 'abel.gonzalez@mundogis.se';
  }

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const licenseKey = `${payloadB64}.${sig}`;

  const output = { licenseKey, payload };
  console.log(JSON.stringify(output, null, 2));

  const safeCompany = (comp || 'company').trim().replace(/[\\/:*?"<>|]/g, '_');
  const outDir = path.join(projectRoot, 'tools', 'licenses');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${safeCompany}.json`);
  let existing = null;
  try {
    if (fs.existsSync(outFile)) {
      const raw = fs.readFileSync(outFile, 'utf8');
      existing = JSON.parse(raw || '{}');
    }
  } catch {
    existing = null;
  }

  const merged = {
    company: comp || 'MundoGIS',
    updatedAt: new Date().toISOString(),
    plugins: {}
  };

  if (existing && typeof existing === 'object') {
    if (existing.company) merged.company = existing.company;
    if (existing.plugins && typeof existing.plugins === 'object') {
      merged.plugins = existing.plugins;
    }
  }

  merged.plugins[p] = output;
  fs.writeFileSync(outFile, JSON.stringify(merged, null, 2), 'utf8');
};

run();
