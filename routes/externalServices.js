/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2026 MundoGIS.
 */

import dns from 'dns/promises';
import net from 'net';
import path from 'path';
import { Readable } from 'stream';
import { XMLParser } from 'fast-xml-parser';
import { createJsonStore } from '../lib/jsonStore.js';

const SOURCE_TYPES = new Set(['xyz', 'wms', 'wmts']);
const SAFE_RESPONSE_HEADERS = ['cache-control', 'content-encoding', 'content-language', 'content-type', 'etag', 'expires', 'last-modified'];
const BLOCKED_QUERY_KEYS = new Set(['url', 'target', 'upstream', 'host']);
const PROTECTED_QUERY_KEYS = new Set(['api_key', 'apikey', 'api-key', 'key', 'token', 'access_token', 'subscription-key']);
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
const MAX_CAPABILITIES_BYTES = 5 * 1024 * 1024;

const cleanId = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^-+|-+$/g, '');

const inferSourceType = (rawUrl, typeHint = '') => {
  const hint = String(typeHint || '').trim().toLowerCase();
  if (SOURCE_TYPES.has(hint)) return hint;
  const value = String(rawUrl || '').trim();
  if (/\{(?:z|x|y)\}/i.test(value)) return 'xyz';
  try {
    const parsed = new URL(value);
    const serviceEntry = Array.from(parsed.searchParams.entries()).find(([key]) => String(key).toLowerCase() === 'service');
    const service = String(serviceEntry?.[1] || '').toLowerCase();
    if (service === 'wmts' || service === 'wms') return service;
    const pathName = parsed.pathname.toLowerCase();
    if (/(?:^|\/)wmts(?:\/|$)/.test(pathName)) return 'wmts';
    if (/(?:^|\/)wms(?:\/|$)/.test(pathName)) return 'wms';
  } catch {}
  return 'xyz';
};

const asArray = (value) => value == null ? [] : (Array.isArray(value) ? value : [value]);
const nodeText = (value) => String(value && typeof value === 'object' ? (value['#text'] ?? '') : (value ?? '')).trim();
const normalizeProjection = (value) => {
  const raw = nodeText(value);
  const epsg = raw.match(/EPSG(?::|\/|::|%3A)+(\d+)/i) || raw.match(/EPSG[^0-9]+(\d+)/i);
  return epsg ? `EPSG:${epsg[1]}` : raw;
};

const parseWmsLayers = (layer, inheritedCrs = []) => {
  if (!layer || typeof layer !== 'object') return [];
  const crs = Array.from(new Set([
    ...asArray(layer.CRS).map(normalizeProjection),
    ...asArray(layer.SRS).flatMap((item) => nodeText(item).split(/\s+/).map(normalizeProjection)),
    ...inheritedCrs
  ].filter(Boolean)));
  const name = nodeText(layer.Name);
  const current = name ? [{
    id: name,
    title: nodeText(layer.Title) || name,
    projection: crs[0] || 'EPSG:3857',
    projections: crs,
    matrixSets: []
  }] : [];
  return current.concat(asArray(layer.Layer).flatMap((child) => parseWmsLayers(child, crs)));
};

const parseCapabilities = (xml, typeHint = '') => {
  const document = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: true }).parse(String(xml || ''));
  const wmtsRoot = document.Capabilities && document.Capabilities.Contents ? document.Capabilities : null;
  const wmsRoot = document.WMS_Capabilities || document.WMT_MS_Capabilities || null;
  const type = wmtsRoot ? 'wmts' : (wmsRoot ? 'wms' : inferSourceType('', typeHint));
  if (type === 'wms' && wmsRoot) {
    const layers = asArray(wmsRoot.Capability?.Layer).flatMap((layer) => parseWmsLayers(layer));
    return {
      type,
      title: nodeText(wmsRoot.Service?.Title),
      version: String(wmsRoot['@_version'] || ''),
      formats: asArray(wmsRoot.Capability?.Request?.GetMap?.Format).map(nodeText).filter(Boolean),
      layers,
      matrixSets: []
    };
  }
  if (type === 'wmts' && wmtsRoot) {
    const matrixSets = asArray(wmtsRoot.Contents?.TileMatrixSet).map((item) => ({
      id: nodeText(item.Identifier),
      title: nodeText(item.Title) || nodeText(item.Identifier),
      projection: normalizeProjection(item.SupportedCRS) || 'EPSG:3857'
    })).filter((item) => item.id);
    const matrixSetById = new Map(matrixSets.map((item) => [item.id, item]));
    const layers = asArray(wmtsRoot.Contents?.Layer).map((item) => {
      const linkedIds = asArray(item.TileMatrixSetLink).map((link) => nodeText(link.TileMatrixSet)).filter(Boolean);
      const linkedSets = linkedIds.map((id) => matrixSetById.get(id) || { id, title: id, projection: '' });
      return {
        id: nodeText(item.Identifier),
        title: nodeText(item.Title) || nodeText(item.Identifier),
        projection: linkedSets.find((entry) => entry.projection)?.projection || 'EPSG:3857',
        projections: Array.from(new Set(linkedSets.map((entry) => entry.projection).filter(Boolean))),
        matrixSets: linkedSets,
        formats: asArray(item.Format).map(nodeText).filter(Boolean)
      };
    }).filter((item) => item.id);
    return { type, title: nodeText(wmtsRoot.ServiceIdentification?.Title), version: String(wmtsRoot['@_version'] || ''), layers, matrixSets };
  }
  throw new Error('invalid_capabilities_document');
};

const isPrivateIp = (address) => {
  const value = String(address || '').toLowerCase().split('%')[0];
  if (net.isIPv4(value)) {
    const parts = value.split('.').map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || parts[0] === 0
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
      || parts[0] >= 224;
  }
  if (net.isIPv6(value)) {
    return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') || value.startsWith('::ffff:');
  }
  return true;
};

const isUnsafeResolvedIp = (address) => {
  const value = String(address || '').toLowerCase().split('%')[0];
  if (net.isIPv4(value)) {
    const parts = value.split('.').map(Number);
    return parts[0] === 0
      || (parts[0] === 169 && parts[1] === 254)
      || parts[0] >= 224;
  }
  if (net.isIPv6(value)) {
    if (value === '::' || /^fe[89ab]/.test(value)) return true;
    if (value.startsWith('::ffff:')) return isUnsafeResolvedIp(value.slice('::ffff:'.length));
    return false;
  }
  return true;
};

const assertSafeUrl = async (rawUrl) => {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error('invalid_upstream_url'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid_upstream_protocol');
  if (parsed.username || parsed.password) throw new Error('upstream_credentials_not_allowed');
  const addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isUnsafeResolvedIp(entry.address))) throw new Error('private_upstream_not_allowed');
  return parsed;
};

const normalizeStringMap = (value) => Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {})
  .map(([key, item]) => [String(key).trim(), String(item ?? '').trim()])
  .filter(([key]) => key));

const extractProtectedQuery = (rawUrl, query) => {
  const protectedQuery = { ...(query || {}) };
  let cleanUrl = String(rawUrl || '').trim();
  try {
    const parsed = new URL(cleanUrl);
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (!PROTECTED_QUERY_KEYS.has(key.toLowerCase())) continue;
      protectedQuery[key] = parsed.searchParams.get(key) || '';
      parsed.searchParams.delete(key);
    }
    cleanUrl = parsed.toString().replace(/%7B/gi, '{').replace(/%7D/gi, '}');
  } catch {}
  return { url: cleanUrl, query: protectedQuery };
};

const normalizeSource = (value, previous = null) => {
  const input = value && typeof value === 'object' ? value : {};
  const id = cleanId(input.id || previous?.id);
  const type = String(input.type || previous?.type || '').trim().toLowerCase();
  const url = String(input.url || previous?.url || '').trim();
  if (!id) throw new Error('invalid_source_id');
  if (!SOURCE_TYPES.has(type)) throw new Error('invalid_source_type');
  if (!url) throw new Error('missing_source_url');
  const explicitQuery = input.query == null && previous ? previous.query : normalizeStringMap(input.query);
  const protectedUrl = extractProtectedQuery(url, explicitQuery);
  return {
    id,
    title: String(input.title ?? previous?.title ?? id).trim() || id,
    type,
    url: protectedUrl.url,
    enabled: input.enabled !== false,
    projection: String(input.projection ?? previous?.projection ?? 'EPSG:3857').trim() || 'EPSG:3857',
    attribution: String(input.attribution ?? previous?.attribution ?? '').trim(),
    minZoom: Number.isFinite(Number(input.minZoom)) ? Number(input.minZoom) : (previous?.minZoom ?? 0),
    maxZoom: Number.isFinite(Number(input.maxZoom)) ? Number(input.maxZoom) : (previous?.maxZoom ?? 22),
    layer: String(input.layer ?? previous?.layer ?? '').trim(),
    matrixSet: String(input.matrixSet ?? previous?.matrixSet ?? '').trim(),
    query: protectedUrl.query,
    headers: input.headers == null && previous ? previous.headers : normalizeStringMap(input.headers)
  };
};

const publicSource = (source) => ({
  ...source,
  query: Object.fromEntries(Object.keys(source.query || {}).map((key) => [key, ''])),
  headers: Object.fromEntries(Object.keys(source.headers || {}).map((key) => [key, '']))
});

const applyTemplate = (template, params) => Object.entries(params).reduce((result, [key, value]) => {
  const replacement = encodeURIComponent(String(value));
  return result.replaceAll(`{${key}}`, replacement).replaceAll(`{${key.toLowerCase()}}`, replacement);
}, String(template || ''));

const setSearchParam = (searchParams, key, value) => {
  for (const existingKey of Array.from(searchParams.keys())) {
    if (String(existingKey).toLowerCase() === String(key).toLowerCase()) searchParams.delete(existingKey);
  }
  searchParams.set(key, value);
};

const getQueryValue = (query, key) => {
  const entry = Object.entries(query || {}).find(([queryKey]) => String(queryKey).toLowerCase() === String(key).toLowerCase());
  return entry?.[1];
};

const buildUpstreamUrl = (source, req, templateParams = {}) => {
  const target = new URL(applyTemplate(source.url, templateParams));
  const adaptingXyz = source.type === 'xyz' && getQueryValue(req.query, 'tilematrix') != null;
  for (const [key, value] of Object.entries(req.query || {})) {
    const normalizedKey = String(key).toLowerCase();
    if (adaptingXyz && ['service', 'request', 'version', 'layer', 'style', 'tilematrixset', 'tilematrix', 'tilecol', 'tilerow', 'format'].includes(normalizedKey)) continue;
    if (!BLOCKED_QUERY_KEYS.has(normalizedKey) && value != null) setSearchParam(target.searchParams, key, String(value));
  }
  for (const [key, value] of Object.entries(source.query || {})) setSearchParam(target.searchParams, key, value);
  return target;
};

export const registerExternalServiceRoutes = ({ app, dataDir, requireAdmin }) => {
  const store = createJsonStore(path.join(dataDir, 'external-services.json'), { sources: [] });
  const adminOnly = typeof requireAdmin === 'function' ? requireAdmin : (_req, _res, next) => next();

  const readSources = async () => {
    const state = await store.read();
    return Array.isArray(state?.sources) ? state.sources : [];
  };

  app.get('/api/external-services', adminOnly, async (_req, res, next) => {
    try { return res.json({ sources: (await readSources()).map(publicSource) }); } catch (error) { return next(error); }
  });

  app.post('/api/external-services/discover', adminOnly, async (req, res, next) => {
    try {
      const input = req.body && typeof req.body === 'object' ? req.body : {};
      const type = inferSourceType(input.url, input.type);
      if (type === 'xyz') return res.json({ type, title: '', layers: [], matrixSets: [], projection: 'EPSG:3857' });
      const target = await assertSafeUrl(String(input.url || '').trim());
      for (const [key, value] of Object.entries(normalizeStringMap(input.query))) target.searchParams.set(key, value);
      for (const key of Array.from(target.searchParams.keys())) {
        if (['service', 'request'].includes(String(key).toLowerCase())) target.searchParams.delete(key);
      }
      target.searchParams.set('SERVICE', type.toUpperCase());
      target.searchParams.set('REQUEST', 'GetCapabilities');
      const response = await fetch(target, {
        headers: normalizeStringMap(input.headers),
        redirect: 'error',
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) return res.status(response.status).json({ error: 'external_capabilities_error', status: response.status });
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > MAX_CAPABILITIES_BYTES) return res.status(502).json({ error: 'external_capabilities_too_large' });
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_CAPABILITIES_BYTES) return res.status(502).json({ error: 'external_capabilities_too_large' });
      return res.json(parseCapabilities(buffer.toString('utf8'), type));
    } catch (error) {
      if (error?.name === 'TimeoutError') return res.status(504).json({ error: 'external_capabilities_timeout' });
      if (/^(invalid_|missing_|private_|upstream_)/.test(error?.message || '')) return res.status(400).json({ error: error.message });
      return next(error);
    }
  });

  app.put('/api/external-services/:sourceId', adminOnly, async (req, res, next) => {
    try {
      const requestedId = cleanId(req.params.sourceId);
      const currentSources = await readSources();
      const previous = currentSources.find((item) => item.id === requestedId) || null;
      const saved = normalizeSource({ ...(req.body || {}), id: requestedId }, previous);
      await assertSafeUrl(applyTemplate(saved.url, { z: 0, x: 0, y: 0, TileMatrix: 0, TileCol: 0, TileRow: 0 }));
      await store.update((state) => {
        const sources = Array.isArray(state?.sources) ? state.sources : [];
        const index = sources.findIndex((item) => item.id === requestedId);
        if (index >= 0) sources[index] = saved;
        else sources.push(saved);
        return { sources };
      });
      return res.json({ ok: true, source: publicSource(saved) });
    } catch (error) {
      if (/^(invalid_|missing_|private_|upstream_)/.test(error?.message || '')) return res.status(400).json({ error: error.message });
      return next(error);
    }
  });

  app.delete('/api/external-services/:sourceId', adminOnly, async (req, res, next) => {
    try {
      const sourceId = cleanId(req.params.sourceId);
      await store.update((state) => ({ sources: (Array.isArray(state?.sources) ? state.sources : []).filter((item) => item.id !== sourceId) }));
      return res.json({ ok: true });
    } catch (error) { return next(error); }
  });

  const proxy = (templateParams) => async (req, res, next) => {
    try {
      const source = (await readSources()).find((item) => item.id === cleanId(req.params.sourceId));
      if (!source || source.enabled === false) return res.status(404).json({ error: 'external_source_not_found' });
      const upstreamUrl = buildUpstreamUrl(source, req, templateParams(req));
      await assertSafeUrl(upstreamUrl);
      const response = await fetch(upstreamUrl, {
        headers: source.headers || {},
        redirect: 'error',
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) return res.status(response.status).json({ error: 'external_source_error', status: response.status });
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > MAX_RESPONSE_BYTES) return res.status(502).json({ error: 'external_response_too_large' });
      for (const header of SAFE_RESPONSE_HEADERS) {
        const value = response.headers.get(header);
        if (value) res.setHeader(header, value);
      }
      res.setHeader('x-content-type-options', 'nosniff');
      if (!response.body) return res.end();
      return Readable.fromWeb(response.body).pipe(res);
    } catch (error) {
      if (error?.name === 'TimeoutError') return res.status(504).json({ error: 'external_source_timeout' });
      if (/^(invalid_|private_|upstream_)/.test(error?.message || '')) return res.status(502).json({ error: error.message });
      return next(error);
    }
  };

  app.get('/external-services/:sourceId/tiles/:z/:x/:y', proxy((req) => ({ z: req.params.z, x: req.params.x, y: req.params.y })));
  app.get('/external-services/:sourceId/wmts/:TileMatrix/:TileCol/:TileRow', proxy((req) => req.params));
  app.get('/external-services/:sourceId/proxy', proxy((req) => {
    const TileMatrix = getQueryValue(req.query, 'tilematrix');
    const TileCol = getQueryValue(req.query, 'tilecol');
    const TileRow = getQueryValue(req.query, 'tilerow');
    return { z: TileMatrix, x: TileCol, y: TileRow, TileMatrix, TileCol, TileRow };
  }));
};

export const externalServiceInternals = { cleanId, inferSourceType, isPrivateIp, isUnsafeResolvedIp, assertSafeUrl, normalizeSource, publicSource, applyTemplate, getQueryValue, buildUpstreamUrl, parseCapabilities };