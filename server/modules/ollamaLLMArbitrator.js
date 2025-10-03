/**
 * V7 Ollama LLM Integration Module
 * Integrates Ollama LLM with fallback to simulation mode
 */

import fetch from 'node-fetch';

export class OllamaLLMArbitrator {
  constructor(config = {}) {
    this.config = {
      ollamaUrl: config.ollamaUrl || 'http://localhost:11434',
      model: config.model || 'llama3.2',
      temperature: config.temperature || 0.1,
      enableFallback: config.enableFallback !== false,
      timeout: config.timeout || 30000,
      ...config
    };
  }

  /**
   * Process arbitration using Ollama LLM
   * @param {Object} arbitrationData - Arbitration request data
   * @returns {Promise<Object>} - Arbitration result
   */
  async processArbitration(arbitrationData) {
    console.log('🤖 Processing LLM arbitration with Ollama...');
    
    try {
      // Check Ollama availability first
      const isAvailable = await this.checkOllamaHealth();
      if (!isAvailable) {
        throw new Error('Ollama service not available');
      }

      // Prepare prompt for LLM
      const prompt = this.buildArbitrationPrompt(arbitrationData);
      
      // Call Ollama API
      const response = await this.callOllama(prompt);
      
      // Parse and validate response
      const result = this.parseOllamaResponse(response);
      
      console.log('✅ Ollama LLM arbitration completed:', result.final_verdict);
      return result;

    } catch (error) {
      console.error('❌ Ollama LLM arbitration failed:', error.message);
      
      if (this.config.enableFallback) {
        console.log('🔄 Falling back to simulation mode...');
        const { llmArbitrationSimulator } = await import('./llmArbitrationSimulator.js');
        return await llmArbitrationSimulator.processArbitration(arbitrationData);
      }
      
      throw error;
    }
  }

  /**
   * Build arbitration prompt for LLM
   */
  buildArbitrationPrompt(data) {
    const {
      contract_text = '',
      evidence_text = '',
      dispute_question = '',
      requested_amount = 0
    } = data;

    return `You are a professional arbitrator for legal disputes. Analyze the following case and provide a structured decision.

CONTRACT TEXT:
${contract_text}

EVIDENCE:
${evidence_text}

DISPUTE QUESTION:
${dispute_question}

REQUESTED AMOUNT: ${requested_amount} DAI

INSTRUCTIONS:
- Analyze the contract terms, evidence, and dispute question
- Determine who should win: PARTY_A (typically tenant/payer) or PARTY_B (typically landlord/payee)
- Calculate fair reimbursement amount in DAI (0 if no payment due)
- Provide clear rationale for your decision

RESPONSE FORMAT (JSON ONLY):
{
  "final_verdict": "PARTY_A_WINS|PARTY_B_WINS|DRAW",
  "reimbursement_amount_dai": number,
  "rationale_summary": "Clear explanation of decision"
}

Respond with JSON only, no additional text:`;
  }

  /**
   * Call Ollama API
   */
  async callOllama(prompt) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.config.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: this.config.temperature,
            num_predict: 500
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.response;

    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Ollama request timeout');
      }
      throw error;
    }
  }

  /**
   * Parse Ollama response to structured format
   */
  parseOllamaResponse(responseText) {
    try {
      // Clean up response - remove markdown, extra text, etc.
      let cleanResponse = responseText.trim();
      
      // Extract JSON from response if wrapped in markdown or text
      const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanResponse = jsonMatch[0];
      }

      const parsed = JSON.parse(cleanResponse);
      
      // Validate required fields
      if (!parsed.final_verdict || parsed.reimbursement_amount_dai === undefined) {
        throw new Error('Invalid response structure');
      }

      // Normalize verdict format
      const validVerdicts = ['PARTY_A_WINS', 'PARTY_B_WINS', 'DRAW'];
      if (!validVerdicts.includes(parsed.final_verdict)) {
        // Try to map common variations
        const verdict = parsed.final_verdict.toUpperCase();
        if (verdict.includes('PARTY_A') || verdict.includes('TENANT')) {
          parsed.final_verdict = 'PARTY_A_WINS';
        } else if (verdict.includes('PARTY_B') || verdict.includes('LANDLORD')) {
          parsed.final_verdict = 'PARTY_B_WINS';
        } else {
          parsed.final_verdict = 'DRAW';
        }
      }

      // Ensure amount is a number
      parsed.reimbursement_amount_dai = Number(parsed.reimbursement_amount_dai) || 0;

      // Add metadata
      return {
        ...parsed,
        llm_used: true,
        model: this.config.model,
        processed_at: new Date().toISOString()
      };

    } catch (error) {
      console.warn('Failed to parse Ollama response:', error.message);
      console.warn('Raw response:', responseText);
      throw new Error('Failed to parse LLM response');
    }
  }

  /**
   * Check if Ollama service is available
   */
  async checkOllamaHealth() {
    try {
      const response = await fetch(`${this.config.ollamaUrl}/api/tags`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok) {
        const data = await response.json();
        // Check if our model is available
        const hasModel = data.models?.some(m => m.name.includes(this.config.model));
        if (!hasModel) {
          console.warn(`Model ${this.config.model} not found. Available models:`, 
            data.models?.map(m => m.name) || 'none');
        }
        return true;
      }
      return false;
    } catch (error) {
      console.warn('Ollama health check failed:', error.message);
      return false;
    }
  }

  /**
   * Get service statistics
   */
  async getStats() {
    const isHealthy = await this.checkOllamaHealth();
    return {
      mode: 'ollama-llm',
      healthy: isHealthy,
      model: this.config.model,
      ollamaUrl: this.config.ollamaUrl,
      fallbackEnabled: this.config.enableFallback,
      version: '1.0.0'
    };
  }
}

// Export default instance
export const ollamaLLMArbitrator = new OllamaLLMArbitrator();

/**
 * V7 API-compatible arbitration function with Ollama
 */
export async function processV7ArbitrationWithOllama(requestData) {
  const arbitrator = new OllamaLLMArbitrator();
  
  // Map V7 request format to arbitration format
  const arbitrationData = {
    contract_text: requestData.contractText || requestData.contract_text || '',
    evidence_text: requestData.evidenceText || requestData.evidence_text || '',
    dispute_question: requestData.disputeQuestion || requestData.dispute_question || 'What is the appropriate resolution?',
    requested_amount: requestData.requestedAmount || requestData.requested_amount || 0
  };

  return await arbitrator.processArbitration(arbitrationData);
}