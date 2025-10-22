import { processV7ArbitrationWithOllama } from '../modules/ollamaLLMArbitrator.js';
import fs from 'fs';

// Set environment variables for improved settings
process.env.OLLAMA_USE_GUIDED_CHUNKING = 'false';
process.env.OLLAMA_SUMMARY_CONCURRENCY = '16';
process.env.OLLAMA_CHUNK_DIVISOR = '15';
process.env.OLLAMA_NUM_PREDICT_SUMMARY = '60';
process.env.OLLAMA_SUMMARY_MAX_CHARS_PER_CHUNK = '150';
process.env.OLLAMA_MERGED_SUMMARY_MAX_CHARS = '1200';
process.env.OLLAMA_NUM_PREDICT_SYNTHESIS = '200';
process.env.OLLAMA_SUMMARY_TIMEOUT_MS = '15000';
process.env.OLLAMA_SYNTHESIS_TIMEOUT_MS = '40000';

async function testImprovedLLM() {
  console.log('[test] 🧠 Testing improved LLM logic with consistency checks...');
  console.log('[test] 📋 Environment settings:');
  console.log(`  - OLLAMA_USE_GUIDED_CHUNKING: ${process.env.OLLAMA_USE_GUIDED_CHUNKING}`);
  console.log(`  - OLLAMA_NUM_PREDICT_SYNTHESIS: ${process.env.OLLAMA_NUM_PREDICT_SYNTHESIS}`);
  console.log(`  - OLLAMA_SUMMARY_CONCURRENCY: ${process.env.OLLAMA_SUMMARY_CONCURRENCY}`);

  // Load test evidence
  let testEvidence;
  try {
    const evidenceData = fs.readFileSync('./test-evidence.json', 'utf8');
    testEvidence = JSON.parse(evidenceData);
  } catch (error) {
    console.error('[test] ❌ Failed to load test evidence:', error.message);
    return;
  }

  const testData = {
    evidence_text: testEvidence.evidenceData,
    contract_text: `SOFTWARE_DEVELOPMENT CONTRACT DISPUTE ANALYSIS

CONTRACT DETAILS:
- Contract Type: SOFTWARE_DEVELOPMENT
- Contract Address: 0xSoftwareDev123
- Dispute ID: DYNAMIC-CHUNK-001
- Dispute Type: Contract Performance and Payment Dispute
- Requested Amount: 2500000 ETH
- Evidence Hash: bafybeidynamictestchunk000000000000000000000000000000000

EVIDENCE PROVIDED:
${testEvidence.evidenceData}

DISPUTE CONTEXT:
{
  "duedate": "2026-09-01",
  "amount": "2500000",
  "description": "Complex multi-million dollar software development dispute requiring dynamic chunking analysis"
}

PAYMENT STATUS:
- Due Date: 2026-09-01
- Rent Amount: Not specified

QUESTION FOR ANALYSIS:
Based on the evidence and contract terms, who should win this dispute and what compensation (if any) is appropriate?`,
    dispute_question: testEvidence.disputeDescription,
    requested_amount: 2500000
  };

  try {
    console.log('[test] ⏱️ Starting LLM processing...');
    const startTime = Date.now();
    
    const result = await processV7ArbitrationWithOllama(testData);
    
    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 1000;

    console.log(`[test] ✅ LLM processing completed in ${totalTime.toFixed(3)}s`);
    console.log('[test] 📊 Results:');
    console.log(`  - Final Verdict: ${result.final_verdict}`);
    console.log(`  - Reimbursement: ${result.reimbursement_amount_dai} DAI`);
    console.log(`  - Confidence: ${result.confidence}`);
    console.log(`  - Processing Method: ${result.processing_method}`);
    console.log(`  - Chunks Processed: ${result.chunks_processed || 'N/A'}`);
    console.log(`  - Validation Passed: ${result.validation_passed}`);
    console.log(`  - Total Text Length: ${result.total_text_length}`);
    
    if (result.timings) {
      console.log('[test] ⏱️ Detailed Timings:');
      console.log(`  - Sanitization: ${result.timings.sanitize_ms || 0}ms`);
      console.log(`  - Chunking: ${result.timings.chunk_ms || 0}ms`);
      console.log(`  - Summarization: ${result.timings.summarize_ms || 0}ms`);
      console.log(`  - Synthesis: ${result.timings.synthesize_ms || 0}ms`);
      console.log(`  - Validation: ${result.timings.validate_ms || 0}ms`);
      console.log(`  - TOTAL: ${result.timings.total_ms || 0}ms`);
    }

    console.log('[test] 📝 Rationale:');
    console.log(`  "${result.rationale_summary}"`);

    // Analyze result quality
    console.log('\n[test] 🔍 Quality Analysis:');
    
    // Check for consistency
    const hasBreachMention = result.rationale_summary.toLowerCase().includes('breach');
    const isDrawVerdict = result.final_verdict === 'DRAW';
    
    if (hasBreachMention && isDrawVerdict) {
      console.log('  ⚠️  CONSISTENCY ISSUE: Mentions breach but verdict is DRAW');
    } else {
      console.log('  ✅ Verdict-rationale consistency: GOOD');
    }

    // Check validation
    if (result.validation_passed) {
      console.log('  ✅ Schema validation: PASSED');
    } else {
      console.log('  ❌ Schema validation: FAILED');
    }

    // Check performance
    if (result.timings && result.timings.total_ms) {
      if (result.timings.total_ms < 60000) {
        console.log(`  ✅ Performance: EXCELLENT (${(result.timings.total_ms/1000).toFixed(1)}s < 60s)`);
      } else if (result.timings.total_ms < 90000) {
        console.log(`  ⚠️  Performance: GOOD (${(result.timings.total_ms/1000).toFixed(1)}s < 90s)`);
      } else {
        console.log(`  ❌ Performance: SLOW (${(result.timings.total_ms/1000).toFixed(1)}s > 90s)`);
      }
    }

    return result;

  } catch (error) {
    console.error('[test] ❌ Test failed:', error.message);
    console.error('[test] Stack:', error.stack);
    return null;
  }
}

// Run the test
testImprovedLLM()
  .then(result => {
    if (result) {
      console.log('\n[test] 🎯 Test completed successfully!');
      process.exit(0);
    } else {
      console.log('\n[test] ❌ Test failed!');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('[test] 💥 Unexpected error:', error);
    process.exit(1);
  });