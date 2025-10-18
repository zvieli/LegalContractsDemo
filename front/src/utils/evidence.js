import * as ethers from 'ethers';
import { Buffer } from 'buffer';
import process from 'process';
import { safeGetAddress } from './signer.js';
import { computeCidDigest, computeContentDigest, canonicalize } from './evidenceCanonical.js';
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

// Build an encrypted multi-recipient envelope (AES-256-GCM) and return { envelopeJson, symmetricKeyHex }
export async function buildEncryptedEnvelope(contentObj, recipientsPublicKeys = []) {
  const jsonCanon = canonicalize(contentObj);
  const contentDigest = computeContentDigest(jsonCanon);
  // Random 32-byte symmetric key
  const symKey = ethers.randomBytes(32);
  const iv = ethers.randomBytes(12);
  // AES-256-GCM encrypt
  const subtle = globalThis.crypto && crypto.subtle;
  let ciphertextB64, tagB64;
  if (subtle) {
    const key = await subtle.importKey('raw', symKey, { name: 'AES-GCM' }, false, ['encrypt']);
    const enc = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(jsonCanon));
    // Browser returns ArrayBuffer containing ciphertext+tag at end (tag length 16)
    const full = new Uint8Array(enc);
    const tag = full.slice(full.length - 16);
    const ct = full.slice(0, full.length - 16);
    ciphertextB64 = Buffer.from(ct).toString('base64');
    tagB64 = Buffer.from(tag).toString('base64');
  } else {
    // Node fallback - only import crypto in Node.js environments
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      const cryptoModule = await import('crypto');
      const cipher = cryptoModule.createCipheriv('aes-256-gcm', Buffer.from(symKey), Buffer.from(iv));
      const ct = Buffer.concat([cipher.update(jsonCanon, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      ciphertextB64 = ct.toString('base64');
      tagB64 = tag.toString('base64');
    } else {
      throw new Error('AES-GCM encryption not available in this environment. Browser Web Crypto API required.');
    }
  }
  // Encrypt symmetric key per recipient using ECIES browser helper (best effort)
  const encryptedRecipients = [];
  for (const pub of recipientsPublicKeys) {
    try {
      const { default: eciesMod } = await import('./ecies-browser.js');
      const encKey = await eciesMod.encryptWithPublicKey(pub.replace(/^0x/, ''), Buffer.from(symKey).toString('hex'));
      encryptedRecipients.push({ pubkey: pub, encryptedKey: encKey, ok: true });
    } catch (e) {
      encryptedRecipients.push({ pubkey: pub, encryptedKey: { code: 'ECIES_ENCRYPT_FAIL', message: e?.message || 'encrypt failed', legacy: true }, ok: false });
    }
  }
  const envelope = {
    version: 1,
    ciphertext: ciphertextB64,
    encryption: { aes: { iv: Buffer.from(iv).toString('base64'), tag: tagB64, algo: 'AES-256-GCM' } },
    recipients: encryptedRecipients,
    contentDigest,
    createdAt: Date.now()
  };
  return { envelope, symmetricKeyHex: Buffer.from(symKey).toString('hex'), cidDigest: null, contentDigest };
}

/**
 * Sign evidence data using EIP-712 with recipients hash for tamper detection
 * @param {Object} evidenceData - Contains caseId, contentDigest, recipients, cid
 * @param {Object} contractInfo - Contains chainId, verifyingContract address
 * @param {Object} signer - Ethers signer
 * @returns {string} Signature
 */
export async function signEvidenceEIP712(evidenceData, contractInfo, signer) {
  const { caseId, contentDigest, recipients, cid } = evidenceData;
  const { chainId, verifyingContract } = contractInfo;
  
  // Hash recipients array for integrity
  const recipientsHash = recipients && recipients.length > 0 
    ? ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(recipients.map(r => r.address || r).sort())))
    : ethers.ZeroHash;
  
  // EIP-712 domain
  const domain = {
  // ...existing code...
    version: '1',
    chainId: chainId,
    verifyingContract: verifyingContract
  };
  
  // EIP-712 types
  const types = {
    Evidence: [
      { name: 'caseId', type: 'uint256' },
      { name: 'contentDigest', type: 'bytes32' },
      { name: 'recipientsHash', type: 'bytes32' },
      { name: 'uploader', type: 'address' },
      { name: 'cid', type: 'string' }
    ]
  };
  
  // Get uploader address
  const contractService = new ContractService(provider, signer, chainId);
  const readProvider = contractService._providerForRead() || provider || null;
  const uploader = await safeGetAddress(signer, readProvider || contractService);
  
  // Evidence message
  const message = {
    caseId: caseId,
    contentDigest: contentDigest,
    recipientsHash: recipientsHash,
    uploader: uploader,
    cid: cid
  };
  
  // Sign using EIP-712
  const signature = await signer.signTypedData(domain, types, message);
  return signature;
}

/**
 * Hash recipients array for consistent ordering
 * @param {Array} recipients - Array of recipient objects or addresses
 * @returns {string} Hash of recipients
 */
export function hashRecipients(recipients) {
  if (!recipients || recipients.length === 0) {
    return ethers.ZeroHash;
  }
  const addresses = recipients.map(r => r.address || r).sort();
  return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(addresses)));
}

// Example usage (not executed):
// const { ciphertext, digest } = await prepareEvidencePayload('secret', { encryptToAdminPubKey: '04abcd...' });
// upload ciphertext to off-chain store and keep location if desired; then call contract with `digest`.
