import fetch from 'node-fetch';
import { ethers } from 'ethers';

const DEFAULT_LOCAL = 'http://127.0.0.1:8545';

async function isRpcResponsive(url, timeout = 1500) {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      signal: controller.signal
    });
    clearTimeout(id);
    return res && res.ok;
  } catch (e) {
    return false;
  }
}

/**
 * getProvider - prefer a local Hardhat RPC when available, otherwise use RPC_URL env or fallback
 * Returns an ethers.JsonRpcProvider instance
 */
export async function getProvider() {
  const envRpc = process.env.RPC_URL || process.env.HARDHAT_RPC || process.env.PROVIDER_URL || null;

  // Prefer explicit localhost first if responsive
  try {
    if (await isRpcResponsive(DEFAULT_LOCAL)) {
      return new ethers.JsonRpcProvider(DEFAULT_LOCAL);
    }
  } catch (_) {}

  // If envRpc is set and reachable, use it
  if (envRpc) {
    try {
      if (await isRpcResponsive(envRpc)) {
        return new ethers.JsonRpcProvider(envRpc);
      }
      // if not responsive, still return provider for envRpc to allow error propagation
      return new ethers.JsonRpcProvider(envRpc);
    } catch (e) {
      return new ethers.JsonRpcProvider(envRpc);
    }
  }

  // Fallback to default local provider (may throw on use)
  return new ethers.JsonRpcProvider(DEFAULT_LOCAL);
}

export function getProviderSync() {
  const envRpc = process.env.RPC_URL || process.env.HARDHAT_RPC || process.env.PROVIDER_URL || DEFAULT_LOCAL;
  return new ethers.JsonRpcProvider(envRpc);
}

export default getProvider;
