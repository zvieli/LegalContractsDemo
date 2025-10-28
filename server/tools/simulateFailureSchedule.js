import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BATCHES_FILE = path.join(__dirname, '../data/evidence_batches.json');

function loadBatches() {
  try { if (!fs.existsSync(BATCHES_FILE)) return {}; return JSON.parse(fs.readFileSync(BATCHES_FILE,'utf8')); } catch (e) { return {}; }
}
function saveBatches(batches) { try { fs.writeFileSync(BATCHES_FILE, JSON.stringify(batches, null, 2)); } catch (e) { console.warn('save failed', e); } }

async function main() {
  const evidenceBatch = await import('../modules/evidenceBatch.js');
  const batches = loadBatches();
  const baseBackoffMs = 500; const maxBackoffMs = 5000; const jitterPct = 0.1;
  let changed = false;
  for (const caseId of Object.keys(batches)) {
    const arr = batches[caseId] || [];
    for (let i=0;i<arr.length;i++) {
      const batch = arr[i];
      if (!batch || batch.status === 'onchain_submitted') continue;
      const attempts = batch.retryAttempts || 0;
      try {
        console.log('Attempting submit for', caseId, batch.batchId);
        await evidenceBatch.default.submitBatch(batch);
        // on success, mark accordingly
        batch.status = batch.status || 'onchain_submitted';
        changed = true;
      } catch (e) {
        console.warn('Simulated failure caught for', caseId, batch.batchId, e && e.message);
        const prevBackoff = batch.backoffMs || baseBackoffMs;
        let nextBackoff = Math.min(Math.ceil(prevBackoff * 1.8), maxBackoffMs);
        const jitter = Math.floor(nextBackoff * jitterPct * (Math.random()*2 - 1));
        nextBackoff = Math.max(1000, nextBackoff + jitter);
        batch.backoffMs = nextBackoff;
        batch.nextRetryAt = Date.now() + nextBackoff;
        batch.lastError = e && e.message ? e.message : String(e);
        batch.retryAttempts = attempts + 1;
        changed = true;
      }
    }
  }
  if (changed) saveBatches(batches);
  console.log('Done.');
}

main().catch(e=>{ console.error(e); process.exit(1); });
