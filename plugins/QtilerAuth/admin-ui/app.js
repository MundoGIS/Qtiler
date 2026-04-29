/*
 * QtilerAuth Commercial License
 * See LICENSE_QtilerAuth.txt for terms and restrictions.
 */

const state = {
  users: [],
  projects: [],
  permissions: {},
  searchableByProject: {},
  layersByProject: {},
  layerAttributesByProject: {}
};

const messagesEl = document.getElementById('messages');
const usersTableBody = document.querySelector('#users-table tbody');

const userForm = document.getElementById('user-form');
const userFormTitle = document.getElementById('user-form-title');
const userIdInput = document.getElementById('user-id');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const passwordToggleBtn = document.getElementById('password-toggle');
const passwordGenerateBtn = document.getElementById('password-generate');
const roleInput = document.getElementById('role');
const statusInput = document.getElementById('status');
const projectsInput = document.getElementById('projects');
const userFormSubmit = document.getElementById('user-form-submit');
const userFormReset = document.getElementById('user-form-reset');

const goDashboardButton = document.getElementById('go-dashboard');

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

/* Start Users, Projects and License sections collapsed */
['users-body', 'projects-body', 'license-body'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('collapsed');
    const header = document.querySelector(`[data-collapse="${id}"]`);
    if (header) {
      const btn = header.querySelector('.collapse-toggle');
      if (btn) btn.classList.add('collapsed');
    }
  }
});

const DEFAULT_ADMIN_PASSWORD_PLACEHOLDER = 'adminnuevo321';
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
    return !(/^(geom|the_geom|geometry|wkb_geometry)$/.test(n) || /(geometry|point|line|string|polygon|multipolygon|multiline|wkb|wkt)/.test(t));
  });

  const geometry = normalized.filter((attr) => {
    const n = attr.name.toLowerCase();
    const t = attr.type.toLowerCase();
    return (/^(geom|the_geom|geometry|wkb_geometry)$/.test(n) || /(geometry|point|line|string|polygon|multipolygon|multiline|wkb|wkt)/.test(t));
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
  for (const candidate of candidates) {
    try {
      const payload = await api(`/origo/wfs-attributes?project=${encodeURIComponent(projectId)}&layer=${encodeURIComponent(candidate)}`);
      return extractAttributeMetadata(payload?.attributes);
    } catch (_err) {
      // Try next candidate
    }
  }
  return { all: [], nonGeometry: [], geometry: [] };
}

async function loadSearchableCatalog() {
  const projects = Array.isArray(state.projects) ? state.projects : [];
  const results = await Promise.all(projects.map(async (project) => {
    const projectId = String(project?.id || '').trim();
    if (!projectId) return null;
    try {
      const [layersResponse, searchableResponse] = await Promise.all([
        api(`/projects/${encodeURIComponent(projectId)}/layers`),
        api(`/projects/${encodeURIComponent(projectId)}/searchable`)
      ]);
      const allLayers = Array.isArray(layersResponse?.layers) ? layersResponse.layers : [];
      const vectorLayers = allLayers.filter((l) => l.type === 'WFS' || l.kind === 'vector' || !!l.geometry_type);
      const attributeEntries = await Promise.all(vectorLayers.map(async (layer) => {
        const metadata = await fetchLayerAttributes(projectId, layer.name);
        return [layer.name, metadata];
      }));
      return {
        projectId,
        layers: vectorLayers,
        searchable: Array.isArray(searchableResponse) ? searchableResponse : [],
        attributes: Object.fromEntries(attributeEntries)
      };
    } catch (_err) {
      return {
        projectId,
        layers: [],
        searchable: [],
        attributes: {}
      };
    }
  }));

  const searchableByProject = {};
  const layersByProject = {};
  const layerAttributesByProject = {};
  results.filter(Boolean).forEach((entry) => {
    searchableByProject[entry.projectId] = entry.searchable;
    layersByProject[entry.projectId] = entry.layers;
    layerAttributesByProject[entry.projectId] = entry.attributes;
  });
  state.searchableByProject = searchableByProject;
  state.layersByProject = layersByProject;
  state.layerAttributesByProject = layerAttributesByProject;
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
  const response = await fetch(url, opts);
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : null;

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
}

function populateUserForm(user) {
  expandFormPanel();
  userIdInput.value = user.id;
  usernameInput.value = user.username;
  usernameInput.disabled = true;
  roleInput.value = user.role;
  statusInput.value = user.status || 'active';
  if (projectsInput) projectsInput.value = Array.isArray(user.projects) ? user.projects.join(', ') : '';
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
    const apiKeyValue = user.apiKey || '';
    const apiKeyInput = document.createElement('input');
    apiKeyInput.type = 'text';
    apiKeyInput.readOnly = true;
    apiKeyInput.value = apiKeyValue;
    apiKeyInput.className = 'api-key-input';
    apiKeyInput.title = 'API key';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy';
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
      if (!confirm(`Regenerate API key for ${user.username}?`)) return;
      try {
        await api(`/auth-admin/users/${user.id}/api-key`, { method: 'POST' });
        showMessage('success', `API key regenerated for ${user.username}.`);
        await loadUsers(false);
      } catch (err) {
        showMessage('error', parseError(err, 'Failed to regenerate API key.'));
      }
    });

    const apiKeyActions = document.createElement('div');
    apiKeyActions.className = 'api-key-actions';
    apiKeyActions.append(copyBtn, rotateBtn);
    apiKeyCell.append(apiKeyInput, apiKeyActions);

    const projectsCell = document.createElement('td');
    projectsCell.className = 'col-projects';
    projectsCell.textContent = Array.isArray(user.projects) && user.projects.length
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

function renderProjects() {
  renderPublicProjects();
  
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
        const label = document.createElement('label');
        label.className = 'project-checkbox-label';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = project.id;
        checkbox.checked = userProjects.has(project.id);
        checkbox.dataset.userId = user.id;
        checkbox.dataset.projectId = project.id;
        label.append(checkbox, document.createTextNode(` ${project.name || project.id}`));
        projectsCell.appendChild(label);
      });
    }
    
    const actionsCell = document.createElement('td');
    actionsCell.className = 'actions';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
      const checkboxes = projectsCell.querySelectorAll('input[type="checkbox"]');
      const selectedProjects = Array.from(checkboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value);
      
      try {
        await api(`/auth-admin/users/${user.id}`, {
          method: 'PATCH',
          body: { projects: selectedProjects }
        });
        showMessage('success', `Projects updated for ${user.username}.`);
        await loadUsers(false);
      } catch (err) {
        showMessage('error', parseError(err, 'Unable to update user projects.'));
      }
    });
    actionsCell.appendChild(saveBtn);
    
    row.append(userCell, roleCell, projectsCell, actionsCell);
    tableBody.appendChild(row);
  });
}

async function loadUsers(showFeedback = false) {
  try {
    const payload = await api('/auth-admin/users');
    state.users = Array.isArray(payload?.users) ? payload.users : [];
    renderUsers();
    if (showFeedback) showMessage('success', 'Users refreshed.');
  } catch (err) {
    showMessage('error', parseError(err, 'Failed to load users.'));
  }
}

async function loadProjects(showFeedback = false) {
  try {
    const [projectList, accessList] = await Promise.all([
      api('/projects'),
      api('/auth-admin/projects')
    ]);
    const normalizedProjects = Array.isArray(projectList)
      ? projectList
      : Array.isArray(projectList?.projects)
        ? projectList.projects
        : [];
    state.projects = normalizedProjects;
    state.permissions = accessList?.projects || {};
    await loadSearchableCatalog();
    renderProjects();
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
      showMessage('success', `User ${createPayload.username} created.`);
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
  await loadUsers(false);
  await loadProjects(false);
  await checkDefaultPassword({ justInstalled: justInstalledFlag });
}

bootstrap();
