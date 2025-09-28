#!/usr/bin/env node
// Simple helper: compute keccak256 digest for a base64 ciphertext
// Usage: node tools/compute_digest.js <base64-string>

let ethers = null;
try {
  ethers = require('ethers');
} catch (e) {
  // try fallback to require('ethers').utils shape or throw later
  ethers = null;
}

async function main() {
  const b64 = process.argv[2];
  if (!b64) {
    console.error('Usage: node tools/compute_digest.js <base64-string>');
    process.exit(2);
  }
  try {
    const buf = Buffer.from(b64, 'base64');
    let digest = null;
    // support multiple shapes: ethers.utils.keccak256(Buffer) or ethers.keccak256
    try {
      if (ethers && ethers.utils && typeof ethers.utils.keccak256 === 'function') {
        digest = ethers.utils.keccak256(buf);
      } else if (ethers && typeof ethers.keccak256 === 'function') {
        digest = ethers.keccak256(buf);
      } else {
        // try dynamic import of ESM 'ethers' and use utils
        const em = await import('ethers');
        if (em && em.utils && typeof em.utils.keccak256 === 'function') {
          digest = em.utils.keccak256(buf);
        }
      }
    } catch (e) {
      // swallow and handle below
    }
    if (!digest) throw new Error('could not find ethers.keccak256 - is ethers installed?');
    console.log(digest);
  } catch (e) {
    console.error('Error computing digest:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

main();
