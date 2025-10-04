import React from 'react';

const statusColors = {
  verified: '#d2f8d2',
  'cid-mismatch': '#fdd',
  'content-mismatch': '#fdd',
  'sig-invalid': '#ffe4b3',
  'fetch-failed': '#fdd',
  error: '#fdd',
  pending: '#eef'
};

export default function EvidenceCard({ ev, onView }) {
  const color = statusColors[ev.status] || '#eef';
  return (
    <div className="transaction-item" style={{display:'flex',flexDirection:'column',position:'relative'}}>
      <div style={{position:'absolute',top:6,right:6,display:'flex',gap:6}}>
        <span style={{padding:'2px 6px',borderRadius:4,fontSize:11,background:color}}>{ev.status}</span>
        {ev.encrypted && <span style={{padding:'2px 6px',borderRadius:4,fontSize:11,background:'#ffe4b3'}}>Encrypted</span>}
        {ev.sigValid === false && <span style={{padding:'2px 6px',borderRadius:4,fontSize:11,background:'#ffc9c9'}}>Bad Sig</span>}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        <div style={{flex:1}}>
          <div><strong>CID:</strong> {ev.cid}</div>
          <div><strong>cidDigest(event):</strong> {ev.cidDigestEvent}</div>
          <div><strong>cidDigest(local):</strong> {ev.cidDigestLocal || '—'}</div>
          <div><strong>contentDigest(local):</strong> {ev.contentDigestLocal || '—'}</div>
          <div><strong>submitter:</strong> {ev.submitter}</div>
          <div><strong>tx:</strong> {ev.txHash?.slice(0,18)}...</div>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          <button className="btn-sm" onClick={() => onView && onView(ev)}>View JSON</button>
          {ev.cid && <a className="btn-sm outline" href={`https://ipfs.io/ipfs/${ev.cid}`} target="_blank" rel="noreferrer">IPFS</a>}
          {ev.fetched && <button className="btn-sm outline" onClick={() => { try { const blob = new Blob([JSON.stringify(ev.fetched,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`evidence-${ev.cidDigestEvent.slice(2,10)}.json`; a.click(); } catch(_){} }}>Export</button>}
        </div>
      </div>
    </div>
  );
}
