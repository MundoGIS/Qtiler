/* ── i18n dictionary (en / es / sv / no) ── */
/* Lock body scroll while any .modal.is-active exists, so modals don't appear
   to drift when the user scrolls the underlying page. */
(function setupModalScrollLock() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const sync = () => {
    const modalOpen = !!document.querySelector('.modal.is-active');
    const publishOpen = !!document.querySelector('.publish-editor:not([hidden])');
    document.body.classList.toggle('modal-open', modalOpen || publishOpen);
    document.body.classList.toggle('publish-editor-open', publishOpen);
  };
  const obs = new MutationObserver(sync);
  document.addEventListener('DOMContentLoaded', () => {
    obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class', 'hidden'] });
    sync();
  });
})();

const QTWC_I18N = {
  en: {
    'Qtiler2Origo.title': 'Origo Bridge for Qtiler',
    'Qtiler2Origo.subtitle': 'Install Origo from GitHub and sync project visibility from QtilerAuth.',
    'Qtiler2Origo.how_title': 'How Qtiler2Origo works',
    'Qtiler2Origo.how_intro': 'Qtiler2Origo is a bridge plugin: it embeds the Origo web map viewer inside Qtiler so you can publish background-tagged QGIS projects as Origo maps without leaving the admin console.',
    'Qtiler2Origo.how_step_install': 'Install Origo — pick a release tag from the official GitHub repository. Qtiler downloads the build and serves it from /plugins/Qtiler2Origo/Origo.',
    'Qtiler2Origo.how_step_publish': 'Publish a map — open the Maps tab, choose a project tagged as background (managed by QtilerAuth), set CRS, zoom and centre, then save. Qtiler generates the Origo configuration file automatically.',
    'Qtiler2Origo.how_step_share': 'Share the URL — published maps are reachable at /plugins/Qtiler2Origo/Origo/?map=<name>. Visibility is enforced through QtilerAuth, so users only see projects they have access to.',
    'Qtiler2Origo.how_step_brand': 'Brand and customise — upload a logo, pick a base map and the controls you want enabled (search, measure, draw, print…). Edits hot-reload without restarting Qtiler.',
    'Qtiler2Origo.how_outro': 'Open source under MPL-2.0. The plugin only talks to GitHub during install and to QtilerAuth for project ACLs; no data leaves your server at runtime.',
    'Qtiler2Origo.installation': 'Installation',
    'Qtiler2Origo.github_repo': 'GitHub repo',
    'Qtiler2Origo.version_tag': 'Version',
    'Qtiler2Origo.refresh': '↻',
    'Qtiler2Origo.include_prerelease': 'Include pre-releases',
    'Qtiler2Origo.no_releases_found': '(no releases found)',
    'Qtiler2Origo.releases_error': '(error fetching releases)',
    'Qtiler2Origo.install_Origo': 'Install Origo',
    'Qtiler2Origo.uninstall_Origo': 'Uninstall Origo',
    'Qtiler2Origo.checking': 'Checking…',
    'Qtiler2Origo.installed': 'Installed',
    'Qtiler2Origo.not_installed': 'Not installed',
    'Qtiler2Origo.installed_at': 'Installed on {date} · repo {repo} · version {version}',
    'Qtiler2Origo.not_installed_hint': 'Origo is not installed. Enter the GitHub repo and version above, then click Install.',
    'Qtiler2Origo.standalone_server': 'Origo standalone server',
    'Qtiler2Origo.Origo_port': 'Origo port',
    'Qtiler2Origo.start_server': 'Start server',
    'Qtiler2Origo.stop_server': 'Stop server',
    'Qtiler2Origo.open_Origo': 'Open Origo',
    'Qtiler2Origo.webmap_link': 'Open webmap',
    'Qtiler2Origo.running': 'Running',
    'Qtiler2Origo.stopped': 'Stopped',
    'Qtiler2Origo.server_running_at': 'Server running on port {port}',
    'Qtiler2Origo.server_stopped_hint': 'Server is not running. Set a port and click Start.',
    'Qtiler2Origo.logo_section': 'Webmap logo',
    'Qtiler2Origo.logo_desc': 'Upload a logo for the Origo TopBar. Allowed formats: PNG, JPG, SVG, WEBP.',
    'Qtiler2Origo.logo_file': 'Logo file',
    'Qtiler2Origo.upload_logo': 'Upload logo',
    'Qtiler2Origo.remove_logo': 'Remove logo',
    'Qtiler2Origo.no_logo': 'No logo',
    'Qtiler2Origo.logo_active': 'Active',
    'Qtiler2Origo.logo_updated_at': 'Logo updated: {date}',
    'Qtiler2Origo.logo_select_file': 'Select a file first.',
    'Qtiler2Origo.profiles_section': 'Published maps',
    'Qtiler2Origo.profiles_desc': 'Manage generated profiles and launch links for Origo (webmap).',
    'Qtiler2Origo.publish_new': 'New map',
    'Qtiler2Origo.no_profiles': 'No published profiles yet. Click "New profile" to create one.',
    'Qtiler2Origo.open_json': 'JSON',
    'Qtiler2Origo.open_Origo_link': 'Open map',
    'Qtiler2Origo.edit_profile': 'Edit map',
    'Qtiler2Origo.duplicate': 'Duplicate',
    'Qtiler2Origo.duplicate_title': 'Duplicate webmap',
    'Qtiler2Origo.duplicate_help': 'Enter a unique name for the new webmap. The original will be kept unchanged.',
    'Qtiler2Origo.duplicate_new_name': 'New webmap name',
    'Qtiler2Origo.duplicate_btn': 'Duplicate',
    'Qtiler2Origo.duplicate_done': 'Webmap duplicated as "{id}".',
    'Qtiler2Origo.delete': 'Delete',
    'Qtiler2Origo.confirm_delete': 'Delete published profile for {id}?',
    'Qtiler2Origo.open_viewer': 'Published maps gallery',
    'Qtiler2Origo.activity_log': 'Activity log',
    'Qtiler2Origo.clear': 'Clear',
    'Qtiler2Origo.no_activity': 'No activity yet.',
    'Qtiler2Origo.modal_title': 'Publish project in Origo',
    'Qtiler2Origo.modal_title_edit': 'Edit profile: {id}',
    'Qtiler2Origo.main_project': 'Main project',
    'Qtiler2Origo.project_layers': 'Project layers',
    'Qtiler2Origo.layer_include': 'Include',
    'Qtiler2Origo.layer_initial_visibility': 'Visible on map start',
    'Qtiler2Origo.layer_include_help': 'If enabled, this layer is included in the published map.',
    'Qtiler2Origo.layer_initial_visibility_help': 'If enabled, this included layer is visible when the map opens.',
    'Qtiler2Origo.bg_project': 'Background project (optional)',
    'Qtiler2Origo.bg_layers': 'Background layers',
    'Qtiler2Origo.default_bg': 'Default background',
    'Qtiler2Origo.default_bg_help': 'OSM and No background are always available. Choose one as default.',
    'Qtiler2Origo.Origo_features': 'Origo modules',
    'Qtiler2Origo.feat_search': 'Search',
    'Qtiler2Origo.feat_search_global': 'Global Search',
    'Qtiler2Origo.feat_editing': 'Editing',
    'Qtiler2Origo.feat_identify': 'Identify',
    'Qtiler2Origo.feat_layer_tree': 'LayerTree',
    'Qtiler2Origo.feat_legend': 'Legend',
    'Qtiler2Origo.feat_measurement': 'Measure',
    'Qtiler2Origo.feat_print': 'Print',
    'Qtiler2Origo.feat_maptip': 'MapTip',
    'Qtiler2Origo.feat_share': 'Share',
    'Qtiler2Origo.feat_redlining': 'Redlining',
    'Qtiler2Origo.feat_bookmark': 'Bookmark',
    'Qtiler2Origo.feat_height_profile': 'HeightProfile',
    'Qtiler2Origo.feat_view3d': 'View3D',
    'Qtiler2Origo.feat_dxf_export': 'DxfExport',
    'Qtiler2Origo.feat_attribute_table': 'AttributeTable',
    'Qtiler2Origo.feat_routing': 'Routing',
    'Qtiler2Origo.publish_now': 'Publish',
    'Qtiler2Origo.cancel': 'Cancel',
    'Qtiler2Origo.no_layers': 'No layers found.',
    'Qtiler2Origo.no_bg_available': 'No backgrounds available.',
    'Qtiler2Origo.no_project_selected': 'No project selected.',
    'Qtiler2Origo.no_bg_selected': 'No background project selected.',
    'Qtiler2Origo.optional_select': 'Optional: select another project first.',
    'Qtiler2Origo.no_bg_option': 'No background',
    'Qtiler2Origo.osm_bg': 'OSM background',
    'Qtiler2Origo.log_installed': 'Origo installed successfully.',
    'Qtiler2Origo.log_uninstalled': 'Origo uninstalled.',
    'Qtiler2Origo.log_server_started': 'Standalone server started on port {port}.',
    'Qtiler2Origo.log_server_stopped': 'Standalone server stopped.',
    'Qtiler2Origo.log_logo_uploaded': 'Logo uploaded.',
    'Qtiler2Origo.log_logo_removed': 'Logo removed.',
    'Qtiler2Origo.log_published': 'Profile "{id}" published.',
    'Qtiler2Origo.log_deleted': 'Profile "{id}" deleted.',
    'Qtiler2Origo.regen_thumb': 'Regenerate thumbnail',
    'Qtiler2Origo.regen_thumb_title': 'Clear cached thumbnails for this project so a fresh one is generated on next view.',
    'Qtiler2Origo.log_thumb_regen': 'Thumbnail cache cleared for "{id}" ({n} files).',
    'Qtiler2Origo.log_error': 'Error: {msg}',
    'Qtiler2Origo.requires_install': 'Install Origo first to use this section.',
    'Qtiler2Origo.loading': 'Loading...',
    'Qtiler2Origo.load_preview': 'Load Preview',
    'Qtiler2Origo.capture_view': 'Capture view (Center & Zoom)',
    'Qtiler2Origo.searchable': 'searchable',
    'Qtiler2Origo.editable': 'editable',
    'Qtiler2Origo.layers_count': '{n} layers',
    'Qtiler2Origo.bg_count': '{n} backgrounds',
    'Qtiler2Origo.tab_setup': 'Setup',
    'Qtiler2Origo.tab_maps': 'Maps',
    'Qtiler2Origo.tab_log': 'Log',
    'Qtiler2Origo.map_name': 'Map name',
    'Qtiler2Origo.map_name_placeholder': 'Unique name for this map',
    'Qtiler2Origo.map_description': 'Description',
    'Qtiler2Origo.map_desc_placeholder': 'Optional description',
    'Qtiler2Origo.name_required': 'A name is required.',
    'Qtiler2Origo.name_duplicate': 'A map with this name already exists.',
    'Qtiler2Origo.step_layers': '1. Layers',
    'Qtiler2Origo.step_backgrounds': '2. Background maps',
    'Qtiler2Origo.step_tools': '3. Tools',
    'Qtiler2Origo.default': 'Default',
    'Qtiler2Origo.feat_search_desc': 'Full-text search across map layers',
    'Qtiler2Origo.feat_search_global_desc': 'Enable Coordinates and Nominatim OSM',
    'Qtiler2Origo.feat_search_help': 'Local search uses your searchable layers through /Qtiler2Origo/search. Global Search adds coordinates and Nominatim results on top.',
    'Qtiler2Origo.feat_identify_desc': 'Click map to query feature attributes',
    'Qtiler2Origo.feat_layer_tree_desc': 'Show/hide layers and groups',
    'Qtiler2Origo.feat_legend_desc': 'Display layer symbology and legend',
    'Qtiler2Origo.feat_editing_desc': 'Create, update, and delete features',
    'Qtiler2Origo.feat_print_desc': 'Export map to PDF using QGIS layouts',
    'Qtiler2Origo.feat_maptip_desc': 'Hover tooltips with feature info',
    'Qtiler2Origo.feat_measurement_desc': 'Measure distances and areas on the map',
    'Qtiler2Origo.feat_share_desc': 'Share current map view via URL',
    'Qtiler2Origo.feat_redlining_desc': 'Draw temporary shapes and annotations',
    'Qtiler2Origo.feat_bookmark_desc': 'Save and restore map extents',
    'Qtiler2Origo.feat_height_profile_desc': 'Elevation cross-section along a path',
    'Qtiler2Origo.feat_view3d_desc': 'Enable the Origo View3D module for terrain and 3D layers',
    'Qtiler2Origo.feat_dxf_export_desc': 'Download layers as AutoCAD DXF',
    'Qtiler2Origo.feat_attribute_table_desc': 'Tabular view of feature attributes',
    'Qtiler2Origo.feat_routing_desc': 'Calculate routes between points',
    'Qtiler2Origo.tool_config': 'Configuration',
    'Qtiler2Origo.cfg_share_url': 'Share service URL',
    'Qtiler2Origo.cfg_share_url_ph': 'https://example.com/share',
    'Qtiler2Origo.cfg_routing_url': 'Routing service URL (OSRM/Valhalla)',
    'Qtiler2Origo.cfg_routing_url_ph': 'https://router.example.com/route',
    'Qtiler2Origo.cfg_elevation_url': 'Elevation service URL',
    'Qtiler2Origo.cfg_elevation_url_ph': 'https://elevation.example.com',
    'Qtiler2Origo.cfg_dxf_url': 'DXF export service URL',
    'Qtiler2Origo.cfg_dxf_url_ph': 'https://example.com/dxf',
    'Qtiler2Origo.ctrl_home': 'Home (zoom to extent)',
    'Qtiler2Origo.ctrl_zoom': 'Zoom (+/−)',
    'Qtiler2Origo.ctrl_rotate': 'Rotate map',
    'Qtiler2Origo.ctrl_fullscreen': 'Full screen',
    'Qtiler2Origo.ctrl_geoposition': 'My location (GPS)',
    'Qtiler2Origo.ctrl_mapmenu': 'Layer menu',
    'Qtiler2Origo.ctrl_legend': 'Legend',
    'Qtiler2Origo.ctrl_search': 'Search (geocoding)',
    'Qtiler2Origo.ctrl_editor': 'Feature editor (WFS)',
    'Qtiler2Origo.ctrl_draw': 'Draw (redlining)',
    'Qtiler2Origo.ctrl_measure': 'Measure distances/areas',
    'Qtiler2Origo.ctrl_position': 'Cursor coordinates',
    'Qtiler2Origo.ctrl_print': 'Print',
    'Qtiler2Origo.ctrl_sharemap': 'Share map',
    'Qtiler2Origo.ctrl_progressbar': 'Progress bar',
    'Qtiler2Origo.ctrl_scaleline': 'Scale bar',
    'Qtiler2Origo.ctrl_attribution': 'Attribution',
    'Qtiler2Origo.ctrl_about': 'About',
    'Qtiler2Origo.ctrl_bookmarks': 'Bookmarks',
    'Qtiler2Origo.ctrl_draganddrop': 'Drag & drop files',
    'Qtiler2Origo.ctrl_externalurl': 'External URL links',
    'Qtiler2Origo.ctrl_link': 'Link button',
    'Qtiler2Origo.ctrl_splash': 'Splash dialog',
    'Qtiler2Origo.ctrl_scale': 'Scale (text)',
    'Qtiler2Origo.ctrl_scalepicker': 'Scale picker',
    'Qtiler2Origo.wfs_modal_title': 'Vector style editor',
    'Qtiler2Origo.wfs_layer': 'Layer',
    'Qtiler2Origo.wfs_tab_rules': 'Advanced design',
    'Qtiler2Origo.wfs_tab_designer': 'Basic design',
    'Qtiler2Origo.wfs_tab_json': 'Advanced JSON',
    'Qtiler2Origo.wfs_tab_attributes': 'Attributes (Infoclick)',
    'Qtiler2Origo.wfs_designer_header': 'Quick visual tuning',
    'Qtiler2Origo.wfs_designer_help': 'The preview stays on the right. Adjust fill, pattern and stroke from the control box on the left.',
    'Qtiler2Origo.wfs_group_geometry': 'Geometry',
    'Qtiler2Origo.wfs_group_fill': 'Fill',
    'Qtiler2Origo.wfs_group_pattern': 'Pattern',
    'Qtiler2Origo.wfs_group_stroke': 'Stroke',
    'Qtiler2Origo.wfs_reset': '↺ Reset to basic style',
    'Qtiler2Origo.wfs_cancel': 'Cancel',
    'Qtiler2Origo.wfs_save': 'Save style',
    'Qtiler2Origo.wfs_rules_header': 'Rules and filters',
    'Qtiler2Origo.wfs_copy_rules': '-- Copy rules from layer --',
    'Qtiler2Origo.wfs_add_rule': '+ Add rule',
    'Qtiler2Origo.wfs_rules_help': 'Each rule is evaluated in order. For a default style, leave the filter empty in the last one.',
    'Qtiler2Origo.wfs_attrs_header': 'Popup attributes (Infoclick)',
    'Qtiler2Origo.wfs_add_attr': '+ Add attribute',
    'Qtiler2Origo.wfs_attrs_help': 'Define the attributes to display. If you leave it empty, all are shown.',
    'Qtiler2Origo.wfs_json_label': 'Full layer JSON (configuration + style)',
    'Qtiler2Origo.wfs_copy_layer': '-- Copy from layer --',
    'Qtiler2Origo.wfs_apply_json': 'Apply JSON',
    'Qtiler2Origo.wfs_preview': 'Preview',
    'Qtiler2Origo.wfs_preview_help': 'The preview updates live as you change color, width, opacity and symbol.',
    'Qtiler2Origo.wfs_square': 'Square',
    'Qtiler2Origo.wfs_triangle': 'Triangle',
    'Qtiler2Origo.wfs_star': 'Star',
    'Qtiler2Origo.wfs_radius_size': 'Radius / size',
    'Qtiler2Origo.wfs_dash': 'Line pattern',
    'Qtiler2Origo.wfs_rule': 'Rule',
    'Qtiler2Origo.wfs_move_up': 'Move up',
    'Qtiler2Origo.wfs_move_down': 'Move down',
    'Qtiler2Origo.wfs_delete': 'Delete',
    'Qtiler2Origo.wfs_edit_rule': 'Edit rule',
    'Qtiler2Origo.wfs_rule_editor_title': 'Edit rule style',
    'Qtiler2Origo.wfs_rule_editor_done': 'Done',
    'Qtiler2Origo.wfs_rule_default': 'Default rule',
    'Qtiler2Origo.wfs_edit_visual_style': 'Edit visual style',
    'Qtiler2Origo.wfs_rule_mode_note': 'Editing visual style for rule {rule}. Save to apply it to that rule only.',
    'Qtiler2Origo.wfs_filter': 'Filter',
    'Qtiler2Origo.wfs_attr': 'Attribute',
    'Qtiler2Origo.wfs_op': 'Operator',
    'Qtiler2Origo.wfs_value': 'Value',
    'Qtiler2Origo.wfs_value_placeholder_any': 'Write a value',
    'Qtiler2Origo.wfs_value_placeholder_suggested': 'Write a value or choose a suggestion',
    'Qtiler2Origo.wfs_value_help_manual': 'You can type a value manually even if the attribute has no detected values.',
    'Qtiler2Origo.wfs_value_help_suggested': 'Use an existing value or write a new one manually.',
    'Qtiler2Origo.wfs_value_help_pick_field': 'Select an attribute first to filter by a value.',
    'Qtiler2Origo.wfs_no_filter': '— No filter (default) —',
    'Qtiler2Origo.wfs_symbol': 'Symbol',
    'Qtiler2Origo.wfs_circle': 'Circle',
    'Qtiler2Origo.wfs_svg_icon': 'SVG icon',
    'Qtiler2Origo.wfs_no_fill': 'No fill (transparent)',
    'Qtiler2Origo.wfs_no_fill_only_stroke': 'No fill (transparent, stroke only)',
    'Qtiler2Origo.wfs_no_stroke': 'No stroke',
    'Qtiler2Origo.wfs_radius': 'Radius',
    'Qtiler2Origo.wfs_fill_color': 'Fill color',
    'Qtiler2Origo.wfs_fill_opacity': 'Fill opacity',
    'Qtiler2Origo.wfs_fill_pattern': 'Fill pattern',
    'Qtiler2Origo.wfs_fill_pattern_angle': 'Pattern angle',
    'Qtiler2Origo.wfs_fill_pattern_spacing': 'Pattern spacing',
    'Qtiler2Origo.wfs_fill_pattern_size': 'Dot size',
    'Qtiler2Origo.wfs_fill_pattern_transparent': 'Transparent background',
    'Qtiler2Origo.wfs_fill_pattern_transparent_help': 'Show only the lines or dots so layers below remain visible.',
    'Qtiler2Origo.wfs_fill_pattern_solid': 'Solid',
    'Qtiler2Origo.wfs_fill_pattern_slash': 'Slash',
    'Qtiler2Origo.wfs_fill_pattern_backslash': 'Backslash',
    'Qtiler2Origo.wfs_fill_pattern_horizontal': 'Horizontal lines',
    'Qtiler2Origo.wfs_fill_pattern_vertical': 'Vertical lines',
    'Qtiler2Origo.wfs_fill_pattern_dots': 'Dots',
    'Qtiler2Origo.wfs_fill_pattern_outline': 'Outline only',
    'Qtiler2Origo.wfs_stroke_color': 'Stroke color',
    'Qtiler2Origo.wfs_stroke_width': 'Stroke width',
    'Qtiler2Origo.wfs_stroke_opacity': 'Stroke opacity',
    'Qtiler2Origo.wfs_stroke_pattern': 'Stroke pattern',
    'Qtiler2Origo.wfs_pick_svg': 'Choose SVG…',
    'Qtiler2Origo.wfs_url': 'URL/path',
    'Qtiler2Origo.wfs_scale_field': 'Scale',
    'Qtiler2Origo.wfs_opacity': 'Opacity',
    'Qtiler2Origo.wfs_tint_color': 'Tint color',
    'Qtiler2Origo.wfs_enable_svg_tint': 'Enable SVG tinting',
    'Qtiler2Origo.wfs_color': 'Color',
    'Qtiler2Origo.wfs_width': 'Width',
    'Qtiler2Origo.wfs_pattern': 'Pattern',
    'Qtiler2Origo.wfs_solid': 'Solid',
    'Qtiler2Origo.wfs_dashed': 'Dashed',
    'Qtiler2Origo.wfs_dotted': 'Dotted',
    'Qtiler2Origo.wfs_dashdot': 'Dash-dot',
    'Qtiler2Origo.wfs_visible_from': 'Visible from scale 1:',
    'Qtiler2Origo.wfs_visible_to': 'Visible up to scale 1:',
    'Qtiler2Origo.wfs_visible_from_tip': 'Minimum scale at which this symbol is visible (denominator, e.g. 1000)',
    'Qtiler2Origo.wfs_visible_to_tip': 'Maximum scale at which this symbol is visible (denominator, e.g. 50000)',
    'Qtiler2Origo.wfs_no_limit': 'no limit',
    'Qtiler2Origo.wfs_label': 'Label',
    'Qtiler2Origo.wfs_text_help': 'Text (use {{field}} to insert values)',
    'Qtiler2Origo.wfs_text_placeholder': 'e.g. {{name}} or fixed text',
    'Qtiler2Origo.wfs_insert_field': 'Insert field',
    'Qtiler2Origo.wfs_size': 'Size',
    'Qtiler2Origo.wfs_label_placement': 'Placement',
    'Qtiler2Origo.wfs_label_placement_point': 'Above (point)',
    'Qtiler2Origo.wfs_label_placement_line': 'Follow line',
    'Qtiler2Origo.wfs_label_offsetx': 'Offset X (px)',
    'Qtiler2Origo.wfs_label_offsety': 'Offset Y (px)',
    'Qtiler2Origo.wfs_label_from': 'Label from 1:',
    'Qtiler2Origo.wfs_label_to': 'Label up to 1:',
    'Qtiler2Origo.wfs_label_from_tip': 'Minimum scale at which the label is visible',
    'Qtiler2Origo.wfs_label_to_tip': 'Maximum scale at which the label is visible',
    'Qtiler2Origo.step_controls': '3. Map controls',
    'Qtiler2Origo.step_controls_help': 'Select the tools to show in the viewer. Click the gear icon next to a control to configure its options.',
    'Qtiler2Origo.cfg_btn_title': 'Configure options',
    'Qtiler2Origo.cfg_invalid_json': 'Invalid JSON',
    'Qtiler2Origo.opt_zoomOnStart': 'Zoom on start',
    'Qtiler2Origo.opt_isActive': 'Open by default',
    'Qtiler2Origo.opt_useGroupIndication': 'Group indication',
    'Qtiler2Origo.opt_expanded': 'Expanded',
    'Qtiler2Origo.opt_url': 'Service URL',
    'Qtiler2Origo.opt_limit': 'Result limit',
    'Qtiler2Origo.opt_hintText': 'Placeholder text',
    'Qtiler2Origo.opt_minLength': 'Min characters',
    'Qtiler2Origo.opt_tracking': 'Auto-track position',
    'Qtiler2Origo.opt_enableHighAccuracy': 'High accuracy',
    'Qtiler2Origo.opt_default': 'Default tool',
    'Qtiler2Origo.opt_tools': 'Tools (comma-separated)',
    'Qtiler2Origo.opt_title': 'Title',
    'Qtiler2Origo.opt_projections_json': 'Projections (JSON)',
    'Qtiler2Origo.opt_logo': 'Logo URL',
    'Qtiler2Origo.opt_northArrow': 'Show north arrow',
    'Qtiler2Origo.opt_scales': 'Scales (comma-separated)',
    'Qtiler2Origo.opt_attribution': 'Attribution text',
    'Qtiler2Origo.opt_buttonText': 'Button label',
    'Qtiler2Origo.opt_content': 'Content (HTML)',
    'Qtiler2Origo.wfs_style_yes': 'WFS Style',
    'Qtiler2Origo.wfs_style_no': 'Config. style',
    'Qtiler2Origo.wfs_saved': 'Saved.',
    'Qtiler2Origo.wfs_invalid_json': 'Invalid JSON: ',
    'Qtiler2Origo.wfs_invalid_json_apply': 'Could not apply JSON: ',
    'Qtiler2Origo.wfs_reset_confirm': 'The current style of the layer will be lost and the default basic style will be restored. Continue?',
    'Qtiler2Origo.zoom_warn': 'Warning: Min Zoom ({min}) is greater than Max Zoom ({max}). Min = farthest level (small), Max = closest level (large).',
    'Qtiler2Origo.fam_point': 'Point',
    'Qtiler2Origo.fam_line': 'Line',
    'Qtiler2Origo.fam_polygon': 'Polygon',
    'Qtiler2Origo.no_rules_yet': 'No rules yet.',
    'Qtiler2Origo.loading_style': 'Loading detected style from QGIS…',
    'Qtiler2Origo.install_origo2': 'Install Origo-map',
    'Qtiler2Origo.uninstall_origo2': 'Uninstall Origo-map',
    'Qtiler2Origo.attr_options_ph': 'One option per line',
    'Qtiler2Origo.attr_title_ph': 'Display title',
    'Qtiler2Origo.pub_groups_legend': 'Groups & visibility',
    'Qtiler2Origo.pub_groups_help': "Define groups (and subgroups) and assign each visible layer to the group where it appears in the viewer's tree.",
    'Qtiler2Origo.pub_groups_label': 'Groups',
    'Qtiler2Origo.pub_add_group': '+ Add group',
    'Qtiler2Origo.pub_layer_assign_label': 'Layers → group + initial visibility',
    'Qtiler2Origo.pub_layer_assign_help': 'Only layers checked in step 1 appear here.',
    'Qtiler2Origo.pub_no_groups': 'No custom groups. Layers will go to the default group.',
    'Qtiler2Origo.pub_no_parent': '(no parent)',
    'Qtiler2Origo.pub_group_name_ph': 'technical name',
    'Qtiler2Origo.pub_group_title_ph': 'visible title',
    'Qtiler2Origo.pub_assign_help': 'Check layers in step 1 to assign them.',
    'Qtiler2Origo.pub_search_legend': 'Search options',
    'Qtiler2Origo.pub_search_hint_label': 'Suggested text',
    'Qtiler2Origo.pub_search_min_label': 'Minimum characters',
    'Qtiler2Origo.pub_search_limit_label': 'Max results',
    'Qtiler2Origo.pub_search_placeholder': 'Search…',
    'Qtiler2Origo.pub_search_sources_label': 'Cross-project search sources',
    'Qtiler2Origo.pub_search_sources_help': 'Add additional projects (and pick specific searchable layers) so the search box in the published map can find features from those projects too. The user must have access to each project for its results to appear.',
    'Qtiler2Origo.pub_search_source_add': 'Add project',
    'Qtiler2Origo.pub_search_source_pick_project': '— Select project —',
    'Qtiler2Origo.pub_search_source_layers': 'Layers',
    'Qtiler2Origo.pub_search_source_all_layers': 'All searchable layers',
    'Qtiler2Origo.pub_search_source_no_layers': 'No searchable layers configured for this project.',
    'Qtiler2Origo.pub_search_source_remove': 'Remove',
    'Qtiler2Origo.pub_search_source_current': 'Current project',
    'Qtiler2Origo.pub_edit_profile_title': 'Edit name, layers, backgrounds, groups and tools',
    'Qtiler2Origo.hiw.button': 'How it works & Security',
    'Qtiler2Origo.hiw.title': 'How Qtiler2Origo works & security',
    'Qtiler2Origo.hiw.lead': 'Qtiler2Origo embeds the Origo web map viewer inside Qtiler. It downloads Origo from a pinned GitHub release, lets you create and configure each map graphically using the QGIS library, and reuses Qtiler\'s cache plus the WMS/WFS layers from projects published in Qtiler.',
    'Qtiler2Origo.hiw.vs.title': 'Qrigo vs Qtiler2Origo',
    'Qtiler2Origo.hiw.vs.1': 'Qrigo is for users who already run a standard Origo-map installation on their own server: it only generates JSON snippets to paste into your existing Origo index.json.',
    'Qtiler2Origo.hiw.vs.2': 'Qtiler2Origo installs Origo on top of Qtiler itself, with a graphical map editor backed by the QGIS library and Qtiler\'s cache and WMS/WFS layers — no separate Origo server required.',
    'Qtiler2Origo.hiw.arch.title': '1. Architecture',
    'Qtiler2Origo.hiw.arch.1': 'Express plugin under plugins/Qtiler2Origo/. The Origo build is downloaded from GitHub and served at /plugins/Qtiler2Origo/origo.',
    'Qtiler2Origo.hiw.arch.2': 'Per-map JSON files are stored under data/Qtiler2Origo/maps/ and reloaded in place on edits — no server restart needed.',
    'Qtiler2Origo.hiw.arch.3': 'Public alias /Qtiler2Origo/maps/<name> is rewritten to the internal Origo mount so the same URL works behind reverse proxies.',
    'Qtiler2Origo.hiw.flow.title': '2. Step by step',
    'Qtiler2Origo.hiw.flow.1': 'Setup tab: pick a GitHub release tag and click Install Origo-map.',
    'Qtiler2Origo.hiw.flow.2': 'Maps tab: select a project published in Qtiler, edit the map graphically (CRS, center, zoom, layers, backgrounds, tools).',
    'Qtiler2Origo.hiw.flow.3': 'Click Publish — the map becomes available at /plugins/Qtiler2Origo/origo/?map=<name> and via the public alias /Qtiler2Origo/maps/<name>.',
    'Qtiler2Origo.hiw.flow.4': 'Upload a logo and pick the toolbar controls (search, measure, draw, print, …).',
    'Qtiler2Origo.hiw.maps.title': '3. Maps & QGIS library',
    'Qtiler2Origo.hiw.maps.1': 'Maps are built directly from QGIS projects: layers, styles, scales and CRS come from the project on disk.',
    'Qtiler2Origo.hiw.maps.2': 'Default WMTS background invariants ensure every map has a working base layer.',
    'Qtiler2Origo.hiw.maps.3': 'Bookmarks, print layouts and themes are surfaced automatically per map.',
    'Qtiler2Origo.hiw.wfs.title': '4. WFS edit & cache reuse',
    'Qtiler2Origo.hiw.wfs.1': 'Editable WFS layers reuse the Qtiler WFS endpoint, including multipart edits and edit-existing-feature-by-id.',
    'Qtiler2Origo.hiw.wfs.2': 'Tile and vector tile caches generated by Qtiler are served as background and overlay layers without re-tiling.',
    'Qtiler2Origo.hiw.auth.title': '5. Authentication & visibility',
    'Qtiler2Origo.hiw.auth.1': 'QtilerAuth ACLs (public / authenticated / private) are enforced on every map and on the catalog endpoint.',
    'Qtiler2Origo.hiw.auth.2': 'Cookie sessions and ?api_key=/x-api-key headers are both supported for QGIS Desktop and external integrations.',
    'Qtiler2Origo.hiw.auth.3': 'Standalone-port environment precedence is honoured so the plugin behaves consistently behind IIS or NGINX reverse proxies.',
    'Qtiler2Origo.hiw.security.title': '6. Security & privacy',
    'Qtiler2Origo.hiw.security.1': 'Network calls are limited to GitHub during install and to QtilerAuth for ACL checks; no runtime telemetry.',
    'Qtiler2Origo.hiw.security.2': 'Admin actions (install/uninstall, branding, publish/edit/delete maps) require an authenticated admin user.',
    'Qtiler2Origo.hiw.security.3': 'Open source under MPL-2.0; auditable in plugins/Qtiler2Origo/.'
  },
  es: {
    'Qtiler2Origo.title': 'Qtiler2Origo',
    'Qtiler2Origo.subtitle': 'Instala Origo desde GitHub y sincroniza la visibilidad de proyectos con QtilerAuth.',
    'Qtiler2Origo.how_title': 'Cómo funciona Qtiler2Origo',
    'Qtiler2Origo.how_intro': 'Qtiler2Origo es un plugin puente: integra el visor de mapas web Origo dentro de Qtiler para que puedas publicar proyectos QGIS marcados como fondo (background) como mapas Origo sin salir de la consola de administración.',
    'Qtiler2Origo.how_step_install': 'Instalar Origo — elige una versión publicada en el repositorio oficial de GitHub. Qtiler descarga el build y lo sirve desde /plugins/Qtiler2Origo/Origo.',
    'Qtiler2Origo.how_step_publish': 'Publicar un mapa — abre la pestaña Mapas, escoge un proyecto etiquetado como background (gestionado por QtilerAuth), define CRS, zoom y centro, y guarda. Qtiler genera automáticamente el archivo de configuración Origo.',
    'Qtiler2Origo.how_step_share': 'Compartir el enlace — los mapas publicados están disponibles en /plugins/Qtiler2Origo/Origo/?map=<nombre>. La visibilidad se aplica a través de QtilerAuth, por lo que cada usuario solo ve los proyectos a los que tiene acceso.',
    'Qtiler2Origo.how_step_brand': 'Personalizar — sube un logotipo, elige el mapa base y los controles habilitados (búsqueda, medición, dibujo, impresión…). Los cambios se aplican en caliente sin reiniciar Qtiler.',
    'Qtiler2Origo.how_outro': 'Software libre bajo MPL-2.0. El plugin solo se comunica con GitHub durante la instalación y con QtilerAuth para los permisos de proyecto; ningún dato sale de tu servidor en tiempo de ejecución.',
    'Qtiler2Origo.installation': 'Instalación',
    'Qtiler2Origo.github_repo': 'Repositorio GitHub',
    'Qtiler2Origo.version_tag': 'Versión',
    'Qtiler2Origo.refresh': '↻',
    'Qtiler2Origo.include_prerelease': 'Incluir pre-releases',
    'Qtiler2Origo.no_releases_found': '(no se encontraron releases)',
    'Qtiler2Origo.releases_error': '(error al obtener releases)',
    'Qtiler2Origo.install_Origo': 'Instalar Origo',
    'Qtiler2Origo.uninstall_Origo': 'Desinstalar Origo',
    'Qtiler2Origo.checking': 'Verificando…',
    'Qtiler2Origo.installed': 'Instalado',
    'Qtiler2Origo.not_installed': 'No instalado',
    'Qtiler2Origo.installed_at': 'Instalado el {date} · repo {repo} · versión {version}',
    'Qtiler2Origo.not_installed_hint': 'Origo no está instalado. Ingresa el repo y la versión arriba, luego haz clic en Instalar.',
    'Qtiler2Origo.standalone_server': 'Servidor Origo independiente',
    'Qtiler2Origo.Origo_port': 'Puerto Origo',
    'Qtiler2Origo.start_server': 'Iniciar servidor',
    'Qtiler2Origo.stop_server': 'Detener servidor',
    'Qtiler2Origo.open_Origo': 'Abrir Origo',
    'Qtiler2Origo.webmap_link': 'Abrir webmap',
    'Qtiler2Origo.running': 'Ejecutando',
    'Qtiler2Origo.stopped': 'Detenido',
    'Qtiler2Origo.server_running_at': 'Servidor ejecutando en puerto {port}',
    'Qtiler2Origo.server_stopped_hint': 'El servidor no está ejecutando. Define un puerto y haz clic en Iniciar.',
    'Qtiler2Origo.logo_section': 'Logo del webmap',
    'Qtiler2Origo.logo_desc': 'Sube un logo para el TopBar de Origo. Formatos permitidos: PNG, JPG, SVG, WEBP.',
    'Qtiler2Origo.logo_file': 'Archivo de logo',
    'Qtiler2Origo.upload_logo': 'Subir logo',
    'Qtiler2Origo.remove_logo': 'Quitar logo',
    'Qtiler2Origo.no_logo': 'Sin logo',
    'Qtiler2Origo.logo_active': 'Activo',
    'Qtiler2Origo.logo_updated_at': 'Logo actualizado: {date}',
    'Qtiler2Origo.logo_select_file': 'Selecciona un archivo primero.',
    'Qtiler2Origo.profiles_section': 'Mapas publicados',
    'Qtiler2Origo.profiles_desc': 'Gestiona perfiles generados y enlaces de lanzamiento para Origo (webmap).',
    'Qtiler2Origo.publish_new': 'Nuevo mapa',
    'Qtiler2Origo.no_profiles': 'Aún no hay perfiles publicados. Haz clic en "Nuevo perfil" para crear uno.',
    'Qtiler2Origo.open_json': 'JSON',
    'Qtiler2Origo.open_Origo_link': 'Abrir mapa',
    'Qtiler2Origo.edit_profile': 'Editar mapa',
    'Qtiler2Origo.duplicate': 'Duplicar',
    'Qtiler2Origo.duplicate_title': 'Duplicar webmap',
    'Qtiler2Origo.duplicate_help': 'Indica un nombre único para el nuevo webmap. El original se conservará sin cambios.',
    'Qtiler2Origo.duplicate_new_name': 'Nuevo nombre del webmap',
    'Qtiler2Origo.duplicate_btn': 'Duplicar',
    'Qtiler2Origo.duplicate_done': 'Webmap duplicado como «{id}».',
    'Qtiler2Origo.delete': 'Eliminar',
    'Qtiler2Origo.confirm_delete': '¿Eliminar perfil publicado de {id}?',
    'Qtiler2Origo.open_viewer': 'Galería de mapas publicados',
    'Qtiler2Origo.activity_log': 'Registro de actividad',
    'Qtiler2Origo.clear': 'Limpiar',
    'Qtiler2Origo.no_activity': 'Sin actividad aún.',
    'Qtiler2Origo.modal_title': 'Publicar proyecto en Origo',
    'Qtiler2Origo.modal_title_edit': 'Editar perfil: {id}',
    'Qtiler2Origo.main_project': 'Proyecto principal',
    'Qtiler2Origo.project_layers': 'Capas del proyecto',
    'Qtiler2Origo.layer_include': 'Incluir',
    'Qtiler2Origo.layer_initial_visibility': 'Visible al abrir',
    'Qtiler2Origo.layer_include_help': 'Si está activado, esta capa se incluye en el mapa publicado.',
    'Qtiler2Origo.layer_initial_visibility_help': 'Si está activado, esta capa incluida se verá al abrir el mapa.',
    'Qtiler2Origo.bg_project': 'Proyecto de fondo (opcional)',
    'Qtiler2Origo.bg_layers': 'Capas de fondo',
    'Qtiler2Origo.default_bg': 'Fondo por defecto',
    'Qtiler2Origo.default_bg_help': 'OSM y Sin fondo siempre disponibles. Elige uno como predeterminado.',
    'Qtiler2Origo.Origo_features': 'Módulos de Origo',
    'Qtiler2Origo.feat_search': 'Search',
    'Qtiler2Origo.feat_search_global': 'Búsqueda global',
    'Qtiler2Origo.feat_editing': 'Editing',
    'Qtiler2Origo.feat_identify': 'Identify',
    'Qtiler2Origo.feat_layer_tree': 'LayerTree',
    'Qtiler2Origo.feat_legend': 'Legend',
    'Qtiler2Origo.feat_measurement': 'Measure',
    'Qtiler2Origo.feat_print': 'Print',
    'Qtiler2Origo.feat_maptip': 'MapTip',
    'Qtiler2Origo.feat_share': 'Share',
    'Qtiler2Origo.feat_redlining': 'Redlining',
    'Qtiler2Origo.feat_bookmark': 'Bookmark',
    'Qtiler2Origo.feat_height_profile': 'HeightProfile',
    'Qtiler2Origo.feat_view3d': 'View3D',
    'Qtiler2Origo.feat_dxf_export': 'DxfExport',
    'Qtiler2Origo.feat_attribute_table': 'AttributeTable',
    'Qtiler2Origo.feat_routing': 'Routing',
    'Qtiler2Origo.publish_now': 'Publicar',
    'Qtiler2Origo.cancel': 'Cancelar',
    'Qtiler2Origo.no_layers': 'No se encontraron capas.',
    'Qtiler2Origo.no_bg_available': 'Sin fondos disponibles.',
    'Qtiler2Origo.no_project_selected': 'Sin proyecto seleccionado.',
    'Qtiler2Origo.no_bg_selected': 'Sin proyecto de fondo seleccionado.',
    'Qtiler2Origo.optional_select': 'Opcional: selecciona otro proyecto primero.',
    'Qtiler2Origo.no_bg_option': 'Sin fondo',
    'Qtiler2Origo.osm_bg': 'Fondo OSM',
    'Qtiler2Origo.log_installed': 'Origo instalado correctamente.',
    'Qtiler2Origo.log_uninstalled': 'Origo desinstalado.',
    'Qtiler2Origo.log_server_started': 'Servidor iniciado en puerto {port}.',
    'Qtiler2Origo.log_server_stopped': 'Servidor detenido.',
    'Qtiler2Origo.log_logo_uploaded': 'Logo subido.',
    'Qtiler2Origo.log_logo_removed': 'Logo eliminado.',
    'Qtiler2Origo.log_published': 'Perfil "{id}" publicado.',
    'Qtiler2Origo.log_deleted': 'Perfil "{id}" eliminado.',
    'Qtiler2Origo.regen_thumb': 'Regenerar miniatura',
    'Qtiler2Origo.regen_thumb_title': 'Borra las miniaturas en caché del proyecto para que se regeneren la próxima vez.',
    'Qtiler2Origo.log_thumb_regen': 'Caché de miniaturas vaciada para "{id}" ({n} archivos).',
    'Qtiler2Origo.log_error': 'Error: {msg}',
    'Qtiler2Origo.requires_install': 'Instala Origo primero para usar esta sección.',
    'Qtiler2Origo.loading': 'Cargando...',
    'Qtiler2Origo.load_preview': 'Cargar vista previa',
    'Qtiler2Origo.capture_view': 'Capturar vista (Centro y Zoom)',
    'Qtiler2Origo.searchable': 'buscable',
    'Qtiler2Origo.editable': 'editable',
    'Qtiler2Origo.layers_count': '{n} capas',
    'Qtiler2Origo.bg_count': '{n} fondos',
    'Qtiler2Origo.tab_setup': 'Configuración',
    'Qtiler2Origo.tab_maps': 'Mapas',
    'Qtiler2Origo.tab_log': 'Registro',
    'Qtiler2Origo.map_name': 'Nombre del mapa',
    'Qtiler2Origo.map_name_placeholder': 'Nombre único para este mapa',
    'Qtiler2Origo.map_description': 'Descripción',
    'Qtiler2Origo.map_desc_placeholder': 'Descripción opcional',
    'Qtiler2Origo.name_required': 'Se requiere un nombre.',
    'Qtiler2Origo.name_duplicate': 'Ya existe un mapa con este nombre.',
    'Qtiler2Origo.step_layers': '1. Capas',
    'Qtiler2Origo.step_backgrounds': '2. Mapas de fondo',
    'Qtiler2Origo.step_tools': '3. Herramientas',
    'Qtiler2Origo.default': 'Por defecto',
    'Qtiler2Origo.feat_search_desc': 'Búsqueda de texto completo en capas del mapa',
    'Qtiler2Origo.feat_search_global_desc': 'Activa coordenadas y Nominatim de OSM',
    'Qtiler2Origo.feat_search_help': 'La búsqueda local usa tus capas configuradas como buscables a través de /Qtiler2Origo/search. La búsqueda global añade coordenadas y resultados de Nominatim.',
    'Qtiler2Origo.feat_identify_desc': 'Haz clic en el mapa para consultar atributos',
    'Qtiler2Origo.feat_layer_tree_desc': 'Mostrar/ocultar capas y grupos',
    'Qtiler2Origo.feat_legend_desc': 'Mostrar simbología y leyenda de capas',
    'Qtiler2Origo.feat_editing_desc': 'Crear, actualizar y eliminar elementos',
    'Qtiler2Origo.feat_print_desc': 'Exportar mapa a PDF con diseños de QGIS',
    'Qtiler2Origo.feat_maptip_desc': 'Información emergente al pasar el ratón',
    'Qtiler2Origo.feat_measurement_desc': 'Medir distancias y áreas en el mapa',
    'Qtiler2Origo.feat_share_desc': 'Compartir la vista actual del mapa por URL',
    'Qtiler2Origo.feat_redlining_desc': 'Dibujar formas temporales y anotaciones',
    'Qtiler2Origo.feat_bookmark_desc': 'Guardar y restaurar extensiones del mapa',
    'Qtiler2Origo.feat_height_profile_desc': 'Sección transversal de elevación a lo largo de un camino',
    'Qtiler2Origo.feat_view3d_desc': 'Activa el módulo View3D de Origo para terreno y capas 3D',
    'Qtiler2Origo.feat_dxf_export_desc': 'Descargar capas como AutoCAD DXF',
    'Qtiler2Origo.feat_attribute_table_desc': 'Vista tabular de atributos de elementos',
    'Qtiler2Origo.feat_routing_desc': 'Calcular rutas entre puntos',
    'Qtiler2Origo.tool_config': 'Configuración',
    'Qtiler2Origo.cfg_share_url': 'URL del servicio de compartir',
    'Qtiler2Origo.cfg_share_url_ph': 'https://ejemplo.com/share',
    'Qtiler2Origo.cfg_routing_url': 'URL del servicio de rutas (OSRM/Valhalla)',
    'Qtiler2Origo.cfg_routing_url_ph': 'https://router.ejemplo.com/route',
    'Qtiler2Origo.cfg_elevation_url': 'URL del servicio de elevación',
    'Qtiler2Origo.cfg_elevation_url_ph': 'https://elevation.ejemplo.com',
    'Qtiler2Origo.cfg_dxf_url': 'URL del servicio de exportación DXF',
    'Qtiler2Origo.cfg_dxf_url_ph': 'https://ejemplo.com/dxf',
    'Qtiler2Origo.ctrl_home': 'Inicio (zoom a extensión)',
    'Qtiler2Origo.ctrl_zoom': 'Zoom (+/−)',
    'Qtiler2Origo.ctrl_rotate': 'Rotar mapa',
    'Qtiler2Origo.ctrl_fullscreen': 'Pantalla completa',
    'Qtiler2Origo.ctrl_geoposition': 'Mi posición (GPS)',
    'Qtiler2Origo.ctrl_mapmenu': 'Menú de capas',
    'Qtiler2Origo.ctrl_legend': 'Leyenda',
    'Qtiler2Origo.ctrl_search': 'Búsqueda (geocodificación)',
    'Qtiler2Origo.ctrl_editor': 'Editor de entidades (WFS)',
    'Qtiler2Origo.ctrl_draw': 'Dibujar (redlining)',
    'Qtiler2Origo.ctrl_measure': 'Medir distancias/áreas',
    'Qtiler2Origo.ctrl_position': 'Coordenadas del cursor',
    'Qtiler2Origo.ctrl_print': 'Imprimir',
    'Qtiler2Origo.ctrl_sharemap': 'Compartir mapa',
    'Qtiler2Origo.ctrl_progressbar': 'Barra de progreso',
    'Qtiler2Origo.ctrl_scaleline': 'Escala gráfica',
    'Qtiler2Origo.ctrl_attribution': 'Atribución',
    'Qtiler2Origo.ctrl_about': 'Acerca de',
    'Qtiler2Origo.ctrl_bookmarks': 'Marcadores',
    'Qtiler2Origo.ctrl_draganddrop': 'Arrastrar y soltar archivos',
    'Qtiler2Origo.ctrl_externalurl': 'Enlaces URL externos',
    'Qtiler2Origo.ctrl_link': 'Botón de enlace',
    'Qtiler2Origo.ctrl_splash': 'Diálogo de bienvenida',
    'Qtiler2Origo.ctrl_scale': 'Escala (texto)',
    'Qtiler2Origo.ctrl_scalepicker': 'Selector de escala',
    'Qtiler2Origo.wfs_modal_title': 'Editor de estilo vectorial',
    'Qtiler2Origo.wfs_layer': 'Capa',
    'Qtiler2Origo.wfs_tab_rules': 'Diseño avanzado',
    'Qtiler2Origo.wfs_tab_designer': 'Diseño básico',
    'Qtiler2Origo.wfs_tab_json': 'Editar JSON avanzado',
    'Qtiler2Origo.wfs_tab_attributes': 'Atributos (Infoclick)',
    'Qtiler2Origo.wfs_designer_header': 'Ajuste visual rápido',
    'Qtiler2Origo.wfs_designer_help': 'La vista previa queda a la derecha. A la izquierda ajustas relleno, patrón y borde desde una caja más cómoda.',
    'Qtiler2Origo.wfs_group_geometry': 'Geometría',
    'Qtiler2Origo.wfs_group_fill': 'Relleno',
    'Qtiler2Origo.wfs_group_pattern': 'Patrón',
    'Qtiler2Origo.wfs_group_stroke': 'Borde y línea',
    'Qtiler2Origo.wfs_reset': '↺ Restablecer estilo básico',
    'Qtiler2Origo.wfs_cancel': 'Cancelar',
    'Qtiler2Origo.wfs_save': 'Guardar estilo',
    'Qtiler2Origo.wfs_rules_header': 'Reglas y filtros',
    'Qtiler2Origo.wfs_copy_rules': '-- Copiar reglas de capa --',
    'Qtiler2Origo.wfs_add_rule': '+ Añadir regla',
    'Qtiler2Origo.wfs_rules_help': 'Cada regla se evalúa por orden. Si quieres una "por defecto", deja el filtro vacío en la última.',
    'Qtiler2Origo.wfs_attrs_header': 'Atributos del Popup (Infoclick)',
    'Qtiler2Origo.wfs_add_attr': '+ Añadir atributo',
    'Qtiler2Origo.wfs_attrs_help': 'Define los atributos a mostrar. Si no llenas nada, se muestran todos.',
    'Qtiler2Origo.wfs_json_label': 'JSON completo de la capa (configuración + estilo)',
    'Qtiler2Origo.wfs_copy_layer': '-- Copiar de capa --',
    'Qtiler2Origo.wfs_apply_json': 'Aplicar JSON',
    'Qtiler2Origo.wfs_preview': 'Vista previa',
    'Qtiler2Origo.wfs_preview_help': 'La vista previa se actualiza en vivo mientras cambias color, grosor, opacidad y símbolo.',
    'Qtiler2Origo.wfs_square': 'Cuadrado',
    'Qtiler2Origo.wfs_triangle': 'Triángulo',
    'Qtiler2Origo.wfs_star': 'Estrella',
    'Qtiler2Origo.wfs_radius_size': 'Radio / tamaño',
    'Qtiler2Origo.wfs_dash': 'Patrón de línea',
    'Qtiler2Origo.wfs_rule': 'Regla',
    'Qtiler2Origo.wfs_move_up': 'Subir',
    'Qtiler2Origo.wfs_move_down': 'Bajar',
    'Qtiler2Origo.wfs_delete': 'Eliminar',
    'Qtiler2Origo.wfs_edit_rule': 'Editar regla',
    'Qtiler2Origo.wfs_rule_editor_title': 'Editar estilo de regla',
    'Qtiler2Origo.wfs_rule_editor_done': 'Listo',
    'Qtiler2Origo.wfs_rule_default': 'Regla por defecto',
    'Qtiler2Origo.wfs_edit_visual_style': 'Editar estilo visual',
    'Qtiler2Origo.wfs_rule_mode_note': 'Estás editando la apariencia visual de la regla {rule}. Al guardar se aplica solo a esa regla.',
    'Qtiler2Origo.wfs_filter': 'Filtro',
    'Qtiler2Origo.wfs_attr': 'Atributo',
    'Qtiler2Origo.wfs_op': 'Operador',
    'Qtiler2Origo.wfs_value': 'Valor',
    'Qtiler2Origo.wfs_value_placeholder_any': 'Escribe un valor',
    'Qtiler2Origo.wfs_value_placeholder_suggested': 'Escribe un valor o elige una sugerencia',
    'Qtiler2Origo.wfs_value_help_manual': 'Puedes escribir un valor manualmente aunque el atributo no tenga valores detectados.',
    'Qtiler2Origo.wfs_value_help_suggested': 'Usa un valor existente o escribe uno nuevo manualmente.',
    'Qtiler2Origo.wfs_value_help_pick_field': 'Selecciona primero un atributo para filtrar por valor.',
    'Qtiler2Origo.wfs_no_filter': '— Sin filtro (por defecto) —',
    'Qtiler2Origo.wfs_symbol': 'Símbolo',
    'Qtiler2Origo.wfs_circle': 'Círculo',
    'Qtiler2Origo.wfs_svg_icon': 'Icono SVG',
    'Qtiler2Origo.wfs_no_fill': 'Sin relleno (transparente)',
    'Qtiler2Origo.wfs_no_fill_only_stroke': 'Sin relleno (transparente, solo borde)',
    'Qtiler2Origo.wfs_no_stroke': 'Sin borde',
    'Qtiler2Origo.wfs_radius': 'Radio',
    'Qtiler2Origo.wfs_fill_color': 'Color de relleno',
    'Qtiler2Origo.wfs_fill_opacity': 'Opacidad relleno',
    'Qtiler2Origo.wfs_fill_pattern': 'Patrón de relleno',
    'Qtiler2Origo.wfs_fill_pattern_angle': 'Ángulo del patrón',
    'Qtiler2Origo.wfs_fill_pattern_spacing': 'Separación del patrón',
    'Qtiler2Origo.wfs_fill_pattern_size': 'Tamaño de punto',
    'Qtiler2Origo.wfs_fill_pattern_transparent': 'Fondo transparente',
    'Qtiler2Origo.wfs_fill_pattern_transparent_help': 'Muestra solo las rayas o puntos para poder ver capas debajo.',
    'Qtiler2Origo.wfs_fill_pattern_solid': 'Sólido',
    'Qtiler2Origo.wfs_fill_pattern_slash': 'Slash',
    'Qtiler2Origo.wfs_fill_pattern_backslash': 'Backslash',
    'Qtiler2Origo.wfs_fill_pattern_horizontal': 'Líneas horizontales',
    'Qtiler2Origo.wfs_fill_pattern_vertical': 'Líneas verticales',
    'Qtiler2Origo.wfs_fill_pattern_dots': 'Puntos',
    'Qtiler2Origo.wfs_fill_pattern_outline': 'Solo borde',
    'Qtiler2Origo.wfs_stroke_color': 'Color del borde',
    'Qtiler2Origo.wfs_stroke_width': 'Grosor borde',
    'Qtiler2Origo.wfs_stroke_opacity': 'Opacidad borde',
    'Qtiler2Origo.wfs_stroke_pattern': 'Patrón borde',
    'Qtiler2Origo.wfs_pick_svg': 'Elegir SVG…',
    'Qtiler2Origo.wfs_url': 'URL/ruta',
    'Qtiler2Origo.wfs_scale_field': 'Escala',
    'Qtiler2Origo.wfs_opacity': 'Opacidad',
    'Qtiler2Origo.wfs_tint_color': 'Teñir color',
    'Qtiler2Origo.wfs_enable_svg_tint': 'Activar tintado de SVG',
    'Qtiler2Origo.wfs_color': 'Color',
    'Qtiler2Origo.wfs_width': 'Grosor',
    'Qtiler2Origo.wfs_pattern': 'Patrón',
    'Qtiler2Origo.wfs_solid': 'Sólida',
    'Qtiler2Origo.wfs_dashed': 'Discontinua',
    'Qtiler2Origo.wfs_dotted': 'Punteada',
    'Qtiler2Origo.wfs_dashdot': 'Punto y raya',
    'Qtiler2Origo.wfs_visible_from': 'Visible desde escala 1:',
    'Qtiler2Origo.wfs_visible_to': 'Visible hasta escala 1:',
    'Qtiler2Origo.wfs_visible_from_tip': 'Escala mínima a la que se ve este símbolo (denominador, ej: 1000)',
    'Qtiler2Origo.wfs_visible_to_tip': 'Escala máxima a la que se ve este símbolo (denominador, ej: 50000)',
    'Qtiler2Origo.wfs_no_limit': 'sin límite',
    'Qtiler2Origo.wfs_label': 'Etiqueta',
    'Qtiler2Origo.wfs_text_help': 'Texto (usa {{campo}} para insertar valores)',
    'Qtiler2Origo.wfs_text_placeholder': 'Ej: {{name}} o texto fijo',
    'Qtiler2Origo.wfs_insert_field': 'Insertar campo',
    'Qtiler2Origo.wfs_size': 'Tamaño',
    'Qtiler2Origo.wfs_label_placement': 'Colocación',
    'Qtiler2Origo.wfs_label_placement_point': 'Sobre el punto',
    'Qtiler2Origo.wfs_label_placement_line': 'Seguir la línea',
    'Qtiler2Origo.wfs_label_offsetx': 'Desplaz. X (px)',
    'Qtiler2Origo.wfs_label_offsety': 'Desplaz. Y (px)',
    'Qtiler2Origo.wfs_label_from': 'Etiqueta desde 1:',
    'Qtiler2Origo.wfs_label_to': 'Etiqueta hasta 1:',
    'Qtiler2Origo.wfs_label_from_tip': 'Escala mínima a la que se ve la etiqueta',
    'Qtiler2Origo.wfs_label_to_tip': 'Escala máxima a la que se ve la etiqueta',
    'Qtiler2Origo.step_controls': '3. Controles del mapa',
    'Qtiler2Origo.step_controls_help': 'Selecciona las herramientas que aparecerán en el visor. Pulsa el icono de engranaje junto a un control para configurar sus opciones.',
    'Qtiler2Origo.cfg_btn_title': 'Configurar opciones',
    'Qtiler2Origo.cfg_invalid_json': 'JSON inválido',
    'Qtiler2Origo.opt_zoomOnStart': 'Zoom al iniciar',
    'Qtiler2Origo.opt_isActive': 'Abierto por defecto',
    'Qtiler2Origo.opt_useGroupIndication': 'Indicación de grupo',
    'Qtiler2Origo.opt_expanded': 'Expandido',
    'Qtiler2Origo.opt_url': 'URL del servicio',
    'Qtiler2Origo.opt_limit': 'Límite de resultados',
    'Qtiler2Origo.opt_hintText': 'Texto de ayuda',
    'Qtiler2Origo.opt_minLength': 'Mín. caracteres',
    'Qtiler2Origo.opt_tracking': 'Seguimiento automático',
    'Qtiler2Origo.opt_enableHighAccuracy': 'Alta precisión',
    'Qtiler2Origo.opt_default': 'Herramienta por defecto',
    'Qtiler2Origo.opt_tools': 'Herramientas (separadas por coma)',
    'Qtiler2Origo.opt_title': 'Título',
    'Qtiler2Origo.opt_projections_json': 'Proyecciones (JSON)',
    'Qtiler2Origo.opt_logo': 'URL del logo',
    'Qtiler2Origo.opt_northArrow': 'Mostrar flecha norte',
    'Qtiler2Origo.opt_scales': 'Escalas (separadas por coma)',
    'Qtiler2Origo.opt_attribution': 'Texto de atribución',
    'Qtiler2Origo.opt_buttonText': 'Etiqueta del botón',
    'Qtiler2Origo.opt_content': 'Contenido (HTML)',
    'Qtiler2Origo.wfs_style_yes': 'Estilo WFS',
    'Qtiler2Origo.wfs_style_no': 'Config. estilo',
    'Qtiler2Origo.wfs_saved': 'Guardado.',
    'Qtiler2Origo.wfs_invalid_json': 'JSON inválido: ',
    'Qtiler2Origo.wfs_invalid_json_apply': 'No se pudo aplicar el JSON: ',
    'Qtiler2Origo.wfs_reset_confirm': 'Se perderá el estilo actual de la capa y se restaurará el estilo básico por defecto. ¿Continuar?',
    'Qtiler2Origo.zoom_warn': 'Atención: Min Zoom ({min}) es mayor que Max Zoom ({max}). Min = nivel más alejado (chico), Max = nivel más cercano (grande).',
    'Qtiler2Origo.fam_point': 'Punto',
    'Qtiler2Origo.fam_line': 'Línea',
    'Qtiler2Origo.fam_polygon': 'Polígono',
    'Qtiler2Origo.no_rules_yet': 'Sin reglas todavía.',
    'Qtiler2Origo.loading_style': 'Cargando estilo detectado desde QGIS…',
    'Qtiler2Origo.install_origo2': 'Instalar Origo-map',
    'Qtiler2Origo.uninstall_origo2': 'Desinstalar Origo-map',
    'Qtiler2Origo.attr_options_ph': 'Una opción por línea',
    'Qtiler2Origo.attr_title_ph': 'Título a mostrar',
    'Qtiler2Origo.pub_groups_legend': 'Grupos y visibilidad',
    'Qtiler2Origo.pub_groups_help': 'Define grupos (y subgrupos) y asigna cada capa visible al grupo donde aparecerá en el árbol del visor.',
    'Qtiler2Origo.pub_groups_label': 'Grupos',
    'Qtiler2Origo.pub_add_group': '+ Añadir grupo',
    'Qtiler2Origo.pub_layer_assign_label': 'Capas → grupo + visibilidad inicial',
    'Qtiler2Origo.pub_layer_assign_help': 'Solo aparecen las capas marcadas en el paso 1.',
    'Qtiler2Origo.pub_no_groups': 'No hay grupos personalizados. Las capas irán al grupo por defecto.',
    'Qtiler2Origo.pub_no_parent': '(sin padre)',
    'Qtiler2Origo.pub_group_name_ph': 'nombre técnico',
    'Qtiler2Origo.pub_group_title_ph': 'título visible',
    'Qtiler2Origo.pub_assign_help': 'Marca capas en el paso 1 para asignarlas.',
    'Qtiler2Origo.pub_search_legend': 'Opciones de Búsqueda',
    'Qtiler2Origo.pub_search_hint_label': 'Texto sugerido',
    'Qtiler2Origo.pub_search_min_label': 'Caracteres mínimos',
    'Qtiler2Origo.pub_search_limit_label': 'Resultados máx.',
    'Qtiler2Origo.pub_search_placeholder': 'Buscar…',
    'Qtiler2Origo.pub_search_sources_label': 'Fuentes de búsqueda entre proyectos',
    'Qtiler2Origo.pub_search_sources_help': 'Agrega proyectos adicionales (y elige capas específicas) para que el buscador del mapa publicado encuentre también entidades de esos proyectos. El usuario debe tener acceso a cada proyecto para ver sus resultados.',
    'Qtiler2Origo.pub_search_source_add': 'Añadir proyecto',
    'Qtiler2Origo.pub_search_source_pick_project': '— Selecciona proyecto —',
    'Qtiler2Origo.pub_search_source_layers': 'Capas',
    'Qtiler2Origo.pub_search_source_all_layers': 'Todas las capas buscables',
    'Qtiler2Origo.pub_search_source_no_layers': 'No hay capas buscables configuradas para este proyecto.',
    'Qtiler2Origo.pub_search_source_remove': 'Quitar',
    'Qtiler2Origo.pub_search_source_current': 'Proyecto actual',
    'Qtiler2Origo.pub_edit_profile_title': 'Editar nombre, capas, fondos, grupos y herramientas',
    'Qtiler2Origo.hiw.button': 'Cómo funciona y seguridad',
    'Qtiler2Origo.hiw.title': 'Cómo funciona Qtiler2Origo y por qué es seguro',
    'Qtiler2Origo.hiw.lead': 'Qtiler2Origo integra el visor web Origo dentro de Qtiler. Descarga Origo desde una release fija de GitHub, te permite crear y configurar cada mapa de forma gráfica usando la biblioteca de QGIS, y aprovecha el caché de Qtiler y las capas WMS/WFS de los proyectos añadidos en Qtiler.',
    'Qtiler2Origo.hiw.vs.title': 'Qrigo vs Qtiler2Origo',
    'Qtiler2Origo.hiw.vs.1': 'Qrigo es para usuarios que ya tienen Origo-map instalado de forma estándar en su propio servidor: solo genera snippets JSON para pegar en el index.json de tu Origo existente.',
    'Qtiler2Origo.hiw.vs.2': 'Qtiler2Origo instala Origo sobre Qtiler, con un editor gráfico de mapas respaldado por la biblioteca de QGIS y por el caché y las capas WMS/WFS de Qtiler — sin necesidad de un servidor Origo aparte.',
    'Qtiler2Origo.hiw.arch.title': '1. Arquitectura',
    'Qtiler2Origo.hiw.arch.1': 'Plugin Express en plugins/Qtiler2Origo/. El build de Origo se descarga de GitHub y se sirve en /plugins/Qtiler2Origo/origo.',
    'Qtiler2Origo.hiw.arch.2': 'Cada mapa se guarda como JSON en data/Qtiler2Origo/maps/ y se recarga en caliente en cada edición — sin reiniciar el servidor.',
    'Qtiler2Origo.hiw.arch.3': 'El alias público /Qtiler2Origo/maps/<nombre> se reescribe al mount interno de Origo, para que la misma URL funcione tras un reverse proxy.',
    'Qtiler2Origo.hiw.flow.title': '2. Paso a paso',
    'Qtiler2Origo.hiw.flow.1': 'Pestaña Setup: elige un tag de release de GitHub y pulsa Instalar Origo-map.',
    'Qtiler2Origo.hiw.flow.2': 'Pestaña Mapas: selecciona un proyecto publicado en Qtiler y edita el mapa gráficamente (CRS, centro, zoom, capas, fondos, herramientas).',
    'Qtiler2Origo.hiw.flow.3': 'Pulsa Publicar — el mapa queda disponible en /plugins/Qtiler2Origo/origo/?map=<nombre> y vía el alias público /Qtiler2Origo/maps/<nombre>.',
    'Qtiler2Origo.hiw.flow.4': 'Sube un logo y elige los controles de la barra (búsqueda, medir, dibujar, imprimir, …).',
    'Qtiler2Origo.hiw.maps.title': '3. Mapas y biblioteca QGIS',
    'Qtiler2Origo.hiw.maps.1': 'Los mapas se construyen directamente desde proyectos QGIS: capas, estilos, escalas y CRS provienen del proyecto en disco.',
    'Qtiler2Origo.hiw.maps.2': 'Se garantizan invariantes de fondo WMTS por defecto para que cada mapa tenga una capa base válida.',
    'Qtiler2Origo.hiw.maps.3': 'Marcadores, layouts de impresión y temas se exponen automáticamente por mapa.',
    'Qtiler2Origo.hiw.wfs.title': '4. Edición WFS y reuso de caché',
    'Qtiler2Origo.hiw.wfs.1': 'Las capas WFS editables reutilizan el endpoint WFS de Qtiler, incluyendo edición multipart y edición por id de feature existente.',
    'Qtiler2Origo.hiw.wfs.2': 'Los cachés de tiles y vector tiles generados por Qtiler se sirven como capas de fondo y de overlay sin re-tilear.',
    'Qtiler2Origo.hiw.auth.title': '5. Autenticación y visibilidad',
    'Qtiler2Origo.hiw.auth.1': 'Las ACL de QtilerAuth (public / authenticated / private) se aplican en cada mapa y en el endpoint del catálogo.',
    'Qtiler2Origo.hiw.auth.2': 'Se admiten sesiones por cookie y cabeceras ?api_key=/x-api-key para QGIS Desktop e integraciones externas.',
    'Qtiler2Origo.hiw.auth.3': 'Se respeta la precedencia de variables de entorno del puerto standalone para que el plugin se comporte igual tras IIS o NGINX.',
    'Qtiler2Origo.hiw.security.title': '6. Seguridad y privacidad',
    'Qtiler2Origo.hiw.security.1': 'Las llamadas de red se limitan a GitHub al instalar y a QtilerAuth para ACLs; sin telemetría en tiempo de ejecución.',
    'Qtiler2Origo.hiw.security.2': 'Las acciones de administración (instalar/desinstalar, branding, publicar/editar/borrar mapas) requieren un usuario admin autenticado.',
    'Qtiler2Origo.hiw.security.3': 'Open source bajo MPL-2.0; auditable en plugins/Qtiler2Origo/.'
  },
  sv: {
    'Qtiler2Origo.title': 'Origo-brygga för Qtiler',
    'Qtiler2Origo.subtitle': 'Installera Origo från GitHub och synkronisera projektsynlighet från QtilerAuth.',
    'Qtiler2Origo.how_title': 'Så fungerar Qtiler2Origo',
    'Qtiler2Origo.how_intro': 'Qtiler2Origo är ett brygg-plugin: det bäddar in webbkartvyn Origo i Qtiler så att du kan publicera QGIS-projekt märkta som bakgrund som Origo-kartor utan att lämna administrationskonsolen.',
    'Qtiler2Origo.how_step_install': 'Installera Origo — välj en releasetagg från det officiella GitHub-arkivet. Qtiler laddar ner bygget och serverar det från /plugins/Qtiler2Origo/Origo.',
    'Qtiler2Origo.how_step_publish': 'Publicera en karta — öppna fliken Kartor, välj ett projekt märkt som bakgrund (hanteras av QtilerAuth), ange CRS, zoom och centrum och spara. Qtiler genererar Origo-konfigurationsfilen automatiskt.',
    'Qtiler2Origo.how_step_share': 'Dela länken — publicerade kartor nås via /plugins/Qtiler2Origo/Origo/?map=<namn>. Synligheten styrs av QtilerAuth, så användare ser bara projekt de har behörighet till.',
    'Qtiler2Origo.how_step_brand': 'Anpassa utseende — ladda upp en logotyp, välj bakgrundskarta och vilka kontroller som ska vara aktiverade (sök, mät, rita, skriv ut…). Ändringar laddas om i farten utan omstart av Qtiler.',
    'Qtiler2Origo.how_outro': 'Öppen källkod under MPL-2.0. Plugin-modulen kommunicerar endast med GitHub vid installation och med QtilerAuth för projektbehörigheter; ingen data lämnar din server under drift.',
    'Qtiler2Origo.installation': 'Installation',
    'Qtiler2Origo.github_repo': 'GitHub-repo',
    'Qtiler2Origo.version_tag': 'Version',
    'Qtiler2Origo.refresh': '↻',
    'Qtiler2Origo.include_prerelease': 'Inkludera pre-releases',
    'Qtiler2Origo.no_releases_found': '(inga releases hittades)',
    'Qtiler2Origo.releases_error': '(fel vid hämtning av releases)',
    'Qtiler2Origo.install_Origo': 'Installera Origo',
    'Qtiler2Origo.uninstall_Origo': 'Avinstallera Origo',
    'Qtiler2Origo.checking': 'Kontrollerar…',
    'Qtiler2Origo.installed': 'Installerad',
    'Qtiler2Origo.not_installed': 'Ej installerad',
    'Qtiler2Origo.installed_at': 'Installerad {date} · repo {repo} · version {version}',
    'Qtiler2Origo.not_installed_hint': 'Origo är inte installerad. Ange repo och version ovan, klicka sedan på Installera.',
    'Qtiler2Origo.standalone_server': 'Fristående Origo-server',
    'Qtiler2Origo.Origo_port': 'Origo-port',
    'Qtiler2Origo.start_server': 'Starta server',
    'Qtiler2Origo.stop_server': 'Stoppa server',
    'Qtiler2Origo.open_Origo': 'Öppna Origo',
    'Qtiler2Origo.webmap_link': 'Öppna webbkarta',
    'Qtiler2Origo.running': 'Körs',
    'Qtiler2Origo.stopped': 'Stoppad',
    'Qtiler2Origo.server_running_at': 'Server körs på port {port}',
    'Qtiler2Origo.server_stopped_hint': 'Server körs inte. Ange port och klicka Starta.',
    'Qtiler2Origo.logo_section': 'Webbkart-logotyp',
    'Qtiler2Origo.logo_desc': 'Ladda upp en logotyp för Origo TopBar. Tillåtna format: PNG, JPG, SVG, WEBP.',
    'Qtiler2Origo.logo_file': 'Logotypfil',
    'Qtiler2Origo.upload_logo': 'Ladda upp logotyp',
    'Qtiler2Origo.remove_logo': 'Ta bort logotyp',
    'Qtiler2Origo.no_logo': 'Ingen logotyp',
    'Qtiler2Origo.logo_active': 'Aktiv',
    'Qtiler2Origo.logo_updated_at': 'Logotyp uppdaterad: {date}',
    'Qtiler2Origo.logo_select_file': 'Välj en fil först.',
    'Qtiler2Origo.profiles_section': 'Publicerade kartor',
    'Qtiler2Origo.profiles_desc': 'Hantera genererade profiler och startlänkar för Origo (webmap).',
    'Qtiler2Origo.publish_new': 'Ny karta',
    'Qtiler2Origo.no_profiles': 'Inga publicerade profiler ännu. Klicka "Ny profil" för att skapa en.',
    'Qtiler2Origo.open_json': 'JSON',
    'Qtiler2Origo.open_Origo_link': 'Öppna karta',
    'Qtiler2Origo.edit_profile': 'Redigera karta',
    'Qtiler2Origo.duplicate': 'Duplicera',
    'Qtiler2Origo.duplicate_title': 'Duplicera webbkarta',
    'Qtiler2Origo.duplicate_help': 'Ange ett unikt namn för den nya webbkartan. Originalet behålls oförändrat.',
    'Qtiler2Origo.duplicate_new_name': 'Nytt namn på webbkartan',
    'Qtiler2Origo.duplicate_btn': 'Duplicera',
    'Qtiler2Origo.duplicate_done': 'Webbkartan duplicerad som ”{id}”.',
    'Qtiler2Origo.delete': 'Radera',
    'Qtiler2Origo.confirm_delete': 'Radera publicerad profil för {id}?',
    'Qtiler2Origo.open_viewer': 'Galleri för publicerade kartor',
    'Qtiler2Origo.activity_log': 'Aktivitetslogg',
    'Qtiler2Origo.clear': 'Rensa',
    'Qtiler2Origo.no_activity': 'Ingen aktivitet ännu.',
    'Qtiler2Origo.modal_title': 'Publicera projekt i Origo',
    'Qtiler2Origo.modal_title_edit': 'Redigera profil: {id}',
    'Qtiler2Origo.main_project': 'Huvudprojekt',
    'Qtiler2Origo.project_layers': 'Projektlager',
    'Qtiler2Origo.layer_include': 'Inkludera',
    'Qtiler2Origo.layer_initial_visibility': 'Synlig vid start',
    'Qtiler2Origo.layer_include_help': 'Om aktiverad inkluderas lagret i den publicerade kartan.',
    'Qtiler2Origo.layer_initial_visibility_help': 'Om aktiverad visas det inkluderade lagret när kartan öppnas.',
    'Qtiler2Origo.bg_project': 'Bakgrundsprojekt (valfritt)',
    'Qtiler2Origo.bg_layers': 'Bakgrundslager',
    'Qtiler2Origo.default_bg': 'Standardbakgrund',
    'Qtiler2Origo.default_bg_help': 'OSM och Ingen bakgrund är alltid tillgängliga. Välj en som standard.',
    'Qtiler2Origo.Origo_features': 'Origo-moduler',
    'Qtiler2Origo.feat_search': 'Search',
    'Qtiler2Origo.feat_search_global': 'Global sökning',
    'Qtiler2Origo.feat_editing': 'Editing',
    'Qtiler2Origo.feat_identify': 'Identify',
    'Qtiler2Origo.feat_layer_tree': 'LayerTree',
    'Qtiler2Origo.feat_legend': 'Legend',
    'Qtiler2Origo.feat_measurement': 'Measure',
    'Qtiler2Origo.feat_print': 'Print',
    'Qtiler2Origo.feat_maptip': 'MapTip',
    'Qtiler2Origo.feat_share': 'Share',
    'Qtiler2Origo.feat_redlining': 'Redlining',
    'Qtiler2Origo.feat_bookmark': 'Bookmark',
    'Qtiler2Origo.feat_height_profile': 'HeightProfile',
    'Qtiler2Origo.feat_view3d': 'View3D',
    'Qtiler2Origo.feat_dxf_export': 'DxfExport',
    'Qtiler2Origo.feat_attribute_table': 'AttributeTable',
    'Qtiler2Origo.feat_routing': 'Routing',
    'Qtiler2Origo.publish_now': 'Publicera',
    'Qtiler2Origo.cancel': 'Avbryt',
    'Qtiler2Origo.no_layers': 'Inga lager hittades.',
    'Qtiler2Origo.no_bg_available': 'Inga bakgrunder tillgängliga.',
    'Qtiler2Origo.no_project_selected': 'Inget projekt valt.',
    'Qtiler2Origo.no_bg_selected': 'Inget bakgrundsprojekt valt.',
    'Qtiler2Origo.optional_select': 'Valfritt: välj ett annat projekt först.',
    'Qtiler2Origo.no_bg_option': 'Ingen bakgrund',
    'Qtiler2Origo.osm_bg': 'OSM-bakgrund',
    'Qtiler2Origo.log_installed': 'Origo installerad.',
    'Qtiler2Origo.log_uninstalled': 'Origo avinstallerad.',
    'Qtiler2Origo.log_server_started': 'Server startad på port {port}.',
    'Qtiler2Origo.log_server_stopped': 'Server stoppad.',
    'Qtiler2Origo.log_logo_uploaded': 'Logotyp uppladdad.',
    'Qtiler2Origo.log_logo_removed': 'Logotyp borttagen.',
    'Qtiler2Origo.log_published': 'Profil "{id}" publicerad.',
    'Qtiler2Origo.log_deleted': 'Profil "{id}" raderad.',
    'Qtiler2Origo.regen_thumb': 'Regenerera miniatyr',
    'Qtiler2Origo.regen_thumb_title': 'Rensa cachelagrade miniatyrer för projektet så att en ny skapas nästa gång.',
    'Qtiler2Origo.log_thumb_regen': 'Miniatyrcache rensad för "{id}" ({n} filer).',
    'Qtiler2Origo.log_error': 'Fel: {msg}',
    'Qtiler2Origo.requires_install': 'Installera Origo först för att använda denna sektion.',
    'Qtiler2Origo.loading': 'Laddar...',
    'Qtiler2Origo.load_preview': 'Ladda förhandsvisning',
    'Qtiler2Origo.capture_view': 'Fånga vy (Centrum och zoom)',
    'Qtiler2Origo.searchable': 'sökbar',
    'Qtiler2Origo.editable': 'redigerbar',
    'Qtiler2Origo.layers_count': '{n} lager',
    'Qtiler2Origo.bg_count': '{n} bakgrunder',
    'Qtiler2Origo.tab_setup': 'Inställningar',
    'Qtiler2Origo.tab_maps': 'Kartor',
    'Qtiler2Origo.tab_log': 'Logg',
    'Qtiler2Origo.map_name': 'Kartnamn',
    'Qtiler2Origo.map_name_placeholder': 'Unikt namn för denna karta',
    'Qtiler2Origo.map_description': 'Beskrivning',
    'Qtiler2Origo.map_desc_placeholder': 'Valfri beskrivning',
    'Qtiler2Origo.name_required': 'Ett namn krävs.',
    'Qtiler2Origo.name_duplicate': 'En karta med detta namn finns redan.',
    'Qtiler2Origo.step_layers': '1. Lager',
    'Qtiler2Origo.step_backgrounds': '2. Bakgrundskartor',
    'Qtiler2Origo.step_tools': '3. Verktyg',
    'Qtiler2Origo.default': 'Standard',
    'Qtiler2Origo.feat_search_desc': 'Fulltextsökning i kartlager',
    'Qtiler2Origo.feat_search_global_desc': 'Aktivera koordinater och Nominatim OSM',
    'Qtiler2Origo.feat_search_help': 'Lokal sökning använder dina sökbara lager via /Qtiler2Origo/search. Global sökning lägger till koordinater och Nominatim-resultat ovanpå detta.',
    'Qtiler2Origo.feat_identify_desc': 'Klicka på kartan för att fråga attribut',
    'Qtiler2Origo.feat_layer_tree_desc': 'Visa/dölj lager och grupper',
    'Qtiler2Origo.feat_legend_desc': 'Visa lagersymbologi och teckenförklaring',
    'Qtiler2Origo.feat_editing_desc': 'Skapa, uppdatera och ta bort objekt',
    'Qtiler2Origo.feat_print_desc': 'Exportera karta till PDF med QGIS-layouter',
    'Qtiler2Origo.feat_maptip_desc': 'Hovertips med objektinformation',
    'Qtiler2Origo.feat_measurement_desc': 'Mät avstånd och arealer på kartan',
    'Qtiler2Origo.feat_share_desc': 'Dela aktuell kartvy via URL',
    'Qtiler2Origo.feat_redlining_desc': 'Rita temporära former och anteckningar',
    'Qtiler2Origo.feat_bookmark_desc': 'Spara och återställ kartomfång',
    'Qtiler2Origo.feat_height_profile_desc': 'Höjdtvärsnitt längs en sträcka',
    'Qtiler2Origo.feat_view3d_desc': 'Aktivera Origo:s View3D-modul för terräng och 3D-lager',
    'Qtiler2Origo.feat_dxf_export_desc': 'Ladda ner lager som AutoCAD DXF',
    'Qtiler2Origo.feat_attribute_table_desc': 'Tabellvy av objektattribut',
    'Qtiler2Origo.feat_routing_desc': 'Beräkna rutter mellan punkter',
    'Qtiler2Origo.tool_config': 'Konfiguration',
    'Qtiler2Origo.cfg_share_url': 'Delningstjänst-URL',
    'Qtiler2Origo.cfg_share_url_ph': 'https://example.com/share',
    'Qtiler2Origo.cfg_routing_url': 'Ruttjänst-URL (OSRM/Valhalla)',
    'Qtiler2Origo.cfg_routing_url_ph': 'https://router.example.com/route',
    'Qtiler2Origo.cfg_elevation_url': 'Höjddatatjänst-URL',
    'Qtiler2Origo.cfg_elevation_url_ph': 'https://elevation.example.com',
    'Qtiler2Origo.cfg_dxf_url': 'DXF-exporttjänst-URL',
    'Qtiler2Origo.cfg_dxf_url_ph': 'https://example.com/dxf',
    'Qtiler2Origo.ctrl_home': 'Hem (zooma till utbredning)',
    'Qtiler2Origo.ctrl_zoom': 'Zoom (+/−)',
    'Qtiler2Origo.ctrl_rotate': 'Rotera karta',
    'Qtiler2Origo.ctrl_fullscreen': 'Helskärm',
    'Qtiler2Origo.ctrl_geoposition': 'Min position (GPS)',
    'Qtiler2Origo.ctrl_mapmenu': 'Lagermeny',
    'Qtiler2Origo.ctrl_legend': 'Teckenförklaring',
    'Qtiler2Origo.ctrl_search': 'Sök (geokodning)',
    'Qtiler2Origo.ctrl_editor': 'Objektredigerare (WFS)',
    'Qtiler2Origo.ctrl_draw': 'Rita (redlining)',
    'Qtiler2Origo.ctrl_measure': 'Mät avstånd/arealer',
    'Qtiler2Origo.ctrl_position': 'Markörkoordinater',
    'Qtiler2Origo.ctrl_print': 'Skriv ut',
    'Qtiler2Origo.ctrl_sharemap': 'Dela karta',
    'Qtiler2Origo.ctrl_progressbar': 'Förloppsindikator',
    'Qtiler2Origo.ctrl_scaleline': 'Skalstock',
    'Qtiler2Origo.ctrl_attribution': 'Upphovsrätt',
    'Qtiler2Origo.ctrl_about': 'Om',
    'Qtiler2Origo.ctrl_bookmarks': 'Bokmärken',
    'Qtiler2Origo.ctrl_draganddrop': 'Dra och släpp filer',
    'Qtiler2Origo.ctrl_externalurl': 'Externa URL-länkar',
    'Qtiler2Origo.ctrl_link': 'Länkknapp',
    'Qtiler2Origo.ctrl_splash': 'Startdialog',
    'Qtiler2Origo.ctrl_scale': 'Skala (text)',
    'Qtiler2Origo.ctrl_scalepicker': 'Skalväljare',
    'Qtiler2Origo.wfs_modal_title': 'Vektorstilredigerare',
    'Qtiler2Origo.wfs_layer': 'Lager',
    'Qtiler2Origo.wfs_tab_rules': 'Avancerad design',
    'Qtiler2Origo.wfs_tab_designer': 'Grundläggande design',
    'Qtiler2Origo.wfs_tab_json': 'Redigera avancerad JSON',
    'Qtiler2Origo.wfs_tab_attributes': 'Attribut (Infoclick)',
    'Qtiler2Origo.wfs_designer_header': 'Snabb visuell justering',
    'Qtiler2Origo.wfs_designer_help': 'Förhandsgranskningen ligger till höger. Justera fyllning, mönster och linje i rutan till vänster.',
    'Qtiler2Origo.wfs_group_geometry': 'Geometri',
    'Qtiler2Origo.wfs_group_fill': 'Fyllning',
    'Qtiler2Origo.wfs_group_pattern': 'Mönster',
    'Qtiler2Origo.wfs_group_stroke': 'Linje',
    'Qtiler2Origo.wfs_reset': '↺ Återställ grundstil',
    'Qtiler2Origo.wfs_cancel': 'Avbryt',
    'Qtiler2Origo.wfs_save': 'Spara stil',
    'Qtiler2Origo.wfs_rules_header': 'Regler och filter',
    'Qtiler2Origo.wfs_copy_rules': '-- Kopiera regler från lager --',
    'Qtiler2Origo.wfs_add_rule': '+ Lägg till regel',
    'Qtiler2Origo.wfs_rules_help': 'Varje regel utvärderas i ordning. För en standardstil, lämna filtret tomt i den sista.',
    'Qtiler2Origo.wfs_attrs_header': 'Popup-attribut (Infoclick)',
    'Qtiler2Origo.wfs_add_attr': '+ Lägg till attribut',
    'Qtiler2Origo.wfs_attrs_help': 'Definiera attributen som ska visas. Om du lämnar tomt visas alla.',
    'Qtiler2Origo.wfs_json_label': 'Komplett lager-JSON (konfiguration + stil)',
    'Qtiler2Origo.wfs_copy_layer': '-- Kopiera från lager --',
    'Qtiler2Origo.wfs_apply_json': 'Tillämpa JSON',
    'Qtiler2Origo.wfs_preview': 'Förhandsgranskning',
    'Qtiler2Origo.wfs_preview_help': 'Förhandsvisningen uppdateras direkt när du ändrar färg, bredd, opacitet och symbol.',
    'Qtiler2Origo.wfs_square': 'Kvadrat',
    'Qtiler2Origo.wfs_triangle': 'Triangel',
    'Qtiler2Origo.wfs_star': 'Stjärna',
    'Qtiler2Origo.wfs_radius_size': 'Radie / storlek',
    'Qtiler2Origo.wfs_dash': 'Linjemönster',
    'Qtiler2Origo.wfs_rule': 'Regel',
    'Qtiler2Origo.wfs_move_up': 'Flytta upp',
    'Qtiler2Origo.wfs_move_down': 'Flytta ner',
    'Qtiler2Origo.wfs_delete': 'Ta bort',
    'Qtiler2Origo.wfs_edit_rule': 'Redigera regel',
    'Qtiler2Origo.wfs_rule_editor_title': 'Redigera regelstil',
    'Qtiler2Origo.wfs_rule_editor_done': 'Klar',
    'Qtiler2Origo.wfs_rule_default': 'Standardregel',
    'Qtiler2Origo.wfs_edit_visual_style': 'Redigera visuell stil',
    'Qtiler2Origo.wfs_rule_mode_note': 'Du redigerar den visuella stilen för regel {rule}. När du sparar tillämpas den bara på den regeln.',
    'Qtiler2Origo.wfs_filter': 'Filter',
    'Qtiler2Origo.wfs_attr': 'Attribut',
    'Qtiler2Origo.wfs_op': 'Operator',
    'Qtiler2Origo.wfs_value': 'Värde',
    'Qtiler2Origo.wfs_value_placeholder_any': 'Skriv ett värde',
    'Qtiler2Origo.wfs_value_placeholder_suggested': 'Skriv ett värde eller välj ett förslag',
    'Qtiler2Origo.wfs_value_help_manual': 'Du kan skriva ett värde manuellt även om attributet inte har några upptäckta värden.',
    'Qtiler2Origo.wfs_value_help_suggested': 'Använd ett befintligt värde eller skriv ett nytt manuellt.',
    'Qtiler2Origo.wfs_value_help_pick_field': 'Välj först ett attribut för att filtrera på ett värde.',
    'Qtiler2Origo.wfs_no_filter': '— Inget filter (standard) —',
    'Qtiler2Origo.wfs_symbol': 'Symbol',
    'Qtiler2Origo.wfs_circle': 'Cirkel',
    'Qtiler2Origo.wfs_svg_icon': 'SVG-ikon',
    'Qtiler2Origo.wfs_no_fill': 'Ingen fyllning (transparent)',
    'Qtiler2Origo.wfs_no_fill_only_stroke': 'Ingen fyllning (transparent, endast linje)',
    'Qtiler2Origo.wfs_no_stroke': 'Ingen linje',
    'Qtiler2Origo.wfs_radius': 'Radie',
    'Qtiler2Origo.wfs_fill_color': 'Fyllningsfärg',
    'Qtiler2Origo.wfs_fill_opacity': 'Fyllning opacitet',
    'Qtiler2Origo.wfs_fill_pattern': 'Fyllningsmönster',
    'Qtiler2Origo.wfs_fill_pattern_angle': 'Mönstervinkel',
    'Qtiler2Origo.wfs_fill_pattern_spacing': 'Mönsteravstånd',
    'Qtiler2Origo.wfs_fill_pattern_size': 'Punktstorlek',
    'Qtiler2Origo.wfs_fill_pattern_transparent': 'Transparent bakgrund',
    'Qtiler2Origo.wfs_fill_pattern_transparent_help': 'Visa bara linjer eller punkter så att lager under fortfarande syns.',
    'Qtiler2Origo.wfs_fill_pattern_solid': 'Heldragen',
    'Qtiler2Origo.wfs_fill_pattern_slash': 'Snedstreck',
    'Qtiler2Origo.wfs_fill_pattern_backslash': 'Omvänt snedstreck',
    'Qtiler2Origo.wfs_fill_pattern_horizontal': 'Horisontella linjer',
    'Qtiler2Origo.wfs_fill_pattern_vertical': 'Vertikala linjer',
    'Qtiler2Origo.wfs_fill_pattern_dots': 'Punkter',
    'Qtiler2Origo.wfs_fill_pattern_outline': 'Endast kontur',
    'Qtiler2Origo.wfs_stroke_color': 'Linjefärg',
    'Qtiler2Origo.wfs_stroke_width': 'Linjebredd',
    'Qtiler2Origo.wfs_stroke_opacity': 'Linje opacitet',
    'Qtiler2Origo.wfs_stroke_pattern': 'Linjemönster',
    'Qtiler2Origo.wfs_pick_svg': 'Välj SVG…',
    'Qtiler2Origo.wfs_url': 'URL/sökväg',
    'Qtiler2Origo.wfs_scale_field': 'Skala',
    'Qtiler2Origo.wfs_opacity': 'Opacitet',
    'Qtiler2Origo.wfs_tint_color': 'Töningsfärg',
    'Qtiler2Origo.wfs_enable_svg_tint': 'Aktivera SVG-töning',
    'Qtiler2Origo.wfs_color': 'Färg',
    'Qtiler2Origo.wfs_width': 'Bredd',
    'Qtiler2Origo.wfs_pattern': 'Mönster',
    'Qtiler2Origo.wfs_solid': 'Heldragen',
    'Qtiler2Origo.wfs_dashed': 'Streckad',
    'Qtiler2Origo.wfs_dotted': 'Prickad',
    'Qtiler2Origo.wfs_dashdot': 'Streck-prick',
    'Qtiler2Origo.wfs_visible_from': 'Synlig från skala 1:',
    'Qtiler2Origo.wfs_visible_to': 'Synlig upp till skala 1:',
    'Qtiler2Origo.wfs_visible_from_tip': 'Minsta skala där symbolen syns (nämnare, t.ex. 1000)',
    'Qtiler2Origo.wfs_visible_to_tip': 'Största skala där symbolen syns (nämnare, t.ex. 50000)',
    'Qtiler2Origo.wfs_no_limit': 'ingen gräns',
    'Qtiler2Origo.wfs_label': 'Etikett',
    'Qtiler2Origo.wfs_text_help': 'Text (använd {{fält}} för att infoga värden)',
    'Qtiler2Origo.wfs_text_placeholder': 'T.ex. {{name}} eller fast text',
    'Qtiler2Origo.wfs_insert_field': 'Infoga fält',
    'Qtiler2Origo.wfs_size': 'Storlek',
    'Qtiler2Origo.wfs_label_placement': 'Placering',
    'Qtiler2Origo.wfs_label_placement_point': 'Ovanför punkt',
    'Qtiler2Origo.wfs_label_placement_line': 'Följ linje',
    'Qtiler2Origo.wfs_label_offsetx': 'Förskjutning X (px)',
    'Qtiler2Origo.wfs_label_offsety': 'Förskjutning Y (px)',
    'Qtiler2Origo.wfs_label_from': 'Etikett från 1:',
    'Qtiler2Origo.wfs_label_to': 'Etikett upp till 1:',
    'Qtiler2Origo.wfs_label_from_tip': 'Minsta skala där etiketten syns',
    'Qtiler2Origo.wfs_label_to_tip': 'Största skala där etiketten syns',
    'Qtiler2Origo.step_controls': '3. Kartkontroller',
    'Qtiler2Origo.step_controls_help': 'Välj verktygen som ska visas i kartvisaren. Klicka på kugghjulsikonen bredvid en kontroll för att konfigurera dess alternativ.',
    'Qtiler2Origo.cfg_btn_title': 'Konfigurera alternativ',
    'Qtiler2Origo.cfg_invalid_json': 'Ogiltig JSON',
    'Qtiler2Origo.opt_zoomOnStart': 'Zooma vid start',
    'Qtiler2Origo.opt_isActive': 'Öppen som standard',
    'Qtiler2Origo.opt_useGroupIndication': 'Gruppindikation',
    'Qtiler2Origo.opt_expanded': 'Expanderad',
    'Qtiler2Origo.opt_url': 'Tjänst-URL',
    'Qtiler2Origo.opt_limit': 'Resultatgräns',
    'Qtiler2Origo.opt_hintText': 'Platshållartext',
    'Qtiler2Origo.opt_minLength': 'Min. tecken',
    'Qtiler2Origo.opt_tracking': 'Automatisk positionering',
    'Qtiler2Origo.opt_enableHighAccuracy': 'Hög precision',
    'Qtiler2Origo.opt_default': 'Standardverktyg',
    'Qtiler2Origo.opt_tools': 'Verktyg (kommaseparerade)',
    'Qtiler2Origo.opt_title': 'Titel',
    'Qtiler2Origo.opt_projections_json': 'Projektioner (JSON)',
    'Qtiler2Origo.opt_logo': 'Logotyp-URL',
    'Qtiler2Origo.opt_northArrow': 'Visa nordpil',
    'Qtiler2Origo.opt_scales': 'Skalor (kommaseparerade)',
    'Qtiler2Origo.opt_attribution': 'Upphovsrättstext',
    'Qtiler2Origo.opt_buttonText': 'Knappetikett',
    'Qtiler2Origo.opt_content': 'Innehåll (HTML)',
    'Qtiler2Origo.wfs_style_yes': 'WFS stil',
    'Qtiler2Origo.wfs_style_no': 'Konfig. stil',
    'Qtiler2Origo.wfs_saved': 'Sparat.',
    'Qtiler2Origo.wfs_invalid_json': 'Ogiltig JSON: ',
    'Qtiler2Origo.wfs_invalid_json_apply': 'Kunde inte tillämpa JSON: ',
    'Qtiler2Origo.wfs_reset_confirm': 'Den nuvarande stilen för lagret går förlorad och standardstilen återställs. Fortsätta?',
    'Qtiler2Origo.zoom_warn': 'Obs: Min Zoom ({min}) är större än Max Zoom ({max}). Min = längst bort (låg), Max = närmast (hög).',
    'Qtiler2Origo.fam_point': 'Punkt',
    'Qtiler2Origo.fam_line': 'Linje',
    'Qtiler2Origo.fam_polygon': 'Polygon',
    'Qtiler2Origo.no_rules_yet': 'Inga regler än.',
    'Qtiler2Origo.loading_style': 'Laddar upptäckt stil från QGIS…',
    'Qtiler2Origo.install_origo2': 'Installera Origo-map',
    'Qtiler2Origo.uninstall_origo2': 'Avinstallera Origo-map',
    'Qtiler2Origo.attr_options_ph': 'En alternativ per rad',
    'Qtiler2Origo.attr_title_ph': 'Visningstitel',
    'Qtiler2Origo.pub_groups_legend': 'Grupper & synlighet',
    'Qtiler2Origo.pub_groups_help': 'Definiera grupper (och undergrupper) och tilldela varje synligt lager till gruppen där det visas i kartans träd.',
    'Qtiler2Origo.pub_groups_label': 'Grupper',
    'Qtiler2Origo.pub_add_group': '+ Lägg till grupp',
    'Qtiler2Origo.pub_layer_assign_label': 'Lager → grupp + initial synlighet',
    'Qtiler2Origo.pub_layer_assign_help': 'Endast lager kryssade i steg 1 visas här.',
    'Qtiler2Origo.pub_no_groups': 'Inga anpassade grupper. Lagren hamnar i standardgruppen.',
    'Qtiler2Origo.pub_no_parent': '(ingen förälder)',
    'Qtiler2Origo.pub_group_name_ph': 'tekniskt namn',
    'Qtiler2Origo.pub_group_title_ph': 'synlig titel',
    'Qtiler2Origo.pub_assign_help': 'Kryssa lager i steg 1 för att tilldela dem.',
    'Qtiler2Origo.pub_search_legend': 'Sökalternativ',
    'Qtiler2Origo.pub_search_hint_label': 'Föreslagen text',
    'Qtiler2Origo.pub_search_min_label': 'Minsta antal tecken',
    'Qtiler2Origo.pub_search_limit_label': 'Max antal resultat',
    'Qtiler2Origo.pub_search_placeholder': 'Sök…',
    'Qtiler2Origo.pub_search_sources_label': 'Sökkällor mellan projekt',
    'Qtiler2Origo.pub_search_sources_help': 'Lägg till fler projekt (och välj specifika sökbara lager) så att sökrutan i den publicerade kartan kan hitta objekt från dessa projekt också. Användaren måste ha åtkomst till varje projekt för att se dess resultat.',
    'Qtiler2Origo.pub_search_source_add': 'Lägg till projekt',
    'Qtiler2Origo.pub_search_source_pick_project': '— Välj projekt —',
    'Qtiler2Origo.pub_search_source_layers': 'Lager',
    'Qtiler2Origo.pub_search_source_all_layers': 'Alla sökbara lager',
    'Qtiler2Origo.pub_search_source_no_layers': 'Inga sökbara lager konfigurerade för detta projekt.',
    'Qtiler2Origo.pub_search_source_remove': 'Ta bort',
    'Qtiler2Origo.pub_search_source_current': 'Aktuellt projekt',
    'Qtiler2Origo.pub_edit_profile_title': 'Redigera namn, lager, bakgrunder, grupper och verktyg',
    'Qtiler2Origo.hiw.button': 'Så fungerar det & säkerhet',
    'Qtiler2Origo.hiw.title': 'Så fungerar Qtiler2Origo och varför det är säkert',
    'Qtiler2Origo.hiw.lead': 'Qtiler2Origo bäddar in webbkartvyn Origo i Qtiler. Det laddar ner Origo från en GitHub-release, låter dig skapa och konfigurera varje karta grafiskt via QGIS-biblioteket och återanvänder Qtilers cache samt WMS/WFS-lagren från projekt som publicerats i Qtiler.',
    'Qtiler2Origo.hiw.vs.title': 'Qrigo vs Qtiler2Origo',
    'Qtiler2Origo.hiw.vs.1': 'Qrigo riktar sig till användare som redan kör en standardinstallation av Origo-map på sin egen server: det genererar bara JSON-utdrag att klistra in i din befintliga Origo index.json.',
    'Qtiler2Origo.hiw.vs.2': 'Qtiler2Origo installerar Origo ovanpå själva Qtiler, med en grafisk kartredigerare som stödjer sig på QGIS-biblioteket och Qtilers cache och WMS/WFS-lager — utan en separat Origo-server.',
    'Qtiler2Origo.hiw.arch.title': '1. Arkitektur',
    'Qtiler2Origo.hiw.arch.1': 'Express-plugin under plugins/Qtiler2Origo/. Origo-bygget laddas ner från GitHub och serveras på /plugins/Qtiler2Origo/origo.',
    'Qtiler2Origo.hiw.arch.2': 'Varje karta sparas som JSON under data/Qtiler2Origo/maps/ och laddas om på plats vid varje ändring — ingen omstart krävs.',
    'Qtiler2Origo.hiw.arch.3': 'Det publika aliaset /Qtiler2Origo/maps/<namn> skrivs om till Origos interna mount så samma URL fungerar bakom omvänd proxy.',
    'Qtiler2Origo.hiw.flow.title': '2. Steg för steg',
    'Qtiler2Origo.hiw.flow.1': 'Setup-fliken: välj en GitHub-tagg och klicka Installera Origo-map.',
    'Qtiler2Origo.hiw.flow.2': 'Maps-fliken: välj ett projekt publicerat i Qtiler och redigera kartan grafiskt (CRS, centrum, zoom, lager, bakgrunder, verktyg).',
    'Qtiler2Origo.hiw.flow.3': 'Klicka Publicera — kartan blir tillgänglig på /plugins/Qtiler2Origo/origo/?map=<namn> och via det publika aliaset /Qtiler2Origo/maps/<namn>.',
    'Qtiler2Origo.hiw.flow.4': 'Ladda upp en logotyp och välj verktygsfältets kontroller (sök, mät, rita, skriv ut, …).',
    'Qtiler2Origo.hiw.maps.title': '3. Kartor och QGIS-biblioteket',
    'Qtiler2Origo.hiw.maps.1': 'Kartor byggs direkt från QGIS-projekt: lager, stilar, skalor och CRS kommer från projektet på disk.',
    'Qtiler2Origo.hiw.maps.2': 'Standard-WMTS-bakgrund garanteras så varje karta har ett fungerande baslager.',
    'Qtiler2Origo.hiw.maps.3': 'Bokmärken, utskriftslayouter och teman exponeras automatiskt per karta.',
    'Qtiler2Origo.hiw.wfs.title': '4. WFS-redigering och cache-återanvändning',
    'Qtiler2Origo.hiw.wfs.1': 'Redigerbara WFS-lager återanvänder Qtilers WFS-endpoint, inklusive multipart-redigering och redigering av befintliga objekt via id.',
    'Qtiler2Origo.hiw.wfs.2': 'Tile- och vector tile-cache som genereras av Qtiler serveras som bakgrunds- och overlay-lager utan ny tiling.',
    'Qtiler2Origo.hiw.auth.title': '5. Autentisering och synlighet',
    'Qtiler2Origo.hiw.auth.1': 'QtilerAuth ACL:er (public / authenticated / private) gäller för varje karta och för katalog-endpointen.',
    'Qtiler2Origo.hiw.auth.2': 'Både cookie-sessioner och ?api_key=/x-api-key-headers stöds för QGIS Desktop och externa integrationer.',
    'Qtiler2Origo.hiw.auth.3': 'Miljövariabel-precedens för standalone-porten respekteras så plugin beter sig konsekvent bakom IIS eller NGINX.',
    'Qtiler2Origo.hiw.security.title': '6. Säkerhet och integritet',
    'Qtiler2Origo.hiw.security.1': 'Nätverksanrop sker endast mot GitHub vid installation och mot QtilerAuth för ACL-kontroller; ingen körtidstelemetri.',
    'Qtiler2Origo.hiw.security.2': 'Adminhandlingar (installera/avinstallera, branding, publicera/redigera/radera kartor) kräver en autentiserad adminanvändare.',
    'Qtiler2Origo.hiw.security.3': 'Öppen källkod under MPL-2.0; granskbart i plugins/Qtiler2Origo/.'
  }
};
QTWC_I18N.no = QTWC_I18N.sv;
QTWC_I18N.nb = QTWC_I18N.sv;
QTWC_I18N.nn = QTWC_I18N.sv;

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
const publishModalToggleFullscreen = document.getElementById('publishModalToggleFullscreen');
const publishModalTabButtons = Array.from(document.querySelectorAll('[data-publish-tab]'));
const publishModalPanels = Array.from(document.querySelectorAll('[data-publish-panel]'));
const publishNowBtn = document.getElementById('publishNowBtn');
const removeDemoBtn = document.getElementById('removeDemoBtn');
const publishName = document.getElementById('publishName');
const publishDescription = document.getElementById('publishDescription');
const publishNameError = document.getElementById('publishNameError');
const publishStatusError = document.getElementById('publishStatusError');
const publishProjectSelect = document.getElementById('publishProjectSelect');
const backgroundProjectSelect = document.getElementById('backgroundProjectSelect');
const projectLayersList = document.getElementById('projectLayersList');
const backgroundLayersList = document.getElementById('backgroundLayersList');
const defaultBackgroundList = document.getElementById('defaultBackgroundList');
const publishLayersDynamicSlot = document.getElementById('publishLayersDynamicSlot');
const publishToolsDynamicSlot = document.getElementById('publishToolsDynamicSlot');
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
const wfsStyleModal = document.getElementById('wfs-style-modal');
const wfsStyleLayerTitle = document.getElementById('wfs-style-layer-title');
const wfsStyleGeometryBadge = document.getElementById('wfs-style-geometry-badge');
const wfsStyleFullscreenBtn = document.getElementById('wfs-style-fullscreen');
const wfsStylePreview = document.getElementById('wfs-style-preview');
const wfsStylePresets = document.getElementById('wfs-style-presets');
const wfsStylePresetsSection = document.getElementById('wfs-style-presets-section');
const wfsStylePresetsSelect = document.getElementById('wfs-style-presets-select');
const wfsStylePresetsApply = document.getElementById('wfs-style-presets-apply');
const wfsRuleEditorModal = document.getElementById('wfs-rule-editor-modal');
const wfsRuleEditorHost = document.getElementById('wfs-rule-editor-host');
const wfsRuleEditorTitle = document.getElementById('wfs-rule-editor-title');
const wfsRuleEditorFullscreenBtn = document.getElementById('wfs-rule-editor-fullscreen');
const wfsStyleRuleModeNote = document.getElementById('wfs-style-rule-mode-note');
const wfsStyleTabButtons = Array.from(document.querySelectorAll('[data-style-tab]'));
const wfsStylePanels = Array.from(document.querySelectorAll('[data-style-panel]'));
const wfsStyleJsonEditor = document.getElementById('wfs-style-json-editor');
const wfsStyleError = document.getElementById('wfs-style-error');
const wfsStyleShape = document.getElementById('wfsStyleShape');
const wfsStyleShapeWrap = document.getElementById('wfsStyleShapeWrap');
const wfsStyleFillColor = document.getElementById('wfsStyleFillColor');
const wfsStyleFillColorWrap = document.getElementById('wfsStyleFillColorWrap');
const wfsStyleFillOpacity = document.getElementById('wfsStyleFillOpacity');
const wfsStyleFillOpacityWrap = document.getElementById('wfsStyleFillOpacityWrap');
const wfsStyleFillPattern = document.getElementById('wfsStyleFillPattern');
const wfsStyleFillPatternWrap = document.getElementById('wfsStyleFillPatternWrap');
const wfsStylePatternAngle = document.getElementById('wfsStylePatternAngle');
const wfsStylePatternAngleWrap = document.getElementById('wfsStylePatternAngleWrap');
const wfsStylePatternSpacing = document.getElementById('wfsStylePatternSpacing');
const wfsStylePatternSpacingWrap = document.getElementById('wfsStylePatternSpacingWrap');
const wfsStylePatternSize = document.getElementById('wfsStylePatternSize');
const wfsStylePatternSizeWrap = document.getElementById('wfsStylePatternSizeWrap');
const wfsStylePatternTransparent = document.getElementById('wfsStylePatternTransparent');
const wfsStylePatternTransparentWrap = document.getElementById('wfsStylePatternTransparentWrap');
const wfsStyleStrokeColor = document.getElementById('wfsStyleStrokeColor');
const wfsStyleStrokeOpacity = document.getElementById('wfsStyleStrokeOpacity');
const wfsStyleStrokeWidth = document.getElementById('wfsStyleStrokeWidth');
const wfsStyleRadius = document.getElementById('wfsStyleRadius');
const wfsStyleRadiusWrap = document.getElementById('wfsStyleRadiusWrap');
const wfsStyleDash = document.getElementById('wfsStyleDash');
const wfsStyleResetBtn = document.getElementById('wfs-style-reset');
const wfsStyleApplyJsonBtn = document.getElementById('wfs-style-apply-json');
const wfsStyleCopySelect = document.getElementById('wfs-style-copy-select');

/* ── Origo preview & config panel ── */
const controlsJsonInput = document.getElementById('origo-cfg-controls');
const extraJsonInput     = document.getElementById('origo-cfg-extra');
const zoomInput          = document.getElementById('origo-cfg-zoom');
const centerInput        = document.getElementById('origo-cfg-center');
const extentInput        = document.getElementById('origo-cfg-extent');
const minZoomInput       = document.getElementById('origo-cfg-min-zoom');
const maxZoomInput       = document.getElementById('origo-cfg-max-zoom');
const previewIframe      = document.getElementById('origo-preview-iframe');
const previewOverlay     = document.getElementById('origo-preview-overlay');
const previewOverlayTitle = document.getElementById('origo-preview-overlay-title');
const previewOverlayMessage = document.getElementById('origo-preview-overlay-message');
const openPreviewTabBtn  = document.getElementById('btn-open-map-preview-tab');
const origoConfigSummary = document.getElementById('origo-config-summary');

/* Map of configurable tools: checkbox id → config panel + input */
const TOOL_CONFIG_MAP = {
  featureShare: { panel: document.querySelector('[data-config-for="featureShare"]'), input: cfgShareUrl, key: 'shareServiceUrl' },
  featureRouting: { panel: document.querySelector('[data-config-for="featureRouting"]'), input: cfgRoutingUrl, key: 'routingServiceUrl' },
  featureHeightProfile: { panel: document.querySelector('[data-config-for="featureHeightProfile"]'), input: cfgElevationUrl, key: 'elevationServiceUrl' },
  featureDxfExport: { panel: document.querySelector('[data-config-for="featureDxfExport"]'), input: cfgDxfUrl, key: 'dxfExportServiceUrl' }
};

/* ── Origo controls: full list of available controls ── */
const ORIGO_CTRL_DEFS = [
  // Navigation
  { id: 'ctrl-home',        name: 'home',        options: { zoomOnStart: true }, labelKey: 'Qtiler2Origo.ctrl_home' },
  { id: 'ctrl-zoom',        name: 'zoom',        options: null,                  labelKey: 'Qtiler2Origo.ctrl_zoom' },
  { id: 'ctrl-rotate',      name: 'rotate',      options: null,                  labelKey: 'Qtiler2Origo.ctrl_rotate' },
  { id: 'ctrl-fullscreen',  name: 'fullscreen',  options: null,                  labelKey: 'Qtiler2Origo.ctrl_fullscreen' },
  { id: 'ctrl-geoposition', name: 'geoposition', options: null,                  labelKey: 'Qtiler2Origo.ctrl_geoposition' },
  // Layers & legend
  { id: 'ctrl-mapmenu',     name: 'mapmenu',     options: { isActive: false },   labelKey: 'Qtiler2Origo.ctrl_mapmenu' },
  { id: 'ctrl-legend',      name: 'legend',      options: { useGroupIndication: true }, labelKey: 'Qtiler2Origo.ctrl_legend' },
  // Search
  { id: 'ctrl-search',      name: 'search',      options: null,                  labelKey: 'Qtiler2Origo.ctrl_search' },
  // Editing
  { id: 'ctrl-editor',      name: 'editor',      options: null,                  labelKey: 'Qtiler2Origo.ctrl_editor' },
  { id: 'ctrl-draw',        name: 'draw',        options: null,                  labelKey: 'Qtiler2Origo.ctrl_draw' },
  // Analysis
  { id: 'ctrl-measure',     name: 'measure',     options: null,                  labelKey: 'Qtiler2Origo.ctrl_measure' },
  { id: 'ctrl-position',    name: 'position',    options: null,                  labelKey: 'Qtiler2Origo.ctrl_position' },
  // Print
  { id: 'ctrl-print',       name: 'print',       options: null,                  labelKey: 'Qtiler2Origo.ctrl_print' },
  // Share & status
  { id: 'ctrl-sharemap',    name: 'sharemap',    options: null,                  labelKey: 'Qtiler2Origo.ctrl_sharemap' },
  { id: 'ctrl-progressbar', name: 'progressbar', options: null,                  labelKey: 'Qtiler2Origo.ctrl_progressbar' },
  { id: 'ctrl-scaleline',   name: 'scaleline',   options: null,                  labelKey: 'Qtiler2Origo.ctrl_scaleline' },
  { id: 'ctrl-attribution', name: 'attribution', options: null,                  labelKey: 'Qtiler2Origo.ctrl_attribution' },
  { id: 'ctrl-about',       name: 'about',       options: null,                  labelKey: 'Qtiler2Origo.ctrl_about' },
  // Extras (documented in Origo controls reference)
  { id: 'ctrl-bookmarks',   name: 'bookmarks',   options: null,                  labelKey: 'Qtiler2Origo.ctrl_bookmarks',   label: 'Bookmarks' },
  { id: 'ctrl-draganddrop', name: 'draganddrop', options: null,                  labelKey: 'Qtiler2Origo.ctrl_draganddrop', label: 'Drag & drop' },
  { id: 'ctrl-externalurl', name: 'externalurl', options: null,                  labelKey: 'Qtiler2Origo.ctrl_externalurl', label: 'External URL' },
  { id: 'ctrl-link',        name: 'link',        options: null,                  labelKey: 'Qtiler2Origo.ctrl_link',        label: 'Link' },
  { id: 'ctrl-splash',      name: 'splash',      options: null,                  labelKey: 'Qtiler2Origo.ctrl_splash',      label: 'Splash' },
  { id: 'ctrl-scale',       name: 'scale',       options: null,                  labelKey: 'Qtiler2Origo.ctrl_scale',       label: 'Scale (text)' },
  { id: 'ctrl-scalepicker', name: 'scalepicker', options: null,                  labelKey: 'Qtiler2Origo.ctrl_scalepicker', label: 'Scale picker' }
];

/** Build the Origo controls array from the current checkbox states and write to the JSON textarea. */
function syncControlsFromCheckboxes() {
  if (!controlsJsonInput) return;
  publishState.controlsOptions = publishState.controlsOptions || {};
  const selected = ORIGO_CTRL_DEFS
    .filter((def) => document.getElementById(def.id)?.checked)
    .map((def) => {
      // Per-control overrides from the inline configurator take precedence.
      const userOpts = publishState.controlsOptions[def.name];
      const baseOpts = def.options || null;
      const merged = (userOpts && typeof userOpts === 'object')
        ? { ...(baseOpts || {}), ...userOpts }
        : baseOpts;
      return merged ? { name: def.name, options: merged } : { name: def.name };
    });
  controlsJsonInput.value = JSON.stringify(selected, null, 2);
  try { renderPublishConfigSummary(); } catch {}
  try { schedulePreviewRefresh(); } catch {}
}

/** Set checkboxes from a saved Origo controls array. */
function syncCheckboxesFromControls(controlsArray) {
  if (!Array.isArray(controlsArray)) return;
  publishState.controlsOptions = publishState.controlsOptions || {};
  const activeNames = new Set();
  controlsArray.forEach((c) => {
    if (typeof c === 'string') {
      activeNames.add(c);
    } else if (c && typeof c === 'object' && c.name) {
      activeNames.add(c.name);
      if (c.options && typeof c.options === 'object') {
        publishState.controlsOptions[c.name] = c.options;
      }
    }
  });
  ORIGO_CTRL_DEFS.forEach((def) => {
    const cb = document.getElementById(def.id);
    if (cb) cb.checked = activeNames.has(def.name);
  });
  // Re-render the inline configurator panels so saved options become visible.
  if (typeof renderControlConfigPanels === 'function') renderControlConfigPanels();
  try { renderPublishConfigSummary(); } catch {}
}

let activePublishTab = 'layers';

function getNormalizedControlsArray() {
  const deduped = new Map();
  let parsed = [];
  try {
    parsed = JSON.parse(String(controlsJsonInput?.value || '[]'));
  } catch {
    parsed = [];
  }
  if (Array.isArray(parsed)) {
    parsed.forEach((entry) => {
      if (typeof entry === 'string' && entry.trim()) {
        deduped.set(entry.trim(), { name: entry.trim() });
      } else if (entry && typeof entry === 'object' && String(entry.name || '').trim()) {
        const name = String(entry.name || '').trim();
        const normalized = { name };
        if (entry.options && typeof entry.options === 'object' && !Array.isArray(entry.options)) {
          normalized.options = entry.options;
        }
        deduped.set(name, normalized);
      }
    });
  }
  if (!deduped.size) {
    ORIGO_CTRL_DEFS
      .filter((def) => document.getElementById(def.id)?.checked)
      .forEach((def) => {
        const userOpts = publishState.controlsOptions?.[def.name];
        const baseOpts = def.options || null;
        const merged = (userOpts && typeof userOpts === 'object')
          ? { ...(baseOpts || {}), ...userOpts }
          : baseOpts;
        deduped.set(def.name, merged ? { name: def.name, options: merged } : { name: def.name });
      });
  }
  return Array.from(deduped.values());
}

function getControlDisplayName(name) {
  const def = ORIGO_CTRL_DEFS.find((item) => item.name === name);
  if (!def) return name;
  if (def.labelKey) return t(def.labelKey) || def.label || name;
  return def.label || name;
}

function updatePublishModalFullscreenButton() {
  if (!publishModalToggleFullscreen || !publishModal) return;
  const isFullscreen = publishModal.classList.contains('publish-editor--fullscreen');
  publishModalToggleFullscreen.textContent = isFullscreen ? 'Windowed' : 'Full screen';
  publishModalToggleFullscreen.setAttribute('aria-pressed', isFullscreen ? 'true' : 'false');
}

function renderPublishConfigSummary() {
  if (!origoConfigSummary) return;
  const mainProjectId = String(publishProjectSelect?.value || '').trim();
  const mainProjectLabel = publishProjectSelect?.selectedOptions?.[0]?.textContent?.trim() || mainProjectId || 'Not selected';
  const activeLayerKeys = getCheckedLayerNames(projectLayersList);
  const allLayers = getAllPublishLayers();
  const activeLayers = activeLayerKeys
    .map((key) => allLayers.find((layer) => getLayerKey(layer) === key))
    .filter(Boolean);
  const activeBackgroundLayers = getCheckedLayers(backgroundLayersList, publishState.backgroundLayers || []);
  const defaultBackground = (publishState.backgroundOptions || []).find((item) => item.key === publishState.defaultBackgroundKey) || null;
  const controls = getNormalizedControlsArray();
  const mapCenter = String(centerInput?.value || '').trim();
  const mapExtent = String(extentInput?.value || '').trim();
  const mapZoom = String(zoomInput?.value || '').trim();
  const mapMinZoom = String(minZoomInput?.value || '').trim();
  const mapMaxZoom = String(maxZoomInput?.value || '').trim();
  const layerItems = activeLayers.length
    ? `<ul class="publish-editor__summary-list">${activeLayers.map((layer) => `<li>${escapeHtml(layer.name)}${layer.sourceProjectId && layer.sourceProjectId !== mainProjectId ? ` <span style="color:#64748b">[${escapeHtml(layer.sourceProjectId)}]</span>` : ''}</li>`).join('')}</ul>`
    : `<p class="publish-editor__summary-empty">No active layers selected yet.</p>`;
  const backgroundItems = activeBackgroundLayers.length
    ? `<ul class="publish-editor__summary-list">${activeBackgroundLayers.map((layer) => `<li>${escapeHtml(layer.name)}</li>`).join('')}</ul>`
    : `<p class="publish-editor__summary-empty">No background layers selected.</p>`;
  const controlItems = controls.length
    ? `<ul class="publish-editor__summary-list">${controls.map((ctrl) => `<li>${escapeHtml(getControlDisplayName(ctrl.name))}</li>`).join('')}</ul>`
    : `<p class="publish-editor__summary-empty">No active controls configured.</p>`;
  origoConfigSummary.innerHTML = `
    <section class="publish-editor__summary-card">
      <h4>Current map</h4>
      <div class="publish-editor__summary-meta">
        <div><strong>Name:</strong> ${escapeHtml(String(publishName?.value || '').trim() || 'Untitled map')}</div>
        <div><strong>Main project:</strong> ${escapeHtml(mainProjectLabel)}</div>
        <div><strong>Description:</strong> ${escapeHtml(String(publishDescription?.value || '').trim() || 'No description')}</div>
      </div>
    </section>
    <section class="publish-editor__summary-card">
      <h4>Active layers (${activeLayers.length})</h4>
      ${layerItems}
    </section>
    <section class="publish-editor__summary-card">
      <h4>Backgrounds</h4>
      <div class="publish-editor__summary-meta">
        <div><strong>Default:</strong> ${escapeHtml(defaultBackground?.title || 'OpenStreetMap / none')}</div>
      </div>
      ${backgroundItems}
    </section>
    <section class="publish-editor__summary-card">
      <h4>Controls in preview (${controls.length})</h4>
      ${controlItems}
    </section>
    <section class="publish-editor__summary-card">
      <h4>View state</h4>
      <div class="publish-editor__summary-meta">
        <div><strong>Zoom:</strong> ${escapeHtml(mapZoom || 'Auto')}</div>
        <div><strong>Min / Max:</strong> ${escapeHtml(mapMinZoom || 'default')} / ${escapeHtml(mapMaxZoom || 'default')}</div>
        <div><strong>Center:</strong> ${escapeHtml(mapCenter || 'Auto')}</div>
        <div><strong>Extent:</strong> ${escapeHtml(mapExtent || 'Auto')}</div>
      </div>
    </section>`;
}

function setPublishModalTab(tabId) {
  activePublishTab = String(tabId || 'layers');
  publishModalTabButtons.forEach((button) => {
    const isActive = button.getAttribute('data-publish-tab') === activePublishTab;
    button.classList.toggle('publish-editor__tab-btn--active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  publishModalPanels.forEach((panel) => {
    panel.classList.toggle('publish-editor__tab-panel--active', panel.getAttribute('data-publish-panel') === activePublishTab);
  });
  if (activePublishTab === 'config') {
    renderPublishConfigSummary();
    try {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => { loadMapPreview({ silent: true }).catch(() => {}); });
      });
    } catch {}
  }
}

/* ── Per-control inline configurator ──
   Each control may declare a schema of fields; the UI renders structured
   inputs (checkbox/text/number/textarea) instead of a raw JSON blob. Controls
   without a schema have no ⚙ button. Fields may declare:
     - key:   simple property on the options object, OR
     - path:  dot-notation path for nested options (e.g. 'logo.style.height').
   See https://origo-map.github.io/origo-documentation/latest/#controls
*/
const ORIGO_CTRL_SCHEMAS = {
  home: [
    { key: 'extent', type: 'csv-num', label: 'Extent (minx, miny, maxx, maxy)',
      placeholder: '134966, 6593080, 176372, 6636922' },
    { key: 'hideWhenEmbedded', type: 'bool', label: 'Hide when embedded', defaultValue: false }
  ],
  fullscreen: [
    { key: 'target', type: 'text', label: 'Target container element id' },
    { key: 'hideWhenEmbedded', type: 'bool', label: 'Hide when embedded', defaultValue: false }
  ],
  geoposition: [
    { key: 'active', type: 'bool', label: 'Active on load', defaultValue: false },
    { key: 'panTo', type: 'bool', label: 'Pan to user position', defaultValue: true },
    { key: 'zoomLevel', type: 'number', label: 'Zoom level on locate' },
    { key: 'enableTracking', type: 'bool', label: 'Enable tracking', defaultValue: false },
    { key: 'hideWhenEmbedded', type: 'bool', label: 'Hide when embedded', defaultValue: false }
  ],
  mapmenu: [
    { key: 'isActive', type: 'bool', label: 'Open on load', defaultValue: false },
    { key: 'breakPointSize', type: 'select', label: 'Breakpoint size',
      options: [['', '— default (l) —'], ['xs', 'xs'], ['s', 's'], ['m', 'm'], ['l', 'l']] },
    { key: 'autoHide', type: 'select', label: 'Auto-hide on map click',
      options: [['', '— never —'], ['always', 'always'], ['mobile', 'mobile'], ['never', 'never']] },
    { key: 'hideWhenEmbedded', type: 'bool', label: 'Hide when embedded', defaultValue: false }
  ],
  legend: [
    { key: 'expanded', type: 'bool', label: 'Expanded on load', defaultValue: true },
    { key: 'turnOffLayersControl', type: 'bool', label: 'Turn-off-all-layers button', defaultValue: false },
    { key: 'turnOnLayersControl', type: 'bool', label: 'Turn-on-all-layers button', defaultValue: false },
    { key: 'visibleLayersControl', type: 'bool', label: 'Visible-layers button', defaultValue: false },
    { key: 'visibleLayersViewActive', type: 'bool', label: 'Visible-layers view active', defaultValue: false },
    { key: 'searchLayersControl', type: 'bool', label: 'Search layers in legend', defaultValue: false },
    { key: 'searchLayersMinLength', type: 'number', label: 'Search min length' },
    { key: 'searchLayersLimit', type: 'number', label: 'Search results limit' },
    { key: 'searchLayersPlaceholderText', type: 'text', label: 'Search placeholder text' },
    { key: 'autoHide', type: 'select', label: 'Auto-hide on map click',
      options: [['', '— never —'], ['always', 'always'], ['mobile', 'mobile'], ['never', 'never']] },
    { key: 'labelOpacitySlider', type: 'text', label: 'Opacity slider label' },
    { key: 'hideWhenEmbedded', type: 'bool', label: 'Hide when embedded', defaultValue: false }
  ],
  search: [
    { key: 'url', type: 'text', label: 'Search endpoint URL', placeholder: '/adressok' },
    { key: 'searchAttribute', type: 'text', label: 'Search attribute', placeholder: 'NAMN' },
    { key: 'queryParameterName', type: 'text', label: 'Query parameter name', placeholder: 'q' },
    { key: 'title', type: 'text', label: 'Result title', placeholder: 'Address' },
    { key: 'hintText', type: 'text', label: 'Placeholder text', placeholder: 'Search…' },
    { key: 'limit', type: 'number', label: 'Suggestion limit', placeholder: '9' },
    { key: 'minLength', type: 'number', label: 'Min characters to trigger', placeholder: '4' },
    { key: 'maxZoomLevel', type: 'number', label: 'Max zoom on result' },
    { key: 'geometryAttribute', type: 'text', label: 'Geometry attribute', placeholder: 'GEOM' },
    { key: 'northing', type: 'text', label: 'Northing attribute (option 5)', placeholder: 'N' },
    { key: 'easting', type: 'text', label: 'Easting attribute (option 5)', placeholder: 'E' },
    { key: 'idAttribute', type: 'text', label: 'Id attribute' },
    { key: 'layerNameAttribute', type: 'text', label: 'Layer name attribute' },
    { key: 'layerName', type: 'text', label: 'Layer name (single-layer search)' },
    { key: 'titleAttribute', type: 'text', label: 'Title attribute (option 3)' },
    { key: 'contentAttribute', type: 'text', label: 'Content attribute (option 3)' },
    { key: 'groupSuggestions', type: 'bool', label: 'Group suggestions', defaultValue: false },
    { key: 'includeSearchableLayers', type: 'bool', label: 'Include searchable layers', defaultValue: false },
    { key: 'autocompletePlacement', type: 'select', label: 'Autocomplete placement',
      options: [['', '— search —'], ['search', 'search'], ['left', 'left'], ['floating', 'floating']] },
    { key: 'suppressDialog', type: 'bool', label: 'Suppress popup dialog', defaultValue: false },
    { key: 'hideWhenEmbedded', type: 'bool', label: 'Hide when embedded', defaultValue: false }
  ],
  measure: [
    { key: 'measureTools', type: 'csv', label: 'Measure tools (length, area, elevation, buffer)',
      placeholder: 'length, area' },
    { key: 'default', type: 'select', label: 'Default tool',
      options: [['', '— length —'], ['length', 'length'], ['area', 'area'], ['elevation', 'elevation'], ['buffer', 'buffer']] },
    { key: 'showSegmentLengths', type: 'bool', label: 'Show segment lengths', defaultValue: false },
    { key: 'showSegmentLabelButtonActive', type: 'bool', label: 'Segment label button active', defaultValue: true },
    { key: 'useHectare', type: 'bool', label: 'Use hectare for medium areas', defaultValue: true },
    { key: 'highlightColor', type: 'text', label: 'Highlight color (rgba)', placeholder: 'rgba(133,193,233,0.8)' },
    { key: 'snap', type: 'bool', label: 'Enable snapping', defaultValue: false },
    { key: 'snapIsActive', type: 'bool', label: 'Snap active on load', defaultValue: false },
    { key: 'snapRadius', type: 'number', label: 'Snap radius (px)' },
    { key: 'snapLayers', type: 'csv', label: 'Snap layers (csv)' },
    { key: 'queryable', type: 'bool', label: 'Queryable measure features', defaultValue: false },
    { key: 'elevationServiceURL', type: 'text', label: 'Elevation service URL' },
    { key: 'elevationTargetProjection', type: 'text', label: 'Elevation target projection' },
    { key: 'elevationAttribute', type: 'text', label: 'Elevation attribute path' },
    { key: 'hideWhenEmbedded', type: 'bool', label: 'Hide when embedded', defaultValue: false }
  ],
  position: [
    { key: 'title', type: 'text', label: 'Initial projection alias', placeholder: 'EPSG:3006' },
    { key: 'projections', type: 'json', label: 'Projections (JSON)',
      placeholder: '{ "EPSG:3006": "SWEREF99 TM", "EPSG:4326": "WGS84" }' },
    { key: 'noPositionText', type: 'text', label: 'Text when no position' },
    { key: 'hideWhenEmbedded', type: 'bool', label: 'Hide when embedded', defaultValue: false }
  ],
  print: [
    { key: 'placement', type: 'csv', label: 'Button placement (menu, screen)', placeholder: 'menu, screen' },
    { key: 'leftFooterText', type: 'text', label: 'Left footer text' },
    { key: 'showCreated', type: 'bool', label: 'Show created date (footer right)', defaultValue: false },
    { key: 'createdPrefix', type: 'text', label: 'Created date prefix', placeholder: 'Created ' },
    { key: 'showScale', type: 'bool', label: 'Show scale on print', defaultValue: true },
    { key: 'scales', type: 'csv-num', label: 'Available scales (csv)',
      placeholder: '500, 1000, 5000, 10000, 50000, 100000' },
    { key: 'mapInteractionsActive', type: 'bool', label: 'Map interactions active', defaultValue: false },
    { key: 'suppressNewDPIMethod', type: 'bool', label: 'Suppress new DPI method', defaultValue: false },
    { key: 'supressResolutionsRecalculation', type: 'bool', label: 'Suppress resolutions recalc', defaultValue: false },
    // Logo placement (nested)
    { path: 'logo.src', type: 'text', label: 'Logo: image source path',
      placeholder: '/qtiler/branding/logo  (or  css/png/logo_print.png)' },
    { path: 'logo.cls', type: 'text', label: 'Logo: CSS class (placement)',
      placeholder: 'padding-bottom-small  (e.g. padding-top-small for top)' },
    { path: 'logo.style.height', type: 'text', label: 'Logo: height (CSS)', placeholder: '3rem' },
    { path: 'logo.style.width', type: 'text', label: 'Logo: width (CSS)' },
    // North arrow (nested)
    { path: 'northArrow.visible', type: 'bool', label: 'North arrow visible', defaultValue: true },
    { path: 'northArrow.src', type: 'text', label: 'North arrow: image source',
      placeholder: 'css/png/north_arrow_print.png' },
    { path: 'northArrow.cls', type: 'text', label: 'North arrow: CSS class',
      placeholder: 'padding-right-small printmap-north-arrow' },
    { path: 'northArrow.style.height', type: 'text', label: 'North arrow: height', placeholder: '5rem' },
    { key: 'hideWhenEmbedded', type: 'bool', label: 'Hide when embedded', defaultValue: false }
  ],
  attribution: [
    { key: 'attribution', type: 'text', label: 'Attribution text' }
  ],
  about: [
    { key: 'buttontext', type: 'text', label: 'Menu button text' },
    { key: 'title', type: 'text', label: 'Popup title' },
    { key: 'content', type: 'textarea', label: 'Popup HTML content' },
    { key: 'placement', type: 'csv', label: 'Placement (menu, screen)', placeholder: 'menu' },
    { key: 'style', type: 'select', label: 'Modal style',
      options: [['', '— modal —'], ['modal', 'modal'], ['modal-full', 'modal-full']] },
    { key: 'icon', type: 'text', label: 'Icon id', placeholder: '#ic_help_outline_24px' },
    { key: 'hideWhenEmbedded', type: 'bool', label: 'Hide when embedded', defaultValue: false }
  ],
  bookmarks: [
    { key: 'title', type: 'text', label: 'Panel title', placeholder: 'Bookmarks' },
    { key: 'isActive', type: 'bool', label: 'Open on load', defaultValue: false },
    { key: 'maxZoom', type: 'number', label: 'Default zoom level', placeholder: '15' },
    { key: 'duration', type: 'number', label: 'Animation duration (ms)', placeholder: '300' },
    { key: 'items', type: 'json', label: 'Items (JSON array)',
      placeholder: '[ { "name": "City", "coordinates": [x, y], "zoomLevel": 12 } ]' },
    { key: 'hideWhenEmbedded', type: 'bool', label: 'Hide when embedded', defaultValue: false }
  ],
  draganddrop: [
    { key: 'groupName', type: 'text', label: 'Group name', placeholder: 'egna-lager' },
    { key: 'groupTitle', type: 'text', label: 'Group title', placeholder: 'Egna lager' },
    { key: 'showLegendButton', type: 'bool', label: 'Show add-button in legend', defaultValue: false },
    { key: 'styleByAttribute', type: 'bool', label: 'Style features by attribute', defaultValue: false },
    { key: 'zoomToExtent', type: 'bool', label: 'Allow zoom-to-extent', defaultValue: true },
    { key: 'zoomToExtentOnLoad', type: 'bool', label: 'Zoom to extent on load', defaultValue: true },
    { key: 'featureStyles', type: 'json', label: 'Feature styles (JSON)' },
    { key: 'hideWhenEmbedded', type: 'bool', label: 'Hide when embedded', defaultValue: false }
  ],
  draw: [
    { key: 'buttonText', type: 'text', label: 'Menu button text', placeholder: 'Draw' },
    { key: 'isActive', type: 'bool', label: 'Active on load', defaultValue: false },
    { key: 'placement', type: 'csv', label: 'Placement (menu, screen)', placeholder: 'menu' },
    { key: 'layerTitle', type: 'text', label: 'Layer title', placeholder: 'Drawing' },
    { key: 'groupName', type: 'text', label: 'Group name' },
    { key: 'groupTitle', type: 'text', label: 'Group title' },
    { key: 'multipleLayers', type: 'bool', label: 'Multiple draw layers', defaultValue: false },
    { key: 'queryable', type: 'bool', label: 'Queryable layer', defaultValue: false },
    { key: 'removable', type: 'bool', label: 'Removable layer', defaultValue: true },
    { key: 'exportable', type: 'bool', label: 'Exportable layer', defaultValue: true },
    { key: 'showAttributeButton', type: 'bool', label: 'Show attribute button', defaultValue: false },
    { key: 'showDownloadButton', type: 'bool', label: 'Show download button', defaultValue: false },
    { key: 'showSaveButton', type: 'bool', label: 'Show save button', defaultValue: false },
    { key: 'zoomToExtent', type: 'bool', label: 'Zoom-to-extent button', defaultValue: true },
    { key: 'drawTools', type: 'json', label: 'Extra draw tools (JSON)',
      placeholder: '{ "Polygon": ["freehand", "box"], "LineString": ["freehand"] }' },
    { key: 'extraMarkers', type: 'json', label: 'Extra markers (JSON)' }
  ],
  editor: [
    { key: 'isActive', type: 'bool', label: 'Toolbar open on load', defaultValue: true },
    { key: 'autoSave', type: 'bool', label: 'Auto save edits', defaultValue: true },
    { key: 'autoForm', type: 'bool', label: 'Auto attribute form after draw', defaultValue: false },
    { key: 'snap', type: 'bool', label: 'Snapping enabled', defaultValue: true },
    { key: 'snapTolerance', type: 'number', label: 'Snap tolerance (px)', placeholder: '10' },
    { key: 'trace', type: 'bool', label: 'Tracing enabled', defaultValue: false },
    { key: 'traceStyle', type: 'text', label: 'Trace style name' },
    { key: 'validateOnDraw', type: 'bool', label: 'Validate on draw (no self-intersect)', defaultValue: false },
    { key: 'featureList', type: 'bool', label: 'Show feature list on multi-select', defaultValue: true },
    { key: 'featureListAttributes', type: 'csv', label: 'Feature list attributes (csv)' },
    { key: 'modifyTools', type: 'bool', label: 'Show modify tools', defaultValue: false },
    { key: 'defaultLayer', type: 'text', label: 'Default editable layer' },
    { key: 'editableLayers', type: 'csv', label: 'Editable layers (csv)' },
    { key: 'snapLayers', type: 'csv', label: 'Snap layers (csv)' },
    { key: 'attributes', type: 'json', label: 'Attribute definitions (JSON)' },
    { key: 'drawTools', type: 'json', label: 'Extra draw tools (JSON)' },
    { key: 'hideWhenEmbedded', type: 'bool', label: 'Hide when embedded', defaultValue: false }
  ],
  externalurl: [
    { key: 'tooltipText', type: 'text', label: 'Tooltip text' },
    { key: 'icon', type: 'text', label: 'Icon id', placeholder: '#ic_baseline_link_24px' },
    { key: 'direction', type: 'select', label: 'Subbutton direction',
      options: [['', '— vertical —'], ['vertical', 'vertical'], ['horizontal', 'horizontal']] },
    { key: 'target', type: 'text', label: 'Anchor target', placeholder: '_blank' },
    { key: 'links', type: 'json', label: 'Links (JSON array)',
      placeholder: '[ { "tooltipText": "OSM", "method": "LatLon", "url": "https://…/{{LAT}}/{{LON}}" } ]' },
    { key: 'hideWhenEmbedded', type: 'bool', label: 'Hide when embedded', defaultValue: false }
  ],
  link: [
    { key: 'title', type: 'text', label: 'Link title' },
    { key: 'url', type: 'text', label: 'URL', placeholder: 'https://example.com' },
    { key: 'icon', type: 'text', label: 'Icon id', placeholder: '#ic_launch_24px' },
    { key: 'placement', type: 'csv', label: 'Placement (menu, screen)', placeholder: 'menu' },
    { key: 'hideWhenEmbedded', type: 'bool', label: 'Hide when embedded', defaultValue: false }
  ],
  splash: [
    { key: 'title', type: 'text', label: 'Modal title' },
    { key: 'url', type: 'text', label: 'HTML file URL' },
    { key: 'content', type: 'textarea', label: 'Modal HTML content' },
    { key: 'style', type: 'text', label: 'CSS style', placeholder: 'width: 600px;' },
    { path: 'hideButton.visible', type: 'bool', label: 'Show "don\'t show again" button', defaultValue: false },
    { path: 'hideButton.hideText', type: 'text', label: 'Hide button text' },
    { path: 'hideButton.confirmText', type: 'text', label: 'Confirm text' },
    { key: 'hideWhenEmbedded', type: 'bool', label: 'Hide when embedded', defaultValue: false }
  ],
  scale: [
    { key: 'scaleText', type: 'text', label: 'Prefix text', placeholder: '1:' },
    { key: 'hideWhenEmbedded', type: 'bool', label: 'Hide when embedded', defaultValue: false }
  ],
  scalepicker: [
    { key: 'buttonPrefix', type: 'text', label: 'Button prefix', placeholder: 'Scale: ' },
    { key: 'listItemPrefix', type: 'text', label: 'List item prefix', placeholder: 'Scale: ' },
    { key: 'hideWhenEmbedded', type: 'bool', label: 'Hide when embedded', defaultValue: false }
  ],
  sharemap: [
    { key: 'title', type: 'text', label: 'Menu title', placeholder: 'Share map' },
    { key: 'icon', type: 'text', label: 'Icon id', placeholder: '#ic_screen_share_outline_24px' },
    { key: 'storeMethod', type: 'select', label: 'Store method',
      options: [['', '— url-only —'], ['saveStateToServer', 'saveStateToServer']] },
    { key: 'serviceEndpoint', type: 'text', label: 'Service endpoint URL' },
    { key: 'loadMapStateIdMethod', type: 'select', label: 'Load mapStateId method',
      options: [['', '— path —'], ['path', 'path'], ['query', 'query']] },
    { key: 'hideWhenEmbedded', type: 'bool', label: 'Hide when embedded', defaultValue: false }
  ],
  progressbar: [
    { key: 'hideWhenEmbedded', type: 'bool', label: 'Hide when embedded', defaultValue: false }
  ]
};

/* Dot-path helpers for nested option editing */
function dotGet(obj, path) {
  if (!obj || !path) return undefined;
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function dotSet(obj, path, value) {
  const keys = String(path).split('.');
  const last = keys.pop();
  let cur = obj;
  for (const k of keys) {
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  if (value === undefined) delete cur[last]; else cur[last] = value;
}

/* Read/write a field value into an options object using its schema entry. */
function getFieldValue(opts, field) {
  if (typeof field.get === 'function') return field.get(opts);
  if (field.path) return dotGet(opts, field.path);
  return opts ? opts[field.key] : undefined;
}
function setFieldValue(opts, field, raw) {
  let v = raw;
  switch (field.type) {
    case 'bool':
      v = !!raw; break;
    case 'number':
      if (raw === '' || raw == null) v = undefined;
      else { const n = Number(raw); v = Number.isFinite(n) ? n : undefined; }
      break;
    case 'csv':
      v = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!v.length) v = undefined;
      break;
    case 'csv-num':
      v = String(raw || '').split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n));
      if (!v.length) v = undefined;
      break;
    case 'json':
      if (!String(raw || '').trim()) { v = undefined; break; }
      v = JSON.parse(raw); // throws → caller catches
      break;
    case 'text':
    case 'textarea':
    case 'select':
    default:
      if (raw === '' || raw == null) v = undefined;
      else v = String(raw);
      break;
  }
  if (typeof field.set === 'function') {
    field.set(opts, v);
  } else if (field.path) {
    dotSet(opts, field.path, v);
  } else if (v === undefined) {
    delete opts[field.key];
  } else {
    opts[field.key] = v;
  }
}

/* Resolve a display label for a schema field. Prefers explicit label, falls
   back to translation when present, finally a prettified key/path. */
function fieldLabel(field) {
  if (field.label) return field.label;
  if (field.labelKey && typeof t === 'function') {
    const tr = t(field.labelKey);
    if (tr && tr !== field.labelKey) return tr;
  }
  const raw = field.path || field.key || '';
  return raw.replace(/[._]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}

function renderControlConfigPanels() {
  publishState.controlsOptions = publishState.controlsOptions || {};
  ORIGO_CTRL_DEFS.forEach((def) => {
    const labelEl = document.getElementById(def.id)?.closest('label');
    if (!labelEl || labelEl.dataset.cfgEnhanced) return;
    labelEl.dataset.cfgEnhanced = '1';
    const schema = ORIGO_CTRL_SCHEMAS[def.name];

    const wrapper = document.createElement('div');
    wrapper.className = 'Qtiler2origo-control-row';
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '0.25rem';
    labelEl.parentNode.insertBefore(wrapper, labelEl);
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.gap = '0.4rem';
    wrapper.appendChild(header);
    header.appendChild(labelEl);

    if (!Array.isArray(schema) || schema.length === 0) {
      // No options → no gear button.
      return;
    }

    const cfgBtn = document.createElement('button');
    cfgBtn.type = 'button';
    cfgBtn.className = 'button is-small is-light';
    cfgBtn.textContent = '⚙';
    cfgBtn.setAttribute('data-i18n-title', 'Qtiler2Origo.cfg_btn_title');
    cfgBtn.title = (typeof t === 'function') ? t('Qtiler2Origo.cfg_btn_title') : 'Configure options';
    cfgBtn.style.padding = '0 0.45rem';
    header.appendChild(cfgBtn);

    const panel = document.createElement('div');
    panel.style.display = 'none';
    panel.style.padding = '0.5rem';
    panel.style.background = '#fafafa';
    panel.style.border = '1px solid #ddd';
    panel.style.borderRadius = '4px';
    wrapper.appendChild(panel);

    const err = document.createElement('div');
    err.style.color = '#c00';
    err.style.fontSize = '0.7rem';
    err.style.marginTop = '0.25rem';

    /** Re-render this control's panel from current state. */
    const renderPanelBody = () => {
      panel.innerHTML = '';
      const current = publishState.controlsOptions[def.name] || (def.options ? { ...def.options } : {});
      schema.forEach((field) => {
        // Crea un contenedor horizontal para cada campo
        const row = document.createElement('div');
        row.className = 'q2o-config-row';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '1.2rem';
        row.style.marginBottom = '0.4rem';
        const labelTxt = fieldLabel(field);
        if (field.type === 'bool') {
          // Label a la izquierda, checkbox a la derecha
          const label = document.createElement('label');
          label.style.minWidth = '120px';
          label.style.fontSize = '0.95em';
          label.style.marginRight = '0.5rem';
          label.textContent = labelTxt;
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.style.marginLeft = '0.5rem';
          const v = getFieldValue(current, field);
          cb.checked = (v === undefined ? !!field.defaultValue : !!v);
          cb.addEventListener('change', () => commitField(field, cb.checked));
          row.appendChild(label);
          row.appendChild(cb);
        } else {
          // Label a la izquierda, input a la derecha
          const label = document.createElement('label');
          label.style.minWidth = '120px';
          label.style.fontSize = '0.95em';
          label.style.marginRight = '0.5rem';
          label.textContent = labelTxt;
          let input;
          if (field.type === 'textarea' || field.type === 'json') {
            input = document.createElement('textarea');
            input.className = 'textarea is-small';
            input.rows = field.type === 'json' ? 3 : 4;
            input.style.width = '260px';
          } else if (field.type === 'select') {
            input = document.createElement('div');
            input.className = 'select is-small is-fullwidth';
            const sel = document.createElement('select');
            (field.options || []).forEach(([val, txt]) => {
              const o = document.createElement('option');
              o.value = val; o.textContent = txt;
              sel.appendChild(o);
            });
            input.appendChild(sel);
            input._sel = sel;
          } else {
            input = document.createElement('input');
            input.className = 'input is-small';
            input.type = field.type === 'number' ? 'number' : 'text';
            input.style.width = '220px';
          }
          if (field.placeholder) {
            const target = input._sel || input;
            if ('placeholder' in target) target.placeholder = field.placeholder;
          }
          const v = getFieldValue(current, field);
          const target = input._sel || input;
          if (v !== undefined && v !== null) {
            if (field.type === 'json') target.value = (typeof v === 'string') ? v : JSON.stringify(v, null, 2);
            else if (field.type === 'csv' || field.type === 'csv-num') target.value = Array.isArray(v) ? v.join(', ') : String(v);
            else target.value = String(v);
          }
          target.addEventListener('input', () => commitField(field, target.value));
          if (field.type === 'select') target.addEventListener('change', () => commitField(field, target.value));
          row.appendChild(label);
          row.appendChild(input);
        }
        panel.appendChild(row);
      });
      panel.appendChild(err);
    };

    const commitField = (field, raw) => {
      const opts = publishState.controlsOptions[def.name] || (def.options ? { ...def.options } : {});
      try {
        setFieldValue(opts, field, raw);
        err.textContent = '';
      } catch (e) {
        err.textContent = ((typeof t === 'function') ? t('Qtiler2Origo.cfg_invalid_json') : 'Invalid JSON') + ': ' + e.message;
        return;
      }
      // Drop empty options object so we don't write `{ }` into the published JSON.
      if (Object.keys(opts).length === 0) {
        delete publishState.controlsOptions[def.name];
      } else {
        publishState.controlsOptions[def.name] = opts;
      }
      syncControlsFromCheckboxes();
    };

    cfgBtn.addEventListener('click', () => {
      const open = panel.style.display !== 'none';
      if (open) {
        panel.style.display = 'none';
      } else {
        renderPanelBody();
        panel.style.display = 'block';
      }
    });
  });
}
document.addEventListener('DOMContentLoaded', renderControlConfigPanels);
// Re-render panels when language changes so labels update.
if (typeof window !== 'undefined' && window.qtilerLang && typeof window.qtilerLang.subscribe === 'function') {
  window.qtilerLang.subscribe(() => {
    document.querySelectorAll('.Qtiler2origo-control-row .field').forEach(n => n.remove());
    // Rebuild headers' tooltips
    document.querySelectorAll('.Qtiler2origo-control-row button[data-i18n-title]').forEach((btn) => {
      const k = btn.getAttribute('data-i18n-title');
      btn.title = (typeof t === 'function') ? t(k) : btn.title;
    });
  });
}

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
  // Normalize the case of the plugin namespace prefix so that
  // `data-i18n="qtiler2origo.foo"` (any casing) maps to the canonical
  // `Qtiler2Origo.foo` key in the dictionaries.
  const normalizedKey = String(key || '').replace(/^qtiler2origo\./i, 'Qtiler2Origo.');
  const lang = getLang();
  const dict = QTWC_I18N[lang] || QTWC_I18N.en || {};
  let text = dict[normalizedKey] || (QTWC_I18N.en || {})[normalizedKey] || normalizedKey;
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
  // Update control checkbox labels — only when the def declares a labelKey,
  // otherwise keep the plain text from the HTML (or the def.label fallback).
  ORIGO_CTRL_DEFS.forEach((def) => {
    const span = document.querySelector(`label[for-ctrl="${def.id}"] span, #${def.id}`)?.parentElement?.querySelector('span[data-ctrl-label]');
    if (!span) return;
    if (def.labelKey) {
      const tr = t(def.labelKey);
      if (tr) span.textContent = tr;
    } else if (def.label && !span.textContent.trim()) {
      span.textContent = def.label;
    }
  });
}

if (window.qtilerLang && typeof window.qtilerLang.subscribe === 'function') {
  window.qtilerLang.subscribe(() => { applyI18n(); syncUI(); });
}

/* ── Utilities ── */
function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isVectorGeometry(geometry) {
  const value = String(geometry || '').trim().toLowerCase();
  if (!value) return false;
  if (/(raster|tile|pixel|mesh|dem)/.test(value)) return false;
  return /(point|line|string|polygon|multi|curve|surface|geometry)/.test(value);
}

function getLayerKey(layer) {
  return String(layer?.key || layer?.name || '').trim();
}

function makeLayerKey(projectId, layerName) {
  const pid = String(projectId || '').trim();
  const name = String(layerName || '').trim();
  if (!pid || !name) return name;
  const currentProjectId = String(publishProjectSelect?.value || '').trim();
  return pid === currentProjectId ? name : `${pid}::${name}`;
}

function getAllPublishLayers() {
  return []
    .concat(Array.isArray(publishState.mainLayers) ? publishState.mainLayers : [])
    .concat(Array.isArray(publishState.extraLayers) ? publishState.extraLayers : []);
}

function getSelectedPublishLayers() {
  const selectedKeys = new Set(getCheckedLayerNames(projectLayersList));
  return getAllPublishLayers().filter((layer) => selectedKeys.has(getLayerKey(layer)));
}

function getLayerProjectId(layerName) {
  return String(getMainLayerByName(layerName)?.sourceProjectId || publishProjectSelect?.value || '').trim();
}

function getMainLayerByName(layerName) {
  const key = String(layerName || '').trim();
  return getAllPublishLayers().find((layer) => getLayerKey(layer) === key) || null;
}

function getLayerGeometryType(layerName) {
  const layer = getMainLayerByName(layerName);
  const key = String(layerName || '').trim();
  return String(layer?.geometry || publishState.mainRules?.[key]?.geometryType || '').trim();
}

function geometryFamily(geometryType) {
  const value = String(geometryType || '').toLowerCase();
  if (value.includes('point')) return 'point';
  if (value.includes('line')) return 'line';
  if (value.includes('polygon') || value.includes('surface')) return 'polygon';
  return 'generic';
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function hexToRgb(hex) {
  const value = String(hex || '').trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return { r: 59, g: 130, b: 246 };
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16)
  };
}

function rgbaString(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clampNumber(alpha, 0, 1, 1)})`;
}

function parseColorValue(color, fallbackHex = '#3b82f6', fallbackAlpha = 1) {
  const raw = String(color || '').trim();
  if (!raw) return { hex: fallbackHex, alpha: fallbackAlpha };
  const hexMatch = raw.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) return { hex: `#${hexMatch[1]}`, alpha: 1 };
  const rgbaMatch = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgbaMatch) return { hex: fallbackHex, alpha: fallbackAlpha };
  const parts = rgbaMatch[1].split(',').map((part) => part.trim());
  if (parts.length < 3) return { hex: fallbackHex, alpha: fallbackAlpha };
  const [r, g, b] = parts.slice(0, 3).map((part) => clampNumber(part, 0, 255, 0));
  const alpha = parts[3] == null ? 1 : clampNumber(parts[3], 0, 1, fallbackAlpha);
  const hex = `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
  return { hex, alpha };
}

function dashPatternFromKey(key) {
  switch (String(key || '').trim()) {
    case 'dashed': return [8, 6];
    case 'dotted': return [2, 5];
    case 'dashdot': return [10, 4, 2, 4];
    default: return undefined;
  }
}

function dashKeyFromPattern(pattern) {
  if (!Array.isArray(pattern) || pattern.length === 0) return 'solid';
  const signature = pattern.join(',');
  if (signature === '8,6') return 'dashed';
  if (signature === '2,5') return 'dotted';
  if (signature === '10,4,2,4') return 'dashdot';
  return 'solid';
}

function defaultStyleDefinition(geometryType) {
  const family = geometryFamily(geometryType);
  const rule = {
    stroke: { color: 'rgba(37, 99, 235, 1)', width: 2 }
  };
  if (family === 'polygon' || family === 'generic') {
    rule.fill = { color: 'rgba(59, 130, 246, 0.25)' };
  }
  if (family === 'point' || family === 'generic') {
    rule.circle = {
      radius: 6,
      fill: { color: 'rgba(59, 130, 246, 0.65)' },
      stroke: { color: 'rgba(30, 64, 175, 1)', width: 2 }
    };
  }
  return [[rule]];
}

function qgisColorArrayToRgba(colorValue, opacityMultiplier = 1, fallback = 'rgba(128, 128, 128, 1)') {
  if (!Array.isArray(colorValue) || colorValue.length < 3) return fallback;
  const red = clampNumber(colorValue[0], 0, 255, 128);
  const green = clampNumber(colorValue[1], 0, 255, 128);
  const blue = clampNumber(colorValue[2], 0, 255, 128);
  const alphaBase = colorValue[3] == null ? 1 : clampNumber(Number(colorValue[3]) / 255, 0, 1, 1);
  const alpha = clampNumber(alphaBase * clampNumber(opacityMultiplier, 0, 1, 1), 0, 1, 1);
  return `rgba(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)}, ${alpha})`;
}

function qgisStrokeStyleToLineDash(strokeStyle) {
  const value = String(strokeStyle || '').toLowerCase();
  if (!value || value.includes('solid')) return undefined;
  if (value.includes('dashdot')) return [10, 4, 2, 4];
  if (value.includes('dot')) return [2, 5];
  if (value.includes('dash')) return [8, 6];
  return undefined;
}

function qgisCategoryFilter(attribute, value) {
  const field = String(attribute || '').trim();
  if (!field || value == null || value === '') return '';
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `[${field}] == ${value}`;
  }
  const text = String(value).replace(/'/g, "\\'");
  return `[${field}] == '${text}'`;
}

function qgisSymbolToOrigoRule(symbol, geometryType, filterExpression) {
  if (!symbol || typeof symbol !== 'object') return null;
  const family = geometryFamily(geometryType);
  const opacity = clampNumber(symbol.opacity, 0, 1, 1);
  const strokeWidth = clampNumber(symbol.width != null ? symbol.width : symbol.strokeWidth, 0, 20, family === 'line' ? 2 : 1);
  const strokeColor = qgisColorArrayToRgba(symbol.strokeColor, opacity, qgisColorArrayToRgba(symbol.color, opacity));
  const fillColor = qgisColorArrayToRgba(symbol.color, opacity);
  const geomEntry = {};
  if (filterExpression) geomEntry.filter = filterExpression;

  if (family === 'point') {
    const size = clampNumber(symbol.size, 2, 40, 6);
    geomEntry.circle = {
      radius: clampNumber(size / 2, 2, 24, 6),
      fill: { color: fillColor },
      stroke: { color: strokeColor, width: clampNumber(symbol.strokeWidth, 0, 12, 1) }
    };
  } else if (family === 'line') {
    geomEntry.stroke = {
      color: fillColor,
      width: strokeWidth
    };
    const lineDash = qgisStrokeStyleToLineDash(symbol.strokeStyle);
    if (lineDash) geomEntry.stroke.lineDash = lineDash;
  } else {
    const fillPattern = String(symbol.fillPattern || 'solid').trim() || 'solid';
    if (fillPattern !== 'outline') {
      geomEntry.fill = { color: fillColor };
    }
    geomEntry.stroke = {
      color: strokeColor,
      width: strokeWidth
    };
    const lineDash = qgisStrokeStyleToLineDash(symbol.strokeStyle);
    if (lineDash) geomEntry.stroke.lineDash = lineDash;
  }

  return [geomEntry];
}

function normalizeDetectedLayerStyle(styleDef, geometryType) {
  if (Array.isArray(styleDef)) return styleDef;
  if (!styleDef || typeof styleDef !== 'object') return defaultStyleDefinition(geometryType);

  const looksLikeOrigo = !!(styleDef.fill || styleDef.stroke || styleDef.circle || styleDef.icon || styleDef.regularShape);
  if (looksLikeOrigo) return [[styleDef]];

  const detectedGeometryType = String(styleDef.geometryType || geometryType || '').trim();
  if (styleDef.type === 'singleSymbol' && styleDef.symbol) {
    return qgisSymbolToOrigoRule(styleDef.symbol, detectedGeometryType, '') || defaultStyleDefinition(detectedGeometryType);
  }

  if (styleDef.type === 'categorizedSymbol' && Array.isArray(styleDef.categories)) {
    const rules = [];
    for (const category of styleDef.categories) {
      if (!category || typeof category !== 'object') continue;
      const filterExpression = qgisCategoryFilter(styleDef.attribute, category.value);
      const entry = qgisSymbolToOrigoRule(category.symbol, detectedGeometryType, filterExpression);
      if (entry) rules.push(entry);
    }
    if (styleDef.default && typeof styleDef.default === 'object') {
      const fallbackRule = qgisSymbolToOrigoRule(styleDef.default, detectedGeometryType, '');
      if (fallbackRule) rules.push(fallbackRule);
    }
    return rules.length ? rules : defaultStyleDefinition(detectedGeometryType);
  }

  return defaultStyleDefinition(detectedGeometryType);
}

function unwrapPrimaryStyleRule(styleDef) {
  if (Array.isArray(styleDef) && Array.isArray(styleDef[0]) && styleDef[0][0] && typeof styleDef[0][0] === 'object') {
    return styleDef[0][0];
  }
  if (Array.isArray(styleDef) && styleDef[0] && typeof styleDef[0] === 'object') {
    return styleDef[0];
  }
  return styleDef && typeof styleDef === 'object' ? styleDef : {};
}

function getDesignerFillPattern() {
  const raw = String(wfsStyleFillPattern?.value || 'solid').trim().toLowerCase() || 'solid';
  if (raw === 'diagonal') return 'slash';
  return raw;
}

function setDesignerFillPattern(pattern) {
  if (!wfsStyleFillPattern) return;
  const raw = String(pattern || 'solid').trim().toLowerCase() || 'solid';
  wfsStyleFillPattern.value = raw === 'diagonal' ? 'slash' : raw;
}

function getDefaultDesignerPatternOptions(pattern) {
  switch (String(pattern || '').trim().toLowerCase()) {
    case 'backslash':
      return { angle: 135, spacing: 10, size: 2.5, transparent: false };
    case 'horizontal':
      return { angle: 0, spacing: 10, size: 2.5, transparent: false };
    case 'vertical':
      return { angle: 90, spacing: 10, size: 2.5, transparent: false };
    case 'cross':
      return { angle: 45, spacing: 10, size: 2.5, transparent: false };
    case 'dots':
      return { angle: 0, spacing: 10, size: 2.5, transparent: false };
    case 'slash':
    case 'diagonal':
      return { angle: 45, spacing: 10, size: 2.5, transparent: false };
    default:
      return { angle: 45, spacing: 10, size: 2.5, transparent: false };
  }
}

function getDesignerPatternOptions() {
  const pattern = getDesignerFillPattern();
  const defaults = getDefaultDesignerPatternOptions(pattern);
  return {
    fillPattern: pattern,
    fillPatternAngle: clampNumber(wfsStylePatternAngle?.value, 0, 180, defaults.angle),
    fillPatternSpacing: clampNumber(wfsStylePatternSpacing?.value, 4, 32, defaults.spacing),
    fillPatternSize: clampNumber(wfsStylePatternSize?.value, 1, 12, defaults.size),
    fillPatternTransparent: !!wfsStylePatternTransparent?.checked
  };
}

function applyDesignerPatternOptions(options) {
  const normalizedPattern = String(options?.fillPattern || 'solid').trim().toLowerCase() || 'solid';
  const defaults = getDefaultDesignerPatternOptions(normalizedPattern);
  setDesignerFillPattern(normalizedPattern);
  if (wfsStylePatternAngle) {
    wfsStylePatternAngle.value = String(clampNumber(options?.fillPatternAngle, 0, 180, defaults.angle));
  }
  if (wfsStylePatternSpacing) {
    wfsStylePatternSpacing.value = String(clampNumber(options?.fillPatternSpacing, 4, 32, defaults.spacing));
  }
  if (wfsStylePatternSize) {
    wfsStylePatternSize.value = String(clampNumber(options?.fillPatternSize, 1, 12, defaults.size));
  }
  if (wfsStylePatternTransparent) {
    wfsStylePatternTransparent.checked = options?.fillPatternTransparent === true;
  }
  syncDesignerGeometryFields(getLayerGeometryType(currentEditingWfsLayer));
}

function buildSvgPatternFill(fill, stroke, strokeWidth, designerOptions = null) {
  const pattern = String(designerOptions?.fillPattern || getDesignerFillPattern()).trim().toLowerCase() || 'solid';
  if (pattern === 'outline') return { defs: '', fill: 'rgba(0,0,0,0)' };
  if (pattern === 'solid') return { defs: '', fill };

  const defaults = getDefaultDesignerPatternOptions(pattern);
  const options = designerOptions && typeof designerOptions === 'object'
    ? {
        fillPattern: pattern,
        fillPatternAngle: clampNumber(designerOptions.fillPatternAngle, 0, 180, defaults.angle),
        fillPatternSpacing: clampNumber(designerOptions.fillPatternSpacing, 4, 32, defaults.spacing),
        fillPatternSize: clampNumber(designerOptions.fillPatternSize, 1, 12, defaults.size)
      }
    : getDesignerPatternOptions();
  const spacing = clampNumber(options.fillPatternSpacing, 4, 32, 10);
  const angle = clampNumber(options.fillPatternAngle, 0, 180, defaults.angle);
  const dotSize = clampNumber(options.fillPatternSize, 1, 12, 2.5);
  const patternId = `preview-pattern-${pattern}-${spacing}-${angle}-${dotSize}`.replace(/[^a-z0-9_-]/gi, '-');
  let content = '';

  if (pattern === 'dots') {
    const radius = Math.max(0.8, dotSize);
    content = `<circle cx="${spacing / 2}" cy="${spacing / 2}" r="${radius}" fill="${stroke}" />`;
  } else {
    const lineStrokeWidth = Math.max(0.6, strokeWidth);
    const buildLine = (lineAngle) => `<path d="M ${spacing / 2} -${spacing} L ${spacing / 2} ${spacing * 2}" stroke="${stroke}" stroke-width="${lineStrokeWidth}" stroke-linecap="round" transform="rotate(${lineAngle} ${spacing / 2} ${spacing / 2})" />`;
    if (pattern === 'cross') {
      content = `${buildLine(angle)}${buildLine((angle + 90) % 180)}`;
    } else {
      const effectiveAngle = pattern === 'slash'
        ? angle
        : pattern === 'backslash'
          ? 180 - angle
          : pattern === 'horizontal'
            ? 90
            : pattern === 'vertical'
              ? 0
              : angle;
      content = buildLine(effectiveAngle);
    }
  }

  return {
    defs: `<defs><pattern id="${patternId}" patternUnits="userSpaceOnUse" width="${spacing}" height="${spacing}"><rect width="${spacing}" height="${spacing}" fill="${fill}" />${content}</pattern></defs>`,
    fill: `url(#${patternId})`
  };
}

function syncDesignerGeometryFields(geometryType) {
  const family = geometryFamily(geometryType);
  const pointOnly = family === 'point';
  const hasFill = family !== 'line';
  const polygonOnly = family === 'polygon' || family === 'generic';
  const pattern = getDesignerFillPattern();
  const showPatternControls = polygonOnly && pattern !== 'solid' && pattern !== 'outline';
  const showDotSize = showPatternControls && pattern === 'dots';
  const showAngle = showPatternControls && pattern !== 'dots';
  if (wfsStyleShapeWrap) wfsStyleShapeWrap.hidden = !pointOnly;
  if (wfsStyleRadiusWrap) wfsStyleRadiusWrap.hidden = !pointOnly;
  if (wfsStyleFillColorWrap) wfsStyleFillColorWrap.hidden = !hasFill;
  if (wfsStyleFillOpacityWrap) wfsStyleFillOpacityWrap.hidden = !hasFill;
  if (wfsStyleFillPatternWrap) wfsStyleFillPatternWrap.hidden = !polygonOnly;
  if (wfsStylePatternAngleWrap) wfsStylePatternAngleWrap.hidden = !showAngle;
  if (wfsStylePatternSpacingWrap) wfsStylePatternSpacingWrap.hidden = !showPatternControls;
  if (wfsStylePatternSizeWrap) wfsStylePatternSizeWrap.hidden = !showDotSize;
  if (wfsStylePatternTransparentWrap) wfsStylePatternTransparentWrap.hidden = !showPatternControls;
}

function getSimplifiedQgisStyle(rawStyle, geometryType) {
  if (!rawStyle || typeof rawStyle !== 'object') return null;
  if (rawStyle.type === 'singleSymbol' && rawStyle.symbol) {
    return qgisSymbolToOrigoRule(rawStyle.symbol, geometryType, '') || null;
  }
  if (rawStyle.type === 'categorizedSymbol') {
    const symbol = rawStyle.default || rawStyle.categories?.[0]?.symbol || null;
    if (!symbol) return null;
    return qgisSymbolToOrigoRule(symbol, geometryType, '') || null;
  }
  return null;
}

function getDesignerOptionsFromQgisStyle(rawStyle) {
  if (!rawStyle || typeof rawStyle !== 'object') return { fillPattern: 'solid', ...getDefaultDesignerPatternOptions('solid') };
  let symbol = null;
  if (rawStyle.type === 'singleSymbol' && rawStyle.symbol) {
    symbol = rawStyle.symbol;
  } else if (rawStyle.type === 'categorizedSymbol') {
    symbol = rawStyle.default || rawStyle.categories?.[0]?.symbol || null;
  }
  const pattern = String(symbol?.fillPattern || 'solid').trim().toLowerCase() || 'solid';
  return { fillPattern: pattern === 'diagonal' ? 'slash' : pattern, ...getDefaultDesignerPatternOptions(pattern) };
}

function applyStyleDefinitionToDesigner(styleDef, geometryType) {
  const family = geometryFamily(geometryType);
  const rule = unwrapPrimaryStyleRule(styleDef);
  const pointRule = rule.circle || rule.regularShape || {};
  const fillRule = pointRule.fill || rule.fill || {};
  const strokeRule = pointRule.stroke || rule.stroke || {};
  const fillColor = parseColorValue(fillRule.color, '#3b82f6', family === 'polygon' ? 0.25 : 0.65);
  const strokeColor = parseColorValue(strokeRule.color, '#2563eb', 1);
  const shape = rule.regularShape
    ? (Number(rule.regularShape.points) === 3 ? 'triangle' : Number(rule.regularShape.points) === 4 ? 'square' : 'star')
    : 'circle';

  if (wfsStyleShape) wfsStyleShape.value = family === 'point' ? shape : 'circle';
  if (wfsStyleFillColor) wfsStyleFillColor.value = fillColor.hex;
  if (wfsStyleFillOpacity) wfsStyleFillOpacity.value = String(fillColor.alpha);
  if (wfsStyleStrokeColor) wfsStyleStrokeColor.value = strokeColor.hex;
  if (wfsStyleStrokeOpacity) wfsStyleStrokeOpacity.value = String(strokeColor.alpha);
  if (wfsStyleStrokeWidth) wfsStyleStrokeWidth.value = String(clampNumber(strokeRule.width, 0, 12, 2));
  if (wfsStyleRadius) wfsStyleRadius.value = String(clampNumber(pointRule.radius || rule.radius, 2, 24, 6));
  if (wfsStyleDash) wfsStyleDash.value = dashKeyFromPattern(strokeRule.lineDash);
  const embeddedPattern = rule && rule.qtilerPatternStyle && typeof rule.qtilerPatternStyle === 'object'
    ? rule.qtilerPatternStyle
    : null;
  applyDesignerPatternOptions(embeddedPattern || { fillPattern: 'solid', ...getDefaultDesignerPatternOptions('solid') });
  syncDesignerGeometryFields(geometryType);
}

function buildStyleDefinitionFromDesigner(geometryType) {
  const family = geometryFamily(geometryType);
  const fill = {
    color: rgbaString(wfsStyleFillColor?.value || '#3b82f6', wfsStyleFillOpacity?.value || 0.25)
  };
  const stroke = {
    color: rgbaString(wfsStyleStrokeColor?.value || '#2563eb', wfsStyleStrokeOpacity?.value || 1),
    width: clampNumber(wfsStyleStrokeWidth?.value, 0, 12, 2)
  };
  const dash = dashPatternFromKey(wfsStyleDash?.value);
  if (dash) stroke.lineDash = dash;

  const rule = { stroke };
  if (family === 'polygon' || family === 'generic') {
    const pattern = getDesignerFillPattern();
    if (pattern !== 'outline') {
      rule.fill = fill;
    }
    if (['slash', 'backslash', 'horizontal', 'vertical', 'cross', 'dots'].includes(pattern)) {
      rule.qtilerPatternStyle = getDesignerPatternOptions();
    }
  }
  if (family === 'point' || family === 'generic') {
    const radius = clampNumber(wfsStyleRadius?.value, 2, 24, 6);
    const shape = String(wfsStyleShape?.value || 'circle').trim();
    if (shape === 'circle') {
      rule.circle = { radius, fill, stroke };
    } else {
      rule.regularShape = {
        points: shape === 'triangle' ? 3 : shape === 'square' ? 4 : 5,
        radius,
        angle: shape === 'square' ? Math.PI / 4 : 0,
        ...(shape === 'star' ? { radius2: Math.max(2, radius * 0.45) } : {}),
        fill,
        stroke
      };
    }
  }
  return [[rule]];
}

function stylePreviewSvg(geometryType) {
  const family = geometryFamily(geometryType);
  const fill = rgbaString(wfsStyleFillColor?.value || '#3b82f6', wfsStyleFillOpacity?.value || 0.25);
  const stroke = rgbaString(wfsStyleStrokeColor?.value || '#2563eb', wfsStyleStrokeOpacity?.value || 1);
  const strokeWidth = clampNumber(wfsStyleStrokeWidth?.value, 0, 12, 2);
  const dash = dashPatternFromKey(wfsStyleDash?.value);
  const dashAttr = dash ? ` stroke-dasharray="${dash.join(' ')}"` : '';
  if (family === 'line') {
    return `<svg viewBox="0 0 240 120" aria-hidden="true"><path d="M18 88 C60 22, 120 22, 220 86" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round"${dashAttr} /></svg>`;
  }
  if (family === 'point') {
    const radius = clampNumber(wfsStyleRadius?.value, 2, 24, 6) * 2.5;
    const shape = String(wfsStyleShape?.value || 'circle');
    if (shape === 'square') {
      return `<svg viewBox="0 0 240 120" aria-hidden="true"><rect x="${120 - radius}" y="${60 - radius}" width="${radius * 2}" height="${radius * 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr} /></svg>`;
    }
    if (shape === 'triangle') {
      return `<svg viewBox="0 0 240 120" aria-hidden="true"><polygon points="120,${60 - radius} ${120 - radius},${60 + radius} ${120 + radius},${60 + radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr} /></svg>`;
    }
    if (shape === 'star') {
      return `<svg viewBox="0 0 240 120" aria-hidden="true"><path d="M120 ${60 - radius} L${120 + radius * 0.28} ${60 - radius * 0.28} L${120 + radius} ${60 - radius * 0.22} L${120 + radius * 0.45} ${60 + radius * 0.16} L${120 + radius * 0.62} ${60 + radius} L120 ${60 + radius * 0.46} L${120 - radius * 0.62} ${60 + radius} L${120 - radius * 0.45} ${60 + radius * 0.16} L${120 - radius} ${60 - radius * 0.22} L${120 - radius * 0.28} ${60 - radius * 0.28} Z" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr} /></svg>`;
    }
    return `<svg viewBox="0 0 240 120" aria-hidden="true"><circle cx="120" cy="60" r="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr} /></svg>`;
  }
  const fillValue = getDesignerFillPattern() === 'outline' ? 'rgba(0,0,0,0)' : fill;
  const patternFill = buildSvgPatternFill(fillValue, stroke, strokeWidth);
  return `<svg viewBox="0 0 240 120" aria-hidden="true">${patternFill.defs}<path d="M24 88 L72 30 L150 24 L216 74 L176 94 L70 92 Z" fill="${patternFill.fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr} /></svg>`;
}

function setStyleEditorTab(tabName) {
  const valid = ['rules', 'designer', 'json', 'attributes'];
  const active = valid.includes(tabName) ? tabName : 'rules';
  if (active !== 'designer' && Number.isInteger(currentDesignerRuleIndex)) {
    currentDesignerRuleIndex = null;
    updateDesignerRuleModeNotice();
  }
  // Remember which panel was active BEFORE switching, so we can sync edits
  // out of it (and only out of it) without clobbering work done elsewhere.
  const previousActive = (wfsStylePanels.find((p) => !p.hidden) || {}).getAttribute
    ? wfsStylePanels.find((p) => !p.hidden).getAttribute('data-style-panel')
    : null;
  wfsStyleTabButtons.forEach((button) => button.classList.toggle('is-active', button.getAttribute('data-style-tab') === active));
  wfsStylePanels.forEach((panel) => panel.hidden = panel.getAttribute('data-style-panel') !== active);
  
  // Sync between tabs
  if (active === 'json') {
    // Show FULL layer config (name + rules + style) in the editor
    const layerName = currentEditingWfsLayer;
    const layerObj = getMainLayerByName(layerName) || {};
    const ruleObj = (publishState.mainRules && publishState.mainRules[layerName]) || {};
    const fullCfg = {
      name: layerName,
      title: layerObj.title || layerName,
      geometryType: ruleObj.geometryType || layerObj.geometry || null,
      searchable: ruleObj.searchable === true,
      editable: ruleObj.editable !== false,
      serveAsWfs: ruleObj.serveAsWfs !== false,
      wfsStyle: Array.isArray(currentRules) && currentRules.length
        ? rulesToOrigoStyle(currentRules)
        : (ruleObj.wfsStyle || null),
      attributes: Array.isArray(currentAttributes) && currentAttributes.length
        ? JSON.parse(JSON.stringify(currentAttributes))
        : (Array.isArray(ruleObj.attributes) ? ruleObj.attributes : [])
    };
    setJsonEditorValue(JSON.stringify(fullCfg, null, 2));
  } else if (active === 'rules') {
    // Only re-parse JSON back into rules when the user is leaving the JSON
    // tab. Otherwise switching to Attributes and back would clobber any
    // unsaved rule edits with the stale JSON from when the modal opened.
    if (previousActive === 'json') {
      try {
        const txt = getJsonEditorValue();
        if (txt && txt.trim()) {
          const parsed = JSON.parse(txt);
          const styleArr = Array.isArray(parsed) ? parsed : parsed && parsed.wfsStyle;
          if (Array.isArray(styleArr)) currentRules = origoStyleToRules(styleArr);
        }
      } catch {/* keep current */}
    }
    renderRulesPanel();
  }
  // Always refresh the preview so the gallery/SVG matches the active tab.
  try { syncStylePreview(); } catch (_e) {}
}

function syncStylePreview() {
  const geometryType = getLayerGeometryType(currentEditingWfsLayer);
  // Pick preview source based on the active tab so what you see matches what
  // you're editing: Basic→single SVG sample, Advanced/JSON→rules gallery.
  const activePanel = wfsStylePanels.find((panel) => !panel.hidden);
  const activeName = activePanel ? activePanel.getAttribute('data-style-panel') : null;
  const preferGallery = activeName !== 'designer'
    && Array.isArray(currentRules)
    && currentRules.length
    && typeof renderRulesPreviewGallery === 'function';
  if (wfsStylePreview) {
    if (preferGallery) {
      renderRulesPreviewGallery();
    } else {
      wfsStylePreview.innerHTML = stylePreviewSvg(geometryType);
    }
  }
  if (wfsStyleJsonEditor && !wfsStylePanels.find((panel) => panel.getAttribute('data-style-panel') === 'json' && !panel.hidden)) {
    wfsStyleJsonEditor.value = JSON.stringify(buildStyleDefinitionFromDesigner(geometryType), null, 2);
  }
}

function syncToolCardClasses() {
  document.querySelectorAll('.Qtiler2Origo-tool-card input[type="checkbox"]').forEach((cb) => {
    const card = cb.closest('.Qtiler2Origo-tool-card');
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

function clearPublishStatusError() {
  if (!publishStatusError) return;
  publishStatusError.textContent = '';
  publishStatusError.style.display = 'none';
}

function showPublishStatusError(message, tabId = 'layers') {
  const text = String(message || '').trim();
  if (!text) return;
  if (publishStatusError) {
    publishStatusError.textContent = text;
    publishStatusError.style.display = '';
  }
  if (tabId) setPublishModalTab(tabId);
  addLog(text, 'error');
}

clearLogBtn?.addEventListener('click', () => {
  if (logContainer) logContainer.innerHTML = `<p class="log-empty">${escapeHtml(t('Qtiler2Origo.no_activity'))}</p>`;
});


/* ── Global state ── */
let currentStatus = null;
let publishedItems = [];

const publishState = {
  projects: [],
  mainLayers: [],
  extraLayers: [],
  backgroundLayers: [],
  mainRules: {},
  initialVisibility: {},
  backgroundOptions: [],
  defaultBackgroundKey: 'none',
  groups: [],            // [{ name, title, parent, expanded }]
  layerGroups: {},       // { layerName: 'groupName' }
  controls: {},          // { search: { hintText, minLength, limit, ... } }
  searchSources: [],     // [{ projectId, layers: [layerName,...] }]
  searchSourceCatalog: {}, // { projectId: [{ name, ... }] } — cached searchable layers per project
  projectLayerCatalog: {}, // { projectId: normalizedLayer[] } — cached for external layer picker
  editingProfileId: null  // non-null = edit mode
};

function getFixedBackgroundOptions() {
  return [
    { key: 'none', type: 'none', title: t('Qtiler2Origo.no_bg_option'), required: true }
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
    installBadge.textContent = t(installed ? 'Qtiler2Origo.installed' : 'Qtiler2Origo.not_installed');
    installBadge.className = `badge ${installed ? 'badge--ok' : 'badge--warn'}`;
  }
  if (installInfo) {
    if (installed && s.installedAt) {
      installInfo.innerHTML = escapeHtml(t('Qtiler2Origo.installed_at', {
        date: new Date(s.installedAt).toLocaleDateString(),
        repo: s.repo || '—',
        version: s.version || '—'
      }));
      installInfo.className = 'info-box info-box--ok';
    } else if (installed) {
      installInfo.textContent = t('Qtiler2Origo.installed');
      installInfo.className = 'info-box info-box--ok';
    } else {
      installInfo.textContent = t('Qtiler2Origo.not_installed_hint');
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
      openWebmapBtn.href = '/plugins/Qtiler2Origo/origo/';
    } else {
      openWebmapBtn.classList.add('is-disabled');
      openWebmapBtn.href = '#';
    }
  }

  /* ── Logo card ── */
  if (logoSection) logoSection.classList.toggle('card--disabled', !installed);
  if (logoBadge) {
    logoBadge.textContent = t(hasLogo ? 'Qtiler2Origo.logo_active' : 'Qtiler2Origo.no_logo');
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
      catalogLink.href = '/Qtiler2Origo/maps';
      catalogLink.classList.remove('is-disabled');
    } else {
      catalogLink.href = '#';
      catalogLink.classList.add('is-disabled');
    }
  }

  if (removeDemoBtn) removeDemoBtn.disabled = !installed;
  if (!installed && publishModal) publishModal.hidden = true;

  renderPublishedProfiles(publishedItems);
}

/* ── Published profiles rendering ── */
function renderPublishedProfiles(items) {
  if (!publishedProfilesList) return;
  const rows = Array.isArray(items) ? items : [];
  const installed = !!currentStatus?.installed;

  if (!rows.length) {
    publishedProfilesList.innerHTML = `<p class="help">${escapeHtml(t('Qtiler2Origo.no_profiles'))}</p>`;
    return;
  }

  publishedProfilesList.innerHTML = rows.map((row) => {
    const profileKey = escapeHtml(row.profileKey || row.name || row.projectId || '');
    const mapName = escapeHtml(row.name || row.projectId || '');
    const mapDesc = escapeHtml(row.description || '');
    const generatedAt = row.generatedAt ? new Date(row.generatedAt).toLocaleString() : '';
    
    // Fallback to the published project route via the public alias so the URL
    // matches the IIS rewrite for /Qtiler2Origo/maps.
    const fallbackLaunch = `/Qtiler2Origo/maps/?qtiler_profile=${encodeURIComponent(row.profileKey || row.projectId || '')}#/?t=${encodeURIComponent(row.profileKey || row.projectId || '')}`;
    const fallbackOpen = `/plugins/Qtiler2Origo/published/${encodeURIComponent(row.profileKey || row.name || row.projectId || '')}.json`;
    const openUrl = escapeHtml(row.url || fallbackOpen);
    const launchUrl = escapeHtml(row.launchUrl || fallbackLaunch);
    const launchDisabled = installed ? '' : 'is-disabled';
    
    const projectId = escapeHtml(row.projectId || '');
    const layersParam = encodeURIComponent((row.mainLayerNames || []).join(','));
    const thumbUrl = `/plugins/Qtiler2Origo/api/thumbnail/${encodeURIComponent(row.projectId || '')}?LAYERS=${layersParam}`;
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
            <button class="button is-info small" data-edit-published="${profileKey}" title="${escapeHtml(t('Qtiler2Origo.pub_edit_profile_title'))}">✏️ ${escapeHtml(t('Qtiler2Origo.edit_profile'))}</button>
            <button class="button is-warning small" data-duplicate-published="${profileKey}" data-duplicate-name="${escapeHtml(row.name || row.profileKey || '')}">⎘ ${escapeHtml(t('Qtiler2Origo.duplicate'))}</button>
            <a class="button ghost small" href="${openUrl}" target="_blank" rel="noreferrer">${escapeHtml(t('Qtiler2Origo.open_json'))}</a>
            <a class="button ghost small ${launchDisabled}" href="${launchDisabled ? '#' : launchUrl}" target="_blank" rel="noreferrer">${escapeHtml(t('Qtiler2Origo.open_Origo_link'))}</a>
            <button class="button ghost small" data-regen-thumb="${projectId}" title="${escapeHtml(t('Qtiler2Origo.regen_thumb_title'))}">↻ ${escapeHtml(t('Qtiler2Origo.regen_thumb'))}</button>
            <button class="button danger small" data-delete-published="${profileKey}">${escapeHtml(t('Qtiler2Origo.delete'))}</button>
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
    const data = await api(`/plugins/Qtiler2Origo/api/releases${qs}`);
    const releases = data?.releases || [];
    const currentVersion = currentStatus?.version || data?.defaultVersion || '';
    if (versionEl) {
      versionEl.innerHTML = '';
      if (releases.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = t('Qtiler2Origo.no_releases_found');
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
      versionEl.innerHTML = `<option value="">${t('Qtiler2Origo.releases_error')}</option>`;
      versionEl.disabled = false;
    }
  }
}

async function loadStatus() {
  currentStatus = await api('/plugins/Qtiler2Origo/api/status');
  syncUI();
}

async function loadPublishedProfiles() {
  const payload = await api('/plugins/Qtiler2Origo/api/publish/list');
  // CRITICAL FIX: Handles if payload is already an Array directly
  publishedItems = payload?.items || (Array.isArray(payload) ? payload : []);
  syncUI();
}

/* ── Layer helpers ── */
function normalizeLayersPayload(payload, options = {}) {
  const sourceProjectId = String(options.sourceProjectId || publishProjectSelect?.value || '').trim();
  return (Array.isArray(payload?.layers) ? payload.layers : [])
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const name = String(row.name || row.id || '').trim();
      if (!name) return null;
      const key = makeLayerKey(sourceProjectId, name);
      return {
        key,
        name,
        sourceProjectId,
        geometry: String(row.geometry_type || row.geometry || row.kind || '').trim()
      };
    })
    .filter(Boolean);
}

function renderLayerChecklist(container, layers, rules = {}) {
  if (!container) return;
  const isMainLayerList = container === projectLayersList;
  const isBackgroundList = container === backgroundLayersList;
  if (!Array.isArray(layers) || !layers.length) {
    container.innerHTML = `<p class="help">${escapeHtml(t('Qtiler2Origo.no_layers'))}</p>`;
    try { renderPublishConfigSummary(); } catch {}
    return;
  }
  // Resolve background project id once for thumbnail URL
  const bgProjectId = isBackgroundList ? String(backgroundProjectSelect?.value || '').trim() : '';
  container.innerHTML = layers.map((layer) => {
    const layerKey = getLayerKey(layer);
    const rule = rules[layerKey] || {};
    const tags = [];
    if (rule.searchable) tags.push(t('Qtiler2Origo.searchable'));
    if (rule.editable) tags.push(t('Qtiler2Origo.editable'));
    const isVectorLayer = isMainLayerList && isVectorGeometry(layer.geometry);
    if (rule.serveAsWfs && isMainLayerList) tags.push('WFS vectorial');
    if (isMainLayerList && layer.sourceProjectId && layer.sourceProjectId !== String(publishProjectSelect?.value || '').trim()) {
      tags.push(`Project: ${layer.sourceProjectId}`);
    }
    const tagText = tags.length ? `<span class="Qtiler2Origo-tags">${tags.map((tg) => `<span>${escapeHtml(tg)}</span>`).join('')}</span>` : '';
    const isInitiallyVisible = publishState.initialVisibility[layerKey] !== false;
    const activeHint = !isMainLayerList ? '' : `<small class="help">${escapeHtml(t('Qtiler2Origo.layer_include_help'))} ${escapeHtml(t('Qtiler2Origo.layer_initial_visibility_help'))}</small>`;
    
    let styleButton = '';
    if (isVectorLayer) {
      const wfsColor = rule.serveAsWfs ? 'is-success' : 'is-light';
      styleButton = `
        <div style="display:flex; gap:4px">
          <label class="button is-small ${wfsColor}" style="margin-bottom:0">
            <input type="checkbox" style="margin-right:6px" data-wfs-toggle="${escapeHtml(layerKey)}" ${rule.serveAsWfs ? 'checked' : ''} />
            WFS
          </label>
          <button type="button" class="button is-small is-info is-light" data-style-layer="${escapeHtml(layerKey)}">${rule.wfsStyle ? t('Qtiler2Origo.wfs_style_yes') || 'Estilo WFS' : t('Qtiler2Origo.wfs_style_no') || 'Config. estilo'}</button>
        </div>
      `;
    }

    let bgThumb = '';
    if (isBackgroundList && bgProjectId) {
      const tUrl = `/plugins/Qtiler2Origo/api/thumbnail/${encodeURIComponent(bgProjectId)}?LAYERS=${encodeURIComponent(layer.name)}`;
      bgThumb = `<img class="Qtiler2Origo-bg-item__thumb" src="${escapeHtml(tUrl)}" alt="" loading="lazy" style="width:48px;height:36px;object-fit:cover;border-radius:4px;border:1px solid #d8dde3;margin-right:6px"/>`;
    }
    const checkboxId = `Qtilerlay_${(container.id || 'l')}_${escapeHtml(layerKey).replace(/[^a-z0-9_-]/gi, '_')}`;
    const includeControl = isMainLayerList
      ? `
        <label class="button is-small is-light" style="margin-bottom:0; display:inline-flex; align-items:center; gap:6px;" title="${escapeHtml(t('Qtiler2Origo.layer_include_help'))}">
          <input id="${checkboxId}" type="checkbox" data-layer-include="${escapeHtml(layerKey)}" data-layer-name="${escapeHtml(layerKey)}" class="Qtiler2Origo-layer-row__check" />
          <span>${escapeHtml(t('Qtiler2Origo.layer_include'))}</span>
        </label>
      `
      : `<input id="${checkboxId}" type="checkbox" data-layer-include="${escapeHtml(layerKey)}" data-layer-name="${escapeHtml(layerKey)}" class="Qtiler2Origo-layer-row__check" />`;
    const visibleControl = isMainLayerList
      ? `
        <label class="button is-small is-light" style="margin-bottom:0; display:inline-flex; align-items:center; gap:6px;" title="${escapeHtml(t('Qtiler2Origo.layer_initial_visibility_help'))}">
          <input type="checkbox" data-layer-visible="${escapeHtml(layerKey)}" class="Qtiler2Origo-layer-row__check" ${isInitiallyVisible ? 'checked' : ''} />
          <span>${escapeHtml(t('Qtiler2Origo.layer_initial_visibility'))}</span>
        </label>
      `
      : '';
    const mainContentTag = isMainLayerList ? 'div' : 'label';
    return `
      <div class="Qtiler2Origo-layer-row">
        ${!isMainLayerList ? includeControl : ''}
        ${bgThumb}
        <${mainContentTag}${isMainLayerList ? '' : ` for="${checkboxId}"`} class="Qtiler2Origo-layer-row__main">
          <div class="Qtiler2Origo-layer-row__name">${escapeHtml(layer.name)}</div>
          ${tagText}
          ${activeHint}
        </${mainContentTag}>
        ${isMainLayerList ? `<div style="display:flex; gap:4px; align-items:center; flex-wrap:wrap">${includeControl}${visibleControl}${styleButton}</div>` : styleButton}
      </div>
    `;
  }).join('');
  try { renderPublishConfigSummary(); } catch {}
}

function getCheckedLayerNames(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[type="checkbox"][data-layer-include]:checked'))
    .map((el) => String(el.getAttribute('data-layer-include') || '').trim())
    .filter(Boolean);
}

function getCheckedLayers(container, layers) {
  if (!container || !Array.isArray(layers) || !layers.length) return [];
  const checkedKeys = new Set(getCheckedLayerNames(container));
  return layers.filter((layer) => checkedKeys.has(getLayerKey(layer)));
}

function setCheckedLayerNames(container, names) {
  if (!container || !Array.isArray(names)) return;
  const set = new Set(names);
  container.querySelectorAll('input[type="checkbox"][data-layer-include]').forEach((el) => {
    el.checked = set.has(el.getAttribute('data-layer-include'));
  });
  try { renderPublishConfigSummary(); } catch {}
}

function getInitialVisibleLayerNames() {
  return getAllPublishLayers()
    .map((layer) => getLayerKey(layer))
    .filter((key) => key && publishState.initialVisibility[key] !== false);
}

/* ── Background options ── */
function buildBackgroundOptions() {
  const backgroundProjectId = String(backgroundProjectSelect?.value || '').trim();
  const selectedBackgroundLayers = getCheckedLayers(backgroundLayersList, publishState.backgroundLayers || []);
  const dynamicOptions = selectedBackgroundLayers.map((layer) => ({
    key: `layer:${backgroundProjectId}:${layer.name}`,
    type: 'layer',
    sourceProjectId: backgroundProjectId,
    name: layer.name,
    title: backgroundProjectId ? `${backgroundProjectId} / ${layer.name}` : layer.name,
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
    defaultBackgroundList.innerHTML = `<p class="help">${escapeHtml(t('Qtiler2Origo.no_bg_available'))}</p>`;
    return;
  }
  defaultBackgroundList.innerHTML = publishState.backgroundOptions.map((item) => {
    const checked = item.key === publishState.defaultBackgroundKey ? 'checked' : '';
    const defaultTag = checked ? `<span class="Qtiler2Origo-bg-item__default-tag">${escapeHtml(t('Qtiler2Origo.default'))}</span>` : '';
    let thumbHtml = '';
    if (item.type === 'layer' && item.sourceProjectId && item.name) {
      const thumbUrl = `/plugins/Qtiler2Origo/api/thumbnail/${encodeURIComponent(item.sourceProjectId)}?LAYERS=${encodeURIComponent(item.name)}`;
      thumbHtml = `<img class="Qtiler2Origo-bg-item__thumb" src="${escapeHtml(thumbUrl)}" alt="" loading="lazy" />`;
    } else if (item.type === 'osm' || item.key === 'osm') {
      // OSM tile sample
      thumbHtml = `<img class="Qtiler2Origo-bg-item__thumb" src="https://tile.openstreetmap.org/4/8/5.png" alt="OSM" loading="lazy" />`;
    } else if (item.type === 'none' || item.key === 'none') {
      thumbHtml = `<span class="Qtiler2Origo-bg-item__thumb Qtiler2Origo-bg-item__thumb--placeholder" style="display:flex;align-items:center;justify-content:center;color:#888;font-size:0.7rem">∅</span>`;
    } else {
      thumbHtml = `<span class="Qtiler2Origo-bg-item__thumb Qtiler2Origo-bg-item__thumb--placeholder"></span>`;
    }
    return `
      <label class="Qtiler2Origo-bg-item">
        <input type="radio" name="Qtiler2OrigoDefaultBackground" data-default-bg-key="${escapeHtml(item.key)}" ${checked} />
        ${thumbHtml}
        <span class="Qtiler2Origo-bg-item__name">${escapeHtml(item.title)}</span>
        ${defaultTag}
      </label>
    `;
  }).join('');
}

function refreshBackgroundOptions() {
  buildBackgroundOptions();
  renderDefaultBackgroundOptions();
  try { renderPublishConfigSummary(); } catch {}
}

/* ── Groups, per-layer placement & module config ── */

/**
 * Inject (once) the "Groups & layer placement" panel and the search options
 * panel into the publish modal. Returns refs to the dynamic containers.
 */
function ensureExtraSections() {
  const modalBody = publishModal?.querySelector('.modal-card-body');
  if (!modalBody) return null;
  const layersSlot = publishLayersDynamicSlot || modalBody;
  const toolsSlot = publishToolsDynamicSlot || modalBody;

  let groupsSection = document.getElementById('Qtiler2OrigoGroupsSection');
  if (!groupsSection) {
    groupsSection = document.createElement('fieldset');
    groupsSection.id = 'Qtiler2OrigoGroupsSection';
    groupsSection.className = 'modal-step';
    groupsSection.innerHTML = `
      <legend class="modal-step__legend">${escapeHtml(t('Qtiler2Origo.pub_groups_legend'))}</legend>
      <p class="help" style="margin-bottom:.6rem">${escapeHtml(t('Qtiler2Origo.pub_groups_help'))}</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start">
        <div>
          <strong style="display:block;margin-bottom:6px">${escapeHtml(t('Qtiler2Origo.pub_groups_label'))}</strong>
          <div id="Qtiler2OrigoGroupsList"></div>
          <button type="button" id="Qtiler2OrigoAddGroupBtn" class="button is-small" style="margin-top:6px">${escapeHtml(t('Qtiler2Origo.pub_add_group'))}</button>
        </div>
        <div>
          <strong style="display:block;margin-bottom:6px">${escapeHtml(t('Qtiler2Origo.pub_layer_assign_label'))}</strong>
          <div id="Qtiler2OrigoLayerAssignList"></div>
          <p class="help" style="margin-top:6px">${escapeHtml(t('Qtiler2Origo.pub_layer_assign_help'))}</p>
        </div>
      </div>`;
    toolsSlot.appendChild(groupsSection);
    groupsSection.querySelector('#Qtiler2OrigoAddGroupBtn')
      .addEventListener('click', () => {
        const idx = publishState.groups.length + 1;
        publishState.groups.push({ name: `group_${idx}`, title: `Grupo ${idx}`, parent: '', expanded: true });
        renderGroupsManager();
        renderLayerAssignments();
      });
    groupsSection.querySelector('#Qtiler2OrigoGroupsList')
      .addEventListener('input', (ev) => {
        const target = ev.target;
        const idx = Number(target.getAttribute('data-group-idx'));
        if (!Number.isInteger(idx) || !publishState.groups[idx]) return;
        const field = target.getAttribute('data-group-field');
        if (!field) return;
        publishState.groups[idx][field] = String(target.value || '').trim();
        if (field === 'name' || field === 'parent') renderLayerAssignments();
      });
    groupsSection.querySelector('#Qtiler2OrigoGroupsList')
      .addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-remove-group]');
        if (!btn) return;
        const idx = Number(btn.getAttribute('data-remove-group'));
        if (!Number.isInteger(idx)) return;
        const removed = publishState.groups.splice(idx, 1)[0];
        if (removed?.name) {
          Object.keys(publishState.layerGroups).forEach((ln) => {
            if (publishState.layerGroups[ln] === removed.name) publishState.layerGroups[ln] = 'root';
          });
        }
        renderGroupsManager();
        renderLayerAssignments();
      });
    groupsSection.querySelector('#Qtiler2OrigoLayerAssignList')
      .addEventListener('change', (ev) => {
        const target = ev.target;
        const layerName = target.getAttribute('data-layer-group-for');
        if (layerName) {
          publishState.layerGroups[layerName] = String(target.value || 'root');
        }
      });
  }

  let extraLayersSection = document.getElementById('Qtiler2OrigoExtraLayersSection');
  if (!extraLayersSection) {
    extraLayersSection = document.createElement('fieldset');
    extraLayersSection.id = 'Qtiler2OrigoExtraLayersSection';
    extraLayersSection.className = 'modal-step';
    extraLayersSection.innerHTML = `
      <legend class="modal-step__legend">Additional project layers</legend>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">
        <p class="help" style="margin:0">Add WMS or WFS layers from other published QGIS projects.</p>
        <button type="button" id="Qtiler2OrigoOpenExternalLayers" class="button is-small">+ Add layers</button>
      </div>
      <div id="Qtiler2OrigoExtraLayersList"></div>`;
    layersSlot.appendChild(extraLayersSection);
  }

  let searchSection = document.getElementById('Qtiler2OrigoSearchOptions');
  if (!searchSection) {
    searchSection = document.createElement('fieldset');
    searchSection.id = 'Qtiler2OrigoSearchOptions';
    searchSection.className = 'modal-step';
    searchSection.innerHTML = `
      <legend class="modal-step__legend">${escapeHtml(t('Qtiler2Origo.pub_search_legend'))}</legend>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
        <label class="field"><span class="label">${escapeHtml(t('Qtiler2Origo.pub_search_hint_label'))}</span>
          <input id="Qtiler2OrigoSearchHint" class="input is-small" type="text" placeholder="${escapeHtml(t('Qtiler2Origo.pub_search_placeholder'))}" /></label>
        <label class="field"><span class="label">${escapeHtml(t('Qtiler2Origo.pub_search_min_label'))}</span>
          <input id="Qtiler2OrigoSearchMin" class="input is-small" type="number" min="1" max="20" value="4" /></label>
        <label class="field"><span class="label">${escapeHtml(t('Qtiler2Origo.pub_search_limit_label'))}</span>
          <input id="Qtiler2OrigoSearchLimit" class="input is-small" type="number" min="1" max="100" value="9" /></label>
      </div>
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid #e0e0e0">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
          <strong>${escapeHtml(t('Qtiler2Origo.pub_search_sources_label'))}</strong>
          <button type="button" id="Qtiler2OrigoSearchSourceAdd" class="button is-small">+ ${escapeHtml(t('Qtiler2Origo.pub_search_source_add'))}</button>
        </div>
        <p class="help" style="margin:0 0 8px">${escapeHtml(t('Qtiler2Origo.pub_search_sources_help'))}</p>
        <div id="Qtiler2OrigoSearchSourcesList"></div>
      </div>`;
    toolsSlot.appendChild(searchSection);
  }
  // The search-options section (which now hosts the cross-project picker)
  // is always visible so the user can configure it before enabling the
  // Origo `Search` control. Hiding it based on a single checkbox proved
  // confusing — users reported "the form is empty" because the section
  // was display:none.
  searchSection.style.display = '';

  return { groupsSection, extraLayersSection, searchSection };
}

async function getProjectLayersCatalog(projectId) {
  const pid = String(projectId || '').trim();
  if (!pid) return [];
  if (Array.isArray(publishState.projectLayerCatalog[pid])) {
    return publishState.projectLayerCatalog[pid];
  }
  const payload = await api(`/projects/${encodeURIComponent(pid)}/layers`);
  const normalized = normalizeLayersPayload(payload, { sourceProjectId: pid });
  publishState.projectLayerCatalog[pid] = normalized;
  return normalized;
}

async function addExternalLayers(projectId, selectedItems) {
  const pid = String(projectId || '').trim();
  if (!pid || !Array.isArray(selectedItems) || !selectedItems.length) return;
  const catalog = await getProjectLayersCatalog(pid);
  const rules = await loadLayerRules(pid).catch(() => ({}));
  const currentProjectId = String(publishProjectSelect?.value || '').trim();
  if (pid === currentProjectId) return;

  for (const item of selectedItems) {
    const layerName = String(item?.name || '').trim();
    if (!layerName) continue;
    const layerObj = catalog.find((layer) => String(layer?.name || '') === layerName);
    if (!layerObj) continue;
    const layerKey = getLayerKey(layerObj);
    if (!publishState.extraLayers.some((layer) => getLayerKey(layer) === layerKey)) {
      publishState.extraLayers.push({ ...layerObj });
    }
    if (typeof publishState.initialVisibility[layerKey] === 'undefined') {
      publishState.initialVisibility[layerKey] = true;
    }
    const baseRule = rules[layerName] || {};
    publishState.mainRules[layerKey] = {
      ...(publishState.mainRules[layerKey] || {}),
      searchable: baseRule.searchable === true,
      editable: item.mode === 'WFS' ? baseRule.editable === true : false,
      serveAsWfs: item.mode === 'WFS',
      searchAttribute: baseRule.searchAttribute || null,
      idAttribute: baseRule.idAttribute || null,
      geometryAttribute: baseRule.geometryAttribute || null,
      hintText: baseRule.hintText || null,
      geometryType: String(baseRule.geometryType || layerObj.geometry || '').trim() || null
    };
  }
}

function renderExternalLayersSummary() {
  const host = document.getElementById('Qtiler2OrigoExtraLayersList');
  if (!host) return;
  const rows = Array.isArray(publishState.extraLayers) ? publishState.extraLayers : [];
  if (!rows.length) {
    host.innerHTML = `<p class="help">No external layers added.</p>`;
    return;
  }
  host.innerHTML = rows.map((layer) => {
    const key = getLayerKey(layer);
    const rule = publishState.mainRules[key] || {};
    return `<div style="display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;margin-bottom:6px;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;background:#fff">
      <div>
        <strong>${escapeHtml(layer.name)}</strong>
        <div class="help" style="margin:2px 0 0">${escapeHtml(layer.sourceProjectId || '')}</div>
      </div>
      <span class="tag is-light">${rule.serveAsWfs ? 'WFS' : 'WMS'}</span>
      <button type="button" class="button is-small is-danger is-light" data-remove-extra-layer="${escapeHtml(key)}">Remove</button>
    </div>`;
  }).join('');
}

function ensureExternalLayerModal() {
  let modal = document.getElementById('Qtiler2OrigoExternalLayerModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'Qtiler2OrigoExternalLayerModal';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-background" data-close-external-layer-modal></div>
    <div class="modal-card" style="width:min(920px, calc(100vw - 32px))">
      <header class="modal-card-head">
        <p class="modal-card-title">Add layers from another project</p>
        <button type="button" class="delete" aria-label="close" data-close-external-layer-modal></button>
      </header>
      <section class="modal-card-body">
        <label class="field">
          <span class="label">Project</span>
          <select id="Qtiler2OrigoExternalProjectSelect" class="input"></select>
        </label>
        <div id="Qtiler2OrigoExternalProjectLayers" style="display:grid;gap:8px;max-height:55vh;overflow:auto"></div>
      </section>
      <footer class="modal-card-foot" style="justify-content:space-between">
        <button type="button" class="button" data-close-external-layer-modal>Cancel</button>
        <button type="button" class="button is-primary" id="Qtiler2OrigoExternalLayerApply">Add selected layers</button>
      </footer>
    </div>`;
  document.body.appendChild(modal);
  return modal;
}

async function renderExternalLayerModalList(projectId) {
  const host = document.getElementById('Qtiler2OrigoExternalProjectLayers');
  if (!host) return;
  const pid = String(projectId || '').trim();
  if (!pid) {
    host.innerHTML = `<p class="help">Select a project.</p>`;
    return;
  }
  const currentProjectId = String(publishProjectSelect?.value || '').trim();
  if (pid === currentProjectId) {
    host.innerHTML = `<p class="help">The main project is already listed above. Pick a different project here.</p>`;
    return;
  }
  const layers = await getProjectLayersCatalog(pid);
  if (!layers.length) {
    host.innerHTML = `<p class="help">No layers available for this project.</p>`;
    return;
  }
  host.innerHTML = layers.map((layer) => {
    const key = getLayerKey(layer);
    const isVector = isVectorGeometry(layer.geometry);
    const checked = publishState.extraLayers.some((row) => getLayerKey(row) === key) ? 'checked' : '';
    const currentRule = publishState.mainRules[key] || {};
    const mode = currentRule.serveAsWfs ? 'WFS' : 'WMS';
    return `<label style="display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff">
      <input type="checkbox" data-external-layer-check="${escapeHtml(key)}" ${checked} />
      <div>
        <div><strong>${escapeHtml(layer.name)}</strong></div>
        <div class="help" style="margin:2px 0 0">${escapeHtml(layer.geometry || 'Layer')}</div>
      </div>
      <select class="input is-small" style="width:92px" data-external-layer-mode="${escapeHtml(key)}" ${isVector ? '' : 'disabled'}>
        <option value="WMS" ${mode === 'WMS' ? 'selected' : ''}>WMS</option>
        <option value="WFS" ${mode === 'WFS' ? 'selected' : ''}>WFS</option>
      </select>
    </label>`;
  }).join('');
}

function bindExternalLayerPickerEvents() {
  const openBtn = document.getElementById('Qtiler2OrigoOpenExternalLayers');
  if (openBtn && !openBtn.dataset.bound) {
    openBtn.dataset.bound = '1';
    openBtn.addEventListener('click', async () => {
      const modal = ensureExternalLayerModal();
      const select = document.getElementById('Qtiler2OrigoExternalProjectSelect');
      const currentProjectId = String(publishProjectSelect?.value || '').trim();
      const options = (publishState.projects || [])
        .filter((project) => project.id && project.id !== currentProjectId)
        .map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name || project.id)}</option>`)
        .join('');
      select.innerHTML = `<option value="">Select a project</option>${options}`;
      modal.classList.add('is-active');
      await renderExternalLayerModalList(String(select.value || '').trim());
    });
  }

  const modal = ensureExternalLayerModal();
  if (!modal.dataset.bound) {
    modal.dataset.bound = '1';
    modal.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.hasAttribute('data-close-external-layer-modal')) {
        modal.classList.remove('is-active');
      }
    });
    document.getElementById('Qtiler2OrigoExternalProjectSelect')?.addEventListener('change', async (event) => {
      const target = event.target;
      await renderExternalLayerModalList(String(target.value || '').trim());
    });
    document.getElementById('Qtiler2OrigoExternalLayerApply')?.addEventListener('click', async () => {
      const select = document.getElementById('Qtiler2OrigoExternalProjectSelect');
      const projectId = String(select?.value || '').trim();
      const host = document.getElementById('Qtiler2OrigoExternalProjectLayers');
      const selectedItems = Array.from(host?.querySelectorAll('input[data-external-layer-check]:checked') || []).map((input) => {
        const layerKey = String(input.getAttribute('data-external-layer-check') || '').trim();
        const modeSelect = host.querySelector(`[data-external-layer-mode="${CSS.escape(layerKey)}"]`);
        const layer = (publishState.projectLayerCatalog[projectId] || []).find((entry) => getLayerKey(entry) === layerKey);
        return layer ? { name: layer.name, mode: String(modeSelect?.value || 'WMS').trim().toUpperCase() === 'WFS' ? 'WFS' : 'WMS' } : null;
      }).filter(Boolean);
      await addExternalLayers(projectId, selectedItems);
      renderLayerChecklist(projectLayersList, getAllPublishLayers(), publishState.mainRules);
      renderExternalLayersSummary();
      refreshExtraSections();
      modal.classList.remove('is-active');
    });
  }

  const summary = document.getElementById('Qtiler2OrigoExtraLayersList');
  if (summary && !summary.dataset.bound) {
    summary.dataset.bound = '1';
    summary.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const key = String(target.getAttribute('data-remove-extra-layer') || '').trim();
      if (!key) return;
      publishState.extraLayers = publishState.extraLayers.filter((layer) => getLayerKey(layer) !== key);
      delete publishState.mainRules[key];
      delete publishState.layerGroups[key];
      delete publishState.initialVisibility[key];
      const checkedNames = getCheckedLayerNames(projectLayersList).filter((name) => name !== key);
      renderLayerChecklist(projectLayersList, getAllPublishLayers(), publishState.mainRules);
      setCheckedLayerNames(projectLayersList, checkedNames);
      renderExternalLayersSummary();
      renderLayerAssignments();
    });
  }

  const assignments = document.getElementById('Qtiler2OrigoLayerAssignList');
  if (assignments && !assignments.dataset.bound) {
    assignments.dataset.bound = '1';
    assignments.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const key = String(target.getAttribute('data-remove-publish-layer') || '').trim();
      if (!key) return;
      const checkbox = projectLayersList?.querySelector(`input[type="checkbox"][data-layer-include="${CSS.escape(key)}"]`);
      if (!(checkbox instanceof HTMLInputElement)) return;
      checkbox.checked = false;
      renderLayerAssignments();
      schedulePreviewRefresh();
    });
  }
}

function getGroupOptionsHtml(selected) {
  const sel = String(selected || 'root');
  const opts = [{ name: 'root', title: 'Map Layers' }, ...publishState.groups];
  return opts.map((g) => {
    const value = String(g.name || '').trim();
    if (!value) return '';
    const label = String(g.title || value).trim() || value;
    const indent = g.parent ? '— ' : '';
    const isSel = value === sel ? 'selected' : '';
    return `<option value="${escapeHtml(value)}" ${isSel}>${escapeHtml(indent + label)}</option>`;
  }).join('');
}

function renderGroupsManager() {
  const list = document.getElementById('Qtiler2OrigoGroupsList');
  if (!list) return;
  if (!publishState.groups.length) {
    list.innerHTML = `<p class="help">${escapeHtml(t('Qtiler2Origo.pub_no_groups'))}</p>`;
    return;
  }
  list.innerHTML = publishState.groups.map((g, idx) => {
    const parentOpts = [`<option value="">${escapeHtml(t('Qtiler2Origo.pub_no_parent'))}</option>`]
      .concat(publishState.groups
        .filter((gg, j) => j !== idx && gg.name)
        .map((gg) => `<option value="${escapeHtml(gg.name)}" ${gg.name === g.parent ? 'selected' : ''}>${escapeHtml(gg.title || gg.name)}</option>`))
      .join('');
    return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:6px;margin-bottom:6px;align-items:center">
      <input class="input is-small" data-group-idx="${idx}" data-group-field="name" value="${escapeHtml(g.name || '')}" placeholder="${escapeHtml(t('Qtiler2Origo.pub_group_name_ph'))}" />
      <input class="input is-small" data-group-idx="${idx}" data-group-field="title" value="${escapeHtml(g.title || '')}" placeholder="${escapeHtml(t('Qtiler2Origo.pub_group_title_ph'))}" />
      <select class="input is-small" data-group-idx="${idx}" data-group-field="parent">${parentOpts}</select>
      <button type="button" class="button is-small is-danger is-light" data-remove-group="${idx}">×</button>
    </div>`;
  }).join('');
}

function renderLayerAssignments() {
  const list = document.getElementById('Qtiler2OrigoLayerAssignList');
  if (!list) return;
  // Show ALL project layers (active + inactive) so the user can assign every
  // layer to a group up-front, even if it isn't currently checked. Active
  // layers are visually emphasized so the user can tell at a glance.
  const allLayers = getAllPublishLayers();
  if (!allLayers.length) {
    list.innerHTML = `<p class="help">${escapeHtml(t('Qtiler2Origo.pub_assign_help'))}</p>`;
    return;
  }
  const checkedSet = new Set(getCheckedLayerNames(projectLayersList));
  // Sort: active first, then inactive — preserving original order within each bucket.
  const ordered = [
    ...allLayers.filter((l) => checkedSet.has(getLayerKey(l))),
    ...allLayers.filter((l) => !checkedSet.has(getLayerKey(l)))
  ];
  list.innerHTML = ordered.map((layer) => {
    const name = String(layer?.name || '');
    const layerKey = getLayerKey(layer);
    if (!name || !layerKey) return '';
    const isActive = checkedSet.has(layerKey);
    const groupSel = publishState.layerGroups[layerKey] || 'root';
    const opacity = isActive ? '1' : '0.6';
    const dot = isActive
      ? '<span title="active" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;flex:0 0 8px"></span>'
      : '<span title="inactive" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#cbd5e1;flex:0 0 8px"></span>';
    const removeBtn = isActive
      ? `<button type="button" class="button is-small is-danger is-light" data-remove-publish-layer="${escapeHtml(layerKey)}">Quitar</button>`
      : '<span></span>';
    return `<div style="display:grid;grid-template-columns:14px 1fr 160px 74px;gap:8px;margin-bottom:4px;align-items:center;opacity:${opacity}">
      ${dot}
      <span title="${escapeHtml(name)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(name)}${layer.sourceProjectId && layer.sourceProjectId !== String(publishProjectSelect?.value || '').trim() ? ` [${escapeHtml(layer.sourceProjectId)}]` : ''}</span>
      <select class="input is-small" data-layer-group-for="${escapeHtml(layerKey)}">${getGroupOptionsHtml(groupSel)}</select>
      ${removeBtn}
    </div>`;
  }).join('');
}

function refreshExtraSections() {
  ensureExtraSections();
  renderGroupsManager();
  renderLayerAssignments();
  bindExternalLayerPickerEvents();
  renderExternalLayersSummary();
  bindSearchSourceEvents();
  renderSearchSources();
  renderPublishConfigSummary();
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
  const normalized = normalizeLayersPayload(payload, { sourceProjectId: projectId });
  publishState.projectLayerCatalog[projectId] = normalized;
  if (target === 'main') {
    publishState.mainLayers = normalized;
    publishState.extraLayers = [];
    publishState.mainRules = await loadLayerRules(projectId);
    publishState.initialVisibility = Object.fromEntries(normalized.map((layer) => [getLayerKey(layer), true]));
    renderLayerChecklist(projectLayersList, getAllPublishLayers(), publishState.mainRules);
    // Default visibility = on, but DO NOT force-check the per-row WFS toggle —
    // that would override the saved profile's per-layer `serveAsWfs` flag and
    // make every layer appear as WFS until the user toggles one (which then
    // re-renders all the others as unchecked, looking like a mass-deselect).
    projectLayersList.querySelectorAll('input[type="checkbox"][data-layer-include]').forEach((el) => { el.checked = true; });
    refreshExtraSections();
    return;
  }
  publishState.backgroundLayers = normalized;
  renderLayerChecklist(backgroundLayersList, publishState.backgroundLayers, {});
  refreshBackgroundOptions();
}

async function loadProjectsForPublish() {
  const payload = await api('/projects');
  const list = Array.isArray(payload?.projects) ? payload.projects : [];
  publishState.projects = list.map((p) => ({ id: String(p.id || '').trim(), name: String(p.name || p.id || '').trim() })).filter((p) => p.id);
  const options = publishState.projects.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}</option>`).join('');
  publishProjectSelect.innerHTML = options;
  backgroundProjectSelect.innerHTML = `<option value="">${escapeHtml(t('Qtiler2Origo.no_bg_option'))}</option>${options}`;
}

/* ── Cross-project search sources picker ── */
async function getSearchableLayersForProject(projectId) {
  const pid = String(projectId || '').trim();
  if (!pid) return [];
  if (Array.isArray(publishState.searchSourceCatalog[pid])) {
    return publishState.searchSourceCatalog[pid];
  }
  try {
    const payload = await api(`/projects/${encodeURIComponent(pid)}/searchable`);
    const rows = Array.isArray(payload) ? payload : [];
    const filtered = rows
      .filter((r) => r && r.searchable !== false && String(r.name || '').trim())
      .map((r) => ({ name: String(r.name).trim() }));
    publishState.searchSourceCatalog[pid] = filtered;
    return filtered;
  } catch {
    publishState.searchSourceCatalog[pid] = [];
    return [];
  }
}

function projectLabel(pid) {
  const p = (publishState.projects || []).find((pp) => pp.id === pid);
  return p ? (p.name || p.id) : pid;
}

async function renderSearchSources() {
  const host = document.getElementById('Qtiler2OrigoSearchSourcesList');
  if (!host) return;
  const currentProjectId = String(publishProjectSelect?.value || '').trim();
  const sources = Array.isArray(publishState.searchSources) ? publishState.searchSources : [];

  // Warn loudly if the project list is empty — picker dropdowns would
  // otherwise render with just the placeholder option and the user would
  // be unable to pick anything.
  if (!Array.isArray(publishState.projects) || publishState.projects.length === 0) {
    host.innerHTML = `<p class="help" style="margin:0;color:#a00">${escapeHtml('No hay proyectos disponibles. Verifica la conexión con el servidor o que existan proyectos publicables.')}</p>`;
    return;
  }

  if (!sources.length) {
    host.innerHTML = `<p class="help" style="margin:0">${escapeHtml(t('Qtiler2Origo.pub_search_sources_help'))}</p>`;
    return;
  }

  // Pre-fetch layer catalogs in parallel.
  await Promise.all(sources.map((s) => getSearchableLayersForProject(s.projectId)));

  const usedPids = new Set(sources.map((s) => String(s.projectId || '').trim()).filter(Boolean));

  host.innerHTML = sources.map((src, idx) => {
    const pid = String(src.projectId || '').trim();
    const catalog = publishState.searchSourceCatalog[pid] || [];
    const selLayers = new Set(Array.isArray(src.layers) ? src.layers : []);

    const projectOpts = [
      `<option value="">${escapeHtml(t('Qtiler2Origo.pub_search_source_pick_project'))}</option>`
    ].concat((publishState.projects || []).map((p) => {
      // Allow currently-selected pid even if used; otherwise hide already-used pids.
      if (p.id !== pid && usedPids.has(p.id)) return '';
      const isCurrent = currentProjectId && p.id === currentProjectId;
      const label = (p.name || p.id) + (isCurrent ? ` (${t('Qtiler2Origo.pub_search_source_current')})` : '');
      return `<option value="${escapeHtml(p.id)}" ${p.id === pid ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    })).join('');

    const layersHtml = !pid
      ? ''
      : (catalog.length === 0
          ? `<p class="help" style="margin:4px 0 0">${escapeHtml(t('Qtiler2Origo.pub_search_source_no_layers'))}</p>`
          : `<details style="margin-top:6px"><summary style="cursor:pointer;font-size:0.9em">${escapeHtml(t('Qtiler2Origo.pub_search_source_layers'))} (${selLayers.size === 0 ? t('Qtiler2Origo.pub_search_source_all_layers') : `${selLayers.size}/${catalog.length}`})</summary>
              <div style="margin-top:6px;max-height:160px;overflow:auto;border:1px solid #eee;padding:6px;border-radius:4px">
                <label style="display:block;font-size:0.85em;margin-bottom:4px">
                  <input type="checkbox" data-search-source-all="${idx}" ${selLayers.size === 0 ? 'checked' : ''} />
                  ${escapeHtml(t('Qtiler2Origo.pub_search_source_all_layers'))}
                </label>
                ${catalog.map((layer) => `
                  <label style="display:block;font-size:0.85em;margin-left:12px">
                    <input type="checkbox" data-search-source-layer="${idx}" value="${escapeHtml(layer.name)}" ${selLayers.has(layer.name) ? 'checked' : ''} ${selLayers.size === 0 ? 'disabled' : ''} />
                    ${escapeHtml(layer.name)}
                  </label>`).join('')}
              </div>
            </details>`);

    return `<div data-search-source-row="${idx}" style="display:grid;grid-template-columns:1fr auto;gap:8px;padding:8px;margin-bottom:6px;border:1px solid #ddd;border-radius:4px;background:#fafafa">
      <div>
        <select class="input is-small" data-search-source-project="${idx}">${projectOpts}</select>
        ${layersHtml}
      </div>
      <button type="button" class="button is-small is-danger is-light" data-search-source-remove="${idx}" title="${escapeHtml(t('Qtiler2Origo.pub_search_source_remove'))}">×</button>
    </div>`;
  }).join('');
}

function bindSearchSourceEvents() {
  const host = document.getElementById('Qtiler2OrigoSearchSourcesList');
  const addBtn = document.getElementById('Qtiler2OrigoSearchSourceAdd');
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = '1';
    addBtn.addEventListener('click', () => {
      publishState.searchSources = Array.isArray(publishState.searchSources) ? publishState.searchSources : [];
      publishState.searchSources.push({ projectId: '', layers: [] });
      renderSearchSources();
    });
  }
  if (host && !host.dataset.bound) {
    host.dataset.bound = '1';
    host.addEventListener('change', async (event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement)) return;
      const sources = publishState.searchSources;

      const projIdxAttr = el.getAttribute('data-search-source-project');
      if (projIdxAttr !== null) {
        const idx = Number.parseInt(projIdxAttr, 10);
        if (Number.isFinite(idx) && sources[idx]) {
          sources[idx].projectId = String(el.value || '').trim();
          sources[idx].layers = []; // reset layer selection on project change
          await renderSearchSources();
        }
        return;
      }

      const allIdxAttr = el.getAttribute('data-search-source-all');
      if (allIdxAttr !== null) {
        const idx = Number.parseInt(allIdxAttr, 10);
        if (Number.isFinite(idx) && sources[idx]) {
          if (el.checked) {
            sources[idx].layers = []; // empty = all
          } else {
            // Pre-populate with all catalog entries so user can uncheck
            const pid = sources[idx].projectId;
            const catalog = publishState.searchSourceCatalog[pid] || [];
            sources[idx].layers = catalog.map((l) => l.name);
          }
          await renderSearchSources();
        }
        return;
      }

      const layerIdxAttr = el.getAttribute('data-search-source-layer');
      if (layerIdxAttr !== null) {
        const idx = Number.parseInt(layerIdxAttr, 10);
        if (Number.isFinite(idx) && sources[idx]) {
          const layerName = String(el.value || '').trim();
          if (!layerName) return;
          const set = new Set(sources[idx].layers || []);
          if (el.checked) set.add(layerName); else set.delete(layerName);
          sources[idx].layers = Array.from(set);
          // Re-render to update the (n/m) counter in the summary
          await renderSearchSources();
        }
      }
    });
    host.addEventListener('click', (event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement)) return;
      const removeIdxAttr = el.getAttribute('data-search-source-remove');
      if (removeIdxAttr !== null) {
        const idx = Number.parseInt(removeIdxAttr, 10);
        if (Number.isFinite(idx)) {
          publishState.searchSources.splice(idx, 1);
          renderSearchSources();
        }
      }
    });
  }
}

/* ── Publish editor ── */
function openPublishModal() {
  if (publishModal) {
    publishModal.hidden = false;
  }
  clearPublishStatusError();
  document.body.classList.add('publish-editor-open');
  refreshExtraSections();
  // Ensure controls textarea reflects checkboxes when no saved controls yet
  if (controlsJsonInput && !controlsJsonInput.value.trim()) syncControlsFromCheckboxes();
  setPublishModalTab('layers');
  renderPublishConfigSummary();
  updatePublishModalFullscreenButton();
}
function closePublishModal() {
  if (publishModal) publishModal.hidden = true;
  if (publishModal) publishModal.classList.remove('publish-editor--fullscreen');
  document.body.classList.remove('publish-editor-open');
  // Clear preview iframe to remove residual
  if (previewIframe) previewIframe.src = '';
  setPreviewOverlayState('idle');
  publishState.editingProfileId = null;
  clearPublishStatusError();
  publishState.groups = [];
  publishState.layerGroups = {};
  publishState.initialVisibility = {};
  publishState.controls = {};
  publishState.extraLayers = [];
  updatePublishModalFullscreenButton();
}

async function preparePublishModal(editProfileId = null) {
  publishState.editingProfileId = editProfileId;
  await loadProjectsForPublish();

  if (editProfileId) {
    // Edit mode: load existing profile and prefill
    if (modalTitle) modalTitle.textContent = t('Qtiler2Origo.modal_title_edit', { id: editProfileId });
    let profile;
    try {
      profile = await api(`/plugins/Qtiler2Origo/published/${encodeURIComponent(editProfileId)}.json`);
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

      const savedLayerRows = Array.isArray(profile.layers) ? profile.layers : [];
      const savedMain = savedLayerRows.filter((layer) => String(layer?.role || 'main') !== 'background');
      const savedExternal = savedMain.filter((layer) => {
        const srcPid = String(layer?.sourceProjectId || '').trim();
        return srcPid && srcPid !== mainProjectId;
      });
      for (const layer of savedExternal) {
        const srcPid = String(layer?.sourceProjectId || '').trim();
        const layerName = String(layer?.name || '').trim();
        if (!srcPid || !layerName) continue;
        const externalLayer = {
          key: makeLayerKey(srcPid, layerName),
          name: layerName,
          sourceProjectId: srcPid,
          geometry: String(layer?.geometryType || '').trim()
        };
        if (!publishState.extraLayers.some((row) => getLayerKey(row) === externalLayer.key)) {
          publishState.extraLayers.push(externalLayer);
        }
      }
      savedMain.forEach((layer) => {
        const key = makeLayerKey(String(layer?.sourceProjectId || mainProjectId).trim() || mainProjectId, String(layer?.name || '').trim());
        if (!key) return;
        publishState.mainRules[key] = {
          ...(publishState.mainRules[key] || {}),
          serveAsWfs: layer?.serveAsWfs === true,
          wfsStyle: layer?.wfsStyle || null,
          designerOptions: layer?.designerOptions && typeof layer.designerOptions === 'object'
            ? JSON.parse(JSON.stringify(layer.designerOptions))
            : (publishState.mainRules[key]?.designerOptions || {}),
          attributes: Array.isArray(layer?.attributes) ? JSON.parse(JSON.stringify(layer.attributes)) : (publishState.mainRules[key]?.attributes || []),
          searchable: layer?.searchable === true,
          editable: layer?.editable !== false,
          geometryType: String(layer?.geometryType || publishState.mainRules[key]?.geometryType || '').trim() || null
        };
      });
      // Background project and selected/default background state
      const profileBackgrounds = Array.isArray(profile.backgrounds) ? profile.backgrounds : [];
      const defaultLayerBackground = profileBackgrounds.find((bg) => bg && bg.type === 'layer' && bg.isDefault === true);
      const firstLayerBackground = profileBackgrounds.find((bg) => bg && bg.type === 'layer' && bg.sourceProjectId && bg.name);
      const bgProjectId = String(
        profile.backgroundProjectId
        || defaultLayerBackground?.sourceProjectId
        || firstLayerBackground?.sourceProjectId
        || ''
      ).trim();
      publishState.defaultBackgroundKey = String(
        profile.defaultBackgroundKey
        || defaultLayerBackground?.key
        || (defaultLayerBackground?.sourceProjectId && defaultLayerBackground?.name
          ? `layer:${defaultLayerBackground.sourceProjectId}:${defaultLayerBackground.name}`
          : 'none')
      ).trim() || 'none';
      if (backgroundProjectSelect) backgroundProjectSelect.value = bgProjectId;
      if (bgProjectId) {
        await loadProjectLayers(bgProjectId, 'background');
        // Saved profile may store backgrounds either as a flat
        // `backgroundLayerNames` array or as the structured `backgrounds`
        // entries (each with type==='layer' and a `name`). Support both so
        // editing an existing profile pre-checks the correct boxes.
        let savedBgNames = Array.isArray(profile.backgroundLayerNames) ? profile.backgroundLayerNames.slice() : [];
        if (!savedBgNames.length && profileBackgrounds.length) {
          savedBgNames = profileBackgrounds
            .filter((b) => b && b.type === 'layer' && String(b.sourceProjectId || '').trim() === bgProjectId && b.name)
            .map((b) => String(b.name));
        }
        if (!savedBgNames.length) {
          savedBgNames = savedLayerRows
            .filter((layer) => String(layer?.role || '').trim() === 'background' && String(layer?.sourceProjectId || '').trim() === bgProjectId)
            .map((layer) => String(layer?.name || '').trim())
            .filter(Boolean);
        }
        const savedBgKeys = (publishState.backgroundLayers || [])
          .filter((layer) => savedBgNames.includes(String(layer?.name || '').trim()))
          .map((layer) => getLayerKey(layer));
        setCheckedLayerNames(backgroundLayersList, savedBgKeys);
      }

      const includedSet = new Set(savedMain
        .map((l) => makeLayerKey(String(l?.sourceProjectId || mainProjectId).trim() || mainProjectId, String(l.name || '').trim()))
        .filter(Boolean));
      const visibleSet = new Set(savedMain
        .filter((l) => (typeof l.visible === 'undefined' ? true : !!l.visible))
        .map((l) => makeLayerKey(String(l?.sourceProjectId || mainProjectId).trim() || mainProjectId, String(l.name || '').trim())));

      publishState.initialVisibility = {};
      includedSet.forEach((key) => {
        publishState.initialVisibility[key] = visibleSet.has(key);
      });

      renderLayerChecklist(projectLayersList, getAllPublishLayers(), publishState.mainRules);
      setCheckedLayerNames(projectLayersList, Array.from(includedSet));

      // Default background
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

      // Groups, per-layer placement and module controls
      publishState.groups = Array.isArray(profile.groups)
        ? profile.groups.map((g) => ({
            name: String(g?.name || '').trim(),
            title: String(g?.title || g?.name || '').trim(),
            parent: String(g?.parent || '').trim(),
            expanded: g?.expanded !== false
          })).filter((g) => g.name)
        : [];
      publishState.layerGroups = {};
      savedMain.forEach((l) => {
        const ln = String(l?.name || '').trim();
        if (ln) publishState.layerGroups[ln] = String(l?.group || 'root').trim() || 'root';
      });
      // Restore Origo controls: update textarea and checkboxes
      const savedControls = Array.isArray(profile.controls) ? profile.controls : [];
      publishState.controls = savedControls;
      if (controlsJsonInput) controlsJsonInput.value = JSON.stringify(savedControls, null, 2);
      syncCheckboxesFromControls(savedControls);
      // Restore extraJson fields
      if (extraJsonInput) {
        const extra = {};
        if (profile.pageSettings) extra.pageSettings = profile.pageSettings;
        if (profile.featureinfoOptions) extra.featureinfoOptions = profile.featureinfoOptions;
        if (Object.keys(extra).length) extraJsonInput.value = JSON.stringify(extra, null, 2);
      }
      // Restore center/zoom/extent
      if (centerInput && Array.isArray(profile.center)) {
        centerInput.value = JSON.stringify(profile.center);
        if (profile.centerCrs) centerInput.dataset.crs = String(profile.centerCrs);
        else delete centerInput.dataset.crs;
      }
      if (zoomInput && typeof profile.zoom === 'number') zoomInput.value = profile.zoom;
      if (extentInput && Array.isArray(profile.extent)) extentInput.value = JSON.stringify(profile.extent);
      if (minZoomInput) minZoomInput.value = Number.isFinite(Number(profile.minZoom)) ? Number(profile.minZoom) : '';
      if (maxZoomInput) maxZoomInput.value = Number.isFinite(Number(profile.maxZoom)) ? Number(profile.maxZoom) : '';
      refreshExtraSections();
      const sCfg = (Array.isArray(savedControls) ? savedControls : []).find?.(c => c?.name === 'search') || {};
      const sHint = document.getElementById('Qtiler2OrigoSearchHint');
      const sMin = document.getElementById('Qtiler2OrigoSearchMin');
      const sLim = document.getElementById('Qtiler2OrigoSearchLimit');
      if (sHint) sHint.value = sCfg.hintText || '';
      if (sMin && Number.isFinite(Number(sCfg.minLength))) sMin.value = Number(sCfg.minLength);
      if (sLim && Number.isFinite(Number(sCfg.limit))) sLim.value = Number(sCfg.limit);
      // Restore cross-project search sources
      publishState.searchSources = Array.isArray(profile?.features?.searchSources)
        ? profile.features.searchSources
            .map((src) => ({
              projectId: String(src?.projectId || '').trim(),
              layers: Array.isArray(src?.layers)
                ? src.layers.map((l) => String(l || '').trim()).filter(Boolean)
                : []
            }))
            .filter((s) => s.projectId)
        : [];
      // Seed with the current project so the picker always shows a usable
      // starting row (otherwise the section appears empty).
      if (!publishState.searchSources.length) {
        const curPid = String(publishProjectSelect?.value || '').trim();
        if (curPid) publishState.searchSources = [{ projectId: curPid, layers: [] }];
      }
      publishState.searchSourceCatalog = {};
      await renderSearchSources();
    }
  } else {
    // New mode
    if (modalTitle) modalTitle.textContent = t('Qtiler2Origo.modal_title');
    if (publishName) { publishName.value = ''; publishName.disabled = false; }
    if (publishDescription) publishDescription.value = '';
    if (publishNameError) publishNameError.style.display = 'none';
    publishState.defaultBackgroundKey = 'none';
    const mainProjectId = String(publishProjectSelect.value || '').trim();
    if (mainProjectId) await loadProjectLayers(mainProjectId, 'main');
    backgroundLayersList.innerHTML = `<p class="help">${escapeHtml(t('Qtiler2Origo.optional_select'))}</p>`;
    refreshBackgroundOptions();
    // Reset Origo controls to defaults
    ORIGO_CTRL_DEFS.forEach((def) => {
      const cb = document.getElementById(def.id);
      if (cb) cb.checked = ['home','zoom','mapmenu','legend','scaleline'].includes(def.name);
    });
    syncControlsFromCheckboxes();
    if (centerInput) { centerInput.value = ''; delete centerInput.dataset.crs; }
    if (zoomInput) zoomInput.value = '';
    if (extentInput) extentInput.value = '';
    if (minZoomInput) minZoomInput.value = '';
    if (maxZoomInput) maxZoomInput.value = '';
    if (extraJsonInput) extraJsonInput.value = '';
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
    // Reset cross-project search sources. Seed with the current project so
    // the picker shows a usable starting row instead of just the help text.
    {
      const curPid = String(publishProjectSelect?.value || '').trim();
      publishState.searchSources = curPid ? [{ projectId: curPid, layers: [] }] : [];
    }
    publishState.searchSourceCatalog = {};
    renderSearchSources();
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
    await api('/plugins/Qtiler2Origo/api/install', {
      method: 'POST',
      body: { repo: String(repoEl.value || '').trim(), version: String(versionEl.value || '').trim() }
    });
    addLog(t('Qtiler2Origo.log_installed'), 'ok');
    await loadStatus();
    await loadPublishedProfiles();
  } catch (err) {
    addLog(t('Qtiler2Origo.log_error', { msg: err.message }), 'error');
  } finally {
    installBtn.disabled = false;
  }
});

uninstallBtn?.addEventListener('click', async () => {
  uninstallBtn.disabled = true;
  try {
    await api('/plugins/Qtiler2Origo/api/install', { method: 'DELETE' });
    addLog(t('Qtiler2Origo.log_uninstalled'), 'ok');
    await loadStatus();
  } catch (err) {
    addLog(t('Qtiler2Origo.log_error', { msg: err.message }), 'error');
  } finally {
    syncUI();
  }
});

uploadLogoBtn?.addEventListener('click', async () => {
  const file = logoFileInput?.files?.[0];
  if (!file) { addLog(t('Qtiler2Origo.logo_select_file'), 'error'); return; }
  uploadLogoBtn.disabled = true;
  try {
    const body = new FormData();
    body.append('logo', file, file.name || 'logo');
    await api('/plugins/Qtiler2Origo/api/branding/logo', { method: 'POST', body });
    if (logoFileInput) logoFileInput.value = '';
    addLog(t('Qtiler2Origo.log_logo_uploaded'), 'ok');
    await loadStatus();
  } catch (err) {
    addLog(t('Qtiler2Origo.log_error', { msg: err.message }), 'error');
  } finally {
    syncUI();
  }
});

removeLogoBtn?.addEventListener('click', async () => {
  removeLogoBtn.disabled = true;
  try {
    await api('/plugins/Qtiler2Origo/api/branding/logo', { method: 'DELETE' });
    if (logoFileInput) logoFileInput.value = '';
    addLog(t('Qtiler2Origo.log_logo_removed'), 'ok');
    await loadStatus();
  } catch (err) {
    addLog(t('Qtiler2Origo.log_error', { msg: err.message }), 'error');
  } finally {
    syncUI();
  }
});

openPublishModalBtn?.addEventListener('click', async () => {
  openPublishModalBtn.disabled = true;
  try {
    await preparePublishModal(null);
  } catch (err) {
    addLog(t('Qtiler2Origo.log_error', { msg: err.message }), 'error');
  } finally {
    openPublishModalBtn.disabled = false;
  }
});

publishProjectSelect?.addEventListener('change', async () => {
  const projectId = String(publishProjectSelect.value || '').trim();
  if (!projectId) {
    projectLayersList.innerHTML = `<p class="help">${escapeHtml(t('Qtiler2Origo.no_project_selected'))}</p>`;
    schedulePreviewRefresh();
    return;
  }
  try { await loadProjectLayers(projectId, 'main'); schedulePreviewRefresh(); } catch (err) { addLog(t('Qtiler2Origo.log_error', { msg: err.message }), 'error'); }
});

backgroundProjectSelect?.addEventListener('change', async () => {
  const projectId = String(backgroundProjectSelect.value || '').trim();
  if (!projectId) {
    backgroundLayersList.innerHTML = `<p class="help">${escapeHtml(t('Qtiler2Origo.no_bg_selected'))}</p>`;
    refreshBackgroundOptions();
    schedulePreviewRefresh();
    return;
  }
  try { await loadProjectLayers(projectId, 'background'); schedulePreviewRefresh(); } catch (err) { addLog(t('Qtiler2Origo.log_error', { msg: err.message }), 'error'); }
});

backgroundLayersList?.addEventListener('change', () => {
  refreshBackgroundOptions();
  schedulePreviewRefresh();
});

projectLayersList?.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;

  if (target.hasAttribute('data-wfs-toggle')) {
    const layerName = String(target.getAttribute('data-wfs-toggle') || '').trim();
    if (!layerName) return;
    if (!publishState.mainRules[layerName]) {
      publishState.mainRules[layerName] = { searchable: false, editable: true, serveAsWfs: false };
    }
    publishState.mainRules[layerName].serveAsWfs = target.checked;
    
    // Re-render to update tags and button colors
    const checkedNames = getCheckedLayerNames(projectLayersList);
    renderLayerChecklist(projectLayersList, getAllPublishLayers(), publishState.mainRules);
    setCheckedLayerNames(projectLayersList, checkedNames);
    renderLayerAssignments();
    schedulePreviewRefresh();
    return;
  }

  if (target.hasAttribute('data-layer-visible')) {
    const layerKey = String(target.getAttribute('data-layer-visible') || '').trim();
    if (!layerKey) return;
    publishState.initialVisibility[layerKey] = target.checked;
    schedulePreviewRefresh();
    return;
  }

  if (!target.hasAttribute('data-layer-include')) return;
  renderLayerAssignments();
  schedulePreviewRefresh();
});

projectLayersList?.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest('button[data-style-layer]');
  if (!button) return;
  const layerName = String(button.getAttribute('data-style-layer') || '').trim();
  if (!layerName) return;
  openStyleEditor(layerName);
});

defaultBackgroundList?.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== 'radio') return;
  const key = String(target.getAttribute('data-default-bg-key') || '').trim();
  if (key) {
    publishState.defaultBackgroundKey = key;
    // Update "Default" tags in-place
    defaultBackgroundList.querySelectorAll('.Qtiler2Origo-bg-item').forEach((row) => {
      const radio = row.querySelector('input[type="radio"]');
      const existing = row.querySelector('.Qtiler2Origo-bg-item__default-tag');
      if (radio?.checked && !existing) {
        const tag = document.createElement('span');
        tag.className = 'Qtiler2Origo-bg-item__default-tag';
        tag.textContent = t('Qtiler2Origo.default');
        row.appendChild(tag);
      } else if (!radio?.checked && existing) {
        existing.remove();
      }
    });
    schedulePreviewRefresh();
  }
});

publishNowBtn?.addEventListener('click', async () => {
  const mapName = String(publishName?.value || '').trim();
  const mapDescription = String(publishDescription?.value || '').trim();
  clearPublishStatusError();
  if (!mapName) {
    if (publishNameError) { publishNameError.textContent = t('Qtiler2Origo.name_required'); publishNameError.style.display = ''; }
    publishName?.focus();
    return;
  }
  if (publishNameError) publishNameError.style.display = 'none';

  // Check unique name (only for new profiles, not edits)
  if (!publishState.editingProfileId) {
    const duplicate = publishedItems.some((item) => (item.name || item.projectId || '').toLowerCase() === mapName.toLowerCase());
    if (duplicate) {
      if (publishNameError) { publishNameError.textContent = t('Qtiler2Origo.name_duplicate'); publishNameError.style.display = ''; }
      publishName?.focus();
      return;
    }
  }

  const projectId = String(publishProjectSelect.value || '').trim();
  if (!projectId) { showPublishStatusError('Select a main project before publishing.', 'layers'); return; }
  const allLayers = getAllPublishLayers();
  if (!allLayers.length) { showPublishStatusError('No project layers are available. Check project access or reload the modal.', 'layers'); return; }

  const checkedSet = new Set(getCheckedLayerNames(projectLayersList));
  const selectedLayers = allLayers.filter((layer) => checkedSet.has(getLayerKey(layer)));
  if (!selectedLayers.length) { showPublishStatusError('Select at least one main layer to publish.', 'layers'); return; }

  const layersPayload = selectedLayers.map((layer) => {
    const key = getLayerKey(layer);
    return {
      name: layer.name,
      sourceProjectId: String(layer.sourceProjectId || projectId).trim() || projectId,
      visible: publishState.initialVisibility[key] !== false,
      group: String(publishState.layerGroups[key] || 'root').trim() || 'root'
    };
  });

  const backgroundProjectId = String(backgroundProjectSelect.value || '').trim();
  const backgroundLayerNames = getCheckedLayers(backgroundLayersList, publishState.backgroundLayers || [])
    .map((layer) => String(layer?.name || '').trim())
    .filter(Boolean);
  refreshBackgroundOptions();
  const backgrounds = (publishState.backgroundOptions || []).map((item) => ({
    key: item.key, type: item.type, title: item.title,
    sourceProjectId: item.type === 'layer' ? item.sourceProjectId : null,
    name: item.type === 'layer' ? item.name : null,
    isDefault: item.key === publishState.defaultBackgroundKey
  }));
  const layerRules = {};
  selectedLayers.forEach((layer) => {
    const key = getLayerKey(layer);
    layerRules[key] = publishState.mainRules[key] || { searchable: false, editable: false };
  });

  publishNowBtn.disabled = true;
  try {
      await api('/plugins/Qtiler2Origo/api/publish', {
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
        controls: (function(){ try { return JSON.parse(controlsJsonInput?.value || '[]'); } catch(e){ return []; } })(),
        pageSettings: (function(){ try { return JSON.parse(extraJsonInput?.value || '{}').pageSettings; } catch(e){ return undefined; } })(),
        featureinfoOptions: (function(){ try { return JSON.parse(extraJsonInput?.value || '{}').featureinfoOptions; } catch(e){ return undefined; } })(),
        extent: (function(){ try { const v = JSON.parse(extentInput?.value || 'null'); return Array.isArray(v) ? v : undefined; } catch(e){ return undefined; } })(),
        center: (function(){ try { const v = JSON.parse(centerInput?.value || 'null'); return Array.isArray(v) ? v : undefined; } catch(e){ return undefined; } })(),
        centerCrs: (function(){ const c = String(centerInput?.dataset?.crs || '').trim(); return c || undefined; })(),
        zoom: (function(){ try { const z = parseFloat(zoomInput?.value); return isNaN(z) ? undefined : z; } catch(e){ return undefined; } })(),
        minZoom: (function(){ const z = parseInt(minZoomInput?.value, 10); return Number.isFinite(z) ? z : undefined; })(),
        maxZoom: (function(){ const z = parseInt(maxZoomInput?.value, 10); return Number.isFinite(z) ? z : undefined; })(),
        toolConfig: {
          shareServiceUrl: String(cfgShareUrl?.value || '').trim(),
          routingServiceUrl: String(cfgRoutingUrl?.value || '').trim(),
          elevationServiceUrl: String(cfgElevationUrl?.value || '').trim(),
          dxfExportServiceUrl: String(cfgDxfUrl?.value || '').trim()
        },
        groups: (publishState.groups || [])
          .map((g) => ({
            name: String(g?.name || '').trim(),
            title: String(g?.title || g?.name || '').trim(),
            parent: String(g?.parent || '').trim(),
            expanded: g?.expanded !== false
          }))
          .filter((g) => g.name && g.name !== 'root' && g.name !== 'background'),
        features: {
          // Cross-project search sources (other feature flags are derived
          // server-side from defaults; only fields we manage explicitly are
          // forwarded here).
          searchSources: (Array.isArray(publishState.searchSources) ? publishState.searchSources : [])
            .map((src) => ({
              projectId: String(src?.projectId || '').trim(),
              layers: Array.isArray(src?.layers)
                ? src.layers.map((l) => String(l || '').trim()).filter(Boolean)
                : []
            }))
            .filter((s) => s.projectId)
        }
      }
    });
    addLog(t('Qtiler2Origo.log_published', { id: mapName }), 'ok');
    closePublishModal();
    await loadStatus();
    await loadPublishedProfiles();
  } catch (err) {
    if (err.message && err.message.includes('409')) {
      if (publishNameError) { publishNameError.textContent = t('Qtiler2Origo.name_duplicate'); publishNameError.style.display = ''; }
      publishName?.focus();
    } else {
      showPublishStatusError(String(err.message || 'Publish failed.'), 'layers');
    }
  } finally {
    publishNowBtn.disabled = false;
  }
});

removeDemoBtn?.addEventListener('click', async () => {
  if (!window.confirm('Remove bundled demo theme from installed Origo?')) return;
  removeDemoBtn.disabled = true;
  try {
    const r = await api('/plugins/Qtiler2Origo/api/remove-demo', { method: 'POST' });
    addLog(`Removed demo entries: ${r?.removed || 0}`, 'ok');
    await loadStatus();
    await loadPublishedProfiles();
  } catch (err) {
    addLog(t('Qtiler2Origo.log_error', { msg: err.message }), 'error');
  } finally {
    removeDemoBtn.disabled = false;
  }
});

/* ── Duplicate published webmap ── */
function ensureDuplicateProfileModal() {
  let modal = document.getElementById('Qtiler2OrigoDuplicateModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'Qtiler2OrigoDuplicateModal';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-background" data-dup-close></div>
    <div class="modal-card" style="max-width:480px">
      <header class="modal-card-head">
        <p class="modal-card-title" data-dup-title></p>
        <button class="delete" aria-label="close" data-dup-close></button>
      </header>
      <section class="modal-card-body">
        <p class="help" data-dup-help style="margin-bottom:10px"></p>
        <div class="field">
          <label class="label" data-dup-label></label>
          <div class="control">
            <input class="input" type="text" data-dup-input autocomplete="off" />
          </div>
          <p class="help is-danger" data-dup-error style="display:none"></p>
        </div>
      </section>
      <footer class="modal-card-foot" style="justify-content:flex-end;gap:8px">
        <button class="button" data-dup-close data-dup-cancel></button>
        <button class="button is-primary" data-dup-confirm></button>
      </footer>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-dup-close]').forEach((el) => el.addEventListener('click', () => closeDuplicateProfileModal()));
  modal.querySelector('[data-dup-input]').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); modal.querySelector('[data-dup-confirm]').click(); }
    if (e.key === 'Escape') { e.preventDefault(); closeDuplicateProfileModal(); }
  });
  return modal;
}

let duplicateSourceKey = null;
function openDuplicateProfileModal(sourceKey, sourceName) {
  const modal = ensureDuplicateProfileModal();
  duplicateSourceKey = sourceKey;
  modal.querySelector('[data-dup-title]').textContent = t('Qtiler2Origo.duplicate_title');
  modal.querySelector('[data-dup-help]').textContent = t('Qtiler2Origo.duplicate_help');
  modal.querySelector('[data-dup-label]').textContent = t('Qtiler2Origo.duplicate_new_name');
  modal.querySelector('[data-dup-confirm]').textContent = t('Qtiler2Origo.duplicate_btn');
  modal.querySelector('[data-dup-cancel]').textContent = t('Qtiler2Origo.wfs_cancel') || 'Cancel';
  const input = modal.querySelector('[data-dup-input]');
  const err = modal.querySelector('[data-dup-error]');
  err.style.display = 'none';
  err.textContent = '';
  input.value = `${sourceName} (copy)`;
  modal.classList.add('is-active');
  setTimeout(() => { input.focus(); input.select(); }, 30);
}

function closeDuplicateProfileModal() {
  const modal = document.getElementById('Qtiler2OrigoDuplicateModal');
  if (modal) modal.classList.remove('is-active');
  duplicateSourceKey = null;
}

document.addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-dup-confirm]');
  if (!btn) return;
  const modal = document.getElementById('Qtiler2OrigoDuplicateModal');
  if (!modal || !duplicateSourceKey) return;
  const input = modal.querySelector('[data-dup-input]');
  const err = modal.querySelector('[data-dup-error]');
  const newName = String(input.value || '').trim();
  err.style.display = 'none';
  err.textContent = '';
  if (!newName) {
    err.textContent = t('Qtiler2Origo.name_required') || 'Name is required.';
    err.style.display = '';
    return;
  }
  const collides = (publishedItems || []).some((it) => String(it.name || it.profileKey || '').toLowerCase() === newName.toLowerCase());
  if (collides) {
    err.textContent = t('Qtiler2Origo.name_duplicate') || 'Name already in use.';
    err.style.display = '';
    return;
  }
  btn.disabled = true;
  try {
    await api('/plugins/Qtiler2Origo/api/publish/duplicate', {
      method: 'POST',
      body: { source: duplicateSourceKey, name: newName }
    });
    addLog(t('Qtiler2Origo.duplicate_done', { id: newName }), 'ok');
    closeDuplicateProfileModal();
    await loadPublishedProfiles();
  } catch (e) {
    if (e?.message && e.message.includes('409')) {
      err.textContent = t('Qtiler2Origo.name_duplicate') || 'Name already in use.';
      err.style.display = '';
    } else {
      addLog(t('Qtiler2Origo.log_error', { msg: e.message || String(e) }), 'error');
    }
  } finally {
    btn.disabled = false;
  }
});

/* ── Edit / delete published ── */
publishedProfilesList?.addEventListener('click', async (event) => {
  const editBtn = event.target.closest('button[data-edit-published]');
  if (editBtn) {
    const projectId = String(editBtn.getAttribute('data-edit-published') || '').trim();
    if (!projectId) return;
    try { await preparePublishModal(projectId); } catch (err) { addLog(t('Qtiler2Origo.log_error', { msg: err.message }), 'error'); }
    return;
  }

  const dupBtn = event.target.closest('button[data-duplicate-published]');
  if (dupBtn) {
    const sourceKey = String(dupBtn.getAttribute('data-duplicate-published') || '').trim();
    const sourceName = String(dupBtn.getAttribute('data-duplicate-name') || sourceKey).trim();
    if (!sourceKey) return;
    openDuplicateProfileModal(sourceKey, sourceName);
    return;
  }

  const deleteBtn = event.target.closest('button[data-delete-published]');
  if (deleteBtn) {
    const profileName = String(deleteBtn.getAttribute('data-delete-published') || '').trim();
    if (!profileName) return;
    if (!window.confirm(t('Qtiler2Origo.confirm_delete', { id: profileName }))) return;
    deleteBtn.disabled = true;
    try {
      await api(`/plugins/Qtiler2Origo/api/publish/${encodeURIComponent(profileName)}`, { method: 'DELETE' });
      addLog(t('Qtiler2Origo.log_deleted', { id: profileName }), 'ok');
      await loadPublishedProfiles();
    } catch (err) {
      addLog(t('Qtiler2Origo.log_error', { msg: err.message }), 'error');
    }
  }

  const regenBtn = event.target.closest('button[data-regen-thumb]');
  if (regenBtn) {
    const projectId = String(regenBtn.getAttribute('data-regen-thumb') || '').trim();
    if (!projectId) return;
    regenBtn.disabled = true;
    try {
      const r = await api(`/plugins/Qtiler2Origo/api/thumbnail/cache/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
      addLog(t('Qtiler2Origo.log_thumb_regen', { id: projectId, n: r?.removed ?? 0 }), 'ok');
      // Force the <img> in the affected card to reload from a fresh thumbnail.
      const card = regenBtn.closest('.published-item');
      const img = card?.querySelector('.published-item__preview img');
      if (img) {
        const base = img.getAttribute('src') || '';
        const sep = base.includes('?') ? '&' : '?';
        img.src = `${base}${sep}_=${Date.now()}`;
      }
    } catch (err) {
      addLog(t('Qtiler2Origo.log_error', { msg: err.message }), 'error');
    } finally {
      regenBtn.disabled = false;
    }
  }
});

closePublishModalTop?.addEventListener('click', closePublishModal);
closePublishModalBottom?.addEventListener('click', closePublishModal);
publishModalToggleFullscreen?.addEventListener('click', () => {
  publishModal?.classList.toggle('publish-editor--fullscreen');
  updatePublishModalFullscreenButton();
});
publishModalTabButtons.forEach((button) => {
  button.addEventListener('click', () => setPublishModalTab(button.getAttribute('data-publish-tab')));
});

/* ── Origo preview panel ── */
function buildMapPreviewPayload() {
  const projectId = String(publishProjectSelect?.value || '').trim();
  if (!projectId) return '';
  const selectedLayers = getSelectedPublishLayers();
  const previewLayerSpecs = selectedLayers.map((layer) => ({
    name: layer.name,
    sourceProjectId: String(layer.sourceProjectId || projectId).trim() || projectId,
    visible: publishState.initialVisibility[getLayerKey(layer)] !== false,
    group: String(publishState.layerGroups?.[getLayerKey(layer)] || 'root').trim() || 'root'
  }));
  const layersParam = previewLayerSpecs.length ? JSON.stringify(previewLayerSpecs) : '';
  const previewLayerRules = {};
  selectedLayers.forEach((layer) => {
    const key = getLayerKey(layer);
    previewLayerRules[key] = publishState.mainRules[key] || { searchable: false, editable: false };
  });
  const layerRulesParam = Object.keys(previewLayerRules).length ? JSON.stringify(previewLayerRules) : '';
  // Resolve the active background so the preview map uses the SAME tile grid
  // and CRS as the published profile, instead of OSM-only defaults.
  const bgKey = publishState.defaultBackgroundKey || '';
  let bgProject = '';
  let bgLayer = '';
  if (bgKey && bgKey.startsWith('layer:')) {
    const parts = bgKey.split(':');
    bgProject = parts[1] || '';
    bgLayer = parts.slice(2).join(':') || '';
  }
  // Forward the currently-edited view (center/zoom/extent) so the preview
  // opens where the profile was last saved instead of zoomed all the way out.
  const centerStr = String(centerInput?.value || '').trim();
  const zoomStr   = String(zoomInput?.value   || '').trim();
  const extentStr = String(extentInput?.value || '').trim();
  // The CRS the captured center/extent are expressed in. Tracked on the
  // input element so the server can reject stale coordinates whose CRS no
  // longer matches the active background (e.g. captured in OSM/3857, then
  // user switches to a 3006 background — reusing those coords would push
  // the view to the North Pole).
  const centerCrs = String(centerInput?.dataset?.crs || '').trim();
  // Forward admin-defined min/max zoom so the preview pyramid is extended
  // deep enough — otherwise the WMTS background's shallow pyramid (e.g. 14
  // levels for 3006) would clamp the preview no matter what the user typed.
  const minZoomStr = String(document.getElementById('origo-cfg-min-zoom')?.value || '').trim();
  const maxZoomStr = String(document.getElementById('origo-cfg-max-zoom')?.value || '').trim();
  return {
    project: projectId,
    layers: previewLayerSpecs,
    layerRules: previewLayerRules,
    bgProject,
    bgLayer,
    bgKey,
    center: centerStr || '',
    zoom: zoomStr || '',
    extent: extentStr || '',
    centerCrs: centerCrs || '',
    minZoom: minZoomStr || '',
    maxZoom: maxZoomStr || '',
    controls: getNormalizedControlsArray()
  };
}

async function buildMapPreviewUrl() {
  const payload = buildMapPreviewPayload();
  if (!payload) return '';
  const res = await fetch('/plugins/Qtiler2Origo/api/preview-state', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(detail || `Preview state failed (${res.status})`);
  }
  const data = await res.json().catch(() => null);
  return typeof data?.url === 'string' ? data.url : '';
}

function setPreviewOverlayState(state, message = '') {
  if (!previewOverlay) return;
  const normalized = String(state || 'idle').trim().toLowerCase() || 'idle';
  previewOverlay.dataset.state = normalized;
  previewOverlay.style.display = normalized === 'ready' ? 'none' : '';
  if (previewOverlayTitle) {
    previewOverlayTitle.textContent = normalized === 'error' ? 'Interactive Map error' : 'Interactive Map';
  }
  if (previewOverlayMessage) {
    previewOverlayMessage.textContent = String(message || (normalized === 'loading'
      ? 'Cargando capas del mapa…'
      : normalized === 'error'
        ? 'No se pudo cargar el mapa.'
        : 'Pulsa Load Preview para cargar el mapa'));
  }
}

function formatPreviewErrorMessage(errorLike, fallback = 'No se pudo cargar el mapa.') {
  const raw = typeof errorLike === 'string'
    ? errorLike
    : errorLike?.message || errorLike?.error || errorLike?.detail || '';
  const text = String(raw || '').trim();
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    const fromJson = parsed?.error || parsed?.details || parsed?.message || '';
    if (String(fromJson || '').trim()) return String(fromJson).trim();
  } catch {}
  return text;
}

async function loadMapPreview(options = {}) {
  const { silent = false } = options;
  let src = '';
  setPreviewOverlayState('loading', 'Preparando Interactive Map…');
  try {
    src = await buildMapPreviewUrl();
  } catch (err) {
    const detail = formatPreviewErrorMessage(err, 'No se pudo preparar el preview.');
    setPreviewOverlayState('error', detail);
    if (!silent) addLog(`No se pudo preparar el preview: ${detail}`, 'error');
    return '';
  }
  if (!src) {
    setPreviewOverlayState('error', 'Selecciona un proyecto principal primero.');
    if (!silent) addLog('Selecciona un proyecto principal primero.', 'error');
    return '';
  }
  if (previewIframe) previewIframe.src = src;
  setPreviewOverlayState('loading', 'Cargando capas del mapa…');
  if (!silent) addLog('Cargando mapa preview…', 'info');
  renderPublishConfigSummary();
  return src;
}

let publishPreviewRefreshTimer = null;
function schedulePreviewRefresh() {
  if (publishPreviewRefreshTimer) window.clearTimeout(publishPreviewRefreshTimer);
  publishPreviewRefreshTimer = window.setTimeout(() => {
    publishPreviewRefreshTimer = null;
    if (activePublishTab === 'config') {
      loadMapPreview({ silent: true }).catch(() => {});
    }
  }, 150);
}

document.getElementById('btn-load-map-preview')?.addEventListener('click', () => {
  loadMapPreview().catch(() => {});
});
openPreviewTabBtn?.addEventListener('click', async () => {
  const src = await loadMapPreview({ silent: true });
  if (src) window.open(src, '_blank', 'noopener,noreferrer');
});

// Listen for origo-loaded message from the preview iframe
window.addEventListener('message', (ev) => {
  if (ev.data?.type === 'origo-loaded') {
    setPreviewOverlayState('ready');
    addLog('Mapa preview listo. Puedes capturar el extent.', 'ok');
    return;
  }
  if (ev.data?.type === 'origo-error') {
    const detail = formatPreviewErrorMessage(ev.data?.message || ev.data?.error, 'No se pudo cargar el mapa interactivo.');
    setPreviewOverlayState('error', detail);
    addLog(`Error en Interactive Map: ${detail}`, 'error');
  }
});

previewIframe?.addEventListener('error', () => {
  const detail = 'El iframe del Interactive Map no pudo cargarse.';
  setPreviewOverlayState('error', detail);
  addLog(detail, 'error');
});

// Read the current OL view from the preview iframe. Returns null if the
// preview has not loaded yet.
function getPreviewView() {
  try {
    const win = previewIframe?.contentWindow;
    const origoApp = win?.origoApp;
    if (!origoApp) return null;
    const viewer = typeof origoApp.api === 'function' ? origoApp.api() : null;
    const map = viewer ? (typeof viewer.getMap === 'function' ? viewer.getMap() : null) : null;
    return map ? map.getView() : null;
  } catch { return null; }
}

document.getElementById('btn-fetch-map-extent')?.addEventListener('click', () => {
  try {
    const view = getPreviewView();
    if (!view) { addLog('Carga el mapa preview primero.', 'error'); return; }
    const map = previewIframe.contentWindow.origoApp.api().getMap();
    const center = view.getCenter();
    const zoom = view.getZoom();
    const size = map.getSize();
    const extent = size ? view.calculateExtent(size) : null;
    // Stamp the CRS the captured coordinates are in, so a future Load Preview
    // can detect a CRS change and discard stale overrides instead of placing
    // the camera in the wrong hemisphere.
    const projCode = (() => {
      try { return view.getProjection()?.getCode?.() || ''; } catch { return ''; }
    })();
    if (centerInput && Array.isArray(center)) {
      centerInput.value = JSON.stringify(center.map((v) => Math.round(v)));
      if (projCode) centerInput.dataset.crs = projCode;
    }
    if (zoomInput && typeof zoom === 'number') zoomInput.value = zoom.toFixed(2);
    if (extentInput && Array.isArray(extent)) extentInput.value = JSON.stringify(extent.map((v) => Math.round(v)));
  } catch (e) {
    addLog('No se pudo leer el estado del mapa: ' + e.message, 'error');
  }
});

// Capture min/max zoom from the current preview zoom level. Workflow:
//   1. Admin loads the preview.
//   2. Zooms OUT to the most zoomed-out level they want to allow → click
//      "Capturar" next to Min Zoom.
//   3. Zooms IN to the most zoomed-in level they want to allow → click
//      "Capturar" next to Max Zoom.
function captureZoomToInput(input, label) {
  const view = getPreviewView();
  if (!view) { addLog('Carga el mapa preview primero.', 'error'); return; }
  const z = view.getZoom();
  if (!Number.isFinite(z)) { addLog('No se pudo leer el zoom actual.', 'error'); return; }
  const intZ = Math.round(z);
  if (input) input.value = String(intZ);
  addLog(`${label} capturado: ${intZ}`, 'ok');
  // Sanity check: Min Zoom must be <= Max Zoom (smaller number = more zoomed
  // out). If the admin captured them backwards, warn so they realise the
  // semantics (not auto-swap, since we cannot guess intent reliably).
  const minEl = document.getElementById('origo-cfg-min-zoom');
  const maxEl = document.getElementById('origo-cfg-max-zoom');
  const minV = Number(minEl?.value);
  const maxV = Number(maxEl?.value);
  if (Number.isFinite(minV) && Number.isFinite(maxV) && minV > maxV) {
    addLog(t('Qtiler2Origo.zoom_warn', { min: minV, max: maxV }), 'warn');
  }
}
document.getElementById('btn-capture-min-zoom')?.addEventListener('click', () => {
  captureZoomToInput(document.getElementById('origo-cfg-min-zoom'), 'Min Zoom');
});
document.getElementById('btn-capture-max-zoom')?.addEventListener('click', () => {
  captureZoomToInput(document.getElementById('origo-cfg-max-zoom'), 'Max Zoom');
});

window.addEventListener('message', (ev) => {
  if (!ev.data || ev.data.type !== 'mapState') return;
  const { center, zoom, extent, projCode } = ev.data;
  if (centerInput && Array.isArray(center)) {
    centerInput.value = JSON.stringify(center);
    if (projCode) centerInput.dataset.crs = String(projCode);
  }
  if (zoomInput && typeof zoom === 'number') zoomInput.value = zoom;
  if (extentInput && Array.isArray(extent)) extentInput.value = JSON.stringify(extent);
});

document.getElementById('btn-load-advanced-controls')?.addEventListener('click', () => {
  // Check all controls and regenerate the JSON textarea
  ORIGO_CTRL_DEFS.forEach((def) => {
    const cb = document.getElementById(def.id);
    if (cb) cb.checked = true;
  });
  syncControlsFromCheckboxes();
});

/* ── Origo control checkboxes → auto-update controls JSON textarea ── */
ORIGO_CTRL_DEFS.forEach((def) => {
  document.getElementById(def.id)?.addEventListener('change', syncControlsFromCheckboxes);
});

[publishName, publishDescription, zoomInput, centerInput, extentInput, minZoomInput, maxZoomInput, controlsJsonInput, extraJsonInput]
  .filter(Boolean)
  .forEach((el) => {
    el.addEventListener('input', () => {
      renderPublishConfigSummary();
      schedulePreviewRefresh();
    });
    el.addEventListener('change', () => {
      renderPublishConfigSummary();
      schedulePreviewRefresh();
    });
  });

/* ── Tool card visual toggle (JS fallback for :has() support) ── */
document.querySelectorAll('.Qtiler2Origo-tool-card input[type="checkbox"]').forEach((cb) => {
  const card = cb.closest('.Qtiler2Origo-tool-card');
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
  loadStatus().catch((err) => addLog(t('Qtiler2Origo.log_error', { msg: err.message }), 'error')),
  loadPublishedProfiles().catch(() => {}),
  loadReleases().catch(() => {})
]);



/* --- WFS Style Editor Logic --- */
let currentEditingWfsLayer = null;
let currentStylePresets = [];
let currentDetectedQgisStyle = null;

function deepCloneStyle(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function getBuiltinStylePresets(geometryType) {
  const family = geomFamilyOf(geometryType);
  if (family === 'line') {
    return [
      {
        key: 'builtin-line-solid',
        title: 'Solid line',
        description: 'Base preset',
        badge: 'Built-in',
        style: [[{ stroke: { color: 'rgba(37, 99, 235, 1)', width: 2 } }]]
      },
      {
        key: 'builtin-line-dashed',
        title: 'Dashed line',
        description: 'Base preset',
        badge: 'Built-in',
        style: [[{ stroke: { color: 'rgba(217, 119, 6, 1)', width: 3, lineDash: [8, 6] } }]]
      },
      {
        key: 'builtin-line-subtle',
        title: 'Subtle gray',
        description: 'Base preset',
        badge: 'Built-in',
        style: [[{ stroke: { color: 'rgba(71, 85, 105, 0.9)', width: 1.5 } }]]
      }
    ];
  }
  if (family === 'polygon') {
    return [
      {
        key: 'builtin-polygon-fill',
        title: 'Filled polygon',
        description: 'Base preset',
        badge: 'Built-in',
        style: [[{ fill: { color: 'rgba(59, 130, 246, 0.25)' }, stroke: { color: 'rgba(37, 99, 235, 1)', width: 2 } }]],
        designer: { fillPattern: 'solid', fillPatternAngle: 45, fillPatternSpacing: 10, fillPatternSize: 2.5 }
      },
      {
        key: 'builtin-polygon-slash-tight',
        title: 'Slash hatch 45°',
        description: 'Tight diagonal lines',
        badge: 'Built-in',
        style: [[{ fill: { color: 'rgba(37, 99, 235, 0.18)' }, stroke: { color: 'rgba(37, 99, 235, 1)', width: 2 } }]],
        designer: { fillPattern: 'slash', fillPatternAngle: 45, fillPatternSpacing: 8, fillPatternSize: 2.5 }
      },
      {
        key: 'builtin-polygon-slash-wide',
        title: 'Slash hatch 25°',
        description: 'Wide separated lines',
        badge: 'Built-in',
        style: [[{ fill: { color: 'rgba(14, 165, 233, 0.15)' }, stroke: { color: 'rgba(3, 105, 161, 1)', width: 2 } }]],
        designer: { fillPattern: 'slash', fillPatternAngle: 25, fillPatternSpacing: 16, fillPatternSize: 2.5 }
      },
      {
        key: 'builtin-polygon-backslash',
        title: 'Backslash hatch',
        description: 'Opposite diagonal lines',
        badge: 'Built-in',
        style: [[{ fill: { color: 'rgba(249, 115, 22, 0.14)' }, stroke: { color: 'rgba(194, 65, 12, 1)', width: 2 } }]],
        designer: { fillPattern: 'backslash', fillPatternAngle: 45, fillPatternSpacing: 10, fillPatternSize: 2.5 }
      },
      {
        key: 'builtin-polygon-horizontal',
        title: 'Horizontal hatch',
        description: 'Parallel horizontal lines',
        badge: 'Built-in',
        style: [[{ fill: { color: 'rgba(99, 102, 241, 0.12)' }, stroke: { color: 'rgba(79, 70, 229, 1)', width: 2 } }]],
        designer: { fillPattern: 'horizontal', fillPatternAngle: 0, fillPatternSpacing: 10, fillPatternSize: 2.5 }
      },
      {
        key: 'builtin-polygon-vertical',
        title: 'Vertical hatch',
        description: 'Parallel vertical lines',
        badge: 'Built-in',
        style: [[{ fill: { color: 'rgba(236, 72, 153, 0.12)' }, stroke: { color: 'rgba(190, 24, 93, 1)', width: 2 } }]],
        designer: { fillPattern: 'vertical', fillPatternAngle: 90, fillPatternSpacing: 12, fillPatternSize: 2.5 }
      },
      {
        key: 'builtin-polygon-cross',
        title: 'Cross hatch',
        description: 'Crossed diagonal lines',
        badge: 'Built-in',
        style: [[{ fill: { color: 'rgba(16, 185, 129, 0.16)' }, stroke: { color: 'rgba(5, 150, 105, 1)', width: 2 } }]],
        designer: { fillPattern: 'cross', fillPatternAngle: 45, fillPatternSpacing: 10, fillPatternSize: 2.5 }
      },
      {
        key: 'builtin-polygon-dots-tight',
        title: 'Dense dots',
        description: 'Small close dots',
        badge: 'Built-in',
        style: [[{ fill: { color: 'rgba(168, 85, 247, 0.18)' }, stroke: { color: 'rgba(126, 34, 206, 1)', width: 2 } }]],
        designer: { fillPattern: 'dots', fillPatternAngle: 0, fillPatternSpacing: 8, fillPatternSize: 1.8 }
      },
      {
        key: 'builtin-polygon-dots-wide',
        title: 'Wide dots',
        description: 'Separated larger dots',
        badge: 'Built-in',
        style: [[{ fill: { color: 'rgba(244, 114, 182, 0.18)' }, stroke: { color: 'rgba(190, 24, 93, 1)', width: 2 } }]],
        designer: { fillPattern: 'dots', fillPatternAngle: 0, fillPatternSpacing: 16, fillPatternSize: 3.5 }
      },
      {
        key: 'builtin-polygon-outline',
        title: 'Outline only',
        description: 'Base preset',
        badge: 'Built-in',
        style: [[{ stroke: { color: 'rgba(15, 23, 42, 0.95)', width: 2.5 } }]],
        designer: { fillPattern: 'outline', fillPatternAngle: 45, fillPatternSpacing: 10, fillPatternSize: 2.5 }
      }
    ];
  }
  return [];
}

function getQgisStylePresets(rawStyle, geometryType) {
  if (!rawStyle || typeof rawStyle !== 'object') return [];
  const style = getSimplifiedQgisStyle(rawStyle, geometryType);
  if (!style) return [];
  const designer = getDesignerOptionsFromQgisStyle(rawStyle);
  return [{
    key: 'qgis-detected-style',
    title: 'QGIS style',
    description: rawStyle.type === 'categorizedSymbol' ? 'Simplified from QGIS categorized renderer' : 'Imported from QGIS',
    badge: 'QGIS',
    style,
    designer
  }];
}

function buildStylePresets(geometryType, rawQgisStyle) {
  return [...getQgisStylePresets(rawQgisStyle, geometryType), ...getBuiltinStylePresets(geometryType)];
}

function stylePresetPreviewSvg(preset, geometryType) {
  const style = preset?.style;
  try {
    const family = geomFamilyOf(geometryType);
    if ((family === 'polygon' || family === 'generic') && preset?.designer?.fillPattern) {
      const rule = unwrapPrimaryStyleRule(style);
      const fillColor = String(rule?.fill?.color || 'rgba(59, 130, 246, 0.25)');
      const strokeColor = String(rule?.stroke?.color || 'rgba(37, 99, 235, 1)');
      const strokeWidth = Number(rule?.stroke?.width || 2);
      const dash = Array.isArray(rule?.stroke?.lineDash) ? ` stroke-dasharray="${rule.stroke.lineDash.join(' ')}"` : '';
      const fillValue = preset.designer.fillPattern === 'outline' ? 'rgba(0,0,0,0)' : fillColor;
      const patternFill = buildSvgPatternFill(fillValue, strokeColor, strokeWidth, preset.designer);
      return `<svg viewBox="0 0 240 120" aria-hidden="true">${patternFill.defs}<path d="M24 88 L72 30 L150 24 L216 74 L176 94 L70 92 Z" fill="${patternFill.fill}" stroke="${strokeColor}" stroke-width="${strokeWidth}"${dash} /></svg>`;
    }
    const rules = typeof origoStyleToRules === 'function'
      ? origoStyleToRules(Array.isArray(style) ? style : [style])
      : [];
    if (Array.isArray(rules) && rules.length) {
      return rulePreviewSampleSvg(rules[0], family);
    }
  } catch {}
  return stylePreviewSvg(geometryType);
}

function renderStylePresetGallery(geometryType) {
  if (!wfsStylePresets || !wfsStylePresetsSection || !wfsStylePresetsSelect) return;
  if (!Array.isArray(currentStylePresets) || !currentStylePresets.length) {
    wfsStylePresets.innerHTML = '';
    wfsStylePresetsSelect.innerHTML = '<option value="">Selecciona un preset…</option>';
    wfsStylePresetsSection.hidden = true;
    return;
  }
  wfsStylePresetsSection.hidden = false;
  wfsStylePresetsSelect.innerHTML = ['<option value="">Selecciona un preset…</option>']
    .concat(currentStylePresets.map((preset, index) => `<option value="${index}">${escapeHtml(preset.title || `Preset ${index + 1}`)}${preset.badge ? ` (${escapeHtml(preset.badge)})` : ''}</option>`))
    .join('');
  const preset = currentStylePresets[0];
  wfsStylePresets.innerHTML = preset ? `
    <article class="Qtiler2Origo-style-preset">
      <div class="Qtiler2Origo-style-preset__sample">${stylePresetPreviewSvg(preset, geometryType)}</div>
      <div class="Qtiler2Origo-style-preset__meta">
        <strong>${escapeHtml(preset.title || 'Preset')}</strong>
        <small>${escapeHtml(preset.description || '')}</small>
        <span class="Qtiler2Origo-style-preset__badge">${escapeHtml(preset.badge || 'Preset')}</span>
      </div>
    </article>
  ` : '';
}

function applyStylePreset(preset) {
  if (!preset || !preset.style) return;
  const geometryType = getLayerGeometryType(currentEditingWfsLayer);
  const style = deepCloneStyle(preset.style);
  applyStyleDefinitionToDesigner(style, geometryType);
  applyDesignerPatternOptions(preset?.designer || { fillPattern: 'solid' });
  try {
    if (typeof origoStyleToRules === 'function') {
      currentRules = origoStyleToRules(Array.isArray(style) ? style : [style]);
      renderRulesPanel();
    }
  } catch {}
  if (wfsStyleJsonEditor) wfsStyleJsonEditor.value = JSON.stringify(style, null, 2);
  try { if (typeof setJsonEditorValue === 'function') setJsonEditorValue(JSON.stringify(style, null, 2)); } catch {}
  syncStylePreview();
}

function populateStyleCopySelect(currentLayer) {
  if (!wfsStyleCopySelect) return;
  wfsStyleCopySelect.innerHTML = `<option value="">${t('Qtiler2Origo.wfs_copy_layer')}</option>`;
  
  // Find all layers in projectLayersList that have a style (either in mainRules or a default vector)
  const optionLayers = getAllPublishLayers().filter((layer) => {
    const layerKey = getLayerKey(layer);
    return layerKey && layerKey !== currentLayer && isVectorGeometry(getLayerGeometryType(layerKey));
  });

  for (const l of optionLayers) {
    const lName = getLayerKey(l);
    const opt = document.createElement('option');
    opt.value = lName;
    opt.textContent = l.sourceProjectId && l.sourceProjectId !== String(publishProjectSelect?.value || '').trim()
      ? `${l.name} [${l.sourceProjectId}]`
      : l.name;
    wfsStyleCopySelect.appendChild(opt);
  }
}

function openStyleEditor(layerName) {
  currentEditingWfsLayer = layerName;
  currentRuleIndex = 0;
  const geometryType = getLayerGeometryType(layerName);
  if (!isVectorGeometry(geometryType)) return;
  currentDetectedQgisStyle = null;
  currentStylePresets = buildStylePresets(geometryType, null);
  renderStylePresetGallery(geometryType);

  if (wfsStyleLayerTitle) wfsStyleLayerTitle.innerText = layerName;
  if (wfsStyleGeometryBadge) {
    wfsStyleGeometryBadge.textContent = geometryType || 'Vector';
    wfsStyleGeometryBadge.className = 'badge badge--ok';
  }
  if (wfsStyleError) {
    wfsStyleError.textContent = '';
    wfsStyleError.classList.add('is-hidden');
  }
  
  populateStyleCopySelect(layerName);

  const existingRules = publishState.mainRules[layerName] || {};
  currentAttributes = existingRules.attributes || [];
  renderAttributesPanel();
  const existingStyle = existingRules.wfsStyle || defaultStyleDefinition(geometryType);
  applyStyleDefinitionToDesigner(existingStyle, geometryType);
  applyDesignerPatternOptions(existingRules?.designerOptions || { fillPattern: 'solid' });
  currentLayerGeomFamily = geomFamilyOf(geometryType);
  try { if (typeof origoStyleToRules === "function") { currentRules = origoStyleToRules(Array.isArray(existingStyle) ? existingStyle : [existingStyle]); renderRulesPanel(); } } catch(e){}
  if (wfsStyleJsonEditor) wfsStyleJsonEditor.value = JSON.stringify(existingStyle, null, 2);
  
  setStyleEditorTab('designer');
  syncStylePreview();

  const projectId = getLayerProjectId(layerName);
  const sourceLayerName = String(getMainLayerByName(layerName)?.name || layerName).trim();
  if (projectId && wfsStyleJsonEditor) {
    if (!existingRules.wfsStyle) {
      wfsStyleJsonEditor.value = t('Qtiler2Origo.loading_style') || 'Loading detected style from QGIS…';
    }
    fetch(`/Qtiler2Origo/layer-style?project=${encodeURIComponent(projectId)}&layer=${encodeURIComponent(sourceLayerName)}`)
      .then((res) => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
      .then((data) => {
        currentDetectedQgisStyle = data && data.supported === false ? null : (data?.style || null);
        currentStylePresets = buildStylePresets(geometryType, currentDetectedQgisStyle);
        renderStylePresetGallery(geometryType);
        if (existingRules.wfsStyle) return;
        const qgisDesignerOptions = currentDetectedQgisStyle ? getDesignerOptionsFromQgisStyle(currentDetectedQgisStyle) : { fillPattern: 'solid', ...getDefaultDesignerPatternOptions('solid') };
        const style = currentDetectedQgisStyle
          ? (getSimplifiedQgisStyle(currentDetectedQgisStyle, geometryType) || defaultStyleDefinition(geometryType))
          : defaultStyleDefinition(geometryType);
        applyStyleDefinitionToDesigner(style, geometryType);
        applyDesignerPatternOptions(qgisDesignerOptions);
        try { if (typeof origoStyleToRules === "function") { currentRules = origoStyleToRules(Array.isArray(style) ? style : [style]); renderRulesPanel(); } } catch(e){}
        if (wfsStyleJsonEditor) wfsStyleJsonEditor.value = JSON.stringify(style, null, 2);
        setStyleEditorTab('designer');
        syncStylePreview();
      })
      .catch(() => {
        currentDetectedQgisStyle = null;
        currentStylePresets = buildStylePresets(geometryType, null);
        renderStylePresetGallery(geometryType);
        if (existingRules.wfsStyle) return;
        if (wfsStyleJsonEditor) wfsStyleJsonEditor.value = JSON.stringify(defaultStyleDefinition(geometryType), null, 2);
        applyDesignerPatternOptions({ fillPattern: 'solid', ...getDefaultDesignerPatternOptions('solid') });
        try { if (typeof origoStyleToRules === "function") { currentRules = origoStyleToRules([defaultStyleDefinition(geometryType)]); renderRulesPanel(); } } catch(e){}
        syncStylePreview();
      });
  }

  openManagedModal(wfsStyleModal, wfsStyleFullscreenBtn);
}

function closeStyleEditor() {
  closeRuleStyleEditor();
  closeManagedModal(wfsStyleModal, wfsStyleFullscreenBtn);
  currentDesignerRuleIndex = null;
  updateDesignerRuleModeNotice();
  currentEditingWfsLayer = null;
}

function saveStyleEditor() {
  const layerName = currentEditingWfsLayer;
  if (!layerName) return;

  try {
    const activeJson = !!wfsStylePanels.find((panel) => panel.getAttribute('data-style-panel') === 'json' && !panel.hidden);
    const geometryType = getLayerGeometryType(layerName);
    const styleObj = activeJson
      ? (wfsStyleJsonEditor?.value.trim() ? JSON.parse(wfsStyleJsonEditor.value.trim()) : defaultStyleDefinition(geometryType))
      : buildStyleDefinitionFromDesigner(geometryType);

    if (!publishState.mainRules[layerName]) {
      publishState.mainRules[layerName] = { searchable: false, editable: true, serveAsWfs: true };
    }
    publishState.mainRules[layerName].serveAsWfs = true;
    publishState.mainRules[layerName].wfsStyle = styleObj;
    publishState.mainRules[layerName].attributes = JSON.parse(JSON.stringify(currentAttributes));
    publishState.mainRules[layerName].geometryType = geometryType || null;
    publishState.mainRules[layerName].designerOptions = {
      ...(publishState.mainRules[layerName].designerOptions || {}),
      ...getDesignerPatternOptions()
    };

    const checkedNames = getCheckedLayerNames(projectLayersList);
    closeStyleEditor();
    renderLayerChecklist(projectLayersList, getAllPublishLayers(), publishState.mainRules);
    setCheckedLayerNames(projectLayersList, checkedNames);
  } catch (err) {
    if (wfsStyleError) {
      wfsStyleError.innerText = (t('Qtiler2Origo.wfs_invalid_json') || 'Invalid JSON: ') + err.message;
      wfsStyleError.classList.remove('is-hidden');
    }
  }
}

wfsStyleTabButtons.forEach((button) => {
  button.addEventListener('click', () => setStyleEditorTab(button.getAttribute('data-style-tab')));
});

wfsStyleFullscreenBtn?.addEventListener('click', () => {
  toggleManagedModalFullscreen(wfsStyleModal, wfsStyleFullscreenBtn);
});

wfsRuleEditorFullscreenBtn?.addEventListener('click', () => {
  toggleManagedModalFullscreen(wfsRuleEditorModal, wfsRuleEditorFullscreenBtn);
});

wfsStylePresetsSelect?.addEventListener('change', () => {
  const index = Number(wfsStylePresetsSelect.value);
  if (!Number.isInteger(index) || !currentStylePresets[index] || !wfsStylePresets) return;
  const geometryType = getLayerGeometryType(currentEditingWfsLayer);
  const preset = currentStylePresets[index];
  wfsStylePresets.innerHTML = `
    <article class="Qtiler2Origo-style-preset">
      <div class="Qtiler2Origo-style-preset__sample">${stylePresetPreviewSvg(preset, geometryType)}</div>
      <div class="Qtiler2Origo-style-preset__meta">
        <strong>${escapeHtml(preset.title || 'Preset')}</strong>
        <small>${escapeHtml(preset.description || '')}</small>
        <span class="Qtiler2Origo-style-preset__badge">${escapeHtml(preset.badge || 'Preset')}</span>
      </div>
    </article>
  `;
});

wfsStylePresetsApply?.addEventListener('click', () => {
  const index = Number(wfsStylePresetsSelect?.value);
  if (!Number.isInteger(index) || !currentStylePresets[index]) return;
  applyStylePreset(currentStylePresets[index]);
});

[wfsStyleShape, wfsStyleFillColor, wfsStyleFillOpacity, wfsStyleStrokeColor, wfsStyleStrokeOpacity, wfsStyleStrokeWidth, wfsStyleRadius, wfsStyleDash, wfsStylePatternAngle, wfsStylePatternSpacing, wfsStylePatternSize, wfsStylePatternTransparent]
  .filter(Boolean)
  .forEach((input) => {
    input.addEventListener('input', syncStylePreview);
    input.addEventListener('change', syncStylePreview);
  });

wfsStyleFillPattern?.addEventListener('input', () => {
  syncDesignerGeometryFields(getLayerGeometryType(currentEditingWfsLayer));
  syncStylePreview();
});
wfsStyleFillPattern?.addEventListener('change', () => {
  syncDesignerGeometryFields(getLayerGeometryType(currentEditingWfsLayer));
  syncStylePreview();
});

wfsStyleResetBtn?.addEventListener('click', () => {
  const ok = window.confirm(t('Qtiler2Origo.wfs_reset_confirm'));
  if (!ok) return;
  const geometryType = getLayerGeometryType(currentEditingWfsLayer);
  const style = defaultStyleDefinition(geometryType);
  applyStyleDefinitionToDesigner(style, geometryType);
  applyDesignerPatternOptions({ fillPattern: 'solid', ...getDefaultDesignerPatternOptions('solid') });
  if (wfsStyleJsonEditor) wfsStyleJsonEditor.value = JSON.stringify(style, null, 2);
  // Also reset the rules tab to a single default rule built from the basic style
  try {
    if (typeof origoStyleToRules === 'function' && typeof renderRulesPanel === 'function') {
      currentRules = origoStyleToRules(style);
      renderRulesPanel();
    }
  } catch (_e) {}
  if (typeof setJsonEditorValue === 'function') setJsonEditorValue(JSON.stringify(style, null, 2));
  syncStylePreview();
});

wfsStyleApplyJsonBtn?.addEventListener('click', () => {
  try {
    const txt = (typeof getJsonEditorValue === 'function' ? getJsonEditorValue() : (wfsStyleJsonEditor?.value || '')).trim();
    const parsed = txt ? JSON.parse(txt) : {};
    // Accept either { wfsStyle: [...] , ...other layer props } or a bare style array
    const styleArr = Array.isArray(parsed) ? parsed : parsed.wfsStyle;
    if (Array.isArray(styleArr)) {
      currentRules = origoStyleToRules(styleArr);
    }
    if (wfsStyleError) {
      wfsStyleError.textContent = '';
      wfsStyleError.classList.add('is-hidden');
    }
    if (typeof setJsonEditorStatus === 'function') setJsonEditorStatus('JSON aplicado a las reglas.', false);
    // Switch to rules tab so the user sees the result
    setStyleEditorTab('rules');
  } catch (err) {
    if (typeof setJsonEditorStatus === 'function') setJsonEditorStatus((t('Qtiler2Origo.wfs_invalid_json') || 'Invalid JSON: ') + err.message, true);
    if (wfsStyleError) {
    wfsStyleError.innerText = (t('Qtiler2Origo.wfs_invalid_json_apply') || 'Could not apply JSON: ') + err.message;
      wfsStyleError.classList.remove('is-hidden');
    }
  }
});

wfsStyleCopySelect?.addEventListener('change', () => {
  const selectedLayer = wfsStyleCopySelect.value;
  if (!selectedLayer) return;
  const existingRules = publishState.mainRules[selectedLayer];
  if (existingRules && existingRules.wfsStyle && wfsStyleJsonEditor) {
    wfsStyleJsonEditor.value = JSON.stringify(existingRules.wfsStyle, null, 2);
  }
});

/* ======================================================================
   GRAPHICAL RULE-BASED STYLE EDITOR
   ====================================================================== */
let currentRules = [];
let currentRuleIndex = 0; // Index of the rule currently shown in the dropdown-driven editor
let currentRuleEditorIndex = null;
let currentDesignerRuleIndex = null;
let currentAttributes = []; // [{name, title, url}, ...]
let currentLayerFields = []; // [{name, type}, ...]
let currentLayerGeomFamily = 'point'; // point|line|polygon
let svgLibraryCache = null;
let svgPickerTargetCb = null;


const attributesContainer = document.getElementById('wfs-attributes-container');
const attributesAddBtn = document.getElementById('wfs-attributes-add');

function renderAttributesPanel() {
  if (!attributesContainer) return;
  attributesContainer.innerHTML = '';
  const fieldOpts = ['<option value="">— elegir campo —</option>']
    .concat((currentLayerFields || []).map(f => {
      const lbl = f.type ? `${f.name} (${f.type})` : f.name;
      return `<option value="${f.name}">${lbl}</option>`;
    })).join('');
  currentAttributes.forEach((attr, idx) => {
    const row = document.createElement('div');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '1fr 1fr 130px 70px 30px';
    row.style.gap = '0.4rem';
    row.style.alignItems = 'start';
    const isInList = !attr.name || (currentLayerFields || []).some(f => f.name === attr.name);
    const nameField = (currentLayerFields && currentLayerFields.length && isInList)
      ? `<select class="input small" data-idx="${idx}" data-field="name">${fieldOpts.replace(`value="${attr.name}"`, `value="${attr.name}" selected`)}</select>`
      : `<input type="text" class="input small" placeholder="Nombre del campo" value="${attr.name || ''}" data-idx="${idx}" data-field="name">`;
    const type = attr.type || 'text';
    const typeOpts = ['text', 'number', 'url', 'image', 'dropdown', 'textarea', 'checkbox', 'date']
      .map(t => `<option value="${t}"${t === type ? ' selected' : ''}>${t}</option>`).join('');
    const maxLen = (attr.maxLength != null ? attr.maxLength : '');
    const optionsRow = (type === 'dropdown')
      ? `<div style="grid-column: 1 / -1; margin-top:0.25rem"><textarea class="textarea is-small" rows="3" placeholder="${escapeHtml(t('Qtiler2Origo.attr_options_ph'))}" data-idx="${idx}" data-field="options">${Array.isArray(attr.options) ? attr.options.join('\n') : ''}</textarea></div>`
      : '';
    row.innerHTML = `${nameField}
      <input type="text" class="input small" placeholder="${escapeHtml(t('Qtiler2Origo.attr_title_ph'))}" value="${attr.title || ''}" data-idx="${idx}" data-field="title">
      <select class="input small" data-idx="${idx}" data-field="type">${typeOpts}</select>
      <input type="number" class="input small" placeholder="max" value="${maxLen}" data-idx="${idx}" data-field="maxLength">
      <button type="button" class="button small is-danger is-light" data-action="delete" data-idx="${idx}" title="${escapeHtml(t('Qtiler2Origo.delete'))}">×</button>
      ${optionsRow}`;
    attributesContainer.appendChild(row);
  });
}

if (attributesAddBtn) {
  attributesAddBtn.addEventListener('click', () => {
    currentAttributes.push({ name: '', title: '', url: '' });
    renderAttributesPanel();
  });
}

if (attributesContainer) {
  const updateAttr = (e) => {
    const idx = parseInt(e.target.getAttribute('data-idx'));
    const field = e.target.getAttribute('data-field');
    if (isNaN(idx) || !currentAttributes[idx] || !field) return;
    let val = e.target.value;
    if (field === 'maxLength') {
      const n = parseInt(val);
      currentAttributes[idx].maxLength = isNaN(n) ? undefined : n;
    } else if (field === 'options') {
      currentAttributes[idx].options = val.split('\n').map(s => s.trim()).filter(Boolean);
    } else {
      currentAttributes[idx][field] = val;
    }
    if (field === 'type') renderAttributesPanel();
  };
  attributesContainer.addEventListener('input', updateAttr);
  attributesContainer.addEventListener('change', updateAttr);

  attributesContainer.addEventListener('click', (e) => {
    if (e.target.getAttribute('data-action') === 'delete') {
      const idx = parseInt(e.target.getAttribute('data-idx'));
      if (!isNaN(idx)) {
        currentAttributes.splice(idx, 1);
        renderAttributesPanel();
      }
    }
  });
}

const rulesContainer = document.getElementById('wfs-rules-container');
const rulesAddBtn = document.getElementById('wfs-rules-add');
const rulesCopySelect = document.getElementById('wfs-rules-copy-select');
const svgPickerModal = document.getElementById('svg-picker-modal');
const svgPickerGrid = document.getElementById('svg-picker-grid');
const svgPickerSearch = document.getElementById('svg-picker-search');
const svgPickerFullscreenBtn = document.getElementById('svg-picker-fullscreen');

svgPickerFullscreenBtn?.addEventListener('click', () => {
  toggleManagedModalFullscreen(svgPickerModal, svgPickerFullscreenBtn);
});

const managedModalState = new WeakMap();
let managedModalOrder = 0;

function getManagedModalEntry(modal) {
  if (!modal) return null;
  let entry = managedModalState.get(modal);
  if (!entry) {
    entry = { offsetX: 0, offsetY: 0, zIndex: 0 };
    managedModalState.set(modal, entry);
  }
  return entry;
}

function applyManagedModalState(modal) {
  const entry = getManagedModalEntry(modal);
  if (!modal || !entry) return;
  modal.style.zIndex = entry.zIndex ? String(entry.zIndex) : '';
  modal.style.setProperty('--qt-modal-offset-x', `${entry.offsetX || 0}px`);
  modal.style.setProperty('--qt-modal-offset-y', `${entry.offsetY || 0}px`);
}

function resetManagedModalState(modal) {
  const entry = getManagedModalEntry(modal);
  if (!entry) return;
  entry.offsetX = 0;
  entry.offsetY = 0;
  applyManagedModalState(modal);
}

function bringManagedModalToFront(modal) {
  const entry = getManagedModalEntry(modal);
  if (!entry) return;
  managedModalOrder += 1;
  entry.zIndex = 2000 + managedModalOrder * 10;
  applyManagedModalState(modal);
}

function updateManagedModalFullscreenButton(modal, button) {
  if (!modal || !button) return;
  const isFullscreen = modal.classList.contains('Qtiler2Origo-modal--fullscreen');
  button.textContent = isFullscreen ? 'Windowed' : 'Full screen';
  button.setAttribute('aria-pressed', isFullscreen ? 'true' : 'false');
}

function toggleManagedModalFullscreen(modal, button) {
  if (!modal) return;
  const enabled = modal.classList.toggle('Qtiler2Origo-modal--fullscreen');
  if (modal === wfsStyleModal) {
    modal.classList.toggle('Qtiler2Origo-style-modal--fullscreen', enabled);
  }
  if (enabled) resetManagedModalState(modal);
  bringManagedModalToFront(modal);
  updateManagedModalFullscreenButton(modal, button);
}

function openManagedModal(modal, button) {
  if (!modal) return;
  modal.classList.add('is-active');
  bringManagedModalToFront(modal);
  updateManagedModalFullscreenButton(modal, button);
}

function closeManagedModal(modal, button) {
  if (!modal) return;
  modal.classList.remove('is-active');
  modal.classList.remove('Qtiler2Origo-modal--fullscreen');
  if (modal === wfsStyleModal) {
    modal.classList.remove('Qtiler2Origo-style-modal--fullscreen');
  }
  resetManagedModalState(modal);
  updateManagedModalFullscreenButton(modal, button);
}

function enableManagedModal(modal) {
  if (!modal || modal.dataset.qtManagedModal === 'true') return;
  modal.dataset.qtManagedModal = 'true';
  const header = modal.querySelector('.modal-card-head');
  header?.classList.add('Qtiler2Origo-modal-drag-handle');
  modal.addEventListener('pointerdown', () => bringManagedModalToFront(modal));
  header?.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (modal.classList.contains('Qtiler2Origo-modal--fullscreen')) return;
    if (event.button !== 0) return;
    if (event.target.closest('button, .delete, input, select, textarea, a, label, summary')) return;
    const entry = getManagedModalEntry(modal);
    if (!entry) return;
    const startX = event.clientX - entry.offsetX;
    const startY = event.clientY - entry.offsetY;
    bringManagedModalToFront(modal);
    const onMove = (moveEvent) => {
      entry.offsetX = moveEvent.clientX - startX;
      entry.offsetY = moveEvent.clientY - startY;
      applyManagedModalState(modal);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    event.preventDefault();
  });
}

enableManagedModal(wfsStyleModal);
enableManagedModal(wfsRuleEditorModal);
enableManagedModal(svgPickerModal);

function defaultRule(geomFamily) {
  const r = {
    filter: '',
    minScale: '',
    maxScale: '',
    label: { enabled: false, text: '', color: '#000000', size: 12, offsetX: 0, offsetY: -14, placement: 'point', minScale: '', maxScale: '' },
    designerOptions: null
  };
  if (geomFamily === 'point') {
    r.point = { mode: 'circle', circle: { radius: 6, fill: '#3b82f6', fillOpacity: 0.7, stroke: '#2563eb', strokeWidth: 1, strokeOpacity: 1 }, icon: { src: '', scale: 0.05, opacity: 1, useColor: false, color: '#000000' } };
  } else if (geomFamily === 'line') {
    r.stroke = { color: '#2563eb', opacity: 1, width: 2, dash: 'solid' };
  } else {
    r.fill = { color: '#3b82f6', opacity: 0.25 };
    r.stroke = { color: '#2563eb', opacity: 1, width: 2, dash: 'solid' };
  }
  return r;
}

function geomFamilyOf(g) {
  const s = String(g || '').toLowerCase();
  if (s.includes('point')) return 'point';
  if (s.includes('line') || s.includes('linestring')) return 'line';
  return 'polygon';
}

function dashKeyToArray(key) {
  switch (key) {
    case 'dashed': return [8, 6];
    case 'dotted': return [2, 4];
    case 'dashdot': return [8, 4, 2, 4];
    default: return [0];
  }
}
function dashArrayToKey(arr) {
  if (!Array.isArray(arr) || !arr.length || arr[0] === 0) return 'solid';
  if (arr.length === 2 && arr[0] >= 6) return 'dashed';
  if (arr[0] <= 3) return 'dotted';
  return 'dashdot';
}

function hexToRgba(hex, opacity) {
  const m = String(hex || '#000000').replace('#', '').match(/.{1,2}/g);
  const r = parseInt(m[0], 16) || 0, g = parseInt(m[1], 16) || 0, b = parseInt(m[2], 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${opacity != null ? opacity : 1})`;
}
function parseColorString(c, defHex = '#000000', defOp = 1) {
  if (!c) return { hex: defHex, op: defOp };
  const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (m) {
    const hex = '#' + [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('');
    return { hex, op: m[4] != null ? Number(m[4]) : 1 };
  }
  if (String(c).startsWith('#')) return { hex: c, op: 1 };
  return { hex: defHex, op: defOp };
}

function buildOperatorList(fieldType) {
  const t = String(fieldType || '').toLowerCase();
  const isNumeric = t.includes('int') || t.includes('real') || t.includes('double') || t.includes('numeric');
  const ops = ['==', '!='];
  if (isNumeric) ops.push('>', '>=', '<', '<=');
  ops.push('LIKE');
  return ops;
}

function buildFilterFromUi(field, op, value, fieldType) {
  if (!field) return '';
  const t = String(fieldType || '').toLowerCase();
  const isNumeric = t.includes('int') || t.includes('real') || t.includes('double') || t.includes('numeric');
  const v = isNumeric && !isNaN(Number(value)) ? value : `'${String(value).replace(/'/g, "\\'")}'`;
  if (op === 'LIKE') return `[${field}] LIKE '%${String(value).replace(/'/g, "\\'")}%'`;
  return `[${field}] ${op} ${v}`;
}

function parseFilterToUi(expr) {
  if (!expr) return { field: '', op: '==', value: '' };
  const m1 = String(expr).match(/^\[([^\]]+)\]\s*(==|!=|>=|<=|>|<|LIKE)\s*(.+)$/i);
  if (m1) {
    let val = m1[3].trim();
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    if (m1[2].toUpperCase() === 'LIKE') val = val.replace(/^%|%$/g, '');
    return { field: m1[1], op: m1[2].toUpperCase() === 'LIKE' ? 'LIKE' : m1[2], value: val };
  }
  return { field: '', op: '==', value: '' };
}

function rulesToOrigoStyle(rules) {
  if (!Array.isArray(rules) || !rules.length) return [];
  const normScale = (v) => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
  const legacyToMustache = (s) => String(s || '').replace(/\[([A-Za-z_][\w-]*)\]/g, '{{$1}}');
  return rules.map(r => {
    const entries = [];
    const geomEntry = {};
    if (r.filter) geomEntry.filter = r.filter;
    if (currentLayerGeomFamily === 'point') {
      if (r.point && r.point.mode === 'icon' && r.point.icon && r.point.icon.src) {
        geomEntry.icon = {
          src: r.point.icon.src,
          scale: r.point.icon.scale != null ? r.point.icon.scale : 0.05,
          anchor: r.point.icon.anchor || [0.5, 0.5],
          opacity: r.point.icon.opacity != null ? r.point.icon.opacity : 1
        };
        if (r.point.icon.useColor && r.point.icon.color) {
          geomEntry.icon.color = r.point.icon.color;
        }
      } else if (r.point && r.point.circle) {
        const c = r.point.circle;
        geomEntry.circle = {
          radius: c.radius || 6,
          fill: { color: c.fillNone ? 'rgba(0,0,0,0)' : hexToRgba(c.fill, c.fillOpacity) },
          stroke: { color: hexToRgba(c.stroke, c.strokeOpacity), width: c.strokeWidth || 1 }
        };
      }
    } else if (currentLayerGeomFamily === 'line') {
      geomEntry.stroke = { color: hexToRgba(r.stroke.color, r.stroke.opacity), width: r.stroke.width || 2, lineDash: dashKeyToArray(r.stroke.dash) };
    } else {
      if (!r.fill.none) geomEntry.fill = { color: hexToRgba(r.fill.color, r.fill.opacity) };
      if (!r.stroke.none) geomEntry.stroke = { color: hexToRgba(r.stroke.color, r.stroke.opacity), width: r.stroke.width || 1, lineDash: dashKeyToArray(r.stroke.dash) };
      const pattern = String(r?.designerOptions?.fillPattern || '').trim().toLowerCase();
      if (['slash', 'backslash', 'horizontal', 'vertical', 'cross', 'dots'].includes(pattern)) {
        geomEntry.qtilerPatternStyle = {
          ...getDefaultDesignerPatternOptions(pattern),
          ...JSON.parse(JSON.stringify(r.designerOptions || {})),
          fillPattern: pattern
        };
      }
    }
    const gMin = normScale(r.maxScale); // user input "Visible desde 1:N" → larger denominator hidden
    const gMax = normScale(r.minScale);
    // In Origo: maxScale = larger denom (zoomed-out limit), minScale = smaller denom (zoomed-in limit)
    // We expose: "Visible desde escala 1:X" (less detail) → maxScale=X
    //            "Visible hasta escala 1:Y" (more detail) → minScale=Y
    if (gMin != null) geomEntry.maxScale = gMin;
    if (gMax != null) geomEntry.minScale = gMax;
    entries.push(geomEntry);

    if (r.label && r.label.enabled && r.label.text) {
      const textEntry = {};
      if (r.filter) textEntry.filter = r.filter;
      textEntry.text = {
        text: legacyToMustache(r.label.text),
        font: `${r.label.size || 12}px sans-serif`,
        fill: { color: r.label.color || '#000000' },
        stroke: { color: '#FFFFFF', width: 3 },
        offsetX: r.label.offsetX != null ? Number(r.label.offsetX) || 0 : 0,
        offsetY: r.label.offsetY != null ? Number(r.label.offsetY) || 0 : -14,
        textAlign: 'center',
        overflow: true
      };
      // Origo/OL: when placement is 'line', the label follows the geometry.
      if (r.label.placement === 'line') {
        textEntry.text.placement = 'line';
        // offsetY along a line is interpreted relative to the line; small
        // negative values put it slightly above the line in OL.
      }
      const lMin = normScale(r.label.maxScale);
      const lMax = normScale(r.label.minScale);
      if (lMin != null) textEntry.maxScale = lMin;
      if (lMax != null) textEntry.minScale = lMax;
      entries.push(textEntry);
    }
    return entries;
  });
}

function origoStyleToRules(styleDef) {
  if (!Array.isArray(styleDef)) return [defaultRule(currentLayerGeomFamily)];
  const out = [];
  for (const ruleArr of styleDef) {
    const entries = Array.isArray(ruleArr) ? ruleArr : [ruleArr];
    if (!entries.length) continue;
    const r = defaultRule(currentLayerGeomFamily);
    let geomEntry = null;
    let textEntry = null;
    for (const e of entries) {
      if (!e || typeof e !== 'object') continue;
      if (e.text && !textEntry) textEntry = e;
      if (!geomEntry && (e.circle || e.icon || e.image || e.fill || e.stroke)) geomEntry = e;
    }
    const def = geomEntry || entries[0];
    if (def && def.filter) r.filter = def.filter;
    if (def) {
      if (def.maxScale != null) r.maxScale = def.maxScale;
      if (def.minScale != null) r.minScale = def.minScale;
    }
    if (textEntry) {
      r.label.enabled = true;
      r.label.text = textEntry.text.text || '';
      r.label.color = parseColorString(textEntry.text.fill && textEntry.text.fill.color, '#000000', 1).hex;
      const fm = String(textEntry.text.font || '').match(/(\d+)px/);
      if (fm) r.label.size = Number(fm[1]);
      if (textEntry.text.offsetX != null) r.label.offsetX = textEntry.text.offsetX;
      if (textEntry.text.offsetY != null) r.label.offsetY = textEntry.text.offsetY;
      if (textEntry.text.placement === 'line') r.label.placement = 'line';
      if (textEntry.maxScale != null) r.label.maxScale = textEntry.maxScale;
      if (textEntry.minScale != null) r.label.minScale = textEntry.minScale;
    }
    if (def && currentLayerGeomFamily === 'point') {
      if (def.icon && def.icon.src) {
        r.point.mode = 'icon';
        r.point.icon.src = def.icon.src;
        r.point.icon.scale = def.icon.scale != null ? def.icon.scale : 0.05;
        r.point.icon.opacity = def.icon.opacity != null ? def.icon.opacity : 1;
        if (def.icon.color) {
          r.point.icon.color = def.icon.color;
          r.point.icon.useColor = true;
        }
      } else if (def.circle) {
        r.point.mode = 'circle';
        r.point.circle.radius = def.circle.radius || 6;
        const fillRaw = def.circle.fill && def.circle.fill.color;
        const f = parseColorString(fillRaw);
        r.point.circle.fill = f.hex; r.point.circle.fillOpacity = f.op;
        r.point.circle.fillNone = (typeof fillRaw === 'string' && /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\)/i.test(fillRaw));
        const s = parseColorString(def.circle.stroke && def.circle.stroke.color);
        r.point.circle.stroke = s.hex; r.point.circle.strokeOpacity = s.op;
        r.point.circle.strokeWidth = (def.circle.stroke && def.circle.stroke.width) || 1;
      }
    } else if (def && currentLayerGeomFamily === 'line') {
      const s = parseColorString(def.stroke && def.stroke.color);
      r.stroke.color = s.hex; r.stroke.opacity = s.op;
      r.stroke.width = (def.stroke && def.stroke.width) || 2;
      r.stroke.dash = dashArrayToKey(def.stroke && def.stroke.lineDash);
    } else if (def) {
      r.fill.none = !def.fill;
      const f = parseColorString(def.fill && def.fill.color);
      r.fill.color = f.hex; r.fill.opacity = f.op;
      r.stroke.none = !def.stroke;
      const s = parseColorString(def.stroke && def.stroke.color);
      r.stroke.color = s.hex; r.stroke.opacity = s.op;
      r.stroke.width = (def.stroke && def.stroke.width) || 1;
      r.stroke.dash = dashArrayToKey(def.stroke && def.stroke.lineDash);
      r.designerOptions = def.qtilerPatternStyle && typeof def.qtilerPatternStyle === 'object'
        ? JSON.parse(JSON.stringify(def.qtilerPatternStyle))
        : null;
    }
    out.push(r);
  }
  return out.length ? out : [defaultRule(currentLayerGeomFamily)];
}

function loadLayerFields(projectId, layerName) {
  if (!projectId || !layerName) return Promise.resolve({ fields: [], geometryType: '' });
  return fetch(`/Qtiler2Origo/layer-fields?project=${encodeURIComponent(projectId)}&layer=${encodeURIComponent(layerName)}`)
    .then(r => r.ok ? r.json() : { fields: [], geometryType: '' })
    .then(d => ({ fields: Array.isArray(d.fields) ? d.fields : [], geometryType: d.geometryType || '' }))
    .catch(() => ({ fields: [], geometryType: '' }));
}

function loadSvgLibrary() {
  if (svgLibraryCache) return Promise.resolve(svgLibraryCache);
  return fetch('/Qtiler2Origo/qgis-svg-list')
    .then(r => r.ok ? r.json() : { categories: [] })
    .then(d => { svgLibraryCache = d.categories || []; return svgLibraryCache; })
    .catch(() => []);
}

function openSvgPicker(targetCallback) {
  svgPickerTargetCb = targetCallback;
  openManagedModal(svgPickerModal, svgPickerFullscreenBtn);
  if (svgPickerSearch) svgPickerSearch.value = '';
  loadSvgLibrary().then(cats => renderSvgGrid(cats, ''));
}
function closeSvgPicker() {
  closeManagedModal(svgPickerModal, svgPickerFullscreenBtn);
  svgPickerTargetCb = null;
}
window.closeSvgPicker = closeSvgPicker;

function renderSvgGrid(cats, filter) {
  if (!svgPickerGrid) return;
  svgPickerGrid.innerHTML = '';
  const f = (filter || '').toLowerCase();
  for (const cat of cats) {
    for (const ic of cat.icons) {
      if (f && !`${cat.name}/${ic.name}`.toLowerCase().includes(f)) continue;
      const el = document.createElement('div');
      el.style.cssText = 'border:1px solid #ddd;padding:4px;cursor:pointer;text-align:center;background:#fff';
      el.title = `${cat.name}/${ic.name}`;
      el.innerHTML = `<img src="${ic.url}" style="width:60px;height:60px;object-fit:contain" /><div style="font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ic.name}</div>`;
      el.addEventListener('click', () => {
        if (svgPickerTargetCb) svgPickerTargetCb(ic.url);
        closeSvgPicker();
      });
      svgPickerGrid.appendChild(el);
    }
  }
}
svgPickerSearch?.addEventListener('input', () => loadSvgLibrary().then(cats => renderSvgGrid(cats, svgPickerSearch.value)));

function buildRuleEditorMarkup(rule, idx) {
  const T = (k) => t('Qtiler2Origo.' + k);
  const fieldOptions = [`<option value="">${T('wfs_no_filter')}</option>`]
    .concat(currentLayerFields.map(f => `<option value="${f.name}">${f.name} (${f.type})</option>`)).join('');
  const ui = parseFilterToUi(rule.filter);
  const sel = currentLayerFields.find(f => f.name === ui.field);
  const opOptions = buildOperatorList(sel?.type).map(o => `<option value="${o}"${o === ui.op ? ' selected' : ''}>${o}</option>`).join('');

  let geomHtml = '';
  if (currentLayerGeomFamily === 'point') {
    const isIcon = rule.point.mode === 'icon';
    geomHtml = `
      <div style="display:flex;gap:0.4rem;margin-bottom:0.4rem">
        <label style="display:inline-flex;align-items:center;gap:6px"><input type="radio" name="ptmode-${idx}" value="circle" ${!isIcon ? 'checked' : ''}/> ${T('wfs_circle')}</label>
        <label style="display:inline-flex;align-items:center;gap:6px"><input type="radio" name="ptmode-${idx}" value="icon" ${isIcon ? 'checked' : ''}/> ${T('wfs_svg_icon')}</label>
      </div>
      <div data-ptpanel="circle" ${isIcon ? 'hidden' : ''} style="display:grid;grid-template-columns:auto 1fr 1fr;gap:10px;align-items:end">
        <label style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap;margin-bottom:0"><input type="checkbox" data-rk="circle.fillNone" ${rule.point.circle.fillNone ? 'checked' : ''}/> ${T('wfs_no_fill')}</label>
        <label>${T('wfs_fill_color')}<input type="color" data-rk="circle.fill" value="${rule.point.circle.fill}" ${rule.point.circle.fillNone ? 'disabled' : ''}/></label>
        <label>${T('wfs_fill_opacity')}<input type="number" step="0.05" min="0" max="1" data-rk="circle.fillOpacity" value="${rule.point.circle.fillOpacity}" ${rule.point.circle.fillNone ? 'disabled' : ''}/></label>
        <label>${T('wfs_radius')}<input type="number" data-rk="circle.radius" value="${rule.point.circle.radius}" min="1" max="50" /></label>
        <label>${T('wfs_stroke_color')}<input type="color" data-rk="circle.stroke" value="${rule.point.circle.stroke}" /></label>
        <label>${T('wfs_stroke_width')}<input type="number" step="0.5" min="0" max="10" data-rk="circle.strokeWidth" value="${rule.point.circle.strokeWidth}" /></label>
        <label style="grid-column:1/4">${T('wfs_stroke_opacity')}<input type="number" step="0.05" min="0" max="1" data-rk="circle.strokeOpacity" value="${rule.point.circle.strokeOpacity}" /></label>
      </div>
      <div data-ptpanel="icon" ${!isIcon ? 'hidden' : ''} style="display:grid;grid-template-columns:auto 1fr 1fr;gap:10px;align-items:end">
        <div><img data-rk="icon.preview" src="${rule.point.icon.src || ''}" style="width:56px;height:56px;border:1px solid #ccd5e1;border-radius:10px;background:#fff;object-fit:contain"/></div>
        <button type="button" class="button small" data-rk="icon.pick">${T('wfs_pick_svg')}</button>
        <div></div>
        <label style="grid-column:1/4">${T('wfs_url')}<input type="text" style="width:100%" data-rk="icon.src" value="${rule.point.icon.src}" /></label>
        <label>${T('wfs_scale_field')}<input type="number" step="0.01" min="0.01" max="5" data-rk="icon.scale" value="${rule.point.icon.scale}" /></label>
        <label>${T('wfs_opacity')}<input type="number" step="0.05" min="0" max="1" data-rk="icon.opacity" value="${rule.point.icon.opacity}" /></label>
        <label>${T('wfs_tint_color')}<input type="color" data-rk="icon.color" value="${rule.point.icon.color || '#000000'}" /></label>
        <div style="grid-column:1/4"><label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;width:auto"><input type="checkbox" data-rk="icon.useColor" ${rule.point.icon.useColor ? 'checked' : ''} /> ${T('wfs_enable_svg_tint')}</label></div>
      </div>
    `;
  } else if (currentLayerGeomFamily === 'line') {
    geomHtml = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label>${T('wfs_color')}<input type="color" data-rk="stroke.color" value="${rule.stroke.color}" /></label>
        <label>${T('wfs_opacity')}<input type="number" step="0.05" min="0" max="1" data-rk="stroke.opacity" value="${rule.stroke.opacity}" /></label>
        <label>${T('wfs_width')}<input type="number" step="0.5" min="0" max="20" data-rk="stroke.width" value="${rule.stroke.width}" /></label>
        <label>${T('wfs_pattern')}<select data-rk="stroke.dash">
          <option value="solid"${rule.stroke.dash === 'solid' ? ' selected' : ''}>${T('wfs_solid')}</option>
          <option value="dashed"${rule.stroke.dash === 'dashed' ? ' selected' : ''}>${T('wfs_dashed')}</option>
          <option value="dotted"${rule.stroke.dash === 'dotted' ? ' selected' : ''}>${T('wfs_dotted')}</option>
          <option value="dashdot"${rule.stroke.dash === 'dashdot' ? ' selected' : ''}>${T('wfs_dashdot')}</option>
        </select></label>
      </div>
    `;
  } else {
    const noFill = !!rule.fill.none;
    const noStroke = !!rule.stroke.none;
    geomHtml = `
      <div style="display:grid;grid-template-columns:auto 1fr 1fr;gap:10px;align-items:end">
        <label style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap;margin-bottom:0"><input type="checkbox" data-rk="fill.none" ${noFill ? 'checked' : ''}/> ${T('wfs_no_fill_only_stroke')}</label>
        <label>${T('wfs_fill_color')}<input type="color" data-rk="fill.color" value="${rule.fill.color}" ${noFill ? 'disabled' : ''}/></label>
        <label>${T('wfs_fill_opacity')}<input type="number" step="0.05" min="0" max="1" data-rk="fill.opacity" value="${rule.fill.opacity}" ${noFill ? 'disabled' : ''}/></label>
        <label style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap;margin-bottom:0"><input type="checkbox" data-rk="stroke.none" ${noStroke ? 'checked' : ''}/> ${T('wfs_no_stroke')}</label>
        <label>${T('wfs_stroke_color')}<input type="color" data-rk="stroke.color" value="${rule.stroke.color}" ${noStroke ? 'disabled' : ''}/></label>
        <label>${T('wfs_stroke_opacity')}<input type="number" step="0.05" min="0" max="1" data-rk="stroke.opacity" value="${rule.stroke.opacity}" ${noStroke ? 'disabled' : ''}/></label>
        <label style="grid-column:1/4;display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:0">
          <label>${T('wfs_stroke_width')}<input type="number" step="0.5" min="0" max="20" data-rk="stroke.width" value="${rule.stroke.width}" ${noStroke ? 'disabled' : ''}/></label>
          <label>${T('wfs_stroke_pattern')}<select data-rk="stroke.dash" ${noStroke ? 'disabled' : ''}>
            <option value="solid"${rule.stroke.dash === 'solid' ? ' selected' : ''}>${T('wfs_solid')}</option>
            <option value="dashed"${rule.stroke.dash === 'dashed' ? ' selected' : ''}>${T('wfs_dashed')}</option>
            <option value="dotted"${rule.stroke.dash === 'dotted' ? ' selected' : ''}>${T('wfs_dotted')}</option>
            <option value="dashdot"${rule.stroke.dash === 'dashdot' ? ' selected' : ''}>${T('wfs_dashdot')}</option>
          </select></label>
        </label>
      </div>
    `;
  }

  const labelFieldOpts = currentLayerFields.map(f => `<option value="{{${f.name}}}">${f.name}</option>`).join('');
  const isLine = currentLayerGeomFamily === 'line';
  const placement = rule.label.placement || 'point';
  const placementHtml = isLine ? `
        <label>${T('wfs_label_placement')}<select data-rk="lab.placement">
          <option value="point"${placement === 'point' ? ' selected' : ''}>${T('wfs_label_placement_point')}</option>
          <option value="line"${placement === 'line' ? ' selected' : ''}>${T('wfs_label_placement_line')}</option>
        </select></label>
        <label>${T('wfs_label_offsetx')}<input type="number" step="1" data-rk="lab.offsetX" value="${rule.label.offsetX ?? 0}" /></label>
  ` : '';
  const offsetYHtml = `<label>${T('wfs_label_offsety')}<input type="number" step="1" data-rk="lab.offsetY" value="${rule.label.offsetY ?? -14}" /></label>`;

  return `
    <div class="Qtiler2Origo-rule-editor-shell" data-rule-editor-root="${idx}" data-rule-editor-index="${idx}">
      <fieldset>
        <legend>${T('wfs_filter')}</legend>
        <div style="display:grid;grid-template-columns:2fr 1fr 2fr;gap:10px;align-items:end">
          <label>${T('wfs_attr')}<select data-rk="f.field">${fieldOptions.replace(`value="${ui.field}"`, `value="${ui.field}" selected`)}</select></label>
          <label>${T('wfs_op')}<select data-rk="f.op">${opOptions}</select></label>
          <label>${T('wfs_value')}<input type="text" data-rk="f.value" value="${ui.value}" placeholder="${T('wfs_value_placeholder_any')}" autocomplete="off" /></label>
        </div>
        <p class="help" data-rk="f.value-help" style="margin:8px 0 0">${T('wfs_value_help_pick_field')}</p>
      </fieldset>

      <fieldset>
        <legend>${T('wfs_symbol')}</legend>
        <div style="display:grid;grid-template-columns:96px minmax(0,1fr) auto;gap:10px;align-items:center;margin-bottom:10px">
          <div class="Qtiler2Origo-rule-summary__sample">${rulePreviewSampleSvg(rule, currentLayerGeomFamily || 'polygon')}</div>
          <div class="help" style="margin:0">${T('wfs_edit_visual_style')}</div>
          <button type="button" class="button small is-link is-light" data-rk="stylebasic">${T('wfs_edit_visual_style')}</button>
        </div>
        ${geomHtml}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
          <label title="${T('wfs_visible_from_tip')}">${T('wfs_visible_from')}<input type="number" min="0" step="1" data-rk="r.maxScale" value="${rule.maxScale ?? ''}" placeholder="${T('wfs_no_limit')}" /></label>
          <label title="${T('wfs_visible_to_tip')}">${T('wfs_visible_to')}<input type="number" min="0" step="1" data-rk="r.minScale" value="${rule.minScale ?? ''}" placeholder="${T('wfs_no_limit')}" /></label>
        </div>
      </fieldset>

      <fieldset>
        <legend><label style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" data-rk="lab.enabled" ${rule.label.enabled ? 'checked' : ''}/> ${T('wfs_label')}</label></legend>
        <div style="display:grid;grid-template-columns:3fr 1fr;gap:10px;align-items:end">
          <label>${T('wfs_text_help')}
            <input type="text" data-rk="lab.text" value="${(rule.label.text || '').replace(/"/g,'&quot;')}" placeholder="${T('wfs_text_placeholder')}" />
          </label>
          <label>${T('wfs_insert_field')}
            <select data-rk="lab.insertField"><option value="">--</option>${labelFieldOpts}</select>
          </label>
          <label>${T('wfs_color')}<input type="color" data-rk="lab.color" value="${rule.label.color}" /></label>
          <label>${T('wfs_size')}<input type="number" min="6" max="48" data-rk="lab.size" value="${rule.label.size}" /></label>
          ${placementHtml}
          ${offsetYHtml}
          <label title="${T('wfs_label_from_tip')}">${T('wfs_label_from')}<input type="number" min="0" step="1" data-rk="lab.maxScale" value="${rule.label.maxScale ?? ''}" placeholder="${T('wfs_no_limit')}" /></label>
          <label title="${T('wfs_label_to_tip')}">${T('wfs_label_to')}<input type="number" min="0" step="1" data-rk="lab.minScale" value="${rule.label.minScale ?? ''}" placeholder="${T('wfs_no_limit')}" /></label>
        </div>
      </fieldset>
    </div>
  `;
}

function attachRuleEditorHandlers(root, idx) {
  if (!root) return;
  root.querySelectorAll('[data-rk]').forEach((el) => {
    const k = el.getAttribute('data-rk');
    const handle = (val) => updateRuleField(idx, k, val);
    if (el.tagName === 'INPUT' && el.type === 'checkbox') {
      el.addEventListener('change', () => handle(el.checked));
    } else if (el.tagName === 'INPUT' || el.tagName === 'SELECT') {
      el.addEventListener('input', () => handle(el.value));
      el.addEventListener('change', () => handle(el.value));
    } else if (el.tagName === 'BUTTON') {
      el.addEventListener('click', () => handle(true));
    }
  });
  wireRuleRadios(root);
}

function updateDesignerRuleModeNotice() {
  if (!wfsStyleRuleModeNote) return;
  if (!Number.isInteger(currentDesignerRuleIndex)) {
    wfsStyleRuleModeNote.hidden = true;
    wfsStyleRuleModeNote.textContent = '';
    return;
  }
  wfsStyleRuleModeNote.hidden = false;
  wfsStyleRuleModeNote.textContent = t('Qtiler2Origo.wfs_rule_mode_note', { rule: String(currentDesignerRuleIndex + 1) });
}

function openBasicDesignerForRule(idx) {
  if (!Number.isInteger(idx) || !currentRules[idx]) return;
  currentDesignerRuleIndex = idx;
  currentRuleIndex = idx;
  const geometryType = getLayerGeometryType(currentEditingWfsLayer);
  const styleDef = rulesToOrigoStyle([currentRules[idx]]);
  applyStyleDefinitionToDesigner(styleDef, geometryType);
  applyDesignerPatternOptions(currentRules[idx]?.designerOptions || { fillPattern: 'solid', ...getDefaultDesignerPatternOptions('solid') });
  closeRuleStyleEditor();
  setStyleEditorTab('designer');
  updateDesignerRuleModeNotice();
  syncStylePreview();
}

function renderRuleEditorModal() {
  if (!wfsRuleEditorModal || !wfsRuleEditorHost) return;
  if (currentRuleEditorIndex == null || !currentRules[currentRuleEditorIndex]) {
    closeRuleStyleEditor();
    return;
  }
  const idx = currentRuleEditorIndex;
  const rule = currentRules[idx];
  if (wfsRuleEditorTitle) wfsRuleEditorTitle.textContent = `${idx + 1}`;
  wfsRuleEditorHost.innerHTML = buildRuleEditorMarkup(rule, idx);
  const root = wfsRuleEditorHost.querySelector(`[data-rule-editor-root="${idx}"]`);
  attachRuleEditorHandlers(root, idx);
  if (currentLayerFields.length) attachValueDatalistForRule(idx, root || wfsRuleEditorHost);
}

function openRuleStyleEditor(idx) {
  if (!Number.isInteger(idx) || !currentRules[idx] || !wfsRuleEditorModal) return;
  currentRuleEditorIndex = idx;
  currentRuleIndex = idx;
  renderRuleEditorModal();
  openManagedModal(wfsRuleEditorModal, wfsRuleEditorFullscreenBtn);
}

function closeRuleStyleEditor() {
  currentRuleEditorIndex = null;
  closeManagedModal(wfsRuleEditorModal, wfsRuleEditorFullscreenBtn);
}
window.closeRuleStyleEditor = closeRuleStyleEditor;

function ruleCard(rule, idx) {
  const T = (k) => t('Qtiler2Origo.' + k);
  const card = document.createElement('div');
  card.dataset.ruleIndex = String(idx);
  card.className = 'Qtiler2Origo-rule-summary';
  const filterText = rule.filter || T('wfs_rule_default');
  const labelText = rule.label && rule.label.enabled && rule.label.text ? rule.label.text : '';
  const chips = [];
  if (rule.maxScale || rule.minScale) chips.push(`${T('wfs_visible_from')} ${rule.maxScale || T('wfs_no_limit')} / ${T('wfs_visible_to')} ${rule.minScale || T('wfs_no_limit')}`);
  if (labelText) chips.push(`${T('wfs_label')}: ${labelText}`);
  card.innerHTML = `
    <div class="Qtiler2Origo-rule-summary__head">
      <strong>${T('wfs_rule')} ${idx + 1}</strong>
      <div class="Qtiler2Origo-rule-summary__actions">
        <button type="button" class="button small is-link is-light" data-rk="edit">${T('wfs_edit_rule')}</button>
        <button type="button" class="button small" data-rk="up" title="${T('wfs_move_up')}">↑</button>
        <button type="button" class="button small" data-rk="down" title="${T('wfs_move_down')}">↓</button>
        <button type="button" class="button small is-danger" data-rk="del" title="${T('wfs_delete')}">✕</button>
      </div>
    </div>
    <div class="Qtiler2Origo-rule-summary__details">
      <div class="Qtiler2Origo-rule-summary__sample">${rulePreviewSampleSvg(rule, currentLayerGeomFamily || 'polygon')}</div>
      <div class="Qtiler2Origo-rule-summary__meta">
        <code>${escapeHtml(filterText)}</code>
        <div class="Qtiler2Origo-rule-summary__chips">
          ${chips.length ? chips.map((chip) => `<span class="Qtiler2Origo-rule-summary__chip">${escapeHtml(chip)}</span>`).join('') : `<span class="Qtiler2Origo-rule-summary__chip">${escapeHtml(T('wfs_symbol'))}</span>`}
        </div>
      </div>
    </div>
  `;
  const details = card.querySelector('.Qtiler2Origo-rule-summary__details');
  if (details) {
    details.style.cursor = 'pointer';
    details.addEventListener('click', () => openRuleStyleEditor(idx));
  }
  card.querySelectorAll('[data-rk]').forEach((el) => {
    const k = el.getAttribute('data-rk');
    if (k === 'edit') {
      el.addEventListener('click', () => openRuleStyleEditor(idx));
      return;
    }
    el.addEventListener('click', () => updateRuleField(idx, k, true));
  });
  return card;
}

function updateRuleField(idx, key, value) {
  const r = currentRules[idx];
  if (!r) return;
  
  if (key === 'del') {
    currentRules.splice(idx, 1);
    if (currentRuleEditorIndex === idx) currentRuleEditorIndex = null;
    else if (Number.isInteger(currentRuleEditorIndex) && currentRuleEditorIndex > idx) currentRuleEditorIndex -= 1;
    if (currentRuleIndex >= currentRules.length) currentRuleIndex = Math.max(0, currentRules.length - 1);
    return renderRulesPanel();
  }
  if (key === 'up' && idx > 0) {
    [currentRules[idx-1], currentRules[idx]] = [currentRules[idx], currentRules[idx-1]];
    if (currentRuleEditorIndex === idx) currentRuleEditorIndex = idx - 1;
    else if (currentRuleEditorIndex === idx - 1) currentRuleEditorIndex = idx;
    currentRuleIndex = idx - 1;
    return renderRulesPanel();
  }
  if (key === 'down' && idx < currentRules.length - 1) {
    [currentRules[idx+1], currentRules[idx]] = [currentRules[idx], currentRules[idx+1]];
    if (currentRuleEditorIndex === idx) currentRuleEditorIndex = idx + 1;
    else if (currentRuleEditorIndex === idx + 1) currentRuleEditorIndex = idx;
    currentRuleIndex = idx + 1;
    return renderRulesPanel();
  }
  if (key === 'edit') {
    openRuleStyleEditor(idx);
    return;
  }
  if (key === 'stylebasic') {
    openBasicDesignerForRule(idx);
    return;
  }
  
  if (key.startsWith('f.')) {
    const editorRoot = document.querySelector(`[data-rule-editor-root="${idx}"]`);
    if (!editorRoot) return;
    const field = editorRoot.querySelector('[data-rk="f.field"]')?.value || '';
    const op = editorRoot.querySelector('[data-rk="f.op"]')?.value || '==';
    const val = editorRoot.querySelector('[data-rk="f.value"]')?.value || '';
    const sel = currentLayerFields.find(f => f.name === field);
    r.filter = field ? buildFilterFromUi(field, op, val, sel?.type) : '';
    afterRuleChange();
    if (key === 'f.field') {
      renderRulesPanel();
      if (currentRuleEditorIndex === idx) renderRuleEditorModal();
    }
    return;
  }
  if (key.startsWith('r.')) {
    // Per-rule scale fields (geometry)
    const sub = key.slice(2);
    r[sub] = value === '' ? '' : (isNaN(Number(value)) ? value : Number(value));
    afterRuleChange();
    return;
  }
  if (key.startsWith('lab.')) {
    const sub = key.slice(4);
    if (sub === 'insertField' && value) {
      // Insert at the end; if text already ends with the same token, do nothing
      const cur = r.label.text || '';
      if (!cur.endsWith(value)) r.label.text = cur + value;
      return renderRulesPanel();
    }
    if (sub === 'minScale' || sub === 'maxScale') {
      r.label[sub] = value === '' ? '' : (isNaN(Number(value)) ? value : Number(value));
      afterRuleChange();
      return;
    }
    if (sub === 'offsetX' || sub === 'offsetY' || sub === 'size') {
      const n = Number(value);
      r.label[sub] = isNaN(n) ? 0 : n;
      afterRuleChange();
      return;
    }
    r.label[sub] = value;
    afterRuleChange();
    return;
  }
  if (key.startsWith('circle.')) {
    const sub = key.slice(7);
    if (sub === 'fillNone') {
      r.point.circle.fillNone = !!value;
      return renderRulesPanel();
    }
    r.point.circle[sub] = (typeof value === 'boolean' || isNaN(Number(value))) ? value : Number(value);
    afterRuleChange();
    return;
  }
  if (key.startsWith('icon.')) {
    const sub = key.slice(5);
    if (sub === 'pick') {
      openSvgPicker((url) => {
        r.point.icon.src = url;
        renderRulesPanel();
      });
      return;
    }
    if (sub === 'preview') return;
    if (sub === 'color') r.point.icon.color = value;
    else if (sub === 'useColor') r.point.icon.useColor = !!value;
    else r.point.icon[sub] = (sub === 'src') ? value : Number(value);
    afterRuleChange();
    return;
  }
  if (key.startsWith('fill.')) {
    const sub = key.slice(5);
    if (sub === 'none') { r.fill.none = !!value; return renderRulesPanel(); }
    r.fill[sub] = sub === 'color' ? value : Number(value);
    afterRuleChange();
    return;
  }
  if (key.startsWith('stroke.')) {
    const sub = key.slice(7);
    if (sub === 'none') { r.stroke.none = !!value; return renderRulesPanel(); }
    r.stroke[sub] = (sub === 'color' || sub === 'dash') ? value : Number(value);
    afterRuleChange();
    return;
  }
  if (key.startsWith('ptmode-') || key.startsWith('ptmode')) { r.point.mode = value; return renderRulesPanel(); }
  
  // radio buttons via name (handled separately)
}

// Light update after a rule field changes: refresh preview and JSON sync
function afterRuleChange() {
  try { renderRulesPreviewGallery(); } catch {/* ignore */}
  try { if (wfsStyleJsonEditor) wfsStyleJsonEditor.value = JSON.stringify(rulesToOrigoStyle(currentRules), null, 2); } catch {/* ignore */}
}

// Wire radio button group manually
function wireRuleRadios(root = document) {
  root?.querySelectorAll('input[type=radio][name^="ptmode-"]').forEach(rb => {
    rb.addEventListener('change', () => {
      const m = rb.name.match(/^ptmode-(\d+)$/);
      if (!m) return;
      const idx = Number(m[1]);
      if (currentRules[idx] && currentRules[idx].point) {
        currentRules[idx].point.mode = rb.value;
        renderRulesPanel();
      }
    });
  });
}

function renderRulesPanel() {
  if (!rulesContainer) return;
  rulesContainer.innerHTML = '';
  if (!currentRules.length) currentRules.push(defaultRule(currentLayerGeomFamily));
  // Clamp the active rule index in case rules were deleted/added.
  if (typeof currentRuleIndex !== 'number' || currentRuleIndex < 0 || currentRuleIndex >= currentRules.length) {
    currentRuleIndex = 0;
  }
  // Rule selector dropdown — only one rule is rendered/visible at a time.
  if (currentRules.length > 1 || true) {
    const picker = document.createElement('div');
    picker.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:0.6rem';
    const opts = currentRules.map((_, i) => `<option value="${i}"${i === currentRuleIndex ? ' selected' : ''}>${t('Qtiler2Origo.wfs_rule')} ${i + 1}</option>`).join('');
    picker.innerHTML = `
      <label style="margin-bottom:0;font-weight:600">${t('Qtiler2Origo.wfs_rule') || 'Regla'}:</label>
      <select id="wfs-rule-picker" style="min-width:140px">${opts}</select>
    `;
    rulesContainer.appendChild(picker);
    picker.querySelector('#wfs-rule-picker').addEventListener('change', (e) => {
      const idx = parseInt(e.target.value, 10);
      if (!Number.isNaN(idx)) {
        currentRuleIndex = idx;
        renderRulesPanel();
      }
    });
  }
  // Render only the active rule's card.
  rulesContainer.appendChild(ruleCard(currentRules[currentRuleIndex], currentRuleIndex));
  // Sync JSON tab in background
  if (wfsStyleJsonEditor) wfsStyleJsonEditor.value = JSON.stringify(rulesToOrigoStyle(currentRules), null, 2);
  // Live preview gallery (shows ALL rules, regardless of selected card).
  try { renderRulesPreviewGallery(); } catch {/* ignore */}
  if (currentRuleEditorIndex != null) renderRuleEditorModal();
}

/* ──────────────────────────────────────────────────────────────────
   Live preview gallery: shows one sample row per rule with the
   geometry symbol rendered using the active rule's colors/strokes.
   ────────────────────────────────────────────────────────────────── */
function rulePreviewSampleSvg(rule, geomFamily) {
  // Build a 80x48 SVG sample with the rule's symbol
  const W = 80, H = 48;
  const dashAttr = (s) => {
    const arr = dashKeyToArray(s);
    return (arr && arr[0]) ? ` stroke-dasharray="${arr.join(' ')}"` : '';
  };
  if (geomFamily === 'point') {
    if (rule.point.mode === 'icon' && rule.point.icon && rule.point.icon.src) {
      let src = rule.point.icon.src;
      // If a color is set on a /qgis-svg/ icon, route through the server-side
      // colorizer so the preview reflects the chosen color.
      const color = rule.point.icon.color;
      if (color && /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(String(color).trim()) && src.startsWith('/qgis-svg/')) {
        const hex = String(color).trim().replace(/^#?/, '#');
        src = src.replace(/^\/qgis-svg\//, '/qgis-svg-colored/') + `?color=${encodeURIComponent(hex)}`;
      }
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><image href="${src}" x="${W/2-16}" y="${H/2-16}" width="32" height="32" preserveAspectRatio="xMidYMid meet"/></svg>`;
    }
    const c = rule.point.circle;
    const fill = c.fillNone ? 'none' : hexToRgba(c.fill, c.fillOpacity);
    const stroke = hexToRgba(c.stroke, c.strokeOpacity);
    const r = Math.min(20, c.radius || 6);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><circle cx="${W/2}" cy="${H/2}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${c.strokeWidth || 1}"/></svg>`;
  }
  if (geomFamily === 'line') {
    const stroke = hexToRgba(rule.stroke.color, rule.stroke.opacity);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><path d="M6 ${H-10} Q ${W/3} 6 ${W/2} ${H/2} T ${W-6} 10" fill="none" stroke="${stroke}" stroke-width="${rule.stroke.width || 2}" stroke-linecap="round"${dashAttr(rule.stroke.dash)}/></svg>`;
  }
  // polygon
  const fill = rule.fill.none ? 'none' : hexToRgba(rule.fill.color, rule.fill.opacity);
  const stroke = rule.stroke.none ? 'none' : hexToRgba(rule.stroke.color, rule.stroke.opacity);
  const sw = rule.stroke.none ? 0 : (rule.stroke.width || 1);
  const patternMeta = rule?.designerOptions && typeof rule.designerOptions === 'object' ? rule.designerOptions : null;
  const patternFill = patternMeta && ['slash', 'backslash', 'horizontal', 'vertical', 'cross', 'dots'].includes(String(patternMeta.fillPattern || '').trim().toLowerCase())
    ? buildSvgPatternFill(fill === 'none' ? 'rgba(0,0,0,0)' : fill, stroke, sw || 1, patternMeta)
    : { defs: '', fill };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${patternFill.defs}<path d="M8 ${H-6} L 18 8 L ${W-22} 6 L ${W-6} ${H-12} L ${W/2} ${H-4} Z" fill="${patternFill.fill}" stroke="${stroke}" stroke-width="${sw}"${dashAttr(rule.stroke.dash)}/></svg>`;
}

function renderRulesPreviewGallery() {
  if (!wfsStylePreview) return;
  const fam = currentLayerGeomFamily || 'polygon';
  const famLabel = { point: t('Qtiler2Origo.fam_point'), line: t('Qtiler2Origo.fam_line'), polygon: t('Qtiler2Origo.fam_polygon') }[fam] || fam;
  if (!Array.isArray(currentRules) || !currentRules.length) {
    wfsStylePreview.innerHTML = `<div class="sample-row"><div class="sample-meta">${escapeHtml(t('Qtiler2Origo.no_rules_yet'))}</div></div>`;
    return;
  }
  const html = currentRules.map((rule, i) => {
    const filterTxt = rule.filter ? rule.filter : '<em>(por defecto)</em>';
    const labelTxt = rule.label && rule.label.enabled && rule.label.text ? `${escapeHtml(t('Qtiler2Origo.wfs_label'))}: <code>${rule.label.text.replace(/</g,'&lt;')}</code>` : '';
    const svg = rulePreviewSampleSvg(rule, fam);
    return `<div class="sample-row">
      <div class="sample-svg">${svg}</div>
      <div class="sample-meta">
        <strong>${escapeHtml(t('Qtiler2Origo.wfs_rule'))} ${i + 1} <span style="color:#789;font-weight:normal">(${famLabel})</span></strong>
        <code>${filterTxt}</code>
        ${labelTxt ? `<code>${labelTxt}</code>` : ''}
      </div>
    </div>`;
  }).join('');
  wfsStylePreview.innerHTML = html;
}

rulesAddBtn?.addEventListener('click', () => {
  currentRules.push(defaultRule(currentLayerGeomFamily));
  currentRuleIndex = currentRules.length - 1; // jump to the new rule
  renderRulesPanel();
});

function populateRulesCopySelect(currentLayer) {
  if (!rulesCopySelect) return;
  rulesCopySelect.innerHTML = `<option value="">${t('Qtiler2Origo.wfs_copy_rules')}</option>`;
  for (const l of (publishState.mainLayers || [])) {
    const lName = l.name || l.title;
    if (!lName || lName === currentLayer) continue;
    if (publishState.mainRules[lName] && publishState.mainRules[lName].wfsStyle) {
      const opt = document.createElement('option');
      opt.value = lName; opt.textContent = lName;
      rulesCopySelect.appendChild(opt);
    }
  }
}

rulesCopySelect?.addEventListener('change', () => {
  const src = rulesCopySelect.value;
  if (!src) return;
  const srcStyle = publishState.mainRules[src]?.wfsStyle;
  if (srcStyle) {
    currentRules = origoStyleToRules(srcStyle);
    renderRulesPanel();
  }
  rulesCopySelect.value = '';
});

// Hook into openStyleEditor to initialize rule editor
const _origOpenStyleEditor = openStyleEditor;
openStyleEditor = function(layerName) {
  currentRuleEditorIndex = null;
  currentDesignerRuleIndex = null;
  _origOpenStyleEditor(layerName);
  const geomType = getLayerGeometryType(layerName);
  currentLayerGeomFamily = geomFamilyOf(geomType);
  const projectId = getLayerProjectId(layerName);
  
  // Initialize rules from existing wfsStyle or from JSON editor content
  const existingRules = publishState.mainRules[layerName] || {};
  const existingStyle = existingRules.wfsStyle;
  if (existingStyle) {
    currentRules = origoStyleToRules(existingStyle);
  } else {
    currentRules = [defaultRule(currentLayerGeomFamily)];
  }
  
  populateRulesCopySelect(layerName);
  
  // Async: load fields for this layer (then re-render to populate dropdowns)
  const sourceLayerName = String(getMainLayerByName(layerName)?.name || layerName).trim();
  loadLayerFields(projectId, sourceLayerName).then(({ fields, geometryType }) => {
    currentLayerFields = fields;
    if (geometryType) {
      currentLayerGeomFamily = geomFamilyOf(geometryType);
      // Persist on rule + cached layer entry so future sessions remember
      if (publishState.mainRules[layerName]) publishState.mainRules[layerName].geometryType = geometryType;
      const layerObj = getMainLayerByName(layerName);
      if (layerObj && !layerObj.geometry) layerObj.geometry = geometryType;
    }
    renderRulesPanel();
    renderAttributesPanel();
  });
  
  // Default to rules tab
  setStyleEditorTab('rules');
  updateDesignerRuleModeNotice();
  renderRulesPanel();
};

// Override saveStyleEditor to save from active tab (rules → JSON)
const _origSaveStyleEditor = saveStyleEditor;
saveStyleEditor = function() {
  const layerName = currentEditingWfsLayer;
  if (!layerName) return;
  const activeRules = !!wfsStylePanels.find(p => p.getAttribute('data-style-panel') === 'rules' && !p.hidden);
  const activeJson = !!wfsStylePanels.find(p => p.getAttribute('data-style-panel') === 'json' && !p.hidden);
  const activeDesigner = !!wfsStylePanels.find(p => p.getAttribute('data-style-panel') === 'designer' && !p.hidden);
  if (activeDesigner && Number.isInteger(currentDesignerRuleIndex) && currentRules[currentDesignerRuleIndex]) {
    try {
      const geometryType = getLayerGeometryType(layerName);
      const styleObj = buildStyleDefinitionFromDesigner(geometryType);
      const convertedRule = (origoStyleToRules(styleObj) || [defaultRule(currentLayerGeomFamily)])[0] || defaultRule(currentLayerGeomFamily);
      const previousRule = currentRules[currentDesignerRuleIndex] || defaultRule(currentLayerGeomFamily);
      convertedRule.filter = previousRule.filter;
      convertedRule.maxScale = previousRule.maxScale;
      convertedRule.minScale = previousRule.minScale;
      convertedRule.label = JSON.parse(JSON.stringify(previousRule.label || defaultRule(currentLayerGeomFamily).label));
      convertedRule.designerOptions = JSON.parse(JSON.stringify(getDesignerPatternOptions()));
      currentRules[currentDesignerRuleIndex] = convertedRule;
      currentRuleIndex = currentDesignerRuleIndex;
      const reopenIndex = currentDesignerRuleIndex;
      currentDesignerRuleIndex = null;
      updateDesignerRuleModeNotice();
      setStyleEditorTab('rules');
      renderRulesPanel();
      openRuleStyleEditor(reopenIndex);
    } catch (err) {
      if (wfsStyleError) {
        wfsStyleError.innerText = (t('Qtiler2Origo.wfs_invalid_json') || 'Invalid JSON: ') + err.message;
        wfsStyleError.classList.remove('is-hidden');
      }
    }
    return;
  }
  if (activeJson) {
    // Save FULL layer config from the JSON editor
    try {
      const txt = getJsonEditorValue();
      const parsed = JSON.parse(txt || '{}');
      if (!publishState.mainRules[layerName]) {
        publishState.mainRules[layerName] = { searchable: false, editable: true, serveAsWfs: true };
      }
      const r = publishState.mainRules[layerName];
      if (parsed.wfsStyle !== undefined) r.wfsStyle = parsed.wfsStyle;
      if (parsed.searchable !== undefined) r.searchable = !!parsed.searchable;
      if (parsed.editable !== undefined) r.editable = !!parsed.editable;
      if (parsed.serveAsWfs !== undefined) r.serveAsWfs = !!parsed.serveAsWfs;
      if (parsed.geometryType) r.geometryType = parsed.geometryType;
      const checkedNames = getCheckedLayerNames(projectLayersList);
      closeStyleEditor();
      renderLayerChecklist(projectLayersList, getAllPublishLayers(), publishState.mainRules);
      setCheckedLayerNames(projectLayersList, checkedNames);
      setJsonEditorStatus(t('Qtiler2Origo.wfs_saved') || 'Guardado.', false);
    } catch (err) {
      setJsonEditorStatus((t('Qtiler2Origo.wfs_invalid_json') || 'JSON inválido: ') + err.message, true);
    }
    return;
  }
  if (activeRules) {
    const styleObj = rulesToOrigoStyle(currentRules);
    if (!publishState.mainRules[layerName]) {
      publishState.mainRules[layerName] = { searchable: false, editable: true, serveAsWfs: true };
    }
    publishState.mainRules[layerName].serveAsWfs = true;
    publishState.mainRules[layerName].wfsStyle = styleObj;
    publishState.mainRules[layerName].geometryType = getLayerGeometryType(layerName) || null;
    const checkedNames = getCheckedLayerNames(projectLayersList);
    closeStyleEditor();
    renderLayerChecklist(projectLayersList, getAllPublishLayers(), publishState.mainRules);
    setCheckedLayerNames(projectLayersList, checkedNames);
    return;
  }
  _origSaveStyleEditor();
};

/* ======================================================================
   CodeMirror-backed JSON editor (with textarea fallback)
   ====================================================================== */
let _cmJsonEditor = null;
let _cmInitTried = false;

function ensureJsonEditor() {
  if (_cmInitTried) return _cmJsonEditor;
  _cmInitTried = true;
  const host = document.getElementById('wfs-style-json-host');
  const ta = document.getElementById('wfs-style-json-editor');
  if (!host || !ta) return null;
  if (typeof CodeMirror === 'undefined') {
    // Fallback: show textarea
    host.style.display = 'none';
    ta.style.display = '';
    return null;
  }
  try {
    _cmJsonEditor = CodeMirror(host, {
      value: ta.value || '',
      mode: { name: 'javascript', json: true },
      theme: 'eclipse',
      lineNumbers: true,
      matchBrackets: true,
      autoCloseBrackets: true,
      foldGutter: true,
      gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
      indentUnit: 2,
      tabSize: 2,
      lineWrapping: false
    });
    _cmJsonEditor.setSize('100%', 480);
  } catch (err) {
    console.warn('CodeMirror init failed, falling back to textarea:', err);
    host.style.display = 'none';
    ta.style.display = '';
    _cmJsonEditor = null;
  }
  return _cmJsonEditor;
}

function setJsonEditorValue(text) {
  ensureJsonEditor();
  const ta = document.getElementById('wfs-style-json-editor');
  if (ta) ta.value = text || '';
  if (_cmJsonEditor) _cmJsonEditor.setValue(text || '');
}
function getJsonEditorValue() {
  if (_cmJsonEditor) return _cmJsonEditor.getValue();
  const ta = document.getElementById('wfs-style-json-editor');
  return ta ? ta.value : '';
}
function setJsonEditorStatus(msg, isError) {
  const el = document.getElementById('wfs-style-json-status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? '#c00' : '#0a7d2c';
}

document.getElementById('wfs-style-format-json')?.addEventListener('click', () => {
  try {
    const obj = JSON.parse(getJsonEditorValue() || '{}');
    setJsonEditorValue(JSON.stringify(obj, null, 2));
    setJsonEditorStatus('Formateado.', false);
  } catch (err) {
    setJsonEditorStatus((t('Qtiler2Origo.wfs_invalid_json') || 'Invalid JSON: ') + err.message, true);
  }
});

/* ======================================================================
   Per-attribute value loader (for filter value dropdown)
   ====================================================================== */
const _layerValuesCache = new Map(); // key: layer|field -> string[]
function loadLayerValues(projectId, layerName, fieldName) {
  const sourceLayerName = String(getMainLayerByName(layerName)?.name || layerName).trim();
  const key = `${projectId}||${sourceLayerName}||${fieldName}`;
  if (_layerValuesCache.has(key)) return Promise.resolve(_layerValuesCache.get(key));
  if (!projectId || !sourceLayerName || !fieldName) return Promise.resolve([]);
  return fetch(`/Qtiler2Origo/layer-values?project=${encodeURIComponent(projectId)}&layer=${encodeURIComponent(sourceLayerName)}&field=${encodeURIComponent(fieldName)}&limit=500`)
    .then(r => r.ok ? r.json() : { values: [] })
    .then(d => {
      const arr = Array.isArray(d.values) ? d.values : [];
      _layerValuesCache.set(key, arr);
      return arr;
    })
    .catch(() => []);
}

function attachValueDatalistForRule(idx) {
  const card = document.querySelector(`[data-rule-editor-root="${idx}"]`);
  if (!card) return;
  const fieldSel = card.querySelector('[data-rk="f.field"]');
  const valueInput = card.querySelector('[data-rk="f.value"]');
  const valueHelp = card.querySelector('[data-rk="f.value-help"]');
  if (!fieldSel || !valueInput) return;
  if (!fieldSel.dataset.dlBound) {
    fieldSel.dataset.dlBound = '1';
    fieldSel.addEventListener('change', () => attachValueDatalistForRule(idx));
  }
  const field = fieldSel.value;
  if (!field) {
    valueInput.removeAttribute('list');
    valueInput.placeholder = t('Qtiler2Origo.wfs_value_placeholder_any') || 'Write a value';
    valueInput.disabled = false;
    valueInput.readOnly = false;
    if (valueHelp) valueHelp.textContent = t('Qtiler2Origo.wfs_value_help_pick_field') || 'Select an attribute first to filter by a value.';
    return;
  }
  const projectId = getLayerProjectId(currentEditingWfsLayer);
  const dlId = `dl-rule-${idx}-${field.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  loadLayerValues(projectId, currentEditingWfsLayer, field).then(values => {
    valueInput.disabled = false;
    valueInput.readOnly = false;
    let dl = document.getElementById(dlId);
    if (Array.isArray(values) && values.length) {
      if (!dl) {
        dl = document.createElement('datalist');
        dl.id = dlId;
        card.appendChild(dl);
      }
      dl.innerHTML = values.map(v => `<option value="${String(v).replace(/"/g, '&quot;')}"></option>`).join('');
      valueInput.setAttribute('list', dlId);
      valueInput.placeholder = t('Qtiler2Origo.wfs_value_placeholder_suggested') || 'Write a value or choose a suggestion';
      if (valueHelp) valueHelp.textContent = t('Qtiler2Origo.wfs_value_help_suggested') || 'Use an existing value or write a new one manually.';
      return;
    }
    if (dl) {
      try { dl.remove(); } catch {}
    }
    valueInput.removeAttribute('list');
    valueInput.placeholder = t('Qtiler2Origo.wfs_value_placeholder_any') || 'Write a value';
    if (valueHelp) valueHelp.textContent = t('Qtiler2Origo.wfs_value_help_manual') || 'You can type a value manually even if the attribute has no detected values.';
  }).catch(() => {
    valueInput.disabled = false;
    valueInput.readOnly = false;
    valueInput.removeAttribute('list');
    valueInput.placeholder = t('Qtiler2Origo.wfs_value_placeholder_any') || 'Write a value';
    if (valueHelp) valueHelp.textContent = t('Qtiler2Origo.wfs_value_help_manual') || 'You can type a value manually even if the attribute has no detected values.';
  });
}
window.openStyleEditor = openStyleEditor;
window.saveStyleEditor = saveStyleEditor;





/* === How it works modal wiring === */
(function () {
  const modal = document.getElementById('q2o-hiw-modal');
  const openBtn = document.getElementById('q2o-open-hiw');
  if (!modal || !openBtn) return;
  const open = () => { modal.hidden = false; modal.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden'; };
  const close = () => { modal.hidden = true; modal.setAttribute('aria-hidden','true'); document.body.style.overflow=''; };
  openBtn.addEventListener('click', open);
  modal.querySelectorAll('[data-hiw-close]').forEach((el) => el.addEventListener('click', close));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) close(); });
})();

