import React, { createContext, useContext, useEffect, useState } from 'react';
import { BrowserProvider, JsonRpcProvider } from 'ethers';
import { IN_E2E } from '../utils/env';

const EthersContext = createContext();

export function EthersProvider({ children }) {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [contracts, setContracts] = useState({});
  const [userContracts, setUserContracts] = useState([]);
  const [latestContractAddress, setLatestContractAddress] = useState(null);

  // Initialize provider + account
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      if (typeof window === 'undefined' || !window.ethereum) {
        console.warn('[EthersContext] No window.ethereum found');
        setLoading(false);
        return;
      }

      try {
        const web3Provider = new BrowserProvider(window.ethereum);
        let net = await web3Provider.getNetwork().catch(() => ({ chainId: null }));
        const isLocalEnv = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);

        const accounts = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => []);

        if (isLocalEnv || Number(net.chainId) === 31337) {
          const localProvider = new JsonRpcProvider('http://127.0.0.1:8545');
          setProvider(localProvider);
          if (accounts[0]) setAccount(accounts[0]);
          setChainId(31337);
        } else {
          setProvider(web3Provider);
          if (accounts[0]) setAccount(accounts[0]);
          setChainId(Number(net.chainId));
        }

        if (accounts[0]) setIsConnected(true);

        // Listen for account/network changes
        if (window.ethereum.on) {
          window.ethereum.on('accountsChanged', (accs) => {
            setAccount(accs[0] || null);
            setIsConnected(!!accs[0]);
          });
          window.ethereum.on('chainChanged', async () => {
            const newNet = await provider.getNetwork();
            setChainId(Number(newNet.chainId));
          });
        }

      } catch (err) {
        console.error('[EthersContext] Failed to init provider:', err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  // Request user to connect their wallet (used by UI when not connected)
  const connectWallet = async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      alert('No Ethereum provider found');
      return;
    }
    try {
      setIsConnecting(true);
      setLoading(true);
      const web3Provider = new BrowserProvider(window.ethereum);
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }).catch(() => []);
      const acc = accounts && accounts[0];
      if (acc) {
        // Detect local host environment (same check as init)
        const isLocalEnv = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
        // Determine network from injected provider to decide whether to swap providers
        const net = await web3Provider.getNetwork().catch(() => ({ chainId: null }));
        const isLocalChain = Number(net.chainId) === 31337 || Number(net.chainId) === 1337 || Number(net.chainId) === 5777;
        if (isLocalEnv || isLocalChain) {
          // Keep using a direct localhost JsonRpcProvider for reads (avoid replacing with MetaMask's RPC)
          const localProvider = new JsonRpcProvider('http://127.0.0.1:8545');
          setProvider(localProvider);
          setAccount(acc);
          const newSigner = localProvider.getSigner(acc);
          setSigner(newSigner);
          setChainId(31337);
          setIsConnected(true);
        } else {
          // Non-local: use the injected BrowserProvider and its signer
          setProvider(web3Provider);
          setAccount(acc);
          const newSigner = web3Provider.getSigner(acc);
          setSigner(newSigner);
          setChainId(Number(net.chainId));
          setIsConnected(true);
        }
      }
    } catch (err) {
      console.error('[EthersContext] connectWallet failed:', err);
      alert('Failed to connect wallet: ' + (err?.message || String(err)));
    } finally {
      setIsConnecting(false);
      setLoading(false);
    }
  };

  // Lightweight refresh helper to re-sync account/provider state
  const refresh = async () => {
    try {
      if (typeof window === 'undefined' || !window.ethereum) return;
      const web3Provider = new BrowserProvider(window.ethereum);
      const accounts = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => []);
      const acc = accounts && accounts[0];
      if (acc) {
        // Preserve local JsonRpcProvider when running on localhost to keep read calls local
        const isLocalEnv = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
        const net = await web3Provider.getNetwork().catch(() => ({ chainId: null }));
        const isLocalChain = Number(net.chainId) === 31337 || Number(net.chainId) === 1337 || Number(net.chainId) === 5777;
        if (isLocalEnv || isLocalChain) {
          const localProvider = new JsonRpcProvider('http://127.0.0.1:8545');
          setProvider(localProvider);
          setAccount(acc);
          setSigner(localProvider.getSigner(acc));
          setChainId(31337);
          setIsConnected(true);
        } else {
          setProvider(web3Provider);
          setAccount(acc);
          setSigner(web3Provider.getSigner(acc));
          setChainId(Number(net.chainId));
          setIsConnected(true);
        }
      } else {
        setSigner(null);
        setAccount(null);
        setIsConnected(false);
      }
    } catch (err) {
      console.error('[EthersContext] refresh failed:', err);
    }
  };

  const addContract = (addr) => {
    if (!addr) return;
    setUserContracts(prev => {
      if (prev.includes(addr)) return prev;
      return [...prev, addr];
    });
    setLatestContractAddress(addr);
  };

  // Create signer after provider & account
  useEffect(() => {
    if (!provider || !account) {
      setSigner(null);
      return;
    }
    try {
      const newSigner = provider.getSigner(account);
      setSigner(newSigner);
      console.log('[EthersContext] Signer created:', account);
    } catch (err) {
      console.error('[EthersContext] Failed to create signer:', err);
      setSigner(null);
    }
  }, [provider, account]);

  const disconnectWallet = () => {
    setSigner(null);
    setAccount(null);
    setIsConnected(false);
    setChainId(null);
  };

  const value = {
    provider,
    signer,
    account,
    chainId,
    isConnected,
    loading,
    isConnecting,
    connectWallet,
    refresh,
    disconnectWallet,
    setLoading,
    contracts,
    userContracts,
    addContract,
    latestContractAddress,
    setLatestContractAddress,
  };

  return <EthersContext.Provider value={value}>{children}</EthersContext.Provider>;
}

export const useEthers = () => {
  const context = useContext(EthersContext);
  if (!context) throw new Error('useEthers must be used within an EthersProvider');
  return context;
};
