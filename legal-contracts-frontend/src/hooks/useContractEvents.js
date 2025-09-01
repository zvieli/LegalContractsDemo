// src/hooks/useContractEvents.js
import { useEffect } from 'react';
import { useEthers } from '../contexts/EthersContext';

export const useContractEvents = (contractAddress, abi, eventName, callback) => {
  const { provider } = useEthers();

  useEffect(() => {
    if (!provider || !contractAddress) return;

    const contract = new ethers.Contract(contractAddress, abi, provider);
    const filter = contract.filters[eventName]();
    
    contract.on(filter, callback);

    return () => contract.off(filter, callback);
  }, [provider, contractAddress, eventName]);
};