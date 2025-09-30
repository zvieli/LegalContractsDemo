import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import EthCrypto from 'eth-crypto';
import crypto from 'crypto';

async function getFetch() {
  if (typeof globalThis !== 'undefined' && globalThis.fetch) return globalThis.fetch;
  try {
    const nf = await import('node-fetch');
    return nf && (nf.default || nf);
  } catch (e) {
    throw new Error('fetch not available; install node-fetch or run on Node 18+');
  }
}

let ep = null;

describe('Evidence E2E smoke', function() {
  this.timeout(20000);
  let server = null;
  before(async () => {
    const id = EthCrypto.createIdentity();
    process.env.ADMIN_PUBLIC_KEY = id.publicKey.startsWith('0x') ? id.publicKey.slice(2) : id.publicKey;
    process.env.ADMIN_PRIVATE_KEY = id.privateKey;
    try {
      const ethers = await import('ethers');
      const w = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY);
      process.env.ADMIN_ADDRESS = w.address;
    } catch (e) {}
    process.env.TESTING = '1';
    // import the ESM evidence endpoint helper
    ep = await import('../tools/evidence-endpoint.js').catch(() => null);
    server = await (ep && ep.startEvidenceEndpoint ? ep.startEvidenceEndpoint(0, path.join(process.cwd(), 'front','e2e','static'), process.env.ADMIN_PUBLIC_KEY) : null);
    if (server) {
      const addr = server.address();
      this.port = addr.port;
    }
  });
  after(async () => {
    try { if (ep && ep.stopEvidenceEndpoint) await ep.stopEvidenceEndpoint(server); } catch (e) {}
  });

  it('stores and decrypts evidence', async () => {
    const base = `http://127.0.0.1:${this.port}`;
    const payload = { verdict: 'ok', ts: Date.now(), note: 'test-e2e' };
    const body = { digest: (await import('ethers')).keccak256(Buffer.from(JSON.stringify(payload), 'utf8')), type: 'rationale', content: JSON.stringify(payload) };
    const fetch = await getFetch();
    const res = await fetch(base + '/submit-evidence', { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    assert.ok(j && j.digest, 'submit returned digest');

    await new Promise(r => setTimeout(r, 200));
    const idxPath = path.join(process.cwd(), 'evidence_storage', 'index.json');
    assert.ok(fs.existsSync(idxPath), 'index.json exists');
    const idx = JSON.parse(fs.readFileSync(idxPath,'utf8'));
    assert.ok(Array.isArray(idx.entries) && idx.entries.length > 0, 'index has entries');
    const entry = idx.entries.find(e => e.digest === j.digest);
    assert.ok(entry, 'index contains our digest');

    const files = fs.readdirSync(path.join(process.cwd(), 'evidence_storage')).filter(f => f.endsWith(`-${j.digest.replace(/^0x/,'')}.json`));
    assert.ok(files.length > 0, 'envelope file present');
    const file = files[0];

    const adminKey = process.env.ADMIN_PRIVATE_KEY;
    const envelopeRaw = fs.readFileSync(path.join(process.cwd(), 'evidence_storage', file), 'utf8');
    const envelope = JSON.parse(envelopeRaw);

    let decryptedPlain = null;
    try {
      const encRecipients = envelope.recipients || [];
      const adminAddr = (process.env.ADMIN_ADDRESS || '').toLowerCase();
      const rec = encRecipients.find(r => r.address && r.address.toLowerCase() === adminAddr) || encRecipients[0];
      if (!rec) throw new Error('no recipient in envelope');
      let encryptedKey = rec.encryptedKey;
      if (typeof encryptedKey === 'string') {
        try { encryptedKey = JSON.parse(encryptedKey); } catch (e) { /* keep as-is */ }
      }
      const pk = adminKey && adminKey.startsWith('0x') ? adminKey.slice(2) : adminKey;
      const symHex = await EthCrypto.decryptWithPrivateKey(pk, encryptedKey);
      const symBuf = Buffer.from(symHex, 'hex');
      const iv = envelope.encryption && envelope.encryption.aes && envelope.encryption.aes.iv;
      const tag = envelope.encryption && envelope.encryption.aes && envelope.encryption.aes.tag;
      const ct = envelope.ciphertext;
      const decipher = crypto.createDecipheriv('aes-256-gcm', symBuf, Buffer.from(iv, 'base64'), { authTagLength: 16 });
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      const outBuf = Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]);
      decryptedPlain = outBuf.toString('utf8');
    } catch (e) {
      console.error('In-process decrypt failed, will try CLI fallback:', e && e.message ? e.message : e);
    }

    if (decryptedPlain) {
      const parsed = JSON.parse(decryptedPlain);
      assert.strictEqual(parsed.verdict, payload.verdict, 'decrypted verdict matches');
      assert.strictEqual(parsed.note, payload.note, 'decrypted note matches');
    } else {
      const script = path.join(process.cwd(), 'tools', 'admin', 'decryptEvidence.js');
      const out = spawnSync(process.execPath, [script, path.join('evidence_storage', file), '--privkey', adminKey], { encoding: 'utf8' });
      if (out.status !== 0) console.error('decrypt script stderr:', out.stderr);
      assert.strictEqual(out.status, 0, 'decrypt script exited 0');
      assert.ok(out.stdout.includes('Decrypted JSON content') || out.stdout.includes('Decrypted plaintext'), 'decrypt script printed decrypted content');
    }
  });
});
// Legacy CommonJS block removed — ESM test above is the authoritative version.
