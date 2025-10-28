import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BATCHES_FILE = path.join(__dirname, '../data/evidence_batches.json');

function loadBatches() {
  if (!fs.existsSync(BATCHES_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(BATCHES_FILE,'utf8')); } catch (e) { console.warn('Failed to parse batches file', e); return {}; }
}

function saveBatches(batches) {
  try { fs.writeFileSync(BATCHES_FILE, JSON.stringify(batches, null, 2)); } catch (e) { console.error('Failed to save batches', e); }
}

function main() {
  const batches = loadBatches();
  const keys = Object.keys(batches);
  let removed = 0;
  for (const k of keys) {
    if (k && typeof k === 'string' && k.startsWith('smoke')) {
      delete batches[k];
      removed++;
    }
  }
  if (removed > 0) {
    saveBatches(batches);
    console.log(`Removed ${removed} smoke batch key(s) from ${BATCHES_FILE}`);
  } else {
    console.log('No smoke keys found. Nothing to do.');
  }
}

main();
