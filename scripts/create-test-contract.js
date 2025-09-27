#!/usr/bin/env node
/* Create a simple NDA contract via ContractFactory using the TEST_PK env var and the frontend ContractFactory.json addresses.
   Usage: TEST_PK=0x... node scripts/create-test-contract.js [--rpc http://127.0.0.1:8545]
*/
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { JsonRpcProvider, Wallet, Contract, ethers } from 'ethers';

async function main() {
  const rpc = process.argv.includes('--rpc') ? process.argv[process.argv.indexOf('--rpc')+1] : (process.env.PLAYWRIGHT_RPC_URL || 'http://127.0.0.1:8545');
  const pk = process.env.TEST_PK || process.env.PLAYWRIGHT_TEST_PRIVATE_KEY;
  if (!pk) {
    console.error('Set TEST_PK (private key) in env');
    process.exit(2);
  }
  const root = process.cwd();
  const jsonPath = path.join(root, 'front', 'public', 'utils', 'contracts', 'ContractFactory.json');
  const jf = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  const factoryAddr = jf.contracts.ContractFactory;
  if (!factoryAddr) {
    console.error('ContractFactory address not found in', jsonPath);
    process.exit(3);
  }

  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(pk, provider);
  console.log('Using address', await wallet.getAddress(), 'rpc', rpc, 'factory', factoryAddr);

  const abi = [
    'function createNDA(address _partyB, uint256 _expiryDate, uint16 _penaltyBps, bytes32 _customClausesHash, uint256 _minDeposit) returns (address)',
    'event NDACreated(address indexed contractAddress, address indexed partyA, address indexed partyB)'
  ];
  const factory = new Contract(factoryAddr, abi, wallet);

  // Determine partyB (the counterparty). Prefer explicit PARTY_B_PK/REPORTER_PK passed via env
  // so test harness can ensure the reporter account is one of the contract parties.
  let partyB = null;
  const explicitPk = process.env.PARTY_B_PK || process.env.REPORTER_PK || process.env.TARGET_PARTY_PK || null;
  if (explicitPk) {
    try {
      const w = new Wallet(explicitPk);
      partyB = await w.getAddress();
      console.log('Using explicit PARTY_B_PK, resolved partyB =>', partyB);
    } catch (e) {
      console.warn('Failed to resolve explicit PARTY_B_PK', e);
      partyB = null;
    }
  }
  // If not provided, fall back to provider accounts list (choose account #1)
  if (!partyB) {
    try {
      const acs = await provider.listAccounts();
      if (acs && acs.length > 1) partyB = acs[1];
      else partyB = acs && acs[0] ? acs[0] : null;
    } catch (e) { partyB = null; }
  }
  // fallback: use known test account #1 private key from WALLETS.txt (hardcoded fallback for local dev)
  if (!partyB) {
    const fallbackPk = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
    const fallbackWallet = new Wallet(fallbackPk);
    partyB = await fallbackWallet.getAddress();
    console.log('No second account found on provider; using fallback partyB', partyB);
  }

  // Normalize partyB to a hex string if it's an object with `.address`, or has toString()
  function normalizeAddr(a) {
    if (!a) return null;
    if (typeof a === 'string') return a;
    if (typeof a === 'object') {
      if (typeof a.address === 'string') return a.address;
      try { const s = a.toString(); if (typeof s === 'string') return s; } catch (e) {}
    }
    return null;
  }
  partyB = normalizeAddr(partyB);
  console.log('Normalized partyB =>', partyB, 'type:', typeof partyB);
  if (!partyB || !/^0x[0-9a-fA-F]{40}$/.test(partyB)) {
    console.error('Failed to resolve a valid address for partyB:', partyB);
    process.exit(5);
  }

  if (partyB.toLowerCase() === (await wallet.getAddress()).toLowerCase()) {
    console.error('Wallet address equals candidate partyB; ensure chain has more accounts or change TEST_PK');
    process.exit(4);
  }

  const expiry = Math.floor(Date.now() / 1000) + 60*60*24; // 1 day in future
  const penalty = 100; // small
  const custom = '0x' + '00'.repeat(32);
  // Use a small minDeposit in wei-denominated ETH to allow reporters to trigger breach checks
  // Use 0.01 ETH which is small but ensures deposits > 0 for local E2E tests
  const minDeposit = ethers.parseEther('0.01'); // in wei

  console.log('Creating NDA with partyB', partyB, 'expiry', expiry);
  const tx = await factory.createNDA(partyB, expiry, penalty, custom, minDeposit);
  console.log('tx hash', tx.hash);
  const r = await tx.wait();
  console.log('tx mined. events:', r.events ? r.events.map(e=>e.event) : []);
  // Try to parse returned address from receipt (might be in events)
  const iface = factory.interface;
  // Find NDACreated event in logs
  for (const log of r.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === 'NDACreated') {
        console.log('NDACreated event:', parsed.args);
      }
    } catch (e) { /* ignore */ }
  }

  // Probe factory state for this creator to help E2E debugging
  try {
    const creator = await wallet.getAddress();
    try {
      // Try to load full ABI from frontend artifacts so we can call helper view methods
      const abiPath = path.join(process.cwd(), 'front', 'public', 'utils', 'contracts', 'ContractFactoryABI.json');
      let fullAbi = null;
      try {
        const abRaw = await fs.readFile(abiPath, 'utf8');
        fullAbi = JSON.parse(abRaw).abi || JSON.parse(abRaw);
      } catch (e) {
        // ignore if ABI not present
      }
      if (fullAbi) {
        const factoryFull = new Contract(factoryAddr, fullAbi, wallet);
        const list = await factoryFull.getContractsByCreator(creator);
        console.log('Factory contracts for creator', creator, '=>', list);
        try {
          const total = await factoryFull.getAllContractsCount();
          console.log('Factory allContracts count =>', String(total));
        } catch (e) {}
      } else {
        console.log('Full ContractFactory ABI not found at', abiPath, '; skipping detailed factory probes');
      }
    } catch (e) {
      console.log('Failed to read contractsByCreator from factory:', String(e));
    }
  } catch (e) { /* ignore */ }

  console.log('Done.');

  // After creating NDA, attempt to deposit the minDeposit from the creator side so
  // that later reporters can call reportBreach against the creator as offender.
  try {
    // Try to find created NDA address from events parsed above
    let createdAddr = null;
    for (const log of r.logs) {
      try {
        const parsed = factory.interface.parseLog(log);
        if (parsed && parsed.name === 'NDACreated') {
          createdAddr = parsed.args[0];
          break;
        }
      } catch (e) { /* ignore */ }
    }
    if (createdAddr) {
      try {
        // Load NDATemplate ABI from local artifacts so we can call deposit()
        const ndaAbiPath = path.join(process.cwd(), 'artifacts', 'contracts', 'NDA', 'NDATemplate.sol', 'NDATemplate.json');
        const ndaJson = JSON.parse(await fs.readFile(ndaAbiPath, 'utf8'));
        const nda = new Contract(createdAddr, ndaJson.abi || ndaJson, wallet);
        console.log('Attempting creator deposit of', String(minDeposit), 'wei to NDA', createdAddr);
        const dt = await nda.deposit({ value: minDeposit });
        console.log('Creator deposit tx hash', dt.hash);
        const dtR = await dt.wait();
        console.log('Creator deposit tx mined for NDA', createdAddr, 'receipt status', dtR.status);
        if (!dtR.status || dtR.status === 0) {
          console.error('Creator deposit transaction failed or reverted; aborting E2E run.');
          process.exit(6);
        }
      } catch (depErr) {
        // Make deposit failures fatal so the E2E harness doesn't continue with an invalid contract state
        console.error('Creator deposit to NDA failed (fatal):', depErr && depErr.message ? depErr.message : depErr);
        // include full error object when possible for debugging
        try { console.error('Full error:', depErr); } catch (_) {}
        process.exit(6);
      }
    } else {
      console.warn('Could not determine created NDA address to deposit into');
    }
  } catch (e) {
    // non-fatal
    console.warn('Post-create deposit flow failed:', e?.message || e);
  }

  // If the test harness specified a REPORTER_PK (or TEST_PK_REPORTER), ensure that account has ETH
  try {
    const reporterPk = process.env.REPORTER_PK || process.env.TEST_PK_REPORTER || process.env.TENANT_PK || null;
    if (reporterPk) {
      try {
        const reporterAddr = await (new Wallet(reporterPk)).getAddress();
        const bal = await provider.getBalance(reporterAddr);
        console.log('Reporter candidate', reporterAddr, 'balance', String(bal));
        const minFunding = ethers.parseEther('0.05');
        if (bal < minFunding) {
          console.log('Funding reporter', reporterAddr, 'with', String(minFunding));
          let attempts = 0;
          let sent = false;
          while (attempts < 3 && !sent) {
            attempts++;
            try {
              const ftx = await wallet.sendTransaction({ to: reporterAddr, value: minFunding });
              const fr = await ftx.wait();
              console.log('Fund tx mined', ftx.hash, 'status', fr.status);
              if (!fr.status || fr.status === 0) {
                console.error('Funding reporter failed; aborting E2E');
                process.exit(7);
              }
              sent = true;
            } catch (err) {
              console.warn('Funding attempt', attempts, 'failed:', err && err.message ? err.message : err);
              if (attempts >= 3) {
                console.error('Funding reporter failed after retries; aborting E2E');
                process.exit(7);
              }
              // small delay before retry
              await new Promise(r => setTimeout(r, 150));
            }
          }
        }
      } catch (rf) {
        console.error('Failed to fund reporter candidate (fatal):', rf && rf.message ? rf.message : rf);
        process.exit(7);
      }
    }
  } catch (e) {
    // non-fatal
    console.warn('Reporter funding probe failed:', e?.message || e);
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
