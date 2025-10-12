import React, { useRef } from 'react';
import useEvidenceUpload from '../hooks/useEvidenceUpload';

export default function EvidenceUploader({ onComplete, onError, apiBase }) {
  const fileRef = useRef(null);
  const { upload, status, progress, error } = useEvidenceUpload({ apiBase });

  async function handleSubmit(e) {
    e.preventDefault();
    const file = fileRef.current && fileRef.current.files && fileRef.current.files[0];
    if (!file) return;
    try {
      const result = await upload(file);
      if (onComplete) onComplete(result);
    } catch (err) {
      if (onError) onError(err);
    }
  }

  return (
    <div className="evidence-uploader">
      <form onSubmit={handleSubmit}>
        <label>
          Select evidence file
          <input ref={fileRef} type="file" accept="*/*" />
        </label>
        <button type="submit" disabled={status === 'uploading'}>Upload</button>
      </form>
      <div className="status">Status: {status} {status === 'uploading' && `(${progress}%)`}</div>
      {error && <div className="error">Error: {String(error.message || error)}</div>}
    </div>
  );
}
