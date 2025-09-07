#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

/*
Unified HTTP smoke + batch tester for the deployed (or local) AI Worker endpoint.

Features:
  --single            Run a single quick smoke request (no archetype file needed)
  --file <path>       JSON file with archetype scenarios (default test/data/nda_archetypes.json)
  --url <endpoint>    Endpoint URL (falls back to AI_ENDPOINT_URL env)
  --key <apiKey>      Bearer API key (AI_API_KEY env)
  --limit <N>         Restrict number of batch cases
  --delay <ms>        Delay between batch requests (default 150)
  --debug             Print full JSON responses

Exit codes:
  0 success
  2 if any HTTP error (>=400) or network error occurred
*/

function parseArgs(){
  const a=process.argv; const opts={ single:false, file:'test/data/nda_archetypes.json', url:process.env.AI_ENDPOINT_URL||'', key:process.env.AI_API_KEY||'', limit:null, delay:150, debug:false };
  for(let i=2;i<a.length;i++){
    const k=a[i];
    if(k==='--single') opts.single=true; else
    if(k==='--file'&&a[i+1]) opts.file=a[++i]; else
    if(k==='--url'&&a[i+1]) opts.url=a[++i]; else
    if(k==='--key'&&a[i+1]) opts.key=a[++i]; else
    if(k==='--limit'&&a[i+1]) opts.limit=parseInt(a[++i],10); else
    if(k==='--delay'&&a[i+1]) opts.delay=parseInt(a[++i],10); else
    if(k==='--debug') opts.debug=true;
  }
  return opts;
}

function toWei(ethStr){
  const [whole, frac=''] = ethStr.split('.');
  const fracPad=(frac+'000000000000000000').slice(0,18);
  return (BigInt(whole)*10n**18n)+BigInt(fracPad);
}

function mapParty(letter){
  const ch=(letter||'a').toUpperCase();
  if(ch==='A') return '0x'+('a'.repeat(40));
  if(ch==='B') return '0x'+('b'.repeat(40));
  if(ch==='C') return '0x'+('c'.repeat(40));
  return '0x'+('d'.repeat(40));
}

async function runSingle(url,key){
  const reporter='0x'+('1'.repeat(40));
  const offender='0x'+('2'.repeat(40));
  const body={ reporter, offender, requestedPenaltyWei:(5n*10n**17n).toString(), evidenceHash:'0xsmoke', evidenceText:'Smoke roadmap milestone releasePlan' };
  const headers={'Content-Type':'application/json'}; if(key) headers.Authorization=`Bearer ${key}`;
  const started=Date.now();
  const res=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)});
  const txt=await res.text();
  let parsed=null; try{ parsed=JSON.parse(txt);}catch{}
  console.log(`[SINGLE] HTTP ${res.status} ${Date.now()-started}ms raw=${txt}`);
  if(parsed){ console.log('[SINGLE] parsed:', parsed); }
  if(!res.ok) return 2; return 0;
}

async function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function runCase(idx,c,url,key){
  const body={ reporter:mapParty(c.reporter), offender:mapParty(c.offender), requestedPenaltyWei:toWei(c.requestedEth).toString(), evidenceHash:c.evidence, evidenceText:c.evidence };
  const headers={'Content-Type':'application/json'}; if(key) headers.Authorization=`Bearer ${key}`;
  let status=0,raw='',parsed=null,error=null; const started=Date.now();
  try{ const res=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)}); status=res.status; raw=await res.text(); try{ parsed=JSON.parse(raw);}catch{} }catch(e){ error=e; }
  return { idx, name:c.name, requestedEth:c.requestedEth, status, raw, parsed, ms:Date.now()-started, error };
}

function summarize(results){
  const ok=results.filter(r=>r.parsed);
  const approvals=ok.filter(r=>r.parsed.approve).length;
  return { total:results.length, ok:ok.length, approvals };
}

async function runBatch(url,key,file,limit,delayMs,debug){
  const full=path.resolve(file);
  if(!fs.existsSync(full)){ console.error('File not found', full); return 2; }
  const data=JSON.parse(fs.readFileSync(full,'utf8'));
  if(!Array.isArray(data)||data.length===0){ console.error('Empty cases file'); return 2; }
  const cases=limit?data.slice(0,limit):data;
  console.log(`Running ${cases.length} cases -> ${url}`);
  const results=[];
  for(let i=0;i<cases.length;i++){
    const r=await runCase(i,cases[i],url,key); results.push(r);
    const base=`[${i+1}/${cases.length}] ${r.name} -> HTTP ${r.status} ${r.ms}ms`;
    if(r.error) console.log(base,'ERROR',r.error.message); else if(!r.parsed) console.log(base,'NO_JSON'); else console.log(base,`penaltyWei=${r.parsed.penaltyWei} approve=${r.parsed.approve} classification=${r.parsed.classification}`);
    if(debug && r.parsed) console.log('  full:', r.parsed);
    if(delayMs && i<cases.length-1) await delay(delayMs);
  }
  const summary=summarize(results);
  console.log('\nSummary:', summary);
  const failed=results.filter(r=>r.status>=400||r.error);
  return failed.length?2:0;
}

async function main(){
  const {single,url,key,file,limit,delay,debug}=parseArgs();
  if(!url){ console.error('Missing --url or AI_ENDPOINT_URL'); process.exit(1); }
  let code=0;
  if(single){ code=await runSingle(url,key); }
  else { code=await runBatch(url,key,file,limit,delay,debug); }
  process.exit(code);
}

main().catch(e=>{ console.error(e); process.exit(1); });
