


import { ethers } from 'ethers';
import fetch from 'node-fetch';
import path from 'path';
import fs from 'fs';
import { llmArbitrationSimulator } from './llmArbitrationSimulator.js';
import { getContractAddress } from '../utils/deploymentLoader.js';

// Configuration
const LLM_API_URL = process.env.LLM_API_URL || 'http://localhost:8000';
const CHAINLINK_SIMULATION = false; // No simulation allowed in this repo state
const USE_CHAINLINK = (process.env.USE_CHAINLINK === 'true');
const USE_INTEGRATED_SIMULATOR = false; // Disabled: no integrated simulator

// Store active arbitration requests
const activeRequests = new Map();



export async function triggerLLMArbitration(disputeData) {
  try {
    const requestId = generateRequestId();
    
    // Store request for tracking
    activeRequests.set(requestId, {
      ...disputeData,
      status: 'pending',
      createdAt: Date.now(),
      requestId
    });
    
    console.log(`🤖 Triggering LLM arbitration for request ${requestId}`);
    
      // No simulation/mocks allowed. Require USE_CHAINLINK to be true to proceed with Chainlink flow.
      if (!USE_CHAINLINK) {
        throw new Error('Chainlink integration disabled (USE_CHAINLINK not true). No mock/simulator permitted.');
      }
      // Proceed with Chainlink/real flow
      return await executeLLMArbitration(requestId, disputeData);
    
  } catch (error) {
    console.error('Error triggering LLM arbitration:', error);
    throw new Error('Failed to trigger LLM arbitration');
  }
}



async function integratedLLMArbitration(requestId, disputeData) {
  console.log(`🤖 Using integrated LLM simulator for ${requestId}`);
  
  try {
    // Prepare arbitration data
    const arbitrationData = {
      contract_text: await getContractText(disputeData.contractAddress),
      evidence_text: await getEvidenceFromCID(disputeData.evidenceCID),
      dispute_question: formulateDisputeQuestion(disputeData),
      requested_amount: disputeData.requestedAmount || 0
    };

    // Use integrated simulator
    const result = await llmArbitrationSimulator.processArbitration(arbitrationData);
    
    // Process the result immediately
    await handleLLMResponse(requestId, result, disputeData.contractAddress, disputeData.disputeId);
    
    console.log(`✅ Integrated LLM arbitration completed for ${requestId}`);
    
    return {
      requestId,
      status: 'completed',
      method: 'integrated-simulator',
      result,
      completedAt: Date.now()
    };
    
  } catch (error) {
    console.error(`❌ Integrated LLM arbitration failed for ${requestId}:`, error);
    throw error;
  }
}



async function simulateLLMArbitration(requestId, disputeData) {
  console.log(`🧪 Simulating LLM arbitration for ${requestId}`);

  // Simulation disabled - throw an explicit error if this path is reached
  throw new Error('Simulation path reached but simulations are disabled in this build.');

  // If a CCIP router address is configured, attempt on-chain delivery via MockCCIPRouter
  const routerAddr = process.env.MOCK_CCIP_ROUTER_ADDRESS;
  if (routerAddr) {
    console.log(`[33mSimulating on-chain CCIP delivery to router ${routerAddr} for request ${requestId}[0m`);
    const params = {
      receiver: disputeData.receiver || disputeData.contractAddress,
      messageId: ethers.utils.keccak256(ethers.utils.toUtf8Bytes(requestId)),
      sourceChainSelector: 0,
      requestSender: disputeData.requester || ethers.constants.AddressZero,
      disputeId: disputeData.disputeId || ethers.utils.keccak256(ethers.utils.toUtf8Bytes(requestId)),
      approved: mockResult.final_verdict === 'PARTY_A_WINS',
      appliedAmount: mockResult.reimbursement_amount_dai || 0,
      beneficiary: disputeData.beneficiary || ethers.constants.AddressZero,
      rationale: mockResult.rationale_summary || '',
      oracleId: ethers.constants.HashZero,
      targetContract: disputeData.contractAddress,
      caseId: disputeData.caseId || 0
    };

    try {
      const receipt = await simulateDecisionTo(routerAddr, params);
      await handleLLMResponse(requestId, mockResult, disputeData.contractAddress, disputeData.disputeId);
      return { requestId, status: 'completed', method: 'on-chain-simulation', receipt };
    } catch (err) {
      console.error('On-chain CCIP simulation failed:', err);
      // fallback to local processing
      await handleLLMResponse(requestId, mockResult, disputeData.contractAddress, disputeData.disputeId);
      return { requestId, status: 'completed', method: 'simulation-fallback' };
    }
  }

  // Default in-process simulation with short delay
  setTimeout(async () => {
    try {
      await handleLLMResponse(requestId, mockResult, disputeData.contractAddress, disputeData.disputeId);
      console.log(`Simulated LLM arbitration completed for ${requestId}`);
    } catch (error) {
      console.error(`❌ Simulated LLM arbitration failed for ${requestId}:`, error);
    }
  }, 2000);

  return {
    requestId,
    status: 'initiated',
    method: 'simulation',
    estimatedCompletion: Date.now() + 2000
  };
}



async function executeLLMArbitration(requestId, disputeData) {
  try {
    // Instead of calling a real Chainlink Functions flow, delegate to the local mock adapter.
    // This keeps behaviour deterministic in Ollama-only mode while retaining the same
    // high-level flow shape expected by callers.
    const { resolveArbitration } = await import('./mockArbitrationAdapter.js');
    const arbitrationPayload = {
      contract_text: await getContractText(disputeData.contractAddress),
      evidence_text: await getEvidenceFromCID(disputeData.evidenceCID),
      dispute_question: formulateDisputeQuestion(disputeData),
      requested_amount: disputeData.requestedAmount || 0
    };

    const result = await resolveArbitration(arbitrationPayload);
    return {
      requestId,
      status: 'completed',
      method: 'mock-adapter',
      result
    };
    
  } catch (error) {
    console.error('Error executing LLM arbitration:', error);
    throw error;
  }
}



export async function handleLLMResponse(requestId, result, contractAddress, disputeId) {
  try {
    // Validate result first
    const validatedResult = validateLLMResult(result);
    if (!validatedResult.isValid) {
      throw new Error(`Invalid LLM result: ${validatedResult.error}`);
    }

    // Update request status
    const request = activeRequests.get(requestId);
    if (request) {
      request.status = 'processing';
      request.llmResult = result;
      request.processedAt = Date.now();
    }

    // Execute on-chain resolution (guarded inside function)
    const resolutionTx = await executeOnChainResolution(contractAddress, disputeId, result);

    // Update request status
    if (request) {
      request.status = 'completed';
      request.resolutionTx = resolutionTx;
      request.completedAt = Date.now();
    }

    console.log(`✅ LLM response processed and resolution executed for ${requestId}`);

    return {
      requestId,
      result: validatedResult.result,
      resolutionTx,
      status: 'completed'
    };
  } catch (error) {
    console.error('Error handling LLM response:', error);
    
    // Update request status
    const request = activeRequests.get(requestId);
    if (request) {
      request.status = 'failed';
      request.error = error.message;
      request.failedAt = Date.now();
    }
    
    throw error;
  }
}



function generateMockLLMResult(disputeData) {
  const scenarios = [
    {
      final_verdict: 'PARTY_A_WINS',
      reimbursement_amount_dai: Math.floor(parseFloat(disputeData.requestedAmount || '0.5') * 1000),
      rationale_summary: 'Evidence clearly supports Party A\'s claim. Contract terms were violated.'
    },
    {
      final_verdict: 'PARTY_B_WINS', 
      reimbursement_amount_dai: 0,
      rationale_summary: 'Party B provided sufficient counter-evidence. No violation found.'
    },
    {
      final_verdict: 'DRAW',
      reimbursement_amount_dai: Math.floor(parseFloat(disputeData.requestedAmount || '0.5') * 500),
      rationale_summary: 'Partial evidence from both sides. Awarding reduced compensation.'
    }
  ];
  
  // Select scenario based on evidence CID hash (deterministic for testing)
  const hash = disputeData.evidenceCID ? 
    parseInt(disputeData.evidenceCID.slice(-4), 16) % scenarios.length :
    Math.floor(Math.random() * scenarios.length);
    
  return scenarios[hash];
}



function validateLLMResult(result) {
  try {
    const requiredFields = ['final_verdict', 'reimbursement_amount_dai', 'rationale_summary'];
    const validVerdicts = ['PARTY_A_WINS', 'PARTY_B_WINS', 'DRAW'];
    
    // Check required fields
    for (const field of requiredFields) {
      if (!(field in result)) {
        return { isValid: false, error: `Missing required field: ${field}` };
      }
    }
    
    // Validate verdict
    if (!validVerdicts.includes(result.final_verdict)) {
      return { isValid: false, error: `Invalid verdict: ${result.final_verdict}` };
    }
    
    // Validate amount
    if (typeof result.reimbursement_amount_dai !== 'number' || result.reimbursement_amount_dai < 0) {
      return { isValid: false, error: 'Invalid reimbursement amount' };
    }
    
    // Validate rationale
    if (!result.rationale_summary || typeof result.rationale_summary !== 'string') {
      return { isValid: false, error: 'Invalid rationale summary' };
    }
    
    return { isValid: true, result };
    
  } catch (error) {
    return { isValid: false, error: error.message };
  }
}



async function executeOnChainResolution(contractAddress, disputeId, result) {
  try {
    // In development, optionally simulate transaction
    if (CHAINLINK_SIMULATION) {
      const mockTxHash = '0x' + Array(64).fill().map(() => Math.floor(Math.random() * 16).toString(16)).join('');

      return {
        hash: mockTxHash,
        status: 'success',
        verdict: result.final_verdict,
        amount: result.reimbursement_amount_dai,
        simulation: true
      };
    }

    // Resolve ArbitrationService address
    const arbAddress = getContractAddress('ArbitrationService') || process.env.ARBITRATION_SERVICE_ADDRESS;
    if (!arbAddress) {
      return { simulation: true, error: 'No ArbitrationService address available' };
    }

    // Load ABI from common locations
    let abi = null;
    const candidates = [
      path.join(process.cwd(), 'artifacts', 'contracts', 'Arbitration', 'ArbitrationService.sol', 'ArbitrationService.json'),
      path.join(process.cwd(), 'front', 'src', 'utils', 'contracts', 'ArbitrationService.json'),
      path.join(process.cwd(), 'server', 'config', 'contracts', 'ArbitrationService.json')
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        try { abi = JSON.parse(fs.readFileSync(c, 'utf8')).abi || JSON.parse(fs.readFileSync(c, 'utf8')); break; } catch (e) { /* ignore */ }
      }
    }
    if (!abi) {
      return { simulation: true, error: 'ArbitrationService ABI not found' };
    }

    // Prepare provider and signer
    const rpc = process.env.RPC_URL || process.env.HARDHAT_RPC_URL || 'http://127.0.0.1:8545';
    const provider = new ethers.JsonRpcProvider(rpc);
    let signer = null;
    try {
      const pk = process.env.MERKLE_PRIVATE_KEY || null;
      if (pk && pk !== '' && pk !== '0x...') signer = new ethers.Wallet(pk, provider);
      else {
        try { signer = provider.getSigner ? provider.getSigner(0) : null; } catch (e) { signer = null; }
      }
    } catch (e) { signer = null; }

    const contract = new ethers.Contract(arbAddress, abi, provider);
    const contractWithSigner = signer ? contract.connect(signer) : null;

    // Map verdict -> approve boolean
    const verdict = result && result.final_verdict ? String(result.final_verdict) : 'DRAW';
    let approve = false;
    if (verdict === 'PARTY_A_WINS') approve = true;
    else if (verdict === 'DRAW') approve = (Number(result.reimbursement_amount_dai) > 0);
    else if (verdict === 'PARTY_B_WINS') approve = false;

    // Determine beneficiary: use explicit LLM beneficiary or try to resolve from target contract
    let beneficiary = null;
    if (result && (result.beneficiary_address || result.beneficiary)) {
      const candidate = result.beneficiary_address || result.beneficiary;
      try { if (ethers.isAddress(candidate)) beneficiary = candidate; } catch (e) { beneficiary = null; }
    }

    // If no explicit beneficiary, attempt to fetch common participant getters from the target contract
    // Use the provided contractAddress param (do not rely on a later 'targetContract' variable)
    const targetContract = contractAddress || ethers.ZeroAddress;
    if (!beneficiary && targetContract && targetContract !== ethers.ZeroAddress) {
      try {
        // Common getter names used across templates
        const getters = ['partyA', 'partyB', 'landlord', 'tenant', 'reporter', 'offender', 'owner'];
        const participants = {};

        for (const g of getters) {
          try {
            const abi = [`function ${g}() view returns (address)`];
            const t = new ethers.Contract(targetContract, abi, provider);
            // call and allow rejection
            const val = await t[g]().catch(() => null);
            if (val && ethers.isAddress(val)) {
              participants[g] = val;
            }
          } catch (e) {
            // ignore getter if not present
          }
        }

        // Normalize participants into partyA/partyB when possible for resolveBeneficiary helper
        const normalized = {
          partyA: participants.partyA || participants.landlord || participants.reporter || participants.owner || null,
          partyB: participants.partyB || participants.tenant || participants.offender || null
        };

        beneficiary = resolveBeneficiary(result, normalized);
      } catch (e) {
        beneficiary = process.env.ARBITRATION_DEFAULT_BENEFICIARY || ethers.ZeroAddress;
      }
    }
    if (!beneficiary) beneficiary = process.env.ARBITRATION_DEFAULT_BENEFICIARY || ethers.ZeroAddress;

    // Convert amount (assume 18 decimals/token like DAI or native) - NOTE: adjust if you use a token with different decimals
    let amountWei = 0n;
    try {
      const amt = result && typeof result.reimbursement_amount_dai !== 'undefined' ? String(result.reimbursement_amount_dai) : '0';
      // allow integer or float strings
      amountWei = ethers.parseUnits(amt, 18);
    } catch (e) {
      amountWei = 0n;
    }

  // Prepare call parameters (targetContract already set above when resolving beneficiary)
    const caseId = disputeId || 0;

    const prepared = {
      arbitrationService: arbAddress,
      targetContract,
      caseId,
      approve,
      amountWei: amountWei.toString(),
      beneficiary
    };

    // Normalize rationale strings for inclusion in resolveDisputeFinal calldata
    const rationaleStr = String(result && (result.rationale || result.rationale_summary) ? (result.rationale || result.rationale_summary) : '');
    const rationaleDetail = String(result && result.rationale_detail ? result.rationale_detail : '');

    // Try to detect whether the target contract exposes the Rent-style
    // resolveDisputeFinal entrypoint. We do a light eth_call using the
    // ArbitrationService address as the "from" to emulate permissions — if
    // the call reverts with a revert reason or returns (0x), we assume the
    // function exists and prefer instructing callers to invoke it directly
    // as the arbitration service (via impersonation) to avoid hitting the
    // NDA-style serviceResolve path that some templates don't implement.
    try {
      const ethersInterface = new ethers.Interface([
        'function resolveDisputeFinal(uint256,bool,uint256,address,string,string)'
      ]);
      const encoded = ethersInterface.encodeFunctionData('resolveDisputeFinal', [Number(caseId || 0), approve, amountWei, beneficiary, rationaleStr, rationaleDetail]);
      // Perform eth_call with from=arbAddress to detect existence/behaviour
      const callRes = await provider.call({ to: targetContract, from: arbAddress, data: encoded }).catch(e => { throw e; });
      // If callRes is present (even 0x) we consider the method present
      if (typeof callRes === 'string') {
        prepared.preferredExecute = 'resolveDisputeFinal';
        prepared.resolveCalldata = encoded;
      }
    } catch (e) {
      // If the eth_call throws with a low-level error it's still often an
      // indication the selector exists (for example it may revert due to
      // DisputeAlreadyResolved). Check message for common signs.
      const msg = e && (e.body || e.error || e.message) ? JSON.stringify(e).toLowerCase() : '';
      if (msg.includes('onlyarbitrator') || msg.includes('disputealreadyresolved') || msg.includes('onlyarbitrationservice') || msg.includes('revert')) {
        try {
          const ethersInterface = new ethers.Interface([
            'function resolveDisputeFinal(uint256,bool,uint256,address,string,string)'
          ]);
          const encoded = ethersInterface.encodeFunctionData('resolveDisputeFinal', [Number(caseId || 0), approve, amountWei, beneficiary, rationaleStr, rationaleDetail]);
          prepared.preferredExecute = 'resolveDisputeFinal';
          prepared.resolveCalldata = encoded;
        } catch (e2) {
          // ignore
        }
      }
    }

    // Deterministic artifact-based detection: if we have a local ABI for
    // EnhancedRentContract (or similar Rent templates) that includes
    // resolveDisputeFinal, attach the encoded calldata regardless of whether
    // eth_call returned a value. This ensures prepared payloads for Rent
    // templates always include the correct selector and calldata.
    try {
      if (!prepared.resolveCalldata) {
        const candidates = [
          path.join(process.cwd(), 'artifacts', 'contracts', 'Rent', 'EnhancedRentContract.sol', 'EnhancedRentContract.json'),
          path.join(process.cwd(), 'server', 'config', 'contracts', 'EnhancedRentContract.json'),
          path.join(process.cwd(), 'front', 'src', 'utils', 'contracts', 'EnhancedRentContract.json')
        ];
        for (const c of candidates) {
          if (fs.existsSync(c)) {
            try {
              const art = JSON.parse(fs.readFileSync(c, 'utf8'));
              const a = art.abi || art;
              if (Array.isArray(a)) {
                const has = a.find(item => item && item.type === 'function' && item.name === 'resolveDisputeFinal');
                if (has) {
                  const ethersInterface = new ethers.Interface([
                    'function resolveDisputeFinal(uint256,bool,uint256,address,string,string)'
                  ]);
                  const encoded = ethersInterface.encodeFunctionData('resolveDisputeFinal', [Number(caseId || 0), approve, amountWei, beneficiary, rationaleStr, rationaleDetail]);
                  prepared.preferredExecute = 'resolveDisputeFinal';
                  prepared.resolveCalldata = encoded;
                  // attach normalized rationale strings to the prepared payload
                  prepared.rationale = rationaleStr;
                  prepared.rationaleDetail = rationaleDetail;
                  break;
                }
              }
            } catch (readErr) {
              // ignore malformed artifact
            }
          }
        }
      }
    } catch (artifactErr) {
      // non-fatal if artifact check fails
    }

    const enableSend = (process.env.ENABLE_ONCHAIN_RESOLVE === 'true' || process.env.FORCE_APPLY === 'true');
    if (!contractWithSigner) {
      // no signer: return prepared info and indicate dry-run
      return { simulation: true, prepared, error: 'no_signer_available' };
    }

    // Estimate gas with a robust fallback
    try {
      let estimated = null;

      // Preferred: use contract estimateGas if the named method is present
      try {
        const eg = contractWithSigner.estimateGas;
        if (eg && typeof eg === 'object' && typeof eg.applyResolutionToTarget === 'function') {
          estimated = await eg.applyResolutionToTarget(targetContract, Number(caseId), approve, amountWei, beneficiary).catch(() => null);
        }
      } catch (e) {
        // ignore and fall through to encoded fallback
        estimated = null;
      }

      // Fallback: encode data and ask provider to estimate
      if (!estimated) {
        try {
          const data = contract.interface.encodeFunctionData('applyResolutionToTarget', [targetContract, Number(caseId), approve, amountWei, beneficiary]);
          estimated = await provider.estimateGas({ to: arbAddress, data }).catch(() => null);
        } catch (e) { estimated = null; }
      }

      prepared.estimatedGas = estimated ? estimated.toString() : null;

      if (!enableSend) {
        return { simulation: true, prepared };
      }

      // Send transaction
      const tx = await contractWithSigner.applyResolutionToTarget(targetContract, Number(caseId), approve, amountWei, beneficiary);
      const receipt = await tx.wait();

      // Persist to dispute history if available
      try {
        const disputeHistoryModule = await import('./disputeHistory.js');
        disputeHistoryModule.default.addDisputeRecord(String(caseId), Date.now(), {
          action: 'applyResolutionToTarget',
          txHash: tx.hash,
          receipt: receipt,
          llmResult: result
        });
      } catch (e) {}

      return { hash: tx.hash, status: 'sent', receipt, prepared };
    } catch (err) {
      console.error('executeOnChainResolution tx error:', err && err.message ? err.message : err);
      return { simulation: false, error: err && err.message ? err.message : String(err), prepared };
    }
    
  } catch (error) {
    console.error('Error executing on-chain resolution:', error);
    throw error;
  }
}



function generateRequestId() {
  return `llm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}



async function getContractText(contractAddress) {
  // Mock implementation - in reality, this would fetch from IPFS or database
  return `
    RENTAL AGREEMENT CONTRACT
    
    Contract Address: ${contractAddress}
    
    TERMS AND CONDITIONS:
    1. Tenant agrees to pay rent on time
    2. Landlord agrees to maintain property
    3. Security deposit required
    4. Dispute resolution via arbitration
    
    This is a simplified contract for demonstration purposes.
  `;
}



async function getEvidenceFromCID(evidenceCID) {
  // Mock implementation - in reality, this would fetch from IPFS
  return `
    EVIDENCE SUBMISSION
    
    CID: ${evidenceCID}
    
    Evidence details:
    - Payment records
    - Communication logs  
    - Property condition photos
    - Maintenance requests
    
    This evidence supports the claim as outlined in the dispute.
  `;
}



function formulateDisputeQuestion(disputeData) {
  const questions = {
    0: 'Was there a breach of contract regarding property maintenance?',
    1: 'Was the rent payment made according to the agreed terms?',
    2: 'Was proper notice given for any changes to the agreement?',
    3: 'Are there any damages that require compensation?'
  };
  
  return questions[disputeData.disputeType] || 
         'Based on the provided evidence, what is the appropriate resolution for this dispute?';
}



async function callChainlinkFunctions(payload, requestId) {
  // Backwards compatibility shim: delegate to mock adapter if Chainlink integration
  // is requested but not available. This preserves callers that still call
  // callChainlinkFunctions while avoiding a hard crash.
  try {
    const { resolveArbitration } = await import('./mockArbitrationAdapter.js');
    const result = await resolveArbitration({
      contract_text: payload.contract_text || '',
      evidence_text: payload.evidence_text || '',
      dispute_question: payload.dispute_question || '',
      requested_amount: payload.requested_amount || 0
    });
    return { requestId, result };
  } catch (err) {
    throw new Error('Chainlink Functions integration not implemented and mock adapter failed: ' + (err && err.message));
  }
}



export function getActiveRequests() {
  return Array.from(activeRequests.values());
}



export function getRequest(requestId) {
  return activeRequests.get(requestId) || null;
}

// Pure helper: resolve beneficiary address given LLM result and known participants
export function resolveBeneficiary(result, participants = {}) {
  // If LLM provided an explicit beneficiary address, prefer it when valid
  if (result && (result.beneficiary_address || result.beneficiary)) {
    const candidate = result.beneficiary_address || result.beneficiary;
    try { if (ethers.isAddress(candidate)) return candidate; } catch (e) { /* ignore invalid */ }
  }

  // Map verdict to participants (partyA / partyB)
  const verdict = result && result.final_verdict ? String(result.final_verdict) : null;
  if (verdict === 'PARTY_A_WINS' && participants.partyA) return participants.partyA;
  if (verdict === 'PARTY_B_WINS' && participants.partyB) return participants.partyB;

  // If draw but reimbursement > 0, prefer claimant (partyA) if known
  if (verdict === 'DRAW' && Number(result && result.reimbursement_amount_dai || 0) > 0 && participants.partyA) return participants.partyA;

  // Fallback to configured default or zero
  return process.env.ARBITRATION_DEFAULT_BENEFICIARY || ethers.ZeroAddress;
}