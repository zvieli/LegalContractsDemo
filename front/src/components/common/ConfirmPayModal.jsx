import React from 'react';

export default function ConfirmPayModal({ open, title = 'Confirm payment', amountEth = '0', details = '', onConfirm, onCancel, busy = false }) {
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
      <div style={{ width: 420, background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <p>Amount to send: <strong>{amountEth} ETH</strong></p>
        {details ? <p style={{ color: '#444', fontSize: 13 }}>{details}</p> : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onCancel} disabled={busy} className="btn-sm">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="btn-primary">{busy ? 'Sending...' : 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
}
