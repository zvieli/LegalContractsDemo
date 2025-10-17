import './Home.css';
import MyContracts from '../../components/MyContracts/MyContracts';
import EvidenceSubmit from '../../components/EvidenceSubmit/EvidenceSubmit';
// import TimeCountdown from '../../components/TimeCountdown';
import AdminDashboard from '../AdminDashboard/AdminDashboard';

import { useEthers } from '../../contexts/EthersContext';
import { useState, useEffect } from 'react';
import { ContractService } from '../../services/contractService';

function Home() {
  const { account, signer, chainId } = useEthers();
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    async function checkAdmin() {
      try {
        if (!account || !signer || !chainId) { setIsAdmin(false); return; }
        const contractService = new ContractService(signer, chainId);
        const factory = await contractService.getFactoryContract();
        let owner = null;
        try { owner = await factory.factoryOwner(); } catch { owner = null; }
        setIsAdmin(owner && account.toLowerCase() === owner.toLowerCase());
      } catch { setIsAdmin(false); }
    }
    checkAdmin();
  }, [account, signer, chainId]);
  const features = [
    {
      icon: 'fas fa-robot',
      title: '🤖  AI Arbitration',
      description: 'Advanced AI-powered dispute resolution using Chainlink Functions + Ollama LLM'
    },
    {
      icon: 'fas fa-lock',
      title: 'Complete Security',
      description: 'Contracts secured on blockchain technology with advanced encryption'
    },
    {
      icon: 'fas fa-bolt',
      title: 'Fast Process',
      description: 'Create contracts within minutes without cumbersome paperwork'
    },
    {
      icon: 'fas fa-handshake',
      title: 'Full Transparency',
      description: 'All changes and actions are documented and transparent to all involved parties'
    },
    {
      icon: 'fas fa-scale-balanced',
      title: 'Automated Arbitration',
      description: 'Built-in dispute resolution system for conflict resolution'
    },
    {
      icon: 'fas fa-file-contract',
      title: 'Multiple Templates',
      description: 'Various contract templates for different use cases'
    },
    {
      icon: 'fas fa-shield-alt',
      title: 'Legal Compliance',
      description: 'Designed to meet legal requirements and standards'
    }
  ];

  return (
    <div className="home">
      {/* Hero Section */}
      <section className="hero" data-testid="home-hero-section">
        <div className="container">
          <div className="hero-content">
            <h1 data-testid="home-title">Welcome to ArbiTrust </h1>
            <p data-testid="home-description">Create and manage smart legal contracts on the blockchain with AI-powered arbitration - simple, secure, and transparent</p>
            <div className="cta-buttons">
              {!isAdmin && (
                <button className="btn btn-primary" data-testid="create-contract-btn" onClick={() => { window.location.href = '/create'; }}>
                  <i className="fas fa-plus"></i>
                  Create New Contract
                </button>
              )}
              <button className="btn btn-secondary" data-testid="browse-contracts-btn" onClick={() => { window.location.href = '/dashboard'; }}>
                <i className="fas fa-file-alt"></i>
                Browse Contracts
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features" data-testid="home-features-section">
        <div className="container">
          <div className="section-header">
            <h2 data-testid="features-title">Why Choose ArbiTrust?</h2>
            <p data-testid="features-description">The advanced system for managing smart contracts with all the benefits you need</p>
          </div>
          <div className="features-grid">
            {features.map((feature, index) => (
              <div key={index} className="feature-card" data-testid={`feature-card-${index}`}> 
                <div className="feature-icon">
                  <i className={feature.icon}></i>
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Dashboard Preview */}
        <section className="dashboard-preview" data-testid="home-dashboard-preview">
          <div className="container">
            <div className="preview-content">
              {isAdmin ? (
                <div style={{ width: '100%', margin: '0 auto', padding: '0', maxWidth: '100%' }}>
                  <AdminDashboard />
                </div>
              ) : (
                <>
                  <h2 data-testid="dashboard-title">Manage All Your Contracts in One Place</h2>
                  <p data-testid="dashboard-description">Preview of your dashboard with your recent contracts</p>
                  <div className="dashboard-card" data-testid="dashboard-card">
                    <MyContracts />
                    <div className="contract-placeholder" data-testid="contract-placeholder" style={{
                      marginTop: '32px',
                      background: 'linear-gradient(135deg, #f8fafc 0%, #e0e7ff 100%)',
                      borderRadius: '18px',
                      padding: '32px 28px',
                      textAlign: 'left',
                      boxShadow: '0 4px 24px rgba(80,80,160,0.10)',
                      maxWidth: '340px',
                      marginLeft: 'auto',
                      marginRight: 'auto',
                      border: '1.5px solid #e0e7ff',
                      position: 'relative'
                    }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        marginBottom: '18px'
                      }}>
                        <span style={{
                          display: 'inline-block',
                          background: '#6366f1',
                          color: 'white',
                          borderRadius: '50%',
                          width: '40px',
                          height: '40px',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '22px',
                          boxShadow: '0 2px 8px rgba(99,102,241,0.10)'
                        }}>
                          <i className="fas fa-file-contract"></i>
                        </span>
                        <h3 style={{ margin: 0, fontWeight: 700, fontSize: '1.25rem', color: '#312e81' }}>Contract Preview</h3>
                      </div>
                      <div style={{
                        fontSize: '16px',
                        color: '#374151',
                        lineHeight: 1.7,
                        marginBottom: '18px'
                      }}>
                        <div><span style={{ fontWeight: 600 }}>Type:</span> Rental Agreement</div>
                        <div><span style={{ fontWeight: 600 }}>Parties:</span> 0x123...abc & 0x456...def</div>
                        <div><span style={{ fontWeight: 600 }}>Amount:</span> 1.5 ETH / month</div>
                        <div><span style={{ fontWeight: 600 }}>Status:</span> <span style={{ color: '#10b981', fontWeight: 700 }}>Active</span></div>
                      </div>
                      <button className="btn btn-primary" style={{
                        marginTop: '8px',
                        width: '100%',
                        fontWeight: 600,
                        fontSize: '15px',
                        opacity: 0.7,
                        cursor: 'not-allowed'
                      }} disabled data-testid="view-details-btn">
                        View Details
                      </button>
                    </div>
                  </div>
                  <p data-testid="connect-wallet-hint">Connect your wallet to view and manage all your contracts</p>
                </>
              )}
            </div>
          </div>
        </section>
    </div>
  );
}

export default Home;