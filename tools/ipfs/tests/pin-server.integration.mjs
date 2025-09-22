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
  console.log('Starting pin-server for integration test...');
  const env = Object.assign({}, process.env, {
    PIN_SERVER_PORTS: '4002',
    PIN_SERVER_API_KEY: 'test-key',
    PIN_SERVER_AES_KEY: 'test-aes-key'
  });
  const server = spawn(process.execPath, [path.join('tools','ipfs','pin-server.js')], { env, stdio: 'inherit' });

  try {
    // wait a moment for server to bind
    await wait(600);

    const base = 'http://127.0.0.1:4002';

    // 1) POST /pin with plain cipherStr
    const body = { cipherStr: 'integration-secret-evidence' };
    const r1 = await fetch(`${base}/pin`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    assert(r1.ok, `POST /pin failed ${r1.status}`);
    const json1 = await r1.json();
    assert(json1.id, 'Expected id from POST /pin');
    const id = json1.id;
    console.log('Created pin id:', id);

    // 2) Call admin decrypt with API key (server-side path)
    const r2 = await fetch(`${base}/admin/decrypt/${id}`, { method: 'POST', headers: { 'X-API-KEY': 'test-key' }, body: '{}' });
    assert(r2.ok, `POST /admin/decrypt failed ${r2.status}`);
    const json2 = await r2.json();
    assert(json2.decrypted, 'Expected decrypted field');
    console.log('Decrypted response:', json2.decrypted);
    assert(json2.decrypted.includes('integration-secret-evidence'), 'Decrypted payload did not contain original text');

    console.log('Integration test passed');
  } finally {
    console.log('Stopping server...');
    server.kill();
  }
}

run().catch((err) => { console.error('Test failed', err); process.exit(1); });
