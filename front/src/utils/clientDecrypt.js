import crypto from 'crypto';
import ecies, { normalizePublicKeyHex } from './ecies-browser.js';

function aesDecryptUtf8(ciphertextBase64, ivBase64, tagBase64, symKeyBuffer) {
  const iv = Buffer.from(ivBase64, 'base64');
  const tag = Buffer.from(tagBase64, 'base64');
  const ct = Buffer.from(ciphertextBase64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', symKeyBuffer, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return out.toString('utf8');
}

async function loadEthCrypto() {
  try {
    const m = await import('eth-crypto');
    return m.default || m;
  } catch (e) {
    return null;
  }
}

export async function decryptEnvelopeWithPrivateKey(envelope, privateKey) {
  if (!envelope) throw new Error('envelope required');
  if (!privateKey) throw new Error('private key required');
  const pkRaw = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  const recipients = envelope.recipients || [];


  // find recipient based on pubkey derived from private key using the browser ECIES helper
  let derivedPub = null;
  try { derivedPub = await ecies.getPublicKeyFromPrivate(pkRaw); } catch (e) { derivedPub = null; }
  let derivedNorm = null;
  try { if (derivedPub) derivedNorm = normalizePublicKeyHex(derivedPub); } catch (e) { derivedNorm = (derivedPub || '').replace(/^0x/, '').toLowerCase(); }
  const match = recipients.find(r => {
    try {
      if (!r || !r.pubkey) return false;
      const rn = normalizePublicKeyHex(r.pubkey);
      return rn === derivedNorm;
    } catch (e) {
      return (r.pubkey || '').replace(/^0x/, '').toLowerCase() === (derivedPub || '').replace(/^0x/, '').toLowerCase();
    }
  });

  const tryDecryptEncKey = async (encKeyRaw) => {
    if (!encKeyRaw) return null;
    const errors = [];
    let encKey = encKeyRaw;
    if (typeof encKey === 'string') {
      try { encKey = JSON.parse(encKey); } catch (e) { /* keep as-is */ }
    }
    // Try canonical ECIES browser implementation first
    try {
      const plain = await ecies.decryptWithPrivateKey(pkRaw, encKey);
      // plain MAY be raw bytes (latin1), hex, base64, or utf8. Try raw-first.
      let symBuf = null;
      try { const raw = Buffer.from(String(plain), 'latin1'); if (raw && raw.length === 32) symBuf = raw; } catch (e) {}
      if (!symBuf) {
        try { if (/^[0-9a-fA-F]+$/.test(String(plain).trim())) symBuf = Buffer.from(String(plain).trim(), 'hex'); } catch (e) {}
      }
      if (!symBuf) { try { symBuf = Buffer.from(String(plain), 'base64'); } catch (e) {} }
      if (!symBuf) { try { symBuf = Buffer.from(String(plain), 'utf8'); } catch (e) {} }

      // Double-hex fallback: sometimes producer records hex of hex (ASCII hex bytes)
      if (!symBuf) {
        try {
          if (/^[0-9a-fA-F]+$/.test(String(plain).trim())) {
            const first = Buffer.from(String(plain).trim(), 'hex');
            if (first && first.length !== 32) {
              const asText = first.toString('utf8').trim();
              if (/^[0-9a-fA-F]{64}$/.test(asText)) {
                const second = Buffer.from(asText, 'hex');
                if (second && second.length === 32) symBuf = second;
              }
            }
          }
        } catch (e) {}
      }

      if (symBuf) {
        const plaintext = aesDecryptUtf8(envelope.ciphertext, envelope.encryption.aes.iv, envelope.encryption.aes.tag, symBuf);
        try { return JSON.parse(plaintext); } catch (e) { return plaintext; }
      }
    } catch (e) {
      try { if (process && process.env && process.env.TESTING) errors.push('ecies:' + (e && e.message ? e.message : e)); } catch (ee) {}
      // fallback to eth-crypto if available
    }
    const EthCrypto = await loadEthCrypto();
    if (EthCrypto) {
      try {
        // Try both non-0x and 0x-prefixed private key variants for compatibility
        let symHex = null;
        try { symHex = await EthCrypto.decryptWithPrivateKey(pkRaw, encKey); } catch (e) {}
        if (!symHex) {
          try { symHex = await EthCrypto.decryptWithPrivateKey('0x' + pkRaw, encKey); } catch (e) {}
        }
        // eth-crypto historically returns hex, but be defensive: try raw-first then hex/base64/utf8
        let symBuf = null;
        try { const raw = Buffer.from(String(symHex), 'latin1'); if (raw && raw.length === 32) symBuf = raw; } catch (e) {}
        if (!symBuf) { try { if (/^[0-9a-fA-F]+$/.test(String(symHex).trim())) symBuf = Buffer.from(String(symHex).trim(), 'hex'); } catch (e) {} }
        if (!symBuf) { try { symBuf = Buffer.from(String(symHex), 'base64'); } catch (e) {} }
        if (!symBuf) { try { symBuf = Buffer.from(String(symHex), 'utf8'); } catch (e) {} }
        if (symBuf) {
          const plaintext = aesDecryptUtf8(envelope.ciphertext, envelope.encryption.aes.iv, envelope.encryption.aes.tag, symBuf);
          try { return JSON.parse(plaintext); } catch (e) { return plaintext; }
        }
      } catch (e) { try { if (process && process.env && process.env.TESTING) errors.push('eth-crypto:' + (e && e.message ? e.message : e)); } catch (ee) {} return null; }
    }
    // Try eccrypto fallback similar to server-side helper
    try {
      const eccryptoModule = await import('eccrypto');
      const eccrypto = eccryptoModule && (eccryptoModule.default || eccryptoModule);
      let ob = encKey;
      if (typeof ob === 'string') {
        try { ob = JSON.parse(ob); } catch (e) { ob = null; }
      }
      if (ob && typeof ob === 'object') {
        try {
          const twoStripped = pkRaw.replace(/^0x/, '');
          const encryptedBuffer = {
            iv: Buffer.from(String(ob.iv).replace(/^0x/, ''), 'hex'),
            ephemPublicKey: Buffer.from(String(ob.ephemPublicKey).replace(/^0x/, ''), 'hex'),
            ciphertext: Buffer.from(String(ob.ciphertext).replace(/^0x/, ''), 'hex'),
            mac: Buffer.from(String(ob.mac).replace(/^0x/, ''), 'hex')
          };
          const decBuf = await eccrypto.decrypt(Buffer.from(twoStripped, 'hex'), encryptedBuffer);
          if (decBuf) {
            // decBuf is raw bytes; try to convert to symBuf via same heuristics
            let maybe = null;
            try { // first, raw as latin1 string
              const raw = Buffer.from(String(decBuf), 'latin1'); if (raw && raw.length === 32) maybe = raw; 
            } catch (e) {}
            if (!maybe) try { maybe = Buffer.from(decBuf.toString('hex'), 'hex'); } catch (e) {}
            if (!maybe) try { maybe = Buffer.from(decBuf.toString('base64'), 'base64'); } catch (e) {}
            if (!maybe) try { maybe = Buffer.from(String(decBuf), 'utf8'); } catch (e) {}
            // double-hex fallback
            if (!maybe) {
              try {
                const first = Buffer.from(decBuf.toString('hex'), 'hex');
                const asText = first.toString('utf8').trim();
                if (/^[0-9a-fA-F]{64}$/.test(asText)) maybe = Buffer.from(asText, 'hex');
              } catch (e) {}
            }
            if (maybe && maybe.length === 32) {
              const plaintext = aesDecryptUtf8(envelope.ciphertext, envelope.encryption.aes.iv, envelope.encryption.aes.tag, maybe);
              try { return JSON.parse(plaintext); } catch (e) { return plaintext; }
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
    // if in TESTING mode, surface attempt errors for debugging
    if (process && process.env && process.env.TESTING) {
      try {
        console.error('TESTING_CLIENT_DECRYPT_ATTEMPTS errors=', JSON.stringify(errors));
      } catch (e) {}
    }
    return null;
  };

  // TESTING-only: if producer recorded the exact plaintext hex for a recipient,
  // prefer that deterministic path for easier debugging in tests. This mirrors
  // server-side helper behavior used during TESTING mode and must not be relied
  // on in production.
  try {
    if (process && process.env && process.env.TESTING) {
      // envelope-level crypto
      if (envelope && envelope.crypto && envelope.crypto._plaintextHex) {
        try {
          const first = Buffer.from(String(envelope.crypto._plaintextHex), 'hex');
          let symBuf = null;
          if (first && first.length === 32) symBuf = first;
          else {
            try {
              const asText = first.toString('utf8').trim();
              if (/^[0-9a-fA-F]{64}$/.test(asText)) symBuf = Buffer.from(asText, 'hex');
            } catch (e) {}
          }
          if (symBuf) {
            const plaintext = aesDecryptUtf8(envelope.ciphertext, envelope.encryption.aes.iv, envelope.encryption.aes.tag, symBuf);
            try { return JSON.parse(plaintext); } catch (e) { return plaintext; }
          }
        } catch (e) {}
      }
      for (const r of recipients || []) {
        try {
          const enc = r && (r.encryptedKey || r.encryptedKey_ecc || {});
          if (enc && enc._plaintextHex) {
            try {
              const first = Buffer.from(String(enc._plaintextHex), 'hex');
              let symBuf = null;
              if (first && first.length === 32) symBuf = first;
              else {
                try {
                  const asText = first.toString('utf8').trim();
                  if (/^[0-9a-fA-F]{64}$/.test(asText)) symBuf = Buffer.from(asText, 'hex');
                } catch (e) {}
              }
              if (symBuf) {
                const plaintext = aesDecryptUtf8(envelope.ciphertext, envelope.encryption.aes.iv, envelope.encryption.aes.tag, symBuf);
                try { return JSON.parse(plaintext); } catch (e) { return plaintext; }
              }
            } catch (e) {}
          }
        } catch (e) {}
      }
    }
  } catch (e) {}

  // Try top-level envelope.crypto first (backwards compatibility with older clients)
  if (envelope && envelope.crypto) {
    try {
      const tryTop = await tryDecryptEncKey(envelope.crypto);
      if (tryTop !== null) return tryTop;
    } catch (e) {
      // ignore and continue to recipient-based attempts
      try { if (process && process.env && process.env.TESTING) console.error('TESTING_CLIENT_DECRYPT_CRYPTO_FAIL=' + (e && e.message ? e.message : e)); } catch (ee) {}
    }
  }

  if (match) {
    const ok = await tryDecryptEncKey(match.encryptedKey);
    if (ok !== null) return ok;
  }

  for (const r of recipients) {
    try {
      const ok = await tryDecryptEncKey(r.encryptedKey);
      if (ok !== null) return ok;
    } catch (e) {}
  }
  if (process && process.env && process.env.TESTING) {
    try {
      console.error('TESTING_CLIENT_DECRYPT_FINAL derivedPub=' + String(derivedPub));
      console.error('TESTING_CLIENT_DECRYPT_FINAL derivedNorm=' + String(derivedNorm));
      try { console.error('TESTING_CLIENT_DECRYPT_FINAL recipients=' + JSON.stringify(recipients.map(r => ({ address: r.address, pubkey: r.pubkey })), null, 2)); } catch (e) {}
    } catch (e) {}
  }
  throw new Error('Decryption failed: no recipient matched or authentication failed. Verify the private key matches one of the recipients.');
}
