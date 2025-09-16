#!/usr/bin/env node
// Reads landlord() and withdrawable(landlord) from a rent contract
// Usage: node scripts/readWithdrawable.cjs <rpcUrl> <rentContractAddress>

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

function encodeFunctionSig(sig) {
  const crypto = require('crypto');
  const hash = crypto.createHash('keccak256');
  // Node's crypto doesn't have keccak256 by default; do manual fallback using keccak256 via buffer
  const keccak = require('keccak');
  return keccak('keccak256').update(sig).digest('hex').slice(0, 8);
}

function padHex(hex) {
  return hex.replace(/^0x/, '').padStart(64, '0');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node scripts/readWithdrawable.cjs <rpcUrl> <rentContractAddress>');
    process.exit(2);
  }
  const [rpcUrl, rentAddr] = args;

  // encode landlord() -> function sig 'landlord()' -> 4 bytes
  const landlordSig = require('keccak')('keccak256').update('landlord()').digest('hex').slice(0,8);
  const resLand = await rpcRequest(rpcUrl, 'eth_call', [{ to: rentAddr, data: '0x' + landlordSig }, 'latest']);
  if (!resLand || resLand === '0x') {
    console.error('Empty landlord response:', resLand);
    process.exit(1);
  }
  const landlord = '0x' + resLand.slice(26); // last 20 bytes
  console.log('Landlord:', landlord);

  // encode withdrawable(address)
  const withdrawSig = require('keccak')('keccak256').update('withdrawable(address)').digest('hex').slice(0,8);
  const data = '0x' + withdrawSig + padHex(landlord);
  const resWith = await rpcRequest(rpcUrl, 'eth_call', [{ to: rentAddr, data }, 'latest']);
  if (!resWith || resWith === '0x') {
    console.log('withdrawable: 0');
    process.exit(0);
  }
  const amount = BigInt(resWith);
  console.log('withdrawable (wei):', amount.toString());
}

main().catch(e => { console.error(e); process.exit(1); });
