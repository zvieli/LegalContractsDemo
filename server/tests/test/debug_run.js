import fs from 'fs';
import { processV7ArbitrationWithOllama, callOllama, validateResponse, nlpVerdictMapping } from '../modules/ollamaLLMArbitrator.js';

(async function(){
  try{
    const t = JSON.parse(fs.readFileSync('server/test/evidence2.json','utf8'));
    const testData = { evidence_text: t.evidenceData, contract_text: 'GENERIC CONTRACT FOR TESTING', dispute_id: 'server/test/evidence2.json' };
    console.log('Running full pipeline...');
    const res = await processV7ArbitrationWithOllama(testData);
    console.log('\n--- PIPELINE RESULT ---');
    console.log(res);

    console.log('\nCalling callOllama directly for raw response...');
    const raw = await callOllama(`EVIDENCE:\n${testData.evidence_text}\nCONTRACT:\n${testData.contract_text}\nDISPUTE_ID: ${testData.dispute_id}\n\nPlease provide VERDICT, RATIONALE, CONFIDENCE, REIMBURSEMENT.`,200000,false,400);
    console.log('LLM raw response (first 1200 chars):\n', raw.response.slice(0,1200));

    const validated = validateResponse(raw.response);
    console.log('\nValidated LLM parse:', validated);

    const nlp = nlpVerdictMapping({ evidence_text: testData.evidence_text, rationale: validated && validated.valid ? validated.rationale : raw.response });
    console.log('\nNLP mapping result:', nlp);
  }catch(err){
    console.error(err);
    process.exit(1);
  }
})();
