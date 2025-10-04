import React, { useState } from 'react';
import EvidenceCard from './EvidenceCard.jsx';
import EvidenceBadgeLegend from './EvidenceBadgeLegend.jsx';

export default function EvidenceList({ evidence, activePrivateKey, activeAddress }) {
  const [open, setOpen] = useState(null);
  const [showLegend, setShowLegend] = useState(false);
  
  return (
    <div className="section">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <h4>Evidence (on-chain indexed)</h4>
        <button 
          onClick={() => setShowLegend(true)}
          style={{
            padding:'4px 8px',
            fontSize:'12px',
            border:'1px solid #ccc',
            borderRadius:'4px',
            background:'#f9f9f9',
            cursor:'pointer'
          }}
          title="Show badge meanings"
        >
          📖 Legend
        </button>
      </div>
      {!evidence || evidence.length === 0 ? <div className="muted">No evidence</div> : (
        <div className="transactions-list">
          {evidence.map(ev => (
            <EvidenceCard key={ev.txHash + ev.cidDigestEvent} ev={ev} onView={(e)=> setOpen(e)} activePrivateKey={activePrivateKey} activeAddress={activeAddress} />
          ))}
        </div>
      )}
      {open && (
        <div style={{marginTop:12,padding:10,border:'1px solid #eee',borderRadius:6}}>
          <h5>Evidence JSON</h5>
          <pre style={{maxHeight:300,overflow:'auto'}}>{JSON.stringify(open.fetched,null,2)}</pre>
          <button className="btn-sm" onClick={()=> setOpen(null)}>Close</button>
        </div>
      )}
      <EvidenceBadgeLegend isOpen={showLegend} onClose={() => setShowLegend(false)} />
    </div>
  );
}
