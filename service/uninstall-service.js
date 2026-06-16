/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { Service } from 'node-windows';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env') });
const serviceName = String(process.env.QTILER_SERVICE_NAME || 'QTiler').trim() || 'QTiler';

const svc = new Service({
  name: serviceName,
  script: path.join(root, 'server.js')
});

svc.on('uninstall', () => {
  console.log('QTiler service uninstalled.');
  process.exit(0);
});
svc.on('alreadyuninstalled', () => {
  console.log('QTiler service was not installed.');
  process.exit(0);
});
svc.on('error', e => {
  console.error('Service error:', e);
  process.exit(1);
});

console.log('Stopping and removing QTiler service...');
svc.uninstall();
