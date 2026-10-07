import Database from 'better-sqlite3';

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 22 || nodeMajor >= 25) {
  console.error(`Unsupported runtime ${process.version}. Qtiler requires Node.js 22 or 24 LTS.`);
  process.exit(1);
}

try {
  const database = new Database(':memory:');
  try {
    database.prepare('SELECT 1 AS ok').get();
  } finally {
    database.close();
  }
  console.log(`Qtiler runtime ready: Node.js ${process.version}, SQLite available.`);
} catch (err) {
  console.error('SQLite binding is unavailable. Run npm rebuild better-sqlite3 with a supported Node.js runtime.');
  console.error(err.message);
  process.exit(1);
}