import pkg from 'hardhat';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { ethers } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const getFrontendContractsDir = require('./getFrontendContractsDir');
  const frontendContractsDir = getFrontendContractsDir();
  const factoryFile = path.join(frontendContractsDir, 'ContractFactory.json');
  if (!fs.existsSync(factoryFile)) {
    console.error('ContractFactory.json not found at', factoryFile);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(factoryFile, 'utf8'));
  const factoryAddr = data?.contracts?.ContractFactory;
  if (!factoryAddr) {
    console.error('ContractFactory address missing in', factoryFile);
    process.exit(1);
  }

  console.log('Using factory address from frontend file:', factoryAddr);

  const provider = ethers.provider || new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  const abiPath = path.join(frontendContractsDir, '..', '..', '..', 'artifacts', 'contracts', 'ContractFactory.sol', 'ContractFactory.json');
  // Fallback: try to load the simple ABI from the frontend ABIs directory
  let iface = null;
  try {
    const frontendABIPath = path.join(frontendContractsDir, 'ContractFactoryABI.json');
    if (fs.existsSync(frontendABIPath)) {
      const abiData = JSON.parse(fs.readFileSync(frontendABIPath, 'utf8'));
      iface = abiData.abi;
    }
  } catch (e) {
    // ignore
  }

  // Minimal ABI for the calls we need
  const minimalAbi = [
    'function getAllContractsCount() view returns (uint256)',
    'function getAllContractsPaged(uint256 start, uint256 count) view returns (address[])',
    'function getAllContracts() view returns (address[])'
  ];

  const abi = iface || minimalAbi;
  const factory = new ethers.Contract(factoryAddr, abi, provider);

  try {
    const count = await factory.getAllContractsCount();
    console.log('on-chain getAllContractsCount():', count.toString());
    const page = await factory.getAllContracts();
    console.log('on-chain getAllContracts() returned', page.length, 'addresses:');
    page.forEach((a, i) => console.log(`${i}: ${a}`));
  } catch (err) {
    console.error('Error querying factory:', err.message || err);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Script failed:', e);
  process.exit(1);
});
