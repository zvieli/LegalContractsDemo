#!/usr/bin/env node
/* e2e-evidence-flow.cjs
   Simple E2E script that exercises: plain -> ciphertext stored -> failed wrapper -> re-encrypt and retry
*/
const fs = require('fs');
const path = require('path');
const axios = require('axios');
(async function(){
  const endpoint = process.argv[2] || 'http://127.0.0.1:3003/submit-evidence';
  console.log('Using endpoint', endpoint);

  // 1) POST a plaintext
  const payload1 = { tenant: '0xaaa', landlord: '0xbbb', note: 'e2e plaintext ' + Date.now() };
  try{
    const r1 = await axios.post(endpoint, payload1, { headers: { 'Content-Type': 'application/json' } });
    console.log('Plaintext POST OK ->', r1.data);
  }catch(e){ console.error('Plaintext POST failed', e.response ? e.response.data : e.message); process.exit(1); }

  // 2) POST an invalid wrapper to trigger a 400 with adminPublicKey
  const badWrapper = { version: '1', crypto: { ephemPublicKey: '00abcd', iv: '00', ciphertext: '00', mac: '00' } };
  let adminPub = null;
  try{
    await axios.post(endpoint, badWrapper, { headers: { 'Content-Type': 'application/json' } });
    console.error('Unexpected success posting bad wrapper');
    process.exit(2);
  }catch(e){
    if (e.response && e.response.status === 400 && e.response.data && e.response.data.adminPublicKey) {
      adminPub = e.response.data.adminPublicKey;
      console.log('Received adminPublicKey from server (as expected)');
    } else {
      console.error('Bad-wrapper POST failed unexpectedly', e.response ? e.response.data : e.message);
      process.exit(3);
    }
  }

  // 3) Re-encrypt locally using adminPub and POST
  const EthCrypto = require('eth-crypto');
  const adminPubRaw = String(adminPub).replace(/^0x/, '');
  const plaintext = JSON.stringify({ tenant: '0xccc', landlord: '0xddd', note: 're-encrypted '+Date.now() });
  // EthCrypto.encryptWithPublicKey accepts a Buffer/Uint8Array or hex string; pass Buffer
  const pubBuf = Buffer.from(adminPubRaw, 'hex');
  try{
    const enc = await EthCrypto.encryptWithPublicKey(pubBuf, plaintext);
    const ciphertext = typeof enc === 'string' ? enc : JSON.stringify(enc);
    const r2 = await axios.post(endpoint, ciphertext, { headers: { 'Content-Type': 'application/json' } });
    console.log('Re-encrypt POST OK ->', r2.data);
    process.exit(0);
  }catch(e){
    console.error('Re-encrypt or POST failed', e.response ? e.response.data : e.message);
    process.exit(4);
  }
})();
