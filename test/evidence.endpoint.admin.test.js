import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeTestTrace } from '../utils/testing-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('evidence-endpoint finalAdminPub behavior (TESTING)', function() {
  this.timeout(10000);
  let ep = null;
  let server = null;
  const stor = path.resolve(path.join(__dirname, '..', 'evidence_storage'));

  beforeEach(async () => {
    // ensure clean storage
    try { if (fs.existsSync(stor)) fs.rmSync(stor, { recursive: true, force: true }); } catch (e) {}
    process.env.TESTING = '1';
    initializeTestTrace({ module: 'evidence.endpoint.admin.test' });
    ep = await import('../tools/evidence-endpoint.js').catch(() => null);
  });

  afterEach(async () => {
    try { if (ep && ep.stopEvidenceEndpoint && server) await ep.stopEvidenceEndpoint(server); } catch (e) {}
    try { if (fs.existsSync(stor)) fs.rmSync(stor, { recursive: true, force: true }); } catch (e) {}
    delete process.env.TESTING;
    delete process.env.ADMIN_PUBLIC_KEY;
    delete process.env.ADMIN_PRIVATE_KEY;
    server = null;
  });

  it('prefers body.adminPub over startup ADMIN_PUB and persists recipient', async () => {
    // generate two real keypairs: startupPub (should be ignored) and bodyAdmin (explicit)
    const EthCrypto = (await import('eth-crypto')).default || await import('eth-crypto');
    const startupIdentity = EthCrypto.createIdentity();
    const bodyIdentity = EthCrypto.createIdentity();
    const startupPub = startupIdentity.publicKey;
    const bodyAdmin = bodyIdentity.publicKey;
    server = await (ep && ep.startEvidenceEndpoint ? ep.startEvidenceEndpoint(0, null, startupPub) : null);
    const base = `http://127.0.0.1:${server.address().port}`;
    const payload = { verdict: 'x' };
    const { keccak256, toUtf8Bytes } = await import('ethers').then(m => m.utils || m);
    const digest = keccak256(toUtf8Bytes(JSON.stringify(payload)));
    // POST with explicit adminPub
    // POST with explicit adminPub
    const fetch = (await import('node-fetch')).default;
    const res = await fetch(base + '/submit-evidence', { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify({ digest, type: 'rationale', content: JSON.stringify(payload), adminPub: bodyAdmin }) });
    const j = await res.json();
    assert.ok(j && j.digest === digest);
    // wait for file written
    await new Promise(r => setTimeout(r, 200));
    const files = fs.readdirSync(stor).filter(f => f.endsWith(`-${digest.replace(/^0x/,'')}.json`));
    assert.ok(files.length > 0);
    const file = path.join(stor, files.sort().reverse()[0]);
    const env = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Since we now normalize the pubkey with '04' prefix, we need to check for both formats
    const wanted = String(bodyAdmin).toLowerCase().replace(/^0x/, '');
    const wantedWith04 = wanted.startsWith('04') ? wanted : '04' + wanted;
    const found = (env.recipients || []).some(r => {
      if (!r.pubkey) return false;
      const pubLower = r.pubkey.toLowerCase();
      return pubLower.includes(wanted) || pubLower.includes(wantedWith04);
    });
    assert.ok(found, 'admin recipient from body.adminPub should be present');
  });

  it('falls back to startup ADMIN_PUB when body.adminPub is absent', async () => {
    const EthCrypto = (await import('eth-crypto')).default || await import('eth-crypto');
    const startupIdentity = EthCrypto.createIdentity();
    const startupPub = startupIdentity.publicKey;
    
    // Pass the startupPub directly to startEvidenceEndpoint
    server = await (ep && ep.startEvidenceEndpoint ? ep.startEvidenceEndpoint(0, null, startupPub) : null);
    const base = `http://127.0.0.1:${server.address().port}`;
    const payload = { verdict: 'y' };
    const { keccak256, toUtf8Bytes } = await import('ethers').then(m => m.utils || m);
    const digest = keccak256(toUtf8Bytes(JSON.stringify(payload)));
    const fetch = (await import('node-fetch')).default;
    const res = await fetch(base + '/submit-evidence', { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify({ digest, type: 'rationale', content: JSON.stringify(payload) }) });
    const j = await res.json();
    assert.ok(j && j.digest === digest);
    await new Promise(r => setTimeout(r, 200));
    const files = fs.readdirSync(stor).filter(f => f.endsWith(`-${digest.replace(/^0x/,'')}.json`));
    assert.ok(files.length > 0);
    const file = path.join(stor, files.sort().reverse()[0]);
    const env = JSON.parse(fs.readFileSync(file, 'utf8'));
    
    // The system normalizes the pubkey from adminPubArg with '04' prefix
    const { normalizePubForEthCrypto } = await import('../utils/testing-helpers.js');
    const normalizedStartupPub = normalizePubForEthCrypto(startupPub);
    
    const found = (env.recipients || []).some(r => {
      if (!r.pubkey) return false;
      const pubLower = r.pubkey.toLowerCase();
      return pubLower === normalizedStartupPub.toLowerCase();
    });
    
    assert.ok(found, 'admin recipient from startup ADMIN_PUB should be present');
  });
});
