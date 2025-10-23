import { useState, useEffect } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import { ContractService } from '../../services/contractService';
import { uploadCustomClausesToHelia } from '../../utils/heliaClient';
import './CreateNDA.css';
import '../../styles/notAllowed.css';

function CreateNDA() {
  const { isConnected, signer, chainId, account, provider, loading, isConnecting, connectWallet } = useEthers();
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    async function checkAdmin() {
      if (!provider || !signer || !chainId || !account) {
        setIsAdmin(false);
        return;
      }
      try {
  const contractService = new ContractService(provider, signer, chainId);
        const factory = await contractService.getFactoryContract();
        let owner = null;
        try { owner = await factory.factoryOwner(); } catch { owner = null; }
        setIsAdmin(owner && account.toLowerCase() === owner.toLowerCase());
      } catch { setIsAdmin(false); }
    }
    checkAdmin();
  }, [provider, signer, chainId, account]);
  const [formData, setFormData] = useState({
    partyB: '',
    expiryDate: '',
    penaltyBps: '1000', // 10% default
    customClauses: '',
    minDeposit: '0.1',
    arbitrationBond: '100' // V7: Default arbitration bond
  });

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleCreateNDA = async (e) => {
    e.preventDefault();
    try {
      // Basic validation
      if (!formData.partyB.match(/^0x[a-fA-F0-9]{40}$/)) {
        alert('Counterparty must be a valid address');
        return;
      }
      if (!formData.expiryDate) {
        alert('Please choose an expiry date');
        return;
      }
      const today = new Date();
      const exp = new Date(formData.expiryDate);
      if (exp <= today) {
        alert('Expiry must be in the future');
        return;
      }
      const penaltyBps = Number(formData.penaltyBps || 0);
      if (penaltyBps < 0 || penaltyBps > 10000) {
        alert('Penalty BPS must be between 0 and 10000');
        return;
      }
      const minDeposit = String(formData.minDeposit || '0');
      if (Number(minDeposit) <= 0) {
        alert('Minimum deposit must be > 0');
        return;
      }

      // Upload custom clauses to Helia if provided
      let customClausesHash = '';
      if (formData.customClauses && formData.customClauses.trim() !== '') {
        customClausesHash = await uploadCustomClausesToHelia(formData.customClauses);
        if (!customClausesHash) {
          alert('Failed to upload custom clauses to Helia. Please try again or check your connection.');
          return;
        }
      }

  const service = new ContractService(provider, signer, chainId);
      const res = await service.createNDA({
        partyB: formData.partyB,
        expiryDate: formData.expiryDate,
        penaltyBps: penaltyBps,
        customClausesHash: customClausesHash,
        minDeposit: minDeposit,
        arbitrationBond: formData.arbitrationBond
      });

      if (!res?.contractAddress) {
        alert('Transaction mined but no NDA address found in logs. Check the explorer.');
        return;
      }

      alert(`NDA created at ${res.contractAddress}`);
      window.location.href = '/';
    } catch (err) {
      const reason = err?.reason || err?.error?.message || err?.data?.message || err?.message;
      alert(`Failed to create NDA: ${reason}`);
    }
  };

  if (!isConnected) {
    return (
      <div className="create-nda-page">
        <div className="not-connected">
          <i className="fas fa-wallet"></i>
          <h2>Connect Your Wallet</h2>
          <p>Please connect your wallet to create an NDA agreement</p>
        </div>
      </div>
    );
  }

  // If connected account is the configured platform admin, disallow creation via UI
  if (isAdmin) {
    return (
      <div className="create-nda-page">
        <div className="not-allowed">
          <i className="fas fa-ban"></i>
          <h2>Action Not Allowed</h2>
          <p>The connected account is registered as the platform admin and cannot create NDA contracts through this UI.</p>
        </div>
      </div>
    );
  }

  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const shouldShowSpinner = isConnecting || (loading && !provider && !account);
  useEffect(() => {
    let t;
    if (loading) t = setTimeout(() => setLoadingTimedOut(true), 5000);
    else setLoadingTimedOut(false);
    return () => clearTimeout(t);
  }, [loading]);

  if (shouldShowSpinner && !loadingTimedOut) {
    return <div style={{textAlign:'center',marginTop:'48px'}}><div className="loading-spinner" style={{marginBottom:'16px'}}></div>Connecting to wallet...</div>;
  }

  if (!provider || !signer || !chainId || !account) {
    return (
      <div style={{textAlign:'center',marginTop:'48px'}}>
        <div style={{fontSize:16,marginBottom:12}}>Wallet not connected</div>
        <div style={{marginBottom:12}}><small>Please connect your Ethereum wallet to create an NDA.</small></div>
        <div>
          <button className="btn-primary" onClick={() => { try { connectWallet && connectWallet(); } catch(e){ console.error('connectWallet failed', e); } }}>Connect Wallet</button>
        </div>
      </div>
    );
  }

  return (
    <div className="create-nda-page">
      <div className="page-header">
        <h1>Create NDA Agreement</h1>
        <p>Create a confidential Non-Disclosure Agreement on the blockchain</p>
      </div>

      <form onSubmit={handleCreateNDA} className="nda-form">
        <div className="form-group">
          <label htmlFor="partyB">Counterparty Address *</label>
          <input
            type="text"
            id="partyB"
            name="partyB"
            value={formData.partyB}
            onChange={handleInputChange}
            placeholder="0x..."
            required
            pattern="^0x[a-fA-F0-9]{40}$"
          />
        </div>

        <div className="form-group">
          <label htmlFor="expiryDate">Agreement Expiry *</label>
          <input
            type="date"
            id="expiryDate"
            name="expiryDate"
            value={formData.expiryDate}
            onChange={handleInputChange}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="penaltyBps">Penalty Percentage (BPS) *</label>
          <input
            type="number"
            id="penaltyBps"
            name="penaltyBps"
            value={formData.penaltyBps}
            onChange={handleInputChange}
            min="0"
            max="10000"
            required
          />
          <small>100 BPS = 1% (Max: 10000 BPS = 100%)</small>
        </div>

        <div className="form-group">
          <label htmlFor="minDeposit">Minimum Deposit (ETH) *</label>
          <input
            type="number"
            id="minDeposit"
            name="minDeposit"
            value={formData.minDeposit}
            onChange={handleInputChange}
            min="0.001"
            step="0.001"
            required
          />
        </div>

        {/* V7 Arbitration Bond Field */}
        <div className="form-group v7-arbitration-bond" style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          padding: '20px',
          borderRadius: '8px',
          margin: '20px 0'
        }}>
          <label htmlFor="arbitrationBond" style={{ color: 'white', fontWeight: 'bold' }}>
            🤖 V7 Arbitration Bond (DAI) *
          </label>
          <input
            type="number"
            id="arbitrationBond"
            name="arbitrationBond"
            value={formData.arbitrationBond}
            onChange={handleInputChange}
            min="1"
            step="1"
            required
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '4px',
              border: '2px solid #fff',
              marginTop: '8px'
            }}
          />
          <small style={{ color: '#f0f0f0', display: 'block', marginTop: '8px' }}>
            💡 This amount is required for every V7 arbitration request. It will be refunded if the claim is proven or transferred as compensation according to the AI arbitrator's decision.
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="customClauses">Custom Clauses (Optional)</label>
          <textarea
            id="customClauses"
            name="customClauses"
            value={formData.customClauses}
            onChange={handleInputChange}
            placeholder="Additional terms and conditions..."
            rows="4"
          />
        </div>

        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={() => window.history.back()}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            <i className="fas fa-file-signature"></i>
            Create NDA Agreement
          </button>
        </div>
      </form>
    </div>
  );
}

export default CreateNDA;