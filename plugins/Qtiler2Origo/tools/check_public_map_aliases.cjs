const assert = require('node:assert/strict');
const fs = require('node:fs');

for (const plugin of ['Qtiler2Origo', 'Qtiler2Hajk']) {
  const source = fs.readFileSync(`plugins/${plugin}/index.js`, 'utf8');
  const gallery = fs.readFileSync(`plugins/${plugin}/admin-ui/gallery.html`, 'utf8');
  assert.ok(source.includes('return res.redirect(308, `${mapsAlias}/${qs}`);'), `${plugin}: /maps must redirect to /maps/`);
  assert.ok(source.includes("has('qtiler_profile')"), `${plugin}: profile query must open the viewer`);
  assert.ok(source.includes("'admin-ui', 'gallery.html'"), `${plugin}: gallery route missing`);
  assert.ok(source.includes('url.startsWith(`${mapsAlias}/`)'), `${plugin}: /maps/ assets must be rewritten to the viewer mount`);
  assert.ok(gallery.includes(`/plugins/${plugin}/api/public-maps`) || gallery.includes('`/plugins/${plugin}/api/public-maps`'), `${plugin}: gallery must use public maps catalog`);
  assert.ok(gallery.includes('item.thumbnailUrl'), `${plugin}: gallery must render map thumbnails`);
  assert.ok(gallery.includes('item.launchUrl'), `${plugin}: gallery must open each published map`);
}

console.log('Public map alias checks passed for Qtiler2Origo and Qtiler2Hajk.');
