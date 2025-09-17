import { createContractInstance } from '../utils/contracts';
import { ethers } from 'ethers';

export class ArbitrationService {
  constructor(signer, chainId) {
    this.signer = signer;
    this.chainId = chainId;
  }

  async getArbitratorForNDA(ndaAddress) {
    const nda = createContractInstance('NDATemplate', ndaAddress, this.signer);
    // NDA templates expose a configured address which may be either an
    // Arbitrator factory (which exposes dispute methods) or an
    // ArbitrationService helper. Detect which ABI fits and return the
    // appropriate contract instance so callers call valid selectors.
    const svc = await nda.arbitrationService();
    if (!svc || svc === ethers.ZeroAddress) {
      throw new Error('This NDA has no arbitrationService configured');
    }
    // Try to detect on-chain which implementation this address exposes by
    // making a safe read-only probe. The Arbitrator factory exposes
    // `getActiveDisputesCount()` while the generic ArbitrationService does not.
    try {
      const arb = createContractInstance('Arbitrator', svc, this.signer);
      // Perform a harmless view call to verify the address implements the
      // Arbitrator ABI. If this call succeeds we return the arbitrator instance.
      await arb.getActiveDisputesCount();
      console.debug('[ArbitrationService] Detected Arbitrator factory at', svc);
      return arb;
    } catch (probeErr) {
      // Not an Arbitrator factory; fallback to the ArbitrationService helper ABI
      try {
        const asvc = createContractInstance('ArbitrationService', svc, this.signer);
        console.debug('[ArbitrationService] Detected ArbitrationService helper at', svc);
        return asvc;
      } catch (err) {
        throw new Error('Could not create arbitrator/service contract instance: ' + String(err?.message || err));
      }
    }
  }

  // Read the configured arbitration service/factory for an arbitrary target
  // contract (Rent or NDA). Returns either an Arbitrator factory or an
  // ArbitrationService helper contract instance.
  async getServiceForTarget(targetContractAddress) {
    try {
      // Try as Rent: read the arbitrationService field from the target
      const target = createContractInstance('TemplateRentContract', targetContractAddress, this.signer);
      let svcAddr = await target.arbitrationService().catch(() => null);
      if (!svcAddr || svcAddr === ethers.ZeroAddress) {
        // Fall back to ContractFactory-configured global service
        try {
          const cfMod = await import('../utils/contracts/ContractFactory.json');
          const cf = cfMod?.default ?? cfMod;
          svcAddr = cf?.contracts?.ArbitrationService || null;
        } catch (_) { svcAddr = null; }
      }
      if (!svcAddr) throw new Error('No arbitration service configured for target');

      // Probe whether the address is an Arbitrator factory by calling a
      // harmless view. If it responds, return that instance.
      try {
        const arb = createContractInstance('Arbitrator', svcAddr, this.signer);
        await arb.getActiveDisputesCount();
        console.debug('[ArbitrationService] Service probe: Arbitrator factory detected at', svcAddr);
        return arb;
      } catch (_) {
        const asvc = createContractInstance('ArbitrationService', svcAddr, this.signer);
        console.debug('[ArbitrationService] Service probe: ArbitrationService helper detected at', svcAddr);
        return asvc;
      }
    } catch (err) {
      console.error('Error getting service for target:', err);
      throw err;
    }
  }

  /**
   * Apply a resolution to a target contract/case in a compatible way.
   * If the configured on-chain instance is an `Arbitrator` factory, call
   * `resolveDispute(disputeId, offender, penaltyWei, beneficiary)`.
   * Otherwise, if it's an `ArbitrationService` helper, call
   * `applyResolutionToTarget(targetContract, caseId, approve, appliedAmount, beneficiary)`.
   */
  async applyResolution(targetContract, caseId, approve, appliedAmountWei = 0n, beneficiary) {
    try {
      // Determine the service implementation for this target contract
      const svc = await this.getServiceForTarget(targetContract);
      // If the service is an Arbitrator factory, call resolveDispute
      try {
        svc.interface.getFunction('resolveDispute');
        const tx = await svc.resolveDispute(Number(caseId), ethers.ZeroAddress, BigInt(appliedAmountWei), beneficiary);
        return await tx.wait();
      } catch (_) {
        // Otherwise call the ArbitrationService helper's applyResolutionToTarget
        try {
          svc.interface.getFunction('applyResolutionToTarget');
          const tx = await svc.applyResolutionToTarget(targetContract, Number(caseId), !!approve, BigInt(appliedAmountWei), beneficiary);
          return await tx.wait();
        } catch (err2) {
          throw new Error('No compatible resolution entrypoint found on service/factory');
        }
      }
    } catch (error) {
      console.error('Error applying resolution for target:', error);
      throw error;
    }
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
}