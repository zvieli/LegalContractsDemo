#!/usr/bin/env node
/*
  restore-active.cjs

  Restore the `active` boolean (previously flipped by recover-activate) back to false by
  writing zero to the storage slot that held the boolean (slot 6 in your run).

  USAGE:
    node scripts/restore-active.cjs <contractAddress> [slotIndex] [rpcUrl]

  WARNING: Only run on local Hardhat/test nodes you control. Do NOT run on mainnet.
*/

const { ethers } = require('ethers');

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node scripts/restore-active.cjs <contractAddress> [slotIndex] [rpcUrl]');
    process.exit(2);
  }
  const [contractAddress, slotIndexArg = '6', rpcUrl = 'http://127.0.0.1:8545'] = args;
  const slotIndex = Number(slotIndexArg);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const abi = ['function active() view returns (bool)'];
  const rc = new ethers.Contract(contractAddress, abi, provider);

  try {
    const before = await rc.active().catch(() => null);
    console.log('active() before:', before);
  } catch (_) {}

  const slotHex = '0x' + slotIndex.toString(16).padStart(64, '0');
  const zeroWord = '0x' + '0'.repeat(64);
  try {
    await provider.send('hardhat_setStorageAt', [contractAddress, slotHex, zeroWord]);
    console.log('Wrote zero to slot', slotIndex);
  } catch (e) {
    console.error('hardhat_setStorageAt failed:', e?.message || e);
    process.exit(3);
  }

  // Mine a block (Hardhat will auto-mine, but ensure state update by requesting blockNumber)
  await provider.send('evm_mine', []);

  try {
    const after = await rc.active();
    console.log('active() after:', after);
  } catch (e) {
    console.error('Could not call active() after write:', e?.message || e);
    process.exit(4);
  }
}

main().catch((e) => { console.error(e); process.exit(99); });
