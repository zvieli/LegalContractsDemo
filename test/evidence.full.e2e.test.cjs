const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const EthCrypto = require('eth-crypto');
const fetch = (global.fetch || require('node-fetch'));

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
      const ethers = require('ethers');
      const w = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY);
      process.env.ADMIN_ADDRESS = w.address;
    } catch (e) {}
    process.env.TESTING = '1';
    ep = require('../tools/evidence-endpoint.cjs');
    server = await ep.startEvidenceEndpoint(0, staticDir, process.env.ADMIN_PUBLIC_KEY);
    const addr = server.address();
    this.port = addr.port;
  });

  after(async () => {
    try { await ep.stopEvidenceEndpoint(server); } catch (e) {}
  });

  it('creates envelope and both CLI and client decryptors can read it', async () => {
    const base = `http://127.0.0.1:${this.port}`;
    const payload = { verdict: 'ok', ts: Date.now(), note: 'full-e2e' };
    const body = { digest: require('ethers').keccak256(Buffer.from(JSON.stringify(payload), 'utf8')), type: 'rationale', content: JSON.stringify(payload) };
    const res = await fetch(base + '/submit-evidence', { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    assert.ok(j && j.digest);

    // wait for storage
    await new Promise(r => setTimeout(r, 200));
    const idxPath = path.join(process.cwd(), 'evidence_storage', 'index.json');
    assert.ok(fs.existsSync(idxPath));
    const idx = JSON.parse(fs.readFileSync(idxPath,'utf8'));
    const entry = idx.entries.find(e => e.digest === j.digest);
    assert.ok(entry);

    // find envelope file
    const files = fs.readdirSync(path.join(process.cwd(), 'evidence_storage')).filter(f => f.endsWith(`-${j.digest.replace(/^0x/,'')}.json`));
    assert.ok(files.length > 0);
    const file = files[0];

    // 1) CLI decrypt
    const adminKey = process.env.ADMIN_PRIVATE_KEY;
    const script = path.join(process.cwd(), 'tools', 'admin', 'decryptEvidence.cjs');
    const out = spawnSync(process.execPath, [script, path.join('evidence_storage', file), '--privkey', adminKey], { encoding: 'utf8' });
    if (out.status !== 0) console.error('CLI decrypt stderr:', out.stderr);
    assert.strictEqual(out.status, 0);
    assert.ok(out.stdout.includes('Decrypted JSON content'));

    // 2) client-side in-process decrypt using front helper
    const clientDecrypt = require('../front/src/utils/clientDecrypt.js');
    const envRaw = fs.readFileSync(path.join(process.cwd(), 'evidence_storage', file), 'utf8');
    const envObj = JSON.parse(envRaw);
    // clientDecrypt exports decryptEnvelopeWithPrivateKey as ESM default? require will load the CJS transpiled version in Node test environment
    const fn = clientDecrypt.decryptEnvelopeWithPrivateKey || clientDecrypt.default && clientDecrypt.default.decryptEnvelopeWithPrivateKey;
    if (!fn) throw new Error('client decrypt function not found');
    const decoded = await fn(envObj, adminKey);
    assert.strictEqual(decoded.verdict, payload.verdict);
  });
});
