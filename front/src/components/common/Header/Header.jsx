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
    showArbitration ? { label: 'Arbitration', path: '/arbitration', icon: 'fas fa-scale-balanced' } : null,
    showPlatform ? { label: 'Platform', path: '/platform', icon: 'fas fa-shield-alt' } : null,
    { label: 'About', path: '/about', icon: 'fas fa-info-circle' }
  ].filter(Boolean);

  return (
    <header className="header">
      <div className="container">
        <div className="header-content">
          <div className="logo">
            <svg width="40" height="40" viewBox="0 0 512 512" fill="currentColor" className="logo-icon">
              <defs>
                <linearGradient id="lcGradient" x1="64" y1="64" x2="448" y2="448" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#7C3AED"/>
                  <stop offset="1" stopColor="#06B6D4"/>
                </linearGradient>
              </defs>
              <path d="M256 36L430 134v150c0 104-78 198-174 206-96-8-174-102-174-206V134l174-98Z" fill="url(#lcGradient)" opacity="0.12"/>
              <path d="M256 36L430 134v150c0 104-78 198-174 206-96-8-174-102-174-206V134l174-98Z" stroke="currentColor" strokeWidth="18" strokeLinejoin="round" fill="none"/>
              <path d="M256 124v172M164 184h184" stroke="currentColor" strokeWidth="16" strokeLinecap="round" fill="none"/>
              <path d="M188 184c0 0-28 44-28 62a44 44 0 0 0 88 0c0-18-28-62-28-62" stroke="currentColor" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <path d="M324 184c0 0-28 44-28 62a44 44 0 0 0 88 0c0-18-28-62-28-62" stroke="currentColor" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <path d="M232 228a28 28 0 0 1 28-28h16a28 28 0 0 1 0 56h-16" stroke="currentColor" strokeWidth="12" strokeLinecap="round" fill="none"/>
              <path d="M280 252a28 28 0 0 1-28 28h-16a28 28 0 0 1 0-56h16" stroke="currentColor" strokeWidth="12" strokeLinecap="round" fill="none"/>
              <path d="M164 344h184" stroke="currentColor" strokeWidth="12" strokeLinecap="round"/>
              <circle cx="256" cy="112" r="6" fill="currentColor"/>
            </svg>
            <div className="logo-text">
              <h1>LegalContracts</h1>
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