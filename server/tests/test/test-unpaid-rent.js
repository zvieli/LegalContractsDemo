


import fetch from 'node-fetch';

const V7_BASE_URL = 'http://localhost:3001';

async function testUnpaidRentCase() {
  console.log('🧪 Testing Unpaid Rent Case...');

  const arbitrationPayload = {
    contract_text: "Monthly rent $1200 due by 1st. No payment received for 2 months.",
    evidence_text: "No payment receipts provided by tenant. Bank statements show no outgoing transfers to landlord account during disputed months.",
    dispute_question: "Tenant claims payments were made but provides no evidence. Is payment due?",
    requested_amount: 2400
  };

  try {
    const response = await fetch(`${V7_BASE_URL}/api/v7/arbitration/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(arbitrationPayload)
    });

    const result = await response.json();
    
    console.log('Result:', result);
    console.log('Verdict:', result.final_verdict);
    console.log('Amount:', result.reimbursement_amount_dai);
    console.log('Rationale:', result.rationale_summary);

  } catch (error) {
    console.error('Test failed:', error);
  }
}

testUnpaidRentCase();