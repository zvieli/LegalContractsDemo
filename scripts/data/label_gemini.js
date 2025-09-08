#!/usr/bin/env node
import 'dotenv/config';
// Label unlabeled NDA or RENT records using Gemini (zero-shot) without training.
// Usage: node scripts/data/label_gemini.js <input.jsonl> <domain:NDA|RENT> > labeled.jsonl
import fs from 'fs';

const file = process.argv[2];
const domain = (process.argv[3]||'').toUpperCase();
if(!file || !['NDA','RENT'].includes(domain)){
  console.error('Usage: label_gemini.js <input.jsonl> <NDA|RENT>');
  process.exit(1);
}
const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
if(!apiKey){
  console.error('GEMINI_API_KEY missing');
  process.exit(1);
}

async function callGemini(prompt){
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
  const body = { contents:[{ role:'user', parts:[{text: prompt}]}], generationConfig:{temperature:0.2, maxOutputTokens:200}};
  const r = await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok) return null;
  const data = await r.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const cleaned = text.replace(/```json/gi,'').replace(/```/g,'').trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

const lines = fs.readFileSync(file,'utf8').trim().split(/\r?\n/);
let idx=0;
for(const line of lines){
  if(!line.trim()) continue;
  const obj = JSON.parse(line);
  const already = obj.classification && obj.rationale;
  if(already){ process.stdout.write(JSON.stringify(obj)+'\n'); continue; }
  const baseText = (obj.text || obj.summary || obj.evidenceText || obj.evidenceHash || '').slice(0,4000);
  let taxonomy, instruction;
  if(domain==='NDA'){
    taxonomy = 'source_code, financial_forecast, customer_data, roadmap, investor_material, generic';
    instruction = 'Classify the NDA breach content into one category.';
  } else {
    taxonomy = 'damage, conditionStart, conditionEnd, quality, earlyTerminationJustCause, depositSplit, externalValuation, generic';
    instruction = 'Classify the rent dispute (use generic if uncertain).';
  }
  const prompt = `You are a compliance classifier. Return ONLY compact JSON {classification: string, rationale: string<=180}. Domain=${domain}. Allowed classification values: [${taxonomy}]. If ambiguous pick the closest. Text: ${baseText}`;
  let resp=null; try { resp = await callGemini(prompt); } catch {}
  if(resp && typeof resp.classification==='string'){
    obj.classification = resp.classification.slice(0,64);
    obj.rationale = (resp.rationale||'').slice(0,256);
    obj.synthetic = !!obj.synthetic; // keep flag if present
  }
  process.stdout.write(JSON.stringify(obj)+'\n');
  // basic rate pacing
  await new Promise(r=>setTimeout(r, 300));
  if(++idx % 25 === 0) console.error('Labeled', idx);
}
