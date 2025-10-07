import * as ethers from 'ethers';
import { getLocalDeploymentAddresses } from '../utils/contracts';

/**
 * Simple V7 Contract Service - Localhost Only
 * 
 * This version ONLY uses localhost providers to avoid ANY Alchemy connections
 */
export class ContractServiceV7 {
  constructor(signer, chainId = 31337) {
    this.signer = signer;
    this.chainId = chainId;
    // Always use localhost provider for ALL operations
    this.localhostProvider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  }

  /**
   * Get all arbitration requests for a specific user
   * @param {string} userAddress - The user's wallet address
   * @returns {Array} Array of arbitration request objects
   */
  async getArbitrationRequestsByUser(userAddress) {
    try {
      console.log('DEBUG: Starting getArbitrationRequestsByUser for:', userAddress);
      
      const local = await getLocalDeploymentAddresses();
      const arbitrationContractAddr = local?.ArbitrationContractV2 || local?.ArbitrationService;
      
      if (!arbitrationContractAddr) {
        console.log('No arbitration contract address found');
        return [];
      }

      const contractName = local?.ArbitrationContractV2 ? 'ArbitrationContractV2' : 'ArbitrationService';
      const contractAbi = window.__ABIS__[contractName]?.abi || window.__ABIS__[contractName];
      
      console.log('DEBUG: contractName:', contractName);
      console.log('DEBUG: arbitrationContractAddr:', arbitrationContractAddr);
      console.log('DEBUG: using provider:', this.localhostProvider.connection?.url);
      
      if (!contractAbi) {
        console.log(`ABI not found for contract: ${contractName}`);
        return [];
      }
      
      // Create contract with localhost provider ONLY
      const arbitrationContract = new ethers.Contract(
        arbitrationContractAddr,
        contractAbi,
        this.localhostProvider  // Always localhost!
      );

      const requests = [];
      
      if (contractName === 'ArbitrationContractV2') {
        console.log('Looking for ArbitrationRequested events...');
        try {
          const filter = arbitrationContract.filters.ArbitrationRequested(userAddress);
          const events = await arbitrationContract.queryFilter(filter);
          console.log('Found events:', events.length);
          
          for (const event of events) {
            const args = event.args;
            const request = {
              id: args.requestId?.toString(),
              requester: args.requester,
              target: args.target,
              caseId: args.caseId?.toString(),
              requestId: args.requestId,
              status: 'pending', // Simple status for now
              blockNumber: event.blockNumber,
              transactionHash: event.transactionHash
            };
            requests.push(request);
          }
        } catch (error) {
          console.error('Error querying ArbitrationContractV2:', error);
        }
      } else {
        console.log('Looking for ResolutionApplied events...');
        try {
          const filter = arbitrationContract.filters.ResolutionApplied();
          const events = await arbitrationContract.queryFilter(filter);
          console.log('Found events:', events.length);
          
          for (const event of events) {
            const args = event.args;
            const request = {
              id: `${args.target}-${args.caseId}`,
              target: args.target,
              caseId: args.caseId?.toString(),
              approve: args.approve,
              appliedAmount: ethers.formatEther(args.appliedAmount || '0'),
              beneficiary: args.beneficiary,
              caller: args.caller,
              status: 'resolved',
              blockNumber: event.blockNumber,
              transactionHash: event.transactionHash
            };
            requests.push(request);
          }
        } catch (error) {
          console.error('Error querying ArbitrationService:', error);
        }
      }
      
      console.log('DEBUG: Total requests found:', requests.length);
      return requests.sort((a, b) => (b.blockNumber || 0) - (a.blockNumber || 0));
      
    } catch (error) {
      console.error('Error fetching arbitration requests:', error);
      return [];
    }
  }

  /**
   * Get the status of an arbitration request
   * @param {string} requestId - The request ID
   * @returns {string} The status string
   */
  async getRequestStatus(requestId) {
    // Simple implementation - just return 'unknown' for now
    // This avoids any additional provider calls
    return 'unknown';
  }

  // Placeholder methods to match the interface
  async submitArbitrationRequest() {
    throw new Error('Not implemented in simple version');
  }

  async getUserArbitrationRequests() {
    throw new Error('Use getArbitrationRequestsByUser instead');
  }
}

export default ContractServiceV7;