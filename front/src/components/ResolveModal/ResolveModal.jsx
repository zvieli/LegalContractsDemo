import React, { useEffect, useState } from 'react';
import { ContractService } from '../../services/contractService';
import { ArbitrationService } from '../../services/arbitrationService';
import { ethers } from 'ethers';
import './ResolveModal.css';

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
  // (Removed duplicate state declarations)
  const [confirmPay, setConfirmPay] = useState(false);

  // Helper to parse ETH strings shown in UI back to wei BigInt safely
  const parseEtherSafe = (val) => {
    try {
      if (!val) return '0';
      return ethers.parseEther(String(val));
    } catch {
      // If formatting fails (already wei string), try to coerce
      try { return BigInt(val); } catch { return 0n; }
    }
  };

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
            try { setRequiredFeeEth((await import('ethers')).formatEther(required)); } catch { setRequiredFeeEth(String(required)); }
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
                setDisputeInfo({ caseId: i, requestedAmountWei: requestedAmount, initiator });
                try {
                  setDisputeAmountEth(ethers.formatEther(requestedAmount));
                } catch {
                  setDisputeAmountEth(String(requestedAmount));
                }

                // Try to fetch per-party deposit balances so the arbitrator
                // can see available funds and any remainder that will become debt.
                try {
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

                  const toApply = requestedAmount > debtorDep ? debtorDep : requestedAmount;
                  const remainder = requestedAmount > debtorDep ? requestedAmount - debtorDep : 0n;
                  setWillBeDebitedEth(ethers.formatEther(toApply));
                  setDebtRemainderEth(ethers.formatEther(remainder));
                  // Read reporter bond and withdrawable balances (best-effort via service helpers)
                    try {
                      const svc2 = new ContractService(signer, chainId);
                      const bond = await svc2.getDisputeBond(contractAddress, i).catch(() => 0n);
                      setReporterBondEth(ethers.formatEther(bond));
                      const initW = await svc2.getWithdrawable(contractAddress, initiator).catch(() => 0n);
                      setInitiatorWithdrawableEth(ethers.formatEther(initW));
                      // Also read withdrawable for arbitration owner (best-effort via arbitrationService lookup)
                      try {
                        const arbSvc = new ArbitrationService(signer, chainId);
                        const owner = await arbSvc.getArbitrationServiceOwnerByNDA(contractAddress).catch(() => null);
                        if (owner) {
                          setArbOwnerAddr(owner);
                          const arbW = await svc2.getWithdrawable(contractAddress, owner).catch(() => 0n);
                          setArbOwnerWithdrawableEth(ethers.formatEther(arbW));
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
                  setReporterBondEth((await import('ethers')).formatEther(bond));
                  const initW = BigInt(await svc.getWithdrawable(contractAddress, initiator));
                  setInitiatorWithdrawableEth((await import('ethers')).formatEther(initW));
                  // arbitration owner withdrawable - best-effort: read arbitrationService owner then withdrawable
                  try {
                    const rent = await svc.getRentContract(contractAddress);
                    const svcAddr = await rent.arbitrationService().catch(() => null);
                    if (svcAddr && svcAddr !== '0x0000000000000000000000000000000000000000') {
                      const arbSvc = createContractInstance('ArbitrationService', svcAddr, signer);
                      const owner = await arbSvc.owner().catch(() => null);
                      if (owner) {
                        const ownersW = BigInt(await svc.getWithdrawable(contractAddress, owner));
                        setArbOwnerWithdrawableEth((await import('ethers')).formatEther(ownersW));
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
    return () => { mounted = false; };
  }, [isOpen, contractAddress, signer, chainId]);

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
            const cfMod = await import('../../utils/contracts/ContractFactory.json');
            const cf = cfMod?.default ?? cfMod;
            arbAddr = cf?.contracts?.ArbitrationService || null;
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
            const arbContract = (await import('../../utils/contracts/ArbitrationServiceABI.json')).default?.abi ? null : null;
            // create instance via ContractService helper
            const svcInst = await (async () => {
              try { return await svc2.getRentContract(contractAddress).catch(() => null); } catch (_) { return null; }
            })();
            // Instead of relying on target, create a direct ArbitrationService contract to read owner/factory
            try {
              const mod = await import('../../utils/contracts/ArbitrationServiceABI.json');
              const abi = mod?.default?.abi ?? mod?.abi ?? mod;
              const ethersMod = await import('ethers');
              const arbRead = new ethersMod.Contract(arbAddr, abi, signer.provider || signer);
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
            await svc2.applyResolutionToTargetViaService(arbAddr, contractAddress, disputeInfo.caseId, true, disputeInfo.requestedAmountWei, disputeInfo.initiator, 0n);
          } else {
            // Otherwise treat as cancellation finalize and forward early-termination fee if required
            const feeToSend = requiredFeeWei && typeof requiredFeeWei === 'bigint' ? requiredFeeWei : 0n;
            await svc2.finalizeCancellationViaService(arbAddr, contractAddress, feeToSend);
          }

          // After on-chain confirmation, persist the decision locally and clear incoming markers
          try {
            const key = `arbResolution:${String(contractAddress).toLowerCase()}`;
            const payload = { contractAddress, decision, rationale, timestamp: Date.now() };
            localStorage.setItem(key, JSON.stringify(payload));
            sessionStorage.setItem('lastArbResolution', JSON.stringify(payload));
            try { localStorage.removeItem(`incomingDispute:${contractAddress}`); } catch (_) {}
            try { localStorage.removeItem(`incomingDispute:${String(contractAddress).toLowerCase()}`); } catch (_) {}
            try { sessionStorage.removeItem('incomingDispute'); } catch (_) {}
            if (typeof window !== 'undefined' && window.dispatchEvent) {
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
        const payload = {
          contractAddress,
          decision,
          rationale,
          timestamp: Date.now(),
        };
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

      if (onResolved) onResolved({ decision, rationale });
      onClose();
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
            <label>Rationale (optional)</label>
            <textarea value={rationale} onChange={e => setRationale(e.target.value)} rows={6} style={{width:'100%'}} />
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
                <div style={{marginTop:8}}>
                  <em style={{color:'#555'}}>If the beneficiary received funds directly, no withdrawal is necessary.</em>
                </div>
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
                  decision === 'approve' &&
                  disputeInfo &&
                  disputeInfo.requestedAmountWei > 0n &&
                  (!confirmPay || (debtorDepositWei < disputeInfo.requestedAmountWei))
                )
              }
            >
              {submitting ? 'Submitting...' : (decision === 'approve' ? (disputeInfo && disputeInfo.requestedAmountWei > 0n ? `Approve and Pay ${disputeAmountEth} ETH` : (requiredFeeEth && requiredFeeEth !== '0' ? `Approve and Pay ${requiredFeeEth} ETH` : 'Approve')) : 'Submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
