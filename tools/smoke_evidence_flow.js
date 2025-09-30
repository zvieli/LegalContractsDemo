#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

async function main() {
  const fetchMod = await import('node-fetch').catch(() => null);
  const fetch = globalThis.fetch || (fetchMod && fetchMod.default) || null;
  const E = await import('ethers').catch(() => null);
  const ethers = E && E.default ? E.default : E;

  const port = 5001;
  const base = `http://127.0.0.1:${port}`;
  const plaintext = JSON.stringify({ verdict: 'approved', note: 'smoke test evidence', ts: Date.now() });
  const buf = Buffer.from(plaintext, 'utf8');
  const b64 = buf.toString('base64');
  let digest = null;
  try { if (ethers && ethers.hashes && typeof ethers.hashes.keccak256 === 'function') digest = ethers.hashes.keccak256(buf); else if (ethers && typeof ethers.keccak256 === 'function') digest = ethers.keccak256(buf); } catch (e) {}

  console.log('Prepared digest', digest);
  if (!fetch) throw new Error('fetch not available; install node-fetch or run in Node with fetch enabled');

  const res = await fetch(`${base}/submit-evidence`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ciphertext: b64, digest, reporterAddress: null, contractAddress: null, note: 'smoke' }) });
  const j = await res.json().catch(() => null);
  console.log('submit-evidence status', res.status, j);

  // attempt on-chain tx if provider available
  let realTxHash = null;
  try {
    if (!ethers) throw new Error('ethers not available');
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'http://127.0.0.1:8545');
    try {
      const accounts = await provider.send('eth_accounts', []);
      const from = (accounts && accounts[0]) ? accounts[0] : null;
      if (from) {
        const txHash = await provider.send('eth_sendTransaction', [{ from: from, to: from, value: '0x0' }]);
        console.log('Submitted tx via eth_sendTransaction, hash=', txHash);
        await provider.waitForTransaction(txHash, 1, 60000);
        realTxHash = txHash;
      }
    } catch (e) {
      try {
        const signer = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
        const tx = await signer.sendTransaction({ to: signer.address, value: 0 });
        await provider.waitForTransaction(tx.hash, 1, 60000);
        realTxHash = tx.hash;
      } catch (e2) {
        console.warn('Real tx submission failed', e2 && e2.message ? e2.message : e2);
      }
    }
  } catch (e) { console.warn('On-chain attempt skipped:', e && e.message ? e.message : e); }

  const txToRegister = realTxHash || ('0x' + 'a'.repeat(64));
  const reg = await fetch(`${base}/register-dispute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash: txToRegister, digest: j && j.digest ? j.digest : digest, cid: j && j.cid ? j.cid : null }) });
  const regj = await reg.json().catch(() => null);
  console.log('register-dispute status', reg.status, regj);

  const idxPath = path.join(process.cwd(), 'evidence_storage', 'index.json');
  if (fs.existsSync(idxPath)) {
    const raw = fs.readFileSync(idxPath, 'utf8');
    const idx = JSON.parse(raw);
    console.log('Latest index entry:', idx.entries && idx.entries[0]);
  } else {
    console.log('No index.json found at', idxPath);
  }
}

main().catch(e => { console.error('Smoke test failed', e && e.stack ? e.stack : e); process.exit(1); });
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { keccak256 } = require('ethers').utils;

async function main() {
  const port = 5001; // default endpoint started earlier
  const base = `http://127.0.0.1:${port}`;
  const plaintext = JSON.stringify({ verdict: 'approved', note: 'smoke test evidence', ts: Date.now() });
  const buf = Buffer.from(plaintext, 'utf8');
  const b64 = buf.toString('base64');
  const digest = keccak256(buf);
  console.log('Prepared digest', digest);
  // POST submit-evidence
  const res = await fetch(`${base}/submit-evidence`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ciphertext: b64, digest, reporterAddress: null, contractAddress: null, note: 'smoke' }) });
  const j = await res.json().catch(() => null);
  console.log('submit-evidence status', res.status, j);
  if (!j || !j.digest) throw new Error('submit failed');
  // Simulate tx registration
  const fakeTx = '0x' + 'a'.repeat(64);
  const reg = await fetch(`${base}/register-dispute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash: fakeTx, digest: j.digest, cid: j.cid || null }) });
  const regj = await reg.json().catch(() => null);
  console.log('register-dispute status', reg.status, regj);
  // Inspect index.json
  const idxPath = path.join(__dirname, '..', 'evidence_storage', 'index.json');
  if (fs.existsSync(idxPath)) {
    const raw = fs.readFileSync(idxPath, 'utf8');
    const idx = JSON.parse(raw);
    console.log('Latest index entry:', idx.entries && idx.entries[0]);
  } else {
    console.log('No index.json found at', idxPath);
  }
}

main().catch(e => { console.error('Smoke test failed', e && e.stack ? e.stack : e); process.exit(1); });
