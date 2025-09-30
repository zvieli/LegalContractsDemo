#!/usr/bin/env node
let ethersLib = null;
try {
  ethersLib = await import('ethers');
} catch (e) {
  ethersLib = null;
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
    try {
      if (ethersLib && ethersLib.utils && typeof ethersLib.utils.keccak256 === 'function') {
        digest = ethersLib.utils.keccak256(buf);
      } else if (ethersLib && typeof ethersLib.keccak256 === 'function') {
        digest = ethersLib.keccak256(buf);
      } else {
        const em = await import('ethers');
        if (em && em.utils && typeof em.utils.keccak256 === 'function') {
          digest = em.utils.keccak256(buf);
        }
      }
    } catch (e) {}
    if (!digest) throw new Error('could not find ethers.keccak256 - is ethers installed?');
    console.log(digest);
  } catch (e) {
    console.error('Error computing digest:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

await main();
