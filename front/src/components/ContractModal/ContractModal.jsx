import { useState, useEffect, useMemo } from 'react';
import { useRef } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import { ContractService } from '../../services/contractService';
import { ethers } from 'ethers';
import { ArbitrationService } from '../../services/arbitrationService';
import { DocumentGenerator } from '../../utils/documentGenerator';
import { buildCidUrl } from '../../utils/ipfs';
import './ContractModal.css';

function ContractModal({ contractAddress, isOpen, onClose, readOnly = false }) {
  const { signer, chainId, account, provider } = useEthers();
  const [contractDetails, setContractDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [transactionHistory, setTransactionHistory] = useState([]);
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
  const [disputeFileName, setDisputeFileName] = useState('');
  const [disputeFileHash, setDisputeFileHash] = useState('');
  const [disputeFile, setDisputeFile] = useState(null);
  
  // NDA report states (replace ad-hoc DOM reads)
  const [ndaReportOffender, setNdaReportOffender] = useState('');
  const [ndaReportPenalty, setNdaReportPenalty] = useState('');
  const [ndaReportEvidenceText, setNdaReportEvidenceText] = useState('');
  const [ndaReportFileHash, setNdaReportFileHash] = useState('');
  const [createDisputeCaseId, setCreateDisputeCaseId] = useState('');
  const [createDisputeEvidence, setCreateDisputeEvidence] = useState('');
  const [rentSigning, setRentSigning] = useState(false);
  const [rentAlreadySigned, setRentAlreadySigned] = useState(false);
  const [rentCanSign, setRentCanSign] = useState(true);
  const [hasAppeal, setHasAppeal] = useState(false);
  const [arbResolution, setArbResolution] = useState(null);
  const [showAppealModal, setShowAppealModal] = useState(false);
  const [appealData, setAppealData] = useState(null);
  const [appealLocal, setAppealLocal] = useState(null);
  const [showPinnedModal, setShowPinnedModal] = useState(false);
  const [pinnedRecord, setPinnedRecord] = useState(null);
  const [pinnedDecrypted, setPinnedDecrypted] = useState(null);
  const [pinnedLoading, setPinnedLoading] = useState(false);
  const [pinnedError, setPinnedError] = useState(null);
  const [showRationale, setShowRationale] = useState(false);
  const [showDebugState, setShowDebugState] = useState(false);
  const latestArbResolutionRef = useRef(null);
  const latestArbKeyRef = useRef(null);

  const arbKeyFor = (p) => {
    try {
      if (!p) return null;
      const ca = String(p.contractAddress || '').toLowerCase();
      const d = String(p.decision || '').toLowerCase();
      const a = String(p.appliedAmount || '').toLowerCase();
      const cid = p.caseId != null ? String(p.caseId) : '';
      return `${ca}|${d}|${a}|${cid}`;
    } catch (_) { return null; }
  };

  const updateArbResolution = (payload) => {
    try {
      setArbResolution(payload);
    } catch (_) {}
    try { latestArbResolutionRef.current = payload; } catch (_) {}
    try { latestArbKeyRef.current = arbKeyFor(payload); } catch (_) {}
  };
  const [onchainReporterBondEth, setOnchainReporterBondEth] = useState('0');
  const [appealRequestedWei, setAppealRequestedWei] = useState(0n);
  const [appealReporterBondWei, setAppealReporterBondWei] = useState(0n);
  const [appealRequiredDepositWei, setAppealRequiredDepositWei] = useState(0n);
  const [appealTotalWei, setAppealTotalWei] = useState(0n);
  const [appealRequestedEth, setAppealRequestedEth] = useState('0');
  const [appealReporterBondEthLocal, setAppealReporterBondEthLocal] = useState('0');
  const [appealRequiredDepositEth, setAppealRequiredDepositEth] = useState('0');
  const [appealTotalEth, setAppealTotalEth] = useState('0');
  const [appealActionLoading, setAppealActionLoading] = useState(false);

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
    let mounted = true;
    const fetchOnchainBond = async () => {
      try {
        if (!appealLocal || !contractDetails || !signer) return;
        if (!appealLocal.caseId) return;
        const svc = new ContractService(signer, chainId);
        const b = await svc.getDisputeBond(contractDetails.address, Number(appealLocal.caseId)).catch(() => 0n);
        try { if (mounted) setOnchainReporterBondEth((await import('ethers')).formatEther(b)); } catch { if (mounted) setOnchainReporterBondEth(String(b)); }
      } catch (e) {
        console.debug('Could not read on-chain reporter bond for appeal', e);
      }
    };
    fetchOnchainBond();
    return () => { mounted = false; };
  }, [appealLocal, contractDetails, signer, chainId]);

  // Compute appeal breakdown amounts for display (requested, reporter bond, required deposit, total)
  useEffect(() => {
    let mounted = true;
    const compute = async () => {
      try {
        if (!appealLocal || !contractDetails || !signer) {
          setAppealRequestedWei(0n); setAppealReporterBondWei(0n); setAppealRequiredDepositWei(0n); setAppealTotalWei(0n);
          setAppealRequestedEth('0'); setAppealReporterBondEthLocal('0'); setAppealRequiredDepositEth('0'); setAppealTotalEth('0');
          return;
        }
        const svc = new ContractService(signer, chainId);
        let requestedWei = 0n;
        try {
          if (appealLocal.amountEth) requestedWei = BigInt(ethers.parseEther(String(appealLocal.amountEth)));
          else if (appealLocal?.caseId != null) {
            const rent = await svc.getRentContract(contractDetails.address);
            const d = await rent.getDispute(appealLocal.caseId).catch(() => null);
            if (d) requestedWei = BigInt(d[2] || 0n);
          }
        } catch (_) { requestedWei = 0n; }

        // Use fixed reporter bond (0.002 ETH) for UI calculations
        let reporterBondWei = 0n;
        try {
          const fixed = BigInt(await (await import('ethers')).parseEther('0.002'));
          reporterBondWei = fixed;
        } catch (_) { reporterBondWei = 0n; }

        let requiredDepositWei = 0n;
        try { const rent = await svc.getRentContract(contractDetails.address); requiredDepositWei = BigInt(await rent.requiredDeposit().catch(() => 0n)); } catch (_) { requiredDepositWei = 0n; }

        const total = requestedWei + reporterBondWei + requiredDepositWei;
        if (!mounted) return;
        setAppealRequestedWei(requestedWei);
        setAppealReporterBondWei(reporterBondWei);
        setAppealRequiredDepositWei(requiredDepositWei);
        setAppealTotalWei(total);
        try { setAppealRequestedEth(ethers.formatEther(requestedWei)); } catch { setAppealRequestedEth(String(requestedWei)); }
        try { setAppealReporterBondEthLocal(ethers.formatEther(reporterBondWei)); } catch { setAppealReporterBondEthLocal(String(reporterBondWei)); }
        try { setAppealRequiredDepositEth(ethers.formatEther(requiredDepositWei)); } catch { setAppealRequiredDepositEth(String(requiredDepositWei)); }
        try { setAppealTotalEth(ethers.formatEther(total)); } catch { setAppealTotalEth(String(total)); }
      } catch (e) {
        console.debug('Could not compute appeal breakdown', e);
      }
    };
    compute();
    return () => { mounted = false; };
  }, [appealLocal, contractDetails, signer, chainId]);

  // Listen for transaction records emitted by other components (e.g., ResolveModal)
  useEffect(() => {
    const handler = (ev) => {
      try {
        const d = ev?.detail;
        if (!d) return;
        setTransactionHistory(prev => [d, ...(prev || [])]);
      } catch (_) {}
    };
    window.addEventListener('transaction:record', handler);
    return () => window.removeEventListener('transaction:record', handler);
  }, []);

  // When deposits or bonds are posted elsewhere, ContractService emits 'deposit:updated'. Reload persisted txs.
  useEffect(() => {
    const reload = async () => {
      try {
        if (!contractAddress) return;
        const txs = await ContractService.getTransactions(contractAddress).catch(() => []);
        if (txs && Array.isArray(txs)) setTransactionHistory(txs);
      } catch (_) {}
    };
    const h = () => { reload(); };
    const arbResolvedHandler = (ev) => {
      try {
        const d = ev?.detail;
        if (!d) return;
        // Debug log for developer to confirm handler fired and payload
        try { console.debug('arb:resolved received in ContractModal', { payload: d, target: contractAddress }); } catch (_) {}
        // If the event targets this contract, persist the resolution locally and refresh on-chain state
        if (String(d.contractAddress).toLowerCase() === String(contractAddress).toLowerCase()) {
          try {
            const payload = d;
            const pk = `arbResolution:${String(contractAddress).toLowerCase()}`;
            try { localStorage.setItem(pk, JSON.stringify(payload)); } catch (_) {}
            updateArbResolution(payload);
            setHasAppeal(false);
            setAppealLocal(null);
            // After receiving the event, re-fetch on-chain details to confirm the template's `active()` state
            (async () => {
              try {
                const svc = new ContractService(signer, chainId);
                const refreshed = await svc.getRentContractDetails(contractAddress).catch(() => null);
                if (refreshed) {
                  setContractDetails(refreshed);
                } else {
                  // If we couldn't refresh details (ABI differences, etc.), fall back to optimistic UI update
                  if (payload && payload.decision === 'approve') {
                    setContractDetails(prev => prev ? {...prev, isActive: false, status: 'Inactive'} : prev);
                  }
                }
              } catch (refreshErr) {
                console.debug('Could not refresh contract details after arb:resolved', refreshErr);
                if (payload && payload.decision === 'approve') {
                  setContractDetails(prev => prev ? {...prev, isActive: false, status: 'Inactive'} : prev);
                }
              }
            })();
            // Persisted and updated component state; do not re-dispatch an app-wide event here to avoid read->write loops
          } catch (err) {
            try { console.debug('arbResolvedHandler inner error', err); } catch (_) {}
          }
        }
      } catch (err) { try { console.debug('arbResolvedHandler error', err); } catch (_) {} }
    };
    window.addEventListener('deposit:updated', h);
    window.addEventListener('arb:resolved', arbResolvedHandler);
    return () => {
      window.removeEventListener('deposit:updated', h);
      window.removeEventListener('arb:resolved', arbResolvedHandler);
    };
  }, [contractAddress]);

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
      // Best-effort: if there is no local incomingDispute marker but a dispute was
      // resolved on-chain, detect it here and persist arbResolution so UI updates.
      try {
        if (details?.type === 'Rental') {
          const svc = new ContractService(signer, chainId);
          try {
            const rent = await svc.getRentContract(contractAddress);
            // First try to read disputes via getters
            const count = Number(await rent.getDisputesCount().catch(() => 0));
            if (count > 0) {
              for (let i = count - 1; i >= 0; i--) {
                try {
                  const d = await rent.getDispute(i).catch(() => null);
                  if (d && d[4]) { // resolved
                    const approved = !!d[5];
                    const applied = d[6] ? BigInt(d[6]).toString() : '0';
                    // Try to read on-chain rationale/classification and evidence CID when available
                    let meta = null;
                    let withCid = null;
                    try {
                      meta = await rent.getDisputeMeta(i).catch(() => null);
                    } catch (_) { meta = null; }
                    try {
                      withCid = await rent.getDisputeWithCid?.(i).catch(() => null);
                    } catch (_) { withCid = null; }
                    const payload = { contractAddress, decision: approved ? 'approve' : 'deny', appliedAmount: applied, caseId: i, timestamp: Date.now() };
                    if (meta) {
                      try { payload.classification = meta[0] || null; payload.rationale = meta[1] || null; } catch (_) {}
                    }
                    if (withCid) {
                      try { payload.evidenceCid = withCid[4] || null; } catch (_) {}
                    }
                    try { localStorage.setItem(`arbResolution:${String(contractAddress).toLowerCase()}`, JSON.stringify(payload)); } catch (_) {}
                    updateArbResolution(payload);
                    // Reflect resolved state in UI immediately
                    try { setContractDetails(prev => prev ? {...prev, isActive: false, status: 'Inactive'} : prev); } catch (_) {}
                    break;
                  }
                } catch (_) {}
              }
            } else {
              // Fallback: scan logs for DisputeResolved events (if contract exposes events but no getters)
              try {
                const filters = rent.filters?.DisputeResolved?.() || [];
                if (filters) {
                  const evs = await rent.queryFilter(rent.filters.DisputeResolved());
                  if (evs && evs.length) {
                    const last = evs[evs.length - 1];
                    const approved = last.args?.approved ?? true;
                    const applied = last.args?.appliedAmount ? BigInt(last.args.appliedAmount).toString() : '0';
                    const payload = { contractAddress, decision: approved ? 'approve' : 'deny', appliedAmount: applied, caseId: last.args?.caseId ?? null, timestamp: Date.now() };
                    try { localStorage.setItem(`arbResolution:${String(contractAddress).toLowerCase()}`, JSON.stringify(payload)); } catch (_) {}
                    updateArbResolution(payload);
                    try { setContractDetails(prev => prev ? {...prev, isActive: false, status: 'Inactive'} : prev); } catch (_) {}
                    try { /* updateArbResolution already updated refs; avoid emitting here */ } catch (_) {}
                  }
                }
              } catch (_) {}
            }
          } catch (_) {}
        }
      } catch (_) {}
      // Load persisted transactions for this contract (bond/deposit records shared across roles)
      try {
        const persisted = await ContractService.getTransactions(contractAddress).catch(() => []);
        if (persisted && Array.isArray(persisted) && persisted.length) {
          setTransactionHistory(persisted);
        } else {
          setTransactionHistory([]);
        }
      } catch (_) { setTransactionHistory([]); }
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
        if (js) {
          try {
            const parsed = JSON.parse(js);
            setAppealLocal(parsed);
            // If we have a local incomingDispute marker, verify on-chain whether the case was resolved.
            try {
              const svc = new ContractService(signer, chainId);
              // attempt both Rent and NDA contracts depending on details.type
              if (details?.type === 'Rental') {
                const rent = await svc.getRentContract(contractAddress);
                if (parsed.caseId != null) {
                  const d = await rent.getDispute(Number(parsed.caseId)).catch(() => null);
                  if (d && d[4]) { // resolved == true
                    // remove local incomingDispute markers so UI won't show unresolved appeal
                    try { localStorage.removeItem(`incomingDispute:${contractAddress}`); } catch (_) {}
                    try { localStorage.removeItem(`incomingDispute:${String(contractAddress).toLowerCase()}`); } catch (_) {}
                    try { sessionStorage.removeItem('incomingDispute'); } catch (_) {}
                    setHasAppeal(false);
                    setAppealLocal(null);
                    // capture on-chain resolution locally for UI
                    const approved = !!d[5];
                    const applied = d[6] ? BigInt(d[6]).toString() : '0';
                    const payload = { contractAddress, decision: approved ? 'approve' : 'deny', appliedAmount: applied, timestamp: Date.now() };
                    try { localStorage.setItem(`arbResolution:${String(contractAddress).toLowerCase()}`, JSON.stringify(payload)); } catch (_) {}
                    updateArbResolution(payload);
                    try { setContractDetails(prev => prev ? {...prev, isActive: false, status: 'Inactive'} : prev); } catch (_) {}
                  }
                }
              } else if (details?.type === 'NDA') {
                const nda = await svc.getNDAContract(contractAddress);
                if (parsed.caseId != null) {
                  const d = await nda.getDispute(Number(parsed.caseId)).catch(() => null);
                  if (d && d[4]) {
                    try { localStorage.removeItem(`incomingDispute:${contractAddress}`); } catch (_) {}
                    try { localStorage.removeItem(`incomingDispute:${String(contractAddress).toLowerCase()}`); } catch (_) {}
                    try { sessionStorage.removeItem('incomingDispute'); } catch (_) {}
                    setHasAppeal(false);
                    setAppealLocal(null);
                    const approved = !!d[5];
                    const applied = d[6] ? BigInt(d[6]).toString() : '0';
                    const payload = { contractAddress, decision: approved ? 'approve' : 'deny', appliedAmount: applied, timestamp: Date.now() };
                    try { localStorage.setItem(`arbResolution:${String(contractAddress).toLowerCase()}`, JSON.stringify(payload)); } catch (_) {}
                    updateArbResolution(payload);
                    try { setContractDetails(prev => prev ? {...prev, isActive: false, status: 'Inactive'} : prev); } catch (_) {}
                  }
                }
              }
            } catch (checkErr) {
              // best-effort only; ignore errors here
            }
          } catch (_) { setAppealLocal(null); }
        } else {
          setAppealLocal(null);
        }
        // load any local arbitrator resolution for this contract
        try {
          const rk = `arbResolution:${String(contractAddress).toLowerCase()}`;
          const rjs = localStorage.getItem(rk);
          if (rjs) {
            setArbResolution(JSON.parse(rjs));
          } else {
            setArbResolution(null);
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
        const transactions = await Promise.all(paymentEvents.map(async (event) => {
          const blk = await (signer?.provider || provider).getBlock(event.blockNumber);
          return {
            hash: event.transactionHash,
            amount: ethers.formatEther(event.args.amount),
            date: blk?.timestamp ? new Date(Number(blk.timestamp) * 1000).toLocaleDateString() : '—',
            payer: event.args.tenant
          };
        }));
        // Merge persisted client-side txs (e.g., reporter bond saved to localStorage) with on-chain RentPaid events
        try {
          const persisted = await ContractService.getTransactions(contractAddress).catch(() => []);
          const seen = new Set();
          const merged = [];
          if (persisted && Array.isArray(persisted)) {
            for (const p of persisted) {
              const h = p?.hash || p?.tx || null;
              if (h) seen.add(String(h));
              merged.push(p);
            }
          }
          for (const ev of transactions) {
            const h = ev.hash || ev.tx || null;
            if (!h || !seen.has(String(h))) merged.push(ev);
          }
          setTransactionHistory(merged);
        } catch (err) {
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
          // Merge persisted client-side txs for NDA timelines so reporter bond entries appear
          try {
            const persisted = await ContractService.getTransactions(contractAddress).catch(() => []);
            const merged = [];
            const seen = new Set();
            if (persisted && Array.isArray(persisted)) {
              for (const p of persisted) {
                merged.push(p);
                if (p?.hash) seen.add(String(p.hash));
              }
            }
            for (const e of ev) {
              if (!e.tx || !seen.has(String(e.tx))) merged.push(e);
            }
            setTransactionHistory(merged);
          } catch (_) {
            setTransactionHistory(ev);
          }
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

  // When the modal opens (or contract/signers change) load contract data
  useEffect(() => {
    if (!isOpen || !contractAddress) return;
    let mounted = true;
    // call loader (which manages its own loading state)
    (async () => {
      try {
        await loadContractData();
      } catch (e) {
        // swallow - loadContractData already logs errors
      }
    })();
    return () => { mounted = false; };
  }, [isOpen, contractAddress, signer, chainId, account, provider]);

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
      // If not configured on contract, attempt frontend global artifacts
      if (!arbAddr) {
        try {
          const cfMod = await import('../../utils/contracts/ContractFactory.json');
          const cf = cfMod?.default ?? cfMod;
          arbAddr = cf?.contracts?.ArbitrationService || null;
        } catch (_) { arbAddr = null; }
        if (!arbAddr) {
          try {
            const mcMod = await import('../../utils/contracts/MockContracts.json');
            const mc = mcMod?.default ?? mcMod;
            arbAddr = mc?.contracts?.ArbitrationService || null;
          } catch (_) { arbAddr = null; }
        }
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
      const fixedBondWei = BigInt(await (await import('ethers')).parseEther('0.002'));
      const { receipt } = await service.ndaReportBreach(contractAddress, offender, penalty, evidence, fixedBondWei);
      // persist the reporter bond/report transaction to tx history
      try {
        const ethersMod = await import('ethers');
        const txHash = receipt?.transactionHash || receipt?.hash || null;
        await ContractService.saveTransaction(contractAddress, {
          type: 'bond', amountWei: String(fixedBondWei), amount: ethersMod.formatEther(fixedBondWei), date: new Date().toLocaleString(), hash: txHash, raw: receipt, payer: account || null
        }).catch(() => null);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('transaction:record', { detail: { amount: ethersMod.formatEther(fixedBondWei), date: new Date().toLocaleString(), hash: txHash, raw: receipt } }));
          window.dispatchEvent(new Event('deposit:updated'));
        }
      } catch (_) {}
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
  // prefer explicit evidence text (including text file contents) if present, otherwise fall back to file hash
  const evidence = disputeForm.evidence || disputeFileHash || '';
  // If a file was attached and a local pin-server is available, upload it and include CID
  let cid = null;
  let cidUrl = null;
  let localIdbKey = null;
  try {
    if (disputeFile) {
      // Always store file locally in IndexedDB for no-cost evidence sharing in the same browser
      try {
        const { idbPut } = await import('../../utils/idb');
        const key = `dispute-file:${contractAddress}:${Date.now()}`;
        const buf = await disputeFile.arrayBuffer();
        await idbPut(key, { name: disputeFile.name || '', bytes: new Uint8Array(buf), createdAt: Date.now() });
        localIdbKey = key;
      } catch (e) {
        console.error('Failed to store file locally:', e);
      }
    }
    // Attempt to pin the evidence (text or binary) to local pin-server for durable storage.
    // If the environment provides an ADMIN_PUBLIC_KEY in localStorage we will encrypt
    // the evidence for that recipient before pinning.
    try {
      const pinServer = (process.env.REACT_APP_PIN_SERVER_URL) || 'http://localhost:3002';
      // craft payload: prefer full text evidence, otherwise use attached file bytes
      let toPin = disputeForm.evidence || '';
      if (!toPin && disputeFile) {
        try { const buf = await disputeFile.arrayBuffer(); toPin = Buffer.from(buf).toString('base64'); } catch (_) { toPin = ''; }
      }
      if (toPin) {
        let cipherStr = toPin;
        try {
          // Prefer build-time Vite env variable, otherwise allow a localStorage override
          const envKey = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ADMIN_PUBLIC_KEY) ? import.meta.env.VITE_ADMIN_PUBLIC_KEY : null;
          const adminKey = envKey || localStorage.getItem('ADMIN_PUBLIC_KEY');
          if (adminKey) {
            const { encryptForRecipient } = await import('../../utils/crypto');
            cipherStr = await encryptForRecipient(adminKey, toPin);
          }
        } catch (e) { console.debug('Encryption failed, falling back to plain text pin', e); }
        try {
          const resp = await fetch(`${pinServer}/pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cipherStr, meta: { contractAddress, reporter: account || null, fileName: disputeFileName || null } }) });
          if (resp && resp.ok) {
            const j = await resp.json().catch(() => null);
            if (j && j.cid) { cid = j.cid; cidUrl = `${pinServer}/pin/${j.id}` || null; }
            // persist returned id locally for debugging
            try { if (j && j.id) localStorage.setItem(`pin:${contractAddress}:${j.id}`, JSON.stringify(j)); } catch (_) {}
          }
        } catch (pinErr) { console.debug('Pin server error, continuing without CID', pinErr); }
      }
    } catch (pinOuter) { console.debug('Pin step failed', pinOuter); }

    // Include fixed reporter bond (0.002 ETH) in the initial report transaction
  const fixedBondWei = BigInt(await (await import('ethers')).parseEther('0.002'));
  // If we successfully pinned evidence, send the returned CID on-chain so the contract stores a durable reference.
  const evidenceToSend = cid || evidence || '';
  const { caseId, receipt } = await svc.reportRentDispute(contractAddress, Number(disputeForm.dtype || 0), amountWei, evidenceToSend, fixedBondWei, cid || '');
      // Persist the full form for the arbitrator UI and navigate to Arbitration page
    try {
      const incoming = {
        contractAddress: contractAddress,
        dtype: Number(disputeForm.dtype || 0),
        amountEth: String(disputeForm.amountEth || '0'),
        evidence: evidence || '',
        fileName: disputeFileName || '',
        cid: cid || null,
        cidUrl: cidUrl || null,
        localIdbKey: localIdbKey || null,
        reporter: account || null,
        caseId: caseId != null ? String(caseId) : null,
        createdAt: new Date().toISOString()
      };
        sessionStorage.setItem('incomingDispute', JSON.stringify(incoming));
        // Reporter bond was included in the report transaction above; mark incoming as paid
        try {
          incoming.paid = true;
          incoming.paidAt = Date.now();
          incoming.paidAmountEth = (await import('ethers')).formatEther(fixedBondWei);
          // Persist the report/bond transaction into per-contract tx history so it appears immediately
          try {
            const ethersMod = await import('ethers');
            const txHash = receipt?.transactionHash || receipt?.hash || null;
            await ContractService.saveTransaction(contractAddress, {
              type: 'bond',
              amountWei: String(fixedBondWei),
              amount: ethersMod.formatEther(fixedBondWei),
              date: new Date().toLocaleString(),
              hash: txHash,
              raw: receipt,
              payer: account || null
            }).catch(() => null);
            // notify any listeners (e.g., ContractModal transaction list)
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('transaction:record', { detail: { amount: ethersMod.formatEther(fixedBondWei), date: new Date().toLocaleString(), hash: txHash, raw: receipt } }));
              window.dispatchEvent(new Event('deposit:updated'));
            }
          } catch (saveErr) {
            console.debug('Failed to persist report tx', saveErr);
          }
        } catch (errOuter) {
          console.debug('Mark incoming paid failed', errOuter);
        }
        // Persist for global arbitration view
        sessionStorage.setItem('incomingDispute', JSON.stringify(incoming));
        // Also persist a per-contract appeal so reporters/participants can view it via "Show Appeal"
        try {
          const perKey = `incomingDispute:${contractAddress}`;
          localStorage.setItem(perKey, JSON.stringify(incoming));
        } catch (e) {
          console.warn('Failed to persist per-contract incomingDispute', e);
        }
    } catch (e) {
      console.error('Failed to persist dispute for arbitration page:', e);
    }

    setShowDisputeForm(false);
    // Redirect to arbitration page only if the connected account is the arbitrator
    try {
      const svc2 = new ContractService(signer, chainId);
      const isAuthorized = await svc2.isAuthorizedArbitratorForContract(contractAddress).catch(() => false);
      if (isAuthorized) {
        // persist incomingDispute (already saved) and navigate arbitrator view
        window.location.pathname = '/arbitration';
      } else {
        // For ordinary users (e.g. landlord/tenant) show confirmation and return to dashboard
        alert('Dispute submitted. The platform arbitrator will review the case. You will be notified of updates.');
        window.location.pathname = '/dashboard';
      }
    } catch (redirErr) {
      console.warn('Failed to detect arbitrator state, defaulting to dashboard redirect', redirErr);
      window.location.pathname = '/dashboard';
    }
    // still refresh data for modal (in case user navigates back)
    await loadContractData();
  } catch (err) {
    console.error('Submit dispute failed:', err);
    alert(`Failed to submit dispute: ${err?.reason || err?.message || err}`);
  } finally {
    setActionLoading(false);
  }
    } catch (err) {
    // outer catch (kept for safety) — should be unreachable
    console.error('Unexpected error in submitDisputeForm:', err);
    alert(`Failed to submit dispute: ${err?.reason || err?.message || err}`);
    setActionLoading(false);
  }
  };

  const handleDisputeFileChange = async (evt) => {
    try {
      const f = evt.target.files && evt.target.files[0];
      if (!f) return;
      setDisputeFileName(f.name || '');
      setDisputeFile(f);
      // If the attached file is textual, read it as text and store the full content
      try {
        const isText = (f.type && f.type.indexOf('text/') === 0) || /\.(txt|md|json|csv|html?)$/i.test(f.name || '');
        if (isText) {
          const txt = await f.text();
          setDisputeForm(s => ({ ...s, evidence: txt }));
          // compute a hash for reference but keep the full text as evidence
          try { const buf = await f.arrayBuffer(); const bytes = new Uint8Array(buf); const hash = ethers.keccak256(bytes); setDisputeFileHash(hash); } catch (_) { setDisputeFileHash(''); }
        } else {
          // Non-text files: store bytes in IndexedDB and leave the human-facing evidence field
          const buf = await f.arrayBuffer();
          const bytes = new Uint8Array(buf);
          const hash = ethers.keccak256(bytes);
          setDisputeFileHash(hash);
          // Do not place the raw binary into localStorage; keep a readable note in the evidence field
          setDisputeForm(s => ({ ...s, evidence: `Attached file: ${f.name}` }));
        }
      } catch (e) {
        console.error('Failed to process dispute file:', e);
        // fallback: compute hash and set as evidence
        try { const buf = await f.arrayBuffer(); const bytes = new Uint8Array(buf); const hash = ethers.keccak256(bytes); setDisputeFileHash(hash); setDisputeForm(s => ({...s, evidence: hash})); } catch (_) { setDisputeFileHash(''); }
      }
    } catch (e) {
      console.error('Failed to hash file:', e);
      alert('Failed to process file for evidence.');
    }
  };

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

  // Fetch audit record from pin-server and attempt client-side decryption
  const fetchPinnedRecord = async (id) => {
    try {
      setPinnedError(null);
      setPinnedLoading(true);
      setPinnedRecord(null);
      setPinnedDecrypted(null);
      const pinServer = (process.env.REACT_APP_PIN_SERVER_URL) || 'http://localhost:3002';
      const apiKey = localStorage.getItem('PIN_SERVER_API_KEY') || null;
      // Fetch the audit record first (may be public metadata)
      const headers = apiKey ? { 'X-API-KEY': apiKey } : {};
      const resp = await fetch(`${pinServer}/pin/${id}`, { headers });
      if (!resp.ok) throw new Error(`Pin server returned ${resp.status}`);
      const rec = await resp.json();
      setPinnedRecord(rec);

      // If admin API key is available, request server-side decryption for the record
      if (apiKey) {
        try {
          const dr = await fetch(`${pinServer}/admin/decrypt/${id}`, { method: 'POST', headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
          if (dr && dr.ok) {
            const jd = await dr.json().catch(() => null);
            if (jd && jd.decrypted) setPinnedDecrypted(jd.decrypted);
          } else {
            const txt = await dr.text().catch(() => '');
            setPinnedError(`Decrypt failed: ${dr.status} ${txt}`);
          }
        } catch (deErr) {
          setPinnedError(String(deErr));
        }
      } else {
        // no API key: server-side decrypt not attempted. Admins should set PIN_SERVER_API_KEY in localStorage for automatic server-side decrypt.
        setPinnedError('Server-side decryption not performed: set PIN_SERVER_API_KEY in localStorage for admin decrypt.');
      }

      setPinnedLoading(false);
      return rec;
    } catch (e) {
      setPinnedError(String(e));
      setPinnedLoading(false);
      throw e;
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
      // If the appeal has a localIdbKey, load the file preview from IndexedDB
      if (obj.localIdbKey) {
        try {
          const { idbGet } = await import('../../utils/idb');
          const fileRec = await idbGet(obj.localIdbKey);
          if (fileRec && fileRec.bytes) {
            const blob = new Blob([fileRec.bytes], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            obj._localFileUrl = url;
            obj._localFileName = fileRec.name || 'attachment';
          }
        } catch (e) {
          console.warn('Failed to load attached file from IDB', e);
        }
      }
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

  // use shared buildCidUrl from utils

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
  evidence: (!evidenceText && appealData.evidence) ? appealData.evidence : null,
        fileName: appealData.fileName || null,
        cidUrl: appealData.cidUrl || null,
        note: (!evidenceText && appealData._localFileUrl) ? `Attached file available at: ${appealData._localFileUrl}` : undefined
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
            <button className="btn-sm" onClick={() => setShowDebugState(s => !s)} style={{marginRight:6}}>Debug</button>
            {( (arbResolution && arbResolution.rationale) || (appealLocal && appealLocal.evidence) ) && (
              <button className="btn-sm" onClick={() => setShowRationale(s => !s)} style={{marginRight:6}}>Show Rationale</button>
            )}
            <button className="modal-close" onClick={onClose}>
              <i className="fas fa-times"></i>
            </button>
          </div>
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
                    {arbResolution ? (
                      <span className={`status-badge resolved`}>
                        {arbResolution.decision === 'approve' ? 'Resolved: Approved' : 'Resolved: Denied'}
                      </span>
                    ) : (
                      <span className={`status-badge ${contractDetails.isActive ? 'active' : 'inactive'}`}>
                        {contractDetails.isActive ? 'Active' : 'Inactive'}
                      </span>
                    )}
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
                            {p ? `${String(p).slice(0,10)}...${String(p).slice(-8)}` : '—'}
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
                          <div className="tx-date">{
                            (() => {
                              try {
                                // If we have a locally persisted arbitration resolution for this contract
                                // and it targets this caseId, prefer that display instead of on-chain case.resolved
                                if (arbResolution && arbResolution.caseId != null) {
                                  // Normalize both to numbers for comparison
                                  const rid = Number(arbResolution.caseId);
                                  const cid = Number(c.id);
                                  if (!Number.isNaN(rid) && rid === cid) {
                                    return arbResolution.decision === 'approve' ? 'Resolved: Approved' : 'Resolved: Denied';
                                  }
                                }
                                return c.resolved ? (c.approved ? 'Approved' : 'Rejected') : 'Pending';
                              } catch (_) {
                                return c.resolved ? (c.approved ? 'Approved' : 'Rejected') : 'Pending';
                              }
                            })()
                          }</div>
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
                {arbResolution && (
                  <div className="alert info">Arbitration decision: <strong>{arbResolution.decision}</strong> (saved locally at {new Date(arbResolution.timestamp).toLocaleString()})</div>
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
                      {/* Withdraws are handled automatically when transfers succeed; if a pull-payment exists show info */}
                      {Number(withdrawableAmt || '0') > 0 ? (
                        <div className="alert info">You have a pull-payment available ({withdrawableAmt} ETH). Use the Owner dashboard to withdraw if needed.</div>
                      ) : (
                        <div className="muted">No withdrawable balance on-chain; recent arbitration transfers may have been sent directly to recipients.</div>
                      )}
                    </div>
                  ) : (
                    <div className="alert info">Only the tenant can pay this contract. Connect as the tenant to make payments.</div>
                  )}
                </div>

                {/* Appeal-specific actions (only after a complaint is filed and only for reporter/defendant) */}
                {appealLocal && contractDetails && (
                  <div className="appeal-actions" style={{marginTop:12, padding:12, border:'1px solid #eee', borderRadius:6, background:'#fcfcfc'}}>
                    <h4>Appeal Actions</h4>
                    {(() => {
                      const reporter = (appealLocal.reporter || '').toLowerCase();
                      const landlord = (contractDetails.landlord || '').toLowerCase();
                      const tenant = (contractDetails.tenant || '').toLowerCase();
                      const defendant = reporter === landlord ? tenant : landlord;
                      const isReporterLocal = account && account.toLowerCase() === reporter;
                      const isDefendantLocal = account && account.toLowerCase() === defendant;
                      return (
                        <div>
                          {isReporterLocal ? (
                            <p className="muted">You filed a complaint. To proceed, post the reporter bond (ANTI-SPAM) to demonstrate your claim. Press the button to post the bond.</p>
                          ) : isDefendantLocal ? (
                            <p className="muted">A complaint was filed against you. To appeal you must deposit the security covering the claim. Below is a breakdown of the amounts that make up the total required deposit. Press Deposit to submit the full amount.</p>
                          ) : (
                            <p className="muted">A complaint was filed with the arbitrator. Only the reporter and the defendant can act on this appeal.</p>
                          )}
                        </div>
                      );
                    })()}
                    {(() => {
                      const reporter = (appealLocal.reporter || '').toLowerCase();
                      const landlord = (contractDetails.landlord || '').toLowerCase();
                      const tenant = (contractDetails.tenant || '').toLowerCase();
                      const defendant = reporter === landlord ? tenant : landlord;
                      const isReporterLocal = account && account.toLowerCase() === reporter;
                      const isDefendantLocal = account && account.toLowerCase() === defendant;
                      return (
                        <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
                          {isReporterLocal && !appealLocal?.paid ? (
                            // Bond is paid with the initial report transaction. If you filed the complaint
                            // the bond should already be included; if you see this message, check your
                            // transaction history to confirm the report tx completed with the bond.
                            <div className="muted">Reporter bond is paid when you submit the appeal. Check your transaction history for the report transaction.</div>
                          ) : null}

                                {isDefendantLocal && (
                            <div style={{display:'flex', flexDirection:'column', gap:8}}>
                                <div style={{fontSize:13}}>
                                <div>Requested (claim): <strong>{appealRequestedEth} ETH</strong></div>
                                <div>Reporter bond (fixed): <strong>{appealReporterBondEthLocal} ETH</strong></div>
                                <div>Required deposit (contract): <strong>{appealRequiredDepositEth} ETH</strong></div>
                                <div style={{marginTop:6}}>Total required from defendant: <strong>{(() => { try { return ethers.formatEther(BigInt(appealRequestedWei||0n) + BigInt(appealRequiredDepositWei||0n)); } catch { return String(BigInt(appealRequestedWei||0n) + BigInt(appealRequiredDepositWei||0n)); } })()} ETH</strong></div>
                              </div>
                              {( () => {
                                // Determine whether the current connected account has paid the defendant portion
                                try {
                                  const me = account ? String(account).toLowerCase() : null;
                                  // 1) If appealLocal records a paidBy matching me
                                  if (appealLocal && appealLocal.paid && appealLocal.paidBy && me && String(appealLocal.paidBy).toLowerCase() === me) return true;
                                  // 2) Otherwise, check persisted transaction history for a deposit paid by me
                                  if (Array.isArray(transactionHistory) && transactionHistory.length > 0 && me) {
                                    for (const p of transactionHistory) {
                                      try {
                                        if (p && p.type === 'deposit') {
                                          const payer = p.payer ? String(p.payer).toLowerCase() : (p.raw && p.raw.from ? String(p.raw.from).toLowerCase() : null);
                                          if (payer && payer === me) return true;
                                        }
                                      } catch (_) {}
                                    }
                                  }
                                } catch (_) {}
                                return false;
                              })() ? (
                                <div style={{padding:8, borderRadius:6, background:'#eef8ee', border:'1px solid #cfe9cf'}}>
                                  <strong>Deposit received</strong>
                                  <div style={{fontSize:13, marginTop:6}}>
                                    {(() => {
                                      try {
                                        if (appealLocal.paidAmountEth) return `Paid: ${appealLocal.paidAmountEth} ETH`;
                                        if (appealLocal.paidAmountWei) return `Paid: ${(ethers.formatEther(BigInt(appealLocal.paidAmountWei)))} ETH`;
                                        return 'Paid: —';
                                      } catch (_) { return 'Paid: —'; }
                                    })()}
                                  </div>
                                  <div style={{marginTop:6}}>
                                    {appealLocal.paidTxHash ? (
                                      <>
                                        <span style={{fontSize:12}}>Tx: {String(appealLocal.paidTxHash).slice(0,10)}...{String(appealLocal.paidTxHash).slice(-8)}</span>
                                        <button className="btn-copy" style={{marginLeft:8}} onClick={() => { navigator.clipboard?.writeText(appealLocal.paidTxHash); }}>Copy</button>
                                      </>
                                    ) : (
                                      <span style={{fontSize:12}} className="muted">No tx recorded</span>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                                  {/* Deposit full total (excluding reporter bond) */}
                                  <button className="btn-secondary" disabled={appealActionLoading || !(BigInt(appealRequestedWei||0n) + BigInt(appealRequiredDepositWei||0n))} onClick={async () => {
                                    try {
                                      setAppealActionLoading(true);
                                      const svc = new ContractService(signer, chainId);
                                      // Deposit only requested + required (exclude reporter bond)
                                      const amount = BigInt(appealRequestedWei||0n) + BigInt(appealRequiredDepositWei||0n);
                                      // Compute previous payments by this account from persisted txs (ignore reporter bond paid by others)
                                      let prevPaid = 0n;
                                      try {
                                        const me = account ? account.toLowerCase() : null;
                                        const persisted = await ContractService.getTransactions(contractDetails.address).catch(() => []);
                                        if (persisted && Array.isArray(persisted)) {
                                          for (const p of persisted) {
                                            try {
                                              let payer = p?.payer ? String(p.payer).toLowerCase() : null;
                                              // fallback: if no explicit payer, try to detect from raw receipt fields
                                              if (!payer) {
                                                try {
                                                  if (p?.raw && p.raw.from) payer = String(p.raw.from).toLowerCase();
                                                  else if (p?.from) payer = String(p.from).toLowerCase();
                                                } catch (_) { payer = null; }
                                              }
                                              if (!payer || !me) continue;
                                              // Only sum deposits paid by me (type 'deposit'). Do not credit reporter bond paid by reporter.
                                              if (p.type === 'deposit' && payer === me) {
                                                prevPaid += BigInt((await import('ethers')).parseEther(String(p.amount)));
                                              }
                                            } catch (_) {}
                                          }
                                        }
                                        // As a fallback, consider appealLocal.paidAmount only if it was paid by THIS account
                                        try {
                                          if (appealLocal && appealLocal.paidAmountWei) {
                                            const paidByLocal = appealLocal.paidBy ? String(appealLocal.paidBy).toLowerCase() : null;
                                            if (paidByLocal && me && paidByLocal === me) prevPaid = prevPaid > 0n ? prevPaid : BigInt(appealLocal.paidAmountWei);
                                          } else if (appealLocal && appealLocal.paidAmountEth) {
                                            const paidByLocal = appealLocal.paidBy ? String(appealLocal.paidBy).toLowerCase() : null;
                                            if (paidByLocal && me && paidByLocal === me) prevPaid = prevPaid > 0n ? prevPaid : BigInt(ethers.parseEther(String(appealLocal.paidAmountEth)));
                                          }
                                        } catch (_) {}
                                      } catch (_) { prevPaid = 0n; }
                                      const toSend = amount > prevPaid ? amount - prevPaid : 0n;
                                      if (toSend === 0n) {
                                        alert('No outstanding amount to send for this selection.');
                                      } else {
                                        const rcpt = await svc.depositSecurity(contractDetails.address, toSend);
                                        try {
                                          const newPaid = prevPaid + toSend;
                                          const paidFlag = newPaid >= (BigInt(appealRequestedWei||0n) + BigInt(appealRequiredDepositWei||0n));
                                          const newLocal = {...(appealLocal||{}), paid: paidFlag, paidAt: Date.now(), paidTxHash: rcpt.transactionHash || rcpt.hash, paidAmountWei: String(newPaid), paidAmountEth: (await import('ethers')).formatEther(newPaid)};
                                          setAppealLocal(newLocal);
                                          try { localStorage.setItem(`incomingDispute:${contractDetails.address}`, JSON.stringify(newLocal)); localStorage.setItem(`incomingDispute:${String(contractDetails.address).toLowerCase()}`, JSON.stringify(newLocal)); } catch(_){ }
                                        } catch (_) {}
                                        try {
                                          const ethersMod = await import('ethers');
                                          const txHash = rcpt.transactionHash || rcpt.hash || null;
                                          await ContractService.saveTransaction(contractDetails.address, { type: 'deposit', amountWei: String(toSend), amount: ethersMod.formatEther(toSend), date: new Date().toLocaleString(), hash: txHash, raw: rcpt, payer: account }).catch(() => null);
                                          const persisted = await ContractService.getTransactions(contractDetails.address).catch(() => []);
                                          if (persisted && Array.isArray(persisted)) setTransactionHistory(persisted);
                                        } catch (_) {}
                                      }
                                      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('deposit:updated'));
                                    } catch (e) {
                                      console.error('Deposit for appeal failed', e);
                                      alert('Deposit failed: ' + (e?.message || e));
                                    } finally { setAppealActionLoading(false); }
                                  }}>{`Deposit full (${(() => { try { return ethers.formatEther(BigInt(appealRequestedWei||0n) + BigInt(appealRequiredDepositWei||0n)); } catch { return String(BigInt(appealRequestedWei||0n) + BigInt(appealRequiredDepositWei||0n)); } })()} ETH)`}</button>
                                </div>
                              )}
                            </div>
                          )}

                          {!isReporterLocal && !isDefendantLocal && (
                            <small className="muted">Appeal exists — only the reporter and defendant can act here.</small>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                <h3>Payment History</h3>
                <div className="transactions-list">
                  {transactionHistory.length === 0 ? (
                    <p className="no-transactions">No payments yet</p>
                  ) : (
                    transactionHistory.map((tx, index) => (
                      <div key={index} className="transaction-item">
                        <div style={{display:'flex', gap:8, alignItems:'baseline'}}>
                          <div className="tx-amount">{tx.amount} ETH</div>
                          <div style={{fontSize:12, color:'#666'}}>
                            {tx.type ? (tx.type === 'deposit' ? 'Deposit' : tx.type === 'bond' ? 'Reporter bond' : tx.type) : 'Payment'}
                          </div>
                        </div>
                        <div className="tx-date">{tx.date}</div>
                        <div className="tx-hash">
                          {tx.hash ? (
                            <>
                              {String(tx.hash).slice(0, 10)}...{String(tx.hash).slice(-8)}
                              <button className="btn-copy" onClick={() => handleCopyTx(tx.hash)} title="Copy tx hash" style={{marginLeft:8}}>Copy</button>
                            </>
                          ) : (
                            <span className="muted">No tx hash</span>
                          )}
                        </div>
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
                          <div className="detail-item checkbox-inline">
                            <label className="label" htmlFor="policy-require-mutual">Require Mutual</label>
                            <input id="policy-require-mutual" type="checkbox" checked={policyDraft.mutual} onChange={e => setPolicyDraft(s => ({...s, mutual: e.target.checked}))} />
                          </div>
                        </div>
                        <button className="btn-action" disabled={readOnly || actionLoading} onClick={handleSetPolicy}>Save Policy</button>
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
                            {/* New UX: allow landlord or tenant to send an appeal (report dispute) instead of immediate finalization */}
                            <button className="btn-action" disabled={actionLoading || !(isLandlord || isTenant) || !contractDetails?.cancellation?.cancelRequested} onClick={() => setShowDisputeForm(true)}>Send to arbitration (appeal)</button>
                            {hasAppeal && <button className="btn-action" onClick={handleShowAppeal}>Show Appeal</button>}
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
                                {ev?.by ? `${String(ev.by).slice(0,10)}...${String(ev.by).slice(-8)}` : (ev?.tx ? `${String(ev.tx).slice(0,10)}...${String(ev.tx).slice(-8)}` : '—')}
                                {ev.tx && <button className="btn-copy" onClick={() => handleCopyTx(ev.tx)} title="Copy tx hash" style={{marginLeft:8}}>Copy</button>}
                              </div>
                            </div>
                          ))}
                          {arbResolution && (
                            <div className="transaction-item" style={{borderTop:'1px solid #eee', marginTop:8, paddingTop:8}}>
                              <div style={{fontWeight:600}}>Arbitrator decision: {arbResolution.decision === 'approve' ? 'Approved (finalized)' : 'Denied (left active)'}</div>
                              <div style={{marginTop:6}}>{arbResolution.rationale || <span className="muted">(no rationale provided)</span>}</div>
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
                        {(() => {
                          try {
                            const me = account ? String(account).toLowerCase() : null;
                            if (!me) return null;
                            // show withdraw if transactionHistory contains a deposit by this account or if on-chain indicates canWithdraw
                            let hasDeposit = false;
                            if (Array.isArray(transactionHistory) && transactionHistory.length > 0) {
                              for (const p of transactionHistory) {
                                try {
                                  if (p && p.type === 'deposit') {
                                    const payer = p.payer ? String(p.payer).toLowerCase() : (p.raw && p.raw.from ? String(p.raw.from).toLowerCase() : null);
                                    if (payer && payer === me) { hasDeposit = true; break; }
                                  }
                                } catch (_) {}
                              }
                            }
                            if (hasDeposit) {
                              return <button className="btn-action" disabled={actionLoading || !paymentAmount} onClick={() => handleNdaWithdraw(paymentAmount)}>Withdraw</button>;
                            }
                          } catch (_) {}
                          return null;
                        })()}
                      </div>
                      <div className="detail-item" style={{display:'flex', flexDirection:'column', gap:'6px'}}>
                        <label className="label">Report Breach</label>
                        <input className="text-input" placeholder="Offender (0x...)" value={ndaReportOffender} onChange={e => setNdaReportOffender(e.target.value)} />
                        <input className="text-input" placeholder="Requested penalty (ETH)" value={ndaReportPenalty} onChange={e => setNdaReportPenalty(e.target.value)} />
                        <input className="text-input" placeholder="Evidence text (optional)" value={ndaReportEvidenceText} onChange={e => setNdaReportEvidenceText(e.target.value)} />
                        <label>Attach Image / File (optional)</label>
                        <input type="file" accept="image/*,application/pdf" onChange={async (e) => {
                          try {
                            const f = e.target.files && e.target.files[0];
                            if (!f) return;
                            const buf = await f.arrayBuffer();
                            const bytes = new Uint8Array(buf);
                            const hash = ethers.keccak256(bytes);
                            setNdaReportFileHash(hash);
                            // also mirror into evidence text so it's submitted if user doesn't edit
                            setNdaReportEvidenceText(hash);
                          } catch (err) {
                            console.error('Failed to hash NDA file', err);
                            alert('Failed to process NDA file');
                          }
                        }} />
                        {ndaReportFileHash && <small className="muted">Attached file hash: {ndaReportFileHash}</small>}
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
                        <input className="text-input" placeholder="Evidence text (optional)" value={createDisputeEvidence} onChange={e => setCreateDisputeEvidence(e.target.value)} />
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
              <label>Evidence (short text or URL)</label>
              <textarea className="text-input" rows={4} value={disputeForm.evidence} onChange={e => setDisputeForm(s => ({...s, evidence: e.target.value}))} />
              <label>Attach Image / File (optional)</label>
              <input type="file" accept="image/*,application/pdf" onChange={handleDisputeFileChange} />
              {disputeFileName && <small className="muted">Attached: {disputeFileName} (hash: {disputeFileHash || 'processing...'})</small>}
              <div style={{display:'flex', gap:'8px', marginTop: '8px'}}>
                <button className="btn-action primary" disabled={actionLoading} onClick={submitDisputeForm}>Submit Appeal</button>
                <button className="btn-action secondary" disabled={actionLoading} onClick={() => setShowDisputeForm(false)}>Cancel</button>
                {/* Deposit for Appeal removed: defendants should use the Deposit flow in the contract UI. */}
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Appeal modal */}
      {showAppealModal && appealData && (
        <div className="appeal-overlay" onClick={() => { setShowAppealModal(false); if (appealData?._localFileUrl) { URL.revokeObjectURL(appealData._localFileUrl); } }}>
          <div className="appeal-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <h3>Appeal / Dispute</h3>
              <div style={{display:'flex', gap:8, alignItems:'center'}}>
                <button className="btn-sm" onClick={handleCopyComplaint} title="Copy full complaint">Copy complaint</button>
                <button className="modal-close" onClick={() => { setShowAppealModal(false); if (appealData?._localFileUrl) { URL.revokeObjectURL(appealData._localFileUrl); } }}><i className="fas fa-times"></i></button>
              </div>
            </div>
            <div style={{marginTop:8}}>
              <p><strong>Contract:</strong> {appealData.contractAddress}</p>
              <p><strong>Case ID:</strong> {appealData.caseId || 'n/a'}</p>
              <p><strong>Type:</strong> {appealData.dtype}</p>
              <p><strong>Amount:</strong> {appealData.amountEth} ETH</p>
              <p><strong>Reporter:</strong> {appealData.reporter || 'unknown'}</p>
              <p><strong>Submitted:</strong> {appealData.createdAt ? new Date(appealData.createdAt).toLocaleString() : '—'}</p>
              <div>
                <p style={{display:'flex', gap:8, alignItems:'center'}}>
                  <strong>Evidence:</strong>
                  <span style={{marginLeft:6, whiteSpace:'pre-wrap'}} className={appealData.evidence ? '' : 'muted'}>
                    {appealData.evidence || <span className="muted">(no textual evidence provided)</span>}
                  </span>
                  {appealData.evidence && (
                    <button className="btn-sm" style={{marginLeft:8}} onClick={async () => { try { await copyTextToClipboard(String(appealData.evidence)); alert('Evidence copied to clipboard'); } catch (_) { alert('Copy failed'); } }}>Copy</button>
                  )}
                </p>
                {appealData.fileName && <p><strong>Attached File:</strong> {appealData.fileName}</p>}
              </div>
              {appealData._localFileUrl && (
                <p><a href={appealData._localFileUrl} target="_blank" rel="noreferrer">Open local attachment ({appealData._localFileName || 'file'})</a></p>
              )}
              {(appealData && (appealData.cid || appealData.cidUrl)) && (
                <p style={{display:'flex', gap:8, alignItems:'center'}}>
                  {
                    (() => {
                      const cid = appealData.cid || (appealData.cidUrl ? String(appealData.cidUrl).split('/').slice(-1)[0] : null);
                      return <a href={cid ? buildCidUrl(cid) : (appealData.cidUrl || '#')} target="_blank" rel="noreferrer">Open IPFS file</a>;
                    })()
                  }
                  <button className="btn-sm" onClick={async () => { try { setShowPinnedModal(true); const cid = appealData.cid || (appealData.cidUrl ? String(appealData.cidUrl).split('/').slice(-1)[0] : null); await fetchPinnedRecord(cid); } catch (e) { alert('Failed to load pinned record: ' + e?.message || e); } }}>View pinned evidence</button>
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      {showPinnedModal && (
        <div className="appeal-overlay" onClick={() => { setShowPinnedModal(false); setPinnedRecord(null); setPinnedDecrypted(null); }}>
          <div className="appeal-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <h3>Pinned Evidence</h3>
              <div>
                <button className="modal-close" onClick={() => { setShowPinnedModal(false); setPinnedRecord(null); setPinnedDecrypted(null); }}><i className="fas fa-times"></i></button>
              </div>
            </div>
            <div style={{marginTop:8}}>
              {pinnedLoading && <div>Loading...</div>}
              {pinnedError && <div className="muted">Error: {pinnedError}</div>}
              {pinnedRecord && (
                <div>
                  <p><strong>ID:</strong> {pinnedRecord.id}</p>
                  <p><strong>CID:</strong> {pinnedRecord.cid}</p>
                  <p><strong>Meta:</strong> <pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(pinnedRecord.meta, null, 2)}</pre></p>
                  <h5>Decrypted content (if local private key provided)</h5>
                  {pinnedDecrypted ? (
                    <div style={{whiteSpace:'pre-wrap', maxHeight:300, overflow:'auto', background:'#fff', padding:8, border:'1px solid #eee'}}>{pinnedDecrypted}</div>
                  ) : (
                    <div className="muted">No decrypted content available. For admin auto-decrypt, set `PIN_SERVER_API_KEY` in localStorage (the client will call server `/admin/decrypt/:id`).</div>
                  )}
                  <h5 style={{marginTop:12}}>Full audit record</h5>
                  <pre style={{whiteSpace:'pre-wrap', maxHeight:240, overflow:'auto'}}>{JSON.stringify(pinnedRecord, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {showDebugState && (
        <div style={{padding:12, borderTop:'1px solid #eee', background:'#fafafa', fontSize:12}}>
          <h4>Debug State</h4>
          <pre style={{whiteSpace:'pre-wrap', maxHeight:240, overflow:'auto'}}>
            {JSON.stringify({ arbResolution, contractDetails, appealLocal }, null, 2)}
          </pre>
        </div>
      )}
      {showRationale && (
        <div style={{padding:12, borderTop:'1px solid #eee', background:'#fff8e6', fontSize:13}}>
          <h4>Arbitrator Rationale</h4>
          {arbResolution ? (
            <div>
              <div style={{marginBottom:8}}><strong>Decision:</strong> {arbResolution.decision}</div>
              <div style={{whiteSpace:'pre-wrap', background:'#fff', padding:8, border:'1px solid #f0e6d6', borderRadius:4}}>{arbResolution.rationale || <span className="muted">(no rationale provided)</span>}</div>
              {arbResolution.classification && (
                <div style={{marginTop:8}}><strong>Classification:</strong> {arbResolution.classification}</div>
              )}
              {arbResolution.evidenceCid && (
                <div style={{marginTop:8}}>
                  <strong>Evidence CID:</strong>
                  <div style={{marginTop:6}}>
                    <a target="_blank" rel="noreferrer" href={buildCidUrl(arbResolution.evidenceCid)}>{arbResolution.evidenceCid}</a>
                    <button className="btn-copy" style={{marginLeft:8}} onClick={() => { navigator.clipboard?.writeText(arbResolution.evidenceCid); }}>Copy CID</button>
                  </div>
                </div>
              )}
              <div style={{marginTop:8, fontSize:12, color:'#666'}}>Recorded at: {arbResolution.timestamp ? new Date(Number(arbResolution.timestamp)).toLocaleString() : '—'}</div>
              <h5 style={{marginTop:12}}>Full Debug</h5>
              <pre style={{whiteSpace:'pre-wrap', maxHeight:240, overflow:'auto'}}>{JSON.stringify({ arbResolution, contractDetails, appealLocal }, null, 2)}</pre>
            </div>
          ) : (
            <div className="muted">No arbitration resolution persisted for this contract.</div>
          )}
        </div>
      )}
    </div>
  );
}

export default ContractModal;