const { ethers } = require('ethers');
const path = require('path');

async function main(){
  const txHash = process.argv[2];
  if(!txHash){ console.error('Usage: node decodeFinalize.cjs <txHash> [rpc]'); process.exit(2); }
  const rpc = process.argv[3] || process.env.RPC_URL || 'http://localhost:8545';
  const provider = new ethers.JsonRpcProvider(rpc);

  const abiPath = path.join(__dirname, '..', 'front', 'src', 'utils', 'contracts', 'EnhancedRentContract.json');
  let abiJson;
  try { abiJson = require(abiPath); } catch(e){ console.error('Failed to load ABI', e); process.exit(3); }
  const iface = new ethers.Interface(abiJson.abi || abiJson);

  const receipt = await provider.getTransactionReceipt(txHash);
  if(!receipt){ console.error('Receipt not found for', txHash); process.exit(4); }
  console.log('Receipt blockNumber', receipt.blockNumber);
  for(const log of receipt.logs){
    try{
      const parsed = iface.parseLog(log);
      console.log('\nEvent:', parsed.name);
      console.log(' address:', log.address);
      console.log(' raw args array-like:', parsed.args);
      console.log(' raw args keys:', Object.keys(parsed.args));
      const argsOut = {};
      for(const input of parsed.eventFragment.inputs){
        let val = parsed.args[input.name];
        if (val == null) {
          // fallback to numeric index
          const idx = parsed.eventFragment.inputs.indexOf(input);
          val = parsed.args[idx];
        }
        argsOut[input.name || '_unknown'] = val != null ? val.toString() : null;
      }
      console.log(' args:', argsOut);
    } catch(e){ /* not from this iface or unknown topic */ }
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
