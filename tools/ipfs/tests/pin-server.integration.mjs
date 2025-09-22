import assert from 'assert';
import { spawn } from 'child_process';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve();
const STORE = path.join(process.cwd(), 'tools', 'ipfs', 'store');
if (!fs.existsSync(STORE)) fs.mkdirSync(STORE, { recursive: true });

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  console.log('Starting pin-server for integration test (in-process)...');
  // Set env on the current process and import server module to run in-process.
  process.env.PIN_SERVER_PORTS = '5002';
  // Load .env if present for local dev convenience
  try { (await import('dotenv')).config({ path: new URL('../.env', import.meta.url).pathname }); } catch (e) {}
  if (!process.env.ADMIN_PRIVATE_KEY) throw new Error('ADMIN_PRIVATE_KEY must be set to run this test');
  if (!process.env.PIN_SERVER_AES_KEY && !process.env.PIN_SERVER_SYMM_KEY) throw new Error('PIN_SERVER_AES_KEY or PIN_SERVER_SYMM_KEY must be set to run this test');
  // Import the server (CommonJS module) via dynamic import using file:// URL (Windows)
  const { pathToFileURL } = await import('url');
  const serverPath = path.join(process.cwd(), 'tools', 'ipfs', 'pin-server.js');
  const serverModule = await import(pathToFileURL(serverPath).href);
  try {
    // wait a moment for server to bind
    await wait(600);

    const base = 'http://127.0.0.1:5002';

    // 1) POST /pin with plain cipherStr
    const body = { cipherStr: 'integration-secret-evidence' };
    const r1 = await fetch(`${base}/pin`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    assert(r1.ok, `POST /pin failed ${r1.status}`);
    const json1 = await r1.json();
    assert(json1.id, 'Expected id from POST /pin');
    const id = json1.id;
    console.log('Created pin id:', id);

    // 2) Call admin decrypt with admin EIP-712 signature
    // Build typedData for admin (simple domain + value)
    // include nonce and expiry in the admin typedData to prevent replay
    const nonce = Math.floor(Math.random() * 1e9);
    const expiry = Math.floor(Date.now() / 1000) + 300;
    const adminTypedData = {
      domain: { name: 'PinServerAdmin', version: '1' },
      types: { AdminReveal: [ { name: 'pinId', type: 'string' }, { name: 'nonce', type: 'uint256' }, { name: 'expiry', type: 'uint256' } ] },
      value: { pinId: id, nonce, expiry }
    };
  // Sign using ethers TypedDataEncoder + SigningKey to be compatible across versions
  const ethersPkg = await import('ethers');
  const { TypedDataEncoder, SigningKey } = ethersPkg;
  const domain = adminTypedData.domain;
  const types = adminTypedData.types;
  const value = adminTypedData.value;
  const digest = TypedDataEncoder.hash(domain, types, value);
  const sk = new SigningKey(process.env.ADMIN_PRIVATE_KEY);
  const sigObj = sk.sign(digest);
  const r = sigObj.r.replace(/^0x/, '');
  const s = sigObj.s.replace(/^0x/, '');
  const v = (typeof sigObj.yParity === 'number') ? (sigObj.yParity ? 28 : 27) : (sigObj.networkV || 27);
  const signature = '0x' + r + s + v.toString(16).padStart(2, '0');

    const r2 = await fetch(`${base}/admin/decrypt/${id}`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ adminTypedData, adminSignature: signature }) });
    assert(r2.ok, `POST /admin/decrypt failed ${r2.status}`);
    const json2 = await r2.json();
    assert(json2.decrypted, 'Expected decrypted field');
    console.log('Decrypted response:', json2.decrypted);
    assert(json2.decrypted.includes('integration-secret-evidence'), 'Decrypted payload did not contain original text');

    console.log('Integration test passed');
  } finally {
  console.log('Stopping server...');
  try { if (serverModule && serverModule.default && typeof serverModule.default.shutdown === 'function') serverModule.default.shutdown(); } catch (e) {}
    // cleanup env
    delete process.env.PIN_SERVER_PORTS;
    delete process.env.ADMIN_PRIVATE_KEY;
    delete process.env.PIN_SERVER_AES_KEY;
  }
}

run().catch((err) => { console.error('Test failed', err); process.exit(1); });
