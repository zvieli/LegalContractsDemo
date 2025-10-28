// ---- Rent EIP712 signing wrapper ----
    
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import { ContractService } from '../../services/contractService';
import * as ethers from 'ethers';
import { ArbitrationService } from '../../services/arbitrationService';
import { DocumentGenerator } from '../../utils/documentGenerator';
import { computePayloadDigest } from '../../utils/cidDigest';
import { getContractAddress, createContractInstanceAsync } from '../../utils/contracts';
import _ConfirmPayModal from '../common/ConfirmPayModal';
import './ContractModal.css';
import { decryptCiphertextJson } from '../../utils/adminDecrypt';
import { useNotifications as _useNotifications } from '../../contexts/NotificationContext.jsx';
import { registerRecipient as _registerRecipient } from '../../utils/recipientKeys.js';
import { IN_E2E as _IN_E2E } from '../../utils/env';
import EnhancedRentContractJson from '../../utils/contracts/EnhancedRentContract.json';
import NDATemplateJson from '../../utils/contracts/NDATemplate.json';
import { canonicalize } from '../../utils/evidenceCanonical.js';
import { computeContentDigest } from '../../utils/evidenceCanonical.js';
import { signEvidenceEIP712, hashRecipients } from '../../utils/evidence.js';
import { triggerArbitrateBatch } from '../../api/arbitration';
function ContractModal({ contractAddress, isOpen, onClose, readOnly = false }) {
  const _contractInstanceRef = useRef(null);
void _contractInstanceRef;
    const { account, signer, chainId, provider, contracts: _globalContracts, loading, isConnecting, connectWallet } = useEthers();
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  
  // Debug provider/signer info
  useEffect(() => {
    console.log('[ContractModal] active provider URL:', provider?.connection?.url ?? null);
    // Use optional chaining to avoid reading signer.provider directly which can throw in some injected-provider setups
    console.log('[ContractModal] signer provider URL:', signer?.provider?.connection?.url ?? null);
  }, [provider, signer]);

  // If loading persists for too long, fall back to the connect UI
  useEffect(() => {
    let t;
    if (loading) {
      t = setTimeout(() => setLoadingTimedOut(true), 5000);
    } else {
      setLoadingTimedOut(false);
    }
    return () => { if (t) clearTimeout(t); };
  }, [loading]);
  
  const [contractDetails, setContractDetails] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [transactionHistory, setTransactionHistory] = useState([]);
  const [_pendingDeposit, _setPendingDeposit] = useState(null);
  const [activeTab, setActiveTab] = useState('details');
  const [_requiredEth, _setRequiredEth] = useState(null);
  const [requiredEthWei, _setRequiredEthWei] = useState(null);
  const [withdrawableAmt, _setWithdrawableAmt] = useState('0');
  const [_feeDueEth, setFeeDueEth] = useState(null);
  const [_timeRemaining, setTimeRemaining] = useState(null);
  const [policyDraft, setPolicyDraft] = useState({ notice: '', feeBps: '', mutual: false });
  const [feeToSend, setFeeToSend] = useState('');
  const [_cancellationEvents, _setCancellationEvents] = useState([]);
  const [_ndaEvents, setNdaEvents] = useState([]);
  const [_ndaCanSign, setNdaCanSign] = useState(true);
  const [_ndaAlreadySigned, setNdaAlreadySigned] = useState(false);
  const [arbOwner, _setArbOwner] = useState(null);
  const [factoryOwner, setFactoryOwner] = useState(null);
  const [arbitrationOwner, setArbitrationOwner] = useState(null);
  const [creator, setCreator] = useState(null);
  const [_isAuthorizedArbitrator, _setIsAuthorizedArbitrator] = useState(false);
  const [_arbCaseId, _setArbCaseId] = useState('');
  const [_arbApprove, _setArbApprove] = useState(true);
  const [_arbBeneficiary, _setArbBeneficiary] = useState('');
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewPayloadStr, setPreviewPayloadStr] = useState('');
  const [previewPayloadObj, setPreviewPayloadObj] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  // appeal evidence modal removed per UX decision
  const [disputeForm, setDisputeForm] = useState({ dtype: 4, amountEth: '0', evidence: '' });

  // Confirmation modal state for payable actions
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAmountEth, setConfirmAmountEth] = useState('0');
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // NDA report states (replace ad-hoc DOM reads)
  const [ndaReportOffender, _setNdaReportOffender] = useState('');
  const [ndaReportPenalty, _setNdaReportPenalty] = useState('');
  const [_ndaReportEvidenceText, _setNdaReportEvidenceText] = useState('');
  
  const [createDisputeCaseId, _setCreateDisputeCaseId] = useState('');
  const [createDisputeEvidence, _setCreateDisputeEvidence] = useState('');
  const [rentSigning, setRentSigning] = useState(false);
  const [rentAlreadySigned, setRentAlreadySigned] = useState(false);
  const [rentCanSign, setRentCanSign] = useState(true);
  const [hasAppeal, setHasAppeal] = useState(false);
  const [_arbResolution, _setArbResolution] = useState(null);
  const [_rationaleRevealed, _setRationaleRevealed] = useState(false);
  const [_hasActiveDisputeAgainstLandlord, _setHasActiveDisputeAgainstLandlord] = useState(false);
  const [showAppealModal, setShowAppealModal] = useState(false);
  const [appealData, setAppealData] = useState(null);
  const [appealEvidenceList, setAppealEvidenceList] = useState([]);
  const [escrowBalanceWei, setEscrowBalanceWei] = useState(0n);
  const [cancelPreviewObj, setCancelPreviewObj] = useState(null);
  const [cancelPreviewLoading, setCancelPreviewLoading] = useState(false);
  const [showCancelPreviewModal, setShowCancelPreviewModal] = useState(false);
  const [partyDepositWei, setPartyDepositWei] = useState(0n);
  const [contractBalanceWei, setContractBalanceWei] = useState(0n);

  // Auto-fetch cancellation preview when both parties have approved (helps UI transition)
  useEffect(() => {
    try {
      const approvals = contractDetails?.cancellation?.approvals;
      const bothApproved = approvals && approvals.landlord && approvals.tenant;
      if (contractDetails?.cancellation?.cancelRequested && bothApproved && contractAddress && provider) {
        // If we don't already have a preview, fetch it
        if (!cancelPreviewObj && !cancelPreviewLoading) {
          (async () => {
            try {
              setCancelPreviewLoading(true);
              const svc = new ContractService(provider, signer, chainId);
              const p = await svc.getCancellationPreview(contractAddress).catch(() => null);
              setCancelPreviewObj(p);
            } catch (e) { void e; setCancelPreviewObj(null); }
            finally { setCancelPreviewLoading(false); }
          })();
        }
        // Auto-open the preview modal when both parties have approved so user sees Preview/Finalize immediately
        // try {
        //   if (!showCancelPreviewModal) setShowCancelPreviewModal(true);
        // } catch (e) { void e; }
      }
    } catch (e) { void e; }
  }, [contractDetails?.cancellation?.approvals, contractDetails?.cancellation?.cancelRequested, contractAddress, provider, signer, chainId]);

  // Fetch preview when the cancel preview modal is opened (regardless of approvals)
  useEffect(() => {
    if (!showCancelPreviewModal) return;
    console.debug('[ContractModal] showCancelPreviewModal opened -> fetching preview');
    let mounted = true;
    (async () => {
      try {
        setCancelPreviewLoading(true);
        setCancelPreviewObj(null);
        const svc = new ContractService(provider, signer, chainId);
        const p = await svc.getCancellationPreview(contractAddress).catch((e) => { console.warn('getCancellationPreview failed', e); return null; });
        console.debug('[ContractModal] getCancellationPreview result', p);
        if (!mounted) return;
        setCancelPreviewObj(p);
      } catch (e) { void e; console.error('[ContractModal] cancellation preview fetch error', e); setCancelPreviewObj(null); }
      finally { if (mounted) setCancelPreviewLoading(false); console.debug('[ContractModal] showCancelPreviewModal fetch finished'); }
    })();
    return () => { mounted = false; };
  }, [showCancelPreviewModal, contractAddress, provider, signer, chainId]);

  // Helper to explicitly fetch the preview (used by button and effects)
  const fetchCancellationPreview = useCallback(async () => {
    try {
      console.debug('[ContractModal] fetchCancellationPreview invoked');
      setCancelPreviewLoading(true);
      setCancelPreviewObj(null);
      const svc = new ContractService(provider, signer, chainId);
      const p = await svc.getCancellationPreview(contractAddress).catch((e) => { console.warn('getCancellationPreview failed', e); return null; });
      console.debug('[ContractModal] fetchCancellationPreview result', p);
      setCancelPreviewObj(p);
      return p;
    } catch (e) { void e; console.error('[ContractModal] fetchCancellationPreview error', e); setCancelPreviewObj(null); return null; }
    finally { setCancelPreviewLoading(false); }
  }, [provider, signer, chainId, contractAddress]);
  const [topUpAmountEth, setTopUpAmountEth] = useState('0');
  const [showAdminDecryptModal, _setShowAdminDecryptModal] = useState(false);
  const [adminCiphertextInput, _setAdminCiphertextInput] = useState('');
  const [adminPrivateKeyInput, _setAdminPrivateKeyInput] = useState('');
  const [_adminDecrypted, setAdminDecrypted] = useState(null);
  const [_adminDecryptBusy, setAdminDecryptBusy] = useState(false);
  const [adminAutoTried, setAdminAutoTried] = useState(false);
  const [_adminCiphertextReadOnly, _setAdminCiphertextReadOnly] = useState(false);
  const [_fetchStatusMessage, _setFetchStatusMessage] = useState(null);
  const [_fetchedUrl, _setFetchedUrl] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingModalOpen, setPendingModalOpen] = useState(false);
  const [pendingQueue, setPendingQueue] = useState([]);
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  const _formatDuration = (sec) => {
void _formatDuration;
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

  // Format wei (BigInt) or numeric values to ETH string for display
  const fmtEth = (val) => {
    try {
      if (val === null || typeof val === 'undefined') return '—';
      // If BigInt (wei)
      if (typeof val === 'bigint') return ethers.formatEther(val);
      // If it looks like a numeric string or number (already in ETH), show as-is
      if (typeof val === 'number') return String(val);
      if (typeof val === 'string') {
        // If it's a hex address, return raw (used for feeRecipient elsewhere)
        if (/^0x[0-9a-fA-F]{40}$/.test(val)) return val;
        // If it's a decimal-looking string, return as-is
        if (!isNaN(Number(val))) return String(val);
        return val;
      }
      return String(val);
    } catch (e) { void e; return String(val); }
  };

  const isTenant = useMemo(() => {
    if (!account || !contractDetails?.tenant) return false;
    return account.toLowerCase() === contractDetails.tenant.toLowerCase();
  }, [account, contractDetails]);
  
  const isLandlord = useMemo(() => {
    if (!account || !contractDetails?.landlord) return false;
    return account.toLowerCase() === contractDetails.landlord.toLowerCase();
  }, [account, contractDetails]);
  // Load transaction history
  const loadTransactionHistory = useCallback(async (details) => {
    try {
      if (!details || !details.address || !provider) {
        setTransactionHistory([]);
        return;
      }
  const enhancedRentAbi = EnhancedRentContractJson.abi;
  // Prefer a read-only JSON-RPC provider (local Hardhat) to reliably query past logs
  const svc = new ContractService(provider, signer, chainId);
  const p = svc._providerForRead() || provider;
      console.log('[loadTransactionHistory] using provider for read:', p && p.connection ? p.connection.url || p.connection : p);
      console.log('[loadTransactionHistory] provider type:', Object.prototype.toString.call(p));
  const contractInstance = new ethers.Contract(details.address, enhancedRentAbi, p);

      // Query historical events: RentPaid, SecurityDepositPaid, DisputeReported
      const rentFilter = contractInstance.filters.RentPaid();
      const depositFilter = contractInstance.filters.SecurityDepositPaid();
      const disputeFilter = contractInstance.filters.DisputeReported();

      const [rentLogs, depositLogs, disputeLogs] = await Promise.all([
        contractInstance.queryFilter(rentFilter, 0, 'latest').catch((e) => { console.warn('[loadTransactionHistory] rent queryFilter error', e); return []; }),
        contractInstance.queryFilter(depositFilter, 0, 'latest').catch((e) => { console.warn('[loadTransactionHistory] deposit queryFilter error', e); return []; }),
        contractInstance.queryFilter(disputeFilter, 0, 'latest').catch((e) => { console.warn('[loadTransactionHistory] dispute queryFilter error', e); return []; })
      ]);

      console.log('[loadTransactionHistory] raw logs counts', { rent: rentLogs.length, deposit: depositLogs.length, dispute: disputeLogs.length });

      const toEntry = async (log, type) => {
        try {
          const args = log.args || [];
          let entry = { type, txHash: log.transactionHash, new: false, blockNumber: log.blockNumber };
          if (type === 'RentPaid') {
            const tenant = args[0];
            const amount = args[1];
            const amt = ethers.formatEther(amount);
            entry.data = { tenant, amount: amt };
            // normalize for UI
            entry.amount = amt;
            entry.hash = log.transactionHash;
          } else if (type === 'SecurityDepositPaid') {
            const by = args[0];
            const amount = args[1];
            const total = args[2];
            const amt = ethers.formatEther(amount);
            const tot = ethers.formatEther(total);
            entry.data = { by, amount: amt, total: tot };
            entry.amount = amt;
            entry.hash = log.transactionHash;
          } else if (type === 'DisputeReported') {
            const caseId = args[0];
            const initiator = args[1];
            const disputeType = args[2];
            const requestedAmount = args[3];
            const req = ethers.formatEther(requestedAmount);
            entry.data = { caseId: caseId.toString(), initiator, disputeType: disputeType.toString(), requestedAmount: req };
            entry.amount = req;
            entry.hash = log.transactionHash;
          }
          // Attach human-friendly date from block timestamp when available
          try {
            const block = await (p && typeof p.getBlock === 'function' ? p.getBlock(log.blockNumber) : provider.getBlock(log.blockNumber));
            entry.date = new Date((block.timestamp || 0) * 1000).toLocaleString();
          } catch (err) {
            // use the error variable to avoid unused-var warnings
            void err;
            entry.date = '';
          }
          return entry;
        } catch (e) { void e;
          // keep error available for debugging while satisfying lint
          void e;
          return null;
        }
      };

      const allLogs = [];
      for (const l of rentLogs) allLogs.push({ log: l, type: 'RentPaid' });
      for (const l of depositLogs) allLogs.push({ log: l, type: 'SecurityDepositPaid' });
      for (const l of disputeLogs) allLogs.push({ log: l, type: 'DisputeReported' });

      // Convert and sort by blockNumber desc
      const entries = (await Promise.all(allLogs.map(i => toEntry(i.log, i.type)))).filter(Boolean)
        .sort((a, b) => (b.blockNumber || 0) - (a.blockNumber || 0));

      console.log('[loadTransactionHistory] entries produced count:', entries.length, 'preview:', entries.slice(0,5));

      setTransactionHistory(entries);
    } catch (error) {
      console.error('Error loading transaction history:', error);
      setTransactionHistory([]);
    }
  }, [provider, signer, chainId]);

  // Load contract data function
  const loadContractData = useCallback(async () => {
    if (!contractAddress || !provider) {
      console.log('[loadContractData] Missing contractAddress or provider', { contractAddress, provider });
      return;
    }
    try {
      setDataLoading(true);
      const contractService = new ContractService(provider, signer, chainId);
      console.log('[loadContractData] Trying EnhancedRentContract:', contractAddress);
      let details = await contractService.getEnhancedRentContractDetails(contractAddress)
        .catch((e) => { console.log('[loadContractData] EnhancedRentContract error', e); return null; });
      if (!details) {
        console.log('[loadContractData] Trying NDA contract:', contractAddress);
        details = await contractService.getNDAContractDetails(contractAddress)
          .catch((e) => { console.log('[loadContractData] NDAContract error', e); return null; });
      }
      console.log('[loadContractData] Loaded details:', details);
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
        // Determine whether we have a persisted appeal/incoming dispute or appealEvidence entries
        try {
          const key1 = `incomingDispute:${contractAddress}`;
          const key2 = `incomingDispute:${String(contractAddress).toLowerCase()}`;
          const incoming = localStorage.getItem(key1) || localStorage.getItem(key2) || sessionStorage.getItem('incomingDispute');
          const appealKey = `appealEvidence:${String(contractAddress).toLowerCase()}`;
          const appealExists = !!localStorage.getItem(appealKey);
          if (incoming || appealExists) setHasAppeal(true);
        } catch (e) { void e; /* preserve error for debugging */ }
      }
    } catch (error) {
      console.error('[loadContractData] Error loading contract data:', error);
    } finally {
      setDataLoading(false);
    }
  }, [contractAddress, provider, signer, chainId, account, loadTransactionHistory]);

 

  // Load contract data when component mounts or contractAddress changes
  useEffect(() => {
    if (isOpen && contractAddress) {
      loadContractData();
    }
  }, [isOpen, contractAddress, loadContractData]);

  // Refresh escrow/party deposit balances
  const refreshBalances = useCallback(async () => {
    try {
      if (!contractAddress || !provider) return;
      const svc = new ContractService(provider, signer, chainId);
      const eb = await svc.getEscrowBalance(contractAddress).catch(() => 0n);
      const pd = account ? await svc.getPartyDeposit(contractAddress, account).catch(() => 0n) : 0n;
      setEscrowBalanceWei(BigInt(eb || 0n));
      setPartyDepositWei(BigInt(pd || 0n));
      try {
        const bal = await provider.getBalance(contractAddress).catch(() => 0n);
        setContractBalanceWei(BigInt(bal || 0n));
      } catch (e) { void e;
        console.debug('getBalance failed', e);
        setContractBalanceWei(0n);
      }
    } catch (e) { void e;
      console.debug('refreshBalances failed', e);
    }
  }, [contractAddress, provider, account, signer, chainId]);

  useEffect(() => { if (isOpen && contractAddress) { refreshBalances(); } }, [isOpen, contractAddress, account, refreshBalances]);

  // Fetch factory owner and arbitration owner for debug/admin checks
  useEffect(() => {
    let canceled = false;
    const fetchOwners = async () => {
      try {
        if (!contractAddress || !provider) return;
        const svc = new ContractService(provider, signer, chainId);
        // Factory owner
        try {
          const factory = await svc.getFactoryContract();
          const fo = await factory.factoryOwner().catch(() => null);
          if (!canceled) setFactoryOwner(fo || null);
          try {
            const cr = await factory.getCreatorOf(contractAddress).catch(() => null);
            if (!canceled) setCreator(cr || null);
          } catch (_) { void _; if (!canceled) setCreator(null); }
        } catch (e) { void e;
          if (!canceled) { setFactoryOwner(null); setCreator(null); }
        }

        // Arbitration owner (if contract exposes arbitrationService)
        try {
          const rent = await svc.getEnhancedRentContract(contractAddress).catch(() => null);
          const arbAddr = rent ? await rent.arbitrationService().catch(() => null) : null;
          if (arbAddr && arbAddr !== ethers.ZeroAddress) {
            const p = svc._providerForRead();
            const arbInst = await createContractInstanceAsync('ArbitrationService', arbAddr, p || signer);
            const ao = await arbInst.owner().catch(() => null);
            if (!canceled) setArbitrationOwner(ao || null);
          } else {
            if (!canceled) setArbitrationOwner(null);
          }
        } catch (e) { void e;
          if (!canceled) setArbitrationOwner(null);
        }
      } catch (e) { void e;
        if (!canceled) { setFactoryOwner(null); setArbitrationOwner(null); }
      }
    };
    fetchOwners();
    return () => { canceled = true; };
  }, [contractAddress, provider, signer, chainId]);

  // Poll pending evidence queue count for badge
  useEffect(() => {
    let mounted = true;
    const svc = new ContractService(provider, signer, chainId);
    const refresh = async () => {
      try {
        const c = svc.getPendingEvidenceCount();
        if (mounted) setPendingCount(c);
      } catch (e) { void e;}
    };
    refresh();
    const iv = setInterval(refresh, 5000);
    return () => { mounted = false; clearInterval(iv); };
  }, [provider, signer, chainId]);

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
        try {
          const amt = ethers.formatEther(amount);
          setTransactionHistory(evts => [{ type:'RentPaid', amount: amt, data: { tenant, amount: amt }, txHash: event.transactionHash, hash: event.transactionHash, date: new Date().toLocaleString(), new:true }, ...evts.map(e=>({...e,new:false}))]);
        } catch (e) { void e;
          setTransactionHistory(evts => [{ type:'RentPaid', data:{ tenant, amount }, txHash:event.transactionHash, new:true }, ...evts.map(e=>({...e,new:false}))]);
        }
        // Refresh escrow/withdrawable balances after rent paid
        try { refreshBalances(); } catch (e) { void e; console.debug('refreshBalances after RentPaid failed', e); }
      };
      contractInstance.on('RentPaid', rentPaidHandler);
      listeners.push(() => contractInstance.off('RentPaid', rentPaidHandler));
      
      const depositHandler = (by, amount, total, event) => {
        try {
          const amt = ethers.formatEther(amount);
          const tot = ethers.formatEther(total);
          setTransactionHistory(evts => [{ type:'SecurityDepositPaid', amount: amt, data:{ by, amount: amt, total: tot }, txHash:event.transactionHash, hash:event.transactionHash, date: new Date().toLocaleString(), new:true }, ...evts.map(e=>({...e,new:false}))]);
        } catch (e) { void e;
          setTransactionHistory(evts => [{ type:'SecurityDepositPaid', data:{ by, amount, total }, txHash:event.transactionHash, new:true }, ...evts.map(e=>({...e,new:false}))]);
        }
        // refresh balances so UI shows updated party deposit / escrow
        try { refreshBalances(); } catch (e) { void e; console.debug('refreshBalances after DepositPaid failed', e); }
      };
      contractInstance.on('SecurityDepositPaid', depositHandler);
      listeners.push(() => contractInstance.off('SecurityDepositPaid', depositHandler));
      
      const disputeHandler = (caseId, initiator, disputeType, requestedAmount, event) => {
        try {
          const req = ethers.formatEther(requestedAmount);
          setTransactionHistory(evts => [{ type:'DisputeReported', amount: req, data:{ caseId: caseId.toString(), initiator, disputeType: disputeType.toString(), requestedAmount: req }, txHash:event.transactionHash, hash:event.transactionHash, date: new Date().toLocaleString(), new:true }, ...evts.map(e=>({...e,new:false}))]);
        } catch (e) { void e;
          setTransactionHistory(evts => [{ type:'DisputeReported', data:{ caseId, initiator, disputeType, requestedAmount }, txHash:event.transactionHash, new:true }, ...evts.map(e=>({...e,new:false}))]);
        }
      };
      contractInstance.on('DisputeReported', disputeHandler);
      listeners.push(() => contractInstance.off('DisputeReported', disputeHandler));

      // Cancellation-related events: refresh state so UI updates when approvals happen off-band
      const cancelInitiatedHandler = (initiator, effectiveAt, event) => {
        try {
          console.log('[ContractModal] CancellationInitiated event', { initiator, effectiveAt });
        } catch (e) { void e; }
        try { refreshBalances(); } catch (e) { void e; }
        try { loadContractData(); } catch (e) { void e; }
      };
      contractInstance.on('CancellationInitiated', cancelInitiatedHandler);
      listeners.push(() => contractInstance.off('CancellationInitiated', cancelInitiatedHandler));

      const cancelApprovedHandler = (approver, event) => {
        try {
          console.log('[ContractModal] CancellationApproved event', { approver });
        } catch (e) { void e; }
        try { refreshBalances(); } catch (e) { void e; }
        try { loadContractData(); } catch (e) { void e; }
      };
      contractInstance.on('CancellationApproved', cancelApprovedHandler);
      listeners.push(() => contractInstance.off('CancellationApproved', cancelApprovedHandler));

      const cancelFinalizedHandler = (finalizer, event) => {
        try {
          console.log('[ContractModal] CancellationFinalized event', { finalizer });
        } catch (e) { void e; }
        try { refreshBalances(); } catch (e) { void e; }
        try { loadContractData(); } catch (e) { void e; }
      };
      contractInstance.on('CancellationFinalized', cancelFinalizedHandler);
      listeners.push(() => contractInstance.off('CancellationFinalized', cancelFinalizedHandler));
      
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
          console.error('Error during event listener cleanup:', error);
        }
      });
      };
  }, [contractAddress, provider, refreshBalances]);

  // Confirmation modal handlers
  const _openConfirm = (amountEth, action) => {
void _openConfirm;
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
    } catch (e) { void e;
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
        // Set a default without reading feeToSend from outer scope
        setFeeToSend(prev => prev ?? feeEth);
      } else {
        setFeeDueEth(null);
      }
    } catch (err) {
      console.debug('fee calculation failed', err);
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
  const _contractService = new ContractService(provider, signer, chainId);
    const receipt = await _contractService.payRent(contractAddress, paymentAmount);
      
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
    } catch (e) { void e;
      console.error('Withdraw failed', e);
      alert(`Withdraw failed: ${e?.reason || e?.message || e}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRentSign = async () => {
    if (!contractDetails || !contractDetails.landlord || !contractDetails.tenant || typeof contractDetails.isActive === 'undefined' || !contractDetails.signatures) {
      // Button will be disabled if required fields are missing; no alert needed
      return;
    }
    // Log provider/signer/account for debugging
    console.log('Provider:', provider);
    console.log('Signer:', signer);
    console.log('Account:', account);
    // Check signer validity before write actions
    if (!signer || typeof signer.signTypedData !== 'function') {
      console.error('Invalid signer!', signer);
      alert('Cannot sign contract: invalid wallet signer. Please reconnect your wallet.');
      return;
    }
    setRentSigning(true);
    try {
  const _contractService = new ContractService(provider, signer, chainId);

      // Try to load any incoming dispute JSON for this contract from storage
      let incoming = null;
      try {
        const key1 = `incomingDispute:${contractAddress}`;
        const key2 = `incomingDispute:${String(contractAddress).toLowerCase()}`;
        incoming = localStorage.getItem(key1) || localStorage.getItem(key2) || sessionStorage.getItem('incomingDispute');
      } catch (err) { void err;
        incoming = null;
      }

      // If there's an incoming dispute stored for this contract, show the appeal modal.
      if (incoming) {
        let obj = null;
        try {
          obj = JSON.parse(incoming);
        } catch (err) { void err;
            console.error('Malformed incoming dispute JSON', err, incoming);
            alert('Stored dispute data is malformed.');
            return;
          }
        setAppealData(obj);
        try {
          const key = `appealEvidence:${String(contractAddress).toLowerCase()}`;
          const raw2 = localStorage.getItem(key);
          if (raw2) {
            const arr2 = JSON.parse(raw2 || '[]');
            setAppealEvidenceList(Array.isArray(arr2) ? arr2 : []);
          } else {
            setAppealEvidenceList([]);
          }
        } catch (err) { void err;
          setAppealEvidenceList([]);
        }
        setShowAppealModal(true);
        return;
      }

      // No incoming dispute: proceed with signing the rent contract
      try {
        const svc = new ContractService(provider, signer, chainId);
  const receipt = await svc.signRent(contractAddress);
  alert(`✅ Contract signed on-chain. Tx: ${receipt.transactionHash || receipt.transactionHash || receipt.hash || ''}`);
  // Optimistically mark this wallet as signed so the UI disables the button immediately
  setRentAlreadySigned(true);
  // Refresh contract details to pick up fullySigned if the counterparty already signed
  await loadContractData();
      } catch (signErr) {
        console.error('Failed to sign rent contract:', signErr);
        alert(`Failed to sign contract: ${signErr?.message || signErr}`);
      }
    } finally {
      setRentSigning(false);
    }
  };

  // Pending evidence modal actions
  const openPendingModal = async () => {
    try {
      setPendingModalOpen(true);
      const svc = new ContractService(provider, signer, chainId);
      const q = svc.getPendingEvidenceQueue() || [];
      setPendingQueue(q);
      setPendingCount(q.length);
    } catch (e) { void e;
      console.error('Failed to open pending modal', e);
    }
  };

  const handleRetryPending = async (id) => {
    try {
      const svc = new ContractService(provider, signer, chainId);
      await svc.retryPendingEvidence(id);
      const q = svc.getPendingEvidenceQueue() || [];
      setPendingQueue(q);
      setPendingCount(q.length);
      alert('Retry attempted; check logs for result.');
    } catch (e) { void e;
      alert('Retry failed: ' + (e?.message || e));
    }
  };

  const handleRemovePending = async (id) => {
    try {
      const svc = new ContractService(provider, signer, chainId);
      svc.removePendingEvidence(id);
      const q = svc.getPendingEvidenceQueue() || [];
      setPendingQueue(q);
      setPendingCount(q.length);
    } catch (e) { void e;
      alert('Remove failed: ' + (e?.message || e));
    }
  };

  const _handleFinalizeCancellation = async () => {
void _handleFinalizeCancellation;
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
        } catch (_) { void _; arbAddr = null; }
      }
      
      if (!arbAddr) {
        try {
          const maybe = await getContractAddress(chainId, 'ArbitrationService');
          if (maybe) arbAddr = maybe;
        } catch (_) { void _;}
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
    } catch (e) { void e;
      console.error('Finalize failed:', e);
      alert(`Failed to finalize: ${e?.reason || e?.message || e}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Direct mutual finalize: call the template's finalizeMutualCancellation() entrypoint.
  // This path requires both parties to have approved and does NOT use the ArbitrationService.
  const _handleFinalizeMutual = async () => {
    try {
      if (!confirm('Finalize mutual cancellation on-contract? This will deactivate the contract.')) return;
      setActionLoading(true);
      const service = new ContractService(provider, signer, chainId);
      const rentForWrite = await service.getEnhancedRentContractForWrite(contractAddress);
      if (!rentForWrite || typeof rentForWrite.finalizeMutualCancellation !== 'function') {
        alert('This contract does not support direct mutual finalize. Use ArbitrationService or ensure both parties are on a compatible template.');
        setActionLoading(false);
        return;
      }

      // Call finalizeMutualCancellation directly
      const tx = await rentForWrite.finalizeMutualCancellation();
      const receipt = await tx.wait();
      alert(`✅ Mutual cancellation finalized\nTransaction: ${receipt.transactionHash || receipt.hash}`);
      await loadContractData();
    } catch (e) { void e;
      console.error('Direct mutual finalize failed:', e);
      alert('Direct mutual finalize failed: ' + (e?.reason || e?.message || e));
    } finally {
      setActionLoading(false);
    }
  };

  // NDA actions
  const _handleNdaSign = async () => {
void _handleNdaSign;
    try {
      setActionLoading(true);
      const service = new ContractService(provider, signer, chainId);
      await service.signNDA(contractAddress);
      alert('Signed NDA');
      await loadContractData();
    } catch (e) { void e;
      alert(`Failed to sign: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
  };

  const _handleNdaDeposit = async (amount) => {
void _handleNdaDeposit;
    try {
      setActionLoading(true);
      const service = new ContractService(provider, signer, chainId);
      await service.ndaDeposit(contractAddress, amount);
      alert('Deposit successful');
      await loadContractData();
    } catch (e) { void e;
      alert(`Deposit failed: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
  };

  const _handleNdaWithdraw = async (amount) => {
void _handleNdaWithdraw;
    try {
      setActionLoading(true);
      const service = new ContractService(provider, signer, chainId);
      await service.ndaWithdraw(contractAddress, amount);
      alert('Withdraw successful');
      await loadContractData();
    } catch (e) { void e;
      alert(`Withdraw failed: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
  };

  const _handleNdaReport = async (offender, penalty, evidence) => {
void _handleNdaReport;
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
    } catch (e) { void e;
      alert(`Report failed: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
  };

  const _handleNdaDeactivate = async () => {
    try {
      setActionLoading(true);
      const service = new ContractService(provider, signer, chainId);
      await service.ndaDeactivate(contractAddress, 'User action');
      alert('NDA deactivated');
      await loadContractData();
    } catch (e) { void e;
      alert(`Deactivate failed: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
  };

  const _handleNdaResolveByArbitrator = async () => {
void _handleNdaResolveByArbitrator;
    alert('Resolve action must be performed by the platform arbitrator via ArbitrationService');
  };

  const _submitDisputeForm = async (payloadOverride) => {
      // If both parties already approved (mutual) prefer calling the template's
      // `finalizeMutualCancellation()` directly — it's the expected path for mutual
      // cancellations and avoids needing the ArbitrationService.
      try {
        const approvals = contractDetails?.cancellation?.approvals || {};
        const bothApproved = !!(approvals.landlord && approvals.tenant);
        const requireMutual = !!(contractDetails?.cancellation?.requireMutualCancel || contractDetails?.cancellation?.requireMutual);

        const fee = feeToSend ? feeToSend : '0';
        const feeWei = fee ? ethers.parseEther(String(fee)) : 0n;

        if (bothApproved || requireMutual) {
          try {
            const rentForWrite = await service.getEnhancedRentContractForWrite(contractAddress);
            if (rentForWrite && typeof rentForWrite.finalizeMutualCancellation === 'function') {
              // Call direct mutual finalize on the template (preferred).
              const tx = await rentForWrite.finalizeMutualCancellation();
              const receipt = await tx.wait();
              alert(`✅ Cancellation finalized (mutual)\nTransaction: ${receipt.transactionHash || receipt.hash}`);
              await loadContractData();
              setActionLoading(false);
              return;
            }
          } catch (inner) {
            console.debug('Direct finalizeMutualCancellation attempt failed, falling back to ArbitrationService path', inner);
            // fallthrough to ArbitrationService
          }
        }

        // Fallback: finalize via ArbitrationService (existing behavior)
        const arbAddress = contractDetails?.arbitrationService || null;
        let arbAddr = arbAddress;
        if (!arbAddr) {
          try {
            const resp = await fetch('/utils/contracts/ContractFactory.json');
            if (resp && resp.ok) {
              const cf = await resp.json();
              arbAddr = cf?.contracts?.ArbitrationService || null;
            }
          } catch (_) { void _; arbAddr = null; }
        }
        if (!arbAddr) {
          try {
            const maybe = await getContractAddress(chainId, 'ArbitrationService');
            if (maybe) arbAddr = maybe;
          } catch (_) { void _; }
        }

        if (!arbAddr || arbAddr === 'MISSING_ARBITRATION_SERVICE' || arbAddr === ethers.ZeroAddress) {
          alert('No ArbitrationService configured for this contract or frontend. Run the deploy script with DEPLOY_ARBITRATION=true to add one.');
          setActionLoading(false);
          return;
        }

        const accountAddr = account ? account.toLowerCase() : null;
        const isCallerLandlord = accountAddr && contractDetails?.landlord && accountAddr === contractDetails.landlord.toLowerCase();

        // Authorization check: calling the ArbitrationService finalize entrypoints requires
        // the connected signer to be the service owner or the configured factory. Avoid
        // attempting the call if the current account is not authorized to prevent an
        // unnecessary revert (we'll inform the user instead).
        try {
          const respAb = await fetch('/utils/contracts/ArbitrationService.json');
          if (respAb && respAb.ok) {
            const abj = await respAb.json();
            const arbAbi = abj.abi || abj;
            const arbRead = new ethers.Contract(arbAddr, arbAbi, provider || (service && service._providerForRead && service._providerForRead()));
            const ownerAddr = (await arbRead.owner().catch(() => null)) || null;
            const factoryAddr = (await arbRead.factory().catch(() => null)) || null;
            const acct = account ? account.toLowerCase() : null;
            const isOwner = ownerAddr && acct === String(ownerAddr).toLowerCase();
            const isFactory = factoryAddr && acct === String(factoryAddr).toLowerCase();
            if (!isOwner && !isFactory) {
              alert('ArbitrationService finalization must be performed by the service owner or factory account. Switch to the arbitrator account or use the mutual finalize path.');
              setActionLoading(false);
              return;
            }
          }
        } catch (authErr) { void authErr; /* ignore and continue to attempt - service may still revert */ }

        let receipt;
        if (isCallerLandlord) {
          receipt = await service.finalizeByLandlordViaService(arbAddr, contractAddress, feeWei);
        } else {
          receipt = await service.finalizeCancellationViaService(arbAddr, contractAddress, feeWei);
        }

        alert(`✅ Cancellation finalized\nTransaction: ${receipt.transactionHash || receipt.hash}`);
        await loadContractData();
      try {
        const svc = new ContractService(provider, signer, chainId);
        const escrow = await svc.getEscrowBalance(targetAddress).catch(() => 0n);
        const deposit = account ? await svc.getPartyDeposit(targetAddress, account).catch(() => 0n) : 0n;
        const available = BigInt(escrow || 0n) + BigInt(deposit || 0n);
        if (amountWei > 0n && BigInt(amountWei) > available) {
          const availableEth = ethers.formatEther(available);
          const requestedEth = ethers.formatEther(amountWei);
          const ok = confirm(`Requested amount ${requestedEth} ETH exceeds available on-chain funds (${availableEth} ETH).\nYou may top up escrow or continue to submit (the arbitrator may award a judgement for any shortfall). Continue anyway?`);
          if (!ok) {
            setActionLoading(false);
            return null;
          }
        }
      } catch (e) { void e;
        // ignore balance check failures - allow submission
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

      // Build canonical payload and POST signed copy to server for archival (EIP-191)
      try {
        if (signer && account) {
          // Build payload using agreed final schema
          const contractTypeMap = (t) => {
            if (!t) return 'other';
            const lower = String(t).toLowerCase();
            if (lower.includes('rent') || lower.includes('rental')) return 'rental';
            if (lower.includes('nda')) return 'nda';
            return 'other';
          };
          const plaintiff = account || null;
          let defendant = null;
          try {
            if (effectiveDetails?.type === 'Rental') {
              defendant = (plaintiff && effectiveDetails.landlord && plaintiff.toLowerCase() === effectiveDetails.tenant?.toLowerCase()) ? effectiveDetails.landlord : (effectiveDetails.landlord || effectiveDetails.tenant || null);
            } else {
              defendant = (effectiveDetails && (effectiveDetails.landlord || effectiveDetails.tenant)) ? (effectiveDetails.landlord || effectiveDetails.tenant) : null;
            }
          } catch (_) { void _; defendant = null; }

          const canonicalPayloadForServer = {
            contractAddress: String(targetAddress),
            contractType: contractTypeMap(effectiveDetails?.type),
            plaintiff: plaintiff,
            defendant: defendant,
            // Include full transaction history objects so the server stores logs together with the complaint
            txHistory: (transactionHistory && Array.isArray(transactionHistory)) ? transactionHistory.slice(0,200).map(t => typeof t === 'string' ? t : t) : [],
            complaint: (disputeForm.evidence && !/^0x[0-9a-fA-F]{64}$/.test(disputeForm.evidence)) ? disputeForm.evidence : null,
            requestedAmount: disputeForm.amountEth ? String(disputeForm.amountEth) : null
            ,contractBalance: contractBalanceWei ? String(ethers.formatEther(contractBalanceWei)) : '0'
          };

          // Minimal client-side validation (reduced schema)
          const errs = [];
          if (!/^0x[0-9a-fA-F]{40}$/.test(canonicalPayloadForServer.contractAddress)) errs.push('Invalid contractAddress');
          try { if (plaintiff && !ethers.isAddress(plaintiff)) errs.push('Invalid plaintiff address'); } catch (e) { void e;}
          try { if (defendant && !ethers.isAddress(defendant)) errs.push('Invalid defendant address'); } catch (e) { void e;}
          if ((!canonicalPayloadForServer.txHistory || canonicalPayloadForServer.txHistory.length === 0) && !canonicalPayloadForServer.complaint) errs.push('Either txHistory must be present or complaint required');
          if (canonicalPayloadForServer.requestedAmount && !/^[0-9]+(\.[0-9]+)?$/.test(String(canonicalPayloadForServer.requestedAmount))) errs.push('requestedAmount must be numeric');
          if (errs.length) {
            console.warn('Payload validation failed', errs);
            // still attempt to continue but warn
          }

          const signedPayloadStr = canonicalize(canonicalPayloadForServer);
          // EIP-191 signMessage
          let sig191 = null;
          try {
            sig191 = await signer.signMessage(signedPayloadStr);
          } catch (e) { void e;
            console.error('EIP-191 sign failed', e);
            sig191 = null;
          }

          if (sig191) {
              try {
              const resp = await fetch('/api/submit-appeal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contractAddress: targetAddress, signedPayload: signedPayloadStr, signature: sig191, signerAddress: account, complaintCid: evidenceRef, metadata: {}, encryptToAdmin: false })
              });
              if (resp && resp.ok) {
                const parsed = await resp.json();
                if (parsed && parsed.evidenceRef) {
                  evidenceRef = parsed.evidenceRef;
                }
              } else {
                console.warn('Server submit-appeal returned non-ok', resp && resp.status);
              }
            } catch (e) { void e;
              console.error('submit-appeal POST failed', e);
            }
          }
        }
      } catch (e) { void e;
        console.error('Failed to sign/submit canonical payload to server', e);
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
      } catch (e) { void e;
        console.warn('Failed to persist per-contract incomingDispute', e);
      }

      // Attempt to anchor the returned evidenceRef on-chain by calling submitEvidenceWithSignature
      if (evidenceRef && signer) {
        (async () => {
          try {
            // Build a small canonical payload (reduced schema) to compute contentDigest
            const contractTypeMap = (t) => {
              if (!t) return 'other';
              const lower = String(t).toLowerCase();
              if (lower.includes('rent') || lower.includes('rental')) return 'rental';
              if (lower.includes('nda')) return 'nda';
              return 'other';
            };
            const plaintiffP = account || null;
            let defendantP = null;
            try {
              if (effectiveDetails?.type === 'Rental') {
                defendantP = (plaintiffP && effectiveDetails.landlord && plaintiffP.toLowerCase() === effectiveDetails.tenant?.toLowerCase()) ? effectiveDetails.landlord : (effectiveDetails.landlord || effectiveDetails.tenant || null);
              } else {
                defendantP = (effectiveDetails && (effectiveDetails.landlord || effectiveDetails.tenant)) ? (effectiveDetails.landlord || effectiveDetails.tenant) : null;
              }
            } catch (_) { void _; defendantP = null; }

            const canonicalPayload = {
              contractAddress: targetAddress,
              contractType: contractTypeMap(effectiveDetails?.type),
              plaintiff: plaintiffP,
              defendant: defendantP,
              // Keep full objects here as well for a complete archival payload
              txHistory: transactionHistory ? transactionHistory.slice(0, 200).map(t => typeof t === 'string' ? t : t) : [],
              complaint: (disputeForm.evidence && !/^0x[0-9a-fA-F]{64}$/.test(disputeForm.evidence)) ? disputeForm.evidence : null,
              requestedAmount: disputeForm.amountEth ? String(disputeForm.amountEth) : null
            };

            const canon = canonicalize(canonicalPayload);
            const contentDigest = computeContentDigest(canon);

            const contractInfo = { chainId: Number(chainId || 0), verifyingContract: targetAddress };
            const recipients = [];
            const recipientsHash = hashRecipients(recipients);

            const evidenceData = { caseId: caseId != null ? Number(caseId) : 0, contentDigest, recipients, cid: String(evidenceRef).replace(/^helia:\/\//i, '') };
            const signature = await signEvidenceEIP712(evidenceData, contractInfo, signer);

            try {
              const contractWithSigner = new ethers.Contract(targetAddress, EnhancedRentContractJson.abi, signer);
              if (typeof contractWithSigner.submitEvidenceWithSignature === 'function') {
                const tx = await contractWithSigner.submitEvidenceWithSignature(
                  evidenceData.caseId,
                  evidenceData.cid,
                  evidenceData.contentDigest,
                  recipientsHash,
                  signature
                );
                await tx.wait();
                console.log('[submitDisputeForm] on-chain evidence recorded', tx.hash);
              } else {
                console.warn('[submitDisputeForm] contract does not support submitEvidenceWithSignature');
              }
            } catch (onChainErr) {
              console.error('Failed to submit evidence on-chain:', onChainErr);
            }
          } catch (e) { void e;
            console.error('Failed to compute/sign canonical payload for on-chain anchor:', e);
          }
        })();
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
      try { return ethers.formatEther(bond); } catch (_){ void _; return String(bond); }
    } catch (_) { void _; return '0'; }
  })();

  // Validate that requested amount does not exceed on-chain contract balance
  const requestedAmountExceedsContract = useMemo(() => {
    try {
      if (!disputeForm || !disputeForm.amountEth) return false;
      // parseEther may throw on invalid input; wrap safely
      const reqWei = ethers.parseEther(String(disputeForm.amountEth || '0'));
      const cb = BigInt(contractBalanceWei || 0n);
      return BigInt(reqWei) > cb;
    } catch (e) { void e;
      // If parse failed, consider it not exceeding (other validation handles numeric format)
      return false;
    }
  }, [disputeForm, contractBalanceWei]);

  const _handleCreateDispute = async () => {
void _handleCreateDispute;
    try {
      setActionLoading(true);
      const svc = new ArbitrationService(signer, chainId);
      const { disputeId } = await svc.createDisputeForCase(contractAddress, createDisputeCaseId, createDisputeEvidence);
      alert(`Dispute created${disputeId != null ? ` (ID ${disputeId})` : ''}`);
    } catch (e) { void e;
      alert(`Create dispute failed: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
  };

 

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
    } catch (e) { void e;
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
    } catch (e) { void e;
      alert(`Failed: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
  };

  const handleApproveCancel = async () => {
    try {
      setActionLoading(true);
      const service = new ContractService(provider, signer, chainId);
      await service.approveCancellation(contractAddress);
      alert('Cancellation approved');
      // Optimistically update UI to reflect this approval immediately (helps when read-calls lag or fail)
      try {
        setContractDetails(prev => {
          if (!prev) return prev;
          const updated = { ...prev };
          updated.cancellation = { ...updated.cancellation };
          updated.cancellation.approvals = { ...updated.cancellation.approvals };
          try {
            if (isLandlord) updated.cancellation.approvals.landlord = true;
            if (isTenant) updated.cancellation.approvals.tenant = true;
          } catch (e) { void e; }
          return updated;
        });
      } catch (e) { void e; }
      // Refresh balances and reload authoritative state
      try { await refreshBalances(); } catch (e) { void e; }
      await loadContractData();
    } catch (e) { void e;
      alert(`Failed: ${e?.reason || e?.message}`);
    } finally { setActionLoading(false); }
  };

  // Start cancellation flow and optionally upload appeal evidence first
  // startCancellationWithAppeal flow removed from UI. Use ContractService.startCancellationWithAppeal directly when needed.

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(contractAddress);
      alert('Address copied to clipboard');
    } catch (_) { void _;
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
    } catch (_) { void _;
      try {
        const input = document.createElement('input');
        input.value = txHash;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        alert('Transaction hash copied to clipboard');
      } catch (e) { void e;
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
          } catch (_) { void _; json = null; }
        }
      }
      
      if (!json) {
        alert('No appeal found for this contract');
        return;
      }
      
      const obj = JSON.parse(json);
      setAppealData(obj);
      // Load persisted appeal evidence refs for this contract as well
      try {
        const key = `appealEvidence:${String(contractAddress).toLowerCase()}`;
        const raw = localStorage.getItem(key);
        if (raw) {
          const arr = JSON.parse(raw || '[]');
          setAppealEvidenceList(Array.isArray(arr) ? arr : []);
        } else {
          setAppealEvidenceList([]);
        }
      } catch (e) { void e; setAppealEvidenceList([]); }
      setShowAppealModal(true);
    } catch (e) { void e;
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
    } catch (e) { void e;
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
    } catch (e) { void e;
      console.error('Clipboard fallback failed', e);
      return false;
    }
  };

  const _handleCopyComplaint = async () => {
void _handleCopyComplaint;
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
    } catch (e) { void e;
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
        } catch (e) { void e; return; }
        
        try {
          const plain = await decryptCiphertextJson(fetched, pk);
          setAdminDecrypted(plain);
        } catch (_) { void _;}
      } finally {
        setAdminAutoTried(true);
        setAdminDecryptBusy(false);
      }
    };
    
    tryAuto();
  }, [showAdminDecryptModal, adminAutoTried, adminCiphertextInput, adminPrivateKeyInput]);

  // Show spinner while an explicit wallet connection is in progress, or
  // if the provider is loading and we don't yet have provider/account.
  const shouldShowSpinner = (isConnecting || (loading && !provider && !account));
  if (shouldShowSpinner && !loadingTimedOut) {
    return <div style={{textAlign:'center',marginTop:'48px'}}><div className="loading-spinner" style={{marginBottom:'16px'}}></div>Connecting to wallet...</div>;
  }

  // If not loading but wallet/provider/account are missing, show a friendly fallback
  if (!provider || !account) {
    return (
      <div style={{textAlign:'center',marginTop:'48px'}}>
        <div style={{fontSize:16,marginBottom:12}}>Wallet not connected</div>
        <div style={{marginBottom:12}}><small>Please connect your Ethereum wallet to interact.</small></div>
        <div>
          <button className="btn-primary" onClick={() => { try { connectWallet && connectWallet(); } catch (e) { void e; console.error('connectWallet failed', e); } }}>Connect Wallet</button>
        </div>
      </div>
    );
  }

  // Debug UI toggle (helps inspect why landlord/tenant controls may be hidden)
  // Debug UI toggle (moved to top-level state declarations to satisfy hooks order)

  const handleExport = () => {
    try {
      DocumentGenerator.generatePDF({
        ...contractDetails,
        transactions: transactionHistory
      });
    } catch (e) { void e;
      const blob = new Blob([JSON.stringify({ contractDetails, transactionHistory }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `contract-${contractAddress}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };


  // Evidence tab removed

  // Debug contractDetails in render
  console.log('contractDetails in render:', contractDetails);
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Contract Management</h2>
          <div style={{display:'flex', gap:8, alignItems:'center'}}>
            <button className="btn-sm" onClick={() => setShowDebugPanel(s => !s)} style={{marginRight:6}}>Debug</button>
            <button className="btn-sm pending-button" onClick={openPendingModal} title="Pending evidence uploads" style={{marginRight:6}}>
              Pending
              {pendingCount > 0 && (
                <span className="pending-badge">{pendingCount}</span>
              )}
            </button>
            {hasAppeal && (
              <button className="btn-sm" onClick={handleShowAppeal} style={{marginRight:6}}>Show Appeal</button>
            )}
            <button className="modal-close" onClick={onClose}>
              <i className="fas fa-times"></i>
            </button>
          </div>

          <_ConfirmPayModal 
            open={confirmOpen} 
            title="Confirm dispute bond" 
            amountEth={confirmAmountEth} 
            details={`This will send the reporter bond to the contract (anti-spam).`} 
            onConfirm={onConfirmProceed} 
            onCancel={onConfirmCancel} 
            busy={confirmBusy} 
          />
          {/* Server pre-submit UI removed per UX decision. Use ContractService.startCancellationWithAppeal directly from other flows if needed. */}
          {/* Top-level quick actions removed to keep actions inside the Actions tab */}
        </div>

        {showDebugPanel && (
          <div className="debug-panel" style={{padding:8,background:'#111',color:'#fff',fontSize:12}}>
            <div><strong>Debug</strong></div>
            <div>account: {String(account)}</div>
            <div>isLandlord: {String(isLandlord)}</div>
            <div>isTenant: {String(isTenant)}</div>
            <div>factoryOwner: {String(factoryOwner || 'null')}</div>
            <div>creator: {String(creator || 'null')}</div>
            <div>arbitrationOwner: {String(arbitrationOwner || 'null')}</div>
            <div>rentCanSign: {String(rentCanSign)}</div>
            <div>rentAlreadySigned: {String(rentAlreadySigned)}</div>
            <div>fullySigned: {String(contractDetails?.signatures?.fullySigned || false)}</div>
            <div>readOnly prop: {String(readOnly)}</div>
            <div style={{marginTop:6}}>contractDetails snapshot:</div>
            <pre style={{whiteSpace:'pre-wrap',maxHeight:240,overflow:'auto',color:'#0f0'}}>{contractDetails ? JSON.stringify(contractDetails,null,2) : 'null'}</pre>
          </div>
        )}

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

        {/* Pending evidence modal (simple) */}
        {pendingModalOpen && (
          <div className="modal-overlay" style={{position:'fixed',zIndex:9999,background:'rgba(0,0,0,0.6)'}} onClick={() => setPendingModalOpen(false)}>
            <div className="modal-content" style={{maxWidth:720,margin:'40px auto',padding:12}} onClick={(e)=>e.stopPropagation()}>
              <h3>Pending evidence uploads ({pendingQueue.length})</h3>
              <div className="pending-list">
                {pendingQueue.length === 0 && <div className="pending-empty">No pending items.</div>}
                {pendingQueue.map(item => (
                  <div key={item.id} className="pending-item">
                    <div className="pending-meta">
                      <div className="pending-id"><strong>{item.id}</strong></div>
                      <div className="pending-digest">{item.digest || ''}</div>
                      <div className="pending-times">Created: <span style={{direction:'ltr', display:'inline-block'}}>{(() => {
                        const v = item.createdAt || Date.now();
                        try {
                          if (typeof v === 'number' || (!isNaN(Number(v)) && String(v).length > 9)) return new Date(Number(v)).toLocaleString();
                          const p = Date.parse(String(v));
                          if (!isNaN(p)) return new Date(p).toLocaleString();
                          return String(v) || new Date().toLocaleString();
                        } catch (e) { void e; return new Date().toLocaleString(); }
                      })()}</span></div>
                      <div className="pending-times">Attempts: {item.attempts || 0} &middot; Last: {item.lastAttemptAt ? new Date(item.lastAttemptAt).toLocaleString() : 'n/a'}</div>
                      {item.lastError && <div className="pending-error">Error: {String(item.lastError).slice(0,240)}</div>}
                    </div>
                    <div className="pending-actions">
                      <button className="btn-sm" onClick={() => handleRetryPending(item.id)}>Retry</button>
                      <button className="btn-sm" onClick={() => handleRemovePending(item.id)}>Remove</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{textAlign:'right',marginTop:8}}>
                <button className="btn-sm" onClick={() => setPendingModalOpen(false)}>Close</button>
              </div>
            </div>
          </div>
        )}
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
                    <span className="value">{contractDetails?.signatures?.fullySigned ? 'Yes' : 'No'}</span>
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
                <div className="actions-panel-grid">
                  <div>
                    {contractDetails.type === 'Rental' ? (
                      <div style={{display:'flex', flexDirection:'column', gap:'12px'}}>
                        <div style={{display:'flex', gap:'8px', flexWrap:'wrap'}}>
                        {contractDetails?.isActive && (
                         <button 
                            onClick={handleRentSign}
                            disabled={
                                readOnly ||
                                rentSigning ||
                                rentAlreadySigned || 
                                contractDetails?.signatures?.fullySigned ||
                                !rentCanSign ||
                                !contractDetails?.landlord ||
                                !contractDetails?.tenant ||
                                typeof contractDetails?.isActive === 'undefined' ||
                                !contractDetails?.signatures
                            }
                            className="btn-action primary"
                        >
                            {rentSigning ? <><span className="spinner" /> Signing...</> : rentAlreadySigned ? 'Signed' : 'Sign Contract'}
                          </button>
                        )}
                        {/* Allow landlord or tenant to initiate cancellation */}
                        {(isLandlord || isTenant) && contractDetails?.isActive && !contractDetails?.cancellation?.cancelRequested && (
                          <button className="btn-action" onClick={async () => {
                            try {
                              if (!confirm('Are you sure you want to initiate cancellation for this contract?')) return;
                              await handleInitiateCancel();
                            } catch (e) { void e; console.error('Initiate cancel failed', e); alert('Failed to initiate cancellation: ' + (e?.message || e)); }
                          }} disabled={readOnly || actionLoading}>
                            Initiate Cancellation
                          </button>
                        )}
                        {/* If cancellation was requested, allow other party to approve */}
                        {(isLandlord || isTenant) && contractDetails?.cancellation?.cancelRequested && (
                          (() => {
                            const isInitiator = (account && contractDetails?.cancellation?.cancelInitiator && account.toLowerCase() === contractDetails.cancellation.cancelInitiator.toLowerCase());
                            const isApprover = (account && contractDetails?.cancellation?.cancelInitiator && account.toLowerCase() !== contractDetails.cancellation.cancelInitiator.toLowerCase());
                            const approvals = contractDetails?.cancellation?.approvals || {};
                            const bothApproved = approvals.landlord && approvals.tenant;
                            // Debug: log cancellation control state to help diagnose rendering
                            try { console.debug('[ContractModal] cancellation controls', { account, cancelInitiator: contractDetails?.cancellation?.cancelInitiator, isInitiator, isApprover, approvals, bothApproved }); } catch (e) { void e; }
                            // If both parties approved, show preview/finalize controls; otherwise show approve/preview
                            if (bothApproved) {
                              return (
                                <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
                                  <div style={{padding:'6px 10px', border:'1px solid #d3e8ff', borderRadius:6, background:'#f0f8ff'}}>Both parties approved</div>
                                  <button className="btn-action" onClick={async () => {
                                    try {
                                      console.debug('[ContractModal] Show Cancellation Preview (bothApproved) clicked');
                                      // Use centralized fetch helper then open modal so behavior matches the other branch
                                      await fetchCancellationPreview();
                                      setShowCancelPreviewModal(true);
                                    } catch (e) { void e; console.error('Failed fetching/opening cancellation preview', e); }
                                  }} disabled={cancelPreviewLoading} title="View computed cancellation split">
                                    {cancelPreviewLoading ? 'Loading...' : 'Show Cancellation Preview'}
                                  </button>
                                  {isApprover && (
                                    <button className="btn-action primary" onClick={async () => {
                                      try {
                                        if (!confirm('Finalize mutual cancellation on-contract? This will deactivate the contract.')) return;
                                        await _handleFinalizeMutual();
                                      } catch (e) { void e; console.error('Finalize cancelled failed', e); alert('Failed to finalize: ' + (e?.message || e)); }
                                    }} disabled={readOnly || actionLoading}>
                                      Finalize Cancellation
                                    </button>
                                  )}
                                </div>
                              );
                            }
                            // default: not bothApproved yet — show approve + preview
                            return (
                              <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
                                {!isInitiator && (
                                  <button className="btn-action" onClick={async () => {
                                    try {
                                      if (!confirm('Approve cancellation? This confirms you agree to cancel the contract.')) return;
                                      await handleApproveCancel();
                                    } catch (e) { void e; console.error('Approve cancel failed', e); alert('Failed to approve cancellation: ' + (e?.message || e)); }
                                  }} disabled={readOnly || actionLoading}>
                                    Approve Cancellation
                                  </button>
                                )}
                                <button className="btn-action" onClick={async () => {
                                  try {
                                    console.debug('[ContractModal] Show Cancellation Preview clicked');
                                    // Always fetch latest preview and open modal
                                    await fetchCancellationPreview();
                                    setShowCancelPreviewModal(true);
                                  } catch (e) { void e; console.error('Failed opening cancellation preview modal', e); }
                                }} disabled={cancelPreviewLoading} title="View computed cancellation split">
                                  {cancelPreviewLoading ? 'Loading...' : 'Show Cancellation Preview'}
                                </button>
                              </div>
                            );
                          })()
                        )}

                        {/* Inline preview removed in favor of modal preview */}
                        {/* Allow landlord or tenant to submit an appeal/dispute */}
                        {(isLandlord || isTenant) && (
                          <button className="btn-action" onClick={async () => { try { setShowDisputeForm(true); } catch (e) { void e;console.error(e);} }} disabled={readOnly || actionLoading}>
                            Submit Appeal / Dispute
                          </button>
                        )}
                        {/* Start Cancel w/ Appeal removed per UX decision */}
                      </div>

                      {/* Policy editor: landlord-only */}
                      {isLandlord && (
                        <div style={{marginTop:8, padding:8, border:'1px solid #eee', borderRadius:6, background:'#fafafa'}}>
                          <div style={{fontSize:13, marginBottom:6}}><strong>Cancellation Policy (Landlord)</strong></div>
                          <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
                            <input className="text-input" type="number" placeholder="Notice period (days)" value={policyDraft.notice} onChange={e => setPolicyDraft(p => ({...p, notice: e.target.value}))} style={{width:160}} />
                            <input className="text-input" type="number" placeholder="Fee (bps)" value={policyDraft.feeBps} onChange={e => setPolicyDraft(p => ({...p, feeBps: e.target.value}))} style={{width:140}} />
                            <label style={{display:'flex', alignItems:'center', gap:6}}><input type="checkbox" checked={policyDraft.mutual} onChange={e => setPolicyDraft(p => ({...p, mutual: e.target.checked}))} /> Require mutual approval</label>
                            <button className="btn-action primary" onClick={handleSetPolicy} disabled={readOnly || actionLoading}>Set Policy</button>
                          </div>
                        </div>
                      )}

                      {!rentCanSign && !rentAlreadySigned && (
                        <small className="muted">Connect as landlord or tenant to sign.</small>
                      )}
                    </div>
                  ) : (
                    <button 
                      onClick={_handleNdaDeactivate}
                      disabled={readOnly || actionLoading || !contractDetails.isActive}
                      className="btn-action danger"
                    >
                      <i className="fas fa-ban"></i>
                      Deactivate NDA
                    </button>
                  )}
                    <button className="btn-action" onClick={handleCopyAddress}>
                      <i className="fas fa-copy"></i>
                      Copy Address
                    </button>
                  </div>

                  {/* Right column: compact export / info panel */}
                  <div className="export-panel">
                    <button className="btn-action" onClick={handleExport}>
                      <i className="fas fa-file-export"></i>
                      Export PDF
                    </button>
                    <div style={{marginTop: 12, color: '#666', fontSize: 13}}>Download contract as PDF</div>
                  </div>
                </div>
              </div>
            )}
            {/* Evidence tab removed per UX decision */}
          </div>

          
        ) : (!dataLoading && !contractDetails) ? (
          <div className="modal-error">
            <i className="fas fa-exclamation-triangle"></i>
            <p>Could not load contract details</p>
          </div>
        ) : null}

        {/* Cancellation preview modal (small) */}
        {showCancelPreviewModal && (
          <div className="appeal-overlay" onClick={() => { setShowCancelPreviewModal(false); setCancelPreviewObj(null); }}>
            <div className="appeal-modal" onClick={(e) => e.stopPropagation()} style={{maxWidth:520}}>
              <h3>Cancellation Preview</h3>
              <div style={{marginTop:8}}>
                {cancelPreviewLoading ? (
                  <div>Loading preview...</div>
                ) : cancelPreviewObj ? (
                  (() => {
                    try {
                      // Normalize values (BigInt) and safely compute merged share including fee paid to approver
                      const tenantRefundRaw = cancelPreviewObj.tenantRefund ?? 0n;
                      const landlordShareRaw = cancelPreviewObj.landlordShare ?? 0n;
                      const feeRaw = cancelPreviewObj.fee ?? 0n;
                      const feeRecipient = (cancelPreviewObj.feeRecipient || '')?.toLowerCase() || null;

                      // Determine which party receives the fee (approver / non-initiator)
                      const landlordAddr = contractDetails?.landlord ? String(contractDetails.landlord).toLowerCase() : null;
                      const tenantAddr = contractDetails?.tenant ? String(contractDetails.tenant).toLowerCase() : null;
                      const isInitiatorModal = account && contractDetails?.cancellation?.cancelInitiator && account.toLowerCase() === contractDetails.cancellation.cancelInitiator.toLowerCase();
                      const isApproverModal = account && contractDetails?.cancellation?.cancelInitiator && account.toLowerCase() !== contractDetails.cancellation.cancelInitiator.toLowerCase();

                      let tenantDisplay = BigInt(tenantRefundRaw || 0n);
                      let landlordDisplay = BigInt(landlordShareRaw || 0n);

                      if (feeRaw && feeRaw > 0n && feeRecipient) {
                        if (feeRecipient === landlordAddr) {
                          landlordDisplay = landlordDisplay + BigInt(feeRaw);
                        } else if (feeRecipient === tenantAddr) {
                          tenantDisplay = tenantDisplay + BigInt(feeRaw);
                        }
                      }

                      return (
                        <div style={{display:'flex', flexDirection:'column', gap:8}}>
                          <div><strong>Tenant refund:</strong> {fmtEth(tenantDisplay)} ETH{(feeRaw && feeRecipient === tenantAddr) ? ' (includes fee)' : ''}</div>
                          <div><strong>Landlord share:</strong> {fmtEth(landlordDisplay)} ETH{(feeRaw && feeRecipient === landlordAddr) ? ' (includes fee)' : ''}</div>
                          {/* Keep fee row for clarity when present */}
                          <div><strong>Fee:</strong> {fmtEth(feeRaw)} ETH</div>
                              <div><strong>Fee recipient:</strong> {cancelPreviewObj.feeRecipient ?? '—'}</div>
                              {/* Show cancellation policy summary so developer can see why fee may be zero */}
                              <div style={{marginTop:8, fontSize:13, color:'#444'}}>
                                <div>Policy fee (bps): <strong>{contractDetails?.cancellation?.cancellationFeeBps ?? 'n/a'}</strong></div>
                                <div>Cancel requested: <strong>{contractDetails?.cancellation?.cancelRequested ? 'yes' : 'no'}</strong></div>
                                <div>Escrow (ETH): <strong>{contractDetails?.totalDeposits ?? '0'}</strong></div>
                              </div>
                              {/* Debug: raw preview object (stringified BigInt -> string) */}
                              <details style={{marginTop:8}}>
                                <summary style={{cursor:'pointer'}}>Raw preview (debug)</summary>
                                <pre style={{whiteSpace:'pre-wrap', maxHeight:200, overflow:'auto'}}>{JSON.stringify({
                                  tenantRefund: String(cancelPreviewObj.tenantRefund || 0n),
                                  landlordShare: String(cancelPreviewObj.landlordShare || 0n),
                                  fee: String(cancelPreviewObj.fee || 0n),
                                  feeRecipient: cancelPreviewObj.feeRecipient || null
                                }, null, 2)}</pre>
                              </details>
                          <div style={{display:'flex', gap:8, marginTop:12}}>
                            <button className="btn-action" onClick={() => { setShowCancelPreviewModal(false); setCancelPreviewObj(null); }}>Close</button>
                            {isApproverModal && (
                              <button className="btn-action primary" onClick={async () => { try { await _handleFinalizeMutual(); setShowCancelPreviewModal(false); } catch (e) { void e; alert('Failed to finalize: ' + (e?.message || e)); } }} disabled={actionLoading}>Finalize Cancellation</button>
                            )}
                          </div>
                        </div>
                      );
                    } catch (e) { void e; return <div style={{color:'#666'}}>Preview unavailable</div>; }
                  })()
                ) : (
                  <div style={{color:'#666'}}>Preview unavailable</div>
                )}
              </div>
            </div>
          </div>
        )}

        {showDisputeForm && (
          <div className="dispute-form-overlay" onClick={() => setShowDisputeForm(false)}>
            <div className="dispute-form" onClick={(e) => e.stopPropagation()}>
              <h3>Report Dispute / Submit Appeal</h3>
              <p style={{marginTop:6, marginBottom:12}}>Provide a short description or link (CID) as evidence. The reporter bond will be calculated below.</p>

              <div style={{display:'flex', gap:12, marginBottom:10, alignItems:'center'}}>
                <div style={{fontSize:13}}>Escrow: <strong>{escrowBalanceWei ? ethers.formatEther(escrowBalanceWei) : '0'} ETH</strong></div>
                <div style={{fontSize:13}}>Contract balance: <strong>{contractBalanceWei ? ethers.formatEther(contractBalanceWei) : '0'} ETH</strong></div>
                <div style={{fontSize:13}}>Your deposit: <strong>{partyDepositWei ? ethers.formatEther(partyDepositWei) : '0'} ETH</strong></div>
              </div>

              <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:12}}>
                <input className="text-input" type="number" min="0" step="0.0001" value={topUpAmountEth} onChange={e => setTopUpAmountEth(e.target.value)} style={{width:140}} />
                <button className="btn-action" onClick={async () => {
                  try {
                    if (!topUpAmountEth || Number(topUpAmountEth) <= 0) { alert('Enter a positive amount'); return; }
                    if (!signer) { alert('Connect wallet to top up'); return; }
                    setActionLoading(true);
                    const svc = new ContractService(provider, signer, chainId);
                    const wei = ethers.parseEther(String(topUpAmountEth || '0'));
                    const tx = await svc.depositToEscrow(contractAddress, wei);
                    alert('Top-up transaction sent: ' + (tx.hash || tx.transactionHash || tx.hash));
                    try { await tx.wait?.(); } catch (_) { void _;}
                    await refreshBalances();
                    setTopUpAmountEth('0');
                  } catch (e) { void e;
                    console.error('Top-up failed', e);
                    alert('Top-up failed: ' + (e?.reason || e?.message || e));
                  } finally { setActionLoading(false); }
                }} disabled={actionLoading}>Top up escrow</button>
              </div>

              <label>Type</label>
              <select value={disputeForm.dtype} onChange={(e) => setDisputeForm(s => ({ ...s, dtype: Number(e.target.value) }))}>
                <option value={0}>Rent not paid</option>
                <option value={1}>Deposit dispute</option>
                <option value={2}>Property damage</option>
                <option value={3}>Other contractual breach</option>
                <option value={4}>General appeal / claim</option>
              </select>

              <label style={{marginTop:8}}>Requested amount (ETH)</label>
              <input type="number" step="any" className="text-input" value={disputeForm.amountEth} onChange={(e) => setDisputeForm(s => ({ ...s, amountEth: e.target.value }))} />
              {requestedAmountExceedsContract && (
                <div style={{color:'#a00', marginTop:6, fontSize:13}}>Requested amount exceeds the contract's ETH balance. Please enter a smaller amount or top up the contract.</div>
              )}

              <label style={{marginTop:8}}>Evidence (text, CID or digest)</label>
              <textarea className="text-input" rows={6} value={disputeForm.evidence} onChange={(e) => setDisputeForm(s => ({ ...s, evidence: e.target.value }))} />

              <div style={{marginTop:8, marginBottom:8}}><strong>Reporter bond estimate:</strong> <span style={{direction:'ltr', display:'inline-block'}}>{computedReporterBondEth} ETH</span></div>

              <div className="dispute-form-actions">
                <button className="btn-action secondary" onClick={() => setShowDisputeForm(false)} disabled={actionLoading}>Cancel</button>
                <button className="btn-action primary" onClick={async () => {
                  try {
                    // Build canonical preview and show modal for read-only confirmation before signing
                    const contractTypeMap = (t) => {
                      if (!t) return 'other';
                      const lower = String(t).toLowerCase();
                      if (lower.includes('rent') || lower.includes('rental')) return 'rental';
                      if (lower.includes('nda')) return 'nda';
                      return 'other';
                    };
                    const plaintiff = account || null;
                    let defendant = null;
                    try {
                      if (contractDetails?.type === 'Rental') {
                        defendant = (plaintiff && contractDetails.landlord && plaintiff.toLowerCase() === contractDetails.tenant?.toLowerCase()) ? contractDetails.landlord : (contractDetails.landlord || contractDetails.tenant || null);
                      } else {
                        defendant = (contractDetails && (contractDetails.landlord || contractDetails.tenant)) ? (contractDetails.landlord || contractDetails.tenant) : null;
                      }
                    } catch (_) { void _; defendant = null; }

                    const canonicalPayloadForServer = {
                      contractAddress: String(contractAddress),
                      contractType: contractTypeMap(contractDetails?.type),
                      plaintiff: plaintiff,
                      defendant: defendant,
                      // When preparing the canonical payload for on-chain anchoring include the full history objects
                      txHistory: (transactionHistory && Array.isArray(transactionHistory)) ? transactionHistory.slice(0,200).map(t => typeof t === 'string' ? t : t) : [],
                      complaint: (disputeForm.evidence && !/^0x[0-9a-fA-F]{64}$/.test(disputeForm.evidence)) ? disputeForm.evidence : null,
                      requestedAmount: disputeForm.amountEth ? String(disputeForm.amountEth) : null,
                      contractBalance: contractBalanceWei ? String(ethers.formatEther(contractBalanceWei)) : '0'
                    };
                    const canonStr = canonicalize(canonicalPayloadForServer);
                    // Basic validation
                    const errs = [];
                    if (!/^0x[0-9a-fA-F]{40}$/.test(canonicalPayloadForServer.contractAddress)) errs.push('Invalid contractAddress');
                    try { if (plaintiff && !ethers.isAddress(plaintiff)) errs.push('Invalid plaintiff address'); } catch (e) { void e;}
                    try { if (defendant && !ethers.isAddress(defendant)) errs.push('Invalid defendant address'); } catch (e) { void e;}
                    if ((!canonicalPayloadForServer.txHistory || canonicalPayloadForServer.txHistory.length === 0) && !canonicalPayloadForServer.complaint) errs.push('Either txHistory must be present or complaint required');
                    if (canonicalPayloadForServer.requestedAmount && !/^[0-9]+(\.[0-9]+)?$/.test(String(canonicalPayloadForServer.requestedAmount))) errs.push('requestedAmount must be numeric');
                    if (requestedAmountExceedsContract) {
                      setPreviewError('Requested amount exceeds contract balance.');
                      console.warn('Preview blocked: requested amount exceeds contract balance');
                    } else if (errs.length) {
                      setPreviewError('Validation issues: ' + errs.join('; '));
                      console.warn('Preview payload validation failed', errs);
                    } else {
                      setPreviewPayloadObj(canonicalPayloadForServer);
                      setPreviewPayloadStr(canonStr);
                      setPreviewError(null);
                      setShowPreviewModal(true);
                    }
                  } catch (e) { void e;
                    console.error('Failed to build preview:', e);
                    alert('Failed to build preview: ' + (e?.message || e));
                  }
                }} disabled={actionLoading}>{actionLoading ? 'Submitting...' : 'Preview & Sign'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Inline modal for appeal evidence collection */}
      {/* Appeal evidence modal removed */}

      {/* Appeal modal */}
      {showAppealModal && appealData && (
        <div className="appeal-overlay" onClick={() => { setShowAppealModal(false); }}>
          <div className="appeal-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <h3>Appeal</h3>
              <div><small>Submitted: {appealData.createdAt}</small></div>
            </div>
            <div style={{marginTop:8}}>
              <div><strong>Case ID:</strong> {appealData.caseId || 'N/A'}</div>
              <div><strong>Reporter:</strong> {appealData.reporter || 'N/A'}</div>
              <div style={{marginTop:8}}><strong>Evidence / Ref:</strong></div>
              <div style={{marginTop:6}}>
                {/* Show textual evidence inline when available */}
                {appealData.evidence && typeof appealData.evidence === 'string' && !/^0x[0-9a-fA-F]{64}$/.test(appealData.evidence) ? (
                  <pre style={{whiteSpace:'pre-wrap',background:'#f7f7f7',padding:8,borderRadius:6}}>{appealData.evidence}</pre>
                ) : null}
              </div>
              <div style={{marginTop:12}}>
                <strong>Persisted Appeal Evidence for this contract</strong>
                <AppealEvidenceList entries={appealEvidenceList} />
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Preview & Sign modal (read-only canonical payload) */}
      {showPreviewModal && (
        <div className="appeal-overlay" onClick={() => { setShowPreviewModal(false); }}>
          <div className="appeal-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <h3>Preview Canonical Payload (read-only)</h3>
              <div>
                <small>{previewPayloadObj?.contractAddress || ''}</small>
              </div>
            </div>
            <div style={{marginTop:8}}>
              <pre style={{whiteSpace:'pre-wrap',background:'#f7f7f7',padding:8,borderRadius:6, maxHeight:320, overflow:'auto'}}>{previewPayloadStr}</pre>
              {previewError && <div style={{color:'crimson',marginTop:8}}>{previewError}</div>}
              <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:12}}>
                <button className="btn-action" onClick={() => setShowPreviewModal(false)}>Cancel</button>
                <button className="btn-action primary" onClick={async () => {
                  try {
                    setPreviewBusy(true);
                    // EIP-191 sign
                    if (!signer || !previewPayloadStr) throw new Error('Signer or payload missing');
                    let sig191 = null;
                    try { sig191 = await signer.signMessage(previewPayloadStr); } catch (e) { void e; throw new Error('EIP-191 signing failed: ' + (e?.message || e)); }

                    // POST to server /api/submit-appeal
                    let evidenceRefFromServer = null;
                      try {
                      const resp = await fetch('/api/submit-appeal', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ contractAddress, signedPayload: previewPayloadStr, signature: sig191, signerAddress: account, complaintCid: null, metadata: {}, encryptToAdmin: false })
                      });
                      if (!resp.ok) {
                        const txt = await resp.text().catch(() => '');
                        throw new Error('Server returned ' + resp.status + ' ' + txt);
                      }
                      const parsed = await resp.json();
                      evidenceRefFromServer = parsed && parsed.evidenceRef ? parsed.evidenceRef : null;
                    } catch (e) { void e;
                      throw new Error('submit-appeal failed: ' + (e?.message || e));
                    }

                    // Attempt to anchor CID on-chain (EIP-712 + submitEvidenceWithSignature)
                    if (evidenceRefFromServer && signer) {
                      try {
                        const contentDigest = computeContentDigest(previewPayloadObj);
                        const contractInfo = { chainId: Number(chainId || 0), verifyingContract: contractAddress };
                        const recipients = [];
                        const evidenceData = { caseId: 0, contentDigest, recipients, cid: String(evidenceRefFromServer).replace(/^helia:\/\//i, '') };
                        const sig712 = await signEvidenceEIP712(evidenceData, contractInfo, signer);
                        const contractWithSigner = new ethers.Contract(contractAddress, EnhancedRentContractJson.abi, signer);
                        if (typeof contractWithSigner.submitEvidenceWithSignature === 'function') {
                          const recipientsHash = hashRecipients(recipients);
                          const tx = await contractWithSigner.submitEvidenceWithSignature(
                            evidenceData.caseId,
                            evidenceData.cid,
                            evidenceData.contentDigest,
                            recipientsHash,
                            sig712
                          );
                          await tx.wait();
                          console.log('Anchored evidence on-chain', tx.hash);
                        } else {
                          console.warn('Contract missing submitEvidenceWithSignature');
                        }
                      } catch (e) { void e;
                        console.error('On-chain anchoring failed', e);
                      }
                    }

                    // Non-blocking: notify backend to attempt arbitration (batch/ollama) using the evidence ref and canonical payload
                    try {
                      if (evidenceRefFromServer) {
                        const arbPayload = { caseId: previewPayloadObj?.caseId || null, evidenceRef: evidenceRefFromServer, contractAddress, payload: previewPayloadObj };
                        // Best-effort; do not block user flow if this fails
                        triggerArbitrateBatch(arbPayload).then((r) => {
                          console.debug('[ContractModal] triggerArbitrateBatch response', r);
                        }).catch((err) => {
                          console.debug('[ContractModal] triggerArbitrateBatch failed (non-fatal)', err);
                        });
                      }
                    } catch (e) { void e; }

                    setShowPreviewModal(false);
                    setShowDisputeForm(false);
                    setDisputeForm({ dtype: 4, amountEth: '0', evidence: '' });
                    alert('Appeal submitted. EvidenceRef: ' + (evidenceRefFromServer || 'n/a'));
                    await loadContractData();
                  } catch (e) { void e;
                    console.error('Preview submit failed', e);
                    setPreviewError(e?.message || String(e));
                  } finally {
                    setPreviewBusy(false);
                  }
                }} disabled={previewBusy}>{previewBusy ? 'Processing...' : 'Sign & Submit'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ContractModal;