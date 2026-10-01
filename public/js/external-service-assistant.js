(function () {
  'use strict';

  function inferType(rawUrl, hint) {
    if (['xyz', 'wms', 'wmts'].includes(hint)) return hint;
    const value = String(rawUrl || '').trim();
    if (/\{(?:z|x|y)\}/i.test(value)) return 'xyz';
    try {
      const url = new URL(value);
      const serviceEntry = Array.from(url.searchParams.entries()).find(([key]) => key.toLowerCase() === 'service');
      const service = String(serviceEntry?.[1] || '').toLowerCase();
      if (service === 'wms' || service === 'wmts') return service;
      if (/(?:^|\/)wmts(?:\/|$)/i.test(url.pathname)) return 'wmts';
      if (/(?:^|\/)wms(?:\/|$)/i.test(url.pathname)) return 'wms';
    } catch {}
    return 'xyz';
  }

  function slug(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function urlSuggestion(rawUrl) {
    try {
      const url = new URL(String(rawUrl || '').trim());
      const parts = url.pathname.split('/').map((part) => {
        try { return decodeURIComponent(part); } catch { return part; }
      }).filter((part) => part && !/[{}]/.test(part));
      const pathName = parts.at(-1)?.replace(/\.[a-z0-9]+$/i, '');
      return slug(pathName && !['wms', 'wmts', 'service'].includes(pathName.toLowerCase()) ? pathName : url.hostname);
    } catch {
      return '';
    }
  }

  function parseMap(element) {
    const raw = String(element?.value || '').trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Credentials must be JSON objects.');
    return parsed;
  }

  function bind(options) {
    const prefix = String(options?.prefix || '');
    const api = options?.api;
    const get = (suffix) => document.getElementById(`${prefix}${suffix}`);
    const fields = {
      id: get('Id'), type: get('Type'), title: get('Title'), url: get('Url'), projection: get('Projection'),
      layer: get('Layer'), layerSelect: get('LayerSelect'), layerWrap: get('LayerWrap'), matrix: get('MatrixSet'),
      matrixSelect: get('MatrixSetSelect'), matrixWrap: get('MatrixSetWrap'), query: get('Query'), headers: get('Headers'),
      discover: get('Discover'), status: get('DiscoveryStatus')
    };
    if (!fields.url || typeof api !== 'function') return null;
    if (fields.url.dataset.externalAssistantBound === '1') return fields.url._externalAssistant || null;
    fields.url.dataset.externalAssistantBound = '1';

    let timer = null;
    let requestSequence = 0;
    let discoveredLayers = [];
    const edited = new Set();
    ['id', 'title', 'projection'].forEach((name) => fields[name]?.addEventListener('input', () => edited.add(name)));

    const setSuggested = (name, value) => {
      const field = fields[name];
      if (!field || edited.has(name) || !value) return;
      field.value = String(value);
    };
    const resolvedType = () => inferType(fields.url?.value, fields.type?.value);
    const setStatus = (message, isError) => {
      if (!fields.status) return;
      fields.status.textContent = String(message || '');
      fields.status.style.display = message ? '' : 'none';
      fields.status.classList.toggle('has-text-danger', !!isError);
      fields.status.classList.toggle('has-text-grey', !isError);
    };
    const syncVisibility = () => {
      const type = resolvedType();
      if (fields.layerWrap) fields.layerWrap.style.display = type === 'xyz' ? 'none' : '';
      if (fields.matrixWrap) fields.matrixWrap.style.display = type === 'wmts' ? '' : 'none';
      if (type === 'xyz') {
        if (fields.projection && !edited.has('projection')) fields.projection.value = 'EPSG:3857';
        setStatus('XYZ detected. Tile placeholders and Web Mercator defaults are ready.', false);
      }
      return type;
    };
    const selectedLayer = () => discoveredLayers.find((item) => item.id === fields.layerSelect?.value) || null;
    const populateMatrixSets = (layer) => {
      if (!fields.matrixSelect) return;
      const matrixSets = Array.isArray(layer?.matrixSets) ? layer.matrixSets : [];
      fields.matrixSelect.innerHTML = matrixSets.length
        ? matrixSets.map((item) => `<option value="${String(item.id).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">${String(item.title || item.id).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</option>`).join('') + '<option value="__manual__">Manual...</option>'
        : '<option value="__manual__">Enter manually...</option>';
      const first = matrixSets[0];
      fields.matrixSelect.value = first?.id || '__manual__';
      if (fields.matrix) {
        fields.matrix.value = first?.id || '';
        fields.matrix.style.display = fields.matrixSelect.value === '__manual__' ? '' : 'none';
      }
    };
    const applyLayer = () => {
      const layer = selectedLayer();
      if (fields.layer) {
        fields.layer.value = layer?.id || (fields.layerSelect?.value === '__manual__' ? fields.layer.value : '');
        fields.layer.style.display = fields.layerSelect?.value === '__manual__' ? '' : 'none';
      }
      if (layer) {
        setSuggested('title', layer.title || layer.id);
        setSuggested('id', slug(layer.id));
        setSuggested('projection', layer.projection);
      }
      populateMatrixSets(layer);
    };
    const populateLayers = (result) => {
      discoveredLayers = Array.isArray(result?.layers) ? result.layers : [];
      if (!fields.layerSelect) return;
      fields.layerSelect.innerHTML = discoveredLayers.length
        ? discoveredLayers.map((item) => `<option value="${String(item.id).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">${String(item.title || item.id).replace(/&/g, '&amp;').replace(/</g, '&lt;')} (${String(item.id).replace(/&/g, '&amp;').replace(/</g, '&lt;')})</option>`).join('') + '<option value="__manual__">Manual...</option>'
        : '<option value="__manual__">No named layers found - enter manually</option>';
      fields.layerSelect.value = discoveredLayers[0]?.id || '__manual__';
      applyLayer();
    };
    const discover = async () => {
      const url = String(fields.url?.value || '').trim();
      if (!url) { setStatus('', false); return; }
      const type = syncVisibility();
      const suggested = urlSuggestion(url);
      setSuggested('id', suggested);
      setSuggested('title', suggested);
      if (type === 'xyz') return;
      const sequence = ++requestSequence;
      setStatus(`Reading ${type.toUpperCase()} capabilities...`, false);
      if (fields.discover) fields.discover.disabled = true;
      try {
        const result = await api('/api/external-services/discover', {
          method: 'POST',
          body: { type, url, query: parseMap(fields.query), headers: parseMap(fields.headers) }
        });
        if (sequence !== requestSequence) return;
        if (result?.title) setSuggested('title', result.title);
        populateLayers(result);
        setStatus(`${discoveredLayers.length} layer${discoveredLayers.length === 1 ? '' : 's'} available.`, false);
      } catch (error) {
        if (sequence !== requestSequence) return;
        populateLayers({ layers: [] });
        setStatus(`Could not read capabilities: ${String(error?.message || error)}`, true);
      } finally {
        if (sequence === requestSequence && fields.discover) fields.discover.disabled = false;
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      syncVisibility();
      timer = setTimeout(discover, 650);
    };

    fields.url.addEventListener('input', schedule);
    fields.url.addEventListener('change', discover);
    fields.type?.addEventListener('change', discover);
    fields.discover?.addEventListener('click', discover);
    fields.layerSelect?.addEventListener('change', applyLayer);
    fields.matrixSelect?.addEventListener('change', () => {
      if (!fields.matrix) return;
      fields.matrix.style.display = fields.matrixSelect.value === '__manual__' ? '' : 'none';
      if (fields.matrixSelect.value !== '__manual__') {
        fields.matrix.value = fields.matrixSelect.value;
        const matrix = selectedLayer()?.matrixSets?.find((item) => item.id === fields.matrixSelect.value);
        setSuggested('projection', matrix?.projection);
      }
    });

    const assistant = {
      discover,
      refresh: () => { syncVisibility(); if (fields.url.value) schedule(); },
      type: resolvedType,
      layer: () => fields.layerSelect?.value && fields.layerSelect.value !== '__manual__' ? fields.layerSelect.value : String(fields.layer?.value || '').trim(),
      matrixSet: () => fields.matrixSelect?.value && fields.matrixSelect.value !== '__manual__' ? fields.matrixSelect.value : String(fields.matrix?.value || '').trim()
    };
    fields.url._externalAssistant = assistant;
    syncVisibility();
    return assistant;
  }

  window.QtilerExternalServiceAssistant = { bind, inferType };
})();
