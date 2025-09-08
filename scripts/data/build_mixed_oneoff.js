#!/usr/bin/env node
/**
 * build_mixed_oneoff.js
 * Merge NDA + RENT labeled sets into one evaluation / sample file with ratio.
 * Usage: node scripts/data/build_mixed_oneoff.js 0.6 > mixed.jsonl  (0.6 = 60% NDA)
 */
import fs from 'fs';
import path from 'path';

const ratio = parseFloat(process.argv[2]||'0.6');
if(isNaN(ratio) || ratio<=0 || ratio>=1){ console.error('Ratio must be between 0 and 1 (e.g., 0.6)'); process.exit(1);} 
const root = process.cwd();
const ndaPath = path.join(root,'data','processed','nda_labeled.jsonl');
const rentPath = path.join(root,'data','processed','rent_labeled.jsonl');
if(!fs.existsSync(ndaPath) || !fs.existsSync(rentPath)){ console.error('Need both nda_labeled.jsonl and rent_labeled.jsonl'); process.exit(1);} 

function read(file){ return fs.readFileSync(file,'utf8').trim().split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l)); }
const nda = read(ndaPath); const rent = read(rentPath);
const totalTarget = Math.min(nda.length + rent.length, Math.floor(nda.length/ratio));
// compute counts respecting available sizes
let wantedNda = Math.min(nda.length, Math.floor(totalTarget*ratio));
let wantedRent = Math.min(rent.length, totalTarget - wantedNda);
// if we under-filled rent because not enough NDA, adjust
if(wantedRent > rent.length){ wantedRent = rent.length; }
if(wantedNda > nda.length){ wantedNda = nda.length; }
// slice
const pickNda = nda.slice(0, wantedNda);
const pickRent = rent.slice(0, wantedRent);
const merged = [...pickNda, ...pickRent];
// shuffle simple
for(let i=merged.length-1;i>0;i--){ const j=Math.floor(Math.random()* (i+1)); [merged[i],merged[j]]=[merged[j],merged[i]]; }
for(const r of merged){ process.stdout.write(JSON.stringify(r)+'\n'); }
console.error(`Mixed set -> NDA=${pickNda.length} RENT=${pickRent.length} total=${merged.length} ratioTarget=${ratio}`);
