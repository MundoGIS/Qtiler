/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import multer from 'multer';
import { getRequestBaseUrl } from '../lib/requestBaseUrl.js';

const redactSecrets = (value) => {
  const input = value == null ? '' : String(value);
  if (!input) return '';
  let out = input;
  out = out.replace(/(\b(password|passwd|pwd)\s*[=:]\s*)([^\s&;\r\n]+)/gi, '$1***');
  out = out.replace(/(\b(api[_-]?key|token|access[_-]?token)\s*[=:]\s*)([^\s&;\r\n]+)/gi, '$1***');
  out = out.replace(/(\b(password|passwd|pwd)\b[^'\"]*['\"])([^'\"]+)(['\"])/gi, '$1***$4');
  out = out.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^:\s\/]+:)([^@\s\/]+)(@)/gi, '$1***$3');
  return out;
};

const getQueryCI = (req, key) => {
  if (!req || !req.query) return null;
  const target = String(key || '').toLowerCase();
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

const parseCsv = (value) => {
  if (value == null) return [];
  if (Array.isArray(value)) value = value[0];
  const raw = String(value).trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
};

const parseBbox = (value) => {
  const parts = parseCsv(value);
  if (parts.length < 4) return null;
  const nums = parts.slice(0, 4).map((p) => Number(p));
  if (!nums.every(Number.isFinite)) return null;
  const crs = parts.length >= 5 ? String(parts[4] || '').trim() : '';
  return { bbox: nums, crs };
};

const clampInt = (value, { min = 0, max = 1_000_000, fallback = null } = {}) => {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const envFlag = (value, fallback = false) => {
  if (value == null) return fallback;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
};

const wfsExceptionXml = (message, { code = 'NoApplicableCode' } = {}) => {
  const safe = String(message || 'WFS error')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const safeCode = String(code || 'NoApplicableCode').replace(/[^A-Za-z0-9_:-]/g, '');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows" version="1.1.0">` +
    `<ows:Exception exceptionCode="${safeCode}"><ows:ExceptionText>${safe}</ows:ExceptionText></ows:Exception>` +
    `</ows:ExceptionReport>`
  );
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isQueueFullCode = (code) => String(code || '').trim().toLowerCase() === 'queue_full';

const renderTileWithQueueRetry = async (tileRendererPool, params, { attempts = 3, baseDelayMs = 75 } = {}) => {
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await tileRendererPool.renderTile(params);
    } catch (err) {
      lastErr = err;
      if (!isQueueFullCode(err?.code) || attempt >= attempts - 1) throw err;
      await sleep(baseDelayMs * (attempt + 1));
    }
  }
  throw lastErr;
};

const escXml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const normalizeTypeName = (value) => {
  if (value == null) return '';
  const raw = String(Array.isArray(value) ? value[0] : value).trim();
  if (!raw) return '';
  const first = raw.split(',')[0].trim();
  if (!first) return '';
  const idx = first.lastIndexOf(':');
  return idx >= 0 ? first.slice(idx + 1).trim() : first;
};

const safeXmlName = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '_';
  let out = raw.replace(/[^A-Za-z0-9_.-]+/g, '_');
  if (!/^[A-Za-z_]/.test(out)) out = '_' + out;
  if (out.toLowerCase().startsWith('xml')) out = '_' + out;
  return out;
};

const normalizeSrsName = (value) => {
  if (value == null) return null;
  const raw = String(Array.isArray(value) ? value[0] : value).trim();
  if (!raw) return null;
  const m = raw.match(/EPSG[^0-9]*(\d{3,6})/i);
  if (m && m[1]) return `EPSG:${m[1]}`;
  return raw;
};

const buildCapabilitiesXml = ({ projectId, serviceUrl, featureTypes = [], version = '1.1.0', defaultCount = 1000 }) => {  const now = new Date().toISOString();
  const ns = `http://qtiler.local/${encodeURIComponent(projectId || 'project')}`;

  const ver = String(version || '1.1.0').trim();
  const is20 = ver.startsWith('2');

  const operationDcp = (name) => {
    const href = escXml(serviceUrl);
    return (
      `<ows:Operation name="${escXml(name)}">` +
      `<ows:DCP><ows:HTTP>` +
      `<ows:Get xlink:href="${href}"/>` +
      `<ows:Post xlink:href="${href}"/>` +
      `</ows:HTTP></ows:DCP>` +
      `</ows:Operation>`
    );
  };

  const ftNodes = featureTypes.map((ft) => {
    const name = escXml(ft.name);
    const title = escXml(ft.title || ft.name);
    const crs = escXml(ft.crs || 'EPSG:4326');
    const bbox = Array.isArray(ft.bboxWgs84) && ft.bboxWgs84.length === 4 ? ft.bboxWgs84.map((n) => Number(n)) : null;
    const bboxNode = bbox && bbox.every(Number.isFinite)
      ? `<ows:WGS84BoundingBox><ows:LowerCorner>${bbox[0]} ${bbox[1]}</ows:LowerCorner><ows:UpperCorner>${bbox[2]} ${bbox[3]}</ows:UpperCorner></ows:WGS84BoundingBox>`
      : '';
    return `<FeatureType><Name>${name}</Name><Title>${title}</Title><DefaultSRS>${crs}</DefaultSRS>${bboxNode}</FeatureType>`;
  }).join('');

  const wfsNs = is20 ? 'http://www.opengis.net/wfs/2.0' : 'http://www.opengis.net/wfs';
  const ogcNs = is20 ? 'http://www.opengis.net/fes/2.0' : 'http://www.opengis.net/ogc';
  const gmlNs = is20 ? 'http://www.opengis.net/gml/3.2' : 'http://www.opengis.net/gml';
  const schemaLoc = is20
    ? `${wfsNs} http://schemas.opengis.net/wfs/2.0/wfs.xsd`
    : `${wfsNs} http://schemas.opengis.net/wfs/1.1.0/wfs.xsd`;
  const pagingConstraints = is20
    ? (
        `<ows:Constraint name="ImplementsResultPaging">` +
        `<ows:AllowedValues><ows:Value>TRUE</ows:Value></ows:AllowedValues>` +
        `</ows:Constraint>` +
        `<ows:Constraint name="CountDefault">` +
        `<ows:DefaultValue>${escXml(String(defaultCount || 1000))}</ows:DefaultValue>` +
        `</ows:Constraint>`
      )
    : '';

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<WFS_Capabilities version="${escXml(is20 ? '2.0.0' : '1.1.0')}"` +
    ` xmlns="${wfsNs}"` +
    ` xmlns:ows="http://www.opengis.net/ows"` +
    ` xmlns:xlink="http://www.w3.org/1999/xlink"` +
    ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"` +
    ` xmlns:gml="${gmlNs}"` +
    ` xsi:schemaLocation="${escXml(schemaLoc)}">` +
    `<ows:ServiceIdentification>` +
    `<ows:Title>${escXml(`Qtiler WFS (${projectId})`)}</ows:Title>` +
    `<ows:Abstract>${escXml('WFS endpoint powered by QGIS Core (no QGIS Server)')}</ows:Abstract>` +
    `<ows:ServiceType>WFS</ows:ServiceType>` +
    `<ows:ServiceTypeVersion>${escXml(is20 ? '2.0.0' : '1.1.0')}</ows:ServiceTypeVersion>` +
    `</ows:ServiceIdentification>` +
    `<ows:OperationsMetadata>` +
    operationDcp('GetCapabilities') +
    operationDcp('DescribeFeatureType') +
    operationDcp('GetFeature') +
    `<ows:Operation name="Transaction"><ows:DCP><ows:HTTP><ows:Post xlink:href="${escXml(serviceUrl)}"/></ows:HTTP></ows:DCP></ows:Operation>` +
    pagingConstraints +
    `</ows:OperationsMetadata>` +
    `<FeatureTypeList>` +
    `<Operations><Operation>Query</Operation><Operation>Insert</Operation><Operation>Update</Operation><Operation>Delete</Operation></Operations>` +
    ftNodes +
    `</FeatureTypeList>` +
    `<Filter_Capabilities xmlns:ogc="${escXml(ogcNs)}">` +
    `<Spatial_Capabilities><Spatial_Operators>` +
    `<BBOX/>` +
    `</Spatial_Operators></Spatial_Capabilities>` +
    `</Filter_Capabilities>` +
    `<ExtendedCapabilities><GeneratedAt>${escXml(now)}</GeneratedAt><Namespace>${escXml(ns)}</Namespace></ExtendedCapabilities>` +
    `</WFS_Capabilities>`
  );
};

const httpStatusForWorkerCode = (code) => {
  const c = String(code || '').toLowerCase();
  if (c === 'notfound') return 404;
  if (c === 'missingparametervalue') return 400;
  if (c === 'invalidparametervalue') return 400;
  if (c === 'operationnotsupported') return 400;
  if (c === 'queue_full') return 503;
  return 500;
};

const owsCodeForWorkerCode = (code) => {
  const c = String(code || '').toLowerCase();
  if (c === 'notfound') return 'NotFound';
  if (c === 'missingparametervalue') return 'MissingParameterValue';
  if (c === 'invalidparametervalue') return 'InvalidParameterValue';
  if (c === 'operationnotsupported') return 'OperationNotSupported';
  return 'NoApplicableCode';
};

const applyRetryAfterHeader = (res, status) => {
  if (status === 503 && res && !res.headersSent) {
    res.setHeader('Retry-After', '1');
  }
};

export const registerWfsRoutes = ({
  app,
  tileRendererPool,
  ensureProjectAccessFromQuery,
  requireAdmin,
  findProjectById,
  readProjectConfig,
  logProjectEvent
}) => {
  const pickBestWfsVersion = (version, acceptVersions) => {
    const v = String(version || '').trim();
    if (v) return v;
    const accepts = parseCsv(acceptVersions).map((x) => String(x || '').trim()).filter(Boolean);

    const supported = ['2.0.0', '1.1.0'];

    for (const candidate of supported) {
      if (accepts.some((a) => a === candidate || a.startsWith(candidate))) return candidate;
    }

    return process.env.WFS_CAPABILITIES_DEFAULT_VERSION || '2.0.0';
  };

  const logTx = (projectId, message, level = 'info') => {
    try {
      if (typeof logProjectEvent === 'function') {
        logProjectEvent(projectId, message, level);
      }
    } catch {
      // ignore
    }
  };

  const multipartUpload = multer({ storage: multer.memoryStorage() });

  const parseJsonMaybe = (value) => {
    if (value == null) return null;
    if (typeof value === 'object') return value;
    const text = String(value).trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  const toWktNumber = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return String(n);
  };

  const ringToWkt = (ring) => {
    if (!Array.isArray(ring) || !ring.length) return null;
    const pts = [];
    for (const p of ring) {
      if (!Array.isArray(p) || p.length < 2) return null;
      const x = toWktNumber(p[0]);
      const y = toWktNumber(p[1]);
      if (x == null || y == null) return null;
      pts.push(`${x} ${y}`);
    }
    if (pts.length < 4) return null;
    return `(${pts.join(', ')})`;
  };

  const geometryToWkt = (geometry) => {
    if (!geometry || typeof geometry !== 'object') return null;
    const type = String(geometry.type || '').trim();
    const coords = geometry.coordinates;
    if (!type || coords == null) return null;

    if (type === 'Point') {
      if (!Array.isArray(coords) || coords.length < 2) return null;
      const x = toWktNumber(coords[0]);
      const y = toWktNumber(coords[1]);
      if (x == null || y == null) return null;
      return `POINT(${x} ${y})`;
    }
    if (type === 'LineString') {
      if (!Array.isArray(coords) || coords.length < 2) return null;
      const pts = coords.map((p) => {
        if (!Array.isArray(p) || p.length < 2) return null;
        const x = toWktNumber(p[0]);
        const y = toWktNumber(p[1]);
        if (x == null || y == null) return null;
        return `${x} ${y}`;
      });
      if (pts.some((v) => v == null)) return null;
      return `LINESTRING(${pts.join(', ')})`;
    }
    if (type === 'Polygon') {
      if (!Array.isArray(coords) || !coords.length) return null;
      const rings = coords.map(ringToWkt);
      if (rings.some((v) => v == null)) return null;
      return `POLYGON(${rings.join(', ')})`;
    }
    if (type === 'MultiPoint') {
      if (!Array.isArray(coords) || !coords.length) return null;
      const pts = coords.map((p) => {
        if (!Array.isArray(p) || p.length < 2) return null;
        const x = toWktNumber(p[0]);
        const y = toWktNumber(p[1]);
        if (x == null || y == null) return null;
        return `(${x} ${y})`;
      });
      if (pts.some((v) => v == null)) return null;
      return `MULTIPOINT(${pts.join(', ')})`;
    }
    if (type === 'MultiLineString') {
      if (!Array.isArray(coords) || !coords.length) return null;
      const lines = coords.map((line) => {
        if (!Array.isArray(line) || line.length < 2) return null;
        const pts = line.map((p) => {
          if (!Array.isArray(p) || p.length < 2) return null;
          const x = toWktNumber(p[0]);
          const y = toWktNumber(p[1]);
          if (x == null || y == null) return null;
          return `${x} ${y}`;
        });
        if (pts.some((v) => v == null)) return null;
        return `(${pts.join(', ')})`;
      });
      if (lines.some((v) => v == null)) return null;
      return `MULTILINESTRING(${lines.join(', ')})`;
    }
    if (type === 'MultiPolygon') {
      if (!Array.isArray(coords) || !coords.length) return null;
      const polys = coords.map((poly) => {
        if (!Array.isArray(poly) || !poly.length) return null;
        const rings = poly.map(ringToWkt);
        if (rings.some((v) => v == null)) return null;
        return `(${rings.join(', ')})`;
      });
      if (polys.some((v) => v == null)) return null;
      return `MULTIPOLYGON(${polys.join(', ')})`;
    }
    return null;
  };

  const parseMultipartFeaturePayload = (body) => {
    const src = body && typeof body === 'object' ? body : {};
    const directFeature = parseJsonMaybe(src.feature) || parseJsonMaybe(src.data) || parseJsonMaybe(src.geojson) || parseJsonMaybe(src.payload);
    if (directFeature && typeof directFeature === 'object') {
      if (directFeature.type === 'Feature') {
        return {
          properties: directFeature.properties && typeof directFeature.properties === 'object' ? directFeature.properties : {},
          geometry: directFeature.geometry && typeof directFeature.geometry === 'object' ? directFeature.geometry : null
        };
      }
      if (directFeature.properties || directFeature.geometry) {
        return {
          properties: directFeature.properties && typeof directFeature.properties === 'object' ? directFeature.properties : {},
          geometry: directFeature.geometry && typeof directFeature.geometry === 'object' ? directFeature.geometry : null
        };
      }
    }

    const geomObj = parseJsonMaybe(src.geometry) || null;
    const propsObj = parseJsonMaybe(src.properties) || null;
    const reserved = new Set(['feature', 'data', 'geojson', 'payload', 'geometry', 'properties', 'g-recaptcha-response']);
    const inferred = {};
    for (const [k, v] of Object.entries(src)) {
      if (!k || reserved.has(k) || k.startsWith('file:') || k.startsWith('relfile:')) continue;
      inferred[k] = v;
    }
    return {
      properties: propsObj && typeof propsObj === 'object' ? propsObj : inferred,
      geometry: geomObj && typeof geomObj === 'object' ? geomObj : null
    };
  };

  const buildInsertTransactionXml = ({ projectId, layerName, feature }) => {
    const safeType = safeXmlName(layerName);
    const featureNs = `http://qtiler.local/${encodeURIComponent(projectId || 'project')}`;
    const props = feature?.properties && typeof feature.properties === 'object' ? feature.properties : {};
    const wkt = geometryToWkt(feature?.geometry);

    let body = '';
    for (const [k, v] of Object.entries(props)) {
      if (!k || v == null) continue;
      const safeKey = safeXmlName(k);
      let text = '';
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        text = String(v);
      } else {
        try { text = JSON.stringify(v); } catch { text = String(v); }
      }
      body += `<feature:${safeKey}>${escXml(text)}</feature:${safeKey}>`;
    }
    if (wkt) {
      body += `<feature:geometry>${escXml(wkt)}</feature:geometry>`;
    }

    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<wfs:Transaction service="WFS" version="1.1.0" ` +
      `xmlns:wfs="http://www.opengis.net/wfs" xmlns:ogc="http://www.opengis.net/ogc" xmlns:gml="http://www.opengis.net/gml" xmlns:feature="${escXml(featureNs)}">` +
      `<wfs:Insert><feature:${safeType}>${body}</feature:${safeType}></wfs:Insert>` +
      `</wfs:Transaction>`
    );
  };

  const buildUpdateTransactionXml = ({ projectId, layerName, featureId, feature }) => {
    const safeType = safeXmlName(layerName);
    const featureNs = `http://qtiler.local/${encodeURIComponent(projectId || 'project')}`;
    const props = feature?.properties && typeof feature.properties === 'object' ? feature.properties : {};
    const wkt = geometryToWkt(feature?.geometry);
    const fidRaw = String(featureId || '').trim();
    const fid = fidRaw.includes('.') ? fidRaw : `${safeType}.${fidRaw}`;

    let propXml = '';
    for (const [k, v] of Object.entries(props)) {
      if (!k || v == null) continue;
      const safeKey = safeXmlName(k);
      let text = '';
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        text = String(v);
      } else {
        try { text = JSON.stringify(v); } catch { text = String(v); }
      }
      propXml += `<wfs:Property><wfs:Name>${escXml(safeKey)}</wfs:Name><wfs:Value>${escXml(text)}</wfs:Value></wfs:Property>`;
    }
    if (wkt) {
      propXml += `<wfs:Property><wfs:Name>geometry</wfs:Name><wfs:Value>${escXml(wkt)}</wfs:Value></wfs:Property>`;
    }

    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<wfs:Transaction service="WFS" version="1.1.0" ` +
      `xmlns:wfs="http://www.opengis.net/wfs" xmlns:ogc="http://www.opengis.net/ogc" xmlns:gml="http://www.opengis.net/gml" xmlns:feature="${escXml(featureNs)}">` +
      `<wfs:Update typeName="${escXml(layerName)}">${propXml}` +
      `<ogc:Filter><ogc:FeatureId fid="${escXml(fid)}"/></ogc:Filter>` +
      `</wfs:Update>` +
      `</wfs:Transaction>`
    );
  };

  const buildDeleteTransactionXml = ({ projectId, layerName, featureId }) => {
    const safeType = safeXmlName(layerName);
    const featureNs = `http://qtiler.local/${encodeURIComponent(projectId || 'project')}`;
    const fidRaw = String(featureId || '').trim();
    const fid = fidRaw.includes('.') ? fidRaw : `${safeType}.${fidRaw}`;
    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<wfs:Transaction service="WFS" version="1.1.0" ` +
      `xmlns:wfs="http://www.opengis.net/wfs" xmlns:ogc="http://www.opengis.net/ogc" xmlns:gml="http://www.opengis.net/gml" xmlns:feature="${escXml(featureNs)}">` +
      `<wfs:Delete typeName="${escXml(layerName)}">` +
      `<ogc:Filter><ogc:FeatureId fid="${escXml(fid)}"/></ogc:Filter>` +
      `</wfs:Delete>` +
      `</wfs:Transaction>`
    );
  };

  const executeTransactionXml = async ({ req, res, projectId, xmlText, returnFeature = null }) => {
    const project = findProjectById(projectId);
    if (!project || !project.file) {
      res.status(404).type('application/xml').send(wfsExceptionXml('Project not found', { code: 'NotFound' }));
      return;
    }

    const txRequireAdmin = String(process.env.WFS_TX_REQUIRE_ADMIN || 'false').toLowerCase() === 'true';
    const userRole = String(req.user?.role || '').toLowerCase();
    if (!req.user) {
      res.status(401).type('application/xml').send(wfsExceptionXml('Access Denied: Authentication required for transactions', { code: 'SecurityError' }));
      return;
    }
    if (txRequireAdmin && userRole !== 'admin') {
      res.status(403).type('application/xml').send(wfsExceptionXml('Access Denied: You must be admin to perform transactions', { code: 'SecurityError' }));
      return;
    }

    // Always bypass the in-memory cache here: the server runs as a cluster
    // and each worker has its own projectConfigCache. If the user toggles
    // a layer's `wfsEditable` flag in worker A, worker B's cache stays stale
    // and would incorrectly reject the transaction with "Layer not editable".
    const config = typeof readProjectConfig === 'function'
      ? (readProjectConfig(projectId, { useCache: false }) || {})
      : {};
    let tmpDir;
    try {
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qtiler-wfs-tx-'));
      const outFile = path.join(tmpDir, 'tx.xml');
      const result = await renderTileWithQueueRetry(tileRendererPool, {
        action: 'wfs_transaction',
        project_path: project.file,
        output_file: outFile,
        xml: String(xmlText || ''),
        layer_edit_config: config?.layers || {}
      });

      if (!result || result.status !== 'success') {
        const msg = result?.message || result?.error || 'transaction_failed';
        logTx(projectId, `WFS-T Transaction failed: ${String(msg)}`, 'error');
        res.status(500).type('application/xml').send(wfsExceptionXml(redactSecrets(String(msg))));
        return;
      }

      const inserted = Number(result?.inserted ?? 0);
      const updated = Number(result?.updated ?? 0);
      const deleted = Number(result?.deleted ?? 0);
      const errors = Array.isArray(result?.errors) ? result.errors : [];
      logTx(projectId, `WFS-T OK: ins=${inserted} upd=${updated} del=${deleted}`);
      if (errors.length) {
        res.status(400).type('application/xml').send(wfsExceptionXml(redactSecrets(errors.slice(0, 5).join(' | '))));
        return;
      }

      if (returnFeature && returnFeature.layerName) {
        let featureId = String(returnFeature.featureId || '').trim();
        if (!featureId && inserted > 0) {
          try {
            const txXml = await fs.promises.readFile(outFile, 'utf8');
            featureId = parseInsertedFeatureIdFromTxXml(txXml) || '';
          } catch {
            featureId = '';
          }
        }
        if (featureId && !featureId.includes('.')) {
          featureId = `${returnFeature.layerName}.${featureId}`;
        }

        let feature = null;
        if (featureId) {
          feature = await fetchFeatureById({
            projectFile: project.file,
            layerName: returnFeature.layerName,
            featureId,
            version: String(req.query?.VERSION || req.query?.version || '1.1.0'),
            srsName: returnFeature.srsName || null
          });
        }
        if (!feature && returnFeature.fallbackFeature && typeof returnFeature.fallbackFeature === 'object') {
          feature = normalizeFeatureGeometry({
            type: 'Feature',
            id: featureId || null,
            geometry: returnFeature.fallbackFeature.geometry || null,
            properties: returnFeature.fallbackFeature.properties || {}
          });
        }
        if (!feature || !feature.geometry || !feature.geometry.type) {
          res.status(422).json({ error: 'invalid_feature_geometry' });
          return;
        }

        res.setHeader('Cache-Control', 'no-store');
        res.type('application/json').send(JSON.stringify(feature));
        return;
      }

      res.setHeader('Cache-Control', 'no-store');
      res.type('application/xml');
      res.sendFile(outFile, async () => {
        try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
      });
      return;
    } catch (err) {
      try { if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
      const status = httpStatusForWorkerCode(err?.code);
      const code = owsCodeForWorkerCode(err?.code);
      applyRetryAfterHeader(res, status);
      res.status(status).type('application/xml').send(wfsExceptionXml(redactSecrets(String(err?.message || err)), { code }));
      return;
    }
  };

  const parseInsertedFeatureIdFromTxXml = (xmlText) => {
    const xml = String(xmlText || '');
    if (!xml) return null;
    const scoped = /<(?:\w+:)?(?:FeatureId|ResourceId)\b[^>]*>/gi;
    let m;
    while ((m = scoped.exec(xml)) !== null) {
      const tag = String(m[0] || '');
      const fidMatch = tag.match(/\b(?:fid|rid|id)\s*=\s*['"]([^'"]+)['"]/i);
      if (fidMatch && fidMatch[1]) return String(fidMatch[1]).trim();
    }
    const loose = xml.match(/\b(?:fid|rid|id)\s*=\s*['"]([^'"]+)['"]/i);
    return loose && loose[1] ? String(loose[1]).trim() : null;
  };

  const readFirstFeatureFromGeoJsonFile = async (filePath) => {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const firstRaw = parsed && parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)
      ? parsed.features[0]
      : (parsed && parsed.type === 'Feature' ? parsed : null);
    return normalizeFeatureGeometry(firstRaw);
  };

  const fetchFeatureById = async ({ projectFile, layerName, featureId, version, srsName }) => {
    let tmpDir;
    try {
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qtiler-wfs-feature-fetch-'));
      const outFile = path.join(tmpDir, 'feature.json');
      const result = await renderTileWithQueueRetry(tileRendererPool, {
        action: 'wfs_get_feature',
        project_path: projectFile,
        type_name: layerName,
        output_file: outFile,
        version: String(version || '1.1.0'),
        feature_id: featureId,
        max_features: 1,
        start_index: 0,
        srs_name: srsName || null,
        output_format: 'application/json'
      });
      if (!result || result.status !== 'success') return null;
      const first = await readFirstFeatureFromGeoJsonFile(outFile);
      if (!first || first.type !== 'Feature' || !first.geometry || !first.geometry.type) return null;
      return first;
    } catch {
      return null;
    } finally {
      try { if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
    }
  };

  const handleWfsKvp = async (req, res) => {
    const service = String(getQueryCI(req, 'SERVICE') || 'WFS').toUpperCase();
    if (service !== 'WFS') {
      res.status(400).type('application/xml').send(wfsExceptionXml('SERVICE must be WFS', { code: 'InvalidParameterValue' }));
      return;
    }

    const request = String(getQueryCI(req, 'REQUEST') || 'GetCapabilities').trim();
    const requestedVersion = String(getQueryCI(req, 'VERSION') || getQueryCI(req, 'version') || '').trim();
    const requestUpper = request.toUpperCase();

    const projectId = String(getQueryCI(req, 'project') || '').trim();
    if (!projectId) {
      res.status(400).type('application/xml').send(wfsExceptionXml('project is required', { code: 'MissingParameterValue' }));
      return;
    }

    const project = findProjectById(projectId);
    if (!project || !project.file) {
      res.status(404).type('application/xml').send(wfsExceptionXml('Project not found', { code: 'NotFound' }));
      return;
    }

    if (requestUpper === 'GETCAPABILITIES') {
      try {
        const list = await renderTileWithQueueRetry(tileRendererPool, {
          action: 'wfs_list',
          project_path: project.file
        });
        let featureTypes = Array.isArray(list?.featureTypes) ? list.featureTypes : [];

        // Optional: allow filtering capabilities to a single typename.
        const requestedType = normalizeTypeName(
          getQueryCI(req, 'TYPENAME') ||
          getQueryCI(req, 'TYPENAMES') ||
          getQueryCI(req, 'typename') ||
          getQueryCI(req, 'layer') ||
          getQueryCI(req, 'LAYER')
        );
        if (requestedType) {
          const reqSafe = safeXmlName(requestedType);
          const filtered = featureTypes.filter((ft) => {
            if (!ft) return false;
            const byName = safeXmlName(ft.name) === reqSafe;
            const byRaw = safeXmlName(ft.rawName || ft.title) === reqSafe;
            return byName || byRaw;
          });
          if (filtered.length) featureTypes = filtered;
        }

        const version = pickBestWfsVersion(
          getQueryCI(req, 'VERSION') || getQueryCI(req, 'version'),
          getQueryCI(req, 'ACCEPTVERSIONS') || getQueryCI(req, 'acceptversions')
        );
        const reqApiKey = String(
          getQueryCI(req, 'api_key') ||
          getQueryCI(req, 'apikey') ||
          getQueryCI(req, 'apiKey') ||
          getQueryCI(req, 'API_KEY') ||
          ''
        ).trim();
        let serviceUrl = `${getRequestBaseUrl(req)}/wfs?project=${encodeURIComponent(projectId)}`;
        // If capabilities were requested with api_key, propagate it in the
        // advertised OnlineResource URLs (GetFeature/Describe/Transaction).
        // QGIS WFS editing uses the Transaction POST endpoint from capabilities;
        // without this it sends follow-up requests unauthenticated and only
        // user/password auth appears to work.
        if (reqApiKey) {
          serviceUrl += `&api_key=${encodeURIComponent(reqApiKey)}`;
        }
        // Advertise the same default cap used by GetFeature to avoid client-side truncation surprises.
        const hardLimit = Number.parseInt(process.env.WFS_MAX_FEATURES_LIMIT || '5000000', 10) || 5000000;
        const countDefault = Number.parseInt(
          process.env.WFS_CAPABILITIES_COUNT_DEFAULT || '10000',
          10
        ) || hardLimit;
        const xml = buildCapabilitiesXml({ projectId, serviceUrl, featureTypes, version, defaultCount: countDefault });
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).type('text/xml').send(xml);
      } catch (err) {
        const status = httpStatusForWorkerCode(err?.code);
        const code = owsCodeForWorkerCode(err?.code);
        applyRetryAfterHeader(res, status);
        res.status(status).type('application/xml').send(wfsExceptionXml(redactSecrets(String(err?.message || err)), { code }));
      }
      return;
    }

    if (requestUpper === 'DESCRIBEFEATURETYPE') {
      const typeName = normalizeTypeName(getQueryCI(req, 'TYPENAME') || getQueryCI(req, 'TYPENAMES'));
      if (!typeName) {
        res.status(400).type('application/xml').send(wfsExceptionXml('TYPENAME is required', { code: 'MissingParameterValue' }));
        return;
      }
      let tmpDir;
      try {
        tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qtiler-wfs-xsd-'));
        const outFile = path.join(tmpDir, 'schema.xsd');
        const result = await renderTileWithQueueRetry(tileRendererPool, {
          action: 'wfs_describe',
          project_path: project.file,
          type_name: typeName,
          output_file: outFile,
          version: requestedVersion || null
        });
        if (!result || result.status !== 'success') {
          const msg = result?.message || result?.error || 'describe_failed';
          const status = httpStatusForWorkerCode(result?.code);
          const code = owsCodeForWorkerCode(result?.code);
          applyRetryAfterHeader(res, status);
          res.status(status).type('application/xml').send(wfsExceptionXml(String(msg), { code }));
          return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.type('application/xml');
        res.sendFile(outFile, async () => {
          try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
        });
      } catch (err) {
        try { if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
        const status = httpStatusForWorkerCode(err?.code);
        const code = owsCodeForWorkerCode(err?.code);
        applyRetryAfterHeader(res, status);
        res.status(status).type('application/xml').send(wfsExceptionXml(redactSecrets(String(err?.message || err)), { code }));
      }
      return;
    }

    if (requestUpper === 'GETFEATURE') {
      const typeName = normalizeTypeName(getQueryCI(req, 'TYPENAME') || getQueryCI(req, 'TYPENAMES'));
      if (!typeName) {
        res.status(400).type('application/xml').send(wfsExceptionXml('TYPENAME is required', { code: 'MissingParameterValue' }));
        return;
      }

      const bboxParsed = parseBbox(getQueryCI(req, 'BBOX'));
      const bbox = bboxParsed?.bbox || null;
      const bboxCrs = normalizeSrsName(bboxParsed?.crs) || null;
      const srsName = normalizeSrsName(getQueryCI(req, 'SRSNAME')) || normalizeSrsName(getQueryCI(req, 'CRS')) || bboxCrs || 'EPSG:3857';
      const requestedCountRaw = getQueryCI(req, 'MAXFEATURES') ?? getQueryCI(req, 'COUNT');
      const hasExplicitCount = requestedCountRaw != null && String(requestedCountRaw).trim() !== '';
      const requestedCount = clampInt(requestedCountRaw, { min: 1, max: 10_000_000, fallback: null });
      const wfsMaxHardLimit = Number.parseInt(process.env.WFS_MAX_FEATURES_LIMIT || '5000000', 10);
      const hardLimit = Number.isFinite(wfsMaxHardLimit) && wfsMaxHardLimit > 0 ? wfsMaxHardLimit : 5000000;
      const wfsAbsoluteLimit = Number.parseInt(process.env.WFS_MAX_FEATURES_ABSOLUTE_LIMIT || '10000000', 10);
      const absoluteLimit = Number.isFinite(wfsAbsoluteLimit) && wfsAbsoluteLimit > 0 ? wfsAbsoluteLimit : 10000000;
      const autoExpand = envFlag(process.env.WFS_AUTO_EXPAND_LIMIT, true);
      const effectiveHardLimit = autoExpand && requestedCount != null && requestedCount > hardLimit
        ? Math.min(requestedCount, Math.max(hardLimit, absoluteLimit))
        : hardLimit;
      const maxFeatures = hasExplicitCount
        ? clampInt(requestedCountRaw, { min: 1, max: effectiveHardLimit, fallback: effectiveHardLimit })
        : null;
      const startIndex = clampInt(getQueryCI(req, 'STARTINDEX'), { min: 0, max: 10_000_000, fallback: 0 });
      const featureIdRaw = getQueryCI(req, 'FEATUREID') || getQueryCI(req, 'featureId');
      const outputFormatRaw = String(getQueryCI(req, 'OUTPUTFORMAT') || '').trim();
      const outputFormat = outputFormatRaw ? outputFormatRaw.split(';')[0].trim().toLowerCase() : '';

      const asJson = outputFormat.includes('json') || outputFormat === 'application/json' || outputFormat === 'geojson';
      const contentType = asJson ? 'application/json' : 'application/xml';
      const ext = asJson ? 'json' : 'xml';

      let tmpDir;
      try {
        tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qtiler-wfs-feature-'));
        const outFile = path.join(tmpDir, `features.${ext}`);

        const result = await renderTileWithQueueRetry(tileRendererPool, {
          action: 'wfs_get_feature',
          project_path: project.file,
          type_name: typeName,
          output_file: outFile,
          version: requestedVersion || null,
          feature_id: featureIdRaw ? String(featureIdRaw).trim() : null,
          bbox,
          srs_name: srsName,
          max_features: maxFeatures,
          hard_limit_override: hasExplicitCount ? effectiveHardLimit : null,
          start_index: startIndex,
          output_format: asJson ? 'application/json' : 'application/gml+xml'
        });

        if (!result || result.status !== 'success') {
          const msg = result?.message || result?.error || 'get_feature_failed';
          const status = httpStatusForWorkerCode(result?.code);
          const code = owsCodeForWorkerCode(result?.code);
          applyRetryAfterHeader(res, status);
          res.status(status).type('application/xml').send(wfsExceptionXml(String(msg), { code }));
          return;
        }

        res.setHeader('Cache-Control', 'no-store');
        res.type(contentType);
        if (asJson) {
           fs.promises.readFile(outFile, 'utf8').then(raw => {
             try {
               const parsed = JSON.parse(raw);
               const force2D = (obj) => {
                 if (!obj || typeof obj !== 'object') return;
                 if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
                   obj.features.forEach(force2D);
                 } else if (obj.type === 'Feature' && obj.geometry) {
                   force2D(obj.geometry);
                 } else if (obj.type && obj.coordinates) {
                   const wipeZ = (coords) => {
                     if (!Array.isArray(coords)) return;
                     if (coords.length > 0 && typeof coords[0] === 'number') {
                       while(coords.length > 2) coords.pop();
                     } else {
                       coords.forEach(wipeZ);
                     }
                   };
                   wipeZ(obj.coordinates);
                 }
               };
               force2D(parsed);
               if (srsName && srsName.toUpperCase().startsWith('EPSG:')) {
                 if (!parsed.crs) {
                   parsed.crs = {
                     type: 'name',
                     properties: { name: `urn:ogc:def:crs:EPSG::${srsName.substring(5)}` }
                   };
                 }
               }
               res.send(JSON.stringify(parsed));
             } catch(err) {
               res.send(raw);
             } finally {
               try { fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
             }
           });
        } else {
          res.sendFile(outFile, async () => {
            try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
          });
        }
      } catch (err) {
        try { if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
        const status = httpStatusForWorkerCode(err?.code);
        const code = owsCodeForWorkerCode(err?.code);
        applyRetryAfterHeader(res, status);
        res.status(status).type('application/xml').send(wfsExceptionXml(redactSecrets(String(err?.message || err)), { code }));
      }
      return;
    }

    res.status(400).type('application/xml').send(wfsExceptionXml(`Unsupported REQUEST: ${request}`, { code: 'OperationNotSupported' }));
  };

  const parseKvpBody = (raw) => {
    const out = {};
    const text = typeof raw === 'string' ? raw : (Buffer.isBuffer(raw) ? raw.toString('utf8') : '');
    if (!text || !text.trim()) return out;
    try {
      const params = new URLSearchParams(text);
      for (const [k, v] of params.entries()) {
        if (!k) continue;
        if (out[k] == null) out[k] = v;
      }
    } catch {
      // ignore
    }
    return out;
  };

  const parseWfsXmlToQuery = (xmlText) => {
    const xml = String(xmlText || '').trim();
    if (!xml || !xml.startsWith('<')) return null;

    const rootMatch = xml.match(/<\s*([A-Za-z_][\w:.-]*)\b[^>]*>/);
    const rootTag = rootMatch ? rootMatch[1] : '';
    const rootLocal = rootTag ? rootTag.split(':').pop() : '';
    const rootUpper = String(rootLocal || '').toUpperCase();

    const attr = (name) => {
      const m = xml.match(new RegExp(`\\b${name}\\s*=\\s*['\"]([^'\"]+)['\"]`, 'i'));
      return m ? m[1] : null;
    };

    const bodyQuery = {};
    const service = attr('service') || 'WFS';
    const version = attr('version') || null;
    if (service) bodyQuery.SERVICE = service;
    if (version) bodyQuery.VERSION = version;

    if (rootUpper === 'TRANSACTION') {
      return { isTransaction: true, query: bodyQuery };
    }

    if (rootUpper === 'GETFEATURE') {
      bodyQuery.REQUEST = 'GetFeature';
      const typeName = (() => {
        const m = xml.match(/<\s*(?:\w+:)?Query\b[^>]*\btypeNames?\s*=\s*['\"]([^'\"]+)['\"]/i);
        if (m) return m[1];
        return attr('typeName') || attr('typeNames');
      })();
      if (typeName) bodyQuery.TYPENAME = typeName;
      const srsName = attr('srsName');
      if (srsName) bodyQuery.SRSNAME = srsName;
      const outputFormat = attr('outputFormat');
      if (outputFormat) bodyQuery.OUTPUTFORMAT = outputFormat;
      const maxFeatures = attr('maxFeatures') || attr('count');
      if (maxFeatures) bodyQuery.MAXFEATURES = maxFeatures;

      const fidMatch = xml.match(/<\s*(?:\w+:)?FeatureId\b[^>]*\bfid\s*=\s*['"]([^'"]+)['"]/i);
      if (fidMatch && fidMatch[1]) {
        bodyQuery.FEATUREID = fidMatch[1];
      }

      // Best-effort BBOX support via gml:Envelope
      try {
        const env = xml.match(/<\s*(?:\w+:)?Envelope\b[^>]*>[\s\S]*?<\s*(?:\w+:)?lowerCorner\b[^>]*>\s*([\-\d.eE]+)\s+([\-\d.eE]+)\s*<\/[\s\S]*?<\s*(?:\w+:)?upperCorner\b[^>]*>\s*([\-\d.eE]+)\s+([\-\d.eE]+)\s*<\//i);
        if (env) {
          bodyQuery.BBOX = `${env[1]},${env[2]},${env[3]},${env[4]}`;
        }
      } catch {
        // ignore
      }

      return { isTransaction: false, query: bodyQuery };
    }

    if (rootUpper === 'DESCRIBEFEATURETYPE') {
      bodyQuery.REQUEST = 'DescribeFeatureType';
      const typeName = attr('typeName') || attr('typeNames');
      if (typeName) bodyQuery.TYPENAME = typeName;
      return { isTransaction: false, query: bodyQuery };
    }

    if (rootUpper === 'GETCAPABILITIES') {
      bodyQuery.REQUEST = 'GetCapabilities';
      return { isTransaction: false, query: bodyQuery };
    }

    return { isTransaction: false, query: null };
  };

  const normalizeLayerToken = (value) => {
    const raw = String(value || '').normalize('NFKD').trim();
    if (!raw) return '';
    return raw.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  };

  const resolveDatasetRef = (datasetRef) => {
    const raw = String(datasetRef || '').trim().replace(/^\/+|\/+$/g, '');
    if (!raw || raw.toLowerCase() === 'undefined') return null;
    const dot = raw.indexOf('.');
    if (dot < 0) return { projectId: raw, layerName: '' };

    const projectId = raw.slice(0, dot).trim();
    const layerToken = raw.slice(dot + 1).trim();
    if (!projectId) return null;
    if (!layerToken) return { projectId, layerName: '' };

    let layerName = layerToken;
    try {
      const project = typeof findProjectById === 'function' ? findProjectById(projectId) : null;
      const cfg = project ? readProjectConfig(project) : null;
      const layers = Array.isArray(cfg?.layers) ? cfg.layers : [];
      const tokenNorm = normalizeLayerToken(layerToken);
      const hit = layers.find((l) => {
        const name = String(l?.name || '').trim();
        if (!name) return false;
        if (name === layerToken) return true;
        return normalizeLayerToken(name) === tokenNorm;
      });
      if (hit?.name) {
        layerName = String(hit.name);
      }
    } catch {
      // Keep raw token when project config cannot be loaded.
    }

    return { projectId, layerName };
  };

  const buildCompatWfsQuery = (req, datasetRef, featureId = null) => {
    const resolved = resolveDatasetRef(datasetRef);
    if (!resolved || !resolved.projectId || !resolved.layerName) return null;

    const out = {
      ...(req.query || {}),
      SERVICE: 'WFS',
      REQUEST: 'GetFeature',
      VERSION: String(req.query?.VERSION || req.query?.version || '1.1.0'),
      OUTPUTFORMAT: req.query?.OUTPUTFORMAT || req.query?.outputFormat || req.query?.outputformat || 'application/json',
      project: resolved.projectId,
      TYPENAME: resolved.layerName,
      SRSNAME: req.query?.CRS || req.query?.crs || req.query?.SRSNAME || req.query?.srsname || req.query?.srsName || 'EPSG:3857'
    };

    if (featureId != null && String(featureId).trim()) {
      const fid = String(featureId).trim();
      out.FEATUREID = fid.includes('.') ? fid : `${resolved.layerName}.${fid}`;
      delete out.BBOX;
      delete out.bbox;
    }

    return out;
  };

  const inferGeoJsonTypeFromCoordinates = (coordinates) => {
    if (!Array.isArray(coordinates)) return null;
    const c0 = coordinates[0];
    if (typeof c0 === 'number') return 'Point';
    if (!Array.isArray(c0)) return null;
    const c1 = c0[0];
    if (typeof c1 === 'number') return 'LineString';
    if (!Array.isArray(c1)) return null;
    const c2 = c1[0];
    if (typeof c2 === 'number') return 'Polygon';
    if (!Array.isArray(c2)) return null;
    const c3 = c2[0];
    if (typeof c3 === 'number') return 'MultiPolygon';
    if (Array.isArray(c3)) return 'GeometryCollection';
    return null;
  };

  const normalizeFeatureGeometry = (feature) => {
    if (!feature || feature.type !== 'Feature') return feature;
    const geom = feature.geometry;
    if (!geom || typeof geom !== 'object') return feature;
    if (geom.type) return feature;
    const inferred = inferGeoJsonTypeFromCoordinates(geom.coordinates);
    if (!inferred || inferred === 'GeometryCollection') return feature;
    return { ...feature, geometry: { ...geom, type: inferred } };
  };

  app.get('/wfs/:dataset/', async (req, res) => {
    console.log('[DEBUG-GET-WFS]', req.originalUrl);
    const mergedReq = {
      ...req,
      query: buildCompatWfsQuery(req, req.params.dataset)
    };
    if (!mergedReq.query) {
      res.status(400).type('application/xml').send(wfsExceptionXml('Invalid dataset reference', { code: 'InvalidParameterValue' }));
      return;
    }
    return handleWfsKvp(mergedReq, res);
  });

  app.get('/wfs/:dataset/:featureId', async (req, res) => {
    console.log('[DEBUG-GET-WFS-ID]', req.originalUrl);
    const resolved = resolveDatasetRef(req.params.dataset);
    const featureId = String(req.params.featureId || '').trim();
    if (!resolved || !resolved.projectId || !resolved.layerName) {
      res.status(400).type('application/xml').send(wfsExceptionXml('Invalid dataset reference', { code: 'InvalidParameterValue' }));
      return;
    }
    if (!featureId) {
      res.status(400).type('application/xml').send(wfsExceptionXml('feature id is required', { code: 'MissingParameterValue' }));
      return;
    }

    const project = findProjectById(resolved.projectId);
    if (!project || !project.file) {
      res.status(404).type('application/xml').send(wfsExceptionXml('Project not found', { code: 'NotFound' }));
      return;
    }

    let tmpDir;
    try {
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qtiler-wfs-feature-id-'));
      const outFile = path.join(tmpDir, 'feature.json');
      const fidValue = featureId.includes('.') ? featureId : `${resolved.layerName}.${featureId}`;
      const srsName = normalizeSrsName(getQueryCI(req, 'SRSNAME')) || normalizeSrsName(getQueryCI(req, 'crs')) || null;

      const result = await renderTileWithQueueRetry(tileRendererPool, {
        action: 'wfs_get_feature',
        project_path: project.file,
        type_name: resolved.layerName,
        output_file: outFile,
        version: String(req.query?.VERSION || req.query?.version || '1.1.0'),
        feature_id: fidValue,
        max_features: 1,
        start_index: 0,
        srs_name: srsName,
        output_format: 'application/json'
      });

      if (!result || result.status !== 'success') {
        const msg = result?.message || result?.error || 'get_feature_failed';
        const status = httpStatusForWorkerCode(result?.code);
        const code = owsCodeForWorkerCode(result?.code);
        applyRetryAfterHeader(res, status);
        res.status(status).type('application/xml').send(wfsExceptionXml(String(msg), { code }));
        return;
      }

      const raw = await fs.promises.readFile(outFile, 'utf8');
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }

      const firstRaw = parsed && parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)
        ? parsed.features[0]
        : null;
      const first = normalizeFeatureGeometry(firstRaw);
      if (!first || first.type !== 'Feature') {
        res.status(404).json({ error: 'feature_not_found' });
        return;
      }
      if (!first.geometry || !first.geometry.type) {
        res.status(422).json({ error: 'invalid_feature_geometry' });
        return;
      }

      res.setHeader('Cache-Control', 'no-store');
      const force2D = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
          obj.features.forEach(force2D);
        } else if (obj.type === 'Feature' && obj.geometry) {
          force2D(obj.geometry);
        } else if (obj.type && obj.coordinates) {
          const wipeZ = (coords) => {
            if (!Array.isArray(coords)) return;
            if (coords.length > 0 && typeof coords[0] === 'number') {
              while(coords.length > 2) coords.pop();
            } else {
              coords.forEach(wipeZ);
            }
          };
          wipeZ(obj.coordinates);
        }
      };
      force2D(first);
      if (srsName && srsName.toUpperCase().startsWith('EPSG:')) {
        if (!first.crs) {
          first.crs = {
            type: 'name',
            properties: { name: `urn:ogc:def:crs:EPSG::${srsName.substring(5)}` }
          };
        }
      }
      res.type('application/json').send(JSON.stringify(first));
    } catch (err) {
      res.status(500).type('application/xml').send(wfsExceptionXml(redactSecrets(String(err?.message || err))));
    } finally {
      try { if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  app.post('/wfs/:dataset/multipart', multipartUpload.any(), async (req, res) => {
    const resolved = resolveDatasetRef(req.params.dataset);
    if (!resolved || !resolved.projectId || !resolved.layerName) {
      res.status(400).type('application/xml').send(wfsExceptionXml('Invalid dataset reference', { code: 'InvalidParameterValue' }));
      return;
    }
    const feature = parseMultipartFeaturePayload(req.body || {});
    const xml = buildInsertTransactionXml({
      projectId: resolved.projectId,
      layerName: resolved.layerName,
      feature
    });
    return executeTransactionXml({
      req,
      res,
      projectId: resolved.projectId,
      xmlText: xml,
      returnFeature: {
        layerName: resolved.layerName,
        srsName: normalizeSrsName(getQueryCI(req, 'SRSNAME')) || normalizeSrsName(getQueryCI(req, 'crs')) || null,
        fallbackFeature: feature
      }
    });
  });

  app.put('/wfs/:dataset/multipart/:featureId', multipartUpload.any(), async (req, res) => {
    const resolved = resolveDatasetRef(req.params.dataset);
    if (!resolved || !resolved.projectId || !resolved.layerName) {
      res.status(400).type('application/xml').send(wfsExceptionXml('Invalid dataset reference', { code: 'InvalidParameterValue' }));
      return;
    }
    const featureId = String(req.params.featureId || '').trim();
    if (!featureId) {
      res.status(400).type('application/xml').send(wfsExceptionXml('feature id is required', { code: 'MissingParameterValue' }));
      return;
    }
    const feature = parseMultipartFeaturePayload(req.body || {});
    const xml = buildUpdateTransactionXml({
      projectId: resolved.projectId,
      layerName: resolved.layerName,
      featureId,
      feature
    });
    return executeTransactionXml({
      req,
      res,
      projectId: resolved.projectId,
      xmlText: xml,
      returnFeature: {
        layerName: resolved.layerName,
        featureId,
        srsName: normalizeSrsName(getQueryCI(req, 'SRSNAME')) || normalizeSrsName(getQueryCI(req, 'crs')) || null,
        fallbackFeature: feature
      }
    });
  });

  app.delete('/wfs/:dataset/:featureId', async (req, res) => {
    const resolved = resolveDatasetRef(req.params.dataset);
    if (!resolved || !resolved.projectId || !resolved.layerName) {
      res.status(400).type('application/xml').send(wfsExceptionXml('Invalid dataset reference', { code: 'InvalidParameterValue' }));
      return;
    }
    const featureId = String(req.params.featureId || '').trim();
    if (!featureId) {
      res.status(400).type('application/xml').send(wfsExceptionXml('feature id is required', { code: 'MissingParameterValue' }));
      return;
    }
    const xml = buildDeleteTransactionXml({
      projectId: resolved.projectId,
      layerName: resolved.layerName,
      featureId
    });
    return executeTransactionXml({ req, res, projectId: resolved.projectId, xmlText: xml });
  });

  app.get('/wfs', ensureProjectAccessFromQuery('project'), handleWfsKvp);

  // Support POST for non-transaction operations (QGIS defaults to POST for WFS).
  // ===========================================================================
  // MANEJO UNIFICADO DE POST (GetFeature KVP y WFS-T Transaction)
  // ===========================================================================
  app.post('/wfs', ensureProjectAccessFromQuery('project'), async (req, res) => {
    
    // 1. Obtener el cuerpo crudo y limpiarlo
    const rawBody = typeof req.body === 'string'
      ? req.body
      : (Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '');

    const trimmed = String(rawBody || '').trim().replace(/^\uFEFF/, '');
    
    // 2. Intentar parsear XML para ver qué operación es
    let parsedXml = null;
    if (trimmed && trimmed.startsWith('<')) {
      console.log('[DEBUG-POST-WFS-RAW]', trimmed);
      parsedXml = parseWfsXmlToQuery(trimmed);
    }

    // =======================================================================
    // CASO A: ES UNA TRANSACCIÓN (EDITAR)
    // =======================================================================
    if (parsedXml?.isTransaction) {
      console.log(`[WFS] Transacción detectada para proyecto: ${req.query.project}`);

      // A1. VERIFICACIÓN DE PERMISOS MANUAL
      // ensureProjectAccessFromQuery('project') ya validó acceso al proyecto.
      // Para WFS-T exigimos sesión autenticada y, opcionalmente, rol admin si la instancia lo requiere.
      const projectId = String(getQueryCI(req, 'project') || '').trim();
      return executeTransactionXml({ req, res, projectId, xmlText: trimmed });
    }

    // =======================================================================
    // CASO B: ES UNA PETICIÓN XML NORMAL (GetFeature via POST)
    // =======================================================================
    if (parsedXml?.query) {
      const mergedReq = {
        ...req,
        query: { ...(req.query || {}), ...(parsedXml.query || {}) }
      };
      return handleWfsKvp(mergedReq, res);
    }

    // =======================================================================
    // CASO C: ES FORM-URLENCODED (KVP en body)
    // =======================================================================
    const bodyParams = parseKvpBody(trimmed);
    if (Object.keys(bodyParams).length) {
      const mergedReq = {
        ...req,
        query: { ...(req.query || {}), ...bodyParams }
      };
      return handleWfsKvp(mergedReq, res);
    }

    // Si no es nada de lo anterior, intentar tratar como GET con query params
    return handleWfsKvp(req, res);
  });
};
