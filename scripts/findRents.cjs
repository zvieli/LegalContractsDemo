const fs = require('fs');
const path = require('path');
const pkg = require('hardhat');

async function main() {
  const factoryAddr = process.argv[2] || process.env.FACTORY_ADDR;
  if (!factoryAddr) {
    console.error('Usage: node scripts/findRents.cjs <factoryAddress>');
    process.exit(1);
  }

  const { ethers } = pkg;
  const provider = ethers.provider || new ethers.providers.JsonRpcProvider('http://127.0.0.1:8545');

  const getFrontendContractsDir = require('./getFrontendContractsDir');
  const abiPath = path.join(getFrontendContractsDir(), 'ContractFactoryABI.json');
  if (!fs.existsSync(abiPath)) {
    console.error('Could not find ABI at', abiPath);
    process.exit(1);
  }
  const abiJson = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
  const abi = abiJson.abi || abiJson;

  const contract = new ethers.Contract(factoryAddr, abi, provider);

  console.log('Querying RentContractCreated events for factory', factoryAddr);
  const filter = contract.filters.RentContractCreated();
  const events = await contract.queryFilter(filter, 0, 'latest');
  if (!events || events.length === 0) {
    console.log('No RentContractCreated events found.');
    // Try scanning logs for NDACreated as a hint
    const ndaFilter = contract.filters.RentContractCreated();
    const other = await contract.queryFilter(ndaFilter, 0, 'latest');
    if (other && other.length > 0) console.log('Found via alternate scan:', other.map(e => e.args && e.args.contractAddress));
    return;
  }

  console.log(`Found ${events.length} RentContractCreated events:`);
  for (const ev of events) {
    try {
      const addr = ev.args && ev.args.contractAddress ? ev.args.contractAddress : (ev.args && ev.args[0]) || null;
      console.log(' -', addr, 'tx:', ev.transactionHash, 'block:', ev.blockNumber);
    } catch (e) {
      console.log(' - event parse error', e.message || e);
    }
  }
}

main().catch((err) => {
  console.error('Error:', err && err.message ? err.message : err);
  process.exit(1);
});
