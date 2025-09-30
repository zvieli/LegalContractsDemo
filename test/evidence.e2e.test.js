const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { spawnSync } = require('child_process');
const EthCrypto = require('eth-crypto');

const ep = require('../tools/evidence-endpoint.cjs');

describe('Evidence E2E smoke', function() {
  this.timeout(20000);
  let server = null;
  before(async () => {
    // create identity for admin
    const id = EthCrypto.createIdentity();
    process.env.ADMIN_PUBLIC_KEY = id.publicKey.startsWith('0x') ? id.publicKey.slice(2) : id.publicKey;
    process.env.ADMIN_PRIVATE_KEY = id.privateKey;
    process.env.TESTING = '1';
    // start endpoint on ephemeral port 0
    server = await ep.startEvidenceEndpoint(0, path.join(process.cwd(), 'front','e2e','static'));
    const addr = server.address();
    this.port = addr.port;
  });
  after(async () => {
    try { await ep.stopEvidenceEndpoint(server); } catch (e) {}
  });

  it('stores and decrypts evidence', async () => {
    const base = `http://127.0.0.1:${this.port}`;
    const payload = { verdict: 'ok', ts: Date.now(), note: 'test-e2e' };
    const body = { digest: require('ethers').keccak256(Buffer.from(JSON.stringify(payload), 'utf8')), type: 'rationale', content: JSON.stringify(payload) };
    const res = await fetch(base + '/submit-evidence', { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    assert.ok(j && j.digest, 'submit returned digest');

    // Wait briefly for index to be flushed
    await new Promise(r => setTimeout(r, 200));
    const idxPath = path.join(process.cwd(), 'evidence_storage', 'index.json');
    assert.ok(fs.existsSync(idxPath), 'index.json exists');
    const idx = JSON.parse(fs.readFileSync(idxPath,'utf8'));
    assert.ok(Array.isArray(idx.entries) && idx.entries.length > 0, 'index has entries');
    const entry = idx.entries.find(e => e.digest === j.digest);
    assert.ok(entry, 'index contains our digest');

    // find envelope file
    const files = fs.readdirSync(path.join(process.cwd(), 'evidence_storage')).filter(f => f.endsWith(`-${j.digest.replace(/^0x/,'')}.json`));
    assert.ok(files.length > 0, 'envelope file present');
    const file = files[0];

    // Run admin decrypt script to verify it prints JSON; spawnSync for simplicity
    const adminKey = process.env.ADMIN_PRIVATE_KEY;
    const script = path.join(process.cwd(), 'tools', 'admin', 'decryptEvidence.cjs');
    const out = spawnSync(process.execPath, [script, path.join('evidence_storage', file), '--privkey', adminKey], { encoding: 'utf8' });
    if (out.status !== 0) {
      console.error('decrypt script stderr:', out.stderr);
    }
    assert.strictEqual(out.status, 0, 'decrypt script exited 0');
    assert.ok(out.stdout.includes('Decrypted JSON content') || out.stdout.includes('Decrypted plaintext'), 'decrypt script printed decrypted content');
  });
});
