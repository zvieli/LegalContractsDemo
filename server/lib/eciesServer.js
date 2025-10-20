import { encryptWithAdminPubKey, decryptWithAdminPrivKey } from './crypto.js';

export async function encryptForAdmin(plaintext, adminPubPem) {
  return await encryptWithAdminPubKey(plaintext, adminPubPem);
}

export async function decryptForAdmin(envelope, adminPrivPem) {
  // Try the X25519-based decrypt first
  try {
    return await decryptWithAdminPrivKey(envelope, adminPrivPem);
  } catch (e) {
    // If adminPrivPem appears to be an Ethereum/secp256k1 key (0x...), try eth-crypto fallback
    try {
      const maybeHex = String(adminPrivPem || '').trim();
      if (/^0x[0-9a-fA-F]{64}$/.test(maybeHex)) {
        // dynamic import eth-crypto
        const EthCrypto = (await import('eth-crypto')).default || (await import('eth-crypto'));
        // eth-crypto expects ciphertext object with iv, ephemPublicKey, ciphertext, mac or similar
        // Our envelope may already be that object (from frontend). Try decryptWithPrivateKey directly.
        try {
          const env = envelope;
          // if envelope has older key names, try to normalize
          const normalized = env && (env.epk || env.ephemeralPublicKey || env.ephemPublicKey) ? {
            iv: env.iv,
            ephemPublicKey: env.epk || env.ephemeralPublicKey || env.ephemPublicKey,
            ciphertext: env.ciphertext || env.cipher || env.data,
            mac: env.mac
          } : env;
          const privNo0x = maybeHex.startsWith('0x') ? maybeHex.slice(2) : maybeHex;
          const decrypted = await EthCrypto.decryptWithPrivateKey(privNo0x, normalized);
          return typeof decrypted === 'string' ? decrypted : JSON.stringify(decrypted);
        } catch (e2) {
          // fall through to throw outer
        }
      }
    } catch (e3) {
      // ignore and rethrow original
    }
    throw e;
  }
}

export default { encryptForAdmin, decryptForAdmin };
