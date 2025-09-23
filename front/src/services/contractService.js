import * as ethers from 'ethers';
import { contract } from './contractInstance.js';
import { computePayloadDigest } from '../utils/cidDigest';

// Evidence workflow: the frontend computes and submits a `bytes32` keccak256
// digest of an off-chain evidence payload. The payload itself (encrypted
// or plaintext depending on your privacy needs) must be stored off-chain
// by the client or another secure store. Decryption and any admin-private-key
// operations MUST occur in a trusted admin environment (see `tools/admin`).
// Do NOT bundle admin private keys or server-only decryption logic into the
// frontend bundle.

// Client-side helper: compute and submit a bytes32 digest for an evidence payload.
// Note: the frontend only computes the digest and calls the contract. Any
// encryption or placement of the payload in off-chain storage (and subsequent
// admin-side decryption) must be implemented outside the frontend in a trusted
// admin/service environment (see `tools/admin`).
export async function reportRentDispute(id, evidencePayloadString = '', overrides = {}) {
  try {
  const payloadStr = evidencePayloadString ? String(evidencePayloadString) : '';
  const digest = computePayloadDigest(payloadStr);
    await contract.reportDispute(id, digest, overrides);
  } catch (e) {
    throw e;
  }
}
import { getContractAddress, createContractInstanceAsync } from '../utils/contracts';

export class ContractService {
  constructor(signer, chainId) {
    this.signer = signer;
    this.chainId = chainId;
  }

  // Prefer wallet provider, but on localhost fall back to a direct JSON-RPC provider if the wallet provider glitches
  async getCodeSafe(address) {
    const primary = this.signer.provider;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await primary.getCode(address);
      } catch (e) {
        const msg = String(e?.message || '');
        // If the provider is in the middle of a network switch, ethers may throw a transient 'network changed' error.
        // Retry a couple times with exponential backoff to avoid spamming the node with eth_call that can show as
        // 'Contract call: <unrecognized-selector>' in the node logs during transitions.
        if (/network changed/i.test(msg) && attempt < maxAttempts) {
          const backoff = 100 * Math.pow(2, attempt - 1);
          console.warn(`Transient network change detected while reading code for ${address}, retrying in ${backoff}ms (${attempt}/${maxAttempts})`);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }

        // MetaMask wraps certain errors and exposes a nested cause for a 'circuit breaker' condition.
        const isBrokenCircuit = Boolean(e?.data?.cause?.isBrokenCircuitError) || /circuit breaker/i.test(msg);
        const isLocal = Number(this.chainId) === 31337 || Number(this.chainId) === 1337 || Number(this.chainId) === 5777;
        // If we're on localhost and the injected provider is failing (invalid block tag, internal error, or the circuit-breaker),
        // fall back to a direct JSON-RPC provider on 127.0.0.1:8545 which is commonly used for Hardhat/localhost.
        if (isLocal && (/invalid block tag/i.test(msg) || /Internal JSON-RPC error/i.test(msg) || isBrokenCircuit)) {
          console.warn('Provider.getCode failed on injected provider; falling back to http://127.0.0.1:8545', { error: e });
          try {
            const rpc = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
            return await rpc.getCode(address);
          } catch (rpcErr) {
            // If fallback also fails, surface the original error for clearer diagnosis.
            console.warn('Fallback JSON-RPC getCode failed', { rpcErr });
          }
        }
        throw e;
      }
    }
  }

  async getFactoryContract() {
    const factoryAddress = await getContractAddress(this.chainId, 'factory');
    if (!factoryAddress) {
      throw new Error('Factory contract not deployed on this network');
    }
  const contract = await createContractInstanceAsync('ContractFactory', factoryAddress, this.signer);
    // Lightweight sanity check to catch wrong/stale addresses on localhost
    const code = await this.getCodeSafe(factoryAddress);
    if (!code || code === '0x') {
      throw new Error(`No contract code at ${factoryAddress}. Is the node running and deployed and is your wallet connected to the same network?`);
    }
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
      // ERC20 support removed: do not validate or accept `paymentToken` parameter

      const factoryContract = await this.getFactoryContract();

      // Ensure the connected signer/provider is on the expected chain. A
      // mismatched network is the most common cause of an ambiguous
      // 'Internal JSON-RPC error' when calling eth_sendTransaction from the
      // browser (MetaMask will try to sign/send to an address that doesn't
      // exist on the current network). We must not swallow this error.
      let net;
      try {
        net = await this.signer.provider.getNetwork();
      } catch (err) {
        console.warn('Could not determine provider network:', err);
        throw new Error('Could not determine connected wallet network. Ensure your wallet is connected and try again.');
      }
      if (Number(net.chainId) !== Number(this.chainId)) {
        throw new Error(`Connected wallet network mismatch: provider chainId=${net.chainId} but expected=${this.chainId}. Please switch your wallet to the correct network.`);
      }

      // Quick balance preflight: prevent send attempts when the signer has no ETH
      // which can lead to confusing provider errors. This is a best-effort check.
      try {
        const bal = await this.signer.getBalance();
        // require at least a tiny balance (0.0001 ETH) to cover gas on most nets
        const min = ethers.parseEther('0.0001');
        if (bal < min) {
          throw new Error('Connected wallet has insufficient ETH balance to create a contract. Fund the wallet and try again.');
        }
      } catch (balErr) {
        // If getBalance fails, don't block the user, but present a helpful warning
        console.warn('Could not determine signer balance:', balErr);
      }

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

      // Extra diagnostics to help debug provider errors (network/account/address mismatches)
      try {
        const signerAddr = await this.signer.getAddress().catch(() => null);
        const factoryAddr = factoryContract.target || factoryContract.address || null;
        console.debug('Preparing factory.createRentContract', { factoryAddr, signerAddr, expectedChainId: this.chainId });

        // If an injected wallet is present, surface its selected account and chainId
        try {
          if (typeof window !== 'undefined' && window.ethereum && window.ethereum.request) {
            const ethAccounts = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => []);
            const ethChainId = await window.ethereum.request({ method: 'eth_chainId' }).catch(() => null);
            console.debug('Injected wallet state before send', { ethAccounts, ethChainId });
            const selected = (ethAccounts && ethAccounts[0]) || null;
            if (selected && signerAddr && selected.toLowerCase() !== signerAddr.toLowerCase()) {
              throw new Error(`Wallet selected account (${selected}) does not match the connected signer (${signerAddr}). Please select the correct account in your wallet and try again.`);
            }
            // Also check the injected chainId vs the expected chain
            if (ethChainId) {
              try {
                const hexExpected = `0x${Number(this.chainId).toString(16)}`;
                if (ethChainId !== hexExpected) {
                  throw new Error(`Wallet network mismatch: wallet chainId=${ethChainId} but expected=${hexExpected}. Please switch your wallet to the correct network and try again.`);
                }
              } catch (cErr) {
                // bubble up the chain mismatch as a friendly error
                throw cErr;
              }
            }
          }
        } catch (walletStateErr) {
          // Re-throw with helpful context so UI surfaces actionable advice
          console.error('Wallet preflight check failed:', walletStateErr);
          throw walletStateErr;
        }
      } catch (_) {}

      let tx;
      try {
        // Compute dueDate from provided startDate (unix seconds) + duration (days)
        let dueDate = 0;
        try {
          const start = Number(params.startDate || 0);
          const days = Number(params.duration || 0);
          if (start > 0 && days > 0) {
            dueDate = Math.floor(start + days * 24 * 3600);
          }
        } catch (e) {
          dueDate = 0;
        }

        const propertyId = Number(params.propertyId || 0);
        console.debug('Sending createRentContract with', { tenant: params.tenant, rentAmountWei: rentAmountWei.toString(), priceFeed: params.priceFeed, dueDate, propertyId, factory: factoryContract.target || factoryContract.address });
        // Call overloaded factory method that accepts dueDate: createRentContract(address,uint256,address,uint256,uint256)
        tx = await factoryContract['createRentContract(address,uint256,address,uint256,uint256)'](
          params.tenant,
          rentAmountWei,
          params.priceFeed,
          dueDate,
          propertyId
        );
      } catch (sendErr) {
        // Try to surface the underlying RPC payload and give actionable guidance
        try {
          console.error('Factory createRentContract failed:', sendErr);
          // Some providers surface the raw RPC payload under sendErr.payload
          if (sendErr?.payload) {
            console.error('Underlying RPC payload:', sendErr.payload);
          }
          if (sendErr?.error) {
            console.error('Provider error object:', sendErr.error);
          }
        } catch (_) {}
        // Friendly message for common causes
        throw new Error('Failed to send transaction to the factory. Verify your wallet is connected to the expected network (localhost if using Hardhat), the selected account is unlocked/has ETH, and the frontend deployment addresses match the network. See console for raw RPC payload.');
      }

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
  return await createContractInstanceAsync('TemplateRentContract', contractAddress, this.signer);
    } catch (error) {
      console.error('Error getting rent contract:', error);
      throw error;
    }
  }

  // Read withdrawable amount for an account from a Rent contract (best-effort)
  async getWithdrawable(contractAddress, account) {
    try {
      const rent = await this.getRentContract(contractAddress);
      const w = await rent.withdrawable(account);
      return BigInt(w || 0);
    } catch (e) {
      // Fallback: attempt low-level call with signature
      try {
  const rent = await createContractInstanceAsync('TemplateRentContract', contractAddress, this.signer);
        const data = rent.interface.encodeFunctionData('withdrawable', [account]);
        const res = await this.signer.provider.call({ to: contractAddress, data });
        const decoded = rent.interface.decodeFunctionResult('withdrawable', res);
        return BigInt(decoded[0] || 0);
      } catch (err) {
        console.warn('Could not read withdrawable for', account, err);
        return 0n;
      }
    }
  }

  // Read the reporter bond for a dispute case (best-effort)
  async getDisputeBond(contractAddress, caseId) {
    try {
      const rent = await this.getRentContract(contractAddress);
      const b = await rent.getDisputeBond(caseId);
      return BigInt(b || 0);
    } catch (e) {
      // fallback: try alternative getter name
      try {
  const rent = await createContractInstanceAsync('TemplateRentContract', contractAddress, this.signer);
        const data = rent.interface.encodeFunctionData('getDisputeBond', [caseId]);
        const res = await this.signer.provider.call({ to: contractAddress, data });
        const decoded = rent.interface.decodeFunctionResult('getDisputeBond', res);
        return BigInt(decoded[0] || 0);
      } catch (err) {
        console.warn('Could not read dispute bond for', contractAddress, caseId, err);
        return 0n;
      }
    }
  }

  // Withdraw any pull-payments credited to caller on a Rent contract
  async withdrawRentPayments(contractAddress) {
    try {
      const rentContract = await this.getRentContract(contractAddress);
      const tx = await rentContract.withdrawPayments();
      const receipt = await tx.wait();
      return receipt;
    } catch (error) {
      console.error('Error withdrawing rent payments:', error);
      throw error;
    }
  }

  // Read the pull-based withdrawable balance for an account on a Rent contract
  async getWithdrawable(contractAddress, account) {
    try {
      const rentContract = await this.getRentContract(contractAddress);
      const w = await rentContract.withdrawable(account);
      return BigInt(w || 0n);
    } catch (error) {
      // If ABI mismatch or getter not present, return 0
      console.debug('getWithdrawable not available or failed', error);
      return 0n;
    }
  }

  // Best-effort read of a reporter/dispute bond for a given case id.
  // Templates may implement different names for this field; try common variants
  async getDisputeBond(contractAddress, caseId) {
    try {
      const rent = await this.getRentContract(contractAddress);
      const candidates = ['getDisputeBond', 'disputeBond', 'reporterBond', 'bondOf', 'caseReporterBond'];
      for (const name of candidates) {
        try {
          if (typeof rent[name] === 'function') {
            const val = await rent[name](caseId);
            return BigInt(val || 0n);
          }
        } catch (_) {
          // ignore and try next
        }
      }
      // Not found — return zero
      return 0n;
    } catch (error) {
      console.debug('getDisputeBond failed', error);
      return 0n;
    }
  }

  /**
   * Read dispute metadata (classification, rationale) for a given rent contract caseId.
   * Returns { classification, rationale } or null on failure.
   */
  async getDisputeMeta(contractAddress, caseId) {
    try {
      const rent = await this.getRentContract(contractAddress);
      const res = await rent.getDisputeMeta(Number(caseId));
      // res is [classification, rationale]
      return { classification: res[0] || '', rationale: res[1] || '' };
    } catch (e) {
      try {
        // fallback: low-level call decode
  const rent = await createContractInstanceAsync('TemplateRentContract', contractAddress, this.signer);
        const data = rent.interface.encodeFunctionData('getDisputeMeta', [Number(caseId)]);
        const ret = await this.signer.provider.call({ to: contractAddress, data });
        const decoded = rent.interface.decodeFunctionResult('getDisputeMeta', ret);
        return { classification: decoded[0] || '', rationale: decoded[1] || '' };
      } catch (err) {
        console.debug('getDisputeMeta failed', err);
        return null;
      }
    }
  }

  async getRentContractDetails(contractAddress, options = {}) {
    const { silent = false } = options || {};
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
      // Signing status (new EIP712 flow). Best effort if ABI mismatch.
      let landlordSigned = false; let tenantSigned = false; let fullySigned = false; let dueDate = 0n;
      try {
        dueDate = await rentContract.dueDate();
        const [ls, ts, fs] = await Promise.all([
          rentContract.signedBy?.(landlord).catch(() => false),
          rentContract.signedBy?.(tenant).catch(() => false),
          rentContract.isFullySigned?.().catch(() => rentContract.rentSigned?.().catch(() => false))
        ]);
        landlordSigned = !!ls; tenantSigned = !!ts; fullySigned = !!fs;
      } catch (_) {}
      const formattedAmount = ethers.formatEther(rentAmount);
      // Derive a richer status for UI
      let status = 'Active';
      if (!isActive) {
        status = 'Cancelled';
      } else if (cancelRequested) {
        status = 'Pending'; // cancellation initiated but not finalized
      }
      return {
  type: 'Rental',
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
        signatures: {
          landlord: landlordSigned,
          tenant: tenantSigned,
          fullySigned,
          dueDate: Number(dueDate || 0n)
        },
        // UI-friendly fields expected by Dashboard
        amount: formattedAmount,
        parties: [landlord, tenant],
        status,
        created: '—'
      };
    } catch (error) {
      if (!silent) {
        console.error('Error getting contract details:', error);
      }
      throw error;
    }
  }

  async getUserContracts(userAddress) {
    try {
      // No special-casing for a platform admin address; return whatever the factory reports.
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
        if (addrErr?.reason) throw addrErr;
        throw new Error('Could not verify tenant address on-chain. Check network and contract address.');
      }
      // Check fully signed status before sending tx to avoid revert
      try {
        const fully = await rentContract.rentSigned();
        if (!fully) {
          const err = new Error('Both parties must sign before payment');
          err.reason = 'Both parties must sign before payment';
          throw err;
        }
      } catch (sigErr) {
        if (sigErr?.reason) throw sigErr; // propagate friendly reason
        // otherwise ignore and let tx attempt
      }
      const tx = await rentContract.payRentInEth({ value: ethers.parseEther(amount) });
      const receipt = await tx.wait();
      return receipt;
    } catch (error) {
      // Map custom error selectors for nicer messages
      try {
        const data = error?.data || error?.error?.data;
        if (data && typeof data === 'object' && data.data) {
          const raw = data.data; // hardhat style nested
          if (raw && raw.startsWith('0x')) {
            const selector = raw.slice(2,10);
            const map = {
              'ac37e5cb':'Both parties must sign before payment', // NotFullySigned
              '873cf48b':'Only tenant may call this',
              '80cb55e2':'Contract inactive',
              '1fbaba35':'Amount too low',
              '00bfc921':'Invalid price'
            };
            // Additional common revert mapping
            const fallbackMap = {
              '08c379a0': 'finalize failed' // generic Error(string)
            };
            if (map[selector]) {
              const friendly = new Error(map[selector]);
              friendly.reason = map[selector];
              throw friendly;
            }
            if (fallbackMap[selector]) {
              const friendly = new Error(fallbackMap[selector]);
              friendly.reason = fallbackMap[selector];
              throw friendly;
            }
          }
        } else if (error?.data && typeof error.data === 'string' && error.data.startsWith('0x')) {
          const selector = error.data.slice(2,10);
          const map = { 'ac37e5cb':'Both parties must sign before payment','873cf48b':'Only tenant may call this','80cb55e2':'Contract inactive','1fbaba35':'Amount too low','00bfc921':'Invalid price'};
          if (map[selector]) {
            const friendly = new Error(map[selector]);
            friendly.reason = map[selector];
            throw friendly;
          }
        }
      } catch (mapped) {
        console.error('Mapped rent payment error:', mapped?.reason || mapped?.message);
        throw mapped;
      }
      console.error('Error paying rent:', error);
      throw error;
    }
  }

  // ERC20 support removed: token approvals are not supported in this project

  /**
   * Finalize a pending cancellation by calling the ArbitrationService.finalizeTargetCancellation
   * arbitrationServiceAddress: address of ArbitrationService
   * contractAddress: target TemplateRentContract
   * feeWei: BigInt or string value to forward as msg.value
   */
  async finalizeCancellationViaService(arbitrationServiceAddress, contractAddress, feeWei = 0n) {
    try {
      if (!arbitrationServiceAddress || !arbitrationServiceAddress.trim()) throw new Error('Arbitration service address required');
      // Preflight: ensure the target contract is configured for arbitration and whether a fee is required.
      try {
  const target = await createContractInstanceAsync('TemplateRentContract', contractAddress, this.signer);
        // Check arbitrationService field
        const targetArb = await target.arbitrationService().catch(() => null);
        if (!targetArb || targetArb === '0x0000000000000000000000000000000000000000') {
          throw new Error(`Target contract ${contractAddress} has no arbitrationService configured`);
        }
        if (targetArb && targetArb.toLowerCase() !== arbitrationServiceAddress.toLowerCase()) {
          throw new Error(`Target arbitrationService mismatch: contract=${targetArb} but you supplied ${arbitrationServiceAddress}`);
        }

        // Ensure a cancellation is pending
        const cancelRequested = await target.cancelRequested().catch(() => false);
        if (!cancelRequested) {
          throw new Error('Target contract has no pending cancellation (cancelRequested=false)');
        }

        // Check if early termination fee is required and compute amount
        const feeBps = Number(await target.earlyTerminationFeeBps().catch(() => 0));
        if (feeBps > 0) {
          // Try to call getRentInEth() which returns uint256 rent in wei
          let requiredEth = 0n;
          try {
            requiredEth = BigInt(await target.getRentInEth());
          } catch (err) {
            // Could not compute rent in eth - surface helpful suggestion
            throw new Error('Target requires an early termination fee but rent-in-ETH could not be determined (price feed may be missing)');
          }
          const requiredFee = (requiredEth * BigInt(feeBps)) / 10000n;
          if (requiredFee > 0n) {
            const provided = typeof feeWei === 'bigint' ? feeWei : BigInt(feeWei || 0);
            if (provided < requiredFee) {
              throw new Error(`Target requires early termination fee of ${requiredFee} wei; pass this amount as feeWei to finalizeCancellationViaService`);
            }
          }
        }
      } catch (preErr) {
        // Bubble up preflight errors as friendly messages
        console.error('Arbitration preflight failed:', preErr);
        throw preErr;
      }

      // Use the frontend static ABI helper to create the ArbitrationService instance
      let svc;
      try {
  svc = await createContractInstanceAsync('ArbitrationService', arbitrationServiceAddress, this.signer);
      } catch (e) {
        console.error('Could not create ArbitrationService instance via static ABI helper:', e);
        throw new Error('ArbitrationService ABI not available');
      }
      // feeWei may be BigInt or string; normalize
      const value = typeof feeWei === 'bigint' ? feeWei : BigInt(feeWei || 0);
      const tx = await svc.finalizeTargetCancellation(contractAddress, { value });
      const receipt = await tx.wait();
      return receipt;
    } catch (error) {
      console.error('Error finalizing via arbitration service:', error);
      throw error;
    }
  }

  /**
   * Landlord-triggered finalize via ArbitrationService.finalizeByLandlord
   * If the connected signer is the landlord, prefer calling finalizeByLandlord on the service.
   * Otherwise callers may continue to use finalizeCancellationViaService (admin/factory path).
   */
  async finalizeByLandlordViaService(arbitrationServiceAddress, contractAddress, feeWei = 0n) {
    try {
      if (!arbitrationServiceAddress || !arbitrationServiceAddress.trim()) throw new Error('Arbitration service address required');

      // Preflight: ensure target configured and cancellation pending
  const target = await createContractInstanceAsync('TemplateRentContract', contractAddress, this.signer);
      const targetArb = await target.arbitrationService().catch(() => null);
      if (!targetArb || targetArb === '0x0000000000000000000000000000000000000000') {
        throw new Error(`Target contract ${contractAddress} has no arbitrationService configured`);
      }
      if (targetArb && targetArb.toLowerCase() !== arbitrationServiceAddress.toLowerCase()) {
        throw new Error(`Target arbitrationService mismatch: contract=${targetArb} but you supplied ${arbitrationServiceAddress}`);
      }

      const cancelRequested = await target.cancelRequested().catch(() => false);
      if (!cancelRequested) throw new Error('Target contract has no pending cancellation (cancelRequested=false)');

      // Check fee if required
      const feeBps = Number(await target.earlyTerminationFeeBps().catch(() => 0));
      if (feeBps > 0) {
        let requiredEth = 0n;
        try { requiredEth = BigInt(await target.getRentInEth()); } catch (err) {
          throw new Error('Target requires an early termination fee but rent-in-ETH could not be determined (price feed may be missing)');
        }
        const requiredFee = (requiredEth * BigInt(feeBps)) / 10000n;
        if (requiredFee > 0n) {
          const provided = typeof feeWei === 'bigint' ? feeWei : BigInt(feeWei || 0);
          if (provided < requiredFee) throw new Error(`Target requires early termination fee of ${requiredFee} wei; pass this amount as feeWei to finalizeByLandlordViaService`);
        }
      }

      // Determine whether connected signer is landlord
      const signerAddr = (await this.signer.getAddress()).toLowerCase();
      const landlordAddr = (await target.landlord()).toLowerCase();
      const value = typeof feeWei === 'bigint' ? feeWei : BigInt(feeWei || 0);

      // Create service instance using static ABI helper
      let svc;
      try {
  svc = await createContractInstanceAsync('ArbitrationService', arbitrationServiceAddress, this.signer);
      } catch (e) {
        console.error('Could not create ArbitrationService instance via static ABI helper:', e);
        throw new Error('ArbitrationService ABI not available');
      }

      // If signer is landlord, call finalizeByLandlord; otherwise attempt finalizeTargetCancellation
      if (signerAddr === landlordAddr) {
        const tx = await svc.finalizeByLandlord(contractAddress, { value });
        const receipt = await tx.wait();
        return receipt;
      }

      // Fallback: attempt the admin/factory path (may revert if signer not authorized)
      const tx = await svc.finalizeTargetCancellation(contractAddress, { value });
      const receipt = await tx.wait();
      return receipt;
    } catch (error) {
      console.error('Error finalizing via arbitration service (landlord path):', error);
      throw error;
    }
  }

  /**
   * Apply a full resolution to a target contract via the ArbitrationService.
   * This is a thin wrapper around ArbitrationService.applyResolutionToTarget with ABI fallback.
   * Parameters mirror the on-chain signature: (targetContract, caseId, approve, appliedAmount, beneficiary)
   */
  async applyResolutionToTargetViaService(arbitrationServiceAddress, targetContract, caseId, approve, appliedAmount = 0n, beneficiary = ethers.ZeroAddress, forwardedEth = 0n) {
    try {
      if (!arbitrationServiceAddress) throw new Error('Arbitration service address required');
      // Normalize types
      const cid = typeof caseId === 'number' || typeof caseId === 'string' ? Number(caseId) : Number(caseId || 0);
  // allow clamping below when debtor deposit is smaller than requested apply amount
  let appAmt = typeof appliedAmount === 'bigint' ? appliedAmount : BigInt(appliedAmount || 0);

      // Create service contract using static ABI helper
      let svc;
      try {
  svc = await createContractInstanceAsync('ArbitrationService', arbitrationServiceAddress, this.signer);
      } catch (e) {
        console.error('Could not create ArbitrationService instance via static ABI helper:', e);
        throw new Error('ArbitrationService ABI not available');
      }

      // Authorization preflight: ensure connected signer is owner or the configured factory
      try {
        const signerAddr = (await this.signer.getAddress()).toLowerCase();
        const ownerAddr = (await svc.owner?.().catch(() => null) || null);
        const factoryAddr = (await svc.factory?.().catch(() => null) || null);
        const isOwner = ownerAddr && signerAddr === String(ownerAddr).toLowerCase();
        const isFactory = factoryAddr && signerAddr === String(factoryAddr).toLowerCase();
        if (!isOwner && !isFactory) {
          throw new Error('Connected wallet is not authorized to call ArbitrationService (must be service owner or factory). Switch to the arbitrator account.');
        }
      } catch (authErr) {
        // Bubble up as friendly error
        console.error('Authorization preflight failed for applyResolutionToTargetViaService:', authErr);
        throw authErr;
      }

      // Target preflight: ensure the target contract has this arbitration service configured
      try {
  const target = await createContractInstanceAsync('TemplateRentContract', targetContract, this.signer);
        const targetArb = await target.arbitrationService().catch(() => null);
        if (!targetArb || targetArb === ethers.ZeroAddress) {
          throw new Error(`Target contract ${targetContract} has no arbitrationService configured`);
        }
        if (String(targetArb).toLowerCase() !== String(arbitrationServiceAddress).toLowerCase()) {
          throw new Error(`Target arbitrationService mismatch: contract=${targetArb} but you supplied ${arbitrationServiceAddress}`);
        }

        // Best-effort: clamp appliedAmount to the debtor's available deposit to avoid target revert
        try {
          // beneficiary param is the recipient (initiator). Debtor is the other party
          const landlordAddr = await target.landlord().catch(() => null);
          const tenantAddr = await target.tenant().catch(() => null);
          const beneficiaryLower = String(beneficiary || '').toLowerCase();
          let debtorAddr = null;
          if (beneficiaryLower && landlordAddr && beneficiaryLower === String(landlordAddr).toLowerCase()) {
            debtorAddr = tenantAddr;
          } else {
            debtorAddr = landlordAddr;
          }
          if (debtorAddr) {
            const dep = BigInt(await target.partyDeposit(debtorAddr).catch(() => 0n) || 0n);
            if (dep < appAmt) {
              console.warn(`Clamping appliedAmount ${appAmt} to debtor deposit ${dep} to avoid revert`);
              // mutate appAmt used below
              // eslint-disable-next-line no-param-reassign
              appAmt = dep;
            }
          }
        } catch (clampErr) {
          // non-fatal; proceed without clamping
          console.debug('Could not compute debtor deposit for clamping:', clampErr);
        }
      } catch (tErr) {
        console.error('Target preflight failed for applyResolutionToTargetViaService:', tErr);
        throw tErr;
      }

      // Call applyResolutionToTarget on the service; ensure applied amount is passed as uint256
      try {
  // Attach forwarded ETH if provided so the arbitration service can top-up
  // debtor deposits atomically when calling into the target.
  const overrides = (forwardedEth && typeof forwardedEth === 'bigint' && forwardedEth > 0n) ? { value: forwardedEth } : {};
  const tx = await svc.applyResolutionToTarget(targetContract, cid, !!approve, appAmt, beneficiary, overrides);
        const receipt = await tx.wait();
        return receipt;
      } catch (callErr) {
        // Attempt to decode revert reason for friendlier messaging
        try {
          // Ethers error may contain `error` or `data` with revert payload
          const msg = callErr?.error?.message || callErr?.message || String(callErr);
          throw new Error(`ArbitrationService call failed: ${msg}`);
        } catch (decodeErr) {
          throw callErr;
        }
      }
    } catch (error) {
      console.error('Error applying resolution via ArbitrationService:', error);
      throw error;
    }
  }

  /**
   * Compute reporter bond (0.5% of requested amount, minimum 1 wei when requestedAmount>0)
   */
  computeReporterBond(requestedAmountWei) {
    try {
      const amt = typeof requestedAmountWei === 'bigint' ? requestedAmountWei : BigInt(requestedAmountWei || 0);
      if (amt <= 0n) return 0n;
      let bond = (amt * 5n) / 1000n; // 0.5% = 5/1000
      if (bond === 0n) bond = 1n; // ensure non-zero bond for small amounts
      return bond;
    } catch (e) {
      return 0n;
    }
  }

  /**
   * Report a dispute on a Rent contract (appeal to arbitration).
   * disputeType: numeric enum matching TemplateRentContract.DisputeType (0..)
   * requestedAmount: BigInt or string in wei (use 0 for none)
   * evidenceText: optional plain text or URL to store on-chain as string
   */
  async reportRentDispute(contractAddress, disputeType = 0, requestedAmount = 0n, evidenceText = '') {
    try {
  const rent = await createContractInstanceAsync('TemplateRentContract', contractAddress, this.signer);
      // Ensure caller is one of the parties recorded on-chain
      try {
        const [landlordAddr, tenantAddr, me] = await Promise.all([
          rent.landlord().catch(() => null),
          rent.tenant().catch(() => null),
          this.signer.getAddress().catch(() => null)
        ]);
        const lc = (landlordAddr || '').toLowerCase();
        const tc = (tenantAddr || '').toLowerCase();
        const mc = (me || '').toLowerCase();
        if (mc !== lc && mc !== tc) {
          const err = new Error(`Connected wallet (${mc}) is not a party to contract ${contractAddress}`);
          err.code = 'NOT_A_PARTY';
          throw err;
        }
      } catch (pfErr) {
        throw pfErr;
      }
      // Pass plain evidence string to the contract. Templates now accept `string evidence`.
        const amount = typeof requestedAmount === 'bigint' ? requestedAmount : BigInt(requestedAmount || 0);
        const evidence = evidenceText && String(evidenceText).trim().length > 0 ? String(evidenceText).trim() : '';
        // Compute reporter bond and send as msg.value
        const bond = this.computeReporterBond(amount);
        const overrides = bond > 0n ? { value: bond } : {};
        // The contract now accepts a bytes32 evidence digest. If caller passed a plain string,
        // compute keccak256 digest of its UTF-8 bytes. If caller already passed a 0x-prefixed
        // 32-byte hex digest, use it as-is.
        let digestArg = '0x' + '0'.repeat(64);
        if (evidence && /^0x[0-9a-fA-F]{64}$/.test(evidence)) {
          digestArg = evidence;
        } else if (evidence) {
          digestArg = ethers.keccak256(ethers.toUtf8Bytes(evidence));
        }
        const tx = await rent.reportDispute(disputeType, amount, digestArg, overrides);
      const receipt = await tx.wait();
      // Try to extract the caseId from emitted events
      let caseId = null;
      try {
        for (const log of receipt.logs) {
          try {
            const parsed = rent.interface.parseLog(log);
            if (parsed && parsed.name === 'DisputeReported') {
              caseId = parsed.args[0]?.toString?.() ?? null;
              break;
            }
          } catch (_) {}
        }
      } catch (_) {}
      return { receipt, caseId };
    } catch (error) {
      console.error('Error reporting rent dispute:', error);
      throw error;
    }
  }

  /**
   * Allow the debtor to deposit the claimed amount for a given case.
   * amountWei: BigInt value to send as msg.value. If omitted, caller should provide value.
   */
  async depositForCase(contractAddress, caseId, amountWei = 0n) {
    try {
      if (!contractAddress) throw new Error('contractAddress required');
      const rent = await this.getRentContract(contractAddress);
      const value = typeof amountWei === 'bigint' ? amountWei : BigInt(amountWei || 0);
      if (value <= 0n) throw new Error('deposit amount must be > 0');
      const tx = await rent.depositForCase(Number(caseId), { value });
      const receipt = await tx.wait();
      return receipt;
    } catch (error) {
      console.error('Error depositing for case:', error);
      throw error;
    }
  }

  /**
   * Determine whether the connected signer/address is authorized to perform
   * arbitration actions for the given contract. We allow:
   *  - the original creator/deployer of the contract (as recorded in ContractFactory.contractsByCreator)
   *  - the owner of the configured ArbitrationService for the contract (if set)
   * Returns boolean.
   */
  async isAuthorizedArbitratorForContract(contractAddress) {
    try {
      const me = (await this.signer.getAddress()).toLowerCase();
      // 1) Check creator mapping on factory
      try {
        const factory = await this.getFactoryContract();
        const creator = await factory.getCreatorOf(contractAddress).catch(() => ethers.ZeroAddress);
        if (creator && creator !== ethers.ZeroAddress && creator.toLowerCase() === me) return true;
      } catch (_) {
        // ignore factory lookup errors
      }

      // 2) If contract exposes `arbitrationService`, check its owner
      try {
        // Try as Rent first
        try {
          const rent = await this.getRentContract(contractAddress);
          const svc = await rent.arbitrationService();
          if (svc && svc !== ethers.ZeroAddress) {
            const svcInst = await createContractInstanceAsync('ArbitrationService', svc, this.signer);
            const owner = await svcInst.owner().catch(() => ethers.ZeroAddress);
            if (owner && owner.toLowerCase() === me) return true;
          }
        } catch (_) {}

        // Try as NDA
        try {
          const nda = await this.getNDAContract(contractAddress);
          const svc = await nda.arbitrationService();
          if (svc && svc !== ethers.ZeroAddress) {
            const svcInst = await createContractInstanceAsync('ArbitrationService', svc, this.signer);
            const owner = await svcInst.owner().catch(() => ethers.ZeroAddress);
            if (owner && owner.toLowerCase() === me) return true;
          }
        } catch (_) {}
      } catch (_) {}

      return false;
    } catch (error) {
      console.error('Error checking arbitrator authorization:', error);
      return false;
    }
  }

  // ERC20 support removed: token payments are not available in this project

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

      // Preflight checks to provide friendlier errors and avoid RPC estimateGas revert
      try {
        const [landlord, tenant, isActive, cancelReq] = await Promise.all([
          rentContract.landlord().catch(() => null),
          rentContract.tenant().catch(() => null),
          rentContract.active().catch(() => null),
          rentContract.cancelRequested().catch(() => null),
        ]);

        const myAddr = await this.signer.getAddress().catch(() => null);
        // Ensure caller is a party
        if (!myAddr) {
          throw new Error('Could not determine connected wallet address. Connect your wallet and try again.');
        }
        const lower = (s) => (s ? String(s).toLowerCase() : null);
        const me = lower(myAddr);
        const ld = lower(landlord);
        const tn = lower(tenant);

        if (isActive === false || String(isActive) === 'false') {
          throw new Error('Contract is not active. Cancellation not allowed.');
        }

        if (cancelReq === true || String(cancelReq) === 'true') {
          throw new Error('Cancellation has already been requested for this contract.');
        }

        if (me !== ld && me !== tn) {
          throw new Error('Only the landlord or tenant may initiate cancellation. Switch to the correct account and try again.');
        }
      } catch (preErr) {
        // If we determined a friendly preflight error, throw it
        if (preErr && preErr.message) {
          throw preErr;
        }
        // otherwise continue to attempt tx and let provider surface errors
      }

      // Additional preflight: attempt estimateGas to detect reverts early and map common selectors
      try {
        if (rentContract && rentContract.estimateGas && typeof rentContract.estimateGas.initiateCancellation === 'function') {
          try {
            await rentContract.estimateGas.initiateCancellation();
          } catch (eg) {
            // Try to parse revert selectors from the error payload when possible
            const data = eg?.data || eg?.error?.data || eg?.reason || null;
            const raw = (typeof data === 'string' && data.startsWith('0x')) ? data : (data && data.data && typeof data.data === 'string' ? data.data : null);
            if (raw) {
              const selector = raw.slice(2, 10);
              const map = {
                'a9b7d5d7': 'Only the landlord or tenant may initiate cancellation', // NotParty()
                '00bfc921': 'Invalid price or oracle failure',
                'c76a4f7e': 'Cancellation already requested' // hypothetical selector mapping
              };
              if (map[selector]) throw new Error(map[selector]);
            }
            // rethrow original to be handled below
            throw eg;
          }
        }
      } catch (eg) {
        // If estimateGas produced a friendly error earlier, surface it
        if (eg && eg.message) throw eg;
        // otherwise continue and attempt to send the tx (fallback)
      }

      // Some injected wallets (MetaMask) take a moment to update the selected
      // account after the user switches. Attempt to detect and refresh the
      // signer from the injected provider before sending the transaction.
      let activeSigner = this.signer;
      try {
        if (typeof window !== 'undefined' && window.ethereum && window.ethereum.request) {
          // Poll a few times for wallet/account update (short delay) to tolerate latency
          let injectedAccounts = [];
          const maxAttempts = 5;
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
              injectedAccounts = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => []);
            } catch (_) {
              injectedAccounts = [];
            }
            if (injectedAccounts && injectedAccounts[0]) break;
            // small wait
            await new Promise((r) => setTimeout(r, 200));
          }
          const injected = (injectedAccounts && injectedAccounts[0]) ? String(injectedAccounts[0]).toLowerCase() : null;
          try {
            const currentSignerAddr = (await this.signer.getAddress().catch(() => null) || '').toLowerCase();
            if (injected && injected !== currentSignerAddr) {
              // attempt to refresh signer from the existing provider
              try {
                const provider = this.signer.provider || (new ethers.BrowserProvider(window.ethereum));
                const refreshed = provider.getSigner(injectedAccounts[0]);
                // validate
                const refreshedAddr = (await refreshed.getAddress().catch(() => null) || '').toLowerCase();
                if (refreshedAddr && refreshedAddr === injected) {
                  activeSigner = refreshed;
                }
              } catch (_) {
                // fall back to existing signer
              }
            }
          } catch (_) {}
        }
      } catch (_) {}

      // Use the (possibly refreshed) signer when sending the transaction
      let tx;
      try {
        tx = await rentContract.connect(activeSigner).initiateCancellation();
        return await tx.wait();
      } catch (err) {
        // Map known revert selectors to friendlier messages when possible
        try {
          const data = err?.data || err?.error?.data || err?.data?.data || null;
          const raw = (typeof data === 'string' && data.startsWith('0x')) ? data : (data && data.data && typeof data.data === 'string' ? data.data : null);
          if (raw) {
            const selector = raw.slice(2, 10);
            const map = {
              // selectors from TemplateRentContract custom errors (best-effort guesses)
              '2f54bf6e': 'Only tenant may call this',
              'd3d3d3d3': 'Only landlord may call this',
              'b7f9c7a1': 'Contract is not active',
              'c1e3d4b2': 'Cancellation already requested',
              '86753090': 'Not a party to this contract'
            };
            if (map[selector]) throw new Error(map[selector]);
          }
        } catch (_) {}
        // Re-throw original error if no friendly mapping found
        throw err;
      }
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
  // Templates no longer accept a direct `arbitrator` address. Pass only
  // the minimum deposit to the factory; arbitration is configured via
  // an on-chain ArbitrationService after deployment.
  const arbitratorAddress = params.arbitrator || ethers.ZeroAddress; // kept for backward compat in UI
    
    // Hash the custom clauses if provided
    const clausesHash = params.customClauses 
      ? ethers.id(params.customClauses) 
      : ethers.ZeroHash;

      // New factory signature: createNDA(_partyB, _expiryDate, _penaltyBps, _customClausesHash, _minDeposit)
      const tx = await factoryContract.createNDA(
        params.partyB,           // address
        expiryTimestamp,         // uint256 (timestamp)
        params.penaltyBps,       // uint16
        clausesHash,             // bytes32
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
  return await createContractInstanceAsync('NDATemplate', contractAddress, this.signer);
  } catch (error) {
    console.error('Error getting NDA contract:', error);
    throw error;
  }
}

async getNDAContractDetails(contractAddress, options = {}) {
  const { silent = false } = options || {};
  try {
    // Ensure the address is a contract before calling views
    const code = await this.signer.provider.getCode(contractAddress);
    if (!code || code === '0x') {
      throw new Error(`Address ${contractAddress} has no contract code`);
    }
    const ndaContract = await this.getNDAContract(contractAddress);
    
    const [partyA, partyB, expiryDate, penaltyBps, minDeposit, isActive, arbitrator, admin, canWithdraw] = await Promise.all([
      ndaContract.partyA(),
      ndaContract.partyB(),
      ndaContract.expiryDate(),
      ndaContract.penaltyBps(),
      ndaContract.minDeposit(),
      // NDATemplate exposes `active` public var (getter)
      ndaContract.active().catch(() => true),
      ndaContract.arbitrator?.().catch?.(() => ethers.ZeroAddress) ?? ethers.ZeroAddress,
      ndaContract.admin?.().catch?.(() => ethers.ZeroAddress) ?? ethers.ZeroAddress,
      ndaContract.canWithdraw?.().catch?.(() => false) ?? false,
    ]);
    // Aggregate status info
    let fullySigned = false;
    let totalDeposits = '0';
    let activeCases = 0;
    try {
      const st = await ndaContract.getContractStatus();
      // st: (isActive, fullySigned, totalDeposits, activeCases)
      fullySigned = !!st[1];
      totalDeposits = ethers.formatEther(st[2]);
      activeCases = Number(st[3] || 0);
    } catch (_) {}
    
    // Parties, signatures & deposits
    let parties = [];
    try {
      parties = await ndaContract.getParties();
    } catch (_) {
      parties = [partyA, partyB].filter(Boolean);
    }
    const signatures = {};
    const depositsByParty = {};
    for (const p of parties) {
      try {
        signatures[p] = await ndaContract.signedBy(p);
      } catch (_) { signatures[p] = false; }
      try {
        const dep = await ndaContract.deposits(p);
        depositsByParty[p] = ethers.formatEther(dep);
      } catch (_) { depositsByParty[p] = '0'; }
    }

    // Cases
    let cases = [];
    try {
      const cnt = Number(await ndaContract.getCasesCount());
      const arr = [];
      for (let i = 0; i < cnt; i++) {
        try {
          const c = await ndaContract.getCase(i);
          arr.push({
            id: i,
            reporter: c[0],
            offender: c[1],
            requestedPenalty: ethers.formatEther(c[2]),
            // templates now return a string evidence at index 3
            evidence: c[3],
            resolved: !!c[4],
            approved: !!c[5],
            approveVotes: Number(c[6] || 0),
            rejectVotes: Number(c[7] || 0),
          });
        } catch (_) {}
      }
      cases = arr;
    } catch (_) {}

    const formattedMin = ethers.formatEther(minDeposit);
    return {
      address: contractAddress,
      partyA,
      partyB,
      expiryDate: new Date(Number(expiryDate) * 1000).toLocaleDateString(),
      penaltyBps: Number(penaltyBps),
      minDeposit: formattedMin,
      isActive: !!isActive,
      arbitrator,
      admin,
      fullySigned,
      totalDeposits,
      activeCases,
      canWithdraw: !!canWithdraw,
      parties,
      signatures,
      depositsByParty,
      cases,
      type: 'NDA',
      // UI-friendly fields expected by Dashboard
      amount: formattedMin,
      parties: [partyA, partyB],
      status: !!isActive ? 'Active' : 'Inactive',
      created: new Date(Number(expiryDate) * 1000).toLocaleDateString()
    };
  } catch (error) {
    if (!silent) {
      console.error('Error getting NDA details:', error);
    }
    throw error;
  }
}

// ---------- NDA helpers ----------
async signNDA(contractAddress) {
  try {
    const nda = await this.getNDAContract(contractAddress);
    // Preflight: ensure current signer is a party and hasn't signed yet
    const myAddr = (await this.signer.getAddress()).toLowerCase();
    try {
      const [isParty, alreadySigned] = await Promise.all([
        // public mapping getters
        nda.isParty(myAddr),
        nda.signedBy(myAddr)
      ]);
      if (!isParty) {
        throw new Error('Current wallet is not a party to this NDA');
      }
      if (alreadySigned) {
        throw new Error('Already signed with this wallet');
      }
    } catch (_) {
      // If ABI doesn't expose mapping getters, ignore and proceed; on-chain will still validate
    }
    const [expiryDate, penaltyBps, customClausesHash] = await Promise.all([
      nda.expiryDate(),
      nda.penaltyBps(),
      nda.customClausesHash(),
    ]);
    const domain = {
      name: 'NDATemplate',
      version: '1',
      chainId: Number(this.chainId),
      verifyingContract: contractAddress,
    };
    const types = {
      NDA: [
        { name: 'contractAddress', type: 'address' },
        { name: 'expiryDate', type: 'uint256' },
        { name: 'penaltyBps', type: 'uint16' },
        { name: 'customClausesHash', type: 'bytes32' },
      ],
    };
    const value = {
      contractAddress,
      expiryDate: BigInt(expiryDate),
      penaltyBps: Number(penaltyBps),
      customClausesHash,
    };
    const signature = await this.signer.signTypedData(domain, types, value);
    const tx = await nda.signNDA(signature);
    return await tx.wait();
  } catch (error) {
    console.error('Error signing NDA:', error);
    // Normalize common revert reasons
    const reason = error?.reason || error?.error?.message || error?.data?.message || error?.message || '';
    if (/already signed/i.test(reason)) {
      throw new Error('Already signed with this wallet');
    }
    throw error;
  }
}

async ndaDeposit(contractAddress, amountEth) {
  try {
    const nda = await this.getNDAContract(contractAddress);
    const tx = await nda.deposit({ value: ethers.parseEther(String(amountEth)) });
    return await tx.wait();
  } catch (error) {
    console.error('Error depositing to NDA:', error);
    throw error;
  }
}

async ndaWithdraw(contractAddress, amountEth) {
  try {
    const nda = await this.getNDAContract(contractAddress);
    const tx = await nda.withdrawDeposit(ethers.parseEther(String(amountEth)));
    return await tx.wait();
  } catch (error) {
    console.error('Error withdrawing from NDA:', error);
    throw error;
  }
}

async ndaReportBreach(contractAddress, offender, requestedPenaltyEth, evidenceText) {
  try {
    const nda = await this.getNDAContract(contractAddress);
    const requested = requestedPenaltyEth ? ethers.parseEther(String(requestedPenaltyEth)) : 0n;
  // The NDA template now expects a bytes32 evidence digest. If a plain string is provided,
  // compute keccak256(evidenceText) and pass that as the digest.
  const evidenceRaw = evidenceText && String(evidenceText).trim().length > 0 ? String(evidenceText).trim() : '';
  const evidence = evidenceRaw && /^0x[0-9a-fA-F]{64}$/.test(evidenceRaw) ? evidenceRaw : (evidenceRaw ? ethers.keccak256(ethers.toUtf8Bytes(evidenceRaw)) : ethers.ZeroHash);
    // include on-chain dispute fee if present
    let disputeFee = 0n;
    try { disputeFee = await nda.disputeFee(); } catch (e) { disputeFee = 0n; }
  const tx = await nda.reportBreach(offender, requested, evidence, { value: disputeFee });
    return await tx.wait();
  } catch (error) {
    console.error('Error reporting breach:', error);
    throw error;
  }
}

async ndaVoteOnBreach(contractAddress, caseId, approve) {
  // Voting removed: NDAs only support arbitrator/oracle resolution. Fail fast to avoid UI confusion.
  throw new Error('Voting disabled: use arbitrator or oracle resolution');
}

async ndaResolveByArbitrator(contractAddress, caseId, approve, beneficiary) {
  // Compatibility shim removed: front-end should trigger an off-chain arbitrator
  // workflow which ultimately causes the platform Arbitrator to call the
  // on-chain ArbitrationService. There is no public entrypoint on templates
  // callable by arbitrary wallets. Surface a helpful error here.
  throw new Error('resolveByArbitrator removed: use platform arbitrator + ArbitrationService flow');
}

async ndaEnforcePenalty(contractAddress, guilty, penaltyEth, beneficiary) {
  try {
    const nda = await this.getNDAContract(contractAddress);
    const penalty = ethers.parseEther(String(penaltyEth));
    const tx = await nda.enforcePenalty(guilty, penalty, beneficiary);
    return await tx.wait();
  } catch (error) {
    console.error('Error enforcing penalty:', error);
    throw error;
  }
}

async ndaDeactivate(contractAddress, reason) {
  try {
    const nda = await this.getNDAContract(contractAddress);
    const tx = await nda.deactivate(reason || '');
    return await tx.wait();
  } catch (error) {
    console.error('Error deactivating NDA:', error);
    throw error;
  }
}

async signRent(contractAddress) {
    try {
      const rent = await this.getRentContract(contractAddress);
      const myAddr = (await this.signer.getAddress()).toLowerCase();
      const landlord = (await rent.landlord()).toLowerCase();
      const tenant = (await rent.tenant()).toLowerCase();
      if (myAddr !== landlord && myAddr !== tenant) {
        throw new Error('Current wallet is not a party to this Rent contract');
      }
      // Check already signed
      try {
        if (await rent.signedBy(myAddr)) {
          throw new Error('Already signed with this wallet');
        }
      } catch (_) {}
      // Fetch dueDate (0 allowed pre-set). If not set, require landlord sets first for determinism.
      const dueDate = await rent.dueDate();
      const rentAmount = await rent.rentAmount();
      const domain = {
        name: 'TemplateRentContract',
        version: '1',
        chainId: Number(this.chainId),
        verifyingContract: contractAddress
      };
      const types = {
        RENT: [
          { name: 'contractAddress', type: 'address' },
          { name: 'landlord', type: 'address' },
          { name: 'tenant', type: 'address' },
          { name: 'rentAmount', type: 'uint256' },
          { name: 'dueDate', type: 'uint256' }
        ]
      };
      const value = {
        contractAddress,
        landlord,
        tenant,
        rentAmount: BigInt(rentAmount),
        dueDate: BigInt(dueDate)
      };
      const signature = await this.signer.signTypedData(domain, types, value);
      const tx = await rent.signRent(signature);
      return await tx.wait();
    } catch (error) {
      console.error('Error signing Rent contract:', error);
      const reason = error?.reason || error?.message || '';
      if (/already signed/i.test(reason)) {
        throw new Error('Already signed with this wallet');
      }
      throw error;
    }
  }
}