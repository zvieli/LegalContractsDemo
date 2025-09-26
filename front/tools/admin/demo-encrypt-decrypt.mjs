import EthCrypto from 'eth-crypto';

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(v => stableStringify(v)).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

// Demo: encrypt a plaintext with admin public key (derived from private key) and decrypt it
async function main() {
  // Read admin private key from environment or from a file. Do NOT hardcode keys in scripts.
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
    console.error("PowerShell example: $env:ADMIN_PRIVATE_KEY = '0x...'; node front/tools/admin/demo-encrypt-decrypt.mjs; $env:ADMIN_PRIVATE_KEY = $null");
    process.exit(2);
  }
  const pk = adminPk.replace(/^0x/, '');
  const pub = EthCrypto.publicKeyByPrivateKey(pk);

  const plaintext = 'Hello — this is a test evidence payload.';
  console.log('plaintext:', plaintext);

  const encrypted = await EthCrypto.encryptWithPublicKey(pub, plaintext);
  console.log('\nciphertext JSON (stringified):');
  const json = stableStringify(encrypted);
  console.log(json);

  // Compute digest (keccak256 of exact JSON string)
  try {
    const ethers = await import('ethers');
    const digest = ethers.ethers ? ethers.ethers.keccak256(ethers.ethers.toUtf8Bytes(json)) : ethers.keccak256(ethers.toUtf8Bytes(json));
    console.log('\nkeccak256 digest:', digest);
  } catch (e) {
    console.warn('\nCould not compute digest (ethers not found):', e.message || e);
  }

  // Decrypt with private key
  const decrypted = await EthCrypto.decryptWithPrivateKey(pk, encrypted);
  console.log('\nDecrypted plaintext:', decrypted);
}

main().catch(e => { console.error('demo failed:', e); process.exit(1); });
