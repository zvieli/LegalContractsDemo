// ---- Rent EIP712 signing wrapper ----
    
import { useState, useEffect, useMemo, useRef } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import { ContractService } from '../../services/contractService';
import * as ethers from 'ethers';
import { ArbitrationService } from '../../services/arbitrationService';
import { DocumentGenerator } from '../../utils/documentGenerator';
import { computePayloadDigest } from '../../utils/cidDigest';
import { getContractAddress } from '../../utils/contracts';
import ConfirmPayModal from '../common/ConfirmPayModal';
import './ContractModal.css';
import { decryptCiphertextJson } from '../../utils/adminDecrypt';
import EvidenceList from '../Evidence/EvidenceList';
import EvidenceBatchModal from '../Evidence/EvidenceBatchModal.jsx';
import { useNotifications } from '../../contexts/NotificationContext.jsx';
import { useEvidence } from '../../hooks/useEvidence.js';
import { registerRecipient } from '../../utils/recipientKeys.js';
import EvidenceSubmit from '../EvidenceSubmit/EvidenceSubmit';
import { IN_E2E } from '../../utils/env';
import EnhancedRentContractJson from '../../utils/contracts/EnhancedRentContract.json';
import NDATemplateJson from '../../utils/contracts/NDATemplate.json';
function ContractModal({ contractAddress, isOpen, onClose, readOnly = false }) {
  const contractInstanceRef = useRef(null);
  const { account, signer, chainId, provider, contracts: globalContracts } = useEthers();
  const [dataLoading, setDataLoading] = useState(false);
  
  // Debug provider/signer info
  useEffect(() => {
    console.log('[ContractModal] active provider URL:', provider?.connection?.url ?? null);
    // Use optional chaining to avoid reading signer.provider directly which can throw in some injected-provider setups
    console.log('[ContractModal] signer provider URL:', signer?.provider?.connection?.url ?? null);
  }, [provider, signer]);
  
  const [contractDetails, setContractDetails] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [transactionHistory, setTransactionHistory] = useState([]);
  const [pendingDeposit, setPendingDeposit] = useState(null);
  const [activeTab, setActiveTab] = useState('details');
  const [requiredEth, setRequiredEth] = useState(null);
  const [requiredEthWei, setRequiredEthWei] = useState(null);
  const [withdrawableAmt, setWithdrawableAmt] = useState('0');
  const [feeDueEth, setFeeDueEth] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [policyDraft, setPolicyDraft] = useState({ notice: '', feeBps: '', mutual: false });
  const [feeToSend, setFeeToSend] = useState('');
  const [cancellationEvents, setCancellationEvents] = useState([]);
  const [ndaEvents, setNdaEvents] = useState([]);
  const [ndaCanSign, setNdaCanSign] = useState(true);
  const [ndaAlreadySigned, setNdaAlreadySigned] = useState(false);
  const [arbOwner, setArbOwner] = useState(null);
  const [isAuthorizedArbitrator, setIsAuthorizedArbitrator] = useState(false);
  const [arbCaseId, setArbCaseId] = useState('');
  const [arbApprove, setArbApprove] = useState(true);
  const [arbBeneficiary, setArbBeneficiary] = useState('');
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeForm, setDisputeForm] = useState({ dtype: 4, amountEth: '0', evidence: '' });

  // Confirmation modal state for payable actions
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAmountEth, setConfirmAmountEth] = useState('0');
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // NDA report states (replace ad-hoc DOM reads)
  const [ndaReportOffender, setNdaReportOffender] = useState('');
  const [ndaReportPenalty, setNdaReportPenalty] = useState('');
  const [ndaReportEvidenceText, setNdaReportEvidenceText] = useState('');
  
  const [createDisputeCaseId, setCreateDisputeCaseId] = useState('');
  const [createDisputeEvidence, setCreateDisputeEvidence] = useState('');
  const [rentSigning, setRentSigning] = useState(false);
  const [rentAlreadySigned, setRentAlreadySigned] = useState(false);
  const [rentCanSign, setRentCanSign] = useState(true);
  const [hasAppeal, setHasAppeal] = useState(false);
  const [arbResolution, setArbResolution] = useState(null);
  const [rationaleRevealed, setRationaleRevealed] = useState(false);
  const [hasActiveDisputeAgainstLandlord, setHasActiveDisputeAgainstLandlord] = useState(false);
  const [showAppealModal, setShowAppealModal] = useState(false);
  const [appealData, setAppealData] = useState(null);
  const [showAdminDecryptModal, setShowAdminDecryptModal] = useState(false);
  const [adminCiphertextInput, setAdminCiphertextInput] = useState('');
  const [adminPrivateKeyInput, setAdminPrivateKeyInput] = useState('');
  const [adminDecrypted, setAdminDecrypted] = useState(null);
  const [adminDecryptBusy, setAdminDecryptBusy] = useState(false);
  const [adminAutoTried, setAdminAutoTried] = useState(false);
  const [adminCiphertextReadOnly, setAdminCiphertextReadOnly] = useState(false);
  const [fetchStatusMessage, setFetchStatusMessage] = useState(null);
  const [fetchedUrl, setFetchedUrl] = useState(null);

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

  // Load contract data function
  const loadContractData = async () => {
    if (!contractAddress || !provider) return;
    
    try {
      setDataLoading(true);
      const contractService = new ContractService(provider, signer, chainId);
      
      // Try to load as EnhancedRentContract first
      let details = await contractService.getEnhancedRentContractDetails(contractAddress).catch(() => null);
      
      if (!details) {
        // Fallback to NDA contract
        details = await contractService.getNDAContractDetails(contractAddress).catch(() => null);
      }
      
      if (details) {
        setContractDetails(details);
        
        // Set related states based on contract details
        if (details.type === 'Rental') {
          setRentAlreadySigned(details.signedBy?.[account?.toLowerCase()] || false);
          setRentCanSign(account && (account.toLowerCase() === details.landlord.toLowerCase() || account.toLowerCase() === details.tenant.toLowerCase()));
        } else if (details.type === 'NDA') {
          setNdaAlreadySigned(details.signatures?.[account?.toLowerCase()] || false);
          setNdaCanSign(account && details.parties?.includes(account.toLowerCase()));
        }
        
        // Load transaction history
        await loadTransactionHistory(details);
      }
    } catch (error) {
      console.error('Error loading contract data:', error);
    } finally {
      setDataLoading(false);
    }
  };

  // Load transaction history
  const loadTransactionHistory = async (details) => {
    try {
      const contractService = new ContractService(provider, signer, chainId);
      // Implementation would depend on your specific transaction history loading logic
      // This is a placeholder - replace with actual implementation
      setTransactionHistory([]);
    } catch (error) {
      console.error('Error loading transaction history:', error);
    }
  };

  // Load contract data when component mounts or contractAddress changes
  useEffect(() => {
    if (isOpen && contractAddress) {
      loadContractData();
    }
  }, [isOpen, contractAddress]);

  // Event listeners for contract events
  useEffect(() => {
    if (!contractAddress || !provider) return;
    
    let contractInstance = null;
    let ndaInstance = null;
    let listeners = [];
    
    try {
      // EnhancedRentContract events
          const enhancedRentAbi = EnhancedRentContractJson.abi;
      contractInstance = new ethers.Contract(contractAddress, enhancedRentAbi, provider);
      
      const rentPaidHandler = (tenant, amount, event) => {
        setTransactionHistory(evts => [{ type:'RentPaid', data:{ tenant, amount }, txHash:event.transactionHash, new:true }, ...evts.map(e=>({...e,new:false}))]);
      };
      contractInstance.on('RentPaid', rentPaidHandler);
      listeners.push(() => contractInstance.off('RentPaid', rentPaidHandler));
      
      const depositHandler = (by, amount, total, event) => {
        setTransactionHistory(evts => [{ type:'SecurityDepositPaid', data:{ by, amount, total }, txHash:event.transactionHash, new:true }, ...evts.map(e=>({...e,new:false}))]);
      };
      contractInstance.on('SecurityDepositPaid', depositHandler);
      listeners.push(() => contractInstance.off('SecurityDepositPaid', depositHandler));
      
      const disputeHandler = (caseId, initiator, disputeType, requestedAmount, event) => {
        setTransactionHistory(evts => [{ type:'DisputeReported', data:{ caseId, initiator, disputeType, requestedAmount }, txHash:event.transactionHash, new:true }, ...evts.map(e=>({...e,new:false}))]);
      };
      contractInstance.on('DisputeReported', disputeHandler);
      listeners.push(() => contractInstance.off('DisputeReported', disputeHandler));
      
      // NDA events
      const ndaAbi = NDATemplateJson.abi;
      ndaInstance = new ethers.Contract(contractAddress, ndaAbi, provider);
      
      const ndaSignedHandler = (signer, event) => {
        setNdaEvents(evts => [{ type:'NDASigned', data:{ signer }, txHash:event.transactionHash, new:true }, ...evts.map(e=>({...e,new:false}))]);
      };
      ndaInstance.on('NDASigned', ndaSignedHandler);
      listeners.push(() => ndaInstance.off('NDASigned', ndaSignedHandler));
      
    } catch (error) {
      console.error('Error setting up event listeners:', error);
    }
    
    return () => {
      listeners.forEach(unsub => {
        try {
          unsub();
        } catch (error) {
          console.error('Error removing event listener:', error);
        }
      });
    };
  }, [contractAddress, provider]);

  // E2E testing helpers
  useEffect(() => {
    try {
      const enabledViaHost = typeof window !== 'undefined' && (window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'));
      const enabled = IN_E2E || enabledViaHost;
      if (!enabled) return;
      
      console.debug && console.debug('E2E: attaching playwright helpers (IN_E2E=true)');
      
      window.playwright_open_dispute = () => { 
        try { 
          console.debug && console.debug('E2E: playwright_open_dispute called'); 
          setShowDisputeForm(true); 
        } catch (_) {} 
      };
      
      window.playwright_submit_dispute = async (evidenceText, amountEth) => {
        try {
          console.debug && console.debug('E2E: playwright_submit_dispute called', evidenceText, amountEth);
          
          try { 
            window.__PLAYWRIGHT_DISPUTE_OVERRIDE = { 
              evidence: (evidenceText || `Playwright evidence ${Date.now()}`), 
              amountEth: (amountEth != null ? String(amountEth) : undefined) 
            }; 
          } catch (_) {}
          
          setDisputeForm(s => ({ 
            ...s, 
            evidence: evidenceText || `Playwright evidence ${Date.now()}`, 
            amountEth: (amountEth != null ? String(amountEth) : s.amountEth) 
          }));
          setShowDisputeForm(true);
          
          await new Promise(r => setTimeout(r, 50));
        } catch (error) {
          console.error('E2E: playwright_submit_dispute failed:', error);
        }
      };
    } catch (error) {
      console.error('E2E: Failed to attach playwright helpers:', error);
    }
  }, []);

  // Confirmation modal handlers
  const openConfirm = (amountEth, action) => {
    setConfirmAmountEth(amountEth);
    setConfirmAction(() => action);
    setConfirmOpen(true);
  };

  const onConfirmCancel = () => {
    setConfirmOpen(false);
    setConfirmAction(null);
  };

  const onConfirmProceed = async () => {
    if (!confirmAction) return onConfirmCancel();
    setConfirmBusy(true);
    try {
      await confirmAction();
    } catch (e) {
      alert(`Action failed: ${e?.message || e}`);
    } finally {
      setConfirmBusy(false);
      setConfirmOpen(false);
      setConfirmAction(null);
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

  // Action handlers
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
      const contractService = new ContractService(provider, signer, chainId);
      const receipt = await contractService.payRent(contractAddress, paymentAmount);
      
      alert(`✅ Rent paid successfully!\nTransaction: ${receipt.hash}`);
      setPaymentAmount('');
      await loadContractData();
      
    } catch (error) {
      console.error('Error paying rent:', error);
      const reason = error?.reason || error?.error?.message || error?.data?.message || error?.message;
      alert(`❌ Payment failed: ${reason}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRentWithdraw = async () => {
    try {
      setActionLoading(true);
      const service = new ContractService(provider, signer, chainId);
      await service.withdrawRentPayments(contractAddress);
      alert('Withdraw successful');
      await loadContractData();
    } catch (e) {
      console.error('Withdraw failed', e);
      alert(`Withdraw failed: ${e?.reason || e?.message || e}`);
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

      const contractService = new ContractService(provider, signer, chainId);
      const rentContract = await contractService.getEnhancedRentContractForWrite(contractAddress);
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

  const handleFinalizeCancellation = async () => {
    if (!confirm('Finalize cancellation via Arbitration Service? This will deactivate the contract.')) return;
    try {
      setActionLoading(true);
      const service = new ContractService(provider, signer, chainId);
      
      const arbAddress = contractDetails?.arbitrationService || null;
      let arbAddr = arbAddress;
      
      if (!arbAddr) {
        try {
          const resp = await fetch('/utils/contracts/ContractFactory.json');
          if (resp && resp.ok) {
            const cf = await resp.json();
            arbAddr = cf?.contracts?.ArbitrationService || null;
          }
        } catch (_) { arbAddr = null; }
      }
      
      if (!arbAddr) {
        try {
          const maybe = await getContractAddress(chainId, 'ArbitrationService');
          if (maybe) arbAddr = maybe;
        } catch (_) {}
      }

      if (!arbAddr || arbAddr === 'MISSING_ARBITRATION_SERVICE' || arbAddr === ethers.ZeroAddress) {
        alert('No ArbitrationService configured for this contract or frontend. Run the deploy script with DEPLOY_ARBITRATION=true to add one.');
        setActionLoading(false);
        return;
      }

      const fee = feeToSend ? feeToSend : '0';
      const feeWei = fee ? ethers.parseEther(String(fee)) : 0n;

      const accountAddr = account ? account.toLowerCase() : null;
      const isCallerLandlord = accountAddr && contractDetails?.landlord && accountAddr === contractDetails.landlord.toLowerCase();
      
      let receipt;
      if (isCallerLandlord) {
        receipt = await service.finalizeByLandlordViaService(arbAddr, contractAddress, feeWei);
      } else {
        receipt = await service.finalizeCancellationViaService(arbAddr, contractAddress, feeWei);
      }
      
      alert(`✅ Cancellation finalized\nTransaction: ${receipt.transactionHash || receipt.hash}`);
      await loadContractData();
    } catch (e) {
      console.error('Finalize failed:', e);
      alert(`Failed to finalize: ${e?.reason || e?.message || e}`);
    } finally {
      setActionLoading(false);
    }
  };

  // NDA actions
  const handleNdaSign = async () => {
    try {
      setActionLoading(true);
      const service = new ContractService(provider, signer, chainId);
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
      const service = new ContractService(provider, signer, chainId);
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
      const service = new ContractService(provider, signer, chainId);
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
      const service = new ContractService(provider, signer, chainId);
      
      let digestToUse = null;
      try {
        digestToUse = await service.uploadEvidence(evidence || '');
      } catch (err) {
        if (String(err?.message || '').startsWith('EVIDENCE_UPLOAD_REQUIRED')) {
          alert('Evidence upload is required by this environment but the evidence endpoint or admin public key is not configured. Please contact the administrator.');
          throw err;
        }
        console.error('evidence upload failed, falling back to local digest', err);
        digestToUse = computePayloadDigest(evidence || '');
      }
      
      await service.ndaReportBreach(contractAddress, offender, penalty, digestToUse);
      alert('Breach reported');
      await loadContractData();
    } catch (e) {
      alert(`Report failed: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
  };

  const handleNdaDeactivate = async () => {
    try {
      setActionLoading(true);
      const service = new ContractService(provider, signer, chainId);
      await service.ndaDeactivate(contractAddress, 'User action');
      alert('NDA deactivated');
      await loadContractData();
    } catch (e) {
      alert(`Deactivate failed: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
  };

  const handleNdaResolveByArbitrator = async () => {
    alert('Resolve action must be performed by the platform arbitrator via ArbitrationService');
  };

  const submitDisputeForm = async (payloadOverride) => {
    const overrideStr = typeof payloadOverride === 'string' ? payloadOverride : null;
    if (overrideStr !== null) {
      setDisputeForm(s => ({ ...s, evidence: overrideStr }));
    }

    let evidenceRaw = overrideStr !== null ? overrideStr : (disputeForm.evidence || '');
    setActionLoading(true);

    try {
      let targetAddress = contractAddress;
      
      const svc = new ContractService(provider, signer, chainId);
      let amountEthForCalc = disputeForm.amountEth;
      const amountWei = amountEthForCalc ? ethers.parseEther(String(amountEthForCalc || '0')) : 0n;

      let evidenceDigest = '';
      try {
        if (evidenceRaw && /^0x[0-9a-fA-F]{64}$/.test(evidenceRaw)) evidenceDigest = evidenceRaw;
        else if (evidenceRaw) evidenceDigest = ethers.keccak256(ethers.toUtf8Bytes(String(evidenceRaw)));
        else evidenceDigest = '';
      } catch (e) {
        evidenceDigest = '';
      }

      if (!targetAddress || !/^0x[0-9a-fA-F]{40}$/.test(String(targetAddress))) {
        throw new Error(`Invalid or missing contractAddress when submitting dispute: ${String(targetAddress)}`);
      }

      let caseId = null;
      let evidenceRef = evidenceDigest && evidenceDigest.length ? evidenceDigest : ethers.ZeroHash;

      let effectiveDetails = contractDetails;
      if (!effectiveDetails) {
        effectiveDetails = await svc.getNDAContractDetails(targetAddress, { silent: true }).catch(() => null);
        if (effectiveDetails) setContractDetails(effectiveDetails);
      }

      if (!effectiveDetails) {
        throw new Error(`Could not determine contract template type for ${targetAddress}. Aborting submit to avoid wrong-template call.`);
      }

      if (effectiveDetails.type === 'NDA') {
        let offender = ndaReportOffender || '';
        let requestedPenaltyEth = ndaReportPenalty || amountEthForCalc || '0';
        
        try {
          const digestToUse = await svc.uploadEvidence(evidenceRaw || '');
          evidenceRef = digestToUse;
        } catch (err) {
          if (String(err?.message || '').startsWith('EVIDENCE_UPLOAD_REQUIRED')) {
            alert('Evidence upload is required by this environment but the evidence endpoint or admin public key is not configured. Please contact the administrator.');
            throw err;
          }
          evidenceRef = computePayloadDigest(evidenceRaw || '');
        }
        
        await svc.ndaReportBreach(targetAddress, offender, requestedPenaltyEth, evidenceRef);
        caseId = null;
      } else {
        const res = await svc.reportRentDispute(targetAddress, Number(disputeForm.dtype || 0), amountWei, evidenceRef);
        if (res && typeof res === 'object' && res.caseId != null) caseId = res.caseId;
      }

      const incoming = {
        contractAddress: targetAddress,
        dtype: Number(disputeForm.dtype || 0),
        amountEth: String(disputeForm.amountEth || '0'),
        evidenceRef: evidenceRef || ethers.ZeroHash,
        reporter: account || null,
        caseId: caseId != null ? String(caseId) : null,
        createdAt: new Date().toISOString(),
      };
      
      sessionStorage.setItem('incomingDispute', JSON.stringify(incoming));
      
      try {
        const perKey = `incomingDispute:${targetAddress}`;
        localStorage.setItem(perKey, JSON.stringify(incoming));
      } catch (e) {
        console.warn('Failed to persist per-contract incomingDispute', e);
      }

      setShowDisputeForm(false);
      alert('Dispute submitted. The platform arbitrator will review the case. You will be notified of updates.');
      await loadContractData();

      return {
        contractAddress: targetAddress,
        caseId: caseId != null ? String(caseId) : null,
        evidenceRef,
      };
    } catch (err) {
      console.error('Submit dispute failed:', err);
      alert(`Failed to submit dispute: ${err?.reason || err?.message || err}`);
      throw err;
    } finally {
      setActionLoading(false);
    }
  };

  const computedReporterBondEth = (() => {
    try {
      const amt = disputeForm.amountEth ? ethers.parseEther(String(disputeForm.amountEth || '0')) : 0n;
      const svc = new ContractService(provider, signer, chainId);
      const bond = svc.computeReporterBond(amt);
      try { return ethers.formatEther(bond); } catch { return String(bond); }
    } catch (_) { return '0'; }
  })();

  const handleCreateDispute = async () => {
    try {
      setActionLoading(true);
      const svc = new ArbitrationService(signer, chainId);
      const { disputeId } = await svc.createDisputeForCase(contractAddress, createDisputeCaseId, createDisputeEvidence);
      alert(`Dispute created${disputeId != null ? ` (ID ${disputeId})` : ''}`);
    } catch (e) {
      alert(`Create dispute failed: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
  };

  const isArbitrator = useMemo(() => {
    try {
      if (!arbOwner || !account) return false;
      return arbOwner.toLowerCase() === account.toLowerCase();
    } catch { return false; }
  }, [arbOwner, account]);

  const handleSetPolicy = async () => {
    try {
      setActionLoading(true);
      const contractService = new ContractService(provider, signer, chainId);
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
      const service = new ContractService(provider, signer, chainId);
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
      const service = new ContractService(provider, signer, chainId);
      await service.approveCancellation(contractAddress);
      alert('Cancellation approved');
      await loadContractData();
    } catch (e) {
      alert(`Failed: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
  };

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(contractAddress);
      alert('Address copied to clipboard');
    } catch (_) {
      const input = document.createElement('input');
      input.value = contractAddress;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      alert('Address copied to clipboard');
    }
  };

  const handleCopyTx = async (txHash) => {
    if (!txHash) return;
    try {
      await navigator.clipboard.writeText(txHash);
      alert('Transaction hash copied to clipboard');
    } catch (_) {
      try {
        const input = document.createElement('input');
        input.value = txHash;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        alert('Transaction hash copied to clipboard');
      } catch (e) {
        console.error('Copy failed', e);
        alert('Failed to copy transaction hash');
      }
    }
  };

  const handleShowAppeal = async () => {
    try {
      const key1 = `incomingDispute:${contractAddress}`;
      const key2 = `incomingDispute:${String(contractAddress).toLowerCase()}`;
      let json = localStorage.getItem(key1) || localStorage.getItem(key2) || null;
      
      if (!json) {
        const sess = sessionStorage.getItem('incomingDispute');
        if (sess) {
          try {
            const o = JSON.parse(sess);
            if (o && o.contractAddress && String(o.contractAddress).toLowerCase() === String(contractAddress).toLowerCase()) {
              json = sess;
            }
          } catch (_) { json = null; }
        }
      }
      
      if (!json) {
        alert('No appeal found for this contract');
        return;
      }
      
      const obj = JSON.parse(json);
      setAppealData(obj);
      setShowAppealModal(true);
    } catch (e) {
      console.error('Show appeal failed', e);
      alert('Failed to show appeal');
    }
  };

  const copyTextToClipboard = async (text) => {
    try {
      if (!text) throw new Error('No text to copy');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {
      // fallback
    }
    
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (e) {
      console.error('Clipboard fallback failed', e);
      return false;
    }
  };

  const handleCopyComplaint = async () => {
    try {
      if (!appealData) throw new Error('No appeal data');

      let evidenceText = '';
      if (appealData.evidence && typeof appealData.evidence === 'string') {
        const v = appealData.evidence;
        const isLikelyHash = /^0x[0-9a-fA-F]{64}$/.test(v);
        if (!isLikelyHash) {
          evidenceText = v;
        }
      }

      if (evidenceText) {
        const ok = await copyTextToClipboard(evidenceText);
        if (ok) { alert('Complaint text copied to clipboard'); return; }
      }

      const summary = {
        contract: appealData.contractAddress || null,
        caseId: appealData.caseId || null,
        type: appealData.dtype || null,
        amountEth: appealData.amountEth || null,
        reporter: appealData.reporter || null,
        submitted: appealData.createdAt || null,
        evidenceText: evidenceText || null,
        evidence: (!evidenceText && appealData.evidence) ? appealData.evidence : ((appealData.evidenceRef || appealData.evidenceDigest) ? (appealData.evidenceRef || appealData.evidenceDigest) : null)
      };

      const ok = await copyTextToClipboard(JSON.stringify(summary, null, 2));
      if (ok) {
        alert('Appeal summary copied to clipboard');
      } else {
        alert('Failed to copy appeal');
      }
    } catch (e) {
      console.error('Copy complaint failed', e);
      alert(`Failed to copy complaint: ${e?.message || e}`);
    }
  };

  // Admin decrypt functionality
  useEffect(() => {
    if (!showAdminDecryptModal) { setAdminAutoTried(false); return; }
    if (adminAutoTried) return;
    
    const tryAuto = async () => {
      try {
        const pk = adminPrivateKeyInput && adminPrivateKeyInput.trim();
        const payload = adminCiphertextInput && adminCiphertextInput.trim();
        if (!pk || !payload) return;
        if (!/^https?:\/\//i.test(payload)) return;
        
        setAdminDecryptBusy(true);
        let fetched = '';
        try {
          const resp = await fetch(payload);
          if (!resp.ok) throw new Error('Fetch failed: ' + resp.statusText);
          fetched = await resp.text();
        } catch (e) { return; }
        
        try {
          const plain = await decryptCiphertextJson(fetched, pk);
          setAdminDecrypted(plain);
        } catch (_) {}
      } finally {
        setAdminAutoTried(true);
        setAdminDecryptBusy(false);
      }
    };
    
    tryAuto();
  }, [showAdminDecryptModal]);

  // Early return if not connected
  if (!provider || !signer || !chainId || !account) {
    return <div style={{textAlign:'center',marginTop:'48px'}}><div className="loading-spinner" style={{marginBottom:'16px'}}></div>Connecting to wallet...</div>;
  }

  const handleExport = () => {
    try {
      DocumentGenerator.generatePDF({
        ...contractDetails,
        transactions: transactionHistory
      });
    } catch (e) {
      const blob = new Blob([JSON.stringify({ contractDetails, transactionHistory }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `contract-${contractAddress}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // Rent EIP712 signing wrapper
  const handleRentSign = async () => {
    if (!contractDetails || !contractDetails.landlord || !contractDetails.tenant || typeof contractDetails.active === 'undefined' || !contractDetails.signedBy) {
      alert('Contract details not loaded yet. Please wait and try again.');
      return;
    }

    try {
      const rentDetails = contractDetails;
      const { safeGetAddress } = await import('../../utils/signer.js');
      const contractService = new ContractService(provider, signer, chainId);
      const signerAddr = await safeGetAddress(signer, contractService._providerForRead() || provider || null);
      
      console.log('DEBUG signRent:', {
        landlord: rentDetails.landlord,
        tenant: rentDetails.tenant,
        msgSender: signerAddr,
        active: rentDetails.active,
        alreadySigned: rentDetails.signedBy?.[signerAddr.toLowerCase()] || false
      });
    } catch (e) {
      console.warn('DEBUG signRent: failed to log context', e);
    }

    try {
      setRentSigning(true);
      const svc = new ContractService(provider, signer, chainId);
      await svc.signRent(contractAddress);
      await loadContractData();
    } catch (e) {
      const reason = e?.reason || e?.message || 'Failed to sign';
      alert(`Sign failed: ${reason}`);
    } finally {
      setRentSigning(false);
    }
  };

  // Evidence Tab Component
  const EvidenceTabContent = ({ contractDetails, signer, account, contractInstanceRef }) => {
    return (
      <div>
        <h3>Evidence Management</h3>
        <p>Evidence submission and management for this contract.</p>
        <EvidenceSubmit
          evidenceType="contract"
          submitHandler={submitDisputeForm}
          authAddress={account}
        />
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Contract Management</h2>
          <div style={{display:'flex', gap:8, alignItems:'center'}}>
            {hasAppeal && (
              <button className="btn-sm" onClick={handleShowAppeal} style={{marginRight:6}}>Show Appeal</button>
            )}
            <button className="modal-close" onClick={onClose}>
              <i className="fas fa-times"></i>
            </button>
          </div>

          <ConfirmPayModal 
            open={confirmOpen} 
            title="Confirm dispute bond" 
            amountEth={confirmAmountEth} 
            details={`This will send the reporter bond to the contract (anti-spam).`} 
            onConfirm={onConfirmProceed} 
            onCancel={onConfirmCancel} 
            busy={confirmBusy} 
          />
        </div>

        <div className="modal-tabs">
          <button 
            className={activeTab === 'details' ? 'active' : ''}
            onClick={() => setActiveTab('details')}
          >
            <i className="fas fa-info-circle"></i>
            Details
          </button>
          
          {!readOnly && contractDetails?.type === 'Rental' && contractDetails?.isActive && (
            <button 
              className={activeTab === 'payments' ? 'active' : ''}
              onClick={() => setActiveTab('payments')}
            >
              <i className="fas fa-money-bill-wave"></i>
              Payments
            </button>
          )}
          
          {!readOnly && (
            <button 
              className={activeTab === 'actions' ? 'active' : ''}
              onClick={() => setActiveTab('actions')}
            >
              <i className="fas fa-cog"></i>
              Actions
            </button>
          )}
          
          <button 
            className={activeTab === 'evidence' ? 'active' : ''}
            onClick={() => setActiveTab('evidence')}
          >
            <i className="fas fa-folder-open"></i>
            Evidence
          </button>
        </div>

        {dataLoading ? (
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
                    <span className="value" data-testid="contract-address">{contractDetails.address}</span>
                  </div>
                  {contractDetails.type === 'Rental' && (
                    <>
                      <div className="detail-item">
                        <span className="label">Landlord:</span>
                        <span className="value" data-testid="contract-landlord">{contractDetails.landlord}</span>
                      </div>
                      <div className="detail-item">
                        <span className="label">Tenant:</span>
                        <span className="value" data-testid="contract-tenant">{contractDetails.tenant}</span>
                      </div>
                      <div className="detail-item">
                        <span className="label">Rent Amount:</span>
                        <span className="value" data-testid="contract-rent-amount">{contractDetails.rentAmount} ETH/month</span>
                      </div>
                    </>
                  )}
                  <div className="detail-item">
                    <span className="label">Status:</span>
                    <span className={`status-badge ${contractDetails.isActive ? 'active' : 'inactive'}`} data-testid="contract-status">
                      {contractDetails.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
                
                <div className="details-grid" style={{marginTop:'8px'}}>
                  <div className="detail-item">
                    <span className="label">Fully Signed</span>
                    <span className="value">{contractDetails.fullySigned ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Total Deposits</span>
                    <span className="value">{contractDetails.totalDeposits} ETH</span>
                  </div>
                </div>
                
                {hasAppeal && (
                  <div style={{marginTop:8}}>
                    <button className="btn-action" data-testid="show-appeal-btn" onClick={handleShowAppeal}>Show Appeal</button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'payments' && (
              <div className="tab-content">
                <h3>Rent Payment</h3>
                
                {!contractDetails.isActive && (
                  <div className="alert warning">This contract is inactive. Payments are disabled.</div>
                )}
                
                {contractDetails?.cancellation?.cancelRequested && (
                  <div className="alert warning">Cancellation is pending; payments are disabled until completion.</div>
                )}

                <div className="payment-section">
                  {isTenant ? (
                    <div className="payment-input">
                      <input
                        type="number"
                        placeholder="Amount in ETH"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        disabled={readOnly || actionLoading || !contractDetails.isActive || !!contractDetails?.cancellation?.cancelRequested}
                      />
                      <button 
                        onClick={handlePayRent}
                        disabled={readOnly || actionLoading || !paymentAmount || !contractDetails.isActive || !!contractDetails?.cancellation?.cancelRequested}
                        className="btn-primary"
                      >
                        {actionLoading ? 'Processing...' : 'Pay Rent'}
                      </button>
                    </div>
                  ) : isLandlord ? (
                    <div style={{display:'flex', gap:8, alignItems:'center'}}>
                      {Number(withdrawableAmt || '0') > 0 ? (
                        <button
                          onClick={handleRentWithdraw}
                          disabled={readOnly || actionLoading}
                          className="btn-primary"
                        >
                          {actionLoading ? 'Processing...' : `Withdraw ${withdrawableAmt} ETH`}
                        </button>
                      ) : (
                        <div className="muted">No withdrawable funds available.</div>
                      )}
                    </div>
                  ) : (
                    <div className="alert info">Only the tenant can pay this contract. Connect as the tenant to make payments.</div>
                  )}
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
                        <div className="tx-hash">
                          {tx.hash?.slice(0, 10)}...{tx.hash?.slice(-8)}
                          <button className="btn-copy" onClick={() => handleCopyTx(tx.hash)} title="Copy tx hash" style={{marginLeft:8}}>Copy</button>
                        </div>
                        {tx.note && (
                          <div className="tx-note">{tx.note}</div>
                        )}
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
                    <div style={{display:'flex', flexDirection:'column', gap:'12px'}}>
                      <div style={{display:'flex', gap:'8px', flexWrap:'wrap'}}>
                        {contractDetails?.isActive && (
                          <button 
                            onClick={handleRentSign}
                            disabled={readOnly || rentSigning || !rentCanSign}
                            className="btn-action primary"
                          >
                            {rentSigning ? 'Signing...' : rentAlreadySigned ? 'Signed' : 'Sign Contract'}
                          </button>
                        )}
                      </div>
                      {!rentCanSign && !rentAlreadySigned && (
                        <small className="muted">Connect as landlord or tenant to sign.</small>
                      )}
                    </div>
                  ) : (
                    <button 
                      onClick={handleNdaDeactivate}
                      disabled={readOnly || actionLoading || !contractDetails.isActive}
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

                {/* Additional action sections would go here */}
              </div>
            )}

            {activeTab === 'evidence' && (
              <div className="tab-content">
                <EvidenceTabContent 
                  contractDetails={contractDetails} 
                  signer={signer} 
                  account={account} 
                  contractInstanceRef={contractInstanceRef} 
                />
              </div>
            )}
          </div>
        ) : (
          <div className="modal-error">
            <i className="fas fa-exclamation-triangle"></i>
            <p>Could not load contract details</p>
          </div>
        )}
        
        {showDisputeForm && (
          <div className="dispute-form-overlay" onClick={() => setShowDisputeForm(false)}>
            <div className="dispute-form" onClick={(e) => e.stopPropagation()}>
              <h3>File an Appeal to Arbitration</h3>
              <label>Dispute Type</label>
              <select value={disputeForm.dtype} onChange={e => setDisputeForm(s => ({...s, dtype: Number(e.target.value)}))}>
                <option value={0}>Damage</option>
                <option value={1}>ConditionStart</option>
                <option value={2}>ConditionEnd</option>
                <option value={3}>Quality</option>
                <option value={4}>EarlyTerminationJustCause</option>
                <option value={5}>DepositSplit</option>
                <option value={6}>ExternalValuation</option>
              </select>
              <label>Requested Amount (ETH)</label>
              <input className="text-input" type="number" value={disputeForm.amountEth} onChange={e => setDisputeForm(s => ({...s, amountEth: e.target.value}))} />
              <div style={{marginTop:6, marginBottom:6, fontSize:13, color:'#333'}}>
                <strong>Reporter bond (0.5%):</strong> {computedReporterBondEth} ETH (charged when submitting appeal)
              </div>
              <div style={{ marginTop: '12px' }}>
                <EvidenceSubmit
                  evidenceType="appeal"
                  submitHandler={submitDisputeForm}
                  authAddress={account}
                />
              </div>
              <div style={{display:'flex', gap:'8px', marginTop: '8px', justifyContent:'flex-end'}}>
                <button className="btn-action secondary" disabled={actionLoading} onClick={() => setShowDisputeForm(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Appeal modal */}
      {showAppealModal && appealData && (
        <div className="appeal-overlay" onClick={() => { setShowAppealModal(false); }}>
          <div className="appeal-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <h3>Appeal / Dispute</h3>
              <div style={{display:'flex', gap:8, alignItems:'center'}}>
                <button className="btn-sm" onClick={handleCopyComplaint} title="Copy full complaint">Copy complaint</button>
                <button className="modal-close" onClick={() => { setShowAppealModal(false); }}><i className="fas fa-times"></i></button>
              </div>
            </div>
            <div style={{marginTop:8}}>
              <p><strong>Contract:</strong> {appealData.contractAddress}</p>
              <p><strong>Case ID:</strong> {appealData.caseId || 'n/a'}</p>
              <p><strong>Type:</strong> {appealData.dtype}</p>
              <p><strong>Amount:</strong> {appealData.amountEth} ETH</p>
              <p><strong>Reporter:</strong> {appealData.reporter || 'unknown'}</p>
              <p><strong>Submitted:</strong> {appealData.createdAt ? new Date(appealData.createdAt).toLocaleString() : '—'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ContractModal;