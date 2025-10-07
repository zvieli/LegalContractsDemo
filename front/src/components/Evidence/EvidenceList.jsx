import React, { useState } from 'react';

import { BatchHelper } from '../../utils/batchHelper.js';
import { computeMerkleRoot, verifyMerkleProof } from '../../utils/merkleHelper.js';
import EvidenceCard from './EvidenceCard.jsx';
import EvidenceBadgeLegend from './EvidenceBadgeLegend.jsx';

// Added optional extraHeaderActions prop (React node) to inject custom controls (e.g., batch submit)
export default function EvidenceList({ evidence, activePrivateKey, activeAddress, extraHeaderActions = null }) {
  const [open, setOpen] = useState(null);
  const [showLegend, setShowLegend] = useState(false);
  
  // Collect all leafs for batch (assume evidence[] contains leaf property)
  const leaves = evidence?.map(ev => ev.leaf).filter(Boolean) || [];
  // Compute Merkle root for batch
  const root = leaves.length ? computeMerkleRoot(leaves) : null;

  return (
    <div className="section">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center', gap:12, flexWrap:'wrap'}}>
        <h4 style={{margin:0}}>Evidence (on-chain indexed)</h4>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          {extraHeaderActions}
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
      </div>
      {root && (
        <div style={{margin:'12px 0', fontSize:13}}>
          <strong>Merkle Root:</strong> <code>{root}</code>
        </div>
      )}
      {!evidence || evidence.length === 0 ? <div className="muted">No evidence</div> : (
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13,marginBottom:16}}>
          <thead>
            <tr style={{background:'#fafafa'}}>
              <th>Leaf</th>
              <th>CID</th>
              <th>Proof</th>
              <th>Root</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {evidence.map((ev, idx) => {
              const leaf = ev.leaf;
              const proof = leaves.length ? getProof(leaves, idx) : [];
              return (
                <tr key={ev.txHash + ev.cidDigestEvent} style={{borderTop:'1px solid #eee'}}>
                  <td style={{fontFamily:'monospace',fontSize:12}}>{leaf}</td>
                  <td style={{fontFamily:'monospace',fontSize:12}}>{ev.cid}</td>
                  <td style={{fontSize:11}}>{proof.length ? proof.map((p,i)=>(<span key={i}><code>{p}</code><br/></span>)) : '—'}</td>
                  <td style={{fontFamily:'monospace',fontSize:12}}>{root}</td>
                  <td>
                    <button className="btn-xs" onClick={() => {
                      const valid = verifyMerkleProof(leaf, proof, root, idx);
                      alert(valid ? 'Proof valid!' : 'Proof invalid!');
                    }}>Verify Proof</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
