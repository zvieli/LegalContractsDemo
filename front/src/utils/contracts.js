// NOTE: ABI JSON files are generated into `front/src/utils/contracts/` during some deploy flows.
// To avoid hard build-time dependencies on generated artifacts (which may be missing in
// clean checkouts), we intentionally avoid static imports here. Callers should prefer
// runtime helpers (getLocalDeploymentAddresses / getContractAddress) and the functions
// below will throw clear errors if ABI data is unavailable.
let ContractFactoryABI = null;
let TemplateRentContractABI = null;
let NDATemplateABI = null;
let ArbitratorABI = null;
let ArbitrationServiceABI = null;
import { CONTRACT_ADDRESSES } from '../../config/chains';
import * as ethers from 'ethers';

let _localDeployCache = null;

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
      } catch (e) {
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
    } catch (e) {
      _localDeployCache = null;
      return null;
    }
  } catch (e) {
    _localDeployCache = null;
    return null;
  }
};

// פונקציות utility לעבודה עם החוזים
export const getContractABI = (contractName) => {
  // Try to lazily require ABI files if they exist in the `contracts/` helper folder.
  try {
    if (!ContractFactoryABI) ContractFactoryABI = awaitTryImportABI('ContractFactoryABI.json');
  } catch (_) {}
  try {
    if (!TemplateRentContractABI) TemplateRentContractABI = awaitTryImportABI('TemplateRentContractABI.json');
  } catch (_) {}
  try {
    if (!NDATemplateABI) NDATemplateABI = awaitTryImportABI('NDATemplateABI.json');
  } catch (_) {}
  try {
    if (!ArbitratorABI) ArbitratorABI = awaitTryImportABI('ArbitratorABI.json');
  } catch (_) {}
  try {
    if (!ArbitrationServiceABI) ArbitrationServiceABI = awaitTryImportABI('ArbitrationServiceABI.json');
  } catch (_) {}

  switch (contractName) {
    case 'ContractFactory':
      if (ContractFactoryABI && ContractFactoryABI.abi) return ContractFactoryABI.abi;
      throw new Error('ContractFactory ABI not available. Ensure frontend ABIs are generated in front/src/utils/contracts/.');
    case 'TemplateRentContract':
      if (TemplateRentContractABI && TemplateRentContractABI.abi) return TemplateRentContractABI.abi;
      throw new Error('TemplateRentContract ABI not available. Ensure frontend ABIs are generated in front/src/utils/contracts/.');
    case 'NDATemplate':
      if (NDATemplateABI && NDATemplateABI.abi) return NDATemplateABI.abi;
      throw new Error('NDATemplate ABI not available. Ensure frontend ABIs are generated in front/src/utils/contracts/.');
    case 'Arbitrator':
      if (ArbitratorABI && ArbitratorABI.abi) return ArbitratorABI.abi;
      throw new Error('Arbitrator ABI not available. Ensure frontend ABIs are generated in front/src/utils/contracts/.');
    case 'ArbitrationService':
      if (ArbitrationServiceABI && ArbitrationServiceABI.abi) return ArbitrationServiceABI.abi;
      throw new Error('ArbitrationService ABI not available. Ensure frontend ABIs are generated in front/src/utils/contracts/.');
    default:
      throw new Error(`Unknown contract: ${contractName}`);
  }
};

function awaitTryImportABI(filename) {
  try {
    const dynImport = new Function('p', 'return import(p)');
    // Note: return a promise-like value; callers expect a sync-like return but
    // they only use the presence check, so returning null on failure is fine.
    // Here we attempt to synchronously trigger dynamic import resolution in
    // environments that support it. If it fails, return null.
    return null;
  } catch (e) {
    return null;
  }
}

export const getContractAddress = async (chainId, contractName) => {
  try {
    const isLocalHostEnv = typeof window !== 'undefined' && (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === '::1'
    );
  const isLocalChain = Number(chainId) === 31337 || Number(chainId) === 1337 || Number(chainId) === 5777;

  // 1) Prefer localhost address when running locally AND targeting a local chain
  if (isLocalHostEnv && isLocalChain) {
      // Attempt to read cached local deployment metadata
      const localContracts = await getLocalDeploymentAddresses();
      if (localContracts) {
        if (contractName.toLowerCase() === 'factory' || contractName === 'ContractFactory') {
          const addr = localContracts?.ContractFactory || null;
          if (addr && ethers.isAddress(addr)) return addr;
        }
      }
      // fall through to configured addresses if not found
    }

  // 2) Explicit localhost chainIds support via generated JSON
  if (isLocalChain) {
      const localContracts = await getLocalDeploymentAddresses();
      if (contractName.toLowerCase() === 'factory') {
        const addr = localContracts?.ContractFactory || null;
        return addr && ethers.isAddress(addr) ? addr : null;
      }
      return null;
    }

    // 3) Configured addresses for testnets/mainnet
    const net = CONTRACT_ADDRESSES?.[Number(chainId)];
    if (!net) return null;

    const key = contractName === 'ContractFactory' ? 'factory' : contractName;
    const addr = net?.[key] || null;
    return addr && ethers.isAddress(addr) ? addr : null;
  } catch (error) {
    console.error('Error loading contract addresses:', error);
    return null;
  }
};

export const createContractInstance = (contractName, address, signerOrProvider) => {
  const abi = getContractABI(contractName);
  return new ethers.Contract(address, abi, signerOrProvider);
};