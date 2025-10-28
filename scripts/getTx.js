#!/usr/bin/env node
import fs from 'fs';
const hash = process.argv[2];
if (!hash) { console.error('Usage: node scripts/getTx.js <txHash>'); process.exit(2); }
const url = 'http://127.0.0.1:8545';
(async ()=>{
  try{
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getTransactionByHash', params: [hash], id: 1 })
    });
    const j = await res.json();
    console.log(JSON.stringify(j, null, 2));
  }catch(e){ console.error('RPC fetch failed', e && e.message ? e.message : e); process.exit(1);} 
})();
