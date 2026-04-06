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
      config.source[srcName] = {
        url: origin + '/wms?project=' + encodeURIComponent(projectId),
        type: 'WMS',
        params: { LAYERS: layerName }
      };
      config.layers.push({
        name: layerName,
        title: layerName + ' [WMS]',
        group,
        source: srcName,
        type: 'WMS',
        sourceParams: { LAYERS: layerName },
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
          </style>
        </head>
        <body>
          <main class="card">
            <h2 data-i18n="qrigo.title">Qrigo plugin</h2>
            <p data-i18n="qrigo.subtitle">Adds Origo-ready layer snippets and WMS/WMTS/WFS connection helpers directly inside the Qtiler layer modal.</p>

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
                'qrigo.note': 'Qrigo does not change data in Qtiler; it only prepares configuration text you can copy into Origo.'
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
                'qrigo.note': 'Qrigo no modifica datos en Qtiler; solo prepara texto de configuración para copiar en Origo.'
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
                'qrigo.note': 'Qrigo ändrar inte data i Qtiler; det förbereder bara konfigurationstext att kopiera till Origo.'
              }
            };

            const SUPPORTED = ['en', 'es', 'sv', 'no'];
            const normalizeLang = (value) => {
              const raw = String(value || '').toLowerCase();
              if (SUPPORTED.includes(raw)) return raw;
              const base = raw.split('-')[0];
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
          </script>
        </body>
      </html>`;

    res.type('text/html').send(adminHtml);
  });
  return {
    dispose: async () => {}
  };
};
