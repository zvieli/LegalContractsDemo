import { useState, useEffect } from 'react';
import { useEthers } from '../../contexts/EthersContext';
import { ContractService } from '../../services/contractService';
import './CreateChoice.css';

function CreateChoice() {
  const [selected, setSelected] = useState(null);
  const { account, signer, chainId, provider } = useEthers();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function checkAdmin() {
      if (!provider || !signer || !chainId || !account) {
        setIsAdmin(false);
        return;
      }
      try {
  const contractService = new ContractService(provider, signer, chainId);
        const factory = await contractService.getFactoryContract();
        let owner = null;
        try { owner = await factory.factoryOwner(); } catch { owner = null; }
        setIsAdmin(owner && account.toLowerCase() === owner.toLowerCase());
      } catch { setIsAdmin(false); }
    }
    checkAdmin();
  }, [provider, signer, chainId, account]);
  if (loading || !provider || !signer || !chainId || !account) {
    return <div style={{textAlign:'center',marginTop:'48px'}}><div className="loading-spinner" style={{marginBottom:'16px'}}></div>Connecting to wallet...</div>;
  }

  const contractTypes = [
    {
      id: 'rent',
      title: 'Rental Contract',
      description: 'Create a smart rental agreement with automated payments and dispute resolution',
      icon: 'fas fa-home',
      path: '/create-rent',
      color: '#6366F1'
    },
    {
      id: 'nda',
      title: 'NDA Agreement',
      description: 'Create a Non-Disclosure Agreement to protect confidential information',
      icon: 'fas fa-file-signature',
      path: '/create-nda',
      color: '#10B981'
    }
  ];

  const handleSelect = (type) => {
    setSelected(type.id);
    setTimeout(() => {
      window.location.href = type.path; // Changes URL and reloads the page
    }, 300);
  };

  const handleBack = () => {
  window.location.href = '/'; // Back to home page with refresh
  };

  return (
    <div className="create-choice-page">
      <div className="container">
        <div className="page-header">
          <h1>Create New Contract</h1>
          <p>Select the type of contract you want to create</p>
        </div>

        <div className="contract-types">
          {isAdmin ? (
            <div className="not-allowed">
              <i className="fas fa-ban"></i>
              <h3>Creation Disabled</h3>
              <p>The connected account is registered as the platform admin and cannot create user contracts from this UI.</p>
            </div>
          ) : (
            contractTypes.map((type) => (
              <div 
                key={type.id}
                className={`contract-card ${selected === type.id ? 'selected' : ''}`}
                onClick={() => handleSelect(type)}
                style={{ '--accent-color': type.color }}
              >
                <div className="card-icon">
                  <i className={type.icon}></i>
                </div>
                <h3>{type.title}</h3>
                <p>{type.description}</p>
                <div className="select-button">
                  <span>Select</span>
                  <i className="fas fa-arrow-right"></i>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="back-section">
          <button 
            className="back-button" 
            onClick={handleBack}
          >
            <i className="fas fa-arrow-left"></i>
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}

export default CreateChoice;
