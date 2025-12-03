'use strict';

const footerYearEl = document.getElementById('portal_year');
if (footerYearEl) {
  footerYearEl.textContent = String(new Date().getFullYear());
}

const I18N = {
  en: {
    'admin.title': 'Qtiler · Admin console',
    'admin.subtitle': 'Manage plugins and access control',
    'Dashboard': 'Dashboard',
    'User guide': 'User guide',
    'Language': 'Language',
    'Admin console': 'Admin console',
    'Install Admin Dashboard': 'Install Admin Dashboard',
    'Login': 'Login',
    authPluginEyebrow: 'Authentication',
    authPluginTitle: 'Secure WMTS with QtilerAuth',
    authPluginBody: 'Install the commercial QtilerAuth plugin to manage users, roles, and WMTS authentication for your projects.',
    authPluginCta: 'Get QtilerAuth at MundoGIS.se',
    heroEyebrow: 'Operations',
    heroTitle: 'Admin console',
    heroSubtitle: 'Install signed plugins, enable their admin consoles, and keep your deployment tidy.',
    refreshPlugins: 'Refresh list',
    installSubtitle: 'Upload a plugin package from MundoGIS to install it on this server.',
    installedSubtitle: 'Enabled plugins expose their admin console below. Uninstall to remove files.',
    consoleTitle: 'Active plugin consoles',
    consoleSubtitle: 'Enabled plugins can render their administration UI without leaving this page.',
    noPluginConsoles: 'Enable a plugin to load its administration console here.',
    enabledHint: 'Plugin is active. Use Uninstall to remove it from the server.',
    title: 'Admin Console',
    subtitle: 'Manage plugins and system configuration',
    backToDashboard: 'Back to Dashboard',
    plugins: 'Plugins',
    installPlugin: 'Install plugin',
    installedPlugins: 'Installed plugins',
    noPlugins: 'No plugins installed.',
    uploadZip: 'Plugin ZIP file:',
    installBtn: 'Install plugin',
    enable: 'Enable',
    enabledStatus: 'Enabled',
    disabledStatus: 'Not enabled',
    uninstall: 'Uninstall',
    errorLoadPlugins: 'Error loading plugins.',
    successEnable: 'Plugin {plugin} enabled.',
    errorEnable: 'Could not enable plugin.',
    successUninstall: 'Plugin {plugin} uninstalled.',
    errorUninstall: 'Could not uninstall plugin.',
    confirmUninstall: 'Are you sure you want to uninstall {plugin}?',
    successInstall: 'Plugin {plugin} installed successfully.',
    errorUpload: 'Could not upload plugin.',
    selectZip: 'Select a ZIP file.',
    plugin: 'Plugin',
    operationFailed: 'Operation failed'
  },
  es: {
    'admin.title': 'Qtiler · Consola de administración',
    'admin.subtitle': 'Gestiona plugins y control de acceso',
    'Dashboard': 'Panel principal',
    'User guide': 'Guía de uso',
    'Language': 'Idioma',
    'Admin console': 'Consola de administración',
    'Install Admin Dashboard': 'Instalar panel de administrador',
    'Login': 'Iniciar sesión',
    authPluginEyebrow: 'Autenticación',
    authPluginTitle: 'Protege WMTS con QtilerAuth',
    authPluginBody: 'Instala el plugin comercial QtilerAuth para gestionar usuarios, roles y la autenticación WMTS por proyecto desde la consola.',
    authPluginCta: 'Obtener QtilerAuth en MundoGIS.se',
    heroEyebrow: 'Operaciones',
    heroTitle: 'Panel de administración',
    heroSubtitle: 'Instala plugins firmados, habilita sus consolas e integra todo en un único panel.',
    refreshPlugins: 'Recargar lista',
    installSubtitle: 'Sube un paquete de plugin de MundoGIS para instalarlo en este servidor.',
    installedSubtitle: 'Los plugins habilitados muestran su consola aquí abajo. Desinstala para eliminarlos.',
    consoleTitle: 'Consolas activas',
    consoleSubtitle: 'Los plugins habilitados cargan su interfaz administrativa sin salir de la página.',
    noPluginConsoles: 'Habilita un plugin para ver su consola administrativa.',
    enabledHint: 'Plugin activo. Usa Desinstalar para quitarlo del servidor.',
    title: 'Panel de Administración',
    subtitle: 'Gestiona plugins y configuración del sistema',
    backToDashboard: 'Volver al Dashboard',
    plugins: 'Plugins',
    installPlugin: 'Instalar plugin',
    installedPlugins: 'Plugins instalados',
    noPlugins: 'No hay plugins instalados.',
    uploadZip: 'Archivo ZIP del plugin:',
    installBtn: 'Instalar plugin',
    enable: 'Habilitar',
    enabledStatus: 'Habilitado',
    disabledStatus: 'No habilitado',
    uninstall: 'Desinstalar',
    errorLoadPlugins: 'Error al cargar plugins.',
    successEnable: 'Plugin {plugin} habilitado.',
    errorEnable: 'No se pudo habilitar el plugin.',
    successUninstall: 'Plugin {plugin} desinstalado.',
    errorUninstall: 'No se pudo desinstalar el plugin.',
    confirmUninstall: '¿Seguro que deseas desinstalar {plugin}?',
    successInstall: 'Plugin {plugin} instalado correctamente.',
    errorUpload: 'No se pudo subir el plugin.',
    selectZip: 'Selecciona un archivo ZIP.',
    plugin: 'Plugin',
    operationFailed: 'Operación no completada'
  },
  sv: {
    'admin.title': 'Qtiler · Adminpanel',
    'admin.subtitle': 'Hantera plugins och behörigheter',
    'Dashboard': 'Översikt',
    'User guide': 'Användarguide',
    'Language': 'Språk',
    'Admin console': 'Adminpanel',
    'Install Admin Dashboard': 'Installera adminpanel',
    'Login': 'Logga in',
    authPluginEyebrow: 'Autentisering',
    authPluginTitle: 'Säkra WMTS med QtilerAuth',
    authPluginBody: 'Installera det kommersiella QtilerAuth-pluginet för att hantera användare, roller och projektspecifik WMTS-autentisering.',
    authPluginCta: 'Skaffa QtilerAuth hos MundoGIS.se',
    heroEyebrow: 'Drift',
    heroTitle: 'Adminpanel',
    heroSubtitle: 'Installera signerade plugins, aktivera deras konsoler och håll driften ren.',
    refreshPlugins: 'Uppdatera lista',
    installSubtitle: 'Ladda upp ett pluginpaket från MundoGIS för att installera det på servern.',
    installedSubtitle: 'Aktiverade plugins visar sin konsol nedan. Avinstallera för att radera filer.',
    consoleTitle: 'Aktiva plugin-konsoler',
    consoleSubtitle: 'Aktiverade plugins kan laddas i denna vy utan att lämna sidan.',
    noPluginConsoles: 'Aktivera ett plugin för att visa dess administrationskonsol.',
    enabledHint: 'Pluginet är aktivt. Avinstallera för att ta bort det.',
    title: 'Administrationspanel',
    subtitle: 'Hantera plugins och systemkonfiguration',
    backToDashboard: 'Tillbaka till Dashboard',
    plugins: 'Plugins',
    installPlugin: 'Installera plugin',
    installedPlugins: 'Installerade plugins',
    noPlugins: 'Inga plugins installerade.',
    uploadZip: 'Plugin ZIP-fil:',
    installBtn: 'Installera plugin',
    enable: 'Aktivera',
    enabledStatus: 'Aktiverad',
    disabledStatus: 'Inte aktiverad',
    uninstall: 'Avinstallera',
    errorLoadPlugins: 'Fel vid laddning av plugins.',
    successEnable: 'Plugin {plugin} aktiverat.',
    errorEnable: 'Kunde inte aktivera plugin.',
    successUninstall: 'Plugin {plugin} avinstallerat.',
    errorUninstall: 'Kunde inte avinstallera plugin.',
    confirmUninstall: 'Är du säker på att du vill avinstallera {plugin}?',
    successInstall: 'Plugin {plugin} installerades korrekt.',
    errorUpload: 'Kunde inte ladda upp plugin.',
    selectZip: 'Välj en ZIP-fil.',
    plugin: 'Plugin',
    operationFailed: 'Operationen misslyckades'
  }
};

const state = {
  plugins: { enabled: [], installed: [] }
};

const messagesEl = document.getElementById('messages');
const pluginsContainer = document.getElementById('plugins-container');
const pluginUploadForm = document.getElementById('plugin-upload-form');
const pluginSectionsContainer = document.getElementById('plugin-sections-container');
const refreshPluginsBtn = document.getElementById('refresh-plugins');
const languageSelector = document.getElementById('language_selector');

function t(key, params = {}) {
  const lang = window.qtilerLang ? window.qtilerLang.get() : 'en';
  let text = (I18N[lang] || I18N.en)[key] || key;
  Object.entries(params).forEach(([k, v]) => {
    text = text.replace(`{${k}}`, v);
  });
  return text;
}

function updateStaticTexts() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.setAttribute('placeholder', t(key));
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.setAttribute('title', t(key));
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria-label');
    if (key) el.setAttribute('aria-label', t(key));
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

function parseError(err, fallback) {
  const defaultFallback = t('operationFailed');
  const finalFallback = fallback || defaultFallback;
  if (!err) return finalFallback;
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  return finalFallback;
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
  const res = await fetch(url, opts);
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const detail = (isJson && payload && (payload.error || payload.message)) || (typeof payload === 'string' ? payload : res.statusText);
    const error = new Error(detail || 'Request failed');
    error.status = res.status;
    if (isJson && payload && typeof payload.error === 'string') {
      error.code = payload.error;
    }
    throw error;
  }
  return payload;
}

function renderPlugins() {
  pluginsContainer.innerHTML = '';
  const names = new Set([
    ...(Array.isArray(state.plugins.installed) ? state.plugins.installed : []),
    ...(Array.isArray(state.plugins.enabled) ? state.plugins.enabled : [])
  ]);

  if (!names.size) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.dataset.i18n = 'noPlugins';
    empty.textContent = t('noPlugins');
    pluginsContainer.appendChild(empty);
    return;
  }

  Array.from(names).sort().forEach((name) => {
    const isEnabled = state.plugins.enabled.includes(name);
    const card = document.createElement('article');
    card.className = 'plugin-card';

    const meta = document.createElement('div');
    meta.className = 'plugin-card__meta';
    const heading = document.createElement('h3');
    heading.textContent = name;
    const status = document.createElement('span');
    status.className = `chip ${isEnabled ? 'chip--ok' : 'chip--muted'}`;
    status.textContent = isEnabled ? t('enabledStatus') : t('disabledStatus');
    meta.append(heading, status);

    const actions = document.createElement('div');
    actions.className = 'plugin-card__actions';

    if (!isEnabled) {
      const enableBtn = document.createElement('button');
      enableBtn.type = 'button';
      enableBtn.className = 'button';
      enableBtn.textContent = t('enable');
      enableBtn.addEventListener('click', () => enablePlugin(name));
      actions.appendChild(enableBtn);
    } else {
      const note = document.createElement('p');
      note.className = 'plugin-card__note';
      note.textContent = t('enabledHint');
      actions.appendChild(note);
    }

    const uninstallBtn = document.createElement('button');
    uninstallBtn.type = 'button';
    uninstallBtn.className = 'button button-danger';
    uninstallBtn.textContent = t('uninstall');
    uninstallBtn.addEventListener('click', () => uninstallPlugin(name));
    actions.appendChild(uninstallBtn);

    card.append(meta, actions);
    pluginsContainer.appendChild(card);
  });
}

function cleanupPluginConsoles() {
  if (!pluginSectionsContainer) return;
  pluginSectionsContainer.querySelectorAll('iframe').forEach((frame) => {
    if (typeof frame._qtilerCleanup === 'function') {
      frame._qtilerCleanup();
    }
  });
}

function updatePluginSections() {
  cleanupPluginConsoles();
  pluginSectionsContainer.innerHTML = '';
  const enabled = Array.isArray(state.plugins.enabled) ? [...state.plugins.enabled] : [];

  if (!enabled.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.dataset.i18n = 'noPluginConsoles';
    empty.textContent = t('noPluginConsoles');
    pluginSectionsContainer.appendChild(empty);
    return;
  }

  enabled.sort().forEach((pluginName) => {
    const card = document.createElement('article');
    card.className = 'plugin-console-card';

    const header = document.createElement('div');
    header.className = 'plugin-console-card__header';
    const title = document.createElement('h3');
    title.textContent = pluginName;
    const badge = document.createElement('span');
    badge.className = 'chip chip--ok';
    badge.textContent = t('enabledStatus');
    header.append(title, badge);

    const iframe = document.createElement('iframe');
    iframe.src = `/plugins/${encodeURIComponent(pluginName)}/admin`;
    iframe.loading = 'lazy';
    iframe.referrerPolicy = 'no-referrer';
    attachIframeAutoHeight(iframe);

    card.append(header, iframe);
    pluginSectionsContainer.appendChild(card);
  });
}

function attachIframeAutoHeight(frame) {
  const MIN_HEIGHT = 620;

  const resize = () => {
    try {
      const doc = frame.contentDocument || frame.contentWindow?.document;
      if (!doc) return;
      const body = doc.body;
      const html = doc.documentElement;
      const measurements = [
        body?.scrollHeight,
        body?.offsetHeight,
        html?.scrollHeight,
        html?.offsetHeight
      ].map((value) => (Number.isFinite(value) ? value : 0));
      const nextHeight = Math.max(...measurements, MIN_HEIGHT);
      if (nextHeight && nextHeight !== frame._qtilerLastHeight) {
        frame.style.height = `${nextHeight}px`;
        frame._qtilerLastHeight = nextHeight;
      }
    } catch (_err) {
      // Cross-origin or loading issues fall back to default CSS height.
    }
  };

  const cleanup = () => {
    if (frame._qtilerObserver) {
      frame._qtilerObserver.disconnect();
      frame._qtilerObserver = null;
    }
    if (frame._qtilerResizeHandler && frame.contentWindow) {
      frame.contentWindow.removeEventListener('resize', frame._qtilerResizeHandler);
    }
    frame._qtilerResizeHandler = null;
  };

  const bindObservers = () => {
    try {
      const doc = frame.contentDocument || frame.contentWindow?.document;
      if (!doc || !doc.body) return;
      const observer = new MutationObserver(() => {
        window.requestAnimationFrame(resize);
      });
      observer.observe(doc.body, { childList: true, subtree: true, attributes: true, characterData: true });
      frame._qtilerObserver = observer;
      frame._qtilerResizeHandler = () => window.requestAnimationFrame(resize);
      frame.contentWindow?.addEventListener('resize', frame._qtilerResizeHandler);
    } catch (_err) {
      // Ignore observer failures; the iframe will keep the default height.
    }
  };

  const handleLoad = () => {
    cleanup();
    resize();
    bindObservers();
  };

  frame.addEventListener('load', handleLoad);
  frame._qtilerCleanup = () => {
    cleanup();
    frame.removeEventListener('load', handleLoad);
  };
}
  const cleanup = () => {
    if (frame._qtilerObserver) {
      frame._qtilerObserver.disconnect();
      frame._qtilerObserver = null;
    }
    if (frame._qtilerResizeHandler && frame.contentWindow) {
      frame.contentWindow.removeEventListener('resize', frame._qtilerResizeHandler);
    }
    frame._qtilerResizeHandler = null;
  };

  const bindObservers = () => {
    try {
      const doc = frame.contentDocument || frame.contentWindow?.document;
      if (!doc || !doc.body) return;
      const observer = new MutationObserver(() => {
        window.requestAnimationFrame(resize);
      });
      observer.observe(doc.body, { childList: true, subtree: true, attributes: true, characterData: true });
      frame._qtilerObserver = observer;
      frame._qtilerResizeHandler = () => window.requestAnimationFrame(resize);
      frame.contentWindow?.addEventListener('resize', frame._qtilerResizeHandler);
    } catch (_err) {
      // Ignore observer failures; the iframe will keep the default height.
    }
  };

  const handleLoad = () => {
    cleanup();
    resize();
    bindObservers();
  };

  frame.addEventListener('load', handleLoad);
  frame._qtilerCleanup = () => {
    cleanup();
    frame.removeEventListener('load', handleLoad);
  };

async function loadPlugins() {
  try {
    const payload = await api('/plugins');
    state.plugins.enabled = Array.isArray(payload?.enabled) ? payload.enabled : [];
    state.plugins.installed = Array.isArray(payload?.installed) ? payload.installed : [];
    renderPlugins();
    updatePluginSections();
  } catch (err) {
    if (err?.code === 'auth_plugin_disabled') {
      showMessage('info', t('errorLoadPlugins'));
      state.plugins.enabled = [];
      renderPlugins();
      updatePluginSections();
      return;
    }
    showMessage('error', parseError(err, t('errorLoadPlugins')));
  }
}

async function enablePlugin(name) {
  try {
    await api(`/plugins/${encodeURIComponent(name)}/enable`, { method: 'POST' });
    showMessage('success', t('successEnable', { plugin: name }));
    await loadPlugins();
  } catch (err) {
    if (err?.code === 'auth_plugin_disabled') {
      await loadPlugins();
      return;
    }
    showMessage('error', parseError(err, t('errorEnable')));
  }
}

async function uninstallPlugin(name) {
  if (!confirm(t('confirmUninstall', { plugin: name }))) return;
  try {
    await api(`/plugins/${encodeURIComponent(name)}`, { method: 'DELETE' });
    showMessage('success', t('successUninstall', { plugin: name }));
    await loadPlugins();
  } catch (err) {
    if (err?.code === 'auth_plugin_disabled') {
      await loadPlugins();
      return;
    }
    showMessage('error', parseError(err, t('errorUninstall')));
  }
}

function setupUploadForm() {
  if (!pluginUploadForm) return;
  pluginUploadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fileInput = document.getElementById('plugin-file');
    if (!fileInput || !fileInput.files.length) {
      showMessage('error', t('selectZip'));
      return;
    }
    const formData = new FormData(pluginUploadForm);
    const submitBtn = pluginUploadForm.querySelector('button[type="submit"]');
    try {
      if (submitBtn) submitBtn.disabled = true;
      const payload = await api('/plugins/upload', {
        method: 'POST',
        body: formData
      });
      const pluginName = payload?.plugin?.name || payload?.name || 'plugin';
      showMessage('success', t('successInstall', { plugin: pluginName }));
      pluginUploadForm.reset();
      await loadPlugins();
    } catch (err) {
      showMessage('error', parseError(err, t('errorUpload')));
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

function setupRefreshButton() {
  if (!refreshPluginsBtn) return;
  refreshPluginsBtn.addEventListener('click', () => {
    loadPlugins();
  });
}

function syncLanguageSelector(lang) {
  if (!languageSelector) return;
  if (languageSelector.value !== lang) {
    languageSelector.value = lang;
  }
}

function initLanguage() {
  updateStaticTexts();
  if (window.qtilerLang) {
    const lang = window.qtilerLang.get();
    document.documentElement.lang = lang;
    syncLanguageSelector(lang);
    window.qtilerLang.subscribe((nextLang) => {
      document.documentElement.lang = nextLang;
      syncLanguageSelector(nextLang);
      updateStaticTexts();
      renderPlugins();
      updatePluginSections();
    });
  } else if (languageSelector) {
    document.documentElement.lang = languageSelector.value || 'en';
  }

  if (languageSelector) {
    languageSelector.addEventListener('change', (event) => {
      const nextLang = event.target.value;
      if (window.qtilerLang) {
        window.qtilerLang.set(nextLang);
      } else {
        document.documentElement.lang = nextLang;
        updateStaticTexts();
        renderPlugins();
        updatePluginSections();
      }
    });
  }
}

async function init() {
  initLanguage();
  setupUploadForm();
  setupRefreshButton();
  try {
    await api('/auth/me');
  } catch (err) {
    if (err.code === 'auth_plugin_disabled' || err.status === 404) {
      console.log('Auth plugin not detected, installation mode enabled');
    } else if (err.message === 'auth_required' || err.status === 401) {
      window.location.href = '/login';
      return;
    }
  }
  await loadPlugins();
}

init();
