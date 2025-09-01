import { createContractInstance } from '../utils/contracts';
import ContractFactoryData from '../utils/contracts/ContractFactory.json';

export class ContractService {
  constructor(signer) {
    this.signer = signer;
  }

  /** 
   * מחזיר מופע של חוזה ה-Factory 
   */
  async getFactoryContract() {
    const factoryAddress = ContractFactoryData.address;
    if (!factoryAddress) {
      throw new Error('Factory contract not deployed on this network');
    }
    const abi = ContractFactoryData.abi;
    return createContractInstance(factoryAddress, abi, this.signer);
  }

  /**
   * יוצר חוזה שכירות דרך ה-Factory
   * params: { landlord, tenant, rentAmount, paymentToken, startDate, duration }
   */
  async createRentContract(params) {
    try {
      const factoryContract = await this.getFactoryContract();

      const tx = await factoryContract.createRentContract(
        params.landlord,
        params.tenant,
        params.rentAmount,
        params.paymentToken,
        params.startDate,
        params.duration
      );

      const receipt = await tx.wait();

      // חילוץ כתובת החוזה שנוצר מהאירוע ContractCreated
      const event = receipt.events?.find(
        (e) => e.event === 'ContractCreated'
      );

      if (event) {
        const contractAddress = event.args[1]; // הכתובת היא הארגומנט השני
        return { receipt, contractAddress };
      }

      return receipt;
    } catch (error) {
      console.error('Error creating rent contract:', error);
      throw error;
    }
  }

  /**
   * אם בעתיד תרצה להוסיף פונקציות נוספות שמבוססות על ABI:
   * getNDATemplateContract, getArbitratorContract וכו.
   * פשוט ייבא את הקובץ המתאים מ-../utils/contracts/
   */
}
