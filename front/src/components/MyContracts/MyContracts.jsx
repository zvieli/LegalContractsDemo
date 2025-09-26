import React, { useEffect, useState } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import { ContractService } from '../../services/contractService';
import * as ethers from 'ethers';
import { createContractInstanceAsync } from '../../utils/contracts';
import './MyContracts.css';
import ContractModal from '../ContractModal/ContractModal';

export default function MyContracts() {
  const { signer, chainId, account, isConnected } = useEthers();
  const [contracts, setContracts] = useState([]); // raw addresses
  const [details, setDetails] = useState({}); // address -> detail object
  const [loading, setLoading] = useState(false);
  const [selectedContract, setSelectedContract] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalReadOnly, setModalReadOnly] = useState(false);

  useEffect(() => {
    if (!isConnected) return;
    let mounted = true;
    const svc = new ContractService(signer, chainId);

    (async () => {
      try {
        setLoading(true);
        const addr = account;
        const factory = await svc.getFactoryContract();

        // If platform admin, fetch a page of ALL contracts using a local JSON-RPC provider
        const platformAdmin = import.meta.env?.VITE_PLATFORM_ADMIN || null;
        const isAdmin = platformAdmin && account && account.toLowerCase() === platformAdmin.toLowerCase();
        let list = [];
        if (isAdmin) {
          try {
            const factoryAddr = factory.target || factory.address || null;
            const rpc = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
            if (factoryAddr) {
              const localFactory = await createContractInstanceAsync('ContractFactory', factoryAddr, rpc);
              const total = Number(await localFactory.getAllContractsCount().catch(() => 0));
              const pageSize = Math.min(total, 50);
              list = pageSize > 0 ? await localFactory.getAllContractsPaged(0, pageSize).catch(() => []) : [];
            }
          } catch (e) {
            console.warn('Admin branch failed to read all contracts via RPC:', e);
            list = [];
          }
        } else {
          list = await factory.getContractsByCreatorPaged(addr, 0, 50);
        }
        if (!mounted) return;
        setContracts(list || []);

        // Fetch details for each contract (best-effort): try Rent then NDA
        const detMap = {};
        for (const c of list || []) {
          try {
            // try as Rent
            const r = await svc.getRentContractDetails(c).catch(() => null);
            if (r) {
              detMap[c] = r;
              continue;
            }
            const n = await svc.getNDAContractDetails(c).catch(() => null);
            if (n) {
              detMap[c] = n;
              continue;
            }
            // fallback: simple address-only object
            detMap[c] = { address: c, type: 'Unknown' };
          } catch (err) {
            detMap[c] = { address: c, type: 'Unknown' };
          }
        }
        if (mounted) setDetails(detMap);
      } catch (err) {
        console.error('Error loading contracts:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [isConnected, signer, chainId, account]);

  // If user isn't connected, show the previous placeholder UX (static preview)
  const platformAdmin = import.meta.env?.VITE_PLATFORM_ADMIN || null;
  const isAdmin = platformAdmin && account && account.toLowerCase() === platformAdmin.toLowerCase();

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
          if (!d) {
            return (
              <li key={addr} className="contract-item">
                <strong>{addr}</strong>
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
                  <button className="btn-sm outline" onClick={() => { setSelectedContract(d.address); setModalReadOnly(true); setIsModalOpen(true); }}>
                    <i className="fas fa-eye"></i> View
                  </button>
                  <button className="btn-sm primary" onClick={() => { setSelectedContract(d.address); setModalReadOnly(false); setIsModalOpen(true); }}>
                    <i className="fas fa-edit"></i> Manage
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
                  <button className="btn-sm outline" onClick={() => { setSelectedContract(d.address); setModalReadOnly(true); setIsModalOpen(true); }}>
                    <i className="fas fa-eye"></i> View
                  </button>
                  <button className="btn-sm primary" onClick={() => { setSelectedContract(d.address); setModalReadOnly(false); setIsModalOpen(true); }}>
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
                <h4>{d.type} • {d.address}</h4>
              </div>
                <div className="contract-actions">
                  <button className="btn-sm outline" onClick={() => { setSelectedContract(d.address); setModalReadOnly(true); setIsModalOpen(true); }}>
                    <i className="fas fa-eye"></i> View
                  </button>
                  <button className="btn-sm primary" onClick={() => { setSelectedContract(d.address); setModalReadOnly(false); setIsModalOpen(true); }}>
                    <i className="fas fa-edit"></i> Manage
                  </button>
                </div>
            </li>
          );
        })}
      </ul>
      <ContractModal contractAddress={selectedContract} isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setSelectedContract(null); }} readOnly={modalReadOnly} />
    </div>
  );
}
