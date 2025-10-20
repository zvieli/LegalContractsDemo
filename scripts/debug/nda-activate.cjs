#!/usr/bin/env node
// Automate NDA activation: sign by both parties and ensure deposits
// Usage: node scripts/debug/nda-activate.cjs

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const ndaHelpers = require('../utils/ndaHelpers.cjs');

// Robust typed-data signer helper (node-side)
async function signTypedDataNode(wallet, domain, types, value) {
  // Prefer ethers Wallet.signTypedData when available
  if (typeof wallet.signTypedData === 'function') {
    return await wallet.signTypedData(domain, types, value);
  }

  // ethers v5/v6 older helper
  if (typeof wallet._signTypedData === 'function') {
    return await wallet._signTypedData(domain, types, value);
  }

  // fallback: construct digest and sign
  try {
    const domainSeparator = ethers.TypedDataEncoder.hashDomain(domain);
    const hashStruct = ethers.TypedDataEncoder.hash(domain, types, value);
    const digest = ethers.keccak256(ethers.concat(["0x19", "0x01", domainSeparator, hashStruct]));
    // signDigest exists on Signer (ethers v6) or we can use signingKey.signDigest
    if (typeof wallet.signDigest === 'function') {
      return await wallet.signDigest(digest);
    }
    // last resort: use signingKey
    if (wallet._signingKey) {
      const sig = wallet._signingKey().signDigest(digest);
      return ethers.joinSignature(sig);
    }
  } catch (err) {
    throw new Error('Typed data signing not available in this environment: ' + (err && err.message));
  }

  throw new Error('No typed-data signing method available on Wallet');
}

async function readJson(p) {
  let s = fs.readFileSync(p, 'utf8');
  s = s.trim();
  // strip triple-backtick fences if present
  if (s.startsWith('```')) {
    const lines = s.split(/\r?\n/);
    if (lines[0].startsWith('```')) lines.shift();
    if (lines[lines.length - 1].startsWith('```')) lines.pop();
    s = lines.join('\n');
  }
  // Quick try
  try { return JSON.parse(s); } catch (e) {}

  // Fallback: find first balanced JSON object by scanning braces
  const start = s.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in ' + p);
  let depth = 0;
  let inString = false;
  let prevChar = '';
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' && prevChar !== '\\') {
      inString = !inString;
    }
    if (!inString) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth === 0) {
        const sub = s.slice(start, i + 1);
        try { return JSON.parse(sub); } catch (e2) {
          // continue to error out below
          console.error('Lenient parse failed for', p, 'error:', e2 && e2.message);
          console.error('Snippet preview:', sub.slice(0,200));
          throw e2;
        }
      }
    }
    prevChar = ch;
  }
  throw new Error('Failed to extract JSON object from ' + p);
}

function readWalletsTxt(workspaceRoot) {
  const p = path.join(workspaceRoot, 'WALLETS.txt');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}

async function getPrivateKeys(workspaceRoot) {
  const envA = process.env.E2E_PRIVATE_KEY || process.env.PRIVATE_KEY;
  const envB = process.env.E2E_OFFENDER_PRIVATE_KEY || process.env.E2E_SECONDARY_PRIVATE_KEY;
  const keys = [];
  if (envA) keys.push(envA.replace(/^0x/, ''));
  if (envB) keys.push(envB.replace(/^0x/, ''));
  if (keys.length >= 2) return keys.slice(0,2);

  // Parse WALLETS.txt for lines containing hex private keys
  const walletsFile = path.join(workspaceRoot, 'WALLETS.txt');
  if (fs.existsSync(walletsFile)) {
    const txt = fs.readFileSync(walletsFile, 'utf8');
    // Match 0x followed by 64 hex chars
    const matches = Array.from(txt.matchAll(/0x[a-fA-F0-9]{64}/g)).map(m=>m[0]);
    if (matches.length >= 2) {
      return matches.slice(0,2).map(k=>k.replace(/^0x/,''));
    }
  }

  const wallets = readWalletsTxt(workspaceRoot);
  if (wallets.length >= 2) {
    // try to find private keys inside the lines
    const extracted = [];
    for (const line of wallets) {
      const m = line.match(/0x[a-fA-F0-9]{64}/);
      if (m) extracted.push(m[0].replace(/^0x/,''));
      if (extracted.length >= 2) break;
    }
    if (extracted.length >= 2) return extracted.slice(0,2);
  }

  // Fallback: use provider.listAccounts (if running against Hardhat) to derive local wallets
  return keys;
}

async function main() {
  const workspaceRoot = path.resolve(__dirname, '..', '..');
  const debug = process.argv.includes('--debug');

  const deployPath = path.join(workspaceRoot, 'front', 'src', 'utils', 'contracts', 'deployment-summary.json');
  if (!fs.existsSync(deployPath)) {
    console.error('deployment-summary.json not found at', deployPath);
    process.exit(1);
  }
  const deployment = readJson(deployPath);
  // Fallback: if parsed deployment doesn't contain contracts.NDATemplate, try regex on raw file
  let rawFile = fs.readFileSync(deployPath, 'utf8');
  let maybeNDAFromRaw = null;
  try {
    const m = rawFile.match(/"NDATemplate"\s*:\s*"(0x[0-9a-fA-F]{40})"/);
    if (m) maybeNDAFromRaw = m[1];
  } catch (e) {}
  if (debug) console.log('Loaded deployment-summary.json from', deployPath);
  if (debug) try { console.log('deployment typeof:', typeof deployment); } catch(e){}
  if (debug) try { console.log('deployment preview:', JSON.stringify(deployment).slice(0,1000)); } catch(e){}
  if (debug) try { console.log('Top-level keys:', Array.isArray(deployment) ? '(array)' : Object.keys(deployment)); } catch(e) {}
  if (debug) try { console.log('contracts keys:', deployment && deployment.contracts ? Object.keys(deployment.contracts) : '(no contracts)'); } catch(e) {}

  const ndaAddress = deployment.NDATemplate || (deployment.contracts && deployment.contracts.NDATemplate) || maybeNDAFromRaw || process.env.NDA_ADDRESS;
  if (!ndaAddress) {
    console.error('NDATemplate address not found in deployment-summary.json and NDA_ADDRESS not set');
    process.exit(1);
  }

  const artifactsPath = path.join(workspaceRoot, 'front', 'src', 'utils', 'contracts');
  const ndaAbiPath = path.join(artifactsPath, 'NDATemplate.json');
  if (!fs.existsSync(ndaAbiPath)) {
    console.error('NDATemplate ABI not found at', ndaAbiPath);
    process.exit(1);
  }
  const ndaJson = readJson(ndaAbiPath);
  if (debug) console.log('ndaJson type:', typeof ndaJson);
  if (debug) try { console.log('ndaJson top keys:', Object.keys(ndaJson).slice(0,10)); } catch(e){}
  if (debug) console.log('ndaJson.abi exists?', ndaJson && typeof ndaJson.abi !== 'undefined');
  if (debug) try { console.log('ndaJson.abi isArray?', Array.isArray(ndaJson.abi)); } catch(e){}
  let ndaAbi = ndaJson.abi || ndaJson;
  if (!ndaJson || (typeof ndaJson === 'object' && Object.keys(ndaJson).length === 0)) {
    // attempt to extract abi array from raw file
    const rawAbiText = fs.readFileSync(ndaAbiPath, 'utf8');
    const abiIndex = rawAbiText.indexOf('"abi"');
    if (abiIndex !== -1) {
      const arrStart = rawAbiText.indexOf('[', abiIndex);
      if (arrStart !== -1) {
        // bracket matching
        let depth = 0;
        let inString = false;
        let prev = '';
        for (let i = arrStart; i < rawAbiText.length; i++) {
          const ch = rawAbiText[i];
          if (ch === '"' && prev !== '\\') inString = !inString;
          if (!inString) {
            if (ch === '[') depth++;
            else if (ch === ']') depth--;
            if (depth === 0) {
              const abiSlice = rawAbiText.slice(arrStart, i + 1);
              try {
                ndaAbi = JSON.parse(abiSlice);
                console.log('Extracted ABI array from raw NDATemplate.json');
              } catch (e) {
                console.error('Failed to parse extracted ABI array:', e && e.message);
              }
              break;
            }
          }
          prev = ch;
        }
      }
    }
  }
  if (debug) console.log('ndaAbi typeof:', typeof ndaAbi);
  if (debug) try { console.log('ndaAbi length:', Array.isArray(ndaAbi) ? ndaAbi.length : '(not array)'); } catch(e){}
  if (debug) try { console.log('ndaAbi first item preview:', Array.isArray(ndaAbi) ? JSON.stringify(ndaAbi[0]).slice(0,200) : 'n/a'); } catch(e){}
  if (debug) try {
    const fnNames = Array.isArray(ndaAbi) ? ndaAbi.filter(x=>x.type==='function').map(f=>f.name) : [];
    console.log('NDATemplate ABI functions (sample):', fnNames.slice(0,60));
  } catch(e){}

  const providerUrl = process.env.E2E_RPC_URL || 'http://127.0.0.1:8545';
  const provider = new ethers.JsonRpcProvider(providerUrl);
  // Check provider availability
  try {
    await Promise.race([
      provider.getNetwork(),
      new Promise((_, rej) => setTimeout(()=>rej(new Error('provider timeout')), 3000))
    ]);
  } catch (e) {
    console.error('RPC provider not reachable at', providerUrl, '-', e && e.message);
    process.exit(2);
  }

  let privateKeys = await getPrivateKeys(workspaceRoot);

  // If we don't have explicit keys, try to use the first two unlocked accounts from the node
  if (privateKeys.length < 2) {
    try {
      const accounts = await provider.send('eth_accounts', []);
      if (accounts && accounts.length >= 2) {
        if (debug) console.log('No local private keys provided; will use unlocked accounts from node:', accounts.slice(0,2));
        // We can't sign transactions without keys; attempt to use local hardhat private keys file (WALLETS.txt) already attempted
      }
    } catch (e) {
      // ignore
    }
  }

  // Create Wallets for signers if keys present
  const wallets = privateKeys.slice(0,2).map(k => new ethers.Wallet('0x'+k, provider));
  if (wallets.length < 2) {
    console.error('Need two private keys (E2E_PRIVATE_KEY and E2E_OFFENDER_PRIVATE_KEY) or WALLETS.txt with >=2 keys.');
    process.exit(1);
  }

  const [partyA, partyB] = wallets;
  if (debug) console.log('partyA:', await partyA.getAddress());
  if (debug) console.log('partyB:', await partyB.getAddress());

  const nda = new ethers.Contract(ndaAddress, ndaAbi, provider);

  // Helper to read state
  async function readState() {
    // Try common method names used by front-end helpers
    const addrA = await partyA.getAddress();
    const addrB = await partyB.getAddress();
    let signedA = false, signedB = false;
    for (const fn of ['signedBy','signed','signedByAddress','isSigned']) {
      if (typeof nda[fn] === 'function') {
        signedA = await nda[fn](addrA).catch(()=>false);
        signedB = await nda[fn](addrB).catch(()=>false);
        break;
      }
    }
    // deposits mapping could be named 'deposits' or 'balances' or 'deposited'
    let depositA = 0n, depositB = 0n;
    for (const fn of ['deposits','deposited','depositsOf','balances']) {
      if (typeof nda[fn] === 'function') {
        depositA = BigInt((await nda[fn](addrA)).toString());
        depositB = BigInt((await nda[fn](addrB)).toString());
        break;
      }
    }
    let minDeposit = 0n;
    if (typeof nda.minDeposit === 'function') minDeposit = BigInt((await nda.minDeposit()).toString());
    // contract state: try to read 'contractState' or isActive()
    let isActive = false;
    try {
      if (typeof nda.active === 'function') {
        isActive = await nda.active().catch(()=>false);
      }
    } catch (e) {}
    // fallback: attempt to read contractState enum
  let contractState = null;
  try { contractState = await nda.contractState().catch(()=>null); } catch(e){}

    return { signedA, signedB, depositA, depositB, minDeposit, isActive, contractState };
  }

  const pre = await readState();
  if (debug) console.log('Pre-activation status:', {
    signedA: pre.signedA, signedB: pre.signedB,
    depositA: String(pre.depositA), depositB: String(pre.depositB), minDeposit: String(pre.minDeposit),
    isActive: pre.isActive, contractState: String(pre.contractState)
  });

  // Build EIP712 typed data for NDA signing following front-end helpers
  // Domain: { name: 'NDATemplate', version: '1', chainId, verifyingContract: ndaAddress }
  const chainId = (await provider.getNetwork()).chainId;
  const domain = { name: 'NDATemplate', version: '1', chainId: Number(chainId), verifyingContract: ndaAddress };
  // Types
  const types = { NDA: [
    { name: 'contractAddress', type: 'address' },
    { name: 'expiryDate', type: 'uint256' },
    { name: 'penaltyBps', type: 'uint16' },
    { name: 'customClausesHash', type: 'bytes32' }
  ] };

  // Read current NDA fields needed for typed data
  const expiryDate = await nda.expiryDate().catch(()=>0n);
  const penaltyBps = await nda.penaltyBps().catch(()=>0);
  const customClausesHash = await nda.customClausesHash().catch(()=>'0x'+ '0'.repeat(64));

  const value = {
    contractAddress: ndaAddress,
    expiryDate: BigInt(expiryDate || 0n),
    penaltyBps: Number(penaltyBps || 0),
    customClausesHash: customClausesHash
  };

  // Sign and call signNDA() for both parties if not already signed
  async function ensureSigned(signer, label) {
    const state = await readState();
    const addr = await signer.getAddress();
    const already = (addr === await partyA.getAddress() ? state.signedA : state.signedB);
    if (already) { console.log(`${label} already signed`); return; }
    if (typeof signer._signTypedData !== 'function') {
      console.warn(`${label} signer missing _signTypedData; attempting provider-based signing`);
    }
    // create signature using _signTypedData
    let sig;
    try {
      sig = await signTypedDataNode(signer, domain, types, value);
    } catch (e) {
      console.error('Failed to produce EIP-712 signature:', e && e.message);
      throw e;
    }
    console.log(`${label} signature:`, sig);
    const ndaWithSigner = nda.connect(signer);
    if (typeof ndaWithSigner.signNDA !== 'function') {
      throw new Error('NDATemplate contract does not expose signNDA(signature)');
    }
    try {
      const tx = await ndaWithSigner.signNDA(sig);
      console.log(`${label} signNDA tx hash:`, tx.hash);
      const receipt = await tx.wait();
      console.log(`${label} signNDA mined, status=`, receipt.status);
    } catch (e) {
      console.error(`${label} signNDA failed:`, e && e.message);
      // swallow specific already-signed errors
      const msg = e && (e.reason || e.message || '');
      if (/already signed/i.test(msg) || /Already signed/i.test(msg)) {
        console.log(`${label} already signed (caught during tx)`);
        return;
      }
      throw e;
    }
  }

  try {
    await ndaHelpers.ensureSigned(nda, partyA, domain, types, value, { debug });
    await ndaHelpers.ensureSigned(nda, partyB, domain, types, value, { debug });
  } catch (e) {
    if (debug) console.error('Error during signing:', e && e.message ? e.message : e);
    else console.error('Error during signing:', e && e.reason ? e.reason : (e && e.message) || e);
  }

  // Ensure deposits: deposit minDeposit from any party missing deposit
  const postSigned = await readState();
  const minDeposit = BigInt(postSigned.minDeposit || 0n);
  async function ensureDeposit(signer, label) {
    const dep = BigInt((await nda.deposits(await signer.getAddress())).toString());
    if (dep >= minDeposit && minDeposit > 0n) { console.log(`${label} already deposited ${dep}`); return; }
    if (minDeposit === 0n) { console.log('minDeposit is 0, skipping deposit'); return; }
    console.log(`${label} depositing minDeposit=${minDeposit}`);
    const ndaWithSigner = nda.connect(signer);
    const tx = await ndaWithSigner.deposit({ value: minDeposit });
    console.log(`${label} deposit tx hash:`, tx.hash);
    const receipt = await tx.wait();
    console.log(`${label} deposit mined, status=`, receipt.status);
  }

  try {
  await ndaHelpers.ensureDeposit(nda, partyA, minDeposit, { debug });
  await ndaHelpers.ensureDeposit(nda, partyB, minDeposit, { debug });
  } catch (e) {
    console.error('Error during deposit:', e);
  }

  const final = await readState();
  const stateNames = ['Draft','PendingActivation','Active','Disputed','Resolved','Terminated'];
  const cs = Number(final.contractState || 0);
  if (debug) console.log('Post-activation status:', {
    signedA: final.signedA, signedB: final.signedB,
    depositA: String(final.depositA), depositB: String(final.depositB), minDeposit: String(final.minDeposit),
    activeFlag: final.isActive, contractState: cs, contractStateName: stateNames[cs] || String(final.contractState)
  });
  if (cs === 2) {
    console.log('NDATemplate is Active');
  } else {
    console.warn('NDATemplate is NOT active after signing/deposits. You may need additional activation steps.');
    // Exit with a specific non-zero code so external callers (global setup) can detect failure
    process.exitCode = 3;
  }

  // Optionally attempt a static call to reportBreach to verify success (won't change state)
  try {
    const reporter = partyA; // try as partyA
    const ndaWithReporter = nda.connect(reporter);
    // Use a dry-run static call to check revert reasons; we need parameters: offender (partyB), amount (0), digest, details
    const offender = await partyB.getAddress();
    const amount = 0n;
    const digest = '0x' + '0'.repeat(64);
    const details = 'activation-check';
    const callRes = await provider.call({
      to: ndaAddress,
      data: ndaWithReporter.interface.encodeFunctionData('reportBreach', [offender, amount, digest, details]),
    });
    console.log('reportBreach static call returned:', callRes);
  } catch (e) {
    // show revert reason if available
    console.error('reportBreach static call failed (expected if not active):', e?.message || e);
    // If we previously set a non-zero exitCode (not active), ensure process exits with that code
    if (process.exitCode && process.exitCode !== 0) {
      // Explicitly exit now to make non-zero observable to callers
      process.exit(process.exitCode);
    }
  }

}

main().catch(e => { console.error(e); process.exit(1); });
