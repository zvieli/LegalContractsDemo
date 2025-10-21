

import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';
import { fileURLToPath } from 'url';
import { describe, beforeAll, test, expect } from 'vitest';

describe('End-to-End Merkle Batch Flow (Real)', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
  const hardhatRpc = 'http://127.0.0.1:8545';
  let caseId = `case-${Date.now()}`;
  let evidenceItems = [];
  let batchResult;
  let contractAddress;
  let provider, wallet;

  // Use Account #0 as admin, Account #1 as user/uploader
  const WALLET_0 = {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  };
  const WALLET_1 = {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
  };

  beforeAll(async () => {
    provider = new ethers.JsonRpcProvider(hardhatRpc);
    wallet = new ethers.Wallet(WALLET_0.privateKey, provider); // admin for contract actions
    // Deploy contract and get address (assume deploy.js writes to file)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const configPath = path.join(__dirname, '../../config/MerkleEvidenceManager.json');
  const config = JSON.parse(fs.readFileSync(configPath));
  contractAddress = config.address;
  expect(contractAddress).toBeDefined();
  });

  test('Given evidence files, When uploading, Then backend stores CID/hash/timestamp', async () => {
    const evidence = {
      caseId,
      content: 'Real evidence file for integration test',
      uploader: WALLET_1.address,
      timestamp: Date.now()
    };
    const res = await request(backendUrl)
      .post('/api/evidence/upload')
      .send(evidence)
      .expect(200);
    expect(res.body.cid).toBeDefined();
    expect(res.body.contentDigest).toBeDefined();
    evidenceItems.push({
      caseId,
      contentDigest: res.body.contentDigest,
      cidHash: res.body.cidHash,
      uploader: WALLET_1.address,
      timestamp: evidence.timestamp
    });
  });

  test('When creating batch, Then Merkle root is computed, signed, and stored', async () => {
    const res = await request(backendUrl)
      .post('/api/batch')
      .send({ caseId, evidenceItems })
      .expect(200);
  batchResult = res.body;
  console.log("Batch result:", batchResult);
  if (batchResult.txError) console.error("TX Error:", batchResult.txError);
  expect(batchResult.merkleRoot).toBeDefined();
  expect(batchResult.rootSignature).toMatch(/^0x[0-9a-fA-F]+$/);
  expect(batchResult.status).toBe('onchain_submitted');
  expect(batchResult.txHash).toMatch(/^0x[0-9a-fA-F]+$/);
  });

  test('Then contract on Hardhat node contains submitted root', async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const abiObj = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/MerkleEvidenceManager.json')));
  console.log("Test: batchResult.merkleRoot =", batchResult.merkleRoot);
  // Log the root used for submission and lookup
  console.log("Test: Merkle root for contract lookup =", batchResult.merkleRoot);
  // Assert strict equality (hex string)
  if (typeof batchResult.merkleRoot !== 'string' || !batchResult.merkleRoot.startsWith('0x')) {
    throw new Error('Merkle root is not a hex string: ' + batchResult.merkleRoot);
  }
  // Optionally, log the type and length
  console.log("Type of merkleRoot:", typeof batchResult.merkleRoot, "Length:", batchResult.merkleRoot.length);
  const contract = new ethers.Contract(contractAddress, abiObj.abi, provider);
  // Log contract address and ABI length
  console.log("Contract address for lookup:", contractAddress);
  console.log("ABI length:", abiObj.abi.length);
  // Wait for 2 blocks to ensure state is updated
  await new Promise(r => setTimeout(r, 2000));
  const batchOnChain = await contract.getBatchIdByRoot(batchResult.merkleRoot);
  console.log("Test: batchOnChain =", batchOnChain);
  expect(batchOnChain).toBeDefined();
  expect(Number(batchOnChain)).toBeGreaterThan(0);
  });

  test('Then dispute history contains all fields and is consistent', async () => {
    const res = await request(backendUrl)
      .get(`/api/dispute-history/${caseId}`)
      .expect(200);
    const history = res.body;
    expect(history.length).toBeGreaterThan(0);
    const batch = history.find(b => b.merkleRoot === batchResult.merkleRoot);
    expect(batch).toBeDefined();
    expect(batch.status).toBe('onchain_submitted');
    expect(batch.txHash).toBe(batchResult.txHash);
    expect(batch.rootSignature).toBe(batchResult.rootSignature);
  });
});
