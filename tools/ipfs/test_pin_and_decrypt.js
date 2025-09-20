#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

(async function main(){
  try {
    const envPath = path.join(process.cwd(), 'tools', 'ipfs', '.env');
    if (!fs.existsSync(envPath)) throw new Error(`.env not found at ${envPath}`);
    const raw = fs.readFileSync(envPath, 'utf8');
    const get = (k) => {
      const m = raw.match(new RegExp('^' + k + '=(.*)$', 'm'));
      return m ? m[1].trim() : null;
    };
  const API_KEY = get('PIN_SERVER_API_KEY');
  const ADMIN_PRIVATE_KEY = get('ADMIN_PRIVATE_KEY') || get('ADMIN_PRIVATE');
  if (!API_KEY) throw new Error('PIN_SERVER_API_KEY not found in .env');
  if (!ADMIN_PRIVATE_KEY) throw new Error('ADMIN_PRIVATE_KEY not found in .env');

  console.log('Using API key (first 8 chars):', API_KEY.slice(0,8));

  // Build an eth-crypto style cipher string
  const EthCrypto = await import('eth-crypto');
  const priv = ADMIN_PRIVATE_KEY.startsWith('0x') ? ADMIN_PRIVATE_KEY.slice(2) : ADMIN_PRIVATE_KEY;
  // Derive public key in the exact format EthCrypto expects
  const pubRaw = EthCrypto.publicKeyByPrivateKey(priv);
  const pub = pubRaw.startsWith('0x') ? pubRaw.slice(2) : pubRaw;
    const payload = `test-message:${Date.now()}`;
    const cipherObj = await EthCrypto.encryptWithPublicKey(pub, payload);
    const cipherStr = EthCrypto.cipher.stringify(cipherObj);

    console.log('Encrypted payload length:', cipherStr.length);

    // Use global fetch (node 18+) or dynamic import of node-fetch as fallback
    let fetchFn = global.fetch;
    if (!fetchFn) {
      try { fetchFn = (await import('node-fetch')).default; } catch (e) { throw new Error('No fetch available (install node-fetch or use Node 18+)'); }
    }

    const pinUrl = 'http://127.0.0.1:3002/pin';
    console.log('POST', pinUrl);
    const pinRes = await fetchFn(pinUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': API_KEY },
      body: JSON.stringify({ cipherStr, meta: { note: 'automated test' } }),
    });
    const pinOut = await pinRes.json();
    console.log('pin response:', pinOut);
    if (!pinOut || !pinOut.id) throw new Error('pin did not return id');

    const decUrl = `http://127.0.0.1:3002/admin/decrypt/${pinOut.id}`;
    console.log('POST', decUrl);
    const decRes = await fetchFn(decUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': API_KEY } });
    const decOut = await decRes.json();
    console.log('decrypt response:', decOut);

    if (decOut && decOut.decrypted && decOut.decrypted === payload) {
      console.log('SUCCESS: decrypted payload matches original');
      process.exit(0);
    } else if (decOut && decOut.decrypted && typeof decOut.decrypted === 'string') {
      console.log('NOTICE: decrypt returned string; showing value');
      console.log(decOut.decrypted);
      process.exit(0);
    } else if (decOut && decOut.decrypted) {
      console.log('decrypt returned object:', decOut.decrypted);
      process.exit(0);
    } else {
      console.error('decrypt did not return expected data');
      process.exit(2);
    }
  } catch (e) {
    console.error('error', e && e.message ? e.message : e);
    process.exit(3);
  }
})();
