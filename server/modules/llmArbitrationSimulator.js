


export class LLMArbitrationSimulator {
  constructor(config = {}) {
    this.config = {
      simulationMode: config.simulationMode !== false,
      responseTime: config.responseTime || 2000, // 2 seconds
      ...config
    };
  }

  

  async processArbitration(arbitrationData) {
    console.log('🤖 Processing LLM arbitration (simulation mode)...');
    
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, this.config.responseTime));
    
    const {
      contract_text = '',
      evidence_text = '',
      dispute_question = '',
      requested_amount = 0
    } = arbitrationData;

    try {
      // Simple rule-based simulation
      const analysis = this.analyzeDispute(contract_text, evidence_text, dispute_question);
      
      const result = {
        final_verdict: analysis.verdict,
        reimbursement_amount_dai: analysis.amount,
        rationale_summary: analysis.rationale,
        simulation: true,
        processed_at: new Date().toISOString()
      };

      console.log('✅ LLM arbitration completed:', result.final_verdict);
      return result;

    } catch (error) {
      console.error('❌ LLM arbitration failed:', error);
      throw new Error(`LLM arbitration simulation failed: ${error.message}`);
    }
  }

  

  analyzeDispute(contract, evidence, question) {
    const contractLower = contract.toLowerCase();
    const evidenceLower = evidence.toLowerCase();
    const questionLower = question.toLowerCase();

    console.log('🔍 Analyzing dispute:');
    console.log('  Contract:', contractLower);
    console.log('  Evidence:', evidenceLower);
    console.log('  Question:', questionLower);

    // Rule 1: Late fee disputes with bank errors
    if (questionLower.includes('late fee') && evidenceLower.includes('bank error')) {
      console.log('  → Rule 1: Bank error late fee');
      return {
        verdict: 'PARTY_A_WINS', // Tenant wins
        amount: 0,
        rationale: 'Bank error documented in evidence. Tenant not liable for late fee due to processing failure on landlord\'s bank side.'
      };
    }

    // Rule 2: Contract violations (pets, noise, damage)
    if (contractLower.includes('breach') || evidenceLower.includes('violation') || 
        evidenceLower.includes('no pets') || evidenceLower.includes('pets allowed') ||
        evidenceLower.includes('damage to carpets') || evidenceLower.includes('property damage')) {
      console.log('  → Rule 2: Contract violation detected');
      return {
        verdict: 'PARTY_B_WINS', // Landlord wins
        amount: this.extractAmountFromText(contract + evidence + question) || 500,
        rationale: 'Clear contract violation documented. Tenant violated terms regarding pets/property care. Landlord entitled to damages and compensation.'
      };
    }

    // Rule 3: Water damage disputes
    if (evidenceLower.includes('water damage') || evidenceLower.includes('leak')) {
      console.log('  → Rule 3: Water damage');
      return {
        verdict: 'PARTY_A_WINS', // Tenant wins
        amount: 200,
        rationale: 'Water damage identified as landlord responsibility. Tenant entitled to compensation for damages.'
      };
    }

    // Rule 4: NDA violations
    if (contractLower.includes('nda') || contractLower.includes('confidential')) {
      if (evidenceLower.includes('breach') || evidenceLower.includes('violation')) {
        console.log('  → Rule 4: NDA violation');
        return {
          verdict: 'PARTY_B_WINS', // NDA enforcer wins
          amount: 500,
          rationale: 'Evidence indicates breach of confidentiality terms. Penalty applies as per contract.'
        };
      }
    }

    // Rule 5: Payment disputes - more specific logic
    if (questionLower.includes('payment') || questionLower.includes('rent') || contractLower.includes('rent')) {
      console.log('  → Rule 5: Payment/Rent dispute detected');
      
      // Check for clear evidence of payment made
      if ((evidenceLower.includes('receipt') && !evidenceLower.includes('no receipt') && !evidenceLower.includes('no payment receipts')) || 
          evidenceLower.includes('transfer completed') || 
          evidenceLower.includes('confirmation number') || 
          evidenceLower.includes('payment processed')) {
        console.log('    → Payment evidence found - tenant wins');
        return {
          verdict: 'PARTY_A_WINS', // Payer wins
          amount: 0,
          rationale: 'Payment evidence provided. No additional payment required.'
        };
      }
      
      // Check for clear evidence of NO payment
      if (evidenceLower.includes('no payment receipts') || evidenceLower.includes('no outgoing transfers') ||
          evidenceLower.includes('no payment received') || 
          (questionLower.includes('no evidence') && questionLower.includes('claims'))) {
        console.log('    → No payment evidence - landlord wins');
        return {
          verdict: 'PARTY_B_WINS', // Payee wins
          amount: this.extractAmountFromText(contract + evidence + question) || 100,
          rationale: 'No payment evidence found. Amount due as per contract terms.'
        };
      }
      
      // Default case for unclear payment disputes
      console.log('    → Unclear payment case - landlord wins by default');
      return {
        verdict: 'PARTY_B_WINS', // Default to payee
        amount: this.extractAmountFromText(contract + evidence + question) || 100,
        rationale: 'Insufficient payment documentation. Amount due as per contract terms.'
      };
    }

    // Default case
    console.log('  → Default case: Draw');
    return {
      verdict: 'DRAW',
      amount: 50,
      rationale: 'Insufficient evidence for clear determination. Minimal compensation awarded.'
    };
  }

  

  extractAmountFromText(text) {
    // Look for dollar amounts
    const dollarMatch = text.match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/);
    if (dollarMatch) {
      return parseInt(dollarMatch[1].replace(/,/g, ''));
    }

    // Look for plain numbers followed by currency keywords
    const numberMatch = text.match(/(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:USD|DAI|dollars?)/i);
    if (numberMatch) {
      return parseInt(numberMatch[1].replace(/,/g, ''));
    }

    return null;
  }

  

  async checkHealth() {
    // Simulation is always healthy
    return true;
  }

  

  getStats() {
    return {
      mode: 'simulation',
      responseTime: this.config.responseTime,
      health: 'healthy',
      version: '1.0.0'
    };
  }
}

// Export default instance
export const llmArbitrationSimulator = new LLMArbitrationSimulator();



export async function processV7Arbitration(requestData) {
  const simulator = new LLMArbitrationSimulator();
  
  // Map V7 request format to arbitration format
  const arbitrationData = {
    contract_text: requestData.contractText || requestData.contract_text || '',
    evidence_text: requestData.evidenceText || requestData.evidence_text || '',
    dispute_question: requestData.disputeQuestion || requestData.dispute_question || 'What is the appropriate resolution?',
    requested_amount: requestData.requestedAmount || requestData.requested_amount || 0
  };

  return await simulator.processArbitration(arbitrationData);
}