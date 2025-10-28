import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BATCHES_FILE = path.join(__dirname, '../data/evidence_batches.json');

function loadBatches() {
  try { if (!fs.existsSync(BATCHES_FILE)) return {}; return JSON.parse(fs.readFileSync(BATCHES_FILE,'utf8')); } catch (e) { return {}; }
}

async function main() {
  console.log('runWorkerFailMode: starting worker in fail-mode (expect submitBatch to throw)');
  try {
    const worker = await import('../modules/batchRetryWorker.js');
    worker.startRetryWorker({ intervalMs: 3000, maxRetries: 3, baseBackoffMs: 500, maxBackoffMs: 5000, jitterPct: 0.1 });

    // Let it run one interval + small buffer
    await new Promise(r => setTimeout(r, 3500));

    worker.stopRetryWorker();
    console.log('runWorkerFailMode: stopped worker');

    const batches = loadBatches();
    // Print only pending/smoke entries to keep output small
    const keys = Object.keys(batches).filter(k => k.startsWith('smoke') || (batches[k] && batches[k].some(b => b.status !== 'onchain_submitted')));
    const excerpt = {};
    for (const k of keys) excerpt[k] = batches[k];
    console.log('Batches excerpt after worker run:', JSON.stringify(excerpt, null, 2));
  } catch (e) {
    console.error('runWorkerFailMode error:', e && e.stack ? e.stack : e);
    process.exit(1);
  }
}

main();
