#!/usr/bin/env node
import 'dotenv/config';
/**
 * pipeline_mixed.js
 * Unified one-shot E2E pipeline: NDA (CourtListener) + RENT (CSV) -> labeled -> mixed 60/40 -> stats.
 * Steps:
 *  1. Fetch NDA (query & limit env-configurable)
 *  2. Normalize NDA
 *  3. Label NDA
 *  4. Ingest RENT CSV (must exist at data/raw/rent/rent_cases.csv)
 *  5. Normalize RENT
 *  6. Label RENT
 *  7. Mix ratio (default 0.6 NDA)
 *  8. Emit summary JSON to stderr + success marker
 *
 * Env overrides:
 *  NDA_QUERY                (default "non-disclosure agreement breach")
 *  NDA_LIMIT                (default 60)
 *  MIX_RATIO                (default 0.6)
 *  RENT_CSV                 (default data/raw/rent/rent_cases.csv)
 *  COURTLISTENER_TOKEN ...  (as before for fetch)
 *
 * Output files:
 *  data/raw/nda/courtlistener.jsonl
 *  data/processed/nda_normalized.jsonl
 *  data/processed/nda_labeled.jsonl
 *  data/raw/rent/converted.jsonl
 *  data/processed/rent_normalized.jsonl
 *  data/processed/rent_labeled.jsonl
 *  data/processed/mixed_oneoff.jsonl
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const ratio = parseFloat(process.env.MIX_RATIO || '0.6');
if(ratio<=0 || ratio>=1){ console.error('Invalid MIX_RATIO; must be between 0 and 1'); process.exit(1);} 

const ndaQuery = process.env.NDA_QUERY || 'non-disclosure agreement breach';
const ndaLimit = process.env.NDA_LIMIT || '60';
const rentCsv = process.env.RENT_CSV || path.join('data','raw','rent','rent_cases.csv');

// paths
const rawNda = path.join(root,'data','raw','nda','courtlistener.jsonl');
const ndaNorm = path.join(root,'data','processed','nda_normalized.jsonl');
const ndaLabeled = path.join(root,'data','processed','nda_labeled.jsonl');
const rentConverted = path.join(root,'data','raw','rent','converted.jsonl');
const rentNorm = path.join(root,'data','processed','rent_normalized.jsonl');
const rentLabeled = path.join(root,'data','processed','rent_labeled.jsonl');
const mixedOut = path.join(root,'data','processed','mixed_oneoff.jsonl');

function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); }
ensureDir(path.dirname(rawNda)); ensureDir(path.dirname(ndaNorm)); ensureDir(path.dirname(rentConverted)); ensureDir(path.dirname(mixedOut));

function run(script, args){
  return new Promise((resolve,reject)=>{
    const ps = spawn(process.execPath, [script, ...args], { stdio:['ignore','pipe','pipe'] });
    let out=''; let err='';
    ps.stdout.on('data',d=>out+=d); ps.stderr.on('data',d=>err+=d);
    ps.on('close',code=>{ if(code!==0) reject(new Error(`${path.basename(script)} exit ${code}: ${err}`)); else resolve({out,err}); });
  });
}

async function main(){
  console.error('▶ NDA fetch');
  const fetchScript = path.join(root,'scripts','data','fetch_courtlistener_nda.js');
  const fetchRes = await run(fetchScript, [ndaQuery, ndaLimit]);
  fs.writeFileSync(rawNda, fetchRes.out);
  const ndaRawCount = fetchRes.out.trim().split(/\n/).filter(Boolean).length;

  console.error('▶ NDA normalize');
  const normScript = path.join(root,'scripts','data','normalize_courtlistener_nda.js');
  const normRes = await run(normScript, [rawNda]);
  fs.writeFileSync(ndaNorm, normRes.out);
  const ndaNormCount = normRes.out.trim().split(/\n/).filter(Boolean).length;

  console.error('▶ NDA label');
  const labelScript = path.join(root,'scripts','data','label_gemini.js');
  let ndaLabCount = 0;
  if(process.env.GEMINI_API_KEY){
    const labelRes = await run(labelScript, [ndaNorm,'NDA']);
    fs.writeFileSync(ndaLabeled, labelRes.out);
    ndaLabCount = labelRes.out.trim().split(/\n/).filter(Boolean).length;
  } else {
    console.error('⚠️  GEMINI_API_KEY missing – using normalized NDA as labeled (unclassified).');
    fs.copyFileSync(ndaNorm, ndaLabeled);
    ndaLabCount = fs.readFileSync(ndaLabeled,'utf8').trim().split(/\n/).filter(Boolean).length;
  }

  if(!fs.existsSync(rentCsv)){
    console.error('⚠️ RENT CSV missing at', rentCsv, '- skipping RENT portion (will mix only NDA).');
  } else {
    console.error('▶ RENT ingest CSV');
    const rentIngest = path.join(root,'scripts','data','csv_rent_ingest.js');
    const ingRes = await run(rentIngest, [rentCsv]);
    fs.writeFileSync(rentConverted, ingRes.out);

    console.error('▶ RENT normalize');
    const rentNormScript = path.join(root,'scripts','data','normalize_rent_csv.js');
    const rentNormRes = await run(rentNormScript, [rentConverted]);
    fs.writeFileSync(rentNorm, rentNormRes.out);

    console.error('▶ RENT label');
    if(process.env.GEMINI_API_KEY){
      const rentLabelRes = await run(labelScript, [rentNorm,'RENT']);
      fs.writeFileSync(rentLabeled, rentLabelRes.out);
    } else {
      console.error('⚠️  GEMINI_API_KEY missing – using normalized RENT as labeled (unclassified).');
      fs.copyFileSync(rentNorm, rentLabeled);
    }
  }

  let ndaSet=[], rentSet=[];
  if(fs.existsSync(ndaLabeled)) ndaSet = fs.readFileSync(ndaLabeled,'utf8').trim().split(/\n/).filter(Boolean).map(l=>JSON.parse(l));
  if(fs.existsSync(rentLabeled)) rentSet = fs.readFileSync(rentLabeled,'utf8').trim().split(/\n/).filter(Boolean).map(l=>JSON.parse(l));

  console.error('▶ Mix');
  if(rentSet.length===0){
    console.error('Only NDA available; writing NDA labeled as mixed.');
    fs.writeFileSync(mixedOut, ndaSet.map(o=>JSON.stringify(o)).join('\n')+'\n');
  } else {
    const totalAvail = ndaSet.length + rentSet.length;
    const targetNda = Math.min(ndaSet.length, Math.round(totalAvail*ratio));
    const targetRent = Math.min(rentSet.length, Math.round(totalAvail*(1-ratio)));
    const pickNda = ndaSet.slice(0, targetNda);
    const pickRent = rentSet.slice(0, targetRent);
    const merged = [...pickNda, ...pickRent];
    for(let i=merged.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [merged[i],merged[j]]=[merged[j],merged[i]]; }
    fs.writeFileSync(mixedOut, merged.map(o=>JSON.stringify(o)).join('\n')+'\n');
    console.error(`Mixed ratio ~${ratio} NDA=${pickNda.length} RENT=${pickRent.length} total=${merged.length}`);
  }

  const summary = {
    ratioRequested: ratio,
    ndaRaw: ndaRawCount,
    ndaNormalized: ndaNormCount,
    ndaLabeled: ndaLabCount,
    rentLabeled: rentSet.length,
    mixedOutput: mixedOut
  };
  console.error('SUMMARY', JSON.stringify(summary,null,2));
  console.log('PIPELINE_MIXED_OK');
}

main().catch(e=>{ console.error('PIPELINE_MIXED_FAIL', e.message); process.exit(1); });
