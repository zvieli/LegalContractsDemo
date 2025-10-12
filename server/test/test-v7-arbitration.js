


import fetch from 'node-fetch';

const V7_BASE_URL = 'http://localhost:3001';

async function testIntegratedArbitration() {
  console.log('🧪 Testing V7 Integrated LLM Arbitration...\n');

  try {
    // Test 1: Health check
    console.log('1️⃣ Testing arbitration health check...');
    const healthResponse = await fetch(`${V7_BASE_URL}/api/v7/arbitration/health`);
    const healthData = await healthResponse.json();
    
    if (healthData.healthy) {
      console.log('✅ Health check passed:', healthData.stats);
    } else {
      console.log('❌ Health check failed:', healthData);
    }

    // Test 2: Arbitration simulation
    console.log('\n2️⃣ Testing arbitration simulation...');
    const arbitrationPayload = {
      contract_text: "Rental Agreement: Tenant must pay $1000 monthly rent by the 5th of each month. Late fees of 5% apply after grace period.",
      evidence_text: "Bank error occurred on payment date. Transaction was delayed due to processing failure on landlord's bank side. Payment receipt attached.",
      dispute_question: "Should tenant pay late fee when bank error caused delay?",
      requested_amount: 50
    };

    const arbitrationResponse = await fetch(`${V7_BASE_URL}/api/v7/arbitration/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(arbitrationPayload)
    });

    const arbitrationData = await arbitrationResponse.json();
    
    if (arbitrationData.success) {
      console.log('✅ Arbitration simulation successful:');
      console.log(`   Verdict: ${arbitrationData.final_verdict}`);
      console.log(`   Amount: ${arbitrationData.reimbursement_amount_dai} DAI`);
      console.log(`   Rationale: ${arbitrationData.rationale_summary}`);
    } else {
      console.log('❌ Arbitration simulation failed:', arbitrationData);
    }

    // Test 3: Edge case - minimal data
    console.log('\n3️⃣ Testing minimal data case...');
    const minimalPayload = {
      contract_text: "",
      evidence_text: "water damage in apartment",
      dispute_question: "compensation needed",
      requested_amount: 200
    };

    const minimalResponse = await fetch(`${V7_BASE_URL}/api/v7/arbitration/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(minimalPayload)
    });

    const minimalData = await minimalResponse.json();
    
    if (minimalData.success) {
      console.log('✅ Minimal data test successful:');
      console.log(`   Verdict: ${minimalData.final_verdict}`);
      console.log(`   Amount: ${minimalData.reimbursement_amount_dai} DAI`);
    } else {
      console.log('❌ Minimal data test failed:', minimalData);
    }

    console.log('\n🎉 All tests completed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('\n💡 Make sure V7 server is running: npm run start:v7');
  }
}

// Run tests
testIntegratedArbitration();