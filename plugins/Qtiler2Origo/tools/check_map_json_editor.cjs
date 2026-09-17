const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function sourceBetween(source, start, end) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt);
  assert.ok(startAt >= 0 && endAt > startAt, `Could not extract ${start}`);
  return source.slice(startAt, endAt);
}

async function testPlugin(plugin) {
  const js = fs.readFileSync(`plugins/${plugin}/admin-ui/app.js`, 'utf8');
  const html = fs.readFileSync(`plugins/${plugin}/admin-ui/index.html`, 'utf8');

  const loadLayers = sourceBetween(js, 'async function loadProjectLayers(', 'async function loadProjectsForPublish(');
  assert.ok(loadLayers.includes('retainedExtraLayers'), `${plugin}: main-project changes must preserve external layers`);
  assert.ok(!loadLayers.includes('publishState.extraLayers = [];'), `${plugin}: loadProjectLayers must not clear external layers`);

  const applyJson = sourceBetween(js, 'async function applyMapJsonChanges(', 'async function applyPendingMapJsonChanges(');
  assert.ok(applyJson.includes("await loadProjectLayers(mainProjectId, 'main')"), `${plugin}: JSON apply must load the selected main project`);
  assert.ok(applyJson.includes('await addExternalLayers(sourceProjectId, layers)'), `${plugin}: JSON apply must restore external layers`);
  assert.ok(js.includes('await applyPendingMapJsonChanges()'), `${plugin}: save actions must apply pending JSON`);

  for (const id of ['btn-json-import', 'map-json-import-file', 'btn-json-download', 'btn-json-undo', 'btn-json-redo', 'json-editor-live-status']) {
    assert.ok(html.includes(`id="${id}"`), `${plugin}: missing JSON editor control ${id}`);
  }

  const loadContext = {
    publishState: {
      mainLayers: [],
      extraLayers: [{ key: 'external::roads', name: 'roads', sourceProjectId: 'external' }],
      mainRules: { 'external::roads': { serveAsWfs: true } },
      initialVisibility: { 'external::roads': false },
      layerTitles: { 'external::roads': 'External roads' },
      layerOrder: ['external::roads'],
      projectLayerCatalog: {}
    },
    publishProjectSelect: { value: 'new-main' },
    api: async () => ({ layers: [{ name: 'buildings' }] }),
    normalizeLayersPayload: (_payload, options) => [{ key: 'buildings', name: 'buildings', sourceProjectId: options.sourceProjectId }],
    loadLayerRules: async () => ({ buildings: { searchable: false } }),
    getLayerKey: (layer) => layer.key || layer.name,
    getAllPublishLayers: () => [...loadContext.publishState.mainLayers, ...loadContext.publishState.extraLayers],
    ensureLayerOrderKeys: () => {},
    renderLayerChecklist: () => {},
    setCheckedLayerNames: (_host, keys) => { loadContext.checked = keys; },
    refreshExtraSections: () => {},
    projectLayersList: {},
    backgroundLayersList: {},
    refreshBackgroundOptions: () => {}
  };
  vm.createContext(loadContext);
  vm.runInContext(`${loadLayers}; globalThis.loadProjectLayersUnderTest = loadProjectLayers;`, loadContext);
  await loadContext.loadProjectLayersUnderTest('new-main', 'main');
  assert.deepEqual(loadContext.publishState.extraLayers.map((layer) => layer.key), ['external::roads'], `${plugin}: external layer disappeared after project change`);
  assert.equal(loadContext.publishState.mainRules['external::roads'].serveAsWfs, true, `${plugin}: external layer rule disappeared after project change`);
  assert.equal(loadContext.publishState.initialVisibility['external::roads'], false, `${plugin}: external visibility disappeared after project change`);
  assert.ok(loadContext.checked.includes('external::roads'), `${plugin}: external layer was not reselected after project change`);

  const importedConfig = {
    name: 'Imported map',
    projectId: 'main',
    layers: [
      { name: 'buildings', sourceProjectId: 'main', visible: true },
      { name: 'roads', sourceProjectId: 'external', visible: false, serveAsWfs: true, title: 'External roads' }
    ],
    backgrounds: [], controls: [], groups: [], features: { searchSources: [] }
  };
  const applyContext = {
    inspectMapJson: () => ({ valid: true, config: importedConfig }),
    setPublishModalTab: () => {},
    publishProjectSelect: { value: '', options: [{ value: 'main' }] },
    publishName: { value: '' }, publishDescription: { value: '' },
    publishState: { extraLayers: [], mainLayers: [], mainRules: {}, initialVisibility: {}, layerGroups: {}, layerTitles: {}, layerOrder: [], backgroundLayers: [], backgroundOptions: [] },
    loadProjectLayers: async (_projectId, target) => {
      if (target === 'main') {
        applyContext.publishState.mainLayers = [{ key: 'buildings', name: 'buildings', sourceProjectId: 'main' }];
        applyContext.publishState.mainRules = { buildings: {} };
      }
    },
    addExternalLayers: async (projectId, layers) => {
      for (const layer of layers) applyContext.publishState.extraLayers.push({ key: `${projectId}::${layer.name}`, name: layer.name, sourceProjectId: projectId });
    },
    makeLayerKey: (projectId, name) => projectId === 'main' ? name : `${projectId}::${name}`,
    ensureLayerOrderKeys: () => {},
    controlsJsonInput: { value: '' }, extraJsonInput: { value: '' },
    extentInput: null, centerInput: null, zoomInput: null, minZoomInput: null, maxZoomInput: null,
    cfgShareUrl: null, cfgRoutingUrl: null, cfgElevationUrl: null, cfgDxfUrl: null,
    backgroundProjectSelect: { value: '' }, backgroundLayersList: { innerHTML: '' },
    syncCheckboxesFromControls: () => {}, applyFeatureEditorState: () => {}, refreshBackgroundOptions: () => {}, renderDefaultBackgroundOptions: () => {},
    getAllPublishLayers: () => [...applyContext.publishState.mainLayers, ...applyContext.publishState.extraLayers],
    renderLayerChecklist: () => {}, setCheckedLayerNames: (_host, keys) => { applyContext.checked = keys; },
    projectLayersList: {}, refreshExtraSections: () => {}, renderSearchSources: async () => {}, syncToolCardClasses: () => {}, schedulePreviewRefresh: () => {},
    markEditorDirty: () => {}, setMapJsonLiveStatus: () => {}, logJsonEditor: () => {}, t: () => 'Select a background', escapeHtml: String
  };
  vm.createContext(applyContext);
  vm.runInContext(`let _mapJsonDirty = true; ${applyJson}; globalThis.applyMapJsonChangesUnderTest = applyMapJsonChanges;`, applyContext);
  assert.equal(await applyContext.applyMapJsonChangesUnderTest(), true, `${plugin}: imported JSON was not applied`);
  assert.equal(JSON.stringify(Array.from(applyContext.publishState.extraLayers, (layer) => layer.key)), JSON.stringify(['external::roads']), `${plugin}: imported external layer was not restored`);
  assert.equal(applyContext.publishState.initialVisibility['external::roads'], false, `${plugin}: imported external visibility was not restored`);
}

(async () => {
  for (const plugin of ['Qtiler2Origo', 'Qtiler2Hajk']) await testPlugin(plugin);
  console.log('Map JSON editor regression checks passed for Qtiler2Origo and Qtiler2Hajk.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});