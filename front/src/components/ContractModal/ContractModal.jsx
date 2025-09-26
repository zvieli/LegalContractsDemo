import { useState, useEffect, useMemo } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import { ContractService } from '../../services/contractService';
import * as ethers from 'ethers';
import { ArbitrationService } from '../../services/arbitrationService';
import { DocumentGenerator } from '../../utils/documentGenerator';
import { getContractAddress } from '../../utils/contracts';
import ConfirmPayModal from '../common/ConfirmPayModal';
import './ContractModal.css';
import { decryptCiphertextJson } from '../../utils/adminDecrypt';

function ContractModal({ contractAddress, isOpen, onClose, readOnly = false }) {
  const { signer, chainId, account, provider } = useEthers();
  const [contractDetails, setContractDetails] = useState(null);
  const [loading, setLoading] = useState(true);
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
  const [submitMessage, setSubmitMessage] = useState('');
  

  // Confirmation modal state for payable actions
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAmountEth, setConfirmAmountEth] = useState('0');
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

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

  useEffect(() => {
    if (isOpen && contractAddress && signer) {
      loadContractData();
    }
  }, [isOpen, contractAddress, signer]);

  // Expose a small test helper for E2E: programmatically open the dispute form when modal is mounted.
  useEffect(() => {
    if (!isOpen) return;
    try {
      // attach a helper only in test/dev environments
      window.playwright_open_dispute = () => { try { setShowDisputeForm(true); } catch (_) {} };
      window.playwright_submit_dispute = async (evidenceText) => {
        try {
          setDisputeForm(s => ({ ...s, evidence: evidenceText || `Playwright evidence ${Date.now()}` }));
          setShowDisputeForm(true);
          // give React a tick to render the form
          await new Promise(r => setTimeout(r, 50));
          try { await submitDisputeForm(); } catch (e) { console.error('playwright_submit_dispute failed', e); }
        } catch (e) { console.error('playwright_submit_dispute failed', e); }
      };
    } catch (_) {}
    return () => {
      try { delete window.playwright_open_dispute; } catch (_) {}
      try { delete window.playwright_submit_dispute; } catch (_) {}
    };
  }, [isOpen]);

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
  // detect per-contract appeal in localStorage (try multiple key variants) or sessionStorage fallback
      try {
        const key1 = `incomingDispute:${contractAddress}`;
        const key2 = `incomingDispute:${String(contractAddress).toLowerCase()}`;
        let js = localStorage.getItem(key1) || localStorage.getItem(key2) || null;
        if (!js) {
          // sessionStorage may contain the incomingDispute routed to arbitration page
          try {
            const sess = sessionStorage.getItem('incomingDispute');
            if (sess) {
              const o = JSON.parse(sess);
              if (o && o.contractAddress && String(o.contractAddress).toLowerCase() === String(contractAddress).toLowerCase()) {
                js = sess;
              }
            }
          } catch (_) { js = js; }
        }
        setHasAppeal(!!js);
        // Prefer reading arbitrator rationale on-chain (getDisputeMeta) if the rent contract exposes it.
        try {
          if (details?.type === 'Rental') {
            try {
              const svc = new ContractService(signer, chainId);
              // Attempt to find most recent resolved dispute meta if any
              const rent = await svc.getRentContract(contractAddress);
              const count = Number(await rent.getDisputesCount().catch(() => 0));
              let foundMeta = null;
              for (let i = count - 1; i >= 0; i--) {
                try {
                  const d = await rent.getDispute(i);
                  const resolved = !!d[4];
                  if (resolved) {
                    // read on-chain meta
                    const meta = await svc.getDisputeMeta(contractAddress, i).catch(() => null);
                    if (meta && (meta.classification || meta.rationale)) {
                      foundMeta = { contractAddress, decision: d[5] ? 'approve' : 'deny', rationale: meta.rationale || '', timestamp: Date.now(), classification: meta.classification || '' };
                      break;
                    }
                  }
                } catch (_) {}
              }
              if (foundMeta) {
                setArbResolution(foundMeta);
              } else {
                // fallback to localStorage for older persisted decisions
                try {
                  const rk = `arbResolution:${String(contractAddress).toLowerCase()}`;
                  const rjs = localStorage.getItem(rk);
                  if (rjs) setArbResolution(JSON.parse(rjs)); else setArbResolution(null);
                } catch (e) { setArbResolution(null); }
              }
            } catch (e) {
              // On any failure reading on-chain, fall back to localStorage
              try {
                const rk = `arbResolution:${String(contractAddress).toLowerCase()}`;
                const rjs = localStorage.getItem(rk);
                if (rjs) setArbResolution(JSON.parse(rjs)); else setArbResolution(null);
              } catch (_) { setArbResolution(null); }
            }
          } else {
            // Non-rental types - keep legacy localStorage behaviour
            try {
              const rk = `arbResolution:${String(contractAddress).toLowerCase()}`;
              const rjs = localStorage.getItem(rk);
              if (rjs) setArbResolution(JSON.parse(rjs)); else setArbResolution(null);
            } catch (e) { setArbResolution(null); }
          }
        } catch (e) { setArbResolution(null); }
      } catch (e) {
        setHasAppeal(false);
      }
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
        // If NDA, fetch arbitration service owner for accurate arbitrator gating
        try {
          if (details?.type === 'NDA') {
            const svc = new ArbitrationService(signer, chainId);
            try {
              const ownerAddr = await svc.getArbitrationServiceOwnerByNDA(contractAddress);
              setArbOwner(ownerAddr || null);
            } catch (_) { setArbOwner(null); }
          } else {
            setArbOwner(null);
          }
        } catch (_) { setArbOwner(null); }
        // Rent signing gating
        try {
          if (details?.type === 'Rental' && account) {
            const me = account.toLowerCase();
            const landlord = (details.landlord||'').toLowerCase();
            const tenant = (details.tenant||'').toLowerCase();
            const fully = details?.signatures?.fullySigned;
            const signed = (me===landlord && details?.signatures?.landlord) || (me===tenant && details?.signatures?.tenant);
            setRentAlreadySigned(!!signed);
            setRentCanSign(!fully && (me===landlord || me===tenant) && !signed);
          } else {
            setRentAlreadySigned(false);
            setRentCanSign(true);
          }
        } catch(_){}
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
  // include security deposit events (debtor deposits for case) so deposits show in payment history
  const depositEvents = await rentContract.queryFilter(rentContract.filters.SecurityDepositPaid?.());
        const transactions = await Promise.all(paymentEvents.map(async (event) => {
          const blk = await (signer?.provider || provider).getBlock(event.blockNumber);
          return {
            hash: event.transactionHash,
            amount: ethers.formatEther(event.args.amount),
            date: blk?.timestamp ? new Date(Number(blk.timestamp) * 1000).toLocaleDateString() : '—',
            payer: event.args.tenant
          };
        }));

        const depositTxs = await Promise.all(depositEvents.map(async (event) => {
          const blk = await (signer?.provider || provider).getBlock(event.blockNumber);
          return {
            hash: event.transactionHash,
            amount: ethers.formatEther(event.args.amount),
            date: blk?.timestamp ? new Date(Number(blk.timestamp) * 1000).toLocaleDateString() : '—',
            payer: event.args.by,
            note: `Deposit for case (total after): ${ethers.formatEther(event.args.total || 0n)} ETH`
          };
        }));

        // Also include dispute/appeal events (so reporter bond / appeal TXs show in history)
        try {
          const disputeEvents = await rentContract.queryFilter(rentContract.filters.DisputeReported?.());
          const disputeTxs = await Promise.all(disputeEvents.map(async (ev) => {
            const blk = await (signer?.provider || provider).getBlock(ev.blockNumber);
            const cid = Number(ev.args?.caseId ?? ev.args?.[0] ?? 0);
            const req = ev.args?.requestedAmount ?? ev.args?.[3] ?? 0n;
            // Read the actual transaction value (msg.value) to show the real ETH moved (reporter bond),
            // otherwise showing `requestedAmount` is misleading because disputes often only send the bond.
            let txValue = 0n;
            try {
              const txOnChain = await (signer?.provider || provider).getTransaction(ev.transactionHash);
              if (txOnChain && txOnChain.value != null) txValue = txOnChain.value;
            } catch (e) {
              // non-fatal: fall back to requestedAmount if tx.value cannot be read
              txValue = req;
            }
            const amt = (() => { try { return ethers.formatEther(txValue); } catch { return String(txValue); } })();
            return {
              hash: ev.transactionHash,
              amount: amt,
              date: blk?.timestamp ? new Date(Number(blk.timestamp) * 1000).toLocaleDateString() : '—',
              payer: ev.args?.initiator || ev.args?.[1],
              note: `Appeal (case #${cid})`,
              requestedAmountEth: (() => { try { return ethers.formatEther(req); } catch { return String(req); } })(),
              caseId: cid,
            };
          }));

          // merge and sort by date (newest first)
          const merged = [...transactions, ...depositTxs, ...disputeTxs].sort((a,b) => {
            const da = a.date === '—' ? 0 : new Date(a.date).getTime();
            const db = b.date === '—' ? 0 : new Date(b.date).getTime();
            return db - da;
          });
          setTransactionHistory(merged);

            // Find unresolved disputes and if current account is debtor, set pendingDeposit
          try {
            let found = null;
            let foundActiveAgainstLandlord = false;
            for (const d of disputeTxs) {
              try {
                const disc = await rentContract.getDispute(Number(d.caseId));
                const resolved = !!disc[4];
                if (!resolved) {
                  const initiator = disc[0];
                  const landlordAddr = await rentContract.landlord();
                  const tenantAddr = await rentContract.tenant();
                  const debtorAddr = String(initiator).toLowerCase() === String(landlordAddr).toLowerCase() ? tenantAddr : landlordAddr;
                  const requested = BigInt(disc[2] || 0);

                  // If the unresolved dispute's debtor equals the landlord address, mark flag so UI hides modification buttons
                  try {
                    if (String(debtorAddr).toLowerCase() === String(landlordAddr).toLowerCase()) {
                      foundActiveAgainstLandlord = true;
                    }
                  } catch (_) {}

                  // Read the debtor's current partyDeposit to decide whether deposit is still required
                  let debtorDeposit = 0n;
                  try {
                    debtorDeposit = BigInt(await rentContract.partyDeposit(debtorAddr).catch(() => 0n) || 0n);
                  } catch (_) { debtorDeposit = 0n; }

                  if (account && String(account).toLowerCase() === String(debtorAddr).toLowerCase()) {
                    const requestedEth = (() => { try { return ethers.formatEther(requested); } catch { return String(requested); } })();
                    if (debtorDeposit >= requested) {
                      // Deposit already satisfies requested amount — show a satisfied confirmation instead of the input
                      const depositedEth = (() => { try { return ethers.formatEther(debtorDeposit); } catch { return String(debtorDeposit); } })();
                      found = { caseId: Number(d.caseId), requestedAmountWei: requested, requestedAmountEth: requestedEth, debtor: debtorAddr, satisfied: true, depositedAmountWei: debtorDeposit, depositedAmountEth: depositedEth };
                    } else {
                      // Still needs deposit
                      found = { caseId: Number(d.caseId), requestedAmountWei: requested, requestedAmountEth: requestedEth, debtor: debtorAddr, satisfied: false };
                    }
                    break;
                  }
                }
              } catch (_) {}
            }
            setPendingDeposit(found);
            setHasActiveDisputeAgainstLandlord(foundActiveAgainstLandlord);
          } catch (e) { console.debug('pending deposit detection failed', e); }
        } catch (e) {
          // ignore dispute merge failures
          setTransactionHistory(transactions);
        }
        // read withdrawable amount for connected account (if landlord)
        try {
          if (account) {
            const w = await rentContract.withdrawable(account);
            setWithdrawableAmt(ethers.formatEther(w || 0n));
          } else {
            setWithdrawableAmt('0');
          }
        } catch (_) { setWithdrawableAmt('0'); }
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
            ev.push({ type: `Breach Reported (Case #${Number(e.args?.caseId ?? e.args?.[0] ?? 0)})`, by: e.args?.reporter || e.args?.[1], at: blk?.timestamp || 0, tx: e.transactionHash });
          }
          const res = await nda.queryFilter(nda.filters.BreachResolved?.());
          for (const e of res) {
            const blk = await (signer?.provider || provider).getBlock(e.blockNumber);
            const id = Number(e.args?.caseId ?? e.args?.[0] ?? 0);
            ev.push({ type: `${e.args?.approved ? 'Breach Approved' : 'Breach Rejected'} (Case #${id})`, by: e.args?.beneficiary || e.args?.[3], at: blk?.timestamp || 0, tx: e.transactionHash });
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

      // expose for simple cross-component refresh calls in this educational demo
      try { window.refreshContractData = loadContractData; } catch (_) {}
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

      // Check whether connected wallet is authorized to perform arbitration actions
      try {
        const svc = new ContractService(signer, chainId);
        const ok = await svc.isAuthorizedArbitratorForContract(contractAddress).catch(() => false);
        setIsAuthorizedArbitrator(!!ok);
      } catch (_) { setIsAuthorizedArbitrator(false); }
      
    } catch (error) {
      console.error('Error loading contract data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Attach live event listeners for the currently-open contract to refresh modal state
  useEffect(() => {
    if (!isOpen || !contractAddress || !signer) return;
    let inst = null;
    let provider = signer.provider || provider;
    const setup = async () => {
      try {
        const svc = new ContractService(signer, chainId);
        inst = await svc.getRentContract(contractAddress).catch(() => null);
        if (!inst) return;
        const refresh = () => loadContractData();
        inst.on && inst.on('CancellationInitiated', refresh);
        inst.on && inst.on('CancellationApproved', refresh);
        inst.on && inst.on('CancellationFinalized', refresh);
        inst.on && inst.on('ContractCancelled', refresh);
      } catch (e) {
        // ignore
      }
    };
    setup();
    return () => {
      try {
        if (inst && inst.removeAllListeners) {
          inst.removeAllListeners('CancellationInitiated');
          inst.removeAllListeners('CancellationApproved');
          inst.removeAllListeners('CancellationFinalized');
          inst.removeAllListeners('ContractCancelled');
        }
      } catch (_) {}
    };
  }, [isOpen, contractAddress, signer]);

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
      // Refresh signer from provider for the current account to avoid stale signer issues
      let activeSigner = signer;
      try {
        if (provider && account) {
          const s = await provider.getSigner(account);
          // double-check resolution
          const addr = await s.getAddress();
          if (addr?.toLowerCase?.() === account.toLowerCase()) {
            activeSigner = s;
          }
        }
      } catch (_) { /* fallback to existing signer */ }
      const contractService = new ContractService(activeSigner, chainId);
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

  const handleRentWithdraw = async () => {
    try {
      setActionLoading(true);
      const service = new ContractService(signer, chainId);
      await service.withdrawRentPayments(contractAddress);
      alert('Withdraw successful');
      // refresh withdrawable amount
      const rentContract = await service.getRentContract(contractAddress);
      const w = await rentContract.withdrawable(account);
      setWithdrawableAmt(ethers.formatEther(w || 0n));
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

  const handleFinalizeCancellation = async () => {
    if (!confirm('Finalize cancellation via Arbitration Service? This will deactivate the contract.')) return;
    try {
      setActionLoading(true);
      const service = new ContractService(signer, chainId);
      // Prefer landlord-local finalize path when caller is landlord
      const arbAddress = contractDetails?.arbitrationService || null;
      let arbAddr = arbAddress;
        // If not configured on contract, attempt frontend global artifacts (served from public)
        if (!arbAddr) {
          try {
            // Fetch deployment metadata from the public assets served at /utils/contracts/
            const resp = await fetch('/utils/contracts/ContractFactory.json');
            if (resp && resp.ok) {
              const cf = await resp.json();
              arbAddr = cf?.contracts?.ArbitrationService || null;
            }
          } catch (_) { arbAddr = null; }
        }
        // If still not found, attempt configured addresses via utils/contracts getContractAddress
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

      // collect fee if required
      const fee = feeToSend ? feeToSend : '0';
      const feeWei = fee ? ethers.parseEther(String(fee)) : 0n;

      // If the connected user is the landlord, use the landlord-specific entrypoint
      const accountAddr = account ? account.toLowerCase() : null;
      const isCallerLandlord = accountAddr && contractDetails?.landlord && accountAddr === contractDetails.landlord.toLowerCase();
      let receipt;
      if (isCallerLandlord) {
        receipt = await service.finalizeByLandlordViaService(arbAddr, contractAddress, feeWei);
      } else {
        // fallback to admin/factory path
        receipt = await service.finalizeCancellationViaService(arbAddr, contractAddress, feeWei);
      }
      alert(`✅ Cancellation finalized
Transaction: ${receipt.transactionHash || receipt.hash}`);
      await loadContractData();
    } catch (e) {
      console.error('Finalize failed:', e);
      alert(`Failed to finalize: ${e?.reason || e?.message || e}`);
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
      // If evidence is a plain string, contractService will compute digest; pass through as-is
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
  const handleNdaResolveByArbitrator = async () => {
    // UI helper: resolving a case requires the platform arbitrator to call the
    // on-chain ArbitrationService which will, in turn, call the template's
    // service entrypoints. Standard users cannot call `resolveByArbitrator`.
    alert('Resolve action must be performed by the platform arbitrator via ArbitrationService');
  };

  const submitDisputeForm = async () => {
    try {
      setActionLoading(true);
      const svc = new ContractService(signer, chainId);
      const amountWei = disputeForm.amountEth ? ethers.parseEther(String(disputeForm.amountEth || '0')) : 0n;
      // prefer file hash if present, otherwise use evidence text
      const evidenceRaw = disputeForm.evidence || '';
      // If evidenceRaw is a 0x-prefixed 32-byte hash, use it; otherwise compute keccak256 of the UTF-8 string.
      let evidence = '';
      try {
        if (evidenceRaw && /^0x[0-9a-fA-F]{64}$/.test(evidenceRaw)) evidence = evidenceRaw;
        else if (evidenceRaw) evidence = ethers.keccak256(ethers.toUtf8Bytes(String(evidenceRaw)));
        else evidence = '';
      } catch (e) { evidence = '' }
      // Compute bond (for display/record) but send the report tx immediately via the user's wallet
      try {
        const bond = svc.computeReporterBond(amountWei);
        // If no evidence provided, use standard zero-hash to indicate empty evidence
        const evidenceToSend = evidence && evidence.length ? evidence : ethers.ZeroHash;
        // Directly submit dispute - this will prompt MetaMask and send the bond as msg.value
        const { caseId } = await svc.reportRentDispute(contractAddress, Number(disputeForm.dtype || 0), amountWei, evidenceToSend);
        try {
          // Preserve the raw evidence text for display/copy in the appeal modal when it's a human-entered string
          const incoming = {
            contractAddress: contractAddress,
            dtype: Number(disputeForm.dtype || 0),
            amountEth: String(disputeForm.amountEth || '0'),
            // Persist only the canonical evidence digest. Do NOT store plaintext evidence here.
            evidenceDigest: evidenceToSend || ethers.ZeroHash,
            reporter: account || null,
            caseId: caseId != null ? String(caseId) : null,
            createdAt: new Date().toISOString(),
          };
          sessionStorage.setItem('incomingDispute', JSON.stringify(incoming));
          try { const perKey = `incomingDispute:${contractAddress}`; localStorage.setItem(perKey, JSON.stringify(incoming)); } catch (e) { console.warn('Failed to persist per-contract incomingDispute', e); }
        } catch (e) { console.error('Failed to persist dispute for arbitration page:', e); }

        setShowDisputeForm(false);
        try {
          const svc2 = new ContractService(signer, chainId);
          const isAuthorized = await svc2.isAuthorizedArbitratorForContract(contractAddress).catch(() => false);
          if (isAuthorized) window.location.pathname = '/arbitration'; else { alert('Dispute submitted. The platform arbitrator will review the case. You will be notified of updates.'); window.location.pathname = '/dashboard'; }
        } catch (redirErr) { console.warn('Failed to detect arbitrator state, defaulting to dashboard redirect', redirErr); window.location.pathname = '/dashboard'; }
        await loadContractData();
      } catch (err) {
        console.error('Submit dispute failed:', err);
        alert(`Failed to submit dispute: ${err?.reason || err?.message || err}`);
      } finally {
        setActionLoading(false);
      }
    } catch (err) {
      console.error('Unexpected error in submitDisputeForm:', err);
      alert(`Failed to submit dispute: ${err?.reason || err?.message || err}`);
      setActionLoading(false);
    }
  };

  // Show computed reporter bond for the current dispute form amount
  const computedReporterBondEth = (() => {
    try {
      const amt = disputeForm.amountEth ? ethers.parseEther(String(disputeForm.amountEth || '0')) : 0n;
      const svc = new ContractService(signer, chainId);
      const bond = svc.computeReporterBond(amt);
      try { return ethers.formatEther(bond); } catch { return String(bond); }
    } catch (_) { return '0'; }
  })();

  // File uploads removed: evidence must be provided as an off-chain payload and
  // the frontend will only submit a 32-byte keccak256 digest of that payload.
  // Reporter clients must upload the ciphertext/payload to an HTTP(S) location
  // reachable by the platform arbitrator/admin (or provide the digest of an
  // already-uploaded payload). Do NOT include plaintext/admin private keys in
  // the frontend. For local development, use tools/admin/upload-evidence-local.mjs
  // to place ciphertext files under front/e2e/static/<digestNo0x>.json and
  // configure EVIDENCE_FETCH_BASE accordingly.

  // Render: show computed bond near dispute form submission area
  // (This UI is included in the modal's dispute section elsewhere; place near the submit button)

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

  // Templates no longer expose a direct `arbitrator` address. For UI purposes
  // treat presence of `arbitrationService` as the indicator that disputes are
  // handled off-chain by a platform arbitrator via the service.
  const isArbitrator = useMemo(() => {
    try {
      if (!arbOwner || !account) return false;
      return arbOwner.toLowerCase() === account.toLowerCase();
    } catch { return false; }
  }, [arbOwner, account]);
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
  const handleCopyTx = async (txHash) => {
    if (!txHash) return;
    try {
      await navigator.clipboard.writeText(txHash);
      alert('Transaction hash copied to clipboard');
    } catch (_) {
      // Fallback copy for older browsers
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
      // Try localStorage by exact key, lowercase key, then sessionStorage fallback
      const key1 = `incomingDispute:${contractAddress}`;
      const key2 = `incomingDispute:${String(contractAddress).toLowerCase()}`;
      let json = localStorage.getItem(key1) || localStorage.getItem(key2) || null;
      if (!json) {
        // fallback to sessionStorage
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
      // Legacy local file attachments (IndexedDB) are no longer supported; ignore any persisted keys.
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

      // If the stored evidence looks like human-entered text (not a 32-byte keccak hash), copy it directly.
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

      // No plain evidence text available — copy a structured summary instead (omit raw file bytes).
      const summary = {
        contract: appealData.contractAddress || null,
        caseId: appealData.caseId || null,
        type: appealData.dtype || null,
        amountEth: appealData.amountEth || null,
        reporter: appealData.reporter || null,
        submitted: appealData.createdAt || null,
        evidenceText: evidenceText || null,
        // If no plaintext available, include the stored digest so admins can locate ciphertext
        evidence: (!evidenceText && appealData.evidence) ? appealData.evidence : ((appealData.evidenceDigest) ? appealData.evidenceDigest : null)
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

  // Attempt auto-fetch+decrypt once when modal opens and admin key + guessed URL are present
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

  // ---- Rent EIP712 signing wrapper ----
  const handleRentSign = async () => {
    try {
      setRentSigning(true);
      const svc = new ContractService(signer, chainId);
      await svc.signRent(contractAddress);
      await loadContractData();
    } catch (e) {
      const reason = e?.reason || e?.message || 'Failed to sign';
      alert(`Sign failed: ${reason}`);
    } finally {
      setRentSigning(false);
    }
  };

  // Render part: insert Show Appeal button near the dispute controls

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

          <ConfirmPayModal open={confirmOpen} title="Confirm dispute bond" amountEth={confirmAmountEth} details={`This will send the reporter bond to the contract (anti-spam).`} onConfirm={onConfirmProceed} onCancel={onConfirmCancel} busy={confirmBusy} />
        </div>

        <div className="modal-tabs">
          <button 
            className={activeTab === 'details' ? 'active' : ''}
            onClick={() => setActiveTab('details')}
          >
            <i className="fas fa-info-circle"></i>
            Details
          </button>
          {/* Show payments/actions only when NOT readOnly */}
          {/* Only show Payments tab for active rental contracts */}
          {!readOnly && contractDetails?.type === 'Rental' && contractDetails?.isActive && (
          <button 
            className={activeTab === 'payments' ? 'active' : ''}
            onClick={() => setActiveTab('payments')}
          >
            <i className="fas fa-money-bill-wave"></i>
            Payments
          </button>)}
          {!readOnly && (
          <button 
            className={activeTab === 'actions' ? 'active' : ''}
            onClick={() => setActiveTab('actions')}
          >
            <i className="fas fa-cog"></i>
            Actions
          </button>)}
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
                {hasAppeal && (
                  <div style={{marginTop:8}}>
                    <button className="btn-action" onClick={handleShowAppeal}>Show Appeal</button>
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
                          <div className="tx-hash">
                            {p.slice(0,10)}...{p.slice(-8)}
                            <button className="btn-copy" onClick={() => handleCopyTx(p)} title="Copy address" style={{marginLeft:8}}>Copy</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {contractDetails.type === 'NDA' && contractDetails.cases && contractDetails.cases.length > 0 && (
                  <div className="section" style={{marginTop:'8px'}}>
                    <h4>Cases</h4>
                    <div className="transactions-list">
                      {contractDetails.cases.map((c) => (
                        <div key={c.id} className="transaction-item">
                          <div className="tx-amount">Case #{c.id}</div>
                          <div className="tx-date">{c.resolved ? (c.approved ? 'Approved' : 'Rejected') : 'Pending'}</div>
                          <div className="tx-hash">Requested: {c.requestedPenalty} ETH</div>
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
                {contractDetails?.cancellation?.cancelRequested && (
                  <div className="alert warning">Cancellation is pending; payments are disabled until completion.</div>
                )}
                {contractDetails?.type==='Rental' && !contractDetails?.signatures?.fullySigned && (
                  <div className="alert info">Both parties must sign before payments are enabled.</div>
                )}
                {requiredEth && (
                  <p className="muted">Required ETH for rent: {requiredEth} ETH</p>
                )}

                <div className="payment-section">
                  {/* Payment controls are tenant-only. Landlord sees withdraw options only. */}
                  {isTenant ? (
                    <div className="payment-input">
                      <input
                        type="number"
                        placeholder="Amount in ETH"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        disabled={readOnly || actionLoading || !contractDetails.isActive || !!contractDetails?.cancellation?.cancelRequested || (contractDetails?.type==='Rental' && !contractDetails?.signatures?.fullySigned)}
                      />
                      <button 
                        onClick={handlePayRent}
                        disabled={readOnly || actionLoading || !paymentAmount || !contractDetails.isActive || !!contractDetails?.cancellation?.cancelRequested || (contractDetails?.type==='Rental' && !contractDetails?.signatures?.fullySigned)}
                        className="btn-primary"
                      >
                        {actionLoading ? 'Processing...' : 'Pay Rent'}
                      </button>
                      <button 
                        onClick={() => setPaymentAmount(requiredEth || '')}
                        disabled={readOnly || actionLoading || !contractDetails.isActive || !requiredEth || !!contractDetails?.cancellation?.cancelRequested || (contractDetails?.type==='Rental' && !contractDetails?.signatures?.fullySigned)}
                        className="btn-secondary"
                      >
                        Use required amount
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

                {/* Pending deposit prompt for debtor when an unresolved dispute exists */}
                {pendingDeposit && (
                  <div style={{marginTop:12, padding:10, border:'1px solid #f0c', borderRadius:6, background:'#fff7fb'}}>
                    {!pendingDeposit.satisfied ? (
                      <>
                        <div style={{marginBottom:8}}><strong>Notice:</strong> A dispute (case #{pendingDeposit.caseId}) has been filed requesting {pendingDeposit.requestedAmountEth} ETH. As the debtor you must deposit the claimed amount or part of it.</div>
                        <div style={{display:'flex', gap:8, alignItems:'center'}}>
                          <input className="text-input" type="number" step="0.000000000000000001" placeholder={`Amount to deposit (ETH) up to ${pendingDeposit.requestedAmountEth}`} value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} />
                          <button className="btn-primary" onClick={async () => {
                            try {
                              const toSendEth = paymentAmount && String(paymentAmount).trim() !== '' ? paymentAmount : pendingDeposit.requestedAmountEth;
                              const amtWei = toSendEth ? ethers.parseEther(String(toSendEth)) : 0n;
                              const amtEth = (() => { try { return ethers.formatEther(amtWei); } catch { return String(amtWei); } })();
                              setConfirmAmountEth(amtEth);
                              setConfirmAction(() => async () => {
                                try {
                                  setActionLoading(true);
                                  const svc = new ContractService(signer, chainId);
                                  await svc.depositForCase(contractAddress, pendingDeposit.caseId, amtWei);
                                  alert('Deposit submitted');
                                  // refresh contract data
                                  await loadContractData();
                                } catch (err) { alert(`Deposit failed: ${err?.message || err}`); } finally { setActionLoading(false); }
                              });
                              setConfirmOpen(true);
                            } catch (e) { console.error('Failed to prepare deposit', e); alert('Failed to prepare deposit'); }
                          }}>Deposit</button>
                          <div className="muted">Or leave input empty to deposit the full requested amount.</div>
                        </div>
                      </>
                    ) : (
                      <div style={{display:'flex', flexDirection:'column', gap:6}}>
                        <div style={{marginBottom:8}}><strong>Deposit satisfied:</strong> You have already deposited {pendingDeposit.depositedAmountEth} ETH which meets or exceeds the requested {pendingDeposit.requestedAmountEth} ETH for case #{pendingDeposit.caseId}.</div>
                        <div className="muted">No further deposit is required. The deposit input is hidden.</div>
                      </div>
                    )}
                  </div>
                )}

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
                          {tx.hash.slice(0, 10)}...{tx.hash.slice(-8)}
                          <button className="btn-copy" onClick={() => handleCopyTx(tx.hash)} title="Copy tx hash" style={{marginLeft:8}}>Copy</button>
                        </div>
                        {tx.requestedAmountEth && (
                          <div className="tx-note">Requested: {tx.requestedAmountEth} ETH</div>
                        )}
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
                        {/* Only render Sign button when contract is active; if inactive hide it entirely */}
                        {contractDetails?.isActive && (
                          <button 
                            onClick={handleRentSign}
                            disabled={readOnly || rentSigning || !rentCanSign}
                            className="btn-action primary"
                          >
                            {rentSigning ? 'Signing...' : rentAlreadySigned ? 'Signed' : 'Sign Contract'}
                          </button>
                        )}
                        {/* Terminate Contract removed: use cancellation workflow via CancellationService */}
                      </div>
                      {!rentCanSign && !rentAlreadySigned && (
                        <small className="muted">Connect as landlord or tenant to sign.</small>
                      )}
                      {rentAlreadySigned && !contractDetails?.signatures?.fullySigned && (
                        <small className="muted">Waiting for the other party to sign.</small>
                      )}
                      {contractDetails?.signatures?.fullySigned && (
                        <small className="muted" style={{color:'#44c767'}}>Both parties signed.</small>
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

                    {isLandlord && !hasActiveDisputeAgainstLandlord && (
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
                        <button className="btn-action" disabled={readOnly || actionLoading} onClick={handleSetPolicy}>Save Policy</button>
                      </div>
                    )}
                    {isLandlord && hasActiveDisputeAgainstLandlord && (
                      <div style={{marginTop: '8px', padding: '8px', border: '1px dashed #eee', borderRadius:6}}>
                        <div className="muted">A dispute has been filed against the landlord for this contract. Contract policy edits are temporarily disabled until the dispute is resolved.</div>
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
                      // If an arbitration decision was recorded locally for this contract indicating cancellation,
                      // do not allow manual approve flow — the arbitrator finalization supersedes manual approval.
                      let hasArbCancel = false;
                      try {
                        const key = `arbResolution:${String(contractAddress).toLowerCase()}`;
                        const raw = localStorage.getItem(key);
                        if (raw) {
                          const parsed = JSON.parse(raw);
                          if (parsed && parsed.decision === 'approve') hasArbCancel = true;
                        }
                      } catch (_) { hasArbCancel = false; }
                      const canApprove = contractDetails.isActive && alreadyRequested && !myApproved && !iAmInitiator && (isLandlord || isTenant) && !hasArbCancel;
                      const canFinalize = contractDetails.isActive && alreadyRequested && (
                        cxl.requireMutualCancel ? bothApproved : (cxl.cancelEffectiveAt ? nowSec >= cxl.cancelEffectiveAt : false)
                      );
                      return (
                        <div className="cxl-actions" style={{marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap'}}>
                          { !hasActiveDisputeAgainstLandlord ? (
                            <>
                              <button className="btn-action" disabled={actionLoading || !canInitiate} onClick={handleInitiateCancel}>Initiate Cancellation</button>
                              <button className="btn-action" disabled={actionLoading || !canApprove} onClick={handleApproveCancel}>Approve Cancellation</button>
                            </>
                          ) : (
                            <div style={{padding:'8px', border:'1px dashed #eee', borderRadius:6}} className="muted">Cancellation and policy actions are disabled while a dispute against the landlord is active.</div>
                          )}
                          <div style={{display:'flex', gap:'8px', alignItems:'center'}}>
                            <input className="text-input" style={{width:'160px'}} type="number" placeholder={feeDueEth ? `Fee required: ${feeDueEth}` : 'Fee (ETH, optional)'} value={feeToSend} onChange={e => setFeeToSend(e.target.value)} />
                            <button className="btn-action" disabled={!feeDueEth} onClick={() => setFeeToSend(feeDueEth || '')}>Autofill Fee</button>
                            {/* New UX: allow landlord or tenant to send an appeal (report dispute) instead of immediate finalization */}
                            <button className="btn-action" disabled={actionLoading || !(isLandlord || isTenant) || !contractDetails?.cancellation?.cancelRequested} onClick={() => setShowDisputeForm(true)}>Send to arbitration (appeal)</button>
                            <button className="btn-action" onClick={handleShowAppeal}>Show Appeal</button>
                            {/* Platform arbitrator / factory can still finalize directly via service */}
                            <button className="btn-action" disabled={actionLoading || !canFinalize || !isAuthorizedArbitrator} onClick={handleFinalizeCancellation}>Finalize (via Arbitration Service)</button>
                            {!isAuthorizedArbitrator && (
                              <small className="muted" style={{marginLeft:'8px'}}>Only the contract creator or platform arbitrator may finalize via the ArbitrationService.</small>
                            )}
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
                              <div className="tx-hash">
                                {ev.by ? `${ev.by.slice(0,10)}...${ev.by.slice(-8)}` : (ev.tx ? `${ev.tx.slice(0,10)}...${ev.tx.slice(-8)}` : '—')}
                                {ev.tx && <button className="btn-copy" onClick={() => handleCopyTx(ev.tx)} title="Copy tx hash" style={{marginLeft:8}}>Copy</button>}
                              </div>
                            </div>
                          ))}
                          {arbResolution && (
                            <div className="transaction-item" style={{borderTop:'1px solid #eee', marginTop:8, paddingTop:8}}>
                              <div style={{fontWeight:600}}>Arbitrator decision: {arbResolution.decision === 'approve' ? 'Approved (finalized)' : 'Denied (left active)'}</div>
                              <div style={{marginTop:6}}>
                                {rationaleRevealed ? (
                                  <div>{arbResolution.rationale || <span className="muted">(no rationale provided)</span>}</div>
                                ) : (
                                  <div>
                                    <div className="muted">Rationale is hidden. Click reveal to view (must be landlord or tenant).</div>
                                    <div style={{marginTop:6}}>
                                      <button className="btn-sm" onClick={() => {
                                        try {
                                          const me = account && account.toLowerCase();
                                          const landlord = contractDetails?.landlord && contractDetails.landlord.toLowerCase();
                                          const tenant = contractDetails?.tenant && contractDetails.tenant.toLowerCase();
                                          if (me && (me === landlord || me === tenant)) {
                                            setRationaleRevealed(true);
                                          } else {
                                            alert('Reveal requires connecting as landlord or tenant (their private key)');
                                          }
                                        } catch (e) { console.error('Reveal failed', e); alert('Failed to reveal rationale'); }
                                      }}>Reveal rationale</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div style={{marginTop:6}} className="muted">Recorded at: {new Date(Number(arbResolution.timestamp || 0)).toLocaleString()}</div>
                            </div>
                          )}
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
                        <input className="text-input" placeholder="Offender (0x...)" value={ndaReportOffender} onChange={e => setNdaReportOffender(e.target.value)} />
                        <input className="text-input" placeholder="Requested penalty (ETH)" value={ndaReportPenalty} onChange={e => setNdaReportPenalty(e.target.value)} />
                        <input className="text-input" placeholder="Evidence text or 0x...digest (optional)" value={ndaReportEvidenceText} onChange={e => setNdaReportEvidenceText(e.target.value)} />
                        <small className="muted">File uploads disabled. Provide the keccak256 digest (0x...) of your off-chain ciphertext or paste ciphertext elsewhere and use the admin tools to register it. Do NOT paste admin private keys here.</small>
                        <button className="btn-action" disabled={actionLoading} onClick={() => handleNdaReport(ndaReportOffender, ndaReportPenalty, ndaReportEvidenceText || ndaReportFileHash)}>
                          Submit Report
                        </button>
                      </div>
                        <div className="detail-item" style={{display:'flex', gap:'8px', alignItems:'center'}}>
                        <input className="text-input" placeholder="Case ID" id="nda-caseid" />
                        <button className="btn-action" disabled={actionLoading || !!(contractDetails?.arbitrationService && contractDetails?.arbitrationService !== ethers.ZeroAddress)} onClick={() => handleNdaVote(document.getElementById('nda-caseid').value, true)}>Vote Approve</button>
                        <button className="btn-action" disabled={actionLoading || !!(contractDetails?.arbitrationService && contractDetails?.arbitrationService !== ethers.ZeroAddress)} onClick={() => handleNdaVote(document.getElementById('nda-caseid').value, false)}>Vote Reject</button>
                      </div>
                      {contractDetails?.arbitrationService && contractDetails.arbitrationService !== ethers.ZeroAddress && (
                        <small className="muted">Voting disabled (an on-chain ArbitrationService is configured for this NDA).</small>
                      )}
                      <div className="detail-item" style={{display:'flex', flexDirection:'column', gap:'6px'}}>
                        <label className="label">Create Dispute (Arbitrator)</label>
                        <input className="text-input" type="number" placeholder="Case ID" value={createDisputeCaseId} onChange={e => setCreateDisputeCaseId(e.target.value)} />
                        <input className="text-input" placeholder="Evidence digest 0x... (optional)" value={createDisputeEvidence} onChange={e => setCreateDisputeEvidence(e.target.value)} />
                        <button className="btn-action" disabled={actionLoading || !(contractDetails?.arbitrationService && contractDetails.arbitrationService !== ethers.ZeroAddress)} onClick={handleCreateDispute}>Create Dispute</button>
                      </div>
                        <div className="detail-item" style={{display:'flex', flexDirection:'column', gap:'6px'}}>
                        <label className="label">Resolve by Arbitrator</label>
                        <input className="text-input" type="number" placeholder="Case ID" value={arbCaseId} onChange={e => setArbCaseId(e.target.value)} />
                        <div style={{display:'flex', gap:'8px', alignItems:'center'}}>
                          <label><input type="checkbox" checked={arbApprove} onChange={e => setArbApprove(e.target.checked)} /> Approve</label>
                          <input className="text-input" placeholder="Beneficiary (0x...) optional" value={arbBeneficiary} onChange={e => setArbBeneficiary(e.target.value)} />
                          <button className="btn-action" disabled={actionLoading || !(isArbitrator || isAuthorizedArbitrator)} onClick={handleNdaResolveByArbitrator}>Resolve</button>
                        </div>
                        {!(isArbitrator || isAuthorizedArbitrator) && (
                          <small className="muted">Only the contract creator or platform arbitrator (via configured ArbitrationService) can resolve disputes on this template.</small>
                        )}
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
              <label>Evidence (short text or URL)</label>
              <textarea className="text-input" rows={4} value={disputeForm.evidence} onChange={e => setDisputeForm(s => ({...s, evidence: e.target.value}))} />
              <small className="muted">File uploads disabled. Paste evidence text or a hash in the field above.</small>
              <div style={{display:'flex', gap:'8px', marginTop: '8px'}}>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  <button className="btn-action primary" disabled={actionLoading} onClick={submitDisputeForm}>Submit Appeal</button>
                  {submitMessage ? <div style={{fontSize:12,color:'#666'}}>{submitMessage}</div> : null}
                </div>
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
                    {/* Admin decrypt button (client-side, transient key only) */}
                    <div style={{marginTop:12}}>
                      <button className="btn-sm" onClick={async () => {
                        setShowAdminDecryptModal(true);
                        setAdminDecrypted(null);
                        setAdminCiphertextReadOnly(false);
                        setAdminCiphertextInput('');
                        setFetchStatusMessage(null);
                        setFetchedUrl(null);
                        try {
                          const base = (import.meta.env && import.meta.env.VITE_EVIDENCE_FETCH_BASE) || '';
                          let guessed = '';
                          const maybe = (appealData && (appealData.evidence || appealData.evidenceDigest)) || null;
                          if (base && maybe && /^0x[0-9a-fA-F]{64}$/.test(String(maybe).trim())) {
                            const digestNo0x = String(maybe).trim().replace(/^0x/, '');
                            guessed = `${base.replace(/\/$/, '')}/${digestNo0x}.json`;
                            setFetchedUrl(guessed);
                            try {
                              const resp = await fetch(guessed);
                              if (resp.ok) {
                                const txt = await resp.text();
                                setAdminCiphertextInput(txt);
                                setAdminCiphertextReadOnly(true);
                                setFetchStatusMessage('Fetched canonical evidence JSON successfully.');
                              } else {
                                setAdminCiphertextInput(guessed);
                                setAdminCiphertextReadOnly(false);
                                setFetchStatusMessage(`Could not fetch canonical JSON: ${resp.status} ${resp.statusText}. You can open the URL and download the file, then paste the JSON here.`);
                              }
                            } catch (e) {
                              setAdminCiphertextInput(guessed);
                              setAdminCiphertextReadOnly(false);
                              setFetchStatusMessage('Could not fetch canonical JSON due to network/CORS restrictions. Open the URL below in a new tab and download the file, then paste the JSON into this textbox.');
                              try { console.debug('Fetch canonical evidence failed', e); } catch (_) {}
                            }
                          }
                        } catch (_) { setAdminCiphertextInput(''); }
                        // Do NOT auto-fill admin private key from env for security - leave empty so admin must paste/transiently enter it
                        setAdminPrivateKeyInput('');
                      }}>Admin decrypt (client)</button>
                    </div>
                      {showAdminDecryptModal && (
                      <div style={{position:'fixed', left:0, top:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center'}}>
                        <div style={{background:'#fff', padding:16, width:720, maxWidth:'95%', borderRadius:8}}>
                          <h4>Admin decrypt (client-side)</h4>
                          <div style={{fontSize:13, color:'#a33', marginBottom:8}}>Security: entering your private key here will only be used in this browser session and will not be saved. Prefer running server-side admin tools. Use only ephemeral keys if possible.</div>
                          <div style={{display:'flex', gap:12}}>
                            <div style={{flex:1}}>
                              <label>Ciphertext JSON or URL</label>
                              <textarea rows={6} value={adminCiphertextInput} onChange={e => setAdminCiphertextInput(e.target.value)} placeholder='Paste ciphertext JSON here or an HTTPS URL to fetch it' style={{width:'100%', boxSizing:'border-box'}} />
                            </div>
                            <div style={{width:320}}>
                              <label>Admin private key (transient)</label>
                              <input className="text-input" type="password" value={adminPrivateKeyInput} onChange={e => setAdminPrivateKeyInput(e.target.value)} placeholder="0x..." style={{width:'100%'}} autoComplete="new-password" aria-label="Admin private key" />
                              <div style={{fontSize:12, color:'#555', marginTop:8}}>If you provide a URL above, the client will attempt to fetch it via CORS. If the server blocks CORS, download the file and paste JSON here.</div>
                            </div>
                          </div>
                            <div style={{marginTop:12, display:'flex', gap:8, justifyContent:'flex-end'}}>
                            <button type="button" className="btn-sm" onClick={() => { setShowAdminDecryptModal(false); setFetchStatusMessage(null); setFetchedUrl(null); setAdminCiphertextReadOnly(false); }}>Close</button>
                            <button type="button" className="btn-sm primary" disabled={adminDecryptBusy} onClick={async () => {
                              setAdminDecryptBusy(true);
                              setAdminDecrypted(null);
                              try {
                                let payload = adminCiphertextInput && adminCiphertextInput.trim() || '';
                                if (!payload) { alert('Provide ciphertext JSON or URL to fetch'); setAdminDecryptBusy(false); return; }
                                if (/^https?:\/\//i.test(payload)) {
                                  try {
                                    const resp = await fetch(payload);
                                    if (!resp.ok) throw new Error('Failed to fetch ciphertext: ' + resp.statusText);
                                    payload = await resp.text();
                                  } catch (e) {
                                    alert('Failed to fetch ciphertext URL: ' + (e?.message || e));
                                    setAdminDecryptBusy(false);
                                    return;
                                  }
                                }
                                try {
                                  const plain = await decryptCiphertextJson(payload, adminPrivateKeyInput.trim());
                                  setAdminDecrypted(plain);
                                } catch (e) {
                                  alert('Decryption failed: ' + (e?.message || e));
                                }
                              } finally { setAdminDecryptBusy(false); }
                            }}>Decrypt</button>
                          </div>
                          <div style={{marginTop:12}}>
                            <label>Decrypted plaintext</label>
                            <pre style={{whiteSpace:'pre-wrap', maxHeight:240, overflow:'auto', background:'#fafafa', padding:8}}>{adminDecrypted || <span style={{color:'#888'}}>No plaintext yet</span>}</pre>
                          </div>
                          {fetchStatusMessage && (
                            <div style={{marginTop:10, padding:8, background:'#fff7e6', border:'1px solid #ffe0b2', borderRadius:6, color:'#663c00'}}>
                              {fetchStatusMessage}
                              {fetchedUrl && (
                                <div style={{marginTop:8}}>
                                  <button type="button" className="btn-sm" onClick={() => { try { window.open(fetchedUrl, '_blank'); } catch (_) { try { window.location.href = fetchedUrl; } catch (_) {} } }}>Open canonical URL</button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <p><strong>Submitted:</strong> {appealData.createdAt ? new Date(appealData.createdAt).toLocaleString() : '—'}</p>
                    <div style={{marginTop:6}}>
                      <strong>Evidence:</strong>
                      {appealData.evidence ? (
                        <div style={{marginTop:6, whiteSpace:'pre-wrap'}}>{appealData.evidence}</div>
                      ) : (appealData.evidenceDigest ? (
                        <div style={{marginTop:6}}>
                          <div style={{fontSize:13, color:'#333', marginBottom:6}}>Evidence DIGEST (on-chain):</div>
                          <pre style={{whiteSpace:'pre-wrap', wordBreak:'break-all', background:'#fafafa', padding:8}}>{appealData.evidenceDigest}</pre>
                          <div style={{marginTop:8, fontSize:12, color:'#555'}}>The full evidence payload is stored off-chain (encrypted). Contact the platform administrator to request decryption if you are authorized.</div>
                        </div>
                      ) : (
                        <span style={{marginLeft:6, color:'#888'}}>No evidence provided</span>
                      ))}
                    </div>
              {/* File attachments removed; no attached file name or local attachment links shown. */}
              {/* IPFS/file attachments removed — no external links to show */}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ContractModal;