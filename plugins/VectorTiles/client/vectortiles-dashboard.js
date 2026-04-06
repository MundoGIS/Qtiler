(function () {
  const API_BASE = '/plugins/VectorTiles/api';

  const i18n = {
    en: {
      copyStyleJson: 'Copy VectorTiles Style-URL',
      copyTileSource: 'Copy VectorTiles Source-URL',
      copyOk: 'Copied to clipboard',
      copyError: 'Copy failed',
      infoTabTitle: 'Vector Tiles',
      infoIntro: 'Vector tile endpoints for this project.',
      infoProject: 'Project',
      infoLayer: 'Layer',
      infoTileJson: 'TileJSON URL',
      infoTemplate: 'Tile URL template',
      layerStyleUrl: 'Layer style URL',
      infoStatusMissing: 'Tileset not generated yet.',
      infoStatusReady: 'Tileset ready.',
      snippets: 'Code snippets',
      snippetQgis: 'QGIS (XYZ connection)',
      snippetArcgis: 'ArcGIS (JSON)',
      snippetOrigo: 'Origo (JSON)',
      snippetHajk: 'Hajk (JSON)',
      copy: 'Copy'
    },
    es: {
      copyStyleJson: 'Copiar VectorTiles Style-URL',
      copyTileSource: 'Copiar VectorTiles Source-URL',
      copyOk: 'Copiado al portapapeles',
      copyError: 'Error al copiar',
      infoTabTitle: 'Vector Tiles',
      infoIntro: 'Endpoints de vector tiles para este proyecto.',
      infoProject: 'Proyecto',
      infoLayer: 'Capa',
      infoTileJson: 'URL TileJSON',
      infoTemplate: 'URL plantilla de tiles',
      layerStyleUrl: 'URL de estilo de capa',
      infoStatusMissing: 'Tileset no generado aún.',
      infoStatusReady: 'Tileset listo.',
      snippets: 'Snippets de código',
      snippetQgis: 'QGIS (conexión XYZ)',
      snippetArcgis: 'ArcGIS (JSON)',
      snippetOrigo: 'Origo (JSON)',
      snippetHajk: 'Hajk (JSON)',
      copy: 'Copiar'
    },
    sv: {
      copyStyleJson: 'Kopiera VectorTiles Style-URL',
      copyTileSource: 'Kopiera VectorTiles Source-URL',
      copyOk: 'Kopierad till urklipp',
      copyError: 'Kopiering misslyckades',
      infoTabTitle: 'Vector Tiles',
      infoIntro: 'Vector tile-endpoints för detta projekt.',
      infoProject: 'Projekt',
      infoLayer: 'Lager',
      infoTileJson: 'TileJSON URL',
      infoTemplate: 'Tile URL-mall',
      layerStyleUrl: 'Lager stil URL',
      infoStatusMissing: 'Tileset inte genererat ännu.',
      infoStatusReady: 'Tileset klart.',
      snippets: 'Kodexempel',
      snippetQgis: 'QGIS (XYZ-anslutning)',
      snippetArcgis: 'ArcGIS (JSON)',
      snippetOrigo: 'Origo (JSON)',
      snippetHajk: 'Hajk (JSON)',
      copy: 'Kopiera'
    }
  };

  const detectLang = () => {
    if (window.qtilerLang?.get) return window.qtilerLang.get();
    const stored = localStorage.getItem('qtiler.lang');
    if (stored && i18n[stored]) return stored;
    const nav = (navigator.language || 'en').split('-')[0].toLowerCase();
    return i18n[nav] ? nav : 'en';
  };
  const t = (key) => { const tbl = i18n[detectLang()] || i18n.en; return tbl[key] ?? i18n.en[key] ?? key; };

  const apiFetch = async (url) => {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) return null;
    return resp.json();
  };

  const showStatus = (message, isError) => {
    const el = document.getElementById('status');
    if (!el) return;
    el.textContent = String(message || '');
    el.style.color = isError ? 'var(--danger, #b42318)' : '';
    if (message) {
      clearTimeout(showStatus._timer);
      showStatus._timer = setTimeout(() => { el.textContent = ''; }, 5000);
    }
  };

  const copyText = async (value) => {
    if (navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(value); return; }
    const ta = document.createElement('textarea');
    ta.value = value; ta.style.position = 'fixed'; ta.style.top = '-9999px';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  };

  // ---- Tileset cache ----
  let _tilesetsCache = null;
  let _tilesetsCacheTime = 0;
  const CACHE_TTL = 5000;

  const fetchTilesets = async () => {
    const now = Date.now();
    if (_tilesetsCache && now - _tilesetsCacheTime < CACHE_TTL) return _tilesetsCache;
    const payload = await apiFetch(`${API_BASE}/tilesets`);
    const arr = Array.isArray(payload?.tilesets) ? payload.tilesets : [];
    const map = {};
    for (const item of arr) if (item?.projectId) map[item.projectId] = item;
    _tilesetsCache = map;
    _tilesetsCacheTime = now;
    return map;
  };

  // ---- URL helpers ----
  const addApiKey = (url) => (typeof window.qtilerWithApiKey === 'function') ? window.qtilerWithApiKey(url, null) : url;
  const tileJsonUrl = (projectId) => addApiKey(`${window.location.origin}/plugins/VectorTiles/tilejson/${encodeURIComponent(projectId)}.json`);
  const styleJsonUrl = (projectId) => addApiKey(`${window.location.origin}/plugins/VectorTiles/style/${encodeURIComponent(projectId)}.json`);
  const tileTemplateUrl = (projectId) => addApiKey(`${window.location.origin}/plugins/VectorTiles/tiles/${encodeURIComponent(projectId)}/{z}/{x}/{y}.pbf`);
  const layerSlug = (name) => String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const layerStyleUrl = (projectId, layerName) => {
    const slug = layerSlug(layerName);
    return addApiKey(`${window.location.origin}/plugins/VectorTiles/style/${encodeURIComponent(projectId)}/${encodeURIComponent(slug)}.json?layers=${encodeURIComponent(String(layerName || ''))}`);
  };
  const zoomToWebMercatorScale = (zoom) => {
    const z = Number(zoom);
    if (!Number.isFinite(z) || z < 0) return null;
    return Math.round((156543.03392804097 / Math.pow(2, z)) / 0.00028);
  };

  // ---- Inject Copy buttons into project controlsBox ----
  const MARKER = 'data-vt-injected';

  const injectCopyButtons = (wrap, tilesetsMap) => {
    if (!wrap) return;
    const projectId = wrap.getAttribute('data-project-id');
    if (!projectId) return;
    if (!tilesetsMap || !tilesetsMap[projectId]) return;

    // Find the Vector controls group
    const vectorGroup = wrap.querySelector('[data-role="vector-controls"]');
    if (!vectorGroup) return;

    // Don't double-inject
    if (vectorGroup.querySelector(`[${MARKER}]`)) return;

    const mkCopyBtn = (text, url) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-outline';
      btn.type = 'button';
      btn.textContent = text;
      btn.setAttribute(MARKER, '1');
      btn.addEventListener('click', async () => {
        try {
          await copyText(url);
          showStatus(t('copyOk'));
        } catch {
          showStatus(t('copyError'), true);
        }
      });
      return btn;
    };

    const styleBtn = mkCopyBtn(t('copyStyleJson'), styleJsonUrl(projectId));
    const tileSourceBtn = mkCopyBtn(t('copyTileSource'), tileTemplateUrl(projectId));

    vectorGroup.appendChild(styleBtn);
    vectorGroup.appendChild(tileSourceBtn);
  };

  // ---- Refresh all projects ----
  const refreshAllProjects = async () => {
    let tilesetsMap = {};
    try { tilesetsMap = await fetchTilesets(); } catch { return; }
    const blocks = document.querySelectorAll('.project-block[data-project-id]');
    for (const wrap of blocks) {
      injectCopyButtons(wrap, tilesetsMap);
    }
  };

  // ---- Info tab (layer detail panel) ----
  const registerInfoTab = () => {
    const hooks = window.qtilerPluginHooks || { layerInfoTabs: [] };
    window.qtilerPluginHooks = hooks;
    if (!Array.isArray(hooks.layerInfoTabs)) hooks.layerInfoTabs = [];
    const existing = hooks.layerInfoTabs.find((tab) => tab?.id === 'vectortiles-info');
    if (existing) { existing.title = t('infoTabTitle'); return; }

    hooks.layerInfoTabs.push({
      id: 'vectortiles-info',
      title: t('infoTabTitle'),
      shouldShow: ({ projectId }) => !!projectId,
      render: async ({ projectId, layerData, container }) => {
        const root = container || document.createElement('div');
        root.innerHTML = '';

        const status = document.createElement('div');
        status.className = 'meta'; status.style.marginBottom = '8px';
        status.textContent = t('infoIntro');
        root.appendChild(status);

        const infoList = document.createElement('div');
        infoList.className = 'meta';
        infoList.style.cssText = 'display:grid;gap:6px;margin-bottom:10px';
        infoList.innerHTML = `<div><strong>${t('infoProject')}:</strong> ${String(projectId || '').replace(/</g, '&lt;')}</div><div><strong>${t('infoLayer')}:</strong> ${String(layerData?.name || '').replace(/</g, '&lt;')}</div>`;
        root.appendChild(infoList);

        const tilejson = tileJsonUrl(projectId);
        const template = tileTemplateUrl(projectId);
        const currentLayerName = String(layerData?.name || '').trim();
        const layerStyle = currentLayerName ? layerStyleUrl(projectId, currentLayerName) : '';

        let tileMeta = { minzoom: 0, maxzoom: 20 };
        let tilesetReady = false;
        try {
          const tilesets = await fetchTilesets();
          tilesetReady = !!tilesets[projectId];
          if (tilesetReady) {
            const resp = await fetch(`/plugins/VectorTiles/tilejson/${encodeURIComponent(projectId)}.json`, { credentials: 'include' });
            if (resp.ok) {
              const p = await resp.json();
              if (p) tileMeta = { minzoom: p.minzoom ?? 0, maxzoom: p.maxzoom ?? 20, bounds: p.bounds };
            }
          }
        } catch {}

        const makeUrlRow = (label, value) => {
          const rowWrap = document.createElement('div');
          rowWrap.style.width = '100%';
          const lbl = document.createElement('div');
          lbl.className = 'meta'; lbl.style.fontWeight = '600'; lbl.style.marginBottom = '4px';
          lbl.textContent = label;
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px';
          const inp = document.createElement('input');
          inp.type = 'text'; inp.readOnly = true; inp.value = value;
          inp.style.cssText = 'flex:1;font-family:Consolas,Monaco,monospace;font-size:12px';
          const cpBtn = document.createElement('button');
          cpBtn.type = 'button'; cpBtn.className = 'btn btn-secondary btn-sm'; cpBtn.textContent = t('copy');
          cpBtn.addEventListener('click', async () => {
            try { await copyText(value); showStatus(t('copyOk')); } catch { showStatus(t('copyError'), true); }
          });
          row.append(inp, cpBtn);
          rowWrap.append(lbl, row);
          return rowWrap;
        };

        root.appendChild(makeUrlRow(t('infoTileJson'), tilejson));
        root.appendChild(makeUrlRow(t('infoTemplate'), template));
        if (layerStyle) root.appendChild(makeUrlRow(t('layerStyleUrl'), layerStyle));

        const statusRow = document.createElement('div');
        statusRow.className = 'meta';
        statusRow.textContent = tilesetReady ? t('infoStatusReady') : t('infoStatusMissing');
        root.appendChild(statusRow);

        if (tilesetReady) {
          const arcMin = zoomToWebMercatorScale(tileMeta.minzoom);
          const arcMax = zoomToWebMercatorScale(tileMeta.maxzoom);
          const snippetsTitle = document.createElement('div');
          snippetsTitle.className = 'meta';
          snippetsTitle.style.cssText = 'margin-top:12px;font-weight:700';
          snippetsTitle.textContent = t('snippets');
          root.appendChild(snippetsTitle);

          [
            { label: t('snippetQgis'), value: template },
            { label: t('snippetArcgis'), value: JSON.stringify({ type: 'vector-tile', url: tilejson, title: `${projectId} vector tiles`, minScale: arcMin, maxScale: arcMax }, null, 2) },
            { label: t('snippetOrigo'), value: JSON.stringify({ id: `${projectId}-vectortiles`, name: `${projectId} vector`, type: 'MVT', url: template, minZoom: tileMeta.minzoom, maxZoom: tileMeta.maxzoom, visible: true }, null, 2) },
            { label: t('snippetHajk'), value: JSON.stringify({ type: 'vectorTiles', title: `${projectId} vector tiles`, url: template, minZoom: tileMeta.minzoom, maxZoom: tileMeta.maxzoom, bbox: tileMeta.bounds }, null, 2) }
          ].forEach((s) => root.appendChild(makeUrlRow(s.label, s.value)));
        }
        return root;
      }
    });
  };

  // ---- Mount ----
  let _mutationTimer = null;
  const debouncedRefresh = () => {
    if (_mutationTimer) clearTimeout(_mutationTimer);
    _mutationTimer = setTimeout(() => {
      _tilesetsCache = null;
      _tilesetsCacheTime = 0;
      refreshAllProjects().catch(() => {});
    }, 500);
  };

  const mount = async () => {
    registerInfoTab();
    const layers = document.getElementById('layers');
    if (!layers) return;

    const observer = new MutationObserver(debouncedRefresh);
    observer.observe(layers, { childList: true, subtree: true });

    await refreshAllProjects();

    if (window.qtilerLang?.subscribe) {
      window.qtilerLang.subscribe(() => {
        registerInfoTab();
        document.querySelectorAll(`[${MARKER}]`).forEach((el) => el.remove());
        refreshAllProjects().catch(() => {});
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mount().catch(() => {}));
  } else {
    mount().catch(() => {});
  }
})();
