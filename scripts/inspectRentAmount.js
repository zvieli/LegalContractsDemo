import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';

(async () => {
  try {
    const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    // Address taken from your logs (EnhancedRentContract)
  const addr = process.argv[2] || '0x9076fb433fd2fc0eae5d5d4d8d0060aa324b78b4';
    // Find ABI for EnhancedRentContract under artifacts/contracts
    const artifactsContractsDir = path.resolve(process.cwd(), 'artifacts', 'contracts');
    let json = null;
    const walk = (dir) => {
      const items = fs.readdirSync(dir);
      for (const it of items) {
        const p = path.join(dir, it);
        const stat = fs.statSync(p);
        if (stat.isDirectory()) {
          const found = walk(p);
          if (found) return found;
        } else {
          if (it === 'EnhancedRentContract.json') return p;
        }
      }
      return null;
    };
    const foundPath = walk(artifactsContractsDir);
    if (!foundPath) {
      console.error('EnhancedRentContract.json not found under', artifactsContractsDir);
      process.exit(1);
    }
    json = JSON.parse(fs.readFileSync(foundPath, 'utf8'));
    const abi = json.abi;
    const c = new ethers.Contract(addr, abi, provider);
    const rentAmount = await c.rentAmount();
    console.log('Raw rentAmount:', String(rentAmount));
    try {
      const formatted = ethers.formatEther(rentAmount);
      console.log('Formatted (ETH):', formatted);
    } catch (e) {
      console.log('Could not format rentAmount as ETH:', e.message);
    }
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
})();