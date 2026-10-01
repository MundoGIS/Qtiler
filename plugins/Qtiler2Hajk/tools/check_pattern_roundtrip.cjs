const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('plugins/Qtiler2Hajk/admin-ui/app.js', 'utf8');

assert.ok(
  source.includes('designerPatternPreviewSequence += 1'),
  'Each SVG preview pattern must have a unique id after reopening the editor'
);
assert.ok(
  source.includes('function persistCurrentWfsRules(layerName)'),
  'The style editor must have one persistence path for current rules'
);

const designerSaveStart = source.indexOf('if (activeDesigner && Number.isInteger(currentDesignerRuleIndex)');
const jsonSaveStart = source.indexOf('if (activeJson)', designerSaveStart);
assert.ok(designerSaveStart >= 0 && jsonSaveStart > designerSaveStart, 'Basic designer save branch must exist');

const designerSaveBranch = source.slice(designerSaveStart, jsonSaveStart);
assert.ok(
  designerSaveBranch.includes('persistCurrentWfsRules(layerName);'),
  'Saving a basic rule must persist qtilerPatternStyle before the editor can be closed or reopened'
);

console.log('Hajk pattern roundtrip contract checks passed.');