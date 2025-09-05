import { useState } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import { ContractService } from '../../services/contractService';
import './CreateNDA.css';

function CreateNDA() {
  const { isConnected, signer, chainId, account } = useEthers();
  const [formData, setFormData] = useState({
    partyB: '',
    expiryDate: '',
    penaltyBps: '1000', // 10% default
    customClauses: '',
    minDeposit: '0.1'
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

      const service = new ContractService(signer, chainId);
      const res = await service.createNDA({
        partyB: formData.partyB,
        expiryDate: formData.expiryDate,
        penaltyBps: penaltyBps,
        customClauses: formData.customClauses,
        arbitrator: undefined, // optional for now
        minDeposit: minDeposit,
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