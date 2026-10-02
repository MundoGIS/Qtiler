import assert from 'node:assert/strict';
import { externalServiceInternals } from '../routes/externalServices.js';

const { cleanId, inferSourceType, isPrivateIp, isUnsafeResolvedIp, assertSafeUrl, normalizeSource, publicSource, applyTemplate, buildUpstreamUrl, parseCapabilities } = externalServiceInternals;

assert.equal(cleanId(' Terrain MHM 64/4 '), 'terrain-mhm-64-4');
assert.equal(isPrivateIp('127.0.0.1'), true);
assert.equal(isPrivateIp('192.168.1.20'), true);
assert.equal(isPrivateIp('8.8.8.8'), false);
assert.equal(isPrivateIp('::1'), true);
assert.equal(isUnsafeResolvedIp('192.168.74.45'), false);
assert.equal(isUnsafeResolvedIp('127.0.0.1'), false);
assert.equal(isUnsafeResolvedIp('169.254.169.254'), true);
assert.equal(isUnsafeResolvedIp('::ffff:127.0.0.1'), false);
assert.equal(inferSourceType('https://tiles.example.test/{z}/{x}/{y}.png'), 'xyz');
assert.equal(inferSourceType('https://maps.example.test/geoserver/wms'), 'wms');
assert.equal(inferSourceType('https://maps.example.test/service?SERVICE=WMTS&REQUEST=GetCapabilities'), 'wmts');
const localTarget = await assertSafeUrl('http://localhost:3004/terrain/demo/tiles/{z}/{x}/{y}.png');
assert.equal(localTarget.hostname, 'localhost');
assert.equal(localTarget.port, '3004');
await assert.rejects(() => assertSafeUrl('http://169.254.169.254/latest/meta-data'), /private_upstream_not_allowed/);
const splitDnsTarget = await assertSafeUrl('https://tiles.rabbalshedekraft.se/base/{z}/{x}/{y}.png');
assert.equal(splitDnsTarget.hostname, 'tiles.rabbalshedekraft.se');

const source = normalizeSource({
  id: 'terrain',
  type: 'xyz',
  url: 'https://tiles.example.test/{z}/{x}/{y}.png',
  query: { api_key: 'secret' },
  headers: { authorization: 'Bearer secret' }
});
assert.equal(applyTemplate(source.url, { z: 4, x: 8, y: 9 }), 'https://tiles.example.test/4/8/9.png');
assert.deepEqual(publicSource(source).query, { api_key: '' });
assert.deepEqual(publicSource(source).headers, { authorization: '' });

const sourceWithUrlKey = normalizeSource({
  id: 'protected-url',
  type: 'xyz',
  url: 'https://tiles.example.test/{z}/{x}/{y}.png?api_key=top-secret&style=default'
});
assert.equal(sourceWithUrlKey.url.includes('top-secret'), false);
assert.equal(sourceWithUrlKey.query.api_key, 'top-secret');
assert.equal(publicSource(sourceWithUrlKey).query.api_key, '');

const target = buildUpstreamUrl(source, { query: { style: 'hillshade', target: 'https://evil.test' } }, { z: 4, x: 8, y: 9 });
assert.equal(target.origin, 'https://tiles.example.test');
assert.equal(target.searchParams.get('style'), 'hillshade');
assert.equal(target.searchParams.get('api_key'), 'secret');
assert.equal(target.searchParams.has('target'), false);

const hajkTarget = buildUpstreamUrl(source, { query: { SERVICE: 'WMTS', REQUEST: 'GetTile', TILEMATRIX: '4', TILECOL: '8', TILEROW: '9' } }, { z: 4, x: 8, y: 9 });
assert.equal(hajkTarget.pathname, '/4/8/9.png');
assert.equal(hajkTarget.searchParams.has('SERVICE'), false);

const wmtsRest = normalizeSource({ id: 'wmts-rest', type: 'wmts', url: 'https://tiles.example.test/{TileMatrix}/{TileCol}/{TileRow}.png' });
const wmtsRestTarget = buildUpstreamUrl(wmtsRest, { query: {} }, { TileMatrix: 4, TileCol: 8, TileRow: 9 });
assert.equal(wmtsRestTarget.pathname, '/4/8/9.png');

const capabilitiesSource = normalizeSource({ id: 'service', type: 'wms', url: 'https://maps.example.test/wms?service=WMS&request=GetCapabilities' });
const mapTarget = buildUpstreamUrl(capabilitiesSource, { query: { SERVICE: 'WMS', REQUEST: 'GetMap', LAYERS: 'roads' } });
assert.equal(mapTarget.searchParams.getAll('REQUEST').length, 1);
assert.equal(mapTarget.searchParams.get('REQUEST'), 'GetMap');
assert.equal(Array.from(mapTarget.searchParams.keys()).some((key) => key === 'request'), false);

const wms = parseCapabilities(`<?xml version="1.0"?><WMS_Capabilities version="1.3.0"><Service><Title>Municipal maps</Title></Service><Capability><Request><GetMap><Format>image/png</Format></GetMap></Request><Layer><Title>Root</Title><CRS>EPSG:3006</CRS><Layer><Name>roads</Name><Title>Roads</Title></Layer><Layer><Name>land</Name><Title>Land</Title><CRS>EPSG:3857</CRS></Layer></Layer></Capability></WMS_Capabilities>`, 'wms');
assert.equal(wms.type, 'wms');
assert.equal(wms.title, 'Municipal maps');
assert.deepEqual(wms.layers.map((item) => item.id), ['roads', 'land']);
assert.equal(wms.layers[0].projection, 'EPSG:3006');
assert.equal(wms.layers[1].projection, 'EPSG:3857');
assert.deepEqual(wms.formats, ['image/png']);

const wmts = parseCapabilities(`<?xml version="1.0"?><wmts:Capabilities xmlns:wmts="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1" version="1.0.0"><ows:ServiceIdentification><ows:Title>National tiles</ows:Title></ows:ServiceIdentification><wmts:Contents><wmts:Layer><ows:Title>Terrain</ows:Title><ows:Identifier>terrain</ows:Identifier><wmts:Format>image/png</wmts:Format><wmts:TileMatrixSetLink><wmts:TileMatrixSet>webmercator</wmts:TileMatrixSet></wmts:TileMatrixSetLink></wmts:Layer><wmts:TileMatrixSet><ows:Identifier>webmercator</ows:Identifier><ows:SupportedCRS>urn:ogc:def:crs:EPSG::3857</ows:SupportedCRS></wmts:TileMatrixSet></wmts:Contents></wmts:Capabilities>`, 'wmts');
assert.equal(wmts.type, 'wmts');
assert.equal(wmts.layers[0].id, 'terrain');
assert.equal(wmts.layers[0].matrixSets[0].id, 'webmercator');
assert.equal(wmts.layers[0].projection, 'EPSG:3857');

console.log('External service proxy contract checks passed.');