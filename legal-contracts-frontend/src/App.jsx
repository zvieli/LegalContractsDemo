import Header from './components/common/Header/Header';
import Footer from './components/common/Footer/Footer';
import Home from './pages/Home/Home';
import './App.css';

function App() {
  return (
    <div className="App">
      <Header />
      <main className="main-content">
        <Home />
      </main>
      <Footer />
    </div>
  );
}

export default App;