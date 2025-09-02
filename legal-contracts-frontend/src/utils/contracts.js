import ContractFactoryABI from './contracts/ContractFactoryABI.json';
// If these ABIs exist in your project, uncomment the imports below.
// import TemplateRentContractABI from './contracts/TemplateRentContractABI.json';
// import NDATemplateABI from './contracts/NDATemplateABI.json';
// import ArbitratorABI from './contracts/ArbitratorABI.json';
import { CONTRACT_ADDRESSES } from '../../config/chains';
import { ethers } from 'ethers';

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

    // 1) Prefer localhost address when running locally (covers non-standard local chainIds like 6342)
    if (isLocalHostEnv) {
      const local = await import('../utils/contracts/ContractFactory.json');
      if (contractName.toLowerCase() === 'factory' || contractName === 'ContractFactory') {
        if (local?.contracts?.ContractFactory) return local.contracts.ContractFactory;
      }
      // fall through to configured addresses if not found
    }

    // 2) Explicit localhost chainIds support via generated JSON
    if (Number(chainId) === 31337 || Number(chainId) === 1337 || Number(chainId) === 5777) {
      const local = await import('../utils/contracts/ContractFactory.json');
      if (contractName.toLowerCase() === 'factory') {
        return local?.contracts?.ContractFactory || null;
      }
      return null;
    }

    // 3) Configured addresses for testnets/mainnet
    const net = CONTRACT_ADDRESSES?.[Number(chainId)];
    if (!net) return null;

    const key = contractName === 'ContractFactory' ? 'factory' : contractName;
    return net?.[key] || null;
  } catch (error) {
    console.error('Error loading contract addresses:', error);
    return null;
  }
};

export const createContractInstance = (contractName, address, signerOrProvider) => {
  const abi = getContractABI(contractName);
  return new ethers.Contract(address, abi, signerOrProvider);
};