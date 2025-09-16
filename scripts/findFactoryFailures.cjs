const { ethers } = require('ethers');
const fs = require('fs');

async function main() {
  const rpc = process.argv[2] || process.env.PROVIDER_URL || 'http://127.0.0.1:8545';
  const factory = process.argv[3] || '0x0165878A594ca255338adfa4d48449f69242Eb8F';
  const span = parseInt(process.argv[4] || '500', 10);
  const provider = new ethers.JsonRpcProvider(rpc);
  const latest = await provider.getBlockNumber();
  const start = Math.max(0, latest - span + 1);
  console.log(`Scanning blocks ${start}..${latest} for failed txs to factory ${factory}`);
  const failures = [];
  for (let b = start; b <= latest; ++b) {
    const hex = '0x' + b.toString(16);
    const block = await provider.send('eth_getBlockByNumber', [hex, true]);
    if (!block || !block.transactions) continue;
    for (const tx of block.transactions) {
      if (tx.to && tx.to.toLowerCase() === factory.toLowerCase()) {
        const receipt = await provider.getTransactionReceipt(tx.hash);
        if (receipt && receipt.status === 0) {
          failures.push({ tx: tx.hash, block: b, from: tx.from });
        }
      }
    }
  }
  if (failures.length === 0) {
    console.log('No failed transactions to factory found in range');
    return;
  }
  console.log('Found failed txs:', failures.length);
  for (const f of failures) {
    console.log(' -', f.tx, 'block', f.block, 'from', f.from);
    // attempt to eth_call the tx data to get revert reason
    try {
      const tx = await provider.getTransaction(f.tx);
      const blockHex = '0x' + (f.block - 1).toString(16);
      const res = await provider.send('eth_call', [{ to: tx.to, data: tx.data, from: tx.from }, blockHex]);
      if (res && res !== '0x') console.log('   eth_call result:', res);
    } catch (err) {
      console.log('   eth_call error:', err && err.message ? err.message : err);
    }
  }
}

main().catch(e => { console.error(e && e.message || e); process.exit(1); });
