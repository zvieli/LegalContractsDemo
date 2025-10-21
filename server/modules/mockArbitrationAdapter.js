import { processV7ArbitrationWithOllama, ollamaLLMArbitrator } from './ollamaLLMArbitrator.js';

/**
 * Adapter that exposes a normalized arbitration resolver for codepaths that used Chainlink.
 * It delegates to the Ollama arbitrator (local LLM) and ensures the returned shape
 * matches what callers expect (verdict, reimbursementAmount, reasoning, confidence).
 */
export async function resolveArbitration(request) {
  // request: { contract_text, evidence_text, dispute_question, requested_amount }
  try {
    // If an integrated mock/ollama instance is available, use it
    const payload = {
      contract_text: request.contract_text || '',
      evidence_text: request.evidence_text || '',
      dispute_question: request.dispute_question || 'Decide the dispute',
      requested_amount: typeof request.requested_amount !== 'undefined' ? request.requested_amount : 0
    };

    const result = await processV7ArbitrationWithOllama(payload);

    // Normalize result fields for downstream callers
    const normalized = {
      final_verdict: result.final_verdict || result.verdict || (result.decision ? String(result.decision).toUpperCase() : 'DRAW'),
      reimbursement_amount_dai: (typeof result.reimbursement_amount_dai !== 'undefined') ? result.reimbursement_amount_dai : (result.reimbursement || 0),
      rationale_summary: result.rationale_summary || result.reasoning || result.summary || '',
      confidence: result.confidence || result.confidence_score || 0.75,
      raw: result
    };

    return normalized;
  } catch (err) {
    console.warn('mockArbitrationAdapter.resolveArbitration failed, falling back to simulator:', err && err.message ? err.message : err);
    // Fallback simulated deterministic response
    return {
      final_verdict: 'DRAW',
      reimbursement_amount_dai: 0,
      rationale_summary: 'Fallback simulated arbitration result',
      confidence: 0.5,
      raw: null
    };
  }
}

export default { resolveArbitration };
