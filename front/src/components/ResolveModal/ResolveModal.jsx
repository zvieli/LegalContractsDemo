import React, { useEffect, useState } from 'react';
import { ContractService } from '../../services/contractService';
import ConfirmPayModal from '../common/ConfirmPayModal';
import { ArbitrationService } from '../../services/arbitrationService';
// Evidence workflow: the contract stores only a keccak256 digest of an
// off-chain evidence payload. The frontend should display the digest or a
// decrypted/processed version of the payload only when provided by a trusted
// admin/service. The frontend performs NO pinning or direct IPFS interactions.
import * as ethers from 'ethers';
import { parseEtherSafe, formatEtherSafe } from '../../utils/eth';
import { createContractInstanceAsync, getLocalDeploymentAddresses } from '../../utils/contracts';
import './ResolveModal.css';
import { decryptCiphertextJson } from '../../utils/adminDecrypt';
import { computeDigestForCiphertext } from '../../utils/evidence';

function EvidencePanel({ initialEvidence }) {
  // Simplified evidence panel after removing local pin-server: evidence is stored on-chain
  const [evidenceText, setEvidenceText] = useState(initialEvidence || '');
  return (
    <div style={{marginTop:12, padding:12, border:'1px solid #eee', borderRadius:6}}>
      <h4>Evidence</h4>
      <div style={{marginTop:8}}>
        <div style={{fontSize:13, color:'#555', marginBottom:6}}>Evidence for this dispute is stored off-chain (encrypted). The contract stores only a keccak256 digest for integrity.</div>
        <pre style={{whiteSpace:'pre-wrap', maxHeight:240, overflow:'auto', background:'#fafafa', padding:8}}>{evidenceText || <span style={{color:'#888'}}>No evidence digest available on-chain</span>}</pre>
      </div>
    </div>
  );
}

// Export EvidencePanel so tests can import and render it directly
export { EvidencePanel }

export default function ResolveModal({ isOpen, onClose, contractAddress, signer, chainId, onResolved }) {
  const [decision, setDecision] = useState('approve'); // approve | deny
  const [rationale, setRationale] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingFee, setLoadingFee] = useState(false);
  const [requiredFeeWei, setRequiredFeeWei] = useState(0n);
  const [requiredFeeEth, setRequiredFeeEth] = useState('0');
  const [disputeInfo, setDisputeInfo] = useState(null); // { caseId, requestedAmountWei, initiator }
  const [reporterBondEth, setReporterBondEth] = useState('0');
  const [initiatorWithdrawableEth, setInitiatorWithdrawableEth] = useState('0');
  const [arbOwnerWithdrawableEth, setArbOwnerWithdrawableEth] = useState('0');
  const [arbOwnerAddr, setArbOwnerAddr] = useState(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [loadingDispute, setLoadingDispute] = useState(false);
  const [account, setAccount] = useState(null);
  const [disputeAmountEth, setDisputeAmountEth] = useState('0');
  const [landlordDepositEth, setLandlordDepositEth] = useState('0');
  const [tenantDepositEth, setTenantDepositEth] = useState('0');
  const [debtorDepositEth, setDebtorDepositEth] = useState('0');
  const [debtorDepositWei, setDebtorDepositWei] = useState(0n);
  const [willBeDebitedEth, setWillBeDebitedEth] = useState('0');
  const [debtRemainderEth, setDebtRemainderEth] = useState('0');
  const [appealLocal, setAppealLocal] = useState(null);
  const [confirmPay, setConfirmPay] = useState(false);
  const [forwardEth, setForwardEth] = useState('');
  const [isAuthorizedArbitrator, setIsAuthorizedArbitrator] = useState(false);
  const [showAdminDecryptModal, setShowAdminDecryptModal] = useState(false);
  const [adminCiphertextInput, setAdminCiphertextInput] = useState('');
  const [adminPrivateKeyInput, setAdminPrivateKeyInput] = useState('');
  const [adminDecrypted, setAdminDecrypted] = useState(null);
  const [adminDigest, setAdminDigest] = useState(null);
  const [adminDecryptBusy, setAdminDecryptBusy] = useState(false);
  const [adminAutoTried, setAdminAutoTried] = useState(false);
  const [adminCiphertextReadOnly, setAdminCiphertextReadOnly] = useState(false);
  const [fetchStatusMessage, setFetchStatusMessage] = useState(null);
  const [fetchedUrl, setFetchedUrl] = useState(null);

  // Enable admin decrypt only when explicitly allowed via environment (demo/dev only)
  const ENABLE_ADMIN_DECRYPT = (import.meta.env && String(import.meta.env.VITE_ENABLE_ADMIN_DECRYPT || '').toLowerCase() === 'true') || (typeof window !== 'undefined' && window.__ENV__ && String(window.__ENV__.VITE_ENABLE_ADMIN_DECRYPT || '').toLowerCase() === 'true');

  // Utility: download plaintext as a file (demo convenience)
  const handleDownloadPlaintext = () => {
    try {
      if (!adminDecrypted) return;
      const blob = new Blob([adminDecrypted], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `evidence-${disputeInfo?.caseId ?? 'unknown'}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      console.warn('Download failed', e);
      alert('Download failed: ' + (e?.message || e));
    }
  };

  // Utility: copy digest to clipboard
  const handleCopyDigest = async () => {
    try {
      if (!adminDigest) return;
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(adminDigest);
        alert('Digest copied to clipboard');
      } else {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = adminDigest;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        alert('Digest copied to clipboard');
      }
    } catch (e) {
      console.warn('Copy failed', e);
      alert('Copy failed: ' + (e?.message || e));
    }
  };

  // Deposit confirmation modal state
  const [depositConfirmOpen, setDepositConfirmOpen] = useState(false);
  const [depositConfirmAmount, setDepositConfirmAmount] = useState('0');
  const [depositConfirmAction, setDepositConfirmAction] = useState(null);
  const [depositConfirmBusy, setDepositConfirmBusy] = useState(false);

  // ... use imported parseEtherSafe and formatEtherSafe from utils/eth

  useEffect(() => {
    // When modal opens, attempt to compute required early-termination fee (if any)
    let mounted = true;
    const loadFee = async () => {
      if (!isOpen || !contractAddress || !signer) return;
      setLoadingFee(true);
      try {
        const svc = new ContractService(signer, chainId);
        const rent = await svc.getRentContract(contractAddress);
        const feeBps = Number(await rent.earlyTerminationFeeBps().catch(() => 0));
        if (feeBps > 0) {
          // getRentInEth returns wei (uint256)
          const rentWei = BigInt(await rent.getRentInEth());
          const required = (rentWei * BigInt(feeBps)) / 10000n;
          if (mounted) {
            setRequiredFeeWei(required);
            try { setRequiredFeeEth(ethers.formatEther(required)); } catch { setRequiredFeeEth(String(required)); }
          }
        } else {
          if (mounted) {
            setRequiredFeeWei(0n);
            setRequiredFeeEth('0');
          }
        }
      } catch (e) {
        console.debug('Could not compute required fee:', e);
        if (mounted) {
          setRequiredFeeWei(0n);
          setRequiredFeeEth('0');
        }
      } finally {
        if (mounted) setLoadingFee(false);
      }
    };
    loadFee();
    // Also attempt to load a pending dispute (case) on the rent contract if present
    const loadDispute = async () => {
      // Defensive: require modal to be open and have a valid contract address and signer
      if (!isOpen || !contractAddress || !signer) {
        setLoadingDispute(false);
        return;
      }
      setLoadingDispute(true);
      try {
        try { const me = await signer.getAddress?.(); setAccount(me || null); } catch (_) { setAccount(null); }
        const svc = new ContractService(signer, chainId);
        // If contractAddress is falsy, svc.getRentContract will throw; avoid that.
        const rent = await svc.getRentContract(contractAddress);
        // Try to find the most recent dispute/case on-chain via getDisputesCount/getDispute
        const count = Number(await rent.getDisputesCount().catch(() => 0));
        if (count > 0) {
          // Walk backwards to find the first unresolved case
          for (let i = count - 1; i >= 0; i--) {
            try {
              const d = await rent.getDispute(i);
              // getDispute returns: (initiator, dtype, requestedAmount, evidence, resolved, approved, appliedAmount)
              const initiator = d[0];
              const requestedAmount = BigInt(d[2] || 0);
              const resolved = !!d[4];
                if (!resolved) {
                // compute debtor address (the counterparty) and store it on disputeInfo
                const landlordAddr = await rent.landlord();
                const tenantAddr = await rent.tenant();
                const debtorAddr = String(initiator).toLowerCase() === String(landlordAddr).toLowerCase() ? tenantAddr : landlordAddr;
                // include the on-chain evidenceDigest field (d[3]) so the UI can link to the canonical JSON
                const evidenceOnChain = (d && typeof d[3] !== 'undefined') ? d[3] : null;
                setDisputeInfo({ caseId: i, requestedAmountWei: requestedAmount, initiator, debtor: debtorAddr, evidenceDigest: evidenceOnChain });
                // reset any per-modal confirmPay/forwardEth state when loading a new dispute
                try { setConfirmPay(false); setForwardEth(''); } catch (_) {}
                try { setDisputeAmountEth(formatEtherSafe(requestedAmount)); } catch { setDisputeAmountEth(String(requestedAmount)); }

                // Try to fetch per-party deposit balances so the arbitrator
                // can see available funds and any remainder that will become debt.
                try {
                  const landlordAddr = await rent.landlord();
                  const tenantAddr = await rent.tenant();
                  const landlordDep = BigInt(await rent.partyDeposit(landlordAddr));
                  const tenantDep = BigInt(await rent.partyDeposit(tenantAddr));
                  setLandlordDepositEth(formatEtherSafe(landlordDep));
                  setTenantDepositEth(formatEtherSafe(tenantDep));

                  const debtorAddr = String(initiator).toLowerCase() === String(landlordAddr).toLowerCase() ? tenantAddr : landlordAddr;
                  const debtorDep = BigInt(await rent.partyDeposit(debtorAddr));
                  setDebtorDepositEth(formatEtherSafe(debtorDep));
                  setDebtorDepositWei(debtorDep);

                  const toApply = requestedAmount > debtorDep ? debtorDep : requestedAmount;
                  const remainder = requestedAmount > debtorDep ? requestedAmount - debtorDep : 0n;
                  setWillBeDebitedEth(formatEtherSafe(toApply));
                  setDebtRemainderEth(formatEtherSafe(remainder));
                  // Read reporter bond and withdrawable balances (best-effort via service helpers)
                    try {
                      const svc2 = new ContractService(signer, chainId);
                      const bond = BigInt(await svc2.getDisputeBond(contractAddress, i).catch(() => 0n));
                      setReporterBondEth(formatEtherSafe(bond));
                      const initW = BigInt(await svc2.getWithdrawable(contractAddress, initiator).catch(() => 0n));
                      setInitiatorWithdrawableEth(formatEtherSafe(initW));
                      // Also read withdrawable for arbitration owner (best-effort via arbitrationService lookup)
                      try {
                        const arbSvc = new ArbitrationService(signer, chainId);
                        const owner = await arbSvc.getArbitrationServiceOwnerByNDA(contractAddress).catch(() => null);
                        if (owner) {
                          setArbOwnerAddr(owner);
                          const arbW = BigInt(await svc2.getWithdrawable(contractAddress, owner).catch(() => 0n));
                          setArbOwnerWithdrawableEth(formatEtherSafe(arbW));
                        }
                      } catch (_) { /* ignore */ }
                    } catch (bondErr) {
                      console.debug('Bond/withdrawable read failed', bondErr);
                    }
                } catch (dErr) {
                  console.debug('Could not read party deposits:', dErr);
                }

                // Try to fetch reporter bond and withdrawable balances
                  try {
                    const svc = new ContractService(signer, chainId);
                    const bond = BigInt(await svc.getDisputeBond(contractAddress, i));
                    setReporterBondEth(ethers.formatEther(bond));
                    const initW = BigInt(await svc.getWithdrawable(contractAddress, initiator));
                    setInitiatorWithdrawableEth(ethers.formatEther(initW));
                  // arbitration owner withdrawable - best-effort: read arbitrationService owner then withdrawable
                  try {
                    const rent = await svc.getRentContract(contractAddress);
                    const svcAddr = await rent.arbitrationService().catch(() => null);
                    if (svcAddr && svcAddr !== '0x0000000000000000000000000000000000000000') {
                      const arbSvc = await createContractInstanceAsync('ArbitrationService', svcAddr, signer);
                      const owner = await arbSvc.owner().catch(() => null);
                        if (owner) {
                        const ownersW = BigInt(await svc.getWithdrawable(contractAddress, owner));
                        setArbOwnerWithdrawableEth(ethers.formatEther(ownersW));
                      }
                    }
                  } catch (_) {}
                } catch (bErr) {
                  console.debug('Could not read reporter bond or withdrawables:', bErr);
                }

                break;
              }
            } catch (_) { }
          }
        }
      } catch (e) {
        console.debug('Could not load dispute info:', e);
      } finally {
        setLoadingDispute(false);
      }
    };
    loadDispute();
    // Listen for DisputeFiled events from the contract so debtor can be notified in other UIs
    let cleanupFn = null;
    try {
      if (contractAddress && signer) {
        const svc = new ContractService(signer, chainId);
        (async () => {
          try {
            const rent = await svc.getRentContract(contractAddress);
            const filter = rent.filters?.DisputeFiled?.();
            if (filter) {
              const onFiled = (caseId, debtor, requestedAmount) => {
                try {
                  const me = signer && signer.getAddress ? signer.getAddress() : null;
                  // If I'm the debtor, show a local incomingDispute marker so UI surfaces deposit button
                  (async () => {
                    try {
                      const myAddr = await (me instanceof Promise ? me : Promise.resolve(me));
                      if (!myAddr) return;
                      if (String(myAddr).toLowerCase() === String(debtor).toLowerCase()) {
                        const incoming = { contractAddress, caseId: Number(caseId), requestedAmount: BigInt(requestedAmount || 0).toString(), createdAt: Date.now() };
                        try { localStorage.setItem(`incomingDispute:${contractAddress}`, JSON.stringify(incoming)); } catch(_) {}
                        setAppealLocal(incoming);
                        // update disputeInfo if modal open
              setDisputeInfo(prev => ({ caseId: Number(caseId), requestedAmountWei: BigInt(requestedAmount || 0), initiator: prev?.initiator || null, evidenceDigest: prev?.evidenceDigest || null }));
              try { setConfirmPay(false); } catch (_) {}
                        try { setDebtorDepositWei(BigInt(requestedAmount || 0)); setDebtorDepositEth(ethers.formatEther(BigInt(requestedAmount || 0))); } catch (_) {}
                      }
                    } catch (_) {}
                  })();
                } catch (_) {}
              };
              rent.on(filter, onFiled);
              cleanupFn = () => { try { rent.off(filter, onFiled); } catch (_) {} };
            }
          } catch (_) {}
        })();
      }
    } catch (_) {}
    // Load any local incomingDispute marker for this contract (so we can hide post-bond UI after payment)
    try {
      const key1 = `incomingDispute:${contractAddress}`;
      const key2 = `incomingDispute:${String(contractAddress).toLowerCase()}`;
      let js = null;
      try { js = localStorage.getItem(key1) || localStorage.getItem(key2) || null; } catch (_) { js = null; }
      if (!js) {
        try {
          const sess = sessionStorage.getItem('incomingDispute');
          if (sess) {
            const o = JSON.parse(sess);
            if (o && o.contractAddress && String(o.contractAddress).toLowerCase() === String(contractAddress).toLowerCase()) js = sess;
          }
        } catch (_) { js = js; }
      }
      if (js) {
        try { setAppealLocal(JSON.parse(js)); } catch { setAppealLocal(null); }
      } else setAppealLocal(null);
    } catch (_) { setAppealLocal(null); }
    return () => { mounted = false; if (cleanupFn) cleanupFn(); };
  }, [isOpen, contractAddress, signer, chainId]);

  // Helper to refresh dispute-related state without reloading the page
  const refreshDisputeState = async () => {
    try {
      if (!contractAddress || !signer) return;
      const svc = new ContractService(signer, chainId);
      const rent = await svc.getRentContract(contractAddress);
      const count = Number(await rent.getDisputesCount().catch(() => 0));
      if (count > 0) {
        for (let i = count - 1; i >= 0; i--) {
          try {
            const d = await rent.getDispute(i);
            const resolved = !!d[4];
            if (!resolved) {
              const initiator = d[0];
              const requestedAmount = BigInt(d[2] || 0);
                // include evidenceDigest field when refreshing so Admin decrypt modal can auto-locate the canonical JSON
                const evidenceOnChain = (d && typeof d[3] !== 'undefined') ? d[3] : null;
                setDisputeInfo({ caseId: i, requestedAmountWei: requestedAmount, initiator, evidenceDigest: evidenceOnChain });
              try { setDisputeAmountEth(ethers.formatEther(requestedAmount)); } catch { setDisputeAmountEth(String(requestedAmount)); }
              const landlordAddr = await rent.landlord();
              const tenantAddr = await rent.tenant();
              const landlordDep = BigInt(await rent.partyDeposit(landlordAddr));
              const tenantDep = BigInt(await rent.partyDeposit(tenantAddr));
              setLandlordDepositEth(ethers.formatEther(landlordDep));
              setTenantDepositEth(ethers.formatEther(tenantDep));
              const debtorAddr = String(initiator).toLowerCase() === String(landlordAddr).toLowerCase() ? tenantAddr : landlordAddr;
              const debtorDep = BigInt(await rent.partyDeposit(debtorAddr));
              setDebtorDepositEth(ethers.formatEther(debtorDep));
              setDebtorDepositWei(debtorDep);
              break;
            }
          } catch (_) {}
        }
      }
    } catch (e) { console.debug('refreshDisputeState failed', e); }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!isOpen || !contractAddress || !signer) return;
        const svc = new ContractService(signer, chainId);
        const ok = await svc.isAuthorizedArbitratorForContract(contractAddress).catch(() => false);
        if (mounted) setIsAuthorizedArbitrator(!!ok);
      } catch (e) {
        if (mounted) setIsAuthorizedArbitrator(false);
      }
    })();
    return () => { mounted = false; };
  }, [isOpen, contractAddress, signer, chainId]);

  // Auto-fetch+decrypt once when admin modal opens and admin key + guessed URL are present
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

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const svc = new ContractService(signer, chainId);
      // For cancellation flow we finalize via service; fee is 0 here.
      // Decision semantics: approve => finalize cancellation, deny => do nothing on-chain
      if (decision === 'approve') {
        // try to read arbitrationService from frontend artifacts or contract
        let arbAddr = null;
        try {
          const rent = await svc.getRentContract(contractAddress);
          arbAddr = await rent.arbitrationService().catch(() => null);
        } catch (_) { arbAddr = null; }

        if (!arbAddr || arbAddr === '0x0000000000000000000000000000000000000000') {
          try {
            const local = await getLocalDeploymentAddresses();
            arbAddr = local?.ArbitrationService || local?.ArbitrationService || null;
          } catch (_) { arbAddr = null; }
        }

        if (!arbAddr) {
          alert('No ArbitrationService configured. Cannot finalize on-chain.');
        } else {
          // If we detected a dispute (non-cancellation) and it requests an amount,
          // use the ContractService helper to apply the resolution to the target
          // and transfer the requested amount to the initiator (beneficiary).
          const svc2 = new ContractService(signer, chainId);
          // Authorization preflight: ensure connected signer is owner or factory allowed by ArbitrationService
          try {
            // create instance via ContractService helper
            const svcInst = await (async () => {
              try { return await svc2.getRentContract(contractAddress).catch(() => null); } catch (_) { return null; }
            })();
            // Instead of relying on target, create a direct ArbitrationService contract to read owner/factory
              try {
                // Use the frontend static ABI helper to create the contract instance (avoids dynamic ABI imports)
                const arbRead = await createContractInstanceAsync('ArbitrationService', arbAddr, signer.provider || signer);
                const ownerAddr = await arbRead.owner().catch(() => null);
                const factoryAddr = await arbRead.factory().catch(() => null);
                const me = (await signer.getAddress?.()).toLowerCase();
                const allowed = (ownerAddr && me === String(ownerAddr).toLowerCase()) || (factoryAddr && me === String(factoryAddr).toLowerCase());
                if (!allowed) {
                  throw new Error('Connected wallet is not authorized to call ArbitrationService (not owner or factory). Use the arbitrator account.');
                }
              } catch (authErr) {
                // Bubble up authorization error to user
                throw authErr;
              }
          } catch (authCheckErr) {
            alert(`Authorization check failed: ${authCheckErr?.message || authCheckErr}`);
            setSubmitting(false);
            return;
          }
          if (disputeInfo && disputeInfo.requestedAmountWei > 0n) {
            // Convert forwardEth to wei bigint if provided
            let forwardWei = 0n;
            try {
              forwardWei = forwardEth && Number(forwardEth) > 0 ? ethers.parseEther(String(forwardEth)) : 0n;
            } catch (_) { forwardWei = 0n; }
            await svc2.applyResolutionToTargetViaService(arbAddr, contractAddress, disputeInfo.caseId, true, disputeInfo.requestedAmountWei, disputeInfo.initiator, forwardWei);
          } else {
            // Otherwise treat as cancellation finalize and forward early-termination fee if required
            const feeToSend = requiredFeeWei && typeof requiredFeeWei === 'bigint' ? requiredFeeWei : 0n;
            await svc2.finalizeCancellationViaService(arbAddr, contractAddress, feeToSend);
          }

          // After on-chain confirmation, attempt to read the canonical on-chain rationale via getDisputeMeta
          try {
            const svc3 = new ContractService(signer, chainId);
            let onChainMeta = null;
            try {
              if (disputeInfo && typeof disputeInfo.caseId !== 'undefined' && disputeInfo.caseId !== null) {
                onChainMeta = await svc3.getDisputeMeta(contractAddress, disputeInfo.caseId).catch(() => null);
              }
            } catch (_) { onChainMeta = null; }

            const key = `arbResolution:${String(contractAddress).toLowerCase()}`;
            // Prefer on-chain rationale when available; fall back to local appeal/evidence or typed rationale
            // Do NOT show raw plaintext evidence stored locally. Prefer on-chain rationale.
            // If no on-chain rationale is available, show the evidence DIGEST only and explanatory text.
            const resolvedRationale = (onChainMeta && onChainMeta.rationale) ? onChainMeta.rationale : ( (appealLocal && appealLocal.evidenceDigest) ? `Evidence digest: ${appealLocal.evidenceDigest}` : rationale );
            const resolvedClassification = (onChainMeta && onChainMeta.classification) ? onChainMeta.classification : (decision === 'approve' ? 'approve' : 'deny');
            const payload = { contractAddress, decision: resolvedClassification, rationale: resolvedRationale, timestamp: Date.now(), onChain: !!onChainMeta };
            try { localStorage.setItem(key, JSON.stringify(payload)); } catch (_) {}
            try { sessionStorage.setItem('lastArbResolution', JSON.stringify(payload)); } catch (_) {}
            try { localStorage.removeItem(`incomingDispute:${contractAddress}`); } catch (_) {}
            try { localStorage.removeItem(`incomingDispute:${String(contractAddress).toLowerCase()}`); } catch (_) {}
            try { sessionStorage.removeItem('incomingDispute'); } catch (_) {}
            if (typeof window !== 'undefined' && window.dispatchEvent) {
              // Dispatch the canonical on-chain payload when available so other UIs can update
              window.dispatchEvent(new CustomEvent('arb:resolved', { detail: payload }));
            }
          } catch (e) {
            console.warn('Could not persist arbitration decision locally after tx', e);
          }
        }
      }

      // Persist the arbitrator decision and rationale locally per-contract so it can be shown in UI
      try {
        const key = `arbResolution:${String(contractAddress).toLowerCase()}`;
            const resolvedRationale = (appealLocal && appealLocal.evidenceDigest) ? `Evidence digest: ${appealLocal.evidenceDigest}` : rationale;
        const payload = { contractAddress, decision, rationale: resolvedRationale, timestamp: Date.now() };
        localStorage.setItem(key, JSON.stringify(payload));
        // Also save a summary to sessionStorage for immediate visibility elsewhere
        sessionStorage.setItem('lastArbResolution', JSON.stringify(payload));
        // Clear any local incomingDispute marker so the UI no longer shows the active appeal
        try { localStorage.removeItem(`incomingDispute:${contractAddress}`); } catch (_) {}
        try { localStorage.removeItem(`incomingDispute:${String(contractAddress).toLowerCase()}`); } catch (_) {}
        try { sessionStorage.removeItem('incomingDispute'); } catch (_) {}
        // Notify the app that this contract was resolved so open UIs can refresh
        try {
          if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('arb:resolved', { detail: payload }));
          }
        } catch (_) {}
      } catch (e) {
        console.warn('Could not persist arbitration decision locally', e);
      }

      // Close the modal first and refresh parent contract data/UI in the background
      // so the modal closes immediately while the app updates in the background.
      try {
        if (onResolved) onResolved({ decision, rationale });
      } catch (_) {}
      try {
        onClose();
      } catch (_) {}
      try {
        if (typeof window !== 'undefined' && typeof window.refreshContractData === 'function') {
          // Fire-and-forget: don't await so the modal closes immediately.
          Promise.resolve()
            .then(() => window.refreshContractData())
            .catch(() => { /* ignore refresh failures */ });
        }
      } catch (_) {}
    } catch (e) {
      console.error('Resolve failed', e);
      alert(`Resolve failed: ${e?.message || e}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <h3>Resolve Cancellation</h3>
        <form onSubmit={handleSubmit}>
          <div>
            <label>
              <input type="radio" name="decision" value="approve" checked={decision==='approve'} onChange={() => setDecision('approve')} /> Approve (finalize cancellation)
            </label>
            <label style={{marginLeft:12}}>
              <input type="radio" name="decision" value="deny" checked={decision==='deny'} onChange={() => setDecision('deny')} /> Deny (leave contract active)
            </label>
          </div>
          <div style={{marginTop:12}}>
            <label>Rationale</label>
            {isAuthorizedArbitrator ? (
              <div>
                <textarea
                  className="text-input"
                  rows={4}
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  placeholder="Enter rationale (this will be recorded with the resolution)"
                  style={{width:'100%', boxSizing:'border-box'}}
                />
              </div>
            ) : (
              <div style={{padding:8, background:'#fafafa', border:'1px solid #eee', borderRadius:4, minHeight:48}}>
                {(appealLocal && appealLocal.evidenceDigest) ? (<div><div style={{fontSize:13, color:'#333', marginBottom:6}}>Evidence DIGEST (on-chain):</div><pre style={{whiteSpace:'pre-wrap', wordBreak:'break-all', background:'#fff', padding:8}}>{appealLocal.evidenceDigest}</pre><div style={{marginTop:8, fontSize:12, color:'#555'}}>The full evidence payload is stored off-chain encrypted to the platform admin and is not available in this browser. Contact the platform administrator to request decryption if you are authorized.</div></div>) : (rationale || <span style={{color:'#888'}}>No rationale provided</span>)}
                <div style={{marginTop:8, color:'#a33'}}>Note: your connected wallet is not authorized to perform arbitration actions for this contract. To finalize disputes via the ArbitrationService, connect the ArbitrationService owner or the ContractFactory creator account (the account that deployed this contract).</div>
              </div>
            )}
          </div>
          {/* Show dispute / payment details when a dispute requests funds */}
          {disputeInfo && disputeInfo.requestedAmountWei > 0n && (
            <div style={{marginTop:12, padding:12, border:'1px solid #eee', borderRadius:6, background:'#fafafa'}}>
              <div style={{marginBottom:6}}><strong>Requested amount:</strong> {disputeAmountEth} ETH</div>
              <div style={{marginBottom:6}}><strong>Beneficiary (initiator):</strong> {disputeInfo.initiator}</div>
              <div style={{marginBottom:6}}><strong>Landlord deposit:</strong> {landlordDepositEth} ETH</div>
              <div style={{marginBottom:6}}><strong>Tenant deposit:</strong> {tenantDepositEth} ETH</div>
              <div style={{marginBottom:6}}><strong>Debtor deposit available:</strong> {debtorDepositEth} ETH</div>
              <div style={{marginBottom:6}}><strong>Will be debited from deposit:</strong> {willBeDebitedEth} ETH</div>
              {debtRemainderEth !== '0' && <div style={{marginBottom:6, color:'#a33'}}><strong>Remainder recorded as debt:</strong> {debtRemainderEth} ETH</div>}
              <div style={{marginBottom:6}}><strong>Reporter bond (fixed):</strong> 0.002 ETH</div>
              <div style={{marginBottom:6}}><strong>Reporter bond (held):</strong> {reporterBondEth} ETH</div>
              <div style={{marginBottom:6}}><strong>Initiator withdrawable:</strong> {initiatorWithdrawableEth} ETH</div>
              <div style={{fontSize:12, color:'#555'}}>Approving will transfer the requested amount to the beneficiary. This action may move funds on-chain.</div>
              <div style={{marginTop:8}}>
                <label><input type="checkbox" checked={confirmPay} onChange={e => setConfirmPay(e.target.checked)} /> I confirm approving will transfer {disputeAmountEth} ETH to {disputeInfo.initiator}</label>
              </div>
              {/* If depositor shortfall exists, allow authorized arbitrator to attach ETH to cover it in the same transaction */}
              {isAuthorizedArbitrator && debtorDepositWei != null && disputeInfo && disputeInfo.requestedAmountWei > debtorDepositWei && (
                <div style={{marginTop:12}}>
                  <div style={{marginBottom:6, color:'#a33'}}><strong>Debtor deposit shortfall:</strong> {(() => { try { const short = BigInt(disputeInfo.requestedAmountWei) - BigInt(debtorDepositWei || 0n); return ethers.formatEther(short); } catch { return '0'; } })()} ETH</div>
                  <div style={{display:'flex', gap:8, alignItems:'center'}}>
                    <input className="text-input" type="number" step="0.000000000000000001" value={forwardEth} onChange={e => setForwardEth(e.target.value)} placeholder="ETH to attach (optional)" />
                    <div style={{fontSize:12, color:'#555'}}>If you provide ETH here, it will be forwarded to the target in the same transaction to cover the shortfall.</div>
                  </div>
                </div>
              )}
              {/* If I'm the debtor and haven't yet deposited the requested amount, show a deposit button */}
              {(appealLocal && appealLocal.requestedAmount && account && disputeInfo) && (String(account).toLowerCase() === String(disputeInfo.debtor || '').toLowerCase() || String(account).toLowerCase() === String(disputeInfo.debtor || '').toLowerCase()) && (
                <div style={{marginTop:8}}>
                  <div style={{display:'flex', gap:8, alignItems:'center'}}>
                    <input className="text-input" type="number" step="0.000000000000000001" placeholder={`Amount to deposit (ETH) up to ${(() => { try { return ethers.formatEther(BigInt(appealLocal.requestedAmount || disputeInfo.requestedAmountWei || 0n)); } catch { return String(appealLocal.requestedAmount || disputeInfo.requestedAmountWei || 0n); } })()}`} onChange={e => setDepositConfirmAmount(e.target.value)} value={depositConfirmAmount} />
                    <button type="button" className="btn-sm" onClick={() => {
                      try {
                        // compute wei from entered ETH amount
                        const amtEthStr = depositConfirmAmount || '0';
                        const amtWei = amtEthStr && Number(amtEthStr) > 0 ? ethers.parseEther(String(amtEthStr)) : 0n;
                        const amtEth = (() => { try { return ethers.formatEther(amtWei); } catch { return String(amtWei); } })();
                        setDepositConfirmAction(() => async () => {
                          try {
                            setDepositConfirmBusy(true);
                            const svc = new ContractService(signer, chainId);
                            await svc.depositForCase(contractAddress, disputeInfo.caseId, amtWei);
                            alert('Deposit submitted for case');
                            // refresh parent contract data to update payment history and hide deposit input
                            try { if (window && typeof window.refreshContractData === 'function') await window.refreshContractData(); } catch (_) {}
                            await refreshDisputeState();
                          } catch (e) {
                            alert(`Deposit failed: ${e?.message || e}`);
                          } finally {
                            setDepositConfirmBusy(false);
                          }
                        });
                        setDepositConfirmAmount(amtEth);
                        setDepositConfirmOpen(true);
                      } catch (e) {
                        console.error('Failed to prepare deposit confirmation', e);
                        alert('Failed to prepare deposit confirmation');
                      }
                    }}>Deposit</button>
                  </div>
                </div>
              )}
                <div style={{marginTop:8}}>
                  <em style={{color:'#555'}}>If the beneficiary received funds directly, no withdrawal is necessary.</em>
                </div>
            </div>
          )}

      {/* Evidence panel: fetch/decrypt/preview/download pinned evidence (arbitrator-only decrypt) */}
  <EvidencePanel initialEvidence={disputeInfo?.evidenceDigest || ''} />

          {/* Admin decrypt button & modal (optional in-browser decryption). WARNING: private key must be transient and not stored. */}
          {isAuthorizedArbitrator && ENABLE_ADMIN_DECRYPT && (
            <div style={{marginTop:12}}>
                      <button type="button" className="btn-sm" onClick={async () => {
                        setShowAdminDecryptModal(true);
                        setAdminDecrypted(null);
                        setAdminCiphertextReadOnly(false);
                        setAdminCiphertextInput('');
                        setFetchStatusMessage(null);
                        setFetchedUrl(null);
                        try {
                          const base = (import.meta.env && import.meta.env.VITE_EVIDENCE_FETCH_BASE) || '';
                          const maybe = disputeInfo && disputeInfo.evidenceDigest ? disputeInfo.evidenceDigest : null;
                          let guessed = '';
                          if (base && maybe && /^0x[0-9a-fA-F]{64}$/.test(String(maybe).trim())) {
                            const digestNo0x = String(maybe).trim().replace(/^0x/, '');
                            guessed = `${base.replace(/\/$/, '')}/${digestNo0x}.json`;
                            setFetchedUrl(guessed);
                            // Try to fetch the canonical JSON automatically and populate the ciphertext input
                            try {
                              const resp = await fetch(guessed);
                              if (resp.ok) {
                                const txt = await resp.text();
                                // If we got valid JSON or text, populate and make read-only to avoid accidental edits
                                setAdminCiphertextInput(txt);
                                setAdminCiphertextReadOnly(true);
                                setFetchStatusMessage('Fetched canonical evidence JSON successfully.');
                              } else {
                                // on non-OK, still set the URL so admin can fetch manually
                                setAdminCiphertextInput(guessed);
                                setAdminCiphertextReadOnly(false);
                                setFetchStatusMessage(`Could not fetch canonical JSON: ${resp.status} ${resp.statusText}. You can open the URL and download the file, then paste the JSON here.`);
                              }
                            } catch (e) {
                              // Network/CORS failure - fall back to placing the guessed URL
                              setAdminCiphertextInput(guessed);
                              setAdminCiphertextReadOnly(false);
                              // Friendly guidance for likely CORS issues
                              setFetchStatusMessage('Could not fetch canonical JSON due to network/CORS restrictions. Open the URL below in a new tab and download the file, then paste the JSON into this textbox.');
                              // Log the error to console for debugging
                              try { console.debug('Fetch canonical evidence failed', e); } catch (_) {}
                            }
                          }
                        } catch (_) { setAdminCiphertextInput(''); }
                        // Do NOT auto-fill admin private key from env for security - leave empty so admin must paste/transiently enter it
                        setAdminPrivateKeyInput('');
                      }}>Admin decrypt (client)</button>
              {showAdminDecryptModal && (
                <div style={{position:'fixed', left:0, top:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center'}}>
                  <div style={{background:'#fff', padding:16, width:720, maxWidth:'95%', borderRadius:8}}>
                    <h4>Admin decrypt (client-side)</h4>
                    <div style={{fontSize:13, color:'#a33', marginBottom:8}}>Security: entering your private key here will only be used in this browser session and will not be saved. Prefer running server-side admin tools. Use only ephemeral keys if possible.</div>
                    <div style={{display:'flex', gap:12}}>
                      <div style={{flex:1}}>
                        <label>Ciphertext JSON or URL</label>
                        {adminCiphertextReadOnly ? (
                          <pre style={{whiteSpace:'pre-wrap', maxHeight:180, overflow:'auto', background:'#fafafa', padding:8, border:'1px solid #eee'}}>{adminCiphertextInput || <span style={{color:'#888'}}>No ciphertext available</span>}</pre>
                        ) : (
                          <textarea rows={6} value={adminCiphertextInput} onChange={e => setAdminCiphertextInput(e.target.value)} placeholder='Paste ciphertext JSON here or an HTTPS URL to fetch it' style={{width:'100%', boxSizing:'border-box'}} />
                        )}
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
                        setAdminDigest(null);
                        try {
                          let payload = adminCiphertextInput && adminCiphertextInput.trim() || '';
                          if (!payload) { alert('Provide ciphertext JSON or URL to fetch'); setAdminDecryptBusy(false); return; }
                          // If it's a URL, try to fetch
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
                            // Compute digest for display: if payload is JSON text, use it directly; if it's an object, stable-stringify it
                            let digest = null;
                            try { digest = computeDigestForCiphertext(payload); } catch (e) {
                              try {
                                const obj = JSON.parse(payload);
                                const stable = (function stableStringify(o) {
                                  if (o === null || typeof o !== 'object') return JSON.stringify(o);
                                  if (Array.isArray(o)) return '[' + o.map(v => stableStringify(v)).join(',') + ']';
                                  const keys = Object.keys(o).sort();
                                  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
                                })(obj);
                                digest = computeDigestForCiphertext(stable);
                              } catch (_) { digest = null; }
                            }

                            const plain = await decryptCiphertextJson(payload, adminPrivateKeyInput.trim());
                            setAdminDecrypted(plain);
                            if (digest) setAdminDigest(digest);
                          } catch (e) {
                            alert('Decryption failed: ' + (e?.message || e));
                          }
                        } finally { setAdminDecryptBusy(false); }
                      }}>Decrypt</button>
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
                    <div style={{marginTop:12}}>
                      <label>Decrypted plaintext</label>
                      <pre style={{whiteSpace:'pre-wrap', maxHeight:240, overflow:'auto', background:'#fafafa', padding:8}}>{adminDecrypted || <span style={{color:'#888'}}>No plaintext yet</span>}</pre>
                      <div style={{marginTop:8, display:'flex', gap:8, alignItems:'center'}}>
                        <div style={{flex:1}}>
                          <label>Ciphertext digest (keccak256)</label>
                          <pre style={{whiteSpace:'pre-wrap', wordBreak:'break-all', background:'#fff', padding:8}}>{adminDigest || <span style={{color:'#888'}}>No digest computed</span>}</pre>
                        </div>
                        <div style={{display:'flex', flexDirection:'column', gap:8}}>
                          <button type="button" className="btn-sm" onClick={handleCopyDigest} disabled={!adminDigest}>Copy digest</button>
                          <button type="button" className="btn-sm" onClick={handleDownloadPlaintext} disabled={!adminDecrypted}>Download plaintext</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Reporter bond and withdrawable info */}
              {disputeInfo && (
            <div style={{marginTop:12}}>
              <div><strong>Reporter bond (fixed):</strong> 0.002 ETH</div>
              <div><strong>Reporter bond (held):</strong> {reporterBondEth} ETH</div>
              <div><strong>Initiator withdrawable:</strong> {initiatorWithdrawableEth} ETH</div>
              {/* Reporter bond is paid with the initial report transaction; no separate post button needed. */}
              <div style={{marginTop:8}}>
                <em style={{color:'#555'}}>Arbitration owner withdraws (if any) are handled off-chain or via the owner's UI.</em>
              </div>
            </div>
          )}
          <div style={{marginTop:12, display:'flex', justifyContent:'flex-end'}}>
            <button type="button" className="btn-sm" onClick={onClose} disabled={submitting}>Cancel</button>
            <button
              type="submit"
              className="btn-sm primary"
              style={{marginLeft:8}}
              disabled={
                submitting || (
                  // If approving a dispute that includes a payment, require explicit confirmation
                  (decision === 'approve' && disputeInfo && disputeInfo.requestedAmountWei > 0n && (!confirmPay || (debtorDepositWei < disputeInfo.requestedAmountWei)))
                ) || (
                  // Additionally, if attempting to approve (non-landlord finalize path) and the connected wallet
                  // is not authorized as the arbitration owner/factory, disable the approve button to avoid on-chain reverts.
                  decision === 'approve' && !isAuthorizedArbitrator && !(disputeInfo && disputeInfo.requestedAmountWei > 0n && false)
                )
              }
            >
              {submitting ? 'Submitting...' : (decision === 'approve' ? (disputeInfo && disputeInfo.requestedAmountWei > 0n ? `Approve and Pay ${disputeAmountEth} ETH` : (requiredFeeEth && requiredFeeEth !== '0' ? `Approve and Pay ${requiredFeeEth} ETH` : 'Approve')) : 'Submit')}
            </button>
          </div>
        </form>
      </div>
      <ConfirmPayModal open={depositConfirmOpen} title="Confirm deposit" amountEth={depositConfirmAmount} details={`This will deposit funds for case ${disputeInfo?.caseId || ''}.`} onConfirm={async () => { if (depositConfirmAction) await depositConfirmAction(); setDepositConfirmOpen(false); }} onCancel={() => setDepositConfirmOpen(false)} busy={depositConfirmBusy} />
    </div>
  );
}
