console.log('contracts.js loaded');
// NOTE: ABI JSON files are generated into `front/src/utils/contracts/` during some deploy flows.
// To avoid hard build-time dependencies on generated artifacts (which may be missing in
// clean checkouts), we intentionally avoid static imports here. Callers should prefer
// runtime helpers (getLocalDeploymentAddresses / getContractAddress) and the functions
// below will throw clear errors if ABI data is unavailable.
import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES } from '../../config/chains';

let ContractFactoryABI = null;
let EnhancedRentContractABI = null;
// ...existing code...
let NDATemplateABI = null;
let ArbitratorABI = null;
let ArbitrationServiceABI = null;
let ArbitrationContractV2ABI = null;

let _localDeployCache = null;
import { loadAbis } from './loadAbis';

export const getLocalDeploymentAddresses = async () => {
  if (_localDeployCache) return _localDeployCache;
  try {
    // Prefer runtime fetch (works in browsers) to avoid bundler resolving a missing file.
    if (typeof window !== 'undefined' && window.fetch) {
      try {
        const resp = await fetch('/utils/contracts/ContractFactory.json');
        if (resp && resp.ok) {
          const local = await resp.json();
          _localDeployCache = local?.contracts || null;
          return _localDeployCache;
        }
      } catch (e) { void e;
        // fall through to dynamic import attempt
      }
    }
    // Fallback: dynamic import via runtime-built import to avoid bundler static analysis
    try {
      const dynImport = new Function('p', 'return import(p)');
      const mod = await dynImport('./contracts/ContractFactory.json');
      const local = mod?.default ?? mod;
      _localDeployCache = local?.contracts || null;
      return _localDeployCache;
    } catch (e) { void e;
      _localDeployCache = null;
      return null;
    }
  } catch (e) { void e;
    _localDeployCache = null;
    return null;
  }
};

// פונקציות utility לעבודה עם החוזים
export const getContractABI = (contractName) => {
  // Prefer preloaded ABIs attached to window.__ABIS__ (populated by loadAbis())
  try {
    if (typeof window !== 'undefined' && window.__ABIS__) {
      const abis = window.__ABIS__;
      if (!ContractFactoryABI && abis.ContractFactory) ContractFactoryABI = abis.ContractFactory;
// ...existing code...
      if (!NDATemplateABI && abis.NDATemplate) NDATemplateABI = abis.NDATemplate;
      if (!ArbitratorABI && abis.Arbitrator) ArbitratorABI = abis.Arbitrator;
      if (!ArbitrationServiceABI && abis.ArbitrationService) ArbitrationServiceABI = abis.ArbitrationService;
      if (!ArbitrationContractV2ABI && abis.ArbitrationContractV2) ArbitrationContractV2ABI = abis.ArbitrationContractV2;
    }
  } catch (_) { void _;}

  switch (contractName) {
    case 'EnhancedRentContract':
      if (window.__ABIS__ && window.__ABIS__.EnhancedRentContract && window.__ABIS__.EnhancedRentContract.abi) return window.__ABIS__.EnhancedRentContract.abi;
      // fallback to local variable if loaded
      if (typeof EnhancedRentContractABI !== 'undefined' && EnhancedRentContractABI && EnhancedRentContractABI.abi) return EnhancedRentContractABI.abi;
      throw new Error('EnhancedRentContract ABI not available. Ensure frontend ABIs are generated in front/src/utils/contracts/.');
    case 'ContractFactory':
      if (ContractFactoryABI && ContractFactoryABI.abi) return ContractFactoryABI.abi;
      throw new Error('ContractFactory ABI not available. Ensure frontend ABIs are generated in front/src/utils/contracts/.');
// ...existing code...
    case 'NDATemplate':
      if (NDATemplateABI && NDATemplateABI.abi) return NDATemplateABI.abi;
      throw new Error('NDATemplate ABI not available. Ensure frontend ABIs are generated in front/src/utils/contracts/.');
    case 'Arbitrator':
      if (ArbitratorABI && ArbitratorABI.abi) return ArbitratorABI.abi;
      throw new Error('Arbitrator ABI not available. Ensure frontend ABIs are generated in front/src/utils/contracts/.');
    case 'ArbitrationService':
      if (ArbitrationServiceABI && ArbitrationServiceABI.abi) return ArbitrationServiceABI.abi;
      throw new Error('ArbitrationService ABI not available. Ensure frontend ABIs are generated in front/src/utils/contracts/.');
    case 'ArbitrationContractV2':
      if (ArbitrationContractV2ABI && ArbitrationContractV2ABI.abi) return ArbitrationContractV2ABI.abi;
      throw new Error('ArbitrationContractV2 ABI not available. Ensure frontend ABIs are generated in front/src/utils/contracts/.');
    default:
      throw new Error(`Unknown contract: ${contractName}`);
  }
};

function _awaitTryImportABI(_filename) {
  try {
    void _filename;
    const _dynImport = new Function('p', 'return import(p)');
void _dynImport;
    // Note: return a promise-like value; callers expect a sync-like return but
    // they only use the presence check, so returning null on failure is fine.
    // Here we attempt to synchronously trigger dynamic import resolution in
    // environments that support it. If it fails, return null.
    return null;
  } catch (_e) {
    void _e;
    return null;
  }
}

export const getContractAddress = async (chainId, contractName) => {
  try {
    // If caller didn't provide chainId, try to infer it from injected provider (no prompt)
    if ((typeof chainId === 'undefined' || chainId === null) && typeof window !== 'undefined' && window.ethereum) {
      try {
        const cid = await window.ethereum.request({ method: 'eth_chainId' }).catch(() => null);
        if (cid) {
          // cid may be hex string like '0x7a69'
          const maybe = Number(cid);
          if (!isNaN(maybe) && maybe > 0) chainId = maybe;
              if ((typeof chainId === 'undefined' || chainId === null) && typeof window !== 'undefined') {
                if (window.ethereum) {
                  try {
                    const cid = await window.ethereum.request({ method: 'eth_chainId' }).catch(() => null);
                    if (cid) {
                      // cid may be hex string like '0x7a69'
                      const maybe = Number(cid);
                      if (!isNaN(maybe) && maybe > 0) chainId = maybe;
                      else {
                        // try parse hex
                        try { chainId = parseInt(String(cid), 16); } catch (_){ void _; }
                      }
                    }
                  } catch (_e) { void _e; }
                }
                // If still missing and we're running on localhost, default to common local chain id
                if ((typeof chainId === 'undefined' || chainId === null) && (window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === '::1'))) {
                  chainId = 31337;
                }
            // try parse hex
            try { chainId = parseInt(String(cid), 16); } catch (_){ void _; }
          }
        }
      } catch (_e) { void _e; }
    }

    console.debug('[getContractAddress] chainId:', chainId, 'contractName:', contractName);
    console.log('[getContractAddress] chainId:', chainId, 'contractName:', contractName);
    const isLocalHostEnv = typeof window !== 'undefined' && (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === '::1'
    );
    const isLocalChain = Number(chainId) === 31337 || Number(chainId) === 1337 || Number(chainId) === 5777;

  // Normalize contract name for lookup
  const _contractKey = (contractName && contractName.toLowerCase() === 'factory') ? 'ContractFactory' : contractName;
void _contractKey;

    // 1) Prefer localhost address when running locally AND targeting a local chain
    if (isLocalHostEnv && isLocalChain) {
      // Attempt to read cached local deployment metadata
      const localContracts = await getLocalDeploymentAddresses();
  console.debug('[getContractAddress] localContracts:', localContracts);
  console.log('[getContractAddress] localContracts:', localContracts);
      if (localContracts) {
        const addr = localContracts?.ContractFactory || localContracts?.factory || null;
  console.debug('[getContractAddress] localContracts addr:', addr);
  console.log('[getContractAddress] localContracts addr:', addr);
        if (addr && ethers.isAddress(addr)) return addr;
      }
      // Fallback: try reading deployment-summary.json directly
      try {
        let resp = await fetch('/utils/contracts/deployment-summary.json');
  console.debug('[getContractAddress] fetch /utils/contracts/deployment-summary.json status:', resp && resp.status);
  console.log('[getContractAddress] fetch /utils/contracts/deployment-summary.json status:', resp && resp.status);
        if (!resp.ok && typeof window !== 'undefined' && window.location.hostname === 'localhost') {
          // Try src path for dev
          resp = await fetch('/src/utils/contracts/deployment-summary.json');
          console.debug('[getContractAddress] fetch /src/utils/contracts/deployment-summary.json status:', resp && resp.status);
          console.log('[getContractAddress] fetch /src/utils/contracts/deployment-summary.json status:', resp && resp.status);
        }
        if (resp && resp.ok) {
          const summary = await resp.json();
          console.debug('[getContractAddress] summary:', summary);
          console.log('[getContractAddress] summary:', summary);
          const addr = summary?.contracts?.ContractFactory || summary?.contracts?.factory || null;
          console.debug('[getContractAddress] summary addr:', addr);
          console.log('[getContractAddress] summary addr:', addr);
          if (addr && ethers.isAddress(addr)) return addr;
        } else if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
          // As last resort, try dynamic import (works in dev)
          try {
            const mod = await import('./contracts/deployment-summary.json');
            const summary = mod?.default ?? mod;
            console.debug('[getContractAddress] dynamic import summary:', summary);
            console.log('[getContractAddress] dynamic import summary:', summary);
            const addr = summary?.contracts?.ContractFactory || summary?.contracts?.factory || null;
            console.debug('[getContractAddress] dynamic import addr:', addr);
            console.log('[getContractAddress] dynamic import addr:', addr);
            if (addr && ethers.isAddress(addr)) return addr;
          } catch (impErr) {
            console.debug('[getContractAddress] dynamic import error:', impErr);
            console.log('[getContractAddress] dynamic import error:', impErr);
          }
        }
      } catch (e) { void e;
  console.debug('[getContractAddress] fetch/import error:', e);
  console.log('[getContractAddress] fetch/import error:', e);
      }
    }

    // 2) Explicit localhost chainIds support via generated JSON
    if (isLocalChain) {
      const localContracts = await getLocalDeploymentAddresses();
  console.debug('[getContractAddress] explicit localChain localContracts:', localContracts);
  console.log('[getContractAddress] explicit localChain localContracts:', localContracts);
      const addr = localContracts?.ContractFactory || localContracts?.factory || null;
  console.debug('[getContractAddress] explicit localChain addr:', addr);
  console.log('[getContractAddress] explicit localChain addr:', addr);
      return addr && ethers.isAddress(addr) ? addr : null;
    }

  // 3) Configured addresses for testnets/mainnet
  const net = CONTRACT_ADDRESSES?.[Number(chainId)];
  console.debug('[getContractAddress] net:', net);
  console.log('[getContractAddress] net:', net);
  if (!net) return null;

  const key = contractName === 'ContractFactory' ? 'factory' : contractName;
  const addr = net?.[key] || null;
  console.debug('[getContractAddress] net addr:', addr);
  console.log('[getContractAddress] net addr:', addr);
  return addr && ethers.isAddress(addr) ? addr : null;
  } catch (error) {
    console.error('Error loading contract addresses:', error);
    return null;
  }
};

export const createContractInstance = (contractName, address, signerOrProvider) => {
  const abi = getContractABI(contractName);
  if (!address || typeof address !== 'string' || !ethers.isAddress(address)) {
    throw new Error(`createContractInstance: invalid contract address provided for ${contractName}: ${String(address)}`);
  }
  // Defensive: if caller passed a signer-like object without an attached provider,
  // prefer to create the contract with a provider for read-only calls and event
  // listeners to avoid UNSUPPORTED_OPERATION from signer-only runners.
  try {
    const isSignerLike = signerOrProvider && typeof signerOrProvider === 'object' && (typeof signerOrProvider.getAddress === 'function' || signerOrProvider._isSigner);
    const hasProvider = signerOrProvider && signerOrProvider.provider;
    if (isSignerLike && !hasProvider) {
      console.warn('[contracts.js] createContractInstance: runner is a signer without provider — falling back to global or inferred provider for read/event calls.');
      // Try derive a provider from window.__APP_ETHERS__ or a global JsonRpcProvider
      let fallbackProvider = null;
      try {
        if (typeof window !== 'undefined' && window.__APP_ETHERS__ && window.__APP_ETHERS__.provider) fallbackProvider = window.__APP_ETHERS__.provider;
      } catch (e) { void e;}
      try {
        if (!fallbackProvider && typeof window !== 'undefined' && window.ethereum) {
          // Use BrowserProvider around injected provider so we get a provider instance
          fallbackProvider = new ethers.BrowserProvider(window.ethereum);
        }
      } catch (e) { void e;}
      // As last resort, prefer a localhost JSON-RPC provider if present
      try {
        if (!fallbackProvider) fallbackProvider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
      } catch (e) { void e;}

      if (fallbackProvider) return new ethers.Contract(address, abi, fallbackProvider);
      // If we couldn't obtain a fallback provider, still create contract with the original runner
      console.warn('[contracts.js] createContractInstance: no fallback provider available; returning contract bound to signer-only runner');
    }
  } catch (e) { void e;
    // swallow and proceed to normal creation
  }
  return new ethers.Contract(address, abi, signerOrProvider);
};

// Async variant: ensures ABIs are loaded (via loadAbis fetch) before creating the contract.
export const createContractInstanceAsync = async (contractName, address, signerOrProvider, write = false) => {
  // If window.__ABIS__ is missing or doesn't have the requested key, attempt to load ABIs at runtime
  try {
    if (typeof window !== 'undefined') {
      const has = window.__ABIS__ && window.__ABIS__[contractName];
      if (!has) {
        try {
          await loadAbis();
        } catch (e) { void e;
          // ignore; getContractABI will throw a clearer error if ABI still missing
        }
      }
    }
  } catch (e) { void e;
    // ignore
  }

  const abi = getContractABI(contractName);
  if (!address || typeof address !== 'string' || !ethers.isAddress(address)) {
    throw new Error(`createContractInstanceAsync: invalid contract address provided for ${contractName}: ${String(address)}`);
  }
  // Defensive: if signer-only runner passed, try to prefer a provider-backed instance
  try {
    const isSignerLike = signerOrProvider && typeof signerOrProvider === 'object' && (typeof signerOrProvider.getAddress === 'function' || signerOrProvider._isSigner);
    const hasProvider = signerOrProvider && signerOrProvider.provider;
    // If write action is requested, enforce signer presence
    if (write) {
      if (!isSignerLike) {
        throw new Error('[contracts.js] createContractInstanceAsync: write action requires a signer, but got provider or invalid runner.');
      }
      if (isSignerLike && !hasProvider) {
        console.warn('[contracts.js] createContractInstanceAsync: runner is a signer without provider — attempting to derive an equivalent provider-attached signer.');
        let fallbackProvider = null;
        try {
          if (typeof window !== 'undefined' && window.__APP_ETHERS__ && window.__APP_ETHERS__.provider) fallbackProvider = window.__APP_ETHERS__.provider;
        } catch (e) { void e;}
        try {
          if (!fallbackProvider && typeof window !== 'undefined' && window.ethereum) {
            fallbackProvider = new ethers.BrowserProvider(window.ethereum);
          }
        } catch (e) { void e;}
        try {
          if (!fallbackProvider) fallbackProvider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
        } catch (e) { void e;}

        // If we were able to pick a fallback provider, try to derive the signer's address
        // and create a signer attached to the fallback provider so contract can send txs.
        if (fallbackProvider) {
          try {
            let addr = null;
            if (typeof signerOrProvider.getAddress === 'function') {
              try { addr = await signerOrProvider.getAddress(); } catch (_) { void _; addr = null; }
            }
            // Fallback: some signer objects expose `_address` or `address`
            if (!addr && signerOrProvider && typeof signerOrProvider === 'object') {
              addr = signerOrProvider._address || signerOrProvider.address || null;
            }
            if (addr) {
              try {
                const realSigner = await fallbackProvider.getSigner(addr);
                return new ethers.Contract(address, abi, realSigner);
              } catch (e) { void e;
                // if we couldn't getSigner for the address, fall back to error
                throw new Error('[contracts.js] createContractInstanceAsync: could not resolve provider-backed signer for write action.');
              }
            }
          } catch (e) { void e;
            throw new Error('[contracts.js] createContractInstanceAsync: could not resolve signer address for write action.');
          }
        }
        throw new Error('[contracts.js] createContractInstanceAsync: no fallback provider available for write action; cannot create contract instance.');
      }
    }
  } catch (e) { void e; throw e; }
  // For read actions, allow provider or signer
  return new ethers.Contract(address, abi, signerOrProvider);
};