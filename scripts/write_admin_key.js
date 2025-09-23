#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const outPath = process.argv[2] || process.env.ADMIN_PRIVATE_KEY_FILE || './admin.key';
const key = process.argv[3] || process.env.ADMIN_PRIVATE_KEY;

if (!key) {
  console.error('No key provided. Pass as first arg or set ADMIN_PRIVATE_KEY env var.');
  process.exit(2);
}

const abs = path.resolve(process.cwd(), outPath);
fs.writeFileSync(abs, key + '\n', { mode: 0o600 });
console.log(`Wrote admin key to ${abs} with mode 600`);
