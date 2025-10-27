import { useState, useEffect, useRef, useCallback } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { ContractService } from '../../services/contractService';
import { createContractInstanceAsync } from '../../utils/contracts';
import { useRentPaymentEvents } from '../../hooks/useContractEvents';
import ContractModal from '../ContractModal/ContractModal';
import * as ethers from 'ethers';
import { formatEtherSafe } from '../../utils/eth';
import './Dashboard.css';

function Dashboard() {
  const { account, signer, isConnected, chainId, provider } = useEthers();
  const { addNotification } = useNotifications();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, _setStats] = useState({
    totalContracts: 0,
    activeContracts: 0,
    pendingContracts: 0,
  totalValue: '0'
  });
  const [selectedContract, setSelectedContract] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalReadOnly, setModalReadOnly] = useState(false);
  const [filterType, setFilterType] = useState('All');
  const [isAdmin, setIsAdmin] = useState(false);
  // AI features removed: simulation/stubs intentionally removed from UI

  // תראות בזמן אמת על תשלומי שכירות
  useRentPaymentEvents(selectedContract, (payer, amount, timestamp) => {
    void timestamp;
    addNotification({
      type: 'success',
      title: 'Rent Payment Received',
      message: `${ethers.formatEther(amount)} ETH received from ${payer.slice(0, 8)}...`,
      persistent: false
    });
  });

  const loadUserContracts = useCallback(async () => {
    try {
      setLoading(true);
  const contractService = new ContractService(provider, signer, chainId);
  // If connected account is on-chain admin, show platform-wide counts (read-only)
  if (isAdmin) {
        try {
          const factory = await contractService.getFactoryContract();
          const all = await contractService.getAllContractsForFactory(factory).catch(() => []);
          setContracts(all || []);
        } catch (_) { void _; setContracts([]); }
  } else {
        try {
          // Correct method name on ContractService: getUserContracts (contracts created by user)
          const my = await contractService.getUserContracts(account).catch(() => []);
          let combined = my || [];
          try {
            // Also find any contracts where the user is a participant (tenant/party),
            // not just the creator. getContractsByParticipant returns addresses, so
            // enrich them into the same object shape as getUserContracts.
            const participantAddrs = await contractService.getContractsByParticipant(account).catch(() => []);
            const existing = new Set((combined || []).map(c => String(c.address || c).toLowerCase()));
            const toEnrich = (participantAddrs || []).filter(a => !existing.has(String(a).toLowerCase()));
            const extra = await Promise.all(toEnrich.map(async (addr) => {
              try {
                const rent = await contractService.getEnhancedRentContractDetails(addr).catch(() => null);
                if (rent) return { ...rent, address: addr };
              } catch (_) { void _; }
              try {
                const nda = await contractService.getNDAContractDetails(addr).catch(() => null);
                if (nda) return { ...nda, address: addr };
              } catch (_) { void _; }
              return { address: addr, type: 'Unknown' };
            }));
            combined = [...combined, ...extra.filter(Boolean)];
          } catch (e) { void e; }
          setContracts(combined || []);
        } catch (_) { void _; setContracts([]); }
  }
    } catch (e) { void e;
      console.warn('loadUserContracts failed', e);
      setContracts([]);
    } finally {
      setLoading(false);
    }
  }, [provider, signer, chainId, account, isAdmin]);

  // track per-contract listener instances for cleanup
  const contractListenersRef = useRef({});

  const attachListenersToAddresses = useCallback(async (addresses = []) => {
    try {
      // Prefer a read-only provider for listeners (direct localhost RPC) when available
      const _cs_for_listen = new ContractService(provider, signer, chainId);
      const readProviderForAttach = _cs_for_listen._providerForRead() || provider;
      // Always use a read-capable provider for event listeners
      for (const addr of addresses) {
        const a = String(addr).toLowerCase?.() ?? addr;
        if (!a) continue;
        if (contractListenersRef.current[a]) continue; // already listening
        try {
          const inst = await createContractInstanceAsync('EnhancedRentContract', a, readProviderForAttach);
          const refresh = () => loadUserContracts();
          inst.on('CancellationInitiated', refresh);
          inst.on('CancellationApproved', refresh);
          inst.on('CancellationFinalized', refresh);
          inst.on('ContractCancelled', refresh);
          contractListenersRef.current[a] = { inst, refresh };
        } catch (e) { void e;
          console.warn('attachListenersToAddresses failed for', a, e);
        }
      }
    } catch (e) { void e;
        console.warn('attachListenersToAddresses general failure', e);
      }
    }, [provider, loadUserContracts]);

  const setupEventListeners = useCallback(async () => {
    try {
      const contractService = new ContractService(provider, signer, chainId);
      const factoryContractBase = await contractService.getFactoryContract();
      // Prefer a read provider (local JsonRpc) for event listeners so local events are visible
      const readProvider = contractService._providerForRead() || provider;
      const factoryContract = await createContractInstanceAsync('ContractFactory', factoryContractBase.address || factoryContractBase.target || factoryContractBase, readProvider);

      factoryContract.on('EnhancedRentContractCreated', (contractAddress, landlord, tenant) => {
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
      factoryContract.on('EnhancedRentContractCreated', async (contractAddress) => {
        try {
          attachListenersToAddresses([String(contractAddress)]);
        } catch (e) { void e;
          console.warn('Failed to attach per-contract cancellation listeners for created contract', e);
        }
      });
    } catch (error) {
      console.error('Error setting up event listeners:', error);
    }
  }, [provider, signer, chainId, addNotification, loadUserContracts, attachListenersToAddresses]);
  // include attachListenersToAddresses which is declared later but referenced above

  useEffect(() => {
    if (isConnected && account && signer && chainId) {
      loadUserContracts();
      setupEventListeners();
    }
  }, [isConnected, account, signer, chainId, loadUserContracts, setupEventListeners, attachListenersToAddresses]);

  // On-chain admin detection: fetch factoryOwner from ContractFactory
  useEffect(() => {
    async function checkAdmin() {
      try {
        if (!account || !signer || !chainId || !provider) { setIsAdmin(false); return; }
        const contractService = new ContractService(provider, signer, chainId);
        const factory = await contractService.getFactoryContract();
        let owner = null;
        try { owner = await factory.factoryOwner(); } catch (_){ void _; owner = null; }
        console.debug('Admin check: account', account, 'factoryOwner', owner);
        if (owner && account.toLowerCase() === owner.toLowerCase()) setIsAdmin(true);
        else setIsAdmin(false);
      } catch (e) { void e; console.warn('Admin check failed', e); setIsAdmin(false); }
    }
    checkAdmin();
  }, [account, signer, chainId, provider]);

  // setupEventListeners handled via stable useCallback declared earlier

  

  // cleanup on unmount
  useEffect(() => {
    return () => {
      try {
  Object.values(contractListenersRef.current).forEach(({ inst }) => {
          try {
            // Always use provider for event listeners
            inst.removeAllListeners('CancellationInitiated');
            inst.removeAllListeners('CancellationApproved');
            inst.removeAllListeners('CancellationFinalized');
            inst.removeAllListeners('ContractCancelled');
          } catch (_) { void _;}
        });
        contractListenersRef.current = {};
      } catch (_) { void _;}
    };
  }, []);

  // Recompute dashboard stats when contracts change
  useEffect(() => {
    try {
      const total = Array.isArray(contracts) ? contracts.length : 0;
      const active = Array.isArray(contracts) ? contracts.filter(c => (c.status === 'Active' || c.isActive)).length : 0;
      const pending = Array.isArray(contracts) ? contracts.filter(c => (c.status === 'Pending' || (c.cancellation && c.cancellation.cancelRequested))).length : 0;

      let totalVal = 0;
      if (Array.isArray(contracts)) {
        for (const c of contracts) {
          try {
            if (typeof c.amount === 'number') {
              totalVal += c.amount;
            } else if (typeof c.amount === 'string') {
              const parsed = parseFloat(String(c.amount).replace(/,/g, ''));
              if (!isNaN(parsed)) totalVal += parsed;
            } else if (typeof c.amount === 'bigint') {
              totalVal += Number(ethers.formatEther(c.amount));
            } else if (c.amount && typeof c.amount === 'object' && c.amount._isBigNumber) {
              totalVal += Number(ethers.formatEther(c.amount));
            }
          } catch (e) { /* ignore per-item parse errors */ }
        }
      }

      const totalValueStr = (Math.round((totalVal + Number.EPSILON) * 1e6) / 1e6).toString();
      _setStats({ totalContracts: total, activeContracts: active, pendingContracts: pending, totalValue: totalValueStr });
    } catch (e) { void e; }
  }, [contracts]);

  // loadUserContracts handled via stable useCallback declared earlier

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
                  <div className={`contract-status ${(contract.status || '').toLowerCase()}`}>
                    {contract.status}
                  </div>
                </div>

                <div className="contract-details">
                  <div className="contract-parties">
                    <span className="label">Parties:</span>
                    <span className="value">
                      {contract.parties?.[0]?.slice(0, 8) || ''}... ↔ {contract.parties?.[1]?.slice(0, 8) || ''}...
                    </span>
                  </div>

                  <div className="contract-info">
                    <div className="info-item">
                      <span className="label">Amount:</span>
                      <span className="value">{(() => {
                        try {
                          const amt = contract.amount;
                          // If already looks like a decimal string (formatted), show as-is.
                          if (typeof amt === 'string' && amt.includes('.')) return amt + ' ETH';
                          return formatEtherSafe(amt) + ' ETH';
                        } catch (e) { void e;
                          return String(contract.amount);
                        }
                      })()}</span>
                    </div>
                    <div className="info-item">
                      <span className="label">Created:</span>
                      <span className="value" style={{direction:'ltr', display:'inline-block'}}>{(() => {
                        try {
                          const v = contract.created || Date.now();
                          // If it's already a number timestamp
                          if (typeof v === 'number' || (!isNaN(Number(v)) && String(v).length > 9)) {
                            return new Date(Number(v)).toLocaleString();
                          }
                          // if it's a formatted string, show as-is, else try Date parse
                          const parsed = Date.parse(String(v));
                          if (!isNaN(parsed)) return new Date(parsed).toLocaleString();
                          return String(v) || new Date().toLocaleString();
                        } catch (e) { void e;
                          return String(contract.created || new Date().toLocaleString());
                        }
                      })()}</span>
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
