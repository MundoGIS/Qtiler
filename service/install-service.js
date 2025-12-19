/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Service } from 'node-windows';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
// Load project .env so installer can capture PYTHON/QGIS vars if present
dotenv.config({ path: path.join(root, '.env') });
const logDir = path.join(root, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

// Ensure wrapper batch exists before attempting to install the service
const wrapperBatch = path.join(root, 'tools', 'run_qgis_python.bat');
if (!fs.existsSync(wrapperBatch)) {
  console.error('[install-service] required file missing:', wrapperBatch);
  console.error('[install-service] aborting install. Ensure tools/run_qgis_python.bat is present.');
  process.exit(1);
}

// Build environment entries for the service from current process.env (if present)
const envEntries = [];
['PYTHON_EXE', 'OSGEO4W_BIN', 'QGIS_PREFIX'].forEach((k) => {
  if (process.env[k]) envEntries.push({ name: k, value: process.env[k] });
});

// Configure service
const svc = new Service({
  name: 'QTiler',
  description: 'QGIS tile cache & WMTS/XYZ generator',
  script: path.join(root, 'server.js'),
  workingDirectory: root,
  wait: 2,
  grow: 0.5,
  maxRestarts: 10,
  env: envEntries
});

svc.on('install', () => {
  console.log('Service installed');
  svc.start();
});
svc.on('alreadyinstalled', () => console.log('Service already installed'));
svc.on('start', () => console.log('Service started'));
svc.on('error', e => console.error('Service error', e));

svc.install();
