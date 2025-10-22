import { useState } from 'react';
import { prepareEvidencePayload } from '../utils/evidence';
import { keccak256, toUtf8Bytes } from 'ethers';

export function useEvidenceSubmit() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);

  const submitEvidence = async (payloadStr) => {
    setLoading(true);
    setStatus(null);
    try {
      // runtime envs
      const apiBase = (import.meta.env && import.meta.env.VITE_EVIDENCE_SUBMIT_ENDPOINT) || (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__.VITE_EVIDENCE_SUBMIT_ENDPOINT) || '/submit-evidence';
      const adminPub = (import.meta.env && import.meta.env.VITE_ADMIN_PUBLIC_KEY) || (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__.VITE_ADMIN_PUBLIC_KEY) || undefined;

      let prep = null;
      try {
        prep = await prepareEvidencePayload(payloadStr, { encryptToAdminPubKey: adminPub });
      } catch (e) {
        prep = { digest: null };
      }

      if (!prep.digest) {
        try {
          const mod = await import('../utils/evidence');
          const d = mod.computeDigestForText(payloadStr);
          prep.digest = d;
        } catch (e) {
          prep.digest = null;
        }
      }

      const ctSource = prep && prep.ciphertext ? String(prep.ciphertext) : String(payloadStr || '');
      let ciphertextToSend = '';
      try {
        if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
          ciphertextToSend = window.btoa(ctSource);
        } else {
          ciphertextToSend = Buffer.from(ctSource, 'utf8').toString('base64');
        }
      } catch (e) {
        ciphertextToSend = Buffer.from(ctSource, 'utf8').toString('base64');
      }

      const postBody = { ciphertext: ciphertextToSend, digest: prep.digest };

      const authAddress = (typeof window !== 'undefined' && window.ethereum && window.ethereum.selectedAddress) || (typeof window !== 'undefined' && window.__LAST_CONNECTED_ACCOUNT);
      const headers = { 'Content-Type': 'application/json' };
      if (authAddress) headers.Authorization = `Bearer ${String(authAddress)}`;

      const resp = await fetch(apiBase, {
        method: 'POST',
        headers,
        body: JSON.stringify(postBody)
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setStatus({ ok: false, message: json && json.error ? json.error : `HTTP ${resp.status}`, details: json });
        throw new Error(json && json.error ? json.error : `HTTP ${resp.status}`);
      }

      // Normalize response
      const returnedDigest = json && json.digest ? json.digest : prep.digest;
      const heliaCid = json && json.heliaCid ? json.heliaCid : null;
      const heliaUri = json && json.heliaUri ? json.heliaUri : null;
      const cid = json && json.cid ? json.cid : (heliaCid || (heliaUri ? String(heliaUri).split('://')[1] : null));
      const cidHash = json && json.cidHash ? json.cidHash : (cid ? keccak256(toUtf8Bytes(String(cid))) : null);

      const normalized = { cid, heliaCid, heliaUri, cidHash, digest: returnedDigest, raw: json };
      setStatus({ ok: true, message: 'Evidence submitted', details: normalized });
      return normalized;
    } finally {
      setLoading(false);
    }
  };

  return { submitEvidence, loading, status };
}

export default useEvidenceSubmit;
