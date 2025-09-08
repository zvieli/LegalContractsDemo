#!/usr/bin/env node
/**
 * csv_rent_ingest.js
 * Convert a simple CSV of rent disputes to NDJSON (loose raw form) before normalization.
 * Expected CSV headers (case-insensitive): id,disputeType,claimedEth,awardedEth,severity,text
 */
import fs from 'fs';

const file = process.argv[2];
if(!file){ console.error('Usage: csv_rent_ingest.js <rent_cases.csv>'); process.exit(1);} 
const raw = fs.readFileSync(file,'utf8');
const [head,...rows] = raw.split(/\r?\n/).filter(Boolean);
const cols = head.split(',').map(c=>c.trim().toLowerCase());
function idx(name){ return cols.indexOf(name); }
for(const r of rows){
  const parts = r.split(',');
  if(parts.length !== cols.length) continue;
  const obj = {
    id: parts[idx('id')] || undefined,
    disputeType: parts[idx('disputetype')] || undefined,
    claimedEth: parts[idx('claimedeth')] || '0',
    awardedEth: parts[idx('awardedeth')] || '0',
    severity: Number(parts[idx('severity')]||1),
    text: parts[idx('text')]||''
  };
  process.stdout.write(JSON.stringify(obj)+'\n');
}
