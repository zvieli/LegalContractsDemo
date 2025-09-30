import crypto from 'crypto';

// Dynamic import eth-crypto to avoid bundling by default.
async function loadEthCrypto() {
  try {
    const m = await import('eth-crypto');
    return m.default || m;
  } catch (e) {
    throw new Error('eth-crypto is required for client-side decryption. Install it in the frontend or use admin CLI.');
  }
}

function aesDecryptUtf8(ciphertextBase64, ivBase64, tagBase64, symKeyBuffer) {
  const iv = Buffer.from(ivBase64, 'base64');
  const tag = Buffer.from(tagBase64, 'base64');
  const ct = Buffer.from(ciphertextBase64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', symKeyBuffer, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return out.toString('utf8');
}

export async function decryptEnvelopeWithPrivateKey(envelope, privateKey) {
  if (!envelope) throw new Error('envelope required');
  if (!privateKey) throw new Error('private key required');
  const EthCrypto = await loadEthCrypto();
  const pk = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  // find recipient entry that matches this private key's pubkey
  const pub = EthCrypto.publicKeyByPrivateKey(pk);
  const normPub = pub && pub.startsWith('0x') ? pub.slice(2) : pub;
  const recipients = envelope.recipients || [];
  const match = recipients.find(r => {
    if (!r) return false;
    if (r.pubkey && r.pubkey.replace(/^0x/, '').toLowerCase() === normPub.toLowerCase()) return true;
    if (r.address && r.address.toLowerCase() === (envelope.sender || '').toLowerCase()) return true;
    return false;
  });
  // If we found a likely recipient, try it first
  const tryDecryptEncKey = async (encKeyRaw) => {
    let encKey = encKeyRaw;
    if (!encKey) return null;
    if (typeof encKey === 'string') {
      try { encKey = JSON.parse(encKey); } catch (e) { /* keep as-is */ }
    }
    try {
      const symHex = await EthCrypto.decryptWithPrivateKey(pk, encKey);
      const symBuf = Buffer.from(String(symHex), 'hex');
      const plaintext = aesDecryptUtf8(envelope.ciphertext, envelope.encryption.aes.iv, envelope.encryption.aes.tag, symBuf);
      try { return JSON.parse(plaintext); } catch (e) { return plaintext; }
    } catch (e) {
      return null;
    }
  };

  if (match) {
    const ok = await tryDecryptEncKey(match.encryptedKey);
    if (ok !== null) return ok;
  }

  // fallback: try every recipient entry (helps when pubkey/address mappings differ)
  for (const r of recipients) {
    try {
      const ok = await tryDecryptEncKey(r.encryptedKey);
      if (ok !== null) return ok;
    } catch (e) { /* ignore and continue */ }
  }

  throw new Error('Decryption failed: no recipient matched or authentication failed. Verify the private key matches one of the recipients.');
}
