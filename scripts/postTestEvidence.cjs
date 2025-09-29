const { ethers } = require('ethers');
const fetch = global.fetch || require('node-fetch');

async function main() {
  const payloadObj = { test: 'evidence', ts: new Date().toISOString() };
  const payload = JSON.stringify(payloadObj);
  const digest = ethers.keccak256(ethers.toUtf8Bytes(payload));
  const ciphertext = Buffer.from(payload, 'utf8').toString('base64');

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
