/* ── i18n dictionary (en / es / sv / no) ── */
const QTWC_I18N = {
  en: {
    'Qtiler2qwc.title': 'QWC2 Bridge for Qtiler',
    'Qtiler2qwc.subtitle': 'Install QWC2 from GitHub and sync project visibility from QtilerAuth.',
    'Qtiler2qwc.installation': 'Installation',
    'Qtiler2qwc.github_repo': 'GitHub repo',
    'Qtiler2qwc.version_tag': 'Version',
    'Qtiler2qwc.refresh': '↻',
    'Qtiler2qwc.include_prerelease': 'Include pre-releases',
    'Qtiler2qwc.no_releases_found': '(no releases found)',
    'Qtiler2qwc.releases_error': '(error fetching releases)',
    'Qtiler2qwc.install_qwc2': 'Install QWC2',
    'Qtiler2qwc.uninstall_qwc2': 'Uninstall QWC2',
    'Qtiler2qwc.checking': 'Checking…',
    'Qtiler2qwc.installed': 'Installed',
    'Qtiler2qwc.not_installed': 'Not installed',
    'Qtiler2qwc.installed_at': 'Installed on {date} · repo {repo} · version {version}',
    'Qtiler2qwc.not_installed_hint': 'QWC2 is not installed. Enter the GitHub repo and version above, then click Install.',
    'Qtiler2qwc.standalone_server': 'QWC2 standalone server',
    'Qtiler2qwc.qwc2_port': 'QWC2 port',
    'Qtiler2qwc.start_server': 'Start server',
    'Qtiler2qwc.stop_server': 'Stop server',
    'Qtiler2qwc.open_qwc2': 'Open QWC2',
    'Qtiler2qwc.webmap_link': 'Open webmap',
    'Qtiler2qwc.running': 'Running',
    'Qtiler2qwc.stopped': 'Stopped',
    'Qtiler2qwc.server_running_at': 'Server running on port {port}',
    'Qtiler2qwc.server_stopped_hint': 'Server is not running. Set a port and click Start.',
    'Qtiler2qwc.logo_section': 'Webmap logo',
    'Qtiler2qwc.logo_desc': 'Upload a logo for the QWC2 TopBar. Allowed formats: PNG, JPG, SVG, WEBP.',
    'Qtiler2qwc.logo_file': 'Logo file',
    'Qtiler2qwc.upload_logo': 'Upload logo',
    'Qtiler2qwc.remove_logo': 'Remove logo',
    'Qtiler2qwc.no_logo': 'No logo',
    'Qtiler2qwc.logo_active': 'Active',
    'Qtiler2qwc.logo_updated_at': 'Logo updated: {date}',
    'Qtiler2qwc.logo_select_file': 'Select a file first.',
    'Qtiler2qwc.profiles_section': 'Published profiles',
    'Qtiler2qwc.profiles_desc': 'Manage generated profiles and launch links for QWC2 (webmap).',
    'Qtiler2qwc.publish_new': 'New profile',
    'Qtiler2qwc.no_profiles': 'No published profiles yet. Click "New profile" to create one.',
    'Qtiler2qwc.open_json': 'JSON',
    'Qtiler2qwc.open_qwc2_link': 'Open map',
    'Qtiler2qwc.edit_profile': 'Edit',
    'Qtiler2qwc.delete': 'Delete',
    'Qtiler2qwc.confirm_delete': 'Delete published profile for {id}?',
    'Qtiler2qwc.open_viewer': 'Open QWC2 viewer',
    'Qtiler2qwc.activity_log': 'Activity log',
    'Qtiler2qwc.clear': 'Clear',
    'Qtiler2qwc.no_activity': 'No activity yet.',
    'Qtiler2qwc.modal_title': 'Publish project in QWC2',
    'Qtiler2qwc.modal_title_edit': 'Edit profile: {id}',
    'Qtiler2qwc.main_project': 'Main project',
    'Qtiler2qwc.project_layers': 'Project layers',
    'Qtiler2qwc.bg_project': 'Background project (optional)',
    'Qtiler2qwc.bg_layers': 'Background layers',
    'Qtiler2qwc.default_bg': 'Default background',
    'Qtiler2qwc.default_bg_help': 'OSM and No background are always available. Choose one as default.',
    'Qtiler2qwc.qwc2_features': 'QWC2 features',
    'Qtiler2qwc.feat_search': 'Search',
    'Qtiler2qwc.feat_search_global': 'Global Search',
    'Qtiler2qwc.feat_editing': 'Editing',
    'Qtiler2qwc.feat_identify': 'Identify',
    'Qtiler2qwc.feat_layer_tree': 'Layer tree',
    'Qtiler2qwc.feat_legend': 'Legend',
    'Qtiler2qwc.feat_measurement': 'Measurement',
    'Qtiler2qwc.feat_print': 'Print',
    'Qtiler2qwc.feat_maptip': 'MapTip',
    'Qtiler2qwc.feat_share': 'Share',
    'Qtiler2qwc.feat_redlining': 'Redlining',
    'Qtiler2qwc.feat_bookmark': 'Bookmark',
    'Qtiler2qwc.feat_height_profile': 'Height profile',
    'Qtiler2qwc.feat_view3d': '3D Viewer',
    'Qtiler2qwc.feat_dxf_export': 'DXF Export',
    'Qtiler2qwc.feat_attribute_table': 'Attribute table',
    'Qtiler2qwc.feat_routing': 'Routing',
    'Qtiler2qwc.publish_now': 'Publish',
    'Qtiler2qwc.cancel': 'Cancel',
    'Qtiler2qwc.no_layers': 'No layers found.',
    'Qtiler2qwc.no_bg_available': 'No backgrounds available.',
    'Qtiler2qwc.no_project_selected': 'No project selected.',
    'Qtiler2qwc.no_bg_selected': 'No background project selected.',
    'Qtiler2qwc.optional_select': 'Optional: select another project first.',
    'Qtiler2qwc.no_bg_option': 'No background',
    'Qtiler2qwc.osm_bg': 'OSM background',
    'Qtiler2qwc.log_installed': 'QWC2 installed successfully.',
    'Qtiler2qwc.log_uninstalled': 'QWC2 uninstalled.',
    'Qtiler2qwc.log_server_started': 'Standalone server started on port {port}.',
    'Qtiler2qwc.log_server_stopped': 'Standalone server stopped.',
    'Qtiler2qwc.log_logo_uploaded': 'Logo uploaded.',
    'Qtiler2qwc.log_logo_removed': 'Logo removed.',
    'Qtiler2qwc.log_published': 'Profile "{id}" published.',
    'Qtiler2qwc.log_deleted': 'Profile "{id}" deleted.',
    'Qtiler2qwc.log_error': 'Error: {msg}',
    'Qtiler2qwc.requires_install': 'Install QWC2 first to use this section.',
    'Qtiler2qwc.loading': 'Loading...',
    'Qtiler2qwc.searchable': 'searchable',
    'Qtiler2qwc.editable': 'editable',
    'Qtiler2qwc.layers_count': '{n} layers',
    'Qtiler2qwc.bg_count': '{n} backgrounds',
    'Qtiler2qwc.tab_setup': 'Setup',
    'Qtiler2qwc.tab_maps': 'Maps',
    'Qtiler2qwc.tab_log': 'Log',
    'Qtiler2qwc.map_name': 'Map name',
    'Qtiler2qwc.map_name_placeholder': 'Unique name for this map',
    'Qtiler2qwc.map_description': 'Description',
    'Qtiler2qwc.map_desc_placeholder': 'Optional description',
    'Qtiler2qwc.name_required': 'A name is required.',
    'Qtiler2qwc.name_duplicate': 'A map with this name already exists.',
    'Qtiler2qwc.step_layers': '1. Layers',
    'Qtiler2qwc.step_backgrounds': '2. Background maps',
    'Qtiler2qwc.step_tools': '3. Tools',
    'Qtiler2qwc.default': 'Default',
    'Qtiler2qwc.feat_search_desc': 'Full-text search across map layers',
    'Qtiler2qwc.feat_search_global_desc': 'Enable Coordinates and Nominatim OSM',
    'Qtiler2qwc.feat_search_help': 'Local search uses your searchable layers through /Qtiler2qwc/search. Global Search adds coordinates and Nominatim results on top.',
    'Qtiler2qwc.feat_identify_desc': 'Click map to query feature attributes',
    'Qtiler2qwc.feat_layer_tree_desc': 'Show/hide layers and groups',
    'Qtiler2qwc.feat_legend_desc': 'Display layer symbology and legend',
    'Qtiler2qwc.feat_editing_desc': 'Create, update, and delete features',
    'Qtiler2qwc.feat_print_desc': 'Export map to PDF using QGIS layouts',
    'Qtiler2qwc.feat_maptip_desc': 'Hover tooltips with feature info',
    'Qtiler2qwc.feat_measurement_desc': 'Measure distances and areas on the map',
    'Qtiler2qwc.feat_share_desc': 'Share current map view via URL',
    'Qtiler2qwc.feat_redlining_desc': 'Draw temporary shapes and annotations',
    'Qtiler2qwc.feat_bookmark_desc': 'Save and restore map extents',
    'Qtiler2qwc.feat_height_profile_desc': 'Elevation cross-section along a path',
    'Qtiler2qwc.feat_view3d_desc': 'Enable the QWC2 View3D module for terrain and 3D layers',
    'Qtiler2qwc.feat_dxf_export_desc': 'Download layers as AutoCAD DXF',
    'Qtiler2qwc.feat_attribute_table_desc': 'Tabular view of feature attributes',
    'Qtiler2qwc.feat_routing_desc': 'Calculate routes between points',
    'Qtiler2qwc.tool_config': 'Configuration',
    'Qtiler2qwc.cfg_share_url': 'Share service URL',
    'Qtiler2qwc.cfg_share_url_ph': 'https://example.com/share',
    'Qtiler2qwc.cfg_routing_url': 'Routing service URL (OSRM/Valhalla)',
    'Qtiler2qwc.cfg_routing_url_ph': 'https://router.example.com/route',
    'Qtiler2qwc.cfg_elevation_url': 'Elevation service URL',
    'Qtiler2qwc.cfg_elevation_url_ph': 'https://elevation.example.com',
    'Qtiler2qwc.cfg_dxf_url': 'DXF export service URL',
    'Qtiler2qwc.cfg_dxf_url_ph': 'https://example.com/dxf',
    'Qtiler2qwc.hiw.button': 'How it works & Security',
    'Qtiler2qwc.hiw.title': 'How QTWC works & security',
    'Qtiler2qwc.hiw.lead': 'QTWC embeds the QWC2 web map viewer inside Qtiler. It downloads QWC2 from a pinned GitHub release, generates the themes catalog from your QGIS projects and lets QtilerAuth enforce per-user visibility.',
    'Qtiler2qwc.hiw.arch.title': '1. Architecture',
    'Qtiler2qwc.hiw.arch.1': 'Express plugin under plugins/Qtiler2qwc/. QWC2 build is downloaded from GitHub and served at /plugins/Qtiler2qwc/qwc2.',
    'Qtiler2qwc.hiw.arch.2': 'Themes are generated from QGIS projects on disk; nested folders are scanned recursively.',
    'Qtiler2qwc.hiw.arch.3': 'Edit configs and locales are gated at runtime so updates take effect without a server restart.',
    'Qtiler2qwc.hiw.flow.title': '2. Step by step',
    'Qtiler2qwc.hiw.flow.1': 'Setup tab: choose a GitHub tag (optionally including pre-releases) and click Install QWC2.',
    'Qtiler2qwc.hiw.flow.2': 'Maps tab: published projects appear automatically. Configure the launch URL, default WMTS background, edit configs and locales per theme.',
    'Qtiler2qwc.hiw.flow.3': 'Upload a logo and adjust branding for the QWC2 top bar.',
    'Qtiler2qwc.hiw.flow.4': 'Open the live viewer at /plugins/Qtiler2qwc/qwc2 — themes refresh on demand.',
    'Qtiler2qwc.hiw.themes.title': '3. Themes & projects',
    'Qtiler2qwc.hiw.themes.1': 'A themes.json catalog is generated from QGIS projects; each theme inherits CRS, scales and layers from the project.',
    'Qtiler2qwc.hiw.themes.2': 'launchUrl is built per theme so deep links open with the correct project pre-selected.',
    'Qtiler2qwc.hiw.themes.3': 'Default WMTS background invariants are enforced so themes always have a working base layer.',
    'Qtiler2qwc.hiw.print.title': '4. Print (serverless contract)',
    'Qtiler2qwc.hiw.print.1': 'Print uses QGIS layouts/themes via a serverless contract — no separate print server.',
    'Qtiler2qwc.hiw.print.2': 'Layouts are discovered per project and surfaced in the QWC2 print panel automatically.',
    'Qtiler2qwc.hiw.auth.title': '5. Authentication & visibility',
    'Qtiler2qwc.hiw.auth.1': 'Project visibility is synced live from QtilerAuth: public, authenticated and private rules are honoured.',
    'Qtiler2qwc.hiw.auth.2': 'When QtilerAuth is enabled, theme catalog endpoints filter out projects the user cannot access.',
    'Qtiler2qwc.hiw.auth.3': 'Mojibake-safe handling for tokens with non-ASCII characters — invalid tokens are rejected cleanly.',
    'Qtiler2qwc.hiw.security.title': '6. Security & privacy',
    'Qtiler2qwc.hiw.security.1': 'Network calls are limited to GitHub during install and to QtilerAuth for ACLs; no runtime telemetry.',
    'Qtiler2qwc.hiw.security.2': 'Admin actions (install/uninstall, branding, configs) require an authenticated admin user.',
    'Qtiler2qwc.hiw.security.3': 'Open source under MPL-2.0; auditable in plugins/Qtiler2qwc/.'
  },
  es: {
    'Qtiler2qwc.title': 'Puente QWC2 para Qtiler',
    'Qtiler2qwc.subtitle': 'Instala QWC2 desde GitHub y sincroniza la visibilidad de proyectos con QtilerAuth.',
    'Qtiler2qwc.installation': 'Instalación',
    'Qtiler2qwc.github_repo': 'Repositorio GitHub',
    'Qtiler2qwc.version_tag': 'Versión',
    'Qtiler2qwc.refresh': '↻',
    'Qtiler2qwc.include_prerelease': 'Incluir pre-releases',
    'Qtiler2qwc.no_releases_found': '(no se encontraron releases)',
    'Qtiler2qwc.releases_error': '(error al obtener releases)',
    'Qtiler2qwc.install_qwc2': 'Instalar QWC2',
    'Qtiler2qwc.uninstall_qwc2': 'Desinstalar QWC2',
    'Qtiler2qwc.checking': 'Verificando…',
    'Qtiler2qwc.installed': 'Instalado',
    'Qtiler2qwc.not_installed': 'No instalado',
    'Qtiler2qwc.installed_at': 'Instalado el {date} · repo {repo} · versión {version}',
    'Qtiler2qwc.not_installed_hint': 'QWC2 no está instalado. Ingresa el repo y la versión arriba, luego haz clic en Instalar.',
    'Qtiler2qwc.standalone_server': 'Servidor QWC2 independiente',
    'Qtiler2qwc.qwc2_port': 'Puerto QWC2',
    'Qtiler2qwc.start_server': 'Iniciar servidor',
    'Qtiler2qwc.stop_server': 'Detener servidor',
    'Qtiler2qwc.open_qwc2': 'Abrir QWC2',
    'Qtiler2qwc.webmap_link': 'Abrir webmap',
    'Qtiler2qwc.running': 'Ejecutando',
    'Qtiler2qwc.stopped': 'Detenido',
    'Qtiler2qwc.server_running_at': 'Servidor ejecutando en puerto {port}',
    'Qtiler2qwc.server_stopped_hint': 'El servidor no está ejecutando. Define un puerto y haz clic en Iniciar.',
    'Qtiler2qwc.logo_section': 'Logo del webmap',
    'Qtiler2qwc.logo_desc': 'Sube un logo para el TopBar de QWC2. Formatos permitidos: PNG, JPG, SVG, WEBP.',
    'Qtiler2qwc.logo_file': 'Archivo de logo',
    'Qtiler2qwc.upload_logo': 'Subir logo',
    'Qtiler2qwc.remove_logo': 'Quitar logo',
    'Qtiler2qwc.no_logo': 'Sin logo',
    'Qtiler2qwc.logo_active': 'Activo',
    'Qtiler2qwc.logo_updated_at': 'Logo actualizado: {date}',
    'Qtiler2qwc.logo_select_file': 'Selecciona un archivo primero.',
    'Qtiler2qwc.profiles_section': 'Perfiles publicados',
    'Qtiler2qwc.profiles_desc': 'Gestiona perfiles generados y enlaces de lanzamiento para QWC2 (webmap).',
    'Qtiler2qwc.publish_new': 'Nuevo perfil',
    'Qtiler2qwc.no_profiles': 'Aún no hay perfiles publicados. Haz clic en "Nuevo perfil" para crear uno.',
    'Qtiler2qwc.open_json': 'JSON',
    'Qtiler2qwc.open_qwc2_link': 'Abrir mapa',
    'Qtiler2qwc.edit_profile': 'Editar',
    'Qtiler2qwc.delete': 'Eliminar',
    'Qtiler2qwc.confirm_delete': '¿Eliminar perfil publicado de {id}?',
    'Qtiler2qwc.open_viewer': 'Abrir visor QWC2',
    'Qtiler2qwc.activity_log': 'Registro de actividad',
    'Qtiler2qwc.clear': 'Limpiar',
    'Qtiler2qwc.no_activity': 'Sin actividad aún.',
    'Qtiler2qwc.modal_title': 'Publicar proyecto en QWC2',
    'Qtiler2qwc.modal_title_edit': 'Editar perfil: {id}',
    'Qtiler2qwc.main_project': 'Proyecto principal',
    'Qtiler2qwc.project_layers': 'Capas del proyecto',
    'Qtiler2qwc.bg_project': 'Proyecto de fondo (opcional)',
    'Qtiler2qwc.bg_layers': 'Capas de fondo',
    'Qtiler2qwc.default_bg': 'Fondo por defecto',
    'Qtiler2qwc.default_bg_help': 'OSM y Sin fondo siempre disponibles. Elige uno como predeterminado.',
    'Qtiler2qwc.qwc2_features': 'Funciones de QWC2',
    'Qtiler2qwc.feat_search': 'Búsqueda',
    'Qtiler2qwc.feat_search_global': 'Búsqueda global',
    'Qtiler2qwc.feat_editing': 'Edición',
    'Qtiler2qwc.feat_identify': 'Identificar',
    'Qtiler2qwc.feat_layer_tree': 'Árbol de capas',
    'Qtiler2qwc.feat_legend': 'Leyenda',
    'Qtiler2qwc.feat_measurement': 'Medición',
    'Qtiler2qwc.feat_print': 'Imprimir',
    'Qtiler2qwc.feat_maptip': 'Información emergente',
    'Qtiler2qwc.feat_share': 'Compartir',
    'Qtiler2qwc.feat_redlining': 'Anotaciones',
    'Qtiler2qwc.feat_bookmark': 'Marcadores',
    'Qtiler2qwc.feat_height_profile': 'Perfil de altura',
    'Qtiler2qwc.feat_view3d': 'Visor 3D',
    'Qtiler2qwc.feat_dxf_export': 'Exportar DXF',
    'Qtiler2qwc.feat_attribute_table': 'Tabla de atributos',
    'Qtiler2qwc.feat_routing': 'Enrutamiento',
    'Qtiler2qwc.publish_now': 'Publicar',
    'Qtiler2qwc.cancel': 'Cancelar',
    'Qtiler2qwc.no_layers': 'No se encontraron capas.',
    'Qtiler2qwc.no_bg_available': 'Sin fondos disponibles.',
    'Qtiler2qwc.no_project_selected': 'Sin proyecto seleccionado.',
    'Qtiler2qwc.no_bg_selected': 'Sin proyecto de fondo seleccionado.',
    'Qtiler2qwc.optional_select': 'Opcional: selecciona otro proyecto primero.',
    'Qtiler2qwc.no_bg_option': 'Sin fondo',
    'Qtiler2qwc.osm_bg': 'Fondo OSM',
    'Qtiler2qwc.log_installed': 'QWC2 instalado correctamente.',
    'Qtiler2qwc.log_uninstalled': 'QWC2 desinstalado.',
    'Qtiler2qwc.log_server_started': 'Servidor iniciado en puerto {port}.',
    'Qtiler2qwc.log_server_stopped': 'Servidor detenido.',
    'Qtiler2qwc.log_logo_uploaded': 'Logo subido.',
    'Qtiler2qwc.log_logo_removed': 'Logo eliminado.',
    'Qtiler2qwc.log_published': 'Perfil "{id}" publicado.',
    'Qtiler2qwc.log_deleted': 'Perfil "{id}" eliminado.',
    'Qtiler2qwc.log_error': 'Error: {msg}',
    'Qtiler2qwc.requires_install': 'Instala QWC2 primero para usar esta sección.',
    'Qtiler2qwc.loading': 'Cargando...',
    'Qtiler2qwc.searchable': 'buscable',
    'Qtiler2qwc.editable': 'editable',
    'Qtiler2qwc.layers_count': '{n} capas',
    'Qtiler2qwc.bg_count': '{n} fondos',
    'Qtiler2qwc.tab_setup': 'Configuración',
    'Qtiler2qwc.tab_maps': 'Mapas',
    'Qtiler2qwc.tab_log': 'Registro',
    'Qtiler2qwc.map_name': 'Nombre del mapa',
    'Qtiler2qwc.map_name_placeholder': 'Nombre único para este mapa',
    'Qtiler2qwc.map_description': 'Descripción',
    'Qtiler2qwc.map_desc_placeholder': 'Descripción opcional',
    'Qtiler2qwc.name_required': 'Se requiere un nombre.',
    'Qtiler2qwc.name_duplicate': 'Ya existe un mapa con este nombre.',
    'Qtiler2qwc.step_layers': '1. Capas',
    'Qtiler2qwc.step_backgrounds': '2. Mapas de fondo',
    'Qtiler2qwc.step_tools': '3. Herramientas',
    'Qtiler2qwc.default': 'Por defecto',
    'Qtiler2qwc.feat_search_desc': 'Búsqueda de texto completo en capas del mapa',
    'Qtiler2qwc.feat_search_global_desc': 'Activa coordenadas y Nominatim de OSM',
    'Qtiler2qwc.feat_search_help': 'La búsqueda local usa tus capas configuradas como buscables a través de /Qtiler2qwc/search. La búsqueda global añade coordenadas y resultados de Nominatim.',
    'Qtiler2qwc.feat_identify_desc': 'Haz clic en el mapa para consultar atributos',
    'Qtiler2qwc.feat_layer_tree_desc': 'Mostrar/ocultar capas y grupos',
    'Qtiler2qwc.feat_legend_desc': 'Mostrar simbología y leyenda de capas',
    'Qtiler2qwc.feat_editing_desc': 'Crear, actualizar y eliminar elementos',
    'Qtiler2qwc.feat_print_desc': 'Exportar mapa a PDF con diseños de QGIS',
    'Qtiler2qwc.feat_maptip_desc': 'Información emergente al pasar el ratón',
    'Qtiler2qwc.feat_measurement_desc': 'Medir distancias y áreas en el mapa',
    'Qtiler2qwc.feat_share_desc': 'Compartir la vista actual del mapa por URL',
    'Qtiler2qwc.feat_redlining_desc': 'Dibujar formas temporales y anotaciones',
    'Qtiler2qwc.feat_bookmark_desc': 'Guardar y restaurar extensiones del mapa',
    'Qtiler2qwc.feat_height_profile_desc': 'Sección transversal de elevación a lo largo de un camino',
    'Qtiler2qwc.feat_view3d_desc': 'Activa el módulo View3D de QWC2 para terreno y capas 3D',
    'Qtiler2qwc.feat_dxf_export_desc': 'Descargar capas como AutoCAD DXF',
    'Qtiler2qwc.feat_attribute_table_desc': 'Vista tabular de atributos de elementos',
    'Qtiler2qwc.feat_routing_desc': 'Calcular rutas entre puntos',
    'Qtiler2qwc.tool_config': 'Configuración',
    'Qtiler2qwc.cfg_share_url': 'URL del servicio de compartir',
    'Qtiler2qwc.cfg_share_url_ph': 'https://ejemplo.com/share',
    'Qtiler2qwc.cfg_routing_url': 'URL del servicio de rutas (OSRM/Valhalla)',
    'Qtiler2qwc.cfg_routing_url_ph': 'https://router.ejemplo.com/route',
    'Qtiler2qwc.cfg_elevation_url': 'URL del servicio de elevación',
    'Qtiler2qwc.cfg_elevation_url_ph': 'https://elevation.ejemplo.com',
    'Qtiler2qwc.cfg_dxf_url': 'URL del servicio de exportación DXF',
    'Qtiler2qwc.cfg_dxf_url_ph': 'https://ejemplo.com/dxf',
    'Qtiler2qwc.hiw.button': 'Cómo funciona y seguridad',
    'Qtiler2qwc.hiw.title': 'Cómo funciona QTWC y por qué es seguro',
    'Qtiler2qwc.hiw.lead': 'QTWC integra el visor web QWC2 dentro de Qtiler. Descarga QWC2 desde una release fija de GitHub, genera el catálogo de temas desde tus proyectos QGIS y deja que QtilerAuth aplique la visibilidad por usuario.',
    'Qtiler2qwc.hiw.arch.title': '1. Arquitectura',
    'Qtiler2qwc.hiw.arch.1': 'Plugin Express en plugins/Qtiler2qwc/. El build de QWC2 se descarga de GitHub y se sirve en /plugins/Qtiler2qwc/qwc2.',
    'Qtiler2qwc.hiw.arch.2': 'Los temas se generan a partir de los proyectos QGIS en disco; las carpetas anidadas se exploran de forma recursiva.',
    'Qtiler2qwc.hiw.arch.3': 'Las configuraciones de edición y los locales se gestionan en tiempo de ejecución sin reiniciar el servidor.',
    'Qtiler2qwc.hiw.flow.title': '2. Paso a paso',
    'Qtiler2qwc.hiw.flow.1': 'Pestaña Setup: elige un tag de GitHub (opcionalmente pre-releases) y pulsa Instalar QWC2.',
    'Qtiler2qwc.hiw.flow.2': 'Pestaña Mapas: los proyectos publicados aparecen automáticamente. Configura launch URL, fondo WMTS por defecto, edit configs y locales por tema.',
    'Qtiler2qwc.hiw.flow.3': 'Sube un logo y ajusta la marca para la barra superior de QWC2.',
    'Qtiler2qwc.hiw.flow.4': 'Abre el visor en /plugins/Qtiler2qwc/qwc2 — los temas se refrescan bajo demanda.',
    'Qtiler2qwc.hiw.themes.title': '3. Temas y proyectos',
    'Qtiler2qwc.hiw.themes.1': 'Se genera un catálogo themes.json desde los proyectos QGIS; cada tema hereda CRS, escalas y capas del proyecto.',
    'Qtiler2qwc.hiw.themes.2': 'launchUrl se construye por tema para que los enlaces directos abran el proyecto correcto preseleccionado.',
    'Qtiler2qwc.hiw.themes.3': 'Se garantizan invariantes de fondo WMTS por defecto para que los temas tengan siempre una capa base válida.',
    'Qtiler2qwc.hiw.print.title': '4. Impresión (contrato sin servidor)',
    'Qtiler2qwc.hiw.print.1': 'La impresión usa layouts/temas de QGIS mediante un contrato serverless — sin servidor de impresión aparte.',
    'Qtiler2qwc.hiw.print.2': 'Los layouts se descubren por proyecto y aparecen automáticamente en el panel de impresión de QWC2.',
    'Qtiler2qwc.hiw.auth.title': '5. Autenticación y visibilidad',
    'Qtiler2qwc.hiw.auth.1': 'La visibilidad de proyectos se sincroniza en vivo con QtilerAuth: se respetan las reglas public, authenticated y private.',
    'Qtiler2qwc.hiw.auth.2': 'Con QtilerAuth activo, los endpoints del catálogo filtran los proyectos a los que el usuario no tiene acceso.',
    'Qtiler2qwc.hiw.auth.3': 'Manejo seguro frente a mojibake en tokens con caracteres no ASCII — los tokens inválidos se rechazan limpiamente.',
    'Qtiler2qwc.hiw.security.title': '6. Seguridad y privacidad',
    'Qtiler2qwc.hiw.security.1': 'Las llamadas de red se limitan a GitHub al instalar y a QtilerAuth para ACLs; sin telemetría en tiempo de ejecución.',
    'Qtiler2qwc.hiw.security.2': 'Las acciones de administración (instalar/desinstalar, branding, configs) requieren un usuario admin autenticado.',
    'Qtiler2qwc.hiw.security.3': 'Open source bajo MPL-2.0; auditable en plugins/Qtiler2qwc/.'
  },
  sv: {
    'Qtiler2qwc.title': 'QWC2-brygga för Qtiler',
    'Qtiler2qwc.subtitle': 'Installera QWC2 från GitHub och synkronisera projektsynlighet från QtilerAuth.',
    'Qtiler2qwc.installation': 'Installation',
    'Qtiler2qwc.github_repo': 'GitHub-repo',
    'Qtiler2qwc.version_tag': 'Version',
    'Qtiler2qwc.refresh': '↻',
    'Qtiler2qwc.include_prerelease': 'Inkludera pre-releases',
    'Qtiler2qwc.no_releases_found': '(inga releases hittades)',
    'Qtiler2qwc.releases_error': '(fel vid hämtning av releases)',
    'Qtiler2qwc.install_qwc2': 'Installera QWC2',
    'Qtiler2qwc.uninstall_qwc2': 'Avinstallera QWC2',
    'Qtiler2qwc.checking': 'Kontrollerar…',
    'Qtiler2qwc.installed': 'Installerad',
    'Qtiler2qwc.not_installed': 'Ej installerad',
    'Qtiler2qwc.installed_at': 'Installerad {date} · repo {repo} · version {version}',
    'Qtiler2qwc.not_installed_hint': 'QWC2 är inte installerad. Ange repo och version ovan, klicka sedan på Installera.',
    'Qtiler2qwc.standalone_server': 'Fristående QWC2-server',
    'Qtiler2qwc.qwc2_port': 'QWC2-port',
    'Qtiler2qwc.start_server': 'Starta server',
    'Qtiler2qwc.stop_server': 'Stoppa server',
    'Qtiler2qwc.open_qwc2': 'Öppna QWC2',
    'Qtiler2qwc.webmap_link': 'Öppna webbkarta',
    'Qtiler2qwc.running': 'Körs',
    'Qtiler2qwc.stopped': 'Stoppad',
    'Qtiler2qwc.server_running_at': 'Server körs på port {port}',
    'Qtiler2qwc.server_stopped_hint': 'Server körs inte. Ange port och klicka Starta.',
    'Qtiler2qwc.logo_section': 'Webbkart-logotyp',
    'Qtiler2qwc.logo_desc': 'Ladda upp en logotyp för QWC2 TopBar. Tillåtna format: PNG, JPG, SVG, WEBP.',
    'Qtiler2qwc.logo_file': 'Logotypfil',
    'Qtiler2qwc.upload_logo': 'Ladda upp logotyp',
    'Qtiler2qwc.remove_logo': 'Ta bort logotyp',
    'Qtiler2qwc.no_logo': 'Ingen logotyp',
    'Qtiler2qwc.logo_active': 'Aktiv',
    'Qtiler2qwc.logo_updated_at': 'Logotyp uppdaterad: {date}',
    'Qtiler2qwc.logo_select_file': 'Välj en fil först.',
    'Qtiler2qwc.profiles_section': 'Publicerade profiler',
    'Qtiler2qwc.profiles_desc': 'Hantera genererade profiler och startlänkar för QWC2 (webmap).',
    'Qtiler2qwc.publish_new': 'Ny profil',
    'Qtiler2qwc.no_profiles': 'Inga publicerade profiler ännu. Klicka "Ny profil" för att skapa en.',
    'Qtiler2qwc.open_json': 'JSON',
    'Qtiler2qwc.open_qwc2_link': 'Öppna karta',
    'Qtiler2qwc.edit_profile': 'Redigera',
    'Qtiler2qwc.delete': 'Radera',
    'Qtiler2qwc.confirm_delete': 'Radera publicerad profil för {id}?',
    'Qtiler2qwc.open_viewer': 'Öppna QWC2-visaren',
    'Qtiler2qwc.activity_log': 'Aktivitetslogg',
    'Qtiler2qwc.clear': 'Rensa',
    'Qtiler2qwc.no_activity': 'Ingen aktivitet ännu.',
    'Qtiler2qwc.modal_title': 'Publicera projekt i QWC2',
    'Qtiler2qwc.modal_title_edit': 'Redigera profil: {id}',
    'Qtiler2qwc.main_project': 'Huvudprojekt',
    'Qtiler2qwc.project_layers': 'Projektlager',
    'Qtiler2qwc.bg_project': 'Bakgrundsprojekt (valfritt)',
    'Qtiler2qwc.bg_layers': 'Bakgrundslager',
    'Qtiler2qwc.default_bg': 'Standardbakgrund',
    'Qtiler2qwc.default_bg_help': 'OSM och Ingen bakgrund är alltid tillgängliga. Välj en som standard.',
    'Qtiler2qwc.qwc2_features': 'QWC2-funktioner',
    'Qtiler2qwc.feat_search': 'Sök',
    'Qtiler2qwc.feat_search_global': 'Global sökning',
    'Qtiler2qwc.feat_editing': 'Redigering',
    'Qtiler2qwc.feat_identify': 'Identifiera',
    'Qtiler2qwc.feat_layer_tree': 'Lagerträd',
    'Qtiler2qwc.feat_legend': 'Teckenförklaring',
    'Qtiler2qwc.feat_measurement': 'Mätning',
    'Qtiler2qwc.feat_print': 'Skriv ut',
    'Qtiler2qwc.feat_maptip': 'Karttips',
    'Qtiler2qwc.feat_share': 'Dela',
    'Qtiler2qwc.feat_redlining': 'Anteckningar',
    'Qtiler2qwc.feat_bookmark': 'Bokmärken',
    'Qtiler2qwc.feat_height_profile': 'Höjdprofil',
    'Qtiler2qwc.feat_view3d': '3D-visare',
    'Qtiler2qwc.feat_dxf_export': 'DXF-export',
    'Qtiler2qwc.feat_attribute_table': 'Attributtabell',
    'Qtiler2qwc.feat_routing': 'Vägval',
    'Qtiler2qwc.publish_now': 'Publicera',
    'Qtiler2qwc.cancel': 'Avbryt',
    'Qtiler2qwc.no_layers': 'Inga lager hittades.',
    'Qtiler2qwc.no_bg_available': 'Inga bakgrunder tillgängliga.',
    'Qtiler2qwc.no_project_selected': 'Inget projekt valt.',
    'Qtiler2qwc.no_bg_selected': 'Inget bakgrundsprojekt valt.',
    'Qtiler2qwc.optional_select': 'Valfritt: välj ett annat projekt först.',
    'Qtiler2qwc.no_bg_option': 'Ingen bakgrund',
    'Qtiler2qwc.osm_bg': 'OSM-bakgrund',
    'Qtiler2qwc.log_installed': 'QWC2 installerad.',
    'Qtiler2qwc.log_uninstalled': 'QWC2 avinstallerad.',
    'Qtiler2qwc.log_server_started': 'Server startad på port {port}.',
    'Qtiler2qwc.log_server_stopped': 'Server stoppad.',
    'Qtiler2qwc.log_logo_uploaded': 'Logotyp uppladdad.',
    'Qtiler2qwc.log_logo_removed': 'Logotyp borttagen.',
    'Qtiler2qwc.log_published': 'Profil "{id}" publicerad.',
    'Qtiler2qwc.log_deleted': 'Profil "{id}" raderad.',
    'Qtiler2qwc.log_error': 'Fel: {msg}',
    'Qtiler2qwc.requires_install': 'Installera QWC2 först för att använda denna sektion.',
    'Qtiler2qwc.loading': 'Laddar...',
    'Qtiler2qwc.searchable': 'sökbar',
    'Qtiler2qwc.editable': 'redigerbar',
    'Qtiler2qwc.layers_count': '{n} lager',
    'Qtiler2qwc.bg_count': '{n} bakgrunder',
    'Qtiler2qwc.tab_setup': 'Inställningar',
    'Qtiler2qwc.tab_maps': 'Kartor',
    'Qtiler2qwc.tab_log': 'Logg',
    'Qtiler2qwc.map_name': 'Kartnamn',
    'Qtiler2qwc.map_name_placeholder': 'Unikt namn för denna karta',
    'Qtiler2qwc.map_description': 'Beskrivning',
    'Qtiler2qwc.map_desc_placeholder': 'Valfri beskrivning',
    'Qtiler2qwc.name_required': 'Ett namn krävs.',
    'Qtiler2qwc.name_duplicate': 'En karta med detta namn finns redan.',
    'Qtiler2qwc.step_layers': '1. Lager',
    'Qtiler2qwc.step_backgrounds': '2. Bakgrundskartor',
    'Qtiler2qwc.step_tools': '3. Verktyg',
    'Qtiler2qwc.default': 'Standard',
    'Qtiler2qwc.feat_search_desc': 'Fulltextsökning i kartlager',
    'Qtiler2qwc.feat_search_global_desc': 'Aktivera koordinater och Nominatim OSM',
    'Qtiler2qwc.feat_search_help': 'Lokal sökning använder dina sökbara lager via /Qtiler2qwc/search. Global sökning lägger till koordinater och Nominatim-resultat ovanpå detta.',
    'Qtiler2qwc.feat_identify_desc': 'Klicka på kartan för att fråga attribut',
    'Qtiler2qwc.feat_layer_tree_desc': 'Visa/dölj lager och grupper',
    'Qtiler2qwc.feat_legend_desc': 'Visa lagersymbologi och teckenförklaring',
    'Qtiler2qwc.feat_editing_desc': 'Skapa, uppdatera och ta bort objekt',
    'Qtiler2qwc.feat_print_desc': 'Exportera karta till PDF med QGIS-layouter',
    'Qtiler2qwc.feat_maptip_desc': 'Hovertips med objektinformation',
    'Qtiler2qwc.feat_measurement_desc': 'Mät avstånd och arealer på kartan',
    'Qtiler2qwc.feat_share_desc': 'Dela aktuell kartvy via URL',
    'Qtiler2qwc.feat_redlining_desc': 'Rita temporära former och anteckningar',
    'Qtiler2qwc.feat_bookmark_desc': 'Spara och återställ kartomfång',
    'Qtiler2qwc.feat_height_profile_desc': 'Höjdtvärsnitt längs en sträcka',
    'Qtiler2qwc.feat_view3d_desc': 'Aktivera QWC2:s View3D-modul för terräng och 3D-lager',
    'Qtiler2qwc.feat_dxf_export_desc': 'Ladda ner lager som AutoCAD DXF',
    'Qtiler2qwc.feat_attribute_table_desc': 'Tabellvy av objektattribut',
    'Qtiler2qwc.feat_routing_desc': 'Beräkna rutter mellan punkter',
    'Qtiler2qwc.tool_config': 'Konfiguration',
    'Qtiler2qwc.cfg_share_url': 'Delningstjänst-URL',
    'Qtiler2qwc.cfg_share_url_ph': 'https://example.com/share',
    'Qtiler2qwc.cfg_routing_url': 'Ruttjänst-URL (OSRM/Valhalla)',
    'Qtiler2qwc.cfg_routing_url_ph': 'https://router.example.com/route',
    'Qtiler2qwc.cfg_elevation_url': 'Höjddatatjänst-URL',
    'Qtiler2qwc.cfg_elevation_url_ph': 'https://elevation.example.com',
    'Qtiler2qwc.cfg_dxf_url': 'DXF-exporttjänst-URL',
    'Qtiler2qwc.cfg_dxf_url_ph': 'https://example.com/dxf',
    'Qtiler2qwc.hiw.button': 'Så fungerar det & säkerhet',
    'Qtiler2qwc.hiw.title': 'Så fungerar QTWC och varför det är säkert',
    'Qtiler2qwc.hiw.lead': 'QTWC bäddar in webbkartvyn QWC2 i Qtiler. Det laddar ner QWC2 från en GitHub-release, genererar tema-katalogen från dina QGIS-projekt och låter QtilerAuth hantera synlighet per användare.',
    'Qtiler2qwc.hiw.arch.title': '1. Arkitektur',
    'Qtiler2qwc.hiw.arch.1': 'Express-plugin under plugins/Qtiler2qwc/. QWC2-bygget laddas ner från GitHub och serveras på /plugins/Qtiler2qwc/qwc2.',
    'Qtiler2qwc.hiw.arch.2': 'Teman genereras från QGIS-projekt på disk; nestade mappar genomsöks rekursivt.',
    'Qtiler2qwc.hiw.arch.3': 'Edit configs och locales hanteras vid körning så ändringar träder i kraft utan omstart av servern.',
    'Qtiler2qwc.hiw.flow.title': '2. Steg för steg',
    'Qtiler2qwc.hiw.flow.1': 'Setup-fliken: välj en GitHub-tagg (eventuellt inklusive pre-releases) och klicka Installera QWC2.',
    'Qtiler2qwc.hiw.flow.2': 'Maps-fliken: publicerade projekt visas automatiskt. Konfigurera launch URL, standard-WMTS-bakgrund, edit configs och locales per tema.',
    'Qtiler2qwc.hiw.flow.3': 'Ladda upp en logotyp och anpassa varumärket för QWC2:s topplist.',
    'Qtiler2qwc.hiw.flow.4': 'Öppna visningen på /plugins/Qtiler2qwc/qwc2 — teman uppdateras vid behov.',
    'Qtiler2qwc.hiw.themes.title': '3. Teman och projekt',
    'Qtiler2qwc.hiw.themes.1': 'En themes.json-katalog genereras från QGIS-projekten; varje tema ärver CRS, skalor och lager från projektet.',
    'Qtiler2qwc.hiw.themes.2': 'launchUrl byggs per tema så djupa länkar öppnas med rätt projekt förvalt.',
    'Qtiler2qwc.hiw.themes.3': 'Standard-WMTS-bakgrund garanteras så att teman alltid har ett fungerande baslager.',
    'Qtiler2qwc.hiw.print.title': '4. Utskrift (serverless)',
    'Qtiler2qwc.hiw.print.1': 'Utskrift använder QGIS-layouter/teman via ett serverless-kontrakt — ingen separat utskriftsserver.',
    'Qtiler2qwc.hiw.print.2': 'Layouter upptäcks per projekt och visas automatiskt i QWC2:s utskriftspanel.',
    'Qtiler2qwc.hiw.auth.title': '5. Autentisering och synlighet',
    'Qtiler2qwc.hiw.auth.1': 'Projektsynlighet synkas live från QtilerAuth: public-, authenticated- och private-regler respekteras.',
    'Qtiler2qwc.hiw.auth.2': 'När QtilerAuth är aktivt filtrerar tema-katalogens endpoints bort projekt användaren inte har åtkomst till.',
    'Qtiler2qwc.hiw.auth.3': 'Mojibake-säker hantering av tokens med icke-ASCII-tecken — ogiltiga tokens avvisas rent.',
    'Qtiler2qwc.hiw.security.title': '6. Säkerhet och integritet',
    'Qtiler2qwc.hiw.security.1': 'Nätverksanrop sker endast mot GitHub vid installation och mot QtilerAuth för ACL:er; ingen körtidstelemetri.',
    'Qtiler2qwc.hiw.security.2': 'Adminhandlingar (installera/avinstallera, branding, configs) kräver en autentiserad adminanvändare.',
    'Qtiler2qwc.hiw.security.3': 'Öppen källkod under MPL-2.0; granskbart i plugins/Qtiler2qwc/.'
  }
};
QTWC_I18N.no = { ...QTWC_I18N.sv };

/* ── DOM refs ── */
// CRITICAL FIX: Moved tabMapsBadge to the top so syncUI doesn't crash on load!
const tabMapsBadge = document.getElementById('tabMapsBadge');

const repoEl = document.getElementById('repo');
const versionEl = document.getElementById('version');
const refreshReleasesBtn = document.getElementById('refreshReleasesBtn');
const includePrereleaseEl = document.getElementById('includePrerelease');
const installBadge = document.getElementById('installBadge');
const installInfo = document.getElementById('installInfo');
const installBtn = document.getElementById('installBtn');
const uninstallBtn = document.getElementById('uninstallBtn');
const openWebmapBtn = document.getElementById('openWebmapBtn');
const logoSection = document.getElementById('logoSection');
const logoBadge = document.getElementById('logoBadge');
const logoFileInput = document.getElementById('logoFileInput');
const uploadLogoBtn = document.getElementById('uploadLogoBtn');
const removeLogoBtn = document.getElementById('removeLogoBtn');
const logoPreview = document.getElementById('logoPreview');
const publishSection = document.getElementById('publishSection');
const profilesBadge = document.getElementById('profilesBadge');
const openPublishModalBtn = document.getElementById('openPublishModalBtn');
const publishedProfilesList = document.getElementById('publishedProfilesList');
const catalogLink = document.getElementById('catalogLink');
const publishModal = document.getElementById('publishModal');
const modalTitle = document.getElementById('modalTitle');
const closePublishModalTop = document.getElementById('closePublishModalTop');
const closePublishModalBottom = document.getElementById('closePublishModalBottom');
const publishNowBtn = document.getElementById('publishNowBtn');
const removeDemoBtn = document.getElementById('removeDemoBtn');
const publishName = document.getElementById('publishName');
const publishDescription = document.getElementById('publishDescription');
const publishNameError = document.getElementById('publishNameError');
const publishProjectSelect = document.getElementById('publishProjectSelect');
const backgroundProjectSelect = document.getElementById('backgroundProjectSelect');
const projectLayersList = document.getElementById('projectLayersList');
const backgroundLayersList = document.getElementById('backgroundLayersList');
const defaultBackgroundList = document.getElementById('defaultBackgroundList');
const featureSearch = document.getElementById('featureSearch');
const featureSearchGlobal = document.getElementById('featureSearchGlobal');
const featureView3D = document.getElementById('featureView3D');
const featureEditing = document.getElementById('featureEditing');
const featureIdentify = document.getElementById('featureIdentify');
const featureLayerTree = document.getElementById('featureLayerTree');
const featureLegend = document.getElementById('featureLegend');
const featureMeasurement = document.getElementById('featureMeasurement');
const featurePrint = document.getElementById('featurePrint');
const featureMapTip = document.getElementById('featureMapTip');
const featureShare = document.getElementById('featureShare');
const featureRedlining = document.getElementById('featureRedlining');
const featureBookmark = document.getElementById('featureBookmark');
const featureHeightProfile = document.getElementById('featureHeightProfile');
const featureDxfExport = document.getElementById('featureDxfExport');
const featureAttributeTable = document.getElementById('featureAttributeTable');
const featureRouting = document.getElementById('featureRouting');

/* ── Tool config DOM refs ── */
const cfgShareUrl = document.getElementById('cfgShareUrl');
const cfgRoutingUrl = document.getElementById('cfgRoutingUrl');
const cfgElevationUrl = document.getElementById('cfgElevationUrl');
const cfgDxfUrl = document.getElementById('cfgDxfUrl');

/* Map of configurable tools: checkbox id → config panel + input */
const TOOL_CONFIG_MAP = {
  featureShare: { panel: document.querySelector('[data-config-for="featureShare"]'), input: cfgShareUrl, key: 'shareServiceUrl' },
  featureRouting: { panel: document.querySelector('[data-config-for="featureRouting"]'), input: cfgRoutingUrl, key: 'routingServiceUrl' },
  featureHeightProfile: { panel: document.querySelector('[data-config-for="featureHeightProfile"]'), input: cfgElevationUrl, key: 'elevationServiceUrl' },
  featureDxfExport: { panel: document.querySelector('[data-config-for="featureDxfExport"]'), input: cfgDxfUrl, key: 'dxfExportServiceUrl' }
};

/* ── i18n helpers ── */
function getLang() {
  let raw = '';
  if (window.qtilerLang && typeof window.qtilerLang.get === 'function') raw = window.qtilerLang.get();
  if (!raw) { try { raw = localStorage.getItem('qtiler.lang') || ''; } catch (_) {} }
  if (!raw) raw = (navigator.language || 'en');
  raw = String(raw).toLowerCase();
  if (raw.startsWith('nb') || raw.startsWith('nn') || raw.startsWith('no')) return 'sv';
  return raw.split('-')[0];
}

function t(key, params) {
  const lang = getLang();
  const dict = QTWC_I18N[lang] || QTWC_I18N.en || {};
  let text = dict[key] || (QTWC_I18N.en || {})[key] || key;
  if (params && typeof params === 'object') {
    Object.keys(params).forEach((k) => { text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), String(params[k])); });
  }
  return text;
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

if (window.qtilerLang && typeof window.qtilerLang.subscribe === 'function') {
  window.qtilerLang.subscribe(() => { applyI18n(); syncUI(); });
}

/* ── Utilities ── */
function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function syncToolCardClasses() {
  document.querySelectorAll('.Qtiler2qwc-tool-card input[type="checkbox"]').forEach((cb) => {
    const card = cb.closest('.Qtiler2qwc-tool-card');
    if (card) card.classList.toggle('is-checked', cb.checked);
    // Show/hide config panel for configurable tools
    const entry = TOOL_CONFIG_MAP[cb.id];
    if (entry?.panel) {
      entry.panel.classList.toggle('is-visible', cb.checked);
    }
  });
}

// CRITICAL FIX: Robust JSON parsing to avoid crashes on empty 200/204 responses
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
    try { payload = JSON.parse(text); } catch (e) { payload = text; }
  } else {
    payload = text;
  }

  if (!res.ok) {
    const detail = (isJson && (payload?.error || payload?.details)) || payload || res.statusText;
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
  entry.innerHTML = `<span class="log-time">${escapeHtml(time)}</span> ${escapeHtml(msg)}`;
  logContainer.prepend(entry);
  // Keep max 50 entries
  while (logContainer.children.length > 50) logContainer.lastChild.remove();
}

clearLogBtn?.addEventListener('click', () => {
  if (logContainer) logContainer.innerHTML = `<p class="log-empty">${escapeHtml(t('Qtiler2qwc.no_activity'))}</p>`;
});


/* ── Global state ── */
let currentStatus = null;
let publishedItems = [];

const publishState = {
  projects: [],
  mainLayers: [],
  backgroundLayers: [],
  mainRules: {},
  backgroundOptions: [],
  defaultBackgroundKey: 'none',
  editingProfileId: null  // non-null = edit mode
};

function getFixedBackgroundOptions() {
  return [
    { key: 'none', type: 'none', title: t('Qtiler2qwc.no_bg_option'), required: true }
  ];
}

/* ══════════════════════════════════════════
   UI Sync — the heart of the new approach
   ══════════════════════════════════════════ */
function syncUI() {
  const s = currentStatus || {};
  const installed = !!s.installed;
  const running = !!s.standalone?.running;
  const standaloneUrl = s.standalone?.url || '';
  const hasLogo = !!s.branding?.hasLogo;
  const logoUrl = s.branding?.logoUrl || '';

  /* ── Installation card ── */
  if (installBadge) {
    installBadge.textContent = t(installed ? 'Qtiler2qwc.installed' : 'Qtiler2qwc.not_installed');
    installBadge.className = `badge ${installed ? 'badge--ok' : 'badge--warn'}`;
  }
  if (installInfo) {
    if (installed && s.installedAt) {
      installInfo.innerHTML = escapeHtml(t('Qtiler2qwc.installed_at', {
        date: new Date(s.installedAt).toLocaleDateString(),
        repo: s.repo || '—',
        version: s.version || '—'
      }));
      installInfo.className = 'info-box info-box--ok';
    } else if (installed) {
      installInfo.textContent = t('Qtiler2qwc.installed');
      installInfo.className = 'info-box info-box--ok';
    } else {
      installInfo.textContent = t('Qtiler2qwc.not_installed_hint');
      installInfo.className = 'info-box info-box--warn';
    }
  }
  if (!repoEl.value && s.repo) repoEl.value = s.repo;
  if (versionEl && s.version && versionEl.options.length > 0) {
    for (const opt of versionEl.options) {
      if (opt.value === s.version) { opt.selected = true; break; }
    }
  }
  if (installBtn) installBtn.disabled = false;
  if (uninstallBtn) uninstallBtn.disabled = !installed;

  /* ── Server card ── */
  if (openWebmapBtn) {
    if (installed) {
      openWebmapBtn.classList.remove('is-disabled');
      openWebmapBtn.href = '/Qtiler2qwc/webmap/';
    } else {
      openWebmapBtn.classList.add('is-disabled');
      openWebmapBtn.href = '#';
    }
  }

  /* ── Logo card ── */
  if (logoSection) logoSection.classList.toggle('card--disabled', !installed);
  if (logoBadge) {
    logoBadge.textContent = t(hasLogo ? 'Qtiler2qwc.logo_active' : 'Qtiler2qwc.no_logo');
    logoBadge.className = `badge ${hasLogo ? 'badge--ok' : 'badge--muted'}`;
  }
  if (logoPreview) {
    if (hasLogo && logoUrl) {
      logoPreview.src = logoUrl + '?t=' + Date.now();
      logoPreview.style.display = 'block';
    } else {
      logoPreview.removeAttribute('src');
      logoPreview.style.display = 'none';
    }
  }
  if (uploadLogoBtn) uploadLogoBtn.disabled = !installed;
  if (removeLogoBtn) removeLogoBtn.disabled = !installed || !hasLogo;

  /* ── Profiles card ── */
  if (publishSection) publishSection.classList.toggle('card--disabled', !installed);
  if (profilesBadge) profilesBadge.textContent = String(publishedItems.length);
  if (tabMapsBadge) tabMapsBadge.textContent = String(publishedItems.length);
  if (openPublishModalBtn) openPublishModalBtn.disabled = !installed;
  if (catalogLink) {
    if (installed) {
      catalogLink.href = '/Qtiler2qwc/webmap/';
      catalogLink.classList.remove('is-disabled');
    } else {
      catalogLink.href = '#';
      catalogLink.classList.add('is-disabled');
    }
  }

  if (removeDemoBtn) removeDemoBtn.disabled = !installed;

  renderPublishedProfiles(publishedItems);
}

/* ── Published profiles rendering ── */
function renderPublishedProfiles(items) {
  if (!publishedProfilesList) return;
  const rows = Array.isArray(items) ? items : [];
  const installed = !!currentStatus?.installed;

  if (!rows.length) {
    publishedProfilesList.innerHTML = `<p class="help">${escapeHtml(t('Qtiler2qwc.no_profiles'))}</p>`;
    return;
  }

  publishedProfilesList.innerHTML = rows.map((row) => {
    const profileKey = escapeHtml(row.profileKey || row.name || row.projectId || '');
    const mapName = escapeHtml(row.name || row.projectId || '');
    const mapDesc = escapeHtml(row.description || '');
    const generatedAt = row.generatedAt ? new Date(row.generatedAt).toLocaleString() : '';
    
    // Fallback to the published project route (same-origin Qtiler2qwc webmap)
    const fallbackLaunch = `/Qtiler2qwc/webmap/?qtiler_profile=${encodeURIComponent(row.profileKey || row.projectId || '')}#/?t=${encodeURIComponent(row.projectId || '')}`;
    const fallbackOpen = `/plugins/Qtiler2qwc/published/${encodeURIComponent(row.profileKey || row.name || row.projectId || '')}.json`;
    const openUrl = escapeHtml(row.url || fallbackOpen);
    const launchUrl = escapeHtml(row.launchUrl || fallbackLaunch);
    const launchDisabled = installed ? '' : 'is-disabled';
    
    const projectId = escapeHtml(row.projectId || '');
    const layersParam = encodeURIComponent((row.mainLayerNames || []).join(','));
    const thumbUrl = `/plugins/Qtiler2qwc/api/thumbnail/${encodeURIComponent(row.projectId || '')}?LAYERS=${layersParam}`;
    return `
      <article class="published-item">
        <div class="published-item__preview">
          <img src="${escapeHtml(thumbUrl)}" alt="" loading="lazy" />
        </div>
        <div class="published-item__content">
          <div class="published-item__meta">
            <div>
              <strong class="published-item__name">${mapName}</strong>
              ${mapDesc ? `<p class="published-item__desc">${mapDesc}</p>` : ''}
            </div>
            <span>${escapeHtml(generatedAt)}</span>
          </div>
          <div class="actions">
            <button class="button ghost small" data-edit-published="${profileKey}">${escapeHtml(t('Qtiler2qwc.edit_profile'))}</button>
            <a class="button ghost small" href="${openUrl}" target="_blank" rel="noreferrer">${escapeHtml(t('Qtiler2qwc.open_json'))}</a>
            <a class="button ghost small ${launchDisabled}" href="${launchDisabled ? '#' : launchUrl}" target="_blank" rel="noreferrer">${escapeHtml(t('Qtiler2qwc.open_qwc2_link'))}</a>
            <button class="button danger small" data-delete-published="${profileKey}">${escapeHtml(t('Qtiler2qwc.delete'))}</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

/* ── Data loading ── */
let releasesLoaded = false;

async function loadReleases() {
  const repo = String(repoEl?.value || '').trim();
  const pre = includePrereleaseEl?.checked ? '1' : '0';
  const qs = repo ? `?repo=${encodeURIComponent(repo)}&prerelease=${pre}` : `?prerelease=${pre}`;
  try {
    if (versionEl) versionEl.disabled = true;
    const data = await api(`/plugins/Qtiler2qwc/api/releases${qs}`);
    const releases = data?.releases || [];
    const currentVersion = currentStatus?.version || data?.defaultVersion || '';
    if (versionEl) {
      versionEl.innerHTML = '';
      if (releases.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = t('Qtiler2qwc.no_releases_found');
        versionEl.appendChild(opt);
      } else {
        for (const r of releases) {
          const opt = document.createElement('option');
          opt.value = r.tag;
          const sizeMb = r.assetSize ? ` (${(r.assetSize / 1048576).toFixed(1)} MB)` : '';
          const pre = r.prerelease ? ' [pre]' : '';
          opt.textContent = `${r.name}${pre}${sizeMb}`;
          if (r.tag === currentVersion) opt.selected = true;
          versionEl.appendChild(opt);
        }
      }
      versionEl.disabled = false;
    }
    releasesLoaded = true;
  } catch (err) {
    if (versionEl) {
      versionEl.innerHTML = `<option value="">${t('Qtiler2qwc.releases_error')}</option>`;
      versionEl.disabled = false;
    }
  }
}

async function loadStatus() {
  currentStatus = await api('/plugins/Qtiler2qwc/api/status');
  syncUI();
}

async function loadPublishedProfiles() {
  const payload = await api('/plugins/Qtiler2qwc/api/publish/list');
  // CRITICAL FIX: Handles if payload is already an Array directly
  publishedItems = payload?.items || (Array.isArray(payload) ? payload : []);
  syncUI();
}

/* ── Layer helpers ── */
function normalizeLayersPayload(payload) {
  return (Array.isArray(payload?.layers) ? payload.layers : [])
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const name = String(row.name || row.id || '').trim();
      if (!name) return null;
      return { name, geometry: String(row.geometry_type || row.geometry || row.kind || '').trim() };
    })
    .filter(Boolean);
}

function renderLayerChecklist(container, layers, rules = {}) {
  if (!container) return;
  const isMainLayerList = container === projectLayersList;
  if (!Array.isArray(layers) || !layers.length) {
    container.innerHTML = `<p class="help">${escapeHtml(t('Qtiler2qwc.no_layers'))}</p>`;
    return;
  }
  container.innerHTML = layers.map((layer) => {
    const rule = rules[layer.name] || {};
    const tags = [];
    if (rule.searchable) tags.push(t('Qtiler2qwc.searchable'));
    if (rule.editable) tags.push(t('Qtiler2qwc.editable'));
    const tagText = tags.length ? `<span class="Qtiler2qwc-tags">${tags.map((tg) => `<span>${escapeHtml(tg)}</span>`).join('')}</span>` : '';
    const activeHint = isMainLayerList ? `<small class="help">Activa al abrir mapa</small>` : '';
    return `
      <label class="checkbox Qtiler2qwc-layer-item">
        <input type="checkbox" data-layer-name="${escapeHtml(layer.name)}" />
        <span>${escapeHtml(layer.name)}</span>
        ${activeHint}
        ${tagText}
      </label>
    `;
  }).join('');
}

function getCheckedLayerNames(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[type="checkbox"][data-layer-name]:checked'))
    .map((el) => String(el.getAttribute('data-layer-name') || '').trim())
    .filter(Boolean);
}

function setCheckedLayerNames(container, names) {
  if (!container || !Array.isArray(names)) return;
  const set = new Set(names);
  container.querySelectorAll('input[type="checkbox"][data-layer-name]').forEach((el) => {
    el.checked = set.has(el.getAttribute('data-layer-name'));
  });
}

/* ── Background options ── */
function buildBackgroundOptions() {
  const backgroundProjectId = String(backgroundProjectSelect?.value || '').trim();
  const selectedLayerNames = getCheckedLayerNames(backgroundLayersList);
  const dynamicOptions = selectedLayerNames.map((name) => ({
    key: `layer:${backgroundProjectId}:${name}`,
    type: 'layer',
    sourceProjectId: backgroundProjectId,
    name,
    title: backgroundProjectId ? `${backgroundProjectId} / ${name}` : name,
    required: false
  }));
  const options = [...getFixedBackgroundOptions(), ...dynamicOptions];
  if (!options.some((o) => o.key === publishState.defaultBackgroundKey)) {
    const firstWmts = options.find((o) => o.type === 'layer');
    publishState.defaultBackgroundKey = firstWmts ? firstWmts.key : 'none';
  }
  publishState.backgroundOptions = options;
}

function renderDefaultBackgroundOptions() {
  if (!defaultBackgroundList) return;
  if (!publishState.backgroundOptions?.length) {
    defaultBackgroundList.innerHTML = `<p class="help">${escapeHtml(t('Qtiler2qwc.no_bg_available'))}</p>`;
    return;
  }
  defaultBackgroundList.innerHTML = publishState.backgroundOptions.map((item) => {
    const checked = item.key === publishState.defaultBackgroundKey ? 'checked' : '';
    const defaultTag = checked ? `<span class="Qtiler2qwc-bg-item__default-tag">${escapeHtml(t('Qtiler2qwc.default'))}</span>` : '';
    let thumbHtml = '';
    if (item.type === 'layer' && item.sourceProjectId && item.name) {
      const thumbUrl = `/plugins/Qtiler2qwc/api/thumbnail/${encodeURIComponent(item.sourceProjectId)}?LAYERS=${encodeURIComponent(item.name)}`;
      thumbHtml = `<img class="Qtiler2qwc-bg-item__thumb" src="${escapeHtml(thumbUrl)}" alt="" loading="lazy" />`;
    } else {
      thumbHtml = `<span class="Qtiler2qwc-bg-item__thumb Qtiler2qwc-bg-item__thumb--placeholder"></span>`;
    }
    return `
      <label class="Qtiler2qwc-bg-item">
        <input type="radio" name="Qtiler2qwcDefaultBackground" data-default-bg-key="${escapeHtml(item.key)}" ${checked} />
        ${thumbHtml}
        <span class="Qtiler2qwc-bg-item__name">${escapeHtml(item.title)}</span>
        ${defaultTag}
      </label>
    `;
  }).join('');
}

function refreshBackgroundOptions() {
  buildBackgroundOptions();
  renderDefaultBackgroundOptions();
}

/* ── Layer loading ── */
async function loadLayerRules(projectId) {
  const [config, searchable] = await Promise.all([
    api(`/projects/${encodeURIComponent(projectId)}/config`).catch(() => ({})),
    api(`/projects/${encodeURIComponent(projectId)}/searchable`).catch(() => ([]))
  ]);
  const searchableRows = Array.isArray(searchable) ? searchable : [];
  const searchableMap = {};
  searchableRows.forEach((entry) => {
    const name = String(entry?.name || '').trim();
    if (!name) return;
    searchableMap[name] = {
      searchable: entry.searchable !== false,
      searchAttribute: String(entry.searchAttribute || entry.titleField || '').trim() || null,
      idAttribute: String(entry.idAttribute || '').trim() || null,
      geometryAttribute: String(entry.geometryAttribute || '').trim() || null,
      hintText: String(entry.hintText || '').trim() || null
    };
  });
  const layerConfigMap = config?.layers && typeof config.layers === 'object' ? config.layers : {};
  const rules = {};
  Object.keys(layerConfigMap).forEach((name) => {
    const cfg = layerConfigMap[name] && typeof layerConfigMap[name] === 'object' ? layerConfigMap[name] : {};
    const searchCfg = searchableMap[name] || {};
    rules[name] = {
      searchable: searchCfg.searchable === true || cfg.wfsSearchable === true,
      editable: cfg.wfsEditable === true,
      searchAttribute: searchCfg.searchAttribute || null,
      idAttribute: searchCfg.idAttribute || null,
      geometryAttribute: searchCfg.geometryAttribute || null,
      hintText: searchCfg.hintText || null
    };
  });
  Object.keys(searchableMap).forEach((name) => {
    if (rules[name]) return;
    rules[name] = {
      searchable: searchableMap[name].searchable === true,
      editable: false,
      searchAttribute: searchableMap[name].searchAttribute,
      idAttribute: searchableMap[name].idAttribute,
      geometryAttribute: searchableMap[name].geometryAttribute,
      hintText: searchableMap[name].hintText
    };
  });
  return rules;
}

async function loadProjectLayers(projectId, target = 'main') {
  const payload = await api(`/projects/${encodeURIComponent(projectId)}/layers`);
  const normalized = normalizeLayersPayload(payload);
  if (target === 'main') {
    publishState.mainLayers = normalized;
    publishState.mainRules = await loadLayerRules(projectId);
    renderLayerChecklist(projectLayersList, publishState.mainLayers, publishState.mainRules);
    projectLayersList.querySelectorAll('input[type="checkbox"]').forEach((el) => { el.checked = true; });
    return;
  }
  publishState.backgroundLayers = normalized;
  renderLayerChecklist(backgroundLayersList, publishState.backgroundLayers, {});
  refreshBackgroundOptions();
}

async function loadProjectsForPublish() {
  let payload = null;
  try {
    payload = await api('/plugins/Qtiler2qwc/api/projects');
  } catch (_) {
    payload = await api('/projects');
  }
  const list = Array.isArray(payload?.projects) ? payload.projects : [];
  publishState.projects = list.map((p) => ({ id: String(p.id || '').trim(), name: String(p.name || p.id || '').trim() })).filter((p) => p.id);
  const options = publishState.projects.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}</option>`).join('');
  if (publishProjectSelect) {
    publishProjectSelect.innerHTML = options || `<option value="">${escapeHtml(t('Qtiler2qwc.no_project_selected'))}</option>`;
  }
  if (backgroundProjectSelect) {
    backgroundProjectSelect.innerHTML = `<option value="">${escapeHtml(t('Qtiler2qwc.no_bg_option'))}</option>${options}`;
  }
}

/* ── Publish modal ── */
function openPublishModal() {
  if (publishModal) publishModal.classList.add('is-active');
}
function closePublishModal() {
  if (publishModal) publishModal.classList.remove('is-active');
  publishState.editingProfileId = null;
}

async function preparePublishModal(editProfileId = null) {
  publishState.editingProfileId = editProfileId;
  await loadProjectsForPublish();

  if (editProfileId) {
    // Edit mode: load existing profile and prefill
    if (modalTitle) modalTitle.textContent = t('Qtiler2qwc.modal_title_edit', { id: editProfileId });
    let profile;
    try {
      profile = await api(`/plugins/Qtiler2qwc/published/${encodeURIComponent(editProfileId)}.json`);
    } catch { profile = null; }

    if (profile) {
      // Name & description — store the actual name as editingProfileId for backend
      publishState.editingProfileId = profile.name || editProfileId;
      if (publishName) { publishName.value = profile.name || editProfileId; publishName.disabled = true; }
      if (publishDescription) publishDescription.value = profile.description || '';
      if (publishNameError) publishNameError.style.display = 'none';
      // Select main project
      if (publishProjectSelect) publishProjectSelect.value = profile.projectId || '';
      const mainProjectId = String(publishProjectSelect.value || '').trim();
      if (mainProjectId) await loadProjectLayers(mainProjectId, 'main');

      const savedLayers = Array.isArray(profile.layers) ? profile.layers : [];
      const savedMain = savedLayers.filter((l) => !l?.role || l.role === 'main');
      // Respect saved visibility flag (default true)
      const visibleSet = new Set(savedMain.filter((l) => (typeof l.visible === 'undefined' ? true : !!l.visible)).map((l) => String(l.name || '').trim()));
      setCheckedLayerNames(projectLayersList, Array.from(visibleSet));

      // Background project
      const savedBackgrounds = Array.isArray(profile.backgrounds) ? profile.backgrounds : [];
      const savedLayerBackgrounds = savedBackgrounds.filter((bg) => bg?.type === 'layer' && bg.name);
      const savedBgNames = Array.from(new Set([
        ...(Array.isArray(profile.backgroundLayerNames) ? profile.backgroundLayerNames : []),
        ...savedLayerBackgrounds.map((bg) => bg.name),
        ...savedLayers.filter((l) => l?.role === 'background').map((l) => l.name)
      ].map((name) => String(name || '').trim()).filter(Boolean)));
      const bgProjectId = profile.backgroundProjectId || savedLayerBackgrounds[0]?.sourceProjectId || savedLayers.find((l) => l?.role === 'background')?.sourceProjectId || '';
      if (backgroundProjectSelect) backgroundProjectSelect.value = bgProjectId;
      if (bgProjectId) {
        await loadProjectLayers(bgProjectId, 'background');
        setCheckedLayerNames(backgroundLayersList, savedBgNames);
      } else {
        publishState.backgroundLayers = [];
        backgroundLayersList.innerHTML = `<p class="help">${escapeHtml(t('Qtiler2qwc.optional_select'))}</p>`;
      }

      // Default background
      const savedDefaultBg = savedBackgrounds.find((bg) => bg?.isDefault === true);
      publishState.defaultBackgroundKey = profile.defaultBackgroundKey || savedDefaultBg?.key || 'none';
      refreshBackgroundOptions();

      // Features
      const features = profile.features || {};
      if (featureSearch) featureSearch.checked = features.search !== false;
      if (featureSearchGlobal) featureSearchGlobal.checked = features.searchGlobal === true;
      if (featureView3D) featureView3D.checked = features.view3d !== false;
      if (featureEditing) featureEditing.checked = features.editing !== false;
      if (featureIdentify) featureIdentify.checked = features.identify !== false;
      if (featureLayerTree) featureLayerTree.checked = features.layerTree !== false;
      if (featureLegend) featureLegend.checked = features.legend !== false;
      if (featureMeasurement) featureMeasurement.checked = !!features.measurement;
      if (featurePrint) featurePrint.checked = features.print !== false;
      if (featureMapTip) featureMapTip.checked = features.mapTip !== false;
      if (featureShare) featureShare.checked = !!features.share;
      if (featureRedlining) featureRedlining.checked = !!features.redlining;
      if (featureBookmark) featureBookmark.checked = !!features.bookmark;
      if (featureHeightProfile) featureHeightProfile.checked = !!features.heightProfile;
      if (featureDxfExport) featureDxfExport.checked = !!features.dxfExport;
      if (featureAttributeTable) featureAttributeTable.checked = !!features.attributeTable;
      if (featureRouting) featureRouting.checked = !!features.routing;

      // Tool config
      const tc = profile.toolConfig || {};
      if (cfgShareUrl) cfgShareUrl.value = tc.shareServiceUrl || '';
      if (cfgRoutingUrl) cfgRoutingUrl.value = tc.routingServiceUrl || '';
      if (cfgElevationUrl) cfgElevationUrl.value = tc.elevationServiceUrl || '';
      if (cfgDxfUrl) cfgDxfUrl.value = tc.dxfExportServiceUrl || '';
    }
  } else {
    // New mode
    if (modalTitle) modalTitle.textContent = t('Qtiler2qwc.modal_title');
    if (publishName) { publishName.value = ''; publishName.disabled = false; }
    if (publishDescription) publishDescription.value = '';
    if (publishNameError) publishNameError.style.display = 'none';
    publishState.defaultBackgroundKey = 'none';
    const mainProjectId = String(publishProjectSelect.value || '').trim();
    if (mainProjectId) await loadProjectLayers(mainProjectId, 'main');
    backgroundLayersList.innerHTML = `<p class="help">${escapeHtml(t('Qtiler2qwc.optional_select'))}</p>`;
    refreshBackgroundOptions();
    // Reset features to defaults
    if (featureSearch) featureSearch.checked = true;
    if (featureSearchGlobal) featureSearchGlobal.checked = false;
    if (featureView3D) featureView3D.checked = true;
    if (featureEditing) featureEditing.checked = true;
    if (featureIdentify) featureIdentify.checked = true;
    if (featureLayerTree) featureLayerTree.checked = true;
    if (featureLegend) featureLegend.checked = true;
    if (featureMeasurement) featureMeasurement.checked = false;
    if (featurePrint) featurePrint.checked = true;
    if (featureMapTip) featureMapTip.checked = true;
    if (featureShare) featureShare.checked = false;
    if (featureRedlining) featureRedlining.checked = false;
    if (featureBookmark) featureBookmark.checked = false;
    if (featureHeightProfile) featureHeightProfile.checked = false;
    if (featureDxfExport) featureDxfExport.checked = false;
    if (featureAttributeTable) featureAttributeTable.checked = false;
    if (featureRouting) featureRouting.checked = false;
    // Reset tool config
    if (cfgShareUrl) cfgShareUrl.value = '';
    if (cfgRoutingUrl) cfgRoutingUrl.value = '';
    if (cfgElevationUrl) cfgElevationUrl.value = '';
    if (cfgDxfUrl) cfgDxfUrl.value = '';
  }

  // Sync tool card visual classes
  syncToolCardClasses();
  openPublishModal();
}

/* ══════════════════════════════════════════
   Tab switching
   ══════════════════════════════════════════ */

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

/* ══════════════════════════════════════════
   Event handlers
   ══════════════════════════════════════════ */

refreshReleasesBtn?.addEventListener('click', () => loadReleases());
includePrereleaseEl?.addEventListener('change', () => loadReleases());

installBtn?.addEventListener('click', async () => {
  installBtn.disabled = true;
  try {
    await api('/plugins/Qtiler2qwc/api/install', {
      method: 'POST',
      body: { repo: String(repoEl.value || '').trim(), version: String(versionEl.value || '').trim() }
    });
    addLog(t('Qtiler2qwc.log_installed'), 'ok');
    await loadStatus();
    await loadPublishedProfiles();
  } catch (err) {
    addLog(t('Qtiler2qwc.log_error', { msg: err.message }), 'error');
  } finally {
    installBtn.disabled = false;
  }
});

uninstallBtn?.addEventListener('click', async () => {
  uninstallBtn.disabled = true;
  try {
    await api('/plugins/Qtiler2qwc/api/install', { method: 'DELETE' });
    addLog(t('Qtiler2qwc.log_uninstalled'), 'ok');
    await loadStatus();
  } catch (err) {
    addLog(t('Qtiler2qwc.log_error', { msg: err.message }), 'error');
  } finally {
    syncUI();
  }
});

uploadLogoBtn?.addEventListener('click', async () => {
  const file = logoFileInput?.files?.[0];
  if (!file) { addLog(t('Qtiler2qwc.logo_select_file'), 'error'); return; }
  uploadLogoBtn.disabled = true;
  try {
    const body = new FormData();
    body.append('logo', file, file.name || 'logo');
    await api('/plugins/Qtiler2qwc/api/branding/logo', { method: 'POST', body });
    if (logoFileInput) logoFileInput.value = '';
    addLog(t('Qtiler2qwc.log_logo_uploaded'), 'ok');
    await loadStatus();
  } catch (err) {
    addLog(t('Qtiler2qwc.log_error', { msg: err.message }), 'error');
  } finally {
    syncUI();
  }
});

removeLogoBtn?.addEventListener('click', async () => {
  removeLogoBtn.disabled = true;
  try {
    await api('/plugins/Qtiler2qwc/api/branding/logo', { method: 'DELETE' });
    if (logoFileInput) logoFileInput.value = '';
    addLog(t('Qtiler2qwc.log_logo_removed'), 'ok');
    await loadStatus();
  } catch (err) {
    addLog(t('Qtiler2qwc.log_error', { msg: err.message }), 'error');
  } finally {
    syncUI();
  }
});

openPublishModalBtn?.addEventListener('click', async () => {
  openPublishModalBtn.disabled = true;
  try {
    await preparePublishModal(null);
  } catch (err) {
    addLog(t('Qtiler2qwc.log_error', { msg: err.message }), 'error');
  } finally {
    openPublishModalBtn.disabled = false;
  }
});

publishProjectSelect?.addEventListener('change', async () => {
  const projectId = String(publishProjectSelect.value || '').trim();
  if (!projectId) {
    projectLayersList.innerHTML = `<p class="help">${escapeHtml(t('Qtiler2qwc.no_project_selected'))}</p>`;
    return;
  }
  try { await loadProjectLayers(projectId, 'main'); } catch (err) { addLog(t('Qtiler2qwc.log_error', { msg: err.message }), 'error'); }
});

backgroundProjectSelect?.addEventListener('change', async () => {
  const projectId = String(backgroundProjectSelect.value || '').trim();
  if (!projectId) {
    backgroundLayersList.innerHTML = `<p class="help">${escapeHtml(t('Qtiler2qwc.no_bg_selected'))}</p>`;
    refreshBackgroundOptions();
    return;
  }
  try { await loadProjectLayers(projectId, 'background'); } catch (err) { addLog(t('Qtiler2qwc.log_error', { msg: err.message }), 'error'); }
});

backgroundLayersList?.addEventListener('change', () => { refreshBackgroundOptions(); });

defaultBackgroundList?.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== 'radio') return;
  const key = String(target.getAttribute('data-default-bg-key') || '').trim();
  if (key) {
    publishState.defaultBackgroundKey = key;
    // Update "Default" tags in-place
    defaultBackgroundList.querySelectorAll('.Qtiler2qwc-bg-item').forEach((row) => {
      const radio = row.querySelector('input[type="radio"]');
      const existing = row.querySelector('.Qtiler2qwc-bg-item__default-tag');
      if (radio?.checked && !existing) {
        const tag = document.createElement('span');
        tag.className = 'Qtiler2qwc-bg-item__default-tag';
        tag.textContent = t('Qtiler2qwc.default');
        row.appendChild(tag);
      } else if (!radio?.checked && existing) {
        existing.remove();
      }
    });
  }
});

publishNowBtn?.addEventListener('click', async () => {
  const mapName = String(publishName?.value || '').trim();
  const mapDescription = String(publishDescription?.value || '').trim();
  if (!mapName) {
    if (publishNameError) { publishNameError.textContent = t('Qtiler2qwc.name_required'); publishNameError.style.display = ''; }
    publishName?.focus();
    return;
  }
  if (publishNameError) publishNameError.style.display = 'none';

  // Check unique name (only for new profiles, not edits)
  if (!publishState.editingProfileId) {
    const duplicate = publishedItems.some((item) => (item.name || item.projectId || '').toLowerCase() === mapName.toLowerCase());
    if (duplicate) {
      if (publishNameError) { publishNameError.textContent = t('Qtiler2qwc.name_duplicate'); publishNameError.style.display = ''; }
      publishName?.focus();
      return;
    }
  }

  const projectId = String(publishProjectSelect.value || '').trim();
  if (!projectId) { addLog(t('Qtiler2qwc.log_error', { msg: 'project required' }), 'error'); return; }
  const layerNames = getCheckedLayerNames(projectLayersList);
  const allLayerNames = Array.isArray(publishState.mainLayers) ? publishState.mainLayers.map((l) => l.name) : [];
  if (!allLayerNames.length) { addLog(t('Qtiler2qwc.log_error', { msg: 'no project layers available' }), 'error'); return; }

  // Checkboxes represent "active on map start"; all layers are still published.
  const checkedSet = new Set(layerNames);
  const layersPayload = allLayerNames.map((name) => ({ name, visible: checkedSet.has(name) }));

  const backgroundProjectId = String(backgroundProjectSelect.value || '').trim();
  const backgroundLayerNames = getCheckedLayerNames(backgroundLayersList);
  refreshBackgroundOptions();
  const backgrounds = (publishState.backgroundOptions || []).map((item) => ({
    key: item.key, type: item.type, title: item.title,
    sourceProjectId: item.type === 'layer' ? item.sourceProjectId : null,
    name: item.type === 'layer' ? item.name : null,
    isDefault: item.key === publishState.defaultBackgroundKey
  }));
  const layerRules = {};
  allLayerNames.forEach((name) => { layerRules[name] = publishState.mainRules[name] || { searchable: false, editable: false }; });

  publishNowBtn.disabled = true;
  try {
      await api('/plugins/Qtiler2qwc/api/publish', {
      method: 'POST',
      body: {
        name: mapName,
        description: mapDescription,
        editingProfileId: publishState.editingProfileId || null,
        projectId,
        layers: layersPayload,
        backgroundProjectId: backgroundProjectId || null,
        backgroundLayerNames, backgrounds,
        defaultBackgroundKey: publishState.defaultBackgroundKey || 'none',
        layerRules,
        features: {
          search: !!featureSearch.checked, searchGlobal: !!featureSearchGlobal?.checked, view3d: !!featureView3D?.checked, editing: !!featureEditing.checked,
          identify: !!featureIdentify.checked, layerTree: !!featureLayerTree.checked,
          legend: !!featureLegend.checked, measurement: !!featureMeasurement.checked,
          print: !!featurePrint.checked, mapTip: !!featureMapTip.checked,
          share: !!featureShare.checked, redlining: !!featureRedlining.checked,
          bookmark: !!featureBookmark.checked, heightProfile: !!featureHeightProfile.checked,
          dxfExport: !!featureDxfExport.checked, attributeTable: !!featureAttributeTable.checked,
          routing: !!featureRouting.checked
        },
        toolConfig: {
          shareServiceUrl: String(cfgShareUrl?.value || '').trim(),
          routingServiceUrl: String(cfgRoutingUrl?.value || '').trim(),
          elevationServiceUrl: String(cfgElevationUrl?.value || '').trim(),
          dxfExportServiceUrl: String(cfgDxfUrl?.value || '').trim()
        }
      }
    });
    addLog(t('Qtiler2qwc.log_published', { id: mapName }), 'ok');
    closePublishModal();
    await loadStatus();
    await loadPublishedProfiles();
  } catch (err) {
    if (err.message && err.message.includes('409')) {
      if (publishNameError) { publishNameError.textContent = t('Qtiler2qwc.name_duplicate'); publishNameError.style.display = ''; }
      publishName?.focus();
    } else {
      addLog(t('Qtiler2qwc.log_error', { msg: err.message }), 'error');
    }
  } finally {
    publishNowBtn.disabled = false;
  }
});

removeDemoBtn?.addEventListener('click', async () => {
  if (!window.confirm('Remove bundled demo theme from installed QWC2?')) return;
  removeDemoBtn.disabled = true;
  try {
    const r = await api('/plugins/Qtiler2qwc/api/remove-demo', { method: 'POST' });
    addLog(`Removed demo entries: ${r?.removed || 0}`, 'ok');
    await loadStatus();
    await loadPublishedProfiles();
  } catch (err) {
    addLog(t('Qtiler2qwc.log_error', { msg: err.message }), 'error');
  } finally {
    removeDemoBtn.disabled = false;
  }
});

/* ── Edit / delete published ── */
publishedProfilesList?.addEventListener('click', async (event) => {
  const editBtn = event.target.closest('button[data-edit-published]');
  if (editBtn) {
    const projectId = String(editBtn.getAttribute('data-edit-published') || '').trim();
    if (!projectId) return;
    try { await preparePublishModal(projectId); } catch (err) { addLog(t('Qtiler2qwc.log_error', { msg: err.message }), 'error'); }
    return;
  }

  const deleteBtn = event.target.closest('button[data-delete-published]');
  if (deleteBtn) {
    const profileName = String(deleteBtn.getAttribute('data-delete-published') || '').trim();
    if (!profileName) return;
    if (!window.confirm(t('Qtiler2qwc.confirm_delete', { id: profileName }))) return;
    deleteBtn.disabled = true;
    try {
      await api(`/plugins/Qtiler2qwc/api/publish/${encodeURIComponent(profileName)}`, { method: 'DELETE' });
      addLog(t('Qtiler2qwc.log_deleted', { id: profileName }), 'ok');
      await loadPublishedProfiles();
    } catch (err) {
      addLog(t('Qtiler2qwc.log_error', { msg: err.message }), 'error');
    }
  }
});

publishModal?.querySelector('.modal-background')?.addEventListener('click', closePublishModal);
closePublishModalTop?.addEventListener('click', closePublishModal);
closePublishModalBottom?.addEventListener('click', closePublishModal);

/* ── Tool card visual toggle (JS fallback for :has() support) ── */
document.querySelectorAll('.Qtiler2qwc-tool-card input[type="checkbox"]').forEach((cb) => {
  const card = cb.closest('.Qtiler2qwc-tool-card');
  if (!card) return;
  const sync = () => {
    card.classList.toggle('is-checked', cb.checked);
    const entry = TOOL_CONFIG_MAP[cb.id];
    if (entry?.panel) entry.panel.classList.toggle('is-visible', cb.checked);
  };
  cb.addEventListener('change', sync);
  sync();
});

/* ── Init ── */
applyI18n();

Promise.all([
  loadStatus().catch((err) => addLog(t('Qtiler2qwc.log_error', { msg: err.message }), 'error')),
  loadPublishedProfiles().catch(() => {}),
  loadReleases().catch(() => {})
]);
/* === How it works modal wiring === */
(function () {
  const modal = document.getElementById('qtwc-hiw-modal');
  const openBtn = document.getElementById('qtwc-open-hiw');
  if (!modal || !openBtn) return;
  const open = () => { modal.hidden = false; modal.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden'; };
  const close = () => { modal.hidden = true; modal.setAttribute('aria-hidden','true'); document.body.style.overflow=''; };
  openBtn.addEventListener('click', open);
  modal.querySelectorAll('[data-hiw-close]').forEach((el) => el.addEventListener('click', close));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) close(); });
})();

