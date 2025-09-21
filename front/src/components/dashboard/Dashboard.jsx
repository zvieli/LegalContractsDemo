import { useState, useEffect, useRef } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { ContractService } from '../../services/contractService';
import { getContractABI } from '../../utils/contracts';
import { useRentPaymentEvents } from '../../hooks/useContractEvents';
import ContractModal from '../ContractModal/ContractModal';
import * as ethers from 'ethers';
import mockContracts from '../../utils/contracts/MockContracts.json';
// AI service removed for now; use a deterministic local stub for UI testing
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
  const [modalReadOnly, setModalReadOnly] = useState(false);
  const [filterType, setFilterType] = useState('All');
  // AI features removed: simulation/stubs intentionally removed from UI

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

  const platformAdmin = import.meta.env?.VITE_PLATFORM_ADMIN || null;
  const isAdmin = platformAdmin && account && account.toLowerCase() === platformAdmin.toLowerCase();

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

      // Also listen for cancellation-related events on any newly created rent contract
      factoryContract.on('RentContractCreated', async (contractAddress) => {
        // Attach listeners for newly created contract so dashboard refreshes
        try {
          attachListenersToAddresses([String(contractAddress)]);
        } catch (e) {
          console.warn('Failed to attach per-contract cancellation listeners for created contract', e);
        }
      });

    } catch (error) {
      console.error('Error setting up event listeners:', error);
    }
  };

  // track per-contract listener instances for cleanup
  const contractListenersRef = useRef({});

  const attachListenersToAddresses = async (addresses = []) => {
    try {
      const rentAbi = getContractABI('TemplateRentContract');
      const provider = signer.provider || new ethers.JsonRpcProvider('http://127.0.0.1:8545');
      for (const addr of addresses) {
        const a = String(addr).toLowerCase?.() ?? addr;
        if (!a) continue;
        if (contractListenersRef.current[a]) continue; // already listening
        try {
          const inst = new ethers.Contract(a, rentAbi, provider);
          const refresh = () => loadUserContracts();
          inst.on('CancellationInitiated', refresh);
          inst.on('CancellationApproved', refresh);
          inst.on('CancellationFinalized', refresh);
          inst.on('ContractCancelled', refresh);
          contractListenersRef.current[a] = { inst, refresh };
        } catch (e) {
          console.warn('attachListenersToAddresses failed for', a, e);
        }
      }
    } catch (e) {
      console.warn('attachListenersToAddresses general failure', e);
    }
  };

  // cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        Object.values(contractListenersRef.current).forEach(({ inst, refresh }) => {
          try {
            inst.removeAllListeners('CancellationInitiated');
            inst.removeAllListeners('CancellationApproved');
            inst.removeAllListeners('CancellationFinalized');
            inst.removeAllListeners('ContractCancelled');
          } catch (_) {}
        });
        contractListenersRef.current = {};
      } catch (_) {}
    };
  }, []);

  // טעינת כל החוזים של המשתמש
  const loadUserContracts = async () => {
    try {
      setLoading(true);
      const contractService = new ContractService(signer, chainId);
      // If connected account is platform admin, show platform-wide counts (read-only)
      const platformAdmin = import.meta.env?.VITE_PLATFORM_ADMIN || null;
      const isAdmin = platformAdmin && account && account.toLowerCase() === platformAdmin.toLowerCase();

      if (isAdmin) {
        try {
          const factory = await contractService.getFactoryContract();
          // For admin/platform-wide read-only stats use the local JSON-RPC provider
          // to avoid differences between injected wallets and the local node.
          const localRpc = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
          const factoryAddr = factory.target || factory.address || null;
          const localFactory = factoryAddr ? new ethers.Contract(factoryAddr, getContractABI('ContractFactory'), localRpc) : null;
          // Debug: print provider/wallet network state and on-provider code at factory address
          try {
            const provider = contractService.signer.provider;
            const provNet = await provider.getNetwork().catch(() => null);
            const provChainId = provNet ? provNet.chainId : null;
            const factoryAddr = factory.target || factory.address || null;
            let onProviderCode = null;
            try {
              if (factoryAddr) onProviderCode = await provider.getCode(factoryAddr).catch(() => null);
            } catch (_) {}
            let injectedChain = null; let injectedAccounts = null;
            try {
              if (typeof window !== 'undefined' && window.ethereum && window.ethereum.request) {
                injectedAccounts = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => null);
                injectedChain = await window.ethereum.request({ method: 'eth_chainId' }).catch(() => null);
              }
            } catch (_) {}
            console.debug('Admin preflight:', { expectedChainId: chainId, providerChainId: provChainId, injectedChain, injectedAccounts, factoryAddr, onProviderCodeLength: onProviderCode ? onProviderCode.length/2 : null });
          } catch (pfErr) {
            console.warn('Admin preflight debug failed', pfErr);
          }
          const total = Number(localFactory ? await localFactory.getAllContractsCount() : 0);
          // Fetch a manageable page of contracts to compute active/pending/value
          const pageSize = Math.min(total, 50);
          let page = pageSize > 0 && localFactory ? await localFactory.getAllContractsPaged(0, pageSize) : [];
          // Normalize and dedupe the returned page (remove falsy entries, lowercase, unique)
          try {
            const normalized = (page || []).map(a => a && String(a).toLowerCase()).filter(Boolean);
            const unique = Array.from(new Set(normalized));
            page = unique;
          } catch (e) {
            console.warn('Normalization of contract page failed, using raw page', e);
          }

          console.debug('Admin branch: raw page addresses', page);
          const contractDetails = await Promise.all(page.map(async (addr) => {
            try {
              const rent = await contractService.getRentContractDetails(addr, { silent: true }).catch(() => null);
              if (rent) return { ...rent, type: 'Rental' };
              const nda = await contractService.getNDAContractDetails(addr, { silent: true }).catch(() => null);
              if (nda) return { ...nda, type: 'NDA' };
              return { address: addr, type: 'Unknown', status: 'Unknown', parties: [] };
            } catch (err) {
              return { address: addr, type: 'Unknown', status: 'Error', parties: [] };
            }
          }));

          // Compute stats from the sampled page (total uses full count)
          const activeContracts = contractDetails.filter(c => c.status === 'Active').length;
          const pendingContracts = contractDetails.filter(c => c.status === 'Pending').length;
          // sum amounts
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
            const fracLimited = fracTrimmed.slice(0, 6);
            return fracLimited ? `${intPart}.${fracLimited}` : intPart;
          })();

          console.debug('Admin branch: loaded contractDetails count', contractDetails.length, 'addresses:', contractDetails.map(c=>c.address));
          setContracts(contractDetails);
          setStats({ totalContracts: total, activeContracts, pendingContracts, totalValue });
        } catch (err) {
          console.error('Error loading platform contracts for admin:', err);
          setContracts([]);
          setStats({ totalContracts: 0, activeContracts: 0, pendingContracts: 0, totalValue: '0' });
        }

      } else {
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
                try {
                  const details = await contractService.getRentContractDetails(contractAddress, { silent: true });
                  return { ...details, type: 'Rental' };
                } catch {
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

          // compute stats
          const activeContracts = contractDetails.filter(c => c.status === 'Active').length;
          const pendingContracts = contractDetails.filter(c => c.status === 'Pending').length;
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
            const fracLimited = fracTrimmed.slice(0, 6);
            return fracLimited ? `${intPart}.${fracLimited}` : intPart;
          })();

          setStats({ totalContracts: contractDetails.length, activeContracts, pendingContracts, totalValue });

        } else {
          setContracts([]);
          setStats({ totalContracts: 0, activeContracts: 0, pendingContracts: 0, totalValue: '0' });
        }
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
    setModalReadOnly(true);
    setIsModalOpen(true);
  };

  const handleManageContract = (contractAddress) => {
    setSelectedContract(contractAddress);
    setModalReadOnly(false);
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
          {!isAdmin && (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* Contracts List */}
      <div className="contracts-section">
        <div className="section-header">
          <h3>Recent Contracts</h3>
          <div className="section-filters">
            <label className="label" style={{ marginRight: 4 }}>Filter:</label>
            <select className="filter-select" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="All">All</option>
              <option value="Rental">Rental</option>
              <option value="NDA">NDA</option>
            </select>
          </div>
        </div>

        <div className="contracts-list">
          {contracts.length === 0 ? (
            <div className="empty-state">
              <i className="fas fa-file-alt"></i>
              <h4>No contracts yet</h4>
              <p>Create your first contract to get started</p>
            </div>
          ) : (
            contracts
              .filter(c => filterType === 'All' ? true : c.type === filterType)
              .map((contract, index) => (
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
                  {!isAdmin && (
                    <button 
                      className="btn-sm primary"
                      onClick={() => handleManageContract(contract.address)}
                    >
                      <i className="fas fa-edit"></i> Manage
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* AI features removed: no external AI/Chainlink integrations in UI */}

      {/* Contract Modal */}
      <ContractModal
        contractAddress={selectedContract}
        isOpen={isModalOpen}
        onClose={closeModal}
        readOnly={modalReadOnly}
      />
    </div>
  );
}

export default Dashboard;
