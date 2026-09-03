/*
 * Qtiler Stories — admin UI.
 * Portal/CMS editor: pages, blocks, site identity, GDPR, backup/restore.
 * Maps come from Qtiler2Origo, Qtiler2Hajk and Qtiler 3D Eye via the
 * aggregated /plugins/QtilerStories/api/maps endpoint.
 */

/* ── Modal scroll lock ── */
(function setupModalScrollLock() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const sync = () => {
    const modalOpen = !!document.querySelector('.modal.is-active');
    document.documentElement.classList.toggle('is-clipped', modalOpen);
    document.documentElement.style.overflow = modalOpen ? 'hidden' : '';
    document.body.style.overflow = modalOpen ? 'hidden' : '';
    document.body.classList.toggle('modal-open', modalOpen);
  };
  const obs = new MutationObserver(sync);
  document.addEventListener('DOMContentLoaded', () => {
    obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class', 'hidden'] });
    sync();
  });
})();

/* ── i18n ── */
const QTWC_I18N = {
  en: {
    'QtilerStories.title': 'Qtiler Stories',
    'QtilerStories.subtitle': 'Build public story portals combining maps from Origo, Hajk and 3D Eye.',
    'QtilerStories.open_portal': 'Open portal ↗',
    'QtilerStories.tab_portal': 'Portal',
    'QtilerStories.tab_maps': 'Maps',
    'QtilerStories.tab_log': 'Log',
    'QtilerStories.maps_section': 'Available maps',
    'QtilerStories.maps_desc': 'All published maps from Qtiler2Origo, Qtiler2Hajk and Qtiler 3D Eye. Use these in your portal pages.',
    'QtilerStories.no_maps': 'No published maps found. Publish maps in Qtiler2Origo, Qtiler2Hajk or Qtiler 3D Eye first.',
    'QtilerStories.portal_section': 'Portal pages',
    'QtilerStories.portal_desc': 'Create editorial landing pages for the public maps portal, with sections, featured maps and audience rules.',
    'QtilerStories.portal_add_page': 'New page',
    'QtilerStories.portal_duplicate_page': 'Duplicate page',
    'QtilerStories.portal_fullscreen': 'Fullscreen editor',
    'QtilerStories.portal_open_page': 'Open page',
    'QtilerStories.portal_backup_title': 'Export / import portal backup',
    'QtilerStories.portal_backup_pages': 'Portal pages to export',
    'QtilerStories.portal_backup_maps': 'Published maps to export',
    'QtilerStories.portal_backup_export': 'Export JSON',
    'QtilerStories.portal_backup_import': 'Import / restore JSON',
    'QtilerStories.portal_backup_replace_portal': 'Replace portal pages',
    'QtilerStories.portal_backup_help': 'The backup JSON includes selected portal content and referenced published map entries. It does not include tile caches or QGIS project files.',
    'QtilerStories.portal_pages_list': 'Your Pages',
    'QtilerStories.portal_save': 'Save portal',
    'QtilerStories.portal_empty': 'Create the first page to turn the maps portal into an editorial landing page.',
    'QtilerStories.portal_templates': 'Page Templates',
    'QtilerStories.portal_templates_help': 'Start from a polished layout and adapt.',
    'QtilerStories.portal_apply_template': 'Apply template',
    'QtilerStories.portal_blocks': 'Story Sections',
    'QtilerStories.portal_blocks_help': 'Combine hero, text, maps and news sections.',
    'QtilerStories.portal_add_block': 'Add Section',
    'QtilerStories.portal_page_title': 'Page title',
    'QtilerStories.portal_page_slug': 'Slug (URL path)',
    'QtilerStories.portal_page_nav': 'Navigation label',
    'QtilerStories.portal_page_summary': 'Short summary',
    'QtilerStories.portal_header_logo': 'Header logo URL',
    'QtilerStories.portal_header_height': 'Header height (px)',
    'QtilerStories.portal_show_in_nav': 'Show in navigation menu',
    'QtilerStories.portal_set_home': 'Use as default portal homepage',
    'QtilerStories.portal_show_header': 'Show navigation header',
    'QtilerStories.portal_visibility': 'Page visibility',
    'QtilerStories.portal_vis_public': 'Public',
    'QtilerStories.portal_vis_authenticated': 'Authenticated users',
    'QtilerStories.portal_vis_restricted': 'Specific users / roles',
    'QtilerStories.portal_users': 'Allowed users',
    'QtilerStories.portal_roles': 'Allowed roles',
    'QtilerStories.portal_preview': 'Live Preview',
    'QtilerStories.portal_preview_note': 'Desktop view',
    'QtilerStories.portal_device_desktop': 'Desktop',
    'QtilerStories.portal_device_tablet': 'Tablet',
    'QtilerStories.portal_device_mobile': 'Mobile',
    'QtilerStories.portal_no_blocks_preview': 'Add a section to see the preview.',
    'QtilerStories.portal_map_display_open': 'Open map',
    'QtilerStories.activity_log': 'Activity log',
    'QtilerStories.clear': 'Clear',
    'QtilerStories.no_activity': 'No activity yet.',
    'QtilerStories.log_saved': 'Portal saved.',
    'QtilerStories.log_error': 'Error: {msg}',
    'QtilerStories.portal_backup_exported': 'Portal backup exported.',
    'QtilerStories.portal_backup_imported': 'Portal backup imported ({n} pages).',
    'QtilerStories.delete_page_confirm': 'Delete this page?',
    'QtilerStories.duplicate': 'Duplicate',
    'QtilerStories.delete': 'Delete',
    'QtilerStories.move_up': 'Move up',
    'QtilerStories.move_down': 'Move down',
    'QtilerStories.remove': 'Remove',
    'QtilerStories.loading': 'Loading...'
  },
  es: {
    'QtilerStories.title': 'Qtiler Stories',
    'QtilerStories.subtitle': 'Crea portales de historias públicos combinando mapas de Origo, Hajk y 3D Eye.',
    'QtilerStories.open_portal': 'Abrir portal ↗',
    'QtilerStories.tab_portal': 'Portal',
    'QtilerStories.tab_maps': 'Mapas',
    'QtilerStories.tab_log': 'Registro',
    'QtilerStories.maps_section': 'Mapas disponibles',
    'QtilerStories.maps_desc': 'Todos los mapas publicados de Qtiler2Origo, Qtiler2Hajk y Qtiler 3D Eye. Úsalos en tus páginas del portal.',
    'QtilerStories.no_maps': 'No se encontraron mapas publicados. Publica mapas primero en Qtiler2Origo, Qtiler2Hajk o Qtiler 3D Eye.',
    'QtilerStories.portal_section': 'Páginas del portal',
    'QtilerStories.portal_desc': 'Crea páginas de aterrizaje editoriales para el portal público, con secciones, mapas destacados y reglas de audiencia.',
    'QtilerStories.portal_add_page': 'Nueva página',
    'QtilerStories.portal_duplicate_page': 'Duplicar página',
    'QtilerStories.portal_fullscreen': 'Editor a pantalla completa',
    'QtilerStories.portal_open_page': 'Abrir página',
    'QtilerStories.portal_backup_title': 'Exportar / importar copia del portal',
    'QtilerStories.portal_backup_pages': 'Páginas del portal a exportar',
    'QtilerStories.portal_backup_maps': 'Mapas publicados a exportar',
    'QtilerStories.portal_backup_export': 'Exportar JSON',
    'QtilerStories.portal_backup_import': 'Importar / restaurar JSON',
    'QtilerStories.portal_backup_replace_portal': 'Reemplazar páginas del portal',
    'QtilerStories.portal_backup_help': 'El JSON de copia incluye el contenido del portal seleccionado y las entradas de mapas referenciadas. No incluye cachés de tiles ni proyectos QGIS.',
    'QtilerStories.portal_pages_list': 'Tus páginas',
    'QtilerStories.portal_save': 'Guardar portal',
    'QtilerStories.portal_empty': 'Crea la primera página para convertir el portal de mapas en una página editorial.',
    'QtilerStories.portal_templates': 'Plantillas de página',
    'QtilerStories.portal_templates_help': 'Empieza desde un diseño pulido y adáptalo.',
    'QtilerStories.portal_apply_template': 'Aplicar plantilla',
    'QtilerStories.portal_blocks': 'Secciones de historia',
    'QtilerStories.portal_blocks_help': 'Combina secciones hero, texto, mapas y noticias.',
    'QtilerStories.portal_add_block': 'Añadir sección',
    'QtilerStories.portal_page_title': 'Título de página',
    'QtilerStories.portal_page_slug': 'Slug (ruta URL)',
    'QtilerStories.portal_page_nav': 'Etiqueta de navegación',
    'QtilerStories.portal_page_summary': 'Resumen corto',
    'QtilerStories.portal_header_logo': 'URL del logo de cabecera',
    'QtilerStories.portal_header_height': 'Altura de cabecera (px)',
    'QtilerStories.portal_show_in_nav': 'Mostrar en menú de navegación',
    'QtilerStories.portal_set_home': 'Usar como página principal del portal',
    'QtilerStories.portal_show_header': 'Mostrar cabecera de navegación',
    'QtilerStories.portal_visibility': 'Visibilidad de página',
    'QtilerStories.portal_vis_public': 'Pública',
    'QtilerStories.portal_vis_authenticated': 'Usuarios autenticados',
    'QtilerStories.portal_vis_restricted': 'Usuarios / roles específicos',
    'QtilerStories.portal_users': 'Usuarios permitidos',
    'QtilerStories.portal_roles': 'Roles permitidos',
    'QtilerStories.portal_preview': 'Vista previa en vivo',
    'QtilerStories.portal_preview_note': 'Vista escritorio',
    'QtilerStories.portal_device_desktop': 'Escritorio',
    'QtilerStories.portal_device_tablet': 'Tablet',
    'QtilerStories.portal_device_mobile': 'Móvil',
    'QtilerStories.portal_no_blocks_preview': 'Añade una sección para ver la vista previa.',
    'QtilerStories.portal_map_display_open': 'Abrir mapa',
    'QtilerStories.activity_log': 'Registro de actividad',
    'QtilerStories.clear': 'Limpiar',
    'QtilerStories.no_activity': 'Sin actividad aún.',
    'QtilerStories.log_saved': 'Portal guardado.',
    'QtilerStories.log_error': 'Error: {msg}',
    'QtilerStories.portal_backup_exported': 'Copia del portal exportada.',
    'QtilerStories.portal_backup_imported': 'Copia del portal importada ({n} páginas).',
    'QtilerStories.delete_page_confirm': '¿Eliminar esta página?',
    'QtilerStories.duplicate': 'Duplicar',
    'QtilerStories.delete': 'Eliminar',
    'QtilerStories.move_up': 'Subir',
    'QtilerStories.move_down': 'Bajar',
    'QtilerStories.remove': 'Quitar',
    'QtilerStories.loading': 'Cargando...'
  },
  sv: {
    'QtilerStories.title': 'Qtiler Stories',
    'QtilerStories.subtitle': 'Bygg publika berättelseportaler som kombinerar kartor från Origo, Hajk och 3D Eye.',
    'QtilerStories.open_portal': 'Öppna portalen ↗',
    'QtilerStories.tab_portal': 'Portal',
    'QtilerStories.tab_maps': 'Kartor',
    'QtilerStories.tab_log': 'Logg',
    'QtilerStories.maps_section': 'Tillgängliga kartor',
    'QtilerStories.maps_desc': 'Alla publicerade kartor från Qtiler2Origo, Qtiler2Hajk och Qtiler 3D Eye. Använd dem i dina portalsidor.',
    'QtilerStories.no_maps': 'Inga publicerade kartor hittades. Publicera kartor först i Qtiler2Origo, Qtiler2Hajk eller Qtiler 3D Eye.',
    'QtilerStories.portal_section': 'Portalsidor',
    'QtilerStories.portal_desc': 'Skapa redaktionella landningssidor för den publika kartportalen, med sektioner, utvalda kartor och målgruppsregler.',
    'QtilerStories.portal_add_page': 'Ny sida',
    'QtilerStories.portal_duplicate_page': 'Duplicera sida',
    'QtilerStories.portal_fullscreen': 'Helskärmsredigerare',
    'QtilerStories.portal_open_page': 'Öppna sida',
    'QtilerStories.portal_backup_title': 'Exportera / importera portalbackup',
    'QtilerStories.portal_backup_pages': 'Portalsidor att exportera',
    'QtilerStories.portal_backup_maps': 'Publicerade kartor att exportera',
    'QtilerStories.portal_backup_export': 'Exportera JSON',
    'QtilerStories.portal_backup_import': 'Importera / återställ JSON',
    'QtilerStories.portal_backup_replace_portal': 'Ersätt portalsidor',
    'QtilerStories.portal_backup_help': 'Backup-JSON:en innehåller valt portalinnehåll och refererade publicerade kartor. Den innehåller inte tile-cache eller QGIS-projektfiler.',
    'QtilerStories.portal_pages_list': 'Dina sidor',
    'QtilerStories.portal_save': 'Spara portal',
    'QtilerStories.portal_empty': 'Skapa den första sidan för att förvandla kartportalen till en redaktionell landningssida.',
    'QtilerStories.portal_templates': 'Sidmallar',
    'QtilerStories.portal_templates_help': 'Börja från en färdig layout och anpassa.',
    'QtilerStories.portal_apply_template': 'Tillämpa mall',
    'QtilerStories.portal_blocks': 'Berättelsesektioner',
    'QtilerStories.portal_blocks_help': 'Kombinera hero-, text-, kart- och nyhetssektioner.',
    'QtilerStories.portal_add_block': 'Lägg till sektion',
    'QtilerStories.portal_page_title': 'Sidtitel',
    'QtilerStories.portal_page_slug': 'Slug (URL-sökväg)',
    'QtilerStories.portal_page_nav': 'Navigeringsetikett',
    'QtilerStories.portal_page_summary': 'Kort sammanfattning',
    'QtilerStories.portal_header_logo': 'Logotyp-URL för sidhuvud',
    'QtilerStories.portal_header_height': 'Sidhuvudets höjd (px)',
    'QtilerStories.portal_show_in_nav': 'Visa i navigationsmenyn',
    'QtilerStories.portal_set_home': 'Använd som portalens startsida',
    'QtilerStories.portal_show_header': 'Visa navigeringssidhuvud',
    'QtilerStories.portal_visibility': 'Sidans synlighet',
    'QtilerStories.portal_vis_public': 'Publik',
    'QtilerStories.portal_vis_authenticated': 'Autentiserade användare',
    'QtilerStories.portal_vis_restricted': 'Specifika användare / roller',
    'QtilerStories.portal_users': 'Tillåtna användare',
    'QtilerStories.portal_roles': 'Tillåtna roller',
    'QtilerStories.portal_preview': 'Liveförhandsvisning',
    'QtilerStories.portal_preview_note': 'Skrivbordsvy',
    'QtilerStories.portal_device_desktop': 'Skrivbord',
    'QtilerStories.portal_device_tablet': 'Surfplatta',
    'QtilerStories.portal_device_mobile': 'Mobil',
    'QtilerStories.portal_no_blocks_preview': 'Lägg till en sektion för att se förhandsvisningen.',
    'QtilerStories.portal_map_display_open': 'Öppna karta',
    'QtilerStories.activity_log': 'Aktivitetslogg',
    'QtilerStories.clear': 'Rensa',
    'QtilerStories.no_activity': 'Ingen aktivitet ännu.',
    'QtilerStories.log_saved': 'Portal sparad.',
    'QtilerStories.log_error': 'Fel: {msg}',
    'QtilerStories.portal_backup_exported': 'Portalbackup exporterad.',
    'QtilerStories.portal_backup_imported': 'Portalbackup importerad ({n} sidor).',
    'QtilerStories.delete_page_confirm': 'Ta bort denna sida?',
    'QtilerStories.duplicate': 'Duplicera',
    'QtilerStories.delete': 'Ta bort',
    'QtilerStories.move_up': 'Flytta upp',
    'QtilerStories.move_down': 'Flytta ner',
    'QtilerStories.remove': 'Ta bort',
    'QtilerStories.loading': 'Laddar...'
  }
};
// Derived locales share the Swedish base where no dedicated translation exists.
QTWC_I18N.no = { ...QTWC_I18N.sv };
QTWC_I18N.nb = { ...QTWC_I18N.sv };
QTWC_I18N.nn = { ...QTWC_I18N.sv };
QTWC_I18N.da = { ...QTWC_I18N.sv };
QTWC_I18N.fi = { ...QTWC_I18N.sv };

function getLang() {
  try {
    const stored = localStorage.getItem('qtiler.lang') || '';
    if (stored && QTWC_I18N[stored]) return stored;
  } catch {}
  const nav = String(navigator.language || 'en').slice(0, 2).toLowerCase();
  return QTWC_I18N[nav] ? nav : 'en';
}

function t(key, params = {}) {
  const lang = getLang();
  let str = QTWC_I18N[lang]?.[key] ?? QTWC_I18N.en[key] ?? key;
  for (const [k, v] of Object.entries(params)) {
    str = str.replaceAll(`{${k}}`, String(v));
  }
  return str;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.placeholder = t(key);
  });
}

/* ── API helper ── */
async function api(url, options = {}) {
  const opts = { credentials: 'include', headers: {}, ...options };
  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, opts);
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const text = await res.text();
  let payload;
  if (isJson && text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  } else {
    payload = text;
  }
  if (!res.ok) {
    const detail = (isJson && (payload?.details || payload?.message || payload?.error)) || payload || res.statusText;
    throw new Error(String(detail));
  }
  return payload;
}

/* ── Activity log ── */
const logContainer = document.getElementById('logContainer');
const clearLogBtn = document.getElementById('clearLogBtn');

function addLog(msg, type = 'info') {
  if (!logContainer) return;
  const empty = logContainer.querySelector('.log-empty');
  if (empty) empty.remove();
  const entry = document.createElement('div');
  entry.className = `log-entry log-entry--${type}`;
  const time = new Date().toLocaleTimeString();
  entry.innerHTML = `<span class="log-entry__time">${time}</span><span class="log-entry__msg">${escapeHtml(String(msg))}</span>`;
  logContainer.prepend(entry);
}

clearLogBtn?.addEventListener('click', () => {
  if (!logContainer) return;
  logContainer.innerHTML = `<p class="log-empty">${escapeHtml(t('QtilerStories.no_activity'))}</p>`;
});

/* ── State ── */
let portalPagesState = { homePageSlug: '', site: {}, gdpr: {}, pages: [] };
let selectedPortalPageId = '';
let portalPreviewDevice = 'desktop';
let publishedMaps = []; // aggregated from all viewer plugins
let portalEditorFullscreen = false;

/* ── DOM refs ── */
const portalAddPageBtn = document.getElementById('portalAddPageBtn');
const portalDuplicatePageBtn = document.getElementById('portalDuplicatePageBtn');
const portalToggleFullscreenBtn = document.getElementById('portalToggleFullscreenBtn');
const portalSaveBtn = document.getElementById('portalSaveBtn');
const portalOpenPageBtn = document.getElementById('portalOpenPageBtn');
const portalBackupPagesSelect = document.getElementById('portalBackupPagesSelect');
const portalBackupMapsSelect = document.getElementById('portalBackupMapsSelect');
const portalExportBackupBtn = document.getElementById('portalExportBackupBtn');
const portalImportBackupBtn = document.getElementById('portalImportBackupBtn');
const portalImportBackupInput = document.getElementById('portalImportBackupInput');
const portalImportReplacePortal = document.getElementById('portalImportReplacePortal');
const portalPagesList = document.getElementById('portalPagesList');
const portalPageEmpty = document.getElementById('portalPageEmpty');
const portalPageEditor = document.getElementById('portalPageEditor');
const portalPageTitle = document.getElementById('portalPageTitle');
const portalPageSlug = document.getElementById('portalPageSlug');
const portalPageNavLabel = document.getElementById('portalPageNavLabel');
const portalPageSummary = document.getElementById('portalPageSummary');
const portalPageHeaderLogoUrl = document.getElementById('portalPageHeaderLogoUrl');
const portalPageHeaderHeight = document.getElementById('portalPageHeaderHeight');
const portalPageVisibility = document.getElementById('portalPageVisibility');
const portalPageUsers = document.getElementById('portalPageUsers');
const portalPageUsersCatalog = document.getElementById('portalPageUsersCatalog');
const portalPageRoles = document.getElementById('portalPageRoles');
const portalPageRolesCatalog = document.getElementById('portalPageRolesCatalog');
const portalPageShowInNav = document.getElementById('portalPageShowInNav');
const portalPageIsHome = document.getElementById('portalPageIsHome');
const portalPageShowHeader = document.getElementById('portalPageShowHeader');
const portalTemplateSelect = document.getElementById('portalTemplateSelect');
const portalApplyTemplateBtn = document.getElementById('portalApplyTemplateBtn');
const portalAddBlockBtn = document.getElementById('portalAddBlockBtn');
const portalBlocksList = document.getElementById('portalBlocksList');
const portalPreviewHost = document.getElementById('portalPreviewHost');
const portalPreviewDeviceButtons = Array.from(document.querySelectorAll('[data-portal-preview-device]'));
const portalSection = document.getElementById('portalSection');
const mapsList = document.getElementById('mapsList');
const mapsBadge = document.getElementById('mapsBadge');
const tabPortalBadge = document.getElementById('tabPortalBadge');
const tabMapsBadge = document.getElementById('tabMapsBadge');

// Site identity
const portalSiteTitle = document.getElementById('portalSiteTitle');
const portalSiteSubtitle = document.getElementById('portalSiteSubtitle');
const portalSiteLogoUrl = document.getElementById('portalSiteLogoUrl');
const portalSiteHeaderHeight = document.getElementById('portalSiteHeaderHeight');
const portalSiteHeaderFont = document.getElementById('portalSiteHeaderFont');
const portalSiteHeaderColor1 = document.getElementById('portalSiteHeaderColor1');
const portalSiteHeaderColor2 = document.getElementById('portalSiteHeaderColor2');
const portalSiteHeaderTextColor = document.getElementById('portalSiteHeaderTextColor');
const portalSiteHeaderBackgroundUrl = document.getElementById('portalSiteHeaderBackgroundUrl');
const portalSiteFooterText = document.getElementById('portalSiteFooterText');
const portalSiteFooterLinkLabel = document.getElementById('portalSiteFooterLinkLabel');
const portalSiteFooterLink = document.getElementById('portalSiteFooterLink');
const portalSiteFooterBackgroundColor = document.getElementById('portalSiteFooterBackgroundColor');
const portalSiteFooterTextColor = document.getElementById('portalSiteFooterTextColor');
const portalSiteFooterLinkColor = document.getElementById('portalSiteFooterLinkColor');

// GDPR
const portalGdprEnabled = document.getElementById('portalGdprEnabled');
const portalGdprCompany = document.getElementById('portalGdprCompany');
const portalGdprPrivacyUrl = document.getElementById('portalGdprPrivacyUrl');
const portalGdprCookieUrl = document.getElementById('portalGdprCookieUrl');
const portalGdprContactUrl = document.getElementById('portalGdprContactUrl');
const portalGdprTitle = document.getElementById('portalGdprTitle');
const portalGdprText = document.getElementById('portalGdprText');
const portalGdprAcceptLabel = document.getElementById('portalGdprAcceptLabel');
const portalGdprRejectLabel = document.getElementById('portalGdprRejectLabel');
const portalGdprManageLabel = document.getElementById('portalGdprManageLabel');

/* ── Portal state helpers ── */
function slugifyPortalValue(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function parsePortalCsv(value) {
  return String(value || '').split(',').map((v) => v.trim()).filter(Boolean);
}

function toPortalCsv(value) {
  return Array.isArray(value) ? value.join(',') : '';
}

function makePortalId(prefix = 'portal') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getPortalPages() {
  return Array.isArray(portalPagesState?.pages) ? portalPagesState.pages : [];
}

function getSelectedPortalPage() {
  return getPortalPages().find((p) => p.id === selectedPortalPageId) || null;
}

function buildUniquePortalSlug(baseValue, excludePageId = '') {
  const base = slugifyPortalValue(baseValue) || 'page';
  const existing = new Set(getPortalPages().filter((p) => p.id !== excludePageId).map((p) => p.slug));
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

function createDefaultPortalBlock(type = 'text') {
  const id = makePortalId(type);
  if (type === 'hero') {
    return { id, type, title: '', eyebrow: '', subtitle: '', backgroundUrl: '', ctaLabel: '', ctaUrl: '', visibility: { access: 'inherit', users: [], roles: [] } };
  }
  if (type === 'maps') {
    return { id, type, title: '', intro: '', layout: 'grid', displayMode: 'card', profileKeys: [], visibility: { access: 'inherit', users: [], roles: [] } };
  }
  if (type === 'cards') {
    return { id, type, title: '', intro: '', items: [{ id: makePortalId('card'), title: 'Card title', text: 'Short description.', url: '', label: 'Read more', icon: 'news', meta: '', imageUrl: '' }], visibility: { access: 'inherit', users: [], roles: [] } };
  }
  if (type === 'social') {
    return { id, type, title: '', intro: '', items: [{ id: makePortalId('social'), title: 'Website', text: '', url: 'https://', label: 'Open', icon: 'web', meta: '', imageUrl: '' }], visibility: { access: 'inherit', users: [], roles: [] } };
  }
  return { id, type: 'text', title: '', body: '', visibility: { access: 'inherit', users: [], roles: [] } };
}

function createDefaultPortalPage() {
  const id = makePortalId('page');
  const slug = buildUniquePortalSlug('page', id);
  return {
    id,
    slug,
    title: 'New page',
    navLabel: 'New page',
    summary: '',
    showInNav: true,
    showHeader: true,
    headerLogoUrl: '',
    headerHeight: 120,
    visibility: { access: 'public', users: [], roles: [] },
    blocks: [createDefaultPortalBlock('hero')]
  };
}

function buildPortalTemplate(templateKey) {
  const mk = (type) => createDefaultPortalBlock(type);
  if (templateKey === 'newsroom') {
    return {
      title: 'Newsroom',
      navLabel: 'News',
      summary: 'Latest updates and announcements.',
      blocks: [
        { ...mk('hero'), title: 'Newsroom', eyebrow: 'Latest', subtitle: 'Updates, releases and announcements.' },
        { ...mk('cards'), title: 'Latest news', items: [
          { id: makePortalId('card'), title: 'News item', text: 'Short teaser for this story.', url: '', label: 'Read more', icon: 'news', meta: 'Latest update', imageUrl: '' },
          { id: makePortalId('card'), title: 'Operational update', text: 'Use this block for notices that matter.', url: '', label: 'Open note', icon: 'web', meta: 'Internal', imageUrl: '' }
        ] },
        { ...mk('maps'), title: 'Featured maps' }
      ]
    };
  }
  if (templateKey === 'campaign') {
    return {
      title: 'Campaign',
      navLabel: 'Campaign',
      summary: 'A focused landing page for a campaign or product.',
      blocks: [
        { ...mk('hero'), title: 'Campaign title', subtitle: 'Short, direct campaign pitch.', ctaLabel: 'Explore the map', ctaUrl: '/QtilerStories/maps' },
        { ...mk('text'), title: 'Why it matters', body: 'Explain the value in a few paragraphs.' },
        { ...mk('maps'), title: 'Explore the maps', layout: 'featured' }
      ]
    };
  }
  // story (default)
  return {
    title: 'Story landing',
    navLabel: 'Story',
    summary: 'An editorial landing page with a hero, text and maps.',
    blocks: [
      { ...mk('hero'), title: 'Story title', subtitle: 'A short, compelling subtitle for this story.' },
      { ...mk('text'), title: 'The story', body: 'Write the story here. Use rich text with images and links.' },
      { ...mk('maps'), title: 'Related maps' }
    ]
  };
}

/* ── Portal rendering ── */
function getPortalBlockTypeLabel(type) {
  const labels = { hero: 'Hero', text: 'Text', maps: 'Maps', cards: 'Cards', social: 'Social links' };
  return labels[type] || type;
}

function getPortalAccessLabel(access, inherit = false) {
  if (inherit && access === 'inherit') return 'Inherit';
  const labels = { public: 'Public', authenticated: 'Authenticated', restricted: 'Restricted' };
  return labels[access] || access;
}

function updatePortalBadges() {
  const n = getPortalPages().length;
  if (tabPortalBadge) tabPortalBadge.textContent = String(n);
  const badge = document.getElementById('portalPagesBadge');
  if (badge) badge.textContent = String(n);
}

function getPortalPageUrl(page) {
  return `/QtilerStories/portal/${encodeURIComponent(page.slug)}`;
}

function updatePortalPublicLink() {
  const page = getSelectedPortalPage();
  if (portalOpenPageBtn) {
    if (page) {
      portalOpenPageBtn.href = getPortalPageUrl(page);
      portalOpenPageBtn.classList.remove('is-disabled');
    } else {
      portalOpenPageBtn.href = '/QtilerStories/maps';
      portalOpenPageBtn.classList.add('is-disabled');
    }
  }
}

function renderPortalPageList() {
  if (!portalPagesList) return;
  const pages = getPortalPages();
  if (!pages.length) {
    portalPagesList.innerHTML = `<p class="help">${escapeHtml(t('QtilerStories.portal_empty'))}</p>`;
    return;
  }
  portalPagesList.innerHTML = pages.map((page, index) => `
    <div class="portal-pages-list__item${page.id === selectedPortalPageId ? ' is-active' : ''}" data-portal-select="${escapeHtml(page.id)}">
      <button type="button" class="portal-pages-list__select" data-portal-select="${escapeHtml(page.id)}">
        <strong>${escapeHtml(page.title || page.slug)}</strong>
        <small>${escapeHtml(getPortalAccessLabel(page.visibility?.access))} · ${(page.blocks || []).length} sections</small>
      </button>
      <div class="portal-pages-list__actions">
        <button type="button" title="${escapeHtml(t('QtilerStories.move_up'))}" data-portal-move="up" data-portal-page-id="${escapeHtml(page.id)}" ${index === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" title="${escapeHtml(t('QtilerStories.move_down'))}" data-portal-move="down" data-portal-page-id="${escapeHtml(page.id)}" ${index === pages.length - 1 ? 'disabled' : ''}>▼</button>
        <button type="button" title="${escapeHtml(t('QtilerStories.delete'))}" data-portal-delete-page="${escapeHtml(page.id)}">×</button>
      </div>
    </div>
  `).join('');
}

function renderPortalBackupOptions() {
  if (portalBackupPagesSelect) {
    const pages = getPortalPages();
    portalBackupPagesSelect.innerHTML = pages.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.title || p.slug)}</option>`).join('');
  }
  if (portalBackupMapsSelect) {
    portalBackupMapsSelect.innerHTML = publishedMaps.map((m) => `<option value="${escapeHtml(m.profileKey || m.projectId)}">[${escapeHtml(m.source || '?')}] ${escapeHtml(m.name || m.profileKey || '')}</option>`).join('');
  }
}

function findPublishedMapProfile(token) {
  const key = String(token || '').trim();
  if (!key) return null;
  return publishedMaps.find((m) => m.profileKey === key || m.projectId === key || m.name === key) || null;
}

/* ── Portal editor: page fields ── */
function updatePortalPageField(field, value) {
  const page = getSelectedPortalPage();
  if (!page) return;
  if (field === 'slug') {
    page.slug = buildUniquePortalSlug(slugifyPortalValue(value) || page.slug, page.id);
  } else if (field === 'visibility.access') {
    page.visibility = { ...page.visibility, access: value };
  } else if (field === 'visibility.users') {
    page.visibility = { ...page.visibility, users: parsePortalCsv(value) };
  } else if (field === 'visibility.roles') {
    page.visibility = { ...page.visibility, roles: parsePortalCsv(value) };
  } else if (field === 'headerHeight') {
    page.headerHeight = Number(value) || 120;
  } else {
    page[field] = value;
  }
  queuePortalPersist();
  renderPortalPageList();
  updatePortalPublicLink();
}

function renderPortalEditor() {
  renderPortalPageList();
  renderPortalBackupOptions();
  updatePortalBadges();

  const page = getSelectedPortalPage();
  if (portalPageEmpty) portalPageEmpty.hidden = !!page;
  if (portalPageEditor) portalPageEditor.hidden = !page;
  if (!page) return;

  const setVal = (el, v) => { if (el && document.activeElement !== el) el.value = v; };
  setVal(portalPageTitle, page.title || '');
  setVal(portalPageSlug, page.slug || '');
  setVal(portalPageNavLabel, page.navLabel || '');
  setVal(portalPageSummary, page.summary || '');
  setVal(portalPageHeaderLogoUrl, page.headerLogoUrl || '');
  setVal(portalPageHeaderHeight, page.headerHeight ?? 120);
  if (portalPageVisibility) portalPageVisibility.value = page.visibility?.access || 'public';
  setVal(portalPageUsers, toPortalCsv(page.visibility?.users));
  setVal(portalPageRoles, toPortalCsv(page.visibility?.roles));
  if (portalPageShowInNav) portalPageShowInNav.checked = page.showInNav !== false;
  if (portalPageIsHome) portalPageIsHome.checked = portalPagesState.homePageSlug === page.slug;
  if (portalPageShowHeader) portalPageShowHeader.checked = page.showHeader !== false;

  renderPortalBlocksList();
  renderPortalPreview();

  // Site identity
  const site = portalPagesState?.site || {};
  const setIfNotActive = (input, value) => { if (input && document.activeElement !== input) input.value = value; };
  setIfNotActive(portalSiteTitle, site.title || '');
  setIfNotActive(portalSiteSubtitle, site.subtitle || '');
  setIfNotActive(portalSiteLogoUrl, site.headerLogoUrl || '');
  setIfNotActive(portalSiteHeaderHeight, site.headerHeight ?? 120);
  if (portalSiteHeaderFont && document.activeElement !== portalSiteHeaderFont) portalSiteHeaderFont.value = site.headerFont || 'fraunces';
  if (portalSiteHeaderColor1) portalSiteHeaderColor1.value = site.headerColor1 || '#0f766e';
  if (portalSiteHeaderColor2) portalSiteHeaderColor2.value = site.headerColor2 || '#2563eb';
  if (portalSiteHeaderTextColor) portalSiteHeaderTextColor.value = site.headerTextColor || '#ffffff';
  setIfNotActive(portalSiteHeaderBackgroundUrl, site.headerBackgroundUrl || '');
  setIfNotActive(portalSiteFooterText, site.footerText || '');
  setIfNotActive(portalSiteFooterLinkLabel, site.footerLinkLabel || '');
  setIfNotActive(portalSiteFooterLink, site.footerLink || '');
  if (portalSiteFooterBackgroundColor) portalSiteFooterBackgroundColor.value = site.footerBackgroundColor || '#1f2933';
  if (portalSiteFooterTextColor) portalSiteFooterTextColor.value = site.footerTextColor || '#cbd5e1';
  if (portalSiteFooterLinkColor) portalSiteFooterLinkColor.value = site.footerLinkColor || '#93c5fd';

  // GDPR
  const gdpr = portalPagesState?.gdpr || {};
  if (portalGdprEnabled) portalGdprEnabled.checked = gdpr.enabled === true;
  setIfNotActive(portalGdprCompany, gdpr.companyName || '');
  setIfNotActive(portalGdprTitle, gdpr.bannerTitle || '');
  setIfNotActive(portalGdprPrivacyUrl, gdpr.privacyUrl || '');
  setIfNotActive(portalGdprCookieUrl, gdpr.cookiePolicyUrl || '');
  setIfNotActive(portalGdprContactUrl, gdpr.contactUrl || '');
  setIfNotActive(portalGdprText, gdpr.bannerText || '');
  setIfNotActive(portalGdprAcceptLabel, gdpr.acceptLabel || '');
  setIfNotActive(portalGdprRejectLabel, gdpr.rejectLabel || '');
  setIfNotActive(portalGdprManageLabel, gdpr.manageLabel || '');
}

/* ── Blocks editor ── */
function getPortalBlockTypeOptionsHtml(selected) {
  return ['hero', 'text', 'maps', 'cards', 'social'].map((type) =>
    `<option value="${type}"${type === selected ? ' selected' : ''}>${escapeHtml(getPortalBlockTypeLabel(type))}</option>`
  ).join('');
}

function getPortalVisibilityOptionsHtml(selected, includeInherit = false) {
  const opts = [];
  if (includeInherit) opts.push(`<option value="inherit"${selected === 'inherit' ? ' selected' : ''}>Inherit</option>`);
  for (const access of ['public', 'authenticated', 'restricted']) {
    opts.push(`<option value="${access}"${selected === access ? ' selected' : ''}>${escapeHtml(getPortalAccessLabel(access))}</option>`);
  }
  return opts.join('');
}

function getPortalSelectedOptions(selectEl) {
  if (!selectEl) return [];
  return Array.from(selectEl.selectedOptions || []).map((o) => String(o.value || '').trim()).filter(Boolean);
}

function renderPortalMultiSelectOptions(items, selectedValues, emptyLabel = '') {
  const selected = new Set(Array.isArray(selectedValues) ? selectedValues : parsePortalCsv(selectedValues));
  if (!items.length && emptyLabel) return `<option value="" disabled>${escapeHtml(emptyLabel)}</option>`;
  return items.map((item) => `<option value="${escapeHtml(item.value)}"${selected.has(item.value) ? ' selected' : ''}>${escapeHtml(item.label)}</option>`).join('');
}

function updatePortalBlockField(blockId, field, value) {
  const page = getSelectedPortalPage();
  if (!page) return;
  const block = (page.blocks || []).find((b) => b.id === blockId);
  if (!block) return;
  if (field === 'visibility.access') {
    block.visibility = { ...block.visibility, access: value };
  } else if (field === 'profileKeys') {
    block.profileKeys = Array.isArray(value) ? value : [];
  } else if (field === 'headerHeight') {
    block[field] = Number(value) || 0;
  } else {
    block[field] = value;
  }
  queuePortalPersist();
  renderPortalPreview();
}

function updatePortalItemField(blockId, itemIndex, field, value) {
  const page = getSelectedPortalPage();
  if (!page) return;
  const block = (page.blocks || []).find((b) => b.id === blockId);
  if (!block || !Array.isArray(block.items)) return;
  const item = block.items[itemIndex];
  if (!item) return;
  item[field] = value;
  queuePortalPersist();
  renderPortalPreview();
}

function renderPortalBlocksList() {
  if (!portalBlocksList) return;
  const page = getSelectedPortalPage();
  const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
  if (!blocks.length) {
    portalBlocksList.innerHTML = `<p class="help">${escapeHtml(t('QtilerStories.portal_no_blocks_preview'))}</p>`;
    return;
  }
  portalBlocksList.innerHTML = blocks.map((block, index) => {
    const mapsOptions = publishedMaps.map((m) => {
      const key = m.profileKey || m.projectId;
      const sel = (block.profileKeys || []).includes(key) ? ' selected' : '';
      return `<option value="${escapeHtml(key)}"${sel}>[${escapeHtml(m.source || '?')}] ${escapeHtml(m.name || key)}</option>`;
    }).join('');
    return `
      <div class="portal-block" data-portal-block="${escapeHtml(block.id)}">
        <div class="portal-block__head">
          <span class="portal-block__type">${escapeHtml(getPortalBlockTypeLabel(block.type))}</span>
          <div class="portal-block__head-actions">
            <button type="button" title="${escapeHtml(t('QtilerStories.move_up'))}" data-portal-block-move="up" data-portal-block-id="${escapeHtml(block.id)}" ${index === 0 ? 'disabled' : ''}>▲</button>
            <button type="button" title="${escapeHtml(t('QtilerStories.move_down'))}" data-portal-block-move="down" data-portal-block-id="${escapeHtml(block.id)}" ${index === blocks.length - 1 ? 'disabled' : ''}>▼</button>
            <button type="button" title="${escapeHtml(t('QtilerStories.delete'))}" data-portal-block-delete="${escapeHtml(block.id)}">×</button>
          </div>
        </div>
        <div class="portal-block__body">
          <div class="portal-meta-grid">
            <div class="field">
              <label class="label">Type</label>
              <div class="control"><div class="select is-fullwidth"><select data-portal-block-field="type" data-portal-block-id="${escapeHtml(block.id)}">${getPortalBlockTypeOptionsHtml(block.type)}</select></div></div>
            </div>
            <div class="field">
              <label class="label">Title</label>
              <div class="control"><input class="input" type="text" value="${escapeHtml(block.title || '')}" data-portal-block-field="title" data-portal-block-id="${escapeHtml(block.id)}" /></div>
            </div>
            ${block.type === 'hero' ? `
            <div class="field">
              <label class="label">Eyebrow</label>
              <div class="control"><input class="input" type="text" value="${escapeHtml(block.eyebrow || '')}" data-portal-block-field="eyebrow" data-portal-block-id="${escapeHtml(block.id)}" /></div>
            </div>
            <div class="field">
              <label class="label">Subtitle (rich text HTML)</label>
              <div class="control"><textarea class="textarea" rows="2" data-portal-block-field="subtitle" data-portal-block-id="${escapeHtml(block.id)}">${escapeHtml(block.subtitle || '')}</textarea></div>
            </div>
            <div class="field">
              <label class="label">Background image URL</label>
              <div class="control"><input class="input" type="text" value="${escapeHtml(block.backgroundUrl || '')}" data-portal-block-field="backgroundUrl" data-portal-block-id="${escapeHtml(block.id)}" /></div>
            </div>
            <div class="field">
              <label class="label">CTA label</label>
              <div class="control"><input class="input" type="text" value="${escapeHtml(block.ctaLabel || '')}" data-portal-block-field="ctaLabel" data-portal-block-id="${escapeHtml(block.id)}" /></div>
            </div>
            <div class="field">
              <label class="label">CTA URL</label>
              <div class="control"><input class="input" type="text" value="${escapeHtml(block.ctaUrl || '')}" data-portal-block-field="ctaUrl" data-portal-block-id="${escapeHtml(block.id)}" /></div>
            </div>` : ''}
            ${block.type === 'text' ? `
            <div class="field" style="grid-column:1/-1">
              <label class="label">Body (rich text HTML)</label>
              <div class="control"><textarea class="textarea" rows="4" data-portal-block-field="body" data-portal-block-id="${escapeHtml(block.id)}">${escapeHtml(block.body || '')}</textarea></div>
            </div>` : ''}
            ${block.type === 'maps' ? `
            <div class="field">
              <label class="label">Intro</label>
              <div class="control"><input class="input" type="text" value="${escapeHtml(block.intro || '')}" data-portal-block-field="intro" data-portal-block-id="${escapeHtml(block.id)}" /></div>
            </div>
            <div class="field">
              <label class="label">Layout</label>
              <div class="control"><div class="select is-fullwidth"><select data-portal-block-field="layout" data-portal-block-id="${escapeHtml(block.id)}">
                <option value="grid"${block.layout === 'grid' ? ' selected' : ''}>Grid</option>
                <option value="featured"${block.layout === 'featured' ? ' selected' : ''}>Featured</option>
              </select></div></div>
            </div>
            <div class="field">
              <label class="label">Display mode</label>
              <div class="control"><div class="select is-fullwidth"><select data-portal-block-field="displayMode" data-portal-block-id="${escapeHtml(block.id)}">
                <option value="card"${block.displayMode === 'card' ? ' selected' : ''}>Card (thumbnail)</option>
                <option value="embed"${block.displayMode === 'embed' ? ' selected' : ''}>Embedded map</option>
                <option value="open"${block.displayMode === 'open' ? ' selected' : ''}>Open link</option>
              </select></div></div>
            </div>
            <div class="field" style="grid-column:1/-1">
              <label class="label">Maps</label>
              <div class="control"><select class="input portal-multiselect" multiple size="5" data-portal-block-field="profileKeys" data-portal-block-id="${escapeHtml(block.id)}" data-value-kind="multi-option">${mapsOptions}</select></div>
            </div>` : ''}
            ${(block.type === 'cards' || block.type === 'social') ? `
            <div class="field">
              <label class="label">Intro</label>
              <div class="control"><input class="input" type="text" value="${escapeHtml(block.intro || '')}" data-portal-block-field="intro" data-portal-block-id="${escapeHtml(block.id)}" /></div>
            </div>
            <div class="field" style="grid-column:1/-1">
              <label class="label">Items</label>
              <div class="portal-items-list">
                ${(block.items || []).map((item, i) => `
                  <div class="portal-item" data-item-index="${i}">
                    <div class="portal-item__grid">
                      <input class="input is-small" placeholder="Title" value="${escapeHtml(item.title || '')}" data-portal-item-field="title" data-portal-block-id="${escapeHtml(block.id)}" data-item-index="${i}" />
                      <input class="input is-small" placeholder="Text" value="${escapeHtml(item.text || '')}" data-portal-item-field="text" data-portal-block-id="${escapeHtml(block.id)}" data-item-index="${i}" />
                      <input class="input is-small" placeholder="URL" value="${escapeHtml(item.url || '')}" data-portal-item-field="url" data-portal-block-id="${escapeHtml(block.id)}" data-item-index="${i}" />
                      <input class="input is-small" placeholder="Label" value="${escapeHtml(item.label || '')}" data-portal-item-field="label" data-portal-block-id="${escapeHtml(block.id)}" data-item-index="${i}" />
                      <input class="input is-small" placeholder="Meta" value="${escapeHtml(item.meta || '')}" data-portal-item-field="meta" data-portal-block-id="${escapeHtml(block.id)}" data-item-index="${i}" />
                      <input class="input is-small" placeholder="Image URL" value="${escapeHtml(item.imageUrl || '')}" data-portal-item-field="imageUrl" data-portal-block-id="${escapeHtml(block.id)}" data-item-index="${i}" />
                      <button type="button" class="button is-small is-danger is-light" data-portal-item-delete data-portal-block-id="${escapeHtml(block.id)}" data-item-index="${i}">×</button>
                    </div>
                  </div>
                `).join('')}
                <button type="button" class="button is-small" data-portal-add-item="${escapeHtml(block.id)}">+ Add item</button>
              </div>
            </div>` : ''}
            <div class="field">
              <label class="label">Visibility</label>
              <div class="control"><div class="select is-fullwidth"><select data-portal-block-field="visibility.access" data-portal-block-id="${escapeHtml(block.id)}">${getPortalVisibilityOptionsHtml(block.visibility?.access || 'inherit', true)}</select></div></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/* ── Preview ── */
function renderPortalPreview() {
  if (!portalPreviewHost) return;
  const page = getSelectedPortalPage();
  if (!page) {
    portalPreviewHost.innerHTML = `<div class="portal-preview__empty">${escapeHtml(t('QtilerStories.portal_empty'))}</div>`;
    return;
  }
  const blocks = Array.isArray(page.blocks) ? page.blocks : [];
  if (!blocks.length) {
    portalPreviewHost.innerHTML = `<div class="portal-preview__empty">${escapeHtml(t('QtilerStories.portal_no_blocks_preview'))}</div>`;
    return;
  }
  const previewClass = portalPreviewDevice === 'mobile'
    ? 'portal-preview-frame portal-preview-frame--mobile'
    : portalPreviewDevice === 'tablet'
      ? 'portal-preview-frame portal-preview-frame--tablet'
      : 'portal-preview-frame';
  portalPreviewDeviceButtons.forEach((button) => {
    button.classList.toggle('is-active', button.getAttribute('data-portal-preview-device') === portalPreviewDevice);
  });
  const sanitizePortalRichHtml = (html) => String(html || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
  const previewHeader = page.showHeader !== false
    ? `<div class="portal-preview__site-header" style="min-height:${Math.max(0, Number(page.headerHeight) || 120)}px">${page.headerLogoUrl ? `<img class="portal-preview__site-logo" src="${escapeHtml(page.headerLogoUrl)}" alt="" />` : ''}<div class="portal-preview__site-brand"><strong>${escapeHtml(page.title || '')}</strong>${page.summary ? `<span>${escapeHtml(page.summary)}</span>` : ''}</div></div>`
    : '';
  portalPreviewHost.innerHTML = `<div class="${previewClass}"><div class="portal-preview-frame__topbar"><span class="portal-preview-frame__dot"></span><span class="portal-preview-frame__dot"></span><span class="portal-preview-frame__dot"></span><span class="portal-preview-frame__url">${escapeHtml(getPortalPageUrl(page))}</span></div><div class="portal-preview">${previewHeader}${blocks.map((block) => {
    if (block.type === 'hero') {
      const bg = block.backgroundUrl ? ` style="background-image: linear-gradient(135deg, rgba(0, 87, 216, 0.92), rgba(13, 148, 136, 0.72)), url('${escapeHtml(block.backgroundUrl)}');"` : '';
      return `<section class="portal-preview__hero"${bg}><div class="portal-preview__eyebrow">${escapeHtml(block.eyebrow || '')}</div><h1>${escapeHtml(block.title || page.title)}</h1><div class="portal-preview__richtext">${sanitizePortalRichHtml(block.subtitle || '')}</div>${block.ctaLabel ? `<a class="portal-preview__cta" href="${escapeHtml(block.ctaUrl || '#')}">${escapeHtml(block.ctaLabel)}</a>` : ''}</section>`;
    }
    if (block.type === 'text') {
      return `<section class="portal-preview__section"><h3>${escapeHtml(block.title || '')}</h3><div class="portal-preview__richtext">${sanitizePortalRichHtml(block.body || '')}</div></section>`;
    }
    if (block.type === 'maps') {
      const cards = (block.profileKeys || []).map((token) => findPublishedMapProfile(token)).filter(Boolean);
      return `<section class="portal-preview__section"><h3>${escapeHtml(block.title || '')}</h3>${block.intro ? `<div class="portal-preview__lead portal-preview__richtext">${sanitizePortalRichHtml(block.intro)}</div>` : ''}<div class="portal-preview__maps ${block.layout === 'featured' ? 'is-featured' : ''} ${block.displayMode === 'embed' ? 'is-embed' : ''} ${block.displayMode === 'open' ? 'is-open' : ''}">${cards.map((item) => {
        const thumbUrl = item?.thumbnailUrl || (item?.projectId ? `/plugins/${item?.source === 'hajk' ? 'Qtiler2Hajk' : 'Qtiler2Origo'}/api/thumbnail/${encodeURIComponent(item.projectId)}` : '');
        if (block.displayMode === 'embed') {
          return `<div class="portal-preview__map portal-preview__map--embed"><div class="portal-preview__embed-shell"><iframe src="${escapeHtml(item?.launchUrl || '/QtilerStories/maps')}" loading="lazy" referrerpolicy="same-origin"></iframe></div><strong>${escapeHtml(item?.name || item?.profileKey || '')}</strong><p>${escapeHtml(item?.description || '')}</p></div>`;
        }
        if (block.displayMode === 'open') {
          return `<div class="portal-preview__map portal-preview__map--open"><strong>${escapeHtml(item?.name || item?.profileKey || '')}</strong><p>${escapeHtml(item?.description || '')}</p><a class="portal-preview__cta" href="${escapeHtml(item?.launchUrl || '/QtilerStories/maps')}" target="_blank" rel="noreferrer">${escapeHtml(t('QtilerStories.portal_map_display_open'))}</a></div>`;
        }
        return `<div class="portal-preview__map"><div class="portal-preview__map-thumb"${thumbUrl ? ` style="background-image:url('${escapeHtml(thumbUrl)}')"` : ''}></div><strong>${escapeHtml(item?.name || item?.profileKey || '')}</strong><p>${escapeHtml(item?.description || '')}</p></div>`;
      }).join('') || `<div class="portal-preview__card">${escapeHtml(t('QtilerStories.no_maps'))}</div>`}</div></section>`;
    }
    if (block.type === 'social') {
      return `<section class="portal-preview__section"><h3>${escapeHtml(block.title || '')}</h3>${block.intro ? `<div class="portal-preview__lead portal-preview__richtext">${sanitizePortalRichHtml(block.intro)}</div>` : ''}<div class="portal-preview__social">${(block.items || []).map((item) => `<a class="portal-preview__social-link" href="${escapeHtml(item.url || '#')}" target="_blank" rel="noreferrer">${item.imageUrl ? `<span class="portal-preview__social-image" style="background-image:url('${escapeHtml(item.imageUrl)}')"></span>` : ''}<span>${item.meta ? `<small class="portal-preview__item-meta">${escapeHtml(item.meta)}</small>` : ''}<strong>${escapeHtml(item.title || '')}</strong>${item.text ? `<br>${escapeHtml(item.text)}` : ''}</span></a>`).join('')}</div></section>`;
    }
    return `<section class="portal-preview__section"><h3>${escapeHtml(block.title || '')}</h3>${block.intro ? `<div class="portal-preview__lead portal-preview__richtext">${sanitizePortalRichHtml(block.intro)}</div>` : ''}<div class="portal-preview__cards">${(block.items || []).map((item) => `<article class="portal-preview__card">${item.imageUrl ? `<div class="portal-preview__card-image" style="background-image:url('${escapeHtml(item.imageUrl)}')"></div>` : ''}${item.meta ? `<small class="portal-preview__item-meta">${escapeHtml(item.meta)}</small>` : ''}<strong>${escapeHtml(item.title || '')}</strong><p>${escapeHtml(item.text || '')}</p>${item.label ? `<span class="button small">${escapeHtml(item.label)}</span>` : ''}</article>`).join('')}</div></section>`;
  }).join('')}</div></div>`;
}

/* ── Portal persist ── */
let portalPersistTimer = null;
function queuePortalPersist() {
  clearTimeout(portalPersistTimer);
  portalPersistTimer = setTimeout(() => { savePortalPages().catch(() => {}); }, 1200);
}

async function savePortalPages() {
  await api('/plugins/QtilerStories/api/portal-pages', { method: 'POST', body: portalPagesState });
  addLog(t('QtilerStories.log_saved'), 'ok');
}

async function loadPortalPages() {
  const state = await api('/plugins/QtilerStories/api/portal-pages');
  portalPagesState = state && typeof state === 'object' ? state : { homePageSlug: '', site: {}, gdpr: {}, pages: [] };
  if (!Array.isArray(portalPagesState.pages)) portalPagesState.pages = [];
  if (!selectedPortalPageId && portalPagesState.pages.length) {
    selectedPortalPageId = portalPagesState.pages[0].id;
  }
  renderPortalEditor();
}

/* ── Maps catalog ── */
async function loadPublishedMaps() {
  try {
    const payload = await api('/plugins/QtilerStories/api/maps');
    publishedMaps = Array.isArray(payload?.items) ? payload.items : [];
  } catch {
    publishedMaps = [];
  }
  if (mapsBadge) mapsBadge.textContent = String(publishedMaps.length);
  if (tabMapsBadge) tabMapsBadge.textContent = String(publishedMaps.length);
  renderMapsList();
  renderPortalBackupOptions();
  renderPortalBlocksList(); // refresh map pickers in open editor
}

function renderMapsList() {
  if (!mapsList) return;
  if (!publishedMaps.length) {
    mapsList.innerHTML = `<p class="help">${escapeHtml(t('QtilerStories.no_maps'))}</p>`;
    return;
  }
  mapsList.innerHTML = publishedMaps.map((item) => `
    <article class="published-item">
      <div class="published-item__preview">
        ${item.thumbnailUrl ? `<img src="${escapeHtml(item.thumbnailUrl)}" alt="" loading="lazy" />` : ''}
      </div>
      <div class="published-item__content">
        <div class="published-item__meta">
          <div>
            <strong class="published-item__name">${escapeHtml(item.name || item.profileKey || '')}</strong>
            ${item.description ? `<p class="published-item__desc">${escapeHtml(item.description)}</p>` : ''}
          </div>
          <span class="badge badge--muted">${escapeHtml(item.source || '?')}</span>
        </div>
        <div class="actions">
          <a class="button ghost small" href="${escapeHtml(item.launchUrl || '#')}" target="_blank" rel="noreferrer">Open ↗</a>
        </div>
      </div>
    </article>
  `).join('');
}

/* ── Event handlers ── */

// Tab switching
document.querySelectorAll('.tab-btn[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.getAttribute('data-tab');
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('tab-btn--active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('tab-panel--active'));
    btn.classList.add('tab-btn--active');
    const panel = document.querySelector(`.tab-panel[data-panel="${target}"]`);
    if (panel) panel.classList.add('tab-panel--active');
  });
});

// Global portal sub-tabs (Pages / Identity / GDPR)
const globalTabs = [
  ['gTabPages', 'gPanelPages'],
  ['gTabIdentity', 'gPanelIdentity'],
  ['gTabGdpr', 'gPanelGdpr']
];
globalTabs.forEach(([tabId, panelId]) => {
  const tab = document.getElementById(tabId);
  tab?.addEventListener('click', () => {
    globalTabs.forEach(([tid, pid]) => {
      document.getElementById(tid)?.classList.toggle('is-active', tid === tabId);
      const panel = document.getElementById(pid);
      if (panel) panel.style.display = pid === panelId ? '' : 'none';
    });
  });
});

// Inner page tabs (Content / Settings / Security / Preview)
const pageTabs = [
  ['pTabContent', 'pPanelContent'],
  ['pTabSettings', 'pPanelSettings'],
  ['pTabSecurity', 'pPanelSecurity'],
  ['pTabPreview', 'pPanelPreview']
];
pageTabs.forEach(([tabId, panelId]) => {
  const tab = document.getElementById(tabId);
  tab?.addEventListener('click', () => {
    pageTabs.forEach(([tid, pid]) => {
      document.getElementById(tid)?.classList.toggle('is-active', tid === tabId);
      const panel = document.getElementById(pid);
      if (panel) panel.style.display = pid === panelId ? '' : 'none';
    });
    if (panelId === 'pPanelPreview') renderPortalPreview();
  });
});

// Page CRUD
portalAddPageBtn?.addEventListener('click', () => {
  const page = createDefaultPortalPage();
  portalPagesState.pages = getPortalPages().concat(page);
  if (!portalPagesState.homePageSlug) portalPagesState.homePageSlug = page.slug;
  selectedPortalPageId = page.id;
  renderPortalEditor();
  queuePortalPersist();
});

portalDuplicatePageBtn?.addEventListener('click', () => {
  const page = getSelectedPortalPage();
  if (!page) return;
  const clone = JSON.parse(JSON.stringify(page));
  clone.id = makePortalId('page');
  clone.slug = buildUniquePortalSlug(`${page.slug}-copy`, clone.id);
  clone.title = `${page.title} Copy`;
  clone.navLabel = `${page.navLabel || page.title} Copy`;
  portalPagesState.pages = getPortalPages().concat(clone);
  selectedPortalPageId = clone.id;
  renderPortalEditor();
  queuePortalPersist();
});

portalSaveBtn?.addEventListener('click', async () => {
  portalSaveBtn.disabled = true;
  try {
    await savePortalPages();
  } catch (err) {
    addLog(t('QtilerStories.log_error', { msg: err.message }), 'error');
  } finally {
    portalSaveBtn.disabled = false;
  }
});

// Fullscreen
function setPortalFullscreen(enabled) {
  portalEditorFullscreen = !!enabled;
  portalSection?.classList.toggle('portal-section--fullscreen', portalEditorFullscreen);
}
portalToggleFullscreenBtn?.addEventListener('click', () => setPortalFullscreen(!portalEditorFullscreen));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && portalEditorFullscreen) setPortalFullscreen(false);
});

// Page list interactions
portalPagesList?.addEventListener('click', (event) => {
  const selectBtn = event.target.closest('[data-portal-select]');
  if (selectBtn && !event.target.closest('.portal-pages-list__actions')) {
    selectedPortalPageId = selectBtn.getAttribute('data-portal-select');
    renderPortalEditor();
    return;
  }
  const moveBtn = event.target.closest('[data-portal-move]');
  if (moveBtn) {
    movePortalPage(moveBtn.getAttribute('data-portal-page-id'), moveBtn.getAttribute('data-portal-move'));
    return;
  }
  const delBtn = event.target.closest('[data-portal-delete-page]');
  if (delBtn) deletePortalPage(delBtn.getAttribute('data-portal-delete-page'));
});

function movePortalPage(pageId, direction) {
  const pages = getPortalPages();
  const from = pages.findIndex((p) => p.id === pageId);
  const to = from + (direction === 'up' ? -1 : 1);
  if (from < 0 || to < 0 || to >= pages.length) return;
  const [moved] = portalPagesState.pages.splice(from, 1);
  portalPagesState.pages.splice(to, 0, moved);
  renderPortalPageList();
  queuePortalPersist();
}

function deletePortalPage(pageId) {
  if (!window.confirm(t('QtilerStories.delete_page_confirm'))) return;
  portalPagesState.pages = getPortalPages().filter((p) => p.id !== pageId);
  if (portalPagesState.homePageSlug && !portalPagesState.pages.some((p) => p.slug === portalPagesState.homePageSlug)) {
    portalPagesState.homePageSlug = portalPagesState.pages[0]?.slug || '';
  }
  if (selectedPortalPageId === pageId) {
    selectedPortalPageId = portalPagesState.pages[0]?.id || '';
  }
  renderPortalEditor();
  queuePortalPersist();
}

// Page field inputs
[portalPageTitle, portalPageSlug, portalPageNavLabel, portalPageSummary, portalPageHeaderLogoUrl, portalPageHeaderHeight, portalPageUsers, portalPageRoles]
  .filter(Boolean)
  .forEach((input) => {
    input.addEventListener('input', () => {
      const fieldMap = new Map([
        [portalPageTitle, 'title'],
        [portalPageSlug, 'slug'],
        [portalPageNavLabel, 'navLabel'],
        [portalPageSummary, 'summary'],
        [portalPageHeaderLogoUrl, 'headerLogoUrl'],
        [portalPageHeaderHeight, 'headerHeight'],
        [portalPageUsers, 'visibility.users'],
        [portalPageRoles, 'visibility.roles']
      ]);
      const field = fieldMap.get(input);
      if (field) updatePortalPageField(field, input.value);
    });
  });

portalPageVisibility?.addEventListener('change', () => updatePortalPageField('visibility.access', portalPageVisibility.value));
portalPageShowInNav?.addEventListener('change', () => updatePortalPageField('showInNav', portalPageShowInNav.checked));
portalPageShowHeader?.addEventListener('change', () => updatePortalPageField('showHeader', portalPageShowHeader.checked));
portalPageIsHome?.addEventListener('change', () => {
  const page = getSelectedPortalPage();
  if (!page) return;
  if (portalPageIsHome.checked) portalPagesState.homePageSlug = page.slug;
  else if (portalPagesState.homePageSlug === page.slug) portalPagesState.homePageSlug = getPortalPages()[0]?.slug || '';
  renderPortalPageList();
  queuePortalPersist();
});

// Template
portalApplyTemplateBtn?.addEventListener('click', () => {
  const page = getSelectedPortalPage();
  if (!page) return;
  const template = buildPortalTemplate(portalTemplateSelect?.value || 'story');
  page.title = template.title;
  page.navLabel = template.navLabel;
  page.summary = template.summary;
  page.blocks = template.blocks.map((block) => ({ ...block, id: makePortalId(block.type || 'block') }));
  renderPortalEditor();
  queuePortalPersist();
});

// Blocks
portalAddBlockBtn?.addEventListener('click', () => {
  const page = getSelectedPortalPage();
  if (!page) return;
  page.blocks = [...(page.blocks || []), createDefaultPortalBlock('text')];
  renderPortalBlocksList();
  renderPortalPreview();
  queuePortalPersist();
});

portalBlocksList?.addEventListener('click', (event) => {
  const moveBtn = event.target.closest('[data-portal-block-move]');
  if (moveBtn) {
    const page = getSelectedPortalPage();
    if (!page) return;
    const id = moveBtn.getAttribute('data-portal-block-id');
    const from = (page.blocks || []).findIndex((b) => b.id === id);
    const to = from + (moveBtn.getAttribute('data-portal-block-move') === 'up' ? -1 : 1);
    if (from < 0 || to < 0 || to >= page.blocks.length) return;
    const [moved] = page.blocks.splice(from, 1);
    page.blocks.splice(to, 0, moved);
    renderPortalBlocksList();
    renderPortalPreview();
    queuePortalPersist();
    return;
  }
  const delBtn = event.target.closest('[data-portal-block-delete]');
  if (delBtn) {
    const page = getSelectedPortalPage();
    if (!page) return;
    page.blocks = (page.blocks || []).filter((b) => b.id !== delBtn.getAttribute('data-portal-block-delete'));
    renderPortalBlocksList();
    renderPortalPreview();
    queuePortalPersist();
    return;
  }
  const addItemBtn = event.target.closest('[data-portal-add-item]');
  if (addItemBtn) {
    const page = getSelectedPortalPage();
    const block = (page?.blocks || []).find((b) => b.id === addItemBtn.getAttribute('data-portal-add-item'));
    if (!block) return;
    block.items = [...(block.items || []), { id: makePortalId('item'), title: '', text: '', url: '', label: '', icon: '', meta: '', imageUrl: '' }];
    renderPortalBlocksList();
    queuePortalPersist();
    return;
  }
  const delItemBtn = event.target.closest('[data-portal-item-delete]');
  if (delItemBtn) {
    const page = getSelectedPortalPage();
    const block = (page?.blocks || []).find((b) => b.id === delItemBtn.getAttribute('data-portal-block-id'));
    const idx = Number(delItemBtn.getAttribute('data-item-index'));
    if (!block || !Array.isArray(block.items)) return;
    block.items.splice(idx, 1);
    renderPortalBlocksList();
    renderPortalPreview();
    queuePortalPersist();
  }
});

portalBlocksList?.addEventListener('input', (event) => {
  const blockField = event.target.closest('[data-portal-block-field]');
  if (blockField) {
    const valueKind = blockField.getAttribute('data-value-kind') || (blockField.type === 'checkbox' ? 'bool' : 'text');
    const nextValue = valueKind === 'multi-option' ? getPortalSelectedOptions(blockField) : (blockField.type === 'checkbox' ? blockField.checked : blockField.value);
    updatePortalBlockField(blockField.getAttribute('data-portal-block-id'), blockField.getAttribute('data-portal-block-field'), nextValue);
    return;
  }
  const itemField = event.target.closest('[data-portal-item-field]');
  if (itemField) {
    updatePortalItemField(itemField.getAttribute('data-portal-block-id'), Number(itemField.getAttribute('data-item-index')), itemField.getAttribute('data-portal-item-field'), itemField.value);
  }
});

portalBlocksList?.addEventListener('change', (event) => {
  const blockField = event.target.closest('[data-portal-block-field]');
  if (blockField && blockField.tagName === 'SELECT') {
    const valueKind = blockField.getAttribute('data-value-kind') || 'text';
    updatePortalBlockField(blockField.getAttribute('data-portal-block-id'), blockField.getAttribute('data-portal-block-field'), valueKind === 'multi-option' ? getPortalSelectedOptions(blockField) : blockField.value);
  }
});

// Preview device buttons
portalPreviewDeviceButtons.forEach((button) => {
  button.addEventListener('click', () => {
    portalPreviewDevice = button.getAttribute('data-portal-preview-device') || 'desktop';
    renderPortalPreview();
  });
});

// Site identity inputs
[
  [portalSiteTitle, 'title'],
  [portalSiteSubtitle, 'subtitle'],
  [portalSiteLogoUrl, 'headerLogoUrl'],
  [portalSiteHeaderHeight, 'headerHeight'],
  [portalSiteHeaderFont, 'headerFont'],
  [portalSiteHeaderColor1, 'headerColor1'],
  [portalSiteHeaderColor2, 'headerColor2'],
  [portalSiteHeaderTextColor, 'headerTextColor'],
  [portalSiteHeaderBackgroundUrl, 'headerBackgroundUrl'],
  [portalSiteFooterText, 'footerText'],
  [portalSiteFooterLinkLabel, 'footerLinkLabel'],
  [portalSiteFooterLink, 'footerLink'],
  [portalSiteFooterBackgroundColor, 'footerBackgroundColor'],
  [portalSiteFooterTextColor, 'footerTextColor'],
  [portalSiteFooterLinkColor, 'footerLinkColor']
].forEach(([input, field]) => {
  if (!input) return;
  const handler = () => {
    portalPagesState.site = { ...(portalPagesState.site || {}), [field]: field === 'headerHeight' ? (Number(input.value) || 120) : input.value };
    queuePortalPersist();
  };
  input.addEventListener('input', handler);
  input.addEventListener('change', handler);
});

// GDPR inputs
portalGdprEnabled?.addEventListener('change', () => {
  portalPagesState.gdpr = { ...(portalPagesState.gdpr || {}), enabled: portalGdprEnabled.checked };
  queuePortalPersist();
});
[
  [portalGdprCompany, 'companyName'],
  [portalGdprTitle, 'bannerTitle'],
  [portalGdprPrivacyUrl, 'privacyUrl'],
  [portalGdprCookieUrl, 'cookiePolicyUrl'],
  [portalGdprContactUrl, 'contactUrl'],
  [portalGdprText, 'bannerText'],
  [portalGdprAcceptLabel, 'acceptLabel'],
  [portalGdprRejectLabel, 'rejectLabel'],
  [portalGdprManageLabel, 'manageLabel']
].forEach(([input, field]) => {
  if (!input) return;
  input.addEventListener('input', () => {
    portalPagesState.gdpr = { ...(portalPagesState.gdpr || {}), [field]: input.value };
    queuePortalPersist();
  });
});

// Backup export/import
function downloadJsonFile(data, fileName) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

portalExportBackupBtn?.addEventListener('click', async () => {
  portalExportBackupBtn.disabled = true;
  try {
    const pageIds = getPortalSelectedOptions(portalBackupPagesSelect);
    const mapKeys = getPortalSelectedOptions(portalBackupMapsSelect);
    const backup = await api('/plugins/QtilerStories/api/portal-backup/export', {
      method: 'POST',
      body: { pageIds, mapKeys }
    });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadJsonFile(backup, `qtiler-stories-backup-${stamp}.json`);
    addLog(t('QtilerStories.portal_backup_exported'), 'ok');
  } catch (err) {
    addLog(t('QtilerStories.log_error', { msg: err.message }), 'error');
  } finally {
    portalExportBackupBtn.disabled = false;
  }
});

portalImportBackupBtn?.addEventListener('click', () => {
  portalImportBackupInput?.click();
});

portalImportBackupInput?.addEventListener('change', async () => {
  const file = portalImportBackupInput.files?.[0];
  portalImportBackupInput.value = '';
  if (!file) return;
  portalImportBackupBtn.disabled = true;
  try {
    const backup = JSON.parse(await file.text());
    const result = await api('/plugins/QtilerStories/api/portal-backup/import', {
      method: 'POST',
      body: { backup, replacePortal: portalImportReplacePortal?.checked !== false }
    });
    await loadPortalPages();
    addLog(t('QtilerStories.portal_backup_imported', { n: result?.pages || 0 }), 'ok');
  } catch (err) {
    addLog(t('QtilerStories.log_error', { msg: err.message }), 'error');
  } finally {
    portalImportBackupBtn.disabled = false;
  }
});

/* ── Init ── */
(async function init() {
  applyI18n();
  try {
    await Promise.allSettled([loadPortalPages(), loadPublishedMaps()]);
    renderPortalEditor();
  } catch (err) {
    addLog(t('QtilerStories.log_error', { msg: err.message }), 'error');
  }
})();
