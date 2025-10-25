import React from 'react';

const badgeInfo = {
  verified: { color: '#d2f8d2', desc: 'Evidence fully verified (CID + content + signature)' },
  'cid-mismatch': { color: '#fdd', desc: 'CID digest mismatch - content may have been replaced' },
  'content-mismatch': { color: '#fdd', desc: 'Content digest mismatch - original content was modified' },
  'sig-invalid': { color: '#ffe4b3', desc: 'EIP-712 signature verification failed' },
  'fetch-failed': { color: '#fdd', desc: 'Could not retrieve evidence from off-chain storage' },
  error: { color: '#fdd', desc: 'General verification error occurred' },
  pending: { color: '#eef', desc: 'Evidence verification in progress' },
  encrypted: { color: '#ffe4b3', desc: 'Evidence is encrypted to specific recipients' },
  'encrypt-ok': { color: '#d2f8d2', desc: 'Encryption successful for this recipient' },
  'encrypt-fail': { color: '#ffb3b3', desc: 'Encryption failed for this recipient - plaintext fallback' }
};

export default function EvidenceBadgeLegend({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="modal">
      <div className="modal-content" style={{ maxWidth: '600px' }}>
        <h3>Evidence Badge Legend</h3>
        <div style={{ display: 'grid', gap: '8px' }}>
          {Object.entries(badgeInfo).map(([key, info]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span 
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  background: info.color,
                  minWidth: '80px',
                  textAlign: 'center',
                  fontWeight: 'bold'
                }}
              >
                {key === 'encrypt-ok' ? 'E✓' : key === 'encrypt-fail' ? 'E!' : key}
              </span>
              <span style={{ fontSize: '14px', color: '#555' }}>{info.desc}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: '16px', fontSize: '13px', color: '#666' }}>
          <strong>Security Notes:</strong>
          <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
            <li><strong>verified:</strong> All integrity checks passed - content is authentic</li>
            <li><strong>cid-mismatch:</strong> Possible content substitution attack</li>
            <li><strong>sig-invalid:</strong> Evidence may be forged or corrupted</li>
            <li><strong>E!:</strong> Encryption failed - recipient cannot decrypt this evidence</li>
          </ul>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}