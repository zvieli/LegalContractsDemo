import { useState, useEffect } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { ContractService } from '../../services/contractService';
import { useRentPaymentEvents } from '../../hooks/useContractEvents';
import ContractModal from '../ContractModal/ContractModal';
import { ethers } from 'ethers';
import './Dashboard.css';

function Dashboard() {
  const { account, signer, isConnected, chainId } = useEthers();
  const { addNotification } = useNotifications();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalContracts: 0,
    activeContracts: 0,
    pendingContracts: 0,
  totalValue: '0'
  });
  const [selectedContract, setSelectedContract] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // התראות בזמן אמת על תשלומי שכירות
  useRentPaymentEvents(selectedContract, (payer, amount, timestamp) => {
    addNotification({
      type: 'success',
      title: 'Rent Payment Received',
      message: `${ethers.formatEther(amount)} ETH received from ${payer.slice(0, 8)}...`,
      persistent: false
    });
  });

  useEffect(() => {
    if (isConnected && account && signer && chainId) {
      loadUserContracts();
      setupEventListeners();
    }
  }, [isConnected, account, signer, chainId]);

  // האזנה לאירועי יצירת חוזים
  const setupEventListeners = async () => {
    try {
      const contractService = new ContractService(signer, chainId);
      const factoryContract = await contractService.getFactoryContract();

  factoryContract.on('RentContractCreated', (contractAddress, landlord, tenant) => {
        addNotification({
          type: 'success',
          title: 'New Rental Contract Created',
          message: `Contract created with ${tenant.slice(0, 8)}...`,
          persistent: true
        });
        loadUserContracts();
      });

      factoryContract.on('NDACreated', (contractAddress, partyA, partyB) => {
        addNotification({
          type: 'success',
          title: 'New NDA Agreement Created',
          message: `NDA created with ${partyB.slice(0, 8)}...`,
          persistent: true
        });
        loadUserContracts();
      });

    } catch (error) {
      console.error('Error setting up event listeners:', error);
    }
  };

  // טעינת כל החוזים של המשתמש
  const loadUserContracts = async () => {
    try {
      setLoading(true);
      const contractService = new ContractService(signer, chainId);
  // 1) Contracts I created
  const created = await contractService.getUserContracts(account);
  // 2) Contracts where I participate (as landlord/tenant/party)
  const participating = await contractService.getContractsByParticipant(account);
  // Union & dedupe
  const userContracts = Array.from(new Set([...(created || []), ...(participating || [])]));

      if (userContracts && userContracts.length > 0) {
        const contractDetails = await Promise.all(
          userContracts.map(async (contractAddress) => {
            try {
              // קודם ננסה כחוזה שכירות
              try {
                const details = await contractService.getRentContractDetails(contractAddress, { silent: true });
                return { ...details, type: 'Rental' };
              } catch {
                // אם נכשל – ננסה כ־NDA
                const details = await contractService.getNDAContractDetails(contractAddress, { silent: true });
                return { ...details, type: 'NDA' };
              }
            } catch (error) {
              console.error('Error loading contract details:', error);
              return {
                address: contractAddress,
                type: 'Unknown',
                status: 'Error',
                parties: [],
                created: 'N/A',
                amount: 'N/A',
                isActive: false
              };
            }
          })
        );

        setContracts(contractDetails);

        // חישוב סטטיסטיקות
        const activeContracts = contractDetails.filter(c => c.status === 'Active').length;
        const pendingContracts = contractDetails.filter(c => c.status === 'Pending').length;
        // סכימה מדויקת ב-wei כדי להימנע משגיאות צפות (0.21000000000000002)
        const totalWei = contractDetails.reduce((acc, contract) => {
          try {
            const amt = String(contract.amount || '0');
            return acc + ethers.parseEther(amt);
          } catch {
            return acc;
          }
        }, 0n);
        const totalEthStr = ethers.formatEther(totalWei);
        const totalValue = (() => {
          const [intPart, fracPartRaw = ''] = totalEthStr.split('.');
          const fracTrimmed = fracPartRaw.replace(/0+$/, '');
          const fracLimited = fracTrimmed.slice(0, 6); // מציג עד 6 ספרות אחרי הנקודה
          return fracLimited ? `${intPart}.${fracLimited}` : intPart;
        })();

        setStats({
          totalContracts: contractDetails.length,
          activeContracts,
          pendingContracts,
          totalValue
        });

      } else {
        setContracts([]);
        setStats({
          totalContracts: 0,
          activeContracts: 0,
          pendingContracts: 0,
          totalValue: '0'
        });
      }

    } catch (error) {
      console.error('Error loading contracts:', error);
      setContracts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleViewContract = (contractAddress) => {
    setSelectedContract(contractAddress);
    setIsModalOpen(true);
  };

  const handleManageContract = (contractAddress) => {
    setSelectedContract(contractAddress);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedContract(null);
    loadUserContracts(); // ריענון אחרי סגירת מודאל
  };

  const createNewContract = (type) => {
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

          <div className="stat-card">
            <div className="stat-icon">
              <i className="fas fa-coins"></i>
            </div>
            <div className="stat-content">
              <h3>{stats.totalValue} ETH</h3>
              <p>Total Value</p>
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
                      {contract.parties[0]?.slice(0, 8)}... ↔ {contract.parties[1]?.slice(0, 8)}...
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
                  <button 
                    className="btn-sm outline"
                    onClick={() => handleViewContract(contract.address)}
                  >
                    <i className="fas fa-eye"></i> View
                  </button>
                  <button 
                    className="btn-sm primary"
                    onClick={() => handleManageContract(contract.address)}
                  >
                    <i className="fas fa-edit"></i> Manage
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Contract Modal */}
      <ContractModal
        contractAddress={selectedContract}
        isOpen={isModalOpen}
        onClose={closeModal}
      />
    </div>
  );
}

export default Dashboard;
