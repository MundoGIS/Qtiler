/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

import express from "express";
import fs from "fs";
import path from "path";

export const registerUiRoutes = ({
  app,
  security,
  renderPage,
  sendLoginPage,
  sendAccessDenied,
  requireAdminPage,
  authPluginInstallUrl,
  publicDir,
  pluginsDir
}) => {
  const authAdminUiCandidates = [
    path.join(pluginsDir, "QtilerAuth", "admin-ui"),
    path.join(pluginsDir, "qtilerauth", "admin-ui"),
    path.join(pluginsDir, "auth", "admin-ui"),
    path.join(publicDir, "auth-admin")
  ];

  const resolveAuthAdminUiDir = () => {
    for (const candidate of authAdminUiCandidates) {
      try {
        const indexPath = path.join(candidate, "index.html");
        if (fs.existsSync(indexPath)) {
          return candidate;
        }
      } catch (err) {
        console.warn("Auth admin UI path check failed", { candidate, error: String(err) });
      }
    }
    return null;
  };

  const ensureAdminForUi = (req, res, next) => {
    if (!security.isEnabled()) {
      const availableDir = resolveAuthAdminUiDir();
      const normalizedPublic = path.resolve(publicDir).toLowerCase();
      const normalizedAvailable = availableDir ? path.resolve(availableDir).toLowerCase() : null;
      if (normalizedAvailable && normalizedAvailable.startsWith(normalizedPublic)) {
        return next();
      }
      return res.status(501).send("Auth plugin is not enabled");
    }
    if (!req.user) {
      return sendLoginPage(req, res);
    }
    if (req.user.role !== "admin") {
      return sendAccessDenied(req, res);
    }
    return next();
  };

  const sendAuthAdminPage = (res) => {
    const dir = resolveAuthAdminUiDir();
    if (!dir) {
      return res.redirect('/admin');
    }
    const filePath = path.join(dir, "index.html");
    res.sendFile(filePath, (err) => {
      if (!err) return;
      console.warn("Auth admin UI load failed", { filePath, code: err?.code, message: err?.message });
      if (err.code === "ENOENT") {
        return res.redirect('/admin');
      } else {
        res.status(500).send("Failed to load auth admin UI");
      }
    });
  };

  const serveAuthAdminStatic = (req, res, next) => {
    const dir = resolveAuthAdminUiDir();
    if (!dir) {
      return res.status(501).send("Auth admin UI not installed");
    }
    const staticMiddleware = express.static(dir);
    staticMiddleware(req, res, (err) => {
      if (err && err.code === "ENOENT") {
        return res.status(404).end();
      }
      return next(err);
    });
  };

  app.get("/plugins/auth-admin", ensureAdminForUi, (_req, res) => {
    sendAuthAdminPage(res);
  });

  app.use("/plugins/auth-admin/assets", ensureAdminForUi, serveAuthAdminStatic);

  app.use("/plugins/auth-admin", ensureAdminForUi, (req, res, next) => {
    if (!req.path || req.path === "/" || req.path === "") {
      return next();
    }
    return serveAuthAdminStatic(req, res, next);
  });

  const sendPortalPage = (req, res) => {
    renderPage(req, res, "portal", { activeNav: "portal" });
  };

  app.get(["/", "/index.html"], (req, res) => {
    if (!security.isEnabled() || (req.user && req.user.role === "admin")) {
      return renderPage(req, res, "index", { activeNav: "dashboard" });
    }
    if (req.path === "/index.html") {
      return res.redirect(302, "/");
    }
    return sendPortalPage(req, res);
  });

  app.get(["/portal", "/portal.html"], (req, res) => {
    return sendPortalPage(req, res);
  });

  app.get(["/login", "/login.html"], (req, res) => {
    if (!security.isEnabled()) {
      return res.redirect(authPluginInstallUrl);
    }
    if (req.user && req.user.role === "admin") {
      return res.redirect("/index.html");
    }
    return sendLoginPage(req, res);
  });

  app.get(["/guide", "/guide.html"], (req, res) => {
    return renderPage(req, res, "guide", { activeNav: "guide" });
  });

  app.get(["/admin", "/admin.html"], requireAdminPage, (req, res) => {
    return renderPage(req, res, "admin", { activeNav: "admin" });
  });

  app.get(["/viewer", "/viewer.html"], (req, res) => {
    return renderPage(req, res, "viewer", { activeNav: "viewer" });
  });

  app.get(["/access-denied", "/access-denied.html"], (req, res) => {
    return renderPage(req, res, "access-denied", { activeNav: "dashboard" }, { status: 403 });
  });
};
