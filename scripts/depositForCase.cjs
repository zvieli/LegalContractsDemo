const hre = require('hardhat');
const ethers = hre.ethers;
const path = require('path');

function loadAbi(rel) {
  try { const full = path.join(process.cwd(), rel); const mod = require(full); return mod && (mod.abi || mod.default?.abi) ? (mod.abi || mod.default.abi) : mod; } catch (e) { return null; }
}

(async () => {
  try {
    const argv = process.argv.slice(2);
    const rentAddr = process.env.RENT_ADDR || argv[0];
    const caseIdArg = process.env.CASE_ID || argv[1];
    let amountArg = process.env.AMOUNT_WEI || argv[2];
    if (!rentAddr || typeof caseIdArg === 'undefined') {
      console.error('Usage: $env:RENT_ADDR="0x..."; $env:CASE_ID=0; $env:AMOUNT_WEI="..."; npx hardhat run --network localhost scripts/depositForCase.cjs');
      process.exit(1);
    }
    const caseId = Number(caseIdArg);
  const getFrontendContractsDir = require('./getFrontendContractsDir');
  const abi = loadAbi(path.join(getFrontendContractsDir(), 'TemplateRentContractABI.json')) || loadAbi(path.join('artifacts','contracts','Rent','TemplateRentContract.sol','TemplateRentContract.json'))?.abi;
    if (!abi) { console.error('TemplateRentContract ABI not found'); process.exit(2); }

    const provider = ethers.provider;
    const rent = new ethers.Contract(rentAddr, abi, provider);

    // Discover debtor from DisputeFiled event for caseId
    const filedFilter = rent.filters.DisputeFiled ? rent.filters.DisputeFiled(caseId) : null;
    let debtor = null;
    if (filedFilter) {
      const evts = await rent.queryFilter(filedFilter, 0, 'latest');
      if (evts && evts.length) debtor = evts[0].args[1];
    }
    if (!debtor) {
      console.error('Could not determine debtor for caseId', caseId);
      process.exit(3);
    }
    console.log('Debtor for case', caseId, '=', debtor);

    // Determine amount to deposit: if not provided, use requestedAmount from dispute
    let amtWei = null;
    if (amountArg) {
      if (/^\d+$/.test(String(amountArg))) amtWei = BigInt(amountArg);
      else amtWei = ethers.parseEther(String(amountArg));
    } else {
      const dispute = await rent.getDispute(caseId);
      amtWei = BigInt(dispute[2].toString());
    }

    // Find signer among local signers that matches debtor
    const signers = await ethers.getSigners();
    let signer = null;
    for (const s of signers) {
      const a = await s.getAddress();
      if (a && a.toLowerCase() === String(debtor).toLowerCase()) { signer = s; break; }
    }
    if (!signer) {
      console.error('Debtor signer not found among local signers. Available signers:');
      for (let i = 0; i < signers.length; i++) console.log(i, await signers[i].getAddress());
      process.exit(4);
    }

    console.log('Using signer', await signer.getAddress(), 'to deposit', amtWei.toString(), 'wei');
    const rentWithSigner = rent.connect(signer);
    const tx = await rentWithSigner.depositForCase(caseId, { value: amtWei });
    console.log('Sent depositForCase tx:', tx.hash);
    const rcpt = await tx.wait();
    console.log('Mined, status=', rcpt.status, 'gasUsed=', rcpt.gasUsed.toString());
    process.exit(0);
  } catch (err) {
    console.error('depositForCase failed:', err && err.message ? err.message : err);
    process.exit(99);
  }
})();
