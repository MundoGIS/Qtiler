import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(toolsDir, '..');
const packagers = [
  'package-Qtiler2qwc-plugin.mjs',
  'package-Qtiler2Origo-plugin.mjs',
  'package-Qtiler2Hajk-plugin.mjs',
  'package-Qtiler-3D-eye-plugin.mjs',
  'package-auth-plugin.mjs'
];

for (const packager of packagers) {
  console.log(`\n[build:plugins] ${packager}`);
  const result = spawnSync(process.execPath, [path.join(toolsDir, packager)], {
    cwd: rootDir,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${packager} exited with code ${result.status ?? 'unknown'}`);
  }
}

console.log('\n[build:plugins] All plugin packages built successfully.');
