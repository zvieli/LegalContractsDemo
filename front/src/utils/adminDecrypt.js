// Client-side decryption helper (admin-only UI use).
// WARNING: This runs in the browser. Do NOT store admin private keys in frontend persistent storage.

export async function decryptCiphertextJson(ciphertextJsonOrString, privateKey) {
  if (!ciphertextJsonOrString) throw new Error('ciphertext input required');
  if (!privateKey) throw new Error('privateKey required');

  // Normalize private key (strip 0x if present)
  const pk = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;

  // Lazy-load eth-crypto so it isn't pulled into the initial client bundle.
  // This keeps admin-only Node-focused code out of the main frontend unless the
  // admin decrypt UI is explicitly used.
  let EthCrypto;
  try {
    const mod = await import('eth-crypto');
    EthCrypto = mod.default || mod;
  } catch (err) {
    throw new Error('Client-side decryption requested but `eth-crypto` is not available. For production keep decryption in `tools/admin`. For local demos you may install `eth-crypto` in `front/` as an explicit opt-in.');
  }

  // We accept several possible input shapes from the UI:
  //  - JSON string representing the eth-crypto ciphertext object
  //  - Plain JS object (already parsed)
  //  - Base64 or hex encoded JSON (common when copying compact payloads)
  //  - A compact ciphertext string (not typical for eth-crypto) - we'll try to parse as JSON first
  let parsed = null;
  if (typeof ciphertextJsonOrString === 'object') {
    parsed = ciphertextJsonOrString;
  } else {
    const s = ciphertextJsonOrString.trim();
    // Try JSON.parse first
    try {
      parsed = JSON.parse(s);
    } catch (e) {
      // Not plain JSON. Try base64-decoding to JSON
      try {
        // atob may not exist in all environments; use Buffer as fallback
        let jsonText;
        if (typeof atob === 'function') {
          jsonText = atob(s);
        } else if (typeof Buffer !== 'undefined') {
          // Remove 0x if someone pasted a hex string that encodes base64 by mistake
          const maybeBase64 = s.startsWith('0x') ? s.slice(2) : s;
          try {
            jsonText = Buffer.from(maybeBase64, 'base64').toString('utf8');
          } catch (bErr) {
            jsonText = null;
          }
        }
        if (jsonText) parsed = JSON.parse(jsonText);
      } catch (b) {
        // fall through
      }

      // If still not parsed, try treating input as hex-encoded JSON
      if (!parsed) {
        try {
          const hex = s.startsWith('0x') ? s.slice(2) : s;
          const buf = typeof Buffer !== 'undefined' ? Buffer.from(hex, 'hex') : null;
          if (buf) {
            const txt = buf.toString('utf8');
            parsed = JSON.parse(txt);
          }
        } catch (hErr) {
          // final fallback: leave parsed null
        }
      }
    }
  }

  if (!parsed) {
    // As a last resort, if the input looks like a compact eth-crypto ciphertext object
    // (contains common fields), attempt to detect it by attempting to parse as JSON
    // from wrapped quotes or loose objects.
    // If still nothing, throw a helpful error instructing the admin to paste JSON.
    throw new Error('Unable to parse ciphertext. Provide the eth-crypto ciphertext JSON object (or base64/hex-encoded JSON).');
  }

  try {
    const plain = await EthCrypto.decryptWithPrivateKey(pk, parsed);
    return plain;
  } catch (e) {
    throw new Error('Decryption failed: ' + (e?.message || e));
  }
}
