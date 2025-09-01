import './Nav.css';

function Nav({ isMobileMenuOpen }) {
  const navItems = [
    { label: 'Home', path: '/', icon: 'fas fa-home' },
    { label: 'Dashboard', path: '/dashboard', icon: 'fas fa-th-large' },
    { label: 'Create Rental', path: '/create-rent', icon: 'fas fa-plus' },
    { label: 'My Contracts', path: '/contracts', icon: 'fas fa-file-contract' },
    { label: 'Arbitration', path: '/arbitration', icon: 'fas fa-scale-balanced' }
  ];

  return (
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
  );
}

export default Nav;