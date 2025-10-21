


import { ethers } from 'ethers';
import fetch from 'node-fetch';
import { llmArbitrationSimulator } from './llmArbitrationSimulator.js';

// Configuration
const LLM_API_URL = process.env.LLM_API_URL || 'http://localhost:8000';
const CHAINLINK_SIMULATION = process.env.NODE_ENV !== 'production';
const USE_CHAINLINK = (process.env.USE_CHAINLINK === 'true');
const USE_INTEGRATED_SIMULATOR = process.env.USE_INTEGRATED_SIMULATOR !== 'false'; // Default to true

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
    
      if (USE_INTEGRATED_SIMULATOR) {
        // Use integrated simulator instead of external API
        return await integratedLLMArbitration(requestId, disputeData);
      }

      // If Chainlink usage is not explicitly enabled, default to simulation path
      if (!USE_CHAINLINK) {
        // In dev prefer the deterministic simulate flow
        return await simulateLLMArbitration(requestId, disputeData);
      }

      // At this point USE_CHAINLINK === true -> attempt real Chainlink flow
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

  // Produce the mock LLM result synchronously for deterministic behavior
  const mockResult = generateMockLLMResult(disputeData);

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
      console.log(`[32mSimulated LLM arbitration completed for ${requestId}[0m`);
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
    console.log(`🔄 Processing LLM response for request ${requestId}`);
    
    // Validate LLM result
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
    
    // Execute on-chain resolution
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
    // In development, simulate transaction
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
    
    // Real implementation would call the smart contract
    

    
    return { simulation: true };
    
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