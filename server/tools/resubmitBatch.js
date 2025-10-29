import fs from 'fs';
import path from 'path';
import evidenceBatch from '../modules/evidenceBatch.js';

async function main() {
  const arg = process.argv[2];
  const caseId = arg || process.env.BATCH_CASE_ID || 'smoke-real-1761693397706';
  const DATA_FILE = path.join(new URL(import.meta.url).pathname.replace(/(^[A-Za-z]:)?/,'').replace(/\\/g,'/'), '..', '..', 'server', 'data', 'evidence_batches.json');

  // better to locate relative to repo
  const altDataFile = path.resolve(process.cwd(), 'server', 'data', 'evidence_batches.json');
  const filePath = fs.existsSync(altDataFile) ? altDataFile : DATA_FILE;

  if (!fs.existsSync(filePath)) {
    console.error('evidence_batches.json not found at', filePath);
    process.exit(2);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const batches = JSON.parse(raw);
  const caseBatches = batches[caseId];
  if (!caseBatches || caseBatches.length === 0) {
    console.error('No batches found for caseId', caseId);
    process.exit(3);
  }

  // find the first pending batch (status !== onchain_submitted)
  const pending = caseBatches.find(b => b.status !== 'onchain_submitted' && (!b.txHash || b.status === 'pending')) || caseBatches[caseBatches.length - 1];
  if (!pending) {
    console.error('No pending batch found for', caseId);
    process.exit(4);
  }

  console.log('Attempting resubmit for caseId', caseId, 'batchId', pending.batchId, 'current status', pending.status);

  try {
    const updated = await evidenceBatch.submitBatch(pending);
    console.log('submitBatch returned:', updated);

    // Persist change back into file
  batches[caseId] = caseBatches.map(b => (b.batchId === pending.batchId ? JSON.parse(JSON.stringify(updated)) : b));
  // Serialize BigInt values as strings to avoid write errors
  const safeStringify = (obj) => JSON.stringify(obj, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
  fs.writeFileSync(filePath, safeStringify(batches));
    console.log('Persisted updated batches to', filePath);
  } catch (err) {
    console.error('submitBatch failed:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

main();
