import React, { useState } from 'react';

export default function LLMDecisionView({ evidenceText, contractText, disputeId }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function fetchLLMDecision() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const resp = await fetch('/api/v7/arbitration/ollama-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evidence_text: evidenceText, contract_text: contractText, dispute_id: disputeId })
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
      setResult(json.result || json);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="llm-decision-view" style={{border:'1px solid #b3c6ff', borderRadius:8, padding:16, background:'#f6f8ff', margin:'18px 0'}}>
      <h4>LLM Arbitration Decision</h4>
      <button onClick={fetchLLMDecision} disabled={loading} style={{marginBottom:12}}>
        {loading ? 'Loading...' : 'Fetch LLM Decision'}
      </button>
      {error && <div style={{color:'crimson', marginBottom:8}}>Error: {error}</div>}
      {result && (
        <div>
          <div style={{marginBottom:8}}>
            <strong>Verdict:</strong> {result.verdict || result.decision || '—'}
          </div>
          <div style={{marginBottom:8}}>
            <strong>Confidence:</strong> {result.confidence || '—'}
          </div>
          <div style={{marginBottom:8}}>
            <strong>Reimbursement:</strong> {result.reimbursement || '—'}
          </div>
          <div style={{marginBottom:8}}>
            <strong>Rationale:</strong>
            <div style={{whiteSpace:'pre-wrap', background:'#eef', padding:8, borderRadius:4}}>{result.rationale || '—'}</div>
          </div>
          <details>
            <summary>Raw Response</summary>
            <pre style={{fontSize:12, background:'#fafafa', padding:8, borderRadius:4}}>{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
