// Test with very detailed logging
import fetch from 'node-fetch';

async function testWithDetailedLogging() {
    console.log('🧪 Testing with detailed logging...');
    
    const testData = {
        dispute_question: "Who wins this business dispute?",
        evidence_text: "Company A delivered product. Company B says it was late.",
        contract_text: "Delivery must be on time or penalty applies."
    };
    
    try {
        console.log('📡 Sending request to Ollama...');
        console.log('📋 Request data:', JSON.stringify(testData, null, 2));
        
        const response = await fetch('http://localhost:3001/api/v7/arbitration/ollama', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testData)
        });
        
        console.log(`📊 Response status: ${response.status}`);
        console.log(`📊 Response headers:`, Object.fromEntries(response.headers.entries()));
        
        const result = await response.text();
        console.log(`📄 Full response body:`, result);
        
        // Try to see if server shows any processing info
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        console.log('\n🔍 Trying to get server logs...');
        const debugResponse = await fetch('http://localhost:3001/api/v7/debug/development-info');
        if (debugResponse.ok) {
            const debugInfo = await debugResponse.text();
            console.log('🐛 Debug info:', debugInfo);
        }
        
    } catch (error) {
        console.error('💥 Error:', error.message);
    }
}

testWithDetailedLogging();