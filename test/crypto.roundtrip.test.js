import assert from 'assert';
import { webcrypto } from 'crypto';
import { encryptWithAdminPubKey, decryptWithAdminPrivKey } from '../server/lib/crypto.js';

const subtle = webcrypto.subtle;

async function generateKeypairBase64() {
  const kp = await subtle.generateKey({ name: 'X25519', namedCurve: 'X25519' }, true, ['deriveBits']);
  // export public as spki and private as pkcs8 (DER) to match import helpers
  const pubRaw = await subtle.exportKey('spki', kp.publicKey);
  const privRaw = await subtle.exportKey('pkcs8', kp.privateKey);
  const pubB64 = Buffer.from(pubRaw).toString('base64');
  const privB64 = Buffer.from(privRaw).toString('base64');
  return { pubB64, privB64 };
}

describe('crypto hybrid roundtrip', function () {
  it('encrypts and decrypts with generated X25519 keys', async function () {
    this.timeout(5000);
    const { pubB64, privB64 } = await generateKeypairBase64();
    const plaintext = JSON.stringify({ hello: 'world', n: Date.now() });

    const { envelope } = await encryptWithAdminPubKey(plaintext, pubB64);
    assert.ok(envelope && envelope.epk && envelope.ciphertext, 'envelope shape');

    const decrypted = await decryptWithAdminPrivKey(envelope, privB64);
    assert.strictEqual(decrypted, plaintext);
  });
});
