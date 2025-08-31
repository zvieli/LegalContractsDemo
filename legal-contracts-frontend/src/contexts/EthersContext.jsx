import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { ethers } from 'ethers';

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
            await connectWallet();
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
      disconnectWallet();
    } else {
      setAccount(accounts[0]);
      updateSigner();
    }
  };

  const handleChainChanged = (chainId) => {
    setChainId(parseInt(chainId, 16));
    window.location.reload();
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
      const web3Signer = await web3Provider.getSigner();
      const network = await web3Provider.getNetwork();

      setProvider(web3Provider);
      setSigner(web3Signer);
      setAccount(accounts[0]);
      setChainId(Number(network.chainId));
      setIsConnected(true);
      
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

  const updateSigner = async () => {
    if (provider) {
      try {
        const web3Signer = await provider.getSigner();
        setSigner(web3Signer);
      } catch (error) {
        console.error('Error updating signer:', error);
      }
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
  };

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