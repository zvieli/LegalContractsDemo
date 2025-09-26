import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import * as ethers from 'ethers';

const EthersContext = createContext();

export function EthersProvider({ children }) {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false); // הוספתי state למעקב אחר חיבור פעיל

  useEffect(() => {
    const initProvider = async () => {
      if (typeof window !== 'undefined' && window.ethereum) {
        try {
          const web3Provider = new ethers.BrowserProvider(window.ethereum);
          setProvider(web3Provider);

          const accounts = await window.ethereum.request({ 
            method: 'eth_accounts' 
          });
          
          if (accounts.length > 0) {
            // If the user is already connected in the wallet, set up signer/account without prompting
            try {
              const web3Signer = await web3Provider.getSigner(accounts[0]);
              setSigner(web3Signer);
              setAccount(accounts[0]);
              const net = await web3Provider.getNetwork();
              setChainId(Number(net.chainId));
              setIsConnected(true);
              if (import.meta.env && import.meta.env.DEV) {
                console.debug('EthersContext init: set signer/account/chainId', { account: accounts[0], chainId: Number(net.chainId) });
              }
            } catch (e) {
              // fallback to connectWallet if signer cannot be acquired
              await connectWallet();
            }
          }
        } catch (error) {
          console.error('Error initializing provider:', error);
        }
      }
      setLoading(false);
    };

    initProvider();

    // האזנה לשינויים בארנק
    if (typeof window !== 'undefined' && window.ethereum) {
      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);
    }

    return () => {
      if (typeof window !== 'undefined' && window.ethereum) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      }
    };
  }, []);

  const handleAccountsChanged = (accounts) => {
    if (accounts.length === 0) {
      // Wallet disconnected in MetaMask UI
      disconnectWallet();
    } else {
      const addr = accounts[0];
      // Update account and signer immediately to refresh UI across components
      setAccount(addr);
      setIsConnected(true);
      // Update signer using the currently cached provider or a fresh one
      (async () => {
        try {
          let usedProvider = provider;
          if (!usedProvider && typeof window !== 'undefined' && window.ethereum) {
            usedProvider = new ethers.BrowserProvider(window.ethereum);
            setProvider(usedProvider);
          }
          if (usedProvider) {
            const web3Signer = await usedProvider.getSigner(addr);
            setSigner(web3Signer);
            // update chainId too
            const net = await usedProvider.getNetwork();
            setChainId(Number(net.chainId));
          }
        } catch (err) {
          console.error('Error updating signer on accountsChanged:', err);
        }
      })();
    }
  };

  const handleChainChanged = (chainId) => {
    const parsed = parseInt(chainId, 16);
    setChainId(parsed);
    // Update provider/signer to new chain if possible, and let consumers react.
    (async () => {
      try {
        if (typeof window !== 'undefined' && window.ethereum) {
          const web3Provider = new ethers.BrowserProvider(window.ethereum);
          setProvider(web3Provider);
          const accounts = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => []);
          if (accounts && accounts[0]) {
            const web3Signer = await web3Provider.getSigner(accounts[0]);
            setSigner(web3Signer);
            setAccount(accounts[0]);
            setIsConnected(true);
          } else {
            setSigner(null);
            setAccount(null);
            setIsConnected(false);
          }
        }
      } catch (e) {
        console.error('Error handling chainChanged:', e);
        // fallback to hard reload if state is inconsistent
        window.location.reload();
      }
    })();
  };

  const connectWallet = async () => {
    // הגנה מפני קריאות כפולות
    if (isConnecting) {
      console.log('Wallet connection already in progress...');
      return;
    }

    if (typeof window === 'undefined' || !window.ethereum) {
      alert('Please install MetaMask!');
      return;
    }

    try {
      setIsConnecting(true); // מתחיל תהליך חיבור
      setLoading(true);
      
  const accounts = await window.ethereum.request({ 
        method: 'eth_requestAccounts' 
      });
      
      const web3Provider = new ethers.BrowserProvider(window.ethereum);
  const web3Signer = await web3Provider.getSigner(accounts[0]);
      const network = await web3Provider.getNetwork();

      setProvider(web3Provider);
      setSigner(web3Signer);
      setAccount(accounts[0]);
      setChainId(Number(network.chainId));
      setIsConnected(true);
      if (import.meta.env && import.meta.env.DEV) {
        console.debug('EthersContext connectWallet: signer/account/chainId set', { account: accounts[0], chainId: Number(network.chainId) });
      }
      
    } catch (error) {
      console.error('Error connecting wallet:', error);
      // הצגת הודעת שגיאה מתאימה יותר
      if (error.code === -32002) {
        alert('MetaMask is already processing your request. Please check your MetaMask window.');
      } else {
        alert('Error connecting wallet: ' + error.message);
      }
    } finally {
      setLoading(false);
      setIsConnecting(false); // מסיים תהליך חיבור
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
      try {
        const web3Signer = await provider.getSigner(addr || account || undefined);
        setSigner(web3Signer);
      } catch (error) {
        console.error('Error updating signer:', error);
      }
    }
  };

  // Expose a small `refresh` function so other components can trigger a re-sync of provider/signer
  const refresh = async () => {
    try {
      if (typeof window !== 'undefined' && window.ethereum) {
        const web3Provider = new ethers.BrowserProvider(window.ethereum);
        setProvider(web3Provider);
        const accounts = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => []);
        if (accounts && accounts[0]) {
          const web3Signer = await web3Provider.getSigner(accounts[0]);
          setSigner(web3Signer);
          setAccount(accounts[0]);
          const net = await web3Provider.getNetwork();
          setChainId(Number(net.chainId));
          setIsConnected(true);
        } else {
          setSigner(null);
          setAccount(null);
          setIsConnected(false);
        }
      }
    } catch (e) {
      console.error('Error refreshing provider/signer:', e);
    }
  };

  const value = {
    provider,
    signer,
    account,
    chainId,
    isConnected,
    loading,
    isConnecting, // הוספתי את זה ל-context
    connectWallet,
    disconnectWallet
    ,refresh
  };

  // Development helper: expose current ethers state to window for quick debugging
  if (typeof window !== 'undefined' && import.meta.env && import.meta.env.DEV) {
    try {
      window.__APP_ETHERS__ = {
        provider,
        signer,
        account,
        chainId,
        isConnected
      };
    } catch (_) {}
  }

  return (
    <EthersContext.Provider value={value}>
      {children}
    </EthersContext.Provider>
  );
}

export const useEthers = () => {
  const context = useContext(EthersContext);
  if (!context) {
    throw new Error('useEthers must be used within an EthersProvider');
  }
  return context;
};