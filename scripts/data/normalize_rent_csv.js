#!/usr/bin/env node
/**
 * normalize_rent_csv.js
 * Convert raw rent CSV-ingested NDJSON -> internal RENT schema records.
 */
import fs from 'fs';
import crypto from 'crypto';

const file = process.argv[2];
if(!file){ console.error('Usage: normalize_rent_csv.js <converted.jsonl>'); process.exit(1);} 
const lines = fs.readFileSync(file,'utf8').trim().split(/\r?\n/).filter(Boolean);
function toWeiHex(eth){ const v = Number(eth||0); const wei = BigInt(Math.floor(v*1e18)); return '0x'+wei.toString(16); }
for(const l of lines){
  let o; try { o = JSON.parse(l);} catch { continue; }
  const text = (o.text||'').slice(0,6000);
  const record = {
    id: o.id || crypto.randomUUID(),
    domain: 'RENT',
    source: 'csv_local',
    jurisdiction: 'unknown',
    retrievedAt: new Date().toISOString(),
    synthetic: false,
    disputeType: (o.disputeType||'Quality'),
    classification: 'unclassified',
    rationale: '',
    claimedWei: toWeiHex(o.claimedEth),
    awardedWei: toWeiHex(o.awardedEth),
    severity: Number(o.severity||1),
    evidenceURIs: [],
    evidenceHash: null,
    originalTextHash: '0x'+crypto.createHash('sha256').update(text).digest('hex'),
    text
  };
  process.stdout.write(JSON.stringify(record)+'\n');
}
