import { useState, useEffect } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import * as ethers from 'ethers';
import { createContractInstanceAsync, getLocalDeploymentAddresses, getContractAddress } from '../../utils/contracts';
import './Arbitration.css';
import ContractModal from '../../components/ContractModal/ContractModal';
import { ContractService } from '../../services/contractService';

function ArbitrationV7() {
  const { isConnected, account, signer, chainId } = useEthers();
  const [arbitrationRequests, setArbitrationRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalReadOnly, setModalReadOnly] = useState(true);

  useEffect(() => {
    // ...load arbitration requests logic here...
  }, [account, chainId]);

  return (
    <div className="arbitration-page" data-testid="arbitration-v7-page">
      <h2 data-testid="arbitration-v7-title">Arbitration Requests (V7 AI)</h2>
      {loading ? (
        <div data-testid="arbitration-v7-loading">Loading...</div>
      ) : (
        <table className="arbitration-table" data-testid="arbitration-v7-table">
          <thead>
            <tr>
              <th data-testid="arbitration-v7-th-requestid">Request ID</th>
              <th data-testid="arbitration-v7-th-requester">Requester</th>
              <th data-testid="arbitration-v7-th-contract">Target Contract</th>
              <th data-testid="arbitration-v7-th-evidence">Evidence Hash</th>
              <th data-testid="arbitration-v7-th-status">Status</th>
              <th data-testid="arbitration-v7-th-actions">Actions</th>
              <th data-testid="arbitration-v7-th-verdict">AI Verdict</th>
              <th data-testid="arbitration-v7-th-rationale">Rationale</th>
              <th data-testid="arbitration-v7-th-enforcement">Enforcement</th>
            </tr>
          </thead>
          <tbody>
            {arbitrationRequests.map((req) => (
              <tr key={req.id} data-testid={`arbitration-v7-row-${req.id}`}>
                <td data-testid={`arbitration-v7-requestid-${req.id}`}>{req.requestId}</td>
                <td data-testid={`arbitration-v7-requester-${req.id}`}>{req.requester}</td>
                <td data-testid={`arbitration-v7-contract-${req.id}`}>{req.targetContract}</td>
                <td data-testid={`arbitration-v7-evidence-${req.id}`}>{req.evidenceDigest}</td>
                <td data-testid={`arbitration-v7-status-${req.id}`}>{req.status}</td>
                <td data-testid={`arbitration-v7-actions-${req.id}`}>
                  <button data-testid={`arbitration-v7-viewbtn-${req.id}`} onClick={() => {
                    setSelectedRequest(req);
                    setIsModalOpen(true);
                  }}>View</button>
                </td>
                <td data-testid={`arbitration-v7-verdict-${req.id}`}>{req.aiDecision ? req.aiDecision.verdict : '-'}</td>
                <td data-testid={`arbitration-v7-rationale-${req.id}`}>{req.aiDecision ? req.aiDecision.rationale : '-'}</td>
                <td data-testid={`arbitration-v7-enforcement-${req.id}`}>{req.enforcementStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {isModalOpen && selectedRequest && (
        <ContractModal
          contractAddress={selectedRequest.targetContract}
          readOnly={modalReadOnly}
          onClose={() => setIsModalOpen(false)}
        >
          <div data-testid="arbitration-v7-modal-details">
            <h3>AI Arbitration Decision</h3>
            <div><strong>Verdict:</strong> {selectedRequest.aiDecision ? selectedRequest.aiDecision.verdict : 'Pending'}</div>
            <div><strong>Rationale:</strong> {selectedRequest.aiDecision ? selectedRequest.aiDecision.rationale : '-'}</div>
            <div><strong>Reimbursement:</strong> {selectedRequest.aiDecision ? selectedRequest.aiDecision.reimbursement : '-'}</div>
            <div><strong>Evidence Hash:</strong> {selectedRequest.aiDecision ? selectedRequest.aiDecision.evidenceHash : selectedRequest.evidenceDigest}</div>
            <div><strong>Enforcement Status:</strong> {selectedRequest.enforcementStatus}</div>
          </div>
        </ContractModal>
      )}
    </div>
  );
}

export default ArbitrationV7;