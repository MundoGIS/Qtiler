/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 */

import fs from 'fs';
import path from 'path';

const clone = (value) => JSON.parse(JSON.stringify(value));

export const createJsonStore = (filePath, defaultValue = null) => {
  let mutex = Promise.resolve();

  const ensureDir = async () => {
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
  };

  const readRaw = async () => {
    try {
      const data = await fs.promises.readFile(filePath, 'utf8');
      return JSON.parse(data || 'null');
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        if (defaultValue !== null && defaultValue !== undefined) {
          const snapshot = clone(defaultValue);
          await ensureDir();
          await fs.promises.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
          return clone(defaultValue);
        }
        return null;
      }
      throw err;
    }
  };

  const writeRaw = async (value) => {
    await ensureDir();
    await fs.promises.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
  };

  const read = async () => clone(await readRaw());

  const write = async (value) => {
    await writeRaw(clone(value));
  };

  const update = async (updater) => {
    mutex = mutex.then(async () => {
      const current = await readRaw();
      const draft = clone(current);
      const next = await updater(draft);
      const output = next === undefined ? draft : next;
      await writeRaw(output);
      return clone(output);
    }).catch((err) => {
      console.error('jsonStore update failed for', filePath, err);
      throw err;
    });
    return mutex;
  };

  return { path: filePath, read, write, update };
};
