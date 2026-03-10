/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

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
    
    // CAMBIO 1: Ponemos 1.1.0 primero en la lista de soportados
    const supported = ['1.1.0', '2.0.0']; 
    
    for (const candidate of supported) {
      if (accepts.some((a) => a === candidate || a.startsWith(candidate))) return candidate;
    }
    
    // CAMBIO 2: El fallback por defecto ahora es 1.1.0
    return process.env.WFS_CAPABILITIES_DEFAULT_VERSION || '1.1.0';
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

  const handleWfsKvp = async (req, res) => {
    const service = String(getQueryCI(req, 'SERVICE') || 'WFS').toUpperCase();
    if (service !== 'WFS') {
      res.status(400).type('application/xml').send(wfsExceptionXml('SERVICE must be WFS', { code: 'InvalidParameterValue' }));
      return;
    }

    const request = String(getQueryCI(req, 'REQUEST') || 'GetCapabilities').trim();
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
        const list = await tileRendererPool.renderTile({
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
        const serviceUrl = `${req.protocol}://${req.get('host')}/wfs?project=${encodeURIComponent(projectId)}`;
        // Advertise the same default cap used by GetFeature to avoid client-side truncation surprises.
        const hardLimit = Number.parseInt(process.env.WFS_MAX_FEATURES_LIMIT || '50000', 10) || 50000;
        const countDefault = Number.parseInt(
          process.env.WFS_CAPABILITIES_COUNT_DEFAULT || process.env.WFS_DEFAULT_MAX_FEATURES || String(hardLimit),
          10
        ) || hardLimit;
        const xml = buildCapabilitiesXml({ projectId, serviceUrl, featureTypes, version, defaultCount: countDefault });
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).type('text/xml').send(xml);
      } catch (err) {
        res.status(500).type('application/xml').send(wfsExceptionXml(redactSecrets(String(err?.message || err))));
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
        const result = await tileRendererPool.renderTile({
          action: 'wfs_describe',
          project_path: project.file,
          type_name: typeName,
          output_file: outFile
        });
        if (!result || result.status !== 'success') {
          const msg = result?.message || result?.error || 'describe_failed';
          const status = httpStatusForWorkerCode(result?.code);
          const code = owsCodeForWorkerCode(result?.code);
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
        res.status(500).type('application/xml').send(wfsExceptionXml(redactSecrets(String(err?.message || err))));
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
      const srsName = normalizeSrsName(getQueryCI(req, 'SRSNAME')) || bboxCrs;
      const requestedCountRaw = getQueryCI(req, 'MAXFEATURES') ?? getQueryCI(req, 'COUNT');
      const requestedCount = clampInt(requestedCountRaw, { min: 1, max: 10_000_000, fallback: null });
      const wfsMaxHardLimit = Number.parseInt(process.env.WFS_MAX_FEATURES_LIMIT || '50000', 10);
      const hardLimit = Number.isFinite(wfsMaxHardLimit) && wfsMaxHardLimit > 0 ? wfsMaxHardLimit : 50000;
      const wfsAbsoluteLimit = Number.parseInt(process.env.WFS_MAX_FEATURES_ABSOLUTE_LIMIT || '250000', 10);
      const absoluteLimit = Number.isFinite(wfsAbsoluteLimit) && wfsAbsoluteLimit > 0 ? wfsAbsoluteLimit : 250000;
      const autoExpand = envFlag(process.env.WFS_AUTO_EXPAND_LIMIT, true);
      const effectiveHardLimit = autoExpand && requestedCount != null && requestedCount > hardLimit
        ? Math.min(requestedCount, Math.max(hardLimit, absoluteLimit))
        : hardLimit;
      const wfsDefaultMax = Number.parseInt(process.env.WFS_DEFAULT_MAX_FEATURES || String(hardLimit), 10);
      const fallback = Number.isFinite(wfsDefaultMax) && wfsDefaultMax > 0
        ? Math.min(wfsDefaultMax, effectiveHardLimit)
        : effectiveHardLimit;
      const maxFeatures = clampInt(requestedCountRaw, { min: 1, max: effectiveHardLimit, fallback });
      const startIndex = clampInt(getQueryCI(req, 'STARTINDEX'), { min: 0, max: 10_000_000, fallback: 0 });
      const outputFormatRaw = String(getQueryCI(req, 'OUTPUTFORMAT') || '').trim();
      const outputFormat = outputFormatRaw ? outputFormatRaw.split(';')[0].trim().toLowerCase() : '';

      const asJson = outputFormat.includes('json') || outputFormat === 'application/json' || outputFormat === 'geojson';
      const contentType = asJson ? 'application/json' : 'application/xml';
      const ext = asJson ? 'json' : 'xml';

      let tmpDir;
      try {
        tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qtiler-wfs-feature-'));
        const outFile = path.join(tmpDir, `features.${ext}`);

        const result = await tileRendererPool.renderTile({
          action: 'wfs_get_feature',
          project_path: project.file,
          type_name: typeName,
          output_file: outFile,
          bbox,
          srs_name: srsName,
          max_features: maxFeatures,
          hard_limit_override: effectiveHardLimit,
          start_index: startIndex,
          output_format: asJson ? 'application/json' : 'application/gml+xml'
        });

        if (!result || result.status !== 'success') {
          const msg = result?.message || result?.error || 'get_feature_failed';
          const status = httpStatusForWorkerCode(result?.code);
          const code = owsCodeForWorkerCode(result?.code);
          res.status(status).type('application/xml').send(wfsExceptionXml(String(msg), { code }));
          return;
        }

        res.setHeader('Cache-Control', 'no-store');
        res.type(contentType);
        res.sendFile(outFile, async () => {
          try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
        });
      } catch (err) {
        try { if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
        res.status(500).type('application/xml').send(wfsExceptionXml(redactSecrets(String(err?.message || err))));
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
      const txRequireAdmin = String(process.env.WFS_TX_REQUIRE_ADMIN || 'false').toLowerCase() === 'true';
      const userRole = String(req.user?.role || '').toLowerCase();

      if (!req.user) {
        console.error('[WFS] Bloqueado: Transacción sin usuario autenticado');
        res.status(401).type('application/xml').send(wfsExceptionXml('Access Denied: Authentication required for transactions', { code: 'SecurityError' }));
        return;
      }

      if (txRequireAdmin && userRole !== 'admin') {
        console.error('[WFS] Bloqueado: Transacción requiere admin (WFS_TX_REQUIRE_ADMIN=true)');
        res.status(403).type('application/xml').send(wfsExceptionXml('Access Denied: You must be admin to perform transactions', { code: 'SecurityError' }));
        return;
      }

      // A2. LÓGICA DE TRANSACCIÓN (Tu código original movido aquí)
      const projectId = String(getQueryCI(req, 'project') || '').trim();
      const project = findProjectById(projectId);
      if (!project || !project.file) {
        return res.status(404).type('application/xml').send(wfsExceptionXml('Project not found', { code: 'NotFound' }));
      }

      const config = typeof readProjectConfig === 'function' ? (readProjectConfig(projectId) || {}) : {};
      
      let tmpDir;
      try {
        tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qtiler-wfs-tx-'));
        const outFile = path.join(tmpDir, 'tx.xml');
        
        // Ejecutar el worker
        const result = await tileRendererPool.renderTile({
          action: 'wfs_transaction',
          project_path: project.file,
          output_file: outFile,
          xml: trimmed, // Usamos el XML limpio
          layer_edit_config: config?.layers || {}
        });

        if (!result || result.status !== 'success') {
          const msg = result?.message || result?.error || 'transaction_failed';
          logTx(projectId, `WFS-T Transaction failed: ${String(msg)}`, 'error');
          return res.status(500).type('application/xml').send(wfsExceptionXml(redactSecrets(String(msg))));
        }

        // Logs de éxito
        const inserted = Number(result?.inserted ?? 0);
        const updated = Number(result?.updated ?? 0);
        const deleted = Number(result?.deleted ?? 0);
        const errors = Array.isArray(result?.errors) ? result.errors : [];
        logTx(projectId, `WFS-T OK: ins=${inserted} upd=${updated} del=${deleted}`);

        if (errors.length) {
           return res.status(400).type('application/xml').send(wfsExceptionXml(redactSecrets(errors.slice(0, 5).join(' | '))));
        }

        // Enviar respuesta
        res.setHeader('Cache-Control', 'no-store');
        res.type('application/xml');
        res.sendFile(outFile, async () => {
          try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
        });
        return;

      } catch (err) {
        try { if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
        console.error('[WFS] Error en transacción:', err);
        return res.status(500).type('application/xml').send(wfsExceptionXml(redactSecrets(String(err?.message || err))));
      }
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
