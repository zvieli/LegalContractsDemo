import { useState, useEffect } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import { ContractService } from '../../services/contractService';
import { ethers } from 'ethers';
import './ContractModal.css';

function ContractModal({ contractAddress, isOpen, onClose }) {
  const { signer, chainId, account } = useEthers();
  const [contractDetails, setContractDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [transactionHistory, setTransactionHistory] = useState([]);

  useEffect(() => {
    if (isOpen && contractAddress && signer) {
      loadContractData();
    }
  }, [isOpen, contractAddress, signer]);

  const loadContractData = async () => {
    try {
      setLoading(true);
      const contractService = new ContractService(signer, chainId);
      
      // טען פרטי חוזה
      const details = await contractService.getRentContractDetails(contractAddress);
      setContractDetails(details);
      
      // טען היסטוריית תשלומים (mock data for now)
      setTransactionHistory([
        { hash: '0x1234...', amount: '1.5 ETH', date: '2024-01-15', status: 'Confirmed' },
        { hash: '0x5678...', amount: '1.5 ETH', date: '2024-02-15', status: 'Confirmed' }
      ]);
      
    } catch (error) {
      console.error('Error loading contract data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePayRent = async () => {
    if (!paymentAmount || parseFloat(paymentAmount) <= 0) return;
    
    try {
      setActionLoading(true);
      const contractService = new ContractService(signer, chainId);
      const receipt = await contractService.payRent(contractAddress, paymentAmount);
      
      alert(`✅ Rent paid successfully!\nTransaction: ${receipt.hash}`);
      setPaymentAmount('');
      await loadContractData(); // Refresh data
      
    } catch (error) {
      console.error('Error paying rent:', error);
      alert(`❌ Payment failed: ${error.reason || error.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleTerminate = async () => {
    if (!confirm('Are you sure you want to terminate this contract?')) return;
    
    try {
      setActionLoading(true);
      const contractService = new ContractService(signer, chainId);
      const rentContract = await contractService.getRentContract(contractAddress);
      
      // אם יש פונקציית terminate
      const tx = await rentContract.terminateContract();
      const receipt = await tx.wait();
      
      alert(`✅ Contract terminated!\nTransaction: ${receipt.hash}`);
      onClose();
      
    } catch (error) {
      console.error('Error terminating contract:', error);
      alert(`❌ Termination failed: ${error.reason || error.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {/* ... existing modal code with real functionality ... */}
      </div>
    </div>
  );
}

export default ContractModal;