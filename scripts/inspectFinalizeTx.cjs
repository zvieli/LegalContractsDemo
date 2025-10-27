const { ethers } = require('ethers');
const path = require('path');

async function main(){
  const txHash = process.argv[2];
  if(!txHash){ console.error('Usage: node inspectFinalizeTx.cjs <txHash> [rpc]'); process.exit(2); }
  const rpc = process.argv[3] || process.env.RPC_URL || 'http://localhost:8545';
  const provider = new ethers.JsonRpcProvider(rpc);

  console.log('Using RPC:', rpc);
  const receipt = await provider.getTransactionReceipt(txHash);
  if(!receipt){ console.error('Receipt not found for', txHash); process.exit(3); }
  const block = receipt.blockNumber;
  const prevBlock = (typeof block === 'number' && block > 0) ? block - 1 : block;
  console.log('Tx', txHash, 'in block', block, 'prevBlock', prevBlock);

  const to = receipt.to;
  if(!to){ console.error('Transaction has no `to` address'); }

  // load ABI
  const abiPath = path.join(__dirname, '..', 'front', 'src', 'utils', 'contracts', 'EnhancedRentContract.json');
  let abiJson;
  try { abiJson = require(abiPath); } catch(e){ console.error('Failed to load ABI', abiPath, e); process.exit(4); }
  const iface = new ethers.Interface(abiJson.abi || abiJson);

  // helper to call view functions at a specific block
  const callAtBlock = async (fnName, blockTag) => {
    try{
      const data = iface.encodeFunctionData(fnName, []);
      const res = await provider.call({ to, data }, blockTag);
      const decoded = iface.decodeFunctionResult(fnName, res);
      // return first value or full
      if (decoded && decoded.length === 1) return decoded[0];
      return decoded;
    }catch(e){ return null; }
  };

  // get landlord/tenant via call (if available)
  const landlordPrev = await callAtBlock('landlord', prevBlock);
  const tenantPrev = await callAtBlock('tenant', prevBlock);
  const landlordNow = await callAtBlock('landlord', block);
  const tenantNow = await callAtBlock('tenant', block);

  const landlord = landlordNow || landlordPrev || null;
  const tenant = tenantNow || tenantPrev || null;

  console.log('Contract (to):', to);
  console.log('Landlord:', landlord);
  console.log('Tenant:', tenant);

  // balances
  const bal = async (addr, blk) => {
    try{ const b = await provider.getBalance(addr, blk); return b; } catch(e){ return null; }
  };

  const contractBalPrev = await bal(to, prevBlock);
  const contractBalNow = await bal(to, block);
  const landlordBalPrev = landlord ? await bal(landlord, prevBlock) : null;
  const landlordBalNow = landlord ? await bal(landlord, block) : null;
  const tenantBalPrev = tenant ? await bal(tenant, prevBlock) : null;
  const tenantBalNow = tenant ? await bal(tenant, block) : null;

  console.log('\nBalances at block', prevBlock + ':');
  console.log(' contract:', contractBalPrev ? contractBalPrev.toString() + ' wei (' + ethers.formatEther(contractBalPrev) + ' ETH)' : 'n/a');
  console.log(' landlord:', landlordBalPrev ? landlordBalPrev.toString() + ' wei (' + ethers.formatEther(landlordBalPrev) + ' ETH)' : 'n/a');
  console.log(' tenant :', tenantBalPrev ? tenantBalPrev.toString() + ' wei (' + ethers.formatEther(tenantBalPrev) + ' ETH)' : 'n/a');

  console.log('\nBalances at block', block + ':');
  console.log(' contract:', contractBalNow ? contractBalNow.toString() + ' wei (' + ethers.formatEther(contractBalNow) + ' ETH)' : 'n/a');
  console.log(' landlord:', landlordBalNow ? landlordBalNow.toString() + ' wei (' + ethers.formatEther(landlordBalNow) + ' ETH)' : 'n/a');
  console.log(' tenant :', tenantBalNow ? tenantBalNow.toString() + ' wei (' + ethers.formatEther(tenantBalNow) + ' ETH)' : 'n/a');

  const toBig = (v) => (v == null ? null : BigInt(v.toString()));
  const contractDelta = (toBig(contractBalNow) != null && toBig(contractBalPrev) != null) ? toBig(contractBalNow) - toBig(contractBalPrev) : null;
  const landlordDelta = (toBig(landlordBalNow) != null && toBig(landlordBalPrev) != null) ? toBig(landlordBalNow) - toBig(landlordBalPrev) : null;
  const tenantDelta = (toBig(tenantBalNow) != null && toBig(tenantBalPrev) != null) ? toBig(tenantBalNow) - toBig(tenantBalPrev) : null;

  console.log('\nDeltas (now - prev):');
  console.log(' contract delta:', contractDelta != null ? (contractDelta.toString() + ' wei (' + ethers.formatEther(contractDelta) + ' ETH)') : 'n/a');
  console.log(' landlord delta:', landlordDelta != null ? (landlordDelta.toString() + ' wei (' + ethers.formatEther(landlordDelta) + ' ETH)') : 'n/a');
  console.log(' tenant delta :', tenantDelta != null ? (tenantDelta.toString() + ' wei (' + ethers.formatEther(tenantDelta) + ' ETH)') : 'n/a');

  // decode logs in the receipt for PaymentWithdrawn / CancellationPays
  console.log('\nDecoded events in the receipt:');
  for(const log of receipt.logs){
    try{
      const parsed = iface.parseLog(log);
      const args = {};
      parsed.eventFragment.inputs.forEach((inp, idx) => {
        const v = parsed.args[idx];
        args[inp.name] = (v && typeof v.toString === 'function') ? v.toString() : String(v);
      });
      console.log(JSON.stringify({ event: parsed.name, args, txHash: receipt.transactionHash, blockNumber: receipt.blockNumber }));
    }catch(e){ /* ignore non-matching */ }
  }

  // Sanity: sum landlord+tenant+fee from CancellationPays if found
  try{
    const logs = receipt.logs.map(l => { try { return iface.parseLog(l); } catch(e){ return null; } }).filter(x=>x);
    const cp = logs.find(l => l.name === 'CancellationPays');
    if(cp){
      const tenantAmount = BigInt(cp.args.tenantAmount?.toString?.() || '0');
      const landlordAmount = BigInt(cp.args.landlordAmount?.toString?.() || '0');
      const fee = BigInt(cp.args.fee?.toString?.() || '0');
      console.log('\nCancellationPays amounts (wei): tenant', tenantAmount.toString(),' landlord', landlordAmount.toString(),' fee', fee.toString());
      console.log('Sum (ETH):', ethers.formatEther(tenantAmount + landlordAmount + fee));
    }
  }catch(e){ /* ignore */ }

}

main().catch(e=>{ console.error('Fatal', e); process.exit(1); });
