#!/usr/bin/env node
// Scans recent blocks for transactions originating from a given address using raw JSON-RPC
// Usage: node scripts/findTxsFromAddr.cjs <rpcUrl> <address> [fromBlock] [toBlock]

const http = require('http');
const https = require('https');
const { URL } = require('url');

function rpcRequest(rpcUrl, method, params) {
  return new Promise((resolve, reject) => {
    const url = new URL(rpcUrl);
    const data = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    };
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(opts, res => {
      let body = '';
      res.on('data', ch => (body += ch));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) return reject(parsed.error);
          resolve(parsed.result);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node scripts/findTxsFromAddr.cjs <rpcUrl> <address> [fromBlock] [toBlock]');
    process.exit(2);
  }
  const [rpcUrl, address] = args;
  const latestHex = await rpcRequest(rpcUrl, 'eth_blockNumber', []);
  const latest = parseInt(latestHex, 16);
  const fromBlock = args[2] ? parseInt(args[2], 10) : Math.max(0, latest - 5000);
  const toBlock = args[3] ? parseInt(args[3], 10) : latest;

  console.log('RPC:', rpcUrl);
  console.log('Scanning blocks', fromBlock, '->', toBlock);
  console.log('Looking for txs from address:', address);

  let totalFound = 0;
  for (let b = fromBlock; b <= toBlock; b++) {
    const hex = '0x' + b.toString(16);
    const block = await rpcRequest(rpcUrl, 'eth_getBlockByNumber', [hex, true]);
    if (!block || !block.transactions) continue;
    for (const tx of block.transactions) {
      if (!tx.from) continue;
      if (tx.from.toLowerCase() === address.toLowerCase()) {
        totalFound++;
        console.log('Found tx:', tx.hash, 'block', b, 'to', tx.to, 'value', tx.value);
      }
    }
  }

  console.log('Total found:', totalFound);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
