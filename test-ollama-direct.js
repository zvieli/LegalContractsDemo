// Test Ollama endpoint directly
import fetch from 'node-fetch';

async function testOllamaEndpoint() {
    console.log('🧪 Testing Ollama endpoint directly...');
    
    const testData = {
        dispute_question: "Who should get the security deposit back?",
        evidence_text: "Tenant John paid $1000 security deposit. Apartment had water damage when he moved out.",
        contract_text: "Security deposit clause: Tenant responsible for damage beyond normal wear."
    };
    
    try {
        console.log('📡 Sending request to /api/v7/arbitration/ollama...');
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
        console.log(`📄 Response body:`, result);
        
        if (response.ok) {
            const parsed = JSON.parse(result);
            console.log('✅ Ollama endpoint test successful!');
            console.log('📋 Decision:', parsed);
        } else {
            console.log('❌ Ollama endpoint test failed');
        }
        
    } catch (error) {
        console.error('💥 Error testing Ollama endpoint:', error.message);
    }
}

testOllamaEndpoint();