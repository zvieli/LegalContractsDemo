// evidenceBatch.js
// Backend module for batch management and Merkle proof generation
// Uses MerkleEvidenceHelper for batch creation, root/proof computation
// Persists batches in a local JSON file for reliability

import fs from 'fs';
import path from 'path';
import { MerkleEvidenceHelper } from '../../utils/merkleEvidenceHelper.js';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BATCHES_FILE = path.join(__dirname, '../data/evidence_batches.json');

function loadBatches() {
  if (!fs.existsSync(BATCHES_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(BATCHES_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveBatches(batches) {
  fs.writeFileSync(BATCHES_FILE, JSON.stringify(batches, null, 2));
}

// Create and persist a batch for a given caseId
async function createBatch(caseId, evidenceItems) {
  const helper = new MerkleEvidenceHelper();
  evidenceItems.forEach(item => helper.addEvidence(item));
  helper.buildTree();
  const batchData = helper.createBatchData();
  batchData.proofs = {};
  for (let i = 0; i < evidenceItems.length; i++) {
    batchData.proofs[i] = helper.getProof(i);
  }
  batchData.timestamp = Date.now();
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
    if (config && config.address && config.abi && config.rpcUrl) {
      const provider = new ethersModule.JsonRpcProvider(config.rpcUrl);
      const wallet = new ethersModule.Wallet(config.privateKey, provider);
      // Sign Merkle root (EIP-191 personal_sign)
      rootSignature = await wallet.signMessage(ethersModule.getBytes(batchData.merkleRoot));
      batchData.rootSignature = rootSignature;
      // Submit to contract (optionally pass signature if contract supports)
      // NOTE: contract instantiation is missing in original code, add if needed
      // const contract = new ethersModule.Contract(config.address, config.abi, wallet);
      // const tx = await contract.submitEvidenceBatch(batchData.merkleRoot, batchData.evidenceCount);
      // await tx.wait();
      // txHash = tx.hash;
      // batchData.status = 'onchain_submitted';
      // batchData.txHash = txHash;
    }
  } catch (err) {
    batchData.status = 'pending';
    batchData.txError = err.message;
  }

  // Persist
  const batches = loadBatches();
  if (!batches[caseId]) batches[caseId] = [];
  batches[caseId].push(batchData);
  saveBatches(batches);

  // Save to dispute history
  try {
    const disputeHistoryModule = await import('./disputeHistory.js');
    disputeHistoryModule.default.addDisputeRecord(caseId, batchData.timestamp, {
      merkleRoot: batchData.merkleRoot,
      status: batchData.status,
      txHash,
      rootSignature,
      createdAt: batchData.timestamp,
      evidenceCount: batchData.evidenceCount,
      proofs: batchData.proofs
    });
  } catch (e) {}

  return batchData;
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
