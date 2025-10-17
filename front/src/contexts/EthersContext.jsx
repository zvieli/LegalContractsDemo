import React, { createContext, useContext, useEffect, useState } from 'react';
import * as ethers from 'ethers';
import { IN_E2E } from '../utils/env';

const EthersContext = createContext();

export function EthersProvider({ children }) {
  // --- Provider / Signer / Account ---
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);

  // --- חוזים אחרונים ---
  const [latestContractAddress, setLatestContractAddress] = useState(null);
  const [contracts, setContracts] = useState([]);

  const addContract = (address) => {
    setContracts(prev => prev.includes(address) ? prev : [...prev, address]);
  };

  // --- Initialize provider ---
  useEffect(() => {
    const initProvider = async () => {
      if (IN_E2E) {
        console.log('🧪 E2E Mode detected - forcing wallet connection');
        setLoading(false);
        return;
      }

      if (typeof window !== 'undefined' && window.ethereum) {
        try {
          const web3Provider = new ethers.BrowserProvider(window.ethereum);
          let net = await web3Provider.getNetwork().catch(() => ({ chainId: null }));

          // Force local provider for localhost / hardhat
          const isLocalEnv = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
          if (isLocalEnv || Number(net.chainId) === 31337) {
            // Always use local provider for all calls
            const localProvider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
            setProvider(localProvider);
            net = { chainId: 31337 };


            // Use localProvider for signer as well
            const accounts = await window.ethereum.request({ method: 'eth_accounts' });
            if (accounts.length > 0) {
              const web3Signer = await localProvider.getSigner(accounts[0]);
              setSigner(web3Signer);
              setAccount(accounts[0]);
              setChainId(31337);
              setIsConnected(true);
            }
          } else {
            setProvider(web3Provider);
            const accounts = await window.ethereum.request({ method: 'eth_accounts' });
            if (accounts.length > 0) {
              const web3Signer = await web3Provider.getSigner(accounts[0]);
              setSigner(web3Signer);
              setAccount(accounts[0]);
              setChainId(Number(net.chainId));
              setIsConnected(true);
            }
          }
        } catch (error) {
          console.error('Error initializing provider:', error);
        }
      }

      setLoading(false);
    };

    initProvider();

    if (typeof window !== 'undefined' && window.ethereum?.on) {
      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);
    }

    return () => {
      if (typeof window !== 'undefined' && window.ethereum?.removeListener) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      }
    };
  }, []);

  // --- Wallet / chain handlers ---
  const handleAccountsChanged = async () => {
    await refresh();
  };

  const handleChainChanged = (chainIdHex) => {
    const parsed = parseInt(chainIdHex, 16);
    setChainId(parsed);
    refresh();
  };

  const connectWallet = async () => {
    if (isConnecting) return;
    if (!window.ethereum) throw new Error('MetaMask extension not found');

    try {
      setIsConnecting(true);
      setLoading(true);

      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const web3Provider = new ethers.BrowserProvider(window.ethereum);
      const web3Signer = await web3Provider.getSigner(accounts[0]);
      const network = await web3Provider.getNetwork();

      setProvider(web3Provider);
      setSigner(web3Signer);
      setAccount(accounts[0]);
      setChainId(Number(network.chainId));
      setIsConnected(true);
    } finally {
      setLoading(false);
      setIsConnecting(false);
    }
  };

  const disconnectWallet = () => {
    setSigner(null);
    setAccount(null);
    setIsConnected(false);
    setChainId(null);
  };

  const updateSigner = async (addr) => {
    if (provider) {
      const web3Signer = await provider.getSigner(addr || account);
      setSigner(web3Signer);
    }
  };

  const refresh = async () => {
    if (!window.ethereum) return;
    const web3Provider = new ethers.BrowserProvider(window.ethereum);
    setProvider(web3Provider);
    const accounts = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => []);
    if (accounts[0]) {
      setSigner(await web3Provider.getSigner(accounts[0]));
      setAccount(accounts[0]);
      setChainId((await web3Provider.getNetwork()).chainId);
      setIsConnected(true);
    } else {
      setSigner(null);
      setAccount(null);
      setIsConnected(false);
    }
  };

  // --- Expose context value ---
  const value = {
    provider,
    signer,
    account,
    chainId,
    isConnected,
    loading,
    isConnecting,
    connectWallet,
    disconnectWallet,
    refresh,
    latestContractAddress,
    setLatestContractAddress,
    contracts,
    addContract
  };

  // Debug helper
  if (typeof window !== 'undefined' && import.meta.env?.DEV) {
    window.__APP_ETHERS__ = value;
  }

  return <EthersContext.Provider value={value}>{children}</EthersContext.Provider>;
}

export const useEthers = () => {
  const context = useContext(EthersContext);
  if (!context) throw new Error('useEthers must be used within an EthersProvider');
  return context;
};
