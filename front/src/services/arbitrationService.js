import { createContractInstanceAsync } from '../utils/contracts';
import * as ethers from 'ethers';

export class ArbitrationService {
  constructor(signer, chainId) {
    this.signer = signer;
    this.chainId = chainId;
  }

  async getArbitratorForNDA(ndaAddress) {
  const nda = await createContractInstanceAsync('NDATemplate', ndaAddress, this.signer);
    // NDA templates no longer store a direct `arbitrator`. Instead they
    // expose the configured `arbitrationService` which manages disputes.
    const svc = await nda.arbitrationService();
    if (!svc || svc === ethers.ZeroAddress) {
      throw new Error('This NDA has no arbitrationService configured');
    }
    // The owner of the ArbitrationService is expected to be the on-chain
    // Arbitrator factory. We return the service contract instance here so
    // callers can interact with dispute creation helpers via the service.
  return await createContractInstanceAsync('ArbitrationService', svc, this.signer);
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
      // To avoid sending arbitrarily-large evidence bytes on-chain (which
      // scales gas with length), we follow Option A: compute and submit a
      // 32-byte keccak256 digest of the off-chain evidence payload. The
      // contract accepts `bytes calldata` so a 32-byte value is encoded as
      // fixed-size bytes on-chain but avoids storing large blobs.
      // If callers already provide a 0x-prefixed 32-byte digest, use it
      // directly; otherwise compute keccak256 over the UTF-8 bytes of the
      // provided evidenceText.
      let digestHex = ethers.ZeroHash;
      if (evidenceText && typeof evidenceText === 'string' && evidenceText.trim().length > 0) {
        const raw = evidenceText.trim();
        if (/^0x[0-9a-fA-F]{64}$/.test(raw)) {
          digestHex = raw;
        } else {
          digestHex = ethers.keccak256(ethers.toUtf8Bytes(raw));
        }
      }
  const evidenceBytes = ethers.getBytes(digestHex);
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