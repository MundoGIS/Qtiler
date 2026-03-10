/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

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
    confirmUninstallWmsCache: 'Uninstall {plugin}? All cache and data related to external WMS sources will be permanently deleted. Click OK to proceed.',
    confirmUninstallVectorTiles: 'Uninstall {plugin}? All generated vector-tile cache and related plugin data will be permanently deleted. Click OK to proceed.',
    successInstall: 'Plugin {plugin} installed successfully.',
    errorUpload: 'Could not upload plugin.',
    selectZip: 'Select a ZIP file.',
    plugin: 'Plugin',
    operationFailed: 'Operation failed',
    licensePrice: 'Price: {price}',
    licenseStatus: 'Status: {status}',
    licenseStatusTrial: 'Trial',
    licenseStatusActive: 'Active',
    licenseStatusExpired: 'Expired',
    licenseDaysLeft: 'Days left: {days}',
    licenseExpires: 'Expires: {date}',
    licenseExpiresSoon: 'License expires in {days} days. Contact MundoGIS (support@mundogis.se) to renew.',
    licenseRenew: 'Renew license',
    licenseAddKey: 'Add license key',
    licenseAddKeyPrompt: 'Paste license key',
    licenseActivated: 'License activated.',
    licenseActivationFailed: 'License activation failed.',
    licenseRenewSubject: 'License renewal request - {plugin}',
    licenseRenewBody: 'Hello MundoGIS,\n\nI would like to renew the license for plugin: {plugin}.\n\nCompany: <company>\nUser name: <name>\nEmail: <email>\nServer ID: {instanceId}\n\nPlease issue an invoice if needed.\n',
    licenseRenewModalTitle: 'License renewal instructions',
    licenseRenewModalIntro: 'Your server cannot open an email client. Copy the text below and send it to MundoGIS support.',
    licenseRenewModalCopy: 'Copy text',
    licenseRenewModalClose: 'Close',
    licenseInstallPrompt: 'This plugin license has expired. Paste a new license key to continue the installation.',
    licenseInstallRequired: 'A valid license is required to install this plugin. Contact MundoGIS (support@mundogis.se) to renew.',
    licenseInstallInvalid: 'This license key is not valid. Contact MundoGIS (support@mundogis.se) to renew.'
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
    confirmUninstallWmsCache: '¿Deseas desinstalar {plugin}? Se eliminarán de forma permanente la caché y los datos relacionados con las fuentes WMS externas. Haz clic en OK para continuar.',
    confirmUninstallVectorTiles: '¿Deseas desinstalar {plugin}? Se eliminarán de forma permanente la caché de vector tiles generada y los datos relacionados del plugin. Haz clic en OK para continuar.',
    successInstall: 'Plugin {plugin} instalado correctamente.',
    errorUpload: 'No se pudo subir el plugin.',
    selectZip: 'Selecciona un archivo ZIP.',
    plugin: 'Plugin',
    operationFailed: 'Operación no completada',
    licensePrice: 'Precio: {price}',
    licenseStatus: 'Estado: {status}',
    licenseStatusTrial: 'Prueba',
    licenseStatusActive: 'Activa',
    licenseStatusExpired: 'Expirada',
    licenseDaysLeft: 'Días restantes: {days}',
    licenseExpires: 'Caduca: {date}',
    licenseExpiresSoon: 'La licencia vence en {days} días. Contacta a MundoGIS (support@mundogis.se) para renovar.',
    licenseRenew: 'Renovar licencia',
    licenseAddKey: 'Agregar clave de licencia',
    licenseAddKeyPrompt: 'Pega la clave de licencia',
    licenseActivated: 'Licencia activada.',
    licenseActivationFailed: 'No se pudo activar la licencia.',
    licenseRenewSubject: 'Solicitud de renovación de licencia - {plugin}',
    licenseRenewBody: 'Hola MundoGIS,\n\nQuiero renovar la licencia del plugin: {plugin}.\n\nEmpresa: <empresa>\nNombre: <nombre>\nCorreo: <correo>\nID del servidor: {instanceId}\n\nPor favor envíen factura si es necesario.\n',
    licenseRenewModalTitle: 'Instrucciones para renovar licencia',
    licenseRenewModalIntro: 'Tu servidor no puede abrir un cliente de correo. Copia el texto y envíalo a soporte de MundoGIS.',
    licenseRenewModalCopy: 'Copiar texto',
    licenseRenewModalClose: 'Cerrar',
    licenseInstallPrompt: 'La licencia de este plugin está vencida. Pega una nueva clave de licencia para continuar la instalación.',
    licenseInstallRequired: 'Se requiere una licencia válida para instalar este plugin. Contacta a MundoGIS (support@mundogis.se) para renovar.',
    licenseInstallInvalid: 'Esta licencia no es válida. Contacta a MundoGIS (support@mundogis.se) para renovar.'
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
    confirmUninstallWmsCache: 'Avinstallera {plugin}? All cache och data relaterad till externa WMS-källor raderas permanent. Klicka på OK för att fortsätta.',
    confirmUninstallVectorTiles: 'Avinstallera {plugin}? All genererad vector tile-cache och relaterad plugindata raderas permanent. Klicka på OK för att fortsätta.',
    successInstall: 'Plugin {plugin} installerades korrekt.',
    errorUpload: 'Kunde inte ladda upp plugin.',
    selectZip: 'Välj en ZIP-fil.',
    plugin: 'Plugin',
    operationFailed: 'Operationen misslyckades',
    licensePrice: 'Pris: {price}',
    licenseStatus: 'Status: {status}',
    licenseStatusTrial: 'Provperiod',
    licenseStatusActive: 'Aktiv',
    licenseStatusExpired: 'Utgången',
    licenseDaysLeft: 'Dagar kvar: {days}',
    licenseExpires: 'Går ut: {date}',
    licenseExpiresSoon: 'Licensen går ut om {days} dagar. Kontakta MundoGIS (support@mundogis.se) för att förnya.',
    licenseRenew: 'Förnya licens',
    licenseAddKey: 'Lägg till licensnyckel',
    licenseAddKeyPrompt: 'Klistra in licensnyckel',
    licenseActivated: 'Licensen är aktiverad.',
    licenseActivationFailed: 'Licensaktivering misslyckades.',
    licenseRenewSubject: 'Begäran om licensförnyelse - {plugin}',
    licenseRenewBody: 'Hej MundoGIS,\n\nJag vill förnya licensen för plugin: {plugin}.\n\nFöretag: <företag>\nNamn: <namn>\nE-post: <e-post>\nServer-ID: {instanceId}\n\nSkicka gärna faktura vid behov.\n',
    licenseRenewModalTitle: 'Instruktioner för licensförnyelse',
    licenseRenewModalIntro: 'Servern kan inte öppna e-postklient. Kopiera texten nedan och skicka den till MundoGIS support.',
    licenseRenewModalCopy: 'Kopiera text',
    licenseRenewModalClose: 'Stäng',
    licenseInstallPrompt: 'Licensen för detta plugin har gått ut. Klistra in en ny licensnyckel för att fortsätta installationen.',
    licenseInstallRequired: 'En giltig licens krävs för att installera detta plugin. Kontakta MundoGIS (support@mundogis.se) för att förnya.',
    licenseInstallInvalid: 'Den här licensen är ogiltig. Kontakta MundoGIS (support@mundogis.se) för att förnya.'
  }
};

const state = {
  plugins: { enabled: [], installed: [], licenses: {}, instanceId: null, securityWarnings: [] }
};

const messagesEl = document.getElementById('messages');
const pluginsContainer = document.getElementById('plugins-container');
const pluginUploadForm = document.getElementById('plugin-upload-form');
const pluginSectionsContainer = document.getElementById('plugin-sections-container');
const refreshPluginsBtn = document.getElementById('refresh-plugins');
const languageSelector = document.getElementById('language_selector');
const searchableLayersSection = document.getElementById('searchable-layers-section');
const searchableLayersContainer = document.getElementById('searchable-layers-container');
const saveSearchableLayersBtn = document.getElementById('save-searchable-layers');

if (searchableLayersSection) {
  searchableLayersSection.hidden = true;
}

let activeConsolePlugin = null;

const hasSearchableUi = () => !!(searchableLayersSection && searchableLayersContainer);

const searchableState = {
  allWfsLayers: [],
  searchable: [],
  projectId: null
};
let qrigoEnabled = false;

function t(key, params = {}) {
  const lang = window.qtilerLang ? window.qtilerLang.get() : 'en';
  let text = (I18N[lang] || I18N.en)[key] || key;
  Object.entries(params).forEach(([k, v]) => {
    text = text.replace(`{${k}}`, v);
  });
  return text;
}

function formatLicenseDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const lang = window.qtilerLang ? window.qtilerLang.get() : 'en';
  const localeMap = { en: 'en-GB', es: 'es-ES', sv: 'sv-SE' };
  const locale = localeMap[lang] || 'en-GB';
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
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

function openRenewalModal(pluginName, instanceId) {
  const subject = t('licenseRenewSubject', { plugin: pluginName });
  const body = t('licenseRenewBody', { plugin: pluginName, instanceId: instanceId || '-' });
  const fullText = `${subject}\n\n${body}`;

  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.background = 'rgba(2,8,23,.72)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.padding = '16px';
  overlay.style.zIndex = '3000';

  const modal = document.createElement('div');
  modal.style.width = 'min(760px, 96vw)';
  modal.style.maxHeight = '88vh';
  modal.style.overflow = 'auto';
  modal.style.background = '#0f1729';
  modal.style.color = '#e6edf7';
  modal.style.border = '1px solid #334766';
  modal.style.borderRadius = '12px';
  modal.style.padding = '16px';

  const title = document.createElement('h3');
  title.textContent = t('licenseRenewModalTitle');
  title.style.margin = '0 0 8px 0';

  const intro = document.createElement('p');
  intro.textContent = t('licenseRenewModalIntro');
  intro.style.margin = '0 0 10px 0';
  intro.style.color = '#9fb0ca';

  const area = document.createElement('textarea');
  area.value = fullText;
  area.readOnly = true;
  area.style.width = '100%';
  area.style.minHeight = '220px';
  area.style.background = '#0b1220';
  area.style.color = '#e6edf7';
  area.style.border = '1px solid #2a3955';
  area.style.borderRadius = '8px';
  area.style.padding = '10px';

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.justifyContent = 'flex-end';
  actions.style.gap = '8px';
  actions.style.marginTop = '10px';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'button button-secondary';
  closeBtn.textContent = t('licenseRenewModalClose');

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'button';
  copyBtn.textContent = t('licenseRenewModalCopy');

  const cleanup = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') cleanup();
  };

  closeBtn.addEventListener('click', cleanup);
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) cleanup();
  });
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(fullText);
      showMessage('success', t('licenseRenewModalCopy'));
    } catch {
      area.focus();
      area.select();
      showMessage('info', t('licenseRenewModalCopy'));
    }
  });

  actions.append(copyBtn, closeBtn);
  modal.append(title, intro, area, actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);
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

  const ordered = Array.from(names).sort((a, b) => {
    if (a === 'QtilerAuth' && b !== 'QtilerAuth') return -1;
    if (b === 'QtilerAuth' && a !== 'QtilerAuth') return 1;
    return a.localeCompare(b);
  });

  ordered.forEach((name) => {
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

    const licenseDetails = document.createElement('div');
    licenseDetails.className = 'plugin-card__license';

    const actions = document.createElement('div');
    actions.className = 'plugin-card__actions';

    const licenseInfo = state.plugins.licenses?.[name] || null;
    if (licenseInfo) {
      const licenseRow = document.createElement('div');
      licenseRow.className = 'meta plugin-card__license-row';
      const price = licenseInfo.pricing
        ? `${licenseInfo.pricing.price} ${licenseInfo.pricing.currency} / ${licenseInfo.pricing.period}`
        : '';
      const daysLeft = typeof licenseInfo.daysLeft === 'number' ? licenseInfo.daysLeft : null;
      const expiresAt = licenseInfo.expiresAt || null;
      const parts = [];
      if (price) parts.push(t('licensePrice', { price }));
      if (licenseInfo.status) {
        const statusMap = {
          trial: t('licenseStatusTrial'),
          active: t('licenseStatusActive'),
          expired: t('licenseStatusExpired')
        };
        const statusLabel = statusMap[licenseInfo.status] || licenseInfo.status;
        parts.push(t('licenseStatus', { status: statusLabel }));
      }
      if (daysLeft != null) parts.push(t('licenseDaysLeft', { days: daysLeft }));
      if (expiresAt) parts.push(t('licenseExpires', { date: formatLicenseDate(expiresAt) }));
      const text = parts.join(' · ');
      licenseRow.textContent = text;
      licenseDetails.appendChild(licenseRow);

      if (daysLeft != null && daysLeft <= 30) {
        const warn = document.createElement('div');
        warn.className = 'meta plugin-card__license-warning';
        warn.textContent = t('licenseExpiresSoon', { days: daysLeft });
        licenseDetails.appendChild(warn);
      }
      if (licenseInfo.warning) {
        const legalWarn = document.createElement('div');
        legalWarn.className = 'meta plugin-card__license-warning';
        legalWarn.textContent = String(licenseInfo.warning);
        licenseDetails.appendChild(legalWarn);
      }

      const renewBtn = document.createElement('button');
      renewBtn.type = 'button';
      renewBtn.className = 'button button-secondary';
      renewBtn.textContent = t('licenseRenew');
      renewBtn.addEventListener('click', () => {
        const instanceId = state.plugins.instanceId || '';
        openRenewalModal(name, instanceId);
      });
      actions.appendChild(renewBtn);

      const addKeyBtn = document.createElement('button');
      addKeyBtn.type = 'button';
      addKeyBtn.className = 'button button-secondary';
      addKeyBtn.textContent = t('licenseAddKey');
      addKeyBtn.addEventListener('click', async () => {
        const key = window.prompt(t('licenseAddKeyPrompt'));
        if (!key) return;
        try {
          await api('/licenses/activate', {
            method: 'POST',
            body: { plugin: name, licenseKey: key }
          });
          showMessage('success', t('licenseActivated'));
          await loadPlugins();
        } catch (err) {
          showMessage('error', parseError(err, t('licenseActivationFailed')));
        }
      });
      actions.appendChild(addKeyBtn);
    }

    // Removed manual Enable/Disable buttons as per requirement.
    // Plugins are auto-enabled on install and removed on uninstall.
    
    const uninstallBtn = document.createElement('button');
    uninstallBtn.type = 'button';
    uninstallBtn.className = 'button button-danger';
    uninstallBtn.textContent = t('uninstall');
    uninstallBtn.addEventListener('click', () => uninstallPlugin(name));
    actions.appendChild(uninstallBtn);

    card.append(meta);
    if (licenseDetails.childElementCount) {
      card.append(licenseDetails);
    }
    card.append(actions);
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

  enabled.sort((a, b) => {
    if (a === 'QtilerAuth' && b !== 'QtilerAuth') return -1;
    if (b === 'QtilerAuth' && a !== 'QtilerAuth') return 1;
    return a.localeCompare(b);
  });
  if (!activeConsolePlugin || !enabled.includes(activeConsolePlugin)) {
    activeConsolePlugin = enabled[0];
  }

  const tabs = document.createElement('div');
  tabs.className = 'plugin-console-tabs';
  tabs.setAttribute('role', 'tablist');

  const panels = document.createElement('div');
  panels.className = 'plugin-console-panels';

  const setActive = (name) => {
    activeConsolePlugin = name;
    tabs.querySelectorAll('[role="tab"]').forEach((tab) => {
      const isActive = tab.dataset.plugin === name;
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.tabIndex = isActive ? 0 : -1;
    });
    panels.querySelectorAll('[role="tabpanel"]').forEach((panel) => {
      panel.hidden = panel.dataset.plugin !== name;
    });
  };

  enabled.forEach((pluginName, idx) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'plugin-console-tab';
    tab.textContent = pluginName;
    tab.dataset.plugin = pluginName;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.tabIndex = -1;
    tab.addEventListener('click', () => setActive(pluginName));
    tab.addEventListener('keydown', (event) => {
      const key = event.key;
      if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
      event.preventDefault();
      const dir = key === 'ArrowRight' ? 1 : -1;
      const nextIdx = (idx + dir + enabled.length) % enabled.length;
      const nextPlugin = enabled[nextIdx];
      setActive(nextPlugin);
      const nextTab = tabs.querySelector(`[role="tab"][data-plugin="${CSS.escape(nextPlugin)}"]`);
      nextTab?.focus();
    });
    tabs.appendChild(tab);

    const panel = document.createElement('div');
    panel.className = 'plugin-console-panel';
    panel.dataset.plugin = pluginName;
    panel.setAttribute('role', 'tabpanel');
    panel.hidden = true;

    const iframe = document.createElement('iframe');
    iframe.src = `/plugins/${encodeURIComponent(pluginName)}/admin`;
    iframe.loading = 'lazy';
    iframe.referrerPolicy = 'no-referrer';
    attachIframeAutoHeight(iframe);

    panel.append(iframe);
    panels.appendChild(panel);
  });

  pluginSectionsContainer.append(tabs, panels);
  setActive(activeConsolePlugin);
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
async function loadPlugins() {
  try {
    const payload = await api('/plugins');
    state.plugins.enabled = Array.isArray(payload?.enabled) ? payload.enabled : [];
    state.plugins.installed = Array.isArray(payload?.installed) ? payload.installed : [];
    state.plugins.licenses = payload?.licenses || {};
    state.plugins.instanceId = payload?.instanceId || null;
    state.plugins.securityWarnings = Array.isArray(payload?.securityWarnings) ? payload.securityWarnings : [];
    renderPlugins();
    updatePluginSections();
    if (state.plugins.securityWarnings.length) {
      showMessage('error', String(state.plugins.securityWarnings[0]), { sticky: true });
    }
  } catch (err) {
    const msg = String(err?.message || err || '').toLowerCase();
    if (msg.includes('failed to fetch') || msg.includes('socket') || msg.includes('network')) {
      showMessage('info', t('errorLoadPlugins'));
      setTimeout(() => {
        loadPlugins();
      }, 1200);
      return;
    }
    // If auth was enabled while this page is open, /plugins becomes admin-only.
    // Redirect to login instead of getting stuck in "installation mode".
    if (err?.status === 403) {
      window.location.href = '/login';
      return;
    }
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
  const isWmsCache = String(name || '').toLowerCase() === 'wmscache';
  const isVectorTiles = String(name || '').toLowerCase() === 'vectortiles';
  let confirmKey = 'confirmUninstall';
  if (isWmsCache) confirmKey = 'confirmUninstallWmsCache';
  if (isVectorTiles) confirmKey = 'confirmUninstallVectorTiles';
  if (!confirm(t(confirmKey, { plugin: name }))) return;
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
      // Installing the auth plugin makes /plugins admin-only.
      // Send the user to login (and then they can access the admin console again).
      window.location.href = '/login?justInstalled=1';
      return;
    } catch (err) {
      const code = err?.code;
      if (code === 'license_required' || code === 'license_expired') {
        const key = window.prompt(t('licenseInstallPrompt'));
        if (!key) {
          showMessage('error', t('licenseInstallRequired'));
          return;
        }
        if (typeof formData.set === 'function') {
          formData.set('licenseKey', key);
        } else {
          formData.append('licenseKey', key);
        }
        try {
          const retryPayload = await api('/plugins/upload', {
            method: 'POST',
            body: formData
          });
          const pluginName = retryPayload?.plugin?.name || retryPayload?.name || 'plugin';
          showMessage('success', t('successInstall', { plugin: pluginName }));
          pluginUploadForm.reset();
          window.location.href = '/login?justInstalled=1';
          return;
        } catch (retryErr) {
          const retryCode = retryErr?.code;
          if (retryCode === 'license_invalid' || retryCode === 'license_instance_mismatch' || retryCode === 'license_expired') {
            showMessage('error', t('licenseInstallInvalid'));
            return;
          }
          showMessage('error', parseError(retryErr, t('errorUpload')));
          return;
        }
      }
      if (code === 'license_invalid' || code === 'license_instance_mismatch') {
        showMessage('error', t('licenseInstallInvalid'));
        return;
      }
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
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => updateStaticTexts());
  } else {
    updateStaticTexts();
  }
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

function renderSearchableLayers() {
  if (!hasSearchableUi()) return;
  if (!qrigoEnabled) {
    if (searchableLayersSection) searchableLayersSection.hidden = true;
    return;
  }
  searchableLayersContainer.innerHTML = '';
  const { allWfsLayers, searchable } = searchableState;

  allWfsLayers.forEach(layer => {
    const config = searchable.find(s => s.name === layer.name) || {};
    const isSearchable = !!config.name;

    const layerEl = document.createElement('div');
    layerEl.className = 'searchable-layer-item';
    layerEl.dataset.layerName = layer.name;

    layerEl.innerHTML = `
      <div class="form-field form-field-checkbox">
        <input type="checkbox" id="searchable-${layer.name}" ${isSearchable ? 'checked' : ''}>
        <label for="searchable-${layer.name}">${layer.title || layer.name}</label>
      </div>
      <div class="searchable-layer-fields">
        <div class="form-field">
          <label for="fields-${layer.name}">Fields (comma-separated)</label>
          <input type="text" id="fields-${layer.name}" value="${(config.fields || []).join(', ')}" placeholder="e.g. name, type, status">
        </div>
        <div class="form-field">
          <label for="titleField-${layer.name}">Title Field</label>
          <input type="text" id="titleField-${layer.name}" value="${config.titleField || ''}" placeholder="e.g. name">
        </div>
      </div>
    `;
    searchableLayersContainer.appendChild(layerEl);
  });

  // Auto-save when toggling searchable or editing fields
  const scheduleSave = (() => {
    let timer = null;
    return () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        saveSearchableLayers();
      }, 600);
    };
  })();

  searchableLayersContainer.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    el.addEventListener('change', scheduleSave);
  });
  searchableLayersContainer.querySelectorAll('input[type="text"]').forEach((el) => {
    el.addEventListener('input', scheduleSave);
  });
}

async function resolveSearchableProjectId() {
  if (searchableState.projectId) return searchableState.projectId;
  const params = new URLSearchParams(window.location.search || '');
  const fromUrl = params.get('project');
  if (fromUrl) {
    searchableState.projectId = fromUrl;
    return searchableState.projectId;
  }
  try {
    const projectsResponse = await api('/projects');
    const projects = projectsResponse.projects || [];
    if (projects.length > 0) {
      searchableState.projectId = projects[0].id;
      return searchableState.projectId;
    }
  } catch (err) {
    console.error(err);
  }
  return null;
}

async function checkQrigoEnabled() {
  try {
    const payload = await api('/plugins');
    const enabled = Array.isArray(payload?.enabled) ? payload.enabled : [];
    qrigoEnabled = enabled.includes('Qrigo');
  } catch (err) {
    qrigoEnabled = false;
  }
  return qrigoEnabled;
}

async function loadSearchableLayers() {
  if (!hasSearchableUi()) return;
  if (!qrigoEnabled) {
    if (searchableLayersSection) searchableLayersSection.hidden = true;
    return;
  }
  const projectId = await resolveSearchableProjectId();
  if (!projectId) {
    if (searchableLayersSection) searchableLayersSection.hidden = true;
    showMessage('error', 'No project available for searchable layers.');
    return;
  }
  try {
    const [layersResponse, searchableResponse] = await Promise.all([
      api(`/projects/${projectId}/layers`),
      api(`/projects/${projectId}/searchable`)
    ]);

    const allLayers = layersResponse.layers || [];
    searchableState.allWfsLayers = allLayers.filter(l => l.type === 'WFS');
    searchableState.searchable = Array.isArray(searchableResponse) ? searchableResponse : [];

    if (searchableState.allWfsLayers.length > 0) {
      if (searchableLayersSection) searchableLayersSection.hidden = false;
      renderSearchableLayers();
    } else {
      if (searchableLayersSection) searchableLayersSection.hidden = true;
    }
  } catch (err) {
    showMessage('error', 'Failed to load layer information.');
    console.error(err);
    if (searchableLayersSection) searchableLayersSection.hidden = true;
  }
}

async function saveSearchableLayers() {
  if (!hasSearchableUi()) return;
  const projectId = await resolveSearchableProjectId();
  if (!projectId) {
    showMessage('error', 'No project selected.');
    return;
  }
  const payload = [];
  const layerItems = searchableLayersContainer.querySelectorAll('.searchable-layer-item');

  layerItems.forEach(item => {
    const layerName = item.dataset.layerName;
    const isChecked = item.querySelector('input[type="checkbox"]').checked;

    if (isChecked) {
      const fields = item.querySelector(`#fields-${layerName}`).value.split(',').map(f => f.trim()).filter(Boolean);
      const titleField = item.querySelector(`#titleField-${layerName}`).value.trim();
      if (fields.length > 0 && titleField) {
        payload.push({
          name: layerName,
          fields: fields,
          titleField: titleField
        });
      }
    }
  });

  try {
    await api(`/projects/${projectId}/searchable`, {
      method: 'POST',
      body: payload
    });
    showMessage('success', 'Searchable layers configuration saved.');
  } catch (err) {
    showMessage('error', 'Failed to save configuration.');
    console.error(err);
  }
}


async function init() {
  initLanguage();
  setupUploadForm();
  setupRefreshButton();
  if (saveSearchableLayersBtn) {
    saveSearchableLayersBtn.addEventListener('click', saveSearchableLayers);
  }
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
  await checkQrigoEnabled();
  await Promise.all([
    loadPlugins(),
    loadSearchableLayers()
  ]);
}

init();
