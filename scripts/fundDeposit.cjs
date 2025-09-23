// Fund deposit for a Rent contract by calling depositSecurity from the tenant account
// Usage (PowerShell):
// $env:RENT_ADDR = "0x..."; $env:AMOUNT_WEI = "1000000000000000000"; npx hardhat run scripts/fundDeposit.cjs --network localhost
// Or: npx hardhat run scripts/fundDeposit.cjs --network localhost -- 0xRENT_ADDR 1   (1 = ETH amount)
const hre = require('hardhat');
const ethers = hre.ethers;
const path = require('path');

function loadAbi(relPath) {
  try {
    const full = path.join(process.cwd(), relPath);
    const mod = require(full);
    return mod && (mod.abi ?? (mod.default && mod.default.abi)) || mod;
  } catch (e) {
    console.warn('loadAbi failed for', relPath, e && e.message ? e.message : e);
    return null;
  }
}

(async () => {
  try {
    const rentAddr = process.argv[2] || process.env.RENT_ADDR;
    let amountArg = process.argv[3] || process.env.AMOUNT_WEI; // if numeric second arg, treat as ETH amount
    if (!rentAddr) {
      console.error('Usage: set RENT_ADDR (env) or pass as first arg. Optionally pass amount (ETH) or set AMOUNT_WEI env to wei value.');
      process.exit(1);
    }

    const provider = ethers.provider;
    console.log('Rent address:', rentAddr);

  const getFrontendContractsDir = require('./getFrontendContractsDir');
  const rentAbi = loadAbi(path.join(getFrontendContractsDir(), 'TemplateRentContractABI.json'));
    const rent = new ethers.Contract(rentAddr, rentAbi, provider);

    // Read tenant address
    let tenantAddr = null;
    try { tenantAddr = await rent.tenant(); } catch (e) { console.warn('read tenant failed:', e && e.message ? e.message : e); }
    console.log('tenant:', tenantAddr);

    // read requiredDeposit if available
    let required = null;
    try { required = await rent.requiredDeposit(); } catch (e) { /* ignore */ }
    console.log('requiredDeposit (wei):', required ? required.toString() : '(not available)');

    // Determine amount to send
    let valueWei = null;
    if (amountArg) {
      // if looks like wei numeric string
      if (/^\d+$/.test(String(amountArg))) {
        valueWei = BigInt(amountArg);
      } else {
        // treat as ETH amount (float or integer)
        valueWei = ethers.parseEther(String(amountArg));
      }
    } else if (required && required !== 0n) {
      valueWei = required;
    } else {
      // default to 1 ETH
      valueWei = ethers.parseEther('1');
    }

    console.log('Will attempt deposit of (wei):', valueWei.toString());

    // Find signer for tenantAddr
    const signers = await ethers.getSigners();
    let signer = null;
    if (tenantAddr) {
      for (const s of signers) {
        const a = await s.getAddress();
        if (a && a.toLowerCase() === String(tenantAddr).toLowerCase()) { signer = s; break; }
      }
    }

    if (!signer) {
      console.warn('Tenant signer not found among local signers. Available signers:');
      for (let i = 0; i < signers.length; i++) {
        const a = await signers[i].getAddress();
        console.log(i, a);
      }
      console.error('Cannot proceed: tenant signer not available in this node. If you control the tenant key, run this from that account or choose a signer index.');
      process.exit(2);
    }

    console.log('Using signer for tenant:', await signer.getAddress());
    const rentWithSigner = rent.connect(signer);

    const tx = await rentWithSigner.depositSecurity({ value: valueWei });
    console.log('Sent deposit tx:', tx.hash);
    const rcpt = await tx.wait();
    console.log('Deposit tx mined, status:', rcpt.status, 'gasUsed:', rcpt.gasUsed.toString());
    process.exit(0);
  } catch (err) {
    console.error('error in fundDeposit:', err && err.message ? err.message : err);
    process.exit(3);
  }
})();
