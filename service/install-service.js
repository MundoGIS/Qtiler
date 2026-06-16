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
[
  'NODE_OPTIONS',
  'PORT',
  'QTILER_SERVICE_NAME',
  'PUBLIC_BASE_URL',
  'QTILER_INSTALL_MODE',
  'QTILER_BEHIND_IIS',
  'QTILER_PUBLIC_HTTPS',
  'QTILER_TRUST_PROXY',
  'QTILER_DISABLE_HELMET',
  'QTILER_ENABLE_CSP',
  'QTILER_ENABLE_HSTS',
  'QTILER_ALLOW_FRAMING',
  'QTILER_CORS_ALLOWED_ORIGINS',
  'QTILER_CORS_ALLOW_CREDENTIALS',
  'QTILER_WMTS_REQUIRE_AUTH',
  'QTILER_DEFAULT_ADMIN_PASSWORD',
  'QTILER_AUTH_IDLE_TIMEOUT_SECONDS',
  'QTILER_AUTH_PROJECTS_CACHE_TTL_MS',
  'QTILER_AUTH_LAYERS_CACHE_TTL_MS',
  'AUTH_LOGIN_WINDOW_SECONDS',
  'AUTH_LOGIN_MAX_ATTEMPTS',
  'AUTH_LOGIN_LOCKOUT_SECONDS',
  'AUTH_LOGIN_CAPTCHA_AFTER',
  'AUTH_CAPTCHA_PROVIDER',
  'AUTH_CAPTCHA_SITE_KEY',
  'AUTH_CAPTCHA_SECRET_KEY',
  'AUTH_CAPTCHA_POW_DIFFICULTY',
  'AUTH_CAPTCHA_POW_TTL_SECONDS',
  'AUTH_API_RATE_LIMIT_PER_MINUTE',
  'AUTH_STORE_PLAINTEXT_API_KEYS',
  'WORKER_COUNT',
  'PY_WORKER_POOL_SIZE',
  'WORKER_JOB_TIMEOUT_S',
  'JOB_MAX_PER_WORKER',
  'WORKER_RESTART_DELAY_S',
  'WORKER_MAX_RESTARTS',
  'WORKER_RESTART_WINDOW_S',
  'WORKER_MAX_MEMORY_MB',
  'PYTHON_EXE',
  'OSGEO4W_BIN',
  'QGIS_PREFIX',
  'QT_PLUGIN_PATH',
  'PYTHONPATH',
  'QTILER_PERSISTENT_WORKER',
  'QTILER_HOME',
  'NODE_EXE',
  'QTWC_QWC2_PORT',
  'QTWC_QWC2_AUTOSTART',
  'QTWC_QWC2_REPO',
  'QTWC_QWC2_VERSION',
  'QTILER_ORIGO_PORT',
  'QTILER_ORIGO_AUTOSTART',
  'QTILER_ORIGO_REPO',
  'QTILER_ORIGO_VERSION',
  'QTILER_HAJK_PORT',
  'QTILER_HAJK_AUTOSTART',
  'QTILER_HAJK_REPO',
  'QTILER_HAJK_VERSION',
  'WFS_DEFAULT_MAX_FEATURES',
  'WFS_MAX_FEATURES_LIMIT',
  'WFS_MAX_FEATURES_ABSOLUTE_LIMIT',
  'WFS_CAPABILITIES_DEFAULT_VERSION',
  'WFS_CAPABILITIES_COUNT_DEFAULT',
  'WFS_AUTO_EXPAND_LIMIT',
  'WFS_TX_REQUIRE_ADMIN',
  'QTILER_WMS_MAX_PIXELS',
  'QTILER_WMS_MAX_LAYERS',
  'VECTOR_TILES_MAX_ONDEMAND_WORKERS',
  'QUANTIZED_MESH_BUILD_CMD',
  'QUANTIZED_MESH_ENGINE_CMD',
  'QUANTIZED_MESH_ENGINE_KIND',
  'QUANTIZED_MESH_TARGET_CRS',
  'QUANTIZED_MESH_DXF_CONTOUR_INTERVAL',
  'QUANTIZED_MESH_ENGINE_MODULE',
  'QUANTIZED_MESH_JOB_TIMEOUT_MS',
  'QUANTIZED_MESH_SKIP_LEVEL',
  'SKIP_WHITE_TILES',
  'LANTMATERI_API_URL',
  'LANTMATERI_API_KEY',
  'LANTMATERI_FASTIGHET_API_KEY',
  'LANTMATERI_BEFOLKNING_API_KEY',
  'LANTMATERI_ADRESS_API_KEY',
  'LANTMATERI_TAXERING_API_KEY',
  'LANTMATERI_MARKHOJD_API_KEY',
  'LANTMATERI_MARKTACKE_API_KEY',
  'LANTMATERI_HOJD_API_KEY',
  'LANTMATERI_CLIENT_ID',
  'LANTMATERI_CLIENT_SECRET',
  'LANTMATERI_TOKEN_URL',
  'LANTMATERI_MARKHOJD_SCOPE',
  'LANTMATERI_HOJD_SCOPE',
  'LANTMATERI_MARKTACKE_USER',
  'LANTMATERI_MARKTACKE_PASS',
  'LANTMATERI_MARKHOJD_URL_TEMPLATE',
  'LANTMATERI_MARKHOJD_AUTH',
  'LANTMATERI_MARKHOJD_CLIENT_ID',
  'LANTMATERI_MARKHOJD_CLIENT_SECRET',
  'LANTMATERI_MARKHOJD_TOKEN_URL',
  'LANTMATERI_MARKTACKE_URL_TEMPLATE',
  'LANTMATERI_MARKTACKE_AUTH',
  'LANTMATERI_MARKTACKE_CLIENT_ID',
  'LANTMATERI_MARKTACKE_CLIENT_SECRET',
  'LANTMATERI_MARKTACKE_TOKEN_URL',
  'LANTMATERI_MARKTACKE_SCOPE',
  'LANTMATERI_HOJD_URL_TEMPLATE',
  'LANTMATERI_HOJD_AUTH',
  'LANTMATERI_HOJD_CLIENT_ID',
  'LANTMATERI_HOJD_CLIENT_SECRET',
  'LANTMATERI_HOJD_TOKEN_URL',
  'LICENSE_SECRET',
  'LICENSE_ALLOW_HMAC_LEGACY',
  'LICENSE_PUBLIC_KEY_PATH',
  'LICENSE_PUBLIC_KEY',
  'QTILER_VERSION',
  'QTILER_ASSET_VERSION'
].forEach((k) => {
  if (process.env[k]) envEntries.push({ name: k, value: process.env[k] });
});

// Configure service
const serviceName = String(process.env.QTILER_SERVICE_NAME || 'QTiler').trim() || 'QTiler';
const svc = new Service({
  name: serviceName,
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
});
svc.on('alreadyinstalled', () => console.log('Service already installed'));
svc.on('start', () => console.log('Service started'));
svc.on('error', e => console.error('Service error', e));

svc.install();
