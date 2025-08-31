import { useEthers } from '../../../contexts/EthersContext';
import './WalletConnector.css';

function WalletConnector() {
  const { 
    account, 
    isConnected, 
    loading, 
    isConnecting, // הוספתי את זה
    connectWallet, 
    disconnectWallet 
  } = useEthers();

  const formatAddress = (address) => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const handleConnect = async () => {
    if (isConnecting) {
      console.log('Connection already in progress...');
      return;
    }
    await connectWallet();
  };

  if (loading) {
    return (
      <div className="wallet-connector">
        <div className="wallet-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="wallet-connector">
      {isConnected && account ? (
        <div className="connected-wallet">
          <span className="wallet-address">
            <i className="fas fa-wallet"></i>
            {formatAddress(account)}
          </span>
          <button 
            onClick={disconnectWallet}
            className="disconnect-btn"
            aria-label="Disconnect wallet"
            disabled={isConnecting}
          >
            <i className="fas fa-sign-out-alt"></i>
          </button>
        </div>
      ) : (
        <button 
          onClick={handleConnect}
          className="connect-btn"
          aria-label="Connect wallet"
          disabled={isConnecting}
        >
          <i className="fas fa-plug"></i>
          {isConnecting ? 'Connecting...' : 'Connect Wallet'}
        </button>
      )}
    </div>
  );
}

export default WalletConnector;