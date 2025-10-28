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
  const [contracts, _setContracts] = useState({});
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
        // Use the injected BrowserProvider as the canonical provider so the
        // signer derived from it matches the MetaMask-selected account. Do
        // not replace the provider with a local JsonRpcProvider here — the
        // ContractService._providerForRead() will provide a direct
        // JsonRpcProvider for read-only fallbacks when necessary.
        const web3Provider = new BrowserProvider(window.ethereum);
        const net = await web3Provider.getNetwork().catch(() => ({ chainId: null }));
        const accounts = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => []);
        setProvider(web3Provider);
        if (accounts[0]) setAccount(accounts[0]);
        if (net && net.chainId) setChainId(Number(net.chainId));

        if (accounts[0]) setIsConnected(true);

        // Always await getSigner so signer is not a Promise
        if (accounts[0]) {
          const signerObj = await web3Provider.getSigner(accounts[0]);
          setSigner(signerObj);
        } else {
          setSigner(null);
        }

        // Listen for account/network changes
        if (window.ethereum.on) {
          window.ethereum.on('accountsChanged', async (accs) => {
            setAccount(accs[0] || null);
            setIsConnected(!!accs[0]);
            if (accs[0]) {
              const signerObj = await web3Provider.getSigner(accs[0]);
              setSigner(signerObj);
            } else {
              setSigner(null);
            }
          });
          // Use the locally-created web3Provider here instead of the stateful
          // `provider` variable so this effect does not depend on external state
          // (avoids exhaustive-deps warnings while preserving behavior).
          window.ethereum.on('chainChanged', async () => {
            try {
              // Recreate a fresh provider and attempt to re-sync signer/account state.
              const freshProvider = new BrowserProvider(window.ethereum);
              if (freshProvider && typeof freshProvider.getNetwork === 'function') {
                const newNet = await freshProvider.getNetwork().catch(() => ({ chainId: null }));
                setChainId(Number(newNet.chainId));
              } else {
                setChainId(null);
              }

              // Re-sync accounts and signer to avoid transient undefined signer/provider
              const accs = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => []);
              if (accs && accs[0]) {
                setAccount(accs[0]);
                setIsConnected(true);
                try {
                  const signerObj = await freshProvider.getSigner(accs[0]).catch(() => null);
                  setSigner(signerObj);
                } catch (_){ void _; setSigner(null); }
              } else {
                setAccount(null);
                setIsConnected(false);
                setSigner(null);
              }

              // Replace provider in state to ensure callers use the fresh provider instance.
              setProvider(freshProvider);
            } catch (err) {
              // Swallow network-change race errors to avoid uncaught exceptions in the app.
              console.warn('[EthersContext] chainChanged handler failed:', err && err.message ? err.message : err);
              setChainId(null);
              setSigner(null);
            }
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

    setIsConnecting(true);
    setLoading(true);

    try {
      const web3Provider = new BrowserProvider(window.ethereum);
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }).catch(() => []);
      const acc = accounts && accounts[0];
      if (!acc) {
        // User dismissed the connection request or no accounts available
        setIsConnecting(false);
        setLoading(false);
        return;
      }

      // Always use the injected provider and its signer so the signer
      // reflects the MetaMask-selected account. For read fallbacks on
      // localhost, ContractService will use a direct JsonRpcProvider.
      const net = await web3Provider.getNetwork().catch(() => ({ chainId: null }));
  setProvider(web3Provider);
  setAccount(acc);
  // Always await getSigner so signer is not a Promise
  const signerObj = await web3Provider.getSigner(acc);
  setSigner(signerObj);
  if (net && net.chainId) setChainId(Number(net.chainId));
  setIsConnected(true);
    } catch (err) {
      console.error('[EthersContext] connectWallet failed:', err);
      try { alert('Failed to connect wallet: ' + (err?.message || String(err))); } catch (_) { void _;}
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
        const net = await web3Provider.getNetwork().catch(() => ({ chainId: null }));
  setProvider(web3Provider);
  setAccount(acc);
  // Always await getSigner so signer is not a Promise
  const signerObj = await web3Provider.getSigner(acc);
  setSigner(signerObj);
  if (net && net.chainId) setChainId(Number(net.chainId));
  setIsConnected(true);
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
    (async () => {
      try {
        if (!provider || !account) {
          setSigner(null);
          return;
        }
        // Always await getSigner so signer is not a Promise
        const newSigner = await provider.getSigner(account);
        setSigner(newSigner);
        console.log('[EthersContext] Signer created:', account);
      } catch (err) {
        console.error('[EthersContext] Failed to create signer:', err);
        setSigner(null);
      }
    })();
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
