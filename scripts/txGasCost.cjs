const { ethers } = require('ethers');

async function main(){
  const txHash = process.argv[2];
  if(!txHash){
    console.error('Usage: node txGasCost.cjs <txHash> [rpc]');
    process.exit(2);
  }
  const rpc = process.argv[3] || process.env.RPC_URL || 'http://localhost:8545';
  const provider = new ethers.JsonRpcProvider(rpc);
  const receipt = await provider.getTransactionReceipt(txHash);
  const tx = await provider.getTransaction(txHash);
  if(!receipt){ console.error('Receipt not found'); process.exit(3); }
  const gasUsed = BigInt(receipt.gasUsed?.toString() || '0');
  // effectiveGasPrice might be on receipt (EIP-1559)
  const gasPrice = receipt.effectiveGasPrice ? BigInt(receipt.effectiveGasPrice.toString()) : (tx.gasPrice ? BigInt(tx.gasPrice.toString()) : 0n);
  const cost = gasUsed * gasPrice;
  console.log('tx:', txHash);
  console.log(' blockNumber:', receipt.blockNumber);
  console.log(' gasUsed:', gasUsed.toString());
  console.log(' gasPrice (wei):', gasPrice.toString());
  console.log(' gas cost (wei):', cost.toString());
  try { console.log(' gas cost (ETH):', ethers.formatEther(cost)); } catch(e){}
}

main().catch(e=>{ console.error(e); process.exit(1); });
