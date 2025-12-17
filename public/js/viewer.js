(async () => {

  const footerYearEl = document.getElementById('viewer_footer_year');
  if (footerYearEl) footerYearEl.textContent = String(new Date().getFullYear());

    const params = new URLSearchParams(location.search);
    const infoEl = document.getElementById('info');
    const languageSelect = document.getElementById('language_selector');

    const viewerState = {
      project: params.get('project'),
      theme: params.get('theme'),
      layer: params.get('layer')
    };

    const displayMode = 'cache';
    const showCache = true;
    const showRemote = false;
    const tileTemplate = viewerState.theme
      ? `/wmts/${encodeURIComponent(viewerState.project || '')}/themes/${encodeURIComponent(viewerState.theme || '')}/{z}/{x}/{y}.png`
      : `/wmts/${encodeURIComponent(viewerState.project || '')}/${encodeURIComponent(viewerState.layer || '')}/{z}/{x}/{y}.png`;
    const tileTemplateLabel = tileTemplate.replace('{z}', '{z}');
    const modeLabelKey = 'viewer.mode.cache';

    const SUPPORTED_LANGS = (window.qtilerLang && Array.isArray(window.qtilerLang.SUPPORTED_LANGS))
      ? window.qtilerLang.SUPPORTED_LANGS
      : ['en', 'es', 'sv'];
    const normalizeLang = window.qtilerLang?.normalize || ((value) => {
      const raw = String(value || '').toLowerCase();
      if (SUPPORTED_LANGS.includes(raw)) return raw;
      const base = raw.split('-')[0];
      return SUPPORTED_LANGS.includes(base) ? base : 'en';
    });
    let currentLang = window.qtilerLang?.get?.() || normalizeLang(localStorage.getItem('qtiler.lang') || navigator.language || 'en');
    // Translations centralized in /public/lang-support.js (window.TRANSLATIONS)

    const parseProj4PresetsDataset = () => {
      const encoded = document.body?.dataset?.proj4Presets;
      if (!encoded) return {};
      try {
        return JSON.parse(decodeURIComponent(encoded));
      } catch (err) {
        console.warn('Failed to parse proj4 presets payload', err);
        return {};
      }
    };

    const PROJ4_PRESETS = Object.freeze(parseProj4PresetsDataset());

    const ensureProj4Definition = (code) => {
      if (typeof proj4 === 'undefined' || typeof proj4.defs !== 'function') return false;
      if (!code || typeof code !== 'string') return false;
      const key = code.trim();
      if (!key) return false;
      if (proj4.defs(key)) return true;
      const upper = key.toUpperCase();
      if (proj4.defs(upper)) {
        if (upper !== key) proj4.defs(key, proj4.defs(upper));
        return true;
      }
      const preset = PROJ4_PRESETS[upper];
      if (!preset) return false;
      proj4.defs(upper, preset);
      if (upper !== key) {
        proj4.defs(key, proj4.defs(upper));
      }
      return true;
    };

    const viewerData = {
      project: viewerState.project,
      theme: viewerState.theme,
      layer: viewerState.layer,
      displayMode,
      showCache,
      showRemote,
      tileTemplate,
      tileTemplateLabel,
      modeLabelKey,
      loading: true,
      meta: null,
      cacheMeta: null,
      layerMeta: null,
      themeMeta: null,
      messages: []
    };

    const escapeHtml = (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const formatNumber = (value) => {
      if (!Number.isFinite(value)) return null;
      try {
        return new Intl.NumberFormat(currentLang).format(value);
      } catch {
        return String(value);
      }
    };

    const isFiniteLatLng = (value) => !!value && Number.isFinite(value.lat) && Number.isFinite(value.lng);

    let refreshCacheControlLabel = () => {};
    let refreshOsmControlLabel = () => {};

    const tr = (key, params = {}) => {
      if (!key) return '';
      const table = TRANSLATIONS[currentLang] || {};
      const fallback = TRANSLATIONS.en && TRANSLATIONS.en[key];
      const template = table[key] ?? fallback ?? key;
      return template.replace(/\{(\w+)\}/g, (_, token) => {
        if (Object.prototype.hasOwnProperty.call(params, token)) {
          return params[token];
        }
        return '';
      });
    };

    const renderInfo = () => {
      if (!infoEl) return;
      if (viewerData.loading) {
        infoEl.textContent = tr('viewer.loading');
        return;
      }
      const parts = [];
      const projectLabel = escapeHtml(viewerData.project || tr('viewer.value.unknown'));
      parts.push(`<div style="font-weight:600">${tr('viewer.info.project', { value: projectLabel })}</div>`);
      if (viewerData.theme) {
        parts.push(`<div>${tr('viewer.info.theme', { value: escapeHtml(viewerData.theme) })}</div>`);
      } else {
        parts.push(`<div>${tr('viewer.info.layer', { value: escapeHtml(viewerData.layer || tr('viewer.value.unknown')) })}</div>`);
      }
      parts.push(`<div>${tr('viewer.info.mode', { value: tr(viewerData.modeLabelKey) })}</div>`);
      const templateValue = viewerData.tileTemplateLabel
        ? `<code>${escapeHtml(viewerData.tileTemplateLabel)}</code>`
        : tr('viewer.value.notAvailable');
      parts.push(`<div>${tr('viewer.info.template', { value: templateValue })}</div>`);

      const detailLines = [];
      const meta = viewerData.meta;
      if (meta) {
        const zoomMin = Number.isFinite(meta.zoom_min) ? formatNumber(meta.zoom_min) : tr('viewer.value.unknown');
        const zoomMax = Number.isFinite(meta.zoom_max) ? formatNumber(meta.zoom_max) : tr('viewer.value.unknown');
        detailLines.push(tr('viewer.info.zoomRange', { min: zoomMin, max: zoomMax }));
        if (Number.isFinite(meta.tile_count)) {
          detailLines.push(tr('viewer.info.tiles', { count: formatNumber(meta.tile_count) }));
        }
        const layerCrs = meta.crs ? escapeHtml(meta.crs) : tr('viewer.value.notAvailable');
        detailLines.push(tr('viewer.info.layerCrs', { crs: layerCrs }));
        if (meta.tile_crs) {
          detailLines.push(tr('viewer.info.tileCrs', { crs: escapeHtml(meta.tile_crs) }));
        }
      } else {
        detailLines.push(tr('viewer.info.metadataUnavailable'));
      }
      parts.push(detailLines.map((line) => `<div>${line}</div>`).join(''));

      viewerData.messages.forEach((msg) => {
        const tone = msg.type || 'info';
        const color = tone === 'error' ? '#f66' : tone === 'warn' ? '#fbbf24' : '#dff';
        parts.push(`<div style="margin-top:6px;color:${color}">${tr(msg.key, msg.params || {})}</div>`);
      });

      infoEl.innerHTML = parts.join('');
    };

    const applyTranslations = () => {
      if (document?.documentElement) {
        document.documentElement.setAttribute('lang', currentLang);
      }
      const pageTitle = document.querySelector('title[data-i18n="viewer.pageTitle"]');
      if (pageTitle) pageTitle.textContent = tr('viewer.pageTitle');
      document.querySelectorAll('[data-i18n]').forEach((el) => {
        if (el === infoEl) return;
        const key = el.getAttribute('data-i18n');
        if (!key) return;
        el.textContent = tr(key);
      });
      if (languageSelect) {
        languageSelect.value = currentLang;
      }
      refreshCacheControlLabel();
      refreshOsmControlLabel();
      renderInfo();
    };

    const setLanguage = (lang) => {
      if (window.qtilerLang?.set) {
        window.qtilerLang.set(lang);
        return;
      }
      currentLang = normalizeLang(lang);
      try {
        localStorage.setItem('qtiler.lang', currentLang);
      } catch {}
      applyTranslations();
    };

    if (languageSelect) {
      languageSelect.value = currentLang;
      languageSelect.addEventListener('change', (event) => setLanguage(event.target.value));
    }

    if (window.qtilerLang?.subscribe) {
      window.qtilerLang.subscribe((lang) => {
        const normalized = normalizeLang(lang);
        if (normalized === currentLang) return;
        currentLang = normalized;
        applyTranslations();
      });
    }

    const missingLayerOrTheme = !viewerData.layer && !viewerData.theme;
    const missingProject = !viewerData.project;

    if (missingLayerOrTheme) {
      viewerData.messages.push({ type: 'error', key: 'viewer.error.missingLayerOrTheme' });
    }
    if (missingProject) {
      viewerData.messages.push({ type: 'error', key: 'viewer.error.missingProject' });
    }

    if (missingLayerOrTheme || missingProject) {
      viewerData.loading = false;
      applyTranslations();
      return;
    }

    applyTranslations();

    async function getLayerContext() {
      if (!viewerData.project) return null;
      let cacheEntry = null;
      try {
        const response = await fetch('/cache/' + encodeURIComponent(viewerData.project) + '/index.json');
        if (response.ok) {
          const payload = await response.json();
          cacheEntry = (payload.layers || []).find((entry) => {
            if (!entry || !entry.name) return false;
            const kind = entry.kind || (entry.theme ? 'theme' : 'layer');
            if (viewerData.theme) return kind === 'theme' && entry.name === viewerData.theme;
            return kind !== 'theme' && entry.name === viewerData.layer;
          }) || null;
        }
      } catch {}

      let layerEntry = null;
      let themeEntry = null;
      try {
        const response = await fetch('/projects/' + encodeURIComponent(viewerData.project) + '/layers');
        if (response.ok) {
          const payload = await response.json();
          if (Array.isArray(payload.layers)) {
            layerEntry = payload.layers.find((item) => item && item.name === viewerData.layer) || null;
          }
          if (Array.isArray(payload.themes)) {
            themeEntry = payload.themes.find((item) => item && item.name === viewerData.theme) || null;
          }
        }
      } catch {}

      const combined = cacheEntry || layerEntry || themeEntry ? {
        ...(layerEntry || {}),
        ...(cacheEntry || {}),
        ...(themeEntry || {})
      } : null;

      return { cacheEntry, layerEntry, themeEntry, combined };
    }

    const metaContext = await getLayerContext();
    viewerData.meta = metaContext?.combined || null;
    viewerData.cacheMeta = metaContext?.cacheEntry || null;
    viewerData.layerMeta = metaContext?.layerEntry || null;
    viewerData.themeMeta = metaContext?.themeEntry || null;
    viewerData.loading = false;
    viewerData.messages = [];
    if (!viewerData.cacheMeta && viewerData.showCache) {
      viewerData.messages.push({ type: 'warn', key: 'viewer.info.noCache' });
    }
    renderInfo();

    if (typeof L === 'undefined') {
      viewerData.messages.push({ type: 'error', key: 'viewer.error.leafletMissing' });
      renderInfo();
      return;
    }

    // --- Configuration for Zoom/Overzoom ---
    const OVERZOOM_DEFAULT = 10; // Allow generous overzoom by default to trigger on-demand
    const MAX_ALLOWED_ZOOM_DEFAULT = 28; // Hard cap for Leaflet
    let extraZoom = OVERZOOM_DEFAULT;
    let maxAllowedZoom = MAX_ALLOWED_ZOOM_DEFAULT;
    const overzoomParam = params.get('overzoom');
    if (overzoomParam) {
      if (overzoomParam === 'full') { extraZoom = 12; maxAllowedZoom = 30; }
      else if (overzoomParam === 'off') { extraZoom = 0; }
      else if (!Number.isNaN(Number(overzoomParam))) { extraZoom = Math.max(0, parseInt(overzoomParam, 10)); }
    }
    const EXTRA_ZOOMS = extraZoom;
    const MAX_ALLOWED_ZOOM = maxAllowedZoom;

    const mapOptions = {
      preferCanvas: true,
      zoomControl: true,
      maxZoom: 18 // Fallback, will be overridden below
    };
    const meta = viewerData.meta;
    if (meta) {
      if (Number.isFinite(meta.zoom_min)) mapOptions.minZoom = meta.zoom_min;
      if (Number.isFinite(meta.zoom_max)) {
        // Allow zooming past the cache limit
        mapOptions.maxZoom = Math.min(meta.zoom_max + EXTRA_ZOOMS, MAX_ALLOWED_ZOOM);
      }
    }

    let crs = null;
    let extentLatLngBounds = null;
    const rawTileCrs = (meta && meta.tile_crs) ? meta.tile_crs : (viewerData.layerMeta && viewerData.layerMeta.crs ? viewerData.layerMeta.crs : null);
    const normalizedTileCrs = typeof rawTileCrs === 'string' ? rawTileCrs.trim().toUpperCase() : null;
    const targetTileCrs = normalizedTileCrs || rawTileCrs || null;
    const targetTileCrsLabel = rawTileCrs || targetTileCrs;
    const hasCustomCrs = targetTileCrs && targetTileCrs !== 'EPSG:3857';
    let invalidBoundsWarned = false;
    const warnInvalidBounds = () => {
      if (invalidBoundsWarned) return;
      invalidBoundsWarned = true;
      viewerData.messages.push({ type: 'warn', key: 'viewer.notice.invalidCustomBounds', params: { crs: escapeHtml(targetTileCrsLabel || 'EPSG:3857') } });
    };

    const trySetLatLngBounds = (candidateCrs, lowerPoint, upperPoint) => {
      if (!candidateCrs || !lowerPoint || !upperPoint) return;
      try {
        const sw = candidateCrs.unproject(lowerPoint);
        const ne = candidateCrs.unproject(upperPoint);
        if (isFiniteLatLng(sw) && isFiniteLatLng(ne)) {
          extentLatLngBounds = L.latLngBounds(sw, ne);
          return;
        }
      } catch {}
      warnInvalidBounds();
    };

    if (hasCustomCrs && typeof proj4 !== 'undefined' && typeof L.Proj !== 'undefined') {
      let def = null;
      if (ensureProj4Definition(targetTileCrs)) {
        def = proj4.defs(targetTileCrs) || proj4.defs(targetTileCrs?.toUpperCase());
      }

      if (!def) {
        viewerData.messages.push({ type: 'warn', key: 'viewer.notice.noProjDefinition' });
      } else {
        let customApplied = false;

        if (meta && meta.tile_matrix_set && meta.tile_matrix_set.top_left_corner && Array.isArray(meta.tile_matrix_set.matrices)) {
          const origin = meta.tile_matrix_set.top_left_corner;
          const matrices = Array.isArray(meta.tile_matrix_set.matrices) ? meta.tile_matrix_set.matrices : [];
          if (!Array.isArray(origin) || origin.length !== 2 || matrices.length === 0) {
            viewerData.messages.push({ type: 'warn', key: 'viewer.notice.noMatrix' });
          } else {
            const matrixZooms = matrices
              .map((m) => {
                if (!m) return null;
                if (typeof m.z === 'number') return m.z;
                if (typeof m.source_level === 'number') return m.source_level;
                const idNum = parseInt(m.identifier, 10);
                return Number.isFinite(idNum) ? idNum : null;
              })
              .filter((z) => Number.isFinite(z));
            const highestZoom = Number.isFinite(meta.zoom_max)
              ? meta.zoom_max
              : (matrixZooms.length ? Math.max(...matrixZooms) : (Number.isFinite(meta.zoom_min) ? meta.zoom_min : 0));
            const lowestZoom = Number.isFinite(meta.zoom_min)
              ? meta.zoom_min
              : (matrixZooms.length ? Math.min(...matrixZooms) : 0);

            const desiredMaxZoom = Math.min(highestZoom + EXTRA_ZOOMS, MAX_ALLOWED_ZOOM);
            const resolutions = new Array(Math.max(desiredMaxZoom, lowestZoom) + 1).fill(null);
            const matricesByZoom = new Map();

            matrices.forEach((m) => {
              if (!m) return;
              let z = m.z;
              if (typeof z !== 'number') {
                if (typeof m.source_level === 'number') z = m.source_level;
                else {
                  const idNum = parseInt(m.identifier, 10);
                  if (Number.isFinite(idNum)) z = idNum;
                }
              }
              if (typeof z !== 'number') return;

              matricesByZoom.set(z, m);
              let r = null;
              if (Number.isFinite(m.resolution)) {
                r = m.resolution;
              } else if (Number.isFinite(m.scale_denominator)) {
                r = m.scale_denominator * 0.00028;
              }
              if (Number.isFinite(r)) {
                resolutions[z] = r;
              }
            });

            for (let z = resolutions.length - 2; z >= 0; z--) {
              if (!Number.isFinite(resolutions[z]) && Number.isFinite(resolutions[z + 1])) {
                resolutions[z] = resolutions[z + 1] * 2;
              }
            }
            for (let z = 1; z < resolutions.length; z++) {
              if (!Number.isFinite(resolutions[z]) && Number.isFinite(resolutions[z - 1])) {
                resolutions[z] = resolutions[z - 1] / 2;
              }
            }

            const filledResolutions = resolutions.map((r) => (Number.isFinite(r) ? r : 1));

            const tileWidth = meta.tile_matrix_set.tile_width || 256;
            const tileHeight = meta.tile_matrix_set.tile_height || 256;
            // Coordinates in index.json are already normalized to [x, y] by generate_cache.py
            const originX = origin[0];
            const originY = origin[1];

            const referenceMatrix = matricesByZoom.get(highestZoom) || matrices[matrices.length - 1];
            const refRes = referenceMatrix?.resolution || filledResolutions[highestZoom] || 1;
            const spanX = (referenceMatrix?.matrix_width || 1) * tileWidth * refRes;
            const spanY = (referenceMatrix?.matrix_height || 1) * tileHeight * refRes;

            const minx = originX;
            const maxx = originX + spanX;
            const maxy = originY;
            const miny = originY - spanY;

            const projectedBounds = L.bounds(L.point(minx, miny), L.point(maxx, maxy));
            const crsOptions = {
              resolutions: filledResolutions,
              origin: [originX, originY],
              bounds: projectedBounds
            };

            try {
              crs = new L.Proj.CRS(targetTileCrs, def, crsOptions);
              mapOptions.crs = crs;
              customApplied = true;
              trySetLatLngBounds(crs, L.point(minx, miny), L.point(maxx, maxy));
              viewerData.messages.push({ type: 'info', key: 'viewer.notice.customMatrix', params: { crs: escapeHtml(targetTileCrsLabel || targetTileCrs || 'EPSG:3857') } });
            } catch {
              customApplied = false;
            }
          }
        }

        if (!customApplied && meta && meta.extent && meta.extent.length === 4) {
          const matrices = (meta.tile_matrix_set && Array.isArray(meta.tile_matrix_set.matrices)) ? meta.tile_matrix_set.matrices : [];
          const matrixZooms = matrices.map((m) => {
            if (!m) return null;
            if (typeof m.z === 'number') return m.z;
            if (typeof m.source_level === 'number') return m.source_level;
            const idNum = parseInt(m.identifier, 10);
            return Number.isFinite(idNum) ? idNum : null;
          }).filter((z) => Number.isFinite(z));

          const highestZoom = Number.isFinite(meta.zoom_max) ? meta.zoom_max : (matrixZooms.length ? Math.max(...matrixZooms) : (Number.isFinite(meta.zoom_min) ? meta.zoom_min : 0));
          const desiredMaxZoom = Math.min(highestZoom + EXTRA_ZOOMS, MAX_ALLOWED_ZOOM);
          const resolutions = new Array(Math.max(0, desiredMaxZoom) + 1).fill(null);

          matrices.forEach((m) => {
            let z = m.z;
            if (typeof z !== 'number') {
              if (typeof m.source_level === 'number') z = m.source_level;
              else {
                const idNum = parseInt(m.identifier, 10);
                if (Number.isFinite(idNum)) z = idNum;
              }
            }
            if (typeof z === 'number' && Number.isFinite(m.resolution)) resolutions[z] = m.resolution;
          });
          for (let z = resolutions.length - 2; z >= 0; z--) {
            if (!Number.isFinite(resolutions[z]) && Number.isFinite(resolutions[z + 1])) resolutions[z] = resolutions[z + 1] * 2;
          }
          for (let z = 1; z < resolutions.length; z++) {
            if (!Number.isFinite(resolutions[z]) && Number.isFinite(resolutions[z - 1])) resolutions[z] = resolutions[z - 1] / 2;
          }
          const filledResolutions = resolutions.map((r) => (Number.isFinite(r) ? r : 1));

          const origin = (meta.tile_matrix_set && Array.isArray(meta.tile_matrix_set.top_left_corner)) ? meta.tile_matrix_set.top_left_corner : null;
          const [minx, miny, maxx, maxy] = meta.extent;
          // Coordinates in index.json are already normalized to [x, y] by generate_cache.py
          const originX = (origin && origin.length === 2) ? origin[0] : minx;
          const originY = (origin && origin.length === 2) ? origin[1] : maxy;

          const crsOptions = {
            resolutions: filledResolutions,
            origin: [originX, originY]
          };
          const projectedBounds = L.bounds(L.point(minx, miny), L.point(maxx, maxy));
          crsOptions.bounds = projectedBounds;

          try {
            crs = new L.Proj.CRS(targetTileCrs, def, crsOptions);
            mapOptions.crs = crs;
            customApplied = true;
            trySetLatLngBounds(crs, L.point(projectedBounds.min.x, projectedBounds.min.y), L.point(projectedBounds.max.x, projectedBounds.max.y));
            viewerData.messages.push({ type: 'info', key: 'viewer.notice.customExtent', params: { crs: escapeHtml(targetTileCrsLabel || targetTileCrs || 'EPSG:3857') } });
          } catch {
            customApplied = false;
          }
        }

        if (!customApplied) {
          viewerData.messages.push({ type: 'warn', key: 'viewer.notice.noMatrix' });
        }
      }
    }

    const map = L.map('map', mapOptions);
    // Prefer project extent (WGS84) for initial view if available, otherwise fall back to grid bounds
    const projectBounds = (meta && Array.isArray(meta.extent_wgs84))
        ? L.latLngBounds(
            [meta.extent_wgs84[1], meta.extent_wgs84[0]],
            [meta.extent_wgs84[3], meta.extent_wgs84[2]]
          )
        : extentLatLngBounds;

    const fallbackCenter = meta && meta.extent && meta.extent.length === 4
      ? [(meta.extent[1] + meta.extent[3]) / 2, (meta.extent[0] + meta.extent[2]) / 2]
      : [0, 0];
    const fallbackZoom = meta ? (meta.zoom_min || 0) : 0;

    const focusProjectExtent = () => {
      let preferredZoom = null;
      if (meta) {
        // Prefer cached_zoom_min (coverage), then last_zoom_min (last run), then zoom_min
        if (Number.isFinite(meta.cached_zoom_min)) preferredZoom = meta.cached_zoom_min;
        else if (Number.isFinite(meta.last_zoom_min)) preferredZoom = meta.last_zoom_min;
      }

      if (projectBounds) {
        map.fitBounds(projectBounds);
        // Only set maxBounds if we have a custom grid extent (extentLatLngBounds)
        // otherwise we might restrict panning too much if projectBounds is small
        if (extentLatLngBounds) {
          try {
            map.setMaxBounds(extentLatLngBounds.pad(0.1));
          } catch {
            map.setMaxBounds(extentLatLngBounds);
          }
        }
        // If we have a specific start zoom (e.g. 11) and fitBounds gave us something smaller (e.g. 5),
        // zoom in to the content.
        if (preferredZoom != null && map.getZoom() < preferredZoom) {
          map.setZoom(preferredZoom);
        }
        return true;
      }
      if (meta && meta.extent && meta.extent.length === 4) {
        map.setView(fallbackCenter, preferredZoom != null ? preferredZoom : fallbackZoom);
        return true;
      }
      map.setView([0, 0], preferredZoom != null ? preferredZoom : fallbackZoom);
      return false;
    };

    focusProjectExtent();

    const extentBtn = document.getElementById('viewer_extent_btn');
    if (extentBtn) {
      extentBtn.addEventListener('click', () => focusProjectExtent());
      if (!projectBounds && !(meta && meta.extent && meta.extent.length === 4)) {
        extentBtn.disabled = true;
        extentBtn.setAttribute('aria-disabled', 'true');
      }
    }

    const cacheBtn = document.getElementById('viewer_cache_btn');
    const cacheStatusEl = document.getElementById('viewer_cache_status');
    const osmBtn = document.getElementById('viewer_osm_btn');
    let autoCacheActive = false;
    let cacheRequestPromise = null;
    let queuedAutoRun = false;
    let autoCacheTimer = null;
    let lastAutoCacheKey = null;
    let osmLayer = null;
    let osmVisible = false;
    const allowOsmOverlay = !hasCustomCrs;
    if (!allowOsmOverlay && targetTileCrsLabel) {
      viewerData.messages.push({
        type: 'warn',
        key: 'viewer.notice.osmUnavailable',
        params: { crs: escapeHtml(targetTileCrsLabel) }
      });
      renderInfo();
    }

    refreshCacheControlLabel = () => {
      if (!cacheBtn) return;
      cacheBtn.textContent = tr(autoCacheActive ? 'viewer.control.cacheStop' : 'viewer.control.cacheStart');
      cacheBtn.classList.toggle('is-active', autoCacheActive);
    };

    const setCacheBusy = (busy) => {
      if (!cacheBtn) return;
      if (busy) {
        cacheBtn.setAttribute('aria-busy', 'true');
      } else {
        cacheBtn.removeAttribute('aria-busy');
      }
    };

    const setCacheStatus = (state, params = {}) => {
      if (!cacheStatusEl) return;
      let key = null;
      if (state === 'busy') key = 'viewer.control.cacheBusy';
      else if (state === 'done') key = 'viewer.control.cacheDone';
      else if (state === 'error') key = 'viewer.control.cacheError';
      else if (state === 'idle' && autoCacheActive) key = 'viewer.control.cacheIdle';
      cacheStatusEl.textContent = key ? tr(key, params) : '';
    };

    refreshOsmControlLabel = () => {
      if (!osmBtn) return;
      const key = osmVisible ? 'viewer.control.osmHide' : 'viewer.control.osmShow';
      osmBtn.textContent = tr(key);
      osmBtn.classList.toggle('is-active', osmVisible);
    };

    const ensureOsmLayer = () => {
      if (osmLayer) return osmLayer;
      osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
        opacity: 0.6
      });
      return osmLayer;
    };

    const setOsmVisibility = (visible) => {
      if (!allowOsmOverlay) {
        osmVisible = false;
        refreshOsmControlLabel();
        return;
      }
      osmVisible = !!visible;
      const layer = ensureOsmLayer();
      if (osmVisible) {
        if (!map.hasLayer(layer)) layer.addTo(map);
      } else if (map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
      refreshOsmControlLabel();
    };

    const projectLatLngToTile = (latlng) => {
      try {
        if (map?.options?.crs && typeof map.options.crs.project === 'function') {
          const projected = map.options.crs.project(latlng);
          if (projected && Number.isFinite(projected.x) && Number.isFinite(projected.y)) {
            return [projected.x, projected.y];
          }
        }
      } catch {}
      return [latlng.lng, latlng.lat];
    };

    const buildCachePayload = () => {
      if (!viewerData.project || !(viewerData.layer || viewerData.theme)) return null;
      const bounds = map.getBounds();
      if (!bounds) return null;
      const zoom = Math.round(map.getZoom());
      if (!Number.isFinite(zoom)) return null;
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const swProj = projectLatLngToTile(L.latLng(sw.lat, sw.lng));
      const neProj = projectLatLngToTile(L.latLng(ne.lat, ne.lng));
      const minx = Math.min(swProj[0], neProj[0]);
      const maxx = Math.max(swProj[0], neProj[0]);
      const miny = Math.min(swProj[1], neProj[1]);
      const maxy = Math.max(swProj[1], neProj[1]);
      const precisionCoords = [minx, miny, maxx, maxy].map((value) => Number(value.toFixed(3)));
      const extentString = precisionCoords.join(',');
      const body = {
        project: viewerData.project,
        zoom_min: zoom,
        zoom_max: zoom,
        project_extent: extentString,
        run_reason: 'viewer-on-demand',
        trigger: 'viewer',
        allow_remote: true
      };
      if (viewerData.layer) body.layer = viewerData.layer;
      if (viewerData.theme) body.theme = viewerData.theme;
      if (targetTileCrs) {
        body.extent_crs = targetTileCrs;
        body.tile_crs = targetTileCrs;
      }
      if (meta?.tile_matrix_preset) {
        body.tile_matrix_preset = meta.tile_matrix_preset;
        body.wmts = true;
        body.scheme = 'auto';
      } else {
        body.scheme = 'xyz';
        body.xyz_mode = 'partial';
      }
      return { body, zoom, extentKey: `${zoom}:${extentString}` };
    };

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const pollJobUntilDone = async (jobId, { timeoutMs = 180000, intervalMs = 2000 } = {}) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        await delay(intervalMs);
        const res = await fetch('/generate-cache/' + encodeURIComponent(jobId) + '?tail=4000');
        if (res.status === 404) {
          return { status: 'unknown' };
        }
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(payload?.details || res.statusText || 'cache_status_failed');
        }
        if (payload?.status && payload.status !== 'running') {
          return payload;
        }
      }
      return { status: 'timeout' };
    };

    const scheduleAutoCache = ({ immediate = false } = {}) => {
      if (!autoCacheActive) return;
      if (autoCacheTimer) {
        clearTimeout(autoCacheTimer);
      }
      autoCacheTimer = setTimeout(() => {
        triggerCacheForCurrentView('auto');
      }, immediate ? 0 : 500);
    };

    const triggerCacheForCurrentView = async (reason = 'manual') => {
      const payload = buildCachePayload();
      if (!payload) {
        if (reason === 'manual') {
          setCacheStatus('error', { message: 'missing_extent' });
        }
        return;
      }
      if (reason === 'auto' && payload.extentKey === lastAutoCacheKey) {
        return;
      }
      lastAutoCacheKey = payload.extentKey;
      if (cacheRequestPromise) {
        queuedAutoRun = reason === 'auto' || queuedAutoRun;
        return cacheRequestPromise;
      }
      setCacheBusy(true);
      setCacheStatus('busy', { zoom: payload.zoom });
      cacheRequestPromise = (async () => {
        const res = await fetch('/generate-cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload.body)
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.id) {
          throw new Error(data?.details || res.statusText || 'cache_request_failed');
        }
        const result = await pollJobUntilDone(data.id);
        if (result.status !== 'completed') {
          throw new Error(result.status || 'cache_failed');
        }
        if (tiles && typeof tiles.redraw === 'function') {
          tiles.redraw();
        }
        setCacheStatus('done', { zoom: payload.zoom });
      })();
      try {
        await cacheRequestPromise;
      } catch (err) {
        setCacheStatus('error', { message: err?.message || err });
      } finally {
        cacheRequestPromise = null;
        setCacheBusy(false);
        if (queuedAutoRun) {
          queuedAutoRun = false;
          scheduleAutoCache();
        } else if (autoCacheActive) {
          setCacheStatus('idle');
        }
      }
    };

    if (cacheBtn) {
      cacheBtn.addEventListener('click', () => {
        autoCacheActive = !autoCacheActive;
        refreshCacheControlLabel();
        if (autoCacheActive) {
          setCacheStatus('idle');
          scheduleAutoCache({ immediate: true });
        } else {
          setCacheStatus('');
        }
      });
    }

    if (osmBtn) {
      if (!allowOsmOverlay) {
        osmBtn.disabled = true;
        osmBtn.setAttribute('aria-disabled', 'true');
        osmVisible = false;
        refreshOsmControlLabel();
      } else {
        osmBtn.addEventListener('click', () => setOsmVisibility(!osmVisible));
        setOsmVisibility(true);
      }
    }

    const zoomDisplayEl = document.getElementById('zoom_display');
    const updateZoomDisplay = () => {
      if (zoomDisplayEl && map) {
        const z = map.getZoom();
        zoomDisplayEl.textContent = 'Zoom: ' + (Math.round(z * 100) / 100).toFixed(2);
      }
    };

    map.on('zoomend moveend', () => {
      updateZoomDisplay();
      if (autoCacheActive) {
        scheduleAutoCache();
      }
    });
    updateZoomDisplay();

    refreshCacheControlLabel();

    const layerOptions = {
      maxZoom: mapOptions.maxZoom,
      minZoom: meta ? meta.zoom_min : 0,
      tileSize: 256,
      errorTileUrl: '',
      attribution: 'Local cache',
      noWrap: true,
      keepBuffer: 2 // Keep more tiles to reduce flickering
    };
    if (extentLatLngBounds) {
      layerOptions.bounds = extentLatLngBounds;
    }
    if (!crs) {
      layerOptions.detectRetina = false;
    }

    let tiles = null;
    const cacheEnabled = showCache && viewerData.cacheMeta;
    if (cacheEnabled) {
      const matricesByZoom = new Map();
      if (meta && meta.tile_matrix_set && Array.isArray(meta.tile_matrix_set.matrices)) {
        meta.tile_matrix_set.matrices.forEach((m) => {
          if (m && typeof m.z === 'number') matricesByZoom.set(m.z, m);
        });
      }
      const layerOptionsFinal = {
        ...layerOptions,
        noWrap: true,
        bounds: extentLatLngBounds || layerOptions.bounds
      };
      
      // --- MODIFIED CustomTileLayer (Simplified for Server-Side Waiting) ---
      const CustomTileLayer = L.TileLayer.extend({
        getTileUrl(coords) {
          try {
            // Always construct the URL. If it's outside bounds, the server will try to generate it
            // or return 404/500, which standard Leaflet handles gracefully.
            const tpl = this._url || viewerData.tileTemplate;
            if (!tpl) return L.Util.emptyImageUrl;
            const url = tpl
              .replace('{z}', String(coords.z))
              .replace('{x}', String(coords.x))
              .replace('{y}', String(coords.y));
              
             // Debug output in console to verify coords are finite
            if (window && window.console && typeof window.console.debug === 'function') {
               // console.debug('[viewer] request', coords.z, coords.x, coords.y);
            }
            return url;
          } catch (e) {
            return L.Util.emptyImageUrl;
          }
        },
        // REMOVED custom createTile. 
        // We now rely on Leaflet's native <img> loading which handles long-running requests (pending state) perfectly.
      });
      
      tiles = new CustomTileLayer(viewerData.tileTemplate, layerOptionsFinal);
    } else {
      tiles = L.tileLayer(viewerData.tileTemplate, layerOptions);
    }

    tiles.addTo(map);
    renderInfo();
})();
