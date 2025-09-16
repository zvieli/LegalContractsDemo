const pkg = require('hardhat');
const { ethers } = pkg;

async function main() {
  const txHash = process.argv[2];
  if (!txHash) {
    console.error('Usage: node scripts/inspectTx.cjs <txHash>');
    process.exit(1);
  }

  const provider = ethers.provider;
  console.log('Inspecting tx', txHash);
  const tx = await provider.getTransaction(txHash);
  const receipt = await provider.getTransactionReceipt(txHash);
  console.log('tx.to =', tx && tx.to);
  console.log('tx.from =', tx && tx.from);
  console.log('receipt.status =', receipt && receipt.status);
  console.log('receipt.gasUsed =', receipt && receipt.gasUsed && receipt.gasUsed.toString());
  console.log('receipt.blockNumber =', receipt && receipt.blockNumber);

  // show code at destination
  const dest = tx.to;
  const code = await provider.getCode(dest);
  console.log('code length at dest =', code ? code.length / 2 : 0, 'bytes');

  // Attempt eth_call at the same block to get revert data
  try {
    const blockTag = receipt && receipt.blockNumber ? '0x' + receipt.blockNumber.toString(16) : 'latest';
    const callRes = await provider.send('eth_call', [{ to: dest, data: tx.data, from: tx.from }, blockTag]);
    console.log('eth_call returned:', callRes);
  } catch (err) {
    // If the RPC returns error with data, try to extract
    console.error('eth_call threw:', err && err.message ? err.message : err);
    if (err && err.data) {
      try {
        const data = typeof err.data === 'string' ? err.data : (err.data.result || err.data);
        console.log('revert data:', data);
        decodeRevert(data);
      } catch (e) {
        console.error('could not parse revert data:', e && e.message ? e.message : e);
      }
    }
  }

  // Try provider.call directly (ethers) to capture revert data
  try {
    const res = await provider.call({ to: dest, data: tx.data, from: tx.from }, receipt.blockNumber - 1);
    console.log('provider.call returned:', res);
  } catch (err) {
    console.error('provider.call threw:', err && err.message ? err.message : err);
    if (err && err.error && err.error.data) {
      console.log('err.error.data =', err.error.data);
      decodeRevert(err.error.data);
    }
  }

  function decodeRevert(data) {
    if (!data || data === '0x') { console.log('no revert data'); return; }
    // standard Error(string) selector
    const sig = data.slice(0, 10);
    if (sig === '0x08c379a0') {
      // skip selector and decode as string
      const encoded = '0x' + data.slice(10);
      try {
        const reason = ethers.defaultAbiCoder.decode(['string'], encoded)[0];
        console.log('Revert reason:', reason);
      } catch (e) {
        console.log('Could not decode Error(string) payload:', e && e.message ? e.message : e);
      }
    } else {
      console.log('Non-standard revert selector:', sig, 'raw:', data);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
