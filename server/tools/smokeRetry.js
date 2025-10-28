import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BATCHES_FILE = path.join(__dirname, '../data/evidence_batches.json');
const CONFIG_FILE = path.join(__dirname, '../config/merkleManager.json');

function loadBatches() {
  try {
    if (!fs.existsSync(BATCHES_FILE)) return {};
    return JSON.parse(fs.readFileSync(BATCHES_FILE, 'utf8'));
  } catch (e) { return {}; }
}

function saveBatches(batches) {
  try {
    const dir = path.dirname(BATCHES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BATCHES_FILE, JSON.stringify(batches, null, 2));
  } catch (e) { console.warn('saveBatches failed', e); }
}

async function main() {
  // By default do NOT overwrite existing config.
  // If SAFE_SUBMIT=true is set, write a safe config (submitOnChain=false).
  try {
    const cfgDir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(cfgDir)) fs.mkdirSync(cfgDir, { recursive: true });
    if (process.env.SAFE_SUBMIT === 'true') {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({ submitOnChain: false }, null, 2));
      console.log('Wrote safe config to', CONFIG_FILE);
    } else {
      if (fs.existsSync(CONFIG_FILE)) {
        console.log('Existing config present at', CONFIG_FILE, '- not overwriting (SAFE_SUBMIT not set)');
      } else {
        console.log('No existing config found at', CONFIG_FILE, '- not creating safe config (set SAFE_SUBMIT=true to create)');
      }
    }
  } catch (e) { console.warn('Could not write config', e); }

  const batches = loadBatches();
  const caseId = `smoke-${Date.now()}`;
  const now = Date.now();
  const batch = {
    merkleRoot: `0x${Math.floor(Math.random()*1e9).toString(16)}${now.toString(16)}`,
    evidenceCount: 1,
    evidenceItems: [{ caseId, contentDigest: '0xdeadbeef', cidHash: '0xdeadbeef', uploader: 'smoke', timestamp: String(now) }],
    proofs: { '0': [] },
    timestamp: now,
    batchId: now,
    caseId,
    status: 'pending'
  };

  if (!batches[caseId]) batches[caseId] = [];
  batches[caseId].push(batch);
  saveBatches(batches);
  console.log('Inserted smoke batch for', caseId);

  // Start the retry worker
  try {
    const worker = await import('../modules/batchRetryWorker.js');
    console.log('Starting retry worker (short run)');
    worker.startRetryWorker({ intervalMs: 3000, maxRetries: 3, baseBackoffMs: 500, maxBackoffMs: 5000, jitterPct: 0.1 });

    // Let it run one interval + a little extra
    await new Promise(r => setTimeout(r, 3500));

    worker.stopRetryWorker();
    console.log('Stopped retry worker');
  } catch (e) {
    console.error('Failed to start worker:', e && e.stack ? e.stack : e);
  }

  const final = loadBatches();
  console.log('Batches after run (showing smoke case):', JSON.stringify(final[caseId], null, 2));
}

main().catch(e => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
