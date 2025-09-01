import { useState, useEffect } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import './Arbitration.css';

function Arbitration() {
  const { isConnected, account } = useEthers();
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // TODO: Load real disputes from blockchain
    setTimeout(() => {
      setDisputes([
        {
          id: 1,
          contractAddress: '0x1234...5678',
          parties: ['0xYourAddress', '0xCounterparty'],
          reason: 'Late payment',
          status: 'Pending',
          created: '2024-01-15'
        },
        {
          id: 2, 
          contractAddress: '0xabcd...efgh',
          parties: ['0xYourAddress', '0xClient'],
          reason: 'Confidentiality breach',
          status: 'Resolved',
          created: '2024-01-10'
        }
      ]);
      setLoading(false);
    }, 1000);
  }, []);

  if (!isConnected) {
    return (
      <div className="arbitration-page">
        <div className="not-connected">
          <i className="fas fa-wallet"></i>
          <h2>Connect Your Wallet</h2>
          <p>Please connect your wallet to access arbitration</p>
        </div>
      </div>
    );
  }

  return (
    <div className="arbitration-page">
      <div className="page-header">
        <h1>Arbitration Center</h1>
        <p>Resolve disputes and manage contract conflicts</p>
      </div>

      <div className="arbitration-content">
        <div className="stats-cards">
          <div className="stat-card">
            <div className="stat-icon">
              <i className="fas fa-scale-balanced"></i>
            </div>
            <div className="stat-content">
              <h3>{disputes.length}</h3>
              <p>Total Disputes</p>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">
              <i className="fas fa-clock"></i>
            </div>
            <div className="stat-content">
              <h3>{disputes.filter(d => d.status === 'Pending').length}</h3>
              <p>Pending</p>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">
              <i className="fas fa-check-circle"></i>
            </div>
            <div className="stat-content">
              <h3>{disputes.filter(d => d.status === 'Resolved').length}</h3>
              <p>Resolved</p>
            </div>
          </div>
        </div>

        <div className="disputes-section">
          <h2>Active Disputes</h2>
          
          {loading ? (
            <div className="loading-state">
              <div className="loading-spinner"></div>
              <p>Loading disputes...</p>
            </div>
          ) : disputes.length === 0 ? (
            <div className="empty-state">
              <i className="fas fa-peace"></i>
              <h3>No Active Disputes</h3>
              <p>All contracts are in good standing</p>
            </div>
          ) : (
            <div className="disputes-list">
              {disputes.map(dispute => (
                <div key={dispute.id} className="dispute-card">
                  <div className="dispute-header">
                    <span className="dispute-id">Dispute #{dispute.id}</span>
                    <span className={`status-badge ${dispute.status.toLowerCase()}`}>
                      {dispute.status}
                    </span>
                  </div>
                  
                  <div className="dispute-details">
                    <p><strong>Contract:</strong> {dispute.contractAddress}</p>
                    <p><strong>Reason:</strong> {dispute.reason}</p>
                    <p><strong>Created:</strong> {dispute.created}</p>
                  </div>
                  
                  <div className="dispute-actions">
                    <button className="btn-sm primary">
                      <i className="fas fa-eye"></i> View Details
                    </button>
                    <button className="btn-sm secondary">
                      <i className="fas fa-gavel"></i> Resolve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Arbitration;