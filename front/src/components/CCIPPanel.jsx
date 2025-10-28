import { useState, useEffect } from 'react';
import { getCcipStatus, startCcipListener, testCcipListener } from '../api/ccip';

export default function CCIPPanel() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastTest, setLastTest] = useState(null);

  const refresh = async () => {
    try {
      const s = await getCcipStatus();
      setStatus(s);
    } catch (e) { setStatus({ ok: false, error: String(e) }); }
  };

  useEffect(() => { void refresh(); }, []);

  const handleStart = async () => {
    setLoading(true);
    try {
      const r = await startCcipListener();
      await refresh();
      return r;
    } catch (e) { return { ok: false, error: String(e) }; } finally { setLoading(false); }
  };

  const handleTest = async () => {
    setLoading(true);
    try {
      const r = await testCcipListener({ test: true });
      setLastTest(r);
      return r;
    } catch (e) { setLastTest({ ok: false, error: String(e) }); return { ok: false, error: String(e) }; } finally { setLoading(false); }
  };

  return (
    <div style={{border:'1px solid #ddd', padding:12, borderRadius:6}} data-testid="ccip-panel">
      <h3>CCIP Controls</h3>
      <div style={{marginBottom:8}}><strong>Status:</strong> {status ? (status.ccip_receiver_loaded ? 'Receiver loaded' : JSON.stringify(status)) : 'Loading...'}</div>
      <div style={{display:'flex',gap:8}}>
        <button onClick={handleStart} disabled={loading}>Start Listener</button>
        <button onClick={handleTest} disabled={loading}>Test</button>
        <button onClick={refresh} disabled={loading}>Refresh</button>
      </div>
      {lastTest && (
        <div style={{marginTop:8}}>
          <strong>Last test:</strong>
          <pre style={{whiteSpace:'pre-wrap', fontSize:12}}>{JSON.stringify(lastTest, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
