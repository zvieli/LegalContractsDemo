import { useState, useEffect } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import { createContractInstance } from '../../utils/contracts';
import './Dashboard.css';

function Dashboard() {
  const { account, signer, isConnected } = useEthers();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalContracts: 0,
    activeContracts: 0,
    pendingContracts: 0
  });

  useEffect(() => {
    if (isConnected && account) {
      loadUserContracts();
    }
  }, [isConnected, account]);

  const loadUserContracts = async () => {
    try {
      setLoading(true);
      
      // כאן נטען את החוזים מהפרוטוקול האמיתי
      // כרגע - נתונים mock עבור הדגמה
      const mockContracts = [
        {
          address: '0x1234...5678',
          type: 'Rental',
          status: 'Active',
          parties: ['0xYourAddress', '0xTenantAddress'],
          created: '2024-01-15',
          amount: '1.5 ETH'
        },
        {
          address: '0xabcd...efgh',
          type: 'NDA',
          status: 'Pending',
          parties: ['0xYourAddress', '0xClientAddress'],
          created: '2024-01-10',
          amount: '0.1 ETH'
        },
        {
          address: '0xwxyz...1234',
          type: 'Rental',
          status: 'Completed',
          parties: ['0xYourAddress', '0xOldTenantAddress'],
          created: '2023-12-05',
          amount: '2.0 ETH'
        }
      ];

      setContracts(mockContracts);
      setStats({
        totalContracts: mockContracts.length,
        activeContracts: mockContracts.filter(c => c.status === 'Active').length,
        pendingContracts: mockContracts.filter(c => c.status === 'Pending').length
      });
      
    } catch (error) {
      console.error('Error loading contracts:', error);
    } finally {
      setLoading(false);
    }
  };

  const createNewContract = (type) => {
    // נווט לעמוד יצירת החוזה המתאים
    window.location.href = type === 'rent' ? '/create-rent' : '/create-nda';
  };

  if (!isConnected) {
    return (
      <div className="dashboard-not-connected">
        <div className="not-connected-content">
          <i className="fas fa-wallet"></i>
          <h3>Connect Your Wallet</h3>
          <p>Please connect your wallet to view and manage your contracts</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="loading-spinner"></div>
        <p>Loading your contracts...</p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      {/* Header עם סטטיסטיקות */}
      <div className="dashboard-header">
        <div className="dashboard-title">
          <h2>My Contracts</h2>
          <p>Manage all your smart contracts in one place</p>
        </div>
        
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">
              <i className="fas fa-file-contract"></i>
            </div>
            <div className="stat-content">
              <h3>{stats.totalContracts}</h3>
              <p>Total Contracts</p>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">
              <i className="fas fa-check-circle"></i>
            </div>
            <div className="stat-content">
              <h3>{stats.activeContracts}</h3>
              <p>Active</p>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">
              <i className="fas fa-clock"></i>
            </div>
            <div className="stat-content">
              <h3>{stats.pendingContracts}</h3>
              <p>Pending</p>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="dashboard-actions">
        <h3>Create New Contract</h3>
        <div className="action-buttons">
          <button 
            className="action-btn primary"
            onClick={() => createNewContract('rent')}
          >
            <i className="fas fa-home"></i>
            New Rental Agreement
          </button>
          
          <button 
            className="action-btn secondary"
            onClick={() => createNewContract('nda')}
          >
            <i className="fas fa-file-signature"></i>
            New NDA Agreement
          </button>
        </div>
      </div>

      {/* Contracts List */}
      <div className="contracts-section">
        <div className="section-header">
          <h3>Recent Contracts</h3>
          <button className="view-all-btn">
            View All <i className="fas fa-arrow-right"></i>
          </button>
        </div>

        <div className="contracts-list">
          {contracts.length === 0 ? (
            <div className="empty-state">
              <i className="fas fa-file-alt"></i>
              <h4>No contracts yet</h4>
              <p>Create your first contract to get started</p>
            </div>
          ) : (
            contracts.map((contract, index) => (
              <div key={index} className="contract-card">
                <div className="contract-header">
                  <div className="contract-type">
                    <i className={`fas ${contract.type === 'Rental' ? 'fa-home' : 'fa-file-signature'}`}></i>
                    <span>{contract.type}</span>
                  </div>
                  <div className={`contract-status ${contract.status.toLowerCase()}`}>
                    {contract.status}
                  </div>
                </div>
                
                <div className="contract-details">
                  <div className="contract-parties">
                    <span className="label">Parties:</span>
                    <span className="value">
                      {contract.parties[0].slice(0, 8)}... ↔ {contract.parties[1].slice(0, 8)}...
                    </span>
                  </div>
                  
                  <div className="contract-info">
                    <div className="info-item">
                      <span className="label">Amount:</span>
                      <span className="value">{contract.amount}</span>
                    </div>
                    <div className="info-item">
                      <span className="label">Created:</span>
                      <span className="value">{contract.created}</span>
                    </div>
                  </div>
                </div>
                
                <div className="contract-actions">
                  <button className="btn-sm outline">
                    <i className="fas fa-eye"></i> View
                  </button>
                  <button className="btn-sm primary">
                    <i className="fas fa-edit"></i> Manage
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;