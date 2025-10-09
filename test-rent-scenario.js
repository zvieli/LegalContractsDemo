// Test rent contract scenario with correct format
import fetch from 'node-fetch';

async function testRentScenario() {
    console.log('🧪 Testing rent contract scenario...');
    
    const testData = {
        evidenceData: "Tenant John paid $1000 security deposit when moving in. When moving out, apartment had water damage in the bathroom. Landlord claims tenant is responsible. Tenant claims it was pre-existing issue.",
        disputeDescription: "Security deposit dispute - should tenant get deposit back?",
        contractType: "RENT",
        contractAddress: "0xRentContract123",
        disputeId: "RENT-001", 
        disputeType: "Security Deposit Dispute",
        requestedAmount: "1000",
        evidenceHash: "QmRentEvidence123",
        context: {
            duedate: "2025-09-30",
            rentamount: "1500",
            description: "Security deposit dispute over water damage"
        }
    };
    
    try {
        console.log('📡 Testing rent contract scenario...');
        
        const response = await fetch('http://localhost:3001/api/v7/arbitration/ollama', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testData)
        });
        
        console.log(`📊 Response status: ${response.status}`);
        
        const result = await response.text();
        
        if (response.ok) {
            const parsed = JSON.parse(result);
            console.log('✅ Rent scenario test successful!');
            console.log('📋 Decision:', parsed.decision);
            console.log('📋 Reasoning preview:', parsed.reasoning.substring(0, 300) + '...');
            console.log('📋 Reimbursement:', parsed.reimbursement_amount);
            console.log('📋 Confidence:', parsed.confidence);
            console.log('📋 Model used:', parsed.model);
        } else {
            console.log('❌ Test failed:', result);
        }
        
    } catch (error) {
        console.error('💥 Error:', error.message);
    }
}

testRentScenario();