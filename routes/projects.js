import fs from "fs";
import path from "path";

export const registerProjectRoutes = ({
  app,
  crypto,
  security,
  requireAdmin,
  ensureProjectAccess,
  sanitizeProjectId,
  allowedProjectExtensions,
  projectUpload,
  projectsDir,
  cacheDir,
  tileGridDir,
  pythonDir,
  pythonExe,
  runPythonViaOSGeo4W,
  extractJsonLike,
  listProjects,
  readProjectAccessSnapshot,
  resolveProjectAccessEntry,
  deriveProjectAccess,
  isProjectPublic,
  buildProjectDescriptor,
  buildPublicProjectsListing,
  resolvePublicProject,
  findProjectById,
  bootstrapProjectCacheIndex,
  cancelProjectTimer,
  projectConfigCache,
  projectLogLastMessage,
  projectBatchCleanupTimers,
  projectBatchRuns,
  invalidateTileGridCaches,
  removeProjectAccessEntry,
  purgeProjectFromAuthUsers,
  removeProjectLogs,
  runningJobs,
  activeKeys,
  readProjectConfig,
  updateProjectConfig,
  getProjectConfigPath,
  buildProjectConfigPatch,
  deleteLayerCacheInternal,
  updateProjectBatchRun,
  runRecacheForProject,
  logProjectEvent
}) => {
  app.get("/public/projects", (_req, res) => {
    try {
      const listing = buildPublicProjectsListing();
      res.json(listing);
    } catch (err) {
      console.error("Failed to build public project listing", err);
      res.status(500).json({ error: "public_projects_failed", details: String(err?.message || err) });
    }
  });

  app.get("/public/projects/:id", (req, res) => {
    try {
      const projectId = sanitizeProjectId(req.params.id);
      if (!projectId) {
        return res.status(400).json({ error: "project_id_required" });
      }
      const descriptor = resolvePublicProject(projectId);
      if (!descriptor) {
        return res.status(404).json({ error: "project_not_found_or_private" });
      }
      res.json({ project: descriptor });
    } catch (err) {
      console.error("Failed to resolve public project", err);
      res.status(500).json({ error: "public_project_failed", details: String(err?.message || err) });
    }
  });

  app.get("/public/my-projects", (req, res) => {
    if (!security.isEnabled()) {
      return res.status(404).json({ error: "auth_plugin_disabled" });
    }
    if (!req.user) {
      return res.status(401).json({ error: "auth_required" });
    }
    try {
      const snapshot = readProjectAccessSnapshot();
      const projects = listProjects();
      const visible = [];
      for (const project of projects) {
        const accessInfo = deriveProjectAccess(snapshot, req.user, project.id);
        if (!accessInfo.allowed && req.user.role !== "admin") continue;
        const descriptor = buildProjectDescriptor(project, { snapshot, access: accessInfo });
        if (descriptor) visible.push(descriptor);
      }
      res.json({ projects: visible, generatedAt: new Date().toISOString() });
    } catch (err) {
      console.error("Failed to build user project listing", err);
      res.status(500).json({ error: "my_projects_failed", details: String(err?.message || err) });
    }
  });

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

    console.log('[/projects] Debug:', {
      totalProjects: allProjects.length,
      projectIds: allProjects.map((p) => p.id),
      accessSnapshot: accessSnapshot.projects,
      user: user ? { id: user.id, role: user.role } : null
    });

    const visibleProjects = allProjects
      .map((p) => {
        const accessConfig = resolveProjectAccessEntry(accessSnapshot, p.id) || {};
        const isPublic = accessConfig.public === true;
        const allowedRoles = Array.isArray(accessConfig.allowedRoles) ? accessConfig.allowedRoles : [];
        const allowedUsers = Array.isArray(accessConfig.allowedUsers) ? accessConfig.allowedUsers : [];

        let accessLevel = 'private';
        if (isPublic) accessLevel = 'public';
        else if (allowedRoles.includes('authenticated')) accessLevel = 'authenticated';

        return {
          ...p,
          access: accessLevel,
          isPublic,
          allowedRoles,
          allowedUsers
        };
      })
      .filter((p) => {
        if (isAdmin) return true;
        if (p.isPublic) return true;
        if (!user) return false;
        if (p.allowedRoles.includes('authenticated')) return true;
        if (p.allowedRoles.includes(user.role)) return true;
        if (p.allowedUsers.includes(user.id)) return true;
        return false;
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
      fs.unlinkSync(proj.file);
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
    const proc = runPythonViaOSGeo4W(script, ["--project", proj.file]);

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
        } else return res.status(code === 0 ? 200 : 500).json({ raw, code });
      }
      return res.status(code === 0 ? 200 : 500).json({ code, details: stderr || "no output" });
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
