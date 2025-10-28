import fs from 'fs/promises';
import path from 'path';
import { ethers } from 'ethers';

(async ()=>{
  try {
    const deployPath = path.resolve('./output.log');
    let rpc = process.env.RPC_URL || 'http://127.0.0.1:8545';
    const provider = new ethers.JsonRpcProvider(rpc);
    // try to find an ABI/contract address in artifacts or output
    let abiPath = path.resolve('./artifacts/contracts/ArbitrationService.sol/ArbitrationService.json');
    let abi;
    let address;
    try {
      const jf = JSON.parse(await fs.readFile(abiPath, 'utf8'));
      abi = jf.abi || jf.output?.abi;
    } catch (e) {
      // fallback: try server contract ABI file
      try {
        const file = await fs.readFile('./server/contracts/ArbitrationService.abi.json', 'utf8');
        abi = JSON.parse(file);
      } catch (e2) {
        console.error('Could not find ABI automatically, please supply ABI JSON at', abiPath);
        process.exit(1);
      }
    }

    // Try to find deployment address in common deployment-summary locations or output.log
    try {
      // 1) server config deployment-summary (preferred)
      const serverDeploy = await fs.readFile(path.resolve('./server/config/deployment-summary.json'), 'utf8').catch(() => null);
      if (serverDeploy) {
        const parsed = JSON.parse(serverDeploy);
        address = parsed?.contracts?.ArbitrationService || address;
      }
    } catch (e) {}

    try {
      // 2) frontend deployment-summary (older setups)
      const frontDeploy = await fs.readFile(path.resolve('./front/src/utils/contracts/deployment-summary.json'), 'utf8').catch(() => null);
      if (frontDeploy) {
        const parsed = JSON.parse(frontDeploy);
        address = parsed?.contracts?.ArbitrationService || address;
      }
    } catch (e) {}

    try {
      // 3) try to find deployment address in hardhat artifacts output.log
      const out = await fs.readFile('./output.log', 'utf8').catch(() => null);
      if (out) {
        const m = out.match(/ArbitrationService (?:deployed at|address):?\s*(0x[0-9a-fA-F]{40})/);
        if (m) address = address || m[1];
      }
    } catch (_) {}

    if (!address) {
      // 4) fallback to environment (last resort)
      address = process.env.ARBITRATION_SERVICE_ADDRESS;
    }

    if (!address) {
      console.error('No ArbitrationService address found. I tried server/config/deployment-summary.json, front/src/utils/contracts/deployment-summary.json, ./output.log and ARBITRATION_SERVICE_ADDRESS env var.\nPlease run the deploy script to produce a deployment-summary.json or set ARBITRATION_SERVICE_ADDRESS.');
      process.exit(1);
    }

    const contract = new ethers.Contract(address, abi, provider);
    const owner = await contract.owner();
    console.log('ArbitrationService owner:', owner);
  } catch (e) {
    console.error('Error:', e && e.message || e);
    process.exit(1);
  }
})();
