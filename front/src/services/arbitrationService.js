import { createContractInstance } from '../utils/contracts';
import * as ethers from 'ethers';

export class ArbitrationService {
  constructor(signer, chainId) {
    this.signer = signer;
    this.chainId = chainId;
  }

  async getArbitratorForNDA(ndaAddress) {
    const nda = createContractInstance('NDATemplate', ndaAddress, this.signer);
    // NDA templates no longer store a direct `arbitrator`. Instead they
    // expose the configured `arbitrationService` which manages disputes.
    const svc = await nda.arbitrationService();
    if (!svc || svc === ethers.ZeroAddress) {
      throw new Error('This NDA has no arbitrationService configured');
    }
    // The owner of the ArbitrationService is expected to be the on-chain
    // Arbitrator factory. We return the service contract instance here so
    // callers can interact with dispute creation helpers via the service.
    return createContractInstance('ArbitrationService', svc, this.signer);
  }

  async getArbitratorOwner(ndaAddress) {
    const arbitrator = await this.getArbitratorForNDA(ndaAddress);
    try { return await arbitrator.owner(); } catch { return ethers.ZeroAddress; }
  }

  // Convenience: return the owner of the configured ArbitrationService for a NDA
  async getArbitrationServiceOwnerByNDA(ndaAddress) {
    const svc = await this.getArbitratorForNDA(ndaAddress);
    try { return await svc.owner(); } catch { return ethers.ZeroAddress; }
  }

  async createDisputeForCase(ndaAddress, caseId, evidenceText = '') {
    try {
      const svc = await this.getArbitratorForNDA(ndaAddress);
      const evidenceBytes = evidenceText ? ethers.toUtf8Bytes(evidenceText) : new Uint8Array();
      // ArbitrationService provides a helper to create disputes on the
      // configured arbitrator/factory and returns the dispute id.
      const tx = await svc.createDisputeForCase(ndaAddress, Number(caseId), evidenceBytes);
      const receipt = await tx.wait();
      // Try to extract disputeId from event log
      let disputeId = null;
      for (const log of receipt.logs) {
        try {
          const parsed = svc.interface.parseLog(log);
          if (parsed && parsed.name === 'DisputeCreated') {
            disputeId = Number(parsed.args[0]);
            break;
          }
        } catch (_) {}
      }
      return { receipt, disputeId };
    } catch (error) {
      console.error('Error creating dispute for case:', error);
      throw error;
    }
  }

  async resolveDispute(ndaAddress, disputeId, guiltyParty, penaltyEth, beneficiary) {
    try {
      const svc = await this.getArbitratorForNDA(ndaAddress);
      const penaltyWei = ethers.parseEther(String(penaltyEth || '0'));
      // Resolve via the ArbitrationService which will instruct the template
      // to apply the resolution using the correct ABI entrypoint.
      const tx = await svc.resolveDispute(Number(disputeId), guiltyParty, penaltyWei, beneficiary);
      const receipt = await tx.wait();
      return receipt;
    } catch (error) {
      console.error('Error resolving dispute:', error);
      throw error;
    }
  }

  async getDispute(ndaAddress, disputeId) {
    try {
      const arbitrator = await this.getArbitratorForNDA(ndaAddress);
      const dispute = await arbitrator.getDispute(Number(disputeId));
      return dispute;
    } catch (error) {
      console.error('Error getting dispute:', error);
      throw error;
    }
  }

  async getActiveDisputesCount(ndaAddress) {
    try {
      const arbitrator = await this.getArbitratorForNDA(ndaAddress);
      return await arbitrator.getActiveDisputesCount();
    } catch (error) {
      console.error('Error getting disputes count:', error);
      throw error;
    }
  }

  // Admin-only decryption helpers moved to `tools/admin/decryptHelper.js`.
  // Use that utility in a trusted admin environment (server or CLI) to decrypt
  // EthCrypto JSON ciphertexts. Do NOT include admin private keys in client bundles.
}