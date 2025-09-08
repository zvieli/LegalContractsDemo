#!/usr/bin/env node
/**
 * build_eval_nda.js
 * Create evaluation JSONL for AI endpoint from labeled NDA dataset.
 * Each record -> minimal fields expected by eval_worker + expectedClassification.
 */
import fs from 'fs';
import crypto from 'crypto';

const file = process.argv[2];
if(!file){ console.error('Usage: build_eval_nda.js <labeled.jsonl>'); process.exit(1);} 
const lines = fs.readFileSync(file,'utf8').trim().split(/\r?\n/).filter(Boolean);
for(const l of lines){
  let o; try { o = JSON.parse(l);} catch { continue; }
  const evidenceText = (o.text || '').slice(0,1500);
  const evidenceHash = '0x'+crypto.createHash('sha256').update(evidenceText).digest('hex');
  const rec = {
    reporter: '0x'+('a'.repeat(40)),
    offender: '0x'+('b'.repeat(40)),
    requestedPenaltyWei: '50000000000000000',
    evidenceHash,
    evidenceText,
    domain: 'NDA',
    expectedClassification: o.classification || 'unclassified'
  };
  process.stdout.write(JSON.stringify(rec)+'\n');
}
