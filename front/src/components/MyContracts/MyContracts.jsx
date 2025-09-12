import React, { useEffect, useState } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import { ContractService } from '../../services/contractService';
import './MyContracts.css';

export default function MyContracts() {
  const { signer, chainId, account, isConnected } = useEthers();
  const [contracts, setContracts] = useState([]); // raw addresses
  const [details, setDetails] = useState({}); // address -> detail object
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isConnected) return;
    let mounted = true;
    const svc = new ContractService(signer, chainId);

    (async () => {
      try {
        setLoading(true);
        const addr = account;
        const factory = await svc.getFactoryContract();
        const list = await factory.getContractsByCreatorPaged(addr, 0, 50);
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
  if (!isConnected) {
    return (
      <div className="my-contracts placeholder">
        <h3>My Contracts</h3>
        <div className="placeholder-card">
          <div className="contract-list">
            <div className="contract-item">
              <div className="contract-info">
                <h4>Apartment Rental Contract - Tel Aviv</h4>
                <p>Created: 2024-01-15 • Amount: 5,000 USDC/month</p>
              </div>
              <span className="contract-status active">Active</span>
            </div>

            <div className="contract-item">
              <div className="contract-info">
                <h4>NDA Agreement with Startup Company</h4>
                <p>Created: 2024-01-10 • Parties: 2</p>
              </div>
              <span className="contract-status pending">Pending Signature</span>
            </div>

            <div className="contract-item">
              <div className="contract-info">
                <h4>Employment Contract with Full-stack Developer</h4>
                <p>Created: 2024-01-05 • Salary: 8,000 USDC/month</p>
              </div>
              <span className="contract-status completed">Completed</span>
            </div>
          </div>
        </div>
        <p className="connect-hint">Connect your wallet to view and manage all your contracts</p>
      </div>
    );
  }

  return (
    <div className="my-contracts">
      <h3>My Contracts</h3>
      {loading && <p>Loading...</p>}
      {!loading && contracts.length === 0 && (
        <div className="empty-state">
          <p>No contracts found</p>
          <div className="empty-actions">
            <button className="btn-primary" onClick={() => { window.location.href = '/create'; }}>Create Contract</button>
          </div>
          <div className="sample-faded">
            <div className="contract-item faded">
              <div className="contract-info">
                <h4>Apartment Rental Contract - Tel Aviv</h4>
                <p>Created: 2024-01-15 • Amount: 5,000 USDC/month</p>
              </div>
              <span className="contract-status active">Active</span>
            </div>
            <div className="contract-item faded">
              <div className="contract-info">
                <h4>NDA Agreement with Startup Company</h4>
                <p>Created: 2024-01-10 • Parties: 2</p>
              </div>
              <span className="contract-status pending">Pending Signature</span>
            </div>
            <div className="contract-item faded">
              <div className="contract-info">
                <h4>Employment Contract with Full-stack Developer</h4>
                <p>Created: 2024-01-05 • Salary: 8,000 USDC/month</p>
              </div>
              <span className="contract-status completed">Completed</span>
            </div>
          </div>
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
              </li>
            );
          }

          // Fallback Unknown
          return (
            <li key={addr} className="contract-item">
              <div className="contract-info">
                <h4>{d.type} • {d.address}</h4>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
