import './Admin.css';
import { useEffect, useState } from 'react';

async function getConnectedAddress() {
  try {
    if (typeof window !== 'undefined' && window.ethereum && typeof window.ethereum.request === 'function') {
      // Use eth_accounts to check connection status without prompting the user.
      const accounts = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => null);
      if (accounts && accounts.length > 0) return accounts[0];
    }
  } catch (e) {}
  return null;
}

const endpoints = [
  { label: 'Restart IPFS (debug)', method: 'POST', path: '/api/v7/debug/ipfs/restart' },
  { label: 'Start CCIP (test)', method: 'POST', path: '/api/v7/ccip/start' },
  { label: 'Run CCIP Test', method: 'POST', path: '/api/v7/ccip/test' },
  { label: 'LLM Health', method: 'GET', path: '/api/v7/arbitration/ollama/health' },
  { label: 'Simulate Arbitration', method: 'POST', path: '/api/v7/arbitration/simulate' }
];

export default function Admin() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [debugFiles, setDebugFiles] = useState(null);
  const [address, setAddress] = useState(null);
  const [hasWallet, setHasWallet] = useState(true);
  const [useLocalRpc, setUseLocalRpc] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [adminStatus, setAdminStatus] = useState(null);

  useEffect(() => {
    (async () => {
      // Detect injected provider first; avoid attempting connect if none is present
      const injected = (typeof window !== 'undefined' && window.ethereum);
      setHasWallet(!!injected);
      if (!injected) {
        setLogs(l => [[new Date().toISOString(), 'No injected wallet detected. You can install MetaMask or use Local RPC (read-only).'], ...l]);
        return;
      }
      const addr = await getConnectedAddress();
      setAddress(addr);
      // if we already have an address, fetch authorization/status
      if (addr) {
        fetchAdminStatus(addr);
      }
      if (addr) {
        try {
          // Ask server for nonce and perform signature flow
          const nonceRes = await fetch(`/api/v7/admin/nonce?address=${encodeURIComponent(addr)}`);
          const nonceJson = await nonceRes.json();
          if (!nonceJson || !nonceJson.message) {
            // fallback to authorized check
            const res = await fetch(`/api/v7/admin/authorized?address=${encodeURIComponent(addr)}`);
            const j = await res.json();
            setAuthorized(!!j.authorized);
            setLogs(l => [[new Date().toISOString(), `Auth check for ${addr}: ${j.authorized}`], ...l]);
            return;
          }

          setLogs(l => [[new Date().toISOString(), `Nonce requested for ${addr}`], ...l]);
          // Prompt user to sign the message using personal_sign
          const message = nonceJson.message;
          let signature = null;
          try {
            // Only attempt to sign if the injected provider and the request method are available.
            if (typeof window !== 'undefined' && window.ethereum && typeof window.ethereum.request === 'function') {
              // Use a safe request and catch provider-specific errors.
              try {
                signature = await window.ethereum.request({ method: 'personal_sign', params: [message, addr] });
              } catch (providerErr) {
                // Log provider-specific errors and continue without throwing an uncaught promise.
                setLogs(l => [[new Date().toISOString(), `Signing error from provider: ${String(providerErr && (providerErr.message || providerErr))}`], ...l]);
              }
            } else {
              setLogs(l => [[new Date().toISOString(), 'personal_sign not available (no injected wallet)'], ...l]);
            }
          } catch (signErr) {
            setLogs(l => [[new Date().toISOString(), `Signing failed: ${String(signErr && (signErr.message || signErr))}`], ...l]);
          }
          if (!signature) return;
          // Send signature to server for verification
          const verifyRes = await fetch('/api/v7/admin/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: addr, signature }) });
          const verifyJson = await verifyRes.json();
          if (verifyJson && verifyJson.verified) {
            setAuthorized(true);
            setLogs(l => [[new Date().toISOString(), `Address ${addr} verified as admin (expires ${new Date(verifyJson.expires).toISOString()})`], ...l]);
          } else {
            setAuthorized(false);
            setLogs(l => [[new Date().toISOString(), `Verification failed: ${JSON.stringify(verifyJson)}`], ...l]);
          }
        } catch (e) {
          setLogs(l => [[new Date().toISOString(), `Auth nonce/sign flow failed: ${e.message}`], ...l]);
        }
      }
    })();
  }, []);

  const callEndpoint = async (ep) => {
    setLoading(true);
    setLogs(l => [[new Date().toISOString(), `Calling ${ep.method} ${ep.path}`], ...l]);
    try {
      const opts = { method: ep.method };
      // For simulate, send an empty body if server expects JSON
      if (ep.path.endsWith('/simulate')) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify({ test: true });
      }
      // include admin address so backend can verify
      opts.headers = opts.headers || {};
      if (address) opts.headers['x-admin-address'] = address;
      const res = await fetch(ep.path, opts);
      const txt = await res.text();
      setLogs(l => [[new Date().toISOString(), `${ep.path} -> ${res.status} ${res.statusText}`], [new Date().toISOString(), txt], ...l]);
    } catch (err) {
      setLogs(l => [[new Date().toISOString(), `ERROR calling ${ep.path}: ${err.message}`], ...l]);
    } finally {
      setLoading(false);
    }
  };

  const fetchDebugList = async () => {
  setLoading(true);
    try {
  const res = await fetch('/api/v7/debug/list');
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const json = await res.json();
      setDebugFiles(json.files || json);
      setLogs(l => [[new Date().toISOString(), `Fetched debug list (${Array.isArray(json) ? json.length : (json.files||[]).length})`], ...l]);
    } catch (err) {
      setLogs(l => [[new Date().toISOString(), `ERROR fetching debug list: ${err.message}`], ...l]);
    } finally {
      setLoading(false);
    }
  };

  const fetchAdminStatus = async (addrToCheck) => {
    if (!addrToCheck) return;
    setStatusLoading(true);
    try {
      const res = await fetch(`/api/v7/admin/authorized?address=${encodeURIComponent(addrToCheck)}`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const json = await res.json();
      setAdminStatus(json);
      setLogs(l => [[new Date().toISOString(), `Admin status fetched for ${addrToCheck}: ${JSON.stringify(json)}`], ...l]);
    } catch (err) {
      setLogs(l => [[new Date().toISOString(), `ERROR fetching admin status: ${err.message}`], ...l]);
      setAdminStatus({ error: err.message });
    } finally {
      setStatusLoading(false);
    }
  };

  return (
    <div className="admin-page">
      <h2>Admin / Developer Controls</h2>
      <p className="hint">This page exposes debug and integration endpoints. Actions here should be used in development only.</p>

      <div className="buttons">
        {!authorized && <div className="muted">You are not authorized to perform admin actions. Connect the owner wallet to enable controls.</div>}
        {!hasWallet && (
          <div className="muted">
            MetaMask not detected in this browser. <a href="https://metamask.io/" target="_blank" rel="noreferrer">Install MetaMask</a> or use the Local RPC fallback below.
            <div style={{ marginTop: 8 }}>
              <button className="admin-btn secondary" onClick={() => { setUseLocalRpc(true); setLogs(l => [[new Date().toISOString(), 'Using Local RPC (read-only)'], ...l]); fetchDebugList(); }} disabled={loading}>Use Local RPC (read-only)</button>
            </div>
          </div>
        )}
        {authorized && endpoints.map(ep => (
          <button key={ep.path} onClick={() => callEndpoint(ep)} disabled={loading} className="admin-btn">
            {ep.label}
          </button>
        ))}
      </div>

      <div className="admin-status">
        <h4>Admin Status</h4>
        <div style={{ marginBottom: 8 }}>
          <strong>Connected address:</strong> {address || <span className="muted">(not connected)</span>}
        </div>
        <div style={{ marginBottom: 8 }}>
          <button className="admin-btn secondary" onClick={() => fetchAdminStatus(address)} disabled={!address || statusLoading}>Check status</button>
        </div>
        {statusLoading && <div>Checking...</div>}
        {adminStatus && (
          <div className="status-box">
            {adminStatus.error && <div className="muted">Error: {adminStatus.error}</div>}
            {!adminStatus.error && (
              <div>
                <div><strong>authorized:</strong> {String(!!adminStatus.authorized)}</div>
                {adminStatus.owner && <div><strong>owner:</strong> {adminStatus.owner}</div>}
                {adminStatus.checkedAddress && <div><strong>checkedAddress:</strong> {adminStatus.checkedAddress}</div>}
                {adminStatus.reason && <div><strong>reason:</strong> {adminStatus.reason}</div>}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="debug-files">
        <button onClick={fetchDebugList} disabled={loading} className="admin-btn secondary">List debug files</button>
        {debugFiles && Array.isArray(debugFiles) && (
          <ul>
            {debugFiles.map(f => (
              <li key={f}>
                <a href={`/api/v7/debug/download?file=${encodeURIComponent(f)}`} target="_blank" rel="noreferrer">{f}</a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="logs">
        <h3>Activity log</h3>
        <div className="log-list">
          {logs.length === 0 && <div className="muted">No activity yet</div>}
          {logs.map((entry, idx) => (
            <div key={idx} className="log-entry">
              <div className="log-time">{entry[0]}</div>
              <pre className="log-text">{entry[1]}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
