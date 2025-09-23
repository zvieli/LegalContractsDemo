import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';

async function main() {
  const getFrontendContractsDir = require('./getFrontendContractsDir');
  const frontendContractsDir = getFrontendContractsDir();
  const networkFile = path.resolve(frontendContractsDir, 'ContractFactory.json');
  const abiFile = path.resolve(frontendContractsDir, 'ContractFactoryABI.json');
  if (!fs.existsSync(networkFile)) {
    console.error('ContractFactory.json not found at', networkFile);
    process.exit(1);
  }
  if (!fs.existsSync(abiFile)) {
    console.error('ContractFactoryABI.json not found at', abiFile);
    process.exit(1);
  }
  const networkJson = JSON.parse(fs.readFileSync(networkFile,'utf8'));
  const abiJson = JSON.parse(fs.readFileSync(abiFile,'utf8'));
  const factoryAddr = networkJson?.contracts?.ContractFactory;
  if (!factoryAddr) {
    console.error('Factory address missing in', networkFile);
    process.exit(1);
  }
  console.log('Factory address:', factoryAddr);
  const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  const code = await provider.getCode(factoryAddr);
  console.log('On-chain code size:', code ? (code.length / 2 - 1) : 0, 'bytes');

  // Find selector for createRentContract
  const abi = abiJson.abi || abiJson;
  const fn = abi.find((it) => it.type === 'function' && it.name === 'createRentContract');
  if (!fn) {
    console.error('createRentContract not found in frontend ABI');
    process.exit(1);
  }
  const types = fn.inputs.map(i => i.type).join(',');
  const sig = `${fn.name}(${types})`;
  // ethers.keccak256(ethers.toUtf8Bytes(sig)) -> hex, selector is first 4 bytes
  const selector = ethers.id(sig).slice(0, 10);
  console.log('Function signature:', sig);
  console.log('Selector:', selector);

  // Build a dummy calldata (no args encoded) - just selector
  const calldata = selector;
  try {
    const res = await provider.call({ to: factoryAddr, data: calldata });
    console.log('eth_call success, result:', res);
  } catch (err) {
    console.error('eth_call failed:', String(err?.message || err));
    if (err?.data) console.error('data:', err.data);
  }

  // Instantiate contract using frontend ABI and attempt safe view calls
  try {
    const contract = new ethers.Contract(factoryAddr, abi, provider);
    console.log('\nCalling view: getAllContractsCount()');
    const count = await contract.getAllContractsCount();
    console.log('getAllContractsCount ->', count.toString());
  } catch (err) {
    console.error('getAllContractsCount failed:', String(err?.message || err));
    if (err?.data) console.error('data:', err.data);
  }

  // Try callStatic createRentContract with zero args to capture revert shape
  try {
    const contract = new ethers.Contract(factoryAddr, abi, provider);
    console.log('\ncallStatic createRentContract with zero args (expect revert)');
    const res = await contract.callStatic.createRentContract('0x0000000000000000000000000000000000000000', 0, '0x0000000000000000000000000000000000000000', 0);
    console.log('callStatic returned:', res);
  } catch (err) {
    console.error('callStatic reverted:', String(err?.message || err));
    if (err?.data) console.error('data:', err.data);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
