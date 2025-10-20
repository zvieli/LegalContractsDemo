import { webcrypto } from 'crypto';

// Minimal hybrid scheme using X25519 to derive a symmetric key + AES-GCM for payload
// This file provides encryptForAdmin and decryptWithAdminPrivKey utilities.

const subtle = webcrypto.subtle;

async function importAdminPubKeyRaw(pem) {
  // Accept PEM (base64 DER) or raw base64
  const clean = String(pem).trim().replace(/-----(BEGIN|END)[\s\S]*?KEY-----/g, '').replace(/\s+/g, '');
  const der = Buffer.from(clean, 'base64');
  // Try multiple import formats: raw (32 bytes) or spki (SubjectPublicKeyInfo)
  try {
    return await subtle.importKey('raw', der, { name: 'X25519' }, true, []);
  } catch (e) {
    try {
      return await subtle.importKey('spki', der, { name: 'X25519' }, true, []);
    } catch (e2) {
      throw new Error('Unsupported public key format for X25519');
    }
  }
}

async function importAdminPrivKeyRaw(pem) {
  const clean = String(pem).trim().replace(/-----(BEGIN|END)[\s\S]*?KEY-----/g, '').replace(/\s+/g, '');
  const der = Buffer.from(clean, 'base64');
  // Try raw private key or PKCS8
  try {
    return await subtle.importKey('raw', der, { name: 'X25519' }, true, ['deriveBits']);
  } catch (e) {
    try {
      return await subtle.importKey('pkcs8', der, { name: 'X25519' }, true, ['deriveBits']);
    } catch (e2) {
      throw new Error('Unsupported private key format for X25519');
    }
  }
}

async function generateEphemeralKeyPair() {
  return await subtle.generateKey({ name: 'X25519', namedCurve: 'X25519' }, true, ['deriveBits']);
}

async function deriveSharedSecret(privKey, pubKey) {
  const bits = await subtle.deriveBits({ name: 'X25519', public: pubKey }, privKey, 256);
  return new Uint8Array(bits);
}

async function hkdf(secret, info = new Uint8Array([]), length = 32) {
  // Simple HKDF using SHA-256
  const salt = new Uint8Array(32);
  const key = await subtle.importKey('raw', secret, { name: 'HKDF' }, false, ['deriveKey']);
  const derived = await subtle.deriveKey({ name: 'HKDF', salt, info, hash: 'SHA-256' }, key, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  return derived;
}

function toBase64(u8) { return Buffer.from(u8).toString('base64'); }
function fromBase64(s) { return Uint8Array.from(Buffer.from(s, 'base64')); }

export async function encryptWithAdminPubKey(plaintext, adminPubKeyPem) {
  // plaintext: string
  const adminPub = await importAdminPubKeyRaw(adminPubKeyPem);
  const eph = await generateEphemeralKeyPair();
  const ephPubRaw = await subtle.exportKey('raw', eph.publicKey);
  const shared = await deriveSharedSecret(eph.privateKey, adminPub);
  const derivedKey = await hkdf(shared);
  // export derived symmetric key as CryptoKey
  const symKey = derivedKey;
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(plaintext);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, symKey, enc);
  return {
    envelope: {
      epk: toBase64(new Uint8Array(ephPubRaw)),
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(ct))
    }
  };
}

export async function decryptWithAdminPrivKey(envelope, adminPrivKeyPem) {
  const { epk, iv, ciphertext } = envelope;
  const priv = await importAdminPrivKeyRaw(adminPrivKeyPem);
  const ephPubRaw = fromBase64(epk);
  const pub = await subtle.importKey('raw', ephPubRaw, { name: 'X25519' }, true, []);
  const shared = await deriveSharedSecret(priv, pub);
  const derivedKey = await hkdf(shared);
  const symKey = derivedKey;
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, symKey, fromBase64(ciphertext));
  return new TextDecoder().decode(plain);
}
