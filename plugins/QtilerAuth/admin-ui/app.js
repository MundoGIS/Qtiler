const state = {
  users: [],
  projects: [],
  permissions: {}
};

const messagesEl = document.getElementById('messages');
const usersTableBody = document.querySelector('#users-table tbody');

const userForm = document.getElementById('user-form');
const userFormTitle = document.getElementById('user-form-title');
const userIdInput = document.getElementById('user-id');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const roleInput = document.getElementById('role');
const statusInput = document.getElementById('status');
const projectsInput = document.getElementById('projects');
const userFormSubmit = document.getElementById('user-form-submit');
const userFormReset = document.getElementById('user-form-reset');

const goDashboardButton = document.getElementById('go-dashboard');

const DEFAULT_ADMIN_PASSWORD_PLACEHOLDER = 'adminnuevo123';
const urlParams = new URLSearchParams(window.location.search);
const justInstalledFlag = urlParams.has('justInstalled');
if (justInstalledFlag && typeof window !== 'undefined' && window.history?.replaceState) {
  window.history.replaceState({}, document.title, window.location.pathname);
}

let defaultPasswordLabel = DEFAULT_ADMIN_PASSWORD_PLACEHOLDER;
let defaultPasswordActive = false;

if (goDashboardButton) {
  goDashboardButton.addEventListener('click', () => {
    window.location.href = '/index.html';
  });
}

function showMessage(type, text, options = {}) {
  const { sticky = false } = options;
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
    }, 6000);
  }
}

function showDefaultPasswordWarning({ justInstalled = false } = {}) {
  const prefix = justInstalled ? 'QtilerAuth was just installed. ' : '';
  const message = `${prefix}The administrator account is still using the initial password "${defaultPasswordLabel}". Open the Users section, edit “admin”, and set a secure password before returning to the dashboard.`;
  showMessage('warning', message, { sticky: true });
}

async function checkDefaultPassword({ displaySuccess = false, justInstalled = false } = {}) {
  try {
    const status = await api('/admin/status');
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
}

function populateUserForm(user) {
  userIdInput.value = user.id;
  usernameInput.value = user.username;
  usernameInput.disabled = true;
  roleInput.value = user.role;
  statusInput.value = user.status || 'active';
  projectsInput.value = Array.isArray(user.projects) ? user.projects.join(', ') : '';
  passwordInput.value = '';
  passwordInput.placeholder = 'Leave blank to keep';
  userFormTitle.textContent = `Edit ${user.username}`;
  userFormSubmit.textContent = 'Update';
}

function renderUsers() {
  usersTableBody.innerHTML = '';
  if (!state.users.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 7;
    cell.textContent = 'No users found.';
    row.appendChild(cell);
    usersTableBody.appendChild(row);
    return;
  }
  state.users.forEach((user) => {
    const row = document.createElement('tr');

    const usernameCell = document.createElement('td');
    usernameCell.textContent = user.username;

    const roleCell = document.createElement('td');
    const roleTag = document.createElement('span');
    roleTag.className = `tag role-${user.role}`;
    roleTag.textContent = user.role === 'admin' ? 'Administrator' : 'User';
    roleCell.appendChild(roleTag);

    const statusCell = document.createElement('td');
    const statusTag = document.createElement('span');
    statusTag.className = `tag status-${user.status || 'active'}`;
    statusTag.textContent = user.status === 'disabled' ? 'Suspended' : 'Active';
    statusCell.appendChild(statusTag);

    const projectsCell = document.createElement('td');
    projectsCell.textContent = Array.isArray(user.projects) && user.projects.length
      ? user.projects.join(', ')
      : '—';

    const createdCell = document.createElement('td');
    createdCell.textContent = user.createdAt ? new Date(user.createdAt).toLocaleString() : '—';

    const updatedCell = document.createElement('td');
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
        await api(`/admin/users/${user.id}`, { method: 'DELETE' });
        showMessage('success', `User ${user.username} removed.`);
        await loadUsers(false);
        await loadProjects(false);
      } catch (err) {
        showMessage('error', parseError(err, 'Unable to delete user.'));
      }
    });

    if (user.username !== 'admin') {
      actionsCell.append(editBtn, deleteBtn);
    } else {
      actionsCell.appendChild(editBtn);
    }

    row.append(usernameCell, roleCell, statusCell, projectsCell, createdCell, updatedCell, actionsCell);
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
    
    const label = document.createElement('label');
    label.className = 'public-project-toggle';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = access.public === true;
    checkbox.dataset.projectId = projectId;
    
    checkbox.addEventListener('change', async () => {
      try {
        await api(`/admin/projects/${projectId}`, {
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
    
    label.append(checkbox, document.createTextNode(` ${project.name || projectId}`));
    container.appendChild(label);
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
        await api(`/admin/users/${user.id}`, {
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
    const payload = await api('/admin/users');
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
      api('/admin/projects')
    ]);
    const normalizedProjects = Array.isArray(projectList)
      ? projectList
      : Array.isArray(projectList?.projects)
        ? projectList.projects
        : [];
    state.projects = normalizedProjects;
    state.permissions = accessList?.projects || {};
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
    status: statusInput.value,
    projects: projectsInput.value.split(',').map((p) => p.trim()).filter(Boolean)
  };
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
      await api(`/admin/users/${id}`, { method: 'PATCH', body: payload });
      showMessage('success', `User ${payload.username || usernameInput.value} updated.`);
    } else {
      const createPayload = { ...payload };
      if (!createPayload.username) {
        showMessage('error', 'Username is required.');
        return;
      }
      await api('/admin/users', { method: 'POST', body: createPayload });
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
