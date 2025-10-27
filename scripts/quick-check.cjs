#!/usr/bin/env node
const { ethers } = require('ethers');

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node scripts/quick-check.cjs <contractAddress> [rpcUrl]');
    process.exit(2);
  }
  const [contractAddress, rpcUrl = 'http://127.0.0.1:8545'] = args;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const abi = ['function active() view returns (bool)', 'function escrowBalance() view returns (uint256)', 'function partyDeposit(address) view returns (uint256)', 'function landlord() view returns (address)', 'function tenant() view returns (address)'];
  const rc = new ethers.Contract(contractAddress, abi, provider);
  try {
    const active = await rc.active().catch(() => null);
    const escrow = await rc.escrowBalance().catch(() => 0n);
    const landlord = await rc.landlord().catch(() => ethers.ZeroAddress);
    const tenant = await rc.tenant().catch(() => ethers.ZeroAddress);
    const depositL = await rc.partyDeposit(landlord).catch(() => 0n);
    const depositT = await rc.partyDeposit(tenant).catch(() => 0n);
    console.log('active:', active);
    console.log('escrowBalance:', ethers.formatEther(escrow || 0n));
    console.log('contract balance:', ethers.formatEther(await provider.getBalance(contractAddress)));
    console.log('landlord:', landlord);
    console.log('tenant:', tenant);
    console.log('landlord.partyDeposit:', ethers.formatEther(depositL || 0n));
    console.log('tenant.partyDeposit:', ethers.formatEther(depositT || 0n));
  } catch (e) {
    console.error('quick-check failed:', e?.message || e);
    process.exit(3);
  }
}

main().catch((e) => { console.error(e); process.exit(99); });
