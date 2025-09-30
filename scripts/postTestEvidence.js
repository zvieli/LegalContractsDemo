#!/usr/bin/env node
import { Buffer } from 'buffer';

async function main() {
  const E = await import('ethers').catch(() => null);
  const ethers = E && E.default ? E.default : E;
  const fetch = globalThis.fetch || (await import('node-fetch')).default;

  const payloadObj = { test: 'evidence', ts: new Date().toISOString() };
  const payload = JSON.stringify(payloadObj);
  const buf = Buffer.from(payload, 'utf8');

  // compute digest (compatible with ethers v5/v6)
  let digest = null;
  try {
    if (ethers) {
      if (ethers.hashes && typeof ethers.hashes.keccak256 === 'function') digest = ethers.hashes.keccak256(buf);
      else if (typeof ethers.keccak256 === 'function') digest = ethers.keccak256(buf);
      else if (ethers.utils && typeof ethers.utils.keccak256 === 'function') digest = ethers.utils.keccak256(buf);
    }
  } catch (e) { /* ignore */ }

  const ciphertext = buf.toString('base64');

  console.log('Payload:', payload);
  console.log('Digest:', digest);

  const resp = await fetch('http://127.0.0.1:5001/submit-evidence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ciphertext, digest })
  });

  const json = await resp.json().catch(() => null);
  console.log('HTTP', resp.status, resp.statusText);
  console.log('Response:', json);
}

main().catch(e => { console.error(e); process.exit(1); });
