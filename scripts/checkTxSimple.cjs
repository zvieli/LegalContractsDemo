const ethersLib = require('ethers');

const hash = process.argv[2];
if (!hash) {
  console.error('Usage: node scripts/checkTxSimple.cjs <txHash>');
  process.exit(1);
}

const RPC = process.env.ETH_RPC || 'https://cloudflare-eth.com';
const provider = new ethersLib.providers.JsonRpcProvider(RPC);

(async () => {
  try {
    const tx = await provider.getTransaction(hash);
    if (!tx) return console.error('Transaction not found');
    console.log('txHash:', tx.hash);
  console.log('value (wei):', tx.value.toString());
  console.log('value (ETH):', ethersLib.utils.formatEther(tx.value));
  } catch (err) {
    console.error('Error:', err && err.message ? err.message : err);
    process.exit(2);
  }
})();
const { ethers } = require('ethers');
const path = require('path');

async function main() {
  const rpc = process.argv[2] || 'http://127.0.0.1:8545';
  const txHash = process.argv[3];
  if (!txHash) {
    console.error('Usage: node scripts/checkTxSimple.cjs <rpc> <txHash>');
    process.exit(1);
  }
  const provider = new ethers.JsonRpcProvider(rpc);
  console.log('Using RPC:', rpc);
  const tx = await provider.getTransaction(txHash);
  const receipt = await provider.getTransactionReceipt(txHash);
  console.log('tx found?', !!tx, 'receipt found?', !!receipt);
  if (tx) console.log('tx.to =', tx.to, 'from =', tx.from, 'value =', tx.value && tx.value.toString());
  if (receipt) console.log('receipt.status =', receipt.status, 'blockNumber =', receipt.blockNumber, 'gasUsed =', receipt.gasUsed && receipt.gasUsed.toString());

  // Load ABI for TemplateRentContract if available
  try {
    const abiPath = path.join(__dirname, '..', 'front', 'src', 'utils', 'contracts', 'TemplateRentContractABI.json');
    const abi = require(abiPath);
    const iface = new ethers.Interface(abi);
    if (receipt && receipt.logs && receipt.logs.length) {
      console.log('Logs:', receipt.logs.length);
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          console.log('Parsed log:', parsed.name, parsed.args);
        } catch (e) {
          console.log('Unparsed log topics[0]=', log.topics && log.topics[0]);
        }
      }
    } else {
      console.log('No logs in receipt');
    }

    // If tx.to is a contract, print code length
    if (tx && tx.to) {
      const code = await provider.getCode(tx.to);
      console.log('code length at tx.to =', code && code !== '0x' ? code.length/2 : 0);
    }
  } catch (e) {
    console.error('Error parsing logs or loading ABI:', e && e.message);
  }
}

main().catch(e => { console.error(e && e.message); process.exit(1); });
