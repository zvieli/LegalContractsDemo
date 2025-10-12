import { nlpVerdictMapping, mergeArbitrationVerdicts, processV7ArbitrationWithOllama } from '../../modules/ollamaLLMArbitrator.js';

// Use real LLM via Ollama
// Use the full pipeline to get a unified arbitration result (LLM + NLP + merge)
async function getLLMResult(testData) {
  const res = await processV7ArbitrationWithOllama(testData);
  // processV7ArbitrationWithOllama returns { decision, arbitration, reasoning, confidence, source, raw }
  return res;
}
import fs from 'fs';

const cases = [
  { file: 'server/test/evidence1.json', expected: 'PARTY_A_WINS' },
  { file: 'server/test/evidence2.json', expected: 'PARTY_B_WINS' },
  { file: 'server/test/evidence3.json', expected: 'NO_PENALTY' },
  { file: 'server/test/evidence4.json', expected: 'DRAW' },
  { file: 'server/test/evidence5.json', expected: 'PARTY_A_WINS' },
  { file: 'server/test/evidence6.json', expected: 'NO_PENALTY' },
  { file: 'server/test/evidence7.json', expected: 'DRAW' },
  { file: 'server/test/evidence8.json', expected: 'PARTY_B_WINS' },
  { file: 'server/test/evidence9.json', expected: 'NO_PENALTY' },
  { file: 'server/test/evidence10.json', expected: 'NO_PENALTY' },
  { file: 'server/test/evidence11.json', expected: 'DRAW' },
  { file: 'server/test/evidence12.json', expected: 'NO_PENALTY' }
];

async function runAllCases() {
  const results = [];
  for (const testCase of cases) {
    console.log(`\n[test] Running LLM test for: ${testCase.file}`);
    let testEvidence;
    try {
      const evidenceData = fs.readFileSync(testCase.file, 'utf8');
      testEvidence = JSON.parse(evidenceData);
    } catch (error) {
      console.error(`[test] ❌ Failed to load evidence for ${testCase.file}:`, error.message);
      continue;
    }
    const testData = {
      evidence_text: testEvidence.evidenceData,
      contract_text: 'GENERIC CONTRACT FOR TESTING',
      dispute_id: testCase.file
    };
    console.log("=== EVIDENCE TEXT FOR LLM ===\n", testData.evidence_text, "\n============================");
    console.log("=== TEST DATA SENT TO LLM ===\n", JSON.stringify(testData, null, 2), "\n============================");
      // Simulate LLM response (here: just use evidence_text for validation)
    // Use real LLM for testing merge logic
    let pipelineResult;
    try {
      pipelineResult = await getLLMResult(testData);
    } catch (err) {
      console.error(`[test] ❌ Error running pipeline for ${testCase.file}:`, err && err.message ? err.message : err);
      // continue to next test case
      continue;
    }
    const merged = {
      verdict: pipelineResult.decision || pipelineResult.arbitration,
      confidence: pipelineResult.confidence,
      rationale: pipelineResult.reasoning,
      source: pipelineResult.source,
      raw: pipelineResult.raw
    };

      console.log('[test] Unified Verdict:', merged.verdict);
      console.log('[test] Confidence:', merged.confidence);
      console.log('[test] Rationale:', merged.rationale);
      console.log('[test] Source:', merged.source);
      const pass = merged.verdict === testCase.expected;
      if (!pass) console.log(`[test] ❌ Unexpected verdict! Expected: ${testCase.expected}`);
      else console.log(`[test] ✅ Verdict matches expected: ${testCase.expected}`);
      results.push({ file: testCase.file, expected: testCase.expected, verdict: merged.verdict, pass });
  }

  // Print summary
  const passed = results.filter(r => r.pass).length;
  const failed = results.length - passed;
  console.log('\n=== TEST SUMMARY ===');
  console.log(`Total cases: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed) {
    console.log('\nFailed cases:');
    for (const r of results.filter(r => !r.pass)) {
      console.log(` - ${r.file}: expected=${r.expected} got=${r.verdict}`);
    }
  }
}


(async () => {
  await runAllCases();
})();

// ייצוא לפונקציות שימוש חוזר בטסטים אחרים
export { getLLMResult };
