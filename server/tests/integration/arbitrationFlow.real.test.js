

import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, beforeAll, test, expect } from 'vitest';

describe('End-to-End Arbitration Flow (Real)', () => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3002';

  // Use Account #0 as admin, Account #1 as user/uploader
  const WALLET_0 = {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  };
  const WALLET_1 = {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
  };

  let caseId = `case-${Date.now()}`;
  let batchId, merkleRoot, proofs, evidenceItems;
  let arbitrationResult;

  beforeAll(async () => {
    // Create evidence and batch
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const evidence = {
      caseId,
      content: 'Arbitration test evidence',
      uploader: WALLET_1.address,
      timestamp: Date.now()
    };
    const res1 = await request(backendUrl)
      .post('/api/evidence/upload')
      .send(evidence)
      .expect(200);
    evidenceItems = [{
      caseId,
      contentDigest: res1.body.contentDigest,
      cidHash: res1.body.cidHash,
      uploader: WALLET_1.address,
      timestamp: evidence.timestamp
    }];
    const res2 = await request(backendUrl)
      .post('/api/batch')
      .send({ caseId, evidenceItems })
      .expect(200);
    batchId = res2.body.timestamp;
    merkleRoot = res2.body.merkleRoot;
    proofs = res2.body.proofs;
  });

  test('Given batch, When sending to LLM arbitrator, Then receive decision and reasoning', async () => {
    const payload = {
      caseId,
      batchId,
      merkleRoot,
      proofs,
      evidenceItems,
      category: 'rent',
      requestReasoning: true
    };
    const res = await request(backendUrl)
      .post('/api/arbitrate-batch')
      .send(payload)
      .expect(200);
    arbitrationResult = res.body.arbitration;
    expect(arbitrationResult).toBeDefined();
    expect(arbitrationResult.decision || arbitrationResult.arbitration).toBeDefined();
    expect(arbitrationResult.reasoning || arbitrationResult.legalReasoning).toBeDefined();
  });

  test('Then dispute history contains decision, reasoning, and category', async () => {
    const res = await request(backendUrl)
      .get(`/api/dispute-history/${caseId}`)
      .expect(200);
    const history = res.body;
  const batch = history.find(b => b.merkleRoot === merkleRoot && b.status === 'arbitrated');
    expect(batch).toBeDefined();
    expect(batch.status).toBe('arbitrated');
    expect(batch.decision).toBeDefined();
    expect(batch.reasoning).toBeDefined();
    expect(batch.category).toBe('rent');
  });
});
