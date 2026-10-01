const API_BASE = '/plugins/Qtiler-3D-eye';

const state = {
  projects: [],
  scenes: [],
  modules: [],
  moduleDefaults: {},
  assets: [],
  reusableTerrains: [],
  layerCatalog: {},
  svgIcons: [],
  svgPickerTarget: null,
  gltfPickerTarget: null,
  editing: null,
  status: null,
  settings: {},
  cesiumReleases: [],
  stylePresets: [],
  layerAttributes: {}
};

const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const normalized = { credentials: 'include', ...options };
  if (normalized.body && typeof normalized.body === 'object' && !(normalized.body instanceof FormData) && !(normalized.body instanceof Blob)) {
    normalized.headers = { 'Content-Type': 'application/json', ...(normalized.headers || {}) };
    normalized.body = JSON.stringify(normalized.body);
  }
  const response = await fetch(path, normalized);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || payload?.details || `HTTP ${response.status}`);
  return payload;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[ch]));
}

function projectLabel(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  return project?.title || project?.name || projectId;
}

function sanitizeToken(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function setupTabs() {
  document.querySelectorAll('.tab-btn[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset.tab;
      document.querySelectorAll('.tab-btn[data-tab]').forEach((item) => item.classList.toggle('tab-btn--active', item === button));
      document.querySelectorAll('.tab-panel[data-panel]').forEach((panel) => panel.classList.toggle('tab-panel--active', panel.dataset.panel === tab));
    });
  });
}

function setupModalTabs() {
  document.querySelectorAll('[data-modal-tab]').forEach((button) => {
    button.addEventListener('click', () => activateModalTab(button.dataset.modalTab));
  });
}

function activateModalTab(tab = 'map') {
  document.querySelectorAll('[data-modal-tab]').forEach((button) => button.classList.toggle('modal-tab-btn--active', button.dataset.modalTab === tab));
  document.querySelectorAll('[data-modal-panel]').forEach((panel) => panel.classList.toggle('modal-tab-panel--active', panel.dataset.modalPanel === tab));
}

function toggleSceneFullscreen() {
  const modal = $('#sceneModal');
  const button = $('#toggleSceneFullscreen');
    if (!modal) return;
    const enabled = !modal.classList.contains('is-fullscreen');
    modal.classList.toggle('is-fullscreen', enabled);
    if (button) button.textContent = enabled ? 'Exit full screen' : 'Full screen';
}

function hasInstalledCesiumRuntime() {
  return state.status?.cesium?.installed === true;
}

function showCesiumRequiredMessage() {
  alert('Install the Cesium runtime before creating or publishing 3D maps. Open the Cesium tab, choose a release and click Install Cesium.');
}

function activateAdminTab(tab = 'maps') {
  document.querySelectorAll('.tab-btn[data-tab]').forEach((item) => item.classList.toggle('tab-btn--active', item.dataset.tab === tab));
  document.querySelectorAll('.tab-panel[data-panel]').forEach((panel) => panel.classList.toggle('tab-panel--active', panel.dataset.panel === tab));
}

function renderStatus() {
  const cesium = state.status?.cesium || {};
  const installed = !!cesium.installed;
  const badge = $('#cesiumBadge');
  const info = $('#cesiumInfo');
  const open = $('#openCesiumRuntimeBtn');
  if (badge) {
    badge.textContent = installed ? 'Installed' : 'Not installed';
    badge.className = `badge ${installed ? 'badge--ok' : 'badge--warn'}`;
  }
  if (info) {
    if (installed) {
      const date = cesium.installedAt ? new Date(cesium.installedAt).toLocaleString() : 'unknown date';
      info.textContent = `Cesium ${cesium.version || ''} is installed from ${cesium.repo || 'CesiumGS/cesium'} on ${date}.`;
      info.className = 'info-box info-box--ok';
    } else {
      info.textContent = cesium.lastError ? `Cesium is not installed. Last error: ${cesium.lastError}` : 'Cesium is not installed. Select a GitHub release and install it locally.';
      info.className = cesium.lastError ? 'info-box info-box--warn' : 'info-box info-box--muted';
    }
  }
  if ($('#cesiumRepo') && !$('#cesiumRepo').value) $('#cesiumRepo').value = cesium.repo || 'CesiumGS/cesium';
  if ($('#installCesiumBtn')) $('#installCesiumBtn').disabled = false;
  if ($('#uninstallCesiumBtn')) $('#uninstallCesiumBtn').disabled = !installed;
  if ($('#newSceneBtn')) {
    $('#newSceneBtn').disabled = !installed;
    $('#newSceneBtn').title = installed ? '' : 'Install Cesium before creating 3D maps.';
  }
  if ($('#cesiumRequiredNotice')) $('#cesiumRequiredNotice').hidden = installed;
  if (open) {
    open.href = installed ? (cesium.url || `${API_BASE}/cesium/Cesium.js`) : '#';
    open.classList.toggle('is-disabled', !installed);
  }
  if ($('#tabMapsBadge')) $('#tabMapsBadge').textContent = String(state.scenes.length || state.status?.scenes || 0);
}

function renderSettingsForm() {
  const settings = state.settings || {};
  if ($('#globalIonToken')) $('#globalIonToken').value = settings.ionToken || '';
  if ($('#globalLogoUrl')) $('#globalLogoUrl').value = settings.logoUrl || '';
  if ($('#globalHeaderTitle')) $('#globalHeaderTitle').value = settings.headerTitle || 'Qtiler 3D Eye';
  if ($('#globalHeaderSubtitle')) $('#globalHeaderSubtitle').value = settings.headerSubtitle || '';
  if ($('#globalGalleryTitle')) $('#globalGalleryTitle').value = settings.galleryTitle || '3D Maps Gallery';
}

async function loadStatus() {
  state.status = await api(`${API_BASE}/api/status`);
  state.settings = state.status.settings || state.settings || {};
  renderStatus();
  renderSettingsForm();
}

async function loadCesiumReleases() {
  const repo = String($('#cesiumRepo')?.value || 'CesiumGS/cesium').trim();
  const prerelease = $('#includeCesiumPrerelease')?.checked ? '1' : '0';
  const select = $('#cesiumVersion');
  if (select) select.innerHTML = '<option value="">Loading releases...</option>';
  try {
    const payload = await api(`${API_BASE}/api/cesium/releases?repo=${encodeURIComponent(repo)}&prerelease=${prerelease}`);
    state.cesiumReleases = payload.releases || [];
    if (!select) return;
    select.innerHTML = state.cesiumReleases.length
      ? state.cesiumReleases.map((release) => {
          const pre = release.prerelease ? ' [pre]' : '';
          const size = release.assetSize ? ` (${(release.assetSize / 1048576).toFixed(1)} MB)` : '';
          return `<option value="${escapeHtml(release.tag)}" data-asset-url="${escapeHtml(release.assetUrl || '')}">${escapeHtml(release.name || release.tag)}${pre}${size}</option>`;
        }).join('')
      : '<option value="">No CesiumJS ZIP releases found</option>';
    const current = state.status?.cesium?.version || payload.defaultVersion || '';
    Array.from(select.options).forEach((option) => { if (option.value === current) option.selected = true; });
  } catch (err) {
    if (select) select.innerHTML = `<option value="">${escapeHtml(err.message)}</option>`;
  }
}

async function installCesium() {
  const button = $('#installCesiumBtn');
  const original = button?.textContent || 'Install Cesium';
  if (button) { button.disabled = true; button.textContent = 'Installing...'; }
  try {
    const selected = $('#cesiumVersion')?.selectedOptions?.[0];
    await api(`${API_BASE}/api/cesium/install`, {
      method: 'POST',
      body: {
        repo: String($('#cesiumRepo')?.value || 'CesiumGS/cesium').trim(),
        version: String($('#cesiumVersion')?.value || '').trim(),
        assetUrl: selected?.dataset?.assetUrl || ''
      }
    });
    await loadStatus();
  } catch (err) {
    alert(`Cesium install failed: ${err.message}`);
  } finally {
    if (button) { button.disabled = false; button.textContent = original; }
  }
}

async function uninstallCesium() {
  if (!confirm('Uninstall the local Cesium runtime? New maps and the Cesium viewer will be unavailable until Cesium is installed again.')) return;
  await api(`${API_BASE}/api/cesium/install`, { method: 'DELETE' });
  await loadStatus();
}

async function saveSettings(event) {
  event.preventDefault();
  const status = $('#settingsStatus');
  if (status) status.textContent = 'Saving...';
  try {
    const payload = await api(`${API_BASE}/api/settings`, {
      method: 'POST',
      body: {
        ionToken: $('#globalIonToken')?.value || '',
        logoUrl: $('#globalLogoUrl')?.value || '',
        headerTitle: $('#globalHeaderTitle')?.value || '',
        headerSubtitle: $('#globalHeaderSubtitle')?.value || '',
        galleryTitle: $('#globalGalleryTitle')?.value || ''
      }
    });
    state.settings = payload.settings || {};
    if (status) status.textContent = 'Settings saved.';
  } catch (err) {
    if (status) status.textContent = err.message;
  }
}

function qgis3dTilesAssetId(projectId, layerName) {
  return sanitizeToken(`qgis3d_${projectId}_${layerName}`);
}

function qgis3dTilesAsset(projectId, layerName) {
  const id = qgis3dTilesAssetId(projectId, layerName);
  return state.assets.find((asset) => asset.type === '3dtiles' && asset.id === id) || null;
}

function fillProjectSelect(select) {
  if (!select) return;
  select.innerHTML = state.projects.length
    ? state.projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.title || project.name || project.id)}</option>`).join('')
    : '<option value="">No projects</option>';
}

function selectedCheckboxValues(container) {
  return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value);
}

function renderProjectChecks(container, selected = []) {
  const selectedSet = new Set(selected);
  container.innerHTML = state.projects.map((project) => {
    const label = project.title || project.name || project.id;
    const checked = selectedSet.has(project.id) ? 'checked' : '';
    return `
      <label class="check-card">
        <input type="checkbox" value="${escapeHtml(project.id)}" ${checked}>
        <span>${escapeHtml(label)}</span>
      </label>
    `;
  }).join('') || '<div class="empty-state">No projects available.</div>';
}

function renderExternalProjectChecks(selected = []) {
  const selectedSet = new Set(selected);
  const mainProjectId = $('#mainProjectSelect')?.value || '';
  const projects = state.projects.filter((project) => project.id !== mainProjectId);
  $('#externalProjectsList').innerHTML = projects.map((project) => {
    const label = project.title || project.name || project.id;
    const checked = selectedSet.has(project.id) ? 'checked' : '';
    return `
      <label class="check-card">
        <input type="checkbox" value="${escapeHtml(project.id)}" ${checked}>
        <span>${escapeHtml(label)}</span>
      </label>
    `;
  }).join('') || '<div class="empty-state">No other projects available.</div>';
}

function renderTerrainChecks(selectedTerrainProjects = [], selectedAssetIds = []) {
  const selectedTerrainSet = new Set(selectedTerrainProjects);
  const selectedAssetSet = new Set(selectedAssetIds);
  const projectCards = state.projects.map((project) => {
    const label = project.title || project.name || project.id;
    const checked = selectedTerrainSet.has(project.id) ? 'checked' : '';
    return `
      <label class="check-card">
        <input type="checkbox" value="${escapeHtml(project.id)}" data-terrain-project ${checked}>
        <span>${escapeHtml(label)} <small>proyecto</small></span>
      </label>
    `;
  });
  const libraryCards = state.reusableTerrains.map((terrain) => {
    const isUploaded = terrain.source === 'uploaded' && terrain.assetId;
    const value = isUploaded ? terrain.assetId : (terrain.id || terrain.project || terrain.projectId);
    const checked = isUploaded ? selectedAssetSet.has(value) : selectedTerrainSet.has(value);
    return `
      <label class="check-card terrain-library-card">
        <input type="checkbox" value="${escapeHtml(value)}" ${isUploaded ? 'data-terrain-asset' : 'data-terrain-project'} ${checked ? 'checked' : ''}>
        <span>${escapeHtml(terrain.name || value)} <small>${escapeHtml(terrain.source || 'terrain')}</small></span>
      </label>
    `;
  });
  $('#terrainProjectsList').innerHTML = [...projectCards, ...libraryCards].join('') || '<div class="empty-state">No projects or terrain assets available.</div>';
}

function readTerrainSelection() {
  return {
    terrainProjects: Array.from(document.querySelectorAll('#terrainProjectsList [data-terrain-project]:checked')).map((input) => input.value),
    terrainAssetIds: Array.from(document.querySelectorAll('#terrainProjectsList [data-terrain-asset]:checked')).map((input) => input.value)
  };
}

async function getProjectLayers(projectId) {
  if (!projectId) return { layers: [], qgis3d: { available: false, layers: [] }, view3d: { available: false, layers: [] }, terrains: [] };
  if (!state.layerCatalog[projectId]) {
    state.layerCatalog[projectId] = await api(`${API_BASE}/api/project-layers?project=${encodeURIComponent(projectId)}`);
  }
  return state.layerCatalog[projectId];
}

function layerConfigByName(items = []) {
  const map = new Map();
  items.forEach((item) => map.set(item.name, item));
  return map;
}

function defaultLayerStyle(layer = {}, previous = {}) {
  return {
    color: previous.color || layer.color || '#2f80ed',
    strokeColor: previous.strokeColor || '#ffffff',
    fillOpacity: previous.fillOpacity ?? 0.55,
    strokeOpacity: previous.strokeOpacity ?? 1,
    strokeWidth: previous.strokeWidth ?? 2,
    extrusionHeight: previous.extrusionHeight ?? layer.extrusionHeight ?? '',
    pointSize: previous.pointSize ?? 18,
    symbolType: previous.symbolType || (previous.modelAssetId ? 'gltf' : (previous.iconUrl ? 'svg' : 'point')),
    iconUrl: previous.iconUrl || '',
    iconScale: previous.iconScale ?? 1,
    modelAssetId: previous.modelAssetId || '',
    modelScale: previous.modelScale ?? 1,
    heightOffset: previous.heightOffset ?? 0,
    minZoom: previous.minZoom ?? '',
    maxZoom: previous.maxZoom ?? '',
    styleRules: Array.isArray(previous.styleRules) ? previous.styleRules : []
  };
}

function stylePresetOptions(selected = '') {
  return `<option value="">Choose saved style</option>${state.stylePresets.map((preset) => `<option value="${escapeHtml(preset.id)}" ${preset.id === selected ? 'selected' : ''}>${escapeHtml(preset.name || preset.id)}</option>`).join('')}`;
}

function rowProjectId(row) {
  return row?.dataset.layerProject || row?.dataset.externalProject || $('#mainProjectSelect')?.value || '';
}

function rowLayerName(row) {
  return row?.dataset.layerName || row?.dataset.externalLayer || '';
}

async function getLayerAttributes(projectId, layerName) {
  if (!projectId || !layerName) return { fields: [] };
  const key = `${projectId}:${layerName}`;
  if (!state.layerAttributes[key]) {
    state.layerAttributes[key] = await api(`${API_BASE}/api/layer-attributes?project=${encodeURIComponent(projectId)}&layer=${encodeURIComponent(layerName)}&limit=700`);
  }
  return state.layerAttributes[key];
}

function modelAssetOptions(selected = '') {
  const models = state.assets.filter((asset) => asset.type === 'model');
  return `<option value="">No GLTF model</option>${models.map((asset) => `<option value="${escapeHtml(asset.id)}" ${asset.id === selected ? 'selected' : ''}>${escapeHtml(asset.name || asset.id)}</option>`).join('')}`;
}

function modelAssetById(assetId) {
  return state.assets.find((asset) => asset.type === 'model' && asset.id === assetId) || null;
}

function gltfMiniViewHtml(selected = '') {
  const asset = modelAssetById(selected);
  return `
    <div class="gltf-mini-view" data-gltf-mini>
      <input data-layer-model-asset type="hidden" value="${escapeHtml(selected || '')}">
      <div class="gltf-mini-preview">
        <span class="gltf-cube">GLTF</span>
        <div><strong>${escapeHtml(asset?.name || 'No model selected')}</strong><small>${asset ? escapeHtml(asset.url || asset.originalName || asset.id) : 'Choose, upload or register a reusable model.'}</small></div>
      </div>
      <button class="button ghost choose-model-button" type="button" data-pick-gltf><span class="gltf-button-icon">GLTF</span> Choose model</button>
    </div>
  `;
}

function geometryKind(layer = {}) {
  const raw = String(layer.geometryType || layer.type || '').toLowerCase();
  if (raw.includes('point')) return 'point';
  if (raw.includes('line') || raw.includes('curve')) return 'line';
  if (raw.includes('polygon') || raw.includes('surface')) return 'polygon';
  if (layer.hasWfs) return 'polygon';
  return 'wms';
}

function projectLayerStats(info = {}) {
  const layers = info.layers || [];
  const wfs = layers.filter((layer) => layer.hasWfs).length;
  const qgis3d = (info.qgis3d?.layers || info.view3d?.layers || []).length;
  return {
    layers: layers.length,
    wfs,
    wms: Math.max(0, layers.length - wfs),
    qgis3d
  };
}

function statsPillsHtml(stats = {}) {
  return `
    <span class="stat-pill"><strong>${escapeHtml(stats.layers || 0)}</strong> layers</span>
    <span class="stat-pill"><strong>${escapeHtml(stats.wfs || 0)}</strong> editable WFS</span>
    <span class="stat-pill"><strong>${escapeHtml(stats.wms || 0)}</strong> WMS</span>
    <span class="stat-pill"><strong>${escapeHtml(stats.qgis3d || 0)}</strong> 3D</span>
  `;
}

function renderMainProjectOverview(projectId, info = null) {
  const overview = $('#mainProjectOverview');
  const projectName = $('#mainLayersProjectName');
  const label = projectId ? projectLabel(projectId) : 'No project selected';
  if (projectName) projectName.textContent = label;
  if (!overview) return;
  if (!projectId) {
    overview.innerHTML = '<div class="project-overview-empty">Select a Qtiler project to load its layers.</div>';
    return;
  }
  if (!info) {
    overview.innerHTML = `<div class="project-overview-title">${escapeHtml(label)}</div><div class="project-overview-empty">Loading project layers...</div>`;
    return;
  }
  overview.innerHTML = `
    <div class="project-overview-title">${escapeHtml(label)}</div>
    <div class="project-overview-stats">${statsPillsHtml(projectLayerStats(info))}</div>
  `;
}

function updateMainLayerStats() {
  const rows = Array.from(document.querySelectorAll('#mainLayersList [data-layer-name]'));
  const included = rows.filter((row) => row.querySelector('[data-layer-include]')?.checked).length;
  const visible = rows.filter((row) => row.querySelector('[data-layer-visible]')?.checked).length;
  const wfs = rows.filter((row) => row.querySelector('[data-layer-service]')?.value === 'wfs').length;
  const stats = $('#mainLayersStats');
  if (stats) {
    stats.innerHTML = rows.length ? `
      <span class="stat-pill"><strong>${included}</strong> selected</span>
      <span class="stat-pill"><strong>${visible}</strong> visible</span>
      <span class="stat-pill"><strong>${wfs}</strong> WFS styleable</span>
    ` : '';
  }
}

function applyMainLayerFilter() {
  const needle = String($('#mainLayerFilter')?.value || '').trim().toLowerCase();
  document.querySelectorAll('#mainLayersList [data-layer-name]').forEach((row) => {
    const text = `${row.dataset.layerName || ''} ${row.dataset.geometryKind || ''} ${row.textContent || ''}`.toLowerCase();
    row.hidden = !!needle && !text.includes(needle);
  });
}

function setMainLayerSelection(checked) {
  document.querySelectorAll('#mainLayersList [data-layer-include]').forEach((input) => {
    if (!input.closest('[data-layer-name]')?.hidden) input.checked = checked;
  });
  updateMainLayerStats();
}

function stylePreviewHtml(kind, style) {
  const color = escapeHtml(style.color || '#2f80ed');
  const stroke = escapeHtml(style.strokeColor || '#ffffff');
  const fillOpacity = Math.max(0, Math.min(1, Number(style.fillOpacity ?? 0.55)));
  const strokeWidth = Math.max(1, Number(style.strokeWidth || 2));
  const iconUrl = String(style.iconUrl || '').trim();
  if (kind === 'point') {
    const inner = style.symbolType === 'gltf' && style.modelAssetId
      ? `<span class="style-preview-model">GLTF</span>`
      : iconUrl
      ? `<img src="${escapeHtml(iconUrl)}" alt="" style="width:${Math.max(18, Number(style.pointSize || 18))}px;height:${Math.max(18, Number(style.pointSize || 18))}px;object-fit:contain;">`
      : `<span class="style-preview-point" style="width:${Math.max(10, Number(style.pointSize || 18))}px;height:${Math.max(10, Number(style.pointSize || 18))}px;background:${color};border:${strokeWidth}px solid ${stroke};"></span>`;
    return `<div class="style-preview style-preview--point">${inner}<small>${Number(style.heightOffset || 0)} m</small></div>`;
  }
  if (kind === 'line') {
    return `<div class="style-preview style-preview--line"><svg viewBox="0 0 150 44" aria-hidden="true"><path d="M8 30 C42 3 73 43 142 14" fill="none" stroke="${stroke || color}" stroke-width="${strokeWidth + 2}" stroke-linecap="round"/></svg><small>${Number(style.heightOffset || 0)} m</small></div>`;
  }
  return `<div class="style-preview style-preview--polygon"><svg viewBox="0 0 150 58" aria-hidden="true"><polygon points="16,44 36,12 86,9 135,28 116,51 54,48" fill="${color}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${strokeWidth}"/></svg><small>${Number(style.heightOffset || 0)} m</small></div>`;
}

function styleRuleHtml(rule = {}, kind = 'polygon') {
  const isPoint = kind === 'point';
  const isLine = kind === 'line';
  const isPolygon = kind === 'polygon';
  const operator = rule.operator || '=';
  const symbolType = rule.symbolType || (rule.modelAssetId ? 'gltf' : (rule.iconUrl ? 'svg' : 'point'));
  return `
    <div class="style-rule-row" data-style-rule>
      <select data-rule-field data-current-value="${escapeHtml(rule.field || '')}"><option value="${escapeHtml(rule.field || '')}">${escapeHtml(rule.field || 'Any field')}</option></select>
      <select data-rule-operator>
        ${['=', '!=', 'contains', '>', '<', '>=', '<='].map((op) => `<option value="${op}" ${operator === op ? 'selected' : ''}>${op}</option>`).join('')}
      </select>
      <input data-rule-value type="text" value="${escapeHtml(rule.value ?? '')}" placeholder="Value">
      <input data-rule-color ${isLine ? 'hidden' : ''} type="color" value="${escapeHtml(rule.color || '#2f80ed')}">
      <input data-rule-stroke-color type="color" value="${escapeHtml(rule.strokeColor || '#ffffff')}" title="Stroke/line">
      <input data-rule-fill-opacity ${isPolygon || isPoint ? '' : 'hidden'} type="number" min="0" max="1" step="0.05" value="${escapeHtml(rule.fillOpacity ?? 0.55)}" title="Opacity">
      <input data-rule-stroke-width type="number" min="0" step="1" value="${escapeHtml(rule.strokeWidth ?? 2)}" title="Width">
      <input data-rule-height-offset type="number" step="0.1" value="${escapeHtml(rule.heightOffset ?? 0)}" title="Height offset m">
      <input data-rule-extrusion-height ${isPolygon ? '' : 'hidden'} type="number" min="0" step="0.1" value="${escapeHtml(rule.extrusionHeight ?? '')}" placeholder="Extrude m" title="Extrusion height m">
      <input data-rule-min-zoom type="number" min="0" step="1" value="${escapeHtml(rule.minZoom ?? '')}" placeholder="Zoom from">
      <input data-rule-max-zoom type="number" min="0" step="1" value="${escapeHtml(rule.maxZoom ?? '')}" placeholder="Zoom to">
      <select data-rule-symbol-type ${isPoint ? '' : 'hidden'}>
        <option value="point" ${symbolType === 'point' ? 'selected' : ''}>Point</option>
        <option value="svg" ${symbolType === 'svg' ? 'selected' : ''}>SVG</option>
        <option value="gltf" ${symbolType === 'gltf' ? 'selected' : ''}>GLTF</option>
      </select>
      <input data-rule-icon-url ${isPoint ? '' : 'hidden'} type="text" value="${escapeHtml(rule.iconUrl || '')}" placeholder="SVG url">
      <select data-rule-model-asset ${isPoint ? '' : 'hidden'}>${modelAssetOptions(rule.modelAssetId || '')}</select>
      <button class="button ghost" type="button" data-pick-rule-gltf ${isPoint ? '' : 'hidden'}>Library</button>
      <input data-rule-model-scale ${isPoint ? '' : 'hidden'} type="number" min="0.01" step="any" value="${escapeHtml(rule.modelScale ?? 1)}" title="Escala GLTF">
      <button class="button danger" type="button" data-remove-rule>Remove</button>
    </div>
  `;
}

function styleEditorHtml(kind, style) {
  const isPoint = kind === 'point';
  const isLine = kind === 'line';
  const isPolygon = kind === 'polygon';
  const rules = style.styleRules || [];
  return `
    <details class="layer-style-editor">
      <summary>WFS style ${escapeHtml(kind)}</summary>
      <div class="style-toolbar">
        <button class="button ghost" type="button" data-load-layer-attributes>Load fields</button>
        <button class="button ghost" type="button" data-save-style-preset>Save style</button>
        <select data-style-preset-select>${stylePresetOptions()}</select>
        <button class="button ghost" type="button" data-apply-style-preset>Apply style</button>
      </div>
      <div class="style-editor-layout">
        <div data-style-preview></div>
        <div class="style-grid">
          <label ${isLine ? 'hidden' : ''}><span>Color</span><input data-layer-color type="color" value="${escapeHtml(style.color)}"></label>
          <label><span>${isLine ? 'Line color' : 'Stroke'}</span><input data-layer-stroke-color type="color" value="${escapeHtml(style.strokeColor)}"></label>
          <label ${isPolygon || isPoint ? '' : 'hidden'}><span>Opacity</span><input data-layer-fill-opacity type="number" min="0" max="1" step="0.05" value="${escapeHtml(style.fillOpacity)}"></label>
          <label><span>Stroke op.</span><input data-layer-stroke-opacity type="number" min="0" max="1" step="0.05" value="${escapeHtml(style.strokeOpacity)}"></label>
          <label><span>${isLine ? 'Line px' : 'Stroke px'}</span><input data-layer-stroke-width type="number" min="0" step="1" value="${escapeHtml(style.strokeWidth)}"></label>
          <label ${isPolygon ? '' : 'hidden'}><span>Extrude m</span><input data-layer-extrusion-height type="number" min="0" step="0.1" value="${escapeHtml(style.extrusionHeight)}" placeholder="No extrusion"></label>
          <label><span>Height m</span><input data-layer-height-offset type="number" step="0.1" value="${escapeHtml(style.heightOffset)}"></label>
          <label><span>Zoom from</span><input data-layer-min-zoom type="number" min="0" step="1" value="${escapeHtml(style.minZoom)}" placeholder="auto"></label>
          <label><span>Zoom to</span><input data-layer-max-zoom type="number" min="0" step="1" value="${escapeHtml(style.maxZoom)}" placeholder="auto"></label>
          <label ${isPoint ? '' : 'hidden'}><span>Point size</span><input data-layer-point-size type="number" min="4" step="1" value="${escapeHtml(style.pointSize)}"></label>
          <label ${isPoint ? '' : 'hidden'}><span>Symbol</span><select data-layer-symbol-type><option value="point" ${style.symbolType === 'point' ? 'selected' : ''}>Simple point</option><option value="svg" ${style.symbolType === 'svg' ? 'selected' : ''}>SVG</option><option value="gltf" ${style.symbolType === 'gltf' ? 'selected' : ''}>GLTF</option></select></label>
          <label ${isPoint ? '' : 'hidden'} class="style-svg-field" data-symbol-scope="svg"><span>Point SVG</span><input data-layer-icon-url type="text" value="${escapeHtml(style.iconUrl)}" placeholder="Select SVG"><button class="button ghost" type="button" data-pick-svg>Choose</button></label>
          <label ${isPoint ? '' : 'hidden'} data-symbol-scope="svg"><span>SVG scale</span><input data-layer-icon-scale type="number" min="0.05" step="0.05" value="${escapeHtml(style.iconScale)}"></label>
          <div ${isPoint ? '' : 'hidden'} class="gltf-style-box" data-symbol-scope="gltf">${gltfMiniViewHtml(style.modelAssetId)}<label><span>GLTF scale</span><input data-layer-model-scale type="number" min="0.01" step="any" value="${escapeHtml(style.modelScale)}"></label></div>
        </div>
      </div>
      <div class="style-rules">
        <div class="style-rules-head"><strong>Attribute, value, zoom and extrusion rules</strong><button class="button ghost" type="button" data-add-style-rule>Add rule</button></div>
        <div class="style-rule-list" data-style-rule-list>${rules.map((rule) => styleRuleHtml(rule, kind)).join('')}</div>
      </div>
    </details>
  `;
}

function readStyleFromRow(row) {
  const symbolType = row.querySelector('[data-layer-symbol-type]')?.value || 'point';
  return {
    color: row.querySelector('[data-layer-color]')?.value || '#2f80ed',
    strokeColor: row.querySelector('[data-layer-stroke-color]')?.value || '#ffffff',
    fillOpacity: Number(row.querySelector('[data-layer-fill-opacity]')?.value ?? 0.55),
    strokeOpacity: Number(row.querySelector('[data-layer-stroke-opacity]')?.value ?? 1),
    strokeWidth: Number(row.querySelector('[data-layer-stroke-width]')?.value ?? 2),
    extrusionHeight: row.querySelector('[data-layer-extrusion-height]')?.value === '' ? null : Number(row.querySelector('[data-layer-extrusion-height]')?.value),
    pointSize: Number(row.querySelector('[data-layer-point-size]')?.value ?? 18),
    symbolType,
    iconUrl: symbolType === 'svg' ? (row.querySelector('[data-layer-icon-url]')?.value.trim() || '') : '',
    iconScale: Number(row.querySelector('[data-layer-icon-scale]')?.value ?? 1),
    modelAssetId: symbolType === 'gltf' ? (row.querySelector('[data-layer-model-asset]')?.value || '') : '',
    modelScale: Number(row.querySelector('[data-layer-model-scale]')?.value ?? 1),
    heightOffset: Number(row.querySelector('[data-layer-height-offset]')?.value ?? 0),
    minZoom: row.querySelector('[data-layer-min-zoom]')?.value === '' ? null : Number(row.querySelector('[data-layer-min-zoom]')?.value),
    maxZoom: row.querySelector('[data-layer-max-zoom]')?.value === '' ? null : Number(row.querySelector('[data-layer-max-zoom]')?.value)
  };
}

function readStyleRulesFromRow(row) {
  return Array.from(row.querySelectorAll('[data-style-rule]')).map((rule) => {
    const symbolType = rule.querySelector('[data-rule-symbol-type]')?.value || 'point';
    return {
    field: rule.querySelector('[data-rule-field]')?.value.trim() || '',
    operator: rule.querySelector('[data-rule-operator]')?.value || '=',
    value: rule.querySelector('[data-rule-value]')?.value.trim() || '',
    color: rule.querySelector('[data-rule-color]')?.value || null,
    strokeColor: rule.querySelector('[data-rule-stroke-color]')?.value || null,
    fillOpacity: Number(rule.querySelector('[data-rule-fill-opacity]')?.value ?? 0.55),
    strokeWidth: Number(rule.querySelector('[data-rule-stroke-width]')?.value ?? 2),
    heightOffset: Number(rule.querySelector('[data-rule-height-offset]')?.value ?? 0),
    extrusionHeight: rule.querySelector('[data-rule-extrusion-height]')?.value === '' ? null : Number(rule.querySelector('[data-rule-extrusion-height]')?.value),
    minZoom: rule.querySelector('[data-rule-min-zoom]')?.value === '' ? null : Number(rule.querySelector('[data-rule-min-zoom]')?.value),
    maxZoom: rule.querySelector('[data-rule-max-zoom]')?.value === '' ? null : Number(rule.querySelector('[data-rule-max-zoom]')?.value),
    symbolType,
    iconUrl: symbolType === 'svg' ? (rule.querySelector('[data-rule-icon-url]')?.value.trim() || null) : null,
    modelAssetId: symbolType === 'gltf' ? (rule.querySelector('[data-rule-model-asset]')?.value || null) : null,
    modelScale: Number(rule.querySelector('[data-rule-model-scale]')?.value ?? 1)
  };
  }).filter((rule) => rule.field || rule.minZoom !== null || rule.maxZoom !== null || rule.extrusionHeight !== null);
}

function layerStylePayload(row) {
  return { ...readStyleFromRow(row), styleRules: readStyleRulesFromRow(row) };
}

function updateLayerStylePreview(row) {
  const preview = row.querySelector('[data-style-preview]');
  if (!preview) return;
  preview.innerHTML = stylePreviewHtml(row.dataset.geometryKind || 'polygon', readStyleFromRow(row));
}

function updateRuleValueList(ruleRow, fieldMeta) {
  const valueInput = ruleRow.querySelector('[data-rule-value]');
  if (!valueInput) return;
  const datalistId = `ruleValues_${Math.random().toString(36).slice(2, 9)}`;
  let datalist = ruleRow.querySelector('datalist[data-rule-values]');
  if (!datalist) {
    datalist = document.createElement('datalist');
    datalist.dataset.ruleValues = '1';
    ruleRow.appendChild(datalist);
  }
  datalist.id = datalistId;
  valueInput.setAttribute('list', datalistId);
  datalist.innerHTML = (fieldMeta?.values || []).slice(0, 80).map((value) => `<option value="${escapeHtml(value)}"></option>`).join('');
}

function populateRuleChoices(row, attributes) {
  const fields = attributes?.fields || [];
  row.querySelectorAll('[data-style-rule]').forEach((ruleRow) => {
    const fieldSelect = ruleRow.querySelector('[data-rule-field]');
    const current = fieldSelect?.value || fieldSelect?.dataset.currentValue || '';
    if (!fieldSelect) return;
    fieldSelect.innerHTML = `<option value="">Any field</option>${fields.map((field) => `<option value="${escapeHtml(field.name)}" ${field.name === current ? 'selected' : ''}>${escapeHtml(field.name)}${field.type ? ` (${escapeHtml(field.type)})` : ''}</option>`).join('')}`;
    if (current && !fields.some((field) => field.name === current)) fieldSelect.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}</option>`);
    const selectedField = fields.find((field) => field.name === fieldSelect.value);
    updateRuleValueList(ruleRow, selectedField);
  });
}

async function loadAttributesForRow(row) {
  const projectId = rowProjectId(row);
  const layerName = rowLayerName(row);
  if (!projectId || !layerName) return null;
  const button = row.querySelector('[data-load-layer-attributes]');
  const original = button?.textContent || 'Load fields';
  if (button) {
    button.disabled = true;
    button.textContent = 'Loading...';
  }
  try {
    const attributes = await getLayerAttributes(projectId, layerName);
    populateRuleChoices(row, attributes);
    if (button) button.textContent = `${attributes.fields?.length || 0} fields`;
    return attributes;
  } catch (err) {
    alert(`Could not load layer fields: ${err.message}`);
    if (button) button.textContent = original;
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

function applyStyleToRow(row, style = {}) {
  const setValue = (selector, value) => {
    const input = row.querySelector(selector);
    if (input && value !== undefined && value !== null) input.value = value;
  };
  setValue('[data-layer-color]', style.color || '#2f80ed');
  setValue('[data-layer-stroke-color]', style.strokeColor || '#ffffff');
  setValue('[data-layer-fill-opacity]', style.fillOpacity ?? 0.55);
  setValue('[data-layer-stroke-opacity]', style.strokeOpacity ?? 1);
  setValue('[data-layer-stroke-width]', style.strokeWidth ?? 2);
  setValue('[data-layer-extrusion-height]', style.extrusionHeight ?? '');
  setValue('[data-layer-height-offset]', style.heightOffset ?? 0);
  setValue('[data-layer-min-zoom]', style.minZoom ?? '');
  setValue('[data-layer-max-zoom]', style.maxZoom ?? '');
  setValue('[data-layer-point-size]', style.pointSize ?? 18);
  setValue('[data-layer-symbol-type]', style.symbolType || 'point');
  setValue('[data-layer-icon-url]', style.iconUrl || '');
  setValue('[data-layer-icon-scale]', style.iconScale ?? 1);
  setValue('[data-layer-model-asset]', style.modelAssetId || '');
  setValue('[data-layer-model-scale]', style.modelScale ?? 1);
  const list = row.querySelector('[data-style-rule-list]');
  if (list) {
    list.innerHTML = (style.styleRules || []).map((rule) => styleRuleHtml(rule, row.dataset.geometryKind || 'polygon')).join('');
    list.querySelectorAll('[data-style-rule]').forEach((ruleRow) => bindStyleRuleRow(row, ruleRow));
  }
  updateSymbolEditors(row);
  updateGltfMini(row);
  updateLayerStylePreview(row);
  const key = `${rowProjectId(row)}:${rowLayerName(row)}`;
  if (state.layerAttributes[key]) populateRuleChoices(row, state.layerAttributes[key]);
}

async function saveStylePresetFromRow(row) {
  const defaultName = `${rowLayerName(row) || row.dataset.geometryKind || 'Layer'} style`;
  const name = prompt('Style name', defaultName);
  if (!name) return;
  const payload = {
    id: sanitizeToken(name),
    name,
    geometryKind: row.dataset.geometryKind || 'polygon',
    style: layerStylePayload(row)
  };
  await api(`${API_BASE}/api/style-presets`, { method: 'POST', body: payload });
  await loadStylePresets();
  refreshStylePresetControls();
}

function refreshStylePresetControls() {
  document.querySelectorAll('[data-style-preset-select]').forEach((select) => {
    const selected = select.value;
    select.innerHTML = stylePresetOptions(selected);
  });
}

function updateSymbolEditors(row) {
  const symbolType = row.querySelector('[data-layer-symbol-type]')?.value || 'point';
  row.querySelectorAll('[data-symbol-scope]').forEach((item) => {
    item.hidden = item.dataset.symbolScope !== symbolType;
  });
}

function updateGltfMini(row) {
  const input = row.querySelector('[data-layer-model-asset]');
  const wrap = row.querySelector('[data-gltf-mini]');
  if (!input || !wrap) return;
  const next = document.createElement('div');
  next.innerHTML = gltfMiniViewHtml(input.value || '').trim();
  wrap.replaceWith(next.firstElementChild);
  row.querySelector('[data-pick-gltf]')?.addEventListener('click', () => openGltfPicker(row.querySelector('[data-layer-model-asset]')));
}

function refreshGltfControls() {
  document.querySelectorAll('.layer-config-row').forEach((row) => {
    const input = row.querySelector('[data-layer-model-asset]');
    if (input && input.type === 'hidden' && input.value && !modelAssetById(input.value)) input.value = '';
    updateGltfMini(row);
    row.querySelectorAll('[data-rule-model-asset]').forEach((select) => {
      const selected = select.value;
      select.innerHTML = modelAssetOptions(selected);
      if (selected && !modelAssetById(selected)) select.value = '';
    });
    updateLayerStylePreview(row);
  });
}

function bindStyleRuleRow(row, ruleRow) {
  ruleRow.querySelectorAll('input, select').forEach((input) => input.addEventListener('input', () => updateLayerStylePreview(row)));
  ruleRow.querySelector('[data-rule-field]')?.addEventListener('change', () => {
    const key = `${rowProjectId(row)}:${rowLayerName(row)}`;
    const fields = state.layerAttributes[key]?.fields || [];
    updateRuleValueList(ruleRow, fields.find((field) => field.name === ruleRow.querySelector('[data-rule-field]')?.value));
  });
  ruleRow.querySelector('[data-pick-rule-gltf]')?.addEventListener('click', () => openGltfPicker(ruleRow.querySelector('[data-rule-model-asset]')));
  ruleRow.querySelector('[data-remove-rule]')?.addEventListener('click', () => ruleRow.remove());
}

function bindLayerStyleEditors(container) {
  container.querySelectorAll('[data-layer-service]').forEach((select) => {
    select.addEventListener('change', () => {
      const details = select.closest('.layer-config-row')?.querySelector('.layer-style-editor');
      if (details) details.hidden = select.value !== 'wfs';
    });
  });
  container.querySelectorAll('.layer-config-row').forEach((row) => {
    row.querySelectorAll('.layer-style-editor input, .layer-style-editor select').forEach((input) => input.addEventListener('input', () => updateLayerStylePreview(row)));
    row.querySelector('[data-layer-symbol-type]')?.addEventListener('change', () => {
      updateSymbolEditors(row);
      updateLayerStylePreview(row);
    });
    row.querySelector('[data-pick-svg]')?.addEventListener('click', () => openSvgPicker(row.querySelector('[data-layer-icon-url]')));
    row.querySelector('[data-pick-gltf]')?.addEventListener('click', () => openGltfPicker(row.querySelector('[data-layer-model-asset]')));
    row.querySelector('[data-add-style-rule]')?.addEventListener('click', () => {
      const list = row.querySelector('[data-style-rule-list]');
      list.insertAdjacentHTML('beforeend', styleRuleHtml({}, row.dataset.geometryKind || 'polygon'));
      bindStyleRuleRow(row, list.lastElementChild);
      const key = `${rowProjectId(row)}:${rowLayerName(row)}`;
      if (state.layerAttributes[key]) populateRuleChoices(row, state.layerAttributes[key]);
    });
    row.querySelector('[data-load-layer-attributes]')?.addEventListener('click', () => loadAttributesForRow(row));
    row.querySelector('[data-save-style-preset]')?.addEventListener('click', () => saveStylePresetFromRow(row));
    row.querySelector('[data-apply-style-preset]')?.addEventListener('click', () => {
      const presetId = row.querySelector('[data-style-preset-select]')?.value || '';
      const preset = state.stylePresets.find((item) => item.id === presetId);
      if (preset?.style) applyStyleToRow(row, preset.style);
    });
    row.querySelectorAll('[data-style-rule]').forEach((ruleRow) => bindStyleRuleRow(row, ruleRow));
    updateSymbolEditors(row);
    updateLayerStylePreview(row);
  });
}

async function renderMainLayers(projectId, selected = []) {
  const container = $('#mainLayersList');
  container.innerHTML = '<div class="empty-state">Loading layers...</div>';
  renderMainProjectOverview(projectId);
  const info = await getProjectLayers(projectId);
  renderMainProjectOverview(projectId, info);
  const selectedByName = layerConfigByName(selected);
  const qgis3dLayers = info.qgis3d?.layers || info.view3d?.layers || [];
  $('#projectView3dWrap').hidden = !qgis3dLayers.length;
  $('#includeProjectView3d').checked = state.editing?.includeProjectView3d === true;
  const summary = $('#projectView3dSummary');
  if (summary) {
    summary.hidden = !qgis3dLayers.length;
    summary.innerHTML = qgis3dLayers.length ? `
      <div class="qgis3d-build-list">
        ${qgis3dLayers.map((layer) => {
          const asset = qgis3dTilesAsset(projectId, layer.name);
          const meta = asset?.metadata || {};
          return `
            <article class="qgis3d-build-card">
              <div>
                <strong>${escapeHtml(layer.title || layer.name)}</strong>
                <small>${escapeHtml(layer.extrusionHeight || '')} m${asset ? ` · 3D Tiles ready${meta.generatedAt ? ` · ${escapeHtml(new Date(meta.generatedAt).toLocaleString())}` : ''}` : ' · uses WFS until tiles are generated'}</small>
              </div>
              <button class="button ${asset ? 'ghost' : 'primary'}" type="button" data-build-qgis3d="${escapeHtml(layer.name)}" data-qgis3d-height="${escapeHtml(layer.extrusionHeight || 10)}" data-qgis3d-color="${escapeHtml(layer.color || '#bf5108')}">${asset ? 'Regenerate 3D Tiles' : 'Generate 3D Tiles'}</button>
            </article>
          `;
        }).join('')}
      </div>
    ` : '';
    summary.querySelectorAll('[data-build-qgis3d]').forEach((button) => button.addEventListener('click', () => buildQgis3dTiles(projectId, button.dataset.buildQgis3d, button)));
  }
  container.innerHTML = (info.layers || []).map((layer) => {
    const previous = selectedByName.get(layer.name) || {};
    const included = previous.included !== false && (selected.length ? selectedByName.has(layer.name) : true);
    const service = previous.service || (layer.hasWfs ? 'wfs' : 'wms');
    const style = defaultLayerStyle(layer, previous);
    const kind = geometryKind(layer);
    const isPoint = kind === 'point';
    const isLine = kind === 'line';
    const isPolygon = kind === 'polygon';
    const serviceText = layer.hasWfs ? 'WMS or WFS' : 'WMS only';
    return `
      <article class="layer-config-row layer-config-row--operational" data-layer-project="${escapeHtml(projectId)}" data-layer-name="${escapeHtml(layer.name)}" data-geometry-kind="${escapeHtml(kind)}">
        <div class="layer-row-main">
          <label class="layer-title"><input type="checkbox" data-layer-include ${included ? 'checked' : ''}> <span>${escapeHtml(layer.title || layer.name)}</span></label>
          <div class="layer-row-meta">
            <span class="layer-chip layer-chip--${escapeHtml(kind)}">${escapeHtml(kind)}</span>
            <span>${escapeHtml(serviceText)}</span>
            ${layer.crs ? `<span>${escapeHtml(layer.crs)}</span>` : ''}
          </div>
        </div>
        <div class="layer-controls">
          <label class="compact-field"><span>Service</span><select data-layer-service ${layer.hasWfs ? '' : 'disabled'}>
            <option value="wms" ${service === 'wms' ? 'selected' : ''}>WMS</option>
            <option value="wfs" ${service === 'wfs' ? 'selected' : ''}>WFS editable</option>
          </select></label>
          <label class="compact-check"><input type="checkbox" data-layer-visible ${previous.visible === false ? '' : 'checked'}> <span>Visible</span></label>
          <label class="compact-field layer-legend-field"><span>Legend</span><input data-layer-legend list="svgIconOptions" type="text" value="${escapeHtml(previous.legendIcon || layer.legendUrl || '')}" placeholder="SVG/PNG URL"></label>
        </div>
        ${styleEditorHtml(kind, style).replace('class="layer-style-editor"', `class="layer-style-editor" ${service === 'wfs' ? '' : 'hidden'}`)}
      </article>
    `;
  }).join('') || '<div class="empty-state">No cached layers. Regenerate or sync the project.</div>';
  bindLayerStyleEditors(container);
  container.querySelectorAll('[data-layer-include], [data-layer-visible], [data-layer-service]').forEach((input) => input.addEventListener('change', updateMainLayerStats));
  applyMainLayerFilter();
  updateMainLayerStats();
}

async function renderExternalLayers(selected = []) {
  const container = $('#externalLayersList');
  const projectIds = selectedCheckboxValues($('#externalProjectsList'));
  if (!projectIds.length) {
    container.innerHTML = '<div class="empty-state">Select one or more projects to add external WMS/WFS layers.</div>';
    return;
  }
  container.innerHTML = '<div class="empty-state">Loading external layers...</div>';
  const selectedByKey = new Map(selected.map((item) => [`${item.projectId || item.sourceProjectId}:${item.name}`, item]));
  const parts = [];
  for (const projectId of projectIds) {
    const info = await getProjectLayers(projectId);
    parts.push(`<h4>${escapeHtml(projectLabel(projectId))}</h4>`);
    parts.push((info.layers || []).map((layer) => {
      const previous = selectedByKey.get(`${projectId}:${layer.name}`) || {};
      const included = previous.included === true;
      const service = previous.service || (layer.hasWfs ? 'wfs' : 'wms');
      const style = defaultLayerStyle(layer, previous);
      const kind = geometryKind(layer);
      return `
        <article class="layer-config-row layer-config-row--operational" data-layer-project="${escapeHtml(projectId)}" data-external-project="${escapeHtml(projectId)}" data-external-layer="${escapeHtml(layer.name)}" data-layer-name="${escapeHtml(layer.name)}" data-geometry-kind="${escapeHtml(kind)}">
          <div class="layer-row-main">
            <label class="layer-title"><input type="checkbox" data-external-include ${included ? 'checked' : ''}> <span>${escapeHtml(layer.title || layer.name)}</span></label>
            <div class="layer-row-meta"><span class="layer-chip layer-chip--${escapeHtml(kind)}">${escapeHtml(kind)}</span><span>${layer.hasWfs ? 'WMS or WFS' : 'WMS only'}</span>${layer.crs ? `<span>${escapeHtml(layer.crs)}</span>` : ''}</div>
          </div>
          <div class="layer-controls">
            <label class="compact-field"><span>Service</span><select data-layer-service ${layer.hasWfs ? '' : 'disabled'}>
              <option value="wms" ${service === 'wms' ? 'selected' : ''}>WMS</option>
              <option value="wfs" ${service === 'wfs' ? 'selected' : ''}>WFS editable</option>
            </select></label>
            <label class="compact-check"><input type="checkbox" data-layer-visible ${previous.visible === false ? '' : 'checked'}> <span>Visible</span></label>
            <label class="compact-field layer-legend-field"><span>Legend</span><input data-layer-legend list="svgIconOptions" type="text" value="${escapeHtml(previous.legendIcon || layer.legendUrl || '')}" placeholder="SVG/PNG URL"></label>
          </div>
          ${styleEditorHtml(kind, style).replace('class="layer-style-editor"', `class="layer-style-editor" ${service === 'wfs' ? '' : 'hidden'}`)}
        </article>
      `;
    }).join('') || '<div class="empty-state">No cached layers.</div>');
  }
  container.innerHTML = parts.join('');
  bindLayerStyleEditors(container);
}

function renderSvgPicker(filter = '') {
  const grid = $('#svgPickerGrid');
  if (!grid) return;
  const needle = filter.trim().toLowerCase();
  const icons = state.svgIcons.filter((icon) => !needle || `${icon.name || ''} ${icon.source || ''} ${icon.url || ''}`.toLowerCase().includes(needle)).slice(0, 240);
  grid.innerHTML = icons.map((icon) => `
    <button type="button" class="svg-choice" data-svg-url="${escapeHtml(icon.url)}" title="${escapeHtml(icon.name || icon.url)}">
      <img src="${escapeHtml(icon.url)}" alt="">
      <span>${escapeHtml(icon.name || icon.url.split('/').pop())}</span>
    </button>
  `).join('') || '<div class="empty-state">No SVGs match that filter.</div>';
  grid.querySelectorAll('[data-svg-url]').forEach((button) => {
    button.addEventListener('click', () => {
      if (state.svgPickerTarget) {
        state.svgPickerTarget.value = button.dataset.svgUrl;
        updateLayerStylePreview(state.svgPickerTarget.closest('.layer-config-row'));
      }
      closeSvgPicker();
    });
  });
}

function openSvgPicker(targetInput) {
  state.svgPickerTarget = targetInput;
  $('#svgPickerModal').hidden = false;
  $('#svgPickerSearch').value = '';
  renderSvgPicker();
}

function closeSvgPicker() {
  $('#svgPickerModal').hidden = true;
  state.svgPickerTarget = null;
}

function renderGltfPicker(filter = '') {
  const grid = $('#gltfPickerGrid');
  if (!grid) return;
  const needle = filter.trim().toLowerCase();
  const models = state.assets.filter((asset) => asset.type === 'model' && (!needle || `${asset.name || ''} ${asset.url || ''} ${asset.originalName || ''}`.toLowerCase().includes(needle)));
  grid.innerHTML = models.map((asset) => `
    <article class="gltf-card" data-gltf-card="${escapeHtml(asset.id)}">
      <button type="button" class="gltf-card-main" data-select-gltf="${escapeHtml(asset.id)}">
        <span class="gltf-cube">GLTF</span>
        <strong>${escapeHtml(asset.name || asset.id)}</strong>
        <small>${escapeHtml(asset.url || asset.originalName || asset.id)}</small>
      </button>
      <div class="mini-actions">
        <button class="button primary" type="button" data-select-gltf="${escapeHtml(asset.id)}"><span class="gltf-button-icon">GLTF</span> Choose</button>
        ${asset.openUrl || asset.previewUrl ? `<a class="button ghost" href="${escapeHtml(asset.openUrl || asset.previewUrl)}" target="_blank" rel="noopener">Open</a>` : ''}
        ${asset.sourceUrl && asset.sourceUrl !== asset.url ? `<a class="button ghost" href="${escapeHtml(asset.sourceUrl)}" target="_blank" rel="noopener">Source</a>` : ''}
        <button class="button danger" type="button" data-delete-gltf="${escapeHtml(asset.id)}">Delete</button>
      </div>
    </article>
  `).join('') || '<div class="empty-state">No GLTF/GLB models. Upload one or add a link.</div>';
  grid.querySelectorAll('[data-select-gltf]').forEach((button) => button.addEventListener('click', () => selectGltfAsset(button.dataset.selectGltf)));
  grid.querySelectorAll('[data-delete-gltf]').forEach((button) => button.addEventListener('click', async () => {
    await deleteAsset(button.dataset.deleteGltf, { silent: true });
    renderGltfPicker($('#gltfPickerSearch')?.value || '');
  }));
}

function openGltfPicker(targetInput) {
  state.gltfPickerTarget = targetInput;
  $('#gltfPickerModal').hidden = false;
  $('#gltfPickerSearch').value = '';
  renderGltfPicker();
}

function closeGltfPicker() {
  $('#gltfPickerModal').hidden = true;
  state.gltfPickerTarget = null;
}

function selectGltfAsset(assetId) {
  if (state.gltfPickerTarget) {
    state.gltfPickerTarget.value = assetId;
    const row = state.gltfPickerTarget.closest('.layer-config-row');
    if (state.gltfPickerTarget.matches('[data-layer-model-asset]')) {
      const symbolType = row?.querySelector('[data-layer-symbol-type]');
      if (symbolType) symbolType.value = 'gltf';
      updateSymbolEditors(row);
      updateGltfMini(row);
    }
    if (state.gltfPickerTarget.matches('[data-rule-model-asset]')) {
      const ruleRow = state.gltfPickerTarget.closest('[data-style-rule]');
      const symbolType = ruleRow?.querySelector('[data-rule-symbol-type]');
      if (symbolType) symbolType.value = 'gltf';
    }
    updateLayerStylePreview(row);
  }
  closeGltfPicker();
}

async function uploadGltfFromPicker(event) {
  event.preventDefault();
  const files = Array.from($('#gltfPickerFiles').files || []);
  const status = $('#gltfPickerStatus');
  if (!files.length) {
    status.textContent = 'Select a GLTF or GLB file.';
    return;
  }
  const form = new FormData();
  form.append('assetType', 'model');
  files.forEach((file) => form.append('files', file));
  status.textContent = 'Uploading model...';
  try {
    const result = await api(`${API_BASE}/api/assets/upload`, { method: 'POST', body: form });
    $('#gltfPickerFiles').value = '';
    state.assets = result.assets || [];
    renderAssets();
    renderAssetChecks(selectedCheckboxValues($('#sceneAssetsList')));
    refreshGltfControls();
    renderGltfPicker($('#gltfPickerSearch')?.value || '');
    status.textContent = `Uploaded: ${result.uploaded?.length || 0}.`;
    if (result.uploaded?.[0]) selectGltfAsset(result.uploaded[0].id);
  } catch (err) {
    status.textContent = err.message;
  }
}

async function addGltfLink(event) {
  event.preventDefault();
  const status = $('#gltfPickerStatus');
  const name = $('#gltfLinkName').value.trim();
  const url = $('#gltfLinkUrl').value.trim();
  if (!url) {
    status.textContent = 'Escribe un link GLTF/GLB.';
    return;
  }
  status.textContent = 'Registrando link...';
  try {
    const result = await api(`${API_BASE}/api/assets/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url })
    });
    state.assets = result.assets || [];
    $('#gltfLinkName').value = '';
    $('#gltfLinkUrl').value = '';
    renderAssets();
    renderAssetChecks(selectedCheckboxValues($('#sceneAssetsList')));
    refreshGltfControls();
    renderGltfPicker($('#gltfPickerSearch')?.value || '');
    status.textContent = 'Link añadido.';
    if (result.asset) selectGltfAsset(result.asset.id);
  } catch (err) {
    status.textContent = err.message;
  }
}

async function renderBackgroundLayers(selectedLayers = [], defaultKey = '') {
  const container = $('#backgroundLayersList');
  const projectIds = selectedCheckboxValues($('#backgroundProjectsList'));
  if (!projectIds.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = '<div class="empty-state">Loading background layers...</div>';
  const selectedByKey = new Map(selectedLayers.map((item) => [`${item.projectId || item.sourceProjectId}:${item.name}`, item]));
  const parts = [];
  for (const projectId of projectIds) {
    const info = await getProjectLayers(projectId);
    parts.push(`<h4>${escapeHtml(projectLabel(projectId))}</h4>`);
    parts.push((info.layers || []).map((layer, index) => {
      const previous = selectedByKey.get(`${projectId}:${layer.name}`) || {};
      const key = `background:${projectId}:${layer.name}`;
      const included = previous.included !== false && (selectedLayers.length ? selectedByKey.has(`${projectId}:${layer.name}`) : index === 0);
      const isDefault = defaultKey ? defaultKey === key : (previous.isDefault === true || (index === 0 && !parts.some((html) => html.includes('data-bg-default') && html.includes('checked'))));
      return `
        <article class="layer-config-row" data-bg-project="${escapeHtml(projectId)}" data-bg-layer="${escapeHtml(layer.name)}">
          <label class="layer-title"><input type="checkbox" data-bg-include ${included ? 'checked' : ''}> <span>${escapeHtml(layer.title || layer.name)}</span></label>
          <label><input type="radio" name="defaultBackground" data-bg-default value="${escapeHtml(key)}" ${isDefault ? 'checked' : ''}> default</label>
          <label><input type="checkbox" data-bg-visible ${previous.visible === false ? '' : 'checked'}> visible</label>
          <input data-bg-legend list="svgIconOptions" type="text" value="${escapeHtml(previous.legendIcon || layer.legendUrl || '')}" placeholder="SVG/PNG leyenda">
          <small>${escapeHtml(layer.crs || '')}${layer.hasWmts ? ' · WMTS metadata' : ''}</small>
        </article>
      `;
    }).join('') || '<div class="empty-state">No cached layers.</div>');
  }
  container.innerHTML = parts.join('');
}

function readMainLayers() {
  return Array.from(document.querySelectorAll('#mainLayersList [data-layer-name]')).map((row) => ({
    name: row.dataset.layerName,
    title: row.querySelector('.layer-title span')?.textContent || row.dataset.layerName,
    included: row.querySelector('[data-layer-include]')?.checked === true,
    service: row.querySelector('[data-layer-service]')?.value || 'wms',
    visible: row.querySelector('[data-layer-visible]')?.checked !== false,
    legendIcon: row.querySelector('[data-layer-legend]')?.value.trim() || null,
    ...layerStylePayload(row)
  })).filter((item) => item.name);
}

function readExternalLayers() {
  return Array.from(document.querySelectorAll('#externalLayersList [data-external-layer]')).map((row) => ({
    projectId: row.dataset.externalProject,
    name: row.dataset.externalLayer,
    title: row.querySelector('.layer-title span')?.textContent || row.dataset.externalLayer,
    included: row.querySelector('[data-external-include]')?.checked === true,
    service: row.querySelector('[data-layer-service]')?.value || 'wms',
    visible: row.querySelector('[data-layer-visible]')?.checked !== false,
    legendIcon: row.querySelector('[data-layer-legend]')?.value.trim() || null,
    ...layerStylePayload(row)
  })).filter((item) => item.projectId && item.name);
}

function readBackgroundLayers() {
  return Array.from(document.querySelectorAll('#backgroundLayersList [data-bg-layer]')).map((row) => ({
    projectId: row.dataset.bgProject,
    name: row.dataset.bgLayer,
    title: row.querySelector('.layer-title span')?.textContent || row.dataset.bgLayer,
    included: row.querySelector('[data-bg-include]')?.checked === true,
    visible: row.querySelector('[data-bg-visible]')?.checked !== false,
    isDefault: row.querySelector('[data-bg-default]')?.checked === true,
    legendIcon: row.querySelector('[data-bg-legend]')?.value.trim() || null
  })).filter((item) => item.projectId && item.name);
}

function renderModules(modulesState = state.moduleDefaults) {
  $('#modulesList').innerHTML = state.modules.map((mod) => {
    const checked = modulesState[mod.key] !== false ? 'checked' : '';
    return `
      <label class="module-card">
        <input type="checkbox" data-module="${escapeHtml(mod.key)}" ${checked}>
        <span>${escapeHtml(mod.label)}</span>
      </label>
    `;
  }).join('') || '<div class="empty-state">No se recibieron módulos del servidor.</div>';
}

function assetLabel(asset) {
  return `${asset.name || asset.id} (${asset.type})`;
}

function renderAssetChecks(selected = []) {
  const selectedSet = new Set(selected);
  $('#sceneAssetsList').innerHTML = state.assets.map((asset) => {
    const checked = selectedSet.has(asset.id) ? 'checked' : '';
    return `
      <label class="check-card">
        <input type="checkbox" value="${escapeHtml(asset.id)}" ${checked}>
        <span>${escapeHtml(assetLabel(asset))}</span>
      </label>
    `;
  }).join('') || '<div class="empty-state">No uploaded assets yet.</div>';
}

function renderAssets() {
  const list = $('#assetList');
  if (!state.assets.length) {
    list.innerHTML = '<div class="empty-state">No uploaded 3D objects.</div>';
    return;
  }
  list.innerHTML = state.assets.map((asset) => `
    <article class="asset-card">
      <div>
        <strong>${escapeHtml(asset.name)}</strong>
        <span>${escapeHtml(asset.type)}</span>
      </div>
      <div class="mini-actions">
        ${asset.openUrl || asset.previewUrl ? `<a class="button ghost" href="${escapeHtml(asset.openUrl || asset.previewUrl)}" target="_blank" rel="noopener">Open</a>` : ''}
        ${asset.downloadUrl ? `<a class="button ghost" href="${escapeHtml(asset.downloadUrl)}">Descargar</a>` : ''}
        <button class="button danger" type="button" data-delete-asset="${escapeHtml(asset.id)}">Delete</button>
      </div>
    </article>
  `).join('');
  list.querySelectorAll('[data-delete-asset]').forEach((button) => button.addEventListener('click', () => deleteAsset(button.dataset.deleteAsset)));
}

function renderTerrainLibrary() {
  const container = $('#terrainLibrary');
  if (!container) return;
  container.innerHTML = state.reusableTerrains.length ? `
    <h3>Available terrain</h3>
    <div class="asset-list">
      ${state.reusableTerrains.map((terrain) => `
        <article class="asset-card">
          <div><strong>${escapeHtml(terrain.name || terrain.project || terrain.projectId)}</strong><span>${escapeHtml(`${terrain.source || 'terrain'} · ${terrain.type || ''}`)}</span></div>
          <div class="mini-actions">
            ${terrain.previewUrl ? `<a class="button ghost" target="_blank" href="${escapeHtml(terrain.previewUrl)}">Preview</a>` : ''}
            ${terrain.downloadUrl ? `<a class="button ghost" href="${escapeHtml(terrain.downloadUrl)}">ZIP</a>` : ''}
            ${terrain.deleteUrl ? `<button class="button danger" type="button" data-delete-terrain="${escapeHtml(terrain.deleteUrl)}">Delete</button>` : ''}
          </div>
        </article>
      `).join('')}
    </div>
  ` : '<div class="empty-state">No generated or uploaded terrain yet.</div>';
  container.querySelectorAll('[data-delete-terrain]').forEach((button) => button.addEventListener('click', () => deleteTerrain(button.dataset.deleteTerrain)));
}

function readModules() {
  const result = {};
  document.querySelectorAll('[data-module]').forEach((input) => {
    result[input.dataset.module] = input.checked;
  });
  return result;
}

function renderScenes() {
  const list = $('#sceneList');
  if (!state.scenes.length) {
    list.innerHTML = '<div class="empty-state">No published maps yet.</div>';
    renderMapGallery();
    return;
  }

  list.innerHTML = state.scenes.map((scene) => {
    const enabledModules = Object.values(scene.modules || {}).filter(Boolean).length;
    return `
      <article class="scene-card">
        <div>
          <h3>${escapeHtml(scene.title)}</h3>
          <p>${escapeHtml(scene.description || 'No description')}</p>
          <div class="meta">
            <span>Proyecto: ${escapeHtml(projectLabel(scene.mainProjectId))}</span>
            <span>Backgrounds: ${(scene.backgroundProjects || []).length}</span>
            <span>Terrain: ${(scene.terrainProjects || []).length}</span>
            <span>Módulos: ${enabledModules}</span>
          </div>
        </div>
        <div class="scene-actions">
          <a class="button ghost" target="_blank" href="${API_BASE}/view/?scene=${encodeURIComponent(scene.id)}">Ver</a>
          <button class="button" type="button" data-edit="${escapeHtml(scene.id)}">Editar</button>
          <button class="button ghost" type="button" data-precache-backgrounds="${escapeHtml(scene.id)}">Precache backgrounds</button>
          <button class="button danger" type="button" data-delete="${escapeHtml(scene.id)}">Delete</button>
        </div>
      </article>
    `;
  }).join('');

  list.querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => openModal(button.dataset.edit)));
  list.querySelectorAll('[data-precache-backgrounds]').forEach((button) => button.addEventListener('click', () => precacheBackgrounds(button.dataset.precacheBackgrounds, button)));
  list.querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', () => deleteScene(button.dataset.delete)));
  renderMapGallery();
}

function thumbnailUrlForScene(scene) {
  const background = (scene.backgroundLayers || []).find((layer) => layer.isDefault && layer.included !== false) || (scene.backgroundLayers || []).find((layer) => layer.included !== false);
  if (background?.projectId && background?.name) {
    return `/plugins/Qtiler2origo/api/thumbnail/${encodeURIComponent(background.projectId)}?LAYERS=${encodeURIComponent(background.name)}`;
  }
  const layer = (scene.mainLayers || []).find((item) => item.included !== false && item.service !== 'wfs') || (scene.mainLayers || []).find((item) => item.included !== false);
  if (scene.mainProjectId && layer?.name) {
    return `/plugins/Qtiler2origo/api/thumbnail/${encodeURIComponent(scene.mainProjectId)}?LAYERS=${encodeURIComponent(layer.name)}`;
  }
  return '';
}

function renderMapGallery() {
  const gallery = $('#mapGallery');
  if (!gallery) return;
  gallery.innerHTML = state.scenes.map((scene) => {
    const background = (scene.backgroundLayers || []).find((layer) => layer.isDefault) || (scene.backgroundLayers || [])[0] || null;
    const terrain = (scene.terrainProjects || [])[0] || 'No terrain';
    const thumbUrl = thumbnailUrlForScene(scene);
    return `
      <article class="gallery-card">
        <div class="gallery-preview">
          ${thumbUrl ? `<img src="${escapeHtml(thumbUrl)}" alt="" loading="lazy">` : ''}
          <span>${escapeHtml(scene.title || scene.id)}</span>
        </div>
        <div class="gallery-body">
          <strong>${escapeHtml(scene.title || scene.id)}</strong>
          <small>${escapeHtml(projectLabel(scene.mainProjectId))} · ${escapeHtml(background?.title || background?.name || 'No background')} · ${escapeHtml(terrain)}</small>
          <div class="mini-actions">
            <a class="button ghost" target="_blank" href="${API_BASE}/view/?scene=${encodeURIComponent(scene.id)}">Open</a>
            <button class="button" type="button" data-edit-gallery="${escapeHtml(scene.id)}">Editar</button>
          </div>
        </div>
      </article>
    `;
  }).join('') || '<div class="empty-state">Cuando publiques escenas aparecerán aquí como galería de mapas 3D.</div>';
  gallery.querySelectorAll('[data-edit-gallery]').forEach((button) => button.addEventListener('click', () => openModal(button.dataset.editGallery)));
}

async function renderQgis3dTilesPanel() {
  const panel = $('#qgis3dTilesPanel');
  if (!panel) return;
  const scenes = state.scenes.filter((scene) => scene.includeProjectView3d && scene.mainProjectId);
  if (!scenes.length) {
    panel.innerHTML = '<div class="empty-state">Enable "Include detected 3D layers" in a map to generate 3D Tiles.</div>';
    return;
  }
  panel.innerHTML = '<div class="empty-state">Loading QGIS 3D layers...</div>';
  const rows = [];
  for (const scene of scenes) {
    try {
      const info = await getProjectLayers(scene.mainProjectId);
      const layers = info.qgis3d?.layers || [];
      for (const layer of layers) {
        const asset = qgis3dTilesAsset(scene.mainProjectId, layer.name);
        const meta = asset?.metadata || {};
        rows.push(`
          <article class="qgis3d-build-card">
            <div>
              <strong>${escapeHtml(scene.title || scene.id)} · ${escapeHtml(layer.title || layer.name)}</strong>
              <small>${escapeHtml(projectLabel(scene.mainProjectId))} · ${escapeHtml(layer.extrusionHeight || '')} m${asset ? ` · ready${meta.features ? ` · ${escapeHtml(meta.features)} features` : ''}${meta.tiles ? ` · ${escapeHtml(meta.tiles)} tiles` : ''}` : ' · no tiles, will use WFS'}</small>
            </div>
            <div class="mini-actions">
              ${asset?.openUrl ? `<a class="button ghost" target="_blank" href="${escapeHtml(asset.openUrl)}">Preview</a>` : ''}
              <button class="button ${asset ? 'ghost' : 'primary'}" type="button" data-build-qgis3d="${escapeHtml(layer.name)}" data-qgis3d-project="${escapeHtml(scene.mainProjectId)}" data-qgis3d-scene="${escapeHtml(scene.id)}" data-qgis3d-height="${escapeHtml(layer.extrusionHeight || 10)}" data-qgis3d-color="${escapeHtml(layer.color || '#bf5108')}">${asset ? 'Regenerate 3D Tiles' : 'Generate 3D Tiles'}</button>
            </div>
          </article>
        `);
      }
    } catch (err) {
      rows.push(`<div class="empty-state">${escapeHtml(scene.title || scene.id)}: ${escapeHtml(err.message)}</div>`);
    }
  }
  panel.innerHTML = rows.join('') || '<div class="empty-state">No se detectaron capas QGIS 3D en las escenas.</div>';
  panel.querySelectorAll('[data-build-qgis3d]').forEach((button) => button.addEventListener('click', () => buildQgis3dTiles(button.dataset.qgis3dProject, button.dataset.buildQgis3d, button, button.dataset.qgis3dScene)));
}

function openModal(sceneId = null) {
  if (!sceneId && !hasInstalledCesiumRuntime()) {
    showCesiumRequiredMessage();
    activateAdminTab('cesium');
    return;
  }
  const scene = sceneId ? state.scenes.find((item) => item.id === sceneId) : null;
  state.editing = scene || null;
  $('#sceneModalTitle').textContent = scene ? 'Edit 3D map' : 'New 3D map';
  $('#sceneId').value = scene?.id || '';
  $('#sceneTitle').value = scene?.title || '';
  $('#sceneDescription').value = scene?.description || '';
  $('#ionToken').value = scene?.ionToken || localStorage.getItem('qtiler3d_ion_token') || '';

  fillProjectSelect($('#mainProjectSelect'));
  if (scene?.mainProjectId) $('#mainProjectSelect').value = scene.mainProjectId;

  renderProjectChecks($('#backgroundProjectsList'), scene?.backgroundProjects || []);
  $('#backgroundProjectsList').querySelectorAll('input[type="checkbox"]').forEach((input) => input.addEventListener('change', () => renderBackgroundLayers(readBackgroundLayers(), document.querySelector('[data-bg-default]:checked')?.value || scene?.defaultBackgroundKey || '')));
  renderTerrainChecks(scene?.terrainProjects || (scene?.mainProjectId ? [scene.mainProjectId] : []), scene?.assetIds || []);
  renderModules(scene?.modules || state.moduleDefaults);
  renderAssetChecks(scene?.assetIds || []);
  renderMainLayers($('#mainProjectSelect').value, scene?.mainLayers || []);
  renderExternalProjectChecks(Array.from(new Set((scene?.externalLayers || []).map((layer) => layer.projectId || layer.sourceProjectId).filter(Boolean))));
  $('#externalProjectsList').querySelectorAll('input[type="checkbox"]').forEach((input) => input.addEventListener('change', () => renderExternalLayers(readExternalLayers())));
  renderExternalLayers(scene?.externalLayers || []);
  renderBackgroundLayers(scene?.backgroundLayers || [], scene?.defaultBackgroundKey || '');
  activateModalTab('map');
  $('#toggleSceneFullscreen').textContent = 'Full screen';
  $('#sceneModal')?.classList.remove('is-fullscreen');
  $('#sceneModal').hidden = false;
}

function closeModal() {
  $('#sceneModal')?.classList.remove('is-fullscreen');
  if ($('#toggleSceneFullscreen')) $('#toggleSceneFullscreen').textContent = 'Full screen';
  $('#sceneModal').hidden = true;
}

async function saveScene(event) {
  event.preventDefault();
  if (!hasInstalledCesiumRuntime()) {
    showCesiumRequiredMessage();
    activateAdminTab('cesium');
    return;
  }
  const mainProjectId = $('#mainProjectSelect').value;
  const title = $('#sceneTitle').value.trim();
  if (!title) {
    alert('Escribe un nombre para la escena.');
    $('#sceneTitle').focus();
    return;
  }
  if (!mainProjectId) {
    alert('Select a main project.');
    $('#mainProjectSelect').focus();
    return;
  }
  const ionToken = $('#ionToken').value.trim();
  const terrainSelection = readTerrainSelection();
  const terrainProjects = terrainSelection.terrainProjects;
  const assetIds = Array.from(new Set([...selectedCheckboxValues($('#sceneAssetsList')), ...terrainSelection.terrainAssetIds]));
  const selectedTerrainAssets = state.assets.filter((asset) => assetIds.includes(asset.id) && asset.type === 'terrain');
  if (!terrainProjects.length && !selectedTerrainAssets.length) {
    const ok = confirm('This map has no terrain. The globe will be flat and models may appear suspended. Save anyway?');
    if (!ok) return;
  }
  if (ionToken) localStorage.setItem('qtiler3d_ion_token', ionToken);

  const payload = {
    id: $('#sceneId').value || `${mainProjectId}_3d`,
    title,
    description: $('#sceneDescription').value.trim(),
    mainProjectId,
    backgroundProjects: selectedCheckboxValues($('#backgroundProjectsList')).filter((id) => id !== mainProjectId),
    mainLayers: readMainLayers(),
    externalLayers: readExternalLayers(),
    backgroundLayers: readBackgroundLayers(),
    defaultBackgroundKey: document.querySelector('[data-bg-default]:checked')?.value || '',
    terrainProjects,
    assetIds,
    includeProjectView3d: $('#includeProjectView3d').checked === true,
    modules: readModules(),
    ionToken,
    createdAt: state.editing?.createdAt
  };

  await api(`${API_BASE}/api/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  closeModal();
  await loadScenes();
}

async function precacheBackgrounds(sceneId, button) {
  const original = button?.textContent || 'Precache backgrounds';
  if (button) {
    button.disabled = true;
    button.textContent = 'Cacheando...';
  }
  try {
    const result = await api(`${API_BASE}/api/publish/${encodeURIComponent(sceneId)}/precache-backgrounds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minZoom: 0, maxZoom: 8, maxTiles: 600 })
    });
    alert(`Precache ready: ${result.ok}/${result.requested} tiles. Layers: ${result.layers}. Zoom ${result.minZoom}-${result.maxZoom}.`);
  } catch (err) {
    alert(`No se pudo precachear: ${err.message}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

async function uploadAssets(event) {
  event.preventDefault();
  const files = Array.from($('#assetFilesInput').files || []);
  const status = $('#assetUploadStatus');
  if (!files.length) {
    status.textContent = 'Select at least one file.';
    return;
  }
  const form = new FormData();
  form.append('assetType', $('#assetTypeSelect').value);
  files.forEach((file) => form.append('files', file));
  status.textContent = 'Uploading assets...';
  try {
    const result = await api(`${API_BASE}/api/assets/upload`, { method: 'POST', body: form });
    status.textContent = `Uploaded: ${result.uploaded?.length || 0}. Rejected: ${result.rejected?.length || 0}.`;
    $('#assetFilesInput').value = '';
    await loadAssets();
  } catch (err) {
    status.textContent = err.message;
  }
}

async function deleteAsset(assetId, options = {}) {
  if (!options.silent && !confirm('Delete this 3D asset?')) return;
  if (options.silent && !confirm('Delete this GLTF model from the global library?')) return;
  await api(`${API_BASE}/api/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' });
  await loadAssets();
}

async function deleteScene(sceneId) {
  if (!confirm('Delete this 3D map?')) return;
  await api(`${API_BASE}/api/publish/${encodeURIComponent(sceneId)}`, { method: 'DELETE' });
  await loadScenes();
}

async function refreshDemList(projectId) {
  const demSelect = $('#demSelect');
  demSelect.innerHTML = '<option value="">Loading...</option>';
  if (!projectId) {
    demSelect.innerHTML = '<option value="">Select a project</option>';
    return;
  }
  try {
    const info = await api(`${API_BASE}/api/project-info?project=${encodeURIComponent(projectId)}`);
    const rasters = info.rasterLayers || [];
    demSelect.innerHTML = rasters.length
      ? rasters.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item.split(/[\\/]/).pop())}</option>`).join('')
      : '<option value="">No TIF/DTM layers detected</option>';
  } catch (err) {
    demSelect.innerHTML = `<option value="">${escapeHtml(err.message)}</option>`;
  }
}

async function buildQgis3dTiles(projectId, layerName, button, sceneIdOverride = '') {
  const original = button?.textContent || 'Generate 3D Tiles';
  if (button) {
    button.disabled = true;
    button.textContent = 'Generating...';
  }
  try {
    const styleRow = Array.from(document.querySelectorAll('.layer-config-row')).find((row) => rowProjectId(row) === projectId && rowLayerName(row) === layerName);
    const style = styleRow ? layerStylePayload(styleRow) : null;
    const result = await api(`${API_BASE}/api/qgis3d-tiles/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        layerName,
        sceneId: sceneIdOverride || $('#sceneId')?.value || '',
        ...(style ? { style, extrusionHeight: Number(style.extrusionHeight || button?.dataset.qgis3dHeight || 10), color: style.color || button?.dataset.qgis3dColor || '#bf5108' } : { extrusionHeight: Number(button?.dataset.qgis3dHeight || 10), color: button?.dataset.qgis3dColor || '#bf5108' })
      })
    });
    const timer = setInterval(async () => {
      try {
        const job = await api(`${API_BASE}/api/qgis3d-tiles/job/${encodeURIComponent(result.jobId)}`);
        if (button) button.textContent = `Generating ${job.progress || 0}%`;
        if (job.status === 'completed') {
          clearInterval(timer);
          await loadAssets();
          await renderQgis3dTilesPanel();
          await renderMainLayers($('#mainProjectSelect').value, readMainLayers());
          if (button) {
            button.disabled = false;
            button.textContent = 'Regenerate 3D Tiles';
          }
          alert(`3D Tiles ready for ${layerName}. Features: ${job.result?.features || '?'}, tiles: ${job.result?.tiles || '?'}.`);
        } else if (job.status === 'error') {
          clearInterval(timer);
          if (button) {
            button.disabled = false;
            button.textContent = original;
          }
          alert(`Could not generate 3D Tiles: ${job.error || 'error'}`);
        }
      } catch (err) {
        clearInterval(timer);
        if (button) {
          button.disabled = false;
          button.textContent = original;
        }
        alert(`Could not check the job: ${err.message}`);
      }
    }, 1800);
  } catch (err) {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
    alert(`Could not start 3D Tiles: ${err.message}`);
  }
}

async function buildTerrain() {
  const projectId = $('#terrainProjectSelect').value;
  const terrainName = $('#terrainName').value.trim() || `${projectLabel(projectId)} terrain`;
  const demPath = $('#demSelect').value;
  const status = $('#terrainStatus');
  if (!projectId || !demPath) {
    status.textContent = 'Select a project and DEM.';
    return;
  }

  $('#buildTerrainBtn').disabled = true;
  status.textContent = 'Queueing job...';
  try {
    const result = await api(`${API_BASE}/api/build-terrain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        terrainName,
        demPath,
        waterThreshold: Number($('#waterThreshold').value || 0.5),
        maxSearchDist: Number($('#maxSearchDist').value || 100)
      })
    });

    const timer = setInterval(async () => {
      try {
        const job = await api(`${API_BASE}/api/terrain-job/${encodeURIComponent(result.jobId)}`);
        if (job.status === 'completed') {
          clearInterval(timer);
          $('#buildTerrainBtn').disabled = false;
          status.textContent = `Terrain "${terrainName}" generated successfully.`;
          await loadAssets();
        } else if (job.status === 'error') {
          clearInterval(timer);
          $('#buildTerrainBtn').disabled = false;
          status.textContent = `Error: ${job.error}`;
        } else {
          status.textContent = `Processing... ${job.progress || 0}%`;
        }
      } catch (err) {
        clearInterval(timer);
        $('#buildTerrainBtn').disabled = false;
        status.textContent = err.message;
      }
    }, 2000);
  } catch (err) {
    $('#buildTerrainBtn').disabled = false;
    status.textContent = err.message;
  }
}

async function deleteTerrain(deleteUrl) {
  if (!confirm('Delete this terrain from the library?')) return;
  await api(deleteUrl, { method: 'DELETE' });
  await loadAssets();
}

async function loadProjects() {
  const data = await api('/projects');
  state.projects = Array.isArray(data) ? data : (data.projects || []);
  fillProjectSelect($('#terrainProjectSelect'));
  if (!$('#terrainName').value && $('#terrainProjectSelect').value) $('#terrainName').value = `${projectLabel($('#terrainProjectSelect').value)} terrain`;
  if ($('#terrainProjectSelect').value) await refreshDemList($('#terrainProjectSelect').value);
}

async function loadModules() {
  const payload = await api(`${API_BASE}/api/modules`);
  state.modules = payload.modules || [];
  state.moduleDefaults = payload.defaults || {};
}

async function loadScenes() {
  const payload = await api(`${API_BASE}/api/publish/list`);
  state.scenes = payload.scenes || [];
  renderScenes();
  await renderQgis3dTilesPanel();
}

async function loadAssets() {
  const payload = await api(`${API_BASE}/api/assets`);
  state.assets = payload.assets || [];
  state.reusableTerrains = payload.terrains || [];
  renderAssets();
  renderTerrainLibrary();
  refreshGltfControls();
  if (state.scenes.length) await renderQgis3dTilesPanel();
}

async function loadStylePresets() {
  const payload = await api(`${API_BASE}/api/style-presets`);
  state.stylePresets = payload.presets || [];
}

async function loadSvgIconOptions() {
  const datalist = $('#svgIconOptions');
  if (!datalist) return;
  try {
    const payload = await api('/Qtiler2Origo/qgis-svg-list');
    const icons = [];
    (payload.categories || []).forEach((category) => (category.icons || []).forEach((icon) => icons.push(icon)));
    state.svgIcons = icons;
    datalist.innerHTML = icons.slice(0, 600).map((icon) => `<option value="${escapeHtml(icon.url)}">${escapeHtml(icon.source ? `${icon.source}: ${icon.name}` : icon.name)}</option>`).join('');
  } catch {
    state.svgIcons = [];
    datalist.innerHTML = '';
  }
}

async function refreshAll() {
  await loadStatus();
  await loadModules();
  await loadProjects();
  await loadStylePresets();
  await loadAssets();
  await loadSvgIconOptions();
  await loadScenes();
  renderStatus();
}

document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupModalTabs();
  document.querySelectorAll('[data-close-modal]').forEach((item) => item.addEventListener('click', closeModal));
  $('#toggleSceneFullscreen')?.addEventListener('click', toggleSceneFullscreen);
  $('#openMainLayersTab')?.addEventListener('click', () => activateModalTab('layers'));
  $('#mainLayerFilter')?.addEventListener('input', () => {
    applyMainLayerFilter();
    updateMainLayerStats();
  });
  $('#selectAllMainLayers')?.addEventListener('click', () => setMainLayerSelection(true));
  $('#clearMainLayers')?.addEventListener('click', () => setMainLayerSelection(false));
  $('#sceneForm').addEventListener('submit', saveScene);
  $('#newSceneBtn').addEventListener('click', () => openModal());
  $('#refreshBtn').addEventListener('click', refreshAll);
  $('#terrainProjectSelect').addEventListener('change', () => {
    if (!$('#terrainName').value.trim()) $('#terrainName').value = `${projectLabel($('#terrainProjectSelect').value)} terrain`;
    refreshDemList($('#terrainProjectSelect').value);
  });
  $('#mainProjectSelect').addEventListener('change', async () => {
    await renderMainLayers($('#mainProjectSelect').value, []);
    renderExternalProjectChecks([]);
    $('#externalProjectsList').querySelectorAll('input[type="checkbox"]').forEach((input) => input.addEventListener('change', () => renderExternalLayers(readExternalLayers())));
    renderExternalLayers([]);
    renderTerrainChecks([$('#mainProjectSelect').value].filter(Boolean), []);
  });
  $('#buildTerrainBtn').addEventListener('click', buildTerrain);
  $('#assetUploadForm').addEventListener('submit', uploadAssets);
  document.querySelectorAll('[data-close-svg-picker]').forEach((item) => item.addEventListener('click', closeSvgPicker));
  $('#svgPickerSearch')?.addEventListener('input', (event) => renderSvgPicker(event.target.value));
  document.querySelectorAll('[data-close-gltf-picker]').forEach((item) => item.addEventListener('click', closeGltfPicker));
  $('#gltfPickerSearch')?.addEventListener('input', (event) => renderGltfPicker(event.target.value));
  $('#gltfPickerUploadForm')?.addEventListener('submit', uploadGltfFromPicker);
  $('#gltfLinkForm')?.addEventListener('submit', addGltfLink);
  $('#refreshCesiumReleasesBtn')?.addEventListener('click', loadCesiumReleases);
  $('#includeCesiumPrerelease')?.addEventListener('change', loadCesiumReleases);
  $('#installCesiumBtn')?.addEventListener('click', installCesium);
  $('#uninstallCesiumBtn')?.addEventListener('click', uninstallCesium);
  $('#settingsForm')?.addEventListener('submit', saveSettings);
  await refreshAll();
  await loadCesiumReleases();
});
