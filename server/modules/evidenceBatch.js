// evidenceBatch.js
// Backend module for batch management and Merkle proof generation
// Uses MerkleEvidenceHelper for batch creation, root/proof computation
// Persists batches in a local JSON file for reliability

const fs = require('fs');
const path = require('path');
const { MerkleEvidenceHelper } = require('../../utils/merkleEvidenceHelper');

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

  // --- On-chain submission automation ---
  let txHash = null;
  try {
    // Load contract ABI/address (customize as needed)
    const { ethers } = require('ethers');
    const configPath = path.join(__dirname, '../config/merkleManager.json');
    const config = fs.existsSync(configPath) ? require(configPath) : null;
    if (config && config.address && config.abi && config.rpcUrl) {
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const wallet = new ethers.Wallet(config.privateKey, provider);
      const contract = new ethers.Contract(config.address, config.abi, wallet);
      const tx = await contract.submitEvidenceBatch(batchData.merkleRoot, batchData.evidenceCount);
      await tx.wait();
      txHash = tx.hash;
      batchData.status = 'onchain_submitted';
      batchData.txHash = txHash;
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
    const disputeHistory = require('./disputeHistory');
    disputeHistory.addDisputeRecord(caseId, batchData.timestamp, {
      merkleRoot: batchData.merkleRoot,
      status: batchData.status,
      txHash,
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

module.exports = {
  createBatch,
  getBatches
};
