/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import express from "express";
import fs from "fs";
import path from "path";

export const registerOrigoRoutes = ({ app, publicDir, requireAdmin, tileRendererPool, findProjectById }) => {
  const origoDir = path.join(publicDir, "Thirdparty", "origo");
  const origoIndex = path.join(origoDir, "index.html");
  const origoIndexJson = path.join(origoDir, "index.json");
  const ensureAdmin = typeof requireAdmin === "function" ? requireAdmin : (_req, _res, next) => next();

  const ensureOrigoInstalled = (_req, res, next) => {
    try {
      if (!fs.existsSync(origoIndex)) {
        return res.status(404).send("Origo is not installed in public/Thirdparty/origo");
      }
    } catch (err) {
      console.warn("Failed to validate Origo directory", { error: String(err?.message || err) });
      return res.status(500).send("Failed to validate Origo directory");
    }
    next();
  };

  const router = express.Router();

  router.get("/wfs-attributes", ensureOrigoInstalled, ensureAdmin, async (req, res) => {
    try {
      const projectId = String(req.query.project || '').trim();
      const layerName = String(req.query.layer || '').trim();
      if (!projectId || !layerName) {
        return res.status(400).json({ error: 'invalid_query', message: 'project and layer are required' });
      }
      if (!tileRendererPool || typeof tileRendererPool.renderTile !== 'function' || typeof findProjectById !== 'function') {
        return res.status(503).json({ error: 'worker_unavailable' });
      }
      const proj = findProjectById(projectId);
      if (!proj || !proj.file) {
        return res.status(404).json({ error: 'project_not_found' });
      }
      const result = await tileRendererPool.renderTile({
        action: 'wfs_attributes',
        project_path: proj.file,
        type_name: layerName
      });
      if (!result || result.status !== 'success') {
        return res.status(500).json({ error: 'attributes_failed', details: result?.message || result?.error || 'unknown' });
      }
      return res.json({ ok: true, attributes: Array.isArray(result.attributes) ? result.attributes : [] });
    } catch (err) {
      return res.status(500).json({ error: 'attributes_failed', details: String(err?.message || err) });
    }
  });

  router.post("/index.json/wfs-layer", ensureOrigoInstalled, ensureAdmin, async (req, res) => {
    try {
      if (!fs.existsSync(origoIndexJson)) {
        return res.status(404).json({ error: "origo_index_missing" });
      }

      const body = req.body || {};
      const projectId = String(body.projectId || "").trim();
      const layerName = String(body.layerName || "").trim();
      if (!projectId || !layerName) {
        return res.status(400).json({ error: "invalid_payload", message: "projectId and layerName are required" });
      }

      const layerTitle = String(body.layerTitle || layerName).trim() || layerName;
      const groupName = String(body.groupName || projectId).trim() || projectId;
      const groupTitle = String(body.groupTitle || groupName).trim() || groupName;
      const sourceName = String(body.sourceName || `Qtiler_${projectId}`).trim() || `Qtiler_${projectId}`;
      const geometryName = body.geometryName != null ? String(body.geometryName).trim() : null;
      const featureType = body.featureType != null ? String(body.featureType).trim() : null;
      const attribution = body.attribution != null ? String(body.attribution) : null;
      const style = body.style != null ? String(body.style) : "add me";

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const sourceUrl = String(body.url || `${baseUrl}/wfs?project=${encodeURIComponent(projectId)}`).trim();
      const wantsEditable = body.editable === true;
      const workspace = body.workspace != null
        ? String(body.workspace)
        : (wantsEditable ? `${baseUrl}/qtiler/${projectId}` : null);

      let index;
      try {
        index = JSON.parse(fs.readFileSync(origoIndexJson, "utf8"));
      } catch (err) {
        return res.status(500).json({ error: "origo_index_parse_failed", details: String(err?.message || err) });
      }

      if (!index || typeof index !== "object") index = {};
      if (!index.source || typeof index.source !== "object") index.source = {};
      if (!Array.isArray(index.layers)) index.layers = [];
      if (!Array.isArray(index.groups)) index.groups = [];

      const sourceEntry = {
        url: sourceUrl,
        type: "WFS"
      };
      if (workspace) sourceEntry.workspace = workspace;
      index.source[sourceName] = {
        ...(index.source[sourceName] || {}),
        ...sourceEntry
      };

      if (groupName) {
        const groupExists = index.groups.some((g) => g && String(g.name || "").trim() === groupName);
        if (!groupExists) {
          index.groups.push({
            name: groupName,
            title: groupTitle,
            expanded: true
          });
        }
      }

      const layerEntry = {
        name: layerName,
        title: layerTitle,
        queryable: true,
        visible: false,
        type: "WFS",
        group: groupName,
        attribution: attribution || undefined,
        source: sourceName,
        style: style || undefined
      };

      if (featureType) layerEntry.featureType = featureType;
      if (geometryName) layerEntry.geometryName = geometryName;

      if (wantsEditable) {
        layerEntry.editable = true;
        if (tileRendererPool && typeof tileRendererPool.renderTile === 'function' && typeof findProjectById === 'function') {
          const proj = findProjectById(projectId);
          if (!proj || !proj.file) {
            return res.status(404).json({ error: "project_not_found" });
          }
          try {
            const attrsResult = await tileRendererPool.renderTile({
              action: 'wfs_attributes',
              project_path: proj.file,
              type_name: layerName
            });
            if (attrsResult && attrsResult.status === 'success' && Array.isArray(attrsResult.attributes)) {
              layerEntry.attributes = attrsResult.attributes;
            }
          } catch (err) {
            return res.status(500).json({ error: "attributes_failed", details: String(err?.message || err) });
          }
        }
      }

      const existingIndex = index.layers.findIndex((l) => l && String(l.name || "").trim() === layerName);
      if (existingIndex >= 0) {
        index.layers[existingIndex] = { ...index.layers[existingIndex], ...layerEntry };
      } else {
        const insertBeforeIndex = index.layers.findIndex((l) => l && String(l.group || "").trim() === "background");
        if (insertBeforeIndex >= 0) {
          index.layers.splice(insertBeforeIndex, 0, layerEntry);
        } else {
          index.layers.push(layerEntry);
        }
      }

      try {
        fs.writeFileSync(origoIndexJson, JSON.stringify(index, null, 2), "utf8");
      } catch (err) {
        return res.status(500).json({ error: "origo_index_write_failed", details: String(err?.message || err) });
      }

      return res.json({
        ok: true,
        projectId,
        layer: layerName,
        source: sourceName,
        group: groupName
      });
    } catch (err) {
      return res.status(500).json({ error: "origo_index_update_failed", details: String(err?.message || err) });
    }
  });

  router.get(["/", "/index.html"], ensureOrigoInstalled, (_req, res) => {
    res.sendFile(origoIndex);
  });

  const serveOrigoStatic = express.static(origoDir, { index: false });
  router.use(ensureOrigoInstalled, (req, res, next) => {
    serveOrigoStatic(req, res, (err) => {
      if (err && err.code === "ENOENT") {
        return res.status(404).end();
      }
      return next(err);
    });
  });

  app.use("/origo", router);
};
