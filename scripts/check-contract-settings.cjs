#!/usr/bin/env node
const { ethers } = require('ethers');

async function main() {
  const addr = process.argv[2];
  if (!addr) {
    console.error('Usage: node check-contract-settings.cjs <contractAddress> [rpcUrl]');
    process.exit(1);
  }
  const rpc = process.argv[3] || process.env.RPC_URL || 'http://localhost:8545';
  const provider = new ethers.JsonRpcProvider(rpc);

  const abi = [
    'function startDate() view returns (uint256)',
    'function durationDays() view returns (uint256)',
  'function cancellationFeeBps() view returns (uint16)',
    'function cancelInitiator() view returns (address)',
    'function landlord() view returns (address)',
    'function tenant() view returns (address)',
    'function getCancellationRefunds() view returns (uint256,uint256,uint256)'
  ];

  const contract = new ethers.Contract(addr, abi, provider);

  console.log('RPC:', rpc);
  console.log('Contract:', addr);

  // Helper to call safely
  async function safeCall(fnName) {
    try {
      const res = await contract[fnName]();
      return res;
    } catch (e) {
      return { error: String(e) };
    }
  }

  const balance = await provider.getBalance(addr).catch((e) => ({ error: String(e) }));
  console.log('\nContract balance: ', typeof balance === 'object' && balance.error ? balance.error : ethers.formatEther(balance) + ' ETH');

  const startDateR = await safeCall('startDate');
  if (startDateR && startDateR.error) console.log('startDate: ERROR ->', startDateR.error); else {
    const sd = BigInt(startDateR || 0n);
    console.log('startDate (raw):', sd.toString());
    try { console.log('startDate (iso):', sd === 0n ? '0' : new Date(Number(sd) * 1000).toISOString()); } catch(e){}
  }

  const durationDaysR = await safeCall('durationDays');
  if (durationDaysR && durationDaysR.error) console.log('durationDays: ERROR ->', durationDaysR.error); else console.log('durationDays:', BigInt(durationDaysR).toString());

  const feeBpsR = await safeCall('cancellationFeeBps');
  if (feeBpsR && feeBpsR.error) console.log('cancellationFeeBps: ERROR ->', feeBpsR.error); else console.log('cancellationFeeBps:', Number(feeBpsR));

  const initiatorR = await safeCall('cancelInitiator');
  if (initiatorR && initiatorR.error) console.log('cancelInitiator: ERROR ->', initiatorR.error); else console.log('cancelInitiator:', String(initiatorR));

  const landlordR = await safeCall('landlord');
  if (landlordR && landlordR.error) console.log('landlord: ERROR ->', landlordR.error); else console.log('landlord:', String(landlordR));

  const tenantR = await safeCall('tenant');
  if (tenantR && tenantR.error) console.log('tenant: ERROR ->', tenantR.error); else console.log('tenant:', String(tenantR));

  // Derive approver (non-initiator) for display
  try {
    const initiator = String(initiatorR || '0x0000000000000000000000000000000000000000');
    const landlord = String(landlordR || '0x0000000000000000000000000000000000000000');
    const tenant = String(tenantR || '0x0000000000000000000000000000000000000000');
    let approver = 'unknown';
    if (initiator && initiator !== '0x0000000000000000000000000000000000000000') {
      approver = (initiator.toLowerCase() === landlord.toLowerCase()) ? tenant : landlord;
    }
    console.log('Approver (fee recipient):', approver);
  } catch (e) { void e; }

  // getCancellationRefunds
  try {
    const refunds = await contract.getCancellationRefunds();
    const t = BigInt(refunds[0] || 0n);
    const l = BigInt(refunds[1] || 0n);
    const f = BigInt(refunds[2] || 0n);
    console.log('\ngetCancellationRefunds ->');
    console.log('  tenantRefund:', ethers.formatEther(t), 'ETH');
    console.log('  landlordShare:', ethers.formatEther(l), 'ETH');
    console.log('  fee:', ethers.formatEther(f), 'ETH');
  } catch (e) {
    console.log('\ngetCancellationRefunds: not available or failed ->', String(e));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
