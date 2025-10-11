import React, { useEffect, useState } from 'react';
import './ArbitrationExplain.css';

const API_BASE = '/api/v7';

export default function ArbitrationExplain({ disputeId, useSimulateIfDown = true, overrideExplain = null }) {
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState(null);
  const [explain, setExplain] = useState(null);
  const [error, setError] = useState(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      // If caller supplied an override explain object, use it directly and skip fetching
      if (overrideExplain) {
        setExplain(overrideExplain);
        setHealth({ ok: true, override: true });
        setLoading(false);
        return;
      }
      try {
        const hRes = await fetch(`${API_BASE}/arbitration/ollama/health`);
        const hJson = await hRes.json().catch(() => null);
        if (!mounted) return;
        setHealth(hJson || (hRes.ok ? { ok: true } : { ok: false }));

  // Try to fetch explain
        const exRes = await fetch(`${API_BASE}/arbitration/explain/${encodeURIComponent(disputeId)}`);
        if (exRes.ok) {
          const exJson = await exRes.json();
          if (mounted) setExplain(exJson);
        } else if (useSimulateIfDown) {
          // fallback to simulate endpoint
          const simRes = await fetch(`${API_BASE}/arbitration/simulate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disputeId }) });
          if (simRes.ok) {
            const simJson = await simRes.json();
            if (mounted) setExplain(simJson);
          } else {
            const txt = await exRes.text().catch(() => '');
            throw new Error('Explain API failed: ' + (txt || exRes.status));
          }
        } else {
          const txt = await exRes.text().catch(() => '');
          throw new Error('Explain API failed: ' + (txt || exRes.status));
        }
      } catch (e) {
        if (mounted) setError(String(e.message || e));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [disputeId, useSimulateIfDown]);

  if (loading) return <div className="arb-explain-loading">Loading arbitration explanation...</div>;
  if (error) return <div className="arb-explain-error">Error: {error}</div>;
  if (!explain) return <div className="arb-explain-empty">No explanation available</div>;

  const decision = explain.decision || explain.arbitration || (explain.result && explain.result.decision) || 'UNKNOWN';
  const confidence = explain.confidence ?? explain.score ?? null;
  const source = explain.source || explain.origin || 'LLM';
  const mergedRationale = explain.reasoning || explain.merged_rationale || explain.rationale || '';
  const llmRaw = explain.raw || explain.llm_raw || null;
  const nlp = explain.nlp || explain.nlp_mapping || explain.mapped || null;

  return (
    <div className="arb-explain-root">
      <div className="arb-explain-header">
        <div className="arb-explain-decision">Decision: <strong>{decision}</strong></div>
        <div className="arb-explain-meta">Confidence: {confidence !== null ? Number(confidence).toFixed(2) : 'n/a'} &nbsp;|&nbsp; Source: {source}</div>
      </div>

      <div className="arb-explain-body">
        <h4>Merged Rationale</h4>
        <div className="arb-explain-rationale">{mergedRationale}</div>

        {nlp && nlp.mappedFoundKeywords && nlp.mappedFoundKeywords.length > 0 && (
          <div className="arb-explain-nlp">
            <h5>NLP matched keywords</h5>
            <ul>
              {nlp.mappedFoundKeywords.map((k, idx) => <li key={idx}>{k}</li>)}
            </ul>
          </div>
        )}

        <div className="arb-explain-controls">
          <button onClick={() => setShowRaw(!showRaw)}>{showRaw ? 'Hide' : 'Show'} Raw LLM</button>
          {explain && (explain.debugDownloadUrl || (explain._debug && explain._debug.path)) && (
            <a className="arb-explain-download" href={explain.debugDownloadUrl || explain._debug.path} download>Download Debug JSON</a>
          )}
        </div>

        {showRaw && (
          <div className="arb-explain-raw">
            <h5>Raw LLM / Pipeline Output</h5>
            <pre>{typeof llmRaw === 'string' ? llmRaw.slice(0, 20000) : JSON.stringify(llmRaw, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
