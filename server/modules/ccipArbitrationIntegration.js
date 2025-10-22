


import { ethers } from 'ethers';
import { getProviderSync } from '../lib/getProvider.js';
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
      // prefer local or env-configured RPC
      try {
        this.provider = getProviderSync();
      } catch (e) {
        this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
      }
      this.signer = new ethers.Wallet(this.config.privateKey, this.provider);
      
      await this.loadContracts();
      // Ensure the server signer is authorized on the CCIP sender in development when configured
      try {
        await this.ensureSenderAuthorization();
      } catch (authErr) {
        console.warn('⚠️ Sender authorization preflight failed:', authErr && authErr.message ? authErr.message : authErr);
      }
      console.log('✅ CCIP Arbitration Integration initialized');
    } catch (error) {
      console.error('❌ Failed to initialize CCIP integration:', error.message);
    }
  }

  /**
   * Ensure the signer used by the server is authorized in the CCIP sender contract.
   * Auto-authorize in dev when safe (signer is owner or DEV_AUTO_AUTHORIZE=true with DEV_OWNER_PRIVATE_KEY set).
   */
  async ensureSenderAuthorization() {
    if (!this.contracts.ccipSender) return;
    try {
      const signerAddr = await this.signer.getAddress();
      // Check mapping
      let isAuth = false;
      try {
        isAuth = await this.contracts.ccipSender.authorizedContracts(signerAddr);
      } catch (e) {
        // If the mapping call fails, proceed to log and continue
        console.warn('Could not read authorizedContracts mapping:', e && e.message ? e.message : e);
      }

      if (isAuth) {
        console.log(`🔐 CCIP sender: signer ${signerAddr} already authorized`);
        return true;
      }

      // If signer equals owner, we can authorize directly
      let ownerAddr = null;
      try {
        ownerAddr = await this.contracts.ccipSender.owner();
      } catch (e) {
        // ignore
      }

      const devAuto = (process.env.DEV_AUTO_AUTHORIZE || '').toString().toLowerCase() === 'true';
      const ownerPriv = process.env.DEV_OWNER_PRIVATE_KEY || process.env.OWNER_PRIVATE_KEY || null;

      if (ownerAddr && ownerAddr.toLowerCase() === signerAddr.toLowerCase()) {
        // signer is owner -> authorize itself
        console.log('🔧 CCIP sender: signer is owner, authorizing signer on-chain');
        try {
          const tx = await this.contracts.ccipSender.setContractAuthorization(signerAddr, true);
          await tx.wait();
          console.log('✅ CCIP sender: signer authorized (owner flow)');
          return true;
        } catch (e) {
          console.warn('Failed to auto-authorize signer as owner:', e && e.message ? e.message : e);
          return false;
        }
      }

      // If dev auto-authorize is enabled and an owner private key is provided, use it to authorize signer
      if (devAuto && ownerPriv) {
        try {
          console.log('🔧 CCIP sender: DEV_AUTO_AUTHORIZE enabled, using provided owner private key to authorize signer');
          const ownerWallet = new ethers.Wallet(ownerPriv, this.provider);
          const ownerSender = new ethers.Contract(this.config.ccipSenderAddress, this.contracts.ccipSender.interface, ownerWallet);
          const tx = await ownerSender.setContractAuthorization(signerAddr, true);
          await tx.wait();
          console.log('✅ CCIP sender: signer authorized (dev owner flow)');
          return true;
        } catch (e) {
          console.warn('Failed to auto-authorize signer using owner private key:', e && e.message ? e.message : e);
          return false;
        }
      }

      // Otherwise, just warn and leave it to operator
      console.warn(`⚠️ CCIP sender: signer ${signerAddr} is not authorized. Set DEV_AUTO_AUTHORIZE=true and provide DEV_OWNER_PRIVATE_KEY to auto-authorize in dev, or call setContractAuthorization(owner, true) from the contract owner.`);
      return false;
    } catch (err) {
      console.warn('ensureSenderAuthorization failed:', err && err.message ? err.message : err);
      return false;
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
      // attach global forwarder if present
      try {
        if (global && global.__DISPUTE_FORWARDER_INSTANCE) this.forwarder = global.__DISPUTE_FORWARDER_INSTANCE;
      } catch (e) {}
      // Check available events
      const availableEvents = this.contracts.ccipReceiver.interface.fragments
        .filter(f => f.type === 'event')
        .map(f => f.name);
      
      console.log('📋 Available events:', availableEvents);

      // Try to listen for relevant events that exist
      let listenerStarted = false;

      // Listen for ArbitrationRequestSent (if it exists)
      if (availableEvents.includes('ArbitrationRequestSent')) {
        // attach via safe wrapper to prevent provider edge-cases from killing the process
        const { safeOn } = await import('../lib/providerSafe.js');
        safeOn(this.contracts.ccipReceiver, 'ArbitrationRequestSent', async (requestId, targetChain, contractAddress, disputeData, event) => {
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
        const { safeOn } = await import('../lib/providerSafe.js');
        safeOn(
          this.contracts.ccipReceiver,
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


      // If a forwarder is configured, enqueue job instead of calling LLM directly
      if (this.forwarder) {
        try {
          const job = this.forwarder.enqueueJob({
            evidenceRef: parsedData.evidenceDescription || null,
            caseId: null,
            contractAddress: contractAddress || null,
            triggerSource: 'ccip',
            messageId: requestId,
            disputeId: requestId
          });
          console.log('📥 Enqueued CCIP arbitration job to forwarder:', job.jobId);
          return job;
        } catch (e) {
          console.warn('⚠️ Failed to enqueue CCIP job to forwarder, falling back to direct LLM call:', e && e.message ? e.message : e);
        }
      }

      // Call LLM arbitration (fallback)
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
      // Use the local mock/Ollama adapter for arbitration (centralized adapter)
      const { resolveArbitration } = await import('./mockArbitrationAdapter.js');
      const arbitrationRequest = {
        contract_text: `CCIP Cross-Chain Arbitration Request\nDispute Type: ${disputeData.disputeType}\nRequested Amount: ${disputeData.requestedAmount} ETH\nAdditional Context: ${disputeData.additionalContext}`,
        evidence_text: disputeData.evidenceDescription,
        dispute_question: 'Based on the cross-chain dispute, what is the appropriate resolution?',
        requested_amount: parseFloat(disputeData.requestedAmount) || 0
      };

      const result = await resolveArbitration(arbitrationRequest);

      return {
        verdict: result.final_verdict || result.verdict || 'DRAW',
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

      // Try to detect which sendArbitrationDecision variant the ABI exposes
      let called = false;
      try {
        // Debug: list overloads for sendArbitrationDecision
        try {
          const overloads = this.contracts.ccipSender.interface.fragments.filter(f => f.name === 'sendArbitrationDecision');
          console.log('🔍 sendArbitrationDecision overloads found:', overloads.map(f => ({ name: f.name, inputs: f.inputs ? f.inputs.length : 0, signature: f.format && typeof f.format === 'function' ? f.format() : '' })));
        } catch (dbg) {
          console.log('🔍 Could not enumerate overloads for sendArbitrationDecision:', dbg && dbg.message ? dbg.message : dbg);
        }

        // Prefer fully-qualified 7-arg signature if present
        let fragment = null;
        try {
          fragment = this.contracts.ccipSender.interface.getFunction('sendArbitrationDecision(bytes32,bool,uint256,address,string,bytes32,uint8)');
        } catch (e) {
          // ignore - function may not be present
        }

        // If not found, fall back to name-only lookup
        if (!fragment) {
          try { fragment = this.contracts.ccipSender.interface.getFunction('sendArbitrationDecision'); } catch (e) { fragment = null; }
        }

        // If the solidity implementation (CCIPArbitrationSender) is present it expects 7 inputs
        if (fragment && fragment.inputs && fragment.inputs.length === 7) {
          // Map our decision to the expected arguments
          // Convert requestId to a bytes32 value (keccak256 of the requestId string)
          const disputeId = ethers.keccak256(ethers.toUtf8Bytes(String(requestId)));
          const approved = (typeof decision.verdict === 'string' && decision.verdict.toUpperCase().includes('PARTY_A_WINS')) || (String(decision.verdict).toUpperCase() === 'APPROVE');
          // Parse reimbursement amount safely. Accept numbers or ETH strings; fallback to 0 if unparseable or NONE
          let appliedAmount = 0n;
          try {
            const rawAmt = decision.reimbursementAmount;
            if (rawAmt === null || typeof rawAmt === 'undefined') {
              appliedAmount = 0n;
            } else if (typeof rawAmt === 'number' || (typeof rawAmt === 'string' && rawAmt.match(/^\d+(?:\.\d+)?$/))) {
              appliedAmount = ethers.parseEther(String(rawAmt));
            } else if (typeof rawAmt === 'string' && rawAmt.toUpperCase().includes('ETH')) {
              // Strip trailing ' ETH' if present
              const cleaned = rawAmt.toUpperCase().replace(/\s*ETH\s*/i, '');
              if (cleaned.match(/^\d+(?:\.\d+)?$/)) appliedAmount = ethers.parseEther(cleaned);
              else appliedAmount = 0n;
            } else {
              appliedAmount = 0n;
            }
          } catch (paErr) {
            appliedAmount = 0n;
          }
          const beneficiary = contractAddress || ethers.ZeroAddress || '0x' + '0'.repeat(40);
          const rationale = decision.reasoning || '';
          const oracleId = '0x' + '0'.repeat(64);
          const payFeesIn = 0; // PayFeesIn.Native

          // Attempt to fetch required fees (view) and supply as value when calling payable function
          let fees = 0n;
          try {
            if (typeof this.contracts.ccipSender.getArbitrationFees === 'function') {
              const feeRes = await this.contracts.ccipSender.getArbitrationFees(payFeesIn);
              fees = BigInt(feeRes || 0);
            }
          } catch (feeErr) {
            // ignore fee fetch errors and proceed without value
            fees = 0n;
          }

          // Debug: print final call arguments (types and short string forms)
          console.log('🔧 Calling sendArbitrationDecision with args:', {
            disputeId,
            approved,
            appliedAmount: appliedAmount.toString(),
            beneficiary,
            rationale: rationale && rationale.slice(0, 120) + (rationale && rationale.length > 120 ? '...' : ''),
            oracleId,
            payFeesIn,
            value: fees.toString()
          });

          // Build calldata explicitly to avoid ABI fragment resolution issues
          const iface = this.contracts.ccipSender.interface;
          const fullSig = 'sendArbitrationDecision(bytes32,bool,uint256,address,string,bytes32,uint8)';
          const calldata = iface.encodeFunctionData(fullSig, [disputeId, approved, appliedAmount, beneficiary, rationale, oracleId, payFeesIn]);
          console.log('🔧 Encoded calldata (prefix):', calldata.slice(0, 256));

          // Use signer to send raw transaction with encoded calldata
          const txReq = {
            to: this.config.ccipSenderAddress,
            data: calldata,
            value: fees,
            gasLimit: 500000
          };

          const sent = await this.signer.sendTransaction(txReq);
          console.log(`📡 CCIP decision tx sent (raw). TX: ${sent.hash}`);
          await sent.wait();
          console.log(`✅ CCIP decision confirmed for request ${requestId}`);
          called = true;
          return true;
        }
      } catch (sigErr) {
        // ignore and fall back to older call shape below
      }

      // Fallback: attempt legacy/raw variant if ABI differs (original code path)
      const tx = await this.contracts.ccipSender.sendArbitrationDecision(
        sourceChain,
        contractAddress,
        requestId,
        decisionData,
        { gasLimit: 500000 }
      );

      console.log(`📡 CCIP decision sent (fallback). TX: ${tx.hash}`);
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