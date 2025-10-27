const { ethers } = require('ethers');
const path = require('path');
const { spawnSync } = require('child_process');

async function main() {
  const addr = process.argv[2];
  if (!addr) {
    console.error('Usage: node submitCancellation.cjs <contractAddress>');
    process.exit(2);
  }

  const RPC = process.env.RPC_URL || 'http://localhost:8545';
  console.log('Using RPC:', RPC);
  const provider = new ethers.JsonRpcProvider(RPC);

  // load ABI - try EnhancedRentContract first, fall back to TemplateRentContract
  const candidates = [
    path.join(__dirname, '..', 'front', 'src', 'utils', 'contracts', 'EnhancedRentContract.json'),
    path.join(__dirname, '..', 'front', 'src', 'utils', 'contracts', 'TemplateRentContract.json'),
  ];

  let abiJson = null;
  for (const p of candidates) {
    try {
      const j = require(p);
      abiJson = j.abi || j;
      console.log('Loaded ABI from', p);
      break;
    } catch (e) {
      // continue
    }
  }
  if (!abiJson) {
    console.error('Failed to load any contract ABI from front/src/utils/contracts');
    process.exit(3);
  }

  // Allow overriding the signer with PRIVATE_KEY env var (useful for local Hardhat accounts).
  let signer;
  if (process.env.PRIVATE_KEY) {
    try {
      signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
      console.log('Using PRIVATE_KEY from environment for signing (address=' + signer.address + ')');
    } catch (e) {
      console.error('Invalid PRIVATE_KEY provided:', e?.message || e);
      process.exit(6);
    }
  } else {
    signer = provider.getSigner(0);
    try {
      // Try to read address for logging; some providers may not support this
      const addrLog = await signer.getAddress().catch(() => null);
      if (addrLog) console.log('Using provider signer index 0 (address=' + addrLog + ')');
    } catch (e) { void e; }
  }

  let contract = new ethers.Contract(addr, abiJson, signer);

  if (typeof contract.initiateCancellation !== 'function') {
    console.error('Contract at address does not expose initiateCancellation()');
    process.exit(4);
  }

  try {
    console.log('Estimating gas for initiateCancellation...');
    if (contract.estimateGas && typeof contract.estimateGas.initiateCancellation === 'function') {
      const g = await contract.estimateGas.initiateCancellation();
      console.log('Estimated gas:', g.toString());
    }
  } catch (e) { void e; }

  try {
    console.log('Sending initiateCancellation transaction...');
    const tx = await contract.initiateCancellation();
    console.log('TX hash:', tx.hash);
    console.log('Waiting for confirmation...');
    const receipt = await tx.wait();
    console.log('Confirmed in block', receipt.blockNumber);
  } catch (e) {
    console.error('Failed to send initiateCancellation:', e?.message || e);
    process.exit(5);
  }

  // Run the preview script to show updated refunds
  try {
    console.log('\nRe-running preview script to show updated refunds:\n');
    const res = spawnSync(process.execPath, [path.join(__dirname, 'checkCancellationPreview.cjs'), addr], { stdio: 'inherit' });
    if (res.error) {
      console.error('Failed to run preview script:', res.error);
    }
  } catch (e) { console.error('Error running preview script:', e); }
}

main();
