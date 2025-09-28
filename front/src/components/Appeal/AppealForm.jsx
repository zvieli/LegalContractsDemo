import React, { useState } from 'react';
import './AppealForm.css';
import EvidenceSubmit from '../EvidenceSubmit/EvidenceSubmit';
import { useEvidenceSubmit } from '../../hooks/useEvidenceSubmit';
import { useEthers } from '../../contexts/EthersContext';
import { createContractInstanceAsync } from '../../utils/contracts';

export default function AppealForm({ contractAddress, disputeId, contractName = 'TemplateRentContract', methodName = 'appealDispute' }) {
  const { submitEvidence, loading: evLoading } = useEvidenceSubmit();
  const { signer } = useEthers();
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

  // Wrapper to pass into EvidenceSubmit: it calls submitEvidence (same logic as EvidenceSubmit)
  const handleSubmit = async (payloadStr) => {
    setError(null);
    setEvidenceResult(null);
    setTxResult(null);
    try {
      const serverResp = await submitEvidence(payloadStr);
      // serverResp returned from submitEvidence should include digest
      await onEvidenceSubmitted(serverResp);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="appeal-form">
      <h3>Submit Appeal</h3>
      <p>Provide off-chain evidence for your appeal. Evidence will be uploaded and then the dispute appeal transaction will be submitted on-chain.</p>
  {/* Reuse EvidenceSubmit UI but pass submitHandler so EvidenceSubmit calls the shared hook directly */}
  <EvidenceSubmit submitHandler={submitEvidence} onSubmitted={(json) => { onEvidenceSubmitted(json); }} />

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
