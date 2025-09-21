import * as ethers from 'ethers';
import { createContractInstance, getContractAddress } from '../utils/contracts';

// Minimal helper used by existing service code. This file intentionally keeps logic small
// and defensive: it will attempt to create a default 'contract' proxy when a signer is
// available in `window.ethereum`, otherwise it throws helpful errors at runtime.

function makeDefaultProvider() {
  if (typeof window !== 'undefined' && window.ethereum) {
    return new ethers.BrowserProvider(window.ethereum);
  }
  // Fallback to localhost JSON-RPC if available
  try {
    return new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  } catch (e) {
    return null;
  }
}

const defaultProvider = makeDefaultProvider();

// A very small proxy object used by some service helpers that expect a top-level `contract`
// variable. For feature-rich interactions, code should call `createContractInstance(...)`.
export const contract = new Proxy({}, {
  get(_, prop) {
    // Return a function that throws a helpful error if the real contract isn't set.
    return async function () {
      throw new Error(`Frontend helper: attempted to call contract.${String(prop)} but no contract instance was provided. Use createContractInstance(name,address,signer) or pass a connected signer.`);
    };
  }
});

export function createDefaultContract(name, address, signerOrProvider) {
  const signer = signerOrProvider || defaultProvider;
  if (!signer) throw new Error('No provider or signer available to create contract. Connect wallet or start a local node');
  const abi = getContractAddress ? null : null; // placeholder - utils/contracts should supply ABI when used
  // Prefer to use the util helper if available
  try {
    return createContractInstance(name, address, signer);
  } catch (e) {
    // If helper not available/runtime mismatch, throw a clear error
    throw new Error(`Could not create contract instance for ${name} at ${address}: ${e.message}`);
  }
}

export default contract;
