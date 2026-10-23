/*
 * QtilerAuth Commercial License
 * See LICENSE_QtilerAuth.txt for terms and restrictions.
 */

const state = {
  users: [],
  projects: [],
  permissions: {},
  pluginMapsLoaded: false,
  pluginAccessNeedsRender: true,
  pluginAccessDrafts: new Map(),
  pluginPermissionDrafts: new Map(),
  layerCatalogLoaded: false,
  layerCatalogPromise: null,
  searchableByProject: {},
  layerPermissionsByProject: {},
  pluginMaps: [],
  layersByProject: {},
  layerAttributesByProject: {},
  layerAttributePromises: new Map(),
  databases: [],
  // userId -> plaintext API key revealed only once (regenerate/create response)
  recentlyIssuedKeys: new Map()
};

const formatRelativeTime = (iso) => {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '—';
  const diff = Math.max(0, Date.now() - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return new Date(ts).toLocaleString();
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const messagesEl = document.getElementById('messages');
const usersTableBody = document.querySelector('#users-table tbody');
const dbTableBody = document.querySelector('#databases-table tbody');
const dbForm = document.getElementById('db-connection-form');

const userForm = document.getElementById('user-form');
const userFormTitle = document.getElementById('user-form-title');
const userIdInput = document.getElementById('user-id');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const passwordToggleBtn = document.getElementById('password-toggle');
const passwordGenerateBtn = document.getElementById('password-generate');
const roleInput = document.getElementById('role');
const statusInput = document.getElementById('status');
const portalEditPermissionInput = document.getElementById('portal-edit-permission');
const projectsInput = document.getElementById('projects');
const userFormSubmit = document.getElementById('user-form-submit');
const userFormReset = document.getElementById('user-form-reset');

const goDashboardButton = document.getElementById('go-dashboard');

const PORTAL_PERMISSIONS = [
  { id: 'Qtiler2qwc', label: 'QWC admin', permission: 'portal:edit:Qtiler2qwc' },
  { id: 'Qtiler2Origo', label: 'Origo admin', permission: 'portal:edit:Qtiler2Origo' },
  { id: 'Qtiler2Hajk', label: 'Hajk admin', permission: 'portal:edit:Qtiler2Hajk' },
  { id: 'Qtiler-3D-eye', label: '3D Eye editor', permission: 'portal:edit:Qtiler-3D-eye' },
  { id: 'databaseGateway', label: 'Database gateway', permission: 'database:read' }
];

const getManagedPermissions = () => [
  ...PORTAL_PERMISSIONS,
  ...state.databases.map((connection) => ({
    id: `database:${connection.id}`,
    label: `Database: ${connection.name}`,
    permission: `database:read:${connection.id}`
  }))
];

const isAdminUser = (user) => user?.role === 'admin';
const ADMIN_ALL_PROJECTS_LABEL = 'All projects (view + edit)';
const PLUGIN_MAP_PERMISSION_PREFIX = 'plugin-map:';

const initTabs = () => {
  const buttons = Array.from(document.querySelectorAll('.tab-button[data-tab]'));
  const panels = Array.from(document.querySelectorAll('.tab-panel[data-tab-panel]'));
  let navigationRequest = 0;
  buttons.forEach((button) => {
    button.addEventListener('click', async () => {
      const target = button.dataset.tab;
      const requestId = ++navigationRequest;
      if (target === 'layers' && !state.layerCatalogLoaded) {
        button.disabled = true;
        try {
          await ensureLayerCatalogLoaded();
        } catch (err) {
          showMessage('error', parseError(err, 'Failed to load layer permissions.'));
          return;
        } finally {
          button.disabled = false;
        }
        if (requestId !== navigationRequest) return;
        renderLayerPermissions();
      }
      buttons.forEach((btn) => btn.classList.toggle('active', btn === button));
      panels.forEach((panel) => panel.classList.toggle('active', panel.dataset.tabPanel === target));
      if (target === 'plugins' && state.pluginAccessNeedsRender) {
        renderPluginAccess();
        state.pluginAccessNeedsRender = false;
      }
    });
  });
};

/* ── Collapsible sections ── */
const initCollapsible = () => {
  document.querySelectorAll('[data-collapse]').forEach((header) => {
    const targetId = header.getAttribute('data-collapse');
    const target = document.getElementById(targetId);
    if (!target) return;
    const toggleBtn = header.querySelector('.collapse-toggle');

    const toggle = () => {
      const isCollapsed = target.classList.toggle('collapsed');
      if (toggleBtn) toggleBtn.classList.toggle('collapsed', isCollapsed);
    };

    header.addEventListener('click', (e) => {
      if (e.target.closest('button:not(.collapse-toggle)') || e.target.closest('a')) return;
      toggle();
    });
  });
};

const expandFormPanel = () => {
  const inner = document.getElementById('user-form-inner');
  const header = document.querySelector('.form-panel-header[data-collapse="user-form-inner"]');
  if (inner && inner.classList.contains('collapsed')) {
    inner.classList.remove('collapsed');
    if (header) {
      const btn = header.querySelector('.collapse-toggle');
      if (btn) btn.classList.remove('collapsed');
    }
  }
  const usersBody = document.getElementById('users-body');
  const usersHeader = document.querySelector('[data-collapse="users-body"]');
  if (usersBody && usersBody.classList.contains('collapsed')) {
    usersBody.classList.remove('collapsed');
    if (usersHeader) {
      const btn = usersHeader.querySelector('.collapse-toggle');
      if (btn) btn.classList.remove('collapsed');
    }
  }
};

initCollapsible();
initTabs();

const DEFAULT_ADMIN_PASSWORD_PLACEHOLDER = 'MundoGIS-2026';
const urlParams = new URLSearchParams(window.location.search);
const justInstalledFlag = urlParams.has('justInstalled');
if (justInstalledFlag && typeof window !== 'undefined' && window.history?.replaceState) {
  window.history.replaceState({}, document.title, window.location.pathname);
}

let defaultPasswordLabel = DEFAULT_ADMIN_PASSWORD_PLACEHOLDER;
let defaultPasswordActive = false;

const sessionPasswords = new Map();

const setSessionPassword = (user, password) => {
  if (!password) return;
  if (user?.id) sessionPasswords.set(user.id, password);
  if (user?.username) sessionPasswords.set(`username:${user.username}`, password);
};

const getSessionPassword = (user) => {
  if (!user) return null;
  return sessionPasswords.get(user.id) || sessionPasswords.get(`username:${user.username}`) || null;
};

const clearSessionPassword = (user) => {
  if (!user) return;
  if (user.id) sessionPasswords.delete(user.id);
  if (user.username) sessionPasswords.delete(`username:${user.username}`);
};

const safeXmlName = (value) => {
  let s = String(value || '').trim();
  if (!s) return '_';
  s = s.replace(/[^A-Za-z0-9_.-]+/g, '_');
  if (!/^[A-Za-z_]/.test(s)) s = `_${s}`;
  if (/^xml/i.test(s)) s = `_${s}`;
  return s;
};

const looksLikeGeometryName = (value) => {
  const n = String(value || '').trim().toLowerCase();
  if (!n) return false;
  return /^(geom|the_geom|geometry|wkb_geometry)$/.test(n) || /(geom|geometry|wkb|wkt)/.test(n);
};

const pickPreferredAttribute = (candidates, fallbackList, hardFallback = '') => {
  const list = Array.isArray(fallbackList) ? fallbackList : [];
  for (const candidate of candidates || []) {
    if (candidate && list.includes(candidate)) return candidate;
  }
  return list[0] || hardFallback;
};

const extractAttributeMetadata = (attributes) => {
  const rows = Array.isArray(attributes) ? attributes : [];
  const normalized = rows
    .map((attr) => {
      if (typeof attr === 'string') return { name: attr, type: '' };
      if (attr && typeof attr === 'object') {
        return {
          name: String(attr.name || attr.field || attr.attribute || '').trim(),
          type: String(attr.type || attr.dataType || '').trim()
        };
      }
      return { name: '', type: '' };
    })
    .filter((attr) => attr.name);

  const nonGeometry = normalized.filter((attr) => {
    const n = attr.name.toLowerCase();
    const t = attr.type.toLowerCase();
    return !(/^(geom|the_geom|geometry|wkb_geometry)$/.test(n) || /(geometry|point|linestring|multilinestring|polygon|multipolygon|wkb|wkt)/.test(t));
  });

  const geometry = normalized.filter((attr) => {
    const n = attr.name.toLowerCase();
    const t = attr.type.toLowerCase();
    return (/^(geom|the_geom|geometry|wkb_geometry)$/.test(n) || /(geometry|point|linestring|multilinestring|polygon|multipolygon|wkb|wkt)/.test(t));
  });

  const unique = (arr) => Array.from(new Set(arr.filter(Boolean)));

  return {
    all: unique(normalized.map((attr) => attr.name)),
    nonGeometry: unique((nonGeometry.length ? nonGeometry : normalized).map((attr) => attr.name)),
    geometry: unique(geometry.map((attr) => attr.name))
  };
};

const detectGeometryAttribute = (layer, layerMeta, configuredGeometry = '') => {
  const all = Array.isArray(layerMeta?.all) ? layerMeta.all : [];
  const explicitGeometryCols = Array.isArray(layerMeta?.geometry) ? layerMeta.geometry : [];
  const namedGeometryCols = all.filter((name) => looksLikeGeometryName(name));
  const geometryCols = explicitGeometryCols.length ? explicitGeometryCols : (namedGeometryCols.length ? namedGeometryCols : []);
  const safeConfigured = looksLikeGeometryName(configuredGeometry) ? configuredGeometry : '';
  return pickPreferredAttribute(
    [
      safeConfigured,
      layer?.geometryAttribute,
      layer?.geometry_attribute,
      layer?.geometryName,
      layer?.geometry_name,
      'GEOM',
      'geom',
      'the_geom',
      'geometry',
      'wkb_geometry'
    ],
    geometryCols,
    namedGeometryCols[0] || ''
  );
};

async function fetchLayerAttributes(projectId, layerName) {
  const candidates = Array.from(new Set([String(layerName || '').trim(), safeXmlName(layerName)])).filter(Boolean);
  let lastError = null;
  let emptyMetadata = null;
  for (const candidate of candidates) {
    try {
      const payload = await api(`/origo/wfs-attributes?project=${encodeURIComponent(projectId)}&layer=${encodeURIComponent(candidate)}`);
      if (payload?.ok === false) {
        lastError = new Error(payload.warning || 'Layer attributes are unavailable.');
        continue;
      }
      const metadata = extractAttributeMetadata(payload?.attributes);
      if (metadata.all.length) return metadata;
      emptyMetadata = metadata;
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  return emptyMetadata || { all: [], nonGeometry: [], geometry: [] };
}

function setSelectOptions(select, columns, selectedValue, fallbackLabel = 'No attributes detected') {
  if (!select) return;
  const safeColumns = Array.from(new Set((Array.isArray(columns) ? columns : []).map((col) => String(col || '').trim()).filter(Boolean)));
  if (!safeColumns.length) {
    select.innerHTML = `<option value="">${escapeHtml(fallbackLabel)}</option>`;
    select.value = '';
    return;
  }
  const selected = String(selectedValue || '').trim();
  select.innerHTML = safeColumns.map((col) => {
    const escaped = escapeHtml(col);
    const sel = selected === col ? ' selected' : '';
    return `<option value="${escaped}"${sel}>${escaped}</option>`;
  }).join('');
  if (selected && safeColumns.includes(selected)) select.value = selected;
}

function getSelectedSearchFields(config, columns) {
  const configured = Array.isArray(config?.fields) ? config.fields : [];
  const legacy = [config?.searchAttribute, config?.titleField].filter(Boolean);
  const available = new Set(Array.isArray(columns) ? columns : []);
  const selected = Array.from(new Set([...configured, ...legacy].map((value) => String(value || '').trim()).filter(Boolean)));
  const matching = selected.filter((field) => available.has(field));
  return matching.length ? matching : (available.size ? [available.values().next().value] : []);
}

function setSearchColumnOptions(container, columns, selectedValues) {
  if (!container) return;
  const safeColumns = Array.from(new Set((Array.isArray(columns) ? columns : []).map((col) => String(col || '').trim()).filter(Boolean)));
  const rawSelections = Array.isArray(selectedValues) ? selectedValues : [];
  const selected = Array.from(new Set(rawSelections
    .map((value) => String(value || '').trim())
    .filter((value) => value && safeColumns.includes(value))));
  const values = selected.length ? selected : (safeColumns.length ? [safeColumns[0]] : ['']);
  if (rawSelections.some((value) => !String(value || '').trim()) && selected.length < safeColumns.length) {
    values.push('');
  }
  const options = (selectedValue) => [
    `<option value="">${safeColumns.length ? 'Select an attribute' : 'No attributes detected'}</option>`,
    ...safeColumns.map((column) => {
      const escaped = escapeHtml(column);
      const chosen = selectedValue === column ? ' selected' : '';
      return `<option value="${escaped}"${chosen}>${escaped}</option>`;
    })
  ].join('');
  container.innerHTML = values.map((value, index) => {
    const removeButton = index > 0
      ? '<button type="button" class="search-column-remove" aria-label="Remove search attribute">Remove</button>'
      : '';
    return `<div class="search-column-row"><select class="search-column-select" aria-label="Search attribute ${index + 1}">${options(value)}</select>${removeButton}</div>`;
  }).join('') + '<button type="button" class="search-column-add" aria-label="Add search attribute">+</button>';
  syncSearchColumnOptions(container);
}

function syncSearchColumnOptions(container) {
  const selects = Array.from(container?.querySelectorAll('.search-column-select') || []);
  const selectedValues = selects.map((select) => String(select.value || '').trim()).filter(Boolean);
  selects.forEach((select) => {
    Array.from(select.options || []).forEach((option) => {
      option.disabled = !!option.value && selectedValues.includes(option.value) && select.value !== option.value;
    });
  });
  const addButton = container?.querySelector('.search-column-add');
  if (addButton) addButton.disabled = selectedValues.length >= (selects[0]?.options?.length || 1) - 1;
}

function getSelectedSearchColumnValues(container) {
  return Array.from(new Set(Array.from(container?.querySelectorAll('.search-column-select') || [])
    .map((select) => String(select.value || '').trim())
    .filter(Boolean)));
}

function getAvailableLayerColumns(projectId, layerName, fallbackColumns) {
  const metadata = state.layerAttributesByProject?.[projectId]?.[layerName];
  const columns = Array.isArray(metadata?.nonGeometry) && metadata.nonGeometry.length
    ? metadata.nonGeometry
    : (Array.isArray(metadata?.all) ? metadata.all : []);
  return columns.length ? columns : fallbackColumns;
}

function applyLayerAttributeMetadata(projectId, layerName, row, metadata) {
  if (!row) return;
  const projectKey = String(projectId || '').trim();
  const layerKey = String(layerName || '').trim();
  if (!state.layerAttributesByProject[projectKey]) state.layerAttributesByProject[projectKey] = {};
  state.layerAttributesByProject[projectKey][layerKey] = metadata;
  if (typeof row.isConnected === 'boolean' && !row.isConnected) return;

  const permission = state.layerPermissionsByProject?.[projectKey]?.get(layerKey) || {};
  const config = permission.search || {};
  const searchColumns = row.querySelector('.search-columns');
  const availableColumns = Array.isArray(metadata?.nonGeometry) && metadata.nonGeometry.length
    ? metadata.nonGeometry
    : (Array.isArray(metadata?.all) ? metadata.all : []);
  const layer = state.layersByProject?.[projectKey]?.find((entry) => String(entry?.name || '') === layerKey) || {};
  const selectedGeom = detectGeometryAttribute(layer, metadata, config.geometryAttribute);
  row.dataset.geometryAttribute = selectedGeom;
  const updateControls = () => {
    const currentSelection = getSelectedSearchColumnValues(searchColumns);
    const selectedSearch = currentSelection.length
      ? currentSelection
      : getSelectedSearchFields(config, availableColumns);
    const selectedId = pickPreferredAttribute(
      [config.idAttribute, 'GID', 'gid', 'id', 'ID', 'fid', 'FID'],
      availableColumns
    );
    setSearchColumnOptions(searchColumns, availableColumns, selectedSearch);
    setSelectOptions(row.querySelector('.id-select'), availableColumns, selectedId);
  };
  updateControls();
}

async function ensureLayerAttributes(projectId, layerName, row) {
  const projectKey = String(projectId || '').trim();
  const layerKey = String(layerName || '').trim();
  if (!projectKey || !layerKey || !row) return;
  const existing = state.layerAttributesByProject?.[projectKey]?.[layerKey];
  if (existing && Array.isArray(existing.all) && existing.all.length) return;
  const requestKey = `${projectKey}\u0000${layerKey}`;
  let pending = state.layerAttributePromises.get(requestKey);
  if (!pending) {
    pending = fetchLayerAttributes(projectKey, layerKey);
    state.layerAttributePromises.set(requestKey, pending);
  }
  const controls = Array.from(row.querySelectorAll('.search-column-select, .search-column-add, .id-select'));
  controls.forEach((control) => { control.disabled = true; });
  row.classList.add('is-loading-attributes');
  try {
    const metadata = await pending;
    applyLayerAttributeMetadata(projectKey, layerKey, row, metadata);
  } finally {
    if (state.layerAttributePromises.get(requestKey) === pending) {
      state.layerAttributePromises.delete(requestKey);
    }
    row.classList.remove('is-loading-attributes');
    controls.forEach((control) => { control.disabled = false; });
  }
}

async function loadSearchableCatalog() {
  const cachedAttributes = state.layerAttributesByProject || {};
  const projects = Array.isArray(state.projects) ? state.projects : [];
  const results = await Promise.all(projects.map(async (project) => {
    const projectId = String(project?.id || '').trim();
    if (!projectId) return null;
    try {
      const [layersResponse, searchableResponse, projectConfig] = await Promise.all([
        api(`/projects/${encodeURIComponent(projectId)}/layers`),
        api(`/auth-admin/projects/${encodeURIComponent(projectId)}/layers`),
        api(`/projects/${encodeURIComponent(projectId)}/config`)
      ]);
      const allLayers = Array.isArray(layersResponse?.layers) ? layersResponse.layers : [];
      const projectLayers = allLayers.filter((l) => l && l.name);
      const layerPermissions = Array.isArray(searchableResponse?.layers) ? searchableResponse.layers : [];
      const permissionByName = new Map(layerPermissions.map((entry) => [String(entry?.name || ''), entry]));
      return {
        projectId,
        services: projectConfig?.services || {},
        originalCrs: layersResponse?.project?.crs || layersResponse?.crs || layersResponse?.project_crs || projectConfig?.extent?.crs || '',
        layers: projectLayers,
        searchable: layerPermissions.map((entry) => entry?.search).filter(Boolean),
        layerPermissions,
        permissionByName,
        attributes: {}
      };
    } catch (_err) {
      return {
        projectId,
        layers: [],
        searchable: [],
        layerPermissions: [],
        permissionByName: new Map(),
        attributes: {}
      };
    }
  }));

  const searchableByProject = {};
  const layerPermissionsByProject = {};
  const layersByProject = {};
  const layerAttributesByProject = {};
  const projectServicesByProject = {};
  const projectCrsByProject = {};
  results.filter(Boolean).forEach((entry) => {
    searchableByProject[entry.projectId] = entry.searchable;
    layerPermissionsByProject[entry.projectId] = entry.permissionByName || new Map();
    layersByProject[entry.projectId] = entry.layers.map((layer) => ({
      ...layer,
      ...(entry.permissionByName?.get(String(layer.name || '')) || {})
    }));
    layerAttributesByProject[entry.projectId] = {
      ...(cachedAttributes[entry.projectId] || {}),
      ...entry.attributes
    };
    projectServicesByProject[entry.projectId] = entry.services || {};
    projectCrsByProject[entry.projectId] = entry.originalCrs || '';
  });
  state.searchableByProject = searchableByProject;
  state.layerPermissionsByProject = layerPermissionsByProject;
  state.layersByProject = layersByProject;
  state.layerAttributesByProject = layerAttributesByProject;
  state.projectServicesByProject = projectServicesByProject;
  state.projectCrsByProject = projectCrsByProject;
  state.layerCatalogLoaded = true;
}

async function ensureLayerCatalogLoaded() {
  if (state.layerCatalogLoaded) return;
  if (!state.layerCatalogPromise) {
    state.layerCatalogPromise = loadSearchableCatalog().finally(() => {
      state.layerCatalogPromise = null;
    });
  }
  return state.layerCatalogPromise;
}

const getRandomInt = (max) => {
  if (max <= 0) return 0;
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0] % max;
  }
  return Math.floor(Math.random() * max);
};

const generateStrongPassword = (length = 16) => {
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!@#$%^&*()-_=+[]{}';
  const all = lower + upper + digits + symbols;
  const result = [
    lower[getRandomInt(lower.length)],
    upper[getRandomInt(upper.length)],
    digits[getRandomInt(digits.length)],
    symbols[getRandomInt(symbols.length)]
  ];
  while (result.length < length) {
    result.push(all[getRandomInt(all.length)]);
  }
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = getRandomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.join('');
};

const setPasswordVisibility = (visible) => {
  if (!passwordInput) return;
  passwordInput.type = visible ? 'text' : 'password';
  if (passwordToggleBtn) {
    passwordToggleBtn.textContent = visible ? 'Hide' : 'Show';
    passwordToggleBtn.setAttribute('aria-pressed', String(visible));
  }
};

const suggestPassword = () => {
  if (!passwordInput) return '';
  const next = generateStrongPassword();
  passwordInput.value = next;
  setPasswordVisibility(true);
  return next;
};

if (goDashboardButton) {
  goDashboardButton.addEventListener('click', () => {
    window.location.href = '/index.html';
  });
}

if (passwordToggleBtn) {
  passwordToggleBtn.addEventListener('click', () => {
    const visible = passwordInput.type === 'password';
    setPasswordVisibility(visible);
  });
}

if (passwordGenerateBtn) {
  passwordGenerateBtn.addEventListener('click', () => {
    suggestPassword();
  });
}

function showMessage(type, text, options = {}) {
  const { sticky = false, ttlMs = 6000 } = options;
  messagesEl.innerHTML = '';
  if (!text) return;
  const box = document.createElement('div');
  box.className = `message ${type}`;
  box.textContent = text;
  messagesEl.appendChild(box);
  if (!sticky) {
    setTimeout(() => {
      if (messagesEl.contains(box)) {
        messagesEl.removeChild(box);
      }
    }, ttlMs);
  }
}

function showDefaultPasswordWarning({ justInstalled = false } = {}) {
  const prefix = justInstalled ? 'QtilerAuth was just installed. ' : '';
  const message = `${prefix}The administrator account is still using the initial password "${defaultPasswordLabel}". Open the Users section, edit “admin”, and set a secure password before returning to the dashboard.`;
  showMessage('warning', message, { ttlMs: 15000 });
}

async function checkDefaultPassword({ displaySuccess = false, justInstalled = false } = {}) {
  try {
    const status = await api('/auth-admin/status');
    defaultPasswordLabel = status?.defaultPasswordLabel || DEFAULT_ADMIN_PASSWORD_PLACEHOLDER;
    defaultPasswordActive = !!status?.defaultPasswordActive;
    if (defaultPasswordActive) {
      if (goDashboardButton) goDashboardButton.hidden = true;
      showDefaultPasswordWarning({ justInstalled });
    } else {
      if (goDashboardButton) goDashboardButton.hidden = false;
      if (displaySuccess) {
        showMessage('success', 'Administrator password updated. You can return to the dashboard when finished.');
      } else if (justInstalled) {
        showMessage('info', 'QtilerAuth is active. Review users and permissions before returning to the dashboard.');
      }
    }
  } catch (err) {
    showMessage('error', parseError(err, 'Unable to fetch authentication status.'));
  }
}

function parseError(err, fallback = 'Request could not be completed') {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  return fallback;
}

async function api(url, options = {}) {
  const opts = { credentials: 'include', headers: {}, ...options };
  const isFormData = opts.body instanceof FormData;
  if (opts.body && !isFormData && typeof opts.body === 'object') {
    opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  if (Object.keys(opts.headers).length === 0) {
    delete opts.headers;
  }
  let response = await fetch(url, opts);
  let contentType = response.headers.get('content-type') || '';
  let isJson = contentType.includes('application/json');
  let payload = isJson ? await response.json().catch(() => null) : null;

  const method = String(opts.method || 'GET').toUpperCase();
  if (method === 'PATCH' && [403, 404, 405, 501].includes(response.status)) {
    response = await fetch(url, { ...opts, method: 'POST' });
    contentType = response.headers.get('content-type') || '';
    isJson = contentType.includes('application/json');
    payload = isJson ? await response.json().catch(() => null) : null;
  }

  if (response.status === 401) {
    showMessage('error', 'Session expired. Redirecting to sign-in.');
    setTimeout(() => { window.location.href = '/login'; }, 1200);
    throw new Error('auth_required');
  }
  if (response.status === 403) {
    showMessage('error', 'You do not have permission to access this section.');
    throw new Error('forbidden');
  }
  if (!response.ok) {
    const detail = payload?.error || payload?.message || response.statusText || 'Unknown error';
    throw new Error(detail);
  }
  return payload;
}

function resetUserForm() {
  userForm.reset();
  userIdInput.value = '';
  usernameInput.disabled = false;
  userFormTitle.textContent = 'Create user';
  userFormSubmit.textContent = 'Save';
  passwordInput.placeholder = 'Leave blank to keep';
  setPasswordVisibility(false);
  if (passwordInput) {
    passwordInput.value = '';
    suggestPassword();
  }
  if (projectsInput) projectsInput.value = '';
  if (portalEditPermissionInput) portalEditPermissionInput.checked = false;
}

function populateUserForm(user) {
  expandFormPanel();
  userIdInput.value = user.id;
  usernameInput.value = user.username;
  usernameInput.disabled = true;
  roleInput.value = user.role;
  statusInput.value = user.status || 'active';
  if (projectsInput) projectsInput.value = Array.isArray(user.projects) ? user.projects.join(', ') : '';
  if (portalEditPermissionInput) {
    const permissions = Array.isArray(user.permissions) ? user.permissions : [];
    portalEditPermissionInput.checked = permissions.includes('portal:edit') || permissions.includes('portal:edit:Qtiler2Origo');
  }
  passwordInput.value = '';
  passwordInput.placeholder = 'Leave blank to keep';
  setPasswordVisibility(false);
  userFormTitle.textContent = `Edit ${user.username}`;
  userFormSubmit.textContent = 'Update';
  const panel = document.getElementById('user-form-panel');
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderUsers() {
  usersTableBody.innerHTML = '';
  if (!state.users.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 8;
    cell.textContent = 'No users found.';
    row.appendChild(cell);
    usersTableBody.appendChild(row);
    return;
  }
  state.users.forEach((user) => {
    const row = document.createElement('tr');

    const usernameCell = document.createElement('td');
    usernameCell.className = 'col-user';
    usernameCell.textContent = user.username;

    const roleCell = document.createElement('td');
    roleCell.className = 'col-role';
    const roleTag = document.createElement('span');
    roleTag.className = `tag role-${user.role}`;
    roleTag.textContent = user.role === 'admin' ? 'Administrator' : 'User';
    roleCell.appendChild(roleTag);

    const statusCell = document.createElement('td');
    statusCell.className = 'col-status';
    const statusTag = document.createElement('span');
    statusTag.className = `tag status-${user.status || 'active'}`;
    statusTag.textContent = user.status === 'disabled' ? 'Suspended' : 'Active';
    statusCell.appendChild(statusTag);

    const apiKeyCell = document.createElement('td');
    apiKeyCell.className = 'api-key-cell col-api';
    const oneTimeKey = state.recentlyIssuedKeys.get(user.id) || '';
    const apiKeyValue = oneTimeKey || user.apiKey || '';
    const apiKeyVisible = Boolean(apiKeyValue);
    const apiKeyInput = document.createElement('input');
    apiKeyInput.type = 'text';
    apiKeyInput.readOnly = true;
    apiKeyInput.value = apiKeyVisible
      ? apiKeyValue
      : (user.apiKeyPrefix ? `${user.apiKeyPrefix}… (hidden)` : '(no key)');
    apiKeyInput.className = 'api-key-input';
    const hasStoredPlainKey = Boolean(user.apiKey);
    const isOneTimeOnlyView = Boolean(oneTimeKey) && !hasStoredPlainKey;
    apiKeyInput.title = apiKeyVisible
      ? (isOneTimeOnlyView
          ? 'API key (copy now — this one-time view will not be shown again)'
          : 'API key')
      : 'API key is stored hashed. Use "Regenerate" to issue a new one.';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy';
    copyBtn.disabled = !apiKeyVisible;
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(apiKeyValue || '');
        showMessage('success', `API key copied for ${user.username}.`);
      } catch (err) {
        showMessage('error', parseError(err, 'Copy failed.'));
      }
    });

    const rotateBtn = document.createElement('button');
    rotateBtn.type = 'button';
    rotateBtn.textContent = 'Regenerate';
    rotateBtn.addEventListener('click', async () => {
      if (!confirm(`Regenerate API key for ${user.username}? The previous key will stop working immediately.`)) return;
      try {
        const result = await api(`/auth-admin/users/${user.id}/api-key`, { method: 'POST' });
        if (result?.apiKey) {
          state.recentlyIssuedKeys.set(user.id, result.apiKey);
          if (result?.apiKeyOneTime) {
            showMessage('success', `API key regenerated for ${user.username}. Copy it now — this one-time view will not be shown again.`);
          } else {
            showMessage('success', `API key regenerated for ${user.username}. You can copy it now or later from this table.`);
          }
        } else {
          showMessage('success', `API key regenerated for ${user.username}.`);
        }
        await loadUsers(false);
      } catch (err) {
        showMessage('error', parseError(err, 'Failed to regenerate API key.'));
      }
    });

    const apiKeyActions = document.createElement('div');
    apiKeyActions.className = 'api-key-actions';
    apiKeyActions.append(copyBtn, rotateBtn);

    const lastUsedLine = document.createElement('div');
    lastUsedLine.className = 'api-key-meta';
    lastUsedLine.style.fontSize = '11px';
    lastUsedLine.style.color = '#64748b';
    lastUsedLine.style.marginTop = '4px';
    lastUsedLine.textContent = `Last used: ${formatRelativeTime(user.apiKeyLastUsedAt)}`;

    apiKeyCell.append(apiKeyInput, apiKeyActions, lastUsedLine);

    const projectsCell = document.createElement('td');
    projectsCell.className = 'col-projects';
    projectsCell.textContent = isAdminUser(user)
      ? ADMIN_ALL_PROJECTS_LABEL
      : Array.isArray(user.projects) && user.projects.length
      ? user.projects.join(', ')
      : '—';

    const createdCell = document.createElement('td');
    createdCell.className = 'col-created';
    createdCell.textContent = user.createdAt ? new Date(user.createdAt).toLocaleString() : '—';

    const updatedCell = document.createElement('td');
    updatedCell.className = 'col-updated';
    updatedCell.textContent = user.updatedAt ? new Date(user.updatedAt).toLocaleString() : '—';

    const actionsCell = document.createElement('td');
    actionsCell.className = 'actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => populateUserForm(user));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete user ${user.username}?`)) return;
      try {
        await api(`/auth-admin/users/${user.id}`, { method: 'DELETE' });
        showMessage('success', `User ${user.username} removed.`);
        clearSessionPassword(user);
        await loadUsers(false);
        await loadProjects(false);
      } catch (err) {
        showMessage('error', parseError(err, 'Unable to delete user.'));
      }
    });

    if (user.username !== 'admin') {
      actionsCell.append(editBtn, deleteBtn);
    } else {
      actionsCell.append(editBtn);
    }

    row.append(usernameCell, roleCell, statusCell, apiKeyCell, projectsCell, createdCell, updatedCell, actionsCell);
    usersTableBody.appendChild(row);
  });
}

function renderPluginAccess() {
  const tableBody = document.querySelector('#plugin-access-table tbody');
  if (!tableBody) return;
  tableBody.innerHTML = '';

  if (!state.users.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.textContent = 'No users found.';
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  const plugins = Array.isArray(state.pluginMaps) ? state.pluginMaps : [];
  const allMaps = plugins.flatMap((plugin) => (Array.isArray(plugin.maps) ? plugin.maps : []));
  const knownMapPermissions = new Set(allMaps.map((map) => `${PLUGIN_MAP_PERMISSION_PREFIX}${map.id}`));
  const policyGrantsProject = (user, projectId) => {
    const access = state.permissions?.[projectId] || {};
    return access.public === true
      || (Array.isArray(access.allowedUsers) && access.allowedUsers.includes(user.id))
      || (Array.isArray(access.allowedRoles) && access.allowedRoles.includes(user.role));
  };

  state.users.forEach((user) => {
    const permissions = new Set(Array.isArray(user.permissions) ? user.permissions : []);
    const mapPermissions = new Set(Array.from(permissions).filter((permission) => permission.startsWith(PLUGIN_MAP_PERMISSION_PREFIX)));
    const isAdmin = isAdminUser(user);
    const userProjects = new Set(Array.isArray(user.projects) ? user.projects : []);
    const permissionDraft = state.pluginPermissionDrafts.get(user.id);
    const mapDraft = state.pluginAccessDrafts.get(user.id);
    const row = document.createElement('tr');

    const userCell = document.createElement('td');
    userCell.textContent = user.username;

    const adminCell = document.createElement('td');
    const adminOptions = document.createElement('div');
    adminOptions.className = 'plugin-access-options';
    const managedPermissions = getManagedPermissions();
    managedPermissions.forEach((portal) => {
      const label = document.createElement('label');
      label.className = 'permission-chip';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.permission = portal.permission;
      const isDatabasePermission = portal.permission.startsWith('database:read');
      input.checked = permissionDraft?.has(portal.permission)
        ? permissionDraft.get(portal.permission)
        : isAdmin
        || permissions.has(portal.permission)
        || (!isDatabasePermission && permissions.has('portal:edit'));
      input.disabled = isAdmin;
      input.addEventListener('change', () => {
        const draft = state.pluginPermissionDrafts.get(user.id) || new Map(managedPermissions.map((entry) => [
          entry.permission,
          permissions.has(entry.permission) || (!entry.permission.startsWith('database:read') && permissions.has('portal:edit'))
        ]));
        draft.set(portal.permission, input.checked);
        state.pluginPermissionDrafts.set(user.id, draft);
      });
      label.append(input, document.createTextNode(portal.label));
      adminOptions.appendChild(label);
    });
    adminCell.appendChild(adminOptions);

    const mapsCell = document.createElement('td');
    mapsCell.className = 'plugin-map-cell';
    if (!allMaps.length) {
      const empty = document.createElement('p');
      empty.className = 'help';
      empty.textContent = 'No published plugin maps found yet.';
      mapsCell.appendChild(empty);
    } else {
      plugins.forEach((plugin) => {
        const maps = Array.isArray(plugin.maps) ? plugin.maps : [];
        if (!maps.length) return;
        const group = document.createElement('div');
        group.className = 'plugin-map-group';
        const heading = document.createElement('h4');
        heading.textContent = plugin.label;
        group.appendChild(heading);

        maps.forEach((map) => {
          const projectIds = Array.isArray(map.projectIds) ? map.projectIds : [];
          const publicProjects = projectIds.filter((projectId) => state.permissions?.[projectId]?.public === true);
          const allPublic = projectIds.length > 0 && publicProjects.length === projectIds.length;
          const hasProjectAccess = projectIds.length > 0 && projectIds.every((projectId) => policyGrantsProject(user, projectId) || userProjects.has(projectId));
          const mapPermission = `${PLUGIN_MAP_PERMISSION_PREFIX}${map.id}`;
          const hasMapGrant = mapPermissions.has(mapPermission);
          const hasAccess = isAdmin || allPublic || hasProjectAccess || hasMapGrant;
          const canEditMapAccess = !isAdmin && !allPublic && !hasProjectAccess && projectIds.length > 0;
          const label = document.createElement('label');
          label.className = 'map-access-row';
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.dataset.mapId = map.id;
          input.dataset.mapPermission = mapPermission;
          input.dataset.publicMap = allPublic ? '1' : '0';
          input.checked = canEditMapAccess && mapDraft?.has(map.id) ? mapDraft.get(map.id) : hasMapGrant || hasAccess;
          input.disabled = !canEditMapAccess;
          if (!canEditMapAccess) mapDraft?.delete(map.id);
          input.addEventListener('change', () => {
            const draft = state.pluginAccessDrafts.get(user.id) || new Map();
            draft.set(map.id, input.checked);
            state.pluginAccessDrafts.set(user.id, draft);
          });
          const copy = document.createElement('span');
          const accessNote = allPublic ? 'Public map' : (projectIds.length ? projectIds.join(', ') : 'No source project detected');
          copy.innerHTML = `<strong>${escapeHtml(map.title || map.profileKey)}</strong><small>${escapeHtml(accessNote)}</small>`;
          label.append(input, copy);
          group.appendChild(label);
        });
        mapsCell.appendChild(group);
      });
    }

    const actionsCell = document.createElement('td');
    actionsCell.className = 'actions';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save';
    saveBtn.disabled = isAdmin;
    saveBtn.addEventListener('click', async () => {
      const nextPermissions = new Set(Array.isArray(user.permissions) ? user.permissions : []);
      nextPermissions.delete('portal:edit');
      managedPermissions.forEach((portal) => nextPermissions.delete(portal.permission));
      row.querySelectorAll('input[data-permission]').forEach((input) => {
        if (input.checked) nextPermissions.add(input.dataset.permission);
      });

      knownMapPermissions.forEach((permission) => nextPermissions.delete(permission));
      row.querySelectorAll('input[data-map-permission]').forEach((input) => {
        if (input.checked) nextPermissions.add(input.dataset.mapPermission);
      });

      try {
        const result = await api(`/auth-admin/users/${user.id}`, {
          method: 'PATCH',
          body: {
            permissions: Array.from(nextPermissions)
          }
        });
        if (result?.user) {
          state.users = state.users.map((entry) => entry.id === user.id ? { ...entry, ...result.user } : entry);
        }
        state.pluginAccessDrafts.delete(user.id);
        state.pluginPermissionDrafts.delete(user.id);
        renderUsers();
        renderPluginAccess();
        state.pluginAccessNeedsRender = false;
        showMessage('success', `Plugin map access updated for ${user.username}.`);
      } catch (err) {
        showMessage('error', parseError(err, 'Unable to update plugin map permissions.'));
      }
    });
    actionsCell.appendChild(saveBtn);

    row.append(userCell, adminCell, mapsCell, actionsCell);
    tableBody.appendChild(row);
  });
}

function renderPublicProjects() {
  const container = document.getElementById('public-projects-list');
  if (!container) return;

  container.innerHTML = '';

  const projectList = state.projects || [];

  if (!projectList.length) {
    container.textContent = 'No projects available.';
    return;
  }

  projectList.forEach((project) => {
    const projectId = project.id;
    const access = state.permissions[projectId] || {};

    const card = document.createElement('article');
    card.className = 'project-card';
    card.dataset.projectId = projectId;

    const header = document.createElement('header');
    const heading = document.createElement('h3');
    heading.textContent = project.name || projectId;

    const toggleWrap = document.createElement('label');
    toggleWrap.className = 'public-project-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = access.public === true;
    checkbox.dataset.projectId = projectId;

    checkbox.addEventListener('change', async () => {
      try {
        await api(`/auth-admin/projects/${projectId}`, {
          method: 'PATCH',
          body: { public: checkbox.checked }
        });
        showMessage('success', `${project.name || projectId} is now ${checkbox.checked ? 'public' : 'private'}.`);
        await loadProjects(false);
      } catch (err) {
        showMessage('error', parseError(err, 'Unable to update project visibility.'));
        checkbox.checked = !checkbox.checked;
      }
    });

    const toggleText = document.createElement('span');
    toggleText.textContent = 'Public';
    toggleWrap.append(checkbox, toggleText);

    header.append(heading, toggleWrap);
    card.appendChild(header);

    container.appendChild(card);
  });
}

function isVectorPermissionLayer(layer) {
  const isTheme = layer.isTheme === true || layer.kind === 'theme' || layer.type === 'THEME' || String(layer.name || '').startsWith('theme:');
  const type = String(layer.type || '').toLowerCase();
  const geometry = String(layer.geometry_type || '').toLowerCase();
  return !isTheme && !['raster', 'wms', 'wmts', 'xyz'].includes(type)
    && (['vector', 'wfs'].includes(type) || layer.kind === 'vector' || /point|line|polygon/.test(geometry));
}

async function savePublishedCrsForProject(projectId, value) {
  const codes = Array.from(new Set(String(value || '').split(',').map((code) => code.trim().toUpperCase()).filter(Boolean)));
  if (codes.length > 32 || codes.some((code) => !/^(EPSG:[1-9][0-9]*|CRS:84)$/.test(code))) throw new Error('Invalid published CRS');
  for (const code of codes) {
    if (code !== 'CRS:84') {
      try {
        const resolved = await api(`/api/proj4/${encodeURIComponent(code)}`);
        if (!resolved?.def) throw new Error('No projection definition');
      } catch {
        throw new Error(`Unknown or unavailable EPSG: ${code}. No changes saved.`);
      }
    }
  }
  const saved = await api(`/projects/${encodeURIComponent(projectId)}/config`, { method: 'PATCH', body: { services: { publishedCrs: codes } } });
  if (JSON.stringify(saved.services?.publishedCrs) !== JSON.stringify(codes)) {
    throw new Error('The server did not save the CRS list. Restart Qtiler with the updated backend and retry.');
  }
  state.projectServicesByProject = state.projectServicesByProject || {};
  state.projectServicesByProject[projectId] = saved.services || { publishedCrs: codes };
  return codes;
}

function renderLayerPermissions() {
  const container = document.getElementById('layer-permissions-list');
  if (!container) return;

  container.innerHTML = '';
  if (!state.layerCatalogLoaded) {
    const loading = document.createElement('p');
    loading.className = 'layer-permissions-loading';
    loading.setAttribute('role', 'status');
    loading.textContent = 'Loading layer permissions…';
    container.appendChild(loading);
    return;
  }
  const projectList = state.projects || [];
  if (!projectList.length) {
    container.textContent = 'No projects available.';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'permission-grid';
  const selectedProject = projectList.find((project) => project.id === state.layerPermissionProjectId) || projectList[0];
  state.layerPermissionProjectId = selectedProject.id;
  const projectField = document.createElement('label');
  projectField.className = 'layer-project-picker';
  const projectLabel = document.createElement('span');
  projectLabel.textContent = 'Project';
  const projectSelect = document.createElement('select');
  projectSelect.id = 'layer-permissions-project';
  projectList.forEach((project) => {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.name || project.id;
    option.selected = project.id === selectedProject.id;
    projectSelect.appendChild(option);
  });
  projectSelect.addEventListener('change', () => {
    state.layerPermissionProjectId = projectSelect.value;
    renderLayerPermissions();
  });
  projectField.append(projectLabel, projectSelect);
  container.appendChild(projectField);
  const crsField = document.createElement('label');
  crsField.className = 'layer-project-picker';
  const crsLabel = document.createElement('span');
  crsLabel.textContent = 'Published CRS (WMS/WFS/WMTS)';
  const crsInput = document.createElement('input');
  crsInput.id = 'layer-permissions-crs';
  crsInput.type = 'text';
  crsInput.placeholder = 'EPSG:3006, EPSG:3857';
  const selectedCodes = state.projectServicesByProject?.[selectedProject.id]?.publishedCrs || [];
  crsInput.value = selectedCodes.length ? selectedCodes.join(', ') : (state.projectCrsByProject?.[selectedProject.id] || '');
  const crsHelp = document.createElement('small');
  crsHelp.className = 'help';
  crsHelp.textContent = `Original project CRS: ${state.projectCrsByProject?.[selectedProject.id] || 'Unavailable'}. Add EPSG codes separated by commas, for example EPSG:3006, EPSG:3857. Leave empty for automatic publication.`;
  crsInput.addEventListener('change', async () => {
    const value = crsInput.value;
    try {
      crsInput.disabled = true;
      const codes = await savePublishedCrsForProject(selectedProject.id, value);
      crsInput.value = codes.join(', ');
      showMessage('success', `Service CRS saved for ${selectedProject.name || selectedProject.id}.`, { ttlMs: 2500 });
    } catch (err) {
      showMessage('error', parseError(err, 'Unable to save service CRS.'));
    } finally {
      crsInput.disabled = false;
    }
  });
  crsField.append(crsLabel, crsInput, crsHelp);
  container.appendChild(crsField);

  [selectedProject].forEach((project) => {
    const projectId = project.id;
    const projectLayers = Array.isArray(state.layersByProject?.[projectId]) ? state.layersByProject[projectId] : [];
    const layerAttributes = state.layerAttributesByProject?.[projectId] || {};
    const layerPermissions = state.layerPermissionsByProject?.[projectId] || new Map();

    const card = document.createElement('article');
    card.className = 'permission-card layer-permission-project';
    card.dataset.projectId = projectId;

    const header = document.createElement('header');
    header.className = 'permission-card-header';

    const toggleButton = document.createElement('div');
    toggleButton.className = 'permission-project-title';

    const titleWrap = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = project.name || projectId;
    const meta = document.createElement('p');
    meta.className = 'help';
    meta.textContent = `${projectLayers.length} layer${projectLayers.length === 1 ? '' : 's'}`;
    titleWrap.append(heading, meta);

    toggleButton.append(titleWrap);

    const bulkActions = document.createElement('div');
    bulkActions.className = 'permission-bulk-actions';

    const makeBulkButton = (label, action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'permission-bulk-button';
      button.textContent = label;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        action();
      });
      return button;
    };

    const setBulkChecked = (selector, checked) => {
      Array.from(list.querySelectorAll(selector)).forEach((input) => {
        if (input.disabled) return;
        input.checked = checked;
      });
      scheduleLayerPermissionAutosave(projectId, project.name || projectId, list);
    };

    bulkActions.append(
      makeBulkButton('Exclude all', () => setBulkChecked('.exclude-check', true)),
      makeBulkButton('Clear exclude', () => setBulkChecked('.exclude-check', false))
    );
    if (projectLayers.some(isVectorPermissionLayer)) {
      bulkActions.append(
        makeBulkButton('Edit all', () => setBulkChecked('.edit-check', true)),
        makeBulkButton('Clear edit', () => setBulkChecked('.edit-check', false))
      );
    }

    header.append(toggleButton, bulkActions);
    card.appendChild(header);

    const list = document.createElement('div');
    list.className = 'layer-permission-list';
    list.hidden = false;

    if (!projectLayers.length) {
      const empty = document.createElement('p');
      empty.className = 'help';
      empty.textContent = 'No layers found.';
      list.appendChild(empty);
    } else {
      projectLayers.forEach((layer) => {
        const permission = layerPermissions.get(String(layer.name || '')) || layer || {};
        const config = permission.search || {};
        const isVectorLayer = isVectorPermissionLayer(layer);
        const layerMeta = layerAttributes[layer.name] || { all: [], nonGeometry: [], geometry: [] };
        const savedColumns = [
          config.searchAttribute,
          config.titleField,
          config.idAttribute,
          ...(Array.isArray(config.fields) ? config.fields : [])
        ].map((col) => String(col || '').trim()).filter(Boolean);
        const detectedColumns = Array.isArray(layerMeta.nonGeometry) && layerMeta.nonGeometry.length
          ? layerMeta.nonGeometry
          : (Array.isArray(layerMeta.all) ? layerMeta.all : []);
        const availableColumns = Array.from(new Set([...savedColumns, ...detectedColumns]));
        const searchableEnabled = permission.wfsSearchable === true;
        const editableEnabled = permission.wfsEditable === true;
        const publicExcludedEnabled = permission.publicExcluded === true || permission.excluded === true;
        const selectedSearch = getSelectedSearchFields(config, availableColumns);
        const selectedId = pickPreferredAttribute(
          [config.idAttribute, 'GID', 'gid', 'id', 'ID', 'fid', 'FID'],
          availableColumns
        );
        const selectedGeom = detectGeometryAttribute(layer, layerMeta, config.geometryAttribute);
        const hintText = String(config.hintText || '').trim() || 'Search...';

        const row = document.createElement('div');
        row.className = 'layer-permission-row';
        if (!isVectorLayer) row.classList.add('layer-permission-row--raster');
        row.dataset.layerName = layer.name;
        row.dataset.geometryAttribute = selectedGeom;
        row.dataset.vectorLayer = isVectorLayer ? '1' : '0';

        const layerName = document.createElement('div');
        layerName.className = 'permission-layer-name';
        const strong = document.createElement('strong');
        strong.textContent = layer.title || layer.name;
        const small = document.createElement('small');
        small.textContent = layer.name;
        layerName.append(strong, small);

        const excludeToggle = document.createElement('label');
        excludeToggle.className = 'permission-chip';
        const excludeInput = document.createElement('input');
        excludeInput.type = 'checkbox';
        excludeInput.className = 'exclude-check';
        excludeInput.checked = publicExcludedEnabled;
        excludeToggle.append(excludeInput, document.createTextNode('Exclude public'));

        const editToggle = document.createElement('label');
        editToggle.className = 'permission-chip';
        const editInput = document.createElement('input');
        editInput.type = 'checkbox';
        editInput.className = 'edit-check';
        editInput.checked = isVectorLayer && editableEnabled;
        editInput.disabled = !isVectorLayer;
        editToggle.append(editInput, document.createTextNode('Edit'));

        const searchToggle = document.createElement('label');
        searchToggle.className = 'permission-chip';
        const searchInput = document.createElement('input');
        searchInput.type = 'checkbox';
        searchInput.className = 'search-check';
        searchInput.checked = isVectorLayer && searchableEnabled;
        searchInput.disabled = !isVectorLayer;
        searchToggle.append(searchInput, document.createTextNode('Search'));

        const infoToggle = document.createElement('label');
        infoToggle.className = 'permission-chip';
        const infoInput = document.createElement('input');
        infoInput.type = 'checkbox';
        infoInput.className = 'info-check';
        infoInput.checked = isVectorLayer && permission.wmsQueryable !== false;
        infoToggle.append(infoInput, document.createTextNode('WMS infoclick'));

        const publicServiceToggle = (label, className, enabled, disabled = false) => {
          const toggle = document.createElement('label');
          toggle.className = 'permission-chip';
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.className = className;
          input.checked = enabled;
          input.disabled = disabled;
          toggle.append(input, document.createTextNode(label));
          return toggle;
        };
        const publicWmsToggle = publicServiceToggle('Public WMS', 'public-wms-check', permission.publicWms !== false);
        const publicWfsToggle = publicServiceToggle('Public WFS', 'public-wfs-check', isVectorLayer && permission.publicWfs !== false, !isVectorLayer);
        const publicWmtsToggle = publicServiceToggle('Public WMTS', 'public-wmts-check', permission.publicWmts !== false);

        const publicControls = document.createElement('div');
        publicControls.className = 'permission-control-group';
        const publicHeading = document.createElement('strong');
        publicHeading.textContent = 'Public services';
        publicControls.append(publicHeading, excludeToggle, publicWmsToggle, publicWfsToggle, publicWmtsToggle);

        const layerControls = document.createElement('div');
        layerControls.className = 'permission-control-group';
        const layerHeading = document.createElement('strong');
        layerHeading.textContent = 'Layer permissions';
        layerControls.append(layerHeading);
        if (isVectorLayer) layerControls.append(infoToggle, editToggle, searchToggle);

        const searchControls = document.createElement('div');
        searchControls.className = `search-config-row${isVectorLayer && searchableEnabled ? '' : ' is-hidden'}`;

        const searchField = document.createElement('div');
        searchField.className = 'mini-field';
        const searchFieldLabel = document.createElement('span');
        searchFieldLabel.textContent = 'Searchable attributes';
        searchField.appendChild(searchFieldLabel);
        const searchColumns = document.createElement('div');
        searchColumns.className = 'search-columns';
        setSearchColumnOptions(searchColumns, availableColumns, selectedSearch);
        searchField.appendChild(searchColumns);
        const searchHelp = document.createElement('small');
        searchHelp.className = 'help';
        searchHelp.textContent = 'Search matches any selected attribute. Use + to add another.';
        searchField.appendChild(searchHelp);

        const idField = document.createElement('label');
        idField.className = 'mini-field';
        idField.innerHTML = '<span>idAttribute</span>';
        const idSelect = document.createElement('select');
        idSelect.className = 'id-select';
        idSelect.innerHTML = (availableColumns.length ? availableColumns : ['']).map((col) => {
          const escaped = escapeHtml(col || '');
          const sel = selectedId === col ? ' selected' : '';
          return `<option value="${escaped}"${sel}>${escapeHtml(col || 'No attributes detected')}</option>`;
        }).join('');
        idField.appendChild(idSelect);

        const hintField = document.createElement('label');
        hintField.className = 'mini-field';
        hintField.innerHTML = '<span>hintText</span>';
        const hintInput = document.createElement('input');
        hintInput.type = 'text';
        hintInput.className = 'hint-input';
        hintInput.value = hintText;
        hintInput.placeholder = 'Search...';
        hintField.appendChild(hintInput);

        editInput.addEventListener('change', () => scheduleLayerPermissionAutosave(projectId, project.name || projectId, list));

        searchInput.addEventListener('change', () => {
          searchControls.classList.toggle('is-hidden', !searchInput.checked);
          if (searchInput.checked) {
            ensureLayerAttributes(projectId, layer.name, row).then(() => {
              scheduleLayerPermissionAutosave(projectId, project.name || projectId, list);
            }).catch((err) => {
              searchHelp.textContent = `Could not load layer attributes: ${parseError(err, 'request failed')}`;
            });
          }
          scheduleLayerPermissionAutosave(projectId, project.name || projectId, list);
        });

        searchColumns.addEventListener('focusin', () => {
          const current = state.layerAttributesByProject?.[projectId]?.[layer.name];
          if (!Array.isArray(current?.all) || !current.all.length) {
            ensureLayerAttributes(projectId, layer.name, row).catch((err) => {
              searchHelp.textContent = `Could not load layer attributes: ${parseError(err, 'request failed')}`;
            });
          }
        });

        searchColumns.addEventListener('change', (event) => {
          if (!event.target.matches('.search-column-select')) return;
          syncSearchColumnOptions(searchColumns);
          scheduleLayerPermissionAutosave(projectId, project.name || projectId, list);
        });
        searchColumns.addEventListener('click', (event) => {
          const button = event.target.closest('.search-column-add, .search-column-remove');
          if (!button) return;
          event.preventDefault();
          const currentAvailableColumns = getAvailableLayerColumns(projectId, layer.name, availableColumns);
          const selectedValues = getSelectedSearchColumnValues(searchColumns);
          if (button.classList.contains('search-column-add')) {
            if (selectedValues.length >= currentAvailableColumns.length) return;
            setSearchColumnOptions(searchColumns, currentAvailableColumns, [...selectedValues, '']);
          } else {
            const searchRow = button.closest('.search-column-row');
            const index = Array.from(searchColumns.querySelectorAll('.search-column-row')).indexOf(searchRow);
            if (index >= 0) selectedValues.splice(index, 1);
            setSearchColumnOptions(searchColumns, currentAvailableColumns, selectedValues);
          }
          scheduleLayerPermissionAutosave(projectId, project.name || projectId, list);
        });

        searchControls.append(searchField, idField, hintField);
        row.append(layerName, publicControls);
        if (isVectorLayer) row.append(layerControls, searchControls);
        row.querySelectorAll('input, select').forEach((control) => {
          if (control === searchInput || control === editInput) return;
          control.addEventListener('change', () => scheduleLayerPermissionAutosave(projectId, project.name || projectId, list));
        });
        hintInput.addEventListener('input', () => scheduleLayerPermissionAutosave(projectId, project.name || projectId, list));
        list.appendChild(row);
        if (isVectorLayer && searchableEnabled) {
          ensureLayerAttributes(projectId, layer.name, row).catch((err) => {
            searchHelp.textContent = `Could not load layer attributes: ${parseError(err, 'request failed')}`;
          });
        }
      });
    }

    card.appendChild(list);
    grid.appendChild(card);
  });

  container.appendChild(grid);
}

const layerPermissionAutosaveTimers = new Map();

function collectLayerPermissionPayload(list) {
  const rows = Array.from(list.querySelectorAll('.layer-permission-row'));
  return rows.map((row) => {
    const layerName = String(row.dataset.layerName || '').trim();
    const isVectorLayer = row.dataset.vectorLayer === '1';
    const publicExcluded = !!row.querySelector('.exclude-check')?.checked;
    const wfsEditable = isVectorLayer && !!row.querySelector('.edit-check')?.checked;
    const wfsSearchable = isVectorLayer && !!row.querySelector('.search-check')?.checked;
    const searchFields = getSelectedSearchColumnValues(row.querySelector('.search-columns'));
    const searchAttribute = searchFields[0] || '';
    const idAttribute = String(row.querySelector('.id-select')?.value || '').trim();
    const hint = String(row.querySelector('.hint-input')?.value || '').trim() || 'Search...';
    const geometryAttribute = String(row.dataset.geometryAttribute || '').trim();
    return {
      name: layerName,
      publicExcluded,
      wfsEditable,
      wfsSearchable,
      publicWms: !!row.querySelector('.public-wms-check')?.checked,
      publicWfs: isVectorLayer && !!row.querySelector('.public-wfs-check')?.checked,
      publicWmts: !!row.querySelector('.public-wmts-check')?.checked,
      wmsQueryable: isVectorLayer && !!row.querySelector('.info-check')?.checked,
      search: searchFields.length && idAttribute
        ? {
          name: layerName,
          idAttribute,
          searchAttribute,
          geometryAttribute,
          hintText: hint,
          fields: searchFields,
          titleField: searchAttribute
        }
        : null
    };
  }).filter((row) => row.name);
}

function scheduleLayerPermissionAutosave(projectId, projectLabel, list) {
  const key = String(projectId || '').trim();
  if (!key) return;
  state.layerPermissionsByProject[key] = new Map(collectLayerPermissionPayload(list).map((entry) => [entry.name, entry]));
  const existing = layerPermissionAutosaveTimers.get(key);
  if (existing) window.clearTimeout(existing);
  const timer = window.setTimeout(async () => {
    layerPermissionAutosaveTimers.delete(key);
    try {
      const response = await api(`/auth-admin/projects/${encodeURIComponent(key)}/layers`, {
        method: 'POST',
        body: { layers: collectLayerPermissionPayload(list) }
      });
      const permissionRows = Array.isArray(response?.layers) ? response.layers : [];
      state.layerPermissionsByProject[key] = new Map(permissionRows.map((entry) => [String(entry?.name || ''), entry]).filter(([name]) => name));
      showMessage('success', `Layer permissions saved for ${projectLabel}.`, { ttlMs: 2500 });
    } catch (err) {
      showMessage('error', parseError(err, 'Unable to save layer permissions.'));
    }
  }, 450);
  layerPermissionAutosaveTimers.set(key, timer);
}

function renderProjects() {
  renderPublicProjects();
  renderLayerPermissions();
  
  const tableBody = document.querySelector('#project-access-table tbody');
  if (!tableBody) return;
  
  tableBody.innerHTML = '';
  
  if (!state.users.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.textContent = 'No users found.';
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  const projectList = state.projects || [];
  
  state.users.forEach((user) => {
    const isAdmin = isAdminUser(user);
    const row = document.createElement('tr');
    
    const userCell = document.createElement('td');
    userCell.textContent = user.username;
    
    const roleCell = document.createElement('td');
    const roleTag = document.createElement('span');
    roleTag.className = `tag role-${user.role}`;
    roleTag.textContent = user.role === 'admin' ? 'Administrator' : 'User';
    roleCell.appendChild(roleTag);
    
    const projectsCell = document.createElement('td');
    projectsCell.className = 'project-checkboxes';
    
    if (!projectList.length) {
      projectsCell.textContent = 'No projects available';
    } else {
      const userProjects = new Set(Array.isArray(user.projects) ? user.projects : []);
      
      projectList.forEach((project) => {
        const projectAccess = state.permissions[project.id] || {};
        const editUsers = Array.isArray(projectAccess.editUsers) ? projectAccess.editUsers : [];
        const label = document.createElement('label');
        label.className = 'project-checkbox-label';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = project.id;
        checkbox.checked = isAdmin || userProjects.has(project.id);
        checkbox.disabled = isAdmin;
        checkbox.dataset.userId = user.id;
        checkbox.dataset.projectId = project.id;
        const editCheckbox = document.createElement('input');
        editCheckbox.type = 'checkbox';
        editCheckbox.value = project.id;
        editCheckbox.checked = isAdmin || editUsers.includes(user.id);
        editCheckbox.disabled = isAdmin;
        editCheckbox.dataset.editProjectId = project.id;
        editCheckbox.title = 'Allow WFS-T/project editing';
        label.append(
          checkbox,
          document.createTextNode(` View ${project.name || project.id} `),
          editCheckbox,
          document.createTextNode(' Edit')
        );
        projectsCell.appendChild(label);
      });
    }
    
    const actionsCell = document.createElement('td');
    actionsCell.className = 'actions';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save';
    saveBtn.disabled = isAdmin;
    saveBtn.addEventListener('click', async () => {
      const checkboxes = projectsCell.querySelectorAll('input[type="checkbox"][data-project-id]');
      const selectedProjects = Array.from(checkboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value);
      const editCheckboxes = projectsCell.querySelectorAll('input[type="checkbox"][data-edit-project-id]');
      const selectedEditProjects = new Set(Array.from(editCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value));
      
      try {
        await api(`/auth-admin/users/${user.id}`, {
          method: 'PATCH',
          body: { projects: selectedProjects }
        });
        await Promise.all(projectList.map(async (project) => {
          const projectId = project.id;
          const access = state.permissions[projectId] || {};
          const currentEditUsers = new Set(Array.isArray(access.editUsers) ? access.editUsers : []);
          if (selectedEditProjects.has(projectId)) currentEditUsers.add(user.id);
          else currentEditUsers.delete(user.id);
          await api(`/auth-admin/projects/${projectId}`, {
            method: 'PATCH',
            body: { editUsers: Array.from(currentEditUsers) }
          });
        }));
        showMessage('success', `Projects updated for ${user.username}.`);
        await loadUsers(false);
        await loadProjects(false);
      } catch (err) {
        showMessage('error', parseError(err, 'Unable to update user projects.'));
      }
    });
    actionsCell.appendChild(saveBtn);
    
    row.append(userCell, roleCell, projectsCell, actionsCell);
    tableBody.appendChild(row);
  });
}

/* ------------------------------------------------------------------ */
/*  Gestión Multibase de Datos (PostGIS / SQL Server)                 */
/* ------------------------------------------------------------------ */
async function loadDatabases() {
  try {
    const payload = await api('/auth-admin/databases');
    state.databases = Array.isArray(payload?.connections) ? payload.connections : [];
    renderDatabases();
    state.pluginAccessNeedsRender = true;
    if (document.querySelector('.tab-panel.active')?.dataset.tabPanel === 'plugins') {
      renderPluginAccess();
      state.pluginAccessNeedsRender = false;
    }
  } catch (err) {
    showMessage('error', parseError(err, 'Failed to load database connections.'));
  }
}

function renderDatabases() {
  if (!dbTableBody) return;
  dbTableBody.innerHTML = '';

  if (!state.databases.length) {
    dbTableBody.innerHTML = '<tr><td colspan="7">No database connections configured.</td></tr>';
    return;
  }

  state.databases.forEach((conn) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><strong>${escapeHtml(conn.name)}</strong></td>
      <td><span class="tag role-authenticated">${escapeHtml(String(conn.engine || '').toUpperCase())}</span></td>
      <td>${escapeHtml(conn.host)}:${conn.port}</td>
      <td>${escapeHtml(conn.database_name)}</td>
      <td>${escapeHtml(conn.username)}</td>
      <td>${conn.is_default ? '<span class="tag status-active">Default</span>' : '—'}</td>
      <td class="actions">
        <button type="button" class="btn-edit-db">Edit</button>
        <button type="button" class="btn-delete-db" style="background: var(--danger);">Delete</button>
      </td>
    `;

    row.querySelector('.btn-edit-db').addEventListener('click', () => {
      const idInput = document.getElementById('db-id');
      const nameInput = document.getElementById('db-name');
      const engineInput = document.getElementById('db-engine');
      const hostInput = document.getElementById('db-host');
      const portInput = document.getElementById('db-port');
      const dbnameInput = document.getElementById('db-dbname');
      const usernameInput = document.getElementById('db-username');
      const passwordInput = document.getElementById('db-password');
      const isdefaultInput = document.getElementById('db-isdefault');
      const titleEl = document.getElementById('db-form-title');

      if (idInput) idInput.value = conn.id;
      if (nameInput) nameInput.value = conn.name;
      if (engineInput) engineInput.value = conn.engine;
      if (hostInput) hostInput.value = conn.host;
      if (portInput) portInput.value = conn.port;
      if (dbnameInput) dbnameInput.value = conn.database_name;
      if (usernameInput) usernameInput.value = conn.username;
      if (passwordInput) passwordInput.value = '********';
      if (isdefaultInput) isdefaultInput.checked = !!conn.is_default;
      if (titleEl) titleEl.textContent = `Edit ${conn.name}`;
    });

    row.querySelector('.btn-delete-db').addEventListener('click', async () => {
      if (!confirm(`Delete connection "${conn.name}"?`)) return;
      try {
        await api(`/auth-admin/databases/${conn.id}`, { method: 'DELETE' });
        showMessage('success', `Connection "${conn.name}" removed.`);
        await loadDatabases();
      } catch (err) {
        showMessage('error', parseError(err, 'Failed to remove database connection.'));
      }
    });

    dbTableBody.appendChild(row);
  });
}

if (dbForm) {
  dbForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const idVal = document.getElementById('db-id')?.value || '';
    const nameVal = document.getElementById('db-name')?.value || '';
    const engineVal = document.getElementById('db-engine')?.value || '';
    const hostVal = document.getElementById('db-host')?.value || '';
    const portVal = document.getElementById('db-port')?.value || '';
    const dbNameVal = document.getElementById('db-dbname')?.value || '';
    const usernameVal = document.getElementById('db-username')?.value || '';
    const passwordVal = document.getElementById('db-password')?.value || '';
    const isDefaultVal = document.getElementById('db-isdefault')?.checked || false;

    const payload = {
      id: idVal,
      name: nameVal,
      engine: engineVal,
      host: hostVal,
      port: portVal,
      databaseName: dbNameVal,
      username: usernameVal,
      password: passwordVal,
      isDefault: isDefaultVal
    };

    try {
      await api('/auth-admin/databases', { method: 'POST', body: payload });
      showMessage('success', 'Database connection saved successfully.');
      dbForm.reset();
      if (document.getElementById('db-id')) document.getElementById('db-id').value = '';
      if (document.getElementById('db-form-title')) document.getElementById('db-form-title').textContent = 'Add new connection';
      await loadDatabases();
    } catch (err) {
      showMessage('error', parseError(err, 'Unable to save database connection.'));
    }
  });

  document.getElementById('db-reset-btn')?.addEventListener('click', () => {
    dbForm.reset();
    if (document.getElementById('db-id')) document.getElementById('db-id').value = '';
    if (document.getElementById('db-form-title')) document.getElementById('db-form-title').textContent = 'Add new connection';
  });
}

async function loadUsers(showFeedback = false) {
  try {
    const payload = await api('/auth-admin/users');
    state.users = Array.isArray(payload?.users) ? payload.users : [];
    renderUsers();
    state.pluginAccessNeedsRender = true;
    if (state.pluginMapsLoaded && document.querySelector('.tab-panel.active')?.dataset.tabPanel === 'plugins') {
      renderPluginAccess();
      state.pluginAccessNeedsRender = false;
    }
    if (showFeedback && state.pluginMapsLoaded && document.querySelector('.tab-panel.active')?.dataset.tabPanel !== 'plugins') {
      state.pluginAccessNeedsRender = true;
    }
    if (showFeedback) showMessage('success', 'Users refreshed.');
  } catch (err) {
    showMessage('error', parseError(err, 'Failed to load users.'));
  }
}

async function loadProjects(showFeedback = false) {
  try {
    const [projectList, accessList, pluginMapList] = await Promise.all([
      api('/projects'),
      api('/auth-admin/projects'),
      api('/auth-admin/plugin-maps')
    ]);
    const normalizedProjects = Array.isArray(projectList)
      ? projectList
      : Array.isArray(projectList?.projects)
        ? projectList.projects
        : [];
    state.projects = normalizedProjects;
    state.permissions = accessList?.projects || {};
    state.pluginMaps = Array.isArray(pluginMapList?.plugins) ? pluginMapList.plugins : [];
    state.pluginMapsLoaded = true;
    state.pluginAccessNeedsRender = true;
    state.layerCatalogLoaded = false;
    const activePanel = document.querySelector('.tab-panel.active')?.dataset.tabPanel;
    if (activePanel === 'layers') await ensureLayerCatalogLoaded();
    renderProjects();
    if (activePanel === 'plugins') {
      renderPluginAccess();
      state.pluginAccessNeedsRender = false;
    }
    if (showFeedback) showMessage('success', 'Permissions refreshed.');
  } catch (err) {
    showMessage('error', parseError(err, 'Failed to load projects.'));
  }
}

userForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = userIdInput.value.trim();
  const payload = {
    username: usernameInput.value.trim(),
    role: roleInput.value,
    status: statusInput.value
  };
  if (projectsInput) {
    payload.projects = projectsInput.value.split(',').map((p) => p.trim()).filter(Boolean);
  }
  const existingUser = state.users.find((u) => String(u.id || '') === id);
  const permissions = new Set(Array.isArray(existingUser?.permissions) ? existingUser.permissions : []);
  payload.permissions = Array.from(permissions);
  const password = passwordInput.value;
  if (!id && (!password || password.length < 6)) {
    showMessage('error', 'Password must be at least 6 characters.');
    return;
  }
  if (password) {
    payload.password = password;
  }
  try {
    if (id) {
      const updated = await api(`/auth-admin/users/${id}`, { method: 'PATCH', body: payload });
      if (payload.password) {
        const target = updated?.user || { id, username: payload.username || usernameInput.value.trim() };
        setSessionPassword(target, payload.password);
      }
      showMessage('success', `User ${payload.username || usernameInput.value} updated.`);
    } else {
      const createPayload = { ...payload };
      if (!createPayload.username) {
        showMessage('error', 'Username is required.');
        return;
      }
      const created = await api('/auth-admin/users', { method: 'POST', body: createPayload });
      if (payload.password) {
        const target = created?.user || { username: createPayload.username };
        setSessionPassword(target, payload.password);
      }
      if (created?.apiKey && created?.user?.id) {
        state.recentlyIssuedKeys.set(created.user.id, created.apiKey);
        if (created?.apiKeyOneTime) {
          showMessage('success', `User ${createPayload.username} created. API key shown once — copy it now from the table.`);
        } else {
          showMessage('success', `User ${createPayload.username} created. API key is available in the table and can be copied later.`);
        }
      } else {
        showMessage('success', `User ${createPayload.username} created.`);
      }
    }
    resetUserForm();
    await loadUsers(false);
    await loadProjects(false);
    const passwordChanged = Boolean(id && payload.username === 'admin' && payload.password);
    await checkDefaultPassword({ displaySuccess: passwordChanged });
  } catch (err) {
    showMessage('error', parseError(err, 'Unable to save user.'));
  }
});

userFormReset.addEventListener('click', () => {
  resetUserForm();
});

document.getElementById('refresh-users').addEventListener('click', () => loadUsers(true));
document.getElementById('refresh-projects').addEventListener('click', () => loadProjects(true));
document.getElementById('refresh-layer-permissions')?.addEventListener('click', () => loadProjects(true));
document.getElementById('refresh-plugin-access')?.addEventListener('click', () => loadUsers(true));
document.getElementById('refresh-databases')?.addEventListener('click', () => loadDatabases());

resetUserForm();

async function bootstrap() {
  try {
    await api('/auth/me');
  } catch (err) {
    if (err.message !== 'auth_required') {
      showMessage('error', parseError(err, 'Unable to validate session.'));
    }
    return;
  }
  await Promise.all([loadUsers(false), loadProjects(false), loadDatabases()]);
  if (state.pluginMapsLoaded) {
    renderPluginAccess();
    state.pluginAccessNeedsRender = false;
  }
  await checkDefaultPassword({ justInstalled: justInstalledFlag });
}

bootstrap();