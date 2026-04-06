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
    pluginReadmeLabel: 'README',
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
    licenseInstallInvalid: 'This license key is not valid. Contact MundoGIS (support@mundogis.se) to renew.',
    searchableTitle: 'Searchable layers',
    searchableSubtitle: 'Enable searchable layers and select which columns are used for searching and labels.',
    searchableSaveBtn: 'Save searchable config',
    searchableNoProject: 'No project available for searchable layers.',
    searchableNoProjectSelected: 'No project selected.',
    searchableLoadError: 'Failed to load layer information.',
    searchableSaveOk: 'Searchable layers configuration saved.',
    searchableSaveError: 'Failed to save configuration.',
    searchableColumns: 'Search columns',
    searchableTitleField: 'Title field',
    searchableIdAttribute: 'ID attribute',
    searchableSearchAttribute: 'Search attribute',
    searchableGeometryAttribute: 'Geometry attribute',
    searchableGeometryAuto: 'Geometry attribute (auto): {value}',
    searchableGeometryAutoMissing: 'Geometry attribute (auto): not detected',
    searchableHintText: 'Hint text',
    searchableHintPlaceholder: 'Search...',
    searchableChooseColumns: 'Select one or more columns to be searchable.',
    searchableNoColumns: 'No layer attributes detected for this layer.',
    searchableLoadingColumns: 'Loading layer attributes...',
    searchableConfigureTitle: 'Configure searchable columns',
    searchableConfigureIntro: 'Select search columns and attributes for {layer}.',
    searchableApply: 'Apply',
    searchableCancel: 'Cancel'
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
    pluginReadmeLabel: 'README',
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
    licenseInstallInvalid: 'Esta licencia no es válida. Contacta a MundoGIS (support@mundogis.se) para renovar.',
    searchableTitle: 'Capas buscables',
    searchableSubtitle: 'Activa capas buscables y selecciona qué columnas se usan para buscar y mostrar etiquetas.',
    searchableSaveBtn: 'Guardar configuración buscable',
    searchableNoProject: 'No hay proyecto disponible para capas buscables.',
    searchableNoProjectSelected: 'No hay proyecto seleccionado.',
    searchableLoadError: 'No se pudo cargar la información de capas.',
    searchableSaveOk: 'Configuración de capas buscables guardada.',
    searchableSaveError: 'No se pudo guardar la configuración.',
    searchableColumns: 'Columnas de búsqueda',
    searchableTitleField: 'Campo de título',
    searchableIdAttribute: 'Atributo ID',
    searchableSearchAttribute: 'Atributo de búsqueda',
    searchableGeometryAttribute: 'Atributo geométrico',
    searchableGeometryAuto: 'Atributo geométrico (auto): {value}',
    searchableGeometryAutoMissing: 'Atributo geométrico (auto): no detectado',
    searchableHintText: 'Texto de ayuda',
    searchableHintPlaceholder: 'Search...',
    searchableChooseColumns: 'Selecciona una o más columnas para la búsqueda.',
    searchableNoColumns: 'No se detectaron atributos para esta capa.',
    searchableLoadingColumns: 'Cargando atributos de la capa...',
    searchableConfigureTitle: 'Configurar columnas buscables',
    searchableConfigureIntro: 'Selecciona columnas de búsqueda y atributos para {layer}.',
    searchableApply: 'Aplicar',
    searchableCancel: 'Cancelar'
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
    pluginReadmeLabel: 'README',
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
    licenseInstallInvalid: 'Den här licensen är ogiltig. Kontakta MundoGIS (support@mundogis.se) för att förnya.',
    searchableTitle: 'Sökbara lager',
    searchableSubtitle: 'Aktivera sökbara lager och välj vilka kolumner som används för sökning och etiketter.',
    searchableSaveBtn: 'Spara sökbar konfiguration',
    searchableNoProject: 'Inget projekt tillgängligt för sökbara lager.',
    searchableNoProjectSelected: 'Inget projekt valt.',
    searchableLoadError: 'Kunde inte läsa in lagerinformation.',
    searchableSaveOk: 'Konfiguration för sökbara lager sparades.',
    searchableSaveError: 'Kunde inte spara konfigurationen.',
    searchableColumns: 'Sökkolumner',
    searchableTitleField: 'Titelfält',
    searchableIdAttribute: 'ID-attribut',
    searchableSearchAttribute: 'Sökattribut',
    searchableGeometryAttribute: 'Geometriattribut',
    searchableGeometryAuto: 'Geometriattribut (auto): {value}',
    searchableGeometryAutoMissing: 'Geometriattribut (auto): kunde inte hittas',
    searchableHintText: 'Hjälptext',
    searchableHintPlaceholder: 'Search...',
    searchableChooseColumns: 'Välj en eller flera kolumner som ska vara sökbara.',
    searchableNoColumns: 'Inga lagerattribut hittades för detta lager.',
    searchableLoadingColumns: 'Läser in lagerattribut...',
    searchableConfigureTitle: 'Konfigurera sökbara kolumner',
    searchableConfigureIntro: 'Välj sökkolumner och attribut för {layer}.',
    searchableApply: 'Använd',
    searchableCancel: 'Avbryt'
  }
};

const PLUGIN_DOCS = {
  Qrigo: {
    en: {
      description: 'Connects Qtiler projects to Origo with guided code snippets and layer setup helpers.',
      readme: [
        'Open a layer in the dashboard and click the Origo button in layer details.',
        'The Origo panel shows available layers and clearly indicates which ones are searchable and editable.',
        'Use the Info button to copy ready-to-use code for layers, source, and search configuration in Origo.',
        'Apply those snippets in your Origo app config, then publish and test the full flow.'
      ]
    },
    es: {
      description: 'Conecta proyectos de Qtiler con Origo usando snippets guiados y utilidades de configuración de capas.',
      readme: [
        'Abre una capa en el dashboard y pulsa el botón de Origo en los detalles de la capa.',
        'El panel de Origo muestra las capas disponibles e indica claramente cuáles son buscables y editables.',
        'Usa el botón Info para copiar el código listo de layers, source y search para Origo.',
        'Aplica esos snippets en la configuración de tu app Origo, publica y valida el flujo completo.'
      ]
    },
    sv: {
      description: 'Kopplar Qtiler-projekt till Origo med guidande kodsnuttar och verktyg for lagerkonfiguration.',
      readme: [
        'Oppna ett lager i dashboarden och klicka pa Origo-knappen i lagerdetaljer.',
        'Origo-panelen visar tillgangliga lager och markerar tydligt vilka som ar sokbara och redigerbara.',
        'Anvand Info-knappen for att kopiera fardig kod for layers, source och search i Origo.',
        'Klistra in kodsnuttarna i din Origo-konfiguration, publicera och testa hela flodet.'
      ]
    }
  },
  QtilerAuth: {
    en: {
      description: 'Adds authentication, user roles, and project access control for secure Qtiler deployments.',
      readme: [
        'Manage users, roles, account status, passwords, and API keys from the admin UI.',
        'Set projects as public/private and assign private access per user.',
        'Use session cookie, bearer token, basic auth, or api_key for external clients.',
        'Use this plugin as the security layer for dashboard, services, and plugin endpoints.'
      ]
    },
    es: {
      description: 'Agrega autenticacion, roles de usuario y control de acceso por proyecto para despliegues seguros de Qtiler.',
      readme: [
        'Gestiona usuarios, roles, estado de cuenta, contrasenas y API keys desde la interfaz admin.',
        'Define proyectos como publicos/privados y asigna acceso privado por usuario.',
        'Usa cookie de sesion, bearer token, basic auth o api_key para clientes externos.',
        'Utiliza este plugin como capa de seguridad para dashboard, servicios y endpoints de plugins.'
      ]
    },
    sv: {
      description: 'Lagger till autentisering, anvandarrolller och projektbehorighet for sakra Qtiler-installationer.',
      readme: [
        'Hantera anvandare, roller, kontostatus, losenord och API-nycklar i admin-granssnittet.',
        'Markera projekt som publika/privata och tilldela privat atkomst per anvandare.',
        'Anvand sessionscookie, bearer-token, basic auth eller api_key for externa klienter.',
        'Anvand pluginet som sakerhetslager for dashboard, tjanster och plugin-endpoints.'
      ]
    }
  },
  VectorTiles: {
    en: {
      description: 'Generates vector tiles from QGIS projects and serves style, tilejson, and tile endpoints for clients.',
      readme: [
        'Create vector-tile caches from project layers and expose them via HTTP endpoints.',
        'Use style and tilejson URLs directly in QGIS, Origo, MapLibre, or OpenLayers clients.',
        'On-demand mode can generate missing tiles when clients request uncached zoom/x/y tiles.',
        'For best UX, pre-generate strategic zoom levels for high-traffic areas.'
      ]
    },
    es: {
      description: 'Genera vector tiles desde proyectos QGIS y publica endpoints de style, tilejson y tiles para clientes.',
      readme: [
        'Crea cache de vector tiles desde capas del proyecto y exponla por endpoints HTTP.',
        'Usa URLs de style y tilejson directamente en QGIS, Origo, MapLibre u OpenLayers.',
        'El modo on-demand puede generar tiles faltantes cuando se solicitan zoom/x/y sin cache.',
        'Para mejor experiencia, pre-genera niveles de zoom estrategicos en zonas de alto trafico.'
      ]
    },
    sv: {
      description: 'Genererar vector tiles fran QGIS-projekt och exponerar style-, tilejson- och tile-endpoints for klienter.',
      readme: [
        'Skapa vector tile-cache fran projektlager och exponera den via HTTP-endpoints.',
        'Anvand style- och tilejson-URL:er direkt i QGIS, Origo, MapLibre eller OpenLayers.',
        'On-demand-lage kan generera saknade tiles nar klienter begar zoom/x/y som inte finns i cache.',
        'For bast upplevelse: for-generera strategiska zoomnivaer for hogtrafikerade omraden.'
      ]
    }
  },
  ProjectSearch: {
    en: {
      description: 'Adds fast project filtering in the dashboard so users can find projects quickly.',
      readme: [
        'Shows a search field above projects in the dashboard view.',
        'Filters by project name and identifier while you type.',
        'Improves navigation for deployments with many projects.',
        'Use together with QtilerAuth to combine access rules with quick discovery.'
      ]
    },
    es: {
      description: 'Agrega filtrado rapido de proyectos en el dashboard para encontrar proyectos al instante.',
      readme: [
        'Muestra un campo de busqueda sobre los proyectos en el dashboard.',
        'Filtra por nombre e identificador del proyecto mientras escribes.',
        'Mejora la navegacion en despliegues con muchos proyectos.',
        'Combinado con QtilerAuth, une reglas de acceso con descubrimiento rapido.'
      ]
    },
    sv: {
      description: 'Lagger till snabb projektfiltrering i dashboarden sa anvandare hittar projekt direkt.',
      readme: [
        'Visar ett sokfalt ovanfor projekten i dashboardvyn.',
        'Filtrerar pa projektnamn och identifierare medan du skriver.',
        'Forbattrar navigering i installationer med manga projekt.',
        'Tillsammans med QtilerAuth kombineras behorighetsregler med snabb sokning.'
      ]
    }
  }
};

function getPluginDocs(name) {
  const lang = window.qtilerLang ? window.qtilerLang.get() : 'en';
  const pluginMeta = state.plugins?.meta?.[name] || null;
  const manifestDocs = pluginMeta && pluginMeta.docs && typeof pluginMeta.docs === 'object'
    ? pluginMeta.docs
    : null;
  if (manifestDocs) {
    const byLang = manifestDocs[lang] || manifestDocs.en || null;
    if (byLang) return byLang;
  }

  // Fallback for older plugin packages without docs in plugin.json.
  const fallback = PLUGIN_DOCS[name] || null;
  if (fallback) return fallback[lang] || fallback.en || null;

  const manifestDescription = String(pluginMeta?.description || '').trim();
  return manifestDescription ? { description: manifestDescription, readme: [] } : null;
}

const state = {
  plugins: { enabled: [], installed: [], licenses: {}, instanceId: null, securityWarnings: [], meta: {} }
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
  projectId: null,
  layerAttributes: {},
  loadingAttributes: false
};
let qrigoEnabled = false;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeLayerId(name) {
  return String(name || '').replace(/[^A-Za-z0-9_-]/g, '_');
}

function toSafeWfsTypeName(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  return raw.split(':').map((chunk) => {
    let sanitized = chunk.replace(/[^A-Za-z0-9_]/g, '_');
    if (!sanitized) sanitized = 'layer';
    if (!/^[A-Za-z_]/.test(sanitized)) sanitized = `_${sanitized}`;
    return sanitized;
  }).join(':');
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function extractAttributeMetadata(attributes) {
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

  return {
    all: uniqueValues(normalized.map((attr) => attr.name)),
    nonGeometry: uniqueValues((nonGeometry.length ? nonGeometry : normalized).map((attr) => attr.name)),
    geometry: uniqueValues(geometry.map((attr) => attr.name))
  };
}

async function fetchLayerAttributeMetadata(projectId, layerName) {
  const candidates = uniqueValues([String(layerName || '').trim(), toSafeWfsTypeName(layerName)]);
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const payload = await api(`/origo/wfs-attributes?project=${encodeURIComponent(projectId)}&layer=${encodeURIComponent(candidate)}`);
      return extractAttributeMetadata(payload?.attributes);
    } catch (err) {
      console.warn('Failed to fetch layer attributes', { layerName: candidate, error: String(err?.message || err) });
    }
  }
  return { all: [], nonGeometry: [], geometry: [] };
}

async function loadLayerAttributes(projectId, layers) {
  const list = Array.isArray(layers) ? layers : [];
  const entries = await Promise.all(list.map(async (layer) => {
    const metadata = await fetchLayerAttributeMetadata(projectId, layer.name);
    return [layer.name, metadata];
  }));
  searchableState.layerAttributes = Object.fromEntries(entries);
}

function syncDependentSelectToFields(fieldsSelect, dependentSelect, preferredValue = '') {
  if (!fieldsSelect || !dependentSelect) return;
  const selected = Array.from(fieldsSelect.selectedOptions).map((option) => option.value).filter(Boolean);
  dependentSelect.innerHTML = selected
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join('');
  if (!selected.length) {
    dependentSelect.value = '';
    dependentSelect.disabled = true;
    return;
  }
  dependentSelect.disabled = false;
  if (preferredValue && selected.includes(preferredValue)) {
    dependentSelect.value = preferredValue;
    return;
  }
  if (!selected.includes(dependentSelect.value)) {
    dependentSelect.value = selected[0];
  }
}

function pickPreferredAttribute(candidates, fallbackList, hardFallback = '') {
  const list = Array.isArray(fallbackList) ? fallbackList : [];
  for (const candidate of candidates) {
    if (candidate && list.includes(candidate)) return candidate;
  }
  return list[0] || hardFallback;
}

function looksLikeGeometryName(value) {
  const n = String(value || '').trim().toLowerCase();
  if (!n) return false;
  return /^(geom|the_geom|geometry|wkb_geometry)$/.test(n) || /(geom|geometry|wkb|wkt)/.test(n);
}

function detectGeometryAttribute(layer, layerMeta, configuredGeometry = '') {
  const all = Array.isArray(layerMeta?.all) ? layerMeta.all : [];
  const explicitGeometryCols = Array.isArray(layerMeta?.geometry) ? layerMeta.geometry : [];
  const namedGeometryCols = all.filter((name) => looksLikeGeometryName(name));
  const geometryCols = explicitGeometryCols.length
    ? explicitGeometryCols
    : (namedGeometryCols.length ? namedGeometryCols : []);
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
}

function openSearchableConfigModal({
  layerTitle,
  availableColumns,
  initialSearchAttribute,
  initialIdAttribute,
  initialHintText,
  geometryAttribute
}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'searchable-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'searchable-modal';

    const title = document.createElement('h3');
    title.textContent = t('searchableConfigureTitle');

    const intro = document.createElement('p');
    intro.className = 'admin-hint';
    intro.textContent = t('searchableConfigureIntro', { layer: layerTitle });

    const searchWrap = document.createElement('div');
    searchWrap.className = 'form-field';
    const searchLabel = document.createElement('label');
    searchLabel.textContent = t('searchableSearchAttribute');
    const searchSelect = document.createElement('select');
    searchSelect.className = 'searchable-modal-select';
    searchSelect.innerHTML = availableColumns
      .map((column) => {
        const selected = initialSearchAttribute === column ? ' selected' : '';
        return `<option value="${escapeHtml(column)}"${selected}>${escapeHtml(column)}</option>`;
      })
      .join('');
    searchWrap.append(searchLabel, searchSelect);

    const idWrap = document.createElement('div');
    idWrap.className = 'form-field';
    const idLabel = document.createElement('label');
    idLabel.textContent = t('searchableIdAttribute');
    const idSelect = document.createElement('select');
    idSelect.className = 'searchable-modal-select';
    idSelect.innerHTML = availableColumns
      .map((column) => {
        const selected = initialIdAttribute === column ? ' selected' : '';
        return `<option value="${escapeHtml(column)}"${selected}>${escapeHtml(column)}</option>`;
      })
      .join('');
    idWrap.append(idLabel, idSelect);

    const hintWrap = document.createElement('div');
    hintWrap.className = 'form-field';
    const hintLabel = document.createElement('label');
    hintLabel.textContent = t('searchableHintText');
    const hintInput = document.createElement('input');
    hintInput.type = 'text';
    hintInput.className = 'searchable-modal-select';
    hintInput.value = initialHintText || t('searchableHintPlaceholder');
    hintInput.placeholder = t('searchableHintPlaceholder');
    hintWrap.append(hintLabel, hintInput);

    const geometryWrap = document.createElement('div');
    geometryWrap.className = 'form-field';
    const geometryLabel = document.createElement('label');
    geometryLabel.textContent = t('searchableGeometryAttribute');
    const geometryValue = document.createElement('div');
    geometryValue.className = 'searchable-geometry-auto';
    geometryValue.textContent = geometryAttribute
      ? t('searchableGeometryAuto', { value: geometryAttribute })
      : t('searchableGeometryAutoMissing');
    geometryWrap.append(geometryLabel, geometryValue);

    const actions = document.createElement('div');
    actions.className = 'searchable-modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'button secondary';
    cancelBtn.textContent = t('searchableCancel');

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'button';
    applyBtn.textContent = t('searchableApply');

    const cleanup = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        cleanup();
        resolve({ confirmed: false });
      }
    };

    cancelBtn.addEventListener('click', () => {
      cleanup();
      resolve({ confirmed: false });
    });

    applyBtn.addEventListener('click', () => {
      const searchAttribute = String(searchSelect.value || '').trim();
      const idAttribute = String(idSelect.value || '').trim();
      const hintText = String(hintInput.value || '').trim() || t('searchableHintPlaceholder');
      if (!searchAttribute || !idAttribute) {
        return;
      }
      cleanup();
      resolve({ confirmed: true, searchAttribute, idAttribute, hintText });
    });

    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) {
        cleanup();
        resolve({ confirmed: false });
      }
    });

    actions.append(cancelBtn, applyBtn);
    modal.append(title, intro, searchWrap, idWrap, hintWrap, geometryWrap, actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
  });
}

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

    const docs = getPluginDocs(name);
    const docsWrap = document.createElement('div');
    docsWrap.className = 'plugin-card__docs';
    if (docs && docs.description) {
      const desc = document.createElement('p');
      desc.className = 'plugin-card__description';
      desc.textContent = docs.description;
      docsWrap.appendChild(desc);
    }
    if (docs && Array.isArray(docs.readme) && docs.readme.length) {
      const readmeTitle = document.createElement('h4');
      readmeTitle.className = 'plugin-card__readme-title';
      readmeTitle.textContent = t('pluginReadmeLabel');
      const readmeList = document.createElement('ul');
      readmeList.className = 'plugin-card__readme-list';
      docs.readme.forEach((line) => {
        const li = document.createElement('li');
        li.textContent = line;
        readmeList.appendChild(li);
      });
      docsWrap.append(readmeTitle, readmeList);
    }

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
    if (docsWrap.childElementCount) {
      card.append(docsWrap);
    }
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
    state.plugins.meta = payload?.meta && typeof payload.meta === 'object' ? payload.meta : {};
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
    const layerMeta = searchableState.layerAttributes?.[layer.name] || { all: [], nonGeometry: [], geometry: [] };
    const hasAttributes = Array.isArray(layerMeta.all);
    const isLoadingColumns = searchableState.loadingAttributes && !hasAttributes;
    const availableColumns = Array.isArray(layerMeta.nonGeometry) && layerMeta.nonGeometry.length
      ? layerMeta.nonGeometry
      : (Array.isArray(layerMeta.all) ? layerMeta.all : []);
    const selectedSearchAttribute = pickPreferredAttribute(
      [config.searchAttribute, config.titleField, (Array.isArray(config.fields) ? config.fields[0] : '')],
      availableColumns
    );
    const selectedIdAttribute = pickPreferredAttribute(
      [config.idAttribute, 'GID', 'gid', 'id', 'ID', 'fid', 'FID'],
      availableColumns
    );
    const selectedGeometryAttribute = detectGeometryAttribute(layer, layerMeta, config.geometryAttribute);
    const selectedHintText = String(config.hintText || '').trim() || t('searchableHintPlaceholder');

    const layerEl = document.createElement('div');
    layerEl.className = 'searchable-layer-item';
    layerEl.dataset.layerName = layer.name;

    const safeName = safeLayerId(layer.name);
    const searchOptions = availableColumns.map((column) => {
      const isSelected = selectedSearchAttribute === column ? ' selected' : '';
      return `<option value="${escapeHtml(column)}"${isSelected}>${escapeHtml(column)}</option>`;
    }).join('');
    const idOptions = availableColumns.map((column) => {
      const isSelected = selectedIdAttribute === column ? ' selected' : '';
      return `<option value="${escapeHtml(column)}"${isSelected}>${escapeHtml(column)}</option>`;
    }).join('');
    const fieldsHiddenClass = isSearchable ? '' : ' is-hidden';
    const helperText = isLoadingColumns
      ? t('searchableLoadingColumns')
      : (availableColumns.length > 0 ? t('searchableChooseColumns') : t('searchableNoColumns'));
    const disableSelectors = isLoadingColumns || !availableColumns.length;
    const geometryAutoText = selectedGeometryAttribute
      ? t('searchableGeometryAuto', { value: selectedGeometryAttribute })
      : t('searchableGeometryAutoMissing');
    layerEl.innerHTML = `
      <div class="form-field form-field-checkbox">
        <input type="checkbox" id="searchable-${safeName}" ${isSearchable ? 'checked' : ''}>
        <label for="searchable-${safeName}">${escapeHtml(layer.title || layer.name)}</label>
      </div>
      <div class="searchable-layer-fields${fieldsHiddenClass}">
        <div class="form-field">
          <label for="searchAttribute-${safeName}">${t('searchableSearchAttribute')}</label>
          <select id="searchAttribute-${safeName}" ${disableSelectors ? 'disabled' : ''}>
            ${searchOptions}
          </select>
        </div>
        <div class="form-field">
          <label for="idAttribute-${safeName}">${t('searchableIdAttribute')}</label>
          <select id="idAttribute-${safeName}" ${disableSelectors ? 'disabled' : ''}>
            ${idOptions}
          </select>
        </div>
        <div class="form-field">
          <label for="hintText-${safeName}">${t('searchableHintText')}</label>
          <input type="text" id="hintText-${safeName}" value="${escapeHtml(selectedHintText)}" placeholder="${escapeHtml(t('searchableHintPlaceholder'))}" ${disableSelectors ? 'disabled' : ''}>
        </div>
        <div class="form-field">
          <label>${t('searchableGeometryAttribute')}</label>
          <div class="searchable-geometry-auto">${escapeHtml(geometryAutoText)}</div>
        </div>
        <p class="admin-hint searchable-columns-help${isLoadingColumns ? ' is-loading' : ''}">${helperText}</p>
      </div>
    `;
    layerEl.dataset.geometryAttribute = selectedGeometryAttribute;
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
    el.addEventListener('change', async () => {
      const container = el.closest('.searchable-layer-item');
      const fieldsBlock = container?.querySelector('.searchable-layer-fields');
      if (!container) return;

      if (!el.checked) {
        if (fieldsBlock) fieldsBlock.classList.add('is-hidden');
        scheduleSave();
        return;
      }

      const layerName = String(container.dataset.layerName || '');
      const safeName = safeLayerId(layerName);
      const searchSelect = container.querySelector(`#searchAttribute-${safeName}`);
      const idSelect = container.querySelector(`#idAttribute-${safeName}`);
      const hintInput = container.querySelector(`#hintText-${safeName}`);
      const layerLabel = container.querySelector(`label[for="searchable-${safeName}"]`)?.textContent || layerName;
      const layerInfo = searchableState.allWfsLayers.find((l) => String(l.name || '') === layerName) || {};
      const layerMeta = searchableState.layerAttributes?.[layerName] || { all: [], nonGeometry: [], geometry: [] };
      const availableColumns = Array.isArray(layerMeta.nonGeometry) && layerMeta.nonGeometry.length
        ? layerMeta.nonGeometry
        : (Array.isArray(layerMeta.all) ? layerMeta.all : []);
      const detectedGeometryAttribute = detectGeometryAttribute(layerInfo, layerMeta, String(container.dataset.geometryAttribute || ''));

      if (!availableColumns.length) {
        el.checked = false;
        if (fieldsBlock) fieldsBlock.classList.add('is-hidden');
        showMessage('error', t('searchableNoColumns'));
        return;
      }

      const initialSearchAttribute = searchSelect ? String(searchSelect.value || '') : '';
      const initialIdAttribute = idSelect ? String(idSelect.value || '') : '';
      const initialHintText = hintInput ? String(hintInput.value || '') : '';

      const result = await openSearchableConfigModal({
        layerTitle: layerLabel,
        availableColumns,
        initialSearchAttribute: initialSearchAttribute || availableColumns[0],
        initialIdAttribute: initialIdAttribute || pickPreferredAttribute(['GID', 'gid', 'id', 'ID', 'fid', 'FID'], availableColumns),
        initialHintText: initialHintText || t('searchableHintPlaceholder'),
        geometryAttribute: detectedGeometryAttribute
      });

      if (!result.confirmed) {
        el.checked = false;
        if (fieldsBlock) fieldsBlock.classList.add('is-hidden');
        return;
      }

      if (searchSelect) {
        searchSelect.value = result.searchAttribute;
      }
      if (idSelect) {
        idSelect.value = result.idAttribute;
      }
      if (hintInput) {
        hintInput.value = result.hintText;
      }
      container.dataset.geometryAttribute = detectedGeometryAttribute;

      if (fieldsBlock) fieldsBlock.classList.remove('is-hidden');
      scheduleSave();
    });
  });
  searchableLayersContainer.querySelectorAll('select,input[type="text"]').forEach((el) => {
    const eventName = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(eventName, scheduleSave);
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
    showMessage('error', t('searchableNoProject'));
    return;
  }
  try {
    const [layersResponse, searchableResponse] = await Promise.all([
      api(`/projects/${projectId}/layers`),
      api(`/projects/${projectId}/searchable`)
    ]);

    const allLayers = layersResponse.layers || [];
    searchableState.allWfsLayers = allLayers.filter(l => l.type === 'WFS' || l.kind === 'vector' || !!l.geometry_type);
    searchableState.searchable = Array.isArray(searchableResponse) ? searchableResponse : [];

    if (searchableState.allWfsLayers.length > 0) {
      if (searchableLayersSection) searchableLayersSection.hidden = false;
      searchableState.loadingAttributes = true;
      renderSearchableLayers();
      await loadLayerAttributes(projectId, searchableState.allWfsLayers);
      searchableState.loadingAttributes = false;
      renderSearchableLayers();
    } else {
      if (searchableLayersSection) searchableLayersSection.hidden = true;
    }
  } catch (err) {
    searchableState.loadingAttributes = false;
    showMessage('error', t('searchableLoadError'));
    console.error(err);
    if (searchableLayersSection) searchableLayersSection.hidden = true;
  }
}

async function saveSearchableLayers() {
  if (!hasSearchableUi()) return;
  const projectId = await resolveSearchableProjectId();
  if (!projectId) {
    showMessage('error', t('searchableNoProjectSelected'));
    return;
  }
  const payload = [];
  const layerItems = searchableLayersContainer.querySelectorAll('.searchable-layer-item');

  layerItems.forEach(item => {
    const layerName = item.dataset.layerName;
    const isChecked = item.querySelector('input[type="checkbox"]').checked;

    if (isChecked) {
      const safeName = safeLayerId(layerName);
      const searchSelect = item.querySelector(`#searchAttribute-${safeName}`);
      const idSelect = item.querySelector(`#idAttribute-${safeName}`);
      const hintInput = item.querySelector(`#hintText-${safeName}`);
      const searchAttribute = searchSelect ? String(searchSelect.value || '').trim() : '';
      const idAttribute = idSelect ? String(idSelect.value || '').trim() : '';
      const hintText = hintInput ? String(hintInput.value || '').trim() : '';
      const geometryAttribute = String(item.dataset.geometryAttribute || '').trim();
      if (searchAttribute && idAttribute) {
        payload.push({
          name: layerName,
          idAttribute,
          searchAttribute,
          geometryAttribute: geometryAttribute || '',
          hintText: hintText || t('searchableHintPlaceholder'),
          // Compatibility with older consumers that still read fields/titleField.
          fields: [searchAttribute],
          titleField: searchAttribute
        });
      }
    }
  });

  try {
    await api(`/projects/${projectId}/searchable`, {
      method: 'POST',
      body: payload
    });
    showMessage('success', t('searchableSaveOk'));
  } catch (err) {
    showMessage('error', t('searchableSaveError'));
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
