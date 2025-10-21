import { ccipArbitrationIntegration } from '../server/modules/ccipArbitrationIntegration.js';

(async () => {
  try {
    await ccipArbitrationIntegration.initializeProvider();
    const sender = ccipArbitrationIntegration.contracts.ccipSender;
    const signer = ccipArbitrationIntegration.signer;
    if (!sender) {
      console.error('No sender contract loaded');
      process.exit(2);
    }
    const ownerAddr = await sender.owner();
    const signerAddr = await signer.getAddress();
    console.log('owner:', ownerAddr, 'signer:', signerAddr);
    // Send transaction as owner
    const ownerWallet = ccipArbitrationIntegration.signer; // by default the signer is the deployer/owner in local tests
    console.log('Calling setContractAuthorization as signer (owner?)');
    const tx = await sender.setContractAuthorization(signerAddr, true);
    console.log('tx sent:', tx.hash);
    await tx.wait();
    console.log('Authorization tx confirmed');
  } catch (e) {
    console.error('Failed to authorize signer:', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
