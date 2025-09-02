import { getContractABI, getContractAddress, createContractInstance } from '../utils/contracts';
import { ethers } from 'ethers';

export class ContractService {
  constructor(signer, chainId) {
    this.signer = signer;
    this.chainId = chainId;
  }

  async getFactoryContract() {
    const factoryAddress = await getContractAddress(this.chainId, 'factory');
    if (!factoryAddress) {
      throw new Error('Factory contract not deployed on this network');
    }
    return createContractInstance('ContractFactory', factoryAddress, this.signer);
  }

  async createRentContract(params) {
    try {
      const factoryContract = await this.getFactoryContract();
      
      const tx = await factoryContract.createRentContract(
        params.tenant,
        ethers.parseEther(params.rentAmount),
        params.priceFeed
      );

      const receipt = await tx.wait();
      
      // חילוץ כתובת החוזה מה-event
      let contractAddress = null;
      
      for (const log of receipt.logs) {
        try {
          const parsedLog = factoryContract.interface.parseLog(log);
          if (parsedLog && parsedLog.name === 'RentContractCreated') {
            contractAddress = parsedLog.args[0];
            break;
          }
        } catch (error) {
          continue;
        }
      }
      
      return { 
        receipt, 
        contractAddress,
        success: !!contractAddress
      };
      
    } catch (error) {
      console.error('Error creating rent contract:', error);
      throw error;
    }
  }

  async getRentContract(contractAddress) {
    try {
      return createContractInstance('TemplateRentContract', contractAddress, this.signer);
    } catch (error) {
      console.error('Error getting rent contract:', error);
      throw error;
    }
  }

  async getRentContractDetails(contractAddress) {
    try {
      const rentContract = await this.getRentContract(contractAddress);
      
      const [landlord, tenant, rentAmount, priceFeed, isActive] = await Promise.all([
        rentContract.landlord(),
        rentContract.tenant(),
        rentContract.rentAmount(),
        rentContract.priceFeed(),
        rentContract.isActive?.().catch(() => true) // optional chaining עם fallback
      ]);
      
      return {
        address: contractAddress,
        landlord,
        tenant,
        rentAmount: ethers.formatEther(rentAmount),
        priceFeed,
        isActive: !!isActive
      };
    } catch (error) {
      console.error('Error getting contract details:', error);
      throw error;
    }
  }

  async getUserContracts(userAddress) {
    try {
      const factoryContract = await this.getFactoryContract();
      const contracts = await factoryContract.getContractsByCreator(userAddress);
      return contracts;
    } catch (error) {
      console.error('Error fetching user contracts:', error);
      return [];
    }
  }

  async payRent(contractAddress, amount) {
    try {
      const rentContract = await this.getRentContract(contractAddress);
      const tx = await rentContract.payRent({ value: ethers.parseEther(amount) });
      const receipt = await tx.wait();
      return receipt;
    } catch (error) {
      console.error('Error paying rent:', error);
      throw error;
    }
  }

  // פונקציות נוספות ל-NDA agreements
  async createNDA(params) {
  try {
    const factoryContract = await this.getFactoryContract();
    
    // Convert values to proper format
    const expiryTimestamp = Math.floor(new Date(params.expiryDate).getTime() / 1000);
    const minDepositWei = ethers.parseEther(params.minDeposit);
    
    // Use zero address if no arbitrator provided
    const arbitratorAddress = params.arbitrator || ethers.ZeroAddress;
    
    // Hash the custom clauses if provided
    const clausesHash = params.customClauses 
      ? ethers.id(params.customClauses) 
      : ethers.ZeroHash;

    const tx = await factoryContract.createNDA(
      params.partyB,           // address
      expiryTimestamp,         // uint256 (timestamp)
      params.penaltyBps,       // uint16
      clausesHash,             // bytes32
      arbitratorAddress,       // address
      minDepositWei            // uint256 (in wei)
    );

    const receipt = await tx.wait();
    
    // Extract contract address from event
    let contractAddress = null;
    for (const log of receipt.logs) {
      try {
        const parsedLog = factoryContract.interface.parseLog(log);
        if (parsedLog && parsedLog.name === 'NDACreated') {
          contractAddress = parsedLog.args[0];
          break;
        }
      } catch (error) {
        continue;
      }
    }
    
    return { 
      receipt, 
      contractAddress,
      success: !!contractAddress
    };
    
  } catch (error) {
    console.error('Error creating NDA:', error);
    throw error;
  }
}

async getNDAContract(contractAddress) {
  try {
    return createContractInstance('NDATemplate', contractAddress, this.signer);
  } catch (error) {
    console.error('Error getting NDA contract:', error);
    throw error;
  }
}

async getNDAContractDetails(contractAddress) {
  try {
    const ndaContract = await this.getNDAContract(contractAddress);
    
    const [partyA, partyB, expiryDate, penaltyBps, minDeposit, isActive] = await Promise.all([
      ndaContract.partyA(),
      ndaContract.partyB(),
      ndaContract.expiryDate(),
      ndaContract.penaltyBps(),
      ndaContract.minDeposit(),
      ndaContract.isActive?.().catch(() => true)
    ]);
    
    return {
      address: contractAddress,
      partyA,
      partyB,
      expiryDate: new Date(Number(expiryDate) * 1000).toLocaleDateString(),
      penaltyBps: Number(penaltyBps),
      minDeposit: ethers.formatEther(minDeposit),
      isActive: !!isActive,
      type: 'NDA'
    };
  } catch (error) {
    console.error('Error getting NDA details:', error);
    throw error;
  }
}
}