// Test the new validation and dynamic chunking system
import fetch from 'node-fetch';

async function testValidationSystem() {
    console.log('🧪 Testing NEW validation system...');
    
    const testData = {
        evidenceData: "Company X delivered goods on schedule. Company Y claims quality issues but did not provide inspection report within 48 hours as required by contract.",
        disputeDescription: "Product delivery dispute with quality claims",
        contractType: "DELIVERY",
        contractAddress: "0xValidationTest123",
        disputeId: "VALIDATION-001",
        disputeType: "Quality Dispute",
        requestedAmount: "500",
        evidenceHash: "QmValidationTest123",
        context: {
            duedate: "2025-10-01",
            amount: "500",
            description: "Testing validation system"
        }
    };
    
    try {
        console.log('📡 Testing enhanced validation system...');
        
        const startTime = Date.now();
        
        const response = await fetch('http://localhost:3001/api/v7/arbitration/ollama', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testData)
        });
        
        const endTime = Date.now();
        console.log(`⏱️ Total response time: ${(endTime - startTime) / 1000}s`);
        console.log(`📊 Response status: ${response.status}`);
        
        const result = await response.text();
        
        if (response.ok) {
            const parsed = JSON.parse(result);
            console.log('✅ Validation system test successful!');
            console.log('📋 Decision:', parsed.decision);
            console.log('📋 Reasoning preview:', parsed.reasoning.substring(0, 200) + '...');
            console.log('📋 Processing method:', parsed.explainability?.processing_method);
            console.log('📋 Validation passed:', parsed.validation_passed);
            console.log('📋 Model used:', parsed.model);
            
            // Check if validation worked
            if (parsed.reasoning && parsed.reasoning.length > 50) {
                console.log('🎯 Validation system working - good response quality!');
            } else {
                console.log('⚠️ Possible validation issue - short response');
            }
            
        } else {
            console.log('❌ Test failed:', result);
        }
        
    } catch (error) {
        console.error('💥 Error:', error.message);
    }
}

testValidationSystem();