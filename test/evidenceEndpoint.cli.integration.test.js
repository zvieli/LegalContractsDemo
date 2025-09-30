import { strict as assert } from 'assert';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import fetch from 'node-fetch';
import EthCrypto from 'eth-crypto';
import { createRequire } from 'module';

function waitForLine(child, re, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { child.kill(); } catch (e) {}
      reject(new Error('timeout waiting for line')); 
    }, timeout);

    function makeOnData(stream) {
      return function onData(d) {
        const s = d.toString();
        const m = s.match(re);
        if (m) {
          clearTimeout(timer);
          // detach both listeners
          try { child.stdout.off('data', onData); } catch (e) {}
          try { child.stderr.off('data', onStderr); } catch (e) {}
          resolve(m);
        }
      };
    }

    function onData(d) {
      const s = d.toString();
      const m = s.match(re);
      if (m) {
        clearTimeout(timer);
        try { child.stdout.off('data', onData); } catch (e) {}
        try { child.stderr.off('data', onStderr); } catch (e) {}
        resolve(m);
      }
    }
    function onStderr(d) {
      const s = d.toString();
      const m = s.match(re);
      if (m) {
        clearTimeout(timer);
        try { child.stdout.off('data', onData); } catch (e) {}
        try { child.stderr.off('data', onStderr); } catch (e) {}
        resolve(m);
      }
    }

    child.stdout.on('data', onData);
    child.stderr.on('data', onStderr);
  });
}

describe('evidence endpoint CLI integration', function() {
  this.timeout(30000);
  // share variables across hooks and test
  let tmpDir;
  let repoKeyPath;
  let keyFile;
  let identity;
  let usingRepoKey;
  let child;
  let port;

  beforeEach(async function() {
    tmpDir = null;
    repoKeyPath = path.join(process.cwd(), 'admin.key');
    keyFile = null;
    identity = null;
    usingRepoKey = false;
    if (fs.existsSync(repoKeyPath)) {
      const repoPriv = fs.readFileSync(repoKeyPath, 'utf8').trim();
      keyFile = repoKeyPath;
      usingRepoKey = true;
      const privNo0x = repoPriv.startsWith('0x') ? repoPriv.slice(2) : repoPriv;
      const pubFull = EthCrypto.publicKeyByPrivateKey(privNo0x);
      identity = { privateKey: repoPriv, publicKey: pubFull };
    } else {
      tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-e2e-'));
      identity = EthCrypto.createIdentity();
      keyFile = path.join(tmpDir, 'admin.key');
      fs.writeFileSync(keyFile, identity.privateKey, { encoding: 'utf8' });
    }

    const adminPub = identity.publicKey.startsWith('0x') ? identity.publicKey.slice(2) : identity.publicKey;
  const epPath = path.join(process.cwd(), 'tools', 'evidence-endpoint.js');
    const epEnv = Object.assign({}, process.env);
    delete epEnv.ADMIN_PRIVATE_KEY;
    delete epEnv.ADMIN_PRIVATE_KEY_FILE;
    epEnv.ADMIN_PUBLIC_KEY = adminPub;
    epEnv.TESTING = '1';

    child = spawn(process.execPath, [epPath, '0', path.join(process.cwd(), 'front','e2e','static')], {
      env: epEnv,
      stdio: ['ignore','pipe','pipe']
    });

    const m1 = await waitForLine(child, /Evidence endpoint listening on http:\/\/127\.0\.0\.1:(\d+)/, 10000);
    port = Number(m1[1]);
    assert(port > 0, 'no port');
  });

  afterEach(async function() {
    try { if (child && !child.killed) child.kill(); } catch (e) {}
    try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  });

  it('writes file and decrypt-cli can decrypt it', async function() {
    const payload = { cli: 'integration' };
    const res = await fetch(`http://127.0.0.1:${port}/submit-evidence`, { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify(payload) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.file, 'no file in response');

  // run decrypt-cli.js as separate process and ask it to write output to a temp file
  // Use repo tmpDir if we created one, otherwise use system temp directory to avoid creating repo tmp-e2e folders
  const outFileName = 'out-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.txt';
  const outPath = tmpDir ? path.join(tmpDir, 'out.txt') : path.join(os.tmpdir(), outFileName);
    // Pass the admin private key to CLI via a temporary file to avoid env leakage and ensure a single code path
    const cliEnv = Object.assign({}, process.env);
    delete cliEnv.ADMIN_PRIVATE_KEY;
    delete cliEnv.ADMIN_PRIVATE_KEY_FILE;
    cliEnv.ADMIN_PRIVATE_KEY_FILE = keyFile;
    const cli = spawn(process.execPath, [path.join(process.cwd(),'tools','admin','decrypt-cli.js'), '--file', body.file, '--out-file', outPath], {
      env: cliEnv,
      stdio: ['ignore','pipe','pipe']
    });

    let stdoutAcc = '';
    let stderrAcc = '';
    cli.stdout.on('data', d => stdoutAcc += d.toString());
    cli.stderr.on('data', d => stderrAcc += d.toString());

    // wait up to 20s for the out file to be created by the CLI
    const waitForFile = (p, timeout = 20000) => new Promise((resolve, reject) => {
      const start = Date.now();
      (function poll() {
        if (fs.existsSync(p)) return resolve(true);
        if (Date.now() - start > timeout) return reject(new Error('out-file not created: ' + p + '\nstdout:' + stdoutAcc + '\nstderr:' + stderrAcc));
        setTimeout(poll, 100);
      })();
    });

    cli.on('close', (code, sig) => {
      console.log('decrypt-cli exited, code=', code, 'sig=', sig);
    });

    await waitForFile(outPath, 20000);
    const outContent = fs.readFileSync(outPath, 'utf8').trim();
    assert.equal(outContent, JSON.stringify(payload));
    // cleanup out file if created in system temp dir
    try { if (!tmpDir && fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (e) {}
  });
});
