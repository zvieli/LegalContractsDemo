// Test simple business analysis
import fetch from 'node-fetch';

async function testSimpleBusinessAnalysis() {
    console.log('🧪 Testing simple business analysis...');
    
    const testData = {
        dispute_question: "Should Party A or Party B receive the payment?",
        evidence_text: "Party A delivered goods on time. Party B claims goods were damaged.",
        contract_text: "Payment due on delivery of goods in good condition."
    };
    
    try {
        console.log('📡 Testing with simple business scenario...');
        const response = await fetch('http://localhost:3001/api/v7/arbitration/ollama', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testData)
        });
        
        console.log(`📊 Response status: ${response.status}`);
        
        const result = await response.text();
        console.log(`📄 Full response:`, result);
        
        if (response.ok) {
            const parsed = JSON.parse(result);
            console.log('✅ Business analysis successful!');
            console.log('📋 Decision:', parsed.decision);
            console.log('📋 Reasoning:', parsed.reasoning);
            console.log('📋 Confidence:', parsed.confidence);
            console.log('📋 Model used:', parsed.model);
            console.log('📋 LLM used:', parsed.llm_used);
        } else {
            console.log('❌ Business analysis failed');
        }
        
    } catch (error) {
        console.error('💥 Error:', error.message);
    }
}

testSimpleBusinessAnalysis();