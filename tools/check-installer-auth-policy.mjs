import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { getMachineFingerprint } from '../lib/machineFingerprint.js';

const execute = promisify(execFile);
const policy = path.resolve('tools/qtilerauth-install-policy.mjs');
const fingerprint = getMachineFingerprint();

async function fixture(context) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtiler-auth-install-test-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'data'));
  await fs.writeFile(path.join(root, 'data', 'plugins.json'), JSON.stringify({ enabled: ['Hajk'] }));
  const env = { ...process.env, ProgramData: path.join(root, 'machine'), LICENSE_SECRET: '', LICENSE_PUBLIC_KEY: '', LICENSE_PUBLIC_KEY_PATH: path.join(root, 'missing.pem') };
  return { root, env };
}

async function readState(root) {
  return {
    plugins: JSON.parse(await fs.readFile(path.join(root, 'data', 'plugins.json'), 'utf8')),
    licenses: JSON.parse(await fs.readFile(path.join(root, 'data', 'licenses.json'), 'utf8'))
  };
}

for (const profile of ['test', 'production']) {
  for (const setup of ['new', 'update']) {
    test(`${profile}/${setup}: first activation enables Auth for 30 days and reinstall preserves expiry`, async (context) => {
      const { root, env } = await fixture(context);
      env.QTILER_INSTALL_MODE = profile;
      const result = await execute(process.execPath, [policy, root, setup], { env });
      assert.match(result.stdout, /QTILERAUTH_EXPECTED=1/);
      const before = await readState(root);
      assert.deepEqual(before.plugins.enabled, ['Hajk', 'QtilerAuth']);
      const trial = before.licenses.plugins.QtilerAuth.trial;
      assert.equal(Date.parse(trial.expiresAt) - Date.parse(trial.startedAt), 30 * 86400000);
      await execute(process.execPath, [policy, root, 'update'], { env });
      const after = await readState(root);
      assert.deepEqual(after.licenses, before.licenses);
    });
  }
}

for (const expired of [false, true]) {
  test(`${expired ? 'expired' : 'valid'} signed trial is preserved, not renewed`, async (context) => {
    const { root, env } = await fixture(context);
    const startedAt = new Date(Date.now() - 60 * 86400000).toISOString();
    const expiresAt = new Date(Date.now() + (expired ? -30 : 10) * 86400000).toISOString();
    const secret = crypto.createHash('sha256').update(`qtiler-plugin-trial|${fingerprint}`).digest('hex');
    const sig = crypto.createHmac('sha256', secret).update(`QtilerAuth|${fingerprint}|${startedAt}|${expiresAt}`).digest('hex');
    const initial = { instanceId: fingerprint, plugins: { QtilerAuth: { trial: { startedAt, expiresAt, sig } } } };
    await fs.writeFile(path.join(root, 'data', 'licenses.json'), JSON.stringify(initial));
    const result = await execute(process.execPath, [policy, root, 'update'], { env });
    assert.match(result.stdout, new RegExp(`QTILERAUTH_EXPECTED=${expired ? 0 : 1}`));
    assert.deepEqual((await readState(root)).licenses, initial);
  });
}

test('commercial license remains unchanged', async (context) => {
  const { root, env } = await fixture(context);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  env.LICENSE_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' });
  const payload = Buffer.from(JSON.stringify({ plugin: 'QtilerAuth', instanceId: fingerprint, expiresAt: new Date(Date.now() + 90 * 86400000).toISOString() })).toString('base64url');
  const signature = crypto.sign('sha256', Buffer.from(payload), privateKey).toString('base64url');
  const initial = { instanceId: fingerprint, plugins: { QtilerAuth: { licenseKey: `${payload}.${signature}` } } };
  await fs.writeFile(path.join(root, 'data', 'licenses.json'), JSON.stringify(initial));
  const result = await execute(process.execPath, [policy, root, 'update'], { env });
  assert.match(result.stdout, /QTILERAUTH_EXPECTED=1/);
  assert.deepEqual((await readState(root)).licenses, initial);
});

test('machine-only trial is restored without changing its expiry', async (context) => {
  const { root, env } = await fixture(context);
  const startedAt = new Date(Date.now() - 5 * 86400000).toISOString();
  const expiresAt = new Date(Date.parse(startedAt) + 30 * 86400000).toISOString();
  const secret = crypto.createHash('sha256').update(`qtiler-plugin-trial|${fingerprint}`).digest('hex');
  const sig = crypto.createHmac('sha256', secret).update(`QtilerAuth|${fingerprint}|${startedAt}|${expiresAt}`).digest('hex');
  const trial = { startedAt, expiresAt, sig };
  const machineDir = path.join(env.ProgramData, 'Qtiler');
  await fs.mkdir(machineDir, { recursive: true });
  await fs.writeFile(path.join(machineDir, 'plugin-trials.json'), JSON.stringify({ plugins: { QtilerAuth: trial } }));
  const result = await execute(process.execPath, [policy, root, 'update'], { env });
  assert.match(result.stdout, /QTILERAUTH_EXPECTED=1/);
  assert.deepEqual((await readState(root)).licenses.plugins.QtilerAuth.trial, trial);
});

test('a valid historical 90-day trial is preserved instead of reset to 30 days', async (context) => {
  const { root, env } = await fixture(context);
  const startedAt = new Date(Date.now() - 26 * 86400000).toISOString();
  const expiresAt = new Date(Date.parse(startedAt) + 90 * 86400000).toISOString();
  const secret = crypto.createHash('sha256').update(`qtiler-plugin-trial|${fingerprint}`).digest('hex');
  const sig = crypto.createHmac('sha256', secret).update(`QtilerAuth|${fingerprint}|${startedAt}|${expiresAt}`).digest('hex');
  const trial = { startedAt, expiresAt, sig };
  const machineDir = path.join(env.ProgramData, 'Qtiler');
  await fs.mkdir(machineDir, { recursive: true });
  await fs.writeFile(path.join(machineDir, 'plugin-trials.json'), JSON.stringify({ plugins: { QtilerAuth: trial } }));
  const result = await execute(process.execPath, [policy, root, 'new'], { env });
  assert.match(result.stdout, /QTILERAUTH_EXPECTED=1/);
  assert.deepEqual((await readState(root)).licenses.plugins.QtilerAuth.trial, trial);
});