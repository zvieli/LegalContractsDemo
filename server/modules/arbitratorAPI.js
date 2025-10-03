/**
 * V7 Enhanced Arbitrator API Integration
 * Bridge between Node.js backend and Python FastAPI LLM service
 */

import fetch from 'node-fetch';
import { ethers } from 'ethers';

// Configuration
const ARBITRATOR_API_URL = process.env.ARBITRATOR_API_URL || 'http://localhost:8000';
const API_TIMEOUT = 30000; // 30 seconds

/**
 * Call the Python FastAPI arbitrator service
 * @param {Object} arbitrationData - Data for LLM arbitration
 * @returns {Promise<Object>} - LLM arbitration result
 */
export async function callArbitratorAPI(arbitrationData) {
  try {
    const { contractText, evidenceText, disputeQuestion } = arbitrationData;
    
    // Prepare payload for FastAPI
    const payload = {
      contract_text: contractText || 'Standard rental agreement contract',
      evidence_text: evidenceText || 'Evidence submitted for arbitration',
      dispute_question: disputeQuestion || 'What is the appropriate resolution for this dispute?'
    };
    
    console.log(`🤖 Calling LLM Arbitrator API: ${ARBITRATOR_API_URL}/arbitrate`);
    
    const response = await fetch(`${ARBITRATOR_API_URL}/arbitrate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload),
      timeout: API_TIMEOUT
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error (${response.status}): ${errorText}`);
    }
    
    const result = await response.json();
    
    // Validate response structure
    if (!result.final_verdict || result.reimbursement_amount_dai === undefined) {
      throw new Error('Invalid LLM API response structure');
    }
    
    console.log(`✅ LLM Arbitration completed: ${result.final_verdict}`);
    
    return {
      success: true,
      verdict: result.final_verdict,
      amount: result.reimbursement_amount_dai,
      rationale: result.rationale_summary,
      timestamp: Date.now()
    };
    
  } catch (error) {
    console.error('Error calling arbitrator API:', error);
    
    // Return fallback result for development
    return {
      success: false,
      error: error.message,
      fallbackResult: generateFallbackResult(arbitrationData),
      timestamp: Date.now()
    };
  }
}

/**
 * Generate fallback result when LLM API is unavailable
 * @param {Object} arbitrationData - Original arbitration data
 * @returns {Object} - Fallback result
 */
function generateFallbackResult(arbitrationData) {
  console.log('🔄 Generating fallback arbitration result');
  
  // Simple fallback logic based on evidence keywords
  const evidenceText = arbitrationData.evidenceText || '';
  const contractText = arbitrationData.contractText || '';
  
  let verdict = 'DRAW';
  let amount = 0;
  let rationale = 'Automatic fallback decision due to LLM service unavailability.';
  
  // Basic keyword analysis
  const favorableKeywords = ['payment made', 'maintenance completed', 'contract fulfilled', 'evidence provided'];
  const unfavorableKeywords = ['payment late', 'maintenance failed', 'contract breach', 'no evidence'];
  
  const favorableScore = favorableKeywords.reduce((score, keyword) => 
    score + (evidenceText.toLowerCase().includes(keyword.toLowerCase()) ? 1 : 0), 0);
  const unfavorableScore = unfavorableKeywords.reduce((score, keyword) => 
    score + (evidenceText.toLowerCase().includes(keyword.toLowerCase()) ? 1 : 0), 0);
  
  if (favorableScore > unfavorableScore) {
    verdict = 'PARTY_A_WINS';
    amount = Math.floor(Math.random() * 1000) + 500; // 500-1500 DAI
    rationale = 'Evidence supports Party A based on keyword analysis.';
  } else if (unfavorableScore > favorableScore) {
    verdict = 'PARTY_B_WINS';
    amount = 0;
    rationale = 'Evidence supports Party B based on keyword analysis.';
  } else {
    verdict = 'DRAW';
    amount = Math.floor(Math.random() * 500) + 250; // 250-750 DAI
    rationale = 'Inconclusive evidence, partial compensation awarded.';
  }
  
  return {
    final_verdict: verdict,
    reimbursement_amount_dai: amount,
    rationale_summary: rationale,
    fallback: true
  };
}

/**
 * Check if LLM Arbitrator API is available
 * @returns {Promise<boolean>} - API availability
 */
export async function checkArbitratorAPIHealth() {
  try {
    const response = await fetch(`${ARBITRATOR_API_URL}/health`, {
      method: 'GET',
      timeout: 5000
    });
    
    return response.ok;
  } catch (error) {
    console.log('LLM Arbitrator API not available:', error.message);
    return false;
  }
}

/**
 * Convert CID to evidence text for LLM processing
 * @param {string} evidenceCID - IPFS CID
 * @returns {Promise<string>} - Evidence text
 */
export async function extractEvidenceFromCID(evidenceCID) {
  try {
    // In production, this would fetch from IPFS/Helia
    // For development, we'll generate representative text
    
    if (!evidenceCID || typeof evidenceCID !== 'string') {
      return 'No evidence provided';
    }
    
    // Mock evidence extraction based on CID pattern
    const mockEvidenceTemplates = {
      'Qm': 'Payment receipt and transaction records from blockchain',
      'baf': 'Property maintenance documentation and photos',
      'default': 'General evidence documentation and supporting materials'
    };
    
    const template = Object.keys(mockEvidenceTemplates)
      .find(prefix => evidenceCID.startsWith(prefix)) || 'default';
    
    return `
Evidence CID: ${evidenceCID}

${mockEvidenceTemplates[template]}

Details:
- Submitted at: ${new Date().toISOString()}
- Content type: Verified IPFS content
- Integrity: Hash verified
- Accessibility: Content accessible via IPFS network

This evidence is submitted in support of the dispute claim and contains relevant documentation to support the party's position in the arbitration process.
    `.trim();
    
  } catch (error) {
    console.error('Error extracting evidence from CID:', error);
    return `Evidence CID: ${evidenceCID} (extraction failed: ${error.message})`;
  }
}

/**
 * Prepare contract text for LLM analysis
 * @param {string} contractAddress - Smart contract address
 * @param {Object} contractData - Additional contract data
 * @returns {Promise<string>} - Contract text for LLM
 */
export async function prepareContractText(contractAddress, contractData = {}) {
  try {
    // In production, this might fetch contract creation data, IPFS metadata, etc.
    
    const contractTemplate = `
SMART CONTRACT AGREEMENT

Contract Address: ${contractAddress}
Chain: Ethereum (or test network)
Created: ${contractData.createdAt || new Date().toISOString()}

RENTAL AGREEMENT TERMS:

1. PARTIES
   - Landlord: Party A (Contract creator)
   - Tenant: Party B (Contract participant)

2. PAYMENT TERMS
   - Rent Amount: ${contractData.rentAmount || 'As specified in contract'}
   - Due Date: ${contractData.dueDate ? new Date(contractData.dueDate).toLocaleDateString() : 'Monthly'}
   - Late Fee: ${contractData.lateFeePercent || '5'}% per month

3. PROPERTY CONDITIONS
   - Property maintenance is the responsibility of the landlord
   - Tenant must report issues within reasonable timeframe
   - Security deposit required for damage protection

4. DISPUTE RESOLUTION
   - Disputes resolved via automated arbitration system
   - Evidence must be submitted via IPFS for transparency
   - Arbitration decisions are binding and enforceable

5. CONTRACT ENFORCEMENT
   - Smart contract automatically enforces terms
   - Payments processed on-chain
   - Dispute resolution via LLM arbitration

This is a legally binding smart contract agreement.
    `.trim();
    
    return contractTemplate;
    
  } catch (error) {
    console.error('Error preparing contract text:', error);
    return `Contract Address: ${contractAddress} (contract text preparation failed)`;
  }
}

/**
 * Format dispute question for LLM analysis
 * @param {Object} disputeData - Dispute information
 * @returns {string} - Formatted question for LLM
 */
export function formatDisputeQuestion(disputeData) {
  const { disputeType, requestedAmount, description } = disputeData;
  
  const questionTemplates = {
    0: 'Is there evidence of property damage or maintenance issues that warrant compensation?',
    1: 'Was the rent payment made according to the agreed schedule and terms?',
    2: 'Were proper notices given for any changes to the rental agreement?',
    3: 'Are there any contractual violations that require financial remedy?'
  };
  
  const baseQuestion = questionTemplates[disputeType] || 
    'Based on the evidence and contract terms, what is the appropriate resolution?';
  
  let question = baseQuestion;
  
  if (requestedAmount) {
    question += ` The requested compensation amount is ${requestedAmount} ETH.`;
  }
  
  if (description) {
    question += ` Additional context: ${description}`;
  }
  
  question += ' Please provide a fair and impartial decision based on the contract terms and submitted evidence.';
  
  return question;
}

/**
 * Validate LLM result before processing
 * @param {Object} result - LLM result
 * @returns {Object} - Validation result
 */
export function validateLLMResult(result) {
  const validVerdicts = ['PARTY_A_WINS', 'PARTY_B_WINS', 'DRAW'];
  const errors = [];
  
  if (!result.final_verdict || !validVerdicts.includes(result.final_verdict)) {
    errors.push('Invalid or missing verdict');
  }
  
  if (result.reimbursement_amount_dai === undefined || 
      typeof result.reimbursement_amount_dai !== 'number' || 
      result.reimbursement_amount_dai < 0) {
    errors.push('Invalid reimbursement amount');
  }
  
  if (!result.rationale_summary || typeof result.rationale_summary !== 'string') {
    errors.push('Missing or invalid rationale');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    result: errors.length === 0 ? result : null
  };
}