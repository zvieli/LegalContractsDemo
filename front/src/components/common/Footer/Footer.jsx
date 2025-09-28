import './Footer.css';
import { useEthers } from '../../../contexts/EthersContext';

function Footer() {
  const currentYear = new Date().getFullYear();
  const { account } = useEthers();
  const platformAdmin = import.meta.env?.VITE_PLATFORM_ADMIN || null;
  const isAdmin = platformAdmin && account && account.toLowerCase() === platformAdmin.toLowerCase();

  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-content">
          <div className="footer-section">
            <div className="footer-logo">
              <svg width="30" height="30" viewBox="0 0 512 512" fill="currentColor">
                <path d="M256 36L430 134v150c0 104-78 198-174 206-96-8-174-102-174-206V134l174-98Z" fill="url(#lcGradient)" opacity="0.12"/>
                <path d="M256 36L430 134v150c0 104-78 198-174 206-96-8-174-102-174-206V134l174-98Z" stroke="currentColor" strokeWidth="18" strokeLinejoin="round" fill="none"/>
                <path d="M256 124v172M164 184h184" stroke="currentColor" strokeWidth="16" strokeLinecap="round" fill="none"/>
                <circle cx="256" cy="112" r="6" fill="currentColor"/>
              </svg>
              <span>ArbiTrust</span>
            </div>
            <p>Advanced platform for creating and managing smart contracts on blockchain</p>
          </div>

          <div className="footer-section">
            <h4>Quick Links</h4>
            <ul>
              <li><a href="/">Home</a></li>
              {!isAdmin && <li><a href="/create">Create Contract</a></li>}
              <li><a href="/contracts">My Contracts</a></li>
              <li><a href="/arbitration">Arbitration</a></li>
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