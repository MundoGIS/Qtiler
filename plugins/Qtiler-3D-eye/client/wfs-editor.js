export function createWfsEditor({ map, runtimeItems, onSaved, onError, suspendInfo = () => {} }) {
  const ol = window.ol;
  const panel = document.getElementById('wfsEditPanel');
  const layerSelect = panel.querySelector('[data-edit-layer]');
  const fieldsHost = panel.querySelector('[data-edit-fields]');
  const status = panel.querySelector('[data-edit-status]');
  let selection = null;
  let selected = new ol.Collection();
  let modify = null;
  let draw = null;
  let snap = null;
  let item = null;
  let metadata = null;
  let inserts = [];
  let updates = new Map();
  let deletes = new Map();
  let loading = false;
  const format = new ol.format.WFS({ version: '1.1.0' });

  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.dataset.error = String(error);
  };
  const clearDrawInteractions = () => {
    if (draw) map.removeInteraction(draw);
    if (snap) map.removeInteraction(snap);
    draw = null;
    snap = null;
  };
  const clearInteractions = () => {
    clearDrawInteractions();
    if (modify) map.removeInteraction(modify);
    if (selection && map.getInteractions().getArray().includes(selection)) map.removeInteraction(selection);
    modify = null;
    selected.clear();
  };
  function enableModify() {
    clearDrawInteractions();
    if (!selection || !map.getInteractions().getArray().includes(selection)) {
      selection = new ol.interaction.Select({ layers: [item.layerObject] });
      selected = selection.getFeatures();
      map.addInteraction(selection);
    }
    if (modify) map.removeInteraction(modify);
    modify = new ol.interaction.Modify({ features: selected });
    modify.on('modifyend', (event) => {
      for (const feature of event.features) {
        if (!feature.getId()) { setStatus('The WFS feature has no stable ID; this layer cannot safely update existing records.', true); continue; }
        updates.set(feature.getId(), feature);
      }
      renderFields();
      setStatus(`${updates.size} feature(s) changed`);
    });
    map.addInteraction(modify);
    if (item?.layer?.snap !== false) {
      snap = new ol.interaction.Snap({ source: item.layerObject.getSource(), pixelTolerance: 10 });
      map.addInteraction(snap);
    }
  }
  function renderFields() {
    fieldsHost.replaceChildren();
    const feature = selected.item(0);
    if (!feature || !metadata) return;
    for (const field of metadata.attributes) {
      const label = document.createElement('label');
      label.textContent = field.name;
      const input = document.createElement('input');
      input.type = field.type === 'boolean' ? 'checkbox' : 'text';
      input.value = String(feature.get(field.name) ?? '');
      if (field.type === 'boolean') input.checked = feature.get(field.name) === true || String(feature.get(field.name)).toLowerCase() === 'true';
      input.addEventListener('change', () => {
        let value = field.type === 'boolean' ? input.checked : input.value;
        if (field.type === 'number' && input.value.trim()) {
          value = Number(input.value);
          if (!Number.isFinite(value)) { setStatus(`${field.name} must be a number`, true); return; }
        }
        feature.set(field.name, value);
        if (feature.getId()) updates.set(feature.getId(), feature);
        else if (!inserts.includes(feature)) inserts.push(feature);
        setStatus('Attribute changed');
      });
      label.append(input);
      fieldsHost.append(label);
    }
  }
  function parseMetadata(xmlText) {
    const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('WFS returned invalid DescribeFeatureType XML');
    const schema = Array.from(xml.getElementsByTagName('*')).find((node) => node.localName === 'schema');
    const targetNamespace = schema?.getAttribute('targetNamespace');
    const elements = Array.from(xml.getElementsByTagName('*')).filter((node) => node.localName === 'element');
    const geometry = elements.find((node) => /gml/i.test(node.getAttribute('type') || ''));
    const attributes = elements.map((node) => ({ name: node.getAttribute('name'), type: node.getAttribute('type') || '' }))
      .filter((field) => field.name && !/gml/i.test(field.type) && field.name !== geometry?.getAttribute('name'))
      .map((field) => ({ ...field, type: /boolean/i.test(field.type) ? 'boolean' : /int|decimal|double|float|long|short/i.test(field.type) ? 'number' : 'text' }));
    if (!targetNamespace || !geometry) throw new Error('WFS schema is missing its namespace or geometry field');
    const featurePrefix = Array.from(schema.attributes).find((attribute) => attribute.value === targetNamespace && attribute.name.startsWith('xmlns:'))?.name.slice(6) || 'qgs';
    return { featureNS: targetNamespace, featurePrefix, geometryName: geometry.getAttribute('name'), attributes };
  }
  async function loadMetadata(nextItem) {
    const url = new URL('/wfs', location.origin);
    url.searchParams.set('project', nextItem.layer.projectId);
    url.searchParams.set('SERVICE', 'WFS');
    url.searchParams.set('VERSION', '1.1.0');
    url.searchParams.set('REQUEST', 'DescribeFeatureType');
    url.searchParams.set('TYPENAME', nextItem.layer.layerName);
    const response = await fetch(url, { credentials: 'include' });
    const text = await response.text();
    if (!response.ok || /<(?:\w+:)?(?:ExceptionReport|ServiceExceptionReport)\b/i.test(text)) throw new Error(`DescribeFeatureType HTTP ${response.status}`);
    return parseMetadata(text);
  }
  function configureLayer(nextItem) {
    suspendInfo(true);
    clearInteractions();
    item = nextItem;
    item.layerObject = Array.from(map.getLayers().getArray()).find((layer) => layer.get('qtilerItem') === item);
    metadata = null;
    inserts = [];
    updates = new Map();
    deletes = new Map();
    fieldsHost.replaceChildren();
    if (!item.layerObject) throw new Error('The editable WFS layer is not loaded in the 2D map');
    enableModify();
    setStatus('Loading WFS schema...');
    loadMetadata(item).then((value) => {
      if (item !== nextItem) return;
      metadata = value;
      for (const feature of item.layerObject.getSource().getFeatures()) {
        const geometry = feature.getGeometry();
        feature.setGeometryName(metadata.geometryName);
        feature.setGeometry(geometry);
      }
      renderFields();
      setStatus(`Editing ${item.label}`);
    }).catch((error) => { setStatus(error.message, true); onError(error); });
  }
  function startDraw(type) {
    if (!item || !metadata) { setStatus('Wait for the WFS schema to load', true); return; }
    clearInteractions();
    draw = new ol.interaction.Draw({ source: item.layerObject.getSource(), type });
    draw.on('drawend', (event) => {
      const feature = event.feature;
      feature.setGeometryName(metadata.geometryName);
      inserts.push(feature);
      selected.clear();
      selected.push(feature);
      renderFields();
      setStatus('New WFS feature; fill in its attributes and save');
    });
    map.addInteraction(draw);
    snap = new ol.interaction.Snap({ source: item.layerObject.getSource(), pixelTolerance: 10 });
    map.addInteraction(snap);
    setStatus(`Draw ${type.toLowerCase()} on the map; double-click to finish`);
  }
  async function save() {
    if (loading || !item || !metadata) return;
    const toSave = Array.from(updates.values()).filter((feature) => !deletes.has(feature.getId()));
    if (!inserts.length && !toSave.length && !deletes.size) { setStatus('No changes to save'); return; }
    if (toSave.some((feature) => !feature.getId()) || Array.from(deletes.values()).some((feature) => !feature.getId())) {
      setStatus('The WFS response omitted a stable feature ID; existing features were not changed.', true);
      return;
    }
    loading = true;
    const saveButton = panel.querySelector('[data-edit-save]');
    saveButton.disabled = true;
    try {
      clearDrawInteractions();
      const transaction = format.writeTransaction(inserts, toSave, Array.from(deletes.values()), {
        featureNS: metadata.featureNS,
        featurePrefix: metadata.featurePrefix,
        featureType: item.layer.layerName,
        geometryName: metadata.geometryName,
        srsName: 'EPSG:4326',
        featureProjection: 'EPSG:3857',
        dataProjection: 'EPSG:4326'
      });
      const response = await fetch(`/wfs?project=${encodeURIComponent(item.layer.projectId)}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/xml; charset=UTF-8' }, body: new XMLSerializer().serializeToString(transaction)
      });
      const text = await response.text();
      if (!response.ok || /<(?:\w+:)?(?:ExceptionReport|ServiceExceptionReport)\b/i.test(text)) throw new Error(text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || `WFS-T HTTP ${response.status}`);
      clearInteractions();
      item.layerObject.getSource().clear();
      item.geojson = null;
      inserts = []; updates.clear(); deletes.clear();
      await onSaved(item);
      configureLayer(item);
      setStatus('WFS changes saved');
    } catch (error) {
      setStatus(error.message, true);
      onError(error);
    } finally {
      loading = false;
      saveButton.disabled = false;
    }
  }
  function deleteSelected() {
    for (const feature of selected.getArray().slice()) {
      if (inserts.includes(feature)) inserts = inserts.filter((candidate) => candidate !== feature);
      else if (feature.getId()) { deletes.set(feature.getId(), feature); updates.delete(feature.getId()); }
      else { setStatus('The selected WFS feature has no stable ID and cannot be deleted safely.', true); continue; }
      item.layerObject.getSource().removeFeature(feature);
    }
    selected.clear();
    renderFields();
    setStatus(`${deletes.size} feature(s) marked for deletion`);
  }
  async function open() {
    const editableItems = Array.from(runtimeItems.values()).filter((candidate) => candidate.type === 'wfs' && candidate.editable);
    if (!editableItems.length) { setStatus('No WFS layer is enabled for editing in QtilerAuth.', true); panel.hidden = false; return; }
    layerSelect.replaceChildren(...editableItems.map((candidate) => new Option(candidate.label, candidate.layer.key)));
    panel.hidden = false;
    setStatus('Waiting for visible WFS features...');
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline && !editableItems.some((candidate) => Array.from(map.getLayers().getArray()).some((layer) => layer.get('qtilerItem') === candidate))) await new Promise((resolve) => setTimeout(resolve, 100));
    if (!panel.hidden && !editableItems.some((candidate) => Array.from(map.getLayers().getArray()).some((layer) => layer.get('qtilerItem') === candidate))) { setStatus('The editable WFS layer did not load in the current view.', true); return; }
    configureLayer(editableItems[0]);
  }
  panel.querySelector('[data-edit-close]').onclick = () => { close(); };
  panel.querySelector('[data-edit-layer]').onchange = () => {
    const next = runtimeItems.get(layerSelect.value);
    if (next) configureLayer(next);
  };
  panel.querySelectorAll('[data-edit-draw]').forEach((button) => button.onclick = () => startDraw(button.dataset.editDraw));
  panel.querySelector('[data-edit-modify]').onclick = () => { if (item) { enableModify(); setStatus('Select a feature, then drag its vertices'); } };
  panel.querySelector('[data-edit-delete]').onclick = deleteSelected;
  panel.querySelector('[data-edit-save]').onclick = () => save();
  panel.querySelector('[data-edit-cancel]').onclick = () => { if (item) configureLayer(item); setStatus('Unsaved edits discarded'); };
  function close() { clearInteractions(); item = null; metadata = null; panel.hidden = true; suspendInfo(false); }
  return { open, close, isEditing(candidate) { return !panel.hidden && item === candidate; }, dispose: close };
}
