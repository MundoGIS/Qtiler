import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from '../plugins/Qtiler-3D-eye/index.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtiler-eye-preview-'));
const app = express();
app.use('/plugins/Qtiler-3D-eye/cesium', express.static(path.resolve('data/Qtiler-3D-eye/cesium/current')));
await register({ app, security: { isEnabled: () => false, requireAdmin: (_req, _res, next) => next() }, dataDir: path.join(root, 'data', 'Qtiler-3D-eye'), baseDir: path.resolve('plugins/Qtiler-3D-eye') });
app.get('/projects', (_req, res) => res.json({ projects: [] }));
app.use(express.static(path.resolve('public')));
const port = Number(process.env.QTILER_EYE_PREVIEW_PORT || 49174);
const server = app.listen(port, '127.0.0.1', () => console.log(`Isolated 3D Eye preview: http://127.0.0.1:${port}/plugins/Qtiler-3D-eye/view/?editor=1`));
const close = () => server.close(async () => { await fs.rm(root, { recursive: true, force: true }); process.exit(0); });
process.on('SIGINT', close);
process.on('SIGTERM', close);