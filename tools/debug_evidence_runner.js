import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import EthCrypto from 'eth-crypto';

function waitForLine(child, re, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { child.kill(); } catch (e) {} ; reject(new Error('timeout waiting for line')); }, timeout);
    function onData(d) {
      const s = d.toString();
      const m = s.match(re);
      if (m) { clearTimeout(timer); child.stdout.off('data', onData); child.stderr.off('data', onStderr); resolve(m); }
    }
    function onStderr(d) {
      const s = d.toString();
      const m = s.match(re);
      if (m) { clearTimeout(timer); child.stdout.off('data', onData); child.stderr.off('data', onStderr); resolve(m); }
    }
    child.stdout.on('data', onData);
    child.stderr.on('data', onStderr);
  });
}

async function main() {
  const identity = EthCrypto.createIdentity();
  const adminPub = identity.publicKey.startsWith('0x') ? identity.publicKey.slice(2) : identity.publicKey;
  const epPath = path.join(process.cwd(), 'tools', 'evidence-endpoint.cjs');
  const child = spawn(process.execPath, [epPath, '0', path.join(process.cwd(), 'front','e2e','static')], {
    env: Object.assign({}, process.env, { ADMIN_PUBLIC_KEY: adminPub, TESTING: '1' }),
    stdio: ['ignore','pipe','pipe']
  });

  child.stdout.on('data', d => process.stdout.write('[EP STDOUT] ' + d.toString()));
  child.stderr.on('data', d => process.stderr.write('[EP STDERR] ' + d.toString()));

  try {
    const m = await waitForLine(child, /Evidence endpoint listening on http:\/\/127\.0\.0\.1:(\d+)/, 8000);
    const port = Number(m[1]);
    console.log('Endpoint listening on port', port);

    const payload = { debug: 'runner' };
    const res = await fetch(`http://127.0.0.1:${port}/submit-evidence`, { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify(payload) });
    console.log('HTTP response status:', res.status);
    const bodyText = await res.text();
    console.log('Response body:', bodyText);
    try {
      const j = JSON.parse(bodyText);
      if (j && j.file) {
        const raw = fs.readFileSync(j.file, 'utf8');
        const parsed = JSON.parse(raw);
        const cipherObj = parsed && parsed.crypto ? parsed.crypto : parsed;
        try {
          const pk = identity.privateKey.startsWith('0x') ? identity.privateKey.slice(2) : identity.privateKey;
          const plain = await EthCrypto.decryptWithPrivateKey(pk, cipherObj);
          console.log('Direct decrypt succeeded, plaintext:', plain);
        } catch (e) {
          console.error('Direct decrypt failed in runner, cipher object:', cipherObj, 'error:', e && e.message ? e.message : e);
        }
      }
    } catch (e) {}
  } catch (e) {
    console.error('Runner error:', e && e.message ? e.message : e);
  } finally {
    try { child.kill(); } catch (e) {}
  }
}

main();
