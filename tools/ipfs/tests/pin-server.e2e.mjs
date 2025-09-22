import assert from 'assert';
import { spawn } from 'child_process';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import * as ethersPkg from 'ethers';
const { Wallet, utils } = ethersPkg;

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  console.log('Starting pin-server for E2E test...');
  const env = Object.assign({}, process.env, {
    PIN_SERVER_PORTS: '4003',
    PIN_SERVER_API_KEY: 'test-key',
    PIN_SERVER_AES_KEY: 'test-aes-key',
    PIN_SERVER_TEST_ALLOW_SIGNER: 'true'
  });
  const server = spawn(process.execPath, [path.join('tools','ipfs','pin-server.js')], { env, stdio: 'inherit' });

  try {
    await wait(600);
    const base = 'http://127.0.0.1:4003';
    // create a test wallet (private key ephemeral)
    const wallet = Wallet.createRandom();
    const address = await wallet.getAddress();
    console.log('Test wallet address:', address);

    // 1) create a pin by POST /pin with encrypted payload
    const plain = 'e2e-secret-evidence';
    const r1 = await fetch(`${base}/pin`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ cipherStr: plain }) });
    assert(r1.ok, `POST /pin failed ${r1.status}`);
    const json1 = await r1.json();
    const id = json1.id;
    console.log('Created pin id:', id);

    // Build typedData matching server expectations
    const chainId = 1337;
    const domain = { name: 'PinServerReveal', version: '1', chainId, verifyingContract: address };
    const types = { Reveal: [ { name:'pinId', type:'string' }, { name:'contract', type:'address' }, { name:'nonce', type:'uint256' }, { name:'expiry', type:'uint256' } ] };
    const nonce = Math.floor(Math.random() * 1e9);
    const expiry = Math.floor(Date.now() / 1000) + 300;
    const value = { pinId: id, contract: address, nonce, expiry };

    // Ensure the wallet has a provider so _signTypedData is available
    try {
      const { providers } = ethersPkg;
      const provider = new providers.JsonRpcProvider('http://127.0.0.1:8545');
      // create a new Wallet instance attached to provider
      const walletWithProvider = new Wallet(wallet.privateKey, provider);
      if (typeof walletWithProvider._signTypedData === 'function') {
        var signature = await walletWithProvider._signTypedData(domain, types, value);
      } else {
        // fallback to signing digest via SigningKey
        const { TypedDataEncoder } = ethersPkg;
        const digest = TypedDataEncoder.hash(domain, types, value);
  const signingKey = new ethersPkg.SigningKey(wallet.privateKey);
  const sigObj = signingKey.sign(digest);
  // Build compact signature hex: r (32) + s (32) + v (1)
  const r = sigObj.r.replace(/^0x/, '');
  const s = sigObj.s.replace(/^0x/, '');
  const v = (typeof sigObj.yParity === 'number') ? (sigObj.yParity ? 28 : 27) : (sigObj.networkV || 27);
  var signature = '0x' + r + s + v.toString(16).padStart(2, '0');
      }
    } catch (e) {
      const { TypedDataEncoder } = ethersPkg;
  const digest = TypedDataEncoder.hash(domain, types, value);
  const signingKey = new ethersPkg.SigningKey(wallet.privateKey);
  const sigObj = signingKey.sign(digest);
  const r = sigObj.r.replace(/^0x/, '');
  const s = sigObj.s.replace(/^0x/, '');
  const v = (typeof sigObj.yParity === 'number') ? (sigObj.yParity ? 28 : 27) : (sigObj.networkV || 27);
  var signature = '0x' + r + s + v.toString(16).padStart(2, '0');
    }

    // POST to decrypt route with typedData + signature
    const payload = { typedData: { domain, types, value }, signature };
    const r2 = await fetch(`${base}/admin/decrypt/${id}`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
    if (!r2.ok) {
      const txt = await r2.text().catch(() => null);
      console.error('Decrypt failed status', r2.status, txt);
    }
    assert(r2.ok, `POST /admin/decrypt typed failed ${r2.status}`);
    const j2 = await r2.json();
    console.log('Decrypted:', j2.decrypted);
    if (!j2.decrypted || !j2.decrypted.includes(plain)) throw new Error('Decrypted payload missing original');

    console.log('E2E typed-data reveal test passed');
  } finally {
    server.kill();
  }
}

run().catch(e => { console.error('E2E test failed', e); process.exit(1); });
