const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const EthCrypto = require('eth-crypto');

function waitForStdout(child, re, timeout = 5000) {
  return new Promise((resolve, reject) => {
    let acc = '';
    const timer = setTimeout(() => {
      reject(new Error('timeout waiting for stdout line; acc=' + acc));
    }, timeout);
    function onData(d) {
      acc += d.toString();
      const m = acc.match(re);
      if (m) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve(m);
      }
    }
    child.stdout.on('data', onData);
  });
}

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-e2e-'));
  const identity = EthCrypto.createIdentity();
  const adminPub = identity.publicKey.startsWith('0x') ? identity.publicKey.slice(2) : identity.publicKey;
  console.log('identity:', identity);

  const epPath = path.join(process.cwd(), 'tools', 'evidence-endpoint.cjs');
  const staticDir = path.join(process.cwd(), 'front','e2e','static');
  const ep = spawn(process.execPath, [epPath, '0', staticDir], {
    env: Object.assign({}, process.env, { ADMIN_PUBLIC_KEY: adminPub }),
    stdio: ['ignore','pipe','pipe']
  });

  ep.stdout.on('data', d => process.stdout.write('[EP STDOUT] ' + d.toString()));
  ep.stderr.on('data', d => process.stderr.write('[EP STDERR] ' + d.toString()));

  try {
    const m = await waitForStdout(ep, /Evidence endpoint listening on http:\/\/127\.0\.0\.1:(\d+)/, 5000);
    const port = Number(m[1]);
    console.log('endpoint port', port);

    const payload = JSON.stringify({ manual: 'run' });
    const opts = { hostname: '127.0.0.1', port: port, path: '/submit-evidence', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } };

    const resBody = await new Promise((resolve, reject) => {
      const req = http.request(opts, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve({ status: res.statusCode, body: d }));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    console.log('POST returned', resBody.status, resBody.body);
    const reply = JSON.parse(resBody.body);
    const cipherFile = reply.file;

    const outPath = path.join(tmpDir, 'out.txt');
    const cliPath = path.join(process.cwd(), 'tools', 'admin', 'decrypt-cli.js');
    const cli = spawn(process.execPath, [cliPath, '--file', cipherFile, '--out-file', outPath], {
      env: Object.assign({}, process.env, { ADMIN_PRIVATE_KEY: identity.privateKey }),
      stdio: ['ignore','pipe','pipe']
    });

    let out = '';
    let err = '';
    cli.stdout.on('data', d => { out += d.toString(); process.stdout.write('[CLI STDOUT] ' + d.toString()); });
    cli.stderr.on('data', d => { err += d.toString(); process.stderr.write('[CLI STDERR] ' + d.toString()); });

    // wait for file
    const start = Date.now();
    while (true) {
      if (fs.existsSync(outPath)) break;
      if (Date.now() - start > 5000) throw new Error('out-file not created; stdout=' + out + ' stderr=' + err);
      await new Promise(r => setTimeout(r, 100));
    }
    console.log('out-file exists, contents:\n', fs.readFileSync(outPath,'utf8'));
    cli.kill();
  } catch (e) {
    console.error('ERROR during run:', e && e.message ? e.message : e);
  } finally {
    try { ep.kill(); } catch (e) {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }
})();
