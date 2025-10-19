import fs from 'fs';
import path from 'path';

// Try to reuse canonical ECIES implementation if present under tools/admin or crypto
let canonical = null;
async function loadCanonical() {
  if (canonical) return canonical;
  try {
    const mod = await import('../../tools/admin/../crypto/ecies.js');
    canonical = mod && (mod.default || mod);
    return canonical;
  } catch (e) {
    try {
      const mod2 = await import('../../tools/admin/decryptHelper.js');
      canonical = mod2 && (mod2.default || mod2);
      return canonical;
    } catch (e2) {
      canonical = null;
      return null;
    }
  }
}

// Helper: encrypt plaintext string to admin public key using hybrid envelope
// Returns { ciphertextEnvelope (object), digest }
export async function encryptForAdmin(plaintext, adminPublicKeyHex) {
  if (!plaintext) throw new Error('plaintext required');
  if (!adminPublicKeyHex) throw new Error('adminPublicKeyHex required');

  const can = await loadCanonical();
  // If canonical module provides encryptWithPublicKey, use it
  if (can && typeof can.encryptWithPublicKey === 'function') {
    // Some canonical modules expect non-0x hex
    const pub = String(adminPublicKeyHex).startsWith('0x') ? String(adminPublicKeyHex).slice(2) : String(adminPublicKeyHex);
    const enc = await can.encryptWithPublicKey(pub, String(plaintext));
    const envelope = (typeof enc === 'string') ? JSON.parse(enc) : enc;
    // compute digest using keccak256 if available on module, otherwise leave null
    let digest = null;
    try {
      const { keccak256, toUtf8Bytes } = await import('ethers').then(m => ({ keccak256: m.ethers ? m.ethers.keccak256 : m.keccak256, toUtf8Bytes: m.toUtf8Bytes ? m.toUtf8Bytes : (s)=>Buffer.from(String(s),'utf8') }));
      // Use ethers.keccak256 if available
      if (typeof digest === 'undefined' || digest === null) {
        try {
          const e = await import('ethers');
          digest = e.ethers ? e.ethers.keccak256(e.ethers.toUtf8Bytes(JSON.stringify(envelope))) : e.keccak256(e.toUtf8Bytes(JSON.stringify(envelope)));
        } catch (e) {
          // fallback
          digest = null;
        }
      }
    } catch (e) {}
    return { envelope: envelope, digest };
  }

  // Fallback: attempt to use eth-crypto via dynamic import
  let EthCrypto = null;
  try {
    EthCrypto = (await import('eth-crypto')).default || (await import('eth-crypto'));
  } catch (e) {
    throw new Error('No ECIES implementation available on server. Install canonical ECIES under tools/admin/crypto or add `eth-crypto` to server deps.');
  }
  const pubNo0x = String(adminPublicKeyHex).startsWith('0x') ? String(adminPublicKeyHex).slice(2) : String(adminPublicKeyHex);
  const ct = await EthCrypto.encryptWithPublicKey(pubNo0x, String(plaintext));
  const envelope = ct && typeof ct === 'string' ? JSON.parse(ct) : ct;
  // compute digest using ethers if available
  let digest = null;
  try {
    const e = await import('ethers');
    digest = e.ethers ? e.ethers.keccak256(e.ethers.toUtf8Bytes(JSON.stringify(envelope))) : e.keccak256(e.toUtf8Bytes(JSON.stringify(envelope)));
  } catch (e) {}
  return { envelope, digest };
}

export default { encryptForAdmin };
