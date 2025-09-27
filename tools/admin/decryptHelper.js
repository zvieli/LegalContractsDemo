import EthCrypto from 'eth-crypto';

// Determine secp256k1 availability and provide a consistent diagnostic across processes.
let SECP_BACKEND = 'none';
try {
  require('secp256k1');
  SECP_BACKEND = 'native';
} catch (e) {
  try {
    // try noble as a pure-js fallback
    // eslint-disable-next-line node/no-missing-require
    require('@noble/secp256k1');
    SECP_BACKEND = 'noble';
  } catch (e2) {
    SECP_BACKEND = 'browser-js';
  }
}

function normalizePrivateKey(pk) {
  if (!pk) throw new Error('private key required');
  return pk.startsWith('0x') ? pk.slice(2) : pk;
}

/**
 * Decrypt an evidence payload wrapper or raw cipher using the given private key.
 * Accepts either:
 * - An object { version: '1', crypto: {...} }
 * - A raw crypto object { ciphertext, ephemPublicKey, iv, mac }
 * - A JSON string of either of the above
 */
export async function decryptEvidencePayload(payloadOrString, privateKey) {
  if (!privateKey) throw new Error('privateKey required');
  try {
    if (process && process.env && process.env.TESTING) {
  let hasSecp = false;
  try { require('secp256k1'); hasSecp = true; } catch (e) {}
  try { console.error('TESTING_DECRYPT_ENV node=' + (process && process.versions && process.versions.node) + ' secp256k1=' + String(hasSecp) + ' backend=' + SECP_BACKEND); } catch (e) {}
    }
  } catch (e) {}
  let wrapped = payloadOrString;
  try {
    if (typeof payloadOrString === 'string') wrapped = JSON.parse(payloadOrString);
  } catch (e) {
    // ignore parse error
  }
  const raw = wrapped && typeof wrapped === 'object' ? wrapped : null;
  if (!raw) throw new Error('invalid payload');
  const cipher = raw.crypto ? raw.crypto : raw;
  if (!cipher || typeof cipher !== 'object') throw new Error('invalid ciphertext payload');
  // EthCrypto.decryptWithPrivateKey expects a private key without 0x prefix (older versions)
  const pk = normalizePrivateKey(privateKey);
  try {
    // Normalize cipher hex fields to deterministic form (strip 0x, lowercase)
    const normCipher = Object.assign({}, cipher);
    ['ephemPublicKey','iv','ciphertext','mac'].forEach(k => {
      if (normCipher[k] && typeof normCipher[k] === 'string') {
        let s = normCipher[k].trim();
        if (s.startsWith('0x')) s = s.slice(2);
        normCipher[k] = s.toLowerCase();
      }
    });
    // TESTING: log normalized cipher shapes and private key shape to help trace failures
    try {
      if (process && process.env && process.env.TESTING) {
        const cdiag = {
          ephemPublicKeyPrefix: normCipher.ephemPublicKey ? String(normCipher.ephemPublicKey).slice(0,8) : null,
          ephemPublicKeyLen: normCipher.ephemPublicKey ? String(normCipher.ephemPublicKey).length : null,
          ivLen: normCipher.iv ? String(normCipher.iv).length : null,
          ciphertextLen: normCipher.ciphertext ? String(normCipher.ciphertext).length : null,
          macLen: normCipher.mac ? String(normCipher.mac).length : null,
          privateKeyLen: pk ? String(pk).length : null,
          privateKeySuffix: pk ? String(pk).slice(-8) : null
        };
        try { console.error('TESTING_DECRYPT_NORM=' + JSON.stringify(cdiag)); } catch (e) {}
      }
    } catch (e) {}

    // Attempt multiple decrypt approaches to tolerate environment differences (native secp256k1 vs browser fallback)
    const attempts = [];
    // 1) normalized private key (no 0x) and normalized cipher (lowercase, no 0x)
    attempts.push({ priv: pk, cipher: normCipher, note: 'normPk_normCipher' });
    // 2) 0x-prefixed private key and normalized cipher
    attempts.push({ priv: '0x' + pk, cipher: normCipher, note: '0xPk_normCipher' });
    // 3) normalized private key and original cipher object (in case casing or prefixes matter)
    attempts.push({ priv: pk, cipher: cipher, note: 'normPk_origCipher' });
    // 4) normalized private key and uppercase hex cipher
    const upperCipher = Object.assign({}, normCipher);
    ['ephemPublicKey','iv','ciphertext','mac'].forEach(k => { if (upperCipher[k]) upperCipher[k] = String(upperCipher[k]).toUpperCase(); });
    attempts.push({ priv: pk, cipher: upperCipher, note: 'normPk_upperCipher' });

    let lastErr = null;
    for (const a of attempts) {
      try {
        if (process && process.env && process.env.TESTING) console.error('TESTING_DECRYPT_ATTEMPT=' + a.note);
        const plain = await EthCrypto.decryptWithPrivateKey(a.priv, a.cipher);
        // success
        return plain;
      } catch (e) {
        lastErr = e;
        try { if (process && process.env && process.env.TESTING) console.error('TESTING_DECRYPT_ATTEMPT_FAILED=' + a.note + ' err=' + (e && e.message ? e.message : String(e))); } catch (ee) {}
      }
    }
    // All attempts failed; emit the original error diagnostics below
    throw lastErr || new Error('Failed to decrypt payload');
  } catch (e) {
    // Emit TESTING diagnostics to help debug Bad MAC issues in CI/test harness
    try {
      if (process && process.env && process.env.TESTING) {
        try {
          const c = cipher || {};
          const diag = {
            ephemPublicKeyPrefix: c.ephemPublicKey ? String(c.ephemPublicKey).slice(0, 8) : null,
            ephemPublicKeyLen: c.ephemPublicKey ? String(c.ephemPublicKey).length : null,
            ivLen: c.iv ? String(c.iv).length : null,
            ciphertextLen: c.ciphertext ? String(c.ciphertext).length : null,
            macLen: c.mac ? String(c.mac).length : null
          };
          console.error('TESTING_DECRYPT_DIAG=' + JSON.stringify(diag));
        } catch (ee) {}
      }
    } catch (ee) {}
    throw new Error('Failed to decrypt payload: ' + String(e && e.message ? e.message : e));
  }
}

export function decryptRationale(rationaleJson, partyPrivateKey) {
  return decryptEvidencePayload(rationaleJson, partyPrivateKey);
}
