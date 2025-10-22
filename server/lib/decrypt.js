import crypto from 'crypto';
const { createPrivateKey, privateDecrypt, constants } = crypto;

/**
 * Decrypt ciphertext (base64) using ADMIN_PRIV_KEY or ADMIN_PRIVATE_KEY (PEM) from env.
 * Returns decrypted UTF-8 string. Throws on failure.
 */
export function decryptWithAdminPrivKey(ciphertext) {
  const privPem = process.env.ADMIN_PRIV_KEY || process.env.ADMIN_PRIVATE_KEY;
  if (!privPem) throw new Error('ADMIN_PRIV_KEY not configured in environment');

  // Accept ciphertext as base64 or raw string. Try base64 first.
  let buffer = null;
  try {
    buffer = Buffer.from(ciphertext, 'base64');
    // Heuristic: base64 decode should produce bytes; if it results in same string length and contains non-binary,
    // we'll still try decryption and let it fail.
  } catch (e) {
    // fallback: treat ciphertext as utf8 bytes
    buffer = Buffer.from(String(ciphertext), 'utf8');
  }

  const key = createPrivateKey(privPem);
  try {
    const decrypted = privateDecrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, buffer);
    return decrypted.toString('utf8');
  } catch (err) {
    // If RSA decryption fails, rethrow to allow caller to fallback
    throw err;
  }
}

export default { decryptWithAdminPrivKey };
