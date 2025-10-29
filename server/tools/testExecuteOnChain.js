import { handleLLMResponse } from '../modules/llmArbitration.js';

async function run() {
  try {
    const res = await handleLLMResponse('testReq1', {
      final_verdict: 'PARTY_A_WINS',
      reimbursement_amount_dai: 0.001,
      rationale_summary: 'Test'
    }, '0x0000000000000000000000000000000000000000', 42);
    console.log('handleLLMResponse result:', res);
  } catch (e) {
    console.error('Error running test:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

run();
