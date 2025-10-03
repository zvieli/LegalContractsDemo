/**
 * Direct test of the LLM arbitration simulator
 */

import { LLMArbitrationSimulator } from './server/modules/llmArbitrationSimulator.js';

async function testSimulatorDirect() {
  console.log('🧪 Testing LLM Arbitration Simulator Directly...\n');

  const simulator = new LLMArbitrationSimulator();

  // Test case that was failing
  const testData = {
    contract_text: "Monthly rent $1200 due by 1st. No payment received for 2 months.",
    evidence_text: "No payment receipts provided by tenant. Bank statements show no outgoing transfers to landlord account during disputed months.",
    dispute_question: "Tenant claims payments were made but provides no evidence. Is payment due?",
    requested_amount: 2400
  };

  try {
    console.log('📝 Input data:');
    console.log('Contract:', testData.contract_text);
    console.log('Evidence:', testData.evidence_text);
    console.log('Question:', testData.dispute_question);
    console.log('Amount:', testData.requested_amount);
    console.log('\n🤖 Processing...\n');

    const result = await simulator.processArbitration(testData);

    console.log('✅ Result:');
    console.log('Verdict:', result.final_verdict);
    console.log('Amount:', result.reimbursement_amount_dai);
    console.log('Rationale:', result.rationale_summary);

    // Expected: PARTY_B_WINS (Landlord wins)
    if (result.final_verdict === 'PARTY_B_WINS') {
      console.log('\n🎉 Test PASSED - Landlord wins as expected!');
    } else {
      console.log('\n❌ Test FAILED - Expected PARTY_B_WINS, got:', result.final_verdict);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testSimulatorDirect();