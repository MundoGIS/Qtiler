/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

/* Ensure DOM is ready before querying header elements (language selector etc) */
(async () => {
  if (document.readyState === 'loading') {
    await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve));
  }

  const footerYearEl = document.getElementById('viewer_footer_year');
  if (footerYearEl) footerYearEl.textContent = String(new Date().getFullYear());

    const params = new URLSearchParams(location.search);
    const infoEl = document.getElementById('info');
    // Add toggle button for info panel
    let infoToggleBtn = document.createElement('button');
    infoToggleBtn.className = 'info-toggle-btn';
    infoToggleBtn.type = 'button';
    infoToggleBtn.title = 'Mostrar/ocultar información';
    infoToggleBtn.innerHTML = '<span style="font-size:18px;">&#9776;</span>';
    let infoCollapsed = false;
    function setInfoCollapsed(collapsed) {
      infoCollapsed = collapsed;
      if (collapsed) {
        infoEl.classList.add('info-collapsed');
        infoToggleBtn.setAttribute('aria-label', 'Mostrar información');
        infoToggleBtn.innerHTML = '<span style="font-size:18px;">&#9776;</span>';
      } else {
        infoEl.classList.remove('info-collapsed');
        infoToggleBtn.setAttribute('aria-label', 'Ocultar información');
        infoToggleBtn.innerHTML = '<span style="font-size:18px;">&times;</span>';
      }
    }
    infoToggleBtn.addEventListener('click', () => setInfoCollapsed(!infoCollapsed));
    if (infoEl && !document.getElementById('info-toggle-btn')) {
      infoToggleBtn.id = 'info-toggle-btn';
      infoEl.parentNode.insertBefore(infoToggleBtn, infoEl);
      setInfoCollapsed(false);
    }
    const languageSelect = document.getElementById('language_selector');

    const serviceParam = String(params.get('service') || params.get('mode') || '').trim().toLowerCase();
    const isWmsMode = serviceParam === 'wms';
    const isWfsMode = serviceParam === 'wfs';
    const externalSource = String(params.get('external_source') || params.get('source') || '').trim();
    const externalApiKey = String(params.get('api_key') || '').trim();
    const isExternalSource = !!externalSource;

    const viewerState = {
      project: params.get('project'),
      theme: params.get('theme'),
      layer: params.get('layer'),
      service: isWfsMode ? 'wfs' : (isWmsMode ? 'wms' : 'wmts'),
      externalSource: externalSource || null,
      externalApiKey: externalApiKey || null
    };

    const viewerSessionId = (() => {
      try {
        if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
      } catch {}
      return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    })();

    const displayMode = isWfsMode ? 'wfs' : (isWmsMode ? 'wms' : 'cache');
    const showCache = !(isWmsMode || isWfsMode) && !isExternalSource;
    const showRemote = false;

    const tileTemplateBase = isExternalSource
      ? (isWmsMode
        ? `/plugins/WmsCache/wms?source=${encodeURIComponent(viewerState.externalSource || '')}${viewerState.externalApiKey ? `&api_key=${encodeURIComponent(viewerState.externalApiKey)}` : ''}`
        : `/plugins/WmsCache/wmts/${encodeURIComponent(viewerState.externalSource || '')}/${encodeURIComponent(viewerState.layer || '')}/{z}/{x}/{y}.png${viewerState.externalApiKey ? `?api_key=${encodeURIComponent(viewerState.externalApiKey)}` : ''}`)
      : (isWfsMode
        ? `/wfs?project=${encodeURIComponent(viewerState.project || '')}`
        : (isWmsMode
          ? `/wms?project=${encodeURIComponent(viewerState.project || '')}`
          : (viewerState.theme
            ? `/wmts/${encodeURIComponent(viewerState.project || '')}/themes/${encodeURIComponent(viewerState.theme || '')}/{z}/{x}/{y}.png`
            : `/wmts/${encodeURIComponent(viewerState.project || '')}/${encodeURIComponent(viewerState.layer || '')}/{z}/{x}/{y}.png`)));
    const appendSidToUrl = (url) => {
      if (!url) return url;
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}sid=${encodeURIComponent(viewerSessionId)}`;
    };
    const tileTemplate = isWfsMode
      ? tileTemplateBase
      : appendSidToUrl(tileTemplateBase);
    const tileTemplateLabel = isExternalSource
      ? `${window.location.origin}${tileTemplateBase}${isWmsMode ? `&LAYERS=${encodeURIComponent(viewerState.layer || '')}` : ''}`
      : (isWfsMode
      ? `${window.location.origin}${tileTemplateBase}&SERVICE=WFS&REQUEST=GetFeature&TYPENAME=${encodeURIComponent(viewerState.layer || '')}&outputFormat=application/json`
      : (isWmsMode
        ? `${window.location.origin}${tileTemplateBase}&LAYERS=${encodeURIComponent(viewerState.layer || '')}`
        : tileTemplate.replace('{z}', '{z}')));
    const modeLabelKey = isWfsMode ? 'viewer.mode.wfs' : (isWmsMode ? 'viewer.mode.wms' : 'viewer.mode.cache');

    const SUPPORTED_LANGS = (window.qtilerLang && Array.isArray(window.qtilerLang.SUPPORTED_LANGS))
      ? window.qtilerLang.SUPPORTED_LANGS
      : ['en', 'es', 'sv', 'no'];
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
        infoEl.innerHTML = `<span>${tr('viewer.loading')}</span>`;
        return;
      }
      const parts = [];
      parts.push('<div style="width:100%">');
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
      parts.push('</div>');
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

    // ----------- Vector Tiles (OpenLayers) viewer mode -----------
    const vtProjectId = params.get('vectortiles');
    if (vtProjectId) {
      viewerData.loading = false;
      viewerData.project = vtProjectId;
      viewerData.modeLabelKey = 'viewer.mode.vectortiles';
      const mapEl = document.getElementById('map');
      const infoPanel = document.getElementById('info');
      if (infoPanel) infoPanel.innerHTML = '<span>Loading Vector Tiles viewer…</span>';

      // Hide controls not relevant for VT mode
      const cacheBtn = document.getElementById('viewer_cache_btn');
      if (cacheBtn) cacheBtn.style.display = 'none';
      const extentBtn = document.getElementById('viewer_extent_btn');
      if (extentBtn) extentBtn.style.display = 'none';
      const osmBtn = document.getElementById('viewer_osm_btn');
      if (osmBtn) osmBtn.style.display = 'none';

      try {
        const ol = window.ol;
        const olms = window.olms;
        const view = new ol.View({ center: ol.proj.fromLonLat([0, 0]), zoom: 3 });
        const osmLayer = new ol.layer.Tile({ source: new ol.source.OSM() });
        const map = new ol.Map({ target: 'map', view: view, layers: [osmLayer] });
        requestAnimationFrame(() => { map.updateSize(); setTimeout(() => map.updateSize(), 100); });

        // Fetch TileJSON to determine bounds
        let tileJsonData = null;
        try {
          const tjRes = await fetch('/plugins/VectorTiles/tilejson/' + encodeURIComponent(vtProjectId) + '.json', { credentials: 'include' });
          if (tjRes.ok) tileJsonData = await tjRes.json();
        } catch (e) { console.warn('TileJSON fetch failed', e); }

        // Zoom to project extent — try tilejson bounds first, fall back to project config extent
        let didFitExtent = false;
        if (tileJsonData && Array.isArray(tileJsonData.bounds) && tileJsonData.bounds.length === 4) {
          const b = tileJsonData.bounds;
          if (b.every(function(v) { return Number.isFinite(Number(v)); })) {
            var extent = ol.proj.transformExtent([Number(b[0]), Number(b[1]), Number(b[2]), Number(b[3])], 'EPSG:4326', 'EPSG:3857');
            view.fit(extent, { padding: [40, 40, 40, 40], maxZoom: 18 });
            didFitExtent = true;
          }
        }
        if (!didFitExtent) {
          try {
            var projRes = await fetch('/projects/' + encodeURIComponent(vtProjectId), { credentials: 'include' });
            if (projRes.ok) {
              var projData = await projRes.json();
              var ext = projData && projData.extent_wgs84;
              if (!ext) ext = projData && projData.extent && projData.extent.bbox_wgs84;
              if (!ext) ext = projData && projData.config && projData.config.extent && projData.config.extent.bbox_wgs84;
              if (Array.isArray(ext) && ext.length === 4 && ext.every(function(v) { return Number.isFinite(Number(v)); })) {
                var projExtent = ol.proj.transformExtent([Number(ext[0]), Number(ext[1]), Number(ext[2]), Number(ext[3])], 'EPSG:4326', 'EPSG:3857');
                view.fit(projExtent, { padding: [40, 40, 40, 40], maxZoom: 18 });
                didFitExtent = true;
              }
            }
          } catch (e) { console.warn('Project extent fetch failed', e); }
        }

        // Add MVT layer — the tile endpoint waits for on-demand generation,
        // so tiles are generated automatically when OL requests them.
        const vtTileUrl = '/plugins/VectorTiles/tiles/' + encodeURIComponent(vtProjectId) + '/{z}/{x}/{y}.pbf';
        const vtMaxZoom = (tileJsonData && Number.isFinite(tileJsonData.maxzoom)) ? tileJsonData.maxzoom : 20;
        const vtSource = new ol.source.VectorTile({
          format: new ol.format.MVT(),
          url: vtTileUrl,
          maxZoom: vtMaxZoom
        });
        let vtRetryTimer = null;
        let vtRetryCount = 0;
        vtSource.on('tileloaderror', function () {
          if (vtRetryTimer || vtRetryCount >= 20) return;
          vtRetryCount += 1;
          vtRetryTimer = setTimeout(function () {
            vtRetryTimer = null;
            vtSource.refresh();
          }, 3000);
        });
        vtSource.on('tileloadend', function () {
          vtRetryCount = 0;
        });
        const vtLayer = new ol.layer.VectorTile({
          source: vtSource,
          declutter: true
        });
        map.addLayer(vtLayer);

        // Apply Mapbox GL style from the project's style endpoint using olms
        const styleUrl = '/plugins/VectorTiles/style/' + encodeURIComponent(vtProjectId) + '.json';
        let styleApplied = false;
        if (olms && typeof olms.applyStyle === 'function') {
          try {
            const styleRes = await fetch(styleUrl, { credentials: 'include' });
            if (styleRes.ok) {
              const styleJson = await styleRes.json();
              // Rewrite tile URLs to relative path (avoid CORS/absolute issues)
              if (styleJson && styleJson.sources) {
                for (var srcKey in styleJson.sources) {
                  if (styleJson.sources[srcKey] && styleJson.sources[srcKey].tiles) {
                    styleJson.sources[srcKey].tiles = [window.location.origin + vtTileUrl];
                  }
                }
              }
              var sourceId = Object.keys(styleJson.sources || {})[0] || 'qtiler';
              await olms.applyStyle(vtLayer, styleJson, sourceId);
              styleApplied = true;
            }
          } catch (styleErr) {
            console.warn('Failed to apply VT style via olms', styleErr);
          }
        }
        if (!styleApplied) {
          vtLayer.setStyle(new ol.style.Style({
            fill: new ol.style.Fill({ color: 'rgba(49,130,206,0.25)' }),
            stroke: new ol.style.Stroke({ color: '#3182ce', width: 1.5 }),
            image: new ol.style.Circle({ radius: 4, fill: new ol.style.Fill({ color: '#3182ce' }) })
          }));
        }

        // Info panel
        if (infoPanel) {
          const parts = [];
          parts.push('<div style="width:100%">');
          parts.push('<div style="font-weight:600">Project: ' + escapeHtml(vtProjectId) + '</div>');
          parts.push('<div>Mode: Vector Tiles (MVT · on-demand)</div>');
          if (tileJsonData) {
            if (Number.isFinite(tileJsonData.minzoom) && Number.isFinite(tileJsonData.maxzoom)) {
              parts.push('<div>Zoom: ' + tileJsonData.minzoom + ' – ' + tileJsonData.maxzoom + '</div>');
            }
            if (Array.isArray(tileJsonData.vector_layers)) {
              parts.push('<div>Source layers: ' + tileJsonData.vector_layers.map(function(l){ return escapeHtml(l.id || l); }).join(', ') + '</div>');
            }
          }
          parts.push('</div>');
          infoPanel.innerHTML = parts.join('');
        }

        // Refresh button — forces re-fetch of all tiles (shows newly generated ones)
        const controlsWrap = document.querySelector('.viewer-controls');
        if (controlsWrap) {
          controlsWrap.innerHTML = '';
          var refreshBtn = document.createElement('button');
          refreshBtn.type = 'button';
          refreshBtn.className = 'viewer-control-btn';
          refreshBtn.textContent = 'Refresh tiles';
          refreshBtn.addEventListener('click', function () {
            vtSource.refresh();
          });
          controlsWrap.appendChild(refreshBtn);
        }

        // Zoom display
        const zoomDisplay = document.getElementById('zoom_display');
        if (zoomDisplay) {
          const updateZoom = () => { zoomDisplay.textContent = 'Zoom: ' + (Math.round(view.getZoom() * 10) / 10); };
          view.on('change:resolution', updateZoom);
          updateZoom();
        }

      } catch (err) {
        console.error('VectorTiles viewer init failed', err);
        if (infoPanel) infoPanel.innerHTML = '<span style="color:#f66">Failed to load Vector Tiles viewer: ' + escapeHtml(err.message) + '</span>';
      }
      return; // Skip normal Leaflet viewer
    }
    // ----------- End Vector Tiles viewer mode -----------

    const missingLayerOrTheme = !viewerData.layer && !viewerData.theme;
    const missingProject = !viewerData.project && !isExternalSource;

    if (isWmsMode && viewerData.theme) {
      viewerData.messages.push({ type: 'error', key: 'viewer.error.missingLayerOrTheme' });
      viewerData.loading = false;
      applyTranslations();
      return;
    }

    if (isWfsMode && viewerData.theme) {
      viewerData.messages.push({ type: 'error', key: 'viewer.error.missingLayerOrTheme' });
      viewerData.loading = false;
      applyTranslations();
      return;
    }

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
      if (isExternalSource) {
        try {
          const infoUrl = '/plugins/WmsCache/info?source=' + encodeURIComponent(viewerState.externalSource || '')
            + '&layer=' + encodeURIComponent(viewerState.layer || '')
            + (viewerState.externalApiKey ? '&api_key=' + encodeURIComponent(viewerState.externalApiKey) : '');
          const response = await fetch(infoUrl);
          if (!response.ok) return null;
          const payload = await response.json();
          if (payload && payload.sourceLabel) {
            viewerData.project = payload.sourceLabel;
          }
          const layerMeta = payload && payload.layerMeta && typeof payload.layerMeta === 'object' ? payload.layerMeta : null;
          const combined = layerMeta ? {
            ...(layerMeta || {}),
            name: viewerData.layer,
            extent_wgs84: Array.isArray(layerMeta.extent_wgs84) ? layerMeta.extent_wgs84 : null,
            extent: Array.isArray(layerMeta.extent) ? layerMeta.extent : null,
            crs: layerMeta.crs || 'EPSG:3857',
            tile_crs: layerMeta.crs || 'EPSG:3857'
          } : null;
          return { cacheEntry: null, layerEntry: layerMeta, themeEntry: null, combined };
        } catch {
          return null;
        }
      }

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
    // Recompute tile template in case `getLayerContext` adjusted project/theme/layer
    try {
      const recomputeTileTemplate = () => {
        const base = isExternalSource
          ? (isWmsMode
            ? `/plugins/WmsCache/wms?source=${encodeURIComponent(viewerData.externalSource || '')}${viewerData.externalApiKey ? `&api_key=${encodeURIComponent(viewerData.externalApiKey)}` : ''}`
            : `/plugins/WmsCache/wmts/${encodeURIComponent(viewerData.externalSource || '')}/${encodeURIComponent(viewerData.layer || '')}/{z}/{x}/{y}.png${viewerData.externalApiKey ? `?api_key=${encodeURIComponent(viewerData.externalApiKey)}` : ''}`)
          : (isWfsMode
            ? `/wfs?project=${encodeURIComponent(viewerData.project || '')}`
            : (isWmsMode
              ? `/wms?project=${encodeURIComponent(viewerData.project || '')}`
              : (viewerData.theme
                ? `/wmts/${encodeURIComponent(viewerData.project || '')}/themes/${encodeURIComponent(viewerData.theme || '')}/{z}/{x}/{y}.png`
                : `/wmts/${encodeURIComponent(viewerData.project || '')}/${encodeURIComponent(viewerData.layer || '')}/{z}/{x}/{y}.png`)));

        const appendSid = (url) => {
          if (!url) return url;
          const sep = url.includes('?') ? '&' : '?';
          return `${url}${sep}sid=${encodeURIComponent(viewerSessionId)}`;
        };

        const newTpl = isWfsMode ? base : appendSid(base);
        viewerData.tileTemplate = newTpl;

        const newLabel = isExternalSource
          ? `${window.location.origin}${base}${isWmsMode ? `&LAYERS=${encodeURIComponent(viewerData.layer || '')}` : ''}`
          : (isWfsMode
            ? `${window.location.origin}${base}&SERVICE=WFS&REQUEST=GetFeature&TYPENAME=${encodeURIComponent(viewerData.layer || '')}&outputFormat=application/json`
            : (isWmsMode
              ? `${window.location.origin}${base}&LAYERS=${encodeURIComponent(viewerData.layer || '')}`
              : newTpl.replace('{z}', '{z}')));

        viewerData.tileTemplateLabel = newLabel;
      };
      recomputeTileTemplate();
    } catch (e) {
      // Non-fatal: keep original template if recompute fails
    }
    // Expose for debugging/inspection in the browser console (temporary)
    try { window.__qtiler_viewerData = viewerData; } catch (e) {}
    if (!viewerData.cacheMeta && viewerData.showCache) {
      viewerData.messages.push({ type: 'warn', key: 'viewer.info.noCache' });
    }
    renderInfo();

    if (!window.ol) {
      viewerData.messages.push({ type: 'error', key: 'viewer.error.leafletMissing' });
      renderInfo();
      return;
    }

    if (isWfsMode) {
      const olView = new ol.View({ center: [0, 0], zoom: 2 });
      const map = new ol.Map({ target: 'map', view: olView, layers: [] });
      try { window.__qtiler_map = map; } catch (e) {}
      requestAnimationFrame(() => map.updateSize());

      // Fit to layer extent if available
      try {
        const e = viewerData.meta && Array.isArray(viewerData.meta.extent_wgs84) ? viewerData.meta.extent_wgs84 : null;
        if (e && e.length === 4 && e.every((v) => Number.isFinite(Number(v)))) {
          const ext = ol.proj.transformExtent([Number(e[0]), Number(e[1]), Number(e[2]), Number(e[3])], 'EPSG:4326', 'EPSG:3857');
          requestAnimationFrame(() => { map.updateSize(); olView.fit(ext, { padding: [20, 20, 20, 20] }); });
        }
      } catch {}

      // OSM overlay
      const osmBtn = document.getElementById('viewer_osm_btn');
      let osmLayer = null;
      let osmVisible = false;
      const refreshOsmLabel = () => {
        if (!osmBtn) return;
        const key = osmVisible ? 'viewer.control.osmHide' : 'viewer.control.osmShow';
        osmBtn.textContent = tr(key);
        osmBtn.classList.toggle('is-active', osmVisible);
      };
      const setOsmVisibility = (visible) => {
        osmVisible = !!visible;
        if (!osmLayer) { osmLayer = new ol.layer.Tile({ source: new ol.source.OSM(), opacity: 0.6 }); }
        if (osmVisible) {
          if (!map.getLayers().getArray().includes(osmLayer)) map.getLayers().insertAt(0, osmLayer);
        } else {
          map.removeLayer(osmLayer);
        }
        refreshOsmLabel();
      };
      if (osmBtn) {
        osmBtn.addEventListener('click', () => setOsmVisibility(!osmVisible));
        setOsmVisibility(true);
      }

      // Hide cache controls for WFS mode
      const cacheBtn = document.getElementById('viewer_cache_btn');
      if (cacheBtn) { cacheBtn.style.display = 'none'; }
      const cacheStatusEl = document.getElementById('viewer_cache_status');
      if (cacheStatusEl) { cacheStatusEl.style.display = 'none'; }

      const typeName = viewerData.layer ? String(viewerData.layer) : '';
      if (!viewerData.project || !typeName) {
        viewerData.messages.push({ type: 'error', key: 'viewer.error.missingLayerOrTheme' });
        renderInfo();
        return;
      }

      // WFS paging/BBOX strategy (same logic as before, adapted for OL)
      const baseUrl = `/wfs?project=${encodeURIComponent(viewerData.project)}`
        + `&SERVICE=WFS&REQUEST=GetFeature&VERSION=2.0.0&TYPENAME=${encodeURIComponent(typeName)}`
        + `&outputFormat=application/json&SRSNAME=EPSG:4326`;

      const PAGE_SIZE = 5000;

      const geojsonFormat = new ol.format.GeoJSON();
      const wfsSource = new ol.source.Vector();
      const wfsLayer = new ol.layer.Vector({
        source: wfsSource,
        style: new ol.style.Style({
          stroke: new ol.style.Stroke({ color: '#3182ce', width: 2 }),
          fill: new ol.style.Fill({ color: 'rgba(49,130,206,0.25)' }),
          image: new ol.style.Circle({
            radius: 5,
            fill: new ol.style.Fill({ color: 'rgba(49,130,206,0.25)' }),
            stroke: new ol.style.Stroke({ color: '#3182ce', width: 2 })
          })
        })
      });
      map.addLayer(wfsLayer);

      // Popup overlay for feature info
      const popupEl = document.createElement('div');
      popupEl.style.cssText = 'background:rgba(15,23,42,0.95);color:#f8fafc;padding:12px 14px;border-radius:10px;max-width:320px;max-height:220px;overflow:auto;font-size:12px;box-shadow:0 6px 20px rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.1);line-height:1.5';
      const popup = new ol.Overlay({ element: popupEl, positioning: 'bottom-center', offset: [0, -12], autoPan: { animation: { duration: 150 } } });
      map.addOverlay(popup);
      map.on('singleclick', (evt) => {
        const feature = map.forEachFeatureAtPixel(evt.pixel, (f) => f);
        if (!feature) { popup.setPosition(undefined); return; }
        const props = feature.getProperties();
        const keys = Object.keys(props).filter((k) => k !== 'geometry');
        if (!keys.length) { popup.setPosition(undefined); return; }
        const rows = keys.slice(0, 30).map((k) => `<div><strong>${escapeHtml(k)}:</strong> ${escapeHtml(props[k])}</div>`).join('');
        popupEl.innerHTML = rows;
        popup.setPosition(evt.coordinate);
      });

      let activeAbort = null;
      let loadSeq = 0;

      const clearWfsNotices = () => {
        viewerData.messages = (viewerData.messages || []).filter((m) => m && m.key !== 'viewer.notice.wfsAllLoaded');
      };

      const fetchJson = async (url, abortController) => {
        const res = await fetch(url, abortController ? { signal: abortController.signal } : undefined);
        if (!res.ok) throw new Error(`wfs_http_${res.status}`);
        return res.json();
      };

      /* Load all features progressively using WFS paging (COUNT/STARTINDEX). */
      const loadAllWfs = async () => {
        const mySeq = ++loadSeq;
        if (activeAbort) { try { activeAbort.abort(); } catch {} }
        activeAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        clearWfsNotices();
        renderInfo();
        wfsSource.clear();

        let startIndex = 0;
        const seenIds = new Set();
        let requiresFullFallback = false;

        try {
          while (true) {
            if (mySeq !== loadSeq) return;
            const url = baseUrl
              + `&COUNT=${encodeURIComponent(String(PAGE_SIZE))}`
              + `&STARTINDEX=${encodeURIComponent(String(startIndex))}`;
            const geo = await fetchJson(url, activeAbort);
            const features = Array.isArray(geo?.features) ? geo.features : [];
            if (!features.length) break;

            // If provider ignores STARTINDEX and repeats pages, stop to avoid endless loop.
            let dupeCount = 0;
            for (const f of features) {
              if (f.id != null && seenIds.has(f.id)) dupeCount++;
              if (f.id != null) seenIds.add(f.id);
            }
            if (dupeCount > features.length * 0.5) {
              requiresFullFallback = true;
              break;
            }

            const olFeatures = geojsonFormat.readFeatures(geo, { featureProjection: 'EPSG:3857' });
            wfsSource.addFeatures(olFeatures);
            startIndex += features.length;
            if (features.length < PAGE_SIZE) break;
            await new Promise((r) => setTimeout(r, 0));
          }

          if (requiresFullFallback) {
            const fallbackGeo = await fetchJson(baseUrl, activeAbort);
            const fallbackFeatures = Array.isArray(fallbackGeo?.features) ? fallbackGeo.features : [];
            wfsSource.clear();
            if (fallbackFeatures.length) {
              const fallbackOlFeatures = geojsonFormat.readFeatures(fallbackGeo, { featureProjection: 'EPSG:3857' });
              wfsSource.addFeatures(fallbackOlFeatures);
            }
          }
        } catch (err) {
          const isAbort = err && (err.name === 'AbortError' || String(err).toLowerCase().includes('abort'));
          if (!isAbort && mySeq === loadSeq) {
            viewerData.messages.push({ type: 'error', key: 'viewer.error.wfsLoadFailed' });
            renderInfo();
          }
          return;
        }

        // Fit map to loaded features
        const featExtent = wfsSource.getExtent();
        if (featExtent && featExtent.every((v) => Number.isFinite(v)) && (featExtent[2] - featExtent[0]) > 0) {
          olView.fit(featExtent, { padding: [40, 40, 40, 40], maxZoom: 18 });
        }
      };

      // Start by loading all features immediately.
      loadAllWfs();

      // Zoom display
      const zoomDisplayEl = document.getElementById('zoom_display');
      const updateZoomDisplay = () => {
        if (zoomDisplayEl) {
          const z = olView.getZoom();
          zoomDisplayEl.textContent = 'Zoom: ' + (Math.round(z * 100) / 100).toFixed(2);
        }
      };
      olView.on('change:resolution', updateZoomDisplay);
      updateZoomDisplay();

      // Extent button
      const extentBtn = document.getElementById('viewer_extent_btn');
      if (extentBtn) {
        extentBtn.addEventListener('click', () => {
          const e = viewerData.meta && Array.isArray(viewerData.meta.extent_wgs84) ? viewerData.meta.extent_wgs84 : null;
          if (e && e.length === 4) {
            olView.fit(ol.proj.transformExtent([Number(e[0]), Number(e[1]), Number(e[2]), Number(e[3])], 'EPSG:4326', 'EPSG:3857'), { padding: [20, 20, 20, 20] });
          }
        });
      }

      renderInfo();
      return;
    }

    // ===== WMTS / WMS mode (OpenLayers) =====
    const meta = viewerData.meta;

    // --- Register proj4 with OpenLayers ---
    if (typeof proj4 !== 'undefined' && ol.proj && ol.proj.proj4 && typeof ol.proj.proj4.register === 'function') {
      ol.proj.proj4.register(proj4);
    }

    // --- Configuration for Zoom/Overzoom ---
    const OVERZOOM_DEFAULT = 10;
    const MAX_ALLOWED_ZOOM_DEFAULT = 28;
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

    // --- Determine CRS & TileGrid ---
    const rawTileCrs = (meta && meta.tile_crs) ? meta.tile_crs : (viewerData.layerMeta && viewerData.layerMeta.crs ? viewerData.layerMeta.crs : null);
    const normalizedTileCrs = typeof rawTileCrs === 'string' ? rawTileCrs.trim().toUpperCase() : null;
    const targetTileCrs = normalizedTileCrs || rawTileCrs || null;
    const targetTileCrsLabel = rawTileCrs || targetTileCrs;
    const hasCustomCrs = !!(targetTileCrs && targetTileCrs !== 'EPSG:3857');

    let viewProjectionCode = 'EPSG:3857';
    let tileGrid = null;
    let customCrsApplied = false;

    if (hasCustomCrs && typeof proj4 !== 'undefined') {
      let def = null;
      if (ensureProj4Definition(targetTileCrs)) {
        def = proj4.defs(targetTileCrs) || proj4.defs(targetTileCrs?.toUpperCase());
      }

      if (def) {
        // Re-register proj4 after adding new definitions
        if (ol.proj.proj4 && typeof ol.proj.proj4.register === 'function') {
          ol.proj.proj4.register(proj4);
        }

        const customProj = ol.proj.get(targetTileCrs);
        if (customProj) {
          viewProjectionCode = targetTileCrs;

          // Primary path: tile_matrix_set with matrices
          if (meta && meta.tile_matrix_set && Array.isArray(meta.tile_matrix_set.matrices) && meta.tile_matrix_set.matrices.length > 0) {
            const matrices = meta.tile_matrix_set.matrices;
            const matrixZooms = matrices.map((m) => {
              if (!m) return null;
              if (typeof m.z === 'number') return m.z;
              if (typeof m.source_level === 'number') return m.source_level;
              const idNum = parseInt(m.identifier, 10);
              return Number.isFinite(idNum) ? idNum : null;
            }).filter((z) => Number.isFinite(z));

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
                else { const idNum = parseInt(m.identifier, 10); if (Number.isFinite(idNum)) z = idNum; }
              }
              if (typeof z !== 'number') return;
              matricesByZoom.set(z, m);
              let r = null;
              if (Number.isFinite(m.resolution)) r = m.resolution;
              else if (Number.isFinite(m.scale_denominator)) r = m.scale_denominator * 0.00028;
              if (Number.isFinite(r)) resolutions[z] = r;
            });

            // Fill gaps by doubling/halving
            for (let z = resolutions.length - 2; z >= 0; z--) {
              if (!Number.isFinite(resolutions[z]) && Number.isFinite(resolutions[z + 1])) resolutions[z] = resolutions[z + 1] * 2;
            }
            for (let z = 1; z < resolutions.length; z++) {
              if (!Number.isFinite(resolutions[z]) && Number.isFinite(resolutions[z - 1])) resolutions[z] = resolutions[z - 1] / 2;
            }
            const filledResolutions = resolutions.map((r) => (Number.isFinite(r) ? r : 1));

            const origin = meta.tile_matrix_set.top_left_corner;
            const tileWidth = meta.tile_matrix_set.tile_width || 256;
            const tileHeight = meta.tile_matrix_set.tile_height || 256;
            let originX, originY;
            if (Array.isArray(origin) && origin.length === 2 && Number.isFinite(origin[0]) && Number.isFinite(origin[1])) {
              originX = origin[0];
              originY = origin[1];
            } else if (meta.extent && meta.extent.length === 4) {
              originX = meta.extent[0];
              originY = meta.extent[3];
            } else {
              originX = 0;
              originY = 0;
            }

            // Compute projected extent from all matrices
            let extMaxX = originX;
            let extMinY = originY;
            for (const m of matrices) {
              if (!m) continue;
              const mw = Number(m.matrix_width ?? m.matrixWidth);
              const mh = Number(m.matrix_height ?? m.matrixHeight);
              if (!Number.isFinite(mw) || mw <= 0 || !Number.isFinite(mh) || mh <= 0) continue;
              let mZoom = m.z;
              if (typeof mZoom !== 'number') {
                if (typeof m.source_level === 'number') mZoom = m.source_level;
                else { const idNum = parseInt(m.identifier, 10); if (Number.isFinite(idNum)) mZoom = idNum; }
              }
              let res = null;
              if (Number.isFinite(m.resolution)) res = m.resolution;
              else if (Number.isFinite(m.scale_denominator)) res = m.scale_denominator * 0.00028;
              else if (typeof mZoom === 'number' && Number.isFinite(filledResolutions[mZoom])) res = filledResolutions[mZoom];
              if (!Number.isFinite(res) || res <= 0) continue;
              const spanX = mw * tileWidth * res;
              const spanY = mh * tileHeight * res;
              const candMaxX = originX + spanX;
              const candMinY = originY - spanY;
              if (Number.isFinite(candMaxX) && candMaxX > extMaxX) extMaxX = candMaxX;
              if (Number.isFinite(candMinY) && candMinY < extMinY) extMinY = candMinY;
            }

            customProj.setExtent([originX, extMinY, extMaxX, originY]);

            tileGrid = new ol.tilegrid.TileGrid({
              resolutions: filledResolutions,
              origin: [originX, originY],
              tileSize: [tileWidth, tileHeight]
            });

            customCrsApplied = true;
            viewerData.messages.push({ type: 'info', key: 'viewer.notice.customMatrix', params: { crs: escapeHtml(targetTileCrsLabel || targetTileCrs || 'EPSG:3857') } });
          }

          // Fallback: use meta.extent without full matrix top_left_corner
          if (!customCrsApplied && meta && meta.extent && meta.extent.length === 4) {
            const matrices = (meta.tile_matrix_set && Array.isArray(meta.tile_matrix_set.matrices)) ? meta.tile_matrix_set.matrices : [];
            const matrixZooms = matrices.map((m) => {
              if (!m) return null;
              if (typeof m.z === 'number') return m.z;
              if (typeof m.source_level === 'number') return m.source_level;
              const idNum = parseInt(m.identifier, 10);
              return Number.isFinite(idNum) ? idNum : null;
            }).filter((z) => Number.isFinite(z));

            const highestZoom = Number.isFinite(meta.zoom_max) ? meta.zoom_max : (matrixZooms.length ? Math.max(...matrixZooms) : 0);
            const desiredMaxZoom = Math.min(highestZoom + EXTRA_ZOOMS, MAX_ALLOWED_ZOOM);
            const resolutions = new Array(Math.max(0, desiredMaxZoom) + 1).fill(null);

            matrices.forEach((m) => {
              let z = m.z;
              if (typeof z !== 'number') {
                if (typeof m.source_level === 'number') z = m.source_level;
                else { const idNum = parseInt(m.identifier, 10); if (Number.isFinite(idNum)) z = idNum; }
              }
              if (typeof z === 'number') {
                let r = null;
                if (Number.isFinite(m.resolution)) r = m.resolution;
                else if (Number.isFinite(m.scale_denominator)) r = m.scale_denominator * 0.00028;
                if (Number.isFinite(r)) resolutions[z] = r;
              }
            });
            for (let z = resolutions.length - 2; z >= 0; z--) {
              if (!Number.isFinite(resolutions[z]) && Number.isFinite(resolutions[z + 1])) resolutions[z] = resolutions[z + 1] * 2;
            }
            for (let z = 1; z < resolutions.length; z++) {
              if (!Number.isFinite(resolutions[z]) && Number.isFinite(resolutions[z - 1])) resolutions[z] = resolutions[z - 1] / 2;
            }
            const filledResolutions = resolutions.map((r) => (Number.isFinite(r) ? r : 1));

            const [minx, miny, maxx, maxy] = meta.extent;
            const origin = (meta.tile_matrix_set && Array.isArray(meta.tile_matrix_set.top_left_corner)) ? meta.tile_matrix_set.top_left_corner : null;
            const originX = (origin && origin.length === 2) ? origin[0] : minx;
            const originY = (origin && origin.length === 2) ? origin[1] : maxy;

            customProj.setExtent([minx, miny, maxx, maxy]);

            tileGrid = new ol.tilegrid.TileGrid({
              resolutions: filledResolutions,
              origin: [originX, originY],
              tileSize: 256
            });

            customCrsApplied = true;
            viewerData.messages.push({ type: 'info', key: 'viewer.notice.customExtent', params: { crs: escapeHtml(targetTileCrsLabel || targetTileCrs || 'EPSG:3857') } });
          }

          if (!customCrsApplied) {
            viewerData.messages.push({ type: 'warn', key: 'viewer.notice.noMatrix' });
            viewProjectionCode = 'EPSG:3857';
          }
        }
      } else {
        viewerData.messages.push({ type: 'warn', key: 'viewer.notice.noProjDefinition' });
      }
    }

    // --- Compute zoom limits ---
    let minZoom = meta ? (meta.zoom_min || 0) : 0;
    let maxZoom = meta && Number.isFinite(meta.zoom_max) ? Math.min(meta.zoom_max + EXTRA_ZOOMS, MAX_ALLOWED_ZOOM) : 18;
    if (tileGrid) {
      maxZoom = tileGrid.getResolutions().length - 1;
    }

    // --- Project extent in view CRS ---
    let projectExtent = null;
    if (meta && Array.isArray(meta.extent_wgs84) && meta.extent_wgs84.length === 4) {
      try {
        projectExtent = ol.proj.transformExtent(
          [Number(meta.extent_wgs84[0]), Number(meta.extent_wgs84[1]), Number(meta.extent_wgs84[2]), Number(meta.extent_wgs84[3])],
          'EPSG:4326', viewProjectionCode
        );
      } catch {}
    }
    if (!projectExtent && meta && meta.extent && meta.extent.length === 4) {
      projectExtent = [meta.extent[0], meta.extent[1], meta.extent[2], meta.extent[3]];
    }

    // --- Create OL View & Map ---
    const olView = new ol.View({
      projection: viewProjectionCode,
      zoom: meta ? (meta.zoom_min || 0) : 0,
      minZoom: minZoom,
      maxZoom: maxZoom
    });

    if (projectExtent && projectExtent.every((v) => Number.isFinite(v))) {
      olView.setCenter([(projectExtent[0] + projectExtent[2]) / 2, (projectExtent[1] + projectExtent[3]) / 2]);
    } else {
      olView.setCenter(hasCustomCrs ? [0, 0] : ol.proj.fromLonLat([0, 0]));
    }

    const map = new ol.Map({ target: 'map', view: olView, layers: [] });
    try { window.__qtiler_map = map; } catch (e) {}

    const focusProjectExtent = () => {
      let preferredZoom = null;
      if (meta) {
        if (Number.isFinite(meta.cached_zoom_min)) preferredZoom = meta.cached_zoom_min;
        else if (Number.isFinite(meta.last_zoom_min)) preferredZoom = meta.last_zoom_min;
      }
      if (projectExtent && projectExtent.every((v) => Number.isFinite(v))) {
        olView.fit(projectExtent, { size: map.getSize() || [800, 600], padding: [20, 20, 20, 20] });
        if (preferredZoom != null && olView.getZoom() < preferredZoom) {
          olView.setZoom(preferredZoom);
        }
        return true;
      }
      if (meta && meta.extent && meta.extent.length === 4) {
        const center = [(meta.extent[0] + meta.extent[2]) / 2, (meta.extent[1] + meta.extent[3]) / 2];
        olView.setCenter(center);
        if (preferredZoom != null) olView.setZoom(preferredZoom);
        return true;
      }
      olView.setCenter(hasCustomCrs ? [0, 0] : ol.proj.fromLonLat([0, 0]));
      if (preferredZoom != null) olView.setZoom(preferredZoom);
      return false;
    };

    requestAnimationFrame(() => {
      map.updateSize();
      focusProjectExtent();
    });

    const extentBtn = document.getElementById('viewer_extent_btn');
    if (extentBtn) {
      extentBtn.addEventListener('click', () => focusProjectExtent());
      if (!projectExtent && !(meta && meta.extent && meta.extent.length === 4)) {
        extentBtn.disabled = true;
        extentBtn.setAttribute('aria-disabled', 'true');
      }
    }

    const cacheBtn = document.getElementById('viewer_cache_btn');
    const cacheStatusEl = document.getElementById('viewer_cache_status');
    const manualOnDemandControlEnabled = false;
    const osmBtn = document.getElementById('viewer_osm_btn');
    let autoCacheActive = false;
    let cacheRequestPromise = null;
    let currentCacheJobId = null;
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
      if (!cacheBtn || !manualOnDemandControlEnabled) return;
      if (isWmsMode) return;
      cacheBtn.textContent = tr(autoCacheActive ? 'viewer.control.cacheStop' : 'viewer.control.cacheStart');
      cacheBtn.classList.toggle('is-active', autoCacheActive);
    };

    const setCacheBusy = (busy) => {
      if (!cacheBtn || !manualOnDemandControlEnabled) return;
      if (busy) cacheBtn.setAttribute('aria-busy', 'true');
      else cacheBtn.removeAttribute('aria-busy');
    };

    const setCacheStatus = (state, params = {}) => {
      if (!cacheStatusEl || !manualOnDemandControlEnabled) return;
      if (isWmsMode) { cacheStatusEl.textContent = ''; return; }
      let key = null;
      if (state === 'busy') key = 'viewer.control.cacheBusy';
      else if (state === 'done') key = 'viewer.control.cacheDone';
      else if (state === 'error') key = 'viewer.control.cacheError';
      else if (state === 'idle' && autoCacheActive) key = 'viewer.control.cacheIdle';
      cacheStatusEl.textContent = key ? tr(key, params) : '';
    };

    if (!manualOnDemandControlEnabled || isWmsMode) {
      if (cacheBtn) {
        cacheBtn.disabled = true;
        cacheBtn.setAttribute('aria-disabled', 'true');
        cacheBtn.style.display = 'none';
      }
      if (cacheStatusEl) {
        cacheStatusEl.textContent = '';
        cacheStatusEl.style.display = 'none';
      }
    }

    const abortCurrentCacheJob = () => {
      const jobId = currentCacheJobId;
      if (!jobId) return;
      currentCacheJobId = null;
      try {
        const url = '/generate-cache/' + encodeURIComponent(jobId) + '/abort';
        try {
          if (navigator && typeof navigator.sendBeacon === 'function') {
            const blob = new Blob(['{}'], { type: 'application/json' });
            navigator.sendBeacon(url, blob);
            return;
          }
        } catch {}
        fetch(url, {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        }).catch(() => null);
      } catch {}
    };

    const abortViewerSession = () => {
      try {
        const url = '/viewer/abort?sid=' + encodeURIComponent(viewerSessionId);
        try {
          if (navigator && typeof navigator.sendBeacon === 'function') {
            const blob = new Blob(['{}'], { type: 'application/json' });
            navigator.sendBeacon(url, blob);
            return;
          }
        } catch {}
        fetch(url, {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        }).catch(() => null);
      } catch {}
    };

    let closeAbortSent = false;
    const handleCloseAbort = () => {
      if (closeAbortSent) return;
      closeAbortSent = true;
      abortViewerSession();
      abortCurrentCacheJob();
    };
    window.addEventListener('pagehide', (event) => {
      if (event && event.persisted) return;
      handleCloseAbort();
    });
    window.addEventListener('beforeunload', handleCloseAbort);

    refreshOsmControlLabel = () => {
      if (!osmBtn) return;
      const key = osmVisible ? 'viewer.control.osmHide' : 'viewer.control.osmShow';
      osmBtn.textContent = tr(key);
      osmBtn.classList.toggle('is-active', osmVisible);
    };

    const setOsmVisibility = (visible) => {
      if (!allowOsmOverlay) {
        osmVisible = false;
        refreshOsmControlLabel();
        return;
      }
      osmVisible = !!visible;
      if (!osmLayer) {
        osmLayer = new ol.layer.Tile({ source: new ol.source.OSM(), opacity: 0.6 });
      }
      if (osmVisible) {
        if (!map.getLayers().getArray().includes(osmLayer)) map.getLayers().insertAt(0, osmLayer);
      } else {
        map.removeLayer(osmLayer);
      }
      refreshOsmControlLabel();
    };

    const buildCachePayload = () => {
      if (!viewerData.project || !(viewerData.layer || viewerData.theme)) return null;
      const zoom = Math.round(olView.getZoom());
      if (!Number.isFinite(zoom)) return null;
      const viewExtent = olView.calculateExtent(map.getSize());
      if (!viewExtent || viewExtent.some((v) => !Number.isFinite(v))) return null;
      const [minx, miny, maxx, maxy] = viewExtent;
      const precisionCoords = [minx, miny, maxx, maxy].map((value) => Number(value.toFixed(3)));
      const extentString = precisionCoords.join(',');
      const body = {
        project: viewerData.project,
        zoom_min: zoom,
        zoom_max: zoom,
        project_extent: extentString,
        run_reason: 'viewer-on-demand',
        trigger: 'viewer',
        viewer_session_id: viewerSessionId,
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
        if (res.status === 404) return { status: 'unknown' };
        const payload = await res.json().catch(() => null);
        if (!res.ok) throw new Error(payload?.details || res.statusText || 'cache_status_failed');
        if (payload?.status && payload.status !== 'running') return payload;
      }
      return { status: 'timeout' };
    };

    const scheduleAutoCache = ({ immediate = false } = {}) => {
      if (!autoCacheActive) return;
      if (autoCacheTimer) clearTimeout(autoCacheTimer);
      autoCacheTimer = setTimeout(() => { triggerCacheForCurrentView('auto'); }, immediate ? 0 : 500);
    };

    let tileSource = null;

    const triggerCacheForCurrentView = async (reason = 'manual') => {
      const payload = buildCachePayload();
      if (!payload) {
        if (reason === 'manual') setCacheStatus('error', { message: 'missing_extent' });
        return;
      }
      if (reason === 'auto' && payload.extentKey === lastAutoCacheKey) return;
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
        if (!res.ok || !data?.id) throw new Error(data?.details || res.statusText || 'cache_request_failed');
        const jobId = data.id;
        currentCacheJobId = jobId;
        const result = await pollJobUntilDone(jobId);
        if (result.status !== 'completed') throw new Error(result.status || 'cache_failed');
        if (tileSource && typeof tileSource.refresh === 'function') tileSource.refresh();
        setCacheStatus('done', { zoom: payload.zoom });
      })();
      try {
        await cacheRequestPromise;
      } catch (err) {
        setCacheStatus('error', { message: err?.message || err });
      } finally {
        cacheRequestPromise = null;
        currentCacheJobId = null;
        setCacheBusy(false);
        if (queuedAutoRun) {
          queuedAutoRun = false;
          scheduleAutoCache();
        } else if (autoCacheActive) {
          setCacheStatus('idle');
        }
      }
    };

    if (cacheBtn && manualOnDemandControlEnabled && !isWmsMode) {
      cacheBtn.addEventListener('click', () => {
        autoCacheActive = !autoCacheActive;
        refreshCacheControlLabel();
        if (autoCacheActive) {
          setCacheStatus('idle');
          scheduleAutoCache({ immediate: true });
        } else {
          abortCurrentCacheJob();
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
      if (zoomDisplayEl) {
        const z = olView.getZoom();
        zoomDisplayEl.textContent = 'Zoom: ' + (Math.round(z * 100) / 100).toFixed(2);
      }
    };
    olView.on('change:resolution', () => {
      updateZoomDisplay();
      if (!isWmsMode && autoCacheActive) scheduleAutoCache();
    });
    map.on('moveend', () => {
      if (!isWmsMode && autoCacheActive) scheduleAutoCache();
    });
    updateZoomDisplay();
    refreshCacheControlLabel();

    // --- Create tile layer ---
    if (isWmsMode) {
      const wmsBaseUrl = viewerData.tileTemplate;
      const wmsLayers = viewerData.layer ? String(viewerData.layer) : '';
      if (!wmsBaseUrl || !wmsLayers) {
        viewerData.messages.push({ type: 'error', key: 'viewer.error.missingLayerOrTheme' });
        renderInfo();
        return;
      }
      tileSource = new ol.source.TileWMS({
        url: wmsBaseUrl,
        params: {
          'LAYERS': wmsLayers,
          'FORMAT': 'image/png',
          'TRANSPARENT': 'true',
          'VERSION': '1.3.0',
          'STYLES': ''
        },
        projection: viewProjectionCode,
        tileGrid: tileGrid || undefined
      });
    } else {
      const sourceOptions = {
        url: viewerData.tileTemplate,
        projection: viewProjectionCode,
        maxZoom: maxZoom
      };
      if (tileGrid) sourceOptions.tileGrid = tileGrid;
      tileSource = new ol.source.XYZ(sourceOptions);
    }

    const tileLayer = new ol.layer.Tile({ source: tileSource });
    map.addLayer(tileLayer);
    renderInfo();

    // BFCache handlers
    window.addEventListener('pageshow', (event) => {
      try {
        if (event && event.persisted) {
          window.location.reload();
        }
      } catch (e) {}
    });

    document.addEventListener('click', (evt) => {
      try {
        const link = evt.target && evt.target.closest ? evt.target.closest('a.brand-logo, a.nav-link') : null;
        if (!link || !(link instanceof HTMLAnchorElement)) return;
        const href = link.getAttribute('href') || link.href;
        if (!href) return;
        const url = new URL(href, location.href);
        if (url.origin !== location.origin) return;
        if (url.pathname === '/' || url.pathname === '/index.html') {
          evt.preventDefault();
          const sep = url.search ? '&' : '?';
          location.href = url.pathname + url.search + sep + '_cb=' + Date.now();
        }
      } catch (e) {}
    }, true);
})();
