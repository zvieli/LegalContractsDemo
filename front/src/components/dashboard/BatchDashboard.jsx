import React, { useEffect, useState } from 'react';
import axios from 'axios';
// import { Pie } from 'react-chartjs-2';
// import 'chart.js/auto';

export default function BatchDashboard({ caseId }) {
  const [batchHistory, setBatchHistory] = useState([]);
  const [arbitrationStats, setArbitrationStats] = useState({});
  const [polling, _setPolling] = useState(true);
  const [notification, setNotification] = useState(null);

  useEffect(() => {
    let interval;
    const fetchHistory = async () => {
      try {
        const resp = await axios.get(`/api/dispute-history/${caseId}`);
        setBatchHistory(resp.data || []);
        // Stats
        const stats = {
          pending: 0,
          onchain_submitted: 0,
          arbitrated: 0
        };
        (resp.data || []).forEach(b => {
          if (stats[b.status] !== undefined) stats[b.status]++;
        });
        setArbitrationStats(stats);
        // Notification for status change
        if (polling && resp.data && resp.data.length) {
          const last = resp.data[resp.data.length-1];
          if (last.status === 'arbitrated') {
            setNotification(`Batch ${last.batchId || last.createdAt} arbitrated: ${last.decision || 'See details'}`);
            setTimeout(()=>setNotification(null), 6000);
          }
        }
      } catch (_){ void _;}
    };
    fetchHistory();
    if (polling) {
      interval = setInterval(fetchHistory, 5000);
    }
    return () => interval && clearInterval(interval);
  }, [caseId, polling]);

  const pieData = {
    labels: ['Pending', 'On-chain', 'Arbitrated'],
    datasets: [{
      data: [arbitrationStats.pending, arbitrationStats.onchain_submitted, arbitrationStats.arbitrated],
      backgroundColor: ['#fffbe6','#e6f7ff','#e6ffe6'],
      borderColor: ['#bfa700','#0077b3','#1a7f37'],
      borderWidth: 2
    }]
  };
  void pieData;

  return (
    <div style={{margin:'24px 0',padding:20,border:'1px solid #eee',borderRadius:10,background:'#fafcff'}}>
      <h3>Batch Status Dashboard</h3>
      <div style={{maxWidth:320,margin:'0 auto'}}>
        {/* <Pie data={pieData} /> */}
        <div style={{textAlign:'center', padding:'40px', border:'1px dashed #ccc', borderRadius:'8px'}}>
          <p>Chart visualization temporarily disabled</p>
          <p style={{fontSize:'12px', color:'#666'}}>Installing chart dependencies...</p>
        </div>
      </div>
      <div style={{marginTop:18}}>
        <strong>Stats:</strong> {batchHistory.length} batches | {arbitrationStats.pending} pending | {arbitrationStats.onchain_submitted} on-chain | {arbitrationStats.arbitrated} arbitrated
      </div>
      {notification && (
        <div style={{marginTop:16,padding:10,background:'#e6ffe6',border:'1px solid #1a7f37',borderRadius:6,color:'#1a7f37',fontWeight:'bold'}}>
          {notification}
        </div>
      )}
      <div style={{marginTop:24}}>
        <h5>Recent Arbitrations</h5>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead>
            <tr style={{background:'#fafafa'}}>
              <th>Date</th>
              <th>Status</th>
              <th>Decision</th>
              <th>TxHash</th>
            </tr>
          </thead>
          <tbody>
            {batchHistory.filter(b=>b.status==='arbitrated').slice(-5).reverse().map(b=>(
              <tr key={b.batchId || b.createdAt}>
                <td>{new Date(b.createdAt).toLocaleString()}</td>
                <td>⚖️ Arbitrated</td>
                <td>{b.decision || '—'}</td>
                <td>{b.txHash ? <a href={`https://etherscan.io/tx/${b.txHash}`} target="_blank" rel="noopener noreferrer">{b.txHash.slice(0,10)}...</a> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
