import React, { useEffect, useState } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import './Platform.css';
import { ContractService } from '../../services/contractService';

function Platform() {
  const { signer, account, chainId, contracts: globalContracts } = useEthers();
  const [loading, setLoading] = useState(false);

  // No need to fetch contracts here; use globalContracts from context

  return (
    <div className="platform-page">
      <h1>Platform Admin</h1>
      <p>Welcome {account}. This view is for platform operators. The list below is read-only.</p>
      <div style={{ marginTop: 20 }}>
        <h2>Contracts (read-only)</h2>
        {loading && <div>Loading contracts...</div>}
        {!loading && globalContracts.length === 0 && <div>No contracts found</div>}
        <ul>
          {globalContracts.map((addr) => (
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
