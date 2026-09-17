const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pluginSource = fs.readFileSync(path.resolve('plugins/Qtiler2Hajk/index.js'), 'utf8');
assert.ok(pluginSource.includes('editRefreshPattern'), 'Hajk runtime refresh patch is missing');
assert.ok(pluginSource.includes('String(l||"").match(/(?:^|[?&/])wfs(?:[?&/]|$)/i)'), 'Hajk runtime patch must refresh vector WFS sources');
assert.ok(pluginSource.includes('s.get("caption")'), 'Hajk runtime patch must match visible layer metadata');
assert.ok(pluginSource.includes("isToolEnabled('preset')"), 'Hajk preset tool is not emitted');
assert.ok(pluginSource.includes("isToolEnabled('propertychecker')"), 'Hajk configured-tool filtering is missing');

const staticRoot = path.resolve('data/Qtiler2Hajk/hajk/current/static');
if (fs.existsSync(staticRoot)) {
  const bundles = fs.readdirSync(staticRoot).filter((name) => /^(EditModel|CollectorModel)-.*\.js$/i.test(name));
  assert.ok(bundles.length >= 1, 'No installed Hajk edit bundles found');
  for (const bundle of bundles) {
    const source = fs.readFileSync(path.join(staticRoot, bundle), 'utf8');
    assert.ok(source.includes('String(l||"").match(/(?:^|[?&/])wfs(?:[?&/]|$)/i)'), `${bundle}: WFS vector refresh fallback missing`);
    assert.ok(source.includes('s.get("caption")'), `${bundle}: visible layer metadata fallback missing`);
    assert.ok(source.includes('typeof s.refresh=="function"'), `${bundle}: vector source refresh call missing`);
  }
}

console.log('Hajk WFS-T vector refresh checks passed.');