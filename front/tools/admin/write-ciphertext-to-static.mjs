import fs from 'fs/promises';
import path from 'path';
import EthCrypto from 'eth-crypto';

// Stable JSON stringify: deterministically sort object keys so serialization
// is canonical for keccak256 over the UTF-8 bytes.
function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(v => stableStringify(v)).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

async function main() {
  // Read admin private key from environment or from a file. Do NOT hardcode keys in scripts.
  // Set via PowerShell: $env:ADMIN_PRIVATE_KEY = '0x...'; node ...; $env:ADMIN_PRIVATE_KEY = $null
  // Or set ADMIN_PRIVATE_KEY_FILE to a path containing the key.
  let adminPk = process.env.ADMIN_PRIVATE_KEY || null;
  if (!adminPk && process.env.ADMIN_PRIVATE_KEY_FILE) {
    const fs = await import('fs/promises');
    try {
      adminPk = (await fs.readFile(process.env.ADMIN_PRIVATE_KEY_FILE, 'utf8')).trim();
    } catch (e) {
      console.error('Could not read ADMIN_PRIVATE_KEY_FILE:', e.message || e);
    }
  }
  if (!adminPk) {
    console.error('ERROR: ADMIN_PRIVATE_KEY not set. Set ADMIN_PRIVATE_KEY env var or ADMIN_PRIVATE_KEY_FILE.');
    console.error("PowerShell example: $env:ADMIN_PRIVATE_KEY = '0x...'; node front/tools/admin/write-ciphertext-to-static.mjs; $env:ADMIN_PRIVATE_KEY = $null");
    process.exit(2);
  }
  const pk = adminPk.replace(/^0x/, '');
  const pub = EthCrypto.publicKeyByPrivateKey(pk);

  const plaintext = 'Hello — this is a test evidence payload.';
  const encrypted = await EthCrypto.encryptWithPublicKey(pub, plaintext);
  // Use canonical serialization so digest always matches the bytes we write
  const json = stableStringify(encrypted);

  // compute keccak256 digest of exact JSON string
  let digest = null;
  try {
    const ethers = await import('ethers');
    digest = ethers.ethers ? ethers.ethers.keccak256(ethers.ethers.toUtf8Bytes(json)) : ethers.keccak256(ethers.toUtf8Bytes(json));
  } catch (e) {
    console.warn('ethers not available; cannot compute digest automatically.');
  }

  const digestNo0x = digest ? digest.replace(/^0x/, '') : 'no-digest';
  const outDir = path.resolve(process.cwd(), 'front', 'e2e', 'static');
  const outPath = path.join(outDir, `${digestNo0x}.json`);

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outPath, json, 'utf8');

  console.log('Wrote ciphertext JSON to:', outPath);
  if (digest) console.log('Digest:', digest);
}

main().catch(e => { console.error(e); process.exit(1); });
