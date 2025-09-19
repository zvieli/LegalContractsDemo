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
              <img src="/arbitrust-logo.svg" alt="ArbiTrust Logo" style={{width:30,height:30}} />
              <span className="footer-brand">ArbiTrust</span>
            </div>
            <p className="footer-desc">Advanced platform for creating and managing legal smart contracts on the blockchain.</p>
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

          <div className="footer-section developer">
            <h4>Developer</h4>
            <div className="developer-info">
              <p className="developer-copy">Built with <span aria-hidden>❤️</span> by</p>
              <a
                href="https://www.linkedin.com/in/lior-zvieli-783107311/"
                target="_blank"
                rel="noopener noreferrer"
                className="developer-link"
                aria-label="Lior Zvieli on LinkedIn"
              >
                <span className="dev-icon" aria-hidden>
                  <i className="fab fa-linkedin"></i>
                </span>
                <span className="dev-name">Lior Zvieli</span>
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