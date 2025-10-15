import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { computeMerkleRoot, verifyMerkleProof } from '../../utils/merkleHelper.js';
import EvidenceCard from './EvidenceCard.jsx';
import { getHelia } from '../../utils/heliaClient.js';
import EvidenceBadgeLegend from './EvidenceBadgeLegend.jsx';
import BatchDashboardAdvanced from '../Dashboard/BatchDashboardAdvanced.jsx';
import { subscribeToEvents } from '../../services/contractService.js';
// ...existing code...

function LiveEvents({ chainEvents }) {
  if (!chainEvents.length) return null;
  return (
    <div style={{ margin:'12px 0', padding:'8px', background:'#fffbe6', border:'1px solid #ffe58f', borderRadius:6 }}>
      <h5>Live Blockchain Events</h5>
      <ul style={{ fontSize:13, margin:0, paddingLeft:18 }}>
        {chainEvents.map((evt, idx) => (
          <li key={idx} style={evt.new ? { background:'#fff3cd', fontWeight:'bold', transition:'background 0.5s' } : {}}>
            <strong>{evt.type}</strong>: {JSON.stringify(evt.data)}
            <span style={{color:'#888', marginLeft:8}}>{evt.txHash ? `Tx: ${evt.txHash}` : ''}</span>
            {evt.new && <span style={{marginLeft:8, color:'#faad14'}}>● live</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function EvidenceList({ evidence, caseId, extraHeaderActions = null }) {
  // Helia client
  const [heliaClient, setHeliaClient] = useState(null);
  useEffect(() => {
    let mounted = true;
    getHelia().then(h => { if (mounted) setHeliaClient(h); });
    return () => { mounted = false; };
  }, []);

  // Component state
  const [showLegend, setShowLegend] = useState(false);
  const [verifyResult, setVerifyResult] = useState({});
  const [batchData, setBatchData] = useState(null);
  const [batchHistory, setBatchHistory] = useState([]);
  const [sortBy, setSortBy] = useState('createdAt');
  const [filterStatus, setFilterStatus] = useState('all');
  const [chainEvents, setChainEvents] = useState([]);
  const eventSubRef = useRef([]);

  // Subscribe to contract events
  useEffect(() => {
    if (!caseId || !evidence?.[0]?.contractAddress) return;
    const contractAddress = evidence[0].contractAddress;

    const disputeListener = subscribeToEvents(
      contractAddress,
// ...existing code...
      'DisputeReported',
      data => setChainEvents(evts => [{ type:'DisputeReported', data:data.args, txHash:data.event?.transactionHash, new:true }, ...evts.map(e=>({...e,new:false}))])
    );

    const resolutionListener = subscribeToEvents(
      contractAddress,
// ...existing code...
      'ResolutionApplied',
      data => setChainEvents(evts => [{ type:'ResolutionApplied', data:data.args, txHash:data.event?.transactionHash, new:true }, ...evts.map(e=>({...e,new:false}))])
    );

    eventSubRef.current = [disputeListener, resolutionListener];

    return () => eventSubRef.current.forEach(l => l?.removeAllListeners?.());
  }, [caseId, evidence]);

  // Auto-clear "new" highlight
  useEffect(() => {
    if (!chainEvents.some(e => e.new)) return;
    const timer = setTimeout(() => setChainEvents(evts => evts.map(e => ({ ...e, new:false }))), 5000);
    return () => clearTimeout(timer);
  }, [chainEvents]);

  // Fetch batch data and history
  useEffect(() => {
    if (!caseId) return;

    axios.get(`/api/batch/${caseId}`)
      .then(resp => {
        const batches = resp.data;
        setBatchData(batches?.length ? batches[batches.length-1] : null);
      })
      .catch(() => setBatchData(null));

    axios.get(`/api/dispute-history/${caseId}`)
      .then(resp => setBatchHistory(resp.data || []))
      .catch(() => setBatchHistory([]));
  }, [caseId, evidence]);

  // Merkle leaves, root, proofs
  const leaves = batchData?.evidenceItems?.map(ev => ev.leaf) || evidence?.map(ev => ev.leaf).filter(Boolean) || [];
  const root = batchData?.merkleRoot || (leaves.length ? computeMerkleRoot(leaves) : null);
  const proofs = Array.isArray(batchData?.proofs) ? batchData.proofs : [];

  // Filter & sort batch history
  const filteredSortedHistory = React.useMemo(() => {
    return batchHistory
      .filter(b => filterStatus==='all' || b.status===filterStatus)
      .sort((a,b) => {
        if (sortBy==='createdAt') return b.createdAt - a.createdAt;
        if (sortBy==='status') return String(a.status).localeCompare(String(b.status));
        if (sortBy==='evidenceCount') return b.evidenceCount - a.evidenceCount;
        return 0;
      });
  }, [batchHistory, sortBy, filterStatus]);

  return (
    <div className="section">
      <LiveEvents chainEvents={chainEvents} />
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center', gap:12, flexWrap:'wrap'}}>
        <h4 style={{margin:0}}>Evidence (on-chain indexed)</h4>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          {extraHeaderActions}
          <button onClick={()=>setShowLegend(true)} style={{padding:'4px 8px', fontSize:'12px', border:'1px solid #ccc', borderRadius:'4px', background:'#f9f9f9', cursor:'pointer'}} title="Show badge meanings">
            📖 Legend
          </button>
        </div>
      </div>

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
              const proof = proofs[idx] || [];
              const verify = verifyResult[idx];
              return (
                <tr key={ev.txHash + ev.cidDigestEvent} style={{borderTop:'1px solid #eee', background: verify ? (verify.valid ? '#e6ffe6' : '#ffe6e6') : undefined}}>
                  <td style={{fontFamily:'monospace',fontSize:12}}>{leaf}</td>
                  <td style={{fontFamily:'monospace',fontSize:12}}>{ev.cid}</td>
                  <td style={{fontSize:11}}>{proof.length ? proof.map((p,i)=>(<span key={i}><code>{p}</code><br/></span>)) : '—'}</td>
                  <td style={{fontFamily:'monospace',fontSize:12}}>{root}</td>
                  <td>
                    <button className="btn-xs" onClick={()=>{
                      const valid = verifyMerkleProof(leaf, proof, root, idx);
                      setVerifyResult(r => ({ ...r, [idx]: { valid, msg: valid ? 'Proof valid!' : 'Proof invalid!' } }));
                    }}>Verify Proof</button>
                    {verify && <span style={{marginLeft:8, color: verify.valid?'green':'crimson', fontWeight:'bold'}}>{verify.msg}</span>}
                    <EvidenceCard ev={ev} heliaClient={heliaClient} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

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
              {filteredSortedHistory.map((b, idx) => (
                <tr key={b.batchId || b.createdAt} style={{background:b.status==='pending'?'#fffbe6':b.status==='onchain_submitted'?'#e6f7ff':'#e6ffe6'}}>
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

      <EvidenceBadgeLegend isOpen={showLegend} onClose={()=>setShowLegend(false)} />
      {caseId && <BatchDashboardAdvanced caseId={caseId} />}
    </div>
  );
}
