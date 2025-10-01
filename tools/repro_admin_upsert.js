#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { 
  initializeTestTrace, 
  normalizePubForEthCrypto, 
  canonicalizeAddress 
} from '../utils/testing-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Deterministic repro for admin upsert in TESTING
process.env.TESTING = '1';

// Initialize test tracing
initializeTestTrace({ module: 'repro_admin_upsert' });
(async () => {
  try {
  const EthCryptoMod = await import('eth-crypto');
  const EthCrypto = EthCryptoMod.default || EthCryptoMod;
  const ethersMod = await import('ethers');
  const fetch = (globalThis && globalThis.fetch) ? globalThis.fetch.bind(globalThis) : (await import('node-fetch')).default;

    // Create identities
    const startupIdentity = EthCrypto.createIdentity();
    const bodyIdentity = EthCrypto.createIdentity();

    // Prepare variants of public key formats
    const startupRaw = startupIdentity.publicKey; // eth-crypto output (128 hex chars, no '04')
    const bodyRaw = bodyIdentity.publicKey;
    const startupWith04 = startupRaw.startsWith('04') ? startupRaw : ('04' + startupRaw);
    const startupWith0x04 = '0x' + startupWith04;
    const bodyWith04 = bodyRaw.startsWith('04') ? bodyRaw : ('04' + bodyRaw);
    const bodyWith0x = '0x' + (bodyRaw.startsWith('04') ? bodyRaw : ('04' + bodyRaw));

    console.log('startupRaw (len):', startupRaw.length, startupRaw.slice(0, 12) + '...');
    console.log('startupWith04 (len):', startupWith04.length, startupWith04.slice(0, 12) + '...');
    console.log('bodyRaw (len):', bodyRaw.length, bodyRaw.slice(0, 12) + '...');

    // Start endpoint passing startupWith04 (without 0x) so startEvidenceEndpoint will normalize it
    const epMod = await import('./evidence-endpoint.js');
    const { startEvidenceEndpoint, stopEvidenceEndpoint } = epMod;
    console.log('\nStarting evidence endpoint with ADMIN_PUB (startupWith04, no 0x)');
    const server = await startEvidenceEndpoint(0, null, startupWith04);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    console.log('server listening on', base);

    // Build payload and digest
    const payload = { test: 'repro-admin-upsert', ts: Date.now() };
    let digest = null;
    try {
      // prefer ethers keccak256 + toUtf8Bytes if available
      if (typeof ethersMod.keccak256 === 'function' && typeof ethersMod.toUtf8Bytes === 'function') {
        digest = ethersMod.keccak256(ethersMod.toUtf8Bytes(JSON.stringify(payload)));
      } else if (ethersMod.utils && typeof ethersMod.utils.keccak256 === 'function' && typeof ethersMod.utils.toUtf8Bytes === 'function') {
        digest = ethersMod.utils.keccak256(ethersMod.utils.toUtf8Bytes(JSON.stringify(payload)));
      }
    } catch (e) {}
    if (!digest) {
      digest = '0x' + crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
    }

    // Send POST with body.adminPub in the raw eth-crypto format (no '04' prefix)
    const postBody = {
      digest,
      type: 'rationale',
      content: JSON.stringify(payload),
      adminPub: bodyRaw // intentionally raw form to test normalization in endpoint
    };

    console.log('\nPOSTing to /submit-evidence with body.adminPub (raw eth-crypto 128-hex)');
    console.log('adminPub (first 12):', String(bodyRaw).slice(0, 12) + '...');

    const res = await fetch(base + '/submit-evidence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(postBody) });
    const j = await res.json();
    console.log('submit response:', j);

    // Wait a moment for file to be written
    await new Promise(r => setTimeout(r, 600));

    const stor = path.resolve(path.join(__dirname, '..', 'evidence_storage'));
    if (!fs.existsSync(stor)) {
      console.error('evidence_storage not found at', stor);
      await stopEvidenceEndpoint(server);
      return;
    }
    const files = fs.readdirSync(stor).filter(f => f.endsWith(`-${digest.replace(/^0x/,'')}.json`)).sort();
    console.log('matching files count:', files.length);
    if (files.length === 0) {
      console.error('no envelope file found for digest');
      await stopEvidenceEndpoint(server);
      return;
    }
    const file = path.join(stor, files[files.length - 1]);
    console.log('reading envelope file:', file);
    const envRaw = fs.readFileSync(file, 'utf8');
    console.log('---- envelope content ----');
    console.log(envRaw);
    let env = null;
    try { env = JSON.parse(envRaw); } catch (e) { console.error('envelope parse error', e); }

    // Compute normalized forms locally for comparison
    const wanted = normalizePubForEthCrypto(bodyRaw);
    console.log('\nLocal normalized wanted admin pub (first 12):', wanted ? wanted.slice(0,12) + '...' : wanted);

    const found = (env && env.recipients) ? (env.recipients || []).some(r => r.pubkey && r.pubkey.toLowerCase().includes(wanted)) : false;
    console.log('Admin pub present in envelope recipients?', found);

    // Cleanup
    await stopEvidenceEndpoint(server);
    process.exit(found ? 0 : 2);
  } catch (e) {
    console.error('repro script error', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
