import React, { useState } from 'react';
import EvidenceViewer from './EvidenceViewer.jsx';
import EvidenceErrorHelp from './EvidenceErrorHelp.jsx';

const statusColors = {
  verified: '#d2f8d2',
  'cid-mismatch': '#fdd',
  'content-mismatch': '#fdd',
  'sig-invalid': '#ffe4b3',
  'fetch-failed': '#fdd',
  error: '#fdd',
  pending: '#eef'
};

function getStatusDescription(status) {
  const descriptions = {
    verified: 'All integrity checks passed - content is authentic',
    'cid-mismatch': 'CID digest mismatch - content may have been replaced',
    'content-mismatch': 'Content digest mismatch - original content was modified',
    'sig-invalid': 'EIP-712 signature verification failed',
    'fetch-failed': 'Could not retrieve evidence from off-chain storage',
    error: 'General verification error occurred',
    pending: 'Evidence verification in progress'
  };
  return descriptions[status] || 'Unknown status';
}

export default function EvidenceCard({ ev, onView, heliaClient }) {
  const [copied, setCopied] = useState(false);
  const [showViewer, setShowViewer] = useState(false);
  const [showErrorHelp, setShowErrorHelp] = useState(false);
  const [fetchSource, setFetchSource] = useState(null); // 'helia' | 'gateway' | null
  const hasError = ['sig-invalid', 'cid-mismatch', 'content-mismatch', 'fetch-failed', 'error'].includes(ev.status);

  async function copyCID() {
    try {
      await navigator.clipboard.writeText(ev.cid);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) { void e;
      console.warn('Copy failed:', e);
    }
  }

  async function handleOpenEvidence() {
    if (heliaClient && ev.cid) {
      try {
        // Try to fetch evidence from Helia
        setFetchSource('helia');
        setShowViewer(true);
        // EvidenceViewer will use heliaClient prop
      } catch (e) { void e;
        setFetchSource('gateway');
        setShowViewer(true);
      }
    } else {
      setFetchSource('gateway');
      setShowViewer(true);
    }
  }

  const color = statusColors[ev.status] || '#eef';
  return (
    <div className="transaction-item" style={{display:'flex',flexDirection:'column',position:'relative'}}>
      <div style={{position:'absolute',top:6,right:6,display:'flex',gap:6}}>
        <span 
          title={hasError ? `Status: ${ev.status} - Click for help` : `Status: ${ev.status} - ${getStatusDescription(ev.status)}`}
          style={{
            padding:'2px 6px',
            borderRadius:4,
            fontSize:11,
            background:color,
            cursor: hasError ? 'pointer' : 'default',
            border: hasError ? '1px solid rgba(0,0,0,0.2)' : 'none'
          }}
          onClick={hasError ? () => setShowErrorHelp(true) : undefined}
        >
          {ev.status} {hasError ? '❓' : ''}
        </span>
        {ev.encrypted && (
          <span 
            title="Evidence is encrypted to specific recipients"
            style={{padding:'2px 6px',borderRadius:4,fontSize:11,background:'#ffe4b3'}}>
            Encrypted
          </span>
        )}
        {ev.encrypted && ev.fetched?.recipients?.map((r,i)=>{
          const fail = r.encryptedKey && (r.encryptedKey.code==='ECIES_ENCRYPT_FAIL' || r.encryptedKey.legacy);
          const title = fail ? `Encryption failed: ${r.encryptedKey?.message||'error'}` : 'Encryption successful for recipient';
          return (
            <span 
              key={i} 
              title={title} 
              style={{
                padding:'2px 4px',
                borderRadius:4,
                fontSize:10,
                background: fail? '#ffb3b3':'#d2f8d2',
                cursor: 'help'
              }}
            >
              {fail?'E!':'E✓'}
            </span>
          );
        })}
        {ev.sigValid === false && (
          <span 
            title="EIP-712 signature verification failed - evidence may be forged"
            style={{padding:'2px 6px',borderRadius:4,fontSize:11,background:'#ffc9c9'}}>
            Bad Sig
          </span>
        )}
      </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
        <div style={{flex:1}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <strong>CID:</strong> 
            <span style={{fontFamily:'monospace',fontSize:'12px'}}>{ev.cid}</span>
            <button 
              onClick={copyCID} 
              style={{
                padding:'2px 6px',
                fontSize:'10px',
                border:'1px solid #ccc',
                borderRadius:'3px',
                background: copied ? '#d2f8d2' : '#f9f9f9',
                cursor:'pointer'
              }}
              title="Copy CID to clipboard"
            >
              {copied ? '✓' : 'Copy'}
            </button>
          </div>
          <div><strong>cidDigest(event):</strong> {ev.cidDigestEvent}</div>
          <div><strong>cidDigest(local):</strong> {ev.cidDigestLocal || '—'}</div>
          <div><strong>contentDigest(local):</strong> {ev.contentDigestLocal || '—'}</div>
          <div><strong>submitter:</strong> {ev.submitter}</div>
          <div><strong>tx:</strong> {ev.txHash?.slice(0,18)}...</div>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          <button className="btn-sm" onClick={() => onView && onView(ev)}>View JSON</button>
          <button 
            className="btn-sm" 
            onClick={handleOpenEvidence}
            style={{
              background: '#f0f8ff',
              color: '#0066cc',
              border: '1px solid #0066cc'
            }}
            title="Open evidence via IPFS gateway or Helia"
          >
            📂 Open Evidence
          </button>
          {ev.cid && (
            <a href={`/api/evidence/retrieve/${ev.cid}`} target="_blank" rel="noreferrer" className="btn-sm outline">View via API</a>
          )}
          {ev.cid && <a className="btn-sm outline" href={`https://ipfs.io/ipfs/${ev.cid}`} target="_blank" rel="noreferrer">IPFS</a>}
          {ev.fetched && <button className="btn-sm outline" onClick={() => { try { const blob = new Blob([JSON.stringify(ev.fetched,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`evidence-${ev.cidDigestEvent.slice(2,10)}.json`; a.click(); } catch (e) { void e;} }}>Export</button>}
        </div>
      </div>
      {fetchSource && (
        <div style={{fontSize:12,marginTop:4,color:'#888'}}>
          Source: {fetchSource === 'helia' ? 'Helia/IPFS node' : 'Public IPFS gateway'}
        </div>
      )}
      <EvidenceViewer 
        cid={ev.cid} 
        isOpen={showViewer} 
        onClose={() => setShowViewer(false)}
        heliaClient={heliaClient || null}
      />
      <EvidenceErrorHelp 
        status={ev.status} 
        isOpen={showErrorHelp} 
        onClose={() => setShowErrorHelp(false)} 
      />
    </div>
  );
}
