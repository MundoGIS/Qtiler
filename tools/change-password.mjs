/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (C) 2025 MundoGIS.
 *
 * Interactive password reset for Qtiler auth users.
 * Usage:  node tools/change-password.mjs
 */

import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'auth.db');

const ask = (question) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
};

const main = async () => {
  if (!fs.existsSync(dbPath)) {
    console.error('Error: auth.db not found. Start the server at least once so the database is created.');
    process.exit(1);
  }

  const db = new Database(dbPath);
  const users = db.prepare('SELECT id, username, role, status FROM users ORDER BY username').all();

  if (users.length === 0) {
    console.log('No users found in the database.');
    db.close();
    process.exit(0);
  }

  console.log('\n=== Qtiler - Change User Password ===\n');
  console.log('Available users:');
  users.forEach((u, i) => {
    console.log(`  ${i + 1}. ${u.username} (role: ${u.role}, status: ${u.status})`);
  });

  const choice = await ask(`\nSelect user number (1-${users.length}): `);
  const idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= users.length) {
    console.error('Invalid selection.');
    db.close();
    process.exit(1);
  }

  const selected = users[idx];
  const newPassword = await ask(`New password for "${selected.username}" (min 6 chars): `);

  if (!newPassword || newPassword.length < 6) {
    console.error('Password must be at least 6 characters.');
    db.close();
    process.exit(1);
  }

  const hash = await bcrypt.hash(newPassword, 10);
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, now, selected.id);
  db.close();

  console.log(`\nPassword updated for "${selected.username}".`);
  console.log('Restart the server for the change to take effect on all workers.');
};

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
