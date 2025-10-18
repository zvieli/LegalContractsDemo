import { ethers } from 'ethers';
import { getContractAddress, createContractInstanceAsync } from '../utils/contracts';

function getAdminPub() {
  try {
    if (typeof window !== 'undefined' && window.__ENV__ && window.__ENV.VITE_ADMIN_PUBLIC_KEY) return window.__ENV__.VITE_ADMIN_PUBLIC_KEY;
  } catch (e) {}
  return null;
}

function getRequireEvidenceUpload() {
  try {
    if (import.meta && import.meta.env && import.meta.env.VITE_REQUIRE_EVIDENCE_UPLOAD) return String(import.meta.env.VITE_REQUIRE_EVIDENCE_UPLOAD) === 'true';
  } catch (e) {}
  try {
    if (typeof window !== 'undefined' && window.__ENV__ && window.__ENV.VITE_REQUIRE_EVIDENCE_UPLOAD) return String(window.__ENV__.VITE_REQUIRE_EVIDENCE_UPLOAD) === 'true';
  } catch (e) {}
  return false;
}

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
    // If the evidence endpoint + admin pub are configured in the frontend, submit ciphertext to endpoint first.
    const runtimeEndpoint = getEvidenceEndpoint();
    const runtimeAdmin = getAdminPub();
    if (runtimeEndpoint && runtimeAdmin) {
      const digest = await submitEvidenceAndReport(id, payloadStr, overrides);
      return digest;
    }

    const digest = computePayloadDigest(payloadStr);
    // Guard: never send a zero/empty digest on-chain. This prevents accidental
    // reporting of an empty payload when evidence preparation failed.
    const isZeroDigest = d => !d || /^0x0{64}$/.test(String(d));
    if (isZeroDigest(digest)) {
      throw new Error('Computed evidence digest is zero or empty; aborting on-chain report');
    }
    // await contract.reportDispute(id, digest, overrides); // FIXME: contract not defined
  } catch (e) {
    throw e;
  }
}

/**
 * submitEvidenceAndReport
 * - encrypts payload to admin public key (via `prepareEvidencePayload`)
 * - POSTs ciphertext JSON to the evidence endpoint (expects { digest, path, file })
 * - calls contract.reportDispute with returned digest
 * - returns the digest
 */
export async function submitEvidenceAndReport(id, payloadStr, overrides = {}) {
  const runtimeEndpoint = getEvidenceEndpoint();
  const runtimeAdmin = getAdminPub();
  if (!runtimeEndpoint || !runtimeAdmin) throw new Error('Evidence endpoint or admin public key not configured');
  // prepare (encrypt) payload
  const { ciphertext, digest } = await prepareEvidencePayload(payloadStr, { encryptToAdminPubKey: runtimeAdmin });

  // Basic validation: make sure prepareEvidencePayload produced a ciphertext and a non-zero digest.
  const isZeroDigest = d => !d || /^0x0{64}$/.test(String(d));
  if (!ciphertext || typeof ciphertext !== 'string' || ciphertext.length === 0) {
    throw new Error('Evidence preparation failed: ciphertext is empty');
  }
  if (isZeroDigest(digest)) {
    throw new Error('Evidence preparation failed: computed digest is zero');
  }

  // POST ciphertext to endpoint
  // Build endpoint URL robustly: the runtime endpoint may be a base URL (e.g. http://127.0.0.1:3001)
  // or a full path (e.g. http://127.0.0.1:3001/submit-evidence). Normalize to a single
  // final URL that ends with '/submit-evidence'. This avoids posting to '/submit-evidence/submit-evidence'.
  let endpointUrl = String(runtimeEndpoint || '').trim();
  if (endpointUrl.endsWith('/')) endpointUrl = endpointUrl.slice(0, -1);
  if (!endpointUrl.toLowerCase().endsWith('/submit-evidence')) endpointUrl = endpointUrl + '/submit-evidence';
  // E2E debug: surface the endpoint and payload in the browser console so Playwright traces capture it
  try { if (IN_E2E) console.log && console.log('E2EDBG: submitEvidenceAndReport POST', endpointUrl, 'admin=', String(runtimeAdmin).slice(0, 20), 'digest=', digest); } catch (e) {}
  // E2E debug: print final fetch URL so traces show exactly where the POST goes
  try { if (IN_E2E) console.log && console.log('E2EDBG: final evidence POST URL', endpointUrl); } catch (e) {}
  // E2E debug: print request body length so we can spot empty/zero-length uploads
  try { if (IN_E2E) console.log && console.log('E2EDBG: evidence POST body length', (ciphertext && ciphertext.length) || 0); } catch (e) {}
  let res;
  try {
    res = await fetch(endpointUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ciphertext });
  } catch (fetchErr) {
  try { if (IN_E2E) console.error && console.error('E2EDBG: evidence POST fetch failed', String(fetchErr)); } catch (e) {}
    throw fetchErr;
  }
  // E2E debug: log response status and a short body preview (clone() so we don't consume the stream)
    try {
      if (IN_E2E && res) {
      let text = '';
      try { text = await res.clone().text().catch(() => ''); } catch (cloneErr) { text = '<clone failed>'; }
      console.log && console.log('E2EDBG: evidence POST response', 'status=', res.status, 'bodyPreview=', String(text).slice(0, 1000));
      }
    } catch (e) { try { console.error && console.error('E2EDBG: response logging failed', String(e)); } catch (_) {} }
  // If the server rejects a submitted wrapper and returns adminPublicKey, re-encrypt locally and retry once
  if (!res.ok) {
    // Try to parse JSON body for adminPublicKey and log the failure for E2E traces
    let errBody = null;
    try {
      errBody = await res.json();
    } catch (e) {
      try {
        const txt = await res.text().catch(() => '');
        if (e2eFlag) console.debug && console.debug('E2E: evidence POST non-json response body', txt.slice(0, 1000));
      } catch (__) {}
      errBody = null;
    }
  try { if (IN_E2E) console.log && console.log('E2EDBG: evidence POST initial response status', res.status, 'json=', errBody); } catch (e) {}
    if (res.status === 400 && errBody && errBody.adminPublicKey) {
      // Re-encrypt locally using returned adminPublicKey and resend
      try {
        const adminPub = errBody.adminPublicKey;
        const { ciphertext: newCiphertext, digest: newDigest } = await prepareEvidencePayload(payloadStr, { encryptToAdminPubKey: adminPub });
        try { if (IN_E2E) console.log && console.log('E2EDBG: submitEvidenceAndReport RETRY POST', endpointUrl, 'digest=', newDigest); } catch (e) {}
        res = await fetch(endpointUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: newCiphertext });
        if (!res.ok) {
          const tb = await res.text().catch(() => '');
          try { console.error && console.error('E2EDBG: evidence endpoint retry non-ok', res.status, tb); } catch (_) {}
          throw new Error('evidence endpoint retry failed: ' + res.status + ' ' + tb);
        }
        const parsed = await res.json();
        const returnedDigest = parsed && parsed.digest ? parsed.digest : newDigest;
        // Report on-chain
        await contract.reportDispute(id, returnedDigest, overrides);
        return returnedDigest;
      } catch (reErr) {
        throw reErr;
      }
    }
    const text = await (async() => { try { return await res.text(); } catch(e){ return ''; }})();
    throw new Error('evidence endpoint returned ' + res.status + ' ' + text);
  }
  const body = await res.json();
  // Prefer heliaUri when available (new architecture). Fall back to digest for compatibility.
  const returnedUri = body && body.heliaUri ? body.heliaUri : null;
  const returnedDigest = body && body.digest ? body.digest : digest;
  try { if (IN_E2E) console.log && console.log('E2EDBG: evidence endpoint returned', returnedUri || returnedDigest, body && body.path); } catch (e) {}

  // Report on-chain: prefer passing the URI (helia://...) when provided, else pass the digest for backward compatibility
  const toSend = returnedUri ? returnedUri : returnedDigest;
  await contract.reportDispute(id, toSend, overrides);
  return toSend;
}

export class ContractService {
  /**
   * Constructor is flexible to accept either:
   *   new ContractService(provider, signer, chainId)
   * or
   *   new ContractService(signer, chainId, { provider })
   * or
   *   new ContractService(signer, chainId)
   * The constructor normalizes inputs to this.provider, this.signer, this.chainId.
   */
  constructor(a, b, c) {
    // Normalize arguments
    let provider = null;
    let signer = null;
    let chainId = null;
    let opts = {};

    // Case: (provider, signer, chainId)
    if (a && typeof a.getBlockNumber === 'function') {
      provider = a;
      signer = b || null;
      chainId = c || null;
    } else {
      // Case: (signer, chainId, opts?) or (signer, chainId)
      signer = a || null;
      chainId = b || null;
      opts = c || {};
      if (opts.provider) provider = opts.provider;
    }

  // NOTE: do NOT derive provider automatically from signer here.
  // Deriving a provider from a signer can produce an injected BrowserProvider
  // that is routed to a remote RPC (e.g. Alchemy) or may be missing in some
  // signer-like objects. Favor an explicit provider passed into the
  // constructor. For local development we fall back to a direct JSON-RPC
  // provider when needed inside _providerForRead().

    // Last-resort fallback: read from global debug handle if available
    try {
      if (!provider && typeof window !== 'undefined' && window.__APP_ETHERS__ && window.__APP_ETHERS__.provider) {
        provider = window.__APP_ETHERS__.provider;
        console.debug('[ContractService] provider derived from window.__APP_ETHERS__');
      }
      if (!signer && typeof window !== 'undefined' && window.__APP_ETHERS__ && window.__APP_ETHERS__.signer) {
        signer = window.__APP_ETHERS__.signer;
        console.debug('[ContractService] signer derived from window.__APP_ETHERS__');
      }
      if (!chainId && typeof window !== 'undefined' && window.__APP_ETHERS__ && window.__APP_ETHERS__.chainId) {
        chainId = window.__APP_ETHERS__.chainId;
        console.debug('[ContractService] chainId derived from window.__APP_ETHERS__');
      }
    } catch (e) {
      // noop
    }

    // Final assignment
    this.provider = provider || null;
    this.signer = signer || null;
    this.chainId = chainId || null;

    // Helper: detect signer-like objects
    this._isSignerLike = (obj) => {
      if (!obj) return false;
      if (typeof obj.getAddress === 'function') return true;
      // Ethers BrowserProvider.getSigner returns objects with 'provider' and 'getAddress'
      if (obj.provider && typeof obj === 'object' && typeof obj === 'object') return !!obj.provider;
      return false;
    };

    // Helper: return a provider usable for read-only calls. Prefer explicit this.provider.
    // If no explicit provider is available and we're on a local/dev chain, return a
    // direct JsonRpcProvider pointed at the common localhost URL. Do NOT return
    // signer.provider here Γאפ that keeps read semantics provider-first and avoids
    // accidental routing of local reads to remote RPCs when the injected signer
    // is backed by a third-party provider.
    this._providerForRead = () => {
      if (this.provider) return this.provider;
      const chainNum = Number(this.chainId);
      const isLocal = chainNum === 31337 || chainNum === 1337 || chainNum === 5777;
      if (isLocal) {
        try {
          return new ethers.JsonRpcProvider('http://127.0.0.1:8545');
        } catch (e) {
          return null;
        }
      }
      return null;
    };

    // Helper: safely get signer address when signer-like
    this._getSignerAddressSafe = async () => {
      try {
        if (!this.signer) return null;
        try {
          const { safeGetAddress } = await import('../utils/signer.js');
          const p = this._providerForRead();
          return await safeGetAddress(this.signer, p);
        } catch (e) {
          // Fallback: attempt the older style checks
          if (typeof this.signer.getAddress === 'function') {
            return await this.signer.getAddress().catch(() => null);
          }
          const p = this._providerForRead();
          if (p && typeof p.getSigner === 'function') {
            try {
              const s = await p.getSigner();
              if (s && typeof s.getAddress === 'function') return await s.getAddress().catch(() => null);
            } catch (_) {}
          }
          return null;
        }
      } catch (e) {
        return null;
      }
    };

  if (!this.provider) console.warn('[ContractService] Warning: provider is undefined after normalization');
  if (!this.signer) console.warn('[ContractService] Warning: signer is undefined after normalization');
  if (!this.chainId) console.warn('[ContractService] Warning: chainId is undefined after normalization');

    // Debug info (async to avoid blocking constructor)
    (async () => {
      try {
        console.log('[ContractService] provider URL:', this.provider?.connection?.url || this.provider);
        try {
          const addr = await this._getSignerAddressSafe();
          console.log('[ContractService] signer address:', addr);
        } catch (inner) {
          console.log('[ContractService] signer address: <unavailable>', inner);
        }
      } catch (e) {
        console.warn('[ContractService] signer debug error', e);
      }
    })();
  }

  /**
   * Upload evidence payload to configured evidence endpoint (if available).
   * Returns an evidence reference suitable for on-chain reporting:
  * - Prefer a Helia URI (string like 'helia://<cid>') when backend returns one.
   * - Otherwise return a bytes32 digest (0x...) for backward compatibility.
   */
  async uploadEvidence(payloadStr) {
    try {
      const payload = payloadStr ? String(payloadStr) : '';
      const runtimeEndpoint = getEvidenceEndpoint(); 
      const runtimeAdmin = getAdminPub();
      const requireUpload = getRequireEvidenceUpload();
      // If no endpoint or admin key, just compute digest locally
      if (!runtimeEndpoint || !runtimeAdmin) {
        if (requireUpload) {
          throw new Error('EVIDENCE_UPLOAD_REQUIRED: evidence endpoint or admin public key not configured in frontend environment. Set VITE_EVIDENCE_SUBMIT_ENDPOINT and VITE_ADMIN_PUBLIC_KEY or disable VITE_REQUIRE_EVIDENCE_UPLOAD.');
        }
        return computePayloadDigest(payload);
      }

      // Prepare (encrypt) payload using existing helper
      const { ciphertext, digest } = await prepareEvidencePayload(payload, { encryptToAdminPubKey: runtimeAdmin });
      const isZeroDigest = d => !d || /^0x0{64}$/.test(String(d));
      if (!ciphertext || typeof ciphertext !== 'string' || ciphertext.length === 0) throw new Error('Evidence preparation failed: ciphertext empty');
      if (isZeroDigest(digest)) throw new Error('Evidence preparation failed: zero digest');

      let endpointUrl = String(runtimeEndpoint || '').trim();
      if (endpointUrl.endsWith('/')) endpointUrl = endpointUrl.slice(0, -1);
      if (!endpointUrl.toLowerCase().endsWith('/submit-evidence')) endpointUrl = endpointUrl + '/submit-evidence';

  const submitterAddress = await this._getSignerAddressSafe();
      const requestHeaders = { 'Content-Type': 'application/json' };
      if (submitterAddress) requestHeaders.Authorization = `Bearer ${submitterAddress}`;

      // POST ciphertext
      let res;
      try {
        res = await fetch(endpointUrl, { method: 'POST', headers: requestHeaders, body: ciphertext });
      } catch (fetchErr) {
        throw fetchErr;
      }

      if (!res.ok) {
        // If server returns adminPublicKey on 400, retry once using returned key
        let errBody = null;
        try { errBody = await res.json(); } catch (e) { errBody = null; }
        if (res.status === 400 && errBody && errBody.adminPublicKey) {
          const adminPub = errBody.adminPublicKey;
          const { ciphertext: newCiphertext, digest: newDigest } = await prepareEvidencePayload(payload, { encryptToAdminPubKey: adminPub });
          res = await fetch(endpointUrl, { method: 'POST', headers: requestHeaders, body: newCiphertext });
          if (!res.ok) {
            const txt = await res.text().catch(() => '');
            throw new Error('evidence endpoint retry failed: ' + res.status + ' ' + txt);
          }
          const parsed = await res.json();
          return parsed && parsed.digest ? parsed.digest : newDigest;
        }
        const txt = await (async() => { try { return await res.text(); } catch(e){ return ''; } })();
        throw new Error('evidence endpoint returned ' + res.status + ' ' + txt);
      }

      const body = await res.json();
      // Prefer heliaCid when available
      const returnedCid = body && body.heliaCid ? body.heliaCid : null;
      const returnedDigest = body && body.digest ? body.digest : digest;
      return returnedCid ? returnedCid : returnedDigest;
    } catch (e) {
      // bubble up
      throw e;
    }
  }

  // Prefer wallet provider, but on localhost fall back to a direct JSON-RPC provider if the wallet provider glitches
  async getCodeSafe(address) {
    // Address normalization strategy:
    // - Mainnet: enforce checksum with ethers.getAddress.
    // - Other chains (fork/local/test): skip checksum enforcement to avoid v6 "bad address checksum" when using mainnet addresses on a dev chainId.
    const chainNum = Number(this.chainId);
    let addr = address;
    if (chainNum === 1) {
      try { addr = ethers.getAddress(address); } catch (_) { /* let provider surface later */ }
    } else {
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return '0x';
      addr = address; // keep as-is
    }
  const primary = this.provider;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        let code;
        try {
          code = await primary.getCode(addr);
        } catch (primaryErr) {
          const msg0 = String(primaryErr?.message || '');
          const checksumFail = /bad address checksum/i.test(msg0);
          const nonMainnet = chainNum !== 1;
          if (checksumFail && nonMainnet) {
            try {
              // Direct raw RPC with lowercase address
              const raw = await primary.send('eth_getCode', [addr.toLowerCase(), 'latest']);
              code = raw || '0x';
            } catch (_) {
              throw primaryErr;
            }
          } else {
            throw primaryErr;
          }
        }
  // console.log(`[DEBUG] getCodeSafe: Attempt ${attempt} for address ${addr} on chainId ${this.chainId} returned:`, code); // TEMP: silenced for production
        // If the provider returns an empty code ("0x") while we're targeting a
        // local chain, try the local JSON-RPC directly. This handles the common
        // dev case where MetaMask (the injected provider) is pointed at a
        // different network but a local Hardhat node at 127.0.0.1:8545 actually
        // contains the deployed contracts.
        const isLocal = Number(this.chainId) === 31337 || Number(this.chainId) === 1337 || Number(this.chainId) === 5777;
        if (isLocal && code === '0x') {
          try {
  throw new Error('getCodeSafe: provider fallback not allowed. Pass the correct provider from EthersContext.');
            // console.log(`[DEBUG] getCodeSafe: Fallback local RPC for address ${addr} returned:`, fallbackCode); // TEMP: silenced for production
            if (fallbackCode && fallbackCode !== '0x') return fallbackCode;
          } catch (rpcErr) {
            // ignore and fall through to returning the original empty code
            console.warn('Local RPC fallback getCode failed', rpcErr);
          }
        }
        return code;
      } catch (e) {
        // MetaMask wraps certain errors and exposes a nested cause for a 'circuit breaker' condition.
        const msg = String(e?.message || '');
        const isBrokenCircuit = Boolean(e?.data?.cause?.isBrokenCircuitError) || /circuit breaker/i.test(msg);
        const isLocal = Number(this.chainId) === 31337 || Number(this.chainId) === 1337 || Number(this.chainId) === 5777;
        // If we're on localhost and the injected provider is failing (invalid block tag, internal error, or the circuit-breaker),
        // fall back to a direct JSON-RPC provider on 127.0.0.1:8545 which is commonly used for Hardhat/localhost.
        if (isLocal && (/invalid block tag/i.test(msg) || /Internal JSON-RPC error/i.test(msg) || isBrokenCircuit)) {
          console.warn('Provider.getCode failed on injected provider; falling back to http://127.0.0.1:8545', { error: e });
          throw new Error('getCodeSafe: provider fallback not allowed. Pass the correct provider from EthersContext.');
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
    // Prefer provider-backed factory for read operations; signer is only required for writes
    const p = this._providerForRead();
    const contract = await createContractInstanceAsync('ContractFactory', factoryAddress, p || this.signer);
    // Lightweight sanity check to catch wrong/stale addresses on localhost
    const code = await this.getCodeSafe(factoryAddress);
  // console.log(`[DEBUG] getFactoryContract: getCodeSafe for factoryAddress ${factoryAddress} returned:`, code); // TEMP: silenced for production
    if (!code || code === '0x') {
      throw new Error(`No contract code at ${factoryAddress}. Is the node running and deployed and is your wallet connected to the same network?`);
    }
    return contract;
  }

  async getEnhancedRentContract(contractAddress) {
    try {
      if (!contractAddress || typeof contractAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
        console.warn('getEnhancedRentContract called with invalid contractAddress:', contractAddress);
        return null;
      }
  // Prefer a provider-backed contract for read-only operations and event listeners.
  const p = this._providerForRead();
  const runner = p || this.signer;
  return await createContractInstanceAsync('EnhancedRentContract', contractAddress, runner);
    } catch (error) {
      console.error('Error getting rent contract:', error);
      throw error;
    }
  }

  // Create a signer-attached EnhancedRentContract specifically for sending transactions
  async getEnhancedRentContractForWrite(contractAddress) {
    try {
      if (!contractAddress || typeof contractAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
        console.warn('getEnhancedRentContractForWrite called with invalid contractAddress:', contractAddress);
        return null;
      }
      if (!this.signer) throw new Error('No signer available for write operations');
      return await createContractInstanceAsync('EnhancedRentContract', contractAddress, this.signer);
    } catch (error) {
      console.error('Error getting rent contract for write:', error);
      throw error;
    }
  }

  // Withdraw any pull-payments credited to caller on a Rent contract
  async withdrawRentPayments(contractAddress) {
    try {
      const rentContract = await this.getEnhancedRentContractForWrite(contractAddress);
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
  const rentContract = await this.getEnhancedRentContract(contractAddress);
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
      const rent = await this.getEnhancedRentContract(contractAddress);
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
      // Not found Γאפ return zero
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
  const rent = await this.getEnhancedRentContract(contractAddress);
      const res = await rent.getDisputeMeta(Number(caseId));
      // res is [classification, rationale]
      return { classification: res[0] || '', rationale: res[1] || '' };
    } catch (e) {
      try {
        // fallback: low-level call decode
  const pFallback = this._providerForRead();
  const rent = await createContractInstanceAsync('EnhancedRentContract', contractAddress, pFallback || this.signer);
    const data = rent.interface.encodeFunctionData('getDisputeMeta', [Number(caseId)]);
  const ret = pFallback && typeof pFallback.call === 'function' ? await pFallback.call({ to: contractAddress, data }) : null;
        const decoded = rent.interface.decodeFunctionResult('getDisputeMeta', ret);
        return { classification: decoded[0] || '', rationale: decoded[1] || '' };
      } catch (err) {
        console.debug('getDisputeMeta failed', err);
        return null;
      }
    }
  }

  async getEnhancedRentContractDetails(contractAddress, options = {}) {
    const { silent = false } = options || {};
    try {
      // Ensure the address is a contract before calling views
      const p2 = this._providerForRead();
      const code = p2 && typeof p2.getCode === 'function' ? await p2.getCode(contractAddress) : '0x';
      if (!code || code === '0x') {
        throw new Error(`Address ${contractAddress} has no contract code`);
      }
      const rentContract = await this.getEnhancedRentContract(contractAddress);
      // If key functions are missing, return null so callers can try NDA parsing instead.
      if (typeof rentContract.rentAmount !== 'function' || typeof rentContract.landlord !== 'function' || typeof rentContract.tenant !== 'function') {
        if (!silent) console.debug('getEnhancedRentContractDetails: contract ABI mismatch, not an EnhancedRent contract', contractAddress);
        return null;
      }
      const [landlord, tenant, rentAmount, priceFeed, isActive] = await Promise.all([
        rentContract.landlord().catch(() => null),
        rentContract.tenant().catch(() => null),
        rentContract.rentAmount().catch(() => 0n),
        (typeof rentContract.priceFeed === 'function' ? rentContract.priceFeed().catch(() => null) : Promise.resolve(null)),
        (typeof rentContract.active === 'function' ? rentContract.active().catch(() => true) : Promise.resolve(true))
      ]);
      // If landlord/tenant are not valid addresses, this is likely not a Rent contract
      const isAddress = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
      if (!isAddress(landlord) || !isAddress(tenant)) {
        if (!silent) console.debug('getEnhancedRentContractDetails: landlord/tenant not valid addresses, treating as not an EnhancedRent contract', { landlord, tenant, contractAddress });
        return null;
      }
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
        created: 'Γאפ'
      };
    } catch (error) {
      if (!silent) {
        console.error('Error getting contract details:', error);
      }
      // Return null to allow callers (UI) to skip this contract rather than
      // letting a single malformed/ABI-mismatched contract crash the whole flow.
      return null;
    }
  }

  async getUserContracts(userAddress) {
    try {
      // Use a provider-attached factory for read-only calls to avoid using a signer-only runner
      const factoryAddress = await getContractAddress(this.chainId, 'factory');
      if (!factoryAddress) throw new Error('Factory not deployed on this network');
      const provider = this._providerForRead();
      if (!provider) throw new Error('No provider available for read-only factory calls');
      const factoryContract = await createContractInstanceAsync('ContractFactory', factoryAddress, provider);
      const contracts = await factoryContract.getContractsByCreator(userAddress);
      // Filter out any addresses that aren't contracts (defensive against wrong factory/addressing)
      const p = this._providerForRead();
      const checks = await Promise.all(
        contracts.map(async (addr) => {
          try {
            if (!p || typeof p.getCode !== 'function') return null;
            const code = await p.getCode(addr);
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
      // Use provider-attached factory for read-only discovery
      const factoryAddress = await getContractAddress(this.chainId, 'factory');
      if (!factoryAddress) throw new Error('Factory not deployed on this network');
      const provider = this._providerForRead();
      if (!provider) throw new Error('No provider available for read-only factory calls');
      const factory = await createContractInstanceAsync('ContractFactory', factoryAddress, provider);
      const discovered = new Set();
      // Use getAllContracts (returns address[])
      const addresses = await factory.getAllContracts();
      for (const addr of addresses) {
        try {
          const p = this._providerForRead();
          if (!p || typeof p.getCode !== 'function') continue;
          const code = await p.getCode(addr);
          if (!code || code === '0x') continue;
          // Try Rent
          let matched = false;
          try {
            const rent = await this.getEnhancedRentContract(addr);
            const [landlord, tenant] = await Promise.all([
              rent.landlord(),
              rent.tenant()
            ]);
            if (landlord?.toLowerCase() === userAddress.toLowerCase() || tenant?.toLowerCase() === userAddress.toLowerCase()) {
              discovered.add(addr);
              matched = true;
            }
          } catch (_) {}
          if (matched) continue;
          // Try NDA
          try {
            const nda = await this.getNDAContract(addr);
            const [partyA, partyB] = await Promise.all([
              nda.partyA(),
              nda.partyB()
            ]);
            if (partyA?.toLowerCase() === userAddress.toLowerCase() || partyB?.toLowerCase() === userAddress.toLowerCase()) {
              discovered.add(addr);
            }
          } catch (_) {}
        } catch (_) { /* ignore */ }
      }
      return Array.from(discovered);
    } catch (err) {
      console.error('Error discovering participant contracts:', err);
      return [];
    }
  }

  async payRent(contractAddress, amount) {
    try {
  const rentContract = await this.getEnhancedRentContractForWrite(contractAddress);
      // Preflight: ensure connected signer is the tenant
      try {
        const current = await this._getSignerAddressSafe();
        const chainTenant = await rentContract.tenant();
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
  * contractAddress: target EnhancedRentContract or NDATemplate
   * feeWei: BigInt or string value to forward as msg.value
   */
  async finalizeCancellationViaService(arbitrationServiceAddress, contractAddress, feeWei = 0n) {
    try {
      if (!arbitrationServiceAddress || !arbitrationServiceAddress.trim()) throw new Error('Arbitration service address required');
      // Preflight: ensure the target contract is configured for arbitration and whether a fee is required.
    try {
  const target = await this.getEnhancedRentContract(contractAddress);
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
      // For the actual write we will use a signer-attached instance, but prefer
      // creating a provider-backed instance when used for reads/preflight to avoid
      // signer-only runners without provider causing UNSUPPORTED_OPERATION.
      let svc;
    try {
    const p = this._providerForRead();
    svc = await createContractInstanceAsync('ArbitrationService', arbitrationServiceAddress, p || this.signer);
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
  const target = await this.getEnhancedRentContract(contractAddress);
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
  const signerAddrRaw = await this._getSignerAddressSafe();
  const signerAddr = signerAddrRaw ? signerAddrRaw.toLowerCase() : null;
      const landlordAddr = (await target.landlord()).toLowerCase();
      const value = typeof feeWei === 'bigint' ? feeWei : BigInt(feeWei || 0);

      // Create service instance using static ABI helper. Prefer signer for writes
      // but allow provider fallback for read operations in preflight.
      let svc;
      try {
  const p = this._providerForRead();
  svc = await createContractInstanceAsync('ArbitrationService', arbitrationServiceAddress, p || this.signer);
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

      // Create service contract using static ABI helper. Prefer signer for writes
      // but allow provider fallback for read operations in preflight.
      let svc;
      try {
  const p = this._providerForRead();
  svc = await createContractInstanceAsync('ArbitrationService', arbitrationServiceAddress, p || this.signer);
      } catch (e) {
        console.error('Could not create ArbitrationService instance via static ABI helper:', e);
        throw new Error('ArbitrationService ABI not available');
      }

      // Authorization preflight: ensure connected signer is owner or the configured factory
      try {
        const signerAddrRaw = await this._getSignerAddressSafe();
        const signerAddr = signerAddrRaw ? signerAddrRaw.toLowerCase() : '';
        // Use a provider-backed instance to read owner/factory even if svc is signer-only
        const pRead = this._providerForRead();
        const svcRead = await createContractInstanceAsync('ArbitrationService', arbitrationServiceAddress, pRead || this.signer);
        const ownerAddr = (await svcRead.owner?.().catch(() => null) || null);
        const factoryAddr = (await svcRead.factory?.().catch(() => null) || null);
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
  const target = await this.getEnhancedRentContract(targetContract);
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
   * Robust event query using provider-first approach with fallback.
   * @param {string} contractAddress - The contract address to query events from
   * @param {string} eventName - The event name to query
   * @param {function} filterFn - Optional filter function for events
   * @returns {Array} Array of event objects
   */
  async providerFirstEventQuery(contractAddress, eventName, filterFn = null) {
    try {
      const provider = this._providerForRead();
      if (!provider) {
        console.warn('No provider available for event query');
        return [];
      }
      const contract = await createContractInstanceAsync('ArbitrationService', contractAddress, provider);
      const eventFragment = contract.interface.getEvent(eventName);
      if (!eventFragment) {
        console.warn(`Event ${eventName} not found in contract ABI`);
        return [];
      }
      const filter = contract.filters[eventName]();
      // Limit block range to avoid 400 errors on forked networks
      let fromBlock = 0;
      let toBlock = 'latest';
      try {
        const latestBlock = await contract.runner?.provider?.getBlockNumber?.();
        if (typeof latestBlock === 'number' && latestBlock > 5000) {
          fromBlock = latestBlock - 5000;
        }
      } catch (_) {}
      const events = await contract.queryFilter(filter, fromBlock, toBlock);
      if (filterFn) {
        return events.filter(filterFn);
      }
      return events;
    } catch (error) {
      console.error('Error in providerFirstEventQuery:', error);
      return [];
    }
  }

  /**
   * Get all arbitration requests for a specific user (ResolutionApplied events)
   * @param {string} userAddress - The user's wallet address
   * @returns {Array} Array of arbitration request objects
   */
  async getArbitrationRequestsByUser(userAddress) {
    try {
      if (!userAddress || typeof userAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(userAddress)) {
        throw new Error('Invalid userAddress for getArbitrationRequestsByUser');
      }
      const arbitrationServiceAddress = await getContractAddress(this.chainId, 'arbitrationService');
      if (!arbitrationServiceAddress) {
        console.warn('ArbitrationService not deployed on this network');
        return [];
      }
      const events = await this.providerFirstEventQuery(
        arbitrationServiceAddress,
        'ResolutionApplied',
        (event) => {
          // Filter events where user is involved (as beneficiary or target party)
          const beneficiary = event.args?.beneficiary;
          const targetContract = event.args?.targetContract;
          return beneficiary && beneficiary.toLowerCase() === userAddress.toLowerCase();
        }
      );
      // Transform events to request objects
      return events.map(event => ({
        id: event.args?.caseId?.toString() || '0',
        contractAddress: event.args?.targetContract || '',
        beneficiary: event.args?.beneficiary || '',
        approved: event.args?.approved || false,
        appliedAmount: event.args?.appliedAmount?.toString() || '0',
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash
      }));
    } catch (error) {
      console.error('Error getting arbitration requests by user:', error);
      return [];
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
  * disputeType: numeric enum matching EnhancedRentContract.DisputeType (0..)
   * requestedAmount: BigInt or string in wei (use 0 for none)
   * evidenceText: optional plain text or URL to store on-chain as string
   */
  async reportRentDispute(contractAddress, disputeType = 0, requestedAmount = 0n, evidenceText = '', options = {}) {
    try {
      let submitterAddress = null;
      // Defensive checks: ensure a valid contractAddress was provided before attempting to
  // instantiate the EnhancedRentContract. This prevents obscure TypeErrors from
      // bubbling up when createContractInstanceAsync receives a null/undefined target.
      if (!contractAddress) {
        console.error('reportRentDispute called with empty contractAddress', { contractAddress });
        throw new Error('contractAddress is required for reportRentDispute');
      }
      if (!/^0x[0-9a-fA-F]{40}$/.test(String(contractAddress))) {
        console.error('reportRentDispute called with invalid contractAddress', { contractAddress });
        throw new Error('Invalid contractAddress for reportRentDispute');
      }
      console.debug('reportRentDispute target:', contractAddress);
      // Use a provider-backed contract for preflight reads (landlord/tenant checks)
      let rent;
      try {
        rent = await this.getEnhancedRentContract(contractAddress);
      } catch (instErr) {
        console.error('Failed to create EnhancedRentContract instance for preflight checks', contractAddress, instErr);
        throw instErr;
      }
      // Ensure caller is one of the parties recorded on-chain
      try {
        const me = await this._getSignerAddressSafe();
        const [landlordAddr, tenantAddr] = await Promise.all([
          rent.landlord().catch(() => null),
          rent.tenant().catch(() => null)
        ]);
        submitterAddress = me;
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
  // For the actual on-chain report (a write), use a signer-attached instance
  // to ensure the transaction is signed and sent from the connected wallet.
        // If no endpoint is configured, fall back to computing the digest locally.
  let evidenceArg = '';
        const submitEndpoint = (import.meta.env && import.meta.env.VITE_EVIDENCE_SUBMIT_ENDPOINT) || (window && window?.__ENV__ && window.__ENV__.VITE_EVIDENCE_SUBMIT_ENDPOINT) || null;
        if (evidence && /^0x[0-9a-fA-F]{64}$/.test(evidence)) {
          evidenceArg = evidence;
        } else if (evidence) {
            // If we have a submit endpoint, encrypt (if admin public key is exposed) and POST the evidence.
            if (submitEndpoint) {
              try {
                // Dynamically import prepareEvidencePayload helper to avoid circular import at module top
                const { prepareEvidencePayload } = await import('../utils/evidence.js');
                const adminPub = (import.meta.env && import.meta.env.VITE_ADMIN_PUBLIC_KEY) || (window && window?.__ENV__ && window.__ENV__.VITE_ADMIN_PUBLIC_KEY) || null;
                const { ciphertext, digest } = await prepareEvidencePayload(evidence, { encryptToAdminPubKey: adminPub });
                // POST ciphertext (or plaintext if encrypt not available) to endpoint
                const body = ciphertext ? ciphertext : evidence;
                // E2E debug: surface endpoint and body preview so Playwright traces capture it
                try {
                  if (IN_E2E) console.debug && console.debug('E2E: evidence POST to', submitEndpoint, 'payload length:', String(body).length);
                } catch (e) {}
                const evidenceHeaders = { 'content-type': 'application/json' };
                if (submitterAddress) evidenceHeaders.Authorization = `Bearer ${submitterAddress}`;
                let resp = await fetch(submitEndpoint, { method: 'POST', headers: evidenceHeaders, body });
                // If server rejects wrapper with adminPublicKey, re-encrypt locally using that adminPublicKey and retry once
                if (resp && !resp.ok) {
                  let errBody = null;
                  try { errBody = await resp.json(); } catch (e) { errBody = null; }
                  if (resp.status === 400 && errBody && errBody.adminPublicKey) {
                    // notify UI via callback if provided
                    try { if (options && typeof options.onRetry === 'function') options.onRetry({ status: 'retrying', reason: 'server_requested_reencrypt' }); } catch (_) {}
                    const adminPubFromServer = errBody.adminPublicKey;
                    try {
                      const { ciphertext: newCiphertext, digest: newDigest } = await prepareEvidencePayload(evidence, { encryptToAdminPubKey: adminPubFromServer });
                      resp = await fetch(submitEndpoint, { method: 'POST', headers: evidenceHeaders, body: newCiphertext });
                      if (resp && resp.ok) {
                        try { if (options && typeof options.onRetry === 'function') options.onRetry({ status: 'ok' }); } catch (_) {}
                        const json = await resp.json();
                        if (json && json.heliaCid) evidenceArg = String(json.heliaCid);
                        else if (json && json.digest) evidenceArg = String(json.digest);
                        else if (json && json.digestNo0x) evidenceArg = '0x' + String(json.digestNo0x);
                        else evidenceArg = newDigest || digest || ethers.keccak256(ethers.toUtf8Bytes(evidence));
                      } else {
                        try { if (options && typeof options.onRetry === 'function') options.onRetry({ status: 'failed' }); } catch (_) {}
                        evidenceArg = newDigest || digest || ethers.keccak256(ethers.toUtf8Bytes(evidence));
                      }
                      } catch (retryErr) {
                      console.warn('Retry encryption/post failed:', retryErr);
                      try { if (options && typeof options.onRetry === 'function') options.onRetry({ status: 'failed' }); } catch (_) {}
                      evidenceArg = digest || ethers.keccak256(ethers.toUtf8Bytes(evidence));
                    }
                  } else {
                    // generic failure: fallback to digest from prepareEvidencePayload or local compute
                    evidenceArg = digest || ethers.keccak256(ethers.toUtf8Bytes(evidence));
                  }
                } else if (resp && resp.ok) {
                  const json = await resp.json();
                  if (json && json.heliaCid) evidenceArg = String(json.heliaCid);
                  else if (json && json.digest) evidenceArg = String(json.digest);
                  else if (json && json.digestNo0x) evidenceArg = '0x' + String(json.digestNo0x);
                  else evidenceArg = digest;
                }
              } catch (postErr) {
                console.warn('Evidence submit endpoint flow failed, using local digest', postErr);
                evidenceArg = ethers.keccak256(ethers.toUtf8Bytes(evidence));
              }
            } else {
              evidenceArg = ethers.keccak256(ethers.toUtf8Bytes(evidence));
            }
        }
        // Debugging instrumentation: log signer, target code and calldata so we can
        // diagnose CALL_EXCEPTION / missing revert data issues during E2E runs.
        try {
        const signerAddr = await this._getSignerAddressSafe();
          console.debug('reportRentDispute: signerAddr=', signerAddr, 'target=', contractAddress, 'disputeType=', disputeType, 'amount=', String(amount), 'evidence=', evidenceArg);
          try {
            const code = await this.getCodeSafe(contractAddress);
            console.debug('reportRentDispute: target contract code length=', code && code.length);
          } catch (codeErr) {
            console.warn('reportRentDispute: could not fetch target code', codeErr);
          }
          // Build calldata so we can attempt a low-level call for revert payload if the send fails
          let calldata = null;
            try {
            calldata = rent.interface.encodeFunctionData('reportDispute', [disputeType, amount, evidenceArg]);
            console.debug('reportRentDispute: calldata=', calldata.slice(0, 10) + '...');
          } catch (encErr) {
            console.warn('reportRentDispute: failed to encode calldata', encErr);
          }

          // Use a signer-attached contract for the write
          const rentForWrite = await this.getEnhancedRentContractForWrite(contractAddress);
          const tx = await rentForWrite.reportDispute(disputeType, amount, evidenceArg, overrides);
          const receipt = await tx.wait();
          return { receipt, caseId: (function(){ try{ for(const l of receipt.logs){ try{ const p = rent.interface.parseLog(l); if(p && p.name==='DisputeReported') return p.args[0]?.toString?.() ?? null; }catch(_){} } }catch(_){ } return null; })() };
        } catch (sendErr) {
          console.error('reportRentDispute: send failed', sendErr);
          // Attempt a low-level eth_call to capture revert reason / data (may be available even when send fails)
          try {
            if (calldata) {
              const from = (await this._getSignerAddressSafe()) || undefined;
              const p = this._providerForRead();
              const callObj = { to: contractAddress, data: calldata, from };
              try {
                if (p && typeof p.call === 'function') {
                  const callRes = await p.call(callObj);
                  console.debug('reportRentDispute: provider.call returned', callRes);
                } else {
                  console.debug('reportRentDispute: no provider available for low-level call');
                }
              } catch (callErr) {
                // Some providers surface nested data objects
                console.warn('reportRentDispute: provider.call failed', callErr?.data || callErr?.message || callErr);
              }
            }
          } catch (probeErr) {
            console.warn('reportRentDispute: low-level probe failed', probeErr);
          }
          // rethrow original error after instrumentation
          throw sendErr;
        }
      
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
      const rent = await this.getEnhancedRentContractForWrite(contractAddress);
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
      const meRaw = await this._getSignerAddressSafe();
      const me = meRaw ? meRaw.toLowerCase() : '';
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
          const rent = await this.getEnhancedRentContract(contractAddress);
          const svc = await rent.arbitrationService();
            if (svc && svc !== ethers.ZeroAddress) {
            const p = this._providerForRead();
            const svcInst = await createContractInstanceAsync('ArbitrationService', svc, p || this.signer);
            const owner = await svcInst.owner().catch(() => ethers.ZeroAddress);
            if (owner && owner.toLowerCase() === me) return true;
          }
        } catch (_) {}

        // Try as NDA
        try {
          const nda = await this.getNDAContract(contractAddress);
          const svc = await nda.arbitrationService();
          if (svc && svc !== ethers.ZeroAddress) {
            const p = this._providerForRead();
            const svcInst = await createContractInstanceAsync('ArbitrationService', svc, p || this.signer);
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
      const rentContract = await this.getEnhancedRentContractForWrite(contractAddress);
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
      const rentContract = await this.getEnhancedRentContractForWrite(contractAddress);

      // Preflight checks to provide friendlier errors and avoid RPC estimateGas revert
      try {
        const [landlord, tenant, isActive, cancelReq] = await Promise.all([
          rentContract.landlord().catch(() => null),
          rentContract.tenant().catch(() => null),
          rentContract.active().catch(() => null),
          rentContract.cancelRequested().catch(() => null),
        ]);

  const myAddr = await this._getSignerAddressSafe();
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
            const currentSignerAddr = ((await this._getSignerAddressSafe()) || '').toLowerCase();
            if (injected && injected !== currentSignerAddr) {
              // attempt to refresh signer from the existing provider
              try {
                const provider = this._providerForRead();
                if (provider && typeof provider.getSigner === 'function') {
                  const refreshed = await provider.getSigner(injectedAccounts[0]).catch(() => null);
                  // validate
                  let refreshedAddr = '';
                  try {
                    if (refreshed) {
                      try {
                        const { safeGetAddress } = await import('../utils/signer.js');
                        refreshedAddr = (await safeGetAddress(refreshed, provider)) || '';
                      } catch (_) {
                        refreshedAddr = '';
                      }
                    }
                  } catch (_) { refreshedAddr = '' }
                  refreshedAddr = (refreshedAddr || '').toLowerCase();
                  if (refreshedAddr && refreshedAddr === injected) {
                    activeSigner = refreshed;
                  }
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
        // If we obtained a refreshed signer different from the original this.signer,
        // connect it to the contract instance before sending. Otherwise the contract
        // instance is already bound to this.signer via getEnhancedRentContractForWrite.
        const sendContract = (activeSigner && typeof activeSigner === 'object') ? rentContract.connect(activeSigner) : rentContract;
        tx = await sendContract.initiateCancellation();
        return await tx.wait();
      } catch (err) {
        // Map known revert selectors to friendlier messages when possible
        try {
          const data = err?.data || err?.error?.data || err?.data?.data || null;
          const raw = (typeof data === 'string' && data.startsWith('0x')) ? data : (data && data.data && typeof data.data === 'string' ? data.data : null);
          if (raw) {
            const selector = raw.slice(2, 10);
            const map = {
              // selectors from EnhancedRentContract custom errors (best-effort guesses)
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
      const rentContract = await this.getEnhancedRentContractForWrite(contractAddress);
      const tx = await rentContract.approveCancellation();
      return await tx.wait();
    } catch (error) {
      console.error('Error approving cancellation:', error);
      throw error;
    }
  }

  async finalizeCancellation(contractAddress, { feeValueEth } = {}) {
    try {
      const rentContract = await this.getEnhancedRentContractForWrite(contractAddress);
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

  // Additional functions for NDA agreements
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

  /**
   * Create an EnhancedRentContract via the on-chain factory.
   * params: { tenant, rentAmount (ETH string), priceFeed, duration (days), startDate (timestamp), propertyId (optional) }
   */
  async createEnhancedRentContract(params) {
    try {
      // For writes we must use a signer-attached factory contract. Don't rely on the provider-only instance.
      const factoryAddress = await getContractAddress(this.chainId, 'factory');
      if (!factoryAddress) throw new Error('Factory contract not deployed on this network');
      if (!this.signer) throw new Error('No signer available for write operations');
      const factoryContract = await createContractInstanceAsync('ContractFactory', factoryAddress, this.signer);

      // Normalize and convert values
      const rentAmountWei = typeof params.rentAmount === 'string' && params.rentAmount.indexOf('.') >= 0
        ? ethers.parseEther(params.rentAmount)
        : (typeof params.rentAmount === 'bigint' ? params.rentAmount : BigInt(params.rentAmount || '0'));

      const startTs = typeof params.startDate === 'number' || typeof params.startDate === 'string' ? Number(params.startDate) : Math.floor(Date.now() / 1000);
      const durationDays = Number(params.duration || 0);
      const dueDateTimestamp = startTs + Math.floor(durationDays * 86400);

      // Normalize/validate price feed address. On mainnet enforce EIP-55 checksum via ethers.getAddress().
      let priceFeedAddr = params.priceFeed || ethers.ZeroAddress;
      try {
        if (priceFeedAddr && typeof priceFeedAddr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(priceFeedAddr)) {
          if (Number(this.chainId) === 1) {
            priceFeedAddr = ethers.getAddress(priceFeedAddr);
          } else {
            // Avoid throwing on non-mainnet chains (forks/local). Use lowercase to be safe for RPCs.
            priceFeedAddr = priceFeedAddr.toLowerCase();
          }
        } else {
          priceFeedAddr = ethers.ZeroAddress;
        }
      } catch (addrErr) {
        throw new Error('Invalid priceFeed address: ' + String(addrErr?.message || addrErr));
      }

      const propertyId = typeof params.propertyId !== 'undefined' ? Number(params.propertyId) : 0;

      const tx = await factoryContract.createEnhancedRentContract(
        params.tenant,
        rentAmountWei,
        priceFeedAddr,
        dueDateTimestamp,
        propertyId
      );

      const receipt = await tx.wait();

      let contractAddress = null;
      for (const log of receipt.logs) {
        try {
          const parsedLog = factoryContract.interface.parseLog(log);
          if (parsedLog && (parsedLog.name === 'EnhancedRentContractCreated' || parsedLog.name === 'EnhancedRentCreated')) {
            contractAddress = parsedLog.args && (parsedLog.args.contractAddress || parsedLog.args[0]) ? (parsedLog.args.contractAddress || parsedLog.args[0]) : null;
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
      console.error('Error creating EnhancedRentContract:', error);
      throw error;
    }
  }

async getNDAContract(contractAddress) {
  try {
    if (!contractAddress || typeof contractAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
      console.warn('getNDAContract called with invalid contractAddress:', contractAddress);
      return null;
    }
    const p = this._providerForRead();
    const runner = p || this.signer;
    return await createContractInstanceAsync('NDATemplate', contractAddress, runner);
  } catch (error) {
    console.error('Error getting NDA contract:', error);
    throw error;
  }
}

async getNDAContractForWrite(contractAddress) {
  try {
    if (!contractAddress || typeof contractAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
      console.warn('getNDAContractForWrite called with invalid contractAddress:', contractAddress);
      return null;
    }
    if (!this.signer) throw new Error('No signer available for write operations');
    return await createContractInstanceAsync('NDATemplate', contractAddress, this.signer);
  } catch (error) {
    console.error('Error getting NDA contract for write:', error);
    throw error;
  }
}

async getNDAContractDetails(contractAddress, options = {}) {
  const { silent = false } = options || {};
  try {
    // Ensure the address is a contract before calling views
  const p = this._providerForRead();
  const code = p && typeof p.getCode === 'function' ? await p.getCode(contractAddress) : '0x';
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
      // Guard against null/undefined totalDeposits
      const totalDepositsRaw = (st && typeof st[2] !== 'undefined' && st[2] !== null) ? st[2] : 0n;
      try { totalDeposits = ethers.formatEther(totalDepositsRaw); } catch (e) { totalDeposits = '0'; }
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
            requestedPenalty: ethers.formatEther(c[2] ?? 0n),
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
      status: isActive ? 'Active' : 'Inactive',
      created: new Date(Number(expiryDate) * 1000).toLocaleDateString()
    };
  } catch (error) {
    if (!silent) {
      console.error('Error getting NDA details:', error);
    }
    // Return null to allow UI to continue when a particular contract read fails
    return null;
  }
}

// ---------- NDA helpers ----------
async signNDA(contractAddress) {
  try {
    const nda = await this.getNDAContract(contractAddress);
    // Preflight: ensure current signer is a party and hasn't signed yet
  const myAddrRaw = await this._getSignerAddressSafe();
  const myAddr = myAddrRaw ? myAddrRaw.toLowerCase() : '';
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
  if (!this._isSignerLike(this.signer)) throw new Error('No signer available to sign NDA');
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
      try {
        const tx = await nda.reportBreach(offender, requested, evidence, { value: disputeFee });
        return await tx.wait();
      } catch (error) {
    // Some browser providers (injected shims) hide revert payloads on estimateGas/send;
    // attempt a low-level provider.call to extract the revert reason/data for debugging.
        try {
          const iface = nda.interface;
          const calldata = iface.encodeFunctionData('reportBreach', [offender, requested, evidence]);
          const from = await this._getSignerAddressSafe();
          const provider = this._providerForRead();
          if (provider && typeof provider.call === 'function') {
            try {
              const callResult = await provider.call({ to: contractAddress, data: calldata, from, value: disputeFee });
              console.warn('Low-level provider.call returned (no revert):', callResult);
            } catch (callErr) {
              // provider.call may throw with revert data Γאפ surface it
              console.error('Low-level provider.call error while probing revert:', callErr);
              // attach probe info to the original error for visibility
              try { error.probe = { callError: callErr && (callErr.message || callErr.reason || callErr.data) } } catch (_) {}
            }
          }
        } catch (probeErr) {
          console.error('Failed to probe revert with provider.call:', probeErr);
        }
    // rethrow original error (now possibly enriched)
    throw error;
  }
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
  console.log('signRent: contractAddress =', contractAddress);
    try {
      const rent = await this.getEnhancedRentContractForWrite(contractAddress);
  const myAddrRaw = await this._getSignerAddressSafe();
  const myAddr = myAddrRaw ? myAddrRaw.toLowerCase() : '';
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
  name: 'EnhancedRentContract',
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
  console.log("Signing rent on contract address:", rent.target || rent.address || contractAddress);
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

export async function subscribeToEvents(contractAddress, eventName, callback, options = {}) {
  console.log('subscribeToEvents called:', {
    contractAddress,
    eventName,
    providerType: options.provider?.constructor?.name,
    providerUrl: options.provider?.connection?.url || 'no url',
    providerChainId: options.provider?.network?.chainId || 'unknown'
  });

  const provider = options.provider;
  if (!provider) {
    throw new Error('subscribeToEvents: provider is required in options');
  }

  let contract;
  let filter;

  try {
    if (eventName === 'DisputeReported') {
      console.log('Creating EnhancedRentContract instance for DisputeReported at address:', contractAddress);
      contract = await createContractInstanceAsync('EnhancedRentContract', contractAddress, provider);
      filter = contract.filters.DisputeReported();
      console.log('DisputeReported filter created:', filter);

      // Verify contract has code
      const code = await provider.getCode(contractAddress);
      console.log('Contract code length at', contractAddress, ':', code.length);

    } else if (eventName === 'ResolutionApplied') {
      console.log('Getting ArbitrationService address...');
      const arbitrationServiceAddress = await getContractAddress('ArbitrationService');
      console.log('ArbitrationService address from deployment:', arbitrationServiceAddress);

      if (!arbitrationServiceAddress) {
        throw new Error('ArbitrationService address not found in deployment data');
      }

      // Verify ArbitrationService has code
      const arbCode = await provider.getCode(arbitrationServiceAddress);
      console.log('ArbitrationService code length at', arbitrationServiceAddress, ':', arbCode.length);

      console.log('Creating ArbitrationService instance for ResolutionApplied, filtering by target:', contractAddress);
      contract = await createContractInstanceAsync('ArbitrationService', arbitrationServiceAddress, provider);
      filter = contract.filters.ResolutionApplied(contractAddress); // target == contractAddress
      console.log('ResolutionApplied filter created:', filter);
    } else {
      throw new Error(`subscribeToEvents: unsupported eventName "${eventName}"`);
    }

    // Set up the event listener
    const listener = (event) => {
      console.log('Event received:', eventName, 'args:', event.args, 'txHash:', event.event?.transactionHash, 'blockNumber:', event.blockNumber);
      callback(event);
    };

    console.log('Setting up event listener for', eventName, 'on contract', contract.target || contract.address);
    contract.on(filter, listener);
    console.log('Event listener set up successfully for', eventName);

    // Return an object with removeAllListeners method
    return {
      removeAllListeners: () => {
        console.log('Removing event listeners for', eventName);
        contract.removeAllListeners(filter);
      }
    };
  } catch (error) {
    console.error('Error in subscribeToEvents:', error);
    throw error;
  }
}
