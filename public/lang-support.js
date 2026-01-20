/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

(function () {
  const SUPPORTED_LANGS = ["en", "es", "sv"];
  const COOKIE_NAME = "qtiler_lang";
  const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 año

  const normalize = (value) => {
    const raw = String(value || "").trim().toLowerCase();
    if (SUPPORTED_LANGS.includes(raw)) return raw;
    const base = raw.split("-")[0];
    return SUPPORTED_LANGS.includes(base) ? base : "en";
  };

  const readCookieLang = () => {
    try {
      const segments = document.cookie ? document.cookie.split(/;\s*/) : [];
      for (const segment of segments) {
        const [name, ...rest] = segment.split("=");
        if (!name) continue;
        if (name.trim() === COOKIE_NAME && rest.length) {
          return decodeURIComponent(rest.join("=") || "");
        }
      }
    } catch {}
    return null;
  };

  const persistCookie = (lang) => {
    try {
      document.cookie = `${COOKIE_NAME}=${encodeURIComponent(lang)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
    } catch {}
  };

  const storedLang = (() => {
    try {
      const fromStorage = localStorage.getItem("qtiler.lang");
      if (fromStorage) return fromStorage;
    } catch {}
    return null;
  })();

  const initialLang = normalize(storedLang || readCookieLang() || navigator.language || "en");
  let currentLang = initialLang;
  persistCookie(currentLang);
  const listeners = new Set();

  const applyDocumentLang = () => {
    try {
      if (document?.documentElement) {
        document.documentElement.setAttribute("lang", currentLang);
      }
    } catch {}
  };

  const notify = () => {
    listeners.forEach((listener) => {
      try {
        listener(currentLang);
      } catch (err) {
        console.warn("qtilerLang listener failed", err);
      }
    });
  };

  const setLanguage = (lang, { fromStorage = false } = {}) => {
    const nextLang = normalize(lang);
    if (nextLang === currentLang) {
      persistCookie(currentLang);
      return;
    }
    currentLang = nextLang;
    if (!fromStorage) {
      try {
        localStorage.setItem("qtiler.lang", currentLang);
      } catch {}
    }
    persistCookie(currentLang);
    applyDocumentLang();
    notify();
  };

  const getLanguage = () => currentLang;

  const subscribe = (listener) => {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  window.qtilerLang = {
    SUPPORTED_LANGS: SUPPORTED_LANGS.slice(),
    normalize,
    get: getLanguage,
    set: (lang) => setLanguage(lang),
    subscribe,
    notify // Expose notify
  };

  applyDocumentLang();

  window.addEventListener("storage", (event) => {
    if (event.key !== "qtiler.lang") return;
    setLanguage(event.newValue || "en", { fromStorage: true });
  });
})();

// Central translation catalogue and helpers
(function () {
  // TRANSLATIONS moved here from views to centralize translations
  const TRANSLATIONS = {
    en: {
      "login.pageTitle": "Sign in · Qtiler",
      "login.heading": "Sign in to Qtiler",
      "login.intro": "Authenticate with your credentials to access the dashboard.",
      "login.label.username": "Username",
      "login.label.password": "Password",
      "login.remember.label": "Remember me next time",
      "login.button.submit": "Sign in",
      "login.button.reset": "Return to sign in",
      "login.help": "Need access? Contact your administrator.",
      "login.status.busy": "Signing in…",
      "login.success.limitedNamed": "Signed in as {user}",
      "login.success.limited": "Signed in successfully",
      "login.error.invalidCredentials": "Invalid username or password",
      "login.error.network": "Connection error. Please try again.",
      "login.error.userDisabled": "This account has been disabled",
      "access.title": "Qtiler · Access denied",
      "access.heading": "Access denied",
      "access.detail": "Your account is not authorized to view the Qtiler dashboard. If you need access, please contact an administrator.",
      "access.tip": "You can still use any WMTS endpoints that have been shared with you directly.",
      "access.cta": "Return to sign in",
      "guide.pageTitle": "User Guide · Qtiler",
      "guide.back": "⬅ Back to dashboard",
      "guide.heroTitle": "Quick Start & Workflow Guide",
      "guide.heroSubtitle": "Everything you need to prepare QGIS projects, build manual or on-demand WMTS caches with Qtiler, secure deployments with the optional auth plugin, and publish production-ready services.",
      "guide.section1Title": "Getting ready",
      "guide.prepareQgis": "Prepare QGIS",
      "guide.prepareQgis.step1": "Create and save your project in QGIS 3.x with all layers styled.",
      "guide.prepareQgis.step2": "Define \"Map Themes\" (a.k.a. Kartteman) for every layer combination you want to cache as a composite.",
      "guide.prepareQgis.step3": "Save the project (<code>Ctrl+S</code>) before uploading so the themes are persisted.",
      "guide.setupServer": "Set up the server",
      "guide.setupServer.step1": "Install OSGeo4W or the standalone QGIS build and configure <code>QGIS_PREFIX</code>, <code>OSGEO4W_BIN</code>, <code>PYTHON_EXE</code>.",
      "guide.setupServer.step2": "Launch Qtiler with <code>npm start</code> (default <code>http://localhost:3000</code>).",
      "guide.setupServer.step3": "Optional: install the Windows Service via <code>node service\\install-service.js</code>.",
      "guide.tip1": "Already copied projects into <code>qgisprojects/</code>? Just click <strong>Reload layers</strong> to rebuild the list.",
      "guide.section2Title": "Dashboard workflow",
      "guide.dashboardIntro": "Here is the end-to-end flow inside the dashboard—everything you see ships with Qtiler, no manual assets required.",
      "guide.dashboardOverview": "Dashboard overview",
      "guide.dashboardOverview.body": "Use the top summary to monitor pending jobs, completed caches, and quick actions like <strong>Reload layers</strong> or <strong>Cache all layers</strong>.",
      "guide.layerControls": "Layer controls",
      "guide.layerControls.body": "Each row exposes play/delete/copy/view buttons plus shortcuts to manual or on-demand caching so operators never leave the dashboard.",
      "guide.uploadRefresh": "1️⃣ Upload or refresh projects",
      "guide.uploadRefresh.body": "Use <strong>Upload project</strong> for `.qgs/.qgz` files. Qtiler drops them into <code>qgisprojects/</code> and extracts layers, CRS, extent, and themes.",
      "guide.adjustZoom": "2️⃣ Adjust zoom and extent",
      "guide.adjustZoom.body": "Set global min/max zoom and open <strong>Show extent map</strong> when you need precise bounding boxes.",
      "guide.cachePerLayer": "3️⃣ Cache per layer",
      "guide.cachePerLayer.intro": "Each layer row offers:",
      "guide.cachePerLayer.option1": "▶ Generate/refresh cache.",
      "guide.cachePerLayer.option2": "🗑 Delete stored tiles.",
      "guide.cachePerLayer.option3": "📋 Copy tile URL (`/wmts/&lt;project&gt;/&lt;layer&gt;/{z}/{x}/{y}.png`).",
      "guide.cachePerLayer.option4": "👁 Open the Leaflet viewer in the layer’s native CRS.",
      "guide.cachePerTheme": "4️⃣ Cache per theme",
      "guide.cachePerTheme.body": "The <strong>Map Themes</strong> section lists every theme found. Use ▶ to generate the composite mosaic.",
      "guide.section3Title": "Jobs & automation",
      "guide.projectWideCache": "Project-wide cache",
      "guide.projectWideCache.body": "<strong>Cache all layers</strong> launches a batch job that iterates over every layer with the current parameters.",
      "guide.scheduledRecache": "Scheduled recache",
      "guide.scheduledRecache.body": "Open the recache menu to define minute-based intervals.",
      "guide.onDemandCacheTitle": "On-demand caching",
      "guide.onDemandCache.body": "Qtiler can serve tiles directly from QGIS whenever a WMTS request misses the cache.",
      "guide.tip2": "Caches live under <code>cache/&lt;project&gt;/</code>. Each run updates <code>index.json</code> with metadata.",
      "guide.section4Title": "Publishing WMTS",
      "guide.section4.body": "The backend exposes a minimal GetCapabilities endpoint at <code>/wmts?SERVICE=WMTS&amp;REQUEST=GetCapabilities&amp;project=&lt;id&gt;</code>.",
      "guide.gisIntegration": "GIS client integration",
      "guide.gisIntegration.body1": "Load the Capabilities URL to register every layer at once.",
      "guide.gisIntegration.body2": "Use individual tile URLs when you only need a specific resource.",
      "guide.gisIntegration.body3": "Themes are identified as <code>&lt;project&gt;:&lt;theme&gt;</code> and stored under <code>_themes/</code>.",
      "guide.leafletViewer": "Leaflet viewer",
      "guide.leafletViewer.body": "Launch the Leaflet viewer from the eye icon next to each layer or theme.",
      "guide.origoTitle": "Using Qtiler with Origo Map",
      "guide.origo.body": "For Origo-based portals, point the source to the REST XYZ template (not GetCapabilities) and keep the native CRS.",
      "guide.origo.layerLabel": "Example layer entry that references the source:",
      "guide.origo.extentTip": "Get the origin, resolutions, and extent from the layer/theme info dialog (ⓘ) in the dashboard.",
      "guide.sectionAuthTitle": "Authentication & access control",
      "guide.authPluginIntro": "Install the optional QtilerAuth plugin whenever you need login-protected dashboards or customer-specific WMTS access.",
      "guide.authPlugin.userMgmt": "Manage users and roles from the built-in admin UI, including password resets and project-level permissions.",
      "guide.authPlugin.portal": "Apply consistent authentication across the portal, Leaflet viewer, and WMTS endpoints.",
      "guide.authPlugin.setup": "Download the one-time QtilerAuth ZIP from mundogis.se and upload it through the built-in plugin installer.",
      "guide.authPlugin.purchase": "QtilerAuth ships as a one-time ZIP purchase: download it from mundogis.se.",
      "guide.section5Title": "Best practices",
      "guide.bestPractice1": "Keep QGIS projects and themes organized—names map directly to WMTS paths.",
      "guide.bestPractice2": "Monitor disk usage; WMTS caches can grow fast. Clean up unused layers regularly.",
      "guide.bestPractice3": "Review logs (`logs/`) and UI status messages to catch render errors early.",
      "guide.bestPractice4": "Use dedicated Windows accounts and background services for production deployments.",
      "guide.footer": "Need to customize further? Update the README, purchase Qtiler via mundogis.se, or email abel.gonzalez@mundogis.se.",
      "viewer.pageTitle": "Tile viewer · Qtiler",
      "viewer.loading": "Loading...",
      "viewer.value.unknown": "Unknown",
      "viewer.info.project": "Project: {value}",
      "viewer.info.theme": "Theme: {value}",
      "viewer.info.layer": "Layer: {value}",
      "viewer.info.mode": "Mode: {value}",
      "viewer.info.template": "Tile template: {value}",
      "viewer.mode.cache": "WMTS (cache/on-demand)",
      "viewer.mode.wms": "WMS (tiled)",
      "viewer.mode.wfs": "WFS (vector)",
      "viewer.value.notAvailable": "Not available",
      "viewer.info.zoomRange": "Zoom range: {min} — {max}",
      "viewer.info.tiles": "Tiles: {count}",
      "viewer.info.layerCrs": "Layer CRS: {crs}",
      "viewer.info.tileCrs": "Tile CRS: {crs}",
      "viewer.info.metadataUnavailable": "Metadata unavailable",
      "viewer.error.missingLayerOrTheme": "Missing layer or theme",
      "viewer.error.missingProject": "Missing project",
      "viewer.info.noCache": "No cache available",
      "viewer.error.leafletMissing": "Leaflet failed to load (check SRI/CSP)",
      "viewer.notice.invalidCustomBounds": "Invalid bounds for CRS {crs}",
      "viewer.notice.noProjDefinition": "Projection definition not available",
      "viewer.notice.noMatrix": "Tile matrix definition missing",
      "viewer.notice.customMatrix": "Using custom matrix for {crs}",
      "viewer.notice.customExtent": "Using custom extent in {crs}",
      "viewer.notice.wfsTruncated": "WFS load stopped at {count} features (safety limit)",
      "viewer.notice.osmUnavailable": "OSM layer unavailable",
      "viewer.control.cacheStart": "Cache on demand",
      "viewer.control.cacheStop": "Stop cache",
      "viewer.control.cacheBusy": "Caching…",
      "viewer.control.cacheDone": "Done",
      "viewer.control.cacheError": "Error",
      "viewer.control.cacheIdle": "Idle",
      "viewer.control.osmShow": "Show OSM",
      "viewer.control.osmHide": "Hide OSM",
      "viewer.control.resetExtent": "Reset extent"
      ,
      "Open WMS viewer": "Open WMS viewer"
      ,
      "Copy WMS URL": "Copy WMS URL"
      ,
      "Open WFS viewer": "Open WFS viewer"
      ,
      "Copy WFS URL": "Copy WFS URL"
      ,
      "WFS URL copied to clipboard": "WFS URL copied to clipboard"
      ,
      "viewer.error.wfsLoadFailed": "Failed to load WFS features"
      ,
      "Editable": "Editable"
      ,
      "Enable editing over WFS": "Enable editing over WFS"
      ,
      "Layer marked editable": "Layer marked editable"
      ,
      "Layer marked read-only": "Layer marked read-only"
      ,
      "Upload bundle hint": "If your QGIS project uses file-based layers, upload a .zip that includes exactly one .qgz/.qgs plus the data files, keeping the folder structure."
    },
    es: {
      "Dashboard": "Panel principal",
      "Guide": "Guía",
      "Language": "Idioma",
      "Login": "Iniciar sesión",
      "Logout": "Cerrar sesión",
      "Admin console": "Consola de administración",
      "Install auth plugin": "Instalar plugin de autenticación",
      "Install Admin Dashboard": "Instalar Panel de Administración",
      "Authentication features are paused until the authentication plugin is installed.": "Las funciones de autenticación están en pausa hasta instalar el plugin de autenticación.",
      "Authentication plugin unavailable": "Plugin de autenticación no disponible",
      "You haven't purchased the authentication plugin yet? Contact MundoGIS or visit https://mundogis.se to learn more about this plugin.": "¿Aún no has adquirido el plugin de autenticación? Contacta con MundoGIS o visita https://mundogis.se para saber más sobre este plugin.",
      "Don't show this again": "No volver a mostrar este mensaje",
      "Learn more": "Leer más",
      "Close": "Cerrar",
      "Signed in as {user}": "Sesión como {user}",
      "Upload project": "Subir proyecto",
      "Upload bundle hint": "Si tu proyecto QGIS usa capas basadas en archivos, sube un .zip que incluya exactamente un .qgz/.qgs y los datos, manteniendo la estructura de carpetas.",
      "Reload layers": "Recargar capas",
      "User guide": "Guía de uso",
      "Min zoom:": "Zoom mínimo:",
      "Max zoom:": "Zoom máximo:",
      "Mode:": "Modo:",
      "XYZ (EPSG:3857)": "XYZ (EPSG:3857)",
      "WMTS automatic (native CRS)": "WMTS automático (CRS nativo)",
      "Custom subdivision (bbox)": "Subdivisión personalizada (bbox)",
      "Tile CRS:": "CRS de tesela:",
      "Allow remote (WMS/XYZ)": "Permitir remoto (WMS/XYZ)",
      "Delay between tiles (ms)": "Retardo entre teselas (ms)",
      "MundoGIS tile caching for QGIS projects. Pick a layer and hit “Generate cache”.": "Consola de teselado de MundoGIS para proyectos QGIS. Elige una capa y presiona “Generar caché”.",
      "Loading projects…": "Cargando proyectos…",
      "No projects in qgisprojects/": "No hay proyectos en qgisprojects/",
      "Failed to load layers: HTTP {status}": "Error al cargar capas: HTTP {status}",
      "Details: {text}": "Detalles: {text}",
      "Network error while loading project layers": "Error de red al cargar las capas del proyecto",
      "View sample tile": "Ver tesela de ejemplo",
      "Copy tiles URL": "Copiar URL de teselas",
      "Copy XYZ URL": "Copiar URL XYZ",
      "Tile template copied to clipboard: {url}": "Plantilla de teselas copiada: {url}",
      "Copy failed: {error}": "Error al copiar: {error}",
      "Generate cache": "Generar caché",
      "Recache layer": "Regenerar caché",
      "Start recache": "Iniciar regeneración",
      "Choose zoom levels for this recache run.": "Elige los niveles de zoom para esta regeneración.",
      "Cached zoom range: {range}": "Rango de zoom cacheado: {range}",
      "Values only apply to this recache operation.": "Estos valores solo se aplican a esta regeneración.",
      "Provide valid zoom numbers (0-30).": "Ingresa valores de zoom válidos (0-30).",
      "Min zoom must be less than or equal to max zoom.": "El zoom mínimo debe ser menor o igual que el zoom máximo.",
      "Remote layer. Enable \"Allow remote\" to cache.": "Capa remota. Activa \"Permitir remoto\" para cachearla.",
      "Delete cache": "Eliminar caché",
      "Open map viewer": "Abrir visor de mapa",
      "Open remote source": "Abrir fuente remota",
      "View cached tiles": "Ver teselas cacheadas",
      "Running tasks": "Tareas en ejecución",
      "Loading layers…": "Cargando capas…",
      "Project cache running": "Caché de proyecto en ejecución",
      "Project cache queued…": "Caché de proyecto en cola…",
      "Project cache error: {error}": "Error en caché de proyecto: {error}",
      "Project cache status: {status}": "Estado de caché de proyecto: {status}",
      "Project cache idle": "Caché de proyecto inactiva",
      "Last result: {result} at {time}": "Último resultado: {result} a las {time}",
      "Project cache status unavailable": "Estado de caché de proyecto no disponible",
      "Project cache status error": "Error al consultar estado de caché de proyecto",
      "Project cache failed to start: {detail}": "No se pudo iniciar el caché de proyecto: {detail}",
      "Project cache started (run {runId}).": "Caché de proyecto iniciado (ejecución {runId}).",
      "Skipped (remote disabled): {names}": "Omitido (remoto deshabilitado): {names}",
      "Starting project cache for {project} ({count} layers)…": "Iniciando caché de proyecto para {project} ({count} capas)…",
      "Project cache error: {error}": "Error en caché de proyecto: {error}",
      "Recache timer disabled for {project}": "Temporizador desactivado para {project}",
      "Recache timer updated for {project}": "Temporizador actualizado para {project}",
      "Invalid minutes value for recache interval": "Valor de minutos no válido",
      "Invalid datetime for next recache run": "Fecha/hora no válida para la próxima ejecución",
      "No layers available for this project": "No hay capas disponibles para este proyecto",
      "Starting cache job…": "Iniciando tarea de caché…",
      "Cache job started: {id}": "Tarea de caché iniciada: {id}",
      "Cache job queued: {id}": "Tarea de caché en cola: {id}",
      "Cache job error: {error}": "Error en tarea de caché: {error}",
      "Cache deleted": "Caché eliminado",
      "Failed to delete cache: {error}": "Error al eliminar caché: {error}",
      "Config save failed for {projectId}: {error}": "Error al guardar configuración para {projectId}: {error}",
      "No extent captured.": "No se ha definido extensión.",
      "Extent (lon/lat WGS84): {extent}": "Extensión (lon/lat WGS84): {extent}",
      "Failed to load map library: {error}": "No se pudo cargar la librería del mapa: {error}",
      "Use current view": "Usar vista actual",
      "Set current zoom as Min": "Definir zoom actual como mínimo",
      "Set current zoom as Max": "Definir zoom actual como máximo",
      "zoom_min set to {zoom}": "zoom_min establecido a {zoom}",
      "zoom_max set to {zoom}": "zoom_max establecido a {zoom}",
      "Extent removed": "Extensión eliminada",
      "Reload layers": "Recargar capas",
      "Upload succeeded": "Carga completada",
      "Upload failed: {error}": "Error al subir: {error}",
      "Unsupported file type (only .qgz/.qgs).": "Tipo de archivo no soportado (solo .qgz/.qgs).",
      "Upload aborted": "Carga cancelada",
      "Deleted project {name}": "Proyecto {name} eliminado",
      "Failed to delete project: {error}": "Error al eliminar proyecto: {error}",
      "Delete project": "Eliminar proyecto",
      "Cache all layers": "Cachear todas las capas",
      "Running tasks": "Tareas en ejecución",
      "Map themes": "Temas de mapa",
      "Generate theme cache": "Generar caché de tema",
      "Copy WMTS URL": "Copiar URL WMTS",
      "Copy WMS URL": "Copiar URL WMS",
      "Editable": "Editable",
      "Enable editing over WFS": "Habilitar edición por WFS",
      "Layer marked editable": "Capa marcada como editable",
      "Layer marked read-only": "Capa marcada como solo lectura",
      "WMTS theme URL copied: {url}": "URL WMTS copiada: {url}",
      "WMS URL copied to clipboard": "URL WMS copiada al portapapeles",
      "Loading jobs…": "Cargando tareas…",
      "Leaflet no cargó (revisa bloqueo de SRI o CSP)": "Leaflet no cargó (revisa bloqueo de SRI o CSP)",
      "Show extent map": "Mostrar mapa de extensión",
      "Hide extent map": "Ocultar mapa de extensión",
      "Automatic cache schedule": "Programación automática de caché",
      "Theme: ": "Tema: ",
      "Layer: ": "Capa: ",
      "Enable automatic cache generation": "Habilitar generación automática de caché",
      "Weekly": "Semanal",
      "Run on selected weekdays at a fixed time.": "Ejecutar los días seleccionados a una hora fija.",
      "Monthly": "Mensual",
      "Run on chosen days each month.": "Ejecutar en los días elegidos cada mes.",
      "3x per year": "3 veces al año",
      "Run up to three specific dates per year.": "Ejecutar hasta tres fechas específicas por año.",
      "Weekly options": "Opciones semanales",
      "Time (local)": "Hora (local)",
      "Days of month (comma separated)": "Días del mes (separados por comas)",
      "Yearly dates (up to 3)": "Fechas anuales (hasta 3)",
      "Cancel": "Cancelar",
      "Save schedule": "Guardar programación",
      "Select at least one weekday.": "Selecciona al menos un día de la semana.",
      "Provide one or more day numbers between 1 and 31.": "Ingresa uno o más días entre 1 y 31.",
      "Day values must be between 1 and 31.": "Los días deben estar entre 1 y 31.",
      "Complete month, day and time for yearly entries or leave them blank.": "Completa mes, día y hora para las entradas anuales o déjalas vacías.",
      "Add at least one yearly date.": "Agrega al menos una fecha anual.",
      "Configure auto cache": "Configurar caché automática",
      "Auto cache disabled for {name}": "Caché automática desactivada para {name}",
      "Schedule saved for {name}": "Programación guardada para {name}"
      ,
      // Login / Access / Guide translations (ES)
      "login.pageTitle": "Iniciar sesión · Qtiler",
      "login.heading": "Iniciar sesión en Qtiler",
      "login.intro": "Autentícate con tus credenciales para acceder al panel.",
      "login.label.username": "Usuario",
      "login.label.password": "Contraseña",
      "login.remember.label": "Recordarme la próxima vez",
      "login.button.submit": "Iniciar sesión",
      "login.button.reset": "Volver al inicio de sesión",
      "login.help": "¿Necesitas acceso? Contacta con tu administrador.",
      "login.status.busy": "Iniciando sesión…",
      "login.success.limitedNamed": "Sesión iniciada como {user}",
      "login.success.limited": "Sesión iniciada correctamente",
      "login.error.invalidCredentials": "Usuario o contraseña incorrectos",
      "login.error.network": "Error de conexión. Inténtalo de nuevo.",
      "login.error.userDisabled": "Esta cuenta ha sido deshabilitada",
      "access.title": "Qtiler · Acceso denegado",
      "access.heading": "Acceso denegado",
      "access.detail": "Tu cuenta no está autorizada para ver el panel de Qtiler. Si necesitas acceso, contacta con un administrador.",
      "access.tip": "Puedes seguir usando los endpoints WMTS que se hayan compartido contigo.",
      "access.cta": "Volver a iniciar sesión",
      "guide.pageTitle": "Guía de usuario · Qtiler",
      "guide.back": "⬅ Volver al panel",
      "guide.heroTitle": "Guía rápida y flujo de trabajo",
      "guide.heroSubtitle": "Todo lo necesario para preparar proyectos QGIS, generar cachés WMTS manuales u on-demand con Qtiler, proteger despliegues con el plugin de autenticación opcional y publicar servicios listos para producción.",
      "guide.section1Title": "Preparativos",
      "guide.prepareQgis": "Preparar QGIS",
      "guide.prepareQgis.step1": "Crea y guarda tu proyecto en QGIS 3.x con todas las capas estilizadas.",
      "guide.prepareQgis.step2": "Define \"Map Themes\" (Kartteman) para cada combinación de capas que quieras cachear como mosaico compuesto.",
      "guide.prepareQgis.step3": "Guarda el proyecto (<code>Ctrl+S</code>) antes de subirlo para conservar los temas.",
      "guide.setupServer": "Configurar el servidor",
      "guide.setupServer.step1": "Instala OSGeo4W o la versión autónoma de QGIS y configura <code>QGIS_PREFIX</code>, <code>OSGEO4W_BIN</code>, <code>PYTHON_EXE</code>.",
      "guide.setupServer.step2": "Inicia Qtiler con <code>npm start</code> (por defecto <code>http://localhost:3000</code>).",
      "guide.setupServer.step3": "Opcional: instala el servicio de Windows con <code>node service\\install-service.js</code>.",
      "guide.tip1": "¿Ya copiaste proyectos a <code>qgisprojects/</code>? Solo pulsa <strong>Recargar capas</strong> para reconstruir la lista.",
      "guide.section2Title": "Flujo en el panel",
      "guide.dashboardIntro": "Este es el recorrido completo dentro del panel: todo lo que ves viene incluido en Qtiler, sin recursos externos.",
      "guide.dashboardOverview": "Resumen del panel",
      "guide.dashboardOverview.body": "Usa el resumen superior para monitorear trabajos pendientes, cachés completadas y accesos directos como <strong>Recargar capas</strong> o <strong>Cachear todas las capas</strong>.",
      "guide.layerControls": "Controles de capa",
      "guide.layerControls.body": "Cada fila expone botones de reproducir, borrar, copiar/ver y accesos a cacheo manual u on-demand sin salir del panel.",
      "guide.uploadRefresh": "1️⃣ Subir o refrescar proyectos",
      "guide.uploadRefresh.body": "Usa <strong>Subir proyecto</strong> para `.qgs/.qgz`. Qtiler los coloca en <code>qgisprojects/</code> y extrae capas, CRS, extensión y temas.",
      "guide.adjustZoom": "2️⃣ Ajustar zoom y extensión",
      "guide.adjustZoom.body": "Define el zoom mínimo/máximo global y abre <strong>Mostrar mapa de extensión</strong> cuando necesites un bbox preciso.",
      "guide.cachePerLayer": "3️⃣ Cachear por capa",
      "guide.cachePerLayer.intro": "Cada fila de capa ofrece:",
      "guide.cachePerLayer.option1": "▶ Generar o actualizar la caché.",
      "guide.cachePerLayer.option2": "🗑 Eliminar teselas guardadas.",
      "guide.cachePerLayer.option3": "📋 Copiar URL de teselas (`/wmts/&lt;project&gt;/&lt;layer&gt;/{z}/{x}/{y}.png`).",
      "guide.cachePerLayer.option4": "👁 Abrir el visor Leaflet en el CRS nativo de la capa.",
      "guide.cachePerTheme": "4️⃣ Cachear por tema",
      "guide.cachePerTheme.body": "La sección <strong>Map Themes</strong> lista cada tema detectado. Usa ▶ para generar el mosaico compuesto.",
      "guide.section3Title": "Tareas y automatización",
      "guide.projectWideCache": "Cacheo por proyecto",
      "guide.projectWideCache.body": "<strong>Cachear todas las capas</strong> inicia un trabajo por lotes que recorre cada capa con los parámetros actuales.",
      "guide.scheduledRecache": "Recacheo programado",
      "guide.scheduledRecache.body": "Abre el menú de recacheo para definir intervalos en minutos.",
      "guide.onDemandCacheTitle": "Caché bajo demanda",
      "guide.onDemandCache.body": "Qtiler puede servir teselas directamente desde QGIS cuando una petición WMTS no existe en caché.",
      "guide.tip2": "Las cachés viven en <code>cache/&lt;project&gt;/</code>. Cada ejecución actualiza <code>index.json</code> con metadata.",
      "guide.section4Title": "Publicar WMTS",
      "guide.section4.body": "El backend expone un endpoint mínimo de GetCapabilities en <code>/wmts?SERVICE=WMTS&amp;REQUEST=GetCapabilities&amp;project=&lt;id&gt;</code>.",
      "guide.gisIntegration": "Integración en clientes GIS",
      "guide.gisIntegration.body1": "Carga la URL de capacidades para registrar todas las capas de una vez.",
      "guide.gisIntegration.body2": "Usa URLs de teselas individuales cuando solo necesites un recurso específico.",
      "guide.gisIntegration.body3": "Los temas se identifican como <code>&lt;project&gt;:&lt;theme&gt;</code> y se guardan bajo <code>_themes/</code>.",
      "guide.leafletViewer": "Visor Leaflet",
      "guide.leafletViewer.body": "Abre el visor Leaflet desde el ícono de ojo junto a cada capa o tema.",
      "guide.origoTitle": "Usar Qtiler con Origo Map",
      "guide.origo.body": "En portales Origo usa la plantilla REST XYZ (no GetCapabilities) manteniendo el CRS nativo.",
      "guide.origo.layerLabel": "Ejemplo de entrada de capa que referencia la fuente:",
      "guide.origo.extentTip": "Obtén origen, resoluciones y extensión desde el diálogo de información (ⓘ) en el panel.",
      "guide.sectionAuthTitle": "Autenticación y control de acceso",
      "guide.authPluginIntro": "Instala el plugin opcional QtilerAuth cuando necesites paneles con inicio de sesión o acceso WMTS por cliente.",
      "guide.authPlugin.userMgmt": "Administra usuarios y roles desde la interfaz de administración integrada.",
      "guide.authPlugin.portal": "Aplica permisos consistentes en panel, visor y endpoints WMTS.",
      "guide.authPlugin.setup": "Descarga el ZIP de QtilerAuth desde mundogis.se y súbelo con el instalador integrado.",
      "guide.authPlugin.purchase": "QtilerAuth se distribuye como un ZIP de compra única: descárgalo desde mundogis.se.",
      "guide.section5Title": "Buenas prácticas",
      "guide.bestPractice1": "Mantén organizados los proyectos y temas de QGIS—los nombres se mapean directamente a rutas WMTS.",
      "guide.bestPractice2": "Controla el uso de disco; las cachés WMTS pueden crecer rápido.",
      "guide.bestPractice3": "Revisa los registros (`logs/`) y mensajes del panel para detectar errores de renderizado.",
      "guide.bestPractice4": "Usa cuentas de Windows dedicadas y servicios en segundo plano para producción.",
      "guide.footer": "¿Necesitas personalizar más? Actualiza el README o contacta a abel.gonzalez@mundogis.se.",
      "viewer.pageTitle": "Visor de teselas · Qtiler",
      "viewer.loading": "Cargando...",
      "viewer.value.unknown": "Desconocido",
      "viewer.info.project": "Proyecto: {value}",
      "viewer.info.theme": "Tema: {value}",
      "viewer.info.layer": "Capa: {value}",
      "viewer.info.mode": "Modo: {value}",
      "viewer.info.template": "Plantilla de teselas: {value}",
      "viewer.mode.cache": "WMTS (caché/bajo demanda)",
      "viewer.mode.wms": "WMS (en teselas)",
      "viewer.mode.wfs": "WFS (vectorial)",
      "viewer.value.notAvailable": "No disponible",
      "viewer.info.zoomRange": "Rango de zoom: {min} — {max}",
      "viewer.info.tiles": "Teselas: {count}",
      "viewer.info.layerCrs": "CRS de la capa: {crs}",
      "viewer.info.tileCrs": "CRS de teselas: {crs}",
      "viewer.info.metadataUnavailable": "Metadata no disponible",
      "viewer.error.missingLayerOrTheme": "Falta capa o tema",
      "viewer.error.missingProject": "Falta proyecto",
      "viewer.info.noCache": "No hay caché disponible",
      "viewer.error.leafletMissing": "Leaflet no cargó (revisa SRI o CSP)",
      "viewer.notice.invalidCustomBounds": "Bounds inválidos para CRS {crs}",
      "viewer.notice.noProjDefinition": "Definición de proyección no disponible",
      "viewer.notice.noMatrix": "Falta definición de matriz de teselas",
      "viewer.notice.customMatrix": "Usando matriz personalizada para {crs}",
      "viewer.notice.customExtent": "Usando extensión personalizada en {crs}",
      "viewer.notice.wfsTruncated": "La carga WFS se detuvo en {count} elementos (límite de seguridad)",
      "viewer.notice.osmUnavailable": "Capa OSM no disponible",
      "viewer.control.cacheStart": "Cachear bajo demanda",
      "viewer.control.cacheStop": "Detener caché",
      "viewer.control.cacheBusy": "Cacheando…",
      "viewer.control.cacheDone": "Hecho",
      "viewer.control.cacheError": "Error",
      "viewer.control.cacheIdle": "Inactiva",
      "viewer.control.osmShow": "Mostrar OSM",
      "viewer.control.osmHide": "Ocultar OSM",
      "viewer.control.resetExtent": "Restablecer extensión"
      ,
      "Open WMS viewer": "Abrir visor WMS"
      ,
      "Open WFS viewer": "Abrir visor WFS"
      ,
      "Copy WFS URL": "Copiar URL WFS"
      ,
      "WFS URL copied to clipboard": "URL WFS copiada al portapapeles"
      ,
      "viewer.error.wfsLoadFailed": "No se pudieron cargar las entidades WFS"
    },
    sv: {
      "Dashboard": "Översikt",
      "Guide": "Guide",
      "Language": "Språk",
      "Login": "Logga in",
      "Logout": "Logga ut",
      "Admin console": "Admin-konsol",
      "Install auth plugin": "Installera autentiseringsplugin",
      "Install Admin Dashboard": "Installera administrationspanel",
      "Authentication features are paused until the authentication plugin is installed.": "Autentiseringsfunktionerna är pausade tills pluginet är installerat.",
      "Authentication plugin unavailable": "Autentiseringsplugin inte tillgänglig",
      "You haven't purchased the authentication plugin yet? Contact MundoGIS or visit https://mundogis.se to learn more about this plugin.": "Har du ännu inte köpt autentiseringspluginet? Kontakta MundoGIS eller besök https://mundogis.se för att läsa mer om pluginet.",
      "Don't show this again": "Visa inte detta igen",
      "Learn more": "Läs mer",
      "Close": "Stäng",
      "Signed in as {user}": "Inloggad som {user}",
      "Upload project": "Ladda upp projekt",
      "Upload bundle hint": "Om ditt QGIS-projekt använder filbaserade lager: ladda upp en .zip som innehåller exakt en .qgz/.qgs samt datafilerna och behåll mappstrukturen.",
      "Reload layers": "Ladda om lager",
      "User guide": "Användarguide",
      "Min zoom:": "Min zoom:",
      "Max zoom:": "Max zoom:",
      "Mode:": "Läge:",
      "XYZ (EPSG:3857)": "XYZ (EPSG:3857)",
      "WMTS automatic (native CRS)": "WMTS automatiskt (inbyggt CRS)",
      "Custom subdivision (bbox)": "Anpassad indelning (bbox)",
      "Tile CRS:": "Tile-CRS:",
      "Allow remote (WMS/XYZ)": "Tillåt fjärrlager (WMS/XYZ)",
      "Delay between tiles (ms)": "Fördröjning mellan tiles (ms)",
      "MundoGIS tile caching for QGIS projects. Pick a layer and hit “Generate cache”.": "MundoGIS cachekonsol för QGIS-projekt. Välj ett lager och klicka på ”Generera cache”.",
      "Loading projects…": "Laddar projekt…",
      "No projects in qgisprojects/": "Inga projekt i qgisprojects/",
      "Failed to load layers: HTTP {status}": "Kunde inte läsa lager: HTTP {status}",
      "Details: {text}": "Detaljer: {text}",
      "Network error while loading project layers": "Nätverksfel vid inläsning av projektlager",
      "View sample tile": "Visa exempelruta",
      "Copy tiles URL": "Kopiera tile-URL",
      "Copy XYZ URL": "Kopiera XYZ-URL",
      "Tile template copied to clipboard: {url}": "Tile-mall kopierad: {url}",
      "Copy failed: {error}": "Kopiering misslyckades: {error}",
      "Generate cache": "Generera cache",
      "Recache layer": "Generera om cache",
      "Start recache": "Starta omgenerering",
      "Choose zoom levels for this recache run.": "Välj zoomnivåer för den här omgenereringen.",
      "Cached zoom range: {range}": "Cachelagrat zoomintervall: {range}",
      "Values only apply to this recache operation.": "Värdena gäller bara för denna omgenerering.",
      "Provide valid zoom numbers (0-30).": "Ange giltiga zoomtal (0-30).",
      "Min zoom must be less than or equal to max zoom.": "Minsta zoom måste vara mindre än eller lika med största zoom.",
      "Remote layer. Enable \"Allow remote\" to cache.": "Fjärrlager. Aktivera \"Tillåt fjärrlager\" för att cachea.",
      "Delete cache": "Ta bort cache",
      "Open map viewer": "Öppna kartvisare",
      "Open remote source": "Öppna fjärrkälla",
      "View cached tiles": "Visa cachelagrade rutor",
      "Running tasks": "Pågående jobb",
      "Loading layers…": "Laddar lager…",
      "Project cache running": "Projektcache körs",
      "Project cache queued…": "Projektcache i kö…",
      "Project cache error: {error}": "Projektcache fel: {error}",
      "Project cache status: {status}": "Projektcache status: {status}",
      "Project cache idle": "Projektcache inaktiv",
      "Last result: {result} at {time}": "Senaste resultat: {result} kl {time}",
      "Project cache status unavailable": "Projektcache-status otillgänglig",
      "Project cache status error": "Fel vid hämtning av projektcache-status",
      "Project cache failed to start: {detail}": "Projektcache kunde inte startas: {detail}",
      "Project cache started (run {runId}).": "Projektcache startad (körning {runId}).",
      "Skipped (remote disabled): {names}": "Hoppade över (fjärr avstängt): {names}",
      "Starting project cache for {project} ({count} layers)…": "Startar projektcache för {project} ({count} lager)…",
      "Project cache error: {error}": "Projektcache fel: {error}",
      "Recache timer disabled for {project}": "Omkörningstimer avstängd för {project}",
      "Recache timer updated for {project}": "Omkörningstimer uppdaterad för {project}",
      "Invalid minutes value for recache interval": "Ogiltigt minutvärde för omkörningsintervall",
      "Invalid datetime for next recache run": "Ogiltigt datum/tid för nästa körning",
      "No layers available for this project": "Inga lager tillgängliga för detta projekt",
      "Starting cache job…": "Startar cachejobb…",
      "Cache job started: {id}": "Cachejobb startat: {id}",
      "Cache job queued: {id}": "Cachejobb i kö: {id}",
      "Cache job error: {error}": "Cachejobb fel: {error}",
      "Cache deleted": "Cache borttagen",
      "Failed to delete cache: {error}": "Kunde inte ta bort cache: {error}",
      "Config save failed for {projectId}: {error}": "Kunde inte spara konfiguration för {projectId}: {error}",
      "No extent captured.": "Ingen utbredning angiven.",
      "Extent (lon/lat WGS84): {extent}": "Utbredning (lon/lat WGS84): {extent}",
      "Failed to load map library: {error}": "Kunde inte ladda kartbibliotek: {error}",
      "Use current view": "Använd nuvarande vy",
      "Set current zoom as Min": "Sätt nuvarande zoom som min",
      "Set current zoom as Max": "Sätt nuvarande zoom som max",
      "zoom_min set to {zoom}": "zoom_min satt till {zoom}",
      "zoom_max set to {zoom}": "zoom_max satt till {zoom}",
      "Extent removed": "Utbredning borttagen",
      "Upload succeeded": "Uppladdning klar",
      "Upload failed: {error}": "Uppladdning misslyckades: {error}",
      "Unsupported file type (only .qgz/.qgs).": "Filtyp stöds inte (endast .qgz/.qgs).",
      "Upload aborted": "Uppladdning avbruten",
      "Deleted project {name}": "Projekt {name} borttaget",
      "Failed to delete project: {error}": "Kunde inte ta bort projekt: {error}",
      "Delete project": "Ta bort projekt",
      "Cache all layers": "Cachea alla lager",
      "Map themes": "Kartteman",
      "Generate theme cache": "Generera temacache",
      "Copy WMTS URL": "Kopiera WMTS-URL",
      "Copy WMS URL": "Kopiera WMS-URL",
      "Copy WFS URL": "Kopiera WFS-URL",
      "Editable": "Redigerbar",
      "Enable editing over WFS": "Aktivera redigering via WFS",
      "Layer marked editable": "Lager markerat som redigerbart",
      "Layer marked read-only": "Lager markerat som skrivskyddat",
      "WMTS theme URL copied: {url}": "WMTS-URL kopierad: {url}",
      "WMS URL copied to clipboard": "WMS-URL kopierad till urklipp",
      "WFS URL copied to clipboard": "WFS-URL kopierad till urklipp",
      "Open WFS viewer": "Öppna WFS-visare",
      "viewer.mode.wfs": "WFS (vektor)",
      "viewer.error.wfsLoadFailed": "Misslyckades att ladda WFS-objekt",
      "Loading jobs…": "Laddar jobb…",
      "Leaflet no cargó (revisa bloqueo de SRI o CSP)": "Leaflet laddades inte (kontrollera SRI eller CSP)",
      "Show extent map": "Visa utbredningskarta",
      "Hide extent map": "Dölj utbredningskarta",
      "Automatic cache schedule": "Automatisk cacheplan",
      "Theme: ": "Tema: ",
      "Layer: ": "Lager: ",
      "Enable automatic cache generation": "Aktivera automatisk cachegenerering",
      "Weekly": "Veckovis",
      "Run on selected weekdays at a fixed time.": "Kör på valda veckodagar vid en fast tid.",
      "Monthly": "Månadsvis",
      "Run on chosen days each month.": "Kör på valda dagar varje månad.",
      "3x per year": "3 ggr per år",
      "Run up to three specific dates per year.": "Kör upp till tre specifika datum per år.",
      "Weekly options": "Veckoval",
      "Time (local)": "Tid (lokal)",
      "Days of month (comma separated)": "Dagar i månaden (kommaseparerade)",
      "Yearly dates (up to 3)": "Årliga datum (upp till 3)",
      "Cancel": "Avbryt",
      "Save schedule": "Spara schema",
      "Select at least one weekday.": "Välj minst en veckodag.",
      "Provide one or more day numbers between 1 and 31.": "Ange en eller flera dagnummer mellan 1 och 31.",
      "Day values must be between 1 and 31.": "Dagvärden måste vara mellan 1 och 31.",
      "Complete month, day and time for yearly entries or leave them blank.": "Fyll i månad, dag och tid för årliga poster eller lämna dem tomma.",
      "Add at least one yearly date.": "Lägg till minst ett årligt datum.",
      "Configure auto cache": "Konfigurera automatisk cache",
      "Auto cache disabled for {name}": "Automatisk cache avstängd för {name}",
      "Schedule saved for {name}": "Schema sparat för {name}"
      ,
      // Login / Access / Guide translations (SV)
      "login.pageTitle": "Logga in · Qtiler",
      "login.heading": "Logga in på Qtiler",
      "login.intro": "Autentisera med dina uppgifter för att komma åt instrumentpanelen.",
      "login.label.username": "Användarnamn",
      "login.label.password": "Lösenord",
      "login.remember.label": "Kom ihåg mig nästa gång",
      "login.button.submit": "Logga in",
      "login.button.reset": "Återgå till inloggning",
      "login.help": "Behöver du åtkomst? Kontakta din administratör.",
      "login.status.busy": "Loggar in…",
      "login.success.limitedNamed": "Inloggad som {user}",
      "login.success.limited": "Inloggad",
      "login.error.invalidCredentials": "Ogiltigt användarnamn eller lösenord",
      "login.error.network": "Anslutningsfel. Försök igen.",
      "login.error.userDisabled": "Detta konto har inaktiverats",
      "access.title": "Qtiler · Åtkomst nekad",
      "access.heading": "Åtkomst nekad",
      "access.detail": "Ditt konto har inte behörighet till Qtilers instrumentpanel. Kontakta en administratör om du behöver åtkomst.",
      "access.tip": "Du kan fortfarande använda WMTS-endpoints som delats med dig.",
      "access.cta": "Tillbaka till inloggning",
      "guide.pageTitle": "Användarguide · Qtiler",
      "guide.back": "⬅ Tillbaka till panelen",
      "guide.heroTitle": "Snabbstart och arbetsflöde",
      "guide.heroSubtitle": "Allt du behöver för att förbereda QGIS-projekt, skapa manuella eller on-demand WMTS-cachar med Qtiler, säkra driftsättningar med det valfria autentiseringspluginet och publicera produktionsklara tjänster.",
      "guide.section1Title": "Förberedelser",
      "guide.prepareQgis": "Förbered QGIS",
      "guide.prepareQgis.step1": "Skapa och spara ditt projekt i QGIS 3.x med alla lager stylade.",
      "guide.prepareQgis.step2": "Definiera \"Map Themes\" (Kartteman) för varje lagerkombination som ska cachas som mosaik.",
      "guide.prepareQgis.step3": "Spara projektet (<code>Ctrl+S</code>) innan du laddar upp så att temana följer med.",
      "guide.setupServer": "Konfigurera servern",
      "guide.setupServer.step1": "Installera OSGeo4W eller fristående QGIS och sätt upp <code>QGIS_PREFIX</code>, <code>OSGEO4W_BIN</code>, <code>PYTHON_EXE</code>.",
      "guide.setupServer.step2": "Starta Qtiler med <code>npm start</code> (standard <code>http://localhost:3000</code>).",
      "guide.setupServer.step3": "Valfritt: installera Windows-tjänsten via <code>node service\\install-service.js</code>.",
      "guide.tip1": "Har du redan kopierat projekt till <code>qgisprojects/</code>? Klicka bara på <strong>Ladda om lager</strong> för att återställa listan.",
      "guide.section2Title": "Panelarbetsflöde",
      "guide.dashboardIntro": "Här är hela arbetsflödet i panelen – allt ingår i Qtiler utan externa resurser.",
      "guide.dashboardOverview": "Panelöversikt",
      "guide.dashboardOverview.body": "Använd översikten högst upp för att se väntande jobb, färdiga cachar och genvägar som <strong>Ladda om lager</strong> eller <strong>Cacha alla lager</strong>.",
      "guide.layerControls": "Kontroller för lager",
      "guide.layerControls.body": "Varje rad har starta/ta bort/kopiera/visa-knappar plus genvägar till manuellt eller on-demand-cache utan att lämna panelen.",
      "guide.uploadRefresh": "1️⃣ Ladda upp eller uppdatera projekt",
      "guide.uploadRefresh.body": "Använd <strong>Ladda upp projekt</strong> för `.qgs/.qgz`-filer. Qtiler placerar dem i <code>qgisprojects/</code> och extraherar lager, CRS, utbredning och teman.",
      "guide.adjustZoom": "2️⃣ Justera zoom och utbredning",
      "guide.adjustZoom.body": "Sätt globalt min/max-zoom och öppna <strong>Visa utbredningskarta</strong> när du behöver exakt bounding box.",
      "guide.cachePerLayer": "3️⃣ Cacha per lager",
      "guide.cachePerLayer.intro": "Varje lagerrad erbjuder:",
      "guide.cachePerLayer.option1": "▶ Generera eller uppdatera cache.",
      "guide.cachePerLayer.option2": "🗑 Ta bort sparade tiles.",
      "guide.cachePerLayer.option3": "📋 Kopiera tile-URL (`/wmts/&lt;project&gt;/&lt;layer&gt;/{z}/{x}/{y}.png`).",
      "guide.cachePerLayer.option4": "👁 Öppna Leaflet-visaren i lagrets egna CRS.",
      "guide.cachePerTheme": "4️⃣ Cacha per tema",
      "guide.cachePerTheme.body": "Avsnittet <strong>Map Themes</strong> listar varje tema. Använd ▶ för att skapa mosaiken.",
      "guide.section3Title": "Jobb och automatisering",
      "guide.projectWideCache": "Projektcache",
      "guide.projectWideCache.body": "<strong>Cacha alla lager</strong> startar ett batchjobb som går igenom varje lager med aktuella parametrar.",
      "guide.scheduledRecache": "Schemalagd omcache",
      "guide.scheduledRecache.body": "Öppna omcache-menyn för att ange intervall i minuter.",
      "guide.onDemandCacheTitle": "On-demand-cache",
      "guide.onDemandCache.body": "Qtiler kan leverera tiles direkt från QGIS när en WMTS-förfrågan saknar cache.",
      "guide.tip2": "Cachar finns i <code>cache/&lt;project&gt;/</code>. Varje körning uppdaterar <code>index.json</code> med metadata.",
      "guide.section4Title": "Publicera WMTS",
      "guide.section4.body": "Backend:en exponerar ett minimalt GetCapabilities-endpoint på <code>/wmts?SERVICE=WMTS&amp;REQUEST=GetCapabilities&amp;project=&lt;id&gt;</code>.",
      "guide.gisIntegration": "GIS-klientintegration",
      "guide.gisIntegration.body1": "Ladda URL:en för Capabilities för att registrera alla lager på en gång.",
      "guide.gisIntegration.body2": "Använd enskilda tile-URL:er när du bara behöver en specifik resurs.",
      "guide.gisIntegration.body3": "Teman identifieras som <code>&lt;project&gt;:&lt;theme&gt;</code> och lagras under <code>_themes/</code>.",
      "guide.leafletViewer": "Leaflet-visaren",
      "guide.leafletViewer.body": "Öppna Leaflet-visaren via ögonikonen bredvid varje lager eller tema.",
      "guide.origoTitle": "Använd Qtiler med Origo Map",
      "guide.origo.body": "För Origo-portaler: peka källan mot REST-XYZ-mallen (inte GetCapabilities) och behåll CRS.",
      "guide.origo.layerLabel": "Exempel på lagerpost som refererar till källan:",
      "guide.origo.extentTip": "Hämta origin, upplösningar och extent från info-dialogen (ⓘ) i dashboarden.",
      "guide.sectionAuthTitle": "Autentisering och åtkomstkontroll",
      "guide.authPluginIntro": "Installera det valfria QtilerAuth-pluginet när du behöver inloggade paneler eller kundspecifik WMTS-åtkomst.",
      "guide.authPlugin.userMgmt": "Hantera användare och roller via det inbyggda admin-gränssnittet.",
      "guide.authPlugin.portal": "Tillämpa samma behörigheter i portalen, visaren och WMTS-endpoints.",
      "guide.authPlugin.setup": "Ladda ner QtilerAuth som ZIP från mundogis.se och installera via plugin-installeraren.",
      "guide.authPlugin.purchase": "QtilerAuth levereras som ett engångs-ZIP: ladda ner från mundogis.se.",
      "guide.section5Title": "Bästa praxis",
      "guide.bestPractice1": "Håll QGIS-projekt och teman organiserade—namn mappas direkt till WMTS-sökvägar.",
      "guide.bestPractice2": "Övervaka diskutrymme; WMTS-cachar kan växa snabbt.",
      "guide.bestPractice3": "Granska loggar (`logs/`) och panelmeddelanden för att fånga renderingsfel tidigt.",
      "guide.bestPractice4": "Använd dedikerade Windows-konton och bakgrundstjänster i produktion.",
      "guide.footer": "Behöver du anpassa mer? Uppdatera README eller kontakta abel.gonzalez@mundogis.se.",
      "viewer.pageTitle": "Tile-visare · Qtiler",
      "viewer.loading": "Laddar...",
      "viewer.value.unknown": "Okänt",
      "viewer.info.project": "Projekt: {value}",
      "viewer.info.theme": "Tema: {value}",
      "viewer.info.layer": "Lager: {value}",
      "viewer.info.mode": "Läge: {value}",
      "viewer.info.template": "Tile-mall: {value}",
      "viewer.mode.cache": "WMTS (cache/on-demand)",
      "viewer.mode.wms": "WMS (tiled)",
      "viewer.value.notAvailable": "Inte tillgängligt",
      "viewer.info.zoomRange": "Zoomintervall: {min} — {max}",
      "viewer.info.tiles": "Tiles: {count}",
      "viewer.info.layerCrs": "Lager-CRS: {crs}",
      "viewer.info.tileCrs": "Tile-CRS: {crs}",
      "viewer.info.metadataUnavailable": "Metadata saknas",
      "viewer.error.missingLayerOrTheme": "Saknar lager eller tema",
      "viewer.error.missingProject": "Saknar projekt",
      "viewer.info.noCache": "Ingen cache tillgänglig",
      "viewer.error.leafletMissing": "Leaflet laddades inte (kontrollera SRI/CSP)",
      "viewer.notice.invalidCustomBounds": "Ogiltiga bounds för CRS {crs}",
      "viewer.notice.noProjDefinition": "Projektion saknas",
      "viewer.notice.noMatrix": "Tile-matris saknas",
      "viewer.notice.customMatrix": "Använder anpassad matris för {crs}",
      "viewer.notice.customExtent": "Använder anpassad utbredning i {crs}",
      "viewer.notice.wfsTruncated": "WFS-laddning stoppade vid {count} objekt (säkerhetsgräns)",
      "viewer.notice.osmUnavailable": "OSM-lager ej tillgängligt",
      "viewer.control.cacheStart": "Cache on demand",
      "viewer.control.cacheStop": "Stoppa cache",
      "viewer.control.cacheBusy": "Cachear…",
      "viewer.control.cacheDone": "Klar",
      "viewer.control.cacheError": "Fel",
      "viewer.control.cacheIdle": "Inaktiv",
      "viewer.control.osmShow": "Visa OSM",
      "viewer.control.osmHide": "Dölj OSM",
      "viewer.control.resetExtent": "Återställ utbredning"
      ,
      "Open WMS viewer": "Öppna WMS-visare"
    }
  };


  // Expose global translations so legacy inline scripts can keep using `TRANSLATIONS`
  try {
    window.TRANSLATIONS = TRANSLATIONS;
  } catch (err) {
    // ignore
  }

  const interpolate = (template, replacements) => {
    if (!template) return "";
    return String(template).replace(/\{(\w+)\}/g, (_, token) => (replacements && token in replacements ? replacements[token] : ""));
  };

  const t = (key, replacements) => {
    const lang = (window.qtilerLang && window.qtilerLang.get && window.qtilerLang.get()) || 'en';
    const table = (window.TRANSLATIONS && window.TRANSLATIONS[lang]) || {};
    const fallback = (window.TRANSLATIONS && window.TRANSLATIONS.en && window.TRANSLATIONS.en[key]) || key;
    const template = table[key] || fallback || key;
    return interpolate(template, replacements);
  };

  const applyTranslationsToDocument = () => {
    try {
      document.documentElement.setAttribute('lang', (window.qtilerLang && window.qtilerLang.get && window.qtilerLang.get()) || 'en');
      const lang = (window.qtilerLang && window.qtilerLang.get && window.qtilerLang.get()) || 'en';
      const centralTable = (window.TRANSLATIONS && window.TRANSLATIONS[lang]) || {};
      document.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (!key) return;
        // Only apply if central translations contain the key to avoid
        // overwriting page-specific translators (like admin-console.js)
        if (!(key in centralTable)) return;
        const text = t(key);
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          if (el.hasAttribute('placeholder')) el.placeholder = text;
        } else {
          el.textContent = text;
        }
      });
      document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (!key) return;
        if (!(key in centralTable)) return;
        el.placeholder = t(key);
      });
      document.querySelectorAll('[data-i18n-title]').forEach((el) => {
        const key = el.getAttribute('data-i18n-title');
        if (!key) return;
        if (!(key in centralTable)) return;
        el.title = t(key);
      });
    } catch (err) {
      // noop
    }
  };

  // Apply on language changes
  if (window.qtilerLang && window.qtilerLang.subscribe) {
    window.qtilerLang.subscribe(() => applyTranslationsToDocument());
  }

  // Also apply once on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyTranslationsToDocument);
  } else {
    applyTranslationsToDocument();
  }

  // Expose helper
  try {
    window.qtilerI18n = { t, apply: applyTranslationsToDocument };
  } catch (err) {}
})();
