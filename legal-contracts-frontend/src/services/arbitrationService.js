// src/services/arbitrationService.js
import { ContractService } from './contractService';

export class ArbitrationService extends ContractService {
  async createDispute(contractAddress, reason, evidence) {
    const arbitrator = await this.getArbitratorContract();
    const tx = await arbitrator.createDispute(contractAddress, reason, evidence);
    return tx.wait();
  }

  async voteOnDispute(disputeId, support) {
    const arbitrator = await this.getArbitratorContract();
    const tx = await arbitrator.vote(disputeId, support);
    return tx.wait();
  }
}