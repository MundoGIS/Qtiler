import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, '..');
const uiPath = path.join(root, 'admin-ui', 'app.js');
const htmlPath = path.join(root, 'admin-ui', 'index.html');

const PLUGIN_PREFIX = 'QtilerStories';

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

// Keys used via t('QtilerStories.xxx') in JS, plus data-i18n="QtilerStories.xxx"
// and data-i18n-placeholder in HTML.
function extractUsedKeys(dir) {
  const files = walkDir(dir).filter(f => f.endsWith('.js') || f.endsWith('.html'));
  const patterns = [
    new RegExp(`t\\(\\s*['"]${PLUGIN_PREFIX}\\.([^'"]+)['"]\\s*[,)]`, 'g'),
    new RegExp(`data-i18n(?:-placeholder)?="${PLUGIN_PREFIX}\\.([^"]+)"`, 'g')
  ];
  const used = new Set();
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    for (const re of patterns) {
      let m;
      while ((m = re.exec(txt)) !== null) used.add(m[1]);
    }
  }
  return used;
}

function extractLangBlock(content, lang) {
  const blockRe = new RegExp(`${lang}\\s*:\\s*{([\\s\\S]*?)}\\s*,\\s*\\w+:`);
  const m = blockRe.exec(content);
  if (m) return m[1];
  const blockRe2 = new RegExp(`${lang}\\s*:\\s*{([\\s\\S]*?)}`);
  const m2 = blockRe2.exec(content);
  return m2 ? m2[1] : '';
}

function extractDefinedKeys(block) {
  const defRe = new RegExp(`['"]${PLUGIN_PREFIX}\\.([^'"]+)['"]\\s*:`, 'g');
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
  const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
  const combined = ui + '\n' + html;

  const enBlock = extractLangBlock(ui, 'en');
  const esBlock = extractLangBlock(ui, 'es');
  const svBlock = extractLangBlock(ui, 'sv');
  const enDefs = extractDefinedKeys(enBlock);
  const esDefs = extractDefinedKeys(esBlock);
  const svDefs = extractDefinedKeys(svBlock);

  const used = extractUsedKeys(path.join(root, 'admin-ui'));

  const missingEn = [...used].filter(k => !enDefs.has(k));
  const missingEs = [...used].filter(k => !esDefs.has(k));
  const missingSv = [...used].filter(k => !svDefs.has(k));

  console.log(`Used keys: ${used.size}`);
  console.log(`Defined en: ${enDefs.size} es: ${esDefs.size} sv: ${svDefs.size}`);
  console.log('\nMissing in en (count ' + missingEn.length + '):');
  missingEn.forEach(k => console.log('  -', k));
  console.log('\nMissing in es (count ' + missingEs.length + '):');
  missingEs.forEach(k => console.log('  -', k));
  console.log('\nMissing in sv (count ' + missingSv.length + '):');
  missingSv.forEach(k => console.log('  -', k));

  // Also report keys defined but never used (dead translations)
  const unusedEn = [...enDefs].filter(k => !used.has(k));
  if (unusedEn.length) {
    console.log('\nDefined but never used (en, count ' + unusedEn.length + '):');
    unusedEn.forEach(k => console.log('  -', k));
  }
}

main();
