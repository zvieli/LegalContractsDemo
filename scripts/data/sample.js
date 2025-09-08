#!/usr/bin/env node
// Sample N per classification
import fs from 'fs';
const file=process.argv[2];
const n=parseInt(process.argv[3]||'2',10);
if(!file){ console.error('Usage: sample.js <file.jsonl> [nPerClass]'); process.exit(1);} 
const lines=fs.readFileSync(file,'utf8').trim().split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l));
const buckets={};
for(const o of lines){ const c=o.classification||'__none'; (buckets[c]=buckets[c]||[]).push(o); }
for(const [c,arr] of Object.entries(buckets)){
  const shuffled=[...arr].sort(()=>Math.random()-0.5).slice(0,n);
  for(const o of shuffled) process.stdout.write(JSON.stringify(o)+'\n');
}
