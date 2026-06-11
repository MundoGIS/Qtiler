/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

const statusEl = document.getElementById('public_status');
const emptyEl = document.getElementById('public_empty');
const listEl = document.getElementById('public_list');
const updatedEl = document.getElementById('portal_updated');
const sessionBadge = document.getElementById('session_badge');
const loginButtons = document.querySelectorAll('[data-portal-login]');
const logoutButton = document.getElementById('portal_logout_button');
const languageSelect = document.getElementById('language_selector');
const footerYearEl = document.getElementById('portal_year');

if (footerYearEl) {
  footerYearEl.textContent = String(new Date().getFullYear());
}

const SUPPORTED_LANGS = (window.qtilerLang && Array.isArray(window.qtilerLang.SUPPORTED_LANGS))
  ? window.qtilerLang.SUPPORTED_LANGS
  : ['en', 'es', 'sv', 'no', 'da', 'fi'];
const normalizeLang = window.qtilerLang?.normalize || ((value) => {
  const raw = String(value || '').toLowerCase();
  if (SUPPORTED_LANGS.includes(raw)) return raw;
  const base = raw.split('-')[0];
  return SUPPORTED_LANGS.includes(base) ? base : 'en';
});

let currentLang = window.qtilerLang?.get?.() || normalizeLang(localStorage.getItem('qtiler.lang') || navigator.language || 'en');
let statusState = { key: null, params: {}, text: '', tone: 'info' };
let cachedProjects = [];
let sessionUserLabel = null;
let sessionUser = null;
let lastUpdatedAt = null;

const TRANSLATIONS = {
  en: {
    'Dashboard': 'Dashboard',
    'User guide': 'User guide',
    'Language': 'Language',
    'portal.pageTitle': 'Qtiler · Public maps',
    'portal.tagline': 'WMTS services shared by MundoGIS',
    'portal.login': 'Sign in',
    'portal.logout': 'Sign out',
    'portal.intro.heading': 'Available WMTS maps',
    'portal.intro.heading.authenticated': 'Your WMTS services',
    'portal.intro.subtitle': 'Browse publicly shared projects or sign in for more options.',
    'portal.intro.subtitle.authenticated': 'These projects are available to your account.',
    'portal.empty.heading': 'No public maps yet',
    'portal.empty.detail': 'An administrator can share projects from the dashboard. Sign in to view the full console.',
    'portal.empty.button': 'Sign in',
    'portal.empty.auth.heading': 'No projects assigned yet',
    'portal.empty.auth.detail': 'Ask an administrator to share WMTS projects with your account.',
    'portal.section.cachedLayers': 'Cached layers',
    'portal.section.availableThemes': 'Available themes',
    'portal.layer.wmts': 'WMTS (GetCapabilities)',
    'portal.layer.wms': 'WMS (GetCapabilities)',
    'portal.layer.wfs': 'WFS (GetCapabilities)',
    'portal.layer.copy.wmts': 'Copy WMTS URL',
    'portal.layer.copy.wms': 'Copy WMS URL',
    'portal.layer.copy.wfs': 'Copy WFS URL',
    'portal.layer.vectortiles.viewer': 'Vector Tiles',
    'portal.layer.copy.vt.style': 'Copy VectorTiles Style-URL',
    'portal.layer.copy.vt.source': 'Copy VectorTiles Source-URL',
    'portal.section.viewers': 'Viewers',
    'portal.layer.copy.copied': '{label} URL copied to clipboard.',
    'portal.layer.copy.failed': 'Unable to copy {label} URL.',
    'portal.layer.xyz': 'XYZ (Tiles)',
    'portal.layer.xyz.copy': 'Copy XYZ URL',
    'portal.layer.xyz.copied': 'XYZ URL copied to clipboard.',
    'portal.layer.xyz.copyFailed': 'Unable to copy XYZ URL.',
    'portal.layer.noCached': 'No cached layers for this project yet.',
    'portal.layer.cacheUpdated': 'Cache updated: {timestamp}',
    'portal.meta.zoomRange': 'Zoom {min} – {max}',
    'portal.meta.zoomMin': 'Zoom ≥ {value}',
    'portal.meta.zoomMax': 'Zoom ≤ {value}',
    'portal.meta.tileCount': '{count} tiles',
    'portal.meta.tileCrs': 'Tile CRS: {crs}',
    'portal.status.loading': 'Loading public projects…',
    'portal.status.loading.assigned': 'Loading your WMTS projects…',
    'portal.status.none': 'No public projects for now.',
    'portal.status.none.assigned': 'No projects are assigned to your account.',
    'portal.status.error': 'Failed to load public projects.',
    'portal.projects.updated': 'Updated: {timestamp}',
    'portal.session.badge': 'Session: {user}',
    'portal.access.public': 'Public',
    'portal.access.assigned': 'Assigned',
    'portal.access.role': 'Role access',
    'portal.access.user': 'Shared directly',
    'portal.project.label': 'QGIS project:',
    'portal.project.expand': 'Expand',
    'portal.project.collapse': 'Collapse'
  },
  es: {
    'Dashboard': 'Panel principal',
    'User guide': 'Guía de uso',
    'Language': 'Idioma',
    'portal.pageTitle': 'Qtiler · Mapas públicos',
    'portal.tagline': 'Servicios WMTS compartidos por MundoGIS',
    'portal.login': 'Iniciar sesión',
    'portal.logout': 'Cerrar sesión',
    'portal.intro.heading': 'Mapas WMTS disponibles',
    'portal.intro.heading.authenticated': 'Tus servicios WMTS',
    'portal.intro.subtitle': 'Explora los proyectos de acceso público o inicia sesión para más opciones.',
    'portal.intro.subtitle.authenticated': 'Estos proyectos están disponibles para tu cuenta.',
    'portal.empty.heading': 'Todavía no hay mapas públicos',
    'portal.empty.detail': 'Un administrador puede compartir proyectos desde el panel. Inicia sesión para ver la consola completa.',
    'portal.empty.button': 'Iniciar sesión',
    'portal.empty.auth.heading': 'Aún no tienes proyectos asignados',
    'portal.empty.auth.detail': 'Pide a una persona administradora que comparta proyectos WMTS con tu cuenta.',
    'portal.section.cachedLayers': 'Capas en caché',
    'portal.section.availableThemes': 'Temas disponibles',
    'portal.layer.wmts': 'WMTS (GetCapabilities)',
    'portal.layer.wms': 'WMS (GetCapabilities)',
    'portal.layer.wfs': 'WFS (GetCapabilities)',
    'portal.layer.copy.wmts': 'Copiar URL WMTS',
    'portal.layer.copy.wms': 'Copiar URL WMS',
    'portal.layer.copy.wfs': 'Copiar URL WFS',
    'portal.layer.vectortiles.viewer': 'Vector Tiles',
    'portal.layer.copy.vt.style': 'Copiar URL Style VectorTiles',
    'portal.layer.copy.vt.source': 'Copiar URL Source VectorTiles',
    'portal.section.viewers': 'Visores',
    'portal.layer.copy.copied': 'URL {label} copiada al portapapeles.',
    'portal.layer.copy.failed': 'No se pudo copiar la URL {label}.',
    'portal.layer.xyz': 'XYZ (Teselas)',
    'portal.layer.xyz.copy': 'Copiar URL XYZ',
    'portal.layer.xyz.copied': 'URL XYZ copiada al portapapeles.',
    'portal.layer.xyz.copyFailed': 'No se pudo copiar la URL XYZ.',
    'portal.layer.noCached': 'Aún no hay capas cacheadas en este proyecto.',
    'portal.layer.cacheUpdated': 'Última actualización del caché: {timestamp}',
    'portal.meta.zoomRange': 'Zoom {min} – {max}',
    'portal.meta.zoomMin': 'Zoom ≥ {value}',
    'portal.meta.zoomMax': 'Zoom ≤ {value}',
    'portal.meta.tileCount': '{count} teselas',
    'portal.meta.tileCrs': 'CRS de teselas: {crs}',
    'portal.status.loading': 'Cargando proyectos públicos…',
    'portal.status.loading.assigned': 'Cargando tus proyectos WMTS…',
    'portal.status.none': 'No hay proyectos públicos por ahora.',
    'portal.status.none.assigned': 'Todavía no hay proyectos asignados a tu cuenta.',
    'portal.status.error': 'Error al cargar los proyectos públicos.',
    'portal.projects.updated': 'Actualizado: {timestamp}',
    'portal.session.badge': 'Sesión: {user}',
    'portal.access.public': 'Público',
    'portal.access.assigned': 'Asignado',
    'portal.access.role': 'Por rol',
    'portal.access.user': 'Compartido directamente',
    'portal.project.label': 'Proyecto QGIS:',
    'portal.project.expand': 'Expandir',
    'portal.project.collapse': 'Contraer'
  },
  sv: {
    'Dashboard': 'Översikt',
    'User guide': 'Användarguide',
    'Language': 'Språk',
    'portal.pageTitle': 'Qtiler · Offentliga kartor',
    'portal.tagline': 'WMTS-tjänster delade av MundoGIS',
    'portal.login': 'Logga in',
    'portal.logout': 'Logga ut',
    'portal.intro.heading': 'Tillgängliga WMTS-kartor',
    'portal.intro.heading.authenticated': 'Dina WMTS-tjänster',
    'portal.intro.subtitle': 'Utforska publika projekt eller logga in för fler alternativ.',
    'portal.intro.subtitle.authenticated': 'Dessa projekt är tillgängliga för ditt konto.',
    'portal.empty.heading': 'Inga offentliga kartor ännu',
    'portal.empty.detail': 'En administratör kan dela projekt från instrumentpanelen. Logga in för att se hela konsolen.',
    'portal.empty.button': 'Logga in',
    'portal.empty.auth.heading': 'Inga projekt tilldelade ännu',
    'portal.empty.auth.detail': 'Be en administratör att dela WMTS-projekt med ditt konto.',
    'portal.section.cachedLayers': 'Cachelagrade lager',
    'portal.section.availableThemes': 'Tillgängliga teman',
    'portal.layer.wmts': 'WMTS (GetCapabilities)',
    'portal.layer.wms': 'WMS (GetCapabilities)',
    'portal.layer.wfs': 'WFS (GetCapabilities)',
    'portal.layer.copy.wmts': 'Kopiera WMTS-URL',
    'portal.layer.copy.wms': 'Kopiera WMS-URL',
    'portal.layer.copy.wfs': 'Kopiera WFS-URL',
    'portal.layer.vectortiles.viewer': 'Vektorplattor',
    'portal.layer.copy.vt.style': 'Kopiera VectorTiles Style-URL',
    'portal.layer.copy.vt.source': 'Kopiera VectorTiles Source-URL',
    'portal.section.viewers': 'Visare',
    'portal.layer.copy.copied': '{label}-URL kopierad till urklipp.',
    'portal.layer.copy.failed': 'Det gick inte att kopiera {label}-URL.',
    'portal.layer.xyz': 'XYZ (Tiles)',
    'portal.layer.xyz.copy': 'Kopiera XYZ-URL',
    'portal.layer.xyz.copied': 'XYZ-URL kopierad till urklipp.',
    'portal.layer.xyz.copyFailed': 'Det gick inte att kopiera XYZ-URL.',
    'portal.layer.noCached': 'Inga cachelagrade lager för detta projekt ännu.',
    'portal.layer.cacheUpdated': 'Cache uppdaterad: {timestamp}',
    'portal.meta.zoomRange': 'Zoom {min} – {max}',
    'portal.meta.zoomMin': 'Zoom ≥ {value}',
    'portal.meta.zoomMax': 'Zoom ≤ {value}',
    'portal.meta.tileCount': '{count} tiles',
    'portal.meta.tileCrs': 'Tile-CRS: {crs}',
    'portal.status.loading': 'Laddar offentliga projekt…',
    'portal.status.loading.assigned': 'Laddar dina WMTS-projekt…',
    'portal.status.none': 'Inga offentliga projekt just nu.',
    'portal.status.none.assigned': 'Inga projekt är tilldelade till ditt konto.',
    'portal.status.error': 'Det gick inte att läsa in offentliga projekt.',
    'portal.projects.updated': 'Uppdaterad: {timestamp}',
    'portal.session.badge': 'Session: {user}',
    'portal.access.public': 'Offentlig',
    'portal.access.assigned': 'Tilldelad',
    'portal.access.role': 'Rollåtkomst',
    'portal.access.user': 'Delad direkt',
    'portal.project.label': 'QGIS-projekt:',
    'portal.project.expand': 'Visa mer',
    'portal.project.collapse': 'Dölj'
  },
  no: {
    'Dashboard': 'Oversikt',
    'User guide': 'Brukerveiledning',
    'Language': 'Språk',
    'portal.pageTitle': 'Qtiler · Offentlige kart',
    'portal.tagline': 'WMTS-tjenester delt av MundoGIS',
    'portal.login': 'Logg inn',
    'portal.logout': 'Logg ut',
    'portal.intro.heading': 'Tilgjengelige WMTS-kart',
    'portal.intro.heading.authenticated': 'Dine WMTS-tjenester',
    'portal.intro.subtitle': 'Utforsk offentlig delte prosjekter eller logg inn for flere alternativer.',
    'portal.intro.subtitle.authenticated': 'Disse prosjektene er tilgjengelige for kontoen din.',
    'portal.empty.heading': 'Ingen offentlige kart ennå',
    'portal.empty.detail': 'En administrator kan dele prosjekter fra dashboardet. Logg inn for å se hele konsollen.',
    'portal.empty.button': 'Logg inn',
    'portal.empty.auth.heading': 'Ingen prosjekter tildelt ennå',
    'portal.empty.auth.detail': 'Be en administrator om å dele WMTS-prosjekter med kontoen din.',
    'portal.section.cachedLayers': 'Bufrede lag',
    'portal.section.availableThemes': 'Tilgjengelige temaer',
    'portal.layer.wmts': 'WMTS (GetCapabilities)',
    'portal.layer.wms': 'WMS (GetCapabilities)',
    'portal.layer.wfs': 'WFS (GetCapabilities)',
    'portal.layer.copy.wmts': 'Kopier WMTS-URL',
    'portal.layer.copy.wms': 'Kopier WMS-URL',
    'portal.layer.copy.wfs': 'Kopier WFS-URL',
    'portal.layer.vectortiles.viewer': 'Vektorfliser',
    'portal.layer.copy.vt.style': 'Kopier VectorTiles Style-URL',
    'portal.layer.copy.vt.source': 'Kopier VectorTiles Source-URL',
    'portal.section.viewers': 'Visere',
    'portal.layer.copy.copied': '{label}-URL kopiert til utklippstavlen.',
    'portal.layer.copy.failed': 'Kunne ikke kopiere {label}-URL.',
    'portal.layer.xyz': 'XYZ (Tiles)',
    'portal.layer.xyz.copy': 'Kopier XYZ-URL',
    'portal.layer.xyz.copied': 'XYZ-URL kopiert til utklippstavlen.',
    'portal.layer.xyz.copyFailed': 'Kunne ikke kopiere XYZ-URL.',
    'portal.layer.noCached': 'Ingen bufrede lag for dette prosjektet ennå.',
    'portal.layer.cacheUpdated': 'Bufret oppdatert: {timestamp}',
    'portal.meta.zoomRange': 'Zoom {min} – {max}',
    'portal.meta.zoomMin': 'Zoom ≥ {value}',
    'portal.meta.zoomMax': 'Zoom ≤ {value}',
    'portal.meta.tileCount': '{count} tiles',
    'portal.meta.tileCrs': 'Tile-CRS: {crs}',
    'portal.status.loading': 'Laster offentlige prosjekter…',
    'portal.status.loading.assigned': 'Laster dine WMTS-prosjekter…',
    'portal.status.none': 'Ingen offentlige prosjekter akkurat nå.',
    'portal.status.none.assigned': 'Ingen prosjekter er tildelt kontoen din.',
    'portal.status.error': 'Kunne ikke laste offentlige prosjekter.',
    'portal.projects.updated': 'Oppdatert: {timestamp}',
    'portal.session.badge': 'Sesjon: {user}',
    'portal.access.public': 'Offentlig',
    'portal.access.assigned': 'Tildelt',
    'portal.access.role': 'Rolletilgang',
    'portal.access.user': 'Delt direkte',
    'portal.project.label': 'QGIS-prosjekt:',
    'portal.project.expand': 'Utvid',
    'portal.project.collapse': 'Skjul'
  },
  da: {},
  fi: {}
};

TRANSLATIONS.da = Object.assign({}, TRANSLATIONS.sv, {
  'Dashboard': 'Oversigt',
  'User guide': 'Brugervejledning',
  'Language': 'Sprog',
  'portal.pageTitle': 'Qtiler · Offentlige kort',
  'portal.login': 'Log ind',
  'portal.logout': 'Log ud'
});
TRANSLATIONS.fi = Object.assign({}, TRANSLATIONS.en, {
  'Dashboard': 'Yleiskuva',
  'User guide': 'Käyttöopas',
  'Language': 'Kieli',
  'portal.pageTitle': 'Qtiler · Julkiset kartat',
  'portal.login': 'Kirjaudu sisään',
  'portal.logout': 'Kirjaudu ulos'
});

const tr = (key, params = {}) => {
  if (!key) return '';
  const table = TRANSLATIONS[currentLang] || {};
  const fallback = TRANSLATIONS.en && TRANSLATIONS.en[key];
  const template = table[key] ?? fallback ?? key;
  return template.replace(/\{(\w+)\}/g, (_, token) => {
    if (token in params) return params[token];
    if (token === 'count' && typeof params.count === 'number') {
      try {
        return new Intl.NumberFormat(currentLang).format(params.count);
      } catch {
        return String(params.count);
      }
    }
    return '';
  });
};

const formatNumber = (value) => {
  if (!Number.isFinite(value)) return null;
  try {
    return new Intl.NumberFormat(currentLang).format(value);
  } catch {
    return String(value);
  }
};

const formatDateTime = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(currentLang, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  } catch {
    return date.toLocaleString();
  }
};

const formatZoomRange = (entry) => {
  const min = Number.isFinite(entry?.zoom_min) ? entry.zoom_min : null;
  const max = Number.isFinite(entry?.zoom_max) ? entry.zoom_max : null;
  if (min != null && max != null) return tr('portal.meta.zoomRange', { min, max });
  if (min != null) return tr('portal.meta.zoomMin', { value: min });
  if (max != null) return tr('portal.meta.zoomMax', { value: max });
  return null;
};

const formatTileCount = (entry) => {
  if (!Number.isFinite(entry?.tile_count)) return null;
  return tr('portal.meta.tileCount', { count: entry.tile_count });
};

const renderStatus = () => {
  if (!statusEl) return;
  let message = '';
  if (statusState.key) {
    message = tr(statusState.key, statusState.params || {});
  } else if (statusState.text) {
    message = statusState.text;
  }
  statusEl.textContent = message;
  statusEl.dataset.tone = statusState.tone || 'info';
};

const renderUpdated = () => {
  if (!updatedEl) return;
  if (!lastUpdatedAt) {
    updatedEl.textContent = '';
    updatedEl.hidden = true;
    return;
  }
  const label = formatDateTime(lastUpdatedAt);
  updatedEl.textContent = label ? tr('portal.projects.updated', { timestamp: label }) : '';
  updatedEl.hidden = !label;
};

const showStatus = (key, { params = {}, tone = 'info' } = {}) => {
  statusState = { key, params, text: '', tone };
  renderStatus();
};

const showStatusText = (text, { tone = 'info' } = {}) => {
  statusState = { key: null, params: {}, text, tone };
  renderStatus();
};

const flashStatusText = (text, { tone = 'info', ttlMs = 2500 } = {}) => {
  showStatusText(text, { tone });
  if (Number.isFinite(ttlMs) && ttlMs > 0) {
    setTimeout(() => {
      if (statusState.text === text) {
        clearStatus();
      }
    }, ttlMs);
  }
};

const copyToClipboard = async (text) => {
  const value = String(text || '');
  if (!value) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fallback below
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.left = '-1000px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
};

// Append api_key query param to a URL when the user is logged in with an apiKey
// and the project is not public (public projects don't need authentication).
const withApiKey = (url, isPublic) => {
  if (!url) return url;
  if (!sessionUser || !sessionUser.apiKey) return url;
  if (isPublic) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}api_key=${encodeURIComponent(sessionUser.apiKey)}`;
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

const clearStatus = () => {
  statusState = { key: null, params: {}, text: '', tone: 'info' };
  renderStatus();
};

const renderLayerGroup = (titleKey, items, isPublic) => {
  if (!items || !items.length) return null;
  const container = document.createElement('div');
  container.className = 'portal-layer-group';

  const heading = document.createElement('h4');
  heading.textContent = tr(titleKey);
  container.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'portal-layer-list';

  for (const item of items) {
    const entry = document.createElement('div');
    entry.className = 'portal-layer-item';

    const head = document.createElement('div');
    head.className = 'portal-layer-head';

    const nameEl = document.createElement('div');
    nameEl.className = 'portal-layer-name';
    nameEl.textContent = item.title || item.displayName || item.name;
    head.appendChild(nameEl);

    const actions = document.createElement('div');
    actions.className = 'portal-layer-actions';

    const isTheme = item && item.kind === 'theme';
    const isWfsCapable = !isTheme && (() => {
      if (!item) return false;
      const typeToken = String(item.type || '').toUpperCase();
      if (typeToken === 'WFS') return true;
      if (item.kind === 'vector' || item.kind === 'VectorLayer') return true;
      if (item.geometry_type) return true;
      return false;
    })();

    const projectIdEnc = encodeURIComponent(item.projectId);
    const nameEnc = encodeURIComponent(item.name);
    const xyzPath = item.kind === 'theme'
      ? `/wmts/${projectIdEnc}/themes/${nameEnc}/{z}/{x}/{y}.png`
      : `/wmts/${projectIdEnc}/${nameEnc}/{z}/{x}/{y}.png`;
    const xyzUrl = withApiKey(`${window.location.origin}${xyzPath}`, isPublic);
    const rawTileCrs = item.tile_crs || item.tileCrs || item.crs || null;
    const xyzEnabled = item.xyz_enabled === true
      || item.xyzEnabled === true
      || ((item.xyz_enabled !== false && item.xyzEnabled !== false) && isXyzCompatibleCrs(rawTileCrs));

    const layerParam = item.kind === 'theme' ? 'theme' : 'layer';
    const wmtsCapabilitiesUrl = withApiKey(`${window.location.origin}/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&project=${encodeURIComponent(item.projectId)}&${layerParam}=${encodeURIComponent(item.name)}`, isPublic);
    const wmsLayerParam = item.kind === 'theme' ? 'THEME' : 'layer';
    const wmsCapabilitiesUrl = withApiKey(`${window.location.origin}/wms?SERVICE=WMS&REQUEST=GetCapabilities&project=${encodeURIComponent(item.projectId)}&${wmsLayerParam}=${encodeURIComponent(item.name)}`, isPublic);
    const wfsCapabilitiesUrl = withApiKey(`${window.location.origin}/wfs/${projectIdEnc}/${nameEnc}?SERVICE=WFS&REQUEST=GetCapabilities`, isPublic);

    const viewerBase = withApiKey(`/viewer.html?project=${encodeURIComponent(item.projectId)}&${layerParam}=${encodeURIComponent(item.name)}`, isPublic);
    const viewerWms = withApiKey(`/viewer.html?project=${encodeURIComponent(item.projectId)}&${layerParam}=${encodeURIComponent(item.name)}&service=wms`, isPublic);
    const viewerWfs = withApiKey(`/viewer.html?project=${encodeURIComponent(item.projectId)}&${layerParam}=${encodeURIComponent(item.name)}&service=wfs`, isPublic);

    // --- Viewers sub-section ---
    const viewersFieldset = document.createElement('fieldset');
    viewersFieldset.className = 'portal-viewers-box portal-viewers-box--inline';
    const viewersLeg = document.createElement('legend');
    viewersLeg.textContent = tr('portal.section.viewers');
    viewersFieldset.appendChild(viewersLeg);
    const viewersInner = document.createElement('div');
    viewersInner.className = 'portal-viewers-row';

    const mkLayerViewer = (href, label) => {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.className = 'portal-action-icon';
      a.textContent = label;
      return a;
    };

    viewersInner.appendChild(mkLayerViewer(viewerBase, 'WMTS'));
    viewersInner.appendChild(mkLayerViewer(viewerWms, 'WMS'));
    if (isWfsCapable) {
      viewersInner.appendChild(mkLayerViewer(viewerWfs, 'WFS'));
    }
    viewersFieldset.appendChild(viewersInner);
    actions.appendChild(viewersFieldset);

    // --- Copy URL buttons ---
    if (!sessionUser && xyzEnabled) {
      const copyXyzBtn = document.createElement('button');
      copyXyzBtn.type = 'button';
      copyXyzBtn.className = 'portal-action-button';
      copyXyzBtn.textContent = tr('portal.layer.xyz.copy');
      copyXyzBtn.addEventListener('click', async () => {
        const ok = await copyToClipboard(xyzUrl);
        flashStatusText(tr(ok ? 'portal.layer.xyz.copied' : 'portal.layer.xyz.copyFailed'), { tone: ok ? 'info' : 'error' });
      });
      actions.appendChild(copyXyzBtn);
    }

    const copyWmtsBtn = document.createElement('button');
    copyWmtsBtn.type = 'button';
    copyWmtsBtn.className = 'portal-action-button';
    copyWmtsBtn.textContent = tr('portal.layer.copy.wmts');
    copyWmtsBtn.addEventListener('click', async () => {
      const ok = await copyToClipboard(wmtsCapabilitiesUrl);
      flashStatusText(tr(ok ? 'portal.layer.copy.copied' : 'portal.layer.copy.failed', { label: 'WMTS' }), { tone: ok ? 'info' : 'error' });
    });
    actions.appendChild(copyWmtsBtn);

    const copyWmsBtn = document.createElement('button');
    copyWmsBtn.type = 'button';
    copyWmsBtn.className = 'portal-action-button';
    copyWmsBtn.textContent = tr('portal.layer.copy.wms');
    copyWmsBtn.addEventListener('click', async () => {
      const ok = await copyToClipboard(wmsCapabilitiesUrl);
      flashStatusText(tr(ok ? 'portal.layer.copy.copied' : 'portal.layer.copy.failed', { label: 'WMS' }), { tone: ok ? 'info' : 'error' });
    });
    actions.appendChild(copyWmsBtn);

    if (isWfsCapable) {
      const copyWfsBtn = document.createElement('button');
      copyWfsBtn.type = 'button';
      copyWfsBtn.className = 'portal-action-button';
      copyWfsBtn.textContent = tr('portal.layer.copy.wfs');
      copyWfsBtn.addEventListener('click', async () => {
        const ok = await copyToClipboard(wfsCapabilitiesUrl);
        flashStatusText(tr(ok ? 'portal.layer.copy.copied' : 'portal.layer.copy.failed', { label: 'WFS' }), { tone: ok ? 'info' : 'error' });
      });
      actions.appendChild(copyWfsBtn);
    }

    head.appendChild(actions);
    entry.appendChild(head);

    const metaLines = [];
    const zoomLabel = formatZoomRange(item);
    if (zoomLabel) metaLines.push(zoomLabel);
    const tileCountLabel = formatTileCount(item);
    if (tileCountLabel) metaLines.push(tileCountLabel);
    const updatedLabel = formatDateTime(item.updated_at || item.generated_at || item.cached_at || item.last_generated_at || item.last_run_at || item.lastRunAt || item.last_cache || item.last_cached_at);
    if (updatedLabel) {
      metaLines.push(tr('portal.layer.cacheUpdated', { timestamp: updatedLabel }));
    }
    if (item.tile_crs) metaLines.push(tr('portal.meta.tileCrs', { crs: item.tile_crs }));

    if (metaLines.length) {
      const meta = document.createElement('div');
      meta.className = 'portal-layer-meta';
      meta.textContent = metaLines.join(' · ');
      entry.appendChild(meta);
    }

    list.appendChild(entry);
  }

  container.appendChild(list);
  return container;
};

const renderSessionBadge = () => {
  if (!sessionBadge) return;
  if (!sessionUserLabel) {
    sessionBadge.hidden = true;
    sessionBadge.textContent = '';
    return;
  }
  sessionBadge.hidden = false;
  sessionBadge.textContent = tr('portal.session.badge', { user: sessionUserLabel });
};

const renderAuthUi = () => {
  const loggedIn = !!sessionUser;
  loginButtons.forEach((btn) => {
    if (!btn) return;
    btn.hidden = loggedIn;
    btn.style.display = loggedIn ? 'none' : 'inline-block';
  });
  if (logoutButton) {
    logoutButton.hidden = !loggedIn;
    logoutButton.style.display = loggedIn ? 'inline-block' : 'none';
    logoutButton.disabled = false;
  }
  
  const adminLink = document.getElementById('portal_admin_link');
  if (adminLink) {
    const isAdmin = sessionUser && sessionUser.role === 'admin';
    adminLink.hidden = !isAdmin;
    adminLink.style.display = isAdmin ? 'inline-block' : 'none';
  }
  
  renderSessionBadge();
};

const renderProjects = (projects) => {
  cachedProjects = Array.isArray(projects) ? projects : [];
  const emptyHeading = emptyEl?.querySelector('[data-i18n="portal.empty.heading"]');
  const emptyDetail = emptyEl?.querySelector('[data-i18n="portal.empty.detail"]');
  const emptyLogin = emptyEl?.querySelector('[data-portal-login]');
  if (!projects || projects.length === 0) {
    listEl.hidden = true;
    emptyEl.hidden = false;
    if (emptyHeading) {
      emptyHeading.textContent = tr(sessionUser ? 'portal.empty.auth.heading' : 'portal.empty.heading');
    }
    if (emptyDetail) {
      emptyDetail.textContent = tr(sessionUser ? 'portal.empty.auth.detail' : 'portal.empty.detail');
    }
    if (emptyLogin) {
      emptyLogin.hidden = !!sessionUser;
    }
    return;
  }
  if (emptyLogin) {
    emptyLogin.hidden = !!sessionUser;
  }
  emptyEl.hidden = true;
  listEl.hidden = false;
  listEl.innerHTML = '';

  for (const project of projects) {
    const card = document.createElement('article');
    card.className = 'portal-card';

    const collapsedByDefault = true;
    if (collapsedByDefault) {
      card.classList.add('portal-card--collapsed');
    }

    const header = document.createElement('header');
    const label = document.createElement('span');
    label.className = 'portal-project-label';
    label.textContent = tr('portal.project.label');
    header.appendChild(label);
    const title = document.createElement('h3');
    title.textContent = project.title || project.name || project.id;
    header.appendChild(title);
    if (project.summary) {
      const summary = document.createElement('p');
      summary.textContent = project.summary;
      header.appendChild(summary);
    }
    const accessInfo = project.access || {};
    const badges = [];
    if (accessInfo.public) badges.push(tr('portal.access.public'));
    if (accessInfo.viaAssignment) badges.push(tr('portal.access.assigned'));
    if (accessInfo.viaRole) badges.push(tr('portal.access.role'));
    if (accessInfo.viaUser) badges.push(tr('portal.access.user'));
    if (badges.length) {
      const badgesLine = document.createElement('p');
      badgesLine.className = 'portal-layer-meta';
      badgesLine.textContent = badges.join(' · ');
      header.appendChild(badgesLine);
    }

    const body = document.createElement('div');
    body.className = 'portal-card-body';
    if (collapsedByDefault) {
      body.hidden = true;
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'portal-collapse-toggle';
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.textContent = tr('portal.project.expand');
      toggleBtn.addEventListener('click', () => {
        const isCollapsed = card.classList.toggle('portal-card--collapsed');
        body.hidden = isCollapsed;
        toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
        toggleBtn.textContent = tr(isCollapsed ? 'portal.project.expand' : 'portal.project.collapse');
      });
      header.appendChild(toggleBtn);
    }
    card.appendChild(header);

    const links = document.createElement('div');
    links.className = 'portal-links';
    const toAbsoluteUrl = (url) => {
      if (!url) return url;
      if (/^https?:\/\//i.test(url)) return url;
      if (url.startsWith('//')) return `${window.location.protocol}${url}`;
      if (url.startsWith('/')) return `${window.location.origin}${url}`;
      return `${window.location.origin}/${url}`;
    };
    const projectIdEnc = encodeURIComponent(project.id);
    const isPublicProject = !!(accessInfo.public);
    const projectWmtsUrl = withApiKey(toAbsoluteUrl(project.wmtsUrl) || `${window.location.origin}/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&project=${projectIdEnc}`, isPublicProject);
    const projectWmsUrl = withApiKey(toAbsoluteUrl(project.wmsUrl) || `${window.location.origin}/wms?SERVICE=WMS&REQUEST=GetCapabilities&project=${projectIdEnc}`, isPublicProject);
    const projectWfsUrl = withApiKey(toAbsoluteUrl(project.wfsUrl) || `${window.location.origin}/wfs?SERVICE=WFS&REQUEST=GetCapabilities&project=${projectIdEnc}`, isPublicProject);

    const projectLayers = Array.isArray(project.layers) ? project.layers : [];
    const projectHasVector = projectLayers.some((layer) => {
      if (!layer) return false;
      const typeToken = String(layer.type || '').toUpperCase();
      if (typeToken === 'WFS') return true;
      if (layer.kind === 'vector' || layer.kind === 'VectorLayer') return true;
      if (layer.geometry_type) return true;
      return false;
    });

    const copyProjectBtn = (key, url, label) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'portal-action-button';
      btn.textContent = tr(key);
      btn.addEventListener('click', async () => {
        const ok = await copyToClipboard(url);
        flashStatusText(tr(ok ? 'portal.layer.copy.copied' : 'portal.layer.copy.failed', { label }), { tone: ok ? 'info' : 'error' });
      });
      return btn;
    };

    // --- Copy URLs ---
    links.appendChild(copyProjectBtn('portal.layer.copy.wmts', projectWmtsUrl, 'WMTS'));
    links.appendChild(copyProjectBtn('portal.layer.copy.wms', projectWmsUrl, 'WMS'));
    if (projectHasVector || !!project.wfsUrl) {
      links.appendChild(copyProjectBtn('portal.layer.copy.wfs', projectWfsUrl, 'WFS'));
    }
    if (projectHasVector) {
      const vtStyleUrl = withApiKey(`${window.location.origin}/plugins/VectorTiles/style/${projectIdEnc}.json`, isPublicProject);
      const vtSourceUrl = withApiKey(`${window.location.origin}/plugins/VectorTiles/tiles/${projectIdEnc}/{z}/{x}/{y}.pbf`, isPublicProject);
      links.appendChild(copyProjectBtn('portal.layer.copy.vt.style', vtStyleUrl, 'VectorTiles Style'));
      links.appendChild(copyProjectBtn('portal.layer.copy.vt.source', vtSourceUrl, 'VectorTiles Source'));
    }

    const cacheUpdatedLabel = formatDateTime(project.cacheUpdatedAt);
    if (cacheUpdatedLabel) {
      const updateInfo = document.createElement('span');
      updateInfo.className = 'portal-layer-meta';
      updateInfo.textContent = tr('portal.layer.cacheUpdated', { timestamp: cacheUpdatedLabel });
      links.appendChild(updateInfo);
    }
    body.appendChild(links);

    const layerGroup = renderLayerGroup('portal.section.cachedLayers', Array.isArray(project.layers) ? project.layers : [], isPublicProject);
    if (layerGroup) {
      body.appendChild(layerGroup);
    } else {
      const placeholder = document.createElement('p');
      placeholder.className = 'portal-layer-meta';
      placeholder.textContent = tr('portal.layer.noCached');
      body.appendChild(placeholder);
    }

  const themeGroup = renderLayerGroup('portal.section.availableThemes', Array.isArray(project.themes) ? project.themes : [], isPublicProject);
    if (themeGroup) {
      body.appendChild(themeGroup);
    }

    card.appendChild(body);

    listEl.appendChild(card);
  }

  collapseAllProjectCards();
};

const collapseAllProjectCards = () => {
  document.querySelectorAll('.portal-card').forEach((card) => {
    card.classList.add('portal-card--collapsed');
    const body = card.querySelector('.portal-card-body');
    if (body) body.hidden = true;
    const toggleBtn = card.querySelector('.portal-collapse-toggle');
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.textContent = tr('portal.project.expand');
    }
  });
};

const applyStaticTranslations = () => {
  if (document?.documentElement) {
    document.documentElement.setAttribute('lang', currentLang);
  }
  const pageTitle = document.querySelector('title[data-i18n="portal.pageTitle"]');
  if (pageTitle) pageTitle.textContent = tr('portal.pageTitle');
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    let resolvedKey = key;
    if (sessionUser) {
      if (key === 'portal.intro.heading') resolvedKey = 'portal.intro.heading.authenticated';
      else if (key === 'portal.intro.subtitle') resolvedKey = 'portal.intro.subtitle.authenticated';
      else if (key === 'portal.empty.heading') resolvedKey = 'portal.empty.auth.heading';
      else if (key === 'portal.empty.detail') resolvedKey = 'portal.empty.auth.detail';
    }
    el.textContent = tr(resolvedKey);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (!key) return;
    el.placeholder = tr(key);
  });
  if (languageSelect) {
    languageSelect.value = currentLang;
  }
  renderStatus();
  renderUpdated();
  renderAuthUi();
  renderProjects(cachedProjects);
  collapseAllProjectCards();
};

const loadPublicProjects = async () => {
  showStatus('portal.status.loading');
  try {
    const response = await fetch('/public/projects');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    const projects = Array.isArray(payload?.projects) ? payload.projects : [];
    renderProjects(projects);
    if (!projects.length) {
      showStatus('portal.status.none');
      lastUpdatedAt = null;
      renderUpdated();
    } else {
      clearStatus();
      lastUpdatedAt = new Date().toISOString();
      renderUpdated();
    }
  } catch (err) {
    console.error('Failed to load public projects', err);
    showStatus('portal.status.error', { tone: 'error' });
    emptyEl.hidden = false;
    lastUpdatedAt = null;
    renderUpdated();
  }
};

const loadUserProjects = async () => {
  showStatus('portal.status.loading.assigned');
  try {
    const response = await fetch('/public/my-projects', { credentials: 'include' });
    if (response.status === 401 || response.status === 403) {
      sessionUser = null;
      sessionUserLabel = null;
      renderAuthUi();
      cachedProjects = [];
      applyStaticTranslations();
      await loadPublicProjects();
      return;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    const projects = Array.isArray(payload?.projects) ? payload.projects : [];
    renderProjects(projects);
    if (!projects.length) {
      showStatus('portal.status.none.assigned');
      lastUpdatedAt = null;
      renderUpdated();
    } else {
      clearStatus();
      lastUpdatedAt = new Date().toISOString();
      renderUpdated();
    }
  } catch (err) {
    console.error('Failed to load user projects', err);
    showStatus('portal.status.error', { tone: 'error' });
    emptyEl.hidden = false;
    lastUpdatedAt = null;
    renderUpdated();
  }
};

const checkSession = async () => {
  try {
    const response = await fetch('/auth/me', { credentials: 'include' });
    if (!response.ok) {
      sessionUser = null;
      sessionUserLabel = null;
      renderAuthUi();
      return null;
    }
    const payload = await response.json().catch(() => null);
    const user = payload?.user || null;
    if (!user) {
      sessionUser = null;
      sessionUserLabel = null;
      renderAuthUi();
      return null;
    }
    if (user.role === 'admin') {
      // Admin should be on dashboard, but if they are here, show logout
      sessionUser = user;
      sessionUserLabel = user.username || user.displayName || user.id || 'user';
      renderAuthUi();
      return user;
    }
    sessionUser = user;
    sessionUserLabel = user.username || user.displayName || user.id || 'user';
    renderAuthUi();
    return user;
  } catch (err) {
    sessionUser = null;
    sessionUserLabel = null;
    renderAuthUi();
    return null;
  }
};

const handleLogout = async () => {
  if (!logoutButton) return;
  logoutButton.disabled = true;
  try {
    await fetch('/auth/logout', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (err) {
    console.error('Logout request failed', err);
  }
  sessionUser = null;
  sessionUserLabel = null;
  renderAuthUi();
  window.location.replace(`/login?loggedOut=1&_cb=${Date.now()}`);
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
  applyStaticTranslations();
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
    applyStaticTranslations();
  });
}

applyStaticTranslations();

if (logoutButton) {
  logoutButton.addEventListener('click', () => {
    handleLogout().catch((err) => console.error('Logout failed', err));
  });
}

const bootstrap = async () => {
  const user = await checkSession();
  applyStaticTranslations();
  if (user) {
    await loadUserProjects();
  } else {
    await loadPublicProjects();
  }
};

bootstrap();

// If page is restored from back/forward cache, reload to refresh auth/session state.
window.addEventListener('pageshow', (event) => {
  try {
    if (event && event.persisted) {
      console.log('pageshow persisted (portal) - reloading to refresh auth state');
      window.location.reload();
    }
  } catch (e) {}
});

// Clicking the brand/logo should perform a full reload to avoid showing cached auth UI.
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
