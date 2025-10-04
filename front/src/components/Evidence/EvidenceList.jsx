import React, { useState } from 'react';
import EvidenceCard from './EvidenceCard.jsx';

export default function EvidenceList({ evidence, activePrivateKey, activeAddress }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="section">
      <h4>Evidence (on-chain indexed)</h4>
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
    </div>
  );
}
