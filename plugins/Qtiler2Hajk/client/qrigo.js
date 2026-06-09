(function () {
  const hooks = window.qtilerPluginHooks || { layerInfoTabs: [] };
  window.qtilerPluginHooks = hooks;

  const sanitizeId = (value) => String(value || '').trim().replace(/[^A-Za-z0-9_-]+/g, '_');
  const safeXmlName = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '_';
    let out = raw.replace(/[^A-Za-z0-9_.-]+/g, '_');
    if (!/^[A-Za-z_]/.test(out)) out = '_' + out;
    if (out.toLowerCase().startsWith('xml')) out = '_' + out;
    return out;
  };

  const normalizeCrsCode = (value) => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toUpperCase();
    return normalized || null;
  };

  const isXyzCompatibleCrs = (value) => {
    const normalized = normalizeCrsCode(value);
    if (!normalized) return false;
    return normalized === 'EPSG:3857'
      || normalized === 'EPSG:900913'
      || normalized === 'EPSG:102100'
      || normalized === 'EPSG:3785'
      || normalized === 'URN:OGC:DEF:CRS:EPSG::3857';
  };

  const isVectorLayer = (layer) => {
    if (!layer) return false;
    return !!(layer.kind === 'vector' || layer.kind === 'VectorLayer' || layer.geometry_type);
  };

  const getResolutions = (tileMatrixSet) => {
    if (!tileMatrixSet) return [];
    if (Array.isArray(tileMatrixSet.matrices)) return tileMatrixSet.matrices.map(m => m.resolution).filter(Number.isFinite);
    if (Array.isArray(tileMatrixSet.matrixSet)) return tileMatrixSet.matrixSet.map(m => m.resolution).filter(Number.isFinite);
    return [];
  };

  const buildTileGrid = (tileMatrixSet, output) => {
    if (!tileMatrixSet || !Array.isArray(tileMatrixSet.topLeftCorner)) return null;
    const outputRes = Array.isArray(output?.resolutions) ? output.resolutions.filter(Number.isFinite) : [];
    const resolutions = outputRes.length ? outputRes : getResolutions(tileMatrixSet);
    if (!resolutions.length) return null;
    return {
      alignBottomLeft: false,
      origin: tileMatrixSet.topLeftCorner,
      resolutions
    };
  };

  const isFiniteNumber = (value) => Number.isFinite(Number(value));

  const validArray = (value, length) => (
    Array.isArray(value)
    && value.length === length
    && value.every(isFiniteNumber)
  ) ? value.map((entry) => Number(entry)) : null;

  const makeSection = (title, payload, container) => {
    if (!payload) return;
    const block = document.createElement('div');
    block.style.marginBottom = '18px';

    const label = document.createElement('div');
    label.textContent = title;
    label.style.fontWeight = '600';
    label.style.marginBottom = '6px';
    block.appendChild(label);

    const pre = document.createElement('pre');
    pre.className = 'qtiler-layer-modal__pre';
    pre.textContent = JSON.stringify(payload, null, 2);
    block.appendChild(pre);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-secondary btn-sm';
    copyBtn.textContent = 'Copy JSON';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(pre.textContent || '').catch(() => {});
    });
    block.appendChild(copyBtn);

    container.appendChild(block);
  };

  const fetchAttributes = async (projectId, layerName) => {
    try {
      const url = `/origo/wfs-attributes?project=${encodeURIComponent(projectId)}&layer=${encodeURIComponent(layerName)}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return [];
      const data = await res.json().catch(() => null);
      return Array.isArray(data?.attributes) ? data.attributes : [];
    } catch {
      return [];
    }
  };

  const fetchSearchableConfig = async (projectId) => {
    try {
      const res = await fetch(`/projects/${encodeURIComponent(projectId)}/searchable`, { credentials: 'include' });
      if (!res.ok) return [];
      const data = await res.json().catch(() => null);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  };

  const fetchProjectConfig = async (projectId) => {
    try {
      const res = await fetch(`/projects/${encodeURIComponent(projectId)}/config`, { credentials: 'include' });
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch {
      return null;
    }
  };

  const registerUniqueHook = (arr, hook) => {
    if (!Array.isArray(arr) || !hook || !hook.id) return;
    if (arr.some((h) => h && h.id === hook.id)) return;
    arr.push(hook);
  };

  const openServiceModal = ({ hasWfs, hasVectorTiles, tr, onConfirm }) => {
    const available = [
      { key: 'wmts', label: 'WMTS' },
      { key: 'wms', label: 'WMS' }
    ];
    if (hasWfs) available.push({ key: 'wfs', label: 'WFS' });

    const ensureModalStyles = () => {
      if (document.getElementById('Qtiler2Hajk-service-modal-style')) return;
      const style = document.createElement('style');
      style.id = 'Qtiler2Hajk-service-modal-style';
      style.textContent = `
        .Qtiler2Hajk-modal{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:10050;padding:16px}
        .Qtiler2Hajk-modal.modal.is-active{display:flex}
        .Qtiler2Hajk-modal .modal-background{position:absolute;inset:0;background:rgba(10,10,10,.45)}
        .Qtiler2Hajk-modal .modal-card{position:relative;max-width:460px;width:min(460px,calc(100vw - 32px));max-height:80vh;overflow:auto;margin:0;background:#ffffff;border:1px solid #d7dde7;border-radius:12px;box-shadow:0 16px 42px rgba(15,23,42,.3)}
        .Qtiler2Hajk-modal .modal-card-head,.Qtiler2Hajk-modal .modal-card-body,.Qtiler2Hajk-modal .modal-card-foot{background:#ffffff;color:#1f2937}
        .Qtiler2Hajk-modal .modal-card-head{border-bottom:1px solid #e5e7eb;padding:1rem 1.2rem}
        .Qtiler2Hajk-modal .modal-card-foot{border-top:1px solid #e5e7eb;padding:1rem 1.2rem}
        .Qtiler2Hajk-modal .modal-card-title{font-size:1.05rem;font-weight:700}
        .Qtiler2Hajk-modal .modal-card-body{display:grid;gap:.85rem;padding:1.15rem 1.2rem}
        .Qtiler2Hajk-service-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
        .Qtiler2Hajk-service-option{border:1px solid #dbe1ea;border-radius:8px;padding:.55rem .65rem;display:flex;gap:.45rem;align-items:center}
        .Qtiler2Hajk-modal .Qtiler2Hajk-btn{border:1px solid #cbd5e1;background:#fff;color:#1f2937;border-radius:8px;padding:.45rem .9rem;font-weight:600;cursor:pointer}
        .Qtiler2Hajk-modal .Qtiler2Hajk-btn:hover{background:#f8fafc}
        .Qtiler2Hajk-modal .Qtiler2Hajk-btn-primary{border-color:#0369a1;background:#0369a1;color:#fff}
        .Qtiler2Hajk-modal .Qtiler2Hajk-btn-primary:hover{background:#075985}
        @media (max-width:640px){.Qtiler2Hajk-service-grid{grid-template-columns:1fr}}
      `;
      document.head.appendChild(style);
    };

    ensureModalStyles();

    const modal = document.createElement('div');
    modal.className = 'modal is-active Qtiler2Hajk-modal';
    modal.innerHTML = `
      <div class="modal-background"></div>
      <div class="modal-card">
        <header class="modal-card-head">
          <p class="modal-card-title">${escapeHtml(tr ? tr('Open in Origo') : 'Open in Origo')}</p>
          <button class="delete" aria-label="close"></button>
        </header>
        <section class="modal-card-body">
          <p>${escapeHtml(tr ? tr('Choose services to open') : 'Choose services to open')}</p>
          <label class="Qtiler2Hajk-service-option"><input type="checkbox" data-all="1"> <strong>All available services</strong></label>
          <div class="Qtiler2Hajk-service-grid"></div>
        </section>
        <footer class="modal-card-foot" style="justify-content:flex-end">
          <button class="Qtiler2Hajk-btn" data-cancel="1">${escapeHtml(tr ? tr('Cancel') : 'Cancel')}</button>
          <button class="Qtiler2Hajk-btn Qtiler2Hajk-btn-primary" data-open="1">${escapeHtml(tr ? tr('Open in Origo') : 'Open in Origo')}</button>
        </footer>
      </div>
    `;

    const grid = modal.querySelector('.Qtiler2Hajk-service-grid');
    const allCheck = modal.querySelector('input[data-all="1"]');
    const openBtn = modal.querySelector('button[data-open="1"]');
    const cancelBtn = modal.querySelector('button[data-cancel="1"]');
    const closeBtn = modal.querySelector('.delete');
    const bg = modal.querySelector('.modal-background');

    const serviceChecks = [];
    for (const svc of available) {
      const label = document.createElement('label');
      label.className = 'Qtiler2Hajk-service-option';
      label.innerHTML = `<input type="checkbox" data-service="${escapeHtml(svc.key)}"> <span>${escapeHtml(svc.label)}</span>`;
      grid.appendChild(label);
      serviceChecks.push(label.querySelector('input'));
    }

    const close = () => {
      try { modal.remove(); } catch {}
    };

    allCheck.addEventListener('change', () => {
      const checked = !!allCheck.checked;
      serviceChecks.forEach((cb) => { cb.checked = checked; });
    });
    serviceChecks.forEach((cb) => cb.addEventListener('change', () => {
      if (!cb.checked && allCheck.checked) allCheck.checked = false;
      if (serviceChecks.every((s) => s.checked)) allCheck.checked = true;
    }));

    openBtn.addEventListener('click', () => {
      const selected = serviceChecks.filter((cb) => cb.checked).map((cb) => cb.getAttribute('data-service'));
      if (!selected.length) return;
      if (typeof onConfirm === 'function') onConfirm(selected);
      close();
    });

    [cancelBtn, closeBtn, bg].forEach((el) => {
      if (el) el.addEventListener('click', close);
    });

    document.body.appendChild(modal);
  };

  // Reuse the same Origo service picker from other dashboard contexts (e.g. theme actions).
  try {
    window.qtilerOpenOrigoServiceModal = openServiceModal;
  } catch {}

  /* ── "Open in Origo" button for the layer actions row ─────────── */
  if (!Array.isArray(hooks.layerActionButtons)) hooks.layerActionButtons = [];
  registerUniqueHook(hooks.layerActionButtons, {
    id: 'Qtiler2Hajk-preview',
    shouldShow: () => true,
    create: ({ layerData, projectId, makeLabeledIconButton, tr }) => {
      return makeLabeledIconButton(
        tr ? tr('Open in Origo') : 'Open in Origo',
        'map',
        'Origo',
        () => {
          openServiceModal({
            hasWfs: isVectorLayer(layerData),
            hasVectorTiles: !!(Array.isArray(window.qtilerPluginsEnabled) && window.qtilerPluginsEnabled.includes('VectorTiles')),
            tr,
            onConfirm: (selectedServices) => {
              const selected = Array.isArray(selectedServices) ? selectedServices : [];
              if (!selected.length) return;
              const url = '/Qtiler2Hajk/preview2?project=' + encodeURIComponent(projectId)
                + '&layer=' + encodeURIComponent(layerData.name)
                + '&service=' + encodeURIComponent(selected.join(','))
                + '&_ts=' + encodeURIComponent(String(Date.now()));
              window.open(url, '_blank', 'noopener');
            }
          });
        }
      );
    }
  });

  if (!Array.isArray(hooks.layerInfoTabs)) hooks.layerInfoTabs = [];
  registerUniqueHook(hooks.layerInfoTabs, {
    id: 'Qtiler2Hajk',
    title: 'Origo',
    shouldShow: (ctx) => !!ctx?.layerData?.name,
    render: async ({ container, projectId, layerData, projectMeta, tileMatrixSet, configLayer, output }) => {
      const MAX_ORIGO_ZOOM = 17;
      const origin = window.location.origin;
      const layerName = layerData?.name || 'layer';
      const layerTitle = layerData?.title || layerName;
      const projectKey = sanitizeId(projectId || 'project');
      const layerKey = sanitizeId(layerName);
      const group = projectId || 'qtiler';
      const projection = projectMeta?.crs || layerData?.crs || null;
      const attribution = layerData?.attribution || undefined;
      const xyzCompatible = isXyzCompatibleCrs(projection);

      const apiNote = document.createElement('div');
      apiNote.className = 'meta';
      apiNote.style.marginBottom = '12px';
      apiNote.textContent = 'If the layer is private, replace the empty api_key with the user\'s API key.';
      container.appendChild(apiNote);

      const noneSourceName = `Qtiler_${projectKey}_NONE`;
      makeSection('Background (OSM + No background)', {
        source: {
          [noneSourceName]: {
            type: 'XYZ',
            url: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
          }
        },
        layers: [
          {
            name: 'background_none',
            title: 'No background',
            group: 'background',
            source: noneSourceName,
            type: 'XYZ',
            visible: false,
            queryable: false
          },
          {
            name: 'osm',
            title: 'OpenStreetMap',
            group: 'background',
            visible: false,
            type: 'OSM',
            style: 'osm',
            maxZoom: MAX_ORIGO_ZOOM,
            queryable: false,
            attribution: '© OpenStreetMap contributors'
          }
        ]
      }, container);

      const tileGrid = buildTileGrid(tileMatrixSet, output);
      const outputExtent = validArray(output?.extent, 4);
      const outputCenter = validArray(output?.center, 2);
      const outputProjectionExtent = validArray(output?.projectionExtent, 4);
      const outputResolutions = Array.isArray(output?.resolutions)
        ? output.resolutions.map((entry) => Number(entry)).filter(Number.isFinite)
        : [];

      // Project-level search snippet (shared by all searchable layers in the project)
      const searchableConfig = await fetchSearchableConfig(projectId);
      const projectSearchableLayers = Array.isArray(searchableConfig)
        ? searchableConfig.filter((entry) => entry && entry.searchable !== false)
        : [];
      const projectConfig = await fetchProjectConfig(projectId);
      const configLayers = projectConfig && typeof projectConfig.layers === 'object' ? projectConfig.layers : {};
      const configSearchableLayers = Object.entries(configLayers)
        .filter(([, cfg]) => cfg && cfg.wfsSearchable === true)
        .map(([name]) => ({ name }));
      const mergedSearchableLayers = projectSearchableLayers.length
        ? projectSearchableLayers
        : configSearchableLayers;

      let origoSearchSnippet = null;
      let searchMetadata = null;
      if (mergedSearchableLayers.length > 0) {
        const layerSafeName = safeXmlName(layerName);
        const searchLayerToken = layerSafeName || layerName;
        const searchEntry = mergedSearchableLayers.find((entry) => {
          const entryName = String(entry?.name || '').trim();
          if (!entryName) return false;
          return entryName === layerName || safeXmlName(entryName) === layerSafeName;
        });
        const fields = Array.isArray(searchEntry?.fields)
          ? searchEntry.fields.map((f) => String(f || '').trim()).filter(Boolean)
          : [];
        const resolvedSearchAttribute = String(searchEntry?.searchAttribute || searchEntry?.titleField || fields[0] || '').trim();
        const searchAttribute = resolvedSearchAttribute || 'SEARCH_VALUE';
        const idAttribute = String(searchEntry?.idAttribute || '').trim() || 'GID';
        const configuredGeom = String(searchEntry?.geometryAttribute || '').trim();
        const geometryAttribute = /(geom|geometry|wkb|wkt)/i.test(configuredGeom) ? configuredGeom : 'GEOM';
        const hintText = String(searchEntry?.hintText || '').trim() || 'Search...';
        const hasLayerSpecificConfig = !!searchEntry;
        const origoSearchUrl = hasLayerSpecificConfig
          ? `${origin}/api/search?project=${encodeURIComponent(projectId)}&l=${encodeURIComponent(searchLayerToken)}&api_key=`
          : `${origin}/api/search?project=${encodeURIComponent(projectId)}&api_key=`;

        origoSearchSnippet = {
          name: 'search',
          options: {
            url: origoSearchUrl,
            searchAttribute,
            easting: 'EASTING',
            northing: 'NORTHING',
            title: 'Search',
            hintText
          }
        };

        searchMetadata = {
          url: origoSearchUrl,
          layer: searchLayerToken,
          searchAttribute,
          idAttribute,
          geometryAttribute,
          hintText,
          layerSpecific: hasLayerSpecificConfig
        };
      }

      const recommendedControls = [
        { name: 'mapmenu' },
        { name: 'home' },
        { name: 'legend', options: { expanded: true, turnOffLayersControl: true } }
      ];
      if (outputResolutions.length) {
        recommendedControls.push({ name: 'scalepicker' });
      }
      if (origoSearchSnippet) {
        recommendedControls.push(origoSearchSnippet);
      }

      const mapSetup = {
        modules: recommendedControls,
        settings: {
          projectionCode: projection || 'EPSG:3857',
          maxZoom: MAX_ORIGO_ZOOM
        },
        source: {},
        groups: [
          { name: 'background', title: 'Bakgrundskartor', expanded: true },
          { name: group, title: group, expanded: true }
        ],
        layers: [],
        styles: {}
      };
      if (outputResolutions.length) mapSetup.settings.resolutions = outputResolutions;
      if (outputProjectionExtent) mapSetup.settings.projectionExtent = outputProjectionExtent;
      if (outputExtent) mapSetup.settings.extent = outputExtent;
      if (outputCenter) mapSetup.settings.center = outputCenter;

      makeSection('Map setup (recommended)', mapSetup, container);

      if (tileGrid || xyzCompatible) {
        const xyzUrl = `${origin}/wmts/${encodeURIComponent(projectId)}/${encodeURIComponent(layerName)}/{z}/{x}/{y}.png`;

        const xyzSourceName = `Qtiler_${projectKey}_${layerKey}_XYZ`;
        const xyzSource = {
          url: xyzUrl,
          type: 'XYZ'
        };
        if (projection) xyzSource.projection = projection;

        const xyzLayer = {
          name: layerName,
          title: `${layerTitle} [WMTS]`,
          group,
          source: xyzSourceName,
          type: 'XYZ',
          format: 'image/png',
          visible: false,
          style: 'add me',
          attribution,
          maxZoom: MAX_ORIGO_ZOOM
        };
        if (tileGrid) xyzLayer.tileGrid = tileGrid;
        if (outputExtent) xyzLayer.extent = outputExtent;

        makeSection('WMTS/XYZ (Origo)', { source: { [xyzSourceName]: xyzSource }, layers: [xyzLayer] }, container);
      } else {
        makeSection('WMTS (non-3857)', {
          note: 'No tile grid metadata was available for this layer. Use WMS/WFS or regenerate cache metadata before using WMTS/XYZ in Origo.',
          wmtsGetCapabilities: `${origin}/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&project=${encodeURIComponent(projectId)}&layer=${encodeURIComponent(layerName)}`
        }, container);
      }

      const wmsSourceName = `Qtiler_${projectKey}_WMS`;
      const wmsSource = {
        url: `${origin}/wms?project=${encodeURIComponent(projectId)}`,
        type: 'WMS',
        params: { LAYERS: layerName }
      };
      const wmsLayer = {
        name: layerName,
        title: `${layerTitle} [WMS]`,
        group,
        source: wmsSourceName,
        type: 'WMS',
        visible: false,
        maxZoom: MAX_ORIGO_ZOOM
      };
      makeSection('WMS', { source: { [wmsSourceName]: wmsSource }, layers: [wmsLayer] }, container);

      if (isVectorLayer(layerData)) {
        const wfsSourceName = `Qtiler_${projectKey}_WFS`;
        const editable = !(configLayer && configLayer.wfsEditable === false);
        const wfsSource = {
          url: `${origin}/wfs?project=${encodeURIComponent(projectId)}&api_key=`,
          type: 'WFS'
        };
        if (editable) {
          wfsSource.workspace = `${origin}/qtiler/${encodeURIComponent(projectId)}`;
        }

        const wfsLayer = {
          name: layerName,
          title: `${layerTitle} [WFS]`,
          queryable: true,
          visible: false,
          type: 'WFS',
          group,
          attribution,
          source: wfsSourceName,
          projection: projection || 'EPSG:3857',
          style: 'add me',
          maxZoom: MAX_ORIGO_ZOOM
        };

        if (editable) {
          wfsLayer.editable = true;
          wfsLayer.attributes = await fetchAttributes(projectId, layerName);
        }

        makeSection('WFS', { source: { [wfsSourceName]: wfsSource }, layers: [wfsLayer] }, container);
      }

      if (searchMetadata) {
        makeSection('Search URL (Qtiler API)', { url: searchMetadata.url }, container);
        makeSection('Search (resolved backend config)', {
          layer: searchMetadata.layer,
          searchAttribute: searchMetadata.searchAttribute,
          idAttribute: searchMetadata.idAttribute,
          geometryAttribute: searchMetadata.geometryAttribute,
          hintText: searchMetadata.hintText,
          layerSpecific: searchMetadata.layerSpecific
        }, container);
      }
    }
  });
})();

