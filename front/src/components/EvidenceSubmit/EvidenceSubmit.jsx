import React, { useState } from 'react';
import './EvidenceSubmit.css';
import { prepareEvidencePayload } from '../../utils/evidence';

export default function EvidenceSubmit({ onSubmitted, submitHandler } = {}) {
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
    } catch (err) {
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
            try { onSubmitted(result); } catch (e) {}
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
      const adminPub = (import.meta.env && import.meta.env.VITE_ADMIN_PUBLIC_KEY) || (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__.VITE_ADMIN_PUBLIC_KEY) || undefined;

      // prepareEvidencePayload will return { ciphertext, digest } if encryption used, or { digest } otherwise
      let prep = null;
      try {
        prep = await prepareEvidencePayload(payloadStr, { encryptToAdminPubKey: adminPub });
      } catch (e) {
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
        } catch (e) {
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
          ciphertextToSend = Buffer.from(ctSource, 'utf8').toString('base64');
        }
      } catch (e) {
        ciphertextToSend = Buffer.from(ctSource, 'utf8').toString('base64');
      }

      const postBody = { ciphertext: ciphertextToSend, digest: prep.digest };

      const resp = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody)
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setStatus({ ok: false, message: json && json.error ? json.error : `HTTP ${resp.status}`, details: json });
      } else {
        // Show CID/URI if present for user convenience
        setStatus({ ok: true, message: 'Evidence submitted', details: json });
        if (typeof onSubmitted === 'function') {
          try {
            onSubmitted(json);
          } catch (e) {
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
