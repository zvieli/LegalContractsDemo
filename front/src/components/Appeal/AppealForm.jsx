import React, { useState } from 'react';
import { Buffer } from 'buffer';
import './AppealForm.css';
import EvidenceSubmit from '../EvidenceSubmit/EvidenceSubmit';
import { useEthers } from '../../contexts/EthersContext';
import { ContractService } from '../../services/contractService';
import { createContractInstanceAsync } from '../../utils/contracts';

export default function AppealForm({ contractAddress, disputeId, contractName = 'EnhancedRentContract', methodName = 'appealDispute', onSubmitted }) {
  // note: we will perform evidence preparation + submit in handleSubmit below
  const { signer, account, provider, chainId } = useEthers();
  const [evidenceResult, setEvidenceResult] = useState(null);
  const [txResult, setTxResult] = useState(null);
  const [error, setError] = useState(null);

  const onEvidenceSubmitted = async (serverResp) => {
    // serverResp expected to contain { cid, digest }
    setEvidenceResult(serverResp);
    setTxResult(null);
    setError(null);
    try {
      if (!signer) throw new Error('Wallet not connected');
      const digest = serverResp && (serverResp.digest || serverResp.hash || serverResp.id);
      if (!digest) throw new Error('No digest returned from evidence endpoint');

      // Create a contract instance for the target template using the configured contractName
      const contract = await createContractInstanceAsync(contractName, contractAddress, signer);
      if (!contract) throw new Error('Unable to create contract instance');

      // Call the configured methodName on the contract with disputeId and digest
      if (typeof contract[methodName] !== 'function') {
        throw new Error(`Contract does not expose method ${methodName}`);
      }
      const tx = await contract[methodName](disputeId, digest);
      const receipt = await tx.wait();
      setTxResult({ ok: true, txHash: receipt.transactionHash, receipt });
    } catch (e) {
      setError(String(e));
      setTxResult({ ok: false, error: String(e) });
    }
  };

  // Helper to POST JSON and return parsed JSON or throw
  const postJSON = async (url, body, authAddress) => {
    const headers = { 'Content-Type': 'application/json' };
    if (authAddress) headers.Authorization = `Bearer ${authAddress}`;
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json && json.error ? json.error : `HTTP ${resp.status}`);
    return json;
  };

  // Wrapper to pass into EvidenceSubmit: handle the full appeal flow
  // 1) compute ciphertext+digest locally
  // 2) submit on-chain tx (appeal/report)
  // 3) after tx confirmed, POST /submit-evidence
  // 4) then POST /register-dispute with txHash, digest, contractAddress
  const handleSubmit = async (payloadStr) => {
    setError(null);
    setEvidenceResult(null);
    setTxResult(null);
    try {
      if (!signer) throw new Error('Wallet not connected');

      // Compute prepared evidence payload (ciphertext + digest) using utils via the hook where possible
      let prep = null;
      try {
        // dynamic import to avoid circular dependencies
        const mod = await import('../../utils/evidence');
        prep = await mod.prepareEvidencePayload(payloadStr, {});
      } catch (e) {
        // fallback: compute digest only
        try {
          const mod = await import('../../utils/evidence');
          const d = await mod.computeDigestForText(payloadStr);
          prep = { ciphertext: payloadStr, digest: d };
        } catch (ee) {
          throw new Error('Failed to prepare evidence payload: ' + String(ee));
        }
      }

      const digest = prep && (prep.digest || prep.hash || prep.id);
      if (!digest) throw new Error('Could not compute evidence digest');

      // create contract instance and send the on-chain appeal/report tx using the digest
      const contract = await createContractInstanceAsync(contractName, contractAddress, signer);
      if (!contract) throw new Error('Unable to create contract instance');
      if (typeof contract[methodName] !== 'function') throw new Error(`Contract does not expose method ${methodName}`);

      // Call the contract method. Many templates accept (disputeId, digest) or similar.
      let tx;
      try {
        tx = await contract[methodName](disputeId, digest);
      } catch (e) {
        // surface useful info
        throw new Error(`On-chain ${methodName} failed: ${String(e)}`);
      }

      const receipt = await tx.wait();
      const txHash = receipt && receipt.transactionHash;
      setTxResult({ ok: true, txHash, receipt });
      console.log('Appeal tx confirmed:', txHash, receipt);

      // After tx is confirmed, POST the evidence to the server
      const apiBase = (import.meta.env && import.meta.env.VITE_EVIDENCE_SUBMIT_ENDPOINT) || (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__.VITE_EVIDENCE_SUBMIT_ENDPOINT) || '/submit-evidence';

      // Build ciphertext base64: prefer prep.ciphertext; server expects base64 ciphertext
      let ciphertextToSend = '';
      const ctSource = prep && prep.ciphertext ? String(prep.ciphertext) : String(payloadStr || '');
      try {
        if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
          ciphertextToSend = window.btoa(ctSource);
        } else {
          ciphertextToSend = Buffer.from(ctSource, 'utf8').toString('base64');
        }
      } catch (e) {
        ciphertextToSend = Buffer.from(ctSource, 'utf8').toString('base64');
      }

  const { safeGetAddress } = await import('../../utils/signer.js');
  const contractService = new ContractService(provider, signer, chainId);
  const readProvider = contractService._providerForRead() || provider || null;
  const submitterAddress = signer ? await safeGetAddress(signer, readProvider || contractService) : null;
      const submitBody = { ciphertext: ciphertextToSend, digest };
      let submitResp;
      try {
        submitResp = await postJSON(apiBase, submitBody, submitterAddress);
        console.log('/submit-evidence response:', submitResp);
        setEvidenceResult(submitResp);
      } catch (e) {
        // log and surface error but continue to set state
        console.error('/submit-evidence failed', e);
        setError(String(e));
        setEvidenceResult({ ok: false, error: String(e) });
        return;
      }

      // After a successful /submit-evidence, register the dispute with the backend
      try {
  const registerUrl = (import.meta.env && import.meta.env.VITE_EVIDENCE_REGISTER_ENDPOINT) || (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__.VITE_EVIDENCE_REGISTER_ENDPOINT) || '/register-dispute';
  const registerBody = { txHash, digest: submitResp.digest || digest, contractAddress };
  const regResp = await postJSON(registerUrl, registerBody, submitterAddress);
        console.log('/register-dispute response:', regResp);
        // augment evidenceResult with register response for UI
        setEvidenceResult(prev => ({ ...prev, register: regResp }));
        if (typeof onSubmitted === 'function') {
          try { onSubmitted({ submit: submitResp, register: regResp }); } catch (_) {}
        }
      } catch (e) {
        console.error('/register-dispute failed', e);
        setError(String(e));
        setEvidenceResult(prev => ({ ...prev, register: { ok: false, error: String(e) } }));
      }

    } catch (e) {
      setError(String(e));
      setTxResult({ ok: false, error: String(e) });
    }
  };

  return (
    <div className="appeal-form">
      <h3>Submit Appeal</h3>
      <p>Provide off-chain evidence for your appeal. Evidence will be uploaded and then the dispute appeal transaction will be submitted on-chain.</p>
  {/* Reuse EvidenceSubmit UI but pass our handleSubmit and evidenceType='appeal' so the full flow runs: on-chain tx -> /submit-evidence -> /register-dispute */}
  <EvidenceSubmit submitHandler={handleSubmit} evidenceType="appeal" authAddress={account} />

      {evidenceResult && (
        <div className="appeal-evidence-result">
          <h4>Evidence Result</h4>
          <pre>{JSON.stringify(evidenceResult, null, 2)}</pre>
        </div>
      )}

      {txResult && (
        <div className="appeal-tx-result">
          <h4>On-chain Result</h4>
          {txResult.ok ? (
            <div>Transaction submitted: <code>{txResult.txHash}</code></div>
          ) : (
            <div className="error">Tx error: {txResult.error}</div>
          )}
        </div>
      )}

      {error && (
        <div className="error">{error}</div>
      )}
    </div>
  );
}
