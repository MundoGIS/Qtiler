import fs from 'node:fs/promises';
import path from 'node:path';

export const INSTALL_RECEIPT = '.qtiler-installation.json';

export async function completeInstallation(dataDir, revision, workerRevisions) {
  if (typeof revision !== 'string' || !/^[a-f0-9-]{36}$/i.test(revision)) return;
  const state = workerRevisions.length > 0 && workerRevisions.every((revisions) => revisions?.has(revision)) ? 'ready' : 'failed';
  const filePath = path.join(dataDir, 'plugin-operations', `${revision}.json`);
  const operation = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ ...operation, state }), 'utf8');
  await fs.rename(temporary, filePath);
}

export async function readInstallationStatus(dataDir, manager, id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return { state: 'not_found' };
  let operation;
  try { operation = JSON.parse(await fs.readFile(path.join(dataDir, 'plugin-operations', `${id}.json`), 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return { state: 'not_found' }; throw err; }
  const loaded = manager.getRegistry().get(operation.plugin);
  const ready = operation.state === 'ready' && loaded?.revision === id;
  return { state: operation.state === 'failed' ? 'failed' : (ready ? 'ready' : 'loading'), plugin: operation.plugin, revision: id };
}