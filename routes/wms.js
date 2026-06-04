/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { getRequestBaseUrl } from "../lib/requestBaseUrl.js";
import express from "express";

const getQueryCI = (req, key) => {
  if (!req || !req.query) return null;
  const target = String(key || "").toLowerCase();
  if (!target) return null;
  const direct = req.query[key];
  if (direct != null) return Array.isArray(direct) ? direct[0] : direct;
  for (const [k, v] of Object.entries(req.query)) {
    if (String(k).toLowerCase() === target) {
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return null;
};

// Return an HTTP status code appropriate for a renderTile error.
const renderErrStatus = (err) => err?.code === 'QUEUE_FULL' ? 503 : 500;

// 1x1 transparent PNG used as instant placeholder while a real legend is
// rendered in the background. Avoids freezing QWC2 LayerTree when many
// thumbnails are requested simultaneously.
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

// Tracks legend keys currently being rendered so duplicate concurrent
// requests don't all enqueue the same job.
const legendInFlight = new Set();

const toBool = (value, fallback = false) => {
  if (value == null) return fallback;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "t", "yes", "y"].includes(raw)) return true;
  if (["0", "false", "f", "no", "n"].includes(raw)) return false;
  return fallback;
};

const parseCsv = (value) => {
  if (value == null) return [];
  if (Array.isArray(value)) value = value[0];
  const raw = String(value).trim();
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
};

const parseBbox = (value) => {
  const parts = parseCsv(value);
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (!nums.every(Number.isFinite)) return null;
  return nums;
};

const escapeXml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const findPrintMapField = (req, suffix) => {
  const targetSuffix = `:${String(suffix || "").toLowerCase()}`;
  for (const [key, value] of Object.entries(req?.query || {})) {
    if (String(key).toLowerCase().endsWith(targetSuffix)) {
      return { key, value: Array.isArray(value) ? value[0] : value };
    }
  }
  return null;
};

const parsePrintRequestParams = (req) => {
  const extentField = findPrintMapField(req, "extent");
  const scaleField = findPrintMapField(req, "scale");
  const rotationField = findPrintMapField(req, "rotation");
  const bbox = parseBbox(getQueryCI(req, "BBOX")) || parseBbox(extentField?.value);
  const mapName = extentField?.key?.split(":")[0] || scaleField?.key?.split(":")[0] || rotationField?.key?.split(":")[0] || null;
  const rotation = rotationField ? Number(rotationField.value) : null;
  const dpi = clampInt(getQueryCI(req, "DPI"), { min: 30, max: 1200, fallback: null });

  const reservedKeys = new Set([
    "SERVICE", "VERSION", "REQUEST", "FORMAT", "TEMPLATE", "CRS", "SRS", "BBOX", "LAYERS",
    "WIDTH", "HEIGHT", "DPI", "PROJECT", "API_KEY", "CSRF_TOKEN", "NAME", "FILE", "DOWNLOAD",
    "FORMAT_OPTIONS", "LEGEND", "ATLAS_PK"
  ]);

  const labels = {};
  for (const [key, value] of Object.entries(req?.query || {})) {
    const upper = String(key).toUpperCase();
    if (reservedKeys.has(upper)) continue;
    if (String(key).includes(":")) continue;
    labels[key] = Array.isArray(value) ? value[0] : value;
  }

  return {
    mapName,
    bbox,
    rotation: Number.isFinite(rotation) ? rotation : null,
    dpi,
    labels
  };
};

const fallbackPrintLayouts = () => ([
  {
    name: "A4",
    width: 297,
    height: 210,
    map: { name: "map0", width: 280, height: 190, x: 0, y: 0 },
    labels: []
  },
  {
    name: "A3",
    width: 420,
    height: 297,
    map: { name: "map0", width: 400, height: 280, x: 0, y: 0 },
    labels: []
  }
]);

const buildProjectSettingsXml = (layouts) => {
  const safeLayouts = Array.isArray(layouts) && layouts.length ? layouts : fallbackPrintLayouts();
  const templatesXml = safeLayouts.map((layout) => {
    const map = layout?.map && typeof layout.map === 'object' ? layout.map : null;
    const labels = Array.isArray(layout?.labels) ? layout.labels : [];
    const mapXml = map
      ? `<ComposerMap width="${Number(map.width) || 0}" height="${Number(map.height) || 0}" x="${Number(map.x) || 0}" y="${Number(map.y) || 0}" name="${escapeXml(map.name || 'map0')}"/>`
      : '';
    const labelsXml = labels.map((label) => `<ComposerLabel name="${escapeXml(label)}"/>`).join('');
    return `<ComposerTemplate width="${Number(layout?.width) || 0}" height="${Number(layout?.height) || 0}" name="${escapeXml(layout?.name || 'Layout')}">${mapXml}${labelsXml}</ComposerTemplate>`;
  }).join('');

  return `<?xml version="1.0" encoding="utf-8"?>
<WMS_Capabilities version="1.3.0">
  <Capability>
    <ComposerTemplates>${templatesXml}</ComposerTemplates>
  </Capability>
</WMS_Capabilities>`;
};

const loadProjectPrintLayouts = async ({ tileRendererPool, projectFile }) => {
  const result = await tileRendererPool.renderTile({
    action: 'list_print_layouts',
    project_path: projectFile
  });
  if (!result || result.status !== 'success') {
    const msg = result?.message || result?.error || 'list_print_layouts_failed';
    throw new Error(String(msg));
  }
  return Array.isArray(result.layouts) ? result.layouts : [];
};

const parseFilterGeomBbox = (value) => {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const nums = [];
  const re = /(-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) nums.push(n);
  }
  if (nums.length < 4 || nums.length % 2 !== 0) return null;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < nums.length; i += 2) {
    const x = nums[i];
    const y = nums[i + 1];
    if (x < minx) minx = x;
    if (x > maxx) maxx = x;
    if (y < miny) miny = y;
    if (y > maxy) maxy = y;
  }
  if (![minx, miny, maxx, maxy].every(Number.isFinite)) return null;
  if (!(maxx > minx) || !(maxy > miny)) return null;
  return [minx, miny, maxx, maxy];
};

const clampInt = (value, { min = 1, max = 8192, fallback = null } = {}) => {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const parseLimit = (value, fallback) => {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const WMS_MAX_PIXELS = parseLimit(process.env.QTILER_WMS_MAX_PIXELS, 4000000);
const WMS_MAX_LAYERS = parseLimit(process.env.QTILER_WMS_MAX_LAYERS, 20);

const normalizeCrs = (value) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^EPSG:\d+$/i.test(raw)) return raw.toUpperCase();
  // Accept common OGC CRS URNs and convert EPSG ones to EPSG:XXXX.
  // Example: urn:ogc:def:crs:EPSG::4326
  if (/^urn:ogc:def:crs:/i.test(raw)) {
    const m = raw.match(/urn:ogc:def:crs:EPSG(?:::(\d+)|:(\d+))$/i);
    const code = m ? (m[1] || m[2]) : null;
    if (code) return `EPSG:${code}`.toUpperCase();
    return raw;
  }
  return raw;
};

const safePathSegment = (value, { fallback = 'x' } = {}) => {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const cleaned = raw
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
  return cleaned || fallback;
};

const sha1Hex = (value) => crypto.createHash('sha1').update(String(value)).digest('hex');

const approxEq = (a, b, tol) => Math.abs(a - b) <= tol;

const loadTileMatrixPresetsForCrs = ({ tileGridDir, crs }) => {
  const normalized = normalizeCrs(crs);
  const out = [];
  if (!normalized) return out;

  // Always include a WebMercator fallback (common for WMS tiled clients).
  if (normalized === 'EPSG:3857') {
    const origin = [-20037508.342789244, 20037508.342789244];
    const matrices = [];
    const initialRes = 156543.03392804097; // meters / pixel at z0 for 256px tiles
    for (let z = 0; z <= 22; z++) {
      matrices.push({
        z,
        identifier: String(z),
        resolution: initialRes / Math.pow(2, z),
        matrix_width: Math.pow(2, z),
        matrix_height: Math.pow(2, z),
        tileWidth: 256,
        tileHeight: 256,
        topLeftCorner: origin
      });
    }
    out.push({
      id: 'WEBMERCATOR_DEFAULT',
      supported_crs: ['EPSG:3857'],
      tile_width: 256,
      tile_height: 256,
      topLeftCorner: origin,
      matrices
    });
  }

  try {
    if (!tileGridDir || !fs.existsSync(tileGridDir)) return out;
    const entries = fs.readdirSync(tileGridDir).filter((f) => f.toLowerCase().endsWith('.json'));
    for (const filename of entries) {
      const full = path.join(tileGridDir, filename);
      try {
        const raw = fs.readFileSync(full, 'utf8');
        const parsed = JSON.parse(raw);
        const supported = parsed?.supported_crs || parsed?.crs || parsed?.coordinateReferenceSystem || parsed?.coordinate_reference_system;
        const supportedList = Array.isArray(supported) ? supported : (supported ? [supported] : []);
        const ok = supportedList.some((c) => normalizeCrs(c) === normalized);
        if (!ok) continue;
        out.push(parsed);
      } catch {
        // ignore bad presets
      }
    }
  } catch {
    // ignore
  }
  return out;
};

  

const findAlignedTileForBbox = ({ preset, bbox, width, height }) => {
  if (!preset || !Array.isArray(bbox) || bbox.length !== 4) return null;
  if (width !== 256 || height !== 256) return null;
  const [minx, miny, maxx, maxy] = bbox;
  if (![minx, miny, maxx, maxy].every(Number.isFinite)) return null;
  if (!(maxx > minx) || !(maxy > miny)) return null;

  const origin = preset?.topLeftCorner || preset?.top_left_corner || preset?.top_left || preset?.topLeft || preset?.origin;
  if (!Array.isArray(origin) || origin.length !== 2) return null;
  const originX = Number(origin[0]);
  const originY = Number(origin[1]);
  if (!Number.isFinite(originX) || !Number.isFinite(originY)) return null;

  const matrices = Array.isArray(preset?.matrices) ? preset.matrices : [];
  for (const m of matrices) {
    if (!m) continue;
    const resolution = Number(m.resolution);
    if (!Number.isFinite(resolution) || resolution <= 0) continue;
    const tileWidth = Number(m.tileWidth ?? preset.tile_width ?? 256);
    const tileHeight = Number(m.tileHeight ?? preset.tile_height ?? 256);
    if (tileWidth !== 256 || tileHeight !== 256) continue;

    const spanX = tileWidth * resolution;
    const spanY = tileHeight * resolution;
    const tol = Math.max(Math.max(Math.abs(spanX), Math.abs(spanY)) * 1e-6, 1e-3);

    if (!approxEq(maxx - minx, spanX, tol)) continue;
    if (!approxEq(maxy - miny, spanY, tol)) continue;

    const xFloat = (minx - originX) / spanX;
    const yFloat = (originY - maxy) / spanY;
    const x = Math.round(xFloat);
    const y = Math.round(yFloat);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < 0 || y < 0) continue;

    const alignedMinX = originX + x * spanX;
    const alignedMaxX = alignedMinX + spanX;
    const alignedMaxY = originY - y * spanY;
    const alignedMinY = alignedMaxY - spanY;
    if (!approxEq(minx, alignedMinX, tol)) continue;
    if (!approxEq(maxx, alignedMaxX, tol)) continue;
    if (!approxEq(maxy, alignedMaxY, tol)) continue;
    if (!approxEq(miny, alignedMinY, tol)) continue;

    const z = Number.isFinite(m.z) ? m.z : Number.parseInt(String(m.identifier ?? ''), 10);
    if (!Number.isFinite(z)) continue;

    return { z, x, y, spanX, spanY };
  }
  return null;
};

const wmsExceptionXml = (message, { code = "InvalidRequest" } = {}) => {
  const safe = String(message || "WMS error").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeCode = String(code || "InvalidRequest").replace(/[^A-Za-z0-9_:-]/g, "");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<ServiceExceptionReport version="1.3.0" xmlns="http://www.opengis.net/ogc">` +
    `<ServiceException code="${safeCode}">${safe}</ServiceException>` +
    `</ServiceExceptionReport>`
  );
};

const featureInfoDataToXml = (payload) => {
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
  const data = payload && typeof payload === 'object' ? payload : {};
  const layers = Array.isArray(data.layers) ? data.layers : [];
  const point = data.point && typeof data.point === 'object' ? data.point : {};
  const bbox = Array.isArray(data.bbox) ? data.bbox : [];

  const layerXml = layers.map((layer) => {
    const lname = esc(layer?.name || '');
    const feats = Array.isArray(layer?.features) ? layer.features : [];
    const featsXml = feats.map((feat) => {
      const fid = feat?.id == null ? '' : esc(feat.id);
      const props = feat?.properties && typeof feat.properties === 'object' ? feat.properties : {};
      // QGIS format: <Attribute name="..." value="..."/>
      const propsXml = Object.entries(props).map(([k, v]) => `<Attribute name="${esc(k)}" value="${esc(v == null ? '' : v)}"/>`).join('');
      const geom = feat?.geometryWkt ? `<GeometryWkt>${esc(feat.geometryWkt)}</GeometryWkt>` : '';
      return `<Feature id="${fid}">${propsXml}${geom}</Feature>`;
    }).join('');
    return `<Layer name="${lname}">${featsXml}</Layer>`;
  }).join('');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<GetFeatureInfoResponse>\n` +
    `${layerXml}\n` +
    `</GetFeatureInfoResponse>`
  );
};

const buildCapabilitiesXml = ({ projectId, layers, serviceUrl, supportedCrs = [], wmsVersion = "1.3.0" }) => {
  const now = new Date().toISOString();
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  
  const is111 = wmsVersion === "1.1.1";
  const rootOpenTag = is111 
    ? `<WMT_MS_Capabilities version="1.1.1">` 
    : `<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms" xmlns:xlink="http://www.w3.org/1999/xlink">`;
  const rootCloseTag = is111 ? `</WMT_MS_Capabilities>` : `</WMS_Capabilities>`;
  const srsTag = is111 ? "SRS" : "CRS";

  const rootCrs = Array.isArray(supportedCrs) && supportedCrs.length
    ? supportedCrs
    : ["EPSG:3857", "EPSG:4326"];
  const rootCrsNodes = rootCrs.map((c) => `<${srsTag}>${esc(c)}</${srsTag}>`).join("");
  const layerNodes = layers
    .map((l) => {
      const name = esc(l.name);
      const title = esc(l.title || l.name);
      const crsList = Array.isArray(l.crs) ? l.crs : [];
      const crsNodes = crsList.map((c) => `<${srsTag}>${esc(c)}</${srsTag}>`).join("");
      const bbox = Array.isArray(l.bbox) && l.bbox.length === 4 ? l.bbox.map((n) => Number(n)) : null;
      let bboxNode = "";
      if (bbox && bbox.every(Number.isFinite)) {
        if (is111) {
          bboxNode = `<LatLonBoundingBox minx="${bbox[0]}" miny="${bbox[1]}" maxx="${bbox[2]}" maxy="${bbox[3]}"/>`;
        } else {
          bboxNode = `<EX_GeographicBoundingBox><westBoundLongitude>${bbox[0]}</westBoundLongitude><southBoundLatitude>${bbox[1]}</southBoundLatitude><eastBoundLongitude>${bbox[2]}</eastBoundLongitude><northBoundLatitude>${bbox[3]}</northBoundLatitude></EX_GeographicBoundingBox>`;
        }
        // In addition, WMS requires BoundingBox elements for advertised coordinate systems.
        // We will supply a global 3857 bounding box as a fallback if no specific one exists.
        // OpenLayers/QWC2 parser depends on having a BoundingBox for the active map CRS.
        const srsLabel = is111 ? "SRS" : "CRS";
        bboxNode += `<BoundingBox ${srsLabel}="EPSG:3857" minx="-20037508.34" miny="-20037508.34" maxx="20037508.34" maxy="20037508.34"/>`;
        bboxNode += `<BoundingBox ${srsLabel}="EPSG:4326" minx="${bbox[1]}" miny="${bbox[0]}" maxx="${bbox[3]}" maxy="${bbox[2]}"/>`;
      }
      return `<Layer queryable="1"><Name>${name}</Name><Title>${title}</Title>${crsNodes}${bboxNode}</Layer>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `${rootOpenTag}\n` +
    `<Service>` +
    `<Name>OGC:WMS</Name>` +
    `<Title>${esc(`Qtiler WMS (${projectId})`)}</Title>` +
    `<Abstract>${esc("WMS endpoint powered by QGIS Core (no QGIS Server)")}</Abstract>` +
    `<OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="${esc(serviceUrl)}"/>` +
    `</Service>` +
    `<Capability>` +
    `<Request>` +
    `<GetCapabilities><Format>application/vnd.ogc.wms_xml</Format><DCPType><HTTP><Get><OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="${esc(serviceUrl)}"/></Get></HTTP></DCPType></GetCapabilities>` +
    `<GetMap><Format>image/png</Format><Format>image/jpeg</Format><DCPType><HTTP><Get><OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="${esc(serviceUrl)}"/></Get></HTTP></DCPType></GetMap>` +
    `<GetFeatureInfo><Format>application/json</Format><Format>text/plain</Format><Format>text/xml</Format><DCPType><HTTP><Get><OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="${esc(serviceUrl)}"/></Get></HTTP></DCPType></GetFeatureInfo>` +
    `<GetLegendGraphic><Format>image/png</Format><DCPType><HTTP><Get><OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="${esc(serviceUrl)}"/></Get></HTTP></DCPType></GetLegendGraphic>` +
    `</Request>` +
    `<Exception><Format>application/vnd.ogc.se_xml</Format></Exception>` +
    `<Layer>` +
    `<Title>${esc(`Qtiler project ${projectId}`)}</Title>` +
    `${rootCrsNodes}` +
    `${layerNodes}` +
    `</Layer>` +
    `</Capability>` +
    `<ExtendedCapabilities><GeneratedAt>${esc(now)}</GeneratedAt></ExtendedCapabilities>` +
    `\n${rootCloseTag}`
  );
};

const readSupportedCrsFromTileGrids = ({ tileGridDir }) => {
  try {
    const set = new Set(["EPSG:3857", "EPSG:4326"]);
    if (!tileGridDir || !fs.existsSync(tileGridDir)) return Array.from(set);
    const entries = fs.readdirSync(tileGridDir).filter((f) => f.toLowerCase().endsWith('.json'));
    for (const name of entries) {
      const full = path.join(tileGridDir, name);
      try {
        const raw = fs.readFileSync(full, 'utf8');
        const parsed = JSON.parse(raw);
        const supported = parsed?.supported_crs || parsed?.crs;
        if (typeof supported === 'string') {
          const crs = normalizeCrs(supported);
          if (crs) set.add(crs);
        } else if (Array.isArray(supported)) {
          for (const s of supported) {
            const crs = normalizeCrs(s);
            if (crs) set.add(crs);
          }
        }
      } catch {
        // ignore
      }
    }
    return Array.from(set);
  } catch {
    return ["EPSG:3857", "EPSG:4326"];
  }
};

const readProjectIndexLayers = ({ cacheDir, projectId }) => {
  const idxPath = path.join(cacheDir, projectId, "index.json");
  if (!fs.existsSync(idxPath)) return [];
  try {
    const raw = fs.readFileSync(idxPath, "utf8");
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed?.layers) ? parsed.layers : [];
    return entries
      .filter((e) => e && (e.kind || "layer") === "layer")
      .map((e) => {
        const name = String(e.name || e.layer || "").trim();
        if (!name) return null;
        const title = String(e.title || name);
        const tileCrs = normalizeCrs(e.tile_crs || e.crs) || "EPSG:3857";
        const layerCrs = normalizeCrs(e.layer_crs) || null;
        const supported = Array.from(new Set([tileCrs, layerCrs, "EPSG:4326", "EPSG:3857"].filter(Boolean)));
        const bbox = Array.isArray(e.extent_wgs84) && e.extent_wgs84.length === 4 ? e.extent_wgs84 : null;
        return { name, title, crs: supported, bbox };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

const safeLayerNameForWfs = (value) => {
  if (!value) return '';
  try {
    return String(value).normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  } catch {
    return '';
  }
};

export const registerWmsRoutes = ({
  app,
  cacheDir,
  tileGridDir,
  tileRendererPool,
  ensureProjectAccessFromQuery,
  findProjectById
}) => {
  const legacyWmsTileCacheRoot = path.join(cacheDir, '_wms_tiles');

  // Extracted handler so we can accept POST requests (with KVP body) as well
  const handleWmsKvp = async (req, res) => {
    // QWC2 MapInfoTooltip elevation queries sometimes hit /wms incorrectly.
    // E.g.: GET /wms?pos=X,Y&crs=EPSG:3857
    if (getQueryCI(req, "pos")) {
      return res.status(200).json({});
    }

      console.log('[WMS]', req.method, req.path, '| REQUEST='+getQueryCI(req,'REQUEST'), '| PROJECT='+getQueryCI(req,'project'));

      const service = String(getQueryCI(req, "SERVICE") || "WMS").toUpperCase();
      if (service !== "WMS") {
        if (service === "WFS") {
          const qMarkIdx = req.originalUrl.indexOf('?');
          const pathPart = qMarkIdx >= 0 ? req.originalUrl.substring(0, qMarkIdx) : req.originalUrl;
          const queryPart = qMarkIdx >= 0 ? req.originalUrl.substring(qMarkIdx) : '';
          const newPath = pathPart.replace(/\/wms\/?$/i, '/wfs');
          return res.redirect(308, newPath + queryPart);
        }
        res.status(400).type("application/xml").send(wmsExceptionXml("SERVICE must be WMS"));
        return;
      }

      // Be forgiving: if REQUEST is omitted (common when users paste the base endpoint
      // in a browser), default to GetCapabilities.
      const request = String(getQueryCI(req, "REQUEST") || "GetCapabilities").trim();

      const projectId = String(getQueryCI(req, "project") || "").trim();
      if (!projectId) {
        res.status(400).type("application/xml").send(wmsExceptionXml("project is required"));
        return;
      }

      const project = findProjectById(projectId);
      if (!project || !project.file) {
        res.status(404).type("application/xml").send(wmsExceptionXml("Project not found", { code: "NotFound" }));
        return;
      }

      const requestUpper = request.toUpperCase();
      if (requestUpper === "GETCAPABILITIES") {
        const layers = readProjectIndexLayers({ cacheDir, projectId });
        const supportedCrs = readSupportedCrsFromTileGrids({ tileGridDir });
        const mergedLayers = layers.map((layer) => {
          const localCrs = Array.isArray(layer.crs) ? layer.crs : [];
          return { ...layer, crs: Array.from(new Set([...supportedCrs, ...localCrs])) };
        });

        // Optional: return capabilities for a single layer only.
        const requestedLayer = String(getQueryCI(req, 'layer') || getQueryCI(req, 'LAYER') || '').trim();
        const requestedLayer2 = requestedLayer || String(getQueryCI(req, 'LAYERS') || '').split(',')[0].trim();
        let outLayers = mergedLayers;
        if (requestedLayer2) {
          const exact = mergedLayers.filter((l) => String(l?.name ?? '') === requestedLayer2);
          if (exact.length) outLayers = exact;
        }

        // Include the required `project` parameter in the advertised endpoint so clients that
        // follow the OnlineResource won't lose project context after GetCapabilities.
        const serviceUrl = `${getRequestBaseUrl(req)}/wms?project=${encodeURIComponent(projectId)}`;
        
        const reqVersion = String(getQueryCI(req, "VERSION") || "1.3.0").trim();
        const negotiatedVersion = reqVersion.startsWith("1.1") ? "1.1.1" : "1.3.0";

        // NOTE: do not append ?api_key=… here. The capability document is cached
        // by clients and proxies; clients must send the key via the X-API-Key
        // header instead so it never lands in shared logs/caches.
        const xml = buildCapabilitiesXml({ projectId, layers: outLayers, serviceUrl, supportedCrs, wmsVersion: negotiatedVersion });
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).type("text/xml").send(xml);
        return;
      }

      if (requestUpper === "GETLEGENDGRAPHIC") {
        const formatRaw = String(getQueryCI(req, "FORMAT") || "image/png").trim().toLowerCase();
        const format = formatRaw.split(";")[0].trim();
        if (format !== "image/png") {
          res.status(400).type("application/xml").send(wmsExceptionXml(`Unsupported FORMAT: ${formatRaw}`));
          return;
        }

        const layerName = String(getQueryCI(req, "LAYER") || "").trim();
        if (!layerName) {
          res.status(400).type("application/xml").send(wmsExceptionXml("LAYER is required"));
          return;
        }

        // Cache legends on disk: they rarely change and clients (e.g. QWC2)
        // request one per layer at once, which would otherwise flood the pool.
        const safeProject = String(project.id || project.name || 'project').replace(/[^a-zA-Z0-9_.-]/g, '_');
        const safeLayer = layerName.replace(/[^a-zA-Z0-9_.-]/g, '_');
        const legendCacheDir = path.join(process.cwd(), 'cache', safeProject, '_legends');
        const cachedFile = path.join(legendCacheDir, `${safeLayer}.png`);

        // Serve from cache if exists and project file hasn't changed since.
        try {
          const [cachedStat, projStat] = await Promise.all([
            fs.promises.stat(cachedFile).catch(() => null),
            fs.promises.stat(project.file).catch(() => null)
          ]);
          if (cachedStat && projStat && cachedStat.mtimeMs >= projStat.mtimeMs) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.type('image/png');
            return res.sendFile(cachedFile);
          }
        } catch { /* fall through to render */ }

        try {
          await fs.promises.mkdir(legendCacheDir, { recursive: true });
        } catch { /* ignore */ }

        // Cache miss: respond IMMEDIATELY with a placeholder PNG so the
        // browser doesn't keep 20 connections pending (which would block
        // every other request — map tiles, background, etc.). Kick off a
        // background render that fills the cache for the next reload.
        const inflightKey = `${safeProject}::${safeLayer}`;
        if (!legendInFlight.has(inflightKey)) {
          legendInFlight.add(inflightKey);
          // Fire-and-forget. Errors are swallowed (next reload will retry).
          tileRendererPool.renderTile({
            action: "legend",
            project_path: project.file,
            output_file: cachedFile,
            layer: layerName,
            format: "image/png",
            transparent: true
          }).catch(() => {}).finally(() => {
            legendInFlight.delete(inflightKey);
          });
        }

        res.setHeader('Cache-Control', 'no-store');
        res.type('image/png');
        res.status(200).send(PLACEHOLDER_PNG);
        return;
      }

      if (requestUpper === "GETFEATUREINFO") {
        const version = String(getQueryCI(req, "VERSION") || "1.3.0").trim();
        const crs = normalizeCrs(getQueryCI(req, "CRS") || getQueryCI(req, "SRS")) || "EPSG:3857";
        const filterGeomRaw = String(getQueryCI(req, "FILTER_GEOM") || "").trim();
        const filterGeomBbox = parseFilterGeomBbox(filterGeomRaw);
        const bboxRaw = parseBbox(getQueryCI(req, "BBOX")) || filterGeomBbox;
        if (!bboxRaw) {
          res.status(400).type("application/xml").send(wmsExceptionXml("BBOX must have 4 numeric values"));
          return;
        }

        const width = clampInt(getQueryCI(req, "WIDTH"), { min: 1, max: 8192, fallback: filterGeomBbox ? 101 : null });
        const height = clampInt(getQueryCI(req, "HEIGHT"), { min: 1, max: 8192, fallback: filterGeomBbox ? 101 : null });
        if (!width || !height) {
          res.status(400).type("application/xml").send(wmsExceptionXml("WIDTH/HEIGHT are required"));
          return;
        }

        const queryLayers = parseCsv(getQueryCI(req, "QUERY_LAYERS") || getQueryCI(req, "LAYERS"));
        if (!queryLayers.length) {
          res.status(400).type("application/xml").send(wmsExceptionXml("QUERY_LAYERS is required"));
          return;
        }

        const infoFormatRaw = String(getQueryCI(req, "INFO_FORMAT") || "application/json").trim().toLowerCase();
        const infoFormat = infoFormatRaw.split(';')[0].trim();
        if (
          infoFormat !== 'application/json'
          && infoFormat !== 'text/plain'
          && infoFormat !== 'text/xml'
          && infoFormat !== 'application/vnd.ogc.gml'
          && infoFormat !== 'application/vnd.ogc.gml/3.1.1'
        ) {
          res.status(400).type("application/xml").send(wmsExceptionXml(`Unsupported INFO_FORMAT: ${infoFormatRaw}`));
          return;
        }

        const normalizedInfoFormat = (
          infoFormat === 'application/vnd.ogc.gml' || infoFormat === 'application/vnd.ogc.gml/3.1.1'
        ) ? 'text/xml' : infoFormat;

        const featureCount = clampInt(getQueryCI(req, "FEATURE_COUNT"), { min: 1, max: 50, fallback: 10 });
        const iRaw = getQueryCI(req, "I") ?? getQueryCI(req, "X");
        const jRaw = getQueryCI(req, "J") ?? getQueryCI(req, "Y");
        const i = clampInt(iRaw, { min: 0, max: 100000, fallback: filterGeomBbox ? Math.floor(width / 2) : null });
        const j = clampInt(jRaw, { min: 0, max: 100000, fallback: filterGeomBbox ? Math.floor(height / 2) : null });
        if (i == null || j == null) {
          res.status(400).type("application/xml").send(wmsExceptionXml("I/J (or X/Y) are required"));
          return;
        }

        let bbox = bboxRaw;
        if (String(version).trim() === "1.3.0" && String(crs).toUpperCase() === "EPSG:4326") {
          bbox = [bboxRaw[1], bboxRaw[0], bboxRaw[3], bboxRaw[2]];
        }

        try {
          const result = await tileRendererPool.renderTile({
            action: "feature_info",
            project_path: project.file,
            crs,
            bbox,
            width,
            height,
            i,
            j,
            query_layers: queryLayers,
            feature_count: featureCount,
            info_format: normalizedInfoFormat,
            filter_geom: filterGeomRaw || null
          });

          if (!result || result.status !== 'success') {
            const msg = result?.message || result?.error || 'feature_info_failed';
            res.status(500).type("application/xml").send(wmsExceptionXml(String(msg), { code: "NoApplicableCode" }));
            return;
          }

          res.setHeader('Cache-Control', 'no-store');
          if (normalizedInfoFormat === 'text/plain') {
            res.type('text/plain').send(String(result.text || ''));
          } else if (normalizedInfoFormat === 'text/xml') {
            res.type('text/xml').send(String(result.xml || featureInfoDataToXml(result.data || {})));
          } else {
            res.type('application/json').json(result.data || {});
          }
        } catch (err) {
          res.status(renderErrStatus(err)).type("application/xml").send(wmsExceptionXml(String(err?.message || err), { code: "NoApplicableCode" }));
        }
        return;
      }

      if (requestUpper === "GETPROJECTSETTINGS") {
        try {
          const layouts = await loadProjectPrintLayouts({ tileRendererPool, projectFile: project.file });
          res.setHeader("Cache-Control", "no-store");
          res.status(200).type("text/xml").send(buildProjectSettingsXml(layouts));
        } catch {
          res.setHeader("Cache-Control", "no-store");
          res.status(200).type("text/xml").send(buildProjectSettingsXml(null));
        }
        return;
      }

      if (requestUpper === "DESCRIBELAYER") {
        // DescribeLayer is used by QWC2 to discover if a layer has WFS capabilities.
        // We return a minimal valid XML response indicating no WFS endpoint.
        const requestedLayers = parseCsv(getQueryCI(req, "LAYERS") || "");
        const layerDescs = requestedLayers.map((l) =>
          `<LayerDescription name="${l.replace(/[<>&"]/g, '')}"/>`
        ).join("\n    ");
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<WMS_DescribeLayerResponse version="1.1.1" xmlns:xlink="http://www.w3.org/1999/xlink">\n    ${layerDescs || `<LayerDescription name=""/>`}\n</WMS_DescribeLayerResponse>`;
        res.setHeader("Cache-Control", "no-store");
        res.status(200).type("text/xml").send(xml);
        return;
      }

      if (requestUpper === "GETPRINT") {
        const layoutName = String(getQueryCI(req, "TEMPLATE") || "A4").trim();
        const crsRaw = String(getQueryCI(req, "CRS") || getQueryCI(req, "SRS") || "EPSG:3857").trim();
        const printParams = parsePrintRequestParams(req);
        const bboxRaw = printParams.bbox;
        if (!bboxRaw) {
          res.status(400).type("application/xml").send(wmsExceptionXml("BBOX or map extent must have 4 numeric values"));
          return;
        }

        const formatRaw = String(getQueryCI(req, "FORMAT") || "pdf").trim().toLowerCase();
        if (formatRaw !== "pdf" && formatRaw !== "application/pdf") {
          res.status(400).type("application/xml").send(wmsExceptionXml(`Unsupported print FORMAT: ${formatRaw}`));
          return;
        }

        const queryLayers = parseCsv(getQueryCI(req, "LAYERS"));

        let tmpDir;
        try {
          tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qtiler-wms-print-"));
          const outFile = path.join(tmpDir, `print_output.pdf`);
          
          const result = await tileRendererPool.renderTile({
            action: "print_layout",
            project_path: project.file,
            output_file: outFile,
            layout_name: layoutName,
            bbox: bboxRaw,
            crs: crsRaw,
            layers: queryLayers,
            labels: printParams.labels,
            rotation: printParams.rotation,
            dpi: printParams.dpi,
            map_name: printParams.mapName
          });

          if (!result || result.status !== "success") {
            const msg = result?.message || result?.error || "print_failed";
            res.status(500).type("application/xml").send(wmsExceptionXml(String(msg), { code: "NoApplicableCode" }));
            return;
          }

          res.setHeader("Cache-Control", "no-store");
          res.type("application/pdf");
          res.sendFile(outFile, async () => {
            try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch { }
          });
        } catch (err) {
          try { if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch { }
          res.status(renderErrStatus(err)).type("application/xml").send(wmsExceptionXml(String(err?.message || err), { code: "NoApplicableCode" }));
        }
        return;
      }

      if (requestUpper !== "GETMAP") {
        console.warn('[WMS-400] Unsupported REQUEST:', request, '| method:', req.method, '| url:', req.originalUrl);
        res.status(400).type("application/xml").send(wmsExceptionXml(`Unsupported REQUEST: ${request}`));
        return;
      }

      const version = String(getQueryCI(req, "VERSION") || "1.3.0").trim();
      const crs = normalizeCrs(getQueryCI(req, "CRS") || getQueryCI(req, "SRS")) || "EPSG:3857";
      const bboxRaw = parseBbox(getQueryCI(req, "BBOX"));
      if (!bboxRaw) {
        console.warn('[WMS-400] BBOX invalid | BBOX='+getQueryCI(req,'BBOX'), '| method:', req.method);
        res.status(400).type("application/xml").send(wmsExceptionXml("BBOX must have 4 numeric values"));
        return;
      }

      const width = clampInt(getQueryCI(req, "WIDTH"), { min: 1, max: 8192, fallback: null });
      const height = clampInt(getQueryCI(req, "HEIGHT"), { min: 1, max: 8192, fallback: null });
      if (!width || !height) {
        console.warn('[WMS-400] WIDTH/HEIGHT missing | W='+width+' H='+height+' | method:', req.method);
        res.status(400).type("application/xml").send(wmsExceptionXml("WIDTH/HEIGHT are required"));
        return;
      }

      if (width * height > WMS_MAX_PIXELS) {
        res.status(400).type("application/xml").send(
          wmsExceptionXml(`Requested image size too large (max ${WMS_MAX_PIXELS} pixels).`, { code: "InvalidRequest" })
        );
        return;
      }

      const formatRaw = String(getQueryCI(req, "FORMAT") || "image/png").trim().toLowerCase();
      const format = formatRaw.split(";")[0].trim();
      if (format !== "image/png" && format !== "image/jpeg" && format !== "image/jpg") {
        console.warn('[WMS-400] Unsupported FORMAT:', formatRaw, '| method:', req.method);
        res.status(400).type("application/xml").send(wmsExceptionXml(`Unsupported FORMAT: ${formatRaw}`));
        return;
      }

      const stylesRaw = String(getQueryCI(req, 'STYLES') || '').trim();

      const transparent = toBool(getQueryCI(req, "TRANSPARENT"), true);

      let layers = parseCsv(getQueryCI(req, "LAYERS"));
      if (!layers.length) {
        // QWC2 MapFilter sends a GetMap with empty LAYERS as a "validation" probe
        // when no filters are active. Return a transparent 1×1 PNG so it succeeds.
        const emptyPng = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64'
        );
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).type('image/png').send(emptyPng);
        return;
      }

      if (layers.length > WMS_MAX_LAYERS) {
        res.status(400).type("application/xml").send(
          wmsExceptionXml(`Too many layers requested (max ${WMS_MAX_LAYERS}).`, { code: "InvalidRequest" })
        );
        return;
      }

      // WMS 1.3.0 axis order: EPSG:4326 is (lat,lon). Convert to (x,y) for QGIS.
      let bbox = bboxRaw;
      if (String(version).trim() === "1.3.0" && String(crs).toUpperCase() === "EPSG:4326") {
        bbox = [bboxRaw[1], bboxRaw[0], bboxRaw[3], bboxRaw[2]];
      }

      // GeoWebCache-like caching: only cache tile-aligned WMS requests.
      // Criteria: 256x256 + bbox matches a known tile matrix set for this CRS.
      const isTileSized = width === 256 && height === 256;
      // Attempt to map sanitized layer names (from themes.json) back to actual
      // layer names present in the project's cache index. This allows QWC2 to
      // request `madrid_building` while the cached layer is named "madrid — building".
      try {
        const knownLayers = readProjectIndexLayers({ cacheDir, projectId });
        if (Array.isArray(knownLayers) && knownLayers.length) {
          layers = layers.map((ln) => {
            if (!ln) return ln;
            // exact match
            if (knownLayers.some((k) => String(k.name || '') === String(ln))) return ln;
            // try sanitized match
            const target = safeLayerNameForWfs(ln);
            const found = knownLayers.find((k) => safeLayerNameForWfs(k.name) === target);
            return found ? String(found.name) : ln;
          });
        }
      } catch {
        // ignore mapping failures and continue with original layers
      }
      const presets = isTileSized ? loadTileMatrixPresetsForCrs({ tileGridDir, crs }) : [];
      let cacheTarget = null;
      if (isTileSized && presets.length) {
        for (const preset of presets) {
          const tile = findAlignedTileForBbox({ preset, bbox, width, height });
          if (!tile) continue;

          const layerKey = layers.join(',');
          const ext = format === 'image/png' ? 'png' : 'jpg';
          const crsSeg = safePathSegment(String(crs).toUpperCase());
          const projSeg = safePathSegment(projectId);
          const layersSeg = safePathSegment(layerKey, { fallback: 'layers' });
          const stylesSeg = safePathSegment(stylesRaw || 'default', { fallback: 'default' });
          const transparentSeg = transparent ? 't' : 'o';

          // Store WMS cache per project (like WMTS cache), and avoid long IDs in filenames.
          // Keep uniqueness by using styles/transparent as directory segments.
          const wmsTileCacheRoot = path.join(cacheDir, projSeg, '_wms_tiles');
          cacheTarget = {
            filePath: path.join(wmsTileCacheRoot, crsSeg, layersSeg, stylesSeg, transparentSeg, String(tile.z), String(tile.x), `${tile.y}.${ext}`),
            contentType: format === 'image/png' ? 'image/png' : 'image/jpeg'
          };
          break;
        }
      }

      if (cacheTarget) {
        try {
          if (fs.existsSync(cacheTarget.filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.type(cacheTarget.contentType);
            res.sendFile(cacheTarget.filePath);
            return;
          }

          // Note: old WMS cache lived in cache/_wms_tiles/<project>/... with hashed filenames.
          // We do not attempt to reuse those files automatically.

          await fs.promises.mkdir(path.dirname(cacheTarget.filePath), { recursive: true });
          const result = await tileRendererPool.renderTile({
            project_path: project.file,
            output_file: cacheTarget.filePath,
            bbox,
            width,
            height,
            crs,
            layers,
            transparent,
            format
          });

          if (!result || result.status !== 'success') {
            const msg = result?.message || result?.error || 'render_failed';
            res.status(500).type('application/xml').send(wmsExceptionXml(String(msg), { code: 'NoApplicableCode' }));
            return;
          }

          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.type(cacheTarget.contentType);
          res.sendFile(cacheTarget.filePath);
        } catch (err) {
          res.status(renderErrStatus(err)).type('application/xml').send(wmsExceptionXml(String(err?.message || err), { code: 'NoApplicableCode' }));
        }
        return;
      }

      let tmpDir;
      try {
        tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qtiler-wms-"));
        const ext = format === "image/png" ? "png" : "jpg";
        const outFile = path.join(tmpDir, `map.${ext}`);

        const renderParams = {
          project_path: project.file,
          output_file: outFile,
          bbox,
          width,
          height,
          crs,
          layers,
          transparent,
          format
        };

        const result = await tileRendererPool.renderTile(renderParams);
        if (!result || result.status !== "success") {
          const msg = result?.message || result?.error || "render_failed";
          res.status(500).type("application/xml").send(wmsExceptionXml(String(msg), { code: "NoApplicableCode" }));
          return;
        }

        res.setHeader("Cache-Control", "no-store");
        res.type(format);
        res.sendFile(outFile, async () => {
          try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch { }
        });
      } catch (err) {
        try { if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch { }
        res.status(renderErrStatus(err)).type("application/xml").send(wmsExceptionXml(String(err?.message || err), { code: "NoApplicableCode" }));
      }
    };

  // Register GET + POST handlers for /wms. POST requests often send KVP body
  // instead of querystring (QWC2 components may do this), so for POST we
  // merge `req.body` into `req.query` before handling.
  app.get(
    "/wms",
    ensureProjectAccessFromQuery("project"),
    handleWmsKvp
  );

  app.post(
    "/wms",
    // 1. Primero leer el body (con límite ampliado para peticiones grandes de QWC2)
    express.urlencoded({ extended: true, limit: '50mb' }),
    express.json({ limit: '50mb' }),
    // 2. Mezclar el body dentro del query
    // NOTA: req.query es un getter de solo lectura en el prototipo de Express.
    // En strict mode (módulos ES), "req.query = value" lanza TypeError.
    // Usamos Object.defineProperty para crear una propiedad propia en la instancia
    // que sombrea al getter del prototipo.
    (req, res, next) => {
      try {
        const merged = Object.assign({}, req.query || {}, req.body || {});
        Object.defineProperty(req, 'query', {
          value: merged,
          writable: true,
          enumerable: true,
          configurable: true
        });
      } catch {
        // Si falla por alguna razón, seguir sin mezclar
      }
      next();
    },
    // 3. AHORA ejecutar la seguridad (que ya podrá leer el proyecto del query mezclado)
    ensureProjectAccessFromQuery("project"),
    // 4. Finalmente, procesar el WMS
    (req, res, next) => handleWmsKvp(req, res, next)
  );

};
