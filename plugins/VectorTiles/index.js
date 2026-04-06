import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import Database from 'better-sqlite3';

const asTrimmed = (value, fallback = '') => {
  if (value == null) return fallback;
  return String(value).trim();
};

const sanitizeProjectId = (value) => {
  const raw = asTrimmed(value).replace(/[^a-zA-Z0-9._-]/g, '');
  // Reject path traversal sequences
  if (!raw || raw === '.' || raw === '..' || raw.includes('..')) return '';
  return raw;
};

const normalizeSelectedLayerIds = (value) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const id = asTrimmed(item);
    if (!id) continue;
    if (id.length > 256) continue;
    out.push(id);
    if (out.length >= 500) break;
  }
  return [...new Set(out)];
};
const layerSlug = (value) => asTrimmed(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

let _securityRef = null;
const isAdmin = (req) => {
  // When auth is not enabled, everyone is admin
  if (!_securityRef || !_securityRef.isEnabled || !_securityRef.isEnabled()) return true;
  // When auth IS enabled, require an authenticated admin user
  return !!(req.user && req.user.role === 'admin');
};

const listQgisProjects = (projectsDir) => {
  const out = [];
  if (!fs.existsSync(projectsDir)) return out;
  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });

  const findSingleProjectFileRecursive = (rootDir) => {
    const matches = [];
    const stack = [rootDir];
    const rootResolved = path.resolve(rootDir);
    const rootLower = rootResolved.toLowerCase();
    let scanned = 0;
    const MAX_SCAN = 2000;

    while (stack.length) {
      const current = stack.pop();
      scanned += 1;
      if (scanned > MAX_SCAN) break;

      let listing;
      try {
        listing = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const ent of listing) {
        if (!ent) continue;
        const fullPath = path.join(current, ent.name);
        const fullResolved = path.resolve(fullPath);
        if (!fullResolved.toLowerCase().startsWith(rootLower + path.sep)) continue;

        if (ent.isDirectory()) {
          if (ent.name === 'node_modules' || ent.name === '.git') continue;
          stack.push(fullPath);
        } else if (ent.isFile()) {
          const lower = ent.name.toLowerCase();
          if (lower.endsWith('.qgz') || lower.endsWith('.qgs')) {
            matches.push(fullPath);
            if (matches.length > 1) return matches;
          }
        }
      }
    }

    return matches;
  };

  for (const entry of entries) {
    if (entry.isFile() && /\.(qgz|qgs)$/i.test(entry.name)) {
      const id = entry.name.replace(/\.(qgz|qgs)$/i, '');
      out.push({ id, name: id, file: path.join(projectsDir, entry.name) });
      continue;
    }
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(projectsDir, entry.name);
    const inner = findSingleProjectFileRecursive(dirPath);
    if (inner.length === 1) {
      const id = entry.name;
      out.push({ id, name: id, file: inner[0] });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
};

const resolveProjectPath = (projectsDir, projectId) => {
  const safeId = sanitizeProjectId(projectId);
  if (!safeId) return null;
  const projects = listQgisProjects(projectsDir);
  const match = projects.find((item) => item && item.id === safeId);
  if (!match || !match.file) return null;
  return fs.existsSync(match.file) ? match.file : null;
};

const ensureDir = async (dir) => {
  await fs.promises.mkdir(dir, { recursive: true });
};

// ── Native SQLite tile I/O (replaces Python subprocess for reads) ──
// Keeps a small pool of open database handles to avoid re-opening on every request.
const _dbPool = new Map(); // mbtilesPath -> { db, lastUsed }
const DB_POOL_MAX_IDLE_MS = 5 * 60 * 1000;

const getDb = (mbtilesPath) => {
  const entry = _dbPool.get(mbtilesPath);
  if (entry) {
    entry.lastUsed = Date.now();
    return entry.db;
  }
  try {
    const db = new Database(mbtilesPath, { readonly: true, fileMustExist: true });
    _dbPool.set(mbtilesPath, { db, lastUsed: Date.now() });
    return db;
  } catch {
    return null;
  }
};

// Periodically close idle database handles
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of _dbPool) {
    if (now - entry.lastUsed > DB_POOL_MAX_IDLE_MS) {
      try { entry.db.close(); } catch {}
      _dbPool.delete(key);
    }
  }
}, 60_000).unref();

/**
 * Read a single tile from MBTiles. Returns Buffer or null.
 * XYZ → TMS conversion: y_tms = (2^z - 1) - y_xyz
 */
const readTileNative = (mbtilesPath, z, x, y_xyz) => {
  const db = getDb(mbtilesPath);
  if (!db) return null;
  try {
    const y_tms = ((1 << z) - 1) - y_xyz;
    const row = db.prepare(
      'SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ? LIMIT 1'
    ).get(z, x, y_tms);
    return row ? row.tile_data : null;
  } catch {
    return null;
  }
};

/**
 * Read MBTiles metadata and parse vector_layers from the JSON metadata entry.
 */
const readMbtilesMetadataNative = (mbtilesPath) => {
  const db = getDb(mbtilesPath);
  if (!db) return { metadata: {}, vectorLayers: [] };
  try {
    const rows = db.prepare('SELECT name, value FROM metadata').all();
    const metadata = {};
    for (const row of rows) metadata[row.name] = row.value;
    let vectorLayers = [];
    if (metadata.json) {
      try {
        const parsed = JSON.parse(metadata.json);
        if (parsed && Array.isArray(parsed.vector_layers)) vectorLayers = parsed.vector_layers;
      } catch {}
    }
    return { metadata, vectorLayers };
  } catch {
    return { metadata: {}, vectorLayers: [] };
  }
};

/**
 * Close a specific database handle (e.g. before writing to it).
 */
const closeDbHandle = (mbtilesPath) => {
  const entry = _dbPool.get(mbtilesPath);
  if (entry) {
    try { entry.db.close(); } catch {}
    _dbPool.delete(mbtilesPath);
  }
};

/**
 * Create an empty MBTiles file with the correct schema (tiles + metadata tables).
 * Uses better-sqlite3 directly — no Python needed.
 */
const initMbtilesNative = (mbtilesPath) => {
  const db = new Database(mbtilesPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tiles (
        zoom_level integer,
        tile_column integer,
        tile_row integer,
        tile_data blob,
        UNIQUE (zoom_level, tile_column, tile_row)
      );
      CREATE TABLE IF NOT EXISTS metadata (
        name text,
        value text,
        UNIQUE (name)
      );
    `);
  } finally {
    db.close();
  }
};

const killProcessTree = (proc) => {
  if (!proc || !proc.pid) return;
  try {
    execSync(`taskkill /T /F /PID ${proc.pid}`, { stdio: 'ignore', timeout: 5000 });
  } catch (e) {
    // Fallback: try normal kill if taskkill fails (e.g. process already exited)
    try { proc.kill('SIGKILL'); } catch (_) {}
  }
};

const spawnWithWrapper = ({ scriptPath, args = [], cwd, onSpawn }) => new Promise((resolve, reject) => {
  const wrapper = path.join(process.cwd(), 'tools', 'run_qgis_python.bat');
  const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
  const childArgs = ['/c', wrapper, scriptPath, ...args.map((x) => String(x))];
  const proc = spawn(comspec, childArgs, {
    cwd: cwd || process.cwd(),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const stdoutParts = [];
  const stderrParts = [];

  try {
    if (typeof onSpawn === 'function') onSpawn(proc);
  } catch {}

  proc.stdout.on('data', (chunk) => stdoutParts.push(Buffer.from(chunk)));
  proc.stderr.on('data', (chunk) => stderrParts.push(Buffer.from(chunk)));
  proc.on('error', (err) => reject(err));
  proc.on('close', (code) => {
    resolve({
      code,
      stdout: Buffer.concat(stdoutParts),
      stderr: Buffer.concat(stderrParts)
    });
  });
});

const parseJsonOutput = (buffer) => {
  const text = String(buffer || '').trim();
  if (!text) return null;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
    const candidate = lines[idx];
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return null;
};

const enforceProjectAccess = async ({ req, res, security, projectId }) => {
  if (!security || !security.isEnabled || !security.isEnabled()) return true;
  return await new Promise((resolve) => {
    let done = false;
    const finish = (allowed) => {
      if (done) return;
      done = true;
      resolve(Boolean(allowed));
    };
    const next = () => {
      finish(true);
    };
    try {
      const maybe = security.ensureProjectAccess(req, res, next, projectId);

      // If middleware already wrote a response, treat as denied and stop route handling.
      if (!done && (res.headersSent || res.writableEnded)) {
        return finish(false);
      }

      if (maybe && typeof maybe.then === 'function') {
        maybe.then(() => {
          if (done) return;
          if (res.headersSent || res.writableEnded) return finish(false);
          return finish(true);
        }).catch(() => {
          finish(false);
        });
      }
    } catch {
      finish(false);
    }
  });
};

export const register = async ({ app, baseDir, registerStore, security }) => {
  _securityRef = security;
  const pluginName = 'VectorTiles';
  const projectsDir = path.join(process.cwd(), 'qgisprojects');
  const cacheRoot = path.join(process.cwd(), 'cache', 'vector-tiles');
  const pyGenerate = path.join(baseDir, 'python', 'generate_vector_tiles.py');
  const pyListLayers = path.join(baseDir, 'python', 'list_project_layers.py');
  const pyReadTile = path.join(baseDir, 'python', 'read_mbtiles_tile.py');
  const pyReadMetadata = path.join(baseDir, 'python', 'read_mbtiles_metadata.py');
  const pyIdentify = path.join(baseDir, 'python', 'identify_vector_feature.py');
  const pyInitMbtiles = path.join(baseDir, 'python', 'init_mbtiles.py');
  const clientDir = path.join(baseDir, 'client');

  const tilesetStore = registerStore('tilesets.json', { items: {} });

  // Cleanup orphaned .tmp.mbtiles from previous runs (crash/restart)
  try {
    if (fs.existsSync(cacheRoot)) {
      for (const dir of fs.readdirSync(cacheRoot)) {
        const sub = path.join(cacheRoot, dir);
        if (!fs.statSync(sub).isDirectory()) continue;
        for (const f of fs.readdirSync(sub)) {
          if (f.endsWith('.tmp.mbtiles')) {
            try { fs.unlinkSync(path.join(sub, f)); } catch (e) {}
          }
        }
      }
    }
  } catch (e) {}

  const jobs = [];
  const MAX_JOB_HISTORY = 120;
  const queuedJobIds = [];
  // Worker / resource configuration (overrides via .env)
  const MAX_CONCURRENT_WORKERS = Math.max(1, Number(process.env.VECTOR_TILES_MAX_CONCURRENT_WORKERS) || 1);
  const MAX_ONDEMAND_WORKERS = Math.max(1, Number(process.env.VECTOR_TILES_MAX_ONDEMAND_WORKERS) || 3);
  const WORKER_TIMEOUT_MS = Number(process.env.VECTOR_TILES_WORKER_TIMEOUT_MS) || (30 * 60 * 1000);
  const WORKER_MAX_RETRIES = Math.max(0, Number(process.env.VECTOR_TILES_WORKER_MAX_RETRIES) || 1);
  const ONDEMAND_WAIT_SECONDS = Math.min(Math.max(Number(process.env.VECTOR_TILES_ONDEMAND_WAIT_SECONDS) || 12, 0), 120);
  const ONDEMAND_QGIS_WAIT_SECONDS = Math.min(Math.max(Number(process.env.VECTOR_TILES_QGIS_WAIT_SECONDS) || 60, 0), 120);
  const VECTOR_TILES_PERSISTENT_WORKER = String(process.env.VECTOR_TILES_PERSISTENT_WORKER || 'false').toLowerCase() === 'true';

  let runningJobsCount = 0;
  let runningOndemandCount = 0;
  const runningJobProcs = new Map(); // jobId -> ChildProcess
  // Track how many HTTP connections are actively waiting for each on-demand job.
  // When all clients disconnect (viewer/QGIS closed), cancel the job + kill Python.
  const ondemandWaiters = new Map(); // jobId -> count of waiting HTTP connections

  const addOndemandWaiter = (jobId) => {
    ondemandWaiters.set(jobId, (ondemandWaiters.get(jobId) || 0) + 1);
  };
  const removeOndemandWaiter = (jobId) => {
    const current = ondemandWaiters.get(jobId) || 0;
    if (current <= 1) {
      ondemandWaiters.delete(jobId);
      return 0;
    }
    ondemandWaiters.set(jobId, current - 1);
    return current - 1;
  };
  const cancelOndemandJob = (job) => {
    if (!job || job.status === 'completed' || job.status === 'error' || job.status === 'cancelled') return;
    job.cancelRequested = true;
    if (job.status === 'queued') {
      const idx = queuedJobIds.indexOf(job.id);
      if (idx >= 0) queuedJobIds.splice(idx, 1);
      job.status = 'cancelled';
      job.endedAt = new Date().toISOString();
      job.error = 'all_clients_disconnected';
      return;
    }
    if (job.status === 'running') {
      const proc = runningJobProcs.get(job.id);
      if (proc) {
        killProcessTree(proc);
      }
    }
  };

  const buildJobId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const serializeJob = (job) => ({
    id: job.id,
    projectId: job.projectId,
    minZoom: job.minZoom,
    maxZoom: job.maxZoom,
    selectedLayerIds: Array.isArray(job.selectedLayerIds) ? job.selectedLayerIds : [],
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    endedAt: job.endedAt || null,
    retryOf: job.retryOf || null,
    retries: Number.isFinite(job.retries) ? job.retries : 0,
    error: job.error || null,
    ondemand: job.ondemand === true,
    ondemandTile: job.ondemandTile || null,
    ondemandTileRange: job.ondemandTileRange || null,
    cancelRequested: job.cancelRequested === true,
    output: job.output || null,
    tileset: job.tileset || null
  });

  const trimJobs = () => {
    if (jobs.length <= MAX_JOB_HISTORY) return;
    jobs.splice(0, jobs.length - MAX_JOB_HISTORY);
  };

  const findJob = (jobId) => jobs.find((job) => job && job.id === jobId) || null;

  // Convert tile coordinates to a WGS-84 bbox padded by `pad` tiles in each direction.
  const ONDEMAND_TILE_PAD = 4;
  const tileToBboxWgs84 = (z, x, y, pad) => {
    const n = Math.pow(2, z);
    const x0 = Math.max(0, x - pad);
    const x1 = Math.min(n - 1, x + pad);
    const y0 = Math.max(0, y - pad);
    const y1 = Math.min(n - 1, y + pad);
    const lng0 = x0 / n * 360 - 180;
    const lng1 = (x1 + 1) / n * 360 - 180;
    const lat1 = Math.atan(Math.sinh(Math.PI * (1 - 2 * y0 / n))) * 180 / Math.PI;
    const lat0 = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y1 + 1) / n))) * 180 / Math.PI;
    return { bbox: [lng0, lat0, lng1, lat1], tileRange: { x0, y0, x1, y1 } };
  };

  const findPendingOndemandTile = (projectId, z, x, y) => {
    return jobs.find((job) => {
      if (!job || job.projectId !== projectId || !job.ondemand) return false;
      if (job.status !== 'queued' && job.status !== 'running') return false;
      if (Number(job.minZoom) !== z || Number(job.maxZoom) !== z) return false;
      const r = job.ondemandTileRange;
      if (r) return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
      return true;
    }) || null;
  };

  // Check if a specific tile was already covered by a recently completed on-demand job.
  // For bbox-limited jobs, only tiles within the generated area are considered covered.
  const wasRecentlyGenerated = (projectId, z, x, y) => {
    const RECENT_MS = 5 * 60 * 1000;
    const cutoff = Date.now() - RECENT_MS;
    return jobs.some((job) => {
      if (!job || job.projectId !== projectId || job.status !== 'completed') return false;
      if (Number(job.minZoom) > z || Number(job.maxZoom) < z) return false;
      if (!job.endedAt || Date.parse(job.endedAt) <= cutoff) return false;
      if (!job.ondemand) return true; // full-extent job covers everything
      const r = job.ondemandTileRange;
      if (r) return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
      return true; // legacy job without tile range
    });
  };

  const hasPendingForProject = (projectId) => {
    if (!projectId) return false;
    return jobs.some((job) => job.projectId === projectId && (job.status === 'queued' || job.status === 'running'));
  };

  const executeGenerate = async (job) => {
    const projectId = job.projectId;
    const minZoom = job.minZoom;
    const maxZoom = job.maxZoom;
    const selectedLayerIds = Array.isArray(job.selectedLayerIds) ? job.selectedLayerIds : [];
    const projectPath = resolveProjectPath(projectsDir, projectId);
    if (!projectPath) {
      throw new Error('project_not_found');
    }
    const outputDir = path.join(cacheRoot, projectId);
    const outputFile = path.join(outputDir, 'tiles.mbtiles');
    await ensureDir(outputDir);

    // Close any read-only DB handle before writing/merging into the file
    closeDbHandle(outputFile);

    // Build args; for ondemand jobs generate into a temporary MBTiles and merge into the main file.
    // On-demand jobs use a padded bbox around the requested tile for fast generation.
    let outArg = outputFile;
    let mergeIntoArg = null;
    let bboxArg = '';
    if (job && job.ondemand && job.ondemandTile) {
      outArg = path.join(outputDir, `tiles.${job.id}.tmp.mbtiles`);
      mergeIntoArg = outputFile;
      if (job.ondemandBbox && Array.isArray(job.ondemandBbox) && job.ondemandBbox.length === 4) {
        bboxArg = job.ondemandBbox.join(',');
      }
    }
    const args = [projectPath, outArg, String(minZoom), String(maxZoom), JSON.stringify(selectedLayerIds)];
    if (mergeIntoArg) args.push(bboxArg, mergeIntoArg);

    let timeoutHandle = null;
    let timedOut = false;
    const onSpawnHandler = (proc) => {
      try { runningJobProcs.set(job.id, proc); } catch (e) {}
      try {
        timeoutHandle = setTimeout(() => {
          try { killProcessTree(proc); timedOut = true; } catch (e) {}
        }, WORKER_TIMEOUT_MS);
      } catch (e) {}
    };

    const run = await spawnWithWrapper({
      scriptPath: pyGenerate,
      args,
      cwd: process.cwd(),
      onSpawn: onSpawnHandler
    });
    try { if (timeoutHandle) clearTimeout(timeoutHandle); } catch (e) {}
    if (timedOut) {
      throw new Error('job_timeout');
    }
    const parsed = parseJsonOutput(run.stdout);
    if (run.code !== 0 || !parsed?.ok) {
      const details = parsed?.details || String(run.stderr || '').trim() || 'vector_tile_generation_failed';
      const detailsLower = String(details).toLowerCase();
      if (
        detailsLower.includes("no module named 'qgis'") ||
        detailsLower.includes('qgis_import_failed') ||
        detailsLower.includes('qgis import failed')
      ) {
        throw new Error('qgis_python_environment_not_available');
      }
      throw new Error(details);
    }

    const vectorLayers = await loadMbtilesVectorLayers(outputFile);
    const sourceLayers = vectorLayers.map((row) => asTrimmed(row?.id || '')).filter(Boolean);

    const metadata = {
      projectId,
      mbtilesPath: outputFile,
      minZoom,
      maxZoom,
      selectedLayerIds,
      vectorLayerCount: parsed.vectorLayerCount || null,
      selectedLayerCount: parsed.selectedLayerCount || null,
      layerStyles: Array.isArray(parsed.layerStyles) ? parsed.layerStyles : [],
      sourceLayerMeta: Array.isArray(parsed.sourceLayerMeta) ? parsed.sourceLayerMeta : [],
      sourceLayers,
      bounds: Array.isArray(parsed.bounds) ? parsed.bounds : null,
      updatedAt: new Date().toISOString()
    };

    await tilesetStore.update((draft) => {
      const items = draft && draft.items && typeof draft.items === 'object' ? { ...draft.items } : {};
      const prev = items[projectId] || null;
      // On-demand jobs only generate a single zoom level — merge into existing metadata
      // so we don't lose the pre-cached zoom range, styles, bounds, etc.
      if (job && job.ondemand && prev) {
        const mergedMinZoom = Math.min(Number.isFinite(prev.minZoom) ? prev.minZoom : minZoom, minZoom);
        const mergedMaxZoom = Math.max(Number.isFinite(prev.maxZoom) ? prev.maxZoom : maxZoom, maxZoom);
        const merged = {
          ...prev,
          minZoom: mergedMinZoom,
          maxZoom: mergedMaxZoom,
          updatedAt: metadata.updatedAt
        };
        // If prev has empty styles/layers (e.g. auto-bootstrapped), fill from this generation
        if ((!Array.isArray(prev.layerStyles) || !prev.layerStyles.length) && metadata.layerStyles.length) {
          merged.layerStyles = metadata.layerStyles;
        }
        if ((!Array.isArray(prev.sourceLayerMeta) || !prev.sourceLayerMeta.length) && metadata.sourceLayerMeta.length) {
          merged.sourceLayerMeta = metadata.sourceLayerMeta;
        }
        if ((!Array.isArray(prev.sourceLayers) || !prev.sourceLayers.length) && metadata.sourceLayers.length) {
          merged.sourceLayers = metadata.sourceLayers;
        }
        if (!prev.bounds && metadata.bounds) {
          merged.bounds = metadata.bounds;
        }
        if (!prev.vectorLayerCount && metadata.vectorLayerCount) {
          merged.vectorLayerCount = metadata.vectorLayerCount;
        }
        if (!prev.selectedLayerCount && metadata.selectedLayerCount) {
          merged.selectedLayerCount = metadata.selectedLayerCount;
        }
        items[projectId] = merged;
      } else {
        items[projectId] = metadata;
      }
      return { ...draft, items };
    });

    return { metadata, parsed };
  };

  const startNextJobs = () => {
    // start as many jobs as allowed by concurrency limits
    // On-demand single-tile jobs use a higher concurrency limit to reduce QGIS/OL timeouts
    while (queuedJobIds.length) {
      const nextJobId = queuedJobIds[0];
      const nextJob = findJob(nextJobId);
      if (!nextJob || nextJob.status !== 'queued') { queuedJobIds.shift(); continue; }
      const isOndemand = nextJob.ondemand === true;
      const maxSlots = isOndemand ? MAX_ONDEMAND_WORKERS : MAX_CONCURRENT_WORKERS;
      if (runningJobsCount >= maxSlots) break;
      queuedJobIds.shift();
      const job = nextJob;
      // start job async
      (async (job) => {
        job.status = 'running';
        job.startedAt = new Date().toISOString();
        job.error = null;
        job.output = null;
        runningJobsCount += 1;
        if (job.ondemand) runningOndemandCount += 1;
        try {
          const result = await executeGenerate(job);
          if (job.cancelRequested) {
            job.status = 'cancelled';
            job.error = 'job_cancelled';
          } else {
            job.status = 'completed';
          }
          job.endedAt = new Date().toISOString();
          job.tileset = result.metadata;
          job.output = result.parsed || null;
          // Invalidate stale DB handle after merge so subsequent tile reads see the new data
          if (result.metadata && result.metadata.mbtilesPath) {
            closeDbHandle(result.metadata.mbtilesPath);
          }
        } catch (err) {
          job.status = job.cancelRequested ? 'cancelled' : 'error';
          job.endedAt = new Date().toISOString();
          job.error = job.cancelRequested
            ? 'job_cancelled'
            : String(err?.message || err || 'vector_tile_generation_failed');
        } finally {
          // cleanup proc map if present
          try { runningJobProcs.delete(job.id); } catch (e) {}
          // Remove leftover temp MBTiles (Python may fail to delete if file is locked)
          if (job.ondemand && job.id) {
            const tmpPath = path.join(cacheRoot, job.projectId, `tiles.${job.id}.tmp.mbtiles`);
            // Try immediately, then retry after a delay if file is still locked
            const tryDelete = (retries) => {
              try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) {
                if (retries > 0) setTimeout(() => tryDelete(retries - 1), 2000);
              }
            };
            tryDelete(3);
          }
          runningJobsCount = Math.max(0, runningJobsCount - 1);
          if (job.ondemand) runningOndemandCount = Math.max(0, runningOndemandCount - 1);
          // Trigger start of more jobs if available
          setImmediate(startNextJobs);
        }
      })(job).catch(() => {
        runningJobsCount = Math.max(0, runningJobsCount - 1);
        if (job.ondemand) runningOndemandCount = Math.max(0, runningOndemandCount - 1);
        setImmediate(startNextJobs);
      });
    }
    trimJobs();
  };

  const MAX_ONDEMAND_QUEUED = Math.max(1, Number(process.env.VECTOR_TILES_MAX_ONDEMAND_QUEUED) || 30);

  const enqueueJob = ({ projectId, minZoom, maxZoom, selectedLayerIds = [], retryOf = null, ondemand = false, priority = false, ondemandTile = null }) => {
    // Limit how many on-demand jobs can be queued to prevent queue explosion during rapid zooming
    if (ondemand) {
      const queuedOndemand = jobs.filter((j) => j && j.ondemand && j.status === 'queued').length;
      if (queuedOndemand >= MAX_ONDEMAND_QUEUED) {
        // Drop oldest queued on-demand jobs to make room
        const oldQueued = jobs.filter((j) => j && j.ondemand && j.status === 'queued');
        for (let i = 0; i < oldQueued.length - MAX_ONDEMAND_QUEUED + 1; i++) {
          const old = oldQueued[i];
          old.status = 'cancelled';
          old.endedAt = new Date().toISOString();
          old.error = 'queue_overflow';
          const idx = queuedJobIds.indexOf(old.id);
          if (idx >= 0) queuedJobIds.splice(idx, 1);
        }
      }
    }
    // Compute bbox and tile range for on-demand jobs
    let ondemandBbox = null;
    let ondemandTileRange = null;
    if (ondemand && ondemandTile) {
      const { bbox, tileRange } = tileToBboxWgs84(ondemandTile.z, ondemandTile.x, ondemandTile.y, ONDEMAND_TILE_PAD);
      ondemandBbox = bbox;
      ondemandTileRange = tileRange;
    }
    const job = {
      id: buildJobId(),
      projectId,
      minZoom,
      maxZoom,
      selectedLayerIds: Array.isArray(selectedLayerIds) ? selectedLayerIds : [],
      status: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
      retryOf,
      retries: retryOf ? 1 : 0,
      error: null,
      output: null,
      tileset: null,
      ondemand: !!ondemand,
      ondemandTile: ondemandTile || null,
      ondemandBbox,
      ondemandTileRange
    };
    jobs.push(job);
    if (priority === true || ondemand === true) queuedJobIds.unshift(job.id); else queuedJobIds.push(job.id);
    trimJobs();
    setImmediate(() => {
      try { startNextJobs(); } catch (e) {}
    });
    return job;
  };

  const colorFromName = (name) => {
    const raw = String(name || 'layer');
    let hash = 0;
    for (let idx = 0; idx < raw.length; idx += 1) {
      hash = ((hash << 5) - hash) + raw.charCodeAt(idx);
      hash |= 0;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 65%, 50%)`;
  };

  const loadMbtilesVectorLayers = async (mbtilesPath) => {
    if (!mbtilesPath || !fs.existsSync(mbtilesPath)) return [];
    try {
      const { vectorLayers } = readMbtilesMetadataNative(mbtilesPath);
      return Array.isArray(vectorLayers) ? vectorLayers : [];
    } catch {
      return [];
    }
  };

  const buildStyleLinks = ({ base, projectId, sourceLayers = [] }) => {
    const layers = Array.isArray(sourceLayers) ? sourceLayers.map((x) => asTrimmed(x)).filter(Boolean) : [];
    if (!layers.length) return { combined: null, perLayer: [] };

    const combinedLabel = layers.map((name) => layerSlug(name) || 'layer').join('_');
    const combinedBase = `${base}/plugins/${pluginName}/style/${encodeURIComponent(projectId)}/${encodeURIComponent(combinedLabel)}.json`;
    const combinedUrl = `${combinedBase}?layers=${encodeURIComponent(layers.join(','))}`;

    const perLayer = layers.map((name) => {
      const slug = layerSlug(name) || 'layer';
      const styleBase = `${base}/plugins/${pluginName}/style/${encodeURIComponent(projectId)}/${encodeURIComponent(slug)}.json`;
      return {
        name,
        label: slug,
        url: `${styleBase}?layers=${encodeURIComponent(name)}`
      };
    });

    return {
      combined: {
        name: layers.join(', '),
        label: combinedLabel,
        url: combinedUrl,
        layers
      },
      perLayer
    };
  };



  app.use(`/plugins/${pluginName}/client`, express.static(clientDir, { index: false }));

  app.get(`/plugins/${pluginName}/admin`, (_req, res) => {
    res.sendFile(path.join(clientDir, 'admin.html'));
  });

  app.get(`/plugins/${pluginName}/api/projects`, async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'admin_required' });
    }
    const projects = listQgisProjects(projectsDir).map((p) => ({ id: p.id, name: p.name }));
    return res.json({ projects });
  });

  app.get(`/plugins/${pluginName}/api/projects/:projectId/layers`, async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'admin_required' });
    }

    const projectId = sanitizeProjectId(req.params?.projectId || '');
    if (!projectId) {
      return res.status(400).json({ error: 'project_id_required' });
    }

    const projectPath = resolveProjectPath(projectsDir, projectId);
    if (!projectPath) {
      return res.status(404).json({ error: 'project_not_found' });
    }

    try {
      const run = await spawnWithWrapper({
        scriptPath: pyListLayers,
        args: [projectPath],
        cwd: process.cwd()
      });
      const parsed = parseJsonOutput(run.stdout);
      if (run.code !== 0 || !parsed?.ok) {
        return res.status(500).json({
          error: parsed?.error || 'layer_list_failed',
          details: parsed?.details || String(run.stderr || '').trim() || 'layer_list_failed'
        });
      }
      return res.json({
        projectId,
        layers: Array.isArray(parsed.layers) ? parsed.layers : []
      });
    } catch (err) {
      return res.status(500).json({ error: 'layer_list_failed', details: String(err?.message || err || '') });
    }
  });

  app.get(`/plugins/${pluginName}/api/tilesets`, async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'admin_required' });
    }
    const snapshot = await tilesetStore.read();
    const items = snapshot && snapshot.items && typeof snapshot.items === 'object' ? snapshot.items : {};
    const base = `${req.protocol}://${req.get('host')}`;
    const listRaw = Object.values(items).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const list = await Promise.all(listRaw.map(async (item) => {
      const sourceLayers = Array.isArray(item?.sourceLayers) && item.sourceLayers.length
        ? item.sourceLayers
        : (await loadMbtilesVectorLayers(item?.mbtilesPath)).map((row) => asTrimmed(row?.id || '')).filter(Boolean);
      const styleLinks = buildStyleLinks({ base, projectId: item.projectId, sourceLayers });
      let fileSizeBytes = 0;
      try { const stat = fs.statSync(item.mbtilesPath); fileSizeBytes = stat.size || 0; } catch {}
      return { ...item, sourceLayers, styleLinks, fileSizeBytes };
    }));
    return res.json({ tilesets: list });
  });

  app.post(`/plugins/${pluginName}/api/generate`, async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'admin_required' });
    }

    const projectId = sanitizeProjectId(req.body?.projectId || '');
    const minZoom = Number.isFinite(Number(req.body?.minZoom)) ? Math.max(0, Math.floor(Number(req.body.minZoom))) : 0;
    const maxZoom = Number.isFinite(Number(req.body?.maxZoom)) ? Math.max(minZoom, Math.floor(Number(req.body.maxZoom))) : 14;
    const selectedLayerIds = normalizeSelectedLayerIds(req.body?.selectedLayerIds);
    const overwrite = req.body?.overwrite === true;

    if (!projectId) {
      return res.status(400).json({ error: 'project_id_required' });
    }

    if (hasPendingForProject(projectId)) {
      const accept = String(req.get('accept-language') || '').toLowerCase();
      const lang = accept.startsWith('es') ? 'es' : (accept.startsWith('sv') ? 'sv' : 'en');
      const JOB_MSGS = {
        en: 'A job for this project is already queued or running.',
        es: 'Ya hay un trabajo en cola o en ejecución para este proyecto.',
        sv: 'Ett jobb för detta projekt finns redan i kö eller körs.'
      };
      return res.status(409).json({ error: 'job_already_running_for_project', details: JOB_MSGS[lang] || JOB_MSGS.en });
    }

    const projectPath = resolveProjectPath(projectsDir, projectId);
    if (!projectPath) {
      return res.status(404).json({ error: 'project_not_found' });
    }

    const snapshot = await tilesetStore.read();
    const items = snapshot && snapshot.items && typeof snapshot.items === 'object' ? snapshot.items : {};
    const existing = items[projectId];
    if (!overwrite && existing?.mbtilesPath && fs.existsSync(existing.mbtilesPath)) {
      const accept = String(req.get('accept-language') || '').toLowerCase();
      const lang = accept.startsWith('es') ? 'es' : (accept.startsWith('sv') ? 'sv' : 'en');
      const MSGS = {
        en: 'A vector tile cache already exists for this project. Overwrite it?',
        es: 'Ya existe una caché vector tile para este proyecto. ¿Deseas sobrescribirla?',
        sv: 'Det finns redan en vector tile-cache för projektet. Vill du skriva över den?'
      };
      return res.status(409).json({ error: 'tileset_exists', details: MSGS[lang] || MSGS.en });
    }

    const job = enqueueJob({ projectId, minZoom, maxZoom, selectedLayerIds });
    return res.status(202).json({ status: 'queued', job: serializeJob(job) });
  });

  // On-demand single-tile / viewport generation endpoint (queues a prioritized job)
  app.post(`/plugins/${pluginName}/api/ondemand`, async (req, res) => {
    // Allow any authenticated user (or unauthenticated when auth is disabled) with project access
    const projectId = sanitizeProjectId(req.body?.projectId || '');
    if (!projectId) return res.status(400).json({ error: 'project_id_required' });

    if (!isAdmin(req)) {
      const allowed = await enforceProjectAccess({ req, res, security, projectId });
      if (!allowed) return;
    }

    const z = Number.isFinite(Number(req.body?.z)) ? Math.max(0, Math.floor(Number(req.body?.z))) : null;
    const x = Number.isFinite(Number(req.body?.x)) ? Math.max(0, Math.floor(Number(req.body?.x))) : null;
    const y = Number.isFinite(Number(req.body?.y)) ? Math.max(0, Math.floor(Number(req.body?.y))) : null;
    if (z === null || x === null || y === null) return res.status(400).json({ error: 'tile_zxy_required' });

    const projectPath = resolveProjectPath(projectsDir, projectId);
    if (!projectPath) return res.status(404).json({ error: 'project_not_found' });

    // Queue a job that targets the requested zoom level (minZoom=maxZoom) and mark as ondemand/prioritized
    const job = enqueueJob({ projectId, minZoom: z, maxZoom: z, selectedLayerIds: [], ondemand: true, priority: true, ondemandTile: { z, x, y } });
    return res.status(202).json({ status: 'queued', job: serializeJob(job) });
  });

  app.get(`/plugins/${pluginName}/api/jobs`, async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'admin_required' });
    }
    const ordered = jobs.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return res.json({
      jobs: ordered.map(serializeJob),
      summary: {
        queued: ordered.filter((job) => job.status === 'queued').length,
        running: ordered.filter((job) => job.status === 'running').length,
        completed: ordered.filter((job) => job.status === 'completed').length,
        error: ordered.filter((job) => job.status === 'error').length,
        cancelled: ordered.filter((job) => job.status === 'cancelled').length
      }
    });
  });

  app.get(`/plugins/${pluginName}/api/jobs/:jobId`, async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'admin_required' });
    }
    const jobId = asTrimmed(req.params?.jobId || '');
    if (!jobId) return res.status(400).json({ error: 'job_id_required' });
    const job = findJob(jobId);
    if (!job) return res.status(404).json({ error: 'job_not_found' });
    return res.json({ job: serializeJob(job) });
  });

  app.post(`/plugins/${pluginName}/api/jobs/:jobId/retry`, async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'admin_required' });
    }
    const jobId = asTrimmed(req.params?.jobId || '');
    if (!jobId) return res.status(400).json({ error: 'job_id_required' });
    const sourceJob = findJob(jobId);
    if (!sourceJob) return res.status(404).json({ error: 'job_not_found' });
    if (sourceJob.status !== 'error') {
      return res.status(400).json({ error: 'job_retry_only_for_error' });
    }
    if (hasPendingForProject(sourceJob.projectId)) {
      return res.status(409).json({ error: 'job_already_running_for_project' });
    }
    const job = enqueueJob({
      projectId: sourceJob.projectId,
      minZoom: sourceJob.minZoom,
      maxZoom: sourceJob.maxZoom,
      selectedLayerIds: Array.isArray(sourceJob.selectedLayerIds) ? sourceJob.selectedLayerIds : [],
      retryOf: sourceJob.id
    });
    job.retries = (Number(sourceJob.retries) || 0) + 1;
    return res.status(202).json({ status: 'queued', job: serializeJob(job) });
  });

  app.post(`/plugins/${pluginName}/api/jobs/:jobId/cancel`, async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'admin_required' });
    }
    const jobId = asTrimmed(req.params?.jobId || '');
    if (!jobId) return res.status(400).json({ error: 'job_id_required' });
    const job = findJob(jobId);
    if (!job) return res.status(404).json({ error: 'job_not_found' });
    if (job.status !== 'queued' && job.status !== 'running') {
      return res.status(400).json({ error: 'job_not_cancellable' });
    }

    job.cancelRequested = true;

    if (job.status === 'queued') {
      const idx = queuedJobIds.indexOf(job.id);
      if (idx >= 0) queuedJobIds.splice(idx, 1);
      job.status = 'cancelled';
      job.endedAt = new Date().toISOString();
      job.error = 'job_cancelled';
      return res.json({ status: 'cancelled', job: serializeJob(job) });
    }

    if (job.status === 'running') {
      const proc = runningJobProcs.get(job.id);
      if (proc) {
        killProcessTree(proc);
      }
    }

    return res.json({ status: 'cancelling', job: serializeJob(job) });
  });

  app.post(`/plugins/${pluginName}/api/jobs/cancel-all`, async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'admin_required' });
    }
    let cancelled = 0;
    // Cancel all queued jobs
    const queuedCopy = [...queuedJobIds];
    for (const jobId of queuedCopy) {
      const job = findJob(jobId);
      if (job && job.status === 'queued') {
        job.cancelRequested = true;
        job.status = 'cancelled';
        job.endedAt = new Date().toISOString();
        job.error = 'job_cancelled';
        cancelled += 1;
      }
    }
    queuedJobIds.length = 0;
    // Kill all running jobs and clean up temp files
    for (const [jobId, proc] of runningJobProcs) {
      const job = findJob(jobId);
      if (job && job.status === 'running') {
        job.cancelRequested = true;
        killProcessTree(proc);
        cancelled += 1;
      }
    }
    // Deferred temp file cleanup — give OS a moment to release file locks after process kill
    setTimeout(() => {
      for (const job of jobs) {
        if (job && job.ondemand && job.id && (job.status === 'cancelled' || job.cancelRequested)) {
          try {
            const tmpPath = path.join(cacheRoot, job.projectId, `tiles.${job.id}.tmp.mbtiles`);
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
          } catch (e) {}
        }
      }
    }, 3000);
    return res.json({ status: 'ok', cancelled });
  });

  app.post(`/plugins/${pluginName}/api/jobs/:jobId/prioritize`, async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'admin_required' });
    }
    const jobId = asTrimmed(req.params?.jobId || '');
    if (!jobId) return res.status(400).json({ error: 'job_id_required' });
    const job = findJob(jobId);
    if (!job) return res.status(404).json({ error: 'job_not_found' });
    if (job.status !== 'queued') {
      return res.status(400).json({ error: 'job_not_queued' });
    }
    const idx = queuedJobIds.indexOf(job.id);
    if (idx >= 0) {
      queuedJobIds.splice(idx, 1);
      queuedJobIds.unshift(job.id);
    }
    return res.json({ status: 'prioritized', job: serializeJob(job) });
  });

  app.post(`/plugins/${pluginName}/api/jobs/prioritize-project/:projectId`, async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'admin_required' });
    }
    const projectId = sanitizeProjectId(req.params?.projectId || '');
    if (!projectId) return res.status(400).json({ error: 'project_id_required' });

    const queuedForProject = queuedJobIds.filter((id) => {
      const job = findJob(id);
      return job && job.status === 'queued' && job.projectId === projectId;
    });
    if (!queuedForProject.length) {
      return res.status(404).json({ error: 'no_queued_jobs_for_project' });
    }

    for (const id of queuedForProject) {
      const idx = queuedJobIds.indexOf(id);
      if (idx >= 0) queuedJobIds.splice(idx, 1);
    }
    queuedJobIds.unshift(...queuedForProject);

    return res.json({
      status: 'prioritized',
      projectId,
      movedJobs: queuedForProject
    });
  });

  // Per-project tileset info (admin)
  app.get(`/plugins/${pluginName}/api/tilesets/:projectId`, async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'admin_required' });
    }
    const projectId = sanitizeProjectId(req.params?.projectId || '');
    if (!projectId) {
      return res.status(400).json({ error: 'project_id_required' });
    }
    const snapshot = await tilesetStore.read();
    const items = snapshot && snapshot.items && typeof snapshot.items === 'object' ? snapshot.items : {};
    const item = items[projectId];
    if (!item) {
      return res.status(404).json({ error: 'tileset_not_found' });
    }
    // Enrich with file size
    let fileSizeBytes = 0;
    try {
      const stat = fs.statSync(item.mbtilesPath);
      fileSizeBytes = stat.size || 0;
    } catch {}
    return res.json({ tileset: { ...item, fileSizeBytes } });
  });

  app.delete(`/plugins/${pluginName}/api/tilesets/:projectId`, async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'admin_required' });
    }
    const projectId = sanitizeProjectId(req.params?.projectId || '');
    if (!projectId) {
      return res.status(400).json({ error: 'project_id_required' });
    }

    const projectCacheDir = path.join(cacheRoot, projectId);
    // Close any pooled DB handles so the file can be deleted on Windows
    try { closeDbHandle(path.join(projectCacheDir, 'tiles.mbtiles')); } catch {}
    try {
      await fs.promises.rm(projectCacheDir, { recursive: true, force: true });
    } catch {}

    await tilesetStore.update((draft) => {
      const items = draft && draft.items && typeof draft.items === 'object' ? { ...draft.items } : {};
      delete items[projectId];
      return { ...draft, items };
    });

    return res.status(204).send();
  });

  app.get(`/plugins/${pluginName}/tilejson/:projectId.json`, async (req, res) => {
    const projectId = sanitizeProjectId(req.params?.projectId || '');
    if (!projectId) return res.status(400).json({ error: 'project_id_required' });

    {
      const allowed = await enforceProjectAccess({ req, res, security, projectId });
      if (!allowed) return;
    }

    const snapshot = await tilesetStore.read();
    const items = snapshot && snapshot.items && typeof snapshot.items === 'object' ? snapshot.items : {};
    const tile = items[projectId];
    if (!tile || !tile.mbtilesPath || !fs.existsSync(tile.mbtilesPath)) {
      return res.status(404).json({ error: 'tileset_not_found' });
    }

    const base = `${req.protocol}://${req.get('host')}`;
    const url = `${base}/plugins/${pluginName}/tiles/${encodeURIComponent(projectId)}/{z}/{x}/{y}.pbf`;
    const style = `${base}/plugins/${pluginName}/style/${encodeURIComponent(projectId)}.json`;
    const vectorLayersRaw = (Array.isArray(tile.sourceLayerMeta) && tile.sourceLayerMeta.length)
      ? tile.sourceLayerMeta
      : (Array.isArray(tile.sourceLayers) && tile.sourceLayers.length
        ? tile.sourceLayers.map((name) => ({ id: asTrimmed(name) })).filter((row) => row.id)
        : (await loadMbtilesVectorLayers(tile.mbtilesPath)));
    const vectorLayers = Array.isArray(vectorLayersRaw)
      ? vectorLayersRaw
        .map((row) => {
          const id = asTrimmed(row?.id || row?.layer || row?.name || '');
          if (!id) return null;
          return {
            ...row,
            id
          };
        })
        .filter(Boolean)
      : [];
    return res.json({
      tilejson: '3.0.0',
      name: projectId,
      description: `Vector tiles for project ${projectId}`,
      scheme: 'xyz',
      format: 'pbf',
      minzoom: 0,
      maxzoom: 20,
      bounds: Array.isArray(tile.bounds) ? tile.bounds : undefined,
      tiles: [url],
      style,
      vector_layers: vectorLayers.length ? vectorLayers : undefined
    });
  });

  const serveStyle = async (req, res) => {
    const projectId = sanitizeProjectId(req.params?.projectId || '');
    if (!projectId) return res.status(400).json({ error: 'project_id_required' });

    {
      const allowed = await enforceProjectAccess({ req, res, security, projectId });
      if (!allowed) return;
    }

    const snapshot = await tilesetStore.read();
    const items = snapshot && snapshot.items && typeof snapshot.items === 'object' ? snapshot.items : {};
    const tile = items[projectId];
    if (!tile || !tile.mbtilesPath || !fs.existsSync(tile.mbtilesPath)) {
      return res.status(404).json({ error: 'tileset_not_found' });
    }

    const base = `${req.protocol}://${req.get('host')}`;
    const tilesUrl = `${base}/plugins/${pluginName}/tiles/${encodeURIComponent(projectId)}/{z}/{x}/{y}.pbf`;
    // Always expose the full renderable zoom range (0–20) in styles, NOT the generated range.
    // The generated range only reflects which tiles exist in MBTiles — missing ones trigger on-demand.
    const minZoom = 0;
    const maxZoom = 20;

    const vectorLayers = await loadMbtilesVectorLayers(tile.mbtilesPath);
    const styles = Array.isArray(tile.layerStyles) ? tile.layerStyles : [];
    const styleByName = new Map();
    for (const item of styles) {
      const layerName = asTrimmed(item?.layerName || '').toLowerCase();
      if (!layerName) continue;
      styleByName.set(layerName, item);
    }

    const sourceLayers = (Array.isArray(tile.sourceLayers) && tile.sourceLayers.length)
      ? tile.sourceLayers.map((name) => asTrimmed(name)).filter(Boolean)
      : (vectorLayers.length
        ? vectorLayers.map((row) => asTrimmed(row?.id || '')).filter(Boolean)
        : styles.map((row) => asTrimmed(row?.layerName || '')).filter(Boolean));

    const requestedRaw = asTrimmed(req.query?.layers || '');
    const requested = requestedRaw
      ? requestedRaw.split(',').map((x) => asTrimmed(x)).filter(Boolean)
      : [];
    const selectedSourceLayers = requested.length
      ? sourceLayers.filter((name) => requested.includes(name))
      : sourceLayers;

    const layers = [];
    for (const sourceLayer of selectedSourceLayers) {
      const hint = styleByName.get(sourceLayer.toLowerCase()) || null;
      const geometryHint = asTrimmed(hint?.geometry || '').toLowerCase();
      const rendererHint = hint && hint.renderer && typeof hint.renderer === 'object' ? hint.renderer : null;
      const baseColor = asTrimmed(hint?.color || '') || colorFromName(sourceLayer);
      const lineWidthRaw = Number(hint?.lineWidth);
      const pointSizeRaw = Number(hint?.pointSize);
      const fillOpacityRaw = Number(hint?.fillOpacity);
      // QGIS styles can expose zero-width/zero-opacity hints; keep style visible by default.
      const lineWidth = Number.isFinite(lineWidthRaw) && lineWidthRaw > 0 ? lineWidthRaw : 1.25;
      const pointSize = Number.isFinite(pointSizeRaw) && pointSizeRaw > 0 ? pointSizeRaw : 4;
      const fillOpacity = Number.isFinite(fillOpacityRaw) && fillOpacityRaw > 0 ? Math.min(fillOpacityRaw, 1) : 0.55;

      const pushGeometryLayer = ({ idSuffix, color, lineWidthValue, pointSizeValue, fillOpacityValue, filter = null }) => {
        const effectiveColor = asTrimmed(color || '') || baseColor;
        const lineW = Number.isFinite(Number(lineWidthValue)) && Number(lineWidthValue) > 0 ? Number(lineWidthValue) : lineWidth;
        const pointR = Number.isFinite(Number(pointSizeValue)) && Number(pointSizeValue) > 0 ? Number(pointSizeValue) : pointSize;
        const fillO = Number.isFinite(Number(fillOpacityValue)) && Number(fillOpacityValue) > 0
          ? Math.min(Number(fillOpacityValue), 1)
          : fillOpacity;

        if (geometryHint === 'polygon') {
          const layer = {
            id: `${sourceLayer}-fill-${idSuffix}`,
            type: 'fill',
            source: 'qtiler',
            'source-layer': sourceLayer,
            minzoom: minZoom,
            maxzoom: maxZoom,
            paint: {
              'fill-color': effectiveColor,
              'fill-opacity': fillO,
              'fill-outline-color': effectiveColor
            }
          };
          if (filter) layer.filter = filter;
          layers.push(layer);
          return;
        }

        if (geometryHint === 'line') {
          const layer = {
            id: `${sourceLayer}-line-${idSuffix}`,
            type: 'line',
            source: 'qtiler',
            'source-layer': sourceLayer,
            minzoom: minZoom,
            maxzoom: maxZoom,
            paint: {
              'line-color': effectiveColor,
              'line-width': lineW
            }
          };
          if (filter) layer.filter = filter;
          layers.push(layer);
          return;
        }

        if (geometryHint === 'point') {
          const layer = {
            id: `${sourceLayer}-point-${idSuffix}`,
            type: 'circle',
            source: 'qtiler',
            'source-layer': sourceLayer,
            minzoom: minZoom,
            maxzoom: maxZoom,
            paint: {
              'circle-color': effectiveColor,
              'circle-radius': pointR,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 0.75
            }
          };
          if (filter) layer.filter = filter;
          layers.push(layer);
          return;
        }

        // No geometry hint — emit fill + line so both polygons and lines render.
        const fillLayer = {
          id: `${sourceLayer}-fallback-fill-${idSuffix}`,
          type: 'fill',
          source: 'qtiler',
          'source-layer': sourceLayer,
          minzoom: minZoom,
          maxzoom: maxZoom,
          paint: {
            'fill-color': effectiveColor,
            'fill-opacity': fillO,
            'fill-outline-color': effectiveColor
          }
        };
        if (filter) fillLayer.filter = filter;
        layers.push(fillLayer);

        const lineLayer = {
          id: `${sourceLayer}-fallback-line-${idSuffix}`,
          type: 'line',
          source: 'qtiler',
          'source-layer': sourceLayer,
          minzoom: minZoom,
          maxzoom: maxZoom,
          paint: {
            'line-color': effectiveColor,
            'line-width': lineW
          }
        };
        if (filter) lineLayer.filter = filter;
        layers.push(lineLayer);
      };

      if (rendererHint?.type === 'categorized' && asTrimmed(rendererHint.field)) {
        const field = asTrimmed(rendererHint.field);
        const items = Array.isArray(rendererHint.items) ? rendererHint.items : [];
        let idx = 0;
        for (const item of items) {
          const value = item?.value;
          if (value == null || value === '') continue;
          idx += 1;
          pushGeometryLayer({
            idSuffix: `cat-${idx}`,
            color: item?.color,
            lineWidthValue: item?.lineWidth,
            pointSizeValue: item?.pointSize,
            fillOpacityValue: item?.fillOpacity,
            filter: ['==', field, value]
          });
        }
        if (idx > 0) continue;
      }

      if (rendererHint?.type === 'graduated' && asTrimmed(rendererHint.field)) {
        const field = asTrimmed(rendererHint.field);
        const items = Array.isArray(rendererHint.items) ? rendererHint.items : [];
        let idx = 0;
        for (const item of items) {
          const lower = Number(item?.lower);
          const upper = Number(item?.upper);
          if (!Number.isFinite(lower) || !Number.isFinite(upper)) continue;
          idx += 1;
          pushGeometryLayer({
            idSuffix: `grad-${idx}`,
            color: item?.color,
            lineWidthValue: item?.lineWidth,
            pointSizeValue: item?.pointSize,
            fillOpacityValue: item?.fillOpacity,
            filter: ['all', ['>=', field, lower], ['<=', field, upper]]
          });
        }
        if (idx > 0) continue;
      }

      pushGeometryLayer({ idSuffix: 'default' });
    }

    return res.json({
      version: 8,
      name: `${projectId} style`,
      sources: {
        qtiler: {
          type: 'vector',
          tiles: [tilesUrl],
          minzoom: minZoom,
          maxzoom: maxZoom
        }
      },
      layers
    });
  };

  app.get(`/plugins/${pluginName}/style/:projectId.json`, serveStyle);
  app.get(`/plugins/${pluginName}/style/:projectId/:presetName.json`, serveStyle);

  app.get(`/plugins/${pluginName}/identify/:projectId`, async (req, res) => {
    const projectId = sanitizeProjectId(req.params?.projectId || '');
    if (!projectId) return res.status(400).json({ error: 'project_id_required' });

    {
      const allowed = await enforceProjectAccess({ req, res, security, projectId });
      if (!allowed) return;
    }

    const layerName = asTrimmed(req.query?.layer || '');
    const lon = Number(req.query?.lon);
    const lat = Number(req.query?.lat);
    const tolerance = Number(req.query?.tolerance || 3);
    const limit = Number(req.query?.limit || 10);

    if (!layerName) return res.status(400).json({ error: 'layer_required' });
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      return res.status(400).json({ error: 'lon_lat_required' });
    }

    const projectPath = resolveProjectPath(projectsDir, projectId);
    if (!projectPath) {
      return res.status(404).json({ error: 'project_not_found' });
    }

    try {
      const run = await spawnWithWrapper({
        scriptPath: pyIdentify,
        args: [
          projectPath,
          layerName,
          String(lon),
          String(lat),
          String(Number.isFinite(tolerance) ? tolerance : 3),
          String(Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 10)
        ],
        cwd: process.cwd()
      });
      const parsed = parseJsonOutput(run.stdout);
      if (run.code !== 0 || !parsed?.ok) {
        return res.status(400).json({
          error: parsed?.error || 'identify_failed',
          details: parsed?.details || String(run.stderr || '').trim() || 'identify_failed'
        });
      }
      return res.json(parsed);
    } catch (err) {
      return res.status(500).json({ error: 'identify_failed', details: String(err?.message || err || '') });
    }
  });

  app.get(`/plugins/${pluginName}/tiles/:projectId/:z/:x/:y.pbf`, async (req, res) => {
    const projectId = sanitizeProjectId(req.params?.projectId || '');
    if (!projectId) return res.status(400).send('project_id_required');

    {
      const allowed = await enforceProjectAccess({ req, res, security, projectId });
      if (!allowed) return;
    }

    const z = Number.parseInt(String(req.params?.z || ''), 10);
    const x = Number.parseInt(String(req.params?.x || ''), 10);
    const y = Number.parseInt(String(req.params?.y || ''), 10);
    if (![z, x, y].every((n) => Number.isFinite(n) && n >= 0)) {
      return res.status(400).send('invalid_tile_coordinates');
    }

    const snapshot = await tilesetStore.read();
    const items = snapshot && snapshot.items && typeof snapshot.items === 'object' ? snapshot.items : {};
    let tile = items[projectId];

    // Auto-create tileset entry and empty MBTiles if the project exists but hasn't been set up yet.
    // This allows on-demand generation for projects that were uploaded before VT was enabled.
    if (!tile || !tile.mbtilesPath || !fs.existsSync(tile.mbtilesPath)) {
      const projectPath = resolveProjectPath(projectsDir, projectId);
      if (!projectPath) {
        return res.status(404).send('tileset_not_found');
      }
      try {
        const outputDir = path.join(cacheRoot, projectId);
        const outputFile = path.join(outputDir, 'tiles.mbtiles');
        await ensureDir(outputDir);
        if (!fs.existsSync(outputFile)) {
          try {
            initMbtilesNative(outputFile);
          } catch {
            return res.status(404).send('tileset_not_found');
          }
          if (!fs.existsSync(outputFile)) {
            return res.status(404).send('tileset_not_found');
          }
        }
        // Register in tilesets.json
        await tilesetStore.update((draft) => {
          const allItems = draft && draft.items && typeof draft.items === 'object' ? { ...draft.items } : {};
          if (!allItems[projectId]) {
            allItems[projectId] = {
              projectId,
              mbtilesPath: outputFile,
              minZoom: 0,
              maxZoom: 14,
              selectedLayerIds: [],
              vectorLayerCount: null,
              selectedLayerCount: null,
              layerStyles: [],
              sourceLayerMeta: [],
              sourceLayers: [],
              bounds: null,
              updatedAt: new Date().toISOString(),
              autoBootstrapped: true
            };
          }
          return { ...draft, items: allItems };
        });
        tile = { projectId, mbtilesPath: outputFile, minZoom: 0, maxZoom: 14 };
      } catch (autoErr) {
        return res.status(404).send('tileset_not_found');
      }
    }

    try {
      // Always close stale handle first so we read the latest data after any merge
      const poolEntry = _dbPool.get(tile.mbtilesPath);
      if (poolEntry && (Date.now() - poolEntry.lastUsed > 2000)) {
        closeDbHandle(tile.mbtilesPath);
      }
      const tileData = readTileNative(tile.mbtilesPath, z, x, y);
      if (!tileData) {
        // Tile not found in MBTiles — queue an on-demand job to generate it.
        // If this tile was covered by a recently completed on-demand job and still doesn't exist,
        // there's no data here — return 404 immediately to avoid regeneration loops.
        if (wasRecentlyGenerated(projectId, z, x, y)) {
          // The zoom was recently generated — tiles should be in the MBTiles now.
          // Close any stale DB handle and re-read before giving up.
          closeDbHandle(tile.mbtilesPath);
          let retryData = null;
          try { retryData = readTileNative(tile.mbtilesPath, z, x, y); } catch {}
          if (retryData && retryData.length > 0) {
            res.setHeader('Content-Type', 'application/vnd.mapbox-vector-tile');
            if (retryData.length > 2 && retryData[0] === 0x1f && retryData[1] === 0x8b) {
              res.setHeader('Content-Encoding', 'gzip');
            }
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).send(retryData);
          }
          res.setHeader('Cache-Control', 'no-store');
          return res.status(404).send('tile_not_found');
        }
        // Reuse an existing pending/running job for the same project+zoom
        let job = findPendingOndemandTile(projectId, z, x, y);
        if (!job) {
          try {
            job = enqueueJob({ projectId, minZoom: z, maxZoom: z, selectedLayerIds: [], ondemand: true, priority: true, ondemandTile: { z, x, y } });
          } catch (e) {
            return res.status(404).send('tile_not_found');
          }
        }

        // By default, wait for the on-demand job to complete then serve the tile.
        // This enables transparent on-demand generation for all clients (QGIS, OL, Mapbox GL, etc.)
        // Pass ?nowait=1 to get 202 immediately (for dashboard AJAX that wants the job status).
        const noWait = String(req.query?.nowait || '') === '1';
        if (noWait) {
          return res.status(202).json({ status: 'queued', job: serializeJob(job) });
        }

        const ua = String(req.get('user-agent') || '').toLowerCase();
        const isQgisClient = ua.includes('qgis');
        const waitDefault = isQgisClient ? ONDEMAND_QGIS_WAIT_SECONDS : ONDEMAND_WAIT_SECONDS;
        const waitParam = Number(req.query?.wait);
        const waitSec = Number.isFinite(waitParam)
          ? Math.min(Math.max(waitParam, 0), 120)
          : waitDefault;

        // For browser-based viewers (OL, Mapbox GL): if the job is still queued, return
        // 404 immediately so the client triggers a retry. QGIS clients should wait
        // because QGIS may not retry 404 tiles automatically.
        if (job.status === 'queued' && !isQgisClient) {
          res.setHeader('Retry-After', '3');
          res.setHeader('Cache-Control', 'no-store');
          return res.status(404).send('tile_generating');
        }

        // Track this HTTP connection as an active waiter for the on-demand job.
        // If all waiters disconnect (viewer/QGIS closed), cancel the job + kill Python.
        addOndemandWaiter(job.id);
        let clientDisconnected = false;
        const onClose = () => { clientDisconnected = true; };
        req.on('close', onClose);

        const deadline = Date.now() + waitSec * 1000;
        const POLL_MS = 400;
        while (Date.now() < deadline) {
          if (job.status === 'completed' || job.status === 'error' || job.status === 'cancelled') break;
          if (clientDisconnected) break;
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
        req.removeListener('close', onClose);

        // If client disconnected, check if any other clients are still waiting
        if (clientDisconnected) {
          const remaining = removeOndemandWaiter(job.id);
          if (remaining === 0 && job.ondemand) {
            cancelOndemandJob(job);
          }
          return; // response already closed
        }
        removeOndemandWaiter(job.id);
        if (job.status === 'completed') {
          // Re-read the tile now that generation + merge is done.
          // Retry a few times in case the file lock hasn't been released yet (Windows).
          closeDbHandle(tile.mbtilesPath);
          let freshTile = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              freshTile = readTileNative(tile.mbtilesPath, z, x, y);
              if (freshTile) break;
            } catch {
              if (attempt < 2) await new Promise((r) => setTimeout(r, 80));
            }
          }
          if (freshTile && freshTile.length > 0) {
            res.setHeader('Content-Type', 'application/vnd.mapbox-vector-tile');
            if (freshTile.length > 2 && freshTile[0] === 0x1f && freshTile[1] === 0x8b) {
              res.setHeader('Content-Encoding', 'gzip');
            }
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).send(freshTile);
          }
        }
        // Job didn't complete in time — return 404 quickly so clients can retry without long request timeouts.
        res.setHeader('Retry-After', '2');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(404).send('tile_not_found');
      }
      res.setHeader('Content-Type', 'application/vnd.mapbox-vector-tile');
      if (tileData.length > 2 && tileData[0] === 0x1f && tileData[1] === 0x8b) {
        res.setHeader('Content-Encoding', 'gzip');
      }
      res.setHeader('Cache-Control', 'public, max-age=30');
      return res.status(200).send(tileData);
    } catch {
      return res.status(500).send('tile_read_failed');
    }
  });

  // Cleanup all pooled DB handles on plugin dispose / process exit
  const cleanupDbPool = () => {
    for (const [, entry] of _dbPool) {
      try { entry.db.close(); } catch {}
    }
    _dbPool.clear();
  };
  process.on('exit', cleanupDbPool);

  // Cancel all pending/running jobs and kill child processes
  const cancelAllJobs = () => {
    // Drain the queue
    while (queuedJobIds.length) {
      const jobId = queuedJobIds.shift();
      const job = findJob(jobId);
      if (job && job.status === 'queued') {
        job.status = 'cancelled';
        job.endedAt = new Date().toISOString();
        job.error = 'server_shutdown';
      }
    }
    // Kill all running child processes
    for (const [jobId, proc] of runningJobProcs) {
      killProcessTree(proc);
      const job = findJob(jobId);
      if (job && job.status === 'running') {
        job.cancelRequested = true;
      }
    }
  };

  // Periodic cleanup of orphaned temp MBTiles files (leftover from killed processes)
  const TEMP_CLEANUP_INTERVAL = 60 * 1000; // every 60 seconds
  const tempCleanupTimer = setInterval(() => {
    try {
      const dirs = fs.readdirSync(cacheRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const dir of dirs) {
        const dirPath = path.join(cacheRoot, dir.name);
        const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.tmp.mbtiles'));
        for (const file of files) {
          // Extract job id from filename: tiles.<jobId>.tmp.mbtiles
          const match = file.match(/^tiles\.(.+)\.tmp\.mbtiles$/);
          if (!match) continue;
          const jobId = match[1];
          const job = findJob(jobId);
          // Delete if no matching job, or job is finished (completed/error/cancelled)
          if (!job || job.status === 'completed' || job.status === 'error' || job.status === 'cancelled') {
            try { fs.unlinkSync(path.join(dirPath, file)); } catch (e) {}
          }
        }
      }
    } catch (e) {}
  }, TEMP_CLEANUP_INTERVAL);
  // Ensure timer doesn't keep the process alive
  if (tempCleanupTimer && tempCleanupTimer.unref) tempCleanupTimer.unref();

  return {
    dispose: async () => {
      clearInterval(tempCleanupTimer);
      cancelAllJobs();
      cleanupDbPool();
      process.removeListener('exit', cleanupDbPool);
    }
  };
};
