import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const adminKeyPath = path.resolve(path.join(__dirname, '..', '..', 'admin.key'));
  if (!fs.existsSync(adminKeyPath)) {
    console.error('admin.key not found at', adminKeyPath);
    process.exit(2);
  }
  let adminPriv = fs.readFileSync(adminKeyPath, 'utf8').trim();
  if (!adminPriv.startsWith('0x')) adminPriv = '0x' + adminPriv;

  // Use built-in fetch (Node 18+) or node-fetch if missing
  let fetchFn = globalThis.fetch;
  if (!fetchFn) {
    try { const nf = await import('node-fetch'); fetchFn = nf && (nf.default || nf); } catch (e) { console.error('fetch not available'); process.exit(3); }
  }

  const payload = { verdict: 'smoke-ok', ts: Date.now(), note: 'smoke-test-production' };
  const ethers = await import('ethers');
  const digest = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(payload)));

  const body = { digest, type: 'rationale', content: JSON.stringify(payload) };
  const base = 'http://127.0.0.1:5001';
  console.log('Submitting evidence to', base + '/submit-evidence');
  const res = await fetchFn(base + '/submit-evidence', { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify(body) });
  const j = await res.json();
  if (!j || !j.digest) {
    console.error('submit failed', j);
    process.exit(4);
  }
  console.log('Submitted, digest=', j.digest);

  // wait a moment and fetch envelope
  await new Promise(r => setTimeout(r, 300));
  const fetchEnv = await fetchFn(base + '/evidence/' + j.digest.replace(/^0x/, ''));
  const envResp = await fetchEnv.json();
  if (!envResp || !envResp.envelope) {
    console.error('failed to fetch envelope', envResp);
    process.exit(5);
  }
  const envelope = envResp.envelope;
  console.log('Fetched envelope, recipients=', (envelope.recipients || []).map(r => r.address));

  // import client decrypt helper
  const clientDecrypt = await import('../../front/src/utils/clientDecrypt.js').catch(err => { console.error('failed to import clientDecrypt', err && err.message); return null; });
  const fn = clientDecrypt && (clientDecrypt.decryptEnvelopeWithPrivateKey || (clientDecrypt.default && clientDecrypt.default.decryptEnvelopeWithPrivateKey));
  if (!fn) {
    console.error('client decrypt function not found');
    process.exit(6);
  }
  try {
    const decoded = await fn(envelope, adminPriv);
    console.log('Decrypted result:', decoded);
    process.exit(0);
  } catch (e) {
    console.error('client decrypt failed:', e && e.message ? e.message : e);
    process.exit(7);
  }
}

main().catch(e => { console.error('smoke script error', e && e.stack ? e.stack : e); process.exit(11); });
