import './Admin.css';
import { useEffect, useState, useRef } from 'react';
import * as ethers from 'ethers';

// Use explicit backend host in dev to avoid Vite serving index.html for /api paths
const API_BASE = (import.meta.env && import.meta.env.DEV) ? 'http://localhost:3001' : '';
const apiFetch = (p, opts) => fetch(`${API_BASE}${p}`, opts);

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
  const [lastRecovered, setLastRecovered] = useState(null);
  const [lastSignaturePreview, setLastSignaturePreview] = useState(null);

  useEffect(() => {
    // Guard to avoid double-run in React StrictMode or HMR during development
    try {
      if (typeof window !== 'undefined' && window.__ADMIN_INIT_RAN) return;
      if (typeof window !== 'undefined') window.__ADMIN_INIT_RAN = true;
    } catch (e) {
      // ignore
    }

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
          const nonceRes = await apiFetch(`/api/v7/admin/nonce?address=${encodeURIComponent(addr)}`);
          const nonceJson = await nonceRes.json();
          if (!nonceJson || !nonceJson.message) {
            // fallback to authorized check
            const res = await apiFetch(`/api/v7/admin/authorized?address=${encodeURIComponent(addr)}`);
            const j = await res.json();
            setAuthorized(!!j.isAdmin);
            setAdminStatus(j);
            setLogs(l => [[new Date().toISOString(), `Auth check for ${addr}: isAdmin=${j.isAdmin}, adminAddress=${j.adminAddress}`], ...l]);
            return;
          }

          setLogs(l => [[new Date().toISOString(), `Nonce requested for ${addr}`], ...l]);
          // Prompt user to sign. Prefer EIP-712 typed-data signing for cross-wallet determinism.
          const message = nonceJson.message;
          const nonce = nonceJson.nonce;
          let signature = null;
          let usedEip712 = false;
          // Build EIP-712 payload
          const chainId = (window.ethereum && window.ethereum.chainId) ? Number(window.ethereum.chainId) : 31337;
          const domain = {
            name: 'ArbiTrust Admin Login',
            version: '1',
            chainId: chainId
          };
          const types = {
            AdminLogin: [
              { name: 'address', type: 'address' },
              { name: 'nonce', type: 'string' }
            ]
          };
          const typedMessage = { address: addr, nonce };
          try {
            // Try EIP-712 typed signing. Prefer eth_signTypedData_v4 (widely supported by wallets),
            // then provider/signer helpers (signTypedData/_signTypedData).
            if (typeof window !== 'undefined' && window.ethereum) {
              try {
                // First try the RPC eth_signTypedData_v4 which many wallets implement
                try {
                  const payload = JSON.stringify({ domain, types: { AdminLogin: types.AdminLogin }, message: typedMessage });
                  const ethSig = await window.ethereum.request({ method: 'eth_signTypedData_v4', params: [addr, payload] });
                  if (ethSig) {
                    signature = ethSig;
                    usedEip712 = true;
                    var eip712Method = 'eth_signTypedData_v4';
                  }
                } catch (ethErr) {
                  // ignore and try signer helpers
                }

                if (!signature) {
                  const provider = new ethers.BrowserProvider(window.ethereum);
                  const signer = await provider.getSigner(addr);
                  if (typeof signer.signTypedData === 'function') {
                    signature = await signer.signTypedData(domain, types, typedMessage);
                    usedEip712 = true;
                    eip712Method = 'signTypedData';
                  } else if (typeof signer._signTypedData === 'function') {
                    signature = await signer._signTypedData(domain, types, typedMessage);
                    usedEip712 = true;
                    eip712Method = '_signTypedData';
                  }
                }
              } catch (eipErr) {
                // typed signing failed - will fall back to legacy
                signature = null;
              }
            }
          } catch (err) {
            // ignore and fall back
            signature = null;
          }
          try {
            // Only perform legacy message signing if we didn't already obtain an EIP-712 signature
            if (!signature) {
              if (typeof window !== 'undefined' && window.ethereum && typeof window.ethereum.request === 'function') {
                try {
                  const provider = new ethers.BrowserProvider(window.ethereum);
                  // Request a signer for the exact address to avoid accidental signing with a different account
                  const web3Signer = await provider.getSigner(addr);
                  signature = await web3Signer.signMessage(message);
                } catch (providerErr) {
                  // Fallback to personal_sign if signer.signMessage fails for some providers
                  try {
                    signature = await window.ethereum.request({ method: 'personal_sign', params: [message, addr] });
                  } catch (innerErr) {
                    // Some providers require hex-encoded message for personal_sign - try that as a last resort
                    try {
                      const hexMsg = ethers.hexlify(ethers.toUtf8Bytes(message));
                      signature = await window.ethereum.request({ method: 'personal_sign', params: [hexMsg, addr] });
                      setLogs(l => [[new Date().toISOString(), 'Used hex-encoded personal_sign fallback'], ...l]);
                    } catch (innerErr2) {
                      setLogs(l => [[new Date().toISOString(), `Signing error from provider: ${String(innerErr2 && (innerErr2.message || innerErr2))}`], ...l]);
                    }
                  }
                }
              } else {
                setLogs(l => [[new Date().toISOString(), 'personal_sign not available (no injected wallet)'], ...l]);
              }
            }
          } catch (signErr) {
            setLogs(l => [[new Date().toISOString(), `Signing failed: ${String(signErr && (signErr.message || signErr))}`], ...l]);
          }
          if (!signature) {
            // Fall back to legacy string signing flow (existing logic)
            try {
              if (typeof window !== 'undefined' && window.ethereum && typeof window.ethereum.request === 'function') {
                  try {
                  const provider = new ethers.BrowserProvider(window.ethereum);
                  // Request a signer for the exact address to avoid accidental signing with a different account
                  const web3Signer = await provider.getSigner(addr);
                  signature = await web3Signer.signMessage(message);
                } catch (providerErr) {
                  // Fallback to personal_sign if signer.signMessage fails for some providers
                  try {
                    signature = await window.ethereum.request({ method: 'personal_sign', params: [message, addr] });
                  } catch (innerErr) {
                    // Some providers require hex-encoded message for personal_sign - try that as a last resort
                    try {
                      const hexMsg = ethers.hexlify(ethers.toUtf8Bytes(message));
                      signature = await window.ethereum.request({ method: 'personal_sign', params: [hexMsg, addr] });
                      setLogs(l => [[new Date().toISOString(), 'Used hex-encoded personal_sign fallback'], ...l]);
                    } catch (innerErr2) {
                      setLogs(l => [[new Date().toISOString(), `Signing error from provider: ${String(innerErr2 && (innerErr2.message || innerErr2))}`], ...l]);
                    }
                  }
                }
              } else {
                setLogs(l => [[new Date().toISOString(), 'personal_sign not available (no injected wallet)'], ...l]);
              }
            } catch (signErr) {
              setLogs(l => [[new Date().toISOString(), `Signing failed: ${String(signErr && (signErr.message || signErr))}`], ...l]);
            }
          }
          if (!signature) return;
          // In development, log the full message and signature to make debugging easier
          try {
            if (import.meta.env && import.meta.env.DEV) {
              setLogs(l => [[new Date().toISOString(), `DEBUG (dev) Signed message:\n${message}`], [new Date().toISOString(), `DEBUG (dev) Signature: ${signature}`], ...l]);
            }
          } catch (err) {
            // ignore logging errors
          }
          // Client-side verify the signature to make sure the signing account matches the expected address
          try {
            const recoveredLocal = ethers.verifyMessage(message, signature);
            setLastRecovered(recoveredLocal);
            setLastSignaturePreview(signature && `${signature.slice(0,10)}...${signature.slice(-8)}`);
            setLogs(l => [[new Date().toISOString(), `Local signature recovered address: ${recoveredLocal}`], ...l]);
            if (String(recoveredLocal).toLowerCase() !== String(addr).toLowerCase()) {
              setLogs(l => [[new Date().toISOString(), `Signature recovered to different address than connected account. Aborting verify POST.`], ...l]);
              setLogs(l => [[new Date().toISOString(), `Expected: ${addr} - Recovered: ${recoveredLocal}`], ...l]);
              // Do not send mismatched signature to server
              return;
            }
          } catch (verifyErr) {
            setLogs(l => [[new Date().toISOString(), `Local signature verification failed: ${verifyErr && (verifyErr.message || verifyErr)}`], ...l]);
            // continue to send to server to surface server-side error if needed
          }
          // In development, POST the signed message+signature to the server recover endpoint to compare server-side recovery
          try {
            if (import.meta.env && import.meta.env.DEV) {
              try {
                const recRes = await apiFetch('/api/v7/debug/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, signature }) });
                const recJson = await recRes.json();
                setLogs(l => [[new Date().toISOString(), `Server recover result: ${JSON.stringify(recJson)}`], ...l]);
              } catch (recErr) {
                setLogs(l => [[new Date().toISOString(), `Server recover POST failed: ${recErr && (recErr.message || recErr)}`], ...l]);
              }
            }
          } catch (err) {}
          // Send signature to server for verification
          try {
            // If we used EIP-712, include a canonical typed payload; otherwise send legacy message
            let verifyBody = null;
            if (usedEip712) {
              // Ensure types object uses the explicit primary type key expected by signer
              const canonicalTypes = { AdminLogin: types.AdminLogin || types.AdminLogin };
              verifyBody = { address: addr, signature, eip712: true, eip712Method: eip712Method || 'unknown', domain, types: canonicalTypes, message: typedMessage };
              // In dev, log the exact payload we will send so server-side debug can be compared
              if (import.meta.env && import.meta.env.DEV) {
                const debugPayload = { address: addr, eip712: true, eip712Method: eip712Method || null, domain, types: canonicalTypes, message: typedMessage };
                setLogs(l => [[new Date().toISOString(), `DEBUG (dev) EIP-712 verify payload: ${JSON.stringify(debugPayload)}`], ...l]);
                // Also add an explicit log indicating usedEip712 state and method
                setLogs(l => [[new Date().toISOString(), `DEBUG (dev) usedEip712: ${usedEip712} method: ${eip712Method || 'none'}`], ...l]);
              }
            } else {
              verifyBody = { address: addr, signature, message };
            }
            const verifyRes = await apiFetch('/api/v7/admin/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(verifyBody) });
            if (!verifyRes.ok) {
              // Try to parse JSON error, fallback to text
              let errBody = null;
              try { errBody = await verifyRes.json(); } catch (e) { errBody = await verifyRes.text(); }
              setAuthorized(false);
              setLogs(l => [[new Date().toISOString(), `Verification failed (${verifyRes.status}): ${JSON.stringify(errBody)}`], ...l]);
            } else {
              const verifyJson = await verifyRes.json();
              if (verifyJson && verifyJson.verified) {
                setAuthorized(true);
                setLogs(l => [[new Date().toISOString(), `Address ${addr} verified as admin (expires ${new Date(verifyJson.expires).toISOString()})`], ...l]);
              } else {
                setAuthorized(false);
                setLogs(l => [[new Date().toISOString(), `Verification failed: ${JSON.stringify(verifyJson)}`], ...l]);
              }
            }
          } catch (postErr) {
            setLogs(l => [[new Date().toISOString(), `Verification request failed: ${String(postErr && (postErr.message || postErr))}`], ...l]);
            setAuthorized(false);
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
      if (address) {
        opts.headers['x-admin-address'] = address;
        opts.headers['Authorization'] = `Bearer ${address}`;
      }
      const res = await apiFetch(ep.path, opts);
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
  const res = await apiFetch('/api/v7/debug/list');
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
  const res = await apiFetch(`/api/v7/admin/authorized?address=${encodeURIComponent(addrToCheck)}`);
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
