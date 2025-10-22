import { processV7ArbitrationWithOllama, ollamaLLMArbitrator } from './ollamaLLMArbitrator.js';

/**
 * Adapter that exposes a normalized arbitration resolver for codepaths that used Chainlink.
 * It delegates to the Ollama arbitrator (local LLM) and ensures the returned shape
 * matches what callers expect (verdict, reimbursementAmount, reasoning, confidence).
 */
export async function resolveArbitration(request) {
  // request: { contract_text, evidence_text, dispute_question, requested_amount }
  // Delegate to the configured Ollama arbitrator. Do not provide a simulated fallback.
  const payload = {
    contract_text: request.contract_text || '',
    evidence_text: request.evidence_text || '',
    dispute_question: request.dispute_question || 'Decide the dispute',
    requested_amount: typeof request.requested_amount !== 'undefined' ? request.requested_amount : 0
  };

  // processV7ArbitrationWithOllama must be available and succeed; otherwise propagate error
  if (typeof processV7ArbitrationWithOllama !== 'function') {
    throw new Error('Ollama arbitrator not configured: processV7ArbitrationWithOllama is not available');
  }

  const result = await processV7ArbitrationWithOllama(payload);
  const normalized = {
    final_verdict: result.final_verdict || result.verdict || (result.decision ? String(result.decision).toUpperCase() : 'DRAW'),
    reimbursement_amount_dai: (typeof result.reimbursement_amount_dai !== 'undefined') ? result.reimbursement_amount_dai : (result.reimbursement || 0),
    rationale_summary: result.rationale_summary || result.reasoning || result.summary || '',
    confidence: result.confidence || result.confidence_score || 0.75,
    raw: result
  };

  return normalized;
}

export default { resolveArbitration };
