import React, { useState, useEffect } from 'react';
import axios from 'axios';

import { BatchHelper } from '../../utils/batchHelper.js';
import { computeMerkleRoot, verifyMerkleProof } from '../../utils/merkleHelper.js';
import EvidenceCard from './EvidenceCard.jsx';
import EvidenceBadgeLegend from './EvidenceBadgeLegend.jsx';

// Added optional extraHeaderActions prop (React node) to inject custom controls (e.g., batch submit)
export default function EvidenceList({ evidence, caseId, activePrivateKey, activeAddress, extraHeaderActions = null }) {
  const [open, setOpen] = useState(null);
  const [showLegend, setShowLegend] = useState(false);
  const [batchData, setBatchData] = useState(null);
  const [verifyResult, setVerifyResult] = useState({});
  const [arbitrationResult, setArbitrationResult] = useState(null);
  const [arbitrateBusy, setArbitrateBusy] = useState(false);
  const [batchHistory, setBatchHistory] = useState([]);
  const [sortBy, setSortBy] = useState('createdAt');
  const [filterStatus, setFilterStatus] = useState('all');

  useEffect(() => {
    if (!caseId) return;
    axios.get(`/api/batch/${caseId}`)
      .then(resp => {
        const batches = resp.data;
        if (batches && batches.length) {
          setBatchData(batches[batches.length - 1]);
        } else {
          setBatchData(null);
        }
      })
      .catch(() => setBatchData(null));
    // Fetch batch history
    axios.get(`/api/dispute-history/${caseId}`)
      .then(resp => setBatchHistory(resp.data || []))
      .catch(() => setBatchHistory([]));
  }, [caseId, evidence]);

  const leaves = batchData?.evidenceItems?.map(ev => ev.leaf) || evidence?.map(ev => ev.leaf).filter(Boolean) || [];
  const root = batchData?.merkleRoot || (leaves.length ? computeMerkleRoot(leaves) : null);
  const proofs = batchData?.proofs || {};

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
          <strong>Merkle Root (from backend):</strong> <code>{root}</code>
          <button
            style={{marginLeft:16, padding:'4px 10px', fontSize:13, background:'#e0eaff', border:'1px solid #b3c6ff', borderRadius:4, cursor:'pointer'}}
            disabled={arbitrateBusy || !batchData}
            onClick={async () => {
              setArbitrateBusy(true);
              setArbitrationResult(null);
              try {
                const resp = await axios.post('/api/arbitrate-batch', {
                  caseId,
                  batchId: batchData?.timestamp || 0,
                  merkleRoot: batchData?.merkleRoot,
                  proofs: batchData?.proofs,
                  evidenceItems: batchData?.evidenceItems
                });
                setArbitrationResult(resp.data);
              } catch (err) {
                setArbitrationResult({ error: err?.response?.data?.error || err.message });
              } finally {
                setArbitrateBusy(false);
              }
            }}
          >Run Arbitration (LLM)</button>
          {/* Batch status indicator */}
          {batchData?.status && (
            <span style={{marginLeft:16, padding:'2px 10px', borderRadius:6, fontWeight:'bold', background: batchData.status==='pending'?'#fffbe6':batchData.status==='onchain_submitted'?'#e6f7ff':'#e6ffe6', color: batchData.status==='pending'?'#bfa700':batchData.status==='onchain_submitted'?'#0077b3':'#1a7f37', border:'1px solid #eee'}}>
              {batchData.status === 'pending' && '⏳ Pending'}
              {batchData.status === 'onchain_submitted' && '✅ On-chain'}
              {batchData.status === 'arbitrated' && '⚖️ Arbitrated'}
            </span>
          )}
        </div>
      )}
      {/* Batch history table with filtering/sorting */}
      {batchHistory.length > 0 && (
        <div style={{margin:'18px 0'}}>
          <h5>Batch History</h5>
          <div style={{display:'flex',gap:12,marginBottom:8}}>
            <label>Sort by:
              <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{marginLeft:6}}>
                <option value="createdAt">Date</option>
                <option value="status">Status</option>
                <option value="evidenceCount">Evidence Count</option>
              </select>
            </label>
            <label>Filter status:
              <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{marginLeft:6}}>
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="onchain_submitted">On-chain</option>
                <option value="arbitrated">Arbitrated</option>
              </select>
            </label>
            <span style={{marginLeft:'auto',fontSize:13}}>
              Stats: {batchHistory.length} batches | {batchHistory.filter(b=>b.status==='pending').length} pending | {batchHistory.filter(b=>b.status==='onchain_submitted').length} on-chain | {batchHistory.filter(b=>b.status==='arbitrated').length} arbitrated
            </span>
          </div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead>
              <tr style={{background:'#fafafa'}}>
                <th>Date</th>
                <th>Status</th>
                <th>Root</th>
                <th>TxHash</th>
                <th>Evidence Count</th>
              </tr>
            </thead>
            <tbody>
              {batchHistory
                .filter(b => filterStatus==='all' || b.status===filterStatus)
                .sort((a,b) => {
                  if (sortBy==='createdAt') return b.createdAt-a.createdAt;
                  if (sortBy==='status') return String(a.status).localeCompare(String(b.status));
                  if (sortBy==='evidenceCount') return b.evidenceCount-a.evidenceCount;
                  return 0;
                })
                .map((b,idx) => (
                  <tr key={b.batchId || b.createdAt} style={{background:b.status==='pending'?'#fffbe6':b.status==='onchain_submitted'?'#e6f7ff':b.status==='arbitrated'?'#e6ffe6':undefined}}>
                    <td>{new Date(b.createdAt).toLocaleString()}</td>
                    <td>{b.status==='pending'?'⏳ Pending':b.status==='onchain_submitted'?'✅ On-chain':'⚖️ Arbitrated'}</td>
                    <td style={{fontFamily:'monospace',fontSize:12}}><code>{b.merkleRoot}</code></td>
                    <td style={{fontFamily:'monospace',fontSize:12}}>{b.txHash ? <a href={`https://etherscan.io/tx/${b.txHash}`} target="_blank" rel="noopener noreferrer">{b.txHash.slice(0,10)}...</a> : '—'}</td>
                    <td>{b.evidenceCount}</td>
                  </tr>
                ))}
            </tbody>
          </table>
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
              const proof = proofs && proofs[idx] ? proofs[idx] : (leaves.length ? getProof(leaves, idx) : []);
              const verify = verifyResult[idx];
              return (
                <tr key={ev.txHash + ev.cidDigestEvent} style={{borderTop:'1px solid #eee', background: verify ? (verify.valid ? '#e6ffe6' : '#ffe6e6') : undefined}}>
                  <td style={{fontFamily:'monospace',fontSize:12}}>{leaf}</td>
                  <td style={{fontFamily:'monospace',fontSize:12}}>{ev.cid}</td>
                  <td style={{fontSize:11}}>{proof.length ? proof.map((p,i)=>(<span key={i}><code>{p}</code><br/></span>)) : '—'}</td>
                  <td style={{fontFamily:'monospace',fontSize:12}}>{root}</td>
                  <td>
                    <button className="btn-xs" onClick={() => {
                      const valid = verifyMerkleProof(leaf, proof, root, idx);
                      setVerifyResult(r => ({ ...r, [idx]: { valid, msg: valid ? 'Proof valid!' : 'Proof invalid!' } }));
                    }}>Verify Proof</button>
                    {verify && (
                      <span style={{marginLeft:8, color: verify.valid ? 'green' : 'crimson', fontWeight:'bold'}}>
                        {verify.msg}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {arbitrationResult && (
        <div style={{marginTop:16, padding:12, border:'1px solid #b3c6ff', borderRadius:6, background:'#f6f8ff'}}>
          <h5>Arbitration Result</h5>
          <pre style={{maxHeight:300,overflow:'auto', fontSize:13}}>{JSON.stringify(arbitrationResult, null, 2)}</pre>
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
