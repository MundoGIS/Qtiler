import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, '..');
const uiPath = path.join(root, 'admin-ui', 'app.js');
const walkDir = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...walkDir(full));
    else files.push(full);
  }
  return files;
};

function extractUsedKeys(dir) {
  const files = walkDir(dir).filter(f => f.endsWith('.js') || f.endsWith('.html'));
  const keyRe = /t\(\s*['\"]Qtiler2Origo\.([^'\"]+)['\"]\s*\)/g;
  const used = new Set();
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = keyRe.exec(txt)) !== null) used.add(m[1]);
  }
  return used;
}

function extractLangBlock(content, lang) {
  const blockRe = new RegExp(`${lang}\\s*:\\s*{([\\s\\S]*?)}\\s*,\\s*\\w+:`);
  const m = blockRe.exec(content);
  if (m) return m[1];
  // fallback: try until end of QTWC_I18N
  const blockRe2 = new RegExp(`${lang}\\s*:\\s*{([\\s\\S]*?)}`);
  const m2 = blockRe2.exec(content);
  return m2 ? m2[1] : '';
}

function extractDefinedKeys(block) {
  const defRe = /['\"]Qtiler2Origo\.([^'\"]+)['\"]\s*:/g;
  const defs = new Set();
  let m;
  while ((m = defRe.exec(block)) !== null) defs.add(m[1]);
  return defs;
}

function main() {
  if (!fs.existsSync(uiPath)) {
    console.error('admin-ui/app.js not found at', uiPath);
    process.exit(2);
  }
  const ui = fs.readFileSync(uiPath, 'utf8');
  const enBlock = extractLangBlock(ui, 'en');
  const esBlock = extractLangBlock(ui, 'es');
  const svBlock = extractLangBlock(ui, 'sv');
  const enDefs = extractDefinedKeys(enBlock);
  const esDefs = extractDefinedKeys(esBlock);
  const svDefs = extractDefinedKeys(svBlock);

  const used = extractUsedKeys(root);

  const missingEn = [];
  const missingEs = [];
  const missingSv = [];

  for (const k of Array.from(used).sort()) {
    if (!enDefs.has(k)) missingEn.push(k);
    if (!esDefs.has(k)) missingEs.push(k);
    if (!svDefs.has(k)) missingSv.push(k);
  }

  console.log('Used keys:', used.size);
  console.log('Defined en:', enDefs.size, 'es:', esDefs.size, 'sv:', svDefs.size);
  console.log('\nMissing in en (count ' + missingEn.length + '):\n', missingEn.join('\n'));
  console.log('\nMissing in es (count ' + missingEs.length + '):\n', missingEs.join('\n'));
  console.log('\nMissing in sv (count ' + missingSv.length + '):\n', missingSv.join('\n'));
}

main();
