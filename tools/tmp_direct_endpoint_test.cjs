const { startEvidenceEndpoint } = require('./evidence-endpoint.cjs');
const EthCrypto = require('eth-crypto');
const fetch = require('node-fetch');
(async ()=>{
  const id = EthCrypto.createIdentity();
  const adminPub = id.publicKey.startsWith('0x') ? id.publicKey.slice(2) : id.publicKey;
  console.log('using adminPub', adminPub.slice(0,10)+'...');
  const server = await startEvidenceEndpoint(0, require('path').join(__dirname,'..','front','e2e','static'), adminPub);
  const addr = server.address();
  const port = addr.port;
  console.log('server started on', port);
  const payload = { test: 'direct' };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/submit-evidence`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    console.log('POST status', res.status);
    const body = await res.text();
    console.log('POST body', body);
  } catch (e) {
    console.error('POST error', e && e.stack ? e.stack : e);
  }
  try { server.close(); } catch (e) {}
})();