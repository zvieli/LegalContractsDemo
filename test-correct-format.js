// Test with correct API format
import fetch from 'node-fetch';

async function testCorrectFormat() {
    console.log('🧪 Testing with correct API format...');
    
    const testData = {
        evidenceData: "Company A delivered product on time as agreed. Company B received the goods but claims they were damaged during shipping.",
        disputeDescription: "Business dispute over product delivery - who should receive payment?",
        contractType: "DELIVERY",
        contractAddress: "0x123...",
        disputeId: "TEST-001",
        disputeType: "Payment Dispute",
        requestedAmount: "1000",
        evidenceHash: "QmTest123",
        context: {
            duedate: "2025-10-01",
            amount: "1000",
            description: "Product delivery dispute"
        }
    };
    
    try {
        console.log('📡 Sending correctly formatted request...');
        console.log('📋 Request data:', JSON.stringify(testData, null, 2));
        
        const response = await fetch('http://localhost:3001/api/v7/arbitration/ollama', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testData)
        });
        
        console.log(`📊 Response status: ${response.status}`);
        
        const result = await response.text();
        console.log(`📄 Response:`, result);
        
        if (response.ok) {
            const parsed = JSON.parse(result);
            console.log('✅ Test successful!');
            console.log('📋 Decision:', parsed.decision);
            console.log('📋 Reasoning:', parsed.reasoning);
            console.log('📋 Model used:', parsed.model);
            console.log('📋 LLM used:', parsed.llm_used);
        } else {
            console.log('❌ Test failed');
        }
        
    } catch (error) {
        console.error('💥 Error:', error.message);
    }
}

testCorrectFormat();