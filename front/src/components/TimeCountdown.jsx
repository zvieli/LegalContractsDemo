import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

const TimeCountdown = ({ contractAddress, contractType = 'rent' }) => {
  const [timeData, setTimeData] = useState({
    nextPaymentDue: null,
    contractEndDate: null,
    nextPaymentCountdown: { days: 0, hours: 0, minutes: 0, seconds: 0 },
    contractEndCountdown: { days: 0, hours: 0, minutes: 0, seconds: 0 },
    isOverdue: false,
    daysUntilExpiry: 0
  });

  const [contractDetails, setContractDetails] = useState({
    rentAmount: '0',
    lateFeePercentage: 0,
    currentStatus: 'active',
    lastPaymentDate: null
  });

  useEffect(() => {
    loadContractTimeData();
    const interval = setInterval(updateCountdowns, 1000);
    return () => clearInterval(interval);
  }, [contractAddress]);

  const loadContractTimeData = async () => {
    try {
      // In a real implementation, load from the contract
      // For demo purposes, we'll simulate the data
      
      const now = new Date();
      const nextPayment = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000)); // 7 days from now
      const contractEnd = new Date(now.getTime() + (365 * 24 * 60 * 60 * 1000)); // 1 year from now
      
      // Simulate contract details
      const details = {
        rentAmount: '1.5',
        lateFeePercentage: 5,
        currentStatus: 'active',
        lastPaymentDate: new Date(now.getTime() - (23 * 24 * 60 * 60 * 1000)) // 23 days ago
      };

      setTimeData(prev => ({
        ...prev,
        nextPaymentDue: nextPayment,
        contractEndDate: contractEnd
      }));

      setContractDetails(details);
      
      // Load real contract data if available
      if (window.ethereum && contractAddress !== '0x1111111111111111111111111111111111111111') {
        try {
          await loadRealContractData();
        } catch (error) {
          console.log('Using simulated data as fallback');
        }
      }

    } catch (error) {
      console.error('Error loading contract time data:', error);
    }
  };

  const loadRealContractData = async () => {
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      
      // Load contract ABI (simplified version)
      const contractABI = [
        "function dueDate() view returns (uint256)",
        "function rentAmount() view returns (uint256)",
        "function lateFeePercentage() view returns (uint256)",
        "function active() view returns (bool)"
      ];

      const contract = new ethers.Contract(contractAddress, contractABI, provider);
      
      // Get contract data
      const dueDate = await contract.dueDate();
      const rentAmount = await contract.rentAmount();
      const active = await contract.active();
      
      const dueDateJS = new Date(Number(dueDate) * 1000);
      const contractEndJS = new Date(dueDateJS.getTime() + (365 * 24 * 60 * 60 * 1000));
      
      setTimeData(prev => ({
        ...prev,
        nextPaymentDue: dueDateJS,
        contractEndDate: contractEndJS
      }));

      setContractDetails(prev => ({
        ...prev,
        rentAmount: ethers.formatEther(rentAmount),
        currentStatus: active ? 'active' : 'inactive'
      }));

    } catch (error) {
      console.error('Error loading real contract data:', error);
      throw error;
    }
  };

  const updateCountdowns = () => {
    const now = new Date();
    
    if (timeData.nextPaymentDue) {
      const paymentDiff = timeData.nextPaymentDue.getTime() - now.getTime();
      const isOverdue = paymentDiff < 0;
      
      const absDiff = Math.abs(paymentDiff);
      const nextPaymentCountdown = {
        days: Math.floor(absDiff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((absDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        minutes: Math.floor((absDiff % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((absDiff % (1000 * 60)) / 1000)
      };

      setTimeData(prev => ({ ...prev, nextPaymentCountdown, isOverdue }));
    }

    if (timeData.contractEndDate) {
      const endDiff = timeData.contractEndDate.getTime() - now.getTime();
      const daysUntilExpiry = Math.floor(endDiff / (1000 * 60 * 60 * 24));
      
      const contractEndCountdown = {
        days: Math.floor(endDiff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((endDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        minutes: Math.floor((endDiff % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((endDiff % (1000 * 60)) / 1000)
      };

      setTimeData(prev => ({ ...prev, contractEndCountdown, daysUntilExpiry }));
    }
  };

  const formatCountdown = (countdown) => {
    return `${countdown.days}d ${countdown.hours}h ${countdown.minutes}m ${countdown.seconds}s`;
  };

  const getPaymentStatusColor = () => {
    if (timeData.isOverdue) return '#ef4444';
    if (timeData.nextPaymentCountdown.days <= 3) return '#f59e0b';
    return '#10b981';
  };

  const getContractStatusColor = () => {
    if (timeData.daysUntilExpiry <= 30) return '#ef4444';
    if (timeData.daysUntilExpiry <= 90) return '#f59e0b';
    return '#10b981';
  };

  const calculateLateFee = () => {
    if (!timeData.isOverdue) return 0;
    const baseAmount = parseFloat(contractDetails.rentAmount);
    const lateFee = (baseAmount * contractDetails.lateFeePercentage) / 100;
    return lateFee;
  };

  return (
    <div className="time-countdown-container" style={{ maxWidth: '900px', margin: '0 auto', padding: '20px' }}>
      <h2 style={{ textAlign: 'center', marginBottom: '30px' }}>
        ⏰ Contract Timeline & Payment Schedule
      </h2>

      {/* Contract Status Overview */}
      <div style={{ 
        background: '#f8fafc', 
        border: '2px solid #e2e8f0', 
        borderRadius: '12px', 
        padding: '20px', 
        marginBottom: '25px' 
      }}>
        <h3>📋 Contract Overview</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginTop: '15px' }}>
          <div>
            <strong>Contract Address:</strong><br />
            <code style={{ 
              background: '#e2e8f0', 
              padding: '4px 8px', 
              borderRadius: '4px', 
              fontSize: '12px' 
            }}>
              {contractAddress}
            </code>
          </div>
          <div>
            <strong>Rent Amount:</strong><br />
            <span style={{ color: '#059669', fontSize: '18px', fontWeight: 'bold' }}>
              {contractDetails.rentAmount} ETH
            </span>
          </div>
          <div>
            <strong>Status:</strong><br />
            <span style={{ 
              color: contractDetails.currentStatus === 'active' ? '#10b981' : '#ef4444',
              textTransform: 'capitalize',
              fontWeight: 'bold'
            }}>
              {contractDetails.currentStatus}
            </span>
          </div>
          <div>
            <strong>Late Fee:</strong><br />
            <span style={{ color: '#6b7280' }}>
              {contractDetails.lateFeePercentage}% per month
            </span>
          </div>
        </div>
      </div>

      {/* Next Payment Countdown */}
      <div style={{ 
        background: timeData.isOverdue ? '#fef2f2' : '#f0fdf4', 
        border: `2px solid ${getPaymentStatusColor()}`, 
        borderRadius: '12px', 
        padding: '20px', 
        marginBottom: '25px' 
      }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {timeData.isOverdue ? '⚠️' : '💰'} Next Payment {timeData.isOverdue ? 'OVERDUE' : 'Due'}
        </h3>
        
        <div style={{ textAlign: 'center', margin: '20px 0' }}>
          <div style={{ 
            fontSize: '32px', 
            fontWeight: 'bold', 
            color: getPaymentStatusColor(),
            fontFamily: 'monospace'
          }}>
            {timeData.isOverdue ? '⚠️ ' : ''}{formatCountdown(timeData.nextPaymentCountdown)}
          </div>
          <p style={{ color: '#6b7280', marginTop: '10px' }}>
            {timeData.isOverdue ? 'Payment was due on: ' : 'Payment due on: '}
            {timeData.nextPaymentDue?.toLocaleDateString()} at {timeData.nextPaymentDue?.toLocaleTimeString()}
          </p>
        </div>

        {timeData.isOverdue && (
          <div style={{ 
            background: '#fee2e2', 
            border: '1px solid #fecaca', 
            borderRadius: '8px', 
            padding: '15px', 
            marginTop: '15px' 
          }}>
            <h4 style={{ color: '#dc2626', margin: '0 0 10px 0' }}>⚠️ Late Fee Applied</h4>
            <p style={{ margin: '0' }}>
              <strong>Additional Amount Due:</strong> 
              <span style={{ color: '#dc2626', marginLeft: '10px', fontSize: '18px', fontWeight: 'bold' }}>
                +{calculateLateFee().toFixed(4)} ETH
              </span>
            </p>
            <p style={{ color: '#6b7280', fontSize: '14px', margin: '5px 0 0 0' }}>
              Late fee of {contractDetails.lateFeePercentage}% applied to base rent amount
            </p>
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button
            data-testid="pay-rent-button"
            style={{
              backgroundColor: '#10b981',
              color: 'white',
              padding: '12px 24px',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '16px',
              flex: 1
            }}
          >
            💰 Pay Rent ({contractDetails.rentAmount} ETH{timeData.isOverdue ? ` + ${calculateLateFee().toFixed(4)} ETH fee` : ''})
          </button>
          
          <button
            data-testid="view-payment-history-button"
            style={{
              backgroundColor: '#6b7280',
              color: 'white',
              padding: '12px 24px',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '16px'
            }}
          >
            📊 History
          </button>
        </div>
      </div>

      {/* Contract End Countdown */}
      <div style={{ 
        background: timeData.daysUntilExpiry <= 30 ? '#fef2f2' : '#f8fafc', 
        border: `2px solid ${getContractStatusColor()}`, 
        borderRadius: '12px', 
        padding: '20px', 
        marginBottom: '25px' 
      }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          📅 Contract Expiration
        </h3>
        
        <div style={{ textAlign: 'center', margin: '20px 0' }}>
          <div style={{ 
            fontSize: '28px', 
            fontWeight: 'bold', 
            color: getContractStatusColor(),
            fontFamily: 'monospace'
          }}>
            {formatCountdown(timeData.contractEndCountdown)}
          </div>
          <p style={{ color: '#6b7280', marginTop: '10px' }}>
            Contract expires on: {timeData.contractEndDate?.toLocaleDateString()} at {timeData.contractEndDate?.toLocaleTimeString()}
          </p>
        </div>

        {timeData.daysUntilExpiry <= 90 && (
          <div style={{ 
            background: timeData.daysUntilExpiry <= 30 ? '#fee2e2' : '#fef3c7', 
            border: `1px solid ${timeData.daysUntilExpiry <= 30 ? '#fecaca' : '#fde68a'}`, 
            borderRadius: '8px', 
            padding: '15px', 
            marginTop: '15px' 
          }}>
            <h4 style={{ 
              color: timeData.daysUntilExpiry <= 30 ? '#dc2626' : '#d97706', 
              margin: '0 0 10px 0' 
            }}>
              {timeData.daysUntilExpiry <= 30 ? '🚨' : '⚠️'} Contract Renewal Required
            </h4>
            <p style={{ margin: '0' }}>
              This contract will expire in {timeData.daysUntilExpiry} days. 
              {timeData.daysUntilExpiry <= 30 ? ' Immediate action required!' : ' Consider renewing soon.'}
            </p>
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button
            data-testid="renew-contract-button"
            style={{
              backgroundColor: '#3b82f6',
              color: 'white',
              padding: '12px 24px',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '16px',
              flex: 1
            }}
          >
            🔄 Renew Contract
          </button>
          
          <button
            data-testid="download-contract-button"
            style={{
              backgroundColor: '#6b7280',
              color: 'white',
              padding: '12px 24px',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '16px'
            }}
          >
            📥 Download
          </button>
        </div>
      </div>

      {/* Payment Schedule Preview */}
      <div style={{ 
        background: '#fff', 
        border: '2px solid #e5e7eb', 
        borderRadius: '12px', 
        padding: '20px' 
      }}>
        <h3>📅 Upcoming Payment Schedule</h3>
        <div style={{ marginTop: '15px' }}>
          {[1, 2, 3].map(month => {
            const futureDate = new Date(timeData.nextPaymentDue?.getTime() + (month * 30 * 24 * 60 * 60 * 1000));
            return (
              <div key={month} style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                padding: '10px 0', 
                borderBottom: month < 3 ? '1px solid #f3f4f6' : 'none' 
              }}>
                <span>{futureDate?.toLocaleDateString()}</span>
                <span style={{ fontWeight: 'bold' }}>{contractDetails.rentAmount} ETH</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TimeCountdown;