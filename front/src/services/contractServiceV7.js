import * as ethers from 'ethers';
import arbitrationAbiJson from '../utils/contracts/ArbitrationService.json';

export class ContractServiceV7 {
  constructor(signer, chainId = 31337) {
  this.signer = signer;
  this.chainId = chainId;
  this.localhostRpcUrl = 'http://127.0.0.1:8545';
  }

  async makeRpcCall(method, params = []) {
    const payload = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    };
    const hardcodedUrl = 'http://127.0.0.1:8545';
    try {
      const response = await window.fetch(hardcodedUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText} from ${response.url}`);
      }
      const result = await response.json();
      if (result.error) {
        throw new Error(`RPC Error: ${result.error.message}`);
      }
      return result.result;
    } catch (error) {
      throw error;
    }
  }

  async getLogs(filter) {
    return await this.makeRpcCall('eth_getLogs', [filter]);
  }

  async getArbitrationRequestsByUser(userAddress) {
    const arbitrationContractAddr = '0x2d493cde51adc74d4494b3dc146759cf32957a23';
    const contractName = 'ArbitrationService';
    const contractAbi = window.__ABIS__[contractName]?.abi || window.__ABIS__[contractName];
    if (!contractAbi) {
      return [];
    }
    const requests = [];
    const eventSignature = 'ResolutionApplied(address,uint256,bool,uint256,address,address)';
    const eventTopic = ethers.id(eventSignature);
    try {
      const currentBlock = await this.makeRpcCall('eth_blockNumber');
      const currentBlockNum = parseInt(currentBlock, 16);
      const fromBlock = Math.max(currentBlockNum - 50, 0);
      const filter = {
        address: arbitrationContractAddr.toLowerCase(),
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: 'latest',
        topics: [eventTopic]
      };
      const logs = await this.getLogs(filter);
      for (let i = 0; i < logs.length; i++) {
        try {
          const log = logs[i];
          const iface = new ethers.Interface(contractAbi);
          const parsedLog = iface.parseLog({
            topics: log.topics,
            data: log.data
          });
          if (parsedLog && parsedLog.name === 'ResolutionApplied') {
            const args = parsedLog.args;
            const request = {
              id: `${args.target}-${args.caseId}`,
              target: args.target,
              caseId: args.caseId?.toString(),
              approve: args.approve,
              appliedAmount: ethers.formatEther(args.appliedAmount || '0'),
              beneficiary: args.beneficiary,
              caller: args.caller,
              status: 'resolved',
              blockNumber: parseInt(log.blockNumber, 16),
              transactionHash: log.transactionHash
            };
            requests.push(request);
          }
        } catch (parseError) {
          // Ignore parse errors
        }
      }
      return requests.sort((a, b) => (b.blockNumber || 0) - (a.blockNumber || 0));
    } catch (error) {
      return [];
    }
  }
  /**
   * Get arbitration contract using minimal ethers (only for ABI)
   */
  async getArbitrationContract() {
    const arbitrationContractAddr = '0x2d493cde51adc74d4494b3dc146759cf32957a23';
    const contractName = 'ArbitrationService';
    let contractAbi = (typeof window !== 'undefined' && window.__ABIS__)
      ? window.__ABIS__[contractName]?.abi || window.__ABIS__[contractName]
      : arbitrationAbiJson.abi || arbitrationAbiJson;
    if (!contractAbi) {
      throw new Error(`ABI not found for contract: ${contractName}`);
    }
    const localhostProvider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    const contract = new ethers.Contract(
      arbitrationContractAddr,
      contractAbi,
      localhostProvider
    );
    return contract;
  }

  /**
   * Get status of an arbitration request
   */
  async getRequestStatus(target, caseId) {
    const requests = await this.getArbitrationRequestsByUser(target);
    const request = requests.find(r => r.target === target && r.caseId === caseId.toString());
    return request ? request.status : 'not_found';
  }

  /**
   * Get contract text for a specific address and case ID
   */
  async _getContractText(target, caseId) {
    const code = await this.makeRpcCall('eth_getCode', [target, 'latest']);
    if (code === '0x') {
      return 'No contract found at this address';
    }
    return `Contract at ${target} (Case ${caseId}): Bytecode length ${code.length} bytes`;
  }
}