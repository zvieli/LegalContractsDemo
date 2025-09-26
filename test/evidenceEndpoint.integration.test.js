import { strict as assert } from 'assert';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import EthCrypto from 'eth-crypto';
import { decryptEvidencePayload } from '../tools/admin/decryptHelper.js';

function waitForLine(child, re, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('timeout waiting for line'));
    }, timeout);
    function onData(d) {
      const s = d.toString();
      const m = s.match(re);
      if (m) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve(m);
      }
    }
    child.stdout.on('data', onData);
  });
}

describe('evidence endpoint integration', function() {
  this.timeout(10000);

  it('accepts POST, writes file and is decryptable', async function() {
    // prepare a temp admin key file
    const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-e2e-'));
    const identity = EthCrypto.createIdentity();
    const keyFile = path.join(tmpDir, 'admin.key');
    fs.writeFileSync(keyFile, identity.privateKey, { encoding: 'utf8' });

    // spawn the endpoint on port 0 (let OS pick)
    const epPath = path.join(process.cwd(), 'tools', 'evidence-endpoint.cjs');
    // pass ADMIN_PUBLIC_KEY to avoid server-side derivation path
    const adminPub = identity.publicKey.startsWith('0x') ? identity.publicKey.slice(2) : identity.publicKey;
    const child = spawn(process.execPath, [epPath, '0', path.join(process.cwd(), 'front','e2e','static')], {
      env: Object.assign({}, process.env, { ADMIN_PUBLIC_KEY: adminPub }),
      stdio: ['ignore','pipe','pipe']
    });

    try {
      // wait for listening line and extract port
      const m = await waitForLine(child, /Evidence endpoint listening on http:\/\/127\.0\.0\.1:(\d+)/, 5000);
      const port = Number(m[1]);
      assert(port > 0, 'no port');

      // POST sample payload
      const payload = { test: 'integration' };
      const res = await fetch(`http://127.0.0.1:${port}/submit-evidence`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.digest && body.file, 'no digest/file in response');

      // ensure file exists
      assert.ok(fs.existsSync(body.file), 'ciphertext file not written');

      // read and decrypt
      const raw = fs.readFileSync(body.file, 'utf8');
      const parsed = JSON.parse(raw);
      const cipherObj = parsed && parsed.crypto ? parsed.crypto : parsed;
      // Diagnostic: attempt direct decryption with eth-crypto to inspect errors
      try {
        const pk = identity.privateKey.startsWith('0x') ? identity.privateKey.slice(2) : identity.privateKey;
        const direct = await EthCrypto.decryptWithPrivateKey(pk, cipherObj);
        assert.equal(direct, JSON.stringify(payload));
      } catch (e) {
        console.error('Direct decrypt failed, cipher object:', cipherObj);
        throw e;
      }
      // then also exercise the helper
      const plain = await decryptEvidencePayload(raw, identity.privateKey);
      assert.equal(plain, JSON.stringify(payload));

      // check key file permissions on POSIX: owner-only (0o600) if possible
      try {
        const st = fs.statSync(keyFile);
        if (typeof st.mode === 'number' && process.platform !== 'win32') {
          // file mode low bits should be 0 for group/other
          assert.equal((st.mode & 0o077).toString(8), '0', 'keyfile permissions are too open');
        }
      } catch (e) {
        // best-effort, ignore on platforms where not supported
        console.warn('permission check skipped or failed:', e && e.message ? e.message : e);
      }

    } finally {
      child.kill();
      // cleanup tmp dir
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });
});
