#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

// Batch runner: invokes Worker module directly over all NDA archetypes

const archetypesPath = path.join(process.cwd(), 'test', 'data', 'nda_archetypes.json');
const scenarios = JSON.parse(fs.readFileSync(archetypesPath, 'utf8'));
const mod = await import(pathToFileURL(path.join(process.cwd(), 'server', 'src', 'index.js')).href);
const worker = mod.default;

function toWeiStr(ethStr){ return (BigInt(Math.round(parseFloat(ethStr)*1e6)) * 10n**12n).toString(); }

const results = [];
for (const sc of scenarios) {
  const body = {
    reporter: '0x1111111111111111111111111111111111111111',
    offender: '0x2222222222222222222222222222222222222222',
    requestedPenaltyWei: toWeiStr(sc.requestedEth),
    evidenceText: sc.evidence,
    evidenceHash: sc.evidence
  };
  const req = new Request('https://batch.local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const resp = await worker.fetch(req, {});
  const json = await resp.json();
  results.push({ name: sc.name, requestedEth: sc.requestedEth, ...json });
}

console.log('\nAI Worker Batch Results:\n');
for (const r of results) {
  console.log(`${r.name}\n  requestedEth=${r.requestedEth} approve=${r.approve} classification=${r.classification} penaltyWei=${r.penaltyWei}\n  rationale=${r.rationale}`);
}

// Basic summary
const approvals = results.filter(r=>r.approve).length;
console.log(`\nSummary: ${approvals}/${results.length} approved`);
