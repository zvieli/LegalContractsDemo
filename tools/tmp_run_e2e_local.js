const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const EthCrypto = require('eth-crypto');

(async ()=>{
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-e2e-'));
  const id = EthCrypto.createIdentity();
  const keyFile = path.join(tmpDir, 'admin.key');
  fs.writeFileSync(keyFile, id.privateKey, 'utf8');
  const adminPub = id.publicKey.startsWith('0x') ? id.publicKey.slice(2) : id.publicKey;

  console.log('tmpDir', tmpDir);
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

  // Post payload
  const res = await fetch('http://127.0.0.1:5001/submit-evidence', { method:'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({cli:'integration'}) });
  console.log('POST status', res.status);
  const body = await res.json().catch(()=>null);
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
})().catch(e=>{ console.error('runner error', e && e.stack ? e.stack : e); process.exit(1); });
