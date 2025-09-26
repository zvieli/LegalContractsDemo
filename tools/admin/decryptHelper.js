import EthCrypto from 'eth-crypto';

/**
 * Admin-only helper to decrypt EthCrypto JSON payloads using private key.
 * This module is intended to run in a trusted admin environment (server or CLI),
 * not in browser-bundled front-end code.
 */

function normalizePrivateKey(pk) {
  if (!pk) throw new Error('private key required');
  return pk.startsWith('0x') ? pk.slice(2) : pk;
}

export async function decryptEvidencePayload(payloadJson, adminPrivateKey) {
  if (!payloadJson) return null;
  try {
    const raw = typeof payloadJson === 'string' ? JSON.parse(payloadJson) : payloadJson;
    const pk = normalizePrivateKey(adminPrivateKey);
    // EthCrypto.decryptWithPrivateKey expects the eth-crypto ciphertext object
    // Some payloads are wrapped as { version: '1', crypto: { ... } }
    const cipher = raw && raw.crypto ? raw.crypto : raw;
    if (!cipher || typeof cipher !== 'object') throw new Error('invalid ciphertext payload');
    // EthCrypto.decryptWithPrivateKey expects a private key without 0x prefix
    const plain = await EthCrypto.decryptWithPrivateKey(pk, cipher);
    return plain;
  } catch (e) {
    throw new Error('Failed to decrypt payload: ' + String(e && e.message ? e.message : e));
  }
}

export function decryptRationale(rationaleJson, partyPrivateKey) {
  return decryptEvidencePayload(rationaleJson, partyPrivateKey);
}
