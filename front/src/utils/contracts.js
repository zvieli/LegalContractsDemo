import ContractFactoryABI from './contracts/ContractFactoryABI.json';
// Import compiled ABIs used by the frontend
import TemplateRentContractABI from './contracts/TemplateRentContractABI.json';
import NDATemplateABI from './contracts/NDATemplateABI.json';
import ArbitratorABI from './contracts/ArbitratorABI.json';
import ArbitrationServiceABI from './contracts/ArbitrationServiceABI.json';
import { CONTRACT_ADDRESSES } from '../../config/chains';
import * as ethers from 'ethers';

// פונקציות utility לעבודה עם החוזים
export const getContractABI = (contractName) => {
  switch (contractName) {
    case 'ContractFactory':
      return ContractFactoryABI.abi;
    case 'TemplateRentContract':
      if (typeof TemplateRentContractABI !== 'undefined') {
        return TemplateRentContractABI.abi;
      }
      throw new Error('TemplateRentContract ABI not available');
    case 'NDATemplate':
      if (typeof NDATemplateABI !== 'undefined') {
        return NDATemplateABI.abi;
      }
      throw new Error('NDATemplate ABI not available');
    case 'Arbitrator':
      if (typeof ArbitratorABI !== 'undefined') {
        return ArbitratorABI.abi;
      }
      throw new Error('Arbitrator ABI not available');
    case 'ArbitrationService':
      if (typeof ArbitrationServiceABI !== 'undefined') {
        return ArbitrationServiceABI.abi;
      }
      throw new Error('ArbitrationService ABI not available');
    default:
      throw new Error(`Unknown contract: ${contractName}`);
  }
};

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
      // Vite/ESM dynamic JSON imports expose data under `default`
      const mod = await import('./contracts/ContractFactory.json');
      const local = mod?.default ?? mod;
      if (contractName.toLowerCase() === 'factory' || contractName === 'ContractFactory') {
        const addr = local?.contracts?.ContractFactory || null;
        if (addr && ethers.isAddress(addr)) return addr;
      }
      // fall through to configured addresses if not found
    }

  // 2) Explicit localhost chainIds support via generated JSON
  if (isLocalChain) {
      const mod = await import('./contracts/ContractFactory.json');
      const local = mod?.default ?? mod;
      if (contractName.toLowerCase() === 'factory') {
        const addr = local?.contracts?.ContractFactory || null;
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