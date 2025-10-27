const { ethers } = require('ethers');
const path = require('path');

async function main() {
  const addr = process.argv[2];
  if (!addr) {
    console.error('Usage: node checkCancellationPreview.cjs <contractAddress>');
    process.exit(2);
  }

  const RPC = process.env.RPC_URL || 'http://localhost:8545';
  console.log('Using RPC:', RPC);
  const provider = new ethers.JsonRpcProvider(RPC);

  // load ABI
  const abiPath = path.join(__dirname, '..', 'front', 'src', 'utils', 'contracts', 'TemplateRentContract.json');
  let abiJson;
  try {
    abiJson = require(abiPath);
  } catch (e) {
    console.error('Failed to load ABI at', abiPath, e);
    process.exit(3);
  }
  const abi = abiJson.abi || abiJson;

  const c = new ethers.Contract(addr, abi, provider);
  try {
    const [cancellationFeeBps, startDate, durationDays, cancelRequested, cancelInitiator, cancelEffectiveAt] = await Promise.all([
      c.cancellationFeeBps?.().catch(() => null),
      c.startDate?.().catch(() => null),
      c.durationDays?.().catch(() => null),
      c.cancelRequested?.().catch(() => null),
      c.cancelInitiator?.().catch(() => null),
      c.cancelEffectiveAt?.().catch(() => null),
    ]);

    const refunds = await c.getCancellationRefunds().catch((e) => { console.error('getCancellationRefunds failed', e); return null; });
    const balance = await provider.getBalance(addr).catch(() => null);

    console.log('\nContract:', addr);
    console.log('RPC balance (wei):', balance ? balance.toString() : 'n/a');
    console.log('RPC balance (eth):', balance ? ethers.formatEther(balance) : 'n/a');
    console.log('\ncancellationFeeBps:', cancellationFeeBps != null ? cancellationFeeBps.toString() : 'n/a');
    console.log('startDate (unix):', startDate != null ? startDate.toString() : 'n/a');
    if (startDate) console.log('startDate (iso):', new Date(Number(startDate) * 1000).toISOString());
    console.log('durationDays:', durationDays != null ? durationDays.toString() : 'n/a');
    console.log('cancelRequested:', cancelRequested != null ? String(cancelRequested) : 'n/a');
    console.log('cancelInitiator:', cancelInitiator != null ? String(cancelInitiator) : 'n/a');
    console.log('cancelEffectiveAt:', cancelEffectiveAt != null ? cancelEffectiveAt.toString() : 'n/a');

    if (refunds) {
      const tenantRefund = refunds[0] || refunds.tenantRefund || 0n;
      const landlordShare = refunds[1] || refunds.landlordShare || 0n;
      const fee = refunds[2] || refunds.fee || 0n;
      console.log('\ngetCancellationRefunds (raw wei):');
      console.log(' tenantRefund:', String(tenantRefund));
      console.log(' landlordShare:', String(landlordShare));
      console.log(' fee:', String(fee));
      try {
        console.log('\nFormatted (ETH):');
        console.log(' tenantRefund:', ethers.formatEther(BigInt(tenantRefund || 0n)));
        console.log(' landlordShare:', ethers.formatEther(BigInt(landlordShare || 0n)));
        console.log(' fee:', ethers.formatEther(BigInt(fee || 0n)));
      } catch (e) { void e; }
    } else {
      console.log('\ngetCancellationRefunds: failed or returned null');
    }

  } catch (e) {
    console.error('Error querying contract:', e);
    process.exit(4);
  }
}

main();
