// Test long message with chunking
import fetch from 'node-fetch';

async function testLongMessage() {
    console.log('🧪 Testing LONG message with chunking...');
    
    // Create a long evidence text that will trigger chunking
    const longEvidence = `
DETAILED RENTAL AGREEMENT ANALYSIS

BACKGROUND INFORMATION:
Tenant Sarah Johnson signed a 12-month lease agreement on January 1st, 2025 for apartment 4B at 123 Main Street. The monthly rent was set at $2,500 with a security deposit of $2,500. The lease included specific clauses about property maintenance, damage responsibilities, and termination conditions.

TIMELINE OF EVENTS:
January 1, 2025: Lease agreement signed and security deposit paid
January 15, 2025: Tenant reported minor water leak in bathroom
February 1, 2025: Landlord performed repairs to bathroom plumbing
March 10, 2025: Tenant complained about persistent dampness
March 15, 2025: Professional inspection revealed mold behind bathroom wall
April 1, 2025: Tenant requested rent reduction due to habitability issues
April 10, 2025: Landlord disagreed, claiming tenant caused the damage
May 1, 2025: Tenant withheld rent payment citing uninhabitable conditions
May 15, 2025: Landlord issued 30-day notice to quit
June 1, 2025: Tenant vacated property voluntarily
June 5, 2025: Final walkthrough conducted by both parties

PROPERTY CONDITIONS:
During the final walkthrough, the following issues were documented:
1. Extensive mold damage in bathroom (behind tiles and drywall)
2. Water damage to hardwood floors in adjacent bedroom
3. Staining on ceiling from water damage
4. Musty odor throughout apartment
5. Normal wear and tear in living areas
6. Kitchen appliances in good condition
7. Carpet cleaning needed in bedrooms
8. Minor scuff marks on walls (normal wear)

LANDLORD'S POSITION:
The landlord claims that the tenant is responsible for all water damage because:
- Initial leak was minor and should have been reported sooner
- Tenant allegedly used excessive water in bathroom causing overflow
- Previous tenants never had such issues
- Professional plumber confirmed pipes were in good condition
- Damage exceeds normal wear and tear significantly

TENANT'S POSITION:
The tenant argues that:
- All issues were promptly reported to landlord
- Initial leak was pre-existing condition from poor installation
- Mold growth indicates long-term moisture problem before tenancy
- Professional inspection shows structural issues not tenant-caused
- Landlord failed to address habitability concerns promptly
- Security deposit should be returned in full due to landlord negligence

EXPERT REPORTS:
Professional mold inspector concluded that the moisture problem originated from faulty pipe installation during building construction 3 years ago. The inspector noted that the damage pattern indicates a slow, persistent leak rather than sudden overflow or tenant negligence.

LEASE AGREEMENT CLAUSES:
Section 8.3: "Tenant shall promptly notify Landlord of any water leaks or moisture issues"
Section 12.1: "Landlord responsible for structural repairs and building maintenance"
Section 15.2: "Security deposit may be used for damages beyond normal wear and tear"
Section 18.4: "Either party may terminate lease for habitability violations"

FINANCIAL IMPACT:
- Security deposit at stake: $2,500
- Withheld rent (May): $2,500
- Professional inspection costs: $400 (paid by tenant)
- Temporary housing costs for tenant: $1,200
- Estimated repair costs: $8,500 (landlord's estimate)

PRECEDENT CASES:
Similar cases in this jurisdiction typically favor tenants when:
- Pre-existing conditions can be established
- Landlord failed to address habitability issues promptly
- Professional evidence supports tenant's claims
- Tenant properly documented and reported issues

REQUEST FOR ARBITRATION:
The parties are seeking a fair resolution regarding:
1. Return of security deposit ($2,500)
2. Responsibility for repair costs
3. Compensation for tenant's additional expenses
4. Determination of fault in the water damage incident
`;

    const testData = {
        evidenceData: longEvidence,
        disputeDescription: "Complex rental dispute involving water damage, mold, security deposit, and habitability issues requiring detailed analysis",
        contractType: "RENT",
        contractAddress: "0xComplexRent123",
        disputeId: "COMPLEX-RENT-001",
        disputeType: "Security Deposit and Habitability Dispute",
        requestedAmount: "2500",
        evidenceHash: "QmLongEvidenceHash123",
        context: {
            duedate: "2025-06-01",
            rentamount: "2500",
            description: "Complex rental dispute with extensive evidence requiring chunked analysis"
        }
    };
    
    try {
        console.log('📡 Sending LONG message (will trigger chunking)...');
        console.log(`📊 Evidence length: ${longEvidence.length} characters`);
        
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
            console.log('✅ Long message test successful!');
            console.log('📋 Decision:', parsed.decision);
            console.log('📋 Reasoning preview:', parsed.reasoning.substring(0, 500) + '...');
            console.log('📋 Reimbursement:', parsed.reimbursement_amount);
            console.log('📋 Confidence:', parsed.confidence);
            console.log('📋 Model used:', parsed.model);
            console.log('📋 Processing method:', parsed.explainability?.processing_method);
            
            // Check if chunking was used
            if (parsed.reasoning.includes('chunk') || parsed.reasoning.includes('part')) {
                console.log('🔍 Chunking was likely used for this long message');
            }
            
        } else {
            console.log('❌ Long message test failed:', result);
        }
        
    } catch (error) {
        console.error('💥 Error:', error.message);
    }
}

testLongMessage();