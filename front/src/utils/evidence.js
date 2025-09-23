import * as ethers from 'ethers';

/**
 * Client-side evidence helpers (Option A flow).
 *
 * Responsibilities:
 * - Optionally encrypt a payload to an admin public key (ECIES via `eth-crypto`).
 * - Compute the on-chain digest (keccak256) of the ciphertext (recommended) or
 *   of the plaintext if you intentionally skip encryption.
 *
 * Notes:
 * - This module will attempt a dynamic import of `eth-crypto` when encryption
 *   is requested. IMPORTANT: do NOT bundle admin private-key libraries into
 *   production client bundles. The recommended pattern is:
 *     - Keep admin private keys and decryption tooling under `tools/admin`.
 *     - If you need client-side encryption for a demo, enable `eth-crypto`
 *       explicitly in your frontend build and accept the security tradeoffs.
 * - The admin public key format expected by `eth-crypto` helpers is the raw
 *   unprefixed public key without the leading 0x04 (e.g. '04...' -> '04...' trimming
 *   only the 0x). Check your admin tooling for the exact format used in tests.
 */

export function computeDigestForText(text) {
  const s = text ? String(text) : '';
  return s ? ethers.keccak256(ethers.toUtf8Bytes(s)) : ethers.ZeroHash;
}

export function computeDigestForCiphertext(ciphertext) {
  // ciphertext should be a string (JSON or hex). We compute keccak256 over its UTF-8 bytes.
  const s = ciphertext ? String(ciphertext) : '';
  return s ? ethers.keccak256(ethers.toUtf8Bytes(s)) : ethers.ZeroHash;
}

export async function encryptToAdminPubKey(payload, adminPublicKeyRaw) {
  // adminPublicKeyRaw: expected as hex string. Accept 0x-prefixed or raw.
  if (!payload) throw new Error('payload required');
  if (!adminPublicKeyRaw) throw new Error('adminPublicKey required for encryption');

  // Dynamic import so front can omit the dependency if not using client-side encryption.
  let EthCrypto;
  try {
    EthCrypto = (await import('eth-crypto')).default || (await import('eth-crypto'));
  } catch (e) {
    // Do not instruct users to install admin crypto into production frontends.
    // Instead point them to the admin tooling or explain opt-in.
    throw new Error('Client-side encryption requested but `eth-crypto` is not available. For production keep encryption/decryption in `tools/admin`. For local demos you may install `eth-crypto` in `front/` as an explicit opt-in.');
  }

  // Normalize pubkey: remove 0x prefix if present
  const pub = String(adminPublicKeyRaw).replace(/^0x/, '');
  // EthCrypto.encryptWithPublicKey expects the raw public key string (no 0x prefix)
  const ciphertext = await EthCrypto.encryptWithPublicKey(pub, String(payload));
  // Return ciphertext (may be a string or object depending on EthCrypto usage) and its digest
  const ctStr = typeof ciphertext === 'string' ? ciphertext : JSON.stringify(ciphertext);
  const digest = computeDigestForCiphertext(ctStr);
  return { ciphertext: ctStr, digest };
}

/**
 * Convenience: prepare evidence for reporting.
 * - If `options.encryptToAdminPubKey` is provided, encrypts payload and returns ciphertext+digest.
 * - Otherwise computes digest over plaintext.
 *
 * Returns: { ciphertext?: string, digest: bytes32 }
 */
export async function prepareEvidencePayload(payload, options = {}) {
  const payloadStr = payload ? String(payload) : '';
  if (options.encryptToAdminPubKey) {
    return await encryptToAdminPubKey(payloadStr, options.encryptToAdminPubKey);
  }
  // No encryption requested: compute digest over plaintext
  return { digest: computeDigestForText(payloadStr) };
}

// Example usage (not executed):
// const { ciphertext, digest } = await prepareEvidencePayload('secret', { encryptToAdminPubKey: '04abcd...' });
// upload ciphertext to off-chain store and keep location if desired; then call contract with `digest`.
