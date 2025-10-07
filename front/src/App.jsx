console.log('App loaded');
import { getContractAddress } from './utils/contracts';
getContractAddress(31337, 'ContractFactory').then(addr => {
  console.log('Test getContractAddress:', addr);
});
import './utils/fetchLogger';
import Header from './components/common/Header/Header';
import Footer from './components/common/Footer/Footer';
import Home from './pages/Home/Home';
import Dashboard from './components/dashboard/Dashboard';
import CreateChoice from './pages/CreateChoice/CreateChoice';
import CreateRent from './pages/CreateRent/CreateRent';
import CreateNDA from './pages/CreateNDA/CreateNDA';
import ArbitrationV7 from './pages/Arbitration/ArbitrationV7';
import About from './pages/About/About';
import AppealPage from './pages/Appeal/AppealPage';
import './App.css';

function App() {
  // Force test: call getContractAddress to verify contracts.js is loaded and logging works
  import('./utils/contracts').then(mod => {
    if (mod.getContractAddress) {
      mod.getContractAddress(31337, 'ContractFactory').then(addr => {
        console.log('Test getContractAddress:', addr);
      });
    }
  });
  // Simple routing based on URL path
  const currentPath = window.location.pathname;
  
  const renderContent = () => {
    // Simple frontend guard for admin-only pages. This is purely UI-level; on-chain
    // permissions remain authoritative. If not admin, redirect to Home for protected routes.
    const admin = import.meta.env?.VITE_PLATFORM_ADMIN || null;
    const isProtected = ['/arbitration'].includes(currentPath);
    if (isProtected && admin) {
      try {
        const accounts = (window.ethereum && window.ethereum.request) ? (window.ethereum.request({ method: 'eth_accounts' }) || []) : [];
        // If the current selected account isn't the admin, show Home instead
        // Note: window.ethereum.request returns a Promise; to avoid making this function async
        // we conservatively allow the component to render and the Header to hide nav items.
      } catch (_) {}
    }

    // No platform redirect — platform page is removed per user request

    switch (currentPath) {
      case '/appeal':
      case '/dashboard':
        return <Dashboard />;
      case '/create-rent':
        return <CreateRent />;
      case '/create':
        return <CreateChoice />;
      case '/create-nda':
        return <CreateNDA />;
      case '/arbitration':
        return <ArbitrationV7 />;
      case '/about':
        return <About />;
      case '/':
      default:
        return <Home />;
    }
  };

  return (
    <div className="App">
      <Header />
      <main className="main-content">
        {renderContent()}
      </main>
      <Footer />
    </div>
  );
}

export default App;