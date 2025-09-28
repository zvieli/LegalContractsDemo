const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const EthCrypto = require('eth-crypto');

(async ()=>{
  // Prefer repo admin.key when present; otherwise create a tmp dir and key
  let tmpDir = null;
  let keyFile = null;
  let id = null;
  const repoKey = path.join(process.cwd(), 'admin.key');
  if (fs.existsSync(repoKey)) {
    const repoPriv = fs.readFileSync(repoKey, 'utf8').trim();
    id = { privateKey: repoPriv, publicKey: EthCrypto.publicKeyByPrivateKey(repoPriv.startsWith('0x') ? repoPriv.slice(2) : repoPriv) };
    keyFile = repoKey;
  } else {
    tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-e2e-'));
    id = EthCrypto.createIdentity();
    keyFile = path.join(tmpDir, 'admin.key');
    fs.writeFileSync(keyFile, id.privateKey, 'utf8');
    console.log('tmpDir', tmpDir);
  }
  const adminPub = id.publicKey.startsWith('0x') ? id.publicKey.slice(2) : id.publicKey;
  console.log('adminPub', adminPub.slice(0,10)+'...');

  const epPath = path.join(process.cwd(), 'tools', 'evidence-endpoint.cjs');
  const env = Object.assign({}, process.env);
  delete env.ADMIN_PRIVATE_KEY;
  delete env.ADMIN_PRIVATE_KEY_FILE;
  env.ADMIN_PUBLIC_KEY = adminPub;
  env.TESTING = '1';

  console.log('spawning endpoint...');
  const child = spawn(process.execPath, [epPath, '0', path.join(process.cwd(), 'front','e2e','static')], { env, stdio: ['ignore','pipe','pipe'] });
  child.stdout.on('data', d => process.stdout.write('[EP OUT] ' + d.toString()));
  child.stderr.on('data', d => process.stderr.write('[EP ERR] ' + d.toString()));
  child.on('exit', (code, sig) => console.log('endpoint exit', code, sig));

  // wait for listening line
  await new Promise((resolve, reject) => {
    const t = setTimeout(()=>reject(new Error('timeout waiting for listening line')), 8000);
    function onData(d) {
      const s = d.toString();
      if (s.match(/Evidence endpoint listening on http:\/\/127\.0\.0\.1:(\d+)/)) {
        clearTimeout(t);
        child.stdout.off('data', onData);
        child.stderr.off('data', onStderr);
        resolve();
      }
    }
    function onStderr(d) {
      const s = d.toString();
      if (s.match(/Evidence endpoint listening on http:\/\/127\.0\.0\.1:(\d+)/)) {
        clearTimeout(t);
        child.stdout.off('data', onData);
        child.stderr.off('data', onStderr);
        resolve();
      }
    }
    child.stdout.on('data', onData);
    child.stderr.on('data', onStderr);
  });
  console.log('endpoint reported listening');

  // Post payload using builtin http to avoid ESM-only fetch libs
  function postJson(urlStr, obj) {
    return new Promise((resolve, reject) => {
      const u = new URL(urlStr);
      const data = Buffer.from(JSON.stringify(obj), 'utf8');
      const opts = {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + (u.search || ''),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length
        }
      };
      const req = http.request(opts, (res) => {
        const bufs = [];
        res.on('data', d => bufs.push(d));
        res.on('end', () => {
          const txt = Buffer.concat(bufs).toString('utf8');
          let parsed = null;
          try { parsed = JSON.parse(txt); } catch (e) { parsed = txt; }
          resolve({ status: res.statusCode, body: parsed });
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  const res = await postJson('http://127.0.0.1:5001/submit-evidence', { cli: 'integration' });
  console.log('POST status', res.status);
  const body = res.body;
  console.log('POST body', body);

  // spawn decrypt-cli
  const outPath = path.join(tmpDir, 'out.txt');
  const cliEnv = Object.assign({}, process.env);
  delete cliEnv.ADMIN_PRIVATE_KEY;
  delete cliEnv.ADMIN_PRIVATE_KEY_FILE;
  cliEnv.ADMIN_PRIVATE_KEY_FILE = keyFile;
  const cli = spawn(process.execPath, [path.join(process.cwd(),'tools','admin','decrypt-cli.js'), '--file', body.file, '--out-file', outPath], { env: cliEnv, stdio: ['ignore','pipe','pipe'] });
  cli.stdout.on('data', d => process.stdout.write('[CLI OUT] ' + d.toString()));
  cli.stderr.on('data', d => process.stderr.write('[CLI ERR] ' + d.toString()));
  cli.on('exit', (code, sig) => console.log('decrypt-cli exit', code, sig));

  // wait for file
  const start = Date.now();
  while (Date.now() - start < 20000) {
    if (fs.existsSync(outPath)) break;
    await new Promise(r=>setTimeout(r,100));
  }
  if (fs.existsSync(outPath)) {
    console.log('decrypted content:', fs.readFileSync(outPath,'utf8'));
  } else {
    console.error('out file not created');
  }

  try { child.kill(); } catch(e){}
  try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
})().catch(e=>{ console.error('runner error', e && e.stack ? e.stack : e); process.exit(1); });
