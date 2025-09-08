#!/usr/bin/env node
/**
 * pipeline_nda.js
 * End-to-end NDA data pipeline (fetch -> normalize -> label -> stats)
 * Usage: node scripts/data/pipeline_nda.js "search phrase" 40
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const search = process.argv[2];
const limit = process.argv[3] || '50';
if(!search){
  console.error('Usage: pipeline_nda.js <search phrase> [limit]');
  process.exit(1);
}

const root = process.cwd();
const rawDir = path.join(root,'data','raw','nda');
const processedDir = path.join(root,'data','processed');
if(!fs.existsSync(rawDir)) fs.mkdirSync(rawDir,{recursive:true});
if(!fs.existsSync(processedDir)) fs.mkdirSync(processedDir,{recursive:true});

const rawPath = path.join(rawDir,'courtlistener.jsonl');
const normalizedPath = path.join(processedDir,'nda_normalized.jsonl');
const labeledPath = path.join(processedDir,'nda_labeled.jsonl');

function runNode(script, args, options={}){
  return new Promise((resolve,reject)=>{
    const ps = spawn(process.execPath, [script, ...args], { stdio:['ignore','pipe','pipe'], ...options });
    let out=''; let err='';
    ps.stdout.on('data',d=>{ out+=d; });
    ps.stderr.on('data',d=>{ err+=d; });
    ps.on('close',code=>{ if(code!==0) reject(new Error(script+' exit '+code+' '+err)); else resolve({out,err}); });
  });
}

(async()=>{
  console.error('▶ Fetch phase');
  const fetchScript = path.join(root,'scripts','data','fetch_courtlistener_nda.js');
  const fetchRes = await runNode(fetchScript, [search, limit]);
  fs.writeFileSync(rawPath, fetchRes.out);
  console.error('Fetched lines:', fetchRes.out.split(/\n/).filter(Boolean).length);

  console.error('▶ Normalize phase');
  const normScript = path.join(root,'scripts','data','normalize_courtlistener_nda.js');
  const normRes = await runNode(normScript, [rawPath]);
  fs.writeFileSync(normalizedPath, normRes.out);
  console.error('Normalized lines:', normRes.out.split(/\n/).filter(Boolean).length);

  console.error('▶ Label phase (Gemini)');
  const labelScript = path.join(root,'scripts','data','label_gemini.js');
  const labelRes = await runNode(labelScript, [normalizedPath, 'NDA']);
  fs.writeFileSync(labeledPath, labelRes.out);
  console.error('Labeled lines:', labelRes.out.split(/\n/).filter(Boolean).length);

  console.error('▶ Stats');
  const statsScript = path.join(root,'scripts','data','stats.js');
  const statsRes = await runNode(statsScript, [labeledPath]);
  console.error('Stats:', statsRes.out.trim());

  console.log('PIPELINE_OK');
})().catch(e=>{ console.error('PIPELINE_FAIL', e.message); process.exit(1); });
