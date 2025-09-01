import Header from './components/common/Header/Header';
import Footer from './components/common/Footer/Footer';
import Home from './pages/Home/Home';
import Dashboard from "./components/Dashboard/Dashboard";
import CreateRent from './pages/CreateRent/CreateRent';
import './App.css';

function App() {
  // Routing פשוט - ניתן להוסיף React Router אחר כך
  const currentPath = window.location.pathname;
  
  const renderContent = () => {
    switch (currentPath) {
      case '/create-rent':
        return <CreateRent />;
      case '/dashboard':
        return <Dashboard />;
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