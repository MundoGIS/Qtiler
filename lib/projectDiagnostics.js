import fs from 'fs';
import os from 'os';
import path from 'path';

const LOG_DIR = path.resolve(process.env.QTILER_DIAGNOSTICS_DIR || path.join(process.cwd(), 'logs'));
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_EVENTS = 600;
const MAX_DIAGNOSTIC_READ_BYTES = 8 * 1024 * 1024;
const HEALTH_STALE_MS = 20000;
const events = [];
const counters = { wmsTileCacheHits: 0, wmsTileCacheMisses: 0, wmsTileCacheCoalesced: 0 };
const workerSequence = new Map();
let appendChain = Promise.resolve();
let previousSystemCpu = null;
let previousProcessCpu = process.cpuUsage();
let previousSampleAt = process.hrtime.bigint();
let recentEventsCache = { at: 0, rows: [] };

const scrub = (value) => String(value ?? '')
  .replace(/(["']?(?:password|passwd|pwd|api[_-]?key|token|access[_-]?token)["']?\s*:\s*["']?)([^"',\s}]+)(["']?)/gi, '$1***$3')
  .replace(/(password|passwd|pwd|api[_-]?key|token|access[_-]?token)(\s*[=:]\s*)([^\s&;,]+)/gi, '$1$2***')
  .replace(/(https?:\/\/[^:\s/]+:)([^@\s/]+)(@)/gi, '$1***$3');

const scrubDetails = (value, key = '') => {
  if (/(password|passwd|pwd|api[_-]?key|token|access[_-]?token)/i.test(key)) return '***';
  if (typeof value === 'string') return scrub(value).slice(0, 3000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => scrubDetails(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([childKey, childValue]) => [childKey, scrubDetails(childValue, childKey)]));
  }
  return value;
};

const diagnosticFile = () => path.join(LOG_DIR, `qtiler-diagnostics-${process.pid}.jsonl`);
const healthFile = (pid) => path.join(LOG_DIR, `qtiler-health-${pid}.json`);

const rotateIfNeeded = async (filePath) => {
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size < MAX_LOG_BYTES) return;
    const previous = `${filePath}.1`;
    await fs.promises.rm(previous, { force: true });
    await fs.promises.rename(filePath, previous);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
};

export const recordProjectDiagnostic = (level, area, message, details = null) => {
  const sequence = (workerSequence.get(process.pid) || 0) + 1;
  workerSequence.set(process.pid, sequence);
  let safeDetails = null;
  if (details != null) {
    try {
      const scrubbed = scrubDetails(details);
      const serialized = JSON.stringify(scrubbed);
      safeDetails = serialized.length <= 6000
        ? scrubbed
        : { truncated: true, preview: serialized.slice(0, 5800) };
    } catch {
      safeDetails = scrub(details).slice(0, 2000);
    }
  }
  const event = {
    id: `${Date.now()}-${process.pid}-${sequence}`,
    at: new Date().toISOString(),
    pid: process.pid,
    level: ['error', 'warn', 'info'].includes(level) ? level : 'info',
    area: scrub(area).slice(0, 48),
    message: scrub(message).slice(0, 240),
    details: safeDetails
  };
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);

  const line = `${JSON.stringify(event)}\n`;
  appendChain = appendChain.then(async () => {
    await fs.promises.mkdir(LOG_DIR, { recursive: true });
    const filePath = diagnosticFile();
    await rotateIfNeeded(filePath);
    await fs.promises.appendFile(filePath, line, 'utf8');
  }).catch(() => {});
  return event;
};

export const incrementProjectDiagnosticCounter = (name, amount = 1) => {
  if (!Object.prototype.hasOwnProperty.call(counters, name)) return 0;
  const increment = Number.isFinite(Number(amount)) ? Math.max(0, Number(amount)) : 0;
  counters[name] += increment;
  return counters[name];
};

export const readRecentProjectDiagnostics = async (limit = 250) => {
  if (Date.now() - recentEventsCache.at < 1000) return recentEventsCache.rows.slice(-limit);
  let files = [];
  try {
    files = (await fs.promises.readdir(LOG_DIR))
      .filter((name) => /^qtiler-diagnostics-\d+\.jsonl(?:\.1)?$/.test(name));
  } catch {
    recentEventsCache = { at: Date.now(), rows: events.slice(-MAX_EVENTS) };
    return recentEventsCache.rows.slice(-limit);
  }
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const candidates = [];
  for (const name of files) {
    const filePath = path.join(LOG_DIR, name);
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.mtimeMs < cutoff) {
        await fs.promises.rm(filePath, { force: true }).catch(() => {});
        continue;
      }
      candidates.push({ name, filePath, stat });
    } catch {}
  }
  candidates.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);

  const rows = [];
  let bytesRead = 0;
  for (const candidate of candidates) {
    const remaining = MAX_DIAGNOSTIC_READ_BYTES - bytesRead;
    if (remaining <= 0) break;
    const byteCount = Math.min(candidate.stat.size, remaining);
    if (byteCount <= 0) continue;
    let handle;
    try {
      handle = await fs.promises.open(candidate.filePath, 'r');
      const buffer = Buffer.allocUnsafe(byteCount);
      await handle.read(buffer, 0, byteCount, candidate.stat.size - byteCount);
      let content = buffer.toString('utf8');
      bytesRead += byteCount;
      if (byteCount < candidate.stat.size) {
        const firstLineBreak = content.indexOf('\n');
        content = firstLineBreak >= 0 ? content.slice(firstLineBreak + 1) : '';
      }
      for (const line of content.split(/\r?\n/)) {
        if (!line) continue;
        try { rows.push(JSON.parse(line)); } catch {}
      }
    } catch {} finally {
      try { await handle?.close(); } catch {}
    }
  }
  const byId = new Map([...rows, ...events].map((event) => [event.id, event]));
  const mergedRows = [...byId.values()].sort((left, right) => left.at.localeCompare(right.at)).slice(-MAX_EVENTS);
  recentEventsCache = { at: Date.now(), rows: mergedRows };
  return mergedRows.slice(-limit);
};

const sampleSystemCpu = () => {
  const cpus = os.cpus();
  const current = cpus.map((cpu) => cpu.times);
  if (!previousSystemCpu || previousSystemCpu.length !== current.length) {
    previousSystemCpu = current;
    return null;
  }
  let idle = 0;
  let total = 0;
  for (let index = 0; index < current.length; index += 1) {
    for (const key of Object.keys(current[index])) {
      const delta = Math.max(0, current[index][key] - previousSystemCpu[index][key]);
      total += delta;
      if (key === 'idle') idle += delta;
    }
  }
  previousSystemCpu = current;
  return total > 0 ? Math.round(((total - idle) / total) * 100) : null;
};

export const getProjectDiagnosticsSnapshot = (tileRendererPool, activeChildProcesses = 0, storagePath = process.cwd()) => {
  const memoryTotal = os.totalmem();
  const memoryFree = os.freemem();
  let diskTotalBytes = null;
  let diskFreeBytes = null;
  try {
    const stats = fs.statfsSync(storagePath);
    diskTotalBytes = Number(stats.blocks) * Number(stats.bsize);
    diskFreeBytes = Number(stats.bavail ?? stats.bfree) * Number(stats.bsize);
  } catch {}
  const now = process.hrtime.bigint();
  const wallMicros = Number(now - previousSampleAt) / 1000;
  const processCpu = process.cpuUsage(previousProcessCpu);
  previousProcessCpu = process.cpuUsage();
  previousSampleAt = now;
  const processCpuPercent = wallMicros > 0
    ? Math.min(100, Math.round(((processCpu.user + processCpu.system) / (wallMicros * Math.max(1, os.cpus().length))) * 100))
    : null;
  const workers = Array.isArray(tileRendererPool?.workers) ? tileRendererPool.workers : [];
  const queue = Array.isArray(tileRendererPool?.queue) ? tileRendererPool.queue : [];
  const workerDetails = workers.map((worker) => ({
    pid: worker?.process?.pid || null,
    busy: worker?.busy === true,
    action: worker?.busy ? String(worker.currentTask?.action || 'unknown') : null
  }));
  return {
    capturedAt: new Date().toISOString(),
    host: {
      cpuPercent: sampleSystemCpu(),
      cpuCores: os.cpus().length,
      memoryTotalBytes: memoryTotal,
      memoryFreeBytes: memoryFree,
      memoryUsedPercent: memoryTotal > 0 ? Math.round(((memoryTotal - memoryFree) / memoryTotal) * 100) : null,
      diskTotalBytes,
      diskFreeBytes,
      diskUsedPercent: Number.isFinite(diskTotalBytes) && diskTotalBytes > 0 && Number.isFinite(diskFreeBytes)
        ? Math.round(((diskTotalBytes - diskFreeBytes) / diskTotalBytes) * 100)
        : null
    },
    process: {
      pid: process.pid,
      rssBytes: process.memoryUsage().rss,
      heapUsedBytes: process.memoryUsage().heapUsed,
      cpuPercent: processCpuPercent,
      activeChildProcesses
    },
    qgis: {
      workers: workers.length,
      busyWorkers: workers.filter((worker) => worker?.busy).length,
      queuedTasks: queue.length,
      queueLimit: Number.isFinite(Number(tileRendererPool?.maxQueueSize)) ? Number(tileRendererPool.maxQueueSize) : workers.length * 8,
      busyActions: workers.filter((worker) => worker?.busy).map((worker) => String(worker.currentTask?.action || 'unknown')).slice(0, 16),
      workerDetails
    },
    counters: { ...counters }
  };
};

export const startProjectDiagnosticsHeartbeat = (snapshotProvider) => {
  if (typeof snapshotProvider !== 'function') return () => {};
  const filePath = healthFile(process.pid);
  let writing = false;
  const lastPressureEventAt = new Map();
  const warnOnPressure = (key, value, threshold, message, details) => {
    if (!Number.isFinite(value) || value < threshold) return;
    const lastAt = lastPressureEventAt.get(key) || 0;
    if (Date.now() - lastAt < 60000) return;
    lastPressureEventAt.set(key, Date.now());
    recordProjectDiagnostic('warn', 'resource-pressure', message, { threshold, observed: value, ...details });
  };
  const writeSnapshot = async () => {
    if (writing) return;
    writing = true;
    try {
      const snapshot = snapshotProvider();
      warnOnPressure('host-cpu', snapshot?.host?.cpuPercent, 90, 'Host CPU usage is at least 90%', { pid: process.pid });
      warnOnPressure('host-memory', snapshot?.host?.memoryUsedPercent, 90, 'Host memory usage is at least 90%', { pid: process.pid });
      warnOnPressure('host-disk', snapshot?.host?.diskUsedPercent, 95, 'Qtiler data volume usage is at least 95%', { pid: process.pid });
      const queueRatio = snapshot?.qgis?.queueLimit > 0
        ? (snapshot.qgis.queuedTasks / snapshot.qgis.queueLimit) * 100
        : null;
      warnOnPressure('qgis-queue', queueRatio, 90, 'QGIS worker queue is at least 90% full', {
        pid: process.pid,
        queuedTasks: snapshot?.qgis?.queuedTasks || 0,
        queueLimit: snapshot?.qgis?.queueLimit || 0
      });
      const serialized = JSON.stringify({ ...snapshot, process: { ...snapshot?.process, pid: process.pid } });
      const tempPath = `${filePath}.tmp`;
      await fs.promises.mkdir(LOG_DIR, { recursive: true });
      await fs.promises.writeFile(tempPath, serialized, 'utf8');
      await fs.promises.rename(tempPath, filePath);
    } catch {} finally {
      writing = false;
    }
  };
  void writeSnapshot();
  const timer = setInterval(() => { void writeSnapshot(); }, 5000);
  timer.unref?.();
  process.once('exit', () => {
    try { fs.unlinkSync(filePath); } catch {}
    try { fs.unlinkSync(`${filePath}.tmp`); } catch {}
  });
  return () => clearInterval(timer);
};

export const readProjectProcessSnapshots = async (fallbackSnapshot = null) => {
  let names = [];
  try {
    names = (await fs.promises.readdir(LOG_DIR)).filter((name) => /^qtiler-health-\d+\.json$/.test(name));
  } catch {
    return fallbackSnapshot ? [fallbackSnapshot] : [];
  }
  const now = Date.now();
  const snapshots = [];
  for (const name of names) {
    const filePath = path.join(LOG_DIR, name);
    try {
      const stat = await fs.promises.stat(filePath);
      const ageMs = now - stat.mtimeMs;
      if (ageMs > HEALTH_STALE_MS) {
        if (ageMs > 60 * 60 * 1000) await fs.promises.rm(filePath, { force: true }).catch(() => {});
        continue;
      }
      const parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
      if (parsed?.process?.pid) snapshots.push(parsed);
    } catch {}
  }
  if (fallbackSnapshot?.process?.pid && !snapshots.some((snapshot) => snapshot.process.pid === fallbackSnapshot.process.pid)) {
    snapshots.push(fallbackSnapshot);
  }
  return snapshots;
};

export const aggregateProjectDiagnosticsSnapshots = (snapshots) => {
  const list = Array.isArray(snapshots) ? snapshots.filter((snapshot) => snapshot?.process?.pid) : [];
  if (!list.length) return null;
  const newest = [...list].sort((left, right) => String(right.capturedAt || '').localeCompare(String(left.capturedAt || '')))[0];
  const sum = (selector) => list.reduce((total, snapshot) => total + (Number(selector(snapshot)) || 0), 0);
  const processSnapshots = list.map((snapshot) => ({
    pid: snapshot.process.pid,
    rssBytes: snapshot.process.rssBytes || 0,
    heapUsedBytes: snapshot.process.heapUsedBytes || 0,
    cpuPercent: snapshot.process.cpuPercent,
    activeChildProcesses: snapshot.process.activeChildProcesses || 0,
    workers: snapshot.qgis?.workers || 0,
    busyWorkers: snapshot.qgis?.busyWorkers || 0,
    queuedTasks: snapshot.qgis?.queuedTasks || 0,
    queueLimit: snapshot.qgis?.queueLimit || 0,
    busyActions: snapshot.qgis?.busyActions || [],
    workerDetails: snapshot.qgis?.workerDetails || []
  })).sort((left, right) => left.pid - right.pid);
  const processCpuValues = list.map((snapshot) => snapshot.process.cpuPercent).filter(Number.isFinite);
  return {
    capturedAt: newest.capturedAt,
    host: newest.host,
    process: {
      nodeProcesses: list.length,
      pids: processSnapshots.map((snapshot) => snapshot.pid),
      rssBytes: sum((snapshot) => snapshot.process.rssBytes),
      heapUsedBytes: sum((snapshot) => snapshot.process.heapUsedBytes),
      cpuPercent: processCpuValues.length ? Math.min(100, Math.round(processCpuValues.reduce((total, value) => total + value, 0))) : null,
      activeChildProcesses: sum((snapshot) => snapshot.process.activeChildProcesses),
      processes: processSnapshots
    },
    qgis: {
      workers: sum((snapshot) => snapshot.qgis?.workers),
      busyWorkers: sum((snapshot) => snapshot.qgis?.busyWorkers),
      queuedTasks: sum((snapshot) => snapshot.qgis?.queuedTasks),
      queueLimit: sum((snapshot) => snapshot.qgis?.queueLimit),
      busyActions: processSnapshots.flatMap((snapshot) => snapshot.busyActions.map((action) => `${snapshot.pid}:${action}`)).slice(0, 32),
      workerDetails: processSnapshots.flatMap((snapshot) => snapshot.workerDetails.map((worker) => ({ ...worker, nodePid: snapshot.pid }))).slice(0, 64)
    },
    counters: {
      wmsTileCacheHits: sum((snapshot) => snapshot.counters?.wmsTileCacheHits),
      wmsTileCacheMisses: sum((snapshot) => snapshot.counters?.wmsTileCacheMisses),
      wmsTileCacheCoalesced: sum((snapshot) => snapshot.counters?.wmsTileCacheCoalesced)
    }
  };
};
