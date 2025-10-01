import path from 'path';
import fs from 'fs';
import { initializeTestTrace } from '../utils/testing-helpers.js';

process.env.TESTING = '1';
initializeTestTrace({ module: 'debug_evidence' });
(async () => {
  try {
    const { keccak256, toUtf8Bytes } = (await import('ethers')).utils || await import('ethers');
    const fetch = (await import('node-fetch')).default;

    const epMod = await import('./evidence-endpoint.js');
    const { startEvidenceEndpoint, stopEvidenceEndpoint } = epMod;

  const EthCrypto = (await import('eth-crypto')).default || await import('eth-crypto');
  const startupIdentity = EthCrypto.createIdentity();
  const bodyIdentity = EthCrypto.createIdentity();
  const startupPub = startupIdentity.publicKey;
  const bodyAdmin = bodyIdentity.publicKey;
    const server = await startEvidenceEndpoint(0, null, startupPub);
    const port = server.address().port;
    console.log('server started on port', port);
    const base = `http://127.0.0.1:${port}`;
    const payload = { verdict: 'debug' };
    const digest = keccak256(toUtf8Bytes(JSON.stringify(payload)));
    const res = await fetch(base + '/submit-evidence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ digest, type: 'rationale', content: JSON.stringify(payload), adminPub: bodyAdmin }) });
    const j = await res.json();
    console.log('submit response', j);
    await new Promise(r => setTimeout(r, 500));
    const stor = path.join(process.cwd(), 'evidence_storage');
    const files = fs.existsSync(stor) ? fs.readdirSync(stor).filter(f => f.endsWith(`-${digest.replace(/^0x/,'')}.json`)) : [];
    console.log('found files', files);
    if (files.length > 0) {
      const file = path.join(stor, files.sort().reverse()[0]);
      const env = JSON.parse(fs.readFileSync(file, 'utf8'));
      console.log('envelope recipients:', env.recipients);
    }
    await stopEvidenceEndpoint(server);
  } catch (e) {
    console.error('debug script failed', e && e.stack ? e.stack : e);
  }
})();
