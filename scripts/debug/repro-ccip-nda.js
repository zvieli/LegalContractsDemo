#!/usr/bin/env node
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

async function loadDeployment() {
  const p = path.resolve(__dirname, '..', '..', 'front', 'src', 'utils', 'contracts', 'deployment-summary.json');
  if (!fs.existsSync(p)) throw new Error('deployment-summary.json not found at ' + p);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function short(x){ return x && typeof x === 'string' ? x.slice(0, 20) : x; }

async function tryCall(contract, fnName, args = [], overrides = {}){
  try {
    console.log(`Calling ${contract.address}.${fnName}(${args.map(a=>short(a)).join(', ')}) with overrides ${JSON.stringify(overrides)}`);
    const tx = await contract[fnName](...args, overrides);
    console.log('Tx sent, hash=', tx.hash);
    const rec = await tx.wait();
    console.log('Tx mined:', rec.transactionHash, 'status=', rec.status);
    return { receipt: rec };
  } catch (err) {
    console.error('Call threw:', err && err.message ? err.message : err);
    if (err && err.error && err.error.body) {
      try { console.error('Body:', JSON.parse(err.error.body)); } catch(e){}
    }
    return { error: err };
  }
}

async function probeCall(provider, to, data, from){
  try {
    const res = await provider.call({ to, data, from });
    console.log('Static call returned (no revert):', res);
    return { res };
  } catch (err) {
    console.error('Static call reverted:', err && (err.error?.message || err.message || err));
    return { error: err };
  }
}

async function main(){
  const provider = new ethers.JsonRpcProvider(process.env.E2E_RPC_URL || 'http://127.0.0.1:8545');
  const deploy = await loadDeployment();

  const signerKey = process.env.E2E_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const signer = new ethers.Wallet(signerKey, provider);

  // 1) Enhanced Rent: call the correct function if present
  try {
    const rentAddr = process.env.ENHANCED_RENT_ADDRESS || deploy.contracts && deploy.contracts.EnhancedRentContract && (deploy.contracts.EnhancedRentContract.address || deploy.contracts.EnhancedRentContract);
    if (!rentAddr) {
      console.warn('EnhancedRentContract address missing in deployment-summary.json or ENHANCED_RENT_ADDRESS not set');
    } else {
      // Load full ABI from front utils if available, otherwise fallback to artifacts
      let rentAbiJson = null;
      const frontPath = path.resolve(__dirname, '..', '..', 'front', 'src', 'utils', 'contracts', 'EnhancedRentContract.json');
      const artifactPath = path.resolve(__dirname, '..', '..', 'artifacts', 'contracts', 'Rent', 'EnhancedRentContract.sol', 'EnhancedRentContract.json');
      if (fs.existsSync(frontPath)) rentAbiJson = JSON.parse(fs.readFileSync(frontPath, 'utf8'));
      else if (fs.existsSync(artifactPath)) rentAbiJson = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
      else {
        console.warn('Could not find EnhancedRentContract ABI in front utils or artifacts');
      }

      if (!rentAbiJson) {
        // Fallback to minimal behaviour
        const rentContract = new ethers.Contract(rentAddr, ['function reportDispute(uint8,uint256,string) external payable'], signer);
        let disputeFee = ethers.Zero;
        try { disputeFee = await rentContract.disputeFee(); } catch(e) { disputeFee = ethers.Zero; }
        console.log('Using disputeFee', String(disputeFee || '0'));
        const dtype = 0;
        const requested = ethers.parseEther('0.01');
        const evidenceUri = 'test-evidence://debug';
        const res = await tryCall(rentContract, 'reportDispute', [dtype, requested, evidenceUri], { value: disputeFee || 0 });
        if (res.error) {
          const calldata = rentContract.interface.encodeFunctionData('reportDispute', [dtype, requested, evidenceUri]);
          await probeCall(provider, rentAddr, calldata, await signer.getAddress());
        }
      } else {
        const rentContract = new ethers.Contract(rentAddr, rentAbiJson.abi || rentAbiJson, signer);
        let disputeFee = ethers.Zero;
        try { disputeFee = await rentContract.disputeFee(); } catch(e) { disputeFee = ethers.Zero; }
        console.log('Using disputeFee', String(disputeFee || '0'));
        const dtype = 0;
        const requested = ethers.parseEther('0.01');
        const evidenceUri = 'test-evidence://debug';
        const percentageBond = requested * BigInt(50) / BigInt(10000);
        const minimumBond = ethers.parseEther('0.001');
        const requiredBond = percentageBond > minimumBond ? percentageBond : minimumBond;
        console.log('Computed requiredBond (wei)=', requiredBond.toString(), 'percentageBond=', percentageBond.toString(), 'minimumBond=', minimumBond.toString());
        try {
          const tx = await rentContract.reportDispute(dtype, requested, evidenceUri, { value: requiredBond });
          console.log('reportDispute tx hash', tx.hash);
          const rec = await tx.wait();
          console.log('reportDispute mined, status=', rec.status);
        } catch (err) {
          console.error('reportDispute threw:', err && err.message ? err.message : err);
          const calldata = rentContract.interface.encodeFunctionData('reportDispute', [dtype, requested, evidenceUri]);
          await probeCall(provider, rentAddr, calldata, await signer.getAddress());
        }
      }
    }
  } catch(e){ console.error('Error during EnhancedRentContract probe', e); }

  try {
    const ndaAddr = process.env.NDA_ADDRESS || deploy.contracts && deploy.contracts.NDATemplate && (deploy.contracts.NDATemplate.address || deploy.contracts.NDATemplate);
    if (!ndaAddr) console.warn('NDATemplate address missing in deployment-summary.json or NDA_ADDRESS not set; skipping NDA probe');
    else {
      let ndaAbiJson = null;
      const frontNDAPath = path.resolve(__dirname, '..', '..', 'front', 'src', 'utils', 'contracts', 'NDATemplate.json');
      const artifactNDAPath = path.resolve(__dirname, '..', '..', 'artifacts', 'contracts', 'NDA', 'NDATemplate.sol', 'NDATemplate.json');
      if (fs.existsSync(frontNDAPath)) ndaAbiJson = JSON.parse(fs.readFileSync(frontNDAPath, 'utf8'));
      else if (fs.existsSync(artifactNDAPath)) ndaAbiJson = JSON.parse(fs.readFileSync(artifactNDAPath, 'utf8'));
      const nda = new ethers.Contract(ndaAddr, ndaAbiJson ? (ndaAbiJson.abi || ndaAbiJson) : [
        'function deposit() external payable',
        'function reportBreach(address offender,uint256 requestedPenalty,bytes32 evidenceHash,string evidenceURI) external payable returns (uint256)',
        'function disputeFee() external view returns (uint256)',
        'function minDeposit() external view returns (uint256)',
        'function isParty(address) external view returns (bool)'
      ], signer);

      const reporter = signer;
      const all = await provider.send('eth_accounts', []);
      const offenderAddress = all && all[1] ? all[1] : (await provider.getBlock('latest')).hash.slice(0,42);

      console.log('Reporter', await reporter.getAddress(), 'Offender', offenderAddress);

      try {
        const isOffenderParty = await nda.isParty(offenderAddress).catch(()=>false);
        const isReporterParty = await nda.isParty(await reporter.getAddress()).catch(()=>false);
        console.log('isOffenderParty=', isOffenderParty, 'isReporterParty=', isReporterParty);
      } catch(e){}

      let minDep = 0n;
      try { minDep = await nda.minDeposit(); } catch(e) { console.warn('Could not read minDeposit', e.message || e); }
      if (typeof minDep === 'object' && typeof minDep.valueOf === 'function') minDep = BigInt(minDep.toString());
      else minDep = BigInt(minDep || 0);
      console.log('minDeposit=', String(minDep));

      if (minDep > 0n){
        const accounts = await provider.send('eth_accounts', []);
        if (accounts && accounts[1]){
          console.log('Offender is an unlocked account; a full deposit flow would send ETH to offender and call deposit from that account.');
        }
      }

      let disputeFee = ethers.Zero;
      try { disputeFee = await nda.disputeFee(); } catch(e) { disputeFee = ethers.Zero; }
      console.log('nda.disputeFee=', disputeFee.toString());

      const offender = offenderAddress;
      const requestedPenalty = ethers.parseEther('0.005');
      const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes('debug-evidence'));
      const evidenceURI = 'ipfs://debug-evidence';

      try {
        const tx = await nda.reportBreach(offender, requestedPenalty, evidenceHash, evidenceURI, { value: disputeFee || 0 });
        console.log('nda.reportBreach tx hash', tx.hash);
        const rec = await tx.wait();
        console.log('nda.reportBreach mined status=', rec.status);
      } catch (err) {
        console.error('nda.reportBreach threw:', err && err.message ? err.message : err);
        const calldata = nda.interface.encodeFunctionData('reportBreach', [offender, requestedPenalty, evidenceHash, evidenceURI]);
        await probeCall(provider, ndaAddr, calldata, await signer.getAddress());
      }
    }
  } catch(e){ console.error('Error during NDA probe', e); }
}

main().catch(err=>{ console.error('Fatal', err); process.exit(1); });
