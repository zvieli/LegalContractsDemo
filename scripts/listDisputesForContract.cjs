const hre = require('hardhat');
const ethers = hre.ethers;
const path = require('path');

function loadAbi(rel) {
  try {
    const full = path.join(process.cwd(), rel);
    const mod = require(full);
    return mod && (mod.abi || mod.default?.abi) ? (mod.abi || mod.default.abi) : mod;
  } catch (e) { return null; }
}

(async () => {
  try {
    const argv = process.argv.slice(2);
    const addr = process.env.RENT_ADDR || argv[0];
    if (!addr) {
      console.error('Usage: $env:RENT_ADDR="0x..."; npx hardhat run --network localhost scripts/listDisputesForContract.cjs');
      process.exit(1);
    }
    const abiPath = 'front/src/utils/contracts/TemplateRentContractABI.json';
    const abi = loadAbi(abiPath) || loadAbi(path.join('artifacts','contracts','Rent','TemplateRentContract.sol','TemplateRentContract.json'))?.abi;
    if (!abi) { console.error('Could not load ABI at', abiPath); process.exit(2); }
    const provider = ethers.provider;
    const rent = new ethers.Contract(addr, abi, provider);

    console.log('Querying events for', addr);
    const reportedFilter = rent.filters.DisputeReported ? rent.filters.DisputeReported() : null;
    const filedFilter = rent.filters.DisputeFiled ? rent.filters.DisputeFiled() : null;

    if (reportedFilter) {
      const events = await rent.queryFilter(reportedFilter, 0, 'latest');
      console.log('DisputeReported events:', events.length);
      for (const e of events) {
        const caseId = Number(e.args[0].toString());
        const initiator = e.args[1];
        const requested = e.args[3].toString();
        console.log(' caseId=', caseId, 'initiator=', initiator, 'requested=', requested);
  // get dispute details (evidence is now stored as a bytes32 digest)
  const dispute = await rent.getDispute(caseId);
  console.log('  getDispute -> initiator=', dispute[0], 'requested=', dispute[2].toString(), 'resolved=', dispute[4], 'evidenceDigest=', dispute[3]);
      }
    }
    if (filedFilter) {
      const events = await rent.queryFilter(filedFilter, 0, 'latest');
      console.log('DisputeFiled events:', events.length);
      for (const e of events) {
        const caseId = Number(e.args[0].toString());
        const debtor = e.args[1];
        const requested = e.args[2].toString();
        console.log(' caseId=', caseId, 'debtor=', debtor, 'requested=', requested);
        // read deposits for debtor, landlord, tenant
        const landlord = await rent.landlord().catch(()=>null);
        const tenant = await rent.tenant().catch(()=>null);
        const pdDebtor = BigInt(await rent.partyDeposit(debtor).catch(()=>0n));
        const pdLandlord = landlord ? BigInt(await rent.partyDeposit(landlord).catch(()=>0n)) : 0n;
        const pdTenant = tenant ? BigInt(await rent.partyDeposit(tenant).catch(()=>0n)) : 0n;
        console.log('  partyDeposit debtor=', pdDebtor.toString(), 'landlord=', pdLandlord.toString(), 'tenant=', pdTenant.toString());
        console.log('  depositSatisfies?', pdDebtor >= BigInt(requested));
      }
    }
    process.exit(0);
  } catch (err) {
    console.error('listDisputesForContract failed:', err && err.message ? err.message : err);
    process.exit(99);
  }
})();
