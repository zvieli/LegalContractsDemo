#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { Wallet, ethers } from 'ethers';

function canonicalize(obj) {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(e => canonicalize(e)).join(',') + ']';
  const keys = Object.keys(obj).sort();
  const parts = [];
  for (const k of keys) {
    parts.push(JSON.stringify(k) + ':' + canonicalize(obj[k]));
  }
  return '{' + parts.join(',') + '}';
}

function findAccount18PrivateKey(walletsPath) {
  const txt = fs.readFileSync(walletsPath, 'utf8');
  const m = txt.match(/Account18\s*:\s*([0-9a-fxA-F]+)[\s\S]*?Private Key:\s*(0x[0-9a-fA-F]+)/);
  if (m && m[2]) return m[2].trim();
  // fallback: try to find the address line then next 'Private Key' occurrence
  const lines = txt.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes('account18')) {
      for (let j = i; j < Math.min(lines.length, i + 6); j++) {
        const mk = lines[j].match(/Private Key:\s*(0x[0-9a-fA-F]+)/);
        if (mk) return mk[1];
      }
    }
  }
  return null;
}

async function main() {
  const collectPath = process.argv[2];
  const evidenceCid = process.argv[3];
  if (!collectPath || !evidenceCid) {
    console.error('Usage: node scripts/submitCombinedEvidence.js <path-to-collect-json> <existing-evidence-cid>');
    process.exit(2);
  }

  const collectAbs = path.resolve(collectPath);
  if (!fs.existsSync(collectAbs)) {
    console.error('collect file not found:', collectAbs);
    process.exit(1);
  }

  const collectRaw = fs.readFileSync(collectAbs, 'utf8');
  let fullHistory = null;
  try { fullHistory = JSON.parse(collectRaw); } catch (e) { console.error('collect file is not valid JSON'); process.exit(1); }

  // Fetch existing evidence payload from backend
  const cid = String(evidenceCid).replace(/^helia:\/\//i, '');
  const url = `http://localhost:3001/api/evidence/retrieve/${cid}`;
  console.log('Fetching existing evidence payload from', url);
  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text();
    console.error('Failed to fetch existing evidence:', r.status, txt);
    process.exit(1);
  }
  const txt = await r.text();
  let parsed = null;
  try { parsed = JSON.parse(txt); } catch (e) { console.error('Existing evidence response not JSON'); process.exit(1); }

  // Support envelope that includes plaintext.payload
  let basePayload = null;
  if (parsed && parsed.plaintext && parsed.plaintext.payload) basePayload = parsed.plaintext.payload;
  else if (parsed && parsed.payload) basePayload = parsed.payload;
  else if (parsed && typeof parsed === 'object') basePayload = parsed;
  else {
    console.error('Cannot locate base payload in fetched evidence');
    process.exit(1);
  }

  const combined = {
    contractAddress: basePayload.contractAddress,
    contractType: basePayload.contractType || 'rental',
    plaintiff: basePayload.plaintiff,
    defendant: basePayload.defendant || basePayload.defendantAddress || null,
    txHistory: fullHistory,
    complaint: basePayload.complaint || '',
    requestedAmount: basePayload.requestedAmount || null
  };

  const canonStr = canonicalize(combined);

  // Find local private key for Account18 in WALLETS.txt
  const walletsPath = path.resolve('WALLETS.txt');
  if (!fs.existsSync(walletsPath)) {
    console.error('WALLETS.txt not found in repo root; please provide a signer private key manually');
    process.exit(1);
  }
  const pk = findAccount18PrivateKey(walletsPath);
  if (!pk) {
    console.error('Failed to find Account18 private key in WALLETS.txt');
    process.exit(1);
  }

  const wallet = new Wallet(pk);
  console.log('Signing as', wallet.address);
  const signature = await wallet.signMessage(canonStr);

  // Post to server
  const submitUrl = 'http://localhost:3001/api/submit-appeal';
  const body = {
    contractAddress: combined.contractAddress,
    signedPayload: canonStr,
    signature,
    signerAddress: wallet.address,
    encryptToAdmin: false
  };
  console.log('Posting combined signed payload to', submitUrl);
  const res = await fetch(submitUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.text();
  console.log('STATUS', res.status);
  try { console.log(JSON.stringify(JSON.parse(out), null, 2)); } catch (e) { console.log(out); }
}

main().catch(e => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
