import React, { useEffect, useState } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import './Platform.css';
import { ContractService } from '../../services/contractService';

function Platform() {
  const { signer, account, chainId } = useEthers();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!signer) return;
      setLoading(true);
      try {
        const svc = new ContractService(signer, chainId || 31337);
        // Get all contracts from factory (read-only)
        const factory = await svc.getFactoryContract();
        const total = Number(await factory.getAllContractsCount());
        const page = await factory.getAllContractsPaged(0, Math.min(total, 500));
        setContracts(page || []);
      } catch (err) {
        console.error('Error loading platform contracts', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [signer, chainId]);

  return (
    <div className="platform-page">
      <h1>Platform Admin</h1>
      <p>Welcome {account}. This view is for platform operators. The list below is read-only.</p>
      <div style={{ marginTop: 20 }}>
        <h2>Contracts (read-only)</h2>
        {loading && <div>Loading contracts...</div>}
        {!loading && contracts.length === 0 && <div>No contracts found</div>}
        <ul>
          {contracts.map((addr) => (
            <li key={addr} style={{ marginBottom: 8 }}>
              <code>{addr}</code>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default Platform;
