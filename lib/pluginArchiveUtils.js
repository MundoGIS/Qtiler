/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

import fs from "fs";
import path from "path";
import { sanitizePluginName } from "./sanitize.js";

const readJsonIfExists = async (filePath) => {
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const resolvePluginRoot = async (dir) => {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const candidateDirs = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("__MACOSX"));
  const meaningfulFiles = entries.filter((entry) => entry.isFile() && !entry.name.startsWith("._"));
  for (const entry of candidateDirs) {
    const maybeRoot = path.join(dir, entry.name);
    try {
      await fs.promises.access(path.join(maybeRoot, "index.js"), fs.constants.R_OK);
      return maybeRoot;
    } catch {
      // continue exploring other directories
    }
  }
  if (candidateDirs.length === 1 && meaningfulFiles.length === 0) {
    return path.join(dir, candidateDirs[0].name);
  }
  return dir;
};

export const detectPluginName = async (rootDir, fallbackName = "") => {
  const candidates = [];
  const pluginManifest = await readJsonIfExists(path.join(rootDir, "plugin.json"));
  if (pluginManifest?.name) candidates.push(pluginManifest.name);
  const packageJson = await readJsonIfExists(path.join(rootDir, "package.json"));
  if (packageJson?.name) candidates.push(packageJson.name);
  if (fallbackName) candidates.push(fallbackName);
  for (const candidate of candidates) {
    const sanitized = sanitizePluginName(candidate);
    if (sanitized) return sanitized;
  }
  return null;
};
