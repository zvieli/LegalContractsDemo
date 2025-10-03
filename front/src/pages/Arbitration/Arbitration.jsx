import { useState, useEffect } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import * as ethers from 'ethers';
import { createContractInstanceAsync, getLocalDeploymentAddresses, getContractAddress } from '../../utils/contracts';
import './Arbitration.css';
import ContractModal from '../../components/ContractModal/ContractModal';
import ResolveModal from '../../components/ResolveModal/ResolveModal';
import { ContractService } from '../../services/contractService';

function Arbitration() {
  const { isConnected, account } = useEthers();
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  // incomingDispute removed: per-contract appeals are handled in the Contract modal/card

  const { signer, chainId } = useEthers();

  useEffect(() => {
    // Try to load on-chain cancellation-based disputes when connected as admin
    const load = async () => {
      setLoading(true);
      try {
        const platformAdmin = import.meta.env?.VITE_PLATFORM_ADMIN || null;
        const isAdmin = platformAdmin && account && account.toLowerCase() === platformAdmin.toLowerCase();
        if (!isAdmin) {
          setDisputes([]);
          setLoading(false);
          return;
        }
    // Use the local JSON-RPC provider for admin-wide reads
    const rpc = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    // load factory address from frontend artifact
  // Prefer to read local deployment metadata if available (via helper)
  const local = await getLocalDeploymentAddresses();
  const factoryAddr = local?.ContractFactory || (await getContractAddress(Number(31337), 'ContractFactory'));
        if (!factoryAddr) {
          setDisputes([]);
          setLoading(false);
          return;
        }
  // Use async contract factory which ensures ABIs are loaded from /utils/contracts
  const factory = await createContractInstanceAsync('ContractFactory', factoryAddr, rpc);
        const total = Number(await factory.getAllContractsCount());
        const pageSize = Math.min(total, 100);
        const page = pageSize > 0 ? await factory.getAllContractsPaged(0, pageSize) : [];
        const unique = Array.from(new Set((page || []).map(a => String(a).toLowerCase()).filter(Boolean)));
        const results = [];
        for (const addr of unique) {
          try {
            // create rent contract instance using ABI loader
            const inst = await createContractInstanceAsync('TemplateRentContract', addr, rpc);
            // best-effort read cancelRequested
            const code = await rpc.getCode(addr);
            if (!code || code === '0x') continue;
            const cancelRequested = await inst.cancelRequested().catch(() => false);
            if (cancelRequested) {
              const initiator = await inst.cancelInitiator().catch(() => null);
              const effectiveAt = await inst.cancelEffectiveAt().catch(() => 0n);
              results.push({ id: addr, contractAddress: addr, status: 'Pending', reason: 'CancellationRequested', initiator, effectiveAt: Number(effectiveAt || 0n) });
            }
          } catch (e) { /* ignore non-rent contracts */ }
        }
        setDisputes(results);
      } catch (e) {
        console.error('Error loading arbitration disputes:', e);
        setDisputes([]);
      } finally {
        setLoading(false);
      }
    };
    load();
    // Re-run when account changes (e.g., admin connects or switches)
  }, [account]);

  // no-op: we intentionally do not display sessionStorage incoming appeals on this page

  const refreshDisputes = async () => {
    setLoading(true);
    try {
      // reuse effect logic by invoking the same loader
      const platformAdmin = import.meta.env?.VITE_PLATFORM_ADMIN || null;
      const isAdmin = platformAdmin && account && account.toLowerCase() === platformAdmin.toLowerCase();
      if (!isAdmin) {
        setDisputes([]);
        setLoading(false);
        return;
      }
      const rpc = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
      // Prefer to read local deployment metadata if available via helper
  // getLocalDeploymentAddresses/getContractAddress from utils (ensure runtime artifacts are used)
  // (these helpers are async-safe)
  const local = await getLocalDeploymentAddresses();
  const factoryAddr = local?.ContractFactory || (await getContractAddress(Number(31337), 'ContractFactory'));
      if (!factoryAddr) {
        setDisputes([]);
        setLoading(false);
        return;
      }
  // Use static ABI helper from utils/contracts
  const factory = await createContractInstanceAsync('ContractFactory', factoryAddr, rpc);
      const total = Number(await factory.getAllContractsCount());
      const pageSize = Math.min(total, 100);
      const page = pageSize > 0 ? await factory.getAllContractsPaged(0, pageSize) : [];
      const unique = Array.from(new Set((page || []).map(a => String(a).toLowerCase()).filter(Boolean)));
      const results = [];
    for (const addr of unique) {
        try {
          const inst = await createContractInstanceAsync('TemplateRentContract', addr, rpc);
          const code = await rpc.getCode(addr);
          if (!code || code === '0x') continue;
          const cancelRequested = await inst.cancelRequested().catch(() => false);
          if (cancelRequested) {
            const initiator = await inst.cancelInitiator().catch(() => null);
            const effectiveAt = await inst.cancelEffectiveAt().catch(() => 0n);
            results.push({ id: addr, contractAddress: addr, status: 'Pending', reason: 'CancellationRequested', initiator, effectiveAt: Number(effectiveAt || 0n) });
          }
        } catch (e) { }
      }
      setDisputes(results);
    } catch (e) {
      console.error('Error refreshing arbitration disputes:', e);
      setDisputes([]);
    } finally {
      setLoading(false);
    }
  };

  // Modal state for viewing contract details
  const [selectedContract, setSelectedContract] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalReadOnly, setModalReadOnly] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // modal for prompting ArbitrationService address when contract doesn't have one
  const [isArbPromptOpen, setIsArbPromptOpen] = useState(false);
  const [arbPromptContract, setArbPromptContract] = useState(null);
  const [arbPromptInput, setArbPromptInput] = useState('');
  const [showArbDeployHint, setShowArbDeployHint] = useState(false);
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [resolveTargetContract, setResolveTargetContract] = useState(null);

  const handleView = (contractAddress) => {
    setSelectedContract(contractAddress);
    // Open in read-only mode for inspection
    setModalReadOnly(true);
    setIsModalOpen(true);
  };

  const handleResolve = (contractAddress) => {
    // Open the resolve modal so the arbitrator can fill decision + rationale
    setResolveTargetContract(contractAddress);
    setResolveModalOpen(true);
  };

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
    <div className="arbitration-page" data-testid="arbitration-page">
      <div className="page-header" data-testid="arbitration-header">
        <h1 data-testid="arbitration-title">Arbitration Center</h1>
        <p data-testid="arbitration-desc">Resolve disputes and manage contract conflicts</p>
      </div>

      <div className="arbitration-content" data-testid="arbitration-content">
        <div className="stats-cards" data-testid="arbitration-stats">
          <div className="stat-card" data-testid="arbitration-stats-total">
            <div className="stat-icon"><i className="fas fa-scale-balanced"></i></div>
            <div className="stat-content">
              <h3 data-testid="arbitration-stats-total-count">{disputes.length}</h3>
              <p>Total Disputes</p>
            </div>
          </div>
          <div className="stat-card" data-testid="arbitration-stats-pending">
            <div className="stat-icon"><i className="fas fa-clock"></i></div>
            <div className="stat-content">
              <h3 data-testid="arbitration-stats-pending-count">{disputes.filter(d => d.status === 'Pending').length}</h3>
              <p>Pending</p>
            </div>
          </div>
          <div className="stat-card" data-testid="arbitration-stats-resolved">
            <div className="stat-icon"><i className="fas fa-check-circle"></i></div>
            <div className="stat-content">
              <h3 data-testid="arbitration-stats-resolved-count">{disputes.filter(d => d.status === 'Resolved').length}</h3>
              <p>Resolved</p>
            </div>
          </div>
        </div>

        <div className="disputes-section" data-testid="arbitration-disputes-section">
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
            <h2 data-testid="arbitration-disputes-title">Active Disputes</h2>
            <div>
              {import.meta.env?.VITE_PLATFORM_ADMIN && account && account.toLowerCase() === import.meta.env.VITE_PLATFORM_ADMIN.toLowerCase() && (
                <button className="btn-sm primary" data-testid="arbitration-refresh-btn" onClick={refreshDisputes}>Refresh</button>
              )}
            </div>
          </div>
          {loading ? (
            <div className="loading-state" data-testid="arbitration-loading">
              <div className="loading-spinner"></div>
              <p>Loading disputes...</p>
            </div>
          ) : disputes.length === 0 ? (
            <div className="empty-state" data-testid="arbitration-empty">
              <i className="fas fa-peace"></i>
              <h3>No Active Disputes</h3>
              <p>All contracts are in good standing</p>
            </div>
          ) : (
            <div className="disputes-list" data-testid="arbitration-disputes-list">
              {disputes.map(dispute => (
                <div key={dispute.id} className="dispute-card" data-testid={`arbitration-dispute-card-${dispute.id}`}>
                  <div className="dispute-header" data-testid={`arbitration-dispute-header-${dispute.id}`}> 
                    <span className="dispute-id" data-testid={`arbitration-dispute-id-${dispute.id}`}>Dispute #{dispute.id}</span>
                    <span className={`status-badge ${dispute.status.toLowerCase()}`} data-testid={`arbitration-dispute-status-${dispute.id}`}>{dispute.status}</span>
                  </div>
                  <div className="dispute-details" data-testid={`arbitration-dispute-details-${dispute.id}`}> 
                    <p><strong>Contract:</strong> <span data-testid={`arbitration-dispute-contract-${dispute.id}`}>{dispute.contractAddress}</span></p>
                    <p><strong>Reason:</strong> <span data-testid={`arbitration-dispute-reason-${dispute.id}`}>{dispute.reason}</span></p>
                    <p><strong>Created:</strong> <span data-testid={`arbitration-dispute-created-${dispute.id}`}>{dispute.created}</span></p>
                  </div>
                  <div className="dispute-actions" data-testid={`arbitration-dispute-actions-${dispute.id}`}> 
                    <button className="btn-sm primary" data-testid={`arbitration-view-btn-${dispute.id}`} onClick={() => handleView(dispute.contractAddress)}>
                      <i className="fas fa-eye"></i> View Details
                    </button>
                    <button className="btn-sm secondary" data-testid={`arbitration-resolve-btn-${dispute.id}`} disabled={actionLoading} onClick={() => handleResolve(dispute.contractAddress)}>
                      <i className="fas fa-gavel"></i> Resolve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ContractModal contractAddress={selectedContract} isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setSelectedContract(null); refreshDisputes(); }} readOnly={modalReadOnly} />

      <ResolveModal
        isOpen={resolveModalOpen}
        onClose={() => { setResolveModalOpen(false); setResolveTargetContract(null); }}
        contractAddress={resolveTargetContract}
        signer={signer}
        chainId={chainId}
        onResolved={async () => { await refreshDisputes(); }}
      />
    </div>
  );
}

export default Arbitration;