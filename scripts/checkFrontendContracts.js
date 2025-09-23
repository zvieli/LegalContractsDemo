#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getFrontendContractsDir = require('./getFrontendContractsDir');
const dir = getFrontendContractsDir();
if (!fs.existsSync(dir)) {
  console.error('Frontend contracts dir not found:', dir);
  process.exit(2);
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
if (files.length === 0) {
  console.error('No JSON files found in frontend contracts dir');
  process.exit(2);
}

let errors = 0;
for (const f of files) {
  const p = path.join(dir, f);
  try {
    const content = fs.readFileSync(p, 'utf8');
    JSON.parse(content);
    console.log('OK:', f);
  } catch (err) {
    console.error('INVALID JSON:', f, err.message);
    errors++;
  }
}

if (errors > 0) {
  console.error(`Found ${errors} invalid JSON files`);
  process.exit(3);
}

console.log('Frontend contracts check passed');
process.exit(0);
