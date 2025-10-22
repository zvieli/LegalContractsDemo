/**
 * useEvidenceFlow
 * React hook (utility) that implements: compute digest -> upload to /submit-evidence -> call on-chain submit -> register-dispute
 * Designed to be integrated into existing components (no new component created).
 *
 * Usage:
 * const { uploadAndSubmit } = useEvidenceFlow({ submitToContract, apiBaseUrl });
 * await uploadAndSubmit({ fileOrText, isBase64Ciphertext, reporterAddress, contractAddress, note, encryption, onProgress });
 *
 * - submitToContract: async function ({ digest }) => returns { hash, wait: async() }
 *   Example: submitToContract = async ({ digest }) => { const tx = await contract.reportDispute(digest); return tx; }
 */

import { useCallback } from 'react';
import { hexlify, keccak256, toUtf8Bytes } from 'ethers';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function toUint8ArrayFromBase64(b64) {
  if (!b64) return null;
  const binary = atob(b64);
  const len = binary.length;
  const u8 = new Uint8Array(len);
  for (let i = 0; i < len; i++) u8[i] = binary.charCodeAt(i);
  return u8;
}

function toUint8ArrayFromUtf8(str) {
  return new TextEncoder().encode(str);
}

async function fetchWithRetry(url, opts = {}, retries = 3, backoff = 500, onProgress) {
  let attempt = 0;
  while (attempt < retries) {
    try {
      if (onProgress) onProgress({ stage: 'request', attempt });
      const res = await fetch(url, opts);
      if (!res.ok) {
        const text = await res.text().catch(()=>null);
        throw new Error(`HTTP ${res.status} ${res.statusText} ${text || ''}`);
      }
      return res;
    } catch (err) {
      attempt++;
      if (attempt >= retries) throw err;
      if (onProgress) onProgress({ stage: 'retry', attempt, error: err.message || String(err) });
      await sleep(backoff * attempt);
    }
  }
}

export async function runEvidenceFlow(submitToContract, apiBaseUrl = '', opts = {}, prepareEvidencePayloadFn) {
  // Accept either a string payload or an options object
  // If opts is a string, treat it as plaintext payload.
  const {
    fileOrText: incomingFileOrText,
    payload,
    isBase64Ciphertext: incomingIsBase64,
    reporterAddress,
    contractAddress,
    note,
    encryption,
    encryptToAdminPubKey,
    timestamp = new Date().toISOString(),
    onProgress
  } = (typeof opts === 'string') ? { payload: opts } : (opts || {});

  // Determine the raw text to prepare: prefer explicit payload, then incomingFileOrText
  const rawPayload = (typeof payload !== 'undefined' && payload !== null) ? payload : incomingFileOrText;

  if (!submitToContract || typeof submitToContract !== 'function') {
    throw new Error('submitToContract callback required');
  }

  // 1) prepare evidence payload (may encrypt to admin pubkey) and compute digest
  if (onProgress) onProgress({ stage: 'compute_digest' });
  // prepareEvidencePayload returns either { ciphertext, digest } if encryption used,
  // or { digest } when not encrypting. We will ensure ciphertext is provided by
  // using the rawPayload when needed.
  let prepResult = null;
  try {
    if (typeof prepareEvidencePayloadFn === 'function') {
      prepResult = await prepareEvidencePayloadFn(rawPayload || '', { encryptToAdminPubKey: encryptToAdminPubKey });
    } else {
      // dynamic import so tests can inject a mock via prepareEvidencePayloadFn
      const mod = await import('../utils/evidence');
      prepResult = await mod.prepareEvidencePayload(rawPayload || '', { encryptToAdminPubKey: encryptToAdminPubKey });
    }
  } catch (e) {
    // If prepareEvidencePayload failed (e.g., eth-crypto not present), fall back to hashing raw payload
    if (onProgress) onProgress({ stage: 'compute_digest_error', error: e.message || String(e) });
    // Compute digest over rawPayload bytes
  const dataU8 = toUint8ArrayFromUtf8(rawPayload || '');
  const hex = hexlify(dataU8);
  const fallbackDigest = keccak256(hex);
    prepResult = { digest: fallbackDigest };
  }

  const digest = prepResult && prepResult.digest ? prepResult.digest : keccak256(hexlify(toUint8ArrayFromUtf8(String(rawPayload || ''))));

  // 2) ensure ciphertext is base64-encoded. If prepareEvidencePayload returned ciphertext
  // we will base64-encode its UTF-8 representation; otherwise base64-encode the raw payload.
  if (onProgress) onProgress({ stage: 'upload_start', digest });
  let ciphertextToSend = null;
  try {
    const ctSource = prepResult && prepResult.ciphertext ? String(prepResult.ciphertext) : String(rawPayload || '');
    if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
      ciphertextToSend = window.btoa(ctSource);
    } else {
      ciphertextToSend = Buffer.from(ctSource, 'utf8').toString('base64');
    }
  } catch (e) {
    // fallback: if encoding fails, send as-is (server may still accept wrapper form)
    ciphertextToSend = prepResult && prepResult.ciphertext ? String(prepResult.ciphertext) : String(rawPayload || '');
  }

  const body = {
    ciphertext: ciphertextToSend,
    digest,
    reporterAddress: reporterAddress || undefined,
    contractAddress: contractAddress || undefined,
    note: note || undefined,
    // evidence endpoint expects a 'type' field: 'appeal' or 'rationale'
    // allow caller to override via opts.type; default to 'rationale' for resolve flows
    type: (opts && opts.type) ? opts.type : 'rationale',
    timestamp,
    encryption: encryption || undefined
  };

  const authHeaders = { 'Content-Type': 'application/json' };
  if (reporterAddress) authHeaders.Authorization = `Bearer ${reporterAddress}`;

  const res = await fetchWithRetry(`${apiBaseUrl}/submit-evidence`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(body)
  }, 3, 700, onProgress);

  const json = await res.json();
  if (!json || !json.digest) throw new Error('Invalid response from /submit-evidence');
  if (json.digest !== digest) {
    // digest mismatch
    throw new Error(`digest_mismatch: client=${digest} server=${json.digest}`);
  }
  const heliaCid = json.heliaCid || null;
  const heliaUri = json.heliaUri || null;
  const cid = json.cid || heliaCid || (heliaUri ? String(heliaUri).split('://')[1] : null) || null;
  const cidHash = json.cidHash ? json.cidHash : (cid ? keccak256(toUtf8Bytes(String(cid))) : null);
  if (onProgress) onProgress({ stage: 'upload_success', digest, cid });

  // 3) submit on-chain via provided callback
  if (onProgress) onProgress({ stage: 'tx_send', digest });
  let tx;
  try {
    // Prefer passing heliaUri or cid on-chain when available; fall back to digest
    const onChainRef = heliaUri ? heliaUri : (cid ? cid : digest);
    tx = await submitToContract({ digest: onChainRef });
  } catch (err) {
    if (onProgress) onProgress({ stage: 'tx_error', error: err.message || String(err) });
    throw err;
  }

  if (!tx || !tx.hash) {
    // If the submitToContract returns an awaited receipt directly, normalize
    if (onProgress) onProgress({ stage: 'tx_no_hash', tx });
    // try to use tx as object with wait
    if (!tx) throw new Error('submitToContract did not return tx object with hash');
  }

  const txHash = tx.hash;
  if (onProgress) onProgress({ stage: 'tx_pending', txHash });

  // Wait for mining; backoff/timeout can be implemented by caller
  let receipt = null;
  try {
    if (typeof tx.wait === 'function') {
      receipt = await tx.wait();
    } else {
      // caller might return receipt directly
      receipt = tx;
    }
    if (onProgress) onProgress({ stage: 'tx_mined', receipt });
  } catch (err) {
    if (onProgress) onProgress({ stage: 'tx_failed', error: err.message || String(err) });
    throw err;
  }

  // 4) register-dispute with server
  if (onProgress) onProgress({ stage: 'register_start', txHash, digest, cid });
  const regRes = await fetchWithRetry(`${apiBaseUrl}/register-dispute`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ txHash, digest, cid, cidHash, contractAddress, reporterAddress })
  }, 3, 700, onProgress);
  const regJson = await regRes.json();
  if (onProgress) onProgress({ stage: 'register_done', entry: regJson });

  return { digest, cid, txHash, receipt, register: regJson };
}

export default function useEvidenceFlow({ submitToContract, apiBaseUrl = '' } = {}) {
  const uploadAndSubmit = useCallback((opts, prepareEvidencePayloadFn) => runEvidenceFlow(submitToContract, apiBaseUrl, opts, prepareEvidencePayloadFn), [submitToContract, apiBaseUrl]);
  return { uploadAndSubmit };
}
