let fetch = null;
try { fetch = require('node-fetch'); if (fetch && fetch.default) fetch = fetch.default; } catch (e) { fetch = global.fetch; }
const fs = require('fs');
const path = require('path');
const ethers = require('ethers');
const keccak256 = ethers.keccak256;

async function main() {
  const port = 5001; // default endpoint started earlier
  const base = `http://127.0.0.1:${port}`;
  const plaintext = JSON.stringify({ verdict: 'approved', note: 'smoke test evidence', ts: Date.now() });
  const buf = Buffer.from(plaintext, 'utf8');
  const b64 = buf.toString('base64');
  const digest = keccak256(buf);
  console.log('Prepared digest', digest);
  // POST submit-evidence
  const res = await fetch(`${base}/submit-evidence`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ciphertext: b64, digest, reporterAddress: null, contractAddress: null, note: 'smoke' }) });
  const j = await res.json().catch(() => null);
  console.log('submit-evidence status', res.status, j);
  if (!j || !j.digest) throw new Error('submit failed');
  // Send a real tx to local Hardhat (if available) and then register the real txHash
  let realTxHash = null;
  try {
    const ethers = require('ethers');
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'http://127.0.0.1:8545');
    // Use the first local account private key if available via env or fall back to provider.getSigner(0) (Hardhat supports)
    let signer = null;
    try {
      // If ADMIN_PRIVATE_KEY exists in env and is funded, use it
      if (process.env.ADMIN_PRIVATE_KEY) {
        signer = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
      } else {
        signer = provider.getSigner ? provider.getSigner(0) : null;
      }
    } catch (e) { signer = provider.getSigner ? provider.getSigner(0) : null; }

    // Attempt to use eth_sendTransaction via JSON-RPC (works with Hardhat unlocked accounts)
    try {
      const accounts = await provider.send('eth_accounts', []);
      const from = (accounts && accounts[0]) ? accounts[0] : null;
      if (from) {
        console.log('Using unlocked account for eth_sendTransaction:', from);
        const txHash = await provider.send('eth_sendTransaction', [{ from: from, to: from, value: '0x0' }]);
        console.log('Submitted tx via eth_sendTransaction, hash=', txHash);
        await provider.waitForTransaction(txHash, 1, 60000);
        realTxHash = txHash;
      } else {
        console.warn('No unlocked accounts returned by provider; cannot eth_sendTransaction');
      }
    } catch (e) {
      console.warn('eth_sendTransaction failed, trying signer fallback:', e && e.message ? e.message : e);
      try {
        if (signer && signer.sendTransaction) {
          const addr = (signer.address) ? signer.address : (await signer.getAddress());
          const tx = await signer.sendTransaction({ to: addr, value: 0 });
          await provider.waitForTransaction(tx.hash, 1, 60000);
          realTxHash = tx.hash;
        }
      } catch (e2) {
        console.warn('Signer sendTransaction fallback failed:', e2 && e2.message ? e2.message : e2);
      }
    }
  } catch (e) {
    console.warn('Real tx submission failed, falling back to fake txHash:', e && e.message ? e.message : e);
  }

  const txToRegister = realTxHash || ('0x' + 'a'.repeat(64));
  const reg = await fetch(`${base}/register-dispute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash: txToRegister, digest: j.digest, cid: j.cid || null }) });
  const regj = await reg.json().catch(() => null);
  console.log('register-dispute status', reg.status, regj);
  // Inspect index.json
  const idxPath = path.join(__dirname, '..', 'evidence_storage', 'index.json');
  if (fs.existsSync(idxPath)) {
    const raw = fs.readFileSync(idxPath, 'utf8');
    const idx = JSON.parse(raw);
    console.log('Latest index entry:', idx.entries && idx.entries[0]);
  } else {
    console.log('No index.json found at', idxPath);
  }
}

main().catch(e => { console.error('Smoke test failed', e && e.stack ? e.stack : e); process.exit(1); });
