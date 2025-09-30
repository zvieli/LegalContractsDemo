import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { decryptEnvelopeWithPrivateKey } from '../clientDecrypt.js';
import { getPublicKeyFromPrivate, normalizePublicKeyHex } from '../ecies-browser.js';
import { encryptWithPublicKey } from '../../../../tools/crypto/ecies.js';

function makeAesEnvelope(plaintext, symKeyBuffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', symKeyBuffer, iv, { authTagLength: 16 });
  const ct = Buffer.concat([cipher.update(Buffer.from(String(plaintext), 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: ct.toString('base64'), encryption: { aes: { iv: iv.toString('base64'), tag: tag.toString('base64') } } };
}

describe('clientDecrypt canonical behaviors', () => {
  it('raw-bytes-first decrypts when symmetric key is raw 32 bytes after ECIES', async () => {
    // Prepare plaintext and sym key (raw bytes)
    const payload = { ok: true, ts: Date.now() };
    const sym = crypto.randomBytes(32);
    const envBase = makeAesEnvelope(JSON.stringify(payload), sym);

    // Create ephemeral ECIES encryption of the raw sym bytes using ecies helper
    // Use ecies.encryptWithPublicKey to produce encryptedKey
  const priv = crypto.randomBytes(32).toString('hex');
  const pub = await getPublicKeyFromPrivate(priv);
  const enc = await encryptWithPublicKey(normalizePublicKeyHex(pub), sym.toString('latin1'));

    const envelope = Object.assign({}, envBase, { recipients: [{ address: '0x1', pubkey: pub, encryptedKey: enc }] });
    const decoded = await decryptEnvelopeWithPrivateKey(envelope, '0x' + priv);
    expect(decoded).toBeTruthy();
    expect(decoded.ok).toBe(true);
  });

  it('can decrypt envelope with multiple recipients (finds matching recipient)', async () => {
    const payload = { verdict: 'multi', ts: Date.now() };
    const sym = crypto.randomBytes(32);
    const envBase = makeAesEnvelope(JSON.stringify(payload), sym);

    // Create two recipients, one is the admin (which we will decrypt)
  const privA = crypto.randomBytes(32).toString('hex');
  const pubA = await getPublicKeyFromPrivate(privA);
  const encA = await encryptWithPublicKey(normalizePublicKeyHex(pubA), sym.toString('latin1'));

  const privB = crypto.randomBytes(32).toString('hex');
  const pubB = await getPublicKeyFromPrivate(privB);
  const encB = await encryptWithPublicKey(normalizePublicKeyHex(pubB), sym.toString('latin1'));

    const envelope = Object.assign({}, envBase, { recipients: [ { address: '0xdead', pubkey: pubB, encryptedKey: encB }, { address: '0xbeef', pubkey: pubA, encryptedKey: encA } ] });
    const decoded = await decryptEnvelopeWithPrivateKey(envelope, '0x' + privA);
    expect(decoded).toBeTruthy();
    expect(decoded.verdict).toBe('multi');
  });

  it('supports hex/base64/utf8 fallbacks for sym key formats', async () => {
    const payload = { verdict: 'fallback', ts: Date.now() };
    const sym = crypto.randomBytes(32);
    const envBase = makeAesEnvelope(JSON.stringify(payload), sym);

    // Create priv/public
  const priv = crypto.randomBytes(32).toString('hex');
  const pub = await getPublicKeyFromPrivate(priv);

  // Prepare encryptedKey that will decrypt to hex string of sym key
  const symHex = sym.toString('hex');
  const encHex = await encryptWithPublicKey(normalizePublicKeyHex(pub), symHex);

    const envelopeHex = Object.assign({}, envBase, { recipients: [{ address: '0x1', pubkey: pub, encryptedKey: encHex }] });
    const decodedHex = await decryptEnvelopeWithPrivateKey(envelopeHex, '0x' + priv);
    expect(decodedHex).toBeTruthy();
    expect(decodedHex.verdict).toBe('fallback');

    // base64 variant
    const symB64 = sym.toString('base64');
  const encB64 = await encryptWithPublicKey(normalizePublicKeyHex(pub), symB64);
    const envelopeB64 = Object.assign({}, envBase, { recipients: [{ address: '0x1', pubkey: pub, encryptedKey: encB64 }] });
    const decodedB64 = await decryptEnvelopeWithPrivateKey(envelopeB64, '0x' + priv);
    expect(decodedB64).toBeTruthy();
    expect(decodedB64.verdict).toBe('fallback');
  });
});
