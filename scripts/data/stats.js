#!/usr/bin/env node
// Compute dataset stats
import fs from 'fs';
const file = process.argv[2];
if(!file){ console.error('Usage: stats.js <file.jsonl>'); process.exit(1);} 
const lines = fs.readFileSync(file,'utf8').trim().split(/\r?\n/);
const counts={classification:{},severity:{},disputeType:{}};
let total=0;
for(const l of lines){ if(!l.trim()) continue; const o=JSON.parse(l); total++; if(o.classification) counts.classification[o.classification]=(counts.classification[o.classification]||0)+1; if(o.severity) counts.severity[o.severity]=(counts.severity[o.severity]||0)+1; if(o.disputeType) counts.disputeType[o.disputeType]=(counts.disputeType[o.disputeType]||0)+1; }
console.log(JSON.stringify({ total, ...counts }, null, 2));
