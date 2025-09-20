// Usage: npx hardhat run scripts/approveCancellation.js --network localhost -- <contractAddress> [signerIndex]
// If signerIndex is omitted the script will pick an unlocked signer that is NOT the cancel initiator.

async function main() {
  const hreModule = await import('hardhat');
  const hre = hreModule?.default ?? hreModule;
  const { ethers } = hre;

  const addr = process.argv[2] || process.argv[4]; // hardhat passes args after --
  const signerIdxArg = process.argv[3] || process.argv[5];
  if (!addr) {
    console.error('Usage: npx hardhat run scripts/approveCancellation.js --network localhost -- <contractAddress> [signerIndex]');
    process.exit(1);
  }

  try {
    const signers = await ethers.getSigners();
    if (!signers || signers.length === 0) throw new Error('No signers available');

    // default signer choice: find one that's not the cancel initiator
    const provider = ethers.provider;
    const contract = await ethers.getContractAt('TemplateRentContract', addr);

    const cancelInitiator = await contract.cancelInitiator().catch(() => null);
    console.log('cancelInitiator on-chain:', cancelInitiator);

    let signer = null;
    if (typeof signerIdxArg !== 'undefined') {
      const idx = Number(signerIdxArg);
      if (Number.isNaN(idx) || idx < 0 || idx >= signers.length) {
        console.error('Invalid signerIndex provided');
        process.exit(1);
      }
      signer = signers[idx];
    } else {
      for (const s of signers) {
        const a = await s.getAddress();
        if (!cancelInitiator || a.toLowerCase() !== String(cancelInitiator).toLowerCase()) {
          signer = s;
          break;
        }
      }
    }

    if (!signer) {
      console.error('Could not find a signer different from cancel initiator; specify signerIndex explicitly');
      process.exit(1);
    }

    const signerAddr = await signer.getAddress();
    console.log('Using signer', signerAddr);

    const cWithSigner = contract.connect(signer);

    const cancelRequested = await contract.cancelRequested().catch(() => false);
    console.log('cancelRequested before:', cancelRequested);

    if (!cancelRequested) {
      console.error('Contract has no pending cancellation (cancelRequested=false). Nothing to approve.');
      process.exit(1);
    }

    // call approveCancellation
    const tx = await cWithSigner.approveCancellation();
    console.log('approveCancellation tx sent:', tx.hash);
    const receipt = await tx.wait();
    console.log('tx mined, status:', receipt.status);

    // read approval mapping
    const approved = await contract.cancelApprovals(signerAddr).catch(() => false);
    console.log('cancelApprovals for signer', signerAddr, ':', approved);

    const both = await Promise.all([contract.cancelApprovals(await contract.landlord()), contract.cancelApprovals(await contract.tenant())]);
    console.log('approvals landlord/tenant:', both[0], both[1]);

  } catch (e) {
    console.error('Error:', e.message || e);
    process.exit(1);
  }
}

main();
