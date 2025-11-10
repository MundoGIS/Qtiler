/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { Service } from 'node-windows';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const logDir = path.join(root, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

// Configure service
const svc = new Service({
  name: 'QTiler',
  description: 'QGIS tile cache & WMTS/XYZ generator',
  script: path.join(root, 'server.js'),
  workingDirectory: root,
  wait: 2,
  grow: 0.5,
  maxRestarts: 10,
  env: [
    // Example: add custom env entries here if needed
    // { name: 'JOB_MAX', value: '2' }
  ]
});

svc.on('install', () => {
  console.log('Service installed');
  svc.start();
});
svc.on('alreadyinstalled', () => console.log('Service already installed'));
svc.on('start', () => console.log('Service started'));
svc.on('error', e => console.error('Service error', e));

svc.install();
