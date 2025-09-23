import pkg from 'hardhat';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { ethers } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const [deployer] = await ethers.getSigners();
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

  console.log('Querying factory at', factoryAddr, 'for contracts created by', deployer.address);
  const provider = ethers.provider || new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  const minimalAbi = [
    'function getContractsByCreator(address creator) view returns (address[])',
    'function getAllContractsCount() view returns (uint256)'
  ];
  const factory = new ethers.Contract(factoryAddr, minimalAbi, provider);
  try {
    const list = await factory.getContractsByCreator(deployer.address);
    console.log('getContractsByCreator returned', list.length, 'addresses:');
    list.forEach((a, i) => console.log(`${i}: ${a}`));
    const count = await factory.getAllContractsCount();
    console.log('getAllContractsCount():', count.toString());
  } catch (err) {
    console.error('Error querying factory:', err.message || err);
  }
}

main().catch((e) => { console.error('failed', e); process.exit(1); });
