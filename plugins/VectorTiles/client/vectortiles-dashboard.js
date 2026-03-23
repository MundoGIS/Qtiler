(function () {
  const API_BASE = '/plugins/VectorTiles/api';
  const BTN_CLASS = 'qtiler-vectortiles-btn';
  const BADGE_CLASS = 'qtiler-vectortiles-badge';
  const JOB_WAIT_TIMEOUT_MS = 30 * 60 * 1000;
  const JOB_REFRESH_INTERVAL_MS = 4000;

  const i18n = {
    en: {
      generate: 'Generate VectorTiles',
      generating: 'Generating VectorTiles…',
      ready: 'VectorTiles ready',
      openTileJson: 'Open TileJSON',
      copyTileUrl: 'Copy MVT URL',
      copyOk: 'Vector tile URL copied',
      copyError: 'Copy failed',
      failed: 'VectorTiles generation failed',
      sourceTag: 'VectorTiles',
      queued: 'VectorTiles job queued',
      running: 'VectorTiles job running',
      cancelled: 'VectorTiles job cancelled',
      timeoutRunning: 'Generation is still running in background (timeout reached while waiting).',
      infoTabTitle: 'VectorTiles',
      infoIntro: 'Project vector tiles are available for this layer/project context.',
      infoStatusReady: 'Status: available',
      infoStatusMissing: 'Status: not generated yet',
      infoProject: 'Project',
      infoLayer: 'Layer',
      infoTileJson: 'TileJSON URL',
      infoTemplate: 'MVT template URL',
      infoUseIn: 'Can be used in QGIS, ArcGIS, OrigoMap, Hajk and other MVT clients.',
      copy: 'Copy',
      snippets: 'Client snippets',
      snippetQgis: 'QGIS data source URI',
      snippetArcgis: 'ArcGIS JS layer config',
      snippetOrigo: 'Origo layer config',
      snippetHajk: 'Hajk layer config',
      confirmOverwrite: 'A vector tile cache already exists for this project. Overwrite it?',
      layerStyleUrl: 'Layer style URL',
      generationModalTitle: 'Generate VectorTiles',
      generationModalIntro: 'Choose zoom range and layers to generate vector tiles.',
      selectAllLayers: 'Select all layers',
      clearLayerSelection: 'Clear selection',
      startGeneration: 'Start generation',
      abort: 'Abort',
      aborting: 'Aborting…',
      zoomValidation: 'Use valid zoom values between 0 and 22.',
      layerSelectionValidation: 'Select at least one layer.',
      generationHint: 'Generation uses each selected layer extent and CRS as source.',
      minZoomLabel: 'Min zoom',
      maxZoomLabel: 'Max zoom',
      suggestedMinZoom: 'Suggested min zoom: {value}',
      useSuggestedMin: 'Use suggested',
      layerCrsLabel: 'CRS',
      noVectorLayers: 'No vector layers were found for this project. Generation will use all available layers.',
      selectionAll: 'all'
    },
    es: {
      generate: 'Generar VectorTiles',
      generating: 'Generando VectorTiles…',
      ready: 'VectorTiles listo',
      openTileJson: 'Abrir TileJSON',
      copyTileUrl: 'Copiar URL MVT',
      copyOk: 'URL de vector tiles copiada',
      copyError: 'Error al copiar',
      failed: 'Error al generar VectorTiles',
      sourceTag: 'VectorTiles',
      queued: 'Trabajo de VectorTiles en cola',
      running: 'Trabajo de VectorTiles en ejecución',
      cancelled: 'Trabajo de VectorTiles cancelado',
      timeoutRunning: 'La generacion sigue ejecutandose en segundo plano (se alcanzo el tiempo de espera).',
      infoTabTitle: 'VectorTiles',
      infoIntro: 'Los vector tiles del proyecto están disponibles para este contexto capa/proyecto.',
      infoStatusReady: 'Estado: disponible',
      infoStatusMissing: 'Estado: aún no generado',
      infoProject: 'Proyecto',
      infoLayer: 'Capa',
      infoTileJson: 'URL TileJSON',
      infoTemplate: 'URL plantilla MVT',
      infoUseIn: 'Se puede usar en QGIS, ArcGIS, OrigoMap, Hajk y otros clientes MVT.',
      copy: 'Copiar',
      snippets: 'Snippets de cliente',
      snippetQgis: 'URI de origen para QGIS',
      snippetArcgis: 'Configuración de capa ArcGIS JS',
      snippetOrigo: 'Configuración de capa Origo',
      snippetHajk: 'Configuración de capa Hajk',
      confirmOverwrite: 'Ya existe una caché vector tile para este proyecto. ¿Deseas sobrescribirla?',
      layerStyleUrl: 'URL de estilo por capa',
      generationModalTitle: 'Generar VectorTiles',
      generationModalIntro: 'Elige rango de zoom y capas para generar vector tiles.',
      selectAllLayers: 'Seleccionar todas las capas',
      clearLayerSelection: 'Limpiar selección',
      startGeneration: 'Iniciar generación',
      abort: 'Abortar',
      aborting: 'Abortando…',
      zoomValidation: 'Usa valores de zoom válidos entre 0 y 22.',
      layerSelectionValidation: 'Selecciona al menos una capa.',
      generationHint: 'La generación usa el extent y CRS de cada capa seleccionada.',
      minZoomLabel: 'Zoom mínimo',
      maxZoomLabel: 'Zoom máximo',
      suggestedMinZoom: 'Zoom mínimo sugerido: {value}',
      useSuggestedMin: 'Usar sugerido',
      layerCrsLabel: 'CRS',
      noVectorLayers: 'No se encontraron capas vectoriales para este proyecto. Se generará con todas las capas disponibles.',
      selectionAll: 'all'
    },
    sv: {
      generate: 'Generera VectorTiles',
      generating: 'Genererar VectorTiles…',
      ready: 'VectorTiles klar',
      openTileJson: 'Öppna TileJSON',
      copyTileUrl: 'Kopiera MVT-URL',
      copyOk: 'VectorTiles-URL kopierad',
      copyError: 'Kopiering misslyckades',
      failed: 'VectorTiles-generering misslyckades',
      sourceTag: 'VectorTiles',
      queued: 'VectorTiles-jobb i kö',
      running: 'VectorTiles-jobb körs',
      cancelled: 'VectorTiles-jobb avbrutet',
      timeoutRunning: 'Genereringen fortsatter i bakgrunden (vantetiden gick ut).',
      infoTabTitle: 'VectorTiles',
      infoIntro: 'Projektets vektortiles är tillgängliga för detta lager-/projektkontext.',
      infoStatusReady: 'Status: tillgänglig',
      infoStatusMissing: 'Status: inte genererad ännu',
      infoProject: 'Projekt',
      infoLayer: 'Lager',
      infoTileJson: 'TileJSON-URL',
      infoTemplate: 'MVT mall-URL',
      infoUseIn: 'Kan användas i QGIS, ArcGIS, OrigoMap, Hajk och andra MVT-klienter.',
      copy: 'Kopiera',
      snippets: 'Klientsnippets',
      snippetQgis: 'QGIS datakälla URI',
      snippetArcgis: 'ArcGIS JS lagerkonfig',
      snippetOrigo: 'Origo lagerkonfig',
      snippetHajk: 'Hajk lagerkonfig',
      confirmOverwrite: 'Det finns redan en vector tile-cache för projektet. Vill du skriva över den?',
      layerStyleUrl: 'Lager-specifik stil-URL',
      generationModalTitle: 'Generera VectorTiles',
      generationModalIntro: 'Välj zoomintervall och lager för att generera vektortiles.',
      selectAllLayers: 'Markera alla lager',
      clearLayerSelection: 'Rensa val',
      startGeneration: 'Starta generering',
      abort: 'Avbryt',
      aborting: 'Avbryter…',
      zoomValidation: 'Ange giltiga zoomvärden mellan 0 och 22.',
      layerSelectionValidation: 'Välj minst ett lager.',
      generationHint: 'Generering använder varje valt lagers utbredning och CRS som källa.',
      minZoomLabel: 'Min zoom',
      maxZoomLabel: 'Max zoom',
      suggestedMinZoom: 'Föreslagen min zoom: {value}',
      useSuggestedMin: 'Använd förslag',
      layerCrsLabel: 'CRS',
      noVectorLayers: 'Inga vektorlager hittades för projektet. Generering körs med alla tillgängliga lager.',
      selectionAll: 'all'
    }
  };

  const layerSlug = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'layer';

  const lang = () => {
    const raw = String(window.qtilerLang?.get?.() || 'en').toLowerCase();
    if (raw.startsWith('es')) return 'es';
    if (raw.startsWith('sv')) return 'sv';
    return 'en';
  };

  const t = (key) => (i18n[lang()] || i18n.en)[key] || i18n.en[key] || key;

  const tr = (key, replacements = {}) => {
    const template = t(key);
    return String(template).replace(/\{(\w+)\}/g, (_, token) => (token in replacements ? replacements[token] : ''));
  };

  const unionBounds = (items) => {
    let out = null;
    for (const b of items) {
      if (!Array.isArray(b) || b.length !== 4) continue;
      const n = b.map((v) => Number(v));
      if (!n.every((v) => Number.isFinite(v))) continue;
      if (!out) {
        out = n.slice();
      } else {
        out[0] = Math.min(out[0], n[0]);
        out[1] = Math.min(out[1], n[1]);
        out[2] = Math.max(out[2], n[2]);
        out[3] = Math.max(out[3], n[3]);
      }
    }
    return out;
  };

  const suggestedMinZoomFromBounds = (bounds) => {
    if (!Array.isArray(bounds) || bounds.length !== 4) return null;
    const minLon = Number(bounds[0]);
    const minLat = Number(bounds[1]);
    const maxLon = Number(bounds[2]);
    const maxLat = Number(bounds[3]);
    if (![minLon, minLat, maxLon, maxLat].every((v) => Number.isFinite(v))) return null;
    const lonSpan = Math.max(0.000001, Math.abs(maxLon - minLon));
    const latSpan = Math.max(0.000001, Math.abs(maxLat - minLat));
    const span = Math.max(lonSpan, latSpan);
    // Fit selected extent in roughly 2 tiles across as a practical default.
    const z = Math.floor(Math.log2(720 / span));
    return Math.max(0, Math.min(22, Number.isFinite(z) ? z : 0));
  };

  const api = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    if (!response.ok) {
      let payload = null;
      try { payload = await response.json(); } catch {}
      throw new Error(payload?.details || payload?.error || `HTTP ${response.status}`);
    }
    if (response.status === 204) return null;
    return response.json();
  };

  const copyText = async (text) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'absolute';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    document.body.removeChild(area);
  };

  const showStatus = (msg, isError = false) => {
    const status = document.getElementById('status');
    if (!status) return;
    status.innerHTML = `<div class="status ${isError ? 'error' : ''}">${String(msg || '')}</div>`;
  };

  const tileJsonUrl = (projectId) => `/plugins/VectorTiles/tilejson/${encodeURIComponent(projectId)}.json`;
  const tileTemplateUrl = (projectId) => `${window.location.origin}/plugins/VectorTiles/tiles/${encodeURIComponent(projectId)}/{z}/{x}/{y}.pbf`;
  const layerStyleUrl = (projectId, layerName) => {
    const slug = layerSlug(layerName);
    const base = `${window.location.origin}/plugins/VectorTiles/style/${encodeURIComponent(projectId)}/${encodeURIComponent(slug)}.json`;
    return `${base}?layers=${encodeURIComponent(String(layerName || ''))}`;
  };

  const loadProjectLayers = async (projectId) => {
    if (!projectId) return [];
    const payload = await api(`${API_BASE}/projects/${encodeURIComponent(projectId)}/layers`);
    return Array.isArray(payload?.layers) ? payload.layers : [];
  };

  const askLayerSelection = async (projectId) => {
    const layers = await loadProjectLayers(projectId);
    if (!layers.length) {
      showStatus(t('noVectorLayers'));
      return [];
    }

    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'schedule-backdrop';
      backdrop.dataset.open = '1';

      const dialog = document.createElement('div');
      dialog.className = 'schedule-dialog';
      dialog.style.maxWidth = '760px';

      const title = document.createElement('h3');
      title.textContent = t('generationModalTitle');

      const intro = document.createElement('p');
      intro.className = 'dialog-description';
      intro.textContent = t('generationModalIntro');

      const zoomRow = document.createElement('div');
      zoomRow.style.display = 'grid';
      zoomRow.style.gridTemplateColumns = 'repeat(auto-fit, minmax(160px, 1fr))';
      zoomRow.style.gap = '10px';

      const minWrap = document.createElement('label');
      minWrap.className = 'schedule-field';
      const minLabel = document.createElement('span');
      minLabel.textContent = t('minZoomLabel');
      const minInput = document.createElement('input');
      minInput.type = 'number';
      minInput.min = '0';
      minInput.max = '22';
      minInput.step = '1';
      minInput.value = '6';
      minWrap.append(minLabel, minInput);

      const maxWrap = document.createElement('label');
      maxWrap.className = 'schedule-field';
      const maxLabel = document.createElement('span');
      maxLabel.textContent = t('maxZoomLabel');
      const maxInput = document.createElement('input');
      maxInput.type = 'number';
      maxInput.min = '0';
      maxInput.max = '22';
      maxInput.step = '1';
      maxInput.value = '14';
      maxWrap.append(maxLabel, maxInput);
      zoomRow.append(minWrap, maxWrap);

      const toolsRow = document.createElement('div');
      toolsRow.style.display = 'flex';
      toolsRow.style.gap = '8px';
      toolsRow.style.marginTop = '8px';
      toolsRow.style.flexWrap = 'wrap';

      const selectAllBtn = document.createElement('button');
      selectAllBtn.type = 'button';
      selectAllBtn.className = 'btn btn-secondary btn-sm';
      selectAllBtn.textContent = t('selectAllLayers');

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'btn btn-secondary btn-sm';
      clearBtn.textContent = t('clearLayerSelection');
      toolsRow.append(selectAllBtn, clearBtn);

      const hint = document.createElement('div');
      hint.className = 'meta';
      hint.style.marginTop = '8px';
      hint.textContent = t('generationHint');

      const suggestionRow = document.createElement('div');
      suggestionRow.className = 'meta';
      suggestionRow.style.marginTop = '6px';
      suggestionRow.style.display = 'flex';
      suggestionRow.style.alignItems = 'center';
      suggestionRow.style.gap = '8px';

      const suggestionText = document.createElement('span');
      suggestionText.textContent = '';

      const useSuggestedBtn = document.createElement('button');
      useSuggestedBtn.type = 'button';
      useSuggestedBtn.className = 'btn btn-secondary btn-sm';
      useSuggestedBtn.textContent = t('useSuggestedMin');
      useSuggestedBtn.style.display = 'none';

      suggestionRow.append(suggestionText, useSuggestedBtn);

      const list = document.createElement('div');
      list.style.maxHeight = '340px';
      list.style.overflow = 'auto';
      list.style.border = '1px solid var(--border)';
      list.style.borderRadius = '10px';
      list.style.padding = '8px';
      list.style.marginTop = '10px';
      list.style.background = 'var(--card)';

      let suggestedMinZoom = null;
      let minTouched = false;
      const rows = [];
      layers.forEach((layer) => {
        const id = String(layer?.id || '').trim();
        const name = String(layer?.name || id).trim();
        if (!id || !name) return;
        const row = document.createElement('label');
        row.style.display = 'grid';
        row.style.gridTemplateColumns = 'auto 1fr';
        row.style.gap = '10px';
        row.style.padding = '8px 6px';
        row.style.borderBottom = '1px dashed var(--border)';

        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = true;

        const details = document.createElement('div');
        const titleLine = document.createElement('div');
        titleLine.style.fontWeight = '600';
        titleLine.textContent = name;
        const metaLine = document.createElement('div');
        metaLine.className = 'meta';
        const geom = String(layer?.geometry || '').trim();
        const crs = String(layer?.crs || '').trim();
        const chunks = [];
        if (geom) chunks.push(geom);
        if (crs) chunks.push(`${t('layerCrsLabel')}: ${crs}`);
        metaLine.textContent = chunks.join(' · ');
        details.append(titleLine, metaLine);
        row.append(check, details);
        list.appendChild(row);
        rows.push({ id, check, layer });
      });

      selectAllBtn.addEventListener('click', () => rows.forEach((r) => { r.check.checked = true; }));
      clearBtn.addEventListener('click', () => rows.forEach((r) => { r.check.checked = false; }));

      const updateSuggestedMin = () => {
        const selectedBounds = rows
          .filter((r) => r.check.checked)
          .map((r) => Array.isArray(r.layer?.extent_wgs84) ? r.layer.extent_wgs84 : null)
          .filter(Boolean);
        const union = unionBounds(selectedBounds);
        suggestedMinZoom = suggestedMinZoomFromBounds(union);
        if (suggestedMinZoom == null) {
          suggestionText.textContent = '';
          useSuggestedBtn.style.display = 'none';
          return;
        }
        suggestionText.textContent = tr('suggestedMinZoom', { value: suggestedMinZoom });
        useSuggestedBtn.style.display = 'inline-flex';
        if (!minTouched) {
          minInput.value = String(suggestedMinZoom);
        }
      };

      useSuggestedBtn.addEventListener('click', () => {
        if (suggestedMinZoom == null) return;
        minInput.value = String(suggestedMinZoom);
      });

      minInput.addEventListener('input', () => { minTouched = true; });
      rows.forEach((r) => r.check.addEventListener('change', updateSuggestedMin));
      selectAllBtn.addEventListener('click', updateSuggestedMin);
      clearBtn.addEventListener('click', updateSuggestedMin);
      updateSuggestedMin();

      const errorRow = document.createElement('div');
      errorRow.style.minHeight = '18px';
      errorRow.style.marginTop = '8px';
      errorRow.style.color = 'var(--danger, #b42318)';
      errorRow.style.fontSize = '13px';

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.justifyContent = 'flex-end';
      actions.style.gap = '8px';
      actions.style.marginTop = '12px';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-secondary';
      cancelBtn.textContent = t('Cancel') || 'Cancel';

      const submitBtn = document.createElement('button');
      submitBtn.type = 'button';
      submitBtn.className = 'btn btn-primary';
      submitBtn.textContent = t('startGeneration');

      actions.append(cancelBtn, submitBtn);
      dialog.append(title, intro, zoomRow, toolsRow, hint, suggestionRow, list, errorRow, actions);
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);

      const cleanup = (value) => {
        try { document.removeEventListener('keydown', onKeyDown); } catch {}
        try { backdrop.remove(); } catch {}
        resolve(value || null);
      };

      const onKeyDown = (event) => {
        if (event.key === 'Escape') cleanup(null);
      };

      cancelBtn.addEventListener('click', () => cleanup(null));
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) cleanup(null);
      });
      document.addEventListener('keydown', onKeyDown);

      submitBtn.addEventListener('click', () => {
        errorRow.textContent = '';
        const minZoom = Number.parseInt(minInput.value, 10);
        const maxZoom = Number.parseInt(maxInput.value, 10);
        if (!Number.isFinite(minZoom) || !Number.isFinite(maxZoom) || minZoom < 0 || maxZoom < 0 || minZoom > 22 || maxZoom > 22 || minZoom > maxZoom) {
          errorRow.textContent = t('zoomValidation');
          return;
        }
        const selectedLayerIds = rows.filter((r) => r.check.checked).map((r) => r.id);
        if (!selectedLayerIds.length) {
          errorRow.textContent = t('layerSelectionValidation');
          return;
        }
        cleanup({ minZoom, maxZoom, selectedLayerIds });
      });
    });
  };

  const loadTileJsonMetadata = async (projectId) => {
    const fallback = { minzoom: 0, maxzoom: 14, bounds: null };
    try {
      const response = await fetch(tileJsonUrl(projectId), { credentials: 'include' });
      if (!response.ok) return fallback;
      const payload = await response.json().catch(() => null);
      if (!payload || typeof payload !== 'object') return fallback;
      const minzoom = Number.isFinite(Number(payload.minzoom)) ? Number(payload.minzoom) : fallback.minzoom;
      const maxzoom = Number.isFinite(Number(payload.maxzoom)) ? Number(payload.maxzoom) : fallback.maxzoom;
      const bounds = Array.isArray(payload.bounds) && payload.bounds.length === 4 ? payload.bounds : null;
      return { minzoom, maxzoom, bounds };
    } catch {
      return fallback;
    }
  };

  const hasReadyTileset = async (projectId) => {
    if (!projectId) return false;
    try {
      const payload = await api(`${API_BASE}/tilesets`);
      const tilesets = Array.isArray(payload?.tilesets) ? payload.tilesets : [];
      return tilesets.some((item) => String(item?.projectId || '') === String(projectId));
    } catch {
      return false;
    }
  };

  const pollJobUntilDone = async (jobId, projectId, { timeoutMs = JOB_WAIT_TIMEOUT_MS, intervalMs = 1500 } = {}) => {
    let currentJobId = String(jobId || '').trim();
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      let payload = null;
      try {
        payload = await api(`${API_BASE}/jobs/${encodeURIComponent(currentJobId)}`);
      } catch (err) {
        const msg = String(err?.message || '');
        if (msg === 'job_not_found') {
          const jobs = await fetchJobs().catch(() => []);
          const active = projectActiveJob(jobs, projectId);
          const activeId = String(active?.id || '').trim();
          if (activeId && activeId !== currentJobId) {
            currentJobId = activeId;
            continue;
          }
          if (await hasReadyTileset(projectId)) {
            return { id: currentJobId, status: 'completed', projectId };
          }
        }
        throw err;
      }
      const job = payload?.job || null;
      if (!job) {
        const jobs = await fetchJobs().catch(() => []);
        const active = projectActiveJob(jobs, projectId);
        const activeId = String(active?.id || '').trim();
        if (activeId && activeId !== currentJobId) {
          currentJobId = activeId;
          continue;
        }
        if (await hasReadyTileset(projectId)) {
          return { id: currentJobId, status: 'completed', projectId };
        }
        throw new Error('job_not_found');
      }
      if (job.status === 'completed') return job;
      if (job.status === 'cancelled') throw new Error(t('cancelled'));
      if (job.status === 'error') throw new Error(job.error || 'vector_tile_generation_failed');
      if (job.status === 'running') {
        showStatus(`${t('running')}: ${job.projectId}`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error('job_timeout');
  };

  const fetchJobs = async () => {
    const payload = await api(`${API_BASE}/jobs`);
    return Array.isArray(payload?.jobs) ? payload.jobs : [];
  };

  const projectActiveJob = (jobs, projectId) => {
    if (!Array.isArray(jobs) || !projectId) return null;
    const running = jobs.find((j) => j && j.projectId === projectId && j.status === 'running');
    if (running) return running;
    return jobs.find((j) => j && j.projectId === projectId && j.status === 'queued') || null;
  };

  const setGenerateBtnMode = (btn, mode, { jobId = '' } = {}) => {
    if (!btn) return;
    const normalized = mode === 'generating' ? 'generating' : mode === 'aborting' ? 'aborting' : 'idle';
    btn.dataset.mode = normalized;
    btn.dataset.jobId = jobId || '';
    btn.disabled = normalized === 'aborting';
    if (normalized === 'generating') {
      btn.textContent = t('abort');
    } else if (normalized === 'aborting') {
      btn.textContent = t('aborting');
    } else {
      btn.textContent = t('generate');
    }
  };

  const syncGenerateButtonsWithJobs = async () => {
    let jobs = [];
    try {
      jobs = await fetchJobs();
    } catch {
      jobs = [];
    }

    document.querySelectorAll('.project-block[data-project-id]').forEach((wrap) => {
      const pid = wrap.getAttribute('data-project-id');
      const btn = wrap.querySelector(`.${BTN_CLASS}`);
      if (!btn || !pid) return;
      const active = projectActiveJob(jobs, pid);
      if (active) {
        setGenerateBtnMode(btn, 'generating', { jobId: active.id || '' });
      } else {
        setGenerateBtnMode(btn, 'idle');
      }
    });
  };

  const zoomToWebMercatorScale = (zoom) => {
    const z = Number(zoom);
    if (!Number.isFinite(z) || z < 0) return null;
    const initialResolution = 156543.03392804097;
    const resolution = initialResolution / Math.pow(2, z);
    const scale = resolution / 0.00028;
    if (!Number.isFinite(scale) || scale <= 0) return null;
    return Math.round(scale);
  };

  const registerInfoTab = () => {
    const hooks = window.qtilerPluginHooks || { layerInfoTabs: [] };
    window.qtilerPluginHooks = hooks;
    if (!Array.isArray(hooks.layerInfoTabs)) hooks.layerInfoTabs = [];

    const existing = hooks.layerInfoTabs.find((tab) => tab && tab.id === 'vectortiles-info');
    if (existing) {
      existing.title = t('infoTabTitle');
      return;
    }

    hooks.layerInfoTabs.push({
      id: 'vectortiles-info',
      title: t('infoTabTitle'),
      shouldShow: ({ projectId }) => !!projectId,
      render: async ({ projectId, layerData, container }) => {
        const root = container || document.createElement('div');
        root.innerHTML = '';

        const status = document.createElement('div');
        status.className = 'meta';
        status.style.marginBottom = '8px';
        status.textContent = t('infoIntro');
        root.appendChild(status);

        const infoList = document.createElement('div');
        infoList.className = 'meta';
        infoList.style.display = 'grid';
        infoList.style.gap = '6px';
        infoList.style.marginBottom = '10px';
        infoList.innerHTML = `
          <div><strong>${t('infoProject')}:</strong> ${String(projectId || '')}</div>
          <div><strong>${t('infoLayer')}:</strong> ${String(layerData?.name || '')}</div>
        `;
        root.appendChild(infoList);

        const tilejson = tileJsonUrl(projectId);
        const template = tileTemplateUrl(projectId);
        const tilejsonAbs = `${window.location.origin}${tilejson}`;
        const currentLayerName = String(layerData?.name || '').trim();
        const layerStyle = currentLayerName ? layerStyleUrl(projectId, currentLayerName) : '';
        const tileMeta = await loadTileJsonMetadata(projectId);
        const minzoom = tileMeta.minzoom;
        const maxzoom = tileMeta.maxzoom;
        const bounds = tileMeta.bounds;
        const arcgisMinScale = zoomToWebMercatorScale(minzoom);
        const arcgisMaxScale = zoomToWebMercatorScale(maxzoom);

        const makeUrlRow = (label, value, copyValue) => {
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.gap = '8px';
          row.style.alignItems = 'center';
          row.style.marginBottom = '8px';

          const input = document.createElement('input');
          input.type = 'text';
          input.readOnly = true;
          input.value = value;
          input.style.flex = '1';
          input.style.fontFamily = 'Consolas, Monaco, monospace';
          input.style.fontSize = '12px';

          const copyBtn = document.createElement('button');
          copyBtn.type = 'button';
          copyBtn.className = 'btn btn-secondary btn-sm';
          copyBtn.textContent = t('copy');
          copyBtn.addEventListener('click', async () => {
            try {
              await copyText(copyValue);
              showStatus(t('copyOk'));
            } catch {
              showStatus(t('copyError'), true);
            }
          });

          const labelEl = document.createElement('div');
          labelEl.className = 'meta';
          labelEl.style.fontWeight = '600';
          labelEl.style.marginBottom = '4px';
          labelEl.textContent = label;

          const wrap = document.createElement('div');
          wrap.style.width = '100%';
          wrap.appendChild(labelEl);
          row.appendChild(input);
          row.appendChild(copyBtn);
          wrap.appendChild(row);
          return wrap;
        };

        root.appendChild(makeUrlRow(t('infoTileJson'), tilejsonAbs, tilejsonAbs));
        root.appendChild(makeUrlRow(t('infoTemplate'), template, template));
        if (layerStyle) {
          root.appendChild(makeUrlRow(t('layerStyleUrl'), layerStyle, layerStyle));
        }

        const statusRow = document.createElement('div');
        statusRow.className = 'meta';
        statusRow.textContent = t('infoStatusMissing');
        root.appendChild(statusRow);

        try {
          const probe = await fetch(tilejson, { credentials: 'include' });
          if (probe.ok) {
            statusRow.textContent = t('infoStatusReady');
          }
        } catch {}

        const useRow = document.createElement('div');
        useRow.className = 'meta';
        useRow.style.marginTop = '8px';
        useRow.textContent = t('infoUseIn');
        root.appendChild(useRow);

        const snippetsTitle = document.createElement('div');
        snippetsTitle.className = 'meta';
        snippetsTitle.style.marginTop = '12px';
        snippetsTitle.style.fontWeight = '700';
        snippetsTitle.textContent = t('snippets');
        root.appendChild(snippetsTitle);

        const snippetRows = [
          {
            label: t('snippetQgis'),
            value: template
          },
          {
            label: t('snippetArcgis'),
            value: JSON.stringify({
              type: 'vector-tile',
              url: tilejsonAbs,
              title: `${projectId} vector tiles`,
              minScale: arcgisMinScale,
              maxScale: arcgisMaxScale
            }, null, 2)
          },
          {
            label: t('snippetOrigo'),
            value: JSON.stringify({
              id: `${projectId}-vectortiles`,
              name: `${projectId} vector`,
              type: 'MVT',
              url: template,
              minZoom: minzoom,
              maxZoom: maxzoom,
              visible: true
            }, null, 2)
          },
          {
            label: t('snippetHajk'),
            value: JSON.stringify({
              type: 'vectorTiles',
              title: `${projectId} vector tiles`,
              url: template,
              minZoom: minzoom,
              maxZoom: maxzoom,
              bbox: bounds
            }, null, 2)
          }
        ];

        snippetRows.forEach((snippet) => {
          root.appendChild(makeUrlRow(snippet.label, snippet.value, snippet.value));
        });

        return root;
      }
    });
  };

  const addProjectActions = (wrap) => {
    if (!wrap || wrap.classList.contains('external-wms-block')) return;
    const projectId = wrap.getAttribute('data-project-id');
    if (!projectId) return;

    const heading = wrap.querySelector('.project-heading');
    if (!heading) return;

    let actions = heading.querySelector('.qtiler-vectortiles-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'qtiler-vectortiles-actions';
      actions.style.display = 'flex';
      actions.style.gap = '8px';
      actions.style.marginLeft = '8px';
      heading.appendChild(actions);
    }

    if (!actions.querySelector(`.${BTN_CLASS}`)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn btn-secondary ${BTN_CLASS}`;
      setGenerateBtnMode(btn, 'idle');
      btn.addEventListener('click', async () => {
        const mode = btn.dataset.mode || 'idle';
        if (mode === 'generating') {
          try {
            setGenerateBtnMode(btn, 'aborting');
            let jobId = btn.dataset.jobId || '';
            if (!jobId) {
              const jobs = await fetchJobs();
              const active = projectActiveJob(jobs, projectId);
              jobId = active?.id || '';
            }
            if (jobId) {
              await api(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
            }
            showStatus(`${t('cancelled')}: ${projectId}`);
          } catch (err) {
            const msg = String(err?.message || '');
            if (msg !== 'job_not_found' && msg !== 'job_not_cancellable') {
              showStatus(`${t('failed')}: ${msg || err}`, true);
            }
          } finally {
            await syncGenerateButtonsWithJobs();
          }
          return;
        }

        let selection = null;
        try {
          selection = await askLayerSelection(projectId);
          if (!selection) return;
        } catch (selectionErr) {
          showStatus(selectionErr?.message || t('failed'), true);
          return;
        }
        const { minZoom, maxZoom, selectedLayerIds } = selection;
        setGenerateBtnMode(btn, 'generating');
        try {
          let queued = null;
          try {
            queued = await api(`${API_BASE}/generate`, {
              method: 'POST',
              body: JSON.stringify({ projectId, minZoom, maxZoom, selectedLayerIds })
            });
          } catch (firstErr) {
            const firstMsg = String(firstErr?.message || '');
            if (firstMsg === 'job_already_running_for_project') {
              const jobs = await fetchJobs();
              const active = projectActiveJob(jobs, projectId);
              setGenerateBtnMode(btn, 'generating', { jobId: active?.id || '' });
              showStatus(`${t('running')}: ${projectId}`);
              return;
            }
            if (firstMsg !== 'tileset_exists') throw firstErr;
            if (!confirm(t('confirmOverwrite'))) {
              setGenerateBtnMode(btn, 'idle');
              return;
            }
            queued = await api(`${API_BASE}/generate`, {
              method: 'POST',
              body: JSON.stringify({ projectId, minZoom, maxZoom, selectedLayerIds, overwrite: true })
            });
          }
          const jobId = queued?.job?.id;
          setGenerateBtnMode(btn, 'generating', { jobId: jobId || '' });
          showStatus(`${t('queued')}: ${projectId}`);
          if (jobId) {
            await pollJobUntilDone(jobId, projectId);
          }
          showStatus(`${t('ready')}: ${projectId}`);
          upsertReadyControls(wrap, projectId);
        } catch (error) {
          const errMsg = String(error?.message || '');
          if (errMsg === 'job_timeout') {
            showStatus(t('timeoutRunning'));
            return;
          }
          if (errMsg === 'job_not_found') {
            const jobs = await fetchJobs().catch(() => []);
            const active = projectActiveJob(jobs, projectId);
            if (active) {
              setGenerateBtnMode(btn, 'generating', { jobId: active.id || '' });
              showStatus(`${t('running')}: ${projectId}`);
              return;
            }
            if (await hasReadyTileset(projectId)) {
              showStatus(`${t('ready')}: ${projectId}`);
              upsertReadyControls(wrap, projectId);
              return;
            }
          }
          showStatus(`${t('failed')}: ${errMsg || error}`, true);
        } finally {
          await syncGenerateButtonsWithJobs();
        }
      });
      actions.appendChild(btn);
    }
  };

  const upsertReadyControls = (wrap, projectId) => {
    const heading = wrap.querySelector('.project-heading');
    if (!heading) return;
    let actions = heading.querySelector('.qtiler-vectortiles-actions');
    if (!actions) return;

    if (!actions.querySelector(`.${BADGE_CLASS}`)) {
      const badge = document.createElement('span');
      badge.className = BADGE_CLASS;
      badge.style.display = 'inline-flex';
      badge.style.alignItems = 'center';
      badge.style.borderRadius = '999px';
      badge.style.padding = '3px 8px';
      badge.style.fontSize = '.75rem';
      badge.style.fontWeight = '700';
      badge.style.background = '#e2e8f0';
      badge.textContent = t('sourceTag');
      actions.appendChild(badge);
    }

    if (!actions.querySelector('[data-vt-open]')) {
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'btn btn-secondary';
      openBtn.setAttribute('data-vt-open', '1');
      openBtn.textContent = t('openTileJson');
      openBtn.addEventListener('click', () => {
        window.open(tileJsonUrl(projectId), '_blank', 'noopener');
      });
      actions.appendChild(openBtn);
    }

    if (!actions.querySelector('[data-vt-copy]')) {
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn btn-secondary';
      copyBtn.setAttribute('data-vt-copy', '1');
      copyBtn.textContent = t('copyTileUrl');
      copyBtn.addEventListener('click', async () => {
        try {
          await copyText(tileTemplateUrl(projectId));
          showStatus(t('copyOk'));
        } catch {
          showStatus(t('copyError'), true);
        }
      });
      actions.appendChild(copyBtn);
    }
  };

  const refreshExistingTilesets = async () => {
    const payload = await api(`${API_BASE}/tilesets`);
    const arr = Array.isArray(payload?.tilesets) ? payload.tilesets : [];
    const byProject = new Set(arr.map((item) => item.projectId));
    document.querySelectorAll('.project-block[data-project-id]').forEach((wrap) => {
      addProjectActions(wrap);
      const pid = wrap.getAttribute('data-project-id');
      if (pid && byProject.has(pid)) {
        upsertReadyControls(wrap, pid);
      }
    });
  };

  const mount = async () => {
    registerInfoTab();
    const layers = document.getElementById('layers');
    if (!layers) return;
    const observer = new MutationObserver(() => {
      document.querySelectorAll('.project-block[data-project-id]').forEach(addProjectActions);
    });
    observer.observe(layers, { childList: true, subtree: true });
    await refreshExistingTilesets();
    await syncGenerateButtonsWithJobs();
    setInterval(() => {
      syncGenerateButtonsWithJobs().catch(() => {});
    }, JOB_REFRESH_INTERVAL_MS);
    if (window.qtilerLang?.subscribe) {
      window.qtilerLang.subscribe(() => {
        registerInfoTab();
        document.querySelectorAll(`.${BTN_CLASS}`).forEach((btn) => {
          setGenerateBtnMode(btn, btn.dataset.mode || 'idle', { jobId: btn.dataset.jobId || '' });
        });
        document.querySelectorAll('[data-vt-open]').forEach((btn) => { btn.textContent = t('openTileJson'); });
        document.querySelectorAll('[data-vt-copy]').forEach((btn) => { btn.textContent = t('copyTileUrl'); });
        document.querySelectorAll(`.${BADGE_CLASS}`).forEach((badge) => { badge.textContent = t('sourceTag'); });
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      mount().catch(() => {});
    });
  } else {
    mount().catch(() => {});
  }
})();
