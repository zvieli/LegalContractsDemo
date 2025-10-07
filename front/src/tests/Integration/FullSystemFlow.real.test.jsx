import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import EvidenceList from '../../components/Evidence/EvidenceList.jsx';
import BatchDashboardAdvanced from '../../components/Dashboard/BatchDashboardAdvanced.jsx';

jest.setTimeout(60000);

// Use Account #1 as user/uploader, Account #0 as admin
const WALLET_0 = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
};
const WALLET_1 = {
  address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
};

describe('Full System Flow (Real Frontend Integration)', () => {
  const caseId = `case-${Date.now()}`;
  let batchData, disputeHistory;

  beforeAll(async () => {
    // Upload evidence and create batch via backend
    const evidence = {
      caseId,
      content: 'Frontend integration test evidence',
      uploader: WALLET_1.address,
      timestamp: Date.now()
    };
    const res1 = await axios.post('/api/evidence/upload', evidence);
    const evidenceItems = [{
      caseId,
      contentDigest: res1.data.contentDigest,
      cidHash: res1.data.cidHash,
      uploader: WALLET_1.address,
      timestamp: evidence.timestamp
    }];
    const res2 = await axios.post('/api/batch', { caseId, evidenceItems });
    batchData = res2.data;
    await axios.post('/api/arbitrate-batch', {
      caseId,
      batchId: batchData.timestamp,
      merkleRoot: batchData.merkleRoot,
      proofs: batchData.proofs,
      evidenceItems,
      category: 'rent',
      requestReasoning: true
    });
    const res3 = await axios.get(`/api/dispute-history/${caseId}`);
    disputeHistory = res3.data;
  });

  test('EvidenceList.jsx reflects new batch and arbitration result', async () => {
    render(<EvidenceList evidence={disputeHistory} caseId={caseId} />);
    await waitFor(() => {
      expect(screen.getByText(/Merkle Root/)).toBeInTheDocument();
      expect(screen.getByText(/Arbitrated/)).toBeInTheDocument();
    });
    expect(screen.getByText(/rent/)).toBeInTheDocument();
    expect(screen.getByText(/decision/i)).toBeInTheDocument();
  });

  test('BatchDashboardAdvanced.jsx updates charts and status indicators', async () => {
    render(<BatchDashboardAdvanced caseId={caseId} />);
    await waitFor(() => {
      expect(screen.getByText(/Batch Status Dashboard/)).toBeInTheDocument();
      expect(screen.getByText(/Arbitrated/)).toBeInTheDocument();
    });
    expect(screen.getByText(/rent/)).toBeInTheDocument();
  });
});
