import Header from './components/common/Header/Header';
import Footer from './components/common/Footer/Footer';
import Home from './pages/Home/Home';
import Dashboard from './components/Dashboard/Dashboard';
import CreateRent from './pages/CreateRent/CreateRent';
import CreateNDA from './pages/CreateNDA/CreateNDA';
import Arbitration from './pages/Arbitration/Arbitration';
import About from './pages/About/About';
import './App.css';

function App() {
  // Simple routing based on URL path
  const currentPath = window.location.pathname;
  
  const renderContent = () => {
    switch (currentPath) {
      case '/dashboard':
        return <Dashboard />;
      case '/create-rent':
        return <CreateRent />;
      case '/create-nda':
        return <CreateNDA />;
      case '/arbitration':
        return <Arbitration />;
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