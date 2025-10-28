import React, { useState, useEffect, useRef } from 'react';
import { getDisputeHistory, requestArbitration, triggerArbitrateBatch } from '../api/arbitration';

export default function ArbitrationPanel({ defaultCaseId = '' }) {
  const [caseId, setCaseId] = useState(defaultCaseId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(null);
  const [result, setResult] = useState(null);

  async function loadHistory() {
    setError(null);
    setLoading(true);
    try {
      const h = await getDisputeHistory(caseId);
      // normalize common shapes: { entries: [...] } or { history: [...] } or array directly
      let normalized = h;
      if (!h) normalized = null;
      else if (Array.isArray(h)) normalized = { entries: h };
      else if (h.history && Array.isArray(h.history)) normalized = { entries: h.history, ...h };
      else if (h.entries && Array.isArray(h.entries)) normalized = h;
      else normalized = h;
      setHistory(normalized);
    } catch (e) {
      setError(e.message || String(e));
      setHistory(null);
    } finally {
      setLoading(false);
    }
  }

  async function doArbitrate() {
    setError(null);
    setLoading(true);
    try {
      const r = await requestArbitration(caseId);
      setResult(r);
      // refresh history after request
      try { await loadHistory(); } catch (e) { /* ignore */ }
      // start polling history until a decision appears
      startPolling();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  const pollingRef = useRef({ attempts: 0, timer: null, stopped: false });

  useEffect(() => {
    return () => {
      // cleanup on unmount
      pollingRef.current.stopped = true;
      if (pollingRef.current.timer) clearTimeout(pollingRef.current.timer);
    };
  }, []);

  function startPolling() {
    pollingRef.current.attempts = 0;
    pollingRef.current.stopped = false;
    const attempt = async () => {
      if (pollingRef.current.stopped) return;
      pollingRef.current.attempts += 1;
      try {
        const h = await getDisputeHistory(caseId).catch(() => null);
        let normalized = h;
        if (Array.isArray(h)) normalized = { entries: h };
        if (normalized && (normalized.aiDecision || (Array.isArray(normalized.entries) && normalized.entries.some(e => e.aiDecision)))) {
          setHistory(normalized);
          return; // stop polling
        }
      } catch (e) { /* ignore */ }
      // exponential backoff up to ~30s
      const delay = Math.min(1000 * Math.pow(1.5, pollingRef.current.attempts), 30000);
      pollingRef.current.timer = setTimeout(attempt, delay);
    };
    attempt();
  }

  return (
    <div className="arbitration-panel" style={{border:'1px solid #ddd', padding:12, borderRadius:6}}>
      <div style={{display:'flex', gap:8, alignItems:'center'}}>
        <input
          aria-label="case-id"
          placeholder="Enter caseId or batchId"
          value={caseId}
          onChange={(e) => setCaseId(e.target.value)}
          style={{flex:1, padding:8}}
        />
        <button onClick={loadHistory} disabled={!caseId || loading}>Load History</button>
        <button onClick={doArbitrate} disabled={!caseId || loading} style={{marginLeft:8}}>Request Arbitration</button>
      </div>
      {loading && <div style={{marginTop:8}}>Loading...</div>}
      {error && <div style={{color:'crimson', marginTop:8}}>Error: {error}</div>}
      {result && (
        <div style={{marginTop:8}}>
          <strong>Arbitration request submitted</strong>
          <div>Result: {JSON.stringify(result)}</div>
        </div>
      )}
      {history && (
        <div style={{marginTop:8}}>
          <h4>Dispute History</h4>
          <div style={{maxHeight:320, overflow:'auto', background:'#fafafa', padding:8}}>
            {(history.entries || []).length === 0 ? (
              <div style={{color:'#666'}}>No history entries</div>
            ) : (
              (history.entries || []).map((entry, idx) => {
                const ai = entry.aiDecision || entry.ai || history.aiDecision || null;
                const when = entry.date || entry.timestamp || (entry.blockNumber ? `block ${entry.blockNumber}` : '');
                return (
                  <div key={idx} style={{padding:8, borderBottom:'1px solid #eee'}}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                      <div style={{fontSize:13}}>
                        <strong>{entry.type || entry.event || entry.name || 'Entry'}</strong>
                        {when ? (<span style={{marginLeft:8, color:'#666'}}>{when}</span>) : null}
                      </div>
                      <div style={{display:'flex', gap:8, alignItems:'center'}}>
                        {ai ? (
                          <div style={{display:'flex', gap:8, alignItems:'center'}}>
                            <span aria-hidden style={{fontSize:16}}>
                              {ai.verdict === 'allow' || ai.verdict === 'ok' ? '✅' : (ai.verdict === 'deny' || ai.verdict === 'no' ? '❌' : '⚖️')}
                            </span>
                            <div style={{padding:'4px 8px', borderRadius:6, background: ai.verdict === 'allow' || ai.verdict === 'ok' ? '#e6ffed' : '#fff0f0', color: ai.verdict === 'allow' || ai.verdict === 'ok' ? '#067a24' : '#a00'}}>
                              <strong>{String(ai.verdict || ai.result || ai.decision || 'Pending')}</strong>
                            </div>
                          </div>
                        ) : (
                          <div style={{color:'#888', fontSize:13}}>No AI decision</div>
                        )}
                        <button onClick={async () => {
                          setLoading(true); setError(null);
                          try {
                            const payload = { caseId: caseId || null, entry, contractAddress: history.contractAddress || null };
                            const r = await triggerArbitrateBatch(payload);
                            setResult(r);
                            // refresh
                            await loadHistory();
                          } catch (err) { setError(err?.message || String(err)); }
                          finally { setLoading(false); }
                        }} style={{fontSize:12}}>🔁 Resubmit</button>
                      </div>
                    </div>
                    <div style={{marginTop:6, fontSize:13}}>{entry.summary || entry.data?.complaint || entry.data?.evidence || (entry.data ? JSON.stringify(entry.data) : '')}</div>
                    {ai && ai.rationale ? (
                      <details style={{marginTop:8}}>
                        <summary style={{cursor:'pointer'}}>AI Rationale</summary>
                        <pre style={{whiteSpace:'pre-wrap', marginTop:8}}>{ai.rationale}</pre>
                      </details>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
