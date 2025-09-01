import ContractFactoryABI from './contracts/ContractFactoryABI.json';
// import TemplateRentContractABI from '../abis/TemplateRentContractABI.json';
// import NDATemplateABI from '../abis/NDATemplateABI.json';
// import ArbitratorABI from '../abis/ArbitratorABI.json';

// פונקציות utility לעבודה עם החוזים
export const getContractABI = (contractName) => {
  switch (contractName) {
    case 'ContractFactory':
      return ContractFactoryABI.abi;
    case 'TemplateRentContract':
      return TemplateRentContractABI.abi;
    case 'NDATemplate':
      return NDATemplateABI.abi;
    case 'Arbitrator':
      return ArbitratorABI.abi;
    default:
      throw new Error(`Unknown contract: ${contractName}`);
  }
};

export const getContractAddress = async (chainId, contractName) => {
  try {
    const addresses = await import('../utils/contracts/ContractFactory.json');
    return addresses[chainId]?.[contractName.toLowerCase()];
  } catch (error) {
    console.error('Error loading contract addresses:', error);
    return null;
  }
};

export const createContractInstance = (contractName, address, signerOrProvider) => {
  const { ethers } = require('ethers');
  const abi = getContractABI(contractName);
  return new ethers.Contract(address, abi, signerOrProvider);
};