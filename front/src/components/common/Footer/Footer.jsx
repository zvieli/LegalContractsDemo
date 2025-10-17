import './Footer.css';
import { useEthers } from '../../../contexts/EthersContext';
import { useState, useEffect } from 'react';
import { ContractService } from '../../../services/contractService';

function Footer() {
  const currentYear = new Date().getFullYear();
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
        if (owner && account.toLowerCase() === owner.toLowerCase()) setIsAdmin(true);
        else setIsAdmin(false);
      } catch (e) { setIsAdmin(false); }
    }
    checkAdmin();
  }, [account, signer, chainId]);

  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-content">
          <div className="footer-section">
            <span>ArbiTrust</span>
            <p>Platform for creating and managing smart contracts on blockchain</p>
          </div>

          <div className="footer-section">
            <h4>Quick Links</h4>
            <ul>
              <li><a href="/">Home</a></li>
              {!isAdmin && <li><a href="/create">Create Contract</a></li>}
              <li><a href="/contracts">My Contracts</a></li>
            </ul>
          </div>

          <div className="footer-section">
            <h4>Developer</h4>
            <div className="developer-info">
              <p>Developed with ❤️ by</p>
              <a 
                href="https://www.linkedin.com/in/lior-zvieli-783107311/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="developer-link"
              >
                <i className="fab fa-linkedin"></i>
                Lior Zvieli
              </a>
            </div>
          </div>

          <div className="footer-section">
            <h4>Technology</h4>
            <div className="tech-stack">
              <div className="tech-item">
                <i className="fab fa-react"></i>
                <span>React 19</span>
              </div>
              <div className="tech-item">
                <i className="fab fa-ethereum"></i>
                <span>Ethereum</span>
              </div>
              <div className="tech-item">
                <i className="fas fa-code"></i>
                <span>Solidity</span>
              </div>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <p>&copy; {currentYear} ArbiTrust. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;