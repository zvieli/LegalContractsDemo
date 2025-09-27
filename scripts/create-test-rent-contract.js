#!/usr/bin/env node
/* Create a simple Rent contract via ContractFactory using the TEST_PK env var.
   Usage: TEST_PK=0x... node scripts/create-test-rent-contract.js [--rpc http://127.0.0.1:8545]
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
    'function createRentContract(address _tenant, uint256 _rentAmount, address _priceFeed, uint256 _dueDate, uint256 _propertyId) returns (address)',
    'event RentContractCreated(address indexed contractAddress, address indexed creator, address indexed tenant)'
  ];
  const factory = new Contract(factoryAddr, abi, wallet);

  // pick a tenant account different from creator
  let tenant = null;
  // allow explicit tenant via TENANT_PK or REPORTER_PK so tests can ensure injected reporter is the tenant
  const explicitTenantPk = process.env.TENANT_PK || process.env.REPORTER_PK || process.env.PARTY_B_PK || null;
  if (explicitTenantPk) {
    try {
      const w = new Wallet(explicitTenantPk);
      tenant = await w.getAddress();
      console.log('Using explicit TENANT_PK resolved tenant =>', tenant);
    } catch (e) {
      console.warn('Failed to resolve explicit TENANT_PK', e);
      tenant = null;
    }
  }
  if (!tenant) {
    try {
      const acs = await provider.listAccounts();
      if (acs && acs.length > 1) tenant = acs[1];
      else tenant = acs && acs[0] ? acs[0] : null;
    } catch (e) { tenant = null; }
  }
  if (!tenant) {
    const fallbackPk = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
    const fallbackWallet = new Wallet(fallbackPk);
    tenant = await fallbackWallet.getAddress();
    console.log('No second account found on provider; using fallback tenant', tenant);
  }

  // Normalize tenant if needed (could be an object with .address or another representation)
  function normalizeAddr(a) {
    if (!a) return null;
    if (typeof a === 'string') return a;
    if (typeof a === 'object') {
      if (typeof a.address === 'string') return a.address;
      try { const s = a.toString(); if (typeof s === 'string') return s; } catch (e) {}
    }
    return null;
  }
  tenant = normalizeAddr(tenant);

  if (!tenant || tenant.toLowerCase() === (await wallet.getAddress()).toLowerCase()) {
    console.error('Wallet address equals candidate tenant or tenant invalid; ensure chain has more accounts or change TEST_PK');
    process.exit(4);
  }

  const now = Math.floor(Date.now() / 1000);
  const dueDate = now + 60*60*24; // 1 day
  const rentAmount = ethers.parseEther('1');
  let priceFeed = jf.contracts.MockPriceFeed || jf.contracts.PriceFeed || null;
  const propertyId = 0;

  if (!priceFeed) {
    console.warn('No price feed address found in ContractFactory.json; attempting to deploy a MockPriceFeed artifact');
    // Try to deploy MockPriceFeed from local Hardhat artifacts so the script is self-contained
    try {
      const artifactPath = path.join(process.cwd(), 'artifacts', 'contracts', 'Rent', 'MockPriceFeed.sol', 'MockPriceFeed.json');
      const artRaw = await fs.readFile(artifactPath, 'utf8');
      const art = JSON.parse(artRaw);
      const mockFactory = new ethers.ContractFactory(art.abi, art.bytecode, wallet);
      const mockPrice = await mockFactory.deploy(2000);
      await mockPrice.waitForDeployment();
      const mockAddr = await mockPrice.getAddress();
      console.log('Deployed MockPriceFeed to', mockAddr);
      jf.contracts = jf.contracts || {};
      jf.contracts.MockPriceFeed = mockAddr;
      // optionally write back to front/public utils so other scripts can find it
      try { await fs.writeFile(path.join(process.cwd(), 'front', 'public', 'utils', 'contracts', 'ContractFactory.json'), JSON.stringify(jf, null, 2)); } catch (e) { /* non-fatal */ }
      priceFeed = mockAddr;
    } catch (e) {
      console.warn('Failed to deploy MockPriceFeed artifact automatically:', e?.message || e);
    }
  }

  console.log('Creating Rent with tenant', tenant, 'rentAmount', String(rentAmount), 'dueDate', dueDate);
  const tx = await factory.createRentContract(tenant, rentAmount, priceFeed || ethers.ZeroAddress, dueDate, propertyId);
  console.log('tx hash', tx.hash);
  const r = await tx.wait();
  console.log('tx mined. events:', r.events ? r.events.map(e=>e.event) : []);
  const iface = factory.interface;
  for (const log of r.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === 'RentContractCreated') {
        console.log('RentContractCreated event:', parsed.args);
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
        const factoryFull = new ethers.Contract(factoryAddr, fullAbi, wallet);
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

  // If the test harness specified a REPORTER_PK (or TEST_PK_REPORTER/TENANT_PK), ensure that account has ETH
  try {
    const reporterPk = process.env.REPORTER_PK || process.env.TEST_PK_REPORTER || process.env.TENANT_PK || null;
    if (reporterPk) {
      try {
        const reporterAddr = await (new Wallet(reporterPk)).getAddress();
        const bal = await provider.getBalance(reporterAddr);
        console.log('Reporter/Tenant candidate', reporterAddr, 'balance', String(bal));
        const minFunding = ethers.parseEther('0.05');
        if (bal < minFunding) {
          console.log('Funding reporter/tenant', reporterAddr, 'with', String(minFunding));
          let attempts = 0;
          let sent = false;
          while (attempts < 3 && !sent) {
            attempts++;
            try {
              const ftx = await wallet.sendTransaction({ to: reporterAddr, value: minFunding });
              const fr = await ftx.wait();
              console.log('Fund tx mined', ftx.hash, 'status', fr.status);
              if (!fr.status || fr.status === 0) {
                console.error('Funding reporter/tenant failed; aborting E2E');
                process.exit(7);
              }
              sent = true;
            } catch (err) {
              console.warn('Funding attempt', attempts, 'failed:', err && err.message ? err.message : err);
              if (attempts >= 3) {
                console.error('Funding reporter/tenant failed after retries; aborting E2E');
                process.exit(7);
              }
              await new Promise(r => setTimeout(r, 150));
            }
          }
        }
      } catch (rf) {
        console.error('Failed to fund reporter/tenant candidate (fatal):', rf && rf.message ? rf.message : rf);
        process.exit(7);
      }
    }
  } catch (e) {
    console.warn('Reporter/tenant funding probe failed:', e?.message || e);
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
