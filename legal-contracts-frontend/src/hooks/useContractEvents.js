import { useEffect } from 'react';
import { ethers } from 'ethers';
import { useEthers } from '../contexts/EthersContext';

export const useContractEvents = (contractAddress, abi, eventName, callback) => {
  const { provider } = useEthers();

  useEffect(() => {
    if (!provider || !contractAddress || !abi) return;

    try {
      const contract = new ethers.Contract(contractAddress, abi, provider);
      const filter = contract.filters[eventName]();
      
      contract.on(filter, (...args) => {
        callback(...args);
      });

      return () => {
        contract.off(filter, callback);
      };
    } catch (error) {
      console.error('Error setting up event listener:', error);
    }
  }, [provider, contractAddress, abi, eventName, callback]);
};

export const useRentPaymentEvents = (contractAddress, callback) => {
  const { provider } = useEthers();

  useEffect(() => {
    if (!provider || !contractAddress) return;

    try {
      const contract = new ethers.Contract(
        contractAddress,
        [
          'event RentPaid(address indexed payer, uint256 amount, uint256 timestamp)'
        ],
        provider
      );

      contract.on('RentPaid', callback);

      return () => {
        contract.off('RentPaid', callback);
      };
    } catch (error) {
      console.error('Error setting up rent payment events:', error);
    }
  }, [provider, contractAddress, callback]);
};