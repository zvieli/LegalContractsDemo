import React, { useState } from 'react';
import EvidenceSubmit from '../EvidenceSubmit/EvidenceSubmit';
import { useEthers } from '../../contexts/EthersContext';

export default function RationaleForm({ contractAddress = null, txHash = null, onSubmitted } = {}) {
  const { account } = useEthers();
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const postJSON = async (url, body) => {
    const headers = { 'Content-Type': 'application/json' };
    const authAddress = account || (typeof window !== 'undefined' && window.ethereum && window.ethereum.selectedAddress);
    if (authAddress) headers.Authorization = `Bearer ${String(authAddress)}`;
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json && json.error ? json.error : `HTTP ${resp.status}`);
    return json;
  };

  const handleSubmit = async (payloadStr) => {
    setError(null);
    setResult(null);
    try {
      const apiBase = (import.meta.env && import.meta.env.VITE_EVIDENCE_SUBMIT_ENDPOINT) || (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__.VITE_EVIDENCE_SUBMIT_ENDPOINT) || '/submit-evidence';
      // compute digest client-side using existing util if available
      let digest = null;
      try {
        const mod = await import('../../utils/evidence');
        digest = await mod.computeDigestForText(payloadStr);
      } catch (e) {
        digest = null;
      }
      const body = { txHash: txHash || null, digest: digest, contractAddress: contractAddress || null, type: 'rationale', content: payloadStr };
      const resp = await postJSON(apiBase, body);
      setResult(resp);
      if (typeof onSubmitted === 'function') onSubmitted(resp);
      return resp;
    } catch (e) {
      setError(String(e));
      throw e;
    }
  };

  return (
    <div className="rationale-form">
      <h3>Submit Rationale</h3>
      <p>Provide a rationale (free text or JSON). This will be encrypted for the case participants.</p>
      <EvidenceSubmit submitHandler={handleSubmit} onSubmitted={(json) => { setResult(json); }} />
      {result && (
        <div className="result"><pre>{JSON.stringify(result, null, 2)}</pre></div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
