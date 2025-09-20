import { useState, useEffect } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import { ethers } from 'ethers';
import './Arbitration.css';
import ContractModal from '../../components/ContractModal/ContractModal';
import ResolveModal from '../../components/ResolveModal/ResolveModal';
import { ContractService } from '../../services/contractService';

function Arbitration() {
  const { isConnected, account } = useEthers();
  const platformAdmin = import.meta.env?.VITE_PLATFORM_ADMIN || null;
  const isAdmin = platformAdmin && account && account.toLowerCase() === platformAdmin.toLowerCase();
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
        const mod = await import('../../utils/contracts/ContractFactory.json');
        const local = mod?.default ?? mod;
        const factoryAddr = local?.contracts?.ContractFactory;
        if (!factoryAddr) {
          setDisputes([]);
          setLoading(false);
          return;
        }
        const factoryAbiMod = await import('../../utils/contracts/ContractFactoryABI.json');
        const factoryAbi = factoryAbiMod?.default?.abi ?? factoryAbiMod?.abi ?? factoryAbiMod;
        const factory = new ethers.Contract(factoryAddr, factoryAbi, rpc);
        const total = Number(await factory.getAllContractsCount());
        const pageSize = Math.min(total, 100);
        const page = pageSize > 0 ? await factory.getAllContractsPaged(0, pageSize) : [];
        const unique = Array.from(new Set((page || []).map(a => String(a).toLowerCase()).filter(Boolean)));
        const results = [];
        const rentAbiMod = await import('../../utils/contracts/TemplateRentContractABI.json');
        const rentAbi = rentAbiMod?.default?.abi ?? rentAbiMod?.abi ?? rentAbiMod;
        for (const addr of unique) {
          try {
            const inst = new ethers.Contract(addr, rentAbi, rpc);
            // best-effort read cancelRequested
            const code = await rpc.getCode(addr);
            if (!code || code === '0x') continue;
            const cancelRequested = await inst.cancelRequested().catch(() => false);
              if (cancelRequested) {
              const initiator = await inst.cancelInitiator().catch(() => null);
              const effectiveAt = await inst.cancelEffectiveAt().catch(() => 0n);
              // If a local arbitration resolution exists for this contract, show it as Resolved
              try {
                const rk = `arbResolution:${String(addr).toLowerCase()}`;
                const rjs = localStorage.getItem(rk);
                if (rjs) {
                  const r = JSON.parse(rjs);
                  results.push({ id: addr, contractAddress: addr, status: 'Resolved', reason: 'CancellationRequested', initiator, effectiveAt: Number(effectiveAt || 0n), decision: r.decision, appliedAmount: r.appliedAmount, resolvedAt: r.timestamp });
                } else {
                  // Best-effort: if the contract is already inactive on-chain, treat as resolved
                  try {
                    const active = await inst.active().catch(() => null);
                    if (active === false) {
                      results.push({ id: addr, contractAddress: addr, status: 'Resolved', reason: 'CancellationFinalizedOnChain', initiator, effectiveAt: Number(effectiveAt || 0n), decision: 'onchain', appliedAmount: null, resolvedAt: Date.now() });
                    } else {
                      results.push({ id: addr, contractAddress: addr, status: 'Pending', reason: 'CancellationRequested', initiator, effectiveAt: Number(effectiveAt || 0n) });
                    }
                  } catch (innerErr) {
                    results.push({ id: addr, contractAddress: addr, status: 'Pending', reason: 'CancellationRequested', initiator, effectiveAt: Number(effectiveAt || 0n) });
                  }
                }
              } catch (e) {
                results.push({ id: addr, contractAddress: addr, status: 'Pending', reason: 'CancellationRequested', initiator, effectiveAt: Number(effectiveAt || 0n) });
              }
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

  // Refresh disputes when an arbitration resolution occurs elsewhere in the app
  useEffect(() => {
    const handler = (ev) => {
      try {
        // If a resolution payload is provided, we can refresh
        refreshDisputes();
      } catch (_) {}
    };
    window.addEventListener('arb:resolved', handler);
    return () => window.removeEventListener('arb:resolved', handler);
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
      const mod = await import('../../utils/contracts/ContractFactory.json');
      const local = mod?.default ?? mod;
      const factoryAddr = local?.contracts?.ContractFactory;
      if (!factoryAddr) {
        setDisputes([]);
        setLoading(false);
        return;
      }
      const factoryAbiMod = await import('../../utils/contracts/ContractFactoryABI.json');
      const factoryAbi = factoryAbiMod?.default?.abi ?? factoryAbiMod?.abi ?? factoryAbiMod;
      const factory = new ethers.Contract(factoryAddr, factoryAbi, rpc);
      const total = Number(await factory.getAllContractsCount());
      const pageSize = Math.min(total, 100);
      const page = pageSize > 0 ? await factory.getAllContractsPaged(0, pageSize) : [];
      const unique = Array.from(new Set((page || []).map(a => String(a).toLowerCase()).filter(Boolean)));
      const results = [];
      const rentAbiMod = await import('../../utils/contracts/TemplateRentContractABI.json');
      const rentAbi = rentAbiMod?.default?.abi ?? rentAbiMod?.abi ?? rentAbiMod;
      for (const addr of unique) {
        try {
          const inst = new ethers.Contract(addr, rentAbi, rpc);
          const code = await rpc.getCode(addr);
          if (!code || code === '0x') continue;
          const cancelRequested = await inst.cancelRequested().catch(() => false);
          if (cancelRequested) {
            const initiator = await inst.cancelInitiator().catch(() => null);
            const effectiveAt = await inst.cancelEffectiveAt().catch(() => 0n);
            try {
              const rk = `arbResolution:${String(addr).toLowerCase()}`;
              const rjs = localStorage.getItem(rk);
              if (rjs) {
                const r = JSON.parse(rjs);
                results.push({ id: addr, contractAddress: addr, status: 'Resolved', reason: 'CancellationRequested', initiator, effectiveAt: Number(effectiveAt || 0n), decision: r.decision, appliedAmount: r.appliedAmount, resolvedAt: r.timestamp });
              } else {
                // Best-effort: if the contract is already inactive on-chain, treat as resolved
                try {
                  const active = await inst.active().catch(() => null);
                  if (active === false) {
                    results.push({ id: addr, contractAddress: addr, status: 'Resolved', reason: 'CancellationFinalizedOnChain', initiator, effectiveAt: Number(effectiveAt || 0n), decision: 'onchain', appliedAmount: null, resolvedAt: Date.now() });
                  } else {
                    results.push({ id: addr, contractAddress: addr, status: 'Pending', reason: 'CancellationRequested', initiator, effectiveAt: Number(effectiveAt || 0n) });
                  }
                } catch (innerErr) {
                  results.push({ id: addr, contractAddress: addr, status: 'Pending', reason: 'CancellationRequested', initiator, effectiveAt: Number(effectiveAt || 0n) });
                }
              }
            } catch (e) {
              results.push({ id: addr, contractAddress: addr, status: 'Pending', reason: 'CancellationRequested', initiator, effectiveAt: Number(effectiveAt || 0n) });
            }
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

  // Only the configured platform admin may access the Arbitration center.
  if (!isAdmin) {
    return (
      <div className="arbitration-page">
        <div className="not-authorized">
          <i className="fas fa-user-shield"></i>
          <h2>Not authorized</h2>
          <p>This page is restricted to platform administrators.</p>
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
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
              <h2>Active Disputes</h2>
              <div>
                {import.meta.env?.VITE_PLATFORM_ADMIN && account && account.toLowerCase() === import.meta.env.VITE_PLATFORM_ADMIN.toLowerCase() && (
                  <button className="btn-sm primary" onClick={refreshDisputes}>Refresh</button>
                )}
              </div>
            </div>
          
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
                    <button className="btn-sm primary" onClick={() => handleView(dispute.contractAddress)}>
                      <i className="fas fa-eye"></i> View Details
                    </button>
                    <button className="btn-sm secondary" disabled={actionLoading} onClick={() => handleResolve(dispute.contractAddress)}>
                      <i className="fas fa-gavel"></i> Resolve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* If no global ArbitrationService is configured, the Resolve action will show a deploy hint. */}

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