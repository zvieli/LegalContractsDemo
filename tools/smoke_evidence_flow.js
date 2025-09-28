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
