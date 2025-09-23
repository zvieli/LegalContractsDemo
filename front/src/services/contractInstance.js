import * as ethers from 'ethers';
// Note: use dynamic import of '../utils/contracts' in createDefaultContract to avoid
// bundling generated ABIs into the main app bundle. Static imports here can cause
// build-time errors if generated ABI files are missing.

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
// variable. For feature-rich interactions, code should call `createContractInstanceAsync(...)`.
export const contract = new Proxy({}, {
  get(_, prop) {
    // Return a function that throws a helpful error if the real contract isn't set.
    return async function () {
      throw new Error(`Frontend helper: attempted to call contract.${String(prop)} but no contract instance was provided. Use createContractInstance(name,address,signer) or pass a connected signer.`);
    };
  }
});

export async function createDefaultContract(name, address, signerOrProvider) {
  const signer = signerOrProvider || defaultProvider;
  if (!signer) throw new Error('No provider or signer available to create contract. Connect wallet or start a local node');
  try {
    // Use the async factory which will attempt to load ABIs at runtime
    return await (await import('../utils/contracts')).createContractInstanceAsync(name, address, signer);
  } catch (e) {
    throw new Error(`Could not create contract instance for ${name} at ${address}: ${e.message}`);
  }
}

export default contract;
