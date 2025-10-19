import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';

async function main() {
  const rpc = process.env.E2E_RPC_URL || 'http://localhost:8545';
  const provider = new ethers.JsonRpcProvider(rpc);
  const signer = provider.getSigner(0);

  const contractAddress = '0x9076fB433FD2FC0eAe5D5d4D8D0060aa324B78b4'; // EnhancedRentContract deployed per logs
  // Frontend copies of ABIs are available under front/src/utils/contracts
  const candidatePaths = [
    path.resolve(process.cwd(), 'front', 'src', 'utils', 'contracts', 'EnhancedRentContract.json'),
    path.resolve(process.cwd(), 'src', 'utils', 'contracts', 'EnhancedRentContract.json'),
    path.resolve(process.cwd(), 'front', 'EnhancedRentContract.json'),
  ];
  let abiPath = null;
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) { abiPath = p; break; }
  }
  if (!abiPath) {
    console.error('ABI not found in any candidate path:', candidatePaths);
    process.exit(1);
  }
  const json = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
  const abi = json.abi;
  const contract = new ethers.Contract(contractAddress, abi, signer);

  console.log('Connected to RPC', rpc);
  console.log('Contract at', contractAddress);

  // Look up the ABI to find which function corresponds to selector 0xe7ac8bbf
  const targetSelector = '0xe7ac8bbf';
  let found = false;
  for (const entry of abi) {
    if (entry.type !== 'function') continue;
    const fnName = entry.name;
    const sig = fnName + '(' + (entry.inputs || []).map(i => i.type).join(',') + ')';
    const sel = ethers.id(sig).slice(0, 10);
    if (sel === targetSelector) {
      found = true;
      console.log('Matched selector', targetSelector, 'to function', fnName, 'signature', sig);
      // Build dummy args for common types
      const args = (entry.inputs || []).map(i => {
        if (i.type.startsWith('uint') || i.type === 'uint256') return 0;
        if (i.type === 'address') return '0x0000000000000000000000000000000000000000';
        if (i.type === 'bytes32') return ethers.ZeroHash || '0x' + '0'.repeat(64);
        if (i.type === 'string') return '';
        if (i.type === 'bool') return false;
        // fallback
        return 0;
      });
      console.log('Attempting estimateGas for', fnName, 'with dummy args', args);
      try {
        // use contract.estimateGas[fnName](...args) if available
        const gas = await contract.estimateGas[fnName](...args);
        console.log('EstimateGas for', fnName, '=', gas.toString());
      } catch (err) {
        console.error('estimateGas error for', fnName, err && err.message ? err.message : err);
        try { if (err && err.error && err.error.data) console.error('error.data:', err.error.data); } catch (e) {}
      }
    }
  }
  if (!found) {
    console.log('No ABI function matched selector', targetSelector, "— dumping function selectors for inspection:");
    for (const entry of abi) {
      if (entry.type !== 'function') continue;
      const sig = entry.name + '(' + (entry.inputs || []).map(i => i.type).join(',') + ')';
      console.log('  ', ethers.id(sig).slice(0,10), sig);
    }
  }
  // Also attempt a raw call with the selector alone to reproduce the exact failing payload
  try {
    console.log('\nAttempting raw call with data', targetSelector);
    const resp = await provider.call({ to: contractAddress, data: targetSelector });
    console.log('Raw call response:', resp);
  } catch (err) {
    console.error('Raw call error:', err && err.message ? err.message : err);
    try { if (err && err.error && err.error.data) console.error('error.data:', err.error.data); } catch (e) {}
  }
}

main().catch(e => { console.error(e); process.exit(1); });
