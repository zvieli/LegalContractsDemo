import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { processV7ArbitrationWithOllama, callOllama, validateResponse, nlpVerdictMapping } from '../modules/ollamaLLMArbitrator.js';

// Config: enable debug persistence via env var ARBITRATOR_DEBUG=1 or SAVE_DEBUG=1
const SAVE_DEBUG = process.env.ARBITRATOR_DEBUG === '1' || process.env.SAVE_DEBUG === '1';
// Compute debug output directory next to this file: server/test/debug-output
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEBUG_DIR = path.join(__dirname, 'debug-output');

async function runCase(file) {
  const t = JSON.parse(fs.readFileSync(file,'utf8'));
  const testData = { evidence_text: t.evidenceData, contract_text: 'GENERIC CONTRACT FOR TESTING', dispute_id: file };
  console.log('\n===== Running case:', file, '=====');

  // Run main pipeline
  const res = await processV7ArbitrationWithOllama(testData);
  console.log('\n-- PIPELINE RESULT --');
  console.log(res);

  // Also call the LLM directly for debug/inspection
  const raw = await callOllama(`EVIDENCE:\n${testData.evidence_text}\nCONTRACT:\n${testData.contract_text}\nDISPUTE_ID: ${testData.dispute_id}\n\nPlease provide VERDICT, RATIONALE, CONFIDENCE, REIMBURSEMENT.`,200000,false,400);
  console.log('\n-- LLM RAW --\n', (raw && raw.response) ? (raw.response.slice ? raw.response.slice(0,1200) : String(raw.response).slice(0,1200)) : raw);

  // Validate the LLM response
  const validated = validateResponse(raw.response);
  console.log('\n-- VALIDATED --\n', validated);

  // Run NLP mapping based on validated rationale (or raw if validation failed)
  const nlp = nlpVerdictMapping({ evidence_text: testData.evidence_text, rationale: validated && validated.valid ? validated.rationale : raw.response });
  console.log('\n-- NLP MAPPING --\n', nlp);

  // Save debug output if requested
  if (SAVE_DEBUG) {
    try {
      fs.mkdirSync(DEBUG_DIR, { recursive: true });
      const base = path.basename(file).replace(/\.[^.]+$/, '');
      const outPath = path.join(DEBUG_DIR, `${base}.debug.json`);
      const payload = {
        dispute_id: testData.dispute_id,
        pipeline_result: res,
        llm_raw: {
          // avoid persisting huge streams unless requested; include truncated + full if env requested
          raw_truncated: raw && raw.response ? (raw.response.slice ? raw.response.slice(0, 1200) : String(raw.response).slice(0,1200)) : null,
          raw_full_saved: !!process.env.SAVE_FULL_LLM_RAW,
          raw_full: process.env.SAVE_FULL_LLM_RAW === '1' ? raw.response : undefined
        },
        validated,
        nlp
      };
      fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
      console.log('[debug_case] Saved debug output to', outPath);
    } catch (err) {
      console.error('[debug_case] Failed to save debug output:', err);
    }
  }
}

async function main() {
  // CLI: accept file paths as args, otherwise use the two fixtures previously used
  const args = process.argv.slice(2);
  const targets = args.length ? args : ['server/test/evidence9.json', 'server/test/evidence12.json'];
  for (const f of targets) {
    try {
      await runCase(f);
    } catch (e) {
      console.error('[debug_case] Error running case', f, e);
    }
  }
}

// Run
main().catch(e => { console.error(e); process.exit(1); });
