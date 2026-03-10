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
  tileRendererPool,
  logProjectEvent,
  buildPublicProjectsListing,
  resolvePublicProject
}) => {

  const parseBool = (value, fallback = false) => {
    if (value == null) return fallback;
    if (typeof value === 'boolean') return value;
    const raw = String(value).trim().toLowerCase();
    if (!raw) return fallback;
    if (['1', 'true', 'yes', 'on', 'si', 'sí'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
    return fallback;
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

    try {
      tileRendererPool?.abortAll?.({ reason: 'project_replace' });
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

      const existingProject = findProjectById(projectId);
      const replaceExisting = parseBool(req.body?.replaceExisting ?? req.body?.overwrite, false);
      const keepExistingConfig = parseBool(req.body?.keepExistingConfig, true);
      const keepExistingCache = parseBool(req.body?.keepExistingCache, true);

      if (existingProject && !replaceExisting) {
        const lang = detectRequestLanguage(req);
        const text = conflictText(lang, projectId);
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

      if (existingProject && replaceExisting) {
        try {
          await removeExistingProjectStorage(existingProject);
          await applyReplaceRetentionPolicy(projectId, { keepExistingConfig, keepExistingCache });
        } catch (replaceErr) {
          return res.status(500).json({ error: 'replace_failed', details: redactSecrets(String(replaceErr?.message || replaceErr)) });
        }
      }

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
            projectFile: path.relative(projectsDir, extractedProjectPath).replace(/\\/g, '/'),
            replaced: Boolean(existingProject && replaceExisting),
            keepExistingConfig,
            keepExistingCache
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

      const targetName = `${projectId}${ext}`;
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
      return res.status(201).json({
        status: "uploaded",
        id: finalId,
        filename: targetName,
        replaced: Boolean(existingProject && replaceExisting),
        keepExistingConfig,
        keepExistingCache
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

  const removeWithWorkerReset = async (targetPath, { isDir = false } = {}) => {
    try {
      return await removePathWithRetries(targetPath, { isDir });
    } catch (err) {
      const code = String(err?.code || '');
      if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
        try {
          tileRendererPool?.abortAll?.({ reason: 'project_delete' });
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 500));
        return await removePathWithRetries(targetPath, { isDir });
      }
      throw err;
    }
  };

  app.delete("/projects/:id", requireAdmin, async (req, res) => {
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

    let removedProjectDir = false;
    try {
      const projectDirCandidate = path.join(projectsDir, proj.id);
      const projectDirResolved = path.resolve(projectDirCandidate);
      const projFileResolved = path.resolve(proj.file);
      const projectsRootResolved = path.resolve(projectsDir);
      const projectDirExists = fs.existsSync(projectDirCandidate) && fs.statSync(projectDirCandidate).isDirectory();
      const inProjectDir = projFileResolved.toLowerCase().startsWith(projectDirResolved.toLowerCase() + path.sep);

      if (projectDirExists && inProjectDir && projectDirResolved.toLowerCase().startsWith(projectsRootResolved.toLowerCase() + path.sep)) {
        await removeWithWorkerReset(projectDirCandidate, { isDir: true });
        removedProjectDir = true;
      } else {
        await removeWithWorkerReset(proj.file, { isDir: false });
      }

      // If the project file is inside a folder under projectsDir, remove that folder as well.
      if (!removedProjectDir) {
        const parentDir = path.dirname(projFileResolved);
        if (parentDir.toLowerCase().startsWith(projectsRootResolved.toLowerCase() + path.sep)) {
          await removeWithWorkerReset(parentDir, { isDir: true });
          removedProjectDir = true;
        }
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
        await removeWithWorkerReset(projectCacheDir, { isDir: true });
        cacheRemoved = true;
      } catch (err) {
        return res.status(500).json({ error: "cache_delete_failed", details: String(err) });
      }
    }

    // Also remove cache by file-based id if it differs (e.g., zip uploads with inner demo.qgz)
    try {
      const fileBase = path.basename(proj.file).replace(/\.(qgz|qgs)$/i, "");
      if (fileBase && fileBase !== proj.id) {
        const altCacheDir = path.join(cacheDir, fileBase);
        if (fs.existsSync(altCacheDir)) {
          await removeWithWorkerReset(altCacheDir, { isDir: true });
        }
      }
    } catch (err) {
      return res.status(500).json({ error: "cache_delete_failed", details: String(err) });
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

  app.get("/projects/:id/searchable", ensureProjectAccess((req) => req.params.id), (req, res) => {
    const projectId = sanitizeProjectId(req.params.id);
    if (!projectId) {
      return res.status(400).json({ error: "invalid_project" });
    }
    const searchableDir = path.join(process.cwd(), 'data', 'searchable-layers');
    const searchableLayersPath = path.join(searchableDir, `${projectId}.json`);
    fs.readFile(searchableLayersPath, 'utf8', (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          return res.json([]);
        }
        console.error("Failed to read searchable layers file", err);
        return res.status(500).json({ error: "read_failed" });
      }
      try {
        const layers = JSON.parse(data);
        res.json(layers);
      } catch (parseErr) {
        console.error("Failed to parse searchable layers file", parseErr);
        res.status(500).json({ error: "parse_failed" });
      }
    });
  });

  app.post("/projects/:id/searchable", requireAdmin, (req, res) => {
    const projectId = sanitizeProjectId(req.params.id);
    if (!projectId) {
      return res.status(400).json({ error: "invalid_project" });
    }
    const searchableDir = path.join(process.cwd(), 'data', 'searchable-layers');
    const searchableLayersPath = path.join(searchableDir, `${projectId}.json`);
    const updatedLayers = req.body;

    fs.mkdir(searchableDir, { recursive: true }, (dirErr) => {
      if (dirErr) {
        console.error("Failed to create searchable layers dir", dirErr);
        return res.status(500).json({ error: "dir_create_failed" });
      }

      fs.writeFile(searchableLayersPath, JSON.stringify(updatedLayers, null, 2), 'utf8', (err) => {
      if (err) {
        console.error("Failed to write searchable layers file", err);
        return res.status(500).json({ error: "write_failed" });
      }
      res.status(200).json({ status: "success" });
      });
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
