#!/usr/bin/env node
// smoke-check.js
// Simple Node script using global fetch to check V7 endpoints and local IPFS API.
// Node 18+ required (global fetch available).

const base = process.env.V7_URL || 'http://localhost:3001';
const ipfs = process.env.IPFS_URL || 'http://127.0.0.1:5001';

async function check(url, opts = {}) {
  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: tryParse(text) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function tryParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}

async function run() {
  console.log('Checking V7 endpoints at', base);
  console.log('1) /api/v7/arbitration/health');
  console.log(await check(`${base}/api/v7/arbitration/health`));

  console.log('\n2) /api/v7/modules');
  console.log(await check(`${base}/api/v7/modules`));

  console.log('\n3) /api/v7/ccip/status');
  console.log(await check(`${base}/api/v7/ccip/status`));

  console.log('\n4) Helia /api/v0/version (POST)');
  console.log(await check(`${base}/api/v7/modules`, { method: 'GET' }));

  console.log('\nDone');
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
