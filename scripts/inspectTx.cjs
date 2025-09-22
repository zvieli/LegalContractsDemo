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
