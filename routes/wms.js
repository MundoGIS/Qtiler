/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

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

const clampInt = (value, { min = 1, max = 8192, fallback = null } = {}) => {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

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

const buildCapabilitiesXml = ({ projectId, layers, serviceUrl, supportedCrs = [] }) => {
  const now = new Date().toISOString();
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const rootCrs = Array.isArray(supportedCrs) && supportedCrs.length
    ? supportedCrs
    : ["EPSG:3857", "EPSG:4326"];
  const rootCrsNodes = rootCrs.map((c) => `<CRS>${esc(c)}</CRS>`).join("");
  const layerNodes = layers
    .map((l) => {
      const name = esc(l.name);
      const title = esc(l.title || l.name);
      const crsList = Array.isArray(l.crs) ? l.crs : [];
      const crsNodes = crsList.map((c) => `<CRS>${esc(c)}</CRS>`).join("");
      const bbox = Array.isArray(l.bbox) && l.bbox.length === 4 ? l.bbox.map((n) => Number(n)) : null;
      const bboxNode = bbox && bbox.every(Number.isFinite)
        ? `<EX_GeographicBoundingBox><westBoundLongitude>${bbox[0]}</westBoundLongitude><southBoundLatitude>${bbox[1]}</southBoundLatitude><eastBoundLongitude>${bbox[2]}</eastBoundLongitude><northBoundLatitude>${bbox[3]}</northBoundLatitude></EX_GeographicBoundingBox>`
        : "";
      return `<Layer queryable="1"><Name>${name}</Name><Title>${title}</Title>${crsNodes}${bboxNode}</Layer>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms" xmlns:xlink="http://www.w3.org/1999/xlink">` +
    `<Service>` +
    `<Name>WMS</Name>` +
    `<Title>${esc(`Qtiler WMS (${projectId})`)}</Title>` +
    `<Abstract>${esc("WMS endpoint powered by QGIS Core (no QGIS Server)")}</Abstract>` +
    `<OnlineResource xlink:type="simple" xlink:href="${esc(serviceUrl)}"/>` +
    `</Service>` +
    `<Capability>` +
    `<Request>` +
    `<GetCapabilities><Format>text/xml</Format><DCPType><HTTP><Get><OnlineResource xlink:type="simple" xlink:href="${esc(serviceUrl)}"/></Get></HTTP></DCPType></GetCapabilities>` +
    `<GetMap><Format>image/png</Format><Format>image/jpeg</Format><DCPType><HTTP><Get><OnlineResource xlink:type="simple" xlink:href="${esc(serviceUrl)}"/></Get></HTTP></DCPType></GetMap>` +
    `<GetFeatureInfo><Format>application/json</Format><Format>text/plain</Format><DCPType><HTTP><Get><OnlineResource xlink:type="simple" xlink:href="${esc(serviceUrl)}"/></Get></HTTP></DCPType></GetFeatureInfo>` +
    `<GetLegendGraphic><Format>image/png</Format><DCPType><HTTP><Get><OnlineResource xlink:type="simple" xlink:href="${esc(serviceUrl)}"/></Get></HTTP></DCPType></GetLegendGraphic>` +
    `</Request>` +
    `<Exception><Format>XML</Format></Exception>` +
    `<Layer>` +
    `<Title>${esc(`Qtiler project ${projectId}`)}</Title>` +
    `${rootCrsNodes}` +
    `${layerNodes}` +
    `</Layer>` +
    `</Capability>` +
    `<ExtendedCapabilities><GeneratedAt>${esc(now)}</GeneratedAt></ExtendedCapabilities>` +
    `</WMS_Capabilities>`
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

export const registerWmsRoutes = ({
  app,
  cacheDir,
  tileGridDir,
  tileRendererPool,
  ensureProjectAccessFromQuery,
  findProjectById
}) => {
  const legacyWmsTileCacheRoot = path.join(cacheDir, '_wms_tiles');

  app.get(
    "/wms",
    ensureProjectAccessFromQuery("project"),
    async (req, res) => {
      const service = String(getQueryCI(req, "SERVICE") || "WMS").toUpperCase();
      if (service !== "WMS") {
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
        const serviceUrl = `${req.protocol}://${req.get("host")}/wms?project=${encodeURIComponent(projectId)}`;
        const xml = buildCapabilitiesXml({ projectId, layers: outLayers, serviceUrl, supportedCrs });
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

        let tmpDir;
        try {
          tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qtiler-wms-legend-"));
          const outFile = path.join(tmpDir, `legend.png`);
          const result = await tileRendererPool.renderTile({
            action: "legend",
            project_path: project.file,
            output_file: outFile,
            layer: layerName,
            format: "image/png",
            transparent: true
          });

          if (!result || result.status !== "success") {
            const msg = result?.message || result?.error || "legend_failed";
            res.status(500).type("application/xml").send(wmsExceptionXml(String(msg), { code: "NoApplicableCode" }));
            return;
          }

          res.setHeader("Cache-Control", "no-store");
          res.type("image/png");
          res.sendFile(outFile, async () => {
            try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch { }
          });
        } catch (err) {
          try { if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch { }
          res.status(500).type("application/xml").send(wmsExceptionXml(String(err?.message || err), { code: "NoApplicableCode" }));
        }
        return;
      }

      if (requestUpper === "GETFEATUREINFO") {
        const version = String(getQueryCI(req, "VERSION") || "1.3.0").trim();
        const crs = normalizeCrs(getQueryCI(req, "CRS") || getQueryCI(req, "SRS")) || "EPSG:3857";
        const bboxRaw = parseBbox(getQueryCI(req, "BBOX"));
        if (!bboxRaw) {
          res.status(400).type("application/xml").send(wmsExceptionXml("BBOX must have 4 numeric values"));
          return;
        }

        const width = clampInt(getQueryCI(req, "WIDTH"), { min: 1, max: 8192, fallback: null });
        const height = clampInt(getQueryCI(req, "HEIGHT"), { min: 1, max: 8192, fallback: null });
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
        if (infoFormat !== 'application/json' && infoFormat !== 'text/plain') {
          res.status(400).type("application/xml").send(wmsExceptionXml(`Unsupported INFO_FORMAT: ${infoFormatRaw}`));
          return;
        }

        const featureCount = clampInt(getQueryCI(req, "FEATURE_COUNT"), { min: 1, max: 50, fallback: 10 });
        const iRaw = getQueryCI(req, "I") ?? getQueryCI(req, "X");
        const jRaw = getQueryCI(req, "J") ?? getQueryCI(req, "Y");
        const i = clampInt(iRaw, { min: 0, max: 100000, fallback: null });
        const j = clampInt(jRaw, { min: 0, max: 100000, fallback: null });
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
            info_format: infoFormat
          });

          if (!result || result.status !== 'success') {
            const msg = result?.message || result?.error || 'feature_info_failed';
            res.status(500).type("application/xml").send(wmsExceptionXml(String(msg), { code: "NoApplicableCode" }));
            return;
          }

          res.setHeader('Cache-Control', 'no-store');
          if (infoFormat === 'text/plain') {
            res.type('text/plain').send(String(result.text || ''));
          } else {
            res.type('application/json').json(result.data || {});
          }
        } catch (err) {
          res.status(500).type("application/xml").send(wmsExceptionXml(String(err?.message || err), { code: "NoApplicableCode" }));
        }
        return;
      }

      if (requestUpper !== "GETMAP") {
        res.status(400).type("application/xml").send(wmsExceptionXml(`Unsupported REQUEST: ${request}`));
        return;
      }

      const version = String(getQueryCI(req, "VERSION") || "1.3.0").trim();
      const crs = normalizeCrs(getQueryCI(req, "CRS") || getQueryCI(req, "SRS")) || "EPSG:3857";
      const bboxRaw = parseBbox(getQueryCI(req, "BBOX"));
      if (!bboxRaw) {
        res.status(400).type("application/xml").send(wmsExceptionXml("BBOX must have 4 numeric values"));
        return;
      }

      const width = clampInt(getQueryCI(req, "WIDTH"), { min: 1, max: 8192, fallback: null });
      const height = clampInt(getQueryCI(req, "HEIGHT"), { min: 1, max: 8192, fallback: null });
      if (!width || !height) {
        res.status(400).type("application/xml").send(wmsExceptionXml("WIDTH/HEIGHT are required"));
        return;
      }

      const formatRaw = String(getQueryCI(req, "FORMAT") || "image/png").trim().toLowerCase();
      const format = formatRaw.split(";")[0].trim();
      if (format !== "image/png" && format !== "image/jpeg" && format !== "image/jpg") {
        res.status(400).type("application/xml").send(wmsExceptionXml(`Unsupported FORMAT: ${formatRaw}`));
        return;
      }

      const stylesRaw = String(getQueryCI(req, 'STYLES') || '').trim();

      const transparent = toBool(getQueryCI(req, "TRANSPARENT"), true);

      const layers = parseCsv(getQueryCI(req, "LAYERS"));
      if (!layers.length) {
        res.status(400).type("application/xml").send(wmsExceptionXml("LAYERS is required"));
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
          res.status(500).type('application/xml').send(wmsExceptionXml(String(err?.message || err), { code: 'NoApplicableCode' }));
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
        res.status(500).type("application/xml").send(wmsExceptionXml(String(err?.message || err), { code: "NoApplicableCode" }));
      }
    }
  );
};
