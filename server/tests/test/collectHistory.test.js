import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { collectContractHistory } from '../../lib/collectHistory.js';

describe('collectContractHistory (integration)', async () => {
  it('attempts to collect history from local node when available', async () => {
    const rpc = process.env.RPC_URL || 'http://127.0.0.1:8545';
    // quick probe
    let provider;
    try {
      provider = new ethers.JsonRpcProvider(rpc);
      await provider.getBlockNumber();
    } catch (e) {
      // skip the test if no local node
      console.warn('Skipping collectContractHistory test: no local RPC at', rpc);
      return;
    }

    // Use a known contract address from local deployments if available via env
    const testContract = process.env.TEST_CONTRACT_ADDRESS || null;
    if (!testContract) {
      console.warn('No TEST_CONTRACT_ADDRESS set; skipping event decode assertions');
      return;
    }

    const history = await collectContractHistory(provider, testContract, [process.cwd() + '/artifacts/contracts']);
    expect(Array.isArray(history)).toBe(true);
    // If there are events, ensure required fields exist
    if (history.length > 0) {
      const e0 = history[0];
      expect(e0).toHaveProperty('txHash');
      expect(e0).toHaveProperty('blockNumber');
      expect(e0).toHaveProperty('blockTimestamp');
    }
  });
});
