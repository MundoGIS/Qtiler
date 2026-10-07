import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';
import { createJsonStore } from '../lib/jsonStore.js';

export const DEFAULT_QTILER_SETTINGS = {
  companyName: 'MundoGIS', headerColor: null, logoFile: null,
  footerText: 'MundoGIS', footerWebsiteLabel: 'Mundogis.se', footerWebsiteUrl: 'https://mundogis.se',
  footerContactLabel: 'Get in contact', footerContactEmail: 'support@mundogis.se'
};

export function registerQtilerSettingsRoutes({ app, requireAdmin, dataDir }) {
  const root = path.join(dataDir, 'qtiler-settings');
  const filePath = path.join(root, 'settings.json');
  const logos = path.join(root, 'logos');
  const read = async () => {
    const raw = await fs.readFile(filePath, 'utf8').catch((err) => { if (err.code === 'ENOENT') return null; throw err; });
    return { ...DEFAULT_QTILER_SETTINGS, ...(raw ? JSON.parse(raw.replace(/^\uFEFF/, '')) : {}) };
  };
  const publicSettings = (settings) => ({
    ...settings,
    headerTextColor: settings.headerColor && /^#[a-f0-9]{6}$/i.test(settings.headerColor)
      ? (() => {
        const channels = [1, 3, 5].map((offset) => parseInt(settings.headerColor.slice(offset, offset + 2), 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 > 0.179 ? '#000000' : '#ffffff';
      })() : '#ffffff',
    logoUrl: settings.logoFile ? `/qtiler-settings/logo/${settings.logoFile}` : '/css/images/MGIS-logo_azul.png'
  });
  const adminOnly = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'auth_required' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    next();
  };
  const update = async (patch) => {
    await fs.mkdir(root, { recursive: true });
    const lockPath = path.join(root, 'settings.lock');
    const lock = await fs.open(lockPath, 'wx').catch(async (err) => {
      if (err.code !== 'EEXIST') throw err;
      const owner = Number(await fs.readFile(lockPath, 'utf8').catch(() => ''));
      if (owner > 0 && Number.isInteger(owner)) {
        try { process.kill(owner, 0); } catch (ownerErr) {
          if (ownerErr.code === 'ESRCH') { await fs.rm(lockPath, { force: true }); return fs.open(lockPath, 'wx'); }
        }
      }
      throw Object.assign(new Error('Settings are being saved. Retry shortly.'), { statusCode: 409 });
    });
    try {
      await lock.writeFile(String(process.pid));
      return await createJsonStore(filePath, DEFAULT_QTILER_SETTINGS).update((current) => ({ ...DEFAULT_QTILER_SETTINGS, ...current, ...patch }));
    } finally {
      await lock.close();
      await fs.rm(lockPath, { force: true });
    }
  };
  const uiPaths = new Set(['/', '/index.html', '/portal', '/portal.html', '/login', '/login.html', '/guide', '/guide.html', '/admin', '/admin.html', '/viewer', '/viewer.html', '/access-denied', '/access-denied.html']);
  app.use(async (req, res, next) => {
    if (!uiPaths.has(req.path)) return next();
    try { res.locals.qtilerSettings = publicSettings(await read()); }
    catch { res.locals.qtilerSettings = publicSettings(DEFAULT_QTILER_SETTINGS); }
    next();
  });
  app.get('/qtiler-settings/logo/:file', async (req, res) => {
    if (!/^[a-f0-9]{64}\.png$/.test(req.params.file)) return res.status(404).end();
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(path.join(logos, req.params.file), (err) => { if (err && !res.headersSent) res.status(404).end(); });
  });
  app.get('/admin/qtiler-settings', requireAdmin, adminOnly, async (_req, res) => {
    try { res.set('Cache-Control', 'no-store'); res.json(publicSettings(await read())); }
    catch { res.status(500).json({ error: 'settings_read_failed' }); }
  });
  app.patch('/admin/qtiler-settings', requireAdmin, adminOnly, async (req, res) => {
    let patch;
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new Error('Settings must be an object');
      patch = {};
      for (const key of ['companyName', 'footerText', 'footerWebsiteLabel', 'footerWebsiteUrl', 'footerContactLabel', 'footerContactEmail']) {
        if (!Object.hasOwn(req.body, key)) continue;
        const value = req.body[key];
        if (typeof value !== 'string' || value.length > 500 || /[\x00-\x1f]/.test(value)) throw new Error(`Invalid ${key}`);
        patch[key] = value.trim();
      }
      if (Object.hasOwn(req.body, 'headerColor')) {
        if (!/^#[a-f0-9]{6}$/i.test(req.body.headerColor)) throw new Error('Header color must be a hexadecimal color');
        patch.headerColor = req.body.headerColor;
      }
      if (patch.footerWebsiteUrl) {
        const url = new URL(patch.footerWebsiteUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Website must use HTTP or HTTPS without credentials');
      }
      if (patch.footerContactEmail && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(patch.footerContactEmail)) throw new Error('Invalid email');
    } catch (err) { return res.status(400).json({ error: 'invalid_settings', message: err.message }); }
    try { res.json(publicSettings(await update(patch))); }
    catch (err) { res.status(err.statusCode || 500).json({ error: 'settings_save_failed', message: err.statusCode === 409 ? err.message : 'Could not save settings.' }); }
  });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
  app.post('/admin/qtiler-settings/logo', requireAdmin, adminOnly, (req, res) => {
    upload.single('logo')(req, res, async (err) => {
      if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'invalid_logo_upload' });
      if (!req.file) return res.status(400).json({ error: 'logo_required' });
      let image;
      try {
        const input = sharp(req.file.buffer, { limitInputPixels: 16000000 });
        const metadata = await input.metadata();
        if (!['png', 'jpeg', 'webp'].includes(metadata.format)) throw new Error('Unsupported image format');
        image = await input.rotate().resize({ width: 1024, height: 512, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      } catch { return res.status(400).json({ error: 'invalid_logo', message: 'Use a valid PNG, JPEG or WebP image.' }); }
      try {
        const logoFile = crypto.createHash('sha256').update(image).digest('hex') + '.png';
        await fs.mkdir(logos, { recursive: true });
        const finalPath = path.join(logos, logoFile);
        const temporaryPath = path.join(logos, `${crypto.randomUUID()}.tmp`);
        try {
          await fs.writeFile(temporaryPath, image, { flag: 'wx' });
          await fs.rename(temporaryPath, finalPath).catch(async (renameErr) => {
            if (!['EEXIST', 'EPERM'].includes(renameErr.code)) throw renameErr;
            const existing = await fs.readFile(finalPath);
            if (!existing.equals(image)) throw renameErr;
          });
        } finally {
          await fs.rm(temporaryPath, { force: true });
        }
        res.json(publicSettings(await update({ logoFile })));
      } catch (err) { res.status(err.statusCode || 500).json({ error: 'logo_save_failed' }); }
    });
  });
  app.delete('/admin/qtiler-settings/logo', requireAdmin, adminOnly, async (_req, res) => {
    try { res.json(publicSettings(await update({ logoFile: null }))); }
    catch (err) { res.status(err.statusCode || 500).json({ error: 'logo_reset_failed' }); }
  });
}