import assert from 'assert';
import path from 'path';
import { pathToFileURL } from 'url';

describe('ECIES canonical roundtrip', function() {
  it('encryptWithPublicKey -> decryptWithPrivateKey roundtrip returns identical symmetric key', async function() {
    // Dynamically import the ESM canonical ecies module
    const eciesPath = path.join(path.resolve(), 'tools', 'crypto', 'ecies.js');
    const eciesMod = await import(pathToFileURL(eciesPath).href);
    const ecies = eciesMod; // named exports available on module
  const secp = await import('@noble/secp256k1');
  const crypto = await import('crypto');

  // deterministic symmetric key (32 bytes) as hex
  const symKey = Buffer.from('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex').toString('hex');

  // generate a random private key (32 bytes) using Node crypto
  const privBuf = crypto.randomBytes(32);
  const privArr = Uint8Array.from(privBuf);
  const privHex = Array.from(privArr).map(b => b.toString(16).padStart(2, '0')).join('');
  const pubArr = secp.getPublicKey(privArr, false);
  const pubHex = Array.from(pubArr).map(b => b.toString(16).padStart(2, '0')).join('');

    const encrypted = await ecies.encryptWithPublicKey(pubHex, symKey);
    const decrypted = await ecies.decryptWithPrivateKey(privHex, encrypted);

    assert.strictEqual(decrypted, symKey, 'decrypted symmetric key should match the original');
  });
});
