// Quick test to see what's actually happening
import fetch from 'node-fetch';

async function quickTest() {
    console.log('🔍 QUICK DEBUG TEST...');
    
    const simpleData = {
        evidenceData: "Party A delivered. Party B complains.",
        disputeDescription: "Simple delivery dispute for debugging",
        contractType: "DELIVERY",
        disputeId: "DEBUG-001"
    };
    
    console.log('📡 Sending minimal test case...');
    
    const response = await fetch('http://localhost:3001/api/v7/arbitration/ollama', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(simpleData)
    });
    
    console.log(`📊 Status: ${response.status}`);
    const result = await response.text();
    console.log('📄 Full response:', result);
    
    if (response.ok) {
        const parsed = JSON.parse(result);
        console.log('\n🔍 Key fields to check:');
        console.log('- validation_passed:', parsed.validation_passed);
        console.log('- processing_method:', parsed.processing_method);
        console.log('- explainability.validation_passed:', parsed.explainability?.validation_passed);
        console.log('- explainability.processing_method:', parsed.explainability?.processing_method);
    }
}

quickTest();