import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';
import { uploadPayload } from '../lib/heliaUploader.js';

async function run() {
  const rpc = process.env.RPC_URL || 'http://127.0.0.1:8545';
  const provider = new ethers.JsonRpcProvider(rpc);
  // Use repo-root-relative path (process.cwd() is expected to be repo root)
  const deployPath = path.join(process.cwd(), 'front', 'src', 'utils', 'contracts', 'deployment-summary.json');
  let contractAddress = null;
  try {
    const ds = JSON.parse(fs.readFileSync(deployPath, 'utf8'));
    contractAddress = ds.contracts && ds.contracts.EnhancedRentContract;
  } catch (e) {
    console.warn('deployment-summary not found or invalid, skipping contract tests');
  }

  console.log('Server-side history collection disabled; use frontend collectTransactionHistory for client-side history collection.');

  // heliaUploader checks
  console.log('Running heliaUploader checks');
  try {
    const small = 'small-payload-' + Date.now();
    const r1 = await uploadPayload(small, { name: 'test_small' });
    console.log('small upload result:', r1.uri || r1.path || r1.cid);

    // create large payload ~1.2MB to force chunking (DEFAULT_CHUNK_SIZE=512KB)
    const largeBuffer = Buffer.alloc(1024 * 1024 * 1 + 200 * 1024, 'a');
    const r2 = await uploadPayload(largeBuffer, { name: 'test_large' });
    console.log('large upload result uri:', r2.uri || r2.path || r2.cid);
    if (r2.manifest) console.log('manifest parts:', r2.manifest.parts && r2.manifest.parts.length);
  } catch (e) {
    console.error('heliaUploader error:', e && e.message);
  }
}

run().then(()=>process.exit(0)).catch(e=>{console.error(e); process.exit(1)});
