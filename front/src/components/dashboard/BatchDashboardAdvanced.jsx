import React, { useEffect, useState } from 'react';
import axios from 'axios';
// import { Pie, Bar } from 'react-chartjs-2';
// import 'chart.js/auto';

export default function BatchDashboardAdvanced({ caseId }) {
  const [batchHistory, setBatchHistory] = useState([]);
  const [arbitrationStats, setArbitrationStats] = useState({});
  const [categoryStats, setCategoryStats] = useState({});
  const [filter, setFilter] = useState({ status: 'all', category: 'all', search: '' });

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const resp = await axios.get(`/api/dispute-history/${caseId}`);
        setBatchHistory(resp.data || []);
        // Stats by status
        const stats = { pending: 0, onchain_submitted: 0, arbitrated: 0 };
        const catStats = {};
        (resp.data || []).forEach(b => {
          if (stats[b.status] !== undefined) stats[b.status]++;
          if (b.category) catStats[b.category] = (catStats[b.category]||0)+1;
        });
        setArbitrationStats(stats);
        setCategoryStats(catStats);
      } catch (_){ void _;}
    };
    fetchHistory();
  }, [caseId]);

  const pieData = {
    labels: ['Pending', 'On-chain', 'Arbitrated'],
    datasets: [{
      data: [arbitrationStats.pending, arbitrationStats.onchain_submitted, arbitrationStats.arbitrated],
      backgroundColor: ['#fffbe6','#e6f7ff','#e6ffe6'],
      borderColor: ['#bfa700','#0077b3','#1a7f37'],
      borderWidth: 2
    }]
  };
  const barData = {
    labels: Object.keys(categoryStats),
    datasets: [{
      label: 'Disputes by Category',
      data: Object.values(categoryStats),
      backgroundColor: '#e6f7ff',
      borderColor: '#0077b3',
      borderWidth: 2
    }]
  };
  void pieData; void barData;

  const filtered = batchHistory.filter(b =>
    (filter.status==='all'||b.status===filter.status) &&
    (filter.category==='all'||b.category===filter.category) &&
    (!filter.search||String(b.merkleRoot).includes(filter.search)||String(b.txHash).includes(filter.search))
  );

  return (
    <div style={{margin:'24px 0',padding:20,border:'1px solid #eee',borderRadius:10,background:'#fafcff'}}>
      <h3>Batch Status Dashboard (Advanced)</h3>
      <div style={{display:'flex',gap:32,flexWrap:'wrap',justifyContent:'center'}}>
        <div style={{maxWidth:320}}>
          <h4>Status Distribution</h4>
          <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
            {Object.entries(categoryStats).map(([key, value]) => (
              <div key={key} style={{display: 'flex', justifyContent: 'space-between'}}>
                <span>{key}:</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>
        <div style={{maxWidth:420}}>
          <h4>Arbitration Stats</h4>
          <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
            {Object.entries(arbitrationStats).map(([key, value]) => (
              <div key={key} style={{display: 'flex', justifyContent: 'space-between'}}>
                <span>{key}:</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{marginTop:18,display:'flex',gap:16,flexWrap:'wrap'}}>
        <label>Status:
          <select value={filter.status} onChange={e=>setFilter(f=>({...f,status:e.target.value}))} style={{marginLeft:6}}>
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="onchain_submitted">On-chain</option>
            <option value="arbitrated">Arbitrated</option>
          </select>
        </label>
        <label>Category:
          <select value={filter.category} onChange={e=>setFilter(f=>({...f,category:e.target.value}))} style={{marginLeft:6}}>
            <option value="all">All</option>
            {Object.keys(categoryStats).map(cat=>(<option key={cat} value={cat}>{cat}</option>))}
          </select>
        </label>
        <label>Search:
          <input value={filter.search} onChange={e=>setFilter(f=>({...f,search:e.target.value}))} style={{marginLeft:6}} placeholder="root/txHash" />
        </label>
      </div>
      <div style={{marginTop:24}}>
        <h5>Filtered Batches</h5>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead>
            <tr style={{background:'#fafafa'}}>
              <th>Date</th>
              <th>Status</th>
              <th>Category</th>
              <th>Decision</th>
              <th>TxHash</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(b=>(
              <tr key={b.batchId || b.createdAt}>
                <td>{new Date(b.createdAt).toLocaleString()}</td>
                <td>{b.status==='pending'?'⏳ Pending':b.status==='onchain_submitted'?'✅ On-chain':'⚖️ Arbitrated'}</td>
                <td>{b.category||'—'}</td>
                <td>{b.decision||'—'}</td>
                <td>{b.txHash ? <a href={`https://etherscan.io/tx/${b.txHash}`} target="_blank" rel="noopener noreferrer">{b.txHash.slice(0,10)}...</a> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
