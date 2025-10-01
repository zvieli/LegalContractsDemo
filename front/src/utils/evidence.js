import * as ethers from 'ethers';
import ecies, { normalizePublicKeyHex } from './ecies-browser.js';
import { IN_E2E } from './env.js';

// Import testing helpers for frontend debugging (browser compatible check)
let testingHelpers = null;
if (typeof process !== 'undefined' && process.env && process.env.TESTING) {
  try {
    // Note: In browser environments, this import may fail, which is expected
    import('../../../utils/testing-helpers.js').then(module => {
      testingHelpers = module;
    }).catch(() => {
      // Expected to fail in browser, testing helpers are Node.js only
      testingHelpers = null;
    });
  } catch (e) {
    // Expected in browser environment
  }
}

/**
 * Client-side evidence helpers (Option A flow).
 *
 * Responsibilities:
 * - Use the provided admin public key to encrypt a payload (ECIES via `eth-crypto`).
 *
 * Important: the frontend does NOT generate or persist the admin private/public keypair. The only private key in the system is the admin private key and it must be managed in a trusted admin environment. The frontend should only ever be given the admin public key (for encryption) via runtime configuration.
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

  // Prefer the canonical browser ECIES implementation
  const norm = normalizePublicKeyHex(String(adminPublicKeyRaw));
  try {
    const eciesBrowser = await import('./ecies-browser.js');
    const eciesMod = eciesBrowser && (eciesBrowser.default || eciesBrowser);
    if (eciesMod && typeof eciesMod.encryptWithPublicKey === 'function') {
      const enc = await eciesMod.encryptWithPublicKey(norm, String(payload));
      const ctStr = typeof enc === 'string' ? enc : JSON.stringify(enc);
      const digest = computeDigestForCiphertext(ctStr);
      return { ciphertext: ctStr, digest };
    }
  } catch (e) {
    // fallthrough to eth-crypto fallback
  }

  // Fallback: dynamic import of eth-crypto (opt-in for demos)
  let EthCrypto;
  try {
    EthCrypto = (await import('eth-crypto')).default || (await import('eth-crypto'));
  } catch (e) {
    throw new Error('Client-side encryption requested but no encryption module is available. For production keep encryption in `tools/admin`. For local demos install `eth-crypto` in `front/`.');
  }
  // EthCrypto expects the public key string without 0x prefix
  const pubForEthCrypto = norm.startsWith('0x') ? norm.slice(2) : norm;
  const ciphertext = await EthCrypto.encryptWithPublicKey(pubForEthCrypto, String(payload));
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
    const result = await encryptToAdminPubKey(payloadStr, options.encryptToAdminPubKey);
    // E2E-only logging: surface ciphertext length and digest so tests can assert preparation happened
    try {
      if (IN_E2E) {
        console.log && console.log('E2EDBG: prepareEvidencePayload result', 'cipherLen=', (result.ciphertext||'').length, 'digest=', result.digest);
      }
      // TESTING mode logging via testing helpers if available
      if (testingHelpers && typeof testingHelpers.appendTestingTrace === 'function') {
        testingHelpers.appendTestingTrace('FRONTEND_EVIDENCE_PREPARED', {
          cipherTextLength: (result.ciphertext||'').length,
          digest: result.digest,
          adminPubKeyUsed: options.encryptToAdminPubKey ? 'yes' : 'no'
        });
      }
    } catch (__) {}
    return result;
  }
  // No encryption requested: compute digest over plaintext
  return { digest: computeDigestForText(payloadStr) };
}

// Example usage (not executed):
// const { ciphertext, digest } = await prepareEvidencePayload('secret', { encryptToAdminPubKey: '04abcd...' });
// upload ciphertext to off-chain store and keep location if desired; then call contract with `digest`.
