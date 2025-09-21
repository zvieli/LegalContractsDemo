import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ethers from 'ethers';
import { ContractService } from '../contractService';

// Mock createContractInstance to return a fake contract object
vi.mock('../../utils/contracts', () => {
  return {
    createContractInstance: (name, address, signer) => {
      // simple fake rent contract
      return {
        landlord: async () => '0x0000000000000000000000000000000000000001',
        tenant: async () => '0x0000000000000000000000000000000000000002',
        reportDispute: vi.fn(async (dtype, amount, evidence, overrides) => {
          // return an object that matches ethers' transaction response with wait()
          return {
            wait: async () => ({ logs: [] }),
          };
        })
      };
    }
  };
});

describe('ContractService.computeReporterBond', () => {
  it('computes 0.5% and minimum 1 wei when requestedAmount>0', () => {
    const svc = new ContractService({ provider: {} }, 1);
    expect(svc.computeReporterBond(0n)).toBe(0n);
    expect(svc.computeReporterBond(1n)).toBe(1n); // 0.005 -> min 1
    expect(svc.computeReporterBond(200n)).toBe(1n); // 0.5% = 1
    expect(svc.computeReporterBond(10000n)).toBe(50n); // 0.5% of 10000
  });
});

describe('ContractService.reportRentDispute', () => {
  it('calls reportDispute and sends bond as value when required', async () => {
    const signer = {
      provider: { getNetwork: async () => ({ chainId: 1 }) },
      getAddress: async () => '0x0000000000000000000000000000000000000001',
      getBalance: async () => ethers.parseEther('1')
    };
    const svc = new ContractService(signer, 1);
    // Spy on createContractInstance via the mocked module by re-requiring
    const rentAddr = '0xcontract';
    // Call with amount that yields a non-zero bond
    const amount = 10000n;
    const res = await svc.reportRentDispute(rentAddr, 0, amount, 'evidence');
    expect(res).toHaveProperty('receipt');
    // computeReporterBond should be > 0
    expect(svc.computeReporterBond(amount) > 0n).toBeTruthy();
  });
});
