import { createJsonStore } from '../lib/jsonStore.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export function registerServiceMetadataRoutes({ app, requireAdmin, filePath, defaults, onSaved }) {
  app.get('/admin/service-metadata', requireAdmin, async (_req, res) => {
    try {
      const raw = await fs.readFile(filePath, 'utf8').catch((err) => {
        if (err.code === 'ENOENT') return null;
        throw err;
      });
      const metadata = raw === null ? structuredClone(defaults) : JSON.parse(raw.replace(/^\uFEFF/, ''));
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Invalid metadata file');
      res.set('Cache-Control', 'no-store');
      res.json(metadata);
    } catch {
      res.status(500).json({ error: 'metadata_read_failed' });
    }
  });
  app.patch('/admin/service-metadata', requireAdmin, async (req, res) => {
    let lock = null;
    let writing = false;
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new Error('Metadata must be an object');
      const identification = req.body?.serviceIdentification || {};
      const provider = req.body?.serviceProvider || {};
      const cleanText = (value) => {
        if (typeof value !== 'string' || value.length > 4000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error('Invalid metadata text');
        return value.trim();
      };
      const patch = { serviceIdentification: {}, serviceProvider: { contact: { address: {} } } };
      for (const key of ['title', 'abstract', 'fees', 'accessConstraints']) {
        if (Object.hasOwn(identification, key)) patch.serviceIdentification[key] = cleanText(identification[key]);
      }
      if (Object.hasOwn(identification, 'keywords')) {
        if (!Array.isArray(identification.keywords) || identification.keywords.length > 50) throw new Error('Invalid keywords');
        patch.serviceIdentification.keywords = identification.keywords.map(cleanText);
      }
      for (const key of ['providerName', 'providerSite']) {
        if (Object.hasOwn(provider, key)) patch.serviceProvider[key] = cleanText(provider[key]);
      }
      if (patch.serviceProvider.providerSite) {
        const website = new URL(patch.serviceProvider.providerSite);
        if (!['http:', 'https:'].includes(website.protocol) || website.username || website.password) throw new Error('Provider website must use HTTP or HTTPS without credentials');
      }
      for (const key of ['individualName', 'positionName']) {
        if (Object.hasOwn(provider.contact || {}, key)) patch.serviceProvider.contact[key] = cleanText(provider.contact[key]);
      }
      if (Object.hasOwn(provider.contact?.address || {}, 'email')) patch.serviceProvider.contact.address.email = cleanText(provider.contact.address.email);
      writing = true;
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      lock = await fs.open(`${filePath}.lock`, 'wx').catch(async (err) => {
        if (err.code === 'EEXIST') {
          const owner = Number(await fs.readFile(`${filePath}.lock`, 'utf8').catch(() => ''));
          if (Number.isInteger(owner) && owner > 0) {
            try { process.kill(owner, 0); } catch (ownerErr) {
              if (ownerErr.code === 'ESRCH') {
                await fs.rm(`${filePath}.lock`, { force: true });
                return fs.open(`${filePath}.lock`, 'wx');
              }
            }
          }
          throw Object.assign(new Error('Metadata is being saved by another request. Retry shortly.'), { statusCode: 409 });
        }
        throw err;
      });
      await lock.writeFile(String(process.pid));
      const saved = await createJsonStore(filePath, defaults).update((current) => ({
        ...current,
        serviceIdentification: { ...current.serviceIdentification, ...patch.serviceIdentification },
        serviceProvider: {
          ...current.serviceProvider, ...patch.serviceProvider,
          contact: { ...current.serviceProvider?.contact, ...patch.serviceProvider.contact,
            address: { ...current.serviceProvider?.contact?.address, ...patch.serviceProvider.contact.address } }
        }
      }));
      try { onSaved?.(saved); } catch (err) { console.warn('[metadata] Reload callback failed:', err.message); }
      res.set('Cache-Control', 'no-store');
      res.json(saved);
    } catch (err) {
      const status = err.statusCode || (writing ? 500 : 400);
      res.status(status).json({ error: writing ? 'metadata_save_failed' : 'invalid_service_metadata', message: writing && status === 500 ? 'Could not persist metadata. Previous settings have not been replaced.' : err.message });
    } finally {
      if (lock) {
        await lock.close();
        await fs.rm(`${filePath}.lock`, { force: true });
      }
    }
  });
}