#!/usr/bin/env node
import 'dotenv/config';

// Simple script to POST a sample arbitration request to the AI endpoint (local dev or deployed)
// Usage examples:
//   node scripts/test-ai-endpoint.js --url http://127.0.0.1:8787
//   npm run ai:test -- --url https://nda-ai-endpoint.<sub>.workers.dev

import { argv } from 'node:process';

function parseArgs() {
  const out = { url: process.env.AI_ENDPOINT_URL || '', key: process.env.AI_API_KEY || '' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--url' && argv[i + 1]) out.url = argv[++i];
    else if (argv[i] === '--key' && argv[i + 1]) out.key = argv[++i];
  }
  return out;
}

function randomHexAddress(seed) {
  // Not cryptographically secure, just a deterministic-looking pseudo address
  const base = Buffer.from(seed.toString()).toString('hex').padEnd(40, '0').slice(0,40);
  return '0x' + base;
}

async function main() {
  const { url, key } = parseArgs();
  if (!url) {
    console.error('Missing --url or AI_ENDPOINT_URL env');
    process.exit(1);
  }

  const reporter = randomHexAddress(Date.now());
  const offender = randomHexAddress(Date.now() + 1);

  const body = {
    reporter,
    offender,
    requestedPenaltyWei: (10n ** 18n).toString(),
    evidenceHash: '0xabc123',
    evidenceText: 'Demo test evidence'
  };

  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['Authorization'] = `Bearer ${key}`;

  console.log('POST', url, 'body=', body);
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { /* ignore */ }
  console.log('Status:', res.status);
  console.log('Raw:', text);
  if (parsed) {
    console.log('Parsed decision:', parsed);
  } else {
    console.log('Could not parse JSON response.');
  }
  if (!res.ok) process.exit(2);
}

main().catch(e => { console.error(e); process.exit(1); });
