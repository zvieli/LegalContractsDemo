import { getContractABI, getContractAddress, createContractInstance } from '../utils/contracts';
import { ethers } from 'ethers';

export class ArbitrationService {
  constructor(signer, chainId) {
    this.signer = signer;
    this.chainId = chainId;
  }

  async getArbitratorContract() {
    const arbitratorAddress = await getContractAddress(this.chainId, 'arbitrator');
    if (!arbitratorAddress) {
      throw new Error('Arbitrator contract not deployed');
    }
    return createContractInstance('Arbitrator', arbitratorAddress, this.signer);
  }

  async createDispute(contractAddress, reason, evidence) {
    try {
      const arbitrator = await this.getArbitratorContract();
      const tx = await arbitrator.createDispute(contractAddress, reason, evidence);
      const receipt = await tx.wait();
      return receipt;
    } catch (error) {
      console.error('Error creating dispute:', error);
      throw error;
    }
  }

  async voteOnDispute(disputeId, support, reason = "") {
    try {
      const arbitrator = await this.getArbitratorContract();
      const tx = await arbitrator.vote(disputeId, support, reason);
      const receipt = await tx.wait();
      return receipt;
    } catch (error) {
      console.error('Error voting on dispute:', error);
      throw error;
    }
  }

  async getDispute(disputeId) {
    try {
      const arbitrator = await this.getArbitratorContract();
      const dispute = await arbitrator.getDispute(disputeId);
      return dispute;
    } catch (error) {
      console.error('Error getting dispute:', error);
      throw error;
    }
  }

  async getAllDisputes() {
    try {
      const arbitrator = await this.getArbitratorContract();
      const disputes = await arbitrator.getAllDisputes();
      return disputes;
    } catch (error) {
      console.error('Error getting disputes:', error);
      throw error;
    }
  }

  async getDisputesForContract(contractAddress) {
    try {
      const arbitrator = await this.getArbitratorContract();
      const disputes = await arbitrator.getDisputesForContract(contractAddress);
      return disputes;
    } catch (error) {
      console.error('Error getting contract disputes:', error);
      throw error;
    }
  }
}