import React, { useState, useEffect } from 'react';
import { ContractService } from '../../../services/contractService';
import { useEthers } from '../../../contexts/EthersContext';

function useAdminRole(account, signer, chainId) {
  const [role, setRole] = useState('guest');
  useEffect(() => {
    async function checkRole() {
      if (!account) { setRole('guest'); return; }
      try {
        const contractService = new ContractService(signer ? signer.provider : null, signer, chainId);
        const factory = await contractService.getFactoryContract();
        let owner = null;
        try { owner = await factory.factoryOwner(); } catch { owner = null; }
        if (owner && account.toLowerCase() === owner.toLowerCase()) setRole('admin');
        else if (account.toLowerCase() === '0xsystemaddress') setRole('system');
        else setRole('user');
      } catch { setRole('user'); }
    }
    checkRole();
  }, [account, signer, chainId]);
  return role;
}

function formatAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';
}


export default function WalletConnector({ onWallet }) {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const { account, signer, chainId, provider, connectWallet: connectWalletCtx, disconnectWallet: disconnectWalletCtx } = useEthers();
  const role = useAdminRole(account, signer, chainId);

  async function connectWallet() {
    setLoading(true);
    setError(null);
    setIsConnecting(true);
    try {
      // Delegate to global EthersContext connect so provider/signer/account are set globally
      if (typeof connectWalletCtx === 'function') {
        await connectWalletCtx();
        try {
          const accounts = window.ethereum ? await window.ethereum.request({ method: 'eth_accounts' }) : [];
          if (onWallet) onWallet(accounts && accounts[0]);
        } catch (_) { if (onWallet) onWallet(null); }
      } else {
        setError('Wallet connect not available');
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
      setIsConnecting(false);
    }
  }

  function disconnectWallet() {
    try {
      if (typeof disconnectWalletCtx === 'function') disconnectWalletCtx();
    } catch (e) { /* ignore */ }
    if (onWallet) onWallet(null);
  }


  if (loading) {
    return (
      <div className="wallet-connector">
        <div className="wallet-loading">טוען...</div>
      </div>
    );
  }

  return (
    <div className="wallet-connector" style={{ marginBottom: 18 }}>
      {account ? (
        <div className="connected-wallet" style={{ display: 'flex', alignItems: 'center' }}>
          <span className="wallet-address" style={{ fontWeight: 'bold', color: '#2a7' }}>
            <i className="fas fa-wallet" style={{ marginRight: 6 }}></i>
            {formatAddress(account)}
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
