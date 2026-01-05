/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

import fs from "fs";
import path from "path";
import multer from "multer";

const ensureUploadSubdir = (uploadTempDir, name) => {
  const dir = path.join(uploadTempDir, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

export const createDiskStorage = (uploadTempDir, subDir) => multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      const dir = ensureUploadSubdir(uploadTempDir, subDir);
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}` || `upload-${Date.now()}`;
    cb(null, unique);
  }
});

export const allowedProjectExtensions = new Set([".qgz", ".qgs"]);

export const createProjectUpload = ({ uploadTempDir, maxBytes = 209715200 } = {}) => {
  const configuredLimit = parseInt(String(maxBytes), 10);
  const fileSize = Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : 209715200;

  return multer({
    storage: createDiskStorage(uploadTempDir, "projects"),
    limits: { fileSize },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      if (!allowedProjectExtensions.has(ext)) {
        const err = new Error("unsupported_filetype");
        err.code = "UNSUPPORTED_FILETYPE";
        return cb(err);
      }
      cb(null, true);
    }
  });
};

export const allowedPluginExtensions = new Set([".zip"]);

export const createPluginUpload = ({ uploadTempDir, maxBytes = 52428800 } = {}) => {
  const configuredLimit = parseInt(String(maxBytes), 10);
  const fileSize = Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : 52428800;

  return multer({
    storage: createDiskStorage(uploadTempDir, "plugins"),
    limits: { fileSize },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      if (!allowedPluginExtensions.has(ext)) {
        const err = new Error("unsupported_plugin_archive");
        err.code = "UNSUPPORTED_PLUGIN_ARCHIVE";
        return cb(err);
      }
      cb(null, true);
    }
  });
};
