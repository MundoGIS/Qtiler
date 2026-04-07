import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
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

const PORT = Number(process.env.LICENSE_UI_PORT || 3199);
const HOST = '127.0.0.1';
const STATIC_ALLOWED_PLUGINS = ['ProjectSearch', 'Qrigo', 'QuantizedMesh', 'QtilerAuth', 'VectorTiles', 'WmsCache'];
const DEFAULT_PRICING = {
  ProjectSearch: { amount: 50, currency: 'USD', period: 'year' },
  Qrigo: { amount: 150, currency: 'EUR', period: 'year' },
  QuantizedMesh: { amount: 300, currency: 'EUR', period: 'year' },
  QtilerAuth: { amount: 200, currency: 'EUR', period: 'year' },
  VectorTiles: { amount: 150, currency: 'EUR', period: 'year' },
  WmsCache: { amount: 100, currency: 'EUR', period: 'year' }
};
const SEK_RATE = 10;
const PLUGINS_ROUTE_FILE = path.join(projectRoot, 'routes', 'plugins.js');

const loadPricingFromRouteConfig = () => {
  try {
    if (!fs.existsSync(PLUGINS_ROUTE_FILE)) return { ...DEFAULT_PRICING };
    const src = fs.readFileSync(PLUGINS_ROUTE_FILE, 'utf8');
    const blockMatch = src.match(/const\s+pricing\s*=\s*\{([\s\S]*?)\n\s*\};/);
    if (!blockMatch) return { ...DEFAULT_PRICING };

    const parsed = {};
    const rx = /(\w+)\s*:\s*\{\s*price\s*:\s*([\d.]+)\s*,\s*currency\s*:\s*'([^']+)'\s*,\s*period\s*:\s*'([^']+)'\s*\}/g;
    let m = null;
    while ((m = rx.exec(blockMatch[1])) !== null) {
      const plugin = m[1];
      const amount = Number(m[2]);
      if (!Number.isFinite(amount)) continue;
      parsed[plugin] = { amount, currency: m[3], period: m[4] };
    }
    return { ...DEFAULT_PRICING, ...parsed };
  } catch {
    return { ...DEFAULT_PRICING };
  }
};

let PRICING = loadPricingFromRouteConfig();
const ALLOWED_PLUGINS = Array.from(new Set([...STATIC_ALLOWED_PLUGINS, ...Object.keys(PRICING)])).sort();
const LICENSES_DIR = path.join(projectRoot, 'tools', 'licenses');
const INVOICES_DIR = path.join(LICENSES_DIR, 'invoices');
const PROFILE_FILE = path.join(LICENSES_DIR, 'issuer-profile.json');
const BRAND_LOGO_FILE = path.join(projectRoot, 'public', 'css', 'images', 'MGIS-logo_azul.png');

const DEFAULT_ISSUER_PROFILE = {
  legalName: 'MundoGIS',
  website: 'https://mundogis.se',
  phone: '0722164142',
  addressLine: 'Gardsvagen 12B, Vallentuna 18694, Stockholm, Sweden',
  contactEmail: 'support@mundogis.se',
  vatNumber: '',
  orgNumber: '',
  bankName: '',
  accountHolder: 'MundoGIS',
  accountNumber: '',
  iban: '',
  bicSwift: '',
  bankAddress: '',
  paymentTermsDays: 15,
  defaultVatPercent: 25,
  currency: 'EUR',
  internationalPaymentNote: 'For international transfers, please use IBAN and BIC/SWIFT.'
};

const secret = ensureLicenseSecret();
if (!secret) {
  console.error('LICENSE_SECRET is not set in environment.');
  process.exit(1);
}

const ensureDir = (dirPath) => fs.mkdirSync(dirPath, { recursive: true });

const readBodyJson = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
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

const toIso = (value) => {
  if (!value) return null;
  const d = parseStockholmLocal(value);
  return d ? formatStockholmIso(d) : null;
};

const sanitizeFilePart = (value, fallback = 'company') => {
  const v = String(value || fallback).trim() || fallback;
  return v.replace(/[\\/:*?"<>|]/g, '_');
};

const escHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const convertAmountByCurrency = (amount, fromCurrency, toCurrency) => {
  const num = Number(amount);
  if (!Number.isFinite(num)) return 0;
  const from = String(fromCurrency || '').trim().toUpperCase() || 'EUR';
  const to = String(toCurrency || '').trim().toUpperCase() || from;
  if (from === to) return num;
  if (to === 'SEK' && from !== 'SEK') return num * SEK_RATE;
  if (from === 'SEK' && to !== 'SEK') return num / SEK_RATE;
  return num;
};

const normalizePluginName = (plugin) => {
  const p = String(plugin || '').trim();
  if (!p) return '';
  return p.toLowerCase() === 'origo' ? 'Qrigo' : p;
};

const readIssuerProfile = () => {
  try {
    if (!fs.existsSync(PROFILE_FILE)) return { ...DEFAULT_ISSUER_PROFILE };
    const parsed = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8') || '{}');
    return { ...DEFAULT_ISSUER_PROFILE, ...(parsed || {}) };
  } catch {
    return { ...DEFAULT_ISSUER_PROFILE };
  }
};

const saveIssuerProfile = (payload) => {
  const profile = { ...DEFAULT_ISSUER_PROFILE };
  for (const key of Object.keys(DEFAULT_ISSUER_PROFILE)) {
    const value = payload?.[key];
    if (value == null) continue;
    if (typeof profile[key] === 'number') {
      const n = Number(value);
      if (Number.isFinite(n)) profile[key] = n;
    } else {
      profile[key] = String(value).trim();
    }
  }
  ensureDir(LICENSES_DIR);
  fs.writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2), 'utf8');
  return profile;
};

const getBrandLogoDataUri = () => {
  try {
    if (!fs.existsSync(BRAND_LOGO_FILE)) return '';
    const raw = fs.readFileSync(BRAND_LOGO_FILE);
    return `data:image/png;base64,${raw.toString('base64')}`;
  } catch {
    return '';
  }
};

const savePricingToRouteConfig = (pricingInput) => {
  if (!fs.existsSync(PLUGINS_ROUTE_FILE)) throw new Error('routes/plugins.js not found');
  const src = fs.readFileSync(PLUGINS_ROUTE_FILE, 'utf8');
  const blockMatch = src.match(/const\s+pricing\s*=\s*\{([\s\S]*?)\n\s*\};/);
  if (!blockMatch) throw new Error('pricing block not found in routes/plugins.js');

  const normalized = {};
  for (const [name, cfgRaw] of Object.entries(pricingInput || {})) {
    const plugin = String(name || '').trim();
    if (!plugin) continue;
    const amount = Number(cfgRaw?.amount);
    const currency = String(cfgRaw?.currency || 'EUR').trim().toUpperCase();
    const period = String(cfgRaw?.period || 'year').trim().toLowerCase();
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`Invalid amount for ${plugin}`);
    if (!currency) throw new Error(`Invalid currency for ${plugin}`);
    if (!period) throw new Error(`Invalid period for ${plugin}`);
    normalized[plugin] = { amount, currency, period };
  }

  const routeBlock = [
    '  const pricing = {',
    ...Object.keys(normalized).sort().map((plugin) => {
      const cfg = normalized[plugin];
      return `    ${plugin}: { price: ${cfg.amount}, currency: '${cfg.currency}', period: '${cfg.period}' },`;
    }),
    '  };'
  ].join('\n');

  const updated = src.replace(/const\s+pricing\s*=\s*\{[\s\S]*?\n\s*\};/, routeBlock);
  fs.writeFileSync(PLUGINS_ROUTE_FILE, updated, 'utf8');
  PRICING = { ...normalized };
  return PRICING;
};

const computeLicenseStatus = (payload) => {
  const now = Date.now();
  const startMs = Date.parse(payload?.startsAt || '');
  const expMs = Date.parse(payload?.expiresAt || '');
  if (Number.isFinite(startMs) && startMs > now) return 'not_started';
  if (Number.isFinite(expMs) && expMs <= now) return 'expired';
  return 'active';
};

const listClientLicenses = () => {
  ensureDir(LICENSES_DIR);
  const files = fs.readdirSync(LICENSES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== path.basename(PROFILE_FILE))
    .map((entry) => entry.name);

  const clients = [];
  for (const fileName of files) {
    const fullPath = path.join(LICENSES_DIR, fileName);
    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8') || '{}');
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.plugins || typeof parsed.plugins !== 'object') continue;

    const clientId = path.basename(fileName, '.json');
    const licenses = [];
    let customer = { name: '', email: '', instanceId: '' };

    for (const [pluginRaw, entry] of Object.entries(parsed.plugins)) {
      const plugin = normalizePluginName(pluginRaw);
      const payload = entry?.payload || null;
      if (!payload || typeof payload !== 'object') continue;
      const status = computeLicenseStatus(payload);
      if (!customer.name && payload.name) customer.name = String(payload.name);
      if (!customer.email && payload.email) customer.email = String(payload.email);
      if (!customer.instanceId && payload.instanceId) customer.instanceId = String(payload.instanceId);
      licenses.push({
        plugin,
        trial: !!payload.trial,
        startsAt: payload.startsAt || null,
        expiresAt: payload.expiresAt || null,
        issuedAt: payload.issuedAt || null,
        status,
        customerRef: payload?.meta?.customerRef || null,
        orderId: payload?.meta?.orderId || null,
        commercialModel: payload?.meta?.commercialModel || null,
        payload
      });
    }

    licenses.sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || '')));
    clients.push({
      clientId,
      company: String(parsed.company || clientId),
      updatedAt: parsed.updatedAt || null,
      customer,
      licenses
    });
  }

  clients.sort((a, b) => String(a.company || '').localeCompare(String(b.company || '')));
  return clients;
};

const buildLicenseOutputForPlugin = (input, plugin) => {
  plugin = normalizePluginName(plugin);
  const licenseType = String(input.licenseType || 'commercial').trim().toLowerCase();
  const isTrial = licenseType === 'trial';
  const payload = {
    plugin,
    trial: isTrial,
    issuedAt: formatStockholmIso(new Date())
  };

  if (isTrial) {
    const trialDurationMinutes = parseDurationToMinutes(input.trialDuration || '90d', 90 * 24 * 60);
    if (!trialDurationMinutes) throw new Error('Invalid trial duration');
    payload.trialDurationMinutes = trialDurationMinutes;
    const startsAt = toIso(input.startsAt || '');
    const expiresAt = toIso(input.expiresAt || '');
    if ((input.startsAt || input.expiresAt) && (!startsAt || !expiresAt)) {
      throw new Error('Invalid trial dates. Use YYYY-MM-DD HH:mm');
    }
    if (startsAt && expiresAt) {
      payload.startsAt = startsAt;
      payload.expiresAt = expiresAt;
    }
    // Optional customer metadata for trial records, useful for CRM and invoicing.
    const trialCompany = String(input.company || '').trim();
    const trialName = String(input.name || '').trim();
    const trialEmail = String(input.email || '').trim();
    const trialInstanceId = String(input.instanceId || '').trim();
    if (trialCompany) payload.company = trialCompany;
    if (trialName) payload.name = trialName;
    if (trialEmail) payload.email = trialEmail;
    if (trialInstanceId) payload.instanceId = trialInstanceId;
  } else {
    const instanceId = String(input.instanceId || '').trim();
    const company = String(input.company || '').trim();
    const email = String(input.email || '').trim();
    const startsAt = toIso(input.startsAt || '');
    const expiresAt = toIso(input.expiresAt || '');
    if (!instanceId || !company || !email || !startsAt || !expiresAt) {
      throw new Error('Commercial license requires instanceId, company, email, startsAt and expiresAt');
    }
    payload.instanceId = instanceId;
    payload.company = company;
    payload.name = String(input.name || '').trim();
    payload.email = email;
    payload.startsAt = startsAt;
    payload.expiresAt = expiresAt;
  }

  const orderId = String(input.orderId || '').trim();
  const customerRef = String(input.customerRef || '').trim();
  const commercialModel = String(input.commercialModel || '').trim();
  const notes = String(input.notes || '').trim();
  if (orderId || customerRef || commercialModel || notes) {
    payload.meta = {
      orderId: orderId || null,
      customerRef: customerRef || null,
      commercialModel: commercialModel || null,
      notes: notes || null
    };
  }

  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return { payload, licenseKey: `${payloadB64}.${sig}` };
};

const generateLicenseBatch = (input) => {
  const requestedPlugins = Array.isArray(input.plugins)
    ? input.plugins.map((p) => normalizePluginName(p)).filter(Boolean)
    : [normalizePluginName(input.plugin || '')].filter(Boolean);
  const uniquePlugins = Array.from(new Set(requestedPlugins));
  if (!uniquePlugins.length) throw new Error('Select at least one plugin');
  const invalid = uniquePlugins.filter((plugin) => !ALLOWED_PLUGINS.includes(plugin));
  if (invalid.length) {
    throw new Error(`Invalid plugin(s): ${invalid.join(', ')}. Allowed: ${ALLOWED_PLUGINS.join(', ')}`);
  }
  return uniquePlugins.map((plugin) => buildLicenseOutputForPlugin(input, plugin));
};

const saveLicenseRecord = (input, outputs) => {
  const companyName = String(input.company || 'trial').trim() || 'trial';
  const safeCompany = sanitizeFilePart(companyName);
  ensureDir(LICENSES_DIR);
  const outFile = path.join(LICENSES_DIR, `${safeCompany}.json`);
  let existing = null;
  try {
    existing = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8') || '{}') : null;
  } catch {
    existing = null;
  }

  const merged = {
    company: companyName,
    updatedAt: new Date().toISOString(),
    plugins: {}
  };
  if (existing && typeof existing === 'object') {
    if (existing.company) merged.company = existing.company;
    if (existing.plugins && typeof existing.plugins === 'object') merged.plugins = existing.plugins;
  }

  const archivePaths = [];
  const list = Array.isArray(outputs) ? outputs : [outputs];
  for (const output of list) {
    merged.plugins[output.payload.plugin] = { licenseKey: output.licenseKey, payload: output.payload };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = path.join(LICENSES_DIR, `${safeCompany}_${sanitizeFilePart(output.payload.plugin)}_${stamp}.json`);
    fs.writeFileSync(archivePath, JSON.stringify(output, null, 2), 'utf8');
    archivePaths.push(archivePath);
  }
  fs.writeFileSync(outFile, JSON.stringify(merged, null, 2), 'utf8');
  return { outFile, archivePaths };
};

const deleteLicenseRecord = (clientId, plugin) => {
  const safeClientId = sanitizeFilePart(clientId || '', 'client');
  const pluginName = normalizePluginName(plugin || '');
  if (!pluginName) throw new Error('Plugin is required');
  const filePath = path.join(LICENSES_DIR, `${safeClientId}.json`);
  if (!fs.existsSync(filePath)) throw new Error('Client record not found');

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
  if (!parsed.plugins || typeof parsed.plugins !== 'object') {
    throw new Error('License entry not found');
  }

  const existingKey = Object.keys(parsed.plugins).find((k) => normalizePluginName(k) === pluginName);
  if (!existingKey) {
    throw new Error('License entry not found');
  }

  delete parsed.plugins[existingKey];
  parsed.updatedAt = new Date().toISOString();
  if (!Object.keys(parsed.plugins).length) {
    fs.unlinkSync(filePath);
    return { deletedFile: true, filePath };
  }

  fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), 'utf8');
  return { deletedFile: false, filePath };
};

const buildInvoiceHtml = (invoice) => {
  const lang = String(invoice.language || 'es').trim().toLowerCase() === 'en' ? 'en' : 'es';
  const L = lang === 'es'
    ? {
      invoice: 'FACTURA',
      number: 'No',
      issueDate: 'Fecha emision',
      dueDate: 'Fecha vencimiento',
      currency: 'Moneda',
      issuer: 'Emisor',
      billTo: 'Cliente',
      phone: 'Telefono',
      email: 'Email',
      web: 'Web',
      vat: 'NIF IVA',
      orgNo: 'Nro organizacion',
      fTax: 'F-tax',
      contact: 'Contacto',
      instanceId: 'Instance ID',
      description: 'Descripcion',
      qty: 'Cant.',
      unit: 'Unitario',
      total: 'Total',
      subtotal: 'Subtotal',
      vatShort: 'IVA',
      totalCaps: 'TOTAL',
      reverseCharge: 'IVA por inversion del sujeto pasivo aplicado (0%).',
      bankDetails: 'Datos bancarios',
      billingMode: 'Modo de facturacion',
      preferredPayment: 'Metodo recomendado',
      bank: 'Banco',
      holder: 'Titular',
      account: 'Cuenta',
      iban: 'IBAN',
      bic: 'BIC/SWIFT',
      bankgiro: 'Bankgiro',
      bankAddress: 'Direccion bancaria',
      modeInternational: 'Internacional',
      modeSweden: 'Suecia domestico'
    }
    : {
      invoice: 'INVOICE',
      number: 'No',
      issueDate: 'Issue date',
      dueDate: 'Due date',
      currency: 'Currency',
      issuer: 'Issuer',
      billTo: 'Bill To',
      phone: 'Phone',
      email: 'Email',
      web: 'Web',
      vat: 'VAT',
      orgNo: 'Org no',
      fTax: 'F-tax',
      contact: 'Contact',
      instanceId: 'Instance ID',
      description: 'Description',
      qty: 'Qty',
      unit: 'Unit',
      total: 'Total',
      subtotal: 'Subtotal',
      vatShort: 'VAT',
      totalCaps: 'TOTAL',
      reverseCharge: 'VAT reverse charge applied (0%).',
      bankDetails: 'Bank Details',
      billingMode: 'Billing mode',
      preferredPayment: 'Preferred payment',
      bank: 'Bank',
      holder: 'Holder',
      account: 'Account',
      iban: 'IBAN',
      bic: 'BIC/SWIFT',
      bankgiro: 'Bankgiro',
      bankAddress: 'Bank address',
      modeInternational: 'International',
      modeSweden: 'Sweden domestic'
    };

  const logoDataUri = getBrandLogoDataUri();
  const logoBlock = logoDataUri
    ? `<img src="${logoDataUri}" alt="MundoGIS logo" class="logo"/>`
    : `<div class="fallbackLogo">${escHtml(invoice.issuer.legalName || 'MundoGIS')}</div>`;
  const linesRows = invoice.lines.map((line) => `
    <tr>
      <td>${escHtml(line.description)}</td>
      <td style="text-align:right">${line.quantity}</td>
      <td style="text-align:right">${line.unitPrice.toFixed(2)}</td>
      <td style="text-align:right">${line.total.toFixed(2)}</td>
    </tr>
  `).join('');

  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${escHtml(L.invoice)} ${escHtml(invoice.invoiceNumber)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;margin:0;background:#eef3fa;color:#0f172a}
.sheet{max-width:920px;margin:20px auto;background:#fff;border:1px solid #d7e2f0;border-radius:14px;padding:24px}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;border-bottom:2px solid #e2ebf7;padding-bottom:16px;margin-bottom:16px}
.logo{max-width:230px;max-height:80px;object-fit:contain}
.fallbackLogo{font-size:1.6rem;font-weight:800;color:#1e4f8f;letter-spacing:.04em}
.invoiceTitle{font-size:1.8rem;font-weight:800;letter-spacing:.03em;color:#0f3f75;margin:0 0 4px 0}
.muted{color:#475569;font-size:.92rem}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
.box{border:1px solid #d8e4f3;border-radius:10px;padding:12px;background:#f9fbff}
.box h3{margin:0 0 8px 0;font-size:1rem;color:#174c88}
table{width:100%;border-collapse:collapse;margin-top:10px}
th,td{border-bottom:1px solid #dfe8f5;padding:10px 8px;font-size:.95rem}
th{text-align:left;background:#f1f6fd;color:#1c406b}
.right{text-align:right}
.totals{margin-top:14px;margin-left:auto;width:340px}
.totalsRow{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e2e8f0}
.totalsRow.total{font-size:1.14rem;font-weight:800;color:#0f3f75;border-bottom:0;padding-top:10px}
.footer{margin-top:18px;border-top:1px dashed #c7d5ea;padding-top:12px;color:#334155;font-size:.9rem}
@media print{body{background:#fff}.sheet{margin:0;max-width:none;border:none;border-radius:0}}
</style>
</head><body>
<div class="sheet">
  <div class="top">
    <div>${logoBlock}</div>
    <div style="text-align:right">
      <h1 class="invoiceTitle">${escHtml(L.invoice)}</h1>
      <div class="muted"><strong>${escHtml(L.number)}:</strong> ${escHtml(invoice.invoiceNumber)}</div>
      <div class="muted"><strong>${escHtml(L.issueDate)}:</strong> ${escHtml(invoice.issueDate)}</div>
      <div class="muted"><strong>${escHtml(L.dueDate)}:</strong> ${escHtml(invoice.dueDate)}</div>
      <div class="muted"><strong>${escHtml(L.currency)}:</strong> ${escHtml(invoice.currency)}</div>
    </div>
  </div>

  <div class="meta">
    <div class="box">
      <h3>${escHtml(L.issuer)}</h3>
      <div><strong>${escHtml(invoice.issuer.legalName)}</strong></div>
      <div>${escHtml(invoice.issuer.addressLine)}</div>
      <div>${escHtml(L.phone)}: ${escHtml(invoice.issuer.phone || '-')}</div>
      <div>${escHtml(L.email)}: ${escHtml(invoice.issuer.contactEmail || '-')}</div>
      <div>${escHtml(L.web)}: ${escHtml(invoice.issuer.website || '-')}</div>
      <div>${escHtml(L.vat)}: ${escHtml(invoice.issuer.vatNumber || '-')}</div>
      <div>${escHtml(L.orgNo)}: ${escHtml(invoice.issuer.orgNumber || '-')}</div>
      <div>${escHtml(L.fTax)}: ${escHtml(invoice.issuer.fTaxApproved || '-')}</div>
    </div>
    <div class="box">
      <h3>${escHtml(L.billTo)}</h3>
      <div><strong>${escHtml(invoice.customer.company)}</strong></div>
      <div>${escHtml(L.contact)}: ${escHtml(invoice.customer.name || '-')}</div>
      <div>${escHtml(L.email)}: ${escHtml(invoice.customer.email || '-')}</div>
      <div>${escHtml(L.instanceId)}: ${escHtml(invoice.customer.instanceId || '-')}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr><th>${escHtml(L.description)}</th><th class="right">${escHtml(L.qty)}</th><th class="right">${escHtml(L.unit)}</th><th class="right">${escHtml(L.total)}</th></tr>
    </thead>
    <tbody>${linesRows}</tbody>
  </table>

  <div class="totals">
    <div class="totalsRow"><span>${escHtml(L.subtotal)}</span><span>${invoice.subtotal.toFixed(2)} ${escHtml(invoice.currency)}</span></div>
    <div class="totalsRow"><span>${escHtml(L.vatShort)} (${invoice.vatPercent}%)</span><span>${invoice.vatAmount.toFixed(2)} ${escHtml(invoice.currency)}</span></div>
    <div class="totalsRow total"><span>${escHtml(L.totalCaps)}</span><span>${invoice.total.toFixed(2)} ${escHtml(invoice.currency)}</span></div>
  </div>
  ${invoice.reverseCharge ? '<div class="muted" style="margin-top:8px;text-align:right">' + escHtml(L.reverseCharge) + '</div>' : ''}

  <div class="box" style="margin-top:16px">
    <h3>${escHtml(L.bankDetails)}</h3>
    <div>${escHtml(L.billingMode)}: ${escHtml(invoice.billingMode === 'international' ? L.modeInternational : L.modeSweden)}</div>
    <div>${escHtml(L.preferredPayment)}: ${escHtml(invoice.paymentMethodSummary || '-')}</div>
    <div>${escHtml(L.bank)}: ${escHtml(invoice.issuer.bankName || '-')}</div>
    <div>${escHtml(L.holder)}: ${escHtml(invoice.issuer.accountHolder || '-')}</div>
    <div>${escHtml(L.account)}: ${escHtml(invoice.issuer.accountNumber || '-')}</div>
    <div>${escHtml(L.iban)}: ${escHtml(invoice.issuer.iban || '-')}</div>
    <div>${escHtml(L.bic)}: ${escHtml(invoice.issuer.bicSwift || '-')}</div>
    <div>${escHtml(L.bankgiro)}: ${escHtml(invoice.issuer.bankGiro || '-')}</div>
    <div>${escHtml(L.bankAddress)}: ${escHtml(invoice.issuer.bankAddress || '-')}</div>
  </div>

  <div class="footer">${escHtml(invoice.issuer.internationalPaymentNote || '')}</div>
</div>
</body></html>`;
};

const createInvoice = (input) => {
  const clients = listClientLicenses();
  const client = clients.find((c) => c.clientId === String(input.clientId || '').trim());
  if (!client) throw new Error('Client not found');

  const issuer = { ...readIssuerProfile(), ...(input.issuer || {}) };
  const selectedPlugins = Array.isArray(input.plugins) ? input.plugins.map((x) => String(x).trim()).filter(Boolean) : [];
  const licenses = client.licenses.filter((item) => !selectedPlugins.length || selectedPlugins.includes(item.plugin));
  if (!licenses.length) throw new Error('No licenses selected for invoice');

  const billingMode = String(input.billingMode || 'sweden').trim().toLowerCase() === 'international'
    ? 'international'
    : 'sweden';
  const language = String(input.language || 'es').trim().toLowerCase() === 'en' ? 'en' : 'es';
  const reverseCharge = String(input.reverseCharge || '').trim().toLowerCase() === 'true'
    || String(input.reverseCharge || '').trim().toLowerCase() === 'on';
  const currency = String(input.currency || issuer.currency || 'EUR').trim().toUpperCase();
  const vatInput = Number(input.vatPercent);
  let vatPercent = Number.isFinite(vatInput)
    ? vatInput
    : (billingMode === 'international' ? 0 : Number(issuer.defaultVatPercent || 25));
  if (reverseCharge) vatPercent = 0;
  const issueDateObj = input.issueDate ? new Date(String(input.issueDate)) : new Date();
  const paymentDays = Number.isFinite(Number(input.paymentDays)) ? Number(input.paymentDays) : Number(issuer.paymentTermsDays || 15);
  const dueDateObj = new Date(issueDateObj.getTime() + Math.max(0, paymentDays) * 24 * 60 * 60 * 1000);
  const invoiceNumber = String(input.invoiceNumber || `MG-${Date.now()}`).trim();

  const lines = licenses.map((lic) => {
    const priceCfg = PRICING[lic.plugin] || { amount: 0, currency, period: 'year' };
    const rawPrice = Number.isFinite(Number(input.customPrices?.[lic.plugin]))
      ? Number(input.customPrices[lic.plugin])
      : Number(priceCfg.amount || 0);
    const unitPrice = convertAmountByCurrency(rawPrice, priceCfg.currency || currency, currency);
    return {
      plugin: lic.plugin,
      description: `${lic.plugin} license (${lic.trial ? 'Trial' : 'Commercial'}) ${priceCfg.period ? '- ' + priceCfg.period : ''}`,
      quantity: 1,
      unitPrice,
      total: unitPrice
    };
  });

  const subtotal = lines.reduce((sum, line) => sum + line.total, 0);
  const vatAmount = subtotal * (Math.max(0, vatPercent) / 100);
  const total = subtotal + vatAmount;

  const customerOverride = {
    name: String(input.customerName || '').trim(),
    email: String(input.customerEmail || '').trim(),
    instanceId: String(input.customerInstanceId || '').trim()
  };

  const invoice = {
    invoiceNumber,
    issueDate: issueDateObj.toISOString().slice(0, 10),
    dueDate: dueDateObj.toISOString().slice(0, 10),
    language,
    currency,
    billingMode,
    reverseCharge,
    vatPercent,
    subtotal,
    vatAmount,
    total,
    customer: {
      company: client.company,
      name: customerOverride.name || client.customer?.name || '',
      email: customerOverride.email || client.customer?.email || '',
      instanceId: customerOverride.instanceId || client.customer?.instanceId || ''
    },
    issuer,
    paymentMethodSummary: billingMode === 'international'
      ? `International transfer via IBAN ${issuer.iban || '-'} / BIC ${issuer.bicSwift || '-'}`
      : `Swedish domestic transfer via Bankgiro ${issuer.bankGiro || '-'}`,
    lines
  };

  ensureDir(INVOICES_DIR);
  const safeClient = sanitizeFilePart(client.company || client.clientId || 'client');
  const safeInvoice = sanitizeFilePart(invoiceNumber || 'invoice');
  const baseName = `${safeClient}_${safeInvoice}`;
  const invoiceJsonPath = path.join(INVOICES_DIR, `${baseName}.json`);
  const invoiceHtmlPath = path.join(INVOICES_DIR, `${baseName}.html`);
  const html = buildInvoiceHtml(invoice);
  fs.writeFileSync(invoiceJsonPath, JSON.stringify(invoice, null, 2), 'utf8');
  fs.writeFileSync(invoiceHtmlPath, html, 'utf8');
  return { invoice, invoiceJsonPath, invoiceHtmlPath, html };
};

const renderPluginChecklistHtml = (names, inputName, checkedNames = []) => {
  const checked = new Set(Array.isArray(checkedNames) && checkedNames.length ? checkedNames : names);
  return names.map((name) => {
    const cfg = PRICING[name] || {};
    const tag = Number.isFinite(Number(cfg.amount)) ? ` - ${cfg.amount} ${cfg.currency || 'EUR'}/${cfg.period || 'year'}` : '';
    const mark = checked.has(name) ? 'checked' : '';
    return `<label style="display:flex;gap:8px;align-items:center;padding:4px 0"><input type="checkbox" name="${escHtml(inputName)}" value="${escHtml(name)}" ${mark} style="width:auto"/><span>${escHtml(name)}${escHtml(tag)}</span></label>`;
  }).join('');
};

const renderClientsTableHtml = (clients) => {
  if (!Array.isArray(clients) || !clients.length) return '<div class="hint">No client licenses found yet.</div>';
  const rows = clients.flatMap((client) => {
    if (!Array.isArray(client.licenses) || !client.licenses.length) {
      return [`<tr><td>${escHtml(client.company || '-')}</td><td>-</td><td>-</td><td>-</td><td>-</td><td>${escHtml(client.customer?.name || '-')} / ${escHtml(client.customer?.email || '-')}</td><td>${escHtml(client.customer?.instanceId || '-')}</td><td>-</td></tr>`];
    }
    return client.licenses.map((lic) => `<tr><td>${escHtml(client.company || '-')}</td><td>${escHtml(lic.plugin || '-')}</td><td>${lic.trial ? 'Trial' : 'Commercial'}</td><td>${escHtml(String(lic.startsAt || '-').slice(0, 10))}</td><td>${escHtml(String(lic.expiresAt || '-').slice(0, 10))}</td><td>${escHtml(client.customer?.name || '-')} / ${escHtml(client.customer?.email || '-')}</td><td>${escHtml(client.customer?.instanceId || '-')}</td><td><button type="button" class="secondary delete-license" data-client="${escHtml(client.clientId || '')}" data-plugin="${escHtml(lic.plugin || '')}">Delete</button></td></tr>`);
  }).join('');
  return `<table><thead><tr><th>Client</th><th>Plugin</th><th>Type</th><th>Starts</th><th>Expires</th><th>Customer</th><th>Instance ID</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>`;
};

const initialClients = listClientLicenses();
const initialClientOptions = initialClients.map((client) => `<option value="${escHtml(client.clientId)}">${escHtml(client.company)}</option>`).join('');
const initialInvoicePlugins = Array.from(new Set((initialClients[0]?.licenses || []).map((x) => x.plugin).filter(Boolean)));

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Qtiler License Studio</title>
<style>
:root{--bg:#0b1220;--panel:#111b2e;--line:#2a3955;--txt:#e6edf7;--muted:#9fb0ca;--ok:#16a34a;--btn:#2563eb}
*{box-sizing:border-box}body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:radial-gradient(1200px 700px at 0% 0%,#1a2e55 0,var(--bg) 55%);color:var(--txt)}
.wrap{padding:18px;max-width:1300px;margin:0 auto}.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:14px}
.tabBar{display:flex;gap:8px;margin-bottom:12px}.tabBtn{background:#1f2d46;color:#dbe7fb;border:1px solid #334766}.tabBtn.active{background:#2563eb;color:#fff}
.tabPane{display:none}.tabPane.active{display:block}
h2{margin:0 0 8px 0;font-size:1rem}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.full{grid-column:1/-1}
label{font-size:.78rem;color:var(--muted)}input,select,textarea{width:100%;background:#0f1729;color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:8px}
textarea{min-height:62px}.actions{display:flex;gap:8px;justify-content:flex-end}button{border:0;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer}
.primary{background:var(--btn);color:#fff}.secondary{background:#334155;color:#fff}.result{border:1px solid var(--line);border-radius:8px;background:#0f1729;padding:10px;margin-top:8px}
table{width:100%;border-collapse:collapse;font-size:.82rem}th,td{border-bottom:1px solid #22324f;padding:6px 8px;text-align:left}th{color:#c8d7ef}
.ok{color:#86efac}.err{color:#fca5a5}.hint{color:var(--muted);font-size:.8rem}
@media (max-width:980px){.grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
</style></head>
<body><div class="wrap">
  <div class="tabBar">
    <button type="button" class="tabBtn active" data-tab-target="license">Generate License</button>
    <button type="button" class="tabBtn" data-tab-target="invoice">Invoice Studio</button>
    <button type="button" class="tabBtn" data-tab-target="pricing">Plugin Pricing</button>
  </div>

  <div class="tabPane active" data-tab="license">
  <div class="card">
    <h2>1) Generate License</h2>
    <form id="licenseForm" class="grid">
      <div class="full"><label>Plugins (multi-select)</label><div id="licensePlugins" class="box">${renderPluginChecklistHtml(ALLOWED_PLUGINS, 'plugins', ALLOWED_PLUGINS)}</div></div>
      <div><label>Type</label><select name="licenseType" id="licenseType"><option value="commercial">Commercial</option><option value="trial">Trial</option></select></div>
      <div><label>Starts (YYYY-MM-DD HH:mm)</label><input name="startsAt" type="datetime-local"/></div>
      <div><label>Expires (YYYY-MM-DD HH:mm)</label><input name="expiresAt" type="datetime-local"/></div>
      <div id="trialDurationWrap" style="display:none"><label>Trial duration</label><input name="trialDuration" value="90d"/></div>
      <div id="instanceWrap"><label>Instance ID</label><input name="instanceId" placeholder="Server instance ID (not plugin key)"/></div>
      <div><label>Company</label><input name="company"/></div>
      <div><label>Name</label><input name="name"/></div>
      <div><label>Email</label><input name="email"/></div>
      <div><label>Commercial model</label><select name="commercialModel"><option value="">(none)</option><option value="subscription-yearly">Subscription yearly</option><option value="subscription-monthly">Subscription monthly</option><option value="one-time">One time</option><option value="trial">Trial</option></select></div>
      <div><label>Order ID</label><input name="orderId"/></div>
      <div><label>Customer ref</label><input name="customerRef"/></div>
      <div class="full"><label>Notes</label><textarea name="notes"></textarea></div>
      <div class="full actions"><button type="submit" class="primary">Generate</button></div>
    </form>
    <div id="genResult" class="result" style="display:none"></div>
  </div>

  <div class="card">
    <h2>2) Clients & Issued Licenses</h2>
    <div class="hint">Shows control per client including start/expiry and customer info.</div>
    <div id="clientsWrap" class="result" style="margin-top:8px">${renderClientsTableHtml(initialClients)}</div>
  </div>
  </div>

  <div class="tabPane" data-tab="invoice">
  <div class="card">
    <h2>3) Invoice Studio</h2>
    <form id="invoiceForm" class="grid">
      <div><label>Client</label><select id="invoiceClient" name="clientId">${initialClientOptions}</select></div>
      <div><label>Invoice number</label><input name="invoiceNumber" placeholder="MG-2026-001"/></div>
      <div><label>Issue date</label><input name="issueDate" type="date"/></div>
      <div><label>Payment days</label><input name="paymentDays" type="number" value="15"/></div>
      <div><label>Customer name</label><input name="customerName" placeholder="Auto from client"/></div>
      <div><label>Customer email</label><input name="customerEmail" placeholder="Auto from client"/></div>
      <div><label>Customer Instance ID</label><input name="customerInstanceId" placeholder="Auto from client"/></div>
      <div><label>Billing mode</label><select id="billingMode" name="billingMode"><option value="sweden">Sweden domestic</option><option value="international">International</option></select></div>
      <div><label>Invoice language</label><select name="language"><option value="es">Espanol</option><option value="en">English</option></select></div>
      <div><label>Currency</label><select name="currency"><option value="EUR">EUR</option><option value="USD">USD</option><option value="SEK">SEK (x10)</option></select></div>
      <div><label>VAT % (MOMS)</label><input name="vatPercent" type="number" step="0.01" value="25"/></div>
      <div class="full hint">If currency is SEK, plugin prices are converted using 1 x 10.</div>
      <div><label style="display:flex;gap:8px;align-items:center"><input id="reverseCharge" name="reverseCharge" type="checkbox" style="width:auto"/> Reverse charge (set VAT to 0%)</label></div>
      <div class="full"><label>Plugins to invoice</label><div id="invoicePlugins" class="box">${initialInvoicePlugins.length ? renderPluginChecklistHtml(initialInvoicePlugins, 'invoicePlugin', initialInvoicePlugins) : '<div class="hint">No licensed plugins for this client.</div>'}</div></div>
      <div class="full"><label>Issuer profile (MundoGIS) - editable JSON</label><textarea id="issuerJson"></textarea></div>
      <div class="full actions"><button type="button" id="saveProfile" class="secondary">Save issuer profile</button><button type="submit" class="primary">Create invoice</button></div>
    </form>
    <div id="invoiceResult" class="result" style="display:none"></div>
  </div>
  </div>

  <div class="tabPane" data-tab="pricing">
  <div class="card">
    <h2>4) Plugin Pricing</h2>
    <div class="hint">Edit prices here and save to central pricing config used by plugin licensing.</div>
    <div class="grid" style="margin-top:8px">
      <div class="full"><label>Pricing JSON</label><textarea id="pricingJson"></textarea></div>
      <div class="full actions"><button type="button" id="savePricing" class="secondary">Save pricing</button></div>
    </div>
    <div id="pricingResult" class="result" style="display:none"></div>
  </div>
  </div>
</div>

<script>
const licenseForm = document.getElementById('licenseForm');
const genResult = document.getElementById('genResult');
const licenseType = document.getElementById('licenseType');
const trialDurationWrap = document.getElementById('trialDurationWrap');
const instanceWrap = document.getElementById('instanceWrap');
const licensePlugins = document.getElementById('licensePlugins');
const clientsWrap = document.getElementById('clientsWrap');
const invoiceForm = document.getElementById('invoiceForm');
const invoiceClient = document.getElementById('invoiceClient');
const invoicePlugins = document.getElementById('invoicePlugins');
const invoiceResult = document.getElementById('invoiceResult');
const issuerJson = document.getElementById('issuerJson');
const saveProfileBtn = document.getElementById('saveProfile');
const pricingJson = document.getElementById('pricingJson');
const savePricingBtn = document.getElementById('savePricing');
const pricingResult = document.getElementById('pricingResult');
const billingMode = document.getElementById('billingMode');
const reverseCharge = document.getElementById('reverseCharge');
const vatPercentInput = invoiceForm.querySelector('input[name="vatPercent"]');
const tabButtons = Array.from(document.querySelectorAll('.tabBtn'));
const tabPanes = Array.from(document.querySelectorAll('.tabPane'));

let clientsState = [];
let pricingMap = ${JSON.stringify(PRICING)};

function activateTab(tabName){
  tabButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tabTarget === tabName));
  tabPanes.forEach((pane) => pane.classList.toggle('active', pane.dataset.tab === tabName));
}

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tabTarget));
});

function renderPluginCheckboxes(container, names, inputName, checkedNames){
  const checked = new Set(Array.isArray(checkedNames) ? checkedNames : names);
  container.innerHTML = names.map((name) => {
    const cfg = pricingMap[name] || {};
    const tag = Number.isFinite(Number(cfg.amount)) ? (' - ' + cfg.amount + ' ' + (cfg.currency || 'EUR') + '/' + (cfg.period || 'year')) : '';
    const isChecked = checked.has(name) ? 'checked' : '';
    return '<label style="display:flex;gap:8px;align-items:center;padding:4px 0">' +
      '<input type="checkbox" name="' + inputName + '" value="' + name + '" ' + isChecked + ' style="width:auto"/>' +
      '<span>' + name + tag + '</span></label>';
  }).join('');
}

renderPluginCheckboxes(licensePlugins, ${JSON.stringify(ALLOWED_PLUGINS)}, 'plugins', ${JSON.stringify(ALLOWED_PLUGINS)});

function rerenderLicensePlugins(){
  const selected = Array.from(licenseForm.querySelectorAll('input[name="plugins"]:checked')).map((el) => el.value);
  const fallback = selected.length ? selected : ${JSON.stringify(ALLOWED_PLUGINS)};
  renderPluginCheckboxes(licensePlugins, ${JSON.stringify(ALLOWED_PLUGINS)}, 'plugins', fallback);
}

function syncLicenseType(){
  const isTrial = licenseType.value === 'trial';
  trialDurationWrap.style.display = isTrial ? '' : 'none';
  instanceWrap.style.display = '';
}
syncLicenseType();
licenseType.addEventListener('change', syncLicenseType);

function syncInvoiceTaxDefaults(){
  if(reverseCharge.checked){
    vatPercentInput.value = '0';
    vatPercentInput.setAttribute('readonly', 'readonly');
    return;
  }
  vatPercentInput.removeAttribute('readonly');
  if(billingMode.value === 'international'){
    if(!vatPercentInput.value || Number(vatPercentInput.value) === 25) vatPercentInput.value = '0';
  } else {
    if(!vatPercentInput.value || Number(vatPercentInput.value) === 0) vatPercentInput.value = '25';
  }
}

billingMode.addEventListener('change', syncInvoiceTaxDefaults);
reverseCharge.addEventListener('change', syncInvoiceTaxDefaults);
syncInvoiceTaxDefaults();

async function api(url, options={}){
  const resp = await fetch(url, { headers:{'Content-Type':'application/json'}, ...options });
  const payload = await resp.json().catch(() => ({}));
  if(!resp.ok) throw new Error(payload.error || 'Request failed');
  return payload;
}

function formatDate(value){
  if(!value) return '-';
  const d = new Date(value);
  if(Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
}

function renderClients(clients){
  if(!clients.length){
    clientsWrap.innerHTML = '<div class="hint">No client licenses found yet.</div>';
    return;
  }
  const rows = clients.flatMap((client) => {
    if(!client.licenses.length){
      return ['<tr><td>' + client.company + '</td><td>-</td><td>-</td><td>-</td><td>-</td><td>' + (client.customer?.name || '-') + ' / ' + (client.customer?.email || '-') + '</td><td>' + (client.customer?.instanceId || '-') + '</td><td>-</td></tr>'];
    }
    return client.licenses.map((lic) => '<tr>' +
      '<td>' + client.company + '</td>' +
      '<td>' + lic.plugin + '</td>' +
      '<td>' + (lic.trial ? 'Trial' : 'Commercial') + '</td>' +
      '<td>' + formatDate(lic.startsAt) + '</td>' +
      '<td>' + formatDate(lic.expiresAt) + '</td>' +
      '<td>' + (client.customer?.name || '-') + ' / ' + (client.customer?.email || '-') + '</td>' +
      '<td>' + (client.customer?.instanceId || '-') + '</td>' +
      '<td><button type="button" class="secondary delete-license" data-client="' + client.clientId + '" data-plugin="' + lic.plugin + '">Delete</button></td>' +
    '</tr>');
  }).join('');

  clientsWrap.innerHTML = '<table><thead><tr><th>Client</th><th>Plugin</th><th>Type</th><th>Starts</th><th>Expires</th><th>Customer</th><th>Instance ID</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function fillInvoiceClients(clients){
  invoiceClient.innerHTML = clients.map((client) => '<option value="' + client.clientId + '">' + client.company + '</option>').join('');
  fillInvoiceCustomerFields();
  syncInvoicePluginList();
}

function fillInvoiceCustomerFields(){
  const selectedId = invoiceClient.value;
  const client = clientsState.find((c) => c.clientId === selectedId);
  const nameInput = invoiceForm.querySelector('input[name="customerName"]');
  const emailInput = invoiceForm.querySelector('input[name="customerEmail"]');
  const instanceInput = invoiceForm.querySelector('input[name="customerInstanceId"]');
  if(!client){
    nameInput.value = '';
    emailInput.value = '';
    instanceInput.value = '';
    return;
  }
  nameInput.value = client.customer?.name || '';
  emailInput.value = client.customer?.email || '';
  instanceInput.value = client.customer?.instanceId || '';
}

function syncInvoicePluginList(){
  const selectedId = invoiceClient.value;
  const client = clientsState.find((c) => c.clientId === selectedId);
  const plugins = client?.licenses?.map((x) => x.plugin).filter(Boolean) || [];
  const unique = Array.from(new Set(plugins));
  if(!unique.length){
    invoicePlugins.innerHTML = '<div class="hint">No licensed plugins for this client.</div>';
    return;
  }
  renderPluginCheckboxes(invoicePlugins, unique, 'invoicePlugin', unique);
}

async function refreshClients(){
  const payload = await api('/api/licenses');
  clientsState = Array.isArray(payload.clients) ? payload.clients : [];
  renderClients(clientsState);
  fillInvoiceClients(clientsState);
  syncInvoicePluginList();
}

async function loadProfile(){
  const payload = await api('/api/issuer-profile');
  issuerJson.value = JSON.stringify(payload.profile || {}, null, 2);
}

async function loadPricing(){
  const payload = await api('/api/pricing');
  pricingMap = payload.pricing || {};
  pricingJson.value = JSON.stringify(pricingMap, null, 2);
  rerenderLicensePlugins();
  syncInvoicePluginList();
}

licenseForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const fd = new FormData(licenseForm);
  const data = Object.fromEntries(fd.entries());
  data.plugins = fd.getAll('plugins');
  try {
    const payload = await api('/api/generate-license', { method:'POST', body: JSON.stringify(data) });
    genResult.style.display = '';
    genResult.innerHTML = '<div class="ok">Licenses generated: ' + (payload.outputs?.length || 0) + '</div>' +
      '<div>Main: <code>' + payload.saved.main + '</code></div>' +
      '<div>Archives: <code>' + (payload.saved.archives || []).join('</code><br/><code>') + '</code></div>' +
      '<div style="margin-top:8px"><button class="secondary" id="copyKeys">Copy all license keys</button></div>' +
      '<pre>' + JSON.stringify(payload.outputs, null, 2) + '</pre>';
    document.getElementById('copyKeys').addEventListener('click', async () => {
      const all = (payload.outputs || []).map((x) => x.licenseKey).join('\\n');
      await navigator.clipboard.writeText(all);
    });
    await refreshClients();
  } catch (err) {
    genResult.style.display = '';
    genResult.innerHTML = '<div class="err">' + (err.message || String(err)) + '</div>';
  }
});

saveProfileBtn.addEventListener('click', async () => {
  try {
    const parsed = JSON.parse(issuerJson.value || '{}');
    const payload = await api('/api/issuer-profile', { method:'POST', body: JSON.stringify({ profile: parsed }) });
    issuerJson.value = JSON.stringify(payload.profile || {}, null, 2);
    invoiceResult.style.display = '';
    invoiceResult.innerHTML = '<div class="ok">Issuer profile saved</div>';
  } catch (err) {
    invoiceResult.style.display = '';
    invoiceResult.innerHTML = '<div class="err">' + (err.message || String(err)) + '</div>';
  }
});

savePricingBtn.addEventListener('click', async () => {
  try {
    const parsed = JSON.parse(pricingJson.value || '{}');
    const payload = await api('/api/pricing', { method:'POST', body: JSON.stringify({ pricing: parsed }) });
    pricingMap = payload.pricing || {};
    pricingJson.value = JSON.stringify(pricingMap, null, 2);
    rerenderLicensePlugins();
    syncInvoicePluginList();
    pricingResult.style.display = '';
    pricingResult.innerHTML = '<div class="ok">Pricing saved in routes/plugins.js</div>';
  } catch (err) {
    pricingResult.style.display = '';
    pricingResult.innerHTML = '<div class="err">' + (err.message || String(err)) + '</div>';
  }
});

clientsWrap.addEventListener('click', async (event) => {
  const target = event.target;
  if(!(target instanceof HTMLElement)) return;
  if(!target.classList.contains('delete-license')) return;
  const clientId = target.getAttribute('data-client') || '';
  const plugin = target.getAttribute('data-plugin') || '';
  if(!clientId || !plugin) return;
  const ok = window.confirm('Delete license for ' + plugin + ' on client ' + clientId + '?');
  if(!ok) return;
  try {
    await api('/api/delete-license', { method:'POST', body: JSON.stringify({ clientId, plugin }) });
    await refreshClients();
    genResult.style.display = '';
    genResult.innerHTML = '<div class="ok">License deleted: ' + plugin + ' (' + clientId + ')</div>';
  } catch (err) {
    genResult.style.display = '';
    genResult.innerHTML = '<div class="err">' + (err.message || String(err)) + '</div>';
  }
});

invoiceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const formData = Object.fromEntries(new FormData(invoiceForm).entries());
    const selectedInvoicePlugins = Array.from(invoiceForm.querySelectorAll('input[name="invoicePlugin"]:checked')).map((el) => el.value);
    const parsedProfile = JSON.parse(issuerJson.value || '{}');
    const payload = await api('/api/create-invoice', {
      method:'POST',
      body: JSON.stringify({
        clientId: formData.clientId,
        invoiceNumber: formData.invoiceNumber,
        issueDate: formData.issueDate,
        paymentDays: Number(formData.paymentDays || 15),
        billingMode: formData.billingMode || 'sweden',
        language: formData.language || 'es',
        reverseCharge: !!formData.reverseCharge,
        customerName: formData.customerName || '',
        customerEmail: formData.customerEmail || '',
        customerInstanceId: formData.customerInstanceId || '',
        currency: formData.currency,
        vatPercent: Number(formData.vatPercent || 0),
        plugins: selectedInvoicePlugins,
        issuer: parsedProfile
      })
    });
    invoiceResult.style.display = '';
    invoiceResult.innerHTML = '<div class="ok">Invoice created</div>' +
      '<div>JSON: <code>' + payload.saved.json + '</code></div>' +
      '<div>HTML: <code>' + payload.saved.html + '</code></div>' +
      '<div style="margin-top:8px;display:flex;gap:8px"><button class="secondary" id="copyInvoice">Copy invoice JSON</button><button class="primary" id="printInvoice">Print PDF</button></div>' +
      '<pre>' + JSON.stringify(payload.invoice, null, 2) + '</pre>';
    document.getElementById('copyInvoice').addEventListener('click', async () => {
      await navigator.clipboard.writeText(JSON.stringify(payload.invoice, null, 2));
    });
    document.getElementById('printInvoice').addEventListener('click', () => {
      const w = window.open('/api/invoice-html?file=' + encodeURIComponent(payload.saved.html), '_blank');
      if(w){
        w.addEventListener('load', () => w.print(), { once: true });
      }
    });
  } catch (err) {
    invoiceResult.style.display = '';
    invoiceResult.innerHTML = '<div class="err">' + (err.message || String(err)) + '</div>';
  }
});

Promise.all([refreshClients(), loadProfile(), loadPricing()]).catch((err) => {
  clientsWrap.innerHTML = '<div class="err">' + (err.message || String(err)) + '</div>';
});

invoiceClient.addEventListener('change', () => {
  fillInvoiceCustomerFields();
  syncInvoicePluginList();
});
</script>
</body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/licenses') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ clients: listClientLicenses() }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/issuer-profile') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ profile: readIssuerProfile() }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/pricing') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ pricing: PRICING }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/invoice-html') {
    const relFile = String(url.searchParams.get('file') || '').trim();
    const candidate = path.resolve(projectRoot, relFile);
    if (!relFile || !candidate.startsWith(INVOICES_DIR) || !fs.existsSync(candidate)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Invoice HTML not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(candidate, 'utf8'));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/issuer-profile') {
    try {
      const input = await readBodyJson(req);
      const profile = saveIssuerProfile(input?.profile || {});
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ profile }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/pricing') {
    try {
      const input = await readBodyJson(req);
      const pricing = savePricingToRouteConfig(input?.pricing || {});
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ pricing }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/generate-license') {
    try {
      const input = await readBodyJson(req);
      const outputs = generateLicenseBatch(input);
      const saved = saveLicenseRecord(input, outputs);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        outputs,
        saved: {
          main: path.relative(projectRoot, saved.outFile),
          archives: saved.archivePaths.map((p) => path.relative(projectRoot, p))
        }
      }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/create-invoice') {
    try {
      const input = await readBodyJson(req);
      const out = createInvoice(input || {});
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        invoice: out.invoice,
        saved: {
          json: path.relative(projectRoot, out.invoiceJsonPath),
          html: path.relative(projectRoot, out.invoiceHtmlPath)
        }
      }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/delete-license') {
    try {
      const input = await readBodyJson(req);
      const clientId = String(input?.clientId || '').trim();
      const plugin = String(input?.plugin || '').trim();
      if (!clientId || !plugin) throw new Error('clientId and plugin are required');
      const out = deleteLicenseRecord(clientId, plugin);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, deletedFile: out.deletedFile, file: path.relative(projectRoot, out.filePath) }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, HOST, () => {
  console.log(`License Studio running at http://${HOST}:${PORT}`);
  console.log('Open that URL in your browser. Press Ctrl+C to stop.');
});
