import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const cfgPath = path.resolve(process.cwd(), 'config', 'merkleManager.json');
async function main(){
  console.log('CHECK_ENV: starting');
  let cfg = null;
  try{ cfg = JSON.parse(fs.readFileSync(cfgPath,'utf8')); console.log('CHECK_ENV: loaded config', { address: cfg.address, rpcUrl: cfg.rpcUrl ? cfg.rpcUrl : null }); } catch(e){ console.error('CHECK_ENV: failed to read config', e.message); process.exit(2); }

  // 1) eth_getCode
  try{
    const body = { jsonrpc: '2.0', id:1, method: 'eth_getCode', params: [cfg.address, 'latest'] };
    const r = await fetch(cfg.rpcUrl || 'http://127.0.0.1:8545', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type':'application/json' }, timeout: 5000 });
    const jr = await r.json();
    console.log('CHECK_ENV: eth_getCode result', jr.result ? 'OK (non-empty code?)' : 'EMPTY', jr.result && jr.result !== '0x' ? jr.result.slice(0,66) + '...' : jr.result );
  }catch(e){ console.error('CHECK_ENV: eth_getCode failed', e.message); }

  // 2) IPFS version
  try{
    const ipfsUrl = 'http://127.0.0.1:5001/api/v0/version';
    const r2 = await fetch(ipfsUrl, { method: 'GET', timeout: 3000 });
    if (r2.ok){ const j = await r2.json(); console.log('CHECK_ENV: ipfs version ok', { version: j.Version || j.version || j }); } else { console.warn('CHECK_ENV: ipfs version responded', r2.status); }
  }catch(e){ console.warn('CHECK_ENV: ipfs version failed', e.message); }

  // 3) poll server health
  const healthUrl = 'http://localhost:3001/api/v7/arbitration/health';
  let healthy = false;
  for(let i=0;i<30;i++){
    try{
      const r3 = await fetch(healthUrl, { method: 'GET', timeout: 2000 });
      if (r3.ok){ const j = await r3.json(); console.log('CHECK_ENV: health', j); if (j.healthy===true || j.health==='healthy'){ healthy = true; break; } }
      else { console.log('CHECK_ENV: health status', r3.status); }
    } catch(e){ console.log('CHECK_ENV: health fetch failed', e.message); }
    await new Promise(r=>setTimeout(r,1000));
  }
  if (!healthy){ console.error('CHECK_ENV: SERVER_NOT_READY'); process.exit(3); }
  console.log('CHECK_ENV: SERVER_READY');
  process.exit(0);
}

main().catch(e=>{ console.error('CHECK_ENV: fatal', e && e.stack ? e.stack : e); process.exit(10); });
