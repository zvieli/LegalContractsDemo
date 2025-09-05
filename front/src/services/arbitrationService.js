import { createContractInstance } from '../utils/contracts';
import { ethers } from 'ethers';

export class ArbitrationService {
  constructor(signer, chainId) {
    this.signer = signer;
    this.chainId = chainId;
  }

  async getArbitratorForNDA(ndaAddress) {
    const nda = createContractInstance('NDATemplate', ndaAddress, this.signer);
    const arb = await nda.arbitrator();
    if (!arb || arb === ethers.ZeroAddress) {
      throw new Error('This NDA has no arbitrator');
    }
    return createContractInstance('Arbitrator', arb, this.signer);
  }

  async getArbitratorOwner(ndaAddress) {
    const arbitrator = await this.getArbitratorForNDA(ndaAddress);
    try { return await arbitrator.owner(); } catch { return ethers.ZeroAddress; }
  }

  async createDisputeForCase(ndaAddress, caseId, evidenceText = '') {
    try {
      const arbitrator = await this.getArbitratorForNDA(ndaAddress);
      const evidenceBytes = evidenceText ? ethers.toUtf8Bytes(evidenceText) : new Uint8Array();
      const tx = await arbitrator.createDisputeForCase(ndaAddress, Number(caseId), evidenceBytes);
      const receipt = await tx.wait();
      // Try to extract disputeId from event log
      let disputeId = null;
      for (const log of receipt.logs) {
        try {
          const parsed = arbitrator.interface.parseLog(log);
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
      const arbitrator = await this.getArbitratorForNDA(ndaAddress);
      const penaltyWei = ethers.parseEther(String(penaltyEth || '0'));
      const tx = await arbitrator.resolveDispute(Number(disputeId), guiltyParty, penaltyWei, beneficiary);
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