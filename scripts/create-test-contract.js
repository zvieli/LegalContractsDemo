#!/usr/bin/env node
/* Create a simple NDA contract via ContractFactory using the TEST_PK env var and the frontend ContractFactory.json addresses.
   Usage: TEST_PK=0x... node scripts/create-test-contract.js [--rpc http://127.0.0.1:8545]
*/
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { JsonRpcProvider, Wallet, Contract } from 'ethers';

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

  // simple parameters: partyB = wallet.address (must not equal creator) -> pick account #1 as partyB if available
  const accounts = await provider.send('eth_accounts', []);
  let partyB = accounts && accounts[0] ? accounts[0] : null;
  // try to pick a different account for partyB
  try {
  const acs = await provider.listAccounts();
  if (acs && acs.length > 1) partyB = acs[1];
  } catch (e) {}
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
  const minDeposit = 1; // non-zero to satisfy MinDepositZero() check

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

  console.log('Done.');
}

main().catch(e=>{ console.error(e); process.exit(1); });
