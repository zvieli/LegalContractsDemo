// Test dynamic chunking system with a long message
import fetch from 'node-fetch';

async function testDynamicChunking() {
    console.log('🧪 Testing DYNAMIC CHUNKING system...');
    
    // Create a message that will trigger chunking (over 4000 chars)
    const longEvidence = `
COMPREHENSIVE BUSINESS CONTRACT ANALYSIS

EXECUTIVE SUMMARY:
This dispute involves a complex multi-party business agreement between TechCorp Industries (Party A) and GlobalSoft Solutions (Party B) regarding a software development and licensing deal valued at $2.5 million over 18 months.

BACKGROUND INFORMATION:
TechCorp Industries signed a comprehensive software development agreement with GlobalSoft Solutions on March 1st, 2025. The contract included specific deliverables, milestone payments, intellectual property rights, and performance guarantees. The project involved developing a custom enterprise resource planning system with advanced analytics capabilities.

CONTRACT TERMS AND CONDITIONS:
- Total contract value: $2,500,000
- Payment schedule: 40% upfront, 30% at mid-point, 30% upon completion
- Development timeline: 18 months (March 2025 - September 2026)
- Performance guarantees: 99.5% uptime, response time under 2 seconds
- Intellectual property: Joint ownership with TechCorp retaining primary rights
- Penalty clauses: 2% reduction per week for delays beyond agreed timeline
- Quality assurance: Minimum 95% test coverage, peer code review mandatory

TIMELINE OF EVENTS:
March 1, 2025: Contract signed and first payment ($1,000,000) transferred
March 15, 2025: GlobalSoft commenced initial development phase
April 30, 2025: First milestone review conducted - minor delays noted
June 1, 2025: Second payment ($750,000) released after milestone completion
July 15, 2025: TechCorp raised concerns about code quality and documentation
August 1, 2025: Performance testing revealed system response times exceeding 5 seconds
August 15, 2025: GlobalSoft requested timeline extension citing complexity issues
September 1, 2025: TechCorp discovered security vulnerabilities in beta version
September 15, 2025: Project formally suspended pending dispute resolution
October 1, 2025: Both parties initiated arbitration process

TECHNICAL ISSUES IDENTIFIED:
1. System performance significantly below contracted specifications
2. Security framework insufficient for enterprise deployment
3. Code documentation incomplete and below industry standards
4. User interface design not matching approved wireframes
5. Database optimization poorly implemented causing slow queries
6. API integration points failing under load testing conditions
7. Mobile responsiveness not implemented despite contract requirements

TECHCORP'S POSITION (PARTY A):
TechCorp argues that GlobalSoft has materially breached the contract by:
- Failing to meet performance specifications (response time 5s vs contracted 2s)
- Delivering code with significant security vulnerabilities
- Missing documentation requirements that prevent proper maintenance
- Requesting timeline extensions without valid justification
- Not following agreed development methodologies and quality standards

TechCorp is seeking:
- Refund of payments made ($1,750,000)
- Additional damages for project delays ($500,000)
- Retention of all intellectual property developed
- Compensation for internal resources spent on project oversight ($250,000)

GLOBALSOFT'S POSITION (PARTY B):
GlobalSoft contends that:
- TechCorp repeatedly changed requirements mid-development without formal change orders
- The original timeline was unrealistic given project complexity
- Performance issues are due to TechCorp's inadequate infrastructure specifications
- Security concerns are minor and easily addressable with patches
- Documentation was delayed due to ongoing code changes requested by TechCorp

GlobalSoft is seeking:
- Payment of remaining contract balance ($750,000)
- Additional compensation for scope changes ($400,000)
- Recognition of their intellectual property contributions
- Extension of timeline to complete project properly (6 additional months)

EXPERT TECHNICAL REVIEW:
Independent software audit firm CyberTech Consulting reviewed the codebase and found:
- Code quality meets industry standards with some optimization needed
- Security issues present but not critical for beta phase
- Performance problems primarily due to database design choices
- Documentation at 70% completion level, below contractual requirements
- Overall project completion estimated at 65% of total scope

FINANCIAL IMPACT ANALYSIS:
- Total payments made to date: $1,750,000
- Estimated completion cost: $800,000 additional
- TechCorp's claimed damages: $1,250,000
- GlobalSoft's claimed additional fees: $400,000
- Market value of completed system: $3,200,000

INDUSTRY PRECEDENTS:
Similar software development disputes in this jurisdiction typically result in:
- Shared responsibility when both parties contribute to project issues
- Compensation based on actual value delivered rather than contractual penalties
- Continuation of projects with modified terms when technically feasible
- Mediated settlements averaging 60-70% of disputed amounts

REQUEST FOR ARBITRATION:
Both parties request fair determination of:
1. Whether material breach occurred and by which party
2. Appropriate allocation of financial responsibility
3. Ownership rights to intellectual property developed
4. Whether project should continue or be terminated
5. Calculation of damages and compensation if any
`;

    const testData = {
        evidenceData: longEvidence,
        disputeDescription: "Complex software development contract dispute involving performance issues, payment disputes, and intellectual property rights",
        contractType: "SOFTWARE_DEVELOPMENT",
        contractAddress: "0xSoftwareDev123",
        disputeId: "DYNAMIC-CHUNK-001",
        disputeType: "Contract Performance and Payment Dispute",
        requestedAmount: "2500000",
        evidenceHash: "QmDynamicChunkTest123",
        context: {
            duedate: "2026-09-01",
            amount: "2500000",
            description: "Complex multi-million dollar software development dispute requiring dynamic chunking analysis"
        }
    };
    
    try {
        console.log('📡 Testing DYNAMIC CHUNKING with complex case...');
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
            console.log('✅ Dynamic chunking test successful!');
            console.log('📋 Decision:', parsed.decision);
            console.log('📋 Reasoning preview:', parsed.reasoning.substring(0, 300) + '...');
            console.log('📋 Reimbursement:', parsed.reimbursement_amount);
            console.log('📋 Confidence:', parsed.confidence);
            console.log('📋 Model used:', parsed.model);
            console.log('📋 Processing method:', parsed.explainability?.processing_method);
            console.log('📋 Validation passed:', parsed.validation_passed);
            
            // Check if chunking was used and if it was faster than before
            if (parsed.reasoning.includes('chunk') || parsed.reasoning.includes('part')) {
                console.log('🔍 Dynamic chunking was triggered (as expected for long message)');
            } else {
                console.log('🎯 Single processing used (chunking threshold may have adapted)');
            }
            
            // Compare with previous long message performance
            const responseTime = (endTime - startTime) / 1000;
            if (responseTime < 200) { // Less than previous 400s
                console.log('🚀 Performance improvement detected! Dynamic chunking working!');
            } else {
                console.log('⚠️ Performance similar to before - may need further optimization');
            }
            
        } else {
            console.log('❌ Dynamic chunking test failed:', result);
        }
        
    } catch (error) {
        console.error('💥 Error:', error.message);
    }
}

testDynamicChunking();