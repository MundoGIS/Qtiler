import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = path.join(rootDir, 'public', 'QGIS-plugins', 'qtiler_connector');
const metadataPath = path.join(pluginDir, 'metadata.txt');
const metadata = fs.readFileSync(metadataPath, 'utf8');
const version = /^version=(.+)$/m.exec(metadata)?.[1]?.trim();
if (!version) throw new Error('Plugin metadata.txt must contain a version.');

const distDir = path.join(rootDir, 'dist');
const archivePath = path.join(distDir, `qtiler_connector-${version}.zip`);
const excluded = new Set(['__pycache__', '.git', '.pytest_cache']);

const addDirectory = (archive, sourceDir, archiveDir) => {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name.endsWith('.pyc')) continue;
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.posix.join(archiveDir, entry.name);
    if (entry.isDirectory()) addDirectory(archive, sourcePath, targetPath);
    else if (entry.isFile()) archive.file(sourcePath, { name: targetPath });
  }
};

fs.mkdirSync(distDir, { recursive: true });
const output = fs.createWriteStream(archivePath);
const archive = archiver('zip', { zlib: { level: 9 } });
archive.on('warning', (err) => {
  if (err.code !== 'ENOENT') throw err;
});
archive.on('error', (err) => { throw err; });
archive.pipe(output);
addDirectory(archive, pluginDir, 'qtiler_connector');
await archive.finalize();
await new Promise((resolve, reject) => {
  output.on('close', resolve);
  output.on('error', reject);
});
console.log(`Built ${path.relative(rootDir, archivePath)}`);