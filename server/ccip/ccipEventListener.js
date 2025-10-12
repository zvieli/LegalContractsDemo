


import { ethers } from 'ethers';
import { processV7ArbitrationWithOllama, ollamaLLMArbitrator } from '../modules/ollamaLLMArbitrator.js';
import fs from 'fs';
import path from 'path';

export class CCIPEventListener {
  constructor(config = {}) {
    this.config = {
      rpcUrl: config.rpcUrl || 'http://127.0.0.1:8545',
      chainId: config.chainId || 31337,
      receiverAddress: config.receiverAddress,
      senderAddress: config.senderAddress,
      pollingInterval: config.pollingInterval || 5000,
      enableLLM: config.enableLLM !== false,
      ...config
    };

    this.provider = null;
    this.receiverContract = null;
    this.senderContract = null;
    this.arbitrationServiceContract = null;
    this.llmArbitrator = null;
    this.isListening = false;
    this.processedEvents = new Set();

    console.log('🔗 CCIP Event Listener initialized:', {
      rpcUrl: this.config.rpcUrl,
      chainId: this.config.chainId,
      enableLLM: this.config.enableLLM
    });
  }

  

  async initialize() {
    try {
      // Setup provider
      this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
      
      // Initialize LLM if enabled
      if (this.config.enableLLM) {
        this.llmArbitrator = ollamaLLMArbitrator;
      }

      // Load contract ABIs and setup contracts
      await this._setupContracts();

      console.log('✅ CCIP Event Listener initialized successfully');
      return true;

    } catch (error) {
      console.error('❌ Failed to initialize CCIP Event Listener:', error);
      return false;
    }
  }

  

  async _setupContracts() {
    try {
      // Load ABIs from artifacts
      const receiverABI = await this._loadContractABI('CCIPArbitrationReceiver');
      const senderABI = await this._loadContractABI('CCIPArbitrationSender');

      // Setup receiver contract if address provided
      if (this.config.receiverAddress && receiverABI) {
        this.receiverContract = new ethers.Contract(
          this.config.receiverAddress,
          receiverABI,
          this.provider
        );
        console.log('📡 CCIP Receiver contract loaded:', this.config.receiverAddress);
      }

      // Setup sender contract if address provided  
      if (this.config.senderAddress && senderABI) {
        this.senderContract = new ethers.Contract(
          this.config.senderAddress,
          senderABI,
          this.provider
        );
        console.log('📤 CCIP Sender contract loaded:', this.config.senderAddress);
      }

    } catch (error) {
      console.error('❌ Failed to setup contracts:', error);
      throw error;
    }
  }

  

  async _loadContractABI(contractName) {
    try {
      // Try local artifacts first (copied ABIs)
      const localArtifactPath = path.join(process.cwd(), 'artifacts', 'contracts', 'ccip', `${contractName}.json`);
      
      if (fs.existsSync(localArtifactPath)) {
        const artifact = JSON.parse(fs.readFileSync(localArtifactPath, 'utf8'));
        return artifact.abi;
      }

      // Fallback to main artifacts folder
      const mainArtifactPath = path.join(process.cwd(), '..', 'artifacts', 'contracts', 'ccip', `${contractName}.sol`, `${contractName}.json`);
      
      if (fs.existsSync(mainArtifactPath)) {
        const artifact = JSON.parse(fs.readFileSync(mainArtifactPath, 'utf8'));
        return artifact.abi;
      }

      console.warn(`⚠️ ABI not found for ${contractName} at ${localArtifactPath}`);
      return null;

    } catch (error) {
      console.error(`❌ Failed to load ABI for ${contractName}:`, error);
      return null;
    }
  }

  

  async startListening() {
    if (this.isListening) {
      console.log('🔄 CCIP Event Listener already running');
      return;
    }

    if (!this.receiverContract) {
      console.error('❌ Cannot start listening: Receiver contract not initialized');
      return;
    }

    this.isListening = true;
    console.log('🎧 Starting CCIP Event Listener...');

    // Listen for arbitration request events
    this._listenForArbitrationRequests();

    // Listen for decision received events
    this._listenForDecisionEvents();

    console.log('✅ CCIP Event Listener started successfully');
  }

  

  stopListening() {
    this.isListening = false;
    
    if (this.receiverContract) {
      this.receiverContract.removeAllListeners();
    }
    
    console.log('🛑 CCIP Event Listener stopped');
  }

  

  _listenForArbitrationRequests() {
    if (!this.receiverContract) return;

    // Listen for ArbitrationRequestSent events
    this.receiverContract.on('ArbitrationRequestSent', async (
      messageId,
      disputeId,
      destinationChainSelector,
      contractAddress,
      caseId,
      event
    ) => {
      const eventId = `${messageId}-${event.blockNumber}-${event.transactionHash}`;
      
      if (this.processedEvents.has(eventId)) {
        return; // Already processed
      }

      console.log('📨 Arbitration Request Received:', {
        messageId,
        disputeId,
        contractAddress,
        caseId,
        block: event.blockNumber
      });

      try {
        await this._processArbitrationRequest({
          messageId,
          disputeId,
          contractAddress,
          caseId,
          event
        });

        this.processedEvents.add(eventId);

      } catch (error) {
        console.error('❌ Failed to process arbitration request:', error);
      }
    });
  }

  

  _listenForDecisionEvents() {
    if (!this.receiverContract) return;

    // Listen for ArbitrationDecisionReceived events
    this.receiverContract.on('ArbitrationDecisionReceived', async (
      messageId,
      disputeId,
      sourceChainSelector,
      approved,
      appliedAmount,
      event
    ) => {
      console.log('📩 Arbitration Decision Received:', {
        messageId,
        disputeId,
        approved,
        appliedAmount,
        block: event.blockNumber
      });

      // Log decision for monitoring
      this._logDecision({
        messageId,
        disputeId,
        approved,
        appliedAmount,
        sourceChain: sourceChainSelector,
        timestamp: Date.now()
      });
    });
  }

  

  async _processArbitrationRequest(requestData) {
    const { messageId, disputeId, contractAddress, caseId } = requestData;

    console.log('🧠 Processing arbitration request with LLM...');

    if (!this.config.enableLLM || !this.llmArbitrator) {
      console.log('⚠️ LLM disabled, skipping arbitration processing');
      return;
    }

    try {
      // Gather evidence and contract data
      const arbitrationData = await this._gatherArbitrationData(
        contractAddress,
        caseId,
        disputeId
      );

      // Process with LLM
      const decision = await processV7ArbitrationWithOllama(arbitrationData);

      console.log('✅ LLM Decision:', {
        disputeId: disputeId.slice(0, 10) + '...',
        verdict: decision.final_verdict,
        amount: decision.reimbursement_amount_dai
      });

      // Send decision back via CCIP (this would be implemented)
      await this._sendArbitrationDecision(messageId, disputeId, decision, arbitrationData);

    } catch (error) {
      console.error('❌ Failed to process arbitration with LLM:', error);
      
      // Send fallback decision
      await this._sendFallbackDecision(messageId, disputeId);
    }
  }

  

  async _gatherArbitrationData(contractAddress, caseId, disputeId) {
    // This would integrate with existing evidence gathering
    // For now, return sample data
    return {
      contract_text: `Contract at ${contractAddress}, Case ${caseId}`,
      evidence_text: `Evidence for dispute ${disputeId}`,
      dispute_question: 'What is the appropriate resolution for this dispute?',
      requested_amount: 1000
    };
  }

  

  async _sendArbitrationDecision(messageId, disputeId, decision, arbitrationData) {
    console.log('📤 Sending arbitration decision via ArbitrationService...');
    
    try {
      // Convert LLM decision to contract format
      const approved = decision.final_verdict !== 'REJECT';
      const appliedAmount = approved ? (decision.reimbursement_amount_dai || 0) : 0;
      
      // Get arbitration service contract if configured
      if (this.config.arbitrationServiceAddress) {
        const arbitrationService = await this._getArbitrationServiceContract();
        
        if (arbitrationService && arbitrationData) {
          // Call receiveCCIPDecision on ArbitrationService
          const tx = await arbitrationService.receiveCCIPDecision(
            messageId,
            arbitrationData.contractAddress,
            arbitrationData.caseId,
            {
              disputeId: disputeId,
              approved: approved,
              appliedAmount: ethers.parseEther(appliedAmount.toString()),
              beneficiary: arbitrationData.beneficiary || arbitrationData.contractAddress,
              rationale: decision.rationale || 'Oracle decision',
              oracleId: ethers.keccak256(ethers.toUtf8Bytes('ollama-llm')),
              timestamp: Math.floor(Date.now() / 1000)
            }
          );
          
          console.log('✅ Decision sent to ArbitrationService:', {
            txHash: tx.hash,
            approved,
            appliedAmount
          });
          
          return tx;
        }
      }
      
      // Fallback: just log the decision
      console.log('📋 Decision (no ArbitrationService configured):', {
        messageId: messageId.slice(0, 10) + '...',
        disputeId: disputeId.slice(0, 10) + '...',
        approved,
        amount: appliedAmount
      });
      
    } catch (error) {
      console.error('❌ Failed to send decision to ArbitrationService:', error);
      throw error;
    }
  }

  

  async _sendFallbackDecision(messageId, disputeId) {
    console.log('🔄 Sending fallback decision...');
    
    const fallbackDecision = {
      final_verdict: 'DRAW',
      reimbursement_amount_dai: 500,
      rationale: 'Fallback decision due to processing error'
    };

    await this._sendArbitrationDecision(messageId, disputeId, fallbackDecision, null);
  }

  

  async _getArbitrationServiceContract() {
    if (!this.arbitrationServiceContract && this.config.arbitrationServiceAddress) {
      try {
        // Load ArbitrationService ABI
        const abiPath = path.join(process.cwd(), 'artifacts/contracts/ArbitrationService.sol/ArbitrationService.json');
        const artifactData = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
        
        // Create signer from private key if provided
        let signer = this.provider;
        if (this.config.privateKey) {
          signer = new ethers.Wallet(this.config.privateKey, this.provider);
        }
        
        this.arbitrationServiceContract = new ethers.Contract(
          this.config.arbitrationServiceAddress,
          artifactData.abi,
          signer
        );
        
        console.log('📋 ArbitrationService contract loaded:', this.config.arbitrationServiceAddress);
      } catch (error) {
        console.error('❌ Failed to load ArbitrationService contract:', error);
        return null;
      }
    }
    
    return this.arbitrationServiceContract;
  }

  

  _logDecision(decision) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      ...decision
    };

    console.log('📊 Decision logged:', logEntry);
    
    // Could save to file or database here
  }

  

  getStatus() {
    return {
      isListening: this.isListening,
      hasReceiver: !!this.receiverContract,
      hasSender: !!this.senderContract,
      llmEnabled: this.config.enableLLM,
      processedEvents: this.processedEvents.size,
      config: {
        rpcUrl: this.config.rpcUrl,
        chainId: this.config.chainId,
        receiverAddress: this.config.receiverAddress,
        senderAddress: this.config.senderAddress
      }
    };
  }

  

  getProcessedEventsCount() {
    return this.processedEvents.size;
  }

  

  clearProcessedEvents() {
    this.processedEvents.clear();
    console.log('🧹 Processed events cache cleared');
  }
}