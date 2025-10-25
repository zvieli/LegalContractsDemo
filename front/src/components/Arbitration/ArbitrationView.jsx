import React, { useEffect, useState } from 'react';
import LLMDecisionView from './LLMDecisionView.jsx';
import WalletConnector from '../common/Header/WalletConnector.jsx';

// Component for individual evidence digest with IPFS verification
function EvidenceDigestItem({ digest }) {
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(null);

  async function verifyCID() {
    setVerifying(true);
    setVerified(null);
    try {
      const resp = await fetch(`https://ipfs.io/ipfs/${digest}`);
      setVerified(resp.ok);
    } catch (_){ void _;
      setVerified(false);
    } finally {
      setVerifying(false);
    }
  }

  return (
    <li style={{ fontFamily: 'monospace', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
      {digest}
      <button
        style={{
          marginLeft: 8,
          padding: '2px 8px',
          fontSize: 12,
          borderRadius: 4,
          border: '1px solid #b3c6ff',
          background: '#f6f8ff',
          cursor: 'pointer'
        }}
        onClick={verifyCID}
        disabled={verifying}
      >
        {verifying ? 'Verifying...' : 'Verify on IPFS'}
      </button>
      {verified === true && <span style={{ color: '#2a7', fontWeight: 'bold' }}>✔ Exists</span>}
      {verified === false && <span style={{ color: 'crimson', fontWeight: 'bold' }}>✖ Not found</span>}
    </li>
  );
}

export default function ArbitrationView({ dispute, evidence, contractText }) {
  const evidenceText = evidence && evidence.length
    ? evidence.map(ev => ev.content || ev.leaf || ev.cid).join('\n---\n')
    : '';
  const disputeId = dispute?.id || dispute?.caseId || '';

  const [history, setHistory] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [wallet, setWallet] = useState(null);
  const [role, setRole] = useState('user'); // user/admin/system/guest

  const [showModal, setShowModal] = useState(false);
  const [evidenceInput, setEvidenceInput] = useState('');
  const [submitStatus, setSubmitStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (wallet) {
      if (wallet === '0xADMINADDRESS') setRole('admin');
      else if (wallet === '0xSYSTEMADDRESS') setRole('system');
      else setRole('user');
    } else {
      setRole('guest');
    }
  }, [wallet]);

  useEffect(() => {
    let cancelled = false;
    async function fetchStatusAndHistory() {
      setLoading(true);
      setError(null);
      try {
        const statusResp = await fetch('/api/v7/arbitration/status');
        const statusJson = await statusResp.json();
        const histResp = await fetch('/api/v7/arbitration/decisions');
        const histJson = await histResp.json();
        if (!cancelled) {
          setStatus(statusJson);
          setHistory(Array.isArray(histJson) ? histJson : (histJson.decisions || []));
        }
      } catch (e) { void e;
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchStatusAndHistory();
    return () => { cancelled = true; };
  }, [disputeId]);

  return (
    <div className="arbitration-view" style={{ padding: 24 }}>
      <WalletConnector onWallet={setWallet} />
      <h2>Arbitration Case</h2>
      <div style={{ marginBottom: 18 }}>
        <strong>Dispute ID:</strong> {disputeId}<br />
        <strong>Contract:</strong> <span style={{ fontFamily: 'monospace' }}>{contractText?.slice(0, 48)}...</span>
      </div>

      <div style={{ marginBottom: 18 }}>
        <strong>Evidence Digests:</strong>
        <ul>
          {evidence && evidence.length ? evidence.map((ev, i) => (
            <EvidenceDigestItem key={i} digest={ev.cidDigestEvent || ev.leaf || ev.cid} />
          )) : <li>No evidence</li>}
        </ul>
      </div>

      {loading && <div style={{ color: '#888' }}>Loading arbitration status & history...</div>}
      {error && <div style={{ color: 'crimson' }}>Error: {error}</div>}
      {!loading && !error && (
        <div style={{ marginBottom: 24 }}>
          <h4>Previous Decisions</h4>
          {history.length ? (
            <ul style={{ background: '#f8f8f8', padding: 12, borderRadius: 8 }}>
              {history.map((dec, i) => (
                <li key={i} style={{ marginBottom: 8 }}>
                  <strong>Case:</strong> {dec.disputeId || dec.caseId || '—'}<br />
                  <strong>Decision:</strong> {dec.decision || dec.verdict || '—'}<br />
                  <strong>Rationale:</strong> <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{dec.rationale || '—'}</span>
                </li>
              ))}
            </ul>
          ) : <div>No previous decisions found.</div>}
          {status && (
            <div style={{ marginTop: 12 }}>
              <strong>Arbitration Service Status:</strong> <span style={{ fontFamily: 'monospace' }}>{status.status || status.state || JSON.stringify(status)}</span>
            </div>
          )}
        </div>
      )}

      {/* Role-based UI */}
      {role === 'user' && wallet && (
        <>
          <div style={{ color: '#222', marginBottom: 12 }}>
            <strong>User:</strong> You can submit evidence and view decisions.
          </div>
          <button
            style={{ marginBottom: 12, padding: '8px 18px', fontWeight: 'bold', background: '#e6f7ff', border: '1px solid #b3c6ff', borderRadius: 6, cursor: 'pointer' }}
            onClick={() => { setShowModal(true); setSubmitStatus(null); }}
          >Submit Evidence</button>

          {showModal && (
            <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.25)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ background: '#fff', padding: 32, borderRadius: 12, minWidth: 320, boxShadow: '0 2px 16px #0002', position: 'relative' }}>
                <h3>Submit Evidence</h3>
                <textarea
                  value={evidenceInput}
                  onChange={e => setEvidenceInput(e.target.value)}
                  placeholder="Enter evidence text or CID..."
                  style={{ width: '100%', minHeight: 80, marginBottom: 16, padding: 8, fontSize: 15 }}
                  disabled={submitting}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                  <button onClick={() => setShowModal(false)} disabled={submitting}>Cancel</button>
                  <button
                    style={{ background: '#2a7', color: '#fff', fontWeight: 'bold', border: 'none', borderRadius: 4, padding: '8px 18px' }}
                    disabled={submitting || !evidenceInput.trim()}
                    onClick={async () => {
                      setSubmitting(true);
                      setSubmitStatus(null);
                      try {
                        const resp = await fetch('/api/v7/evidence/submit', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ evidence: evidenceInput, disputeId })
                        });
                        const json = await resp.json();
                        if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
                        setSubmitStatus('Evidence submitted successfully!');
                        setEvidenceInput('');
                      } catch (e) { void e;
                        setSubmitStatus('Error submitting evidence: ' + (e.message || String(e)));
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                  >Submit</button>
                </div>
                {submitStatus && <div style={{ marginTop: 16, color: submitStatus.startsWith('Error') ? 'crimson' : '#2a7' }}>{submitStatus}</div>}
              </div>
            </div>
          )}
        </>
      )}

      {role === 'admin' && (
        <div style={{ color: '#c60', marginBottom: 12 }}>
          <strong>Admin:</strong> You do not have arbitration permissions. This view is for system management only.
        </div>
      )}
      {role === 'system' && (
        <div style={{ color: '#06c', marginBottom: 12 }}>
          <strong>System:</strong> Full system management access.
        </div>
      )}
      {role === 'guest' && (
        <div style={{ color: '#888', marginBottom: 12 }}>
          Please connect your wallet to submit evidence or view arbitration details.
        </div>
      )}

      <LLMDecisionView evidenceText={evidenceText} contractText={contractText} disputeId={disputeId} />
    </div>
  );
}
