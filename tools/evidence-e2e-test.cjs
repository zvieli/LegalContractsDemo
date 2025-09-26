"use strict";
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const EthCrypto = require('eth-crypto');

const endpoint = process.env.EVIDENCE_ENDPOINT || 'http://127.0.0.1:3000/submit-evidence';
const staticDir = process.argv[2] ? process.argv[2] : path.join(__dirname, '..', 'front', 'e2e', 'static');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  console.log('E2E: posting sample payload to', endpoint);
  const sample = { tenant: '0xdead', landlord: '0xbeef', note: 'sample evidence ' + Date.now() };
  try {
    const resp = await axios.post(endpoint, sample, { headers: { 'Content-Type': 'application/json' }, timeout: 5000 });
    if (!resp.data || !resp.data.digest) {
      console.error('No digest returned', resp.data);
      process.exit(2);
    }
    const digest = resp.data.digest;
    const fileName = digest.replace(/^0x/, '') + '.json';
    const filePath = path.join(staticDir, fileName);
    console.log('Digest:', digest, 'waiting for file at', filePath);

    // wait up to 5s for file
    const maxWait = 5000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      if (fs.existsSync(filePath)) break;
      await sleep(250);
    }

    if (!fs.existsSync(filePath)) {
      console.error('File not found after waiting:', filePath);
      process.exit(3);
    }

    const contents = fs.readFileSync(filePath, 'utf8');
    console.log('File contents (canonical):', contents.substring(0, 200));

    // Optional: attempt decryption if ADMIN_PRIVATE_KEY_FILE is provided
    if (process.env.ADMIN_PRIVATE_KEY_FILE) {
      try {
        const pk = fs.readFileSync(process.env.ADMIN_PRIVATE_KEY_FILE, 'utf8').trim();
        // read file as JSON (ciphertext)
        const ciphertext = JSON.parse(contents);
        const decrypted = await EthCrypto.decryptWithPrivateKey(pk, ciphertext.crypto);
        console.log('Decrypted payload:', decrypted.substring(0, 200));
      } catch (e) {
        console.warn('Decryption attempt failed:', e.message);
      }
    } else {
      console.log('No ADMIN_PRIVATE_KEY_FILE set; skipping decryption attempt.');
    }

    console.log('E2E: success');
    process.exit(0);
  } catch (err) {
    console.error('E2E error:', err.message || err);
    process.exit(1);
  }
}

run();
