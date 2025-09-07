#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

/*
 Batch test against the AI endpoint using NDA archetype cases.
 Default file: test/data/nda_archetypes.json

 Usage:
   node scripts/test-ai-batch.js --url http://127.0.0.1:8787
   npm run ai:test:batch -- --url https://nda-ai-endpoint.<sub>.workers.dev

 Optional flags:
   --file <path>   JSON file of cases (array)
   --key  <apiKey> Authorization bearer key
   --limit <N>     Only run first N cases
   --delay <ms>    Delay between requests (default 150ms)
*/

function parseArgs() {
  const args = { url: process.env.AI_ENDPOINT_URL || '', key: process.env.AI_API_KEY || '', file: 'test/data/nda_archetypes.json', limit: null, delay: 150 };
  const av = process.argv;
  for (let i = 2; i < av.length; i++) {
    const k = av[i];
    if (k === '--url' && av[i+1]) args.url = av[++i];
    else if (k === '--key' && av[i+1]) args.key = av[++i];
    else if (k === '--file' && av[i+1]) args.file = av[++i];
    else if (k === '--limit' && av[i+1]) { args.limit = parseInt(av[++i],10); }
    else if (k === '--delay' && av[i+1]) { args.delay = parseInt(av[++i],10); }
  }
  return args;
}

function toWei(ethStr) {
  // simplistic (no big number library needed for small test values)
  const [whole, frac=''] = ethStr.split('.');
  const fracPadded = (frac + '000000000000000000').slice(0,18);
  return BigInt(whole) * 10n**18n + BigInt(fracPadded);
}

function mapParty(letter) {
  const ch = (letter || 'a').toUpperCase();
  if (ch === 'A') return '0x' + 'a'.repeat(40);
  if (ch === 'B') return '0x' + 'b'.repeat(40);
  if (ch === 'C') return '0x' + 'c'.repeat(40);
  return '0x' + 'd'.repeat(40);
}

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runCase(idx, c, url, key) {
  const body = {
    reporter: mapParty(c.reporter),
    offender: mapParty(c.offender),
    requestedPenaltyWei: toWei(c.requestedEth).toString(),
    evidenceHash: c.evidence,
    evidenceText: c.name
  };
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  const started = Date.now();
  let status=0, raw='', parsed=null, error=null;
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    status = res.status;
    raw = await res.text();
    try { parsed = JSON.parse(raw); } catch {}
  } catch (e) { error = e; }
  const ms = Date.now() - started;
  return { idx, name: c.name, requestedEth: c.requestedEth, status, parsed, raw, ms, error };
}

function summarize(results) {
  const ok = results.filter(r => r.parsed);
  const penalties = ok.map(r => ({ reqEth: parseFloat(r.requestedEth), penWei: r.parsed ? BigInt(r.parsed.penaltyWei || '0') : 0n }));
  const ratios = penalties.map(p => {
    const reqWei = BigInt(Math.round(p.reqEth * 1e18));
    if (reqWei === 0n) return 0;
    return Number((Number(p.penWei) / Number(reqWei)) || 0);
  });
  const avg = ratios.length ? (ratios.reduce((a,b)=>a+b,0)/ratios.length) : 0;
  const approvals = ok.filter(r => r.parsed.approve === true).length;
  return { total: results.length, ok: ok.length, approvals, avgPenaltyRatio: avg };
}

async function main() {
  const { url, key, file, limit, delay: gap } = parseArgs();
  if (!url) { console.error('Missing --url or AI_ENDPOINT_URL'); process.exit(1); }
  const fullPath = path.resolve(file);
  if (!fs.existsSync(fullPath)) { console.error('File not found:', fullPath); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  if (!Array.isArray(data) || data.length === 0) { console.error('File has no cases.'); process.exit(1); }
  const cases = (limit ? data.slice(0, limit) : data);
  console.log(`Running ${cases.length} cases against ${url}`);
  const results = [];
  for (let i=0;i<cases.length;i++) {
    const r = await runCase(i, cases[i], url, key);
    results.push(r);
    const base = `[${i+1}/${cases.length}] ${r.name} -> HTTP ${r.status} ${r.ms}ms`;
    if (r.error) console.log(base, 'ERROR', r.error.message);
    else if (!r.parsed) console.log(base, 'NO_JSON');
    else console.log(base, `penaltyWei=${r.parsed.penaltyWei} approve=${r.parsed.approve}`);
    if (gap && i < cases.length -1) await delay(gap);
  }
  const summary = summarize(results);
  console.log('\nSummary:', summary);
  // Non-zero exit if any request failed status >=400
  const failed = results.filter(r => r.status >= 400 || r.error);
  if (failed.length) {
    console.log(`Failures: ${failed.length}`);
    process.exit(2);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
