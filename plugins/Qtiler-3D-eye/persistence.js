import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

const contexts = new AsyncLocalStorage();
const clone = (value) => JSON.parse(JSON.stringify(value));
export const persistenceContext = (_req, _res, next) => contexts.run(new Map(), next);

export function atomicJsonWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

export function createCollectionStore(file) {
  const readRaw = () => {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const result = JSON.parse(raw.replace(/^\uFEFF/, ''));
    if (!Array.isArray(result)) throw new Error(`Invalid collection: ${path.basename(file)}`);
    return result;
  };
  const keyed = (items) => {
    const result = new Map();
    for (const item of items) {
      if (!item?.id || result.has(item.id)) throw Object.assign(new Error('Invalid or duplicate collection id'), { status: 400 });
      result.set(item.id, item);
    }
    return result;
  };
  return {
    read() { const value = readRaw(); contexts.getStore()?.set(file, clone(value)); return value; },
    write(value) {
      if (!Array.isArray(value)) throw Object.assign(new Error('Expected a collection'), { status: 400 });
      const baseline = contexts.getStore()?.get(file);
      if (!baseline) throw new Error('Read the collection before updating it');
      const next = keyed(value);
      const lock = `${file}.lock`;
      let handle;
      try { handle = fs.openSync(lock, 'wx'); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let owner;
        try { owner = Number(fs.readFileSync(lock, 'utf8')); } catch {}
        if (Number.isInteger(owner) && owner > 0) {
          try { process.kill(owner, 0); } catch (probe) {
            if (probe.code === 'ESRCH') { fs.rmSync(lock, { force: true }); return this.write(value); }
          }
        }
        throw Object.assign(new Error('Data is being updated. Retry the operation.'), { status: 409 });
      }
      try {
        fs.writeFileSync(handle, String(process.pid));
        const before = keyed(baseline);
        const merged = keyed(readRaw());
        for (const id of new Set([...before.keys(), ...next.keys()])) {
          if (JSON.stringify(before.get(id)) === JSON.stringify(next.get(id))) continue;
          if (JSON.stringify(merged.get(id)) !== JSON.stringify(before.get(id))) throw Object.assign(new Error('This item changed in another session. Reload before saving.'), { status: 409 });
          if (next.has(id)) merged.set(id, next.get(id)); else merged.delete(id);
        }
        const result = [...merged.values()];
        atomicJsonWrite(file, result);
        contexts.getStore().set(file, clone(result));
      } finally { fs.closeSync(handle); fs.rmSync(lock, { force: true }); }
    }
  };
}

export async function replaceDirectory(staged, destination, commit = async () => {}) {
  const previous = `${destination}.previous-${crypto.randomUUID()}`;
  let backedUp = false;
  let installed = false;
  try {
    try { await fs.promises.rename(destination, previous); backedUp = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.promises.rename(staged, destination); installed = true;
    await commit();
  } catch (error) {
    if (installed) await fs.promises.rm(destination, { recursive: true, force: true });
    if (backedUp) await fs.promises.rename(previous, destination);
    throw error;
  }
  if (backedUp) await fs.promises.rm(previous, { recursive: true, force: true }).catch(() => {});
}

export function readJob(file) {
  let job;
  try { job = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (job.status === 'running' && Number.isInteger(job.ownerPid) && job.ownerPid > 0) {
    try { process.kill(job.ownerPid, 0); }
    catch (error) {
      if (error.code === 'ESRCH') {
        job.status = 'error'; job.error = 'Job interrupted: the worker process exited'; job.endedAt = new Date().toISOString();
        atomicJsonWrite(file, job);
      }
    }
  }
  return job;
}