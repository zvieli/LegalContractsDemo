// Client-side decryption helper (admin-only UI use).
// WARNING: This runs in the browser. Do NOT store admin private keys in frontend persistent storage.

export async function decryptCiphertextJson(ciphertextJson, privateKey) {
  if (!ciphertextJson) throw new Error('ciphertextJson required');
  if (!privateKey) throw new Error('privateKey required');
  // allow passing either object or string
  const raw = typeof ciphertextJson === 'string' ? JSON.parse(ciphertextJson) : ciphertextJson;
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

  try {
    const plain = await EthCrypto.decryptWithPrivateKey(pk, raw);
    return plain;
  } catch (e) {
    throw new Error('Decryption failed: ' + (e?.message || e));
  }
}
