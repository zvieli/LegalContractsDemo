#!/usr/bin/env node
/**
 * normalize_courtlistener_nda.js
 * Convert raw CourtListener opinion JSON lines -> internal NDA schema lines.
 * Input: raw NDJSON (each is an opinion object as emitted by fetch_courtlistener_nda.js)
 * Output: NDA records conforming (mostly) to nda.schema.json (missing classification/rationale until labeling).
 */
import fs from 'fs';
import crypto from 'crypto';
import { createHash } from 'crypto';

const file = process.argv[2];
if(!file){
  console.error('Usage: normalize_courtlistener_nda.js <raw.jsonl>');
  process.exit(1);
}
const text = fs.readFileSync(file,'utf8').trim();
if(!text){ process.exit(0);} 
const lines = text.split(/\r?\n/).filter(Boolean);

function toHexWei(v){ return '0x'+BigInt(0).toString(16); } // placeholder all zero for now

for(const l of lines){
  let raw; try { raw = JSON.parse(l);} catch(e){ continue; }
  const fullText = raw.plain_text || raw.html_with_citations || raw.html_lawbox || '';
  const truncated = fullText.slice(0,8000);
  const evidenceURIs = [];
  if(raw.absolute_url){ evidenceURIs.push('https://www.courtlistener.com'+raw.absolute_url); }
  const id = raw.id ? String(raw.id) : crypto.randomUUID();
  const originalHash = truncated ? '0x'+createHash('sha256').update(truncated).digest('hex') : null;
  const obj = {
    id,
    domain: 'NDA',
    source: 'courtlistener',
    jurisdiction: (raw.jurisdiction || raw.court || {}).slug || 'unknown',
    retrievedAt: raw.date_filed ? new Date(raw.date_filed).toISOString() : new Date().toISOString(),
    synthetic: false,
    classification: raw.classification || 'unclassified',
    rationale: '',
    labels: [],
    claimedWei: toHexWei(0),
    awardedWei: toHexWei(0),
    severity: 1,
    evidenceURIs,
    evidenceHash: null,
    originalTextHash: originalHash,
    text: truncated
  };
  process.stdout.write(JSON.stringify(obj)+'\n');
}
