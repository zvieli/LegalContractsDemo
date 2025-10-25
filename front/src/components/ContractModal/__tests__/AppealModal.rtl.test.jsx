// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest';

// Provide a simple localStorage polyfill for the test environment if missing
/* global global */
if (typeof localStorage === 'undefined' || localStorage === null) {
  global.localStorage = (function () {
    let store = {};
    return {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
      },
      setItem(key, value) {
        store[key] = String(value);
      },
      removeItem(key) {
        delete store[key];
      },
      clear() {
        store = {};
      },
    };
  })();
}

// Mock Ethers context
vi.mock('../../../contexts/EthersContext', () => ({
  useEthers: () => ({
    account: '0xabc',
    signer: {},
    provider: {},
    chainId: 31337,
    contracts: {}
  })
}));

// Mock ContractService used inside the component so loadContractData returns a contractDetails object
vi.mock('../../../services/contractService', () => {
  return {
    ContractService: function () {
      return {
        getEnhancedRentContractDetails: async (addr) => ({
          address: addr,
          type: 'Rental',
          isActive: true,
          landlord: '0xabc',
          tenant: '0xabc',
          rentAmount: '1',
          fullySigned: true,
          cancellation: { cancelRequested: false }
        }),
        getPendingEvidenceCount: () => 0
      };
    }
  };
});

import AppealEvidenceList from '../../AppealEvidenceList';

describe('Appeal modal UI', () => {
  const contractAddress = '0xDeFaUlt000000000000000000000000000000000';

  beforeEach(() => {
    // set persisted appealEvidence for this contract
    const key = `appealEvidence:${String(contractAddress).toLowerCase()}`;
    const now = Date.now();
    const entries = [
      { ref: 'helia://bafybeiexamplecid', createdAt: now },
  { ref: 'bafybeiexamplelegacycid0000000000000000000000000', createdAt: now - 1000 },
      { ref: '0xdeadbeef012345678901234567890123456789012345678901234567890abcd', createdAt: now - 2000 }
    ];
    localStorage.setItem(key, JSON.stringify(entries));
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders persisted appealEvidence entries with Open/Copy controls', async () => {
    // stub alert to avoid jsdom not-implemented error
    global.alert = vi.fn();
  // Render the list directly with persisted entries
  const key = `appealEvidence:${String(contractAddress).toLowerCase()}`;
  const raw = localStorage.getItem(key);
  const entries = JSON.parse(raw);
  render(<AppealEvidenceList entries={entries} />);

  // Wait for a persisted ref to appear in the list
  const refEl = await screen.findByText((content) => content.includes('helia://bafybeiexamplecid'));
  expect(refEl).toBeTruthy();
  // Other persisted ref
  expect(await screen.findByText((content) => content.includes('bafybeiexamplelegacycid0000000000000000000000000'))).toBeTruthy();
    // Copy buttons (there should be as many as entries)
  const copyBtns = screen.getAllByText('Copy');
  expect(copyBtns.length).toBeGreaterThanOrEqual(3);

    // Open link should exist for the CID-like entries
  const openLinks = screen.getAllByText('Open');
  // At least the helia:// entry should render an Open link
  expect(openLinks.length).toBeGreaterThanOrEqual(1);
  });
});
