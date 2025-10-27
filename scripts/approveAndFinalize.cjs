const { ethers } = require('ethers');
const path = require('path');

async function main() {
  const addr = process.argv[2];
  if (!addr) {
    console.error('Usage: node approveAndFinalize.cjs <contractAddress>');
    process.exit(2);
  }

  const RPC = process.env.RPC_URL || 'http://localhost:8545';
  console.log('Using RPC:', RPC);
  const provider = new ethers.JsonRpcProvider(RPC);

  if (!process.env.PRIVATE_KEY) {
    console.error('Please set PRIVATE_KEY env var to the approver (landlord) private key');
    process.exit(3);
  }

  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log('Using signer:', signer.address);

  // load ABI
  const abiPath = path.join(__dirname, '..', 'front', 'src', 'utils', 'contracts', 'EnhancedRentContract.json');
  let abiJson;
  try { abiJson = require(abiPath); } catch (e) { console.error('Failed to load ABI', e); process.exit(4); }
  const abi = abiJson.abi || abiJson;

  const c = new ethers.Contract(addr, abi, signer);

  // read parties and balances
  const landlord = String((await c.landlord()).toString());
  const tenant = String((await c.tenant()).toString());
  console.log('landlord:', landlord);
  console.log('tenant:', tenant);

  const balBefore = {};
  balBefore.contract = await provider.getBalance(addr);
  balBefore.landlord = await provider.getBalance(landlord);
  balBefore.tenant = await provider.getBalance(tenant);

  console.log('\nBalances before:');
  console.log(' contract:', ethers.formatEther(balBefore.contract), 'ETH');
  console.log(' landlord:', ethers.formatEther(balBefore.landlord), 'ETH');
  console.log(' tenant:', ethers.formatEther(balBefore.tenant), 'ETH');

  // Approve cancellation
  if (typeof c.approveCancellation !== 'function') {
    console.error('Contract does not expose approveCancellation()');
    process.exit(5);
  }
  try {
    console.log('\nCalling approveCancellation()...');
    const tx = await c.approveCancellation();
    console.log('approve tx hash:', tx.hash);
    await tx.wait();
    console.log('approve confirmed');
  } catch (e) {
    // If already approved, continue. Otherwise log and continue as well so we can attempt finalize.
    console.log('approveCancellation: call failed or already approved ->', e?.message || e);
  }

  // Finalize mutual cancellation (this is callable by either party when both have approved)
  if (typeof c.finalizeMutualCancellation !== 'function') {
    console.error('Contract does not expose finalizeMutualCancellation()');
    process.exit(7);
  }
  try {
    console.log('\nCalling finalizeMutualCancellation()...');
    const tx2 = await c.finalizeMutualCancellation();
    console.log('finalize tx hash:', tx2.hash);
    const receipt = await tx2.wait();
    console.log('finalize confirmed in block', receipt.blockNumber);
  } catch (e) {
    console.error('finalizeMutualCancellation failed:', e?.message || e);
    process.exit(8);
  }

  // read balances after
  const balAfter = {};
  balAfter.contract = await provider.getBalance(addr);
  balAfter.landlord = await provider.getBalance(landlord);
  balAfter.tenant = await provider.getBalance(tenant);

  console.log('\nBalances after:');
  console.log(' contract:', ethers.formatEther(balAfter.contract), 'ETH');
  console.log(' landlord:', ethers.formatEther(balAfter.landlord), 'ETH');
  console.log(' tenant:', ethers.formatEther(balAfter.tenant), 'ETH');

  // show getCancellationRefunds post-finalize (should be zeros or unchanged depending on implementation)
  try {
    const refunds = await c.getCancellationRefunds();
    console.log('\ngetCancellationRefunds after finalize:');
    console.log(' tenantRefund:', ethers.formatEther(BigInt(refunds[0] || 0n)));
    console.log(' landlordShare:', ethers.formatEther(BigInt(refunds[1] || 0n)));
    console.log(' fee:', ethers.formatEther(BigInt(refunds[2] || 0n)));
  } catch (e) { console.log('getCancellationRefunds failed after finalize ->', String(e)); }

  // Compute deltas
  try {
    const toBN = (v) => BigInt(v.toString());
    console.log('\nDeltas:');
    console.log(' contract delta (ETH):', ethers.formatEther(toBN(balAfter.contract) - toBN(balBefore.contract)));
    console.log(' landlord delta (ETH):', ethers.formatEther(toBN(balAfter.landlord) - toBN(balBefore.landlord)));
    console.log(' tenant delta (ETH):', ethers.formatEther(toBN(balAfter.tenant) - toBN(balBefore.tenant)));
  } catch (e) { void e; }
}

main().catch((e) => { console.error(e); process.exit(1); });
