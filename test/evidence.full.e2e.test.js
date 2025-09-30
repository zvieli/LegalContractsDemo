import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import EthCrypto from 'eth-crypto';
import crypto from 'crypto';

describe('Evidence full E2E (server -> storage -> CLI/frontend)', function() {
  this.timeout(20000);
  let server = null;
  let ep = null;
  const staticDir = path.join(process.cwd(), 'front','e2e','static');
  let id = null;

  before(async () => {
    id = EthCrypto.createIdentity();
    process.env.ADMIN_PUBLIC_KEY = id.publicKey.startsWith('0x') ? id.publicKey.slice(2) : id.publicKey;
    process.env.ADMIN_PRIVATE_KEY = id.privateKey;
    try {
      const ethers = await import('ethers');
      const w = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY);
      process.env.ADMIN_ADDRESS = w.address;
    } catch (e) {}
    process.env.TESTING = '1';
    ep = await import('../tools/evidence-endpoint.js').catch(() => null);
    server = await (ep && ep.startEvidenceEndpoint ? ep.startEvidenceEndpoint(0, staticDir, process.env.ADMIN_PUBLIC_KEY) : null);
    if (server) {
      const addr = server.address();
      this.port = addr.port;
    }
  });

  after(async () => {
    try { if (ep && ep.stopEvidenceEndpoint) await ep.stopEvidenceEndpoint(server); } catch (e) {}
  });

  it('creates envelope and both CLI and client decryptors can read it', async () => {
    const base = `http://127.0.0.1:${this.port}`;
    const payload = { verdict: 'ok', ts: Date.now(), note: 'full-e2e' };
    const { keccak256, toUtf8Bytes } = await import('ethers').then(m => m.utils || m);
    const body = { digest: keccak256(toUtf8Bytes(JSON.stringify(payload))), type: 'rationale', content: JSON.stringify(payload) };
    const fetch = await getFetch();
    const res = await fetch(base + '/submit-evidence', { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    assert.ok(j && j.digest);

    await new Promise(r => setTimeout(r, 200));
    const idxPath = path.join(process.cwd(), 'evidence_storage', 'index.json');
    assert.ok(fs.existsSync(idxPath));
    const idx = JSON.parse(fs.readFileSync(idxPath,'utf8'));
    const entry = idx.entries.find(e => e.digest === j.digest);
    assert.ok(entry);

    const files = fs.readdirSync(path.join(process.cwd(), 'evidence_storage')).filter(f => f.endsWith(`-${j.digest.replace(/^0x/,'')}.json`));
    assert.ok(files.length > 0);
    const file = files[0];

    const adminKey = process.env.ADMIN_PRIVATE_KEY;
    // CLI decrypt
    const script = path.join(process.cwd(), 'tools', 'admin', 'decryptEvidence.js');
    const out = spawnSync(process.execPath, [script, path.join('evidence_storage', file), '--privkey', adminKey], { encoding: 'utf8' });
    if (out.status !== 0) console.error('CLI decrypt stderr:', out.stderr);
    assert.strictEqual(out.status, 0);
    assert.ok(out.stdout.includes('Decrypted JSON content'));

    // client-side in-process decrypt using front helper (imported ESM)
    const clientDecrypt = await import('../front/src/utils/clientDecrypt.js').catch(() => null);
    const fn = clientDecrypt && (clientDecrypt.decryptEnvelopeWithPrivateKey || clientDecrypt.default && clientDecrypt.default.decryptEnvelopeWithPrivateKey);
    if (!fn) throw new Error('client decrypt function not found');
    const envRaw = fs.readFileSync(path.join(process.cwd(), 'evidence_storage', file), 'utf8');
    const envObj = JSON.parse(envRaw);
    const decoded = await fn(envObj, adminKey);
    assert.strictEqual(decoded.verdict, payload.verdict);
  });
});

async function getFetch() {
  if (typeof globalThis !== 'undefined' && globalThis.fetch) return globalThis.fetch;
  try {
    const nf = await import('node-fetch');
    return nf && (nf.default || nf);
  } catch (e) {
    throw new Error('fetch not available; install node-fetch or run on Node 18+');
  }
}
