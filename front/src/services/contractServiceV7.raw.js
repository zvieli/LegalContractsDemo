import * as ethers from 'ethers';

/**
 * Raw Localhost Contract Service - NO ETHERS PROVIDER
 * 
 * This version uses raw JSON-RPC calls to avoid ANY ethers provider issues
 */
export class ContractServiceV7 {
  constructor(signer, chainId = 31337) {
    this.signer = signer;
    this.chainId = chainId;
    this.localhostRpcUrl = 'http://127.0.0.1:8545';
  }

  /**
   * Make raw JSON-RPC call to localhost
   */
  async makeRpcCall(method, params = []) {
    const payload = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    };

    console.log('DEBUG: Making RPC call to localhost:', { method, params });

    try {
      const response = await fetch(this.localhostRpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.error) {
        throw new Error(`RPC Error: ${result.error.message}`);
      }

      return result.result;
    } catch (error) {
      console.error('RPC call failed:', error);
      throw error;
    }
  }

  /**
   * Get logs using raw RPC call
   */
  async getLogs(filter) {
    return await this.makeRpcCall('eth_getLogs', [filter]);
  }

  /**
   * Get all arbitration requests for a specific user
   */
  async getArbitrationRequestsByUser(userAddress) {
    try {
      console.log('DEBUG: Starting getArbitrationRequestsByUser for:', userAddress);
      
      // Use hardcoded addresses
      const arbitrationContractAddr = '0x2d493cde51adc74d4494b3dc146759cf32957a23';
      const contractName = 'ArbitrationService';
      
      const contractAbi = window.__ABIS__[contractName]?.abi || window.__ABIS__[contractName];
      
      console.log('DEBUG: contractName:', contractName);
      console.log('DEBUG: arbitrationContractAddr:', arbitrationContractAddr);
      console.log('DEBUG: using raw RPC to:', this.localhostRpcUrl);
      
      if (!contractAbi) {
        console.log(`ABI not found for contract: ${contractName}`);
        return [];
      }

      const requests = [];
      
      // Get ResolutionApplied event signature
      // ResolutionApplied(address indexed target, uint256 indexed caseId, bool approve, uint256 appliedAmount, address beneficiary, address caller)
      const eventSignature = 'ResolutionApplied(address,uint256,bool,uint256,address,address)';
      const eventTopic = ethers.id(eventSignature);
      
      console.log('Looking for ResolutionApplied events with topic:', eventTopic);
      
      try {
        // Make raw RPC call for logs
        const filter = {
          address: arbitrationContractAddr.toLowerCase(),
          fromBlock: '0x0',
          toBlock: 'latest',
          topics: [eventTopic]
        };
        
        const logs = await this.getLogs(filter);
        console.log('Found raw logs:', logs.length);
        
        // Parse logs manually
        for (const log of logs) {
          try {
            // Create contract interface for parsing
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
            console.error('Error parsing log:', parseError);
          }
        }
      } catch (error) {
        console.error('Error getting logs from localhost:', error);
        return [];
      }
      
      console.log('DEBUG: Total requests found:', requests.length);
      return requests.sort((a, b) => (b.blockNumber || 0) - (a.blockNumber || 0));
      
    } catch (error) {
      console.error('Error fetching arbitration requests:', error);
      return [];
    }
  }

  /**
   * Get arbitration contract using minimal ethers (only for ABI)
   */
  async getArbitrationContract() {
    try {
      const arbitrationContractAddr = '0x2d493cde51adc74d4494b3dc146759cf32957a23';
      const contractName = 'ArbitrationService';
      
      const contractAbi = window.__ABIS__[contractName]?.abi || window.__ABIS__[contractName];
      
      if (!contractAbi) {
        throw new Error(`ABI not found for contract: ${contractName}`);
      }

      // Create a minimal localhost provider ONLY for contract instance (not for queries)
      const localhostProvider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
      
      const contract = new ethers.Contract(
        arbitrationContractAddr,
        contractAbi,
        localhostProvider
      );
      
      console.log('Contract created successfully with localhost provider');
      return contract;
      
    } catch (error) {
      console.error('Error creating contract:', error);
      throw error;
    }
  }

  /**
   * Get status of an arbitration request
   */
  async getRequestStatus(target, caseId) {
    try {
      console.log('Getting request status for:', { target, caseId });
      
      // For now, return a simple status based on whether we find events
      const requests = await this.getArbitrationRequestsByUser(target);
      const request = requests.find(r => r.target === target && r.caseId === caseId.toString());
      
      return request ? request.status : 'not_found';
    } catch (error) {
      console.error('Error getting request status:', error);
      return 'error';
    }
  }

  /**
   * Get contract text for a specific address and case ID
   */
  async _getContractText(target, caseId) {
    try {
      console.log('Getting contract text for:', { target, caseId });
      
      // Make raw RPC call to get contract code or storage
      // This is a simplified version - in reality you might need to query specific storage slots
      const code = await this.makeRpcCall('eth_getCode', [target, 'latest']);
      
      if (code === '0x') {
        return 'No contract found at this address';
      }
      
      return `Contract at ${target} (Case ${caseId}): Bytecode length ${code.length} bytes`;
    } catch (error) {
      console.error('Error getting contract text:', error);
      return 'Error retrieving contract text';
    }
  }
}