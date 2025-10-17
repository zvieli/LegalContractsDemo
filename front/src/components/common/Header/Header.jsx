import { useState, useEffect } from 'react';
import { useEthers } from '../../../contexts/EthersContext';
import './Header.css';
import WalletConnector from './WalletConnector';
function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { account } = useEthers();
  const [showArbitration, setShowArbitration] = useState(false);
  const [showPlatform, setShowPlatform] = useState(false);

  useEffect(() => {
    // Config-driven: only show Arbitration and Platform to the configured platform admin
    const admin = import.meta.env?.VITE_PLATFORM_ADMIN || null;
    try {
      if (!admin) {
        // No admin configured: hide admin pages by default
        setShowArbitration(false);
        setShowPlatform(false);
        return;
      }
      if (!account) {
        // if not connected, allow nav presence so admin can land and connect (show links)
        setShowArbitration(true);
        setShowPlatform(true);
        return;
      }
      const isAdmin = account.toLowerCase() === admin.toLowerCase();
      setShowArbitration(isAdmin);
      setShowPlatform(isAdmin);
    } catch (_) {
      setShowArbitration(false);
      setShowPlatform(false);
    }
  }, [account]);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  // If platform admin is connected, hide 'Create Contract' for fairness
  const admin = import.meta.env?.VITE_PLATFORM_ADMIN || null;
  const isAdminAccount = admin && account && account.toLowerCase() === admin.toLowerCase();

  const navItems = [
    { label: 'Home', path: '/', icon: 'fas fa-home' },
    !isAdminAccount ? { label: 'Create Contract', path: '/create', icon: 'fas fa-plus' } : null,
    { label: 'My Contracts', path: '/dashboard', icon: 'fas fa-file-contract' },
    { label: 'About', path: '/about', icon: 'fas fa-info-circle' }
  ].filter(Boolean);

  // Render Admin link only for the configured admin account
  if (isAdminAccount) {
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