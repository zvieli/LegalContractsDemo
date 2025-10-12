import { useState } from 'react';
import { attachDigests, computeContentDigest, computeCidDigest } from '../utils/evidenceCanonical';
import { computePayloadDigest } from '../utils/cidDigest';

// Resolve API base from import.meta.env (Vite) or process.env (Node/Vitest)
let _resolvedApiBase = 'http://localhost:3001';
try {
  if (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) {
    _resolvedApiBase = import.meta.env.VITE_API_BASE;
  }
} catch (e) {
  // import.meta may not be available in some Node contexts — ignore
}
if (typeof process !== 'undefined' && process.env && process.env.VITE_API_BASE) {
  _resolvedApiBase = process.env.VITE_API_BASE;
}

export default function useEvidenceUpload({ apiBase = _resolvedApiBase } = {}) {
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  async function upload(evidence, { encrypt = false } = {}) {
    setStatus('uploading');
    setProgress(5);
    setError(null);

    try {
      // If evidence is a File, read as text
      let payload = evidence;
      if (evidence instanceof File) {
        payload = { filename: evidence.name, size: evidence.size };
        try {
          const text = await evidence.text();
          payload.content = text;
        } catch (err) {
          // fallback: just metadata
          payload.content = '';
        }
      }

      // Attach canonical digests
      const withDigests = attachDigests(payload);
      setProgress(30);

      // Optionally compute payload digest (alternate)
      withDigests.payloadDigest = computePayloadDigest(JSON.stringify(payload));

      // POST to backend upload endpoint
      const resp = await fetch(`${apiBase.replace(/\/$/, '')}/api/evidence/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(withDigests)
      });

      setProgress(80);

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Upload failed: ${resp.status} ${body}`);
      }

      const data = await resp.json();
      setProgress(100);
      setStatus('done');
      return data;
    } catch (err) {
      setError(err);
      setStatus('error');
      setProgress(0);
      throw err;
    }
  }

  return { upload, status, progress, error };
}
