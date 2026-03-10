import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import crypto from 'crypto';

const asTrimmed = (value, fallback = '') => {
  if (value == null) return fallback;
  return String(value).trim();
};

const sanitizeProjectId = (value) => asTrimmed(value).replace(/[^a-zA-Z0-9._-]/g, '');
const runtimeTokenSecret = crypto.randomBytes(32).toString('hex');
const getTokenSecret = () => asTrimmed(
  process.env.VECTOR_TILES_TOKEN_SECRET
  || process.env.QTILER_TOKEN_SECRET
  || process.env.SESSION_SECRET
  || process.env.JWT_SECRET
  || runtimeTokenSecret
);
const base64UrlEncode = (value) => Buffer.from(String(value), 'utf8').toString('base64url');
const base64UrlDecode = (value) => Buffer.from(String(value), 'base64url').toString('utf8');
const signTokenPayload = (payload) => {
  const secret = getTokenSecret();
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
};
const createProjectToken = ({ projectId, expiresAt = null }) => {
  const payloadJson = JSON.stringify({ projectId, expiresAt });
  const payloadPart = base64UrlEncode(payloadJson);
  const sigPart = signTokenPayload(payloadPart);
  return `${payloadPart}.${sigPart}`;
};
const verifyProjectToken = ({ token, projectId }) => {
  const raw = asTrimmed(token);
  if (!raw || raw.indexOf('.') < 0) return false;
  const [payloadPart, sigPart] = raw.split('.');
  if (!payloadPart || !sigPart) return false;
  const expected = signTokenPayload(payloadPart);
  const sigBuf = Buffer.from(sigPart, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  try {
    const payload = JSON.parse(base64UrlDecode(payloadPart));
    if (!payload || payload.projectId !== projectId) return false;
    if (payload.expiresAt) {
      const expiresMs = Date.parse(String(payload.expiresAt));
      if (Number.isFinite(expiresMs) && Date.now() > expiresMs) return false;
    }
    return true;
  } catch {
    return false;
  }
};

const isProduction = () => String(process.env.NODE_ENV || '').toLowerCase() === 'production';

const sendSafeJsonError = (res, status, errorCode, details = '') => {
  const payload = { error: errorCode };
  if (!isProduction()) {
    const text = String(details || '').trim();
    if (text) payload.details = text;
  }
  return res.status(status).json(payload);
};

const createRateLimiter = ({ windowMs = 60_000, max = 60 } = {}) => {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const ip = String(req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown');
    const userId = String(req.user?.id || 'anon');
    const key = `${userId}:${ip}`;

    const prev = hits.get(key);
    if (!prev || now - prev.start >= windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }

    prev.count += 1;
    if (prev.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - prev.start)) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: 'rate_limited' });
    }

    return next();
  };
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

const isAdmin = (req, security) => {
  const authEnabled = typeof security?.isEnabled === 'function' ? security.isEnabled() : false;
  if (authEnabled) {
    return !!req.user && req.user.role === 'admin';
  }
  // Keep backward-compatible behavior when auth plugin is disabled.
  return !req.user || req.user.role === 'admin';
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

const killProcessTree = async (proc) => {
  const pid = Number(proc?.pid);
  if (!Number.isFinite(pid) || pid <= 0) return false;

  // On Windows the wrapper runs under cmd.exe; kill the full tree so Python/QGIS child processes stop too.
  if (process.platform === 'win32') {
    try {
      await new Promise((resolve) => {
        const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
        killer.on('error', () => resolve());
        killer.on('close', () => resolve());
      });
      return true;
    } catch {}
  }

  try {
    proc.kill('SIGTERM');
    return true;
  } catch {}
  return false;
};

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
  const pluginName = 'VectorTiles';
  const projectsDir = path.join(process.cwd(), 'qgisprojects');
  const cacheRoot = path.join(process.cwd(), 'cache', 'vector-tiles');
  const pyGenerate = path.join(baseDir, 'python', 'generate_vector_tiles.py');
  const pyListLayers = path.join(baseDir, 'python', 'list_project_layers.py');
  const pyReadTile = path.join(baseDir, 'python', 'read_mbtiles_tile.py');
  const pyReadMetadata = path.join(baseDir, 'python', 'read_mbtiles_metadata.py');
  const pyIdentify = path.join(baseDir, 'python', 'identify_vector_feature.py');
  const clientDir = path.join(baseDir, 'client');
  const sensitiveApiLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });

  const tilesetStore = registerStore('tilesets.json', { items: {} });
  const jobs = [];
  const MAX_JOB_HISTORY = 120;
  const queuedJobIds = [];
  let queueBusy = false;
  let runningJobProc = null;
  let runningJobId = null;

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
    cancelRequested: job.cancelRequested === true,
    output: job.output || null,
    tileset: job.tileset || null
  });

  const trimJobs = () => {
    if (jobs.length <= MAX_JOB_HISTORY) return;
    jobs.splice(0, jobs.length - MAX_JOB_HISTORY);
  };

  const findJob = (jobId) => jobs.find((job) => job && job.id === jobId) || null;

  const hasPendingForProject = (projectId) => {
    if (!projectId) return false;
    return jobs.some((job) => job.projectId === projectId && (job.status === 'queued' || job.status === 'running'));
  };

  const executeGenerate = async ({ projectId, minZoom, maxZoom, selectedLayerIds = [] }) => {
    const projectPath = resolveProjectPath(projectsDir, projectId);
    if (!projectPath) {
      throw new Error('project_not_found');
    }
    const outputDir = path.join(cacheRoot, projectId);
    const outputFile = path.join(outputDir, 'tiles.mbtiles');
    await ensureDir(outputDir);

    const run = await spawnWithWrapper({
      scriptPath: pyGenerate,
      args: [projectPath, outputFile, String(minZoom), String(maxZoom), JSON.stringify(selectedLayerIds)],
      cwd: process.cwd(),
      onSpawn: (proc) => {
        runningJobProc = proc;
      }
    });
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
      items[projectId] = metadata;
      return { ...draft, items };
    });

    return { metadata, parsed };
  };

  const processQueue = async () => {
    if (queueBusy) return;
    queueBusy = true;
    try {
      while (queuedJobIds.length) {
        const jobId = queuedJobIds.shift();
        const job = findJob(jobId);
        if (!job || job.status !== 'queued') continue;

        job.status = 'running';
        job.startedAt = new Date().toISOString();
        job.error = null;
        job.output = null;
        runningJobId = job.id;
        runningJobProc = null;

        try {
          const result = await executeGenerate({
            projectId: job.projectId,
            minZoom: job.minZoom,
            maxZoom: job.maxZoom,
            selectedLayerIds: Array.isArray(job.selectedLayerIds) ? job.selectedLayerIds : []
          });
          if (job.cancelRequested) {
            job.status = 'cancelled';
            job.error = 'job_cancelled';
          } else {
            job.status = 'completed';
          }
          job.endedAt = new Date().toISOString();
          job.tileset = result.metadata;
          job.output = result.parsed || null;
        } catch (err) {
          job.status = job.cancelRequested ? 'cancelled' : 'error';
          job.endedAt = new Date().toISOString();
          job.error = job.cancelRequested
            ? 'job_cancelled'
            : String(err?.message || err || 'vector_tile_generation_failed');
        } finally {
          runningJobId = null;
          runningJobProc = null;
        }
      }
    } finally {
      queueBusy = false;
      trimJobs();
    }
  };

  const enqueueJob = ({ projectId, minZoom, maxZoom, selectedLayerIds = [], retryOf = null }) => {
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
      tileset: null
    };
    jobs.push(job);
    queuedJobIds.push(job.id);
    trimJobs();
    setImmediate(() => {
      processQueue().catch(() => {});
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
      const run = await spawnWithWrapper({
        scriptPath: pyReadMetadata,
        args: [mbtilesPath],
        cwd: process.cwd()
      });
      const parsed = parseJsonOutput(run.stdout);
      if (run.code !== 0 || !parsed?.ok) return [];
      return Array.isArray(parsed.vectorLayers) ? parsed.vectorLayers : [];
    } catch {
      return [];
    }
  };

  const buildStyleLinks = ({ base, projectId, token = '', sourceLayers = [] }) => {
    const layers = Array.isArray(sourceLayers) ? sourceLayers.map((x) => asTrimmed(x)).filter(Boolean) : [];
    if (!layers.length) return { combined: null, perLayer: [] };

    const combinedLabel = layers.map((name) => layerSlug(name) || 'layer').join('_');
    const combinedBase = `${base}/plugins/${pluginName}/style/${encodeURIComponent(projectId)}/${encodeURIComponent(combinedLabel)}.json`;
    const combinedUrl = withToken(`${combinedBase}?layers=${encodeURIComponent(layers.join(','))}`, token);

    const perLayer = layers.map((name) => {
      const slug = layerSlug(name) || 'layer';
      const styleBase = `${base}/plugins/${pluginName}/style/${encodeURIComponent(projectId)}/${encodeURIComponent(slug)}.json`;
      return {
        name,
        label: slug,
        url: withToken(`${styleBase}?layers=${encodeURIComponent(name)}`, token)
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

  const requestToken = (req) => asTrimmed(
    req.query?.token
    || req.headers?.['x-qtiler-token']
    || String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '')
  );

  const hasTokenAccess = (req, projectId) => {
    const token = requestToken(req);
    if (!token) return false;
    return verifyProjectToken({ token, projectId });
  };

  const withToken = (url, token) => {
    const tk = asTrimmed(token);
    if (!tk) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}token=${encodeURIComponent(tk)}`;
  };

  app.use(`/plugins/${pluginName}/client`, express.static(clientDir, { index: false }));

  app.get(`/plugins/${pluginName}/admin`, (req, res) => {
    if (!isAdmin(req, security)) {
      return res.status(403).json({ error: 'admin_required' });
    }
    res.sendFile(path.join(clientDir, 'admin.html'));
  });

  app.get(`/plugins/${pluginName}/api/projects`, async (req, res) => {
    if (!isAdmin(req, security)) {
      return res.status(403).json({ error: 'admin_required' });
    }
    const projects = listQgisProjects(projectsDir).map((p) => ({ id: p.id, name: p.name }));
    return res.json({ projects });
  });

  app.get(`/plugins/${pluginName}/api/projects/:projectId/layers`, async (req, res) => {
    if (!isAdmin(req, security)) {
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
        return sendSafeJsonError(
          res,
          500,
          parsed?.error || 'layer_list_failed',
          parsed?.details || String(run.stderr || '').trim() || 'layer_list_failed'
        );
      }
      return res.json({
        projectId,
        layers: Array.isArray(parsed.layers) ? parsed.layers : []
      });
    } catch (err) {
      return sendSafeJsonError(res, 500, 'layer_list_failed', String(err?.message || err || ''));
    }
  });

  app.get(`/plugins/${pluginName}/api/tilesets`, async (req, res) => {
    if (!isAdmin(req, security)) {
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
      return { ...item, sourceLayers, styleLinks };
    }));
    return res.json({ tilesets: list });
  });

  app.post(`/plugins/${pluginName}/api/access-token`, sensitiveApiLimiter, async (req, res) => {
    if (!isAdmin(req, security)) {
      return res.status(403).json({ error: 'admin_required' });
    }

    const projectId = sanitizeProjectId(req.body?.projectId || '');
    const expiresHoursRaw = Number(req.body?.expiresHours);
    const expiresHours = Number.isFinite(expiresHoursRaw) ? Math.max(1, Math.min(24 * 365, Math.floor(expiresHoursRaw))) : 24;

    if (!projectId) {
      return res.status(400).json({ error: 'project_id_required' });
    }
    const projectPath = resolveProjectPath(projectsDir, projectId);
    if (!projectPath) {
      return res.status(404).json({ error: 'project_not_found' });
    }

    const expiresAt = new Date(Date.now() + expiresHours * 3600 * 1000).toISOString();
    const token = createProjectToken({ projectId, expiresAt });
    const base = `${req.protocol}://${req.get('host')}`;
    const tileUrl = withToken(`${base}/plugins/${pluginName}/tiles/${encodeURIComponent(projectId)}/{z}/{x}/{y}.pbf`, token);
    const tilejsonUrl = withToken(`${base}/plugins/${pluginName}/tilejson/${encodeURIComponent(projectId)}.json`, token);
    const styleUrl = withToken(`${base}/plugins/${pluginName}/style/${encodeURIComponent(projectId)}.json`, token);
    const snapshot = await tilesetStore.read();
    const items = snapshot && snapshot.items && typeof snapshot.items === 'object' ? snapshot.items : {};
    const tile = items[projectId] || null;
    const sourceLayers = Array.isArray(tile?.sourceLayers) && tile.sourceLayers.length
      ? tile.sourceLayers
      : (await loadMbtilesVectorLayers(tile?.mbtilesPath)).map((row) => asTrimmed(row?.id || '')).filter(Boolean);
    const styleLinks = buildStyleLinks({ base, projectId, token, sourceLayers });

    return res.json({
      projectId,
      token,
      expiresAt,
      tileUrl,
      tilejsonUrl,
      styleUrl,
      styleLinks
    });
  });

  app.post(`/plugins/${pluginName}/api/generate`, sensitiveApiLimiter, async (req, res) => {
    if (!isAdmin(req, security)) {
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
      return res.status(409).json({ error: 'job_already_running_for_project' });
    }

    const projectPath = resolveProjectPath(projectsDir, projectId);
    if (!projectPath) {
      return res.status(404).json({ error: 'project_not_found' });
    }

    const snapshot = await tilesetStore.read();
    const items = snapshot && snapshot.items && typeof snapshot.items === 'object' ? snapshot.items : {};
    const existing = items[projectId];
    if (!overwrite && existing?.mbtilesPath && fs.existsSync(existing.mbtilesPath)) {
      return res.status(409).json({ error: 'tileset_exists' });
    }

    const job = enqueueJob({ projectId, minZoom, maxZoom, selectedLayerIds });
    return res.status(202).json({ status: 'queued', job: serializeJob(job) });
  });

  app.get(`/plugins/${pluginName}/api/jobs`, sensitiveApiLimiter, async (req, res) => {
    if (!isAdmin(req, security)) {
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

  app.get(`/plugins/${pluginName}/api/jobs/:jobId`, sensitiveApiLimiter, async (req, res) => {
    if (!isAdmin(req, security)) {
      return res.status(403).json({ error: 'admin_required' });
    }
    const jobId = asTrimmed(req.params?.jobId || '');
    if (!jobId) return res.status(400).json({ error: 'job_id_required' });
    const job = findJob(jobId);
    if (!job) return res.status(404).json({ error: 'job_not_found' });
    return res.json({ job: serializeJob(job) });
  });

  app.post(`/plugins/${pluginName}/api/jobs/:jobId/retry`, sensitiveApiLimiter, async (req, res) => {
    if (!isAdmin(req, security)) {
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

  app.post(`/plugins/${pluginName}/api/jobs/:jobId/cancel`, sensitiveApiLimiter, async (req, res) => {
    if (!isAdmin(req, security)) {
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

    if (job.status === 'running' && runningJobId === job.id && runningJobProc) {
      await killProcessTree(runningJobProc);
      setTimeout(() => {
        try {
          if (runningJobProc && !runningJobProc.killed) {
            if (process.platform === 'win32') {
              spawn('taskkill', ['/PID', String(runningJobProc.pid), '/T', '/F'], { stdio: 'ignore' });
            } else {
              runningJobProc.kill('SIGKILL');
            }
          }
        } catch {}
      }, 2000);
    }

    return res.json({ status: 'cancelling', job: serializeJob(job) });
  });

  app.post(`/plugins/${pluginName}/api/jobs/:jobId/prioritize`, sensitiveApiLimiter, async (req, res) => {
    if (!isAdmin(req, security)) {
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

  app.post(`/plugins/${pluginName}/api/jobs/prioritize-project/:projectId`, sensitiveApiLimiter, async (req, res) => {
    if (!isAdmin(req, security)) {
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

  app.delete(`/plugins/${pluginName}/api/tilesets/:projectId`, sensitiveApiLimiter, async (req, res) => {
    if (!isAdmin(req, security)) {
      return res.status(403).json({ error: 'admin_required' });
    }
    const projectId = sanitizeProjectId(req.params?.projectId || '');
    if (!projectId) {
      return res.status(400).json({ error: 'project_id_required' });
    }

    const projectCacheDir = path.join(cacheRoot, projectId);
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

    const token = requestToken(req);
    if (!hasTokenAccess(req, projectId)) {
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
    const urlRaw = `${base}/plugins/${pluginName}/tiles/${encodeURIComponent(projectId)}/{z}/{x}/{y}.pbf`;
    const url = withToken(urlRaw, token);
    const styleRaw = `${base}/plugins/${pluginName}/style/${encodeURIComponent(projectId)}.json`;
    const style = withToken(styleRaw, token);
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
      minzoom: Number.isFinite(Number(tile.minZoom)) ? Number(tile.minZoom) : 0,
      maxzoom: Number.isFinite(Number(tile.maxZoom)) ? Number(tile.maxZoom) : 14,
      bounds: Array.isArray(tile.bounds) ? tile.bounds : undefined,
      tiles: [url],
      style,
      vector_layers: vectorLayers.length ? vectorLayers : undefined
    });
  });

  const serveStyle = async (req, res) => {
    const projectId = sanitizeProjectId(req.params?.projectId || '');
    if (!projectId) return res.status(400).json({ error: 'project_id_required' });

    const token = requestToken(req);
    if (!hasTokenAccess(req, projectId)) {
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
    const tilesUrlRaw = `${base}/plugins/${pluginName}/tiles/${encodeURIComponent(projectId)}/{z}/{x}/{y}.pbf`;
    const tilesUrl = withToken(tilesUrlRaw, token);
    const minZoom = Number.isFinite(Number(tile.minZoom)) ? Number(tile.minZoom) : 0;
    const maxZoom = Number.isFinite(Number(tile.maxZoom)) ? Number(tile.maxZoom) : 14;

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

        const layer = {
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
        if (filter) layer.filter = filter;
        layers.push(layer);
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

    const token = requestToken(req);
    if (!hasTokenAccess(req, projectId)) {
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
        return sendSafeJsonError(
          res,
          400,
          parsed?.error || 'identify_failed',
          parsed?.details || String(run.stderr || '').trim() || 'identify_failed'
        );
      }
      return res.json(parsed);
    } catch (err) {
      return sendSafeJsonError(res, 500, 'identify_failed', String(err?.message || err || ''));
    }
  });

  app.get(`/plugins/${pluginName}/tiles/:projectId/:z/:x/:y.pbf`, async (req, res) => {
    const projectId = sanitizeProjectId(req.params?.projectId || '');
    if (!projectId) return res.status(400).send('project_id_required');

    if (!hasTokenAccess(req, projectId)) {
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
    const tile = items[projectId];
    if (!tile || !tile.mbtilesPath || !fs.existsSync(tile.mbtilesPath)) {
      return res.status(404).send('tileset_not_found');
    }

    try {
      const run = await spawnWithWrapper({
        scriptPath: pyReadTile,
        args: [tile.mbtilesPath, String(z), String(x), String(y)],
        cwd: process.cwd()
      });
      if (run.code !== 0) {
        return res.status(404).send('tile_not_found');
      }
      res.setHeader('Content-Type', 'application/vnd.mapbox-vector-tile');
      if (run.stdout && run.stdout.length > 2 && run.stdout[0] === 0x1f && run.stdout[1] === 0x8b) {
        res.setHeader('Content-Encoding', 'gzip');
      }
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send(run.stdout);
    } catch {
      return res.status(500).send('tile_read_failed');
    }
  });

  return {
    dispose: async () => {}
  };
};
