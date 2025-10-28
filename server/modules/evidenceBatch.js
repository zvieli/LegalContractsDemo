// evidenceBatch.js
// Backend module for batch management and Merkle proof generation
// Uses MerkleEvidenceHelper for batch creation, root/proof computation
// Persists batches in a local JSON file for reliability

import fs from 'fs';
import path from 'path';
import { MerkleEvidenceHelper } from '../../utils/merkleEvidenceHelper.js';

// Helper: JSON-safe replacer to convert BigInt and other non-serializable values
function jsonSafeReplacer(key, value) {
  if (typeof value === 'bigint') return value.toString();
  // ethers BigNumber handling
  if (value && typeof value === 'object' && value._isBigNumber) {
    try { return value.toString(); } catch (e) { return String(value); }
  }
  if (typeof value === 'object' && value !== null) {
    // convert Buffer/Uint8Array to hex
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value.toString('hex');
    if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  }
  return value;
}

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BATCHES_FILE = path.join(__dirname, '../data/evidence_batches.json');

function loadBatches() {
  try {
    if (!fs.existsSync(BATCHES_FILE)) return {};
    const raw = fs.readFileSync(BATCHES_FILE, 'utf8');
    try {
      const parsed = JSON.parse(raw);
      // If file contains an array (legacy) or non-object, coerce to empty object
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return parsed;
    } catch (e) {
      console.warn('evidenceBatch.loadBatches JSON parse failed, returning empty:', e && e.message ? e.message : e);
      return {};
    }
  } catch (e) {
    console.warn('evidenceBatch.loadBatches failed, returning empty:', e && e.message ? e.message : e);
    return {};
  }
}

function saveBatches(batches) {
  try {
    const dir = path.dirname(BATCHES_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(BATCHES_FILE, JSON.stringify(batches, null, 2));
  } catch (e) {
    console.error('evidenceBatch.saveBatches failed:', e && e.stack ? e.stack : e);
    // don't throw - persist failure should not crash batch creation
  }
}

// Submit an existing batchData to the configured on-chain MerkleEvidenceManager
async function submitBatch(batchData) {
  // Fail-mode for smoke testing the retry worker: set BATCH_RETRY_FAILMODE=true
  // to force submitBatch to throw and exercise the worker's backoff scheduling.
  try {
    if (process.env.BATCH_RETRY_FAILMODE === 'true') {
      throw new Error('simulated submit failure (BATCH_RETRY_FAILMODE)');
    }
  } catch (e) {
    // allow the normal error handling below to capture this
    throw e;
  }
  const ethersModule = await import('ethers');
  // Try multiple config locations for backward compatibility
  const candidates = [
    path.join(__dirname, '../config/merkleManager.json'),
    path.join(__dirname, '../config/MerkleEvidenceManager.json'),
    path.join(__dirname, '../config/contracts/MerkleEvidenceManager.json')
  ];
  let config = null;
  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      try { config = JSON.parse(fs.readFileSync(cand, 'utf8')); break; } catch (e) { /* ignore parse errors */ }
    }
  }
  const rpcFallback = process.env.RPC_URL || process.env.HARDHAT_RPC_URL || 'http://127.0.0.1:8545';
  if (config) {
    if (!config.rpcUrl && !config.rpc) config.rpcUrl = rpcFallback;
    if (!config.abi && config.abiRaw) config.abi = config.abiRaw;
  }
  const submitOnChain = config && typeof config.submitOnChain !== 'undefined' ? !!config.submitOnChain : true;
  if (!submitOnChain) {
    console.log('evidenceBatch.submitBatch: submitOnChain=false in config, skipping on-chain submit');
    return batchData;
  }
  if (!config || !config.address || !config.abi || !(config.rpcUrl || config.rpc)) {
    batchData.status = batchData.status || 'pending';
    batchData.txError = batchData.txError || 'no_valid_merkle_config';
    return batchData;
  }

  const provider = new ethersModule.JsonRpcProvider(config.rpcUrl || config.rpc);
  let signer = null;
  try {
    const cfgKey = config && config.privateKey;
    const envKey = process.env.MERKLE_PRIVATE_KEY;
    const pk = (cfgKey && cfgKey !== '0x...') ? cfgKey : (envKey && envKey !== '0x...' ? envKey : null);
    if (pk && typeof pk === 'string' && pk !== '') {
      try { signer = new ethersModule.Wallet(pk, provider); } catch (e) { signer = null; }
    } else {
      try { signer = provider.getSigner ? provider.getSigner(0) : null; } catch (e) { signer = null; }
    }
  } catch (e) { signer = null; }

  // Ensure a rootSignature exists (sign if possible)
  try {
    if (!batchData.rootSignature && signer && typeof signer.signMessage === 'function') {
      const arrayify = ethersModule.utils?.arrayify || ethersModule.arrayify;
      try {
        if (typeof arrayify === 'function') batchData.rootSignature = await signer.signMessage(arrayify(batchData.merkleRoot));
        else batchData.rootSignature = await signer.signMessage(ethersModule.toUtf8Bytes(String(batchData.merkleRoot)));
      } catch (e) {
        try { batchData.rootSignature = await signer.signMessage(ethersModule.toUtf8Bytes(String(batchData.merkleRoot))); } catch (e2) { batchData.rootSignature = '0x' + '00'.repeat(65); }
      }
    }
  } catch (e) { batchData.rootSignature = batchData.rootSignature || ('0x' + '00'.repeat(65)); }
  if (!batchData.rootSignature) batchData.rootSignature = '0x' + '00'.repeat(65);

  try {
    const contract = new ethersModule.Contract(config.address, config.abi, provider);
    const contractWithSigner = signer ? contract.connect(signer) : null;
    if (contractWithSigner && typeof contractWithSigner.submitEvidenceBatch === 'function') {
      let attempts = 0; let lastErr = null;
      const maxAttempts = 4;
      while (attempts < maxAttempts) {
        attempts++;
        try {
          const tx = await contractWithSigner.submitEvidenceBatch(batchData.merkleRoot, batchData.evidenceCount);
          const receipt = await tx.wait();
          batchData.txHash = tx.hash;
          batchData.status = 'onchain_submitted';
          batchData.txReceipt = receipt;
          lastErr = null;
          break;
        } catch (innerErr) {
          lastErr = innerErr;
          const msg = innerErr && (innerErr.message || innerErr.toString());
          const isNonceError = (innerErr && innerErr.code === 'NONCE_EXPIRED') || (typeof msg === 'string' && /nonce/i.test(msg));
          const isTempRpc = (innerErr && innerErr.code === 'SERVER_ERROR') || (typeof msg === 'string' && (/timeout|connection|503|429/i.test(msg)));
          if (isNonceError || isTempRpc) {
            const backoff = 200 * Math.pow(2, attempts - 1);
            await new Promise(r => setTimeout(r, backoff));
            continue;
          }
          break;
        }
      }
      if (lastErr) { batchData.status = 'pending'; batchData.txError = lastErr.message || String(lastErr); }
      if (batchData.txHash) {
        try {
          const maxPolls = 6; let polled = 0;
          while (polled < maxPolls) {
            try {
              const batchIdOnChain = await contract.getBatchIdByRoot(batchData.merkleRoot);
              if (batchIdOnChain && String(batchIdOnChain) !== '0' && Number(batchIdOnChain) !== 0) { batchData.batchIdOnChain = batchIdOnChain; break; }
            } catch (e) {}
            polled++;
            await new Promise(r => setTimeout(r, 300));
          }
        } catch (e) {}
      }
    } else { batchData.status = 'pending'; batchData.txError = 'submitEvidenceBatch not available on contract ABI'; }
  } catch (e) { batchData.status = 'pending'; batchData.txError = e && e.message ? e.message : String(e); }

  return batchData;
}

// Create and persist a batch for a given caseId
async function createBatch(caseId, evidenceItems) {
  console.log('createBatch called for caseId=', caseId, 'evidenceItems.length=', Array.isArray(evidenceItems) ? evidenceItems.length : typeof evidenceItems);
  try {
    if (!Array.isArray(evidenceItems)) throw new Error('evidenceItems must be an array');
    // Log summary of first item for debugging
    if (evidenceItems.length > 0) {
      const first = Object.keys(evidenceItems[0]).reduce((acc, k) => { acc[k] = typeof evidenceItems[0][k]; return acc; }, {});
      console.log('createBatch: first evidence item types:', first);
    }
  } catch (logErr) {
    console.error('createBatch input validation/logging error:', logErr && logErr.stack ? logErr.stack : logErr);
  }
  const helper = new MerkleEvidenceHelper();
  evidenceItems.forEach(item => helper.addEvidence(item));
  helper.buildTree();
  const batchData = helper.createBatchData();
  batchData.proofs = {};
  for (let i = 0; i < evidenceItems.length; i++) {
    batchData.proofs[i] = helper.getProof(i);
  }
  batchData.timestamp = Date.now();
  batchData.batchId = batchData.timestamp; // Ensure batchId is present and matches timestamp for test compatibility
  batchData.caseId = caseId;
  batchData.status = 'pending';

  // --- On-chain submission automation + cryptographic signature ---
  // Attempt on-chain submission for the freshly created batch
  try {
    await submitBatch(batchData);
  } catch (err) {
    // ensure pending status if submission failed internally
    batchData.status = batchData.status || 'pending';
    batchData.txError = err && err.message ? err.message : String(err);
  }

  // Persist (use JSON-safe copy)
  const batches = loadBatches();
  if (!batches[caseId]) batches[caseId] = [];
  const safeBatch = JSON.parse(JSON.stringify(batchData, jsonSafeReplacer));
  batches[caseId].push(safeBatch);
  saveBatches(batches);

  // Save to dispute history
  try {
    const disputeHistoryModule = await import('./disputeHistory.js');
    disputeHistoryModule.default.addDisputeRecord(caseId, safeBatch.timestamp || batchData.timestamp, {
      merkleRoot: safeBatch.merkleRoot || batchData.merkleRoot,
      status: safeBatch.status || batchData.status,
      txHash: safeBatch.txHash || batchData.txHash,
      rootSignature: safeBatch.rootSignature || batchData.rootSignature,
      createdAt: safeBatch.timestamp || batchData.timestamp,
      evidenceCount: safeBatch.evidenceCount || batchData.evidenceCount,
      proofs: safeBatch.proofs || batchData.proofs
    });
  } catch (e) {}

  return safeBatch;
}

// Get all batches for a caseId
function getBatches(caseId) {
  const batches = loadBatches();
  return batches[caseId] || [];
}

export default {
  createBatch,
  getBatches,
  submitBatch
};
