export const registerProj4Routes = ({ app, normalizeEpsgKey, ensureServerProj4Def, getProj4Presets }) => {
  app.get('/api/proj4/:code', async (req, res) => {
    try {
      const code = req.params && req.params.code ? String(req.params.code) : null;
      if (!code) return res.status(400).json({ error: 'missing_code' });
      const key = normalizeEpsgKey(code);
      if (!key) return res.status(400).json({ error: 'invalid_code' });

      const presets = typeof getProj4Presets === 'function' ? getProj4Presets() : null;
      if (presets && presets[key]) {
        return res.json({ code: key, def: presets[key], source: 'cache' });
      }

      const def = await ensureServerProj4Def(key);
      if (!def) return res.status(404).json({ error: 'not_found' });
      return res.json({ code: key, def, source: 'epsg.io' });
    } catch (err) {
      console.warn('proj4 ensure failed', err?.message || err);
      return res.status(500).json({ error: 'server_error' });
    }
  });
};
