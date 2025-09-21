import { useEffect } from 'react';
import * as ethers from 'ethers';
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
          'event RentPaid(address indexed tenant, uint256 amount, bool late, address token)'
        ],
        provider
      );

      // Normalize to (payer, amount) for existing UI callback handler
      const handler = (tenant, amount /*, late, token, event */) => callback(tenant, amount);
      contract.on('RentPaid', handler);

      return () => {
        contract.off('RentPaid', handler);
      };
    } catch (error) {
      console.error('Error setting up rent payment events:', error);
    }
  }, [provider, contractAddress, callback]);
};