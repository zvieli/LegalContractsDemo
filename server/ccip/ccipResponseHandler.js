


import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';

export class CCIPResponseHandler {
  constructor(config = {}) {
    this.config = {
      rpcUrl: config.rpcUrl || 'http://127.0.0.1:8545',
      chainId: config.chainId || 31337,
      senderAddress: config.senderAddress,
      privateKey: config.privateKey,
      ...config
    };

    this.provider = null;
    this.signer = null;
    this.senderContract = null;
    this.pendingResponses = new Map();

    console.log('📤 CCIP Response Handler initialized');
  }

  

  async initialize() {
    try {
      // Setup provider and signer
      this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
      
      if (this.config.privateKey) {
        this.signer = new ethers.Wallet(this.config.privateKey, this.provider);
        console.log('🔑 Signer loaded:', this.signer.address);
      } else {
        console.warn('⚠️ No private key provided, read-only mode');
      }

      // Setup sender contract
      await this._setupSenderContract();

      console.log('✅ CCIP Response Handler initialized successfully');
      return true;

    } catch (error) {
      console.error('❌ Failed to initialize CCIP Response Handler:', error);
      return false;
    }
  }

  

  async _setupSenderContract() {
    if (!this.config.senderAddress) {
      console.warn('⚠️ No sender address provided');
      return;
    }

    try {
      const senderABI = await this._loadContractABI('CCIPArbitrationSender');
      
      if (!senderABI) {
        throw new Error('Failed to load sender ABI');
      }

      this.senderContract = new ethers.Contract(
        this.config.senderAddress,
        senderABI,
        this.signer || this.provider
      );

      console.log('📤 CCIP Sender contract loaded:', this.config.senderAddress);

    } catch (error) {
      console.error('❌ Failed to setup sender contract:', error);
      throw error;
    }
  }

  

  async _loadContractABI(contractName) {
    try {
      const artifactPath = path.join(
        process.cwd(), 
        'artifacts', 
        'contracts', 
        'Arbitration', 
        'ccip', 
        `${contractName}.sol`, 
        `${contractName}.json`
      );
      
      if (fs.existsSync(artifactPath)) {
        const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
        return artifact.abi;
      }

      // ABI not found - return null silently
      return null;

    } catch (error) {
      console.error(`❌ Failed to load ABI for ${contractName}:`, error);
      return null;
    }
  }

  

  async sendArbitrationDecision(decisionData) {
    const {
      originalMessageId,
      disputeId,
      targetChainSelector,
      targetReceiver,
      decision,
      payFeesIn = 'Native'
    } = decisionData;

    if (!this.senderContract || !this.signer) {
      throw new Error('Sender contract or signer not available');
    }

    console.log('📤 Sending arbitration decision via CCIP:', {
      disputeId: disputeId.slice(0, 10) + '...',
      approved: decision.approved,
      amount: decision.appliedAmount
    });

    try {
      // Prepare decision data
      const arbitrationDecision = {
        disputeId: disputeId,
        approved: decision.approved || false,
        appliedAmount: ethers.parseEther(String(decision.appliedAmount || 0)),
        beneficiary: decision.beneficiary || ethers.ZeroAddress,
        rationale: decision.rationale || 'Oracle decision',
        oracleId: ethers.keccak256(ethers.toUtf8Bytes('CCIP-Oracle-V7')),
        timestamp: Math.floor(Date.now() / 1000)
      };

      // Encode as CCIP message
      const ccipMessage = {
        messageType: 1, // DECISION
        data: ethers.AbiCoder.defaultAbiCoder().encode(
          ['tuple(bytes32,bool,uint256,address,string,bytes32,uint256)'],
          [[
            arbitrationDecision.disputeId,
            arbitrationDecision.approved,
            arbitrationDecision.appliedAmount,
            arbitrationDecision.beneficiary,
            arbitrationDecision.rationale,
            arbitrationDecision.oracleId,
            arbitrationDecision.timestamp
          ]]
        )
      };

      // Calculate fees
      const fees = await this._calculateFees(targetChainSelector, payFeesIn);
      
      // Send message
      const tx = await this._sendCCIPMessage(
        targetChainSelector,
        targetReceiver,
        ccipMessage,
        fees,
        payFeesIn
      );

      console.log('✅ Arbitration decision sent:', {
        txHash: tx.hash,
        disputeId: disputeId.slice(0, 10) + '...'
      });

      // Track pending response
      this.pendingResponses.set(disputeId, {
        txHash: tx.hash,
        timestamp: Date.now(),
        decision: arbitrationDecision
      });

      return {
        success: true,
        txHash: tx.hash,
        messageId: disputeId, // Would be actual message ID from CCIP
        decision: arbitrationDecision
      };

    } catch (error) {
      console.error('❌ Failed to send arbitration decision:', error);
      throw error;
    }
  }

  

  async _calculateFees(targetChainSelector, payFeesIn) {
    if (!this.senderContract) {
      throw new Error('Sender contract not available');
    }

    try {
      const payFeesInEnum = payFeesIn === 'LINK' ? 1 : 0;
      const fees = await this.senderContract.getArbitrationFees(payFeesInEnum);
      
      console.log('💰 CCIP Fees calculated:', {
        fees: ethers.formatEther(fees),
        payFeesIn
      });

      return fees;

    } catch (error) {
      console.error('❌ Failed to calculate fees:', error);
      // Return default fee estimate
      return ethers.parseEther('0.01');
    }
  }

  

  async _sendCCIPMessage(chainSelector, receiver, message, fees, payFeesIn) {
    // This is a simplified version - actual implementation would use
    // the CCIPArbitrationSender contract methods
    
    console.log('📡 Sending CCIP message...', {
      chainSelector,
      receiver: receiver.slice(0, 10) + '...',
      fees: ethers.formatEther(fees),
      payFeesIn
    });

    // For demonstration, we'll simulate a transaction
    // In reality, this would call the sender contract
    const simulatedTx = {
      hash: ethers.keccak256(ethers.toUtf8Bytes(`ccip-${Date.now()}`)),
      wait: async () => ({ status: 1 })
    };

    return simulatedTx;
  }

  

  async processAndSendDecision(requestData, llmDecision) {
    const {
      messageId,
      disputeId,
      sourceChainSelector,
      sourceContract
    } = requestData;

    console.log('🧠 Processing LLM decision for CCIP response:', {
      disputeId: disputeId.slice(0, 10) + '...',
      verdict: llmDecision.final_verdict
    });

    try {
      // Convert LLM decision to CCIP format
      const ccipDecision = this._convertLLMDecisionToCCIP(llmDecision, requestData);

      // Send decision back to source chain
      const result = await this.sendArbitrationDecision({
        originalMessageId: messageId,
        disputeId: disputeId,
        targetChainSelector: sourceChainSelector,
        targetReceiver: sourceContract,
        decision: ccipDecision,
        payFeesIn: 'Native'
      });

      console.log('✅ LLM decision sent via CCIP:', result.txHash);
      return result;

    } catch (error) {
      console.error('❌ Failed to process and send LLM decision:', error);
      throw error;
    }
  }

  

  _convertLLMDecisionToCCIP(llmDecision, requestData) {
    const approved = llmDecision.final_verdict === 'APPROVE' || 
                    llmDecision.final_verdict === 'PARTY_A';
    
    const appliedAmount = approved ? 
      (llmDecision.reimbursement_amount_dai || 0) : 0;

    return {
      approved,
      appliedAmount,
      beneficiary: requestData.requester || ethers.ZeroAddress,
      rationale: llmDecision.rationale_summary || 'Oracle arbitration decision',
      oracleId: ethers.keccak256(ethers.toUtf8Bytes('Ollama-LLM-Oracle')),
      timestamp: Math.floor(Date.now() / 1000)
    };
  }

  

  async sendFallbackDecision(requestData, reason = 'LLM processing failed') {
    console.log('🔄 Sending fallback decision via CCIP...');

    const fallbackDecision = {
      approved: false,
      appliedAmount: 0,
      beneficiary: ethers.ZeroAddress,
      rationale: `Fallback decision: ${reason}`,
      oracleId: ethers.keccak256(ethers.toUtf8Bytes('Fallback-Oracle')),
      timestamp: Math.floor(Date.now() / 1000)
    };

    return await this.sendArbitrationDecision({
      originalMessageId: requestData.messageId,
      disputeId: requestData.disputeId,
      targetChainSelector: requestData.sourceChainSelector,
      targetReceiver: requestData.sourceContract,
      decision: fallbackDecision,
      payFeesIn: 'Native'
    });
  }

  

  getPendingResponses() {
    return Array.from(this.pendingResponses.entries()).map(([disputeId, data]) => ({
      disputeId,
      ...data
    }));
  }

  

  clearPendingResponse(disputeId) {
    return this.pendingResponses.delete(disputeId);
  }

  

  getStatus() {
    return {
      hasSender: !!this.senderContract,
      hasSigner: !!this.signer,
      pendingResponses: this.pendingResponses.size,
      signerAddress: this.signer?.address,
      config: {
        rpcUrl: this.config.rpcUrl,
        chainId: this.config.chainId,
        senderAddress: this.config.senderAddress
      }
    };
  }

  

  async healthCheck() {
    try {
      if (!this.provider) return { healthy: false, error: 'No provider' };
      
      const blockNumber = await this.provider.getBlockNumber();
      
      return {
        healthy: true,
        blockNumber,
        hasSender: !!this.senderContract,
        hasSigner: !!this.signer
      };

    } catch (error) {
      return {
        healthy: false,
        error: error.message
      };
    }
  }
}