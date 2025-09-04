import { useState, useEffect, useMemo } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import { ContractService } from '../../services/contractService';
import { ethers } from 'ethers';
import { DocumentGenerator } from '../../utils/documentGenerator';
import './ContractModal.css';

function ContractModal({ contractAddress, isOpen, onClose }) {
  const { signer, chainId, account, provider } = useEthers();
  const [contractDetails, setContractDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [transactionHistory, setTransactionHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('details');
  const [requiredEth, setRequiredEth] = useState(null);
  const [requiredEthWei, setRequiredEthWei] = useState(null);
  const [feeDueEth, setFeeDueEth] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [policyDraft, setPolicyDraft] = useState({ notice: '', feeBps: '', mutual: false });
  const [feeToSend, setFeeToSend] = useState('');

  const isTenant = useMemo(() => {
    if (!account || !contractDetails?.tenant) return false;
    return account.toLowerCase() === contractDetails.tenant.toLowerCase();
  }, [account, contractDetails]);
  const isLandlord = useMemo(() => {
    if (!account || !contractDetails?.landlord) return false;
    return account.toLowerCase() === contractDetails.landlord.toLowerCase();
  }, [account, contractDetails]);

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
      // initialize policy form from details
      try {
        if (details?.cancellation) {
          setPolicyDraft({
            notice: String(details.cancellation.noticePeriod || ''),
            feeBps: String(details.cancellation.earlyTerminationFeeBps || ''),
            mutual: !!details.cancellation.requireMutualCancel
          });
        }
      } catch (_) {}
      
      // טען היסטוריית תשלומים (מהחוזה)
      const rentContract = await contractService.getRentContract(contractAddress);
      // required ETH for current period
      try {
        const req = await rentContract.getRentInEth();
        setRequiredEthWei(req);
        setRequiredEth(ethers.formatEther(req));
      } catch (_) {
        setRequiredEthWei(null);
        setRequiredEth(null);
      }
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

  // Compute fee due (ETH) from policy and requiredEthWei
  useEffect(() => {
    try {
      const bps = contractDetails?.cancellation?.earlyTerminationFeeBps || 0;
      if (requiredEthWei && bps > 0) {
        const feeWei = (requiredEthWei * BigInt(bps)) / 10000n;
        const feeEth = ethers.formatEther(feeWei);
        setFeeDueEth(feeEth);
        if (!feeToSend) setFeeToSend(feeEth);
      } else {
        setFeeDueEth(null);
      }
    } catch (_) {
      setFeeDueEth(null);
    }
  }, [requiredEthWei, contractDetails]);

  // Countdown until effective time (if requested and unilateral)
  useEffect(() => {
    let timer;
    const eff = contractDetails?.cancellation?.cancelEffectiveAt || 0;
    const req = contractDetails?.cancellation?.cancelRequested;
    if (req && eff) {
      const tick = () => {
        const nowSec = Math.floor(Date.now() / 1000);
        const diff = eff - nowSec;
        if (diff <= 0) {
          setTimeRemaining('Ready to finalize');
        } else {
          const h = Math.floor(diff / 3600);
          const m = Math.floor((diff % 3600) / 60);
          const s = diff % 60;
          setTimeRemaining(`${h}h ${m}m ${s}s`);
        }
      };
      tick();
      timer = setInterval(tick, 1000);
    } else {
      setTimeRemaining(null);
    }
    return () => timer && clearInterval(timer);
  }, [contractDetails]);

  const handlePayRent = async () => {
    if (!paymentAmount || parseFloat(paymentAmount) <= 0) {
      alert('Please enter a valid payment amount');
      return;
    }
    if (!contractDetails?.isActive) {
      alert('Contract is inactive. Payments are disabled.');
      return;
    }
    if (!isTenant) {
      alert('Only the tenant can pay this contract.');
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
  const reason = error?.reason || error?.error?.message || error?.data?.message || error?.message;
  alert(`❌ Payment failed: ${reason}`);
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
      if (!isTenant && !isLandlord) {
        alert('Only landlord or tenant can terminate this contract.');
        return;
      }
      if (contractDetails && !contractDetails.isActive) {
        alert('Contract already inactive');
        return;
      }

      const contractService = new ContractService(signer, chainId);
      const rentContract = await contractService.getRentContract(contractAddress);
      
  const tx = await rentContract.cancelContract();
      const receipt = await tx.wait();
      
      alert(`✅ Contract terminated!\nTransaction: ${receipt.hash}`);
      onClose();
      
    } catch (error) {
      console.error('Error terminating contract:', error);
      const reason = error?.reason || error?.error?.message || error?.data?.message || error?.message;
      alert(`❌ Termination failed: ${reason}`);
    } finally {
      setActionLoading(false);
    }
  };
  const handleSetPolicy = async () => {
    try {
      setActionLoading(true);
      const contractService = new ContractService(signer, chainId);
      await contractService.setCancellationPolicy(contractAddress, {
        noticePeriodSec: Number(policyDraft.notice || 0),
        feeBps: Number(policyDraft.feeBps || 0),
        requireMutual: !!policyDraft.mutual
      });
      alert('Policy updated');
      await loadContractData();
    } catch (e) {
      alert(`Failed to set policy: ${e?.reason || e?.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleInitiateCancel = async () => {
    try {
      setActionLoading(true);
      const service = new ContractService(signer, chainId);
      await service.initiateCancellation(contractAddress);
      alert('Cancellation initiated');
      await loadContractData();
    } catch (e) {
      alert(`Failed: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
  };

  const handleApproveCancel = async () => {
    try {
      setActionLoading(true);
      const service = new ContractService(signer, chainId);
      await service.approveCancellation(contractAddress);
      alert('Cancellation approved');
      await loadContractData();
    } catch (e) {
      alert(`Failed: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
  };

  const handleFinalizeCancel = async () => {
    try {
      setActionLoading(true);
      const service = new ContractService(signer, chainId);
      await service.finalizeCancellation(contractAddress, { feeValueEth: feeToSend });
      alert('Cancellation finalized');
      onClose();
    } catch (e) {
      alert(`Failed: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
  };

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(contractAddress);
      alert('Address copied to clipboard');
    } catch (_) {
      // Fallback
      const input = document.createElement('input');
      input.value = contractAddress;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      alert('Address copied to clipboard');
    }
  };

  const handleExport = () => {
    try {
      DocumentGenerator.generatePDF({
        ...contractDetails,
        transactions: transactionHistory
      });
    } catch (e) {
      // Minimal fallback: download JSON
      const blob = new Blob([JSON.stringify({ contractDetails, transactionHistory }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `contract-${contractAddress}.json`;
      a.click();
      URL.revokeObjectURL(url);
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
                {!contractDetails.isActive && (
                  <div className="alert warning">This contract is inactive. Payments are disabled.</div>
                )}
                {!isTenant && (
                  <div className="alert info">Only the tenant can pay this contract.</div>
                )}
                {requiredEth && (
                  <p className="muted">Required ETH for rent: {requiredEth} ETH</p>
                )}
                <div className="payment-section">
                  <div className="payment-input">
                    <input
                      type="number"
                      placeholder="Amount in ETH"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      disabled={actionLoading || !contractDetails.isActive || !isTenant}
                    />
                    <button 
                      onClick={handlePayRent}
                      disabled={actionLoading || !paymentAmount || !contractDetails.isActive || !isTenant}
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
                    disabled={actionLoading || (!isTenant && !isLandlord) || (contractDetails && !contractDetails.isActive)}
                    className="btn-action danger"
                  >
                    <i className="fas fa-times-circle"></i>
                    Terminate Contract
                  </button>
                  
                  <button className="btn-action" onClick={handleExport}>
                    <i className="fas fa-file-export"></i>
                    Export PDF
                  </button>
                  
                  <button className="btn-action" onClick={handleCopyAddress}>
                    <i className="fas fa-copy"></i>
                    Copy Address
                  </button>
                </div>

                {contractDetails?.isActive && (
                  <div className="policy-section" style={{marginTop: '16px'}}>
                    <h4>Cancellation Policy</h4>
                    <div className="details-grid">
                      <div className="detail-item">
                        <span className="label">Require Mutual</span>
                        <span className="value">{contractDetails?.cancellation?.requireMutualCancel ? 'Yes' : 'No'}</span>
                      </div>
                      <div className="detail-item">
                        <span className="label">Notice (sec)</span>
                        <span className="value">{contractDetails?.cancellation?.noticePeriod ?? 0}</span>
                      </div>
                      <div className="detail-item">
                        <span className="label">Early Termination Fee (bps)</span>
                        <span className="value">{contractDetails?.cancellation?.earlyTerminationFeeBps ?? 0}</span>
                      </div>
                      {contractDetails?.cancellation?.cancelRequested && (
                        <div className="detail-item">
                          <span className="label">Cancellation Requested By</span>
                          <span className="value">{contractDetails?.cancellation?.cancelInitiator}</span>
                        </div>
                      )}
                      {contractDetails?.cancellation?.cancelRequested && (
                        <div className="detail-item">
                          <span className="label">Effective At</span>
                          <span className="value">{contractDetails?.cancellation?.cancelEffectiveAt ? new Date(contractDetails.cancellation.cancelEffectiveAt * 1000).toLocaleString() : '—'}</span>
                        </div>
                      )}
                      {timeRemaining && (
                        <div className="detail-item">
                          <span className="label">Time Remaining</span>
                          <span className="value">{timeRemaining}</span>
                        </div>
                      )}
                      {feeDueEth && (
                        <div className="detail-item">
                          <span className="label">Fee Due on Finalize (ETH)</span>
                          <span className="value">{feeDueEth}</span>
                        </div>
                      )}
                    </div>

                    {isLandlord && (
                      <div className="policy-form" style={{marginTop: '8px'}}>
                        <div className="details-grid">
                          <div className="detail-item">
                            <span className="label">Notice (sec)</span>
                            <input className="text-input" type="number" value={policyDraft.notice} onChange={e => setPolicyDraft(s => ({...s, notice: e.target.value}))} />
                          </div>
                          <div className="detail-item">
                            <span className="label">Fee (bps)</span>
                            <input className="text-input" type="number" value={policyDraft.feeBps} onChange={e => setPolicyDraft(s => ({...s, feeBps: e.target.value}))} />
                          </div>
                          <div className="detail-item">
                            <label className="label">Require Mutual</label>
                            <input type="checkbox" checked={policyDraft.mutual} onChange={e => setPolicyDraft(s => ({...s, mutual: e.target.checked}))} />
                          </div>
                        </div>
                        <button className="btn-action" disabled={actionLoading} onClick={handleSetPolicy}>Save Policy</button>
                      </div>
                    )}

                    {(() => {
                      const cxl = contractDetails?.cancellation || {};
                      const alreadyRequested = !!cxl.cancelRequested;
                      const initiator = (cxl.cancelInitiator || '').toLowerCase();
                      const iAmInitiator = account && initiator && account.toLowerCase() === initiator;
                      const myApproved = isLandlord ? !!cxl.approvals?.landlord : isTenant ? !!cxl.approvals?.tenant : false;
                      const bothApproved = !!cxl.approvals?.landlord && !!cxl.approvals?.tenant;
                      const nowSec = Math.floor(Date.now()/1000);
                      const canInitiate = contractDetails.isActive && !alreadyRequested && (isLandlord || isTenant);
                      const canApprove = contractDetails.isActive && alreadyRequested && !myApproved && !iAmInitiator && (isLandlord || isTenant);
                      const canFinalize = contractDetails.isActive && alreadyRequested && (
                        cxl.requireMutualCancel ? bothApproved : (cxl.cancelEffectiveAt ? nowSec >= cxl.cancelEffectiveAt : false)
                      );
                      return (
                        <div className="cxl-actions" style={{marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap'}}>
                          <button className="btn-action" disabled={actionLoading || !canInitiate} onClick={handleInitiateCancel}>Initiate Cancellation</button>
                          <button className="btn-action" disabled={actionLoading || !canApprove} onClick={handleApproveCancel}>Approve Cancellation</button>
                          <div style={{display:'flex', gap:'8px', alignItems:'center'}}>
                            <input className="text-input" style={{width:'160px'}} type="number" placeholder={feeDueEth ? `Fee required: ${feeDueEth}` : 'Fee (ETH, optional)'} value={feeToSend} onChange={e => setFeeToSend(e.target.value)} />
                            <button className="btn-action" disabled={actionLoading || !canFinalize} onClick={handleFinalizeCancel}>Finalize</button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
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