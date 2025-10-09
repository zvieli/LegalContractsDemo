// Test medium-length message (should not trigger chunking now)
import fetch from 'node-fetch';

async function testMediumMessage() {
    console.log('🧪 Testing MEDIUM length message (should avoid chunking)...');
    
    const mediumEvidence = `
RENTAL DISPUTE SUMMARY

BACKGROUND:
Tenant Sarah rented apartment 4B for $2,500/month with $2,500 security deposit. Lease started January 1st, 2025.

TIMELINE:
- Jan 15: Tenant reported bathroom water leak
- Feb 1: Landlord performed basic plumbing repair  
- Mar 10: Tenant complained about persistent dampness
- Mar 15: Professional inspection revealed mold behind bathroom wall
- Apr 1: Tenant requested rent reduction due to mold issues
- May 1: Tenant withheld rent citing uninhabitable conditions
- June 1: Tenant vacated voluntarily
- June 5: Final walkthrough showed extensive mold damage

PROPERTY CONDITIONS AT DEPARTURE:
1. Extensive mold damage in bathroom (behind tiles)
2. Water damage to adjacent bedroom floor
3. Ceiling staining from water damage
4. Strong musty odor throughout unit
5. Normal wear and tear in other areas

LANDLORD CLAIMS:
- Tenant caused damage by not reporting leak promptly
- Previous tenants never had mold issues
- Damage exceeds normal wear and tear
- Wants to keep security deposit for repairs

TENANT CLAIMS:
- All issues were reported promptly
- Mold inspector confirmed pre-existing structural problem
- Leak originated from faulty pipe installation 3 years ago
- Landlord failed to address habitability concerns
- Requests return of full $2,500 security deposit

EXPERT EVIDENCE:
Professional mold inspector concluded moisture problem originated from faulty building construction, not tenant negligence. Damage pattern shows long-term leak, not sudden overflow.

FINANCIAL STAKES:
- Security deposit: $2,500
- Withheld rent: $2,500  
- Repair estimate: $8,500
- Tenant's inspection costs: $400
`;

    const testData = {
        evidenceData: mediumEvidence,
        disputeDescription: "Rental security deposit dispute involving water damage and mold - tenant vs landlord liability",
        contractType: "RENT",
        contractAddress: "0xMediumRent123",
        disputeId: "MEDIUM-RENT-001",
        disputeType: "Security Deposit Dispute",
        requestedAmount: "2500",
        evidenceHash: "QmMediumEvidence123",
        context: {
            duedate: "2025-06-01",
            rentamount: "2500",
            description: "Security deposit dispute with medium-length evidence"
        }
    };
    
    try {
        console.log('📡 Sending MEDIUM message...');
        console.log(`📊 Evidence length: ${mediumEvidence.length} characters`);
        
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
            console.log('✅ Medium message test successful!');
            console.log('📋 Decision:', parsed.decision);
            console.log('📋 Reasoning preview:', parsed.reasoning.substring(0, 400) + '...');
            console.log('📋 Reimbursement:', parsed.reimbursement_amount);
            console.log('📋 Confidence:', parsed.confidence);
            console.log('📋 Model used:', parsed.model);
            
            // Check processing method
            if (parsed.reasoning.includes('chunk') || parsed.reasoning.includes('part')) {
                console.log('⚠️ Chunking was used (unexpected for medium message)');
            } else {
                console.log('✅ Single processing used (as expected)');
            }
            
        } else {
            console.log('❌ Medium message test failed:', result);
        }
        
    } catch (error) {
        console.error('💥 Error:', error.message);
    }
}

testMediumMessage();