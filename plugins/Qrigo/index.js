import express from 'express';
import path from 'path';
import fs from 'fs';

const QRIGO_PREVIEW_VERSION = '2026-04-04-b';

/* ── Self-contained Origo preview page ──────────────────────────────── */
const ORIGO_PREVIEW_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <base href="/Thirdparty/origo/">
  <title>Origo Preview – Qtiler</title>
  <link href="/Thirdparty/origo/css/style.css" rel="stylesheet">
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
    #app-wrapper { width: 100%; height: 100%; }
    #qrigo-loading { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
      background: #f8fafc; font-family: "Segoe UI", system-ui, sans-serif; color: #334155; font-size: 1.1rem; z-index: 9999; }
    #qrigo-loading.hidden { display: none; }
  </style>
</head>
<body>
  <div id="qrigo-loading">Loading Origo preview&hellip;</div>
  <div id="app-wrapper"></div>
  <script src="/Thirdparty/origo/js/origo.js"></script>
  <script>
  (async () => {
    const loading = document.getElementById('qrigo-loading');
    const params = new URLSearchParams(location.search);
    const projectId = params.get('project');
    const layerName = params.get('layer');
    const mode = String(params.get('mode') || '').trim().toLowerCase();
    const isThemeMode = mode === 'theme';
    const serviceRaw = params.get('service') || 'wmts';
    const serviceList = String(serviceRaw)
      .split(',')
      .map(s => String(s || '').trim().toLowerCase())
      .filter(Boolean);
    const allowedServices = new Set(['wmts', 'wms', 'wfs', 'vt']);
    const selectedServices = (serviceList.length ? serviceList : ['wmts']).filter((s) => allowedServices.has(s));
    const hasService = (name) => selectedServices.includes(String(name || '').toLowerCase());
    const includeWmts = hasService('wmts');
    const includeWms = hasService('wms');
    const includeWfs = hasService('wfs');
    const includeVt = hasService('vt');
    const wfsOnly = hasService('wfs') && !hasService('wmts') && !hasService('wms') && !hasService('vt');
    const vtOnly = hasService('vt') && !hasService('wmts') && !hasService('wms') && !hasService('wfs');
    if (!projectId || !layerName) {
      loading.textContent = 'Missing ?project= or ?layer= parameter.';
      return;
    }

    const origin = location.origin;
    const WEBMERC_MAX = 20037508.342789244;
    const WEBMERC_BASE_RES = 156543.03392804097;
    // Approx. max zoom-in around 1:2000 scale in WebMercator.
    const MAX_ORIGO_ZOOM = 17;
    const WEBMERC_RESOLUTIONS = Array.from({ length: MAX_ORIGO_ZOOM + 1 }, (_, z) => WEBMERC_BASE_RES / Math.pow(2, z));

    /* Fetch cache index for tile grid + extent */
    let cacheIndex = null;
    try {
      const r = await fetch('/cache/' + encodeURIComponent(projectId) + '/index.json', { credentials: 'include' });
      if (r.ok) cacheIndex = await r.json();
    } catch {}

    let cachedLayer = null;
    if (cacheIndex && Array.isArray(cacheIndex.layers)) {
      cachedLayer = cacheIndex.layers.find(l => l.name === layerName) || cacheIndex.layers[0] || null;
    }

    const normalizeExtent = (value) => {
      if (!Array.isArray(value) || value.length !== 4) return null;
      const nums = value.map((v) => Number(v));
      if (nums.some((n) => !Number.isFinite(n))) return null;
      const [minx, miny, maxx, maxy] = nums;
      if (maxx <= minx || maxy <= miny) return null;
      return [minx, miny, maxx, maxy];
    };
    const extentArea = (ex) => {
      const n = normalizeExtent(ex);
      if (!n) return -1;
      return (n[2] - n[0]) * (n[3] - n[1]);
    };
    const pickLargestExtent = (extents) => {
      if (!Array.isArray(extents) || !extents.length) return null;
      let best = null;
      let bestArea = -1;
      for (const ex of extents) {
        const n = normalizeExtent(ex);
        if (!n) continue;
        const a = extentArea(n);
        if (a > bestArea) {
          best = n;
          bestArea = a;
        }
      }
      return best;
    };

    /* Fetch project config for layer-specific settings */
    let projectConfig = null;
    try {
      const r = await fetch('/projects/' + encodeURIComponent(projectId) + '/config', { credentials: 'include' });
      if (r.ok) projectConfig = await r.json();
    } catch {}

    /* Fetch layer list for metadata */
    let layerData = null;
    try {
      const r = await fetch('/projects/' + encodeURIComponent(projectId) + '/layers', { credentials: 'include' });
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d.layers)) layerData = d.layers.find(l => l.name === layerName) || null;
      }
    } catch {}

    const rawCrs = cachedLayer?.crs || layerData?.crs || 'EPSG:3857';
    const crs = String(rawCrs || 'EPSG:3857').trim() || 'EPSG:3857';
    const normalizedCrs = crs.toUpperCase();
    const isWebMercator = normalizedCrs === 'EPSG:3857';
    const mapProjectionCode = vtOnly ? 'EPSG:3857' : normalizedCrs;
    const extentCandidates = [];
    const directLayerExtent = normalizeExtent(cachedLayer?.extent) || normalizeExtent(layerData?.extent);
    if (directLayerExtent) extentCandidates.push(directLayerExtent);

    // Theme mode: pick largest extent among source layers to keep map focused on visible data.
    if (isThemeMode && cacheIndex && Array.isArray(cacheIndex.layers)) {
      try {
        const sourceLayerNames = Array.isArray(projectConfig?.themes?.[layerName]?.sourceLayers)
          ? projectConfig.themes[layerName].sourceLayers.map((n) => String(n || '').trim()).filter(Boolean)
          : [];
        if (sourceLayerNames.length) {
          for (const srcName of sourceLayerNames) {
            const item = cacheIndex.layers.find((l) => String(l?.name || '') === srcName);
            const ex = normalizeExtent(item?.extent);
            if (ex) extentCandidates.push(ex);
          }
        }
      } catch {}
    }

    const extent = pickLargestExtent(extentCandidates) || null;

    /* Build resolutions from tile matrix */
    const tms = cachedLayer?.tile_matrix_set || null;
    let resolutions = [];
    let tileGridOrigin = null;
    if (tms) {
      const matrices = tms.matrices || tms.matrixSet || [];
      resolutions = matrices
        .map(m => Number(m && m.resolution))
        .filter(Number.isFinite);
      if (resolutions.length > (MAX_ORIGO_ZOOM + 1)) {
        resolutions = resolutions.slice(0, MAX_ORIGO_ZOOM + 1);
      }
      const originCandidate = tms.topLeftCorner || tms.top_left_corner || null;
      tileGridOrigin = (Array.isArray(originCandidate) && originCandidate.length === 2 && originCandidate.every(Number.isFinite))
        ? originCandidate
        : null;
    }

    /* proj4 definition (try to read from cache or use known defaults) */
    const proj4Defs = [];
    const seenProj4Codes = new Set();
    const addProj4 = (code, proj) => {
      if (!code || !proj) return;
      const normalizedCode = String(code).trim().toUpperCase();
      if (!normalizedCode || seenProj4Codes.has(normalizedCode)) return;
      seenProj4Codes.add(normalizedCode);
      proj4Defs.push({
        code: normalizedCode,
        alias: 'urn:ogc:def:crs:EPSG::' + normalizedCode.replace('EPSG:', ''),
        projection: proj
      });
    };
    // Keep both common map CRSs available so 4326 layers can coexist with 3857 basemaps.
    addProj4('EPSG:3857', '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs +type=crs');
    addProj4('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs +type=crs');
    /* Try to get project CRS definition */
    try {
      const r = await fetch('/api/proj4/' + encodeURIComponent(normalizedCrs), { credentials: 'include' });
      if (r.ok) {
        const d = await r.json();
        if (d.def) addProj4(normalizedCrs, d.def);
      }
    } catch {}

    /* Projection extent */
    let projectionExtent = null;
    if (tms && tileGridOrigin && resolutions.length) {
      const tileSize = tms.tile_width || 256;
      const matrices = tms.matrices || tms.matrixSet || [];
      if (matrices.length) {
        const finest = matrices[matrices.length - 1];
        const w = finest.matrix_width * tileSize * finest.resolution;
        const h = finest.matrix_height * tileSize * finest.resolution;
        projectionExtent = [tileGridOrigin[0], tileGridOrigin[1] - h, tileGridOrigin[0] + w, tileGridOrigin[1]];
      }
    }

    let center = null;
    if (extent && extent.length === 4) center = [(extent[0]+extent[2])/2, (extent[1]+extent[3])/2];

    /* Build Origo config */
    const sanitize = v => String(v||'').replace(/[^A-Za-z0-9_-]/g, '_');
    /* Match Python safe_xml_name exactly for WFS typenames */
    const safeXmlName = v => {
      var s = String(v||'').trim();
      if (!s) return '_';
      s = s.replace(/[^A-Za-z0-9_.-]+/g, '_');
      if (!/^[A-Za-z_]/.test(s)) s = '_' + s;
      if (/^xml/i.test(s)) s = '_' + s;
      return s;
    };
    const pKey = sanitize(projectId);
    const lKey = sanitize(layerName);
    const wfsTypeName = safeXmlName(layerName);
    const searchLayerToken = wfsTypeName || layerName;
    const group = projectId;

    const controls = [
      { name: 'mapmenu' },
      { name: 'home' },
      { name: 'legend', options: { expanded: true, turnOffLayersControl: true } }
    ];
    if (resolutions.length) controls.push({ name: 'scalepicker' });

    const config = {
      controls,
      projectionCode: mapProjectionCode,
      proj4Defs,
      zoom: resolutions.length ? Math.min(4, resolutions.length - 1) : 0,
      maxZoom: MAX_ORIGO_ZOOM,
      groups: [
        { name: 'background', title: 'Bakgrundskartor', expanded: true },
        { name: group, title: projectId, expanded: true }
      ],
      source: {},
      layers: []
    };

        const NONE_SOURCE = 'Qtiler_NONE_BASE';
        config.source[NONE_SOURCE] = {
          type: 'XYZ',
          url: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
        };
        const backgroundNoneLayer = {
          name: 'background_none',
          title: 'No background',
          group: 'background',
          source: NONE_SOURCE,
          type: 'XYZ',
          visible: true,
          queryable: false
        };
        const backgroundOsmLayer = {
          name: 'osm',
          title: 'OpenStreetMap',
          group: 'background',
          visible: false,
          type: 'OSM',
          style: 'osm',
          maxZoom: MAX_ORIGO_ZOOM,
          queryable: false,
          attribution: '© OpenStreetMap contributors'
        };

    if (!vtOnly && mapProjectionCode === normalizedCrs && resolutions.length) config.resolutions = resolutions.slice();
    if (!vtOnly && mapProjectionCode === normalizedCrs && extent) config.extent = extent;
    if (!vtOnly && mapProjectionCode === normalizedCrs && center) config.center = center;
    if (!vtOnly && mapProjectionCode === normalizedCrs && projectionExtent) config.projectionExtent = projectionExtent;
    if (!vtOnly && mapProjectionCode === 'EPSG:4326' && !config.projectionExtent) {
      config.projectionExtent = [-180, -90, 180, 90];
    }

    if (!vtOnly && mapProjectionCode === 'EPSG:3857') {
      config.resolutions = WEBMERC_RESOLUTIONS.slice();
      config.projectionExtent = [-WEBMERC_MAX, -WEBMERC_MAX, WEBMERC_MAX, WEBMERC_MAX];
      if (!config.center) config.center = [0, 0];
    }

    const isVector = !!(
      (layerData && (layerData.kind === 'vector' || layerData.geometry_type))
      || includeWfs
    );

    /* Map QGIS geometry types to Origo geometry types */
    var origoGeomType = null;
    if (layerData && layerData.geometry_type) {
      var gt = String(layerData.geometry_type).toLowerCase();
      if (gt.indexOf('polygon') !== -1) origoGeomType = 'Polygon';
      else if (gt.indexOf('line') !== -1) origoGeomType = 'LineString';
      else if (gt.indexOf('point') !== -1) origoGeomType = 'Point';
    }

    /* Layer-specific project config for editable / searchable flags */
    var configLayer = null;
    if (projectConfig && typeof projectConfig.layers === 'object') {
      configLayer = projectConfig.layers[layerName] || null;
    }
    const editable = isVector && hasService('wfs') && !(configLayer && configLayer.wfsEditable === false);

    /* Fetch WFS attributes when editable */
    var wfsAttributes = [];
    var wfsGeometryName = 'geometry';
    var wfsFeatureNS = '';
    if (editable) {
      try {
        var ar = await fetch('/origo/wfs-attributes?project=' + encodeURIComponent(projectId) + '&layer=' + encodeURIComponent(wfsTypeName), { credentials: 'include' });
        if (ar.ok) {
          var ad = await ar.json();
          if (Array.isArray(ad.attributes)) wfsAttributes = ad.attributes;
        }
      } catch {}
      /* Get geometry column name + namespace from WFS DescribeFeatureType */
      try {
        var dftUrl = origin + '/wfs?project=' + encodeURIComponent(projectId) + '&service=WFS&version=1.1.0&request=DescribeFeatureType&typeName=' + encodeURIComponent(wfsTypeName);
        var dftR = await fetch(dftUrl, { credentials: 'include' });
        if (dftR.ok) {
          var dftText = await dftR.text();
          var dftMatch = dftText.match(/<xsd:element\\s+name="([^"]+)"\\s+type="gml:/);
          if (dftMatch && dftMatch[1]) wfsGeometryName = dftMatch[1];
          var nsMatch = dftText.match(/targetNamespace="([^"]+)"/);
          if (nsMatch && nsMatch[1]) wfsFeatureNS = nsMatch[1];
        }
      } catch {}
    }

    /* Determine if layer is searchable */
    var searchable = false;
    var searchAttribute = 'name';
    var idAttribute = 'GID';
    var geometryAttribute = wfsGeometryName || 'GEOM';
    var hintText = 'Search...';
    if (isVector && includeWfs) {
      try {
        var sr = await fetch('/projects/' + encodeURIComponent(projectId) + '/searchable', { credentials: 'include' });
        if (sr.ok) {
          var entries = await sr.json();
          if (Array.isArray(entries)) {
            var entry = entries.find(function(e) { return e && String(e.name || '').trim() === layerName; });
            if (entry && entry.searchable !== false) {
              searchable = true;
              var fields = Array.isArray(entry.fields) ? entry.fields.map(function(f) { return String(f || '').trim(); }).filter(Boolean) : [];
              searchAttribute = String(entry.searchAttribute || entry.titleField || fields[0] || '').trim() || 'name';
              idAttribute = String(entry.idAttribute || '').trim() || 'GID';
              var configuredGeom = String(entry.geometryAttribute || '').trim();
              geometryAttribute = /(geom|geometry|wkb|wkt)/i.test(configuredGeom)
                ? configuredGeom
                : (wfsGeometryName || 'GEOM');
              hintText = String(entry.hintText || '').trim() || 'Search...';
            }
          }
        }
      } catch {}
      /* Fallback: check project config wfsSearchable flag */
      if (!searchable && configLayer && configLayer.wfsSearchable === true) {
        searchable = true;
      }
    }

    if (includeWfs && isVector) {
      const srcName = 'Qtiler_' + pKey + '_WFS';
      var wfsSrcDef = {
        url: origin + '/wfs?project=' + encodeURIComponent(projectId),
        type: 'WFS',
        projection: crs,
        srsName: crs
      };
      if (wfsFeatureNS) {
        wfsSrcDef.workspace = wfsFeatureNS;
        wfsSrcDef.prefix = 'feature';
      }
      config.source[srcName] = wfsSrcDef;
      var wfsLayerDef = {
        name: wfsTypeName,
        title: layerName + ' [WFS]',
        group,
        source: srcName,
        type: 'WFS',
        queryable: true,
        visible: true,
        style: 'default',
        featureType: wfsTypeName,
        projection: normalizedCrs,
        srsName: crs,
        maxZoom: MAX_ORIGO_ZOOM
      };
      if (origoGeomType) {
        wfsLayerDef.geometryType = origoGeomType;
        wfsLayerDef.geometryName = wfsGeometryName;
      }
      if (editable) {
        wfsLayerDef.editable = true;
        if (wfsAttributes.length) wfsLayerDef.attributes = wfsAttributes;
      }
      config.layers.push(wfsLayerDef);
    }

    if (includeWms) {
      const srcName = 'Qtiler_' + pKey + '_WMS';
      const wmsLayerName = isThemeMode ? ('theme:' + layerName) : layerName;
      config.source[srcName] = {
        url: origin + '/wms?project=' + encodeURIComponent(projectId),
        type: 'WMS',
        params: { LAYERS: wmsLayerName }
      };
      config.layers.push({
        name: layerName,
        title: layerName + ' [WMS]',
        group,
        source: srcName,
        type: 'WMS',
        sourceParams: { LAYERS: wmsLayerName },
        visible: true,
        maxZoom: MAX_ORIGO_ZOOM
      });
    }

    if (includeWmts) {
      /* WMTS/XYZ (default) */
      const srcName = 'Qtiler_' + pKey + '_' + lKey + '_XYZ';
      const wmtsTemplate = isThemeMode
        ? (origin + '/wmts/' + encodeURIComponent(projectId) + '/themes/' + encodeURIComponent(layerName) + '/{z}/{x}/{y}.png')
        : (origin + '/wmts/' + encodeURIComponent(projectId) + '/' + encodeURIComponent(layerName) + '/{z}/{x}/{y}.png');
      const srcDef = {
        url: wmtsTemplate,
        type: 'XYZ'
      };
      if (normalizedCrs) srcDef.projection = normalizedCrs;
      config.source[srcName] = srcDef;

      const layerDef = {
        name: layerName,
        title: layerName + ' [WMTS]',
        group,
        source: srcName,
        type: 'XYZ',
        format: 'image/png',
        visible: true,
        style: 'add me',
        maxZoom: MAX_ORIGO_ZOOM
      };
      if (tileGridOrigin && resolutions.length) {
        layerDef.tileGrid = {
          alignBottomLeft: false,
          origin: tileGridOrigin,
          resolutions: resolutions.slice()
        };
      }
      if (extent) layerDef.extent = extent;
      config.layers.push(layerDef);
    }

    if (includeVt) {
      const vtSourceName = 'Qtiler_' + pKey + '_VT_SOURCE';
      const vtLayerName = pKey + '_vectortiles';
      let vtLayerUrl = '/plugins/VectorTiles/tiles/' + encodeURIComponent(projectId) + '/{z}/{x}/{y}.pbf';
      let vtMinZoom = 0;
      let vtMaxZoom = 22;
      try {
        const tr = await fetch('/plugins/VectorTiles/tilejson/' + encodeURIComponent(projectId) + '.json', { credentials: 'include' });
        if (tr.ok) {
          const tj = await tr.json();
          if (Array.isArray(tj?.tiles) && tj.tiles[0]) {
            try {
              const tileUrl = new URL(String(tj.tiles[0]), origin);
              vtLayerUrl = tileUrl.pathname + (tileUrl.search || '');
            } catch {}
          }
          if (Number.isFinite(tj?.minzoom)) vtMinZoom = Number(tj.minzoom);
          if (Number.isFinite(tj?.maxzoom)) vtMaxZoom = Number(tj.maxzoom);
        }
      } catch {}

      config.source[vtSourceName] = {
        type: 'VECTORTILE',
        url: origin
      };

      config.layers.push({
        name: vtLayerName,
        source: vtSourceName,
        title: projectId + ' [VectorTiles]',
        group,
        type: 'VECTORTILE',
        layerURL: vtLayerUrl,
        format: 'pbf',
        style: 'default',
        layerName: vtLayerName,
        gridset: 'qtiler',
        minZoom: vtMinZoom,
        maxZoom: vtMaxZoom,
        visible: true
      });

      const vtWrap = document.createElement('div');
      vtWrap.style.position = 'fixed';
      vtWrap.style.right = '12px';
      vtWrap.style.top = '12px';
      vtWrap.style.zIndex = '10001';
      vtWrap.innerHTML = '<a href="/viewer.html?vectortiles=' + encodeURIComponent(projectId) + '" target="_blank" rel="noopener" style="display:inline-block;background:#1f2937;color:#fff;text-decoration:none;padding:8px 10px;border-radius:8px;font-family:Segoe UI,system-ui,sans-serif;font-size:12px;">Open Vector Tiles viewer</a>';
      document.body.appendChild(vtWrap);
    }

    /* Add editor control when editable WFS layer is present */
    if (editable && origoGeomType) {
      var drawToolsDef = {};
      if (origoGeomType === 'Polygon') drawToolsDef = { Polygon: ['Polygon'] };
      else if (origoGeomType === 'LineString') drawToolsDef = { LineString: ['LineString'] };
      else if (origoGeomType === 'Point') drawToolsDef = { Point: ['Point'] };
      config.controls.push({
        name: 'editor',
        options: {
          autoForm: true,
          autoSave: false,
          defaultLayer: wfsTypeName,
          snap: true,
          drawTools: drawToolsDef
        }
      });
    }

    /* Add search control when searchable layer is present */
    if (searchable) {
      config.controls.push({
        name: 'search',
        options: {
          url: origin + '/api/search?project=' + encodeURIComponent(projectId) + '&l=' + encodeURIComponent(searchLayerToken),
          searchAttribute: (searchAttribute || 'SEARCH_VALUE'),
          easting: 'EASTING',
          northing: 'NORTHING',
          title: 'Search',
          hintText: hintText
        }
      });
    }

    // Keep background entries always at the end of layers.
    config.layers.push(backgroundNoneLayer);
    config.layers.push(backgroundOsmLayer);

    const isFiniteNumber = (v) => Number.isFinite(Number(v));
    const normalizeResolutions = (vals) => {
      if (!Array.isArray(vals)) return null;
      const out = vals.map((v) => Number(v)).filter(Number.isFinite);
      return out.length ? out : null;
    };
    const sanitizeTileGrid = (tg) => {
      if (!tg || typeof tg !== 'object') return null;
      const rs = normalizeResolutions(tg.resolutions);
      const origin = Array.isArray(tg.origin) && tg.origin.length === 2 && tg.origin.every(isFiniteNumber)
        ? [Number(tg.origin[0]), Number(tg.origin[1])]
        : null;
      if (!rs || !origin) return null;
      return {
        alignBottomLeft: !!tg.alignBottomLeft,
        origin,
        resolutions: rs
      };
    };
    const sanitizeExtent = (ex) => {
      if (!Array.isArray(ex) || ex.length !== 4 || !ex.every(isFiniteNumber)) return null;
      return ex.map((n) => Number(n));
    };
    const sanitizeCenter = (c) => {
      if (!Array.isArray(c) || c.length !== 2 || !c.every(isFiniteNumber)) return null;
      return c.map((n) => Number(n));
    };

    const orderedConfig = {
      modules: Array.isArray(config?.controls) ? config.controls : [],
      settings: {},
      source: (config && typeof config.source === 'object' && config.source) ? config.source : {},
      groups: Array.isArray(config?.groups) ? config.groups : [],
      layers: Array.isArray(config?.layers) ? config.layers : [],
      styles: (config && typeof config.styles === 'object' && config.styles) ? config.styles : {}
    };
    if (config?.projectionCode) orderedConfig.settings.projectionCode = config.projectionCode;
    if (Array.isArray(config?.proj4Defs) && config.proj4Defs.length) orderedConfig.settings.proj4Defs = config.proj4Defs;
    if (Number.isFinite(Number(config?.zoom))) orderedConfig.settings.zoom = Number(config.zoom);
    if (Number.isFinite(Number(config?.maxZoom))) orderedConfig.settings.maxZoom = Number(config.maxZoom);
    if (Array.isArray(config?.resolutions) && config.resolutions.length) orderedConfig.settings.resolutions = config.resolutions;
    if (Array.isArray(config?.projectionExtent) && config.projectionExtent.length === 4) orderedConfig.settings.projectionExtent = config.projectionExtent;
    if (Array.isArray(config?.extent) && config.extent.length === 4) orderedConfig.settings.extent = config.extent;
    if (Array.isArray(config?.center) && config.center.length === 2) orderedConfig.settings.center = config.center;

    // Keep strict ordering for emitted JSON, then map to Origo runtime keys.
    const runtimeConfig = {
      controls: orderedConfig.modules,
      ...orderedConfig.settings,
      source: orderedConfig.source,
      groups: orderedConfig.groups,
      layers: orderedConfig.layers,
      styles: orderedConfig.styles
    };

    const safeConfig = JSON.parse(JSON.stringify(runtimeConfig || {}));
    const safeResolutions = normalizeResolutions(safeConfig.resolutions);
    if (safeResolutions) safeConfig.resolutions = safeResolutions;
    else delete safeConfig.resolutions;

    const safeExtent = sanitizeExtent(safeConfig.extent);
    if (safeExtent) safeConfig.extent = safeExtent;
    else delete safeConfig.extent;

    const safeCenter = sanitizeCenter(safeConfig.center);
    if (safeCenter) safeConfig.center = safeCenter;
    else delete safeConfig.center;

    if (!Array.isArray(safeConfig.controls)) safeConfig.controls = [];
    if (!safeResolutions) {
      safeConfig.controls = safeConfig.controls.filter((ctrl) => String(ctrl?.name || '').toLowerCase() !== 'scalepicker');
    }

    if (Array.isArray(safeConfig.layers)) {
      safeConfig.layers = safeConfig.layers.map((lyr) => {
        if (!lyr || typeof lyr !== 'object') return lyr;
        const out = { ...lyr };
        const cleanGrid = sanitizeTileGrid(out.tileGrid);
        if (cleanGrid) out.tileGrid = cleanGrid;
        else delete out.tileGrid;

        if (String(out.type || '').toUpperCase() === 'XYZ'
          && String(safeConfig.projectionCode || 'EPSG:3857').toUpperCase() === 'EPSG:3857'
          && !out.tileGrid) {
          out.tileGrid = {
            alignBottomLeft: false,
            origin: [-WEBMERC_MAX, WEBMERC_MAX],
            resolutions: WEBMERC_RESOLUTIONS.slice()
          };
        }
        return out;
      });
    }

    // For EPSG:3857 previews (WMS/WMTS/WFS), ensure map-level grid hints exist.
    if (String(safeConfig.projectionCode || '').toUpperCase() === 'EPSG:3857') {
      if (!Array.isArray(safeConfig.resolutions) || !safeConfig.resolutions.length) {
        safeConfig.resolutions = WEBMERC_RESOLUTIONS.slice();
      }
      if (!Array.isArray(safeConfig.projectionExtent) || safeConfig.projectionExtent.length !== 4) {
        safeConfig.projectionExtent = [-WEBMERC_MAX, -WEBMERC_MAX, WEBMERC_MAX, WEBMERC_MAX];
      }
      if (!Array.isArray(safeConfig.center) || safeConfig.center.length !== 2) {
        safeConfig.center = [0, 0];
      }
    }

    console.log('[Qrigo] preview version:', '${QRIGO_PREVIEW_VERSION}');
    console.log('[Qrigo] layerData:', layerData);
    console.log('[Qrigo] isVector:', isVector, '| origoGeomType:', origoGeomType, '| editable:', editable, '| searchable:', searchable);
    console.log('[Qrigo] ordered config:', JSON.stringify(orderedConfig, null, 2));
    console.log('[Qrigo] runtime config:', JSON.stringify(safeConfig, null, 2));

    if (!Array.isArray(safeConfig.layers) || safeConfig.layers.length === 0) {
      loading.textContent = 'Qrigo preview could not build any layer from the selected service. Check login/session and layer permissions.';
      return;
    }

    loading.classList.add('hidden');
    try {
      Origo(safeConfig);
    } catch (err) {
      console.error('[Qrigo] Primary Origo config failed, retrying with fallback:', err);
      const fallbackConfig = JSON.parse(JSON.stringify(safeConfig || {}));
      fallbackConfig.projectionCode = 'EPSG:3857';
      delete fallbackConfig.proj4Defs;
      delete fallbackConfig.resolutions;
      delete fallbackConfig.projectionExtent;
      delete fallbackConfig.extent;
      delete fallbackConfig.center;
      if (Array.isArray(fallbackConfig.controls)) {
        fallbackConfig.controls = fallbackConfig.controls.filter((ctrl) => String(ctrl?.name || '').toLowerCase() !== 'scalepicker');
      }
      if (Array.isArray(fallbackConfig.layers)) {
        fallbackConfig.layers = fallbackConfig.layers.map((lyr) => {
          if (!lyr || typeof lyr !== 'object') return lyr;
          const out = { ...lyr };
          delete out.tileGrid;
          return out;
        });
      }
      Origo(fallbackConfig);
    }
  })();
  </script>
</body>
</html>`;

export const register = async ({ app, baseDir }) => {
  const clientDir = path.join(baseDir, 'client');
  app.use('/plugins/Qrigo/client', express.static(clientDir, { index: false }));

  const sendPreviewHtml = (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.type('text/html').send(ORIGO_PREVIEW_HTML);
  };

  /* ── Origo preview route ─────────────────────────────────────────── */
  app.get('/qrigo/preview', (_req, res) => {
    const origoDir = path.join(process.cwd(), 'public', 'Thirdparty', 'origo');
    if (!fs.existsSync(path.join(origoDir, 'js', 'origo.js'))) {
      return res.status(404).send('Origo not found in Thirdparty/origo');
    }
    sendPreviewHtml(res);
  });

  // Alias route to bypass stale browser-cached preview pages.
  app.get('/qrigo/preview2', (_req, res) => {
    const origoDir = path.join(process.cwd(), 'public', 'Thirdparty', 'origo');
    if (!fs.existsSync(path.join(origoDir, 'js', 'origo.js'))) {
      return res.status(404).send('Origo not found in Thirdparty/origo');
    }
    sendPreviewHtml(res);
  });
  app.get('/plugins/Qrigo/admin', (_req, res) => {
    const adminHtml = `<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Qrigo</title>
          <style>
            :root { color-scheme: light; }
            body { font-family: "Segoe UI", system-ui, sans-serif; padding: 20px; background: #f8fafc; color: #0f172a; }
            .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08); }
            h2 { margin: 0 0 8px; font-size: 1.4rem; }
            h3 { margin: 18px 0 8px; font-size: 1.05rem; }
            p { margin: 0 0 12px; color: #475569; }
            ul, ol { margin: 0 0 12px 18px; color: #334155; }
            li { margin-bottom: 6px; }
            .note { margin-top: 14px; padding: 12px 14px; background: #f1f5f9; border-radius: 12px; color: #475569; font-size: 0.95rem; }
            .hiw-btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 16px; border-radius: 999px; border: 2px solid #2563eb; background: linear-gradient(135deg,#eff6ff,#dbeafe); color: #1d4ed8; font-weight: 700; cursor: pointer; font-size: 0.95rem; box-shadow: 0 4px 10px rgba(15,23,42,.08); transition: transform .15s, box-shadow .15s, background .15s; }
            .hiw-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 14px rgba(37,99,235,.2); background: linear-gradient(135deg,#dbeafe,#bfdbfe); }
            .hiw-actions { margin: 4px 0 16px; }
            .hiw-modal { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 24px; }
            .hiw-modal[hidden] { display: none; }
            .hiw-backdrop { position: absolute; inset: 0; background: rgba(15,23,42,.55); backdrop-filter: blur(2px); }
            .hiw-card { position: relative; z-index: 1; width: min(880px,100%); max-height: calc(100vh - 48px); background: #fff; color: #0f172a; border-radius: 14px; box-shadow: 0 20px 50px rgba(15,23,42,.25); border: 1px solid #e2e8f0; display: flex; flex-direction: column; overflow: hidden; }
            .hiw-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 22px; border-bottom: 1px solid #e2e8f0; background: #eff6ff; }
            .hiw-head h2 { margin: 0; font-size: 1.25rem; color: #1d4ed8; }
            .hiw-close { background: transparent; border: none; font-size: 1.6rem; line-height: 1; cursor: pointer; color: #64748b; padding: 4px 10px; border-radius: 8px; }
            .hiw-close:hover { background: #e2e8f0; color: #0f172a; }
            .hiw-body { padding: 20px 26px 26px; overflow-y: auto; font-size: 0.95rem; line-height: 1.55; }
            .hiw-body h3 { margin: 18px 0 8px; font-size: 1.02rem; color: #1d4ed8; }
            .hiw-body ul { margin: 6px 0 12px; padding-left: 22px; }
            .hiw-body li { margin-bottom: 4px; }
            .hiw-body code { background: #eff6ff; padding: 1px 6px; border-radius: 4px; font-size: 0.88em; color: #1d4ed8; }
          </style>
        </head>
        <body>
          <main class="card">
            <h2 data-i18n="qrigo.title">Qrigo plugin</h2>
            <p data-i18n="qrigo.subtitle">Adds Origo-ready layer snippets and WMS/WMTS/WFS connection helpers directly inside the Qtiler layer modal.</p>
            <div class="hiw-actions">
              <button id="qrigo-open-hiw" type="button" class="hiw-btn" data-i18n="qrigo.hiw.button">How it works &amp; Security</button>
            </div>

            <section>
              <h3 data-i18n="qrigo.what.title">What Qrigo does</h3>
              <ul>
                <li data-i18n="qrigo.what.1">Creates Origo JSON snippets for WMS, WMTS and WFS layers based on your project configuration.</li>
                <li data-i18n="qrigo.what.2">Includes editable WFS details (attributes/workspace) when the layer is marked editable in the dashboard.</li>
                <li data-i18n="qrigo.what.3">Keeps the snippets synced with layer edits such as BBOX and resolutions.</li>
              </ul>
            </section>

            <section>
              <h3 data-i18n="qrigo.how.title">How to use it</h3>
              <ol>
                <li data-i18n="qrigo.how.1">Open a project in the Qtiler admin dashboard and click a layer to view details.</li>
                <li data-i18n="qrigo.how.2">Select the “Qrigo / Origo” tab to copy the source + layer JSON blocks.</li>
                <li data-i18n="qrigo.how.3">Paste the snippets into Origo index.json and adjust titles or groupings as needed.</li>
              </ol>
            </section>

            <section>
              <h3 data-i18n="qrigo.outputs.title">Outputs included</h3>
              <ul>
                <li data-i18n="qrigo.outputs.1">Source entries for WMTS/WMS/WFS with the correct URLs and request parameters.</li>
                <li data-i18n="qrigo.outputs.2">Layer entries aligned with your Qtiler layer name, styling placeholder, and visibility defaults.</li>
                <li data-i18n="qrigo.outputs.3">Optional API-key placeholders when QtilerAuth is active.</li>
              </ul>
            </section>

            <section>
              <h3 data-i18n="qrigo.preview.title">Origo preview and editing</h3>
              <ul>
                <li data-i18n="qrigo.preview.1">Adds an Open in Origo action per compatible layer for quick live preview.</li>
                <li data-i18n="qrigo.preview.2">Auto-configures editor and search controls when WFS editable/searchable settings are enabled.</li>
                <li data-i18n="qrigo.preview.3">Normalizes geometry type, XML-safe typename, namespace, and geometry column for WFS-T compatibility.</li>
              </ul>
            </section>

            <section>
              <h3 data-i18n="qrigo.troubleshoot.title">Troubleshooting notes</h3>
              <ul>
                <li data-i18n="qrigo.troubleshoot.1">If saving fails in external clients, verify URLs include api_key for protected projects.</li>
                <li data-i18n="qrigo.troubleshoot.2">For QGIS WFS editing, prefer WFS 1.1.0 when testing transactional compatibility.</li>
                <li data-i18n="qrigo.troubleshoot.3">If layer names contain special symbols, Qrigo sanitizes typenames to valid XML identifiers.</li>
              </ul>
            </section>

            <div class="note" data-i18n="qrigo.note">Qrigo does not change data in Qtiler; it only prepares configuration text you can copy into Origo.</div>
          </main>

          <div id="qrigo-hiw-modal" class="hiw-modal" hidden aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="qrigo-hiw-title">
            <div class="hiw-backdrop" data-hiw-close></div>
            <div class="hiw-card" role="document">
              <header class="hiw-head">
                <h2 id="qrigo-hiw-title" data-i18n="qrigo.hiw.title">How Qrigo works &amp; security</h2>
                <button type="button" class="hiw-close" data-hiw-close aria-label="Close">&times;</button>
              </header>
              <div class="hiw-body">
                <p data-i18n="qrigo.hiw.lead">Qrigo is a read-only helper that turns each Qtiler layer into ready-to-paste Origo snippets. It does not modify your QGIS projects or the Qtiler database.</p>

                <h3 data-i18n="qrigo.hiw.vs.title">Qrigo vs Qtiler2Origo</h3>
                <ul>
                  <li data-i18n="qrigo.hiw.vs.1"><strong>Qrigo</strong> is for users who already run a standard Origo-map installation on their own server: it only generates the JSON snippets you paste into your existing Origo <code>index.json</code>.</li>
                  <li data-i18n="qrigo.hiw.vs.2"><strong>Qtiler2Origo</strong> is the plugin that installs Origo on top of Qtiler itself, lets you create and configure each map graphically using the QGIS library, and reuses Qtiler's cache and the WMS/WFS layers from projects published in Qtiler.</li>
                </ul>

                <h3 data-i18n="qrigo.hiw.arch.title">1. Architecture</h3>
                <ul>
                  <li data-i18n="qrigo.hiw.arch.1">Express plugin loaded from <code>plugins/Qrigo/</code>; no database, no background workers.</li>
                  <li data-i18n="qrigo.hiw.arch.2">Reads layer metadata from the running Qtiler project on every request &mdash; no separate cache to invalidate.</li>
                  <li data-i18n="qrigo.hiw.arch.3">Adds an Origo tab to the layer-details modal in the Qtiler dashboard.</li>
                </ul>

                <h3 data-i18n="qrigo.hiw.flow.title">2. Step by step</h3>
                <ul>
                  <li data-i18n="qrigo.hiw.flow.1">Open a project in the dashboard and click any layer to display its details modal.</li>
                  <li data-i18n="qrigo.hiw.flow.2">Click the <strong>Origo</strong> tab. Qrigo inspects the layer (WMS/WMTS/WFS, BBOX, resolutions, geometry, attributes).</li>
                  <li data-i18n="qrigo.hiw.flow.3">It generates two JSON blocks: a <code>source</code> entry (URL + parameters) and a <code>layer</code> entry (id, title, style, visibility).</li>
                  <li data-i18n="qrigo.hiw.flow.4">Copy each block with the dedicated button and paste them into your Origo <code>index.json</code>.</li>
                  <li data-i18n="qrigo.hiw.flow.5">If the layer is editable or searchable, the snippet also includes the matching Origo controls.</li>
                </ul>

                <h3 data-i18n="qrigo.hiw.wfs.title">3. WFS &amp; WFS-T compatibility</h3>
                <ul>
                  <li data-i18n="qrigo.hiw.wfs.1">Geometry type, geometry column, namespace and typename are normalised so QGIS Server and Origo agree on identifiers.</li>
                  <li data-i18n="qrigo.hiw.wfs.2">Special characters in layer names are escaped to valid XML identifiers; original titles are preserved for display.</li>
                  <li data-i18n="qrigo.hiw.wfs.3">For transactional editing, WFS 1.1.0 is recommended &mdash; the snippet wires the version automatically when the layer is editable.</li>
                </ul>

                <h3 data-i18n="qrigo.hiw.auth.title">4. Integration with QtilerAuth</h3>
                <ul>
                  <li data-i18n="qrigo.hiw.auth.1">When QtilerAuth is enabled, copied URLs include an <code>api_key</code> placeholder so QGIS Desktop and Origo can authenticate.</li>
                  <li data-i18n="qrigo.hiw.auth.2">Project ACLs (public / authenticated / private) are enforced upstream by QtilerAuth &mdash; Qrigo never bypasses them.</li>
                  <li data-i18n="qrigo.hiw.auth.3">Cached <code>GetCapabilities</code> responses are served without the <code>api_key</code> parameter to prevent leaks.</li>
                </ul>

                <h3 data-i18n="qrigo.hiw.security.title">5. Security &amp; privacy</h3>
                <ul>
                  <li data-i18n="qrigo.hiw.security.1">Qrigo is read-only on Qtiler data; it cannot publish, edit or delete projects or layers.</li>
                  <li data-i18n="qrigo.hiw.security.2">No third-party network calls. Snippets are generated locally from the project you are looking at.</li>
                  <li data-i18n="qrigo.hiw.security.3">Open source under MPL-2.0; auditable in <code>plugins/Qrigo/index.js</code>.</li>
                </ul>

                <h3 data-i18n="qrigo.hiw.troubleshoot.title">6. Troubleshooting</h3>
                <ul>
                  <li data-i18n="qrigo.hiw.troubleshoot.1">Saving fails in QGIS / Origo: confirm the URL contains <code>api_key</code> for protected projects.</li>
                  <li data-i18n="qrigo.hiw.troubleshoot.2">Empty layer list: verify the layer is published in the active QGIS project and that QtilerAuth grants you access.</li>
                  <li data-i18n="qrigo.hiw.troubleshoot.3">Wrong CRS in Origo: check the source block; Origo expects EPSG codes matching the project resolutions.</li>
                </ul>
              </div>
            </div>
          </div>

          <script>
            const TRANSLATIONS = {
              en: {
                'qrigo.title': 'Qrigo plugin',
                'qrigo.subtitle': 'Adds Origo-ready layer snippets and WMS/WMTS/WFS connection helpers directly inside the Qtiler layer modal.',
                'qrigo.what.title': 'What Qrigo does',
                'qrigo.what.1': 'Creates Origo JSON snippets for WMS, WMTS and WFS layers based on your project configuration.',
                'qrigo.what.2': 'Includes editable WFS details (attributes/workspace) when the layer is marked editable in the dashboard.',
                'qrigo.what.3': 'Keeps the snippets synced with layer edits such as BBOX and resolutions.',
                'qrigo.how.title': 'How to use it',
                'qrigo.how.1': 'Open a project in the Qtiler admin dashboard and click a layer to view details.',
                'qrigo.how.2': 'Select the “Qrigo / Origo” tab to copy the source + layer JSON blocks.',
                'qrigo.how.3': 'Paste the snippets into Origo index.json and adjust titles or groupings as needed.',
                'qrigo.outputs.title': 'Outputs included',
                'qrigo.outputs.1': 'Source entries for WMTS/WMS/WFS with the correct URLs and request parameters.',
                'qrigo.outputs.2': 'Layer entries aligned with your Qtiler layer name, styling placeholder, and visibility defaults.',
                'qrigo.outputs.3': 'Optional API-key placeholders when QtilerAuth is active.',
                'qrigo.preview.title': 'Origo preview and editing',
                'qrigo.preview.1': 'Adds an Open in Origo action per compatible layer for quick live preview.',
                'qrigo.preview.2': 'Auto-configures editor and search controls when WFS editable/searchable settings are enabled.',
                'qrigo.preview.3': 'Normalizes geometry type, XML-safe typename, namespace, and geometry column for WFS-T compatibility.',
                'qrigo.troubleshoot.title': 'Troubleshooting notes',
                'qrigo.troubleshoot.1': 'If saving fails in external clients, verify URLs include api_key for protected projects.',
                'qrigo.troubleshoot.2': 'For QGIS WFS editing, prefer WFS 1.1.0 when testing transactional compatibility.',
                'qrigo.troubleshoot.3': 'If layer names contain special symbols, Qrigo sanitizes typenames to valid XML identifiers.',
                'qrigo.note': 'Qrigo does not change data in Qtiler; it only prepares configuration text you can copy into Origo.',
                'qrigo.hiw.button': 'How it works & Security',
                'qrigo.hiw.title': 'How Qrigo works & security',
                'qrigo.hiw.lead': 'Qrigo is a read-only helper that turns each Qtiler layer into ready-to-paste Origo snippets. It does not modify your QGIS projects or the Qtiler database.',
                'qrigo.hiw.vs.title': 'Qrigo vs Qtiler2Origo',
                'qrigo.hiw.vs.1': 'Qrigo is meant for users who already run a standard Origo-map installation on their own server: it only generates the JSON snippets you paste into your existing Origo index.json.',
                'qrigo.hiw.vs.2': 'Qtiler2Origo is the plugin that installs Origo on top of Qtiler itself, lets you create and configure each map graphically using the QGIS library, and reuses Qtiler\'s cache and the WMS/WFS layers from projects published in Qtiler.',
                'qrigo.hiw.arch.title': '1. Architecture',
                'qrigo.hiw.arch.1': 'Express plugin loaded from plugins/Qrigo/; no database, no background workers.',
                'qrigo.hiw.arch.2': 'Reads layer metadata from the running Qtiler project on every request — no separate cache to invalidate.',
                'qrigo.hiw.arch.3': 'Adds an Origo tab to the layer-details modal in the Qtiler dashboard.',
                'qrigo.hiw.flow.title': '2. Step by step',
                'qrigo.hiw.flow.1': 'Open a project in the dashboard and click any layer to display its details modal.',
                'qrigo.hiw.flow.2': 'Click the Origo tab. Qrigo inspects the layer (WMS/WMTS/WFS, BBOX, resolutions, geometry, attributes).',
                'qrigo.hiw.flow.3': 'It generates two JSON blocks: a source entry (URL + parameters) and a layer entry (id, title, style, visibility).',
                'qrigo.hiw.flow.4': 'Copy each block with the dedicated button and paste them into your Origo index.json.',
                'qrigo.hiw.flow.5': 'If the layer is editable or searchable, the snippet also includes the matching Origo controls.',
                'qrigo.hiw.wfs.title': '3. WFS & WFS-T compatibility',
                'qrigo.hiw.wfs.1': 'Geometry type, geometry column, namespace and typename are normalised so QGIS Server and Origo agree on identifiers.',
                'qrigo.hiw.wfs.2': 'Special characters in layer names are escaped to valid XML identifiers; original titles are preserved for display.',
                'qrigo.hiw.wfs.3': 'For transactional editing, WFS 1.1.0 is recommended — the snippet wires the version automatically when the layer is editable.',
                'qrigo.hiw.auth.title': '4. Integration with QtilerAuth',
                'qrigo.hiw.auth.1': 'When QtilerAuth is enabled, copied URLs include an api_key placeholder so QGIS Desktop and Origo can authenticate.',
                'qrigo.hiw.auth.2': 'Project ACLs (public / authenticated / private) are enforced upstream by QtilerAuth — Qrigo never bypasses them.',
                'qrigo.hiw.auth.3': 'Cached GetCapabilities responses are served without the api_key parameter to prevent leaks.',
                'qrigo.hiw.security.title': '5. Security & privacy',
                'qrigo.hiw.security.1': 'Qrigo is read-only on Qtiler data; it cannot publish, edit or delete projects or layers.',
                'qrigo.hiw.security.2': 'No third-party network calls. Snippets are generated locally from the project you are looking at.',
                'qrigo.hiw.security.3': 'Open source under MPL-2.0; auditable in plugins/Qrigo/index.js.',
                'qrigo.hiw.troubleshoot.title': '6. Troubleshooting',
                'qrigo.hiw.troubleshoot.1': 'Saving fails in QGIS / Origo: confirm the URL contains api_key for protected projects.',
                'qrigo.hiw.troubleshoot.2': 'Empty layer list: verify the layer is published in the active QGIS project and that QtilerAuth grants you access.',
                'qrigo.hiw.troubleshoot.3': 'Wrong CRS in Origo: check the source block; Origo expects EPSG codes matching the project resolutions.'
              },
              es: {
                'qrigo.title': 'Plugin Qrigo',
                'qrigo.subtitle': 'Añade snippets listos para Origo y asistentes de conexión WMS/WMTS/WFS directamente en el modal de capas de Qtiler.',
                'qrigo.what.title': 'Qué hace Qrigo',
                'qrigo.what.1': 'Genera snippets JSON de Origo para capas WMS, WMTS y WFS a partir de la configuración del proyecto.',
                'qrigo.what.2': 'Incluye detalles de WFS editable (atributos/espacio de trabajo) cuando la capa está marcada como editable.',
                'qrigo.what.3': 'Mantiene los snippets sincronizados con cambios de capa como BBOX y resoluciones.',
                'qrigo.how.title': 'Cómo usarlo',
                'qrigo.how.1': 'Abre un proyecto en el panel de administración de Qtiler y haz clic en una capa para ver detalles.',
                'qrigo.how.2': 'Selecciona la pestaña “Qrigo / Origo” para copiar los bloques JSON de source + layer.',
                'qrigo.how.3': 'Pega los snippets en index.json de Origo y ajusta títulos o agrupaciones según necesites.',
                'qrigo.outputs.title': 'Salidas incluidas',
                'qrigo.outputs.1': 'Entradas de source para WMTS/WMS/WFS con las URLs y parámetros correctos.',
                'qrigo.outputs.2': 'Entradas de layer alineadas con el nombre de la capa en Qtiler, estilo de ejemplo y visibilidad por defecto.',
                'qrigo.outputs.3': 'Placeholders opcionales de API key cuando QtilerAuth está activo.',
                'qrigo.preview.title': 'Previsualización y edición en Origo',
                'qrigo.preview.1': 'Añade una acción Abrir en Origo por capa compatible para previsualización rápida.',
                'qrigo.preview.2': 'Configura automáticamente controles de edición y búsqueda cuando WFS editable/buscable está habilitado.',
                'qrigo.preview.3': 'Normaliza tipo de geometría, typename XML seguro, namespace y columna geométrica para compatibilidad WFS-T.',
                'qrigo.troubleshoot.title': 'Notas de resolución de problemas',
                'qrigo.troubleshoot.1': 'Si falla el guardado en clientes externos, verifica que las URLs incluyan api_key en proyectos protegidos.',
                'qrigo.troubleshoot.2': 'Para edición WFS desde QGIS, prioriza WFS 1.1.0 al validar compatibilidad transaccional.',
                'qrigo.troubleshoot.3': 'Si los nombres de capa tienen símbolos especiales, Qrigo sanea los typenames a identificadores XML válidos.',
                'qrigo.note': 'Qrigo no modifica datos en Qtiler; solo prepara texto de configuración para copiar en Origo.',
                'qrigo.hiw.button': 'Cómo funciona y seguridad',
                'qrigo.hiw.title': 'Cómo funciona Qrigo y por qué es seguro',
                'qrigo.hiw.lead': 'Qrigo es un asistente de solo lectura que convierte cada capa de Qtiler en snippets listos para pegar en Origo. No modifica tus proyectos QGIS ni la base de datos de Qtiler.',
                'qrigo.hiw.vs.title': 'Qrigo vs Qtiler2Origo',
                'qrigo.hiw.vs.1': 'Qrigo está pensado para usuarios que ya tienen Origo-map instalado de forma estándar en su propio servidor: solo genera los snippets JSON que pegas en el index.json de tu Origo existente.',
                'qrigo.hiw.vs.2': 'Qtiler2Origo es el plugin que permite instalar Origo sobre Qtiler, ofrece la facilidad de usar la biblioteca de QGIS y crear y configurar cada mapa de forma gráfica, y aprovecha el caché de Qtiler y las capas WMS/WFS de los proyectos añadidos en Qtiler.',
                'qrigo.hiw.arch.title': '1. Arquitectura',
                'qrigo.hiw.arch.1': 'Plugin Express cargado desde plugins/Qrigo/; sin base de datos ni procesos en segundo plano.',
                'qrigo.hiw.arch.2': 'Lee los metadatos de capa del proyecto Qtiler en cada petición — sin caché propia que invalidar.',
                'qrigo.hiw.arch.3': 'Añade una pestaña Origo al modal de detalles de capa del panel de Qtiler.',
                'qrigo.hiw.flow.title': '2. Paso a paso',
                'qrigo.hiw.flow.1': 'Abre un proyecto en el panel y haz clic en cualquier capa para ver su modal de detalles.',
                'qrigo.hiw.flow.2': 'Pulsa la pestaña Origo. Qrigo inspecciona la capa (WMS/WMTS/WFS, BBOX, resoluciones, geometría, atributos).',
                'qrigo.hiw.flow.3': 'Genera dos bloques JSON: una entrada source (URL + parámetros) y una entrada layer (id, título, estilo, visibilidad).',
                'qrigo.hiw.flow.4': 'Copia cada bloque con su botón y pégalos en tu index.json de Origo.',
                'qrigo.hiw.flow.5': 'Si la capa es editable o buscable, el snippet incluye también los controles equivalentes de Origo.',
                'qrigo.hiw.wfs.title': '3. Compatibilidad WFS y WFS-T',
                'qrigo.hiw.wfs.1': 'Tipo de geometría, columna geométrica, namespace y typename se normalizan para que QGIS Server y Origo coincidan en los identificadores.',
                'qrigo.hiw.wfs.2': 'Los caracteres especiales en nombres de capa se escapan a identificadores XML válidos; los títulos originales se preservan para mostrar.',
                'qrigo.hiw.wfs.3': 'Para edición transaccional se recomienda WFS 1.1.0 — el snippet fija la versión automáticamente cuando la capa es editable.',
                'qrigo.hiw.auth.title': '4. Integración con QtilerAuth',
                'qrigo.hiw.auth.1': 'Con QtilerAuth activo, las URLs copiadas incluyen un placeholder api_key para que QGIS Desktop y Origo puedan autenticarse.',
                'qrigo.hiw.auth.2': 'Las ACL de proyecto (public / authenticated / private) las aplica QtilerAuth — Qrigo nunca las omite.',
                'qrigo.hiw.auth.3': 'Las respuestas GetCapabilities cacheadas se sirven sin el parámetro api_key para evitar fugas.',
                'qrigo.hiw.security.title': '5. Seguridad y privacidad',
                'qrigo.hiw.security.1': 'Qrigo es de solo lectura sobre los datos de Qtiler; no puede publicar, editar ni borrar proyectos o capas.',
                'qrigo.hiw.security.2': 'Sin llamadas a terceros. Los snippets se generan localmente a partir del proyecto que estás viendo.',
                'qrigo.hiw.security.3': 'Open source bajo MPL-2.0; auditable en plugins/Qrigo/index.js.',
                'qrigo.hiw.troubleshoot.title': '6. Resolución de problemas',
                'qrigo.hiw.troubleshoot.1': 'El guardado falla en QGIS / Origo: confirma que la URL incluye api_key en proyectos protegidos.',
                'qrigo.hiw.troubleshoot.2': 'Lista de capas vacía: verifica que la capa esté publicada en el proyecto QGIS activo y que QtilerAuth te dé acceso.',
                'qrigo.hiw.troubleshoot.3': 'CRS incorrecto en Origo: revisa el bloque source; Origo espera códigos EPSG que coincidan con las resoluciones del proyecto.'
              },
              sv: {
                'qrigo.title': 'Qrigo-plugin',
                'qrigo.subtitle': 'Lägger till Origo-färdiga lagerutdrag och WMS/WMTS/WFS-anslutningshjälp direkt i Qtilers lagerdialog.',
                'qrigo.what.title': 'Vad Qrigo gör',
                'qrigo.what.1': 'Skapar Origo-JSON för WMS-, WMTS- och WFS-lager utifrån projektets konfiguration.',
                'qrigo.what.2': 'Inkluderar detaljer för redigerbar WFS (attribut/arbetsyta) när lagret är markerat som redigerbart.',
                'qrigo.what.3': 'Håller utdragen synkade med lagerändringar som BBOX och upplösningar.',
                'qrigo.how.title': 'Så använder du det',
                'qrigo.how.1': 'Öppna ett projekt i Qtilers adminpanel och klicka på ett lager för att se detaljer.',
                'qrigo.how.2': 'Välj fliken “Qrigo / Origo” för att kopiera source + layer JSON-blocken.',
                'qrigo.how.3': 'Klistra in i Origo index.json och justera titlar eller grupperingar vid behov.',
                'qrigo.outputs.title': 'Inkluderade utdata',
                'qrigo.outputs.1': 'Source-poster för WMTS/WMS/WFS med korrekta URL:er och parametrar.',
                'qrigo.outputs.2': 'Layer-poster som matchar Qtiler-lagernamn, stilplatshållare och standardvisning.',
                'qrigo.outputs.3': 'Valfria API-nyckel-platshållare när QtilerAuth är aktivt.',
                'qrigo.preview.title': 'Origo-förhandsvisning och redigering',
                'qrigo.preview.1': 'Lägger till en Open in Origo-åtgärd per kompatibelt lager för snabb live-förhandsvisning.',
                'qrigo.preview.2': 'Konfigurerar automatiskt redigerings- och sökkontroller när WFS redigerbar/sökbar är aktiverat.',
                'qrigo.preview.3': 'Normaliserar geometri-typ, XML-säkert typnamn, namespace och geometri-kolumn för WFS-T-kompatibilitet.',
                'qrigo.troubleshoot.title': 'Felsökningsnoteringar',
                'qrigo.troubleshoot.1': 'Om sparning misslyckas i externa klienter, kontrollera att URL:er innehåller api_key för skyddade projekt.',
                'qrigo.troubleshoot.2': 'För WFS-redigering i QGIS, använd helst WFS 1.1.0 vid transaktionstester.',
                'qrigo.troubleshoot.3': 'Om lagernamn innehåller specialtecken sanerar Qrigo typnamn till giltiga XML-identifikatorer.',
                'qrigo.note': 'Qrigo ändrar inte data i Qtiler; det förbereder bara konfigurationstext att kopiera till Origo.',
                'qrigo.hiw.button': 'Så fungerar det & säkerhet',
                'qrigo.hiw.title': 'Så fungerar Qrigo och varför det är säkert',
                'qrigo.hiw.lead': 'Qrigo är en läs-bara hjälp som omvandlar varje Qtiler-lager till färdiga Origo-utdrag. Det ändrar inte dina QGIS-projekt eller Qtilers databas.',
                'qrigo.hiw.vs.title': 'Qrigo vs Qtiler2Origo',
                'qrigo.hiw.vs.1': 'Qrigo riktar sig till användare som redan kör en standardinstallation av Origo-map på sin egen server: det genererar bara JSON-utdragen som du klistrar in i din befintliga Origo index.json.',
                'qrigo.hiw.vs.2': 'Qtiler2Origo är tillägget som installerar Origo ovanpå själva Qtiler, låter dig skapa och konfigurera varje karta grafiskt via QGIS-biblioteket och återanvänder Qtilers cache samt WMS/WFS-lagren från projekt som publicerats i Qtiler.',
                'qrigo.hiw.arch.title': '1. Arkitektur',
                'qrigo.hiw.arch.1': 'Express-plugin laddat från plugins/Qrigo/; ingen databas, inga bakgrundsjobb.',
                'qrigo.hiw.arch.2': 'Läser lagermetadata från det aktiva Qtiler-projektet vid varje begäran — ingen egen cache att invalidera.',
                'qrigo.hiw.arch.3': 'Lägger till en Origo-flik i lagerdetalj-modalen i Qtilers adminpanel.',
                'qrigo.hiw.flow.title': '2. Steg för steg',
                'qrigo.hiw.flow.1': 'Öppna ett projekt i panelen och klicka på ett lager för att visa detaljmodalen.',
                'qrigo.hiw.flow.2': 'Klicka på Origo-fliken. Qrigo inspekterar lagret (WMS/WMTS/WFS, BBOX, upplösningar, geometri, attribut).',
                'qrigo.hiw.flow.3': 'Det skapar två JSON-block: en source-post (URL + parametrar) och en layer-post (id, titel, stil, synlighet).',
                'qrigo.hiw.flow.4': 'Kopiera varje block med dess knapp och klistra in i din Origo index.json.',
                'qrigo.hiw.flow.5': 'Om lagret är redigerbart eller sökbart inkluderas motsvarande Origo-kontroller i utdraget.',
                'qrigo.hiw.wfs.title': '3. WFS- och WFS-T-kompatibilitet',
                'qrigo.hiw.wfs.1': 'Geometri-typ, geometri-kolumn, namespace och typnamn normaliseras så QGIS Server och Origo är överens om identifierare.',
                'qrigo.hiw.wfs.2': 'Specialtecken i lagernamn ersätts till giltiga XML-identifikatorer; ursprungliga titlar behålls för visning.',
                'qrigo.hiw.wfs.3': 'För transaktionsredigering rekommenderas WFS 1.1.0 — utdraget sätter versionen automatiskt när lagret är redigerbart.',
                'qrigo.hiw.auth.title': '4. Integration med QtilerAuth',
                'qrigo.hiw.auth.1': 'När QtilerAuth är aktivt innehåller kopierade URL:er en api_key-platshållare så att QGIS Desktop och Origo kan autentisera.',
                'qrigo.hiw.auth.2': 'Projekt-ACL:er (public / authenticated / private) hanteras av QtilerAuth — Qrigo går aldrig förbi dem.',
                'qrigo.hiw.auth.3': 'Cachade GetCapabilities-svar serveras utan api_key-parametern för att förhindra läckage.',
                'qrigo.hiw.security.title': '5. Säkerhet och integritet',
                'qrigo.hiw.security.1': 'Qrigo är skrivskyddat mot Qtiler-data; det kan inte publicera, redigera eller radera projekt eller lager.',
                'qrigo.hiw.security.2': 'Inga tredjepartsanrop. Utdrag genereras lokalt utifrån det projekt du tittar på.',
                'qrigo.hiw.security.3': 'Öppen källkod under MPL-2.0; granskbart i plugins/Qrigo/index.js.',
                'qrigo.hiw.troubleshoot.title': '6. Felsökning',
                'qrigo.hiw.troubleshoot.1': 'Sparning misslyckas i QGIS / Origo: kontrollera att URL:en innehåller api_key för skyddade projekt.',
                'qrigo.hiw.troubleshoot.2': 'Tom lagerlista: verifiera att lagret är publicerat i det aktiva QGIS-projektet och att QtilerAuth ger dig åtkomst.',
                'qrigo.hiw.troubleshoot.3': 'Fel CRS i Origo: kontrollera source-blocket; Origo förväntar sig EPSG-koder som matchar projektets upplösningar.'
              }
            };

            TRANSLATIONS.no = Object.assign({}, TRANSLATIONS.sv, {
              'qrigo.title': 'Qrigo-plugin',
              'qrigo.subtitle': 'Legger til Origo-klare lagutdrag og WMS/WMTS/WFS-tilkoblingshjelp direkte i Qtilers lagdialog.',
              'qrigo.what.title': 'Hva Qrigo gjør',
              'qrigo.what.1': 'Oppretter Origo-JSON-utdrag for WMS-, WMTS- og WFS-lag basert på prosjektkonfigurasjonen.',
              'qrigo.what.2': 'Tar med detaljer for redigerbar WFS (attributter/arbeidsområde) når laget er markert som redigerbart.',
              'qrigo.what.3': 'Holder utdragene synkronisert med lagendringer som BBOX og oppløsninger.',
              'qrigo.how.title': 'Slik bruker du det',
              'qrigo.how.1': 'Åpne et prosjekt i Qtiler-dashboardet og klikk et lag for å se detaljer.',
              'qrigo.how.2': 'Velg fanen “Qrigo / Origo” for å kopiere JSON-blokkene for source og layer.',
              'qrigo.how.3': 'Lim utdragene inn i Origo index.json og juster titler eller grupper etter behov.',
              'qrigo.outputs.title': 'Inkluderte utdata',
              'qrigo.outputs.1': 'Source-oppføringer for WMTS/WMS/WFS med riktige URL-er og parametere.',
              'qrigo.outputs.2': 'Layer-oppføringer som matcher Qtiler-lagnavn, stilplassholder og standard synlighet.',
              'qrigo.outputs.3': 'Valgfrie API-nøkkelplassholdere når QtilerAuth er aktiv.',
              'qrigo.preview.title': 'Origo-forhåndsvisning og redigering',
              'qrigo.preview.1': 'Legger til en Åpne i Origo-handling per kompatibelt lag for rask live-forhåndsvisning.',
              'qrigo.preview.2': 'Konfigurerer editor- og søkekontroller automatisk når WFS-redigerbare/søkbare innstillinger er aktivert.',
              'qrigo.preview.3': 'Normaliserer geometri, XML-sikkert typenavn, namespace og geometrikolonne for WFS-T-kompatibilitet.',
              'qrigo.troubleshoot.title': 'Feilsøkingsnotater',
              'qrigo.troubleshoot.1': 'Hvis lagring feiler i eksterne klienter, kontroller at URL-er inkluderer api_key for beskyttede prosjekter.',
              'qrigo.troubleshoot.2': 'For WFS-redigering i QGIS bør WFS 1.1.0 brukes ved testing av transaksjonskompatibilitet.',
              'qrigo.troubleshoot.3': 'Hvis lagnavn inneholder spesialtegn, gjør Qrigo typenavn om til gyldige XML-identifikatorer.',
              'qrigo.note': 'Qrigo endrer ikke data i Qtiler; det lager bare konfigurasjonstekst du kan kopiere til Origo.',
              'qrigo.hiw.button': 'Slik fungerer det og sikkerhet',
              'qrigo.hiw.title': 'Slik fungerer Qrigo og hvorfor det er sikkert',
              'qrigo.hiw.lead': 'Qrigo er en skrivebeskyttet hjelper som gjør hvert Qtiler-lag om til Origo-utdrag som kan limes rett inn. Det endrer ikke QGIS-prosjektene dine eller Qtiler-databasen.',
              'qrigo.hiw.vs.title': 'Qrigo vs Qtiler2Origo',
              'qrigo.hiw.vs.1': 'Qrigo er for brukere som allerede kjører en standard Origo-map-installasjon på egen server: det genererer bare JSON-utdragene du limer inn i eksisterende Origo index.json.',
              'qrigo.hiw.vs.2': 'Qtiler2Origo er pluginen som installerer Origo oppå Qtiler, lar deg lage og konfigurere hvert kart grafisk med QGIS-biblioteket, og gjenbruker Qtilers cache samt WMS/WFS-lag fra prosjekter publisert i Qtiler.',
              'qrigo.hiw.arch.title': '1. Arkitektur',
              'qrigo.hiw.arch.1': 'Express-plugin lastet fra plugins/Qrigo/; ingen database og ingen bakgrunnsprosesser.',
              'qrigo.hiw.arch.2': 'Leser lagmetadata fra det aktive Qtiler-prosjektet ved hver forespørsel — ingen separat cache å ugyldiggjøre.',
              'qrigo.hiw.arch.3': 'Legger til en Origo-fane i modalvinduet for lagdetaljer i Qtiler-dashboardet.',
              'qrigo.hiw.flow.title': '2. Steg for steg',
              'qrigo.hiw.flow.1': 'Åpne et prosjekt i dashboardet og klikk et lag for å vise detaljmodalen.',
              'qrigo.hiw.flow.2': 'Klikk Origo-fanen. Qrigo inspiserer laget (WMS/WMTS/WFS, BBOX, oppløsninger, geometri, attributter).',
              'qrigo.hiw.flow.3': 'Det genererer to JSON-blokker: en source-oppføring (URL + parametere) og en layer-oppføring (id, tittel, stil, synlighet).',
              'qrigo.hiw.flow.4': 'Kopier hver blokk med egen knapp og lim dem inn i Origo index.json.',
              'qrigo.hiw.flow.5': 'Hvis laget er redigerbart eller søkbart, inneholder utdraget også tilsvarende Origo-kontroller.',
              'qrigo.hiw.wfs.title': '3. WFS- og WFS-T-kompatibilitet',
              'qrigo.hiw.wfs.1': 'Geometritype, geometrikolonne, namespace og typenavn normaliseres slik at QGIS Server og Origo bruker samme identifikatorer.',
              'qrigo.hiw.wfs.2': 'Spesialtegn i lagnavn escapes til gyldige XML-identifikatorer; originale titler beholdes for visning.',
              'qrigo.hiw.wfs.3': 'For transaksjonsredigering anbefales WFS 1.1.0 — utdraget setter versjonen automatisk når laget er redigerbart.',
              'qrigo.hiw.auth.title': '4. Integrasjon med QtilerAuth',
              'qrigo.hiw.auth.1': 'Når QtilerAuth er aktiv, inneholder kopierte URL-er en api_key-plassholder slik at QGIS Desktop og Origo kan autentisere.',
              'qrigo.hiw.auth.2': 'Prosjekt-ACL-er (public / authenticated / private) håndheves av QtilerAuth — Qrigo omgår dem aldri.',
              'qrigo.hiw.auth.3': 'Cachede GetCapabilities-svar serveres uten api_key-parameteren for å hindre lekkasjer.',
              'qrigo.hiw.security.title': '5. Sikkerhet og personvern',
              'qrigo.hiw.security.1': 'Qrigo er skrivebeskyttet mot Qtiler-data; det kan ikke publisere, redigere eller slette prosjekter eller lag.',
              'qrigo.hiw.security.2': 'Ingen tredjeparts nettverkskall. Utdrag genereres lokalt fra prosjektet du ser på.',
              'qrigo.hiw.security.3': 'Åpen kildekode under MPL-2.0; kan revideres i plugins/Qrigo/index.js.',
              'qrigo.hiw.troubleshoot.title': '6. Feilsøking',
              'qrigo.hiw.troubleshoot.1': 'Lagring feiler i QGIS / Origo: bekreft at URL-en inneholder api_key for beskyttede prosjekter.',
              'qrigo.hiw.troubleshoot.2': 'Tom lagliste: kontroller at laget er publisert i aktivt QGIS-prosjekt og at QtilerAuth gir deg tilgang.',
              'qrigo.hiw.troubleshoot.3': 'Feil CRS i Origo: sjekk source-blokken; Origo forventer EPSG-koder som matcher prosjektets oppløsninger.'
            });
            TRANSLATIONS.nb = TRANSLATIONS.no;
            TRANSLATIONS.nn = TRANSLATIONS.no;
            TRANSLATIONS.da = Object.assign({}, TRANSLATIONS.sv, {
              'qrigo.title': 'Qrigo-plugin',
              'qrigo.subtitle': 'Tilføjer Origo-klare laguddrag og WMS/WMTS/WFS-forbindelseshjælp direkte i Qtilers lagdialog.',
              'qrigo.what.title': 'Hvad Qrigo gør',
              'qrigo.what.1': 'Opretter Origo-JSON-uddrag for WMS-, WMTS- og WFS-lag baseret på projektkonfigurationen.',
              'qrigo.what.2': 'Medtager detaljer for redigerbar WFS (attributter/workspace), når laget er markeret som redigerbart.',
              'qrigo.what.3': 'Holder uddragene synkroniseret med lagændringer som BBOX og opløsninger.',
              'qrigo.how.title': 'Sådan bruger du det',
              'qrigo.how.1': 'Åbn et projekt i Qtiler-dashboardet, og klik på et lag for at se detaljer.',
              'qrigo.how.2': 'Vælg fanen “Qrigo / Origo” for at kopiere JSON-blokkene source og layer.',
              'qrigo.how.3': 'Indsæt uddragene i Origo index.json, og justér titler eller grupper efter behov.',
              'qrigo.outputs.title': 'Inkluderede output',
              'qrigo.outputs.1': 'Source-poster for WMTS/WMS/WFS med korrekte URL’er og parametre.',
              'qrigo.outputs.2': 'Layer-poster, der matcher Qtiler-lagnavn, stil-placeholder og standard synlighed.',
              'qrigo.outputs.3': 'Valgfrie API-nøgle-placeholders, når QtilerAuth er aktiv.',
              'qrigo.preview.title': 'Origo-forhåndsvisning og redigering',
              'qrigo.preview.1': 'Tilføjer en Åbn i Origo-handling pr. kompatibelt lag for hurtig live-forhåndsvisning.',
              'qrigo.preview.2': 'Konfigurerer automatisk editor- og søgekontroller, når WFS-redigerbare/søgbare indstillinger er aktiveret.',
              'qrigo.preview.3': 'Normaliserer geometri, XML-sikkert typenavn, namespace og geometrikolonne for WFS-T-kompatibilitet.',
              'qrigo.troubleshoot.title': 'Fejlsøgningsnoter',
              'qrigo.troubleshoot.1': 'Hvis lagring fejler i eksterne klienter, skal du kontrollere, at URL’er indeholder api_key for beskyttede projekter.',
              'qrigo.troubleshoot.2': 'Til WFS-redigering i QGIS bør WFS 1.1.0 bruges ved test af transaktionskompatibilitet.',
              'qrigo.troubleshoot.3': 'Hvis lagnavne indeholder specialtegn, sanerer Qrigo typenavne til gyldige XML-identifikatorer.',
              'qrigo.note': 'Qrigo ændrer ikke data i Qtiler; det forbereder kun konfigurationstekst, du kan kopiere til Origo.',
              'qrigo.hiw.button': 'Sådan fungerer det og sikkerhed',
              'qrigo.hiw.title': 'Sådan fungerer Qrigo, og hvorfor det er sikkert',
              'qrigo.hiw.lead': 'Qrigo er en skrivebeskyttet hjælper, der gør hvert Qtiler-lag til Origo-uddrag, som kan indsættes direkte. Det ændrer ikke dine QGIS-projekter eller Qtiler-databasen.',
              'qrigo.hiw.vs.title': 'Qrigo vs Qtiler2Origo',
              'qrigo.hiw.vs.1': 'Qrigo er til brugere, der allerede kører en standard Origo-map-installation på egen server: det genererer kun JSON-uddragene, du indsætter i dit eksisterende Origo index.json.',
              'qrigo.hiw.vs.2': 'Qtiler2Origo er pluginet, der installerer Origo oven på Qtiler, lader dig oprette og konfigurere hvert kort grafisk med QGIS-biblioteket og genbruger Qtilers cache samt WMS/WFS-lag fra projekter publiceret i Qtiler.',
              'qrigo.hiw.arch.title': '1. Arkitektur',
              'qrigo.hiw.arch.1': 'Express-plugin indlæst fra plugins/Qrigo/; ingen database og ingen baggrundsprocesser.',
              'qrigo.hiw.arch.2': 'Læser lagmetadata fra det aktive Qtiler-projekt ved hver forespørgsel — ingen separat cache at invalidere.',
              'qrigo.hiw.arch.3': 'Tilføjer en Origo-fane til lagdetalje-dialogen i Qtiler-dashboardet.',
              'qrigo.hiw.flow.title': '2. Trin for trin',
              'qrigo.hiw.flow.1': 'Åbn et projekt i dashboardet, og klik på et lag for at vise detaljedialogen.',
              'qrigo.hiw.flow.2': 'Klik på Origo-fanen. Qrigo inspicerer laget (WMS/WMTS/WFS, BBOX, opløsninger, geometri, attributter).',
              'qrigo.hiw.flow.3': 'Det genererer to JSON-blokke: en source-post (URL + parametre) og en layer-post (id, titel, stil, synlighed).',
              'qrigo.hiw.flow.4': 'Kopiér hver blok med den dedikerede knap, og indsæt dem i Origo index.json.',
              'qrigo.hiw.flow.5': 'Hvis laget er redigerbart eller søgbart, indeholder uddraget også de tilsvarende Origo-kontroller.',
              'qrigo.hiw.wfs.title': '3. WFS- og WFS-T-kompatibilitet',
              'qrigo.hiw.wfs.1': 'Geometritype, geometrikolonne, namespace og typenavn normaliseres, så QGIS Server og Origo bruger samme identifikatorer.',
              'qrigo.hiw.wfs.2': 'Specialtegn i lagnavne escapes til gyldige XML-identifikatorer; oprindelige titler bevares til visning.',
              'qrigo.hiw.wfs.3': 'Til transaktionsredigering anbefales WFS 1.1.0 — uddraget sætter versionen automatisk, når laget er redigerbart.',
              'qrigo.hiw.auth.title': '4. Integration med QtilerAuth',
              'qrigo.hiw.auth.1': 'Når QtilerAuth er aktiv, indeholder kopierede URL’er en api_key-placeholder, så QGIS Desktop og Origo kan autentificere.',
              'qrigo.hiw.auth.2': 'Projekt-ACL’er (public / authenticated / private) håndhæves af QtilerAuth — Qrigo omgår dem aldrig.',
              'qrigo.hiw.auth.3': 'Cachede GetCapabilities-svar serveres uden api_key-parameteren for at forhindre lækage.',
              'qrigo.hiw.security.title': '5. Sikkerhed og privatliv',
              'qrigo.hiw.security.1': 'Qrigo er skrivebeskyttet mod Qtiler-data; det kan ikke publicere, redigere eller slette projekter eller lag.',
              'qrigo.hiw.security.2': 'Ingen tredjeparts-netværkskald. Uddrag genereres lokalt fra det projekt, du ser på.',
              'qrigo.hiw.security.3': 'Open source under MPL-2.0; kan revideres i plugins/Qrigo/index.js.',
              'qrigo.hiw.troubleshoot.title': '6. Fejlsøgning',
              'qrigo.hiw.troubleshoot.1': 'Lagring fejler i QGIS / Origo: bekræft, at URL’en indeholder api_key for beskyttede projekter.',
              'qrigo.hiw.troubleshoot.2': 'Tom lagliste: kontrollér, at laget er publiceret i det aktive QGIS-projekt, og at QtilerAuth giver dig adgang.',
              'qrigo.hiw.troubleshoot.3': 'Forkert CRS i Origo: tjek source-blokken; Origo forventer EPSG-koder, der matcher projektets opløsninger.'
            });
            TRANSLATIONS.fi = Object.assign({}, TRANSLATIONS.en, {
              'qrigo.title': 'Qrigo-lisäosa',
              'qrigo.subtitle': 'Lisää Origo-valmiit tasokatkelmat ja WMS/WMTS/WFS-yhteysavustimet suoraan Qtilerin tasodialogiin.',
              'qrigo.what.title': 'Mitä Qrigo tekee',
              'qrigo.what.1': 'Luo Origo-JSON-katkelmia WMS-, WMTS- ja WFS-tasoille projektin määrityksen perusteella.',
              'qrigo.what.2': 'Sisällyttää muokattavan WFS:n tiedot (attribuutit/workspace), kun taso on merkitty muokattavaksi.',
              'qrigo.what.3': 'Pitää katkelmat synkronissa tasomuutosten, kuten BBOXin ja resoluutioiden, kanssa.',
              'qrigo.how.title': 'Näin sitä käytetään',
              'qrigo.how.1': 'Avaa projekti Qtilerin hallintanäkymässä ja napsauta tasoa nähdäksesi sen tiedot.',
              'qrigo.how.2': 'Valitse “Qrigo / Origo” -välilehti kopioidaksesi source- ja layer-JSON-lohkot.',
              'qrigo.how.3': 'Liitä katkelmat Origon index.json-tiedostoon ja säädä otsikoita tai ryhmittelyjä tarpeen mukaan.',
              'qrigo.outputs.title': 'Mukana olevat tulosteet',
              'qrigo.outputs.1': 'Source-merkinnät WMTS/WMS/WFS-tasoille oikeilla URL-osoitteilla ja parametreilla.',
              'qrigo.outputs.2': 'Layer-merkinnät, jotka vastaavat Qtilerin tason nimeä, tyylin paikkamerkkiä ja oletusnäkyvyyttä.',
              'qrigo.outputs.3': 'Valinnaiset API-avainpaikkamerkit, kun QtilerAuth on käytössä.',
              'qrigo.preview.title': 'Origon esikatselu ja muokkaus',
              'qrigo.preview.1': 'Lisää Avaa Origossa -toiminnon jokaiselle yhteensopivalle tasolle nopeaa live-esikatselua varten.',
              'qrigo.preview.2': 'Määrittää editori- ja hakukontrollit automaattisesti, kun WFS:n muokkaus- tai hakuasetukset ovat käytössä.',
              'qrigo.preview.3': 'Normalisoi geometriatyypin, XML-turvallisen typenamen, namespacen ja geometriakentän WFS-T-yhteensopivuutta varten.',
              'qrigo.troubleshoot.title': 'Vianmäärityshuomiot',
              'qrigo.troubleshoot.1': 'Jos tallennus epäonnistuu ulkoisissa asiakkaissa, varmista, että suojattujen projektien URL-osoitteissa on api_key.',
              'qrigo.troubleshoot.2': 'QGISin WFS-muokkauksessa kannattaa käyttää WFS 1.1.0:aa transaktiotuennan testaukseen.',
              'qrigo.troubleshoot.3': 'Jos tasojen nimissä on erikoismerkkejä, Qrigo muuntaa typnamet kelvollisiksi XML-tunnisteiksi.',
              'qrigo.note': 'Qrigo ei muuta Qtilerin dataa; se vain valmistelee määritystekstin, jonka voit kopioida Origoon.',
              'qrigo.hiw.button': 'Miten se toimii ja turvallisuus',
              'qrigo.hiw.title': 'Miten Qrigo toimii ja miksi se on turvallinen',
              'qrigo.hiw.lead': 'Qrigo on vain luku -apuohjelma, joka muuntaa jokaisen Qtiler-tason Origoon liitettäviksi katkelmiksi. Se ei muuta QGIS-projekteja tai Qtiler-tietokantaa.',
              'qrigo.hiw.vs.title': 'Qrigo vs Qtiler2Origo',
              'qrigo.hiw.vs.1': 'Qrigo on tarkoitettu käyttäjille, joilla on jo tavallinen Origo-map-asennus omalla palvelimella: se luo vain JSON-katkelmat, jotka liitetään olemassa olevaan Origo index.json -tiedostoon.',
              'qrigo.hiw.vs.2': 'Qtiler2Origo on lisäosa, joka asentaa Origon Qtilerin päälle, antaa luoda ja määrittää kartat graafisesti QGIS-kirjaston avulla ja hyödyntää Qtilerin välimuistia sekä Qtilerissa julkaistujen projektien WMS/WFS-tasoja.',
              'qrigo.hiw.arch.title': '1. Arkkitehtuuri',
              'qrigo.hiw.arch.1': 'Express-lisäosa hakemistosta plugins/Qrigo/; ei tietokantaa eikä taustaprosesseja.',
              'qrigo.hiw.arch.2': 'Lukee tason metatiedot aktiivisesta Qtiler-projektista jokaisella pyynnöllä — erillistä välimuistia ei tarvitse mitätöidä.',
              'qrigo.hiw.arch.3': 'Lisää Origo-välilehden Qtilerin hallintanäkymän tasotietojen modaalinäkymään.',
              'qrigo.hiw.flow.title': '2. Vaihe vaiheelta',
              'qrigo.hiw.flow.1': 'Avaa projekti dashboardissa ja napsauta mitä tahansa tasoa avataksesi sen tiedot.',
              'qrigo.hiw.flow.2': 'Napsauta Origo-välilehteä. Qrigo tarkistaa tason (WMS/WMTS/WFS, BBOX, resoluutiot, geometrian ja attribuutit).',
              'qrigo.hiw.flow.3': 'Se luo kaksi JSON-lohkoa: source-merkinnän (URL + parametrit) ja layer-merkinnän (id, otsikko, tyyli, näkyvyys).',
              'qrigo.hiw.flow.4': 'Kopioi jokainen lohko omalla painikkeellaan ja liitä ne Origon index.json-tiedostoon.',
              'qrigo.hiw.flow.5': 'Jos taso on muokattava tai haettava, katkelma sisältää myös vastaavat Origo-kontrollit.',
              'qrigo.hiw.wfs.title': '3. WFS- ja WFS-T-yhteensopivuus',
              'qrigo.hiw.wfs.1': 'Geometriatyyppi, geometriakenttä, namespace ja typename normalisoidaan, jotta QGIS Server ja Origo käyttävät samoja tunnisteita.',
              'qrigo.hiw.wfs.2': 'Tasojen nimien erikoismerkit muunnetaan kelvollisiksi XML-tunnisteiksi; alkuperäiset otsikot säilytetään näytössä.',
              'qrigo.hiw.wfs.3': 'Transaktiomuokkaukseen suositellaan WFS 1.1.0:aa — katkelma asettaa version automaattisesti, kun taso on muokattava.',
              'qrigo.hiw.auth.title': '4. Integraatio QtilerAuthin kanssa',
              'qrigo.hiw.auth.1': 'Kun QtilerAuth on käytössä, kopioidut URL-osoitteet sisältävät api_key-paikkamerkin, jotta QGIS Desktop ja Origo voivat todentaa.',
              'qrigo.hiw.auth.2': 'Projektien ACL-säännöt (public / authenticated / private) toteuttaa QtilerAuth — Qrigo ei koskaan ohita niitä.',
              'qrigo.hiw.auth.3': 'Välimuistissa olevat GetCapabilities-vastaukset tarjoillaan ilman api_key-parametria vuotojen estämiseksi.',
              'qrigo.hiw.security.title': '5. Turvallisuus ja yksityisyys',
              'qrigo.hiw.security.1': 'Qrigo on Qtiler-dataan nähden vain luku -tilassa; se ei voi julkaista, muokata tai poistaa projekteja tai tasoja.',
              'qrigo.hiw.security.2': 'Ei kolmannen osapuolen verkkokutsuja. Katkelmat luodaan paikallisesti katsomastasi projektista.',
              'qrigo.hiw.security.3': 'Avoin lähdekoodi MPL-2.0-lisenssillä; tarkastettavissa tiedostossa plugins/Qrigo/index.js.',
              'qrigo.hiw.troubleshoot.title': '6. Vianmääritys',
              'qrigo.hiw.troubleshoot.1': 'Tallennus epäonnistuu QGISissä / Origossa: varmista, että URL sisältää api_key-parametrin suojatuille projekteille.',
              'qrigo.hiw.troubleshoot.2': 'Tyhjä tasolista: varmista, että taso on julkaistu aktiivisessa QGIS-projektissa ja että QtilerAuth antaa sinulle pääsyn.',
              'qrigo.hiw.troubleshoot.3': 'Väärä CRS Origossa: tarkista source-lohko; Origo odottaa EPSG-koodeja, jotka vastaavat projektin resoluutioita.'
            });

            const SUPPORTED = ['en', 'es', 'sv', 'no', 'nb', 'nn', 'da', 'fi'];
            const normalizeLang = (value) => {
              const raw = String(value || '').toLowerCase();
              if (raw.startsWith('nb') || raw.startsWith('nn') || raw.startsWith('no')) return 'no';
              if (SUPPORTED.includes(raw)) return raw;
              const base = raw.split('-')[0];
              if (base === 'nb' || base === 'nn' || base === 'no') return 'no';
              return SUPPORTED.includes(base) ? base : 'en';
            };

            const readLang = () => {
              const fromParent = window.parent?.qtilerLang?.get?.();
              return fromParent || localStorage.getItem('qtiler.lang') || navigator.language || 'en';
            };

            let currentLang = normalizeLang(readLang());

            const applyTranslations = () => {
              document.documentElement.setAttribute('lang', currentLang);
              document.querySelectorAll('[data-i18n]').forEach((el) => {
                const key = el.getAttribute('data-i18n');
                if (!key) return;
                const table = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
                el.textContent = table[key] || TRANSLATIONS.en[key] || key;
              });
            };

            const syncLanguage = () => {
              const next = normalizeLang(readLang());
              if (next === currentLang) return;
              currentLang = next;
              applyTranslations();
            };

            window.addEventListener('storage', (event) => {
              if (event.key === 'qtiler.lang') syncLanguage();
            });

            setInterval(syncLanguage, 1000);
            applyTranslations();

            // How-it-works modal wiring
            (function () {
              const modal = document.getElementById('qrigo-hiw-modal');
              const openBtn = document.getElementById('qrigo-open-hiw');
              if (!modal || !openBtn) return;
              const open = () => { modal.hidden = false; modal.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; };
              const close = () => { modal.hidden = true; modal.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; };
              openBtn.addEventListener('click', open);
              modal.querySelectorAll('[data-hiw-close]').forEach((el) => el.addEventListener('click', close));
              document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) close(); });
            })();
          </script>
        </body>
      </html>`;

    res.type('text/html').send(adminHtml);
  });
  return {
    dispose: async () => {}
  };
};
