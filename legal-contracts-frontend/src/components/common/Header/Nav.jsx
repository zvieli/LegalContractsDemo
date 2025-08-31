import './Nav.css';

function Nav({ isMobileMenuOpen }) {
  const navItems = [
    { label: 'Home', path: '/', icon: 'fas fa-home' },
    { label: 'Create Contract', path: '/create', icon: 'fas fa-plus' },
    { label: 'My Contracts', path: '/contracts', icon: 'fas fa-file-contract' },
    { label: 'Arbitration', path: '/arbitration', icon: 'fas fa-scale-balanced' },
    { label: 'About', path: '/about', icon: 'fas fa-info-circle' }
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