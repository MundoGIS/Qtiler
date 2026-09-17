const assert = require('node:assert/strict');
const fs = require('node:fs');

for (const plugin of ['Qtiler2Origo', 'Qtiler2Hajk']) {
  const backend = fs.readFileSync(`plugins/${plugin}/index.js`, 'utf8');
  const client = fs.readFileSync(`plugins/${plugin}/admin-ui/app.js`, 'utf8');
  const html = fs.readFileSync(`plugins/${plugin}/admin-ui/index.html`, 'utf8');

  assert.ok(backend.includes('api/publish/thumbnail/:profileKey/upload'), `${plugin}: manual thumbnail route missing`);
  assert.ok(backend.includes("resize(1200, 675, { fit: 'cover'"), `${plugin}: manual thumbnail normalization missing`);
  assert.ok(backend.includes('publishedThumbnailPath(profileKey)'), `${plugin}: upload must replace the standard published thumbnail`);
  assert.ok(client.includes('data-manual-thumb'), `${plugin}: per-map thumbnail action missing`);
  assert.ok(client.includes('renderThumbnailSetup'), `${plugin}: Setup thumbnail manager missing`);
  assert.ok(client.includes('/upload`, { method: \'POST\', body }'), `${plugin}: thumbnail upload request missing`);
  for (const id of ['thumbnailSetupSection', 'thumbnailProfileSelect', 'thumbnailFileInput', 'thumbnailUploadBtn', 'thumbnailSetupPreview']) {
    assert.ok(html.includes(`id="${id}"`), `${plugin}: missing thumbnail control ${id}`);
  }
}

console.log('Manual thumbnail contract checks passed for Qtiler2Origo and Qtiler2Hajk.');
