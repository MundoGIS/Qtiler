/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import express from "express";
import fs from "fs";
import path from "path";

export const registerOrigoRoutes = ({ app, publicDir }) => {
  const origoDir = path.join(publicDir, "Thirdparty", "origo");
  const origoIndex = path.join(origoDir, "index.html");

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
