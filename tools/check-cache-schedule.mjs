import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const uiSource = fs.readFileSync('public/js/index.js', 'utf8');
const serverSource = fs.readFileSync('server.js', 'utf8');

test('cache theme extent and zoom settings are connected to manual and scheduled cache runs', () => {
  assert.match(uiSource, /toggleLayerExtentPanel\(project, themeObj, configTheme \|\| null, themeExtentContainer, showThemeExtentBtn, 'theme'\)/);
  assert.match(uiSource, /getThemeProjectedExtentPayload\(projectId, layerName/);
  assert.match(uiSource, /getThemeZoomRange\(projectId, layerName\)/);
  assert.match(uiSource, /targetType === 'layer'[\s\S]{0,100}getThemeZoomRange\(projectId, targetName\)/);
  assert.match(uiSource, /Automatic cache uses the saved theme extent/);
  assert.match(uiSource, /const configuredRange = String\(targetType\)\.toLowerCase\(\) === 'theme'[\s\S]{0,180}getLayerZoomRange\(projectId, layerName\)/);
  assert.match(uiSource, /resumeExisting: true/);
  assert.match(uiSource, /forcePurgeBeforeStart: true/);
  assert.match(uiSource, /The saved extent map will be used/);
  assert.match(uiSource, /showExistingCacheDialog/);
  assert.match(uiSource, /showThemeExtentBtn\.className = 'btn btn-secondary'/);
  assert.match(serverSource, /themePatch\.extent = normalizeExtentPatch\(info\.extent/);
  assert.match(serverSource, /themePatch\.extentWgs84 = normalizeExtentPatch\(info\.extentWgs84/);
  assert.match(serverSource, /themePatch\.zoom = \{/);
});

test('resuming an existing cache skips tiles already generated', () => {
  const start = serverSource.indexOf('const computeRecachePlan =');
  const end = serverSource.indexOf('\n};', start) + 3;
  assert.ok(start >= 0 && end > start);
  const context = { toIntOrNull: (value) => Number.isInteger(Number(value)) ? Number(value) : null };
  vm.createContext(context);
  vm.runInContext(`${serverSource.slice(start, end)}\nglobalThis.computePlan = computeRecachePlan;`, context);
  const result = context.computePlan({
    existingEntry: { last_zoom_min: 4, last_zoom_max: 10, tile_crs: 'EPSG:3857' },
    zoomMin: 4,
    zoomMax: 10,
    requestBody: { recache: { mode: 'resume' } }
  });
  assert.equal(result.mode, 'resume');
  assert.equal(result.skipExisting, true);
  assert.deepEqual({ min: result.previousZoom.min, max: result.previousZoom.max }, { min: 4, max: 10 });
});

test('theme config updates persist native extent, WGS84 extent, and zoom range', () => {
  const normalizeStart = serverSource.indexOf('const normalizeExtentPatch =');
  const normalizeEnd = serverSource.indexOf('\n};', normalizeStart) + 3;
  const builderStart = serverSource.indexOf('const buildProjectConfigPatch =');
  const builderEnd = serverSource.indexOf('\n};', builderStart) + 3;
  assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart && builderStart > normalizeEnd && builderEnd > builderStart);
  const context = {
    normalizePublishedCrs: (value) => value,
    buildSchedulePatch: (value) => value,
    limitScheduleHistory: (value) => value
  };
  vm.createContext(context);
  vm.runInContext(
    `${serverSource.slice(normalizeStart, normalizeEnd)}\n${serverSource.slice(builderStart, builderEnd)}\nglobalThis.buildPatch = buildProjectConfigPatch;`,
    context
  );
  const patch = context.buildPatch({
    themes: {
      background: {
        extent: { bbox: [100, 200, 300, 400], crs: 'EPSG:3006' },
        extentWgs84: { bbox: [10, 20, 30, 40], crs: 'EPSG:4326' },
        zoom: { min: 4, max: 12 }
      }
    }
  });
  assert.deepEqual(Array.from(patch.themes.background.extent.bbox), [100, 200, 300, 400]);
  assert.equal(patch.themes.background.extent.crs, 'EPSG:3006');
  assert.deepEqual(Array.from(patch.themes.background.extentWgs84.bbox), [10, 20, 30, 40]);
  assert.deepEqual(
    { min: patch.themes.background.zoom.min, max: patch.themes.background.zoom.max },
    { min: 4, max: 12 }
  );
});

test('scheduled themes use saved theme zoom and extent when no schedule override exists', () => {
  const start = serverSource.indexOf('const buildScheduledFallbackParams =');
  const end = serverSource.indexOf('\n};', start) + 3;
  assert.ok(start >= 0 && end > start);
  const context = {
    loadProjectIndexData: () => ({
      layers: [{ name: 'background', kind: 'theme', crs: 'EPSG:3006', tile_matrix_preset: 'sweref99' }]
    }),
    detectProjectCrs: () => 'EPSG:3857',
    deriveTileMatrixInfoForCrs: () => ({ presetId: 'fallback' })
  };
  vm.createContext(context);
  vm.runInContext(`${serverSource.slice(start, end)}\nglobalThis.buildFallback = buildScheduledFallbackParams;`, context);
  const result = context.buildFallback('project', 'theme', 'background', {
    cachePreferences: { allowRemote: true, throttleMs: 500 },
    zoom: { min: 1, max: 20 },
    themes: {
      background: {
        zoom: { min: 4, max: 12 },
        extent: { bbox: [100, 200, 300, 400], crs: 'EPSG:3006' }
      }
    }
  }, { zoomMin: null, zoomMax: null });
  assert.equal(result.zoom_min, 4);
  assert.equal(result.zoom_max, 12);
  assert.equal(result.project_extent, '100,200,300,400');
  assert.equal(result.extent_crs, 'EPSG:3006');
  assert.equal(result.tile_matrix_preset, 'sweref99');
  assert.equal(result.throttle_ms, 500);
});
