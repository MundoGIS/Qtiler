import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { registerOrigoRoutes } from '../routes/origo.js';

test('Origo retries empty WFS attribute results and caches the first complete result', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtiler-origo-attributes-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const origoDir = path.join(root, 'Thirdparty', 'origo');
  await fs.mkdir(origoDir, { recursive: true });
  await fs.writeFile(path.join(origoDir, 'index.html'), '<!doctype html>');

  let calls = 0;
  const app = express();
  registerOrigoRoutes({
    app,
    publicDir: root,
    requireAdmin: (_req, _res, next) => next(),
    findProjectById: (projectId) => projectId === 'fixture' ? { file: 'fixture.qgz' } : null,
    tileRendererPool: {
      renderTile: async () => {
        calls += 1;
        return {
          status: 'success',
          attributes: calls === 1
            ? []
            : [{ name: 'name', type: 'text' }, { name: 'district', type: 'text' }, { name: 'geometry', type: 'geometry' }]
        };
      }
    }
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/origo/wfs-attributes?project=fixture&layer=parks`;

  const first = await fetch(url).then((response) => response.json());
  assert.deepEqual(first.attributes, []);
  const second = await fetch(url).then((response) => response.json());
  assert.deepEqual(second.attributes.map((attribute) => attribute.name), ['name', 'district', 'geometry']);
  assert.equal(second.cached, undefined);
  const third = await fetch(url).then((response) => response.json());
  assert.equal(third.cached, true);
  assert.equal(calls, 2);
});

test('QtilerAuth admin page does not poll the parent language every second', async () => {
  const html = await fs.readFile('plugins/QtilerAuth/admin-ui/index.html', 'utf8');
  assert.doesNotMatch(html, /setInterval\(syncLang/);
  assert.match(html, /qtilerLang\?\.subscribe\?\.\(syncLang\)/);
  assert.match(html, /addEventListener\('visibilitychange'/);
});
