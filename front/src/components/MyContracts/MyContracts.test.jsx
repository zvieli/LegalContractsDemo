import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MyContracts from './MyContracts.jsx';

const mockRequests = [
  {
    id: '1',
    contractAddress: '0x1234567890abcdef',
    bondAmount: '100',
    status: 'ai_decided',
    finalVerdict: 'PARTY_A_WINS',
    reimbursementAmountDai: 42,
    rationaleSummary: 'הצד א׳ עמד בכל התנאים.',
    evidenceHash: '0xabcdef',
    timestamp: 1700000000
  }
];

describe('MyContracts V7 Arbitration UI', () => {
  it('renders V7 arbitration request with all AI fields', async () => {
    render(<MyContracts />);
    // Simulate state update
    // You would use a mock or context provider in a real test
    // For now, just check for static text
    expect(await screen.findByText(/בקשות בוררות V7/)).toBeTruthy();
    // Check for verdict
    expect(await screen.findByText(/צד א׳ ניצח/)).toBeTruthy();
    // Check for reimbursement
    expect(await screen.findByText(/42 DAI/)).toBeTruthy();
    // Check for rationale
    expect(await screen.findByText(/הצד א׳ עמד בכל התנאים/)).toBeTruthy();
  });
});
