import './Home.css';

function Home() {
  const features = [
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
      <section className="hero">
        <div className="container">
          <div className="hero-content">
            <h1>Welcome to LegalContracts</h1>
            <p>Create and manage smart legal contracts on the blockchain - simple, secure, and transparent</p>
            <div className="cta-buttons">
              <button className="btn btn-primary">
                <i className="fas fa-plus"></i>
                Create New Contract
              </button>
              <button className="btn btn-secondary">
                <i className="fas fa-file-alt"></i>
                Browse Contracts
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features">
        <div className="container">
          <div className="section-header">
            <h2>Why Choose LegalContracts?</h2>
            <p>The advanced system for managing smart contracts with all the benefits you need</p>
          </div>
          <div className="features-grid">
            {features.map((feature, index) => (
              <div key={index} className="feature-card">
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
      <section className="dashboard-preview">
        <div className="container">
          <div className="preview-content">
            <h2>Manage All Your Contracts in One Place</h2>
            <p>Preview of your dashboard with your recent contracts</p>
            
            <div className="dashboard-card">
              <h3>My Contracts</h3>
              <div className="contract-list">
                <div className="contract-item">
                  <div className="contract-info">
                    <h4>Apartment Rental Contract - Tel Aviv</h4>
                    <p>Created: 2024-01-15 • Amount: 5,000 USDC/month</p>
                  </div>
                  <span className="contract-status active">Active</span>
                </div>
                <div className="contract-item">
                  <div className="contract-info">
                    <h4>NDA Agreement with Startup Company</h4>
                    <p>Created: 2024-01-10 • Parties: 2</p>
                  </div>
                  <span className="contract-status pending">Pending Signature</span>
                </div>
                <div className="contract-item">
                  <div className="contract-info">
                    <h4>Employment Contract with Full-stack Developer</h4>
                    <p>Created: 2024-01-05 • Salary: 8,000 USDC/month</p>
                  </div>
                  <span className="contract-status completed">Completed</span>
                </div>
              </div>
            </div>
            
            <p>Connect your wallet to view and manage all your contracts</p>
          </div>
        </div>
      </section>
    </div>
  );
}

export default Home;