import React, { useState } from 'react';

// Configuration for evidence gateways
const EVIDENCE_GATEWAYS = [
  { name: 'Helia (Direct)', url: 'helia://', type: 'helia' },
  { name: 'IPFS Gateway', url: 'https://ipfs.io/ipfs/', type: 'gateway' },
  { name: 'Local Gateway', url: 'http://127.0.0.1:8080/ipfs/', type: 'gateway' },
  { name: 'Cloudflare IPFS', url: 'https://cloudflare-ipfs.com/ipfs/', type: 'gateway' }
];

export default function EvidenceViewer({ cid, isOpen, onClose, heliaClient }) {
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState(null);
  const [error, setError] = useState(null);
  const [selectedGateway, setSelectedGateway] = useState(0);

  async function fetchViaDirect() {
    if (!heliaClient) throw new Error('Helia client not available');
    setLoading(true);
    setError(null);
    try {
      const { getJson } = await import('../../utils/heliaClient.js');
      const json = await getJson(cid);
      setContent(json);
    } catch (e) {
      setError(`Direct fetch failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function fetchViaGateway(gatewayUrl) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${gatewayUrl}${cid}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      setContent(json);
    } catch (e) {
      setError(`Gateway fetch failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleFetch() {
    const gateway = EVIDENCE_GATEWAYS[selectedGateway];
    if (gateway.type === 'helia') {
      await fetchViaDirect();
    } else {
      await fetchViaGateway(gateway.url);
    }
  }

  function openInNewTab() {
    const gateway = EVIDENCE_GATEWAYS.find(g => g.type === 'gateway');
    const url = `${gateway.url}${cid}`;
    window.open(url, '_blank');
  }

  if (!isOpen) return null;

  return (
    <div className="modal">
      <div className="modal-content" style={{ maxWidth: '700px' }}>
        <h3>Evidence Viewer</h3>
        <div style={{ marginBottom: '16px' }}>
          <strong>CID:</strong> 
          <span style={{ fontFamily: 'monospace', marginLeft: '8px' }}>{cid}</span>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px' }}>
          <label>Fetch via:</label>
          <select 
            value={selectedGateway} 
            onChange={(e) => setSelectedGateway(Number(e.target.value))}
            style={{ flex: 1 }}
          >
            {EVIDENCE_GATEWAYS.map((gw, i) => (
              <option key={i} value={i}>{gw.name}</option>
            ))}
          </select>
          <button onClick={handleFetch} disabled={loading}>
            {loading ? 'Fetching...' : 'Fetch'}
          </button>
          <button onClick={openInNewTab} className="outline">
            Open in New Tab
          </button>
        </div>

        {error && (
          <div style={{ color: 'crimson', marginBottom: '16px', padding: '8px', background: '#fee', borderRadius: '4px' }}>
            <strong>Error:</strong> {error}
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
              Try a different gateway or check your network connection.
            </div>
          </div>
        )}

        {content && (
          <div style={{ marginBottom: '16px' }}>
            <h5>Evidence Content:</h5>
            <pre style={{ 
              maxHeight: '400px', 
              overflow: 'auto', 
              background: '#f9f9f9', 
              padding: '12px', 
              borderRadius: '4px',
              fontSize: '12px'
            }}>
              {JSON.stringify(content, null, 2)}
            </pre>
          </div>
        )}

        <div style={{ fontSize: '0.9em', color: '#666', marginBottom: '16px' }}>
          <strong>Gateway Info:</strong>
          <ul style={{ margin: '4px 0', paddingLeft: '20px' }}>
            <li><strong>Helia (Direct):</strong> Fetches directly via local IPFS node (fastest, most reliable)</li>
            <li><strong>IPFS Gateway:</strong> Public HTTP gateway (may be slower, subject to rate limits)</li>
            <li><strong>Local Gateway:</strong> Your local IPFS daemon (requires running IPFS locally)</li>
          </ul>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}