import fs from 'fs';
import path from 'path';
import evidenceBatchModule from './evidenceBatch.js';

const BATCHES_FILE = path.join(path.dirname(new URL(import.meta.url).pathname), '../data/evidence_batches.json');

let intervalHandle = null;
let processing = new Set();

function jsonSafeReplacer(key, value) {
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value === 'object' && value._isBigNumber) {
    try { return value.toString(); } catch (e) { return String(value); }
  }
  if (typeof value === 'object' && value !== null) {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value.toString('hex');
    if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  }
  return value;
}

function loadBatches() {
  try {
    if (!fs.existsSync(BATCHES_FILE)) return {};
    return JSON.parse(fs.readFileSync(BATCHES_FILE, 'utf8'));
  } catch (e) { 
    console.warn('batchRetryWorker.loadBatches failed:', e?.message || e);
    return {}; 
  }
}

function saveBatches(batches) {
  try {
    const dir = path.dirname(BATCHES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BATCHES_FILE, JSON.stringify(batches, null, 2));
  } catch (e) { 
    console.warn('batchRetryWorker.saveBatches failed:', e?.message || e); 
  }
}

function now() { return Date.now(); }

async function attemptSubmit(batch, key) {
  try {
    console.log(`batchRetryWorker: attempting submit ${key}`);
    const updated = await evidenceBatchModule.submitBatch(batch);
    return { success: true, updated };
  } catch (err) {
    return { success: false, error: err };
  }
}

async function runOnce(opts = {}) {
  const {
    maxRetries = 5,
    baseBackoffMs = 2000,
    maxBackoffMs = 60000,
    jitterPct = 0.2
  } = opts;
  
  const batches = loadBatches();
  let changed = false;
  
  for (const caseId of Object.keys(batches)) {
    const arr = batches[caseId] || [];
    for (let i = 0; i < arr.length; i++) {
      const batch = arr[i] || {};
      const id = batch.batchId || batch.merkleRoot || batch.timestamp || i;
      const key = `${caseId}:${id}`;
      
      if (processing.has(key)) continue;
      if (batch.status === 'onchain_submitted') continue;
      
      const attempts = batch.retryAttempts || 0;
      if (attempts >= maxRetries) {
        if (batch.status !== 'retry_failed') {
          batch.status = 'retry_failed';
          batch.lastError = batch.lastError || 'max_retries_exceeded';
          changed = true;
        }
        continue;
      }
      
      if (batch.nextRetryAt && Number(batch.nextRetryAt) > now()) continue;

      processing.add(key);
      try {
        batch.retryAttempts = attempts + 1;
        const attemptRes = await attemptSubmit(batch, key);
        
        if (attemptRes.success) {
          arr[i] = JSON.parse(JSON.stringify(attemptRes.updated, jsonSafeReplacer));
          changed = true;
          console.log(`batchRetryWorker: submit successful ${key}`);
        } else {
          const err = attemptRes.error;
          const errMsg = err?.message || String(err);
          console.warn(`batchRetryWorker: submit failed for ${key}: ${errMsg}`);
          
          const prevBackoff = batch.backoffMs || baseBackoffMs;
          let nextBackoff = Math.min(Math.ceil(prevBackoff * 1.8), maxBackoffMs);
          const jitter = Math.floor(nextBackoff * jitterPct * (Math.random() * 2 - 1));
          nextBackoff = Math.max(1000, nextBackoff + jitter);
          
          batch.backoffMs = nextBackoff;
          batch.nextRetryAt = now() + nextBackoff;
          batch.lastError = errMsg;
          arr[i] = JSON.parse(JSON.stringify(batch, jsonSafeReplacer));
          changed = true;
          console.log(`batchRetryWorker: scheduled next retry for ${key} in ${nextBackoff}ms`);
        }
      } finally {
        processing.delete(key);
      }
    }
  }
  
  if (changed) saveBatches(batches);
}

export function startRetryWorker({ 
  intervalMs = 15000, 
  maxRetries = 5, 
  baseBackoffMs = 2000, 
  maxBackoffMs = 60000, 
  jitterPct = 0.2 
} = {}) {
  if (intervalHandle) return;
  
  console.log('batchRetryWorker: starting', { 
    intervalMs, maxRetries, baseBackoffMs, maxBackoffMs, jitterPct 
  });
  
  runOnce({ maxRetries, baseBackoffMs, maxBackoffMs, jitterPct })
    .catch(e => console.warn('batchRetryWorker initial run failed:', e?.message || e));
  
  intervalHandle = setInterval(() => {
    runOnce({ maxRetries, baseBackoffMs, maxBackoffMs, jitterPct })
      .catch(e => console.warn('batchRetryWorker run failed:', e?.message || e));
  }, intervalMs);
}

export function stopRetryWorker() {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  processing.clear();
  console.log('batchRetryWorker: stopped');
}

export default { startRetryWorker, stopRetryWorker };