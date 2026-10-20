/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

import fs from "fs";
import os from "os";
import path from "path";
import yauzl from "yauzl";
import AdmZip from "adm-zip";
import archiver from "archiver";
import { pipeline } from "stream/promises";
import { spawn, spawnSync } from "child_process";
import { aggregateProjectDiagnosticsSnapshots, getProjectDiagnosticsSnapshot, readProjectProcessSnapshots, readRecentProjectDiagnostics, recordProjectDiagnostic } from '../lib/projectDiagnostics.js';

const redactSecrets = (value) => {
  const input = value == null ? "" : String(value);
  if (!input) return "";
  let out = input;
  // Common key-value patterns
  out = out.replace(/(\b(password|passwd|pwd)\s*[=:]\s*)([^\s&;\r\n]+)/gi, "$1***");
  out = out.replace(/(\b(api[_-]?key|token|access[_-]?token)\s*[=:]\s*)([^\s&;\r\n]+)/gi, "$1***");
  // Quoted patterns (password '...')
  out = out.replace(/(\b(password|passwd|pwd)\b[^'\"]*['\"])([^'\"]+)(['\"])/gi, "$1***$4");
  // URL basic-auth: scheme://user:pass@
  out = out.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^:\s\/]+:)([^@\s\/]+)(@)/gi, "$1***$3");
  return out;
};

const stripProjectPathsAndSecrets = (payload) => {
  if (!payload || typeof payload !== 'object') return payload;
  let clone;
  try {
    clone = JSON.parse(JSON.stringify(payload));
  } catch {
    clone = { ...payload };
  }
  try {
    if (clone.project && typeof clone.project === 'object') {
      delete clone.project.path;
    }
  } catch {}
  return clone;
};

export const registerProjectRoutes = ({
  app,
  crypto,
  security,
  requireAdmin,
  ensureProjectAccess,
  sanitizeProjectId,
  resolveProjectAccessEntry,
  readProjectAccessSnapshot,
  deriveProjectAccess,
  isProjectPublic,
  buildProjectDescriptor,
  listProjects,
  findProjectById,
  projectsDir,
  projectUpload,
  allowedProjectExtensions,
  bootstrapProjectCacheIndex,
  runningJobs,
  activeKeys,
  cancelProjectTimer,
  projectConfigCache,
  projectLogLastMessage,
  projectBatchCleanupTimers,
  projectBatchRuns,
  removeProjectAccessEntry,
  purgeProjectFromAuthUsers,
  removeProjectLogs,
  cacheDir,
  tileGridDir,
  invalidateTileGridCaches,
  pythonDir,
  pythonExe,
  runPythonViaOSGeo4W,
  extractJsonLike,
  readProjectConfig,
  buildProjectConfigPatch,
  ensureServerProj4Def,
  updateProjectConfig,
  getProjectConfigPath,
  deleteLayerCacheInternal,
  updateProjectBatchRun,
  abortProjectBatchRunInternal,
  runRecacheForProject,
  tileRendererPool,
  logProjectEvent,
  buildPublicProjectsListing,
  resolvePublicProject,
  filterPublicProjectLayersForRequest = (_req, _projectId, layers) => layers
}) => {

  let activeProjectExtractions = 0;
  const adjustActiveProjectExtractions = (delta) => {
    activeProjectExtractions = Math.max(0, activeProjectExtractions + delta);
    app.locals.projectLayerExtractions = activeProjectExtractions;
  };
  app.locals.projectLayerExtractions = 0;

  const inspectAndExtractProjectZip = async (zipPath, destination) => {
    const maxEntriesRaw = Number.parseInt(process.env.ZIP_UPLOAD_MAX_ENTRIES || '20000', 10);
    const maxTotalRaw = Number.parseInt(process.env.ZIP_EXTRACT_MAX_BYTES || String(10 * 1024 * 1024 * 1024), 10);
    const maxEntryRaw = Number.parseInt(process.env.ZIP_EXTRACT_MAX_ENTRY_BYTES || String(10 * 1024 * 1024 * 1024), 10);
    const maxEntries = Number.isFinite(maxEntriesRaw) && maxEntriesRaw > 0 ? maxEntriesRaw : 20000;
    const maxTotalBytes = Number.isFinite(maxTotalRaw) && maxTotalRaw > 0 ? maxTotalRaw : 10 * 1024 * 1024 * 1024;
    const maxEntryBytes = Number.isFinite(maxEntryRaw) && maxEntryRaw > 0 ? maxEntryRaw : 10 * 1024 * 1024 * 1024;
    const zipfile = await new Promise((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true }, (error, archive) => {
        if (error) reject(error);
        else resolve(archive);
      });
    });

    return new Promise((resolve, reject) => {
      let entryCount = 0;
      let totalBytes = 0;
      let finished = false;
      const projectEntries = [];
      const fail = (error) => {
        if (finished) return;
        finished = true;
        try { zipfile.close(); } catch {}
        reject(error);
      };
      zipfile.on('error', fail);
      zipfile.on('entry', (entry) => {
        if (finished) return;
        const rawName = String(entry.fileName || '');
        const normalized = rawName.replace(/\\/g, '/').replace(/^\/+/, '');
        const safeName = path.posix.normalize(normalized);
        const isDirectory = normalized.endsWith('/');
        entryCount += 1;
        if (entryCount > maxEntries) return fail(Object.assign(new Error('zip_too_many_entries'), { code: 'ZIP_TOO_MANY_ENTRIES', entryCount, maxEntries }));
        if (!normalized || path.posix.isAbsolute(safeName) || /^[A-Za-z]:/.test(safeName) || safeName === '..' || safeName.startsWith('../') || safeName.includes('/../')) {
          return fail(Object.assign(new Error('zip_unsafe_entry_path'), { code: 'ZIP_UNSAFE_ENTRY_PATH', entry: rawName }));
        }
        const size = Number(entry.uncompressedSize);
        const uncompressedSize = Number.isFinite(size) && size >= 0 ? size : 0;
        if (!isDirectory) {
          if (uncompressedSize > maxEntryBytes) return fail(Object.assign(new Error('zip_entry_too_large'), { code: 'ZIP_ENTRY_TOO_LARGE', entry: safeName, maxEntryBytes }));
          totalBytes += uncompressedSize;
          if (totalBytes > maxTotalBytes) return fail(Object.assign(new Error('zip_extract_too_large'), { code: 'ZIP_EXTRACT_TOO_LARGE', maxExtractBytes: maxTotalBytes }));
          if (!safeName.startsWith('__MACOSX/') && /\.(qgs|qgz)$/i.test(safeName)) projectEntries.push(safeName);
        }
        if (safeName.startsWith('__MACOSX/')) {
          zipfile.readEntry();
          return;
        }
        const targetPath = path.resolve(destination, ...safeName.split('/').filter(Boolean));
        if (!isPathInside(targetPath, destination)) return fail(Object.assign(new Error('zip_unsafe_entry_path'), { code: 'ZIP_UNSAFE_ENTRY_PATH', entry: rawName }));
        if (isDirectory) {
          fs.promises.mkdir(targetPath, { recursive: true })
            .then(() => zipfile.readEntry())
            .catch(fail);
          return;
        }
        fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
          .then(() => zipfile.openReadStream(entry, (error, stream) => {
            if (error) return fail(error);
            pipeline(stream, fs.createWriteStream(targetPath))
              .then(() => zipfile.readEntry())
              .catch(fail);
          }))
          .catch(fail);
      });
      zipfile.on('end', () => {
        if (finished) return;
        finished = true;
        try { zipfile.close(); } catch {}
        resolve({ projectEntries, totalBytes, entryCount });
      });
      zipfile.readEntry();
    });
  };

  const runProjectLayerPreflight = async (file) => {
    const workspace = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qtiler-project-preflight-'));
    let retainWorkspace = false;
    let extractedDir = null;
    let projectRelativePath = null;
    let archiveInfo = null;
    try {
      const ext = path.extname(file.originalname || '').toLowerCase();
      let projectPath;
      if (ext === '.zip') {
        extractedDir = path.join(workspace, 'bundle');
        await fs.promises.mkdir(extractedDir, { recursive: true });
        archiveInfo = await inspectAndExtractProjectZip(file.path, extractedDir);
        if (archiveInfo.projectEntries.length === 0) {
          return { error: 'zip_missing_project', message: 'ZIP does not contain a QGIS project (.qgz or .qgs).' };
        }
        if (archiveInfo.projectEntries.length > 1) {
          return { error: 'zip_multiple_projects', message: 'ZIP must contain exactly one QGIS project (.qgz or .qgs).', projects: archiveInfo.projectEntries.slice(0, 20) };
        }
        projectRelativePath = archiveInfo.projectEntries[0];
        projectPath = path.resolve(extractedDir, ...projectRelativePath.split('/'));
        if (!isPathInside(projectPath, extractedDir)) return { error: 'zip_unsafe_entry_path', message: 'ZIP contains an unsafe project path.' };
      } else {
        const safeName = path.basename(String(file.originalname || `project${ext}`));
        projectPath = path.join(workspace, safeName);
        await fs.promises.copyFile(file.path, projectPath);
      }

      const script = path.join(pythonDir, 'extract_info.py');
      adjustActiveProjectExtractions(1);
      let payload;
      try {
        payload = await new Promise((resolve, reject) => {
        const child = runPythonViaOSGeo4W(script, ['--project', projectPath], { cwd: path.dirname(projectPath) });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timeout = setTimeout(() => {
          timedOut = true;
          try { child.kill(); } catch {}
        }, 120000);
        timeout.unref?.();
        child.stdout.on('data', (chunk) => {
          if (stdout.length < 32 * 1024 * 1024) stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
          if (stderr.length < 2 * 1024 * 1024) stderr += chunk.toString();
        });
        child.once('error', (error) => {
          clearTimeout(timeout);
          reject(Object.assign(new Error('project_extractor_spawn_failed'), { code: 'PROJECT_EXTRACTOR_SPAWN_FAILED', cause: error }));
        });
        child.once('close', (code) => {
          clearTimeout(timeout);
          if (timedOut) return reject(Object.assign(new Error('project_extractor_timeout'), { code: 'PROJECT_EXTRACTOR_TIMEOUT', stderr }));
          const candidate = extractJsonLike(stdout.trim() || stderr.trim());
          if (code !== 0 || !candidate) {
            return reject(Object.assign(new Error('project_extraction_failed'), { code: 'PROJECT_EXTRACTION_FAILED', exitCode: code, stderr }));
          }
          try { resolve(JSON.parse(candidate)); }
          catch (error) { reject(Object.assign(new Error('project_metadata_invalid'), { code: 'PROJECT_METADATA_INVALID', stderr, cause: error })); }
        });
        });
      } finally {
        adjustActiveProjectExtractions(-1);
      }
      const layers = Array.isArray(payload?.layers) ? payload.layers : [];
      const themes = Array.isArray(payload?.themes) ? payload.themes : [];
      if (layers.length === 0 && themes.length === 0) {
        return { error: 'project_has_no_layers', message: 'QGIS did not find any usable layers or map themes in this project.' };
      }
      const invalidLayerCount = layers.filter((layer) => layer?.valid === false).length;
      const invalidLayers = layers.filter((layer) => layer?.valid === false).map((layer) => ({
        name: String(layer?.name || layer?.id || 'Unknown layer').slice(0, 160),
        provider: String(layer?.provider || 'unknown').slice(0, 64)
      })).slice(0, 100);
      retainWorkspace = ext === '.zip';
      return {
        payload,
        workspace: retainWorkspace ? workspace : null,
        extractedDir,
        projectRelativePath,
        archiveInfo,
        summary: {
          projectName: String(payload?.project?.name || path.basename(projectPath)).slice(0, 160),
          crs: String(payload?.project?.crs || '').slice(0, 64),
          layerCount: layers.length,
          validLayerCount: layers.length - invalidLayerCount,
          invalidLayerCount,
          themeCount: themes.length,
          invalidLayers
        }
      };
    } finally {
      if (!retainWorkspace) {
        try { await fs.promises.rm(workspace, { recursive: true, force: true }); } catch {}
      }
    }
  };

  const cleanupProjectPreflight = async (preflight) => {
    if (!preflight?.workspace) return;
    try { await fs.promises.rm(preflight.workspace, { recursive: true, force: true }); } catch {}
    preflight.workspace = null;
  };

  app.get('/admin/project-diagnostics/stream', requireAdmin, (req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    let closed = false;
    let hasSentInitialEvents = false;
    let sendingSnapshot = false;
    const sentEventIds = new Set();
    const sendSnapshot = async () => {
      if (closed || res.writableEnded || sendingSnapshot) return;
      sendingSnapshot = true;
      try {
        const recentEvents = await readRecentProjectDiagnostics(200);
        const events = hasSentInitialEvents
          ? recentEvents.filter((event) => !sentEventIds.has(event.id))
          : recentEvents;
        recentEvents.forEach((event) => sentEventIds.add(event.id));
        while (sentEventIds.size > 400) sentEventIds.delete(sentEventIds.values().next().value);
        let processSnapshots = await readProjectProcessSnapshots();
        if (!processSnapshots.length) processSnapshots = [getProjectDiagnosticsSnapshot(tileRendererPool, activeProjectExtractions, cacheDir)];
        const snapshot = aggregateProjectDiagnosticsSnapshots(processSnapshots) || processSnapshots[0];
        res.write(`data: ${JSON.stringify({ events, snapshot, replaceEvents: !hasSentInitialEvents })}\n\n`);
        res.flush?.();
        hasSentInitialEvents = true;
      } catch (error) {
        recordProjectDiagnostic('error', 'diagnostics-stream', 'Could not build diagnostics snapshot', { message: error?.message || String(error) });
      } finally {
        sendingSnapshot = false;
      }
    };
    void sendSnapshot();
    const timer = setInterval(() => { void sendSnapshot(); }, 2000);
    timer.unref?.();
    res.on('close', () => {
      closed = true;
      clearInterval(timer);
    });
  });

  const parseBool = (value, fallback = false) => {
    if (value == null) return fallback;
    if (typeof value === 'boolean') return value;
    const raw = String(value).trim().toLowerCase();
    if (!raw) return fallback;
    if (['1', 'true', 'yes', 'on', 'si', 'sí'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
    return fallback;
  };

  const optimizationEnvPath = path.resolve(projectsDir, '..', '.env');
  const optimizationEnvKeys = ['WORKER_COUNT', 'PY_WORKER_POOL_SIZE', 'PY_WORKER_MAX_QUEUE', 'QTILER_MAX_CONCURRENT_TILE_JOBS'];
  const readOptimizationEnv = async () => {
    try { return await fs.promises.readFile(optimizationEnvPath, 'utf8'); }
    catch (error) { if (error?.code === 'ENOENT') return ''; throw error; }
  };
  const getOptimizationPlan = (rawEnv) => {
    const parsedEnv = Object.fromEntries(String(rawEnv || '').split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]));
    const cpuCores = Math.max(1, os.cpus().length);
    const memoryTotalBytes = os.totalmem();
    const memoryTotalGiB = memoryTotalBytes / (1024 ** 3);
    const memoryReserveGiB = Math.max(2, memoryTotalGiB * 0.25);
    const memoryWorkerCapacity = Math.max(1, Math.floor(Math.max(1, memoryTotalGiB - memoryReserveGiB) / 2));
    const qgisWorkerCapacity = Math.max(1, Math.min(cpuCores, memoryWorkerCapacity, 12));
    const specs = {
      low: { nodeMax: 1, qgisMax: 2, queueFactor: 3, tileJobsMax: 1 },
      medium: { nodeMax: 2, qgisMax: 4, queueFactor: 4, tileJobsMax: 2 },
      aggressive: { nodeMax: 4, qgisMax: 8, queueFactor: 5, tileJobsMax: 3 }
    };
    const profiles = Object.fromEntries(Object.entries(specs).map(([id, spec]) => {
      const totalTarget = Math.min(qgisWorkerCapacity, spec.qgisMax);
      const workerCount = Math.max(1, Math.min(spec.nodeMax, Math.floor(cpuCores / 4) || 1, totalTarget));
      const poolSize = Math.max(1, Math.min(4, Math.floor(totalTarget / workerCount), Math.floor(cpuCores / workerCount), Math.floor(memoryWorkerCapacity / workerCount)));
      const maxQueue = Math.max(poolSize * 2, Math.min(128, poolSize * spec.queueFactor));
      const tileJobs = Math.max(1, Math.min(spec.tileJobsMax, poolSize));
      return [id, {
        id,
        workerCount,
        poolSize,
        totalQgisWorkers: workerCount * poolSize,
        maxQueue,
        concurrentTileJobs: tileJobs,
        memoryBudgetPerQgisWorkerGiB: 2
      }];
    }));
    const currentWorkerCount = Number.parseInt(parsedEnv.WORKER_COUNT || '0', 10) || cpuCores;
    const currentPoolSize = Number.parseInt(parsedEnv.PY_WORKER_POOL_SIZE || '4', 10) || 4;
    const currentQueue = Number.parseInt(parsedEnv.PY_WORKER_MAX_QUEUE || '', 10) || currentPoolSize * 8;
    const currentTileJobs = Number.parseInt(parsedEnv.QTILER_MAX_CONCURRENT_TILE_JOBS || '2', 10) || 2;
    return {
      host: { cpuCores, memoryTotalBytes, memoryFreeBytes: os.freemem(), memoryReserveGiB, qgisWorkerCapacity },
      current: {
        workerCount: currentWorkerCount,
        poolSize: currentPoolSize,
        totalQgisWorkers: currentWorkerCount * currentPoolSize,
        maxQueue: currentQueue,
        concurrentTileJobs: currentTileJobs
      },
      profiles
    };
  };

  const updateOptimizationEnv = async (updates) => {
    const lockPath = `${optimizationEnvPath}.optimization.lock`;
    let lockHandle;
    try {
      lockHandle = await fs.promises.open(lockPath, 'wx');
    } catch (error) {
      if (error?.code === 'EEXIST') throw Object.assign(new Error('optimization_update_in_progress'), { code: 'OPTIMIZATION_UPDATE_IN_PROGRESS' });
      throw error;
    }
    try {
      const original = await fs.promises.readFile(optimizationEnvPath, 'utf8');
      const stat = await fs.promises.stat(optimizationEnvPath);
      const hasBom = original.startsWith('\uFEFF');
      const lineEnding = original.includes('\r\n') ? '\r\n' : '\n';
      const lines = (hasBom ? original.slice(1) : original).split(/\r?\n/);
      const updatedKeys = new Set();
      const updatedLines = lines.map((line) => {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
        const key = match?.[1];
        if (!key || !Object.prototype.hasOwnProperty.call(updates, key)) return line;
        updatedKeys.add(key);
        return `${key}=${updates[key]}`;
      });
      for (const key of Object.keys(updates)) {
        if (!updatedKeys.has(key)) updatedLines.push(`${key}=${updates[key]}`);
      }
      const nextContent = `${hasBom ? '\uFEFF' : ''}${updatedLines.join(lineEnding).replace(/[\r\n]*$/, '')}${lineEnding}`;
      const backupDir = path.resolve(projectsDir, '..', 'upgrade-backups');
      await fs.promises.mkdir(backupDir, { recursive: true });
      const backupPath = path.join(backupDir, `env-optimization-${Date.now()}-${process.pid}.bak`);
      await fs.promises.copyFile(optimizationEnvPath, backupPath, fs.constants.COPYFILE_EXCL);
      const tempPath = `${optimizationEnvPath}.optimization-${process.pid}.tmp`;
      const previousPath = `${optimizationEnvPath}.optimization-${process.pid}.previous`;
      await fs.promises.writeFile(tempPath, nextContent, { encoding: 'utf8', mode: stat.mode });
      try {
        await fs.promises.rename(optimizationEnvPath, previousPath);
        try {
          await fs.promises.rename(tempPath, optimizationEnvPath);
        } catch (error) {
          await fs.promises.rename(previousPath, optimizationEnvPath).catch(() => {});
          throw error;
        }
      } finally {
        await fs.promises.rm(previousPath, { force: true }).catch(() => {});
        await fs.promises.rm(tempPath, { force: true }).catch(() => {});
      }
      return { backupPath, nextContent };
    } finally {
      await lockHandle?.close().catch(() => {});
      await fs.promises.rm(lockPath, { force: true }).catch(() => {});
    }
  };

  app.get('/admin/optimization/profiles', requireAdmin, async (_req, res) => {
    try {
      const env = await readOptimizationEnv();
      return res.json(getOptimizationPlan(env));
    } catch (error) {
      recordProjectDiagnostic('error', 'optimization', 'Could not read optimization settings', { message: error?.message || String(error) });
      return res.status(500).json({ error: 'optimization_preview_failed' });
    }
  });

  app.post('/admin/optimization/apply', requireAdmin, async (req, res) => {
    const profileId = String(req.body?.profile || '').trim().toLowerCase();
    if (!['low', 'medium', 'aggressive'].includes(profileId)) return res.status(400).json({ error: 'invalid_optimization_profile' });
    try {
      const env = await readOptimizationEnv();
      if (!env) return res.status(409).json({ error: 'env_file_missing' });
      const plan = getOptimizationPlan(env).profiles[profileId];
      const updates = {
        WORKER_COUNT: plan.workerCount,
        PY_WORKER_POOL_SIZE: plan.poolSize,
        PY_WORKER_MAX_QUEUE: plan.maxQueue,
        QTILER_MAX_CONCURRENT_TILE_JOBS: plan.concurrentTileJobs
      };
      const changed = Object.entries(updates).filter(([key, value]) => {
        const current = env.match(new RegExp(`^\\s*${key}\\s*=\\s*([^\\r\\n]*)`, 'm'))?.[1]?.trim();
        return current !== String(value);
      }).map(([key, value]) => ({ key, value }));
      if (!changed.length) {
        return res.json({ ok: true, profile: profileId, settings: plan, changes: [], restartRequired: false });
      }
      const result = await updateOptimizationEnv(updates);
      recordProjectDiagnostic('warn', 'optimization', 'Concurrency profile saved to .env', {
        profile: profileId,
        changes: changed,
        restartRequired: changed.length > 0,
        backupName: path.basename(result.backupPath)
      });
      return res.json({ ok: true, profile: profileId, settings: plan, changes: changed, restartRequired: changed.length > 0 });
    } catch (error) {
      if (error?.code === 'OPTIMIZATION_UPDATE_IN_PROGRESS') return res.status(409).json({ error: error.code });
      recordProjectDiagnostic('error', 'optimization', 'Could not apply concurrency profile', { message: error?.message || String(error) });
      return res.status(500).json({ error: 'optimization_apply_failed' });
    }
  });

  app.post('/admin/optimization/restart-service', requireAdmin, (req, res) => {
    if (process.platform !== 'win32') return res.status(501).json({ error: 'windows_service_restart_unavailable' });
    const serviceScript = path.resolve(projectsDir, '..', 'tools', 'qtiler-service.ps1');
    if (!fs.existsSync(serviceScript)) return res.status(404).json({ error: 'service_script_missing' });
    const powershell = process.env.POWERSHELL_EXE || 'powershell.exe';
    const configuredServiceName = String(process.env.QTILER_SERVICE_NAME || 'QTiler').trim() || 'QTiler';
    const findService = spawnSync(powershell, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', serviceScript,
      '-Action', 'find', '-ServiceName', configuredServiceName
    ], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    const serviceName = String(findService.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
    if (findService.error || findService.status !== 0 || !serviceName) {
      return res.status(409).json({ error: 'service_not_found', message: 'No Qtiler Windows service was detected. Restart Qtiler manually.' });
    }

    const diagnostic = recordProjectDiagnostic('warn', 'optimization', 'Windows service restart requested by an administrator', { serviceName });
    res.status(202).json({ ok: true, status: 'restart_scheduled', serviceName, diagnosticId: diagnostic.id });
    const timer = setTimeout(() => {
      try {
        const child = spawn(powershell, [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', serviceScript,
          '-Action', 'restart', '-ServiceName', serviceName
        ], { cwd: path.resolve(projectsDir, '..'), detached: true, stdio: 'ignore', windowsHide: true });
        child.once('error', (error) => recordProjectDiagnostic('error', 'optimization', 'Could not start Windows service restart', { message: error?.message || String(error), serviceName }));
        child.unref();
      } catch (error) {
        recordProjectDiagnostic('error', 'optimization', 'Could not schedule Windows service restart', { message: error?.message || String(error), serviceName });
      }
    }, 1500);
    timer.unref?.();
  });

  const isPathInside = (candidatePath, basePath) => {
    const resolvedBase = path.resolve(basePath);
    const resolvedCandidate = path.resolve(candidatePath);
    const baseLower = resolvedBase.toLowerCase();
    const candidateLower = resolvedCandidate.toLowerCase();
    return candidateLower === baseLower || candidateLower.startsWith(baseLower + path.sep);
  };

  const resolveProjectBundleSource = (project) => {
    if (!project || !project.file) return null;
    const projectFilePath = path.resolve(project.file);
    const projectRoot = path.resolve(projectsDir);
    const preferredDir = path.resolve(path.join(projectsDir, String(project.id || "").trim()));
    const projectParentDir = path.dirname(projectFilePath);

    if (!isPathInside(projectFilePath, projectRoot)) {
      return null;
    }

    if (String(project.id || "").trim() && fs.existsSync(preferredDir) && fs.statSync(preferredDir).isDirectory()) {
      if (isPathInside(projectFilePath, preferredDir)) {
        return {
          kind: "directory",
          sourcePath: preferredDir,
          zipRoot: path.basename(preferredDir)
        };
      }
    }

    if (projectParentDir && isPathInside(projectParentDir, projectRoot) && projectParentDir.toLowerCase() !== projectRoot.toLowerCase()) {
      return {
        kind: "directory",
        sourcePath: projectParentDir,
        zipRoot: path.basename(projectParentDir)
      };
    }

    return {
      kind: "file",
      sourcePath: projectFilePath,
      zipRoot: null
    };
  };

  const detectRequestLanguage = (req) => {
    try {
      const q = req?.query?.lang;
      const fromQuery = Array.isArray(q) ? q[0] : q;
      const fromCookie = req?.cookies?.qtiler_lang || req?.cookies?.['qtiler.lang'];
      const fromHeader = req?.get?.('x-qtiler-lang') || req?.headers?.['accept-language'];
      const raw = String(fromQuery || fromCookie || fromHeader || 'en').toLowerCase();
      if (raw.startsWith('es')) return 'es';
      if (raw.startsWith('sv')) return 'sv';
      return 'en';
    } catch {
      return 'en';
    }
  };

  const conflictText = (lang, projectId) => {
    if (lang === 'es') {
      return {
        title: 'Proyecto ya existe',
        message: `Ya existe un proyecto con el id "${projectId}". ¿Deseas reemplazar el existente?`,
        hint: 'Puedes elegir mantener o eliminar la configuracion y la cache existentes.'
      };
    }
    if (lang === 'sv') {
      return {
        title: 'Projektet finns redan',
        message: `Ett projekt med id "${projectId}" finns redan. Vill du ersatta det befintliga?`,
        hint: 'Du kan valja att behalla eller radera befintlig konfiguration och cache.'
      };
    }
    return {
      title: 'Project already exists',
      message: `A project with id "${projectId}" already exists. Do you want to replace the existing one?`,
      hint: 'You can choose to keep or delete existing configuration and cache.'
    };
  };

  const removeExistingProjectStorage = async (proj) => {
    if (!proj || !proj.file) return;
    const projectsRootResolved = path.resolve(projectsDir).toLowerCase();
    const projFileResolved = path.resolve(proj.file);
    const projectDirCandidate = path.join(projectsDir, proj.id);
    const projectDirResolved = path.resolve(projectDirCandidate);
    const isDirectory = (targetPath) => {
      try {
        return fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
      } catch {
        return false;
      }
    };

    const removeWithRetries = async (targetPath, { recursive = false, force = true } = {}) => {
      const maxRetries = 4;
      let lastErr = null;
      for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        try {
          await fs.promises.rm(targetPath, { recursive, force });
          return;
        } catch (err) {
          lastErr = err;
          const code = String(err?.code || '');
          if (code === 'ENOENT') return;
          if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
            await new Promise((resolve) => setTimeout(resolve, 200));
            continue;
          }
          throw err;
        }
      }
      if (lastErr) throw lastErr;
    };

    const projectDirExists = isDirectory(projectDirCandidate);
    const inProjectDir = projFileResolved.toLowerCase().startsWith(projectDirResolved.toLowerCase() + path.sep);

    const abortProjectTileRenders = (projectId, reason = 'project_replace') => {
      const pid = String(projectId || '').trim();
      if (!pid) return { cancelledQueued: 0, abortedRunning: 0 };
      try {
        if (tileRendererPool && typeof tileRendererPool.abortMatching === 'function') {
          return tileRendererPool.abortMatching((params) => {
            try {
              if (!params || typeof params !== 'object') return false;
              if (String(params.project || '') === pid) return true;
              const projectPath = String(params.project_path || '').replace(/\\/g, '/').toLowerCase();
              if (!projectPath) return false;
              return projectPath.includes(`/qgisprojects/${pid.toLowerCase()}/`) || projectPath.endsWith(`/${pid.toLowerCase()}.qgz`) || projectPath.endsWith(`/${pid.toLowerCase()}.qgs`);
            } catch {
              return false;
            }
          }, { reason });
        }
      } catch {}

      try {
        tileRendererPool?.abortAll?.({ reason });
      } catch {}
      return { cancelledQueued: 0, abortedRunning: 0 };
    };

    try {
      abortProjectTileRenders(proj.id, 'project_replace');
    } catch {}

    if (projectDirExists && inProjectDir && projectDirResolved.toLowerCase().startsWith(projectsRootResolved + path.sep)) {
      await removeWithRetries(projectDirCandidate, { recursive: true, force: true });
      return;
    }

    // Remove stale id-folder even if the current project file points elsewhere.
    if (projectDirExists && projectDirResolved.toLowerCase().startsWith(projectsRootResolved + path.sep)) {
      await removeWithRetries(projectDirCandidate, { recursive: true, force: true });
    }

    await removeWithRetries(proj.file, { recursive: true, force: true });

    const parentDir = path.dirname(projFileResolved);
    if (parentDir.toLowerCase().startsWith(projectsRootResolved + path.sep) && parentDir.toLowerCase() !== projectsRootResolved) {
      try {
        const entries = await fs.promises.readdir(parentDir);
        if (!entries.length) {
          await removeWithRetries(parentDir, { recursive: true, force: true });
        }
      } catch {
        // Ignore parent cleanup failures.
      }
    }
  };

  const applyReplaceRetentionPolicy = async (projectId, { keepExistingConfig, keepExistingCache }) => {
    const projectCacheDir = path.join(cacheDir, projectId);
    const projectConfigPath = getProjectConfigPath(projectId);
    let configBackup = null;

    if (keepExistingConfig && fs.existsSync(projectConfigPath)) {
      try {
        configBackup = await fs.promises.readFile(projectConfigPath, 'utf8');
      } catch {
        configBackup = null;
      }
    }

    if (!keepExistingCache && fs.existsSync(projectCacheDir)) {
      await fs.promises.rm(projectCacheDir, { recursive: true, force: true });
      if (keepExistingConfig && configBackup != null) {
        await fs.promises.mkdir(path.dirname(projectConfigPath), { recursive: true });
        await fs.promises.writeFile(projectConfigPath, configBackup, 'utf8');
      }
      return;
    }

    if (!keepExistingConfig && fs.existsSync(projectConfigPath)) {
      await fs.promises.rm(projectConfigPath, { force: true });
      projectConfigCache.delete(projectId);
    }
  };

  const abortProjectScopedPoolWork = (projectId, reason = 'project_upload_cleanup') => {
    const pid = String(projectId || '').trim();
    if (!pid) return;
    try {
      if (tileRendererPool && typeof tileRendererPool.abortMatching === 'function') {
        tileRendererPool.abortMatching((params) => {
          try {
            if (!params || typeof params !== 'object') return false;
            if (String(params.project || '') === pid) return true;
            const projectPath = String(params.project_path || '').replace(/\\/g, '/').toLowerCase();
            if (!projectPath) return false;
            return projectPath.includes(`/qgisprojects/${pid.toLowerCase()}/`) || projectPath.endsWith(`/${pid.toLowerCase()}.qgz`) || projectPath.endsWith(`/${pid.toLowerCase()}.qgs`);
          } catch {
            return false;
          }
        }, { reason });
        return;
      }
    } catch {}
    try { tileRendererPool?.abortAll?.({ reason }); } catch {}
  };

  const clearZipTargetDirectory = async (projectId, targetDir) => {
    if (!targetDir) return;
    const attempts = 14;
    let lastErr = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        abortProjectScopedPoolWork(projectId, 'zip_target_cleanup');
      } catch {}
      try {
        await fs.promises.rm(targetDir, { recursive: true, force: true });
        return;
      } catch (err) {
        lastErr = err;
        const code = String(err?.code || '');
        if (code === 'ENOENT') return;
        if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
          await new Promise((resolve) => setTimeout(resolve, 450));
          continue;
        }
        throw err;
      }
    }
    if (lastErr) throw lastErr;
  };

  // listar proyectos
  app.get("/projects", (req, res) => {
    const allProjects = listProjects();
    const authEnabled = security.isEnabled && security.isEnabled();

    if (!authEnabled) {
      return res.json({
        projects: allProjects.map((p) => ({ ...p, access: 'public' })),
        authEnabled: false,
        user: { role: 'admin' }
      });
    }

    const user = req.user;
    const isAdmin = user && user.role === 'admin';
    const accessSnapshot = readProjectAccessSnapshot();

    const visibleProjects = allProjects
      .map((p) => {
        const accessConfig = resolveProjectAccessEntry(accessSnapshot, p.id) || {};
        const allowedRoles = Array.isArray(accessConfig.allowedRoles) ? accessConfig.allowedRoles : [];
        const allowedUsers = Array.isArray(accessConfig.allowedUsers) ? accessConfig.allowedUsers : [];
        const accessInfo = deriveProjectAccess(accessSnapshot, user, p.id);

        let accessLevel = 'private';
        if (accessInfo.public) accessLevel = 'public';
        else if (allowedRoles.includes('authenticated')) accessLevel = 'authenticated';

        return {
          ...p,
          access: accessLevel,
          isPublic: accessInfo.public === true,
          allowedRoles,
          allowedUsers,
          viaAssignment: accessInfo.viaAssignment === true,
          viaRole: accessInfo.viaRole === true,
          viaUser: accessInfo.viaUser === true
        };
      })
      .filter((p) => {
        if (isAdmin) return true;
        const accessInfo = deriveProjectAccess(accessSnapshot, user, p.id);
        return accessInfo.allowed === true;
      });

    res.json({
      projects: visibleProjects,
      authEnabled: true,
      user: user ? { id: user.id, role: user.role } : null
    });
  });

  // listar proyectos públicos (sin autenticación)
  app.get("/public/projects", (_req, res) => {
    try {
      const listing = buildPublicProjectsListing();
      return res.json(listing);
    } catch (err) {
      console.error("Failed to build public projects listing", err);
      return res.status(500).json({ error: "public_projects_failed" });
    }
  });

  // proyectos asignados al usuario autenticado (cookie / API key)
  app.get("/public/my-projects", (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: "auth_required" });
    }
    try {
      const allProjects = listProjects();
      const snapshot = readProjectAccessSnapshot();
      const visible = [];
      for (const project of allProjects) {
        const accessInfo = deriveProjectAccess(snapshot, user, project.id);
        if (!accessInfo.allowed) continue;
        const descriptor = buildProjectDescriptor(project, { snapshot, access: accessInfo });
        if (descriptor) visible.push(descriptor);
      }
      return res.json({ projects: visible, generatedAt: new Date().toISOString() });
    } catch (err) {
      console.error("Failed to build user projects listing", err);
      return res.status(500).json({ error: "user_projects_failed" });
    }
  });

  // obtener un proyecto público por id (sin autenticación)
  app.get("/public/projects/:id", (req, res) => {
    const raw = req.params?.id ? String(req.params.id) : "";
    const projectId = sanitizeProjectId(raw);
    if (!projectId) return res.status(400).json({ error: "invalid_project_id" });
    try {
      const descriptor = resolvePublicProject(projectId);
      if (!descriptor) return res.status(404).json({ error: "project_not_found" });
      return res.json({ project: descriptor });
    } catch (err) {
      console.error("Failed to resolve public project", { projectId, error: err?.message || err });
      return res.status(500).json({ error: "public_project_failed" });
    }
  });

  app.post("/projects", requireAdmin, (req, res) => {
    projectUpload.single("project")(req, res, async (err) => {
      if (err) {
        recordProjectDiagnostic('error', 'project-upload', 'Project upload request was rejected', {
          code: String(err.code || 'UPLOAD_FAILED'),
          message: redactSecrets(err.message || String(err)).slice(0, 600)
        });
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "file_too_large" });
        }
        if (err.code === "UNSUPPORTED_FILETYPE") {
          return res.status(400).json({ error: "unsupported_filetype", allowed: Array.from(allowedProjectExtensions) });
        }
        return res.status(500).json({ error: "upload_failed", details: String(err) });
      }
      const file = req.file;
      if (!file) {
        recordProjectDiagnostic('warn', 'project-upload', 'Upload request did not include a project file');
        return res.status(400).json({ error: "project_file_required" });
      }
      const uploadStartedAt = Date.now();
      recordProjectDiagnostic('info', 'project-upload', 'Project upload preflight started', {
        filename: path.basename(String(file.originalname || 'project')),
        sizeBytes: Number(file.size) || 0
      });
      const ext = path.extname(file.originalname || "").toLowerCase();
      const preferredIdRaw = req.body?.projectId || req.body?.name || path.basename(file.originalname || "project", ext);
      let projectId = sanitizeProjectId(preferredIdRaw);
      if (!projectId) {
        projectId = `project_${Date.now()}`;
      }

      const existingProject = findProjectById(projectId);
      const replaceExisting = parseBool(req.body?.replaceExisting ?? req.body?.overwrite, false);
      const keepExistingConfig = parseBool(req.body?.keepExistingConfig, true);
      const keepExistingCache = parseBool(req.body?.keepExistingCache, true);
      if (existingProject && !replaceExisting) {
        const lang = detectRequestLanguage(req);
        const text = conflictText(lang, projectId);
        recordProjectDiagnostic('info', 'project-upload', 'Replacement confirmation required before preflight', { projectId });
        try { await fs.promises.unlink(file.path); } catch {}
        return res.status(409).json({
          error: 'project_already_exists',
          code: 'PROJECT_ALREADY_EXISTS',
          projectId,
          language: lang,
          requiresConfirmation: true,
          title: text.title,
          message: text.message,
          hint: text.hint,
          options: {
            replaceExisting: true,
            keepExistingConfig: true,
            keepExistingCache: true
          }
        });
      }

      let preflight;
      try {
        preflight = await runProjectLayerPreflight(file);
      } catch (preflightError) {
        const code = String(preflightError?.code || 'PROJECT_PREFLIGHT_FAILED');
        const stderr = redactSecrets(preflightError?.stderr || preflightError?.cause?.message || '').slice(0, 1800);
        const diagnostic = recordProjectDiagnostic('error', 'project-preflight', 'QGIS preflight failed', {
          projectId,
          filename: path.basename(String(file.originalname || 'project')),
          code,
          exitCode: preflightError?.exitCode ?? null,
          message: preflightError?.message || String(preflightError),
          stderr
        });
        try { await fs.promises.unlink(file.path); } catch {}
        const zipErrors = {
          ZIP_TOO_MANY_ENTRIES: { status: 413, error: 'zip_too_many_entries', maxEntries: preflightError?.maxEntries },
          ZIP_EXTRACT_TOO_LARGE: { status: 413, error: 'zip_extract_too_large', maxExtractBytes: preflightError?.maxExtractBytes },
          ZIP_ENTRY_TOO_LARGE: { status: 413, error: 'zip_entry_too_large', entry: preflightError?.entry, maxEntryBytes: preflightError?.maxEntryBytes },
          ZIP_UNSAFE_ENTRY_PATH: { status: 400, error: 'zip_unsafe_entry_path', entry: preflightError?.entry }
        };
        if (zipErrors[code]) {
          const zipError = zipErrors[code];
          const { status, ...payload } = zipError;
          return res.status(status).json({ ...payload, code, diagnosticId: diagnostic.id });
        }
        const status = code === 'PROJECT_EXTRACTOR_TIMEOUT' ? 504 : 422;
        return res.status(status).json({
          error: 'project_validation_failed',
          code,
          message: 'QGIS could not read this project. Nothing was added.',
          diagnosticId: diagnostic.id
        });
      }
      if (preflight?.error) {
        recordProjectDiagnostic('warn', 'project-preflight', 'Project upload rejected by preflight', {
          projectId,
          error: preflight.error,
          filename: path.basename(String(file.originalname || 'project'))
        });
        try { await fs.promises.unlink(file.path); } catch {}
        const status = preflight.error.startsWith('zip_') ? 400 : 422;
        return res.status(status).json(preflight);
      }
      const invalidLayers = Array.isArray(preflight?.summary?.invalidLayers) ? preflight.summary.invalidLayers : [];
      const allowInvalidLayers = parseBool(req.body?.allowInvalidLayers, false);
      if (invalidLayers.length && !allowInvalidLayers) {
        const diagnostic = recordProjectDiagnostic('warn', 'project-preflight', 'Project contains layers that QGIS cannot load', {
          projectId,
          layerCount: preflight.summary.layerCount,
          validLayerCount: preflight.summary.validLayerCount,
          invalidLayerCount: preflight.summary.invalidLayerCount,
          invalidLayers: invalidLayers.slice(0, 20)
        });
        try { await fs.promises.unlink(file.path); } catch {}
        await cleanupProjectPreflight(preflight);
        return res.status(422).json({
          error: 'project_invalid_layers',
          requiresConfirmation: true,
          message: 'Some layers are invalid in QGIS. Review them before continuing.',
          summary: preflight.summary,
          diagnosticId: diagnostic.id
        });
      }
      recordProjectDiagnostic(invalidLayers.length ? 'warn' : 'info', 'project-preflight', 'Project preflight completed', {
        projectId,
        layerCount: preflight.summary.layerCount,
        validLayerCount: preflight.summary.validLayerCount,
        invalidLayerCount: preflight.summary.invalidLayerCount,
        invalidLayersConfirmed: invalidLayers.length > 0 && allowInvalidLayers,
        elapsedMs: Date.now() - uploadStartedAt
      });

      if (existingProject && replaceExisting) {
        try {
          await removeExistingProjectStorage(existingProject);
          await applyReplaceRetentionPolicy(projectId, { keepExistingConfig, keepExistingCache });
        } catch (replaceErr) {
          try { await fs.promises.unlink(file.path); } catch {}
          await cleanupProjectPreflight(preflight);
          return res.status(500).json({ error: 'replace_failed', details: redactSecrets(String(replaceErr?.message || replaceErr)) });
        }
      }

      if (ext === ".zip") {
        const targetDir = path.join(projectsDir, projectId);
        let extractedProjectPath = null;
        try {
          const projectEntryName = String(preflight?.projectRelativePath || '');
          if (!projectEntryName) {
            return res.status(400).json({
              error: 'zip_missing_project',
              message: 'Your Zip file does not have any QGIS project.'
            });
          }
          const projectParts = projectEntryName.split('/').filter(Boolean);

          // Ensure we never extract on top of stale leftovers from a partial/locked delete.
          // This prevents mixed old/new data (e.g. lingering .dbf/.shp) and upload conflicts.
          try {
            if (fs.existsSync(targetDir)) {
              await clearZipTargetDirectory(projectId, targetDir);
            }
          } catch (cleanupErr) {
            recordProjectDiagnostic('error', 'project-upload', 'Could not clear the project target before installing the validated ZIP', {
              projectId,
              message: redactSecrets(cleanupErr?.message || String(cleanupErr))
            });
            return res.status(423).json({
              error: 'project_target_locked',
              message: 'Project upload target is locked by another process. Retry in a few seconds.',
              details: redactSecrets(String(cleanupErr?.message || cleanupErr))
            });
          }

          await fs.promises.mkdir(path.dirname(targetDir), { recursive: true });
          if (preflight?.extractedDir && fs.existsSync(preflight.extractedDir)) {
            try {
              await fs.promises.rename(preflight.extractedDir, targetDir);
            } catch (renameError) {
              if (renameError?.code !== 'EXDEV') throw renameError;
              await fs.promises.cp(preflight.extractedDir, targetDir, { recursive: true, errorOnExist: true });
              await fs.promises.rm(preflight.extractedDir, { recursive: true, force: true });
            }
          } else {
            throw Object.assign(new Error('validated_zip_staging_missing'), { code: 'ZIP_STAGING_MISSING' });
          }

          extractedProjectPath = path.join(targetDir, ...projectParts);
          if (!fs.existsSync(extractedProjectPath)) {
            return res.status(400).json({
              error: 'zip_project_extract_failed',
              message: 'Project file listed in zip could not be extracted.'
            });
          }

          try {
            const bootstrapPayload = {
              ...preflight.payload,
              project: { ...(preflight.payload?.project || {}), path: extractedProjectPath }
            };
            await bootstrapProjectCacheIndex(projectId, extractedProjectPath, false, bootstrapPayload);
          } catch (bootstrapErr) {
            console.warn(`[bootstrap] Initialization failed for ${projectId}:`, bootstrapErr?.message || bootstrapErr);
            recordProjectDiagnostic('error', 'project-upload', 'Cache index bootstrap failed after validated upload', {
              projectId,
              message: bootstrapErr?.message || String(bootstrapErr)
            });
          }

          recordProjectDiagnostic('info', 'project-upload', 'Project uploaded successfully', {
            projectId,
            kind: 'bundle',
            elapsedMs: Date.now() - uploadStartedAt,
            invalidLayersConfirmed: invalidLayers.length > 0 && allowInvalidLayers
          });
          return res.status(201).json({
            status: 'uploaded',
            id: projectId,
            filename: path.basename(file.originalname || 'bundle.zip'),
            kind: 'bundle',
            projectFile: path.relative(projectsDir, extractedProjectPath).replace(/\\/g, '/'),
            replaced: Boolean(existingProject && replaceExisting),
            keepExistingConfig,
            keepExistingCache,
            validation: preflight.summary
          });
        } catch (zipErr) {
          const code = String(zipErr?.code || '');
          if (code === 'ZIP_TOO_MANY_ENTRIES') {
            return res.status(413).json({ error: 'zip_too_many_entries', maxEntries: zipErr.maxEntries });
          }
          if (code === 'ZIP_EXTRACT_TOO_LARGE') {
            return res.status(413).json({ error: 'zip_extract_too_large', maxExtractBytes: zipErr.maxExtractBytes });
          }
          if (code === 'ZIP_ENTRY_TOO_LARGE') {
            return res.status(413).json({ error: 'zip_entry_too_large', entry: zipErr.name, maxEntryBytes: zipErr.maxEntryBytes });
          }
          console.error('Bundle upload failed', zipErr);
          recordProjectDiagnostic('error', 'project-upload', 'Validated ZIP installation failed', {
            projectId,
            code,
            message: redactSecrets(zipErr?.message || String(zipErr)).slice(0, 1200)
          });
          try { await fs.promises.rm(targetDir, { recursive: true, force: true }); } catch {}
          return res.status(500).json({ error: 'zip_upload_failed', details: redactSecrets(String(zipErr?.message || zipErr)) });
        } finally {
          try { if (file.path) await fs.promises.unlink(file.path); } catch {}
          await cleanupProjectPreflight(preflight);
        }
      }

      const targetName = `${projectId}${ext}`;
      const targetPath = path.join(projectsDir, targetName);
      try {
        if (!file.path) {
          throw new Error("temporary_upload_missing");
        }
        await fs.promises.copyFile(file.path, targetPath);
      } catch (writeErr) {
        recordProjectDiagnostic('error', 'project-upload', 'Could not write the validated QGIS project file', {
          projectId,
          message: redactSecrets(writeErr?.message || String(writeErr)).slice(0, 1200)
        });
        return res.status(500).json({ error: "write_failed", details: String(writeErr) });
      } finally {
        if (file.path) {
          try {
            await fs.promises.unlink(file.path);
          } catch {
            // ignore cleanup errors
          }
        }
        await cleanupProjectPreflight(preflight);
      }
      const finalId = targetName.replace(/\.(qgz|qgs)$/i, "");
      try {
        const bootstrapPayload = {
          ...preflight.payload,
          project: { ...(preflight.payload?.project || {}), path: targetPath }
        };
        await bootstrapProjectCacheIndex(finalId, targetPath, false, bootstrapPayload);
      } catch (bootstrapErr) {
        console.warn(`[bootstrap] Initialization failed for ${finalId}:`, bootstrapErr?.message || bootstrapErr);
        recordProjectDiagnostic('error', 'project-upload', 'Cache index bootstrap failed after validated upload', {
          projectId: finalId,
          message: bootstrapErr?.message || String(bootstrapErr)
        });
      }
      recordProjectDiagnostic('info', 'project-upload', 'Project uploaded successfully', {
        projectId: finalId,
        kind: 'project-file',
        elapsedMs: Date.now() - uploadStartedAt,
        invalidLayersConfirmed: invalidLayers.length > 0 && allowInvalidLayers
      });
      return res.status(201).json({
        status: "uploaded",
        id: finalId,
        filename: targetName,
        replaced: Boolean(existingProject && replaceExisting),
        keepExistingConfig,
        keepExistingCache,
        validation: preflight.summary
      });
    });
  });

  const removePathWithRetries = async (targetPath, { isDir = false } = {}) => {
    const maxRetries = 5;
    const retryDelayMs = 300;
    let lastErr = null;
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      try {
        if (isDir) {
          await fs.promises.rm(targetPath, { recursive: true, force: true });
        } else {
          await fs.promises.unlink(targetPath);
        }
        return true;
      } catch (err) {
        lastErr = err;
        const code = String(err?.code || '');
        if (code === 'ENOENT') return true;
        if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
          try { await fs.promises.chmod(targetPath, 0o666); } catch {}
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }
        throw err;
      }
    }
    if (lastErr) throw lastErr;
    return false;
  };

  const escapePowerShellSingleQuote = (value) => String(value || '').replace(/'/g, "''");

  const findWindowsLockingPids = ({ needles = [] } = {}) => {
    if (process.platform !== 'win32') return [];
    const cleanNeedles = (Array.isArray(needles) ? needles : [needles])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .slice(0, 20);
    if (!cleanNeedles.length) return [];

    const psNeedles = cleanNeedles.map((entry) => `'${escapePowerShellSingleQuote(entry)}'`).join(', ');
    const script = [
      `$needles = @(${psNeedles})`,
      "$p = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {",
      "  $_.Name -in @('qgis-bin.exe','qgis.exe','python.exe','pythonw.exe','cmd.exe')",
      "}",
      "$ids = @()",
      "foreach($proc in $p){",
      "  $cmd = [string]$proc.CommandLine",
      "  if([string]::IsNullOrWhiteSpace($cmd)){ continue }",
      "  foreach($n in $needles){",
      "    if($cmd -like \"*$n*\"){ $ids += [int]$proc.ProcessId; break }",
      "  }",
      "}",
      "$ids | Sort-Object -Unique | ForEach-Object { $_ }"
    ].join('; ');

    try {
      const out = spawnSync('powershell', ['-NoProfile', '-Command', script], {
        windowsHide: true,
        encoding: 'utf8'
      });
      const text = String(out?.stdout || '');
      return text
        .split(/\r?\n/)
        .map((line) => Number(String(line || '').trim()))
        .filter((pid) => Number.isFinite(pid) && pid > 0);
    } catch {
      return [];
    }
  };

  const forceKillWindowsPids = (pids = []) => {
    if (process.platform !== 'win32') return;
    const list = [...new Set((Array.isArray(pids) ? pids : [pids])
      .map((pid) => Number(pid))
      .filter((pid) => Number.isFinite(pid) && pid > 0))];
    list.forEach((pid) => {
      try {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        });
      } catch {
        // best effort
      }
    });
  };

  const forceKillWindowsByImageNames = (names = []) => {
    if (process.platform !== 'win32') return;
    const list = [...new Set((Array.isArray(names) ? names : [names])
      .map((name) => String(name || '').trim())
      .filter(Boolean))];
    list.forEach((imageName) => {
      try {
        spawnSync('taskkill', ['/IM', imageName, '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        });
      } catch {
        // best effort
      }
    });
  };

  const releaseProjectLocks = async ({ targetPath = '', projectId = '' } = {}) => {
    if (process.platform !== 'win32') return;
    const target = String(targetPath || '').trim();
    const project = String(projectId || '').trim();
    const candidates = [];

    if (target) {
      const resolved = path.resolve(target);
      candidates.push(resolved);
      candidates.push(path.dirname(resolved));
    }
    if (project) {
      candidates.push(path.join(projectsDir, project));
      candidates.push(`\\qgisprojects\\${project}`);
      candidates.push(`/${project}`);
    }

    const pids = findWindowsLockingPids({ needles: candidates });
    if (pids.length) {
      forceKillWindowsPids(pids);
      await new Promise((resolve) => setTimeout(resolve, 450));
      return;
    }

    // Fallback: some Windows locks (e.g. shapefile sidecars like .dbf/.shx)
    // are not discoverable from process command lines. Avoid repeatedly
    // killing QGIS worker processes (which causes restart loops). Implement
    // a short cooldown per project and attempt a graceful pool abort first.
    try {
      if (project) {
        if (typeof global.__qtiler_recent_fallback_kills === 'undefined') global.__qtiler_recent_fallback_kills = new Map();
        const last = Number(global.__qtiler_recent_fallback_kills.get(project) || 0);
        const now = Date.now();
        const COOLDOWN = Number(process.env.PROJECT_LOCK_FALLBACK_COOLDOWN_MS || String(60 * 1000));
        if (now - last < COOLDOWN) {
          console.warn('[releaseProjectLocks] Skipping aggressive fallback kill (recent attempt) for', project);
          return;
        }
        // Ask the pool to abort matching tasks as a graceful measure
        try {
          if (tileRendererPool && typeof tileRendererPool.abortMatching === 'function') {
            tileRendererPool.abortMatching((params) => {
              try { return String(params?.project || '') === String(project); } catch { return false; }
            }, { reason: 'project_delete_lock_fallback' });
          } else if (tileRendererPool && typeof tileRendererPool.abortAll === 'function') {
            tileRendererPool.abortAll({ reason: 'project_delete_lock_fallback' });
          }
        } catch (e) {
          console.warn('[releaseProjectLocks] pool abortMatching failed:', String(e?.message || e));
        }
        console.warn('[releaseProjectLocks] Fallback: killing QGIS binaries only (safer)');
        forceKillWindowsByImageNames(['qgis-bin.exe', 'qgis.exe', 'pythonw.exe']);
        global.__qtiler_recent_fallback_kills.set(project, now);
        await new Promise((resolve) => setTimeout(resolve, 650));
      }
    } catch (e) {
      // best-effort; ignore
      console.warn('[releaseProjectLocks] Fallback error:', String(e?.message || e));
    }
  };

  const removeWithWorkerReset = async (targetPath, { isDir = false, projectId = '' } = {}) => {
    try {
      return await removePathWithRetries(targetPath, { isDir });
    } catch (err) {
      const code = String(err?.code || '');
      if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
        try {
          tileRendererPool?.abortAll?.({ reason: 'project_delete' });
        } catch {}
        await releaseProjectLocks({ targetPath, projectId });
        await new Promise((resolve) => setTimeout(resolve, 500));
        return await removePathWithRetries(targetPath, { isDir });
      }
      throw err;
    }
  };

  const abortProjectTileRenders = (projectId, reason = 'project_delete') => {
    const pid = String(projectId || '').trim();
    if (!pid) return { cancelledQueued: 0, abortedRunning: 0 };
    try {
      if (tileRendererPool && typeof tileRendererPool.abortMatching === 'function') {
        return tileRendererPool.abortMatching((params) => {
          try {
            if (!params || typeof params !== 'object') return false;
            if (String(params.project || '') === pid) return true;
            const projectPath = String(params.project_path || '').replace(/\\/g, '/').toLowerCase();
            if (!projectPath) return false;
            return projectPath.includes(`/qgisprojects/${pid.toLowerCase()}/`) || projectPath.endsWith(`/${pid.toLowerCase()}.qgz`) || projectPath.endsWith(`/${pid.toLowerCase()}.qgs`);
          } catch {
            return false;
          }
        }, { reason });
      }
    } catch {}

    try {
      tileRendererPool?.abortAll?.({ reason });
    } catch {}
    return { cancelledQueued: 0, abortedRunning: 0 };
  };

  const vectorTilesStorePath = path.join(process.cwd(), 'data', 'VectorTiles', 'tilesets.json');
  const quantizedMeshStorePath = path.join(process.cwd(), 'data', 'QuantizedMesh', 'terrains.json');
  const quantizedMeshCacheRoot = path.join(process.cwd(), 'cache', 'quantized-mesh');
  const pendingBackgroundProjectCleanup = new Set();
  const removeVectorTilesRegistryEntries = async (projectIds = []) => {
    const ids = [...new Set((Array.isArray(projectIds) ? projectIds : [projectIds])
      .map((value) => String(value || '').trim())
      .filter(Boolean))];
    if (!ids.length) return { updated: false };
    if (!fs.existsSync(vectorTilesStorePath)) return { updated: false };

    const raw = await fs.promises.readFile(vectorTilesStorePath, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    const items = parsed && parsed.items && typeof parsed.items === 'object' ? { ...parsed.items } : {};
    let changed = false;
    ids.forEach((id) => {
      if (Object.prototype.hasOwnProperty.call(items, id)) {
        delete items[id];
        changed = true;
      }
    });
    if (!changed) return { updated: false };

    await fs.promises.mkdir(path.dirname(vectorTilesStorePath), { recursive: true });
    await fs.promises.writeFile(vectorTilesStorePath, JSON.stringify({ ...parsed, items }, null, 2), 'utf8');
    return { updated: true };
  };

  const removeQuantizedMeshRegistryEntries = async (projectIds = []) => {
    const ids = [...new Set((Array.isArray(projectIds) ? projectIds : [projectIds])
      .map((value) => String(value || '').trim())
      .filter(Boolean))];
    if (!ids.length) return { updated: false };
    if (!fs.existsSync(quantizedMeshStorePath)) return { updated: false };

    const raw = await fs.promises.readFile(quantizedMeshStorePath, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    const items = parsed && parsed.items && typeof parsed.items === 'object' ? { ...parsed.items } : {};
    let changed = false;
    ids.forEach((id) => {
      if (Object.prototype.hasOwnProperty.call(items, id)) {
        delete items[id];
        changed = true;
      }
    });
    if (!changed) return { updated: false };

    await fs.promises.mkdir(path.dirname(quantizedMeshStorePath), { recursive: true });
    await fs.promises.writeFile(quantizedMeshStorePath, JSON.stringify({ ...parsed, items }, null, 2), 'utf8');
    return { updated: true };
  };

  const startBackgroundProjectCleanup = (projectId, paths = []) => {
    const id = String(projectId || '').trim();
    if (!id || pendingBackgroundProjectCleanup.has(id)) return;
    pendingBackgroundProjectCleanup.add(id);

    setTimeout(async () => {
      try {
        const uniquePaths = [...new Set((Array.isArray(paths) ? paths : [paths])
          .map((p) => String(p || '').trim())
          .filter(Boolean))];

        for (let attempt = 0; attempt < 8; attempt += 1) {
          try {
            tileRendererPool?.abortAll?.({ reason: 'project_delete_background_cleanup' });
          } catch {}

          for (const targetPath of uniquePaths) {
            try {
              if (!fs.existsSync(targetPath)) continue;
              let isDir = false;
              try {
                isDir = fs.statSync(targetPath).isDirectory();
              } catch {
                isDir = targetPath.toLowerCase().includes(`${path.sep}qgisprojects${path.sep}`) || targetPath.toLowerCase().includes(`${path.sep}cache${path.sep}`);
              }
              try {
                await removeWithWorkerReset(targetPath, { isDir, projectId: id });
              } catch (remErr) {
                // Log diagnostic info about the path and possible locking PIDs
                try {
                  console.warn(`[background-cleanup] Failed to remove ${targetPath}: ${String(remErr?.message || remErr)}`);
                  const pids = findWindowsLockingPids({ needles: [targetPath] });
                  if (Array.isArray(pids) && pids.length) {
                    console.warn(`[background-cleanup] Processes holding handles for ${targetPath}: ${pids.join(', ')}`);
                    if (String(process.env.PROJECT_LOCK_FORCE_KILL || '').toLowerCase() === '1') {
                      try {
                        console.warn('[background-cleanup] FORCE_KILL enabled: killing locking PIDs for', targetPath);
                        forceKillWindowsPids(pids);
                      } catch (killErr) {
                        console.warn('[background-cleanup] Failed to kill locking PIDs:', String(killErr?.message || killErr));
                      }
                    }
                  } else {
                    // As a last resort attempt releaseProjectLocks for diagnostics
                    try { await releaseProjectLocks({ targetPath, projectId: id }); } catch (e) { /* ignore */ }
                  }
                } catch (diagErr) {
                  console.warn('[background-cleanup] Diagnostic failure while handling remove error:', String(diagErr?.message || diagErr));
                }
                // keep retrying
              }
            } catch (e) {
              // keep retrying other paths
            }
          }

          try {
            await removeVectorTilesRegistryEntries([id]);
          } catch {}
          try {
            await removeQuantizedMeshRegistryEntries([id]);
          } catch {}

          const stillThere = uniquePaths.some((p) => {
            try {
              return fs.existsSync(p);
            } catch {
              return false;
            }
          });
          if (!stillThere) break;
          await new Promise((resolve) => setTimeout(resolve, 1250));
        }
      } finally {
        pendingBackgroundProjectCleanup.delete(id);
      }
    }, 100);
  };

  app.delete("/projects/:id", requireAdmin, async (req, res) => {
    try {
      const projectId = req.params.id;
      if (!projectId) {
        return res.status(400).json({ error: "project_id_required" });
      }
      // Suspend the pool to prevent workers auto-restarting while we abort tasks
      try {
        if (tileRendererPool && typeof tileRendererPool.suspend === 'function') {
          console.log(`[projects.delete] Suspending tileRendererPool for project ${projectId}`);
          tileRendererPool.suspend();
        }
      } catch (e) {
        console.warn('[projects.delete] Failed to suspend pool:', String(e?.message || e));
      }

      // Ensure any queued or running tile-render tasks for this project are aborted
      try {
        if (tileRendererPool && typeof tileRendererPool.abortMatching === 'function') {
          console.log(`[projects.delete] Aborting tileRendererPool tasks for project ${projectId}`);
          tileRendererPool.abortMatching((params) => {
            try { return String(params?.project || '') === String(projectId); } catch { return false; }
          }, { reason: 'project_delete' });
        } else if (tileRendererPool && typeof tileRendererPool.cancelQueued === 'function') {
          tileRendererPool.cancelQueued((params) => {
            try { return String(params?.project || '') === String(projectId); } catch { return false; }
          });
        }
      } catch (e) {
        console.warn('[projects.delete] Failed to abort pool tasks early:', String(e?.message || e));
      }

      // Wait a short while for worker processes and queue to settle to avoid file-lock races
      const waitForPoolIdle = async (pid, timeoutMs = 12000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          try {
            // Check queued items
            const queueHas = Array.isArray(tileRendererPool?.queue) && tileRendererPool.queue.some((it) => {
              try { return String(it?.params?.project || '') === String(pid); } catch { return false; }
            });
            // Check running workers
            const runningHas = Array.isArray(tileRendererPool?.workers) && tileRendererPool.workers.some((w) => {
              try { return !!w?.busy && String(w?.currentTask?.project || '') === String(pid); } catch { return false; }
            });
            if (!queueHas && !runningHas) return true;
          } catch (e) {
            // ignore inspection errors
          }
          await new Promise((r) => setTimeout(r, 300));
        }
        return false;
      };

      try {
        const ok = await waitForPoolIdle(projectId, 12000);
        if (!ok) console.warn(`[projects.delete] pool did not drain within timeout for project ${projectId}`);
      } catch (e) {
        console.warn('[projects.delete] waitForPoolIdle failed:', String(e?.message || e));
      }
      const retryCleanup = String(req.query?.retry || '') === '1';
      const proj = findProjectById(projectId);
      if (!proj && !retryCleanup) {
        return res.status(404).json({ error: "project_not_found" });
      }

    const cleanupErrors = [];
    const addCleanupError = (scope, err) => {
      cleanupErrors.push({
        scope,
        message: String(err?.message || err || 'unknown_error')
      });
    };

    const vectorTilesCacheDir = path.join(process.cwd(), 'cache', 'vector-tiles', projectId);
    const quantizedMeshCacheDir = path.join(quantizedMeshCacheRoot, projectId);
    const knownProjectDir = path.join(projectsDir, projectId);
    const bestEffortRemove = async (targetPath, { isDir = false, scope = 'cleanup' } = {}) => {
      if (!targetPath) return;
      try {
        if (!fs.existsSync(targetPath)) return;
        await removeWithWorkerReset(targetPath, { isDir, projectId });
      } catch (err) {
        addCleanupError(scope, err);
      }
    };

    if (!proj && retryCleanup) {
      try { abortProjectTileRenders(projectId, 'project_delete_retry'); } catch {}
      await bestEffortRemove(knownProjectDir, { isDir: true, scope: 'project_dir' });
      await bestEffortRemove(path.join(cacheDir, projectId), { isDir: true, scope: 'cache_dir' });
      await bestEffortRemove(vectorTilesCacheDir, { isDir: true, scope: 'vectortiles_cache_dir' });
      await bestEffortRemove(quantizedMeshCacheDir, { isDir: true, scope: 'quantizedmesh_cache_dir' });
      try {
        await removeVectorTilesRegistryEntries([projectId]);
      } catch (err) {
        addCleanupError('vectortiles_registry', err);
      }
      try {
        await removeQuantizedMeshRegistryEntries([projectId]);
      } catch (err) {
        addCleanupError('quantizedmesh_registry', err);
      }

      const remainingPaths = [knownProjectDir, path.join(cacheDir, projectId), vectorTilesCacheDir, quantizedMeshCacheDir]
        .filter((p) => fs.existsSync(p));
      if (cleanupErrors.length || remainingPaths.length) {
        startBackgroundProjectCleanup(projectId, remainingPaths);
        return res.json({
          status: 'cleanup_retry_pending',
          id: projectId,
          retryable: true,
          cleanupErrors,
          remainingPaths,
          details: 'Project metadata is already gone. Locked files are being removed in the background.'
        });
      }

      return res.json({ status: 'cleanup_retry_done', id: projectId, cacheRemoved: true });
    }

    for (const [jobId, job] of runningJobs.entries()) {
      if (job.project === proj.id && job.status === "running") {
        try {
          job.proc.kill();
          job.status = "aborted";
          job.endedAt = Date.now();
        } catch {
          // ignore
        }
        try {
          activeKeys.delete(`${job.project || ""}:${job.layer}`);
        } catch {
          // ignore
        }
      }
    }

    try { abortProjectTileRenders(proj.id, 'project_delete'); } catch {}

    // Attempt to cancel any VectorTiles jobs and delete tileset via plugin API
    const attemptCancelVectorTiles = async (projectId) => {
      try {
        const base = `${req.protocol}://${req.get('host')}`;
        // Fetch jobs
        let jobsPayload = null;
        try {
          const r = await fetch(`${base}/plugins/VectorTiles/api/jobs`, { credentials: 'include' });
          if (r.ok) jobsPayload = await r.json();
        } catch (e) {
          // ignore network errors
          return;
        }
        const jobs = Array.isArray(jobsPayload?.jobs) ? jobsPayload.jobs : [];
        for (const job of jobs) {
          try {
            if (!job || String(job.projectId || '') !== String(projectId)) continue;
            if (job.status === 'queued' || job.status === 'running') {
              // cancel job
              try {
                await fetch(`${base}/plugins/VectorTiles/api/jobs/${encodeURIComponent(job.id)}/cancel`, { method: 'POST', credentials: 'include' });
              } catch {}
            }
          } catch {}
        }

        // Attempt to delete tileset registry and files
        try {
          await fetch(`${base}/plugins/VectorTiles/api/tilesets/${encodeURIComponent(projectId)}`, { method: 'DELETE', credentials: 'include' });
        } catch {}
      } catch (err) {
        // propagate nothing; best-effort
      }
    };

    try {
      await attemptCancelVectorTiles(proj.id);
    } catch (e) {
      // ignore; best effort
    }

    let removedProjectDir = false;
    try {
      const projectDirCandidate = path.join(projectsDir, proj.id);
      const projectDirResolved = path.resolve(projectDirCandidate);
      const projFileResolved = path.resolve(proj.file);
      const projectsRootResolved = path.resolve(projectsDir);
      const projectDirExists = fs.existsSync(projectDirCandidate) && fs.statSync(projectDirCandidate).isDirectory();
      const inProjectDir = projFileResolved.toLowerCase().startsWith(projectDirResolved.toLowerCase() + path.sep);

      if (projectDirExists && inProjectDir && projectDirResolved.toLowerCase().startsWith(projectsRootResolved.toLowerCase() + path.sep)) {
        await removeWithWorkerReset(projectDirCandidate, { isDir: true, projectId: proj.id });
        removedProjectDir = true;
      } else {
        await removeWithWorkerReset(proj.file, { isDir: false, projectId: proj.id });
      }

      // If the project file is inside a folder under projectsDir, remove that folder as well.
      if (!removedProjectDir) {
        const parentDir = path.dirname(projFileResolved);
        if (parentDir.toLowerCase().startsWith(projectsRootResolved.toLowerCase() + path.sep)) {
          await removeWithWorkerReset(parentDir, { isDir: true, projectId: proj.id });
          removedProjectDir = true;
        }
      }
    } catch (err) {
      addCleanupError('project_files', err);
    }

    // Remove stale id-folder even when project file was outside it.
    await bestEffortRemove(path.join(projectsDir, proj.id), { isDir: true, scope: 'project_dir_stale' });

    cancelProjectTimer(proj.id);
    projectConfigCache.delete(proj.id);
    projectLogLastMessage.delete(proj.id);
    const batchTimer = projectBatchCleanupTimers.get(proj.id);
    if (batchTimer) {
      try {
        clearTimeout(batchTimer);
      } catch {
        // ignore
      }
      projectBatchCleanupTimers.delete(proj.id);
    }
    projectBatchRuns.delete(proj.id);

    const projectCacheDir = path.join(cacheDir, proj.id);
    let cacheRemoved = false;
    if (fs.existsSync(projectCacheDir)) {
      try {
        const indexPath = path.join(projectCacheDir, 'index.json');
        if (fs.existsSync(indexPath)) {
          try {
            const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
            if (Array.isArray(indexData.layers)) {
              for (const layer of indexData.layers) {
                if (layer.tile_matrix_preset && typeof layer.tile_matrix_preset === 'string') {
                  const presetPath = path.join(tileGridDir, `${layer.tile_matrix_preset}.json`);
                  if (fs.existsSync(presetPath)) {
                    try {
                      const presetData = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
                      if (presetData.auto_generated === true && presetData.project_id === proj.id) {
                        fs.unlinkSync(presetPath);
                        console.log(`[cleanup] Removed auto-generated preset: ${layer.tile_matrix_preset}`);
                        invalidateTileGridCaches();
                      }
                    } catch (presetErr) {
                      console.warn(`[cleanup] Failed to check/delete preset ${layer.tile_matrix_preset}:`, presetErr);
                    }
                  }
                }
              }
            }
          } catch (indexErr) {
            console.warn(`[cleanup] Failed to read index.json for preset cleanup:`, indexErr);
          }
        }
        await removeWithWorkerReset(projectCacheDir, { isDir: true, projectId: proj.id });
        cacheRemoved = true;
      } catch (err) {
        addCleanupError('cache_dir', err);
      }
    }

    // Also remove cache by file-based id if it differs (e.g., zip uploads with inner demo.qgz)
    const fileBase = path.basename(proj.file).replace(/\.(qgz|qgs)$/i, '');
    try {
      if (fileBase && fileBase !== proj.id) {
        const altCacheDir = path.join(cacheDir, fileBase);
        if (fs.existsSync(altCacheDir)) {
          await removeWithWorkerReset(altCacheDir, { isDir: true, projectId: proj.id });
        }
      }
    } catch (err) {
      addCleanupError('cache_dir_alt', err);
    }

    // Also cleanup VectorTiles cache for this project when present.
    await bestEffortRemove(path.join(process.cwd(), 'cache', 'vector-tiles', proj.id), { isDir: true, scope: 'vectortiles_cache_dir' });
    try {
      await removeVectorTilesRegistryEntries([proj.id, fileBase]);
    } catch (err) {
      addCleanupError('vectortiles_registry', err);
    }

    await bestEffortRemove(path.join(quantizedMeshCacheRoot, proj.id), { isDir: true, scope: 'quantizedmesh_cache_dir' });
    try {
      if (fileBase && fileBase !== proj.id) {
        await bestEffortRemove(path.join(quantizedMeshCacheRoot, fileBase), { isDir: true, scope: 'quantizedmesh_cache_dir_alt' });
      }
    } catch (err) {
      addCleanupError('quantizedmesh_cache_dir_alt', err);
    }
    try {
      await removeQuantizedMeshRegistryEntries([proj.id, fileBase]);
    } catch (err) {
      addCleanupError('quantizedmesh_registry', err);
    }

    try {
      removeProjectAccessEntry(proj.id);
    } catch (err) {
      console.error("Failed to remove project access entry", proj.id, err);
      addCleanupError('project_access_cleanup', err);
    }

    try {
      purgeProjectFromAuthUsers(proj.id);
    } catch (err) {
      console.error("Failed to purge project assignment", proj.id, err);
      addCleanupError('project_auth_cleanup', err);
    }

    try {
      removeProjectLogs(proj.id);
    } catch (err) {
      console.error("Failed to remove project logs", proj.id, err);
      addCleanupError('project_log_cleanup', err);
    }

    // Also remove any tile-grid presets that were auto-generated for this project
    try {
      if (tileGridDir && fs.existsSync(tileGridDir)) {
        const entries = fs.readdirSync(tileGridDir).filter((f) => f.toLowerCase().endsWith('.json'));
        for (const entry of entries) {
          const full = path.join(tileGridDir, entry);
          try {
            const raw = fs.readFileSync(full, 'utf8');
            let parsed = null;
            try { parsed = JSON.parse(raw); } catch { parsed = null; }
            const filenameLower = String(entry || '').toLowerCase();
            const projectTag = String(proj.id || '').toLowerCase();
            const shouldRemove = (
              (parsed && parsed.project_id && String(parsed.project_id) === proj.id) ||
              (parsed && parsed.auto_generated === true && parsed.project_id === proj.id) ||
              filenameLower.includes(`_${projectTag}`)
            );
            if (shouldRemove) {
              try {
                fs.unlinkSync(full);
                console.log(`[cleanup] Removed tile-grid preset file for project ${proj.id}: ${entry}`);
                try { invalidateTileGridCaches(); } catch {}
              } catch (unlinkErr) {
                console.warn(`[cleanup] Failed to unlink tile-grid file ${full}:`, unlinkErr?.message || unlinkErr);
              }
            }
          } catch (e) {
            // ignore per-file errors
            continue;
          }
        }
      }
    } catch (err) {
      addCleanupError('tile_grids_cleanup', err);
    }

    let remainingPaths = [
      path.join(projectsDir, proj.id),
      proj.file,
      path.join(cacheDir, proj.id),
      path.join(process.cwd(), 'cache', 'vector-tiles', proj.id),
      path.join(cacheDir, fileBase),
      path.join(quantizedMeshCacheRoot, proj.id),
      path.join(quantizedMeshCacheRoot, fileBase)
    ].filter((candidate, index, arr) => {
      if (!candidate) return false;
      if (arr.indexOf(candidate) !== index) return false;
      try {
        return fs.existsSync(candidate);
      } catch {
        return false;
      }
    });

    if (remainingPaths.length) {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try { abortProjectTileRenders(proj.id, 'project_delete_final_sweep'); } catch {}
        for (const targetPath of [...remainingPaths]) {
          try {
            let isDir = false;
            try {
              isDir = fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
            } catch {
              isDir = targetPath.toLowerCase().includes(`${path.sep}qgisprojects${path.sep}`) || targetPath.toLowerCase().includes(`${path.sep}cache${path.sep}`);
            }
            await removeWithWorkerReset(targetPath, { isDir, projectId: proj.id });
          } catch {
            // keep retrying paths that remain
          }
        }

        remainingPaths = remainingPaths.filter((candidate) => {
          try { return fs.existsSync(candidate); } catch { return false; }
        });
        if (!remainingPaths.length) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    if (cleanupErrors.length || remainingPaths.length) {
      startBackgroundProjectCleanup(proj.id, remainingPaths);
      try {
        if (tileRendererPool && typeof tileRendererPool.resume === 'function') {
          tileRendererPool.resume();
        }
      } catch {}
      return res.json({
        status: 'deleted_partial',
        id: proj.id,
        retryable: true,
        cacheRemoved,
        cleanupErrors,
        remainingPaths,
        details: 'Project was removed from the listing. Locked files are being removed in the background.'
      });
    }

    // Ensure top-level project folder under projectsDir is removed if still present
    try {
      const topLevelProjectDir = path.join(projectsDir, proj.id);
      if (fs.existsSync(topLevelProjectDir)) {
        try {
          await removeWithWorkerReset(topLevelProjectDir, { isDir: true, projectId: proj.id });
        } catch (e) {
          // non-fatal, will be retried by background cleanup if required
          console.warn(`[cleanup] Failed to remove top-level project dir ${topLevelProjectDir}:`, String(e?.message || e));
        }
      }
    } catch (e) {
      // ignore errors here
    }

    try {
      if (tileRendererPool && typeof tileRendererPool.resume === 'function') {
        tileRendererPool.resume();
      }
    } catch {}
    return res.json({ status: "deleted", id: proj.id, cacheRemoved });
    } catch (err) {
      console.error('[projects.delete] Unexpected error while deleting project', String(err?.message || err));
      return res.status(500).json({ error: 'project_delete_failed', details: String(err?.message || err) });
    }
  });

  app.get("/projects/:id/download", (req, res, next) => {
    if (!(typeof security?.isEnabled === "function" && security.isEnabled())) {
      return res.status(403).json({ error: "download_unavailable" });
    }
    return requireAdmin(req, res, next);
  }, async (req, res) => {
    const projectId = String(req.params?.id || "").trim();
    if (!projectId) {
      return res.status(400).json({ error: "project_id_required" });
    }

    const project = findProjectById(projectId);
    if (!project || !project.file) {
      return res.status(404).json({ error: "project_not_found" });
    }

    const bundleSource = resolveProjectBundleSource(project);
    if (!bundleSource || !bundleSource.sourcePath) {
      return res.status(400).json({ error: "invalid_project_source" });
    }

    if (!isPathInside(bundleSource.sourcePath, projectsDir)) {
      return res.status(400).json({ error: "project_source_outside_root" });
    }

    const sourcePath = path.resolve(bundleSource.sourcePath);
    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ error: "project_source_missing" });
    }

    const idForName = sanitizeProjectId(project.id) || "project";
    const zipName = `${idForName}.zip`;
    const tempZipPath = path.join(os.tmpdir(), `qtiler-project-${idForName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`);

    const cleanupTemp = async () => {
      try { await fs.promises.unlink(tempZipPath); } catch {}
    };

    try {
      await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(tempZipPath);
        const archive = archiver("zip", {
          forceZip64: true,
          zlib: { level: 6 }
        });

        let settled = false;
        const finish = (err) => {
          if (settled) return;
          settled = true;
          if (err) return reject(err);
          return resolve();
        };

        output.on("close", () => finish());
        output.on("error", finish);
        archive.on("error", finish);
        archive.on("warning", (err) => {
          if (err && err.code === "ENOENT") {
            console.warn("Project zip warning", { projectId, warning: redactSecrets(String(err?.message || err)) });
            return;
          }
          finish(err);
        });

        archive.pipe(output);
        if (bundleSource.kind === "directory") {
          archive.directory(sourcePath, bundleSource.zipRoot || path.basename(sourcePath));
        } else {
          archive.file(sourcePath, { name: path.basename(sourcePath) });
        }
        archive.finalize().catch(finish);
      });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);
      res.setHeader("Cache-Control", "no-store");

      const readStream = fs.createReadStream(tempZipPath);
      readStream.on("error", async (err) => {
        if (!res.headersSent) {
          res.status(500).json({ error: "zip_stream_failed", details: redactSecrets(String(err?.message || err)) });
        } else {
          try { res.end(); } catch {}
        }
        await cleanupTemp();
      });
      res.on("close", () => { cleanupTemp(); });
      readStream.pipe(res);
    } catch (err) {
      await cleanupTemp();
      console.error("Project zip download failed", { projectId, error: err?.message || err });
      return res.status(500).json({ error: "project_zip_failed", details: redactSecrets(String(err?.message || err)) });
    }
  });

  // capas por proyecto
  app.get("/projects/:id/layers", ensureProjectAccess((req) => req.params.id), (req, res) => {
    const proj = findProjectById(req.params.id);
    if (!proj) return res.status(404).json({ error: "project_not_found" });
    const script = path.join(pythonDir, "extract_info.py");
    const startedAt = Date.now();
    adjustActiveProjectExtractions(1);
    let diagnosticFinished = false;
    const finishDiagnostic = (level, message, details = {}) => {
      if (diagnosticFinished) return;
      diagnosticFinished = true;
      adjustActiveProjectExtractions(-1);
      recordProjectDiagnostic(level, 'project-layers', message, {
        projectId: req.params.id,
        elapsedMs: Date.now() - startedAt,
        ...details
      });
    };
    recordProjectDiagnostic('info', 'project-layers', 'Layer extraction started', { projectId: req.params.id });
    let proc;
    try {
      proc = runPythonViaOSGeo4W(script, ["--project", proj.file], {
        cwd: path.dirname(proj.file)
      });
    } catch (error) {
      finishDiagnostic('error', 'Could not start layer extraction', { message: error?.message || String(error) });
      return res.status(500).json({ error: 'spawn_error' });
    }

    let stdout = "", stderr = "";
    proc.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      // Avoid logging full JSON output (may contain URLs/tokens).
    });
    proc.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      // Avoid leaking secrets in logs.
      const line = s.trim();
      if (line) console.error("[py stderr]", redactSecrets(line));
    });
    let sent = false;
    const extractionTimeout = setTimeout(() => {
      finishDiagnostic('error', 'Layer extraction timed out', { timeoutMs: 120000 });
      try { proc.kill(); } catch {}
      if (!sent) {
        sent = true;
        res.status(504).json({ error: 'extract_info_timeout', timeoutMs: 120000 });
      }
    }, 120000);
    extractionTimeout.unref?.();
    proc.on("error", (err) => {
      clearTimeout(extractionTimeout);
      finishDiagnostic('error', 'Could not start layer extraction', { message: err?.message || String(err) });
      console.error("Failed to spawn python:", err);
      if (!sent) { sent = true; res.status(500).json({ error: "spawn_error", details: String(err) }); }
    });
    proc.on("close", (code) => {
      clearTimeout(extractionTimeout);
      if (sent) return;
      sent = true;
      let raw = (stdout && stdout.trim()) || (stderr && stderr.trim()) || "";
      if (raw) {
        const candidate = extractJsonLike(raw);
        if (candidate) {
          try {
            const parsed = JSON.parse(candidate);
            if (code === 0) {
              const layers = Array.isArray(parsed?.layers) ? parsed.layers : [];
              const invalidLayerCount = layers.filter((layer) => layer?.valid === false).length;
              const invalidLayers = layers.filter((layer) => layer?.valid === false).map((layer) => String(layer?.name || layer?.id || 'Unknown layer')).slice(0, 100);
              finishDiagnostic(invalidLayers.length ? 'warn' : 'info', invalidLayers.length ? 'Project layers include invalid providers' : 'Layer extraction completed', {
                layerCount: layers.length,
                invalidLayerCount,
                invalidLayers: invalidLayers.slice(0, 20)
              });
              if (parsed && typeof parsed === 'object' && Array.isArray(parsed.layers) && Array.isArray(parsed.themes)) {
                const existingLayerNames = new Set(parsed.layers.map((layer) => String(layer?.name || layer?.id || '').trim()).filter(Boolean));
                for (const theme of parsed.themes) {
                  const themeName = String(theme?.name || theme?.id || '').trim();
                  if (!themeName) continue;
                  const syntheticName = `theme:${themeName}`;
                  if (existingLayerNames.has(syntheticName)) continue;
                  parsed.layers.push({
                    id: syntheticName,
                    name: syntheticName,
                    title: themeName,
                    kind: 'theme',
                    type: 'THEME',
                    geometry_type: 'theme',
                    isTheme: true,
                    themeName
                  });
                  existingLayerNames.add(syntheticName);
                }
              }
              if (parsed && typeof parsed === 'object' && Array.isArray(parsed.layers)) {
                parsed.layers = filterPublicProjectLayersForRequest(req, req.params.id, parsed.layers);
              }
              return res.status(200).json(stripProjectPathsAndSecrets(parsed));
            }
            // Never echo raw stderr/stdout back to clients on failure.
            finishDiagnostic('error', 'Layer extraction process failed', { exitCode: code, stderr: redactSecrets(stderr).slice(0, 1800) });
            return res.status(500).json({ error: "extract_info_failed", code });
          } catch (e) {
            if (code === 0) {
              finishDiagnostic('warn', 'Layer extraction returned invalid JSON', { message: e?.message || String(e) });
              return res.status(200).json({ ok: true });
            }
            finishDiagnostic('error', 'Layer extraction process failed', { exitCode: code, stderr: redactSecrets(stderr).slice(0, 1800) });
            return res.status(500).json({ error: "extract_info_failed", code });
          }
        }
        if (code === 0) {
          // Unexpected non-JSON output; avoid returning it.
          finishDiagnostic('warn', 'Layer extraction returned no JSON payload', { stdoutLength: stdout.length, stderr: redactSecrets(stderr).slice(0, 1200) });
          return res.status(200).json({ ok: true });
        }
        finishDiagnostic('error', 'Layer extraction process failed', { exitCode: code, stderr: redactSecrets(stderr).slice(0, 1800) });
        return res.status(500).json({ error: "extract_info_failed", code });
      }
      if (code === 0) {
        finishDiagnostic('warn', 'Layer extraction returned empty output');
        return res.status(200).json({ ok: true });
      }
      finishDiagnostic('error', 'Layer extraction process failed', { exitCode: code, stderr: redactSecrets(stderr).slice(0, 1800) });
      return res.status(500).json({ error: "extract_info_failed", code });
    });
  });

  app.get("/projects/:id/config", ensureProjectAccess((req) => req.params.id), (req, res) => {
    const projectId = req.params.id;
    const proj = findProjectById(projectId);
    if (!proj) return res.status(404).json({ error: "project_not_found" });
    const config = readProjectConfig(projectId);
    return res.json(config);
  });

  const updateProjectConfigHandler = async (req, res) => {
    const projectId = req.params.id;
    const proj = findProjectById(projectId);
    if (!proj) return res.status(404).json({ error: "project_not_found" });
    console.log(`[PATCH /projects/${projectId}/config] authEnabled=${!!(security.isEnabled && security.isEnabled())}, user=${req.user ? JSON.stringify({ id: req.user.id, role: req.user.role }) : 'null'}`);
    console.log('[PATCH] incoming body:', JSON.stringify(req.body || {}));

    try {
      const rawInput = req.body || {};
      const currentConfig = readProjectConfig(projectId, { useCache: false }) || {};
      if (
        rawInput.layers &&
        typeof rawInput.layers === 'object' &&
        currentConfig.extent &&
        Array.isArray(currentConfig.extent.bbox) &&
        currentConfig.extent.bbox.length === 4
      ) {
        const [pMinX, pMinY, pMaxX, pMaxY] = currentConfig.extent.bbox.map(Number);
        for (const [layerName, layerValue] of Object.entries(rawInput.layers)) {
          if (!layerValue || typeof layerValue !== 'object') continue;
          const ext = Array.isArray(layerValue.extent) ? layerValue.extent.map(Number) : null;
          if (ext && ext.length === 4) {
            const [lMinX, lMinY, lMaxX, lMaxY] = ext;
            if (!(lMinX >= pMinX && lMinY >= pMinY && lMaxX <= pMaxX && lMaxY <= pMaxY)) {
              return res.status(400).json({
                error: 'extent_out_of_range',
                message: `Layer ${layerName} extent is outside project extent`
              });
            }
          }
        }
      }
    } catch (e) {
      console.warn('Pre-validate extent check failed', e);
    }

    let patch;
    try {
      patch = buildProjectConfigPatch(req.body || {});
      for (const code of patch.services?.publishedCrs || []) {
        if (code !== 'CRS:84' && !(await ensureServerProj4Def(code))) {
          return res.status(400).json({ error: 'invalid_crs', message: `Unknown or unavailable EPSG: ${code}` });
        }
      }
    } catch (err) {
      return res.status(400).json({ error: 'invalid_project_config', message: err.message });
    }
    console.log('[PATCH] built patch:', JSON.stringify(patch));
    try {
      const updated = updateProjectConfig(projectId, patch);
      console.log(`[PATCH /projects/${projectId}/config] wrote config to ${getProjectConfigPath(projectId)}`);

      const purged = [];
      try {
        if (patch.layers && typeof patch.layers === 'object') {
          for (const [layerName, layerPatch] of Object.entries(patch.layers)) {
            if (!layerPatch || typeof layerPatch !== 'object') continue;
            const triggers = ['resolutions', 'tileGridId', 'extent'];
            const needsPurge = triggers.some((t) => Object.prototype.hasOwnProperty.call(layerPatch, t));
            if (needsPurge) {
              try {
                await deleteLayerCacheInternal(projectId, layerName, { force: true, silent: true });
                purged.push(layerName);
              } catch (purgeErr) {
                console.warn(`Failed to purge cache for ${projectId}:${layerName}`, purgeErr);
              }
            }
          }
        }
      } catch (e) {
        console.warn('Post-update purge check failed', e);
      }

      if (purged.length) {
        try {
          updated._purged = purged;
        } catch {
          // ignore
        }
      }

      return res.json(updated);
    } catch (err) {
      console.error("Failed to update project config", projectId, err);
      return res.status(500).json({ error: "config_update_failed", details: String(err?.message || err) });
    }
  };

  app.patch("/projects/:id/config", requireAdmin, updateProjectConfigHandler);
  app.post("/projects/:id/config", requireAdmin, updateProjectConfigHandler);

  app.get("/projects/:id/cache/project", ensureProjectAccess((req) => req.params.id), (req, res) => {
    const projectId = req.params.id;
    const proj = findProjectById(projectId);
    if (!proj) return res.status(404).json({ error: "project_not_found" });
    const current = projectBatchRuns.get(projectId) || null;
    const config = readProjectConfig(projectId);
    const last = config.projectCache || null;
    return res.json({ current, last });
  });

  app.delete("/projects/:id/cache/project", requireAdmin, async (req, res) => {
    const projectId = req.params.id;
    const proj = findProjectById(projectId);
    if (!proj) return res.status(404).json({ error: "project_not_found" });
    try {
      const result = await abortProjectBatchRunInternal(projectId, { reason: "user_abort" });
      if (!result?.ok) {
        return res.status(result?.status || 500).json(result?.payload || { error: "batch_abort_failed" });
      }
      return res.status(result.status).json(result.payload);
    } catch (err) {
      return res.status(500).json({ error: "batch_abort_failed", details: String(err?.message || err) });
    }
  });

  app.post("/projects/:id/cache/project", requireAdmin, (req, res) => {
    const projectId = req.params.id;
    const proj = findProjectById(projectId);
    if (!proj) return res.status(404).json({ error: "project_not_found" });
    const existing = projectBatchRuns.get(projectId);
    if (existing && (existing.status === "running" || existing.status === "queued")) {
      return res.status(409).json({ error: "batch_running", runId: existing.id, message: "Project cache already in progress" });
    }
    const body = req.body || {};
    const layersInput = Array.isArray(body.layers) ? body.layers : [];
    const overrideLayers = [];
    for (const entry of layersInput) {
      if (!entry || typeof entry !== "object") continue;
      const layerName = typeof entry.layer === "string" ? entry.layer : typeof entry.name === "string" ? entry.name : null;
      if (!layerName) continue;
      const paramsSource =
        entry.params && typeof entry.params === "object"
          ? entry.params
          : entry.body && typeof entry.body === "object"
            ? entry.body
            : null;
      if (!paramsSource) continue;
      const params = { ...paramsSource, layer: layerName, project: projectId };
      overrideLayers.push({ layer: layerName, params });
    }
    if (!overrideLayers.length) {
      return res.status(400).json({ error: "no_layers", message: "No layers provided for project cache" });
    }
    const runId = crypto && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const layerNames = overrideLayers.map((l) => l.layer);
    const runTrigger = body.reason === "scheduled" ? "timer" : "manual";
    updateProjectBatchRun(projectId, {
      id: runId,
      project: projectId,
      status: "queued",
      reason: body.reason || "manual-project",
      trigger: runTrigger,
      createdAt: Date.now(),
      layers: layerNames
    });
    res.json({ status: "queued", runId, project: projectId, layers: layerNames.length });
    setImmediate(async () => {
      try {
        const pendingRun = projectBatchRuns.get(projectId);
        if (pendingRun?.id === runId && (pendingRun.abortRequested || pendingRun.status === "aborted")) {
          logProjectEvent(projectId, `Project cache run ${runId} aborted before start.`, "warn");
          return;
        }
        await runRecacheForProject(projectId, "manual-project", { overrideLayers, runId, requireEnabled: false });
        const finalRun = projectBatchRuns.get(projectId);
        if (finalRun?.id !== runId) return;
        if (finalRun.status === "completed") {
          logProjectEvent(projectId, `Project cache run ${runId} completed (${layerNames.length} layers).`);
        } else if (finalRun.status === "aborted") {
          logProjectEvent(projectId, `Project cache run ${runId} aborted.`, "warn");
        }
      } catch (err) {
        const currentRun = projectBatchRuns.get(projectId);
        if (currentRun?.id === runId && currentRun.status === "aborted") {
          logProjectEvent(projectId, `Project cache run ${runId} aborted.`, "warn");
          return;
        }
        const message = err?.message || String(err);
        if (!(currentRun?.id === runId && currentRun.status === "error")) {
          updateProjectBatchRun(projectId, { status: "error", endedAt: Date.now(), error: message, result: "error", trigger: runTrigger });
        }
        logProjectEvent(projectId, `Project cache run ${runId} failed: ${message}`, "error");
      }
    });
  });

  // /layers -> ejecutar script extract_info.py usando o4w_env.bat
  app.get("/layers", requireAdmin, (req, res) => {
    const script = path.join(pythonDir, "extract_info.py");
    console.log("GET /layers -> launching python:", pythonExe, script);
    const proc = runPythonViaOSGeo4W(script, []);

    let stdout = "", stderr = "";
    proc.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      console.log("[py stdout]", s.trim());
    });
    proc.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      console.error("[py stderr]", s.trim());
    });
    proc.on("error", (err) => {
      console.error("Failed to spawn python:", err);
      res.status(500).json({ error: "spawn_error", details: String(err) });
    });

    proc.on("close", (code) => {
      console.log(`python process exited ${code}`);
      let raw = (stdout && stdout.trim()) || (stderr && stderr.trim()) || "";
      if (raw) {
        const candidate = extractJsonLike(raw);
        if (candidate) {
          try {
            const parsed = JSON.parse(candidate);
            return res.status(code === 0 ? 200 : 500).json(parsed);
          } catch (e) {
            return res.status(code === 0 ? 200 : 500).json({ raw, code });
          }
        } else {
          return res.status(code === 0 ? 200 : 500).json({ raw, code });
        }
      }
      return res.status(code === 0 ? 200 : 500).json({ code, details: stderr || "no output" });
    });
  });

  app.get("/projects/:id/searchable", ensureProjectAccess((req) => req.params.id), async (req, res) => {
    const projectId = sanitizeProjectId(req.params.id);
    if (!projectId) {
      return res.status(400).json({ error: "invalid_project" });
    }
    
    const searchableDir = path.join(process.cwd(), 'data', 'searchable-layers');
    const searchableLayersPath = path.join(searchableDir, `${projectId}.json`);
    
    try {
      const data = await fs.promises.readFile(searchableLayersPath, 'utf8');
      const layers = JSON.parse(data);
      return res.json(layers);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.json([]); // Si no existe, devuelve array vacío
      }
      console.error("Failed to read/parse searchable layers file", err);
      return res.status(500).json({ error: "read_failed" });
    }
  });

  app.post("/projects/:id/searchable", requireAdmin, async (req, res) => {
    const projectId = sanitizeProjectId(req.params.id);
    if (!projectId) {
      return res.status(400).json({ error: "invalid_project" });
    }
    
    const searchableDir = path.join(process.cwd(), 'data', 'searchable-layers');
    const searchableLayersPath = path.join(searchableDir, `${projectId}.json`);
    const updatedLayers = req.body;

    try {
      await fs.promises.mkdir(searchableDir, { recursive: true });
      await fs.promises.writeFile(searchableLayersPath, JSON.stringify(updatedLayers, null, 2), 'utf8');
      return res.status(200).json({ status: "success" });
    } catch (err) {
      console.error("Failed to save searchable layers", err);
      return res.status(500).json({ error: "write_failed" });
    }
  });

 
};
