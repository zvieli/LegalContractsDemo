import { getContractABI, getContractAddress, createContractInstance } from '../utils/contracts';
import { ethers } from 'ethers';

export class ContractService {
  constructor(signer, chainId) {
    this.signer = signer;
    this.chainId = chainId;
  }

  // Prefer wallet provider, but on localhost fall back to a direct JSON-RPC provider if the wallet provider glitches
  async getCodeSafe(address) {
    const primary = this.signer.provider;
    try {
      return await primary.getCode(address);
    } catch (e) {
      const msg = String(e?.message || '');
      const isLocal = Number(this.chainId) === 31337 || Number(this.chainId) === 1337 || Number(this.chainId) === 5777;
      if (isLocal && (/invalid block tag/i.test(msg) || /Internal JSON-RPC error/i.test(msg))) {
        try {
          const rpc = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
          return await rpc.getCode(address);
        } catch (_) {
          // fall through
        }
      }
      throw e;
    }
  }

  async getFactoryContract() {
    const factoryAddress = await getContractAddress(this.chainId, 'factory');
    if (!factoryAddress) {
      throw new Error('Factory contract not deployed on this network');
    }
    const contract = createContractInstance('ContractFactory', factoryAddress, this.signer);
    // Lightweight sanity check to catch wrong/stale addresses on localhost
    try {
  const code = await this.getCodeSafe(factoryAddress);
      if (!code || code === '0x') {
        throw new Error(`No contract code at ${factoryAddress}. Is the node running and deployed?`);
      }
    } catch (_) {}
    return contract;
  }

  async createRentContract(params) {
    try {
      // ולידציה לכתובות כדי למנוע ניסיון לפתור ENS
      if (!params.tenant.trim().match(/^0x[a-fA-F0-9]{40}$/)) {
        throw new Error('Tenant address must be a valid Ethereum address');
      }
      if (!params.priceFeed.trim().match(/^0x[a-fA-F0-9]{40}$/)) {
        throw new Error('PriceFeed address must be a valid Ethereum address');
      }
      if (!params.paymentToken.trim().match(/^0x[a-fA-F0-9]{40}$/)) {
        throw new Error('PaymentToken address must be a valid Ethereum address');
      }

      const factoryContract = await this.getFactoryContract();

      const rentAmountWei = ethers.parseEther(params.rentAmount);

      // Preflight checks: ensure price feed exists on-chain (common localhost pitfall)
      try {
        const code = await this.getCodeSafe(params.priceFeed);
        if (!code || code === '0x') {
          const chain = Number(this.chainId);
          throw new Error(`Selected price feed has no contract code on chain ${chain}. If you're on localhost, choose "Mock Price Feed (Local)".`);
        }
      } catch (pfErr) {
        throw pfErr;
      }

      const tx = await factoryContract.createRentContract(
        params.tenant,
        rentAmountWei,
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
      // Normalize common provider error
      if (error?.code === 'CALL_EXCEPTION' && /no contract code|missing revert data/i.test(String(error?.message || ''))) {
        throw new Error('Factory call failed. Verify you are on the correct network and that the Price Feed address is deployed on this network.');
      }
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
      // Ensure the address is a contract before calling views
      const code = await this.signer.provider.getCode(contractAddress);
      if (!code || code === '0x') {
        throw new Error(`Address ${contractAddress} has no contract code`);
      }
      const rentContract = await this.getRentContract(contractAddress);
      
      const [landlord, tenant, rentAmount, priceFeed, isActive] = await Promise.all([
        rentContract.landlord(),
        rentContract.tenant(),
        rentContract.rentAmount(),
        rentContract.priceFeed(),
        // TemplateRentContract exposes `active()`
        rentContract.active().catch(() => true)
      ]);
      // Cancellation policy and state (best-effort, older ABIs may not have these)
      const [requireMutualCancel, noticePeriod, earlyTerminationFeeBps, cancelRequested, cancelInitiator, cancelEffectiveAt] = await Promise.all([
        rentContract.requireMutualCancel?.().catch(() => false) ?? false,
        rentContract.noticePeriod?.().catch(() => 0n) ?? 0n,
        rentContract.earlyTerminationFeeBps?.().catch(() => 0) ?? 0,
        rentContract.cancelRequested?.().catch(() => false) ?? false,
        rentContract.cancelInitiator?.().catch(() => '0x0000000000000000000000000000000000000000') ?? '0x0000000000000000000000000000000000000000',
        rentContract.cancelEffectiveAt?.().catch(() => 0n) ?? 0n,
      ]);
      // Approvals per party (mapping getter)
      const [landlordApproved, tenantApproved] = await Promise.all([
        rentContract.cancelApprovals?.(landlord).catch(() => false) ?? false,
        rentContract.cancelApprovals?.(tenant).catch(() => false) ?? false,
      ]);
      
      const formattedAmount = ethers.formatEther(rentAmount);
      // Derive a richer status for UI
      let status = 'Active';
      if (!isActive) {
        status = 'Cancelled';
      } else if (cancelRequested) {
        status = 'Pending'; // cancellation initiated but not finalized
      }
      return {
        address: contractAddress,
        landlord,
        tenant,
        rentAmount: formattedAmount,
        priceFeed,
        isActive: !!isActive,
        cancellation: {
          requireMutualCancel: !!requireMutualCancel,
          noticePeriod: Number(noticePeriod || 0n),
          earlyTerminationFeeBps: Number(earlyTerminationFeeBps || 0),
          cancelRequested: !!cancelRequested,
          cancelInitiator,
          cancelEffectiveAt: Number(cancelEffectiveAt || 0n),
          approvals: {
            landlord: !!landlordApproved,
            tenant: !!tenantApproved,
          }
        },
        // UI-friendly fields expected by Dashboard
        amount: formattedAmount,
        parties: [landlord, tenant],
        status,
        created: '—'
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
      // Filter out any addresses that aren't contracts (defensive against wrong factory/addressing)
      const checks = await Promise.all(
        contracts.map(async (addr) => {
          try {
            const code = await this.signer.provider.getCode(addr);
            return code && code !== '0x' ? addr : null;
          } catch (_) {
            return null;
          }
        })
      );
      return checks.filter(Boolean);
    } catch (error) {
      console.error('Error fetching user contracts:', error);
      return [];
    }
  }

  // Discover contracts where the user participates (landlord/tenant for rent, partyA/partyB for NDA)
  async getContractsByParticipant(userAddress, pageSize = 50, maxScan = 300) {
    try {
      const factory = await this.getFactoryContract();
      const total = Number(await factory.getAllContractsCount());
      const toScan = Math.min(total, maxScan);
      const pages = Math.ceil(toScan / pageSize) || 0;
      const discovered = new Set();

      for (let p = 0; p < pages; p++) {
        const start = p * pageSize;
        const count = Math.min(pageSize, toScan - start);
        if (count <= 0) break;
        const page = await factory.getAllContractsPaged(start, count);

        // For each address in the page, check participation
        // We keep it sequential to avoid node overload; small datasets stay fast.
        // If needed, this can be parallelized with Promise.allSettled.
        for (const addr of page) {
          try {
            const code = await this.signer.provider.getCode(addr);
            if (!code || code === '0x') continue;

            // Try as Rent first
            try {
              const rent = await this.getRentContract(addr);
              const [landlord, tenant] = await Promise.all([
                rent.landlord(),
                rent.tenant()
              ]);
              if (
                landlord?.toLowerCase() === userAddress.toLowerCase() ||
                tenant?.toLowerCase() === userAddress.toLowerCase()
              ) {
                discovered.add(addr);
                continue; // no need to test NDA if matched
              }
            } catch (_) {}

            // Try as NDA
            try {
              const nda = await this.getNDAContract(addr);
              const [partyA, partyB] = await Promise.all([
                nda.partyA(),
                nda.partyB()
              ]);
              if (
                partyA?.toLowerCase() === userAddress.toLowerCase() ||
                partyB?.toLowerCase() === userAddress.toLowerCase()
              ) {
                discovered.add(addr);
              }
            } catch (_) {}
          } catch (_) {
            // ignore address
          }
        }
      }

      return Array.from(discovered);
    } catch (err) {
      console.error('Error discovering participant contracts:', err);
      return [];
    }
  }

  async payRent(contractAddress, amount) {
    try {
      const rentContract = await this.getRentContract(contractAddress);
      // Preflight: ensure connected signer is the tenant
      try {
        const [chainTenant, current] = await Promise.all([
          rentContract.tenant(),
          this.signer.getAddress()
        ]);
        if (chainTenant?.toLowerCase?.() !== current?.toLowerCase?.()) {
          const msg = `Connected wallet is not the tenant. Expected ${chainTenant}, got ${current}`;
          const err = new Error(msg);
          err.reason = msg;
          throw err;
        }
      } catch (addrErr) {
        // If fetch failed for any reason, surface a helpful error instead of a revert on estimateGas
        if (addrErr?.reason) throw addrErr;
        throw new Error('Could not verify tenant address on-chain. Check network and contract address.');
      }
  // Pay in ETH according to TemplateRentContract.payRentInEth()
  const tx = await rentContract.payRentInEth({ value: ethers.parseEther(amount) });
      const receipt = await tx.wait();
      return receipt;
    } catch (error) {
      console.error('Error paying rent:', error);
      throw error;
    }
  }

  async approveToken(tokenAddress, spender, amount) {
    try {
      const tokenAbiName = 'MockERC20';
      const tokenContract = createContractInstance(tokenAbiName, tokenAddress, this.signer);
      // amount should be in token base units (e.g., wei for 18 decimals)
      const tx = await tokenContract.approve(spender, amount);
      const receipt = await tx.wait();
      return receipt;
    } catch (error) {
      console.error('Error approving token:', error);
      throw error;
    }
  }

  async payRentWithToken(contractAddress, tokenAddress, amount) {
    try {
      const rentContract = await this.getRentContract(contractAddress);
      // Preflight: ensure connected signer is the tenant
      try {
        const [chainTenant, current] = await Promise.all([
          rentContract.tenant(),
          this.signer.getAddress()
        ]);
        if (chainTenant?.toLowerCase?.() !== current?.toLowerCase?.()) {
          const msg = `Connected wallet is not the tenant. Expected ${chainTenant}, got ${current}`;
          const err = new Error(msg);
          err.reason = msg;
          throw err;
        }
      } catch (addrErr) {
        if (addrErr?.reason) throw addrErr;
        throw new Error('Could not verify tenant address on-chain. Check network and contract address.');
      }
      // amount expected in token base units (BigInt or string)
      const tx = await rentContract.payRentWithToken(tokenAddress, amount);
      const receipt = await tx.wait();
      return receipt;
    } catch (error) {
      console.error('Error paying rent with token:', error);
      throw error;
    }
  }

  // ============ Cancellation Policy and Flow ============
  async setCancellationPolicy(contractAddress, { noticePeriodSec, feeBps, requireMutual }) {
    try {
      const rentContract = await this.getRentContract(contractAddress);
      const tx = await rentContract.setCancellationPolicy(
        Number(noticePeriodSec || 0),
        Number(feeBps || 0),
        !!requireMutual
      );
      return await tx.wait();
    } catch (error) {
      console.error('Error setting cancellation policy:', error);
      throw error;
    }
  }

  async initiateCancellation(contractAddress) {
    try {
      const rentContract = await this.getRentContract(contractAddress);
      const tx = await rentContract.initiateCancellation();
      return await tx.wait();
    } catch (error) {
      console.error('Error initiating cancellation:', error);
      throw error;
    }
  }

  async approveCancellation(contractAddress) {
    try {
      const rentContract = await this.getRentContract(contractAddress);
      const tx = await rentContract.approveCancellation();
      return await tx.wait();
    } catch (error) {
      console.error('Error approving cancellation:', error);
      throw error;
    }
  }

  async finalizeCancellation(contractAddress, { feeValueEth } = {}) {
    try {
      const rentContract = await this.getRentContract(contractAddress);
      const overrides = {};
      if (feeValueEth && Number(feeValueEth) > 0) {
        overrides.value = ethers.parseEther(String(feeValueEth));
      }
      const tx = await rentContract.finalizeCancellation(overrides);
      return await tx.wait();
    } catch (error) {
      console.error('Error finalizing cancellation:', error);
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
    // Ensure the address is a contract before calling views
    const code = await this.signer.provider.getCode(contractAddress);
    if (!code || code === '0x') {
      throw new Error(`Address ${contractAddress} has no contract code`);
    }
    const ndaContract = await this.getNDAContract(contractAddress);
    
    const [partyA, partyB, expiryDate, penaltyBps, minDeposit, isActive] = await Promise.all([
      ndaContract.partyA(),
      ndaContract.partyB(),
      ndaContract.expiryDate(),
      ndaContract.penaltyBps(),
      ndaContract.minDeposit(),
      // NDATemplate exposes `active` public var (getter)
      ndaContract.active().catch(() => true)
    ]);
    
    const formattedMin = ethers.formatEther(minDeposit);
    return {
      address: contractAddress,
      partyA,
      partyB,
      expiryDate: new Date(Number(expiryDate) * 1000).toLocaleDateString(),
      penaltyBps: Number(penaltyBps),
      minDeposit: formattedMin,
      isActive: !!isActive,
      type: 'NDA',
      // UI-friendly fields expected by Dashboard
      amount: formattedMin,
      parties: [partyA, partyB],
      status: !!isActive ? 'Active' : 'Inactive',
      created: new Date(Number(expiryDate) * 1000).toLocaleDateString()
    };
  } catch (error) {
    console.error('Error getting NDA details:', error);
    throw error;
  }
}
}