import * as ethers from 'ethers';
import { createContractInstanceAsync, getLocalDeploymentAddresses, getContractAddress } from '../utils/contracts';

/**
 * V7 Contract Service - AI-Powered Arbitration with Chainlink Functions
 * 
 * Key Features:
 * - Arbitration Bond requirement for all claims
 * - Direct integration with ArbitrationContractV2
 * - Chainlink Functions Oracle integration
 * - AI-based decision making via FastAPI + Ollama
 */
export class ContractServiceV7 {
  constructor(signer, chainId = 31337) {
    this.signer = signer;
    this.chainId = chainId;
  }

  /**
   * Submit an arbitration request with required bond
   * @param {string} targetContractAddress - Contract to arbitrate
   * @param {string} evidenceText - Evidence and details
   * @param {string} disputeQuestion - Specific question for arbitration
   * @param {string} bondAmountDAI - Bond amount in DAI (e.g., "100")
   * @returns {Promise<{requestId: string, transactionHash: string}>}
   */
  async submitArbitrationRequest(targetContractAddress, evidenceText, disputeQuestion, bondAmountDAI) {
    try {
      // Get ArbitrationContractV2 address
      const local = await getLocalDeploymentAddresses();
      const arbitrationContractAddr = local?.ArbitrationContractV2 || 
        (await getContractAddress(this.chainId, 'ArbitrationContractV2'));

      if (!arbitrationContractAddr) {
        throw new Error('ArbitrationContractV2 not deployed');
      }

      // Create contract instance
      const arbitrationContract = await createContractInstanceAsync(
        'ArbitrationContractV2',
        arbitrationContractAddr,
        this.signer
      );

      // Convert bond amount to Wei (DAI has 18 decimals)
      const bondAmountWei = ethers.parseEther(bondAmountDAI);

      // Prepare evidence data structure for AI processing
      const evidenceData = {
        contractText: await this._getContractText(targetContractAddress),
        evidenceText: evidenceText,
        disputeQuestion: disputeQuestion,
        timestamp: Date.now(),
        requester: await this.signer.getAddress()
      };

      // Compute evidence digest (keccak256 of JSON)
      const evidenceString = JSON.stringify(evidenceData);
      const evidenceDigest = ethers.keccak256(ethers.toUtf8Bytes(evidenceString));

      console.log('V7 Arbitration Request:', {
        targetContract: targetContractAddress,
        bondAmount: bondAmountDAI,
        evidenceDigest,
        question: disputeQuestion
      });

      // Submit to ArbitrationContractV2 with bond
      const tx = await arbitrationContract.requestArbitration(
        targetContractAddress,
        evidenceDigest,
        disputeQuestion,
        {
          value: bondAmountWei,
          gasLimit: 500000 // Ensure enough gas for Chainlink Functions
        }
      );

      console.log('V7 Arbitration transaction submitted:', tx.hash);

      // Wait for confirmation
      const receipt = await tx.wait();
      
      // Extract request ID from logs
      const requestEvent = receipt.logs.find(log => {
        try {
          const parsed = arbitrationContract.interface.parseLog(log);
          return parsed.name === 'ArbitrationRequested';
        } catch (e) {
          return false;
        }
      });

      let requestId = 'unknown';
      if (requestEvent) {
        const parsed = arbitrationContract.interface.parseLog(requestEvent);
        requestId = parsed.args.requestId.toString();
      }

      return {
        requestId,
        transactionHash: tx.hash,
        evidenceDigest,
        bondAmount: bondAmountDAI
      };

    } catch (error) {
      console.error('V7 Arbitration submission error:', error);
      throw new Error(`Failed to submit V7 arbitration: ${error.message}`);
    }
  }

  /**
   * Get arbitration request status
   * @param {string} requestId - Request ID from submitArbitrationRequest
   * @returns {Promise<Object>} Status object
   */
  async getArbitrationStatus(requestId) {
    try {
      const local = await getLocalDeploymentAddresses();
      const arbitrationContractAddr = local?.ArbitrationContractV2;

      if (!arbitrationContractAddr) {
        throw new Error('ArbitrationContractV2 not found');
      }

      const arbitrationContract = await createContractInstanceAsync(
        'ArbitrationContractV2',
        arbitrationContractAddr,
        this.signer
      );

      // Check if request is in test mode (for development)
      const isTestMode = await arbitrationContract.testMode().catch(() => true);
      
      if (isTestMode) {
        return {
          status: 'ממתין לתגובת Oracle',
          isTestMode: true,
          message: 'מערכת במצב בדיקה - השתמש ב-simulateResponse לסימולציה'
        };
      }

      // In production, check Chainlink Functions status
      return {
        status: 'ממתין לתגובת Oracle',
        isTestMode: false,
        message: 'הבקשה נשלחה ל-Chainlink Functions, ממתין לתגובת AI'
      };

    } catch (error) {
      console.error('Error getting arbitration status:', error);
      return {
        status: 'שגיאה',
        error: error.message
      };
    }
  }

  /**
   * Simulate arbitration response (for testing)
   * @param {string} requestId - Request ID
   * @param {number} reimbursementAmount - Amount in DAI
   * @returns {Promise<string>} Transaction hash
   */
  async simulateArbitrationResponse(requestId, reimbursementAmount = 0) {
    try {
      const local = await getLocalDeploymentAddresses();
      const arbitrationContractAddr = local?.ArbitrationContractV2;

      if (!arbitrationContractAddr) {
        throw new Error('ArbitrationContractV2 not found');
      }

      const arbitrationContract = await createContractInstanceAsync(
        'ArbitrationContractV2',
        arbitrationContractAddr,
        this.signer
      );

      // Convert amount to Wei
      const amountWei = ethers.parseEther(reimbursementAmount.toString());

      const tx = await arbitrationContract.simulateResponse(requestId, amountWei);
      await tx.wait();

      return tx.hash;

    } catch (error) {
      console.error('Error simulating arbitration response:', error);
      throw error;
    }
  }

  /**
   * Get contract text for evidence (simplified)
   * @private
   */
  async _getContractText(contractAddress) {
    try {
      // In a real implementation, you might:
      // 1. Check if it's an NDA or Rent contract
      // 2. Read contract state and terms
      // 3. Format as human-readable text
      
      const code = await this.signer.provider.getCode(contractAddress);
      if (!code || code === '0x') {
        return `Contract at ${contractAddress} - No code found`;
      }

      // For demo purposes, return basic info
      return `Smart Contract at ${contractAddress}\nType: Legal Agreement\nBlockchain: Ethereum\nStatus: Active`;
      
    } catch (error) {
      return `Contract at ${contractAddress} - Error reading: ${error.message}`;
    }
  }

  /**
   * Get all arbitration requests for a user
   * @param {string} userAddress - User's address
   * @returns {Promise<Array>} Array of requests
   */
  async getUserArbitrationRequests(userAddress) {
    try {
      const local = await getLocalDeploymentAddresses();
      const arbitrationContractAddr = local?.ArbitrationContractV2;

      if (!arbitrationContractAddr) {
        return [];
      }

      const rpc = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
      const arbitrationContract = await createContractInstanceAsync(
        'ArbitrationContractV2',
        arbitrationContractAddr,
        rpc
      );

      // Query events for this user
      const filter = arbitrationContract.filters.ArbitrationRequested(null, userAddress);
      const events = await arbitrationContract.queryFilter(filter, -1000, 'latest');

      return events.map(event => ({
        requestId: event.args.requestId.toString(),
        requester: event.args.requester,
        targetContract: event.args.targetContract,
        evidenceDigest: event.args.evidenceDigest,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash
      }));

    } catch (error) {
      console.error('Error getting user arbitration requests:', error);
      return [];
    }
  }

    /**
     * Get all arbitration requests for a specific user
     * @param {string} userAddress - The user's wallet address
     * @returns {Array} Array of arbitration request objects
     */
    async getArbitrationRequestsByUser(userAddress) {
      try {
        const arbitrationContract = await this.getArbitrationContract();
      
        // Query events to get user's arbitration requests
        const filter = arbitrationContract.filters.ArbitrationRequested(userAddress);
        const events = await arbitrationContract.queryFilter(filter);
      
        const requests = [];
        for (const event of events) {
          const args = event.args;
          const request = {
            id: args.requestId?.toString(),
            requester: args.requester,
            contractAddress: args.contractAddress,
            bondAmount: ethers.formatEther(args.bondAmount || '0'),
            evidenceHash: args.evidenceHash,
            timestamp: args.timestamp?.toString(),
            status: await this.getRequestStatus(args.requestId),
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash
          };
          requests.push(request);
        }
      
        // Sort by most recent first
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
      try {
        const arbitrationContract = await this.getArbitrationContract();
      
        // Check if bond is confirmed
        const bondFilter = arbitrationContract.filters.BondConfirmed(requestId);
        const bondEvents = await arbitrationContract.queryFilter(bondFilter);
      
        if (bondEvents.length === 0) {
          return 'pending';
        }
      
        // Check if AI decision was received
        const decisionFilter = arbitrationContract.filters.DecisionReceived(requestId);
        const decisionEvents = await arbitrationContract.queryFilter(decisionFilter);
      
        if (decisionEvents.length === 0) {
          return 'bond_confirmed';
        }
      
        // Check if resolution was applied
        const resolutionFilter = arbitrationContract.filters.ResolutionApplied(requestId);
        const resolutionEvents = await arbitrationContract.queryFilter(resolutionFilter);
      
        if (resolutionEvents.length > 0) {
          return 'completed';
        }
      
        return 'ai_decided';
      } catch (error) {
        console.error('Error getting request status:', error);
        return 'unknown';
      }
    }
}

export default ContractServiceV7;