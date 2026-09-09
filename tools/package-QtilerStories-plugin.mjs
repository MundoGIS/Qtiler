/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2026 MundoGIS.
 *
 * Packages plugins/QtilerStories into dist/QtilerStories.zip. The staging
 * directory temp_zip_QtilerStories/ is rebuilt automatically from the live
 * plugin source so the ZIP can never go stale.
 */

import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { syncPluginStaging } from './sync-plugin-staging.mjs';

const root = process.cwd();
const sourceDir = syncPluginStaging('QtilerStories');
const distDir = path.join(root, 'dist');
const outZip = path.join(distDir, 'QtilerStories.zip');

const ensureDir = async (dir) => {
  await fs.promises.mkdir(dir, { recursive: true });
};

const assertExists = async (p, label) => {
  try {
    await fs.promises.access(p, fs.constants.R_OK);
  } catch {
    throw new Error(`${label} not found/readable: ${p}`);
  }
};

const main = async () => {
  await assertExists(sourceDir, 'Source directory');
  await assertExists(path.join(sourceDir, 'index.js'), 'Plugin entry (index.js)');
  await assertExists(path.join(sourceDir, 'plugin.json'), 'Plugin manifest (plugin.json)');

  await ensureDir(distDir);

  const zip = new AdmZip();
  zip.addLocalFolder(sourceDir, '');

  if (fs.existsSync(outZip)) {
    await fs.promises.unlink(outZip);
  }
  zip.writeZip(outZip);

  const stats = await fs.promises.stat(outZip);
  console.log(`Built ${outZip} (${stats.size} bytes)`);
  console.log('Install from Qtiler UI: Admin -> Plugins -> Upload -> select dist/QtilerStories.zip');
};

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
