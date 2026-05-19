/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 *
 * Stable per-machine fingerprint used to bind commercial licenses to the
 * hardware/OS install they were issued for.
 *
 * Strategy:
 *   - Windows : read HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid (registry)
 *   - Linux   : read /etc/machine-id (or /var/lib/dbus/machine-id)
 *   - macOS   : `ioreg -rd1 -c IOPlatformExpertDevice` IOPlatformUUID
 *   - Always  : append the MAC of the first non-internal NIC + hostname
 *   - Hash    : SHA-256(machineId|firstMac|hostname) → 64-char hex
 *
 * The machine ID portion is stable across reinstalls of the OS userland; the
 * MAC is added so swapping the disk to another box invalidates the licence.
 * Result is cached in-process and persisted to data/licenses.json the first
 * time it is computed.
 */

import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { execSync } from 'child_process';

let cached = null;

const readWindowsMachineGuid = () => {
  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const match = out.match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]{20,})/i);
    if (match) return match[1].trim();
  } catch { /* ignore */ }
  return '';
};

const readLinuxMachineId = () => {
  for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      if (fs.existsSync(p)) {
        const v = fs.readFileSync(p, 'utf8').trim();
        if (v) return v;
      }
    } catch { /* ignore */ }
  }
  return '';
};

const readDarwinPlatformUuid = () => {
  try {
    const out = execSync(
      'ioreg -rd1 -c IOPlatformExpertDevice | grep -i "IOPlatformUUID"',
      { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const match = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
    if (match) return match[1].trim();
  } catch { /* ignore */ }
  return '';
};

const getOsMachineId = () => {
  const platform = process.platform;
  if (platform === 'win32') return readWindowsMachineGuid();
  if (platform === 'darwin') return readDarwinPlatformUuid();
  return readLinuxMachineId();
};

const getFirstStableMac = () => {
  try {
    const ifaces = os.networkInterfaces();
    const macs = [];
    for (const name of Object.keys(ifaces)) {
      for (const ni of ifaces[name] || []) {
        if (!ni || ni.internal) continue;
        if (!ni.mac || ni.mac === '00:00:00:00:00:00') continue;
        macs.push({ name, mac: ni.mac.toLowerCase() });
      }
    }
    // Sort by interface name for deterministic ordering across boots.
    macs.sort((a, b) => a.name.localeCompare(b.name));
    return macs.length ? macs[0].mac : '';
  } catch { return ''; }
};

/**
 * Compute (and cache) the machine fingerprint. Returns a 64-char lowercase hex
 * SHA-256 hash. Returns the same value on every call within a process.
 *
 * Falls back to a hostname-only hash if no OS machine ID and no MAC are
 * available — this still produces a stable value but is weaker.
 */
export const getMachineFingerprint = () => {
  if (cached) return cached;
  const machineId = getOsMachineId();
  const mac = getFirstStableMac();
  const host = String(os.hostname() || '').toLowerCase();
  const arch = process.arch || '';
  const raw = [machineId, mac, host, arch, process.platform].filter(Boolean).join('|');
  const fp = crypto.createHash('sha256').update(raw || `fallback|${host}|${arch}`).digest('hex');
  cached = fp;
  return fp;
};

/**
 * Return a human-readable breakdown of the inputs that produced the
 * fingerprint, for display in the "Request license" UI. Does NOT include
 * sensitive values beyond what the OS already exposes locally.
 */
export const describeMachineFingerprint = () => ({
  fingerprint: getMachineFingerprint(),
  hostname: os.hostname(),
  platform: process.platform,
  arch: process.arch,
  hasMachineId: Boolean(getOsMachineId()),
  hasMac: Boolean(getFirstStableMac())
});
