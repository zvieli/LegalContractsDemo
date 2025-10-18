import { useState, useEffect } from 'react';
import { useEthers } from '../../../contexts/EthersContext';
import { ContractService } from '../../../services/contractService';
import './Header.css';
import WalletConnector from './WalletConnector';
function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { account, signer, chainId, provider } = useEthers();
  const [isAdmin, setIsAdmin] = useState(false);
  const [showArbitration, setShowArbitration] = useState(false);
  const [showPlatform, setShowPlatform] = useState(false);

  useEffect(() => {
    async function checkAdmin() {
      try {
        if (!account || !signer || !chainId) {
          setIsAdmin(false);
          setShowArbitration(false);
          setShowPlatform(false);
          return;
        }
  const contractService = new ContractService(provider, signer, chainId);
        const factory = await contractService.getFactoryContract();
        let owner = null;
        try { owner = await factory.factoryOwner(); } catch { owner = null; }
        if (owner && account.toLowerCase() === owner.toLowerCase()) {
          setIsAdmin(true);
          setShowArbitration(true);
          setShowPlatform(true);
        } else {
          setIsAdmin(false);
          setShowArbitration(false);
          setShowPlatform(false);
        }
      } catch {
        setIsAdmin(false);
        setShowArbitration(false);
        setShowPlatform(false);
      }
    }
    checkAdmin();
  }, [account, signer, chainId]);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const navItems = [
    { label: 'Home', path: '/', icon: 'fas fa-home' },
    !isAdmin ? { label: 'Create Contract', path: '/create', icon: 'fas fa-plus' } : null,
    { label: 'My Contracts', path: '/dashboard', icon: 'fas fa-file-contract' },
    { label: 'About', path: '/about', icon: 'fas fa-info-circle' }
  ].filter(Boolean);

  // Render Admin link only for the on-chain admin account
  if (isAdmin) {
    navItems.push({ label: 'Admin', path: '/admin', icon: 'fas fa-cogs' });
  }

  return (
    <header className="header">
      <div className="container">
        <div className="header-content">
          <div className="logo">
            <div className="logo-text">
              <h1>ArbiTrust</h1>
              <span>On-chain Agreements</span>
            </div>
          </div>
          
          <nav className={`nav ${isMobileMenuOpen ? 'nav-open' : ''}`}>
            <ul className="nav-list">
              {navItems.map((item) => (
                <li key={item.path} className="nav-item">
                  <a href={item.path} className="nav-link">
                    <i className={item.icon}></i>
                    <span>{item.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          
          <div className="header-actions">
            <WalletConnector />
            <button 
              className="mobile-menu-toggle"
              onClick={toggleMobileMenu}
              aria-label="Toggle mobile menu"
            >
              <span></span>
              <span></span>
              <span></span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;