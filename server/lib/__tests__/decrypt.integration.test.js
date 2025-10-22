import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { decryptWithAdminPrivKey } from '../decrypt.js';

describe('decryptWithAdminPrivKey integration', () => {
  it('decrypts ciphertext encrypted with the corresponding public key (RSA-OAEP SHA256)', async () => {
    // generate keypair
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'pkcs1', format: 'pem' }, privateKeyEncoding: { type: 'pkcs1', format: 'pem' } });

    const plaintext = 'This is a secret message for integration test.';

    const encrypted = crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(plaintext));
    const b64 = encrypted.toString('base64');

    // set env var for decrypt function
    process.env.ADMIN_PRIV_KEY = privateKey;

    const out = decryptWithAdminPrivKey(b64);
    expect(out).toBe(plaintext);
  });
});
