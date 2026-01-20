/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

import fs from "fs";
import os from "os";
import path from "path";
import yauzl from "yauzl";
import { pipeline } from "stream/promises";

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
  updateProjectConfig,
  getProjectConfigPath,
  deleteLayerCacheInternal,
  updateProjectBatchRun,
  runRecacheForProject,
  logProjectEvent,
  buildPublicProjectsListing,
  resolvePublicProject
}) => {

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

  app.post("/projects", requireAdmin, (req, res) => {
    projectUpload.single("project")(req, res, async (err) => {
      if (err) {
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
        return res.status(400).json({ error: "project_file_required" });
      }
      const ext = path.extname(file.originalname || "").toLowerCase();
      const preferredIdRaw = req.body?.projectId || req.body?.name || path.basename(file.originalname || "project", ext);
      let projectId = sanitizeProjectId(preferredIdRaw);
      if (!projectId) {
        projectId = `project_${Date.now()}`;
      }

      const ensureUniqueProjectId = (baseId) => {
        let nextId = baseId;
        let suffix = 1;
        while (
          fs.existsSync(path.join(projectsDir, `${nextId}.qgz`)) ||
          fs.existsSync(path.join(projectsDir, `${nextId}.qgs`)) ||
          fs.existsSync(path.join(projectsDir, nextId))
        ) {
          nextId = `${baseId}_${suffix}`;
          suffix += 1;
        }
        return nextId;
      };

      projectId = ensureUniqueProjectId(projectId);

      if (ext === ".zip") {
        const targetDir = path.join(projectsDir, projectId);
        let extractedProjectPath = null;
        try {
          const maxZipEntries = Number.parseInt(process.env.ZIP_UPLOAD_MAX_ENTRIES || '20000', 10);
          const maxZipTotalBytes = Number.parseInt(process.env.ZIP_EXTRACT_MAX_BYTES || String(10 * 1024 * 1024 * 1024), 10); // 10 GiB
          const maxZipEntryBytes = Number.parseInt(process.env.ZIP_EXTRACT_MAX_ENTRY_BYTES || String(10 * 1024 * 1024 * 1024), 10); // 10 GiB
          const zipEntriesLimit = Number.isFinite(maxZipEntries) && maxZipEntries > 0 ? maxZipEntries : 20000;
          const zipTotalLimit = Number.isFinite(maxZipTotalBytes) && maxZipTotalBytes > 0 ? maxZipTotalBytes : (10 * 1024 * 1024 * 1024);
          const zipEntryLimit = Number.isFinite(maxZipEntryBytes) && maxZipEntryBytes > 0 ? maxZipEntryBytes : (10 * 1024 * 1024 * 1024);

          const openZip = (zipPath) => new Promise((resolve, reject) => {
            yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true }, (err, zipfile) => {
              if (err) return reject(err);
              return resolve(zipfile);
            });
          });

          const inspectZip = async (zipPath) => {
            const zipfile = await openZip(zipPath);
            const entries = [];
            return await new Promise((resolve, reject) => {
              let totalUncompressed = 0;
              let entryCount = 0;
              zipfile.on('error', (e) => {
                try { zipfile.close(); } catch {}
                reject(e);
              });
              zipfile.on('entry', (entry) => {
                try {
                  entryCount += 1;
                  if (entryCount > zipEntriesLimit) {
                    try { zipfile.close(); } catch {}
                    return reject(Object.assign(new Error('zip_too_many_entries'), { code: 'ZIP_TOO_MANY_ENTRIES', entryCount, maxEntries: zipEntriesLimit }));
                  }

                  const nameRaw = String(entry.fileName || '');
                  const normalized = nameRaw.replace(/\\/g, '/');
                  const isDirectory = normalized.endsWith('/');
                  if (!isDirectory && normalized && !normalized.startsWith('__MACOSX/')) {
                    const uncompressedSize = Number(entry.uncompressedSize);
                    const safeSize = Number.isFinite(uncompressedSize) && uncompressedSize >= 0 ? uncompressedSize : 0;
                    if (safeSize > zipEntryLimit) {
                      try { zipfile.close(); } catch {}
                      return reject(Object.assign(new Error('zip_entry_too_large'), { code: 'ZIP_ENTRY_TOO_LARGE', name: normalized, maxEntryBytes: zipEntryLimit }));
                    }
                    totalUncompressed += safeSize;
                    if (totalUncompressed > zipTotalLimit) {
                      try { zipfile.close(); } catch {}
                      return reject(Object.assign(new Error('zip_extract_too_large'), { code: 'ZIP_EXTRACT_TOO_LARGE', maxExtractBytes: zipTotalLimit }));
                    }
                  }

                  entries.push({ name: normalized, isDirectory, uncompressedSize: Number(entry.uncompressedSize) || 0 });
                  zipfile.readEntry();
                } catch (e) {
                  try { zipfile.close(); } catch {}
                  reject(e);
                }
              });
              zipfile.on('end', () => {
                try { zipfile.close(); } catch {}
                resolve({ entries, totalUncompressed });
              });
              zipfile.readEntry();
            });
          };

          const { entries } = await inspectZip(file.path);
          const projectEntries = entries
            .filter((e) => e && !e.isDirectory)
            .filter((e) => {
              const name = String(e.name || '');
              if (!name) return false;
              if (name.startsWith('__MACOSX/')) return false;
              const lower = name.toLowerCase();
              return lower.endsWith('.qgz') || lower.endsWith('.qgs');
            });

          if (projectEntries.length === 0) {
            return res.status(400).json({
              error: 'zip_missing_project',
              message: 'Zip archive must contain exactly one QGIS project (.qgz or .qgs). None found.'
            });
          }
          if (projectEntries.length > 1) {
            return res.status(400).json({
              error: 'zip_multiple_projects',
              message: 'Zip archive must contain exactly one QGIS project (.qgz or .qgs). Multiple found.',
              projects: projectEntries.map((e) => String(e.name || ''))
            });
          }

          const projectEntry = projectEntries[0];
          const relProjectPosix = path.posix.normalize(String(projectEntry.name || '').replace(/^\/+/, ''));
          const projectParts = relProjectPosix.split('/').filter(Boolean);

          await fs.promises.mkdir(targetDir, { recursive: true });
          const targetRootResolved = path.resolve(targetDir);
          const targetRootLower = targetRootResolved.toLowerCase();

          const extractZip = async (zipPath) => {
            const zipfile = await openZip(zipPath);
            return await new Promise((resolve, reject) => {
              zipfile.on('error', (e) => {
                try { zipfile.close(); } catch {}
                reject(e);
              });
              zipfile.on('entry', (entry) => {
                const rawName = String(entry.fileName || '');
                const normalized = rawName.replace(/\\/g, '/').replace(/^\/+/, '');
                const posixSafe = path.posix.normalize(normalized);
                const isDirectory = posixSafe.endsWith('/') || /\/$/.test(normalized);
                if (!posixSafe || posixSafe === '.' || posixSafe === '..') {
                  zipfile.readEntry();
                  return;
                }
                if (path.posix.isAbsolute(posixSafe) || posixSafe.startsWith('../') || posixSafe.includes('/../')) {
                  try { zipfile.close(); } catch {}
                  reject(new Error(`Unsafe zip entry path: ${rawName}`));
                  return;
                }
                if (posixSafe.startsWith('__MACOSX/')) {
                  zipfile.readEntry();
                  return;
                }

                const parts = posixSafe.split('/').filter(Boolean);
                const outPath = path.join(targetDir, ...parts);
                const outResolved = path.resolve(outPath);
                const outLower = outResolved.toLowerCase();
                if (!outLower.startsWith(targetRootLower + path.sep) && outLower !== targetRootLower) {
                  try { zipfile.close(); } catch {}
                  reject(new Error(`Zip entry escapes target directory: ${rawName}`));
                  return;
                }

                const uncompressedSize = Number(entry.uncompressedSize);
                const safeSize = Number.isFinite(uncompressedSize) && uncompressedSize >= 0 ? uncompressedSize : 0;
                if (!isDirectory && safeSize > zipEntryLimit) {
                  try { zipfile.close(); } catch {}
                  reject(new Error(`Zip entry exceeds max size (${zipEntryLimit}): ${rawName}`));
                  return;
                }

                if (isDirectory) {
                  fs.promises.mkdir(outResolved, { recursive: true })
                    .then(() => zipfile.readEntry())
                    .catch((e) => {
                      try { zipfile.close(); } catch {}
                      reject(e);
                    });
                  return;
                }

                fs.promises.mkdir(path.dirname(outResolved), { recursive: true })
                  .then(() => {
                    zipfile.openReadStream(entry, async (err, readStream) => {
                      if (err) {
                        try { zipfile.close(); } catch {}
                        reject(err);
                        return;
                      }
                      try {
                        const writeStream = fs.createWriteStream(outResolved);
                        await pipeline(readStream, writeStream);
                        zipfile.readEntry();
                      } catch (e) {
                        try { zipfile.close(); } catch {}
                        reject(e);
                      }
                    });
                  })
                  .catch((e) => {
                    try { zipfile.close(); } catch {}
                    reject(e);
                  });
              });
              zipfile.on('end', () => {
                try { zipfile.close(); } catch {}
                resolve();
              });
              zipfile.readEntry();
            });
          };

          await extractZip(file.path);

          extractedProjectPath = path.join(targetDir, ...projectParts);
          if (!fs.existsSync(extractedProjectPath)) {
            return res.status(400).json({
              error: 'zip_project_extract_failed',
              message: 'Project file listed in zip could not be extracted.'
            });
          }

          try {
            await bootstrapProjectCacheIndex(projectId, extractedProjectPath);
          } catch (bootstrapErr) {
            console.warn(`[bootstrap] Initialization failed for ${projectId}:`, bootstrapErr?.message || bootstrapErr);
          }

          return res.status(201).json({
            status: 'uploaded',
            id: projectId,
            filename: path.basename(file.originalname || 'bundle.zip'),
            kind: 'bundle',
            projectFile: path.relative(projectsDir, extractedProjectPath).replace(/\\/g, '/')
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
          try { await fs.promises.rm(targetDir, { recursive: true, force: true }); } catch {}
          return res.status(500).json({ error: 'zip_upload_failed', details: redactSecrets(String(zipErr?.message || zipErr)) });
        } finally {
          try { if (file.path) await fs.promises.unlink(file.path); } catch {}
        }
      }

      let targetName = `${projectId}${ext}`;
      let suffix = 1;
      while (fs.existsSync(path.join(projectsDir, targetName))) {
        targetName = `${projectId}_${suffix}${ext}`;
        suffix += 1;
      }
      const targetPath = path.join(projectsDir, targetName);
      try {
        if (!file.path) {
          throw new Error("temporary_upload_missing");
        }
        await fs.promises.copyFile(file.path, targetPath);
      } catch (writeErr) {
        return res.status(500).json({ error: "write_failed", details: String(writeErr) });
      } finally {
        if (file.path) {
          try {
            await fs.promises.unlink(file.path);
          } catch {
            // ignore cleanup errors
          }
        }
      }
      const finalId = targetName.replace(/\.(qgz|qgs)$/i, "");
      try {
        await bootstrapProjectCacheIndex(finalId, targetPath);
      } catch (bootstrapErr) {
        console.warn(`[bootstrap] Initialization failed for ${finalId}:`, bootstrapErr?.message || bootstrapErr);
      }
      return res.status(201).json({ status: "uploaded", id: finalId, filename: targetName });
    });
  });

  app.delete("/projects/:id", requireAdmin, (req, res) => {
    const projectId = req.params.id;
    if (!projectId) {
      return res.status(400).json({ error: "project_id_required" });
    }
    const proj = findProjectById(projectId);
    if (!proj) {
      return res.status(404).json({ error: "project_not_found" });
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

    try {
      const projectDirCandidate = path.join(projectsDir, proj.id);
      const projectDirResolved = path.resolve(projectDirCandidate);
      const projFileResolved = path.resolve(proj.file);
      const projectsRootResolved = path.resolve(projectsDir);
      const projectDirExists = fs.existsSync(projectDirCandidate) && fs.statSync(projectDirCandidate).isDirectory();
      const inProjectDir = projFileResolved.toLowerCase().startsWith(projectDirResolved.toLowerCase() + path.sep);

      if (projectDirExists && inProjectDir && projectDirResolved.toLowerCase().startsWith(projectsRootResolved.toLowerCase() + path.sep)) {
        fs.rmSync(projectDirCandidate, { recursive: true, force: true });
      } else {
        fs.unlinkSync(proj.file);
      }
    } catch (err) {
      return res.status(500).json({ error: "delete_failed", details: String(err) });
    }

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
        fs.rmSync(projectCacheDir, { recursive: true, force: true });
        cacheRemoved = true;
      } catch (err) {
        return res.status(500).json({ error: "cache_delete_failed", details: String(err) });
      }
    }

    try {
      removeProjectAccessEntry(proj.id);
    } catch (err) {
      console.error("Failed to remove project access entry", proj.id, err);
      return res.status(500).json({ error: "project_access_cleanup_failed", details: String(err?.message || err) });
    }

    try {
      purgeProjectFromAuthUsers(proj.id);
    } catch (err) {
      console.error("Failed to purge project assignment", proj.id, err);
      return res.status(500).json({ error: "project_auth_cleanup_failed", details: String(err?.message || err) });
    }

    try {
      removeProjectLogs(proj.id);
    } catch (err) {
      console.error("Failed to remove project logs", proj.id, err);
      return res.status(500).json({ error: "project_log_cleanup_failed", details: String(err?.message || err) });
    }

    return res.json({ status: "deleted", id: proj.id, cacheRemoved });
  });

  // capas por proyecto
  app.get("/projects/:id/layers", ensureProjectAccess((req) => req.params.id), (req, res) => {
    const proj = findProjectById(req.params.id);
    if (!proj) return res.status(404).json({ error: "project_not_found" });
    const script = path.join(pythonDir, "extract_info.py");
    const proc = runPythonViaOSGeo4W(script, ["--project", proj.file], {
      cwd: path.dirname(proj.file)
    });

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
    proc.on("error", (err) => {
      console.error("Failed to spawn python:", err);
      res.status(500).json({ error: "spawn_error", details: String(err) });
    });
    proc.on("close", (code) => {
      let raw = (stdout && stdout.trim()) || (stderr && stderr.trim()) || "";
      if (raw) {
        const candidate = extractJsonLike(raw);
        if (candidate) {
          try {
            const parsed = JSON.parse(candidate);
            if (code === 0) {
              return res.status(200).json(stripProjectPathsAndSecrets(parsed));
            }
            // Never echo raw stderr/stdout back to clients on failure.
            return res.status(500).json({ error: "extract_info_failed", code });
          } catch (e) {
            if (code === 0) {
              return res.status(200).json({ ok: true });
            }
            return res.status(500).json({ error: "extract_info_failed", code });
          }
        }
        if (code === 0) {
          // Unexpected non-JSON output; avoid returning it.
          return res.status(200).json({ ok: true });
        }
        return res.status(500).json({ error: "extract_info_failed", code });
      }
      if (code === 0) return res.status(200).json({ ok: true });
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

  app.patch("/projects/:id/config", requireAdmin, async (req, res) => {
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

    const patch = buildProjectConfigPatch(req.body || {});
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
  });

  app.get("/projects/:id/cache/project", ensureProjectAccess((req) => req.params.id), (req, res) => {
    const projectId = req.params.id;
    const proj = findProjectById(projectId);
    if (!proj) return res.status(404).json({ error: "project_not_found" });
    const current = projectBatchRuns.get(projectId) || null;
    const config = readProjectConfig(projectId);
    const last = config.projectCache || null;
    return res.json({ current, last });
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
        updateProjectBatchRun(projectId, { status: "running", startedAt: Date.now(), trigger: runTrigger });
        await runRecacheForProject(projectId, "manual-project", { overrideLayers, runId, requireEnabled: false });
        updateProjectBatchRun(projectId, { status: "completed", endedAt: Date.now(), result: "success", trigger: runTrigger });
        logProjectEvent(projectId, `Project cache run ${runId} completed (${layerNames.length} layers).`);
      } catch (err) {
        const message = err?.message || String(err);
        updateProjectBatchRun(projectId, { status: "error", endedAt: Date.now(), error: message, result: "error", trigger: runTrigger });
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
};
