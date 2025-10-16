import React, { useState, useEffect } from 'react';

function detectRole(address) {
  if (!address) return 'guest';
  const adminAddress = (import.meta.env?.VITE_PLATFORM_ADMIN || '').toLowerCase();
  if (address.toLowerCase() === adminAddress) return 'admin';
  if (address.toLowerCase() === '0xsystemaddress') return 'system';
  return 'user';
}

function formatAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';
}

export default function WalletConnector({ onWallet }) {
  const [address, setAddress] = useState(null);
  const [role, setRole] = useState('guest');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  async function connectWallet() {
    setLoading(true);
    setError(null);
    setIsConnecting(true);
    try {
      if (window.ethereum) {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const addr = accounts[0];
        setAddress(addr);
        setRole(detectRole(addr));
        if (onWallet) onWallet(addr);
      } else {
        setError('לא נמצא ספק Ethereum (כמו MetaMask)');
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
      setIsConnecting(false);
    }
  }

  function disconnectWallet() {
    setAddress(null);
    setRole('guest');
    if (onWallet) onWallet(null);
  }

  // אם כבר יש ארנק מחובר
  useEffect(() => {
    if (window.ethereum && window.ethereum.selectedAddress) {
      const addr = window.ethereum.selectedAddress;
      setAddress(addr);
      setRole(detectRole(addr));
      if (onWallet) onWallet(addr);
    }
  }, [onWallet]);

  if (loading) {
    return (
      <div className="wallet-connector">
        <div className="wallet-loading">טוען...</div>
      </div>
    );
  }

  return (
    <div className="wallet-connector" style={{ marginBottom: 18 }}>
      {address ? (
        <div className="connected-wallet" style={{ display: 'flex', alignItems: 'center' }}>
          <span className="wallet-address" style={{ fontWeight: 'bold', color: '#2a7' }}>
            <i className="fas fa-wallet" style={{ marginRight: 6 }}></i>
            {formatAddress(address)}
          </span>
          <span className="wallet-role" style={{ marginLeft: 12, color: '#888' }}>
            Role: <strong>{role}</strong>
          </span>
          <button
            onClick={disconnectWallet}
            className="disconnect-btn"
            aria-label="Disconnect wallet"
            disabled={isConnecting}
            style={{ marginLeft: 12, background: '#fff', color: '#333', border: '1px solid #b3c6ff', borderRadius: 6, padding: '6px 16px', fontWeight: 'bold', cursor: 'pointer' }}
          >
            <i className="fas fa-sign-out-alt"></i> Disconnect
          </button>
        </div>
      ) : (
        <button
          onClick={connectWallet}
          className="connect-btn"
          aria-label="Connect wallet"
          disabled={isConnecting}
          style={{
            background: '#2a7',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '10px 24px',
            fontSize: 16,
            fontWeight: 'bold',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}
        >
          <i className="fas fa-plug"></i>
          {isConnecting ? 'Connecting...' : 'Connect Wallet'}
        </button>
      )}
      {error && <div style={{ color: 'crimson', marginTop: 8 }}>{error}</div>}
    </div>
  );
}
