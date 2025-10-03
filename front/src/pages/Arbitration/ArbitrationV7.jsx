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
  const [selectedContract, setSelectedContract] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalReadOnly, setModalReadOnly] = useState(true);

  // V7 Arbitration Bond States
  const [submitArbitrationForm, setSubmitArbitrationForm] = useState({
    contractAddress: '',
    evidenceText: '',
    disputeQuestion: '',
    arbitrationBondAmount: '100' // Default 100 DAI
  });
  const [submittingArbitration, setSubmittingArbitration] = useState(false);

  useEffect(() => {
    const loadArbitrationRequests = async () => {
      setLoading(true);
      try {
        const platformAdmin = import.meta.env?.VITE_PLATFORM_ADMIN || null;
        const isAdmin = platformAdmin && account && account.toLowerCase() === platformAdmin.toLowerCase();
        
        if (!isAdmin) {
          setArbitrationRequests([]);
          setLoading(false);
          return;
        }

        // Use local JSON-RPC provider for admin reads
        const rpc = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
        const local = await getLocalDeploymentAddresses();
        
        // Get ArbitrationContractV2 address
        const arbitrationContractAddr = local?.ArbitrationContractV2 || 
          (await getContractAddress(Number(chainId || 31337), 'ArbitrationContractV2'));
        
        if (!arbitrationContractAddr) {
          console.warn('ArbitrationContractV2 not found');
          setArbitrationRequests([]);
          setLoading(false);
          return;
        }

        // Create ArbitrationContractV2 instance
        const arbitrationContract = await createContractInstanceAsync(
          'ArbitrationContractV2', 
          arbitrationContractAddr, 
          rpc
        );

        // Listen for arbitration events (simplified for demo)
        // In production, you'd parse events from recent blocks
        const filter = arbitrationContract.filters.ArbitrationRequested();
        const events = await arbitrationContract.queryFilter(filter, -1000, 'latest');
        
        const requests = events.map((event, index) => ({
          id: `${event.transactionHash}-${index}`,
          requestId: event.args.requestId.toString(),
          requester: event.args.requester,
          targetContract: event.args.targetContract,
          evidenceDigest: event.args.evidenceDigest,
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash,
          status: 'הוגש: ממתין לתגובת Oracle',
          timestamp: Date.now() - (index * 1000 * 60 * 30) // Mock timestamps
        }));

        setArbitrationRequests(requests);
      } catch (e) {
        console.error('Error loading V7 arbitration requests:', e);
        setArbitrationRequests([]);
      } finally {
        setLoading(false);
      }
    };

    loadArbitrationRequests();
  }, [account, chainId]);

  const handleSubmitArbitration = async () => {
    if (!signer || !submitArbitrationForm.contractAddress || !submitArbitrationForm.disputeQuestion) {
      alert('אנא מלא את כל השדות הנדרשים');
      return;
    }

    setSubmittingArbitration(true);
    try {
      const local = await getLocalDeploymentAddresses();
      const arbitrationContractAddr = local?.ArbitrationContractV2 || 
        (await getContractAddress(Number(chainId || 31337), 'ArbitrationContractV2'));

      if (!arbitrationContractAddr) {
        throw new Error('ArbitrationContractV2 not found');
      }

      // Create contract instance
      const arbitrationContract = await createContractInstanceAsync(
        'ArbitrationContractV2',
        arbitrationContractAddr,
        signer
      );

      // Convert bond amount to Wei (assuming DAI has 18 decimals)
      const bondAmountWei = ethers.parseEther(submitArbitrationForm.arbitrationBondAmount);

      // Prepare evidence digest (simplified - in production use proper evidence handling)
      const evidenceData = {
        contractText: "Contract details...", // Would be fetched from target contract
        evidenceText: submitArbitrationForm.evidenceText,
        disputeQuestion: submitArbitrationForm.disputeQuestion,
        timestamp: Date.now()
      };
      
      const evidenceString = JSON.stringify(evidenceData);
      const evidenceDigest = ethers.keccak256(ethers.toUtf8Bytes(evidenceString));

      // Submit arbitration request with bond
      const tx = await arbitrationContract.requestArbitration(
        submitArbitrationForm.contractAddress,
        evidenceDigest,
        submitArbitrationForm.disputeQuestion,
        {
          value: bondAmountWei // Send arbitration bond
        }
      );

      console.log('V7 Arbitration request submitted:', tx.hash);
      
      // Wait for confirmation
      await tx.wait();
      
      alert(`בקשת בוררות V7 הוגשה בהצלחה!\nTransaction: ${tx.hash}`);
      
      // Reset form
      setSubmitArbitrationForm({
        contractAddress: '',
        evidenceText: '',
        disputeQuestion: '',
        arbitrationBondAmount: '100'
      });

      // Refresh the list
      window.location.reload();

    } catch (error) {
      console.error('Error submitting V7 arbitration:', error);
      alert(`שגיאה בהגשת בקשת הבוררות: ${error.message}`);
    } finally {
      setSubmittingArbitration(false);
    }
  };

  const handleView = (contractAddress) => {
    setSelectedContract(contractAddress);
    setModalReadOnly(true);
    setIsModalOpen(true);
  };

  const getStatusColor = (status) => {
    if (status.includes('ממתין לתגובת Oracle')) return '#ff9800';
    if (status.includes('החלטת AI התקבלה')) return '#2196f3';
    if (status.includes('הליך הסתיים')) return '#4caf50';
    return '#757575';
  };

  if (!isConnected) {
    return (
      <div className="arbitration-page">
        <div className="not-connected">
          <i className="fas fa-wallet"></i>
          <h2>Connect Your Wallet</h2>
          <p>Please connect your wallet to access V7 arbitration</p>
        </div>
      </div>
    );
  }

  const platformAdmin = import.meta.env?.VITE_PLATFORM_ADMIN || null;
  const isAdmin = platformAdmin && account && account.toLowerCase() === platformAdmin.toLowerCase();

  return (
    <div className="arbitration-page">
      <div className="page-header">
        <h1>🤖 V7 AI Arbitration Center</h1>
        <p>Chainlink Functions + Ollama LLM Powered Legal Decisions</p>
        <div className="v7-status-indicator" style={{
          background: '#4caf50',
          color: 'white',
          padding: '8px 16px',
          borderRadius: '20px',
          display: 'inline-block',
          marginTop: '10px',
          fontSize: '14px'
        }}>
          ✅ מערכת בוררות V7 פעילה
        </div>
      </div>

      <div className="arbitration-content">
        {/* V7 Statistics */}
        <div className="stats-cards">
          <div className="stat-card">
            <div className="stat-icon">
              <i className="fas fa-robot"></i>
            </div>
            <div className="stat-content">
              <h3>{arbitrationRequests.length}</h3>
              <p>בקשות בוררות V7</p>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">
              <i className="fas fa-clock"></i>
            </div>
            <div className="stat-content">
              <h3>{arbitrationRequests.filter(r => r.status.includes('ממתין')).length}</h3>
              <p>ממתינות לעיבוד AI</p>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">
              <i className="fas fa-coins"></i>
            </div>
            <div className="stat-content">
              <h3>100 DAI</h3>
              <p>Arbitration Bond</p>
            </div>
          </div>
        </div>

        {/* Submit New Arbitration Request (V7) */}
        <div className="arbitration-section">
          <h2>🚀 הגש בקשת בוררות V7</h2>
          <div className="submit-arbitration-form" style={{
            background: '#f8f9fa',
            padding: '20px',
            borderRadius: '8px',
            border: '2px solid #007bff',
            marginBottom: '30px'
          }}>
            <div className="form-row">
              <div className="form-group">
                <label>כתובת החוזה לבוררות</label>
                <input
                  type="text"
                  value={submitArbitrationForm.contractAddress}
                  onChange={(e) => setSubmitArbitrationForm(prev => ({
                    ...prev,
                    contractAddress: e.target.value
                  }))}
                  placeholder="0x..."
                  style={{ width: '100%', padding: '10px', marginBottom: '10px' }}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>שאלת הבוררות (מה הסכסוך?)</label>
                <input
                  type="text"
                  value={submitArbitrationForm.disputeQuestion}
                  onChange={(e) => setSubmitArbitrationForm(prev => ({
                    ...prev,
                    disputeQuestion: e.target.value
                  }))}
                  placeholder="למשל: האם הדייר אמור לשלם דמי איחור?"
                  style={{ width: '100%', padding: '10px', marginBottom: '10px' }}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>ראיות ופרטים נוספים</label>
                <textarea
                  value={submitArbitrationForm.evidenceText}
                  onChange={(e) => setSubmitArbitrationForm(prev => ({
                    ...prev,
                    evidenceText: e.target.value
                  }))}
                  placeholder="תאר את הראיות, המסמכים והפרטים הרלוונטיים..."
                  rows={4}
                  style={{ width: '100%', padding: '10px', marginBottom: '10px' }}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>🔥 Arbitration Bond Amount (DAI) - חובה!</label>
                <input
                  type="number"
                  value={submitArbitrationForm.arbitrationBondAmount}
                  onChange={(e) => setSubmitArbitrationForm(prev => ({
                    ...prev,
                    arbitrationBondAmount: e.target.value
                  }))}
                  placeholder="100"
                  min="1"
                  style={{ 
                    width: '200px', 
                    padding: '10px', 
                    marginBottom: '10px',
                    border: '2px solid #ff6b35',
                    borderRadius: '4px'
                  }}
                />
                <small style={{ display: 'block', color: '#666', marginTop: '5px' }}>
                  סכום זה יוקפא ויוחזר לך או יועבר כפיצוי בהתאם להחלטת הבורר
                </small>
              </div>
            </div>

            <button
              onClick={handleSubmitArbitration}
              disabled={submittingArbitration}
              style={{
                background: submittingArbitration ? '#ccc' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                padding: '12px 24px',
                border: 'none',
                borderRadius: '6px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: submittingArbitration ? 'not-allowed' : 'pointer',
                marginTop: '10px'
              }}
            >
              {submittingArbitration ? '🔄 שולח בקשה...' : '🚀 הגש בקשת בוררות V7'}
            </button>
          </div>
        </div>

        {/* Arbitration Requests List */}
        <div className="arbitration-section">
          <div className="section-header">
            <h2>📋 בקשות בוררות V7 פעילות</h2>
            <button 
              onClick={() => window.location.reload()} 
              className="refresh-btn"
              style={{ 
                background: '#007bff', 
                color: 'white', 
                border: 'none', 
                padding: '8px 16px', 
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              🔄 רענן
            </button>
          </div>

          {loading ? (
            <div className="loading-spinner">
              <i className="fas fa-spinner fa-spin"></i>
              <p>Loading V7 arbitration requests...</p>
            </div>
          ) : arbitrationRequests.length === 0 ? (
            <div className="no-disputes">
              <i className="fas fa-balance-scale"></i>
              <h3>אין בקשות בוררות פעילות</h3>
              <p>כל הסכסוכים נפתרו או שאין בקשות חדשות</p>
            </div>
          ) : (
            <div className="disputes-table">
              <table>
                <thead>
                  <tr>
                    <th>Request ID</th>
                    <th>Target Contract</th>
                    <th>Requester</th>
                    <th>Status V7</th>
                    <th>Block</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {arbitrationRequests.map((request) => (
                    <tr key={request.id}>
                      <td>
                        <span className="contract-id">#{request.requestId}</span>
                      </td>
                      <td>
                        <span className="contract-address">{request.targetContract.slice(0, 10)}...</span>
                      </td>
                      <td>
                        <span className="requester">{request.requester.slice(0, 10)}...</span>
                      </td>
                      <td>
                        <span 
                          className="status-badge"
                          style={{ 
                            background: getStatusColor(request.status),
                            color: 'white',
                            padding: '4px 8px',
                            borderRadius: '12px',
                            fontSize: '12px'
                          }}
                        >
                          {request.status}
                        </span>
                      </td>
                      <td>#{request.blockNumber}</td>
                      <td>
                        <div className="action-buttons">
                          <button
                            onClick={() => handleView(request.targetContract)}
                            className="action-btn view-btn"
                            title="View Contract"
                          >
                            <i className="fas fa-eye"></i>
                          </button>
                          <button
                            onClick={() => window.open(`https://etherscan.io/tx/${request.transactionHash}`, '_blank')}
                            className="action-btn external-btn"
                            title="View Transaction"
                          >
                            <i className="fas fa-external-link-alt"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Contract Modal */}
      {isModalOpen && selectedContract && (
        <ContractModal
          contractAddress={selectedContract}
          onClose={() => setIsModalOpen(false)}
          readOnly={modalReadOnly}
        />
      )}
    </div>
  );
}

export default ArbitrationV7;