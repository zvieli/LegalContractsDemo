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
    return JSON.parse(fs.readFileSync(BATCHES_FILE, 'utf8'));
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
  let txHash = null;
  let rootSignature = null;
  try {
    // Load contract ABI/address (customize as needed)
    const ethersModule = await import('ethers');
    const configPath = path.join(__dirname, '../config/merkleManager.json');
    let config = null;
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    // If ABI wasn't provided in merkleManager.json, try to load a local ABI file
    if (config && (!config.abi || config.abi.length === 0)) {
      try {
        const abiPath = path.join(__dirname, '../config/MerkleEvidenceManager.json');
        if (fs.existsSync(abiPath)) {
          config.abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
        }
      } catch (abiErr) {
        // ignore - we'll handle missing ABI below
      }
    }
      if (config && config.address && config.abi && config.rpcUrl) {
        console.log('createBatch: attempting on-chain submit to', config.address, 'via', config.rpcUrl);
      const provider = new ethersModule.JsonRpcProvider(config.rpcUrl);
      const wallet = new ethersModule.Wallet(config.privateKey, provider);
      // Sign Merkle root (sign raw bytes of the bytes32 root)
      try {
        rootSignature = await wallet.signMessage(ethersModule.arrayify(batchData.merkleRoot));
      } catch (signErr) {
        // Fallback: if arrayify fails, sign the hex string utf8 bytes
        try { rootSignature = await wallet.signMessage(ethersModule.toUtf8Bytes(String(batchData.merkleRoot))); } catch (e) { rootSignature = null; }
      }
      batchData.rootSignature = rootSignature;
      // Submit to contract (if ABI/contract supports submitEvidenceBatch)
      try {
        const contract = new ethersModule.Contract(config.address, config.abi, wallet);
        if (typeof contract.submitEvidenceBatch === 'function') {
          // Try sending with current nonce and retry on nonce errors
          let attempts = 0;
          const maxAttempts = 3;
          let lastErr = null;
          while (attempts < maxAttempts) {
            attempts++;
            try {
              // use 'pending' to include pending txs when calculating the next nonce
              const currentNonce = await provider.getTransactionCount(wallet.address, 'pending');
              console.log(`Submitting batch on-chain (attempt ${attempts}) with nonce ${currentNonce}`);
              const tx = await contract.submitEvidenceBatch(batchData.merkleRoot, batchData.evidenceCount, { nonce: currentNonce });
              await tx.wait();
              txHash = tx.hash;
              batchData.status = 'onchain_submitted';
              batchData.txHash = txHash;
              lastErr = null;
              break;
            } catch (innerErr) {
              lastErr = innerErr;
              const msg = innerErr && (innerErr.message || innerErr.toString());
              console.warn('submitEvidenceBatch attempt failed:', msg);
              // If nonce-related error, wait briefly and retry after refreshing nonce
              const isNonceError = (innerErr && innerErr.code === 'NONCE_EXPIRED') || (typeof msg === 'string' && /nonce/i.test(msg));
              if (isNonceError) {
                // small backoff and retry
                await new Promise(r => setTimeout(r, 300));
                continue;
              }
              // otherwise give up
              break;
            }
          }
          if (lastErr) {
            batchData.status = 'pending';
            batchData.txError = lastErr.message || String(lastErr);
            console.error('Error submitting batch on-chain after retries:', lastErr && lastErr.stack ? lastErr.stack : lastErr);
          }
        } else {
          // ABI present but function missing
          batchData.status = 'pending';
          batchData.txError = 'submitEvidenceBatch not available on contract ABI';
        }
      } catch (txErr) {
        batchData.status = 'pending';
        batchData.txError = txErr.message || String(txErr);
        console.error('Error submitting batch on-chain:', txErr && txErr.stack ? txErr.stack : txErr);
      }
    }
  } catch (err) {
    batchData.status = 'pending';
    batchData.txError = err.message;
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
  getBatches
};
