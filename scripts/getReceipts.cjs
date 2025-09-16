#!/usr/bin/env node
// Fetch transaction receipts for provided tx hashes
// Usage: node scripts/getReceipts.cjs <rpcUrl> <txHash1> [txHash2 ...]

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
    console.error('Usage: node scripts/getReceipts.cjs <rpcUrl> <txHash1> [txHash2 ...]');
    process.exit(2);
  }
  const rpcUrl = args[0];
  const txs = args.slice(1);
  for (const tx of txs) {
    try {
      const receipt = await rpcRequest(rpcUrl, 'eth_getTransactionReceipt', [tx]);
      console.log('Receipt for', tx, JSON.stringify(receipt, null, 2));
    } catch (e) {
      console.error('Error fetching receipt for', tx, e);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
