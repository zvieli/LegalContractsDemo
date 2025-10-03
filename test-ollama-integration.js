/**
 * Test V7 Ollama LLM Integration
 * Tests both Ollama and fallback to simulation
 */

import fetch from 'node-fetch';

const V7_BASE_URL = 'http://localhost:3001';

async function testOllamaIntegration() {
  console.log('🦙 Testing V7 Ollama LLM Integration...\n');

  try {
    // Test 1: Ollama Health Check
    console.log('1️⃣ Testing Ollama health check...');
    const healthResponse = await fetch(`${V7_BASE_URL}/api/v7/arbitration/ollama/health`);
    const healthData = await healthResponse.json();
    
    console.log('Health Status:', healthData.healthy ? '✅ Healthy' : '❌ Unhealthy');
    console.log('Stats:', healthData.stats);

    // Test 2: Ollama Arbitration (with fallback)
    console.log('\n2️⃣ Testing Ollama arbitration...');
    const arbitrationPayload = {
      contract_text: "Rental Agreement: Tenant must pay $1000 monthly rent by the 5th of each month. Late fees of 5% apply after grace period.",
      evidence_text: "Bank error occurred on payment date. Transaction was delayed due to processing failure on landlord's bank side. Payment receipt attached.",
      dispute_question: "Should tenant pay late fee when bank error caused delay?",
      requested_amount: 50
    };

    console.log('🔄 Sending request to Ollama arbitration endpoint...');
    const startTime = Date.now();
    
    const arbitrationResponse = await fetch(`${V7_BASE_URL}/api/v7/arbitration/ollama`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(arbitrationPayload)
    });

    const arbitrationData = await arbitrationResponse.json();
    const responseTime = Date.now() - startTime;
    
    if (arbitrationData.success) {
      console.log('✅ Arbitration successful:');
      console.log(`   LLM Used: ${arbitrationData.llm_used ? '🦙 Ollama' : '🎯 Simulation'}`);
      console.log(`   Model: ${arbitrationData.model}`);
      console.log(`   Verdict: ${arbitrationData.final_verdict}`);
      console.log(`   Amount: ${arbitrationData.reimbursement_amount_dai} DAI`);
      console.log(`   Rationale: ${arbitrationData.rationale_summary}`);
      console.log(`   Response Time: ${responseTime}ms`);
    } else {
      console.log('❌ Arbitration failed:', arbitrationData);
    }

    // Test 3: Complex Legal Case
    console.log('\n3️⃣ Testing complex legal case...');
    const complexPayload = {
      contract_text: "Commercial Lease Agreement: Monthly rent $5000 due by 1st. Tenant responsible for utilities. Landlord responsible for structural maintenance. Early termination requires 60 days notice.",
      evidence_text: "Tenant provided 45 days notice due to water leak that caused business interruption. Landlord failed to fix leak for 3 weeks despite multiple requests. Business lost $15,000 in revenue. Tenant seeks early termination without penalty and compensation.",
      dispute_question: "Is tenant entitled to early termination without penalty and compensation for business losses due to landlord's failure to maintain property?",
      requested_amount: 15000
    };

    const complexResponse = await fetch(`${V7_BASE_URL}/api/v7/arbitration/ollama`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(complexPayload)
    });

    const complexData = await complexResponse.json();
    
    if (complexData.success) {
      console.log('✅ Complex case resolved:');
      console.log(`   LLM Used: ${complexData.llm_used ? '🦙 Ollama' : '🎯 Simulation'}`);
      console.log(`   Verdict: ${complexData.final_verdict}`);
      console.log(`   Amount: ${complexData.reimbursement_amount_dai} DAI`);
      console.log(`   Rationale: ${complexData.rationale_summary.substring(0, 100)}...`);
    } else {
      console.log('❌ Complex case failed:', complexData);
    }

    console.log('\n🎉 Ollama integration tests completed!');
    
    // Summary
    console.log('\n📊 Summary:');
    console.log(`- Ollama Service: ${healthData.healthy ? 'Available' : 'Unavailable (using fallback)'}`);
    console.log(`- Arbitration Success: ${arbitrationData.success ? 'Yes' : 'No'}`);
    console.log(`- LLM Integration: ${arbitrationData.llm_used ? 'Ollama LLM' : 'Simulation Mode'}`);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('\n💡 Make sure:');
    console.log('1. V7 server is running: node server/index.js');
    console.log('2. Ollama is installed and running: ollama serve');
    console.log('3. Llama model is available: ollama pull llama3.2');
  }
}

// Run tests
testOllamaIntegration();