


import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getContractAddress } from '../utils/deploymentLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class CCIPArbitrationIntegration {
  constructor(config = {}) {
    this.config = {
      rpcUrl: config.rpcUrl || process.env.RPC_URL || 'http://127.0.0.1:8545',
      ccipSenderAddress: config.ccipSenderAddress || process.env.CCIP_SENDER_ADDRESS,
      ccipReceiverAddress: config.ccipReceiverAddress || process.env.CCIP_RECEIVER_ADDRESS,
      arbitrationServiceAddress: config.arbitrationServiceAddress || process.env.ARBITRATION_SERVICE_ADDRESS,
      privateKey: config.privateKey || process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Default hardhat key
      ...config
    };
    
    this.provider = null;
    this.signer = null;
    this.contracts = {};
    
    this.initializeProvider();
  }

  

  async initializeProvider() {
    try {
      this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
      this.signer = new ethers.Wallet(this.config.privateKey, this.provider);
      
      await this.loadContracts();
      console.log('✅ CCIP Arbitration Integration initialized');
    } catch (error) {
      console.error('❌ Failed to initialize CCIP integration:', error.message);
    }
  }

  

  async loadContracts() {
    try {
      // Load addresses via deploymentLoader (deployment-summary.json or env fallback)
      this.config.ccipSenderAddress = getContractAddress('CCIPArbitrationSender') || this.config.ccipSenderAddress;
      this.config.ccipReceiverAddress = getContractAddress('CCIPArbitrationReceiver') || this.config.ccipReceiverAddress;
      this.config.arbitrationServiceAddress = getContractAddress('ArbitrationService') || this.config.arbitrationServiceAddress;

      console.log('📋 Addresses resolved:');
      console.log(`  • ArbitrationService: ${this.config.arbitrationServiceAddress}`);

      // Load ABIs
      const ccipSenderABI = this.loadABI('contracts/Arbitration/ccip/CCIPArbitrationSender.sol/CCIPArbitrationSender.json');
      const ccipReceiverABI = this.loadABI('contracts/Arbitration/ccip/CCIPArbitrationReceiver.sol/CCIPArbitrationReceiver.json');
      const arbitrationServiceABI = this.loadABI('contracts/Arbitration/ArbitrationService.sol/ArbitrationService.json');

      // Create contract instances
      if (this.config.ccipSenderAddress && ccipSenderABI) {
        this.contracts.ccipSender = new ethers.Contract(
          this.config.ccipSenderAddress,
          ccipSenderABI,
          this.signer
        );
        // Check for sendArbitrationDecision method
        if (!ccipSenderABI.some(e => e.type === 'function' && e.name === 'sendArbitrationDecision')) {
          console.warn('⚠️ ABI for CCIPArbitrationSender does not include sendArbitrationDecision. Check contract deployment and ABI file.');
        }
      }

      if (this.config.ccipReceiverAddress && ccipReceiverABI) {
        this.contracts.ccipReceiver = new ethers.Contract(
          this.config.ccipReceiverAddress,
          ccipReceiverABI,
          this.signer
        );
      }

      if (this.config.arbitrationServiceAddress && arbitrationServiceABI) {
        this.contracts.arbitrationService = new ethers.Contract(
          this.config.arbitrationServiceAddress,
          arbitrationServiceABI,
          this.signer
        );
      }

      console.log('📋 CCIP Contracts loaded:');
      console.log(`  • Sender: ${this.config.ccipSenderAddress}`);
      console.log(`  • Receiver: ${this.config.ccipReceiverAddress}`);
      console.log(`  • ArbitrationService: ${this.config.arbitrationServiceAddress}`);

    } catch (error) {
      console.error('❌ Failed to load contracts:', error.message);
    }
  }

  

  loadABI(contractPath) {
    try {
      // Try common artifact locations (Hardhat default and repo-specific folders)
      const candidates = [
        path.resolve(__dirname, '../../artifacts', contractPath),
        path.resolve(__dirname, '../artifacts', contractPath),
        path.resolve(__dirname, '../../artifacts', path.basename(contractPath)),
        path.resolve(__dirname, '../artifacts', path.basename(contractPath)),
        // Direct lookups for CCIP folder
        path.resolve(__dirname, '../../artifacts/contracts/ccip', path.basename(contractPath)),
        path.resolve(__dirname, '../artifacts/contracts/ccip', path.basename(contractPath)),
        // Correct path for CCIP contracts in Arbitration folder
        path.resolve(__dirname, '../../artifacts/contracts/Arbitration/ccip', path.basename(contractPath))
      ];

      for (const artifactPath of candidates) {
        if (fs.existsSync(artifactPath)) {
          try {
            const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
            if (artifact && artifact.abi) return artifact.abi;
          } catch (e) {
            // Silently ignore parse errors
          }
        }
      }

      // ABI not found - return null silently
      return null;
    } catch (error) {
      // Silently return null on error
      return null;
    }
  }

  

  async startCCIPListener() {
    if (!this.contracts.ccipReceiver) {
      console.warn('⚠️ CCIP Receiver contract not available');
      return false;
    }

    try {
      // Check available events
      const availableEvents = this.contracts.ccipReceiver.interface.fragments
        .filter(f => f.type === 'event')
        .map(f => f.name);
      
      console.log('📋 Available events:', availableEvents);

      // Try to listen for relevant events that exist
      let listenerStarted = false;

      // Listen for ArbitrationRequestSent (if it exists)
      if (availableEvents.includes('ArbitrationRequestSent')) {
        this.contracts.ccipReceiver.on('ArbitrationRequestSent', async (requestId, targetChain, contractAddress, disputeData, event) => {
          console.log('🔔 CCIP Arbitration Request Sent detected:');
          console.log(`  Request ID: ${requestId}`);
          console.log(`  Target Chain: ${targetChain}`);
          console.log(`  Contract: ${contractAddress}`);
          console.log(`  Dispute Data: ${disputeData}`);

          // Process the arbitration request
          await this.processCCIPArbitration(requestId, targetChain, contractAddress, disputeData);
        });
        listenerStarted = true;
        console.log('👂 Listening for ArbitrationRequestSent events');
      }

      // Listen for ArbitrationDecisionReceived (if it exists)
      if (availableEvents.includes('ArbitrationDecisionReceived')) {
        this.contracts.ccipReceiver.on(
          'ArbitrationDecisionReceived',
          async (
            messageId,
            disputeId,
            sourceChainSelector,
            approved,
            appliedAmount,
            beneficiary,
            rationale,
            oracleId,
            timestamp,
            event
          ) => {
            console.log('📨 CCIP Arbitration Decision Received:');
            console.log(`  Message ID: ${messageId}`);
            console.log(`  Dispute ID: ${disputeId}`);
            console.log(`  Source Chain Selector: ${sourceChainSelector}`);
            console.log(`  Approved: ${approved}`);
            console.log(`  Applied Amount: ${appliedAmount}`);
            console.log(`  Beneficiary: ${beneficiary}`);
            console.log(`  Rationale: ${rationale}`);
            console.log(`  Oracle ID: ${oracleId}`);
            console.log(`  Timestamp: ${timestamp}`);
          }
        );
        console.log('👂 Listening for ArbitrationDecisionReceived events');
      }

      if (listenerStarted) {
        console.log('👂 CCIP Event Listener started successfully');
        return true;
      } else {
        console.warn('⚠️ No relevant CCIP events found to listen to');
        return false;
      }

    } catch (error) {
      console.error('❌ Failed to start CCIP listener:', error.message);
      console.log('🔄 CCIP listener will be disabled for this session');
      return false;
    }
  }

  

  async processCCIPArbitration(requestId, sourceChain, contractAddress, disputeData) {
    try {
      console.log(`🤖 Processing CCIP arbitration for request ${requestId}...`);

      // If disputeData is not a Buffer or hex string, serialize it as ABI-encoded bytes
      let encodedDisputeData;
      if (typeof disputeData === 'object' && disputeData !== null && !Buffer.isBuffer(disputeData)) {
        encodedDisputeData = ethers.AbiCoder.defaultAbiCoder().encode(
          ['string', 'string', 'string', 'string'],
          [
            disputeData.disputeType || 'test_dispute',
            disputeData.evidenceDescription || 'Test evidence for CCIP integration',
            disputeData.requestedAmount || '1.0',
            disputeData.additionalContext || JSON.stringify({ test: true })
          ]
        );
      } else {
        encodedDisputeData = disputeData;
      }

      // Parse dispute data
      const parsedData = this.parseDisputeData(encodedDisputeData);

      // Call LLM arbitration
      const arbitrationResult = await this.callLLMArbitration(parsedData);

      // Send result back via CCIP
      await this.sendCCIPDecision(requestId, sourceChain, contractAddress, arbitrationResult);

      console.log(`✅ CCIP arbitration completed for request ${requestId}`);
    } catch (error) {
      console.error(`❌ CCIP arbitration failed for request ${requestId}:`, error.message);
    }
  }

  

  parseDisputeData(disputeData) {
    try {
      // Decode the dispute data (assuming it's ABI encoded)
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ['string', 'string', 'uint256', 'string'],
        disputeData
      );

      return {
        disputeType: decoded[0],
        evidenceDescription: decoded[1],
        requestedAmount: ethers.formatEther(decoded[2]),
        additionalContext: decoded[3]
      };
    } catch (error) {
      console.warn('⚠️ Failed to parse dispute data, using raw data:', error.message);
      return {
        disputeType: 'general_dispute',
        evidenceDescription: disputeData.toString(),
        requestedAmount: '0',
        additionalContext: '{}'
      };
    }
  }

  

  async callLLMArbitration(disputeData) {
    try {
      // Import LLM arbitrator
      const { processV7ArbitrationWithOllama } = await import('./ollamaLLMArbitrator.js');

      // Prepare arbitration request
      const arbitrationRequest = {
        contract_text: `CCIP Cross-Chain Arbitration Request
        Dispute Type: ${disputeData.disputeType}
        Requested Amount: ${disputeData.requestedAmount} ETH
        Additional Context: ${disputeData.additionalContext}`,
        evidence_text: disputeData.evidenceDescription,
        dispute_question: 'Based on the cross-chain dispute, what is the appropriate resolution?',
        requested_amount: parseFloat(disputeData.requestedAmount) || 0
      };

      // Always call LLM unless an actual error occurs
      const result = await processV7ArbitrationWithOllama(arbitrationRequest);

      return {
        verdict: result.final_verdict || result.decision || 'DRAW',
        reimbursementAmount: result.reimbursement_amount_dai || result.reimbursement || 0,
        reasoning: result.rationale_summary || result.reasoning || 'CCIP arbitration completed',
        confidence: result.confidence || 85
      };
    } catch (error) {
      console.error('❌ LLM arbitration failed:', error.message);
      // Only fallback to simulation if LLM call fails
      const { processV7Arbitration } = await import('./llmArbitrationSimulator.js');
      const result = await processV7Arbitration({
        contract_text: `CCIP Fallback Arbitration`,
        evidence_text: disputeData.evidenceDescription
      });
      return {
        verdict: result.final_verdict || 'DRAW',
        reimbursementAmount: result.reimbursement_amount_dai || 0,
        reasoning: result.rationale_summary || 'Fallback arbitration completed',
        confidence: 60
      };
    }
  }

  

  async sendCCIPDecision(requestId, sourceChain, contractAddress, decision) {
    if (!this.contracts.ccipSender) {
      console.warn('⚠️ CCIP Sender contract not available');
      return false;
    }

    try {
      // Convert confidence to integer (multiply by 100, round)
      let confidenceInt = 0;
      if (typeof decision.confidence === 'number') {
        confidenceInt = Math.round(decision.confidence * 100);
      } else if (typeof decision.confidence === 'string') {
        const num = parseFloat(decision.confidence);
        confidenceInt = isNaN(num) ? 0 : Math.round(num * 100);
      }

      // Encode the decision data
      const decisionData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'uint256', 'string', 'uint16'],
        [
          decision.verdict,
          ethers.parseEther(decision.reimbursementAmount.toString()),
          decision.reasoning,
          confidenceInt
        ]
      );

      // Send CCIP message with decision
      const tx = await this.contracts.ccipSender.sendArbitrationDecision(
        sourceChain,
        contractAddress,
        requestId,
        decisionData,
        { gasLimit: 500000 }
      );

      console.log(`📡 CCIP decision sent. TX: ${tx.hash}`);
      await tx.wait();
      console.log(`✅ CCIP decision confirmed for request ${requestId}`);

      return true;
    } catch (error) {
      console.error('❌ Failed to send CCIP decision:', error.message);
      return false;
    }
  }

  

  async getStatus() {
    const isListening = !!this.contracts.ccipReceiver;
    const canSend = !!this.contracts.ccipSender;
    
    return {
      provider_connected: !!this.provider,
      signer_ready: !!this.signer,
      ccip_receiver_loaded: isListening,
      ccip_sender_loaded: canSend,
      arbitration_service_loaded: !!this.contracts.arbitrationService,
      listening_for_requests: isListening,
      sender_address: this.config.ccipSenderAddress,
      receiver_address: this.config.ccipReceiverAddress,
      arbitration_service_address: this.config.arbitrationServiceAddress,
      rpc_url: this.config.rpcUrl
    };
  }
}

// Export default instance
export const ccipArbitrationIntegration = new CCIPArbitrationIntegration();