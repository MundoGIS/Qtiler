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

  hooks.layerInfoTabs.push({
    id: 'qrigo',
    title: 'Origo',
    shouldShow: (ctx) => !!ctx?.layerData?.name,
    render: async ({ container, projectId, layerData, projectMeta, tileMatrixSet, configLayer, output }) => {
      const origin = window.location.origin;
      const layerName = layerData?.name || 'layer';
      const layerTitle = layerData?.title || layerName;
      const projectKey = sanitizeId(projectId || 'project');
      const layerKey = sanitizeId(layerName);
      const group = projectId || 'qtiler';
      const projection = projectMeta?.crs || layerData?.crs || null;
      const attribution = layerData?.attribution || undefined;

      const apiNote = document.createElement('div');
      apiNote.className = 'meta';
      apiNote.style.marginBottom = '12px';
      apiNote.textContent = 'If the layer is private, replace the empty api_key with the user\'s API key.';
      container.appendChild(apiNote);

      const xyzUrl = `${origin}/wmts/${encodeURIComponent(projectId)}/${encodeURIComponent(layerName)}/{z}/{x}/{y}.png`;
      const tileGrid = buildTileGrid(tileMatrixSet, output);

      if (tileGrid) {
        const xyzSourceName = `Qtiler_${projectKey}_${layerKey}_XYZ`;
        const xyzSource = {
          url: xyzUrl,
          type: 'XYZ'
        };
        if (projection) xyzSource.projection = projection;

        const xyzLayer = {
          name: layerName,
          title: layerTitle,
          group,
          source: xyzSourceName,
          type: 'XYZ',
          format: 'image/png',
          visible: false,
          style: 'add me',
          attribution,
          tileGrid
        };

        makeSection('WMTS/XYZ (Origo)', { source: { [xyzSourceName]: xyzSource }, layers: [xyzLayer] }, container);
      }

      const wmsSourceName = `Qtiler_${projectKey}_WMS`;
      const wmsSource = {
        url: `${origin}/wms?project=${encodeURIComponent(projectId)}`,
        type: 'WMS',
        params: { LAYERS: layerName }
      };
      const wmsLayer = {
        name: layerName,
        title: layerTitle,
        group,
        source: wmsSourceName,
        type: 'WMS',
        visible: false
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
          title: layerTitle,
          queryable: true,
          visible: false,
          type: 'WFS',
          group,
          attribution,
          source: wfsSourceName,
          style: 'add me'
        };

        if (editable) {
          wfsLayer.editable = true;
          wfsLayer.attributes = await fetchAttributes(projectId, layerName);
        }

        makeSection('WFS', { source: { [wfsSourceName]: wfsSource }, layers: [wfsLayer] }, container);
      }

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

      if (mergedSearchableLayers.length > 0) {
        const layerSafeName = safeXmlName(layerName);
        const searchEntry = mergedSearchableLayers.find((entry) => {
          const entryName = String(entry?.name || '').trim();
          if (!entryName) return false;
          return entryName === layerName || safeXmlName(entryName) === layerSafeName;
        }) || mergedSearchableLayers[0];
        const fields = Array.isArray(searchEntry?.fields)
          ? searchEntry.fields.map((f) => String(f || '').trim()).filter(Boolean)
          : [];
        const searchAttribute = String(searchEntry?.titleField || fields[0] || '').trim() || 'name';
        const origoSearchUrl = `${origin}/api/search?project=${encodeURIComponent(projectId)}&api_key=`;

        const origoSearchSnippet = {
          name: 'search',
          options: {
            url: origoSearchUrl,
            layerNameAttribute: 'TYPE',
            idAttribute: 'GID',
            searchAttribute,
            geometryAttribute: 'GEOM',
            hintText: 'Sök projekt...'
          }
        };

        makeSection('Search URL (Qtiler API)', { url: origoSearchUrl }, container);
        makeSection('Search (Origo)', origoSearchSnippet, container);
      }
    }
  });
})();
