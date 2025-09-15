import './About.css';
import '../../styles/notAllowed.css';
import { useEthers } from '../../contexts/EthersContext';

function About() {
  const { account } = useEthers();
  const platformAdmin = import.meta.env?.VITE_PLATFORM_ADMIN || null;
  const isAdmin = platformAdmin && account && account.toLowerCase() === platformAdmin.toLowerCase();
  return (
    <div className="about-page">
      <div className="page-header">
        <h1>About LegalContracts</h1>
        <p>Revolutionizing legal agreements with blockchain technology</p>
      </div>

      <div className="about-content">
        <div className="about-section">
          <h2>Our Mission</h2>
          <p>
            LegalContracts leverages blockchain technology to create transparent, 
            secure, and enforceable smart legal agreements. We're democratizing 
            access to legal services through decentralized technology.
          </p>
        </div>

        <div className="about-section">
          <h2>How It Works</h2>
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">
                <i className="fas fa-file-contract"></i>
              </div>
              <h3>Create</h3>
              <p>Generate legally-binding smart contracts in minutes</p>
            </div>
            
            <div className="feature-card">
              <div className="feature-icon">
                <i className="fas fa-shield-alt"></i>
              </div>
              <h3>Secure</h3>
              <p>Immutable records on the blockchain ensure security</p>
            </div>
            
            <div className="feature-card">
              <div className="feature-icon">
                <i className="fas fa-scale-balanced"></i>
              </div>
              <h3>Enforce</h3>
              <p>Automated execution and dispute resolution</p>
            </div>
          </div>
        </div>

        <div className="about-section">
          <h2>Technology Stack</h2>
          <div className="tech-stack">
            <div className="tech-item">
              <i className="fab fa-ethereum"></i>
              <span>Ethereum</span>
            </div>
            <div className="tech-item">
              <i className="fab fa-react"></i>
              <span>React</span>
            </div>
            <div className="tech-item">
              <i className="fas fa-cube"></i>
              <span>Solidity</span>
            </div>
            <div className="tech-item">
              <i className="fas fa-link"></i>
              <span>Hardhat</span>
            </div>
          </div>
        </div>

        <div className="about-section">
          <h2>Get Started</h2>
          <div className="cta-buttons">
            {!isAdmin ? (
              <>
                <button 
                  className="btn-primary"
                  onClick={() => window.location.href = '/create'}
                >
                  Create Your First Contract
                </button>
                <button 
                  className="btn-secondary"
                  onClick={() => window.location.href = '/dashboard'}
                >
                  View Dashboard
                </button>
              </>
            ) : (
              // Platform admin: hide creation CTA but keep access to dashboard
              <button 
                className="btn-secondary"
                onClick={() => window.location.href = '/dashboard'}
              >
                View Dashboard
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default About;