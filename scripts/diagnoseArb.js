// Simple diagnostic script to inspect arbitration-related state for a Rent contract
// Usage (PowerShell):
//  $env:RENT_ADDR = "0x..."; $env:REPORTER = "0x..."; npx hardhat run scripts/diagnoseArb.js --network localhost
// Or: npx hardhat run scripts/diagnoseArb.js --network localhost -- 0xRENT_ADDR 0xREPORTER
const hre = require('hardhat');
const ethers = hre.ethers;
const path = require('path');

function loadAbi(relPath) {
  try {
    const full = path.join(process.cwd(), relPath);
    const mod = require(full);
    return mod?.abi ?? mod?.default?.abi ?? mod;
  } catch (e) {
    console.warn('loadAbi failed for', relPath, e && e.message ? e.message : e);
    return null;
  }
}

(async () => {
  try {
    const rentAddr = process.argv[2] || process.env.RENT_ADDR;
    const reporter = process.argv[3] || process.env.REPORTER;
    if (!rentAddr) {
      console.error('Usage: set RENT_ADDR (env) or pass as first arg. Optionally set REPORTER to check balances.');
      process.exit(1);
    }

    const provider = ethers.provider;
    console.log('Inspecting rent contract:', rentAddr);

    // 1) Code at address
    const code = await provider.getCode(rentAddr).catch((e) => { console.error('getCode failed:', e && e.message ? e.message : e); return null; });
    console.log('bytecode length:', code ? code.length : 0, code === '0x' ? '(no contract deployed at this address)' : '');

    // 2) Rent contract instance
  const getFrontendContractsDir = require('./getFrontendContractsDir');
  const rentAbi = loadAbi(path.join(getFrontendContractsDir(), 'TemplateRentContractABI.json'));
  if (!rentAbi) console.warn('TemplateRentContract ABI not found in frontend contracts dir');
    const rent = new ethers.Contract(rentAddr, rentAbi, provider);

    // 3) arbitrationService and depositBalance
    let arbAddr = null;
    try {
      arbAddr = await rent.arbitrationService();
    } catch (e) {
      console.warn('read arbitrationService failed:', e && e.message ? e.message : e);
    }
    console.log('arbitrationService:', arbAddr);

    let deposit = null;
    try {
      deposit = await rent.depositBalance();
    } catch (e) {
      console.warn('read depositBalance failed:', e && e.message ? e.message : e);
    }
    console.log('depositBalance (wei):', deposit ? deposit.toString() : deposit);

    // 4) DisputeResolved events
    try {
      const filter = rent.filters?.DisputeResolved ? rent.filters.DisputeResolved() : rent.filters['DisputeResolved'] ? rent.filters['DisputeResolved']() : null;
      const events = filter ? await rent.queryFilter(filter, 0, 'latest') : [];
      console.log('DisputeResolved events found:', events.length);
      events.forEach((ev, i) => {
        const args = ev.args || [];
        console.log(i, {
          caseId: args.caseId ? args.caseId.toString() : (args[0] ? String(args[0]) : undefined),
          approved: args.approved ?? args[1],
          appliedAmount: args.appliedAmount ? args.appliedAmount.toString() : (args[2] ? String(args[2]) : undefined),
          beneficiary: args.beneficiary ?? args[3]
        });
      });
    } catch (e) {
      console.warn('queryFilter DisputeResolved failed:', e && e.message ? e.message : e);
    }

    // 5) Inspect arbitration service owner / factory if present
    if (arbAddr && arbAddr !== ethers.constants.AddressZero) {
  const arbAbi = loadAbi(path.join(getFrontendContractsDir(), 'ArbitrationServiceABI.json'));
  if (!arbAbi) console.warn('ArbitrationService ABI not found in frontend contracts dir');
      const arb = new ethers.Contract(arbAddr, arbAbi, provider);
      let owner = null;
      let factory = null;
      try { owner = await arb.owner(); } catch (e) { console.warn('owner read failed:', e && e.message ? e.message : e); }
      try { factory = await arb.factory(); } catch (e) { console.warn('factory read failed:', e && e.message ? e.message : e); }
      console.log('ArbitrationService owner:', owner);
      console.log('ArbitrationService factory:', factory);
    }

    // 6) reporter balance
    if (reporter) {
      try {
        const bal = await provider.getBalance(reporter);
        console.log('reporter balance (wei):', bal.toString());
      } catch (e) { console.warn('getBalance failed for reporter:', e && e.message ? e.message : e); }
    }

    // 7) quick scan of recent blocks for direct txs to reporter (if provided)
    if (reporter) {
      const latest = await provider.getBlockNumber();
      const fromBlock = Math.max(0, latest - 200);
      console.log('Scanning blocks', fromBlock, '->', latest, 'for direct txs to reporter');
      let transfersFound = 0;
      for (let b = fromBlock; b <= latest; b++) {
        const block = await provider.getBlockWithTransactions(b);
        for (const tx of block.transactions) {
          if (tx.to && tx.to.toLowerCase() === reporter.toLowerCase()) {
            console.log('Direct tx to reporter in block', b, tx.hash, 'value(wei):', tx.value ? tx.value.toString() : '0');
            transfersFound++;
          }
        }
      }
      console.log('quick scan direct txs found:', transfersFound);
    }

    console.log('Diagnostic run complete.');
    process.exit(0);
  } catch (err) {
    console.error('error in diagnostic script:', err && err.message ? err.message : err);
    process.exit(2);
  }
})();
