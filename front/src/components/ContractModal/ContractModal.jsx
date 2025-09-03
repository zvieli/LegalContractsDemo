import { useState, useEffect } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import { ContractService } from '../../services/contractService';
import { ethers } from 'ethers';
import './ContractModal.css';

function ContractModal({ contractAddress, isOpen, onClose }) {
  const { signer, chainId, account, provider } = useEthers();
  const [contractDetails, setContractDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [transactionHistory, setTransactionHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('details');

  useEffect(() => {
    if (isOpen && contractAddress && signer) {
      loadContractData();
    }
  }, [isOpen, contractAddress, signer]);

  const loadContractData = async () => {
    try {
      setLoading(true);
      const contractService = new ContractService(signer, chainId);
      
      // טען פרטי חוזה
      const details = await contractService.getRentContractDetails(contractAddress);
      setContractDetails(details);
      
      // טען היסטוריית תשלומים (מהחוזה)
      const rentContract = await contractService.getRentContract(contractAddress);
      const paymentEvents = await rentContract.queryFilter(rentContract.filters.RentPaid());
      // Enrich with block timestamps; event args: (tenant, amount, late, token)
      const transactions = await Promise.all(paymentEvents.map(async (event) => {
        const blk = await (signer?.provider || provider).getBlock(event.blockNumber);
        return {
          hash: event.transactionHash,
          amount: ethers.formatEther(event.args.amount),
          date: blk?.timestamp ? new Date(Number(blk.timestamp) * 1000).toLocaleDateString() : '—',
          payer: event.args.tenant
        };
      }));
      
      setTransactionHistory(transactions);
      
    } catch (error) {
      console.error('Error loading contract data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePayRent = async () => {
    if (!paymentAmount || parseFloat(paymentAmount) <= 0) {
      alert('Please enter a valid payment amount');
      return;
    }

    try {
      setActionLoading(true);
      const contractService = new ContractService(signer, chainId);
      const receipt = await contractService.payRent(contractAddress, paymentAmount);
      
      alert(`✅ Rent paid successfully!\nTransaction: ${receipt.hash}`);
      setPaymentAmount('');
      await loadContractData(); // Refresh data
      
    } catch (error) {
      console.error('Error paying rent:', error);
      alert(`❌ Payment failed: ${error.reason || error.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleTerminate = async () => {
    if (!confirm('Are you sure you want to terminate this contract? This action cannot be undone.')) {
      return;
    }

    try {
      setActionLoading(true);
      const contractService = new ContractService(signer, chainId);
      const rentContract = await contractService.getRentContract(contractAddress);
      
  const tx = await rentContract.cancelContract();
      const receipt = await tx.wait();
      
      alert(`✅ Contract terminated!\nTransaction: ${receipt.hash}`);
      onClose();
      
    } catch (error) {
      console.error('Error terminating contract:', error);
      alert(`❌ Termination failed: ${error.reason || error.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Contract Management</h2>
          <button className="modal-close" onClick={onClose}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="modal-tabs">
          <button 
            className={activeTab === 'details' ? 'active' : ''}
            onClick={() => setActiveTab('details')}
          >
            <i className="fas fa-info-circle"></i>
            Details
          </button>
          <button 
            className={activeTab === 'payments' ? 'active' : ''}
            onClick={() => setActiveTab('payments')}
          >
            <i className="fas fa-money-bill-wave"></i>
            Payments
          </button>
          <button 
            className={activeTab === 'actions' ? 'active' : ''}
            onClick={() => setActiveTab('actions')}
          >
            <i className="fas fa-cog"></i>
            Actions
          </button>
        </div>

        {loading ? (
          <div className="modal-loading">
            <div className="loading-spinner"></div>
            <p>Loading contract data...</p>
          </div>
        ) : contractDetails ? (
          <div className="modal-body">
            {activeTab === 'details' && (
              <div className="tab-content">
                <h3>Contract Information</h3>
                <div className="details-grid">
                  <div className="detail-item">
                    <span className="label">Address:</span>
                    <span className="value">{contractDetails.address}</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Landlord:</span>
                    <span className="value">{contractDetails.landlord}</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Tenant:</span>
                    <span className="value">{contractDetails.tenant}</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Rent Amount:</span>
                    <span className="value">{contractDetails.rentAmount} ETH/month</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Status:</span>
                    <span className={`status-badge ${contractDetails.isActive ? 'active' : 'inactive'}`}>
                      {contractDetails.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'payments' && (
              <div className="tab-content">
                <h3>Rent Payment</h3>
                <div className="payment-section">
                  <div className="payment-input">
                    <input
                      type="number"
                      placeholder="Amount in ETH"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      disabled={actionLoading}
                    />
                    <button 
                      onClick={handlePayRent}
                      disabled={actionLoading || !paymentAmount}
                      className="btn-primary"
                    >
                      {actionLoading ? 'Processing...' : 'Pay Rent'}
                    </button>
                  </div>
                </div>

                <h3>Payment History</h3>
                <div className="transactions-list">
                  {transactionHistory.length === 0 ? (
                    <p className="no-transactions">No payments yet</p>
                  ) : (
                    transactionHistory.map((tx, index) => (
                      <div key={index} className="transaction-item">
                        <div className="tx-amount">{tx.amount} ETH</div>
                        <div className="tx-date">{tx.date}</div>
                        <div className="tx-hash">{tx.hash.slice(0, 10)}...{tx.hash.slice(-8)}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === 'actions' && (
              <div className="tab-content">
                <h3>Contract Actions</h3>
                <div className="actions-grid">
                  <button 
                    onClick={handleTerminate}
                    disabled={actionLoading}
                    className="btn-action danger"
                  >
                    <i className="fas fa-times-circle"></i>
                    Terminate Contract
                  </button>
                  
                  <button className="btn-action">
                    <i className="fas fa-file-export"></i>
                    Export PDF
                  </button>
                  
                  <button className="btn-action">
                    <i className="fas fa-copy"></i>
                    Copy Address
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="modal-error">
            <i className="fas fa-exclamation-triangle"></i>
            <p>Could not load contract details</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default ContractModal;