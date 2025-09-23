const ethers = require('ethers');

const hash = process.argv[2];
if (!hash) {
  console.error('Usage: node scripts/inspectTx.cjs <txHash>');
  process.exit(1);
}

// Public read-only RPC (no API key required for basic reads)
const RPC = process.env.ETH_RPC || 'https://cloudflare-eth.com';
const provider = new ethers.providers.JsonRpcProvider(RPC);

(async () => {
  try {
    const tx = await provider.getTransaction(hash);
    if (!tx) {
      console.error('Transaction not found via RPC:', RPC);
      process.exit(2);
    }

    const receipt = await provider.getTransactionReceipt(hash);

    console.log('txHash:', tx.hash);
    console.log('blockNumber:', tx.blockNumber);
    console.log('from:', tx.from);
    console.log('to:', tx.to);
    console.log('value (wei):', tx.value.toString());
    console.log('value (ETH):', ethers.utils.formatEther(tx.value));
    console.log('gasPrice (wei):', tx.gasPrice ? tx.gasPrice.toString() : 'n/a');
    console.log('gasPrice (gwei):', tx.gasPrice ? ethers.utils.formatUnits(tx.gasPrice, 'gwei') : 'n/a');
    console.log('gasLimit:', tx.gasLimit ? tx.gasLimit.toString() : 'n/a');
    if (receipt) {
      console.log('gasUsed:', receipt.gasUsed.toString());
      console.log('status:', receipt.status);
      console.log('confirmations:', receipt.confirmations || 'n/a');
    }

    const valueEth = parseFloat(ethers.utils.formatEther(tx.value));
    console.log('');
    if (Math.abs(valueEth - 100) < 1e-9) {
      console.log('Interpreted value: 100 ETH');
    } else if (Math.abs(valueEth - 0.5) < 1e-9) {
      console.log('Interpreted value: 0.5 ETH');
    } else {
      console.log(`Interpreted value: ${valueEth} ETH`);
    }
  } catch (err) {
    console.error('Error while fetching transaction:', err.message || err);
    process.exit(3);
  }
})();
const hre = require('hardhat');
const ethers = hre.ethers;
const path = require('path');

function loadAbiFromArtifacts(name) {
  try {
    const art = require(path.join(process.cwd(), 'artifacts', 'contracts', name + '.sol', name + '.json'));
    return art.abi;
  } catch (e) {
    try {
      return require(path.join(process.cwd(), 'front', 'src', 'utils', 'contracts', name + 'ABI.json'));
    } catch (e2) {
      return null;
    }
  }
}

(async function main() {
  try {
    const argv = process.argv.slice(2);
    let txHash = process.env.TX_HASH || (argv.length ? argv[argv.length - 1] : null);
    if (!txHash) {
      console.error('Usage: set env TX_HASH or pass txHash as script arg. Example (PowerShell): $env:TX_HASH="0x..."; npx hardhat run --network localhost scripts/inspectTx.cjs');
      process.exit(1);
    }
    const provider = ethers.provider;
    const tx = await provider.getTransaction(txHash);
    const rcpt = await provider.getTransactionReceipt(txHash);
    if (!tx || !rcpt) {
      console.error('Transaction or receipt not found');
      process.exit(2);
    }
    console.log('tx:', txHash);
    console.log(' from:', tx.from);
    console.log(' to:  ', tx.to);
    console.log(' value:', tx.value.toString());
    console.log(' status:', rcpt.status, 'block:', rcpt.blockNumber, 'gasUsed:', rcpt.gasUsed.toString());

    const names = ['TemplateRentContract', 'ArbitrationService', 'ContractFactory'];
    const candidateABIs = {};
    for (const n of names) {
      const a = loadAbiFromArtifacts(n);
      if (a) candidateABIs[n] = a;
    }
    if (Object.keys(candidateABIs).length) console.log('Loaded ABIs for:', Object.keys(candidateABIs).join(', '));

    for (let i = 0; i < rcpt.logs.length; i++) {
      const log = rcpt.logs[i];
      console.log('\nLOG', i, 'address=', log.address, 'topics[0]=', log.topics[0]);
      let decoded = false;
      for (const [name, abi] of Object.entries(candidateABIs)) {
        try {
          const iface = new ethers.Interface(abi);
          const parsed = iface.parseLog(log);
          console.log(' Decoded as', name, parsed.name, 'args=', parsed.args);
          decoded = true;
          break;
        } catch (_) {}
      }
      if (!decoded) {
        console.log(' Raw data:', log.data);
        console.log(' Topics:', log.topics);
      }
    }
    process.exit(0);
  } catch (err) {
    console.error('inspectTx error:', err && err.message ? err.message : err);
    process.exit(99);
  }
})();
