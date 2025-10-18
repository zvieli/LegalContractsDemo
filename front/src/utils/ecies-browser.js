import * as secp from '@noble/secp256k1';
import { Buffer } from 'buffer';

function strip0x(s) { if (!s && s !== 0) return s; let t = String(s).trim(); if (t.startsWith('0x')) t = t.slice(2); return t; }

function hexToUint8(hex) {
  const s = strip0x(hex);
  const len = s.length / 2;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(s.substr(i*2,2), 16);
  return out;
}

function uint8ToHex(u8) {
  return Array.from(u8).map(b => b.toString(16).padStart(2,'0')).join('');
}

export function normalizePublicKeyHex(pub) {
  if (!pub) throw new Error('public key required');
  let s = strip0x(pub).toLowerCase();
  // If already uncompressed 04-prefixed (130 hex chars)
  if (s.length === 130 && s.startsWith('04')) return s;
  // If hex is 128 (no 04 prefix) - add it
  if (s.length === 128) return ('04' + s).toLowerCase();
  // If compressed (66 chars) - expand using noble
  if (s.length === 66 && (s.startsWith('02') || s.startsWith('03'))) {
    const tries = [
      () => secp.Point.fromHex(s),
      () => secp.Point.fromHex('0x' + s),
      () => secp.Point.fromHex(hexToUint8(s)),
      () => secp.Point.fromHex(Buffer.from(s, 'hex')),
    ];
    for (const fn of tries) {
      try {
        const p = fn();
        // if noble Point exposes toRawBytes, use it
        if (p && typeof p.toRawBytes === 'function') return uint8ToHex(p.toRawBytes(false)).toLowerCase();
        // if Point-like object exposes x and y as BigInt or hex, construct uncompressed pub
        if (p && (p.x !== undefined && p.y !== undefined)) {
          // convert BigInt or numeric to 32-byte hex
          const toHex32 = (v) => {
            let h = typeof v === 'bigint' ? v.toString(16) : String(v);
            // if hex string with 0x, strip
            if (h.startsWith('0x')) h = h.slice(2);
            h = h.padStart(64, '0');
            return h.slice(-64);
          };
          const xh = toHex32(p.x);
          const yh = toHex32(p.y);
          return ('04' + xh + yh).toLowerCase();
        }
      } catch (e) {
        // try next
      }
    }
  }
  // If 64-char raw X (no prefix), add 04
  if (s.length === 64) return ('04' + s).toLowerCase();
  // otherwise, return as-is lowercased
  return s.toLowerCase();
}

export async function getPublicKeyFromPrivate(privHex) {
  const strip = strip0x(privHex);
  const priv = hexToUint8(strip);
  const pub = secp.getPublicKey(priv, false); // uncompressed Uint8Array
  return uint8ToHex(pub).toLowerCase();
}

export async function decryptWithPrivateKey(privHex, enc) {
  if (!privHex) throw new Error('private key required');
  const priv = hexToUint8(strip0x(privHex));
  const encObj = (typeof enc === 'string') ? JSON.parse(enc) : enc;
  const iv = hexToUint8(encObj.iv);
  const ephemHex = normalizePublicKeyHex(encObj.ephemPublicKey);
  const ephem = hexToUint8(ephemHex);
  const ct = hexToUint8(encObj.ciphertext);
  const tag = hexToUint8(encObj.mac);

  // noble returns shared secret as Uint8Array
  const shared = secp.getSharedSecret(priv, ephem);
  // KDF: last 32 bytes of shared, then SHA-256
  const sharedBuf = shared instanceof Uint8Array ? shared : new Uint8Array(shared);
  const last = sharedBuf.length > 32 ? sharedBuf.slice(sharedBuf.length - 32) : sharedBuf;
  const keyBuf = await globalThis.crypto.subtle.digest('SHA-256', last);
  const key = new Uint8Array(keyBuf);

  // AES-GCM expects ciphertext with tag appended in WebCrypto
  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(ct, 0);
  combined.set(tag, ct.length);

  const cryptoKey = await globalThis.crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  try {
    const plainBuf = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, cryptoKey, combined);
    const dec = new TextDecoder().decode(plainBuf);
    return dec; // expected to be symmetric key hex
  } catch (e) {
    throw new Error('ecies-browser decryption failed: ' + (e && e.message ? e.message : e));
  }
}

export default { getPublicKeyFromPrivate, decryptWithPrivateKey };
