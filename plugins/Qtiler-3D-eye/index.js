import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { spawn } from 'child_process';
import { readProjectAccessFromDb } from '../../lib/authDb.js';
import { makeQgisEnv } from '../../lib/PythonPool.js';
import { getRequestBaseUrl } from '../../lib/requestBaseUrl.js';

const nowIso = () => new Date().toISOString();
const DEFAULT_CESIUM_REPO = process.env.QTILER3DEYE_CESIUM_REPO || 'CesiumGS/cesium';
const DEFAULT_CESIUM_VERSION = process.env.QTILER3DEYE_CESIUM_VERSION || '1.116.0';
const SYSTEM_BACKGROUNDS = [
    {
        key: 'system-background:osm',
        name: 'OpenStreetMap',
        type: 'osm',
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        isBaseLayer: true,
        isSystemBackground: true,
        credit: '© OpenStreetMap contributors'
    },
    {
        key: 'system-background:bim',
        name: 'BIM / Bing Aerial',
        type: 'xyz',
        url: 'https://ecn.t{subdomain}.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=1',
        subdomains: ['0', '1', '2', '3'],
        isBaseLayer: true,
        isSystemBackground: true,
        credit: 'Bing Maps'
    }
];

const PLANNER_MODULES = [
    { key: 'layers', label: 'Layer tree', defaultEnabled: true },
    { key: 'measurement', label: 'Measurement', defaultEnabled: true },
    { key: 'redline', label: 'Sketch / Redline', defaultEnabled: true },
    { key: 'bookmarks', label: 'Saved views', defaultEnabled: true },
    { key: 'print', label: 'Print / Export', defaultEnabled: true },
    { key: 'timeline', label: 'Timeline / Clock', defaultEnabled: false },
    { key: 'shadows', label: 'Shadows', defaultEnabled: true },
    { key: 'skybox', label: 'Skybox / Clouds', defaultEnabled: false },
    { key: 'simulation', label: 'Camera simulation', defaultEnabled: false },
    { key: 'models', label: '3D models / GLTF', defaultEnabled: true },
    { key: 'feedback', label: 'Map notes / comments', defaultEnabled: false }
];

const normalizeProjectId = (value) => String(value || '').trim();

const sanitizeFileToken = (value) => String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_');

const qgis3dTilesAssetId = (projectId, layerName) => sanitizeFileToken(`qgis3d_${projectId}_${layerName}`);

const jsonFile = (filePath, fallback) => {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8') || JSON.stringify(fallback)); } catch { return fallback; }
};

const writeJsonFile = (filePath, payload) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
};

const removeRecursive = async (target) => {
    await fs.promises.rm(target, { recursive: true, force: true });
};

const copyRecursive = async (source, target) => {
    const stat = await fs.promises.stat(source);
    if (stat.isDirectory()) {
        await fs.promises.mkdir(target, { recursive: true });
        const entries = await fs.promises.readdir(source, { withFileTypes: true });
        for (const entry of entries) await copyRecursive(path.join(source, entry.name), path.join(target, entry.name));
        return;
    }
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.copyFile(source, target);
};

const isCesiumBrowserBuildSource = (source = '') => {
    const head = String(source || '').slice(0, 8192);
    return !/^\s*export\s/m.test(head) && !/from\s+['"]@cesium\//.test(head);
};

const isCesiumBrowserBuildRootSync = (root) => {
    try {
        const cesiumJs = path.join(root, 'Cesium.js');
        const widgetsDir = path.join(root, 'Widgets');
        if (!fs.existsSync(cesiumJs) || !fs.existsSync(widgetsDir)) return false;
        return isCesiumBrowserBuildSource(fs.readFileSync(cesiumJs, 'utf8'));
    } catch {
        return false;
    }
};

const isCesiumBrowserBuildRoot = async (root) => {
    try {
        const cesiumJs = path.join(root, 'Cesium.js');
        const widgetsDir = path.join(root, 'Widgets');
        await fs.promises.access(cesiumJs, fs.constants.R_OK);
        await fs.promises.access(widgetsDir, fs.constants.R_OK);
        return isCesiumBrowserBuildSource(await fs.promises.readFile(cesiumJs, 'utf8'));
    } catch {
        return false;
    }
};

const findCesiumBuildRoot = async (root) => {
    const preferred = path.join(root, 'Build', 'Cesium');
    if (await isCesiumBrowserBuildRoot(preferred)) return preferred;
    const queue = [root];
    const candidates = [];
    while (queue.length) {
        const current = queue.shift();
        let entries = [];
        try { entries = await fs.promises.readdir(current, { withFileTypes: true }); } catch { continue; }
        const names = new Set(entries.map((entry) => entry.name));
        if (names.has('Cesium.js') && names.has('Widgets')) candidates.push(current);
        for (const entry of entries) {
            if (entry.isDirectory()) queue.push(path.join(current, entry.name));
        }
    }
    for (const candidate of candidates) {
        if (await isCesiumBrowserBuildRoot(candidate)) return candidate;
    }
    return null;
};

const fetchGitHubReleases = async (repo, { includePrerelease = false, maxResults = 30 } = {}) => {
    const safeRepo = String(repo || DEFAULT_CESIUM_REPO).trim();
    const response = await fetch(`https://api.github.com/repos/${safeRepo}/releases?per_page=${Math.min(maxResults, 100)}`, {
        headers: { 'User-Agent': 'Qtiler-3D-eye/1.0', 'Accept': 'application/vnd.github+json' }
    });
    if (!response.ok) throw new Error(`github_api_http_${response.status}`);
    const releases = await response.json();
    if (!Array.isArray(releases)) return [];
    return releases
        .filter((release) => release?.tag_name && (includePrerelease || !release.prerelease))
        .map((release) => {
            const assets = Array.isArray(release.assets) ? release.assets : [];
            const cesiumAsset = assets.find((asset) => /CesiumJS.*\.zip$/i.test(asset.name || '')) || assets.find((asset) => /\.zip$/i.test(asset.name || '')) || null;
            return {
                tag: release.tag_name,
                name: release.name || release.tag_name,
                prerelease: !!release.prerelease,
                published: release.published_at || release.created_at || null,
                assetName: cesiumAsset?.name || null,
                assetUrl: cesiumAsset?.browser_download_url || null,
                assetSize: cesiumAsset?.size || 0
            };
        })
        .filter((release) => release.assetUrl);
};

const uniqueStrings = (items) => Array.from(new Set((Array.isArray(items) ? items : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)));

const defaultModulesState = () => Object.fromEntries(PLANNER_MODULES.map((item) => [item.key, item.defaultEnabled !== false]));

const normalizeModulesState = (input) => {
    const defaults = defaultModulesState();
    const source = input && typeof input === 'object' ? input : {};
    const result = { ...defaults };
    for (const key of Object.keys(defaults)) {
        if (Object.prototype.hasOwnProperty.call(source, key)) result[key] = source[key] !== false;
    }
    return result;
};

const normalizeSymbolType = (item = {}) => {
    if (item.modelAssetId) return 'gltf';
    const value = String(item.symbolType || '');
    if (['svg', 'gltf', 'point'].includes(value)) return value;
    return item.iconUrl ? 'svg' : 'point';
};

const normalizeStyleRule = (item = {}) => ({
    field: String(item.field || '').trim(),
    operator: ['=', '!=', 'contains', '>', '<', '>=', '<='].includes(String(item.operator || '=')) ? String(item.operator || '=') : '=',
    value: String(item.value ?? '').trim(),
    color: item.color || null,
    strokeColor: item.strokeColor || null,
    fillOpacity: Number.isFinite(Number(item.fillOpacity)) ? Math.max(0, Math.min(1, Number(item.fillOpacity))) : null,
    strokeOpacity: Number.isFinite(Number(item.strokeOpacity)) ? Math.max(0, Math.min(1, Number(item.strokeOpacity))) : null,
    strokeWidth: Number.isFinite(Number(item.strokeWidth)) ? Math.max(0, Number(item.strokeWidth)) : null,
    extrusionHeight: Number.isFinite(Number(item.extrusionHeight)) && Number(item.extrusionHeight) > 0 ? Number(item.extrusionHeight) : null,
    pointSize: Number.isFinite(Number(item.pointSize)) ? Math.max(1, Number(item.pointSize)) : null,
    symbolType: normalizeSymbolType(item),
    iconUrl: item.iconUrl || null,
    modelAssetId: item.modelAssetId || null,
    modelScale: Number.isFinite(Number(item.modelScale)) ? Math.max(0.01, Number(item.modelScale)) : null,
    iconScale: Number.isFinite(Number(item.iconScale)) ? Math.max(0.01, Number(item.iconScale)) : null,
    heightOffset: Number.isFinite(Number(item.heightOffset)) ? Number(item.heightOffset) : null,
    minZoom: item.minZoom != null && item.minZoom !== '' && Number.isFinite(Number(item.minZoom)) && Number(item.minZoom) > 0 ? Number(item.minZoom) : null,
    maxZoom: item.maxZoom != null && item.maxZoom !== '' && Number.isFinite(Number(item.maxZoom)) && Number(item.maxZoom) > 0 ? Number(item.maxZoom) : null
});

const normalizeLayerStyle = (item = {}) => ({
    color: item.color || null,
    strokeColor: item.strokeColor || null,
    fillOpacity: Number.isFinite(Number(item.fillOpacity)) ? Math.max(0, Math.min(1, Number(item.fillOpacity))) : null,
    strokeOpacity: Number.isFinite(Number(item.strokeOpacity)) ? Math.max(0, Math.min(1, Number(item.strokeOpacity))) : null,
    strokeWidth: Number.isFinite(Number(item.strokeWidth)) ? Math.max(0, Number(item.strokeWidth)) : null,
    extrusionHeight: Number.isFinite(Number(item.extrusionHeight)) && Number(item.extrusionHeight) > 0 ? Number(item.extrusionHeight) : null,
    pointSize: Number.isFinite(Number(item.pointSize)) ? Math.max(1, Number(item.pointSize)) : null,
    symbolType: normalizeSymbolType(item),
    iconUrl: item.iconUrl || null,
    iconScale: Number.isFinite(Number(item.iconScale)) ? Math.max(0.01, Number(item.iconScale)) : null,
    modelAssetId: item.modelAssetId || null,
    modelScale: Number.isFinite(Number(item.modelScale)) ? Math.max(0.01, Number(item.modelScale)) : null,
    heightOffset: Number.isFinite(Number(item.heightOffset)) ? Number(item.heightOffset) : 0
    , minZoom: item.minZoom != null && item.minZoom !== '' && Number.isFinite(Number(item.minZoom)) && Number(item.minZoom) > 0 ? Number(item.minZoom) : null
    , maxZoom: item.maxZoom != null && item.maxZoom !== '' && Number.isFinite(Number(item.maxZoom)) && Number(item.maxZoom) > 0 ? Number(item.maxZoom) : null
    , styleRules: Array.isArray(item.styleRules) ? item.styleRules.map(normalizeStyleRule) : []
});

const normalizeSceneProfile = (input = {}) => {
    const mainProjectId = normalizeProjectId(input.mainProjectId || input.qgisProject || input.projectId || '');
    const id = sanitizeFileToken(input.id || (mainProjectId ? `${mainProjectId}_3d` : `scene_${Date.now()}`));
    const backgroundProjects = uniqueStrings(input.backgroundProjects || (input.backgroundProjectId ? [input.backgroundProjectId] : []));
    const terrainProjects = uniqueStrings(input.terrainProjects || (input.terrainProjectId ? [input.terrainProjectId] : []));
    const finalTerrainProjects = terrainProjects.length ? terrainProjects : (input.enableTerrain === false || !mainProjectId ? [] : [mainProjectId]);

    return {
        id,
        title: String(input.title || input.name || mainProjectId || id).trim(),
        description: String(input.description || '').trim(),
        mainProjectId,
        qgisProject: mainProjectId,
        backgroundProjects,
        terrainProjects: finalTerrainProjects,
        mainLayers: Array.isArray(input.mainLayers) ? input.mainLayers : [],
        externalLayers: Array.isArray(input.externalLayers) ? input.externalLayers : [],
        backgroundLayers: Array.isArray(input.backgroundLayers) ? input.backgroundLayers : [],
        defaultBackgroundKey: String(input.defaultBackgroundKey || '').trim(),
        includeProjectView3d: input.includeProjectView3d === true,
        modules: normalizeModulesState(input.modules),
        ionToken: String(input.ionToken || '').trim(),
        logoConfig: input.logoConfig && typeof input.logoConfig === 'object' ? input.logoConfig : null,
        savedViews: Array.isArray(input.savedViews) ? input.savedViews : [],
        assetIds: uniqueStrings(input.assetIds),
        plannerConfig: input.plannerConfig && typeof input.plannerConfig === 'object' ? input.plannerConfig : {},
        enableTerrain: finalTerrainProjects.length > 0,
        createdAt: input.createdAt || nowIso(),
        updatedAt: nowIso()
    };
};

const normalizeStylePreset = (input = {}) => {
    const id = sanitizeFileToken(input.id || input.name || `style_${Date.now()}`);
    return {
        id,
        name: String(input.name || id).trim(),
        description: String(input.description || '').trim(),
        geometryKind: String(input.geometryKind || input.kind || 'polygon').trim(),
        style: normalizeLayerStyle(input.style || input),
        createdAt: input.createdAt || nowIso(),
        updatedAt: nowIso()
    };
};

const toArrayPayload = (value) => Array.isArray(value) ? value : [];

export const register = async ({ app, security, dataDir, baseDir }) => {
    const pluginSlug = 'Qtiler-3D-eye';
    const pluginDataDir = dataDir;
    const dataRoot = path.resolve(dataDir, '..');
    const mapsFile = path.join(pluginDataDir, 'maps.json');
    const assetsFile = path.join(pluginDataDir, 'assets.json');
    const terrainsFile = path.join(pluginDataDir, 'terrains.json');
    const settingsFile = path.join(pluginDataDir, 'settings.json');
    const cesiumStateFile = path.join(pluginDataDir, 'cesium.json');
    const stylesFile = path.join(pluginDataDir, 'styles.json');
    const uploadsDir = path.join(pluginDataDir, 'uploads');
    const assetsRoot = path.join(pluginDataDir, 'assets');
    const cesiumRoot = path.join(pluginDataDir, 'cesium');
    const cesiumInstallRoot = path.join(cesiumRoot, 'current');
    const assetUploadTmp = path.join(assetsRoot, '_incoming');
    const modelsRoot = path.join(assetsRoot, 'models');
    const tiles3dRoot = path.join(assetsRoot, '3dtiles');
    const externalTerrainRoot = path.join(assetsRoot, 'terrain');

    if (!fs.existsSync(pluginDataDir)) {
        fs.mkdirSync(pluginDataDir, { recursive: true });
    }
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
    if (!fs.existsSync(mapsFile)) {
        fs.writeFileSync(mapsFile, JSON.stringify([], null, 2), 'utf8');
    }
    for (const dir of [assetsRoot, assetUploadTmp, modelsRoot, tiles3dRoot, externalTerrainRoot, cesiumRoot]) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(assetsFile)) {
        fs.writeFileSync(assetsFile, JSON.stringify([], null, 2), 'utf8');
    }
    if (!fs.existsSync(terrainsFile)) {
        fs.writeFileSync(terrainsFile, JSON.stringify([], null, 2), 'utf8');
    }
    if (!fs.existsSync(settingsFile)) {
        writeJsonFile(settingsFile, { ionToken: '', logoUrl: '', headerTitle: 'Qtiler 3D Eye', headerSubtitle: '', galleryTitle: '3D Maps Gallery' });
    }
    if (!fs.existsSync(cesiumStateFile)) {
        writeJsonFile(cesiumStateFile, { repo: DEFAULT_CESIUM_REPO, version: '', installedAt: null, lastError: null });
    }
    if (!fs.existsSync(stylesFile)) {
        writeJsonFile(stylesFile, []);
    }

    const readMaps = () => toArrayPayload(JSON.parse(fs.readFileSync(mapsFile, 'utf8') || '[]')).map(normalizeSceneProfile);
    const writeMaps = (maps) => fs.writeFileSync(mapsFile, JSON.stringify(toArrayPayload(maps).map(normalizeSceneProfile), null, 2), 'utf8');
    const readScene = (id) => readMaps().find((item) => item.id === id || item.mainProjectId === id || item.qgisProject === id) || null;
    const readAssets = () => toArrayPayload(JSON.parse(fs.readFileSync(assetsFile, 'utf8') || '[]'));
    const writeAssets = (assets) => fs.writeFileSync(assetsFile, JSON.stringify(toArrayPayload(assets), null, 2), 'utf8');
    const readTerrains = () => toArrayPayload(JSON.parse(fs.readFileSync(terrainsFile, 'utf8') || '[]'));
    const writeTerrains = (terrains) => fs.writeFileSync(terrainsFile, JSON.stringify(toArrayPayload(terrains), null, 2), 'utf8');
    const readSettings = () => ({ ionToken: '', logoUrl: '', headerTitle: 'Qtiler 3D Eye', headerSubtitle: '', galleryTitle: '3D Maps Gallery', ...jsonFile(settingsFile, {}) });
    const readStylePresets = () => toArrayPayload(jsonFile(stylesFile, [])).map(normalizeStylePreset);
    const writeStylePresets = (items) => writeJsonFile(stylesFile, toArrayPayload(items).map(normalizeStylePreset));
    const writeSettings = (settings = {}) => {
        const next = {
            ionToken: String(settings.ionToken || '').trim(),
            logoUrl: String(settings.logoUrl || '').trim(),
            headerTitle: String(settings.headerTitle || 'Qtiler 3D Eye').trim(),
            headerSubtitle: String(settings.headerSubtitle || '').trim(),
            galleryTitle: String(settings.galleryTitle || '3D Maps Gallery').trim(),
            updatedAt: nowIso()
        };
        writeJsonFile(settingsFile, next);
        return next;
    };
    const readCesiumState = () => ({ repo: DEFAULT_CESIUM_REPO, version: '', installedAt: null, lastError: null, ...jsonFile(cesiumStateFile, {}) });
    const writeCesiumState = (state = {}) => writeJsonFile(cesiumStateFile, { repo: DEFAULT_CESIUM_REPO, version: '', installedAt: null, lastError: null, ...state });
    const hasCesiumInstall = () => isCesiumBrowserBuildRootSync(cesiumInstallRoot);

    const normalizeTerrainRecord = (input = {}) => {
        const id = sanitizeFileToken(input.id || input.terrainId || input.name || `terrain_${Date.now()}`);
        return {
            id,
            key: `generated:${id}`,
            source: 'generated',
            name: String(input.name || input.title || id).trim(),
            sourceProjectId: String(input.sourceProjectId || input.projectId || '').trim(),
            demPath: String(input.demPath || '').trim(),
            type: String(input.type || 'heightmap').trim(),
            createdAt: input.createdAt || nowIso(),
            updatedAt: input.updatedAt || nowIso(),
            terrainUrl: input.terrainUrl || null,
            heightmapInfoUrl: `/plugins/${pluginSlug}/api/heightmap-info/${encodeURIComponent(id)}`,
            heightmapTileUrlTemplate: `/plugins/${pluginSlug}/heightmap/${encodeURIComponent(id)}/{z}/{x}/{y}.bin`,
            downloadUrl: `/plugins/${pluginSlug}/api/terrain-download/${encodeURIComponent(id)}`,
            previewUrl: `/plugins/${pluginSlug}/view/?terrain=${encodeURIComponent(id)}`,
            deleteUrl: `/plugins/${pluginSlug}/api/terrain-library/generated/${encodeURIComponent(id)}`
        };
    };

    const readCacheIndex = (projectId) => {
        const safeProject = sanitizeFileToken(projectId);
        if (!safeProject) return null;
        const indexPath = path.join(process.cwd(), 'cache', safeProject, 'index.json');
        if (!fs.existsSync(indexPath)) return null;
        try { return JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch { return null; }
    };

    const layerTitle = (layer) => String(layer?.title || layer?.name || layer?.layer || '').trim();
    const layerName = (layer) => String(layer?.name || layer?.layer || layer?.title || '').trim();
    const isVectorLayer = (layer) => layer?.type === 'vector' || !!layer?.geometry_type;

    const xmlAttr = (text, attrName) => {
        const match = String(text || '').match(new RegExp(`${attrName}="([^"]*)"`, 'i'));
        return match ? match[1] : '';
    };

    const qgisColorToHex = (value) => {
        const parts = String(value || '').split(',').slice(0, 3).map((part) => Number(part));
        if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
        return `#${parts.map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, '0')).join('')}`;
    };

    const readQgis3dLayerConfig = (projectId) => {
        const index = readCacheIndex(projectId);
        const projectFile = index?.project;
        const cachedLayers = Array.isArray(index?.layers) ? index.layers : [];
        const result = [];
        try {
            if (!projectFile || !fs.existsSync(projectFile)) return result;
            let xml = '';
            if (/\.qgz$/i.test(projectFile)) {
                const zip = new AdmZip(projectFile);
                const entry = zip.getEntries().find((item) => /\.qgs$/i.test(item.entryName));
                if (entry) xml = entry.getData().toString('utf8');
            } else if (/\.qgs$/i.test(projectFile)) {
                xml = fs.readFileSync(projectFile, 'utf8');
            }
            if (!xml) return result;

            const byId = new Map();
            for (const layer of cachedLayers) {
                if (layer?.layer_id) byId.set(String(layer.layer_id), layer);
            }

            const rendererRe = /<renderer-3d\b[^>]*>[\s\S]*?<\/renderer-3d>/gi;
            for (const match of xml.matchAll(rendererRe)) {
                const block = match[0];
                const layerId = xmlAttr(block, 'layer');
                const cached = byId.get(layerId);
                if (!cached) continue;
                const name = layerName(cached);
                if (!name) continue;
                const extrusionHeight = Number(xmlAttr(block, 'extrusion-height'));
                if (!Number.isFinite(extrusionHeight) || extrusionHeight <= 0) continue;
                const materialMatch = block.match(/<material\b[^>]*>/i);
                result.push({
                    ...normalizeProjectLayer(projectId, cached, 'qgis3d'),
                    key: `qgis3d:${projectId}:${name}`,
                    source: 'QGIS 3D view',
                    extrusionHeight,
                    color: materialMatch ? qgisColorToHex(xmlAttr(materialMatch[0], 'diffuse')) : null
                });
            }
        } catch {
            return result;
        }
        return result;
    };

    const discoverQwc3dTiles = (projectId) => {
        const roots = [
            path.join(process.cwd(), 'data', 'Qtiler2qwc', '3dtiles', projectId),
            path.join(process.cwd(), 'data', 'Qtiler2qwc', '3dtiles', sanitizeFileToken(projectId))
        ];
        const result = [];
        const seen = new Set();
        for (const root of roots) {
            if (!root || !fs.existsSync(root)) continue;
            try {
                for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
                    if (!entry.isDirectory()) continue;
                    const tileset = path.join(root, entry.name, 'tileset.json');
                    if (!fs.existsSync(tileset)) continue;
                    const key = `${projectId}/${entry.name}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    result.push({
                        id: `qwc3d:${sanitizeFileToken(projectId)}:${sanitizeFileToken(entry.name)}`,
                        name: entry.name,
                        title: entry.name,
                        type: '3dtiles',
                        source: 'Qtiler2qwc View3D',
                        url: `/Qtiler2qwc/3dtiles/${encodeURIComponent(projectId)}/${encodeURIComponent(entry.name)}/tileset.json`
                    });
                }
            } catch {}
        }
        return result;
    };

    const normalizeProjectLayer = (projectId, layer, role = 'main') => {
        const name = layerName(layer);
        const title = layerTitle(layer) || name;
        const vector = isVectorLayer(layer);
        return {
            key: `${role}:${projectId}:${name}`,
            projectId,
            name,
            title,
            type: layer?.type || (vector ? 'vector' : 'raster'),
            geometryType: layer?.geometry_type || null,
            crs: layer?.layer_crs || layer?.crs || layer?.project_crs || null,
            extent: layer?.extent_wgs84 || layer?.project_extent_wgs84 || null,
            hasWfs: vector,
            hasWmts: !!(layer?.tile_matrix_preset || layer?.tile_matrix_set),
            legendUrl: `/wms?project=${encodeURIComponent(projectId)}&SERVICE=WMS&REQUEST=GetLegendGraphic&FORMAT=image/png&LAYER=${encodeURIComponent(name)}`,
            qgisStyleUrl: vector ? `/Qtiler2Origo/layer-style?project=${encodeURIComponent(projectId)}&layer=${encodeURIComponent(name)}` : null
        };
    };

    const addDirectoryToZip = (zip, dir, prefix = '') => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) addDirectoryToZip(zip, full, rel);
            else if (entry.isFile()) zip.addLocalFile(full, path.dirname(rel) === '.' ? '' : path.dirname(rel), path.basename(rel));
        }
    };

    const readTerrainBounds = (terrainId) => {
        const normalizeBoundsValue = (value) => {
            if (Array.isArray(value) && value.length >= 4) return value.slice(0, 4).map(Number);
            if (value && typeof value === 'object') {
                const bounds = [value.west, value.south, value.east, value.north].map(Number);
                if (bounds.every(Number.isFinite)) return bounds;
            }
            return null;
        };
        const metaPath = path.join(hydroCacheRoot, terrainId, 'meta.json');
        try {
            if (fs.existsSync(metaPath)) {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                const bounds = normalizeBoundsValue(meta.bounds);
                if (bounds) return bounds;
            }
        } catch {}
        const layerPath = path.join(quantizedMeshCacheRoot, terrainId, 'layer.json');
        try {
            if (fs.existsSync(layerPath)) {
                const layer = JSON.parse(fs.readFileSync(layerPath, 'utf8'));
                const bounds = normalizeBoundsValue(layer.bounds);
                if (bounds) return bounds;
            }
        } catch {}
        return null;
    };

    const readUploadedTerrainBounds = (asset) => {
        const normalizeBoundsValue = (value) => {
            if (Array.isArray(value) && value.length >= 4) return value.slice(0, 4).map(Number);
            if (value && typeof value === 'object') {
                const bounds = [value.west, value.south, value.east, value.north].map(Number);
                if (bounds.every(Number.isFinite)) return bounds;
            }
            return null;
        };
        const folder = path.join(externalTerrainRoot, asset.folderName || asset.id);
        const layerPath = path.join(folder, 'layer.json');
        try {
            if (fs.existsSync(layerPath)) {
                const layer = JSON.parse(fs.readFileSync(layerPath, 'utf8'));
                const bounds = normalizeBoundsValue(layer.bounds);
                if (bounds) return bounds;
            }
        } catch {}
        return null;
    };

    const findFileRecursive = async (dir, filename) => {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const found = await findFileRecursive(fullPath, filename);
                if (found) return found;
            } else if (entry.name.toLowerCase() === filename.toLowerCase()) {
                return fullPath;
            }
        }
        return null;
    };

    const moveDirectoryContents = async (fromDir, toDir) => {
        await fs.promises.mkdir(toDir, { recursive: true });
        const entries = await fs.promises.readdir(fromDir, { withFileTypes: true });
        for (const entry of entries) {
            const src = path.join(fromDir, entry.name);
            const dst = path.join(toDir, entry.name);
            await fs.promises.rename(src, dst).catch(async () => {
                if (entry.isDirectory()) {
                    await fs.promises.cp(src, dst, { recursive: true });
                    await fs.promises.rm(src, { recursive: true, force: true });
                } else {
                    await fs.promises.copyFile(src, dst);
                    await fs.promises.unlink(src);
                }
            });
        }
    };

    const normalizeAssetRecord = (input) => ({
        id: sanitizeFileToken(input.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
        name: String(input.name || input.originalName || input.id || 'Asset').trim(),
        type: String(input.type || 'model').trim(),
        url: String(input.url || '').trim(),
        originalName: String(input.originalName || '').trim(),
        fileName: String(input.fileName || '').trim(),
        folderName: String(input.folderName || '').trim(),
        placement: input.placement && typeof input.placement === 'object' ? input.placement : {
            longitude: null,
            latitude: null,
            height: 0,
            heading: 0,
            pitch: 0,
            roll: 0,
            scale: 1
        },
        readonly: input.readonly === true,
        visible: input.visible !== false,
        metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : null,
        createdAt: input.createdAt || nowIso(),
        updatedAt: input.updatedAt || nowIso()
    });

    const publicAssetUrl = (asset) => {
        if (asset?.type === 'model' && /^https?:\/\//i.test(asset.url || '')) {
            return `/plugins/${pluginSlug}/api/assets/${encodeURIComponent(asset.id)}/model`;
        }
        return asset?.url || '';
    };

    const publicAssetRecord = (asset) => {
        const normalized = normalizeAssetRecord(asset);
        return {
            ...normalized,
            sourceUrl: normalized.url,
            url: publicAssetUrl(normalized),
            previewUrl: `/plugins/${pluginSlug}/view/?asset=${encodeURIComponent(normalized.id)}`,
            openUrl: `/plugins/${pluginSlug}/view/?asset=${encodeURIComponent(normalized.id)}`,
            downloadUrl: `/plugins/${pluginSlug}/api/assets/${encodeURIComponent(normalized.id)}/download`
        };
    };

    const listReusableTerrains = () => {
        const generatedById = new Map(readTerrains().map(normalizeTerrainRecord).map((terrain) => [terrain.id, terrain]));
        try {
            for (const entry of fs.readdirSync(path.join(process.cwd(), 'cache', 'hydro-dem'), { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                const projectId = entry.name;
                const info = getTerrainInfo(projectId);
                if (info.hasHydroTerrain || info.hasTerrainCache) {
                    const existing = generatedById.get(projectId) || normalizeTerrainRecord({ id: projectId, name: projectId, sourceProjectId: projectId });
                    generatedById.set(projectId, {
                        ...existing,
                        ...info,
                        key: `generated:${projectId}`,
                        source: 'generated',
                        id: projectId,
                        name: existing.name || projectId,
                        type: info.hasHydroTerrain ? 'heightmap' : (info.hasTerrainCache ? 'quantized-mesh' : existing.type),
                        downloadUrl: `/plugins/${pluginSlug}/api/terrain-download/${encodeURIComponent(projectId)}`,
                        previewUrl: `/plugins/${pluginSlug}/view/?terrain=${encodeURIComponent(projectId)}`,
                        deleteUrl: `/plugins/${pluginSlug}/api/terrain-library/generated/${encodeURIComponent(projectId)}`
                    });
                }
            }
        } catch {}
        const uploaded = readAssets().filter((asset) => asset.type === 'terrain').map((asset) => ({
            id: asset.id,
            key: `uploaded:${asset.id}`,
            source: 'uploaded',
            project: asset.id,
            name: asset.name,
            type: 'quantized-mesh',
            terrainUrl: asset.url,
            hasTerrainCache: true,
            hasHydroTerrain: false,
            assetId: asset.id,
            downloadUrl: `/plugins/${pluginSlug}/api/assets/${encodeURIComponent(asset.id)}/download`,
            previewUrl: `/plugins/${pluginSlug}/view/?terrainAsset=${encodeURIComponent(asset.id)}`,
            deleteUrl: `/plugins/${pluginSlug}/api/terrain-library/uploaded/${encodeURIComponent(asset.id)}`
        }));
        return [...generatedById.values(), ...uploaded];
    };

    const readAccessSnapshot = () => {
        try { return readProjectAccessFromDb(dataRoot); } catch { return { projects: {} }; }
    };

    const userCanAccessProject = (req, projectId) => {
        if (!projectId) return false;
        if (!security || typeof security.isEnabled !== 'function' || !security.isEnabled()) return true;
        const user = req.user;
        if (user?.role === 'admin') return true;
        const snapshot = readAccessSnapshot();
        const entry = snapshot?.projects?.[projectId] || null;
        if (!user) return entry?.public === true;
        const userProjects = Array.isArray(user.projects) ? user.projects : [];
        const allowedUsers = Array.isArray(entry?.allowedUsers) ? entry.allowedUsers : [];
        const allowedRoles = Array.isArray(entry?.allowedRoles) ? entry.allowedRoles : [];
        return entry?.public === true || userProjects.includes(projectId) || allowedUsers.includes(user.id) || allowedRoles.includes(user.role);
    };

    const scanProjectRasters = (project) => {
        const rasterLayers = [];
        const projectsDir = path.join(process.cwd(), 'qgisprojects', project);
        if (!project || !fs.existsSync(projectsDir)) return rasterLayers;
        const seen = new Set();
        const pushIfNew = (f) => { if (f && !seen.has(f)) { seen.add(f); rasterLayers.push(f); } };
        const rasterRe = /\.(?:tif|tiff|dem|dtm|asc)$/i;
        const findQgs = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    const sub = findQgs(full);
                    if (sub) return sub;
                } else if (/\.(qgs|qgz)$/i.test(entry.name)) {
                    return full;
                }
            }
            return null;
        };
        const qgsPath = findQgs(projectsDir);
        if (qgsPath) {
            let xml = '';
            const qgsDir = path.dirname(qgsPath);
            try {
                if (qgsPath.toLowerCase().endsWith('.qgz')) {
                    const zip = new AdmZip(qgsPath);
                    const inner = zip.getEntries().find(e => /\.qgs$/i.test(e.entryName));
                    if (inner) xml = zip.readAsText(inner);
                } else {
                    xml = fs.readFileSync(qgsPath, 'utf8');
                }
            } catch {}
            if (xml) {
                const absRe = /([A-Za-z]:[\\\/][^"<>|*?\n\r]+?\.(?:tif|tiff|dem|dtm|asc))/gi;
                let match;
                while ((match = absRe.exec(xml)) !== null) pushIfNew(match[1]);
                const dsRe = /<datasource>([^<]+)<\/datasource>/gi;
                while ((match = dsRe.exec(xml)) !== null) {
                    const raw = match[1].trim().split('|')[0];
                    if (rasterRe.test(raw) && !/^[A-Za-z]:[\\\/]/.test(raw)) {
                        const abs = path.resolve(qgsDir, raw);
                        if (fs.existsSync(abs)) pushIfNew(abs);
                    }
                }
            }
        }
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (rasterRe.test(entry.name)) pushIfNew(full);
            }
        };
        try { walk(projectsDir); } catch {}
        return rasterLayers;
    };

    const getTerrainInfo = (project) => {
        const qmDir = path.join(quantizedMeshCacheRoot, project);
        const layerJsonPath = path.join(qmDir, 'layer.json');
        const hasTerrainCache = fs.existsSync(layerJsonPath);
        const hasHydroTerrain = fs.existsSync(path.join(hydroCacheRoot, project, 'dem.tif'));
        return {
            project,
            hasTerrainCache,
            terrainUrl: hasTerrainCache ? `/plugins/${pluginSlug}/terrain/${encodeURIComponent(project)}/` : null,
            hasHydroTerrain,
            heightmapInfoUrl: `/plugins/${pluginSlug}/api/heightmap-info/${encodeURIComponent(project)}`,
            heightmapTileUrlTemplate: `/plugins/${pluginSlug}/heightmap/${encodeURIComponent(project)}/{z}/{x}/{y}.bin`,
            rasterLayers: scanProjectRasters(project)
        };
    };

    const wgs84ToMercator = (lon, lat) => {
        const x = Math.max(-20037508.342789244, Math.min(20037508.342789244, Number(lon) * 20037508.342789244 / 180));
        const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
        const y = Math.log(Math.tan((90 + clampedLat) * Math.PI / 360)) / (Math.PI / 180) * 20037508.342789244 / 180;
        return [x, y];
    };

    const normalizeWgs84Bounds = (bounds) => {
        if (bounds && !Array.isArray(bounds) && typeof bounds === 'object') bounds = [bounds.west, bounds.south, bounds.east, bounds.north];
        if (!Array.isArray(bounds) || bounds.length < 4) return null;
        const nums = bounds.slice(0, 4).map(Number);
        if (!nums.every(Number.isFinite)) return null;
        let [west, south, east, north] = nums;
        if (!(east > west) || !(north > south)) return null;
        west = Math.max(-180, Math.min(180, west));
        east = Math.max(-180, Math.min(180, east));
        south = Math.max(-85.05112878, Math.min(85.05112878, south));
        north = Math.max(-85.05112878, Math.min(85.05112878, north));
        return [west, south, east, north];
    };

    const projectWgs84Bounds = (projectId) => {
        const index = readCacheIndex(projectId);
        const rootBounds = normalizeWgs84Bounds(index?.extent_wgs84 || index?.project_extent_wgs84 || index?.bounds_wgs84 || index?.bounds || null);
        if (rootBounds) return rootBounds;
        const layerBounds = (Array.isArray(index?.layers) ? index.layers : [])
            .map((layer) => normalizeWgs84Bounds(layer?.project_extent_wgs84 || layer?.extent_wgs84 || layer?.bounds_wgs84 || null))
            .find(Boolean);
        return layerBounds || null;
    };

    const webMercatorTilesForBounds = (boundsWgs84, minZoom, maxZoom, maxTiles) => {
        const bounds = normalizeWgs84Bounds(boundsWgs84);
        if (!bounds) return [];
        const [west, south, east, north] = bounds;
        const [minX, minY] = wgs84ToMercator(west, south);
        const [maxX, maxY] = wgs84ToMercator(east, north);
        const worldMin = -20037508.342789244;
        const worldMax = 20037508.342789244;
        const worldSpan = worldMax - worldMin;
        const tiles = [];
        for (let z = minZoom; z <= maxZoom; z++) {
            const matrix = Math.pow(2, z);
            const span = worldSpan / matrix;
            const x0 = Math.max(0, Math.floor((minX - worldMin) / span));
            const x1 = Math.min(matrix - 1, Math.floor((maxX - worldMin) / span));
            const y0 = Math.max(0, Math.floor((worldMax - maxY) / span));
            const y1 = Math.min(matrix - 1, Math.floor((worldMax - minY) / span));
            for (let x = x0; x <= x1; x++) {
                for (let y = y0; y <= y1; y++) {
                    const tileMinX = worldMin + x * span;
                    const tileMaxX = tileMinX + span;
                    const tileMaxY = worldMax - y * span;
                    const tileMinY = tileMaxY - span;
                    tiles.push({ z, x, y, bbox: [tileMinX, tileMinY, tileMaxX, tileMaxY] });
                    if (tiles.length >= maxTiles) return tiles;
                }
            }
        }
        return tiles;
    };

    const precacheBackgrounds = async (scene, req) => {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const minZoom = Math.max(0, Math.min(22, Number.isFinite(Number(body.minZoom)) ? Number(body.minZoom) : 0));
        const maxZoom = Math.max(minZoom, Math.min(22, Number.isFinite(Number(body.maxZoom)) ? Number(body.maxZoom) : 8));
        const maxTiles = Math.max(1, Math.min(5000, Number.isFinite(Number(body.maxTiles)) ? Number(body.maxTiles) : 600));
        const bounds = normalizeWgs84Bounds(body.bounds) || projectWgs84Bounds(scene.mainProjectId) || normalizeWgs84Bounds((scene.terrainProjects || []).map(projectWgs84Bounds).find(Boolean));
        const backgrounds = (scene.backgroundLayers || [])
            .filter((layer) => layer?.included !== false)
            .map((layer) => ({ projectId: normalizeProjectId(layer.projectId || layer.sourceProjectId), name: String(layer.name || '').trim() }))
            .filter((layer) => layer.projectId && layer.name);
        const tiles = webMercatorTilesForBounds(bounds, minZoom, maxZoom, maxTiles);
        let requested = 0;
        let ok = 0;
        const failed = [];
        for (const background of backgrounds) {
            for (const tile of tiles) {
                const url = new URL(`${getRequestBaseUrl(req)}/wms`);
                url.searchParams.set('project', background.projectId);
                url.searchParams.set('SERVICE', 'WMS');
                url.searchParams.set('VERSION', '1.1.1');
                url.searchParams.set('REQUEST', 'GetMap');
                url.searchParams.set('LAYERS', background.name);
                url.searchParams.set('STYLES', '');
                url.searchParams.set('FORMAT', 'image/png');
                url.searchParams.set('TRANSPARENT', 'false');
                url.searchParams.set('SRS', 'EPSG:3857');
                url.searchParams.set('WIDTH', '256');
                url.searchParams.set('HEIGHT', '256');
                url.searchParams.set('BBOX', tile.bbox.join(','));
                requested++;
                try {
                    const response = await fetch(url, { headers: { cookie: req.headers.cookie || '' } });
                    if (response.ok) ok++;
                    else failed.push({ layer: background.name, z: tile.z, x: tile.x, y: tile.y, status: response.status });
                } catch (err) {
                    failed.push({ layer: background.name, z: tile.z, x: tile.x, y: tile.y, error: String(err?.message || err) });
                }
            }
        }
        return { bounds, minZoom, maxZoom, maxTiles, layers: backgrounds.length, tilesPerLayer: tiles.length, requested, ok, failed: failed.slice(0, 20), truncated: failed.length > 20 };
    };

    const buildViewerConfig = (profile, req) => {
        const settings = readSettings();
        const backgroundProjects = uniqueStrings(profile.backgroundProjects);
        const terrainProjects = uniqueStrings(profile.terrainProjects);
        const layers = [];
        const configuredMainLayers = Array.isArray(profile.mainLayers) ? profile.mainLayers : [];
        const configuredExternalLayers = Array.isArray(profile.externalLayers) ? profile.externalLayers : [];
        const allAssets = readAssets().map(normalizeAssetRecord);
        const modelAssetsById = new Map(allAssets.filter((asset) => asset.type === 'model' && asset.url).map((asset) => [asset.id, asset]));
        const enrichLayerStyle = (item = {}) => {
            const style = normalizeLayerStyle(item);
            const attachModelUrl = (target) => {
                if (!target?.modelAssetId) return target;
                const asset = modelAssetsById.get(String(target.modelAssetId));
                return asset ? { ...target, modelUrl: publicAssetUrl(asset), modelName: asset.name } : target;
            };
            return {
                ...attachModelUrl(style),
                styleRules: (style.styleRules || []).map(attachModelUrl)
            };
        };
        const appendConfiguredLayer = (item, fallbackProjectId, role = 'main') => {
            const projectId = normalizeProjectId(item.projectId || item.sourceProjectId || fallbackProjectId || '');
            const name = String(item.name || '').trim();
            if (!projectId || !name) return;
            const style = enrichLayerStyle(item);
            if (item.service === 'wfs') {
                layers.push({
                    key: `${role}:wfs:${projectId}:${name}`,
                    name: item.title || name,
                    type: 'wfs',
                    projectId,
                    layerName: name,
                    url: `/wfs?project=${encodeURIComponent(projectId)}`,
                    visible: item.visible !== false,
                    projectBounds: projectWgs84Bounds(projectId),
                    geometryType: item.geometryType || null,
                    qgisStyleUrl: item.qgisStyleUrl || `/Qtiler2Origo/layer-style?project=${encodeURIComponent(projectId)}&layer=${encodeURIComponent(name)}`,
                    legendIcon: item.legendIcon || item.legendUrl || null,
                    ...style
                });
            } else {
                layers.push({
                    key: `${role}:wms:${projectId}:${name}`,
                    name: item.title || name,
                    type: 'wms',
                    projectId,
                    layerName: name,
                    url: `/wms?project=${encodeURIComponent(projectId)}`,
                    visible: item.visible !== false,
                    isBaseLayer: false,
                    legendIcon: item.legendIcon || item.legendUrl || null
                });
            }
        };
        if (configuredMainLayers.length) {
            for (const item of configuredMainLayers.filter((layer) => layer?.included !== false)) {
                const name = String(item.name || '').trim();
                if (!name) continue;
                appendConfiguredLayer(item, profile.mainProjectId, 'main');
            }
        } else if (profile.mainProjectId) {
            layers.push({
                key: `project:${profile.mainProjectId}`,
                name: profile.title || profile.mainProjectId,
                type: 'wms',
                projectId: profile.mainProjectId,
                url: `/wms?project=${encodeURIComponent(profile.mainProjectId)}`,
                visible: true,
                isBaseLayer: false
            });
        }
        for (const item of configuredExternalLayers.filter((layer) => layer?.included !== false)) {
            appendConfiguredLayer(item, item.projectId || item.sourceProjectId, 'external');
        }
        const configuredBackgroundLayers = Array.isArray(profile.backgroundLayers) ? profile.backgroundLayers : [];
        if (configuredBackgroundLayers.length) {
            for (const item of configuredBackgroundLayers.filter((layer) => layer?.included !== false)) {
                const projectId = normalizeProjectId(item.projectId || item.sourceProjectId || '');
                const name = String(item.name || '').trim();
                if (!projectId || !name) continue;
                const key = `background:${projectId}:${name}`;
                layers.push({
                    key,
                    name: item.title || name,
                    type: 'wms',
                    projectId,
                    layerName: name,
                    url: `/wms?project=${encodeURIComponent(projectId)}`,
                    visible: item.visible !== false,
                    isBaseLayer: true,
                    isDefault: profile.defaultBackgroundKey ? profile.defaultBackgroundKey === key : item.isDefault === true,
                    legendIcon: item.legendIcon || item.legendUrl || null
                });
            }
        } else {
            for (const projectId of backgroundProjects) {
                layers.push({
                    key: `background:${projectId}`,
                    name: `Background: ${projectId}`,
                    type: 'wms',
                    projectId,
                    url: `/wms?project=${encodeURIComponent(projectId)}`,
                    visible: true,
                    isBaseLayer: true
                });
            }
        }
        const hasConfiguredBackground = layers.some((layer) => layer.isBaseLayer);
        for (const [index, background] of SYSTEM_BACKGROUNDS.entries()) {
            layers.push({
                ...background,
                visible: true,
                isDefault: !hasConfiguredBackground && index === 0
            });
        }
        const terrains = terrainProjects.map((projectId) => {
            const info = getTerrainInfo(projectId);
            return {
                key: `terrain:${projectId}`,
                name: projectId,
                projectId,
                type: info.hasHydroTerrain ? 'heightmap' : (info.hasTerrainCache ? 'quantized-mesh' : 'pending'),
                visible: true,
                ...info
            };
        });
        const assetSet = new Set(uniqueStrings(profile.assetIds));
        const sceneAssetIds = new Set();
        let sceneAssets = allAssets
            .filter((asset) => !assetSet.size || assetSet.has(asset.id))
            .map((asset) => {
                sceneAssetIds.add(asset.id);
                return publicAssetRecord(asset);
            });
        if (profile.includeProjectView3d && profile.mainProjectId) {
            for (const item of readQgis3dLayerConfig(profile.mainProjectId)) {
                const inheritedStyle = enrichLayerStyle(configuredMainLayers.find((layer) => String(layer.name || '').trim() === item.name) || {});
                const generatedTilesAsset = allAssets.find((asset) => asset.type === '3dtiles' && asset.id === qgis3dTilesAssetId(profile.mainProjectId, item.name));
                if (generatedTilesAsset) {
                    if (!sceneAssetIds.has(generatedTilesAsset.id)) {
                        sceneAssets.push(publicAssetRecord(generatedTilesAsset));
                        sceneAssetIds.add(generatedTilesAsset.id);
                    }
                    layers.push({
                        key: item.key,
                        name: `${item.title || item.name} 3D Tiles`,
                        type: '3dtiles-reference',
                        projectId: profile.mainProjectId,
                        layerName: item.name,
                        assetId: generatedTilesAsset.id,
                        visible: generatedTilesAsset.visible !== false,
                        source: 'QGIS 3D Tiles cache',
                        legendIcon: item.legendUrl || null
                    });
                    continue;
                }
                layers.push({
                    key: item.key,
                    name: `${item.title || item.name} 3D`,
                    type: 'wfs',
                    projectId: profile.mainProjectId,
                    layerName: item.name,
                    url: `/wfs?project=${encodeURIComponent(profile.mainProjectId)}`,
                    visible: true,
                    projectBounds: projectWgs84Bounds(profile.mainProjectId),
                    geometryType: item.geometryType || null,
                    qgisStyleUrl: item.qgisStyleUrl || null,
                    legendIcon: item.legendUrl || null,
                    extrusionHeight: item.extrusionHeight,
                    color: inheritedStyle.color || item.color || null,
                    strokeColor: inheritedStyle.strokeColor || item.strokeColor || null,
                    fillOpacity: inheritedStyle.fillOpacity ?? item.fillOpacity ?? null,
                    strokeOpacity: inheritedStyle.strokeOpacity ?? item.strokeOpacity ?? null,
                    strokeWidth: inheritedStyle.strokeWidth ?? item.strokeWidth ?? null,
                    pointSize: inheritedStyle.pointSize ?? item.pointSize ?? null,
                    symbolType: inheritedStyle.symbolType || item.symbolType || null,
                    iconUrl: inheritedStyle.iconUrl || item.iconUrl || null,
                    iconScale: inheritedStyle.iconScale ?? item.iconScale ?? null,
                    modelAssetId: inheritedStyle.modelAssetId || null,
                    modelUrl: inheritedStyle.modelUrl || null,
                    modelName: inheritedStyle.modelName || null,
                    modelScale: inheritedStyle.modelScale ?? null,
                    heightOffset: inheritedStyle.heightOffset ?? item.heightOffset ?? 0,
                    minZoom: inheritedStyle.minZoom ?? null,
                    maxZoom: inheritedStyle.maxZoom ?? null,
                    styleRules: inheritedStyle.styleRules || [],
                    source: 'QGIS 3D view'
                });
            }
        }
        const uploadedTerrains = sceneAssets
            .filter((asset) => asset.type === 'terrain')
            .map((asset) => ({
                key: `asset-terrain:${asset.id}`,
                name: asset.name,
                projectId: null,
                assetId: asset.id,
                type: 'quantized-mesh',
                visible: asset.visible !== false,
                terrainUrl: asset.url,
                hasTerrainCache: true,
                hasHydroTerrain: false,
                rasterLayers: []
            }));
        const allTerrains = [...terrains.filter((terrain) => userCanAccessProject(req, terrain.projectId)), ...uploadedTerrains];
        return {
            schema: 'qtiler-3d-eye.scene.v1',
            plugin: pluginSlug,
            generatedAt: nowIso(),
            scene: profile,
            access: {
                mainProject: userCanAccessProject(req, profile.mainProjectId),
                backgrounds: Object.fromEntries(backgroundProjects.map((projectId) => [projectId, userCanAccessProject(req, projectId)])),
                terrains: Object.fromEntries(terrainProjects.map((projectId) => [projectId, userCanAccessProject(req, projectId)]))
            },
            config: {
                cesiumToken: profile.ionToken || settings.ionToken || '',
                branding: {
                    logoUrl: profile.logoConfig?.url || settings.logoUrl || '',
                    headerTitle: settings.headerTitle || 'Qtiler 3D Eye',
                    headerSubtitle: settings.headerSubtitle || '',
                    galleryTitle: settings.galleryTitle || '3D Maps Gallery'
                },
                modules: profile.modules,
                layers: layers.filter((layer) => !layer.projectId || userCanAccessProject(req, layer.projectId)),
                terrains: allTerrains,
                assets: sceneAssets,
                warnings: allTerrains.length ? [] : ['no_terrain_scene_will_be_flat'],
                savedViews: Array.isArray(profile.savedViews) ? profile.savedViews : []
            }
        };
    };

    const router = express.Router();
    
    // 1. Admin UI endpoints
    // Servimos los estáticos en /admin-ui
    app.use(`/plugins/${pluginSlug}/admin-ui`, express.static(path.join(baseDir, 'admin-ui')));

    // Servir el cache local de quantized-mesh (terreno Cesium) para nuestro plugin
    const quantizedMeshCacheRoot = path.join(process.cwd(), 'cache', 'quantized-mesh');
    app.use(`/plugins/${pluginSlug}/assets`, express.static(assetsRoot, {
        setHeaders: (res, filePath) => {
            if (/\.gltf$/i.test(filePath)) res.setHeader('Content-Type', 'model/gltf+json');
            if (/\.glb$/i.test(filePath)) res.setHeader('Content-Type', 'model/gltf-binary');
            if (/\.b3dm$/i.test(filePath)) res.setHeader('Content-Type', 'application/octet-stream');
        }
    }));
    app.use(`/plugins/${pluginSlug}/cesium`, express.static(cesiumInstallRoot, {
        setHeaders: (res, filePath) => {
            if (/\.js$/i.test(filePath)) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            if (/\.css$/i.test(filePath)) res.setHeader('Content-Type', 'text/css; charset=utf-8');
            if (/\.(wasm|basis|ktx2)$/i.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }));
    app.use(`/plugins/${pluginSlug}/terrain`, express.static(quantizedMeshCacheRoot, {
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.terrain')) {
                res.setHeader('Content-Type', 'application/vnd.quantized-mesh');
                res.setHeader('Content-Encoding', 'gzip');
            }
        }
    }));

    // Redirigir la llamada del iframe (/admin) hacia la carpeta estética real (/admin-ui/)
    app.get(`/plugins/${pluginSlug}/admin`, (req, res) => {
        res.redirect(`/plugins/${pluginSlug}/admin-ui/`);
    });

    // Subida de logos
    const memoryStorage = multer.memoryStorage();
    const memoryUpload = multer({
        storage: memoryStorage,
        limits: { fileSize: 5 * 1024 * 1024 }
    });

    const assetUpload = multer({
        storage: multer.diskStorage({
            destination: (_req, _file, cb) => cb(null, assetUploadTmp),
            filename: (_req, file, cb) => cb(null, `${Date.now()}_${sanitizeFileToken(file.originalname || 'asset')}`)
        }),
        limits: { fileSize: 2 * 1024 * 1024 * 1024 }
    });

    // Middleware seguro
    const requireAdmin = security && typeof security.requireAdmin === 'function' 
        ? security.requireAdmin 
        : (req, res, next) => next();

    // ============================================================
    // TERRAIN PIPELINE (hydro-flatten + CustomHeightmapTerrainProvider)
    // ============================================================
    const hydroCacheRoot = path.join(process.cwd(), 'cache', 'hydro-dem');
    const heightmapCacheRoot = path.join(process.cwd(), 'cache', 'heightmap-tiles');
    const pythonExe = process.env.PYTHON_EXE || 'python';
    const pyHydroFlatten = path.join(baseDir, 'python', 'hydro_flatten.py');
    const pyHeightmapTile = path.join(baseDir, 'python', 'heightmap_tile.py');
    const pyBuildQgis3dTiles = path.join(baseDir, 'python', 'build_qgis3d_tiles.py');
    const TILE_SIZE = 65; // Cesium CustomHeightmapTerrainProvider standard
    const terrainJobs = new Map(); // jobId -> { status, progress, error, projectId, output, startedAt, endedAt }
    const qgis3dTileJobs = new Map();

    function spawnPyJson(scriptPath, stdinPayload) {
        return new Promise((resolve, reject) => {
            const child = spawn(pythonExe, [scriptPath], {
                env: makeQgisEnv(),
                windowsHide: true,
            });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (d) => { stdout += d.toString(); });
            child.stderr.on('data', (d) => { stderr += d.toString(); });
            child.on('error', (err) => reject(err));
            child.on('close', (code) => {
                // Si stdout contiene JSON válido, devolverlo aunque el código de salida sea ≠ 0
                let parsed = null;
                try { parsed = JSON.parse(stdout); } catch (e) {}
                if (parsed) return resolve(parsed);
                if (code !== 0) return reject(new Error(`python_exit_${code}: ${stderr.slice(0, 500) || stdout.slice(0, 500)}`));
                return reject(new Error(`python_invalid_json: ${stdout.slice(0, 300)}`));
            });
            child.stdin.write(JSON.stringify(stdinPayload));
            child.stdin.end();
        });
    }

    function spawnPyBinary(scriptPath, stdinPayload, expectedBytes) {
        return new Promise((resolve, reject) => {
            const child = spawn(pythonExe, [scriptPath], {
                env: makeQgisEnv(),
                windowsHide: true,
            });
            const chunks = [];
            let totalLen = 0;
            let stderr = '';
            child.stdout.on('data', (chunk) => {
                chunks.push(chunk);
                totalLen += chunk.length;
            });
            child.stderr.on('data', (d) => { stderr += d.toString(); });
            child.on('error', (err) => reject(err));
            child.on('close', () => {
                const buf = Buffer.concat(chunks, totalLen);
                if (expectedBytes && buf.length !== expectedBytes) {
                    console.warn(`[${pluginSlug}] heightmap_tile size mismatch: got=${buf.length} expected=${expectedBytes}, stderr=${stderr.slice(0,200)}`);
                }
                resolve(buf);
            });
            child.stdin.write(JSON.stringify(stdinPayload));
            child.stdin.end();
        });
    }

    // POST /api/build-terrain { projectId, terrainName, demPath, waterThreshold, maxSearchDist, smoothing }
    router.post('/api/build-terrain', requireAdmin, express.json(), async (req, res) => {
        const projectId = String(req.body?.projectId || '').trim();
        const terrainName = String(req.body?.terrainName || req.body?.name || projectId || '').trim();
        const terrainId = sanitizeFileToken(req.body?.terrainId || terrainName || projectId);
        const demPath = String(req.body?.demPath || '').trim();
        const waterThreshold = Number.isFinite(Number(req.body?.waterThreshold)) ? Number(req.body.waterThreshold) : 0.5;
        const maxSearchDist = Number.isFinite(Number(req.body?.maxSearchDist)) ? Math.max(1, Math.floor(Number(req.body.maxSearchDist))) : 100;
        const smoothing = Number.isFinite(Number(req.body?.smoothing)) ? Math.max(0, Math.floor(Number(req.body.smoothing))) : 0;

        if (!projectId) return res.status(400).json({ error: 'projectId_required' });
        if (!terrainId) return res.status(400).json({ error: 'terrain_name_required' });
        if (!demPath || !fs.existsSync(demPath)) return res.status(400).json({ error: 'dem_path_not_found', details: demPath });

        const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const job = {
            id: jobId, projectId, terrainId, terrainName, demPath, waterThreshold, maxSearchDist, smoothing,
            status: 'running', progress: 5, startedAt: nowIso(), endedAt: null, error: null, output: null
        };
        terrainJobs.set(jobId, job);

        // Limpiar tiles cacheados anteriores
        const tilesDir = path.join(heightmapCacheRoot, terrainId);
        if (fs.existsSync(tilesDir)) {
            try { fs.rmSync(tilesDir, { recursive: true, force: true }); } catch (e) {}
        }

        const outDir = path.join(hydroCacheRoot, terrainId);

        // Lanzar en background
        (async () => {
            try {
                job.progress = 20;
                const result = await spawnPyJson(pyHydroFlatten, {
                    inputTif: demPath,
                    outputDir: outDir,
                    waterThreshold,
                    maxSearchDist,
                    smoothing,
                });
                if (!result.ok) throw new Error((result.error || 'unknown') + ': ' + (result.details || '').toString().slice(0, 800));
                const terrains = readTerrains().map(normalizeTerrainRecord);
                const record = normalizeTerrainRecord({
                    id: terrainId,
                    name: terrainName || terrainId,
                    sourceProjectId: projectId,
                    demPath,
                    type: 'heightmap',
                    createdAt: terrains.find((item) => item.id === terrainId)?.createdAt || nowIso(),
                    updatedAt: nowIso()
                });
                const idx = terrains.findIndex((item) => item.id === terrainId);
                if (idx >= 0) terrains[idx] = record;
                else terrains.push(record);
                writeTerrains(terrains);
                job.progress = 100;
                job.status = 'completed';
                job.output = result.meta;
                job.terrain = record;
                job.endedAt = nowIso();
            } catch (err) {
                job.status = 'error';
                job.error = String(err.message || err);
                job.endedAt = nowIso();
                console.error(`[${pluginSlug}] build-terrain job ${jobId} failed:`, err);
            }
        })();

        res.json({ jobId, status: job.status, terrainId, terrainName });
    });

    router.get('/api/terrain-job/:jobId', requireAdmin, (req, res) => {
        const job = terrainJobs.get(req.params.jobId);
        if (!job) return res.status(404).json({ error: 'job_not_found' });
        res.json(job);
    });

    // GET /api/heightmap-info/:projectId
    router.get('/api/heightmap-info/:projectId', (req, res) => {
        const projectId = String(req.params.projectId || '').trim();
        const metaPath = path.join(hydroCacheRoot, projectId, 'meta.json');
        if (!fs.existsSync(metaPath)) return res.json({ available: false });
        try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            res.json({
                available: true,
                projectId,
                bounds: meta.bounds,
                elevation: meta.elevation,
                tileWidth: TILE_SIZE,
                tileHeight: TILE_SIZE,
                minimumLevel: 0,
                maximumLevel: 14,
            });
        } catch (e) {
            res.status(500).json({ error: 'meta_read_failed', details: String(e) });
        }
    });

    // GET /heightmap/:projectId/:z/:x/:y.bin
    router.get('/heightmap/:projectId/:z/:x/:y.bin', async (req, res) => {
        try {
            const projectId = String(req.params.projectId || '').trim();
            const z = parseInt(req.params.z, 10);
            const x = parseInt(req.params.x, 10);
            const y = parseInt(req.params.y, 10);
            if (!projectId || !Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
                return res.status(400).send('bad_tile_coords');
            }
            const demPath = path.join(hydroCacheRoot, projectId, 'dem.tif');
            if (!fs.existsSync(demPath)) return res.status(404).send('hydro_dem_not_built');

            const expectedBytes = TILE_SIZE * TILE_SIZE * 4;
            const tilePath = path.join(heightmapCacheRoot, projectId, String(z), String(x), `${y}.bin`);

            // Cache hit
            if (fs.existsSync(tilePath)) {
                res.setHeader('Content-Type', 'application/octet-stream');
                res.setHeader('Cache-Control', 'public, max-age=3600');
                return fs.createReadStream(tilePath).pipe(res);
            }

            const buf = await spawnPyBinary(pyHeightmapTile, {
                demTif: demPath,
                z, x, y, size: TILE_SIZE
            }, expectedBytes);

            // Guardar en cache
            try {
                fs.mkdirSync(path.dirname(tilePath), { recursive: true });
                fs.writeFileSync(tilePath, buf);
            } catch (e) { /* ignorar errores de cache */ }

            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.end(buf);
        } catch (err) {
            console.error(`[${pluginSlug}] heightmap tile failed:`, err);
            res.status(500).send('heightmap_failed');
        }
    });

    // API: Guardar Logo
    router.post('/admin/api/upload-logo', requireAdmin, memoryUpload.single('logo'), async (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const ext = path.extname(req.file.originalname).toLowerCase() || '.png';
        const filename = `logo_${Date.now()}${ext}`;
        const output = path.join(uploadsDir, filename);
        fs.writeFileSync(output, req.file.buffer);
        res.json({ filename, url: `/plugins/${pluginSlug}/uploads/${filename}` });
    });

    // API: Listar mapas
    router.get('/admin/api/maps', requireAdmin, (req, res) => {
        res.json(readMaps());
    });

    // API: Guardar mapas
    router.post('/admin/api/maps', requireAdmin, express.json(), (req, res) => {
        if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected array' });
        writeMaps(req.body);
        res.json({ success: true });
    });

    router.get('/api/status', requireAdmin, (_req, res) => {
        const maps = readMaps();
        const cesiumState = readCesiumState();
        const cesiumInstalled = hasCesiumInstall();
        res.json({
            plugin: pluginSlug,
            scenes: maps.length,
            modules: PLANNER_MODULES,
            dataDir: pluginDataDir,
            plannerSource: 'CesiumJS',
            settings: readSettings(),
            cesium: {
                installed: cesiumInstalled,
                repo: cesiumState.repo || DEFAULT_CESIUM_REPO,
                version: cesiumState.version || '',
                installedAt: cesiumState.installedAt || null,
                lastError: cesiumState.lastError || null,
                url: cesiumInstalled ? `/plugins/${pluginSlug}/cesium/Cesium.js` : null,
                widgetsUrl: cesiumInstalled ? `/plugins/${pluginSlug}/cesium/Widgets/widgets.css` : null
            }
        });
    });

    router.get('/api/settings', requireAdmin, (_req, res) => {
        res.json({ settings: readSettings() });
    });

    router.post('/api/settings', requireAdmin, express.json({ limit: '256kb' }), (req, res) => {
        const current = readSettings();
        const next = writeSettings({ ...current, ...(req.body || {}) });
        res.json({ status: 'saved', settings: next });
    });

    router.get('/api/cesium/releases', requireAdmin, async (req, res) => {
        try {
            const repo = String(req.query?.repo || DEFAULT_CESIUM_REPO).trim();
            const includePrerelease = req.query?.prerelease === '1' || req.query?.prerelease === 'true';
            const releases = await fetchGitHubReleases(repo, { includePrerelease, maxResults: 40 });
            res.json({ releases, repo, defaultVersion: DEFAULT_CESIUM_VERSION });
        } catch (err) {
            res.status(502).json({ error: 'github_fetch_failed', details: String(err?.message || err) });
        }
    });

    router.post('/api/cesium/install', requireAdmin, express.json({ limit: '256kb' }), async (req, res) => {
        const repo = String(req.body?.repo || DEFAULT_CESIUM_REPO).trim();
        const version = String(req.body?.version || '').trim();
        let assetUrl = String(req.body?.assetUrl || '').trim();
        let tempDir = '';
        try {
            if (!assetUrl) {
                const releases = await fetchGitHubReleases(repo, { includePrerelease: true, maxResults: 80 });
                const release = releases.find((item) => item.tag === version || item.name === version) || releases[0];
                assetUrl = release?.assetUrl || '';
            }
            if (!assetUrl) return res.status(400).json({ error: 'cesium_asset_required' });
            tempDir = await fs.promises.mkdtemp(path.join(pluginDataDir, 'cesium-install-'));
            const zipPath = path.join(tempDir, 'cesium.zip');
            const extractDir = path.join(tempDir, 'extract');
            await fs.promises.mkdir(extractDir, { recursive: true });
            const response = await fetch(assetUrl, { headers: { 'User-Agent': 'Qtiler-3D-eye/1.0' } });
            if (!response.ok) throw new Error(`download_failed_http_${response.status}`);
            await fs.promises.writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(extractDir, true);
            const buildRoot = await findCesiumBuildRoot(extractDir);
            if (!buildRoot) throw new Error('cesium_build_not_found');
            await removeRecursive(cesiumInstallRoot);
            await copyRecursive(buildRoot, cesiumInstallRoot);
            writeCesiumState({ repo, version, installedAt: nowIso(), lastError: null });
            res.json({ status: 'installed', repo, version, url: `/plugins/${pluginSlug}/cesium/Cesium.js` });
        } catch (err) {
            writeCesiumState({ repo, version, installedAt: hasCesiumInstall() ? readCesiumState().installedAt : null, lastError: String(err?.message || err) });
            res.status(500).json({ error: 'cesium_install_failed', details: String(err?.message || err) });
        } finally {
            if (tempDir) await removeRecursive(tempDir).catch(() => {});
        }
    });

    router.delete('/api/cesium/install', requireAdmin, async (_req, res) => {
        try {
            await removeRecursive(cesiumInstallRoot);
            writeCesiumState({ ...readCesiumState(), installedAt: null, lastError: null });
            res.json({ status: 'uninstalled' });
        } catch (err) {
            res.status(500).json({ error: 'cesium_uninstall_failed', details: String(err?.message || err) });
        }
    });

    router.get('/api/modules', requireAdmin, (_req, res) => {
        res.json({ modules: PLANNER_MODULES, defaults: defaultModulesState() });
    });

    router.get('/api/assets', requireAdmin, (_req, res) => {
        res.json({ assets: readAssets().map(publicAssetRecord), terrains: listReusableTerrains() });
    });

    router.get('/api/style-presets', requireAdmin, (_req, res) => {
        res.json({ presets: readStylePresets() });
    });

    router.post('/api/style-presets', requireAdmin, express.json({ limit: '256kb' }), (req, res) => {
        const preset = normalizeStylePreset(req.body || {});
        if (!preset.name) return res.status(400).json({ error: 'name_required' });
        const presets = readStylePresets();
        const idx = presets.findIndex((item) => item.id === preset.id);
        if (idx >= 0) {
            preset.createdAt = presets[idx].createdAt || preset.createdAt;
            presets[idx] = preset;
        } else {
            presets.push(preset);
        }
        writeStylePresets(presets);
        res.json({ status: idx >= 0 ? 'updated' : 'created', preset });
    });

    router.delete('/api/style-presets/:presetId', requireAdmin, (req, res) => {
        const presetId = sanitizeFileToken(req.params.presetId || '');
        const presets = readStylePresets();
        const next = presets.filter((item) => item.id !== presetId);
        if (next.length === presets.length) return res.status(404).json({ error: 'preset_not_found' });
        writeStylePresets(next);
        res.json({ status: 'deleted', id: presetId });
    });

    router.get('/api/layer-attributes', requireAdmin, async (req, res) => {
        try {
            const projectId = normalizeProjectId(req.query.project || req.query.projectId || '');
            const layerNameValue = String(req.query.layer || req.query.layerName || '').trim();
            const limit = Number.isFinite(Number(req.query.limit)) ? Math.max(25, Math.min(2000, Math.floor(Number(req.query.limit)))) : 500;
            if (!projectId) return res.status(400).json({ error: 'project_required' });
            if (!layerNameValue) return res.status(400).json({ error: 'layer_required' });
            if (!userCanAccessProject(req, projectId)) return res.status(403).json({ error: 'forbidden' });
            const catalog = readCacheIndex(projectId);
            const layer = (Array.isArray(catalog?.layers) ? catalog.layers : []).find((item) => layerName(item) === layerNameValue || layerTitle(item) === layerNameValue);
            if (!layer || !isVectorLayer(layer)) return res.json({ projectId, layer: layerNameValue, fields: [], sampledFeatures: 0 });
            const url = new URL('/wfs', getRequestBaseUrl(req));
            url.searchParams.set('project', projectId);
            url.searchParams.set('SERVICE', 'WFS');
            url.searchParams.set('VERSION', '1.1.0');
            url.searchParams.set('REQUEST', 'GetFeature');
            url.searchParams.set('TYPENAME', layerName(layer));
            url.searchParams.set('OUTPUTFORMAT', 'application/json');
            url.searchParams.set('SRSNAME', 'EPSG:4326');
            url.searchParams.set('COUNT', String(limit));
            url.searchParams.set('MAXFEATURES', String(limit));
            const response = await fetch(url, { headers: { cookie: req.headers.cookie || '' } });
            if (!response.ok) return res.status(response.status).json({ error: `wfs_http_${response.status}` });
            const geojson = await response.json();
            const fields = new Map();
            for (const feature of Array.isArray(geojson?.features) ? geojson.features : []) {
                const properties = feature?.properties && typeof feature.properties === 'object' ? feature.properties : {};
                for (const [key, value] of Object.entries(properties)) {
                    if (!fields.has(key)) fields.set(key, { name: key, type: 'empty', values: new Set(), count: 0 });
                    const field = fields.get(key);
                    field.count += 1;
                    if (value !== null && value !== undefined && value !== '') {
                        if (field.type === 'empty') field.type = Number.isFinite(Number(value)) && String(value).trim() !== '' ? 'number' : 'text';
                        else if (field.type === 'number' && !Number.isFinite(Number(value))) field.type = 'text';
                        if (field.values.size < 80) field.values.add(String(value));
                    }
                }
            }
            res.json({
                projectId,
                layer: layerName(layer),
                sampledFeatures: Array.isArray(geojson?.features) ? geojson.features.length : 0,
                fields: Array.from(fields.values()).map((field) => ({ ...field, values: Array.from(field.values).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) })).sort((a, b) => a.name.localeCompare(b.name))
            });
        } catch (err) {
            res.status(500).json({ error: 'layer_attributes_failed', details: String(err?.message || err) });
        }
    });

    router.get('/api/project-layers', requireAdmin, (req, res) => {
        const projectId = normalizeProjectId(req.query.project || req.query.projectId || '');
        if (!projectId) return res.status(400).json({ error: 'project_required' });
        const index = readCacheIndex(projectId);
        const layers = Array.isArray(index?.layers) ? index.layers.map((layer) => normalizeProjectLayer(projectId, layer)) : [];
        const qgis3dLayers = readQgis3dLayerConfig(projectId);
        const qwc3dTiles = discoverQwc3dTiles(projectId);
        res.json({
            projectId,
            projectFile: index?.project || null,
            extent: index?.extent_wgs84 || index?.project_extent_wgs84 || layers.find((layer) => Array.isArray(layer.extent))?.extent || null,
            crs: index?.crs || index?.project_crs || layers.find((layer) => layer.crs)?.crs || null,
            layers,
            qgis3d: {
                available: qgis3dLayers.length > 0,
                layers: qgis3dLayers
            },
            view3d: {
                available: qgis3dLayers.length > 0,
                layers: qgis3dLayers,
                qwc2Tiles3d: qwc3dTiles
            },
            terrains: listReusableTerrains().filter((terrain) => terrain.project === projectId || terrain.projectId === projectId || terrain.name === projectId)
        });
    });

    router.post('/api/qgis3d-tiles/build', requireAdmin, express.json({ limit: '1mb' }), async (req, res) => {
        const projectId = normalizeProjectId(req.body?.projectId || req.body?.project || '');
        const layerNameValue = String(req.body?.layerName || req.body?.name || '').trim();
        const sceneId = String(req.body?.sceneId || '').trim();
        const maxFeatures = Number.isFinite(Number(req.body?.maxFeatures)) && Number(req.body.maxFeatures) > 0 ? Math.floor(Number(req.body.maxFeatures)) : 0;
        const pageSize = Number.isFinite(Number(req.body?.pageSize)) ? Math.max(100, Math.floor(Number(req.body.pageSize))) : 20000;
        if (!projectId) return res.status(400).json({ error: 'project_required' });
        if (!layerNameValue) return res.status(400).json({ error: 'layer_required' });
        if (!userCanAccessProject(req, projectId)) return res.status(403).json({ error: 'forbidden' });
        const qgisLayer = readQgis3dLayerConfig(projectId).find((item) => item.name === layerNameValue || item.title === layerNameValue);
        if (!qgisLayer) return res.status(404).json({ error: 'qgis3d_layer_not_found' });

        const scene = sceneId ? readScene(sceneId) : null;
        const requestStyle = req.body?.style && typeof req.body.style === 'object' ? req.body.style : null;
        const sceneStyle = requestStyle || (scene?.mainLayers || []).find((layer) => String(layer.name || '').trim() === qgisLayer.name) || {};
        const terrainRecords = readTerrains().map(normalizeTerrainRecord);
        const demPath = (scene?.terrainProjects || [])
            .map((terrainId) => terrainRecords.find((terrain) => terrain.id === terrainId || terrain.sourceProjectId === terrainId))
            .find((terrain) => terrain?.demPath && fs.existsSync(terrain.demPath))?.demPath || '';
        const requestedExtrusionHeight = Number(req.body?.extrusionHeight);
        const styledExtrusionHeight = Number(sceneStyle.extrusionHeight);
        const qgisExtrusionHeight = Number(qgisLayer.extrusionHeight || 10);
        const extrusionHeight = Number.isFinite(requestedExtrusionHeight) && requestedExtrusionHeight > 0
            ? requestedExtrusionHeight
            : (Number.isFinite(styledExtrusionHeight) && styledExtrusionHeight > 0 ? styledExtrusionHeight : Math.max(0.1, qgisExtrusionHeight));
        const color = String(req.body?.color || sceneStyle.color || qgisLayer.color || '#bf5108').trim();
        const assetId = qgis3dTilesAssetId(projectId, qgisLayer.name);
        const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const job = {
            id: jobId,
            assetId,
            projectId,
            layerName: qgisLayer.name,
            status: 'running',
            progress: 5,
            startedAt: nowIso(),
            endedAt: null,
            error: null,
            asset: null,
            result: null
        };
        qgis3dTileJobs.set(jobId, job);

        (async () => {
            const targetDir = path.join(tiles3dRoot, assetId);
            const tmpDir = path.join(assetUploadTmp, `${assetId}_${jobId}`);
            try {
                job.progress = 10;
                await fs.promises.rm(tmpDir, { recursive: true, force: true });
                await fs.promises.mkdir(tmpDir, { recursive: true });
                const baseUrl = getRequestBaseUrl(req);
                const bounds = projectWgs84Bounds(projectId);
                const mergedGeojson = { type: 'FeatureCollection', features: [] };
                let startIndex = 0;
                let pageCount = 0;
                while (true) {
                    const remaining = maxFeatures > 0 ? Math.max(0, maxFeatures - mergedGeojson.features.length) : pageSize;
                    if (maxFeatures > 0 && remaining <= 0) break;
                    const limit = maxFeatures > 0 ? Math.min(pageSize, remaining) : pageSize;
                    const url = new URL('/wfs', baseUrl);
                    url.searchParams.set('project', projectId);
                    url.searchParams.set('SERVICE', 'WFS');
                    url.searchParams.set('VERSION', '1.1.0');
                    url.searchParams.set('REQUEST', 'GetFeature');
                    url.searchParams.set('TYPENAME', qgisLayer.name);
                    url.searchParams.set('OUTPUTFORMAT', 'application/json');
                    url.searchParams.set('SRSNAME', 'EPSG:4326');
                    url.searchParams.set('COUNT', String(limit));
                    url.searchParams.set('MAXFEATURES', String(limit));
                    url.searchParams.set('STARTINDEX', String(startIndex));
                    if (bounds) url.searchParams.set('BBOX', `${bounds.join(',')},EPSG:4326`);
                    job.progress = Math.min(42, 20 + pageCount * 2);
                    job.downloadedFeatures = mergedGeojson.features.length;
                    const response = await fetch(url, { headers: { cookie: req.headers.cookie || '' } });
                    if (!response.ok) throw new Error(`wfs_http_${response.status}`);
                    const page = await response.json();
                    const features = Array.isArray(page?.features) ? page.features : [];
                    if (!features.length) break;
                    mergedGeojson.features.push(...features);
                    pageCount += 1;
                    job.downloadedFeatures = mergedGeojson.features.length;
                    job.downloadedPages = pageCount;
                    startIndex += features.length;
                    if (features.length < limit) break;
                    if (pageCount > 1000) throw new Error('wfs_pagination_guard');
                }
                const geojsonPath = path.join(tmpDir, 'source.geojson');
                await fs.promises.writeFile(geojsonPath, JSON.stringify(mergedGeojson), 'utf8');
                job.progress = 45;
                await fs.promises.rm(targetDir, { recursive: true, force: true });
                await fs.promises.mkdir(targetDir, { recursive: true });
                const result = await spawnPyJson(pyBuildQgis3dTiles, {
                    geojsonPath,
                    outputDir: targetDir,
                    extrusionHeight,
                    color,
                    demPath,
                    style: normalizeLayerStyle({ ...sceneStyle, color: sceneStyle.color || qgisLayer.color || color, extrusionHeight }),
                    chunkSize: Number.isFinite(Number(req.body?.chunkSize)) ? Math.max(50, Math.floor(Number(req.body.chunkSize))) : 450
                });
                if (!result.ok) throw new Error(`${result.error || '3dtiles_failed'}: ${String(result.details || '').slice(0, 1000)}`);
                job.progress = 85;
                const assets = readAssets().map(normalizeAssetRecord);
                const existing = assets.find((asset) => asset.id === assetId);
                const record = normalizeAssetRecord({
                    id: assetId,
                    name: `${qgisLayer.title || qgisLayer.name} 3D Tiles`,
                    type: '3dtiles',
                    url: `/plugins/${pluginSlug}/assets/3dtiles/${assetId}/tileset.json`,
                    originalName: `${projectId}/${qgisLayer.name}`,
                    folderName: assetId,
                    visible: true,
                    createdAt: existing?.createdAt || nowIso(),
                    updatedAt: nowIso(),
                    metadata: {
                        source: 'qgis3d-tiles',
                        projectId,
                        layerName: qgisLayer.name,
                        extrusionHeight,
                        color,
                        styleProfile: 'face-shaded-flat-roofs-v2',
                        demPath: demPath || null,
                        generatedAt: nowIso(),
                        features: result.features || null,
                        downloadedFeatures: mergedGeojson.features.length,
                        tiles: result.tiles || null
                    }
                });
                const idx = assets.findIndex((asset) => asset.id === assetId);
                if (idx >= 0) assets[idx] = record;
                else assets.push(record);
                writeAssets(assets);
                await fs.promises.rm(tmpDir, { recursive: true, force: true });
                job.progress = 100;
                job.status = 'completed';
                job.asset = publicAssetRecord(record);
                job.result = result;
                job.endedAt = nowIso();
            } catch (err) {
                job.status = 'error';
                job.error = String(err?.message || err);
                job.endedAt = nowIso();
                try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
                console.error(`[${pluginSlug}] qgis3d tiles job ${jobId} failed:`, err);
            }
        })();

        res.json({ jobId, status: job.status, assetId, projectId, layerName: qgisLayer.name });
    });

    router.get('/api/qgis3d-tiles/job/:jobId', requireAdmin, (req, res) => {
        const job = qgis3dTileJobs.get(String(req.params.jobId || ''));
        if (!job) return res.status(404).json({ error: 'job_not_found' });
        res.json(job);
    });

    router.get('/api/terrain-library', requireAdmin, (_req, res) => {
        res.json({ terrains: listReusableTerrains() });
    });

    router.delete('/api/terrain-library/generated/:terrainId', requireAdmin, (req, res) => {
        const terrainId = sanitizeFileToken(req.params.terrainId || '');
        if (!terrainId) return res.status(400).json({ error: 'terrain_required' });
        try {
            fs.rmSync(path.join(hydroCacheRoot, terrainId), { recursive: true, force: true });
            fs.rmSync(path.join(heightmapCacheRoot, terrainId), { recursive: true, force: true });
            fs.rmSync(path.join(quantizedMeshCacheRoot, terrainId), { recursive: true, force: true });
            writeTerrains(readTerrains().filter((terrain) => sanitizeFileToken(terrain.id || terrain.terrainId || terrain.name) !== terrainId));
            res.json({ status: 'deleted', id: terrainId });
        } catch (err) {
            res.status(500).json({ error: 'delete_failed', details: String(err?.message || err) });
        }
    });

    router.delete('/api/terrain-library/uploaded/:assetId', requireAdmin, async (req, res) => {
        const assetId = sanitizeFileToken(req.params.assetId || '');
        const assets = readAssets().map(normalizeAssetRecord);
        const asset = assets.find((item) => item.id === assetId && item.type === 'terrain');
        if (!asset) return res.status(404).json({ error: 'terrain_asset_not_found' });
        writeAssets(assets.filter((item) => item.id !== assetId));
        try { await fs.promises.rm(path.join(externalTerrainRoot, asset.folderName || asset.id), { recursive: true, force: true }); } catch {}
        res.json({ status: 'deleted', id: assetId });
    });

    router.get('/api/terrain-download/:projectId', requireAdmin, (req, res) => {
        const projectId = sanitizeFileToken(req.params.projectId || '');
        if (!projectId) return res.status(400).json({ error: 'project_required' });
        const candidates = [
            { dir: path.join(quantizedMeshCacheRoot, projectId), suffix: 'quantized-mesh' },
            { dir: path.join(hydroCacheRoot, projectId), suffix: 'heightmap-source' }
        ];
        const found = candidates.find((item) => fs.existsSync(item.dir));
        if (!found) return res.status(404).json({ error: 'terrain_not_found' });
        try {
            const zip = new AdmZip();
            addDirectoryToZip(zip, found.dir);
            const buf = zip.toBuffer();
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${projectId}-${found.suffix}.zip"`);
            res.end(buf);
        } catch (err) {
            res.status(500).json({ error: 'zip_failed', details: String(err?.message || err) });
        }
    });

    router.post('/api/assets/upload', requireAdmin, assetUpload.array('files', 20), async (req, res) => {
        const requestedType = String(req.body?.assetType || req.body?.type || '').trim().toLowerCase();
        const files = Array.isArray(req.files) ? req.files : [];
        if (!files.length) return res.status(400).json({ error: 'files_required' });
        const assets = readAssets().map(normalizeAssetRecord);
        const uploaded = [];
        const rejected = [];

        for (const file of files) {
            const originalName = file.originalname || file.filename;
            const ext = path.extname(originalName).toLowerCase();
            const baseName = sanitizeFileToken(path.basename(originalName, ext)) || `asset_${Date.now()}`;
            const assetId = sanitizeFileToken(`${Date.now()}_${baseName}_${Math.random().toString(36).slice(2, 6)}`);
            try {
                let record = null;
                if (['.gltf', '.glb', '.czml', '.kml', '.kmz', '.geojson'].includes(ext) && (!requestedType || requestedType === 'model' || requestedType === '3d')) {
                    const targetName = `${assetId}${ext}`;
                    const targetPath = path.join(modelsRoot, targetName);
                    await fs.promises.rename(file.path, targetPath);
                    record = normalizeAssetRecord({
                        id: assetId,
                        name: path.basename(originalName, ext),
                        type: ext === '.czml' ? 'czml' : (ext === '.geojson' ? 'geojson' : (ext === '.kml' || ext === '.kmz' ? 'kml' : 'model')),
                        url: `/plugins/${pluginSlug}/assets/models/${targetName}`,
                        originalName,
                        fileName: targetName
                    });
                } else if (ext === '.zip' && (requestedType === '3dtiles' || requestedType === 'tiles' || requestedType === 'terrain')) {
                    const targetRoot = requestedType === 'terrain' ? externalTerrainRoot : tiles3dRoot;
                    const targetDir = path.join(targetRoot, assetId);
                    await fs.promises.mkdir(targetDir, { recursive: true });
                    const extractDir = path.join(assetUploadTmp, `${assetId}_extract`);
                    await fs.promises.mkdir(extractDir, { recursive: true });
                    const zip = new AdmZip(file.path);
                    zip.extractAllTo(extractDir, true);
                    const requiredName = requestedType === 'terrain' ? 'layer.json' : 'tileset.json';
                    const requiredFile = await findFileRecursive(extractDir, requiredName);
                    if (!requiredFile) throw new Error(`${requiredName}_missing`);
                    await moveDirectoryContents(path.dirname(requiredFile), targetDir);
                    await fs.promises.rm(extractDir, { recursive: true, force: true });
                    await fs.promises.rm(file.path, { force: true });
                    record = normalizeAssetRecord({
                        id: assetId,
                        name: path.basename(originalName, ext),
                        type: requestedType === 'terrain' ? 'terrain' : '3dtiles',
                        url: requestedType === 'terrain'
                            ? `/plugins/${pluginSlug}/assets/terrain/${assetId}/`
                            : `/plugins/${pluginSlug}/assets/3dtiles/${assetId}/${requiredName}`,
                        originalName,
                        folderName: assetId
                    });
                } else {
                    throw new Error(`unsupported_${ext || 'file'}`);
                }
                assets.push(record);
                uploaded.push(record);
            } catch (err) {
                rejected.push({ name: originalName, error: String(err?.message || err) });
                try { await fs.promises.rm(file.path, { force: true }); } catch {}
            }
        }

        writeAssets(assets);
        res.status(uploaded.length ? 200 : 400).json({ uploaded, rejected, assets });
    });

    router.post('/api/assets/link', requireAdmin, express.json({ limit: '256kb' }), async (req, res) => {
        const url = String(req.body?.url || '').trim();
        const name = String(req.body?.name || '').trim();
        if (!/^https?:\/\//i.test(url) && !/^\/[^/]/.test(url)) return res.status(400).json({ error: 'valid_url_required' });
        if (!/\.(gltf|glb)(\?|#|$)/i.test(url)) return res.status(400).json({ error: 'gltf_or_glb_url_required' });
        let timer = null;
        try {
            const checkUrl = /^https?:\/\//i.test(url) ? url : new URL(url, getRequestBaseUrl(req)).toString();
            const controller = new AbortController();
            timer = setTimeout(() => controller.abort(), 8000);
            let response = await fetch(checkUrl, { method: 'HEAD', signal: controller.signal });
            if (response.status === 405 || response.status === 403) response = await fetch(checkUrl, { method: 'GET', signal: controller.signal });
            clearTimeout(timer);
            if (!response.ok) return res.status(400).json({ error: 'model_url_not_reachable', details: `HTTP ${response.status}` });
        } catch (err) {
            if (timer) clearTimeout(timer);
            return res.status(400).json({ error: 'model_url_not_reachable', details: String(err?.message || err) });
        }
        const assets = readAssets().map(normalizeAssetRecord);
        const assetId = sanitizeFileToken(`link_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
        const fallbackName = url.split('/').pop()?.split(/[?#]/)[0]?.replace(/\.(gltf|glb)$/i, '') || assetId;
        const record = normalizeAssetRecord({
            id: assetId,
            name: name || fallbackName,
            type: 'model',
            url,
            originalName: url,
            readonly: true
        });
        assets.push(record);
        writeAssets(assets);
        res.json({ asset: publicAssetRecord(record), assets: assets.map(publicAssetRecord) });
    });

    router.get('/api/assets/:assetId/model', async (req, res) => {
        const assetId = sanitizeFileToken(req.params.assetId || '');
        const asset = readAssets().map(normalizeAssetRecord).find((item) => item.id === assetId && item.type === 'model');
        if (!asset) return res.status(404).json({ error: 'model_asset_not_found' });
        try {
            const ext = path.extname(asset.fileName || asset.url || '').toLowerCase();
            if (ext === '.glb') res.setHeader('Content-Type', 'model/gltf-binary');
            else res.setHeader('Content-Type', 'model/gltf+json');
            if (asset.fileName) {
                const filePath = path.join(modelsRoot, asset.fileName);
                if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file_not_found' });
                return res.sendFile(filePath);
            }
            if (!/^https?:\/\//i.test(asset.url)) return res.status(404).json({ error: 'model_url_missing' });
            const upstream = await fetch(asset.url);
            if (!upstream.ok) return res.status(502).json({ error: 'model_fetch_failed', details: `HTTP ${upstream.status}` });
            const contentType = upstream.headers.get('content-type');
            if (contentType) res.setHeader('Content-Type', contentType);
            return res.send(Buffer.from(await upstream.arrayBuffer()));
        } catch (err) {
            return res.status(500).json({ error: 'model_proxy_failed', details: String(err?.message || err) });
        }
    });

    router.get('/api/asset-preview-config/:assetId', requireAdmin, (req, res) => {
        const assetId = sanitizeFileToken(req.params.assetId || '');
        const asset = readAssets().map(normalizeAssetRecord).find((item) => item.id === assetId);
        if (!asset) return res.status(404).json({ error: 'asset_not_found' });
        res.json({
            scene: { id: `asset:${asset.id}`, title: asset.name || asset.id, assetPreview: true },
            access: { canView: true, canEdit: true, projects: {}, terrains: {} },
            config: {
                previewMode: 'asset',
                cesiumToken: '',
                modules: { layers: true, models: true, bookmarks: true, measurement: false, redline: false, print: false },
                layers: [],
                terrains: [],
                assets: [publicAssetRecord({ ...asset, placement: { ...(asset.placement || {}), longitude: 0, latitude: 0, height: 0 } })],
                warnings: ['asset_preview_no_terrain'],
                savedViews: []
            }
        });
    });

    router.post('/api/assets/:assetId/placement', requireAdmin, express.json({ limit: '1mb' }), (req, res) => {
        const assetId = sanitizeFileToken(req.params.assetId || '');
        const assets = readAssets().map(normalizeAssetRecord);
        const idx = assets.findIndex((asset) => asset.id === assetId);
        if (idx < 0) return res.status(404).json({ error: 'asset_not_found' });
        assets[idx] = normalizeAssetRecord({ ...assets[idx], placement: req.body?.placement || req.body || {}, updatedAt: nowIso() });
        writeAssets(assets);
        res.json({ asset: assets[idx] });
    });

    router.get('/api/assets/:assetId/download', requireAdmin, async (req, res) => {
        const assetId = sanitizeFileToken(req.params.assetId || '');
        const asset = readAssets().map(normalizeAssetRecord).find((item) => item.id === assetId);
        if (!asset) return res.status(404).json({ error: 'asset_not_found' });
        try {
            if (asset.fileName) {
                const filePath = path.join(modelsRoot, asset.fileName);
                if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file_not_found' });
                return res.download(filePath, asset.originalName || asset.fileName);
            }
            if (asset.type === 'model' && /^https?:\/\//i.test(asset.url || '')) {
                const upstream = await fetch(asset.url);
                if (!upstream.ok) return res.status(502).json({ error: 'model_fetch_failed', details: `HTTP ${upstream.status}` });
                const contentType = upstream.headers.get('content-type');
                if (contentType) res.setHeader('Content-Type', contentType);
                res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFileToken(asset.name || asset.id)}${path.extname(asset.url).split(/[?#]/)[0] || '.gltf'}"`);
                return res.send(Buffer.from(await upstream.arrayBuffer()));
            }
            const root = asset.type === 'terrain' ? externalTerrainRoot : tiles3dRoot;
            const dir = path.join(root, asset.folderName || asset.id);
            if (!fs.existsSync(dir)) return res.status(404).json({ error: 'folder_not_found' });
            const zip = new AdmZip();
            addDirectoryToZip(zip, dir);
            const buf = zip.toBuffer();
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFileToken(asset.name || asset.id)}.zip"`);
            return res.end(buf);
        } catch (err) {
            return res.status(500).json({ error: 'download_failed', details: String(err?.message || err) });
        }
    });

    router.get('/api/terrain-preview-config', requireAdmin, (req, res) => {
        const terrainId = sanitizeFileToken(req.query.terrain || req.query.terrainId || '');
        const assetId = sanitizeFileToken(req.query.terrainAsset || req.query.assetId || '');
        let terrain = null;
        let title = 'Terrain preview';
        if (assetId) {
            const asset = readAssets().map(normalizeAssetRecord).find((item) => item.id === assetId && item.type === 'terrain');
            if (!asset) return res.status(404).json({ error: 'terrain_asset_not_found' });
            title = asset.name || asset.id;
            terrain = {
                key: `asset-terrain:${asset.id}`,
                name: title,
                assetId: asset.id,
                type: 'quantized-mesh',
                visible: true,
                terrainUrl: asset.url,
                bounds: readUploadedTerrainBounds(asset),
                hasTerrainCache: true,
                hasHydroTerrain: false,
                rasterLayers: []
            };
        } else if (terrainId) {
            const record = readTerrains().map(normalizeTerrainRecord).find((item) => item.id === terrainId) || normalizeTerrainRecord({ id: terrainId, name: terrainId });
            const info = getTerrainInfo(terrainId);
            if (!info.hasHydroTerrain && !info.hasTerrainCache) return res.status(404).json({ error: 'terrain_not_found' });
            title = record.name || terrainId;
            const sourceIndex = record.sourceProjectId ? readCacheIndex(record.sourceProjectId) : null;
            const sourceBounds = sourceIndex?.extent_wgs84 || sourceIndex?.project_extent_wgs84 || null;
            terrain = {
                key: `terrain:${terrainId}`,
                name: title,
                projectId: terrainId,
                sourceProjectId: record.sourceProjectId || null,
                type: info.hasHydroTerrain ? 'heightmap' : 'quantized-mesh',
                visible: true,
                ...info,
                bounds: readTerrainBounds(terrainId) || info.bounds || sourceBounds || null
            };
        } else {
            return res.status(400).json({ error: 'terrain_required' });
        }
        res.json({
            schema: 'qtiler-3d-eye.terrain-preview.v1',
            plugin: pluginSlug,
            generatedAt: nowIso(),
            scene: { id: `preview-${terrain.key}`, title, mainProjectId: '', terrainPreview: true },
            config: {
                cesiumToken: '',
                modules: {},
                previewMode: 'terrain',
                layers: [],
                terrains: [terrain],
                assets: [],
                warnings: [],
                savedViews: []
            }
        });
    });

    router.delete('/api/assets/:assetId', requireAdmin, async (req, res) => {
        const assetId = sanitizeFileToken(req.params.assetId || '');
        const assets = readAssets().map(normalizeAssetRecord);
        const asset = assets.find((item) => item.id === assetId);
        if (!asset) return res.status(404).json({ error: 'asset_not_found' });
        const next = assets.filter((item) => item.id !== assetId);
        writeAssets(next);
        try {
            if (asset.fileName) await fs.promises.rm(path.join(modelsRoot, asset.fileName), { force: true });
            if (asset.folderName && asset.type === '3dtiles') await fs.promises.rm(path.join(tiles3dRoot, asset.folderName), { recursive: true, force: true });
            if (asset.folderName && asset.type === 'terrain') await fs.promises.rm(path.join(externalTerrainRoot, asset.folderName), { recursive: true, force: true });
        } catch {}
        res.json({ status: 'deleted', id: assetId });
    });

    router.get('/api/publish/list', requireAdmin, (_req, res) => {
        res.json({ scenes: readMaps() });
    });

    router.get('/api/publish/:sceneId', requireAdmin, (req, res) => {
        const scene = readScene(String(req.params.sceneId || ''));
        if (!scene) return res.status(404).json({ error: 'scene_not_found' });
        res.json({ scene });
    });

    router.post('/api/publish', requireAdmin, express.json({ limit: '2mb' }), (req, res) => {
        if (!hasCesiumInstall()) {
            return res.status(409).json({
                error: 'cesium_runtime_required',
                details: 'Install the Cesium runtime before creating or publishing 3D maps.'
            });
        }
        const profile = normalizeSceneProfile(req.body || {});
        if (!profile.mainProjectId) return res.status(400).json({ error: 'main_project_required' });
        const maps = readMaps();
        const idx = maps.findIndex((item) => item.id === profile.id);
        if (idx >= 0) {
            profile.createdAt = maps[idx].createdAt || profile.createdAt;
            maps[idx] = profile;
        } else {
            maps.push(profile);
        }
        writeMaps(maps);
        res.json({ status: idx >= 0 ? 'updated' : 'created', scene: profile, url: `/plugins/${pluginSlug}/view/?scene=${encodeURIComponent(profile.id)}` });
    });

    router.post('/api/publish/:sceneId/precache-backgrounds', requireAdmin, express.json({ limit: '256kb' }), async (req, res) => {
        const scene = readScene(String(req.params.sceneId || ''));
        if (!scene) return res.status(404).json({ error: 'scene_not_found' });
        try {
            const result = await precacheBackgrounds(scene, req);
            res.json({ status: 'completed', ...result });
        } catch (err) {
            res.status(500).json({ error: 'precache_failed', details: String(err?.message || err) });
        }
    });

    router.delete('/api/publish/:sceneId', requireAdmin, (req, res) => {
        const sceneId = String(req.params.sceneId || '').trim();
        const maps = readMaps();
        const next = maps.filter((item) => item.id !== sceneId);
        if (next.length === maps.length) return res.status(404).json({ error: 'scene_not_found' });
        writeMaps(next);
        res.json({ status: 'deleted', id: sceneId });
    });

    router.get('/api/view-config/:sceneId', async (req, res) => {
        const scene = readScene(String(req.params.sceneId || ''));
        if (!scene) return res.status(404).json({ error: 'scene_not_found' });
        if (!userCanAccessProject(req, scene.mainProjectId)) return res.status(403).json({ error: 'forbidden' });
        res.json(buildViewerConfig(scene, req));
    });

    // 2. Client Viewer
    router.use('/view', express.static(path.join(baseDir, 'client')));
    router.use('/uploads', express.static(uploadsDir));

    // Endpoint de catálogo
    router.get('/catalog', async (req, res) => {
        try {
            const maps = readMaps();
            const allowedMaps = [];
            for (const map of maps) {
                if (userCanAccessProject(req, map.mainProjectId)) {
                    allowedMaps.push(map);
                }
            }
            res.json(allowedMaps);
        } catch (e) {
            console.error('Catalog error', e);
            res.status(500).json({ error: 'Internal error' });
        }
    });

    // Redirige
    router.get('/', (req, res) => {
        res.redirect(`/plugins/${pluginSlug}/view/`);
    });

    // Info del Terreno (Cesium 3D) + detección de capas raster (tif/dtm)
    router.get('/api/project-info', async (req, res) => {
        try {
            const project = req.query.project;
            if (!project) return res.status(400).json({ error: 'Missing project parameter' });

            const maps = readMaps();
            const mapConfig = maps.find(m => m.id === project || m.qgisProject === project || m.mainProjectId === project);
            const terrainInfo = getTerrainInfo(project);

            res.json({
                project: project,
                ...terrainInfo,
                hasTerrain: mapConfig ? (mapConfig.enableTerrain !== false && (terrainInfo.hasTerrainCache || terrainInfo.hasHydroTerrain)) : (terrainInfo.hasTerrainCache || terrainInfo.hasHydroTerrain),
                title: mapConfig ? mapConfig.title : project,
                logoUrl: mapConfig && mapConfig.logoConfig ? (mapConfig.logoConfig.url || null) : null
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.use(`/plugins/${pluginSlug}`, router);
    console.log(`[${pluginSlug}] Plugin montado correctamente.`);

    return {
        dispose: async () => {}
    };
};
