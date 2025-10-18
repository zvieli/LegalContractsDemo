import React, { useEffect, useState } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import * as Contracts from '../../utils/contracts';
import { ContractServiceV7 } from '../../services/contractServiceV7';
import * as ethers from 'ethers';
import { createContractInstanceAsync } from '../../utils/contracts';
import './MyContracts.css';
import ContractModal from '../ContractModal/ContractModal';
import { IN_E2E } from '../../utils/env';

export default function MyContracts() {
  const { signer, chainId, account, isConnected, contracts: globalContracts } = useEthers();
  const [contracts, setContracts] = useState([]); // raw addresses
  const [details, setDetails] = useState({}); // address -> detail object
  const [loading, setLoading] = useState(false);
   const [v7Loading, setV7Loading] = useState(false);
  const [selectedContract, setSelectedContract] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalReadOnly, setModalReadOnly] = useState(false);
  const [v7ArbitrationRequests, setV7ArbitrationRequests] = useState([]); // V7 arbitration requests
   const [v7Service, setV7Service] = useState(null); // V7 service instance

  useEffect(() => {
    // (see below for the correct useEffect implementation)
    // No cleanup needed; removed undefined mounted variable
    return undefined;
  }, [isConnected, signer, chainId, account, globalContracts]);


    // Load V7 arbitration requests
    useEffect(() => {
      const loadV7ArbitrationRequests = async () => {
          if (!signer || !v7Service) {
            setV7ArbitrationRequests([]);
            return;
          }

          setV7Loading(true);
        try {
          const { safeGetAddress } = await import('../../utils/signer.js');
          const contractService = new ContractService(provider, signer, chainId);
          const readProvider = contractService._providerForRead() || provider || null;
          const addr = await safeGetAddress(signer, readProvider || contractService);
          const requests = await v7Service.getArbitrationRequestsByUser(addr);
          setV7ArbitrationRequests(requests || []);
        } catch (error) {
          console.error('Error loading V7 arbitration requests:', error);
          setV7ArbitrationRequests([]);
          } finally {
            setV7Loading(false);
        }
      };

      loadV7ArbitrationRequests();
    }, [signer, v7Service]);

  // If user isn't connected, show the previous placeholder UX (static preview)
  // On-chain admin detection: fetch factoryOwner from ContractFactory
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    async function checkAdmin() {
      try {
        if (!account || !signer || !chainId) { setIsAdmin(false); return; }
        const contractService = new Contracts.ContractService(signer, chainId);
        const factory = await contractService.getFactoryContract();
        let owner = null;
        try { owner = await factory.factoryOwner(); } catch { owner = null; }
        if (owner && account.toLowerCase() === owner.toLowerCase()) setIsAdmin(true);
        else setIsAdmin(false);
      } catch (e) { setIsAdmin(false); }
    }
    checkAdmin();
  }, [account, signer, chainId]);

  // If user isn't connected, show placeholder. If user is admin, don't show fabricated samples.
  if (!isConnected) {
    return (
      <div className="my-contracts placeholder">
        <h3>My Contracts</h3>
        <div className="placeholder-card">
          <div style={{ padding: 20 }}>
            <p className="connect-hint">Connect your wallet to view and manage all your contracts</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="my-contracts">
  <h3>{isAdmin ? 'Platform Contracts (Admin View)' : 'My Contracts'}</h3>
      {loading && <p>Loading...</p>}
      {!loading && contracts.length === 0 && (
        <div className="empty-state">
          {isAdmin ? (
            <>
              <p>No contracts currently flagged for this admin view.</p>
              <div className="empty-actions">
                <button className="btn-primary" onClick={() => { window.location.href = '/dashboard'; }}>View All Contracts</button>
              </div>
            </>
          ) : (
            <>
              <p>No contracts found</p>
              <div className="empty-actions">
                <button className="btn-primary" onClick={() => { window.location.href = '/create'; }}>Create Contract</button>
              </div>
            </>
          )}
        </div>
      )}
      <ul className="contract-list">
        {contracts.map((addr) => {
          const d = details[addr];
          // helper to open modal with validation. Open the modal on the next tick
          // after setting selectedContract to avoid a race where the modal
          // mounts before the prop is applied (which caused null contractAddress
          // in E2E flows).
          const openContractModal = (a, readOnly) => {
            try {
              if (!a || !/^0x[0-9a-fA-F]{40}$/.test(String(a))) {
                console.error('Attempted to open modal with invalid contract address', { a });
                // Provide an obvious UI-visible alert in dev/E2E so failures surface early
                try { alert(`Invalid contract address: ${String(a)}`); } catch (e) {}
                return;
              }
              setSelectedContract(a);
              // Expose last selected contract for E2E helpers to wait for DOM rendering
              try { if (typeof window !== 'undefined') window.__PLAYWRIGHT_LAST_SELECTED_CONTRACT = String(a); } catch (_) {}
              setModalReadOnly(!!readOnly);
              // schedule opening the modal slightly later so React applies the
              // selectedContract state first (avoids batching race in tests)
              setTimeout(() => setIsModalOpen(true), 20);
            } catch (e) {
              console.error('openContractModal failed', e, { a, readOnly });
            }
          };
          if (!d) {
            return (
              <li key={addr} className="contract-item">
                <div className="contract-info">
                  <h4>Unknown • <span className="address">{addr}</span></h4>
                </div>
                <div className="contract-actions">
                  <button className="btn-sm outline" onClick={() => { openContractModal(addr, true); }}>
                    <i className="fas fa-eye"></i> View
                  </button>
                  <button className="btn-sm primary" onClick={() => { openContractModal(addr, false); }}>
                    <i className="fas fa-edit"></i> Manage
                  </button>
                </div>
              </li>
            );
          }

          // Render Rent contract details
          if (d.type === 'Rental') {
            return (
              <li key={addr} className="contract-item">
                <div className="contract-info">
                  <h4>Rental • <span className="address">{d.address}</span></h4>
                  <p>Landlord: <span className="address">{d.landlord}</span></p>
                  <p>Tenant: <span className="address">{d.tenant}</span></p>
                  <p>Amount: {d.amount} ETH</p>
                  <p>Status: {d.status}</p>
                </div>
                <div className="contract-actions">
                  <button className="btn-sm outline" onClick={() => { openContractModal(d.address, true); }}>
                    <i className="fas fa-eye"></i> View
                  </button>
                  <button className="btn-sm primary" onClick={() => { openContractModal(d.address, false); }}>
                    <i className="fas fa-edit"></i> Manage
                  </button>
                  <button 
                    className="btn-sm" 
                    data-testid="button-request-arbitration"
                    style={{
                      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      color: 'white',
                      border: 'none',
                      marginLeft: '0.5rem'
                    }}
                    onClick={() => {
                      // Navigate to arbitration page with this contract address
                      window.location.href = `/arbitration-v7?contract=${d.address}`;
                    }}
                  >
                    <i className="fas fa-gavel"></i> בקש בוררות
                  </button>
                </div>
              </li>
            );
          }

          // Render NDA details
          if (d.type === 'NDA') {
            return (
              <li key={addr} className="contract-item">
                <div className="contract-info">
                  <h4>NDA • <span className="address">{d.address}</span></h4>
                  <p>Party A: <span className="address">{d.partyA}</span></p>
                  <p>Party B: <span className="address">{d.partyB}</span></p>
                  <p>Expiry: {d.expiryDate}</p>
                  <p>Min deposit: {d.minDeposit} ETH</p>
                  <p>Fully signed: {d.fullySigned ? 'Yes' : 'No'}</p>
                </div>
                <div className="contract-actions">
                  <button className="btn-sm outline" onClick={() => { openContractModal(d.address, true); }}>
                    <i className="fas fa-eye"></i> View
                  </button>
                  <button className="btn-sm primary" onClick={() => { openContractModal(d.address, false); }}>
                    <i className="fas fa-edit"></i> Manage
                  </button>
                </div>
              </li>
            );
          }

          // Fallback Unknown
          return (
            <li key={addr} className="contract-item">
              <div className="contract-info">
                <h4>{d.type} • <span className="address">{d.address}</span></h4>
              </div>
                <div className="contract-actions">
                    <button className="btn-sm outline" onClick={() => { openContractModal(d.address, true); }}>
                    <i className="fas fa-eye"></i> View
                  </button>
                    <button className="btn-sm primary" onClick={() => { openContractModal(d.address, false); }}>
                    <i className="fas fa-edit"></i> Manage
                  </button>
                </div>
            </li>
          );
        })}
      </ul>
      
      {/* V7 Arbitration Requests Section */}
      {(v7Loading || v7ArbitrationRequests.length > 0) && (
        <div className="v7-arbitration-section" data-testid="v7-arbitration-section">
          <h3 style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            marginTop: '2rem',
            marginBottom: '1rem'
          }}>
            V7 Arbitration Requests (AI)
          </h3>
          {v7Loading ? (
            <div style={{ 
              textAlign: 'center', 
              padding: '2rem',
              background: 'linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%)',
              borderRadius: '12px',
              border: '1px solid rgba(102, 126, 234, 0.3)'
            }} data-testid="v7-arbitration-loading">
              <i className="fas fa-spinner fa-spin" style={{ fontSize: '1.5rem', color: '#667eea' }}></i>
              <p style={{ marginTop: '1rem', color: '#667eea' }}>Loading V7 arbitration requests...</p>
            </div>
          ) : v7ArbitrationRequests.length === 0 ? (
            <div style={{ 
              textAlign: 'center', 
              padding: '2rem',
              background: 'linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%)',
              borderRadius: '12px',
              border: '1px solid rgba(102, 126, 234, 0.3)',
              color: '#666'
            }} data-testid="v7-arbitration-empty">
              <i className="fas fa-robot" style={{ fontSize: '2rem', color: '#667eea', marginBottom: '1rem' }}></i>
              <p>No active V7 arbitration requests</p>
              <p style={{ fontSize: '0.9rem' }}>When you create a new AI arbitration request, it will appear here</p>
            </div>
          ) : (
          <ul className="arbitration-list" style={{ listStyle: 'none', padding: 0 }} data-testid="v7-arbitration-list">
            {v7ArbitrationRequests.map((request, index) => (
              <li key={index} className="arbitration-item" data-testid={`v7-arbitration-item-${index}`}
                style={{
                  background: 'linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%)',
                  border: '1px solid rgba(102, 126, 234, 0.3)',
                  borderRadius: '12px',
                  padding: '1.5rem',
                  marginBottom: '1rem',
                  transition: 'all 0.3s ease'
                }}>
                <div className="arbitration-info">
                  <h4 style={{ 
                    color: '#667eea',
                    marginBottom: '0.5rem',
                    fontSize: '1.1rem'
                  }} data-testid="v7-arbitration-title">
                    Arbitration Request #{request.id || index + 1}
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                    <div>
                      <strong>Contract Address:</strong><br />
                      <code style={{ 
                        background: 'rgba(102, 126, 234, 0.1)', 
                        padding: '0.25rem 0.5rem', 
                        borderRadius: '4px',
                        fontSize: '0.9rem'
                      }} data-testid="v7-arbitration-contract-address">
                        {request.contractAddress}
                      </code>
                    </div>
                    <div>
                      <strong>Bond Amount:</strong><br />
                      <span style={{ color: '#667eea', fontWeight: 'bold' }} data-testid="v7-arbitration-bond-amount">
                        {request.bondAmount} DAI
                      </span>
                    </div>
                  </div>
                  <div style={{ marginBottom: '1rem' }}>
                    <strong>Status:</strong>
                    <span style={{
                      marginRight: '0.5rem',
                      padding: '0.25rem 0.75rem',
                      borderRadius: '20px',
                      fontSize: '0.9rem',
                      fontWeight: 'bold',
                      background: request.status === 'pending' ? 'linear-gradient(135deg, #ffeaa7 0%, #fab1a0 100%)' :
                                 request.status === 'bond_confirmed' ? 'linear-gradient(135deg, #74b9ff 0%, #0984e3 100%)' :
                                 request.status === 'ai_decided' ? 'linear-gradient(135deg, #00b894 0%, #00a085 100%)' :
                                 'linear-gradient(135deg, #636e72 0%, #2d3436 100%)',
                      color: 'white'
                    }} data-testid="v7-arbitration-status">
                      {request.status === 'pending' && 'Submitted: Awaiting Bond Confirmation'}
                      {request.status === 'bond_confirmed' && 'Bond Confirmed: Awaiting Oracle Response'}
                      {request.status === 'ai_decided' && 'AI Decision Received'}
                      {request.status === 'completed' && 'Process Completed'}
                    </span>
                  </div>
                  {/* Arbitration Verdict */}
                  {request.finalVerdict && (
                    <div style={{ marginBottom: '1rem' }} data-testid="v7-arbitration-verdict">
                      <strong>Arbitration Verdict (AI):</strong>
                      <span style={{ marginRight: '0.5rem', fontWeight: 'bold', color: '#764ba2' }}>
                        {request.finalVerdict === 'PARTY_A_WINS' && 'Party A Wins'}
                        {request.finalVerdict === 'PARTY_B_WINS' && 'Party B Wins'}
                        {request.finalVerdict === 'DRAW' && 'Draw'}
                        {!['PARTY_A_WINS','PARTY_B_WINS','DRAW'].includes(request.finalVerdict) && request.finalVerdict}
                      </span>
                    </div>
                  )}
                  {/* Reimbursement Amount */}
                  {typeof request.reimbursementAmountDai !== 'undefined' && (
                    <div style={{ marginBottom: '1rem' }} data-testid="v7-arbitration-reimbursement">
                      <strong>AI-Determined Reimbursement:</strong>
                      <span style={{ marginRight: '0.5rem', fontWeight: 'bold', color: '#00b894' }}>
                        {request.reimbursementAmountDai} DAI
                      </span>
                    </div>
                  )}
                  {/* Rationale Summary */}
                  {request.rationaleSummary && (
                    <div style={{ marginBottom: '1rem' }} data-testid="v7-arbitration-rationale">
                      <strong>AI Rationale:</strong>
                      <div style={{ background: 'rgba(118,75,162,0.07)', padding: '0.5rem 1rem', borderRadius: '6px', color: '#333', fontSize: '0.95rem' }}>
                        {request.rationaleSummary}
                      </div>
                    </div>
                  )}
                  {request.evidenceHash && (
                    <div style={{ marginBottom: '1rem' }} data-testid="v7-arbitration-evidence-hash">
                      <strong>Evidence Hash:</strong><br />
                      <code style={{ 
                        background: 'rgba(102, 126, 234, 0.1)', 
                        padding: '0.25rem 0.5rem', 
                        borderRadius: '4px',
                        fontSize: '0.8rem'
                      }}>
                        {request.evidenceHash}
                      </code>
                    </div>
                  )}
                  {request.timestamp && (
                    <div style={{ fontSize: '0.9rem', color: '#666' }} data-testid="v7-arbitration-timestamp">
                      <strong>Submitted At:</strong> {new Date(request.timestamp * 1000).toLocaleString('en-US')}
                    </div>
                  )}
                </div>
                <div className="arbitration-actions" style={{ marginTop: '1rem' }}>
                  <button 
                    className="btn-sm outline" 
                    style={{
                      borderColor: '#667eea',
                      color: '#667eea',
                      marginLeft: '0.5rem'
                    }}
                    data-testid={`v7-arbitration-view-details-${index}`}
                    onClick={() => {
                      // TODO: Add view details functionality
                      console.log('View V7 arbitration details:', request);
                    }}
                  >
                    <i className="fas fa-eye"></i> View Details
                  </button>
                  {request.status === 'ai_decided' && (
                    <button 
                      className="btn-sm primary" 
                      style={{
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        border: 'none',
                        marginLeft: '0.5rem'
                      }}
                      data-testid={`v7-arbitration-view-ai-decision-${index}`}
                      onClick={() => {
                        // TODO: Add view AI decision functionality
                        console.log('View AI decision:', request);
                      }}
                    >
                      <i className="fas fa-robot"></i> View AI Decision
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
            )}
        </div>
      )}

      <ContractModal contractAddress={selectedContract} isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setSelectedContract(null); }} readOnly={modalReadOnly} />
    </div>
  );
}
