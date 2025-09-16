const { ethers } = require('ethers');

async function main() {
  const rpc = process.argv[2] || process.env.PROVIDER_URL || 'http://127.0.0.1:8545';
  const txHash = process.argv[3];
  const contractAddr = process.argv[4];
  if (!txHash) {
    console.error('Usage: node scripts/inspectRpc.cjs <rpcUrl> <txHash> [contractAddr]');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  console.log('Using RPC:', rpc);

  const tx = await provider.getTransaction(txHash);
  const receipt = await provider.getTransactionReceipt(txHash);
  console.log('tx found?', !!tx, 'receipt found?', !!receipt);
  if (tx) console.log('tx.to =', tx.to, 'from =', tx.from);
  if (receipt) console.log('receipt.status =', receipt.status, 'blockNumber =', receipt.blockNumber, 'gasUsed =', receipt.gasUsed && receipt.gasUsed.toString());

  if (tx && tx.to) {
    const code = await provider.getCode(tx.to);
    console.log('code length at tx.to =', code && code !== '0x' ? code.length/2 : 0);
  }

  if (receipt && receipt.blockNumber) {
    try {
      const blockHex = '0x' + receipt.blockNumber.toString(16);
      const callRes = await provider.send('eth_call', [{ to: tx.to || contractAddr, data: tx.data || '0x', from: tx.from }, blockHex]);
      console.log('eth_call returned (raw):', callRes);
    } catch (err) {
      console.error('eth_call error:', err.message || err);
      // attempt to print revert data if present
      if (err && err.data) console.log('err.data =', err.data);
    }
  }

  if (contractAddr) {
    const code = await provider.getCode(contractAddr);
    console.log('code at contractAddr length =', code && code !== '0x' ? code.length/2 : 0);
  }
}

main().catch(e => { console.error(e && e.message || e); process.exit(1); });
