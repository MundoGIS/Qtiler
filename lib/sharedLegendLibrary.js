import fs from 'fs';
import path from 'path';

let initialization = null;

const readItems = async (indexPath) => {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(indexPath, 'utf8'));
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch {
    return [];
  }
};

export const initializeSharedLegendLibrary = async (dataRoot, legacyRoots = []) => {
  const root = path.join(dataRoot, 'legend-library');
  const indexPath = path.join(root, 'index.json');
  if (!initialization) {
    initialization = (async () => {
      await fs.promises.mkdir(root, { recursive: true });
      const itemsByFile = new Map();
      for (const item of await readItems(indexPath)) {
        const fileName = path.basename(String(item?.fileName || ''));
        if (fileName) itemsByFile.set(fileName, { ...item, fileName });
      }
      for (const legacyRoot of legacyRoots) {
        for (const item of await readItems(path.join(legacyRoot, 'index.json'))) {
          const fileName = path.basename(String(item?.fileName || ''));
          if (!fileName) continue;
          const sourcePath = path.join(legacyRoot, fileName);
          const targetPath = path.join(root, fileName);
          try {
            await fs.promises.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
          } catch (err) {
            if (err?.code !== 'EEXIST') continue;
          }
          if (!itemsByFile.has(fileName)) itemsByFile.set(fileName, { ...item, fileName });
        }
      }
      await fs.promises.writeFile(indexPath, JSON.stringify({ items: [...itemsByFile.values()] }, null, 2), 'utf8');
    })().catch((err) => {
      initialization = null;
      throw err;
    });
  }
  await initialization;
  return { root, indexPath };
};

const referencesFile = (value, fileName, seen = new Set()) => {
  if (typeof value === 'string') {
    try {
      const pathname = new URL(value, 'http://qtiler.local').pathname;
      return path.basename(decodeURIComponent(pathname)) === fileName;
    } catch {
      return false;
    }
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => referencesFile(entry, fileName, seen));
  return Object.values(value).some((entry) => referencesFile(entry, fileName, seen));
};

export const findSharedLegendLibraryUsage = async (dataRoot, rawFileName) => {
  const fileName = path.basename(String(rawFileName || ''));
  if (!fileName) return [];
  const profileRoots = [
    { plugin: 'Qtiler2Hajk', root: path.join(dataRoot, 'Qtiler2Hajk', 'hajk', 'published') },
    { plugin: 'Qtiler2Origo', root: path.join(dataRoot, 'Qtiler2Origo', 'origo', 'published') }
  ];
  const usage = [];
  for (const source of profileRoots) {
    const entries = await fs.promises.readdir(source.root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
      try {
        const profile = JSON.parse(await fs.promises.readFile(path.join(source.root, entry.name), 'utf8'));
        const layers = (Array.isArray(profile?.layers) ? profile.layers : [])
          .filter((layer) => referencesFile(layer, fileName))
          .map((layer) => String(layer?.title || layer?.name || '').trim())
          .filter(Boolean);
        if (layers.length) {
          usage.push({
            plugin: source.plugin,
            profileKey: String(profile.profileKey || profile.name || entry.name.replace(/\.json$/i, '')),
            name: String(profile.name || ''),
            layers
          });
        }
      } catch {
        /* skip malformed profiles */
      }
    }
  }
  return usage;
};
