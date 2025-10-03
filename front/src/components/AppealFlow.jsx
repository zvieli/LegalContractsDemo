import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

const AppealFlow = ({ contractAddress, disputeId, onAppealSubmitted }) => {
  const [appealData, setAppealData] = useState({
    evidenceText: '',
    isSubmitting: false,
    appealStatus: 'not_started', // not_started, pending, completed, rejected
    firstDisputeResult: null,
    appealResult: null
  });

  const [timeRemaining, setTimeRemaining] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0
  });

  useEffect(() => {
    loadDisputeData();
    startAppealTimer();
  }, [contractAddress, disputeId]);

  const loadDisputeData = async () => {
    try {
      // Load first dispute result and appeal status
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      
      // Simulate loading dispute data (replace with actual contract calls)
      const firstResult = {
        requestedAmount: '1.5 ETH',
        appliedAmount: '1.0 ETH',
        status: 'approved',
        timestamp: Date.now() - 24 * 60 * 60 * 1000 // 24 hours ago
      };

      setAppealData(prev => ({
        ...prev,
        firstDisputeResult: firstResult,
        appealStatus: 'not_started'
      }));
    } catch (error) {
      console.error('Error loading dispute data:', error);
    }
  };

  const startAppealTimer = () => {
    // Appeal deadline is typically 7 days from first dispute resolution
    const appealDeadline = Date.now() + (7 * 24 * 60 * 60 * 1000);
    
    const timer = setInterval(() => {
      const now = Date.now();
      const timeDiff = appealDeadline - now;
      
      if (timeDiff <= 0) {
        clearInterval(timer);
        setTimeRemaining({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }
      
      const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((timeDiff % (1000 * 60)) / 1000);
      
      setTimeRemaining({ days, hours, minutes, seconds });
    }, 1000);

    return () => clearInterval(timer);
  };

  const handleAppealSubmit = async () => {
    if (!appealData.evidenceText.trim()) {
      alert('Please provide evidence for your appeal');
      return;
    }

    setAppealData(prev => ({ ...prev, isSubmitting: true }));

    try {
      // 1. Encrypt and submit evidence
      const evidencePayload = {
        type: 'appeal',
        text: appealData.evidenceText,
        contractAddress,
        disputeId,
        timestamp: Date.now()
      };

      // Simulate evidence submission (replace with actual evidence API)
      const evidenceResponse = await fetch('/api/submit-evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(evidencePayload)
      }).catch(() => ({
        ok: true,
        json: () => ({ digest: '0x' + 'a'.repeat(64) })
      }));

      const evidenceResult = await evidenceResponse.json();

      // 2. Submit appeal to blockchain
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      
      // Create dispute on the contract (simulate appeal)
      console.log('Submitting appeal to blockchain...');
      console.log('Evidence digest:', evidenceResult.digest);

      // Simulate successful appeal submission
      const appealResult = {
        transactionHash: '0x' + 'b'.repeat(64),
        status: 'pending',
        submittedAt: Date.now()
      };

      setAppealData(prev => ({
        ...prev,
        appealStatus: 'pending',
        isSubmitting: false,
        appealResult
      }));

      if (onAppealSubmitted) {
        onAppealSubmitted(appealResult);
      }

    } catch (error) {
      console.error('Error submitting appeal:', error);
      setAppealData(prev => ({ ...prev, isSubmitting: false }));
      alert('Failed to submit appeal. Please try again.');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'approved': return '#10b981';
      case 'rejected': return '#ef4444';
      case 'pending': return '#f59e0b';
      default: return '#6b7280';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'approved': return '✅';
      case 'rejected': return '❌';
      case 'pending': return '⏳';
      default: return '📋';
    }
  };

  return (
    <div className="appeal-flow-container" style={{ maxWidth: '800px', margin: '0 auto', padding: '20px' }}>
      <h2 style={{ textAlign: 'center', marginBottom: '30px' }}>
        📞 Appeal Process - Dispute #{disputeId}
      </h2>

      {/* Appeal Timer */}
      <div style={{ 
        background: '#f3f4f6', 
        padding: '20px', 
        borderRadius: '12px', 
        marginBottom: '25px',
        textAlign: 'center'
      }}>
        <h3>⏰ Time Remaining to Submit Appeal</h3>
        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#dc2626' }}>
          {timeRemaining.days}d {timeRemaining.hours}h {timeRemaining.minutes}m {timeRemaining.seconds}s
        </div>
        <p style={{ color: '#6b7280', marginTop: '10px' }}>
          Appeals must be submitted within 7 days of initial dispute resolution
        </p>
      </div>

      {/* First Dispute Results */}
      {appealData.firstDisputeResult && (
        <div style={{ 
          background: '#fff', 
          border: '2px solid #e5e7eb', 
          borderRadius: '12px', 
          padding: '20px', 
          marginBottom: '25px' 
        }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {getStatusIcon(appealData.firstDisputeResult.status)} 
            Initial Dispute Result
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '15px' }}>
            <div>
              <strong>Requested Amount:</strong><br />
              <span style={{ color: '#6b7280' }}>{appealData.firstDisputeResult.requestedAmount}</span>
            </div>
            <div>
              <strong>Applied Amount:</strong><br />
              <span style={{ color: getStatusColor(appealData.firstDisputeResult.status) }}>
                {appealData.firstDisputeResult.appliedAmount}
              </span>
            </div>
          </div>
          <div style={{ marginTop: '15px' }}>
            <strong>Status:</strong> 
            <span style={{ 
              color: getStatusColor(appealData.firstDisputeResult.status),
              textTransform: 'capitalize',
              marginLeft: '10px'
            }}>
              {appealData.firstDisputeResult.status}
            </span>
          </div>
        </div>
      )}

      {/* Appeal Submission Form */}
      {appealData.appealStatus === 'not_started' && (
        <div style={{ 
          background: '#fff', 
          border: '2px solid #3b82f6', 
          borderRadius: '12px', 
          padding: '20px', 
          marginBottom: '25px' 
        }}>
          <h3>📝 Submit Your Appeal</h3>
          <p style={{ color: '#6b7280', marginBottom: '15px' }}>
            Provide detailed evidence to support your appeal. This will be reviewed by the arbitration system.
          </p>
          
          <textarea
            data-testid="appeal-evidence-textarea"
            value={appealData.evidenceText}
            onChange={(e) => setAppealData(prev => ({ ...prev, evidenceText: e.target.value }))}
            placeholder="Describe your evidence for the appeal. Include relevant details, documentation references, and reasoning..."
            style={{
              width: '100%',
              minHeight: '120px',
              padding: '12px',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              resize: 'vertical',
              fontFamily: 'inherit'
            }}
          />
          
          <button
            data-testid="submit-appeal-button"
            onClick={handleAppealSubmit}
            disabled={appealData.isSubmitting || !appealData.evidenceText.trim()}
            style={{
              backgroundColor: appealData.isSubmitting ? '#9ca3af' : '#3b82f6',
              color: 'white',
              padding: '12px 24px',
              border: 'none',
              borderRadius: '8px',
              cursor: appealData.isSubmitting ? 'not-allowed' : 'pointer',
              fontSize: '16px',
              marginTop: '15px',
              width: '100%'
            }}
          >
            {appealData.isSubmitting ? '⏳ Submitting Appeal...' : '📞 Submit Appeal'}
          </button>
        </div>
      )}

      {/* Appeal Status */}
      {appealData.appealStatus === 'pending' && (
        <div style={{ 
          background: '#fef3c7', 
          border: '2px solid #f59e0b', 
          borderRadius: '12px', 
          padding: '20px', 
          marginBottom: '25px' 
        }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            ⏳ Appeal Under Review
          </h3>
          <p>Your appeal has been submitted and is currently being reviewed by the arbitration system.</p>
          {appealData.appealResult && (
            <div style={{ marginTop: '15px' }}>
              <strong>Transaction:</strong> 
              <code style={{ 
                background: '#fff', 
                padding: '4px 8px', 
                borderRadius: '4px',
                marginLeft: '10px',
                fontSize: '14px'
              }}>
                {appealData.appealResult.transactionHash}
              </code>
            </div>
          )}
        </div>
      )}

      {/* Appeal Results */}
      {appealData.appealResult && appealData.appealStatus === 'completed' && (
        <div style={{ 
          background: appealData.appealResult.approved ? '#d1fae5' : '#fee2e2', 
          border: `2px solid ${appealData.appealResult.approved ? '#10b981' : '#ef4444'}`, 
          borderRadius: '12px', 
          padding: '20px' 
        }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {getStatusIcon(appealData.appealResult.approved ? 'approved' : 'rejected')} 
            Appeal Result
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '15px' }}>
            <div>
              <strong>Appeal Status:</strong><br />
              <span style={{ color: getStatusColor(appealData.appealResult.approved ? 'approved' : 'rejected') }}>
                {appealData.appealResult.approved ? 'Approved' : 'Rejected'}
              </span>
            </div>
            <div>
              <strong>Final Amount:</strong><br />
              <span style={{ color: '#059669' }}>
                {appealData.appealResult.finalAmount || 'N/A'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AppealFlow;