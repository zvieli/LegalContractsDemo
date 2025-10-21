import { ccipArbitrationIntegration } from '../server/modules/ccipArbitrationIntegration.js';

(async () => {
  try {
    await ccipArbitrationIntegration.initializeProvider();
    const signer = ccipArbitrationIntegration.signer;
    const sender = ccipArbitrationIntegration.contracts.ccipSender;
    if (!signer) {
      console.error('No signer available');
      process.exit(2);
    }
    const addr = await signer.getAddress();
    console.log('Signer address:', addr);
    if (!sender) {
      console.error('CCIP sender contract not loaded');
      process.exit(2);
    }
    try {
      const isAuth = await sender.authorizedContracts(addr);
      console.log('authorizedContracts[signer] =', isAuth);
    } catch (e) {
      console.error('Could not read authorizedContracts:', e.message || e);
    }
    try {
      const owner = await sender.owner();
      console.log('owner() =', owner);
    } catch (e) {
      console.error('Could not read owner():', e.message || e);
    }
  } catch (err) {
    console.error('Error:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
