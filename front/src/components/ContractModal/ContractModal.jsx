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
  const [cancellationEvents, setCancellationEvents] = useState([]);
  const [ndaEvents, setNdaEvents] = useState([]);
  const [ndaCanSign, setNdaCanSign] = useState(true);
  const [ndaAlreadySigned, setNdaAlreadySigned] = useState(false);

  const formatDuration = (sec) => {
    const s = Number(sec || 0);
    if (!s) return '0s';
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    return parts.length ? parts.join(' ') : `${s}s`;
  };

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
      
      // Try load as Rent first, then NDA
      let details;
      try {
        details = await contractService.getRentContractDetails(contractAddress, { silent: true });
      } catch (_) {
        details = await contractService.getNDAContractDetails(contractAddress, { silent: true });
      }
      setContractDetails(details);
      // Set NDA sign gating flags
      try {
        if (details?.type === 'NDA' && account) {
          const me = account.toLowerCase();
          const parties = details.parties || [];
          const isParty = parties.some(p => (p || '').toLowerCase() === me);
          const already = !!details.signatures?.[account] || !!details.signatures?.[me] || !!details.signatures?.[parties.find(p => (p||'').toLowerCase()===me)];
          setNdaCanSign(isParty && !already);
          setNdaAlreadySigned(already);
        } else {
          setNdaCanSign(true);
          setNdaAlreadySigned(false);
        }
      } catch (_) {}
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
      
      // Load history/policy based on type
      if (details?.type === 'Rental') {
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
      } else if (details?.type === 'NDA') {
        setTransactionHistory([]);
        // Build a simple NDA timeline from events
        try {
          const nda = await contractService.getNDAContract(contractAddress);
          const ev = [];
          const signed = await nda.queryFilter(nda.filters.NDASigned?.());
          for (const e of signed) {
            const blk = await (signer?.provider || provider).getBlock(e.blockNumber);
            ev.push({ type: 'Signed', by: e.args?.signer || e.args?.[0], at: blk?.timestamp || 0, tx: e.transactionHash });
          }
          const deps = await nda.queryFilter(nda.filters.DepositMade?.());
          for (const e of deps) {
            const blk = await (signer?.provider || provider).getBlock(e.blockNumber);
            ev.push({ type: `Deposit ${ethers.formatEther(e.args?.amount || e.args?.[1] || 0n)} ETH`, by: e.args?.party || e.args?.[0], at: blk?.timestamp || 0, tx: e.transactionHash });
          }
          const wds = await nda.queryFilter(nda.filters.DepositWithdrawn?.());
          for (const e of wds) {
            const blk = await (signer?.provider || provider).getBlock(e.blockNumber);
            ev.push({ type: `Withdraw ${ethers.formatEther(e.args?.amount || e.args?.[1] || 0n)} ETH`, by: e.args?.party || e.args?.[0], at: blk?.timestamp || 0, tx: e.transactionHash });
          }
          const rep = await nda.queryFilter(nda.filters.BreachReported?.());
          for (const e of rep) {
            const blk = await (signer?.provider || provider).getBlock(e.blockNumber);
            ev.push({ type: 'Breach Reported', by: e.args?.reporter || e.args?.[1], at: blk?.timestamp || 0, tx: e.transactionHash });
          }
          const res = await nda.queryFilter(nda.filters.BreachResolved?.());
          for (const e of res) {
            const blk = await (signer?.provider || provider).getBlock(e.blockNumber);
            ev.push({ type: e.args?.approved ? 'Breach Approved' : 'Breach Rejected', by: e.args?.beneficiary || e.args?.[3], at: blk?.timestamp || 0, tx: e.transactionHash });
          }
          const deact = await nda.queryFilter(nda.filters.ContractDeactivated?.());
          for (const e of deact) {
            const blk = await (signer?.provider || provider).getBlock(e.blockNumber);
            ev.push({ type: 'Deactivated', by: e.args?.by || e.args?.[0], at: blk?.timestamp || 0, tx: e.transactionHash });
          }
          ev.sort((a, b) => (a.at || 0) - (b.at || 0));
          setNdaEvents(ev);
        } catch (_) {
          setNdaEvents([]);
        }
      }

      if (details?.type === 'Rental') {
        // Load cancellation events timeline (best-effort)
        const evts = [];
        try {
          const rentContract = await contractService.getRentContract(contractAddress);
          const initiated = await rentContract.queryFilter(rentContract.filters.CancellationInitiated?.());
          for (const e of initiated) {
            const blk = await (signer?.provider || provider).getBlock(e.blockNumber);
            evts.push({ type: 'Initiated', by: e.args?.[0] || e.args?.initiator, at: blk?.timestamp || 0, tx: e.transactionHash });
          }
        } catch (_) {}
        try {
          const rentContract = await contractService.getRentContract(contractAddress);
          const approved = await rentContract.queryFilter(rentContract.filters.CancellationApproved?.());
          for (const e of approved) {
            const blk = await (signer?.provider || provider).getBlock(e.blockNumber);
            evts.push({ type: 'Approved', by: e.args?.[0] || e.args?.approver, at: blk?.timestamp || 0, tx: e.transactionHash });
          }
        } catch (_) {}
        try {
          const rentContract = await contractService.getRentContract(contractAddress);
          const finalized = await rentContract.queryFilter(rentContract.filters.CancellationFinalized?.());
          for (const e of finalized) {
            const blk = await (signer?.provider || provider).getBlock(e.blockNumber);
            evts.push({ type: 'Finalized', by: e.args?.[0] || null, at: blk?.timestamp || 0, tx: e.transactionHash });
          }
        } catch (_) {}
        evts.sort((a, b) => (a.at || 0) - (b.at || 0));
        setCancellationEvents(evts);
      } else {
        setCancellationEvents([]);
      }
      
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
    if (contractDetails?.cancellation?.cancelRequested) {
      alert('Cancellation is pending. Payments are temporarily disabled.');
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

  // ---------- NDA actions ----------
  const handleNdaSign = async () => {
    try {
      setActionLoading(true);
      const service = new ContractService(signer, chainId);
      await service.signNDA(contractAddress);
      alert('Signed NDA');
      await loadContractData();
    } catch (e) {
      alert(`Failed to sign: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
  };

  const handleNdaDeposit = async (amount) => {
    try {
      setActionLoading(true);
      const service = new ContractService(signer, chainId);
      await service.ndaDeposit(contractAddress, amount);
      alert('Deposit successful');
      await loadContractData();
    } catch (e) {
      alert(`Deposit failed: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
  };

  const handleNdaWithdraw = async (amount) => {
    try {
      setActionLoading(true);
      const service = new ContractService(signer, chainId);
      await service.ndaWithdraw(contractAddress, amount);
      alert('Withdraw successful');
      await loadContractData();
    } catch (e) {
      alert(`Withdraw failed: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
  };

  const handleNdaReport = async (offender, penalty, evidence) => {
    try {
      setActionLoading(true);
      const service = new ContractService(signer, chainId);
      await service.ndaReportBreach(contractAddress, offender, penalty, evidence);
      alert('Breach reported');
      await loadContractData();
    } catch (e) {
      alert(`Report failed: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
  };

  const handleNdaVote = async (caseId, approve) => {
    try {
      setActionLoading(true);
      const service = new ContractService(signer, chainId);
      await service.ndaVoteOnBreach(contractAddress, caseId, approve);
      alert('Vote submitted');
      await loadContractData();
    } catch (e) {
      alert(`Vote failed: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
  };

  const handleNdaDeactivate = async () => {
    try {
      setActionLoading(true);
      const service = new ContractService(signer, chainId);
      await service.ndaDeactivate(contractAddress, 'User action');
      alert('NDA deactivated');
      await loadContractData();
    } catch (e) {
      alert(`Deactivate failed: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
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
          {contractDetails?.type === 'Rental' && (
          <button 
            className={activeTab === 'payments' ? 'active' : ''}
            onClick={() => setActiveTab('payments')}
          >
            <i className="fas fa-money-bill-wave"></i>
            Payments
          </button>) }
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
                  {contractDetails.type === 'Rental' ? (
                    <>
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
                    </>
                  ) : (
                    <>
                      <div className="detail-item">
                        <span className="label">Party A:</span>
                        <span className="value">{contractDetails.partyA}</span>
                      </div>
                      <div className="detail-item">
                        <span className="label">Party B:</span>
                        <span className="value">{contractDetails.partyB}</span>
                      </div>
                      <div className="detail-item">
                        <span className="label">Min Deposit:</span>
                        <span className="value">{contractDetails.minDeposit} ETH</span>
                      </div>
                      <div className="detail-item">
                        <span className="label">Penalty (bps):</span>
                        <span className="value">{contractDetails.penaltyBps}</span>
                      </div>
                      <div className="detail-item">
                        <span className="label">Expiry:</span>
                        <span className="value">{contractDetails.expiryDate}</span>
                      </div>
                    </>
                  )}
                  <div className="detail-item">
                    <span className="label">Status:</span>
                    <span className={`status-badge ${contractDetails.isActive ? 'active' : 'inactive'}`}>
                      {contractDetails.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
                {contractDetails.type === 'NDA' && (
                  <div className="details-grid" style={{marginTop:'8px'}}>
                    <div className="detail-item">
                      <span className="label">Fully Signed</span>
                      <span className="value">{contractDetails.fullySigned ? 'Yes' : 'No'}</span>
                    </div>
                    <div className="detail-item">
                      <span className="label">Total Deposits</span>
                      <span className="value">{contractDetails.totalDeposits} ETH</span>
                    </div>
                    <div className="detail-item">
                      <span className="label">Open Cases</span>
                      <span className="value">{contractDetails.activeCases}</span>
                    </div>
                    <div className="detail-item">
                      <span className="label">Can Withdraw</span>
                      <span className="value">{contractDetails.canWithdraw ? 'Yes' : 'No'}</span>
                    </div>
                  </div>
                )}
                {contractDetails.type === 'NDA' && contractDetails.parties?.length > 0 && (
                  <div className="section" style={{marginTop:'8px'}}>
                    <h4>Parties</h4>
                    <div className="transactions-list">
                      {contractDetails.parties.map((p) => (
                        <div key={p} className="transaction-item">
                          <div className="tx-amount">{contractDetails.signatures?.[p] ? 'Signed' : 'Not signed'}</div>
                          <div className="tx-date">Deposit: {contractDetails.depositsByParty?.[p] || '0'} ETH</div>
                          <div className="tx-hash">{p.slice(0,10)}...{p.slice(-8)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'payments' && (
              <div className="tab-content">
                <h3>Rent Payment</h3>
                <div className="details-grid" style={{marginBottom:'8px'}}>
                  <div className="detail-item">
                    <span className="label">Connected Wallet</span>
                    <span className="value">{account}</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">On-chain Tenant</span>
                    <span className="value">{contractDetails?.tenant}</span>
                  </div>
                </div>
                {!contractDetails.isActive && (
                  <div className="alert warning">This contract is inactive. Payments are disabled.</div>
                )}
                {!isTenant && (
                  <div className="alert info">Only the tenant can pay this contract.</div>
                )}
                {contractDetails?.cancellation?.cancelRequested && (
                  <div className="alert warning">Cancellation is pending; payments are disabled until completion.</div>
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
                      disabled={actionLoading || !contractDetails.isActive || !isTenant || !!contractDetails?.cancellation?.cancelRequested}
                    />
                    {!isTenant && <small className="muted">Switch wallet to the tenant address shown above.</small>}
                    <button 
                      onClick={handlePayRent}
                      disabled={actionLoading || !paymentAmount || !contractDetails.isActive || !isTenant || !!contractDetails?.cancellation?.cancelRequested}
                      className="btn-primary"
                    >
                      {actionLoading ? 'Processing...' : 'Pay Rent'}
                    </button>
                    <button 
                      onClick={() => setPaymentAmount(requiredEth || '')}
                      disabled={actionLoading || !contractDetails.isActive || !isTenant || !requiredEth || !!contractDetails?.cancellation?.cancelRequested}
                      className="btn-secondary"
                    >
                      Use required amount
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
                  {contractDetails.type === 'Rental' ? (
                    <button 
                      onClick={handleTerminate}
                      disabled={actionLoading || (!isTenant && !isLandlord) || (contractDetails && !contractDetails.isActive)}
                      className="btn-action danger"
                    >
                      <i className="fas fa-times-circle"></i>
                      Terminate Contract
                    </button>
                  ) : (
                    <button 
                      onClick={handleNdaDeactivate}
                      disabled={actionLoading || !contractDetails.isActive}
                      className="btn-action danger"
                    >
                      <i className="fas fa-ban"></i>
                      Deactivate NDA
                    </button>
                  )}
                  
                  <button className="btn-action" onClick={handleExport}>
                    <i className="fas fa-file-export"></i>
                    Export PDF
                  </button>
                  
                  <button className="btn-action" onClick={handleCopyAddress}>
                    <i className="fas fa-copy"></i>
                    Copy Address
                  </button>
                </div>

                {contractDetails?.isActive && contractDetails.type === 'Rental' && (
                  <div className="policy-section" style={{marginTop: '16px'}}>
                    <h4>Cancellation Policy</h4>
                    <div className="details-grid">
                      <div className="detail-item">
                        <span className="label">Require Mutual</span>
                        <span className="value">{contractDetails?.cancellation?.requireMutualCancel ? 'Yes' : 'No'}</span>
                      </div>
                      <div className="detail-item">
                        <span className="label">Notice (sec)</span>
                        <span className="value">{contractDetails?.cancellation?.noticePeriod ?? 0} ({formatDuration(contractDetails?.cancellation?.noticePeriod)})</span>
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
                            <button className="btn-action" disabled={!feeDueEth} onClick={() => setFeeToSend(feeDueEth || '')}>Autofill Fee</button>
                            <button className="btn-action" disabled={actionLoading || !canFinalize} onClick={handleFinalizeCancel}>Finalize</button>
                          </div>
                        </div>
                      );
                    })()}

                    {cancellationEvents && cancellationEvents.length > 0 && (
                      <div className="section" style={{marginTop:'16px'}}>
                        <h4>Cancellation Timeline</h4>
                        <div className="transactions-list">
                          {cancellationEvents.map((ev, idx) => (
                            <div key={idx} className="transaction-item">
                              <div className="tx-amount">{ev.type}</div>
                              <div className="tx-date">{ev.at ? new Date(Number(ev.at) * 1000).toLocaleString() : '—'}</div>
                              <div className="tx-hash">{ev.by ? `${ev.by.slice(0,10)}...${ev.by.slice(-8)}` : (ev.tx ? `${ev.tx.slice(0,10)}...${ev.tx.slice(-8)}` : '—')}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {contractDetails?.isActive && contractDetails.type === 'NDA' && (
                  <div className="policy-section" style={{marginTop:'16px'}}>
                    <h4>NDA Actions</h4>
                    <div className="details-grid">
                      <div className="detail-item">
                        <button className="btn-action" disabled={actionLoading || !ndaCanSign} onClick={handleNdaSign}>Sign NDA</button>
                        {!ndaCanSign && ndaAlreadySigned && (
                          <small className="muted">Already signed with this wallet.</small>
                        )}
                        {!ndaCanSign && !ndaAlreadySigned && (
                          <small className="muted">Connect as a party to sign.</small>
                        )}
                      </div>
                      <div className="detail-item" style={{display:'flex', gap:'8px', alignItems:'center'}}>
                        <input className="text-input" type="number" placeholder={`Deposit (min ${contractDetails.minDeposit})`} onChange={e => setPaymentAmount(e.target.value)} value={paymentAmount} />
                        <button className="btn-action" disabled={actionLoading || !paymentAmount} onClick={() => handleNdaDeposit(paymentAmount)}>Deposit</button>
                        <button className="btn-action" disabled={actionLoading || !paymentAmount} onClick={() => handleNdaWithdraw(paymentAmount)}>Withdraw</button>
                      </div>
                      <div className="detail-item" style={{display:'flex', flexDirection:'column', gap:'6px'}}>
                        <label className="label">Report Breach</label>
                        <input className="text-input" placeholder="Offender (0x...)" id="nda-offender" />
                        <input className="text-input" placeholder="Requested penalty (ETH)" id="nda-penalty" />
                        <input className="text-input" placeholder="Evidence text (optional)" id="nda-evidence" />
                        <button className="btn-action" disabled={actionLoading} onClick={() => {
                          const offender = document.getElementById('nda-offender').value;
                          const penalty = document.getElementById('nda-penalty').value;
                          const ev = document.getElementById('nda-evidence').value;
                          handleNdaReport(offender, penalty, ev);
                        }}>Submit Report</button>
                      </div>
                      <div className="detail-item" style={{display:'flex', gap:'8px', alignItems:'center'}}>
                        <input className="text-input" placeholder="Case ID" id="nda-caseid" />
                        <button className="btn-action" disabled={actionLoading} onClick={() => handleNdaVote(document.getElementById('nda-caseid').value, true)}>Vote Approve</button>
                        <button className="btn-action" disabled={actionLoading} onClick={() => handleNdaVote(document.getElementById('nda-caseid').value, false)}>Vote Reject</button>
                      </div>
                    </div>
                    {ndaEvents && ndaEvents.length > 0 && (
                      <div className="section" style={{marginTop:'16px'}}>
                        <h4>Timeline</h4>
                        <div className="transactions-list">
                          {ndaEvents.map((ev, idx) => (
                            <div key={idx} className="transaction-item">
                              <div className="tx-amount">{ev.type}</div>
                              <div className="tx-date">{ev.at ? new Date(Number(ev.at) * 1000).toLocaleString() : '—'}</div>
                              <div className="tx-hash">{ev.by ? `${ev.by.slice(0,10)}...${ev.by.slice(-8)}` : (ev.tx ? `${ev.tx.slice(0,10)}...${ev.tx.slice(-8)}` : '—')}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
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