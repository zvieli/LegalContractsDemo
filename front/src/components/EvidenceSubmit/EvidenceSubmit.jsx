import React, { useState } from 'react';
/* global Buffer */
import './EvidenceSubmit.css';
import { prepareEvidencePayload } from '../../utils/evidence';

// Small helper to prompt download of a JSON object in the browser
function downloadJSON(obj, filename) {
  try {
    const content = JSON.stringify(obj, null, 2);
    if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `evidence-response-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } else {
      // non-browser environment: log the JSON
      console.log('downloadJSON (non-browser) ->', content);
    }
  } catch (e) { void e;
    console.error('downloadJSON failed', e);
  }
}

export default function EvidenceSubmit({ onSubmitted, submitHandler, evidenceType = 'rationale', authAddress } = {}) {
  const [payload, setPayload] = useState('');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setStatus(null);
    setLoading(true);
    let body = payload;
    try {
      // Try to parse JSON to ensure valid input; send string as-is if parsing fails
      const parsed = JSON.parse(payload);
      body = parsed;
    } catch (e) { void e;
      // leave body as raw string
    }
    try {
      const payloadStr = typeof body === 'string' ? body : JSON.stringify(body);

      // If an external submit handler is provided, use it and return its result
      if (typeof submitHandler === 'function') {
        try {
          const result = await submitHandler(payloadStr);
          setStatus({ ok: true, message: 'Evidence submitted', details: result });
          if (typeof onSubmitted === 'function') {
            try { onSubmitted(result); } catch (e) { void e;}
          }
          return;
        } catch (err) {
          setStatus({ ok: false, message: String(err) });
          return;
        }
      }

      // Otherwise, fall back to internal submit logic (keeps previous behavior)
      // Use runtime-configured endpoint if present
  const apiBase = (import.meta.env && import.meta.env.VITE_EVIDENCE_SUBMIT_ENDPOINT) || (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__.VITE_EVIDENCE_SUBMIT_ENDPOINT) || '/submit-evidence';
  const resolvedAuthAddress = authAddress || (typeof window !== 'undefined' && window.ethereum && window.ethereum.selectedAddress) || (typeof window !== 'undefined' && window.__LAST_CONNECTED_ACCOUNT);
      const adminPub = (import.meta.env && import.meta.env.VITE_ADMIN_PUBLIC_KEY) || (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__.VITE_ADMIN_PUBLIC_KEY) || undefined;

      // prepareEvidencePayload will return { ciphertext, digest } if encryption used, or { digest } otherwise
      let prep = null;
      try {
        prep = await prepareEvidencePayload(payloadStr, { encryptToAdminPubKey: adminPub });
      } catch (e) { void e;
        // If prepare failed, fall back to computing digest over plaintext via utils and send plaintext base64
        prep = { digest: null };
      }

      // Ensure we have a digest: if prepare didn't set one, compute a simple keccak over plaintext via fallback
      if (!prep.digest) {
        try {
          // dynamic import compute helper to avoid circular issues
          const mod = await import('../../utils/evidence');
          const d = mod.computeDigestForText(payloadStr);
          prep.digest = d;
        } catch (e) { void e;
          // last-resort: set empty digest (server will reject)
          prep.digest = null;
        }
      }

      // Build ciphertext base64: prefer prep.ciphertext, otherwise payloadStr
      let ciphertextToSend = '';
      const ctSource = prep && prep.ciphertext ? String(prep.ciphertext) : String(payloadStr || '');
      try {
        if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
          ciphertextToSend = window.btoa(ctSource);
        } else {
          // Buffer may not exist in some browser test environments; guard it
          try { ciphertextToSend = (typeof Buffer !== 'undefined') ? Buffer.from(ctSource, 'utf8').toString('base64') : btoa(ctSource); } catch (e) { void e; ciphertextToSend = btoa(ctSource); }
        }
      } catch (e) { void e;
        ciphertextToSend = (typeof Buffer !== 'undefined') ? Buffer.from(ctSource, 'utf8').toString('base64') : btoa(ctSource);
      }

  // evidence type for UI submissions - configurable via props
  const postBody = { ciphertext: ciphertextToSend, digest: prep.digest, type: evidenceType };

      const headers = { 'Content-Type': 'application/json' };
      if (resolvedAuthAddress) headers.Authorization = `Bearer ${String(resolvedAuthAddress)}`;

      const resp = await fetch(apiBase, {
        method: 'POST',
        headers,
        body: JSON.stringify(postBody)
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setStatus({ ok: false, message: json && json.error ? json.error : `HTTP ${resp.status}`, details: json });
      } else {
        // Show CID/URI if present for user convenience
        setStatus({ ok: true, message: 'Evidence submitted', details: json });
        // Log backend response for debugging
        try { console.log('submit-evidence response:', json); } catch (e) { void e;}
        // Prompt browser to download the backend response JSON for offline debugging
        try { downloadJSON(json, `evidence-response-${(json && json.digest) ? json.digest.replace(/^0x/, '') : Date.now()}.json`); } catch (e) { void e; console.error(e); }
        if (typeof onSubmitted === 'function') {
          try {
            onSubmitted(json);
          } catch (e) { void e;
            // swallow callback errors
          }
        }
      }
    } catch (err) {
      setStatus({ ok: false, message: String(err) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="evidence-submit">
      <h3>Submit Evidence</h3>
      <form onSubmit={onSubmit}>
        <label htmlFor="evidence-input">Evidence JSON / Text</label>
        <textarea id="evidence-input" data-testid="evidence-input" value={payload} onChange={(e) => setPayload(e.target.value)} placeholder='{"note":"example"}' />
        <div className="controls">
          <button type="submit" data-testid="evidence-submit-btn" className="btn btn-primary" disabled={loading}>
            {loading ? 'Submitting...' : 'Submit Evidence'}
          </button>
        </div>
      </form>

      {status && (
        <div className={`submit-status ${status.ok ? 'success' : 'error'}`}>
          <strong>{status.ok ? 'Success' : 'Error'}:</strong>
          <div className="msg">{status.message}</div>
          {status.details && (
            <pre className="details">{JSON.stringify(status.details, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}
