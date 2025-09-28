import React, { useState } from 'react';
import './EvidenceSubmit.css';

export default function EvidenceSubmit() {
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
      const resp = await fetch('/submit-evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? JSON.stringify(body) : JSON.stringify(body)
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setStatus({ ok: false, message: json && json.error ? json.error : `HTTP ${resp.status}`, details: json });
      } else {
        setStatus({ ok: true, message: 'Evidence submitted', details: json });
        // Optionally clear the payload on success
        // setPayload('');
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
        <textarea id="evidence-input" value={payload} onChange={(e) => setPayload(e.target.value)} placeholder='{"note":"example"}' />
        <div className="controls">
          <button type="submit" className="btn btn-primary" disabled={loading}>
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
