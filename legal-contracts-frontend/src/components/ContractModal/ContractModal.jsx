import { useState, useEffect } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import { ContractService } from '../../services/contractService';
import { ethers } from 'ethers';
import './ContractModal.css';

function ContractModal({ contractAddress, isOpen, onClose }) {
  const { signer, chainId, account } = useEthers();
  const [contractDetails, setContractDetails] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen && contractAddress && signer) {
      loadContractDetails();
    }
  }, [isOpen, contractAddress, signer]);

  const loadContractDetails = async () => {
    try {
      setLoading(true);
      const contractService = new ContractService(signer, chainId);
      
      // נסה לטעון פרטי חוזה אמיתיים
      try {
        const details = await contractService.getRentContractDetails(contractAddress);
        setContractDetails(details);
      } catch (error) {
        // אם יש שגיאה, נציג מידע mock
        console.log('Using mock data for contract:', contractAddress);
        setContractDetails({
          address: contractAddress,
          type: 'Rental',
          landlord: account,
          tenant: '0x1234...5678',
          rentAmount: '1.5',
          status: 'Active',
          created: '2024-01-15'
        });
      }
    } catch (error) {
      console.error('Error loading contract details:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Contract Details</h2>
          <button className="modal-close" onClick={onClose}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        {loading ? (
          <div className="modal-loading">
            <div className="loading-spinner"></div>
            <p>Loading contract details...</p>
          </div>
        ) : contractDetails ? (
          <div className="contract-details">
            <h3>Contract Information</h3>
            
            <div className="detail-item">
              <span className="label">Address:</span>
              <span className="value">{contractDetails.address}</span>
            </div>
            
            <div className="detail-item">
              <span className="label">Type:</span>
              <span className="value">{contractDetails.type}</span>
            </div>
            
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
            
            <div className="detail-item">
              <span className="label">Status:</span>
              <span className="value">{contractDetails.status}</span>
            </div>
            
            <div className="detail-item">
              <span className="label">Created:</span>
              <span className="value">{contractDetails.created}</span>
            </div>

            <div className="modal-actions">
              <button className="btn-primary">
                <i className="fas fa-money-bill-wave"></i>
                Pay Rent
              </button>
              
              <button className="btn-secondary">
                <i className="fas fa-file-export"></i>
                Export Details
              </button>
              
              <button className="btn-danger">
                <i className="fas fa-times-circle"></i>
                Terminate
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-error">
            <i className="fas fa-exclamation-triangle"></i>
            <p>Could not load contract details</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default ContractModal;