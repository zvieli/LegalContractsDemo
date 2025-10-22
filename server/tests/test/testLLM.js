


import { triggerLLMArbitration, handleLLMResponse, getActiveRequests } from '../modules/llmArbitration.js';

async function testLLMArbitration() {
  console.log('🤖 Testing LLM Arbitration Module...\n');
  
  // Test dispute data
  const testDispute = {
    contractAddress: '0x1234567890123456789012345678901234567890',
    disputeType: 0,
    requestedAmount: '1.5',
  evidenceCID: 'bafybeitestevidence1234567890000000000000000000000000',
    disputeId: 1,
    timestamp: Date.now()
  };
  
  console.log('Testing LLM arbitration trigger:');
  console.log('Dispute data:', testDispute);
  
  try {
    // Trigger arbitration
    const arbitrationRequest = await triggerLLMArbitration(testDispute);
    console.log('✅ Arbitration triggered:', arbitrationRequest);
    
    // Check active requests
    console.log('\nActive requests:');
    const activeRequests = getActiveRequests();
    console.log(`Found ${activeRequests.length} active requests`);
    activeRequests.forEach(req => {
      console.log(`  - ${req.requestId}: ${req.status}`);
    });
    
    // Test direct LLM response handling
    console.log('\nTesting direct LLM response handling:');
    const mockLLMResult = {
      final_verdict: 'PARTY_A_WINS',
      reimbursement_amount_dai: 1500,
      rationale_summary: 'Evidence clearly supports Party A\'s claim based on contract violations.'
    };
    
    setTimeout(async () => {
      try {
        const response = await handleLLMResponse(
          arbitrationRequest.requestId,
          mockLLMResult,
          testDispute.contractAddress,
          testDispute.disputeId
        );
        console.log('✅ LLM response processed:', response);
        
        // Check final request status
        const finalRequests = getActiveRequests();
        const processedRequest = finalRequests.find(req => req.requestId === arbitrationRequest.requestId);
        console.log('Final request status:', processedRequest?.status);
        
      } catch (error) {
        console.error('❌ Error processing LLM response:', error.message);
      }
    }, 1000);
    
  } catch (error) {
    console.error('❌ Error in LLM arbitration test:', error.message);
  }
  
  // Test appeal data
  console.log('\nTesting appeal arbitration:');
  const testAppeal = {
    contractAddress: '0x1234567890123456789012345678901234567890',
    disputeId: 1,
  evidenceCID: 'bafybeitestappealevidence9876543210000000000000000',
    appealReason: 'Disagreement with initial decision',
    timestamp: Date.now(),
    type: 'appeal'
  };
  
  try {
    const appealRequest = await triggerLLMArbitration(testAppeal);
    console.log('✅ Appeal arbitration triggered:', appealRequest);
  } catch (error) {
    console.error('❌ Error in appeal arbitration test:', error.message);
  }
  
  console.log('\n✅ LLM arbitration tests completed!');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testLLMArbitration().catch(console.error);
}

export default testLLMArbitration;